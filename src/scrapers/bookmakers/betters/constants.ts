/**
 * Betters Constants
 *
 * URLs, API endpoints, league IDs, and stake type mappings.
 * Betters uses network interception to capture data from sbteam.xyz API.
 *
 * IMPORTANT: The sbteam.xyz API requires explicit stakeTypes parameter.
 * To get ALL markets, we intercept requests and inject EXTENDED_STAKE_TYPE_IDS.
 */

/**
 * Base URL for the Betters SSR website
 */
export const BASE_URL = "https://betterspl-ssr.boxwebcdn.work";

/**
 * League IDs for Betters API
 * These are used in the /leagues/{id}/upcoming endpoint
 */
export const LEAGUE_IDS: Record<string, number> = {
  ekstraklasa: 4440,
  "premier-league": 4485,
  laliga: 4486,
  "serie-a": 4484,
  "ligue-1": 4610,
  "world-cup-2026": 52530,
};

/**
 * Stake type IDs for market parsing
 * Maps market types to their API IDs
 */
export const STAKE_TYPES = {
  /** 1X2 - Match result */
  MATCH_RESULT: 1,
  /** Double Chance - 1X, X2, 12 */
  DOUBLE_CHANCE: 37,
  /** Over/Under - Total goals */
  OVER_UNDER: 3,
  /** Both Teams To Score */
  BTTS: 26,
  /** Handicap */
  HANDICAP: 2,
  /** Half Time Result */
  HALF_TIME_RESULT: 11,
  /** Half Time Over/Under */
  HALF_TIME_OVER_UNDER: 12,
  /** Correct Score */
  CORRECT_SCORE: 5,
  /** Draw No Bet (actually maps to 274556 in API) */
  DRAW_NO_BET: 36,
  /** Half/Match combination */
  HALF_MATCH: 4,
  /** Highest scoring half */
  HIGHEST_SCORING_HALF: 7,
  /** Penalty in match */
  PENALTY: 8,
  /** Red card in match */
  RED_CARD: 9,
  /** Odd/Even total goals */
  ODD_EVEN: 11,
  /** Home team scores */
  HOME_SCORES: 27,
  /** Away team scores */
  AWAY_SCORES: 28,
  /** First half goal */
  FIRST_HALF_GOAL: 30,
  /** Second half goal */
  SECOND_HALF_GOAL: 31,
  /** Goal in both halves */
  GOAL_BOTH_HALVES: 32,
  /** Time of first goal */
  FIRST_GOAL_TIME: 38,
  /** Home goal in both halves */
  HOME_GOAL_BOTH_HALVES: 39,
  /** Away goal in both halves */
  AWAY_GOAL_BOTH_HALVES: 40,
  /** Both halves over 1.5 */
  BOTH_HALVES_OVER_1_5: 41,
  /** Both halves under 1.5 */
  BOTH_HALVES_UNDER_1_5: 42,
  /** Draw No Bet (actual API ID) */
  DRAW_NO_BET_API: 274556,
} as const;

/**
 * Extended list of stake type IDs to request from the API.
 * This ensures we get ALL available markets, not just the default 6.
 *
 * Includes:
 * - Original stakeTypes from website: [1, 80, 356, 702, 176415, 183254, 217797, 357318, 2, 3, 26, 37, 545, 144, 724, 274556, 313638, 313639]
 * - Common football market types: 1-50
 * - Additional discovered IDs from API responses
 */
export const EXTENDED_STAKE_TYPE_IDS: number[] = [
  // Common football markets (1-50)
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
  // Original website stakeTypes (high IDs)
  80, 144, 274556, 313638, 313639, 356, 357318, 545, 702, 724, 176415, 183254, 217797,
];

/**
 * Stake codes for 1X2 market
 */
export const STAKE_CODES_1X2 = {
  HOME: 1,
  DRAW: 2,
  AWAY: 3,
} as const;

/**
 * Market group names for UI organization
 * Maps stake type IDs to display group names
 */
export const MARKET_GROUPS: Record<number, string> = {
  [STAKE_TYPES.MATCH_RESULT]: "Wynik meczu",
  [STAKE_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [STAKE_TYPES.OVER_UNDER]: "Gole",
  [STAKE_TYPES.BTTS]: "Gole",
  [STAKE_TYPES.HANDICAP]: "Handicap",
  [STAKE_TYPES.HALF_TIME_RESULT]: "Pierwsza polowa",
  [STAKE_TYPES.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [STAKE_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [STAKE_TYPES.DRAW_NO_BET]: "Wynik meczu",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<number, string> = {
  [STAKE_TYPES.MATCH_RESULT]: "1X2",
  [STAKE_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [STAKE_TYPES.OVER_UNDER]: "OVER_UNDER",
  [STAKE_TYPES.BTTS]: "BTTS",
  [STAKE_TYPES.HANDICAP]: "HANDICAP",
  [STAKE_TYPES.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [STAKE_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [STAKE_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [STAKE_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Response capture timeout in milliseconds
 * Time to wait for API response interception
 */
export const CAPTURE_TIMEOUT = 8000;

/**
 * Cache time-to-live in milliseconds
 */
export const CACHE_TTL = 60000;

/**
 * Delay between event detail requests to avoid rate limiting (ms)
 */
export const EVENT_FETCH_DELAY = 150;

/**
 * Build league page URL
 */
export function buildLeagueUrl(leagueId: number): string {
  return `${BASE_URL}/pl/league/1/${leagueId}`;
}

/**
 * Build event page URL
 */
export function buildEventUrl(leagueId: number, eventId: number | string): string {
  return `${BASE_URL}/pl/event/1/${leagueId}/${eventId}`;
}
