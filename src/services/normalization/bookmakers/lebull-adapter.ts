/**
 * Lebull Adapter
 *
 * Lebull uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const lebullAdapter: BookmakerAdapter = {
  bookmaker: "lebull",
  bookmakerName: "Lebull",

  // Lebull-specific selection overrides (if any)
  selectionOverrides: {
    // Add Lebull-specific selection codes here if needed
  },
};
