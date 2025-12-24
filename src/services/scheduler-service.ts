/**
 * Scheduler Service
 * Manages scheduled scraping jobs using node-cron
 */

import cron from "node-cron";
import { CONFIG } from "../config/index.js";
import { runScrapeAndPersist, type ScrapeResult } from "./scraper-service.js";
import { cleanupOldOdds } from "../repositories/odds-repository.js";

let scrapeTask: cron.ScheduledTask | null = null;
let cleanupTask: cron.ScheduledTask | null = null;
let isRunning = false;
let lastResult: ScrapeResult | null = null;

/**
 * Start the scheduled scraping job
 */
export function startScheduler(): void {
  if (scrapeTask) {
    console.log("[Scheduler] Already running");
    return;
  }

  console.log(
    `[Scheduler] Starting with cron: ${CONFIG.SCRAPE_CRON} (every ${CONFIG.SCRAPE_INTERVAL_MINUTES} minutes)`
  );

  // Schedule scraping job
  scrapeTask = cron.schedule(
    CONFIG.SCRAPE_CRON,
    async () => {
      if (isRunning) {
        console.log("[Scheduler] Previous scrape still running, skipping...");
        return;
      }

      isRunning = true;
      console.log(`[Scheduler] Starting scheduled scrape at ${new Date().toISOString()}`);

      try {
        lastResult = await runScrapeAndPersist();
        console.log(
          `[Scheduler] Scrape completed: ${lastResult.successCount} success, ${lastResult.errorCount} errors, ${lastResult.matchesInserted} matches`
        );
      } catch (error) {
        console.error("[Scheduler] Scrape failed:", error);
      } finally {
        isRunning = false;
      }
    },
    {
      scheduled: true,
      timezone: "Europe/Warsaw",
    }
  );

  // Schedule daily cleanup at 3 AM
  cleanupTask = cron.schedule(
    "0 3 * * *",
    async () => {
      console.log("[Scheduler] Running daily cleanup");
      try {
        const result = await cleanupOldOdds();
        console.log(`[Scheduler] Cleanup complete, deleted: ${result.deleted}`);
      } catch (error) {
        console.error("[Scheduler] Cleanup failed:", error);
      }
    },
    {
      scheduled: true,
      timezone: "Europe/Warsaw",
    }
  );

  console.log("[Scheduler] Scheduled jobs started");

  // Run initial scrape on startup (after a short delay)
  setTimeout(async () => {
    console.log("[Scheduler] Running initial scrape on startup");
    isRunning = true;
    try {
      lastResult = await runScrapeAndPersist();
      console.log(
        `[Scheduler] Initial scrape completed: ${lastResult.successCount} success, ${lastResult.matchesInserted} matches`
      );
    } catch (error) {
      console.error("[Scheduler] Initial scrape failed:", error);
    } finally {
      isRunning = false;
    }
  }, 5000);
}

/**
 * Stop the scheduled scraping job
 */
export function stopScheduler(): void {
  if (scrapeTask) {
    scrapeTask.stop();
    scrapeTask = null;
  }
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }
  console.log("[Scheduler] Stopped");
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  isScheduled: boolean;
  isRunning: boolean;
  lastResult: ScrapeResult | null;
  nextRun: Date | null;
} {
  let nextRun: Date | null = null;

  if (scrapeTask) {
    // Calculate next run time
    const now = new Date();
    const intervalMs = CONFIG.SCRAPE_INTERVAL_MINUTES * 60 * 1000;
    nextRun = new Date(Math.ceil(now.getTime() / intervalMs) * intervalMs);
  }

  return {
    isScheduled: scrapeTask !== null,
    isRunning,
    lastResult,
    nextRun,
  };
}

/**
 * Trigger manual scrape
 */
export async function triggerManualScrape(): Promise<ScrapeResult> {
  if (isRunning) {
    throw new Error("Scrape already in progress");
  }

  isRunning = true;
  try {
    lastResult = await runScrapeAndPersist();
    return lastResult;
  } finally {
    isRunning = false;
  }
}
