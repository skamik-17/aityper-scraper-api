/**
 * forBET Internal Types
 *
 * Type definitions for forBET API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual outcome within a game (market)
 */
export interface ForbetOutcome {
  /** Outcome position for ordering (1, 2, 3, etc.) */
  outcomePosition: number;
  /** Outcome display name: "1", "X", "2", "Tak", "Nie", etc. */
  outcomeName: string;
  /** Decimal odds value */
  outcomeOdds: number;
  /** Internal outcome ID */
  outcomeId?: number;
  /** Outcome status */
  outcomeStatus?: string;
}

/**
 * Single game (market) within an event
 */
export interface ForbetGame {
  /** Game type ID: 1=1X2, 4=DC, 8=O/U, 98=BTTS, etc. */
  gameType: number;
  /** Game display name: "1x2", "Podwojna szansa", "Poniżej/powyżej 2.5 goli" */
  gameName: string;
  /** Internal game ID */
  gameId?: number;
  /** All outcomes (selections) for this game */
  outcomes: ForbetOutcome[];
  /** Game status */
  gameStatus?: string;
}

/**
 * Single event (match) from forBET API
 */
export interface ForbetEvent {
  /** Unique event ID */
  eventId: number;
  /** Match name in format "HomeTeam - AwayTeam" */
  eventName: string;
  /** Category ID the event belongs to */
  categoryId?: number;
  /** Event start time as ISO string */
  eventStartTime?: string;
  /** All available games (markets) for this event */
  eventGames?: ForbetGame[];
  /** Event status */
  eventStatus?: string;
}

/**
 * API response structure from forBET events endpoint
 */
export interface ForbetEventsResponse {
  /** Status of the request */
  status?: string;
  /** Array of events */
  data: ForbetEvent[];
  /** Error message if any */
  error?: string;
}

/**
 * API response structure from forBET single event endpoint
 * Returns full event data with ALL available markets
 */
export interface ForbetEventDetailResponse {
  /** Status of the request */
  status?: string;
  /** Single event object with complete market data */
  data?: ForbetEvent;
  /** Error message if any */
  error?: string;
}

/**
 * Parsed team names from eventName
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}

/**
 * Parsed 1X2 market structure
 */
export interface Parsed1X2 {
  home: number;
  draw: number;
  away: number;
}

/**
 * Parsed Double Chance market structure
 */
export interface ParsedDoubleChance {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
}

/**
 * Parsed BTTS market structure
 */
export interface ParsedBTTS {
  yes: number;
  no: number;
}

/**
 * Parsed Over/Under market structure
 */
export interface ParsedOverUnder {
  over: number;
  under: number;
}

/**
 * Complete parsed markets from a forBET event
 */
export interface ParsedMarkets {
  m1X2: Parsed1X2;
  mDC: ParsedDoubleChance;
  mBTTS: ParsedBTTS;
  mOU: Record<string, ParsedOverUnder>;
}

/**
 * Cache entry for events data
 */
export interface EventCacheEntry {
  events: Map<string, ForbetEvent>;
  timestamp: number;
}
