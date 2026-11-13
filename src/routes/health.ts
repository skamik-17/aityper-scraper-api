/**
 * Health check endpoint
 */

import { Router } from "express";
import type { ApiSuccessResponse, ScrapeStats, ScraperHealthReport } from "../types/api.js";
import type { HealthCheckData } from "../types/api.js";
import { ERROR_CODES } from "../types/api.js";
import { ApiError, asyncHandler } from "../middleware/error-handler.js";
import { CONFIG } from "../config/index.js";
import { testConnection } from "../config/database.js";
import { getSchedulerStatus } from "../services/scheduler-service.js";
import { toScrapeStats } from "../services/scraper-service.js";
import { scraperHealth } from "../services/scraper-health.js";
import { getBookmakerStatusSnapshot } from "../services/bookmaker-status.js";
import { buildScraperHealthReport } from "../services/scraper-status-report.js";

const router = Router();
const startTime = Date.now();

router.get("/", asyncHandler(async (_req, res) => {
  const dbConnected = await testConnection();
  const scheduler = getSchedulerStatus();

  // Calculate scrape cycle timing from all leagues
  let earliestStart: Date | null = null;
  let latestComplete: Date | null = null;
  const lastScrapeStats: Record<string, ScrapeStats> = {};

  for (const [league, result] of Object.entries(scheduler.lastResults)) {
    if (result?.completedAt && result?.startedAt) {
      // Track earliest start and latest completion across all leagues
      if (!earliestStart || result.startedAt < earliestStart) {
        earliestStart = result.startedAt;
      }
      if (!latestComplete || result.completedAt > latestComplete) {
        latestComplete = result.completedAt;
      }

      lastScrapeStats[league] = toScrapeStats(result);
    }
  }

  const hasStats = Object.keys(lastScrapeStats).length > 0;

  // Calculate actual wall-clock duration of the scrape cycle (in seconds)
  const scrapeDuration = earliestStart && latestComplete
    ? Math.round((latestComplete.getTime() - earliestStart.getTime()) / 1000)
    : null;

  const data: HealthCheckData = {
    status: dbConnected ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: "1.0.0",
    database: dbConnected ? "connected" : "disconnected",
    lastScrapeStarted: earliestStart?.toISOString() ?? null,
    lastScrapeCompleted: latestComplete?.toISOString() ?? null,
    lastScrapeDuration: scrapeDuration,
    lastScrapeStats: hasStats ? lastScrapeStats : null,
  };

  const response: ApiSuccessResponse<HealthCheckData> = {
    success: true,
    data,
  };

  res.json(response);
}));

const LEAGUE_SLUG = /^[a-z0-9-]+$/;

/**
 * GET /api/health/scrapers?league=<slug>
 * Per-bookmaker run health of one league. Public (no auth), like /api/health.
 */
router.get("/scrapers", asyncHandler(async (req, res) => {
  const raw = req.query.league;
  const league = raw === undefined ? CONFIG.ENABLED_LEAGUES[0] : raw;
  if (typeof league !== "string" || !LEAGUE_SLUG.test(league)) {
    throw new ApiError(400, ERROR_CODES.INVALID_PARAMS, "Invalid league slug");
  }

  const snap = await getBookmakerStatusSnapshot(league);
  const lastResult = getSchedulerStatus().lastResults[league];
  const abort = scraperHealth.getLastAbort(league);

  const data = buildScraperHealthReport(
    league,
    snap,
    lastResult ? toScrapeStats(lastResult) : null,
    abort,
    new Date(),
  );

  const response: ApiSuccessResponse<ScraperHealthReport> = { success: true, data };
  res.json(response);
}));

export default router;
