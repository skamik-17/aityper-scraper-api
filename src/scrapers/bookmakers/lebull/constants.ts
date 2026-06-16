/**
 * LeBull Constants
 *
 * URLs, API endpoints, league IDs, and stake type mappings.
 * LeBull uses the sbteam.xyz backend (shared with Betters).
 * Data is fetched via network interception of API responses.
 */

/**
 * Base URL for the LeBull website (SSR version)
 */
export const BASE_URL = "https://lebullpl-ssr.boxwebcdn.work";

/**
 * Sport ID for football in sbteam.xyz API
 */
export const SPORT_ID = 1;

/**
 * League IDs for LeBull sbteam.xyz API
 * These map to the /leagues/{id}/upcoming endpoint
 */
export const LEAGUE_IDS: Record<string, number> = {
  ekstraklasa: 4847,
  "premier-league": 4485,
  laliga: 4486,
  "serie-a": 4484,
  "ligue-1": 4610,
  "world-cup-2026": 52530,
};

/**
 * League URLs for navigation (used to trigger API calls)
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: `${BASE_URL}/pl/league/${SPORT_ID}/4847`,
  "premier-league": `${BASE_URL}/pl/league/${SPORT_ID}/4485`,
  laliga: `${BASE_URL}/pl/league/${SPORT_ID}/4486`,
  "serie-a": `${BASE_URL}/pl/league/${SPORT_ID}/4484`,
  "ligue-1": `${BASE_URL}/pl/league/${SPORT_ID}/4610`,
  "world-cup-2026": `${BASE_URL}/pl/league/${SPORT_ID}/52530`,
};

/**
 * Stake type IDs from sbteam.xyz API
 * Used to identify different market types in the stakeTypes array
 */
export const STAKE_TYPES = {
  /** 1X2 Match Result */
  MATCH_RESULT: 1,
  /** Double Chance (1X, X2, 12) */
  DOUBLE_CHANCE: 37,
  /** Over/Under Total Goals */
  OVER_UNDER: 3,
  /** Both Teams To Score */
  BTTS: 26,
  /** Half Time Result */
  HALF_TIME_RESULT: 5,
  /** Half Time Over/Under */
  HALF_TIME_OVER_UNDER: 6,
  /** Correct Score */
  CORRECT_SCORE: 7,
  /** Draw No Bet */
  DRAW_NO_BET: 9,
  /** Handicap */
  HANDICAP: 2,
} as const;

/**
 * Stake codes within markets
 * Maps stakeCode values to outcome types
 */
export const STAKE_CODES = {
  // 1X2 outcomes
  HOME: 1,
  DRAW: 2,
  AWAY: 3,
} as const;

/**
 * Market group names for UI organization
 * Maps stake type IDs to human-readable group names
 */
export const MARKET_GROUPS: Record<number, string> = {
  [STAKE_TYPES.MATCH_RESULT]: "Wynik meczu",
  [STAKE_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [STAKE_TYPES.OVER_UNDER]: "Gole",
  [STAKE_TYPES.BTTS]: "Gole",
  [STAKE_TYPES.HALF_TIME_RESULT]: "Pierwsza polowa",
  [STAKE_TYPES.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [STAKE_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [STAKE_TYPES.DRAW_NO_BET]: "Wynik meczu",
  [STAKE_TYPES.HANDICAP]: "Handicap",
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
  [STAKE_TYPES.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [STAKE_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [STAKE_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [STAKE_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [STAKE_TYPES.HANDICAP]: "HANDICAP",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * API response capture timeout
 */
export const API_CAPTURE_TIMEOUT = 8000;

/**
 * Cache TTL for events data (1 minute)
 */
export const CACHE_TTL = 60000;

/**
 * Delay between event detail requests to avoid rate limiting (ms)
 */
export const EVENT_FETCH_DELAY = 150;

/**
 * Extended stake type IDs for full offer scraping
 *
 * The default API request only includes ~18 stake types.
 * By injecting this extended list via route interception, we get ALL available markets.
 *
 * Sources:
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
 * Build event page URL for navigation (triggers API call for full details)
 */
export function buildEventPageUrl(leagueId: number, eventId: number | string): string {
  return `${BASE_URL}/pl/event/${SPORT_ID}/${leagueId}/${eventId}`;
}
