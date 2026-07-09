import { describe, it, expect } from "vitest";
import { getMarketName, parseAllMarkets } from "../parser.js";
import { GAME_TYPES } from "../constants.js";
import type { ForbetEvent } from "../types.js";

describe("forBET parser - rich market data", () => {
  it("getMarketName returns the API-provided gameName when descriptive", () => {
    const name = getMarketName({
      gameType: GAME_TYPES.OVER_UNDER,
      gameName: "Poniżej/powyżej 2.5 goli",
      outcomes: [],
    });

    // Real human-readable label is preserved (capitalized first letter)
    expect(name).toBe("Poniżej/powyżej 2.5 goli");
  });

  it("parseAllMarkets produces real names and a non-empty bookmakerMarketId", () => {
    const event: ForbetEvent = {
      eventId: 12345,
      eventName: "Polska - Niemcy",
      eventGames: [
        {
          gameType: GAME_TYPES.MATCH_RESULT_1X2,
          gameName: "1x2",
          outcomes: [
            { outcomePosition: 1, outcomeName: "1", outcomeOdds: 2.1, outcomeId: 111 },
            { outcomePosition: 2, outcomeName: "X", outcomeOdds: 3.2, outcomeId: 222 },
            { outcomePosition: 3, outcomeName: "2", outcomeOdds: 3.4, outcomeId: 333 },
          ],
        },
        {
          gameType: GAME_TYPES.BTTS,
          gameName: "Obie drużyny strzelą gola",
          outcomes: [
            { outcomePosition: 1, outcomeName: "Tak", outcomeOdds: 1.8, outcomeId: 444 },
            { outcomePosition: 2, outcomeName: "Nie", outcomeOdds: 1.95, outcomeId: 555 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);

    expect(markets).toHaveLength(2);

    const oneX2 = markets[0];
    // bookmakerMarketId carries the stable forBET game type id
    expect(oneX2.bookmakerMarketId).toBe(String(GAME_TYPES.MATCH_RESULT_1X2));
    expect(oneX2.bookmakerMarketId).not.toBe("");
    // Name is a real, non-placeholder label (not "Rynek <id>")
    expect(oneX2.name).not.toMatch(/^Rynek /);
    // Home/away selections resolved to team names
    expect(oneX2.selections[0].name).toBe("Polska");
    expect(oneX2.selections[2].name).toBe("Niemcy");

    const btts = markets[1];
    expect(btts.bookmakerMarketId).toBe(String(GAME_TYPES.BTTS));
    expect(btts.name).toBe("Obie drużyny strzelą gola");
    expect(btts.name).not.toMatch(/^Rynek /);
  });

  it("keeps a lone genuine 101 price (does not treat it as sentinel padding)", () => {
    const event: ForbetEvent = {
      eventId: 22222,
      eventName: "Francja - Maroko",
      eventGames: [
        {
          gameType: -2901,
          gameName: "Multiwynik",
          outcomes: [
            { outcomePosition: 1, outcomeName: "1:0, 2:0 lub 3:0", outcomeOdds: 2.5, outcomeId: 1 },
            { outcomePosition: 2, outcomeName: "0:4, 0:5 lub 0:6", outcomeOdds: 101, outcomeId: 2 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);
    const multiResult = markets[0];
    expect(multiResult.selections.map((s) => s.name)).toContain("0:4, 0:5 lub 0:6");
    expect(multiResult.selections.find((s) => s.name === "0:4, 0:5 lub 0:6")?.odds).toBe(101);
  });

  it("drops the 101 sentinel once it recurs across many player-prop selections in the event", () => {
    const event: ForbetEvent = {
      eventId: 33333,
      eventName: "Francja - Maroko",
      eventGames: [
        {
          gameType: -99991,
          gameName: "Mbappe - liczba goli",
          outcomes: [
            { outcomePosition: 1, outcomeName: "Mbappe 1+", outcomeOdds: 1.5, outcomeId: 1 },
            { outcomePosition: 2, outcomeName: "Mbappe 2+", outcomeOdds: 3.5, outcomeId: 2 },
            { outcomePosition: 3, outcomeName: "Mbappe 3+", outcomeOdds: 101, outcomeId: 3 },
          ],
        },
        {
          gameType: -99992,
          gameName: "Griezmann - liczba goli",
          outcomes: [
            { outcomePosition: 1, outcomeName: "Griezmann 1+", outcomeOdds: 4.5, outcomeId: 4 },
            { outcomePosition: 2, outcomeName: "Griezmann 2+", outcomeOdds: 101, outcomeId: 5 },
          ],
        },
        {
          gameType: -99993,
          gameName: "Dembele - liczba goli",
          outcomes: [
            { outcomePosition: 1, outcomeName: "Dembele 1+", outcomeOdds: 3.2, outcomeId: 6 },
            { outcomePosition: 2, outcomeName: "Dembele 2+", outcomeOdds: 101, outcomeId: 7 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);
    const mbappe = markets.find((m) => m.name.startsWith("Mbappe"));
    expect(mbappe?.selections.map((s) => s.name)).toEqual(["Mbappe 1+", "Mbappe 2+"]);
  });
});
