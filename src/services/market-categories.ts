/**
 * Market Categories Service
 *
 * Provides functions to group markets by category following Superbet pattern.
 * This enables organized display in the UI with collapsible categories.
 */

import type { ScrapedMarket, FullMatchOffer } from "../types/full-offer.js";
import {
  MarketCategory,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ComparableMarketGroup,
  type BookmakerMarketOdds,
} from "../types/normalized-markets.js";

// ============================================================================
// Category Grouping Types
// ============================================================================

/**
 * Category structure for API response
 */
export interface CategoryGroup {
  /** Category enum value */
  name: MarketCategory;

  /** Polish label for display */
  label: string;

  /** Sort order in UI */
  order: number;

  /** Markets in this category */
  markets: ComparableMarketGroup[];
}

/**
 * Normalization statistics
 */
export interface CategoryStats {
  /** Total markets across all bookmakers */
  totalMarkets: number;

  /** Markets successfully normalized */
  normalizedMarkets: number;

  /** Coverage percentage */
  coveragePercent: number;

  /** Bookmakers that have odds for this match */
  bookmakersWithOdds: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group markets by category
 *
 * @param markets - Array of normalized markets from all bookmakers
 * @returns Markets grouped by category
 */
export function groupMarketsByCategory(markets: ScrapedMarket[]): Map<MarketCategory, ScrapedMarket[]> {
  const grouped = new Map<MarketCategory, ScrapedMarket[]>();

  // Initialize all categories
  for (const category of CATEGORY_ORDER) {
    grouped.set(category, []);
  }

  // Group markets by category
  for (const market of markets) {
    const category = market.category || MarketCategory.INNE;
    const categoryMarkets = grouped.get(category) || [];
    categoryMarkets.push(market);
    grouped.set(category, categoryMarkets);
  }

  return grouped;
}

/**
 * Build comparable market groups from multiple bookmakers
 * Markets are grouped by marketKey for easy comparison
 *
 * @param matchOffers - Full match offers from all bookmakers
 * @returns Comparable market groups
 */
export function buildComparableMarketGroups(matchOffers: FullMatchOffer[]): ComparableMarketGroup[] {
  const marketMap = new Map<string, ComparableMarketGroup>();

  for (const offer of matchOffers) {
    const bookmaker = offer.bookmaker;

    for (const market of offer.markets) {
      const marketKey = market.marketKey || `${market.normalizedType || "UNKNOWN"}:${market.paramValue || ""}`;

      if (!marketMap.has(marketKey)) {
        marketMap.set(marketKey, {
          marketKey,
          type: market.normalizedType || "OTHER",
          category: market.category || MarketCategory.INNE,
          param: market.paramValue,
          label: market.name,
          bookmakers: [],
        });
      }

      const group = marketMap.get(marketKey)!;

      // Find if this bookmaker already has odds in this group
      let bookmakerOdds = group.bookmakers.find((b) => b.bookmaker === bookmaker);

      if (!bookmakerOdds) {
        // Add new bookmaker to the group
        bookmakerOdds = {
          bookmaker: bookmaker,
          bookmakerName: bookmaker, // TODO: Use proper bookmaker name mapping
          selections: [],
        };
        group.bookmakers.push(bookmakerOdds);
      }

      // Add selections from this market
      for (const selection of market.selections) {
        const existingSelection = bookmakerOdds.selections.find(
          (s) => s.type === (selection.normalizedName || selection.name)
        );

        if (!existingSelection) {
          bookmakerOdds.selections.push({
            type: selection.normalizedName || selection.name,
            odds: selection.odds,
            hasNoTaxPromo: false, // TODO: Detect no-tax promotions
          });
        }
      }
    }
  }

  return Array.from(marketMap.values());
}

/**
 * Build comparable market groups from markets with bookmaker context
 * Alternative version that accepts an array of markets with their bookmaker
 *
 * @param marketsWithBookmakers - Array of markets with their bookmaker
 * @returns Comparable market groups
 */
export function buildComparableMarketGroupsWithBookmaker(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): ComparableMarketGroup[] {
  const marketMap = new Map<string, ComparableMarketGroup>();

  for (const { market, bookmaker } of marketsWithBookmakers) {
    const marketKey = market.marketKey || `${market.normalizedType || "UNKNOWN"}:${market.paramValue || ""}`;

    if (!marketMap.has(marketKey)) {
      marketMap.set(marketKey, {
        marketKey,
        type: market.normalizedType || "OTHER",
        category: market.category || MarketCategory.INNE,
        param: market.paramValue,
        label: market.name,
        bookmakers: [],
      });
    }

    const group = marketMap.get(marketKey)!;

    // Find if this bookmaker already has odds in this group
    let bookmakerOdds = group.bookmakers.find((b) => b.bookmaker === bookmaker);

    if (!bookmakerOdds) {
      // Add new bookmaker to the group
      bookmakerOdds = {
        bookmaker: bookmaker,
        bookmakerName: bookmaker, // TODO: Use proper bookmaker name mapping
        selections: [],
      };
      group.bookmakers.push(bookmakerOdds);
    }

    // Add selections from this market
    for (const selection of market.selections) {
      const existingSelection = bookmakerOdds.selections.find(
        (s) => s.type === (selection.normalizedName || selection.name)
      );

      if (!existingSelection) {
        bookmakerOdds.selections.push({
          type: selection.normalizedName || selection.name,
          odds: selection.odds,
          hasNoTaxPromo: false, // TODO: Detect no-tax promotions
        });
      }
    }
  }

  return Array.from(marketMap.values());
}

/**
 * Build category structure for API response
 *
 * @param matchOffers - Full match offers from all bookmakers
 * @returns Category structure with grouped markets
 */
export function buildCategoryStructure(matchOffers: FullMatchOffer[]): CategoryGroup[] {
  // Group markets by marketKey to get comparable groups
  const comparableGroups = buildComparableMarketGroups(matchOffers);

  // Group comparable groups by category
  const categoryMap = new Map<MarketCategory, ComparableMarketGroup[]>();

  // Initialize all categories
  for (const category of CATEGORY_ORDER) {
    categoryMap.set(category, []);
  }

  // Assign groups to categories
  for (const group of comparableGroups) {
    const category = group.category || MarketCategory.INNE;
    const groups = categoryMap.get(category) || [];
    groups.push(group);
    categoryMap.set(category, groups);
  }

  // Build category structure
  const categories: CategoryGroup[] = [];

  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const categoryName = CATEGORY_ORDER[i];
    const groups = categoryMap.get(categoryName) || [];

    categories.push({
      name: categoryName,
      label: CATEGORY_LABELS[categoryName],
      order: i,
      markets: groups,
    });
  }

