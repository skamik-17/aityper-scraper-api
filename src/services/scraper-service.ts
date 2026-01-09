import type { PolishBookmaker } from "../config/index.js";
import { runAllScrapers, runAllFullOfferScrapers, closeAllBrowsers, type AggregatedResult } from "../scrapers/aggregator.js";
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
  uniqueMatches: number;
  marketsScraped: number;
  errors: string[];
}

export async function runScrapeAndPersist(
  league: string = "ekstraklasa",
  bookmakers?: PolishBookmaker[],
  closeBrowsers: boolean = true
): Promise<ScrapeResult> {
  const startedAt = new Date();
  console.log(`[ScraperService] Starting scrape for ${league}`);

  const errors: string[] = [];
  let runId = "unknown";
  let successCount = 0;
  let errorCount = 0;

  let fullOfferMarketsScraped = 0;
  let matchesWithFullOffer = 0;
  try {
    console.log(`[ScraperService] Starting full offer scrape for ${league}`);
    const fullOfferResult = await runAllFullOfferScrapers(league, bookmakers);

    runId = fullOfferResult.runId || `run-${Date.now()}`;
    matchesWithFullOffer = fullOfferResult.allMatches.length;
    fullOfferMarketsScraped = fullOfferResult.summary.totalMarketsFound;
    successCount = fullOfferResult.summary.successCount;
    errorCount = fullOfferResult.summary.errorCount;

    console.log(
      `[ScraperService] Full offer completed: ${successCount} bookmakers success, ` +
      `${matchesWithFullOffer} matches, ${fullOfferMarketsScraped} markets`
    );

    for (const [bookmaker, result] of fullOfferResult.results) {
      scraperHealth.recordRun(
        bookmaker,
        result.success,
        result.duration ?? 0,
        result.error
      );

      if (!result.success && result.error) {
        errors.push(`${bookmaker}: ${result.error}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ScraperService] Full offer scraping failed:", errorMsg);
    errors.push(`Full offer: ${errorMsg}`);
    errorCount = 1;
  }

  if (closeBrowsers) {
    try {
      await closeAllBrowsers();
      console.log("[ScraperService] Browser pool closed");
    } catch (error) {
      console.error("[ScraperService] Error closing browser pool:", error);
    }
  }

  const completedAt = new Date();
  const duration = completedAt.getTime() - startedAt.getTime();

  return {
    runId,
    league,
    startedAt,
    completedAt,
    duration,
    successCount,
    errorCount,
    uniqueMatches: matchesWithFullOffer,
    marketsScraped: fullOfferMarketsScraped,
    errors,
  };
}

export async function runPartialScrape(
  bookmakers: PolishBookmaker[],
  league: string = "ekstraklasa"
): Promise<ScrapeResult> {
  return runScrapeAndPersist(league, bookmakers);
}
