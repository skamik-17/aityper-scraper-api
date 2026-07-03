import { describe, it, expect } from "vitest";
import {
  isMatchJudgeVerdict,
  isMatchVisualVerdict,
  extractMatchVerdictBlocks,
  extractMatchVisualVerdictBlocks,
} from "../match-audit-types.js";

const judgeVerdict = {
  marketKey: "DOUBLE_CHANCE",
  verdict: "MAJOR",
  confidence: 0.9,
  issues: [
    {
      kind: "misrouted_entry",
      bookmaker: "betfan",
      detail: "raw '2. połowa - podwójna szansa i BTTS' inside plain DOUBLE_CHANCE",
      route: "bookmaker:betfan",
      suggested_action: "map betfan market id to SECOND_HALF_DOUBLE_CHANCE_BTTS",
    },
  ],
};

const visualVerdict = {
  marketRef: "WYNIK_MECZU/DOUBLE_CHANCE",
  view_type_ok: true,
  selections_rendered: false,
  lines_ok: true,
  no_placeholder_leak: false,
  market_makes_sense: true,
  discrepancies: ["'base' button visible", "X2 column empty for betclic"],
  confidence: 0.85,
};

describe("isMatchJudgeVerdict", () => {
  it("accepts a well-formed verdict", () => {
    expect(isMatchJudgeVerdict(judgeVerdict)).toBe(true);
  });
  it("accepts an OK verdict with empty issues", () => {
    expect(
      isMatchJudgeVerdict({ marketKey: "BTTS", verdict: "OK", confidence: 1, issues: [] }),
    ).toBe(true);
  });
  it("accepts null bookmaker (pipeline-level issue)", () => {
    const v = {
      ...judgeVerdict,
      issues: [{ ...judgeVerdict.issues[0], bookmaker: null, route: "grouper" }],
    };
    expect(isMatchJudgeVerdict(v)).toBe(true);
  });
  it("rejects bad verdict level, kind, route and confidence", () => {
    expect(isMatchJudgeVerdict({ ...judgeVerdict, verdict: "FATAL" })).toBe(false);
    expect(
      isMatchJudgeVerdict({
        ...judgeVerdict,
        issues: [{ ...judgeVerdict.issues[0], kind: "weird" }],
      }),
    ).toBe(false);
    expect(
      isMatchJudgeVerdict({
        ...judgeVerdict,
        issues: [{ ...judgeVerdict.issues[0], route: "nowhere" }],
      }),
    ).toBe(false);
    expect(isMatchJudgeVerdict({ ...judgeVerdict, confidence: 1.5 })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isMatchJudgeVerdict(null)).toBe(false);
    expect(isMatchJudgeVerdict("x")).toBe(false);
    expect(isMatchJudgeVerdict([])).toBe(false);
  });
});

describe("isMatchVisualVerdict", () => {
  it("accepts a well-formed visual verdict", () => {
    expect(isMatchVisualVerdict(visualVerdict)).toBe(true);
  });
  it("rejects missing boolean dimensions", () => {
    const { lines_ok: _drop, ...rest } = visualVerdict;
    expect(isMatchVisualVerdict(rest)).toBe(false);
  });
  it("rejects non-string discrepancies", () => {
    expect(isMatchVisualVerdict({ ...visualVerdict, discrepancies: [42] })).toBe(false);
  });
});

describe("extractors", () => {
  it("extracts multiple <match_verdict> blocks", () => {
    const text = `intro\n<match_verdict>${JSON.stringify(judgeVerdict)}</match_verdict>\nmid\n<match_verdict>${JSON.stringify({ ...judgeVerdict, marketKey: "BTTS" })}</match_verdict>`;
    const blocks = extractMatchVerdictBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(isMatchJudgeVerdict(blocks[0])).toBe(true);
  });
  it("skips unparseable blocks", () => {
    const text = `<match_verdict>{not json}</match_verdict><match_verdict>${JSON.stringify(judgeVerdict)}</match_verdict>`;
    expect(extractMatchVerdictBlocks(text)).toHaveLength(1);
  });
  it("extracts <match_visual_verdict> blocks", () => {
    const text = `<match_visual_verdict>${JSON.stringify(visualVerdict)}</match_visual_verdict>`;
    const blocks = extractMatchVisualVerdictBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(isMatchVisualVerdict(blocks[0])).toBe(true);
  });
});
