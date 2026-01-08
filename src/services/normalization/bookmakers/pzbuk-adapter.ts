/**
 * PZBUK Adapter
 *
 * PZBUK uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter } from "../types.js";

export const pzbukAdapter: BookmakerAdapter = {
  bookmaker: "pzbuk",
  bookmakerName: "PZBUK",

  // PZBUK-specific selection overrides (if any)
  selectionOverrides: {
    // Add PZBUK-specific selection codes here if needed
  },
};
