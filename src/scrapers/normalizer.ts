/**
 * Team name normalizer for matching across different bookmakers
 * Uses fuzzy matching to handle variations in team names
 */

import Fuse from "fuse.js";

// Common team name mappings for Polish Ekstraklasa
const TEAM_NAME_MAPPINGS: Record<string, string[]> = {
  "Lech Poznan": ["Lech", "Lech Poznań", "KKS Lech Poznań", "KKS Lech"],
  "Legia Warszawa": ["Legia", "Legia Warsaw", "CWKS Legia"],
  "Wisla Plock": ["Wisła Płock", "Wisla", "Wisła", "Oil Wisła Płock"],
  "Rakow Czestochowa": ["Raków", "Rakow", "Raków Częstochowa", "RKS Raków"],
  "Jagiellonia Bialystok": ["Jagiellonia", "Jaga", "Jagiellonia Białystok"],
  "Pogon Szczecin": ["Pogoń", "Pogon", "Pogoń Szczecin", "MKS Pogoń"],
  "Slask Wroclaw": ["Śląsk", "Slask", "Śląsk Wrocław", "WKS Śląsk"],
  "Gornik Zabrze": ["Górnik", "Gornik", "Górnik Zabrze", "GKS Górnik"],
  "Zaglebie Lubin": ["Zagłębie", "Zaglebie", "Zagłębie Lubin", "KGHM Zagłębie"],
  "Cracovia": ["Cracovia Kraków", "MKS Cracovia", "KS Cracovia"],
  "Piast Gliwice": ["Piast", "GKS Piast Gliwice"],
  "Korona Kielce": ["Korona", "KS Korona Kielce"],
  "Motor Lublin": ["Motor", "Motor Lublin SA"],
  "Stal Mielec": ["Stal", "FKS Stal Mielec", "PGE FKS Stal Mielec"],
  "Radomiak Radom": ["Radomiak", "RKS Radomiak"],
  "Puszcza Niepolomice": ["Puszcza", "Puszcza Niepołomice"],
  "GKS Katowice": ["GKS", "GKS Katowice", "GieKSa"],
  "Widzew Lodz": ["Widzew", "Widzew Łódź", "RTS Widzew"],
  "Lechia Gdansk": ["Lechia", "Lechia Gdańsk", "BKS Lechia"],
  "Warta Poznan": ["Warta", "Warta Poznań", "KS Warta"],
};

// Create a normalized name for matching
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();
}

// Find the canonical team name
export function getCanonicalTeamName(inputName: string): string {
  const normalized = normalizeTeamName(inputName);

  // Check direct mappings
  for (const [canonical, variations] of Object.entries(TEAM_NAME_MAPPINGS)) {
    if (normalizeTeamName(canonical) === normalized) {
      return canonical;
    }
    for (const variation of variations) {
      if (normalizeTeamName(variation) === normalized) {
        return canonical;
      }
    }
  }

  // If no mapping found, return cleaned input
  return inputName.replace(/\s+/g, " ").trim();
}

// Calculate similarity score between two team names
export function calculateTeamSimilarity(name1: string, name2: string): number {
  const canonical1 = getCanonicalTeamName(name1);
  const canonical2 = getCanonicalTeamName(name2);

  if (canonical1 === canonical2) {
    return 1.0;
  }

  // Use Fuse.js for fuzzy matching
  const fuse = new Fuse([canonical2], {
    includeScore: true,
    threshold: 0.6,
  });

  const result = fuse.search(canonical1);

  if (result.length > 0 && result[0].score !== undefined) {
    return 1 - result[0].score;
  }

  return 0;
}

// Match two events based on team names
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

// Find matching event in a list
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

// Get all known team names for search
export function getAllTeamNames(): string[] {
  const names: string[] = [];
  for (const [canonical, variations] of Object.entries(TEAM_NAME_MAPPINGS)) {
    names.push(canonical);
    names.push(...variations);
  }
  return [...new Set(names)];
}
