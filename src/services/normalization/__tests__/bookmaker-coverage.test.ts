import { describe, it, expect } from "vitest";
import { normalizer } from "../index.js";
import { MarketCategory, type NormalizedMarketType } from "../types.js";

const SCRAPER_TYPE_TO_NORMALIZED: Record<string, string> = {
  "1X2": "MATCH_WINNER",
  DOUBLE_CHANCE: "DOUBLE_CHANCE",
  DRAW_NO_BET: "DRAW_NO_BET",
  BTTS: "BTTS",
  OVER_UNDER: "TOTAL_GOALS",
  ASIAN_HANDICAP: "ASIAN_HANDICAP",
  EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
  HANDICAP: "EUROPEAN_HANDICAP",
  HALF_TIME_1X2: "HALF_TIME_RESULT",
  HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
  HALF_TIME_BTTS: "HALF_TIME_BTTS",
  CORRECT_SCORE: "CORRECT_SCORE",
  ODD_EVEN: "ODD_EVEN_GOALS",
  WIN_TO_NIL: "WIN_TO_NIL",
  CLEAN_SHEET: "CLEAN_SHEET",
  TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
  TEAM_GOALS: "TEAM_TOTAL_GOALS",
  HOME_TEAM_OVER_UNDER: "TEAM_TOTAL_GOALS",
  AWAY_TEAM_OVER_UNDER: "TEAM_TOTAL_GOALS",
  HOME_TOTAL: "TEAM_TOTAL_GOALS",
  AWAY_TOTAL: "TEAM_TOTAL_GOALS",
  GOAL_RANGE: "GOAL_RANGE",
  EXACT_GOALS: "GOAL_RANGE",
  TOTAL_GOALS_EXACT: "GOAL_RANGE",
  HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
  HT_FT: "HALFTIME_FULLTIME",
  HALF_FULL_TIME: "HALFTIME_FULLTIME",
  HALF_TIME_FULL_TIME: "HALFTIME_FULLTIME",
  HALF_MATCH: "HALFTIME_FULLTIME",
  GOALSCORER: "GOALSCORER_ANYTIME",
  GOAL_SCORER: "GOALSCORER_ANYTIME",
  ANYTIME_SCORER: "GOALSCORER_ANYTIME",
  FIRST_GOALSCORER: "GOALSCORER_FIRST",
  FIRST_TO_SCORE: "GOALSCORER_FIRST",
  FIRST_GOAL: "GOALSCORER_FIRST",
  LAST_GOALSCORER: "GOALSCORER_LAST",
  LAST_TO_SCORE: "GOALSCORER_LAST",
  LAST_GOAL: "GOALSCORER_LAST",
  CORNERS: "CORNERS_TOTAL",
  CARDS: "CARDS_TOTAL",
  RESULT_BTTS: "RESULT_AND_BTTS",
  RESULT_TOTAL: "RESULT_AND_TOTAL",
  RESULT_OVER_UNDER: "RESULT_AND_TOTAL",
  PLAYER_CARDS: "PLAYER_CARDS",
  PLAYER_SHOTS: "PLAYER_SHOTS",
  PLAYER_ASSISTS: "PLAYER_ASSISTS",
  WIN_MARGIN: "WINNING_MARGIN",
  WINNING_MARGIN: "WINNING_MARGIN",
  BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
  GOAL_BOTH_HALVES: "BOTH_HALVES_GOALS",
  GOALS_BOTH_HALVES: "BOTH_HALVES_GOALS",
  SECOND_HALF_1X2: "SECOND_HALF_RESULT",
  SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
  DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
  DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
  DOUBLE_CHANCE_OVER_UNDER: "DOUBLE_CHANCE_TOTAL",
  HOME_TO_SCORE: "HOME_TEAM_TO_SCORE",
  home_to_score: "HOME_TEAM_TO_SCORE",
  AWAY_TO_SCORE: "AWAY_TEAM_TO_SCORE",
  away_to_score: "AWAY_TEAM_TO_SCORE",
  player_shots: "PLAYER_SHOTS",
  player_cards: "PLAYER_CARDS",
  player_assists: "PLAYER_ASSISTS",
  CORNERS_TEAM: "CORNERS_TEAM",
  corners_team: "CORNERS_TEAM",
  CARDS_TEAM: "CARDS_TEAM",
  cards_team: "CARDS_TEAM",
  FOULS: "FOULS_TOTAL",
  fouls: "FOULS_TOTAL",
  OFFSIDES: "OFFSIDES_TOTAL",
  offsides: "OFFSIDES_TOTAL",
  DOUBLE_RESULT: "DOUBLE_RESULT",
  double_result: "DOUBLE_RESULT",
  HOME_CLEAN_SHEET: "CLEAN_SHEET",
  AWAY_CLEAN_SHEET: "CLEAN_SHEET",
  HOME_WIN_TO_NIL: "WIN_TO_NIL",
  AWAY_WIN_TO_NIL: "WIN_TO_NIL",
  P1XP2: "MATCH_WINNER",
  "1X12X2": "DOUBLE_CHANCE",
  P1XP2DC: "DOUBLE_CHANCE",
  OverUnder: "TOTAL_GOALS",
  BothTeamsToScore: "BTTS",
  P1XP2FirstHalf: "HALF_TIME_RESULT",
  HalfTimeOverUnder: "HALF_TIME_TOTAL_GOALS",
  BothTeamsToScoreFirstHalf: "HALF_TIME_BTTS",
  Team1OverUnder: "TEAM_TOTAL_GOALS",
  Team2OverUnder: "TEAM_TOTAL_GOALS",
  TEAM_OVER_UNDER: "TEAM_TOTAL_GOALS",
  AsianHandicap: "ASIAN_HANDICAP",
  EuropeanHandicap: "EUROPEAN_HANDICAP",
  CorrectScore: "CORRECT_SCORE",
  DrawNoBet: "DRAW_NO_BET",
  OddEven: "ODD_EVEN_GOALS",
  WinToNil: "WIN_TO_NIL",
  CleanSheet: "CLEAN_SHEET",
  HalftimeFulltime: "HALFTIME_FULLTIME",
};

