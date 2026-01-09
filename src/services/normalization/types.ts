/**
 * Normalization Types - Hybrid Architecture
 *
 * Central type definitions for the unified market normalization system.
 * Single source of truth for all normalization-related types.
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Market categories for UI organization (following Superbet pattern)
 */
export enum MarketCategory {
  /** Match result markets - 1X2, Double Chance, Draw No Bet */
  WYNIK_MECZU = "WYNIK_MECZU",

  /** Goals markets - BTTS, Over/Under, Odd/Even, Win to Nil, Clean Sheet */
  GOLE = "GOLE",

  /** Handicap markets - Asian Handicap, European Handicap */
  HANDICAP = "HANDICAP",

  /** First half markets - HT Result, HT Goals, HT BTTS */
  PIERWSZA_POLOWA = "PIERWSZA_POLOWA",

  /** Correct Score markets */
  DOKLADNY_WYNIK = "DOKLADNY_WYNIK",

  /** Player props - goalscorers, cards, assists */
  ZAWODNICY = "ZAWODNICY",

  /** Statistics - corners, team cards, fouls */
  STATYSTYKI = "STATYSTYKI",

  /** Combination markets - Result+BTTS, Result+O/U, HT/FT */
  KOMBINACJE = "KOMBINACJE",

  /** Other markets - truly unknown/special markets */
  INNE = "INNE",
}

/**
 * Normalized market types
 */
export type NormalizedMarketType =
  // Main markets
  | "MATCH_WINNER"
  | "DOUBLE_CHANCE"
  | "DRAW_NO_BET"
  // Goals markets
  | "TOTAL_GOALS"
  | "BTTS"
  | "ODD_EVEN_GOALS"
  | "WIN_TO_NIL"
  | "CLEAN_SHEET"
  | "HOME_TEAM_TO_SCORE"
  | "AWAY_TEAM_TO_SCORE"
  | "TEAM_TOTAL_GOALS"
  | "GOAL_RANGE"
  | "BOTH_HALVES_GOALS"
  | "WINNING_MARGIN"
  // Handicap markets
  | "ASIAN_HANDICAP"
  | "EUROPEAN_HANDICAP"
  // Half-time markets
  | "HALF_TIME_RESULT"
  | "HALF_TIME_TOTAL_GOALS"
  | "HALF_TIME_BTTS"
  | "SECOND_HALF_RESULT"
  | "SECOND_HALF_TOTAL_GOALS"
  // Score markets
  | "CORRECT_SCORE"
  // Player markets (ZAWODNICY)
  | "GOALSCORER_FIRST"
  | "GOALSCORER_LAST"
  | "GOALSCORER_ANYTIME"
  | "PLAYER_SHOTS"
  | "PLAYER_CARDS"
  | "PLAYER_ASSISTS"
  // Statistics markets (STATYSTYKI)
  | "CORNERS_TOTAL"
  | "CORNERS_TEAM"
  | "CARDS_TOTAL"
  | "CARDS_TEAM"
  | "FOULS_TOTAL"
  | "OFFSIDES_TOTAL"
  // Combination markets (KOMBINACJE)
  | "RESULT_AND_BTTS"
  | "RESULT_AND_TOTAL"
  | "HALFTIME_FULLTIME"
  | "DOUBLE_RESULT"
  | "DOUBLE_CHANCE_BTTS"
  | "DOUBLE_CHANCE_TOTAL"
  // Fallback
  | "OTHER";

/**
 * Normalized selection types
 */
export type NormalizedSelection =
  | "HOME"
  | "DRAW"
  | "AWAY"
  | "HOME_OR_DRAW" // 1X
  | "DRAW_OR_AWAY" // X2
  | "HOME_OR_AWAY" // 12
  | "OVER"
  | "UNDER"
  | "YES"
  | "NO"
  | "ODD"
  | "EVEN"
  | "UNKNOWN";

// ============================================================================
// Market Definition - Re-exported from unified registry
// ============================================================================

/**
 * Re-export from unified market registry for compatibility.
 * The canonical definition is in data/market-registry.ts
 */
import type {
  UnifiedMarketDefinition,
  BookmakerMarketData as BookmakerMarketDataType,
} from "../../data/market-registry.js";

export type MarketDefinition = UnifiedMarketDefinition;
export type BookmakerMarketData = BookmakerMarketDataType;

// ============================================================================
// Bookmaker Adapter
// ============================================================================

/**
 * Market-specific overrides for a bookmaker
 */
export interface MarketOverride {
  /** Different patterns for this bookmaker */
  patterns?: RegExp[];

  /** Different selection logic for this bookmaker */
  selectionLogic?: (selectionName: string) => NormalizedSelection;
}

/**
 * Bookmaker adapter - contains only bookmaker-specific data
 *
 * Most logic is in MARKET_REGISTRY. Adapters only contain:
 * - ID mappings (for STS "Rynek XX" format)
 * - Selection overrides (bookmaker-specific codes)
 * - Market overrides (rare, when patterns differ significantly)
 */
export interface BookmakerAdapter {
  /** Bookmaker code (e.g., "sts", "fortuna") */
  bookmaker: string;

  /** Display name */
  bookmakerName: string;

  /**
   * ID mappings: market ID → market definition ID
   * Used for STS-style "Rynek XX" format
   */
  idMappings?: Map<number, string>;

  /**
   * Selection name overrides
   * Key: regex pattern, Value: normalized selection
   * Example: { "^1X$": "HOME_OR_DRAW" }
   */
  selectionOverrides?: Record<string, NormalizedSelection>;

  /**
   * Market-specific overrides
   * Rarely used, only when a bookmaker has significantly different patterns
   */
  marketOverrides?: Record<string, MarketOverride>;
}

// ============================================================================
// Normalization Result
// ============================================================================

/**
 * Normalized selection result with odds
 */
export interface NormalizedSelectionResult {
  /** Original selection name */
  name: string;

  /** Normalized selection type */
  normalizedName: NormalizedSelection;

  /** Odds value */
  odds: number;
}

/**
 * Normalized market result
 */
export interface NormalizedMarket {
  /** Original market name */
  name: string;

  /** Market type */
  normalizedType: NormalizedMarketType;

  /** Market key (e.g., "TOTAL_GOALS:2.5") */
  marketKey: string;

  /** Category */
  category: MarketCategory;

  /** Parameter value (if applicable) */
  paramValue?: string;

  /** Normalized selections */
  selections: NormalizedSelectionResult[];
}

// ============================================================================
// Pattern Match Result
// ============================================================================

/**
 * Result of pattern matching
 */
export interface PatternMatch {
  /** Matching market definition */
  definition: MarketDefinition;

  /** Extracted parameter value */
  param?: string;

  /** RegExp match array for parameter extraction */
  match: RegExpMatchArray;
}

// ============================================================================
// Scraped Market (from existing system)
// ============================================================================

/**
 * Market selection as scraped from bookmaker
 */
export interface ScrapedMarketSelection {
  name: string;
  odds: number;
  /** Optional: normalized name from initial processing */
  normalizedName?: NormalizedSelection;
}

/**
 * Raw scraped market from bookmaker
 */
export interface ScrapedMarket {
  name: string;
  selections: ScrapedMarketSelection[];

  /** Optional: type hint from scraper (e.g., Superbet provides this) */
  type?: string;

  /** Optional: group hint from scraper */
  groupName?: string;

  /** Optional: pre-normalized values */
  normalizedType?: NormalizedMarketType;
  normalizedGroup?: string;
  marketKey?: string;
  paramValue?: string;
  category?: MarketCategory;
}
