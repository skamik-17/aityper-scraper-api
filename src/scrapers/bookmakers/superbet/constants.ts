/**
 * Superbet Constants
 *
 * URLs, API endpoints, tournament IDs, and market ID mappings.
 * Superbet uses a REST API for data fetching, not DOM scraping.
 */

/**
 * Base URL for the Superbet website
 */
export const BASE_URL = "https://www.superbet.pl";

/**
 * API base URL for the Superbet offer data
 * This CDN endpoint serves prematch betting data
 */
export const API_BASE_URL = "https://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL";

/**
 * League URLs for navigation (used to establish session cookies)
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa",
  "premier-league": "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
  laliga: "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/hiszpania/laliga",
  "serie-a": "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/wlochy/serie-a",
  "ligue-1": "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/francja/ligue-1",
};

/**
 * Tournament IDs for Superbet API
 * These are used to filter events by league in API requests
 * Found via network inspection of the Superbet website
 */
export const TOURNAMENT_IDS: Record<string, number[]> = {
  ekstraklasa: [644],       // Ekstraklasa (Poland)
  "premier-league": [106],  // Premier League (England)
  laliga: [98],             // La Liga (Spain)
  "serie-a": [104],         // Serie A (Italy)
  "ligue-1": [100],         // Ligue 1 (France)
};

/**
 * Sport ID for football/soccer in Superbet API
 */
export const SPORT_ID_FOOTBALL = 5;

/**
 * Market IDs used by Superbet API
 * These identify different betting market types
 */
export const MARKET_IDS = {
  // Main markets
  MATCH_RESULT_1X2: 547,       // 1X2 - Match Result
  DOUBLE_CHANCE: 548,          // 1X, X2, 12
  DOUBLE_CHANCE_ALT: 531,      // Alternative Double Chance market ID

  // Goals markets
  BTTS: 539,                   // Both Teams To Score (GG/NG)
  BTTS_ALT: 559,               // Alternative BTTS market ID
  TOTAL_GOALS: 200734,         // Over/Under Total Goals
  TOTAL_GOALS_ALT: 551,        // Alternative Over/Under
  TOTAL_GOALS_ALT2: 552,       // Another alternative

  // Handicap markets
  ASIAN_HANDICAP: 549,         // Asian Handicap
  EUROPEAN_HANDICAP: 550,      // European Handicap

  // Half-time markets
  HALF_TIME_RESULT: 553,       // 1st Half Result
  HALF_TIME_TOTAL: 554,        // 1st Half Total Goals
  HALF_TIME_BTTS: 557,         // 1st Half Both Teams Score

  // Correct score
  CORRECT_SCORE: 556,          // Correct Score

  // Player markets
  GOAL_SCORER: 600,            // Anytime Goalscorer
  FIRST_GOAL_SCORER: 601,      // First Goalscorer

  // Other markets
  ODD_EVEN_GOALS: 558,         // Odd/Even Total Goals
  DRAW_NO_BET: 560,            // Draw No Bet
  WIN_TO_NIL: 561,             // Win To Nil
  CLEAN_SHEET: 562,            // Clean Sheet
} as const;

/**
 * Selection codes used in Superbet API responses
 * Maps to outcome names
 */
export const SELECTION_CODES = {
  // 1X2 outcomes
  HOME: "1",
  DRAW: "0",
  AWAY: "2",

  // Double Chance outcomes
  HOME_OR_DRAW: "10",
  HOME_OR_DRAW_ALT: "1X",
  DRAW_OR_AWAY: "02",
  DRAW_OR_AWAY_ALT: "X2",
  HOME_OR_AWAY: "12",

  // Over/Under outcomes
  OVER: "O",
  UNDER: "U",

  // BTTS outcomes
  BTTS_YES: "GG",
  BTTS_YES_ALT: "1",
  BTTS_NO: "NG",
  BTTS_NO_ALT: "2",
} as const;

/**
 * Market group names for UI organization
 * Maps market IDs to human-readable group names
 */
export const MARKET_GROUPS: Record<number, string> = {
  [MARKET_IDS.MATCH_RESULT_1X2]: "Wynik meczu",
  [MARKET_IDS.DOUBLE_CHANCE]: "Wynik meczu",
  [MARKET_IDS.DOUBLE_CHANCE_ALT]: "Wynik meczu",
  [MARKET_IDS.BTTS]: "Gole",
  [MARKET_IDS.BTTS_ALT]: "Gole",
  [MARKET_IDS.TOTAL_GOALS]: "Gole",
  [MARKET_IDS.TOTAL_GOALS_ALT]: "Gole",
  [MARKET_IDS.TOTAL_GOALS_ALT2]: "Gole",
  [MARKET_IDS.ASIAN_HANDICAP]: "Handicap",
  [MARKET_IDS.EUROPEAN_HANDICAP]: "Handicap",
  [MARKET_IDS.HALF_TIME_RESULT]: "Pierwsza polowa",
  [MARKET_IDS.HALF_TIME_TOTAL]: "Pierwsza polowa",
  [MARKET_IDS.HALF_TIME_BTTS]: "Pierwsza polowa",
  [MARKET_IDS.CORRECT_SCORE]: "Dokladny wynik",
  [MARKET_IDS.ODD_EVEN_GOALS]: "Gole",
  [MARKET_IDS.DRAW_NO_BET]: "Wynik meczu",
  [MARKET_IDS.WIN_TO_NIL]: "Gole",
  [MARKET_IDS.CLEAN_SHEET]: "Gole",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<number, string> = {
  [MARKET_IDS.MATCH_RESULT_1X2]: "1X2",
  [MARKET_IDS.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [MARKET_IDS.DOUBLE_CHANCE_ALT]: "DOUBLE_CHANCE",
  [MARKET_IDS.BTTS]: "BTTS",
  [MARKET_IDS.BTTS_ALT]: "BTTS",
  [MARKET_IDS.TOTAL_GOALS]: "OVER_UNDER",
  [MARKET_IDS.TOTAL_GOALS_ALT]: "OVER_UNDER",
  [MARKET_IDS.TOTAL_GOALS_ALT2]: "OVER_UNDER",
  [MARKET_IDS.ASIAN_HANDICAP]: "ASIAN_HANDICAP",
  [MARKET_IDS.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [MARKET_IDS.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [MARKET_IDS.HALF_TIME_TOTAL]: "HALF_TIME_OVER_UNDER",
  [MARKET_IDS.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [MARKET_IDS.CORRECT_SCORE]: "CORRECT_SCORE",
  [MARKET_IDS.ODD_EVEN_GOALS]: "ODD_EVEN",
  [MARKET_IDS.DRAW_NO_BET]: "DRAW_NO_BET",
  [MARKET_IDS.WIN_TO_NIL]: "WIN_TO_NIL",
  [MARKET_IDS.CLEAN_SHEET]: "CLEAN_SHEET",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Character used by Superbet to separate team names in matchName
 */
export const TEAM_SEPARATOR = "·";
