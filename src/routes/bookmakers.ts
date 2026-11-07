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
import { asyncHandler } from "../middleware/error-handler.js";
import { CONFIG, type PolishBookmaker } from "../config/index.js";
import { getAverageScrapeDurations } from "../repositories/scraper-run-repository.js";
import { getBookmakerStatusSnapshot } from "../services/bookmaker-status.js";

const router = Router();

// Bookmaker display names
const BOOKMAKER_NAMES: Record<PolishBookmaker, string> = {
  sts: "STS",
  fortuna: "Fortuna",
  betclic: "Betclic",
  superbet: "Superbet",
  lvbet: "LVBet",
  fuksiarz: "Fuksiarz",
  betfan: "BETFAN",
  totalbet: "TOTALbet",
  forbet: "forBET",
  etoto: "eToto",
  betters: "Betters",
  lebull: "Le Bull",
  betcris: "Betcris",
  pzbuk: "PZBuk",
};

// Which bookmakers have no-tax promo
const HAS_NO_TAX_PROMO: Record<PolishBookmaker, boolean> = {
  sts: true,
  fortuna: false,
  betclic: false,
  superbet: false,
  lvbet: false,
  fuksiarz: false,
  betfan: false,
  totalbet: true, // TOTALbet often has no-tax promotions
  forbet: false,
  etoto: false,
  betters: false,
  lebull: false,
  betcris: false,
  pzbuk: false,
};

/**
 * GET /api/bookmakers
 * Get status of all bookmakers
 */
router.get("/", asyncHandler(async (_req, res) => {
  // The scraped league, not the old `ekstraklasa` default that nothing scrapes.
  const snap = await getBookmakerStatusSnapshot(CONFIG.ENABLED_LEAGUES[0]);
  const avgDurations = await getAverageScrapeDurations();

  const bookmakers: BookmakerInfo[] = [];
  let availableCount = 0;
  let errorCount = 0;

  for (const bookmaker of CONFIG.BOOKMAKERS) {
    const avgDuration = avgDurations.get(bookmaker);

    const status = snap.status[bookmaker];
    const lastSuccessfulScrape = snap.lastOddsAt.get(bookmaker)?.toISOString() ?? null;
    // Interim: filled from the run summary by the API-surfaces change.
    const matchesFound = 0;

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
}));

export default router;
