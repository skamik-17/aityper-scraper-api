import { describe, it, expect } from "vitest";
import { parseAllMarkets } from "../parser.js";
import type { BetfanEvent } from "../types.js";

describe("parseAllMarkets - rich market data for normalization audit", () => {
  it("produces a real human-readable name and a non-empty bookmakerMarketId", () => {
    const event: BetfanEvent = {
      eventId: 12345,
      categoryId: 294,
      participants: [
        { participantId: 1, number: 1, participantName: "Lech Poznan" },
        { participantId: 2, number: 2, participantName: "Legia Warszawa" },
      ],
      games: [
        {
          gameId: 9001,
          gameType: 1, // MATCH_RESULT_1X2
          gameName: "Mecz",
          outcomes: [
            { outcomeId: 111, outcomeName: "1", outcomeOdds: 2.1, outcomePosition: 1 },
            { outcomeId: 112, outcomeName: "X", outcomeOdds: 3.3, outcomePosition: 2 },
            { outcomeId: 113, outcomeName: "2", outcomeOdds: 3.6, outcomePosition: 3 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);

    expect(markets).toHaveLength(1);
    const market = markets[0];

    // Real, human-readable name (from API gameName, capitalized) - not a placeholder
    expect(market.name).toBe("Mecz");
    expect(market.name).not.toMatch(/^Rynek\s/);

    // Stable market-type id is carried so the audit can match by id
    expect(market.bookmakerMarketId).toBe("1");
    expect(market.bookmakerMarketId).toBeTruthy();
  });

  it("carries the gameType id even when names rely on the hardcoded fallback", () => {
    const event: BetfanEvent = {
      eventId: 678,
      categoryId: 294,
      participants: [
        { participantId: 1, number: 1, participantName: "Home" },
        { participantId: 2, number: 2, participantName: "Away" },
      ],
      games: [
        {
          gameId: 9002,
          gameType: 98, // BTTS
          gameName: "", // blank -> triggers fallback name
          outcomes: [
            { outcomeId: 201, outcomeName: "Tak", outcomeOdds: 1.8, outcomePosition: 1 },
            { outcomeId: 202, outcomeName: "Nie", outcomeOdds: 1.9, outcomePosition: 2 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);

    expect(markets).toHaveLength(1);
    expect(markets[0].name).toBe("Obie druzyny strzelą");
    expect(markets[0].bookmakerMarketId).toBe("98");
  });
});
