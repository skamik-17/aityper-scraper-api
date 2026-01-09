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
  PLAYER_DROPDOWN: "PLAYER_DROPDOWN",    // Goalscorer - dropdown + buttons
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
  BTTS: "BTTS",
  ODD_EVEN_GOALS: "ODD_EVEN_GOALS",
  WIN_TO_NIL: "WIN_TO_NIL",
  CLEAN_SHEET: "CLEAN_SHEET",
  HOME_TEAM_TO_SCORE: "HOME_TEAM_TO_SCORE",
  AWAY_TEAM_TO_SCORE: "AWAY_TEAM_TO_SCORE",
  TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
  GOAL_RANGE: "GOAL_RANGE",
  BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
  WINNING_MARGIN: "WINNING_MARGIN",
  // Handicap markets
  ASIAN_HANDICAP: "ASIAN_HANDICAP",
  EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
  // Half-time markets
  HALF_TIME_RESULT: "HALF_TIME_RESULT",
  HALF_TIME_TOTAL_GOALS: "HALF_TIME_TOTAL_GOALS",
  HALF_TIME_BTTS: "HALF_TIME_BTTS",
  SECOND_HALF_RESULT: "SECOND_HALF_RESULT",
  SECOND_HALF_TOTAL_GOALS: "SECOND_HALF_TOTAL_GOALS",
  // Score markets
  CORRECT_SCORE: "CORRECT_SCORE",
  // Player markets (ZAWODNICY)
  GOALSCORER_FIRST: "GOALSCORER_FIRST",
  GOALSCORER_LAST: "GOALSCORER_LAST",
  GOALSCORER_ANYTIME: "GOALSCORER_ANYTIME",
  PLAYER_SHOTS: "PLAYER_SHOTS",
  PLAYER_CARDS: "PLAYER_CARDS",
  PLAYER_ASSISTS: "PLAYER_ASSISTS",
  // Statistics markets (STATYSTYKI)
  CORNERS_TOTAL: "CORNERS_TOTAL",
  CORNERS_TEAM: "CORNERS_TEAM",
  CORNERS_RACE: "CORNERS_RACE",
  FIRST_CORNER: "FIRST_CORNER",
  CORNERS_HANDICAP: "CORNERS_HANDICAP",
  CARDS_TOTAL: "CARDS_TOTAL",
  CARDS_TEAM: "CARDS_TEAM",
  CARDS_RACE: "CARDS_RACE",
  FIRST_CARD: "FIRST_CARD",
  FOULS_TOTAL: "FOULS_TOTAL",
  OFFSIDES_TOTAL: "OFFSIDES_TOTAL",
  // Goals timing markets
  FIRST_TEAM_TO_SCORE: "FIRST_TEAM_TO_SCORE",
  FIRST_GOAL_TIME: "FIRST_GOAL_TIME",
  TIME_PERIOD_RESULT: "TIME_PERIOD_RESULT",
  FIRST_GOAL_AND_RESULT: "FIRST_GOAL_AND_RESULT",
  // Additional player markets
  PLAYER_GOAL_AND_RESULT: "PLAYER_GOAL_AND_RESULT",
  PLAYER_SHOTS_ON_TARGET: "PLAYER_SHOTS_ON_TARGET",
  PLAYER_PASSES: "PLAYER_PASSES",
  // Combination markets (KOMBINACJE)
  RESULT_AND_BTTS: "RESULT_AND_BTTS",
  RESULT_AND_TOTAL: "RESULT_AND_TOTAL",
  HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
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

export interface BookmakerAdapter {
  bookmaker: string;
  bookmakerName: string;
  idMappings?: Map<number, string>;
  selectionOverrides?: Record<string, NormalizedSelection>;
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
  patterns: (string | RegExp)[];
  selections?: string[];
  hasParameter?: boolean;
  parameterType?: ParameterType;
  extractParam?: (match: RegExpMatchArray) => string | undefined;
  bookmakerData?: Record<string, BookmakerMarketData>;
}

export interface PatternMatch {
  definition: MarketDefinition;
  parameter?: string;
  param?: string;
  match?: RegExpMatchArray;
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

export type NormalMarket = NormalizedMarket;
export type ScrapedMarket = import("../../types/full-offer.js").ScrapedMarket;
