/**
 * Betclic Adapter
 *
 * Betclic uses pattern matching for most markets.
 * No ID mappings needed.
 */

import type { BookmakerAdapter, NormalizedSelection } from "../types.js";

export const betclicAdapter: BookmakerAdapter = {
  bookmaker: "betclic",
  bookmakerName: "Betclic",

  selectionOverrides: {
    "^1x$": "HOME_OR_DRAW" as NormalizedSelection,
    "^x2$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^12$": "HOME_OR_AWAY" as NormalizedSelection,
    "^powyżej": "OVER" as NormalizedSelection,
    "^poniżej": "UNDER" as NormalizedSelection,
  },
};
