#!/usr/bin/env npx tsx
/**
 * Cross-bookmaker match audit — RAW ground-truth capture.
 *
 * Re-scrapes the full offer of ONE match from every bookmaker that has data for
 * it and writes a raw bundle: the exact market names, parameter values, selection
 * labels and odds as published by the bookmaker, before any normalization.
 *
 * The bundle is the ground truth the /audit-match judges compare our normalized
 * API response against: "does this market and every one of its selections really
 * exist on the bookmaker's page, with these odds?".
 *
 * Usage:
 *   npx tsx scripts/match-audit-raw-capture.ts --home Arsenal --away "Coventry City" --league premier-league
 *
 * Options:
 *   --bookmakers <a,b,c>   Restrict to these bookmakers (default: all with DB rows)
 *   --out <dir>            Output dir (default docs/match-audit/.tmp/raw)
 *   --concurrency <N>      Parallel scrapers (default 3)
 *   --reuse                Skip bookmakers already present in an existing bundle
 *
 * The last stdout line is a JSON summary consumed by the orchestrator.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabase } from "../src/config/database.js";
import { getNormalizedTeamName } from "../src/utils/team-matcher.js";
import type { PolishBookmaker } from "../src/config/index.js";
import type { FullMatchOffer } from "../src/types/full-offer.js";
import {
  scrapeOneMatchFullOffer,
  scrapedMarketsToRaw,
  dedupeRawMarkets,
  type FullOfferCapableScraper,
  type RawAuditMarket,
} from "../src/services/audit/scraper-audit-core.js";
import * as scrapers from "../src/scrapers/bookmakers/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SCRAPERS: Record<string, FullOfferCapableScraper> = {
  sts: scrapers.stsScraper as unknown as FullOfferCapableScraper,
  fortuna: scrapers.fortunaScraper as unknown as FullOfferCapableScraper,
  betclic: scrapers.betclicScraper as unknown as FullOfferCapableScraper,
  superbet: scrapers.superbetScraper as unknown as FullOfferCapableScraper,
  lvbet: scrapers.lvbetScraper as unknown as FullOfferCapableScraper,
  fuksiarz: scrapers.fuksiarzScraper as unknown as FullOfferCapableScraper,
  betfan: scrapers.betfanScraper as unknown as FullOfferCapableScraper,
  forbet: scrapers.forbetScraper as unknown as FullOfferCapableScraper,
  etoto: scrapers.etotoScraper as unknown as FullOfferCapableScraper,
  betters: scrapers.bettersScraper as unknown as FullOfferCapableScraper,
  lebull: scrapers.lebullScraper as unknown as FullOfferCapableScraper,
  betcris: scrapers.betcrisScraper as unknown as FullOfferCapableScraper,
  pzbuk: scrapers.pzbukScraper as unknown as FullOfferCapableScraper,
  totalbet: scrapers.totalbetScraper as unknown as FullOfferCapableScraper,
};

interface Args {
  home: string;
  away: string;
  league: string;
  bookmakers?: string[];
  out: string;
  concurrency: number;
  reuse: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  const home = get("--home");
  const away = get("--away");
  const league = get("--league");
  if (!home || !away || !league) {
    console.error(
      'Usage: --home <team> --away <team> --league <slug> [--bookmakers a,b] [--out <dir>] [--concurrency N] [--reuse]',
    );
    process.exit(1);
  }
  const bms = get("--bookmakers");
  return {
    home,
    away,
    league,
    bookmakers: bms ? bms.split(",").map((b) => b.trim()).filter(Boolean) : undefined,
    out: get("--out") ?? path.join(REPO_ROOT, "docs", "match-audit", ".tmp", "raw"),
    concurrency: Number(get("--concurrency") ?? 3),
    reuse: argv.includes("--reuse"),
  };
}

export interface RawBookmakerCapture {
  bookmaker: string;
  eventUrl: string | null;
  ok: boolean;
  error?: string;
  /** Team names as the bookmaker itself publishes them (post canonicalization). */
  homeTeam?: string;
  awayTeam?: string;
  scrapedAt?: string;
  marketCount: number;
  selectionCount: number;
  markets: RawAuditMarket[];
}

export interface RawBundle {
  schemaVersion: 1;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  capturedAt: string;
  bookmakers: Record<string, RawBookmakerCapture>;
}

