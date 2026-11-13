/**
 * The one contract the aggregator needs from a bookmaker scraper, whatever its
 * transport (browser, HTTP or WebSocket).
 */
import type { PolishBookmaker } from "../../config/index.js";
import type { FullOfferScraperResult } from "../../types/full-offer.js";
import type { ScrapeBudget } from "./budget.js";
import type { HttpStats } from "./http/http-client.js";

export interface FullOfferScraper {
  readonly bookmaker: PolishBookmaker;
  scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult>;
  cleanup(): Promise<void>;
}

/** Default hard budget per scrape, by transport. */
export const DEFAULT_MAX_DURATION_MS = { http: 120_000, websocket: 120_000, browser: 240_000 } as const;

/**
 * Transport counters. They are cumulative and monotonic since the scraper
 * instance was created; consumers diff two readings around a unit of work.
 */
export interface TransportStats {
  http?: HttpStats;
  ws?: { framesReceived: number; bytesReceived: number };
}

export interface TransportStatsSource {
  /** Returns copies, never live objects. */
  transportStats(): TransportStats;
}

export function hasTransportStats(s: FullOfferScraper): s is FullOfferScraper & TransportStatsSource {
  return typeof (s as Partial<TransportStatsSource>).transportStats === "function";
}
