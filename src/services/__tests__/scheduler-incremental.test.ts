/**
 * Plan 10 Task 5: the scheduler ticks every INCREMENTAL_PASS_MINUTES when incremental
 * bookmakers are set, runs the full set only on the hourly tick, and keeps incremental
 * ticks out of lastResults.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../config/index.js";
import type { ScrapeResult } from "../scraper-service.js";

const m = vi.hoisted(() => ({
  runScrapeCycle: vi.fn(),
  cfg: { bookmakers: new Set(["forbet"]), passMinutes: 10, dryRun: false, error: null as string | null },
  decide: vi.fn(),
  stalest: vi.fn(),
}));
vi.mock("../scraper-service.js", async () => ({ runScrapeAndPersist: vi.fn(), runScrapeCycle: m.runScrapeCycle }));
vi.mock("../../scrapers/aggregator.js", async () => ({ closeAllBrowsers: vi.fn() }));
vi.mock("../retention-service.js", async () => ({ runRetentionCleanup: vi.fn() }));
vi.mock("node-cron", async () => ({ default: { schedule: () => ({ stop: vi.fn() }) } }));
vi.mock("../tsdb-sync-service.js", async () => ({ syncStaleLeagues: vi.fn(), syncAllEnabledLeagues: vi.fn() }));
vi.mock("../../config/database.js", async () => ({ waitForDatabase: vi.fn() }));
vi.mock("../../repositories/odds-repository.js", async () => ({ cleanupOldOdds: vi.fn() }));
vi.mock("../../repositories/scraper-run-repository.js", async () => ({ deleteScraperRunsOlderThan: vi.fn() }));
vi.mock("../startup-policy.js", async () => ({ decideStartupScrape: m.decide, getStalestOkRunAt: m.stalest, STARTUP_DELAY_MS: 5_000 }));
vi.mock("../../config/incremental.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/incremental.js")>()),
  getIncrementalConfig: () => m.cfg,
}));

vi.mock("../league-window.js", async () => ({
  refreshLeagueWindows: async () => {},
  scheduledLeagues: (leagues: readonly string[]) => [...leagues],
}));
import { getSchedulerStatus, runCoordinator, startScheduler, stopScheduler } from "../scheduler-service.js";

const MIN = 60_000;
let logs: string[];

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") });
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.runScrapeCycle.mockReset();
  m.runScrapeCycle.mockImplementation(async (leagues: string[], _bm: unknown, o?: { runIds?: Record<string, string> }) =>
    new Map(leagues.map((l) => [l, { runId: o?.runIds?.[l] ?? "none", league: l, outcomes: [] } as unknown as ScrapeResult])));
  // Last full run 20 min ago: the startup policy skips the startup scrape
  m.stalest.mockResolvedValue(new Date("2026-11-07T09:40:00.000Z"));
  m.decide.mockReturnValue({ firstTrigger: "interval", firstDelayMs: 40 * MIN, reason: "auto: last OK run 20 min ago < 60 min" });
});
afterEach(async () => {
  stopScheduler();
  await runCoordinator.whenIdle();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scheduler with incremental bookmakers", () => {
  it("logs the config, ticks every pass interval and runs the full set only when the hour is due", async () => {
    const intervalMs = CONFIG.SCRAPE_INTERVAL_MINUTES * MIN;
    await startScheduler();
    expect(logs).toContain("[Incremental] bookmakers=forbet passMinutes=10 dryRun=false");
    // The first tick comes after one pass interval, not after the full interval
    expect(getSchedulerStatus().nextRun!.getTime()).toBe(Date.now() + 10 * MIN);

    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(m.runScrapeCycle).toHaveBeenCalledTimes(1);
    expect(m.runScrapeCycle.mock.calls[0][1]).toEqual(["forbet"]);
    expect(m.runScrapeCycle.mock.calls[0][2]).toMatchObject({ modes: { forbet: "incremental" }, recordOutcomes: false });
    // An incremental tick never replaces the health view of the last full run
    expect(getSchedulerStatus().lastResults).toEqual({});

    // Ticks continue every ~10 min until the full interval since 09:40 has passed
    await vi.advanceTimersByTimeAsync(intervalMs);
    // The hourly tick records outcomes: recordOutcomes is absent (= true), as on every non-incremental run
    const hourly = m.runScrapeCycle.mock.calls.filter((c) => c[2]?.modes && c[2].recordOutcomes !== false);
    expect(hourly).toHaveLength(1);
    expect(hourly[0][1]).toEqual([...CONFIG.BOOKMAKERS]);
    expect(hourly[0][2].modes.forbet).toBe("incremental");
    expect(hourly[0][2].modes.fortuna).toBe("full");
    expect(Object.keys(getSchedulerStatus().lastResults)).toEqual([...CONFIG.ENABLED_LEAGUES]);
  });

  it("a startup run counts as the full run", async () => {
    m.decide.mockReturnValue({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "auto: no OK run on record" });
    await startScheduler();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.runScrapeCycle.mock.calls[0][1]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(15 * MIN);
    const second = m.runScrapeCycle.mock.calls[1];
    expect(second[1]).toEqual(["forbet"]);
    expect(second[2]).toMatchObject({ recordOutcomes: false });
  });
});
