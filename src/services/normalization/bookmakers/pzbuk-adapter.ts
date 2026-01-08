import type { BookmakerAdapter, NormalizedSelection } from "../types.js";

export const pzbukAdapter: BookmakerAdapter = {
  bookmaker: "pzbuk",
  bookmakerName: "PZBUK",

  selectionOverrides: {
    "^home$": "HOME" as NormalizedSelection,
    "^away$": "AWAY" as NormalizedSelection,
    "^tie$": "DRAW" as NormalizedSelection,
    "^1x$": "HOME_OR_DRAW" as NormalizedSelection,
    "^x2$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^12$": "HOME_OR_AWAY" as NormalizedSelection,
    "^over$": "OVER" as NormalizedSelection,
    "^under$": "UNDER" as NormalizedSelection,
  },
};
