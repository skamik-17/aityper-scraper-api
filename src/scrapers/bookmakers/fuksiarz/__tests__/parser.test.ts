import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { parseAllMarkets } from "../parser.js";
import { GAME_TYPES } from "../constants.js";
import type { FuksiarzEvent } from "../types.js";

describe("parseAllMarkets - rich market data for audit", () => {
  const baseEvent: FuksiarzEvent = {
    eventId: 12345,
    eventName: "Lech Poznan - Legia Warszawa",
    categoryId: 265,
    eventGames: [
      {
        gameId: 1,
        gameType: GAME_TYPES.MATCH_RESULT_1X2,
        gameName: "1X2",
        outcomes: [
          { outcomeId: 101, outcomeName: "1", outcomeOdds: 2.1, outcomePosition: 1 },
          { outcomeId: 102, outcomeName: "X", outcomeOdds: 3.4, outcomePosition: 2 },
          { outcomeId: 103, outcomeName: "2", outcomeOdds: 3.2, outcomePosition: 3 },
        ],
      },
      {
        gameId: 2,
        gameType: GAME_TYPES.OVER_UNDER,
        gameName: "Liczba goli",
        outcomes: [
          { outcomeId: 201, outcomeName: "Powyżej 2.5", outcomeOdds: 1.85, outcomePosition: 1 },
          { outcomeId: 202, outcomeName: "Poniżej 2.5", outcomeOdds: 1.95, outcomePosition: 2 },
        ],
      },
    ],
  };

  it("produces a real human-readable name and stable bookmakerMarketId for a 1X2 market", () => {
    const markets = parseAllMarkets(baseEvent);

    const main = markets.find((m) => m.type === "1X2");
    expect(main).toBeDefined();

    // Name must be a real label, not a placeholder like "Rynek <id>"
    expect(main!.name).toBe("Wynik meczu");
    expect(main!.name).not.toMatch(/^Rynek\s/);

    // Stable market-type id must be carried for audit matching
    expect(main!.bookmakerMarketId).toBe(String(GAME_TYPES.MATCH_RESULT_1X2));
    expect(main!.bookmakerMarketId).toBeTruthy();
  });

  it("carries bookmakerMarketId on line-grouped Over/Under markets", () => {
    const markets = parseAllMarkets(baseEvent);

    const ou = markets.find((m) => m.type === "OVER_UNDER");
    expect(ou).toBeDefined();

    expect(ou!.name).toContain("Liczba goli");
    expect(ou!.bookmakerMarketId).toBe(String(GAME_TYPES.OVER_UNDER));
    expect(ou!.bookmakerMarketId).toBeTruthy();
  });

  it("sets a non-empty bookmakerMarketId on every produced market", () => {
    const markets = parseAllMarkets(baseEvent);
    expect(markets.length).toBeGreaterThan(0);
    for (const market of markets) {
      expect(market.bookmakerMarketId).toBeTruthy();
    }
  });
});

