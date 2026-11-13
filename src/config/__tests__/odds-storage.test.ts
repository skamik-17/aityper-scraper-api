import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOddsWriteModel, isPruneGuardEnabled } from "../odds-storage.js";

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("odds storage flags", () => {
  it("the prune guard is off unless ODDS_PRUNE_GUARD=true (owner B13)", () => {
    expect(isPruneGuardEnabled({})).toBe(false);
    expect(isPruneGuardEnabled({ ODDS_PRUNE_GUARD: "1" })).toBe(false);
    expect(isPruneGuardEnabled({ ODDS_PRUNE_GUARD: "false" })).toBe(false);
    expect(isPruneGuardEnabled({ ODDS_PRUNE_GUARD: "true" })).toBe(true);
  });

  it("the write model defaults to legacy", () => expect(getOddsWriteModel({})).toBe("legacy"));

  it.each(["legacy", "dual", "switched", "snapshot"] as const)("accepts %s", (model) =>
    expect(getOddsWriteModel({ ODDS_WRITE_MODEL: model })).toBe(model),
  );

  it("unknown values fall back to legacy with a warning", () => {
    expect(getOddsWriteModel({ ODDS_WRITE_MODEL: "both" })).toBe("legacy");
    expect(warnSpy).toHaveBeenCalledWith('[Config] Unknown ODDS_WRITE_MODEL "both" - using "legacy"');
  });
});
