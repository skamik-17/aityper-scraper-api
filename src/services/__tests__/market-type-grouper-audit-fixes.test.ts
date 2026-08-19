import { describe, it, expect } from "vitest";
import { groupMarketsByTypeWithParameters } from "../market-type-grouper.js";
import type { ScrapedMarket } from "../../types/full-offer.js";

function mkMarket(overrides: Partial<ScrapedMarket>): ScrapedMarket {
  return {
    name: "Suma goli",
    type: "TOTAL_GOALS",
    normalizedType: "TOTAL_GOALS" as ScrapedMarket["normalizedType"],
    marketKey: "TOTAL_GOALS",
    selections: [],
    ...overrides,
  } as ScrapedMarket;
}

describe("grouper audit fixes — param key canonicalization", () => {
  it("merges '1' and '1.0' into a single parameter", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          paramValue: "1",
          selections: [{ name: "Ponad", normalizedName: "OVER", odds: 1.5 }],
        }),
        bookmaker: "sts",
      },
      {
        market: mkMarket({
          paramValue: "1.0",
          selections: [{ name: "Ponad", normalizedName: "OVER", odds: 1.52 }],
        }),
        bookmaker: "fortuna",
      },
    ]);
    const params = result[0].parameters.map((p) => p.value);
    expect(params).toEqual(["1"]);
    expect(result[0].parameters[0].bookmakers).toHaveLength(2);
  });

  it("does NOT touch score-format params like '1:0'", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          type: "CORRECT_SCORE",
          normalizedType: "CORRECT_SCORE" as ScrapedMarket["normalizedType"],
          marketKey: "CORRECT_SCORE",
          paramValue: "1:0",
          selections: [{ name: "1:0", normalizedName: "1:0", odds: 7.5 }],
        }),
        bookmaker: "sts",
      },
    ]);
    expect(result[0].parameters.map((p) => p.value)).toContain("1:0");
  });

  it("keeps signed handicap lines distinct (-1 vs 1)", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          type: "ASIAN_HANDICAP",
          normalizedType: "ASIAN_HANDICAP" as ScrapedMarket["normalizedType"],
          marketKey: "ASIAN_HANDICAP",
          paramValue: "-1",
          selections: [{ name: "1", normalizedName: "HOME", odds: 1.4 }],
        }),
        bookmaker: "sts",
      },
      {
        market: mkMarket({
          type: "ASIAN_HANDICAP",
          normalizedType: "ASIAN_HANDICAP" as ScrapedMarket["normalizedType"],
          marketKey: "ASIAN_HANDICAP",
          paramValue: "+1",
          selections: [{ name: "1", normalizedName: "HOME", odds: 2.9 }],
        }),
        bookmaker: "sts",
      },
    ]);
    const values = result[0].parameters.map((p) => p.value).sort();
    expect(values).toEqual(["-1", "1"]);
  });
});

