import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullMatchOffer } from "../../types/full-offer.js";

vi.mock("node:timers/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:timers/promises")>();
  return { ...actual, setImmediate: vi.fn(actual.setImmediate) };
});
vi.mock("../normalization/index.js", () => ({ normalizeMarketsForBookmaker: vi.fn((markets: unknown[]) => markets) }));
// The full BatchSaveResult (full-offer-repository.ts): scrape-helpers reads failedBatches/totalBatches/firstError.
vi.mock("../../repositories/full-offer-repository.js", () => ({
  saveBatchFullOfferMarkets: vi.fn(
    async (): Promise<BatchSaveResult> => ({
      inserted: 0,
      filtered: 0,
      errors: 0,
      matchesProcessed: 0,
      failedBatches: 0,
      totalBatches: 0,
      firstError: null,
    }),
  ),
  saveFullOfferMarkets: vi.fn(),
}));

import type { BatchSaveResult } from "../../repositories/full-offer-repository.js";
import { setImmediate as yieldSpy } from "node:timers/promises";
import { normalizeMarketsForBookmaker } from "../normalization/index.js";
import { normalizeAndSaveMatches } from "../scrape-helpers.js";

const match = (home: string, markets: unknown[] = []) =>
  ({ matchId: home, bookmaker: "lvbet", homeTeam: home, awayTeam: "X", eventUrl: "", markets, scrapedAt: new Date() }) as FullMatchOffer;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(normalizeMarketsForBookmaker).mockImplementation((mk) => mk);
});

describe("normalizeAndSaveMatches yields between matches (perf plan 01 Task 7)", () => {
  it("yields to the event loop once per match", async () => {
    await normalizeAndSaveMatches([match("A"), match("B"), match("C")], "lvbet", "premier-league", { useBatchInsert: true });
    expect(vi.mocked(yieldSpy)).toHaveBeenCalledTimes(3);
  });

  it("lets an already-queued callback run before the second match is normalized", async () => {
    const order: string[] = [];
    vi.mocked(normalizeMarketsForBookmaker).mockImplementation((mk, _bm, home) => {
      order.push(home!);
      return mk;
    });
    const p = normalizeAndSaveMatches([match("A"), match("B"), match("C")], "lvbet", "premier-league", { useBatchInsert: true });
    setImmediate(() => order.push("io"));
    await p;
    expect(order).toEqual(["A", "io", "B", "C"]);
  });

  it("a throwing match still yields, is recorded, and the next match is normalized (Review Focus 5)", async () => {
    vi.mocked(normalizeMarketsForBookmaker).mockImplementation((mk, _bm, home) => {
      if (home === "B") throw new Error("boom");
      return mk;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await normalizeAndSaveMatches([match("A"), match("B"), match("C")], "lvbet", "premier-league", {
      useBatchInsert: true,
    });
    expect(r.matchesProcessed).toBe(2);
    expect(r.errors).toEqual(["Normalization failed for B vs X: boom"]);
    expect(vi.mocked(yieldSpy)).toHaveBeenCalledTimes(3);
  });
});
