/**
 * Health check endpoint
 */

import { Router } from "express";
import type { ApiSuccessResponse, ScrapeStats } from "../types/api.js";
import type { HealthCheckData } from "../types/api.js";
import { testConnection } from "../config/database.js";
import { getSchedulerStatus } from "../services/scheduler-service.js";

const router = Router();
const startTime = Date.now();

router.get("/", async (_req, res) => {
  const dbConnected = await testConnection();
  const scheduler = getSchedulerStatus();

  // Get the most recent scrape completion time and stats across all leagues
  let lastScrapeRun: string | null = null;
  let totalScrapeDuration = 0;
  const lastScrapeStats: Record<string, ScrapeStats> = {};

  for (const [league, result] of Object.entries(scheduler.lastResults)) {
    if (result?.completedAt) {
      const completedAt = result.completedAt.toISOString();
      if (!lastScrapeRun || completedAt > lastScrapeRun) {
        lastScrapeRun = completedAt;
      }

      // Store per-league stats
      lastScrapeStats[league] = {
        duration: result.duration,
        successCount: result.successCount,
        errorCount: result.errorCount,
        matchesInserted: result.matchesInserted,
        extendedMarketsScraped: result.extendedMarketsScraped,
        completedAt,
      };

      totalScrapeDuration += result.duration;
    }
  }

  const hasStats = Object.keys(lastScrapeStats).length > 0;

  const data: HealthCheckData = {
    status: dbConnected ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: "1.0.0",
    database: dbConnected ? "connected" : "disconnected",
    lastScrapeRun,
    lastScrapeDuration: hasStats ? totalScrapeDuration : null,
    lastScrapeStats: hasStats ? lastScrapeStats : null,
    totalScrapeDuration: hasStats ? totalScrapeDuration : null,
  };

  const response: ApiSuccessResponse<HealthCheckData> = {
    success: true,
    data,
  };

  res.json(response);
});

export default router;
