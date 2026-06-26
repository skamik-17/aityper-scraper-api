import { describe, it, expect } from "vitest";
import { parseAllMarkets, getMarketName } from "../parser.js";
import { MARKET_TYPES } from "../constants.js";
import type { PZBukInitialState } from "../types.js";

describe("pzbuk parseAllMarkets - rich names and stable ids", () => {
  it("uses the real API market name and carries bookmakerMarketId", () => {
    const data: PZBukInitialState = {
      events: [],
      markets: [
        {
          id: "mkt-1",
          // Real human-readable name provided by the PZBuk API
          name: "Wynik meczu (1X2)",
          eventId: "evt-1",
          isSuspended: false,
          marketType: { id: MARKET_TYPES.MATCH_RESULT, name: "Match Result" },
        },
      ],
      selections: [
        {
          id: "sel-h",
          name: "Real Madryt",
          trueOdds: 1.8,
          marketId: "mkt-1",
          marketTypeId: MARKET_TYPES.MATCH_RESULT,
          eventId: "evt-1",
          outcomeType: "Home",
          status: "Active",
          order: 0,
        },
        {
          id: "sel-d",
          name: "Remis",
          trueOdds: 3.5,
          marketId: "mkt-1",
          marketTypeId: MARKET_TYPES.MATCH_RESULT,
          eventId: "evt-1",
          outcomeType: "Tie",
          status: "Active",
          order: 1,
        },
      ],
    };

    const markets = parseAllMarkets(data, "evt-1");

    expect(markets).toHaveLength(1);
    const market = markets[0];

    // Real (non-placeholder) name from the API is surfaced
    expect(market.name).toBe("Wynik meczu (1X2)");
    expect(market.name).not.toMatch(/^Rynek /);

    // Stable market-type id is carried for audit matching
    expect(market.bookmakerMarketId).toBe(MARKET_TYPES.MATCH_RESULT);
    expect(market.bookmakerMarketId).toBeTruthy();
  });

  it("falls back to the hard-coded label when the API name is blank", () => {
    const data: PZBukInitialState = {
      events: [],
      markets: [
        {
          id: "mkt-2",
          name: "",
          eventId: "evt-1",
          isSuspended: false,
          marketType: { id: MARKET_TYPES.MATCH_RESULT, name: "" },
        },
      ],
      selections: [
        {
          id: "sel-h",
          name: "Real Madryt",
          trueOdds: 1.8,
          marketId: "mkt-2",
          marketTypeId: MARKET_TYPES.MATCH_RESULT,
          eventId: "evt-1",
          outcomeType: "Home",
          status: "Active",
          order: 0,
        },
      ],
    };

    const markets = parseAllMarkets(data, "evt-1");

    expect(markets).toHaveLength(1);
    // Hard-coded fallback label, still carrying the stable id
    expect(markets[0].name).toBe("Wynik meczu");
    expect(markets[0].bookmakerMarketId).toBe(MARKET_TYPES.MATCH_RESULT);
  });

  it("getMarketName prefers the API name over the switch fallback", () => {
    expect(
      getMarketName(MARKET_TYPES.MATCH_RESULT, undefined, "Custom API Name")
    ).toBe("Custom API Name");
    // Blank api name -> switch label
    expect(getMarketName(MARKET_TYPES.MATCH_RESULT, undefined, "  ")).toBe(
      "Wynik meczu"
    );
    // Unknown type without api name -> placeholder
    expect(getMarketName("99999")).toBe("Rynek 99999");
  });
});
