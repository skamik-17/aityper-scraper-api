/**
 * Bookmaker status from run history plus per-bookmaker odds freshness.
 *
 * A bookmaker whose latest run failed is `error`, even while its older odds
 * are still recent. Otherwise it is `available` when its last OK run or its
 * newest odds row is recent enough, and `stale` when neither is.
 * `getBookmakerStatusSnapshot()` is the single source for the status served by
 * the API and the CLI; it never throws.
 */
import { CONFIG, type PolishBookmaker } from "../config/index.js";
import type { BookmakerStatus } from "../types/database.js";
import {
  getLastSuccessfulScrapeTime,
  getRecentRunRows,
  type ScraperRunRow,
} from "../repositories/scraper-run-repository.js";
import { getOddsFreshnessByBookmaker } from "../repositories/odds-repository.js";
import { parseDbTimestamp } from "../utils/db-timestamp.js";
import { isOkRunStatus } from "./run-outcome.js";

/** The scraper_runs fields a summary needs. Both DB rows and in-memory outcome rows fit. */
export type RunRowLike = Pick<
  ScraperRunRow,
  "run_id" | "bookmaker" | "status" | "started_at" | "finished_at" | "error_message" | "matches_found" | "markets_saved"
>;

export interface BookmakerRunSummary {
  bookmaker: PolishBookmaker;
  /** Status, start, error and counts of the newest run. */
  lastStatus: string | null;
  lastRunAt: string | null;
  /** finished_at (else started_at) of the newest OK run. */
  lastSuccessAt: string | null;
  /** Leading non-OK runs, newest first; failingSince is the start of the oldest of them. */
  consecutiveFailures: number;
  failingSince: string | null;
  lastError: string | null;
  lastMatchesFound: number;
  lastMarketsSaved: number;
  /** Failed runs directly behind the newest run, counted only when that run is OK. */
  recoveredAfterFailures: number;
}

export interface BookmakerHealthMeta {
  status: BookmakerStatus;
  lastSuccessAt: string | null;
  failingSince: string | null;
  consecutiveFailures: number;
}

export interface BookmakerStatusSnapshot {
  /** odds_only: scraper_runs could not be read, so statuses come from odds freshness alone. */
  source: "scraper_runs" | "odds_only";
  status: Record<PolishBookmaker, BookmakerStatus>;
  health: Record<PolishBookmaker, BookmakerHealthMeta>;
  summaries: Map<PolishBookmaker, BookmakerRunSummary>;
  lastOddsAt: Map<PolishBookmaker, Date>;
  /** Finish time of the league's newest OK run. */
  lastSuccessfulRunAt: string | null;
}

/** Runs per bookmaker in the status window: 50 * 14 = 700 rows, below PostgREST max_rows (1000). */
export const STATUS_WINDOW_RUNS = 50;

/** A bookmaker turns stale after missing one run: twice the interval, at least an hour. */
export function staleAfterMs(intervalMinutes: number): number {
  return Math.max(2 * intervalMinutes, 60) * 60 * 1000;
}

function toIso(ts: string): string {
  return parseDbTimestamp(ts).toISOString();
}

function rowKey(r: RunRowLike): string {
  return `${r.bookmaker}|${r.run_id ?? toIso(r.started_at)}`;
}

/**
 * All primary rows, plus the secondary rows of runs the primary does not have.
 * The in-memory history goes first: it always holds the current run, even when
 * the scraper_runs insert failed.
 */
export function mergeRunRows(primary: RunRowLike[], secondary: RunRowLike[]): RunRowLike[] {
  const seen = new Set(primary.map(rowKey));
  return [...primary, ...secondary.filter((r) => !seen.has(rowKey(r)))];
}

function summarizeRows(bookmaker: PolishBookmaker, newestFirst: RunRowLike[]): BookmakerRunSummary {
  const newest = newestFirst[0];

  let consecutiveFailures = 0;
  while (consecutiveFailures < newestFirst.length && !isOkRunStatus(newestFirst[consecutiveFailures].status)) {
    consecutiveFailures++;
  }

  const lastOk = newestFirst.find((r) => isOkRunStatus(r.status));

  let recoveredAfterFailures = 0;
  if (isOkRunStatus(newest.status)) {
    while (
      recoveredAfterFailures + 1 < newestFirst.length &&
      !isOkRunStatus(newestFirst[recoveredAfterFailures + 1].status)
    ) {
      recoveredAfterFailures++;
    }
  }

  return {
    bookmaker,
    lastStatus: newest.status,
    lastRunAt: toIso(newest.started_at),
    lastSuccessAt: lastOk ? toIso(lastOk.finished_at ?? lastOk.started_at) : null,
    consecutiveFailures,
    failingSince: consecutiveFailures > 0 ? toIso(newestFirst[consecutiveFailures - 1].started_at) : null,
    lastError: newest.error_message,
    lastMatchesFound: newest.matches_found ?? 0,
    lastMarketsSaved: newest.markets_saved ?? 0,
    recoveredAfterFailures,
  };
}

