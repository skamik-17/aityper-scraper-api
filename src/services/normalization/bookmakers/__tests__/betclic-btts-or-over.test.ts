import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

describe("Betclic BTTS or over combo normalization", () => {
  it("should normalize 'Oba zespoły strzelą gola lub Powyżej 2,5 gola w meczu' to BTTS_OR_OVER_2_5", () => {
    const result = betclicNormalizer.normalizeMarket({
      name: "Oba zespoły strzelą gola lub Powyżej 2,5 gola w meczu",
      bookmakerMarketId: undefined,
      selections: [
        { name: "Tak", odds: 1.5 },
        { name: "Nie", odds: 2.4 },
      ],
    }, {
      homeTeam: "Manchester City",
      awayTeam: "Arsenal",
    });

    expect(result?.marketCode).toBe("BTTS_OR_OVER_2_5");
    expect(result?.selections.map(selection => selection.code)).toEqual(["YES", "NO"]);
  });
});
