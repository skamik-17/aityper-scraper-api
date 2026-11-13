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
 * Why a Swarm capture attempt failed.
 *
 * Site-level (the page or its socket never delivered sport data):
 * `navigation_failed`, `no_swarm_socket`, `no_sport_frames`.
 * Content-level (the site answered, the target is not there):
 * `competition_missing`, `no_games_with_markets`, `target_game_missing`.
 */
export type SwarmCaptureFailure =
  | "navigation_failed"
  | "no_swarm_socket"
  | "no_sport_frames"
  | "competition_missing"
  | "no_games_with_markets"
  | "target_game_missing";

/**
 * Diagnostics of one capture attempt. All `*Ms` timings are ms since the
 * attempt started (just before `page.goto`).
 */
export interface SwarmCaptureAttempt {
  /** 1-based attempt number */
  attempt: number;
  /** When page.goto settled (resolved or rejected); null while still pending */
  navMs: number | null;
  /** page.goto rejection message, if it rejected */
  navError: string | null;
  /** Every Swarm socket URL seen during the attempt */
  wsUrls: string[];
  /** When the first Swarm socket opened */
  wsOpenMs: number | null;
  framesReceived: number;
  nonJsonFrames: number;
  /** Frames with code 0 and data.data.sport */
  sportFrames: number;
  /** League: target competition has a game with markets. Single-event: target game seen */
  firstUsefulFrameMs: number | null;
  failure: SwarmCaptureFailure | null;
  /** page.title(), read only on failure */
  pageTitle: string | null;
  /** page.url() at attempt end (www.betsport.pl after the client redirect); null on throw */
  finalUrl: string | null;
  /**
   * Longest Node main-thread stall during the attempt, rounded ms. It is the
   * max of perf_hooks.monitorEventLoopDelay (resolution 20 ms) and an own
   * 20 ms gap sampler. The sampler also covers the two stalls the histogram
   * misses: one that begins before its first tick (~20 ms after the attempt
   * started), and one since its last tick when the attempt ended (finish() runs
   * straight from a frame or the plateau poll). The value is the longest gap between two
   * 20 ms ticks, so ~20 means an idle loop, and N means a callback (or GC)
   * blocked the thread for roughly N-20 to N ms. Browser-side slowness does not
   * show here.
   */
  eventLoopDelayMaxMs: number | null;
  /**
   * The largest lateness, in ms, of a deadline (ws-open, first-useful-frame or
   * single-event max-wait) that fired more than 100 ms late because the event
   * loop stalled. Such a deadline waits a 1000 ms grace before it decides.
   * null (or absent) when every deadline fired on time.
   */
  deadlineLateMs?: number | null;
}

/**
 * Result of `captureSwarm`: the merged data of the successful attempt, or the
 * failure of the last attempt, plus the diagnostics of every attempt.
 */
export interface SwarmCaptureOutcome {
  data: SwarmData | null;
  failure: SwarmCaptureFailure | null;
  attempts: SwarmCaptureAttempt[];
}

/**
 * Capture deadlines and retry budget (defaults come from WS_CONFIG).
 */
export interface SwarmCaptureTiming {
  /** No Swarm socket this long after page.goto settles -> failure */
  wsOpenTimeoutMs: number;
  /** No useful frame this long after the first Swarm socket opened -> failure */
  firstUsefulFrameTimeoutMs: number;
  maxAttempts: number;
  retryBackoffMs: number;
}
