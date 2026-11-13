import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../__tests__/helpers/run-fixtures.js";
import { CONFIG } from "../../config/index.js";
import type { ScrapeResult } from "../scraper-service.js";

const m = vi.hoisted(() => ({
  runScrapeAndPersist: vi.fn(),
  closeAllBrowsers: vi.fn(),
  cronJobs: [] as Array<{ expr: string; fn: () => unknown }>,
}));

vi.mock("../scraper-service.js", async () => ({ runScrapeAndPersist: m.runScrapeAndPersist }));
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

import { getSchedulerStatus, runCoordinator } from "../scheduler-service.js";

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
  m.runScrapeAndPersist.mockImplementation(async (league: string, _bm: unknown, _close: boolean, options?: { runId?: string }) =>
    scrapeResult(league, options?.runId ?? "none"));
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
    const d = deferred<ScrapeResult>();
    m.runScrapeAndPersist.mockReturnValueOnce(d.promise);
    const first = runCoordinator.start({ trigger: "interval", leagues: ["premier-league"], bookmakers: [...CONFIG.BOOKMAKERS] });
    if (!first.accepted) throw new Error("first run refused");
    expect(runCoordinator.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] }).accepted).toBe(false);
    expect(m.closeAllBrowsers).not.toHaveBeenCalled();
    d.resolve(scrapeResult("premier-league", first.run.runId));
    await first.run.done;
    expect(m.runScrapeAndPersist).toHaveBeenCalledTimes(1);
    expect(m.closeAllBrowsers).toHaveBeenCalledTimes(1);
  });

  it("passes run id and signal down; isRunning covers every trigger; admin results stay out of lastResults (Review Focus 2)", async () => {
    const full = runCoordinator.start({ trigger: "interval", leagues: ["premier-league"], bookmakers: [...CONFIG.BOOKMAKERS] });
    if (!full.accepted) throw new Error("full run refused");
    await full.run.done;
    const r = runCoordinator.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["forbet"] });
    if (!r.accepted) throw new Error("admin run refused");
    expect(getSchedulerStatus().isRunning).toBe(true);
    await r.run.done;
    expect(m.runScrapeAndPersist).toHaveBeenLastCalledWith("premier-league", ["forbet"], false,
      expect.objectContaining({ runId: r.run.runIds["premier-league"], signal: expect.any(AbortSignal) }));
    expect(getSchedulerStatus().lastResults["premier-league"].runId).toBe(full.run.runId);
    expect(getSchedulerStatus().lastAdminResults["premier-league"].runId).toBe(r.run.runId);
    expect(getSchedulerStatus().isRunning).toBe(false);
  });
});
