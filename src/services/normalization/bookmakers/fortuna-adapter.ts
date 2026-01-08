/**
 * Fortuna Adapter
 *
 * Fortuna uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter, NormalizedSelection } from "../types.js";

export const fortunaAdapter: BookmakerAdapter = {
  bookmaker: "fortuna",
  bookmakerName: "Fortuna",

  selectionOverrides: {
    "^1x$": "HOME_OR_DRAW" as NormalizedSelection,
    "^x2$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^12$": "HOME_OR_AWAY" as NormalizedSelection,
    "^10$": "HOME_OR_DRAW" as NormalizedSelection,
    "^02$": "DRAW_OR_AWAY" as NormalizedSelection,
  },
};
