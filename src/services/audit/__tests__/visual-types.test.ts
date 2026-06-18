import { describe, it, expect } from "vitest";
import {
  isVisualVerdict,
  isVisualMismatch,
  extractAllVisualVerdictBlocks,
  safeFileSlug,
  groupMarketsByGroupName,
  type VisualVerdict,
} from "../visual-types.js";

const ok: VisualVerdict = {
  marketRef: "Liczba goli",
  selections_match: true,
  odds_match: "ok",
  subject_correct: true,
  frontend_render_ok: true,
  discrepancies: [],
  confidence: 0.9,
};

describe("isVisualVerdict", () => {
  it("accepts a well-formed verdict", () => {
    expect(isVisualVerdict(ok)).toBe(true);
  });
  it("accepts frontend_render_ok = 'unavailable'", () => {
    expect(isVisualVerdict({ ...ok, frontend_render_ok: "unavailable" })).toBe(true);
  });
  it("rejects an invalid odds_match value", () => {
    expect(isVisualVerdict({ ...ok, odds_match: "nope" })).toBe(false);
  });
  it("rejects confidence out of range", () => {
    expect(isVisualVerdict({ ...ok, confidence: 1.5 })).toBe(false);
  });
  it("rejects empty marketRef", () => {
    expect(isVisualVerdict({ ...ok, marketRef: "" })).toBe(false);
  });
  it("rejects non-string discrepancies", () => {
    expect(isVisualVerdict({ ...ok, discrepancies: [1, 2] })).toBe(false);
  });
});

describe("isVisualMismatch", () => {
  it("drift alone is NOT a mismatch", () => {
    expect(isVisualMismatch({ ...ok, odds_match: "drift" })).toBe(false);
  });
  it("gross_mismatch IS a mismatch", () => {
    expect(isVisualMismatch({ ...ok, odds_match: "gross_mismatch" })).toBe(true);
  });
  it("false selections_match IS a mismatch", () => {
    expect(isVisualMismatch({ ...ok, selections_match: false })).toBe(true);
  });
  it("false frontend_render_ok IS a mismatch", () => {
    expect(isVisualMismatch({ ...ok, frontend_render_ok: false })).toBe(true);
  });
  it("'unavailable' frontend is NOT a mismatch", () => {
    expect(isVisualMismatch({ ...ok, frontend_render_ok: "unavailable" })).toBe(false);
  });
});

describe("extractAllVisualVerdictBlocks", () => {
  it("extracts multiple blocks from one reply", () => {
    const reply = `intro
<visual_verdict>{"marketRef":"A","selections_match":true,"odds_match":"ok","subject_correct":true,"frontend_render_ok":true,"discrepancies":[],"confidence":0.8}</visual_verdict>
<visual_verdict>{"marketRef":"B","selections_match":false,"odds_match":"drift","subject_correct":true,"frontend_render_ok":"unavailable","discrepancies":["x"],"confidence":0.6}</visual_verdict>`;
    const blocks = extractAllVisualVerdictBlocks(reply);
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as VisualVerdict).marketRef).toBe("A");
    expect((blocks[1] as VisualVerdict).marketRef).toBe("B");
  });
  it("skips unparseable blocks", () => {
    const reply = `<visual_verdict>{bad json}</visual_verdict>`;
    expect(extractAllVisualVerdictBlocks(reply)).toHaveLength(0);
  });
});

describe("safeFileSlug", () => {
  it("strips diacritics and lowercases", () => {
    expect(safeFileSlug("Liczba goli w 1. połowie")).toBe("liczba-goli-w-1-polowie");
  });
  it("falls back to 'unnamed' for empty input", () => {
    expect(safeFileSlug("!!!")).toBe("unnamed");
  });
});

describe("groupMarketsByGroupName", () => {
  it("groups market names by groupName preserving order", () => {
    const map = groupMarketsByGroupName([
      { name: "Wynik meczu", groupName: "Top" },
      { name: "Liczba goli", groupName: "Gole" },
      { name: "Liczba goli 1. poł.", groupName: "Gole" },
    ]);
    expect(map.get("Gole")).toEqual(["Liczba goli", "Liczba goli 1. poł."]);
    expect([...map.keys()]).toEqual(["Top", "Gole"]);
  });
  it("buckets blank groupName under '(bez grupy)'", () => {
    const map = groupMarketsByGroupName([{ name: "X", groupName: "" }]);
    expect(map.get("(bez grupy)")).toEqual(["X"]);
  });
});