function normalizeScraperType(scraperType: string): string | undefined {
  return SCRAPER_TYPE_TO_NORMALIZED[scraperType];
}

const ALL_NORMALIZED_TYPES: NormalizedMarketType[] = [
  "MATCH_WINNER",
  "DOUBLE_CHANCE",
  "DRAW_NO_BET",
  "TOTAL_GOALS",
  "BTTS",
  "ODD_EVEN_GOALS",
  "WIN_TO_NIL",
  "CLEAN_SHEET",
  "HOME_TEAM_TO_SCORE",
  "AWAY_TEAM_TO_SCORE",
  "TEAM_TOTAL_GOALS",
  "GOAL_RANGE",
  "BOTH_HALVES_GOALS",
  "WINNING_MARGIN",
  "ASIAN_HANDICAP",
  "EUROPEAN_HANDICAP",
  "HALF_TIME_RESULT",
  "HALF_TIME_TOTAL_GOALS",
  "HALF_TIME_BTTS",
  "SECOND_HALF_RESULT",
  "SECOND_HALF_TOTAL_GOALS",
  "CORRECT_SCORE",
  "GOALSCORER_FIRST",
  "GOALSCORER_LAST",
  "GOALSCORER_ANYTIME",
  "PLAYER_SHOTS",
  "PLAYER_CARDS",
  "PLAYER_ASSISTS",
  "CORNERS_TOTAL",
  "CORNERS_TEAM",
  "CARDS_TOTAL",
  "CARDS_TEAM",
  "FOULS_TOTAL",
  "OFFSIDES_TOTAL",
  "RESULT_AND_BTTS",
  "RESULT_AND_TOTAL",
  "HALFTIME_FULLTIME",
  "DOUBLE_RESULT",
  "DOUBLE_CHANCE_BTTS",
  "DOUBLE_CHANCE_TOTAL",
];

const ALL_CATEGORIES = Object.values(MarketCategory);

interface BookmakerTestCase {
  bookmaker: string;
  scraperTypes: Record<string, string>;
  marketNames: Record<string, string>;
  selectionFormats: Record<string, string[]>;
}

