import { describe, it, expect } from "vitest";
import {
  isJudgeVerdict,
  isFixResult,
  extractVerdictBlock,
  extractFixResultBlock,
  isFixFromAuditReport,
  type JudgeVerdict,
  type PrepAuditOutput,
  type FixFromAuditReport,
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
  it("rejects when files is not an array", () => {
    expect(isFixResult({ status: "applied", commit: "abc", files: "not-array", reason: null })).toBe(false);
  });
  it("rejects when files contains non-string elements", () => {
    expect(isFixResult({ status: "applied", commit: "abc", files: ["ok", 42], reason: null })).toBe(false);
  });
  it("rejects when commit is wrong type (e.g. number)", () => {
    expect(isFixResult({ status: "applied", commit: 123, files: [], reason: null })).toBe(false);
  });
  it("rejects when reason is wrong type (e.g. object)", () => {
    expect(isFixResult({ status: "failed", commit: null, files: [], reason: { msg: "oops" } })).toBe(false);
  });
  it("accepts when reason is null and commit is null with empty files", () => {
    expect(isFixResult({ status: "noop", commit: null, files: [], reason: null })).toBe(true);
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

describe("isFixFromAuditReport", () => {
  const validReport: FixFromAuditReport = {
    meta: {
      schemaVersion: 1,
      runIndex: 1,
      sourceReport: "docs/betclic-audit/2026-05-17__unknown__1008026211729408.json",
      sourceReportSha: "af3f224",
      matchId: "1008026211729408",
      homeTeam: "Newcastle",
      awayTeam: "West Ham",
      league: "unknown",
      runAt: "2026-05-17T18:30:00Z",
      selectedVerdicts: ["BROKEN", "MAJOR"],
      autoFixThreshold: 0.9,
      autoFixBranch: "auto-fix/betclic-audit/2026-05-17",
      parallel: 4,
      rejudgeEnabled: true,
    },
    summary: {
      sourceTotalItems: 285,
      sourceActionableItems: 45,
      selectedItems: 33,
      rejudge: { attempted: 9, generatedFix: 6, stillNull: 2, parseFailed: 1 },
      fixesAttempted: 30,
      fixesSkippedLowConfidence: 4,
      fixesDispatched: 26,
      fix: { applied: 18, failed: 5, noop: 3 },
      finalSkip: { rejudgeStillNull: 2, rejudgeParseFailed: 1, noRejudgeFlag: 0 },
    },
    items: [],
  };

  it("accepts a valid minimal report (empty items)", () => {
    expect(isFixFromAuditReport(validReport)).toBe(true);
  });

  it("accepts a report with one fully populated item", () => {
    const withItem: FixFromAuditReport = {
      ...validReport,
      items: [
        {
          marketIndex: 47,
          rawName: "Wynik i gole",
          marketCode: "RESULT_AND_TOTAL",
          originalJudge: {
            verdict: "BROKEN",
            confidence: 0.93,
            category: "missing_param",
            reasoning: "x",
            suggested_fix: null,
          },
          rejudgeJudge: {
            verdict: "BROKEN",
            confidence: 0.88,
            category: "missing_param",
            reasoning: "y",
            suggested_fix: {
              file: "betclic-normalizer.ts",
              change_type: "add_alias",
              description: "z",
              patch_hint: "w",
            },
          },
          fixDispatched: true,
          fixSkipReason: null,
          fixResult: {
            status: "applied",
            commit: "abc1234",
            files: ["backend/src/services/normalization/bookmakers/betclic-normalizer.ts"],
            reason: null,
          },
        },
      ],
    };
    expect(isFixFromAuditReport(withItem)).toBe(true);
  });

  it("rejects wrong schemaVersion", () => {
    const bad = { ...validReport, meta: { ...validReport.meta, schemaVersion: 2 as unknown as 1 } };
    expect(isFixFromAuditReport(bad)).toBe(false);
  });

  it("rejects when items is not an array", () => {
    const bad = { ...validReport, items: "nope" as unknown };
    expect(isFixFromAuditReport(bad)).toBe(false);
  });

  it("rejects when an item has invalid originalJudge", () => {
    const bad = {
      ...validReport,
      items: [
        {
          marketIndex: 0,
          rawName: "x",
          marketCode: "X",
          originalJudge: { verdict: "BROKEN", confidence: 2.0, category: "other", reasoning: "x", suggested_fix: null },
          rejudgeJudge: null,
          fixDispatched: false,
          fixSkipReason: null,
          fixResult: null,
        },
      ],
    };
    expect(isFixFromAuditReport(bad)).toBe(false);
  });

  it("rejects when selectedVerdicts contains an invalid value", () => {
    const bad = {
      ...validReport,
      meta: { ...validReport.meta, selectedVerdicts: ["MAYBE"] as unknown as FixFromAuditReport["meta"]["selectedVerdicts"] },
    };
    expect(isFixFromAuditReport(bad)).toBe(false);
  });
});
