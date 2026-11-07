// Regression tests for superbet normalizer fixes from the 2026-11-06 health
// check (docs/superpowers/plans/2026-11-06-scraper-recovery/superbet.md).
// Raw market names, ids and odds mirror the captured payloads in
// docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/superbet/.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { superbetNormalizer } from "../superbet-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../../types.js";

const bou: NormalizationContext = {
  homeTeam: "AFC Bournemouth",
  awayTeam: "Nottingham Forest",
  league: "premier-league",
};
const touLyo: NormalizationContext = {
  homeTeam: "Toulouse",
  awayTeam: "Lyon",
  league: "ligue-1",
};
const arsHul: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Hull City",
  league: "premier-league",
};
const arsCov: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Coventry City",
  league: "premier-league",
};

function run(raw: RawBookmakerMarket, ctx: NormalizationContext) {
  const out = superbetNormalizer.normalizeMarket(raw, ctx);
  if (!out) throw new Error("normalizeMarket returned null");
  return out;
}

// OTHER-by-name results log an expected "[superbet] Unmapped market" warning;
// silence it so the test output stays clean.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("superbet: names containing 'ou' never become TOTAL_GOALS", () => {
  it("232515 Bournemouth leader market is OTHER by id", () => {
    const out = run(
      {
        bookmakerMarketId: "232515",
        name: "Bournemouth będzie prowadzić w dowolnym momencie",
        selections: [
          { name: "Tak", odds: 1.49 },
          { name: "Nie", odds: 2.42 },
        ],
      },
      bou
    );
    expect(out.marketCode).toBe("OTHER");
    expect(out.marketKey).toBe("OTHER");
    expect(out.debug?.matchedBy).toBe("id");
  });

  it("232507 Bournemouth 2-in-a-row is OTHER, not TOTAL_GOALS:2", () => {
    const out = run(
      {
        bookmakerMarketId: "232507",
        name: "Bournemouth strzeli co najmniej 2 gole z rzędu",
        selections: [
          { name: "Tak", odds: 2.27 },
          { name: "Nie", odds: 1.54 },
        ],
      },
      bou
    );
    expect(out.marketKey).toBe("OTHER");
    expect(out.paramValue).toBeUndefined();
  });

  it("232513 Bournemouth comeback is OTHER", () => {
    const out = run(
      {
        bookmakerMarketId: "232513",
        name: "Bournemouth wygra wcześniej przegrywając",
        selections: [
          { name: "Tak", odds: 8.6 },
          { name: "Nie", odds: 1.04 },
        ],
      },
      bou
    );
    expect(out.marketCode).toBe("OTHER");
  });

  it("Toulouse leader market without id is OTHER", () => {
    const out = run(
      {
        name: "Toulouse będzie prowadzić w dowolnym momencie",
        selections: [
          { name: "Tak", odds: 1.5 },
          { name: "Nie", odds: 2.4 },
        ],
      },
      touLyo
    );
    expect(out.marketCode).toBe("OTHER");
    expect(out.debug?.matchedBy).toBe("name");
  });

  it("genuine O/U names stay TOTAL_GOALS", () => {
    for (const name of ["O/U 2.5", "Over/Under 2.5"]) {
      const out = run(
        {
          name,
          selections: [
            { name: "Powyżej 2.5", odds: 1.8 },
            { name: "Poniżej 2.5", odds: 2.0 },
          ],
        },
        arsHul
      );
      expect(out.marketKey, name).toBe("TOTAL_GOALS:2.5");
      expect(out.selections.map((s) => s.code), name).toEqual(["OVER", "UNDER"]);
    }
  });

  it("player head-to-head with 'ou' name is OTHER", () => {
    const out = run(
      {
        bookmakerMarketId: "232370",
        name: "Więcej asyst: Odegaard, Martin vs Tchaouna, Loum",
        selections: [
          { name: "Odegaard, Martin", odds: 1.5 },
          { name: "Tchaouna, Loum", odds: 2.5 },
        ],
      },
      arsCov
    );
    expect(out.marketCode).toBe("OTHER");
  });
});

