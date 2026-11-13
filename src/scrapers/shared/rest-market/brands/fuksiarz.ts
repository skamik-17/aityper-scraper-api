/**
 * fuksiarz over plain HTTP (fuksiarz.pl /rest/market), no browser.
 *
 * Cloudflare: fuksiarz.pl is served through Cloudflare. If the API starts challenging
 * plain clients, the listing fails with
 * `fetch HTTP 403|503 … | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_FUKSIARZ=browser`
 * (or `fetch non-JSON text/html …`), visible in the aggregator line, `scraper_runs.error_message`
 * and `/api/health/scrapers` lastError. SCRAPER_TRANSPORT_FUKSIARZ=browser (read at startup)
 * switches to FuksiarzBrowserScraper.
 */
import { API_BASE_URL, BASE_URL } from "../../../bookmakers/fuksiarz/constants.js";
import { toFuksiarzOffer } from "../../../bookmakers/fuksiarz/offer-mapping.js";
import { isValidEvent } from "../../../bookmakers/fuksiarz/parser.js";
import type { FuksiarzEvent } from "../../../bookmakers/fuksiarz/types.js";
import type { HttpClient } from "../../http/http-client.js";
import { restMarketDetail, restMarketListing, type RestMarketBrand } from "../brand.js";
import { RestMarketHttpScraper } from "../rest-market-scraper.js";

export const FUKSIARZ_REST_MARKET: RestMarketBrand<FuksiarzEvent> = {
  bookmaker: "fuksiarz",
  logTag: "[Fuksiarz/FullOffer]",
  listingUrl: (categoryId) => `${API_BASE_URL}/${categoryId}/events`,
  detailUrl: (eventId) => `${BASE_URL}/rest/market/events/${eventId}`,
  listingEvents: restMarketListing,
  detailEvent: restMarketDetail,
  isMatch: isValidEvent,
  eventId: (event) => String(event.eventId),
  toOffer: toFuksiarzOffer,
};

export class FuksiarzHttpScraper extends RestMarketHttpScraper<FuksiarzEvent> {
  constructor(http?: HttpClient) {
    super(FUKSIARZ_REST_MARKET, http);
  }
}
