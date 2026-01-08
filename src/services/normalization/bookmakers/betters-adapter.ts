/**
 * Betters Adapter
 *
 * Betters uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const bettersAdapter: BookmakerAdapter = {
  bookmaker: "betters",
  bookmakerName: "Betters",

  // Betters-specific selection overrides (if any)
  selectionOverrides: {
    // Add Betters-specific selection codes here if needed
  },
};
