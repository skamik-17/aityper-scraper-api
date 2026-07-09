/**
 * Odds quarantine tests (SPEC.md §5 — product safety net).
 *
 * After aggregation, per (param, selectionType) pool with >= 4 quotes the
 * grouper must mark placeholder odds (>= 1000) and decimal-shifted odds
 * (> 400% off the pool median while /10 or /100 lands within ±15% of it)
 * with `suspect: true` — without dropping them from the payload.
 */

import { describe, it, expect } from "vitest";
import { groupMarketsByTypeWithParameters } from "../market-type-grouper.js";
import type { ScrapedMarket } from "../../types/full-offer.js";
import { isUsableOdds } from "../../../../src/lib/odds-quarantine.js";

function mkMarket(overrides: Partial<ScrapedMarket>): ScrapedMarket {
  return {
    name: "Suma goli",
    type: "TOTAL_GOALS",
    normalizedType: "TOTAL_GOALS" as ScrapedMarket["normalizedType"],
    marketKey: "TOTAL_GOALS",
    selections: [],
    ...overrides,
  } as ScrapedMarket;
}

/** One TOTAL_GOALS 2.5 OVER quote per bookmaker. */
function overQuotes(quotes: Array<{ bookmaker: string; odds: number }>) {
  return quotes.map(({ bookmaker, odds }) => ({
    market: mkMarket({
      paramValue: "2.5",
      selections: [{ name: "Ponad 2.5", normalizedName: "OVER" as const, odds }],
    }),
    bookmaker,
  }));
}

function allOverSelections(result: ReturnType<typeof groupMarketsByTypeWithParameters>) {
  const param = result[0].parameters.find((p) => p.value === "2.5")!;
  return param.bookmakers.map((bm) => ({
    bookmaker: bm.bookmaker,
    sel: bm.selections.find((s) => s.type === "OVER")!,
  }));
}

describe("odds quarantine — placeholder odds", () => {
  it("marks a 1501-style placeholder among >= 4 quotes as suspect, peers untouched", () => {
    const result = groupMarketsByTypeWithParameters(
      overQuotes([
        { bookmaker: "sts", odds: 1.85 },
        { bookmaker: "fortuna", odds: 1.9 },
        { bookmaker: "betclic", odds: 1.87 },
        { bookmaker: "superbet", odds: 1.92 },
        { bookmaker: "betcris", odds: 1501 },
      ])
    );

    const selections = allOverSelections(result);
    const betcris = selections.find((s) => s.bookmaker === "betcris")!;
    expect(betcris.sel.suspect).toBe(true);
    // Placeholder is flagged, NOT dropped (audit must still see it)
    expect(betcris.sel.odds).toBe(1501);

    for (const { bookmaker, sel } of selections) {
      if (bookmaker === "betcris") continue;
      expect(sel.suspect).toBeUndefined();
    }
  });

  it("does NOT quarantine when the pool has fewer than 4 quotes", () => {
    const result = groupMarketsByTypeWithParameters(
      overQuotes([
        { bookmaker: "sts", odds: 1.85 },
        { bookmaker: "fortuna", odds: 1.9 },
        { bookmaker: "betcris", odds: 1501 },
      ])
    );

    for (const { sel } of allOverSelections(result)) {
      expect(sel.suspect).toBeUndefined();
    }
  });
});

describe("odds quarantine — decimal shift", () => {
  it("marks an x10-shifted quote among >= 4 peers as suspect", () => {
    // 15 vs median ~1.5: deviation ~900% > 400% and 15/10 = 1.5 within ±15%
    const result = groupMarketsByTypeWithParameters(
      overQuotes([
        { bookmaker: "sts", odds: 1.5 },
        { bookmaker: "fortuna", odds: 1.48 },
        { bookmaker: "betclic", odds: 1.52 },
        { bookmaker: "lvbet", odds: 15 },
      ])
    );

    const selections = allOverSelections(result);
    expect(selections.find((s) => s.bookmaker === "lvbet")!.sel.suspect).toBe(true);
    expect(selections.find((s) => s.bookmaker === "sts")!.sel.suspect).toBeUndefined();
  });

  it("marks an x100-shifted quote as suspect", () => {
    const result = groupMarketsByTypeWithParameters(
      overQuotes([
        { bookmaker: "sts", odds: 1.5 },
        { bookmaker: "fortuna", odds: 1.48 },
        { bookmaker: "betclic", odds: 1.52 },
        { bookmaker: "lvbet", odds: 150 },
      ])
    );

    expect(
      allOverSelections(result).find((s) => s.bookmaker === "lvbet")!.sel.suspect
    ).toBe(true);
  });

  it("does NOT mark a genuine outlier that is not a decimal shift", () => {
    // 11 deviates > 400% from median ~2.0, but 11/10 = 1.1 and 11/100 = 0.11
    // are nowhere near the median → legitimate disagreement, not quarantine.
    const result = groupMarketsByTypeWithParameters(
      overQuotes([
        { bookmaker: "sts", odds: 2.0 },
        { bookmaker: "fortuna", odds: 1.95 },
        { bookmaker: "betclic", odds: 2.05 },
        { bookmaker: "lvbet", odds: 11 },
      ])
    );

    for (const { sel } of allOverSelections(result)) {
      expect(sel.suspect).toBeUndefined();
    }
  });

  it("leaves a normal pool completely unmarked", () => {
    const result = groupMarketsByTypeWithParameters(
      overQuotes([
        { bookmaker: "sts", odds: 1.85 },
        { bookmaker: "fortuna", odds: 1.9 },
        { bookmaker: "betclic", odds: 1.87 },
        { bookmaker: "superbet", odds: 1.92 },
      ])
    );

    for (const { sel } of allOverSelections(result)) {
      expect(sel.suspect).toBeUndefined();
    }
  });
});

describe("odds quarantine — best-odds safety via isUsableOdds", () => {
  it("a suspect quote never wins a best-odds computation using the helper", () => {
    const result = groupMarketsByTypeWithParameters(
      overQuotes([
        { bookmaker: "sts", odds: 1.85 },
        { bookmaker: "fortuna", odds: 1.9 },
        { bookmaker: "betclic", odds: 1.87 },
        { bookmaker: "superbet", odds: 1.92 },
        { bookmaker: "betcris", odds: 1501 },
      ])
    );

    // Mirror the frontend best-odds loop pattern
    let best: { bookmaker: string; odds: number } | null = null;
    for (const { bookmaker, sel } of allOverSelections(result)) {
      if (sel.odds > 0 && isUsableOdds(sel) && (!best || sel.odds > best.odds)) {
        best = { bookmaker, odds: sel.odds };
      }
    }

    expect(best).toEqual({ bookmaker: "superbet", odds: 1.92 });
  });
});
