import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

describe("Betclic goal options normalization", () => {
  it("should normalize 'Liczba goli - opcja I' to GOAL_RANGE", () => {
    const result = betclicNormalizer.normalizeMarket({
      name: "Liczba goli - opcja I",
      bookmakerMarketId: undefined,
      selections: [
        { name: "0 - 1", odds: 3.27 },
        { name: "2 - 3", odds: 1.93 },
        { name: "4 - 5", odds: 3.93 },
        { name: "6+", odds: 16.75 }
      ]
    }, {
      homeTeam: "Manchester City",
      awayTeam: "Arsenal"
    });

    expect(result?.marketCode).toBe("GOAL_RANGE");
    expect(result?.selections.map(selection => selection.code)).toEqual([
      "0-1",
      "2-3",
      "4-5",
      "6+"
    ]);
  });

  it("should normalize 'Liczba goli - opcja II' to EXACT_GOALS", () => {
    const result = betclicNormalizer.normalizeMarket({
      name: "Liczba goli - opcja II",
      bookmakerMarketId: undefined,
      selections: [
        { name: "0", odds: 11 },
        { name: "1", odds: 4.75 },
        { name: "2", odds: 3.5 },
        { name: "3", odds: 4.15 },
        { name: "4", odds: 6 },
        { name: "5", odds: 11.75 },
        { name: "6+", odds: 16.75 }
      ]
    }, {
      homeTeam: "Manchester City",
      awayTeam: "Arsenal"
    });

    expect(result?.marketCode).toBe("EXACT_GOALS");
    expect(result?.selections.map(selection => selection.code)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6+"
    ]);
  });
});
