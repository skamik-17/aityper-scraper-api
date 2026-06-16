/**
 * Betclic Constants
 *
 * URLs, gRPC endpoints, competition IDs, and protobuf field numbers.
 * Betclic uses gRPC-web API with protobuf encoding for data fetching.
 */

/**
 * Base URL for the Betclic website
 */
export const BASE_URL = "https://www.betclic.pl";

/**
 * gRPC service base URL
 */
export const GRPC_BASE = "https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService";

/**
 * gRPC endpoints for different API calls
 */
export const ENDPOINTS = {
  /** Fetch matches listing by competition */
  listing: `${GRPC_BASE}/GetMatchesByCompetitionWithNotifications`,
  /** Fetch single match details */
  match: `${GRPC_BASE}/GetMatchWithNotification`,
};

/**
 * Required headers for gRPC-web requests
 * Note: User-Agent, Origin, and Referer are required to bypass CloudFront protection
 */
export const GRPC_HEADERS: Record<string, string> = {
  "Content-Type": "application/grpc-web-text",
  Accept: "application/grpc-web-text",
  "X-Grpc-Web": "1",
  "X-Bg-Ref-Brand": "BETCLIC",
  "X-Bg-Ref-Platform": "DESKTOP",
  "X-Bg-Ref-Regulator-Zone": "PL",
  "X-Bg-Regulation": "PL",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: "https://www.betclic.pl",
  Referer: "https://www.betclic.pl/",
};

/**
 * Competition IDs for gRPC API
 * These are Betclic's internal IDs for each league
 */
export const COMPETITION_IDS: Record<string, number> = {
  "premier-league": 3,
  ekstraklasa: 221,
  laliga: 7,
  "serie-a": 6,
  "ligue-1": 4,
  "world-cup-2026": 1,
};

/**
 * URL slugs for leagues (used in event URLs)
 */
export const LEAGUE_SLUGS: Record<string, string> = {
  "premier-league": "premier-league-c3",
  ekstraklasa: "ekstraklasa-c221",
  laliga: "la-liga-c7",
  "serie-a": "serie-a-c6",
  "ligue-1": "ligue-1-c4",
  "world-cup-2026": "ms-c1",
};

/**
 * Protobuf field numbers for parsing responses
 * Based on reverse-engineering the Betclic gRPC API
 */
export const PROTO_FIELDS = {
  // Root message wrapper
  ROOT_WRAPPER: 1,

  // Match fields
  MATCH_ENTRIES: 3,
  MATCH_ID: 1,
  MATCH_NAME: 2,
  MATCH_MARKETS: 9,

  // Market fields
  MARKET_OUTCOMES: 16,

  // Outcome fields
  OUTCOME_NAME_SHORT: 10,
  OUTCOME_NAME_LONG: 11,
  OUTCOME_ODDS: 12,
} as const;

/**
 * Common Polish outcome names used in Betclic responses
 */
export const OUTCOME_NAMES = {
  // 1X2
  DRAW: "Remis",
  DRAW_ALT: "Remis ",

  // BTTS
  YES: "Tak",
  NO: "Nie",

  // Double Chance patterns
  OR_DRAW_PATTERN: "lub remis",
  DRAW_OR_PATTERN: "Remis lub",
  OR_PATTERN: "lub",

  // Over/Under
  OVER_PREFIX: "Powyżej",
  UNDER_PREFIX: "Poniżej",
} as const;

/**
 * Market group names for UI organization
 */
export const MARKET_GROUPS = {
  MATCH_RESULT: "Wynik meczu",
  GOALS: "Gole",
  FIRST_HALF: "Pierwsza polowa",
  SECOND_HALF: "Druga polowa",
  HANDICAP: "Handicap",
  CORRECT_SCORE: "Dokladny wynik",
  OTHER: "Inne",
} as const;

/**
 * Normalized market type identifiers
 */
