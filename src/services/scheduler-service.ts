/**
 * Scheduler Service
 * Manages scheduled scraping jobs using node-cron
 */

import cron from "node-cron";
import { CONFIG } from "../config/index.js";
import { waitForDatabase } from "../config/database.js";
import { runScrapeCycle, type ScrapeResult } from "./scraper-service.js";
import { RunCoordinator, type RunExecutionContext, type RunRequest } from "./run-coordinator.js";
import { IntervalScheduler } from "./interval-scheduler.js";
import type { PolishBookmaker } from "../config/index.js";
import { runRetentionCleanup } from "./retention-service.js";
import { deleteScraperRunsOlderThan } from "../repositories/scraper-run-repository.js";
import { syncAllEnabledLeagues, syncStaleLeagues } from "./tsdb-sync-service.js";
import { decideStartupScrape, getStalestOkRunAt } from "./startup-policy.js";
import { formatIncrementalConfigLine, getIncrementalConfig } from "../config/incremental.js";
import { buildTickRequest, type ScrapeMode } from "./incremental/scrape-dispatch.js";

// At startup the local Supabase stack can still be coming up: wait for it instead of failing once.
const STARTUP_DB_WAIT_MS = 120_000;
// Owner decision B11: keep scraper_runs for 30 days.
const SCRAPER_RUNS_RETENTION_DAYS = 30;

export interface MultiLeagueScrapeResult {
  leagues: Map<string, ScrapeResult>;
  totalSuccessCount: number;
  totalErrorCount: number;
  totalMarketsScraped: number;
  totalUniqueMatches: number;
}

let intervalScheduler: IntervalScheduler | null = null;
let cleanupTask: cron.ScheduledTask | null = null;
let tsdbSyncTask: cron.ScheduledTask | null = null;
// Results of startup/interval runs; admin runs (often one bookmaker) are kept apart so they
// never replace the health views of the last full run.
const lastResults: Map<string, ScrapeResult> = new Map();
const lastAdminResults: Map<string, ScrapeResult> = new Map();

export interface RunLeaguesOptions {
  dbWaitMs?: number;
  leagues?: readonly string[];
  bookmakers?: readonly PolishBookmaker[];
  runIds?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** Plan 10: the pass per bookmaker of an interval tick. */
  modes?: Partial<Record<PolishBookmaker, ScrapeMode>>;
  /** Plan 10: false on incremental ticks. */
  recordOutcomes?: boolean;
}

// Plan 10: when the last full (hourly) run started; the interval ticks plan against it.
let lastFullAt: number | null = null;

/**
 * Run scrape for all enabled leagues (in parallel for speed).
 * `dbWaitMs` lets each league wait for the database instead of probing once.
 */
export async function runAllLeaguesScrape(options: RunLeaguesOptions = {}): Promise<MultiLeagueScrapeResult> {
  const leagues = options.leagues ?? CONFIG.ENABLED_LEAGUES;
  const results = new Map<string, ScrapeResult>();
  let totalSuccessCount = 0;
  let totalErrorCount = 0;
  let totalMarketsScraped = 0;
  let totalUniqueMatches = 0;

  console.log(`[Scheduler] Scraping ${leagues.length} leagues in one cycle...`);

  // One bookmaker-major cycle over all leagues; it closes the browser pool itself.
  let leagueResults: Array<{ league: string; result: ScrapeResult | null }>;
  try {
    const cycle = await runScrapeCycle(leagues, options.bookmakers, {
      dbWaitMs: options.dbWaitMs,
      runIds: options.runIds,
      signal: options.signal,
      ...(options.modes ? { modes: options.modes } : {}),
      ...(options.recordOutcomes === false ? { recordOutcomes: false } : {}),
    });
    leagueResults = leagues.map((league) => {
      const result = cycle.get(league) ?? null;
      if (result) {
        console.log(
          `[Scheduler] ${league} completed: ${result.successCount} success, ${result.uniqueMatches} matches`
        );
      }
      return { league, result };
    });
  } catch (error) {
    console.error("[Scheduler] scrape cycle failed:", error);
    leagueResults = leagues.map((league) => ({ league, result: null }));
  }

  for (const { league, result } of leagueResults) {
    if (result) {
      results.set(league, result);
      totalSuccessCount += result.successCount;
      totalErrorCount += result.errorCount;
      totalMarketsScraped += result.marketsScraped;
      totalUniqueMatches += result.uniqueMatches;
    } else {
      totalErrorCount++;
    }
  }

  return {
    leagues: results,
    totalSuccessCount,
    totalErrorCount,
    totalMarketsScraped,
    totalUniqueMatches,
  };
}

