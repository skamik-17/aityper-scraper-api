/**
 * Plan 10 Task 5: incremental ticks through the real cycle (runScrapeCycle ->
 * runFullOfferCycle -> withScrapeMode -> runIncrementalPass -> finalize).
 * Outcomes, [ScrapeRun] and alerts stay in hourly units (Review Focus 6).
 * Faked: the 14 scrapers, the save, the DB edges and the detail-state repository.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRef } from "../../scrapers/shared/incremental/incremental-scraper.js";
import type { FullMatchOffer } from "../../types/full-offer.js";

const m = vi.hoisted(() => {
  const BMS = ["sts", "fortuna", "betclic", "superbet", "lvbet", "fuksiarz", "betfan", "totalbet", "forbet", "etoto", "betters", "lebull", "betcris", "pzbuk"];
  const scrapers = Object.fromEntries(
    BMS.map((bm) => [
      bm,
      {
        bookmaker: bm,
        transport: "http",
        detailConcurrency: 2,
        transportStats: () => ({ http: { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} } }),
        scrapeFullOffer: vi.fn(),
        listEvents: vi.fn(),
        fetchEvent: vi.fn(),
        cleanup: vi.fn(async () => {}),
      },
    ]),
  );
  return {
    scrapers,
    save: vi.fn(),
    loadState: vi.fn(),
    recordPass: vi.fn(),
    insertOutcomes: vi.fn(),
    getRecentRunRows: vi.fn(),
    probeDatabase: vi.fn(),
    cfg: { bookmakers: new Set(["forbet", "etoto"]), passMinutes: 10, dryRun: false, error: null as string | null },
  };
});

vi.mock("../../scrapers/bookmakers/index.js", async () => Object.fromEntries(Object.entries(m.scrapers).map(([bm, s]) => [`${bm}Scraper`, s])));
vi.mock("../scrape-helpers.js", async () => ({ normalizeAndSaveMatches: m.save }));
vi.mock("../../repositories/incremental-state-repository.js", async () => ({
  getIncrementalState: m.loadState,
  recordIncrementalPass: m.recordPass,
}));
vi.mock("../../config/incremental.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/incremental.js")>()),
  getIncrementalConfig: () => m.cfg,
}));
vi.mock("../../config/database.js", async () => ({ probeDatabase: m.probeDatabase, waitForDatabase: vi.fn(), getSupabase: vi.fn() }));
vi.mock("../market-types-sync.js", async () => ({ ensureMarketTypesSynced: async () => true }));
vi.mock("../retention-service.js", async () => ({ runRetentionCleanup: vi.fn() }));
vi.mock("../../repositories/scraper-run-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/scraper-run-repository.js")>()),
  insertBookmakerRunOutcomes: m.insertOutcomes,
  getRecentRunRows: m.getRecentRunRows,
}));
vi.mock("../../utils/proc-sampler.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/proc-sampler.js")>()),
  readProcessTree: async () => ({ rootRssBytes: 300 * 2 ** 20, chromium: [] }),
}));

import { generateMatchId } from "../../repositories/full-offer-repository.js";
import { incrementalHourLedger } from "../incremental/incremental-pass.js";
import { scraperHealth } from "../scraper-health.js";
import { runScrapeCycle } from "../scraper-service.js";

const PL = "premier-league";
const FAR = "2030-01-01T15:00:00.000Z";
const TEAMS: Array<[string, string]> = [["Leeds United", "Tottenham Hotspur"], ["Arsenal", "Chelsea"]];

const refOf = (bm: string, i: number, fp: string | null = `fp${i}`): EventRef => ({
  eventId: `${bm}-${i}`,
  homeTeam: TEAMS[i][0],
  awayTeam: TEAMS[i][1],
  kickoff: FAR,
  fingerprint: fp,
  eventUrl: `https://x/${bm}-${i}`,
  listing: null,
});
const offerOf = (bm: string, r: EventRef): FullMatchOffer => ({
  matchId: r.eventId,
  bookmaker: bm as never,
  homeTeam: r.homeTeam,
  awayTeam: r.awayTeam,
  eventUrl: r.eventUrl,
  markets: [{ name: "1X2", selections: [{ name: "1", odds: 2 }] } as never],
  scrapedAt: new Date(),
});

let out: string[];
const lines = (prefix: string) => out.filter((l) => l.startsWith(prefix));

beforeEach(() => {
  scraperHealth.reset();
  incrementalHourLedger.take("forbet", PL);
  incrementalHourLedger.take("etoto", PL);
  for (const [bm, s] of Object.entries(m.scrapers)) {
    s.listEvents.mockReset();
    s.listEvents.mockResolvedValue([]);
    s.fetchEvent.mockReset();
    s.fetchEvent.mockImplementation(async (_l: string, r: EventRef) => offerOf(bm, r));
    s.scrapeFullOffer.mockReset();
    s.scrapeFullOffer.mockImplementation(async (league: string) => ({ success: true, bookmaker: bm, league, matches: [] }));
  }
  m.save.mockReset();
  m.save.mockImplementation(async (matches: FullMatchOffer[]) => ({ matchesProcessed: matches.length, marketsNormalized: 40, marketsSaved: 40, errors: [] }));
  m.loadState.mockReset();
  m.loadState.mockResolvedValue(new Map());
  m.recordPass.mockReset();
  m.recordPass.mockResolvedValue({ stamped: 0, confirmed: 0, notConfirmed: 0, confirmedRows: 0 });
  m.insertOutcomes.mockReset();
  m.insertOutcomes.mockResolvedValue(undefined);
  m.getRecentRunRows.mockReset();
  m.getRecentRunRows.mockResolvedValue([]);
  m.probeDatabase.mockReset();
  m.probeDatabase.mockResolvedValue({ ok: true });
  out = [];
  const collect = (...args: unknown[]) => void out.push(args.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(collect);
  vi.spyOn(console, "warn").mockImplementation(collect);
  vi.spyOn(console, "error").mockImplementation(collect);
});
afterEach(() => vi.restoreAllMocks());

const incrementalTick = () =>
  runScrapeCycle([PL], ["forbet", "etoto"], { modes: { forbet: "incremental", etoto: "incremental" }, recordOutcomes: false, closeBrowsers: false });

describe("incremental ticks in hourly units (Review Focus 6)", () => {
  it("an incremental tick records no outcome and emits no [ScrapeRun] or alert", async () => {
    m.scrapers.etoto.listEvents.mockResolvedValue([refOf("etoto", 0)]);
    const r = await incrementalTick();
    expect(m.insertOutcomes).not.toHaveBeenCalled();
    expect(lines("[ScrapeRun]")).toEqual([]);
    expect(lines("[ALERT")).toEqual([]);
    expect(out.filter((l) => /^\[Aggregator\/FullOffer\] (forbet|etoto) (success|partial|empty|scrape_failed|persist_failed):/.test(l))).toEqual([]);
    expect(out.filter((l) => /^\[Aggregator\/FullOffer\] Run \S+ completed/.test(l))).toEqual([]);
    expect(scraperHealth.getRecentOutcomes(PL)).toEqual([]);
    expect(r.get(PL)!.outcomes).toEqual([]);
    // The save and the finalize still ran once per unit that had something to do
    expect(m.save).toHaveBeenCalledTimes(1);
    expect(lines("[IncrementalPass] {")).toHaveLength(2);
    expect(incrementalHourLedger.take("forbet", PL)).toEqual({ passes: 1, failedPasses: 0, firstError: null });
  });

  it("the hourly tick records one outcome per unit through classifyIncrementalOutcome", async () => {
    // Earlier in the hour: one failed and one clean incremental pass of forbet
    m.scrapers.forbet.listEvents.mockRejectedValueOnce(new Error("fetch HTTP 503 https://api.example/list"));
    await incrementalTick();
    await incrementalTick();
    expect(m.insertOutcomes).not.toHaveBeenCalled();

    // Hourly tick: forbet lists one fresh event (confirmed), etoto one fresh event too
    const key = generateMatchId(TEAMS[0][0], TEAMS[0][1], PL);
    m.loadState.mockResolvedValue(new Map([[key, { lastDetailAt: Date.now() - 10 * 60_000, fingerprint: "fp0", status: "ok" }]]));
    m.scrapers.forbet.listEvents.mockResolvedValue([refOf("forbet", 0)]);
    m.scrapers.etoto.listEvents.mockResolvedValue([refOf("etoto", 0)]);
    m.recordPass.mockResolvedValue({ stamped: 0, confirmed: 1, notConfirmed: 0, confirmedRows: 220 });
    await runScrapeCycle([PL], ["forbet", "etoto"], { modes: { forbet: "incremental", etoto: "incremental" }, recordOutcomes: true, closeBrowsers: false });

    expect(m.insertOutcomes).toHaveBeenCalledTimes(1);
    const outcomes = m.insertOutcomes.mock.calls[0][0] as Array<{ bookmaker: string; status: string; error: string | null; marketsSaved: number; matchesFound: number }>;
    expect(outcomes.map((o) => [o.bookmaker, o.status, o.marketsSaved, o.matchesFound])).toEqual([
      ["forbet", "partial", 220, 1],
      ["etoto", "success", 220, 1],
    ]);
    expect(outcomes[0].error).toBe("1 of 2 incremental passes this hour failed | fetch HTTP 503 https://api.example/list");
    expect(lines("[ScrapeRun]")).toHaveLength(1);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("startup and admin runs record outcomes as today (no recordOutcomes field)", async () => {
    m.scrapers.forbet.listEvents.mockResolvedValue([refOf("forbet", 0), refOf("forbet", 1)]);
    await runScrapeCycle([PL], ["forbet"], { closeBrowsers: false });
    // forbet is enabled and not dry-run: its full run is a forced pass that keeps the bookkeeping
    expect(m.scrapers.forbet.scrapeFullOffer).not.toHaveBeenCalled();
    expect(m.scrapers.forbet.fetchEvent).toHaveBeenCalledTimes(2);
    expect(m.save).toHaveBeenCalledTimes(1);
    expect(m.recordPass).toHaveBeenCalledTimes(1);
    expect(m.insertOutcomes).toHaveBeenCalledTimes(1);
    expect((m.insertOutcomes.mock.calls[0][0] as Array<{ status: string; marketsSaved: number }>).map((o) => [o.status, o.marketsSaved])).toEqual([["success", 40]]);
    expect(lines("[ScrapeRun]")).toHaveLength(1);
    expect(out.some((l) => l.startsWith("[Aggregator/FullOffer] forbet success:"))).toBe(true);
  });

  it("a bookmaker outside the list keeps today's full pass on the hourly tick", async () => {
    await runScrapeCycle([PL], ["fortuna", "forbet"], { modes: { fortuna: "full", forbet: "incremental" }, recordOutcomes: true, closeBrowsers: false });
    expect(m.scrapers.fortuna.scrapeFullOffer).toHaveBeenCalledTimes(1);
    expect(m.scrapers.fortuna.listEvents).not.toHaveBeenCalled();
    expect(lines("[FullPassCost]")).toEqual([]);
  });

  it("an unreachable DB on an incremental tick raises no ABORTED alert", async () => {
    m.probeDatabase.mockResolvedValue({ ok: false, error: "fetch failed (ECONNREFUSED)" });
    const r = await incrementalTick();
    expect(lines("[ALERT")).toEqual([]);
    expect(r.get(PL)!.aborted).toBe("db_unreachable");
    expect(m.scrapers.forbet.listEvents).not.toHaveBeenCalled();
  });
});
