import { describe, it, expect } from "vitest";
import { parseAllMarkets } from "../parser.js";
import type { FortunaMarket } from "../types.js";

const market: FortunaMarket = {
  id: "m1", fixtureId: "f1", marketTypeId: "ufo:mtyp:00-00",
  marketTypeName: "Wynik meczu", name: "Wynik meczu",
  outcomes: [{ id: "o1", name: "1", odds: 2.1 } as never],
  specifiers: {},
};

describe("parseAllMarkets", () => {
  it("sets bookmakerMarketId from marketTypeId", () => {
    const out = parseAllMarkets([market]);
    expect(out[0].bookmakerMarketId).toBe("ufo:mtyp:00-00");
  });

  it("drops a suspended ~1.00 leg from a binary market even when its sibling is live", () => {
    // "Rzut karny w obu połowach: Nie @1.0" alongside a real "Tak @30" is a
    // suspended/placeholder quote, not a genuine zero-margin price — no
    // bookmaker offers a real bet at exactly 1.00, so it must be dropped
    // even though the sibling leg is actively priced.
    const binaryMarket: FortunaMarket = {
      id: "m2", fixtureId: "f1", marketTypeId: "ufo:mtyp:00-r7",
      marketTypeName: "Rzut karny w obu połowach", name: "Rzut karny w obu połowach",
      outcomes: [
        { id: "o1", name: "Tak", odds: 30 } as never,
        { id: "o2", name: "Nie", odds: 1.0 } as never,
      ],
      specifiers: {},
    };
    const out = parseAllMarkets([binaryMarket]);
    expect(out[0].selections.map((s) => s.name)).toEqual(["Tak"]);
  });

  it("still drops a genuinely suspended market where every outcome is at/below 1.00", () => {
    const suspendedMarket: FortunaMarket = {
      id: "m3", fixtureId: "f1", marketTypeId: "ufo:mtyp:00-r7",
      marketTypeName: "Rzut karny w obu połowach", name: "Rzut karny w obu połowach",
      outcomes: [
        { id: "o1", name: "Tak", odds: 1.0 } as never,
        { id: "o2", name: "Nie", odds: 1.0 } as never,
      ],
      specifiers: {},
    };
    const out = parseAllMarkets([suspendedMarket]);
    expect(out.length).toBe(0);
  });
});
