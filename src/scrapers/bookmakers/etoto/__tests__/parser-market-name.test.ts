import { describe, it, expect } from "vitest";
import { getMarketName, parseAllMarkets } from "../parser.js";
import type { EtotoEvent, EtotoGame } from "../types.js";

describe("etoto getMarketName", () => {
  it("uses the API-provided gameName as a real human-readable label", () => {
    const game: EtotoGame = {
      gameId: 1,
      gameType: 1,
      gameName: "1x2",
      outcomes: [],
    };
    const name = getMarketName(game);
    expect(name).toBe("1x2");
    // Must not be a placeholder like "Rynek <id>".
    expect(name).not.toMatch(/^Rynek \d+$/);
  });

  it("falls back to a derived name when gameName is blank", () => {
    const game: EtotoGame = {
      gameId: 2,
      gameType: 1,
      gameName: "",
      outcomes: [],
    };
    expect(getMarketName(game)).toBe("Wynik meczu");
  });
});

describe("etoto parseAllMarkets", () => {
  it("produces real names and a non-empty bookmakerMarketId per market", () => {
    const event: EtotoEvent = {
      eventId: 100,
      eventName: "Polska - Niemcy",
      categoryId: 666,
      eventGames: [
        {
          gameId: 10,
          gameType: 8,
          gameName: "Suma goli",
          argument: 2.5,
          outcomes: [
            {
              outcomeId: 1,
              outcomeName: "Powyżej 2.5",
              outcomeOdds: 1.85,
              outcomePosition: 1,
            },
            {
              outcomeId: 2,
              outcomeName: "Poniżej 2.5",
              outcomeOdds: 1.95,
              outcomePosition: 2,
            },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);
    expect(markets).toHaveLength(1);

    const market = markets[0];
    // Real, human-readable name derived from the API gameName.
    expect(market.name).toContain("Suma goli");
    expect(market.name).not.toMatch(/^Rynek \d+$/);
    // Stable market-type id is carried.
    expect(market.bookmakerMarketId).toBe("8");
    expect(market.bookmakerMarketId).not.toBe("");
  });
});
