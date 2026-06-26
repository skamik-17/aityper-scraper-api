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