describe("grouper audit fixes — no silent cross-market odds merge", () => {
  it("ignores selections from a DIFFERENT raw market colliding on bookmaker+param", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Podwójna szansa",
          type: "DOUBLE_CHANCE",
          normalizedType: "DOUBLE_CHANCE" as ScrapedMarket["normalizedType"],
          marketKey: "DOUBLE_CHANCE",
          selections: [{ name: "X2", normalizedName: "DRAW_OR_AWAY", odds: 1.26 }],
        }),
        bookmaker: "betfan",
      },
      {
        // Misrouted 2nd-half combo market normalized to the same type — its
        // odds must NOT overwrite/extend the first (plain) market's entry.
        market: mkMarket({
          name: "2. połowa - podwójna szansa i obie drużyny strzelą gola",
          type: "DOUBLE_CHANCE",
          normalizedType: "DOUBLE_CHANCE" as ScrapedMarket["normalizedType"],
          marketKey: "DOUBLE_CHANCE",
          selections: [
            { name: "X2 i tak", normalizedName: "DRAW_OR_AWAY", odds: 6.0 },
            { name: "1X i tak", normalizedName: "HOME_OR_DRAW", odds: 14 },
          ],
        }),
        bookmaker: "betfan",
      },
    ]);
    const bm = result[0].parameters[0].bookmakers.find((b) => b.bookmaker === "betfan")!;
    const drawOrAway = bm.selections.find((s) => s.type === "DRAW_OR_AWAY")!;
    expect(drawOrAway.odds).toBe(1.26); // first market wins, 6.0 not merged
    expect(bm.selections.find((s) => s.type === "HOME_OR_DRAW")).toBeUndefined();
  });

  it("keeps the FIRST odds when the SAME raw market repeats a selection type", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Podwójna szansa",
          type: "DOUBLE_CHANCE",
          normalizedType: "DOUBLE_CHANCE" as ScrapedMarket["normalizedType"],
          marketKey: "DOUBLE_CHANCE",
          selections: [
            { name: "1X", normalizedName: "HOME_OR_DRAW", odds: 1.45 },
            { name: "1X (dup)", normalizedName: "HOME_OR_DRAW", odds: 9.99 },
          ],
        }),
        bookmaker: "sts",
      },
    ]);
    const bm = result[0].parameters[0].bookmakers[0];
    expect(bm.selections.filter((s) => s.type === "HOME_OR_DRAW")).toHaveLength(1);
    expect(bm.selections[0].odds).toBe(1.45);
  });

  it("still merges selections from the same raw market split across rows", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Podwójna szansa",
          type: "DOUBLE_CHANCE",
          normalizedType: "DOUBLE_CHANCE" as ScrapedMarket["normalizedType"],
          marketKey: "DOUBLE_CHANCE",
          selections: [{ name: "1X", normalizedName: "HOME_OR_DRAW", odds: 1.45 }],
        }),
        bookmaker: "sts",
      },
      {
        market: mkMarket({
          name: "Podwójna szansa",
          type: "DOUBLE_CHANCE",
          normalizedType: "DOUBLE_CHANCE" as ScrapedMarket["normalizedType"],
          marketKey: "DOUBLE_CHANCE",
          selections: [{ name: "X2", normalizedName: "DRAW_OR_AWAY", odds: 1.27 }],
        }),
        bookmaker: "sts",
      },
    ]);
    const bm = result[0].parameters[0].bookmakers[0];
    expect(bm.selections.map((s) => s.type).sort()).toEqual(["DRAW_OR_AWAY", "HOME_OR_DRAW"]);
  });
});

describe("grouper audit fixes — no 'base' bucket on decimal-line markets", () => {
  it("drops entries without a numeric line from decimal-parameter markets", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          paramValue: "2.5",
          selections: [{ name: "Ponad", normalizedName: "OVER", odds: 1.6 }],
        }),
        bookmaker: "sts",
      },
      {
        // Misrouted entry with no extractable line — must not surface as "base".
        market: mkMarket({
          name: "Jakiś obcy rynek",
          paramValue: undefined,
          selections: [{ name: "tak", normalizedName: "UNKNOWN", odds: 5.7 }],
        }),
        bookmaker: "superbet",
      },
    ]);
    const params = result[0].parameters.map((p) => p.value);
    expect(params).toEqual(["2.5"]);
  });

  it("keeps the base bucket for non-parameterized markets (BTTS path)", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Obie drużyny strzelą",
          type: "BTTS",
          normalizedType: "BTTS" as ScrapedMarket["normalizedType"],
          marketKey: "BTTS",
          paramValue: undefined,
          selections: [
            { name: "Tak", normalizedName: "YES", odds: 1.9 },
            { name: "Nie", normalizedName: "NO", odds: 1.9 },
          ],
        }),
        bookmaker: "sts",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].parameters[0].bookmakers[0].selections).toHaveLength(2);
  });
});

describe("grouper audit fixes — no 'base' bucket on team-parameterized markets", () => {
  it("drops side-less entries from team-parameterized markets", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Kolumbia wygra którąkolwiek połowę",
          type: "TEAM_WIN_AT_LEAST_ONE_HALF",
          normalizedType: "TEAM_WIN_AT_LEAST_ONE_HALF" as ScrapedMarket["normalizedType"],
          marketKey: "TEAM_WIN_AT_LEAST_ONE_HALF:AWAY",
          paramValue: "AWAY",
          selections: [
            { name: "Tak", normalizedName: "YES", odds: 6.9 },
            { name: "Nie", normalizedName: "NO", odds: 1.07 },
          ],
        }),
        bookmaker: "fuksiarz",
      },
      {
        // Stale row keyed under the old market_key (no side param) — must not
        // create a phantom "base" parameter next to the real AWAY one.
        market: mkMarket({
          name: "Kolumbia wygra którąkolwiek połowę",
          type: "TEAM_WIN_AT_LEAST_ONE_HALF",
          normalizedType: "TEAM_WIN_AT_LEAST_ONE_HALF" as ScrapedMarket["normalizedType"],
          marketKey: "TEAM_WIN_AT_LEAST_ONE_HALF",
          paramValue: undefined,
          selections: [{ name: "tak", normalizedName: "UNKNOWN", odds: 6.8 }],
        }),
        bookmaker: "fuksiarz",
      },
    ]);
    const params = result[0].parameters.map((p) => p.value);
    expect(params).toEqual(["AWAY"]);
  });
});

