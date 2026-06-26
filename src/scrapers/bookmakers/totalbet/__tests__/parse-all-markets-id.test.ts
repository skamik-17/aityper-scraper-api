import { describe, it, expect } from "vitest";
import { parseAllMarkets } from "../parser.js";
import { GAME_TYPES } from "../constants.js";
import type { TotalbetEvent } from "../types.js";

const event: TotalbetEvent = {
  eventId: 1,
  eventName: "Polska - Niemcy",
  categoryId: 7023,
  eventGames: [
    {
      gameId: 11,
      gameType: GAME_TYPES.MATCH_RESULT_1X2,
      gameName: "Wynik meczu",
      outcomes: [
        { outcomeId: 1, outcomeName: "1", outcomePosition: 1, outcomeOdds: 2.1 },
        { outcomeId: 2, outcomeName: "X", outcomePosition: 2, outcomeOdds: 3.2 },
        { outcomeId: 3, outcomeName: "2", outcomePosition: 3, outcomeOdds: 3.5 },
      ],
    },
    {
      gameId: 22,
      gameType: GAME_TYPES.BTTS,
      gameName: "Obie druzyny strzelą",
      outcomes: [
        { outcomeId: 4, outcomeName: "Tak", outcomePosition: 1, outcomeOdds: 1.8 },
        { outcomeId: 5, outcomeName: "Nie", outcomePosition: 2, outcomeOdds: 1.9 },
      ],
    },
  ],
};

describe("parseAllMarkets", () => {
  it("produces real human-readable names and a non-empty stable bookmakerMarketId", () => {
    const out = parseAllMarkets(event);

    expect(out).toHaveLength(2);

    const result1x2 = out[0];
    // Real, human-readable name (not a placeholder like "Rynek <id>")
    expect(result1x2.name).toBe("Wynik meczu");
    expect(result1x2.name).not.toMatch(/^Rynek\s/);
    // Stable market-type id carried from game.gameType
    expect(result1x2.bookmakerMarketId).toBe(String(GAME_TYPES.MATCH_RESULT_1X2));
    expect(result1x2.bookmakerMarketId).toBeTruthy();

    const btts = out[1];
    expect(btts.name).toBe("Obie druzyny strzelą");
    expect(btts.bookmakerMarketId).toBe(String(GAME_TYPES.BTTS));
  });
});