/** Runs one coordinated request and files its results by trigger. */
async function executeRun(req: RunRequest, ctx: RunExecutionContext): Promise<void> {
  const startup = req.trigger === "startup";
  if (startup) console.log("[Scheduler] Running initial scrape on startup for all leagues");
  else if (req.trigger === "interval") console.log(`[Scheduler] Starting scheduled scrape at ${new Date().toISOString()}`);

  // Plan 10: startup and hourly interval runs are the full runs the incremental ticks plan against
  const recordOutcomes = req.recordOutcomes !== false;
  if (req.trigger !== "admin" && recordOutcomes) lastFullAt = Date.now();

  const multi = await runAllLeaguesScrape({
    leagues: req.leagues,
    // A planned tick names its bookmakers; startup and plain interval runs take them all
    bookmakers: req.trigger === "admin" || req.modes ? req.bookmakers : undefined,
    runIds: ctx.runIds,
    signal: ctx.signal,
    dbWaitMs: startup ? STARTUP_DB_WAIT_MS : undefined,
    ...(req.modes ? { modes: req.modes } : {}),
    ...(recordOutcomes ? {} : { recordOutcomes: false }),
  });
  // An incremental tick never replaces the health view of the last full run
  if (!recordOutcomes) return;
  const target = req.trigger === "admin" ? lastAdminResults : lastResults;
  for (const [league, result] of multi.leagues) target.set(league, result);

  if (startup) {
    console.log(
      `[Scheduler] Initial scrape completed: ${multi.totalSuccessCount} success, ${multi.totalUniqueMatches} matches across ${req.leagues.length} leagues`
    );
  } else {
    console.log(
      `[Scheduler] All leagues completed: ${multi.totalSuccessCount} success, ${multi.totalErrorCount} errors, ${multi.totalUniqueMatches} matches`
    );
  }
}

/** The process-wide run lock: startup, interval and admin runs all go through it. */
export const runCoordinator = new RunCoordinator(executeRun);

function fullRun(trigger: "startup" | "interval"): RunRequest {
  return { trigger, leagues: [...CONFIG.ENABLED_LEAGUES], bookmakers: [...CONFIG.BOOKMAKERS] };
}

/**
 * Daily cleanup: odds retention, then scraper_runs older than the retention.
 * Each step is logged and never fatal.
 */