export const MARKET_TYPES = {
  MATCH_1X2: "1X2",
  DOUBLE_CHANCE: "DOUBLE_CHANCE",
  DRAW_NO_BET: "DRAW_NO_BET",
  BTTS: "BTTS",
  TOTAL_GOALS: "TOTAL_GOALS",
  OVER_UNDER: "OVER_UNDER",
  HALF_TIME_1X2: "HALF_TIME_1X2",
  HALF_TIME_OVER_UNDER: "HALF_TIME_OVER_UNDER",
  CORRECT_SCORE: "CORRECT_SCORE",
  HANDICAP: "HANDICAP",
  CORNERS_TOTAL: "CORNERS_TOTAL",
  CARDS_TOTAL: "CARDS_TOTAL",
  MOST_SHOTS_ON_TARGET: "MOST_SHOTS_ON_TARGET",
  FOULS_TOTAL: "FOULS_TOTAL",
  OFFSIDES_TOTAL: "OFFSIDES_TOTAL",
  PENALTY_AWARDED: "PENALTY_AWARDED",
  HEADER_GOAL: "HEADER_GOAL",
  FREE_KICK_GOAL: "FREE_KICK_GOAL",
  PLAYER_ASSISTS: "PLAYER_ASSISTS",
  ANYTIME_GOALSCORER: "ANYTIME_GOALSCORER",
} as const;

/**
 * Request timeout in milliseconds (increased for reliability)
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Read timeout for gRPC-web streams in milliseconds.
 * 
 * IMPORTANT: Betclic's gRPC-web streams don't close naturally - the server
 * keeps the connection open indefinitely. We must use a timeout to complete
 * the request. Data typically arrives within 200-500ms, so 1000ms provides
 * a safe margin while being much faster than the previous 5000ms timeout.
 * 
 * Performance impact:
 * - Old value (5000ms): ~37s for 7 tabs sequential
 * - New value (1000ms): ~1s for 7 tabs parallel (47x faster)
 */
export const GRPC_READ_TIMEOUT = 1000;

/**
 * Maximum retry attempts for failed requests
 */
export const MAX_RETRIES = 3;

/**
 * Base delay between retries in milliseconds (multiplied by attempt number)
 */
export const RETRY_DELAY = 1000;

/**
 * Over/Under lines commonly offered
 */
export const OVER_UNDER_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];

/**
 * Character used to separate team names in matchName
 */
export const TEAM_SEPARATOR = " - ";

/**
 * Market group filter values for multi-tab fetching.
 *
 * Betclic's match page has 7 tabs, each showing different market categories.
 * The gRPC API uses category ID strings in Field 3 to filter markets by tab.
 *
 * IMPORTANT: Based on HAR analysis (2026-01-24), the correct request structure is:
 * - Field 1 (tag 0x08): match_id as BigInt varint
 * - Field 2 (tag 0x12): language "pl" as length-delimited string
 * - Field 3 (tag 0x1a): category_id as length-delimited string (e.g., "ca_ftb_rslt")
 *
 * The initial "Top" tab request has NO category filter - it returns all popular markets.
 * Subsequent tab clicks send requests with specific category IDs.
 *
 * Category IDs discovered from HAR file analysis:
 * - Wynik (Result): "ca_ftb_rslt" (50KB response)
 * - Strzelcy (Scorers): "ca_ftb_gsc" (544KB response - largest!)
 * - Gole (Goals): "ca_ftb_goa" (106KB response)
 * - Metoda Gola (Goal Method): "ca_ftb_goalm" (23KB response)
 * - Statystyki (Statistics): "ca_ftb_prp" (218KB response)
 *
 * @see backend/docs/betclic-tab-network-analysis.md
 * @see backend/scripts/betclic-filter-discovery.ts
 */
