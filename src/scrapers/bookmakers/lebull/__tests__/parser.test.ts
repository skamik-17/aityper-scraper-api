import { describe, it, expect } from "vitest";
import { parseAllMarkets } from "../parser.js";
import type { LebullEvent } from "../types.js";

describe("lebull parseAllMarkets - rich names and stable ids", () => {
  it("uses the API-provided stakeTypeName for an unmapped stake type instead of a 'Rynek <id>' placeholder", () => {
    // stakeTypeId 545 is NOT in the curated switch, so without the API name
    // it would fall back to the generic "Rynek 545" placeholder.
    const event: LebullEvent = {
      eventId: 1,
      teamA: "Lech Poznan",
      teamB: "Legia Warszawa",
      stakeTypes: [
        {
          stakeTypeId: 545,
          stakeTypeName: "Strzelec gola - mecz",
          stakes: [
            { stakeId: 11, stakeCode: 1, stakeName: "Robert Lewandowski", betFactor: 2.5 },
            { stakeId: 12, stakeCode: 2, stakeName: "Brak strzelca", betFactor: 8.0 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);

    expect(markets).toHaveLength(1);
    const market = markets[0];
    // Real human-readable name from the API, not a placeholder
    expect(market.name).toBe("Strzelec gola - mecz");
    expect(market.name).not.toMatch(/^Rynek\s/);
    // Stable market-type id carried through
    expect(market.bookmakerMarketId).toBe("545");
  });

  it("appends the line value to the API name for line markets so distinct lines stay disambiguated", () => {
    const event: LebullEvent = {
      eventId: 2,
      teamA: "Lech Poznan",
      teamB: "Legia Warszawa",
      stakeTypes: [
        {
          stakeTypeId: 3, // OVER_UNDER
          stakeTypeName: "Liczba goli",
          stakes: [
            { stakeId: 21, stakeCode: 1, stakeName: "Powyzej", betFactor: 1.85, stakeArgument: 2.5 },
            { stakeId: 22, stakeCode: 2, stakeName: "Ponizej", betFactor: 1.95, stakeArgument: 2.5 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);

    expect(markets).toHaveLength(1);
    expect(markets[0].name).toBe("Liczba goli 2.5");
    expect(markets[0].bookmakerMarketId).toBe("3");
  });

  it("falls back to the curated switch name when the API name is blank", () => {
    const event: LebullEvent = {
      eventId: 3,
      teamA: "Lech Poznan",
      teamB: "Legia Warszawa",
      stakeTypes: [
        {
          stakeTypeId: 1, // MATCH_RESULT
          stakes: [
            { stakeId: 31, stakeCode: 1, stakeName: "1", betFactor: 1.9 },
            { stakeId: 32, stakeCode: 2, stakeName: "X", betFactor: 3.4 },
            { stakeId: 33, stakeCode: 3, stakeName: "2", betFactor: 4.1 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);

    expect(markets).toHaveLength(1);
    expect(markets[0].name).toBe("Wynik meczu");
    expect(markets[0].bookmakerMarketId).toBe("1");
  });
});
