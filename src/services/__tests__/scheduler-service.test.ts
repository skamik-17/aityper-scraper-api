import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scraperHealth } from "../scraper-health.js";

const m = vi.hoisted(() => ({
  runScrapeAndPersist: vi.fn(),
  runScrapeCycle: vi.fn(),
  closeAllBrowsers: vi.fn(),
  syncStaleLeagues: vi.fn(),
  syncAllEnabledLeagues: vi.fn(),
  waitForDatabase: vi.fn(),
  cleanupOldOdds: vi.fn(),
  deleteScraperRunsOlderThan: vi.fn(),
}));

vi.mock("../scraper-service.js", async () => ({ runScrapeAndPersist: m.runScrapeAndPersist, runScrapeCycle: m.runScrapeCycle }));
vi.mock("../../scrapers/aggregator.js", async () => ({ closeAllBrowsers: m.closeAllBrowsers }));
vi.mock("../tsdb-sync-service.js", async () => ({
  syncStaleLeagues: m.syncStaleLeagues,
  syncAllEnabledLeagues: m.syncAllEnabledLeagues,
}));
vi.mock("../../config/database.js", async () => ({ waitForDatabase: m.waitForDatabase }));
vi.mock("../startup-policy.js", async () => ({
  decideStartupScrape: () => ({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "auto: no OK run on record" }),
  getStalestOkRunAt: async () => null,
  STARTUP_DELAY_MS: 5_000,
}));
vi.mock("../../repositories/odds-repository.js", async () => ({ cleanupOldOdds: m.cleanupOldOdds }));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({
  deleteScraperRunsOlderThan: m.deleteScraperRunsOlderThan,
}));

import {
  runAllLeaguesScrape,
  runDailyCleanup,
  runInitialTsdbSync,
  startScheduler,
  startTsdbSyncJobs,
  stopScheduler,
} from "../scheduler-service.js";

const DB_DOWN = "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)";

function scrapeResult(over: Record<string, unknown> = {}) {
  return {
    runId: "440d2fc6-658b-46fe-b288-05261faa0caf",
    league: "premier-league",
    startedAt: new Date("2026-11-06T16:00:00.350Z"),
    completedAt: new Date("2026-11-06T16:02:49.798Z"),
    duration: 169448,
    successCount: 9,
    errorCount: 5,
    uniqueMatches: 180,
    marketsScraped: 90752,
    errors: [],
    aborted: null,
    marketsSaved: 68201,
    outcomes: [],
    ...over,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scraperHealth.reset();
  vi.clearAllMocks();
  for (const fn of Object.values(m)) fn.mockReset();
  m.runScrapeAndPersist.mockResolvedValue(scrapeResult());
  m.runScrapeCycle.mockResolvedValue(new Map([["premier-league", scrapeResult()]]));
  m.closeAllBrowsers.mockResolvedValue(undefined);
  m.syncStaleLeagues.mockResolvedValue([]);
  m.waitForDatabase.mockResolvedValue({ ok: true });
  m.cleanupOldOdds.mockResolvedValue({ deleted: 12 });
  m.deleteScraperRunsOlderThan.mockResolvedValue(3);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  stopScheduler();
  vi.useRealTimers();
  errorSpy.mockRestore();
  logSpy.mockRestore();
});

describe("runAllLeaguesScrape", () => {
  it("forwards dbWaitMs from runAllLeaguesScrape to runScrapeAndPersist", async () => {
    await runAllLeaguesScrape({ dbWaitMs: 120_000 });
    expect(m.runScrapeCycle).toHaveBeenCalledWith(["premier-league"], undefined, expect.objectContaining({ dbWaitMs: 120_000 }));
  });

  it("cron and manual runs probe once instead of waiting", async () => {
    await runAllLeaguesScrape();
    expect(m.runScrapeCycle.mock.calls[0][2]?.dbWaitMs).toBeUndefined();
  });

  it("an aborted league counts every bookmaker as an error", async () => {
    m.runScrapeCycle.mockResolvedValue(new Map([["premier-league",
      scrapeResult({ aborted: "db_unreachable", successCount: 0, errorCount: 14, uniqueMatches: 0, marketsScraped: 0, marketsSaved: 0 })]]));
    expect(await runAllLeaguesScrape()).toMatchObject({ totalSuccessCount: 0, totalErrorCount: 14 });
  });
});

