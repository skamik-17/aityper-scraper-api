/**
 * Betters Internal Types
 *
 * Type definitions for Betters API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual stake (betting selection) from Betters API
 */
export interface BettersStake {
  /** Stake code: 1=Home, 2=Draw, 3=Away for 1X2 */
  stakeCode: number;
  /** Display name (e.g., "1X", "X2", "Tak", "Nie", "Powyzej 2.5") */
  stakeName: string;
  /** Decimal odds value */
  betFactor: number;
  /** Line value for O/U and handicap (e.g., 2.5, -1.5) */
  stakeArgument?: number;
  /** Internal stake ID */
  stakeId?: number;
}

/**
 * Stake type (market category) from Betters API
 */
export interface BettersStakeType {
  /** Stake type ID: 1=1X2, 37=DC, 3=O/U, 26=BTTS */
  stakeTypeId: number;
  /** Display name for the stake type */
  stakeTypeName?: string;
  /** All stakes (selections) for this market type */
  stakes: BettersStake[];
}

/**
 * Single event (match) from Betters API
 */
export interface BettersEvent {
  /** Unique event ID */
  eventId: number;
  /** Home team name */
  teamA: string;
  /** Away team name */
  teamB: string;
  /** Event start time as ISO string */
  startDate?: string;
  /** League/competition ID */
  leagueId?: number;
  /** All available stake types (markets) for this event */
  stakeTypes?: BettersStakeType[];
}

/**
 * API response wrapper for league upcoming events
 * Response comes as an array with games nested
 */
export interface BettersLeagueResponse {
  /** Array of games for this league */
  games?: BettersEvent[];
}

/**
 * Parsed 1X2 odds
 */
export interface Parsed1X2Odds {
  home: number;
  draw: number;
  away: number;
}

/**
 * Parsed Double Chance odds
 */
export interface ParsedDoubleChanceOdds {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
}

/**
 * Parsed BTTS odds
 */
export interface ParsedBTTSOdds {
  yes: number;
  no: number;
}

/**
 * Parsed Over/Under odds for a single line
 */
export interface ParsedOverUnderOdds {
  over: number;
  under: number;
}

/**
 * All parsed markets for an event
 */
export interface ParsedEventMarkets {
  m1X2: Parsed1X2Odds;
  mDC: ParsedDoubleChanceOdds;
  mBTTS: ParsedBTTSOdds;
  mOU: Record<string, ParsedOverUnderOdds>;
}

/**
 * Event cache entry
 */
export interface CachedEvent {
  event: BettersEvent;
  timestamp: number;
}

/**
 * Parsed team names
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}
