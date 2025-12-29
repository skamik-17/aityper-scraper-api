/**
 * Scraper Health Monitoring Service
 * Tracks success rates, average times, and error patterns per scraper
 */

import type { PolishBookmaker } from "../config/index.js";

interface ScraperStats {
  totalRuns: number;
  successCount: number;
  errorCount: number;
  avgDuration: number;
  lastDurations: number[];  // Last N durations for rolling average
  lastError: string | null;
  lastErrorAt: Date | null;
  lastSuccessAt: Date | null;
}

interface HealthReport {
  scraper: PolishBookmaker;
  successRate: number;
  avgDuration: number;
  status: "healthy" | "degraded" | "failing";
  lastError: string | null;
}

const MAX_DURATION_HISTORY = 10;

class ScraperHealthService {
  private stats: Map<PolishBookmaker, ScraperStats> = new Map();

  /**
   * Record a scraper run result
   */
  recordRun(
    bookmaker: PolishBookmaker,
    success: boolean,
    duration: number,
    error?: string
  ): void {
    let scraperStats = this.stats.get(bookmaker);

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
      };
      this.stats.set(bookmaker, scraperStats);
    }

    scraperStats.totalRuns++;

    if (success) {
      scraperStats.successCount++;
      scraperStats.lastSuccessAt = new Date();

      // Update duration tracking (only for successful runs)
      scraperStats.lastDurations.push(duration);
      if (scraperStats.lastDurations.length > MAX_DURATION_HISTORY) {
        scraperStats.lastDurations.shift();
      }
      scraperStats.avgDuration =
        scraperStats.lastDurations.reduce((a, b) => a + b, 0) /
        scraperStats.lastDurations.length;
    } else {
      scraperStats.errorCount++;
      scraperStats.lastError = error || "Unknown error";
      scraperStats.lastErrorAt = new Date();
    }
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
   * Reset all stats
   */
  reset(): void {
    this.stats.clear();
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
