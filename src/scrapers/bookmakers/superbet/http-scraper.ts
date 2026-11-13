/**
 * superbet over plain HTTP (the Fastly-fronted offer API), no browser: the tournament's
 * by-date listing, then each upcoming, offered event's detail, 4 at a time. Offers come
 * back in kickoff order whatever order the details resolve in. A failed detail is
 * skipped and reported (HttpScraper's skip-ratio contract).
 */
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { HttpScraper } from "../../base/http-scraper.js";
import type { ScrapeBudget } from "../../shared/budget.js";
import { fetchDetailsSkippingFailures } from "../../shared/detail-fetch.js";
import type { HttpClient } from "../../shared/http/http-client.js";
import type { EventRef, IncrementalScraper } from "../../shared/incremental/incremental-scraper.js";
import { listingFingerprintOrNull } from "../../shared/incremental/listing-fingerprint.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import { TOURNAMENT_IDS } from "./constants.js";
import { mapSuperbetEventOffer, selectUpcomingSuperbetEvents } from "./full-offer-mapping.js";
import { buildEventUrl, buildSuperbetListingUrl, superbetEventDetailUrl } from "./navigation.js";
import { parseTeamNames } from "./parser.js";
import type { SuperbetEvent, SuperbetEventDetailResponse } from "./types.js";

const DETAIL_CONCURRENCY = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Kickoff from `utcDate` (UTC; an offset-less value is read as UTC, never as host-local
 * time), else from `unixDateMillis`. Never `matchDate`, which is Polish local time.
 */
function superbetKickoff(event: SuperbetEvent): string | null {
  const utc = event.utcDate?.trim();
  if (utc) {
    const iso = /Z$|[+-]\d{2}:?\d{2}$/.test(utc) ? utc : `${utc.replace(" ", "T")}Z`;
    const at = toIsoStartTime(iso);
    if (at !== undefined) return at;
  }
  return toIsoStartTime(event.unixDateMillis) ?? null;
}

export class SuperbetHttpScraper extends HttpScraper implements IncrementalScraper<SuperbetEvent> {
  readonly bookmaker: PolishBookmaker = "superbet";
  /** README §3 / plan 07 DeclaresTransport. */
  readonly transport = "http" as const;
  /** Plan 10: details in flight at once, also on incremental passes. */
  readonly detailConcurrency = DETAIL_CONCURRENCY;

  constructor(http?: HttpClient) {
    super(http);
  }

  protected isLeagueSupported(league: string): boolean {
    return isLeagueSupported(league, this.bookmaker);
  }

  /** Upcoming, offered events in kickoff order; null when the listing has none at all. */
  private async listUpcoming(league: string, budget: ScrapeBudget): Promise<SuperbetEvent[] | null> {
    const tournamentIds = TOURNAMENT_IDS[league];
    if (!tournamentIds) throw new Error(`Unknown league: ${league}`);

    const url = buildSuperbetListingUrl(tournamentIds.join(","), new Date());
    const body = await this.http.getJson<unknown>(url, { signal: budget.signal });
    if (!isRecord(body) || !Array.isArray(body.data)) throw new Error(`fetch unexpected payload ${url}`);
    const events = body.data as SuperbetEvent[];
    if (events.length === 0) {
      // README §3 empty-listing rule: success with no matches (observability: `empty`)
      console.warn(`[Superbet/FullOffer] No events found from API ${url}`);
      return null;
    }
    console.log(`[Superbet/FullOffer] Found ${events.length} events`);

    const upcoming = selectUpcomingSuperbetEvents(events, Date.now());
    console.log(`[Superbet/FullOffer] ${upcoming.length} upcoming events with an active offer`);
    return upcoming;
  }

  /** One event's detail; a 200 of the wrong shape is a failed detail, {data: []} is "no offer". */
  private async fetchDetail(eventId: number, signal: AbortSignal): Promise<SuperbetEventDetailResponse> {
    const detailUrl = superbetEventDetailUrl(eventId);
    const detail = await this.http.getJson<unknown>(detailUrl, { signal });
    if (!isRecord(detail) || !Array.isArray(detail.data)) throw new Error(`fetch unexpected payload ${detailUrl}`);
    return detail as unknown as SuperbetEventDetailResponse;
  }

  protected async fetchFullOffer(
    league: string,
    budget: ScrapeBudget,
  ): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }> {
    const upcoming = await this.listUpcoming(league, budget);
    if (upcoming === null) return { matches: [], skipped: [] };

    // Same listing and detail as listEvents/fetchEvent; offers mapped in kickoff order
    const outcome = await fetchDetailsSkippingFailures(
      upcoming,
      (event) => String(event.eventId),
      (event, signal) => this.fetchDetail(event.eventId, signal),
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

  /** Plan 10. Fingerprint: the listed odds by uuid, plus the market count. */
  async listEvents(league: string, budget: ScrapeBudget): Promise<EventRef<SuperbetEvent>[]> {
    const upcoming = (await this.listUpcoming(league, budget)) ?? [];
    return upcoming.map((event) => {
      const teams = parseTeamNames(event.matchName);
      const parts: Array<[string, number]> = (event.odds ?? []).map((o, i) => [o.uuid ? `o:${o.uuid}` : `i:${i}`, o.price]);
      if (typeof event.marketCount === "number") parts.push(["marketCount", event.marketCount]);
      return {
        eventId: String(event.eventId),
        homeTeam: getCanonicalTeamName(teams.homeTeam, league),
        awayTeam: getCanonicalTeamName(teams.awayTeam, league),
        kickoff: superbetKickoff(event),
        fingerprint: listingFingerprintOrNull(parts, `[Superbet/FullOffer] ${event.eventId}`),
        eventUrl: buildEventUrl(event.eventId),
        listing: event,
      };
    });
  }

  async fetchEvent(league: string, ref: EventRef<SuperbetEvent>, budget: ScrapeBudget): Promise<FullMatchOffer | null> {
    return mapSuperbetEventOffer(await this.fetchDetail(ref.listing.eventId, budget.signal), league);
  }
}
