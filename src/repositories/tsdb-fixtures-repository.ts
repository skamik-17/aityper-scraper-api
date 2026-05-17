import { getSupabase } from "../config/database.js";

// tsdb_fixtures is a new table not yet in the generated Database type.
function db(): any {
  return getSupabase();
}

export interface TsdbFixtureRow {
  id: string;
  league_slug: string;
  home_team_id: string;
  home_team_name: string;
  home_team_badge: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_badge: string | null;
  kickoff_time: string;
  venue: string | null;
  round: number | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  half_time_score: string | null;
  synced_at: string;
}

export async function upsertTsdbFixtures(rows: TsdbFixtureRow[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = db();

  const { error } = await supabase.from("tsdb_fixtures")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("[tsdbFixturesRepo] upsertTsdbFixtures error:", error);
    throw error;
  }
}

export interface GetTsdbFixturesFilter {
  leagueSlug?: string;
  upcoming?: boolean;
  limit?: number;
}

export async function getTsdbFixtures(
  filter: GetTsdbFixturesFilter = {}
): Promise<TsdbFixtureRow[]> {
  const supabase = db();

  let query = supabase.from("tsdb_fixtures").select("*");

  if (filter.leagueSlug) {
    query = query.eq("league_slug", filter.leagueSlug);
  }

  if (filter.upcoming) {
    query = query.gte("kickoff_time", new Date().toISOString());
  }

  query = query.order("kickoff_time", { ascending: true });

  if (filter.limit) {
    query = query.limit(filter.limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[tsdbFixturesRepo] getTsdbFixtures error:", error);
    throw error;
  }

  return (data as TsdbFixtureRow[]) ?? [];
}

export async function countTsdbFixtures(leagueSlug: string): Promise<number> {
  const supabase = db();

  const { count, error } = await supabase.from("tsdb_fixtures")
    .select("id", { count: "exact", head: true })
    .eq("league_slug", leagueSlug);

  if (error) {
    console.error("[tsdbFixturesRepo] countTsdbFixtures error:", error);
    throw error;
  }

  return count ?? 0;
}

export async function countUpcomingTsdbFixtures(leagueSlug: string): Promise<number> {
  const supabase = db();

  const { count, error } = await supabase.from("tsdb_fixtures")
    .select("id", { count: "exact", head: true })
    .eq("league_slug", leagueSlug)
    .gte("kickoff_time", new Date().toISOString());

  if (error) {
    console.error("[tsdbFixturesRepo] countUpcomingTsdbFixtures error:", error);
    throw error;
  }

  return count ?? 0;
}
