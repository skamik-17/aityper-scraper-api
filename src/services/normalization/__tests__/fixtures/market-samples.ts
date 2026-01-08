/**
 * Test Fixtures - Market Samples
 *
 * Comprehensive test data for all market types and bookmakers.
 * These fixtures are reused across all test files.
 */

import type { ScrapedMarket } from "../../../../types/full-offer.js";

// ============================================================================
// STS Samples (ID-based normalization)
// ============================================================================

export const STS_MARKET_SAMPLES = {
  // Match Winner (Rynek 1)
  matchWinner: {
    name: "Rynek 1",
    selections: [
      { name: "1", odds: 2.5 },
      { name: "X", odds: 3.2 },
      { name: "2", odds: 2.8 },
    ],
  } as ScrapedMarket,

  // Double Chance (Rynek 10)
  doubleChance: {
    name: "Rynek 10",
    selections: [
      { name: "1X", odds: 1.45 },
      { name: "X2", odds: 1.55 },
      { name: "12", odds: 1.25 },
    ],
  } as ScrapedMarket,

  // Draw No Bet (Rynek 4)
  drawNoBet: {
    name: "Rynek 4",
    selections: [
      { name: "1", odds: 1.85 },
      { name: "2", odds: 2.05 },
    ],
  } as ScrapedMarket,

  // Total Goals (Rynek 25)
  totalGoals: {
    name: "Rynek 25",
    selections: [
      { name: "Over 2.5", odds: 1.85 },
      { name: "Under 2.5", odds: 1.95 },
    ],
  } as ScrapedMarket,

  // Total Goals 3.5 (Rynek 8)
  totalGoals_3_5: {
    name: "Rynek 8",
    selections: [
      { name: "Over 3.5", odds: 2.10 },
      { name: "Under 3.5", odds: 1.70 },
    ],
  } as ScrapedMarket,

  // BTTS (Rynek 43)
  btts: {
    name: "Rynek 43",
    selections: [
      { name: "Tak", odds: 1.75 },
      { name: "Nie", odds: 2.10 },
    ],
  } as ScrapedMarket,

  // Half Time Result (Rynek 5)
  halfTimeResult: {
    name: "Rynek 5",
    selections: [
      { name: "1", odds: 3.20 },
      { name: "X", odds: 2.10 },
      { name: "2", odds: 4.50 },
    ],
  } as ScrapedMarket,

  // Half Time Total Goals (Rynek 26)
  halfTimeTotalGoals: {
    name: "Rynek 26",
    selections: [
      { name: "Over 0.5", odds: 1.35 },
      { name: "Under 0.5", odds: 3.00 },
    ],
  } as ScrapedMarket,

  // Asian Handicap (Rynek 3)
  asianHandicap: {
    name: "Rynek 3",
    selections: [
      { name: "1", odds: 2.05 },
      { name: "2", odds: 1.75 },
    ],
  } as ScrapedMarket,

  // Correct Score (Rynek 9)
  correctScore: {
    name: "Rynek 9",
    selections: [
      { name: "1:0", odds: 7.50 },
      { name: "1:1", odds: 6.50 },
      { name: "0:1", odds: 8.00 },
    ],
  } as ScrapedMarket,

  // Win to Nil (Rynek 35)
  winToNil: {
    name: "Rynek 35",
    selections: [
      { name: "1", odds: 3.20 },
      { name: "2", odds: 5.50 },
    ],
  } as ScrapedMarket,

  // Clean Sheet (Rynek 36)
  cleanSheet: {
    name: "Rynek 36",
    selections: [
      { name: "1", odds: 2.10 },
      { name: "2", odds: 3.80 },
    ],
  } as ScrapedMarket,
};

// ============================================================================
// Pattern-Matching Samples (Polish)
// ============================================================================

