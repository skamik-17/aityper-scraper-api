import type {
  BookmakerMarketNormalizer,
  RawBookmakerMarket,
  NormalizationContext,
  NormalizedMarketOutput,
  NormalizedMarketType,
  NormalizedSelection,
} from "../types.js";
import {
  buildMarketKey,
  parseOverUnderLine,
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  parseScoreSelection,
  parseHtFtSelection,
  parseHandicapLine,
} from "../helpers/index.js";
import { isValidMarketCode } from "../../../data/market-catalog.js";

const FORBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  4: "DOUBLE_CHANCE",
  11: "DRAW_NO_BET",
  12: "WINNING_MARGIN",
  98: "BTTS",
  8: "TOTAL_GOALS",
  9: "GOAL_RANGE",
  5: "HALF_TIME_RESULT",
  10: "HALF_TIME_TOTAL_GOALS",
  99: "HALF_TIME_BTTS",
  6: "EUROPEAN_HANDICAP",
  7: "ASIAN_HANDICAP",
  2: "CORRECT_SCORE",
  3: "HALFTIME_FULLTIME",
  // Audited mappings keyed by raw bookmakerMarketId
  "-31170": "EUROPEAN_HANDICAP",
  "-8132": "HT_OR_FT_RESULT",
  "-2982": "HOME_TEAM_TO_SCORE",
  "-2983": "HOME_TEAM_TO_SCORE",
  "-2976": "TIME_PERIOD_RESULT",
  127: "TEAM_WIN_AT_LEAST_ONE_HALF",
  128: "TEAM_WIN_AT_LEAST_ONE_HALF",
  "-237": "HALF_TIME_DRAW_NO_BET",
  111: "SECOND_HALF_RESULT",
  "-283": "SECOND_HALF_DRAW_NO_BET",
  "-458": "ASIAN_HANDICAP",
  "-6048": "EUROPEAN_HANDICAP",
  "-2557": "FIRST_HALF_EUROPEAN_HANDICAP",
  "-2558": "SECOND_HALF_EUROPEAN_HANDICAP",
  "-2967": "FIRST_TEAM_TO_SCORE",
  41: "LAST_TEAM_TO_SCORE",
  "-2904": "HOME_GOAL_RANGE",
  "-2905": "HOME_GOAL_RANGE",
  106: "HOME_SCORE_BOTH_HALVES",
  107: "HOME_SCORE_BOTH_HALVES",
  125: "TEAM_WIN_BOTH_HALVES",
  126: "TEAM_WIN_BOTH_HALVES",
  "-30366": "TEAM_TO_LEAD",
  48: "WIN_TO_NIL",
  "-30367": "TEAM_TO_LEAD",
  130: "HOME_WIN_TO_NIL",
  "-30387": "TEAM_SCORES_TWO_CONSECUTIVE_GOALS",
  "-30388": "TEAM_TWO_GOALS_IN_A_ROW",
  "-8048": "TEAM_WIN_MATCH",
  "-8047": "TEAM_WIN_MATCH",
  "-8049": "ANY_TEAM_TO_WIN",
  87: "OFFSIDES_1X2",
  164: "OFFSIDES_TOTAL",
  165: "HOME_TEAM_TOTAL_OFFSIDES",
  166: "HOME_TEAM_TOTAL_OFFSIDES",
  "-271": "CORNERS_RANGE",
  "-2901": "MULTI_RESULT",
  138: "OWN_GOAL",
  "-8037": "DRAW_OR_OVER_2_5",
  "-30234": "HALF_TIME_SUBSTITUTION",
  38: "HALF_WITH_MORE_GOALS",
  "-239": "TEAM_HALF_WITH_MORE_GOALS",
  "-240": "HOME_HALF_WITH_MOST_GOALS",
  "-30199": "MOST_SHOTS_ON_TARGET",
  "-30149": "TOTAL_SHOTS_ON_TARGET",
  "-338": "WINNING_MARGIN",
  "-2959": "BOTH_HALVES_OVER_GOALS",
  "-30150": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "-2958": "BOTH_HALVES_UNDER_GOALS",
  "-30151": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "-30417": "TOTAL_XG",
  "-31167": "TOTAL_SHOTS",
  "-31168": "TEAM_TOTAL_SHOTS",
  "-31169": "TEAM_TOTAL_SHOTS",
  "-30200": "FOUL_RACE",
  "-30152": "FOULS_TOTAL",
  "-30229": "TEAM_TOTAL_FOULS",
  "-30230": "TEAM_TOTAL_FOULS",
  "-30402": "GOAL_KICKS_TOTAL",
  "-30401": "SAVES_TOTAL",
  "-30403": "THROW_INS_TOTAL",
  "-2973": "SECOND_HALF_FIRST_GOAL",
  "-2977": "FIRST_GOAL_TIME_ALT",
  "-232": "TEAMS_TO_SCORE",
  "-2957": "FIRST_GOAL_TIME",
  "-2960": "FIRST_GOAL_AND_RESULT",
  "-2545": "HALF_TIME_HOME_CLEAN_SHEET",
  "-2546": "HALF_TIME_HOME_CLEAN_SHEET",
  "-2547": "SECOND_HALF_HOME_CLEAN_SHEET",
  "-2548": "SECOND_HALF_HOME_CLEAN_SHEET",
  "-30704": "PLAYER_GOAL_OR_ASSIST",
  "-2903": "SECOND_HALF_GOAL_RANGE",
  "-30368": "PLAYER_OF_THE_MATCH",
  136: "SUBSTITUTE_GOAL",
  "-30414": "ANY_PLAYER_2_OR_MORE_GOALS",
  "-30411": "HAT_TRICK",
  160: "CORNERS_RACE",
  23: "CORNERS_TOTAL",
  "-30232": "GOAL_IN_FIRST_15_MIN",
  "-30233": "GOAL_IN_FIRST_30MIN",
  "-30373": "GOAL_IN_INTERVAL",
  "-30374": "GOAL_IN_INTERVAL",
  "-30375": "GOAL_IN_INTERVAL",
  "-30376": "GOAL_IN_INTERVAL",
  "-30377": "GOAL_IN_INTERVAL",
  115: "CORNERS_TEAM",
  116: "CORNERS_TEAM",
  "-30391": "GOAL_IN_TIME_PERIOD",
  "-30392": "FIRST_30_MIN_TOTAL_GOALS",
  "-30393": "TEAM_GOALS_BEFORE_MINUTE",
  "-30394": "FIRST_30_MIN_TOTAL_GOALS",
  "-30395": "TOTAL_GOALS_BY_60_MIN",
  "-30396": "TEAM_TOTAL_GOALS_FIRST_60MIN",
  "-30397": "TOTAL_GOALS_BY_60MIN",
  "-30389": "DRAW_IN_AT_LEAST_ONE_HALF",
  "-265": "CORNERS_TEAM",
  "-266": "CORNERS_TEAM_RANGE",
  105: "HALF_TIME_CORNERS_TOTAL",
  "-2954": "HALF_TIME_CORNERS_HANDICAP",
  "-2975": "CORNERS_HANDICAP",
  "-261": "HALF_TIME_CORNERS_RACE",
  "-180": "HALF_TIME_CORNERS_TEAM",
  171: "CARDS_RACE",
  13: "CARDS_TOTAL",
  "-182": "HALF_TIME_CORNERS_TEAM",
  "-30415": "TWO_PLAYERS_ANYTIME",
  "-30416": "BOTH_PLAYERS_ANYTIME",
  "-114": "SECOND_HALF_CORNERS_RACE",
  132: "CARDS_TEAM",
  108: "SECOND_HALF_CORNERS_TOTAL",
  "-181": "SECOND_HALF_CORNERS_TEAM",
  "-183": "SECOND_HALF_CORNERS_TEAM",
  "-267": "HALF_TIME_HOME_EXACT_CORNERS",
  133: "CARDS_TEAM",
  "-268": "HALF_TIME_HOME_EXACT_CORNERS",
  "-2971": "FIRST_CORNER",
  "-269": "LAST_CORNER",
  "-2953": "HALF_TIME_FIRST_CORNER",
  "-270": "HALF_TIME_LAST_CORNER",
  "-262": "CORNERS_ODD_EVEN",
  "-263": "HALF_TIME_CORNERS_ODD_EVEN",
  "-241": "HOME_EXACT_CARDS",
  "-242": "HOME_EXACT_CARDS",
  "-170": "HALF_TIME_CARDS_RACE",
  134: "HALF_TIME_CARDS_TOTAL",
  "-184": "HALF_TIME_CARDS_TEAM",
  "-244": "HALF_TIME_HOME_EXACT_CARDS",
  "-186": "HALF_TIME_CARDS_TEAM",
  "-243": "HALF_TIME_HOME_EXACT_CARDS",
  15: "PENALTY_AWARDED",
  "-30380": "MISSED_PENALTY",
  22: "RED_CARD",
  "-250": "RED_CARD_TEAM",
  "-251": "RED_CARD_TEAM",
  "-247": "HALF_TIME_RED_CARD",
  137: "RED_CARD_AND_PENALTY",
  "-2955": "FIRST_HALF_FIRST_CARD",
  "-2419": "PLAYER_SHOTS_ON_TARGET",
  "-2418": "PLAYER_SHOTS",
  "-8213": "PLAYER_CARDS",
  "-2412": "PLAYER_ASSISTS",
  "-2420": "PLAYER_PASSES",
  "-2422": "PLAYER_TACKLES",
  "-6008": "FIRST_HALF_ASIAN_HANDICAP",
};

