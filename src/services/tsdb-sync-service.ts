import { TSDB_LEAGUE_META } from "../data/tsdb-leagues.js";
import {
  fetchAllRounds,
  getCurrentSeason,
  type TsdbEvent,
} from "../clients/thesportsdb-client.js";
import {
  countUpcomingTsdbFixtures,
  upsertTsdbFixtures,
  type TsdbFixtureRow,
} from "../repositories/tsdb-fixtures-repository.js";
import { CONFIG } from "../config/index.js";

function parseKickoffTime(event: TsdbEvent): string | null {
  if (event.strTimestamp) {
    const ts = event.strTimestamp;
    const hasTimezone = ts.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(ts);
    return new Date(hasTimezone ? ts : ts + "+00:00").toISOString();
  }
  if (event.dateEvent && event.strTime) {
    return new Date(`${event.dateEvent}T${event.strTime}+00:00`).toISOString();
  }
  if (event.dateEvent) {
    return new Date(`${event.dateEvent}T00:00:00+00:00`).toISOString();
  }
  return null;
}

function mapTsdbStatus(apiStatus: string | null): string {
  if (!apiStatus) return "scheduled";
  const status = apiStatus.toLowerCase();
  if (status.includes("match finished") || status.includes("ft") || status === "finished") {
    return "finished";
  }
  if (
    status.includes("live") ||
    status.includes("in progress") ||
    status.includes("1h") ||
    status.includes("2h") ||
    status.includes("ht")
  ) {
    return "live";
  }
  if (status.includes("postponed") || status.includes("psp")) return "postponed";
  if (status.includes("cancelled") || status.includes("canc")) return "cancelled";
  return "scheduled";
}

function eventToRow(event: TsdbEvent, leagueSlug: string): TsdbFixtureRow | null {
  const kickoff = parseKickoffTime(event);
  if (!kickoff) return null;

  return {
    id: event.idEvent,
    league_slug: leagueSlug,
    home_team_id: event.idHomeTeam,
    home_team_name: event.strHomeTeam,
    home_team_badge: event.strHomeTeamBadge ?? null,
    away_team_id: event.idAwayTeam,
    away_team_name: event.strAwayTeam,
    away_team_badge: event.strAwayTeamBadge ?? null,
    kickoff_time: kickoff,
    venue: event.strVenue ?? null,
    round: event.intRound ? Number(event.intRound) : null,
    status: mapTsdbStatus(event.strStatus),
    home_score: event.intHomeScore !== null ? Number(event.intHomeScore) : null,
    away_score: event.intAwayScore !== null ? Number(event.intAwayScore) : null,
    half_time_score: event.strHalfTimeScore ?? null,
    synced_at: new Date().toISOString(),
  };
}

export interface SyncLeagueResult {
  leagueSlug: string;
  fetched: number;
  synced: number;
  failedRounds: number[];
}

export async function syncLeagueFixtures(leagueSlug: string): Promise<SyncLeagueResult> {
  const meta = TSDB_LEAGUE_META[leagueSlug];
  if (!meta) {
    throw new Error(`No TSDB metadata for league: ${leagueSlug}`);
  }

  const season = getCurrentSeason();
  console.log(`[tsdbSync] ${leagueSlug}: fetching ${meta.totalRounds} rounds (${season})`);

  const { events, failedRounds } = await fetchAllRounds(
    meta.theSportsDbId,
    meta.totalRounds,
    season
  );

  const rows: TsdbFixtureRow[] = [];
  for (const event of events) {
    const row = eventToRow(event, leagueSlug);
    if (row) rows.push(row);
  }

  await upsertTsdbFixtures(rows);

  console.log(
    `[tsdbSync] ${leagueSlug}: fetched=${events.length} synced=${rows.length} failed_rounds=${failedRounds.length}`
  );

  return {
    leagueSlug,
    fetched: events.length,
    synced: rows.length,
    failedRounds,
  };
}

/**
 * Sync all enabled leagues sequentially to respect the shared TSDB rate limit.
 */
export async function syncAllEnabledLeagues(): Promise<SyncLeagueResult[]> {
  const results: SyncLeagueResult[] = [];
  for (const league of CONFIG.ENABLED_LEAGUES) {
    try {
      const result = await syncLeagueFixtures(league);
      results.push(result);
    } catch (error) {
      console.error(`[tsdbSync] ${league} failed:`, error);
    }
  }
  return results;
}

/**
 * Startup-safe sync: re-syncs leagues whose cache has no upcoming fixtures
 * (either fully empty, or stale — every cached kickoff is in the past).
 */
export async function syncStaleLeagues(): Promise<SyncLeagueResult[]> {
  const results: SyncLeagueResult[] = [];
  for (const league of CONFIG.ENABLED_LEAGUES) {
    const upcoming = await countUpcomingTsdbFixtures(league);
    if (upcoming > 0) {
      console.log(`[tsdbSync] ${league}: ${upcoming} upcoming fixtures cached, skipping sync`);
      continue;
    }
    console.log(`[tsdbSync] ${league}: 0 upcoming fixtures cached, syncing`);
    try {
      const result = await syncLeagueFixtures(league);
      results.push(result);
    } catch (error) {
      console.error(`[tsdbSync] ${league} failed:`, error);
    }
  }
  return results;
}