describe("grouper audit fixes — player-name selection merging", () => {
  it("merges 'Lastname, Firstname' and 'Firstname Lastname' into one column", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Strzelec gola",
          type: "GOALSCORER_ANYTIME",
          normalizedType: "GOALSCORER_ANYTIME" as ScrapedMarket["normalizedType"],
          marketKey: "GOALSCORER_ANYTIME",
          selections: [{ name: "Jashari, Ardon", normalizedName: "Jashari, Ardon", odds: 5.0 }],
        }),
        bookmaker: "fuksiarz",
      },
      {
        market: mkMarket({
          name: "Strzelec gola",
          type: "GOALSCORER_ANYTIME",
          normalizedType: "GOALSCORER_ANYTIME" as ScrapedMarket["normalizedType"],
          marketKey: "GOALSCORER_ANYTIME",
          selections: [{ name: "Ardon Jashari", normalizedName: "Ardon Jashari", odds: 5.2 }],
        }),
        bookmaker: "betcris",
      },
    ]);
    const codes = new Set<string>();
    for (const b of result[0].parameters[0].bookmakers) for (const s of b.selections) codes.add(s.type);
    expect([...codes]).toEqual(["Ardon Jashari"]);
  });
});

describe("grouper audit fixes — invalid params on decimal markets", () => {
  it("drops bare side tokens (HOME/AWAY without a line) from decimal sliders", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM:4.5",
          paramValue: "4.5",
          selections: [{ name: "Ponad", normalizedName: "OVER", odds: 1.9 }],
        }),
        bookmaker: "sts",
      },
      {
        // Side label without a line — the number failed to parse upstream.
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM:HOME",
          paramValue: "HOME",
          selections: [{ name: "Ponad", normalizedName: "OVER", odds: 2.1 }],
        }),
        bookmaker: "betclic",
      },
      {
        // Side-scoped line is a valid composite param and must survive.
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM:HOME:5.5",
          paramValue: "HOME:5.5",
          selections: [{ name: "Ponad", normalizedName: "OVER", odds: 2.3 }],
        }),
        bookmaker: "betclic",
      },
    ]);
    const params = result[0].parameters.map((p) => p.value).sort();
    expect(params).toEqual(["4.5", "HOME:5.5"]);
  });
});

describe("grouper audit fixes — non-parameterized markets never leak a duplicate bucket", () => {
  it("collapses a stray non-base paramValue and the base bucket into ONE dummy parameter (not 2)", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        // A bookmaker normalizer accidentally emits a real paramValue for a
        // market the catalog declares hasParameter:false — this creates a
        // SECOND, distinct paramGroups key alongside "base".
        market: mkMarket({
          name: "1. połowa - wynik",
          type: "HALF_TIME_RESULT",
          normalizedType: "HALF_TIME_RESULT" as ScrapedMarket["normalizedType"],
          marketKey: "HALF_TIME_RESULT",
          paramValue: "0",
          selections: [
            { name: "1", normalizedName: "HOME", odds: 2.5 },
            { name: "X", normalizedName: "DRAW", odds: 2.1 },
            { name: "2", normalizedName: "AWAY", odds: 3.4 },
          ],
        }),
        bookmaker: "sts",
      },
      {
        // paramValue undefined -> falls back to "base" -> a SECOND paramGroups key
        market: mkMarket({
          name: "Wynik 1. połowy",
          type: "HALF_TIME_RESULT",
          normalizedType: "HALF_TIME_RESULT" as ScrapedMarket["normalizedType"],
          marketKey: "HALF_TIME_RESULT",
          paramValue: undefined,
          selections: [
            { name: "1", normalizedName: "HOME", odds: 2.6 },
            { name: "X", normalizedName: "DRAW", odds: 2.15 },
            { name: "2", normalizedName: "AWAY", odds: 3.3 },
          ],
        }),
        bookmaker: "fortuna",
      },
    ]);
    expect(result[0].parameters).toHaveLength(1);
    expect(result[0].parameters[0].value).toBe("");
    expect(result[0].parameters[0].label).toBe("");
    const bms = result[0].parameters[0].bookmakers.map((b) => b.bookmaker).sort();
    expect(bms).toEqual(["fortuna", "sts"]);
  });
});

