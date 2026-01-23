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
  BTTS: "BTTS",
  OVER_UNDER: "OVER_UNDER",
  HALF_TIME_1X2: "HALF_TIME_1X2",
  HALF_TIME_OVER_UNDER: "HALF_TIME_OVER_UNDER",
  CORRECT_SCORE: "CORRECT_SCORE",
  HANDICAP: "HANDICAP",
  // Statistics markets (Statystyki tab)
  CORNERS_TOTAL: "CORNERS_TOTAL",
  CARDS_TOTAL: "CARDS_TOTAL",
  MOST_SHOTS_ON_TARGET: "MOST_SHOTS_ON_TARGET",
  FOULS_TOTAL: "FOULS_TOTAL",
  // Goal method markets (Metoda Gola tab)
  PENALTY_AWARDED: "PENALTY_AWARDED",
  // Goal method - no canonical type, use descriptive string
  HEADER_GOAL: "HEADER_GOAL",
  FREE_KICK_GOAL: "FREE_KICK_GOAL",
  // Player markets (Strzelcy tab)
  PLAYER_ASSISTS: "PLAYER_ASSISTS",
} as const;

/**
 * Request timeout in milliseconds (increased for reliability)
 */
export const REQUEST_TIMEOUT = 30000;

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
 * The gRPC API uses a filter field (Field 2) to return markets for specific tabs.
 *
 * These values are used with buildMatchDetailsRequestWithFilter() to fetch
 * markets from each tab separately, then merge the results.
 *
 * Note: Filter values are based on reverse engineering. If the API changes,
 * use betclic-filter-discovery.ts to rediscover the correct values.
 *
 * @see backend/docs/betclic-tab-network-analysis.md
 * @see backend/scripts/betclic-filter-discovery.ts
 */
export const MARKET_GROUP_FILTERS = {
  /**
   * Tab 1: Top (Main/Popular)
   * Markets: 1X2, Double Chance, BTTS, popular O/U, Handicap, Correct Score, Anytime Scorer
   */
  TOP: 0,

  /**
   * Tab 2: Wynik (Result)
   * Markets: 1X2, Draw No Bet, Double Chance, HT/FT, Win to Nil, Result+BTTS combos
   */
  WYNIK: 1,

  /**
   * Tab 3: Strzelcy (Scorers)
   * Markets: Anytime Scorer, First/Last Scorer, 2+ Goals Scorer, Hat-trick, Assists
   */
  STRZELCY: 2,

  /**
   * Tab 4: Gole (Goals)
   * Markets: Total Goals O/U, Team Goals O/U, BTTS, Goal Ranges, Half Goals, Odd/Even
   */
  GOLE: 3,

  /**
   * Tab 5: Metoda Gola (Goal Method)
   * Markets: Penalty Goal, Header Goal, Free Kick Goal
   */
  METODA_GOLA: 4,

  /**
   * Tab 6: Wynik / Handicap (Result / Handicap)
   * Markets: Asian Handicap, European Handicap, Correct Score, Goal Margin
   */
  HANDICAP: 5,

  /**
   * Tab 7: Statystyki (Statistics)
   * Markets: Corners, Cards, Shots, Fouls, Offsides
   */
  STATYSTYKI: 6,
} as const;

/**
 * Type for market group filter values
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
