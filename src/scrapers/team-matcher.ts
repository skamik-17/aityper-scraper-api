/**
 * Team name matcher - maps bookmaker variations to canonical names
 *
 * This module provides functions to normalize team names from various
 * bookmakers to their canonical forms from TheSportsDB.
 *
 * Supports multiple leagues with league-specific aliases.
 */

import Fuse from "fuse.js";
import {
  LEAGUE_TEAMS,
  getTeamsForLeague,
  type CanonicalTeam,
} from "../data/index.js";

/**
 * Explicit aliases for Ekstraklasa (bookmaker → TheSportsDB canonical)
 * IMPORTANT: Values must match TheSportsDB API names exactly
 */
const EKSTRAKLASA_ALIASES: Record<string, string> = {
  // Fortuna abbreviations → TheSportsDB names
  "R.Radom": "Radomiak Radom",
  Radomiak: "Radomiak Radom",
  "Lechia G.": "Lechia Gdańsk",
  Lechia: "Lechia Gdańsk",
  "Zag.Lubin": "Zaglebie Lubin",
  Zagłębie: "Zaglebie Lubin",
  "Zagłębie Lubin": "Zaglebie Lubin",
  "Lech P.": "Lech Poznan",
  Lech: "Lech Poznan",
  "Lech Poznań": "Lech Poznan",
  "Legia W.": "Legia Warsaw",
  Legia: "Legia Warsaw",
  "Legia Warszawa": "Legia Warsaw",
  "Korona K.": "Korona Kielce",
  Korona: "Korona Kielce",
  "M.Lublin": "Motor Lublin",
  Motor: "Motor Lublin",
  "Pogoń Sz.": "Pogon Szczecin",
  Pogoń: "Pogon Szczecin",
  "Pogoń Szczecin": "Pogon Szczecin",
  "Raków Cz.": "Rakow Czestochowa",
  Raków: "Rakow Czestochowa",
  "Raków Częstochowa": "Rakow Czestochowa",
  "W.Płock": "Wisla Plock",
  Wisła: "Wisla Plock",
  "Wisła Płock": "Wisla Plock",
  Nieciecza: "Bruk-Bet Termalica Nieciecza",
  Termalica: "Bruk-Bet Termalica Nieciecza",
  "Termalica Nieciecza": "Bruk-Bet Termalica Nieciecza",
  "GKS Kat.": "GKS Katowice",
  GKS: "GKS Katowice",
  "Górnik Z.": "Gornik Zabrze",
  Górnik: "Gornik Zabrze",
  "Górnik Zabrze": "Gornik Zabrze",
  "Śląsk Wr.": "Slask Wroclaw",
  Śląsk: "Slask Wroclaw",
  "Śląsk Wrocław": "Slask Wroclaw",
  "Widzew Ł.": "Widzew Lodz",
  Widzew: "Widzew Lodz",
  "Widzew Łódź": "Widzew Lodz",
  "Zagłębie L.": "Zaglebie Lubin",
  "Stal M.": "Stal Mielec",
  Stal: "Stal Mielec",
  "Piast G.": "Piast Gliwice",
  Piast: "Piast Gliwice",
  "Puszcza N.": "Puszcza Niepołomice",
  Puszcza: "Puszcza Niepołomice",
  "Jagiellonia B.": "Jagiellonia Bialystok",
  Jagiellonia: "Jagiellonia Bialystok",
  "Jagiellonia Białystok": "Jagiellonia Bialystok",
  Jaga: "Jagiellonia Bialystok",
  "Arka G.": "Arka Gdynia",
  Arka: "Arka Gdynia",
  Cracovia: "Cracovia Krakow",
  "Cracovia Kraków": "Cracovia Krakow",
};

/**
 * Explicit aliases for Premier League (bookmaker → TheSportsDB canonical)
 * Common abbreviations used by Polish bookmakers
 */
