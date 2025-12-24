/**
 * Scraper Service
 * Orchestrates scraping operations and database persistence
 */

import type { PolishBookmaker } from "../config/index.js";
import { runAllScrapers, type AggregatedResult } from "../scrapers/aggregator.js";
import { insertScrapedOdds } from "../repositories/odds-repository.js";
import { insertScraperRuns } from "../repositories/scraper-run-repository.js";

export interface ScrapeResult {
  runId: string;
  league: string;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  successCount: number;
  errorCount: number;
  matchesInserted: number;
  errors: string[];
}

/**
 * Run a full scrape cycle and persist results
 */
export async function runScrapeAndPersist(
  league: string = "ekstraklasa",
  bookmakers?: PolishBookmaker[]
): Promise<ScrapeResult> {
  console.log(`[ScraperService] Starting scrape for ${league}`);

  const errors: string[] = [];

  // Run all scrapers
  let aggregated: AggregatedResult;
  try {
    aggregated = await runAllScrapers(league, bookmakers);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ScraperService] Aggregator failed:", errorMsg);
    return {
      runId: "error",
      league,
      startedAt: new Date(),
      completedAt: new Date(),
      duration: 0,
      successCount: 0,
      errorCount: 1,
      matchesInserted: 0,
      errors: [errorMsg],
    };
  }

  // Collect errors from individual scrapers
  for (const [bookmaker, result] of aggregated.results) {
    if (result.status !== "success" && result.error) {
      errors.push(`${bookmaker}: ${result.error}`);
    }
  }

  // Persist odds to database
  let matchesInserted = 0;
  if (aggregated.allOdds.length > 0) {
    try {
      const insertResult = await insertScrapedOdds(aggregated.allOdds, league);
      matchesInserted = insertResult.inserted;
      console.log(
        `[ScraperService] Inserted ${matchesInserted} odds records, ${insertResult.errors} errors`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[ScraperService] Insert failed:", errorMsg);
      errors.push(`Database insert: ${errorMsg}`);
    }
  }

  // Log scraper runs
  try {
    await insertScraperRuns(aggregated.runId, league, aggregated.results);
    console.log(`[ScraperService] Logged ${aggregated.results.size} scraper runs`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ScraperService] Failed to log runs:", errorMsg);
    errors.push(`Run logging: ${errorMsg}`);
  }

  return {
    runId: aggregated.runId,
    league,
    startedAt: aggregated.startedAt,
    completedAt: aggregated.completedAt,
    duration: aggregated.totalDuration,
    successCount: aggregated.summary.successCount,
    errorCount: aggregated.summary.errorCount,
    matchesInserted,
    errors,
  };
}

/**
 * Run scrape for specific bookmakers only
 */
export async function runPartialScrape(
  bookmakers: PolishBookmaker[],
  league: string = "ekstraklasa"
): Promise<ScrapeResult> {
  return runScrapeAndPersist(league, bookmakers);
}
