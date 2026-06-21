import { describe, it, expect } from "vitest";
import { isJudgeVerdict, extractVerdictBlock, isFixResult } from "../types.js";

describe("sts-audit isJudgeVerdict — STS suggested_fix enums", () => {
  it("accepts an STS id-mapping fix targeting sts-normalizer.ts", () => {
    const v = {
      verdict: "BROKEN",
      confidence: 0.95,
      category: "wrong_market_code",
      reasoning: "STS market id 999 nie jest zmapowany.",
      suggested_fix: {
        file: "sts-normalizer.ts",
        change_type: "add_id_mapping",
        description: "Map id 999 to TOTAL_GOALS",
        patch_hint: "Add 999: 'TOTAL_GOALS' to STS_MARKET_ID_TO_CODE",
      },
    };
    expect(isJudgeVerdict(v)).toBe(true);
  });

  it("accepts an outcome-map fix", () => {
    const v = {
      verdict: "MAJOR", confidence: 0.8, category: "wrong_selection_mapping",
      reasoning: "Brak nazwy selekcji.",
      suggested_fix: { file: "sts-outcome-map", change_type: "add_outcome_map_entry", description: "x", patch_hint: "y" },
    };
    expect(isJudgeVerdict(v)).toBe(true);
  });

  it("rejects the betclic-only file value", () => {
    const v = {
      verdict: "BROKEN", confidence: 0.9, category: "other", reasoning: "x",
      suggested_fix: { file: "betclic-normalizer.ts", change_type: "other", description: "x", patch_hint: "y" },
    };
    expect(isJudgeVerdict(v)).toBe(false);
  });

  it("still validates a null-fix OK verdict", () => {
    expect(isJudgeVerdict({ verdict: "OK", confidence: 1, category: "other", reasoning: "x", suggested_fix: null })).toBe(true);
  });

  it("extractVerdictBlock parses a tagged block", () => {
    const out = extractVerdictBlock('noise <verdict>{"verdict":"OK"}</verdict> tail');
    expect(out).toEqual({ verdict: "OK" });
  });

  it("isFixResult accepts an applied result", () => {
    expect(isFixResult({ status: "applied", commit: "abc", files: ["x"], reason: null })).toBe(true);
  });
});
