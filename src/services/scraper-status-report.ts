/**
 * Per-bookmaker scraper health report of one league, served by
 * GET /api/health/scrapers and printed by scripts/scraper-status.ts.
 * Built from the same snapshot as the API's bookmakerStatus, so the two agree.
 */
import { CONFIG } from "../config/index.js";
import type { BookmakerStatus } from "../types/database.js";
import type { ScrapeStats, ScraperHealthEntry, ScraperHealthReport } from "../types/api.js";
import type { BookmakerStatusSnapshot } from "./bookmaker-status.js";

export function buildScraperHealthReport(
  league: string,
  snap: BookmakerStatusSnapshot,
  lastRun: ScrapeStats | null,
  lastAbort: ScraperHealthReport["lastAbort"],
  now: Date,
): ScraperHealthReport {
  const counts: Record<BookmakerStatus, number> = { available: 0, stale: 0, error: 0 };

  const bookmakers: ScraperHealthEntry[] = CONFIG.BOOKMAKERS.map((bookmaker) => {
    const s = snap.summaries.get(bookmaker);
    const status = snap.status[bookmaker];
    counts[status]++;
    return {
      bookmaker,
      status,
      lastStatus: s?.lastStatus ?? null,
      lastRunAt: s?.lastRunAt ?? null,
      lastSuccessAt: s?.lastSuccessAt ?? null,
      lastOddsAt: snap.lastOddsAt.get(bookmaker)?.toISOString() ?? null,
      consecutiveFailures: s?.consecutiveFailures ?? 0,
      failingSince: s?.failingSince ?? null,
      lastError: s?.lastError ?? null,
      lastMatchesFound: s?.lastMatchesFound ?? 0,
      lastMarketsSaved: s?.lastMarketsSaved ?? 0,
    };
  });

  return {
    league,
    generatedAt: now.toISOString(),
    source: snap.source,
    lastRun,
    lastAbort,
    counts,
    bookmakers,
  };
}