const BOOKMAKER_TEST_DATA: BookmakerTestCase[] = [
  {
    bookmaker: "superbet",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      BTTS: "BTTS",
      OVER_UNDER: "TOTAL_GOALS",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      CORRECT_SCORE: "CORRECT_SCORE",
      DRAW_NO_BET: "DRAW_NO_BET",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      GOAL_SCORER: "GOALSCORER_ANYTIME",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      PLAYER_CARDS: "PLAYER_CARDS",
    },
    marketNames: {
      "Wynik meczu": "MATCH_WINNER",
      "Podwójna szansa": "DOUBLE_CHANCE",
      "Obie drużyny strzelą": "BTTS",
      "Liczba goli 2.5": "TOTAL_GOALS",
      "Handicap azjatycki": "ASIAN_HANDICAP",
      "Handicap europejski": "EUROPEAN_HANDICAP",
      "Wynik 1. połowy": "HALF_TIME_RESULT",
      "Dokładny wynik": "CORRECT_SCORE",
    },
    selectionFormats: {
      "1X2": ["1", "X", "2"],
      BTTS: ["Tak", "Nie"],
      OVER_UNDER: ["Over 2.5", "Under 2.5"],
    },
  },
  {
    bookmaker: "sts",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      BTTS: "BTTS",
      OVER_UNDER: "TOTAL_GOALS",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      CORRECT_SCORE: "CORRECT_SCORE",
      DRAW_NO_BET: "DRAW_NO_BET",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      GOALSCORER: "GOALSCORER_ANYTIME",
      HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      PLAYER_SHOTS: "PLAYER_SHOTS",
      PLAYER_CARDS: "PLAYER_CARDS",
    },
    marketNames: {
      "Rynek 1": "MATCH_WINNER",
      "Rynek 10": "DOUBLE_CHANCE",
      "Rynek 25": "TOTAL_GOALS",
      "Rynek 43": "BTTS",
      "Rynek 5": "HALF_TIME_RESULT",
      "Rynek 9": "GOALSCORER_LAST",
      "Rynek 4": "DRAW_NO_BET",
    },
    selectionFormats: {
      "1X2": ["1", "X", "2"],
      BTTS: ["Tak", "Nie"],
      OVER_UNDER: ["+2.5", "-2.5"],
    },
  },
  {
    bookmaker: "fortuna",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      BTTS: "BTTS",
      OVER_UNDER: "TOTAL_GOALS",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
      CORRECT_SCORE: "CORRECT_SCORE",
      DRAW_NO_BET: "DRAW_NO_BET",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
      GOAL_RANGE: "GOAL_RANGE",
      HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      GOALSCORER: "GOALSCORER_ANYTIME",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      WIN_MARGIN: "WINNING_MARGIN",
    },
    marketNames: {
      "Wynik meczu": "MATCH_WINNER",
      "Mecz: dwójtyp": "DOUBLE_CHANCE",
      "Mecz: obie drużyny strzelą gola": "BTTS",
      "Suma goli 2.5": "TOTAL_GOALS",
      "Liczba goli 2.5": "TOTAL_GOALS",
      "Wynik 1. połowy": "HALF_TIME_RESULT",
      "Dokładny wynik": "CORRECT_SCORE",
      "Remis = zwrot": "DRAW_NO_BET",
    },
    selectionFormats: {
      "1X2": ["1", "0", "2"],
      BTTS: ["Tak", "Nie"],
      DOUBLE_CHANCE: ["10", "02", "12"],
    },
  },
  {
    bookmaker: "betclic",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      BTTS: "BTTS",
      OVER_UNDER: "TOTAL_GOALS",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      CORRECT_SCORE: "CORRECT_SCORE",
      HANDICAP: "EUROPEAN_HANDICAP",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
      GOAL_RANGE: "GOAL_RANGE",
      HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
      GOALSCORER: "GOALSCORER_ANYTIME",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      WIN_MARGIN: "WINNING_MARGIN",
    },
    marketNames: {
      "Wynik meczu": "MATCH_WINNER",
      "Mecz - podwójna szansa": "DOUBLE_CHANCE",
      "Obie drużyny strzelą gola": "BTTS",
      "Liczba goli": "TOTAL_GOALS",
    },
    selectionFormats: {
      "1X2": ["1", "Remis", "2"],
      BTTS: ["Tak", "Nie"],
      OVER_UNDER: ["Powyżej 2.5", "Poniżej 2.5"],
    },
  },
  {
    bookmaker: "lvbet",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      BTTS: "BTTS",
      OVER_UNDER: "TOTAL_GOALS",
      DRAW_NO_BET: "DRAW_NO_BET",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      CORRECT_SCORE: "CORRECT_SCORE",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
      GOAL_RANGE: "GOAL_RANGE",
      HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      GOALSCORER: "GOALSCORER_ANYTIME",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
      HOME_TO_SCORE: "HOME_TEAM_TO_SCORE",
      AWAY_TO_SCORE: "AWAY_TEAM_TO_SCORE",
      PLAYER_SHOTS: "PLAYER_SHOTS",
      PLAYER_CARDS: "PLAYER_CARDS",
      PLAYER_ASSISTS: "PLAYER_ASSISTS",
      CORNERS_TEAM: "CORNERS_TEAM",
      CARDS_TEAM: "CARDS_TEAM",
      FOULS: "FOULS_TOTAL",
      OFFSIDES: "OFFSIDES_TOTAL",
      DOUBLE_RESULT: "DOUBLE_RESULT",
      home_to_score: "HOME_TEAM_TO_SCORE",
      away_to_score: "AWAY_TEAM_TO_SCORE",
      player_shots: "PLAYER_SHOTS",
      player_cards: "PLAYER_CARDS",
      player_assists: "PLAYER_ASSISTS",
      corners_team: "CORNERS_TEAM",
      cards_team: "CARDS_TEAM",
      fouls: "FOULS_TOTAL",
      offsides: "OFFSIDES_TOTAL",
      double_result: "DOUBLE_RESULT",
    },
    marketNames: {
      "Zwycięzca meczu": "MATCH_WINNER",
      "Wynik meczu": "MATCH_WINNER",
      Szansa: "DOUBLE_CHANCE",
      Dwójtyp: "DOUBLE_CHANCE",
      "Suma goli": "TOTAL_GOALS",
      "Liczba goli": "TOTAL_GOALS",
      "Obie drużyny strzelą": "BTTS",
    },
    selectionFormats: {
      "1X2": ["1", "X", "2"],
      BTTS: ["Tak", "Nie"],
    },
  },
  {
    bookmaker: "fuksiarz",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      OVER_UNDER: "TOTAL_GOALS",
      BTTS: "BTTS",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      CORRECT_SCORE: "CORRECT_SCORE",
      DRAW_NO_BET: "DRAW_NO_BET",
      EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
      GOAL_RANGE: "GOAL_RANGE",
      HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      GOALSCORER: "GOALSCORER_ANYTIME",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      WIN_MARGIN: "WINNING_MARGIN",
    },
    marketNames: {
      "Wynik meczu": "MATCH_WINNER",
      "Podwójna szansa": "DOUBLE_CHANCE",
      "Liczba goli": "TOTAL_GOALS",
      "Obie drużyny strzelą": "BTTS",
    },
    selectionFormats: {
      "1X2": ["1", "X", "2"],
      BTTS: ["Tak", "Nie"],
    },
  },
  {
    bookmaker: "betcris",
    scraperTypes: {
      P1XP2: "MATCH_WINNER",
      "1X12X2": "DOUBLE_CHANCE",
      P1XP2DC: "DOUBLE_CHANCE",
      OverUnder: "TOTAL_GOALS",
      BothTeamsToScore: "BTTS",
      P1XP2FirstHalf: "HALF_TIME_RESULT",
      HalfTimeOverUnder: "HALF_TIME_TOTAL_GOALS",
      BothTeamsToScoreFirstHalf: "HALF_TIME_BTTS",
      Team1OverUnder: "TEAM_TOTAL_GOALS",
      Team2OverUnder: "TEAM_TOTAL_GOALS",
      TEAM_OVER_UNDER: "TEAM_TOTAL_GOALS",
      AsianHandicap: "ASIAN_HANDICAP",
      EuropeanHandicap: "EUROPEAN_HANDICAP",
      CorrectScore: "CORRECT_SCORE",
      DrawNoBet: "DRAW_NO_BET",
      OddEven: "ODD_EVEN_GOALS",
      WinToNil: "WIN_TO_NIL",
      CleanSheet: "CLEAN_SHEET",
      HalftimeFulltime: "HALFTIME_FULLTIME",
      HALF_TIME_FULL_TIME: "HALFTIME_FULLTIME",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      GOAL_RANGE: "GOAL_RANGE",
      GOALSCORER: "GOALSCORER_ANYTIME",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      WIN_MARGIN: "WINNING_MARGIN",
    },
    marketNames: {},
    selectionFormats: {
      "1X2": ["W1", "X", "W2"],
      BTTS: ["Yes", "No"],
      OVER_UNDER: ["Over", "Under"],
    },
  },
  {
    bookmaker: "betfan",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      DRAW_NO_BET: "DRAW_NO_BET",
      OVER_UNDER: "TOTAL_GOALS",
      BTTS: "BTTS",
      EXACT_GOALS: "GOAL_RANGE",
      ODD_EVEN: "ODD_EVEN_GOALS",
      TEAM_GOALS: "TEAM_TOTAL_GOALS",
      HOME_TEAM_OVER_UNDER: "TEAM_TOTAL_GOALS",
      AWAY_TEAM_OVER_UNDER: "TEAM_TOTAL_GOALS",
      CLEAN_SHEET: "CLEAN_SHEET",
      WIN_MARGIN: "WINNING_MARGIN",
      HANDICAP: "EUROPEAN_HANDICAP",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
      CORRECT_SCORE: "CORRECT_SCORE",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      WIN_TO_NIL: "WIN_TO_NIL",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      GOALSCORER: "GOALSCORER_ANYTIME",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
    },
    marketNames: {
      Mecz: "MATCH_WINNER",
      "Podwójna szansa": "DOUBLE_CHANCE",
      "Remis = zwrot": "DRAW_NO_BET",
      "Liczba goli": "TOTAL_GOALS",
      "Obie drużyny strzelą": "BTTS",
    },
    selectionFormats: {
      "1X2": ["1", "X", "2"],
      BTTS: ["Tak", "Nie"],
    },
  },
  {
    bookmaker: "etoto",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      OVER_UNDER: "TOTAL_GOALS",
      BTTS: "BTTS",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      CORRECT_SCORE: "CORRECT_SCORE",
      DRAW_NO_BET: "DRAW_NO_BET",
      EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      ODD_EVEN: "ODD_EVEN_GOALS",
      HALF_FULL_TIME: "HALFTIME_FULLTIME",
      WINNING_MARGIN: "WINNING_MARGIN",
      HOME_TOTAL: "TEAM_TOTAL_GOALS",
      AWAY_TOTAL: "TEAM_TOTAL_GOALS",
      FIRST_TO_SCORE: "GOALSCORER_FIRST",
      LAST_TO_SCORE: "GOALSCORER_LAST",
      HOME_WIN_TO_NIL: "WIN_TO_NIL",
      AWAY_WIN_TO_NIL: "WIN_TO_NIL",
      GOAL_RANGE: "GOAL_RANGE",
      EXACT_GOALS: "GOAL_RANGE",
      CLEAN_SHEET: "CLEAN_SHEET",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      GOALSCORER: "GOALSCORER_ANYTIME",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
    },
    marketNames: {},
    selectionFormats: {},
  },
  {
    bookmaker: "forbet",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      OVER_UNDER: "TOTAL_GOALS",
      BTTS: "BTTS",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      CORRECT_SCORE: "CORRECT_SCORE",
      HALF_TIME_FULL_TIME: "HALFTIME_FULLTIME",
      DRAW_NO_BET: "DRAW_NO_BET",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
      TOTAL_GOALS_EXACT: "GOAL_RANGE",
      WIN_MARGIN: "WINNING_MARGIN",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      GOALSCORER: "GOALSCORER_ANYTIME",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
    },
    marketNames: {
      "Poniżej/powyżej 2.5 goli": "TOTAL_GOALS",
    },
    selectionFormats: {},
  },
  {
    bookmaker: "totalbet",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      OVER_UNDER: "TOTAL_GOALS",
      BTTS: "BTTS",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      CORRECT_SCORE: "CORRECT_SCORE",
      DRAW_NO_BET: "DRAW_NO_BET",
      EUROPEAN_HANDICAP: "EUROPEAN_HANDICAP",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
      GOAL_RANGE: "GOAL_RANGE",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      WINNING_MARGIN: "WINNING_MARGIN",
      HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      GOALSCORER: "GOALSCORER_ANYTIME",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
    },
    marketNames: {},
    selectionFormats: {},
  },
  {
    bookmaker: "pzbuk",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      OVER_UNDER: "TOTAL_GOALS",
      BTTS: "BTTS",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      CORRECT_SCORE: "CORRECT_SCORE",
      DRAW_NO_BET: "DRAW_NO_BET",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      HANDICAP: "EUROPEAN_HANDICAP",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      HT_FT: "HALFTIME_FULLTIME",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      HOME_TEAM_OVER_UNDER: "TEAM_TOTAL_GOALS",
      AWAY_TEAM_OVER_UNDER: "TEAM_TOTAL_GOALS",
      GOAL_RANGE: "GOAL_RANGE",
      GOALS_BOTH_HALVES: "BOTH_HALVES_GOALS",
      HOME_CLEAN_SHEET: "CLEAN_SHEET",
      AWAY_CLEAN_SHEET: "CLEAN_SHEET",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_OVER_UNDER: "RESULT_AND_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_OVER_UNDER: "DOUBLE_CHANCE_TOTAL",
      FIRST_GOAL: "GOALSCORER_FIRST",
      LAST_GOAL: "GOALSCORER_LAST",
      ANYTIME_SCORER: "GOALSCORER_ANYTIME",
      WIN_MARGIN: "WINNING_MARGIN",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      HOME_TO_SCORE: "HOME_TEAM_TO_SCORE",
      AWAY_TO_SCORE: "AWAY_TEAM_TO_SCORE",
      PLAYER_SHOTS: "PLAYER_SHOTS",
      PLAYER_CARDS: "PLAYER_CARDS",
      PLAYER_ASSISTS: "PLAYER_ASSISTS",
      CORNERS_TEAM: "CORNERS_TEAM",
      CARDS_TEAM: "CARDS_TEAM",
      FOULS: "FOULS_TOTAL",
      OFFSIDES: "OFFSIDES_TOTAL",
      DOUBLE_RESULT: "DOUBLE_RESULT",
      home_to_score: "HOME_TEAM_TO_SCORE",
      away_to_score: "AWAY_TEAM_TO_SCORE",
      player_shots: "PLAYER_SHOTS",
      player_cards: "PLAYER_CARDS",
      player_assists: "PLAYER_ASSISTS",
      corners_team: "CORNERS_TEAM",
      cards_team: "CARDS_TEAM",
      fouls: "FOULS_TOTAL",
      offsides: "OFFSIDES_TOTAL",
      double_result: "DOUBLE_RESULT",
    },
    marketNames: {},
    selectionFormats: {
      "1X2": ["Home", "Tie", "Away"],
      BTTS: ["Yes", "No"],
    },
  },
  {
    bookmaker: "lebull",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      OVER_UNDER: "TOTAL_GOALS",
      BTTS: "BTTS",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      CORRECT_SCORE: "CORRECT_SCORE",
      DRAW_NO_BET: "DRAW_NO_BET",
      HANDICAP: "EUROPEAN_HANDICAP",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      ODD_EVEN: "ODD_EVEN_GOALS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
      GOAL_RANGE: "GOAL_RANGE",
      HALFTIME_FULLTIME: "HALFTIME_FULLTIME",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
      GOALSCORER: "GOALSCORER_ANYTIME",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      BOTH_HALVES_GOALS: "BOTH_HALVES_GOALS",
      WIN_MARGIN: "WINNING_MARGIN",
    },
    marketNames: {},
    selectionFormats: {},
  },
  {
    bookmaker: "betters",
    scraperTypes: {
      "1X2": "MATCH_WINNER",
      DOUBLE_CHANCE: "DOUBLE_CHANCE",
      OVER_UNDER: "TOTAL_GOALS",
      BTTS: "BTTS",
      DRAW_NO_BET: "DRAW_NO_BET",
      CORRECT_SCORE: "CORRECT_SCORE",
      HANDICAP: "EUROPEAN_HANDICAP",
      ASIAN_HANDICAP: "ASIAN_HANDICAP",
      HALF_TIME_1X2: "HALF_TIME_RESULT",
      HALF_TIME_OVER_UNDER: "HALF_TIME_TOTAL_GOALS",
      HALF_MATCH: "HALFTIME_FULLTIME",
      ODD_EVEN: "ODD_EVEN_GOALS",
      GOAL_BOTH_HALVES: "BOTH_HALVES_GOALS",
      HALF_TIME_BTTS: "HALF_TIME_BTTS",
      WIN_TO_NIL: "WIN_TO_NIL",
      CLEAN_SHEET: "CLEAN_SHEET",
      TEAM_TOTAL_GOALS: "TEAM_TOTAL_GOALS",
      GOAL_RANGE: "GOAL_RANGE",
      WIN_MARGIN: "WINNING_MARGIN",
      SECOND_HALF_1X2: "SECOND_HALF_RESULT",
      SECOND_HALF_OVER_UNDER: "SECOND_HALF_TOTAL_GOALS",
      GOALSCORER: "GOALSCORER_ANYTIME",
      FIRST_GOALSCORER: "GOALSCORER_FIRST",
      LAST_GOALSCORER: "GOALSCORER_LAST",
      RESULT_BTTS: "RESULT_AND_BTTS",
      RESULT_TOTAL: "RESULT_AND_TOTAL",
      DOUBLE_CHANCE_BTTS: "DOUBLE_CHANCE_BTTS",
      DOUBLE_CHANCE_TOTAL: "DOUBLE_CHANCE_TOTAL",
      CORNERS: "CORNERS_TOTAL",
      CARDS: "CARDS_TOTAL",
      HOME_TO_SCORE: "HOME_TEAM_TO_SCORE",
      AWAY_TO_SCORE: "AWAY_TEAM_TO_SCORE",
      PLAYER_SHOTS: "PLAYER_SHOTS",
      PLAYER_CARDS: "PLAYER_CARDS",
      PLAYER_ASSISTS: "PLAYER_ASSISTS",
      CORNERS_TEAM: "CORNERS_TEAM",
      CARDS_TEAM: "CARDS_TEAM",
      FOULS: "FOULS_TOTAL",
      OFFSIDES: "OFFSIDES_TOTAL",
      DOUBLE_RESULT: "DOUBLE_RESULT",
    },
    marketNames: {},
    selectionFormats: {},
  },
];

