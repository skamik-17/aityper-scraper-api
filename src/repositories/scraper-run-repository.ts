/**
 * Scraper Run Repository
 * Handles all database operations for scraper run logs
 */

import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { ScraperResult } from "../types/scraper.js";
import type { Database } from "../types/database.js";

// Row types for scraper_runs table
type ScraperRunRow = Database["public"]["Tables"]["scraper_runs"]["Row"];
type ScraperRunInsert = Database["public"]["Tables"]["scraper_runs"]["Insert"];

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
 * Insert multiple scraper run records from aggregated result
 */
export async function insertScraperRuns(
  leagueSlug: string,
  results: Map<PolishBookmaker, ScraperResult>
): Promise<void> {
  const supabase = getSupabase();

  const records: ScraperRunInsert[] = [];
  for (const [bookmaker, result] of results) {
    records.push({
      league_slug: leagueSlug,
      bookmaker,
      status: result.status,
      matches_found: result.data?.length || 0,
      markets_saved: 0, // Updated after saving
      error_message: result.error || null,
      started_at: result.timestamp.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: result.duration,
    });
  }

  const { error } = await supabase.from("scraper_runs").insert(records);

  if (error) {
    console.error("[ScraperRunRepository] Insert runs error:", error);
    throw error;
  }
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
 * Get runs grouped by time window (for summary view)
 */
export async function getRunsSummary(limit: number = 20, offset: number = 0) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("scraper_runs")
    .select("id, league_slug, bookmaker, status, matches_found, markets_saved, error_message, started_at, finished_at, duration_ms")
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[ScraperRunRepository] getRunsSummary error:", error);
    throw error;
  }

  // Group by time window (within 1 minute = same batch)
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

  // Helper to parse UTC timestamp from Supabase
  const parseUtcTimestamp = (ts: string | null) => {
    if (!ts) return null;
    const utcTs = ts.endsWith("Z") ? ts : `${ts}Z`;
    return new Date(utcTs);
  };

  // Generate batch ID from start time (minute-based grouping)
  const getBatchId = (startedAt: string, leagueSlug: string) => {
    const date = parseUtcTimestamp(startedAt);
    if (!date) return `unknown-${leagueSlug}`;
    // Round to minute
    date.setSeconds(0, 0);
    return `${date.toISOString()}-${leagueSlug}`;
  };

  for (const row of data || []) {
    const batchId = getBatchId(row.started_at, row.league_slug);
    
    if (!runsMap.has(batchId)) {
      const startedAt = parseUtcTimestamp(row.started_at);
      runsMap.set(batchId, {
        batchId,
        league: row.league_slug,
        startedAt: startedAt || new Date(),
        finishedAt: parseUtcTimestamp(row.finished_at),
        totalDurationMs: 0,
        results: [],
      });
    }

    const run = runsMap.get(batchId)!;
    run.results.push({
      bookmaker: row.bookmaker as PolishBookmaker,
      status: row.status,
      matchesFound: row.matches_found,
      marketsSaved: row.markets_saved,
      durationMs: row.duration_ms,
      error: row.error_message || undefined,
    });

    // Update max finished_at
    const finishedAt = parseUtcTimestamp(row.finished_at);
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
 * Get last successful scrape time
 */
export async function getLastSuccessfulScrapeTime(): Promise<Date | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("scraper_runs")
    .select("finished_at")
    .eq("status", "success")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  const timestamp = data[0].finished_at;
  if (!timestamp) return null;
  
  // Supabase returns UTC timestamp without 'Z' suffix, so we need to append it
  const utcTimestamp = timestamp.endsWith("Z") ? timestamp : `${timestamp}Z`;
  return new Date(utcTimestamp);
}

/**
 * Get average scrape duration per bookmaker
 */
export async function getAverageScrapeDurations(): Promise<
  Map<PolishBookmaker, number>
> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("scraper_runs")
    .select("bookmaker, duration_ms")
    .eq("status", "success")
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
