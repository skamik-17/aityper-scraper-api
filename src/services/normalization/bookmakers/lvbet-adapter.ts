/**
 * LVBET Adapter
 *
 * LVBET uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const lvbetAdapter: BookmakerAdapter = {
  bookmaker: "lvbet",
  bookmakerName: "LVBET",

  // LVBET-specific selection overrides (if any)
  selectionOverrides: {
    // Add LVBET-specific selection codes here if needed
  },
};
