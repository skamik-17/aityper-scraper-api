// Regression tests for superbet normalizer fixes from the 2026-11-06 health
// check (docs/superpowers/plans/2026-11-06-scraper-recovery/superbet.md).
// Raw market names, ids and odds mirror the captured payloads in
// docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/superbet/.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { superbetNormalizer } from "../superbet-normalizer.js";
import { parseAllMarkets } from "../../../../scrapers/bookmakers/superbet/parser.js";
import type { SuperbetOddsSelection } from "../../../../scrapers/bookmakers/superbet/types.js";
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
const fraMar: NormalizationContext = {
  homeTeam: "France",
  awayTeam: "Morocco",
  league: "world-cup-2026",
};

function run(raw: RawBookmakerMarket, ctx: NormalizationContext) {
  const out = superbetNormalizer.normalizeMarket(raw, ctx);
  if (!out) throw new Error("normalizeMarket returned null");
  return out;
}

// OTHER-by-name results log an expected "[superbet] Unmapped market" warning.
// The spy silences it and lets tests assert which rows warn: id-routed rows
// must not, so the run log keeps no unmapped line for them.
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

  // All six team yes/no specials route to OTHER by id, so none of them logs
  // "[superbet] Unmapped market" (111 such lines per run before the fix).
  // Home rows (232507/232513/232515) are the ones above. Away rows
  // (232508/232514/232516) are Bournemouth - Nottingham Forest on the live
  // :3001 backend (superbet scrape 2026-11-13T17:00Z), where each of the
  // three names the away team.
  it.each([
    ["232507", "Bournemouth strzeli co najmniej 2 gole z rzędu", 2.27, 1.54],
    ["232508", "Nottingham Forest strzeli co najmniej 2 gole z rzędu", 3.55, 1.24],
    ["232513", "Bournemouth wygra wcześniej przegrywając", 8.6, 1.04],
    ["232514", "Nottingham Forest wygra wcześniej przegrywając", 15, 1.01],
    ["232515", "Bournemouth będzie prowadzić w dowolnym momencie", 1.49, 2.42],
    ["232516", "Nottingham Forest będzie prowadzić w dowolnym momencie", 2, 1.7],
  ] as const)("%s (%s) is OTHER by id and logs no unmapped warning", (id, name, tak, nie) => {
    const out = run(
      {
        bookmakerMarketId: id,
        name,
        selections: [
          { name: "Tak", odds: tak },
          { name: "Nie", odds: nie },
        ],
      },
      bou
    );
    expect(out.marketCode).toBe("OTHER");
    expect(out.marketKey).toBe("OTHER");
    expect(out.paramValue).toBeUndefined();
    expect(out.debug?.matchedBy).toBe("id");
    expect(console.warn).not.toHaveBeenCalled();
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
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[superbet] Unmapped market "Toulouse będzie prowadzić w dowolnym momencie" (id: none)'
    );
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
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[superbet] Unmapped market "Więcej asyst: Odegaard, Martin vs Tchaouna, Loum" (id: 232370)'
    );
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
    expect(console.warn).not.toHaveBeenCalled();
  });

  // Hypothetical ladder: every live 568 ladder (100 ladders on the 20 PL
  // fixtures, 2026-11-13) uses the catalog bands 0/1/2/3+. A band outside the
  // vocabulary (0,1,2,2+,3+) must become UNKNOWN. It must never reach the 1X2
  // mapper, where a bare "3" becomes DRAW.
  it("568 off-vocabulary bands become UNKNOWN, never DRAW", () => {
    const out = run(
      {
        bookmakerMarketId: "568",
        name: "1.połowa - dokładna liczba goli",
        selections: [
          { name: "0", odds: 3.85 },
          { name: "1", odds: 2.67 },
          { name: "2", odds: 3.55 },
          { name: "3", odds: 9.5 },
          { name: "4+", odds: 21 },
        ],
      },
      arsHul
    );
    expect(out.marketCode).toBe("HALF_TIME_EXACT_GOALS");
    expect(out.selections.map((s) => s.code)).toEqual(["0", "1", "2", "UNKNOWN", "UNKNOWN"]);
  });
});

