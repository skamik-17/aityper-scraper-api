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

  // v2 fixer contract fields (docs/audit-ledger/FIXER-CONTRACT.md)
  it("isFixResult accepts the new shape with fingerprints and fixtureTest", () => {
    expect(isFixResult({
      status: "applied",
      commit: "abc",
      files: ["backend/src/services/normalization/bookmakers/sts-normalizer.ts"],
      fingerprints: ["a1b2c3d4e5f6"],
      fixtureTest: { path: "backend/src/services/normalization/__fixtures__/sts/x.json", before: "fail", after: "pass" },
      reason: null,
    })).toBe(true);
  });
  it("isFixResult accepts fixtureTest null and empty fingerprints", () => {
    expect(isFixResult({ status: "noop", commit: null, files: [], fingerprints: [], fixtureTest: null, reason: "already green" })).toBe(true);
  });
  it("isFixResult rejects malformed fixtureTest", () => {
    expect(isFixResult({
      status: "applied", commit: "abc", files: [],
      fixtureTest: { path: "x.json", before: "pass", after: "pass" }, reason: null,
    })).toBe(false);
  });
  it("isFixResult rejects non-string fingerprints", () => {
    expect(isFixResult({ status: "applied", commit: "abc", files: [], fingerprints: [1], reason: null })).toBe(false);
  });
});
