/**
 * One league of a /rest/market brand over plain HTTP: the listing, then one detail
 * per listed match (REST_MARKET_DETAIL_CONCURRENCY at a time). A failed detail skips
 * its match; there is never a fallback to listing data.
 *
 * Plan 10: the listing (listRestMarketEvents) and one detail (fetchRestMarketEvent) are
 * separate, so incremental passes fetch only the due details; the full pass composes them.
 */
import { getBookmakerLeagueId } from "../../../config/leagues.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import type { ScrapeBudget } from "../budget.js";
import { fetchDetailsSkippingFailures } from "../detail-fetch.js";
import type { HttpClient } from "../http/http-client.js";
import type { EventRef } from "../incremental/incremental-scraper.js";
import { listingFingerprintOrNull } from "../incremental/listing-fingerprint.js";
import { toIsoStartTime } from "../start-time.js";
import { REST_MARKET_DETAIL_CONCURRENCY, REST_MARKET_HEADERS, withChallengeHint, type RestMarketBrand } from "./brand.js";

function getJsonFor(http: HttpClient, brand: RestMarketBrand<unknown>) {
  return async (url: string, signal: AbortSignal): Promise<unknown> => {
    try {
      return await http.getJson<unknown>(url, { headers: { ...REST_MARKET_HEADERS }, signal });
    } catch (error) {
      throw withChallengeHint(error, brand.bookmaker);
    }
  };
}

/** The listing's prices plus its market count; null without parts or with a duplicate key. */
function fingerprintOf<E>(brand: RestMarketBrand<E>, event: E): string | null {
  const parts: Array<[string, number]> = brand.listingPrices(event);
  const gamesCount = (event as { gamesCount?: unknown }).gamesCount;
  if (typeof gamesCount === "number") parts.push(["gamesCount", gamesCount]);
  return listingFingerprintOrNull(parts, `${brand.logTag} ${brand.eventId(event)}`);
}

/** The listed matches (brand.isMatch), in listing order. Throws on a listing failure. */
export async function listRestMarketEvents<E>(
  brand: RestMarketBrand<E>,
  http: HttpClient,
  league: string,
  budget: ScrapeBudget,
): Promise<EventRef<E>[]> {
  const { bookmaker, logTag } = brand;
  const categoryId = getBookmakerLeagueId(league, bookmaker);
  if (categoryId === undefined) throw new Error(`Unknown league: ${league}`);

  const url = brand.listingUrl(categoryId as string | number);
  const events = brand.listingEvents(await getJsonFor(http, brand as RestMarketBrand<unknown>)(url, budget.signal), url);
  if (events.length === 0) {
    // README §3 empty-listing rule: success with no matches (observability: `empty`)
    console.warn(`${logTag} No events found from API ${url}`);
    return [];
  }

  const listed = events.filter((e) => brand.isMatch(e));
  console.log(`${logTag} Found ${events.length} events, ${listed.length} matches`);
  return listed.map((e) => {
    const eventId = brand.eventId(e);
    const eventStart = (e as { eventStart?: unknown }).eventStart;
    return {
      eventId,
      ...brand.teamsOf(e, league),
      kickoff: toIsoStartTime(typeof eventStart === "number" ? eventStart : undefined) ?? null,
      fingerprint: fingerprintOf(brand, e),
      eventUrl: brand.detailUrl(eventId),
      listing: e,
    };
  });
}

/** One listed match's detail as an offer; null when it has no markets. Throws on a failed detail. */
export async function fetchRestMarketEvent<E>(
  brand: RestMarketBrand<E>,
  http: HttpClient,
  league: string,
  ref: EventRef<E>,
  budget: ScrapeBudget,
): Promise<FullMatchOffer | null> {
  const detailUrl = brand.detailUrl(ref.eventId);
  const detail = brand.detailEvent(await getJsonFor(http, brand as RestMarketBrand<unknown>)(detailUrl, budget.signal), detailUrl);
  return brand.toOffer(ref.listing, detail, league);
}

/** The full pass: listRestMarketEvents, then every detail (listing order kept). */
export async function fetchRestMarketOffer<E>(
  brand: RestMarketBrand<E>,
  http: HttpClient,
  league: string,
  budget: ScrapeBudget,
): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }> {
  const { logTag } = brand;
  const refs = await listRestMarketEvents(brand, http, league, budget);
  if (refs.length === 0) return { matches: [], skipped: [] };

  // fetched comes back in listing order whatever order the details resolved in
  const outcome = await fetchDetailsSkippingFailures(
    refs,
    (r) => r.eventId,
    (r) => fetchRestMarketEvent(brand, http, league, r, budget),
    { concurrency: REST_MARKET_DETAIL_CONCURRENCY, budget },
  );

  const matches: FullMatchOffer[] = [];
  for (const { detail: offer } of outcome.fetched) {
    if (offer === null) continue;
    matches.push(offer);
    console.log(`${logTag} ${offer.homeTeam} vs ${offer.awayTeam}: ${offer.markets.length} markets`);
  }
  for (const s of outcome.skipped) console.warn(`${logTag} Skipping ${s.id}: ${s.error}`);

  const totalMarkets = matches.reduce((n, m) => n + m.markets.length, 0);
  console.log(`${logTag} Completed: ${matches.length} matches, ${totalMarkets} total markets, ${outcome.skipped.length} skipped`);
  return { matches, skipped: outcome.skipped };
}
