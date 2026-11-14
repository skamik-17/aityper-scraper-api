/**
 * Scraper Aggregator
 * Coordinates running all scrapers in parallel and aggregating results
 */

import { v4 as uuidv4 } from "uuid";
import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import type { FullOfferScraperResult, FullMatchOffer, ScrapeMetrics } from "../types/full-offer.js";
import type { FullOfferScraper } from "./shared/scraper-contract.js";
import { browserRuntime } from "./base/browser-runtime.js";
import { RunInterruptedError, scrapeWithHardDeadline } from "./hard-deadline.js";
import { DEFAULT_JOB_CAPS, maxDurationMsFor, orderBrowserJobs, resolveJobTransport } from "./job-policy.js";
import { runJobsWithCaps, type CappedJob, type JobCaps } from "./job-scheduler.js";
import { isLeagueSupported } from "../config/leagues.js";
import { normalizeAndSaveMatches, type NormalizeAndSaveResult } from "../services/scrape-helpers.js";
import { classifyBookmakerRun, isOkRunStatus, type BookmakerRunOutcome } from "../services/run-outcome.js";
import { getIncrementalConfig } from "../config/incremental.js";
import {
  classifyIncrementalOutcome,
  finalizeIncrementalPass,
  incrementalHourLedger,
  isIncrementalPassResult,
  type FinalizeResult,
} from "../services/incremental/incremental-pass.js";
import { withScrapeMode, type ScrapeMode } from "../services/incremental/scrape-dispatch.js";
import { isIncrementalScraper } from "./shared/incremental/incremental-scraper.js";
import {
  diffTransportStats,
  formatScrapeMetricsLine,
  readTransportStats,
  startCycleSampler,
  startEventLoopWindow,
  type JobMetricsLine,
} from "./metrics/scrape-metrics.js";
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
  await browserRuntime.closeAll();
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
  /** Set when the run was aborted (shutdown) before every unit finished; outcomes hold the finished ones. */
  interrupted?: string | null;
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

