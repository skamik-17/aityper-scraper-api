import { describe, it, expect } from "vitest";
import type { ScrapedMarket } from "../../../../types/full-offer.js";
import {
  evaluateSmoke,
  formatPct,
  indexOddsList,
  isGated,
  marketStats,
  matchWinnerDeviation,
  matchWinnerPeers,
  oddsListKey,
  oneXTwoDeviation,
} from "../smoke-gate.js";

const NOW = Date.parse("2026-11-06T17:12:00Z");
const O = { nowMs: NOW, maxDays: 7, minMarkets: 50, maxListingOnly: 1, max1x2Dev: 0.10, maxDurationMs: 15_000 };
const row = (eventId: string, startTime: string, normalized: number, full = true) =>
  ({ eventId, startTime, full, normalized, unknownInMapped: 0, minOdds: 1.01, apiFound: true, max1x2Dev: 0.04 });
// live 2026-11-06 (evidence/betters/phase1-counts-pl-2026-11-06.txt): 10 matches on 6-8 Nov with 66-73, Liverpool-Man Utd on 22 Nov with 34
const live = [
  row("2725815896848338956", "2026-11-06T20:00:00.000Z", 67), row("2725816334213586962", "2026-11-07T12:30:00.000Z", 68),
  row("2725816334213586981", "2026-11-07T15:00:00.000Z", 71), row("2725818574789816354", "2026-11-07T15:00:00.000Z", 72),
  row("2725824060671029267", "2026-11-07T17:30:00.000Z", 73), row("2726134779970986000", "2026-11-08T14:00:00.000Z", 72),
  row("2726134779970986001", "2026-11-08T14:00:00.000Z", 72), row("2726134779970986002", "2026-11-08T14:00:00.000Z", 71),
  row("2726134779970986003", "2026-11-08T14:00:00.000Z", 71), row("2726177353700085769", "2026-11-08T16:30:00.000Z", 66),
  row("2725446939305979931", "2026-11-22T16:30:00.000Z", 34)];

describe("Betby smoke gate", () => {
  it("oneXTwoDeviation uses |odds / median - 1| over at least 3 peers", () => {
    expect(oneXTwoDeviation(2.74, [2.75, 2.8, 2.85])).toBeCloseTo(0.0214, 4);
    expect(oneXTwoDeviation(5.2, [5.0, 4.9, 5.1, 5.0])).toBeCloseTo(0.04, 4);
    expect(oneXTwoDeviation(2.74, [2.8, 2.7])).toBeNull();
  });

  it("evaluateSmoke reports a thin far-future match as shallow without failing", () => {
    expect(evaluateSmoke(11, live, 9_000, O)).toEqual({ result: "PASS", reasons: [], gated: 10, shallow: 1 });
    const wide = evaluateSmoke(11, live, 9_000, { ...O, maxDays: 30 });
    expect(wide.result).toBe("FAIL");
    expect(wide.reasons).toContain("2725446939305979931 normalized=34 < 50");
  });

  it("evaluateSmoke fails on dropped matches, listing-only, UNKNOWN, price and duration; skips an empty snapshot", () => {
    expect(evaluateSmoke(0, [], 500, O).result).toBe("SKIP");
    expect(evaluateSmoke(11, live.slice(0, 10), 9_000, O).reasons).toContain("matches=10 != snapshot=11");
    const twoListing = live.map((r, i) => (i < 2 ? { ...r, full: false, normalized: 7 } : r));
    expect(evaluateSmoke(11, twoListing, 9_000, O).result).toBe("FAIL");
    expect(evaluateSmoke(11, live.map((r, i) => (i === 0 ? { ...r, unknownInMapped: 1 } : r)), 9_000, O).result).toBe("FAIL");
    expect(evaluateSmoke(11, live.map((r, i) => (i === 0 ? { ...r, max1x2Dev: 0.12 } : r)), 9_000, O).result).toBe("FAIL");
    expect(evaluateSmoke(11, live.map((r, i) => (i === 0 ? { ...r, apiFound: false } : r)), 9_000, O).result).toBe("FAIL");
    expect(evaluateSmoke(11, live, 15_000, O).result).toBe("FAIL");
  });

  it("evaluateSmoke names the event and the value in every per-match reason", () => {
    const bad = live.map((r, i) => (i === 0 ? { ...r, unknownInMapped: 2, minOdds: 1.0, max1x2Dev: 0.123, apiFound: false } : r));
    expect(evaluateSmoke(11, bad, 15_000, O).reasons).toEqual([
      "2725815896848338956 unknownInMapped=2",
      "2725815896848338956 minOdds=1 < 1.01",
      "2725815896848338956 max1x2Dev=12.3% > 10.0%",
      "2725815896848338956 api=missing",
      "durationMs=15000 >= 15000",
    ]);
    const twoListing = live.map((r, i) => (i < 2 ? { ...r, full: false, normalized: 7 } : r));
    expect(evaluateSmoke(11, twoListing, 9_000, O).reasons).toEqual([
      "listingOnlyGated=2 > 1 (2725815896848338956, 2725816334213586962)",
    ]);
  });

  it("evaluateSmoke allows one gated listing-only match, ignores far listing-only ones and unknown comparisons", () => {
    const oneListing = live.map((r, i) => (i === 0 ? { ...r, full: false, normalized: 7 } : r));
    expect(evaluateSmoke(11, oneListing, 9_000, O).result).toBe("PASS");
    const farListing = live.map((r, i) => (i === 0 || i === 10 ? { ...r, full: false, normalized: 7 } : r));
    expect(evaluateSmoke(11, farListing, 9_000, O)).toEqual({ result: "PASS", reasons: [], gated: 10, shallow: 0 });
    const noCompare = live.map((r) => ({ ...r, apiFound: null, max1x2Dev: null }));
    expect(evaluateSmoke(11, noCompare, 9_000, O).result).toBe("PASS");
  });

  it("evaluateSmoke fails a price below 1.01 and an unreadable price", () => {
    expect(evaluateSmoke(11, live.map((r, i) => (i === 0 ? { ...r, minOdds: 1.0 } : r)), 9_000, O).result).toBe("FAIL");
    expect(evaluateSmoke(11, live.map((r, i) => (i === 0 ? { ...r, minOdds: Number.NaN } : r)), 9_000, O).reasons).toEqual([
      "2725815896848338956 minOdds=NaN < 1.01",
    ]);
  });
});

