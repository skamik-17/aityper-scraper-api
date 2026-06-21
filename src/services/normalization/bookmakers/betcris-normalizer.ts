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
  parseHandicapLine,
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { isValidMarketCode } from "../../../data/market-catalog.js";

const BETCRIS_MARKET_TYPE_TO_CODE: Record<string, NormalizedMarketType> = {
  "P1XP2": "MATCH_WINNER",
  "1X12X2": "DOUBLE_CHANCE",
  "P1XP2DC": "DOUBLE_CHANCE",
  "DrawNoBet": "DRAW_NO_BET",
  "OverUnder": "TOTAL_GOALS",
  "BothTeamsToScore": "BTTS",
  "OddEven": "ODD_EVEN_GOALS",
  "WinToNil": "WIN_TO_NIL",
  "CleanSheet": "CLEAN_SHEET",
  "Team1OverUnder": "TEAM_TOTAL_GOALS",
  "Team2OverUnder": "TEAM_TOTAL_GOALS",
  "P1XP2FirstHalf": "HALF_TIME_RESULT",
  "HalfTimeOverUnder": "HALF_TIME_TOTAL_GOALS",
  "BothTeamsToScoreFirstHalf": "HALF_TIME_BTTS",
  "AsianHandicap": "ASIAN_HANDICAP",
  "EuropeanHandicap": "EUROPEAN_HANDICAP",
  "CorrectScore": "CORRECT_SCORE",
  "HalftimeFulltime": "HALFTIME_FULLTIME",
};

const BETCRIS_SELECTION_CODES: Record<string, NormalizedSelection> = {
  "W1": "HOME",
  "w1": "HOME",
  "X": "DRAW",
  "x": "DRAW",
  "W2": "AWAY",
  "w2": "AWAY",
  "1X": "HOME_OR_DRAW",
  "1x": "HOME_OR_DRAW",
  "X2": "DRAW_OR_AWAY",
  "x2": "DRAW_OR_AWAY",
  "12": "HOME_OR_AWAY",
  "Over": "OVER",
  "over": "OVER",
  "Under": "UNDER",
  "under": "UNDER",
  "Yes": "YES",
  "yes": "YES",
  "No": "NO",
  "no": "NO",
  "Odd": "ODD",
  "odd": "ODD",
  "Even": "EVEN",
  "even": "EVEN",
};

function extractMarketType(raw: RawBookmakerMarket): string | null {
  if (raw.bookmakerMarketId) {
    return String(raw.bookmakerMarketId);
  }

  if (raw.groupName) {
    const groupLower = raw.groupName.toLowerCase();
    if (groupLower.includes("wynik meczu")) return "P1XP2";
    if (groupLower.includes("podwójna szansa") || groupLower.includes("podwojna szansa")) return "1X12X2";
    if (groupLower.includes("gole") && !groupLower.includes("drużyny") && !groupLower.includes("druzyny")) return "OverUnder";
    if (groupLower.includes("obie") && groupLower.includes("strzela")) return "BothTeamsToScore";
    if (groupLower.includes("pierwsza polowa") || groupLower.includes("1. polowa")) return "P1XP2FirstHalf";
    if (groupLower.includes("handicap") && groupLower.includes("azjatycki")) return "AsianHandicap";
    if (groupLower.includes("handicap") && groupLower.includes("europejski")) return "EuropeanHandicap";
    if (groupLower.includes("dokładny wynik") || groupLower.includes("dokladny wynik")) return "CorrectScore";
  }

  return null;
}

