import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../__tests__/helpers/run-fixtures.js";
import { CONFIG } from "../../config/index.js";
import type { ScrapeResult } from "../scraper-service.js";

const m = vi.hoisted(() => ({
  runScrapeAndPersist: vi.fn(),
  runScrapeCycle: vi.fn(),
  closeAllBrowsers: vi.fn(),
  cronJobs: [] as Array<{ expr: string; fn: () => unknown }>,
}));

vi.mock("../scraper-service.js", async () => ({ runScrapeAndPersist: m.runScrapeAndPersist, runScrapeCycle: m.runScrapeCycle }));
vi.mock("../../scrapers/aggregator.js", async () => ({ closeAllBrowsers: m.closeAllBrowsers }));
vi.mock("node-cron", async () => ({
  default: {
    schedule: (expr: string, fn: () => unknown) => {
      m.cronJobs.push({ expr, fn });
      return { stop: vi.fn() };
    },
  },
}));
vi.mock("../tsdb-sync-service.js", async () => ({ syncStaleLeagues: vi.fn(), syncAllEnabledLeagues: vi.fn() }));
vi.mock("../../config/database.js", async () => ({ waitForDatabase: vi.fn() }));
vi.mock("../../repositories/odds-repository.js", async () => ({ cleanupOldOdds: vi.fn() }));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({ deleteScraperRunsOlderThan: vi.fn() }));
const sp = vi.hoisted(() => ({ decideStartupScrape: vi.fn(), getStalestOkRunAt: vi.fn() }));
vi.mock("../startup-policy.js", async () => ({ decideStartupScrape: sp.decideStartupScrape, getStalestOkRunAt: sp.getStalestOkRunAt, STARTUP_DELAY_MS: 5_000 }));

import { getSchedulerStatus, runCoordinator, startScheduler, stopScheduler } from "../scheduler-service.js";

function scrapeResult(league: string, runId: string): ScrapeResult {
  return {
    runId,
    league,
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
  } as ScrapeResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.runScrapeAndPersist.mockReset();
  m.runScrapeCycle.mockReset();
  m.runScrapeCycle.mockImplementation(async (leagues: string[], _bm: unknown, options?: { runIds?: Record<string, string> }) =>
    new Map(leagues.map((l) => [l, scrapeResult(l, options?.runIds?.[l] ?? "none")])));
  m.closeAllBrowsers.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await runCoordinator.whenIdle();
  vi.restoreAllMocks();
});

describe("scheduler runs through the RunCoordinator", () => {
  it("an admin start during a running interval run is refused and closes no browsers (Review Focus 2)", async () => {
    const d = deferred<Map<string, ScrapeResult>>();
    m.runScrapeCycle.mockReturnValueOnce(d.promise);
    const first = runCoordinator.start({ trigger: "interval", leagues: ["premier-league"], bookmakers: [...CONFIG.BOOKMAKERS] });
    if (!first.accepted) throw new Error("first run refused");
    expect(runCoordinator.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] }).accepted).toBe(false);
    expect(m.closeAllBrowsers).not.toHaveBeenCalled();
    d.resolve(new Map([["premier-league", scrapeResult("premier-league", first.run.runId)]]));
    await first.run.done;
    expect(m.runScrapeCycle).toHaveBeenCalledTimes(1);
    // The cycle closes the browsers; the scheduler never does
    expect(m.closeAllBrowsers).not.toHaveBeenCalled();
  });

  it("passes run id and signal down; isRunning covers every trigger; admin results stay out of lastResults (Review Focus 2)", async () => {
    const full = runCoordinator.start({ trigger: "interval", leagues: ["premier-league"], bookmakers: [...CONFIG.BOOKMAKERS] });
    if (!full.accepted) throw new Error("full run refused");
    await full.run.done;
    const r = runCoordinator.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["forbet"] });
    if (!r.accepted) throw new Error("admin run refused");
    expect(getSchedulerStatus().isRunning).toBe(true);
    await r.run.done;
    expect(m.runScrapeCycle).toHaveBeenLastCalledWith(["premier-league"], ["forbet"],
      expect.objectContaining({ runIds: r.run.runIds, signal: expect.any(AbortSignal) }));
    expect(getSchedulerStatus().lastResults["premier-league"].runId).toBe(full.run.runId);
    expect(getSchedulerStatus().lastAdminResults["premier-league"].runId).toBe(r.run.runId);
    expect(getSchedulerStatus().isRunning).toBe(false);
  });

  it("a fresh boot schedules the first interval run and starts no scrape; a startup run waits 120 s for the DB", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") });
    try {
      const T0 = Date.now();
      sp.getStalestOkRunAt.mockResolvedValue(new Date("2026-11-07T09:40:00.000Z"));
      sp.decideStartupScrape.mockReturnValueOnce({ firstTrigger: "interval", firstDelayMs: 2_400_000, reason: "auto: last OK run 20 min ago < 60 min" });
      void startScheduler();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(m.runScrapeCycle).not.toHaveBeenCalled();
      expect(getSchedulerStatus().nextRun!.getTime()).toBe(T0 + 2_400_000);
      stopScheduler();

      sp.decideStartupScrape.mockReturnValueOnce({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "auto: no OK run on record" });
      void startScheduler();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(m.runScrapeCycle).toHaveBeenCalledWith(["premier-league"], undefined, expect.objectContaining({ dbWaitMs: 120_000 }));
      await runCoordinator.whenIdle();
      stopScheduler();
    } finally {
      vi.useRealTimers();
    }
  });
});
