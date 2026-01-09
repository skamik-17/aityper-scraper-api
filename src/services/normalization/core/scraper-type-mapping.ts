/**
 * Scraper Type Mapping
 *
 * Maps scraper-specific market types to normalized types.
 * Scrapers use various naming conventions (1X2, OVER_UNDER, etc.)
 * but the normalizer needs canonical types (MATCH_WINNER, TOTAL_GOALS, etc.)
 *
 * This mapping ensures consistency across all 14 bookmakers.
 */

import type { NormalizedMarketType } from "../types.js";
import { MarketCategory } from "../types.js";

/**
 * Map of scraper type strings to normalized market types.
 * Keys are lowercase for case-insensitive matching.
 */
export const SCRAPER_TYPE_TO_NORMALIZED: Record<string, NormalizedMarketType> = {
  // ==========================================================================
  // MAIN MARKETS (WYNIK_MECZU)
  // ==========================================================================
  
  // Match Winner / 1X2 - different names used by scrapers
  "1x2": "MATCH_WINNER",
  "match_result": "MATCH_WINNER",
  "match_winner": "MATCH_WINNER",
  "match-result": "MATCH_WINNER",
  "match-winner": "MATCH_WINNER",
  "wynik_meczu": "MATCH_WINNER",
  "wynik-meczu": "MATCH_WINNER",
  "p1xp2": "MATCH_WINNER", // Betcris format
  
  // Double Chance
  "double_chance": "DOUBLE_CHANCE",
  "double-chance": "DOUBLE_CHANCE",
  "doublechance": "DOUBLE_CHANCE",
  "podwojna_szansa": "DOUBLE_CHANCE",
  "1x12x2": "DOUBLE_CHANCE", // Betcris format
  "p1xp2dc": "DOUBLE_CHANCE", // Betcris format
  
  // Draw No Bet
  "draw_no_bet": "DRAW_NO_BET",
  "draw-no-bet": "DRAW_NO_BET",
  "drawnobet": "DRAW_NO_BET",
  "dnb": "DRAW_NO_BET",
  "remis_zwrot": "DRAW_NO_BET",
  
  // ==========================================================================
  // GOALS MARKETS (GOLE)
  // ==========================================================================
  
  // Total Goals / Over Under
  "over_under": "TOTAL_GOALS",
  "over-under": "TOTAL_GOALS",
  "overunder": "TOTAL_GOALS",
  "total_goals": "TOTAL_GOALS",
  "total-goals": "TOTAL_GOALS",
  "totalgoals": "TOTAL_GOALS",
  "liczba_goli": "TOTAL_GOALS",
  "suma_goli": "TOTAL_GOALS",
  
  // BTTS
  "btts": "BTTS",
  "both_teams_to_score": "BTTS",
  "both-teams-to-score": "BTTS",
  "bothteamstoscore": "BTTS",
  "obie_strzela": "BTTS",
  "gg": "BTTS",
  "ng": "BTTS", // Maps to NO selection, but market is still BTTS
  
  // Odd/Even Goals
  "odd_even": "ODD_EVEN_GOALS",
  "odd-even": "ODD_EVEN_GOALS",
  "oddeven": "ODD_EVEN_GOALS",
  "odd_even_goals": "ODD_EVEN_GOALS",
  "parzyste_nieparzyste": "ODD_EVEN_GOALS",
  
  // Win to Nil
  "win_to_nil": "WIN_TO_NIL",
  "win-to-nil": "WIN_TO_NIL",
  "wintonil": "WIN_TO_NIL",
  
  // Clean Sheet
  "clean_sheet": "CLEAN_SHEET",
  "clean-sheet": "CLEAN_SHEET",
  "cleansheet": "CLEAN_SHEET",
  
  // Team Total Goals
  "team_total_goals": "TEAM_TOTAL_GOALS",
  "team-total-goals": "TEAM_TOTAL_GOALS",
  "team_goals": "TEAM_TOTAL_GOALS",
  "teamgoals": "TEAM_TOTAL_GOALS",
  "home_goals": "TEAM_TOTAL_GOALS",
  "away_goals": "TEAM_TOTAL_GOALS",
  "gole_gospodarzy": "TEAM_TOTAL_GOALS",
  "gole_gosci": "TEAM_TOTAL_GOALS",
  "home_team_over_under": "TEAM_TOTAL_GOALS",
  "away_team_over_under": "TEAM_TOTAL_GOALS",
  "team1overunder": "TEAM_TOTAL_GOALS",
  "team2overunder": "TEAM_TOTAL_GOALS",
  "team_over_under": "TEAM_TOTAL_GOALS",
  
  // Goal Range / Multigol
  "goal_range": "GOAL_RANGE",
  "goal-range": "GOAL_RANGE",
  "multigol": "GOAL_RANGE",
  "multi_goal": "GOAL_RANGE",
  "exact_goals": "GOAL_RANGE",
  "exactgoals": "GOAL_RANGE",
  
  // Both Halves Goals
  "both_halves_goals": "BOTH_HALVES_GOALS",
  "both-halves-goals": "BOTH_HALVES_GOALS",
  "goal_in_both_halves": "BOTH_HALVES_GOALS",
  "gol_obie_polowy": "BOTH_HALVES_GOALS",
  
  // Winning Margin
  "winning_margin": "WINNING_MARGIN",
  "winning-margin": "WINNING_MARGIN",
  "winningmargin": "WINNING_MARGIN",
  "win_margin": "WINNING_MARGIN",
  "winmargin": "WINNING_MARGIN",
  "roznica_zwyciestwa": "WINNING_MARGIN",
  
  // ==========================================================================
  // HANDICAP MARKETS
  // ==========================================================================
  
  // Asian Handicap
  "asian_handicap": "ASIAN_HANDICAP",
  "asian-handicap": "ASIAN_HANDICAP",
  "asianhandicap": "ASIAN_HANDICAP",
  "handicap_azjatycki": "ASIAN_HANDICAP",
  
  // European Handicap
  "european_handicap": "EUROPEAN_HANDICAP",
  "european-handicap": "EUROPEAN_HANDICAP",
  "europeanhandicap": "EUROPEAN_HANDICAP",
  "handicap_europejski": "EUROPEAN_HANDICAP",
  "handicap": "EUROPEAN_HANDICAP", // Default handicap is European
  
  // ==========================================================================
  // HALF-TIME MARKETS (PIERWSZA_POLOWA)
  // ==========================================================================
  
  // Half Time Result
  "half_time_1x2": "HALF_TIME_RESULT",
  "half-time-1x2": "HALF_TIME_RESULT",
  "halftime1x2": "HALF_TIME_RESULT",
  "half_time_result": "HALF_TIME_RESULT",
  "half-time-result": "HALF_TIME_RESULT",
  "halftimeresult": "HALF_TIME_RESULT",
  "ht_result": "HALF_TIME_RESULT",
  "ht-result": "HALF_TIME_RESULT",
  "1_polowa_wynik": "HALF_TIME_RESULT",
  "p1xp2firsthalf": "HALF_TIME_RESULT",
  
  // Half Time Over/Under
  "half_time_over_under": "HALF_TIME_TOTAL_GOALS",
  "half-time-over-under": "HALF_TIME_TOTAL_GOALS",
  "halftimeoverunder": "HALF_TIME_TOTAL_GOALS",
  "half_time_total_goals": "HALF_TIME_TOTAL_GOALS",
  "half-time-total-goals": "HALF_TIME_TOTAL_GOALS",
  "ht_over_under": "HALF_TIME_TOTAL_GOALS",
  "ht-over-under": "HALF_TIME_TOTAL_GOALS",
  "1_polowa_gole": "HALF_TIME_TOTAL_GOALS",
  
  // Half Time BTTS
  "half_time_btts": "HALF_TIME_BTTS",
  "half-time-btts": "HALF_TIME_BTTS",
  "halftimebtts": "HALF_TIME_BTTS",
  "ht_btts": "HALF_TIME_BTTS",
  "ht-btts": "HALF_TIME_BTTS",
  "1_polowa_btts": "HALF_TIME_BTTS",
  "bothteamstoscorefirsthalf": "HALF_TIME_BTTS",
  
  // Second Half Result
  "second_half_result": "SECOND_HALF_RESULT",
  "second-half-result": "SECOND_HALF_RESULT",
  "2nd_half_result": "SECOND_HALF_RESULT",
  "2_polowa_wynik": "SECOND_HALF_RESULT",
  
  // Second Half Total Goals
  "second_half_total_goals": "SECOND_HALF_TOTAL_GOALS",
  "second-half-total-goals": "SECOND_HALF_TOTAL_GOALS",
  "second_half_over_under": "SECOND_HALF_TOTAL_GOALS",
  "2nd_half_over_under": "SECOND_HALF_TOTAL_GOALS",
  "2_polowa_gole": "SECOND_HALF_TOTAL_GOALS",
  
  // ==========================================================================
  // CORRECT SCORE MARKETS (DOKLADNY_WYNIK)
  // ==========================================================================
  
  "correct_score": "CORRECT_SCORE",
  "correct-score": "CORRECT_SCORE",
  "correctscore": "CORRECT_SCORE",
  "exact_score": "CORRECT_SCORE",
  "dokladny_wynik": "CORRECT_SCORE",
  
  // ==========================================================================
  // PLAYER MARKETS (ZAWODNICY)
  // ==========================================================================
  
  "goalscorer": "GOALSCORER_ANYTIME",
  "goalscorer_anytime": "GOALSCORER_ANYTIME",
  "goalscorer-anytime": "GOALSCORER_ANYTIME",
  "anytime_goalscorer": "GOALSCORER_ANYTIME",
  "strzelec": "GOALSCORER_ANYTIME",
  
  "first_goalscorer": "GOALSCORER_FIRST",
  "first-goalscorer": "GOALSCORER_FIRST",
  "firstgoalscorer": "GOALSCORER_FIRST",
  "pierwszy_strzelec": "GOALSCORER_FIRST",
  
  "last_goalscorer": "GOALSCORER_LAST",
  "last-goalscorer": "GOALSCORER_LAST",
  "lastgoalscorer": "GOALSCORER_LAST",
  "ostatni_strzelec": "GOALSCORER_LAST",
  
  "player_shots": "PLAYER_SHOTS",
  "player-shots": "PLAYER_SHOTS",
  "playershots": "PLAYER_SHOTS",
  
  "player_cards": "PLAYER_CARDS",
  "player-cards": "PLAYER_CARDS",
  "playercards": "PLAYER_CARDS",
  
  // ==========================================================================
  // STATISTICS MARKETS (STATYSTYKI)
  // ==========================================================================
  
  "corners": "CORNERS_TOTAL",
  "corners_total": "CORNERS_TOTAL",
  "corners-total": "CORNERS_TOTAL",
  "total_corners": "CORNERS_TOTAL",
  "rzuty_rozne": "CORNERS_TOTAL",
  "cornerstotal": "CORNERS_TOTAL",
  
  "cards": "CARDS_TOTAL",
  "cards_total": "CARDS_TOTAL",
  "cards-total": "CARDS_TOTAL",
  "total_cards": "CARDS_TOTAL",
  "kartki": "CARDS_TOTAL",
  "cardstotal": "CARDS_TOTAL",
  
  // ==========================================================================
  // COMBINATION MARKETS (KOMBINACJE)
  // ==========================================================================
  
  "result_btts": "RESULT_AND_BTTS",
  "result-btts": "RESULT_AND_BTTS",
  "result_and_btts": "RESULT_AND_BTTS",
  "result-and-btts": "RESULT_AND_BTTS",
  "wynik_btts": "RESULT_AND_BTTS",
  
  "result_total": "RESULT_AND_TOTAL",
  "result-total": "RESULT_AND_TOTAL",
  "result_and_total": "RESULT_AND_TOTAL",
  "result-and-total": "RESULT_AND_TOTAL",
  "wynik_gole": "RESULT_AND_TOTAL",
  
  "ht_ft": "HALFTIME_FULLTIME",
  "ht-ft": "HALFTIME_FULLTIME",
  "htft": "HALFTIME_FULLTIME",
  "half_match": "HALFTIME_FULLTIME",
  "half-match": "HALFTIME_FULLTIME",
  "halftime_fulltime": "HALFTIME_FULLTIME",
  "halftime-fulltime": "HALFTIME_FULLTIME",
  "halftimefulltime": "HALFTIME_FULLTIME",
  "polowa_mecz": "HALFTIME_FULLTIME",
  "half_time_full_time": "HALFTIME_FULLTIME",
  
  "double_chance_btts": "DOUBLE_CHANCE_BTTS",
  "double-chance-btts": "DOUBLE_CHANCE_BTTS",
  "dc_btts": "DOUBLE_CHANCE_BTTS",
  "dc-btts": "DOUBLE_CHANCE_BTTS",
  
  "double_chance_total": "DOUBLE_CHANCE_TOTAL",
  "double-chance-total": "DOUBLE_CHANCE_TOTAL",
  "dc_total": "DOUBLE_CHANCE_TOTAL",
  "dc-total": "DOUBLE_CHANCE_TOTAL",
  "dc_over_under": "DOUBLE_CHANCE_TOTAL",
  "double_chance_over_under": "DOUBLE_CHANCE_TOTAL",
  "double-chance-over-under": "DOUBLE_CHANCE_TOTAL",
  "doublechanceoverunder": "DOUBLE_CHANCE_TOTAL",
  
  "first_to_score": "GOALSCORER_FIRST",
  "first-to-score": "GOALSCORER_FIRST",
  "firsttoscore": "GOALSCORER_FIRST",
  "last_to_score": "GOALSCORER_LAST",
  "last-to-score": "GOALSCORER_LAST",
  "lasttoscore": "GOALSCORER_LAST",
  "half_full_time": "HALFTIME_FULLTIME",
  "half-full-time": "HALFTIME_FULLTIME",
  "halffulltime": "HALFTIME_FULLTIME",
  "home_total": "TEAM_TOTAL_GOALS",
  "home-total": "TEAM_TOTAL_GOALS",
  "hometotal": "TEAM_TOTAL_GOALS",
  "away_total": "TEAM_TOTAL_GOALS",
  "away-total": "TEAM_TOTAL_GOALS",
  "awaytotal": "TEAM_TOTAL_GOALS",
  "home_win_to_nil": "WIN_TO_NIL",
  "away_win_to_nil": "WIN_TO_NIL",
  "home_no_bet": "DRAW_NO_BET",
  "away_no_bet": "DRAW_NO_BET",
  
  "second_half_1x2": "SECOND_HALF_RESULT",
  "second-half-1x2": "SECOND_HALF_RESULT",
  "secondhalf1x2": "SECOND_HALF_RESULT",
  "home_exact_goals": "GOAL_RANGE",
  "away_exact_goals": "GOAL_RANGE",
  "goals_both_halves": "BOTH_HALVES_GOALS",
  "home_clean_sheet": "CLEAN_SHEET",
  "away_clean_sheet": "CLEAN_SHEET",
  "second_half_btts": "HALF_TIME_BTTS",
  "home_win_both_halves": "BOTH_HALVES_GOALS",
  "away_win_both_halves": "BOTH_HALVES_GOALS",
  "home_win_either_half": "BOTH_HALVES_GOALS",
  "away_win_either_half": "BOTH_HALVES_GOALS",
  "result_over_under": "RESULT_AND_TOTAL",
  
  "total_goals_exact": "GOAL_RANGE",
  "first_goal_scorer": "GOALSCORER_FIRST",
  "first_goal": "GOALSCORER_FIRST",
  "last_goal": "GOALSCORER_LAST",
  "anytime_scorer": "GOALSCORER_ANYTIME",
  "goal_both_halves": "BOTH_HALVES_GOALS",
  "goal_scorer": "GOALSCORER_ANYTIME",
  
  "home_to_score": "HOME_TEAM_TO_SCORE",
  "home-to-score": "HOME_TEAM_TO_SCORE",
  "hometoscore": "HOME_TEAM_TO_SCORE",
  "home_team_to_score": "HOME_TEAM_TO_SCORE",
  "home-team-to-score": "HOME_TEAM_TO_SCORE",
  "hometeamtoscore": "HOME_TEAM_TO_SCORE",
  "home_scores": "HOME_TEAM_TO_SCORE",
  "home-scores": "HOME_TEAM_TO_SCORE",
  "homescores": "HOME_TEAM_TO_SCORE",
  
  "away_to_score": "AWAY_TEAM_TO_SCORE",
  "away-to-score": "AWAY_TEAM_TO_SCORE",
  "awaytoscore": "AWAY_TEAM_TO_SCORE",
  "away_team_to_score": "AWAY_TEAM_TO_SCORE",
  "away-team-to-score": "AWAY_TEAM_TO_SCORE",
  "awayteamtoscore": "AWAY_TEAM_TO_SCORE",
  "away_scores": "AWAY_TEAM_TO_SCORE",
  "away-scores": "AWAY_TEAM_TO_SCORE",
  "awayscores": "AWAY_TEAM_TO_SCORE",
  
  "player_assists": "PLAYER_ASSISTS",
  "player-assists": "PLAYER_ASSISTS",
  "playerassists": "PLAYER_ASSISTS",
  "assists": "PLAYER_ASSISTS",
  
  "corners_team": "CORNERS_TEAM",
  "corners-team": "CORNERS_TEAM",
  "cornersteam": "CORNERS_TEAM",
  "team_corners": "CORNERS_TEAM",
  "team-corners": "CORNERS_TEAM",
  "teamcorners": "CORNERS_TEAM",
  "home_corners": "CORNERS_TEAM",
  "away_corners": "CORNERS_TEAM",
  
  "cards_team": "CARDS_TEAM",
  "cards-team": "CARDS_TEAM",
  "cardsteam": "CARDS_TEAM",
  "team_cards": "CARDS_TEAM",
  "team-cards": "CARDS_TEAM",
  "teamcards": "CARDS_TEAM",
  "home_cards": "CARDS_TEAM",
  "away_cards": "CARDS_TEAM",
  
  "fouls": "FOULS_TOTAL",
  "fouls_total": "FOULS_TOTAL",
  "fouls-total": "FOULS_TOTAL",
  "foulstotal": "FOULS_TOTAL",
  "total_fouls": "FOULS_TOTAL",
  "faule": "FOULS_TOTAL",
  
  "offsides": "OFFSIDES_TOTAL",
  "offsides_total": "OFFSIDES_TOTAL",
  "offsides-total": "OFFSIDES_TOTAL",
  "offsidestotal": "OFFSIDES_TOTAL",
  "total_offsides": "OFFSIDES_TOTAL",
  "spalone": "OFFSIDES_TOTAL",
  
  "double_result": "DOUBLE_RESULT",
  "double-result": "DOUBLE_RESULT",
  "doubleresult": "DOUBLE_RESULT",
};