const sel = (normalizedName: string, odds: number) => ({ name: normalizedName, normalizedName, odds }) as ScrapedMarket["selections"][number];
const mkt = (normalizedType: string, selections: ScrapedMarket["selections"]) =>
  ({ name: normalizedType, normalizedType, selections }) as ScrapedMarket;

describe("Betby smoke row helpers", () => {
  it("marketStats counts non-OTHER markets, UNKNOWN only inside them, and the lowest price of all", () => {
    const normalized = [
      mkt("MATCH_WINNER", [sel("HOME", 2.74), sel("DRAW", 3.3), sel("AWAY", 2.54)]),
      mkt("TOTAL_GOALS", [sel("OVER", 1.93), sel("UNKNOWN", 1.85)]),
      mkt("OTHER", [sel("UNKNOWN", 1.01), sel("UNKNOWN", 40)]),
    ];
    expect(marketStats(normalized)).toEqual({ normalized: 2, unknownInMapped: 1, minOdds: 1.01 });
  });

  it("matchWinnerDeviation compares each code with its own peers and never with betters or lebull", () => {
    const body = { success: true, data: { matches: [{ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", markets: {
      MATCH_WINNER: { bookmakerOdds: {
        sts: { selections: [{ normalizedName: "HOME", odds: 2.75 }, { normalizedName: "DRAW", odds: 3.4 }, { normalizedName: "AWAY", odds: 2.5 }] },
        fortuna: { selections: [{ normalizedName: "AWAY", odds: 2.55 }, { normalizedName: "DRAW", odds: 3.3 }, { normalizedName: "HOME", odds: 2.8 }] },
        etoto: { selections: [{ normalizedName: "HOME", odds: 2.85 }, { normalizedName: "DRAW", odds: 3.35 }, { normalizedName: "AWAY", odds: 2.6 }] },
        lebull: { selections: [{ normalizedName: "HOME", odds: 9 }, { normalizedName: "DRAW", odds: 9 }, { normalizedName: "AWAY", odds: 9 }] },
        betters: { selections: [{ normalizedName: "HOME", odds: 9 }, { normalizedName: "DRAW", odds: 9 }, { normalizedName: "AWAY", odds: 9 }] },
      } } } }] } };
    const index = indexOddsList(body);
    const row = index.get(oddsListKey("Leeds United", "Tottenham Hotspur"))!;
    expect(index.has(oddsListKey("Tottenham Hotspur", "Leeds United"))).toBe(false);
    expect(matchWinnerPeers(row, "HOME")).toEqual([2.75, 2.8, 2.85]);
    const betby = [mkt("MATCH_WINNER", [sel("HOME", 2.74), sel("DRAW", 3.3), sel("AWAY", 2.54)])];
    // HOME 2.74 vs 2.8 -> 2.1%, DRAW 3.3 vs 3.35 -> 1.5%, AWAY 2.54 vs 2.55 -> 0.4%
    expect(matchWinnerDeviation(betby, row)).toBeCloseTo(0.0214, 4);
    // A swapped side lands far from its peers.
    expect(matchWinnerDeviation([mkt("MATCH_WINNER", [sel("HOME", 2.54), sel("AWAY", 2.74)])], row)).toBeCloseTo(0.0929, 4);
    expect(matchWinnerDeviation(betby, { homeTeam: "A", awayTeam: "B" })).toBeNull();
    expect(indexOddsList({ success: false }).size).toBe(0);
  });

  it("isGated includes a kick-off exactly maxDays out and an unreadable one", () => {
    expect(isGated("2026-11-13T17:12:00.000Z", O)).toBe(true);
    expect(isGated("2026-11-13T17:12:00.001Z", O)).toBe(false);
    expect(isGated("", O)).toBe(true);
  });

  it("formatPct prints one decimal or n/a", () => {
    expect(formatPct(0.0214)).toBe("2.1%");
    expect(formatPct(null)).toBe("n/a");
  });
});
