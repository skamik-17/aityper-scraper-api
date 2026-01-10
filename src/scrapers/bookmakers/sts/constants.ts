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
 *
 * VERIFIED against actual STS WebSocket data (2026-01-09)
 */
export const MARKET_IDS = {
  // ==========================================================================
  // MAIN MARKETS
  // ==========================================================================
  MATCH_RESULT_1X2: 1, // "Mecz" - Match Result (1, X, 2)
  DOUBLE_CHANCE: 10, // "Podwójna szansa" - Double Chance (1X, X2, 12)
  DRAW_NO_BET: 11, // "Zakład bez remisu" - Draw No Bet

  // ==========================================================================
  // GOALS MARKETS
  // ==========================================================================
  BTTS: 43, // "Obie drużyny - strzelą gola" - Both Teams To Score (tak/nie)
  TOTAL_GOALS: 25, // "Liczba goli" - Over/Under Total Goals (decimal lines: 0.5, 1.5, 2.5...)
  TOTAL_GOALS_ASIAN: 23, // "Liczba goli (z możliwym zwrotem)" - Asian Total Goals (integer lines: 1, 2, 3...)
  FIRST_GOAL: 8, // "1. gol" - First Goal (which team scores first)
  LAST_GOAL: 9, // "Ostatni gol" - Last Goal (which team scores last)
  WIN_TO_NIL_HOME: 47, // "1. drużyna - wygra do zera"
  WIN_TO_NIL_AWAY: 48, // "2. drużyna - wygra do zera"
  FIRST_TEAM_TO_SCORE: 44, // "Która drużyna strzeli gola"

  // ==========================================================================
  // HALF TIME MARKETS
  // ==========================================================================
  HALF_TIME_RESULT: 71, // "1. połowa" - 1st Half Result
  HALF_TIME_TOTAL: 82, // "1. połowa - liczba goli" - 1st Half Total Goals
  HALF_TIME_BTTS: 95, // "1. połowa - obie drużyny - strzelą gola"
  HALF_TIME_DOUBLE_CHANCE: 74, // "1. połowa - podwójna szansa"
  HALF_TIME_DRAW_NO_BET: 75, // "1. połowa - zakład bez remisu"

  // ==========================================================================
  // SECOND HALF MARKETS
  // ==========================================================================
  SECOND_HALF_RESULT: 102, // "2. połowa" - 2nd Half Result
  SECOND_HALF_TOTAL: 112, // "2. połowa - liczba goli"
  SECOND_HALF_BTTS: 121, // "2. połowa - obie drużyny - strzelą gola"

  // ==========================================================================
  // CORRECT SCORE
  // ==========================================================================
  CORRECT_SCORE: 283, // "Dokładny wynik" - Correct Score
  FIRST_HALF_CORRECT_SCORE: 101, // "1. połowa - dokładny wynik"
  SECOND_HALF_CORRECT_SCORE: 124, // "2. połowa - dokładny wynik"

  // ==========================================================================
  // GOALSCORER MARKETS
  // ==========================================================================
  FIRST_GOALSCORER: 52, // "Zawodnik - strzeli 1. gola"
  LAST_GOALSCORER: 53, // "Zawodnik - strzeli ostatniego gola"
  ANYTIME_GOALSCORER: 54, // "Zawodnik - strzeli gola"

  // ==========================================================================
  // COMBINATION MARKETS
  // ==========================================================================
  HALFTIME_FULLTIME: 58, // "1. połowa / wynik końcowy" - HT/FT Result
  RESULT_AND_BTTS: 49, // "Wynik końcowy i obie drużyny - strzelą gola"
  RESULT_AND_TOTAL: 51, // "Wynik końcowy i liczba goli"
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
 * Correct Score outcome ID to score mapping
 * STS doesn't send score labels, only numeric IDs (1783-1817)
 * Pattern: grouped by home goals, 6 outcomes per row (0-5 away goals)
 * IDs 1783-1788: Home 0 goals (0-0, 0-1, 0-2, 0-3, 0-4, 0-5)
 * IDs 1789-1794: Home 1 goal (1-0, 1-1, 1-2, 1-3, 1-4, 1-5)
 * IDs 1795-1800: Home 2 goals (2-0, 2-1, 2-2, 2-3, 2-4, 2-5)
 * IDs 1801-1806: Home 3 goals (3-0, 3-1, 3-2, 3-3, 3-4, 3-5)
 * IDs 1807-1812: Home 4 goals (4-0, 4-1, 4-2, 4-3, 4-4, 4-5)
 * IDs 1813-1817: Home 5 goals (5-0, 5-1, 5-2, 5-3, 5-4) - missing 5-5
 */
export const CORRECT_SCORE_OUTCOMES: Record<number, string> = {
  // Home 0 goals
  1783: "0:0", 1784: "0:1", 1785: "0:2", 1786: "0:3", 1787: "0:4", 1788: "0:5",
  // Home 1 goal
  1789: "1:0", 1790: "1:1", 1791: "1:2", 1792: "1:3", 1793: "1:4", 1794: "1:5",
  // Home 2 goals
  1795: "2:0", 1796: "2:1", 1797: "2:2", 1798: "2:3", 1799: "2:4", 1800: "2:5",
  // Home 3 goals
  1801: "3:0", 1802: "3:1", 1803: "3:2", 1804: "3:3", 1805: "3:4", 1806: "3:5",
  // Home 4 goals
  1807: "4:0", 1808: "4:1", 1809: "4:2", 1810: "4:3", 1811: "4:4", 1812: "4:5",
  // Home 5 goals
  1813: "5:0", 1814: "5:1", 1815: "5:2", 1816: "5:3", 1817: "5:4",
};

/**
 * Half-time Correct Score outcome ID to score mapping (Markets 101, 124)
 * STS uses IDs 160-169 for 10 outcomes (0-0 through 2-2 plus Other)
 * Pattern: grouped by home goals (0-2) x away goals (0-2) = 9 + Other
 */
export const HALF_CORRECT_SCORE_OUTCOMES: Record<number, string> = {
  // Home 0 goals at HT
  160: "0:0", 161: "0:1", 162: "0:2",
  // Home 1 goal at HT
  163: "1:0", 164: "1:1", 165: "1:2",
  // Home 2 goals at HT
  166: "2:0", 167: "2:1", 168: "2:2",
  // Other scores
  169: "Inne",
};

/**
 * Market group names for UI organization
 */
export const MARKET_GROUPS: Record<number, string> = {
  [MARKET_IDS.MATCH_RESULT_1X2]: "Wynik meczu",
  [MARKET_IDS.DOUBLE_CHANCE]: "Wynik meczu",
  [MARKET_IDS.DRAW_NO_BET]: "Wynik meczu",
  [MARKET_IDS.BTTS]: "Gole",
  [MARKET_IDS.TOTAL_GOALS]: "Gole",
  [MARKET_IDS.TOTAL_GOALS_ASIAN]: "Gole",
  [MARKET_IDS.FIRST_GOAL]: "Gole",
  [MARKET_IDS.LAST_GOAL]: "Gole",
  [MARKET_IDS.CORRECT_SCORE]: "Dokladny wynik",
  [MARKET_IDS.FIRST_HALF_CORRECT_SCORE]: "Dokladny wynik",
  [MARKET_IDS.SECOND_HALF_CORRECT_SCORE]: "Dokladny wynik",
  [MARKET_IDS.HALF_TIME_RESULT]: "Pierwsza polowa",
  [MARKET_IDS.HALF_TIME_TOTAL]: "Pierwsza polowa",
  [MARKET_IDS.HALFTIME_FULLTIME]: "Polowa/Koniec",
  [MARKET_IDS.FIRST_GOALSCORER]: "Strzelcy",
  [MARKET_IDS.ANYTIME_GOALSCORER]: "Strzelcy",
};

/**
 * Normalized market type identifiers
 */
export const MARKET_TYPES: Record<number, string> = {
  [MARKET_IDS.MATCH_RESULT_1X2]: "1X2",
  [MARKET_IDS.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [MARKET_IDS.DRAW_NO_BET]: "DRAW_NO_BET",
  [MARKET_IDS.BTTS]: "BTTS",
  [MARKET_IDS.TOTAL_GOALS]: "OVER_UNDER",
  [MARKET_IDS.TOTAL_GOALS_ASIAN]: "OVER_UNDER_ASIAN",
  [MARKET_IDS.FIRST_GOAL]: "FIRST_GOAL",
  [MARKET_IDS.LAST_GOAL]: "LAST_GOAL",
  [MARKET_IDS.CORRECT_SCORE]: "CORRECT_SCORE",
  [MARKET_IDS.FIRST_HALF_CORRECT_SCORE]: "FIRST_HALF_CORRECT_SCORE",
  [MARKET_IDS.SECOND_HALF_CORRECT_SCORE]: "SECOND_HALF_CORRECT_SCORE",
  [MARKET_IDS.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [MARKET_IDS.HALF_TIME_TOTAL]: "HALF_TIME_OVER_UNDER",
  [MARKET_IDS.HALFTIME_FULLTIME]: "HALFTIME_FULLTIME",
  [MARKET_IDS.FIRST_GOALSCORER]: "FIRST_GOALSCORER",
  [MARKET_IDS.ANYTIME_GOALSCORER]: "ANYTIME_GOALSCORER",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * WebSocket data wait timeout in milliseconds
 */
export const WS_DATA_TIMEOUT = 12000;

/**
 * Polling interval for WebSocket data in milliseconds
 */
export const WS_POLL_INTERVAL = 500;

/**
 * Cookie consent button text
 */
export const COOKIE_BUTTON_TEXT = "Akceptuj wszystkie";
