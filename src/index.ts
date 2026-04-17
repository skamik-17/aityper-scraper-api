/**
 * AITyper Backend Server
 * Express server for odds scraping and API
 */

import express from "express";
import cors from "cors";
import { CONFIG, validateConfig } from "./config/index.js";
import { testConnection } from "./config/database.js";
import routes from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { startScheduler, startTsdbSyncJobs, stopScheduler } from "./services/scheduler-service.js";
import { syncMarketTypes } from "./services/market-types-sync.js";

// Validate configuration
try {
  validateConfig();
} catch (error) {
  console.error("Configuration error:", error);
  process.exit(1);
}

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// API routes
app.use("/api", routes);

// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    name: "AITyper Backend",
    version: "1.0.0",
    endpoints: {
      health: "/api/health",
      odds: "/api/odds",
      match: "/api/odds/match?home=...&away=...",
      fullOffer: "/api/odds/match/full-offer?home=...&away=...",
      normalizedMarkets: "/api/matches/:homeTeam/:awayTeam/normalized-markets?league=...",
      bookmakers: "/api/bookmakers",
      admin: "/api/admin/*",
    },
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
function gracefulShutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}, shutting down...`);
  stopScheduler();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
async function start() {
  // Test database connection
  console.log("[Server] Testing database connection...");
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.warn("[Server] Database connection failed - some features may not work");
  } else {
    console.log("[Server] Database connected");

    // Align market_types table with the in-code MARKET_CATALOG so scraper
    // inserts don't hit FK violations on newly-added market types.
    try {
      const { upserted } = await syncMarketTypes();
      console.log(`[Server] Synced market_types: ${upserted} entries`);
    } catch (error) {
      console.error("[Server] market_types sync failed:", error);
    }
  }

  // Start scheduler (if scrapers enabled)
  if (CONFIG.NODE_ENV !== "test" && CONFIG.SCRAPERS_ON) {
    console.log("[Server] Starting scheduler...");
    startScheduler();
  } else if (!CONFIG.SCRAPERS_ON) {
    console.log("[Server] Scrapers disabled (SCRAPERS_ON=false)");
  }

  // Always keep TSDB fixtures synced — the frontend depends on this cache.
  if (CONFIG.NODE_ENV !== "test") {
    startTsdbSyncJobs();
  }

  // Start listening
  app.listen(CONFIG.PORT, () => {
    console.log(`[Server] Running on http://localhost:${CONFIG.PORT}`);
    console.log(`[Server] Environment: ${CONFIG.NODE_ENV}`);
    console.log(`[Server] Scrapers: ${CONFIG.SCRAPERS_ON ? "ON" : "OFF"}`);
    if (CONFIG.SCRAPERS_ON) {
      console.log(`[Server] Scrape interval: ${CONFIG.SCRAPE_INTERVAL_MINUTES} minutes`);
    }
  });
}

start().catch((error) => {
  console.error("[Server] Failed to start:", error);
  process.exit(1);
});
