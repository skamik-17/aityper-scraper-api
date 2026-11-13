import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { Database, LatestOddsRow, OddsInsert } from "../types/database.js";
import { getCanonicalTeamName, getNormalizedTeamName } from "../utils/team-matcher.js";
import { fetchAllRows } from "../utils/supabase-pagination.js";
import { parseDbTimestamp } from "../utils/db-timestamp.js";
import { formatDbError } from "../services/run-outcome.js";

export interface AggregatedMatchOdds {
  match_id: string;
  home_team: string;
  away_team: string;
  start_time: string | null;
  markets: Record<string, {
    code: string;
    namePl: string;
    viewType: string;
    category: string;
    paramValue: string | null;
    bookmakerOdds: Record<string, {
      selections: any[];
      eventUrl: string | null;
      scrapedAt: string;
    }>;
  }>;
  last_updated: string;
}

export async function getAggregatedOdds(
  leagueSlug: string = "ekstraklasa",
  marketKeys?: string[]
): Promise<AggregatedMatchOdds[]> {
  const supabase = getSupabase();

  // p_market_keys prunes rows inside get_matches_with_odds() itself, before
  // the DISTINCT ON / GROUP BY / jsonb_object_agg work - passing undefined
  // (-> NULL in Postgres) keeps the original, unfiltered behavior.
  const { data, error } = await (supabase.rpc as any)("get_matches_with_odds", {
    p_league_slug: leagueSlug,
    p_market_keys: marketKeys ?? null,
  });

  if (error) {
    console.error("[OddsRepository] getAggregatedOdds error:", error);
    throw error;
  }

  return (data as AggregatedMatchOdds[]) || [];
}

export async function getMatchOdds(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<LatestOddsRow[]> {
  const supabase = getSupabase();
  const homeCanonical = getCanonicalTeamName(homeTeam, leagueSlug);
  const awayCanonical = getCanonicalTeamName(awayTeam, leagueSlug);

  const { data, error } = await fetchAllRows<LatestOddsRow>((from, to) =>
    supabase
      .from("latest_odds")
      .select("*")
      .eq("league_slug", leagueSlug)
      .eq("home_team", homeCanonical)
      .eq("away_team", awayCanonical)
      .order("market_key")
      .range(from, to) as any,
  );

  if (error) {
    console.error("[OddsRepository] getMatchOdds error:", error);
    throw error;
  }

  return data;
}

export interface MatchInfoRow {
  match_id: string;
  home_team: string;
  away_team: string;
  league_slug: string;
  start_time: string | null;
}

export async function getMatchInfoById(matchId: string): Promise<MatchInfoRow | null> {
  const supabase = getSupabase();

  const { data, error } = await (supabase.from("odds") as any)
    .select("match_id, home_team, away_team, league_slug, start_time")
    .eq("match_id", matchId)
    .limit(1);

  if (error) {
    console.error("[OddsRepository] getMatchInfoById error:", error);
    throw error;
  }

  const row = data?.[0];
  if (!row) return null;

  return {
    match_id: row.match_id,
    home_team: row.home_team,
    away_team: row.away_team,
    league_slug: row.league_slug,
    start_time: row.start_time ?? null,
  };
}

/**
 * Newest scraped_at of one bookmaker's odds in one league, or null without rows.
 * Throws an Error with the formatted DB cause on a PostgREST error.
 */
export async function getLastScrapeTime(
  bookmaker: PolishBookmaker,
  leagueSlug: string
): Promise<Date | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("odds")
    .select("scraped_at")
    .eq("league_slug", leagueSlug)
    .eq("bookmaker", bookmaker)
    .order("scraped_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`odds freshness query failed for ${bookmaker}: ${formatDbError(error)}`);
  }
  if (!data || data.length === 0) {
    return null;
  }

  return parseDbTimestamp(data[0].scraped_at);
}

/**
 * Newest scraped_at per bookmaker: one limit(1) query each. A single unbounded
 * select would be capped at PostgREST max_rows (1000) and, ordered by
 * scraped_at, see only the latest bookmaker. Bookmakers without rows are absent.
 */
export async function getOddsFreshnessByBookmaker(
  leagueSlug: string,
  bookmakers: readonly PolishBookmaker[]
): Promise<Map<PolishBookmaker, Date>> {
  const latest = await Promise.all(bookmakers.map((bm) => getLastScrapeTime(bm, leagueSlug)));

  const freshness = new Map<PolishBookmaker, Date>();
  bookmakers.forEach((bm, i) => {
    const scrapedAt = latest[i];
    if (scrapedAt && !isNaN(scrapedAt.getTime())) freshness.set(bm, scrapedAt);
  });
  return freshness;
}

export async function cleanupOldOdds(hoursToKeep: number = 24): Promise<{ deleted: number }> {
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc("cleanup_old_odds", { hours_to_keep: hoursToKeep });

  if (error) {
    console.error("[OddsRepository] cleanup error:", error);
    return { deleted: 0 };
  }

  return { deleted: data || 0 };
}

export async function getMarketTypes() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("market_types")
    .select("*")
    .order("display_order");

  if (error) {
    console.error("[OddsRepository] getMarketTypes error:", error);
    throw error;
  }

  return data || [];
}
