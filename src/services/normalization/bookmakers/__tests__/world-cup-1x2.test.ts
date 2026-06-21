import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";
import { stsNormalizer } from "../sts-normalizer.js";

/**
 * World Cup 1X2 normalization regression test.
 *
 * Bookmakers list national-team selections in Polish ("Argentyna", "Algieria")
 * while the match context uses the canonical English names ("Argentina",
 * "Algeria"). The 1X2 normalizer must resolve the Polish selection names to the
 * same canonical team so HOME/AWAY are assigned instead of UNKNOWN.
 */
describe("World Cup 1X2 selection normalization (Polish names → canonical)", () => {
  it("betclic: maps Polish national team names to HOME/AWAY", () => {
    const result = betclicNormalizer.normalizeMarket(
      {
        name: "Wynik meczu (z wyłączeniem dogrywki)",
        bookmakerMarketId: null,
        selections: [
          { name: "Argentyna", odds: 1.43 },
          { name: "Remis ", odds: 4.5 },
          { name: "Algieria", odds: 7.75 },
        ],
      },
      {
        homeTeam: "Argentina",
        awayTeam: "Algeria",
        league: "world-cup-2026",
      }
    );

    expect(result?.selections[0].code).toBe("HOME");
    expect(result?.selections[1].code).toBe("DRAW");
    expect(result?.selections[2].code).toBe("AWAY");
  });

  it("sts: maps Polish national team names to HOME/AWAY", () => {
    const result = stsNormalizer.normalizeMarket(
      {
        name: "Mecz",
        bookmakerMarketId: 1,
        selections: [
          { name: "Argentyna", odds: 1.45 },
          { name: "Remis", odds: 4.5 },
          { name: "Algieria", odds: 8 },
        ],
      },
      {
        homeTeam: "Argentina",
        awayTeam: "Algeria",
        league: "world-cup-2026",
      }
    );

    expect(result?.selections[0].code).toBe("HOME");
    expect(result?.selections[1].code).toBe("DRAW");
    expect(result?.selections[2].code).toBe("AWAY");
  });
});
