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
import { ApiError } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import { CONFIG } from "../config/index.js";
import {
  getAllLatestOdds,
  getOddsForMatch,
  getNextUpdateTime,
} from "../services/odds-service.js";

const router = Router();

/**
 * GET /api/odds
 * Get all latest odds for all matches
 */
router.get("/", async (req, res) => {
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

  const response: ApiSuccessResponse<OddsResponseData> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
});

/**
 * GET /api/odds/match
 * Get odds for a specific match
 */
router.get("/match", async (req, res) => {
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
  const meta: MatchOddsResponseMeta = {
    lastUpdated: match.odds[0]?.scrapedAt || new Date().toISOString(),
  };

  const response: ApiSuccessResponse<MatchOddsResponseData> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
});

export default router;
