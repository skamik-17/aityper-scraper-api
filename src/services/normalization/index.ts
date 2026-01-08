/**
 * Normalization System - Public API
 *
 * Unified market normalization system with global registry and bookmaker adapters.
 *
 * Usage:
 * ```ts
 * import { normalizer } from "./services/normalization/index.js";
 *
 * const normalized = normalizer.normalize(market, "sts", "Arsenal", "Liverpool");
 * console.log(normalized.normalizedType); // "TOTAL_GOALS"
 * console.log(normalized.paramValue); // "2.5"
 * ```
 */

import type { ScrapedMarket } from "../../types/full-offer.js";
import { normalizer as unifiedNormalizer } from "./factory.js";

// ==========================================================================
// Core
// ==========================================================================

export { UnifiedNormalizer } from "./core/unified-normalizer.js";
export { matchPattern, matchPatterns, extractParameter } from "./core/pattern-engine.js";
export {
  normalizeSelection,
  normalizeSelections,
} from "./core/selection-normalizer.js";

// ==========================================================================
// Market Registry
// ==========================================================================

export {
  MARKET_REGISTRY,
  MAIN_MARKETS,
  GOALS_MARKETS,
  HANDICAP_MARKETS,
  HALF_TIME_MARKETS,
  CORRECT_SCORE_MARKETS,
  PLAYER_MARKETS,
  STATISTICS_MARKETS,
  COMBINATION_MARKETS,
  getMarketById,
  getMarketsByCategory,
  getMarketByType,
} from "./core/market-registry.js";

// ==========================================================================
// Factory
// ==========================================================================

export { createNormalizer, normalizer } from "./factory.js";

// ==========================================================================
// Types
// ==========================================================================

export * from "./types.js";

// ==========================================================================
// Bookmaker Adapters
// ==========================================================================

export { stsAdapter } from "./bookmakers/sts-adapter.js";

// TODO: Export remaining adapters as they are created
// export { fortunaAdapter } from "./bookmakers/fortuna-adapter.js";
// export { superbetAdapter } from "./bookmakers/superbet-adapter.js";
// ... etc

// ==========================================================================
// Legacy API Compatibility
// ==========================================================================

/**
 * Normalize all markets for a specific bookmaker (Legacy API wrapper)
 *
 * This function maintains compatibility with the old market-normalizer.ts API
 * while using the new unified normalization system internally.
 *
 * @param markets - The scraped markets to normalize
 * @param bookmaker - Bookmaker identifier for specific normalization rules
 * @param homeTeam - Home team name for selection matching
 * @param awayTeam - Away team name for selection matching
 * @returns Array of normalized markets (ScrapedMarket format for compatibility)
 */
export function normalizeMarketsForBookmaker(
  markets: ScrapedMarket[],
  bookmaker: string,
  homeTeam?: string,
  awayTeam?: string
): ScrapedMarket[] {
  return markets.map((market) => {
    const normalized = unifiedNormalizer.normalize(market, bookmaker, homeTeam, awayTeam);

    // Merge normalized data with original market for compatibility
    // Use type assertions to handle type system differences between old and new
    const merged: ScrapedMarket = {
      ...market,
      normalizedType: normalized.normalizedType as any,
      marketKey: normalized.marketKey,
      paramValue: normalized.paramValue,
      category: normalized.category,
      selections: market.selections.map((sel, idx) => ({
        ...sel,
        normalizedName: normalized.selections[idx]?.normalizedName as any,
      })),
    };

    return merged;
  });
}
