import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, okResult, twentyMatches } from "../../__tests__/helpers/run-fixtures.js";
import type { FullOfferScraperResult } from "../../types/full-offer.js";
import type { NormalizeAndSaveResult } from "../../services/scrape-helpers.js";

const { scrapers, save } = vi.hoisted(() => {
  const BMS = ["sts", "fortuna", "betclic", "superbet", "lvbet", "fuksiarz", "betfan", "totalbet", "forbet", "etoto", "betters", "lebull", "betcris", "pzbuk"];
  return {
    scrapers: Object.fromEntries(BMS.map((bm) => [bm, { bookmaker: bm, transport: "http", scrapeFullOffer: vi.fn(), cleanup: vi.fn(async () => {}) }])),
    save: vi.fn(),
  };
});
vi.mock("../bookmakers/index.js", async () => Object.fromEntries(Object.entries(scrapers).map(([bm, s]) => [`${bm}Scraper`, s])));
vi.mock("../../services/scrape-helpers.js", async () => ({ normalizeAndSaveMatches: save }));
vi.mock("../../utils/proc-sampler.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/proc-sampler.js")>()),
  readProcessTree: async () => ({ rootRssBytes: 300 * 2 ** 20, chromium: [] }),
}));

import { runFullOfferCycle } from "../aggregator.js";

