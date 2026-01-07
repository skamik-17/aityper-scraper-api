/**
 * Normalized Markets Types
 *
 * Types for normalized betting markets with category support following Superbet pattern.
 * These types enable cross-bookmaker comparison and organized display in UI.
 */

import type { MarketType, OverUnderLine } from "./markets.js";

// ============================================================================
// Market Category Enum (Superbet Pattern)
// ============================================================================

/**
 * Market categories for UI organization (following Superbet pattern)
 * Polish labels are used for frontend display
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

  /** Other markets - Special markets, player props, corners, cards */
  INNE = "INNE",
}

// ============================================================================
// Type to Category Mapping
// ============================================================================

/**
 * Re-export NormalizedMarketType for convenience
 */
export { NormalizedMarketType } from "./normalization.js";

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

  // Other
  OTHER: MarketCategory.INNE,
};

// ============================================================================
// Normalized Market Interfaces
// ============================================================================

/**
 * Re-export NormalizedSelection for convenience
 */
export { NormalizedSelection } from "./normalization.js";

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
  MarketCategory.INNE,
];
