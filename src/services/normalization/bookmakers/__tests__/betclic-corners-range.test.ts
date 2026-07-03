import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

// Current convention (normalization wave 2026-06): team-corner variants are
// UNIFIED under CORNERS_TEAM — the catalog entry's selections include both
// the over/under pair and the range buckets ("0-2", "3-4", "5-6", "7+").
// Range markets carry paramValue = team side; over/under markets carry
// "SIDE:line" so lines group per team. The old separate CORNERS_TEAM_RANGE
// routing was dropped for Betclic.

describe("Betclic corners range normalization", () => {
  it("normalizes team corners ranges under CORNERS_TEAM with the team side param", () => {
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

    expect(result?.marketCode).toBe("CORNERS_TEAM");
    expect(result?.paramValue).toBe("AWAY");
    expect(result?.selections.map(selection => selection.code)).toEqual([
      "0-2",
      "3-4",
      "5-6",
      "7+"
    ]);
  });

  it("maps over/under team corners to CORNERS_TEAM with a side-scoped line param", () => {
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
    expect(result?.paramValue).toBe("AWAY:4.5");
    expect(result?.selections.map(selection => selection.code)).toEqual([
      "OVER",
      "UNDER"
    ]);
  });
});
