/**
 * LeBull Market Normalizer
 *
 * Handles market normalization specific to LeBull betting platform.
 * LeBull uses numeric stake type IDs (stakeTypeId) from the sbteam.xyz API.
 * When the parser doesn't recognize an ID, it falls back to "Rynek XXX" format.
 *
 * This normalizer:
 * 1. Maps known stake type IDs to normalized market types
 * 2. Handles the "Rynek XXX" format by extracting and mapping the ID
 * 3. Falls back to pattern matching for any named markets
 *
 * Known stake type IDs from sbteam.xyz API:
 * - 1: Match Result (1X2)
 * - 2: Handicap (Asian)
 * - 3: Over/Under Total Goals
 * - 5: Half Time Result
 * - 6: Half Time Over/Under
 * - 7: Correct Score
 * - 9: Draw No Bet
 * - 26: BTTS
 * - 27: Match Winner + Over/Under combo
 * - 28: Match Winner + BTTS combo
 * - 37: Double Chance
 * - 69: European Handicap (3-way)
 * - 75: Odd/Even Total Goals
 * - 134: Half Time BTTS
 * - 618: Win to Nil
 * - 748: Clean Sheet
 *
 * Coverage target: >=90%
 */

import {
  NormalizedMarketType,
  NormalizedSelection,
  NormalizedMarketGroup,
} from "../../types/normalization.js";
import { BaseNormalizer, type MarketPattern } from "./base-normalizer.js";
import {
  PLAYER_MARKET_PATTERNS,
  STATISTICS_MARKET_PATTERNS,
  COMBINATION_MARKET_PATTERNS,
} from "./common-patterns.js";

/**
 * Mapping of LeBull stake type IDs to normalized market types
 * These IDs are from the sbteam.xyz API used by LeBull
 */
const STAKE_TYPE_ID_MAP: Map<
  number,
  { type: NormalizedMarketType; group: NormalizedMarketGroup }
