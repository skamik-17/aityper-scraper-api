/**
 * LVBet Constants
 *
 * URLs, API endpoints, tournament IDs, and market mappings.
 * LVBet uses a REST API for data fetching with page.request.fetch.
 */

/**
 * Base URL for the LVBet website
 */
export const BASE_URL = "https://lvbet.pl";

/**
 * API base URL for the LVBet offer data
 */
export const API_BASE_URL = "https://offer.lvbet.pl/client-api/v5";

/**
 * Tournament IDs for LVBet API
 * These are sports_groups_ids used to filter events by league
 */
export const TOURNAMENT_IDS: Record<string, number> = {
  "premier-league": 37685,
  ekstraklasa: 37669,
  laliga: 41533,
  "serie-a": 37680,
  "ligue-1": 37682,
  "world-cup-2026": 37392,
};

/**
 * Market name patterns for identifying primary 1X2 market
 * Case-insensitive matching
 */
export const PRIMARY_1X2_NAMES = [
  "zwyciezca meczu",
  "wynik meczu",
] as const;

/**
 * Market name patterns to exclude from 1X2 fallback
 * These are special markets like cards, corners, etc.
 */
export const EXCLUDED_1X2_PATTERNS = [
  "kartki",
  "kartek",
  "rzuty",
  "faule",
  "spalone",
] as const;

/**
 * Market name patterns for Double Chance
 */
export const DOUBLE_CHANCE_PATTERNS = [
  "szansa",
  "dwojtyp",
] as const;

/**
 * Market name patterns for BTTS (Both Teams To Score)
 * Must include all positive patterns and exclude half-time/special variants
 */
export const BTTS_POSITIVE_PATTERNS = ["obie", "strzel"] as const;
export const BTTS_NEGATIVE_PATTERNS = [
  "polowa",
  "polow",
  "wynik",
  "w obu",
  "min.",
  "min ",
] as const;

/**
 * Market name patterns for Over/Under total goals
 * Must match exact names only (not half-time, team-specific, etc.)
 */
export const OVER_UNDER_EXACT_NAMES = [
  "suma goli",
  "liczba goli",
] as const;

/**
 * Market group mappings for UI organization
 * Maps market name patterns to group names
 */
export const MARKET_GROUPS: Record<string, string> = {
  // Main match result
  "zwyciezca meczu": "Wynik meczu",
  "wynik meczu": "Wynik meczu",
  "wynik": "Wynik meczu",
  // Double chance
  "szansa": "Wynik meczu",
  "dwojtyp": "Wynik meczu",
  // Goals markets
  "suma goli": "Gole",
  "liczba goli": "Gole",
  "obie": "Gole",
  // Half-time
  "polowa": "Pierwsza polowa",
  "1. polowa": "Pierwsza polowa",
  // Handicap
  "handicap": "Handicap",
  // Cards
  "kartki": "Kartki",
  "kartek": "Kartki",
  // Corners
  "rzuty": "Rzuty rozne",
};

/**
 * Normalized market type identifiers
 * Maps market name patterns to standardized types
 */
export const MARKET_TYPES: Record<string, string> = {
  "zwyciezca meczu": "1X2",
  "wynik meczu": "1X2",
  "szansa": "DOUBLE_CHANCE",
  "dwojtyp": "DOUBLE_CHANCE",
  "suma goli": "OVER_UNDER",
  "liczba goli": "OVER_UNDER",
  "obie druzyny strzela": "BTTS",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Delay between API requests to avoid rate limiting (ms)
 */
export const REQUEST_DELAY = 100;

/**
 * Selection order mappings in LVBet API
 * Order determines which outcome the selection represents
 */
export const SELECTION_ORDERS = {
  HOME: 0,
  DRAW: 1,
  AWAY: 2,
} as const;

/**
 * Double Chance selection order mappings
 */
export const DC_SELECTION_ORDERS = {
  HOME_OR_DRAW: 0,
  HOME_OR_AWAY: 1,
  DRAW_OR_AWAY: 2,
} as const;
