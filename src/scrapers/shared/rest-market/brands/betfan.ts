/**
 * betfan over plain HTTP (betfan.pl /api/v1/market), no browser.
 *
 * betfan's envelopes differ from the /rest/market brands: the listing nests its events
 * under data.categories[0].events, and a detail sits under data.event (an unknown event
 * answers HTTP 200 with {"isError":true,"data":null}).
 *
 * Cloudflare: betfan.pl is served through Cloudflare. If the API starts challenging plain
 * clients, the listing fails with
 * `fetch HTTP 403|503 … | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_BETFAN=browser`
 * (or `fetch non-JSON text/html …`), visible in the aggregator line, `scraper_runs.error_message`
 * and `/api/health/scrapers` lastError. SCRAPER_TRANSPORT_BETFAN=browser (read at startup)
 * switches to BetfanBrowserScraper.
 */
import { API_BASE_URL } from "../../../bookmakers/betfan/constants.js";
import { toBetfanOffer } from "../../../bookmakers/betfan/offer-mapping.js";
import { isValidEvent } from "../../../bookmakers/betfan/parser.js";
import type { BetfanEvent } from "../../../bookmakers/betfan/types.js";
import type { HttpClient } from "../../http/http-client.js";
import type { RestMarketBrand } from "../brand.js";
import { RestMarketHttpScraper } from "../rest-market-scraper.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const BETFAN_REST_MARKET: RestMarketBrand<BetfanEvent> = {
  bookmaker: "betfan",
  logTag: "[Betfan/FullOffer]",
  listingUrl: (categoryId) => `${API_BASE_URL}/categories/${categoryId}/events`,
  detailUrl: (eventId) => `${API_BASE_URL}/events/${eventId}`,
  listingEvents: (body, url) => {
    // An empty category list is an empty listing; a body without the list is an error
    if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.categories)) {
      throw new Error(`listing without events ${url}`);
    }
    const first: unknown = body.data.categories[0];
    const events = isRecord(first) ? first.events : undefined;
    return Array.isArray(events) ? (events as BetfanEvent[]) : [];
  },
  detailEvent: (body, url) => {
    const event = isRecord(body) && isRecord(body.data) ? body.data.event : undefined;
    if (!isRecord(event) || !("eventId" in event)) throw new Error(`detail without event data ${url}`);
    return event as unknown as BetfanEvent;
  },
  isMatch: isValidEvent,
  eventId: (event) => String(event.eventId),
  toOffer: toBetfanOffer,
};

export class BetfanHttpScraper extends RestMarketHttpScraper<BetfanEvent> {
  constructor(http?: HttpClient) {
    super(BETFAN_REST_MARKET, http);
  }
}
