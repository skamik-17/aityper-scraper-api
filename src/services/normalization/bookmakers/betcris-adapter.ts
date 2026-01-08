/**
 * Betcris Adapter
 *
 * Betcris uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const betcrisAdapter: BookmakerAdapter = {
  bookmaker: "betcris",
  bookmakerName: "Betcris",

  // Betcris-specific selection overrides (if any)
  selectionOverrides: {
    // Add Betcris-specific selection codes here if needed
  },
};
