/**
 * Normalization Types - Canonical Source of Truth
 *
 * Single source of truth for ALL normalization-related types.
 * These types are used throughout the normalization system and must match DB schema.
 */

// ============================================================================
// MARKET CATEGORY
// ============================================================================

/**
 * Market categories for UI organization (following Superbet pattern)
 */
export const MarketCategory = {
  /** Match result markets - 1X2, Double Chance, Draw No Bet */
  WYNIK_MECZU: "WYNIK_MECZU",

  /** Goals markets - BTTS, Over/Under, Odd/Even, Win to Nil, Clean Sheet */
  GOLE: "GOLE",

  /** Handicap markets - Asian Handicap, European Handicap */
  HANDICAP: "HANDICAP",

  /** First half markets - HT Result, HT Goals, HT BTTS */
  PIERWSZA_POLOWA: "PIERWSZA_POLOWA",

  /** Correct Score markets */
  DOKLADNY_WYNIK: "DOKLADNY_WYNIK",

  /** Player props - goalscorers, cards, assists */
  ZAWODNICY: "ZAWODNICY",

  /** Statistics - corners, team cards, fouls */
  STATYSTYKI: "STATYSTYKI",

  /** Combination markets - Result+BTTS, Result+O/U, HT/FT */
  KOMBINACJE: "KOMBINACJE",

  /** Other markets - truly unknown/special markets */
  INNE: "INNE",
} as const;
export type MarketCategory = (typeof MarketCategory)[keyof typeof MarketCategory];

// ============================================================================
// VIEW TYPE
// ============================================================================

/**
 * View type determines how market is rendered in UI (string form shared with DB enums)
 */
export const ViewType = {
  BINARY_BUTTONS: "BINARY_BUTTONS",     // YES/NO, OVER/UNDER - 2 simple buttons
  TRIPLE_BUTTONS: "TRIPLE_BUTTONS",     // 1X2 - 3 buttons (Home, Draw, Away)
  PARAMETER_SLIDER: "PARAMETER_SLIDER",   // Over/Under with parameter selection (2.5, 3.5, etc.)
  HANDICAP_SELECTOR: "HANDICAP_SELECTOR",  // Handicap markets with +/- values
  SCORE_GRID: "SCORE_GRID",             // Correct score - grid of scores
  PLAYER_DROPDOWN: "PLAYER_DROPDOWN",    // Goalscorer - dropdown + single odds per player
  PLAYER_STAT_LINES: "PLAYER_STAT_LINES", // Player stat markets - player selector + line thresholds (1+, 2+, etc.)
  STAT_RANGE: "STAT_RANGE",              // Corners, Cards - range selector
  COMBINATION: "COMBINATION",             // Combined markets (Result + BTTS)
  PARAMETERIZED_COMBINATION: "PARAMETERIZED_COMBINATION", // Player combination markets with parameter support (e.g., 2/3 Players Combined Goals)
  HALFTIME_FULLTIME: "HALFTIME_FULLTIME", // 9 outcomes HT/FT grid
  SINGLE_SELECTION: "SINGLE_SELECTION",   // Single selection market (e.g., "Hat-trick", "Red card", "Free kick goal")
} as const;
export type ViewType = (typeof ViewType)[keyof typeof ViewType];

// ============================================================================
// PARAMETER TYPE
// ============================================================================

/**
 * Parameter types for markets with line values
 */
export const ParameterType = {
  DECIMAL: "decimal",
  INTEGER: "integer",
  HANDICAP: "handicap",
  SCORE: "score",
  PLAYER: "player",
  TEAM: "team",
} as const;
export type ParameterType = (typeof ParameterType)[keyof typeof ParameterType];

// ============================================================================
// NORMALIZED MARKET TYPE
// ============================================================================

/**
 * Normalized market types (canonical codes used throughout system)
 */