describe("superbet: exact-goals family maps by id", () => {
  // [id, marketCode, raw name, raw selections [name, odds], expected codes]
  // Raw values from exact-goals-1x2-raw-and-parsed-ars-hul-2026-11-06.json.
  const rows: [string, string, string, [string, number][], string[]][] = [
    [
      "541",
      "EXACT_GOALS",
      "Dokładna liczba goli",
      [
        ["0", 17],
        ["1", 6.3],
        ["2", 4.3],
        ["3", 4],
        ["4", 4.85],
        ["5", 7],
        ["6+", 7.4],
      ],
      ["0", "1", "2", "3", "4", "5", "6+"],
    ],
    [
      "540",
      "HOME_EXACT_GOALS",
      "Arsenal - dokładna liczba goli",
      [
        ["0", 9.5],
        ["1", 4.55],
        ["2", 3.55],
        ["3+", 1.85],
      ],
      ["0", "1", "2", "3+"],
    ],
    [
      "545",
      "AWAY_EXACT_GOALS",
      "Hull City - dokładna liczba goli",
      [
        ["0", 1.6],
        ["1", 2.87],
        ["2", 8.2],
        ["3+", 26],
      ],
      ["0", "1", "2", "3+"],
    ],
    [
      "568",
      "HALF_TIME_EXACT_GOALS",
      "1.połowa - dokładna liczba goli",
      [
        ["0", 3.85],
        ["1", 2.67],
        ["2", 3.55],
        ["3+", 4.6],
      ],
      ["0", "1", "2", "3+"],
    ],
    [
      "569",
      "HALF_TIME_AWAY_EXACT_GOALS",
      "1.połowa - Hull City - dokładna liczba goli",
      [
        ["0", 1.2],
        ["1", 4.4],
        ["2", 21],
        ["3+", 50],
      ],
      ["0", "1", "2", "3+"],
    ],
    // Regression: 558 was already mapped; its catalog top band is a bare "3".
    [
      "558",
      "HALF_TIME_HOME_EXACT_GOALS",
      "1.połowa - Arsenal - dokładna liczba goli",
      [
        ["0", 3],
        ["1", 2.5],
        ["2", 3.75],
        ["3+", 5.8],
      ],
      ["0", "1", "2", "3"],
    ],
  ];

  it.each(rows)("exact goals: id %s maps to %s", (id, marketCode, name, sels, codes) => {
    const out = run(
      {
        bookmakerMarketId: id,
        name,
        selections: sels.map(([selName, odds]) => ({ name: selName, odds })),
      },
      arsHul
    );
    expect(out.marketCode).toBe(marketCode);
    expect(out.marketKey).toBe(marketCode);
    expect(out.paramValue).toBeUndefined();
    expect(out.debug?.matchedBy).toBe("id");
    expect(out.selections.map((s) => s.code)).toEqual(codes);
    expect(out.selections.map((s) => s.odds)).toEqual(sels.map(([, odds]) => odds));
  });
});

// Characterization: pin today's (2026-11-06) player formats. Superbet now
// quotes players as "First Last" (no comma) and tags stat lines with
// specialBetValue "sr:player:<id>-<Name>-<line>". Raw values from
// parsed-ars-hul-2026-11-06.json (event 14438716).
describe("superbet: today's First-Last player formats", () => {
  it("236218 First-Last stat line keys the player", () => {
    const out = run(
      {
        bookmakerMarketId: "236218",
        name: "Zawodnik - liczba strzałów",
        selections: [
          { name: "John Egan - powyżej 0.5", odds: 2.12 },
          { name: "John Egan - powyżej 1.5", odds: 6 },
          { name: "John Egan - powyżej 2.5", odds: 17 },
        ],
      },
      arsHul
    );
    expect(out.marketCode).toBe("PLAYER_SHOTS");
    expect(out.marketKey).toBe("PLAYER_SHOTS:John Egan");
    expect(out.paramValue).toBe("John Egan");
    expect(out.selections.map((s) => s.code)).toEqual(["1+", "2+", "3+"]);
    expect(out.selections.map((s) => s.odds)).toEqual([2.12, 6, 17]);
  });

  it("236226 First-Last goalscorer stays verbatim", () => {
    const out = run(
      {
        bookmakerMarketId: "236226",
        name: "Zawodnik - strzeli gola",
        selections: [
          { name: "Viktor Gyokeres", odds: 1.78 },
          { name: "Kai Havertz", odds: 2 },
        ],
      },
      arsHul
    );
    expect(out.marketCode).toBe("GOALSCORER_ANYTIME");
    expect(out.selections.map((s) => s.code)).toEqual(["Viktor Gyokeres", "Kai Havertz"]);
    expect(out.selections.map((s) => s.odds)).toEqual([1.78, 2]);
  });

  it("233484 First-Last pair becomes combo form", () => {
    const out = run(
      {
        bookmakerMarketId: "233484",
        name: "Którykolwiek z zawodników strzeli gola",
        selections: [{ name: "Christos Tzolis lub Kai Havertz", odds: 1.45 }],
      },
      arsHul
    );
    expect(out.marketCode).toBe("TWO_PLAYERS_ANYTIME");
    expect(out.selections.map((s) => s.code)).toEqual(["C. Tzolis & K. Havertz"]);
    expect(out.selections[0].odds).toBe(1.45);
  });

  it("547 Mecz maps the 1X2 sides", () => {
    const out = run(
      {
        bookmakerMarketId: "547",
        name: "Mecz",
        selections: [
          { name: "Arsenal", odds: 1.17 },
          { name: "Remis", odds: 7.5 },
          { name: "Hull City", odds: 14 },
        ],
      },
      arsHul
    );
    expect(out.marketCode).toBe("MATCH_WINNER");
    expect(out.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
    expect(out.selections.map((s) => s.odds)).toEqual([1.17, 7.5, 14]);
  });
});
