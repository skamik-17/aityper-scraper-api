/**
 * Scraper Service
 * Orchestrates scraping operations and database persistence
 */

import pLimit from "p-limit";
import type { PolishBookmaker } from "../config/index.js";
import { runAllScrapers, scrapeExtendedMarketsForMatch, closeAllBrowsers, type AggregatedResult } from "../scrapers/aggregator.js";
import { insertScrapedOdds } from "../repositories/odds-repository.js";
import { insertScraperRuns } from "../repositories/scraper-run-repository.js";
import { scraperHealth } from "./scraper-health.js";
import type { RawScrapedOdds } from "../types/scraper.js";

// Increased concurrency for better parallelism with 6 browser pool
const MATCH_CONCURRENCY_LIMIT = 6;

export interface ScrapeResult {
  runId: string;
  league: string;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  successCount: number;
  errorCount: number;
  matchesInserted: number;
  extendedMarketsScraped: number;
  errors: string[];
}

/**
 * Group odds by match (homeTeam + awayTeam) and collect eventUrls
 */
function groupOddsByMatch(
  allOdds: RawScrapedOdds[]
): Map<string, { homeTeam: string; awayTeam: string; eventUrls: Record<PolishBookmaker, string> }> {
  const matches = new Map<string, { homeTeam: string; awayTeam: string; eventUrls: Record<PolishBookmaker, string> }>();

  for (const odds of allOdds) {
    // Normalize key for matching
    const key = `${odds.homeTeam.toLowerCase()}-${odds.awayTeam.toLowerCase()}`;

    if (!matches.has(key)) {
      matches.set(key, {
        homeTeam: odds.homeTeam,
        awayTeam: odds.awayTeam,
        eventUrls: {} as Record<PolishBookmaker, string>,
      });
    }

    // Add eventUrl if available
    if (odds.eventUrl) {
      matches.get(key)!.eventUrls[odds.bookmaker] = odds.eventUrl;
    }
  }

  return matches;
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

  // Scrape extended markets (Double Chance, Over/Under, BTTS) for each match
  // Process matches in parallel with concurrency limit for better performance
  let extendedMarketsScraped = 0;
  if (aggregated.allOdds.length > 0) {
    const matchesMap = groupOddsByMatch(aggregated.allOdds);
    const matchesWithUrls = Array.from(matchesMap.values()).filter(
      (match) => Object.keys(match.eventUrls).length > 0
    );

    console.log(`[ScraperService] Scraping extended markets for ${matchesWithUrls.length} matches (${MATCH_CONCURRENCY_LIMIT} concurrent)`);

    const limit = pLimit(MATCH_CONCURRENCY_LIMIT);
    const matchPromises = matchesWithUrls.map((match) =>
      limit(async () => {
        try {
          const extResult = await scrapeExtendedMarketsForMatch(
            match.homeTeam,
            match.awayTeam,
            match.eventUrls,
            league
          );
          console.log(
            `[ScraperService] Extended markets for ${match.homeTeam} vs ${match.awayTeam}: ` +
            `DC=${extResult.summary.doubleChanceCount}, OU=${extResult.summary.overUnderCount}, BTTS=${extResult.summary.bttsCount}`
          );
          return { match, extResult, error: null };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          console.error(`[ScraperService] Extended markets failed for ${match.homeTeam} vs ${match.awayTeam}:`, errorMsg);
          return { match, extResult: null, error: errorMsg };
        }
      })
    );

    const matchResults = await Promise.all(matchPromises);

    // Aggregate results from parallel execution
    for (const { match, extResult, error } of matchResults) {
      if (extResult) {
        extendedMarketsScraped += extResult.summary.successCount;
      } else if (error) {
        errors.push(`Extended markets (${match.homeTeam} vs ${match.awayTeam}): ${error}`);
      }
    }

    console.log(`[ScraperService] Extended markets scraping completed: ${extendedMarketsScraped} bookmakers scraped`);
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

  return {
    runId: aggregated.runId,
    league,
    startedAt: aggregated.startedAt,
    completedAt: aggregated.completedAt,
    duration: aggregated.totalDuration,
    successCount: aggregated.summary.successCount,
    errorCount: aggregated.summary.errorCount,
    matchesInserted,
    extendedMarketsScraped,
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
