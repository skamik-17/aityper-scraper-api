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
import { getMatchInfoById } from "../repositories/odds-repository.js";
import { getCategoryForMarket } from "../data/market-catalog.js";
import { MarketCategory, type MarketWithParams } from "../types/normalized-markets.js";
import type { ScrapedMarket } from "../types/full-offer.js";
import { buildCategoriesWithMarketTypes } from "../services/market-type-grouper.js";

const router = Router();

interface MatchInfoResponse {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  leagueSlug: string;
  startTime?: string;
}

router.get(
  "/:matchId",
  asyncHandler(async (req, res) => {
    const matchId = req.params.matchId as string;

    const row = await getMatchInfoById(matchId);
    if (!row) {
      throw new ApiError(
        404,
        ERROR_CODES.MATCH_NOT_FOUND,
        `Match not found: ${matchId}`
      );
    }

    // Same guard as getAllLatestOdds (odds-service.ts): a degenerate row
    // (home === away) is a scraper defect that reached the database, not a
    // real match - this by-id route has its own read path and was returning
    // 200 for one regardless of the list-endpoint filter.
    if (row.home_team === row.away_team) {
      console.error(
        `[NormalizedMarkets] Suppressing degenerate match ${matchId}: ` +
          `homeTeam === awayTeam ("${row.home_team}")`
      );
      throw new ApiError(
        404,
        ERROR_CODES.MATCH_NOT_FOUND,
        `Match not found: ${matchId}`
      );
    }

    const data: MatchInfoResponse = {
      matchId: row.match_id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      leagueSlug: row.league_slug,
      startTime: row.start_time ?? undefined,
    };

    const response: ApiSuccessResponse<MatchInfoResponse, {}> = {
      success: true,
      data,
      meta: {},
    };

    res.json(response);
  })
);

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
    /** Bookmakers with at least one stale quote in this match (plan 09 Task 8), sorted. */
    staleBookmakers: string[];
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

    // Same guard as the other two match routes, at the one place this
    // specific route (by team name, not matchId) can apply it before doing
    // any DB work: a real fixture never has the same club on both sides.
    // This is what the frontend's own match page calls, so it is the route
    // that turns a degenerate row into a bettable coupon entry if left
    // unguarded - confirmed live: this route returned 200 for
    // "Manchester United" vs "Manchester United" while the by-id route
    // above already 404s for the same underlying row.
    if (homeTeam.trim().toLowerCase() === awayTeam.trim().toLowerCase()) {
      console.error(
        `[NormalizedMarkets] Suppressing degenerate match request: ` +
          `"${homeTeam}" vs "${awayTeam}" (${league})`
      );
      throw new ApiError(
        404,
        ERROR_CODES.MATCH_NOT_FOUND,
        `No normalized markets found for match: ${homeTeam} vs ${awayTeam}`
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
    const staleBookmakers = [
      ...new Set(
        Object.values(fullOfferComparison.markets).flatMap((m) =>
          Object.entries(m.bookmakerOdds).filter(([, o]) => (o as { stale?: true }).stale).map(([bm]) => bm)
        )
      ),
    ].sort();

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
        staleBookmakers,
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
