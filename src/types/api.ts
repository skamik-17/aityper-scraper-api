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
export interface HealthCheckData {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  uptime: number;
  version: string;
  database: "connected" | "disconnected";
  lastScrapeRun: string | null;
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
  durationMs: number;
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
