/**
 * Scraper Run Repository
 * Handles all database operations for scraper run logs
 */

import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { Database } from "../types/database.js";
import { formatDbError, OK_RUN_STATUSES, type BookmakerRunOutcome } from "../services/run-outcome.js";
import { parseDbTimestamp } from "../utils/db-timestamp.js";

// Row types for scraper_runs table
export type ScraperRunRow = Database["public"]["Tables"]["scraper_runs"]["Row"];
export type ScraperRunInsert = Database["public"]["Tables"]["scraper_runs"]["Insert"];

/**
 * A scraper_runs insert row with every outcome field present. Required<> drops
 * the `?` of the Insert type, so the row is also usable wherever a read row
 * (RunRowLike) is expected, e.g. when merging in-memory history with DB rows.
 */
export type ScraperRunOutcomeRow = Required<
  Pick<
    ScraperRunInsert,
    | "run_id"
    | "bookmaker"
    | "league_slug"
    | "status"
    | "matches_found"
    | "markets_found"
    | "markets_saved"
    | "error_message"
    | "started_at"
    | "finished_at"
    | "duration_ms"
  >
>;

const MAX_ERROR_MESSAGE_LENGTH = 2000;
const MIGRATION_11 = "supabase/migrations/11_scraper_runs_observability.sql";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Bounded copy of an error text that never ends on half of a surrogate pair. */
function truncateErrorMessage(error: string): string {
  const cut = error.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Valid Date for a DB timestamp, or null. */
function parseOptionalTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const date = parseDbTimestamp(ts);
  return isNaN(date.getTime()) ? null : date;
}

export interface ScraperRunRecord {
  leagueSlug: string;
  bookmaker: PolishBookmaker;
  status: string;
  matchesFound: number;
  marketsSaved: number;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
}

/**
 * Insert a scraper run record
 */
export async function insertScraperRun(record: ScraperRunRecord): Promise<number> {
  const supabase = getSupabase();

  const insertData: ScraperRunInsert = {
    league_slug: record.leagueSlug,
    bookmaker: record.bookmaker,
    status: record.status,
    matches_found: record.matchesFound,
    markets_saved: record.marketsSaved,
    error_message: record.errorMessage,
    started_at: record.startedAt.toISOString(),
    finished_at: record.finishedAt?.toISOString() ?? null,
    duration_ms: record.durationMs,
  };

  const { data, error } = await supabase
    .from("scraper_runs")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    console.error("[ScraperRunRepository] Insert error:", error);
    throw error;
  }

  return data.id;
}

/**
 * Update a scraper run with completion data
 */
export async function updateScraperRun(
  id: number,
  updates: {
    status: string;
    matchesFound?: number;
    marketsSaved?: number;
    errorMessage?: string | null;
    finishedAt: Date;
    durationMs: number;
  }
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from("scraper_runs")
    .update({
      status: updates.status,
      matches_found: updates.matchesFound,
      markets_saved: updates.marketsSaved,
      error_message: updates.errorMessage,
      finished_at: updates.finishedAt.toISOString(),
      duration_ms: updates.durationMs,
    })
    .eq("id", id);

  if (error) {
    console.error("[ScraperRunRepository] Update error:", error);
    throw error;
  }
}

/**
 * One scraper_runs row per bookmaker run outcome
 */
export function toScraperRunInsert(o: BookmakerRunOutcome): ScraperRunOutcomeRow {
  return {
    run_id: o.runId,
    bookmaker: o.bookmaker,
    league_slug: o.league,
    status: o.status,
    matches_found: o.matchesFound,
    markets_found: o.marketsFound,
    markets_saved: o.marketsSaved,
    error_message: o.error === null ? null : truncateErrorMessage(o.error),
    started_at: o.startedAt.toISOString(),
    finished_at: o.finishedAt.toISOString(),
    duration_ms: o.durationMs,
  };
}

/**
 * Insert the outcomes of one run in a single call.
 * Throws an Error whose message carries the formatted DB cause; a missing
 * column (PGRST204) means migration 11 is not applied, so the message names it.
 */
export async function insertBookmakerRunOutcomes(outcomes: BookmakerRunOutcome[]): Promise<void> {
  if (outcomes.length === 0) return;

  let error: unknown;
  try {
    ({ error } = await getSupabase().from("scraper_runs").insert(outcomes.map(toScraperRunInsert)));
  } catch (thrown) {
    error = thrown;
  }
  if (!error) return;

  const code = typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  const hint = code === "PGRST204" ? ` (apply ${MIGRATION_11})` : "";
  throw new Error(`scraper_runs insert failed: ${formatDbError(error)}${hint}`);
}

/**
 * Newest scraper_runs rows of one league (started_at desc).
 * Throws an Error with the formatted DB cause, so callers can fall back.
 */
export async function getRecentRunRows(leagueSlug: string, limit: number): Promise<ScraperRunRow[]> {
  const { data, error } = await getSupabase()
    .from("scraper_runs")
    .select("*")
    .eq("league_slug", leagueSlug)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`scraper_runs read failed: ${formatDbError(error)}`);
  }

  return data ?? [];
}

/**
 * Delete scraper_runs rows that started more than `days` days before `now`
 * (owner decision B11: keep 30 days). Returns the number of deleted rows.
 */