/** Event URLs per bookmaker for this match, from the freshest DB rows. */
async function resolveEventUrls(matchId: string): Promise<Map<string, string>> {
  const sb = getSupabase();
  const urls = new Map<string, string>();
  const seenAt = new Map<string, string>();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb
      .from("odds")
      .select("bookmaker, event_url, scraped_at")
      .eq("match_id", matchId)
      .range(from, from + page - 1);
    if (error) throw new Error(`DB: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.event_url) continue;
      const prev = seenAt.get(row.bookmaker);
      if (prev && prev >= row.scraped_at) continue;
      seenAt.set(row.bookmaker, row.scraped_at);
      urls.set(row.bookmaker, row.event_url);
    }
    if (data.length < page) break;
    from += page;
  }
  return urls;
}

async function captureOne(
  bookmaker: string,
  league: string,
  eventUrl: string | null,
  hint: { home: string; away: string },
): Promise<RawBookmakerCapture> {
  const scraper = SCRAPERS[bookmaker];
  if (!scraper) {
    return { bookmaker, eventUrl, ok: false, error: "no scraper registered", marketCount: 0, selectionCount: 0, markets: [] };
  }
  try {
    const offer: FullMatchOffer | null = await scrapeOneMatchFullOffer(
      scraper,
      league,
      eventUrl ?? "",
      hint,
    );
    if (!offer) {
      return { bookmaker, eventUrl, ok: false, error: "match not found in full offer", marketCount: 0, selectionCount: 0, markets: [] };
    }
    const markets = dedupeRawMarkets(scrapedMarketsToRaw(offer.markets));
    return {
      bookmaker,
      eventUrl: offer.eventUrl ?? eventUrl,
      ok: true,
      homeTeam: offer.homeTeam,
      awayTeam: offer.awayTeam,
      scrapedAt: new Date(offer.scrapedAt).toISOString(),
      marketCount: markets.length,
      selectionCount: markets.reduce((n, m) => n + m.selections.length, 0),
      markets,
    };
  } catch (err) {
    return {
      bookmaker,
      eventUrl,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      marketCount: 0,
      selectionCount: 0,
      markets: [],
    };
  }
}

/** Run tasks with a fixed concurrency cap, preserving input order in the result. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const homeNorm = getNormalizedTeamName(args.home, args.league);
  const awayNorm = getNormalizedTeamName(args.away, args.league);
  const matchId = `${args.league}:${homeNorm}:${awayNorm}`;
  const matchIdSafe = matchId.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

  const urls = await resolveEventUrls(matchId);
  const targets = args.bookmakers ?? [...urls.keys()].sort();
  if (targets.length === 0) {
    console.error(`[raw-capture] No bookmakers with DB rows for ${matchId}.`);
  }

  fs.mkdirSync(args.out, { recursive: true });
  const outputPath = path.join(args.out, `${matchIdSafe}.json`);

  let existing: RawBundle | null = null;
  if (args.reuse && fs.existsSync(outputPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outputPath, "utf-8")) as RawBundle;
    } catch {
      existing = null;
    }
  }

  const todo = targets.filter(
    (bm) => !(args.reuse && existing?.bookmakers?.[bm]?.ok),
  );
  console.error(
    `[raw-capture] ${matchId}: ${targets.length} bookmakers (${todo.length} to scrape, concurrency ${args.concurrency})`,
  );

  const captured = await pooled(todo, args.concurrency, async (bm) => {
    const started = Date.now();
    const res = await captureOne(bm, args.league, urls.get(bm) ?? null, {
      home: args.home,
      away: args.away,
    });
    console.error(
      `[raw-capture] ${bm}: ${res.ok ? `${res.marketCount} markets / ${res.selectionCount} selections` : `FAILED (${res.error})`} in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    return res;
  });

  const bookmakers: Record<string, RawBookmakerCapture> = { ...(existing?.bookmakers ?? {}) };
  for (const c of captured) bookmakers[c.bookmaker] = c;

  const bundle: RawBundle = {
    schemaVersion: 1,
    matchId,
    homeTeam: args.home,
    awayTeam: args.away,
    league: args.league,
    capturedAt: new Date().toISOString(),
    bookmakers,
  };
  fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 1));

  const okList = Object.values(bookmakers).filter((b) => b.ok);
  console.log(
    JSON.stringify({
      outputPath,
      matchId,
      bookmakers: Object.keys(bookmakers).sort(),
      ok: okList.map((b) => b.bookmaker).sort(),
      failed: Object.values(bookmakers)
        .filter((b) => !b.ok)
        .map((b) => ({ bookmaker: b.bookmaker, error: b.error })),
      totalRawMarkets: okList.reduce((n, b) => n + b.marketCount, 0),
      totalRawSelections: okList.reduce((n, b) => n + b.selectionCount, 0),
    }),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[raw-capture] fatal:", err);
  process.exit(1);
});