export const MARKET_GROUP_FILTERS = {
  /**
   * Tab 1: Top (Main/Popular)
   * Markets: 1X2, Double Chance, BTTS, popular O/U, Handicap, Correct Score, Anytime Scorer
   * Note: Initial load has NO category filter - returns popular markets
   */
  TOP: null,

  /**
   * Tab 2: Wynik (Result)
   * Markets: 1X2, Draw No Bet, Double Chance, HT/FT, Win to Nil, Result+BTTS combos
   * Category ID from HAR: "ca_ftb_rslt"
   */
  WYNIK: "ca_ftb_rslt",

  /**
   * Tab 3: Strzelcy (Scorers)
   * Markets: Anytime Scorer, First/Last Scorer, 2+ Goals Scorer, Hat-trick, Assists
   * Category ID from HAR: "ca_ftb_gsc"
   */
  STRZELCY: "ca_ftb_gsc",

  /**
   * Tab 4: Gole (Goals)
   * Markets: Total Goals O/U, Team Goals O/U, BTTS, Goal Ranges, Half Goals, Odd/Even
   * Category ID from HAR: "ca_ftb_goa"
   */
  GOLE: "ca_ftb_goa",

  /**
   * Tab 5: Metoda Gola (Goal Method)
   * Markets: Penalty Goal, Header Goal, Free Kick Goal
   * Category ID from HAR: "ca_ftb_goalm"
   */
  METODA_GOLA: "ca_ftb_goalm",

  /**
   * Tab 6: Wynik / Handicap (Result / Handicap)
   * Markets: Asian Handicap, European Handicap, Correct Score, Goal Margin
   * Category ID from HAR: "ca_ftb_cshcp" (Correct Score + Handicap)
   */
  HANDICAP: "ca_ftb_cshcp",

  /**
   * Tab 7: Statystyki (Statistics)
   * Markets: Corners, Cards, Shots, Fouls, Offsides
   * Category ID from HAR: "ca_ftb_prp"
   */
  STATYSTYKI: "ca_ftb_prp",
} as const;

/**
 * Type for market group filter values (string category IDs or null for no filter)
 */
export type MarketGroupFilter = (typeof MARKET_GROUP_FILTERS)[keyof typeof MARKET_GROUP_FILTERS];

/**
 * CSS selectors for Betclic tab navigation.
 * Source: Screenshot analysis of docs/betclic-screenshots/Top.png
 */
export const TAB_SELECTORS = {
  container: {
    primary: '[role="tablist"]',
    fallback: '.market-tabs-container, div:has(> [role="tab"])',
  } as const,

  button: {
    primary: 'button[role="tab"]',
    fallback: 'div[role="tab"], [role="tab"]',
  } as const,

  buttonPattern: {
    primary: 'button[role="tab"]:has-text("{{TabName}}")',
    fallback: 'div[role="tab"]:has-text("{{TabName}}"), [role="tab"]:has-text("{{TabName}}")',
  } as const,

  tabs: {
    TOP: 'Top',
    WYNIK: 'Wynik',
    STRZELCY: 'Strzelcy',
    GOLE: 'Gole',
    METODA_GOLA: 'Metoda gola',
    HANDICAP: 'Wynik / Handicap',
    STATYSTYKI: 'Statystyki',
  } as const,

  excludeTab: 'MyCombi',
  activeIndicator: {
    primary: 'aria-selected="true"',
    fallback: '.is-active, .selected',
  } as const,
  allTabs: '[role="tab"]',
} as const;

export type TabSelectorEntry = {
  primary: string;
  fallback: string;
};

export type TabName = (typeof TAB_SELECTORS.tabs)[keyof typeof TAB_SELECTORS.tabs];

export function getTabSelector(
  tabName: string,
  options: { useFallback?: boolean } = {},
): string {
  const pattern = options.useFallback
    ? TAB_SELECTORS.buttonPattern.fallback
    : TAB_SELECTORS.buttonPattern.primary;
  return pattern.replace('{{TabName}}', tabName);
}
