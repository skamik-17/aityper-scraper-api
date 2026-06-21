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
