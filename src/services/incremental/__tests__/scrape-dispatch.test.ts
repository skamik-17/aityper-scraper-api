import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG, type PolishBookmaker } from "../../../config/index.js";
import type { IncrementalConfig } from "../../../config/incremental.js";
import { createScrapeBudget } from "../../../scrapers/shared/budget.js";
import type { EventRef, IncrementalScraper } from "../../../scrapers/shared/incremental/incremental-scraper.js";
import type { TransportStats } from "../../../scrapers/shared/scraper-contract.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { buildTickRequest, planTick, scrapeForRun, withScrapeMode } from "../scrape-dispatch.js";
import { DryRunLedger, type IncrementalPassResult } from "../incremental-pass.js";

const H = 3_600_000;
const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const at = (t: string) => Date.parse(`2026-11-07T${t}`);
const cfg = (bms: PolishBookmaker[] = [], dryRun = false): IncrementalConfig => ({ bookmakers: new Set(bms), passMinutes: 10, dryRun, error: null });
const allFull = Object.fromEntries(CONFIG.BOOKMAKERS.map((bm) => [bm, "full"]));
const tick = (lastFullAt: number | null, c: IncrementalConfig) =>
  planTick({ now: NOW, lastFullAt, fullIntervalMs: H, bookmakers: CONFIG.BOOKMAKERS, cfg: c });

describe("planTick", () => {
  it("without incremental bookmakers every tick is the hourly full run or nothing", () => {
    expect(tick(null, cfg())).toEqual({ modes: allFull, hourly: true });
    expect(tick(at("11:30:00Z"), cfg())).toEqual({ modes: {}, hourly: false });
    expect(tick(at("11:01:00Z"), cfg())).toEqual({ modes: allFull, hourly: true });
  });

  it("incremental bookmakers run every tick; the others only on the hourly one", () => {
    expect(tick(at("11:50:00Z"), cfg(["forbet", "etoto"]))).toEqual({ modes: { forbet: "incremental", etoto: "incremental" }, hourly: false });
    expect(tick(at("11:00:00Z"), cfg(["forbet", "etoto"]))).toEqual({
      modes: { ...allFull, forbet: "incremental", etoto: "incremental" },
      hourly: true,
    });
  });

  it("a dry run plans only between hourly full runs", () => {
    expect(tick(at("11:50:00Z"), cfg(["forbet", "etoto"], true))).toEqual({ modes: { forbet: "plan-only", etoto: "plan-only" }, hourly: false });
    expect(tick(at("11:00:00Z"), cfg(["forbet", "etoto"], true))).toEqual({ modes: allFull, hourly: true });
  });

  it("modes keep CONFIG.BOOKMAKERS order", () =>
    expect(Object.keys(tick(at("11:00:00Z"), cfg(["etoto", "forbet"])).modes)).toEqual([...CONFIG.BOOKMAKERS]));
});

describe("buildTickRequest", () => {
  const base = { now: NOW, fullIntervalMs: H, leagues: ["premier-league", "laliga"], bookmakers: CONFIG.BOOKMAKERS };

  it("an empty plan starts no run", () => expect(buildTickRequest({ ...base, lastFullAt: at("11:30:00Z"), cfg: cfg() })).toBeNull());

  it("carries the modes, the bookmakers and the hourly flag", () => {
    expect(buildTickRequest({ ...base, lastFullAt: at("11:50:00Z"), cfg: cfg(["forbet"]) })).toEqual({
      trigger: "interval",
      leagues: ["premier-league", "laliga"],
      bookmakers: ["forbet"],
      modes: { forbet: "incremental" },
      recordOutcomes: false,
    });
    expect(buildTickRequest({ ...base, lastFullAt: at("11:00:00Z"), cfg: cfg(["forbet"]) })).toMatchObject({
      bookmakers: [...CONFIG.BOOKMAKERS],
      recordOutcomes: true,
    });
  });
});

// ---- scrapeForRun / withScrapeMode -------------------------------------------------------------

const offer = (id: string): FullMatchOffer => ({
  matchId: id,
  bookmaker: "forbet",
  homeTeam: `${id} Home`,
  awayTeam: `${id} Away`,
  eventUrl: `https://x/${id}`,
  markets: [],
  scrapedAt: new Date(NOW),
});

function capable(ids: string[]): IncrementalScraper & { transport: "http" } {
  let requests = 0;
  const stats = (): TransportStats => ({ http: { requests, retries: 0, failures: 0, bytes: requests * 100, byStatus: {} } });
  return {
    bookmaker: "forbet",
    transport: "http",
    detailConcurrency: 2,
    transportStats: stats,
    cleanup: vi.fn(async () => {}),
    scrapeFullOffer: vi.fn(async (league: string) => {
      requests += 20;
      return { success: true, bookmaker: "forbet" as const, league, matches: ids.map(offer) };
    }),
    listEvents: vi.fn(async () => {
      requests += 1;
      return ids.map(
        (id): EventRef => ({ eventId: id, homeTeam: `${id} Home`, awayTeam: `${id} Away`, kickoff: "2026-11-12T12:00:00.000Z", fingerprint: null, eventUrl: "", listing: null }),
      );
    }),
    fetchEvent: vi.fn(async (_l: string, r: EventRef) => {
      requests += 1;
      return offer(r.eventId);
    }),
  };
}

