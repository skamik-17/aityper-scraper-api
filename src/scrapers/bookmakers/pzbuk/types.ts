/**
 * PZBuk Internal Types
 *
 * Type definitions for PZBuk WebSocket/RSocket data structures.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Participant in a PZBuk event (team or player)
 */
export interface PZBukParticipant {
  /** Internal participant ID */
  id: string;
  /** Team/player name */
  name: string;
  /** Role: "Home" or "Away" */
  venueRole: "Home" | "Away";
}

/**
 * Single event (match) from PZBuk WebSocket data
 */
export interface PZBukEvent {
  /** Unique event ID */
  id: string;
  /** External reference ID */
  externalId: string;
  /** Event type (e.g., "Fixture") */
  type: string;
  /** Full event name (usually "HomeTeam - AwayTeam") */
  eventName: string;
  /** Sport ID */
  sportId: string;
  /** League/competition ID */
  leagueId: string;
  /** League name for URL generation */
  leagueName: string;
  /** Event start time ISO string */
  startingOn: string;
  /** Event status */
  status: string;
  /** Whether event is currently live */
  isLive: boolean;
  /** Whether betting is suspended */
  isSuspended: boolean;
  /** Participants keyed by some ID */
  primaryParticipants: Record<string, PZBukParticipant>;
  /** Market groups (event page tabs such as "Popularne", "Gole"), keyed by group id */
  marketGroups?: Record<string, PZBukMarketGroup>;
}

/**
 * Market type definition from PZBuk
 */
export interface PZBukMarketType {
  /** Market type ID */
  id: string;
  /** Market type name */
  name: string;
  /** English name template (e.g. "1st half - total corners") */
  originalName?: string;
  /** Ids of the market groups this market type is listed under */
  marketGroupIds?: number[];
}

/**
 * Market container from PZBuk WebSocket data
 */
export interface PZBukMarket {
  /** Unique market ID */
  id: string;
  /** Market display name */
  name: string;
  /** Associated event ID */
  eventId: string;
  /** Whether market is suspended */
  isSuspended: boolean;
  /** Market type information */
  marketType: PZBukMarketType;
  /** Line value for O/U and handicap markets */
  points?: number | string;
}

/**
 * Individual selection (betting outcome) from PZBuk
 */
export interface PZBukSelection {
  /** Unique selection ID */
  id: string;
  /** Selection display name */
  name: string;
  /** Decimal odds value */
  trueOdds: number;
  /** Parent market ID */
  marketId: string;
  /** Market type ID for quick categorization */
  marketTypeId: string;
  /** Associated event ID */
  eventId: string;
  /** Outcome type: "Home", "Away", "Tie", "Over", "Under", etc. */
  outcomeType: string;
  /** Selection status: "Active", "Suspended", etc. */
  status: string;
  /** Display order */
  order: number;
  /** Line value for O/U and handicap selections */
  points?: number;
}

/**
 * Initial state payload from PZBuk WebSocket INITIAL_STATE message
 * Contains all events, markets, and selections for the current view
 */
export interface PZBukInitialState {
  /** All events in the current view */
  events: PZBukEvent[];
  /** All markets for those events */
  markets: PZBukMarket[];
  /** All selections for those markets */
  selections: PZBukSelection[];
}

/**
 * Message carried inside a WebSocket DATA frame (or a legacy RSocket frame).
 */
export interface PZBukWebSocketMessage {
  /** Message type: "INITIAL_STATE", "SELECTION_DELTA", "EVENT_DELTA" */
  type: string;
  /**
   * Message payload. A `PZBukInitialState` for INITIAL_STATE; the delta
   * payload shapes are not modelled.
   */
  payload: unknown;
}

/**
 * Parsed team names from event
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}

/**
 * Grouped selections by market for processing
 */
export interface GroupedSelections {
  /** Key format: "eventId:marketTypeId" or "eventId:marketTypeId:points" */
  [key: string]: PZBukSelection[];
}

/**
 * Market group (event page tab) declared on an event
 */
export interface PZBukMarketGroup {
  /** Market group ID, as used in SUBSCRIBE `filters.marketGroupIds` */
  id: number;
  /** Group display name (e.g. "Popularne") */
  name: string;
  /** Number of markets the group declares */
  marketsCount: number;
}
