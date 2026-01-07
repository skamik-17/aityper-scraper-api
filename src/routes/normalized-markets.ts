/**
 * Normalized Markets API endpoints
 *
 * Provides normalized markets grouped by category following Superbet pattern.
 * GET /api/matches/:homeTeam/:awayTeam/normalized-markets
 */

import { Router } from "express";
import type {
  ApiSuccessResponse,
} from "../types/api.js";
import { ApiError } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import {
  getFullOfferByMatch,
  getMarketCounts,
} from "../repositories/full-offer-repository.js";
import {
  normalizeMarketsForBookmaker,
} from "../services/market-normalizer.js";
import {
  buildCategoryStructure,
  filterEmptyCategories,
  sortMarketsInCategories,
  type CategoryStats,
} from "../services/market-categories.js";
import { MarketCategory } from "../types/normalized-markets.js";
import type { FullMatchOffer, ScrapedMarket } from "../types/full-offer.js";

const router = Router();

/**
 * Response interface for normalized markets endpoint
 */
interface NormalizedMarketsResponse {
  match: {
    homeTeam: string;
    awayTeam: string;
    league: string;
  };
  categories: {
    name: MarketCategory;
    label: string;
    order: number;
    markets: Array<{
      marketKey: string;
      type: string;
      category: MarketCategory;
      param?: string;
      label: string;
      bookmakers: Array<{
        bookmaker: string;
        bookmakerName: string;
        selections: Array<{
          type: string;
          odds: number;
          hasNoTaxPromo?: boolean;
        }>;
      }>;
    }>;
  }[];
  stats: {
    totalMarkets: number;
    normalizedMarkets: number;
    coveragePercent: number;
    bookmakersWithOdds: string[];
  };
}

/**
 * GET /api/matches/:homeTeam/:awayTeam/normalized-markets
 * Get normalized markets grouped by category for a specific match
 *
 * @param homeTeam - Home team name (e.g., "Arsenal")
 * @param awayTeam - Away team name (e.g., "Liverpool")
 * @param league - League slug (optional, default: "ekstraklasa")
 *
 * @returns Normalized markets grouped by category with statistics
 */
router.get(
  "/:homeTeam/:awayTeam/normalized-markets",
  async (req, res) => {
    const homeTeam = req.params.homeTeam as string;
    const awayTeam = req.params.awayTeam as string;
    const league = (req.query.league as string) || "ekstraklasa";

    if (!homeTeam || !awayTeam) {
      throw new ApiError(
        400,
        ERROR_CODES.INVALID_PARAMS,
        "Missing required parameters: homeTeam, awayTeam"
      );
    }

    // Get full offer from database
    const fullOfferComparison = await getFullOfferByMatch(
      homeTeam,
      awayTeam,
      league
    );

    if (!fullOfferComparison) {
      throw new ApiError(
        404,
        ERROR_CODES.MATCH_NOT_FOUND,
        `No normalized markets found for match: ${homeTeam} vs ${awayTeam}`
      );
    }

    // Convert FullOfferComparison to FullMatchOffer[] format
    // This is needed because buildCategoryStructure expects FullMatchOffer[]
    const matchOffers: FullMatchOffer[] = [];
    const marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }> = [];

    for (const [marketKey, marketData] of Object.entries(fullOfferComparison.markets)) {
      for (const [bookmaker, bookmakerData] of Object.entries(marketData.bookmakerOdds)) {
        const scrapedMarket: ScrapedMarket = {
          name: marketData.name,
          normalizedType: marketData.type,
          normalizedGroup: marketData.group,
          marketKey: marketKey,
          paramValue: marketData.paramValue,
          selections: bookmakerData.selections,
        };

        // Normalize markets for this bookmaker
        const normalizedMarkets = normalizeMarketsForBookmaker(
          [scrapedMarket],
          bookmaker,
          homeTeam,
          awayTeam
        );

        // Add to markets with bookmakers array
        for (const normalizedMarket of normalizedMarkets) {
          marketsWithBookmakers.push({
            market: normalizedMarket,
            bookmaker,
          });
        }
      }
    }

    // Build category structure
    let categories = buildCategoryStructureWithBookmaker(marketsWithBookmakers);

    // Filter empty categories and sort markets
    categories = filterEmptyCategories(categories);
    categories = sortMarketsInCategories(categories);

    // Calculate statistics
    const stats = calculateStatsWithBookmaker(marketsWithBookmakers);

    // Build response
    const response: NormalizedMarketsResponse = {
      match: {
        homeTeam: fullOfferComparison.homeTeam,
        awayTeam: fullOfferComparison.awayTeam,
        league,
      },
      categories: categories.map((cat) => ({
        name: cat.name,
        label: cat.label,
        order: cat.order,
        markets: cat.markets.map((market) => ({
          marketKey: market.marketKey,
          type: market.type,
          category: market.category,
          param: market.param,
          label: market.label,
          bookmakers: market.bookmakers.map((bm) => ({
            bookmaker: bm.bookmaker,
            bookmakerName: bm.bookmakerName,
            selections: bm.selections.map((sel) => ({
              type: sel.type,
              odds: sel.odds,
              hasNoTaxPromo: sel.hasNoTaxPromo,
            })),
          })),
        })),
      })),
      stats: {
        totalMarkets: stats.totalMarkets,
        normalizedMarkets: stats.normalizedMarkets,
        coveragePercent: stats.coveragePercent,
        bookmakersWithOdds: stats.bookmakersWithOdds,
      },
    };

    const apiResponse: ApiSuccessResponse<NormalizedMarketsResponse, null> = {
      success: true,
      data: response,
      meta: null,
    };

    res.json(apiResponse);
  }
);

