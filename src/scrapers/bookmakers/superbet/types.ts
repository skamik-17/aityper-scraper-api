/**
 * Superbet Internal Types
 *
 * Type definitions for Superbet API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual betting selection from Superbet API
 */
export interface SuperbetOddsSelection {
  /** Internal selection ID */
  id: number;
  /** Market ID this selection belongs to */
  marketId: number;
  /** Human-readable market label provided by the API (e.g., "Liczba goli") */
  marketName?: string;
  /** Selection code: "1", "0", "2", "O", "U", "GG", "NG", etc. */
  code: string;
  /** Display name (e.g., "Manchester United", "Remis", "Ponad 2.5") */
  name?: string;
  /** Decimal odds value */
  price: number;
  /** For handicap/totals - the line value (e.g., "2.5", "-1.5") */
  specialBetValue?: string;
  /** Selection status */
  status?: string;
}

/**
 * Live/result metadata attached to an event by the by-date API.
 * Present (non-null) for matches that have started or finished.
 */
export interface SuperbetEventMetadata {
  /** High-level status, e.g. "FINISHED" */
  status?: string;
  /** Short label, e.g. "END" for ended matches */
  matchStatusLabel?: string;
}

/**
 * Single event (match) from Superbet API
 */
export interface SuperbetEvent {
  /** Unique event ID */
  eventId: number;
  /** Match name in format "HomeTeam · AwayTeam" */
  matchName: string;
  /** Competition/tournament ID */
  tournamentId: number;
  /** Sport ID (5 = football) */
  sportId: number;
  /** Event start time ISO string */
  startTime?: string;
  /** All available odds for this event */
  odds?: SuperbetOddsSelection[];
  /** Event status */
  status?: string;
  /** Number of markets offered for this event (0 for settled/closed matches) */
  marketCount?: number;
  /** Kickoff time as unix epoch milliseconds (from the by-date listing) */
  unixDateMillis?: number;
  /** Kickoff time as ISO string */
  utcDate?: string;
  /** Live/result metadata; non-null once a match has started or finished */
  metadata?: SuperbetEventMetadata | null;
}

/**
 * API response for events list
 */
export interface SuperbetEventsResponse {
  /** Whether request was successful */
  success?: boolean;
  /** Array of events */
  data: SuperbetEvent[];
  /** Error message if any */
  error?: string;
}

/**
 * API response for single event details
 */
export interface SuperbetEventDetailResponse {
  /** Whether request was successful */
  success?: boolean;
  /** Array containing single event with all markets */
  data: SuperbetEvent[];
  /** Error message if any */
  error?: string;
}

/**
 * Parsed team names from matchName
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}

/**
 * Intermediate structure for grouped markets
 * Used during parsing before converting to ScrapedMarket
 */
export interface GroupedMarket {
  /** Market ID from Superbet */
  marketId: number;
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
    code: string;
  }[];
}