function reasonText(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

function countMarkets(matches: FullMatchOffer[]): number {
  return matches.reduce((sum, m) => sum + m.markets.length, 0);
}

function formatOutcomeLine(o: BookmakerRunOutcome): string {
  const line = `[Aggregator/FullOffer] ${o.bookmaker} ${o.status}: ${o.matchesFound} matches, ${o.marketsFound} markets found, ${o.marketsSaved} saved`;
  return o.error ? `${line} - ${o.error}` : line;
}

/**
 * The outcome of a unit that threw outside the scrape and save guards (a malformed scraper
 * result, a bug): scrape_failed with the cause, so the bookmaker never silently drops out.
 */
function failedUnit(
  runId: string,
  bookmaker: PolishBookmaker,
  league: string,
  startedAt: Date,
  error: unknown,
  recordOutcome = true
): { result: FullOfferScraperResult; outcome: BookmakerRunOutcome | null } {
  console.error(`[Aggregator/FullOffer] ${bookmaker} unit threw for ${league}:`, error);
  const result: FullOfferScraperResult = { success: false, bookmaker, league, matches: [], error: `Unit failed: ${errorMessage(error)}` };
  if (!recordOutcome) return { result, outcome: null };
  const { status, error: cause } = classifyBookmakerRun(result, null);
  const finishedAt = new Date();
  const outcome: BookmakerRunOutcome = {
    runId,
    bookmaker,
    league,
    status,
    matchesFound: 0,
    marketsFound: 0,
    marketsSaved: 0,
    error: cause,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
  logOutcome(outcome);
  return { result, outcome };
}

function logOutcome(o: BookmakerRunOutcome): void {
  const line = formatOutcomeLine(o);
  if (!isOkRunStatus(o.status)) console.error(line);
  else if (o.status === "partial") console.warn(line);
  else console.log(line);
}

/** One unit's result; `outcome` is null on an incremental tick (plan 10: outcomes stay hourly). */
interface UnitRun {
  bookmaker: PolishBookmaker;
  result: FullOfferScraperResult;
  outcome: BookmakerRunOutcome | null;
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
  runSignal?: AbortSignal,
  unit: { mode?: ScrapeMode; recordOutcomes?: boolean } = {}
): Promise<Omit<UnitRun, "bookmaker"> & { metricsStatus: BookmakerRunOutcome["status"] }> {
  const startedAt = new Date();
  const scraper = SCRAPERS[bookmaker];
  const recordOutcomes = unit.recordOutcomes !== false;
  // Only a tick-planned run (modes set) owns the hour's incremental ledger; an admin or startup
  // run (no modes) must leave it to the next hourly outcome
  const takesHour = recordOutcomes && unit.mode !== undefined;
  let result: FullOfferScraperResult;
  let save: NormalizeAndSaveResult | null = null;
  let record: FinalizeResult = null;
  let saveThrew: string | null = null;
  let marketsFound = 0;
  let scrapeMs = 0;
  let saveMs = 0;
  let transport: ReturnType<typeof diffTransportStats>;

  if (!scraper) {
    console.warn(`[Aggregator/FullOffer] No scraper found for ${bookmaker}`);
    result = { success: false, bookmaker, league, matches: [], error: `No scraper configured for ${bookmaker}` };
  } else {
    console.log(`[Aggregator/FullOffer] Starting ${bookmaker} scraper for ${league}`);
    // Transport from the picked instance; the budget and hard deadline follow from it
    const jobTransport = resolveJobTransport(scraper);
    const statsBefore = readTransportStats(scraper);
    const scrapeStarted = Date.now();
    try {
      // Plan 10: the unit's pass (full, incremental or plan-only); the scraper itself when not incremental
      const picked = withScrapeMode(bookmaker, scraper, unit.mode ?? "full", { runId, cfg: getIncrementalConfig() });
      result = await scrapeWithHardDeadline(
        picked,
        { runId, bookmaker, league, transport: jobTransport, maxDurationMs: maxDurationMsFor(bookmaker, jobTransport) },
        runSignal
      );
    } catch (error) {
      // A run abort leaves no outcome for this unit: the job wrapper stops on it
      if (error instanceof RunInterruptedError) throw error;
      console.error(`[Aggregator/FullOffer] ${bookmaker} scraper threw:`, error);
      result = { success: false, bookmaker, league, matches: [], error: errorMessage(error) };
    }
    scrapeMs = Date.now() - scrapeStarted;
    transport = diffTransportStats(statsBefore, readTransportStats(scraper));

    // Raw count, taken before normalizeAndSaveMatches replaces each match.markets.
    marketsFound = countMarkets(result.matches);

    if (result.success && result.matches.length > 0) {
      const saveStarted = Date.now();
      try {
        save = await normalizeAndSaveMatches(result.matches, bookmaker, league, { useBatchInsert: true, runId });
      } catch (error) {
        console.error(`[Aggregator/FullOffer] ${bookmaker} save threw:`, error);
        saveThrew = `Save failed: ${errorMessage(error)}`;
        save = { matchesProcessed: 0, marketsNormalized: 0, marketsSaved: 0, errors: [saveThrew] };
      }
      saveMs = Date.now() - saveStarted;
    }
  }

  // Plan 10: stamp the fetched events and confirm the unchanged ones (plan-only passes finalized themselves)
  const pass = isIncrementalPassResult(result) && result.incremental.mode !== "plan-only" ? result : null;
  if (pass) record = await finalizeIncrementalPass(pass, runId);
  const finishedAt = new Date();

  // A unit that should have produced an incremental pass but did not (hard timeout, thrown scraper)
  const cfg = getIncrementalConfig();
  const mode = unit.mode ?? "full";
  const incrementalUnit =
    scraper !== undefined &&
    isIncrementalScraper(scraper) &&
    (mode === "incremental" || (mode === "full" && cfg.bookmakers.has(bookmaker) && !cfg.dryRun));

  let classified: { status: BookmakerRunOutcome["status"]; error: string | null; matchesFound: number; marketsSaved: number };
  if (pass) {
    // Hourly tick: the hour's incremental passes are folded into this outcome; other ticks only note the pass
    const hour = takesHour ? incrementalHourLedger.take(bookmaker, league) : { passes: 0, failedPasses: 0, firstError: null };
    const c = classifyIncrementalOutcome(pass, save, record, hour);
    if (!recordOutcomes) incrementalHourLedger.note(bookmaker, league, pass);
    classified = { status: c.status, error: c.error, matchesFound: c.matchesFound, marketsSaved: c.marketsSaved };
  } else {
    const c = classifyBookmakerRun(result, save);
    classified = { ...c, matchesFound: result.matches.length, marketsSaved: save?.marketsSaved ?? 0 };
    if (incrementalUnit && !recordOutcomes) {
      incrementalHourLedger.noteFailure(bookmaker, league, c.error ?? "incremental pass returned no result");
    } else if (incrementalUnit && takesHour) {
      // The hourly outcome still accounts for the hour's incremental passes
      const hour = incrementalHourLedger.take(bookmaker, league);
      if (hour.failedPasses > 0) {
        const text = `${hour.failedPasses} of ${hour.passes} incremental passes this hour failed | ${hour.firstError}`;
        classified = { ...classified, error: classified.error ? `${classified.error} | ${text}` : text };
      }
    }
  }
  const outcome: BookmakerRunOutcome | null = recordOutcomes
    ? {
        runId,
        bookmaker,
        league,
        status: classified.status,
        matchesFound: classified.matchesFound,
        marketsFound,
        marketsSaved: classified.marketsSaved,
        error: classified.error,
        startedAt,
        finishedAt,
        durationMs: result.duration ?? finishedAt.getTime() - startedAt.getTime(),
      }
    : null;
  if (outcome) logOutcome(outcome);

  const metrics: ScrapeMetrics = {
    phasesMs: { scrape: scrapeMs, normalizeSave: saveMs },
    matches: result.matches.length,
    marketsFound,
    marketsSaved: classified.marketsSaved,
    ...(transport?.http ? { http: transport.http } : {}),
    ...(transport?.ws ? { ws: transport.ws } : {}),
  };
  result = { ...result, metrics };

  // Back-compat for `results` and the scrape totals: before outcomes existed, a thrown save
  // turned into a failed result, so its matches stayed out of allMatches/totalMarketsFound.
  // Keep that: the throw can stop normalizeAndSaveMatches half way through replacing
  // match.markets, so those matches would mix raw and normalized market counts.
  if (saveThrew !== null) {
    return { result: { ...result, success: false, matches: [], error: saveThrew }, outcome, metricsStatus: classified.status };
  }
  return { result, outcome, metricsStatus: classified.status };
}

/** One league of a cycle: what runAllFullOfferScrapers returns. */
function aggregateLeague(
  runId: string,
  league: string,
  startedAt: Date,
  completedAt: Date,
  runs: UnitRun[],
  interruption: { reason: string; units: number } | null = null,
  recordOutcomes = true
): FullOfferAggregatedResult {
  const totalDuration = completedAt.getTime() - startedAt.getTime();
  const results = new Map<PolishBookmaker, FullOfferScraperResult>();
  const allMatches: FullMatchOffer[] = [];
  const outcomes: BookmakerRunOutcome[] = [];
  // Scrape-based, post-normalization totals, as before outcomes existed.
  let totalMarketsFound = 0;

  for (const { bookmaker, result, outcome } of runs) {
    results.set(bookmaker, result);
    if (outcome) outcomes.push(outcome);

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

  if (!recordOutcomes) {
    // Plan 10: an incremental tick prints no "Run ... completed" line (observability counts those per hour)
    const state = interruption ? `interrupted (${interruption.reason})` : "completed";
    console.log(
      `[Aggregator/FullOffer] Incremental tick ${runId} for ${league} ${state} after ${totalDuration}ms: ${runs.length} passes, ${allMatches.length} matches fetched`
    );
  } else if (interruption) {
    console.log(
      `[Aggregator/FullOffer] Run ${runId} interrupted after ${totalDuration}ms (${interruption.reason}): ${outcomes.length} of ${interruption.units} bookmakers finished`
    );
  } else {
    console.log(
      `[Aggregator/FullOffer] Run ${runId} completed in ${totalDuration}ms: ${successCount} ok, ${errorCount} failed, ${outcomeMatches} matches, ${outcomeMarketsFound} markets found, ${totalMarketsSaved} saved`
    );
  }

  return {
    runId,
    league,
    startedAt,
    completedAt,
    totalDuration,
    results,
    allMatches,
    outcomes,
    interrupted: interruption?.reason ?? null,
    summary: {
      successCount,
      errorCount,
      totalMatchesFound: allMatches.length,
      totalMarketsFound,
      totalMarketsSaved,
    },
  };
}

export interface FullOfferCycleRequest {
  leagues: readonly string[];
  bookmakers?: readonly PolishBookmaker[];
  runIds?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  caps?: JobCaps;
  /** Plan 10: the pass per bookmaker; absent = "full" for every bookmaker. */
  modes?: Partial<Record<PolishBookmaker, ScrapeMode>>;
  /** Plan 10: false on incremental ticks (no outcomes); absent = true. */
  recordOutcomes?: boolean;
}

/** Bookmakers already told they keep the hourly full pass (once per process). */
const warnedNotIncremental = new Set<PolishBookmaker>();

/**
 * One scrape cycle over several leagues, bookmaker-major: one job per bookmaker walks
 * its supported leagues in order (one scraper, one browser at a time), browser jobs
 * capped and staggered, longest budgets first. Each league keeps its own run id,
 * Starting and completion lines and result; the map's key order is req.leagues.
 */
export async function runFullOfferCycle(req: FullOfferCycleRequest): Promise<Map<string, FullOfferAggregatedResult>> {
  const startedAt = new Date();
  // Plan 10: a scraper without the incremental contract keeps its full pass at the full
  // interval; it never runs on an incremental tick (that would repeat its full pass every tick).
  const targetBookmakers = (req.bookmakers ?? CONFIG.BOOKMAKERS).filter((bm) => {
    if (req.recordOutcomes !== false) return true;
    const scraper = SCRAPERS[bm];
    if (scraper && isIncrementalScraper(scraper)) return true;
    if (!warnedNotIncremental.has(bm)) {
      warnedNotIncremental.add(bm);
      console.warn(`[Incremental] ${bm} is not incremental-capable; it keeps its full pass on the hourly tick`);
    }
    return false;
  });
  const runIds = new Map(req.leagues.map((league) => [league, req.runIds?.[league] ?? uuidv4()]));
  const unitsByLeague = new Map(
    req.leagues.map((league) => [league, targetBookmakers.filter((bm) => isLeagueSupported(league, bm))])
  );
  const recordOutcomes = req.recordOutcomes !== false;
  for (const league of req.leagues) {
    const what = recordOutcomes ? "run" : "incremental tick";
    console.log(
      `[Aggregator/FullOffer] Starting ${what} ${runIds.get(league)} for ${league} with ${unitsByLeague.get(league)!.length} bookmakers`
    );
  }

  const runsByLeague = new Map(req.leagues.map((league) => [league, new Map<PolishBookmaker, UnitRun>()]));
  const sampler = startCycleSampler();
  const queuedAt = Date.now();
  const jobFor = (bookmaker: PolishBookmaker): CappedJob<void> => {
    const scraper = SCRAPERS[bookmaker];
    const transport = scraper ? resolveJobTransport(scraper) : "http";
    return {
      key: bookmaker,
      browser: transport === "browser",
      run: async () => {
        const jobStarted = Date.now();
        const proc = sampler.track();
        const eventLoop = startEventLoopWindow();
        const leagues: JobMetricsLine["leagues"] = {};
        let interrupted = false;
        try {
          for (const league of req.leagues) {
            if (!isLeagueSupported(league, bookmaker)) continue;
            // No new league starts after a run abort
            if (req.signal?.aborted) {
              interrupted = true;
              break;
            }
            const unitStartedAt = new Date();
            try {
              const run = await runFullOfferForBookmaker(runIds.get(league)!, bookmaker, league, req.signal, {
                mode: req.modes?.[bookmaker],
                recordOutcomes,
              });
              runsByLeague.get(league)!.set(bookmaker, { bookmaker, result: run.result, outcome: run.outcome });
              if (run.result.metrics) {
                leagues[league] = { runId: runIds.get(league)!, status: run.metricsStatus, ...run.result.metrics };
              }
            } catch (error) {
              if (error instanceof RunInterruptedError) {
                interrupted = true;
                break;
              }
              // Any other throw still yields an outcome (none on an incremental tick), and the job goes on
              const failed = failedUnit(runIds.get(league)!, bookmaker, league, unitStartedAt, error, recordOutcomes);
              runsByLeague.get(league)!.set(bookmaker, { bookmaker, ...failed });
            }
          }
        } finally {
          if (scraper) {
            try {
              await scraper.cleanup();
            } catch (error) {
              // The scrape and save already happened: keep this outcome instead of failing the whole run.
              console.error(`[Aggregator/FullOffer] ${bookmaker} cleanup failed:`, error);
            }
          }
          const procSummary = proc.stop();
          console.log(
            formatScrapeMetricsLine({
              bookmaker,
              transport,
              queueMs: jobStarted - queuedAt,
              durationMs: Date.now() - jobStarted,
              interrupted,
              leagues,
              eventLoopDelayMs: eventLoop.stop(),
              // A job shorter than one tick has no sample: the RSS now is a lower bound
              nodeRssPeakMb: Math.max(procSummary.nodePeakRssMb, Math.round(process.memoryUsage().rss / 2 ** 20)),
              chromiumPeakRssMb: transport === "browser" ? procSummary.chromiumPeakRssMb : null,
            })
          );
        }
      },
    };
  };

  const withJobs = targetBookmakers.filter((bm) => req.leagues.some((league) => isLeagueSupported(league, bm)));
  const jobs = withJobs.map(jobFor);
  const browserOrder = orderBrowserJobs(jobs.filter((j) => j.browser).map((j) => j.key as PolishBookmaker));
  const ordered = [
    ...browserOrder.map((bm) => jobs.find((j) => j.key === bm)!),
    ...jobs.filter((j) => !j.browser),
  ];
  try {
    const settled = await runJobsWithCaps(ordered, req.caps ?? DEFAULT_JOB_CAPS, req.signal);
    // A job that still rejected (outside its units) is logged, never dropped silently
    settled.forEach((r, i) => {
      if (r.status === "rejected") console.error(`[Aggregator/FullOffer] ${ordered[i].key} job failed:`, r.reason);
    });
  } finally {
    await sampler.stop();
  }

  const completedAt = new Date();
  const results = new Map<string, FullOfferAggregatedResult>();
  for (const league of req.leagues) {
    const runs = runsByLeague.get(league)!;
    // Outcomes keep targetBookmakers order
    const units = unitsByLeague.get(league)!;
    const ordered = units.flatMap((bm) => (runs.has(bm) ? [runs.get(bm)!] : []));
    // Interrupted: the run was aborted before every unit of this league finished
    const interruption =
      req.signal?.aborted && ordered.length < units.length ? { reason: reasonText(req.signal), units: units.length } : null;
    results.set(league, aggregateLeague(runIds.get(league)!, league, startedAt, completedAt, ordered, interruption, recordOutcomes));
  }
  return results;
}

/**
 * Run full offer scrapers for all bookmakers on one league: the one-league cycle.
 * Scrapes ALL available markets from each bookmaker.
 */
export async function runAllFullOfferScrapers(
  league: string = CONFIG.ENABLED_LEAGUES[0],
  bookmakers?: PolishBookmaker[],
  opts: { runId?: string; signal?: AbortSignal } = {}
): Promise<FullOfferAggregatedResult> {
  const cycle = await runFullOfferCycle({
    leagues: [league],
    bookmakers,
    runIds: opts.runId ? { [league]: opts.runId } : undefined,
    signal: opts.signal,
  });
  return cycle.get(league)!;
}