describe("runInitialTsdbSync", () => {
  it("initial TSDB sync waits for the database instead of failing once", async () => {
    m.waitForDatabase.mockResolvedValueOnce({ ok: true });
    await runInitialTsdbSync(120_000);
    expect(m.waitForDatabase).toHaveBeenCalledWith(120_000);
    expect(m.syncStaleLeagues).toHaveBeenCalledTimes(1);
  });

  it("initial TSDB sync is skipped loudly when the database never comes up", async () => {
    m.waitForDatabase.mockResolvedValueOnce({ ok: false, error: DB_DOWN });
    await runInitialTsdbSync(120_000);
    expect(m.syncStaleLeagues).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(`[Scheduler] Initial TSDB sync skipped: database unreachable - ${DB_DOWN}`);
  });

  it("keeps the existing log lines and never throws", async () => {
    m.syncStaleLeagues.mockResolvedValueOnce([{ synced: 20 }, { synced: 18 }]);
    await runInitialTsdbSync(120_000);
    expect(logSpy).toHaveBeenCalledWith("[Scheduler] Initial TSDB sync complete, synced: 38 fixtures");

    const boom = new Error("TSDB HTTP 429");
    m.syncStaleLeagues.mockRejectedValueOnce(boom);
    await expect(runInitialTsdbSync(120_000)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("[Scheduler] Initial TSDB sync failed:", boom);
  });
});

describe("runDailyCleanup (owner decision B11: keep scraper_runs 30 days)", () => {
  it("prunes old odds and scraper_runs older than 30 days", async () => {
    await runDailyCleanup();
    expect(m.cleanupOldOdds).toHaveBeenCalledTimes(1);
    expect(m.deleteScraperRunsOlderThan).toHaveBeenCalledWith(30);
    expect(logSpy).toHaveBeenCalledWith("[Scheduler] Cleanup complete, deleted: 12");
    expect(logSpy).toHaveBeenCalledWith("[Scheduler] scraper_runs older than 30 days deleted: 3");
  });

  it("an odds cleanup failure does not stop the scraper_runs prune", async () => {
    const boom = new Error("rpc failed");
    m.cleanupOldOdds.mockRejectedValue(boom);
    await expect(runDailyCleanup()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("[Scheduler] Cleanup failed:", boom);
    expect(m.deleteScraperRunsOlderThan).toHaveBeenCalledTimes(1);
  });

  it("a prune failure is logged and not fatal", async () => {
    m.deleteScraperRunsOlderThan.mockRejectedValue(new Error(`scraper_runs prune failed: ${DB_DOWN}`));
    await expect(runDailyCleanup()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(`[Scheduler] scraper_runs prune failed: ${DB_DOWN}`);
  });
});

describe("startup timers", () => {
  // 16:16 Warsaw-local matches no cron minute, so only the startup timeouts fire.
  const NOW = new Date("2026-11-06T16:16:18.614Z");

  it("the startup scrape waits up to 120 s for the database", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    startScheduler();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.runScrapeCycle).toHaveBeenCalledTimes(1);
    expect(m.runScrapeCycle).toHaveBeenCalledWith(["premier-league"], undefined, expect.objectContaining({ dbWaitMs: 120_000 }));
  });

  it("the initial TSDB sync goes through runInitialTsdbSync", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    startTsdbSyncJobs();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(m.waitForDatabase).toHaveBeenCalledWith(120_000);
    expect(m.syncStaleLeagues).toHaveBeenCalledTimes(1);
  });
});
