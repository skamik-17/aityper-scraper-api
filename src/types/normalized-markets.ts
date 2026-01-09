/**
 * Normalized Markets Types
 *
 * Types for normalized betting markets with category support following Superbet pattern.
 * These types enable cross-bookmaker comparison and organized display in UI.
 */

// ============================================================================
// Market Category (Re-exported from normalization service)
// ============================================================================

/**
 * Market categories for UI organization (following Superbet pattern)
 * Canonical definition is in services/normalization/types.ts
 */
import { MarketCategory } from "../services/normalization/types.js";
export { MarketCategory };

// ============================================================================
// Type to Category Mapping
// ============================================================================

/**
 * Re-export NormalizedMarketType for convenience
 */
export type { NormalizedMarketType } from "./normalization.js";

/**
 * Mapping from NormalizedMarketType to MarketCategory
 * Follows the Superbet pattern for market organization
 */
export const MARKET_TYPE_TO_CATEGORY: Record<string, MarketCategory> = {
  // Match result markets
  MATCH_WINNER: MarketCategory.WYNIK_MECZU,
  DOUBLE_CHANCE: MarketCategory.WYNIK_MECZU,
  DRAW_NO_BET: MarketCategory.WYNIK_MECZU,

  // Goals markets
  TOTAL_GOALS: MarketCategory.GOLE,
  BTTS: MarketCategory.GOLE,
  ODD_EVEN_GOALS: MarketCategory.GOLE,
  WIN_TO_NIL: MarketCategory.GOLE,
  CLEAN_SHEET: MarketCategory.GOLE,

  // Handicap markets
  ASIAN_HANDICAP: MarketCategory.HANDICAP,
  EUROPEAN_HANDICAP: MarketCategory.HANDICAP,

  // First half markets
  HALF_TIME_RESULT: MarketCategory.PIERWSZA_POLOWA,
  HALF_TIME_TOTAL_GOALS: MarketCategory.PIERWSZA_POLOWA,
  HALF_TIME_BTTS: MarketCategory.PIERWSZA_POLOWA,

  // Correct score
  CORRECT_SCORE: MarketCategory.DOKLADNY_WYNIK,

  // Player markets -> ZAWODNICY
  GOALSCORER_FIRST: MarketCategory.ZAWODNICY,
  GOALSCORER_LAST: MarketCategory.ZAWODNICY,
  GOALSCORER_ANYTIME: MarketCategory.ZAWODNICY,
  PLAYER_SHOTS: MarketCategory.ZAWODNICY,
  PLAYER_CARDS: MarketCategory.ZAWODNICY,
  PLAYER_ASSISTS: MarketCategory.ZAWODNICY,
  HOME_TEAM_TO_SCORE: MarketCategory.ZAWODNICY,
  AWAY_TEAM_TO_SCORE: MarketCategory.ZAWODNICY,

  // Statistics markets -> STATYSTYKI
  CORNERS_TOTAL: MarketCategory.STATYSTYKI,
  CORNERS_TEAM: MarketCategory.STATYSTYKI,
  CARDS_TOTAL: MarketCategory.STATYSTYKI,
  CARDS_TEAM: MarketCategory.STATYSTYKI,
  FOULS_TOTAL: MarketCategory.STATYSTYKI,
  OFFSIDES_TOTAL: MarketCategory.STATYSTYKI,

  // Combination markets -> KOMBINACJE
  RESULT_AND_BTTS: MarketCategory.KOMBINACJE,
  RESULT_AND_TOTAL: MarketCategory.KOMBINACJE,
  HALFTIME_FULLTIME: MarketCategory.KOMBINACJE,
  DOUBLE_RESULT: MarketCategory.KOMBINACJE,

  // Other (fallback)
  OTHER: MarketCategory.INNE,
};

// ============================================================================
// Normalized Market Interfaces
// ============================================================================

/**
 * Re-export NormalizedSelection for convenience
 */
export type { NormalizedSelection } from "./normalization.js";

/**
 * Znormalizowany rynek z parametrami
 * Normalized market with parameters for cross-bookmaker comparison
 */
export interface NormalizedMarket {
  /** Unikalny klucz rynku (np. "TOTAL_GOALS:2.5") */
  marketKey: string;

  /** Typ rynku */
  type: string;

  /** Kategoria dla UI (wg Superbet) */
  category: MarketCategory;

  /** Parametr (np. linia dla Over/Under, Handicap) */
  param?: string;

  /** Nazwa wyświetlana (po polsku) */
  label: string;

  /** Selekcje dostępne dla tego rynku */
  selections: NormalizedMarketSelection[];
}

/**
 * Selekcja znormalizowanego rynku
 * Normalized market selection with odds
 */
export interface NormalizedMarketSelection {
  /** Unikalne ID selekcji */
  id: string;

