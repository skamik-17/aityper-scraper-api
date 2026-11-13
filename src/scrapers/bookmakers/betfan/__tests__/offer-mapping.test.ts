import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  driveBrowserScraperOffline,
  loadFixtureRoutes,
  withoutScrapedAt,
} from "../../../shared/rest-market/__tests__/offline-harness.js";
import { BetfanBrowserScraper } from "../index.js";
import { toBetfanOffer } from "../offer-mapping.js";
import { isValidEvent } from "../parser.js";
import type { BetfanEvent } from "../types.js";

const URLS = {
  list: "https://betfan.pl/api/v1/market/categories/244/events",
  detail: (id: string) => `https://betfan.pl/api/v1/market/events/${id}`,
};
const fixture = (f: string) =>
  JSON.parse(readFileSync(new URL(`../../../shared/rest-market/__tests__/fixtures/betfan/${f}`, import.meta.url), "utf8"));
const listed: BetfanEvent[] = fixture("list.json").data.categories[0].events;
const detailOf = (e: BetfanEvent): BetfanEvent => fixture(`detail-${e.eventId}.json`).data.event;
const mapped = () =>
  listed.filter(isValidEvent).map((e) => toBetfanOffer(e, detailOf(e), "premier-league")).filter((o) => o !== null);

async function oldBrowserRun() {
  const scraper = new BetfanBrowserScraper();
  const { calls } = driveBrowserScraperOffline(scraper, loadFixtureRoutes("betfan", URLS));
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

describe("toBetfanOffer", () => {
  it("equals today's browser output on the recorded payloads (scrapedAt aside)", async () => {
    const { result } = await oldBrowserRun();
    expect(result.success).toBe(true);
    expect(result.matches.map(withoutScrapedAt)).toEqual(mapped().map(withoutScrapedAt));
  });

  it("pins the recorded offer", async () => {
    const { result } = await oldBrowserRun();
    expect(result.matches.map((m) => [m.matchId, m.markets.length])).toEqual([["40932985", 37], ["40933001", 36], ["40932982", 38]]);
  });

  it("requests exactly 3 details", async () => {
    const { calls } = await oldBrowserRun();
    expect(calls.filter((u) => u.startsWith("https://betfan.pl/api/v1/market/events/"))).toHaveLength(3);
  });

  it("takes the kickoff from eventStart", () => expect(mapped()[0].startTime).toBe("2026-11-07T12:30:00.000Z"));

  it("returns null for a detail without markets", () => {
    const e = listed.filter(isValidEvent)[0];
    expect(toBetfanOffer(e, { ...detailOf(e), games: [] }, "premier-league")).toBeNull();
  });

  it("the browser path stores the kickoff", async () => {
    const { result } = await oldBrowserRun();
    expect(result.matches[0].startTime).toBe("2026-11-07T12:30:00.000Z");
  });
});
