/**
 * Promotions API endpoint
 */

import { Router } from "express";
import { asyncHandler, ApiError } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import type { PromotionsResponse } from "../types/promotions.js";
import { ALL_POLISH_BOOKMAKERS, type PolishBookmaker } from "../config/index.js";
import { listPromotions } from "../services/promotions-service.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { bookmaker, activeAt } = req.query;

    let bookmakerId: PolishBookmaker | undefined;
    if (bookmaker !== undefined) {
      if (typeof bookmaker !== "string" || !(ALL_POLISH_BOOKMAKERS as readonly string[]).includes(bookmaker)) {
        throw new ApiError(400, ERROR_CODES.INVALID_PARAMS, "Unknown bookmaker");
      }
      bookmakerId = bookmaker as PolishBookmaker;
    }

    let at: Date | undefined;
    if (activeAt !== undefined) {
      at = typeof activeAt === "string" ? new Date(activeAt) : new Date(NaN);
      if (Number.isNaN(at.getTime())) {
        throw new ApiError(400, ERROR_CODES.INVALID_PARAMS, "Invalid activeAt (expected ISO date)");
      }
    }

    const body: PromotionsResponse = {
      success: true,
      data: {
        promotions: listPromotions({ bookmaker: bookmakerId, activeAt: at }),
        generatedAt: new Date().toISOString(),
      },
    };
    res.set("Cache-Control", "public, max-age=300").json(body);
  })
);

export default router;
