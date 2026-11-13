/**
 * The /rest/market brand family (etoto, forbet, fuksiarz, betfan): what one brand
 * supplies to the shared runner, and the envelope readers most of them share.
 */
import type { PolishBookmaker } from "../../../config/index.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { HttpError } from "../http/http-error.js";

export interface RestMarketBrand<E> {
  readonly bookmaker: PolishBookmaker;
  /** Log prefix, e.g. "[eToto/FullOffer]". */
  readonly logTag: string;
  listingUrl(categoryId: string | number): string;
  detailUrl(eventId: string): string;
  /** The listing's events; throws `listing without events <url>` on a malformed envelope. */
  listingEvents(body: unknown, url: string): E[];
  /** The detail's event; throws `detail without event data <url>` when the envelope has none. */
  detailEvent(body: unknown, url: string): E;
  /** False for pseudo-events (match-day combos) that have no detail of their own. */
  isMatch(event: E): boolean;
  eventId(event: E): string;
  /** The offer, or null when the detail has no markets. */
  toOffer(listed: E, detail: E, league: string): FullMatchOffer | null;
}

/** Detail requests in flight at once per brand. */
export const REST_MARKET_DETAIL_CONCURRENCY = 4;

export const REST_MARKET_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Accept: "application/json",
  "Accept-Language": "pl-PL,pl;q=0.9",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `body.data` as the event list; it may be empty (off-season), but it must be an array. */
export function restMarketListing<E>(body: unknown, url: string): E[] {
  if (!isRecord(body) || !Array.isArray(body.data)) throw new Error(`listing without events ${url}`);
  return body.data as E[];
}

/** `body.data` as the event; an envelope without it (e.g. `{"code":404,…}` with HTTP 200) is an error. */
export function restMarketDetail<E>(body: unknown, url: string): E {
  if (!isRecord(body) || !isRecord(body.data) || !("eventId" in body.data)) {
    throw new Error(`detail without event data ${url}`);
  }
  return body.data as E;
}

/**
 * Names the browser fallback on what looks like a bot challenge: a non-JSON body, or
 * HTTP 403/503. Returns a new HttpError (same kind, url and status); any other error
 * comes back unchanged.
 */
export function withChallengeHint(error: unknown, bookmaker: PolishBookmaker): unknown {
  if (!(error instanceof HttpError)) return error;
  const challenged = error.kind === "content-type" || (error.kind === "http" && (error.status === 403 || error.status === 503));
  if (!challenged) return error;
  const hint = ` | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_${bookmaker.toUpperCase()}=browser`;
  return new HttpError(error.kind, error.url, error.status, `${error.message}${hint}`, {
    contentType: error.contentType,
    bodySnippet: error.bodySnippet,
    cfMitigated: error.cfMitigated,
  });
}
