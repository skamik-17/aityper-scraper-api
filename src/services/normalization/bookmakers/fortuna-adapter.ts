/**
 * Fortuna Adapter
 *
 * Fortuna uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const fortunaAdapter: BookmakerAdapter = {
  bookmaker: "fortuna",
  bookmakerName: "Fortuna",

  // Fortuna-specific selection overrides (if any)
  selectionOverrides: {
    // Add Fortuna-specific selection codes here if needed
    // Example: { "^1X$": "HOME_OR_DRAW" }
  },
};
