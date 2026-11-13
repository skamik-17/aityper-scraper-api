/**
 * etoto over plain HTTP (api.etoto.pl /rest/market), no browser.
 *
 * Cloudflare: every etoto host is served through Cloudflare, and www.etoto.pl embeds its
 * challenge script; api.etoto.pl answered JSON without `cf-mitigated` when recorded. If
 * the API starts challenging plain clients, the listing fails with
 * `fetch HTTP 403|503 … | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser`
 * (or `fetch non-JSON text/html …`), visible as `[Aggregator/FullOffer] etoto scrape_failed: … - <error>`,
 * in `scraper_runs.error_message` and in `/api/health/scrapers` lastError. The fallback
 * SCRAPER_TRANSPORT_ETOTO=browser (read at startup) switches to EtotoBrowserScraper.
 */
import { API_BASE_URL } from "../../../bookmakers/etoto/constants.js";
import { toEtotoOffer } from "../../../bookmakers/etoto/offer-mapping.js";
import { isValidEvent, parseTeamNames } from "../../../bookmakers/etoto/parser.js";
import { getCanonicalTeamName } from "../../../../utils/team-matcher.js";
import type { EtotoEvent } from "../../../bookmakers/etoto/types.js";
import type { HttpClient } from "../../http/http-client.js";
import { outcomePriceParts, restMarketDetail, restMarketListing, type RestMarketBrand } from "../brand.js";
import { RestMarketHttpScraper } from "../rest-market-scraper.js";

export const ETOTO_REST_MARKET: RestMarketBrand<EtotoEvent> = {
  bookmaker: "etoto",
  logTag: "[eToto/FullOffer]",
  listingUrl: (categoryId) => `${API_BASE_URL}/categories/multi/${categoryId}/events`,
  detailUrl: (eventId) => `${API_BASE_URL}/events/${eventId}`,
  listingEvents: restMarketListing,
  detailEvent: restMarketDetail,
  isMatch: isValidEvent,
  eventId: (event) => String(event.eventId),
  toOffer: toEtotoOffer,
  teamsOf: (event, league) => {
    // Same parse and canonicalization as toEtotoOffer
    const teams = parseTeamNames(event.eventName);
    return { homeTeam: getCanonicalTeamName(teams.homeTeam, league), awayTeam: getCanonicalTeamName(teams.awayTeam, league) };
  },
  listingPrices: (event) => outcomePriceParts(event.eventGames),
};

export class EtotoHttpScraper extends RestMarketHttpScraper<EtotoEvent> {
  constructor(http?: HttpClient) {
    super(ETOTO_REST_MARKET, http);
  }
}
