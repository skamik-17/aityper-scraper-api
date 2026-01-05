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
  "Legia W.": "Legia Warszawa",
  Legia: "Legia Warszawa",
  "Legia Warsaw": "Legia Warszawa",
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
 * Explicit aliases for La Liga (bookmaker -> TheSportsDB canonical)
 * Common abbreviations used by Polish bookmakers
 */
const LALIGA_ALIASES: Record<string, string> = {
  // Real Madrid
  Real: "Real Madrid",
  "R. Madrid": "Real Madrid",
  "Real Mad.": "Real Madrid",

  // Barcelona
  Barca: "Barcelona",
  "FC Barcelona": "Barcelona",
  "Barça": "Barcelona",

  // Atletico Madrid
  "Atl. Madrid": "Atletico Madrid",
  Atletico: "Atletico Madrid",
  Atleti: "Atletico Madrid",
  "Atlético Madrid": "Atletico Madrid",
  "Atletico Madryt": "Atletico Madrid",
  "Atl Madrid": "Atletico Madrid",

  // Athletic Bilbao
  Athletic: "Athletic Bilbao",
  "Ath. Bilbao": "Athletic Bilbao",
  "Athletic Club": "Athletic Bilbao",

  // Rayo Vallecano
  Rayo: "Vallecano",
  "Rayo Vallecano": "Vallecano",

  // Celta Vigo
  Celta: "Celta Vigo",
  "Celta de Vigo": "Celta Vigo",
  "RC Celta": "Celta Vigo",

  // Real Sociedad
  "Real Soc.": "Real Sociedad",
  "R. Sociedad": "Real Sociedad",
  Sociedad: "Real Sociedad",

  // Real Betis
  Betis: "Real Betis",
  "R. Betis": "Real Betis",

  // Deportivo Alaves
  "Deportivo Alaves": "Alaves",
  "Deportivo Alavés": "Alaves",
  "D. Alaves": "Alaves",
  Alavés: "Alaves",

  // Espanyol
  "RCD Espanyol": "Espanyol",
  "Espanyol Barcelona": "Espanyol",

  // Getafe
  "Getafe CF": "Getafe",

  // Girona
  "Girona FC": "Girona",

  // Las Palmas
  "UD Las Palmas": "Las Palmas",
  "U.D. Las Palmas": "Las Palmas",

  // Leganes
  "CD Leganes": "Leganes",
  "CD Leganés": "Leganes",
  Leganés: "Leganes",

  // Mallorca
  "RCD Mallorca": "Mallorca",
  "Real Mallorca": "Mallorca",

  // Osasuna
  "CA Osasuna": "Osasuna",

  // Sevilla
  "Sevilla FC": "Sevilla",

  // Valencia
  "Valencia CF": "Valencia",

  // Valladolid
  "Real Valladolid": "Valladolid",
  "R. Valladolid": "Valladolid",

  // Villarreal
  "Villarreal CF": "Villarreal",

  // Elche
  "Elche CF": "Elche",
  "Elche Cf": "Elche",

  // Levante
  "Levante UD": "Levante",
  "UD Levante": "Levante",
  "Ud Levante": "Levante",
};

/**
 * Explicit aliases for Serie A (bookmaker -> TheSportsDB canonical)
 * Common abbreviations used by Polish bookmakers
 */
const SERIE_A_ALIASES: Record<string, string> = {
  // AC Milan
  Milan: "AC Milan",
  "AC Milan Mediolan": "AC Milan",
  "A.C. Milan": "AC Milan",
  "Ac Milan": "AC Milan",

  // Inter Milan
  Inter: "Inter Milan",
  "Inter Mediolan": "Inter Milan",
  Internazionale: "Inter Milan",
  "FC Internazionale": "Inter Milan",
  "Inter Milano": "Inter Milan",
  "FC Inter": "Inter Milan",

  // Juventus
  Juve: "Juventus",
  "Juventus FC": "Juventus",
  "Juventus Turyn": "Juventus",
  "Juventus Turin": "Juventus",
  "Fc Juventus": "Juventus",

  // Roma
  "AS Roma": "Roma",
  "AS Roma Rzym": "Roma",
  "A.S. Roma": "Roma",
  "As Roma": "Roma",

  // Lazio
  "SS Lazio": "Lazio",
  "S.S. Lazio": "Lazio",
  "Lazio Rzym": "Lazio",
  "Ss Lazio": "Lazio",

  // Napoli
  "SSC Napoli": "Napoli",
  "S.S.C. Napoli": "Napoli",
  "SSC Neapol": "Napoli",
  Neapol: "Napoli",

  // Atalanta
  "Atalanta BC": "Atalanta",
  "Atalanta Bergamo": "Atalanta",
  "Atalanta B.C.": "Atalanta",

  // Fiorentina
  "ACF Fiorentina": "Fiorentina",
  "AC Fiorentina": "Fiorentina",
  "Fiorentina Florencja": "Fiorentina",
  Florencja: "Fiorentina",

  // Bologna
  "Bologna FC": "Bologna",
  "Bologna FC 1909": "Bologna",

  // Torino
  "Torino FC": "Torino",
  "FC Torino": "Torino",
  "Torino Turyn": "Torino",
  Turyn: "Torino",

  // Udinese
  "Udinese Calcio": "Udinese",

  // Genoa
  "Genoa CFC": "Genoa",
  "Genoa FC": "Genoa",
  Genua: "Genoa",

  // Cagliari
  "Cagliari Calcio": "Cagliari",

  // Lecce
  "US Lecce": "Lecce",
  "U.S. Lecce": "Lecce",

  // Empoli
  "Empoli FC": "Empoli",

  // Hellas Verona
  Verona: "Hellas Verona",
  "Hellas Verona FC": "Hellas Verona",
  "H. Verona": "Hellas Verona",
  "Hellas V.": "Hellas Verona",

  // Venezia
  "Venezia FC": "Venezia",
  Wenecja: "Venezia",

  // Monza
  "AC Monza": "Monza",
  "A.C. Monza": "Monza",

  // Como
  "Como 1907": "Como",
  "Como FC": "Como",

  // Parma
  "Parma Calcio": "Parma",
  "Parma Calcio 1913": "Parma",
  "Parma FC": "Parma",
};

