/**
 * Full Offer Types
 *
 * Generic types for storing all available betting markets
 * from bookmakers, replacing the specific market type approach
 * (1X2, Double Chance, Over/Under, BTTS) with a unified structure.
 */

import type { PolishBookmaker } from "../config/index.js";
import type { NormalizedMarketType, NormalizedSelection, NormalizedMarketGroup } from "./normalization.js";

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
  /** Group name for UI organization: "Main", "Goals", "1st Half", "Corners" */
  groupName?: string;
  /** Normalized group for consistent UI grouping */
  normalizedGroup?: NormalizedMarketGroup;
  /** Optional normalized type for filtering: "1X2", "OVER_UNDER", "BTTS", "DOUBLE_CHANCE" */
  type?: string;
  /** Normalized market type enum for cross-bookmaker comparison */
  normalizedType?: NormalizedMarketType;
  /** Canonical market key for exact matching: "TOTAL_GOALS:2.5", "MATCH_WINNER" */
  marketKey?: string;
  /** Parameter value for parameterized markets: "2.5" for Over/Under, "-1.5" for handicaps */
  paramValue?: string;
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
 * Database row type for scraped_market_groups table
 */
export interface ScrapedMarketGroupRow {
  id: string;
  match_id: string;
  bookmaker: string;
  name: string;
  display_order: number;
  created_at: string;
}

/**
 * Database row type for scraped_markets table
 */
export interface ScrapedMarketRow {
  id: string;
  match_id: string;
  group_id: string | null;
  bookmaker: string;
  external_id: string | null;
  name: string;
  normalized_type: string;
  selections: MarketSelection[];
  scraped_at: string;
  created_at: string;
}

/**
 * Insert type for scraped_market_groups table
 */
export interface ScrapedMarketGroupInsert {
  match_id: string;
  bookmaker: string;
  name: string;
  display_order?: number;
}

/**
 * Insert type for scraped_markets table
 */
export interface ScrapedMarketInsert {
  match_id: string;
  group_id?: string;
  bookmaker: string;
  external_id?: string;
  name: string;
  normalized_type?: string;
  selections: MarketSelection[];
  scraped_at: Date;
}
