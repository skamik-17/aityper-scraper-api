/**
 * Canonical team names for Spanish La Liga
 * Source: TheSportsDB API (league ID: 4335)
 *
 * These are the official team names used as the source of truth
 * for matching scraped team names from various bookmakers.
 *
 * Updated: 2024/2025 season
 */

import type { CanonicalTeam } from "./canonical-teams.js";

// Team names must match TheSportsDB API exactly for frontend matching
export const LALIGA_TEAMS: CanonicalTeam[] = [
  // 2025/2026 La Liga season teams (20 teams)
  { id: "134221", name: "Alaves", normalized: "alaves" },
  { id: "133727", name: "Athletic Bilbao", normalized: "athletic bilbao" },
  { id: "133729", name: "Atletico Madrid", normalized: "atletico madrid" },
  { id: "133739", name: "Barcelona", normalized: "barcelona" },
  { id: "133937", name: "Celta Vigo", normalized: "celta vigo" },
  { id: "133732", name: "Elche", normalized: "elche" }, // Promoted
  { id: "133734", name: "Espanyol", normalized: "espanyol" },
  { id: "133731", name: "Getafe", normalized: "getafe" },
  { id: "134700", name: "Girona", normalized: "girona" },
  { id: "133736", name: "Levante", normalized: "levante" }, // Promoted
  { id: "133733", name: "Mallorca", normalized: "mallorca" },
  { id: "133730", name: "Osasuna", normalized: "osasuna" },
  { id: "133728", name: "Rayo Vallecano", normalized: "rayo vallecano" },
  { id: "133722", name: "Real Betis", normalized: "real betis" },
  { id: "133738", name: "Real Madrid", normalized: "real madrid" },
  { id: "140067", name: "Real Oviedo", normalized: "real oviedo" }, // Promoted
  { id: "133724", name: "Real Sociedad", normalized: "real sociedad" },
  { id: "133735", name: "Sevilla", normalized: "sevilla" },
  { id: "133725", name: "Valencia", normalized: "valencia" },
  { id: "133740", name: "Villarreal", normalized: "villarreal" },
];

/**
 * Get canonical name by normalized form
 */
export function getLaLigaCanonicalName(normalized: string): string | null {
  const team = LALIGA_TEAMS.find((t) => t.normalized === normalized);
  return team?.name ?? null;
}

/**
 * Get team by ID
 */
export function getLaLigaTeamById(id: string): CanonicalTeam | null {
  return LALIGA_TEAMS.find((t) => t.id === id) ?? null;
}
