/**
 * Totalbet Adapter
 *
 * Totalbet uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const totalbetAdapter: BookmakerAdapter = {
  bookmaker: "totalbet",
  bookmakerName: "Totalbet",

  // Totalbet-specific selection overrides (if any)
  selectionOverrides: {
    // Add Totalbet-specific selection codes here if needed
  },
};
