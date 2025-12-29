/**
 * Scheduler Service
 * Manages scheduled scraping jobs using node-cron
 */

import cron from "node-cron";
import { CONFIG } from "../config/index.js";
import { runScrapeAndPersist, type ScrapeResult } from "./scraper-service.js";
import { closeAllBrowsers } from "../scrapers/aggregator.js";
import { cleanupOldOdds } from "../repositories/odds-repository.js";

// Combined result for all leagues
interface MultiLeagueScrapeResult {
  leagues: Map<string, ScrapeResult>;
  totalSuccessCount: number;
  totalErrorCount: number;
  totalMatchesInserted: number;
}

let scrapeTask: cron.ScheduledTask | null = null;
let cleanupTask: cron.ScheduledTask | null = null;
let isRunning = false;
let lastResults: Map<string, ScrapeResult> = new Map();

/**
 * Run scrape for all enabled leagues (in parallel for speed)
 */
async function runAllLeaguesScrape(): Promise<MultiLeagueScrapeResult> {
  const results = new Map<string, ScrapeResult>();
  let totalSuccessCount = 0;
  let totalErrorCount = 0;
  let totalMatchesInserted = 0;

  console.log(`[Scheduler] Scraping ${CONFIG.ENABLED_LEAGUES.length} leagues in parallel...`);

  // Run scrapers for all leagues in parallel (don't close browsers between leagues)
  const leaguePromises = CONFIG.ENABLED_LEAGUES.map(async (league) => {
    console.log(`[Scheduler] Starting ${league}...`);
    try {
      // Pass closeBrowsers: false to avoid closing browsers between parallel league scrapes
      const result = await runScrapeAndPersist(league, undefined, false);
      console.log(
        `[Scheduler] ${league} completed: ${result.successCount} success, ${result.matchesInserted} matches`
      );
      return { league, result, error: null };
    } catch (error) {
      console.error(`[Scheduler] ${league} scrape failed:`, error);
      return { league, result: null, error };
    }
  });

  const leagueResults = await Promise.all(leaguePromises);

  // Close all browsers after all leagues are done
  try {
    await closeAllBrowsers();
    console.log("[Scheduler] Browser pool closed");
  } catch (error) {
    console.error("[Scheduler] Error closing browser pool:", error);
  }

  // Aggregate results
  for (const { league, result, error } of leagueResults) {
    if (result) {
      results.set(league, result);
      totalSuccessCount += result.successCount;
      totalErrorCount += result.errorCount;
      totalMatchesInserted += result.matchesInserted;
    } else {
      totalErrorCount++;
    }
  }

  return {
    leagues: results,
    totalSuccessCount,
    totalErrorCount,
    totalMatchesInserted,
  };
}

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
  console.log(`[Scheduler] Enabled leagues: ${CONFIG.ENABLED_LEAGUES.join(", ")}`);

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
        const multiResult = await runAllLeaguesScrape();
        lastResults = multiResult.leagues;
        console.log(
          `[Scheduler] All leagues completed: ${multiResult.totalSuccessCount} success, ${multiResult.totalErrorCount} errors, ${multiResult.totalMatchesInserted} matches`
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
    console.log("[Scheduler] Running initial scrape on startup for all leagues");
    isRunning = true;
    try {
      const multiResult = await runAllLeaguesScrape();
      lastResults = multiResult.leagues;
      console.log(
        `[Scheduler] Initial scrape completed: ${multiResult.totalSuccessCount} success, ${multiResult.totalMatchesInserted} matches across ${CONFIG.ENABLED_LEAGUES.length} leagues`
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
  lastResults: Record<string, ScrapeResult>;
  nextRun: Date | null;
  enabledLeagues: readonly string[];
} {
  let nextRun: Date | null = null;

  if (scrapeTask) {
    // Calculate next run time
    const now = new Date();
    const intervalMs = CONFIG.SCRAPE_INTERVAL_MINUTES * 60 * 1000;
    nextRun = new Date(Math.ceil(now.getTime() / intervalMs) * intervalMs);
  }

  // Convert Map to object for serialization
  const resultsObj: Record<string, ScrapeResult> = {};
  for (const [league, result] of lastResults) {
    resultsObj[league] = result;
  }

  return {
    isScheduled: scrapeTask !== null,
    isRunning,
    lastResults: resultsObj,
    nextRun,
    enabledLeagues: CONFIG.ENABLED_LEAGUES,
  };
}

/**
 * Trigger manual scrape for all leagues
 */
export async function triggerManualScrape(): Promise<MultiLeagueScrapeResult> {
  if (isRunning) {
    throw new Error("Scrape already in progress");
  }

  isRunning = true;
  try {
    const multiResult = await runAllLeaguesScrape();
    lastResults = multiResult.leagues;
    return multiResult;
  } finally {
    isRunning = false;
  }
}

/**
 * Trigger manual scrape for a specific league
 */
export async function triggerLeagueScrape(league: string): Promise<ScrapeResult> {
  if (isRunning) {
    throw new Error("Scrape already in progress");
  }

  if (!CONFIG.ENABLED_LEAGUES.includes(league as typeof CONFIG.ENABLED_LEAGUES[number])) {
    throw new Error(`League ${league} is not enabled`);
  }

  isRunning = true;
  try {
    const result = await runScrapeAndPersist(league);
    lastResults.set(league, result);
    return result;
  } finally {
    isRunning = false;
  }
}
