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
  normalizeMarketName,
  parseOverUnderLine,
  parseDecimalLine,
  parseIntegerLine,
  parseHandicapLine,
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";
import { MARKET_TYPE_IDS } from "../../../scrapers/bookmakers/fortuna/constants.js";

const FORTUNA_MARKET_ID_TO_CODE: Record<string, NormalizedMarketType> = {
  [MARKET_TYPE_IDS.MATCH_RESULT]: "MATCH_WINNER",
  [MARKET_TYPE_IDS.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [MARKET_TYPE_IDS.OVER_UNDER]: "TOTAL_GOALS",
  [MARKET_TYPE_IDS.BTTS]: "BTTS",
  [MARKET_TYPE_IDS.HALF_TIME_RESULT]: "HALF_TIME_RESULT",
  [MARKET_TYPE_IDS.HALF_TIME_OVER_UNDER]: "HALF_TIME_TOTAL_GOALS",
  [MARKET_TYPE_IDS.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  [MARKET_TYPE_IDS.ASIAN_HANDICAP]: "ASIAN_HANDICAP",
  [MARKET_TYPE_IDS.EUROPEAN_HANDICAP]: "EUROPEAN_HANDICAP",
  [MARKET_TYPE_IDS.CORRECT_SCORE]: "CORRECT_SCORE",
  [MARKET_TYPE_IDS.DRAW_NO_BET]: "DRAW_NO_BET",
  [MARKET_TYPE_IDS.ODD_EVEN_GOALS]: "ODD_EVEN_GOALS",
  // Player props (stable Fortuna marketTypeId)
  "ufo:mtyp:00-ox": "PLAYER_HEADER_GOAL",
  "ufo:mtyp:00-ln": "PLAYER_GOALS",
  "ufo:mtyp:00-o6": "PLAYER_SHOTS_ON_TARGET",
  "ufo:mtyp:00-og": "PLAYER_SHOTS_ON_TARGET",
  "ufo:mtyp:00-lf": "PLAYER_SHOTS",
  "ufo:mtyp:00-la": "PLAYER_ASSISTS",
  "ufo:mtyp:00-lk": "PLAYER_CARDS",
  "ufo:mtyp:00-ok": "PLAYER_SHOTS_ON_TARGET",
  "ufo:mtyp:00-lg": "PLAYER_FOULS",
  "ufo:mtyp:00-ld": "PLAYER_SHOTS_ON_TARGET",
  "ufo:mtyp:00-nh": "GOALSCORER_LAST",
  "ufo:mtyp:00-nf": "GOALSCORER_FIRST",
  "ufo:mtyp:00-ne": "GOALSCORER_FIRST",
  "ufo:mtyp:00-ng": "GOALSCORER_LAST",
  "ufo:mtyp:00-hh": "PLAYER_FIRST_OR_LAST_GOAL",
  "ufo:mtyp:00-ow": "PLAYER_FOOT_GOAL",
  "ufo:mtyp:00-oy": "PLAYER_PENALTY_AREA_GOAL",
  "ufo:mtyp:00-oz": "PLAYER_GOAL_OUTSIDE_BOX",
  "ufo:mtyp:00-on": "PLAYER_SHOTS_OUTSIDE_BOX",
  "ufo:mtyp:00-oe": "PLAYER_SHOTS_IN_BOX",
  "ufo:mtyp:00-oi": "PLAYER_HEADER_SHOTS_ON_TARGET",
  "ufo:mtyp:00-nw": "PLAYER_OFFSIDES",
  "ufo:mtyp:00-pn": "PLAYER_OFFSIDES_1H",
  // ===== Fortuna final wave: id-to-code mappings =====
  "ufo:mtyp:00-hm": "PLAYER_GOAL_OR_ASSIST",
  "ufo:mtyp:00-71": "WIN_AND_PLAYER_SHOTS_ON_TARGET",
  "ufo:mtyp:00-76": "PLAYER_RED_CARD",
  "ufo:mtyp:00-70": "PLAYER_GOAL_AND_RESULT",
  "ufo:mtyp:00-0b": "ASIAN_HANDICAP",
  "ufo:mtyp:00-lo": "TOTAL_GOALS_MINIMUM",
  "ufo:mtyp:00-2i": "TOTAL_GOALS",
  "ufo:mtyp:00-kr": "CARDS_TOTAL",
  "ufo:mtyp:00-h7": "CORNERS_TOTAL",
  "ufo:mtyp:00-0k": "TOTAL_GOALS",
  "ufo:mtyp:00-13": "TOTAL_GOALS",
  "ufo:mtyp:00-0i": "CORNERS_TOTAL",
  "ufo:mtyp:00-0j": "TOTAL_GOALS",
  "ufo:mtyp:00-3b": "TOTAL_GOALS",
  "ufo:mtyp:00-kp": "CORNERS_TOTAL",
  "ufo:mtyp:00-hb": "TOTAL_GOALS",
  "ufo:mtyp:00-23": "DOUBLE_CHANCE_TOTAL",
  "ufo:mtyp:00-kn": "CORNERS_TOTAL",
  "ufo:mtyp:00-h3": "TOTAL_GOALS",
  "ufo:mtyp:00-37": "ASIAN_HANDICAP_PUSH",
  "ufo:mtyp:00-0h": "ASIAN_HANDICAP",
  "ufo:mtyp:00-0t": "TOTAL_GOALS",
  "ufo:mtyp:00-ko": "CORNERS_TOTAL",
  "ufo:mtyp:00-2k": "TOTAL_GOALS",
  "ufo:mtyp:00-10": "TOTAL_GOALS",
  "ufo:mtyp:00-1l": "RESULT_AND_TOTAL",
  "ufo:mtyp:00-3d": "TOTAL_GOALS",
  "ufo:mtyp:00-k6": "TOTAL_GOALS",
  "ufo:mtyp:00-l6": "TOTAL_GOALS",
  "ufo:mtyp:00-s6": "TOTAL_GOALS",
  "ufo:mtyp:00-rw": "TOTAL_GOALS",
  "ufo:mtyp:00-2j": "TOTAL_GOALS",
  "ufo:mtyp:00-3c": "TOTAL_GOALS",
  "ufo:mtyp:00-gg": "MATCH_WINNER",
  "ufo:mtyp:00-7d": "TEAM_WIN_OR_OVER_GOALS",
  "ufo:mtyp:00-21": "DOUBLE_CHANCE_BTTS",
  "ufo:mtyp:00-re": "ASIAN_HANDICAP",
  "ufo:mtyp:00-60": "MATCH_WINNER",
  "ufo:mtyp:00-gd": "MATCH_WINNER",
  "ufo:mtyp:00-1y": "DOUBLE_CHANCE_BTTS",
  "ufo:mtyp:00-7e": "TEAM_WIN_OR_TOTAL_UNDER",
  "ufo:mtyp:00-0m": "GOAL_RANGE",
  "ufo:mtyp:00-0l": "CORNERS_RANGE",
  "ufo:mtyp:00-2x": "MATCH_WINNER",
  "ufo:mtyp:00-7b": "TEAM_WIN_OR_OVER",
  "ufo:mtyp:00-9b": "VAR_REVIEW",
  "ufo:mtyp:00-0p": "MATCH_WINNER",
  "ufo:mtyp:00-gj": "MATCH_WINNER",
  "ufo:mtyp:00-o0": "FIRST_TEAM_TO_SCORE",
  "ufo:mtyp:00-hu": "MATCH_WINNER",
  "ufo:mtyp:00-gh": "MATCH_WINNER",
  "ufo:mtyp:00-0e": "MATCH_WINNER",
  "ufo:mtyp:00-r7": "PENALTY_IN_BOTH_HALVES",
  "ufo:mtyp:00-rz": "TIME_PERIOD_RESULT",
  "ufo:mtyp:00-s1": "TIME_PERIOD_RESULT",
  "ufo:mtyp:00-ru": "MATCH_WINNER",
  "ufo:mtyp:00-rx": "TIME_PERIOD_RESULT",
  "ufo:mtyp:00-m8": "HALF_TIME_SUBSTITUTION",
  "ufo:mtyp:00-28": "MULTI_RESULT",
  "ufo:mtyp:00-2d": "HALF_TIME_RESULT",
  "ufo:mtyp:00-61": "MATCH_WINNER",
  "ufo:mtyp:00-1e": "TEAMS_TO_SCORE",
  "ufo:mtyp:00-2y": "DOUBLE_CHANCE",
  "ufo:mtyp:00-1t": "HALF_WITH_MORE_GOALS",
  "ufo:mtyp:00-m7": "SUBSTITUTE_GOAL",
  "ufo:mtyp:00-2m": "ODD_EVEN_GOALS",
  "ufo:mtyp:00-2q": "RESULT_AND_BTTS",
  "ufo:mtyp:00-3j": "CORRECT_SCORE",
  "ufo:mtyp:00-1n": "HALFTIME_FULLTIME",
  "ufo:mtyp:00-22": "DOUBLE_CHANCE_BTTS",
  "ufo:mtyp:00-20": "RESULT_AND_TOTAL",
  "ufo:mtyp:00-2s": "FIRST_TEAM_TO_SCORE",
  "ufo:mtyp:00-5z": "MATCH_WINNER",
  "ufo:mtyp:00-2w": "SECOND_HALF_RESULT",
  "ufo:mtyp:00-1k": "TOTAL_GOALS_AND_BTTS",
  "ufo:mtyp:00-2z": "DRAW_NO_BET",
  "ufo:mtyp:00-1v": "HOME_HALF_WITH_MOST_GOALS",
  "ufo:mtyp:00-7a": "FIRST_GOAL_TIME",
  "ufo:mtyp:00-2r": "RESULT_AND_TOTAL",
  "ufo:mtyp:00-26": "BTTS_BY_HALF",
  "ufo:mtyp:00-1b": "HOME_TEAM_ODD_EVEN_GOALS",
  "ufo:mtyp:00-1f": "TEAM_CLEAN_SHEET",
  "ufo:mtyp:00-38": "TEAM_WIN",
  "ufo:mtyp:00-3a": "LAST_TEAM_TO_SCORE",
  "ufo:mtyp:00-1g": "HOME_CLEAN_SHEET",
  "ufo:mtyp:00-36": "TEAM_WINS_MATCH",
  "ufo:mtyp:00-q0": "HALF_TIME_STOPPAGE_TIME_GOAL",
  "ufo:mtyp:00-q1": "SECOND_HALF_ADDED_TIME_GOAL",
  "ufo:mtyp:00-q2": "INJURY_TIME_GOAL",
  "ufo:mtyp:00-2f": "DOUBLE_CHANCE",
  "ufo:mtyp:00-39": "MATCH_HAS_WINNER",
  "ufo:mtyp:00-1u": "HOME_HALF_WITH_MOST_GOALS",
  "ufo:mtyp:00-24": "GOAL_RANGE",
};

const FORTUNA_MARKET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /^wynik meczu/, code: "MATCH_WINNER" },
  { pattern: /^podwojna szansa/, code: "DOUBLE_CHANCE" },
  { pattern: /^obie druzyny strzela/, code: "BTTS" },
  { pattern: /^liczba goli.*1\.?\s*polow/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^liczba goli/, code: "TOTAL_GOALS" },
  { pattern: /^wynik\s*1\.?\s*polow/, code: "HALF_TIME_RESULT" },
  { pattern: /^obie strzel.*1\.?\s*polow/, code: "HALF_TIME_BTTS" },
  { pattern: /^handicap azjatycki/, code: "ASIAN_HANDICAP" },
  { pattern: /^handicap europejski/, code: "EUROPEAN_HANDICAP" },
  { pattern: /^dokladny wynik/, code: "CORRECT_SCORE" },
  { pattern: /^remis\s*=\s*zwrot/, code: "DRAW_NO_BET" },
  { pattern: /^parzyste\/nieparzyste/, code: "ODD_EVEN_GOALS" },
];

