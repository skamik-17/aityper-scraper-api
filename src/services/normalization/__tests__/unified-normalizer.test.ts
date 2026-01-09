import { describe, it, expect } from "vitest";
import { normalizer } from "../index.js";
import { normalizeSelection } from "../core/selection-normalizer.js";
import { MARKET_REGISTRY } from "../../../data/market-registry.js";

describe("Unified Normalizer", () => {
  describe("STS ID Mapping", () => {
    it("should normalize Rynek 25 (Over/Under 2.5) via ID mapping", () => {
      const result = normalizer.normalize(
        {
          name: "Rynek 25",
          selections: [
            { name: "Over 2.5", odds: 1.85 },
            { name: "Under 2.5", odds: 1.95 },
          ],
        },
        "sts",
        "Arsenal",
        "Liverpool"
      );

      expect(result.normalizedType).toBe("TOTAL_GOALS");
      expect(result.category).toBe("GOLE");
    });

    it("should normalize Rynek 43 (BTTS) via ID mapping", () => {
      const result = normalizer.normalize(
        {
          name: "Rynek 43",
          selections: [
            { name: "Tak", odds: 1.75 },
            { name: "Nie", odds: 2.1 },
          ],
        },
        "sts",
        "Arsenal",
        "Liverpool"
      );

      expect(result.normalizedType).toBe("BTTS");
      expect(result.category).toBe("GOLE");
    });
  });

  describe("Pattern Matching", () => {
    it("should normalize 'Wynik meczu' to MATCH_WINNER", () => {
      const result = normalizer.normalize(
        {
          name: "Wynik meczu",
          selections: [
            { name: "1", odds: 2.5 },
            { name: "X", odds: 3.2 },
            { name: "2", odds: 2.8 },
          ],
        },
        "fortuna",
        "Arsenal",
        "Liverpool"
      );

      expect(result.normalizedType).toBe("MATCH_WINNER");
      expect(result.category).toBe("WYNIK_MECZU");
    });

    it("should normalize 'Obie drużyny strzelą gola' to BTTS", () => {
      const result = normalizer.normalize(
        {
          name: "Obie drużyny strzelą gola",
          selections: [
            { name: "Tak", odds: 1.75 },
            { name: "Nie", odds: 2.1 },
          ],
        },
        "superbet",
        "Arsenal",
        "Liverpool"
      );

      expect(result.normalizedType).toBe("BTTS");
      expect(result.category).toBe("GOLE");
    });

    it("should normalize 'Over/Under 2.5' with parameter extraction", () => {
      const result = normalizer.normalize(
        {
          name: "Over/Under 2.5",
          selections: [
            { name: "Over", odds: 1.85 },
            { name: "Under", odds: 1.95 },
          ],
        },
        "fortuna",
        "Arsenal",
        "Liverpool"
      );

      expect(result.normalizedType).toBe("TOTAL_GOALS");
      expect(result.category).toBe("GOLE");
      expect(result.paramValue).toBe("2.5");
    });
  });

  describe("Unknown Market Fallback", () => {
    it("should fall back to OTHER for unknown markets", () => {
      const result = normalizer.normalize(
        {
          name: "Some Unknown Market Type",
          selections: [
            { name: "Option A", odds: 2.0 },
            { name: "Option B", odds: 1.8 },
          ],
        },
        "fortuna",
        "Arsenal",
        "Liverpool"
      );

      expect(result.normalizedType).toBe("OTHER");
      expect(result.category).toBe("INNE");
    });
  });
});

describe("STS Adapter ID Mappings", () => {
  it("should have correct ID mappings", () => {
    const stsAdapter = normalizer.getAdapter("sts");
    expect(stsAdapter).toBeDefined();
    expect(stsAdapter?.idMappings).toBeDefined();

    expect(stsAdapter?.idMappings?.get(1)).toBe("match-winner");
    expect(stsAdapter?.idMappings?.get(25)).toBe("total-goals");
    expect(stsAdapter?.idMappings?.get(43)).toBe("btts");
    expect(stsAdapter?.idMappings?.get(4)).toBe("draw-no-bet");
  });

  it("should return undefined for unknown IDs", () => {
    const stsAdapter = normalizer.getAdapter("sts");
    expect(stsAdapter?.idMappings?.get(999)).toBeUndefined();
    expect(stsAdapter?.idMappings?.get(3)).toBeUndefined();
  });
});

describe("Selection Normalization", () => {
  it("should normalize Over selections", () => {
    const marketDef = MARKET_REGISTRY.find((m) => m.type === "TOTAL_GOALS");
    expect(marketDef).toBeDefined();

    const result = normalizeSelection(
      "Over 2.5",
      marketDef!,
      undefined,
      "Arsenal",
      "Liverpool"
    );
    expect(result.normalizedName).toBe("OVER");
  });

  it("should normalize Polish Over selections", () => {
    const marketDef = MARKET_REGISTRY.find((m) => m.type === "TOTAL_GOALS");
    expect(marketDef).toBeDefined();

    const result = normalizeSelection(
      "Powyżej 2.5",
      marketDef!,
      undefined,
      "Arsenal",
      "Liverpool"
    );
    expect(result.normalizedName).toBe("OVER");
  });

  it("should normalize Under selections", () => {
    const marketDef = MARKET_REGISTRY.find((m) => m.type === "TOTAL_GOALS");
    expect(marketDef).toBeDefined();

    const result = normalizeSelection(
      "Under 2.5",
      marketDef!,
      undefined,
      "Arsenal",
      "Liverpool"
    );
    expect(result.normalizedName).toBe("UNDER");
  });

  it("should normalize Yes/No (BTTS) selections", () => {
    const marketDef = MARKET_REGISTRY.find((m) => m.type === "BTTS");
    expect(marketDef).toBeDefined();

    const yesTak = normalizeSelection(
      "Tak",
      marketDef!,
      undefined,
      "Arsenal",
      "Liverpool"
    );
    expect(yesTak.normalizedName).toBe("YES");

    const noNie = normalizeSelection(
      "Nie",
      marketDef!,
      undefined,
      "Arsenal",
      "Liverpool"
    );
    expect(noNie.normalizedName).toBe("NO");
  });

  it("should normalize 1X2 selections", () => {
    const marketDef = MARKET_REGISTRY.find((m) => m.type === "MATCH_WINNER");
    expect(marketDef).toBeDefined();

    const home = normalizeSelection(
      "1",
      marketDef!,
      undefined,
      "Arsenal",
      "Liverpool"
    );
    expect(home.normalizedName).toBe("HOME");

    const draw = normalizeSelection(
      "X",
      marketDef!,
      undefined,
      "Arsenal",
      "Liverpool"
    );
    expect(draw.normalizedName).toBe("DRAW");

    const away = normalizeSelection(
      "2",
      marketDef!,
      undefined,
      "Arsenal",
      "Liverpool"
    );
    expect(away.normalizedName).toBe("AWAY");
  });
});
