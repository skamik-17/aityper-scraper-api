import { describe, it, expect } from "vitest";
import {
  isJudgeVerdict,
  isFixResult,
  extractVerdictBlock,
  extractFixResultBlock,
  type JudgeVerdict,
  type PrepAuditOutput,
} from "../types.js";

describe("isJudgeVerdict", () => {
  it("accepts a valid OK verdict", () => {
    const v: JudgeVerdict = {
      verdict: "OK",
      confidence: 0.95,
      category: "other",
      reasoning: "Wszystko zgodne.",
      suggested_fix: null,
    };
    expect(isJudgeVerdict(v)).toBe(true);
  });

  it("accepts a valid BROKEN verdict with suggested_fix", () => {
    const v: JudgeVerdict = {
      verdict: "BROKEN",
      confidence: 0.94,
      category: "wrong_market_code",
      reasoning: "Powinno być FIRST_HALF_TOTAL_GOALS.",
      suggested_fix: {
        file: "betclic-normalizer.ts",
        change_type: "add_alias",
        description: "Dodaj alias",
        patch_hint: "W mapie BETCLIC_MARKET_NAME_TO_CODE...",
      },
    };
    expect(isJudgeVerdict(v)).toBe(true);
  });

  it("rejects verdict with invalid verdict value", () => {
    const v = { verdict: "MAYBE", confidence: 0.5, category: "other", reasoning: "x", suggested_fix: null };
    expect(isJudgeVerdict(v as unknown)).toBe(false);
  });

  it("rejects verdict with confidence out of range", () => {
    const v = { verdict: "OK", confidence: 1.5, category: "other", reasoning: "x", suggested_fix: null };
    expect(isJudgeVerdict(v)).toBe(false);
  });

  it("rejects verdict with non-null suggested_fix missing required keys", () => {
    const v = { verdict: "BROKEN", confidence: 0.95, category: "other", reasoning: "x",
                suggested_fix: { file: "betclic-normalizer.ts" } };
    expect(isJudgeVerdict(v)).toBe(false);
  });
});

describe("isFixResult", () => {
  it("accepts applied", () => {
    expect(isFixResult({ status: "applied", commit: "abc123", files: ["x.ts"], reason: null })).toBe(true);
  });
  it("accepts failed", () => {
    expect(isFixResult({ status: "failed", commit: null, files: [], reason: "view_type mismatch" })).toBe(true);
  });
  it("accepts noop", () => {
    expect(isFixResult({ status: "noop", commit: null, files: [], reason: "already applied" })).toBe(true);
  });
  it("rejects unknown status", () => {
    expect(isFixResult({ status: "skipped" })).toBe(false);
  });
});

describe("extractVerdictBlock", () => {
  it("extracts JSON inside <verdict> tag", () => {
    const text = `Some preamble.
<verdict>
{ "verdict": "OK", "confidence": 0.9, "category": "other", "reasoning": "ok", "suggested_fix": null }
</verdict>
Trailing.`;
    expect(extractVerdictBlock(text)).toEqual({
      verdict: "OK", confidence: 0.9, category: "other", reasoning: "ok", suggested_fix: null,
    });
  });

  it("returns null when no <verdict> tag present", () => {
    expect(extractVerdictBlock("nothing here")).toBeNull();
  });

  it("returns null when JSON inside tag is malformed", () => {
    expect(extractVerdictBlock("<verdict>{not json}</verdict>")).toBeNull();
  });
});

describe("extractFixResultBlock", () => {
  it("extracts JSON inside <fix_result> tag", () => {
    const text = `<fix_result>{ "status": "applied", "commit": "abc", "files": ["x.ts"], "reason": null }</fix_result>`;
    expect(extractFixResultBlock(text)).toEqual({
      status: "applied", commit: "abc", files: ["x.ts"], reason: null,
    });
  });

  it("returns null when no tag", () => {
    expect(extractFixResultBlock("no tag here")).toBeNull();
  });
});
