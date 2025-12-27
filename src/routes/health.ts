/**
 * Health check endpoint
 */

import { Router } from "express";
import type { ApiSuccessResponse } from "../types/api.js";
import type { HealthCheckData } from "../types/api.js";
import { testConnection } from "../config/database.js";
import { getSchedulerStatus } from "../services/scheduler-service.js";

const router = Router();
const startTime = Date.now();

router.get("/", async (_req, res) => {
  const dbConnected = await testConnection();
  const scheduler = getSchedulerStatus();

  // Get the most recent scrape completion time across all leagues
  let lastScrapeRun: string | null = null;
  for (const result of Object.values(scheduler.lastResults)) {
    if (result?.completedAt) {
      const completedAt = result.completedAt.toISOString();
      if (!lastScrapeRun || completedAt > lastScrapeRun) {
        lastScrapeRun = completedAt;
      }
    }
  }

  const data: HealthCheckData = {
    status: dbConnected ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: "1.0.0",
    database: dbConnected ? "connected" : "disconnected",
    lastScrapeRun,
  };

  const response: ApiSuccessResponse<HealthCheckData> = {
    success: true,
    data,
  };

  res.json(response);
});

export default router;
