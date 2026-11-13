import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullOfferAggregatedResult } from "../../scrapers/aggregator.js";
import type { FullOfferScraperResult } from "../../types/full-offer.js";
import type { PolishBookmaker } from "../../config/index.js";
import { isOkRunStatus, type BookmakerRunOutcome } from "../run-outcome.js";
import { outcome, RUN_ID } from "../../__tests__/helpers/run-fixtures.js";

const m = vi.hoisted(() => ({
  runAllFullOfferScrapers: vi.fn(),
  closeAllBrowsers: vi.fn(),
  probeDatabase: vi.fn(),
  waitForDatabase: vi.fn(),
  ensureMarketTypesSynced: vi.fn(),
  insertBookmakerRunOutcomes: vi.fn(),
  getRecentRunRows: vi.fn(),
}));

vi.mock("../../scrapers/aggregator.js", async () => ({
  runAllFullOfferScrapers: m.runAllFullOfferScrapers,
  closeAllBrowsers: m.closeAllBrowsers,
}));
vi.mock("../../config/database.js", async () => ({
  probeDatabase: m.probeDatabase,
  waitForDatabase: m.waitForDatabase,
  getSupabase: vi.fn(),
}));
vi.mock("../market-types-sync.js", async () => ({ ensureMarketTypesSynced: m.ensureMarketTypesSynced }));
// Partial mock: toScraperRunInsert stays real, only the DB calls are stubbed.
vi.mock("../../repositories/scraper-run-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/scraper-run-repository.js")>()),
  insertBookmakerRunOutcomes: m.insertBookmakerRunOutcomes,
  getRecentRunRows: m.getRecentRunRows,
}));

import { runScrapeAndPersist, toScrapeStats } from "../scraper-service.js";
import { scraperHealth } from "../scraper-health.js";
import { toScraperRunInsert } from "../../repositories/scraper-run-repository.js";

const FORBET_ERR =
  "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";
const SAVE_THREW = "Save failed: Cannot read properties of undefined (reading 'length')";
const BETTERS_ERR = "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
const DB_DOWN = "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";
const ABORT_LINE = `[ALERT] scrape run ABORTED for premier-league: database unreachable - ${DB_DOWN}`;

/** A FullOfferAggregatedResult built from outcomes only; `results` is passed in when a test needs it. */
function aggregated(
  outcomes: BookmakerRunOutcome[],
  results: Map<PolishBookmaker, FullOfferScraperResult> = new Map(),
): FullOfferAggregatedResult {
  const ok = outcomes.filter((o) => isOkRunStatus(o.status));
  return {
    runId: outcomes[0]?.runId ?? RUN_ID,
    league: "premier-league",
    startedAt: new Date("2026-11-06T16:00:00.350Z"),
    completedAt: new Date("2026-11-06T16:02:49.798Z"),
    totalDuration: 169448,
    results,
    allMatches: [],
    outcomes,
    summary: {
      successCount: ok.length,
      errorCount: outcomes.length - ok.length,
      totalMatchesFound: outcomes.reduce((sum, o) => sum + o.matchesFound, 0),
      totalMarketsFound: 0,
      totalMarketsSaved: ok.reduce((sum, o) => sum + o.marketsSaved, 0),
    },
  };
}

