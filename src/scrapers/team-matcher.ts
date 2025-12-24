/**
 * Team name matcher - maps bookmaker variations to canonical names
 *
 * This module provides functions to normalize team names from various
 * bookmakers to their canonical forms from TheSportsDB.
 */

import Fuse from "fuse.js";
import {
  EKSTRAKLASA_TEAMS,
  type CanonicalTeam,
} from "../data/canonical-teams.js";

/**
 * Explicit aliases for known abbreviations (bookmaker → canonical)
 * These are checked first before fuzzy matching
 */
const TEAM_ALIASES: Record<string, string> = {
  // Fortuna abbreviations
  "R.Radom": "Radomiak Radom",
  Radomiak: "Radomiak Radom",
  "Lechia G.": "Lechia Gdańsk",
  Lechia: "Lechia Gdańsk",
  "Zag.Lubin": "Zagłębie Lubin",
  Zagłębie: "Zagłębie Lubin",
  "Lech P.": "Lech Poznań",
  Lech: "Lech Poznań",
  "Legia W.": "Legia Warszawa",
  Legia: "Legia Warszawa",
  "Korona K.": "Korona Kielce",
  Korona: "Korona Kielce",
  "M.Lublin": "Motor Lublin",
  Motor: "Motor Lublin",
  "Pogoń Sz.": "Pogoń Szczecin",
  Pogoń: "Pogoń Szczecin",
  "Raków Cz.": "Raków Częstochowa",
  Raków: "Raków Częstochowa",
  "W.Płock": "Wisła Płock",
  Wisła: "Wisła Płock",
  Nieciecza: "Bruk-Bet Termalica Nieciecza",
  Termalica: "Bruk-Bet Termalica Nieciecza",
  "Termalica Nieciecza": "Bruk-Bet Termalica Nieciecza",
  "GKS Kat.": "GKS Katowice",
  GKS: "GKS Katowice",
  "Górnik Z.": "Górnik Zabrze",
  Górnik: "Górnik Zabrze",
  "Śląsk Wr.": "Śląsk Wrocław",
  Śląsk: "Śląsk Wrocław",
  "Widzew Ł.": "Widzew Łódź",
  Widzew: "Widzew Łódź",
  "Zagłębie L.": "Zagłębie Lubin",
  "Stal M.": "Stal Mielec",
  Stal: "Stal Mielec",
  "Piast G.": "Piast Gliwice",
  Piast: "Piast Gliwice",
  "Puszcza N.": "Puszcza Niepołomice",
  Puszcza: "Puszcza Niepołomice",
  "Jagiellonia B.": "Jagiellonia Białystok",
  Jagiellonia: "Jagiellonia Białystok",
  Jaga: "Jagiellonia Białystok",
  "Arka G.": "Arka Gdynia",
  Arka: "Arka Gdynia",
  "Cracovia Kraków": "Cracovia",
};

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

// Fuse.js instance for fuzzy matching
const fuse = new Fuse(EKSTRAKLASA_TEAMS, {
  keys: ["name", "normalized"],
  threshold: 0.4,
  includeScore: true,
});

/**
 * Match scraped team name to canonical form
 * Returns the canonical CanonicalTeam or null if no match found
 *
 * Matching priority:
 * 1. Explicit aliases (fastest, for known abbreviations)
 * 2. Exact normalized match
 * 3. Substring match (normalized contains canonical or vice versa)
 * 4. Fuzzy match using Fuse.js (last resort)
 */
export function matchToCanonical(scrapedName: string): CanonicalTeam | null {
  // 1. Check explicit aliases first (fastest path for known abbreviations)
  const aliasMatch = TEAM_ALIASES[scrapedName];
  if (aliasMatch) {
    return EKSTRAKLASA_TEAMS.find((t) => t.name === aliasMatch) ?? null;
  }

  // 2. Check exact normalized match
  const normalized = normalize(scrapedName);
  const exactMatch = EKSTRAKLASA_TEAMS.find((t) => t.normalized === normalized);
  if (exactMatch) {
    return exactMatch;
  }

  // 3. Check if normalized contains canonical or vice versa
  for (const team of EKSTRAKLASA_TEAMS) {
    if (
      normalized.includes(team.normalized) ||
      team.normalized.includes(normalized)
    ) {
      return team;
    }
  }

  // 4. Fuzzy match as last resort
  const fuseResult = fuse.search(scrapedName);
  if (
    fuseResult.length > 0 &&
    fuseResult[0].score !== undefined &&
    fuseResult[0].score < 0.4
  ) {
    return fuseResult[0].item;
  }

  // 5. No match found - log warning for debugging
  console.warn(
    `[TeamMatcher] Unknown team name: "${scrapedName}" (normalized: "${normalized}")`
  );
  return null;
}

/**
 * Get canonical team name or return original if no match
 * Use this for display purposes
 */
export function getCanonicalTeamName(scrapedName: string): string {
  const match = matchToCanonical(scrapedName);
  return match?.name ?? scrapedName;
}

/**
 * Get normalized form for database storage
 * Use this for database keys and matching
 */
export function getNormalizedTeamName(scrapedName: string): string {
  const match = matchToCanonical(scrapedName);
  return match?.normalized ?? normalize(scrapedName);
}

/**
 * Check if a team name matches a canonical team
 */
export function isKnownTeam(scrapedName: string): boolean {
  return matchToCanonical(scrapedName) !== null;
}

/**
 * Calculate similarity between two team names using canonical matching
 */
export function calculateTeamSimilarity(name1: string, name2: string): number {
  const canonical1 = getCanonicalTeamName(name1);
  const canonical2 = getCanonicalTeamName(name2);

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
 */
export function matchEvents(
  event1: { homeTeam: string; awayTeam: string },
  event2: { homeTeam: string; awayTeam: string }
): { isMatch: boolean; confidence: number } {
  const homeMatch = calculateTeamSimilarity(event1.homeTeam, event2.homeTeam);
  const awayMatch = calculateTeamSimilarity(event1.awayTeam, event2.awayTeam);

  // Both teams must match with high confidence
  const avgConfidence = (homeMatch + awayMatch) / 2;
  const isMatch = homeMatch > 0.8 && awayMatch > 0.8;

  return { isMatch, confidence: avgConfidence };
}

/**
 * Find matching event in a list
 */
export function findMatchingEvent<T extends { homeTeam: string; awayTeam: string }>(
  target: { homeTeam: string; awayTeam: string },
  events: T[]
): { event: T; confidence: number } | null {
  let bestMatch: { event: T; confidence: number } | null = null;

  for (const event of events) {
    const { isMatch, confidence } = matchEvents(target, event);
    if (isMatch && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = { event, confidence };
    }
  }

  return bestMatch;
}