const PREMIER_LEAGUE_ALIASES: Record<string, string> = {
  // Manchester teams
  "Man Utd": "Manchester United",
  "Man United": "Manchester United",
  "Manchester Utd": "Manchester United",
  "Man. United": "Manchester United",
  "Man.United": "Manchester United",
  "Man City": "Manchester City",
  "Manchester C.": "Manchester City",
  "Man. City": "Manchester City",
  "Man.City": "Manchester City",

  // London teams
  Spurs: "Tottenham Hotspur",
  Tottenham: "Tottenham Hotspur",
  "West Ham": "West Ham United",
  "Crystal P.": "Crystal Palace",

  // Other abbreviations
  Wolves: "Wolverhampton Wanderers",
  Wolverhampton: "Wolverhampton Wanderers",
  Brighton: "Brighton and Hove Albion",
  "Brighton & Hove": "Brighton and Hove Albion",
  "Brighton Hove": "Brighton and Hove Albion",
  Bournemouth: "AFC Bournemouth",
  Newcastle: "Newcastle United",
  "Newcastle U.": "Newcastle United",
  "Nottm Forest": "Nottingham Forest",
  "Nott'm Forest": "Nottingham Forest",
  "Nottingham F.": "Nottingham Forest",
  "N. Forest": "Nottingham Forest",
  Leicester: "Leicester City",
  "Leicester C.": "Leicester City",
  Ipswich: "Ipswich Town",
  "Ipswich T.": "Ipswich Town",
  "Aston V.": "Aston Villa",

  // Championship teams (appear in cup matches)
  Leeds: "Leeds United",
  "Leeds U.": "Leeds United",
  "Sheffield Utd": "Sheffield United",
  "Sheffield U.": "Sheffield United",
  "Sheff Utd": "Sheffield United",
  "Sheffield Wed": "Sheffield Wednesday",
  "Sheff Wed": "Sheffield Wednesday",
  "West Brom": "West Bromwich Albion",
  "West Bromwich": "West Bromwich Albion",
  "WBA": "West Bromwich Albion",
  Luton: "Luton Town",
  "Luton T.": "Luton Town",
  Stoke: "Stoke City",
  "Stoke C.": "Stoke City",
};

/**
 * Map of league to aliases
 */
const LEAGUE_ALIASES: Record<string, Record<string, string>> = {
  ekstraklasa: EKSTRAKLASA_ALIASES,
  "premier-league": PREMIER_LEAGUE_ALIASES,
};

/**
 * Cache for Fuse.js instances per league
 */
const fuseCache: Map<string, Fuse<CanonicalTeam>> = new Map();

/**
 * Get or create Fuse.js instance for a league
 */
function getFuseForLeague(league: string): Fuse<CanonicalTeam> | null {
  if (fuseCache.has(league)) {
    return fuseCache.get(league)!;
  }

  const teams = getTeamsForLeague(league);
  if (teams.length === 0) {
    return null;
  }

  const fuse = new Fuse(teams, {
    keys: ["name", "normalized"],
    threshold: 0.4,
    includeScore: true,
  });

  fuseCache.set(league, fuse);
  return fuse;
}

/**
 * Normalize string for comparison
 * - Replace Polish Ł/ł with L/l (not handled by NFD)
 * - Lowercase
 * - Remove diacritics (Polish characters)
 * - Remove special characters
 * - Normalize whitespace
 */
function normalize(name: string): string {
  return name
    .replace(/Ł/g, "L")
    .replace(/ł/g, "l")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();
}

/**
 * Match scraped team name to canonical form for a specific league
 * Returns the canonical CanonicalTeam or null if no match found
 *
 * Matching priority:
 * 1. Explicit aliases (fastest, for known abbreviations)
 * 2. Exact normalized match
 * 3. Substring match (normalized contains canonical or vice versa)
 * 4. Fuzzy match using Fuse.js (last resort)
 *
 * @param scrapedName - Team name from bookmaker
 * @param league - League slug (e.g., "ekstraklasa", "premier-league")
 */
