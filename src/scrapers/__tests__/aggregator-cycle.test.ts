import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, okResult, twentyMatches } from "../../__tests__/helpers/run-fixtures.js";
import type { FullOfferScraperResult } from "../../types/full-offer.js";

const { scrapers, save } = vi.hoisted(() => {
  const BMS = ["sts", "fortuna", "betclic", "superbet", "lvbet", "fuksiarz", "betfan", "totalbet", "forbet", "etoto", "betters", "lebull", "betcris", "pzbuk"];
  return {
    scrapers: Object.fromEntries(BMS.map((bm) => [bm, { bookmaker: bm, transport: "http", scrapeFullOffer: vi.fn(), cleanup: vi.fn(async () => {}) }])),
    save: vi.fn(),
  };
});
vi.mock("../bookmakers/index.js", async () => Object.fromEntries(Object.entries(scrapers).map(([bm, s]) => [`${bm}Scraper`, s])));
vi.mock("../../services/scrape-helpers.js", async () => ({ normalizeAndSaveMatches: save }));

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
});
