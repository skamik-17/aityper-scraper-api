/**
 * LVBet Internal Types
 *
 * Type definitions for LVBet API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Rate/odds object from LVBet API
 */
export interface LVBetRate {
  /** Decimal odds value */
  decimal: number;
  /** Fractional odds (optional) */
  fractional?: string;
}

/**
 * Individual selection within a market (client-api/v5 shape)
 */
export interface LVBetSelection {
  /** Selection ID (e.g., "bc:7392415565") */
  selection_id: string;
  /** Display name for the selection */
  name: string;
  /** Position/order within the market (0, 1, 2 for 1X2) */
  order: number;
  /** Odds information */
  rate?: LVBetRate;
  /** Selection status ("open" / "suspended" in v5, never "active") */
  status?: string;
}

/**
 * Market group the market is listed under on the LVBet site
 */
export interface LVBetMarketsGroup {
  /** Group display name (e.g., "Suma", "Zawodnicy - statystyki") */
  name: string;
  /** Group ID */
  markets_group_id: number;
}

/**
 * Single market from LVBet API (from /markets/search endpoint, client-api/v5 shape)
 */
export interface LVBetMarket {
  /** Market instance ID (e.g., "bc:2511211325"), unique per market in a match */
  market_id: string;
  /** Match ID this market belongs to */
  match_id: string;
  /** Market name (e.g., "Zwyciezca meczu", "Liczba goli") */
  name: string;
  /**
   * Line value for O/U markets. The v5 payload sends a number (2.5, 1.75,
   * 0 for line-less markets); string kept for older captures.
   */
  line?: number | string;
  /**
   * Market-type (class) ID. Shared by sibling products (one class can cover
   * several market names), so never treat it as a product key on its own.
   */
  markets_class_id?: number;
  /** Group the market is listed under */
  markets_group?: LVBetMarketsGroup;
  /** Whether this is the primary market for the match */
  is_primary?: boolean;
  /** All selections for this market */
  selections?: LVBetSelection[];
  /** Market state ("open" / "suspended") */
  state?: { status: string };
}

/**
 * Single match from LVBet competition-view endpoint
 */
export interface LVBetMatch {
  /** Unique match ID */
  match_id: string;
  /** Home team name(s) - array for tournament matches */
  home?: string[];
  /** Away team name(s) */
  away?: string[];
  /** Sports group IDs for URL building */
  sports_groups_ids?: number[];
  /** Match kickoff, ISO 8601 with offset */
  date?: string;
  /** Match status */
  status?: string;
}

/**
 * Response from competition-view endpoint
 */
export interface LVBetCompetitionResponse {
  /** Array of matches */
  matches?: LVBetMatch[];
  /** Error message if any */
  error?: string;
}

/**
 * Response from markets/search endpoint
 * Returns array of markets directly
 */
export type LVBetMarketsResponse = LVBetMarket[];

/**
 * Response from single match info endpoint
 */
export interface LVBetMatchInfoResponse {
  /** Match ID */
  match_id: string;
  /** Home team name(s) */
  home?: string[];
  /** Away team name(s) */
  away?: string[];
  /** Sports group IDs */
  sports_groups_ids?: number[];
  /** Match start time */
  start_time?: string;
}

/**
 * Parsed team names from match data
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}

/**
 * Parsed 1X2 odds structure
 */
export interface Parsed1X2Odds {
  home: number;
  draw: number;
  away: number;
}

/**
 * Parsed Double Chance odds structure
 */
export interface ParsedDoubleChanceOdds {
  homeOrDraw: number;
  homeOrAway: number;
  drawOrAway: number;
}

/**
 * Parsed BTTS odds structure
 */
export interface ParsedBTTSOdds {
  yes: number;
  no: number;
}

/**
 * Match with its markets data for full offer scraping
 */
export interface MatchWithMarkets {
  match: LVBetMatch;
  markets: LVBetMarket[];
}
