import { CONFIG, type PolishBookmaker } from "../config/index.js";
import { probeDatabase, waitForDatabase } from "../config/database.js";
import { runFullOfferCycle, closeAllBrowsers, type FullOfferAggregatedResult } from "../scrapers/aggregator.js";
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

export interface ScrapeCycleOptions {
  dbWaitMs?: number;
  runIds?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** Close the browser pool after the cycle (default true). */
  closeBrowsers?: boolean;
}

/** The result of a league refused by the preflight: no scraper started, nothing written. */
function abortedLeague(
  league: string,
  runId: string,
  startedAt: Date,
  abortedAt: Date,
  bookmakers: readonly PolishBookmaker[] | undefined,
  line: string
): ScrapeResult {
  return {
    runId,
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

/**
 * Steps 5-8 for one league of a cycle: health, scraper_runs rows, streaks, the summary
 * line and the alerts. Never throws: the scraping already happened.
 */
async function persistLeagueRun(
  league: string,
  bookmakers: readonly PolishBookmaker[] | undefined,
  startedAt: Date,
  fullOfferResult: FullOfferAggregatedResult | null,
  cycleError: string | null
): Promise<ScrapeResult> {
  const errors: string[] = [];
  let runId = "unknown";
  let successCount = 0;
  let errorCount = 0;
  let outcomes: BookmakerRunOutcome[] = [];
  let marketsSaved = 0;
  let finishedAt = new Date();
  let fullOfferMarketsScraped = 0;
  let matchesWithFullOffer = 0;

  if (fullOfferResult) {
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
  } else {
    errors.push(`Full offer: ${cycleError ?? "Unknown error"}`);
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
  const summaries = summarizeBookmakerRuns(rows, bookmakers ? [...bookmakers] : CONFIG.BOOKMAKERS);

  // 8. One summary line per run, then the alerts.
  console.log(formatRunSummaryLine({ league, runId, finishedAt, outcomes }));
  await emitAlerts(
    buildRunAlerts({ league, outcomes, summaries, threshold: CONFIG.ALERT_CONSECUTIVE_FAILURES }),
    CONFIG.ALERT_WEBHOOK_URL
  );

  const completedAt = new Date();
  return {
    runId,
    league,
    startedAt,
    completedAt,
    duration: completedAt.getTime() - startedAt.getTime(),
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

/**
 * Scrape several leagues in one bookmaker-major cycle and persist each league's run.
 * The run is refused, loudly and before any scraper starts, when the database is
 * unreachable: otherwise every scraped market would be thrown away. `dbWaitMs` waits for
 * a database that is still starting instead of probing once (used by the startup run).
 */
export async function runScrapeCycle(
  leagues: readonly string[],
  bookmakers?: readonly PolishBookmaker[],
  options: ScrapeCycleOptions = {}
): Promise<Map<string, ScrapeResult>> {
  const startedAt = new Date();
  for (const league of leagues) console.log(`[ScraperService] Starting scrape for ${league}`);

  // 1-2. Preflight once: no scraper starts without a reachable database.
  const probe = options.dbWaitMs ? await waitForDatabase(options.dbWaitMs) : await probeDatabase();
  if (!probe.ok) {
    const refused = new Map<string, ScrapeResult>();
    for (const league of leagues) {
      const line = formatAbortAlert(league, probe.error);
      await emitAlerts([line], CONFIG.ALERT_WEBHOOK_URL);
      const abortedAt = new Date();
      scraperHealth.recordAbort(league, probe.error, abortedAt);
      // The coordinator's id for this league, so its log lines and the result agree
      refused.set(league, abortedLeague(league, options.runIds?.[league] ?? "aborted", startedAt, abortedAt, bookmakers, line));
    }
    return refused;
  }

  // 3. The probe has just passed, so a failure here is a schema/FK problem; the per-batch errors will name it.
  if (!(await ensureMarketTypesSynced())) {
    console.warn("[ScraperService] market_types sync failed - continuing");
  }

  // 4. Scrape, normalize and save, all leagues in one cycle.
  let cycle: Map<string, FullOfferAggregatedResult> | null = null;
  let cycleError: string | null = null;
  try {
    for (const league of leagues) console.log(`[ScraperService] Starting full offer scrape for ${league}`);
    cycle = await runFullOfferCycle({ leagues, bookmakers, runIds: options.runIds, signal: options.signal });
  } catch (error) {
    cycleError = error instanceof Error ? error.message : "Unknown error";
    console.error("[ScraperService] Full offer scraping failed:", cycleError);
  }

  // 5-8 per league, in league order.
  const results = new Map<string, ScrapeResult>();
  for (const league of leagues) {
    results.set(league, await persistLeagueRun(league, bookmakers, startedAt, cycle?.get(league) ?? null, cycleError));
  }

  // 9. Once per cycle.
  if (options.closeBrowsers !== false) {
    try {
      await closeAllBrowsers();
      console.log("[ScraperService] Browser pool closed");
    } catch (error) {
      console.error("[ScraperService] Error closing browser pool:", error);
    }
  }
  return results;
}

/** Scrape one league and persist the result: the one-league cycle. */
export async function runScrapeAndPersist(
  league: string = CONFIG.ENABLED_LEAGUES[0],
  bookmakers?: PolishBookmaker[],
  closeBrowsers: boolean = true,
  options: { dbWaitMs?: number; runId?: string; signal?: AbortSignal } = {}
): Promise<ScrapeResult> {
  const results = await runScrapeCycle([league], bookmakers, {
    dbWaitMs: options.dbWaitMs,
    runIds: options.runId ? { [league]: options.runId } : undefined,
    signal: options.signal,
    closeBrowsers,
  });
  return results.get(league)!;
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
