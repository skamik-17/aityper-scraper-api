/**
 * forBET Constants
 *
 * URLs, API endpoints, category IDs, and market type mappings.
 * forBET uses a REST API for data fetching - no DOM scraping needed.
 */

/**
 * Base URL for the forBET website
 */
export const BASE_URL = "https://www.iforbet.pl";

/**
 * API base URL for forBET event data
 * Events are fetched per category with gamesClass=major filter
 */
export const API_BASE_URL = "https://www.iforbet.pl/rest/market/categories/multi";

/**
 * Category IDs for leagues in forBET API
 * These are used to fetch events for specific leagues
 * Found via network inspection of the forBET website
 */
export const CATEGORY_IDS: Record<string, number> = {
  ekstraklasa: 29994,
  "premier-league": 199,
  laliga: 159,
  "serie-a": 118,
  "ligue-1": 165,
};

/**
 * League URLs for navigation (used to establish session cookies)
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.iforbet.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa",
  "premier-league": "https://www.iforbet.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
  laliga: "https://www.iforbet.pl/zaklady-bukmacherskie/pilka-nozna/hiszpania/la-liga",
  "serie-a": "https://www.iforbet.pl/zaklady-bukmacherskie/pilka-nozna/wlochy/serie-a",
  "ligue-1": "https://www.iforbet.pl/zaklady-bukmacherskie/pilka-nozna/francja/ligue-1",
};

/**
 * Game types used in forBET API
 * These identify different betting market types
 */
export const GAME_TYPES = {
  // Main markets
  MATCH_RESULT_1X2: 1,         // 1X2 - Match Result (gameName: "1x2")
  DOUBLE_CHANCE: 4,            // Podwojna Szansa (gameName includes "szansa")

  // Goals markets
  BTTS: 98,                    // Obie druzyny strzelą (gameName includes "obie" + "strzelą")
  OVER_UNDER: 8,               // Poniżej/powyżej X.X goli
  TOTAL_GOALS_EXACT: 9,        // Exact number of goals

  // Half-time markets
  HALF_TIME_1X2: 5,            // 1st half result
  HALF_TIME_OVER_UNDER: 10,    // 1st half over/under
  HALF_TIME_BTTS: 99,          // 1st half both teams score

  // Handicap markets
  EUROPEAN_HANDICAP: 6,        // European handicap
  ASIAN_HANDICAP: 7,           // Asian handicap

  // Other markets
  CORRECT_SCORE: 2,            // Correct score
  HALF_TIME_FULL_TIME: 3,      // HT/FT result
  DRAW_NO_BET: 11,             // Draw no bet
  WIN_MARGIN: 12,              // Win margin
} as const;

/**
 * Market group names for UI organization
 * Maps game types to human-readable group names
 */
export const MARKET_GROUPS: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "Wynik meczu",
  [GAME_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [GAME_TYPES.BTTS]: "Gole",
  [GAME_TYPES.OVER_UNDER]: "Gole",
  [GAME_TYPES.TOTAL_GOALS_EXACT]: "Gole",
  [GAME_TYPES.HALF_TIME_1X2]: "Pierwsza polowa",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [GAME_TYPES.HALF_TIME_BTTS]: "Pierwsza polowa",
  [GAME_TYPES.EUROPEAN_HANDICAP]: "Handicap",
  [GAME_TYPES.ASIAN_HANDICAP]: "Handicap",
  [GAME_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [GAME_TYPES.HALF_TIME_FULL_TIME]: "Polowa/Koniec",
  [GAME_TYPES.DRAW_NO_BET]: "Wynik meczu",
  [GAME_TYPES.WIN_MARGIN]: "Wynik meczu",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "1X2",
  [GAME_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [GAME_TYPES.BTTS]: "BTTS",
  [GAME_TYPES.OVER_UNDER]: "OVER_UNDER",
  [GAME_TYPES.TOTAL_GOALS_EXACT]: "TOTAL_GOALS_EXACT",
  [GAME_TYPES.HALF_TIME_1X2]: "HALF_TIME_1X2",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [GAME_TYPES.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [GAME_TYPES.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [GAME_TYPES.ASIAN_HANDICAP]: "ASIAN_HANDICAP",
  [GAME_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [GAME_TYPES.HALF_TIME_FULL_TIME]: "HALF_TIME_FULL_TIME",
  [GAME_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.WIN_MARGIN]: "WIN_MARGIN",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Cache TTL for event data in milliseconds
 */
export const CACHE_TTL = 60000;

/**
 * Character used by forBET to separate team names
 */
export const TEAM_SEPARATOR = " - ";