const ID_PL = "11111111-1111-4111-8111-111111111111";
const ID_LL = "22222222-2222-4222-8222-222222222222";
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") });
  for (const s of Object.values(scrapers)) {
    s.scrapeFullOffer.mockReset();
    s.scrapeFullOffer.mockImplementation(async (league: string) => okResult(s.bookmaker as never, [], league));
    s.cleanup.mockClear();
  }
  save.mockReset();
  save.mockResolvedValue({ matchesProcessed: 20, marketsNormalized: 20, marketsSaved: 20, errors: [] });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runFullOfferCycle", () => {
  it("one job per bookmaker walks the leagues sequentially; cleanup once per job", async () => {
    const pl = deferred<FullOfferScraperResult>();
    scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(pl.promise).mockResolvedValueOnce(okResult("forbet", twentyMatches(), "laliga"));
    const p = runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["forbet"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(scrapers.forbet.scrapeFullOffer.mock.calls.map((c) => c[0])).toEqual(["premier-league"]);
    pl.resolve(okResult("forbet", twentyMatches()));
    await p;
    expect(scrapers.forbet.scrapeFullOffer.mock.calls.map((c) => c[0])).toEqual(["premier-league", "laliga"]);
    expect(scrapers.forbet.cleanup).toHaveBeenCalledTimes(1);
  });

  it("different bookmakers run concurrently", async () => {
    const a = deferred<FullOfferScraperResult>();
    const b = deferred<FullOfferScraperResult>();
    scrapers.betclic.scrapeFullOffer.mockReturnValueOnce(a.promise);
    scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(b.promise);
    const p = runFullOfferCycle({ leagues: ["premier-league"], bookmakers: ["betclic", "forbet"] });
    await vi.advanceTimersByTimeAsync(0);
    expect([scrapers.betclic.scrapeFullOffer.mock.calls.length, scrapers.forbet.scrapeFullOffer.mock.calls.length]).toEqual([1, 1]);
    a.resolve(okResult("betclic"));
    b.resolve(okResult("forbet"));
    await p;
  });

  it("keeps observability's per-league shape, run ids and Starting lines", async () => {
    const r = await runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["betclic", "forbet"], runIds: { "premier-league": ID_PL, laliga: ID_LL } });
    expect([...r.keys()]).toEqual(["premier-league", "laliga"]);
    expect(r.get("laliga")!.outcomes.map((o) => [o.bookmaker, o.runId, o.league])).toEqual([["betclic", ID_LL, "laliga"], ["forbet", ID_LL, "laliga"]]);
    expect(logSpy.mock.calls.flat()).toContain(`[Aggregator/FullOffer] Starting run ${ID_LL} for laliga with 2 bookmakers`);
    expect(r.get("premier-league")!.runId).toBe(ID_PL);
  });

  it("builds units only where the league is supported", async () => {
    const r = await runFullOfferCycle({ leagues: ["premier-league", "world-cup-2026"], bookmakers: ["betters", "forbet"] });
    expect(scrapers.betters.scrapeFullOffer.mock.calls.map((c) => c[0])).toEqual(["premier-league"]);
    expect(r.get("world-cup-2026")!.outcomes.map((o) => o.bookmaker)).toEqual(["forbet"]);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/Starting run \S+ for world-cup-2026 with 1 bookmakers/);
  });

  it("a hard timeout in the first league does not stop the job's second league (Review Focus 1)", async () => {
    scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(okResult("forbet", twentyMatches(), "laliga"));
    save.mockResolvedValue({ matchesProcessed: 20, marketsNormalized: 5869, marketsSaved: 5869, errors: [] });
    const p = runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["forbet"] });
    await vi.advanceTimersByTimeAsync(125_000);
    const r = await p;
    expect(r.get("premier-league")!.outcomes[0]).toMatchObject({ status: "scrape_failed", error: "hard timeout after 120s" });
    expect(r.get("laliga")!.outcomes[0]).toMatchObject({ status: "success", marketsSaved: 5869 });
  });

  it("an abort drops units still scraping; a unit in its save phase finishes and is kept (Review Focus 3)", async () => {
    const ctl = new AbortController();
    const saving = deferred<NormalizeAndSaveResult>();
    scrapers.betclic.scrapeFullOffer.mockResolvedValueOnce(okResult("betclic", twentyMatches()));
    save.mockReturnValueOnce(saving.promise);
    scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {}));
    const p = runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["betclic", "forbet"], signal: ctl.signal });
    await vi.advanceTimersByTimeAsync(0);
    ctl.abort(new Error("shutdown: SIGTERM"));
    saving.resolve({ matchesProcessed: 20, marketsNormalized: 3150, marketsSaved: 3150, errors: [] });
    const r = await p;
    expect(r.get("premier-league")).toMatchObject({ interrupted: "shutdown: SIGTERM" });
    expect(r.get("premier-league")!.outcomes.map((o) => [o.bookmaker, o.status])).toEqual([["betclic", "success"]]);
    expect(r.get("laliga")!.outcomes).toEqual([]);
    expect(scrapers.betclic.scrapeFullOffer).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/Run \S+ interrupted after \d+ms \(shutdown: SIGTERM\): 1 of 2 bookmakers finished/);
  });

  it("an uninterrupted league reports interrupted: null", async () => {
    const r = await runFullOfferCycle({ leagues: ["premier-league"], bookmakers: ["betclic"] });
    expect(r.get("premier-league")!.interrupted).toBeNull();
  });

  it("one [ScrapeMetrics] line per job across leagues; per-league metrics on the results", async () => {
    // The forbet fake counts its requests cumulatively, like an HttpClient
    const http = { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} as Record<string, number> };
    const forbet = scrapers.forbet as typeof scrapers.forbet & { transportStats?: () => unknown };
    forbet.transportStats = () => ({ http: { ...http, byStatus: { ...http.byStatus } } });
    forbet.scrapeFullOffer.mockImplementation(async (league: string) => {
      http.requests += 20;
      http.bytes += 5_000;
      http.byStatus["200"] = (http.byStatus["200"] ?? 0) + 20;
      return okResult("forbet", twentyMatches(), league);
    });
    save.mockResolvedValue({ matchesProcessed: 20, marketsNormalized: 20, marketsSaved: 5869, errors: [] });
    try {
      const r = await runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["betclic", "forbet"], runIds: { "premier-league": ID_PL, laliga: ID_LL } });
      const lines = logSpy.mock.calls.flat().map(String).filter((l) => l.startsWith("[ScrapeMetrics] "));
      expect(lines).toHaveLength(2);
      const line = JSON.parse(lines.find((l) => l.includes('"bookmaker":"forbet"'))!.slice(16));
      expect(Object.keys(line.leagues)).toEqual(["premier-league", "laliga"]);
      expect(line).toMatchObject({ transport: "http", interrupted: false, chromiumPeakRssMb: null,
        leagues: { "premier-league": { runId: ID_PL, status: "success", matches: 20, marketsSaved: 5869, http: { requests: 20, bytes: 5_000 } },
          laliga: { runId: ID_LL, http: { requests: 20, bytes: 5_000, byStatus: { "200": 20 } } } } });
      expect(r.get("premier-league")!.results.get("forbet")!.metrics).toMatchObject({ matches: 20, marketsSaved: 5869 });
    } finally {
      delete forbet.transportStats;
    }
  });

  it("an interrupted job still prints its [ScrapeMetrics] line, marked interrupted", async () => {
    const ctl = new AbortController();
    scrapers.forbet.scrapeFullOffer.mockImplementationOnce(() => new Promise(() => {}));
    const p = runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["forbet"], signal: ctl.signal });
    await vi.advanceTimersByTimeAsync(0);
    ctl.abort(new Error("shutdown: SIGTERM"));
    await p;
    const lines = logSpy.mock.calls.flat().map(String).filter((l) => l.startsWith("[ScrapeMetrics] "));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0].slice(16))).toMatchObject({ bookmaker: "forbet", interrupted: true, leagues: {} });
  });

  it("a unit that throws becomes scrape_failed with its cause, and the job goes on to the next league", async () => {
    // A malformed scraper result (no matches array) throws inside the unit
    scrapers.forbet.scrapeFullOffer.mockImplementation(async (league: string) =>
      league === "premier-league" ? ({ success: true, bookmaker: "forbet", league } as never) : okResult("forbet", twentyMatches(), league));
    const errorSpy = vi.mocked(console.error);
    const r = await runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["forbet"], runIds: { "premier-league": ID_PL, laliga: ID_LL } });
    const pl = r.get("premier-league")!.outcomes;
    expect(pl).toHaveLength(1);
    expect(pl[0]).toMatchObject({ bookmaker: "forbet", runId: ID_PL, status: "scrape_failed" });
    expect(pl[0].error).toMatch(/^Unit failed: /);
    expect(r.get("premier-league")!.interrupted).toBeNull();
    expect(r.get("laliga")!.outcomes.map((o) => [o.bookmaker, o.status])).toEqual([["forbet", "success"]]);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("[Aggregator/FullOffer] forbet scrape_failed:");
  });
});
