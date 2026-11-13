/**
 * Template for browserless scrapers: league check, a hard budget, and one
 * result contract. A failed detail skips its match; more skipped details than
 * MAX_SKIPPED_DETAIL_RATIO of the attempted ones fail the scrape with the cause.
 */
import type { PolishBookmaker } from "../../config/index.js";
import type { FullMatchOffer, FullOfferScraperResult } from "../../types/full-offer.js";
import { createScrapeBudget, type ScrapeBudget } from "../shared/budget.js";
import { MAX_SKIPPED_DETAIL_RATIO } from "../shared/detail-fetch.js";
import { createHttpClient, type HttpClient } from "../shared/http/http-client.js";
import {
  DEFAULT_MAX_DURATION_MS,
  type FullOfferScraper,
  type TransportStats,
  type TransportStatsSource,
} from "../shared/scraper-contract.js";

export abstract class HttpScraper implements FullOfferScraper, TransportStatsSource {
  abstract readonly bookmaker: PolishBookmaker;
  /** Read by plan 07's job classification (DeclaresTransport). */
  readonly transport = "http" as const;

  protected constructor(protected readonly http: HttpClient = createHttpClient()) {}

  protected abstract isLeagueSupported(league: string): boolean;

  protected abstract fetchFullOffer(
    league: string,
    budget: ScrapeBudget,
  ): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }>;

  async scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    const start = Date.now();
    const base = { bookmaker: this.bookmaker, league };

    if (!this.isLeagueSupported(league)) {
      return { ...base, success: false, matches: [], error: `Unknown league: ${league}`, duration: Date.now() - start };
    }

    let outcome: { matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> };
    try {
      const b = budget ?? createScrapeBudget(DEFAULT_MAX_DURATION_MS.http);
      b.checkpoint();
      outcome = await this.fetchFullOffer(league, b);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[${this.bookmaker}] Full offer scraper error: ${error}`);
      return { ...base, success: false, matches: [], error, duration: Date.now() - start };
    }

    const { matches, skipped } = outcome;
    const n = skipped.length;
    if (n === 0) return { ...base, success: true, matches, duration: Date.now() - start };

    const m = matches.length + n;
    const error = `${n} of ${m} details failed | ${skipped[0].error}`;
    console.warn(`[${this.bookmaker}] ${error}`);
    if (n / m > MAX_SKIPPED_DETAIL_RATIO) {
      return { ...base, success: false, matches: [], error, duration: Date.now() - start };
    }
    return { ...base, success: true, matches, error, duration: Date.now() - start };
  }

  transportStats(): TransportStats {
    return { http: { ...this.http.stats, byStatus: { ...this.http.stats.byStatus } } };
  }

  async cleanup(): Promise<void> {}
}
