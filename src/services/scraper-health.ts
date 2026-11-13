/**
 * Scraper Health Monitoring Service
 * Tracks success rates, average times, failure streaks and error patterns per
 * scraper, from classified run outcomes: a bookmaker that scraped matches but
 * saved nothing (persist_failed) or found none (empty) counts as a failure.
 * In memory only; scraper_runs holds the persisted history.
 */

import type { PolishBookmaker } from "../config/index.js";
import { isOkRunStatus, type BookmakerRunOutcome, type BookmakerRunStatus } from "./run-outcome.js";
import { STATUS_WINDOW_RUNS } from "./bookmaker-status.js";

interface ScraperStats {
  totalRuns: number;
  successCount: number;
  errorCount: number;
  avgDuration: number;
  lastDurations: number[];  // Last N durations for rolling average
  lastError: string | null;
  lastErrorAt: Date | null;
  lastSuccessAt: Date | null;
  lastStatus: BookmakerRunStatus | null;
  consecutiveFailures: number;
}

interface HealthReport {
  scraper: PolishBookmaker;
  successRate: number;
  avgDuration: number;
  status: "healthy" | "degraded" | "failing";
  /** Error of the newest failed run. */
  lastError: string | null;
  lastStatus: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
}

export interface RunAbort {
  league: string;
  reason: string;
  at: string;
}

const MAX_DURATION_HISTORY = 10;

class ScraperHealthService {
  private stats: Map<PolishBookmaker, ScraperStats> = new Map();
  /** league -> bookmaker -> outcomes, newest first, at most STATUS_WINDOW_RUNS each */
  private outcomes: Map<string, Map<PolishBookmaker, BookmakerRunOutcome[]>> = new Map();
  private lastAbort: RunAbort | null = null;
  /** Failure streaks whose alert has fired, as "<league>|<bookmaker>" (see buildRunAlerts). */
  private alertedStreaks = new Set<string>();

  /**
   * Record one bookmaker's classified run outcome
   */
  recordOutcome(o: BookmakerRunOutcome): void {
    let scraperStats = this.stats.get(o.bookmaker);

    if (!scraperStats) {
      scraperStats = {
        totalRuns: 0,
        successCount: 0,
        errorCount: 0,
        avgDuration: 0,
        lastDurations: [],
        lastError: null,
        lastErrorAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        consecutiveFailures: 0,
      };
      this.stats.set(o.bookmaker, scraperStats);
    }

    scraperStats.totalRuns++;
    scraperStats.lastStatus = o.status;

    if (isOkRunStatus(o.status)) {
      scraperStats.successCount++;
      scraperStats.consecutiveFailures = 0;
      scraperStats.lastSuccessAt = o.finishedAt;

      // Update duration tracking (only for successful runs)
      scraperStats.lastDurations.push(o.durationMs);
      if (scraperStats.lastDurations.length > MAX_DURATION_HISTORY) {
        scraperStats.lastDurations.shift();
      }
      scraperStats.avgDuration =
        scraperStats.lastDurations.reduce((a, b) => a + b, 0) /
        scraperStats.lastDurations.length;
    } else {
      scraperStats.errorCount++;
      scraperStats.consecutiveFailures++;
      scraperStats.lastError = o.error || "Unknown error";
      scraperStats.lastErrorAt = o.finishedAt;
    }

    let byBookmaker = this.outcomes.get(o.league);
    if (!byBookmaker) {
      byBookmaker = new Map();
      this.outcomes.set(o.league, byBookmaker);
    }
    const history = [o, ...(byBookmaker.get(o.bookmaker) ?? [])]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, STATUS_WINDOW_RUNS);
    byBookmaker.set(o.bookmaker, history);
  }

  /**
   * Record a run that was refused before any scraper started
   */
  recordAbort(league: string, reason: string, at: Date): void {
    this.lastAbort = { league, reason, at: at.toISOString() };
  }

  getLastAbort(): RunAbort | null {
    return this.lastAbort ? { ...this.lastAbort } : null;
  }

  /**
   * This process's outcomes for one league, newest first
   * (at most STATUS_WINDOW_RUNS per bookmaker)
   */
  getRecentOutcomes(league: string): BookmakerRunOutcome[] {
    const byBookmaker = this.outcomes.get(league);
    if (!byBookmaker) return [];
    return [...byBookmaker.values()].flat().sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  /**
   * The streak-alert state buildRunAlerts reads and updates, kept between runs
   */
  getAlertedStreaks(): Set<string> {
    return this.alertedStreaks;
  }

  /**
   * Get health report for a specific scraper
   */
  getHealth(bookmaker: PolishBookmaker): HealthReport {
    const stats = this.stats.get(bookmaker);

    if (!stats || stats.totalRuns === 0) {
      return {
        scraper: bookmaker,
        successRate: 0,
        avgDuration: 0,
        status: "healthy", // No data yet
        lastError: null,
        lastStatus: null,
        consecutiveFailures: 0,
        lastSuccessAt: null,
      };
    }

    const successRate = stats.successCount / stats.totalRuns;
    let status: "healthy" | "degraded" | "failing";

    if (successRate >= 0.9) {
      status = "healthy";
    } else if (successRate >= 0.5) {
      status = "degraded";
    } else {
      status = "failing";
    }

    return {
      scraper: bookmaker,
      successRate: Math.round(successRate * 100),
      avgDuration: Math.round(stats.avgDuration),
      status,
      lastError: stats.lastError,
      lastStatus: stats.lastStatus,
      consecutiveFailures: stats.consecutiveFailures,
      lastSuccessAt: stats.lastSuccessAt?.toISOString() ?? null,
    };
  }

  /**
   * Get health report for all scrapers
   */
  getAllHealth(): HealthReport[] {
    const reports: HealthReport[] = [];

    for (const bookmaker of this.stats.keys()) {
      reports.push(this.getHealth(bookmaker));
    }

    // Sort by success rate (failing first)
    return reports.sort((a, b) => a.successRate - b.successRate);
  }

  /**
   * Get scrapers that should be skipped (too many failures)
   */
  getFailingScrapers(): PolishBookmaker[] {
    const failing: PolishBookmaker[] = [];

    for (const [bookmaker, stats] of this.stats) {
      // Skip scrapers with >50% failure rate in last 10 runs
      if (stats.totalRuns >= 5) {
        const recentFailureRate = stats.errorCount / stats.totalRuns;
        if (recentFailureRate > 0.5) {
          failing.push(bookmaker);
        }
      }
    }

    return failing;
  }

  /**
   * Get estimated time for scraping all bookmakers
   */
  getEstimatedTotalTime(bookmakers: PolishBookmaker[]): number {
    let maxTime = 0;

    for (const bookmaker of bookmakers) {
      const stats = this.stats.get(bookmaker);
      if (stats && stats.avgDuration > maxTime) {
        maxTime = stats.avgDuration;
      }
    }

    // With parallel execution, total time is roughly the slowest scraper
    // Plus some overhead for extended markets
    return maxTime || 10000; // Default 10s if no data
  }

  /**
   * Reset all stats, the outcome history, the last abort and the streak-alert state
   */
  reset(): void {
    this.stats.clear();
    this.outcomes.clear();
    this.lastAbort = null;
    this.alertedStreaks.clear();
  }

  /**
   * Get raw stats for debugging
   */
  getDebugStats(): Map<PolishBookmaker, ScraperStats> {
    return new Map(this.stats);
  }
}

// Singleton instance
export const scraperHealth = new ScraperHealthService();
