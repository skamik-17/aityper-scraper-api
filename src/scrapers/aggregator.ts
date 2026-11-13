/**
 * Scraper Aggregator
 * Coordinates running all scrapers in parallel and aggregating results
 */

import { v4 as uuidv4 } from "uuid";
import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../types/full-offer.js";
import type { FullOfferScraper } from "./shared/scraper-contract.js";
import { browserPool } from "./base/browser-pool.js";
import { scrapeWithHardDeadline } from "./hard-deadline.js";
import { maxDurationMsFor, resolveJobTransport } from "./job-policy.js";
import { normalizeAndSaveMatches, type NormalizeAndSaveResult } from "../services/scrape-helpers.js";
import { classifyBookmakerRun, isOkRunStatus, type BookmakerRunOutcome } from "../services/run-outcome.js";
import {
  stsScraper,
  fortunaScraper,
  betclicScraper,
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
const SCRAPERS: Record<PolishBookmaker, FullOfferScraper> = {
  sts: stsScraper,
  fortuna: fortunaScraper,
  betclic: betclicScraper,
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

/**
 * Get scraper for a specific bookmaker
 */
export function getScraper(bookmaker: PolishBookmaker): FullOfferScraper | undefined {
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
  /**
   * Scraper results, kept for back-compat (a save that threw reads as success:false, as before).
   * Use `outcomes` for run status: a result can say success while nothing was saved.
   */
  results: Map<PolishBookmaker, FullOfferScraperResult>;
  allMatches: FullMatchOffer[];
  /** One classified outcome per bookmaker, in targetBookmakers order. */
  outcomes: BookmakerRunOutcome[];
  summary: {
    /** Bookmakers with an OK outcome (success or partial: something was saved). */
    successCount: number;
    /** outcomes.length - successCount */
    errorCount: number;
    totalMatchesFound: number;
    /** Post-normalization market count of successful scrapes (meaning unchanged). */
    totalMarketsFound: number;
    /** Markets saved by bookmakers with an OK outcome. */
    totalMarketsSaved: number;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function countMarkets(matches: FullMatchOffer[]): number {
  return matches.reduce((sum, m) => sum + m.markets.length, 0);
}

function formatOutcomeLine(o: BookmakerRunOutcome): string {
  const line = `[Aggregator/FullOffer] ${o.bookmaker} ${o.status}: ${o.matchesFound} matches, ${o.marketsFound} markets found, ${o.marketsSaved} saved`;
  return o.error ? `${line} - ${o.error}` : line;
}

function logOutcome(o: BookmakerRunOutcome): void {
  const line = formatOutcomeLine(o);
  if (!isOkRunStatus(o.status)) console.error(line);
  else if (o.status === "partial") console.warn(line);
  else console.log(line);
}

/**
 * Scrape, normalize and save one bookmaker, then classify the pair.
 * A thrown scraper becomes scrape_failed, a thrown save persist_failed.
 * The returned `result` is the back-compat view kept in `results`: a thrown
 * save reads as a failed result there, as it did before outcomes existed.
 */
async function runFullOfferForBookmaker(
  runId: string,
  bookmaker: PolishBookmaker,
  league: string,
  runSignal?: AbortSignal
): Promise<{ result: FullOfferScraperResult; outcome: BookmakerRunOutcome }> {
  const startedAt = new Date();
  const scraper = SCRAPERS[bookmaker];
  let result: FullOfferScraperResult;
  let save: NormalizeAndSaveResult | null = null;
  let saveThrew: string | null = null;
  let marketsFound = 0;

  if (!scraper) {
    console.warn(`[Aggregator/FullOffer] No scraper found for ${bookmaker}`);
    result = { success: false, bookmaker, league, matches: [], error: `No scraper configured for ${bookmaker}` };
  } else {
    console.log(`[Aggregator/FullOffer] Starting ${bookmaker} scraper for ${league}`);
    // Transport from the picked instance; the budget and hard deadline follow from it
    const transport = resolveJobTransport(scraper);
    try {
      result = await scrapeWithHardDeadline(
        scraper,
        { runId, bookmaker, league, transport, maxDurationMs: maxDurationMsFor(bookmaker, transport) },
        runSignal
      );
    } catch (error) {
      console.error(`[Aggregator/FullOffer] ${bookmaker} scraper threw:`, error);
      result = { success: false, bookmaker, league, matches: [], error: errorMessage(error) };
    }

    // Raw count, taken before normalizeAndSaveMatches replaces each match.markets.
    marketsFound = countMarkets(result.matches);

    if (result.success && result.matches.length > 0) {
      try {
        save = await normalizeAndSaveMatches(result.matches, bookmaker, league, { useBatchInsert: true });
      } catch (error) {
        console.error(`[Aggregator/FullOffer] ${bookmaker} save threw:`, error);
        saveThrew = `Save failed: ${errorMessage(error)}`;
        save = { matchesProcessed: 0, marketsNormalized: 0, marketsSaved: 0, errors: [saveThrew] };
      }
    }
  }
  const finishedAt = new Date();

  if (scraper) {
    try {
      await scraper.cleanup();
    } catch (error) {
      // The scrape and save already happened: keep this outcome instead of failing the whole run.
      console.error(`[Aggregator/FullOffer] ${bookmaker} cleanup failed:`, error);
    }
  }

  const { status, error } = classifyBookmakerRun(result, save);
  const outcome: BookmakerRunOutcome = {
    runId,
    bookmaker,
    league,
    status,
    matchesFound: result.matches.length,
    marketsFound,
    marketsSaved: save?.marketsSaved ?? 0,
    error,
    startedAt,
    finishedAt,
    durationMs: result.duration ?? finishedAt.getTime() - startedAt.getTime(),
  };
  logOutcome(outcome);

  // Back-compat for `results` and the scrape totals: before outcomes existed, a thrown save
  // turned into a failed result, so its matches stayed out of allMatches/totalMarketsFound.
  // Keep that: the throw can stop normalizeAndSaveMatches half way through replacing
  // match.markets, so those matches would mix raw and normalized market counts.
  if (saveThrew !== null) {
    return { result: { ...result, success: false, matches: [], error: saveThrew }, outcome };
  }
  return { result, outcome };
}

/**
 * Run full offer scrapers for all bookmakers
 * Scrapes ALL available markets from each bookmaker
 */
export async function runAllFullOfferScrapers(
  league: string = CONFIG.ENABLED_LEAGUES[0],
  bookmakers?: PolishBookmaker[],
  opts: { runId?: string; signal?: AbortSignal } = {}
): Promise<FullOfferAggregatedResult> {
  const runId = opts.runId ?? uuidv4();
  const startedAt = new Date();
  const targetBookmakers = bookmakers || CONFIG.BOOKMAKERS;

  console.log(
    `[Aggregator/FullOffer] Starting run ${runId} for ${league} with ${targetBookmakers.length} bookmakers`
  );

  // Run all scrapers in parallel; Promise.all keeps targetBookmakers order.
  const runs = await Promise.all(
    targetBookmakers.map((bookmaker) => runFullOfferForBookmaker(runId, bookmaker, league, opts.signal))
  );

  const completedAt = new Date();
  const totalDuration = completedAt.getTime() - startedAt.getTime();

  const results = new Map<PolishBookmaker, FullOfferScraperResult>();
  const allMatches: FullMatchOffer[] = [];
  const outcomes: BookmakerRunOutcome[] = [];
  // Scrape-based, post-normalization totals, as before outcomes existed.
  let totalMarketsFound = 0;

  for (const { result, outcome } of runs) {
    results.set(outcome.bookmaker, result);
    outcomes.push(outcome);

    if (result.success && result.matches.length > 0) {
      allMatches.push(...result.matches);
      totalMarketsFound += countMarkets(result.matches);
    }
  }

  const okOutcomes = outcomes.filter((o) => isOkRunStatus(o.status));
  const successCount = okOutcomes.length;
  const errorCount = outcomes.length - successCount;
  const totalMarketsSaved = okOutcomes.reduce((sum, o) => sum + o.marketsSaved, 0);
  // Raw outcome totals, so they add up with the per-bookmaker lines.
  const outcomeMatches = outcomes.reduce((sum, o) => sum + o.matchesFound, 0);
  const outcomeMarketsFound = outcomes.reduce((sum, o) => sum + o.marketsFound, 0);

  console.log(
    `[Aggregator/FullOffer] Run ${runId} completed in ${totalDuration}ms: ${successCount} ok, ${errorCount} failed, ${outcomeMatches} matches, ${outcomeMarketsFound} markets found, ${totalMarketsSaved} saved`
  );

  return {
    runId,
    league,
    startedAt,
    completedAt,
    totalDuration,
    results,
    allMatches,
    outcomes,
    summary: {
      successCount,
      errorCount,
      totalMatchesFound: allMatches.length,
      totalMarketsFound,
      totalMarketsSaved,
    },
  };
}