describe("Scraper Type Mapping Coverage", () => {
  describe("All bookmaker scraper types should map correctly", () => {
    for (const { bookmaker, scraperTypes } of BOOKMAKER_TEST_DATA) {
      describe(bookmaker, () => {
        for (const [scraperType, expectedNormalized] of Object.entries(scraperTypes)) {
          it(`${scraperType} -> ${expectedNormalized}`, () => {
            const result = normalizeScraperType(scraperType);
            expect(result).toBe(expectedNormalized);
          });
        }
      });
    }
  });
});

describe("Market Name Pattern Matching Coverage", () => {
  describe("Superbet market names should normalize correctly", () => {
    const superbetMarketNames: Record<string, string> = {
      "Wynik meczu": "MATCH_WINNER",
      "Podwójna szansa": "DOUBLE_CHANCE",
      "Obie drużyny strzelą": "BTTS",
      "Liczba goli 2.5": "TOTAL_GOALS",
      "Handicap azjatycki": "ASIAN_HANDICAP",
      "Handicap europejski": "EUROPEAN_HANDICAP",
      "Wynik 1. polowy": "HALF_TIME_RESULT",
      "Dokladny wynik": "CORRECT_SCORE",
    };

    for (const [marketName, expectedType] of Object.entries(superbetMarketNames)) {
      it(`"${marketName}" -> ${expectedType}`, () => {
        const result = normalizer.normalize(
          {
            name: marketName,
            selections: [{ name: "Test", odds: 1.5 }],
          },
          "superbet",
          "Team A",
          "Team B"
        );
        expect(result.normalizedType).toBe(expectedType);
      });
    }
  });

  describe("STS Rynek markets should normalize correctly", () => {
    const stsMarketNames: Record<string, string> = {
      "Rynek 1": "MATCH_WINNER",
      "Rynek 10": "DOUBLE_CHANCE",
      "Rynek 25": "TOTAL_GOALS",
      "Rynek 43": "BTTS",
      "Rynek 71": "HALF_TIME_RESULT",
      "Rynek 9": "GOALSCORER_LAST",
      "Rynek 4": "DRAW_NO_BET",
    };

    for (const [marketName, expectedType] of Object.entries(stsMarketNames)) {
      it(`"${marketName}" -> ${expectedType}`, () => {
        const result = normalizer.normalize(
          {
            name: marketName,
            selections: [{ name: "Test", odds: 1.5 }],
          },
          "sts",
          "Team A",
          "Team B"
        );
        expect(result.normalizedType).toBe(expectedType);
      });
    }
  });
});

