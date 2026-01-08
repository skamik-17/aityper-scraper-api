/**
 * Admin API endpoints (protected)
 */

import { Router } from "express";
import type {
  ApiSuccessResponse,
  AdminScrapeRequest,
  AdminScrapeResponseData,
  AdminRunsResponseData,
  AdminRunsResponseMeta,
  ScraperRunInfo,
  ScraperRunResult,
} from "../types/api.js";
import { ApiError, asyncHandler } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { CONFIG, type PolishBookmaker } from "../config/index.js";
import { runScrapeAndPersist } from "../services/scraper-service.js";
import { getRunsSummary } from "../repositories/scraper-run-repository.js";
import { scraperHealth } from "../services/scraper-health.js";

const router = Router();

// All admin routes require authentication
router.use(requireAdminAuth);

/**
 * POST /api/admin/scrape
 * Manually trigger a scrape run
 */
router.post("/scrape", asyncHandler(async (req, res) => {
  const body = req.body as AdminScrapeRequest;
  const league = body.league || "ekstraklasa";
  let bookmakers = body.bookmakers;

  // Validate bookmakers if provided
  if (bookmakers) {
    const validBookmakers = CONFIG.BOOKMAKERS as readonly string[];
    for (const bm of bookmakers) {
      if (!validBookmakers.includes(bm)) {
        throw new ApiError(
          400,
          ERROR_CODES.INVALID_PARAMS,
          `Invalid bookmaker: ${bm}`
        );
      }
    }
  } else {
    bookmakers = [...CONFIG.BOOKMAKERS] as PolishBookmaker[];
  }

  // Start scrape (don't wait for completion)
  const startedAt = new Date();

  // Run async but respond immediately
  runScrapeAndPersist(league, bookmakers).catch((err) => {
    console.error("[Admin] Scrape failed:", err);
  });

  // Generate a run ID for tracking
  const runId = `${Date.now()}-manual`;

  const data: AdminScrapeResponseData = {
    runId,
    status: "started",
    league,
    bookmakers,
    startedAt: startedAt.toISOString(),
  };

  const response: ApiSuccessResponse<AdminScrapeResponseData> = {
    success: true,
    data,
  };

  res.status(202).json(response);
}));

/**
 * GET /api/admin/runs
 * Get history of scraper runs
 */
router.get("/runs", asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  const { runs, total } = await getRunsSummary(limit, offset);

  // Transform to API format
  const formattedRuns: ScraperRunInfo[] = runs.map((run) => {
    const successCount = run.results.filter((r) => r.status === "success").length;
    const errorCount = run.results.filter((r) => r.status !== "success").length;
    const totalMatchesFound = run.results.reduce(
      (sum, r) => sum + r.matchesFound,
      0
    );

    // Map results with proper status typing
    const typedResults: ScraperRunResult[] = run.results.map((r) => ({
      bookmaker: r.bookmaker,
      status: r.status === "success" ? "success" as const : "error" as const,
      matchesFound: r.matchesFound,
      durationMs: r.durationMs,
      error: r.error,
    }));

    return {
      runId: run.runId,
      league: run.league,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt.toISOString(),
      totalDurationMs: run.totalDurationMs,
      results: typedResults,
      summary: {
        successCount,
        errorCount,
        totalMatchesFound,
      },
    };
  });

  const data: AdminRunsResponseData = { runs: formattedRuns };
  const meta: AdminRunsResponseMeta = {
    total,
    limit,
    offset,
  };

  const response: ApiSuccessResponse<AdminRunsResponseData, AdminRunsResponseMeta> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
}));

/**
 * GET /api/admin/scrapers/health
 * Get health status for all scrapers
 */
router.get("/scrapers/health", asyncHandler(async (_req, res) => {
  const health = scraperHealth.getAllHealth();
  const failing = scraperHealth.getFailingScrapers();

  const response = {
    success: true,
    data: {
      scrapers: health,
      failingScrapers: failing,
      summary: {
        total: health.length,
        healthy: health.filter((h) => h.status === "healthy").length,
        degraded: health.filter((h) => h.status === "degraded").length,
        failing: health.filter((h) => h.status === "failing").length,
      },
    },
  };

  res.json(response);
}));

export default router;
