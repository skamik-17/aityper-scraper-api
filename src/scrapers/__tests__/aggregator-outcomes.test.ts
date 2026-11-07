import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullMatchOffer, FullOfferScraperResult, ScrapedMarket } from "../../types/full-offer.js";
import type { NormalizeAndSaveResult } from "../../services/scrape-helpers.js";

const { scrapers, save, twenty } = vi.hoisted(() => {
  const fakeScraper = (
    result: FullOfferScraperResult | Error = {
      success: false,
      bookmaker: "sts",
      league: "premier-league",
      matches: [],
      error: "not under test",
    },
  ) => ({
    scrapeFullOffer: vi.fn(async (_league: string): Promise<FullOfferScraperResult> => {
      if (result instanceof Error) throw result;
      return result;
    }),
    cleanup: vi.fn(async () => {}),
  });
  const twenty = Array.from(
    { length: 20 },
    (_, i) => ({ homeTeam: `H${i}`, awayTeam: `A${i}`, markets: [{} as ScrapedMarket] }) as FullMatchOffer,
  );
  const scrapers = {
    sts: fakeScraper(),
    fortuna: fakeScraper(),
    betclic: fakeScraper(),
    superbet: fakeScraper(),
    lvbet: fakeScraper(),
    fuksiarz: fakeScraper(),
    betfan: fakeScraper(),
    totalbet: fakeScraper(),
    forbet: fakeScraper(),
    etoto: fakeScraper(),
    betters: fakeScraper(),
    lebull: fakeScraper(),
    betcris: fakeScraper(),
    pzbuk: fakeScraper(),
  };
  const save = vi.fn(
    async (..._args: unknown[]): Promise<NormalizeAndSaveResult> => ({
      matchesProcessed: 0,
      marketsNormalized: 0,
      marketsSaved: 0,
      errors: [],
    }),
  );
  return { scrapers, save, twenty };
});

vi.mock("../bookmakers/index.js", async () => ({
  stsScraper: scrapers.sts,
  fortunaScraper: scrapers.fortuna,
  betclicScraper: scrapers.betclic,
  superbetScraper: scrapers.superbet,
  lvbetScraper: scrapers.lvbet,
  fuksiarzScraper: scrapers.fuksiarz,
  betfanScraper: scrapers.betfan,
  totalbetScraper: scrapers.totalbet,
  forbetScraper: scrapers.forbet,
  etotoScraper: scrapers.etoto,
  bettersScraper: scrapers.betters,
  lebullScraper: scrapers.lebull,
  betcrisScraper: scrapers.betcris,
  pzbukScraper: scrapers.pzbuk,
}));
vi.mock("../../services/scrape-helpers.js", async () => ({ normalizeAndSaveMatches: save }));

import { runAllFullOfferScrapers } from "../aggregator.js";

const BETTERS_ERR =
  "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
const FORBET_ERR =
  "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";

function saved(marketsSaved: number, matchesProcessed = 20): NormalizeAndSaveResult {
  return { matchesProcessed, marketsNormalized: marketsSaved, marketsSaved, errors: [] };
}

/** Fresh matches (the save mock below mutates them), each with `markets` raw markets. */
function freshMatches(count: number, markets: number): FullMatchOffer[] {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        homeTeam: `H${i}`,
        awayTeam: `A${i}`,
        markets: Array.from({ length: markets }, () => ({}) as ScrapedMarket),
      }) as FullMatchOffer,
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  warnSpy.mockRestore();
  vi.clearAllMocks();
});

const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.flat().join("\n");