const plain = () => ({
  bookmaker: "sts" as const,
  transport: "websocket" as const,
  scrapeFullOffer: vi.fn(async (league: string) => ({ success: true, bookmaker: "sts" as const, league, matches: [] })),
  cleanup: vi.fn(async () => {}),
});

let lines: string[];
const deps = () => ({
  loadState: vi.fn(async () => new Map()),
  recordPass: vi.fn(async () => ({ stamped: 0, confirmed: 0, notConfirmed: 0, confirmedRows: 0 })),
  matchKey: (h: string, a: string, l: string) => `${l}:${h.toLowerCase()}:${a.toLowerCase()}`,
  now: () => NOW,
  log: (l: string) => lines.push(l),
});

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(l));
  vi.spyOn(console, "warn").mockImplementation((l: string) => void lines.push(l));
});
afterEach(() => vi.restoreAllMocks());

const ctx = (c: IncrementalConfig, d = deps()) => ({ runId: "run-1", budget: createScrapeBudget(10_000), cfg: c, deps: d, ledger: new DryRunLedger() });

describe("scrapeForRun", () => {
  it("a scraper without the incremental contract runs its full pass and warns once", async () => {
    const s = plain();
    await scrapeForRun("sts", s, "premier-league", "incremental", ctx(cfg(["sts"])));
    await scrapeForRun("sts", s, "premier-league", "incremental", ctx(cfg(["sts"])));
    expect(s.scrapeFullOffer).toHaveBeenCalledTimes(2);
    expect(lines.filter((l) => l.includes("[Incremental] sts is not incremental-capable; running the full pass"))).toHaveLength(1);
  });

  it("a full run of an enabled bookmaker is a forced pass that keeps the bookkeeping", async () => {
    const s = capable(["A", "B"]);
    const r = (await scrapeForRun("forbet", s, "premier-league", "full", ctx(cfg(["forbet"])))) as IncrementalPassResult;
    expect(r.incremental.mode).toBe("forced");
    expect(r.matches.map((m) => m.matchId)).toEqual(["A", "B"]);
    expect(s.scrapeFullOffer).not.toHaveBeenCalled();
  });

  it("a dry-run full tick logs the full-pass cost, then one plan-only line, and returns the full result", async () => {
    const s = capable(["A", "B"]);
    const r = await scrapeForRun("forbet", s, "premier-league", "full", ctx(cfg(["forbet"], true)));
    expect(r.matches.map((m) => m.matchId)).toEqual(["A", "B"]);
    expect("incremental" in r).toBe(false);
    const cost = lines.filter((l) => l.startsWith("[FullPassCost] "));
    expect(cost).toHaveLength(1);
    expect(JSON.parse(cost[0].slice("[FullPassCost] ".length))).toMatchObject({
      runId: "run-1",
      bookmaker: "forbet",
      league: "premier-league",
      matches: 2,
      requests: 20,
      bytes: 2000,
      at: "2026-11-07T12:00:00.000Z",
    });
    const pass = lines.filter((l) => l.startsWith("[IncrementalPass] {"));
    expect(pass).toHaveLength(1);
    expect(pass[0]).toContain('"mode":"plan-only"');
    expect(lines.indexOf(cost[0])).toBeLessThan(lines.indexOf(pass[0]));
  });

  it("a full run of a bookmaker outside the list is today's full pass with no extra line", async () => {
    const s = capable(["A"]);
    const r = await scrapeForRun("forbet", s, "premier-league", "full", ctx(cfg()));
    expect(r.matches).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("[FullPassCost]") || l.startsWith("[IncrementalPass]"))).toEqual([]);
  });

  it("plan-only passes are finalized here and fetch nothing", async () => {
    const s = capable(["A"]);
    const r = (await scrapeForRun("forbet", s, "premier-league", "plan-only", ctx(cfg(["forbet"], true)))) as IncrementalPassResult;
    expect(r.incremental).toMatchObject({ mode: "plan-only", due: 1 });
    expect(s.fetchEvent).not.toHaveBeenCalled();
    expect(lines.filter((l) => l.startsWith("[IncrementalPass] {"))).toHaveLength(1);
  });
});

describe("withScrapeMode", () => {
  it("forwards transport and transportStats", async () => {
    const s = capable(["A"]);
    const w = withScrapeMode("forbet", s, "incremental", { runId: "run-1", cfg: cfg(["forbet"]) });
    expect((w as unknown as { transport: string }).transport).toBe("http");
    expect((w as unknown as IncrementalScraper).transportStats()).toEqual(s.transportStats());
    await w.cleanup();
    expect(s.cleanup).toHaveBeenCalledTimes(1);
    expect(w.bookmaker).toBe("forbet");
  });

  it("returns the scraper itself for a full run outside the list (today's path)", () => {
    const s = capable(["A"]);
    expect(withScrapeMode("forbet", s, "full", { runId: "run-1", cfg: cfg() })).toBe(s);
    const p = plain();
    expect(withScrapeMode("sts", p, "full", { runId: "run-1", cfg: cfg(["forbet"]) })).toBe(p);
  });
});
