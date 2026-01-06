/**
 * Betcris Constants
 *
 * URLs, competition IDs, and Swarm WebSocket market type mappings.
 * Betcris uses the Swarm WebSocket API for real-time betting data.
 */

/**
 * Base URL for the Betcris website
 */
export const BASE_URL = "https://www.betcris.pl";

/**
 * Competition IDs for Betcris (from Swarm API)
 * Found via WebSocket frame inspection
 */
export const COMPETITION_IDS: Record<string, number> = {
  ekstraklasa: 1978,
  "premier-league": 538,
  laliga: 545,
  "serie-a": 543,
  "ligue-1": 548,
};

/**
 * League URLs for navigation
 * Used to trigger WebSocket connections for each league
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: `${BASE_URL}/zaklady-bukmacherskie/match/Soccer/Poland/1978`,
  "premier-league": `${BASE_URL}/zaklady-bukmacherskie/match/Soccer/England/538`,
  laliga: `${BASE_URL}/zaklady-bukmacherskie/match/Soccer/Spain/545`,
  "serie-a": `${BASE_URL}/zaklady-bukmacherskie/match/Soccer/Italy/543`,
  "ligue-1": `${BASE_URL}/zaklady-bukmacherskie/match/Soccer/France/548`,
};

/**
 * Region aliases used in Betcris URLs
 * Maps league slug to the region alias used in event URLs
 */
export const REGION_ALIASES: Record<string, string> = {
  ekstraklasa: "Poland",
  "premier-league": "England",
  laliga: "Spain",
  "serie-a": "Italy",
  "ligue-1": "France",
};

/**
 * Swarm market type identifiers
 * These strings appear in the Swarm WebSocket API responses
 */
export const SWARM_MARKET_TYPES = {
  // Main markets
  MATCH_RESULT: "P1XP2",
  DOUBLE_CHANCE: "1X12X2",
  DOUBLE_CHANCE_ALT: "P1XP2DC",

  // Goals markets
  OVER_UNDER: "OverUnder",
  BTTS: "BothTeamsToScore",

  // Half-time markets
  HALF_TIME_RESULT: "P1XP2FirstHalf",
  HALF_TIME_OVER_UNDER: "HalfTimeOverUnder",
  HALF_TIME_BTTS: "BothTeamsToScoreFirstHalf",

  // Team-specific markets
  TEAM1_OVER_UNDER: "Team1OverUnder",
  TEAM2_OVER_UNDER: "Team2OverUnder",

  // Handicap markets
  ASIAN_HANDICAP: "AsianHandicap",
  EUROPEAN_HANDICAP: "EuropeanHandicap",

  // Other markets
  CORRECT_SCORE: "CorrectScore",
  DRAW_NO_BET: "DrawNoBet",
  ODD_EVEN: "OddEven",
  WIN_TO_NIL: "WinToNil",
  CLEAN_SHEET: "CleanSheet",
  HALF_TIME_FULL_TIME: "HalftimeFulltime",
} as const;

/**
 * Market group names for UI organization
 * Maps Swarm market types to human-readable group names in Polish
 */
export const MARKET_GROUPS: Record<string, string> = {
  [SWARM_MARKET_TYPES.MATCH_RESULT]: "Wynik meczu",
  [SWARM_MARKET_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [SWARM_MARKET_TYPES.DOUBLE_CHANCE_ALT]: "Wynik meczu",
  [SWARM_MARKET_TYPES.OVER_UNDER]: "Gole",
  [SWARM_MARKET_TYPES.BTTS]: "Gole",
  [SWARM_MARKET_TYPES.HALF_TIME_RESULT]: "Pierwsza polowa",
  [SWARM_MARKET_TYPES.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [SWARM_MARKET_TYPES.HALF_TIME_BTTS]: "Pierwsza polowa",
  [SWARM_MARKET_TYPES.TEAM1_OVER_UNDER]: "Gole druzyny",
  [SWARM_MARKET_TYPES.TEAM2_OVER_UNDER]: "Gole druzyny",
  [SWARM_MARKET_TYPES.ASIAN_HANDICAP]: "Handicap",
  [SWARM_MARKET_TYPES.EUROPEAN_HANDICAP]: "Handicap",
  [SWARM_MARKET_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [SWARM_MARKET_TYPES.DRAW_NO_BET]: "Wynik meczu",
  [SWARM_MARKET_TYPES.ODD_EVEN]: "Gole",
  [SWARM_MARKET_TYPES.WIN_TO_NIL]: "Gole",
  [SWARM_MARKET_TYPES.CLEAN_SHEET]: "Gole",
  [SWARM_MARKET_TYPES.HALF_TIME_FULL_TIME]: "Wynik polowa/mecz",
};

/**
 * Normalized market type identifiers
 * Maps Swarm market types to unified type names
 */
export const MARKET_TYPE_MAPPING: Record<string, string> = {
  [SWARM_MARKET_TYPES.MATCH_RESULT]: "1X2",
  [SWARM_MARKET_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [SWARM_MARKET_TYPES.DOUBLE_CHANCE_ALT]: "DOUBLE_CHANCE",
  [SWARM_MARKET_TYPES.OVER_UNDER]: "OVER_UNDER",
  [SWARM_MARKET_TYPES.BTTS]: "BTTS",
  [SWARM_MARKET_TYPES.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [SWARM_MARKET_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [SWARM_MARKET_TYPES.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [SWARM_MARKET_TYPES.TEAM1_OVER_UNDER]: "TEAM_OVER_UNDER",
  [SWARM_MARKET_TYPES.TEAM2_OVER_UNDER]: "TEAM_OVER_UNDER",
  [SWARM_MARKET_TYPES.ASIAN_HANDICAP]: "ASIAN_HANDICAP",
  [SWARM_MARKET_TYPES.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [SWARM_MARKET_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [SWARM_MARKET_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [SWARM_MARKET_TYPES.ODD_EVEN]: "ODD_EVEN",
  [SWARM_MARKET_TYPES.WIN_TO_NIL]: "WIN_TO_NIL",
  [SWARM_MARKET_TYPES.CLEAN_SHEET]: "CLEAN_SHEET",
  [SWARM_MARKET_TYPES.HALF_TIME_FULL_TIME]: "HALF_TIME_FULL_TIME",
};

/**
 * Swarm event type_1 codes for selections
 */
export const SELECTION_CODES = {
  // 1X2 outcomes
  HOME: "W1",
  DRAW: "X",
  AWAY: "W2",

  // Double Chance outcomes
  HOME_OR_DRAW: "1X",
  DRAW_OR_AWAY: "X2",
  HOME_OR_AWAY: "12",

  // Over/Under outcomes
  OVER: "Over",
  UNDER: "Under",

  // BTTS outcomes
  YES: "Yes",
  NO: "No",
} as const;

/**
 * WebSocket capture configuration
 */
export const WS_CONFIG = {
  /** Minimum wait time before resolving with captured data (ms) */
  MIN_WAIT_TIME: 1000,
  /** Maximum wait time for WebSocket data (ms) */
  MAX_WAIT_TIME: 12000,
  /** Polling interval for checking captured data (ms) */
  POLL_INTERVAL: 300,
  /** Minimum markets required for single event mode */
  MIN_MARKETS_SINGLE_EVENT: 50,
  /** Minimum markets required to consider game valid for match details */
  MIN_MARKETS_MATCH_DETAILS: 10,
} as const;

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;
