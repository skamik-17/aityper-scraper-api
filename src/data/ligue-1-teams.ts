/**
 * Canonical team names for French Ligue 1
 * Source: TheSportsDB API (league ID: 4334)
 *
 * These are the official team names used as the source of truth
 * for matching scraped team names from various bookmakers.
 *
 * Updated: 2025/2026 season
 */

import type { CanonicalTeam } from "./canonical-teams.js";

// Team names must match TheSportsDB API exactly for frontend matching
export const LIGUE_1_TEAMS: CanonicalTeam[] = [
  // 2025/2026 Ligue 1 season teams
  { id: "134709", name: "Angers", normalized: "angers" },
  { id: "134788", name: "Auxerre", normalized: "auxerre" },
  { id: "133704", name: "Brest", normalized: "brest" },
  { id: "133862", name: "Le Havre", normalized: "le havre" },
  { id: "133822", name: "Lens", normalized: "lens" },
  { id: "133711", name: "Lille", normalized: "lille" },
  { id: "133715", name: "Lorient", normalized: "lorient" },
  { id: "133713", name: "Lyon", normalized: "lyon" },
  { id: "133707", name: "Marseille", normalized: "marseille" },
  { id: "133883", name: "Metz", normalized: "metz" },
  { id: "133823", name: "Monaco", normalized: "monaco" },
  { id: "133861", name: "Nantes", normalized: "nantes" },
  { id: "133712", name: "Nice", normalized: "nice" },
  { id: "135465", name: "Paris FC", normalized: "paris fc" },
  { id: "133714", name: "Paris SG", normalized: "paris sg" },
  { id: "133719", name: "Rennes", normalized: "rennes" },
  { id: "133882", name: "Strasbourg", normalized: "strasbourg" },
  { id: "133703", name: "Toulouse", normalized: "toulouse" },
  // Additional teams that may appear (promoted/relegated)
  { id: "133699", name: "Montpellier", normalized: "montpellier" },
  { id: "133716", name: "Reims", normalized: "reims" },
  { id: "142397", name: "Saint-Etienne", normalized: "saint etienne" },
];

/**
 * Get canonical name by normalized form
 */
export function getLigue1CanonicalName(normalized: string): string | null {
  const team = LIGUE_1_TEAMS.find((t) => t.normalized === normalized);
  return team?.name ?? null;
}

/**
 * Get team by ID
 */
export function getLigue1TeamById(id: string): CanonicalTeam | null {
  return LIGUE_1_TEAMS.find((t) => t.id === id) ?? null;
}
