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
import { ApiError, asyncHandler } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import {
  getFullOfferByMatch,
  getMarketCounts,
} from "../repositories/full-offer-repository.js";
import {
  normalizeMarketsForBookmaker,
} from "../services/market-normalizer.js";
import { MarketCategory, CATEGORY_ORDER, CATEGORY_LABELS, type MarketWithParams } from "../types/normalized-markets.js";
import type { FullMatchOffer, ScrapedMarket } from "../types/full-offer.js";
import { buildCategoriesWithMarketTypes } from "../services/market-type-grouper.js";

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
    markets: MarketWithParams[];
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
  asyncHandler(async (req, res) => {
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
          type: marketData.type, // Pass type hint for normalizer
          groupName: marketData.group, // Pass group hint for normalizer
          normalizedType: marketData.type,
          normalizedGroup: marketData.group,
          marketKey: marketKey,
          paramValue: marketData.paramValue,
          selections: bookmakerData.selections,
        };

        // Normalize markets for this bookmaker with team names
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

    // Build category structure with market type grouping
    const categories = buildCategoriesWithMarketTypes(marketsWithBookmakers);

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
        markets: cat.markets,
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
  })
);

/**
 * Helper function to calculate statistics from markets with bookmaker context
 */
function calculateStatsWithBookmaker(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): {
  totalMarkets: number;
  normalizedMarkets: number;
  coveragePercent: number;
  bookmakersWithOdds: string[];
} {
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
