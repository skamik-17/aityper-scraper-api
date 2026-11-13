#!/usr/bin/env npx tsx
/**
 * Single-bookmaker full-offer smoke test.
 *
 * Dry (default): scrapes the league's full offer and normalizes it in memory.
 * Nothing is read from or written to the database.
 * --persist: one real run through runScrapeAndPersist, as the scheduler does it
 * for one bookmaker (DB preflight, save, scraper_runs row, summary and alerts).
 * It writes to the database.
 *
 * Usage:
 *   npx tsx scripts/smoke-bookmaker.ts --bookmaker <bm> [--league premier-league] [--persist]
 *
 * Prints one `SMOKE_RESULT {json}` line. Exit codes:
 *   0  OK (dry: scraped; --persist: success or partial)
 *   1  the bookmaker failed (dry: scrape_failed or empty; --persist: any other outcome)
 *   2  usage error or unknown bookmaker
 *   3  --persist run refused: database unreachable
 *
 * Unlike scripts/audit-probe.ts, whose contract is exit 0 for every probe
 * outcome, this script fails loudly.
 */
import { ALL_POLISH_BOOKMAKERS, CONFIG, type PolishBookmaker } from "../src/config/index.js";
import { closeAllBrowsers, getScraper } from "../src/scrapers/aggregator.js";
import { normalizeMarketsForBookmaker } from "../src/services/normalization/index.js";
import { runScrapeAndPersist } from "../src/services/scraper-service.js";
import { isOkRunStatus } from "../src/services/run-outcome.js";
import type { FullOfferScraperResult } from "../src/types/full-offer.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: smoke-bookmaker.ts --bookmaker <bm> [--league <slug>] [--persist]";

interface Args {
  bookmaker: string;
  league: string;
  persist: boolean;
}

export interface SmokeResult {
  bookmaker: PolishBookmaker;
  league: string;
  /** Dry: scraped | empty | scrape_failed. --persist: the run outcome status, null without one. */
  status: string | null;
  matches: number;
  marketsFound: number;
  /** --persist only */
  marketsSaved?: number;
  /** Normalization figures: dry only, null with --persist. */
  marketsNormalized: number | null;
  minMarketsPerMatch: number | null;
  otherMarketShare: number | null;
  unknownSelectionShare: number | null;
  error: string | null;
  /** --persist only */
  aborted?: "db_unreachable" | null;
  durationMs: number;
}

function parseArgs(argv: string[]): Args | null {
  const args: Partial<Args> = { league: CONFIG.ENABLED_LEAGUES[0], persist: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const hasValue = value !== undefined && !value.startsWith("--");
    if (flag === "--bookmaker" && hasValue) {
      args.bookmaker = value;
      i++;
    } else if (flag === "--league" && hasValue) {
      args.league = value;
      i++;
    } else if (flag === "--persist") {
      args.persist = true;
    } else {
      return null;
    }
  }
  return args.bookmaker ? (args as Args) : null;
}

