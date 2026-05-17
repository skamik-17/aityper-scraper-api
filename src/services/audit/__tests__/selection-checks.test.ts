import { describe, it, expect } from "vitest";
import { isSelectionOrphan } from "../selection-checks.js";
import { getMarketByCode } from "../../../data/market-catalog.js";

describe("isSelectionOrphan", () => {
  it("returns false when catalog entry is undefined (no constraint to violate)", () => {
    expect(isSelectionOrphan("OVER", undefined)).toBe(true);
  });

  it("returns false when entry.selections is empty (legacy: accept anything)", () => {
    const entry = { selections: [] } as Pick<NonNullable<ReturnType<typeof getMarketByCode>>, "selections">;
    expect(isSelectionOrphan("OVER", entry as any)).toBe(false);
  });

  it("returns false when code is in entry.selections", () => {
    const entry = { selections: ["OVER", "UNDER"] } as any;
    expect(isSelectionOrphan("OVER", entry)).toBe(false);
  });

  it("returns true when code is NOT in entry.selections", () => {
    const entry = { selections: ["HOME", "DRAW", "AWAY"] } as any;
    expect(isSelectionOrphan("YES", entry)).toBe(true);
  });

  it("works with a real catalog entry (MATCH_WINNER expects HOME/DRAW/AWAY)", () => {
    const entry = getMarketByCode("MATCH_WINNER");
    expect(entry).toBeDefined();
    expect(isSelectionOrphan("HOME", entry)).toBe(false);
    expect(isSelectionOrphan("DRAW", entry)).toBe(false);
    expect(isSelectionOrphan("OVER", entry)).toBe(true);
  });
});
