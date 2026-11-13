#!/usr/bin/env npx tsx
/**
 * Betby (betters, lebull) live smoke test.
 *
 * Scrapes one league's full offer with the real browserless Betby scraper (plain HTTP to the
 * brand's Betby API; no browser, no DB, no running server), normalizes every match the way
 * the service does before saving (scrape-helpers.ts), and judges the result with the
 * acceptance gate of docs/superpowers/plans/2026-11-06-scraper-recovery/betby-betters-lebull.md
 * (src/scrapers/shared/betby/smoke-gate.ts):
 *   A1  every upcoming match of the snapshot was scraped (matches = snapshot)
 *   A2  every match within --max-days with a full event payload has >= --min-markets
 *       normalized non-OTHER markets; at most --max-listing-only of those matches fell back
 *       to listing markets. Matches further out are reported as shallow and do not gate.
 *   A3  no UNKNOWN selection in a non-OTHER market, no price below 1.01
 *   A4  with --compare-api: every MATCH_WINNER price within --max-1x2-dev of the median of
 *       at least 3 other bookmakers (betters and lebull are never peers)
 *   A5  with --compare-api: every match is listed by the odds API under the same canonical
 *       home and away names
 *   A8  the scrape took less than 15 s
 *
 * Output: one line per scraped match and one "SMOKE ..." summary line, followed by one
 * "  reason: ..." line per failed rule. Exit 0 on PASS or SKIP (no upcoming match in the
 * snapshot), 1 on FAIL or when the smoke could not run, 2 on bad arguments.
 *
 * Usage:
 *   npx tsx scripts/betby-smoke.ts --bookmaker betters --league premier-league
 *   npx tsx scripts/betby-smoke.ts --bookmaker lebull --league premier-league --compare-api http://localhost:3001
 */
import { getBookmakerLeagueId } from "../src/config/leagues.js";
import { bettersScraper } from "../src/scrapers/bookmakers/betters/index.js";
import { lebullScraper } from "../src/scrapers/bookmakers/lebull/index.js";
import { selectLeagueEvents } from "../src/scrapers/shared/betby/parser.js";
import type { BetbyScraper } from "../src/scrapers/shared/betby/scraper.js";
import {
  evaluateSmoke,
  formatPct,
  indexOddsList,
  isGated,
  marketStats,
  matchWinnerDeviation,
  oddsListKey,
  type OddsListMatch,
  type SmokeGateOptions,
  type SmokeMatchRow,
} from "../src/scrapers/shared/betby/smoke-gate.js";
import type { BetbyBookmaker } from "../src/scrapers/shared/betby/types.js";
import { bettersNormalizer } from "../src/services/normalization/bookmakers/betters-normalizer.js";
import { lebullNormalizer } from "../src/services/normalization/bookmakers/lebull-normalizer.js";
import { getNormalizerForBookmaker, normalizeMarketsForBookmaker } from "../src/services/normalization/index.js";
import type { BookmakerMarketNormalizer } from "../src/services/normalization/types.js";
import type { FullMatchOffer, ScrapedMarket } from "../src/types/full-offer.js";

/** A8: wall clock of scrapeFullOffer. */
const MAX_DURATION_MS = 15_000;
const COMPARE_API_TIMEOUT_MS = 30_000;

const BRANDS: Record<BetbyBookmaker, { scraper: BetbyScraper; normalizer: BookmakerMarketNormalizer }> = {
  betters: { scraper: bettersScraper, normalizer: bettersNormalizer },
  lebull: { scraper: lebullScraper, normalizer: lebullNormalizer },
};

const USAGE = `Usage: npx tsx scripts/betby-smoke.ts --bookmaker <betters|lebull> --league <slug> [options]

  --compare-api <url>       odds API for A4/A5, e.g. http://localhost:3001 (one GET /api/odds?league=)
  --max-days <n>            depth gate horizon in days (default 7)
  --min-markets <n>         normalized non-OTHER markets per gated full match (default 50)
  --max-listing-only <n>    gated matches allowed to fall back to listing markets (default 1)
  --max-1x2-dev <ratio>     MATCH_WINNER deviation from the peer median (default 0.10)

Calls the brand's Betby API over plain HTTP; never opens a browser or writes to the DB.
Exit 0 on PASS or SKIP, 1 on FAIL, 2 on bad arguments.`;

interface Args {
  bookmaker: BetbyBookmaker;
  league: string;
  compareApi?: string;
  gate: Omit<SmokeGateOptions, "nowMs" | "maxDurationMs">;
}

