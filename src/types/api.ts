/**
 * API request/response types
 */

import type { PolishBookmaker } from "../config/index.js";
import type { MatchOdds, BookmakerStatus } from "./database.js";
import type { BookmakerHealthMeta } from "../services/bookmaker-status.js";

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
  /** Markets saved by bookmakers with an OK outcome (success or partial). */
  marketsSaved: number;
  /** Set when the run was refused before any scraper started. */
  aborted: "db_unreachable" | null;
  /** Bookmakers whose outcome was not OK, with the reason. */
  failed: Array<{ bookmaker: string; status: string; error: string | null }>;
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

// GET /api/health/scrapers: one entry per configured bookmaker
export interface ScraperHealthEntry {
  bookmaker: PolishBookmaker;
  status: BookmakerStatus;
  lastStatus: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastOddsAt: string | null;
  consecutiveFailures: number;
  failingSince: string | null;
  lastError: string | null;
  lastMatchesFound: number;
  lastMarketsSaved: number;
}

export interface ScraperHealthReport {
  league: string;
  generatedAt: string;
  /** odds_only: scraper_runs could not be read, so statuses come from odds freshness alone. */
  source: "scraper_runs" | "odds_only";
  /** This process's last run of the league (null in a separate CLI process). */
  lastRun: ScrapeStats | null;
  lastAbort: { league: string; reason: string; at: string } | null;
  counts: Record<BookmakerStatus, number>;
  /** CONFIG.BOOKMAKERS order */
  bookmakers: ScraperHealthEntry[];
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
  bookmakerHealth: Record<PolishBookmaker, BookmakerHealthMeta>;
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
