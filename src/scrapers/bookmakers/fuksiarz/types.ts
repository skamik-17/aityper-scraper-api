/**
 * Fuksiarz Internal Types
 *
 * Type definitions for Fuksiarz API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual outcome (selection) within a game/market
 */
export interface FuksiarzOutcome {
  /** Internal outcome ID */
  outcomeId: number;
  /** Display name (e.g., "1", "X", "2", "Tak", "Nie", "Powyżej 2.5") */
  outcomeName: string;
  /** Decimal odds value */
  outcomeOdds: number;
  /** Position for ordering selections */
  outcomePosition: number;
  /** Outcome status */
  outcomeStatus?: string;
}

/**
 * Single game/market within an event
 */
export interface FuksiarzGame {
  /** Internal game ID */
  gameId: number;
  /** Game type identifier (e.g., 1 for 1X2, 4 for DC, 8 for O/U, 98 for BTTS) */
  gameType: number;
  /** Display name (e.g., "1X2", "Podwójna szansa", "Liczba goli", "Obie drużyny strzelą") */
  gameName: string;
  /** All available outcomes for this game */
  outcomes: FuksiarzOutcome[];
  /** Game status */
  gameStatus?: string;
  /** Whether this game is a main market */
  isMainGame?: boolean;
}

/**
 * Single event (match) from Fuksiarz API
 */
export interface FuksiarzEvent {
  /** Unique event ID */
  eventId: number;
  /** Match name in format "HomeTeam - AwayTeam" */
  eventName: string;
  /** Category ID for the league */
  categoryId: number;
  /** Event start time as Unix timestamp */
  eventStart?: number;
  /** Event status */
  eventStatus?: string;
  /** All available games/markets for this event */
  eventGames: FuksiarzGame[];
}

/**
 * API response for events list
 */
export interface FuksiarzEventsResponse {
  /** Array of events */
  data: FuksiarzEvent[];
  /** Error message if any */
  error?: string;
}

/**
 * API response for single event details
 * Returns full event data with ALL available markets
 */
export interface FuksiarzEventDetailResponse {
  /** Single event with all markets */
  data: FuksiarzEvent;
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
 * Intermediate parsed 1X2 odds structure
 */
export interface Parsed1X2Odds {
  home: number;
  draw: number;
  away: number;
}

/**
 * Intermediate parsed Double Chance odds structure
 */
export interface ParsedDoubleChanceOdds {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
}

/**
 * Intermediate parsed BTTS odds structure
 */
export interface ParsedBTTSOdds {
  yes: number;
  no: number;
}

/**
 * All parsed markets from a single event
 */
export interface ParsedEventMarkets {
  m1X2: Parsed1X2Odds;
  mDC: ParsedDoubleChanceOdds;
  mBTTS: ParsedBTTSOdds;
  mOU: Record<string, { over: number; under: number }>;
}
