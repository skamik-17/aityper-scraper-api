import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  driveBrowserScraperOffline,
  loadFixtureRoutes,
  withoutScrapedAt,
} from "../../../shared/rest-market/__tests__/offline-harness.js";
import { FuksiarzBrowserScraper } from "../index.js";
import { toFuksiarzOffer } from "../offer-mapping.js";
import { isValidEvent } from "../parser.js";
import type { FuksiarzEvent } from "../types.js";

const URLS = {
  list: "https://fuksiarz.pl/rest/market/categories/multi/625/events",
  detail: (id: string) => `https://fuksiarz.pl/rest/market/events/${id}`,
};
const KICKOFFS = ["2026-11-07T12:30:00.000Z", "2026-11-07T15:00:00.000Z", "2026-11-21T12:30:00.000Z"];
const fixture = (f: string) =>
  JSON.parse(readFileSync(new URL(`../../../shared/rest-market/__tests__/fixtures/fuksiarz/${f}`, import.meta.url), "utf8"));
const list: { data: FuksiarzEvent[] } = fixture("list.json");
const detailOf = (e: FuksiarzEvent): FuksiarzEvent => fixture(`detail-${e.eventId}.json`).data;
const mapped = () =>
  list.data.filter(isValidEvent).map((e) => toFuksiarzOffer(e, detailOf(e), "premier-league")).filter((o) => o !== null);

async function oldBrowserRun() {
  const scraper = new FuksiarzBrowserScraper();
  const { calls } = driveBrowserScraperOffline(scraper, loadFixtureRoutes("fuksiarz", URLS));
  const result = await scraper.scrapeFullOffer("premier-league");
  return { result, calls };
}

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("toFuksiarzOffer", () => {
  it("equals today's browser output on the recorded payloads (scrapedAt aside)", async () => {
    const { result } = await oldBrowserRun();
    expect(result.success).toBe(true);
    expect(result.matches.map(withoutScrapedAt)).toEqual(mapped().map(withoutScrapedAt));
  });

  it("pins the recorded offer", async () => {
    const { result } = await oldBrowserRun();
    expect(result.matches.map((m) => [m.matchId, m.markets.length])).toEqual([["23464740", 291], ["23464877", 30], ["23615576", 83]]);
  });

  it("requests exactly 3 details", async () => {
    const { calls } = await oldBrowserRun();
    expect(calls.filter((u) => u.startsWith("https://fuksiarz.pl/rest/market/events/"))).toHaveLength(3);
  });

  it("takes the kickoffs from eventStart", () => expect(mapped().map((m) => m.startTime)).toEqual(KICKOFFS));

  it("returns null for a detail without markets", () => {
    const e = list.data.filter(isValidEvent)[0];
    expect(toFuksiarzOffer(e, { ...detailOf(e), eventGames: [] }, "premier-league")).toBeNull();
  });

  it("the browser path stores the kickoffs", async () => {
    const { result } = await oldBrowserRun();
    expect(result.matches.map((m) => m.startTime)).toEqual(KICKOFFS);
  });
});