/** One summary per listed bookmaker that has at least one row. */
export function summarizeBookmakerRuns(
  rows: RunRowLike[],
  bookmakers: readonly PolishBookmaker[],
): Map<PolishBookmaker, BookmakerRunSummary> {
  const byBookmaker = new Map<string, Array<{ row: RunRowLike; at: number }>>();
  for (const row of rows) {
    const list = byBookmaker.get(row.bookmaker) ?? [];
    list.push({ row, at: parseDbTimestamp(row.started_at).getTime() });
    byBookmaker.set(row.bookmaker, list);
  }

  const summaries = new Map<PolishBookmaker, BookmakerRunSummary>();
  for (const bookmaker of bookmakers) {
    const list = byBookmaker.get(bookmaker);
    if (!list || list.length === 0) continue;
    const newestFirst = list.sort((a, b) => b.at - a.at).map((e) => e.row);
    summaries.set(bookmaker, summarizeRows(bookmaker, newestFirst));
  }
  return summaries;
}

export function deriveBookmakerStatus(
  s: BookmakerRunSummary | undefined,
  lastOddsAt: Date | null,
  now: Date,
  staleAfter: number,
): BookmakerStatus {
  if (s && s.consecutiveFailures > 0) return "error";

  const times = [s?.lastSuccessAt ? Date.parse(s.lastSuccessAt) : NaN, lastOddsAt?.getTime() ?? NaN].filter((t) =>
    Number.isFinite(t),
  );
  if (times.length === 0) return "stale";
  return now.getTime() - Math.max(...times) <= staleAfter ? "available" : "stale";
}

const STATUS_PRIORITY: Record<BookmakerStatus, number> = { available: 0, stale: 1, error: 2 };

/** error > stale > available */
export function worstBookmakerStatus(a: BookmakerStatus | undefined, b: BookmakerStatus): BookmakerStatus {
  if (a === undefined) return b;
  return STATUS_PRIORITY[b] > STATUS_PRIORITY[a] ? b : a;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Status and health of every configured bookmaker from already-read inputs.
 * Exported so the route-test fixtures assemble the snapshot exactly as production does.
 */
export function buildSnapshot(
  source: BookmakerStatusSnapshot["source"],
  summaries: Map<PolishBookmaker, BookmakerRunSummary>,
  lastOddsAt: Map<PolishBookmaker, Date>,
  freshnessKnown: boolean,
  lastSuccessfulRunAt: string | null,
  now: Date,
  staleAfter: number = staleAfterMs(CONFIG.SCRAPE_INTERVAL_MINUTES),
): BookmakerStatusSnapshot {
  const status = {} as Record<PolishBookmaker, BookmakerStatus>;
  const health = {} as Record<PolishBookmaker, BookmakerHealthMeta>;

  for (const bm of CONFIG.BOOKMAKERS) {
    const s = summaries.get(bm);
    // Unknown freshness keeps today's fallback: every bookmaker stale.
    const st = freshnessKnown ? deriveBookmakerStatus(s, lastOddsAt.get(bm) ?? null, now, staleAfter) : "stale";
    status[bm] = st;
    health[bm] = {
      status: st,
      lastSuccessAt: s?.lastSuccessAt ?? null,
      failingSince: s?.failingSince ?? null,
      consecutiveFailures: s?.consecutiveFailures ?? 0,
    };
  }

  return { source, status, health, summaries, lastOddsAt, lastSuccessfulRunAt };
}

/**
 * Status of every configured bookmaker in one league. Three reads run in
 * parallel; each failure degrades the snapshot instead of failing it:
 * no run history -> `odds_only`, unknown freshness -> all `stale`.
 */
export async function getBookmakerStatusSnapshot(leagueSlug: string, now: Date = new Date()): Promise<BookmakerStatusSnapshot> {
  const [runs, freshness, lastSuccess] = await Promise.allSettled([
    getRecentRunRows(leagueSlug, STATUS_WINDOW_RUNS * CONFIG.BOOKMAKERS.length),
    getOddsFreshnessByBookmaker(leagueSlug, CONFIG.BOOKMAKERS),
    getLastSuccessfulScrapeTime(leagueSlug),
  ]);

  const lastSuccessAt = lastSuccess.status === "fulfilled" ? lastSuccess.value : null;
  const lastSuccessfulRunAt = lastSuccessAt && !isNaN(lastSuccessAt.getTime()) ? lastSuccessAt.toISOString() : null;
  const lastOddsAt = freshness.status === "fulfilled" ? freshness.value : new Map<PolishBookmaker, Date>();
  const freshnessKnown = freshness.status === "fulfilled";
  if (!freshnessKnown) {
    console.warn(`[BookmakerStatus] odds freshness unavailable for ${leagueSlug}, all stale: ${reason(freshness.reason)}`);
  }

  if (runs.status === "rejected") {
    console.warn(`[BookmakerStatus] scraper_runs unavailable for ${leagueSlug}, using odds freshness only: ${reason(runs.reason)}`);
    return buildSnapshot("odds_only", new Map(), lastOddsAt, freshnessKnown, lastSuccessfulRunAt, now);
  }

  try {
    const summaries = summarizeBookmakerRuns(runs.value, CONFIG.BOOKMAKERS);
    return buildSnapshot("scraper_runs", summaries, lastOddsAt, freshnessKnown, lastSuccessfulRunAt, now);
  } catch (error) {
    // A row the summary cannot read (e.g. an unparseable timestamp) must not take the API down.
    console.warn(`[BookmakerStatus] scraper_runs rows unusable for ${leagueSlug}, using odds freshness only: ${reason(error)}`);
    return buildSnapshot("odds_only", new Map(), lastOddsAt, freshnessKnown, lastSuccessfulRunAt, now);
  }
}
