import { describe, it, expect } from "vitest";
import { pzbukNormalizer } from "../pzbuk-normalizer.js";
import type { NormalizationContext } from "../../types.js";

const ctxARS: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Coventry City",
  league: "premier-league",
};

const ctxFRA: NormalizationContext = {
  homeTeam: "France",
  awayTeam: "Morocco",
  league: "world-cup-2026",
};

describe("pzbuk audit fixes", () => {
  // ===== Audit /audit-match round 8 (premier-league Arsenal vs Coventry City) =====

  it("PZBUK-19-AWAY-REGRESSION: id 19 stays AWAY_TEAM_TOTAL_GOALS, never HOME", () => {
    // Ground truth (raw3/premier_league_arsenal_coventry_city.json): pzbuk's
    // own "Gole druzyny" family under id 19 is labelled "Gole gości" (away
    // team goals) and its odds (2.19/1.58, 6.97/1.06) sit in the median of
    // the cross-bookmaker AWAY field for Coventry City, an order of
    // magnitude away from the HOME field for Arsenal. A prior guess had id
    // 19/20 swapped (fixed at commit 70a9d55) — this test pins the correct
    // side so a future edit cannot silently flip it back.
    const out = pzbukNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "19",
        groupName: "Gole druzyny",
        name: "Gole gości 0.5",
        selections: [
          { name: "ponad 0.5", odds: 2.19 },
          { name: "poniżej 0.5", odds: 1.58 },
        ],
      },
      ctxARS
    );
    expect(out?.marketCode).toBe("AWAY_TEAM_TOTAL_GOALS");
    expect(out?.marketCode).not.toBe("HOME_TEAM_TOTAL_GOALS");
    expect(out?.paramValue).toBe("0.5");
    expect(out?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);

    // Same regression on the second archived fixture (France vs Morocco).
    const outFra = pzbukNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "19",
        groupName: "Gole druzyny",
        name: "Gole gospodarzy 0.5",
        selections: [
          { name: "ponad 0.5", odds: 1.72 },
          { name: "poniżej 0.5", odds: 1.93 },
        ],
      },
      ctxFRA
    );
    expect(outFra?.marketCode).toBe("AWAY_TEAM_TOTAL_GOALS");
  });

  it("resolves the RESULT_AND_BTTS collision in favor of id 33, parking id 72 in OTHER", () => {
    // Ground truth: id 72 ("Rynek 72") sits earlier in the offer than id 33
    // and shares its 6-outcome "<team|remis> & <tak|nie>" vocabulary, so the
    // grouper's first-wins collision guard let it evict the genuine id 33
    // from RESULT_AND_BTTS. id 72's own DRAW_NO/AWAY_NO legs are internally
    // impossible against pzbuk's own 1X2 (id 1), while id 33 decomposes the
    // 1X2 to within 4% on every branch.
    const id33 = pzbukNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "33",
        groupName: "Gole",
        name: "Wynik meczu i obie drużyny strzelą",
        selections: [
          { name: "Arsenal FC & tak", odds: 3.05 },
          { name: "Arsenal FC & nie", odds: 1.65 },
          { name: "remis & tak", odds: 10.07 },
          { name: "remis & nie", odds: 18.67 },
          { name: "Coventry City & tak", odds: 32.43 },
          { name: "Coventry City & nie", odds: 25.55 },
        ],
      },
      ctxARS
    );
    expect(id33?.marketCode).toBe("RESULT_AND_BTTS");
    expect(id33?.selections.find((s) => s.code === "DRAW_NO")?.odds).toBe(18.67);

    const id72 = pzbukNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "72",
        groupName: "Inne",
        name: "Rynek 72",
        selections: [
          { name: "Arsenal FC & tak", odds: 12.04 },
          { name: "Arsenal FC & nie", odds: 1.59 },
          { name: "remis & tak", odds: 10.81 },
          { name: "remis & nie", odds: 3.54 },
          { name: "Coventry City & tak", odds: 83.56 },
          { name: "Coventry City & nie", odds: 12.04 },
        ],
      },
      ctxARS
    );
    expect(id72?.marketCode).toBe("OTHER");
  });

  it("resolves the DOUBLE_CHANCE_BTTS collision in favor of id 504, parking ids 498/503 in OTHER", () => {
    // Ground truth: five pzbuk raw markets (498/499/500/503/504) share the
    // same 6-outcome "<DC leg> & <tak|nie>" shape. Only id 504's odds match
    // the 10-bookmaker consensus and pzbuk's own BTTS (id 27) / id-33
    // cross-checks; id 498's implied P(second leg) is flat across all three
    // legs (~19%), which is structurally impossible for BTTS, and id 503's
    // legs match pzbuk's own HALF-TIME double chance, not the full-match one.
    const id504 = pzbukNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "504",
        groupName: "Inne",
        name: "Rynek 504",
        selections: [
          { name: "Arsenal FC/remis & tak", odds: 2.35 },
          { name: "Arsenal FC/remis & nie", odds: 1.53 },
          { name: "Arsenal FC/Coventry City & tak", odds: 2.73 },
          { name: "Arsenal FC/Coventry City & nie", odds: 1.56 },
          { name: "remis/Coventry City & tak", odds: 7.44 },
          { name: "remis/Coventry City & nie", odds: 10.41 },
        ],
      },
      ctxARS
    );
    expect(id504?.marketCode).toBe("DOUBLE_CHANCE_BTTS");
    expect(id504?.selections.find((s) => s.code === "X2_NO")?.odds).toBe(10.41);

    const id498 = pzbukNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "498",
        groupName: "Inne",
        name: "Podwójna szansa i obie drużyny strzelą",
        selections: [
          { name: "Arsenal FC/remis & tak", odds: 4.66 },
          { name: "Arsenal FC/remis & nie", odds: 1.13 },
          { name: "Arsenal FC/Coventry City & tak", odds: 5.16 },
          { name: "Arsenal FC/Coventry City & nie", odds: 1.18 },
          { name: "remis/Coventry City & tak", odds: 17.85 },
          { name: "remis/Coventry City & nie", odds: 4.36 },
        ],
      },
      ctxARS
    );
    // Explicitly parked, not merely unmapped: matchMarketByName() would
    // otherwise re-route this real API name to DOUBLE_CHANCE via its
    // "podwójna szansa" pattern and reopen the collision.
    expect(id498?.marketCode).toBe("OTHER");
    expect(id498?.marketCode).not.toBe("DOUBLE_CHANCE_BTTS");
    expect(id498?.marketCode).not.toBe("DOUBLE_CHANCE");

    const id503 = pzbukNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "503",
        groupName: "Inne",
        name: "Rynek 503",
        selections: [
          { name: "Arsenal FC/remis & tak", odds: 4.46 },
          { name: "Arsenal FC/remis & nie", odds: 1.24 },
          { name: "Arsenal FC/Coventry City & tak", odds: 7.04 },
          { name: "Arsenal FC/Coventry City & nie", odds: 1.42 },
          { name: "remis/Coventry City & tak", odds: 7.93 },
          { name: "remis/Coventry City & nie", odds: 3.17 },
        ],
      },
      ctxARS
    );
    expect(id503?.marketCode).toBe("OTHER");
  });
});
