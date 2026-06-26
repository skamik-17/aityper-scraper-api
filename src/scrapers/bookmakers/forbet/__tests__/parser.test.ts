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
});
