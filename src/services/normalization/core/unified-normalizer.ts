/**
 * Unified Market Normalizer
 *
 * Single normalizer class that uses global market registry and bookmaker adapters.
 * No inheritance, no duplication - clean and simple architecture.
 *
 * Strategy:
 * 1. Try ID mapping (for STS "Rynek XX" format)
 * 2. Try pattern matching (global registry)
 * 3. Fallback to OTHER
 */

import type {
  BookmakerAdapter,
  NormalizedMarket,
  ScrapedMarket,
  NormalizedSelectionResult,
} from "../types.js";
import { MARKET_REGISTRY } from "./market-registry.js";
import { matchPattern } from "./pattern-engine.js";
import { normalizeSelections } from "./selection-normalizer.js";
import { MarketCategory } from "../types.js";

// Re-export NormalizedSelectionResult for convenience
type NormalizedSelection = import("../types.js").NormalizedSelection;

/**
 * Unified Market Normalizer
 *
 * This is the main entry point for market normalization.
 * All bookmakers use the same normalizer with different adapters.
 */
export class UnifiedNormalizer {
  private adapters: Map<string, BookmakerAdapter>;

  constructor(adapters: BookmakerAdapter[]) {
    this.adapters = new Map(
      adapters.map((a) => [a.bookmaker, a])
    );
  }

  /**
   * Normalize a single market
   *
   * @param market - The scraped market to normalize
   * @param bookmaker - Bookmaker identifier (e.g., "sts", "fortuna")
   * @param homeTeam - Home team name for selection matching
   * @param awayTeam - Away team name for selection matching
   * @returns Normalized market
   */
  normalize(
    market: ScrapedMarket,
    bookmaker: string,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedMarket {
    const adapter = this.adapters.get(bookmaker);

    // Strategy 1: Try ID mapping (for STS "Rynek XX" format)
    if (adapter?.idMappings) {
      const idResult = this.tryIdMapping(market.name, adapter);
      if (idResult) {
        return this.completeNormalization(
          idResult.definitionId,
          market,
          adapter,
          homeTeam,
          awayTeam
        );
      }
    }

    // Strategy 2: Try pattern matching (global registry)
    const patternMatch = matchPattern(market.name, MARKET_REGISTRY);
    if (patternMatch) {
      return this.completeNormalization(
        patternMatch.definition.id,
        market,
        adapter,
        homeTeam,
        awayTeam,
        patternMatch.param
      );
    }

    // Strategy 3: Fallback to OTHER
    return this.createFallbackMarket(market);
  }

  /**
   * Try to match using ID mapping
   *
   * Used for STS-style "Rynek XX" format where XX is a numeric ID
   */
  private tryIdMapping(
    marketName: string,
    adapter: BookmakerAdapter
  ): { definitionId: string } | null {
    // Match "Rynek XX" format
    const rynekMatch = marketName.match(/^Rynek\s+(\d+)$/iu);
    if (rynekMatch) {
      const marketId = Number(rynekMatch[1]);
      const definitionId = adapter.idMappings?.get(marketId);
      if (definitionId) {
        return { definitionId };
      }
    }

    return null;
  }

  /**
   * Complete normalization with selections
   *
   * @param definitionId - Market definition ID
   * @param market - Original scraped market
   * @param adapter - Bookmaker adapter (optional)
   * @param homeTeam - Home team name
   * @param awayTeam - Away team name
   * @param param - Extracted parameter value (optional)
   */
  private completeNormalization(
    definitionId: string,
    market: ScrapedMarket,
    adapter: BookmakerAdapter | undefined,
    homeTeam: string | undefined,
    awayTeam: string | undefined,
    param?: string
  ): NormalizedMarket {
    // Find market definition
    const definition = MARKET_REGISTRY.find((m) => m.id === definitionId);
    if (!definition) {
      return this.createFallbackMarket(market);
    }

    // Build market key
    const marketKey = param
      ? `${definition.type}:${param}`
      : definition.type;

    // Normalize selections
    const selections = normalizeSelections(
      market.selections,
      definition,
      adapter?.selectionOverrides,
      homeTeam,
      awayTeam
    );

    return {
      name: market.name,
      normalizedType: definition.type,
      marketKey,
      category: definition.category,
      paramValue: param,
      selections,
    };
  }

  /**
   * Create fallback market for unknown types
   *
   * Used when no pattern matches and no ID mapping exists
   */
  private createFallbackMarket(market: ScrapedMarket): NormalizedMarket {
    // Truncate market name for key (max 30 chars)
    const truncatedName = market.name.slice(0, 30).replace(/\s+/g, "-");

    return {
      name: market.name,
      normalizedType: "OTHER",
      marketKey: `OTHER:${truncatedName}`,
      category: MarketCategory.INNE,
      selections: market.selections.map((sel) => ({
        name: sel.name,
        normalizedName: "UNKNOWN",
        odds: sel.odds,
      })),
    };
  }

  /**
   * Normalize multiple markets at once
   *
   * @param markets - Array of scraped markets
   * @param bookmaker - Bookmaker identifier
   * @param homeTeam - Home team name
   * @param awayTeam - Away team name
   * @returns Array of normalized markets
   */
  normalizeBatch(
    markets: ScrapedMarket[],
    bookmaker: string,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedMarket[] {
    return markets.map((m) =>
      this.normalize(m, bookmaker, homeTeam, awayTeam)
    );
  }

  /**
   * Get adapter for a specific bookmaker
   *
   * @param bookmaker - Bookmaker identifier
   * @returns Bookmaker adapter or undefined
   */
  getAdapter(bookmaker: string): BookmakerAdapter | undefined {
    return this.adapters.get(bookmaker);
  }

  /**
   * Check if normalizer has adapter for bookmaker
   *
   * @param bookmaker - Bookmaker identifier
   * @returns true if adapter exists
   */
  hasAdapter(bookmaker: string): boolean {
    return this.adapters.has(bookmaker);
  }

  /**
   * Get all supported bookmakers
   *
   * @returns Array of bookmaker codes
   */
  getSupportedBookmakers(): string[] {
    return Array.from(this.adapters.keys());
  }
}