/**
 * Helper function to build category structure from markets with bookmaker context
 * This is a temporary implementation until we refactor the service layer
 */
function buildCategoryStructureWithBookmaker(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): Array<{
  name: MarketCategory;
  label: string;
  order: number;
  markets: Array<{
    marketKey: string;
    type: string;
    category: MarketCategory;
    param?: string;
    label: string;
    bookmakers: Array<{
      bookmaker: string;
      bookmakerName: string;
      selections: Array<{
        type: string;
        odds: number;
        hasNoTaxPromo?: boolean;
      }>;
    }>;
  }>;
}> {
  // Define the market group type
  interface MarketGroupData {
    marketKey: string;
    type: string;
    category: MarketCategory;
    param?: string;
    label: string;
    bookmakers: Map<string, {
      bookmaker: string;
      bookmakerName: string;
      selections: Array<{
        type: string;
        odds: number;
        hasNoTaxPromo?: boolean;
      }>;
    }>;
  }

  const marketMap = new Map<string, MarketGroupData>();

  for (const { market, bookmaker } of marketsWithBookmakers) {
    const marketKey = market.marketKey || `${market.normalizedType || "UNKNOWN"}:${market.paramValue || ""}`;

    if (!marketMap.has(marketKey)) {
      marketMap.set(marketKey, {
        marketKey,
        type: market.normalizedType || "OTHER",
        category: (market.category as MarketCategory) || MarketCategory.INNE,
        param: market.paramValue,
        label: market.name,
        bookmakers: new Map(),
      });
    }

    const group = marketMap.get(marketKey)!;

    if (!group.bookmakers.has(bookmaker)) {
      group.bookmakers.set(bookmaker, {
        bookmaker,
        bookmakerName: bookmaker, // TODO: Use proper bookmaker name mapping
        selections: [],
      });
    }

    const bookmakerOdds = group.bookmakers.get(bookmaker)!;

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

  // Group by category
  const categoryMap = new Map<MarketCategory, MarketGroupData[]>();
  const { CATEGORY_ORDER, CATEGORY_LABELS } = require("../types/normalized-markets.js");

  for (const category of CATEGORY_ORDER) {
    categoryMap.set(category, []);
  }

  for (const market of Array.from(marketMap.values())) {
    const category = market.category || MarketCategory.INNE;
    const markets = categoryMap.get(category) || [];
    markets.push(market);
    categoryMap.set(category, markets);
  }

  // Build category structure
  const categories: Array<{
    name: MarketCategory;
    label: string;
    order: number;
    markets: Array<{
      marketKey: string;
      type: string;
      category: MarketCategory;
      param?: string;
      label: string;
      bookmakers: Array<{
        bookmaker: string;
        bookmakerName: string;
        selections: Array<{
          type: string;
          odds: number;
          hasNoTaxPromo?: boolean;
        }>;
      }>;
    }>;
  }> = [];

  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const categoryName = CATEGORY_ORDER[i];
    const markets = categoryMap.get(categoryName) || [];

    categories.push({
      name: categoryName,
      label: CATEGORY_LABELS[categoryName],
      order: i,
      markets: markets.map((m) => ({
        marketKey: m.marketKey,
        type: m.type,
        category: m.category,
        param: m.param,
        label: m.label,
        bookmakers: Array.from(m.bookmakers.values()),
      })),
    });
  }

  return categories;
}

/**
 * Helper function to calculate statistics from markets with bookmaker context
 */
function calculateStatsWithBookmaker(
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
    coveragePercent: Math.round(coveragePercent * 10) / 10,
    bookmakersWithOdds: Array.from(bookmakersSet).sort(),
  };
}

export default router;
