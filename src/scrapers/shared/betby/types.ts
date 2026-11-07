/**
 * Betby (bettech, Sportradar UOF) wire types and per-brand configuration.
 *
 * Brand, category, tournament and event ids are 19-digit strings above 2^53:
 * keep them as strings end to end and never pass them through Number().
 * Manifest and chunk versions are 13-digit numbers and are safe as numbers.
 */

export type BetbyBookmaker = "betters" | "lebull";

/** GET a URL and resolve with the response body as text. */
export type FetchText = (url: string) => Promise<string>;

export interface BetbyEndpoints {
  /** Base for manifest, snapshot chunks and full events, e.g. `https://api-h-….sptpub.com/api/v4`. */
  prematchBase: string;
  /** Base for market and event descriptions, e.g. `https://api-h-….sptpub.com/api/v3`. */
  descriptionsBase: string;
  brandId: string;
}

/** One quotable outcome: `k` is the decimal odds string, a truthy `b` marks it blocked. */
export interface BetbyOutcome {
  k: string;
  b?: number;
}

/** marketId -> specifier string ("" when none) -> outcomeId -> outcome. */
export type BetbyMarkets = Record<string, Record<string, Record<string, BetbyOutcome>>>;

export interface BetbyEvent {
  desc: {
    /** Kick-off in unix seconds. */
    scheduled: number;
    type: string;
    slug: string;
    sport: string;
    category: string;
    tournament: string;
    competitors: { id: string; name: string }[];
  };
  markets: BetbyMarkets;
  state?: { status?: number };
}

/** Shared envelope of manifest chunks and the event endpoint. */
export interface BetbyEnvelope {
  version: number;
  snapshot_complete?: boolean;
  sports?: Record<string, { slug: string }>;
  categories?: Record<string, { slug: string; name: string }>;
  tournaments?: Record<string, { category_id: string; slug: string; name: string }>;
  /** Absent when a chunk rotated away, and on the event endpoint for an unknown or withdrawn id. */
  events?: Record<string, BetbyEvent>;
}

export interface BetbyManifest {
  version: number;
  top_events_versions: number[];
  rest_events_versions: number[];
}

/** Every chunk of one manifest merged together. */
export interface BetbySnapshot {
  manifestVersion: number;
  events: Record<string, BetbyEvent>;
  categories: NonNullable<BetbyEnvelope["categories"]>;
  tournaments: NonNullable<BetbyEnvelope["tournaments"]>;
}

/** marketId -> Polish template name, specifier names and outcome names per variant. */
export type BetbyMarketDescriptions = Record<
  string,
  {
    id: string;
    name: string;
    specifiers?: string[];
    variants?: Record<string, { outcomes: { id: string; name: string }[] }[]>;
  }
>;

/** One upcoming league match picked from a snapshot. */
export interface BetbyEventRef {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  /** ISO 8601 kick-off. */
  startTime: string;
  categoryId: string;
  categorySlug: string;
  tournamentId: string;
  tournamentSlug: string;
  eventSlug: string;
  /** Markets carried by the listing chunk (1, 10, 16 and 18 only). */
  listingMarkets: BetbyMarkets;
}

export interface BetbyBrandConfig {
  bookmaker: BetbyBookmaker;
  logTag: "Betters" | "LeBull";
  /** Endpoints verified on 2026-11-06; used whenever discovery fails. */
  pinned: BetbyEndpoints;
  discover: (fetchText: FetchText) => Promise<BetbyEndpoints>;
  /** User-facing deep link to the event page. */
  buildEventUrl: (ref: BetbyEventRef) => string;
}
