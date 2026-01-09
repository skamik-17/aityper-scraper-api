/**
 * Route aggregator
 */

import { Router } from "express";
import healthRouter from "./health.js";
import oddsRouter from "./odds.js";
import bookmakersRouter from "./bookmakers.js";
import adminRouter from "./admin.js";
import normalizedMarketsRouter from "./normalized-markets.js";

const router = Router();

router.use("/health", healthRouter);
router.use("/odds", oddsRouter);
router.use("/bookmakers", bookmakersRouter);
router.use("/admin", adminRouter);
router.use("/matches", normalizedMarketsRouter);
router.use("/match", oddsRouter);

export default router;