function matchMarketByName(name: string): NormalizedMarketType | null {
  const lower = name.toLowerCase().trim();

  if (/^wynik\s+meczu$/i.test(lower) || /^1x2$/i.test(lower)) return "MATCH_WINNER";
  if (/podw[oó]jna\s+szansa/i.test(lower)) return "DOUBLE_CHANCE";
  if (/remis\s*[=:]\s*zwrot/i.test(lower) || /draw\s*no\s*bet/i.test(lower)) return "DRAW_NO_BET";

  if (/liczba\s+goli/i.test(lower) && !/(gospodarzy|go[sś]ci|drużyny|druzyny)/i.test(lower)) return "TOTAL_GOALS";
  if (/obie\s+(drużyny\s+)?strzela/i.test(lower) || /obie\s+druzyny\s+strzela/i.test(lower)) return "BTTS";
  if (/parzyste.*nieparzyste|nieparzyste.*parzyste|odd.*even/i.test(lower)) return "ODD_EVEN_GOALS";
  if (/wygrana\s+do\s+zera/i.test(lower)) return "WIN_TO_NIL";
  if (/czyste\s+konto/i.test(lower)) return "CLEAN_SHEET";

  if (/gole\s+(gospodarzy|drużyny\s+1|team\s*1)/i.test(lower)) return "TEAM_TOTAL_GOALS";
  if (/gole\s+(go[sś]ci|drużyny\s+2|team\s*2)/i.test(lower)) return "TEAM_TOTAL_GOALS";

  if (/wynik\s+1\.?\s*po[lł]owy/i.test(lower) || /1\.?\s*po[lł]owa.*wynik/i.test(lower)) return "HALF_TIME_RESULT";
  if (/gole?\s+1\.?\s*po[lł]ow/i.test(lower) || /1\.?\s*po[lł]owa.*gol/i.test(lower)) return "HALF_TIME_TOTAL_GOALS";
  if (/obie.*strzela.*1\.?\s*po[lł]ow/i.test(lower) || /1\.?\s*po[lł]owa.*obie.*strzela/i.test(lower)) return "HALF_TIME_BTTS";

  if (/handicap\s+azjatycki/i.test(lower) || /asian\s+handicap/i.test(lower)) return "ASIAN_HANDICAP";
  if (/handicap\s+europejski/i.test(lower) || /european\s+handicap/i.test(lower)) return "EUROPEAN_HANDICAP";

  if (/dok[lł]adny\s+wynik/i.test(lower) || /correct\s+score/i.test(lower)) return "CORRECT_SCORE";

  if (/wynik\s+po[lł]owa.*mecz|po[lł]owa.*koniec|ht.*ft/i.test(lower)) return "HALFTIME_FULLTIME";

  return null;
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();

  const directMapping = BETCRIS_SELECTION_CODES[trimmed];
  if (directMapping) return directMapping;

  const upperTrimmed = trimmed.toUpperCase();
  const lowerTrimmed = trimmed.toLowerCase();
  
  if (BETCRIS_SELECTION_CODES[upperTrimmed]) return BETCRIS_SELECTION_CODES[upperTrimmed];
  if (BETCRIS_SELECTION_CODES[lowerTrimmed]) return BETCRIS_SELECTION_CODES[lowerTrimmed];

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "HALF_TIME_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
      if (/^1\b|^w1\b|^home/i.test(trimmed)) return "HOME";
      if (/^2\b|^w2\b|^away/i.test(trimmed)) return "AWAY";
      if (/^x\b|^draw/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const parameterizedMarkets = [
    "TOTAL_GOALS",
    "HALF_TIME_TOTAL_GOALS",
    "TEAM_TOTAL_GOALS",
    "ASIAN_HANDICAP",
    "EUROPEAN_HANDICAP",
  ];

  if (!parameterizedMarkets.includes(marketCode)) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  
  if (["TOTAL_GOALS", "HALF_TIME_TOTAL_GOALS", "TEAM_TOTAL_GOALS"].includes(marketCode)) {
    return parseOverUnderLine(selectionNames);
  }

  if (["ASIAN_HANDICAP", "EUROPEAN_HANDICAP"].includes(marketCode)) {
    const nameMatch = raw.name.match(/([+-]?\d+[.,]?\d*)/);
    if (nameMatch) {
      return parseHandicapLine(nameMatch[1]);
    }
    
    for (const sel of raw.selections) {
      const handicapLine = parseHandicapLine(sel.name);
      if (handicapLine) return handicapLine;
    }
  }

  return undefined;
}

export const betcrisNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "betcris",

  normalizeMarket(
    raw: RawBookmakerMarket,
    ctx: NormalizationContext
  ): NormalizedMarketOutput | null {
    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" | "pattern" = "id";

    const marketType = extractMarketType(raw);
    if (marketType) {
      marketCode = BETCRIS_MARKET_TYPE_TO_CODE[marketType] ?? null;
    }

    if (!marketCode) {
      matchedBy = "name";
      marketCode = matchMarketByName(raw.name);
    }

    if (!marketCode && raw.groupName) {
      matchedBy = "pattern";
      marketCode = matchMarketByName(raw.groupName);
    }

    if (!marketCode) {
      console.warn(
        `[betcris] Unknown market: "${raw.name}" (type: ${marketType ?? "none"}, group: ${raw.groupName ?? "none"})`
      );
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[betcris] Market code "${marketCode}" not in catalog`);
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
        rawId: marketType ?? undefined,
        matchedBy,
      },
    };
  },
};

export default betcrisNormalizer;