const scrapeRunLines = () => logSpy.mock.calls.filter(([l]) => String(l).startsWith("[ScrapeRun]"));
const errorText = () => errorSpy.mock.calls.flat().join("\n");

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // scraperHealth is a module singleton: start every test from an empty history.
  scraperHealth.reset();
  vi.clearAllMocks();
  for (const fn of Object.values(m)) fn.mockReset();
  m.probeDatabase.mockResolvedValue({ ok: true });
  m.waitForDatabase.mockResolvedValue({ ok: true });
  m.ensureMarketTypesSynced.mockResolvedValue(true);
  m.runAllFullOfferScrapers.mockResolvedValue(
    aggregated([outcome({ bookmaker: "forbet", status: "persist_failed", marketsSaved: 0, error: FORBET_ERR })]),
  );
  m.insertBookmakerRunOutcomes.mockResolvedValue(undefined);
  m.getRecentRunRows.mockResolvedValue([]);
  m.closeAllBrowsers.mockResolvedValue(undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("runScrapeAndPersist: health and errors[] follow the outcomes", () => {
  it("reports a bookmaker that saved nothing in errors[] and as failing, even when its scraper result says success", async () => {
    // Real shape after Task 3: the scraper succeeded, so `results` holds success:true, but no market was saved.
    const results = new Map<PolishBookmaker, FullOfferScraperResult>([
      ["forbet", { success: true, bookmaker: "forbet", league: "premier-league", matches: [], duration: 7171 }],
    ]);
    m.runAllFullOfferScrapers.mockResolvedValueOnce(
      aggregated(
        [
          outcome({ bookmaker: "forbet", status: "persist_failed", marketsFound: 5995, marketsSaved: 0, error: FORBET_ERR }),
          outcome({ bookmaker: "betclic", status: "success", marketsSaved: 3150 }),
        ],
        results,
      ),
    );

    const r = await runScrapeAndPersist("premier-league", ["forbet", "betclic"]);

    expect(r).toMatchObject({ successCount: 1, errorCount: 1 });
    expect(r.errors).toEqual([`forbet: ${FORBET_ERR}`]);
    expect(scraperHealth.getHealth("forbet")).toMatchObject({ status: "failing", successRate: 0, lastError: FORBET_ERR });
    expect(scraperHealth.getHealth("betclic")).toMatchObject({ status: "healthy", successRate: 100, lastError: null });
  });

  it("reports a save that threw ('Save failed: ...') in errors[] and in health lastError", async () => {
    m.runAllFullOfferScrapers.mockResolvedValueOnce(
      aggregated([outcome({ bookmaker: "lvbet", status: "persist_failed", marketsSaved: 0, error: SAVE_THREW })]),
    );

    const r = await runScrapeAndPersist("premier-league", ["lvbet"]);

    expect(r.errors).toContain(`lvbet: ${SAVE_THREW}`);
    expect(scraperHealth.getHealth("lvbet")).toMatchObject({ status: "failing", lastError: SAVE_THREW });
  });

  it("counts an empty run as a failure (owner decision 6) and keeps partial runs healthy", async () => {
    m.runAllFullOfferScrapers.mockResolvedValueOnce(
      aggregated([
        outcome({ bookmaker: "etoto", status: "empty", matchesFound: 0, error: "Scraper reported success with 0 matches" }),
        outcome({ bookmaker: "fortuna", status: "partial", marketsSaved: 12897, error: "Normalization failed for A vs B: x" }),
        outcome({ bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: "No events found from API" }),
      ]),
    );

    const r = await runScrapeAndPersist("premier-league", ["etoto", "fortuna", "betters"]);

    expect(r.errors).toEqual([
      "etoto: Scraper reported success with 0 matches",
      "betters: No events found from API",
    ]);
    expect(scraperHealth.getHealth("etoto")).toMatchObject({ status: "failing", successRate: 0 });
    expect(scraperHealth.getHealth("fortuna")).toMatchObject({ status: "healthy", successRate: 100, lastError: null });
    expect(scraperHealth.getHealth("betters")).toMatchObject({ status: "failing", lastError: "No events found from API" });
  });

  it("records the outcome's duration for a successful run", async () => {
    m.runAllFullOfferScrapers.mockResolvedValueOnce(
      aggregated([outcome({ bookmaker: "superbet", status: "success", marketsSaved: 13353, durationMs: 42_000 })]),
    );

    await runScrapeAndPersist("premier-league", ["superbet"]);

    expect(scraperHealth.getHealth("superbet").avgDuration).toBe(42_000);
  });
});

describe("runScrapeAndPersist: DB preflight and run integrity", () => {
  it("a refused league carries the coordinator's run id", async () => {
    m.probeDatabase.mockResolvedValue({ ok: false, error: DB_DOWN });
    const r = await runScrapeAndPersist("premier-league", ["forbet"], false, { runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11" });
    expect(r).toMatchObject({ runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", aborted: "db_unreachable", outcomes: [] });
  });

  it("aborts before launching any scraper when the database is unreachable", async () => {
    m.probeDatabase.mockResolvedValue({ ok: false, error: DB_DOWN });
    const r = await runScrapeAndPersist("premier-league", ["forbet"]);
    expect(m.runAllFullOfferScrapers).not.toHaveBeenCalled();
    expect(m.insertBookmakerRunOutcomes).not.toHaveBeenCalled();
    expect(r).toMatchObject({ aborted: "db_unreachable", successCount: 0, errorCount: 1, outcomes: [] });
    expect(errorSpy).toHaveBeenCalledWith(ABORT_LINE);
  });

  it("an aborted run touches nothing else and is remembered", async () => {
    m.probeDatabase.mockResolvedValue({ ok: false, error: DB_DOWN });
    const r = await runScrapeAndPersist("premier-league");
    // Every configured bookmaker counts as an error, so the scheduler logs "0 success, 14 errors".
    expect(r).toMatchObject({ errorCount: 14, marketsSaved: 0, uniqueMatches: 0, errors: [ABORT_LINE] });
    expect(m.ensureMarketTypesSynced).not.toHaveBeenCalled();
    expect(m.getRecentRunRows).not.toHaveBeenCalled();
    expect(m.closeAllBrowsers).not.toHaveBeenCalled();
    expect(scrapeRunLines()).toHaveLength(0);
    expect(errorSpy.mock.calls.filter(([l]) => String(l).startsWith("[ALERT]"))).toEqual([[ABORT_LINE]]);
    expect(scraperHealth.getLastAbort()).toEqual({ league: "premier-league", reason: DB_DOWN, at: r.completedAt.toISOString() });
  });

  it("waits for the database when dbWaitMs is given", async () => {
    await runScrapeAndPersist("premier-league", undefined, false, { dbWaitMs: 120_000 });
    expect(m.waitForDatabase).toHaveBeenCalledWith(120_000);
    expect(m.probeDatabase).not.toHaveBeenCalled();
  });

  it("aborts when the database never comes up during the wait", async () => {
    m.waitForDatabase.mockResolvedValue({ ok: false, error: DB_DOWN });
    const r = await runScrapeAndPersist("premier-league", undefined, false, { dbWaitMs: 120_000 });
    expect(r.aborted).toBe("db_unreachable");
    expect(m.runAllFullOfferScrapers).not.toHaveBeenCalled();
  });

  it("syncs market_types before scraping", async () => {
    await runScrapeAndPersist("premier-league", ["forbet"]);
    expect(m.ensureMarketTypesSynced.mock.invocationCallOrder[0]).toBeLessThan(
      m.runAllFullOfferScrapers.mock.invocationCallOrder[0],
    );
  });

  it("continues with a warning when the market_types sync fails", async () => {
    m.ensureMarketTypesSynced.mockResolvedValue(false);
    await runScrapeAndPersist("premier-league", ["forbet"]);
    expect(warnSpy).toHaveBeenCalledWith("[ScraperService] market_types sync failed - continuing");
    expect(m.runAllFullOfferScrapers).toHaveBeenCalledTimes(1);
  });

  it("persists one row per outcome and reports honest counts", async () => {
    m.runAllFullOfferScrapers.mockResolvedValue(
      aggregated([
        outcome({ bookmaker: "forbet", status: "persist_failed", marketsSaved: 0, error: FORBET_ERR }),
        outcome({ bookmaker: "betclic", status: "success", marketsSaved: 3150 }),
      ]),
    );
    const r = await runScrapeAndPersist("premier-league", ["forbet", "betclic"]);
    expect(m.insertBookmakerRunOutcomes).toHaveBeenCalledWith([
      expect.objectContaining({ bookmaker: "forbet", status: "persist_failed" }),
      expect.objectContaining({ bookmaker: "betclic", status: "success" }),
    ]);
    expect(r).toMatchObject({ successCount: 1, errorCount: 1, marketsSaved: 3150, aborted: null });
    expect(r.outcomes.map((o) => o.bookmaker)).toEqual(["forbet", "betclic"]);
    expect(scrapeRunLines()).toEqual([
      [
        "[ScrapeRun] premier-league run=440d2fc6 finished=2026-11-06T16:02:49.798Z ok=1/2 matches=40 saved=3150 failed=forbet:persist_failed",
      ],
    ]);
    expect(errorText()).toContain("[ALERT] premier-league: 1 bookmaker(s) scraped but NOT saved (forbet) - " + FORBET_ERR);
  });

  it("still resolves when scraper_runs cannot be written (Review Focus 1)", async () => {
    m.insertBookmakerRunOutcomes.mockRejectedValue(
      new Error("scraper_runs insert failed: TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)"),
    );
    m.getRecentRunRows.mockRejectedValue(new Error("down"));
    const r = await runScrapeAndPersist("premier-league", ["forbet"]);
    expect(r.errors).toContain("scraper_runs insert failed: TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)");
    expect(errorText()).toContain("[ScraperService] scraper_runs not persisted:");
    expect(scraperHealth.getHealth("forbet")).toMatchObject({ consecutiveFailures: 1, lastStatus: "persist_failed" });
    expect(scrapeRunLines()).toHaveLength(1);
  });

  it("alerts from in-memory history when the insert fails but reads work (Review Focus 2)", async () => {
    scraperHealth.recordOutcome(
      outcome({ runId: "run-1400", bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR, startedAt: new Date("2026-11-06T14:00:00.000Z") }),
    );
    scraperHealth.recordOutcome(
      outcome({ runId: "run-1500", bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR, startedAt: new Date("2026-11-06T15:00:00.000Z") }),
    );
    // current run, 16:00:00.350Z
    m.runAllFullOfferScrapers.mockResolvedValue(
      aggregated([outcome({ bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR })]),
    );
    m.insertBookmakerRunOutcomes.mockRejectedValue(
      new Error(
        "scraper_runs insert failed: Could not find the 'run_id' column of 'scraper_runs' in the schema cache [PGRST204] (apply supabase/migrations/11_scraper_runs_observability.sql)",
      ),
    );
    m.getRecentRunRows.mockResolvedValue([]); // select * still works, but holds no current-run rows
    await runScrapeAndPersist("premier-league", ["betters"]);
    expect(errorText()).toContain(
      `[ALERT] betters (premier-league) failed 3 consecutive runs since 2026-11-06T14:00:00.000Z: ${BETTERS_ERR}`,
    );
  });

  it("reads the league's DB history within the status window and counts it in the streak", async () => {
    const earlier = (runId: string, startedAt: string) =>
      toScraperRunInsert(
        outcome({ runId, bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR, startedAt: new Date(startedAt) }),
      );
    // A process restart: no in-memory history, the two earlier failures are only in scraper_runs.
    m.getRecentRunRows.mockResolvedValue([
      { ...earlier("7067e5f0-35c2-4bae-a045-5501547505a7", "2026-11-06T15:00:00.000Z"), started_at: "2026-11-06T15:00:00+00:00" },
      { ...earlier("1c4bc4c1-6a8e-4c38-9a2b-2f8f0f6c8c11", "2026-11-06T14:00:00.000Z"), started_at: "2026-11-06T14:00:00+00:00" },
    ]);
    m.runAllFullOfferScrapers.mockResolvedValue(
      aggregated([outcome({ bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR })]),
    );
    await runScrapeAndPersist("premier-league", ["betters"]);
    expect(m.getRecentRunRows).toHaveBeenCalledWith("premier-league", 700);
    expect(errorText()).toContain(
      `[ALERT] betters (premier-league) failed 3 consecutive runs since 2026-11-06T14:00:00.000Z: ${BETTERS_ERR}`,
    );
  });

  it("does not count the DB copy of the current run twice", async () => {
    const failed = (runId: string, startedAt: string) =>
      toScraperRunInsert(
        outcome({ runId, bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR, startedAt: new Date(startedAt) }),
      );
    // The insert worked, so the read returns the current run as well (with PostgREST's +00:00 shape).
    m.getRecentRunRows.mockResolvedValue([
      { ...failed(RUN_ID, "2026-11-06T16:00:00.350Z"), started_at: "2026-11-06T16:00:00.35+00:00" },
      { ...failed("7067e5f0-35c2-4bae-a045-5501547505a7", "2026-11-06T15:00:00.000Z"), started_at: "2026-11-06T15:00:00+00:00" },
      { ...failed("1c4bc4c1-6a8e-4c38-9a2b-2f8f0f6c8c11", "2026-11-06T14:00:00.000Z"), started_at: "2026-11-06T14:00:00+00:00" },
    ]);
    m.runAllFullOfferScrapers.mockResolvedValue(
      aggregated([outcome({ bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR })]),
    );
    await runScrapeAndPersist("premier-league", ["betters"]);
    // 3 runs, not 4: the streak line fires exactly at the threshold.
    expect(errorText()).toContain("[ALERT] betters (premier-league) failed 3 consecutive runs since 2026-11-06T14:00:00.000Z");
  });

  it("closes the browser pool after the run only when asked to", async () => {
    await runScrapeAndPersist("premier-league", ["forbet"]);
    expect(m.closeAllBrowsers).toHaveBeenCalledTimes(1);
    const summaryCall = logSpy.mock.calls.findIndex(([l]) => String(l).startsWith("[ScrapeRun]"));
    expect(summaryCall).toBeGreaterThanOrEqual(0);
    expect(logSpy.mock.invocationCallOrder[summaryCall]).toBeLessThan(m.closeAllBrowsers.mock.invocationCallOrder[0]);

    m.closeAllBrowsers.mockClear();
    await runScrapeAndPersist("premier-league", ["forbet"], false);
    expect(m.closeAllBrowsers).not.toHaveBeenCalled();
  });
});

describe("toScrapeStats", () => {
  it("adds saved markets, the abort state and the failed bookmakers to the /api/health stats", async () => {
    m.runAllFullOfferScrapers.mockResolvedValue(
      aggregated([
        outcome({ bookmaker: "forbet", status: "persist_failed", marketsSaved: 0, error: FORBET_ERR }),
        outcome({ bookmaker: "betclic", status: "success", marketsSaved: 3150 }),
        outcome({ bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR }),
      ]),
    );
    const r = await runScrapeAndPersist("premier-league", ["forbet", "betclic", "betters"]);
    expect(toScrapeStats(r)).toEqual({
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt.toISOString(),
      duration: Math.round(r.duration / 1000),
      successCount: 1,
      errorCount: 2,
      uniqueMatches: 0,
      marketsScraped: 0,
      marketsSaved: 3150,
      aborted: null,
      failed: [
        { bookmaker: "forbet", status: "persist_failed", error: FORBET_ERR },
        { bookmaker: "betters", status: "scrape_failed", error: BETTERS_ERR },
      ],
    });
  });

  it("reports an aborted run", async () => {
    m.probeDatabase.mockResolvedValue({ ok: false, error: DB_DOWN });
    const stats = toScrapeStats(await runScrapeAndPersist("premier-league", ["forbet"]));
    expect(stats).toMatchObject({ aborted: "db_unreachable", successCount: 0, errorCount: 1, marketsSaved: 0, failed: [] });
  });
});
