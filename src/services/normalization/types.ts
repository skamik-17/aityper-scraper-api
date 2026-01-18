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
  HALFTIME_FULLTIME: "HALFTIME_FULLTIME", // 9 outcomes HT/FT grid
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
  WIN_TO_NIL: "WIN_TO_NIL",
  CLEAN_SHEET: "CLEAN_SHEET",
  HOME_TEAM_TO_SCORE: "HOME_TEAM_TO_SCORE",
  AWAY_TEAM_TO_SCORE: "AWAY_TEAM_TO_SCORE",
  TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
  TEAM_GOAL_RANGE: "TEAM_GOAL_RANGE",
  GOAL_RANGE: "GOAL_RANGE",
  BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
  WINNING_MARGIN: "WINNING_MARGIN",
  HALF_TIME_GOAL_RANGE: "HALF_TIME_GOAL_RANGE",
  SECOND_HALF_GOAL_RANGE: "SECOND_HALF_GOAL_RANGE",
  // Handicap markets
  ASIAN_HANDICAP: "ASIAN_HANDICAP",
  EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
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
  SECOND_HALF_ASIAN_HANDICAP: "SECOND_HALF_ASIAN_HANDICAP",
  SECOND_HALF_FIRST_GOAL: "SECOND_HALF_FIRST_GOAL",
  SECOND_HALF_CORRECT_SCORE: "SECOND_HALF_CORRECT_SCORE",
  
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
  HALF_TIME_CORRECT_SCORE: "HALF_TIME_CORRECT_SCORE",
  HT_FT_CORRECT_SCORE: "HT_FT_CORRECT_SCORE",
  // Player markets (ZAWODNICY)
  GOALSCORER_FIRST: "GOALSCORER_FIRST",
  GOALSCORER_LAST: "GOALSCORER_LAST",
  GOALSCORER_ANYTIME: "GOALSCORER_ANYTIME",
  PLAYER_SHOTS: "PLAYER_SHOTS",
  PLAYER_CARDS: "PLAYER_CARDS",
  PLAYER_ASSISTS: "PLAYER_ASSISTS",
  PLAYER_GOALS: "PLAYER_GOALS",
  PLAYER_TACKLES: "PLAYER_TACKLES",
  PLAYER_INTERCEPTIONS: "PLAYER_INTERCEPTIONS",
  PLAYER_FOULS_WON: "PLAYER_FOULS_WON",
  PLAYER_FOULS: "PLAYER_FOULS",
  PLAYER_SAVES: "PLAYER_SAVES",
  // Statistics markets (STATYSTYKI)
  CORNERS_TOTAL: "CORNERS_TOTAL",
  CORNERS_TEAM: "CORNERS_TEAM",
  EACH_TEAM_TOTAL_CORNERS_OVER: "EACH_TEAM_TOTAL_CORNERS_OVER",
  EACH_TEAM_TOTAL_CARDS_OVER: "EACH_TEAM_TOTAL_CARDS_OVER",
  CORNERS_RACE: "CORNERS_RACE",
  CORNERS_RANGE: "CORNERS_RANGE",
  CORNERS_TEAM_RANGE: "CORNERS_TEAM_RANGE",
  FIRST_CORNER: "FIRST_CORNER",
  CORNERS_HANDICAP: "CORNERS_HANDICAP",
  HALF_TIME_CORNERS_TOTAL: "HALF_TIME_CORNERS_TOTAL",
  HALF_TIME_CORNERS_TEAM: "HALF_TIME_CORNERS_TEAM",
  HALF_TIME_CORNERS_RACE: "HALF_TIME_CORNERS_RACE",
  HALF_TIME_CORNERS_HANDICAP: "HALF_TIME_CORNERS_HANDICAP",
  HALF_TIME_CORNERS_RANGE: "HALF_TIME_CORNERS_RANGE",
  HALF_TIME_CORNERS_TEAM_RANGE: "HALF_TIME_CORNERS_TEAM_RANGE",
  HALF_TIME_HOME_EXACT_CORNERS: "HALF_TIME_HOME_EXACT_CORNERS",
  HALF_TIME_AWAY_EXACT_CORNERS: "HALF_TIME_AWAY_EXACT_CORNERS",
  CARDS_TOTAL: "CARDS_TOTAL",
  CARDS_TEAM: "CARDS_TEAM",
  CARDS_RACE: "CARDS_RACE",
  FIRST_CARD: "FIRST_CARD",
  FOULS_TOTAL: "FOULS_TOTAL",
  OFFSIDES_TOTAL: "OFFSIDES_TOTAL",
  HALF_TIME_RED_CARD: "HALF_TIME_RED_CARD",
  PENALTY_AWARDED: "PENALTY_AWARDED",
  RED_CARD_AND_PENALTY: "RED_CARD_AND_PENALTY",
  MOST_SHOTS_ON_TARGET: "MOST_SHOTS_ON_TARGET",
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
  // Combination markets (KOMBINACJE)
  RESULT_AND_BTTS: "RESULT_AND_BTTS",
  RESULT_AND_TOTAL: "RESULT_AND_TOTAL",
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
   HOME_OR_DRAW: "HOME_OR_DRAW", // 1X
   DRAW_OR_AWAY: "DRAW_OR_AWAY", // X2
   HOME_OR_AWAY: "HOME_OR_AWAY", // 12
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
  "1X_YES": "1X_YES",
  "1X_NO": "1X_NO",
  "X2_YES": "X2_YES",
  "X2_NO": "X2_NO",
  "12_YES": "12_YES",
  "12_NO": "12_NO",
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
  /** Unique market key: marketCode or marketCode:paramValue */
  marketKey: string;
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
  selections: NormalizedMarketSelection[];
}

export interface NormalizedSelectionResult {
  name: string;
  normalizedName: NormalizedSelection;
  odds: number;
}

export type ScrapedMarket = import("../../types/full-offer.js").ScrapedMarket;
