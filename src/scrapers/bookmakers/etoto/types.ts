/**
 * eToto Internal Types
 *
 * Type definitions for eToto API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual outcome (selection) from eToto API
 */
export interface EtotoOutcome {
  /** Internal outcome ID */
  outcomeId: number;
  /** Display name (e.g., "1", "X", "2", "Tak", "Nie", "Powyżej 2.5") */
  outcomeName: string;
  /** Decimal odds value */
  outcomeOdds: number;
  /** Position for sorting outcomes */
  outcomePosition: number;
  /** Outcome status */
  status?: string;
}

/**
 * Single game (market) from eToto API
 */
export interface EtotoGame {
  /** Internal game ID */
  gameId: number;
  /** Game type identifier (1 = 1X2, 4 = DC, 8 = O/U, 98 = BTTS, etc.) */
  gameType: number;
  /** Display name (e.g., "1x2", "Podwójna szansa", "Suma goli") */
  gameName: string;
  /** Line value for handicap/totals markets */
  argument?: number;
  /** All available outcomes for this game */
  outcomes: EtotoOutcome[];
  /** Game status */
  status?: string;
}

/**
 * Single event (match) from eToto API
 */
export interface EtotoEvent {
  /** Unique event ID */
  eventId: number;
  /** Match name in format "HomeTeam - AwayTeam" */
  eventName: string;
  /** Category ID */
  categoryId: number;
  /** Event start time (timestamp) */
  startTime?: number;
  /** All available games (markets) for this event */
  eventGames?: EtotoGame[];
  /** Event status */
  status?: string;
}

/**
 * API response for events list
 */
export interface EtotoEventsResponse {
  /** Whether request was successful */
  success?: boolean;
  /** Array of events */
  data: EtotoEvent[];
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
export interface ParsedDoubleChance {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
}

/**
 * Parsed BTTS odds structure
 */
export interface ParsedBTTS {
  yes: number;
  no: number;
}

/**
 * Parsed Over/Under odds structure (keyed by line)
 */
export interface ParsedOverUnder {
  over: number;
  under: number;
}

/**
 * Event data cache entry
 */
export interface CachedEventData {
  event: EtotoEvent;
  timestamp: number;
}
