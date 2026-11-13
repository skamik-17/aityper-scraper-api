/**
 * Totalbet Constants
 *
 * URLs, transport limits and the phase-1 market keys of the UUID "dealer" API.
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
 * Per-attempt request timeout in milliseconds, body read included
 */
export const TOTALBET_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Event-detail requests in flight at once (also the client's per-host limit)
 */
export const TOTALBET_DETAIL_CONCURRENCY = 4;

/**
 * Default time budget of one league scrape, in milliseconds
 */
export const TOTALBET_BUDGET_MS = 90_000;

/**
 * Slug prefix of the 1st-half "Suma goli" components since 2026-11-13. Totalbet
 * builds it from a mis-decoded "1. połowa": "ł" (UTF-8 C5 82) comes out as
 * "a" + U+030A + U+0082, so the slug is "1.poa\u030a\u0082owa_…" byte for byte.
 */
const HALF_SUMA_GOLI = "1.poa\u030a\u0082owa";

/**
 * The 38 raw keys that carry the phase-1 codes on the current (2026-11-13)
 * layout, in the order of the normalizer's key table (TOTALBET_MARKET_KEY_TO_CODE):
 * `mid:<UOF market_id>` of a column header, `slug:<component slug>`, and
 * `col:<component slug>#<header text>` for a column whose header has no
 * market_id. Duplicated here because the scraper layer does not import the
 * services layer at runtime; a test keeps the two lists identical.
 * Used for the per-scrape slug-drift check.
 */
export const PHASE1_MARKET_KEYS: readonly string[] = Object.freeze([
  "mid:10", "mid:63", "mid:85",
  "mid:29", "mid:75", "mid:95",
  "mid:11", "mid:64", "mid:86",
  "mid:60", "mid:83",
  "col:sumagoli_parzyste/nieparzyste#Cały mecz", "col:sumagoli_parzyste/nieparzyste#1 połowa", "mid:94",
  "mid:32", "mid:31",
  "mid:77", "mid:76",
  "mid:97", "mid:96",
  "slug:sumagoli", `slug:${HALF_SUMA_GOLI}_sumagoli`, "slug:2_poaowa_suma",
  "slug:{competitor1}_sumagoli", "slug:{competitor2}_sumagoli",
  `slug:${HALF_SUMA_GOLI}_{competitor1}_sumagoli`, `slug:${HALF_SUMA_GOLI}_{competitor2}_sumagoli`,
  "slug:2_poaowa_competitor1_suma_goli_", "slug:2_poaowa_competitor2_suma_goli_",
  "slug:handicap", "slug:1_poaowa_handicap", "slug:2_poaowa_handicap",
  "slug:handicap_hcp", "slug:1_poaowa_handicap_3way", "slug:2_poaowa_handicap_3",
  "slug:dokaadny_wynik", "slug:1_poaowa_dokaadny_wynik", "slug:2_poaowa_dokaadny_wynik",
]);

/**
 * Current key -> the key the same market had before the 2026-11-13 layout
 * ("Total (suma)" components, odd/even columns 26/74). A large event that still
 * serves the old key is not drift. Mirrors TOTALBET_LEGACY_MARKET_KEY_TO_CODE;
 * a test keeps the two in sync.
 */
export const PHASE1_LEGACY_KEYS: Readonly<Record<string, string>> = Object.freeze({
  "col:sumagoli_parzyste/nieparzyste#Cały mecz": "mid:26",
  "col:sumagoli_parzyste/nieparzyste#1 połowa": "mid:74",
  "slug:sumagoli": "slug:suma",
  [`slug:${HALF_SUMA_GOLI}_sumagoli`]: "slug:1_poaowa_suma",
  "slug:{competitor1}_sumagoli": "slug:competitor1_total_suma",
  "slug:{competitor2}_sumagoli": "slug:competitor2_total_suma",
  [`slug:${HALF_SUMA_GOLI}_{competitor1}_sumagoli`]: "slug:1_poaowa_competitor_1_suma_goli",
  [`slug:${HALF_SUMA_GOLI}_{competitor2}_sumagoli`]: "slug:1_poaowa_competitor_2_suma_goli",
});

/**
 * The slug-drift check runs only on events offering at least this many markets.
 * Every capture with 160+ markets carries all 38 keys; a thinner offer may lack
 * some phase-1 components without any rename.
 */
export const PHASE1_CHECK_MIN_MARKETS = 150;
