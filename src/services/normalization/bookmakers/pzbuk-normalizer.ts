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

const PZBUK_MARKET_ID_TO_CODE: Record<string, NormalizedMarketType> = {
  "1": "MATCH_WINNER",
  "2": "HALF_TIME_RESULT",
  "3": "EUROPEAN_HANDICAP",
  "4": "HALFTIME_FULLTIME",
  "5": "ASIAN_HANDICAP",
  "8": "CORRECT_SCORE",
  "10": "DOUBLE_CHANCE",
  "11": "DRAW_NO_BET",
  "12": "GOALSCORER_FIRST",
  "13": "GOALSCORER_LAST",
  "14": "GOALSCORER_ANYTIME",
  "17": "TOTAL_GOALS",
  "18": "HALF_TIME_TOTAL_GOALS",
  "19": "TEAM_TOTAL_GOALS",
  "20": "TEAM_TOTAL_GOALS",
  "21": "ODD_EVEN_GOALS",
  "22": "SECOND_HALF_RESULT",
  "23": "SECOND_HALF_TOTAL_GOALS",
  "24": "WIN_TO_NIL",
  "25": "WIN_TO_NIL",
  "26": "WIN_TO_NIL",
  "27": "BTTS",
  "28": "WIN_TO_NIL",
  "29": "HALF_TIME_BTTS",
  "30": "HALF_TIME_BTTS",
  "31": "WIN_TO_NIL",
  "32": "BOTH_HALVES_GOALS",
  "33": "CLEAN_SHEET",
  "34": "CLEAN_SHEET",
  "35": "GOAL_RANGE",
  "36": "GOAL_RANGE",
  "37": "TEAM_TOTAL_GOALS",
  "38": "TEAM_TOTAL_GOALS",
  "39": "RESULT_AND_BTTS",
  "40": "RESULT_AND_TOTAL",
  "41": "DOUBLE_CHANCE_BTTS",
  "42": "DOUBLE_CHANCE_TOTAL",
};

const PZBUK_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "Tie": "DRAW",
  "tie": "DRAW",
  "Home": "HOME",
  "home": "HOME",
  "Away": "AWAY",
  "away": "AWAY",
  "Draw": "DRAW",
  "draw": "DRAW",
  "HomeOrDraw": "HOME_OR_DRAW",
  "DrawOrAway": "DRAW_OR_AWAY",
  "HomeOrAway": "HOME_OR_AWAY",
  "Over": "OVER",
  "over": "OVER",
  "Under": "UNDER",
  "under": "UNDER",
  "Yes": "YES",
  "yes": "YES",
  "No": "NO",
  "no": "NO",
};

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();
  
  const override = PZBUK_SELECTION_OVERRIDES[trimmed];
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
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "BOTH_HALVES_GOALS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "RESULT_AND_BTTS":
    case "RESULT_AND_TOTAL":
    case "DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_TOTAL":
      return parseCombinationSelection(trimmed, ctx);

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam);
  }
}

function parseCombinationSelection(
  selName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const lower = selName.toLowerCase();
  
  if (/1.*tak|home.*yes/i.test(lower)) return "HOME_YES" as NormalizedSelection;
  if (/1.*nie|home.*no/i.test(lower)) return "HOME_NO" as NormalizedSelection;
  if (/x.*tak|draw.*yes|remis.*tak/i.test(lower)) return "DRAW_YES" as NormalizedSelection;
  if (/x.*nie|draw.*no|remis.*nie/i.test(lower)) return "DRAW_NO" as NormalizedSelection;
  if (/2.*tak|away.*yes/i.test(lower)) return "AWAY_YES" as NormalizedSelection;
  if (/2.*nie|away.*no/i.test(lower)) return "AWAY_NO" as NormalizedSelection;

  if (/1.*over|1.*ponad|home.*over/i.test(lower)) return "HOME_OVER" as NormalizedSelection;
  if (/1.*under|1.*poniżej|home.*under/i.test(lower)) return "HOME_UNDER" as NormalizedSelection;
  if (/x.*over|draw.*over|remis.*ponad/i.test(lower)) return "DRAW_OVER" as NormalizedSelection;
  if (/x.*under|draw.*under|remis.*poniżej/i.test(lower)) return "DRAW_UNDER" as NormalizedSelection;
  if (/2.*over|away.*over/i.test(lower)) return "AWAY_OVER" as NormalizedSelection;
  if (/2.*under|away.*under/i.test(lower)) return "AWAY_UNDER" as NormalizedSelection;

  if (/1x.*tak|home.*draw.*yes/i.test(lower)) return "1X_YES" as NormalizedSelection;
  if (/1x.*nie|home.*draw.*no/i.test(lower)) return "1X_NO" as NormalizedSelection;
  if (/x2.*tak|draw.*away.*yes/i.test(lower)) return "X2_YES" as NormalizedSelection;
  if (/x2.*nie|draw.*away.*no/i.test(lower)) return "X2_NO" as NormalizedSelection;
  if (/12.*tak|home.*away.*yes/i.test(lower)) return "12_YES" as NormalizedSelection;
  if (/12.*nie|home.*away.*no/i.test(lower)) return "12_NO" as NormalizedSelection;

  return normalize1x2Selection(selName, ctx.homeTeam, ctx.awayTeam);
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const parameterizedMarkets = [
    "TOTAL_GOALS",
    "TOTAL_GOALS_ASIAN",
    "HALF_TIME_TOTAL_GOALS",
    "SECOND_HALF_TOTAL_GOALS",
    "TEAM_TOTAL_GOALS",
    "ASIAN_HANDICAP",
    "EUROPEAN_HANDICAP",
    "RESULT_AND_TOTAL",
    "DOUBLE_CHANCE_TOTAL",
  ];

  if (!parameterizedMarkets.includes(marketCode)) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  const lineFromSelections = parseOverUnderLine(selectionNames);
  if (lineFromSelections) return lineFromSelections;

  const nameMatch = raw.name.match(/(\d+[.,]\d+)/);
  if (nameMatch) return nameMatch[1].replace(",", ".");

  if (marketCode === "ASIAN_HANDICAP" || marketCode === "EUROPEAN_HANDICAP") {
    for (const sel of raw.selections) {
      const handicapLine = parseHandicapLine(sel.name);
      if (handicapLine) return handicapLine;
    }
  }

  return undefined;
}

