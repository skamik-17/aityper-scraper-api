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
