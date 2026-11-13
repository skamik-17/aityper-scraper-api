import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  driveBrowserScraperOffline,
  loadFixtureRoutes,
  withoutScrapedAt,
} from "../../../shared/rest-market/__tests__/offline-harness.js";
import { ForbetBrowserScraper } from "../index.js";
import { toForbetOffer } from "../offer-mapping.js";
import { isValidEvent } from "../parser.js";
import type { ForbetEvent } from "../types.js";

const URLS = {
  list: "https://www.iforbet.pl/rest/market/categories/multi/199/events?gamesClass=major",
  detail: (id: string) => `https://www.iforbet.pl/rest/market/events/${id}`,
};
const fixture = (f: string) =>
  JSON.parse(readFileSync(new URL(`../../../shared/rest-market/__tests__/fixtures/forbet/${f}`, import.meta.url), "utf8"));
const list: { data: ForbetEvent[] } = fixture("list.json");
const detailOf = (e: ForbetEvent): ForbetEvent => fixture(`detail-${e.eventId}.json`).data;
const mapped = () =>
  list.data.filter(isValidEvent).map((e) => toForbetOffer(e, detailOf(e), "premier-league")).filter((o) => o !== null);

async function oldBrowserRun() {
  const scraper = new ForbetBrowserScraper();
  const { calls } = driveBrowserScraperOffline(scraper, loadFixtureRoutes("forbet", URLS));
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

describe("toForbetOffer", () => {
  it("equals today's browser output on the recorded payloads (scrapedAt aside)", async () => {
    const { result } = await oldBrowserRun();
    expect(result.success).toBe(true);
    expect(result.matches.map(withoutScrapedAt)).toEqual(mapped().map(withoutScrapedAt));
  });

  it("pins the recorded offer", async () => {
    const { result } = await oldBrowserRun();
    expect(result.matches.map((m) => [m.matchId, m.markets.length])).toEqual([["57945888", 40], ["57945911", 15], ["57945945", 17]]);
  });

  it("requests exactly 3 details", async () => {
    const { calls } = await oldBrowserRun();
    expect(calls.filter((u) => u.startsWith("https://www.iforbet.pl/rest/market/events/"))).toHaveLength(3);
  });

  it("takes the kickoff from eventStart", () => expect(mapped()[0].startTime).toBe("2026-11-07T12:30:00.000Z"));

  it("returns null for a detail without markets", () => {
    const e = list.data.filter(isValidEvent)[0];
    expect(toForbetOffer(e, { ...detailOf(e), eventGames: [] }, "premier-league")).toBeNull();
  });

  it("the browser path stores the kickoff", async () => {
    const { result } = await oldBrowserRun();
    expect(result.matches[0].startTime).toBe("2026-11-07T12:30:00.000Z");
  });
});
