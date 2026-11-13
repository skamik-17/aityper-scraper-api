import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullOfferAggregatedResult } from "../../scrapers/aggregator.js";
import { outcome, RUN_ID } from "../../__tests__/helpers/run-fixtures.js";
import { isOkRunStatus, type BookmakerRunOutcome } from "../run-outcome.js";

const m = vi.hoisted(() => ({
  runFullOfferCycle: vi.fn(),
  runAllFullOfferScrapers: vi.fn(),
  closeAllBrowsers: vi.fn(),
  probeDatabase: vi.fn(),
  waitForDatabase: vi.fn(),
  ensureMarketTypesSynced: vi.fn(),
  insertBookmakerRunOutcomes: vi.fn(),
  getRecentRunRows: vi.fn(),
}));

vi.mock("../../scrapers/aggregator.js", async () => ({
  runFullOfferCycle: m.runFullOfferCycle,
  runAllFullOfferScrapers: m.runAllFullOfferScrapers,
  closeAllBrowsers: m.closeAllBrowsers,
}));
vi.mock("../../config/database.js", async () => ({ probeDatabase: m.probeDatabase, waitForDatabase: m.waitForDatabase, getSupabase: vi.fn() }));
vi.mock("../market-types-sync.js", async () => ({ ensureMarketTypesSynced: m.ensureMarketTypesSynced }));
vi.mock("../../repositories/scraper-run-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/scraper-run-repository.js")>()),
  insertBookmakerRunOutcomes: m.insertBookmakerRunOutcomes,
  getRecentRunRows: m.getRecentRunRows,
}));

import { runScrapeAndPersist, runScrapeCycle } from "../scraper-service.js";
import { scraperHealth } from "../scraper-health.js";

const ID_PL = "11111111-1111-4111-8111-111111111111";
const ID_LL = "22222222-2222-4222-8222-222222222222";

function aggregatedFor(league: string, outcomes: BookmakerRunOutcome[]): FullOfferAggregatedResult {
  const ok = outcomes.filter((o) => isOkRunStatus(o.status));
  return {
    runId: outcomes[0]?.runId ?? RUN_ID,
    league,
    startedAt: new Date("2026-11-06T16:00:00.350Z"),
    completedAt: new Date("2026-11-06T16:02:49.798Z"),
    totalDuration: 169448,
    results: new Map(),
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

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scraperHealth.reset();
  for (const fn of Object.values(m)) fn.mockReset();
  m.probeDatabase.mockResolvedValue({ ok: true });
  m.ensureMarketTypesSynced.mockResolvedValue(true);
  m.insertBookmakerRunOutcomes.mockResolvedValue(undefined);
  m.getRecentRunRows.mockResolvedValue([]);
  m.closeAllBrowsers.mockResolvedValue(undefined);
  m.runFullOfferCycle.mockImplementation(async (req: { leagues: string[] }) =>
    new Map(req.leagues.map((l) => [l, aggregatedFor(l, [outcome({ bookmaker: "betclic", league: l })])])));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("runScrapeCycle", () => {
  it("probes once for two leagues and persists per league", async () => {
    m.runFullOfferCycle.mockResolvedValue(new Map([
      ["premier-league", aggregatedFor("premier-league", [outcome({ bookmaker: "betclic", marketsSaved: 3150 })])],
      ["laliga", aggregatedFor("laliga", [outcome({ runId: ID_LL, league: "laliga", bookmaker: "betclic", marketsSaved: 2000 })])],
    ]));
    const r = await runScrapeCycle(["premier-league", "laliga"]);
    expect([m.probeDatabase.mock.calls.length, m.ensureMarketTypesSynced.mock.calls.length, m.insertBookmakerRunOutcomes.mock.calls.length]).toEqual([1, 1, 2]);
    expect(logSpy.mock.calls.filter(([l]) => String(l).startsWith("[ScrapeRun]"))).toHaveLength(2);
    expect([...r.keys()]).toEqual(["premier-league", "laliga"]);
    expect(m.closeAllBrowsers).toHaveBeenCalledTimes(1);
    expect(r.get("laliga")!.marketsSaved).toBe(2000);
  });

  it("an unreachable database aborts every league before any scraper starts, with per-league ids and records", async () => {
    m.probeDatabase.mockResolvedValue({ ok: false, error: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)" });
    const r = await runScrapeCycle(["premier-league", "laliga"], undefined, { runIds: { "premier-league": ID_PL, laliga: ID_LL } });
    expect(m.runFullOfferCycle).not.toHaveBeenCalled();
    expect([...r.values()].map((x) => [x.aborted, x.runId])).toEqual([["db_unreachable", ID_PL], ["db_unreachable", ID_LL]]);
    expect(errorSpy.mock.calls.flat().filter((l) => String(l).startsWith("[ALERT] scrape run ABORTED"))).toHaveLength(2);
    expect([scraperHealth.getLastAbort("premier-league")?.league, scraperHealth.getLastAbort("laliga")?.league]).toEqual(["premier-league", "laliga"]);
  });

  it("runScrapeAndPersist(league) is the one-league cycle with the given run id", async () => {
    await runScrapeAndPersist("premier-league", ["forbet"], true, { runId: ID_PL });
    expect(m.runFullOfferCycle).toHaveBeenCalledWith(expect.objectContaining({ leagues: ["premier-league"], bookmakers: ["forbet"], runIds: { "premier-league": ID_PL } }));
  });

  it("closeBrowsers: false leaves the browser pool to the caller", async () => {
    await runScrapeCycle(["premier-league"], undefined, { closeBrowsers: false });
    expect(m.closeAllBrowsers).not.toHaveBeenCalled();
  });
});
