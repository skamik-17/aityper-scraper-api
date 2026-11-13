import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const bms = ["sts", "fortuna", "betclic", "superbet", "lvbet", "fuksiarz", "betfan", "totalbet", "forbet", "etoto", "betters", "lebull", "betcris", "pzbuk"] as const;
  const scrapers = Object.fromEntries(
    bms.map((bm) => [
      bm,
      {
        bookmaker: bm,
        cleanup: vi.fn(async () => {}),
        scrapeFullOffer: vi.fn(async (league: string) => ({ success: true, bookmaker: bm, league, matches: [] })),
      },
    ]),
  );
  return { scrapers };
});
vi.mock("../bookmakers/index.js", async () => Object.fromEntries(Object.entries(h.scrapers).map(([bm, s]) => [`${bm}Scraper`, s])));
vi.mock("../../services/scrape-helpers.js", async () => ({ normalizeAndSaveMatches: vi.fn() }));

import { getScraper, runAllFullOfferScrapers } from "../aggregator.js";

describe("aggregator typed on FullOfferScraper", () => {
  it("getScraper returns any FullOfferScraper", () => expect(getScraper("lvbet")).toBe(h.scrapers.lvbet));

  it("the full-offer path runs a scraper that is not a PlaywrightScraper", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runAllFullOfferScrapers("premier-league", ["fortuna"]);
    expect(h.scrapers.fortuna.scrapeFullOffer.mock.calls[0][0]).toBe("premier-league");
    expect(h.scrapers.fortuna.cleanup).toHaveBeenCalledTimes(1);
    expect(r.results.get("fortuna")?.success).toBe(true);
  });

  it("the aggregator no longer exports the caller-less legacy 1X2 runners", async () => {
    const mod: Record<string, unknown> = await import("../aggregator.js");
    expect(Object.keys(mod).filter((k) => ["runAllScrapers", "runSingleScraper"].includes(k))).toEqual([]);
    expect(typeof mod.getScraper).toBe("function");
  });
});
