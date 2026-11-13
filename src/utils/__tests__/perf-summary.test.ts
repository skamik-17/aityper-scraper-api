import { describe, it, expect } from "vitest";
import { countOffer, comparePerfParity, diffTransportStats } from "../perf-summary.js";

describe("perf summary helpers", () => {
  it("counts matches, markets and selections", () =>
    expect(countOffer({ matches: [{ markets: [{ selections: [{}, {}] }, { selections: [{}] }] }, { markets: [] }] as never })).toEqual({
      matches: 2,
      markets: 2,
      selections: 3,
    }));

  it("parity passes within ±2 % with equal matches", () =>
    expect(comparePerfParity({ matches: 19, markets: 12345, selections: 22846 }, { matches: 19, markets: 12400, selections: 22900 })).toEqual({
      matchesEqual: true,
      marketsDeltaPct: 0.45,
      selectionsDeltaPct: 0.24,
      pass: true,
    }));

  it("parity fails on a match difference, a 3 % drop or an empty baseline", () => {
    expect(comparePerfParity({ matches: 19, markets: 100, selections: 100 }, { matches: 18, markets: 100, selections: 100 }).pass).toBe(false);
    expect(comparePerfParity({ matches: 19, markets: 100, selections: 100 }, { matches: 19, markets: 97, selections: 100 })).toMatchObject({
      marketsDeltaPct: -3,
      pass: false,
    });
    expect(comparePerfParity({ matches: 0, markets: 0, selections: 0 }, { matches: 0, markets: 0, selections: 0 })).toEqual({
      matchesEqual: true,
      marketsDeltaPct: null,
      selectionsDeltaPct: null,
      pass: false,
    });
  });

  it("diffTransportStats subtracts cumulative counters", () =>
    expect(
      diffTransportStats(
        { http: { requests: 3, retries: 1, failures: 0, bytes: 900, byStatus: { "200": 3 } } },
        { http: { requests: 5, retries: 1, failures: 1, bytes: 1500, byStatus: { "200": 4, timeout: 1 } }, ws: { framesReceived: 2, bytesReceived: 100 } },
      ),
    ).toEqual({ http: { requests: 2, retries: 0, failures: 1, bytes: 600, byStatus: { "200": 1, timeout: 1 } }, ws: { framesReceived: 2, bytesReceived: 100 } }));
});
