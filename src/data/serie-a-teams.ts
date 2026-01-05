/**
 * Canonical team names for Italian Serie A
 * Source: TheSportsDB API (league ID: 4332)
 *
 * These are the official team names used as the source of truth
 * for matching scraped team names from various bookmakers.
 *
 * Updated: 2024/2025 season
 */

import type { CanonicalTeam } from "./canonical-teams.js";

// Team names must match TheSportsDB API exactly for frontend matching
export const SERIE_A_TEAMS: CanonicalTeam[] = [
  { id: "133667", name: "AC Milan", normalized: "ac milan" },
  { id: "134782", name: "Atalanta", normalized: "atalanta" },
  { id: "134781", name: "Bologna", normalized: "bologna" },
  { id: "134783", name: "Cagliari", normalized: "cagliari" },
  { id: "134243", name: "Como", normalized: "como" },
  { id: "133695", name: "Empoli", normalized: "empoli" },
  { id: "133674", name: "Fiorentina", normalized: "fiorentina" },
  { id: "133675", name: "Genoa", normalized: "genoa" },
  { id: "134784", name: "Hellas Verona", normalized: "hellas verona" },
  { id: "133681", name: "Inter Milan", normalized: "inter milan" },
  { id: "133676", name: "Juventus", normalized: "juventus" },
  { id: "133668", name: "Lazio", normalized: "lazio" },
  { id: "133678", name: "Lecce", normalized: "lecce" },
  { id: "134270", name: "Monza", normalized: "monza" },
  { id: "133670", name: "Napoli", normalized: "napoli" },
  { id: "135728", name: "Parma", normalized: "parma" },
  { id: "133682", name: "Roma", normalized: "roma" },
  { id: "133687", name: "Torino", normalized: "torino" },
  { id: "133679", name: "Udinese", normalized: "udinese" },
  { id: "134234", name: "Venezia", normalized: "venezia" },

  // Serie B teams that may appear in Coppa Italia or promotional bets
  { id: "133704", name: "Pisa", normalized: "pisa" },
  { id: "133690", name: "Sassuolo", normalized: "sassuolo" },
  { id: "134012", name: "Cremonese", normalized: "cremonese" },
];

/**
 * Get canonical name by normalized form
 */
export function getSerieACanonicalName(normalized: string): string | null {
  const team = SERIE_A_TEAMS.find((t) => t.normalized === normalized);
  return team?.name ?? null;
}

/**
 * Get team by ID
 */
export function getSerieATeamById(id: string): CanonicalTeam | null {
  return SERIE_A_TEAMS.find((t) => t.id === id) ?? null;
}
