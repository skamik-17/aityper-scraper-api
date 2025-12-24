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
} from "../types/api.js";
import { ApiError } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { CONFIG, type PolishBookmaker } from "../config/index.js";
import { runScrapeAndPersist } from "../services/scraper-service.js";
import { getRunsSummary } from "../repositories/scraper-run-repository.js";

const router = Router();

// All admin routes require authentication
router.use(requireAdminAuth);

/**
 * POST /api/admin/scrape
 * Manually trigger a scrape run
 */
router.post("/scrape", async (req, res) => {
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
});

/**
 * GET /api/admin/runs
 * Get history of scraper runs
 */
router.get("/runs", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  const { runs, total } = await getRunsSummary(limit, offset);

  // Transform to API format
  const formattedRuns = runs.map((run) => {
    const successCount = run.results.filter((r) => r.status === "success").length;
    const errorCount = run.results.filter((r) => r.status !== "success").length;
    const totalMatchesFound = run.results.reduce(
      (sum, r) => sum + r.matchesFound,
      0
    );

    return {
      runId: run.runId,
      league: run.league,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt.toISOString(),
      totalDurationMs: run.totalDurationMs,
      results: run.results,
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

  const response: ApiSuccessResponse<AdminRunsResponseData> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
});

export default router;
