/**
 * Totalbet Constants
 *
 * URLs, request pacing and the phase-1 market keys of the UUID "dealer" API.
 * League category UUIDs live in src/config/leagues.ts (the single source).
 */

/**
 * Base URL for the Totalbet website
 */
export const BASE_URL = "https://totalbet.pl";

/**
 * Base URL of the UUID platform's "dealer" API (league list and event detail)
 */
export const DEALER_API_BASE_URL = "https://totalbet.pl/dealer/bdata/v1/bet";

/**
 * Events requested per league list page (the API accepts per_page=100)
 */
export const LIST_PAGE_SIZE = 100;

/**
 * Upper bound on list pages fetched per league, whatever total_pages says
 */
export const MAX_LIST_PAGES = 10;

/**
 * Pause between two event-detail requests, in milliseconds
 */
export const DETAIL_DELAY_MS = 250;

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * The 38 raw keys (`mid:<UOF market_id>` of column headers, `slug:<component slug>`)
 * that carry the phase-1 codes, in the order of the normalizer's key table
 * (TOTALBET_MARKET_KEY_TO_CODE). Duplicated here because the scraper layer does not
 * import the services layer at runtime; a test keeps the two lists identical.
 * Used for the per-scrape slug-drift check.
 */
export const PHASE1_MARKET_KEYS: readonly string[] = Object.freeze([
  "mid:10", "mid:63", "mid:85",
  "mid:29", "mid:75", "mid:95",
  "mid:11", "mid:64", "mid:86",
  "mid:60", "mid:83",
  "mid:26", "mid:74", "mid:94",
  "mid:32", "mid:31",
  "mid:77", "mid:76",
  "mid:97", "mid:96",
  "slug:suma", "slug:1_poaowa_suma", "slug:2_poaowa_suma",
  "slug:competitor1_total_suma", "slug:competitor2_total_suma",
  "slug:1_poaowa_competitor_1_suma_goli", "slug:1_poaowa_competitor_2_suma_goli",
  "slug:2_poaowa_competitor1_suma_goli_", "slug:2_poaowa_competitor2_suma_goli_",
  "slug:handicap", "slug:1_poaowa_handicap", "slug:2_poaowa_handicap",
  "slug:handicap_hcp", "slug:1_poaowa_handicap_3way", "slug:2_poaowa_handicap_3",
  "slug:dokaadny_wynik", "slug:1_poaowa_dokaadny_wynik", "slug:2_poaowa_dokaadny_wynik",
]);

/**
 * The slug-drift check runs only on events offering at least this many markets.
 * Every capture with 160+ markets carries all 38 keys; a thinner offer may lack
 * some phase-1 components without any rename.
 */
export const PHASE1_CHECK_MIN_MARKETS = 150;
