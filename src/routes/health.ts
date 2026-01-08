/**
 * Health check endpoint
 */

import { Router } from "express";
import type { ApiSuccessResponse, ScrapeStats } from "../types/api.js";
import type { HealthCheckData } from "../types/api.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { testConnection } from "../config/database.js";
import { getSchedulerStatus } from "../services/scheduler-service.js";

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

      // Store per-league stats (duration in seconds)
      lastScrapeStats[league] = {
        startedAt: result.startedAt.toISOString(),
        completedAt: result.completedAt.toISOString(),
        duration: Math.round(result.duration / 1000),
        successCount: result.successCount,
        errorCount: result.errorCount,
        oddsRecords: result.oddsRecords,
        uniqueMatches: result.uniqueMatches,
        matchesWithExtendedMarkets: result.matchesWithExtendedMarkets,
        extendedMarketsScraped: result.extendedMarketsScraped,
      };
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

export default router;
