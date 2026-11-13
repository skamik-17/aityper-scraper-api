/**
 * Per-bookmaker scraper health report of one league, served by
 * GET /api/health/scrapers and printed (as a table) by scripts/scraper-status.ts,
 * whose exit code statusExitCode() decides.
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

const MAX_ERROR_CHARS = 120;
const GUTTER = "  ";

/** Second-precision ISO with a Z; `-` for none. */
function tableTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return isNaN(date.getTime()) ? iso : date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** One line, at most MAX_ERROR_CHARS characters; `-` for none. */
function tableError(error: string | null): string {
  const oneLine = (error ?? "").replace(/\s+/g, " ").trim();
  if (!oneLine) return "-";
  return oneLine.length > MAX_ERROR_CHARS ? oneLine.slice(0, MAX_ERROR_CHARS - 1) + "…" : oneLine;
}

/** Header plus one row per bookmaker, columns padded to their widest cell. */
export function formatStatusTable(r: ScraperHealthReport): string {
  const header = ["BOOKMAKER", "STATUS", "LAST RUN", "LAST SUCCESS", "FAILS", "ERROR"];
  const rows = r.bookmakers.map((b) => [
    b.bookmaker,
    b.status,
    tableTime(b.lastRunAt),
    tableTime(b.lastSuccessAt),
    String(b.consecutiveFailures),
    tableError(b.lastError),
  ]);

  const table = [header, ...rows];
  const widths = header.map((_, col) => Math.max(...table.map((cells) => cells[col].length)));
  // The last column is not padded, so no line ends in spaces.
  return table
    .map((cells) => cells.map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col]))).join(GUTTER))
    .join("\n");
}

export interface StatusExit {
  /** 0 healthy, 1 a bookmaker at or above the threshold, 2 status unknown. */
  code: 0 | 1 | 2;
  /** The stderr line that explains a non-zero code; null for 0. */
  message: string | null;
}

/**
 * Exit code of scripts/scraper-status.ts for a report.
 *
 * Failure counts come only from the run history. Without it (source
 * `odds_only`: the scraper_runs read was rejected or a row was unreadable)
 * every count is 0, so 0 would be a false green: the status is unknown.
 */
export function statusExitCode(r: ScraperHealthReport, threshold: number): StatusExit {
  if (r.source !== "scraper_runs") {
    return { code: 2, message: `run history unavailable (source=${r.source})` };
  }

  const failing = r.bookmakers.filter((b) => b.consecutiveFailures >= threshold);
  if (failing.length === 0) return { code: 0, message: null };

  const list = failing.map((b) => `${b.bookmaker} (${b.consecutiveFailures})`).join(", ");
  return { code: 1, message: `${failing.length} bookmaker(s) failed ${threshold}+ runs in a row: ${list}` };
}
