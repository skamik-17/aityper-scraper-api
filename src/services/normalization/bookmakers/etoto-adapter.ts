/**
 * Etoto Adapter
 *
 * Etoto uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const etotoAdapter: BookmakerAdapter = {
  bookmaker: "etoto",
  bookmakerName: "Etoto",

  // Etoto-specific selection overrides (if any)
  selectionOverrides: {
    // Add Etoto-specific selection codes here if needed
  },
};
