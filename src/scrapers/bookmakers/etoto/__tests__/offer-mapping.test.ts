import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  driveBrowserScraperOffline,
  loadFixtureRoutes,
  withoutScrapedAt,
} from "../../../shared/rest-market/__tests__/offline-harness.js";
import { EtotoPlaywrightScraper } from "../index.js";
import { toEtotoOffer } from "../offer-mapping.js";
import { isValidEvent } from "../parser.js";
import type { EtotoEvent } from "../types.js";

const URLS = {
  list: "https://api.etoto.pl/rest/market/categories/multi/206/events",
  detail: (id: string) => `https://api.etoto.pl/rest/market/events/${id}`,
};
const fixture = (f: string) =>
  JSON.parse(readFileSync(new URL(`../../../shared/rest-market/__tests__/fixtures/etoto/${f}`, import.meta.url), "utf8"));
const list: { data: EtotoEvent[] } = fixture("list.json");
const detailOf = (e: EtotoEvent): EtotoEvent => fixture(`detail-${e.eventId}.json`).data;
const mapped = () =>
  list.data.filter(isValidEvent).map((e) => toEtotoOffer(e, detailOf(e), "premier-league")).filter((o) => o !== null);

async function oldBrowserRun() {
  const scraper = new EtotoPlaywrightScraper();
  const { calls } = driveBrowserScraperOffline(scraper, loadFixtureRoutes("etoto", URLS));
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

describe("toEtotoOffer", () => {
  it("equals today's browser output on the recorded payloads (scrapedAt aside)", async () => {
    const { result } = await oldBrowserRun();
    expect(result.success).toBe(true);
    expect(result.matches.map(withoutScrapedAt)).toEqual(mapped().map(withoutScrapedAt));
  });

  it("pins the recorded offer", async () => {
    const { result } = await oldBrowserRun();
    expect(result.matches.map((m) => [m.matchId, m.markets.length])).toEqual([["6224070", 40], ["6224074", 40], ["6224078", 40]]);
  });

  it("never requests the 'Dzień meczowy' pseudo-event", async () => {
    const { calls } = await oldBrowserRun();
    expect(calls).not.toContain(URLS.detail("6262615"));
  });

  it("takes the kickoff from eventStart", () => expect(mapped()[0].startTime).toBe("2026-11-07T12:30:00.000Z"));

  it("returns null for a detail without markets", () => {
    const e = list.data.filter(isValidEvent)[0];
    expect(toEtotoOffer(e, { ...detailOf(e), eventGames: [] }, "premier-league")).toBeNull();
  });

  it("the browser path stores the kickoff", async () => {
    const { result } = await oldBrowserRun();
    expect(result.matches[0].startTime).toBe("2026-11-07T12:30:00.000Z");
  });
});
