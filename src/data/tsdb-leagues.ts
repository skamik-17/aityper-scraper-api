/**
 * TheSportsDB metadata per league slug.
 * Mirrors the frontend league config values used for TSDB fetching.
 */

export interface TsdbLeagueMeta {
  theSportsDbId: string;
  totalRounds: number;
}

export const TSDB_LEAGUE_META: Record<string, TsdbLeagueMeta> = {
  ekstraklasa: { theSportsDbId: "4422", totalRounds: 34 },
  "premier-league": { theSportsDbId: "4328", totalRounds: 38 },
  laliga: { theSportsDbId: "4335", totalRounds: 38 },
  bundesliga: { theSportsDbId: "4331", totalRounds: 34 },
  "serie-a": { theSportsDbId: "4332", totalRounds: 38 },
  "ligue-1": { theSportsDbId: "4334", totalRounds: 34 },
};

export function getTsdbLeagueMeta(leagueSlug: string): TsdbLeagueMeta | null {
  return TSDB_LEAGUE_META[leagueSlug] ?? null;
}
