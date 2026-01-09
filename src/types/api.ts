/**
 * API request/response types
 */

import type { PolishBookmaker } from "../config/index.js";
import type { MatchOdds, BookmakerStatus } from "./database.js";

// Generic API response wrapper
export interface ApiSuccessResponse<T, M = Record<string, unknown>> {
  success: true;
  data: T;
  meta?: M;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Health check
export interface ScrapeStats {
  startedAt: string;
  completedAt: string;
  duration: number;
  successCount: number;
  errorCount: number;
  uniqueMatches: number;
  marketsScraped: number;
}

export interface HealthCheckData {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  uptime: number;                     // seconds
  version: string;
  database: "connected" | "disconnected";
  lastScrapeStarted: string | null;   // When scrape cycle began
  lastScrapeCompleted: string | null; // When scrape cycle finished
  lastScrapeDuration: number | null;  // Wall-clock time in seconds
  lastScrapeStats: Record<string, ScrapeStats> | null;
}

// Odds endpoint
export interface OddsResponseData {
  matches: MatchOdds[];
}

export interface OddsResponseMeta {
  league: string;
  totalMatches: number;
  lastUpdated: string | null;
  nextUpdate: string;
  scrapeIntervalMinutes: number;
  bookmakerStatus: Record<PolishBookmaker, BookmakerStatus>;
}

// Match odds endpoint
export interface MatchOddsResponseData {
  match: MatchOdds;
}

export interface MatchOddsResponseMeta {
  lastUpdated: string;
}

// Bookmakers endpoint
export interface BookmakerInfo {
  id: PolishBookmaker;
  name: string;
  status: BookmakerStatus;
  lastSuccessfulScrape: string | null;
  lastError?: string;
  matchesFound: number;
  avgScrapeDurationMs: number | null;
  hasNoTaxPromo: boolean;
}

export interface BookmakersResponseData {
  bookmakers: BookmakerInfo[];
}

export interface BookmakersResponseMeta {
  totalBookmakers: number;
  availableCount: number;
  errorCount: number;
}

// Admin scrape endpoint
export interface AdminScrapeRequest {
  league?: string;
  bookmakers?: PolishBookmaker[];
}

export interface AdminScrapeResponseData {
  runId: string;
  status: "started";
  league: string;
  bookmakers: PolishBookmaker[];
  startedAt: string;
}

// Admin runs endpoint
export interface ScraperRunResult {
  bookmaker: PolishBookmaker;
  status: "success" | "error";
  matchesFound: number;
  marketsSaved: number;
  durationMs: number | null;
  error?: string;
}

export interface ScraperRunInfo {
  runId: string;
  league: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  results: ScraperRunResult[];
  summary: {
    successCount: number;
    errorCount: number;
    totalMatchesFound: number;
  };
}

export interface AdminRunsResponseData {
  runs: ScraperRunInfo[];
}

export interface AdminRunsResponseMeta {
  total: number;
  limit: number;
  offset: number;
}

// Extended markets endpoint
export interface ExtendedMarketsResponseData {
  homeTeam: string;
  awayTeam: string;
  doubleChance: Array<{
    bookmaker: PolishBookmaker;
    homeOrDraw: number | null;
    drawOrAway: number | null;
    homeOrAway: number | null;
    eventUrl: string | null;
    scrapedAt: string;
  }>;
  overUnder: Array<{
    bookmaker: PolishBookmaker;
    line: number;
    overOdds: number | null;
    underOdds: number | null;
    eventUrl: string | null;
    scrapedAt: string;
  }>;
  btts: Array<{
    bookmaker: PolishBookmaker;
    yesOdds: number | null;
    noOdds: number | null;
    eventUrl: string | null;
    scrapedAt: string;
  }>;
  bestOdds: {
    doubleChance: {
      homeOrDraw: { bookmaker: PolishBookmaker; odds: number } | null;
      drawOrAway: { bookmaker: PolishBookmaker; odds: number } | null;
      homeOrAway: { bookmaker: PolishBookmaker; odds: number } | null;
    };
    overUnder: Record<string, {
      over: { bookmaker: PolishBookmaker; odds: number } | null;
      under: { bookmaker: PolishBookmaker; odds: number } | null;
    }>;
    btts: {
      yes: { bookmaker: PolishBookmaker; odds: number } | null;
      no: { bookmaker: PolishBookmaker; odds: number } | null;
    };
  };
}

export interface ExtendedMarketsResponseMeta {
  league: string;
  lastUpdated: string | null;
  bookmakerCount: number;
}

// Error codes
export const ERROR_CODES = {
  INVALID_PARAMS: "INVALID_PARAMS",
  UNAUTHORIZED: "UNAUTHORIZED",
  MATCH_NOT_FOUND: "MATCH_NOT_FOUND",
  RUN_NOT_FOUND: "RUN_NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
