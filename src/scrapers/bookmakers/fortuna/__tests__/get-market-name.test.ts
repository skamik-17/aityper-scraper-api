import { describe, it, expect } from "vitest";
import { getMarketName } from "../parser.js";
import type { FortunaMarket } from "../types.js";

const base: FortunaMarket = {
  id: "1", fixtureId: "f", marketTypeId: "ufo:mtyp:00-zz",
  marketTypeName: "", name: "", outcomes: [], specifiers: {},
};

describe("getMarketName", () => {
  it("prefers the API market name when present and meaningful", () => {
    expect(getMarketName({ ...base, name: "Strzelec gola" })).toBe("Strzelec gola");
  });
  it("falls back to marketTypeName when name is empty", () => {
    expect(getMarketName({ ...base, marketTypeName: "Rzuty rożne" })).toBe("Rzuty rożne");
  });
  it("falls back to the hard-coded switch for known type ids when API name is blank", () => {
    expect(getMarketName({ ...base, marketTypeId: "ufo:mtyp:00-00" })).toBe("Wynik meczu");
  });
  it("never returns a placeholder when the API supplies a real name", () => {
    expect(getMarketName({ ...base, name: "Liczba kartek" }).startsWith("Rynek ")).toBe(false);
  });
});
