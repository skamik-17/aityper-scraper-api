/**
 * Fortuna Constants
 *
 * URLs, API endpoints, tournament IDs, and market ID mappings.
 * Fortuna uses a REST API (api.efortuna.pl) for data fetching.
 */

/**
 * Base URL for the Fortuna website
 */
export const BASE_URL = "https://www.efortuna.pl";

/**
 * API base URL for Fortuna structure data (fixtures, tournaments)
 */
export const API_STRUCTURE_URL = "https://api.efortuna.pl/offer/structure/api/v1_0";

/**
 * API base URL for Fortuna market data (odds)
 */
export const API_MARKETS_URL = "https://api.efortuna.pl/offer/markets/api/v1_0";

/**
 * League URLs for navigation (used as reference, not for scraping)
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/polska-ekstraklasa",
  "premier-league":
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/anglia-2/1-anglia-1",
  laliga:
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/hiszpania/1-hiszpania",
  "serie-a":
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/wlochy/1-wlochy",
  "ligue-1":
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/francja/1-francja",
  "world-cup-2026":
    "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/miedzynarodowe/fifa-world-cup",
};

/**
 * Tournament IDs for Fortuna API
 * Format: "ufo:tour:XX-XXX"
 * Found via network inspection of the Fortuna API
 */
export const TOURNAMENT_IDS: Record<string, string> = {
  ekstraklasa: "ufo:tour:00-0b9",       // Ekstraklasa (Poland)
  "premier-league": "ufo:tour:00-03m",  // Premier League (England)
  laliga: "ufo:tour:00-0h7",            // La Liga (Spain)
  "serie-a": "ufo:tour:00-06t",         // Serie A (Italy)
  "ligue-1": "ufo:tour:00-0bo",         // Ligue 1 (France)
  "world-cup-2026": "ufo:tour:00-2h1",  // FIFA World Cup 2026 (international)
};

/**
 * Market type IDs used by Fortuna API
 * Format: "ufo:mtyp:XX-XX"
 */
export const MARKET_TYPE_IDS = {
  // Main markets
  MATCH_RESULT: "ufo:mtyp:00-00",      // Wynik meczu (1X2)
  DOUBLE_CHANCE: "ufo:mtyp:00-01",     // Mecz: dwojtyp (1X, X2, 12)

  // Goals markets
  OVER_UNDER: "ufo:mtyp:00-0u",        // Mecz: liczba goli (Over/Under)
  BTTS: "ufo:mtyp:00-1c",              // Mecz: obie druzyny strzela gola

  // Half-time markets
  HALF_TIME_RESULT: "ufo:mtyp:00-02",  // Wynik 1. polowy (1X2)
  HALF_TIME_OVER_UNDER: "ufo:mtyp:00-18", // Liczba goli 1. polowa
  HALF_TIME_BTTS: "ufo:mtyp:00-1d",    // Obie strzelaja 1. polowa

  // Handicap markets
  ASIAN_HANDICAP: "ufo:mtyp:00-0v",    // Handicap azjatycki
  EUROPEAN_HANDICAP: "ufo:mtyp:00-0w", // Handicap europejski

  // Other markets
  CORRECT_SCORE: "ufo:mtyp:00-04",     // Dokladny wynik
  DRAW_NO_BET: "ufo:mtyp:00-03",       // Remis = zwrot
  ODD_EVEN_GOALS: "ufo:mtyp:00-1a",    // Parzyste/Nieparzyste
} as const;

/**
 * Human-readable Polish fallback labels for market type ids whose API name is
 * blank or a raw internal code. Prevents leaking "Rynek ufo:mtyp:XX-XX"
 * placeholders as market names when the API does not supply a display label.
 * Only ids with confirmed identity are listed here.
 */
