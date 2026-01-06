/**
 * Fortuna Constants
 *
 * URLs, API endpoints, tournament IDs, and market ID mappings.
 * Fortuna uses a REST API (api.efortuna.pl) for data fetching.
 */

/**
 * Base URL for the Fortuna website
 */
export const BASE_URL = "https://www.efortuna.pl";

/**
 * API base URL for Fortuna structure data (fixtures, tournaments)
 */
export const API_STRUCTURE_URL = "https://api.efortuna.pl/offer/structure/api/v1_0";

/**
 * API base URL for Fortuna market data (odds)
 */
export const API_MARKETS_URL = "https://api.efortuna.pl/offer/markets/api/v1_0";

/**
 * League URLs for navigation (used as reference, not for scraping)
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/polska-ekstraklasa",
  "premier-league":
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/anglia-2/1-anglia-1",
  laliga:
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/hiszpania/1-hiszpania",
  "serie-a":
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/wlochy/1-wlochy",
  "ligue-1":
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/francja/1-francja",
};

/**
 * Tournament IDs for Fortuna API
 * Format: "ufo:tour:XX-XXX"
 * Found via network inspection of the Fortuna API
 */
export const TOURNAMENT_IDS: Record<string, string> = {
  ekstraklasa: "ufo:tour:00-0b9",       // Ekstraklasa (Poland)
  "premier-league": "ufo:tour:00-03m",  // Premier League (England)
  laliga: "ufo:tour:00-0h7",            // La Liga (Spain)
  "serie-a": "ufo:tour:00-06t",         // Serie A (Italy)
  "ligue-1": "ufo:tour:00-0bo",         // Ligue 1 (France)
};

/**
 * Market type IDs used by Fortuna API
 * Format: "ufo:mtyp:XX-XX"
 */
export const MARKET_TYPE_IDS = {
  // Main markets
  MATCH_RESULT: "ufo:mtyp:00-00",      // Wynik meczu (1X2)
  DOUBLE_CHANCE: "ufo:mtyp:00-01",     // Mecz: dwojtyp (1X, X2, 12)

  // Goals markets
  OVER_UNDER: "ufo:mtyp:00-0u",        // Mecz: liczba goli (Over/Under)
  BTTS: "ufo:mtyp:00-1c",              // Mecz: obie druzyny strzela gola

  // Half-time markets
  HALF_TIME_RESULT: "ufo:mtyp:00-02",  // Wynik 1. polowy (1X2)
  HALF_TIME_OVER_UNDER: "ufo:mtyp:00-18", // Liczba goli 1. polowa
  HALF_TIME_BTTS: "ufo:mtyp:00-1d",    // Obie strzelaja 1. polowa

  // Handicap markets
  ASIAN_HANDICAP: "ufo:mtyp:00-0v",    // Handicap azjatycki
  EUROPEAN_HANDICAP: "ufo:mtyp:00-0w", // Handicap europejski

  // Other markets
  CORRECT_SCORE: "ufo:mtyp:00-04",     // Dokladny wynik
  DRAW_NO_BET: "ufo:mtyp:00-03",       // Remis = zwrot
  ODD_EVEN_GOALS: "ufo:mtyp:00-1a",    // Parzyste/Nieparzyste
} as const;

/**
 * Selection codes used in Fortuna API responses
 * Maps to outcome names
 */
export const SELECTION_CODES = {
  // 1X2 outcomes
  HOME: "1",
  DRAW: "0",
  AWAY: "2",

  // Double Chance outcomes
  HOME_OR_DRAW: "10",
  DRAW_OR_AWAY: "02",
  HOME_OR_AWAY: "12",
} as const;

/**
 * Market group names for UI organization
 * Maps market type IDs to human-readable group names
 */
export const MARKET_GROUPS: Record<string, string> = {
  [MARKET_TYPE_IDS.MATCH_RESULT]: "Wynik meczu",
  [MARKET_TYPE_IDS.DOUBLE_CHANCE]: "Wynik meczu",
  [MARKET_TYPE_IDS.OVER_UNDER]: "Gole",
  [MARKET_TYPE_IDS.BTTS]: "Gole",
  [MARKET_TYPE_IDS.HALF_TIME_RESULT]: "Pierwsza polowa",
  [MARKET_TYPE_IDS.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [MARKET_TYPE_IDS.HALF_TIME_BTTS]: "Pierwsza polowa",
  [MARKET_TYPE_IDS.ASIAN_HANDICAP]: "Handicap",
  [MARKET_TYPE_IDS.EUROPEAN_HANDICAP]: "Handicap",
  [MARKET_TYPE_IDS.CORRECT_SCORE]: "Dokladny wynik",
  [MARKET_TYPE_IDS.DRAW_NO_BET]: "Wynik meczu",
  [MARKET_TYPE_IDS.ODD_EVEN_GOALS]: "Gole",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<string, string> = {
  [MARKET_TYPE_IDS.MATCH_RESULT]: "1X2",
  [MARKET_TYPE_IDS.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [MARKET_TYPE_IDS.OVER_UNDER]: "OVER_UNDER",
  [MARKET_TYPE_IDS.BTTS]: "BTTS",
  [MARKET_TYPE_IDS.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [MARKET_TYPE_IDS.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [MARKET_TYPE_IDS.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [MARKET_TYPE_IDS.ASIAN_HANDICAP]: "ASIAN_HANDICAP",
  [MARKET_TYPE_IDS.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [MARKET_TYPE_IDS.CORRECT_SCORE]: "CORRECT_SCORE",
  [MARKET_TYPE_IDS.DRAW_NO_BET]: "DRAW_NO_BET",
  [MARKET_TYPE_IDS.ODD_EVEN_GOALS]: "ODD_EVEN",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Delay between API requests in milliseconds (to avoid rate limiting)
 */
export const API_REQUEST_DELAY = 100;
