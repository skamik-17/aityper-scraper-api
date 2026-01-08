import type { BookmakerAdapter, NormalizedSelection } from "../types.js";

export const lvbetAdapter: BookmakerAdapter = {
  bookmaker: "lvbet",
  bookmakerName: "LVBET",

  selectionOverrides: {
    "^1x$": "HOME_OR_DRAW" as NormalizedSelection,
    "^x2$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^12$": "HOME_OR_AWAY" as NormalizedSelection,
    "^powyżej": "OVER" as NormalizedSelection,
    "^poniżej": "UNDER" as NormalizedSelection,
    "^powyzej": "OVER" as NormalizedSelection,
    "^ponizej": "UNDER" as NormalizedSelection,
  },
};
