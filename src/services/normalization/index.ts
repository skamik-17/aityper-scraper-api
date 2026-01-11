/**
 * Normalization System - Public API
 *
 * Adapter-first market normalization system with bookmaker-specific normalizers.
 */

import type { ScrapedMarket } from "../../types/full-offer.js";
import { normalizer as normalizerFacade } from "./factory.js";

// ==========================================================================
// Core - Selection Normalizer (still needed)
// ==========================================================================

export {
  normalizeSelection,
  normalizeSelections,
} from "./core/selection-normalizer.js";

// ==========================================================================
// Market Registry (from unified registry)
// ==========================================================================

export {
  MARKET_REGISTRY,
  UNIFIED_MARKET_REGISTRY,
  MARKET_BY_CODE,
  MARKET_BY_NUMERIC_ID,
  MARKET_BY_SLUG,
  CANONICAL_MARKET_CODES,
  getMarketById,
  getMarketByCode,
  getMarketBySlug,
  getMarketByNumericId,
  getMarketsByCategory,
  getMarketByType,
  isCanonicalMarket,
} from "../../data/market-registry.js";

// ==========================================================================
// Factory
// ==========================================================================

export {
  createNormalizer,
  normalizer,
  getNormalizerForBookmaker,
  getSupportedBookmakers,
  hasNormalizer,
} from "./factory.js";

// ==========================================================================
// Types
// ==========================================================================

export * from "./types.js";

// ==========================================================================
// Bookmaker Normalizers
// ==========================================================================

export {
  stsNormalizer,
  fortunaNormalizer,
  superbetNormalizer,
  betclicNormalizer,
  betcrisNormalizer,
  betfanNormalizer,
  bettersNormalizer,
  etotoNormalizer,
  forbetNormalizer,
  fuksiarzNormalizer,
  lebullNormalizer,
  lvbetNormalizer,
  pzbukNormalizer,
  totalbetNormalizer,
} from "./bookmakers/index.js";

// ==========================================================================
// Legacy API Compatibility
// ==========================================================================

export function normalizeMarketsForBookmaker(
  markets: ScrapedMarket[],
  bookmaker: string,
  homeTeam?: string,
  awayTeam?: string
): ScrapedMarket[] {
  return markets.map((market) => {
    const normalized = normalizerFacade.normalize(market, bookmaker, homeTeam, awayTeam);

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
