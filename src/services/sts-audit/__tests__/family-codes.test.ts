import { describe, it, expect } from "vitest";
import { getRelatedCodes } from "../family-codes.js";

describe("getRelatedCodes", () => {
  it("returns empty array when input code is not in catalog", () => {
    const result = getRelatedCodes("DEFINITELY_NOT_A_REAL_CODE");
    expect(result).toEqual([]);
  });

  it("for a prefix-family code, returns siblings sharing the root", () => {
    // TOTAL_GOALS has siblings HALF_TIME_TOTAL_GOALS, SECOND_HALF_TOTAL_GOALS
    // (depending on what's in catalog).
    // The test asserts shape and self-exclusion, not exhaustive enumeration.
    const result = getRelatedCodes("TOTAL_GOALS");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.code !== "TOTAL_GOALS")).toBe(true);
    expect(result.every((r) => typeof r.code === "string" && typeof r.labelPl === "string")).toBe(true);
  });

  it("for a prefixed code like HALF_TIME_TOTAL_GOALS, returns the root and siblings", () => {
    // Catalog uses HALF_TIME_ prefix for first-half markets (not FIRST_HALF_).
    // HALF_TIME_TOTAL_GOALS -> strip HALF_TIME_ -> root TOTAL_GOALS
    const result = getRelatedCodes("HALF_TIME_TOTAL_GOALS");
    const codes = result.map((r) => r.code);
    expect(codes).toContain("TOTAL_GOALS");
    expect(codes).not.toContain("HALF_TIME_TOTAL_GOALS"); // self excluded
  });

  it("falls back to same-category siblings when no prefix match exists", () => {
    // MATCH_WINNER is in MarketCategory.WYNIK_MECZU; sibling: DOUBLE_CHANCE, DRAW_NO_BET.
    const result = getRelatedCodes("MATCH_WINNER");
    const codes = result.map((r) => r.code);
    expect(codes).toContain("DOUBLE_CHANCE");
    expect(codes).not.toContain("MATCH_WINNER");
  });
});