export const POLISH_MARKET_SAMPLES = {
  // Wynik meczu - various formats
  matchWinner: [
    { name: "Wynik meczu", selections: [{ name: "1", odds: 2.5 }] },
    { name: "wynik mecz", selections: [{ name: "1", odds: 2.5 }] },
    { name: "WYNIK MECZ", selections: [{ name: "1", odds: 2.5 }] },
    { name: "Wynik meczu ", selections: [{ name: "1", odds: 2.5 }] }, // trailing space
  ],

  // Podwójna szansa
  doubleChance: [
    { name: "Podwójna szansa", selections: [{ name: "1X", odds: 1.45 }] },
    { name: "podwójna szans", selections: [{ name: "1X", odds: 1.45 }] },
  ],

  // Remis = zwrot
  drawNoBet: [
    { name: "Remis = zwrot", selections: [{ name: "1", odds: 1.85 }] },
    { name: "remis = zwrot", selections: [{ name: "1", odds: 1.85 }] },
  ],

  // Liczba goli - various formats
  totalGoals: [
    { name: "Liczba goli 2.5", selections: [{ name: "Over", odds: 1.85 }] },
    { name: "Liczba goli 2,5", selections: [{ name: "Over", odds: 1.85 }] },
    { name: "liczba bramek 2.5", selections: [{ name: "Over", odds: 1.85 }] },
    { name: "Suma goli: 2.5", selections: [{ name: "Over", odds: 1.85 }] },
    { name: "Over/Under 2.5", selections: [{ name: "Over", odds: 1.85 }] },
  ],

  // Obie strzelą - various formats
  btts: [
    { name: "Obie strzelą", selections: [{ name: "Tak", odds: 1.75 }] },
    { name: "Obie drużyny strzelą gola", selections: [{ name: "Tak", odds: 1.75 }] },
    { name: "obie strzelą", selections: [{ name: "Tak", odds: 1.75 }] },
  ],

  // Handicap azjatycki
  asianHandicap: [
    { name: "Handicap azjatycki", selections: [{ name: "1", odds: 2.05 }] },
    { name: "handicap azjatyck", selections: [{ name: "1", odds: 2.05 }] },
  ],

  // Wynik 1. połowy
  halfTimeResult: [
    { name: "Wynik 1. połowy", selections: [{ name: "1", odds: 3.2 }] },
    { name: "Wynik 1. połow", selections: [{ name: "1", odds: 3.2 }] },
    { name: "1. połowa wynik", selections: [{ name: "1", odds: 3.2 }] },
  ],

  // Dokładny wynik
  correctScore: [
    { name: "Dokładny wynik", selections: [{ name: "1:0", odds: 7.5 }] },
    { name: "dokładn wynik", selections: [{ name: "1:0", odds: 7.5 }] },
  ],
};

// ============================================================================
// English Market Samples
// ============================================================================

export const ENGLISH_MARKET_SAMPLES = {
  matchWinner: [
    { name: "Match Result", selections: [{ name: "1", odds: 2.5 }] },
    { name: "Match Winner", selections: [{ name: "1", odds: 2.5 }] },
    { name: "1X2", selections: [{ name: "1", odds: 2.5 }] },
    { name: "1x2", selections: [{ name: "1", odds: 2.5 }] },
  ],

  doubleChance: [
    { name: "Double Chance", selections: [{ name: "1X", odds: 1.45 }] },
    { name: "double chance", selections: [{ name: "1X", odds: 1.45 }] },
  ],

  drawNoBet: [
    { name: "Draw No Bet", selections: [{ name: "1", odds: 1.85 }] },
    { name: "DNB", selections: [{ name: "1", odds: 1.85 }] },
  ],

  totalGoals: [
    { name: "Total Goals 2.5", selections: [{ name: "Over", odds: 1.85 }] },
    { name: "Total Goals 2,5", selections: [{ name: "Over", odds: 1.85 }] },
    { name: "Goals Over/Under 2.5", selections: [{ name: "Over", odds: 1.85 }] },
  ],

  btts: [
    { name: "Both Teams to Score", selections: [{ name: "Yes", odds: 1.75 }] },
    { name: "BTTS", selections: [{ name: "Yes", odds: 1.75 }] },
    { name: "GG", selections: [{ name: "Yes", odds: 1.75 }] },
  ],

  asianHandicap: [
    { name: "Asian Handicap", selections: [{ name: "1", odds: 2.05 }] },
  ],

  halfTimeResult: [
    { name: "Half Time Result", selections: [{ name: "1", odds: 3.2 }] },
    { name: "HT Result", selections: [{ name: "1", odds: 3.2 }] },
  ],

  correctScore: [
    { name: "Correct Score", selections: [{ name: "1:0", odds: 7.5 }] },
    { name: "Exact Score", selections: [{ name: "1:0", odds: 7.5 }] },
  ],
};

