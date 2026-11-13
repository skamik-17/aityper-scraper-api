/**
 * Full Offer Types
 *
 * Generic types for storing all available betting markets
 * from bookmakers, replacing the specific market type approach
 * (1X2, Double Chance, Over/Under, BTTS) with a unified structure.
 */

import type { PolishBookmaker } from "../config/index.js";
import type { NormalizedMarketType, NormalizedSelection } from "./normalization.js";
import type { MarketCategory } from "./normalized-markets.js";

/**
 * Single selection within a market (e.g., "Over 2.5" with odds 1.85)
 */
export interface MarketSelection {
  /** Raw selection name from bookmaker: "1", "X", "Over 2.5", "Yes" */
  name: string;
  /** Normalized selection name for cross-bookmaker comparison */
  normalizedName?: NormalizedSelection;
  /** Decimal odds value */
  odds: number;
  /** Bookmaker's internal selection ID (optional) */
  externalId?: string;
  /** Selection status */
  status?: "active" | "suspended";
}

/**
 * Single market with its selections (e.g., "Total Goals 2.5" with Over/Under)
 */
export interface ScrapedMarket {
  /** Market name: "Match Winner", "Total Goals 2.5", "Both Teams To Score" */
  name: string;
  /** Raw bookmaker market identifier (e.g., "1" for STS 1X2, protobuf field 1 for Betclic) */
  bookmakerMarketId?: string;
  /** Group name for UI organization: "Main", "Goals", "1st Half", "Corners" */
  groupName?: string;
  /** Optional normalized type for filtering: "1X2", "OVER_UNDER", "BTTS", "DOUBLE_CHANCE" */
  type?: string;
  /** Normalized market type enum for cross-bookmaker comparison */
  normalizedType?: NormalizedMarketType;
  /** Canonical market key for exact matching: "TOTAL_GOALS:2.5", "MATCH_WINNER" */
  marketKey?: string;
  /** Parameter value for parameterized markets: "2.5" for Over/Under, "-1.5" for handicaps */
  paramValue?: string;
  /** Market category following Superbet pattern for UI organization */
  category?: MarketCategory;
  /** Custom label to override default market catalog label (e.g., "Czerwona kartka - Arsenal") */
  customLabel?: string;
  /** All available selections for this market */
  selections: MarketSelection[];
}

/**
 * Complete offer for a single match from a single bookmaker
 */
export interface FullMatchOffer {
  /** Match identifier (normalized team names hash or external ID) */
  matchId: string;
  /** Bookmaker source */
  bookmaker: PolishBookmaker;
  /** Home team name (canonical) */
  homeTeam: string;
  /** Away team name (canonical) */
  awayTeam: string;
  /** URL to the match page on bookmaker's site */
  eventUrl: string;
  /** All scraped markets for this match */
  markets: ScrapedMarket[];
  /** Timestamp when data was scraped */
  scrapedAt: Date;
  /** Match kickoff time from bookmaker (ISO 8601) */
  startTime?: string;
}

/**
 * Navigation facts recorded on the scraper page (HTTP status, host, websockets).
 * Attached only to failed or empty full-offer results.
 */
export interface NavigationDiagnostics {
  /** Main-frame document responses, max 50. requestedUrl is the start of the redirect chain. */
  documents: Array<{ requestedUrl: string; finalUrl: string; status: number }>;
  /** Main-frame documents that got no response (DNS, refused, TLS, goto timeout), max 10 */
  failedNavigations: Array<{ url: string; errorText: string }>;
  /** fetch/xhr responses with status >= 400, deduped by url+status, max 20 */
  failedRequests: Array<{ url: string; status: number; resourceType: string }>;
  /** Websocket URLs opened by the page, deduped, max 10 */
  websockets: string[];
  /** Page URL when the snapshot was taken */
  finalUrl: string | null;
  /** Page title when the snapshot was taken */
  title: string | null;
}

/**
 * Per (bookmaker, league) unit metrics, set by the aggregator after the save.
 * `http` has the HttpStats shape, diffed around the unit.
 */
export interface ScrapeMetrics {
  phasesMs: { scrape: number; normalizeSave: number };
  matches: number;
  marketsFound: number;
  marketsSaved: number;
  http?: { requests: number; retries: number; failures: number; bytes: number; byStatus: Record<string, number> };
  ws?: { framesReceived: number; bytesReceived: number };
}

/**
 * Result from scraping full offer for a league
 */
export interface FullOfferScraperResult {
  /** Whether scraping completed successfully */
  success: boolean;
  /** Bookmaker that was scraped */
  bookmaker: PolishBookmaker;
  /** League that was scraped */
  league: string;
  /** All matches with their full offers */
  matches: FullMatchOffer[];
  /** Error message if success is false */
  error?: string;
  /** Scraping duration in milliseconds */
  duration?: number;
  /** Navigation facts, present only on failed or empty results */
  diagnostics?: NavigationDiagnostics;
  /** Unit metrics, owned by the aggregator */
  metrics?: ScrapeMetrics;
}

/**
 * Aggregated result from all bookmakers for a league
 */
export interface AggregatedFullOfferResult {
  /** Unique run identifier */
  runId: string;
  /** League that was scraped */
  league: string;
  /** When scraping started */
  startedAt: Date;
  /** When scraping completed */
  completedAt: Date;
  /** Results per bookmaker */
  results: Map<PolishBookmaker, FullOfferScraperResult>;
  /** Summary statistics */
  summary: {
    totalBookmakers: number;
    successfulBookmakers: number;
    failedBookmakers: number;
    totalMatches: number;
    totalMarkets: number;
  };
}

/**
 * Over/Under market odds structure
 * Used by parsers for structured O/U markets
 */
export interface MarketOverUnderOdds {
  over: number;
  under: number;
}

/**
 * 1X2 (Match Winner) market odds structure
 */
export interface Market1X2Odds {
  home: number;
  draw: number;
  away: number;
}

/**
 * Double Chance market odds structure
 */
export interface MarketDoubleChanceOdds {
  homeOrDraw: number;   // 1X
  drawOrAway: number;   // X2
  homeOrAway: number;   // 12
}

/**
 * Both Teams To Score (BTTS) market odds structure
 */
export interface MarketBTTSOdds {
  yes: number;
  no: number;
}
