/**
 * Betcris Internal Types
 *
 * Type definitions for Swarm WebSocket API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Individual betting event/selection from Swarm API
 */
export interface SwarmEvent {
  /** Internal event ID */
  id: number;
  /** Selection name (e.g., "W1", "Over 2.5") */
  name: string;
  /** Decimal odds value */
  price: number;
  /** Display order */
  order: number;
  /** Selection type code (e.g., "W1", "X", "W2", "Over", "Under") */
  type_1?: string;
  /** Line value for handicap/totals markets */
  base?: number;
}

/**
 * Single market from Swarm API
 */
export interface SwarmMarket {
  /** Internal market ID */
  id: number;
  /** Market display name (e.g., "Wynik meczu", "Liczba goli") */
  name: string;
  /** Market type identifier (e.g., "P1XP2", "OverUnder", "BothTeamsToScore") */
  type: string;
  /** Display order */
  order: number;
  /** Line value for totals markets (e.g., 2.5) */
  base?: number;
  /** Number of columns for UI display */
  col_count: number;
  /** Selections within this market, keyed by ID */
  event?: Record<string, SwarmEvent>;
}

/**
 * Single game/match from Swarm API
 */
export interface SwarmGame {
  /** Internal game ID */
  id: number;
  /** Home team name */
  team1_name: string;
  /** Away team name */
  team2_name: string;
  /** Home team ID */
  team1_id: number;
  /** Away team ID */
  team2_id: number;
  /** Unix timestamp for match start */
  start_ts: number;
  /** Total number of available markets */
  markets_count: number;
  /** Whether betting is blocked */
  is_blocked: number;
  /** Game number identifier */
  game_number: number;
  /** All markets for this game, keyed by ID */
  market?: Record<string, SwarmMarket>;
}

/**
 * Competition/tournament from Swarm API
 */
export interface SwarmCompetition {
  /** Competition ID */
  id: number;
  /** Competition name (e.g., "Ekstraklasa", "Premier League") */
  name: string;
  /** All games in this competition, keyed by ID */
  game?: Record<string, SwarmGame>;
}

/**
 * Region from Swarm API
 */
export interface SwarmRegion {
  /** Region ID */
  id: number;
  /** Region name (e.g., "Poland", "England") */
  name: string;
  /** Region URL alias */
  alias: string;
  /** All competitions in this region, keyed by ID */
  competition?: Record<string, SwarmCompetition>;
}

/**
 * Sport from Swarm API
 */
export interface SwarmSport {
  /** Sport ID */
  id: number;
  /** Sport name (e.g., "Pilka nozna") */
  name: string;
  /** Sport URL alias (e.g., "Soccer") */
  alias: string;
  /** All regions for this sport, keyed by ID */
  region?: Record<string, SwarmRegion>;
}

/**
 * Root Swarm data structure from WebSocket response
 */
export interface SwarmData {
  /** All sports data, keyed by ID */
  sport?: Record<string, SwarmSport>;
}

/**
 * Parsed team names from a game
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}

/**
 * Context for building event URLs
 */
export interface EventUrlContext {
  regionAlias: string;
  competitionId: number;
  gameId: number;
}

/**
 * Configuration for WebSocket capture behavior
 */
export interface CaptureConfig {
  /** Target competition ID to filter for */
  competitionId?: number;
  /** Whether this is single event mode (match details) */
  singleEventMode?: boolean;
  /** Target game number/ID for single event mode */
  targetGameNumber?: number;
}

/**
 * Result from WebSocket capture operation
 */
export interface CaptureResult {
  /** Captured Swarm data or null if timeout */
  data: SwarmData | null;
  /** Total markets found in the data */
  marketCount: number;
}