// ============================================================================
// Selection Samples
// ============================================================================

export const SELECTION_SAMPLES = {
  // Over/Under variations
  over: ["Over", "Powyżej", "Powyzej", "ponad", "pow"],
  under: ["Under", "Poniżej", "Ponizej", "pon"],

  // Yes/No variations
  yes: ["Yes", "Tak", "Si", "Ja", "Sí", "Oui", "GG", "Gol"],
  no: ["No", "Nie", "Nein", "Non", "NG"],

  // 1X2 variations
  home: ["1", "Home", "Gospodarz", "Dom", "1"],
  draw: ["X", "Draw", "Remis", "Empate", "Nul", "Unentschieden"],
  away: ["2", "Away", "Gość", "Gosc", "Auswärts", "Fuera"],

  // Double Chance variations
  homeOrDraw: ["1X", "10", "1 lub X", "1 lub x"],
  drawOrAway: ["X2", "02", "X lub 2", "x lub 2"],
  homeOrAway: ["12", "1 lub 2"],

  // Odd/Even variations
  odd: ["Odd", "Nieparzyste", "Impar", "Ungerade"],
  even: ["Even", "Parzyste", "Par", "Gerade"],
};

// ============================================================================
// Edge Cases
// ============================================================================

export const EDGE_CASE_SAMPLES = {
  // Empty/whitespace
  emptyName: { name: "", selections: [] },
  whitespaceName: { name: "   ", selections: [] },
  specialChars: { name: "@#$%", selections: [] },

  // Long names
  longName: { name: "A".repeat(300), selections: [] },

  // Invalid parameters
  invalidParameter: { name: "Over abc", selections: [{ name: "Over", odds: 1.5 }] },
  negativeParameter: { name: "Over -2.5", selections: [{ name: "Over", odds: 1.5 }] },
  extremeParameter: { name: "Over 999.5", selections: [{ name: "Over", odds: 1.5 }] },

  // Malformed selections
  emptySelection: { name: "Wynik meczu", selections: [{ name: "", odds: 1.5 }] },
  numberOnlySelection: { name: "Wynik meczu", selections: [{ name: "12345", odds: 1.5 }] },
  emojiSelection: { name: "Wynik meczu", selections: [{ name: "1 🔥", odds: 1.5 }] },

  // No selections
  noSelections: { name: "Wynik meczu", selections: [] },

  // Boundary odds
  zeroOdds: { name: "Wynik meczu", selections: [{ name: "1", odds: 0 }] },
  negativeOdds: { name: "Wynik meczu", selections: [{ name: "1", odds: -1.5 }] },
};

// ============================================================================
// Test Teams
// ============================================================================

export const TEST_TEAMS = {
  simple: {
    home: "Arsenal",
    away: "Liverpool",
  },
  polish: {
    home: "Legia Warszawa",
    away: "Lech Poznań",
  },
  withSpaces: {
    home: "Manchester United",
    away: "Tottenham Hotspur",
  },
  withSpecialChars: {
    home: "MŠ Žilina",
    away: "ŠK Slovan Bratislava",
  },
};

// ============================================================================
// STS ID Mappings (complete list for regression testing)
// ============================================================================

