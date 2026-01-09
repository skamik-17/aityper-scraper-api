/**
 * Market Type Grouper Service
 *
 * Groups normalized markets by type and aggregates parameters.
 * Converts flat list of markets (with different params) into organized structure.
 */

import type { FullMatchOffer, ScrapedMarket } from "../types/full-offer.js";
import { MarketCategory, MARKET_TYPE_TO_CATEGORY, CATEGORY_ORDER, CATEGORY_LABELS } from "../types/normalized-markets.js";
import type {
  MarketWithParams,
  MarketParameter,
  MarketParameterBookmaker,
  ComparableMarketGroup,
} from "../types/normalized-markets.js";

/**
 * Default parameters for each market type
 */
const DEFAULT_PARAMETERS: Record<string, string> = {
  ASIAN_HANDICAP: "0",
  EUROPEAN_HANDICAP: "-1",
  TOTAL_GOALS: "2.5",
  CORNERS_TOTAL: "8.5",
  CARDS_TOTAL: "4.5",
  HALF_TIME_TOTAL_GOALS: "1.5",
  CORRECT_SCORE: "1:1",
};

/**
 * Market types that typically have parameters
 */
const PARAMETRIZED_MARKET_TYPES: Set<string> = new Set([
  "ASIAN_HANDICAP",
  "EUROPEAN_HANDICAP",
  "TOTAL_GOALS",
  "CORNERS_TOTAL",
  "CORNERS_TEAM",
  "CARDS_TOTAL",
  "CARDS_TEAM",
  "HALF_TIME_TOTAL_GOALS",
  "RESULT_AND_TOTAL",
]);

/**
 * Sort parameters intelligently
 */
function sortParameters(params: string[]): string[] {
  // Separate numeric and non-numeric params
  const numericParams: { value: number; original: string }[] = [];
  const specialParams: string[] = [];

  for (const param of params) {
    const num = parseFloat(param);
    if (!isNaN(num)) {
      numericParams.push({ value: num, original: param });
    } else {
      specialParams.push(param);
    }
  }

  // Sort numeric parameters
  numericParams.sort((a, b) => a.value - b.value);

  return [
    ...numericParams.map((p) => p.original),
    ...specialParams.sort(),
  ];
}

/**
 * Get display label for a parameter
 */
function getParameterLabel(param: string, marketType: string): string {
  if (param === "base") return "";

  // For handicap, show the line with sign
  if (marketType.includes("HANDICAP")) {
    const num = parseFloat(param);
    if (!isNaN(num)) {
      return num > 0 ? `+${param}` : param;
    }
  }

  return param;
}

/**
 * Check if a market type typically has parameters
 */
function isParametrizedMarketType(marketType: string): boolean {
  return PARAMETRIZED_MARKET_TYPES.has(marketType);
}

/**
 * Group markets by type and aggregate parameters
 *
 * Input: Array of markets with bookmakers (e.g., multiple ASIAN_HANDICAP markets with different lines)
 * Output: Array of MarketWithParams (one per type, with all parameters)
 */