export const pzbukNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "pzbuk",

  normalizeMarket(
    raw: RawBookmakerMarket,
    ctx: NormalizationContext
  ): NormalizedMarketOutput | null {
    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" = "id";

    if (raw.bookmakerMarketId) {
      const marketId = String(raw.bookmakerMarketId);
      marketCode = PZBUK_MARKET_ID_TO_CODE[marketId] ?? null;
    }

    if (!marketCode) {
      matchedBy = "name";
      marketCode = matchMarketByName(raw.name);
    }

    if (!marketCode) {
      console.warn(
        `[pzbuk] Unknown market: "${raw.name}" (id: ${raw.bookmakerMarketId ?? "none"})`
      );
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[pzbuk] Market code "${marketCode}" not in catalog`);
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
        rawId: raw.bookmakerMarketId,
        matchedBy,
      },
    };
  },

  normalizeMarkets(
    markets: RawBookmakerMarket[],
    ctx: NormalizationContext
  ): NormalizedMarketOutput[] {
    return markets
      .map((m) => this.normalizeMarket(m, ctx))
      .filter((m): m is NormalizedMarketOutput => m !== null);
  },
};

function matchMarketByName(name: string): NormalizedMarketType | null {
  const lower = name.toLowerCase();

  if (/^(wynik meczu|1x2|match result)$/i.test(lower)) return "MATCH_WINNER";
  if (/podw[óo]jna szansa|double chance/i.test(lower)) return "DOUBLE_CHANCE";
  if (/remis bez zak[łl]adu|draw no bet/i.test(lower)) return "DRAW_NO_BET";

  if (/liczba goli|total goals|over.?under/i.test(lower)) return "TOTAL_GOALS";
  if (/obie strzel[aą]|btts|both teams/i.test(lower)) return "BTTS";
  if (/parzyste|nieparzyste|odd.?even/i.test(lower)) return "ODD_EVEN_GOALS";
  if (/wygrana do zera|win to nil/i.test(lower)) return "WIN_TO_NIL";
  if (/czyste konto|clean sheet/i.test(lower)) return "CLEAN_SHEET";

  if (/handicap azjatycki|asian handicap/i.test(lower)) return "ASIAN_HANDICAP";
  if (/handicap europejski|european handicap|handicap/i.test(lower)) return "EUROPEAN_HANDICAP";

  if (/wynik.*1.*po[łl]ow|half.?time.*result/i.test(lower)) return "HALF_TIME_RESULT";
  if (/gole.*1.*po[łl]ow|half.?time.*goals/i.test(lower)) return "HALF_TIME_TOTAL_GOALS";
  if (/btts.*1.*po[łl]ow|half.?time.*btts/i.test(lower)) return "HALF_TIME_BTTS";

  if (/wynik.*2.*po[łl]ow|second.*half.*result/i.test(lower)) return "SECOND_HALF_RESULT";
  if (/gole.*2.*po[łl]ow|second.*half.*goals/i.test(lower)) return "SECOND_HALF_TOTAL_GOALS";

  if (/dok[łl]adny wynik|correct score/i.test(lower)) return "CORRECT_SCORE";

  if (/przerwa.*koniec|ht.*ft|half.?time.*full.?time/i.test(lower)) return "HALFTIME_FULLTIME";

  if (/pierwszy strzelec|first.*goal/i.test(lower)) return "GOALSCORER_FIRST";
  if (/ostatni strzelec|last.*goal/i.test(lower)) return "GOALSCORER_LAST";
  if (/strzelec.*meczu|anytime.*goal/i.test(lower)) return "GOALSCORER_ANYTIME";

  if (/wynik.*btts|result.*btts/i.test(lower)) return "RESULT_AND_BTTS";
  if (/wynik.*gole|result.*total/i.test(lower)) return "RESULT_AND_TOTAL";

  return null;
}

export default pzbukNormalizer;