describe("grouper audit fixes — recovers bundled multi-line markets instead of dropping them", () => {
  it("splits a single bookmaker entry that bundles multiple lines' selections into per-line parameters", () => {
    // Reproduces the real betclic DOUBLE_CHANCE_TOTAL shape: normalizeMarket()
    // returns ONE market (paramValue undefined) with all 4 lines' selections
    // crammed together, because the line only lives in each selection's raw
    // label ("Francja / Remis & Powyżej 2,5"), not in market.paramValue.
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Podwójna szansa & powyżej/poniżej",
          type: "DOUBLE_CHANCE_TOTAL",
          normalizedType: "DOUBLE_CHANCE_TOTAL" as ScrapedMarket["normalizedType"],
          marketKey: "DOUBLE_CHANCE_TOTAL",
          paramValue: undefined,
          selections: [
            { name: "Francja / Remis & Powyżej 1,5 ", normalizedName: "1X_OVER", odds: 1.47 },
            { name: "Francja / Remis & Poniżej 1,5 ", normalizedName: "1X_UNDER", odds: 4.2 },
            { name: "Francja / Remis & Powyżej 2,5 ", normalizedName: "1X_OVER", odds: 2.23 },
            { name: "Francja / Remis & Poniżej 2,5 ", normalizedName: "1X_UNDER", odds: 2.1 },
          ],
        }),
        bookmaker: "betclic",
      },
      {
        // Peer bookmaker already pre-split per line (the normal shape).
        market: mkMarket({
          name: "Podwójna szansa i liczba goli",
          type: "DOUBLE_CHANCE_TOTAL",
          normalizedType: "DOUBLE_CHANCE_TOTAL" as ScrapedMarket["normalizedType"],
          marketKey: "DOUBLE_CHANCE_TOTAL:1.5",
          paramValue: "1.5",
          selections: [
            { name: "1X i +1,5", normalizedName: "1X_OVER", odds: 1.5 },
            { name: "1X i -1,5", normalizedName: "1X_UNDER", odds: 4.0 },
          ],
        }),
        bookmaker: "sts",
      },
    ]);

    const params = result[0].parameters.map((p) => p.value).sort();
    expect(params).toEqual(["1.5", "2.5"]);

    const line15 = result[0].parameters.find((p) => p.value === "1.5")!;
    const betclicAt15 = line15.bookmakers.find((b) => b.bookmaker === "betclic")!;
    expect(betclicAt15.selections.find((s) => s.type === "1X_OVER")?.odds).toBe(1.47);
    expect(betclicAt15.selections.find((s) => s.type === "1X_UNDER")?.odds).toBe(4.2);
    const stsAt15 = line15.bookmakers.find((b) => b.bookmaker === "sts")!;
    expect(stsAt15.selections.find((s) => s.type === "1X_OVER")?.odds).toBe(1.5);

    const line25 = result[0].parameters.find((p) => p.value === "2.5")!;
    const betclicAt25 = line25.bookmakers.find((b) => b.bookmaker === "betclic")!;
    expect(betclicAt25.selections.find((s) => s.type === "1X_OVER")?.odds).toBe(2.23);
  });

  it("still drops a genuine misroute with a single embedded number (no bundling to recover)", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          paramValue: "2.5",
          selections: [{ name: "Ponad", normalizedName: "OVER", odds: 1.6 }],
        }),
        bookmaker: "sts",
      },
      {
        // Misrouted entry: only ONE embedded number, still not a real line for
        // THIS market — must stay dropped like before (round-2/3 behavior).
        market: mkMarket({
          name: "Jakiś obcy rynek o 1,5 czymś",
          paramValue: undefined,
          selections: [{ name: "Jakiś obcy rynek o 1,5 czymś", normalizedName: "UNKNOWN", odds: 5.7 }],
        }),
        bookmaker: "superbet",
      },
    ]);
    const params = result[0].parameters.map((p) => p.value);
    expect(params).toEqual(["2.5"]);
  });
});