  /** Znormalizowany typ selekcji */
  type: string;

  /** Nazwa wyświetlana (po polsku) */
  label: string;

  /** Kurs */
  odds: number;

  /** Oryginalna nazwa z bukmachera */
  originalName?: string;
}

// ============================================================================
// Comparable Market Interfaces
// ============================================================================

/**
 * Porównywalne rynki między bukmacherami
 * Comparable markets across bookmakers - grouped by marketKey
 */
export interface ComparableMarketGroup {
  /** Klucz grupy (np. "TOTAL_GOALS:2.5") */
  marketKey: string;

  /** Typ rynku */
  type: string;

  /** Kategoria */
  category: MarketCategory;

  /** Parametr (jeśli dotyczy) */
  param?: string;

  /** Label do wyświetlenia */
  label: string;

  /** Lista bukmacherów z kursem dla tego rynku */
  bookmakers: BookmakerMarketOdds[];
}

/**
 * Kursy bukmachera dla znormalizowanego rynku
 * Bookmaker odds for a normalized market
 */
export interface BookmakerMarketOdds {
  /** Bukmacher */
  bookmaker: string;

  /** Nazwa wyświetlana */
  bookmakerName: string;

  /** Selekcje z kursami */
  selections: {
    /** Typ selekcji (HOME, OVER, YES, etc.) */
    type: string;

    /** Kurs */
    odds: number;

    /** Czy bez podatku (gra bez podatku) */
    hasNoTaxPromo?: boolean;
  }[];
}

// ============================================================================
// Category Labels (Polish)
// ============================================================================

/**
 * Polish labels for market categories
 */
export const CATEGORY_LABELS: Record<MarketCategory, string> = {
  [MarketCategory.WYNIK_MECZU]: "Wynik meczu",
  [MarketCategory.GOLE]: "Gole",
  [MarketCategory.HANDICAP]: "Handicap",
  [MarketCategory.PIERWSZA_POLOWA]: "Pierwsza połowa",
  [MarketCategory.DOKLADNY_WYNIK]: "Dokładny wynik",
  [MarketCategory.ZAWODNICY]: "Zawodnicy",
  [MarketCategory.STATYSTYKI]: "Statystyki",
  [MarketCategory.KOMBINACJE]: "Kombinacje",
  [MarketCategory.INNE]: "Inne",
};

/**
 * Sort order for categories in UI
 */
export const CATEGORY_ORDER: MarketCategory[] = [
  MarketCategory.WYNIK_MECZU,
  MarketCategory.GOLE,
  MarketCategory.HANDICAP,
  MarketCategory.PIERWSZA_POLOWA,
  MarketCategory.DOKLADNY_WYNIK,
  MarketCategory.ZAWODNICY,
  MarketCategory.STATYSTYKI,
  MarketCategory.KOMBINACJE,
  MarketCategory.INNE,
];

// ============================================================================
// Parametrized Market Types (New Architecture)
// ============================================================================

/**
 * Market parameter with bookmaker odds for that specific parameter
 * E.g., for ASIAN_HANDICAP: +0.5, +1.0, etc.
 */
export interface MarketParameter {
  /** Parameter value (e.g., "+0.5", "2.5", "-1") */
  value: string;

  /** Display label for this parameter */
  label: string;

  /** Bookmakers with odds for this specific parameter */
  bookmakers: MarketParameterBookmaker[];
}

/**
 * Bookmaker odds for a specific market parameter
 */
export interface MarketParameterBookmaker {
  /** Bookmaker code */
  bookmaker: string;

  /** Display name */
  bookmakerName: string;

  /** Selections (HOME/AWAY, OVER/UNDER, YES/NO, etc.) */
  selections: Array<{
    /** Selection type */
    type: string;

    /** Odds value */
    odds: number;

    /** Whether this is a no-tax promotion */
    hasNoTaxPromo?: boolean;
  }>;
}

/**
 * Market with parameters - groups same market type with different parameter values
 * E.g., one ASIAN_HANDICAP entry with all lines (+0.5, +1.0, +1.5, etc.)
 *
 * This is the NEW structure that replaces multiple ComparableMarketGroup entries
 */
export interface MarketWithParams {
  /** Unique key for the market type (without parameter, e.g., "ASIAN_HANDICAP") */
  marketKey: string;

  /** Market type */
  type: string;

  /** Category for UI organization */
  category: MarketCategory;

  /** Main display label (e.g., "Handicap azjatycki") */
  label: string;

  /** Description of what this market means (for tooltip) */
  description?: string;

  /** Display order for sorting within category (from market_types table) */
  displayOrder?: number;

  /** All available parameters for this market type */
  parameters: MarketParameter[];

  /** Suggested default parameter */
  defaultParameter?: string;

  /** Whether this market has parameters (false for markets like CORRECT_SCORE) */
  hasParameters: boolean;
}