export function matchToCanonical(
  scrapedName: string,
  league: string = "ekstraklasa"
): CanonicalTeam | null {
  const teams = getTeamsForLeague(league);
  if (teams.length === 0) {
    console.warn(`[TeamMatcher] Unknown league: "${league}"`);
    return null;
  }

  const aliases = LEAGUE_ALIASES[league] ?? {};

  // 1. Check explicit aliases first (fastest path for known abbreviations)
  const aliasMatch = aliases[scrapedName];
  if (aliasMatch) {
    return teams.find((t) => t.name === aliasMatch) ?? null;
  }

  // 2. Check exact normalized match
  const normalized = normalize(scrapedName);
  const exactMatch = teams.find((t) => t.normalized === normalized);
  if (exactMatch) {
    return exactMatch;
  }

  // 3. Check if normalized contains canonical or vice versa
  for (const team of teams) {
    if (
      normalized.includes(team.normalized) ||
      team.normalized.includes(normalized)
    ) {
      return team;
    }
  }

  // 4. Fuzzy match as last resort
  const fuse = getFuseForLeague(league);
  if (fuse) {
    const fuseResult = fuse.search(scrapedName);
    if (
      fuseResult.length > 0 &&
      fuseResult[0].score !== undefined &&
      fuseResult[0].score < 0.4
    ) {
      return fuseResult[0].item;
    }
  }

  // 5. No match found - log warning for debugging
  console.warn(
    `[TeamMatcher] Unknown team name: "${scrapedName}" (normalized: "${normalized}") in league: "${league}"`
  );
  return null;
}

/**
 * Get canonical team name or return original if no match
 * Use this for display purposes
 *
 * @param scrapedName - Team name from bookmaker
 * @param league - League slug (default: "ekstraklasa")
 */
export function getCanonicalTeamName(
  scrapedName: string,
  league: string = "ekstraklasa"
): string {
  const match = matchToCanonical(scrapedName, league);
  return match?.name ?? scrapedName;
}

/**
 * Get normalized form for database storage
 * Use this for database keys and matching
 *
 * @param scrapedName - Team name from bookmaker
 * @param league - League slug (default: "ekstraklasa")
 */
export function getNormalizedTeamName(
  scrapedName: string,
  league: string = "ekstraklasa"
): string {
  const match = matchToCanonical(scrapedName, league);
  return match?.normalized ?? normalize(scrapedName);
}

/**
 * Check if a team name matches a canonical team
 *
 * @param scrapedName - Team name from bookmaker
 * @param league - League slug (default: "ekstraklasa")
 */
export function isKnownTeam(
  scrapedName: string,
  league: string = "ekstraklasa"
): boolean {
  return matchToCanonical(scrapedName, league) !== null;
}

/**
 * Calculate similarity between two team names using canonical matching
 *
 * @param name1 - First team name
 * @param name2 - Second team name
 * @param league - League slug (default: "ekstraklasa")
 */
export function calculateTeamSimilarity(
  name1: string,
  name2: string,
  league: string = "ekstraklasa"
): number {
  const canonical1 = getCanonicalTeamName(name1, league);
  const canonical2 = getCanonicalTeamName(name2, league);

  if (canonical1 === canonical2) {
    return 1.0;
  }

  // Use Fuse.js for fuzzy matching
  const teamFuse = new Fuse([canonical2], {
    includeScore: true,
    threshold: 0.6,
  });

  const result = teamFuse.search(canonical1);

  if (result.length > 0 && result[0].score !== undefined) {
    return 1 - result[0].score;
  }

  return 0;
}

/**
 * Match two events based on team names
 *
 * @param event1 - First event with homeTeam and awayTeam
 * @param event2 - Second event with homeTeam and awayTeam
 * @param league - League slug (default: "ekstraklasa")
 */
export function matchEvents(
  event1: { homeTeam: string; awayTeam: string },
  event2: { homeTeam: string; awayTeam: string },
  league: string = "ekstraklasa"
): { isMatch: boolean; confidence: number } {
  const homeMatch = calculateTeamSimilarity(event1.homeTeam, event2.homeTeam, league);
  const awayMatch = calculateTeamSimilarity(event1.awayTeam, event2.awayTeam, league);

  // Both teams must match with high confidence
  const avgConfidence = (homeMatch + awayMatch) / 2;
  const isMatch = homeMatch > 0.8 && awayMatch > 0.8;

  return { isMatch, confidence: avgConfidence };
}

/**
 * Find matching event in a list
 *
 * @param target - Target event with homeTeam and awayTeam
 * @param events - List of events to search
 * @param league - League slug (default: "ekstraklasa")
 */
export function findMatchingEvent<T extends { homeTeam: string; awayTeam: string }>(
  target: { homeTeam: string; awayTeam: string },
  events: T[],
  league: string = "ekstraklasa"
): { event: T; confidence: number } | null {
  let bestMatch: { event: T; confidence: number } | null = null;

  for (const event of events) {
    const { isMatch, confidence } = matchEvents(target, event, league);
    if (isMatch && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = { event, confidence };
    }
  }

  return bestMatch;
}
