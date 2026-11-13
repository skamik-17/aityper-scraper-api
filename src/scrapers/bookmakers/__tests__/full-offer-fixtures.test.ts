/**
 * Offline harness: drives each scraper's real scrapeFullOffer on trimmed
 * recorded payloads, with its navigation module mocked and no browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";

// Factories are hoisted, so fixtures are read lazily inside the mocked functions.
const fx = (bm: string) => JSON.parse(readFileSync(new URL(`./fixtures/full-offer/${bm}.json`, import.meta.url), "utf8"));

vi.mock("../forbet/navigation.js", async (orig) => ({
  ...(await orig<object>()),
  navigateToBaseSite: async () => true,
  fetchLeagueEvents: async () => fx("forbet").listing,
  fetchEventDetails: async () => fx("forbet").detail,
}));
vi.mock("../etoto/navigation.js", async (orig) => ({
  ...(await orig<object>()),
  navigateToBaseSite: async () => true,
  fetchLeagueEvents: async () => fx("etoto").listing,
  fetchEventDetails: async () => fx("etoto").detail,
}));
vi.mock("../fuksiarz/navigation.js", async (orig) => ({
  ...(await orig<object>()),
  navigateToBaseSite: async () => true,
  fetchLeagueEvents: async () => fx("fuksiarz").listing,
  fetchEventDetails: async () => fx("fuksiarz").detail,
}));
vi.mock("../betfan/navigation.js", async (orig) => ({
  ...(await orig<object>()),
  navigateToBaseSite: async () => true,
  fetchLeagueEvents: async () => fx("betfan").listing,
  fetchEventDetails: async () => fx("betfan").detail,
}));
vi.mock("../lvbet/navigation.js", async (orig) => ({
  ...(await orig<object>()),
  navigateToBaseSite: async () => true,
  fetchLeagueMatches: async () => fx("lvbet").listing,
  fetchMarketsForMatch: async () => fx("lvbet").markets,
}));
vi.mock("../superbet/navigation.js", async (orig) => ({
  ...(await orig<object>()),
  navigateToLeaguePage: async () => true,
  fetchLeagueEvents: async () => fx("superbet").listing,
  fetchEventDetails: async () => fx("superbet").detail,
}));

vi.mock("../betclic/navigation.js", async (orig) => {
  const groups = ["TOP", "WYNIK", "STRZELCY", "GOLE", "METODA_GOLA", "HANDICAP", "STATYSTYKI"];
  return {
    ...(await orig<object>()),
    fetchLeagueMatches: async () => readFileSync(new URL("./fixtures/full-offer/betclic-listing.bin", import.meta.url)),
    // TOP carries the trimmed detail; the other six complete empty, which betclic counts as valid but empty.
    fetchMarketGroupResults: async () =>
      groups.map((group) => ({
        group,
        response:
          group === "TOP"
            ? readFileSync(new URL("./fixtures/full-offer/betclic-top.bin", import.meta.url))
            : Buffer.alloc(0),
        error: null,
      })),
  };
});

import { PlaywrightScraper } from "../../base/playwright-base.js";
import { ScraperCache } from "../../../services/cache-manager.js";
import { ForbetBrowserScraper } from "../forbet/index.js";
import { EtotoBrowserScraper } from "../etoto/index.js";
import { FuksiarzPlaywrightScraper } from "../fuksiarz/index.js";
import { BetfanPlaywrightScraper } from "../betfan/index.js";
import { LVBetPlaywrightScraper } from "../lvbet/index.js";
import { SuperbetPlaywrightScraper } from "../superbet/index.js";
import { BetclicPlaywrightScraper } from "../betclic/index.js";
import { parseListingResponse } from "../betclic/parser.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T00:00:00Z")); // superbet drops past kickoffs
  // observability's recorder attaches page.on/off and reads url/title
  const page = Object.assign(new EventEmitter(), { mainFrame: () => null, url: () => "about:blank", title: async () => "" });
  vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockResolvedValue({
    page,
    browser: {},
    context: {},
    cleanup: async () => {},
  });
  vi.spyOn(PlaywrightScraper.prototype as any, "delay").mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SCRAPERS = [
  ["forbet", () => new ForbetBrowserScraper()],
  ["etoto", () => new EtotoBrowserScraper()],
  ["fuksiarz", () => new FuksiarzPlaywrightScraper()],
  ["betfan", () => new BetfanPlaywrightScraper()],
  ["lvbet", () => new LVBetPlaywrightScraper()],
  ["superbet", () => new SuperbetPlaywrightScraper()],
] as const;

describe("full-offer harness (recorded payloads, no browser)", () => {
  it.each(SCRAPERS)("%s scrapeFullOffer writes nothing to a ScraperCache", async (_bm, make) => {
    const set = vi.spyOn(ScraperCache.prototype, "set");
    const r = await make().scrapeFullOffer("premier-league");
    expect(r.matches).toHaveLength(1);
    expect(set).not.toHaveBeenCalled();
  });
});

const KICKOFF_SCRAPERS = [...SCRAPERS, ["betclic", () => new BetclicPlaywrightScraper()]] as const;

describe("kickoff time (perf plan 01 Task 4)", () => {
  it("betclic listing parser reads the kickoff string (proto field 3)", () =>
    expect(
      parseListingResponse(readFileSync(new URL("./fixtures/full-offer/betclic-listing.bin", import.meta.url)), "premier-league")[0]
        .startTime,
    ).toBe("2026-11-07T12:30:00.0000000Z"));

  it.each([
    ["forbet", "2026-11-07T12:30:00.000Z"],
    ["etoto", "2026-11-07T12:30:00.000Z"],
    ["fuksiarz", "2026-11-07T12:30:00.000Z"],
    ["betfan", "2026-11-07T12:30:00.000Z"],
    ["lvbet", "2026-11-08T14:00:00.000Z"],
    ["superbet", "2026-11-21T12:30:00.000Z"],
    ["betclic", "2026-11-07T12:30:00.000Z"],
  ])("%s stores the kickoff in FullMatchOffer.startTime", async (bm, iso) => {
    const make = KICKOFF_SCRAPERS.find(([b]) => b === bm)![1];
    expect((await make().scrapeFullOffer("premier-league")).matches[0].startTime).toBe(iso);
  });
});