function usageError(message: string): never {
  console.error(`[betby-smoke] ${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  const num = (flag: string, fallback: number): number => {
    const raw = get(flag);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0) usageError(`${flag} must be a number >= 0 (got "${raw}")`);
    return value;
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  const bookmaker = get("--bookmaker");
  if (bookmaker !== "betters" && bookmaker !== "lebull") usageError(`--bookmaker must be betters or lebull (got "${bookmaker ?? ""}")`);
  const league = get("--league");
  if (league === undefined) usageError("--league is required");
  return {
    bookmaker,
    league,
    compareApi: get("--compare-api"),
    gate: {
      maxDays: num("--max-days", 7),
      minMarkets: num("--min-markets", 50),
      maxListingOnly: num("--max-listing-only", 1),
      max1x2Dev: num("--max-1x2-dev", 0.1),
    },
  };
}

/** `GET <api>/api/odds?league=` indexed by canonical home/away; throws when it cannot be read. */
async function fetchOddsList(baseUrl: string, league: string): Promise<Map<string, OddsListMatch>> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/odds?league=${encodeURIComponent(league)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(COMPARE_API_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`--compare-api: HTTP ${response.status} from ${url}`);
  const index = indexOddsList(await response.json());
  console.log(`[betby-smoke] compare-api: ${index.size} matches from ${url}`);
  return index;
}

/**
 * Normalizes one match like the service does before saving. The facade's per-market
 * "mapped to OTHER" warning (well over a hundred per match) is muted; every other
 * warning, such as the Betby normalizer's specifier-shape skip, still prints.
 */
function normalizeQuietly(match: FullMatchOffer, bookmaker: BetbyBookmaker, league: string): ScrapedMarket[] {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[Normalizer] Market mapped to OTHER")) return;
    warn(...args);
  };
  try {
    return normalizeMarketsForBookmaker(match.markets, bookmaker, match.homeTeam, match.awayTeam, league);
  } finally {
    console.warn = warn;
  }
}

/** `h/d/a` of the normalized MATCH_WINNER, `-` for a missing side. */
function oneXTwo(normalized: ScrapedMarket[]): string {
  const market = normalized.find((m) => m.normalizedType === "MATCH_WINNER");
  return ["HOME", "DRAW", "AWAY"]
    .map((code) => market?.selections.find((s) => s.normalizedName === code)?.odds ?? "-")
    .join("/");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { bookmaker, league } = args;
  const { scraper, normalizer } = BRANDS[bookmaker];

  // The service normalizes through the facade; make sure it routes to the Betby normalizer.
  if (getNormalizerForBookmaker(bookmaker) !== normalizer) {
    throw new Error(`the normalizer registered for ${bookmaker} is not the Betby normalizer`);
  }
  const tournamentId = getBookmakerLeagueId(league, bookmaker);
  if (typeof tournamentId !== "string") usageError(`no Betby tournament id for league "${league}" on ${bookmaker}`);

  // Read the odds API first: when it is down, nothing has been asked of the bookmaker yet.
  const oddsList = args.compareApi !== undefined ? await fetchOddsList(args.compareApi, league) : null;

  const startedAt = Date.now();
  const result = await scraper.scrapeFullOffer(league);
  const durationMs = Date.now() - startedAt;
  if (!result.success) console.log(`[betby-smoke] scrapeFullOffer failed: ${result.error ?? "(no error message)"}`);
  const full = new Set(scraper.lastRunStats?.full ?? []);

  // The client caches the snapshot for 45 s, so this is the snapshot the scrape just used.
  const nowMs = Date.now();
  const snapshotCount = selectLeagueEvents(await scraper.client.fetchSnapshot(), tournamentId, nowMs).length;
  const options: SmokeGateOptions = { ...args.gate, nowMs, maxDurationMs: MAX_DURATION_MS };

  const rows: SmokeMatchRow[] = [];
  for (const match of result.matches) {
    const normalized = normalizeQuietly(match, bookmaker, league);
    const peerRow = oddsList?.get(oddsListKey(match.homeTeam, match.awayTeam));
    const row: SmokeMatchRow = {
      eventId: match.matchId,
      startTime: match.startTime ?? "",
      full: full.has(match.matchId),
      ...marketStats(normalized),
      apiFound: oddsList === null ? null : peerRow !== undefined,
      max1x2Dev: peerRow === undefined ? null : matchWinnerDeviation(normalized, peerRow),
    };
    rows.push(row);
    console.log(
      `${row.eventId} ${match.homeTeam} - ${match.awayTeam} start=${row.startTime}` +
        ` scope=${isGated(row.startTime, options) ? "gated" : "far"} markets=${match.markets.length}` +
        ` normalized=${row.normalized} unknownInMapped=${row.unknownInMapped} full=${row.full ? "yes" : "no"}` +
        ` 1x2=${oneXTwo(normalized)} dev=${formatPct(row.max1x2Dev)}` +
        ` api=${row.apiFound === null ? "n/a" : row.apiFound ? "found" : "missing"} url=${match.eventUrl}`,
    );
  }

  const verdict = evaluateSmoke(snapshotCount, rows, durationMs, options);
  const gatedRows = rows.filter((r) => isGated(r.startTime, options));
  const gatedFull = gatedRows.filter((r) => r.full).map((r) => r.normalized);
  const deviations = rows.map((r) => r.max1x2Dev).filter((d): d is number => d !== null);
  console.log(
    `SMOKE ${bookmaker} ${league}: matches=${rows.length} (snapshot=${snapshotCount}, gated=${verdict.gated}, shallow=${verdict.shallow})` +
      ` minNormalizedGated=${gatedFull.length > 0 ? Math.min(...gatedFull) : "n/a"}` +
      ` listingOnlyGated=${gatedRows.filter((r) => !r.full).length}` +
      ` unknownInMapped=${rows.reduce((n, r) => n + r.unknownInMapped, 0)}` +
      ` max1x2Dev=${formatPct(deviations.length > 0 ? Math.max(...deviations) : null)}` +
      ` durationMs=${durationMs} RESULT=${verdict.result}`,
  );
  for (const reason of verdict.reasons) console.log(`  reason: ${reason}`);

  process.exit(verdict.result === "FAIL" ? 1 : 0);
}

main().catch((err) => {
  console.error("[betby-smoke] FAILED:", err);
  process.exit(1);
});
