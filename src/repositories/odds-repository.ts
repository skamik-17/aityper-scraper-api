import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { Database, LatestOddsRow, OddsInsert } from "../types/database.js";
import { getCanonicalTeamName, getNormalizedTeamName } from "../utils/team-matcher.js";

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

export async function getAggregatedOdds(leagueSlug: string = "ekstraklasa"): Promise<AggregatedMatchOdds[]> {
  const supabase = getSupabase();

  const { data, error } = await (supabase.rpc as any)("get_matches_with_odds", {
    p_league_slug: leagueSlug,
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

  const { data, error } = await supabase
    .from("latest_odds")
    .select("*")
    .eq("league_slug", leagueSlug)
    .eq("home_team", homeCanonical)
    .eq("away_team", awayCanonical);

  if (error) {
    console.error("[OddsRepository] getMatchOdds error:", error);
    throw error;
  }

  return data || [];
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

export async function getLastScrapeTime(
  bookmaker: PolishBookmaker,
  leagueSlug: string = "ekstraklasa"
): Promise<Date | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("odds")
    .select("scraped_at")
    .eq("league_slug", leagueSlug)
    .eq("bookmaker", bookmaker)
    .order("scraped_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  return new Date(data[0].scraped_at);
}

export async function getBookmakerStatus(leagueSlug: string = "ekstraklasa") {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("odds")
    .select("bookmaker, scraped_at")
    .eq("league_slug", leagueSlug)
    .order("scraped_at", { ascending: false });

  if (error) {
    console.error("[OddsRepository] getBookmakerStatus error:", error);
    throw error;
  }

  const statusMap = new Map<PolishBookmaker, { lastScrape: Date; matchCount: number }>();
  const matchCounts = new Map<PolishBookmaker, number>();

  for (const row of data || []) {
    const bm = row.bookmaker as PolishBookmaker;
    if (!statusMap.has(bm)) {
      statusMap.set(bm, {
        lastScrape: new Date(row.scraped_at),
        matchCount: 0,
      });
    }
    matchCounts.set(bm, (matchCounts.get(bm) || 0) + 1);
  }

  for (const [bm, status] of Array.from(statusMap.entries())) {
    status.matchCount = matchCounts.get(bm) || 0;
  }

  return statusMap;
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