export function isBookmaker(bm: string): bm is PolishBookmaker {
  return (ALL_POLISH_BOOKMAKERS as readonly string[]).includes(bm);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function share(part: number, total: number): number | null {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

/** One scrape, no database. A throw becomes a failed result (the aggregator's rule). */
export async function scrapeOnce(bookmaker: PolishBookmaker, league: string): Promise<FullOfferScraperResult> {
  const scraper = getScraper(bookmaker)!;
  try {
    return await scraper.scrapeFullOffer(league);
  } catch (error) {
    // Same as the aggregator: a thrown scraper is a failed scrape.
    return { success: false, bookmaker, league, matches: [], error: errorMessage(error) };
  }
}

/** Normalize a scrape in memory and summarise it; nothing touches the database. */
export function summarizeDryRun(
  bookmaker: PolishBookmaker,
  league: string,
  scrape: FullOfferScraperResult,
  startedAt: number,
): { result: SmokeResult; code: number } {
  const matches = scrape.matches ?? [];
  let marketsFound = 0;
  let marketsNormalized = 0;
  let otherMarkets = 0;
  let selections = 0;
  let unknownSelections = 0;
  const perMatch: number[] = [];
  for (const m of matches) {
    marketsFound += m.markets.length;
    const normalized = normalizeMarketsForBookmaker(m.markets, bookmaker, m.homeTeam, m.awayTeam, league);
    marketsNormalized += normalized.length;
    perMatch.push(normalized.length);
    for (const market of normalized) {
      if (market.normalizedType === "OTHER") otherMarkets++;
      for (const s of market.selections) {
        selections++;
        if (s.normalizedName === "UNKNOWN") unknownSelections++;
      }
    }
  }

  const status = !scrape.success ? "scrape_failed" : matches.length === 0 ? "empty" : "scraped";
  return {
    result: {
      bookmaker,
      league,
      status,
      matches: matches.length,
      marketsFound,
      marketsNormalized,
      minMarketsPerMatch: perMatch.length > 0 ? Math.min(...perMatch) : 0,
      otherMarketShare: share(otherMarkets, marketsNormalized),
      unknownSelectionShare: share(unknownSelections, selections),
      error: scrape.error ?? null,
      durationMs: Date.now() - startedAt,
    },
    // An empty league counts as a failure, as it does for a scheduled run.
    code: status === "scraped" ? 0 : 1,
  };
}

/** Scrape and normalize in memory; nothing touches the database. */
async function dryRun(bookmaker: PolishBookmaker, league: string, startedAt: number): Promise<{ result: SmokeResult; code: number }> {
  return summarizeDryRun(bookmaker, league, await scrapeOnce(bookmaker, league), startedAt);
}

/** One real run for this bookmaker: preflight, scrape, save, scraper_runs, alerts. */
async function persistRun(bookmaker: PolishBookmaker, league: string, startedAt: number): Promise<{ result: SmokeResult; code: number }> {
  const run = await runScrapeAndPersist(league, [bookmaker]);
  // An aborted run has no outcome; neither has a run whose aggregator threw.
  const o = run.aborted ? undefined : run.outcomes.find((x) => x.bookmaker === bookmaker);

  const result: SmokeResult = {
    bookmaker,
    league,
    status: o?.status ?? null,
    matches: o?.matchesFound ?? 0,
    marketsFound: o?.marketsFound ?? 0,
    marketsSaved: o?.marketsSaved ?? 0,
    marketsNormalized: null,
    minMarketsPerMatch: null,
    otherMarketShare: null,
    unknownSelectionShare: null,
    error: o ? o.error : run.errors.join("; ") || "no outcome recorded for the bookmaker",
    aborted: run.aborted,
    durationMs: Date.now() - startedAt,
  };

  const code = run.aborted === "db_unreachable" ? 3 : o && isOkRunStatus(o.status) ? 0 : 1;
  return { result, code };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  if (!isBookmaker(args.bookmaker) || !getScraper(args.bookmaker)) {
    console.error(`Unknown bookmaker: ${args.bookmaker}`);
    console.error(`Known: ${ALL_POLISH_BOOKMAKERS.join(", ")}`);
    return 2;
  }

  const startedAt = Date.now();
  try {
    const { result, code } = args.persist
      ? await persistRun(args.bookmaker, args.league, startedAt)
      : await dryRun(args.bookmaker, args.league, startedAt);
    console.log("SMOKE_RESULT " + JSON.stringify(result));
    return code;
  } finally {
    // Never let a failed close change the exit code of a finished smoke run.
    await closeAllBrowsers().catch((error) => console.error("smoke-bookmaker: closing browsers failed:", error));
  }
}

// Run only as the entry point: perf-smoke.ts imports scrapeOnce/summarizeDryRun from here.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      // Something other than the scrape broke (e.g. a normalizer threw): the bookmaker did not pass.
      console.error("smoke-bookmaker failed:", error);
      process.exit(1);
    },
  );
}