const FORBET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /^1x2$/i, code: "MATCH_WINNER" },
  { pattern: /wynik\s*meczu/i, code: "MATCH_WINNER" },
  { pattern: /podw[oó]jna\s*szansa/i, code: "DOUBLE_CHANCE" },
  { pattern: /remis\s*=?\s*zwrot/i, code: "DRAW_NO_BET" },
  { pattern: /draw\s*no\s*bet/i, code: "DRAW_NO_BET" },
  { pattern: /obie.*strzel[aą]/i, code: "BTTS" },
  { pattern: /poni[zż]ej.*powy[zż]ej.*gol/i, code: "TOTAL_GOALS" },
  { pattern: /liczba\s*goli/i, code: "TOTAL_GOALS" },
  { pattern: /over.*under/i, code: "TOTAL_GOALS" },
  { pattern: /wynik\s*1\.?\s*po[lł]owy/i, code: "HALF_TIME_RESULT" },
  { pattern: /1\.?\s*po[lł]owa.*1x2/i, code: "HALF_TIME_RESULT" },
  { pattern: /1\.?\s*po[lł]owa.*gol/i, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /1\.?\s*po[lł]owa.*obie/i, code: "HALF_TIME_BTTS" },
  { pattern: /handicap\s*europejski/i, code: "EUROPEAN_HANDICAP" },
  { pattern: /handicap\s*azjatycki/i, code: "ASIAN_HANDICAP" },
  { pattern: /european\s*handicap/i, code: "EUROPEAN_HANDICAP" },
  { pattern: /asian\s*handicap/i, code: "ASIAN_HANDICAP" },
  { pattern: /dok[lł]adny\s*wynik/i, code: "CORRECT_SCORE" },
  { pattern: /correct\s*score/i, code: "CORRECT_SCORE" },
  { pattern: /po[lł]owa.*koniec/i, code: "HALFTIME_FULLTIME" },
  { pattern: /ht.*ft/i, code: "HALFTIME_FULLTIME" },
];

