/**
 * Scraper Service
 * Orchestrates scraping operations and database persistence
 */

import type { PolishBookmaker } from "../config/index.js";
import { runAllScrapers, runAllFullOfferScrapers, closeAllBrowsers, type AggregatedResult } from "../scrapers/aggregator.js";
import { insertScrapedOdds } from "../repositories/odds-repository.js";
import { insertScraperRuns } from "../repositories/scraper-run-repository.js";
import { scraperHealth } from "./scraper-health.js";

export interface ScrapeResult {
  runId: string;
  league: string;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  successCount: number;
  errorCount: number;
  oddsRecords: number;              // Total rows inserted (bookmakers × matches)
  uniqueMatches: number;            // Deduplicated match count
  matchesWithExtendedMarkets: number; // Unique matches with extended market data
  extendedMarketsScraped: number;   // Total bookmaker scrapes for extended markets
  errors: string[];
}

/**
 * Run a full scrape cycle and persist results
 * @param league - League to scrape
 * @param bookmakers - Optional list of specific bookmakers
 * @param closeBrowsers - Whether to close browsers after scraping (default true)
 */
export async function runScrapeAndPersist(
  league: string = "ekstraklasa",
  bookmakers?: PolishBookmaker[],
  closeBrowsers: boolean = true
): Promise<ScrapeResult> {
  const startedAt = new Date();
  console.log(`[ScraperService] Starting scrape for ${league}`);

  const errors: string[] = [];

  // Run all scrapers
  let aggregated: AggregatedResult;
  try {
    aggregated = await runAllScrapers(league, bookmakers);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ScraperService] Aggregator failed:", errorMsg);
    const completedAt = new Date();
    return {
      runId: "error",
      league,
      startedAt,
      completedAt,
      duration: completedAt.getTime() - startedAt.getTime(),
      successCount: 0,
      errorCount: 1,
      oddsRecords: 0,
      uniqueMatches: 0,
      matchesWithExtendedMarkets: 0,
      extendedMarketsScraped: 0,
      errors: [errorMsg],
    };
  }

  // Collect errors from individual scrapers and record health stats
  for (const [bookmaker, result] of aggregated.results) {
    // Record health metrics
    scraperHealth.recordRun(
      bookmaker,
      result.status === "success",
      result.duration,
      result.error
    );

    if (result.status !== "success" && result.error) {
      errors.push(`${bookmaker}: ${result.error}`);
    }
  }

  // Calculate unique matches count
  const uniqueMatches = new Set(
    aggregated.allOdds.map(o => `${o.homeTeam.toLowerCase()}|${o.awayTeam.toLowerCase()}`)
  ).size;

  // Persist odds to database
  let oddsRecords = 0;
  if (aggregated.allOdds.length > 0) {
    try {
      const insertResult = await insertScrapedOdds(aggregated.allOdds, league);
      oddsRecords = insertResult.inserted;
      console.log(
        `[ScraperService] Inserted ${oddsRecords} odds records (${uniqueMatches} unique matches), ${insertResult.errors} errors`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[ScraperService] Insert failed:", errorMsg);
      errors.push(`Database insert: ${errorMsg}`);
    }
  }

  // Scrape full offer markets (all markets including 1X2, DC, O/U, BTTS, etc.)
  // Uses new full-offer system that saves to scraped_markets table
  let fullOfferMarketsScraped = 0;
  let matchesWithFullOffer = 0;
  try {
    console.log(`[ScraperService] Starting full offer scrape for ${league}`);
    const fullOfferResult = await runAllFullOfferScrapers(league, bookmakers);

    matchesWithFullOffer = fullOfferResult.allMatches.length;
    fullOfferMarketsScraped = fullOfferResult.summary.totalMarketsFound;

    console.log(
      `[ScraperService] Full offer completed: ${fullOfferResult.summary.successCount} bookmakers success, ` +
      `${matchesWithFullOffer} matches, ${fullOfferMarketsScraped} markets`
    );

    // Collect errors from full offer scrapers
    for (const [bookmaker, result] of fullOfferResult.results) {
      if (!result.success && result.error) {
        errors.push(`Full offer (${bookmaker}): ${result.error}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ScraperService] Full offer scraping failed:", errorMsg);
    errors.push(`Full offer: ${errorMsg}`);
  }

  // Close all browsers in the pool at the end of the scraping cycle (if requested)
  if (closeBrowsers) {
    try {
      await closeAllBrowsers();
      console.log("[ScraperService] Browser pool closed");
    } catch (error) {
      console.error("[ScraperService] Error closing browser pool:", error);
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

  // Calculate actual completion time (after all work including extended markets)
  const completedAt = new Date();
  const duration = completedAt.getTime() - startedAt.getTime();

  return {
    runId: aggregated.runId,
    league,
    startedAt,
    completedAt,
    duration,
    successCount: aggregated.summary.successCount,
    errorCount: aggregated.summary.errorCount,
    oddsRecords,
    uniqueMatches,
    matchesWithExtendedMarkets: matchesWithFullOffer,
    extendedMarketsScraped: fullOfferMarketsScraped,
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