export const STS_ID_MAPPINGS: Array<{ id: number; expectedDefId: string }> = [
  // Match Winner
  { id: 1, expectedDefId: "match-winner" },
  { id: 40, expectedDefId: "match-winner" },
  { id: 41, expectedDefId: "match-winner" },
  { id: 42, expectedDefId: "match-winner" },
  { id: 63, expectedDefId: "match-winner" },
  { id: 64, expectedDefId: "match-winner" },
  { id: 65, expectedDefId: "match-winner" },
  { id: 66, expectedDefId: "match-winner" },
  { id: 71, expectedDefId: "match-winner" },
  { id: 94, expectedDefId: "match-winner" },
  { id: 102, expectedDefId: "match-winner" },
  { id: 106, expectedDefId: "match-winner" },
  { id: 119, expectedDefId: "match-winner" },
  { id: 1244, expectedDefId: "match-winner" },

  // Double Chance
  { id: 10, expectedDefId: "double-chance" },

  // Draw No Bet
  { id: 4, expectedDefId: "draw-no-bet" },
  { id: 20, expectedDefId: "draw-no-bet" },
  { id: 77, expectedDefId: "draw-no-bet" },

  // Total Goals
  { id: 25, expectedDefId: "total-goals" },
  { id: 8, expectedDefId: "total-goals" },
  { id: 11, expectedDefId: "total-goals" },
  { id: 23, expectedDefId: "total-goals" },
  { id: 28, expectedDefId: "total-goals" },
  { id: 73, expectedDefId: "total-goals" },
  { id: 74, expectedDefId: "total-goals" },
  { id: 75, expectedDefId: "total-goals" },
  { id: 80, expectedDefId: "total-goals" },
  { id: 103, expectedDefId: "total-goals" },
  { id: 104, expectedDefId: "total-goals" },
  { id: 105, expectedDefId: "total-goals" },

  // BTTS
  { id: 43, expectedDefId: "btts" },
  { id: 47, expectedDefId: "btts" },
  { id: 48, expectedDefId: "btts" },
  { id: 59, expectedDefId: "btts" },
  { id: 60, expectedDefId: "btts" },
  { id: 61, expectedDefId: "btts" },
  { id: 62, expectedDefId: "btts" },
  { id: 67, expectedDefId: "btts" },
  { id: 68, expectedDefId: "btts" },
  { id: 69, expectedDefId: "btts" },
  { id: 70, expectedDefId: "btts" },
  { id: 95, expectedDefId: "btts" },
  { id: 107, expectedDefId: "btts" },
  { id: 109, expectedDefId: "btts" },
  { id: 110, expectedDefId: "btts" },
  { id: 112, expectedDefId: "btts" },
  { id: 115, expectedDefId: "btts" },
  { id: 118, expectedDefId: "btts" },
  { id: 120, expectedDefId: "btts" },
  { id: 121, expectedDefId: "btts" },
  { id: 1232, expectedDefId: "btts" },
  { id: 1233, expectedDefId: "btts" },
  { id: 1234, expectedDefId: "btts" },
  { id: 1235, expectedDefId: "btts" },
  { id: 1224, expectedDefId: "btts" },
  { id: 1229, expectedDefId: "btts" },
  { id: 1855, expectedDefId: "btts" },
  { id: 196, expectedDefId: "btts" },
  { id: 197, expectedDefId: "btts" },
  { id: 198, expectedDefId: "btts" },
  { id: 217, expectedDefId: "btts" },

  // Half Time Result
  { id: 5, expectedDefId: "half-time-result" },

  // Half Time Total Goals
  { id: 26, expectedDefId: "half-time-total-goals" },
  { id: 31, expectedDefId: "half-time-total-goals" },
  { id: 82, expectedDefId: "half-time-total-goals" },
  { id: 85, expectedDefId: "half-time-total-goals" },
  { id: 88, expectedDefId: "half-time-total-goals" },

  // Correct Score
  { id: 9, expectedDefId: "correct-score" },
  { id: 17, expectedDefId: "correct-score" },
  { id: 33, expectedDefId: "correct-score" },
  { id: 49, expectedDefId: "correct-score" },
  { id: 57, expectedDefId: "correct-score" },
  { id: 98, expectedDefId: "correct-score" },
  { id: 101, expectedDefId: "correct-score" },
  { id: 124, expectedDefId: "correct-score" },
  { id: 125, expectedDefId: "correct-score" },
  { id: 126, expectedDefId: "correct-score" },

  // European Handicap
  { id: 14, expectedDefId: "european-handicap" },
  { id: 22, expectedDefId: "european-handicap" },
  { id: 76, expectedDefId: "european-handicap" },
  { id: 79, expectedDefId: "european-handicap" },

  // Win to Nil
  { id: 35, expectedDefId: "win-to-nil" },
  { id: 90, expectedDefId: "win-to-nil" },

  // Clean Sheet
  { id: 36, expectedDefId: "clean-sheet" },

  // Goalscorer Anytime
  { id: 52, expectedDefId: "goalscorer-anytime" },

  // Player Shots
  { id: 53, expectedDefId: "player-shots" },

  // Player Cards
  { id: 54, expectedDefId: "player-cards" },

  // Result & BTTS
  { id: 50, expectedDefId: "result-and-btts" },

  // Result & Total
  { id: 51, expectedDefId: "result-and-total" },
  { id: 99, expectedDefId: "result-and-total" },
  { id: 807, expectedDefId: "result-and-total" },
  { id: 808, expectedDefId: "result-and-total" },
  { id: 809, expectedDefId: "result-and-total" },
  { id: 810, expectedDefId: "result-and-total" },
  { id: 811, expectedDefId: "result-and-total" },
  { id: 812, expectedDefId: "result-and-total" },
  { id: 813, expectedDefId: "result-and-total" },
  { id: 814, expectedDefId: "result-and-total" },
  { id: 815, expectedDefId: "result-and-total" },
  { id: 816, expectedDefId: "result-and-total" },
  { id: 817, expectedDefId: "result-and-total" },
  { id: 818, expectedDefId: "result-and-total" },

  // Half Time / Full Time
  { id: 1012, expectedDefId: "halftime-fulltime" },
];