describe("grouper audit fixes — recovers player markets bundled into one raw entry", () => {
  it("splits a single bookmaker entry listing many players into per-player parameters", () => {
    // Reproduces the real lvbet PLAYER_ASSISTS shape: one raw market
    // ("Zawodnik zanotuje asystę") lists every player as a SELECTION with no
    // paramValue, instead of one row per player (the shape betcris/etoto use).
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Zawodnik zanotuje asystę",
          type: "PLAYER_ASSISTS",
          normalizedType: "PLAYER_ASSISTS" as ScrapedMarket["normalizedType"],
          marketKey: "PLAYER_ASSISTS",
          paramValue: undefined,
          selections: [
            { name: "Michael Olise", normalizedName: "Michael Olise", odds: 3 },
            { name: "Kylian Mbappe", normalizedName: "Kylian Mbappe", odds: 4 },
          ],
        }),
        bookmaker: "lvbet",
      },
      {
        // Peer bookmaker already emits the normal one-row-per-player shape.
        market: mkMarket({
          name: "Kylian Mbappe - asysta",
          type: "PLAYER_ASSISTS",
          normalizedType: "PLAYER_ASSISTS" as ScrapedMarket["normalizedType"],
          marketKey: "PLAYER_ASSISTS:Kylian Mbappe",
          paramValue: "Kylian Mbappe",
          selections: [{ name: "1+", normalizedName: "1+", odds: 4.25 }],
        }),
        bookmaker: "betcris",
      },
    ]);

    const params = result[0].parameters.map((p) => p.value).sort();
    expect(params).toEqual(["Kylian Mbappe", "Michael Olise"]);

    const mbappe = result[0].parameters.find((p) => p.value === "Kylian Mbappe")!;
    const lvbetEntry = mbappe.bookmakers.find((b) => b.bookmaker === "lvbet")!;
    expect(lvbetEntry.selections[0].odds).toBe(4);
    const betcrisEntry = mbappe.bookmakers.find((b) => b.bookmaker === "betcris")!;
    expect(betcrisEntry.selections[0].odds).toBe(4.25);

    const olise = result[0].parameters.find((p) => p.value === "Michael Olise")!;
    expect(olise.bookmakers.find((b) => b.bookmaker === "lvbet")!.selections[0].odds).toBe(3);
  });

  it("does not split a genuinely single-player raw market (nothing to recover)", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Kylian Mbappe - asysta",
          type: "PLAYER_ASSISTS",
          normalizedType: "PLAYER_ASSISTS" as ScrapedMarket["normalizedType"],
          marketKey: "PLAYER_ASSISTS",
          paramValue: undefined,
          selections: [{ name: "1+", normalizedName: "1+", odds: 4.25 }],
        }),
        bookmaker: "betcris",
      },
    ]);
    // Single selection, no player identity embedded — stays in "base" untouched
    // (existing player-market base exemption from round 3 still applies).
    expect(result[0].parameters).toHaveLength(1);
    expect(result[0].parameters[0].value).toBe("base");
  });
});

