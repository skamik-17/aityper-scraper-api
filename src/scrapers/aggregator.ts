/**
 * Scraper Aggregator
 * Coordinates running all scrapers in parallel and aggregating results
 */

import { v4 as uuidv4 } from "uuid";
import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import type { ScraperResult, RawScrapedOdds, RawScrapedMatchOdds, MatchDetailResult } from "../types/scraper.js";
import { PlaywrightScraper } from "./base/playwright-base.js";
import { browserPool } from "./base/browser-pool.js";
import { insertExtendedMarketOdds } from "../repositories/extended-odds-repository.js";
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
 * Extended Markets Scraping Result
 */
export interface ExtendedMarketsResult {
  homeTeam: string;
  awayTeam: string;
  results: Map<PolishBookmaker, MatchDetailResult>;
  summary: {
    successCount: number;
    errorCount: number;
    doubleChanceCount: number;
    overUnderCount: number;
    bttsCount: number;
  };
  duration: number;
}

/**
 * Scrape extended markets for a specific match from all bookmakers
 * This is called on-demand when user opens a match detail page
 */
export async function scrapeExtendedMarketsForMatch(
  homeTeam: string,
  awayTeam: string,
  eventUrls: Record<PolishBookmaker, string>,
  league: string = "ekstraklasa"
): Promise<ExtendedMarketsResult> {
  const startTime = Date.now();
  const results = new Map<PolishBookmaker, MatchDetailResult>();
  let successCount = 0;
  let errorCount = 0;
  let doubleChanceCount = 0;
  let overUnderCount = 0;
  let bttsCount = 0;

  console.log(`[Aggregator] Scraping extended markets for ${homeTeam} vs ${awayTeam}`);

  // Scrape each bookmaker that has an event URL
  const scrapePromises = Object.entries(eventUrls).map(async ([bookmakerStr, eventUrl]) => {
    const bookmaker = bookmakerStr as PolishBookmaker;
    const scraper = SCRAPERS[bookmaker];

    if (!scraper || !eventUrl) {
      return { bookmaker, result: null };
    }

    try {
      console.log(`[Aggregator] Scraping extended markets from ${bookmaker}: ${eventUrl}`);
      const result = await scraper.scrapeMatchDetails(eventUrl);

      if (result.status === "success" && result.data) {
        // Save to database
        const saved = await insertExtendedMarketOdds(result.data, league);
        console.log(
          `[Aggregator] ${bookmaker} extended markets saved: DC=${saved.doubleChance}, OU=${saved.overUnder}, BTTS=${saved.btts}`
        );
      }

      return { bookmaker, result };
    } catch (error) {
      console.error(`[Aggregator] ${bookmaker} extended markets failed:`, error);
      return {
        bookmaker,
        result: {
          status: "error" as const,
          bookmaker,
          error: error instanceof Error ? error.message : "Unknown error",
          duration: 0,
          timestamp: new Date(),
        } as MatchDetailResult,
      };
    } finally {
      await scraper.cleanup();
    }
  });

  const scraperResults = await Promise.all(scrapePromises);

  // Aggregate results
  for (const { bookmaker, result } of scraperResults) {
    if (!result) continue;

    results.set(bookmaker, result);

    if (result.status === "success" && result.data) {
      successCount++;
      if (result.data.marketDoubleChance) doubleChanceCount++;
      if (result.data.marketOverUnder && Object.keys(result.data.marketOverUnder).length > 0) {
        overUnderCount++;
      }
      if (result.data.marketBTTS) bttsCount++;
    } else {
      errorCount++;
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[Aggregator] Extended markets scrape completed in ${duration}ms: ${successCount} success, ${errorCount} errors`
  );

  return {
    homeTeam,
    awayTeam,
    results,
    summary: {
      successCount,
      errorCount,
      doubleChanceCount,
      overUnderCount,
      bttsCount,
    },
    duration,
  };
}

/**
 * Scrape extended markets for a single bookmaker
 */
export async function scrapeSingleExtendedMarket(
  bookmaker: PolishBookmaker,
  eventUrl: string,
  league: string = "ekstraklasa"
): Promise<MatchDetailResult> {
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
    const result = await scraper.scrapeMatchDetails(eventUrl);

    if (result.status === "success" && result.data) {
      // Save to database
      await insertExtendedMarketOdds(result.data, league);
    }

    return result;
  } finally {
    await scraper.cleanup();
  }
}

/**
 * Close all browsers in the pool
 * Should be called at the end of a full scraping cycle
 */
export async function closeAllBrowsers(): Promise<void> {
  await browserPool.closeAll();
}
