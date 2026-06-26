import { describe, it, expect } from "vitest";
import { parseMarket, parseAllMarkets } from "../parser.js";
import type { LVBetMarket } from "../types.js";

/**
 * These tests verify that LVBet full-offer markets surface RICH data for the
 * normalization audit: a real human-readable market name and a stable
 * bookmakerMarketId carried from the raw API market id.
 */
describe("LVBet parseMarket - rich audit data", () => {
  const sampleMarket: LVBetMarket = {
    id: 998877,
    match_id: "m-123",
    name: "Suma goli",
    line: "2.5",
    selections: [
      { id: 1, name: "Powyżej", order: 0, rate: { decimal: 1.85 }, status: "active" },
      { id: 2, name: "Poniżej", order: 1, rate: { decimal: 1.95 }, status: "active" },
    ],
  };

  it("produces a real, non-placeholder human-readable market name", () => {
    const result = parseMarket(sampleMarket);
    expect(result).not.toBeNull();
    // Real API label is used (with line appended), never a generic placeholder.
    expect(result!.name).toBe("Suma goli 2.5");
    expect(result!.name).not.toMatch(/^Unknown/);
    expect(result!.name).not.toMatch(/^Rynek\s/);
    expect(result!.name).not.toMatch(/^Selection/);
  });

  it("carries the stable LVBet market id as bookmakerMarketId", () => {
    const result = parseMarket(sampleMarket);
    expect(result).not.toBeNull();
    expect(result!.bookmakerMarketId).toBe("998877");
    expect(result!.bookmakerMarketId).toBeTruthy();
  });

  it("exposes bookmakerMarketId for every market via parseAllMarkets", () => {
    const markets = parseAllMarkets([sampleMarket]);
    expect(markets.length).toBeGreaterThan(0);
    for (const m of markets) {
      expect(m.bookmakerMarketId).toBeTruthy();
      expect(m.name).toBeTruthy();
    }
  });
});
