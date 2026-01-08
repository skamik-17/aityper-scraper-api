/**
 * Betclic Adapter
 *
 * Betclic uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const betclicAdapter: BookmakerAdapter = {
  bookmaker: "betclic",
  bookmakerName: "Betclic",

  // Betclic-specific selection overrides (if any)
  selectionOverrides: {
    // Add Betclic-specific selection codes here if needed
  },
};