/**
 * Normalize a scraper type string to a canonical NormalizedMarketType.
 * Handles various naming conventions used by different scrapers.
 *
 * @param scraperType - The market type string from the scraper
 * @returns The normalized market type, or undefined if not mappable
 */
export function normalizeScraperType(
  scraperType: string | undefined
): NormalizedMarketType | undefined {
  if (!scraperType) return undefined;

  // Normalize the input: lowercase, replace spaces with underscores
  const normalized = scraperType
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  // Direct lookup
  const directMatch = SCRAPER_TYPE_TO_NORMALIZED[normalized];
  if (directMatch) return directMatch;

  // Try with different separators
  const withDash = normalized.replace(/_/g, "-");
  const dashMatch = SCRAPER_TYPE_TO_NORMALIZED[withDash];
  if (dashMatch) return dashMatch;

  // Try without separators
  const noSep = normalized.replace(/[_-]/g, "");
  const noSepMatch = SCRAPER_TYPE_TO_NORMALIZED[noSep];
  if (noSepMatch) return noSepMatch;

  // Not found
  return undefined;
}

/**
 * Check if a string is a valid normalized market type.
 */
export function isValidNormalizedType(type: string): type is NormalizedMarketType {
  const validTypes: NormalizedMarketType[] = [
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
    "OTHER",
  ];
  return validTypes.includes(type as NormalizedMarketType);
}