describe("Market Category Assignment", () => {
  const categoryTests: Array<{ name: string; expectedType: NormalizedMarketType; category: MarketCategory }> = [
    { name: "Wynik meczu", expectedType: "MATCH_WINNER", category: MarketCategory.WYNIK_MECZU },
    { name: "Podwójna szansa", expectedType: "DOUBLE_CHANCE", category: MarketCategory.WYNIK_MECZU },
    { name: "Remis = zwrot", expectedType: "DRAW_NO_BET", category: MarketCategory.WYNIK_MECZU },
    { name: "Liczba goli 2.5", expectedType: "TOTAL_GOALS", category: MarketCategory.GOLE },
    { name: "Obie drużyny strzelą", expectedType: "BTTS", category: MarketCategory.GOLE },
    { name: "Parzyste/Nieparzyste", expectedType: "ODD_EVEN_GOALS", category: MarketCategory.GOLE },
    { name: "Wygrana do zera", expectedType: "WIN_TO_NIL", category: MarketCategory.GOLE },
    { name: "Czyste konto", expectedType: "CLEAN_SHEET", category: MarketCategory.GOLE },
    { name: "Handicap azjatycki", expectedType: "ASIAN_HANDICAP", category: MarketCategory.HANDICAP },
    { name: "Handicap europejski", expectedType: "EUROPEAN_HANDICAP", category: MarketCategory.HANDICAP },
    { name: "Wynik 1. polowy", expectedType: "HALF_TIME_RESULT", category: MarketCategory.PIERWSZA_POLOWA },
    { name: "Dokladny wynik", expectedType: "CORRECT_SCORE", category: MarketCategory.DOKLADNY_WYNIK },
    { name: "Strzelec gola", expectedType: "GOALSCORER_ANYTIME", category: MarketCategory.ZAWODNICY },
  ];

  for (const { name, expectedType, category } of categoryTests) {
    it(`${expectedType} should be in category ${category}`, () => {
      const market = {
        name,
        selections: [{ name: "Test", odds: 1.5 }],
      };
      const result = normalizer.normalize(market, "superbet", "Team A", "Team B");
      expect(result.normalizedType).toBe(expectedType);
      expect(result.category).toBe(category);
    });
  }
});