export function groupMarketsByTypeWithParameters(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): MarketWithParams[] {
  // Group by market type (without parameter)
  const typeGroups = new Map<string, {
    marketType: string;
    category: MarketCategory;
    label: string;
    markets: Array<{ market: ScrapedMarket; bookmaker: string; param: string }>;
  }>();

  for (const { market, bookmaker } of marketsWithBookmakers) {
    const marketType = market.normalizedType || "OTHER";
    const param = market.paramValue || "base";

    if (!typeGroups.has(marketType)) {
      typeGroups.set(marketType, {
        marketType,
        category: MARKET_TYPE_TO_CATEGORY[marketType] || MarketCategory.INNE,
        label: market.name || marketType,
        markets: [],
      });
    }

    typeGroups.get(marketType)!.markets.push({ market, bookmaker, param });
  }

  // Build MarketWithParams for each type
  const result: MarketWithParams[] = [];

  for (const [marketType, group] of typeGroups.entries()) {
    // Group by parameter
    const paramGroups = new Map<string, MarketParameter>();

    for (const { market, bookmaker, param } of group.markets) {
      const paramKey = param;

      if (!paramGroups.has(paramKey)) {
        paramGroups.set(paramKey, {
          value: paramKey,
          label: getParameterLabel(paramKey, marketType),
          bookmakers: [],
        });
      }

      // Add bookmaker selections for this parameter
      const paramEntry = paramGroups.get(paramKey)!;

      // Find or create bookmaker entry
      let bmEntry = paramEntry.bookmakers.find((bm) => bm.bookmaker === bookmaker);
      if (!bmEntry) {
        bmEntry = {
          bookmaker,
          bookmakerName: bookmaker, // TODO: Use proper bookmaker name mapping
          selections: [],
        };
        paramEntry.bookmakers.push(bmEntry);
      }

      // Create a map to track existing selections by type to prevent duplicates
      const existingSelections = new Map<string, { type: string; odds: number; hasNoTaxPromo?: boolean }>();
      for (const sel of bmEntry.selections) {
        existingSelections.set(sel.type, sel);
      }

      // Add or update selections from this market
      for (const selection of market.selections) {
        const selectionType = selection.normalizedName || selection.name;

        // Check if this selection type already exists
        if (existingSelections.has(selectionType)) {
          // Update existing selection if odds are different (or keep first one)
          const existing = existingSelections.get(selectionType)!;
          // Use the higher odds to be safe, or could just skip duplicates
          if (selection.odds > existing.odds) {
            existing.odds = selection.odds;
          }
        } else {
          // Add new selection
          bmEntry.selections.push({
            type: selectionType,
            odds: selection.odds,
            hasNoTaxPromo: false, // TODO: Detect no-tax promotions
          });
          existingSelections.set(selectionType, bmEntry.selections[bmEntry.selections.length - 1]);
        }
      }
    }

    // Get sorted parameters
    const allParams = Array.from(paramGroups.keys());
    const sortedParams = sortParameters(allParams);

    // Build parameters array in sorted order
    const parameters: MarketParameter[] = sortedParams.map((param) => paramGroups.get(param)!);

    // Determine if this market type has parameters
    const hasParameters = isParametrizedMarketType(marketType) && sortedParams.length > 1;

    // Get default parameter
    const defaultParam = DEFAULT_PARAMETERS[marketType];
    const useDefault = defaultParam && sortedParams.includes(defaultParam) ? defaultParam : sortedParams[0];

    result.push({
      marketKey: marketType,
      type: marketType,
      category: group.category,
      label: group.label,
      parameters,
      defaultParameter: useDefault,
      hasParameters,
    });
  }

  return result;
}

/**
 * Convert marketsWithBookmakers to category structure with type grouping
 */
export function buildCategoriesWithMarketTypes(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): Array<{
  name: MarketCategory;
  label: string;
  order: number;
  markets: MarketWithParams[];
}> {
  // Group by market type with parameters
  const marketsByType = groupMarketsByTypeWithParameters(marketsWithBookmakers);

  // Group by category
  const categoryMap = new Map<MarketCategory, MarketWithParams[]>();

  for (const category of CATEGORY_ORDER) {
    categoryMap.set(category, []);
  }

  for (const market of marketsByType) {
    const category = market.category || MarketCategory.INNE;
    categoryMap.get(category)?.push(market);
  }

  // Build category structure
  const categories: Array<{
    name: MarketCategory;
    label: string;
    order: number;
    markets: MarketWithParams[];
  }> = [];

  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const categoryName = CATEGORY_ORDER[i];
    const markets = categoryMap.get(categoryName) || [];

    categories.push({
      name: categoryName,
      label: CATEGORY_LABELS[categoryName],
      order: i,
      markets,
    });
  }

  return categories;
}