describe("grouper audit fixes — player-name canonicalization on COMBINATION-viewType player markets", () => {
  it("canonicalizes player-pair selection names for TWO_PLAYERS_ANYTIME (viewType COMBINATION)", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Dwóch zawodników strzeli gola",
          type: "TWO_PLAYERS_ANYTIME",
          normalizedType: "TWO_PLAYERS_ANYTIME" as ScrapedMarket["normalizedType"],
          marketKey: "TWO_PLAYERS_ANYTIME",
          selections: [{ name: "Kante, N'Golo", normalizedName: "Kante, N'Golo", odds: 2.1 }],
        }),
        bookmaker: "betfan",
      },
    ]);
    const codes = new Set<string>();
    for (const b of result[0].parameters[0].bookmakers) for (const s of b.selections) codes.add(s.type);
    expect([...codes]).toEqual(["N'Golo Kante"]);
  });

  it("does not collapse multiple bundled player-pair selections into the catalog fallback code (round-2 AS loop regression: superbet PLAYER_PAIR)", () => {
    // BOTH_PLAYERS_ANYTIME/TWO_PLAYERS_ANYTIME have hasParameter:false but a
    // stray parameterType:"player" (the pair IS the selection, not a
    // parameter). superbet's raw pair labels are " i "-joined name-shaped
    // strings that pass looksLikePlayerName(), so the ungated player-split
    // used to fire here too and overwrite every selection's type with the
    // catalog's fallback code "PLAYER_PAIR" — collapsing 15 distinct real
    // pairs into one indistinguishable button. betcris/forbet/lvbet escaped
    // this only by coincidence (their "&" joiner fails looksLikePlayerName).
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          name: "Obaj gracze strzelą gola",
          type: "BOTH_PLAYERS_ANYTIME",
          normalizedType: "BOTH_PLAYERS_ANYTIME" as ScrapedMarket["normalizedType"],
          marketKey: "BOTH_PLAYERS_ANYTIME",
          paramValue: undefined,
          selections: [
            { name: "L. Messi i J. Alvarez", normalizedName: "L. Messi i J. Alvarez", odds: 1.44 },
            { name: "L. Messi i B. Embolo", normalizedName: "L. Messi i B. Embolo", odds: 3.3 },
            { name: "R. Vargas i L. Messi", normalizedName: "R. Vargas i L. Messi", odds: 7.9 },
          ],
        }),
        bookmaker: "superbet",
      },
    ]);
    const codes = new Set<string>();
    for (const p of result[0].parameters) for (const b of p.bookmakers) for (const s of b.selections) codes.add(s.type);
    expect(codes.has("PLAYER_PAIR")).toBe(false);
    expect([...codes].sort()).toEqual([
      "L. Messi i B. Embolo",
      "L. Messi i J. Alvarez",
      "R. Vargas i L. Messi",
    ]);
  });

  it("leaves non-name COMBINATION selection codes (e.g. score groups) untouched", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          type: "MULTI_RESULT",
          normalizedType: "MULTI_RESULT" as ScrapedMarket["normalizedType"],
          marketKey: "MULTI_RESULT",
          selections: [{ name: "1:0, 2:0 lub 3:0", normalizedName: "1:0, 2:0 lub 3:0", odds: 9 }],
        }),
        bookmaker: "sts",
      },
    ]);
    const codes = result[0].parameters[0].bookmakers[0].selections.map((s) => s.type);
    expect(codes).toEqual(["1:0, 2:0 lub 3:0"]);
  });

  it("merges side-scoped lines 'AWAY:2' and 'AWAY:2.0' into a single parameter (CORNERS_TEAM)", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM",
          paramValue: "AWAY:2",
          selections: [{ name: "Powyżej", normalizedName: "OVER", odds: 1.36 }],
        }),
        bookmaker: "betcris",
      },
      {
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM",
          paramValue: "AWAY:2.0",
          selections: [{ name: "Powyżej", normalizedName: "OVER", odds: 1.35 }],
        }),
        bookmaker: "lvbet",
      },
    ]);
    expect(result[0].parameters.map((p) => p.value)).toEqual(["AWAY:2"]);
    expect(result[0].parameters[0].bookmakers).toHaveLength(2);
  });

  it("keeps side-scoped lines for different sides distinct ('HOME:7' vs 'AWAY:7')", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM",
          paramValue: "HOME:7",
          selections: [{ name: "Powyżej", normalizedName: "OVER", odds: 1.68 }],
        }),
        bookmaker: "betcris",
      },
      {
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM",
          paramValue: "AWAY:7.0",
          selections: [{ name: "Powyżej", normalizedName: "OVER", odds: 2.1 }],
        }),
        bookmaker: "lvbet",
      },
    ]);
    expect(result[0].parameters.map((p) => p.value).sort()).toEqual(["AWAY:7", "HOME:7"]);
  });

  it("renders side-scoped param labels in Polish (Gospodarze/Goście)", () => {
    const result = groupMarketsByTypeWithParameters([
      {
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM",
          paramValue: "HOME:7.0",
          selections: [{ name: "Powyżej", normalizedName: "OVER", odds: 1.7 }],
        }),
        bookmaker: "lvbet",
      },
      {
        market: mkMarket({
          type: "CORNERS_TEAM",
          normalizedType: "CORNERS_TEAM" as ScrapedMarket["normalizedType"],
          marketKey: "CORNERS_TEAM",
          paramValue: "AWAY:2",
          selections: [{ name: "Powyżej", normalizedName: "OVER", odds: 1.36 }],
        }),
        bookmaker: "betcris",
      },
    ]);
    const labels = result[0].parameters.map((p) => p.label).sort();
    expect(labels).toEqual(["Gospodarze 7", "Goście 2"]);
  });
});
