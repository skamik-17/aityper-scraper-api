/**
 * Market Aggregation Utilities
 *
 * Shared functions for calculating best odds across bookmakers.
 */

import type { PolishBookmaker } from "../config/index.js";
import type { MarketSelectionJson, BestOdds } from "../types/database.js";

export interface BookmakerOddsData {
  selections: MarketSelectionJson[];
  eventUrl?: string;
  scrapedAt: string;
}

/**
 * Calculates best odds for each selection across all bookmakers.
 * Used when you have all bookmaker data available at once.
 */
export function calculateBestOdds(
  bookmakerOdds: Record<string, BookmakerOddsData>
): BestOdds {
  const bestOdds: BestOdds = {};

  for (const [bookmaker, data] of Object.entries(bookmakerOdds)) {
    for (const selection of data.selections) {
      const selKey = selection.normalizedName || selection.name;
      if (!bestOdds[selKey] || selection.odds > bestOdds[selKey].odds) {
        bestOdds[selKey] = {
          bookmaker: bookmaker as PolishBookmaker,
          odds: selection.odds,
        };
      }
    }
  }

  return bestOdds;
}

/**
 * Updates best odds map incrementally for a single bookmaker.
 * Used when processing bookmakers one at a time (streaming).
 */
export function updateBestOdds(
  bestOdds: BestOdds,
  bookmaker: PolishBookmaker,
  selections: MarketSelectionJson[]
): void {
  for (const selection of selections) {
    const selKey = selection.normalizedName || selection.name;
    if (!bestOdds[selKey] || selection.odds > bestOdds[selKey].odds) {
      bestOdds[selKey] = { bookmaker, odds: selection.odds };
    }
  }
}