describe("parseAllMarkets - HALF_WITH_MORE_GOALS template-order guard", () => {
  // Fuksiarz's feed for game type 38 sends the outcome labels in template
  // order (1st half / equal / 2nd half). Two feed generations are covered:
  // - 2026-08 feed (audit-match Arsenal vs Coventry City, round 8
  //   fuk-hwmg-3, event 20831778): the prices arrived in provider order
  //   (1st half / 2nd half / equal), so "równo" carried the 2nd-half price
  //   and "2. połowa" carried the draw price.
  // - 2026-11 feed: the prices sit on the right labels, still in template
  //   order (live 20/20 PL matches, 2026-11-06).
  // With template order, "równo" priced shorter than "2. połowa" is either the
  // 2026-08 inversion or a genuine low-total match, so the market is dropped.
  const buildEvent = (
    outcomes: { outcomeId: number; outcomeName: string; outcomeOdds: number; outcomePosition: number }[]
  ): FuksiarzEvent => ({
    eventId: 20831778,
    eventName: "Arsenal - Coventry City",
    categoryId: 625,
    eventGames: [
      {
        gameId: 1,
        gameType: GAME_TYPES.HALF_WITH_MORE_GOALS,
        gameName: "Połowa z większą liczbą goli",
        outcomes,
      },
    ],
  });
  const findHwmg = (event: FuksiarzEvent) =>
    parseAllMarkets(event).find((m) => m.bookmakerMarketId === String(GAME_TYPES.HALF_WITH_MORE_GOALS));

  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("drops the 2026-08 inverted market ('równo' shorter than '2. połowa') and warns once", () => {
    const event = buildEvent([
      { outcomeId: 390826001, outcomeName: "1. połowa", outcomeOdds: 2.9, outcomePosition: 0 },
      { outcomeId: 390826002, outcomeName: "równo", outcomeOdds: 2.09, outcomePosition: 1 },
      { outcomeId: 390826003, outcomeName: "2. połowa", outcomeOdds: 3.6, outcomePosition: 2 },
    ]);

    expect(findHwmg(event)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("HALF_WITH_MORE_GOALS dropped");
    expect(String(warn.mock.calls[0][0])).toContain("20831778");
  });

  it("drops a genuine low-total market too, because it cannot be told apart from the inversion", () => {
    // Low expected total: an equal split (mostly 0-0) is the most likely outcome.
    // A swap would publish 2.5 as the 2nd-half price, a fake best price.
    const event = buildEvent([
      { outcomeId: 1, outcomeName: "1. połowa", outcomeOdds: 3.4, outcomePosition: 0 },
      { outcomeId: 2, outcomeName: "równo", outcomeOdds: 2.4, outcomePosition: 1 },
      { outcomeId: 3, outcomeName: "2. połowa", outcomeOdds: 2.5, outcomePosition: 2 },
    ]);

    expect(findHwmg(event)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("passes the labels through unchanged when they are not in template order", () => {
    const event = buildEvent([
      { outcomeId: 1, outcomeName: "1. połowa", outcomeOdds: 2.9, outcomePosition: 0 },
      { outcomeId: 2, outcomeName: "2. połowa", outcomeOdds: 2.09, outcomePosition: 1 },
      { outcomeId: 3, outcomeName: "równo", outcomeOdds: 3.6, outcomePosition: 2 },
    ]);

    const market = findHwmg(event);
    expect(market).toBeDefined();
    const bySelectionName = new Map(market!.selections.map((s) => [s.name, s.odds]));
    expect(bySelectionName.get("1. połowa")).toBe(2.9);
    expect(bySelectionName.get("2. połowa")).toBe(2.09);
    expect(bySelectionName.get("równo")).toBe(3.6);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps correctly priced template-order labels untouched", () => {
    // 2026-11 feed: Fuksiarz fixed the prices but kept the template label
    // order, so a label-only guard would invert correct data (live 20/20 PL matches).
    const event = buildEvent([
      { outcomeId: 1, outcomeName: "1. połowa", outcomeOdds: 2.9, outcomePosition: 0 },
      { outcomeId: 2, outcomeName: "równo", outcomeOdds: 3.65, outcomePosition: 1 },
      { outcomeId: 3, outcomeName: "2. połowa", outcomeOdds: 2.1, outcomePosition: 2 },
    ]);

    const market = findHwmg(event);
    expect(market).toBeDefined();

    const bySelectionName = new Map(market!.selections.map((s) => [s.name, s.odds]));
    expect(bySelectionName.get("równo")).toBe(3.65);
    expect(bySelectionName.get("2. połowa")).toBe(2.1);
    expect(bySelectionName.get("1. połowa")).toBe(2.9);
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes a zero 'równo' price through without a swap or a drop", () => {
    // The price guard cannot run on a missing price; hasValidOdds removes the zero selection.
    const event = buildEvent([
      { outcomeId: 1, outcomeName: "1. połowa", outcomeOdds: 2.9, outcomePosition: 0 },
      { outcomeId: 2, outcomeName: "równo", outcomeOdds: 0, outcomePosition: 1 },
      { outcomeId: 3, outcomeName: "2. połowa", outcomeOdds: 2.1, outcomePosition: 2 },
    ]);

    const market = findHwmg(event);
    expect(market).toBeDefined();
    expect(market!.selections.map((s) => [s.name, s.odds])).toEqual([
      ["1. połowa", 2.9],
      ["2. połowa", 2.1],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});
