import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { okResult, twentyMatches } from "../../__tests__/helpers/run-fixtures.js";

const { scrapers, save } = vi.hoisted(() => {
  const BMS = ["sts", "fortuna", "betclic", "superbet", "lvbet", "fuksiarz", "betfan", "totalbet", "forbet", "etoto", "betters", "lebull", "betcris", "pzbuk"];
  return {
    scrapers: Object.fromEntries(BMS.map((bm) => [bm, { bookmaker: bm, scrapeFullOffer: vi.fn(), cleanup: vi.fn(async () => {}) }])),
    save: vi.fn(),
  };
});
vi.mock("../bookmakers/index.js", async () => Object.fromEntries(Object.entries(scrapers).map(([bm, s]) => [`${bm}Scraper`, s])));
vi.mock("../../services/scrape-helpers.js", async () => ({ normalizeAndSaveMatches: save }));

import { runAllFullOfferScrapers } from "../aggregator.js";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") });
  for (const s of Object.values(scrapers)) s.scrapeFullOffer.mockReset();
  save.mockReset();
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runAllFullOfferScrapers hard deadline", () => {
  it("a never-resolving bookmaker is scrape_failed 'hard timeout after 120s' while the other saves", async () => {
    scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {}));
    scrapers.betclic.scrapeFullOffer.mockResolvedValueOnce(okResult("betclic", twentyMatches()));
    save.mockResolvedValueOnce({ matchesProcessed: 20, marketsNormalized: 3150, marketsSaved: 3150, errors: [] });
    const p = runAllFullOfferScrapers("premier-league", ["betclic", "forbet"]);
    await vi.advanceTimersByTimeAsync(125_000);
    expect((await p).outcomes.map((o) => [o.bookmaker, o.status, o.error]))
      .toEqual([["betclic", "success", null], ["forbet", "scrape_failed", "hard timeout after 120s"]]);
  });

  it("a result that arrives after the hard timeout is never normalized or saved (Review Focus 1)", async () => {
    scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(new Promise((res) => setTimeout(() => res(okResult("forbet", twentyMatches())), 130_000)));
    const p = runAllFullOfferScrapers("premier-league", ["forbet"]);
    await vi.advanceTimersByTimeAsync(130_000);
    await p;
    expect(save).not.toHaveBeenCalled();
  });
});
