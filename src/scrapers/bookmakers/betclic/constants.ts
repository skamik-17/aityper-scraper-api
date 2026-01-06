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
