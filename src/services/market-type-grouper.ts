/**
 * Market Type Grouper Service
 *
 * Groups normalized markets by type and aggregates parameters.
 * Converts flat list of markets (with different params) into organized structure.
 */

import type { FullMatchOffer, ScrapedMarket } from "../types/full-offer.js";
import type {
  MarketWithParams,
  MarketParameter,
  MarketParameterBookmaker,
  ComparableMarketGroup,
} from "../types/normalized-markets.js";
import {
  getMarketByCode,
  getCategoryForCode,
  marketHasParameters,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from "../data/market-catalog.js";
import { MarketCategory } from "../services/normalization/types.js";

/**
 * Default parameters for each market type
 */
const DEFAULT_PARAMETERS: Record<string, string> = {
  ASIAN_HANDICAP: "0",
  EUROPEAN_HANDICAP: "-1",
  TOTAL_GOALS: "2.5",
  TOTAL_GOALS_ASIAN: "2.0",
  CORNERS_TOTAL: "8.5",
  CARDS_TOTAL: "4.5",
  HALF_TIME_TOTAL_GOALS: "1.5",
  CORRECT_SCORE: "1:1",
};

/**
 * Canonicalize a numeric parameter value so equivalent spellings collapse
 * into one line ("1.0" -> "1", "+0.5" -> "0.5", "2.50" -> "2.5").
 * Non-numeric values (score formats "1:0", "base", team sides) pass through.
 */
function canonicalizeParamValue(param: string): string {
  if (/^[+-]?\d+(\.\d+)?$/.test(param)) {
    return String(parseFloat(param));
  }
  return param;
}

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
 * Format a handicap line value for display (e.g. "-0.5", "+0.5", "-2").
 * Always includes explicit +/- sign.
 */
function formatHandicapLine(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * Detect if a market uses the handicap line convention (paramValue = home's signed line).
 */
function isLineBasedHandicap(marketType: string): boolean {
  if (!marketType.includes("HANDICAP")) return false;
  // CORRECT_SCORE_HANDICAP or similar score-format handicaps are excluded
  return true;
}

/**
 * Get display label for a parameter
 */
function getParameterLabel(param: string, marketType: string): string {
  if (param === "base") return "";

  const marketDef = getMarketByCode(marketType);

  // Handicap markets: paramValue is the home team's signed line.
  // Render as "Gospodarze (-0.5) / Goście (+0.5)" so the 2-part perspective is visible on the tab.
  if (isLineBasedHandicap(marketType) && !param.includes(":")) {
    const line = parseFloat(param);
    if (!isNaN(line)) {
      const homeLine = formatHandicapLine(line);
      const awayLine = formatHandicapLine(-line);
      return `Gospodarze (${homeLine}) / Goście (${awayLine})`;
    }
  }

  // For team-parameterized markets (HOME/AWAY), translate to Polish
  if (marketDef?.parameterType === "team") {
    if (param === "HOME") return "Gospodarze";
    if (param === "AWAY") return "Goście";
  }

  // For Asian total goals, format as integer (1 instead of 1.0)
  if (marketType === "TOTAL_GOALS_ASIAN") {
    const num = parseFloat(param);
    if (!isNaN(num) && Number.isInteger(num)) {
      return num.toString();
    }
  }

  return param;
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
    const param = canonicalizeParamValue(market.paramValue || "base");

    if (!typeGroups.has(marketType)) {
      typeGroups.set(marketType, {
        marketType,
        category: getCategoryForCode(marketType),
        label: getMarketByCode(marketType)?.labels?.pl || market.name || marketType,
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
    const handicapMarket = isLineBasedHandicap(marketType);

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
          bookmakerName: bookmaker,
          rawMarketName: market.name,
          selections: [],
        };
        paramEntry.bookmakers.push(bmEntry);
      } else if (bmEntry.rawMarketName !== market.name) {
        // A DIFFERENT raw market collided on (type, param, bookmaker) — almost
        // always a misrouted normalization (e.g. a 2nd-half combo landing in
        // the plain full-time market). Merging would poison odds/best-odds
        // with prices from another market, so the first raw market wins.
        continue;
      }

      // Create a map to track existing selections by type to prevent duplicates
      const existingSelections = new Map<string, { type: string; odds: number; hasNoTaxPromo?: boolean; label?: string }>();
      for (const sel of bmEntry.selections) {
        existingSelections.set(sel.type, sel);
      }

      // For handicap markets, compute per-team+line labels so each outcome is self-describing
      const homeLine = handicapMarket ? parseFloat(paramKey) : NaN;
      const buildSelectionLabel = (selType: string): string | undefined => {
        if (!handicapMarket || isNaN(homeLine)) return undefined;
        if (selType === "HOME") return `Gospodarze (${formatHandicapLine(homeLine)})`;
        if (selType === "AWAY") return `Goście (${formatHandicapLine(-homeLine)})`;
        // Draw in 3-way handicap: anchor the line to the home perspective so the reader can tell
        // the exact goal-difference the draw bet covers (matches Betclic's own "Remis (Chelsea -2)" wording).
        if (selType === "DRAW") return `Remis (Gospodarze ${formatHandicapLine(homeLine)})`;
        return undefined;
      };

      // Add or update selections from this market
      for (const selection of market.selections) {
        const selectionType = selection.normalizedName || selection.name;

        // Check if this selection type already exists
        if (existingSelections.has(selectionType)) {
          // Duplicate selection type within the same raw market — keep the
          // first quote. Overwriting with the higher odds silently mixed
          // prices of different outcomes that mapped to one code.
        } else {
          // Add new selection
          const label = buildSelectionLabel(selectionType);
          bmEntry.selections.push({
            type: selectionType,
            odds: selection.odds,
            hasNoTaxPromo: false, // TODO: Detect no-tax promotions
            ...(label ? { label } : {}),
          });
          existingSelections.set(selectionType, bmEntry.selections[bmEntry.selections.length - 1]);
        }
      }
    }

    const allParams = Array.from(paramGroups.keys());
    const sortedParams = sortParameters(allParams);

    // Build parameters array in sorted order
    const parameters: MarketParameter[] = sortedParams.map((param) => paramGroups.get(param)!);

    let hasParameters = marketHasParameters(marketType) && sortedParams.length >= 1;

    // Handle non-parameterized markets that need parameters[0] for frontend components
    // This includes: SINGLE_SELECTION, BINARY_BUTTONS, TRIPLE_BUTTONS, PARAMETER_SLIDER, and any market without hasParameter: true
    if (!hasParameters) {
      const marketDef = getMarketByCode(marketType);
      const needsParametersStructure =
        marketDef?.viewType === "SINGLE_SELECTION" ||
        marketDef?.viewType === "BINARY_BUTTONS" ||
        marketDef?.viewType === "TRIPLE_BUTTONS" ||
        marketDef?.viewType === "PARAMETER_SLIDER" ||
        marketDef?.viewType === "COMBINATION";

      if (needsParametersStructure) {
        const bookmakersMap = new Map<string, { rawMarketName?: string; selections: { type: string; odds: number }[] }>();

        for (const [_, paramEntry] of paramGroups.entries()) {
          for (const bmEntry of paramEntry.bookmakers) {
            if (!bookmakersMap.has(bmEntry.bookmaker)) {
              bookmakersMap.set(bmEntry.bookmaker, { rawMarketName: bmEntry.rawMarketName, selections: [] });
            }

            const bmData = bookmakersMap.get(bmEntry.bookmaker)!;

            if (marketDef?.viewType === "BINARY_BUTTONS" || marketDef?.viewType === "TRIPLE_BUTTONS" || marketDef?.viewType === "PARAMETER_SLIDER" || marketDef?.viewType === "COMBINATION") {
              for (const selection of bmEntry.selections) {
                bmData.selections.push({
                  type: selection.type,
                  odds: selection.odds,
                });
              }
            } else {
              const yesSelection = bmEntry.selections.find((s) => s.type === "YES");
              if (yesSelection) {
                bmData.selections.push({
                  type: "YES",
                  odds: yesSelection.odds,
                });
              }
            }
          }
        }

        const parameterBookmakers: MarketParameterBookmaker[] = Array.from(bookmakersMap.entries()).map(([bookmaker, data]) => ({
          bookmaker,
          bookmakerName: bookmaker,
          rawMarketName: data.rawMarketName,
          selections: data.selections,
        }));

        if (parameters.length === 0) {
          parameters.push({
            value: "",
            label: "",
            bookmakers: parameterBookmakers,
          });
        } else {
          parameters[0].value = "";
          parameters[0].label = "";
          parameters[0].bookmakers = parameterBookmakers;
        }

        // Set hasParameters to true so frontend gets data
        hasParameters = true;
      }
    }

    // Get default parameter
    const isNonParameterized = !marketHasParameters(marketType);
    const defaultParam = DEFAULT_PARAMETERS[marketType];
    const useDefault = isNonParameterized ? "" : (defaultParam && sortedParams.includes(defaultParam) ? defaultParam : sortedParams[0]);

    // Get description, displayOrder, and viewType from market registry
    const marketDef = getMarketByCode(marketType);
    const description = marketDef?.descriptions?.pl;
    const displayOrder = marketDef?.displayOrder ?? 999;
    const viewType = marketDef?.viewType;
    const subCategory = marketDef?.subCategory;

    result.push({
      marketKey: marketType,
      type: marketType,
      category: group.category,
      subCategory,
      label: group.label,
      description,
      displayOrder,
      viewType,
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
    categoryMap.set(category as MarketCategory, []);
  }

  for (const market of marketsByType) {
    const category = market.category || MarketCategory.INNE;
    categoryMap.get(category)?.push(market);
  }

  // Build category structure with sorted markets
  const categories: Array<{
    name: MarketCategory;
    label: string;
    order: number;
    markets: MarketWithParams[];
  }> = [];

  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const categoryName = CATEGORY_ORDER[i] as MarketCategory;
    const markets = categoryMap.get(categoryName) || [];

    // Sort markets by displayOrder within each category
    markets.sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999));

    categories.push({
      name: categoryName,
      label: CATEGORY_LABELS[categoryName],
      order: i,
      markets,
    });
  }

  return categories;
}
