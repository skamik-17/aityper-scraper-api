import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

describe("Betclic BTTS By Half Normalization", () => {
  it("should normalize 'Oba zespoły strzelą w 1. i 2. połowie' to BTTS_BY_HALF", () => {
    const result = betclicNormalizer.normalizeMarket({
      name: "Oba zespoły strzelą w 1. i 2. połowie",
      bookmakerMarketId: undefined,
      selections: [
        { name: "Tak / Tak", odds: 16.75 },
        { name: "Tak / Nie", odds: 5.75 },
        { name: "Nie / Tak", odds: 4.2 },
        { name: "Nie / Nie", odds: 1.56 }
      ]
    }, {
      homeTeam: "Arsenal",
      awayTeam: "AFC Bournemouth"
    });

    expect(result?.marketCode).toBe("BTTS_BY_HALF");
    expect(result?.selections.map(selection => selection.code)).toEqual([
      "Both",
      "1st",
      "2nd",
      "None"
    ]);
  });
});
