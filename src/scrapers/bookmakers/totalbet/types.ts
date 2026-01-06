/**
 * Totalbet Internal Types
 *
 * Type definitions for Totalbet API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual outcome (selection) within a game from Totalbet API
 */
export interface TotalbetOutcome {
  /** Internal outcome ID */
  outcomeId: number;
  /** Display name (e.g., "1", "X", "2", "Tak", "Nie") */
  outcomeName: string;
  /** Position for sorting (1, 2, 3) */
  outcomePosition: number;
  /** Decimal odds value */
  outcomeOdds: number;
  /** Selection status */
  outcomeStatus?: string;
}

/**
 * Single game (market) from Totalbet API
 * Each game represents a betting market like 1X2, BTTS, Over/Under etc.
 */
export interface TotalbetGame {
  /** Internal game ID */
  gameId: number;
  /** Market type identifier */
  gameType: number;
  /** Display name (e.g., "Wynik meczu", "Obie druzyny strzelą") */
  gameName: string;
  /** For line markets (O/U, handicap) - the line value (e.g., 2.5) */
  argument?: number;
  /** All outcomes (selections) for this market */
  outcomes: TotalbetOutcome[];
  /** Game status */
  gameStatus?: string;
}

/**
 * Single event (match) from Totalbet API
 */
export interface TotalbetEvent {
  /** Unique event ID */
  eventId: number;
  /** Match name in format "HomeTeam - AwayTeam" */
  eventName: string;
  /** Category ID (league identifier) */
  categoryId: number;
  /** Event start time (Unix timestamp or ISO string) */
  startTime?: number | string;
  /** All available games (markets) for this event */
  eventGames?: TotalbetGame[];
  /** Event status */
  eventStatus?: string;
}

/**
 * API response for events list
 */
export interface TotalbetEventsResponse {
  /** Array of events */
  data: TotalbetEvent[];
  /** Error message if any */
  error?: string;
}

/**
 * API response for single event details
 * Returns full event data with all available markets
 */
export interface TotalbetEventDetailResponse {
  /** Event data (can be a single object or in data property) */
  data?: TotalbetEvent;
  /** Direct event properties (some endpoints return event directly) */
  eventId?: number;
  eventName?: string;
  eventGames?: TotalbetGame[];
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
 * Intermediate structure for grouped markets during parsing
 * Used before converting to ScrapedMarket
 */
export interface GroupedMarket {
  /** Game type from Totalbet */
  gameType: number;
  /** Display name for the market */
  name: string;
  /** Group name for UI categorization */
  groupName: string;
  /** Normalized market type */
  type: string;
  /** Line value for O/U and handicap markets */
  line?: string;
  /** All selections for this market */
  selections: {
    name: string;
    odds: number;
    position: number;
  }[];
}

/**
 * Event cache entry with timestamp
 */
export interface CachedEvent {
  event: TotalbetEvent;
  timestamp: number;
}
