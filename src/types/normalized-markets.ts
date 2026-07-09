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

// ============================================================================
// Re-exports from market-registry (Single Source of Truth)
// ============================================================================

export {
  getCategoryForCode,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from "../data/market-catalog.js";

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

  /** Raw market name from bookmaker (e.g., "Wynik meczu" for STS, "Wynik spotkania" for Betclic) */
  rawMarketName?: string;

  /** Selections (HOME/AWAY, OVER/UNDER, YES/NO, etc.) */
  selections: Array<{
    /** Selection type */
    type: string;

    /** Odds value */
    odds: number;

    /** Whether this is a no-tax promotion */
    hasNoTaxPromo?: boolean;

    /** Optional display label override (e.g., "Gospodarze (-0.5)" for handicap per-team perspective). If set, frontend should prefer this over generic selectionLabels. */
    label?: string;

    /**
     * Odds-quarantine flag (SPEC.md §5): true when the quote looks like a
     * scraper/normalizer artifact (placeholder value >= 1000 or decimal-shifted
     * vs the cross-bookmaker pool median). Suspect quotes stay in the payload
     * so audit tooling still sees them, but the frontend must never let them
     * win best-odds and renders them greyed-out.
     */
    suspect?: boolean;
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

  /** Subcategory for finer UI grouping within a category */
  subCategory?: string;

  /** Main display label (e.g., "Handicap azjatycki") */
  label: string;

  /** Description of what this market means (for tooltip) */
  description?: string;

  /** Display order for sorting within category (from market_types table) */
  displayOrder?: number;

  /** View type for UI rendering (TRIPLE_BUTTONS, BINARY_BUTTONS, PARAMETER_SLIDER, etc.) */
  viewType?: string;

  /** All available parameters for this market type */
  parameters: MarketParameter[];

  /** Suggested default parameter */
  defaultParameter?: string;

  /** Whether this market has parameters (false for markets like CORRECT_SCORE) */
  hasParameters: boolean;
}
