import { describe, it, expect } from "vitest";
import { isPlaceholderName, analyzeDiscovery } from "../discovery-analysis.js";
import type { PrepMarketEntry } from "../types.js";

function entry(name: string, code: string, id = ""): PrepMarketEntry {
  return {
    index: 0,
    raw: { name, groupName: "", groupId: "", bookmakerMarketId: id, selections: [] },
    normalized: { marketCode: code, marketKey: code, paramValue: null, matchedBy: null, selections: [] },
    catalogEntry: null,
    relatedCodes: [],
    mechanicalFlags: {
      recognized: code !== "OTHER", collision: false, unknown_count: 0, orphan_codes: [],
      duplicate_codes: false, count_mismatch: false, missing_expected: false,
      selection_label_count: 0, selection_odds_range: { min: 0, max: 0 }, param_format: "none",
    },
  };
}

describe("isPlaceholderName", () => {
  it("flags 'Rynek ...' fallback names", () => {
    expect(isPlaceholderName("Rynek ufo:mtyp:00-ox")).toBe(true);
  });
  it("flags raw-code-looking and empty names", () => {
    expect(isPlaceholderName("ufo:mtyp:00-ox")).toBe(true);
    expect(isPlaceholderName("   ")).toBe(true);
  });
  it("accepts real market names", () => {
    expect(isPlaceholderName("Liczba goli")).toBe(false);
  });
});

describe("analyzeDiscovery", () => {
  it("computes recognition, placeholders, empty-id and top unrecognized", () => {
    const markets = [
      entry("Wynik meczu", "MATCH_WINNER", "ufo:mtyp:00-00"),
      entry("Rynek ufo:mtyp:00-ox", "OTHER"),
      entry("Rynek ufo:mtyp:00-ox", "OTHER"),
      entry("Rynek ufo:mtyp:00-pz", "OTHER"),
    ];
    const a = analyzeDiscovery(markets, 5);
    expect(a.total).toBe(4);
    expect(a.recognized).toBe(1);
    expect(a.recognizedPct).toBe(25);
    expect(a.placeholderNames).toBe(2); // unique placeholder names (ox, pz), not rows
    expect(a.emptyBookmakerId).toBe(3);
    expect(a.topUnrecognized[0]).toEqual({ name: "Rynek ufo:mtyp:00-ox", count: 2 });
  });
});
