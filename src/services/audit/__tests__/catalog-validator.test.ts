import { describe, it, expect } from "vitest";
import { validateNewCatalogCode } from "../catalog-validator.js";

const good = {
  code: "AWAY_TEAM_TOTAL_CARDS",
  category: "STATYSTYKI", // real catalog category
  viewType: "BINARY_BUTTONS", // real catalog viewType
  selections: ["OVER", "UNDER"],
  labelPl: "Kartki gości",
};

describe("validateNewCatalogCode", () => {
  it("accepts a well-formed new entry", () => {
    expect(validateNewCatalogCode(good).ok).toBe(true);
  });
  it("rejects a code that already exists", () => {
    const r = validateNewCatalogCode({ ...good, code: "MATCH_WINNER" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/exists/i);
  });
  it("rejects a FIRST_HALF_ prefixed code (convention is HALF_TIME_)", () => {
    const r = validateNewCatalogCode({ ...good, code: "FIRST_HALF_TOTAL_GOALS" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/HALF_TIME_/);
  });
  it("rejects empty selections and lowercase codes", () => {
    expect(validateNewCatalogCode({ ...good, selections: [] }).ok).toBe(false);
    expect(validateNewCatalogCode({ ...good, code: "lower_case" }).ok).toBe(false);
  });
  it("rejects a viewType not used anywhere in the catalog", () => {
    const r = validateNewCatalogCode({ ...good, viewType: "NONSENSE_VIEW" });
    expect(r.ok).toBe(false);
  });
});
