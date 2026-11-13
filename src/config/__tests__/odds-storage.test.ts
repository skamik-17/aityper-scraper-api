import { describe, expect, it } from "vitest";
import { isPruneGuardEnabled } from "../odds-storage.js";

describe("odds storage flags", () => {
  it("the prune guard is off unless ODDS_PRUNE_GUARD=true (owner B13)", () => {
    expect(isPruneGuardEnabled({})).toBe(false);
    expect(isPruneGuardEnabled({ ODDS_PRUNE_GUARD: "1" })).toBe(false);
    expect(isPruneGuardEnabled({ ODDS_PRUNE_GUARD: "false" })).toBe(false);
    expect(isPruneGuardEnabled({ ODDS_PRUNE_GUARD: "true" })).toBe(true);
  });
});
