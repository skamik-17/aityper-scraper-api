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
import { HttpScraper } from "../../base/http-scraper.js";
import type { ScrapeBudget } from "../../shared/budget.js";
import { fetchDetailsSkippingFailures } from "../../shared/detail-fetch.js";
import type { HttpClient } from "../../shared/http/http-client.js";
import { TOURNAMENT_IDS } from "./constants.js";
import { mapLvbetMatchOffer, selectLvbetMatches } from "./full-offer-mapping.js";
import { lvbetCompetitionViewUrl, lvbetMarketsSearchUrl } from "./navigation.js";
import type { LVBetCompetitionResponse, LVBetMarket } from "./types.js";

const DETAIL_CONCURRENCY = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class LVBetHttpScraper extends HttpScraper {
  readonly bookmaker: PolishBookmaker = "lvbet";
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
      return { matches: [], skipped: [] };
    }
    console.log(`[LVBet/FullOffer] Found ${listed.length} matches`);

    const outcome = await fetchDetailsSkippingFailures(
      selectLvbetMatches(listing),
      (match) => match.match_id,
      async (match, signal) => {
        const searchUrl = lvbetMarketsSearchUrl([match.match_id]);
        const markets = await this.http.getJson<unknown>(searchUrl, { signal });
        // A 200 of the wrong shape is a failed detail, never an empty offer
        if (!Array.isArray(markets)) throw new Error(`fetch unexpected payload ${searchUrl}`);
        return markets as LVBetMarket[];
      },
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
}
