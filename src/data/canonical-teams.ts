/**
 * Canonical team names for Polish Ekstraklasa
 * Source: TheSportsDB API (league ID: 4422)
 *
 * These are the official team names used as the source of truth
 * for matching scraped team names from various bookmakers.
 *
 * Updated: 2024/2025 season
 */

export interface CanonicalTeam {
  id: string; // TheSportsDB team ID
  name: string; // Official name (used for display)
  normalized: string; // Lowercase, no diacritics (used for matching)
}

export const EKSTRAKLASA_TEAMS: CanonicalTeam[] = [
  { id: "134778", name: "Lech Poznań", normalized: "lech poznan" },
  { id: "134779", name: "Legia Warszawa", normalized: "legia warszawa" },
  { id: "134780", name: "Wisła Płock", normalized: "wisla plock" },
  { id: "134781", name: "Raków Częstochowa", normalized: "rakow czestochowa" },
  {
    id: "134782",
    name: "Jagiellonia Białystok",
    normalized: "jagiellonia bialystok",
  },
  { id: "134783", name: "Pogoń Szczecin", normalized: "pogon szczecin" },
  { id: "134784", name: "Śląsk Wrocław", normalized: "slask wroclaw" },
  { id: "134785", name: "Górnik Zabrze", normalized: "gornik zabrze" },
  { id: "134786", name: "Zagłębie Lubin", normalized: "zaglebie lubin" },
  { id: "134787", name: "Cracovia", normalized: "cracovia" },
  { id: "134788", name: "Piast Gliwice", normalized: "piast gliwice" },
  { id: "134789", name: "Korona Kielce", normalized: "korona kielce" },
  { id: "134790", name: "Motor Lublin", normalized: "motor lublin" },
  { id: "134791", name: "Stal Mielec", normalized: "stal mielec" },
  { id: "134792", name: "Radomiak Radom", normalized: "radomiak radom" },
  {
    id: "134793",
    name: "Puszcza Niepołomice",
    normalized: "puszcza niepolomice",
  },
  { id: "134794", name: "GKS Katowice", normalized: "gks katowice" },
  { id: "134795", name: "Widzew Łódź", normalized: "widzew lodz" },
  { id: "134796", name: "Lechia Gdańsk", normalized: "lechia gdansk" },
  {
    id: "140158",
    name: "Bruk-Bet Termalica Nieciecza",
    normalized: "brukbet termalica nieciecza",
  },
  { id: "141428", name: "Arka Gdynia", normalized: "arka gdynia" },
];

/**
 * Get canonical name by normalized form
 */
export function getCanonicalName(normalized: string): string | null {
  const team = EKSTRAKLASA_TEAMS.find((t) => t.normalized === normalized);
  return team?.name ?? null;
}

/**
 * Get team by ID
 */
export function getTeamById(id: string): CanonicalTeam | null {
  return EKSTRAKLASA_TEAMS.find((t) => t.id === id) ?? null;
}
