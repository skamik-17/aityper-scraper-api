/**
 * Bookmakers API endpoint
 */

import { Router } from "express";
import type {
  ApiSuccessResponse,
  BookmakersResponseData,
  BookmakersResponseMeta,
  BookmakerInfo,
} from "../types/api.js";
import { CONFIG, type PolishBookmaker } from "../config/index.js";
import { getBookmakerStatus } from "../repositories/odds-repository.js";
import { getAverageScrapeDurations } from "../repositories/scraper-run-repository.js";

const router = Router();

// Bookmaker display names
const BOOKMAKER_NAMES: Record<PolishBookmaker, string> = {
  sts: "STS",
  fortuna: "Fortuna",
  betclic: "Betclic",
  superbet: "Superbet",
  lvbet: "LVBet",
  fuksiarz: "Fuksiarz",
};

// Which bookmakers have no-tax promo
const HAS_NO_TAX_PROMO: Record<PolishBookmaker, boolean> = {
  sts: true,
  fortuna: false,
  betclic: false,
  superbet: false,
  lvbet: false,
  fuksiarz: false,
};

/**
 * GET /api/bookmakers
 * Get status of all bookmakers
 */
router.get("/", async (_req, res) => {
  const statusMap = await getBookmakerStatus();
  const avgDurations = await getAverageScrapeDurations();

  const now = new Date();
  const staleThreshold = 60 * 60 * 1000; // 1 hour

  const bookmakers: BookmakerInfo[] = [];
  let availableCount = 0;
  let errorCount = 0;

  for (const bookmaker of CONFIG.BOOKMAKERS) {
    const bmStatus = statusMap.get(bookmaker);
    const avgDuration = avgDurations.get(bookmaker);

    let status: "available" | "error" | "stale" = "stale";
    let lastSuccessfulScrape: string | null = null;
    let matchesFound = 0;

    if (bmStatus) {
      const age = now.getTime() - bmStatus.lastScrape.getTime();
      status = age > staleThreshold ? "stale" : "available";
      lastSuccessfulScrape = bmStatus.lastScrape.toISOString();
      matchesFound = bmStatus.matchCount;
    }

    if (status === "available") {
      availableCount++;
    } else {
      // Status is either "stale" or "error" - both count as issues
      errorCount++;
    }

    bookmakers.push({
      id: bookmaker,
      name: BOOKMAKER_NAMES[bookmaker],
      status,
      lastSuccessfulScrape,
      matchesFound,
      avgScrapeDurationMs: avgDuration || null,
      hasNoTaxPromo: HAS_NO_TAX_PROMO[bookmaker],
    });
  }

  const data: BookmakersResponseData = { bookmakers };
  const meta: BookmakersResponseMeta = {
    totalBookmakers: bookmakers.length,
    availableCount,
    errorCount,
  };

  const response: ApiSuccessResponse<BookmakersResponseData, BookmakersResponseMeta> = {
    success: true,
    data,
    meta,
  };

  res.json(response);
});

export default router;
