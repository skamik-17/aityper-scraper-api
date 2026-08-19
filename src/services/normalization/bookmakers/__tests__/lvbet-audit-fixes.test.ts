import { describe, it, expect } from "vitest";
import { lvbetNormalizer } from "../lvbet-normalizer.js";
import { parseAllMarkets } from "../../../../scrapers/bookmakers/lvbet/parser.js";
import type { NormalizationContext } from "../../types.js";
import type { LVBetMarket } from "../../../../scrapers/bookmakers/lvbet/types.js";

const ctx: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Coventry City",
  league: "premier-league",
};

describe("lvbet audit fixes (audit-match, round 8, Arsenal vs Coventry City)", () => {
  // ===== P3: CORNERS_RACE_TO — verification-only, no code change =====
  it("P3: CORNERS_RACE_TO keeps 4 distinct thresholds (3/5/7/9), each HOME/AWAY/NONE", () => {
    const lines = ["3", "5", "7", "9"];
    const outputs = lines.map((line) =>
      lvbetNormalizer.normalizeMarket(
        {
          name: `Rzuty rożne: Wyścig do (${line}.0) ${line}`,
          groupName: "Statystyki",
          selections: [
            { name: "Arsenal", odds: 1.5 },
            { name: "Coventry City", odds: 6 },
            { name: "Brak", odds: 8 },
          ],
        },
        ctx
      )
    );
    for (const [i, out] of outputs.entries()) {
      expect(out?.marketCode).toBe("CORNERS_RACE_TO");
      expect(out?.paramValue).toBe(lines[i]);
      expect(out?.selections.map((s) => s.code).sort()).toEqual(["AWAY", "HOME", "NONE"]);
    }
    const keys = new Set(outputs.map((o) => o?.marketKey));
    expect(keys.size).toBe(4);
  });

  // ===== P1 / p1: bulk player-list threshold split (parser.ts) =====
  it("P1/p1: parser splits 'Zawodnicy (strzały) - powyżej N (musi rozpocząć...)' into one market per player+threshold", () => {
    const raw: LVBetMarket = {
      id: 1,
      name: 'Zawodnicy (strzały) - powyżej 2.5 (musi rozpocząć w wyjściowej "11")',
      line: "2.5",
      selections: [
        { name: "Viktor Gyokeres", rate: { decimal: 1.28 } },
        { name: "Gabriel Jesus", rate: { decimal: 1.55 } },
      ],
    } as unknown as LVBetMarket;
    const parsed = parseAllMarkets([raw], { homeTeam: "Arsenal", awayTeam: "Coventry City" });
    expect(parsed.length).toBe(2);
    for (const m of parsed) {
      expect(m.selections[0].name).toBe("Powyzej 2.5");
    }
    expect(parsed.map((m) => m.paramValue).sort()).toEqual(["Gabriel Jesus", "Viktor Gyokeres"]);

    // End to end through the normalizer: threshold survives as a "3+" tier,
    // player identity survives as paramValue.
    const normalized = lvbetNormalizer.normalizeMarket(parsed[0], ctx);
    expect(normalized?.marketCode).toBe("PLAYER_SHOTS");
    expect(normalized?.paramValue).toBe(parsed[0].paramValue);
    expect(normalized?.selections[0].code).toBe("3+");
  });

  it("P1/p1: 'Zawodnicy (strzały celne) - powyżej N (musi rozpocząć...)' splits the same way", () => {
    const raw: LVBetMarket = {
      id: 2,
      name: 'Zawodnicy (strzały celne) - powyżej 0.5 (musi rozpocząć w wyjściowej "11")',
      line: "0.5",
      selections: [{ name: "Viktor Gyokeres", rate: { decimal: 1.4 } }],
    } as unknown as LVBetMarket;
    const parsed = parseAllMarkets([raw], { homeTeam: "Arsenal", awayTeam: "Coventry City" });
    expect(parsed.length).toBe(1);
    expect(parsed[0].paramValue).toBe("Viktor Gyokeres");
    expect(parsed[0].selections[0].name).toBe("Powyzej 0.5");
    const normalized = lvbetNormalizer.normalizeMarket(parsed[0], ctx);
    expect(normalized?.marketCode).toBe("PLAYER_SHOTS_ON_TARGET");
    expect(normalized?.selections[0].code).toBe("1+");
  });

  // ===== P4: PLAYER_SHOTS_OVER 7.5 special case removed =====
  it("P4: the 7.5 threshold is no longer carved out to PLAYER_SHOTS_OVER — it joins the PLAYER_SHOTS ladder as '8+'", () => {
    const raw: LVBetMarket = {
      id: 3,
      name: 'Zawodnicy (strzały) - powyżej 7.5 (musi rozpocząć w wyjściowej "11")',
      line: "7.5",
      selections: [{ name: "Viktor Gyokeres", rate: { decimal: 8.9 } }],
    } as unknown as LVBetMarket;
    const parsed = parseAllMarkets([raw], { homeTeam: "Arsenal", awayTeam: "Coventry City" });
    const normalized = lvbetNormalizer.normalizeMarket(parsed[0], ctx);
    expect(normalized?.marketCode).toBe("PLAYER_SHOTS");
    expect(normalized?.marketCode).not.toBe("PLAYER_SHOTS_OVER");
    expect(normalized?.selections[0].code).toBe("8+");
  });

  // ===== lvbet-route / lvbet-selection-case / lvbet-parser-label: PLAYER_4_OR_MORE_GOALS =====
  it("PLAYER_4_OR_MORE_GOALS: 'Zawodnik strzeli 4 lub więcej goli' routes off the PLAYER_GOALS ladder with a YES selection", () => {
    const raw: LVBetMarket = {
      id: 4,
      name: "Zawodnik strzeli 4 lub więcej goli",
      paramValue: "Viktor Gyokeres",
      selections: [{ name: "4+", rate: { decimal: 71 } }],
    } as unknown as LVBetMarket;
    // Simulate the parser's bulk-split output directly (paramValue + fixed "Tak" label).
    const scraped = { name: raw.name, paramValue: "Viktor Gyokeres", selections: [{ name: "Tak", odds: 71 }] };
    const normalized = lvbetNormalizer.normalizeMarket(scraped, ctx);
    expect(normalized?.marketCode).toBe("PLAYER_4_OR_MORE_GOALS");
    expect(normalized?.marketCode).not.toBe("PLAYER_GOALS");
    expect(normalized?.paramValue).toBe("Viktor Gyokeres");
    expect(normalized?.selections[0].code).toBe("YES");
  });

  it("parser: the N>=3 bulk-split label is a constant 'Tak', not a synthesized 'N+' tier", () => {
    const raw: LVBetMarket = {
      id: 5,
      name: "Zawodnik strzeli 4 lub więcej goli",
      selections: [
        { name: "Viktor Gyokeres", rate: { decimal: 71 } },
        { name: "Gabriel Jesus", rate: { decimal: 90 } },
      ],
    } as unknown as LVBetMarket;
    const parsed = parseAllMarkets([raw], { homeTeam: "Arsenal", awayTeam: "Coventry City" });
    expect(parsed.length).toBe(2);
    for (const m of parsed) {
      expect(m.selections[0].name).toBe("Tak");
    }
  });

  // ===== lvbet-combo-format: shared canonical combo reduction =====
  it("combo markets reduce to abbreviated 'I. Surname & I. Surname' form, matching betclic/superbet peers", () => {
    const out = lvbetNormalizer.normalizeMarket(
      {
        name: "Trzech zawodników strzeli gola",
        groupName: "Inne",
        selections: [{ name: "Kai Havertz and Viktor Gyokeres and Gabriel Jesus", odds: 8 }],
      },
      ctx
    );
    expect(out?.marketCode).toBe("ALL_PLAYERS_SCORE");
    expect(out?.selections[0].code).toBe("G. Jesus & K. Havertz & V. Gyokeres");
  });

  // ===== lvbet-goal-range-mapping: GOAL_RANGE vs MULTI_GOAL_RANGE =====
  it("'Dokładna liczba goli (przedział)' (disjoint bands) maps to GOAL_RANGE with word-form selections", () => {
    const out = lvbetNormalizer.normalizeMarket(
      {
        name: "Dokładna liczba goli (przedział)",
        groupName: "Gole",
        selections: [
          { name: "0 lub 1", odds: 4.5 },
          { name: "2 lub 3", odds: 2.05 },
          { name: "4 do 6", odds: 2.6 },
          { name: "7 lub więcej", odds: 17 },
        ],
      },
      ctx
    );
    expect(out?.marketCode).toBe("GOAL_RANGE");
    expect(out?.selections.map((s) => s.code).sort()).toEqual(["0-1", "2-3", "4-6", "7+"]);
  });

  it("'Suma goli (przedziały)' (cumulative ladder) maps to MULTI_GOAL_RANGE, dropping the unparsable 'Każdy inny' catch-all", () => {
    const out = lvbetNormalizer.normalizeMarket(
      {
        name: "Suma goli (przedziały)",
        groupName: "Gole",
        selections: [
          { name: "1-2", odds: 2.5 },
          { name: "2-3", odds: 2.05 },
          { name: "7+", odds: 17 },
          { name: "Każdy inny", odds: 5.6 },
        ],
      },
      ctx
    );
    expect(out?.marketCode).toBe("MULTI_GOAL_RANGE");
    expect(out?.selections.map((s) => s.code).sort()).toEqual(["1-2", "2-3", "7+"]);
  });

  it("half-scoped 'Dokładna liczba goli (przedział)' variants are unaffected by the new full-match routing", () => {
    const out = lvbetNormalizer.normalizeMarket(
      {
        name: "1. Połowa - Dokładna liczba goli (przedział)",
        groupName: "Gole",
        selections: [{ name: "0 lub 1", odds: 1.5 }],
      },
      ctx
    );
    expect(out?.marketCode).not.toBe("GOAL_RANGE");
  });

  // ===== lvbet-htft-total: HALFTIME_FULLTIME_AND_TOTAL =====
  it("'(Do przerwy / koniec meczu) i suma goli X' routes to HALFTIME_FULLTIME_AND_TOTAL with HOME/DRAW/AWAY x OVER/UNDER selections", () => {
    const out = lvbetNormalizer.normalizeMarket(
      {
        name: "(Do przerwy / koniec meczu) i suma goli 2.5 2.5",
        groupName: "Gole",
        selections: [
          { name: "Arsenal/Arsenal i powyżej 2.5", odds: 1.98 },
          { name: "Arsenal/Arsenal i poniżej 2.5", odds: 4.75 },
          { name: "Arsenal / remis i powyżej 2.5", odds: 67 },
          { name: "Remis / Arsenal i powyżej 2.5", odds: 7 },
          { name: "Remis/remis i poniżej 2.5", odds: 9 },
          { name: "Coventry City / Coventry City i powyżej 2.5", odds: 46 },
        ],
      },
      ctx
    );
    expect(out?.marketCode).toBe("HALFTIME_FULLTIME_AND_TOTAL");
    expect(out?.paramValue).toBe("2.5");
    expect(out?.selections.map((s) => s.code).sort()).toEqual(
      ["AWAY_AWAY_OVER", "DRAW_DRAW_UNDER", "DRAW_HOME_OVER", "HOME_DRAW_OVER", "HOME_HOME_OVER", "HOME_HOME_UNDER"].sort()
    );
  });
});
