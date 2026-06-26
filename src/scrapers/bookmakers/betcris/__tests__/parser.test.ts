import { describe, it, expect } from "vitest";
import { parseAllMarkets } from "../parser.js";
import type { SwarmGame } from "../types.js";

describe("betcris parseAllMarkets - rich market metadata", () => {
  it("uses the API-provided market name and carries a stable bookmakerMarketId", () => {
    // Sample raw Swarm game with an API-provided human-readable market name
    // and a stable market-type code ("P1XP2").
    const game: SwarmGame = {
      id: 1001,
      team1_name: "Arsenal",
      team2_name: "Chelsea",
      team1_id: 1,
      team2_id: 2,
      start_ts: 1700000000,
      markets_count: 1,
      is_blocked: 0,
      game_number: 1,
      market: {
        "m1": {
          id: 5001,
          name: "Wynik meczu",
          type: "P1XP2",
          order: 1,
          col_count: 3,
          event: {
            "e1": { id: 9001, name: "W1", price: 2.1, order: 1, type_1: "W1" },
            "e2": { id: 9002, name: "X", price: 3.4, order: 2, type_1: "X" },
            "e3": { id: 9003, name: "W2", price: 3.2, order: 3, type_1: "W2" },
          },
        },
      },
    };

    const markets = parseAllMarkets(game);

    expect(markets).toHaveLength(1);
    const market = markets[0];

    // Real, human-readable name from the API (not a "Rynek <type>" placeholder)
    expect(market.name).toBe("Wynik meczu");
    expect(market.name).not.toMatch(/^Rynek /);

    // Stable market-type id is carried for audit matching by id
    expect(market.bookmakerMarketId).toBe("P1XP2");
    expect(market.bookmakerMarketId).toBeTruthy();
  });

  it("falls back to type-based name but still carries the id when API name is blank", () => {
    const game: SwarmGame = {
      id: 1002,
      team1_name: "Arsenal",
      team2_name: "Chelsea",
      team1_id: 1,
      team2_id: 2,
      start_ts: 1700000000,
      markets_count: 1,
      is_blocked: 0,
      game_number: 1,
      market: {
        "m1": {
          id: 5002,
          name: "",
          type: "BothTeamsToScore",
          order: 1,
          col_count: 2,
          event: {
            "e1": { id: 9101, name: "Yes", price: 1.8, order: 1, type_1: "Yes" },
            "e2": { id: 9102, name: "No", price: 1.9, order: 2, type_1: "No" },
          },
        },
      },
    };

    const markets = parseAllMarkets(game);

    expect(markets).toHaveLength(1);
    expect(markets[0].name).toBe("Obie druzyny strzela");
    expect(markets[0].bookmakerMarketId).toBe("BothTeamsToScore");
  });
});