> = new Map([
  // Main markets
  [1, { type: NormalizedMarketType.MATCH_WINNER, group: NormalizedMarketGroup.MAIN }],
  [37, { type: NormalizedMarketType.DOUBLE_CHANCE, group: NormalizedMarketGroup.MAIN }],
  [9, { type: NormalizedMarketType.DRAW_NO_BET, group: NormalizedMarketGroup.MAIN }],

  // Goals markets
  [3, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [26, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }],
  [75, { type: NormalizedMarketType.ODD_EVEN_GOALS, group: NormalizedMarketGroup.GOALS }],
  [618, { type: NormalizedMarketType.WIN_TO_NIL, group: NormalizedMarketGroup.GOALS }],
  [748, { type: NormalizedMarketType.CLEAN_SHEET, group: NormalizedMarketGroup.GOALS }],

  // Handicap markets
  [2, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP }],
  [69, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP }],

  // Half-time markets
  [5, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [6, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME }],
  [134, { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }],

  // Score markets
  [7, { type: NormalizedMarketType.CORRECT_SCORE, group: NormalizedMarketGroup.SCORE }],

  // Combo markets - map to primary market type
  // 27 = Match Winner + Over/Under - treat as TOTAL_GOALS combo
  [27, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  // 28 = Match Winner + BTTS - treat as BTTS combo
  [28, { type: NormalizedMarketType.BTTS, group: NormalizedMarketGroup.GOALS }],

  // Additional discovered IDs from extended stake types
  // Team totals
  [80, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [144, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [356, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [545, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [702, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],
  [724, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS }],

  // Half-time specific combinations
  [40390, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],

  // Extended total goals markets (various lines)
  [525, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [526, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [529, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [530, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [533, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [534, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [535, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [536, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [539, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [540, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [543, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [544, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // Extended handicap markets (various lines)
  [583, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [584, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [585, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [586, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // Half-time totals
  [607, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [618, { type: NormalizedMarketType.HALF_TIME_BTTS, group: NormalizedMarketGroup.HALF_TIME }],
  [647, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [650, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [651, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [652, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [653, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [654, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [655, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [656, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [657, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [658, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [659, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],

  // European handicap variants
  [66, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [67, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [68, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [670, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [671, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [672, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [673, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [674, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [675, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [676, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [677, { type: NormalizedMarketType.EUROPEAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // Asian handicap variants
  [682, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // More extended total goals (270xxx series)
  [270586, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270587, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270588, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270589, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270590, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270591, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270618, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270619, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270621, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270825, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270826, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270827, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270828, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270829, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270830, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270831, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270832, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [270833, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // Extended handicap markets (260xxx series)
  [261946, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [261964, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [261965, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [262063, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [262274, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [262275, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [262276, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [263683, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [263685, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [263693, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [263694, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [263695, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [263696, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [267856, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [267857, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [267860, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [267861, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [268284, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [268285, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [268286, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [268287, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [268288, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [268289, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [268826, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [268887, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],
  [268888, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // Extended combo and special markets (270xxx+ series)
  [270665, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo market
  [275, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [276, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [277, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [278, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [279, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [280, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [281, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [282, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [283, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [285, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [286, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [287, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [288, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo
  [290, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Combo

  // High-ID markets (290xxx+ series)
  [299442, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [310988, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [310989, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [310990, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [310991, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [311019, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [311020, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [311021, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [311022, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [314168, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [314169, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // Very high ID markets (320xxx+ series)
  [329307, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [329349, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [329350, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [329351, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [332672, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market
  [332813, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market
  [332814, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market
  [332815, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market
  [332816, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market
  [332818, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market
  [332819, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market
  [332821, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market
  [333109, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333110, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333111, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333112, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333113, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333114, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333115, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333116, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333117, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333118, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333182, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [333649, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],  // Player market

  // Extended markets (330xxx+ series)
  [339468, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [350009, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [350010, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [350076, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [350077, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [350171, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [350214, { type: NormalizedMarketType.ASIAN_HANDICAP, group: NormalizedMarketGroup.HANDICAP, hasParam: true }],

  // Higher ID series
  [377798, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [380258, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [380259, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // 390xxx series - half-time and combo markets
  [390842, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [390843, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [39504, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [39505, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [39506, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [39507, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [39508, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [39593, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [39594, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],

  // 403xxx series - extended half-time markets
  [40317, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40379, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40380, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40381, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40382, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40383, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40384, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40385, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40386, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40387, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40388, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40389, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40390, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40393, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40394, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40397, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40398, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40414, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40415, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40421, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40422, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40423, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40424, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40425, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40426, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40427, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40428, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40429, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40431, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40493, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40494, { type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS, group: NormalizedMarketGroup.HALF_TIME, hasParam: true }],
  [40495, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40496, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40497, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],
  [40498, { type: NormalizedMarketType.HALF_TIME_RESULT, group: NormalizedMarketGroup.HALF_TIME }],

  // 420xxx+ series - extended markets
  [421317, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [424467, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // Very high ID markets (5000000+ series) - player/special markets
  [5685188, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [5685189, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [5685190, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [5699562, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [5699564, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [5701801, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [5774055, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [5774056, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [5774433, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // 1050-1082 series - combo/special markets
  [1050, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1051, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1052, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1053, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1060, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1071, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1082, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // 1140-1205 series
  [1140, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1141, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1204, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],
  [1205, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // 175000+ series
  [175092, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [175094, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [175095, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [175100, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],
  [175105, { type: NormalizedMarketType.TOTAL_GOALS, group: NormalizedMarketGroup.GOALS, hasParam: true }],

  // 274556 - specific combo market
  [274556, { type: NormalizedMarketType.OTHER, group: NormalizedMarketGroup.OTHER }],

  // Exotic high-ID markets (often player/special markets - map to OTHER)
  // These will be handled by pattern matching if they have meaningful names
]);

/**
 * Set of stake type IDs that should be classified as OTHER
 * These are specialized markets (cards, corners, player props, minute bets, etc.)
 * that don't fit into the standard market categories.
 *
 * LeBull extended stake types include many exotic markets with high IDs.
 * IDs above 1000 are typically special markets.
 */
const OTHER_STAKE_TYPE_IDS: Set<number> = new Set([
  // Low-numbered known "other" markets
  4,      // Specific minute/time markets
  8,      // Penalty markets
  10,     // First goal scorer
  11,     // Last goal scorer
  12,     // Anytime goalscorer
  13,     // Team to score first
  14,     // Team to score last
  15,     // Specific scorer markets
  16,     // Double/hat-trick markets
  17,     // Double/hat-trick markets
  18,     // Scorer related
  19,     // Scorer related
  20,     // Scorer related
  21,     // Scorer related
  22,     // Cards markets
  23,     // Cards markets
  24,     // Corners markets
  25,     // Corners markets
  29,     // Time of goals
  30,     // Time of goals
  31,     // Time of goals
  32,     // Time of goals
  33,     // Period markets
  34,     // Period markets
  35,     // Period markets
  36,     // Period markets
  38,     // Combo markets
  39,     // Combo markets
  40,     // Combo markets
  41,     // Combo markets
  42,     // Special markets
  43,     // Special markets
  44,     // Special markets
  45,     // Special markets
  46,     // Special markets
  47,     // Special markets
  48,     // Special markets
  49,     // Special markets
  50,     // Special markets

  // Half-time specialty markets (40390, 40397, 40495 are now mapped to HALF_TIME_RESULT in main map)
  // 40390,  // Half-time special combo - now mapped
  // 40397,  // Half-time special - now mapped
  40495,  // Half-time special

  // High-ID special/exotic markets
  176415, // Special market
  183254, // Special market
  217797, // Special market
  // 261946, // Now mapped to ASIAN_HANDICAP
  // 270665, // Combo market - mapped in main map
  274556, // Special market (combo)
  313638, // Special market
  313639, // Special market
  // 332815, // Now mapped to OTHER (player market)
  // 333649, // Now mapped to OTHER (player market)
  // 350009, // Now mapped to HALF_TIME_RESULT
  // 350010, // Now mapped to HALF_TIME_RESULT
  350171, // Special market
  357318, // Special market
  5699562, // Player/special market
  5699564, // Player/special market
  5701801, // Player/special market
  5774433, // Player/special market
]);

export class LeBullNormalizer extends BaseNormalizer {
  readonly bookmaker = "lebull";

  /**
   * Bookmaker-specific market patterns
   *
   * These match named markets produced by the LeBull parser's getMarketName function.
   * The parser converts known stake type IDs to Polish market names:
   * - 1 (MATCH_RESULT) -> "Wynik meczu"
   * - 3 (OVER_UNDER) -> "Liczba goli X.X"
   * - 5 (HALF_TIME_RESULT) -> "Wynik 1. polowy"
   * - 6 (HALF_TIME_OVER_UNDER) -> "Liczba goli 1. polowa X.X"
   * - 7 (CORRECT_SCORE) -> "Dokladny wynik"
   * - 9 (DRAW_NO_BET) -> "Remis = zwrot"
   * - 26 (BTTS) -> "Obie druzyny strzela"
   * - 37 (DOUBLE_CHANCE) -> "Podwojna szansa"
   * - 2 (HANDICAP) -> "Handicap X.X"
   *
   * Unknown stake types fall back to "Rynek {stakeTypeId}" format,
   * which is handled by tryIdMapping method.
   */
  protected readonly patterns: MarketPattern[] = [
    // ========================================================================
    // HALF-TIME MARKETS (must match first for specificity)
    // ========================================================================

    // "Wynik 1. polowy" - exact format from parser
    {
      pattern: /^wynik\s*1\.\s*po[lł]owy?$/i,
      type: NormalizedMarketType.HALF_TIME_RESULT,
    },

    // "Liczba goli 1. polowa X.X" - exact format from parser with line
    {
      pattern: /^liczba\s*goli?\s*1\.\s*po[lł]ow[ay]?\s*(\d+[.,]?\d*)$/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Liczba goli 1. polowa" - without line
    {
      pattern: /^liczba\s*goli?\s*1\.\s*po[lł]ow[ay]?$/i,
      type: NormalizedMarketType.HALF_TIME_TOTAL_GOALS,
    },

    // Half-time BTTS (generic pattern)
    {
      pattern: /^(1|2)\.\s*po[lł]ow[aąe]?\s*-?\s*obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.HALF_TIME_BTTS,
    },

    // ========================================================================
    // BTTS (Both Teams To Score)
    // ========================================================================

    // "Obie druzyny strzela" - exact format from parser (note: strzela not strzela gola)
    {
      pattern: /^obie\s*dru[żz]yny\s*strzel[aą]?$/i,
      type: NormalizedMarketType.BTTS,
    },

    // More general BTTS patterns
    {
      pattern: /obie\s*dru[żz]yny\s*strzel/i,
      type: NormalizedMarketType.BTTS,
    },
    {
      pattern: /^btts$/i,
      type: NormalizedMarketType.BTTS,
    },

    // ========================================================================
    // TOTAL GOALS MARKETS
    // ========================================================================

    // "Liczba goli X.X" - exact format from parser with line
    {
      pattern: /^liczba\s*goli?\s*(\d+[.,]?\d*)$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Liczba goli" - without line
    {
      pattern: /^liczba\s*goli?$/i,
      type: NormalizedMarketType.TOTAL_GOALS,
    },

    // Over/Under format
    {
      pattern: /powy[żz]ej\s*\/?\s*poni[żz]ej\s*(\d+[.,]?\d*)/i,
      type: NormalizedMarketType.TOTAL_GOALS,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // ========================================================================
    // HANDICAP MARKETS
    // ========================================================================

    // "Handicap X.X" - exact format from parser with line
    {
      pattern: /^handicap\s*([-+]?\d+[.,]?\d*)$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
      extractParam: (m) => m[1]?.replace(",", "."),
    },

    // "Handicap" - without line
    {
      pattern: /^handicap$/i,
      type: NormalizedMarketType.ASIAN_HANDICAP,
    },

    // ========================================================================
    // DOUBLE CHANCE
    // ========================================================================

    // "Podwojna szansa" - exact format from parser
    {
      pattern: /^podw[oó]jn[aey]?\s*szans[aey]?$/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // More general patterns
    {
      pattern: /podw[oó]jn.*szans/i,
      type: NormalizedMarketType.DOUBLE_CHANCE,
    },

    // ========================================================================
    // DRAW NO BET
    // ========================================================================

    // "Remis = zwrot" - exact format from parser
    {
      pattern: /^remis\s*=\s*zwrot$/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // More general patterns
    {
      pattern: /remis\s*zwraca/i,
      type: NormalizedMarketType.DRAW_NO_BET,
    },

    // ========================================================================
    // MATCH WINNER / 1X2
    // ========================================================================

    // "Wynik meczu" - exact format from parser
    {
      pattern: /^wynik\s*meczu$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // Standard 1X2
    {
      pattern: /^1x2$/i,
      type: NormalizedMarketType.MATCH_WINNER,
    },

    // ========================================================================
    // CORRECT SCORE
    // ========================================================================

    // "Dokladny wynik" - exact format from parser
    {
      pattern: /^dok[lł]adn[y]?\s*wynik$/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // More general patterns
    {
      pattern: /dok[lł]adn.*wynik/i,
      type: NormalizedMarketType.CORRECT_SCORE,
    },

    // ========================================================================
    // ODD/EVEN GOALS
    // ========================================================================

    {
      pattern: /parzyste?\s*\/?\s*nieparzyste?/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },
    {
      pattern: /nieparzyste?\s*\/?\s*parzyste?/i,
      type: NormalizedMarketType.ODD_EVEN_GOALS,
    },

    // ========================================================================
    // WIN TO NIL / CLEAN SHEET
    // ========================================================================

    {
      pattern: /wygra\s*do\s*zera/i,
      type: NormalizedMarketType.WIN_TO_NIL,
    },
    {
      pattern: /czyst.*konto/i,
      type: NormalizedMarketType.CLEAN_SHEET,
    },

    // Common patterns fallback
    ...COMBINATION_MARKET_PATTERNS,
    ...STATISTICS_MARKET_PATTERNS,
    ...PLAYER_MARKET_PATTERNS,
  ];

  /**
   * Try to map market name using stake type ID lookup
   * LeBull uses "Rynek XXX" format for unrecognized stake types
   */
  protected tryIdMapping(marketName: string): {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    param?: string;
  } | null {
    // Try to extract stake type ID from "Rynek XXX" format
    const match = marketName.match(/^Rynek\s+(\d+)$/i);
    if (!match) {
      return null;
    }

    const stakeTypeId = parseInt(match[1], 10);

    // Check if it's in our known OTHER category
    if (OTHER_STAKE_TYPE_IDS.has(stakeTypeId)) {
      return {
        type: NormalizedMarketType.OTHER,
        group: NormalizedMarketGroup.OTHER,
      };
    }

    // Look up in our ID mapping
    const mapping = STAKE_TYPE_ID_MAP.get(stakeTypeId);
    if (mapping) {
      return {
        type: mapping.type,
        group: mapping.group,
      };
    }

    // For very high IDs (above 1000), treat as OTHER
    // These are typically exotic/special markets (player props, specials, etc.)
    if (stakeTypeId > 1000) {
      return {
        type: NormalizedMarketType.OTHER,
        group: NormalizedMarketGroup.OTHER,
      };
    }

    // For remaining low IDs, return null to fall through to pattern matching
    // or ultimately to OTHER
    return null;
  }

  /**
   * Selection normalization patterns specific to LeBull
   */
  protected normalizeSelectionName(
    selectionName: string,
    marketType: NormalizedMarketType,
    homeTeam?: string,
    awayTeam?: string
  ): NormalizedSelection {
    const name = selectionName.toLowerCase().trim();

    // Team-based selections (check first for accuracy)
    if (homeTeam && this.matchesTeam(name, homeTeam)) {
      return NormalizedSelection.HOME;
    }
    if (awayTeam && this.matchesTeam(name, awayTeam)) {
      return NormalizedSelection.AWAY;
    }

    // Polish home/away team names (gospodarz/goście)
    if (/^gospodarz(?:arze|y)?$/i.test(name)) return NormalizedSelection.HOME;
    if (/^go[ść]cie|go[śś]ci$/i.test(name)) return NormalizedSelection.AWAY;

    // ==========================================================================
    // LEBULL-SPECIFIC: Handle mixed selection formats
    // LeBull can use team names, numeric codes, or Polish text
    // ==========================================================================

    // Handle handicap selections with team names: "Team (+1.5)" or "Team (-1.5)"
    const handicapMatch = name.match(/^(.+?)\s*\(([+-]?\d+[.,]?\d*)\)\s*$/);
    if (handicapMatch) {
      const teamPart = handicapMatch[1].trim();
      if (homeTeam && this.matchesTeam(teamPart, homeTeam)) {
        return NormalizedSelection.HOME;
      }
      if (awayTeam && this.matchesTeam(teamPart, awayTeam)) {
        return NormalizedSelection.AWAY;
      }
    }

    // European Handicap selections: "1 (1:0)", "X (1:0)", "2 (1:0)"
    const ehMatch = name.match(/^([1x2])\s*\(\d+:\d+\)$/i);
    if (ehMatch) {
      const code = ehMatch[1].toLowerCase();
      if (code === "1") return NormalizedSelection.HOME;
      if (code === "x") return NormalizedSelection.DRAW;
      if (code === "2") return NormalizedSelection.AWAY;
    }

    // ==========================================================================
    // BTTS-specific: LeBull uses various formats
    // ==========================================================================

    if (marketType === NormalizedMarketType.BTTS || marketType === NormalizedMarketType.HALF_TIME_BTTS) {
      // LeBull uses Polish "Tak"/"Nie", English "Yes"/"No", or sometimes numeric codes
      if (/^(tak|yes|gg|y|1|sim|gol|obie)/i.test(name)) {
        return NormalizedSelection.YES;
      }
      if (/^(nie|no|ng|n|0|brak)/i.test(name)) {
        return NormalizedSelection.NO;
      }
    }

    // Use common selection patterns from base class
    const common = this.normalizeCommonSelection(name, marketType);
    if (common !== NormalizedSelection.UNKNOWN) {
      return common;
    }

    // LeBull-specific selection patterns

    // Enhanced Over/Under selections (Polish + English + Portuguese)
    if (/^powy[żz]ej/i.test(name) || /^ponad/i.test(name) || /^(powy[żz]ej|powyzej|poni|ponad|over|mais)/i.test(name)) {
      return NormalizedSelection.OVER;
    }
    if (/^poni[żz]ej/i.test(name) || /^(poni[żz]ej|ponizej|under|menos)/i.test(name)) {
      return NormalizedSelection.UNDER;
    }

    // Remis (draw)
    if (/^remis$/i.test(name)) {
      return NormalizedSelection.DRAW;
    }

    // Enhanced Yes/No for BTTS and similar markets (Polish + English + variants)
    if (/^(tak|yes|y|gg|sim|gol)/i.test(name)) {
      return NormalizedSelection.YES;
    }
    if (/^(nie|no|n|ng|n[ão]o|brak)/i.test(name)) {
      return NormalizedSelection.NO;
    }

    // Enhanced Odd/Even Polish variants
    if (/nieparzyst[ea]?/i.test(name)) {
      return NormalizedSelection.ODD;
    }
    if (/parzyst[ea]?/i.test(name)) {
      return NormalizedSelection.EVEN;
    }

    // Enhanced Double Chance patterns (LeBull may use "10", "02", "12" codes)
    if (/^1x$|^1\/x$|^1\s*lub\s*x|^10$/i.test(name)) {
      return NormalizedSelection.HOME_OR_DRAW;
    }
    if (/^x2$|^x\/2$|^x\s*lub\s*2|^02$/i.test(name)) {
      return NormalizedSelection.DRAW_OR_AWAY;
    }
    if (/^12$|^1\/2$|^1\s*lub\s*2/i.test(name)) {
      return NormalizedSelection.HOME_OR_AWAY;
    }

    return NormalizedSelection.UNKNOWN;
  }
}

// Export singleton instance
export const lebullNormalizer = new LeBullNormalizer();
