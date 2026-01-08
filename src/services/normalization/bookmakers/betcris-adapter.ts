import type { BookmakerAdapter, NormalizedSelection } from "../types.js";

export const betcrisAdapter: BookmakerAdapter = {
  bookmaker: "betcris",
  bookmakerName: "Betcris",

  selectionOverrides: {
    "^w1$": "HOME" as NormalizedSelection,
    "^w2$": "AWAY" as NormalizedSelection,
    "^1x$": "HOME_OR_DRAW" as NormalizedSelection,
    "^x2$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^12$": "HOME_OR_AWAY" as NormalizedSelection,
    "^over$": "OVER" as NormalizedSelection,
    "^under$": "UNDER" as NormalizedSelection,
    "^yes$": "YES" as NormalizedSelection,
    "^no$": "NO" as NormalizedSelection,
  },
};
