/**
 * Fuksiarz Constants
 *
 * URLs, API endpoints, category IDs, and market mappings.
 * Fuksiarz uses a REST API for data fetching, accessed via page.evaluate.
 */

/**
 * Base URL for the Fuksiarz website
 */
export const BASE_URL = "https://fuksiarz.pl";

/**
 * API base URL for Fuksiarz events data
 */
export const API_BASE_URL = "https://fuksiarz.pl/rest/market/categories/multi";

/**
 * League page URLs for navigation (used to establish session)
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa",
  "premier-league": "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
  laliga: "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/hiszpania/laliga",
  "serie-a": "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/wlochy/serie-a",
  "ligue-1": "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/francja/ligue-1",
};

/**
 * Category IDs for Fuksiarz API
 * These are used to filter events by league in API requests
 * Found via network inspection of the Fuksiarz website
 */
export const CATEGORY_IDS: Record<string, number> = {
  ekstraklasa: 265,
  "premier-league": 625,
  laliga: 654,
  "serie-a": 635,
  "ligue-1": 1152,
};

/**
 * Game types used by Fuksiarz API for market identification
 */
export const GAME_TYPES = {
  MATCH_RESULT_1X2: 1,      // 1X2 - Match Result
  DOUBLE_CHANCE: 4,          // 1X, X2, 12 - Double Chance
  OVER_UNDER: 8,             // Over/Under Total Goals
  BTTS: 98,                  // Both Teams To Score
  HALF_TIME_RESULT: 2,       // 1st Half Result
  HALF_TIME_OVER_UNDER: 9,   // 1st Half Over/Under
  HALF_TIME_BTTS: 99,        // 1st Half BTTS
  CORRECT_SCORE: 10,         // Correct Score
  DRAW_NO_BET: 6,            // Draw No Bet
  HANDICAP: 5,               // European Handicap
  ASIAN_HANDICAP: 7,         // Asian Handicap
} as const;

/**
 * Mapping of game types to human-readable market names in Polish
 */
export const GAME_TYPE_NAMES: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "Wynik meczu",
  [GAME_TYPES.DOUBLE_CHANCE]: "Podwojna szansa",
  [GAME_TYPES.OVER_UNDER]: "Liczba goli",
  [GAME_TYPES.BTTS]: "Obie druzyny strzelą",
  [GAME_TYPES.HALF_TIME_RESULT]: "Wynik 1. polowy",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "Liczba goli 1. polowa",
  [GAME_TYPES.HALF_TIME_BTTS]: "Obie strzelą 1. polowa",
  [GAME_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [GAME_TYPES.DRAW_NO_BET]: "Remis = zwrot",
  [GAME_TYPES.HANDICAP]: "Handicap europejski",
  [GAME_TYPES.ASIAN_HANDICAP]: "Handicap azjatycki",
};

/**
 * Market group names for UI organization
 * Maps game types to group categories
 */
export const MARKET_GROUPS: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "Wynik meczu",
  [GAME_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [GAME_TYPES.DRAW_NO_BET]: "Wynik meczu",
  [GAME_TYPES.OVER_UNDER]: "Gole",
  [GAME_TYPES.BTTS]: "Gole",
  [GAME_TYPES.HALF_TIME_RESULT]: "Pierwsza polowa",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [GAME_TYPES.HALF_TIME_BTTS]: "Pierwsza polowa",
  [GAME_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [GAME_TYPES.HANDICAP]: "Handicap",
  [GAME_TYPES.ASIAN_HANDICAP]: "Handicap",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "1X2",
  [GAME_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [GAME_TYPES.OVER_UNDER]: "OVER_UNDER",
  [GAME_TYPES.BTTS]: "BTTS",
  [GAME_TYPES.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [GAME_TYPES.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [GAME_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [GAME_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.HANDICAP]: "EUROPEAN_HANDICAP",
  [GAME_TYPES.ASIAN_HANDICAP]: "ASIAN_HANDICAP",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Character used by Fuksiarz to separate team names in eventName
 */
export const TEAM_SEPARATOR = " - ";

/**
 * Cache TTL for events data in milliseconds (1 minute)
 */
export const CACHE_TTL = 60000;
