/**
 * STS Constants
 *
 * URLs, WebSocket patterns, market IDs, and league configurations.
 * STS uses WebSocket interception for data fetching, not REST API.
 */

/**
 * Base URL for the STS website
 */
export const BASE_URL = "https://www.sts.pl";

/**
 * WebSocket URL pattern for STS data stream
 */
export const WS_URL_PATTERN = "/sbk/api/sbk";

/**
 * League configuration with URLs and tournament filters
 * The tournamentId is used for fixture-specific WebSocket subscriptions
 */
export const LEAGUE_CONFIG: Record<
  string,
  {
    url: string;
    tournamentId: number;
    countryFilter: string;
    tournamentFilter: string;
  }
> = {
  ekstraklasa: {
    url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/175",
    tournamentId: 46,
    countryFilter: "polska",
    tournamentFilter: "ekstraklasa",
  },
  "premier-league": {
    url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/175",
    tournamentId: 17,
    countryFilter: "angli",
    tournamentFilter: "premier league",
  },
  laliga: {
    url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/hiszpania/laliga/175",
    tournamentId: 8,
    countryFilter: "hiszpan",
    tournamentFilter: "laliga",
  },
  "serie-a": {
    url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/wlochy/serie-a/175",
    tournamentId: 23,
    countryFilter: "wloch", // Use Polish character l for matching "Wlochy"
    tournamentFilter: "serie a",
  },
  "ligue-1": {
    url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/francja/ligue-1/175",
    tournamentId: 16,
    countryFilter: "francj",
    tournamentFilter: "ligue 1",
  },
};

/**
 * STS Market IDs from WebSocket data structure
 * These correspond to m.{marketId} in the P.{assocKey}.m structure
 */
export const MARKET_IDS = {
  // Main markets
  MATCH_RESULT_1X2: 1, // 1X2 - Match Result (1, X, 2)
  DOUBLE_CHANCE: 10, // Double Chance (1X, X2, 12)

  // Goals markets
  BTTS: 43, // Both Teams To Score (tak/nie)
  TOTAL_GOALS: 25, // Over/Under Total Goals

  // Other markets (available in fixture-specific data)
  HALF_TIME_RESULT: 5, // 1st Half Result
  HALF_TIME_TOTAL: 26, // 1st Half Total Goals
  CORRECT_SCORE: 9, // Correct Score
  DRAW_NO_BET: 4, // Draw No Bet
} as const;

/**
 * Outcome IDs for 1X2 market
 */
export const OUTCOME_1X2 = {
  HOME: 1,
  DRAW: 2,
  AWAY: 3,
} as const;

/**
 * Outcome IDs for Double Chance market
 */
export const OUTCOME_DOUBLE_CHANCE = {
  HOME_OR_DRAW: 9, // 1X
  HOME_OR_AWAY: 10, // 12
  DRAW_OR_AWAY: 11, // X2
} as const;

/**
 * Outcome IDs for BTTS market
 */
export const OUTCOME_BTTS = {
  YES: 26, // Tak
  NO: 27, // Nie
} as const;

/**
 * Outcome IDs for Over/Under market
 */
export const OUTCOME_OVER_UNDER = {
  OVER: 12, // +X.5
  UNDER: 13, // -X.5
} as const;

/**
 * Market group names for UI organization
 */
export const MARKET_GROUPS: Record<number, string> = {
  [MARKET_IDS.MATCH_RESULT_1X2]: "Wynik meczu",
  [MARKET_IDS.DOUBLE_CHANCE]: "Wynik meczu",
  [MARKET_IDS.BTTS]: "Gole",
  [MARKET_IDS.TOTAL_GOALS]: "Gole",
  [MARKET_IDS.HALF_TIME_RESULT]: "Pierwsza polowa",
  [MARKET_IDS.HALF_TIME_TOTAL]: "Pierwsza polowa",
  [MARKET_IDS.CORRECT_SCORE]: "Dokladny wynik",
  [MARKET_IDS.DRAW_NO_BET]: "Wynik meczu",
};

/**
 * Normalized market type identifiers
 */
export const MARKET_TYPES: Record<number, string> = {
  [MARKET_IDS.MATCH_RESULT_1X2]: "1X2",
  [MARKET_IDS.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [MARKET_IDS.BTTS]: "BTTS",
  [MARKET_IDS.TOTAL_GOALS]: "OVER_UNDER",
  [MARKET_IDS.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [MARKET_IDS.HALF_TIME_TOTAL]: "HALF_TIME_OVER_UNDER",
  [MARKET_IDS.CORRECT_SCORE]: "CORRECT_SCORE",
  [MARKET_IDS.DRAW_NO_BET]: "DRAW_NO_BET",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * WebSocket data wait timeout in milliseconds
 */
export const WS_DATA_TIMEOUT = 8000;

/**
 * Polling interval for WebSocket data in milliseconds
 */
export const WS_POLL_INTERVAL = 500;

/**
 * Cookie consent button text
 */
export const COOKIE_BUTTON_TEXT = "Akceptuj wszystkie";
