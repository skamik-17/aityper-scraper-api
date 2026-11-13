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
import { REST_MARKET_HEADERS, type RestMarketBrand } from "./brand.js";
import { fetchRestMarketOffer } from "./runner.js";

export class RestMarketHttpScraper<E> extends HttpScraper {
  readonly bookmaker: PolishBookmaker;
  /** README §3 / plan 07 DeclaresTransport; the brand classes inherit it. */
  readonly transport = "http" as const;

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
    return fetchRestMarketOffer(this.brand, this.http, league, budget);
  }
}
