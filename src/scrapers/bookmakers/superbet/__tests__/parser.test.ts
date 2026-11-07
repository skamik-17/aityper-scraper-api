import { describe, it, expect } from "vitest";
import { parseAllMarkets } from "../parser.js";
import type { SuperbetEvent } from "../types.js";

describe("parseAllMarkets - rich audit data", () => {
  // Minimal sample event with a known 1X2 market and an Over/Under market.
  const sampleEvent: SuperbetEvent = {
    eventId: 12345,
    matchName: "Lech Poznan · Legia Warszawa",
    tournamentId: 644,
    sportId: 5,
    odds: [
      { id: 1, marketId: 547, code: "1", name: "Lech Poznan", price: 2.1, status: "active" },
      { id: 2, marketId: 547, code: "0", name: "Remis", price: 3.4, status: "active" },
      { id: 3, marketId: 547, code: "2", name: "Legia Warszawa", price: 3.0, status: "active" },
      { id: 4, marketId: 200734, code: "O", name: "Powyzej", price: 1.85, specialBetValue: "2.5", status: "active" },
      { id: 5, marketId: 200734, code: "U", name: "Ponizej", price: 1.95, specialBetValue: "2.5", status: "active" },
    ],
  };

  it("produces a real (non-placeholder) market name and a non-empty bookmakerMarketId", () => {
    const markets = parseAllMarkets(sampleEvent);

    expect(markets.length).toBeGreaterThan(0);

    const matchResult = markets.find((m) => m.type === "1X2");
    expect(matchResult).toBeDefined();

    // Name must be the real human-readable label, not the "Rynek <id>" fallback.
    expect(matchResult!.name).toBe("Wynik meczu");
    expect(matchResult!.name).not.toMatch(/^Rynek \d+$/);

    // Stable market-type id must be carried for id-based audit matching.
    expect(matchResult!.bookmakerMarketId).toBe("547");
    expect(matchResult!.bookmakerMarketId).toBeTruthy();
  });

  it("carries bookmakerMarketId on every produced market", () => {
    const markets = parseAllMarkets(sampleEvent);

    for (const market of markets) {
      expect(market.bookmakerMarketId).toBeTruthy();
      expect(market.bookmakerMarketId).toMatch(/^\d+$/);
    }
  });
});

describe("parseAllMarkets - selection externalId", () => {
  // Real rows from Arsenal - Hull City (2026-11-06): today's API sends a
  // per-selection `uuid` and an `outcomeId`, and no numeric `id`. The third
  // row carries neither, to pin the "no identifier" case.
  const uuidEvent: SuperbetEvent = {
    eventId: 14438716,
    matchName: "Arsenal·Hull City",
    tournamentId: 0,
    sportId: 5,
    odds: [
      { uuid: "3b3179ac-c756-573c-8cd2-fdc0d5f5d00b", outcomeId: 1470, marketId: 547, code: "1", name: "1", price: 1.17, status: "active" },
      { uuid: "49ac60ac-1c1c-57e0-ae08-4b42023d1615", outcomeId: 1471, marketId: 547, code: "0", name: "X", price: 7.5, status: "active" },
      { marketId: 547, code: "2", name: "2", price: 14, status: "active" },
    ],
  };

  it("uses the selection uuid as externalId and leaves it undefined when absent", () => {
    const markets = parseAllMarkets(uuidEvent);

    expect(markets).toHaveLength(1);
    expect(markets[0].selections.map((s) => s.externalId)).toEqual([
      "3b3179ac-c756-573c-8cd2-fdc0d5f5d00b",
      "49ac60ac-1c1c-57e0-ae08-4b42023d1615",
      undefined,
    ]);
  });

  it("never emits the literal string 'undefined' as externalId", () => {
    const markets = parseAllMarkets(uuidEvent);

    for (const market of markets) {
      for (const selection of market.selections) {
        expect(selection.externalId).not.toBe("undefined");
      }
    }
  });

  it("still stringifies the legacy numeric id when no uuid is present", () => {
    const legacyEvent: SuperbetEvent = {
      eventId: 12345,
      matchName: "Lech Poznan · Legia Warszawa",
      tournamentId: 644,
      sportId: 5,
      odds: [{ id: 1, marketId: 547, code: "1", name: "Lech Poznan", price: 2.1 }],
    };

    const markets = parseAllMarkets(legacyEvent);

    expect(markets).toHaveLength(1);
    expect(markets[0].selections[0].externalId).toBe("1");
  });
});