const FORBET_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "tak": "YES",
  "nie": "NO",
  "1x": "HOME_OR_DRAW",
  "1/x": "HOME_OR_DRAW",
  "x2": "DRAW_OR_AWAY",
  "x/2": "DRAW_OR_AWAY",
  "12": "HOME_OR_AWAY",
  "1/2": "HOME_OR_AWAY",
};

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();
  const lower = trimmed.toLowerCase();

  const override = FORBET_SELECTION_OVERRIDES[lower];
  if (override) return override;

  if (/^1\s*\([+-]/.test(trimmed)) return "HOME";
  if (/^2\s*\([+-]/.test(trimmed)) return "AWAY";
  if (/^x\s*\(/i.test(trimmed)) return "DRAW";

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
    case "FIRST_TEAM_TO_SCORE":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
      return normalizeYesNoSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "WINNING_MARGIN":
    case "GOAL_RANGE":
      return trimmed as NormalizedSelection;

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

const PARAMETERIZED_MARKETS = [
  "TOTAL_GOALS",
  "TOTAL_GOALS_ASIAN",
  "HALF_TIME_TOTAL_GOALS",
  "SECOND_HALF_TOTAL_GOALS",
  "TEAM_TOTAL_GOALS",
  "ASIAN_HANDICAP",
  "EUROPEAN_HANDICAP",
  "CORNERS_TOTAL",
  "CARDS_TOTAL",
  "CORNERS_HANDICAP",
  "RESULT_AND_TOTAL",
  "DOUBLE_CHANCE_TOTAL",
];

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  if (!PARAMETERIZED_MARKETS.includes(marketCode)) return undefined;

  const nameMatch = raw.name.match(/(\d+[.,]\d+)/);
  if (nameMatch) {
    return nameMatch[1].replace(",", ".");
  }

  if (marketCode === "ASIAN_HANDICAP" || marketCode === "EUROPEAN_HANDICAP" || marketCode === "CORNERS_HANDICAP") {
    const handicapMatch = raw.name.match(/([+-]?\d+[.,]?\d*)/);
    if (handicapMatch) {
      return parseHandicapLine(handicapMatch[1]);
    }
  }

  const selectionNames = raw.selections.map((s) => s.name);
  return parseOverUnderLine(selectionNames);
}

function matchMarketByName(name: string): NormalizedMarketType | null {
  const normalized = name.toLowerCase().trim();

  for (const { pattern, code } of FORBET_NAME_PATTERNS) {
    if (pattern.test(normalized)) {
      return code;
    }
  }

  return null;
}

function extractForbetGameType(raw: RawBookmakerMarket): number | null {
  if (raw.bookmakerMarketId !== undefined) {
    const id = Number(raw.bookmakerMarketId);
    if (!isNaN(id)) return id;
  }

  const match = raw.name.match(/^Rynek\s+(\d+)$/iu);
  return match ? Number(match[1]) : null;
}

export const forbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "forbet",

  normalizeMarket(
    raw: RawBookmakerMarket,
    ctx: NormalizationContext
  ): NormalizedMarketOutput | null {
    const gameTypeId = extractForbetGameType(raw);
    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" | "pattern" = "id";

    if (gameTypeId !== null) {
      marketCode = FORBET_MARKET_ID_TO_CODE[gameTypeId] ?? null;
    }

    if (!marketCode) {
      matchedBy = "name";
      marketCode = matchMarketByName(raw.name);
    }

    if (!marketCode) {
      console.warn(
        `[forbet] Unknown market: "${raw.name}" (gameType: ${gameTypeId ?? "none"})`
      );
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[forbet] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx),
      label: sel.name,
      odds: sel.odds,
    }));

    return {
      marketCode,
      paramValue,
      marketKey,
      selections,
      debug: {
        rawName: raw.name,
        rawId: gameTypeId ?? undefined,
        matchedBy,
      },
    };
  },
};

export default forbetNormalizer;