export const MARKET_TYPE_FALLBACK_LABELS: Record<string, string> = {
  // Goals (identities verified against the live markets API, 2026-07-08)
  "ufo:mtyp:00-24": "Mecz: multigole",
  "ufo:mtyp:00-2i": "1.połowa: liczba goli",
  "ufo:mtyp:00-3b": "2.połowa: liczba goli",
  "ufo:mtyp:00-10": "Mecz: gospodarze - liczba goli",
  "ufo:mtyp:00-13": "Mecz: goście - liczba goli",
  "ufo:mtyp:00-2j": "1.połowa: gospodarze - liczba goli",
  "ufo:mtyp:00-2k": "1.połowa: goście - liczba goli",
  "ufo:mtyp:00-3c": "2.połowa: gospodarze - liczba goli",
  "ufo:mtyp:00-3d": "2.połowa: goście - liczba goli",
  "ufo:mtyp:00-2s": "Która drużyna strzeli pierwszego gola",
  "ufo:mtyp:00-3a": "Ostatni gol",
  "ufo:mtyp:00-1e": "Ile drużyn strzeli",
  "ufo:mtyp:00-1t": "Połowa z większą liczbą goli",
  "ufo:mtyp:00-1u": "Połowa z większą liczbą goli drużyny",
  "ufo:mtyp:00-1v": "Połowa z większą liczbą goli drużyny",
  "ufo:mtyp:00-26": "Obie drużyny strzelą w połowach",
  "ufo:mtyp:00-m7": "Bramka rezerwowego",
  "ufo:mtyp:00-7a": "Czas pierwszego gola",
  // Statistics (OPTA)
  "ufo:mtyp:00-hb": "Mecz: liczba żółtych kartek",
  "ufo:mtyp:00-h3": "Mecz: liczba spalonych",
  "ufo:mtyp:00-h5": "Mecz: liczba strzałów",
  "ufo:mtyp:00-h7": "Mecz: liczba celnych strzałów",
  "ufo:mtyp:00-0t": "1.połowa: liczba rzutów rożnych",
  "ufo:mtyp:00-0j": "Mecz: gospodarze - liczba rzutów rożnych",
  "ufo:mtyp:00-0k": "Mecz: goście - liczba rzutów rożnych",
  "ufo:mtyp:00-kn": "Mecz: gospodarze - liczba fauli",
  "ufo:mtyp:00-ko": "Mecz: goście - liczba fauli",
  "ufo:mtyp:00-kp": "Mecz: gospodarze - liczba strzałów",
  "ufo:mtyp:00-kq": "Mecz: goście - liczba strzałów",
  "ufo:mtyp:00-kr": "Mecz: gospodarze - liczba celnych strzałów",
  "ufo:mtyp:00-ks": "Mecz: goście - liczba celnych strzałów",
  "ufo:mtyp:00-kx": "Mecz: gospodarze - liczba spalonych",
  "ufo:mtyp:00-ky": "Mecz: goście - liczba spalonych",
  "ufo:mtyp:00-l5": "Mecz: gospodarze - liczba żółtych kartek",
  "ufo:mtyp:00-l6": "Mecz: goście - liczba żółtych kartek",
  "ufo:mtyp:00-k6": "Mecz: liczba asyst",
  "ufo:mtyp:00-hu": "Mecz: więcej fauli",
  "ufo:mtyp:00-gd": "Mecz: więcej strzałów",
  "ufo:mtyp:00-gg": "Mecz: więcej celnych strzałów",
  "ufo:mtyp:00-gh": "Mecz: więcej spalonych",
  "ufo:mtyp:00-gj": "Mecz: więcej żółtych kartek",
  "ufo:mtyp:00-0e": "Mecz: więcej rzutów rożnych",
  "ufo:mtyp:00-o0": "Mecz: pierwsza żółta kartka",
  // Handicaps
  "ufo:mtyp:00-37": "Handicap (z możliwym zwrotem)",
  "ufo:mtyp:00-re": "Handicap",
  "ufo:mtyp:00-0h": "Handicap",
  "ufo:mtyp:00-0b": "Handicap",
  "ufo:mtyp:00-61": "Mecz: handicap",
  "ufo:mtyp:00-5z": "1.połowa: handicap",
  "ufo:mtyp:00-2h": "1.połowa: handicap",
  // Match result / combos
  "ufo:mtyp:00-2z": "2.połowa: bez remisu",
  "ufo:mtyp:00-2y": "2.połowa: dwójtyp",
  "ufo:mtyp:00-3j": "2.połowa: dokładny wynik",
  "ufo:mtyp:00-6w": "Mecz: dokładny wynik",
  "ufo:mtyp:00-04": "1.połowa lub wynik meczu (podwójna szansa)",
  "ufo:mtyp:00-23": "Mecz: dwójtyp/liczba goli",
  "ufo:mtyp:00-1k": "Mecz: obie drużyny strzelą gola/liczba goli",
  "ufo:mtyp:00-1l": "Mecz: wynik/liczba goli",
  "ufo:mtyp:00-20": "Mecz: wynik/liczba goli",
  "ufo:mtyp:00-1j": "Mecz: wynik/obie drużyny strzelą gola",
  "ufo:mtyp:00-2q": "1.połowa: wynik/obie drużyny strzelą gola w 1.połowie",
  "ufo:mtyp:00-2r": "1.połowa: wynik/liczba goli w 1.połowie",
  "ufo:mtyp:00-28": "Mecz: multiwynik",
  "ufo:mtyp:00-1n": "1.połowa/wynik meczu",
  "ufo:mtyp:00-2m": "1.połowa: parzyste/nieparzyste",
  // Time periods (quarter sub-markets between hydration breaks); the quarter
  // ordinal must stay in the label — the normalizer mines the "N.kwarta"
  // prefix for the qN parameter.
  "ufo:mtyp:00-ru": "1.kwarta",
  "ufo:mtyp:00-rx": "2.kwarta",
  "ufo:mtyp:00-rz": "3.kwarta",
  "ufo:mtyp:00-s1": "4.kwarta",
};

