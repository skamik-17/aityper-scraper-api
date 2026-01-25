import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

describe("Betclic Double Chance Normalization", () => {
  describe("Team name matching with abbreviations", () => {
    it("should handle 'Manchester Utd' abbreviation", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Podwójna Szansa",
        bookmakerMarketId: null,
        selections: [
          { name: "Arsenal lub remis", odds: 1.16 },
          { name: "Arsenal lub Manchester Utd", odds: 1.18 },
          { name: "Remis lub Manchester United", odds: 2.27 }
        ]
      }, {
        homeTeam: "Arsenal",
        awayTeam: "Manchester United",
        sport: "football"
      });

      expect(result?.selections[0].code).toBe("HOME_OR_DRAW");
      expect(result?.selections[1].code).toBe("HOME_OR_AWAY");
      expect(result?.selections[2].code).toBe("DRAW_OR_AWAY");
    });

    it("should handle 'West Brom' abbreviation", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Podwójna Szansa",
        bookmakerMarketId: null,
        selections: [
          { name: "West Brom lub remis", odds: 1.80 },
          { name: "West Brom lub Aston Villa", odds: 2.10 },
          { name: "Remis lub Aston Villa", odds: 2.50 }
        ]
      }, {
        homeTeam: "West Bromwich Albion",
        awayTeam: "Aston Villa",
        sport: "football"
      });

      expect(result?.selections[0].code).toBe("HOME_OR_DRAW");
      expect(result?.selections[1].code).toBe("HOME_OR_AWAY");
      expect(result?.selections[2].code).toBe("DRAW_OR_AWAY");
    });
  });

  describe("Polish team names with diacritics", () => {
    it("should handle Polish characters correctly", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Podwójna Szansa",
        bookmakerMarketId: null,
        selections: [
          { name: "Lech Poznań lub remis", odds: 1.20 },
          { name: "Lech Poznań lub Legia Warszawa", odds: 1.25 },
          { name: "Remis lub Legia Warszawa", odds: 2.50 }
        ]
      }, {
        homeTeam: "Lech Poznań",
        awayTeam: "Legia Warszawa",
        sport: "football"
      });

      expect(result?.selections[0].code).toBe("HOME_OR_DRAW");
      expect(result?.selections[1].code).toBe("HOME_OR_AWAY");
      expect(result?.selections[2].code).toBe("DRAW_OR_AWAY");
    });
  });

  describe("Short team names", () => {
    it("should handle single-word team names", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Podwójna Szansa",
        bookmakerMarketId: null,
        selections: [
          { name: "Real lub remis", odds: 1.30 },
          { name: "Real lub Barcelona", odds: 1.40 },
          { name: "Remis lub Barcelona", odds: 3.00 }
        ]
      }, {
        homeTeam: "Real",
        awayTeam: "Barcelona",
        sport: "football"
      });

      expect(result?.selections[0].code).toBe("HOME_OR_DRAW");
      expect(result?.selections[1].code).toBe("HOME_OR_AWAY");
      expect(result?.selections[2].code).toBe("DRAW_OR_AWAY");
    });
  });

  describe("Exact team name matches", () => {
    it("should handle exact team name matches", () => {
      const result = betclicNormalizer.normalizeMarket({
        name: "Podwójna Szansa",
        bookmakerMarketId: null,
        selections: [
          { name: "Arsenal lub remis", odds: 1.16 },
          { name: "Arsenal lub Manchester United", odds: 1.18 },
          { name: "Remis lub Manchester United", odds: 2.27 }
        ]
      }, {
        homeTeam: "Arsenal",
        awayTeam: "Manchester United",
        sport: "football"
      });

      expect(result?.selections[0].code).toBe("HOME_OR_DRAW");
      expect(result?.selections[1].code).toBe("HOME_OR_AWAY");
      expect(result?.selections[2].code).toBe("DRAW_OR_AWAY");
    });
  });
});
