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
import { ViewType } from "../services/normalization/types.js";
import { getSupabase } from "../config/database.js";
import {
  MARKET_CATALOG,
  SHORT_LABELS,
  SELECTION_LABELS,
  CATEGORY_METADATA,
} from "../data/market-catalog.js";

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
 * POST /api/odds/batch
 * Get odds for multiple leagues in a single request
 */
router.post("/batch", asyncHandler(async (req, res) => {
  const { leagues } = req.body as { leagues?: string[] };

  if (!leagues || !Array.isArray(leagues) || leagues.length === 0) {
    throw new ApiError(
      400,
      ERROR_CODES.INVALID_PARAMS,
      "Missing or empty 'leagues' array in request body"
    );
  }

  // Fetch all leagues in parallel
  const results = await Promise.all(
    leagues.map(async (league) => {
      try {
        return { league, ...(await getAllLatestOdds(league)) };
      } catch (error) {
        return { league, matches: [], lastUpdated: null, bookmakerStatus: {}, error: true };
      }
    })
  );

  // Merge matches
  const allMatches = results.flatMap(r => r.matches);

  // Merge bookmaker status (worst status wins)
  const mergedBookmakerStatus: Record<string, { status: string; lastScrape: string | null; error?: string }> = {};
  for (const result of results) {
    for (const [bookmaker, status] of Object.entries(result.bookmakerStatus || {})) {
      const statusObj = status as { status: string; lastScrape: string | null; error?: string };
      const existing = mergedBookmakerStatus[bookmaker];
      if (!existing || getStatusPriority(statusObj.status) > getStatusPriority(existing.status)) {
        mergedBookmakerStatus[bookmaker] = statusObj;
      }
    }
  }

  // Find most recent lastUpdated
  const lastUpdated = results
    .map(r => r.lastUpdated)
    .filter(Boolean)
    .sort()
    .pop() || null;

  const data: OddsResponseData = { matches: allMatches };
  const meta = {
    leagues,
    totalMatches: allMatches.length,
    lastUpdated,
    nextUpdate: getNextUpdateTime(),
    scrapeIntervalMinutes: CONFIG.SCRAPE_INTERVAL_MINUTES,
    bookmakerStatus: mergedBookmakerStatus,
  };

  const response: ApiSuccessResponse<OddsResponseData, typeof meta> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
}));

/**
 * GET /api/odds/market-types
 * Get all canonical market type definitions with metadata for frontend
 * Returns: marketTypes, selectionLabels, categories
 */
router.get("/market-types", asyncHandler(async (_req, res) => {
  // Fetch latest definitions from DB to ensure runtime is in sync with migrations
  const supabase = getSupabase();
  const { data: dbMarkets } = await supabase
    .from('market_types')
    .select('*')
    .order('display_order');

  const dbMarketMap = new Map(dbMarkets?.map((m: any) => [m.code, m]) || []);
  const fileMarketMap = new Map(MARKET_CATALOG.map(m => [m.code, m]));
  
  // Combine codes from both sources
  const allCodes = new Set([...fileMarketMap.keys(), ...dbMarketMap.keys()]);

  const marketTypes = Array.from(allCodes).map(code => {
    const dbM = dbMarketMap.get(code);
    const fileM = fileMarketMap.get(code);

    if (dbM) {
      // DB is the source of truth for structural data
      return {
        id: dbM.id,
        code: dbM.code,
        slug: fileM?.slug || dbM.code.toLowerCase().replace(/_/g, '-'),
        namePl: dbM.name_pl,
        nameEn: dbM.name_en,
        shortLabelPl: SHORT_LABELS[code] || dbM.name_pl,
        descriptionPl: dbM.description_pl,
        descriptionEn: dbM.description_en,
        viewType: dbM.view_type,
        category: dbM.category,
        hasParameter: dbM.has_parameter,
        parameterType: dbM.param_type,
        parameterFormat: fileM?.parameterFormat || null,
        validParameters: fileM?.validParameters,
        selections: dbM.selections,
        selectionOrder: dbM.selections,
        descriptionTemplates: fileM?.descriptionTemplates || {},
        viewConfig: fileM?.viewConfig || null,
        displayOrder: dbM.display_order,
      };
    } else if (fileM) {
      // Fallback to file only (should be rare if migrations run)
      return {
        id: fileM.numericId,
        code: fileM.code,
        slug: fileM.slug,
        namePl: fileM.labels.pl,
        nameEn: fileM.labels.en,
        shortLabelPl: SHORT_LABELS[fileM.code] || fileM.code,
        descriptionPl: fileM.descriptions.pl,
        descriptionEn: fileM.descriptions.en,
        viewType: fileM.viewType,
        category: fileM.category,
        hasParameter: fileM.hasParameter,
        parameterType: fileM.parameterType,
        parameterFormat: fileM.parameterFormat || null,
        validParameters: fileM.validParameters,
        selections: fileM.selections,
        selectionOrder: fileM.selectionOrder || fileM.selections,
        descriptionTemplates: fileM.descriptionTemplates || {},
        viewConfig: fileM.viewConfig || null,
        displayOrder: fileM.displayOrder,
      };
    }
    return null;
  }).filter(Boolean).sort((a: any, b: any) => a.displayOrder - b.displayOrder);

  const response = {
    success: true,
    data: {
      marketTypes,
      selectionLabels: SELECTION_LABELS,
      categories: CATEGORY_METADATA,
    },
    meta: {
      totalCount: marketTypes.length,
      viewTypes: Object.keys(ViewType).filter(k => isNaN(Number(k))),
    },
  };

  res.json(response);
}));

function getStatusPriority(status: string): number {
  switch (status) {
    case 'error': return 3;
    case 'stale': return 2;
    case 'available': return 1;
    default: return 0;
  }
}

export default router;
