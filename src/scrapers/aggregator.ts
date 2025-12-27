/**
 * Scraper Aggregator
 * Coordinates running all scrapers in parallel and aggregating results
 */

import { v4 as uuidv4 } from "uuid";
import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import type { ScraperResult, RawScrapedOdds } from "../types/scraper.js";
import { PlaywrightScraper } from "./base/playwright-base.js";
import {
  stsScraper,
  fortunaPlaywrightScraper,
  betclicPlaywrightScraper,
  superbetPlaywrightScraper,
  lvbetPlaywrightScraper,
  fuksiarzPlaywrightScraper,
} from "./bookmakers/index.js";

// Map of bookmaker to scraper instance
const SCRAPERS: Record<PolishBookmaker, PlaywrightScraper> = {
  sts: stsScraper,
  fortuna: fortunaPlaywrightScraper,
  betclic: betclicPlaywrightScraper,
  superbet: superbetPlaywrightScraper,
  lvbet: lvbetPlaywrightScraper,
  fuksiarz: fuksiarzPlaywrightScraper,
};

export interface AggregatedResult {
  runId: string;
  league: string;
  startedAt: Date;
  completedAt: Date;
  totalDuration: number;
  results: Map<PolishBookmaker, ScraperResult>;
  allOdds: RawScrapedOdds[];
  summary: {
    successCount: number;
    errorCount: number;
    totalMatchesFound: number;
  };
}

/**
 * Run all scrapers for a specific league
 */
export async function runAllScrapers(
  league: string = "ekstraklasa",
  bookmakers?: PolishBookmaker[]
): Promise<AggregatedResult> {
  const runId = uuidv4();
  const startedAt = new Date();
  const targetBookmakers = bookmakers || CONFIG.BOOKMAKERS;

  console.log(
    `[Aggregator] Starting run ${runId} for ${league} with ${targetBookmakers.length} bookmakers`
  );

  // Run all scrapers in parallel
  const scraperPromises = targetBookmakers.map(async (bookmaker) => {
    const scraper = SCRAPERS[bookmaker];
    if (!scraper) {
      console.warn(`[Aggregator] No scraper found for ${bookmaker}`);
      return {
        bookmaker,
        result: {
          status: "error" as const,
          bookmaker,
          error: `No scraper configured for ${bookmaker}`,
          duration: 0,
          timestamp: new Date(),
        },
      };
    }

    try {
      console.log(`[Aggregator] Starting ${bookmaker} scraper for ${league}`);
      const result = await scraper.scrapeLeague(league);
      console.log(
        `[Aggregator] ${bookmaker} completed: ${result.status}, ${result.data?.length || 0} matches`
      );
      return { bookmaker, result };
    } catch (error) {
      console.error(`[Aggregator] ${bookmaker} failed:`, error);
      return {
        bookmaker,
        result: {
          status: "error" as const,
          bookmaker,
          error: error instanceof Error ? error.message : "Unknown error",
          duration: 0,
          timestamp: new Date(),
        },
      };
    } finally {
      // Clean up browser resources
      await scraper.cleanup();
    }
  });

  const scraperResults = await Promise.all(scraperPromises);

  const completedAt = new Date();
  const totalDuration = completedAt.getTime() - startedAt.getTime();

  // Build results map and collect all odds
  const results = new Map<PolishBookmaker, ScraperResult>();
  const allOdds: RawScrapedOdds[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (const { bookmaker, result } of scraperResults) {
    results.set(bookmaker, result);

    if (result.status === "success" && result.data) {
      successCount++;
      allOdds.push(...result.data);
    } else {
      errorCount++;
    }
  }

  console.log(
    `[Aggregator] Run ${runId} completed in ${totalDuration}ms: ${successCount} success, ${errorCount} errors, ${allOdds.length} total matches`
  );

  return {
    runId,
    league,
    startedAt,
    completedAt,
    totalDuration,
    results,
    allOdds,
    summary: {
      successCount,
      errorCount,
      totalMatchesFound: allOdds.length,
    },
  };
}

/**
 * Run a single scraper for a specific league
 */
export async function runSingleScraper(
  bookmaker: PolishBookmaker,
  league: string = "ekstraklasa"
): Promise<ScraperResult> {
  const scraper = SCRAPERS[bookmaker];
  if (!scraper) {
    return {
      status: "error",
      bookmaker,
      error: `No scraper configured for ${bookmaker}`,
      duration: 0,
      timestamp: new Date(),
    };
  }

  try {
    const result = await scraper.scrapeLeague(league);
    return result;
  } finally {
    await scraper.cleanup();
  }
}

/**
 * Get scraper for a specific bookmaker
 */
export function getScraper(bookmaker: PolishBookmaker): PlaywrightScraper | undefined {
  return SCRAPERS[bookmaker];
}
