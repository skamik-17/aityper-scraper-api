/**
 * Canonical team names for English Premier League
 * Source: TheSportsDB API (league ID: 4328)
 *
 * These are the official team names used as the source of truth
 * for matching scraped team names from various bookmakers.
 *
 * Updated: 2024/2025 season
 */

import type { CanonicalTeam } from "./canonical-teams.js";

// Team names must match TheSportsDB API exactly for frontend matching
export const PREMIER_LEAGUE_TEAMS: CanonicalTeam[] = [
  // 2024/2025 season teams
  { id: "133604", name: "Arsenal", normalized: "arsenal" },
  { id: "133601", name: "Aston Villa", normalized: "aston villa" },
  { id: "134301", name: "AFC Bournemouth", normalized: "afc bournemouth" },
  { id: "134355", name: "Brentford", normalized: "brentford" },
  { id: "133619", name: "Brighton and Hove Albion", normalized: "brighton hove albion" },
  { id: "133610", name: "Chelsea", normalized: "chelsea" },
  { id: "133632", name: "Crystal Palace", normalized: "crystal palace" },
  { id: "133615", name: "Everton", normalized: "everton" },
  { id: "133600", name: "Fulham", normalized: "fulham" },
  { id: "135523", name: "Ipswich Town", normalized: "ipswich town" },
  { id: "133627", name: "Leicester City", normalized: "leicester city" },
  { id: "133602", name: "Liverpool", normalized: "liverpool" },
  { id: "133613", name: "Manchester City", normalized: "manchester city" },
  { id: "133612", name: "Manchester United", normalized: "manchester united" },
  { id: "134777", name: "Newcastle United", normalized: "newcastle united" },
  { id: "133720", name: "Nottingham Forest", normalized: "nottingham forest" },
  { id: "134778", name: "Southampton", normalized: "southampton" },
  { id: "133616", name: "Tottenham Hotspur", normalized: "tottenham hotspur" },
  { id: "133636", name: "West Ham United", normalized: "west ham united" },
  { id: "133599", name: "Wolverhampton Wanderers", normalized: "wolverhampton wanderers" },
];

/**
 * Get canonical name by normalized form
 */
export function getPremierLeagueCanonicalName(normalized: string): string | null {
  const team = PREMIER_LEAGUE_TEAMS.find((t) => t.normalized === normalized);
  return team?.name ?? null;
}

/**
 * Get team by ID
 */
export function getPremierLeagueTeamById(id: string): CanonicalTeam | null {
  return PREMIER_LEAGUE_TEAMS.find((t) => t.id === id) ?? null;
}
