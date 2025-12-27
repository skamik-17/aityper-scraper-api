/**
 * Central export for league team data
 * Provides unified access to teams across all supported leagues
 */

import { EKSTRAKLASA_TEAMS, type CanonicalTeam } from "./canonical-teams.js";
import { PREMIER_LEAGUE_TEAMS } from "./premier-league-teams.js";

export type { CanonicalTeam };

/**
 * Map of league slug to team data
 */
export const LEAGUE_TEAMS: Record<string, CanonicalTeam[]> = {
  ekstraklasa: EKSTRAKLASA_TEAMS,
  "premier-league": PREMIER_LEAGUE_TEAMS,
};

/**
 * Get teams for a specific league
 */
export function getTeamsForLeague(league: string): CanonicalTeam[] {
  return LEAGUE_TEAMS[league] ?? [];
}

/**
 * Get all supported league slugs
 */
export function getSupportedLeagues(): string[] {
  return Object.keys(LEAGUE_TEAMS);
}

/**
 * Check if a league is supported
 */
export function isLeagueSupported(league: string): boolean {
  return league in LEAGUE_TEAMS;
}

// Re-export individual team arrays for backwards compatibility
export { EKSTRAKLASA_TEAMS } from "./canonical-teams.js";
export { PREMIER_LEAGUE_TEAMS } from "./premier-league-teams.js";
