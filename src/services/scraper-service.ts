import { CONFIG, type PolishBookmaker } from "../config/index.js";
import { probeDatabase, waitForDatabase } from "../config/database.js";
import { runAllFullOfferScrapers, closeAllBrowsers } from "../scrapers/aggregator.js";
import {
  getRecentRunRows,
  insertBookmakerRunOutcomes,
  toScraperRunInsert,
  type ScraperRunRow,
} from "../repositories/scraper-run-repository.js";
import type { ScrapeStats } from "../types/api.js";
import { scraperHealth } from "./scraper-health.js";
import { isOkRunStatus, type BookmakerRunOutcome } from "./run-outcome.js";
import { ensureMarketTypesSynced } from "./market-types-sync.js";
import { mergeRunRows, STATUS_WINDOW_RUNS, summarizeBookmakerRuns } from "./bookmaker-status.js";
import { buildRunAlerts, emitAlerts, formatAbortAlert, formatRunSummaryLine } from "./run-alerts.js";

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
  /** Set when the run was refused before any scraper started. */
  aborted: "db_unreachable" | null;
  /** Markets saved by bookmakers with an OK outcome. */
  marketsSaved: number;
  outcomes: BookmakerRunOutcome[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Scrape one league and persist the result. The run is refused, loudly and
 * before any scraper starts, when the database is unreachable: otherwise every
 * scraped market would be thrown away. `dbWaitMs` waits for a database that is
 * still starting instead of probing once (used by the startup run).
 */
export async function runScrapeAndPersist(
  league: string = "ekstraklasa",
  bookmakers?: PolishBookmaker[],
  closeBrowsers: boolean = true,
  options: { dbWaitMs?: number } = {}
): Promise<ScrapeResult> {
  const startedAt = new Date();
  console.log(`[ScraperService] Starting scrape for ${league}`);

  // 1-2. Preflight: no scraper starts without a reachable database.
  const probe = options.dbWaitMs ? await waitForDatabase(options.dbWaitMs) : await probeDatabase();
  if (!probe.ok) {
    const line = formatAbortAlert(league, probe.error);
    await emitAlerts([line], CONFIG.ALERT_WEBHOOK_URL);
    const abortedAt = new Date();
    scraperHealth.recordAbort(league, probe.error, abortedAt);
    return {
      runId: "aborted",
      league,
      startedAt,
      completedAt: abortedAt,
      duration: abortedAt.getTime() - startedAt.getTime(),
      successCount: 0,
      errorCount: (bookmakers ?? CONFIG.BOOKMAKERS).length,
      uniqueMatches: 0,
      marketsScraped: 0,
      errors: [line],
      aborted: "db_unreachable",
      marketsSaved: 0,
      outcomes: [],
    };
  }

  // 3. The probe has just passed, so a failure here is a schema/FK problem; the per-batch errors will name it.
  if (!(await ensureMarketTypesSynced())) {
    console.warn("[ScraperService] market_types sync failed - continuing");
  }

  const errors: string[] = [];
  let runId = "unknown";
  let successCount = 0;
  let errorCount = 0;
  let outcomes: BookmakerRunOutcome[] = [];
  let marketsSaved = 0;
  let finishedAt = new Date();

  let fullOfferMarketsScraped = 0;
  let matchesWithFullOffer = 0;
  try {
    // 4. Scrape, normalize and save.
    console.log(`[ScraperService] Starting full offer scrape for ${league}`);
    const fullOfferResult = await runAllFullOfferScrapers(league, bookmakers);

    runId = fullOfferResult.runId || `run-${Date.now()}`;
    finishedAt = fullOfferResult.completedAt;
    matchesWithFullOffer = fullOfferResult.allMatches.length;
    fullOfferMarketsScraped = fullOfferResult.summary.totalMarketsFound;
    successCount = fullOfferResult.summary.successCount;
    errorCount = fullOfferResult.summary.errorCount;
    marketsSaved = fullOfferResult.summary.totalMarketsSaved;
    outcomes = fullOfferResult.outcomes;

    console.log(
      `[ScraperService] Full offer completed: ${successCount} bookmakers success, ` +
      `${matchesWithFullOffer} matches, ${fullOfferMarketsScraped} markets`
    );

    // 5. Health and errors[] follow the classified outcomes, not results[bm].success: a
    // bookmaker that scraped matches but saved nothing (persist_failed) or found none
    // (empty) is a failure, and its save error is reported.
    for (const o of outcomes) {
      scraperHealth.recordOutcome(o);
      if (!isOkRunStatus(o.status) && o.error) errors.push(`${o.bookmaker}: ${o.error}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[ScraperService] Full offer scraping failed:", errorMsg);
    errors.push(`Full offer: ${errorMsg}`);
    errorCount = 1;
  }

  // 6. Persist one scraper_runs row per outcome. Never fatal: the run already happened.
  try {
    await insertBookmakerRunOutcomes(outcomes);
  } catch (error) {
    const msg = errorMessage(error);
    console.error("[ScraperService] scraper_runs not persisted: " + msg);
    errors.push(msg);
  }

  // 7. Streaks come from this process's history merged with the DB history. The
  // in-memory side always holds the current run, even when step 6 failed.
  let dbRows: ScraperRunRow[] = [];
  try {
    dbRows = await getRecentRunRows(league, STATUS_WINDOW_RUNS * CONFIG.BOOKMAKERS.length);
  } catch (error) {
    console.warn(`[ScraperService] scraper_runs history unavailable, alerts use this process's runs only: ${errorMessage(error)}`);
  }
  const rows = mergeRunRows(scraperHealth.getRecentOutcomes(league).map(toScraperRunInsert), dbRows);
  const summaries = summarizeBookmakerRuns(rows, bookmakers ?? CONFIG.BOOKMAKERS);

  // 8. One summary line per run, then the alerts.
  console.log(formatRunSummaryLine({ league, runId, finishedAt, outcomes }));
  await emitAlerts(
    buildRunAlerts({ league, outcomes, summaries, threshold: CONFIG.ALERT_CONSECUTIVE_FAILURES }),
    CONFIG.ALERT_WEBHOOK_URL
  );

  // 9.
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
    aborted: null,
    marketsSaved,
    outcomes,
  };
}

/** The /api/health view of one league's last run. */
export function toScrapeStats(result: ScrapeResult): ScrapeStats {
  return {
    startedAt: result.startedAt.toISOString(),
    completedAt: result.completedAt.toISOString(),
    duration: Math.round(result.duration / 1000),
    successCount: result.successCount,
    errorCount: result.errorCount,
    uniqueMatches: result.uniqueMatches,
    marketsScraped: result.marketsScraped,
    marketsSaved: result.marketsSaved,
    aborted: result.aborted,
    failed: result.outcomes
      .filter((o) => !isOkRunStatus(o.status))
      .map((o) => ({ bookmaker: o.bookmaker, status: o.status, error: o.error })),
  };
}

export async function runPartialScrape(
  bookmakers: PolishBookmaker[],
  league: string = "ekstraklasa"
): Promise<ScrapeResult> {
  return runScrapeAndPersist(league, bookmakers);
}