/**
 * Selection codes used in Fortuna API responses
 * Maps to outcome names
 */
export const SELECTION_CODES = {
  // 1X2 outcomes
  HOME: "1",
  DRAW: "0",
  AWAY: "2",

  // Double Chance outcomes
  HOME_OR_DRAW: "10",
  DRAW_OR_AWAY: "02",
  HOME_OR_AWAY: "12",
} as const;

/**
 * Market group names for UI organization
 * Maps market type IDs to human-readable group names
 */
export const MARKET_GROUPS: Record<string, string> = {
  [MARKET_TYPE_IDS.MATCH_RESULT]: "Wynik meczu",
  [MARKET_TYPE_IDS.DOUBLE_CHANCE]: "Wynik meczu",
  [MARKET_TYPE_IDS.OVER_UNDER]: "Gole",
  [MARKET_TYPE_IDS.BTTS]: "Gole",
  [MARKET_TYPE_IDS.HALF_TIME_RESULT]: "Pierwsza polowa",
  [MARKET_TYPE_IDS.HALF_TIME_OVER_UNDER]: "Pierwsza polowa",
  [MARKET_TYPE_IDS.HALF_TIME_BTTS]: "Pierwsza polowa",
  [MARKET_TYPE_IDS.ASIAN_HANDICAP]: "Handicap",
  [MARKET_TYPE_IDS.EUROPEAN_HANDICAP]: "Handicap",
  [MARKET_TYPE_IDS.CORRECT_SCORE]: "Dokladny wynik",
  [MARKET_TYPE_IDS.DRAW_NO_BET]: "Wynik meczu",
  [MARKET_TYPE_IDS.ODD_EVEN_GOALS]: "Gole",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<string, string> = {
  [MARKET_TYPE_IDS.MATCH_RESULT]: "1X2",
  [MARKET_TYPE_IDS.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [MARKET_TYPE_IDS.OVER_UNDER]: "OVER_UNDER",
  [MARKET_TYPE_IDS.BTTS]: "BTTS",
  [MARKET_TYPE_IDS.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [MARKET_TYPE_IDS.HALF_TIME_OVER_UNDER]: "HALF_TIME_OVER_UNDER",
  [MARKET_TYPE_IDS.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [MARKET_TYPE_IDS.ASIAN_HANDICAP]: "ASIAN_HANDICAP",
  [MARKET_TYPE_IDS.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [MARKET_TYPE_IDS.CORRECT_SCORE]: "CORRECT_SCORE",
  [MARKET_TYPE_IDS.DRAW_NO_BET]: "DRAW_NO_BET",
  [MARKET_TYPE_IDS.ODD_EVEN_GOALS]: "ODD_EVEN",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Delay between API requests in milliseconds (to avoid rate limiting)
 */
export const API_REQUEST_DELAY = 100;
