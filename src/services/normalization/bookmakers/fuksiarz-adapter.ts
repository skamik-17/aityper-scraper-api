/**
 * Fuksiarz Adapter
 *
 * Fuksiarz uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const fuksiarzAdapter: BookmakerAdapter = {
  bookmaker: "fuksiarz",
  bookmakerName: "Fuksiarz",

  // Fuksiarz-specific selection overrides (if any)
  selectionOverrides: {
    // Add Fuksiarz-specific selection codes here if needed
  },
};
