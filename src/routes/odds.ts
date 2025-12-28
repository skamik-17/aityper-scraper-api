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
  ExtendedMarketsResponseData,
  ExtendedMarketsResponseMeta,
} from "../types/api.js";
import { ApiError } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import { CONFIG, PolishBookmaker } from "../config/index.js";
import {
  getAllLatestOdds,
  getOddsForMatch,
  getNextUpdateTime,
} from "../services/odds-service.js";
import {
  getExtendedOddsForMatch,
  findBestDoubleChanceOdds,
  findBestOverUnderOdds,
  findBestBTTSOdds,
} from "../repositories/extended-odds-repository.js";

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

  const response: ApiSuccessResponse<OddsResponseData, OddsResponseMeta> = {
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

  const response: ApiSuccessResponse<MatchOddsResponseData, MatchOddsResponseMeta> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
});

/**
 * GET /api/odds/match/extended
 * Get extended market odds (Double Chance, Over/Under, BTTS) for a specific match
 */
router.get("/match/extended", async (req, res) => {
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

  const { doubleChance, overUnder, btts } = await getExtendedOddsForMatch(home, away, league);

  // Transform database rows to API format
  const doubleChanceData = doubleChance.map((dc) => ({
    bookmaker: dc.bookmaker as PolishBookmaker,
    homeOrDraw: dc.home_or_draw,
    drawOrAway: dc.draw_or_away,
    homeOrAway: dc.home_or_away,
    eventUrl: dc.event_url,
    scrapedAt: dc.scraped_at,
  }));

  const overUnderData = overUnder.map((ou) => ({
    bookmaker: ou.bookmaker as PolishBookmaker,
    line: ou.line,
    overOdds: ou.over_odds,
    underOdds: ou.under_odds,
    eventUrl: ou.event_url,
    scrapedAt: ou.scraped_at,
  }));

  const bttsData = btts.map((b) => ({
    bookmaker: b.bookmaker as PolishBookmaker,
    yesOdds: b.yes_odds,
    noOdds: b.no_odds,
    eventUrl: b.event_url,
    scrapedAt: b.scraped_at,
  }));

  // Calculate best odds
  const bestDC = findBestDoubleChanceOdds(doubleChance);
  const bestOU = findBestOverUnderOdds(overUnder);
  const bestBTTS = findBestBTTSOdds(btts);

  // Transform best odds to API format
  const bestOdds = {
    doubleChance: {
      homeOrDraw: bestDC.homeOrDraw.odds > 0 ? bestDC.homeOrDraw : null,
      drawOrAway: bestDC.drawOrAway.odds > 0 ? bestDC.drawOrAway : null,
      homeOrAway: bestDC.homeOrAway.odds > 0 ? bestDC.homeOrAway : null,
    },
    overUnder: Object.fromEntries(
      Object.entries(bestOU).map(([line, odds]) => [
        line,
        {
          over: odds.over.odds > 0 ? odds.over : null,
          under: odds.under.odds > 0 ? odds.under : null,
        },
      ])
    ),
    btts: {
      yes: bestBTTS.yes.odds > 0 ? bestBTTS.yes : null,
      no: bestBTTS.no.odds > 0 ? bestBTTS.no : null,
    },
  };

  // Get team names from the first result (they should all match)
  const homeTeam = doubleChance[0]?.home_team || overUnder[0]?.home_team || btts[0]?.home_team || home;
  const awayTeam = doubleChance[0]?.away_team || overUnder[0]?.away_team || btts[0]?.away_team || away;

  // Find last updated time
  const allTimestamps = [
    ...doubleChance.map((d) => d.scraped_at),
    ...overUnder.map((o) => o.scraped_at),
    ...btts.map((b) => b.scraped_at),
  ].filter(Boolean);
  const lastUpdated = allTimestamps.length > 0
    ? allTimestamps.sort().reverse()[0]
    : null;

  // Count unique bookmakers
  const bookmakers = new Set([
    ...doubleChance.map((d) => d.bookmaker),
    ...overUnder.map((o) => o.bookmaker),
    ...btts.map((b) => b.bookmaker),
  ]);

  const data: ExtendedMarketsResponseData = {
    homeTeam,
    awayTeam,
    doubleChance: doubleChanceData,
    overUnder: overUnderData,
    btts: bttsData,
    bestOdds,
  };

  const meta: ExtendedMarketsResponseMeta = {
    league,
    lastUpdated,
    bookmakerCount: bookmakers.size,
  };

  const response: ApiSuccessResponse<ExtendedMarketsResponseData, ExtendedMarketsResponseMeta> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
});

export default router;
