/**
 * Normalized Markets API endpoints
 *
 * Provides normalized markets grouped by category following Superbet pattern.
 * GET /api/matches/:homeTeam/:awayTeam/normalized-markets
 */

import { Router } from "express";
import type { ApiSuccessResponse } from "../types/api.js";
import { ApiError, asyncHandler } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import { getFullOfferByMatch } from "../repositories/full-offer-repository.js";
import { getCategoryForMarket } from "../data/market-catalog.js";
import { MarketCategory, type MarketWithParams } from "../types/normalized-markets.js";
import type { ScrapedMarket } from "../types/full-offer.js";
import { buildCategoriesWithMarketTypes } from "../services/market-type-grouper.js";

const router = Router();

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

router.get(
  "/:homeTeam/:awayTeam/normalized-markets",
  asyncHandler(async (req, res) => {
    const homeTeam = req.params.homeTeam as string;
    const awayTeam = req.params.awayTeam as string;
    const league = (req.query.league as string) || "ekstraklasa";

    // Parse category query param (can be string or array)
    const categoryParam = req.query.category;
    const requestedCategories: string[] | null = categoryParam
      ? Array.isArray(categoryParam)
        ? (categoryParam as string[])
        : [categoryParam as string]
      : null;

    if (!homeTeam || !awayTeam) {
      throw new ApiError(
        400,
        ERROR_CODES.INVALID_PARAMS,
        "Missing required parameters: homeTeam, awayTeam"
      );
    }

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

    const marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }> = [];

    for (const [marketKey, marketData] of Object.entries(fullOfferComparison.markets)) {
      for (const [bookmaker, bookmakerData] of Object.entries(marketData.bookmakerOdds)) {
        const category = getCategoryForMarket(marketData.type);

        const rawName = bookmakerData.rawMarketName || marketData.name;
        const baseRawName = rawName?.replace(/\s+\d+\.5$/, "");
        const displayName = baseRawName || rawName || marketData.type;

        const mergedMarket: ScrapedMarket = {
          name: displayName,
          groupName: marketData.category,
          type: marketData.type,
          normalizedType: marketData.type,
          marketKey: marketKey,
          paramValue: marketData.paramValue,
          category: category,
          selections: bookmakerData.selections.map(s => ({
            name: s.name || "",
            normalizedName: s.normalizedName,
            odds: s.odds,
            externalId: s.externalId,
          })),
        };

        marketsWithBookmakers.push({
          market: mergedMarket,
          bookmaker,
        });
      }
    }

    const categories = buildCategoriesWithMarketTypes(marketsWithBookmakers);

    // Filter categories if requested
    const filteredCategories = requestedCategories
      ? categories.filter(cat => requestedCategories.includes(cat.name))
      : categories;

    // Recalculate stats based on filtered categories
    const filteredMarketsWithBookmakers = requestedCategories
      ? marketsWithBookmakers.filter(({ market }) =>
          requestedCategories.includes(market.category as string)
        )
      : marketsWithBookmakers;

    const stats = calculateStatsWithBookmaker(filteredMarketsWithBookmakers);

    const response: NormalizedMarketsResponse = {
      match: {
        homeTeam: fullOfferComparison.homeTeam,
        awayTeam: fullOfferComparison.awayTeam,
        league,
      },
      categories: filteredCategories.map((cat) => ({
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