function findMarketCodeFromName(name: string): NormalizedMarketType | null {
  const normalized = normalizeMarketName(name);

  for (const { pattern, code } of FORTUNA_MARKET_NAME_PATTERNS) {
    if (pattern.test(normalized)) return code;
  }

  return null;
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "DRAW_NO_BET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "HALF_TIME_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  const groupName = raw.groupName ?? "";

  switch (metadata.parameterType) {
    case "handicap":
      return (
        selectionNames.map((name) => parseHandicapLine(name)).find(Boolean) ??
        parseHandicapLine(raw.name) ??
        parseHandicapLine(groupName)
      );

    case "integer":
      return (
        parseOverUnderLine(selectionNames) ??
        parseIntegerLine(raw.name) ??
        parseIntegerLine(groupName)
      );

    default:
      return (
        parseOverUnderLine(selectionNames) ??
        parseDecimalLine(raw.name) ??
        parseDecimalLine(groupName)
      );
  }
}

export const fortunaNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "fortuna",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const marketId = raw.bookmakerMarketId ? String(raw.bookmakerMarketId) : null;

    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" = "id";

    if (marketId && marketId in FORTUNA_MARKET_ID_TO_CODE) {
      marketCode = FORTUNA_MARKET_ID_TO_CODE[marketId];
    }

    if (!marketCode) {
      matchedBy = "name";
      marketCode = findMarketCodeFromName(raw.name);
    }

    if (!marketCode) {
      console.warn(`[fortuna] Unknown market: "${raw.name}" (id: ${marketId ?? "none"})`);
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[fortuna] Market code "${marketCode}" not in catalog`);
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
        rawId: marketId ?? undefined,
        matchedBy,
      },
    };
  },

};

export default fortunaNormalizer;
