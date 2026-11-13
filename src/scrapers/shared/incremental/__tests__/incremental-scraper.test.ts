import { describe, expect, it, vi } from "vitest";
import { createScrapeBudget } from "../../budget.js";
import { HttpError } from "../../http/http-error.js";
import type { FullMatchOffer } from "../../../../types/full-offer.js";
import {
  fetchFullOfferIncrementally,
  isIncrementalScraper,
  transportTotals,
  type EventRef,
  type IncrementalScraper,
} from "../incremental-scraper.js";

const ref = (eventId: string): EventRef<{ id: string }> => ({
  eventId,
  homeTeam: `${eventId} Home`,
  awayTeam: `${eventId} Away`,
  kickoff: "2026-11-07T12:30:00.000Z",
  fingerprint: null,
  eventUrl: `https://x/${eventId}`,
  listing: { id: eventId },
});

const offer = (id: string): FullMatchOffer => ({
  matchId: id,
  bookmaker: "forbet",
  homeTeam: `${id} Home`,
  awayTeam: `${id} Away`,
  eventUrl: `https://x/${id}`,
  markets: [],
  scrapedAt: new Date(0),
});

function makeFake(listEvents: IncrementalScraper<{ id: string }>["listEvents"]): IncrementalScraper<{ id: string }> {
  return {
    bookmaker: "forbet",
    detailConcurrency: 2,
    scrapeFullOffer: vi.fn(),
    cleanup: vi.fn(),
    transportStats: () => ({ http: { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} } }),
    listEvents,
    fetchEvent: async (_league, r) => {
      if (r.eventId === "e2") throw new HttpError("http", "https://x/e2", 503, "fetch HTTP 503 https://x/e2");
      if (r.eventId === "e4") return null;
      return offer(r.eventId);
    },
  };
}

const fake = makeFake(async () => ["e1", "e2", "e3", "e4"].map(ref));
const failingListing = makeFake(async () => {
  throw new HttpError("http", "https://x/list", 404, "fetch HTTP 404 https://x/list");
});

describe("incremental scraper contract", () => {
  it("isIncrementalScraper needs listEvents, fetchEvent and transportStats", () => {
    expect(isIncrementalScraper(fake)).toBe(true);
    expect(isIncrementalScraper({ bookmaker: "forbet", scrapeFullOffer: vi.fn(), cleanup: vi.fn() } as any)).toBe(false);
    const { transportStats: _t, ...noStats } = fake;
    expect(isIncrementalScraper(noStats as any)).toBe(false);
  });

  it("fetchFullOfferIncrementally keeps listing order, skips failed details and drops empty ones", async () => {
    const r = await fetchFullOfferIncrementally(fake, "premier-league", createScrapeBudget(10_000));
    expect(r.matches.map((m) => m.matchId)).toEqual(["e1", "e3"]);
    expect(r.skipped).toEqual([{ id: "e2", error: "fetch HTTP 503 https://x/e2" }]);
  });

  it("transportTotals sums http and ws", () =>
    expect(
      transportTotals({
        http: { requests: 3, retries: 0, failures: 0, bytes: 900, byStatus: {} },
        ws: { framesReceived: 2, bytesReceived: 100 },
      }),
    ).toEqual({ requests: 3, bytes: 1000 }));

  it("fetchFullOfferIncrementally propagates a listing failure", async () =>
    await expect(
      fetchFullOfferIncrementally(failingListing, "premier-league", createScrapeBudget(10_000)),
    ).rejects.toThrow("fetch HTTP 404"));
});
