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
  NormalizedMarketType,
} from "../types.js";
import { MARKET_REGISTRY, getMarketByType } from "./market-registry.js";
import { matchPattern } from "./pattern-engine.js";
import { normalizeSelections } from "./selection-normalizer.js";
import { MarketCategory } from "../types.js";
import {
  normalizeScraperType,
  isValidNormalizedType,
  getCategoryForType,
} from "./scraper-type-mapping.js";

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

    // Strategy 0: Use scraper's pre-normalized type if provided
    if (market.type) {
      const normalizedType = this.resolveScraperType(market.type);
      if (normalizedType && normalizedType !== "OTHER") {
        return this.createMarketFromType(
          normalizedType,
          market,
          adapter,
          homeTeam,
          awayTeam
        );
      }
    }

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

  private resolveScraperType(scraperType: string): NormalizedMarketType | undefined {
    if (isValidNormalizedType(scraperType)) {
      return scraperType as NormalizedMarketType;
    }
    return normalizeScraperType(scraperType);
  }

  private createMarketFromType(
    normalizedType: NormalizedMarketType,
    market: ScrapedMarket,
    adapter: BookmakerAdapter | undefined,
    homeTeam: string | undefined,
    awayTeam: string | undefined
  ): NormalizedMarket {
    const definition = getMarketByType(normalizedType);
    const category = definition?.category || getCategoryForType(normalizedType);
    
    const paramValue = this.extractParamFromMarketName(market.name, normalizedType);
    const marketKey = paramValue
      ? `${normalizedType}:${paramValue}`
      : normalizedType;

    const selections = definition
      ? normalizeSelections(
          market.selections,
          definition,
          adapter?.selectionOverrides,
          homeTeam,
          awayTeam
        )
      : market.selections.map((sel) => ({
          name: sel.name,
          normalizedName: this.inferSelectionName(sel.name) as import("../types.js").NormalizedSelection,
          odds: sel.odds,
        }));

    return {
      name: market.name,
      normalizedType,
      marketKey,
      category,
      paramValue,
      selections,
    };
  }

  private extractParamFromMarketName(name: string, type: NormalizedMarketType): string | undefined {
    const lineMatch = name.match(/(\d+[.,]\d+|\d+)/);
    if (!lineMatch) return undefined;

    const hasLineTypes: NormalizedMarketType[] = [
      "TOTAL_GOALS",
      "HALF_TIME_TOTAL_GOALS",
      "ASIAN_HANDICAP",
      "EUROPEAN_HANDICAP",
      "CORNERS_TOTAL",
      "CARDS_TOTAL",
    ];

    if (hasLineTypes.includes(type)) {
      return lineMatch[1].replace(",", ".");
    }
    return undefined;
  }

  private inferSelectionName(selName: string): string {
    const lower = selName.toLowerCase().trim();
    if (/^(1|home|gospodarz)$/i.test(lower)) return "HOME";
    if (/^(x|draw|remis)$/i.test(lower)) return "DRAW";
    if (/^(2|away|go[śs]cie?)$/i.test(lower)) return "AWAY";
    if (/^(over|powyżej|powyzej|\+)/i.test(lower)) return "OVER";
    if (/^(under|poniżej|ponizej|-)/i.test(lower)) return "UNDER";
    if (/^(yes|tak|gg)$/i.test(lower)) return "YES";
    if (/^(no|nie|ng)$/i.test(lower)) return "NO";
    if (/^1x$/i.test(lower)) return "HOME_OR_DRAW";
    if (/^x2$/i.test(lower)) return "DRAW_OR_AWAY";
    if (/^12$/i.test(lower)) return "HOME_OR_AWAY";
    return "UNKNOWN";
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