export async function deleteScraperRunsOlderThan(days: number = 30, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();

  const { error, count } = await getSupabase()
    .from("scraper_runs")
    .delete({ count: "exact" })
    .lt("started_at", cutoff);

  if (error) {
    throw new Error(`scraper_runs prune failed: ${formatDbError(error)}`);
  }

  return count ?? 0;
}

/**
 * Get recent scraper runs
 */
export async function getRecentRuns(
  limit: number = 20,
  offset: number = 0,
  statusFilter?: string
): Promise<ScraperRunRow[]> {
  const supabase = getSupabase();

  let query = supabase
    .from("scraper_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[ScraperRunRepository] getRecentRuns error:", error);
    throw error;
  }

  return data || [];
}

/**
 * Get runs grouped by run (for summary view)
 */
export async function getRunsSummary(limit: number = 20, offset: number = 0) {
  const supabase = getSupabase();

  // `*`, not a column list: naming run_id makes PostgREST reject the whole
  // query (42703) on a DB without migration 11, while `*` just returns rows
  // without the key, which the minute-bucket fallback below groups.
  const { data, error } = await supabase
    .from("scraper_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[ScraperRunRepository] getRunsSummary error:", error);
    throw error;
  }

  // Group by run_id; rows written before migration 11 have none and fall back
  // to a time window (within 1 minute = same batch)
  const runsMap = new Map<
    string,
    {
      batchId: string;
      league: string;
      startedAt: Date;
      finishedAt: Date | null;
      totalDurationMs: number;
      results: Array<{
        bookmaker: PolishBookmaker;
        status: string;
        matchesFound: number;
        marketsSaved: number;
        durationMs: number | null;
        error?: string;
      }>;
    }
  >();

  // Generate batch ID from start time (minute-based grouping)
  const getMinuteBatchId = (startedAt: string, leagueSlug: string) => {
    const date = parseOptionalTimestamp(startedAt);
    if (!date) return `unknown-${leagueSlug}`;
    // Round to minute
    date.setUTCSeconds(0, 0);
    return `${date.toISOString()}-${leagueSlug}`;
  };

  for (const row of data || []) {
    const batchId = row.run_id ?? getMinuteBatchId(row.started_at, row.league_slug);

    if (!runsMap.has(batchId)) {
      runsMap.set(batchId, {
        batchId,
        league: row.league_slug,
        startedAt: parseOptionalTimestamp(row.started_at) || new Date(),
        finishedAt: null,
        totalDurationMs: 0,
        results: [],
      });
    }

    const run = runsMap.get(batchId)!;

    // The DB returns started_at desc, so the earliest start is usually the last row seen
    const startedAt = parseOptionalTimestamp(row.started_at);
    if (startedAt && startedAt < run.startedAt) {
      run.startedAt = startedAt;
    }
    run.results.push({
      bookmaker: row.bookmaker as PolishBookmaker,
      status: row.status,
      matchesFound: row.matches_found,
      marketsSaved: row.markets_saved,
      durationMs: row.duration_ms,
      error: row.error_message || undefined,
    });

    // Update max finished_at
    const finishedAt = parseOptionalTimestamp(row.finished_at);
    if (finishedAt && (!run.finishedAt || finishedAt > run.finishedAt)) {
      run.finishedAt = finishedAt;
    }
    run.totalDurationMs = Math.max(run.totalDurationMs, row.duration_ms || 0);
  }

  // Convert to array
  const runs = Array.from(runsMap.values());

  return {
    runs,
    total: runsMap.size,
  };
}

/**
 * Get the finish time of the newest OK run (success or partial), for one
 * league or, without a league, across all leagues. Null on a DB error.
 */
export async function getLastSuccessfulScrapeTime(leagueSlug?: string): Promise<Date | null> {
  const supabase = getSupabase();

  let query = supabase
    .from("scraper_runs")
    .select("finished_at")
    .in("status", OK_RUN_STATUSES)
    .not("finished_at", "is", null);

  if (leagueSlug) {
    query = query.eq("league_slug", leagueSlug);
  }

  const { data, error } = await query.order("finished_at", { ascending: false }).limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  // PostgREST returns timestamptz with an offset (+00:00)
  return parseOptionalTimestamp(data[0].finished_at);
}

/**
 * Get average scrape duration per bookmaker (OK runs only)
 */
export async function getAverageScrapeDurations(): Promise<
  Map<PolishBookmaker, number>
> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("scraper_runs")
    .select("bookmaker, duration_ms")
    .in("status", OK_RUN_STATUSES)
    .not("duration_ms", "is", null)
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[ScraperRunRepository] getAverageScrapeDurations error:", error);
    return new Map();
  }

  // Calculate averages
  const totals = new Map<PolishBookmaker, { sum: number; count: number }>();

  for (const row of data || []) {
    if (row.duration_ms === null) continue;
    const bm = row.bookmaker as PolishBookmaker;
    const current = totals.get(bm) || { sum: 0, count: 0 };
    current.sum += row.duration_ms;
    current.count += 1;
    totals.set(bm, current);
  }

  const averages = new Map<PolishBookmaker, number>();
  for (const [bm, { sum, count }] of totals) {
    averages.set(bm, Math.round(sum / count));
  }

  return averages;
}
