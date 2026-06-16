/**
 * Betfan Constants
 *
 * URLs, API endpoints, category IDs, and market type mappings.
 * Betfan uses a REST API for data fetching, not DOM scraping.
 */

/**
 * Base URL for the Betfan website
 */
export const BASE_URL = "https://betfan.pl";

/**
 * API base URL for Betfan market data
 */
export const API_BASE_URL = "https://betfan.pl/api/v1/market";

/**
 * Category IDs for Betfan API
 * These identify football leagues in the Betfan system
 */
export const CATEGORY_IDS: Record<string, number> = {
  ekstraklasa: 294,
  "premier-league": 244,
  laliga: 230,
  "serie-a": 215,
  "ligue-1": 214,
  "world-cup-2026": 535035,
};

/**
 * League page URLs for navigation (used to establish session if needed)
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://betfan.pl/zaklady-pilka-nozna/polska/ekstraklasa-294",
  "premier-league": "https://betfan.pl/zaklady-pilka-nozna/anglia/premier-league-244",
  laliga: "https://betfan.pl/zaklady-pilka-nozna/hiszpania/la-liga-230",
  "serie-a": "https://betfan.pl/zaklady-pilka-nozna/wlochy/serie-a-215",
  "ligue-1": "https://betfan.pl/zaklady-pilka-nozna/francja/ligue-1-214",
  "world-cup-2026": "https://betfan.pl/zaklady-pilka-nozna/swiat/mistrzostwa-swiata-535035",
};

/**
 * Game type IDs used by Betfan API
 * These identify different betting market types
 *
 * NOTE: Betfan returns all markets in the listing API response,
 * so we don't need a separate event detail endpoint.
 */
export const GAME_TYPES = {
  // Main markets
  MATCH_RESULT_1X2: 1,        // "Mecz" or "1X2"
  HALF_TIME_RESULT: 2,        // "1. polowa - wynik"
  DRAW_NO_BET: 3,             // "Remis = zwrot"
  DOUBLE_CHANCE: 4,           // "Podwojna szansa"
  CORRECT_SCORE: 5,           // "Dokladny wynik"
  HANDICAP: 6,                // "Handicap"
  ODD_EVEN: 7,                // "Parzyste/Nieparzyste"
  OVER_UNDER: 8,              // "Liczba goli" / "Ponizej/powyzej X.X goli"
  HALF_TIME_OVER_UNDER: 9,    // "1. polowa - liczba goli"
  EXACT_GOALS: 10,            // "Dokladna liczba goli"
  CARDS_TOTAL: 13,            // "Liczba kartek"
  CORNERS_TOTAL: 23,          // "Liczba rzutow roznych"
  TEAM_GOALS: 27,             // "Gole druzyny"
  BTTS: 98,                   // "Obie druzyny strzelą"
  HALF_TIME_BTTS: 99,         // "1. polowa - obie strzelą"
  HALFTIME_FULLTIME: 111,     // "Polowa/Koniec"
  HOME_TEAM_OVER_UNDER: 120,  // "Gole gospodarzy - ponizej/powyzej"
  AWAY_TEAM_OVER_UNDER: 121,  // "Gole gosci - ponizej/powyzej"
  CLEAN_SHEET: -188,          // "Czyste konto"
  WIN_MARGIN: -2967,          // "Margines zwyciestwa"
} as const;

/**
 * Market group names for UI organization
 * Maps game types to human-readable group names (in Polish)
 */
export const MARKET_GROUPS: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "Wynik meczu",
  [GAME_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [GAME_TYPES.DRAW_NO_BET]: "Wynik meczu",
  [GAME_TYPES.OVER_UNDER]: "Gole",
  [GAME_TYPES.BTTS]: "Gole",
  [GAME_TYPES.EXACT_GOALS]: "Gole",
  [GAME_TYPES.ODD_EVEN]: "Gole",
  [GAME_TYPES.TEAM_GOALS]: "Gole",
  [GAME_TYPES.HOME_TEAM_OVER_UNDER]: "Gole",
  [GAME_TYPES.AWAY_TEAM_OVER_UNDER]: "Gole",
  [GAME_TYPES.CLEAN_SHEET]: "Gole",
  [GAME_TYPES.WIN_MARGIN]: "Gole",
  [GAME_TYPES.HANDICAP]: "Handicap",
  [GAME_TYPES.HALF_TIME_RESULT]: "Pierwsza polowa",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [GAME_TYPES.HALF_TIME_BTTS]: "Pierwsza polowa",
  [GAME_TYPES.HALFTIME_FULLTIME]: "Pierwsza polowa",
  [GAME_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [GAME_TYPES.CORNERS_TOTAL]: "Rzuty rozne",
  [GAME_TYPES.CARDS_TOTAL]: "Kartki",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "1X2",
  [GAME_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [GAME_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [GAME_TYPES.OVER_UNDER]: "OVER_UNDER",
  [GAME_TYPES.BTTS]: "BTTS",
  [GAME_TYPES.EXACT_GOALS]: "EXACT_GOALS",
  [GAME_TYPES.ODD_EVEN]: "ODD_EVEN",
  [GAME_TYPES.TEAM_GOALS]: "TEAM_GOALS",
  [GAME_TYPES.HOME_TEAM_OVER_UNDER]: "HOME_TEAM_OVER_UNDER",
  [GAME_TYPES.AWAY_TEAM_OVER_UNDER]: "AWAY_TEAM_OVER_UNDER",
  [GAME_TYPES.CLEAN_SHEET]: "CLEAN_SHEET",
  [GAME_TYPES.WIN_MARGIN]: "WIN_MARGIN",
  [GAME_TYPES.HANDICAP]: "HANDICAP",
  [GAME_TYPES.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [GAME_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [GAME_TYPES.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [GAME_TYPES.HALFTIME_FULLTIME]: "HALFTIME_FULLTIME",
  [GAME_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [GAME_TYPES.CORNERS_TOTAL]: "CORNERS",
  [GAME_TYPES.CARDS_TOTAL]: "CARDS",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Cache TTL for events data in milliseconds (1 minute)
 */
export const CACHE_TTL = 60000;
