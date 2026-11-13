import { describe, it, expect } from "vitest";
import { getMarketByCode, SELECTION_LABELS } from "../market-catalog.js";

/**
 * Catalog copy must describe the proposition the bookmakers actually price.
 * A label that names a different bet next to a real price is a misleading
 * price display, even when every code and price is right.
 */
describe("RESULT_OR_BTTS copy", () => {
  // etoto, superbet and forbet quote every "<X> lub obie strzelą" leg as its
  // own complementary Tak/Nie market (France v Morocco: Tak 1.15 / Nie 4.7,
  // implied 0.870 + 0.213 = 1.08). Their "Nie" is NOT(<X> or BTTS): neither
  // the result nor both teams scoring. The NO selections must say exactly
  // that, never "<X> or not both score" (a different, ~1.25 bet).
  const market = getMarketByCode("RESULT_OR_BTTS")!;

  it("NO description templates describe NEITHER (no result and not both score)", () => {
    expect(market.descriptionTemplates).toEqual({
      HOME_OR_BTTS_YES: "{homeTeam} wygrywa lub obie strzelą",
      AWAY_OR_BTTS_YES: "{awayTeam} wygrywa lub obie strzelą",
      DRAW_OR_BTTS_YES: "Remis lub obie strzelą",
      HOME_OR_BTTS_NO: "{homeTeam} nie wygrywa i przynajmniej jedna drużyna nie strzela gola",
      AWAY_OR_BTTS_NO: "{awayTeam} nie wygrywa i przynajmniej jedna drużyna nie strzela gola",
      DRAW_OR_BTTS_NO: "Brak remisu i przynajmniej jedna drużyna nie strzela gola",
    });
  });

  it("NO selection labels read as the negation of the YES leg, not as another either/or bet", () => {
    expect([
      SELECTION_LABELS.HOME_OR_BTTS_NO,
      SELECTION_LABELS.DRAW_OR_BTTS_NO,
      SELECTION_LABELS.AWAY_OR_BTTS_NO,
    ]).toEqual(["Ani 1, ani obie strzelą", "Ani X, ani obie strzelą", "Ani 2, ani obie strzelą"]);
    for (const side of ["HOME", "DRAW", "AWAY"]) {
      expect(SELECTION_LABELS[`${side}_OR_BTTS_NO`]).not.toMatch(/\blub\b/);
    }
  });

  it("market description explains both the either/or leg and its NEITHER complement", () => {
    expect(market.descriptions.pl).toBe(
      "Opcja „lub obie strzelą” wygrywa, jeśli padnie wybrany wynik meczu albo obie drużyny strzelą gola — wystarczy jeden z tych warunków. Opcja „ani…, ani obie strzelą” to zakład przeciwny: wygrywa tylko wtedy, gdy nie spełni się żaden z nich."
    );
    expect(market.descriptions.en).toBe(
      "The \"or both teams score\" pick wins if the chosen match result happens or both teams score — either condition is enough. The \"neither…, nor both teams score\" pick is the opposite bet: it wins only if neither condition happens."
    );
  });
});
