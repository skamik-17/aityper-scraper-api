/**
 * PZBuk Constants
 *
 * URLs, league IDs, and market type mappings for the PZBuk scraper.
 * PZBuk uses WebSocket/RSocket for real-time data delivery.
 */

/**
 * Base URL for the PZBuk website
 */
export const BASE_URL = "https://www.pzbuk.pl";

/**
 * League IDs used in PZBuk API/WebSocket messages
 * These map league slugs to PZBuk's internal league identifiers
 */
export const LEAGUE_IDS: Record<string, string> = {
  ekstraklasa: "524",
  "premier-league": "134",
  laliga: "171",
  "serie-a": "148",
  "ligue-1": "395",
};

/**
 * League page URLs for navigation
 * Used to establish WebSocket connection and trigger data load
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/524-polska-ekstraklasa",
  "premier-league":
    "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league",
  laliga:
    "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/171-hiszpania-laliga",
  "serie-a":
    "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/148-wlochy-serie-a",
  "ligue-1":
    "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/395-francja-ligue-1",
};

/**
 * Market type IDs used by PZBuk
 * These identify different betting market types in the WebSocket data
 * Extended to capture all available football markets for full offer scraping
 */
export const MARKET_TYPES = {
  // Core markets
  MATCH_RESULT: "1", // 1X2 - Match Winner
  HALF_TIME_RESULT: "2", // Half-Time 1X2
  HANDICAP: "3", // European Handicap
  ASIAN_HANDICAP: "5", // Asian Handicap
  CORRECT_SCORE: "8", // Correct Score
  DOUBLE_CHANCE: "10", // 1X, X2, 12
  DRAW_NO_BET: "11", // Draw No Bet
  OVER_UNDER: "17", // Total Goals Over/Under
  HALF_TIME_OVER_UNDER: "18", // Half-Time Over/Under
  ODD_EVEN: "21", // Odd/Even Total Goals
  BTTS: "27", // Both Teams To Score
  WIN_TO_NIL: "28", // Win to Nil
  HALF_TIME_BTTS: "29", // Half-Time BTTS

  // Extended markets - team-specific goals
  HOME_TEAM_GOALS: "19", // Home Team Total Goals O/U
  AWAY_TEAM_GOALS: "20", // Away Team Total Goals O/U
  HOME_TEAM_EXACT_GOALS: "37", // Home Team Exact Goals
  AWAY_TEAM_EXACT_GOALS: "38", // Away Team Exact Goals
  TOTAL_EXACT_GOALS: "36", // Total Exact Goals (0, 1, 2, 3, etc.)

  // Half-time/Full-time combination
  HALF_TIME_FULL_TIME: "4", // HT/FT Result

  // Scoring markets
  FIRST_GOAL: "12", // First Goal Scorer
  LAST_GOAL: "13", // Last Goal Scorer
  ANYTIME_SCORER: "14", // Anytime Goal Scorer
  GOAL_RANGES: "35", // Goal Range (0-1, 2-3, 4+)

  // Second half markets
  SECOND_HALF_RESULT: "22", // Second Half 1X2
  SECOND_HALF_OVER_UNDER: "23", // Second Half O/U
  SECOND_HALF_BTTS: "30", // Second Half BTTS

  // Special result markets
  HOME_WIN_BOTH_HALVES: "24", // Home Wins Both Halves
  AWAY_WIN_BOTH_HALVES: "25", // Away Wins Both Halves
  HOME_WIN_EITHER_HALF: "26", // Home Wins Either Half
  AWAY_WIN_EITHER_HALF: "31", // Away Wins Either Half

  // Multi-goal markets
  BOTH_HALVES_GOALS: "32", // Goals in Both Halves
  HOME_CLEAN_SHEET: "33", // Home Clean Sheet
  AWAY_CLEAN_SHEET: "34", // Away Clean Sheet

  // Result and goals combos
  RESULT_BTTS: "39", // Result + BTTS
  RESULT_OVER_UNDER: "40", // Result + Total Goals

  // Double chance combos
  DOUBLE_CHANCE_BTTS: "41", // Double Chance + BTTS
  DOUBLE_CHANCE_OVER_UNDER: "42", // Double Chance + O/U
} as const;

/**
 * Market group names for UI organization
 * Maps market type IDs to human-readable group names (Polish)
 */