describe("Bookmaker Market Coverage Summary", () => {
  const coverageMap: Record<string, Set<string>> = {};

  for (const { bookmaker, scraperTypes } of BOOKMAKER_TEST_DATA) {
    coverageMap[bookmaker] = new Set(Object.values(scraperTypes));
  }

  it("should report market coverage per bookmaker", () => {
    const coreMarkets: NormalizedMarketType[] = [
      "MATCH_WINNER",
      "DOUBLE_CHANCE",
      "DRAW_NO_BET",
      "TOTAL_GOALS",
      "BTTS",
      "ASIAN_HANDICAP",
      "EUROPEAN_HANDICAP",
      "HALF_TIME_RESULT",
      "HALF_TIME_TOTAL_GOALS",
      "CORRECT_SCORE",
    ];

    const coverage: Record<string, { covered: number; total: number; missing: string[] }> = {};

    for (const [bookmaker, types] of Object.entries(coverageMap)) {
      const missing = coreMarkets.filter((m) => !types.has(m));
      coverage[bookmaker] = {
        covered: coreMarkets.length - missing.length,
        total: coreMarkets.length,
        missing,
      };
    }

    for (const [bookmaker, { covered, total }] of Object.entries(coverage)) {
      expect(covered).toBeGreaterThanOrEqual(4);
    }

    console.log("\n=== BOOKMAKER CORE MARKET COVERAGE ===");
    for (const [bookmaker, { covered, total, missing }] of Object.entries(coverage)) {
      const pct = ((covered / total) * 100).toFixed(0);
      console.log(`${bookmaker}: ${covered}/${total} (${pct}%)${missing.length > 0 ? ` - Missing: ${missing.join(", ")}` : ""}`);
    }
  });

  it("should report non-core market coverage per bookmaker", () => {
    const nonCoreMarkets: NormalizedMarketType[] = [
      "ODD_EVEN_GOALS",
      "WIN_TO_NIL",
      "CLEAN_SHEET",
      "TEAM_TOTAL_GOALS",
      "GOAL_RANGE",
      "BOTH_HALVES_GOALS",
      "WINNING_MARGIN",
      "HALF_TIME_BTTS",
      "SECOND_HALF_RESULT",
      "SECOND_HALF_TOTAL_GOALS",
      "GOALSCORER_FIRST",
      "GOALSCORER_LAST",
      "GOALSCORER_ANYTIME",
      "CORNERS_TOTAL",
      "CARDS_TOTAL",
      "RESULT_AND_BTTS",
      "RESULT_AND_TOTAL",
      "HALFTIME_FULLTIME",
      "DOUBLE_CHANCE_BTTS",
      "DOUBLE_CHANCE_TOTAL",
    ];

    const coverage: Record<string, { covered: number; total: number; missing: string[] }> = {};

    for (const [bookmaker, types] of Object.entries(coverageMap)) {
      const covered = nonCoreMarkets.filter((m) => types.has(m));
      const missing = nonCoreMarkets.filter((m) => !types.has(m));
      coverage[bookmaker] = {
        covered: covered.length,
        total: nonCoreMarkets.length,
        missing,
      };
    }

    console.log("\n=== BOOKMAKER NON-CORE MARKET COVERAGE ===");
    for (const [bookmaker, { covered, total, missing }] of Object.entries(coverage)) {
      const pct = ((covered / total) * 100).toFixed(0);
      console.log(`${bookmaker}: ${covered}/${total} (${pct}%)${missing.length > 0 ? ` - Missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}` : ""}`);
    }
  });

  it("should report extended market coverage per bookmaker", () => {
    const extendedMarkets: NormalizedMarketType[] = [
      "HOME_TEAM_TO_SCORE",
      "AWAY_TEAM_TO_SCORE",
      "PLAYER_SHOTS",
      "PLAYER_CARDS",
      "PLAYER_ASSISTS",
      "CORNERS_TEAM",
      "CARDS_TEAM",
      "FOULS_TOTAL",
      "OFFSIDES_TOTAL",
      "DOUBLE_RESULT",
    ];

    const coverage: Record<string, { covered: number; total: number; missing: string[] }> = {};

    for (const [bookmaker, types] of Object.entries(coverageMap)) {
      const covered = extendedMarkets.filter((m) => types.has(m));
      const missing = extendedMarkets.filter((m) => !types.has(m));
      coverage[bookmaker] = {
        covered: covered.length,
        total: extendedMarkets.length,
        missing,
      };
    }

    console.log("\n=== BOOKMAKER EXTENDED MARKET COVERAGE ===");
    for (const [bookmaker, { covered, total, missing }] of Object.entries(coverage)) {
      const pct = ((covered / total) * 100).toFixed(0);
      console.log(`${bookmaker}: ${covered}/${total} (${pct}%)${missing.length > 0 ? ` - Missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}` : ""}`);
    }
  });
});

