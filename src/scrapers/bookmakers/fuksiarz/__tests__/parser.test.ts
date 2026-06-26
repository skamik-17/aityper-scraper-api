import { describe, it, expect } from "vitest";
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
