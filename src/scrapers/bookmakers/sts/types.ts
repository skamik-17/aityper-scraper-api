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
  /**
   * Prematch market groups. The main group is keyed "1m<stsId>"; a fixture
   * snapshot also carries extra groups under opaque keys (e.g. "17m<hash>"),
   * tied to their fixture by `f` and typed by `r`.
   */
  P?: Record<
    string,
    {
      /** Fixture ID this group belongs to (e.g. "f2921898") */
      f?: string;
      /** Group type: 1 = main offer, 12 = "(z dogrywką)" player props, 17 = team stats */
      r?: number;
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
