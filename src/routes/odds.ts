/**
 * Odds API endpoints
 */

import { Router } from "express";
import type {
  ApiSuccessResponse,
  OddsResponseData,
  OddsResponseMeta,
  MatchOddsResponseData,
  MatchOddsResponseMeta,
} from "../types/api.js";
import { ApiError, asyncHandler } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import { CONFIG } from "../config/index.js";
import {
  getAllLatestOdds,
  getOddsForMatch,
  getNextUpdateTime,
} from "../services/odds-service.js";
import {
  getFullOfferByMatch,
  getMarketCounts,
  getCanonicalMarketCodes,
  getMarketDefinition,
} from "../repositories/full-offer-repository.js";
import type { ViewType } from "../services/normalization/types.js";
import { UNIFIED_MARKET_REGISTRY } from "../data/market-registry.js";

const router = Router();

/**
 * GET /api/odds
 * Get all latest odds for all matches
 */
router.get("/", asyncHandler(async (req, res) => {
  const league = (req.query.league as string) || "ekstraklasa";

  const { matches, lastUpdated, bookmakerStatus } = await getAllLatestOdds(league);

  const data: OddsResponseData = { matches };
  const meta: OddsResponseMeta = {
    league,
    totalMatches: matches.length,
    lastUpdated,
    nextUpdate: getNextUpdateTime(),
    scrapeIntervalMinutes: CONFIG.SCRAPE_INTERVAL_MINUTES,
    bookmakerStatus,
  };

  const response: ApiSuccessResponse<OddsResponseData, OddsResponseMeta> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
}));

/**
 * GET /api/odds/match
 * Get odds for a specific match
 */
router.get("/match", asyncHandler(async (req, res) => {
  const home = req.query.home as string;
  const away = req.query.away as string;
  const league = (req.query.league as string) || "ekstraklasa";

  if (!home || !away) {
    throw new ApiError(
      400,
      ERROR_CODES.INVALID_PARAMS,
      "Missing required parameters: home, away"
    );
  }

  const match = await getOddsForMatch(home, away, league);

  if (!match) {
    throw new ApiError(
      404,
      ERROR_CODES.MATCH_NOT_FOUND,
      `No odds found for match: ${home} vs ${away}`
    );
  }

  const data: MatchOddsResponseData = { match };
  
  let lastUpdated: string | null = null;
  for (const market of Object.values(match.markets)) {
    for (const bookmakerOdds of Object.values(market.bookmakerOdds)) {
      if (!lastUpdated || bookmakerOdds.scrapedAt > lastUpdated) {
        lastUpdated = bookmakerOdds.scrapedAt;
      }
    }
  }
  
  const meta: MatchOddsResponseMeta = {
    lastUpdated: lastUpdated || new Date().toISOString(),
  };

  const response: ApiSuccessResponse<MatchOddsResponseData, MatchOddsResponseMeta> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
}));

/**
 * GET /api/odds/match/full-offer
 * Get full offer with normalized markets for cross-bookmaker comparison
 */
router.get("/match/full-offer", asyncHandler(async (req, res) => {
  const home = req.query.home as string;
  const away = req.query.away as string;
  const league = (req.query.league as string) || "ekstraklasa";

  if (!home || !away) {
    throw new ApiError(
      400,
      ERROR_CODES.INVALID_PARAMS,
      "Missing required parameters: home, away"
    );
  }

  const fullOffer = await getFullOfferByMatch(home, away, league);

  if (!fullOffer) {
    throw new ApiError(
      404,
      ERROR_CODES.MATCH_NOT_FOUND,
      `No full offer found for match: ${home} vs ${away}`
    );
  }

  // Get market counts per bookmaker
  const marketCounts = await getMarketCounts(home, away, league);

  // Find last updated time
  let lastUpdated: string | null = null;
  for (const market of Object.values(fullOffer.markets)) {
    for (const bookmakerOdds of Object.values(market.bookmakerOdds)) {
      if (!lastUpdated || bookmakerOdds.scrapedAt > lastUpdated) {
        lastUpdated = bookmakerOdds.scrapedAt;
      }
    }
  }

  const response = {
    success: true,
    data: {
      matchId: fullOffer.matchId,
      homeTeam: fullOffer.homeTeam,
      awayTeam: fullOffer.awayTeam,
      markets: fullOffer.markets,
    },
    meta: {
      league,
      lastUpdated,
      marketCount: Object.keys(fullOffer.markets).length,
      bookmakerCounts: marketCounts,
    },
  };

  res.json(response);
}));

/**
 * GET /api/odds/market-types
 * Get all canonical market type definitions (40 types)
 */
router.get("/market-types", asyncHandler(async (_req, res) => {
  const marketTypes = UNIFIED_MARKET_REGISTRY.map(m => ({
    id: m.numericId,
    code: m.code,
    namePl: m.labels.pl,
    nameEn: m.labels.en,
    descriptionPl: m.descriptions.pl,
    descriptionEn: m.descriptions.en,
    viewType: m.viewType,
    category: m.category,
    hasParameter: m.hasParameter,
    parameterType: m.parameterType,
    selections: m.selections,
    displayOrder: m.displayOrder,
  }));

  const response = {
    success: true,
    data: {
      marketTypes,
      totalCount: marketTypes.length,
    },
    meta: {
      viewTypes: Object.keys(ViewType).filter(k => isNaN(Number(k))),
    },
  };

  res.json(response);
}));

export default router;
