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
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { HttpScraper } from "../../base/http-scraper.js";
import type { ScrapeBudget } from "../../shared/budget.js";
import { fetchDetailsSkippingFailures } from "../../shared/detail-fetch.js";
import type { HttpClient } from "../../shared/http/http-client.js";
import type { EventRef, IncrementalScraper } from "../../shared/incremental/incremental-scraper.js";
import { withChallengeHint } from "../../shared/rest-market/brand.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import { TOURNAMENT_IDS } from "./constants.js";
import { mapFortunaFixtureOffer, selectFortunaFixtures } from "./full-offer-mapping.js";
import { buildEventUrl, fortunaFixtureMarketsUrl, fortunaFixturesUrl } from "./navigation.js";
import { parseTeamNames } from "./parser.js";
import type { FortunaFixture, FortunaFixturesResponse, FortunaMarket } from "./types.js";

const DETAIL_CONCURRENCY = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class FortunaHttpScraper extends HttpScraper implements IncrementalScraper<FortunaFixture> {
  readonly bookmaker: PolishBookmaker = "fortuna";
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

  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    try {
      return await this.http.getJson<unknown>(url, { signal });
    } catch (error) {
      throw withChallengeHint(error, this.bookmaker);
    }
  }

  /** The listing's valid fixtures; null when the listing has none at all (README §3 empty listing). */
  private async listFixtures(league: string, budget: ScrapeBudget): Promise<FortunaFixture[] | null> {
    const tournamentId = TOURNAMENT_IDS[league];
    if (!tournamentId) throw new Error(`Unknown league: ${league}`);

    const url = fortunaFixturesUrl(tournamentId);
    const body = await this.getJson(url, budget.signal);
    if (!isRecord(body) || !Array.isArray(body.fixtures)) throw new Error(`fetch unexpected payload ${url}`);
    const listing = body as unknown as FortunaFixturesResponse;
    if (listing.fixtures.length === 0) {
      // README §3 empty-listing rule: success with no matches (observability: `empty`)
      console.warn(`[Fortuna/FullOffer] No fixtures found from API ${url}`);
      return null;
    }
    console.log(`[Fortuna/FullOffer] Found ${listing.fixtures.length} fixtures`);
    return selectFortunaFixtures(listing);
  }

  /** One fixture's raw markets; a 200 of the wrong shape is a failed detail, never an empty offer. */
  private async fetchMarkets(fixture: FortunaFixture, signal: AbortSignal): Promise<FortunaMarket[]> {
    const marketsUrl = fortunaFixtureMarketsUrl(fixture.id);
    const markets = await this.getJson(marketsUrl, signal);
    if (!Array.isArray(markets)) throw new Error(`fetch unexpected payload ${marketsUrl}`);
    return markets as FortunaMarket[];
  }

  protected async fetchFullOffer(
    league: string,
    budget: ScrapeBudget,
  ): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }> {
    const fixtures = await this.listFixtures(league, budget);
    if (fixtures === null) return { matches: [], skipped: [] };

    // Same listing and detail as listEvents/fetchEvent; offers mapped in listing order
    const outcome = await fetchDetailsSkippingFailures(
      fixtures,
      (fixture) => fixture.id,
      (fixture, signal) => this.fetchMarkets(fixture, signal),
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

  /** Plan 10. No fingerprint: fortuna's listing carries no prices (they need one request per fixture). */
  async listEvents(league: string, budget: ScrapeBudget): Promise<EventRef<FortunaFixture>[]> {
    const fixtures = (await this.listFixtures(league, budget)) ?? [];
    return fixtures.map((fixture) => {
      const teams = parseTeamNames(fixture);
      return {
        eventId: fixture.id,
        homeTeam: getCanonicalTeamName(teams.homeTeam, league),
        awayTeam: getCanonicalTeamName(teams.awayTeam, league),
        kickoff: toIsoStartTime(fixture.startDatetime) ?? null,
        fingerprint: null,
        eventUrl: buildEventUrl(fixture.id, fixture.seoName),
        listing: fixture,
      };
    });
  }

  async fetchEvent(league: string, ref: EventRef<FortunaFixture>, budget: ScrapeBudget): Promise<FullMatchOffer | null> {
    return mapFortunaFixtureOffer(ref.listing, await this.fetchMarkets(ref.listing, budget.signal), league);
  }
}
