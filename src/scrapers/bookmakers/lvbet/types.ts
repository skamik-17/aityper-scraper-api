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
 * Individual selection within a market
 */
export interface LVBetSelection {
  /** Selection ID */
  id: number;
  /** Display name for the selection */
  name: string;
  /** Position/order within the market (0, 1, 2 for 1X2) */
  order: number;
  /** Odds information */
  rate?: LVBetRate;
  /** Selection status */
  status?: string;
}

/**
 * Single market from LVBet API (from /markets/search endpoint)
 */
export interface LVBetMarket {
  /** Market ID */
  id: number;
  /** Match ID this market belongs to */
  match_id: string;
  /** Market name (e.g., "Zwyciezca meczu", "Suma goli") */
  name: string;
  /** Whether this is the primary market for the match */
  is_primary?: boolean;
  /** Line value for O/U markets (e.g., "2.5") */
  line?: string;
  /** All selections for this market */
  selections?: LVBetSelection[];
  /** Market status */
  status?: string;
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
  /** Match start time */
  start_time?: string;
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
