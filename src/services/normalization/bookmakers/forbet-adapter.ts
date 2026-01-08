/**
 * Forbet Adapter
 *
 * Forbet uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const forbetAdapter: BookmakerAdapter = {
  bookmaker: "forbet",
  bookmakerName: "Forbet",

  // Forbet-specific selection overrides (if any)
  selectionOverrides: {
    // Add Forbet-specific selection codes here if needed
  },
};
