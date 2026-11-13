/**
 * Incremental scraping contract (plan 10): a cheap listing (`listEvents`) and a
 * per-event detail (`fetchEvent`). A scraper's full pass is exactly
 * `fetchFullOfferIncrementally`, so both paths map events identically.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import type { ScrapeBudget } from "../budget.js";
import { fetchDetailsSkippingFailures } from "../detail-fetch.js";
import {
  hasTransportStats,
  type FullOfferScraper,
  type TransportStats,
  type TransportStatsSource,
} from "../scraper-contract.js";

export interface EventRef<L = unknown> {
  /** === FullMatchOffer.matchId that fetchEvent returns. */
  readonly eventId: string;
  /** Canonical, exactly what the full pass puts in FullMatchOffer.homeTeam. */
  readonly homeTeam: string;
  readonly awayTeam: string;
  /** ISO 8601 UTC, ms precision: "2026-11-07T12:30:00.000Z". */
  readonly kickoff: string | null;
  /** listingFingerprint(...) of the listing's prices; null when the listing has none. */
  readonly fingerprint: string | null;
  readonly eventUrl: string;
  /** The scraper's own listing record, handed back to fetchEvent; never persisted or logged. */
  readonly listing: L;
}

export interface IncrementalScraper<L = unknown> extends FullOfferScraper, TransportStatsSource {
  readonly detailConcurrency: number;
  /** Same filter and order as the full pass; throws (HttpError) on a listing failure. */
  listEvents(league: string, budget: ScrapeBudget): Promise<EventRef<L>[]>;
  /**
   * null = the detail answered but maps to no markets (the full pass drops such
   * events too); throws on a failed detail.
   */
  fetchEvent(league: string, ref: EventRef<L>, budget: ScrapeBudget): Promise<FullMatchOffer | null>;
}

export function isIncrementalScraper(s: FullOfferScraper): s is IncrementalScraper {
  const c = s as Partial<IncrementalScraper>;
  return hasTransportStats(s) && typeof c.listEvents === "function" && typeof c.fetchEvent === "function";
}

export function transportTotals(t: TransportStats): { requests: number; bytes: number } {
  return { requests: t.http?.requests ?? 0, bytes: (t.http?.bytes ?? 0) + (t.ws?.bytesReceived ?? 0) };
}

/**
 * The full pass on top of the incremental contract: every listed event's detail.
 * Non-null offers come back in listing order. No started-event filter, for
 * parity with the full pass.
 */
export async function fetchFullOfferIncrementally<L>(
  s: IncrementalScraper<L>,
  league: string,
  budget: ScrapeBudget,
): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }> {
  const refs = await s.listEvents(league, budget);
  const { fetched, skipped } = await fetchDetailsSkippingFailures(
    refs,
    (r) => r.eventId,
    (r) => s.fetchEvent(league, r, budget),
    { concurrency: s.detailConcurrency, budget },
  );
  const matches = fetched.map((f) => f.detail).filter((m): m is FullMatchOffer => m !== null);
  return { matches, skipped };
}