describe("Selection Normalization by Bookmaker", () => {
  const selectionTests = [
    { input: "1", market: "Wynik meczu", expected: "HOME" },
    { input: "X", market: "Wynik meczu", expected: "DRAW" },
    { input: "2", market: "Wynik meczu", expected: "AWAY" },
    { input: "Tak", market: "Obie drużyny strzelą", expected: "YES" },
    { input: "Nie", market: "Obie drużyny strzelą", expected: "NO" },
    { input: "Yes", market: "BTTS", expected: "YES" },
    { input: "No", market: "BTTS", expected: "NO" },
    { input: "Over 2.5", market: "Liczba goli 2.5", expected: "OVER" },
    { input: "Under 2.5", market: "Liczba goli 2.5", expected: "UNDER" },
    { input: "Powyżej 2.5", market: "Liczba goli 2.5", expected: "OVER" },
    { input: "Poniżej 2.5", market: "Liczba goli 2.5", expected: "UNDER" },
    { input: "+2.5", market: "Liczba goli 2.5", expected: "OVER" },
    { input: "-2.5", market: "Liczba goli 2.5", expected: "UNDER" },
    { input: "1X", market: "Podwójna szansa", expected: "HOME_OR_DRAW" },
    { input: "X2", market: "Podwójna szansa", expected: "DRAW_OR_AWAY" },
    { input: "12", market: "Podwójna szansa", expected: "HOME_OR_AWAY" },
    { input: "10", market: "Podwójna szansa", expected: "HOME_OR_DRAW" },
    { input: "02", market: "Podwójna szansa", expected: "DRAW_OR_AWAY" },
    { input: "Home", market: "Wynik meczu", expected: "HOME" },
    { input: "Away", market: "Wynik meczu", expected: "AWAY" },
    { input: "Draw", market: "Wynik meczu", expected: "DRAW" },
    { input: "Remis", market: "Wynik meczu", expected: "DRAW" },
    { input: "GG", market: "Obie drużyny strzelą", expected: "YES" },
    { input: "NG", market: "Obie drużyny strzelą", expected: "NO" },
  ];

  for (const { input, market, expected } of selectionTests) {
    it(`"${input}" should normalize to ${expected}`, () => {
      const result = normalizer.normalize(
        {
          name: market,
          selections: [{ name: input, odds: 1.5 }],
        },
        "superbet",
        "Team A",
        "Team B"
      );
      expect(result.selections[0].normalizedName).toBe(expected);
    });
  }
});