// ============================================================================
// Expected Normalization Results
// ============================================================================

export const EXPECTED_RESULTS = {
  matchWinner: {
    normalizedType: "MATCH_WINNER",
    category: "WYNIK_MECZU",
  },
  doubleChance: {
    normalizedType: "DOUBLE_CHANCE",
    category: "WYNIK_MECZU",
  },
  drawNoBet: {
    normalizedType: "DRAW_NO_BET",
    category: "WYNIK_MECZU",
  },
  totalGoals: {
    normalizedType: "TOTAL_GOALS",
    category: "GOLE",
    paramValue: "2.5",
  },
  btts: {
    normalizedType: "BTTS",
    category: "GOLE",
  },
  asianHandicap: {
    normalizedType: "ASIAN_HANDICAP",
    category: "HANDICAP",
  },
  europeanHandicap: {
    normalizedType: "EUROPEAN_HANDICAP",
    category: "HANDICAP",
  },
  halfTimeResult: {
    normalizedType: "HALF_TIME_RESULT",
    category: "PIERWSZA_POLOWA",
  },
  halfTimeTotalGoals: {
    normalizedType: "HALF_TIME_TOTAL_GOALS",
    category: "PIERWSZA_POLOWA",
  },
  halfTimeBtts: {
    normalizedType: "HALF_TIME_BTTS",
    category: "PIERWSZA_POLOWA",
  },
  correctScore: {
    normalizedType: "CORRECT_SCORE",
    category: "DOKLADNY_WYNIK",
  },
  goalscorerAnytime: {
    normalizedType: "GOALSCORER_ANYTIME",
    category: "ZAWODNICY",
  },
  goalscorerFirst: {
    normalizedType: "GOALSCORER_FIRST",
    category: "ZAWODNICY",
  },
  goalscorerLast: {
    normalizedType: "GOALSCORER_LAST",
    category: "ZAWODNICY",
  },
  playerShots: {
    normalizedType: "PLAYER_SHOTS",
    category: "ZAWODNICY",
  },
  playerCards: {
    normalizedType: "PLAYER_CARDS",
    category: "ZAWODNICY",
  },
  playerAssists: {
    normalizedType: "PLAYER_ASSISTS",
    category: "ZAWODNICY",
  },
  cornersTotal: {
    normalizedType: "CORNERS_TOTAL",
    category: "STATYSTYKI",
  },
  cardsTotal: {
    normalizedType: "CARDS_TOTAL",
    category: "STATYSTYKI",
  },
  foulsTotal: {
    normalizedType: "FOULS_TOTAL",
    category: "STATYSTYKI",
  },
  offsidesTotal: {
    normalizedType: "OFFSIDES_TOTAL",
    category: "STATYSTYKI",
  },
  resultAndBtts: {
    normalizedType: "RESULT_AND_BTTS",
    category: "KOMBINACJE",
  },
  resultAndTotal: {
    normalizedType: "RESULT_AND_TOTAL",
    category: "KOMBINACJE",
  },
  halftimeFulltime: {
    normalizedType: "HALFTIME_FULLTIME",
    category: "KOMBINACJE",
  },
  doubleResult: {
    normalizedType: "DOUBLE_RESULT",
    category: "KOMBINACJE",
  },
  other: {
    normalizedType: "OTHER",
    category: "INNE",
  },
};
