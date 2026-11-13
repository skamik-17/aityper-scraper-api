import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FullMatchOffer, ScrapedMarket } from "../../types/full-offer.js";
import { classifyBookmakerRun } from "../run-outcome.js";

const m = vi.hoisted(() => ({ saveBatchFullOfferMarkets: vi.fn() }));
vi.mock("../../repositories/full-offer-repository.js", async () => ({
  saveBatchFullOfferMarkets: m.saveBatchFullOfferMarkets,
  saveFullOfferMarkets: vi.fn(),
}));
// Normalization is not under test here: pass the already-canonical market through.
vi.mock("../normalization/index.js", async () => ({
  normalizeMarketsForBookmaker: (markets: ScrapedMarket[]) => markets,
}));

import { normalizeAndSaveMatches } from "../scrape-helpers.js";

const ARSENAL = "premier-league:arsenal:hull city";

function twenty(): FullMatchOffer[] {
  return Array.from({ length: 20 }, (_, i) => ({
    matchId: `m${i}`,
    bookmaker: "forbet",
    homeTeam: `H${i}`,
    awayTeam: `A${i}`,
    eventUrl: `https://example.test/m${i}`,
    scrapedAt: new Date("2026-11-07T10:00:00.000Z"),
    markets: [{ name: "1X2", normalizedType: "MATCH_WINNER", marketKey: "MATCH_WINNER", selections: [] } as unknown as ScrapedMarket],
  }));
}

const saved = (over: Record<string, unknown> = {}) => ({
  inserted: 5130,
  filtered: 0,
  errors: 0,
  matchesProcessed: 20,
  failedBatches: 0,
  totalBatches: 11,
  firstError: null,
  ...over,
});

beforeEach(() => {
  m.saveBatchFullOfferMarkets.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("normalizeAndSaveMatches: degenerate writes", () => {
  it("a degenerate write makes the run partial with its cause", async () => {
    m.saveBatchFullOfferMarkets.mockResolvedValue(saved({ pruneSkipped: [{ match_id: ARSENAL, new_rows: 1, previous_rows: 312 }] }));
    const matches = twenty();
    const r = await normalizeAndSaveMatches(matches, "forbet", "premier-league", { useBatchInsert: true });
    expect(r.errors).toContain(`Prune skipped (degenerate write) for 1 of 20 matches: ${ARSENAL} 1/312 rows`);
    expect(r.pruneSkipped).toBe(1);
    expect(classifyBookmakerRun({ success: true, matches }, r).status).toBe("partial");
  });

  it("no skip adds neither an error nor a pruneSkipped key", async () => {
    m.saveBatchFullOfferMarkets.mockResolvedValue(saved());
    const r = await normalizeAndSaveMatches(twenty(), "forbet", "premier-league", { useBatchInsert: true });
    expect(r.errors).toEqual([]);
    expect("pruneSkipped" in r).toBe(false);
  });
});
