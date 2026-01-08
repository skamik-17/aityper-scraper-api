import type { BookmakerAdapter, NormalizedSelection } from "../types.js";

export const fuksiarzAdapter: BookmakerAdapter = {
  bookmaker: "fuksiarz",
  bookmakerName: "Fuksiarz",

  selectionOverrides: {
    "^1x$": "HOME_OR_DRAW" as NormalizedSelection,
    "^x2$": "DRAW_OR_AWAY" as NormalizedSelection,
    "^12$": "HOME_OR_AWAY" as NormalizedSelection,
  },
};