export const MARKET_GROUPS: Record<string, string> = {
  // Core markets
  [MARKET_TYPES.MATCH_RESULT]: "Wynik meczu",
  [MARKET_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [MARKET_TYPES.DRAW_NO_BET]: "Wynik meczu",
  [MARKET_TYPES.HANDICAP]: "Handicap",
  [MARKET_TYPES.ASIAN_HANDICAP]: "Handicap",

  // Goal markets
  [MARKET_TYPES.OVER_UNDER]: "Gole",
  [MARKET_TYPES.BTTS]: "Gole",
  [MARKET_TYPES.ODD_EVEN]: "Gole",
  [MARKET_TYPES.WIN_TO_NIL]: "Gole",
  [MARKET_TYPES.HOME_TEAM_GOALS]: "Gole druzyny",
  [MARKET_TYPES.AWAY_TEAM_GOALS]: "Gole druzyny",
  [MARKET_TYPES.HOME_TEAM_EXACT_GOALS]: "Gole druzyny",
  [MARKET_TYPES.AWAY_TEAM_EXACT_GOALS]: "Gole druzyny",
  [MARKET_TYPES.TOTAL_EXACT_GOALS]: "Gole",
  [MARKET_TYPES.GOAL_RANGES]: "Gole",
  [MARKET_TYPES.BOTH_HALVES_GOALS]: "Gole",
  [MARKET_TYPES.HOME_CLEAN_SHEET]: "Gole",
  [MARKET_TYPES.AWAY_CLEAN_SHEET]: "Gole",

  // First half markets
  [MARKET_TYPES.HALF_TIME_RESULT]: "Pierwsza polowa",
  [MARKET_TYPES.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [MARKET_TYPES.HALF_TIME_BTTS]: "Pierwsza polowa",

  // Second half markets
  [MARKET_TYPES.SECOND_HALF_RESULT]: "Druga polowa",
  [MARKET_TYPES.SECOND_HALF_OVER_UNDER]: "Druga polowa",
  [MARKET_TYPES.SECOND_HALF_BTTS]: "Druga polowa",

  // Half/Full time and special results
  [MARKET_TYPES.HALF_TIME_FULL_TIME]: "HT/FT",
  [MARKET_TYPES.HOME_WIN_BOTH_HALVES]: "Polowy",
  [MARKET_TYPES.AWAY_WIN_BOTH_HALVES]: "Polowy",
  [MARKET_TYPES.HOME_WIN_EITHER_HALF]: "Polowy",
  [MARKET_TYPES.AWAY_WIN_EITHER_HALF]: "Polowy",

  // Scorer markets
  [MARKET_TYPES.FIRST_GOAL]: "Strzelcy",
  [MARKET_TYPES.LAST_GOAL]: "Strzelcy",
  [MARKET_TYPES.ANYTIME_SCORER]: "Strzelcy",
  [MARKET_TYPES.CORRECT_SCORE]: "Dokladny wynik",

  // Combo markets
  [MARKET_TYPES.RESULT_BTTS]: "Kombinacje",
  [MARKET_TYPES.RESULT_OVER_UNDER]: "Kombinacje",
  [MARKET_TYPES.DOUBLE_CHANCE_BTTS]: "Kombinacje",
  [MARKET_TYPES.DOUBLE_CHANCE_OVER_UNDER]: "Kombinacje",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const NORMALIZED_MARKET_TYPES: Record<string, string> = {
  // Core markets
  [MARKET_TYPES.MATCH_RESULT]: "1X2",
  [MARKET_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [MARKET_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
  [MARKET_TYPES.HANDICAP]: "EUROPEAN_HANDICAP",
  [MARKET_TYPES.ASIAN_HANDICAP]: "ASIAN_HANDICAP",

  // Goal markets
  [MARKET_TYPES.OVER_UNDER]: "OVER_UNDER",
  [MARKET_TYPES.BTTS]: "BTTS",
  [MARKET_TYPES.ODD_EVEN]: "ODD_EVEN",
  [MARKET_TYPES.WIN_TO_NIL]: "WIN_TO_NIL",
  [MARKET_TYPES.HOME_TEAM_GOALS]: "HOME_TEAM_OVER_UNDER",
  [MARKET_TYPES.AWAY_TEAM_GOALS]: "AWAY_TEAM_OVER_UNDER",
  [MARKET_TYPES.HOME_TEAM_EXACT_GOALS]: "HOME_EXACT_GOALS",
  [MARKET_TYPES.AWAY_TEAM_EXACT_GOALS]: "AWAY_EXACT_GOALS",
  [MARKET_TYPES.TOTAL_EXACT_GOALS]: "EXACT_GOALS",
  [MARKET_TYPES.GOAL_RANGES]: "GOAL_RANGE",
  [MARKET_TYPES.BOTH_HALVES_GOALS]: "GOALS_BOTH_HALVES",
  [MARKET_TYPES.HOME_CLEAN_SHEET]: "HOME_CLEAN_SHEET",
  [MARKET_TYPES.AWAY_CLEAN_SHEET]: "AWAY_CLEAN_SHEET",

  // First half markets
  [MARKET_TYPES.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [MARKET_TYPES.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [MARKET_TYPES.HALF_TIME_BTTS]: "HALF_TIME_BTTS",

  // Second half markets
  [MARKET_TYPES.SECOND_HALF_RESULT]: "SECOND_HALF_1X2",
  [MARKET_TYPES.SECOND_HALF_OVER_UNDER]: "SECOND_HALF_OVER_UNDER",
  [MARKET_TYPES.SECOND_HALF_BTTS]: "SECOND_HALF_BTTS",

  // Half/Full time and special results
  [MARKET_TYPES.HALF_TIME_FULL_TIME]: "HT_FT",
  [MARKET_TYPES.HOME_WIN_BOTH_HALVES]: "HOME_WIN_BOTH_HALVES",
  [MARKET_TYPES.AWAY_WIN_BOTH_HALVES]: "AWAY_WIN_BOTH_HALVES",
  [MARKET_TYPES.HOME_WIN_EITHER_HALF]: "HOME_WIN_EITHER_HALF",
  [MARKET_TYPES.AWAY_WIN_EITHER_HALF]: "AWAY_WIN_EITHER_HALF",

  // Scorer markets
  [MARKET_TYPES.FIRST_GOAL]: "FIRST_GOALSCORER",
  [MARKET_TYPES.LAST_GOAL]: "LAST_GOALSCORER",
  [MARKET_TYPES.ANYTIME_SCORER]: "ANYTIME_GOALSCORER",
  [MARKET_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",

  // Combo markets
  [MARKET_TYPES.RESULT_BTTS]: "RESULT_BTTS",
  [MARKET_TYPES.RESULT_OVER_UNDER]: "RESULT_OVER_UNDER",
  [MARKET_TYPES.DOUBLE_CHANCE_BTTS]: "DOUBLE_CHANCE_BTTS",
  [MARKET_TYPES.DOUBLE_CHANCE_OVER_UNDER]: "DOUBLE_CHANCE_OVER_UNDER",
};

/**
 * Outcome type mappings from PZBuk API
 * Maps PZBuk's outcomeType values to display names
 */
export const OUTCOME_TYPES = {
  // 1X2 outcomes
  HOME: "Home",
  AWAY: "Away",
  TIE: "Tie", // PZBuk uses "Tie" instead of "Draw"
  DRAW: "Draw",

  // Double Chance outcomes
  HOME_OR_DRAW: "HomeOrDraw",
  DRAW_OR_AWAY: "DrawOrAway",
  HOME_OR_AWAY: "HomeOrAway",

  // Over/Under outcomes
  OVER: "Over",
  UNDER: "Under",

  // BTTS outcomes
  YES: "Yes",
  NO: "No",
} as const;

/**
 * WebSocket URL pattern for identifying PZBuk sportsbook data stream
 */
export const WEBSOCKET_URL_PATTERN = "sportsbook-api/websocket";

/**
 * Maximum timeout for WebSocket data capture (milliseconds)
 * Increased to 30s to allow for sequential processing of all markets
 */
export const WS_CAPTURE_TIMEOUT = 30000;

/**
 * Polling interval for checking WebSocket data availability
 */
export const WS_POLL_INTERVAL = 300;

/**
 * Minimum wait time before considering WebSocket data complete
 */
export const WS_MIN_WAIT = 1000;

/**
 * Maximum wait time for WebSocket data (with contention)
 * Increased to allow more data to stream in for full offer scraping
 */
export const WS_MAX_WAIT = 25000;

/**
 * Request timeout for page navigation
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Minimum number of selections to consider match details complete
 * PZBuk can have 600+ selections per match when all groups are expanded.
 * Set to 200 to ensure we capture most markets after group expansion.
 */
export const MIN_SELECTIONS_FOR_FULL_OFFER = 200;