  return categories;
}

/**
 * Build category structure for API response from markets with bookmaker context
 *
 * @param marketsWithBookmakers - Array of markets with their bookmaker
 * @returns Category structure with grouped markets
 */
export function buildCategoryStructureWithBookmaker(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): CategoryGroup[] {
  // Group markets by marketKey to get comparable groups
  const comparableGroups = buildComparableMarketGroupsWithBookmaker(marketsWithBookmakers);

  // Group comparable groups by category
  const categoryMap = new Map<MarketCategory, ComparableMarketGroup[]>();

  // Initialize all categories
  for (const category of CATEGORY_ORDER) {
    categoryMap.set(category, []);
  }

  // Assign groups to categories
  for (const group of comparableGroups) {
    const category = group.category || MarketCategory.INNE;
    const groups = categoryMap.get(category) || [];
    groups.push(group);
    categoryMap.set(category, groups);
  }

  // Build category structure
  const categories: CategoryGroup[] = [];

  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const categoryName = CATEGORY_ORDER[i];
    const groups = categoryMap.get(categoryName) || [];

    categories.push({
      name: categoryName,
      label: CATEGORY_LABELS[categoryName],
      order: i,
      markets: groups,
    });
  }

  return categories;
}

/**
 * Calculate normalization statistics
 *
 * @param matchOffers - Full match offers from all bookmakers
 * @returns Statistics about the normalization
 */
export function calculateStats(matchOffers: FullMatchOffer[]): CategoryStats {
  const bookmakersSet = new Set<string>();
  let normalizedCount = 0;
  let totalMarkets = 0;

  for (const offer of matchOffers) {
    bookmakersSet.add(offer.bookmaker);

    for (const market of offer.markets) {
      totalMarkets++;

      if (market.normalizedType && market.normalizedType !== "OTHER") {
        normalizedCount++;
      }
    }
  }

  const coveragePercent = totalMarkets > 0 ? (normalizedCount / totalMarkets) * 100 : 0;

  return {
    totalMarkets,
    normalizedMarkets: normalizedCount,
    coveragePercent: Math.round(coveragePercent * 10) / 10, // Round to 1 decimal
    bookmakersWithOdds: Array.from(bookmakersSet).sort(),
  };
}

/**
 * Calculate normalization statistics from markets with bookmaker context
 *
 * @param marketsWithBookmakers - Array of markets with their bookmaker
 * @returns Statistics about the normalization
 */
export function calculateStatsWithBookmaker(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): CategoryStats {
  const bookmakersSet = new Set<string>();
  let normalizedCount = 0;

  for (const { market, bookmaker } of marketsWithBookmakers) {
    bookmakersSet.add(bookmaker);

    if (market.normalizedType && market.normalizedType !== "OTHER") {
      normalizedCount++;
    }
  }

  const totalMarkets = marketsWithBookmakers.length;
  const coveragePercent = totalMarkets > 0 ? (normalizedCount / totalMarkets) * 100 : 0;

  return {
    totalMarkets,
    normalizedMarkets: normalizedCount,
    coveragePercent: Math.round(coveragePercent * 10) / 10, // Round to 1 decimal
    bookmakersWithOdds: Array.from(bookmakersSet).sort(),
  };
}

/**
 * Filter categories to only include those with markets
 *
 * @param categories - All categories
 * @returns Categories with at least one market
 */
export function filterEmptyCategories(categories: CategoryGroup[]): CategoryGroup[] {
  return categories.filter((cat) => cat.markets.length > 0);
}

/**
 * Sort markets within each category by market key
 *
 * @param categories - All categories
 * @returns Categories with sorted markets
 */
export function sortMarketsInCategories(categories: CategoryGroup[]): CategoryGroup[] {
  return categories.map((category) => ({
    ...category,
    markets: [...category.markets].sort((a, b) => a.marketKey.localeCompare(b.marketKey)),
  }));
}