// Superbet's "<X> lub obie drużyny strzelą gola" is one Tak/Nie market per
// result leg (231006 home, 231007 draw, 231008 away). "Nie" is NOT(<X> or
// BTTS), so neither happens. The catalog's <SIDE>_OR_BTTS_NO is "<X> or
// BTTS-No", a different and much shorter-priced bet. Only the tak leg is
// published, as forbet does. Raw values are the WC golden fixture entries
// 2705, 2728 and 2706 (Tak/Nie implied probabilities sum to 1.08, so "Nie" is
// the complement of "Tak").
describe("superbet: RESULT_OR_BTTS publishes only the tak leg", () => {
  it.each([
    ["231006", "Francja wygra lub obie drużyny strzelą gola", 1.15, 4.8, "HOME_OR_BTTS_YES"],
    ["231007", "Remis lub obie drużyny strzelą gola", 1.72, 2, "DRAW_OR_BTTS_YES"],
    ["231008", "Maroko wygra lub obie drużyny strzelą gola", 1.68, 2.07, "AWAY_OR_BTTS_YES"],
  ] as const)("%s (%s) keeps only the tak leg", (id, name, tak, nie, code) => {
    const out = run(
      {
        bookmakerMarketId: id,
        name,
        selections: [
          { name: "Tak", odds: tak },
          { name: "Nie", odds: nie },
        ],
      },
      fraMar
    );
    expect(out.marketCode).toBe("RESULT_OR_BTTS");
    expect(out.marketKey).toBe("RESULT_OR_BTTS");
    expect(out.paramValue).toBeUndefined();
    expect(out.debug?.matchedBy).toBe("id");
    expect(out.selections).toEqual([{ code, label: "Tak", odds: tak }]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("drops the market when there is no single tak leg", () => {
    const out = superbetNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "231006",
        name: "Francja wygra lub obie drużyny strzelą gola",
        selections: [{ name: "Nie", odds: 4.8 }],
      },
      fraMar
    );
    expect(out).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[superbet] RESULT_OR_BTTS: could not resolve the tak leg for "Francja wygra lub obie drużyny strzelą gola" (id: 231006)'
    );
  });

  it("drops the market on an unrecognised label", () => {
    const out = superbetNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "231007",
        name: "Remis lub obie drużyny strzelą gola",
        selections: [
          { name: "Tak", odds: 1.72 },
          { name: "Remis", odds: 2 },
        ],
      },
      fraMar
    );
    expect(out).toBeNull();
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
    expect(console.warn).not.toHaveBeenCalled();
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

// Player stat-line markets, parsed then normalized the way the scraper does
// it. Each player's ladder must land under its own `<CODE>:<player>` key with
// threshold selections only; a shared key would mix players' prices.
describe("superbet: player stat lines key the player", () => {
  // Verbatim API rows from Arsenal - Hull City (event 14438716, 2026-11-06).
  const sample = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../../scrapers/bookmakers/superbet/__tests__/fixtures/event-14438716-odds-sample.json", import.meta.url)
      ),
      "utf8"
    )
  ) as { oddsSample: SuperbetOddsSelection[] };

  function parseThenNormalize(odds: SuperbetOddsSelection[], ids: string[]) {
    return parseAllMarkets({ eventId: 14438716, matchName: "Arsenal·Hull City", tournamentId: 0, sportId: 5, odds })
      .filter((raw) => ids.includes(raw.bookmakerMarketId!))
      .map((raw) => ({ raw, out: run(raw, arsHul) }));
  }

  // marketKey -> ["<code>@<odds>", ...]; the key list is returned separately
  // so a collision (two raw markets on one key) cannot hide in the map.
  function ladders(results: ReturnType<typeof parseThenNormalize>) {
    const keys = results.map(({ out }) => out.marketKey);
    const byKey = Object.fromEntries(
      results.map(({ out }) => [out.marketKey, out.selections.map((s) => `${s.code}@${s.odds}`)])
    );
    return { keys, byKey };
  }

  it("236216/236222/239621 map each player's ladder to its own key", () => {
    const results = parseThenNormalize(sample.oddsSample, ["236216", "236222", "239621"]);
    const { keys, byKey } = ladders(results);

    expect(byKey).toEqual({
      "PLAYER_FOULS:John Egan": ["1+@1.36", "2+@2.7", "3+@5.75", "4+@13"],
      "PLAYER_FOULS:Viktor Gyokeres": ["1+@1.33", "2+@2.55", "3+@5.4", "4+@12"],
      "PLAYER_TACKLES:John Egan": ["1+@1.13", "2+@1.77", "3+@3.2", "4+@5.5", "5+@11"],
      "PLAYER_TACKLES:Viktor Gyokeres": ["1+@1.53", "2+@3.35", "3+@7.3"],
      "PLAYER_ASSISTS:John Egan": ["1+@20"],
      // 3+ is kept although the catalog lists only YES/NO/1+/2+ (owner decision).
      "PLAYER_ASSISTS:Viktor Gyokeres": ["1+@4.1", "2+@17", "3+@29"],
    });
    expect(new Set(keys).size).toBe(keys.length);
    for (const { out } of results) {
      expect(out.debug?.matchedBy).toBe("id");
      expect(out.marketKey).toBe(`${out.marketCode}:${out.paramValue}`);
    }
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("238453 (tackles suffered, no catalog code) is OTHER by id", () => {
    const results = parseThenNormalize(sample.oddsSample, ["238453"]);

    expect(results).toHaveLength(5);
    for (const { out } of results) {
      expect(out.marketCode).toBe("OTHER");
      expect(out.debug?.matchedBy).toBe("id");
    }
    expect(console.warn).not.toHaveBeenCalled();
  });

  // Right/left-foot shot lines have no catalog code either. One real row each
  // from parsed-ars-hul-2026-11-06.json.
  it.each([
    ["238477", "Zawodnik - liczba strzałów prawą nogą", 4.4],
    ["238473", "Zawodnik - liczba strzałów lewą nogą", 6.3],
    ["238461", "Zawodnik - liczba celnych strzałów prawą nogą", 11],
    ["238457", "Zawodnik - liczba celnych strzałów lewą nogą", 16],
  ] as const)("%s (%s) is OTHER by id", (id, name, odds) => {
    const out = run(
      { bookmakerMarketId: id, name, selections: [{ name: "John Egan - powyżej 0.5", odds }] },
      arsHul
    );
    expect(out.marketCode).toBe("OTHER");
    expect(out.debug?.matchedBy).toBe("id");
    expect(console.warn).not.toHaveBeenCalled();
  });

  // The sample has no rows for these four ids. Names, lines and prices are
  // real rows from parsed-ars-hul-2026-11-06.json (same event), in API order.
  // That capture keeps no specialBetValue, so it is rebuilt in today's
  // "sr:player:<id>-<Name>-<line>" format with the player ids the sample's
  // specifiers carry.
  const SR_PLAYER: Record<string, string> = {
    "John Egan": "sr:player:100578",
    "Viktor Gyokeres": "sr:player:869030",
  };
  function statRows(
    marketId: number,
    marketName: string,
    player: string,
    ladder: [line: string, price: number][]
  ): SuperbetOddsSelection[] {
    return ladder.map(
      ([line, price]) =>
        ({
          marketId,
          marketName,
          name: `${player} - powyżej ${line}`,
          price,
          status: "active",
          specialBetValue: `${SR_PLAYER[player]}-${player}-${line}`,
        }) as SuperbetOddsSelection
    );
  }
  const SOT = "Zawodnik - liczba celnych strzałów";
  const FOULS_WON = "Zawodnik - liczba fauli na zawodniku";
  const OUTSIDE = "Zawodnik - liczba strzałów spoza pola karnego";
  const SOT_OUTSIDE = "Zawodnik - liczba celnych strzałów spoza pola karnego";
  const moreRows: SuperbetOddsSelection[] = [
    ...statRows(236220, SOT, "John Egan", [["0.5", 5.25], ["1.5", 31]]),
    ...statRows(236220, SOT, "Viktor Gyokeres", [["0.5", 1.19], ["1.5", 1.92], ["2.5", 3.75], ["3.5", 7.5], ["4.5", 17]]),
    ...statRows(238449, FOULS_WON, "John Egan", [["0.5", 1.74], ["1.5", 4.45], ["2.5", 12]]),
    ...statRows(238449, FOULS_WON, "Viktor Gyokeres", [["0.5", 1.21], ["1.5", 2.05], ["2.5", 4.1], ["3.5", 8.1], ["4.5", 15]]),
    ...statRows(238469, SOT_OUTSIDE, "John Egan", [["0.5", 17]]),
    ...statRows(238469, SOT_OUTSIDE, "Viktor Gyokeres", [["0.5", 3.55], ["1.5", 15]]),
    ...statRows(238485, OUTSIDE, "John Egan", [["0.5", 6], ["1.5", 35]]),
    ...statRows(238485, OUTSIDE, "Viktor Gyokeres", [["0.5", 1.69], ["1.5", 4.15], ["2.5", 12]]),
  ];

  it("236220/238449/238485/238469 group one raw market per player and key the player", () => {
    const ids = ["236220", "238449", "238485", "238469"];
    const results = parseThenNormalize(moreRows, ids);
    for (const id of ids) {
      expect(results.filter(({ raw }) => raw.bookmakerMarketId === id), id).toHaveLength(2);
    }
    const { keys, byKey } = ladders(results);

    expect(byKey).toEqual({
      "PLAYER_SHOTS_ON_TARGET:John Egan": ["1+@5.25", "2+@31"],
      "PLAYER_SHOTS_ON_TARGET:Viktor Gyokeres": ["1+@1.19", "2+@1.92", "3+@3.75", "4+@7.5", "5+@17"],
      "PLAYER_FOULS_WON:John Egan": ["1+@1.74", "2+@4.45", "3+@12"],
      "PLAYER_FOULS_WON:Viktor Gyokeres": ["1+@1.21", "2+@2.05", "3+@4.1", "4+@8.1", "5+@15"],
      "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX:John Egan": ["1+@17"],
      "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX:Viktor Gyokeres": ["1+@3.55", "2+@15"],
      "PLAYER_SHOTS_OUTSIDE_BOX:John Egan": ["1+@6", "2+@35"],
      "PLAYER_SHOTS_OUTSIDE_BOX:Viktor Gyokeres": ["1+@1.69", "2+@4.15", "3+@12"],
    });
    expect(new Set(keys).size).toBe(keys.length);
    for (const { out } of results) {
      expect(out.debug?.matchedBy).toBe("id");
      expect(out.marketKey).toBe(`${out.marketCode}:${out.paramValue}`);
    }
    expect(console.warn).not.toHaveBeenCalled();
  });
});
