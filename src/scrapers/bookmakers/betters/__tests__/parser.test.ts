import { describe, it, expect } from "vitest";
import { getMarketName, parseAllMarkets } from "../parser.js";
import { STAKE_TYPES } from "../constants.js";
import type { BettersEvent } from "../types.js";

describe("Betters parser - rich market data", () => {
  it("getMarketName prefers the API-provided stakeTypeName", () => {
    // Unknown stake type id with an API-provided human-readable name
    const name = getMarketName({
      stakeTypeId: 80,
      stakeTypeName: "Strzelec gola w meczu",
      stakes: [],
    });

    expect(name).toBe("Strzelec gola w meczu");
    expect(name).not.toMatch(/^Rynek /);
  });

  it("getMarketName falls back to a hard-coded label when API name is blank", () => {
    const name = getMarketName({
      stakeTypeId: STAKE_TYPES.MATCH_RESULT,
      stakeTypeName: "",
      stakes: [],
    });

    expect(name).toBe("Wynik meczu");
    expect(name).not.toMatch(/^Rynek /);
  });

  it("getMarketName appends the line for line markets without duplicating it", () => {
    // API name without the line -> line appended
    expect(
      getMarketName({ stakeTypeId: STAKE_TYPES.OVER_UNDER, stakeTypeName: "Liczba goli", stakes: [] }, 2.5)
    ).toBe("Liczba goli 2.5");

    // API name already containing the line -> not duplicated
    expect(
      getMarketName({ stakeTypeId: STAKE_TYPES.OVER_UNDER, stakeTypeName: "Liczba goli 2.5", stakes: [] }, 2.5)
    ).toBe("Liczba goli 2.5");
  });

  it("parseAllMarkets produces real names and a non-empty bookmakerMarketId", () => {
    const event: BettersEvent = {
      eventId: 12345,
      teamA: "Polska",
      teamB: "Niemcy",
      stakeTypes: [
        {
          stakeTypeId: STAKE_TYPES.MATCH_RESULT,
          stakeTypeName: "Wynik meczu",
          stakes: [
            { stakeCode: 1, stakeName: "1", betFactor: 2.1, stakeId: 111 },
            { stakeCode: 2, stakeName: "X", betFactor: 3.2, stakeId: 222 },
            { stakeCode: 3, stakeName: "2", betFactor: 3.4, stakeId: 333 },
          ],
        },
        {
          // Unknown stake type: name must come from the API, id must be carried
          stakeTypeId: 80,
          stakeTypeName: "Strzelec gola w meczu",
          stakes: [
            { stakeCode: 1, stakeName: "Robert Lewandowski", betFactor: 2.5, stakeId: 444 },
            { stakeCode: 2, stakeName: "Jamal Musiala", betFactor: 3.1, stakeId: 555 },
          ],
        },
      ],
    };

    const markets = parseAllMarkets(event);

    expect(markets).toHaveLength(2);

    const oneX2 = markets[0];
    // bookmakerMarketId carries the stable Betters stake type id
    expect(oneX2.bookmakerMarketId).toBe(String(STAKE_TYPES.MATCH_RESULT));
    expect(oneX2.bookmakerMarketId).not.toBe("");
    // Name is a real, non-placeholder label (not "Rynek <id>")
    expect(oneX2.name).not.toMatch(/^Rynek /);
    // Home/away selections resolved to team names
    expect(oneX2.selections[0].name).toBe("Polska");
    expect(oneX2.selections[2].name).toBe("Niemcy");

    const scorer = markets[1];
    expect(scorer.bookmakerMarketId).toBe("80");
    expect(scorer.bookmakerMarketId).not.toBe("");
    // Real human-readable API name is surfaced, not a "Rynek <id>" placeholder
    expect(scorer.name).toBe("Strzelec gola w meczu");
    expect(scorer.name).not.toMatch(/^Rynek /);
  });
});