export async function runDailyCleanup(): Promise<void> {
  console.log("[Scheduler] Running daily cleanup");
  // Never throws; it logs its own result
  await runRetentionCleanup();

  try {
    const deleted = await deleteScraperRunsOlderThan(SCRAPER_RUNS_RETENTION_DAYS);
    console.log(`[Scheduler] scraper_runs older than ${SCRAPER_RUNS_RETENTION_DAYS} days deleted: ${deleted}`);
  } catch (error) {
    console.error(`[Scheduler] ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * First TSDB fixture sync after startup. Waits for the database; if it never
 * comes up, the sync is skipped loudly and the 04:00 cron is the next attempt.
 * Never throws.
 */
export async function runInitialTsdbSync(dbWaitMs: number = STARTUP_DB_WAIT_MS): Promise<void> {
  const probe = await waitForDatabase(dbWaitMs);
  if (!probe.ok) {
    console.error("[Scheduler] Initial TSDB sync skipped: database unreachable - " + probe.error);
    return;
  }

  try {
    const results = await syncStaleLeagues();
    if (results.length > 0) {
      const total = results.reduce((a, r) => a + r.synced, 0);
      console.log(`[Scheduler] Initial TSDB sync complete, synced: ${total} fixtures`);
    }
  } catch (error) {
    console.error("[Scheduler] Initial TSDB sync failed:", error);
  }
}

/**
 * Start the scheduled scraping job. The first run is a startup scrape 5 s after boot
 * or the next interval run, as the STARTUP_SCRAPE policy decides from data freshness.
 */
export async function startScheduler(): Promise<void> {
  if (intervalScheduler) {
    console.log("[Scheduler] Already running");
    return;
  }

  // Plan 10: with incremental bookmakers the loop ticks every pass interval and plans each tick
  const incremental = getIncrementalConfig();
  const ticking = incremental.bookmakers.size > 0;
  if (incremental.error !== null) console.error(formatIncrementalConfigLine(incremental));
  else console.log(formatIncrementalConfigLine(incremental));

  const tickMinutes = ticking ? incremental.passMinutes : CONFIG.SCRAPE_INTERVAL_MINUTES;
  console.log(`[Scheduler] Starting interval loop: every ${tickMinutes} minutes (±10 %)`);
  console.log(`[Scheduler] Enabled leagues: ${CONFIG.ENABLED_LEAGUES.join(", ")}`);

  // The next run starts interval ± 10 % after the last one started; a tick never overlaps a run.
  const intervalMs = CONFIG.SCRAPE_INTERVAL_MINUTES * 60_000;
  const tickMs = tickMinutes * 60_000;
  const request = ticking
    ? (trigger: "startup" | "interval"): RunRequest | null =>
        trigger === "startup"
          ? fullRun("startup")
          : buildTickRequest({
              now: Date.now(),
              lastFullAt,
              fullIntervalMs: intervalMs,
              leagues: CONFIG.ENABLED_LEAGUES,
              bookmakers: CONFIG.BOOKMAKERS,
              cfg: incremental,
            })
    : fullRun;
  const scheduler = new IntervalScheduler({ intervalMs: tickMs, coordinator: runCoordinator, request });
  intervalScheduler = scheduler;

  // Retention at boot, not awaited: a long first DELETE must not delay the schedule
  void runRetentionCleanup();

  // Schedule daily cleanup at 3 AM
  cleanupTask = cron.schedule(
    "0 3 * * *",
    async () => {
      await runDailyCleanup();
    },
    {
      scheduled: true,
      timezone: "Europe/Warsaw",
    }
  );

  console.log("[Scheduler] Scheduled jobs started");

  // Startup scrape or the next interval run, from how fresh the stored data is
  const now = new Date();
  const stalestOkRunAt = await getStalestOkRunAt(CONFIG.ENABLED_LEAGUES);
  const decision = decideStartupScrape(CONFIG.STARTUP_SCRAPE, stalestOkRunAt, now, intervalMs);
  // stopScheduler() (shutdown) may have run during the freshness lookup
  if (intervalScheduler !== scheduler) return;
  // The ticks plan against the stalest league's last OK run until the next full run starts
  lastFullAt = stalestOkRunAt?.getTime() ?? null;
  // An incremental bookmaker must not wait a whole interval for its first pass
  const firstDelayMs = ticking && decision.firstTrigger === "interval" ? Math.min(decision.firstDelayMs, tickMs) : decision.firstDelayMs;
  const firstAt = new Date(now.getTime() + firstDelayMs).toISOString();
  const what = decision.firstTrigger === "startup" ? "in 5s" : "skipped";
  console.log(`[Scheduler] Startup scrape ${what} (${decision.reason}); first run at ${firstAt}`);
  scheduler.start(firstDelayMs, decision.firstTrigger);
}

/**
 * Start TSDB fixtures sync jobs. Independent of scraper scheduler — runs even
 * when SCRAPERS_ON=false, because the frontend depends on Supabase-cached TSDB
 * data regardless of whether odds scraping is active.
 */
export function startTsdbSyncJobs(): void {
  if (tsdbSyncTask) {
    console.log("[Scheduler] TSDB sync already running");
    return;
  }

  tsdbSyncTask = cron.schedule(
    "0 4 * * *",
    async () => {
      console.log("[Scheduler] Running daily TSDB sync");
      try {
        const results = await syncAllEnabledLeagues();
        const total = results.reduce((a, r) => a + r.synced, 0);
        console.log(`[Scheduler] TSDB sync complete, synced: ${total} fixtures`);
      } catch (error) {
        console.error("[Scheduler] TSDB sync failed:", error);
      }
    },
    {
      scheduled: true,
      timezone: "Europe/Warsaw",
    }
  );

  setTimeout(() => {
    void runInitialTsdbSync();
  }, 1000);
}

/**
 * Stop the scheduled scraping job
 */
export function stopScheduler(): void {
  if (intervalScheduler) {
    intervalScheduler.stop();
    intervalScheduler = null;
  }
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }
  if (tsdbSyncTask) {
    tsdbSyncTask.stop();
    tsdbSyncTask = null;
  }
  console.log("[Scheduler] Stopped");
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  isScheduled: boolean;
  isRunning: boolean;
  currentRun: { runId: string; trigger: string; startedAt: string } | null;
  lastResults: Record<string, ScrapeResult>;
  lastAdminResults: Record<string, ScrapeResult>;
  nextRun: Date | null;
  enabledLeagues: readonly string[];
} {
  const running = runCoordinator.current();
  return {
    isScheduled: intervalScheduler !== null,
    isRunning: running !== null,
    currentRun: running ? { runId: running.runId, trigger: running.trigger, startedAt: running.startedAt.toISOString() } : null,
    lastResults: Object.fromEntries(lastResults),
    lastAdminResults: Object.fromEntries(lastAdminResults),
    nextRun: intervalScheduler?.nextRunAt() ?? null,
    enabledLeagues: CONFIG.ENABLED_LEAGUES,
  };
}
