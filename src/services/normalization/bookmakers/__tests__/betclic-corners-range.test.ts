import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

describe("Betclic corners range normalization", () => {
  it("should normalize team corners ranges as separate CORNERS_TEAM_RANGE market", () => {
    const result = betclicNormalizer.normalizeMarket({
      name: "Rzuty rożne - Przedziały - Arsenal",
      bookmakerMarketId: undefined,
      selections: [
        { name: "0 - 2", odds: 4.05 },
        { name: "3 - 4", odds: 2.72 },
        { name: "5 - 6", odds: 3.38 },
        { name: "7+", odds: 4.35 }
      ]
    }, {
      homeTeam: "Manchester City",
      awayTeam: "Arsenal"
    });

    expect(result?.marketCode).toBe("CORNERS_TEAM_RANGE");
    expect(result?.paramValue).toBeUndefined();
    expect(result?.customLabel).toBe("Rzuty rożne - Przedziały - Arsenal");
    expect(result?.selections.map(selection => selection.code)).toEqual([
      "0-2",
      "3-4",
      "5-6",
      "7+"
    ]);
  });

  it("should keep over/under team corners mapped to CORNERS_TEAM", () => {
    const result = betclicNormalizer.normalizeMarket({
      name: "Rzuty rożne (bez dogrywki) - Arsenal",
      bookmakerMarketId: undefined,
      selections: [
        { name: "Powyżej 4,5", odds: 1.92 },
        { name: "Poniżej 4,5", odds: 1.67 }
      ]
    }, {
      homeTeam: "Manchester City",
      awayTeam: "Arsenal"
    });

    expect(result?.marketCode).toBe("CORNERS_TEAM");
    expect(result?.paramValue).toBe("4.5");
    expect(result?.selections.map(selection => selection.code)).toEqual([
      "AWAY_OVER",
      "AWAY_UNDER"
    ]);
  });
});
