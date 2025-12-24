/**
 * Scraper Run Repository
 * Handles all database operations for scraper run logs
 */

import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { ScraperResult } from "../types/scraper.js";

export interface ScraperRunRecord {
  runId: string;
  leagueSlug: string;
  bookmaker: PolishBookmaker;
  status: string;
  matchesFound: number;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

/**
 * Insert a scraper run record
 */
export async function insertScraperRun(record: ScraperRunRecord): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("scraper_runs").insert({
    run_id: record.runId,
    league_slug: record.leagueSlug,
    bookmaker: record.bookmaker,
    status: record.status,
    matches_found: record.matchesFound,
    error_message: record.errorMessage,
    started_at: record.startedAt.toISOString(),
    completed_at: record.completedAt.toISOString(),
    duration_ms: record.durationMs,
  });

  if (error) {
    console.error("[ScraperRunRepository] Insert error:", error);
    throw error;
  }
}

/**
 * Insert multiple scraper run records from aggregated result
 */
export async function insertScraperRuns(
  runId: string,
  leagueSlug: string,
  results: Map<PolishBookmaker, ScraperResult>
): Promise<void> {
  const supabase = getSupabase();

  const records = [];
  for (const [bookmaker, result] of results) {
    records.push({
      run_id: runId,
      league_slug: leagueSlug,
      bookmaker,
      status: result.status,
      matches_found: result.data?.length || 0,
      error_message: result.error || null,
      started_at: result.timestamp.toISOString(),
      completed_at: new Date().toISOString(),
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
) {
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
 * Get runs grouped by run_id
 */
export async function getRunsSummary(limit: number = 20, offset: number = 0) {
  const supabase = getSupabase();

  // Get distinct run_ids with their stats
  const { data, error } = await supabase
    .from("scraper_runs")
    .select("run_id, league_slug, bookmaker, status, matches_found, error_message, started_at, completed_at, duration_ms")
    .order("started_at", { ascending: false });

  if (error) {
    console.error("[ScraperRunRepository] getRunsSummary error:", error);
    throw error;
  }

  // Group by run_id
  const runsMap = new Map<
    string,
    {
      runId: string;
      league: string;
      startedAt: Date;
      completedAt: Date;
      totalDurationMs: number;
      results: Array<{
        bookmaker: PolishBookmaker;
        status: string;
        matchesFound: number;
        durationMs: number;
        error?: string;
      }>;
    }
  >();

  for (const row of data || []) {
    if (!runsMap.has(row.run_id)) {
      runsMap.set(row.run_id, {
        runId: row.run_id,
        league: row.league_slug,
        startedAt: new Date(row.started_at),
        completedAt: new Date(row.completed_at),
        totalDurationMs: 0,
        results: [],
      });
    }

    const run = runsMap.get(row.run_id)!;
    run.results.push({
      bookmaker: row.bookmaker as PolishBookmaker,
      status: row.status,
      matchesFound: row.matches_found,
      durationMs: row.duration_ms,
      error: row.error_message || undefined,
    });

    // Update max completed_at
    const completedAt = new Date(row.completed_at);
    if (completedAt > run.completedAt) {
      run.completedAt = completedAt;
    }
    run.totalDurationMs = Math.max(run.totalDurationMs, row.duration_ms);
  }

  // Convert to array and paginate
  const runs = Array.from(runsMap.values()).slice(offset, offset + limit);

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
    .select("completed_at")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  return new Date(data[0].completed_at);
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
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[ScraperRunRepository] getAverageScrapeDurations error:", error);
    return new Map();
  }

  // Calculate averages
  const totals = new Map<PolishBookmaker, { sum: number; count: number }>();

  for (const row of data || []) {
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