/**
 * Get category for a normalized market type.
 */
export function getCategoryForType(type: NormalizedMarketType): MarketCategory {
  const categoryMap: Record<NormalizedMarketType, MarketCategory> = {
    MATCH_WINNER: MarketCategory.WYNIK_MECZU,
    DOUBLE_CHANCE: MarketCategory.WYNIK_MECZU,
    DRAW_NO_BET: MarketCategory.WYNIK_MECZU,
    TOTAL_GOALS: MarketCategory.GOLE,
    BTTS: MarketCategory.GOLE,
    ODD_EVEN_GOALS: MarketCategory.GOLE,
    WIN_TO_NIL: MarketCategory.GOLE,
    CLEAN_SHEET: MarketCategory.GOLE,
    HOME_TEAM_TO_SCORE: MarketCategory.GOLE,
    AWAY_TEAM_TO_SCORE: MarketCategory.GOLE,
    TEAM_TOTAL_GOALS: MarketCategory.GOLE,
    GOAL_RANGE: MarketCategory.GOLE,
    BOTH_HALVES_GOALS: MarketCategory.GOLE,
    WINNING_MARGIN: MarketCategory.GOLE,
    ASIAN_HANDICAP: MarketCategory.HANDICAP,
    EUROPEAN_HANDICAP: MarketCategory.HANDICAP,
    HALF_TIME_RESULT: MarketCategory.PIERWSZA_POLOWA,
    HALF_TIME_TOTAL_GOALS: MarketCategory.PIERWSZA_POLOWA,
    HALF_TIME_BTTS: MarketCategory.PIERWSZA_POLOWA,
    SECOND_HALF_RESULT: MarketCategory.PIERWSZA_POLOWA,
    SECOND_HALF_TOTAL_GOALS: MarketCategory.PIERWSZA_POLOWA,
    CORRECT_SCORE: MarketCategory.DOKLADNY_WYNIK,
    GOALSCORER_FIRST: MarketCategory.ZAWODNICY,
    GOALSCORER_LAST: MarketCategory.ZAWODNICY,
    GOALSCORER_ANYTIME: MarketCategory.ZAWODNICY,
    PLAYER_SHOTS: MarketCategory.ZAWODNICY,
    PLAYER_CARDS: MarketCategory.ZAWODNICY,
    PLAYER_ASSISTS: MarketCategory.ZAWODNICY,
    CORNERS_TOTAL: MarketCategory.STATYSTYKI,
    CORNERS_TEAM: MarketCategory.STATYSTYKI,
    CORNERS_RACE: MarketCategory.STATYSTYKI,
    FIRST_CORNER: MarketCategory.STATYSTYKI,
    CORNERS_HANDICAP: MarketCategory.STATYSTYKI,
    CARDS_TOTAL: MarketCategory.STATYSTYKI,
    CARDS_TEAM: MarketCategory.STATYSTYKI,
    CARDS_RACE: MarketCategory.STATYSTYKI,
    FIRST_CARD: MarketCategory.STATYSTYKI,
    FOULS_TOTAL: MarketCategory.STATYSTYKI,
    OFFSIDES_TOTAL: MarketCategory.STATYSTYKI,
    // Goals timing markets
    FIRST_TEAM_TO_SCORE: MarketCategory.GOLE,
    FIRST_GOAL_TIME: MarketCategory.GOLE,
    TIME_PERIOD_RESULT: MarketCategory.GOLE,
    FIRST_GOAL_AND_RESULT: MarketCategory.KOMBINACJE,
    // Additional player markets
    PLAYER_GOAL_AND_RESULT: MarketCategory.ZAWODNICY,
    PLAYER_SHOTS_ON_TARGET: MarketCategory.ZAWODNICY,
    PLAYER_PASSES: MarketCategory.ZAWODNICY,
    RESULT_AND_BTTS: MarketCategory.KOMBINACJE,
    RESULT_AND_TOTAL: MarketCategory.KOMBINACJE,
    HALFTIME_FULLTIME: MarketCategory.KOMBINACJE,
    DOUBLE_RESULT: MarketCategory.KOMBINACJE,
    DOUBLE_CHANCE_BTTS: MarketCategory.KOMBINACJE,
    DOUBLE_CHANCE_TOTAL: MarketCategory.KOMBINACJE,
    OTHER: MarketCategory.INNE,
  };
  return categoryMap[type] || MarketCategory.INNE;
}
