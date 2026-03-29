import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

describe("Betclic Win Both Halves Normalization", () => {
  it("should normalize home team market", () => {
    const result = betclicNormalizer.normalizeMarket({
      name: "Wygrają obie połowy - Arsenal",
      bookmakerMarketId: undefined,
      selections: [
        { name: "Tak", odds: 3.1 },
        { name: "Nie", odds: 1.29 }
      ]
    }, {
      homeTeam: "Arsenal",
      awayTeam: "AFC Bournemouth"
    });

    expect(result?.marketCode).toBe("HOME_WIN_BOTH_HALVES");
    expect(result?.selections[0].code).toBe("YES");
    expect(result?.selections[1].code).toBe("NO");
  });

  it("should normalize away team market when canonical away name has prefix", () => {
    const result = betclicNormalizer.normalizeMarket({
      name: "Wygrają obie połowy - Bournemouth",
      bookmakerMarketId: undefined,
      selections: [
        { name: "Tak", odds: 9.75 },
        { name: "Nie", odds: 1.01 }
      ]
    }, {
      homeTeam: "Arsenal",
      awayTeam: "AFC Bournemouth"
    });

    expect(result?.marketCode).toBe("AWAY_WIN_BOTH_HALVES");
    expect(result?.selections[0].code).toBe("YES");
    expect(result?.selections[1].code).toBe("NO");
  });
});
