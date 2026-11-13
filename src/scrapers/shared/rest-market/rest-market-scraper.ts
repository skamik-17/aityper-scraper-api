/**
 * HttpScraper for one /rest/market brand: league check, budget and the skip-ratio
 * result contract come from HttpScraper, the fetching from fetchRestMarketOffer.
 */
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported as leagueSupported } from "../../../config/leagues.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { HttpScraper } from "../../base/http-scraper.js";
import type { ScrapeBudget } from "../budget.js";
import { createHttpClient, type HttpClient } from "../http/http-client.js";
import type { EventRef, IncrementalScraper } from "../incremental/incremental-scraper.js";
import { REST_MARKET_DETAIL_CONCURRENCY, REST_MARKET_HEADERS, type RestMarketBrand } from "./brand.js";
import { fetchRestMarketEvent, fetchRestMarketOffer, listRestMarketEvents } from "./runner.js";

export class RestMarketHttpScraper<E> extends HttpScraper implements IncrementalScraper<E> {
  readonly bookmaker: PolishBookmaker;
  /** README §3 / plan 07 DeclaresTransport; the brand classes inherit it. */
  readonly transport = "http" as const;
  /** Plan 10: details in flight at once, also on incremental passes. */
  readonly detailConcurrency = REST_MARKET_DETAIL_CONCURRENCY;

  constructor(
    private readonly brand: RestMarketBrand<E>,
    http?: HttpClient,
  ) {
    super(http ?? createHttpClient({ defaultHeaders: { ...REST_MARKET_HEADERS } }));
    this.bookmaker = brand.bookmaker;
  }

  protected isLeagueSupported(league: string): boolean {
    return leagueSupported(league, this.bookmaker);
  }

  protected fetchFullOffer(
    league: string,
    budget: ScrapeBudget,
  ): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }> {
    // listRestMarketEvents + fetchRestMarketEvent over every ref, with plan 03's log lines
    return fetchRestMarketOffer(this.brand, this.http, league, budget);
  }

  listEvents(league: string, budget: ScrapeBudget): Promise<EventRef<E>[]> {
    return listRestMarketEvents(this.brand, this.http, league, budget);
  }

  fetchEvent(league: string, ref: EventRef<E>, budget: ScrapeBudget): Promise<FullMatchOffer | null> {
    return fetchRestMarketEvent(this.brand, this.http, league, ref, budget);
  }
}
