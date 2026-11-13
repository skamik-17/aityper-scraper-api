/**
 * Counting and parity helpers for perf smoke runs.
 */
import type { FullOfferScraperResult } from "../types/full-offer.js";
import type { TransportStats } from "../scrapers/shared/scraper-contract.js";

export interface PerfCounts {
  matches: number;
  markets: number;
  selections: number;
}

export function countOffer(result: Pick<FullOfferScraperResult, "matches"> | null): PerfCounts {
  const matches = result?.matches ?? [];
  let markets = 0;
  let selections = 0;
  for (const m of matches) {
    markets += m.markets.length;
    for (const mk of m.markets) selections += mk.selections.length;
  }
  return { matches: matches.length, markets, selections };
}

export interface PerfParity {
  matchesEqual: boolean;
  marketsDeltaPct: number | null;
  selectionsDeltaPct: number | null;
  pass: boolean;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const deltaPct = (base: number, cur: number) => (base === 0 ? null : round2(((cur - base) / base) * 100));

export function comparePerfParity(baseline: PerfCounts, current: PerfCounts, tolerancePct = 2): PerfParity {
  const matchesEqual = baseline.matches === current.matches;
  const marketsDeltaPct = deltaPct(baseline.markets, current.markets);
  const selectionsDeltaPct = deltaPct(baseline.selections, current.selections);
  const within = (d: number | null) => d !== null && Math.abs(d) <= tolerancePct;
  return {
    matchesEqual,
    marketsDeltaPct,
    selectionsDeltaPct,
    pass: baseline.matches > 0 && matchesEqual && within(marketsDeltaPct) && within(selectionsDeltaPct),
  };
}

/** Field-wise after - before; counters are cumulative (README §3). A side present only in `after` is copied. */
export function diffTransportStats(before: TransportStats, after: TransportStats): TransportStats {
  const out: TransportStats = {};
  if (after.http) {
    const b = before.http;
    const byStatus: Record<string, number> = {};
    for (const [k, v] of Object.entries(after.http.byStatus)) byStatus[k] = v - (b?.byStatus[k] ?? 0);
    out.http = {
      requests: after.http.requests - (b?.requests ?? 0),
      retries: after.http.retries - (b?.retries ?? 0),
      failures: after.http.failures - (b?.failures ?? 0),
      bytes: after.http.bytes - (b?.bytes ?? 0),
      byStatus,
    };
  }
  if (after.ws) {
    out.ws = {
      framesReceived: after.ws.framesReceived - (before.ws?.framesReceived ?? 0),
      bytesReceived: after.ws.bytesReceived - (before.ws?.bytesReceived ?? 0),
    };
  }
  return out;
}
