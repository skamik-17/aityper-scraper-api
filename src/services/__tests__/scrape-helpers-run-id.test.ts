import { describe, expect, it, vi } from "vitest";
import type { FullMatchOffer, ScrapedMarket } from "../../types/full-offer.js";

const m = vi.hoisted(() => ({
  saveBatchFullOfferMarkets: vi.fn(async () => ({ inserted: 1, filtered: 0, errors: 0, matchesProcessed: 1, failedBatches: 0, totalBatches: 1, firstError: null })),
}));
vi.mock("../../repositories/full-offer-repository.js", async () => ({
  saveBatchFullOfferMarkets: m.saveBatchFullOfferMarkets,
  saveFullOfferMarkets: vi.fn(),
}));
vi.mock("../normalization/index.js", async () => ({
  normalizeMarketsForBookmaker: (markets: ScrapedMarket[]) => markets,
}));

import { normalizeAndSaveMatches } from "../scrape-helpers.js";

const RUN_ID = "440d2fc6-658b-46fe-b288-05261faa0caf";
const match: FullMatchOffer = {
  matchId: "m0",
  bookmaker: "fortuna",
  homeTeam: "H",
  awayTeam: "A",
  eventUrl: "https://example.test/m0",
  scrapedAt: new Date("2026-11-07T10:00:00.000Z"),
  markets: [{ name: "1X2", normalizedType: "MATCH_WINNER", marketKey: "MATCH_WINNER", selections: [] } as unknown as ScrapedMarket],
};

describe("normalizeAndSaveMatches: run id", () => {
  it("passes the aggregator run id to the save", async () => {
    await normalizeAndSaveMatches([match], "fortuna", "premier-league", { useBatchInsert: true, runId: RUN_ID });
    expect(m.saveBatchFullOfferMarkets).toHaveBeenCalledWith(expect.any(Array), "fortuna", "premier-league", { runId: RUN_ID });
  });

  it("every match rejected after kickoff: rejectedStarted, no error, nothing saved", async () => {
    m.saveBatchFullOfferMarkets.mockResolvedValueOnce({
      inserted: 0, filtered: 0, errors: 0, matchesProcessed: 20, failedBatches: 0, totalBatches: 20, firstError: null,
      rejectedStarted: Array.from({ length: 20 }, (_, i) => `premier-league:h${i}:a${i}`),
    } as never);
    const twenty = Array.from({ length: 20 }, (_, i) => ({ ...match, matchId: `m${i}`, homeTeam: `H${i}`, awayTeam: `A${i}` }));
    const r = await normalizeAndSaveMatches(twenty, "fortuna", "premier-league", { useBatchInsert: true, runId: RUN_ID });
    expect(r.rejectedStarted).toBe(20);
    expect(r.errors).toEqual([]);
    expect(r.marketsSaved).toBe(0);
  });
});
