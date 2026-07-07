/**
 * TheSportsDB metadata per league slug.
 * Mirrors the frontend league config values used for TSDB fetching.
 */

export interface TsdbLeagueMeta {
  theSportsDbId: string;
  totalRounds: number;
  /** Override the auto-computed season (e.g. "2026" for a single-year tournament). */
  season?: string;
  /**
   * Explicit list of TSDB intRound values to fetch. Overrides totalRounds.
   * Tournaments need this: knockout rounds are not numbered 1..N.
   */
  rounds?: number[];
}

export const TSDB_LEAGUE_META: Record<string, TsdbLeagueMeta> = {
  ekstraklasa: { theSportsDbId: "4422", totalRounds: 34 },
  "premier-league": { theSportsDbId: "4328", totalRounds: 38 },
  laliga: { theSportsDbId: "4335", totalRounds: 38 },
  bundesliga: { theSportsDbId: "4331", totalRounds: 34 },
  "serie-a": { theSportsDbId: "4332", totalRounds: 38 },
  "ligue-1": { theSportsDbId: "4334", totalRounds: 34 },
  // FIFA World Cup 2026 (league 4429). Group stage = rounds 1-3 (24 matches each).
  // Knockout intRound values verified against the live API (2026-07-07):
  // 32 = Round of 32, 16 = Round of 16, 125 = Quarter-final. Later stages
  // follow TSDB's special-round convention (150/160/170/180/200); empty
  // rounds return no events and are harmless to query.
  "world-cup-2026": {
    theSportsDbId: "4429",
    totalRounds: 3,
    season: "2026",
    rounds: [1, 2, 3, 32, 16, 125, 150, 160, 170, 180, 200],
  },
};

export function getTsdbLeagueMeta(leagueSlug: string): TsdbLeagueMeta | null {
  return TSDB_LEAGUE_META[leagueSlug] ?? null;
}