export const NormalizedMarketType = {
  // Main markets
  MATCH_WINNER: "MATCH_WINNER",
  DOUBLE_CHANCE: "DOUBLE_CHANCE",
  DRAW_NO_BET: "DRAW_NO_BET",
  // Goals markets
  TOTAL_GOALS: "TOTAL_GOALS",
  TOTAL_GOALS_ASIAN: "TOTAL_GOALS_ASIAN", // Integer lines with push/refund possibility
  EXACT_GOALS: "EXACT_GOALS",
  BTTS: "BTTS",
  ODD_EVEN_GOALS: "ODD_EVEN_GOALS",
  HOME_TEAM_ODD_EVEN_GOALS: "HOME_TEAM_ODD_EVEN_GOALS",
  AWAY_TEAM_ODD_EVEN_GOALS: "AWAY_TEAM_ODD_EVEN_GOALS",
  SECOND_HALF_ODD_EVEN_GOALS: "SECOND_HALF_ODD_EVEN_GOALS",
  HALF_TIME_ODD_EVEN_GOALS: "HALF_TIME_ODD_EVEN_GOALS",
  WIN_TO_NIL: "WIN_TO_NIL",
  CLEAN_SHEET: "CLEAN_SHEET",
  HOME_TEAM_TO_SCORE: "HOME_TEAM_TO_SCORE",
  AWAY_TEAM_TO_SCORE: "AWAY_TEAM_TO_SCORE",
  TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
  TEAM_GOAL_RANGE: "TEAM_GOAL_RANGE",
  GOAL_RANGE: "GOAL_RANGE",
    BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
    OWN_GOAL: "OWN_GOAL",
     FREE_KICK_GOAL: "FREE_KICK_GOAL",
    HOME_TEAM_FREE_KICK_GOAL: "HOME_TEAM_FREE_KICK_GOAL",
    AWAY_TEAM_FREE_KICK_GOAL: "AWAY_TEAM_FREE_KICK_GOAL",
    HEADER_GOAL: "HEADER_GOAL",
    HEADER_GOAL_BOTH_HALVES: "HEADER_GOAL_BOTH_HALVES",
    TEAM_HEADER_GOAL: "TEAM_HEADER_GOAL",
     PENALTY_GOAL: "PENALTY_GOAL",
     BTTS_PENALTY: "BTTS_PENALTY",
     BTTS_HEAD_GOALS: "BTTS_HEAD_GOALS",
     BTTS_FREE_KICK: "BTTS_FREE_KICK",
     WINNING_MARGIN: "WINNING_MARGIN",
  WIN_OR_WIN_BY_2: "WIN_OR_WIN_BY_2",
  BTTS_BOTH_HALVES: "BTTS_BOTH_HALVES",
  HALF_TIME_GOAL_RANGE: "HALF_TIME_GOAL_RANGE",
  SECOND_HALF_GOAL_RANGE: "SECOND_HALF_GOAL_RANGE",
  // Handicap markets
  ASIAN_HANDICAP: "ASIAN_HANDICAP",
  EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
  ASIAN_HANDICAP_3WAY: "ASIAN_HANDICAP_3WAY",
  SECOND_HALF_EUROPEAN_HANDICAP: "SECOND_HALF_EUROPEAN_HANDICAP",
  // Half-time markets
  HALF_TIME_RESULT: "HALF_TIME_RESULT",
  HALF_TIME_DOUBLE_CHANCE: "HALF_TIME_DOUBLE_CHANCE",
  HALF_TIME_DRAW_NO_BET: "HALF_TIME_DRAW_NO_BET",
  HALF_TIME_TOTAL_GOALS: "HALF_TIME_TOTAL_GOALS",
  HALF_TIME_TEAM_TOTAL_GOALS: "HALF_TIME_TEAM_TOTAL_GOALS",
  HALF_TIME_EXACT_GOALS: "HALF_TIME_EXACT_GOALS",
  HALF_TIME_FIRST_GOAL: "HALF_TIME_FIRST_GOAL",
  HALF_TIME_BTTS: "HALF_TIME_BTTS",
  HALF_TIME_RESULT_AND_BTTS: "HALF_TIME_RESULT_AND_BTTS",
  HALF_TIME_RESULT_AND_TOTAL: "HALF_TIME_RESULT_AND_TOTAL",
  HALF_TIME_DOUBLE_CHANCE_BTTS: "HALF_TIME_DOUBLE_CHANCE_BTTS",
  FIRST_HALF_ASIAN_HANDICAP: "FIRST_HALF_ASIAN_HANDICAP",
  FIRST_HALF_EUROPEAN_HANDICAP: "FIRST_HALF_EUROPEAN_HANDICAP",
    HALF_TIME_HOME_TO_SCORE: "HALF_TIME_HOME_TO_SCORE",
    HALF_TIME_AWAY_TO_SCORE: "HALF_TIME_AWAY_TO_SCORE",
    HALF_TIME_HEADER_GOAL: "HALF_TIME_HEADER_GOAL",
    HALF_TIME_PENALTY_GOAL: "HALF_TIME_PENALTY_GOAL",
    SECOND_HALF_PENALTY_GOAL: "SECOND_HALF_PENALTY_GOAL",

   SECOND_HALF_RESULT: "SECOND_HALF_RESULT",
  SECOND_HALF_DOUBLE_CHANCE: "SECOND_HALF_DOUBLE_CHANCE",
  SECOND_HALF_TOTAL_GOALS: "SECOND_HALF_TOTAL_GOALS",
  SECOND_HALF_TEAM_TOTAL_GOALS: "SECOND_HALF_TEAM_TOTAL_GOALS",
  SECOND_HALF_EXACT_GOALS: "SECOND_HALF_EXACT_GOALS",
  SECOND_HALF_BTTS: "SECOND_HALF_BTTS",
  SECOND_HALF_RESULT_AND_TOTAL: "SECOND_HALF_RESULT_AND_TOTAL",
  SECOND_HALF_RESULT_AND_BTTS: "SECOND_HALF_RESULT_AND_BTTS",
  SECOND_HALF_DOUBLE_CHANCE_BTTS: "SECOND_HALF_DOUBLE_CHANCE_BTTS",
  SECOND_HALF_HOME_TO_SCORE: "SECOND_HALF_HOME_TO_SCORE",
   SECOND_HALF_AWAY_TO_SCORE: "SECOND_HALF_AWAY_TO_SCORE",
   SECOND_HALF_HEADER_GOAL: "SECOND_HALF_HEADER_GOAL",
   SECOND_HALF_ASIAN_HANDICAP: "SECOND_HALF_ASIAN_HANDICAP",
  SECOND_HALF_FIRST_GOAL: "SECOND_HALF_FIRST_GOAL",
  SECOND_HALF_CORRECT_SCORE: "SECOND_HALF_CORRECT_SCORE",
  SECOND_HALF_DRAW_NO_BET: "SECOND_HALF_DRAW_NO_BET",
  
  TEAM_WIN_AT_LEAST_ONE_HALF: "TEAM_WIN_AT_LEAST_ONE_HALF",
  HOME_WIN_AT_LEAST_ONE_HALF: "HOME_WIN_AT_LEAST_ONE_HALF",
  AWAY_WIN_AT_LEAST_ONE_HALF: "AWAY_WIN_AT_LEAST_ONE_HALF",
  TEAM_WIN_BOTH_HALVES: "TEAM_WIN_BOTH_HALVES",
  HOME_WIN_BOTH_HALVES: "HOME_WIN_BOTH_HALVES",
  AWAY_WIN_BOTH_HALVES: "AWAY_WIN_BOTH_HALVES",
  HOME_WIN_TO_NIL: "HOME_WIN_TO_NIL",
  AWAY_WIN_TO_NIL: "AWAY_WIN_TO_NIL",
  HOME_EXACT_GOALS: "HOME_EXACT_GOALS",
  AWAY_EXACT_GOALS: "AWAY_EXACT_GOALS",
  HOME_GOAL_RANGE: "HOME_GOAL_RANGE",
  AWAY_GOAL_RANGE: "AWAY_GOAL_RANGE",
  HOME_CORNERS_RANGE: "HOME_CORNERS_RANGE",
  AWAY_CORNERS_RANGE: "AWAY_CORNERS_RANGE",
  HOME_HALF_WITH_MOST_GOALS: "HOME_HALF_WITH_MOST_GOALS",
  AWAY_HALF_WITH_MOST_GOALS: "AWAY_HALF_WITH_MOST_GOALS",
  HOME_SCORE_BOTH_HALVES: "HOME_SCORE_BOTH_HALVES",
  AWAY_SCORE_BOTH_HALVES: "AWAY_SCORE_BOTH_HALVES",
  SECOND_HALF_HOME_EXACT_GOALS: "SECOND_HALF_HOME_EXACT_GOALS",
  HOME_TEAM_TOTAL_GOALS: "HOME_TEAM_TOTAL_GOALS",
  AWAY_TEAM_TOTAL_GOALS: "AWAY_TEAM_TOTAL_GOALS",
  HALF_TIME_HOME_TEAM_TOTAL_GOALS: "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
  HALF_TIME_AWAY_TEAM_TOTAL_GOALS: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  SECOND_HALF_HOME_TEAM_TOTAL_GOALS: "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
  SECOND_HALF_AWAY_TEAM_TOTAL_GOALS: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  HALF_WITH_MORE_GOALS: "HALF_WITH_MORE_GOALS",
  TEAM_HALF_WITH_MORE_GOALS: "TEAM_HALF_WITH_MORE_GOALS",
  BTTS_BY_HALF: "BTTS_BY_HALF",
  TEAM_SCORES_BOTH_HALVES: "TEAM_SCORES_BOTH_HALVES",
  BOTH_HALVES_TOTAL_GOALS: "BOTH_HALVES_TOTAL_GOALS",
  BOTH_HALVES_UNDER_GOALS: "BOTH_HALVES_UNDER_GOALS",
  BOTH_HALVES_OVER_GOALS: "BOTH_HALVES_OVER_GOALS",
   // Score markets
   CORRECT_SCORE: "CORRECT_SCORE",
   CORRECT_SCORE_GROUP: "CORRECT_SCORE_GROUP",
   HALF_TIME_CORRECT_SCORE: "HALF_TIME_CORRECT_SCORE",
   HT_FT_CORRECT_SCORE: "HT_FT_CORRECT_SCORE",
  // Player markets (ZAWODNICY)
  GOALSCORER_FIRST: "GOALSCORER_FIRST",
  GOALSCORER_LAST: "GOALSCORER_LAST",
  GOALSCORER_ANYTIME: "GOALSCORER_ANYTIME",
  PLAYER_SHOTS: "PLAYER_SHOTS",
  PLAYER_CARDS: "PLAYER_CARDS",
   PLAYER_ASSISTS: "PLAYER_ASSISTS",
   PLAYER_ASSIST_PAIRS: "PLAYER_ASSIST_PAIRS",
   PLAYER_ASSIST_TRIPLE: "PLAYER_ASSIST_TRIPLE",
   PLAYER_GOALS: "PLAYER_GOALS",
   PLAYER_TACKLES: "PLAYER_TACKLES",
  PLAYER_INTERCEPTIONS: "PLAYER_INTERCEPTIONS",
  PLAYER_FOULS_WON: "PLAYER_FOULS_WON",
  PLAYER_FOULS: "PLAYER_FOULS",
  PLAYER_SAVES: "PLAYER_SAVES",
  PLAYER_RED_CARD: "PLAYER_RED_CARD",
  PLAYER_FREE_KICK_GOAL: "PLAYER_FREE_KICK_GOAL",
  PLAYER_HEADER_GOAL: "PLAYER_HEADER_GOAL",
  PLAYER_GOAL_AND_ASSIST: "PLAYER_GOAL_AND_ASSIST",
  PENALTY_SCORER: "PENALTY_SCORER",
  // Statistics markets (STATYSTYKI)
  CORNERS_TOTAL: "CORNERS_TOTAL",
  CORNERS_TEAM: "CORNERS_TEAM",
  EACH_TEAM_TOTAL_CORNERS_OVER: "EACH_TEAM_TOTAL_CORNERS_OVER",
  EACH_TEAM_TOTAL_CARDS_OVER: "EACH_TEAM_TOTAL_CARDS_OVER",
   CORNERS_RACE: "CORNERS_RACE",
    FOUL_RACE: "FOUL_RACE",
    CORNERS_RANGE: "CORNERS_RANGE",
   CORNERS_TEAM_RANGE: "CORNERS_TEAM_RANGE",
   FIRST_CORNER: "FIRST_CORNER",
   LAST_CORNER: "LAST_CORNER",
   HALF_TIME_LAST_CORNER: "HALF_TIME_LAST_CORNER",
  NEXT_CORNER_1H: "NEXT_CORNER_1H",
  CORNERS_HANDICAP: "CORNERS_HANDICAP",
  HALF_TIME_CORNERS_TOTAL: "HALF_TIME_CORNERS_TOTAL",
  HALF_TIME_CORNERS_TEAM: "HALF_TIME_CORNERS_TEAM",
  HALF_TIME_CORNERS_RACE: "HALF_TIME_CORNERS_RACE",
  HALF_TIME_CORNERS_HANDICAP: "HALF_TIME_CORNERS_HANDICAP",
  HALF_TIME_CORNERS_RANGE: "HALF_TIME_CORNERS_RANGE",
  HALF_TIME_CORNERS_TEAM_RANGE: "HALF_TIME_CORNERS_TEAM_RANGE",
  HALF_TIME_HOME_EXACT_CORNERS: "HALF_TIME_HOME_EXACT_CORNERS",
  HALF_TIME_AWAY_EXACT_CORNERS: "HALF_TIME_AWAY_EXACT_CORNERS",
  HALF_TIME_CORNERS_ODD_EVEN: "HALF_TIME_CORNERS_ODD_EVEN",
  CORNERS_ODD_EVEN: "CORNERS_ODD_EVEN",
  CARDS_TOTAL: "CARDS_TOTAL",
   HALF_TIME_CARDS_TOTAL: "HALF_TIME_CARDS_TOTAL",
   CARDS_EXACT_RANGE: "CARDS_EXACT_RANGE",
    CARDS_TEAM: "CARDS_TEAM",
    CARDS_RACE: "CARDS_RACE",
    FIRST_CARD: "FIRST_CARD",
    FIRST_HALF_FIRST_CARD: "FIRST_HALF_FIRST_CARD",
    FOULS_TOTAL: "FOULS_TOTAL",
   OFFSIDES_TOTAL: "OFFSIDES_TOTAL",
   OFFSIDES_1X2: "OFFSIDES_1X2",
   HOME_TEAM_TOTAL_OFFSIDES: "HOME_TEAM_TOTAL_OFFSIDES",
   AWAY_TEAM_TOTAL_OFFSIDES: "AWAY_TEAM_TOTAL_OFFSIDES",
    HALF_TIME_RED_CARD: "HALF_TIME_RED_CARD",
    RED_CARD: "RED_CARD",
    RED_CARD_TEAM: "RED_CARD_TEAM",
   FIRST_HALF_CARDS_1X2: "FIRST_HALF_CARDS_1X2",
    PENALTY_AWARDED: "PENALTY_AWARDED",
   RED_CARD_AND_PENALTY: "RED_CARD_AND_PENALTY",
   MOST_SHOTS_ON_TARGET: "MOST_SHOTS_ON_TARGET",
    MOST_SHOTS: "MOST_SHOTS",
    TOTAL_SHOTS_ON_TARGET: "TOTAL_SHOTS_ON_TARGET",
    TEAM_TOTAL_SHOTS_ON_TARGET: "TEAM_TOTAL_SHOTS_ON_TARGET",
    TOTAL_SHOTS: "TOTAL_SHOTS",
    TEAM_TOTAL_SHOTS: "TEAM_TOTAL_SHOTS",
    HOME_POSSESSION: "HOME_POSSESSION",
   AWAY_POSSESSION: "AWAY_POSSESSION",
  // Goals timing markets
  TEAMS_TO_SCORE: "TEAMS_TO_SCORE",
  FIRST_TEAM_TO_SCORE: "FIRST_TEAM_TO_SCORE",
  LAST_TEAM_TO_SCORE: "LAST_TEAM_TO_SCORE",
  FIRST_GOAL_TIME: "FIRST_GOAL_TIME",
  TIME_PERIOD_RESULT: "TIME_PERIOD_RESULT",
  FIRST_GOAL_AND_RESULT: "FIRST_GOAL_AND_RESULT",
  // Additional player markets
  PLAYER_GOAL_AND_RESULT: "PLAYER_GOAL_AND_RESULT",
  PLAYER_SHOTS_ON_TARGET: "PLAYER_SHOTS_ON_TARGET",
  PLAYER_PASSES: "PLAYER_PASSES",
   PLAYER_2_OR_MORE_GOALS: "PLAYER_2_OR_MORE_GOALS",
   PLAYER_3_OR_MORE_GOALS: "PLAYER_3_OR_MORE_GOALS",
    PLAYER_HAT_TRICK: "PLAYER_HAT_TRICK",
    TEAM_TOTAL_SCORERS: "TEAM_TOTAL_SCORERS",
    TWO_PLAYERS_COMBINED_GOALS: "TWO_PLAYERS_COMBINED_GOALS",
    THREE_PLAYERS_COMBINED_GOALS: "THREE_PLAYERS_COMBINED_GOALS",
    TWO_PLAYERS_ANYTIME: "TWO_PLAYERS_ANYTIME",
    THREE_PLAYERS_ANYTIME: "THREE_PLAYERS_ANYTIME",
   // Combination markets (KOMBINACJE)
  RESULT_AND_BTTS: "RESULT_AND_BTTS",
  RESULT_AND_TOTAL: "RESULT_AND_TOTAL",
  RESULT_AND_FIRST_GOAL: "RESULT_AND_FIRST_GOAL",
  TOTAL_GOALS_AND_BTTS: "TOTAL_GOALS_AND_BTTS",
  HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
  HALFTIME_FULLTIME_AND_TOTAL: "HALFTIME_FULLTIME_AND_TOTAL",
  HT_OR_FT_RESULT: "HT_OR_FT_RESULT",
  MULTI_RESULT: "MULTI_RESULT",
  DOUBLE_RESULT: "DOUBLE_RESULT",
  DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
  DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
  // Fallback
  OTHER: "OTHER",
} as const;
export type NormalizedMarketType = (typeof NormalizedMarketType)[keyof typeof NormalizedMarketType];

