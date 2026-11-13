/**
 * fortuna over plain HTTP (api.efortuna.pl), no browser: the tournament's fixture
 * listing, then each valid fixture's full market list, 4 at a time. A failed fixture
 * is skipped and reported (HttpScraper's skip-ratio contract).
 *
 * Cloudflare: efortuna.pl is served through Cloudflare. A challenge shows up as
 * `fetch HTTP 403|503 … | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_FORTUNA=browser`
 * (or `fetch non-JSON text/html …`); SCRAPER_TRANSPORT_FORTUNA=browser (read at startup)
 * switches back to FortunaBrowserScraper.
 */
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { HttpScraper } from "../../base/http-scraper.js";
import type { ScrapeBudget } from "../../shared/budget.js";
import { fetchDetailsSkippingFailures } from "../../shared/detail-fetch.js";
import type { HttpClient } from "../../shared/http/http-client.js";
import { withChallengeHint } from "../../shared/rest-market/brand.js";
import { TOURNAMENT_IDS } from "./constants.js";
import { mapFortunaFixtureOffer, selectFortunaFixtures } from "./full-offer-mapping.js";
import { fortunaFixtureMarketsUrl, fortunaFixturesUrl } from "./navigation.js";
import type { FortunaFixturesResponse, FortunaMarket } from "./types.js";

const DETAIL_CONCURRENCY = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class FortunaHttpScraper extends HttpScraper {
  readonly bookmaker: PolishBookmaker = "fortuna";
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

    const getJson = async (url: string, signal: AbortSignal): Promise<unknown> => {
      try {
        return await this.http.getJson<unknown>(url, { signal });
      } catch (error) {
        throw withChallengeHint(error, this.bookmaker);
      }
    };

    const url = fortunaFixturesUrl(tournamentId);
    const body = await getJson(url, budget.signal);
    if (!isRecord(body) || !Array.isArray(body.fixtures)) throw new Error(`fetch unexpected payload ${url}`);
    const listing = body as unknown as FortunaFixturesResponse;
    if (listing.fixtures.length === 0) {
      // README §3 empty-listing rule: success with no matches (observability: `empty`)
      console.warn(`[Fortuna/FullOffer] No fixtures found from API ${url}`);
      return { matches: [], skipped: [] };
    }
    console.log(`[Fortuna/FullOffer] Found ${listing.fixtures.length} fixtures`);

    const outcome = await fetchDetailsSkippingFailures(
      selectFortunaFixtures(listing),
      (fixture) => fixture.id,
      async (fixture, signal) => {
        const marketsUrl = fortunaFixtureMarketsUrl(fixture.id);
        const markets = await getJson(marketsUrl, signal);
        // A 200 of the wrong shape is a failed detail, never an empty offer
        if (!Array.isArray(markets)) throw new Error(`fetch unexpected payload ${marketsUrl}`);
        return markets as FortunaMarket[];
      },
      { concurrency: DETAIL_CONCURRENCY, budget },
    );

    const matches: FullMatchOffer[] = [];
    for (const { event, detail } of outcome.fetched) {
      const offer = mapFortunaFixtureOffer(event, detail, league);
      if (offer) matches.push(offer);
    }
    const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
    console.log(`[Fortuna/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`);
    return { matches, skipped: outcome.skipped };
  }
}
