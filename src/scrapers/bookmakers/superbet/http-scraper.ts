/**
 * superbet over plain HTTP (the Fastly-fronted offer API), no browser: the tournament's
 * by-date listing, then each upcoming, offered event's detail, 4 at a time. Offers come
 * back in kickoff order whatever order the details resolve in. A failed detail is
 * skipped and reported (HttpScraper's skip-ratio contract).
 */
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { HttpScraper } from "../../base/http-scraper.js";
import type { ScrapeBudget } from "../../shared/budget.js";
import { fetchDetailsSkippingFailures } from "../../shared/detail-fetch.js";
import type { HttpClient } from "../../shared/http/http-client.js";
import { TOURNAMENT_IDS } from "./constants.js";
import { mapSuperbetEventOffer, selectUpcomingSuperbetEvents } from "./full-offer-mapping.js";
import { buildSuperbetListingUrl, superbetEventDetailUrl } from "./navigation.js";
import type { SuperbetEvent, SuperbetEventDetailResponse } from "./types.js";

const DETAIL_CONCURRENCY = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SuperbetHttpScraper extends HttpScraper {
  readonly bookmaker: PolishBookmaker = "superbet";
  /** README §3 / plan 07 DeclaresTransport. */
  readonly transport = "http" as const;

  constructor(http?: HttpClient) {
    super(http);
  }

  protected isLeagueSupported(league: string): boolean {
    return isLeagueSupported(league, this.bookmaker);
  }

  protected async fetchFullOffer(
    league: string,
    budget: ScrapeBudget,
  ): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }> {
    const tournamentIds = TOURNAMENT_IDS[league];
    if (!tournamentIds) throw new Error(`Unknown league: ${league}`);

    const url = buildSuperbetListingUrl(tournamentIds.join(","), new Date());
    const body = await this.http.getJson<unknown>(url, { signal: budget.signal });
    if (!isRecord(body) || !Array.isArray(body.data)) throw new Error(`fetch unexpected payload ${url}`);
    const events = body.data as SuperbetEvent[];
    if (events.length === 0) {
      // README §3 empty-listing rule: success with no matches (observability: `empty`)
      console.warn(`[Superbet/FullOffer] No events found from API ${url}`);
      return { matches: [], skipped: [] };
    }
    console.log(`[Superbet/FullOffer] Found ${events.length} events`);

    const upcoming = selectUpcomingSuperbetEvents(events, Date.now());
    console.log(`[Superbet/FullOffer] ${upcoming.length} upcoming events with an active offer`);

    const outcome = await fetchDetailsSkippingFailures(
      upcoming,
      (event) => String(event.eventId),
      async (event, signal) => {
        const detailUrl = superbetEventDetailUrl(event.eventId);
        const detail = await this.http.getJson<unknown>(detailUrl, { signal });
        // A 200 of the wrong shape is a failed detail; {data: []} is "no offer"
        if (!isRecord(detail) || !Array.isArray(detail.data)) throw new Error(`fetch unexpected payload ${detailUrl}`);
        return detail as unknown as SuperbetEventDetailResponse;
      },
      { concurrency: DETAIL_CONCURRENCY, budget },
    );

    const matches: FullMatchOffer[] = [];
    for (const { detail } of outcome.fetched) {
      const offer = mapSuperbetEventOffer(detail, league);
      if (offer) matches.push(offer);
    }
    const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
    console.log(`[Superbet/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`);
    return { matches, skipped: outcome.skipped };
  }
}
