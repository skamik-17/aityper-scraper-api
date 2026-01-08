/**
 * Superbet Adapter
 *
 * Superbet uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const superbetAdapter: BookmakerAdapter = {
  bookmaker: "superbet",
  bookmakerName: "Superbet",

  // Superbet-specific selection overrides (if any)
  selectionOverrides: {
    // Add Superbet-specific selection codes here if needed
  },
};
