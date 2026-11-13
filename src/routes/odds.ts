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
import type { BookmakerStatus } from "../types/database.js";
import {
  getAllLatestOdds,
  getOddsForMatch,
  getNextUpdateTime,
} from "../services/odds-service.js";
import { worstBookmakerStatus, type BookmakerHealthMeta } from "../services/bookmaker-status.js";
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
 * Every current frontend consumer of the match-list endpoints below (GET
 * /api/odds and POST /api/odds/batch) only reads the MATCH_WINNER market -
 * for a compact 1X2 indicator while browsing/searching matches across
 * leagues. Restricting to this by default cuts a single Premier League
 * match's payload from several MB to a few KB. Pass ?full=true (GET) or
 * {"full": true} (POST body) to opt back into the complete per-bookmaker
 * breakdown for every market if a future consumer needs it.
 */
const MATCH_LIST_MARKET_KEYS = ["MATCH_WINNER"];

/** One league's share of a POST /api/odds/batch answer. */
interface LeagueOdds {
  league: string;
  matches: OddsResponseData["matches"];
  lastUpdated: string | null;
  bookmakerStatus: Partial<Record<string, BookmakerStatus>>;
  bookmakerHealth: Partial<Record<string, BookmakerHealthMeta>>;
}

/**
 * GET /api/odds
 * Get all latest odds for all matches
 */
router.get("/", asyncHandler(async (req, res) => {
  const league = (req.query.league as string) || "ekstraklasa";
  const full = req.query.full === "true";

  const { matches, lastUpdated, bookmakerStatus, bookmakerHealth } = await getAllLatestOdds(
    league,
    full ? {} : { onlyMarketKeys: MATCH_LIST_MARKET_KEYS }
  );

  const data: OddsResponseData = { matches };
  const meta: OddsResponseMeta = {
    league,
    totalMatches: matches.length,
    lastUpdated,
    nextUpdate: getNextUpdateTime(),
    scrapeIntervalMinutes: CONFIG.SCRAPE_INTERVAL_MINUTES,
    bookmakerStatus,
    bookmakerHealth,
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
  const { leagues, full } = req.body as { leagues?: string[]; full?: boolean };

  if (!leagues || !Array.isArray(leagues) || leagues.length === 0) {
    throw new ApiError(
      400,
      ERROR_CODES.INVALID_PARAMS,
      "Missing or empty 'leagues' array in request body"
    );
  }

  const oddsOptions = full ? {} : { onlyMarketKeys: MATCH_LIST_MARKET_KEYS };

  // Fetch all leagues in parallel. A league whose fetch threw contributes no
  // matches and no status.
  const results = await Promise.all(
    leagues.map(async (league): Promise<LeagueOdds> => {
      try {
        return { league, ...(await getAllLatestOdds(league, oddsOptions)) };
      } catch (error) {
        return { league, matches: [], lastUpdated: null, bookmakerStatus: {}, bookmakerHealth: {} };
      }
    })
  );

  // Merge matches
  const allMatches = results.flatMap(r => r.matches);

  // Merge bookmaker status over the scraped leagues (worst status wins, values
  // stay plain strings). A league nothing scrapes would otherwise turn every
  // bookmaker stale; with no scraped league requested, all of them count.
  const enabled = leagues.filter((l) => (CONFIG.ENABLED_LEAGUES as readonly string[]).includes(l));
  const mergeLeagues = new Set(enabled.length > 0 ? enabled : leagues);
  const mergedBookmakerStatus: Record<string, BookmakerStatus> = {};
  const mergedBookmakerHealth: Record<string, BookmakerHealthMeta> = {};
  for (const result of results) {
    if (!mergeLeagues.has(result.league)) continue;
    for (const [bookmaker, status] of Object.entries(result.bookmakerStatus)) {
      if (status === undefined) continue;
      const existing = mergedBookmakerStatus[bookmaker];
      const worst = worstBookmakerStatus(existing, status);
      if (existing === undefined || worst !== existing) {
        // The health entry follows the league whose status won (a tie keeps the first).
        mergedBookmakerStatus[bookmaker] = worst;
        const health = result.bookmakerHealth[bookmaker];
        if (health) mergedBookmakerHealth[bookmaker] = health;
        else delete mergedBookmakerHealth[bookmaker];
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
    bookmakerHealth: mergedBookmakerHealth,
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
  // Reference data, not match data: it only changes when the catalogue is
  // re-synced, so let clients and any proxy hold it rather than re-download
  // half a megabyte on every cold visit.
  res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");

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

export default router;
