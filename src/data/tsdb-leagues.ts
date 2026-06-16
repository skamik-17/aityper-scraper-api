/**
 * TheSportsDB metadata per league slug.
 * Mirrors the frontend league config values used for TSDB fetching.
 */

export interface TsdbLeagueMeta {
  theSportsDbId: string;
  totalRounds: number;
  /** Override the auto-computed season (e.g. "2026" for a single-year tournament). */
  season?: string;
}

export const TSDB_LEAGUE_META: Record<string, TsdbLeagueMeta> = {
  ekstraklasa: { theSportsDbId: "4422", totalRounds: 34 },
  "premier-league": { theSportsDbId: "4328", totalRounds: 38 },
  laliga: { theSportsDbId: "4335", totalRounds: 38 },
  bundesliga: { theSportsDbId: "4331", totalRounds: 34 },
  "serie-a": { theSportsDbId: "4332", totalRounds: 38 },
  "ligue-1": { theSportsDbId: "4334", totalRounds: 34 },
  // FIFA World Cup 2026 (league 4429). Group stage = rounds 1-3 (24 matches each).
  // Knockout rounds use different intRound numbers and are added once TSDB
  // populates them (tournament is mid-group-stage as of June 2026).
  "world-cup-2026": { theSportsDbId: "4429", totalRounds: 3, season: "2026" },
};

export function getTsdbLeagueMeta(leagueSlug: string): TsdbLeagueMeta | null {
  return TSDB_LEAGUE_META[leagueSlug] ?? null;
}
