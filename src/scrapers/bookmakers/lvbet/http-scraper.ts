/**
 * lvbet over plain HTTP (offer.lvbet.pl client-api v5), no browser: the competition
 * view, then each valid match's markets (one /markets/search call per match), 4 at a
 * time. Offers come back in listing order; a failed match is skipped and reported
 * (HttpScraper's skip-ratio contract). Every body is read in full, so no response is
 * left open (LVBET-4).
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
import { mapLvbetMatchOffer, selectLvbetMatches } from "./full-offer-mapping.js";
import { buildEventUrl, lvbetCompetitionViewUrl, lvbetMarketsSearchUrl } from "./navigation.js";
import type { LVBetCompetitionResponse, LVBetMarket, LVBetMatch } from "./types.js";

const DETAIL_CONCURRENCY = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fingerprint parts per match: its primary-column selection prices. */
function primaryPricesByMatch(listing: LVBetCompetitionResponse): Map<string, Array<[string, number]>> {
  const out = new Map<string, Array<[string, number]>>();
  for (const market of listing.primary_column_markets ?? []) {
    const parts = out.get(market.match_id) ?? [];
    for (const sel of market.selections ?? []) {
      if (typeof sel.rate?.decimal === "number") parts.push([`s:${sel.selection_id}`, sel.rate.decimal]);
    }
    out.set(market.match_id, parts);
  }
  return out;
}

export class LVBetHttpScraper extends HttpScraper implements IncrementalScraper<LVBetMatch> {
  readonly bookmaker: PolishBookmaker = "lvbet";
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

  /** The competition view; null when it lists no match at all (README §3 empty listing). */
  private async fetchListing(league: string, budget: ScrapeBudget): Promise<LVBetCompetitionResponse | null> {
    const tournamentId = TOURNAMENT_IDS[league];
    if (!tournamentId) throw new Error(`Unknown league: ${league}`);

    const url = lvbetCompetitionViewUrl(tournamentId);
    const body = await this.http.getJson<unknown>(url, { signal: budget.signal });
    if (!isRecord(body) || !Array.isArray(body.matches)) throw new Error(`fetch unexpected payload ${url}`);
    const listing = body as unknown as LVBetCompetitionResponse;
    const listed = listing.matches ?? [];
    if (listed.length === 0) {
      // README §3 empty-listing rule: success with no matches (observability: `empty`)
      console.warn(`[LVBet/FullOffer] No matches found from API ${url}`);
      return null;
    }
    console.log(`[LVBet/FullOffer] Found ${listed.length} matches`);
    return listing;
  }

  /** One match's raw markets; a 200 of the wrong shape is a failed detail, never an empty offer. */
  private async fetchMarkets(match: LVBetMatch, signal: AbortSignal): Promise<LVBetMarket[]> {
    const searchUrl = lvbetMarketsSearchUrl([match.match_id]);
    const markets = await this.http.getJson<unknown>(searchUrl, { signal });
    if (!Array.isArray(markets)) throw new Error(`fetch unexpected payload ${searchUrl}`);
    return markets as LVBetMarket[];
  }

  protected async fetchFullOffer(
    league: string,
    budget: ScrapeBudget,
  ): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }> {
    const listing = await this.fetchListing(league, budget);
    if (listing === null) return { matches: [], skipped: [] };

    // Same listing and detail as listEvents/fetchEvent; offers mapped in listing order
    const outcome = await fetchDetailsSkippingFailures(
      selectLvbetMatches(listing),
      (match) => match.match_id,
      (match, signal) => this.fetchMarkets(match, signal),
      { concurrency: DETAIL_CONCURRENCY, budget },
    );

    const matches: FullMatchOffer[] = [];
    for (const { event, detail } of outcome.fetched) {
      const offer = mapLvbetMatchOffer(event, detail, league);
      if (offer) matches.push(offer);
    }
    const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
    console.log(`[LVBet/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`);
    return { matches, skipped: outcome.skipped };
  }

  /** Plan 10. Fingerprint: the match's primary-column prices by selection id, plus its market count. */
  async listEvents(league: string, budget: ScrapeBudget): Promise<EventRef<LVBetMatch>[]> {
    const listing = await this.fetchListing(league, budget);
    if (listing === null) return [];
    const prices = primaryPricesByMatch(listing);
    return selectLvbetMatches(listing).map((match) => {
      const parts = [...(prices.get(match.match_id) ?? [])];
      if (typeof match.state?.markets_count === "number") parts.push(["markets_count", match.state.markets_count]);
      return {
        eventId: match.match_id,
        // selectLvbetMatches keeps only matches with both team names, as mapLvbetMatchOffer reads them
        homeTeam: getCanonicalTeamName(match.home![0], league),
        awayTeam: getCanonicalTeamName(match.away![0], league),
        kickoff: toIsoStartTime(match.date) ?? null,
        fingerprint: listingFingerprintOrNull(parts, `[LVBet/FullOffer] ${match.match_id}`),
        eventUrl: buildEventUrl(match, league),
        listing: match,
      };
    });
  }

  async fetchEvent(league: string, ref: EventRef<LVBetMatch>, budget: ScrapeBudget): Promise<FullMatchOffer | null> {
    return mapLvbetMatchOffer(ref.listing, await this.fetchMarkets(ref.listing, budget.signal), league);
  }
}
