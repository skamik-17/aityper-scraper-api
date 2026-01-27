import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

describe("Betclic Win At Least One Half Normalization", () => {
  describe("Away team wins at least one half", () => {
    it("should normalize 'Wygrają jedną z połów- Manchester United' to AWAY_WIN_AT_LEAST_ONE_HALF", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Wygrają jedną z połów- Manchester United",
        bookmakerMarketId: undefined,
        selections: [
          { name: "Tak", odds: 2.68 },
          { name: "Nie", odds: 1.41 }
        ]
      }, {
        homeTeam: "Arsenal",
        awayTeam: "Manchester United"
      });

      expect(result?.marketCode).toBe("AWAY_WIN_AT_LEAST_ONE_HALF");
      expect(result?.selections[0].code).toBe("YES");
      expect(result?.selections[1].code).toBe("NO");
    });

    it("should normalize 'Wygraną jedną z połów- Arsenal' to HOME_WIN_AT_LEAST_ONE_HALF", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Wygraną jedną z połów- Arsenal",
        bookmakerMarketId: undefined,
        selections: [
          { name: "Tak", odds: 1.85 },
          { name: "Nie", odds: 2.10 }
        ]
      }, {
        homeTeam: "Arsenal",
        awayTeam: "Manchester United"
      });

      expect(result?.marketCode).toBe("HOME_WIN_AT_LEAST_ONE_HALF");
      expect(result?.selections[0].code).toBe("YES");
      expect(result?.selections[1].code).toBe("NO");
    });

    it("should handle team name with abbreviations", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Wygrają jedną z połów- Manchester Utd",
        bookmakerMarketId: undefined,
        selections: [
          { name: "Tak", odds: 2.50 },
          { name: "Nie", odds: 1.50 }
        ]
      }, {
        homeTeam: "Arsenal",
        awayTeam: "Manchester United"
      });

      expect(result?.marketCode).toBe("AWAY_WIN_AT_LEAST_ONE_HALF");
      expect(result?.selections[0].code).toBe("YES");
      expect(result?.selections[1].code).toBe("NO");
    });

    it("should handle Polish team names with diacritics", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Wygraną jedną z połów- Lech Poznań",
        bookmakerMarketId: undefined,
        selections: [
          { name: "Tak", odds: 1.90 },
          { name: "Nie", odds: 1.95 }
        ]
      }, {
        homeTeam: "Lech Poznań",
        awayTeam: "Legia Warszawa"
      });

      expect(result?.marketCode).toBe("HOME_WIN_AT_LEAST_ONE_HALF");
      expect(result?.selections[0].code).toBe("YES");
      expect(result?.selections[1].code).toBe("NO");
    });
  });
});
