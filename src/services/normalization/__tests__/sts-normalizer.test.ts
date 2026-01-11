import { describe, it, expect } from "vitest";
import { stsNormalizer } from "../bookmakers/sts-normalizer.js";
import type { RawBookmakerMarket, NormalizationContext } from "../types.js";

const ctx: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Liverpool",
};

describe("stsNormalizer", () => {
  describe("ID-based market recognition", () => {
    it("normalizes MATCH_WINNER (Rynek 1)", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 1,
        name: "Rynek 1",
        selections: [
          { name: "1", odds: 2.1 },
          { name: "X", odds: 3.2 },
          { name: "2", odds: 3.5 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).not.toBeNull();
      expect(result!.marketCode).toBe("MATCH_WINNER");
      expect(result!.marketKey).toBe("MATCH_WINNER");
      expect(result!.selections).toHaveLength(3);
      expect(result!.selections[0].code).toBe("HOME");
      expect(result!.selections[1].code).toBe("DRAW");
      expect(result!.selections[2].code).toBe("AWAY");
    });

    it("normalizes TOTAL_GOALS with parameter (Rynek 25)", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 25,
        name: "Rynek 25",
        selections: [
          { name: "+2.5", odds: 1.9 },
          { name: "-2.5", odds: 1.85 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).not.toBeNull();
      expect(result!.marketCode).toBe("TOTAL_GOALS");
      expect(result!.paramValue).toBe("2.5");
      expect(result!.marketKey).toBe("TOTAL_GOALS:2.5");
      expect(result!.selections[0].code).toBe("OVER");
      expect(result!.selections[1].code).toBe("UNDER");
    });

    it("normalizes BTTS (Rynek 43)", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 43,
        name: "Rynek 43",
        selections: [
          { name: "Tak", odds: 1.75 },
          { name: "Nie", odds: 2.05 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).not.toBeNull();
      expect(result!.marketCode).toBe("BTTS");
      expect(result!.selections[0].code).toBe("YES");
      expect(result!.selections[1].code).toBe("NO");
    });

    it("normalizes DOUBLE_CHANCE (Rynek 10)", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 10,
        name: "Rynek 10",
        selections: [
          { name: "1X", odds: 1.35 },
          { name: "X2", odds: 1.55 },
          { name: "12", odds: 1.25 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).not.toBeNull();
      expect(result!.marketCode).toBe("DOUBLE_CHANCE");
      expect(result!.selections[0].code).toBe("HOME_OR_DRAW");
      expect(result!.selections[1].code).toBe("DRAW_OR_AWAY");
      expect(result!.selections[2].code).toBe("HOME_OR_AWAY");
    });

    it("normalizes CORRECT_SCORE (Rynek 283)", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 283,
        name: "Rynek 283",
        selections: [
          { name: "1:0", odds: 7.5 },
          { name: "2:1", odds: 9.0 },
          { name: "0:0", odds: 11.0 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).not.toBeNull();
      expect(result!.marketCode).toBe("CORRECT_SCORE");
      expect(result!.selections[0].code).toBe("1-0");
      expect(result!.selections[1].code).toBe("2-1");
      expect(result!.selections[2].code).toBe("0-0");
    });

    it("normalizes HALFTIME_FULLTIME (Rynek 58)", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 58,
        name: "Rynek 58",
        selections: [
          { name: "1/1", odds: 4.5 },
          { name: "1/X", odds: 15.0 },
          { name: "X/2", odds: 12.0 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).not.toBeNull();
      expect(result!.marketCode).toBe("HALFTIME_FULLTIME");
      expect(result!.selections[0].code).toBe("HOME_HOME");
      expect(result!.selections[1].code).toBe("HOME_DRAW");
      expect(result!.selections[2].code).toBe("DRAW_AWAY");
    });

    it("normalizes ASIAN_HANDICAP (Rynek 20)", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 20,
        name: "Rynek 20",
        selections: [
          { name: "1 (+0.5)", odds: 1.85 },
          { name: "2 (-0.5)", odds: 2.0 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).not.toBeNull();
      expect(result!.marketCode).toBe("ASIAN_HANDICAP");
      expect(result!.selections[0].code).toBe("HOME");
      expect(result!.selections[1].code).toBe("AWAY");
    });
  });

  describe("STS-specific selection codes", () => {
    it("handles STS draw code '3' as DRAW", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 1,
        name: "Rynek 1",
        selections: [
          { name: "1", odds: 2.1 },
          { name: "3", odds: 3.2 },
          { name: "2", odds: 3.5 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result!.selections[1].code).toBe("DRAW");
    });

    it("handles BTTS numeric codes 26/27", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 43,
        name: "Rynek 43",
        selections: [
          { name: "26", odds: 1.75 },
          { name: "27", odds: 2.05 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result!.selections[0].code).toBe("YES");
      expect(result!.selections[1].code).toBe("NO");
    });
  });

  describe("unknown markets", () => {
    it("returns null for unknown market ID", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 9999,
        name: "Rynek 9999",
        selections: [{ name: "Test", odds: 1.5 }],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).toBeNull();
    });

    it("returns null for non-Rynek format", () => {
      const raw: RawBookmakerMarket = {
        name: "Some Random Market",
        selections: [{ name: "Test", odds: 1.5 }],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result).toBeNull();
    });
  });

  describe("batch normalization", () => {
    it("normalizes multiple markets and filters nulls", () => {
      const markets: RawBookmakerMarket[] = [
        {
          bookmakerMarketId: 1,
          name: "Rynek 1",
          selections: [
            { name: "1", odds: 2.1 },
            { name: "X", odds: 3.2 },
            { name: "2", odds: 3.5 },
          ],
        },
        {
          bookmakerMarketId: 9999,
          name: "Rynek 9999",
          selections: [{ name: "Test", odds: 1.5 }],
        },
        {
          bookmakerMarketId: 43,
          name: "Rynek 43",
          selections: [
            { name: "Tak", odds: 1.75 },
            { name: "Nie", odds: 2.05 },
          ],
        },
      ];

      const results = stsNormalizer.normalizeMarkets!(markets, ctx);

      expect(results).toHaveLength(2);
      expect(results[0].marketCode).toBe("MATCH_WINNER");
      expect(results[1].marketCode).toBe("BTTS");
    });
  });

  describe("parameter extraction", () => {
    it("extracts decimal line from selection names", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 25,
        name: "Rynek 25",
        selections: [
          { name: "+3.5", odds: 2.1 },
          { name: "-3.5", odds: 1.7 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result!.paramValue).toBe("3.5");
      expect(result!.marketKey).toBe("TOTAL_GOALS:3.5");
    });

    it("handles comma decimal separator", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 25,
        name: "Rynek 25",
        selections: [
          { name: "+2,5", odds: 1.9 },
          { name: "-2,5", odds: 1.85 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result!.paramValue).toBe("2.5");
    });

    it("does not extract param for non-parametrized markets", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 1,
        name: "Rynek 1",
        selections: [
          { name: "1", odds: 2.1 },
          { name: "X", odds: 3.2 },
          { name: "2", odds: 3.5 },
        ],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result!.paramValue).toBeUndefined();
      expect(result!.marketKey).toBe("MATCH_WINNER");
    });
  });

  describe("debug info", () => {
    it("includes debug information in output", () => {
      const raw: RawBookmakerMarket = {
        bookmakerMarketId: 1,
        name: "Rynek 1",
        selections: [{ name: "1", odds: 2.1 }],
      };

      const result = stsNormalizer.normalizeMarket(raw, ctx);

      expect(result!.debug).toBeDefined();
      expect(result!.debug!.rawName).toBe("Rynek 1");
      expect(result!.debug!.rawId).toBe(1);
      expect(result!.debug!.matchedBy).toBe("id");
    });
  });
});