// ============================================================================
// NORMALIZED SELECTION
// ============================================================================

/**
 * Normalized selection types (canonical codes for all selections)
 */
export const NormalizedSelection = {
    HOME: "HOME",
    DRAW: "DRAW",
    AWAY: "AWAY",
    NONE: "NONE",
    TEAM_HOME: "TEAM_HOME",
    TEAM_AWAY: "TEAM_AWAY",
    ANY: "ANY",
    HOME_OR_DRAW: "HOME_OR_DRAW",
    DRAW_OR_AWAY: "DRAW_OR_AWAY",
    HOME_OR_AWAY: "HOME_OR_AWAY",
    OVER: "OVER",
    UNDER: "UNDER",
    YES: "YES",
    NO: "NO",
    ODD: "ODD",
    EVEN: "EVEN",
    UNKNOWN: "UNKNOWN",
    HOME_OVER: "HOME_OVER",
    HOME_UNDER: "HOME_UNDER",
    DRAW_OVER: "DRAW_OVER",
    DRAW_UNDER: "DRAW_UNDER",
    AWAY_OVER: "AWAY_OVER",
    AWAY_UNDER: "AWAY_UNDER",
    HOME_YES: "HOME_YES",
    HOME_NO: "HOME_NO",
    DRAW_YES: "DRAW_YES",
    DRAW_NO: "DRAW_NO",
    AWAY_YES: "AWAY_YES",
    AWAY_NO: "AWAY_NO",
    OVER_YES: "OVER_YES",
  OVER_NO: "OVER_NO",
  UNDER_YES: "UNDER_YES",
  UNDER_NO: "UNDER_NO",
  YES_YES: "YES_YES",
     YES_NO: "YES_NO",
     NO_YES: "NO_YES",
     NO_NO: "NO_NO",
     HOME_HOME: "HOME_HOME",
     HOME_AWAY: "HOME_AWAY",
     DRAW_HOME: "DRAW_HOME",
     DRAW_AWAY: "DRAW_AWAY",
     DRAW_NONE: "DRAW_NONE",
     AWAY_HOME: "AWAY_HOME",
     AWAY_AWAY: "AWAY_AWAY",
    "1X_YES": "1X_YES",
    "1X_NO": "1X_NO",
    "X2_YES": "X2_YES",
    "X2_NO": "X2_NO",
    "12_YES": "12_YES",
    "12_NO": "12_NO",
    PLAYER_PAIR: "PLAYER_PAIR",
    PLAYER_TRIO: "PLAYER_TRIO",
    HOME_WIN_GROUP_0: "HOME_WIN_GROUP_0",
    HOME_WIN_GROUP_1: "HOME_WIN_GROUP_1",
    HOME_WIN_GROUP_2: "HOME_WIN_GROUP_2",
    HOME_WIN_GROUP_3: "HOME_WIN_GROUP_3",
    AWAY_WIN_GROUP_1: "AWAY_WIN_GROUP_1",
    AWAY_WIN_GROUP_2: "AWAY_WIN_GROUP_2",
    AWAY_WIN_GROUP_3: "AWAY_WIN_GROUP_3",
    AWAY_WIN_GROUP_4: "AWAY_WIN_GROUP_4",
    HOME_OTHER: "HOME_OTHER",
    AWAY_OTHER: "AWAY_OTHER",
    "0-15": "0-15",
    "16-30": "16-30",
    "31-45": "31-45",
    "46-60": "46-60",
    "61-75": "61-75",
    "76-90": "76-90",
    TWO_TEAMS: "TWO_TEAMS",
    ONE_TEAM: "ONE_TEAM",
    ONE_TEAM_HOME: "ONE_TEAM_HOME",
    ONE_TEAM_AWAY: "ONE_TEAM_AWAY",
    ZERO_TEAMS: "ZERO_TEAMS",
    HOME_1ST: "HOME_1ST",
    HOME_2ND: "HOME_2ND",
    HOME_EQUAL: "HOME_EQUAL",
    AWAY_1ST: "AWAY_1ST",
    AWAY_2ND: "AWAY_2ND",
    AWAY_EQUAL: "AWAY_EQUAL",
  } as const;
  export type NormalizedSelection = (typeof NormalizedSelection)[keyof typeof NormalizedSelection];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function buildMarketKey(type: NormalizedMarketType, param?: string): string {
  if (!param) return type;
  const normalizedParam = param.replace(",", ".");
  return `${type}:${normalizedParam}`;
}

