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
} from "../repositories/full-offer-repository.js";
import type {
  RawBookmakerMarket,
  NormalizationContext,
  BookmakerMarketNormalizer,
} from "../services/normalization/types.js";
import {
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
} from "../services/normalization/bookmakers/index.js";
import { getMarketMetadata, getCategoryForMarket } from "../data/market-catalog.js";
import { MarketCategory, type MarketWithParams } from "../types/normalized-markets.js";
import type { FullMatchOffer, ScrapedMarket } from "../types/full-offer.js";
import { buildCategoriesWithMarketTypes } from "../services/market-type-grouper.js";

const BOOKMAKER_NORMALIZERS: Record<string, BookmakerMarketNormalizer> = {
  sts: stsNormalizer,
  fortuna: fortunaNormalizer,
  superbet: superbetNormalizer,
  betclic: betclicNormalizer,
  betcris: betcrisNormalizer,
  betfan: betfanNormalizer,
  betters: bettersNormalizer,
  etoto: etotoNormalizer,
  forbet: forbetNormalizer,
  fuksiarz: fuksiarzNormalizer,
  lebull: lebullNormalizer,
  lvbet: lvbetNormalizer,
  pzbuk: pzbukNormalizer,
  totalbet: totalbetNormalizer,
};

function getNormalizerForBookmaker(bookmaker: string): BookmakerMarketNormalizer | null {
  return BOOKMAKER_NORMALIZERS[bookmaker.toLowerCase()] ?? null;
}

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

    const matchOffers: FullMatchOffer[] = [];
    const marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }> = [];

    const normalizationContext: NormalizationContext = {
      homeTeam: fullOfferComparison.homeTeam,
      awayTeam: fullOfferComparison.awayTeam,
    };

    for (const [marketKey, marketData] of Object.entries(fullOfferComparison.markets)) {
      for (const [bookmaker, bookmakerData] of Object.entries(marketData.bookmakerOdds)) {
        const bookmakerNormalizer = getNormalizerForBookmaker(bookmaker);
        
        if (!bookmakerNormalizer) {
          console.warn(`[normalized-markets] No normalizer found for bookmaker: ${bookmaker}`);
          continue;
        }

        const rawMarket: RawBookmakerMarket = {
          bookmakerMarketId: marketData.type,
          name: marketData.name,
          groupName: marketData.category,
          selections: bookmakerData.selections.map(s => ({
            name: s.name || "",
            odds: s.odds,
            externalId: s.externalId,
          })),
        };

        const normalizedOutput = bookmakerNormalizer.normalizeMarket(rawMarket, normalizationContext);

        if (!normalizedOutput) {
          continue;
        }

        const metadata = getMarketMetadata(normalizedOutput.marketCode);
        const category = getCategoryForMarket(normalizedOutput.marketCode);

        const mergedMarket: ScrapedMarket = {
          name: marketData.name,
          groupName: marketData.category,
          type: marketData.type,
          normalizedType: normalizedOutput.marketCode,
          marketKey: normalizedOutput.marketKey,
          paramValue: normalizedOutput.paramValue,
          category: category,
          selections: normalizedOutput.selections.map((sel, idx) => ({
            name: bookmakerData.selections[idx]?.name || sel.label,
            normalizedName: sel.code,
            odds: sel.odds,
            externalId: bookmakerData.selections[idx]?.externalId,
          })),
        };

        marketsWithBookmakers.push({
          market: mergedMarket,
          bookmaker,
        });
      }
    }

    const categories = buildCategoriesWithMarketTypes(marketsWithBookmakers);
    const stats = calculateStatsWithBookmaker(marketsWithBookmakers);

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
