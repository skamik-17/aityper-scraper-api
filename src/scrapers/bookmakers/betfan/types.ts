/**
 * Betfan Internal Types
 *
 * Type definitions for Betfan API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual betting outcome from Betfan API
 */
export interface BetfanOutcome {
  /** Outcome ID */
  outcomeId: number;
  /** Display name (e.g., "1", "X", "2", "Tak", "Nie", "Powyzej 2.5") */
  outcomeName: string;
  /** Decimal odds value */
  outcomeOdds: number;
  /** Position for sorting within the market */
  outcomePosition: number;
  /** Outcome status */
  outcomeStatus?: string;
}

/**
 * Single game (market) within an event from Betfan API
 */
export interface BetfanGame {
  /** Game/Market ID */
  gameId: number;
  /** Game type identifier (1 = 1X2, 4 = DC, 8 = O/U, 98 = BTTS, etc.) */
  gameType: number;
  /** Display name (e.g., "Mecz", "Podwojna szansa", "Liczba goli") */
  gameName: string;
  /** All outcomes (selections) for this market */
  outcomes: BetfanOutcome[];
  /** Game status */
  gameStatus?: string;
}

/**
 * Participant (team) in an event
 */
export interface BetfanParticipant {
  /** Participant ID */
  participantId: number;
  /** Team position: 1 = home, 2 = away */
  number: number;
  /** Team name */
  participantName: string;
}

/**
 * Single event (match) from Betfan API
 */
export interface BetfanEvent {
  /** Unique event ID */
  eventId: number;
  /** Event name (usually "HomeTeam - AwayTeam") */
  eventName?: string;
  /** Category ID (league) */
  categoryId: number;
  /** Event start time (ISO string or timestamp) */
  eventStartTime?: string;
  /** Participants (teams) */
  participants?: BetfanParticipant[];
  /** All available games (markets) for this event */
  games?: BetfanGame[];
  /** Event status */
  eventStatus?: string;
}

/**
 * Category data from Betfan API
 */
export interface BetfanCategory {
  /** Category ID */
  categoryId: number;
  /** Category name (e.g., "Ekstraklasa") */
  categoryName?: string;
  /** Events in this category */
  events?: BetfanEvent[];
}

/**
 * API response for events endpoint
 */
export interface BetfanEventsResponse {
  /** Response data wrapper */
  data?: {
    /** Categories containing events */
    categories?: BetfanCategory[];
  };
  /** Error message if any */
  error?: string;
}

/**
 * API response for event detail endpoint
 * /api/v1/market/events/{eventId}
 */
export interface BetfanEventDetailResponse {
  /** Whether request errored */
  isError?: boolean;
  /** HTTP status code */
  code?: number;
  /** Response data wrapper */
  data?: {
    /** Full event data with all markets */
    event?: BetfanEvent;
  };
  /** Error message if any */
  error?: string;
}

/**
 * Parsed team names from event data
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}

/**
 * Intermediate structure for parsed 1X2 odds
 */
export interface Parsed1X2Odds {
  home: number;
  draw: number;
  away: number;
}

/**
 * Intermediate structure for parsed Double Chance odds
 */
export interface ParsedDoubleChanceOdds {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
}

/**
 * Intermediate structure for parsed BTTS odds
 */
export interface ParsedBTTSOdds {
  yes: number;
  no: number;
}

/**
 * Over/Under line odds
 */
export interface OverUnderLineOdds {
  over: number;
  under: number;
}

/**
 * Cache entry for events data
 */
export interface EventsCacheEntry {
  events: Map<string, BetfanEvent>;
  timestamp: number;
}
