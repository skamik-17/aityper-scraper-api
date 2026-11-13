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

import { PlaywrightScraper } from "../../base/playwright-base.js";
import { ScraperCache } from "../../../services/cache-manager.js";
import { ForbetPlaywrightScraper } from "../forbet/index.js";
import { EtotoPlaywrightScraper } from "../etoto/index.js";
import { FuksiarzPlaywrightScraper } from "../fuksiarz/index.js";
import { BetfanPlaywrightScraper } from "../betfan/index.js";
import { LVBetPlaywrightScraper } from "../lvbet/index.js";
import { SuperbetPlaywrightScraper } from "../superbet/index.js";

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
  ["forbet", () => new ForbetPlaywrightScraper()],
  ["etoto", () => new EtotoPlaywrightScraper()],
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
