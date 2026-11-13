/**
 * forbet over plain HTTP (www.iforbet.pl /rest/market), no browser.
 *
 * Cloudflare: www.iforbet.pl is served through Cloudflare. If the API starts challenging
 * plain clients, the listing fails with
 * `fetch HTTP 403|503 … | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_FORBET=browser`
 * (or `fetch non-JSON text/html …`), visible in the aggregator line, `scraper_runs.error_message`
 * and `/api/health/scrapers` lastError. SCRAPER_TRANSPORT_FORBET=browser (read at startup)
 * switches to ForbetBrowserScraper.
 */
import { API_BASE_URL, BASE_URL } from "../../../bookmakers/forbet/constants.js";
import { toForbetOffer } from "../../../bookmakers/forbet/offer-mapping.js";
import { isValidEvent } from "../../../bookmakers/forbet/parser.js";
import type { ForbetEvent } from "../../../bookmakers/forbet/types.js";
import type { HttpClient } from "../../http/http-client.js";
import { restMarketDetail, restMarketListing, type RestMarketBrand } from "../brand.js";
import { RestMarketHttpScraper } from "../rest-market-scraper.js";

export const FORBET_REST_MARKET: RestMarketBrand<ForbetEvent> = {
  bookmaker: "forbet",
  logTag: "[forBET/FullOffer]",
  // gamesClass=major: byte-identical to the browser path's listing request
  listingUrl: (categoryId) => `${API_BASE_URL}/${categoryId}/events?gamesClass=major`,
  detailUrl: (eventId) => `${BASE_URL}/rest/market/events/${eventId}`,
  listingEvents: restMarketListing,
  detailEvent: restMarketDetail,
  isMatch: isValidEvent,
  eventId: (event) => String(event.eventId),
  toOffer: toForbetOffer,
};

export class ForbetHttpScraper extends RestMarketHttpScraper<ForbetEvent> {
  constructor(http?: HttpClient) {
    super(FORBET_REST_MARKET, http);
  }
}