describe("Pattern Matching Fallback", () => {
  it("should fall back to pattern matching for unknown market names", () => {
    const result = normalizer.normalize(
      {
        name: "Wynik meczu",
        selections: [{ name: "1", odds: 2.0 }],
      },
      "superbet",
      "Team A",
      "Team B"
    );
    expect(result.normalizedType).toBe("MATCH_WINNER");
  });
});

describe("Real-World Scraper Data Simulation", () => {
  describe("Superbet Market Names", () => {
    it("should handle Superbet market names", () => {
      const superbetMarkets = [
        { name: "Wynik meczu", expected: "MATCH_WINNER" },
        { name: "Podwójna szansa", expected: "DOUBLE_CHANCE" },
        { name: "Obie drużyny strzelą", expected: "BTTS" },
        { name: "Liczba goli 2.5", expected: "TOTAL_GOALS" },
        { name: "Handicap azjatycki", expected: "ASIAN_HANDICAP" },
        { name: "Dokladny wynik", expected: "CORRECT_SCORE" },
      ];

      for (const { name, expected } of superbetMarkets) {
        const result = normalizer.normalize(
          { name, selections: [{ name: "Test", odds: 1.5 }] },
          "superbet",
          "Team A",
          "Team B"
        );
        expect(result.normalizedType).toBe(expected);
      }
    });
  });
});

describe("Polish Market Name Variations (Superbet patterns)", () => {
  const polishVariations = [
    { name: "Wynik meczu", expected: "MATCH_WINNER" },
    { name: "Koncowy wynik", expected: "MATCH_WINNER" },
    { name: "Zwyciezca meczu", expected: "MATCH_WINNER" },
    { name: "1X2", expected: "MATCH_WINNER" },
    { name: "Podwójna szansa", expected: "DOUBLE_CHANCE" },
    { name: "Double chance", expected: "DOUBLE_CHANCE" },
    { name: "Remis = zwrot", expected: "DRAW_NO_BET" },
    { name: "Zaklad bez remisu", expected: "DRAW_NO_BET" },
    { name: "Draw no bet", expected: "DRAW_NO_BET" },
    { name: "Liczba goli 2.5", expected: "TOTAL_GOALS" },
    { name: "Suma goli 2.5", expected: "TOTAL_GOALS" },
    { name: "Over/Under 2.5", expected: "TOTAL_GOALS" },
    { name: "O/U 2.5", expected: "TOTAL_GOALS" },
    { name: "Obie drużyny strzelą", expected: "BTTS" },
    { name: "Obie drużyny strzelą gola", expected: "BTTS" },
    { name: "BTTS", expected: "BTTS" },
    { name: "GG/NG", expected: "BTTS" },
    { name: "Wynik 1. polowy", expected: "HALF_TIME_RESULT" },
    { name: "1. polowa wynik", expected: "HALF_TIME_RESULT" },
    { name: "Dokladny wynik", expected: "CORRECT_SCORE" },
    { name: "Correct score", expected: "CORRECT_SCORE" },
    { name: "Handicap azjatycki", expected: "ASIAN_HANDICAP" },
    { name: "Asian handicap", expected: "ASIAN_HANDICAP" },
    { name: "Handicap europejski", expected: "EUROPEAN_HANDICAP" },
    { name: "European handicap", expected: "EUROPEAN_HANDICAP" },
    { name: "Parzyste/Nieparzyste", expected: "ODD_EVEN_GOALS" },
    { name: "Odd/Even", expected: "ODD_EVEN_GOALS" },
    { name: "Wygrana do zera", expected: "WIN_TO_NIL" },
    { name: "Win to nil", expected: "WIN_TO_NIL" },
    { name: "Czyste konto", expected: "CLEAN_SHEET" },
    { name: "Clean sheet", expected: "CLEAN_SHEET" },
  ];

  for (const { name, expected } of polishVariations) {
    it(`"${name}" -> ${expected}`, () => {
      const result = normalizer.normalize(
        { name, selections: [{ name: "Test", odds: 1.5 }] },
        "superbet",
        "Team A",
        "Team B"
      );
      expect(result.normalizedType).toBe(expected);
    });
  }
});
