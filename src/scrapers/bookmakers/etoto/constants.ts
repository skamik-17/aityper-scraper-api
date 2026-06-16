/**
 * eToto Constants
 *
 * URLs, API endpoints, category IDs, and game type mappings.
 * eToto uses a REST API for data fetching, not DOM scraping.
 */

/**
 * Base URL for the eToto website
 */
export const BASE_URL = "https://www.etoto.pl";

/**
 * API base URL for the eToto offer data
 */
export const API_BASE_URL = "https://api.etoto.pl/rest/market";

/**
 * Category IDs for eToto API
 * These map league slugs to eToto category IDs
 */
export const CATEGORY_IDS: Record<string, number> = {
  ekstraklasa: 666,
  "premier-league": 206,
  laliga: 1165,
  "serie-a": 209,
  "ligue-1": 350,
  "world-cup-2026": 15850,
};

/**
 * Game types used by eToto API
 * These identify different betting market types
 */
export const GAME_TYPES = {
  // Main markets
  MATCH_RESULT_1X2: 1,           // 1X2 - Match Result
  DOUBLE_CHANCE: 4,              // Double Chance (podwojna szansa)

  // Goals markets
  BTTS: 98,                      // Both Teams To Score (obie druzyny strzelą)
  TOTAL_GOALS: 8,                // Over/Under Total Goals (suma goli)

  // Handicap markets
  EUROPEAN_HANDICAP: 6,          // European Handicap

  // Half-time markets
  HALF_TIME_RESULT: 2,           // 1st Half Result
  HALF_TIME_TOTAL: 9,            // 1st Half Total Goals

  // Correct score
  CORRECT_SCORE: 10,             // Correct Score

  // Other markets
  DRAW_NO_BET: 5,                // Draw No Bet
  FIRST_TEAM_TO_SCORE: 3,        // First Team to Score
  LAST_TEAM_TO_SCORE: 21,        // Last Team to Score
  HALF_FULL_TIME: 7,             // Half-time/Full-time
  ODD_EVEN_GOALS: 11,            // Odd/Even Total Goals
  TOTAL_HOME_GOALS: 12,          // Home Team Total Goals
  TOTAL_AWAY_GOALS: 13,          // Away Team Total Goals
  EXACT_GOALS: 14,               // Exact Number of Goals
  WINNING_MARGIN: 15,            // Winning Margin
  HOME_WIN_TO_NIL: 16,           // Home Win to Nil
  AWAY_WIN_TO_NIL: 17,           // Away Win to Nil
  HOME_NO_BET: 18,               // Home No Bet
  AWAY_NO_BET: 19,               // Away No Bet
  GOAL_RANGE: 20,                // Goal Range
} as const;

/**
 * Market group names for UI organization
 * Maps game types to human-readable group names (in Polish)
 */
export const MARKET_GROUPS: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "Wynik meczu",
  [GAME_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [GAME_TYPES.BTTS]: "Gole",
  [GAME_TYPES.TOTAL_GOALS]: "Gole",
  [GAME_TYPES.EUROPEAN_HANDICAP]: "Handicap",
  [GAME_TYPES.HALF_TIME_RESULT]: "Pierwsza polowa",
  [GAME_TYPES.HALF_TIME_TOTAL]: "Pierwsza polowa",
  [GAME_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [GAME_TYPES.DRAW_NO_BET]: "Wynik meczu",
  [GAME_TYPES.FIRST_TEAM_TO_SCORE]: "Gole",
  [GAME_TYPES.LAST_TEAM_TO_SCORE]: "Gole",
  [GAME_TYPES.HALF_FULL_TIME]: "Wynik meczu",
  [GAME_TYPES.ODD_EVEN_GOALS]: "Gole",
  [GAME_TYPES.TOTAL_HOME_GOALS]: "Gole",
  [GAME_TYPES.TOTAL_AWAY_GOALS]: "Gole",
  [GAME_TYPES.EXACT_GOALS]: "Gole",
  [GAME_TYPES.WINNING_MARGIN]: "Wynik meczu",
  [GAME_TYPES.HOME_WIN_TO_NIL]: "Gole",
  [GAME_TYPES.AWAY_WIN_TO_NIL]: "Gole",
  [GAME_TYPES.HOME_NO_BET]: "Wynik meczu",
  [GAME_TYPES.AWAY_NO_BET]: "Wynik meczu",
  [GAME_TYPES.GOAL_RANGE]: "Gole",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "1X2",
  [GAME_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [GAME_TYPES.BTTS]: "BTTS",
  [GAME_TYPES.TOTAL_GOALS]: "OVER_UNDER",
  [GAME_TYPES.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [GAME_TYPES.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [GAME_TYPES.HALF_TIME_TOTAL]: "HALF_TIME_OVER_UNDER",
  [GAME_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [GAME_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.FIRST_TEAM_TO_SCORE]: "FIRST_TO_SCORE",
  [GAME_TYPES.LAST_TEAM_TO_SCORE]: "LAST_TO_SCORE",
  [GAME_TYPES.HALF_FULL_TIME]: "HALF_FULL_TIME",
  [GAME_TYPES.ODD_EVEN_GOALS]: "ODD_EVEN",
  [GAME_TYPES.TOTAL_HOME_GOALS]: "HOME_TOTAL",
  [GAME_TYPES.TOTAL_AWAY_GOALS]: "AWAY_TOTAL",
  [GAME_TYPES.EXACT_GOALS]: "EXACT_GOALS",
  [GAME_TYPES.WINNING_MARGIN]: "WINNING_MARGIN",
  [GAME_TYPES.HOME_WIN_TO_NIL]: "HOME_WIN_TO_NIL",
  [GAME_TYPES.AWAY_WIN_TO_NIL]: "AWAY_WIN_TO_NIL",
  [GAME_TYPES.HOME_NO_BET]: "HOME_NO_BET",
  [GAME_TYPES.AWAY_NO_BET]: "AWAY_NO_BET",
  [GAME_TYPES.GOAL_RANGE]: "GOAL_RANGE",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Character used by eToto to separate team names in eventName
 */
export const TEAM_SEPARATOR = " - ";

/**
 * Cache TTL for events data in milliseconds
 */
export const CACHE_TTL = 60000;
