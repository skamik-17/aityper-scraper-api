import { EKSTRAKLASA_TEAMS, type CanonicalTeam } from "./canonical-teams.js";
import { PREMIER_LEAGUE_TEAMS } from "./premier-league-teams.js";
import { LALIGA_TEAMS } from "./laliga-teams.js";
import { SERIE_A_TEAMS } from "./serie-a-teams.js";
import { LIGUE_1_TEAMS } from "./ligue-1-teams.js";
import { WORLD_CUP_2026_TEAMS } from "./world-cup-2026-teams.js";

export type { CanonicalTeam };

export const LEAGUE_TEAMS: Record<string, CanonicalTeam[]> = {
  ekstraklasa: EKSTRAKLASA_TEAMS,
  "premier-league": PREMIER_LEAGUE_TEAMS,
  laliga: LALIGA_TEAMS,
  "serie-a": SERIE_A_TEAMS,
  "ligue-1": LIGUE_1_TEAMS,
  "world-cup-2026": WORLD_CUP_2026_TEAMS,
};

export function getTeamsForLeague(league: string): CanonicalTeam[] {
  return LEAGUE_TEAMS[league] ?? [];
}

export { EKSTRAKLASA_TEAMS } from "./canonical-teams.js";
export { PREMIER_LEAGUE_TEAMS } from "./premier-league-teams.js";
export { LALIGA_TEAMS } from "./laliga-teams.js";
export { SERIE_A_TEAMS } from "./serie-a-teams.js";
export { LIGUE_1_TEAMS } from "./ligue-1-teams.js";
export { WORLD_CUP_2026_TEAMS } from "./world-cup-2026-teams.js";
