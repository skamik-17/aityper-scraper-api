/**
 * Route aggregator
 */

import { Router } from "express";
import healthRouter from "./health.js";
import oddsRouter from "./odds.js";
import bookmakersRouter from "./bookmakers.js";
import adminRouter from "./admin.js";

const router = Router();

router.use("/health", healthRouter);
router.use("/odds", oddsRouter);
router.use("/bookmakers", bookmakersRouter);
router.use("/admin", adminRouter);

export default router;
