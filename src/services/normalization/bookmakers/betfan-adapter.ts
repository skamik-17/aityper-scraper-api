/**
 * Betfan Adapter
 *
 * Betfan uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const betfanAdapter: BookmakerAdapter = {
  bookmaker: "betfan",
  bookmakerName: "Betfan",

  // Betfan-specific selection overrides (if any)
  selectionOverrides: {
    // Add Betfan-specific selection codes here if needed
  },
};
