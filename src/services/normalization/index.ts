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
} from "./core/selection-normalizer.js";

// ==========================================================================
// Market Catalog (essential exports only)
// ==========================================================================

export {
  MARKET_CATALOG,
  MARKET_BY_CODE,
  CANONICAL_MARKET_CODES,
  getMarketByCode,
} from "../../data/market-catalog.js";

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
  awayTeam?: string,
  league?: string
): ScrapedMarket[] {
  return markets.map((market) => {
    const normalized = normalizerFacade.normalize(market, bookmaker, homeTeam, awayTeam, league);

    // Normalizers may merge raw selections that map to one catalog code
    // (e.g. exact goals "3"/"4"/"5" -> "3+" with combined odds). The index
    // join below only works when the selection count is unchanged — when a
    // normalizer collapsed/filtered selections, its output (including the
    // recomputed odds) is authoritative and must not be discarded.
    const selections =
      normalized.selections.length === market.selections.length
        ? market.selections.map((sel, idx) => ({
            ...sel,
            normalizedName: normalized.selections[idx]?.normalizedName as any,
          }))
        : normalized.selections.map((sel) => ({
            name: sel.name,
            normalizedName: sel.normalizedName as any,
            odds: sel.odds,
          }));

    const merged: ScrapedMarket = {
      ...market,
      normalizedType: normalized.normalizedType as any,
      marketKey: normalized.marketKey,
      paramValue: normalized.paramValue,
      customLabel: normalized.customLabel,
      category: normalized.category,
      selections,
    };

    return merged;
  });
}