// ============================================================================
// ADDITIONAL TYPES (for normalization core)
// ============================================================================

export interface RawBookmakerMarket {
  bookmakerMarketId?: string | number;
  name: string;
  groupName?: string;
  selections: Array<{ name: string; odds: number; externalId?: string }>;
}

/**
 * Normalization context passed to normalizers
 */
export interface NormalizationContext {
  homeTeam: string;
  awayTeam: string;
  sportType?: string;
  leagueName?: string;
}

/**
 * Output of a bookmaker normalizer
 */
export interface NormalizedMarketOutput {
  /** Canonical market code (e.g., "TOTAL_GOALS", "MATCH_WINNER") */
  marketCode: NormalizedMarketType;
  /** Parameter value if applicable (e.g., "2.5" for over/under) */
  paramValue?: string;
  /** Multiple parameter values for markets with multiple lines (e.g., ASIAN_HANDICAP_3WAY) */
  parameters?: string[];
  /** Unique market key: marketCode or marketCode:paramValue */
  marketKey: string;
  /** Custom label to override default market catalog label (e.g., "Czerwona kartka - Arsenal") */
  customLabel?: string;
  /** Normalized selections */
  selections: Array<{
    /** Canonical selection code (e.g., "HOME", "OVER", "YES") */
    code: NormalizedSelection;
    /** Original label for display/debug */
    label: string;
    /** Decimal odds */
    odds: number;
  }>;
  /** Debug info for troubleshooting */
  debug?: {
    rawName: string;
    rawId?: string | number;
    matchedBy?: "id" | "name" | "pattern";
  };
}

