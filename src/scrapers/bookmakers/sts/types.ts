/**
 * STS Internal Types
 *
 * Type definitions for STS WebSocket data structures.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Parsed fixture data from STS WebSocket
 */
export interface STSFixture {
  /** Fixture ID (e.g., "f1234567") */
  id: string;
  /** Home team name (Polish) */
  home: string;
  /** Away team name (Polish) */
  away: string;
  /** Start time ISO string */
  startTime: string;
  /** STS internal ID for odds lookup */
  stsId: number;
  /** Tournament name */
  tournament: string;
  /** Country name */
  country: string;
  /** Constructed event URL */
  eventUrl: string;
}

/**
 * Parsed odds from STS WebSocket
 */
export interface STSOdds {
  /** 1X2 home win */
  odds1: number | null;
  /** 1X2 draw */
  oddsX: number | null;
  /** 1X2 away win */
  odds2: number | null;
  /** Double Chance 1X */
  odds1X: number | null;
  /** Double Chance X2 */
  oddsX2: number | null;
  /** Double Chance 12 */
  odds12: number | null;
  /** BTTS Yes */
  bttsYes: number | null;
  /** BTTS No */
  bttsNo: number | null;
  /** Over/Under by line (e.g., "2.5" -> {over, under}) */
  overUnder: Record<string, { over: number; under: number }>;
}

/**
 * Raw outcome from STS WebSocket market data
 */
export interface STSOutcome {
  /** Outcome ID */
  id?: number;
  /** Decimal odds value */
  O?: number;
  /** Outcome name/label */
  n?: string;
  /** Selection status */
  s?: string;
}

/**
 * Raw market line from STS WebSocket
 */
export interface STSMarketLine {
  /** Line ID */
  id?: number;
  /** Line name/label */
  n?: string;
  /** Outcomes keyed by outcome ID */
  o?: Record<string, STSOutcome>;
}

/**
 * Raw market from STS WebSocket
 */
export interface STSMarket {
  /** Market ID */
  id?: number;
  /** Market name */
  n?: string;
  /** Lines keyed by line ID */
  l?: Record<string, STSMarketLine>;
}

/**
 * Raw fixture from STS WebSocket
 */
export interface STSRawFixture {
  /** STS internal ID */
  sid?: number;
  /** Start time */
  t?: string;
  /** Home team data */
  H?: { n?: string };
  /** Away team data */
  A?: { n?: string };
}

/**
 * Tournament from STS WebSocket
 */
export interface STSTournament {
  /** Tournament name */
  n?: string;
  /** Fixtures keyed by fixture ID */
  FX?: Record<string, STSRawFixture>;
}

/**
 * Category (country) from STS WebSocket
 */
export interface STSCategory {
  /** Category/country name */
  n?: string;
  /** Tournaments keyed by tournament ID */
  T?: Record<string, STSTournament>;
}

/**
 * Sport data from STS WebSocket
 */
export interface STSSport {
  /** Sport ID */
  id?: number;
  /** Sport name */
  n?: string;
  /** Categories keyed by category ID */
  C?: Record<string, STSCategory>;
}

/**
 * Root structure for STS WebSocket initial data
 * Path: B.S.{sportId}.C.{catId}.T.{tournId}.FX.{fixId}
 */
export interface STSWebSocketData {
  /** Betting data */
  B?: {
    /** Sports keyed by sport ID ("1" = football) */
    S?: Record<string, STSSport>;
  };
  /** Prematch data keyed by assoc key (e.g., "1m123456") */
  P?: Record<
    string,
    {
      /** Markets keyed by market ID */
      m?: Record<string, STSMarket>;
    }
  >;
}

/**
 * WebSocket frame capture result
 */
export interface WSCaptureResult {
  /** Initial data containing fixture list */
  initialData: string;
  /** Fixture-specific data keyed by fixture ID */
  fixtureData: Map<string, STSWebSocketData>;
}

/**
 * League configuration type
 */
export interface LeagueConfig {
  url: string;
  tournamentId: number;
  countryFilter: string;
  tournamentFilter: string;
}
