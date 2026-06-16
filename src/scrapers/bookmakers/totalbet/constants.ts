/**
 * Totalbet Constants
 *
 * URLs, API endpoints, category IDs, and market mappings.
 * Totalbet uses a REST API for data fetching (no DOM scraping needed).
 */

/**
 * Base URL for the Totalbet website
 */
export const BASE_URL = "https://totalbet.pl";

/**
 * API base URL for Totalbet REST endpoints
 */
export const API_BASE_URL = "https://totalbet.pl/rest/market";

/**
 * Category IDs for Totalbet API (legacy numeric platform)
 * These are used to filter events by league in API requests
 * Found via network inspection of the Totalbet website
 */
export const CATEGORY_IDS: Record<string, number> = {
  ekstraklasa: 7023,
  "premier-league": 7124,
  laliga: 7110,
  "serie-a": 7151,
  "ligue-1": 7219,
};

/**
 * Category UUIDs for the current Totalbet offer platform
 *
 * Totalbet migrated to a new platform that identifies categories by UUID,
 * consumed via /dealer/bdata/v1/bet/events?category_uuid=<uuid>&category_type=sport.
 * New leagues are wired here as their numeric ids no longer exist.
 */
export const CATEGORY_UUIDS: Record<string, string> = {
  // FIFA World Cup 2026 ("Mistrzostwa Świata") tournament
  // Path: Piłka nożna > Międzynarodowe > Mistrzostwa Świata
  "world-cup-2026": "298d1945-aed7-4b43-ba39-3dbc23a59cd0",
};

/**
 * League URLs for navigation (used to establish session if needed)
 */
export const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: `${BASE_URL}/zaklady-sportowe/Pilka-nozna/7023/1`,
  "premier-league": `${BASE_URL}/zaklady-sportowe/Pilka-nozna/7124/1`,
  laliga: `${BASE_URL}/zaklady-sportowe/Pilka-nozna/7110/1`,
  "serie-a": `${BASE_URL}/zaklady-sportowe/Pilka-nozna/7151/1`,
  "ligue-1": `${BASE_URL}/zaklady-sportowe/Pilka-nozna/7219/1`,
  // New UUID-based offer route used by the current Totalbet platform
  "world-cup-2026": `${BASE_URL}/league/298d1945-aed7-4b43-ba39-3dbc23a59cd0/events`,
};

/**
 * Game type IDs used by Totalbet API
 * These identify different betting market types
 */
export const GAME_TYPES = {
  // Main markets
  MATCH_RESULT_1X2: 1,      // gameType 1 - "Wynik meczu" / "1X2"
  DOUBLE_CHANCE: 4,         // gameType 4 - "Podwojna szansa"

  // Goals markets
  BTTS: 98,                 // gameType 98 - "Obie druzyny strzelą"
  TOTAL_GOALS: 8,           // gameType 8 - "Suma goli" (has `argument` field with line)

  // Handicap markets
  ASIAN_HANDICAP: 6,        // gameType 6 - Asian Handicap
  EUROPEAN_HANDICAP: 5,     // gameType 5 - European Handicap

  // Half-time markets
  HALF_TIME_RESULT: 2,      // gameType 2 - "Wynik 1. polowy"
  HALF_TIME_TOTAL: 9,       // gameType 9 - "Suma goli 1. polowa"

  // Correct score
  CORRECT_SCORE: 3,         // gameType 3 - "Dokladny wynik"

  // Other markets
  ODD_EVEN_GOALS: 10,       // gameType 10 - "Parzyste/Nieparzyste"
  DRAW_NO_BET: 7,           // gameType 7 - "Remis = zwrot"
} as const;

/**
 * Market group names for UI organization
 * Maps game types to human-readable group names
 */
export const MARKET_GROUPS: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "Wynik meczu",
  [GAME_TYPES.DOUBLE_CHANCE]: "Wynik meczu",
  [GAME_TYPES.BTTS]: "Gole",
  [GAME_TYPES.TOTAL_GOALS]: "Gole",
  [GAME_TYPES.ASIAN_HANDICAP]: "Handicap",
  [GAME_TYPES.EUROPEAN_HANDICAP]: "Handicap",
  [GAME_TYPES.HALF_TIME_RESULT]: "Pierwsza polowa",
  [GAME_TYPES.HALF_TIME_TOTAL]: "Pierwsza polowa",
  [GAME_TYPES.CORRECT_SCORE]: "Dokladny wynik",
  [GAME_TYPES.ODD_EVEN_GOALS]: "Gole",
  [GAME_TYPES.DRAW_NO_BET]: "Wynik meczu",
};

/**
 * Normalized market type identifiers
 * Used for filtering and categorization
 */
export const MARKET_TYPES: Record<number, string> = {
  [GAME_TYPES.MATCH_RESULT_1X2]: "1X2",
  [GAME_TYPES.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [GAME_TYPES.BTTS]: "BTTS",
  [GAME_TYPES.TOTAL_GOALS]: "OVER_UNDER",
  [GAME_TYPES.ASIAN_HANDICAP]: "ASIAN_HANDICAP",
  [GAME_TYPES.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [GAME_TYPES.HALF_TIME_RESULT]: "HALF_TIME_1X2",
  [GAME_TYPES.HALF_TIME_TOTAL]: "HALF_TIME_OVER_UNDER",
  [GAME_TYPES.CORRECT_SCORE]: "CORRECT_SCORE",
  [GAME_TYPES.ODD_EVEN_GOALS]: "ODD_EVEN",
  [GAME_TYPES.DRAW_NO_BET]: "DRAW_NO_BET",
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Cache time-to-live in milliseconds (1 minute)
 */
export const CACHE_TTL = 60000;

/**
 * Character used by Totalbet to separate team names in eventName
 */
export const TEAM_SEPARATOR = " - ";
