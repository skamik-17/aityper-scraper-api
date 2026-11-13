/**
 * Per-quote staleness: a quote older than observability's staleAfterMs for the scrape
 * interval. Visible only (owner B12): stale quotes stay in place and in best odds unless
 * EXCLUDE_STALE_FROM_BEST_ODDS=true.
 */
import { CONFIG } from "../config/index.js";
import { parseDbTimestamp } from "../utils/db-timestamp.js";
import { staleAfterMs } from "./bookmaker-status.js";

export function isStaleQuote(scrapedAt: string, now: Date, staleAfter: number): boolean {
  const at = parseDbTimestamp(scrapedAt);
  if (isNaN(at.getTime())) return false;
  return now.getTime() - at.getTime() > staleAfter;
}

export function staleQuoteThresholdMs(): number {
  return staleAfterMs(CONFIG.SCRAPE_INTERVAL_MINUTES);
}