describe("runAllFullOfferScrapers: honest outcomes", () => {
  it("counts a bookmaker whose markets were not persisted as failed", async () => {
    scrapers.forbet.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "forbet",
      league: "premier-league",
      matches: twenty,
    });
    save.mockResolvedValueOnce({ matchesProcessed: 20, marketsNormalized: 5995, marketsSaved: 0, errors: [FORBET_ERR] });

    const r = await runAllFullOfferScrapers("premier-league", ["forbet"]);

    expect(r.summary).toMatchObject({ successCount: 0, errorCount: 1, totalMarketsSaved: 0 });
    expect(r.outcomes[0]).toMatchObject({
      bookmaker: "forbet",
      status: "persist_failed",
      matchesFound: 20,
      marketsFound: 20,
      marketsSaved: 0,
    });
    expect(r.outcomes[0].error).toContain("ECONNREFUSED 127.0.0.1:59999");
    expect(logged(errorSpy)).toContain(
      `[Aggregator/FullOffer] forbet persist_failed: 20 matches, 20 markets found, 0 saved - ${FORBET_ERR}`,
    );
    expect(logged(logSpy)).toMatch(
      new RegExp(
        `\\[Aggregator/FullOffer\\] Run ${r.runId} completed in \\d+ms: 0 ok, 1 failed, 20 matches, 20 markets found, 0 saved`,
      ),
    );
  });

  it("logs the scraper's error text", async () => {
    scrapers.betters.scrapeFullOffer.mockResolvedValueOnce({
      success: false,
      bookmaker: "betters",
      league: "premier-league",
      matches: [],
      error: BETTERS_ERR,
    });

    const r = await runAllFullOfferScrapers("premier-league", ["betters"]);

    expect(r.outcomes[0].status).toBe("scrape_failed");
    expect(errorSpy.mock.calls.flat().join("\n")).toContain(
      "betters scrape_failed: 0 matches, 0 markets found, 0 saved - No events found from API | document HTTP 404",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("sums saved markets from OK outcomes only", async () => {
    scrapers.betclic.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "betclic",
      league: "premier-league",
      matches: twenty,
    });
    scrapers.sts.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "sts",
      league: "premier-league",
      matches: twenty,
    });
    save.mockResolvedValueOnce(saved(3150)).mockResolvedValueOnce(saved(5130));

    const r = await runAllFullOfferScrapers("premier-league", ["betclic", "sts"]);

    expect(r.summary).toMatchObject({ successCount: 2, totalMarketsSaved: 8280 });
  });

  it("turns a thrown scraper into scrape_failed with the exception message", async () => {
    scrapers.sts.scrapeFullOffer.mockRejectedValueOnce(new Error("browserType.launch: Executable doesn't exist"));

    const r = await runAllFullOfferScrapers("premier-league", ["sts"]);

    expect(r.outcomes[0]).toMatchObject({ status: "scrape_failed", error: "browserType.launch: Executable doesn't exist" });
    expect(scrapers.sts.cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps targetBookmakers order and counts failures as outcomes minus OK", async () => {
    scrapers.sts.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "sts",
      league: "premier-league",
      matches: twenty,
    });
    scrapers.betters.scrapeFullOffer.mockResolvedValueOnce({
      success: false,
      bookmaker: "betters",
      league: "premier-league",
      matches: [],
      error: BETTERS_ERR,
    });
    scrapers.etoto.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "etoto",
      league: "premier-league",
      matches: [],
    });
    save.mockResolvedValueOnce(saved(5130));

    const r = await runAllFullOfferScrapers("premier-league", ["betters", "sts", "etoto"]);

    expect(r.outcomes.map((o) => [o.bookmaker, o.status])).toEqual([
      ["betters", "scrape_failed"],
      ["sts", "success"],
      ["etoto", "empty"],
    ]);
    expect(r.summary).toMatchObject({ successCount: 1, errorCount: 2, totalMarketsSaved: 5130 });
    expect(r.outcomes.every((o) => o.runId === r.runId && o.league === "premier-league")).toBe(true);
    expect([...r.results.keys()]).toEqual(["betters", "sts", "etoto"]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("counts raw markets before the save normalizes them, and keeps totalMarketsFound post-normalization", async () => {
    const matches = freshMatches(3, 4);
    scrapers.fortuna.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "fortuna",
      league: "premier-league",
      matches,
    });
    // normalizeAndSaveMatches replaces match.markets with the normalized list in place.
    save.mockImplementationOnce(async (...args: unknown[]) => {
      for (const m of args[0] as FullMatchOffer[]) m.markets = m.markets.slice(0, 1);
      return { matchesProcessed: 3, marketsNormalized: 3, marketsSaved: 3, errors: [] };
    });

    const r = await runAllFullOfferScrapers("premier-league", ["fortuna"]);

    expect(r.outcomes[0]).toMatchObject({ status: "success", matchesFound: 3, marketsFound: 12, marketsSaved: 3, error: null });
    expect(r.summary).toMatchObject({ totalMatchesFound: 3, totalMarketsFound: 3, totalMarketsSaved: 3 });
    expect(r.allMatches).toHaveLength(3);
  });

  it("reports a save that throws as persist_failed, not as a scrape failure", async () => {
    scrapers.lvbet.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "lvbet",
      league: "premier-league",
      matches: twenty,
    });
    save.mockRejectedValueOnce(new Error("Cannot read properties of undefined (reading 'length')"));

    const r = await runAllFullOfferScrapers("premier-league", ["lvbet"]);

    expect(r.outcomes[0]).toMatchObject({
      status: "persist_failed",
      matchesFound: 20,
      marketsFound: 20,
      marketsSaved: 0,
      error: "Save failed: Cannot read properties of undefined (reading 'length')",
    });
    expect(r.summary).toMatchObject({ successCount: 0, errorCount: 1, totalMarketsSaved: 0 });
  });

  it("keeps the pre-outcomes back-compat view of a save that throws: a failed result, outside the scrape totals", async () => {
    // A throw can stop normalizeAndSaveMatches half way through replacing match.markets,
    // so these matches must not feed the post-normalization totals (base behaviour).
    scrapers.lvbet.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "lvbet",
      league: "premier-league",
      matches: freshMatches(20, 2),
      duration: 31_000,
    });
    save.mockRejectedValueOnce(new Error("Cannot read properties of undefined (reading 'length')"));
    scrapers.sts.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "sts",
      league: "premier-league",
      matches: twenty,
    });
    save.mockResolvedValueOnce(saved(5130));

    const r = await runAllFullOfferScrapers("premier-league", ["lvbet", "sts"]);

    expect(r.results.get("lvbet")).toMatchObject({
      success: false,
      matches: [],
      error: "Save failed: Cannot read properties of undefined (reading 'length')",
    });
    expect(r.results.get("sts")).toMatchObject({ success: true, matches: twenty });
    expect(r.allMatches).toHaveLength(20);
    expect(r.summary).toMatchObject({ totalMatchesFound: 20, totalMarketsFound: 20, totalMarketsSaved: 5130 });
    // The outcome still describes what was scraped and why nothing was saved.
    expect(r.outcomes[0]).toMatchObject({ status: "persist_failed", matchesFound: 20, marketsFound: 40, durationMs: 31_000 });
  });

  it("keeps every outcome when one scraper's cleanup throws", async () => {
    scrapers.etoto.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "etoto",
      league: "premier-league",
      matches: twenty,
    });
    scrapers.etoto.cleanup.mockRejectedValueOnce(new Error("Target page, context or browser has been closed"));
    save.mockResolvedValueOnce(saved(6553));

    const r = await runAllFullOfferScrapers("premier-league", ["etoto", "betters"]);

    expect(r.outcomes.map((o) => [o.bookmaker, o.status, o.marketsSaved])).toEqual([
      ["etoto", "success", 6553],
      ["betters", "scrape_failed", 0],
    ]);
    expect(logged(errorSpy)).toContain("[Aggregator/FullOffer] etoto cleanup failed:");
  });

  it("uses the scraper's own duration when it reports one, else the wall time up to the save", async () => {
    scrapers.superbet.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "superbet",
      league: "premier-league",
      matches: twenty,
      duration: 42_000,
    });
    save.mockResolvedValueOnce(saved(13353));
    scrapers.pzbuk.scrapeFullOffer.mockResolvedValueOnce({
      success: false,
      bookmaker: "pzbuk",
      league: "premier-league",
      matches: [],
      error: "No WebSocket data captured",
    });

    const before = Date.now();
    const r = await runAllFullOfferScrapers("premier-league", ["superbet", "pzbuk"]);
    const after = Date.now();

    expect(r.outcomes[0].durationMs).toBe(42_000);
    const pz = r.outcomes[1];
    expect(pz.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(pz.finishedAt.getTime()).toBeLessThanOrEqual(after);
    expect(pz.durationMs).toBe(pz.finishedAt.getTime() - pz.startedAt.getTime());
  });

  it("logs OK bookmakers outside console.error and one run line with outcome totals", async () => {
    scrapers.betclic.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "betclic",
      league: "premier-league",
      matches: twenty,
    });
    scrapers.betters.scrapeFullOffer.mockResolvedValueOnce({
      success: false,
      bookmaker: "betters",
      league: "premier-league",
      matches: [],
      error: BETTERS_ERR,
    });
    save.mockResolvedValueOnce(saved(3150));

    const r = await runAllFullOfferScrapers("premier-league", ["betclic", "betters"]);

    expect(logged(logSpy)).toContain("[Aggregator/FullOffer] betclic success: 20 matches, 20 markets found, 3150 saved");
    expect(logged(errorSpy)).not.toContain("betclic");
    expect(logged(logSpy)).toMatch(
      new RegExp(
        `\\[Aggregator/FullOffer\\] Run ${r.runId} completed in \\d+ms: 1 ok, 1 failed, 20 matches, 20 markets found, 3150 saved`,
      ),
    );
  });
});
