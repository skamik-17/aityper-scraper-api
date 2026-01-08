/**
 * Superbet Adapter
 *
 * Superbet uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter, NormalizedSelection } from "../types.js";

export const superbetAdapter: BookmakerAdapter = {
  bookmaker: "superbet",
  bookmakerName: "Superbet",

  selectionOverrides: {
    "^1x$": "HOME_OR_DRAW" as NormalizedSelection,
    "^x2$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^12$": "HOME_OR_AWAY" as NormalizedSelection,
    "^gg$": "YES" as NormalizedSelection,
    "^ng$": "NO" as NormalizedSelection,
    "^pow\\.?": "OVER" as NormalizedSelection,
    "^pon\\.?": "UNDER" as NormalizedSelection,
  },
};
