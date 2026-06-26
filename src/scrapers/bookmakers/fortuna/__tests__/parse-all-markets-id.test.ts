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
});
