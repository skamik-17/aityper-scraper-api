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

// Team names must match TheSportsDB API exactly for frontend matching
export const EKSTRAKLASA_TEAMS: CanonicalTeam[] = [
  // TheSportsDB uses English city names and ASCII characters
  { id: "134010", name: "Lech Poznan", normalized: "lech poznan" },
  { id: "133992", name: "Legia Warszawa", normalized: "legia warszawa" },
  { id: "135303", name: "Wisla Plock", normalized: "wisla plock" },
  { id: "137670", name: "Rakow Czestochowa", normalized: "rakow czestochowa" },
  {
    id: "135297",
    name: "Jagiellonia Bialystok",
    normalized: "jagiellonia bialystok",
  },
  { id: "135302", name: "Pogon Szczecin", normalized: "pogon szczecin" },
  { id: "133952", name: "Slask Wroclaw", normalized: "slask wroclaw" },
  { id: "135296", name: "Gornik Zabrze", normalized: "gornik zabrze" },
  { id: "135496", name: "Zaglebie Lubin", normalized: "zaglebie lubin" },
  { id: "135294", name: "Cracovia Krakow", normalized: "cracovia krakow" },
  { id: "135300", name: "Piast Gliwice", normalized: "piast gliwice" },
  { id: "135298", name: "Korona Kielce", normalized: "korona kielce" },
  { id: "147435", name: "Motor Lublin", normalized: "motor lublin" },
  { id: "138905", name: "Stal Mielec", normalized: "stal mielec" },
  { id: "138916", name: "Radomiak Radom", normalized: "radomiak radom" },
  {
    id: "138913",
    name: "Puszcza Niepołomice",
    normalized: "puszcza niepolomice",
  },
  { id: "142467", name: "GKS Katowice", normalized: "gks katowice" },
  { id: "134489", name: "Widzew Lodz", normalized: "widzew lodz" },
  { id: "135299", name: "Lechia Gdańsk", normalized: "lechia gdansk" },
  {
    id: "138903",
    name: "Bruk-Bet Termalica Nieciecza",
    normalized: "brukbet termalica nieciecza",
  },
  { id: "134296", name: "Arka Gdynia", normalized: "arka gdynia" },
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
