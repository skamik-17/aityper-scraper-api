/**
 * One league of a /rest/market brand over plain HTTP: the listing, then one detail
 * per listed match (REST_MARKET_DETAIL_CONCURRENCY at a time). A failed detail skips
 * its match; there is never a fallback to listing data.
 */
import { getBookmakerLeagueId } from "../../../config/leagues.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import type { ScrapeBudget } from "../budget.js";
import { fetchDetailsSkippingFailures } from "../detail-fetch.js";
import type { HttpClient } from "../http/http-client.js";
import { REST_MARKET_DETAIL_CONCURRENCY, REST_MARKET_HEADERS, withChallengeHint, type RestMarketBrand } from "./brand.js";

export async function fetchRestMarketOffer<E>(
  brand: RestMarketBrand<E>,
  http: HttpClient,
  league: string,
  budget: ScrapeBudget,
): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }> {
  const { bookmaker, logTag } = brand;
  const categoryId = getBookmakerLeagueId(league, bookmaker);
  if (categoryId === undefined) throw new Error(`Unknown league: ${league}`);

  const getJson = async (url: string, signal: AbortSignal): Promise<unknown> => {
    try {
      return await http.getJson<unknown>(url, { headers: { ...REST_MARKET_HEADERS }, signal });
    } catch (error) {
      throw withChallengeHint(error, bookmaker);
    }
  };

  const url = brand.listingUrl(categoryId as string | number);
  const events = brand.listingEvents(await getJson(url, budget.signal), url);
  if (events.length === 0) {
    // README §3 empty-listing rule: success with no matches (observability: `empty`)
    console.warn(`${logTag} No events found from API ${url}`);
    return { matches: [], skipped: [] };
  }

  const listed = events.filter((e) => brand.isMatch(e));
  console.log(`${logTag} Found ${events.length} events, ${listed.length} matches`);

  // fetched comes back in `listed` order whatever order the details resolved in
  const outcome = await fetchDetailsSkippingFailures(
    listed,
    (e) => brand.eventId(e),
    async (e, signal) => {
      const detailUrl = brand.detailUrl(brand.eventId(e));
      return brand.detailEvent(await getJson(detailUrl, signal), detailUrl);
    },
    { concurrency: REST_MARKET_DETAIL_CONCURRENCY, budget },
  );

  const matches: FullMatchOffer[] = [];
  for (const { event, detail } of outcome.fetched) {
    const offer = brand.toOffer(event, detail, league);
    if (offer === null) continue;
    matches.push(offer);
    console.log(`${logTag} ${offer.homeTeam} vs ${offer.awayTeam}: ${offer.markets.length} markets`);
  }
  for (const s of outcome.skipped) console.warn(`${logTag} Skipping ${s.id}: ${s.error}`);

  const totalMarkets = matches.reduce((n, m) => n + m.markets.length, 0);
  console.log(`${logTag} Completed: ${matches.length} matches, ${totalMarkets} total markets, ${outcome.skipped.length} skipped`);
  return { matches, skipped: outcome.skipped };
}
