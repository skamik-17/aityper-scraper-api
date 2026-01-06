/**
 * LeBull Internal Types
 *
 * Type definitions for LeBull/sbteam.xyz API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual stake (selection) from the API
 */
export interface LebullStake {
  /** Stake identifier */
  stakeId?: number;
  /** Stake code: 1=home, 2=draw, 3=away for 1X2 */
  stakeCode: number;
  /** Display name: "1", "X", "2", "1X", "X2", "12", "Tak", "Nie", etc. */
  stakeName?: string;
  /** Decimal odds value */
  betFactor: number;
  /** For O/U and handicap - the line value (e.g., 2.5, -1.5) */
  stakeArgument?: number;
  /** Stake status */
  status?: string;
}

/**
 * Stake type (market) from the API
 */
export interface LebullStakeType {
  /** Market identifier (1=1X2, 3=O/U, 26=BTTS, 37=DC) */
  stakeTypeId: number;
  /** Display name for the market type */
  stakeTypeName?: string;
  /** All available stakes for this market */
  stakes: LebullStake[];
}

/**
 * Single event (match) from LeBull API
 */
export interface LebullEvent {
  /** Unique event ID */
  eventId: number;
  /** Home team name */
  teamA: string;
  /** Away team name */
  teamB: string;
  /** League/tournament ID */
  leagueId?: number;
  /** Event start time ISO string */
  startDate?: string;
  /** All available markets for this event */
  stakeTypes?: LebullStakeType[];
  /** Event status */
  status?: string;
}

/**
 * API response wrapper for league events
 * The actual API returns an array with a single object containing games
 */
export interface LebullApiResponse {
  /** Array of events/games */
  games?: LebullEvent[];
}

/**
 * Event detail API response wrapper
 * When navigating to an event page, the API returns full event data
 */
export interface LebullEventDetailResponse {
  /** Full event data with all markets */
  event?: LebullEvent;
  /** Alternative field - some responses use this */
  data?: LebullEvent;
}

/**
 * Parsed team names
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
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
 * Parsed Over/Under odds (single line)
 */
export interface ParsedOverUnderLine {
  over: number;
  under: number;
}

/**
 * All parsed markets from an event
 */
export interface ParsedEventMarkets {
  m1X2: Parsed1X2Odds;
  mDC: ParsedDoubleChanceOdds;
  mBTTS: ParsedBTTSOdds;
  mOU: Record<string, ParsedOverUnderLine>;
}

/**
 * Cache entry structure
 */
export interface EventCacheEntry {
  event: LebullEvent;
  timestamp: number;
}