/**
 * Interface for bookmaker-specific market normalizers.
 * Each bookmaker implements this interface to handle its own market normalization.
 * 
 * This replaces the centralized pattern-matching approach with adapter-first normalization.
 */
export interface BookmakerMarketNormalizer {
  /** Bookmaker identifier (e.g., "sts", "fortuna") */
  bookmaker: string;
  
  /**
   * Normalize a single raw market to canonical format.
   * 
   * @param raw - Raw market data from the scraper
   * @param ctx - Context with team names and other metadata
   * @returns Normalized market or null if market should be skipped/unknown
   */
  normalizeMarket(
    raw: RawBookmakerMarket,
    ctx: NormalizationContext
  ): NormalizedMarketOutput | null;
  
  /**
   * Normalize multiple markets at once (batch processing).
   * Default implementation calls normalizeMarket for each.
   */
  normalizeMarkets?(
    markets: RawBookmakerMarket[],
    ctx: NormalizationContext
  ): NormalizedMarketOutput[];
}

export interface BookmakerMarketData {
  idMappings?: number[];
  additionalPatterns?: RegExp[];
  displayName?: string;
}

export interface MarketDefinition {
  code: string;
  slug?: string;
  numericId?: number;
  name_pl?: string;
  name_en?: string;
  labels?: { pl: string; en: string };
  category: MarketCategory;
  view_type?: ViewType;
  viewType?: ViewType;
  patterns?: (string | RegExp)[];
  selections?: string[];
  hasParameter?: boolean;
  parameterType?: ParameterType;
  extractParam?: (match: RegExpMatchArray) => string | undefined;
  bookmakerData?: Record<string, BookmakerMarketData>;
}

export interface NormalizedMarketSelection {
  name: string;
  normalizedName: NormalizedSelection;
  odds: number;
}

export interface NormalizedMarket {
  name: string;
  normalizedType: NormalizedMarketType;
  marketKey: string;
  category: MarketCategory;
  paramValue?: string;
  customLabel?: string;
  selections: NormalizedMarketSelection[];
}

export interface NormalizedSelectionResult {
  name: string;
  normalizedName: NormalizedSelection;
  odds: number;
}

export type ScrapedMarket = import("../../types/full-offer.js").ScrapedMarket;
