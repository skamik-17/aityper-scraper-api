import { describe, it, expect } from "vitest";
import {
  findLadderBreaks,
  findOutliers,
  findArbitrage,
  isExclusiveSelectionSet,
} from "../../../scripts/odds-outliers.js";

const ARGS = { dev: 0.35, minBooks: 4 } as Parameters<typeof findOutliers>[2];

function market(overrides: Record<string, unknown> = {}) {
  return {
    marketKey: "TOTAL_GOALS",
    type: "TOTAL_GOALS",
    category: "GOLE",
    label: "Liczba goli",
    parameters: [],
    ...overrides,
  } as Parameters<typeof findLadderBreaks>[0];
}

function param(value: string, quotes: Array<[string, string, number]>) {
  const byBookmaker = new Map<string, { bookmaker: string; selections: { type: string; odds: number }[] }>();
  for (const [bookmaker, type, odds] of quotes) {
    const entry = byBookmaker.get(bookmaker) ?? { bookmaker, selections: [] };
    entry.selections.push({ type, odds });
    byBookmaker.set(bookmaker, entry);
  }
  return { value, label: value, bookmakers: [...byBookmaker.values()] };
}

describe("findOutliers", () => {
  it("flags a quote far from the peer median and names the bookmaker", () => {
    const m = market({
      parameters: [
        param("2.5", [
          ["sts", "OVER", 1.55],
          ["betcris", "OVER", 1.54],
          ["etoto", "OVER", 1.56],
          ["forbet", "OVER", 1.53],
          ["pzbuk", "OVER", 3.83],
        ]),
      ],
    });
    const findings = findOutliers(m, "GOLE/TOTAL_GOALS", ARGS);
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBe("pzbuk");
    expect(findings[0].odds).toBe(3.83);
  });

  it("stays quiet when the field simply disagrees a little", () => {
    const m = market({
      parameters: [
        param("2.5", [
          ["sts", "OVER", 1.55],
          ["betcris", "OVER", 1.6],
          ["etoto", "OVER", 1.5],
          ["forbet", "OVER", 1.62],
        ]),
      ],
    });
    expect(findOutliers(m, "GOLE/TOTAL_GOALS", ARGS)).toHaveLength(0);
  });

  it("does not judge a pool thinner than --min-books", () => {
    const m = market({
      parameters: [
        param("2.5", [
          ["sts", "OVER", 1.55],
          ["pzbuk", "OVER", 9.0],
        ]),
      ],
    });
    expect(findOutliers(m, "GOLE/TOTAL_GOALS", ARGS)).toHaveLength(0);
  });
});

describe("findLadderBreaks", () => {
  // The pzbuk first-half 0.5 inversion had exactly this shape, and only one
  // bookmaker quoted it — there was no peer to compare against.
  it("flags a price that moves the wrong way along the line", () => {
    const m = market({
      parameters: [
        param("0.5", [["pzbuk", "OVER", 3.83]]),
        param("1.5", [["pzbuk", "OVER", 2.6]]),
      ],
    });
    const findings = findLadderBreaks(m, "POLOWY/HALF_TIME_TOTAL_GOALS");
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBe("pzbuk");
    expect(findings[0].severity).toBe("BROKEN");
  });

  it("accepts a correctly ordered ladder", () => {
    const m = market({
      parameters: [
        param("0.5", [["sts", "OVER", 1.02], ["sts", "UNDER", 17]]),
        param("1.5", [["sts", "OVER", 1.18], ["sts", "UNDER", 4.7]]),
        param("2.5", [["sts", "OVER", 1.55], ["sts", "UNDER", 2.32]]),
      ],
    });
    expect(findLadderBreaks(m, "GOLE/TOTAL_GOALS")).toHaveLength(0);
  });

  it("ignores a tie between neighbouring lines", () => {
    const m = market({
      parameters: [
        param("3.5", [["sts", "OVER", 2.35]]),
        param("4.0", [["sts", "OVER", 2.34]]),
      ],
    });
    expect(findLadderBreaks(m, "GOLE/TOTAL_GOALS")).toHaveLength(0);
  });
});

describe("isExclusiveSelectionSet", () => {
  it("accepts mutually exclusive outcomes", () => {
    expect(isExclusiveSelectionSet(["HOME", "DRAW", "AWAY"])).toBe(true);
    expect(isExclusiveSelectionSet(["YES", "NO"])).toBe(true);
    expect(isExclusiveSelectionSet(["OVER", "UNDER"])).toBe(true);
  });

  it("rejects cumulative ladders and nested ranges", () => {
    // "2+ shots" is contained in "1+ shots", so their prices never sum to 1.
    expect(isExclusiveSelectionSet(["1+", "2+", "3+"])).toBe(false);
    expect(isExclusiveSelectionSet(["0-1", "0-2", "0-3"])).toBe(false);
  });
});

describe("findArbitrage", () => {
  it("flags a selection set whose best prices cannot both be right", () => {
    const m = market({
      marketKey: "BTTS",
      type: "BTTS",
      parameters: [param("", [["forbet", "YES", 11], ["etoto", "NO", 4.5]])],
    });
    const findings = findArbitrage(m, "GOLE/BTTS");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("BROKEN");
  });

  it("stays quiet on a normally priced pair", () => {
    const m = market({
      marketKey: "BTTS",
      type: "BTTS",
      parameters: [param("", [["forbet", "YES", 2.36], ["etoto", "NO", 1.52]])],
    });
    expect(findArbitrage(m, "GOLE/BTTS")).toHaveLength(0);
  });
});
