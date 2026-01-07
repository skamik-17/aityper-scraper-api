/**
 * Scraper Aggregator
 * Coordinates running all scrapers in parallel and aggregating results
 */

import { v4 as uuidv4 } from "uuid";
import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import type { ScraperResult, RawScrapedOdds } from "../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../types/full-offer.js";
import { PlaywrightScraper } from "./base/playwright-base.js";
import { browserPool } from "./base/browser-pool.js";
import { normalizeMarketsForBookmaker } from "../services/market-normalizer.js";
import { saveFullOfferMarkets } from "../repositories/full-offer-repository.js";
import {
  stsScraper,
  fortunaScraper,
  betclicPlaywrightScraper,
  superbetScraper,
  lvbetScraper,
  fuksiarzScraper,
  betfanScraper,
  totalbetScraper,
  forbetScraper,
  etotoScraper,
  bettersScraper,
  lebullScraper,
  betcrisScraper,
  pzbukScraper,
} from "./bookmakers/index.js";

// Map of bookmaker to scraper instance
const SCRAPERS: Record<PolishBookmaker, PlaywrightScraper> = {
  sts: stsScraper,
  fortuna: fortunaScraper,
  betclic: betclicPlaywrightScraper,
  superbet: superbetScraper,
  lvbet: lvbetScraper,
  fuksiarz: fuksiarzScraper,
  betfan: betfanScraper,
  totalbet: totalbetScraper,
  forbet: forbetScraper,
  etoto: etotoScraper,
  betters: bettersScraper,
  lebull: lebullScraper,
  betcris: betcrisScraper,
  pzbuk: pzbukScraper,
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

/**
 * Close all browsers in the pool
 * Should be called at the end of a full scraping cycle
 */
export async function closeAllBrowsers(): Promise<void> {
  await browserPool.closeAll();
}

/**
 * Full Offer Aggregated Result
 */
export interface FullOfferAggregatedResult {
  runId: string;
  league: string;
  startedAt: Date;
  completedAt: Date;
  totalDuration: number;
  results: Map<PolishBookmaker, FullOfferScraperResult>;
  allMatches: FullMatchOffer[];
  summary: {
    successCount: number;
    errorCount: number;
    totalMatchesFound: number;
    totalMarketsFound: number;
  };
}

/**
 * Run full offer scrapers for all bookmakers
 * Scrapes ALL available markets from each bookmaker
 */
export async function runAllFullOfferScrapers(
  league: string = "ekstraklasa",
  bookmakers?: PolishBookmaker[]
): Promise<FullOfferAggregatedResult> {
  const runId = uuidv4();
  const startedAt = new Date();
  const targetBookmakers = bookmakers || CONFIG.BOOKMAKERS;

  console.log(
    `[Aggregator/FullOffer] Starting run ${runId} for ${league} with ${targetBookmakers.length} bookmakers`
  );

  // Run all scrapers in parallel
  const scraperPromises = targetBookmakers.map(async (bookmaker) => {
    const scraper = SCRAPERS[bookmaker];
    if (!scraper) {
      console.warn(`[Aggregator/FullOffer] No scraper found for ${bookmaker}`);
      return {
        bookmaker,
        result: {
          success: false,
          bookmaker,
          league,
          matches: [],
          error: `No scraper configured for ${bookmaker}`,
        } as FullOfferScraperResult,
      };
    }

    try {
      console.log(`[Aggregator/FullOffer] Starting ${bookmaker} scraper for ${league}`);
      const result = await scraper.scrapeFullOffer(league);

      // Apply market normalization to all scraped markets
      if (result.success && result.matches.length > 0) {
        for (const match of result.matches) {
          match.markets = normalizeMarketsForBookmaker(match.markets, bookmaker, match.homeTeam, match.awayTeam);

          // Persist normalized markets to database (non-blocking)
          try {
            await saveFullOfferMarkets(
              match.homeTeam,
              match.awayTeam,
              bookmaker,
              match.markets,
              league,
              match.eventUrl
            );
          } catch (dbError) {
            console.error(`[Aggregator/FullOffer] DB save failed for ${match.homeTeam} vs ${match.awayTeam}:`, dbError);
            // Don't fail the scrape if DB save fails
          }
        }
        console.log(
          `[Aggregator/FullOffer] ${bookmaker} completed: success=${result.success}, ${result.matches.length} matches (normalized + saved)`
        );
      } else {
        console.log(
          `[Aggregator/FullOffer] ${bookmaker} completed: success=${result.success}, ${result.matches.length} matches`
        );
      }
      return { bookmaker, result };
    } catch (error) {
      console.error(`[Aggregator/FullOffer] ${bookmaker} failed:`, error);
      return {
        bookmaker,
        result: {
          success: false,
          bookmaker,
          league,
          matches: [],
          error: error instanceof Error ? error.message : "Unknown error",
        } as FullOfferScraperResult,
      };
    } finally {
      await scraper.cleanup();
    }
  });

  const scraperResults = await Promise.all(scraperPromises);

  const completedAt = new Date();
  const totalDuration = completedAt.getTime() - startedAt.getTime();

  // Build results map and collect all matches
  const results = new Map<PolishBookmaker, FullOfferScraperResult>();
  const allMatches: FullMatchOffer[] = [];
  let successCount = 0;
  let errorCount = 0;
  let totalMarketsFound = 0;

  for (const { bookmaker, result } of scraperResults) {
    results.set(bookmaker, result);

    if (result.success && result.matches.length > 0) {
      successCount++;
      allMatches.push(...result.matches);
      totalMarketsFound += result.matches.reduce((sum, m) => sum + m.markets.length, 0);
    } else {
      errorCount++;
    }
  }

  console.log(
    `[Aggregator/FullOffer] Run ${runId} completed in ${totalDuration}ms: ${successCount} success, ${errorCount} errors, ${allMatches.length} total matches, ${totalMarketsFound} total markets`
  );

  return {
    runId,
    league,
    startedAt,
    completedAt,
    totalDuration,
    results,
    allMatches,
    summary: {
      successCount,
      errorCount,
      totalMatchesFound: allMatches.length,
      totalMarketsFound,
    },
  };
}

/**
 * Run full offer scraper for a single bookmaker
 */
export async function runSingleFullOfferScraper(
  bookmaker: PolishBookmaker,
  league: string = "ekstraklasa"
): Promise<FullOfferScraperResult> {
  const scraper = SCRAPERS[bookmaker];
  if (!scraper) {
    return {
      success: false,
      bookmaker,
      league,
      matches: [],
      error: `No scraper configured for ${bookmaker}`,
    };
  }

  try {
    const result = await scraper.scrapeFullOffer(league);

    // Apply market normalization and persist
    if (result.success && result.matches.length > 0) {
      for (const match of result.matches) {
        match.markets = normalizeMarketsForBookmaker(match.markets, bookmaker, match.homeTeam, match.awayTeam);

        // Persist normalized markets to database (non-blocking)
        try {
          await saveFullOfferMarkets(
            match.homeTeam,
            match.awayTeam,
            bookmaker,
            match.markets,
            league,
            match.eventUrl
          );
        } catch (dbError) {
          console.error(`[SingleFullOffer] DB save failed for ${match.homeTeam} vs ${match.awayTeam}:`, dbError);
        }
      }
    }

    return result;
  } finally {
    await scraper.cleanup();
  }
}