/**
 * Explicit aliases for Ligue 1 (bookmaker -> TheSportsDB canonical)
 * Common abbreviations used by Polish bookmakers
 */
const LIGUE_1_ALIASES: Record<string, string> = {
  // Paris Saint-Germain (most important)
  PSG: "Paris SG",
  "Paris Saint-Germain": "Paris SG",
  "Paris St Germain": "Paris SG",
  "Paris St-Germain": "Paris SG",
  "Paris S.G.": "Paris SG",
  "Paris St. Germain": "Paris SG",

  // Olympique Marseille
  OM: "Marseille",
  "Olympique Marseille": "Marseille",
  "Olympique de Marseille": "Marseille",
  "Olympique Marsylia": "Marseille",
  Marsylia: "Marseille",

  // Olympique Lyon
  OL: "Lyon",
  "Olympique Lyon": "Lyon",
  "Olympique Lyonnais": "Lyon",

  // Monaco
  "AS Monaco": "Monaco",
  "AS Monaco FC": "Monaco",

  // Lille
  LOSC: "Lille",
  "LOSC Lille": "Lille",
  "OSC Lille": "Lille",
  "Lille OSC": "Lille",

  // Nice
  "OGC Nice": "Nice",
  "OGC Nicea": "Nice",
  Nicea: "Nice",

  // Lens
  "RC Lens": "Lens",
  "Racing Lens": "Lens",

  // Rennes
  "Stade Rennais": "Rennes",
  "Stade Rennais FC": "Rennes",

  // Nantes
  "FC Nantes": "Nantes",

  // Strasbourg
  "RC Strasbourg": "Strasbourg",
  "RC Strasbourg Alsace": "Strasbourg",
  Strasburg: "Strasbourg",

  // Saint-Etienne
  "AS Saint-Etienne": "Saint-Etienne",
  ASSE: "Saint-Etienne",
  "AS St Etienne": "Saint-Etienne",
  "AS St-Etienne": "Saint-Etienne",
  "St Etienne": "Saint-Etienne",
  "St-Etienne": "Saint-Etienne",
  "St. Etienne": "Saint-Etienne",

  // Reims
  "Stade de Reims": "Reims",
  "Stade Reims": "Reims",

  // Montpellier
  "Montpellier HSC": "Montpellier",
  "HSC Montpellier": "Montpellier",

  // Toulouse
  "Toulouse FC": "Toulouse",
  TFC: "Toulouse",

  // Brest
  "Stade Brestois": "Brest",
  "Stade Brestois 29": "Brest",

  // Le Havre
  "Le Havre AC": "Le Havre",
  HAC: "Le Havre",
  Havre: "Le Havre",

  // Metz
  "FC Metz": "Metz",

  // Lorient
  "FC Lorient": "Lorient",

  // Angers
  "Angers SCO": "Angers",
  "SCO Angers": "Angers",

  // Auxerre
  "AJ Auxerre": "Auxerre",

  // Paris FC (second Paris team)
  "Paris FC (W)": "Paris FC",
};

/**
 * Map of league to aliases
 */
const LEAGUE_ALIASES: Record<string, Record<string, string>> = {
  ekstraklasa: EKSTRAKLASA_ALIASES,
  "premier-league": PREMIER_LEAGUE_ALIASES,
  laliga: LALIGA_ALIASES,
  "serie-a": SERIE_A_ALIASES,
  "ligue-1": LIGUE_1_ALIASES,
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
