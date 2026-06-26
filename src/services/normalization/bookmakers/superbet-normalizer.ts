import type {
  BookmakerMarketNormalizer,
  NormalizationContext,
  NormalizedMarketOutput,
  NormalizedMarketType,
  NormalizedSelection,
  RawBookmakerMarket,
} from "../types.js";
import {
  buildMarketKey,
  normalize1x2Selection,
  normalizeDoubleChanceSelection,
  normalizeMarketName,
  normalizeOddEvenSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  parseDecimalLine,
  parseHandicapLine,
  parseHtFtSelection,
  parseIntegerLine,
  parseOverUnderLine,
  parseScoreSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const SUPERBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  547: "MATCH_WINNER",
  548: "DOUBLE_CHANCE",
  531: "DOUBLE_CHANCE",
  539: "BTTS",
  559: "BTTS",
  200734: "TOTAL_GOALS",
  551: "TOTAL_GOALS",
  552: "TOTAL_GOALS",
  549: "ASIAN_HANDICAP",
  550: "EUROPEAN_HANDICAP",
  553: "HALF_TIME_RESULT",
  554: "HALF_TIME_TOTAL_GOALS",
  557: "HALF_TIME_BTTS",
  556: "CORRECT_SCORE",
  600: "GOALSCORER_ANYTIME",
  601: "GOALSCORER_FIRST",
  558: "ODD_EVEN_GOALS",
  560: "DRAW_NO_BET",
  561: "WIN_TO_NIL",
  562: "CLEAN_SHEET",
  236218: "PLAYER_SHOTS",
  236240: "GOALSCORER_ANYTIME",
  201787: "GOALSCORER_ANYTIME",
  239910: "GOALSCORER_ANYTIME",
  236226: "GOALSCORER_ANYTIME",
  236242: "GOALSCORER_ANYTIME",
  236230: "GOALSCORER_ANYTIME",
  236232: "GOALSCORER_ANYTIME",
  236244: "GOALSCORER_ANYTIME",
  236424: "GOALSCORER_ANYTIME",
  236430: "GOALSCORER_ANYTIME",
  236428: "GOALSCORER_ANYTIME",
  236436: "GOALSCORER_ANYTIME",
  236426: "GOALSCORER_ANYTIME",
  239911: "CORRECT_SCORE",
  236224: "PLAYER_GOALS",
  233482: "GOALSCORER_ANYTIME",
  233483: "GOALSCORER_ANYTIME",
  236246: "GOALSCORER_ANYTIME",
  704: "TOTAL_GOALS",
  233484: "TWO_PLAYERS_ANYTIME",
  233485: "BOTH_PLAYERS_ANYTIME",
  230900: "TOTAL_SHOTS",
  200248: "GOAL_BY_MINUTE",
  200702: "TOTAL_GOALS",
  200690: "TOTAL_SHOTS",
  201659: "TOTAL_SHOTS",
  230933: "CORNERS_TOTAL",
  733: "TOTAL_GOALS",
  878: "TOTAL_GOALS",
  233486: "GOALSCORER_ANYTIME",
  233487: "GOALSCORER_ANYTIME",
  201591: "CORNERS_TOTAL",
  201592: "CORNERS_TOTAL",
  200691: "CORNERS_TOTAL",
  200692: "CORNERS_TOTAL",
  201660: "CORNERS_TOTAL",
  201661: "CORNERS_TOTAL",
  230901: "CORNERS_TOTAL",
  230902: "CORNERS_TOTAL",
  230934: "TOTAL_GOALS",
  713: "TOTAL_GOALS",
  200704: "TOTAL_GOALS",
  230935: "TOTAL_GOALS",
  200703: "TOTAL_GOALS",
  200714: "TOTAL_GOALS",
  200247: "RESULT_AT_MINUTE",
  535: "TOTAL_GOALS",
  200736: "ASIAN_HANDICAP",
  542: "DOUBLE_CHANCE_TOTAL",
  873: "TOTAL_GOALS",
  884: "TOTAL_GOALS",
  690: "TOTAL_GOALS",
  201597: "CORNERS_TOTAL",
  201614: "CORNERS_TOTAL",
  230904: "CORNERS_TOTAL",
  544: "TOTAL_GOALS",
  201511: "HALFTIME_FULLTIME_AND_TOTAL",
  233488: "GOALSCORER_ANYTIME",
  200709: "TOTAL_GOALS",
  200755: "RESULT_AND_TOTAL",
  200756: "RESULT_AND_TOTAL",
  200773: "RESULT_OR_TOTAL",
  200571: "TOTAL_GOALS_AND_BTTS",
  231001: "TOTAL_GOALS",
  231005: "TOTAL_GOALS",
  231000: "TOTAL_GOALS",
  231004: "TOTAL_GOALS",
  231002: "TOTAL_GOALS",
  231003: "TOTAL_GOALS",
  200735: "TOTAL_GOALS",
  200737: "ASIAN_HANDICAP",
  200738: "TOTAL_GOALS",
  200739: "ASIAN_HANDICAP",
  201519: "RESULT_OR_TOTAL",
  732: "ASIAN_HANDICAP",
  706: "NTH_CORNER",
  201526: "TOTAL_GOALS",
  201615: "TOTAL_GOALS",
  201616: "CORNERS_TOTAL",
  200697: "CORNERS_TOTAL",
  238103: "TOTAL_GOALS",
  234753: "TOTAL_GOALS",
  234754: "TOTAL_GOALS",
  230909: "TOTAL_SHOTS",
  230942: "CORNERS_TOTAL",
  546: "EUROPEAN_HANDICAP",
  700: "TOTAL_GOALS",
  708: "TOTAL_GOALS",
  1009: "TOTAL_GOALS",
  238104: "TOTAL_GOALS_OVER_LINES",
  200715: "TOTAL_GOALS",
  200716: "TOTAL_GOALS",
  200721: "TOTAL_GOALS_OVER_LINE",
  236432: "GOALSCORER_ANYTIME",
  2529: "TOTAL_GOALS",
  2531: "TOTAL_GOALS",
  201506: "TOTAL_GOALS",
  201507: "TOTAL_GOALS",
  872: "ASIAN_HANDICAP",
  231045: "TOTAL_GOALS",
  232924: "ASIAN_HANDICAP",
  1010: "TOTAL_GOALS",
  200701: "ASIAN_HANDICAP",
  201527: "TOTAL_GOALS",
  232978: "TOTAL_GOALS",
  201589: "CORNERS_HANDICAP",
  201613: "ASIAN_HANDICAP",
  201568: "CORNERS_TOTAL",
  201683: "FOULS_TOTAL",
  238107: "TOTAL_GOALS",
  230910: "CORNERS_TOTAL",
  230911: "CORNERS_TOTAL",
  230943: "TOTAL_GOALS",
  230944: "TOTAL_GOALS",
  1007: "TOTAL_GOALS",
  233527: "TOTAL_GOALS",
  200743: "TOTAL_GOALS",
  715: "TOTAL_GOALS",
  693: "TOTAL_GOALS",
  729: "TOTAL_GOALS",
  200742: "TOTAL_GOALS",
  239944: "DRAW_NO_BET",
  2365: "DOUBLE_RESULT",
  201521: "DOUBLE_RESULT_PAIR",
  200914: "SAME_RESULT_BOTH_HALVES",
  200748: "MATCH_WINNER",
  555: "DRAW_NO_BET",
  537: "CORRECT_SCORE",
  200791: "MULTI_RESULT",
  200807: "GOAL_RANGE",
  200818: "GOAL_RANGE",
  200831: "GOAL_RANGE",
  201803: "GOAL_RANGE",
  201804: "GOAL_RANGE",
  201805: "GOAL_RANGE",
  532: "RESULT_AND_BTTS",
  200752: "RESULT_AND_GOAL_RANGE",
  200762: "RESULT_AND_BTTS",
  533: "DOUBLE_CHANCE_BTTS",
  538: "FIRST_TEAM_TO_SCORE",
  200810: "FIRST_GOAL_AND_RESULT",
  200803: "MATCH_WINNER",
  574: "HALF_WITH_MORE_GOALS",
  200813: "HALF_WITH_MORE_GOALS",
  200827: "HALF_WITH_MORE_GOALS",
  200815: "HT_FT_CORRECT_SCORE",
  200820: "DOUBLE_CHANCE",
  200758: "GOAL_RANGE",
  200759: "GOAL_RANGE",
  563: "DRAW_NO_BET",
  1079: "HALF_TIME_CORRECT_SCORE",
  200241: "ODD_EVEN_GOALS",
  573: "DOUBLE_CHANCE",
  200829: "GOAL_RANGE",
  200760: "GOAL_RANGE",
  200761: "GOAL_RANGE",
  572: "DRAW_NO_BET",
  200819: "CORRECT_SCORE",
  200768: "DOUBLE_CHANCE_BTTS",
  717: "MATCH_WINNER",
  699: "CORNERS_RANGE",
  685: "CORNERS_TEAM",
  739: "CORNERS_TEAM",
  232535: "DRAW_NO_BET",
  200684: "FIRST_CORNER",
  702: "ODD_EVEN_GOALS",
  882: "MATCH_WINNER",
  881: "MATCH_WINNER",
  875: "HALF_TIME_CORNERS_RANGE",
  880: "ODD_EVEN_GOALS",
  696: "MATCH_WINNER",
  200246: "FIRST_CARD",
  200840: "MATCH_WINNER",
  238707: "ASIAN_HANDICAP",
  233941: "TOTAL_GOALS",
  233942: "TOTAL_GOALS",
  233943: "TOTAL_GOALS",
  200698: "MATCH_WINNER",
  200699: "MATCH_WINNER",
  201586: "MATCH_WINNER",
  201587: "DRAW_NO_BET",
  201610: "MATCH_WINNER",
  200687: "DRAW_NO_BET",
  201569: "TOTAL_GOALS",
  201656: "DRAW_NO_BET",
  201684: "CORNERS_TOTAL",
  238105: "TOTAL_GOALS",
  238106: "TOTAL_GOALS",
  200713: "ASIAN_HANDICAP",
  200711: "FIRST_TEAM_TO_SCORE",
  201763: "TOTAL_GOALS",
  201765: "TOTAL_GOALS",
  230932: "ASIAN_HANDICAP",
  230930: "DRAW_NO_BET",
  2370: "FIRST_GOAL_METHOD",
  233528: "TOTAL_GOALS",
  233529: "TOTAL_GOALS",
  233455: "TOTAL_GOALS",
  233456: "TOTAL_GOALS",
  233489: "TOTAL_GOALS",
  233490: "TOTAL_GOALS",
  233491: "TOTAL_GOALS",
  727: "FIRST_GOAL_TIME_ALT",
  735: "FIRST_GOAL_TIME",
  705: "MATCH_WINNER",
  711: "TOTAL_GOALS",
  695: "TOTAL_GOALS",
  725: "MATCH_WINNER",
  731: "MATCH_WINNER",
  723: "MATCH_WINNER",
  238567: "TOTAL_GOALS",
  238591: "TOTAL_GOALS",
  238573: "TOTAL_GOALS",
  238549: "TOTAL_GOALS",
  238568: "MATCH_WINNER",
  238592: "MATCH_WINNER",
  238574: "MATCH_WINNER",
  697: "MATCH_WINNER",
  543: "ODD_EVEN_GOALS",
  200243: "ODD_EVEN_GOALS",
  200236: "ODD_EVEN_GOALS",
  238550: "MATCH_WINNER",
};

const SUPERBET_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "1x": "HOME_OR_DRAW",
  "x2": "DRAW_OR_AWAY",
  "12": "HOME_OR_AWAY",
  gg: "YES",
  ng: "NO",
  "0": "DRAW",
};

const SUPERBET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /wynik meczu|koncowy wynik|1x2|zwyciezca meczu/, code: "MATCH_WINNER" },
  { pattern: /podwojna szansa|double chance/, code: "DOUBLE_CHANCE" },
  { pattern: /remis\s*=\s*zwrot|draw no bet|zaklad bez remisu/, code: "DRAW_NO_BET" },
  { pattern: /obie.*strzela.*1\.?\s*polow|1\.?\s*polow.*obie.*strzela/, code: "HALF_TIME_BTTS" },
  { pattern: /wynik\s*1\.?\s*polow|1\.?\s*polow.*wynik/, code: "HALF_TIME_RESULT" },
  { pattern: /liczba goli.*1\.?\s*polow|1\.?\s*polow.*liczba goli/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /obie.*strzela|btts|gg\/?ng/, code: "BTTS" },
  { pattern: /liczba goli|suma goli|over\/?under|o\/?u/, code: "TOTAL_GOALS" },
  { pattern: /handicap azjatycki|asian handicap/, code: "ASIAN_HANDICAP" },
  { pattern: /handicap europejski|european handicap/, code: "EUROPEAN_HANDICAP" },
  { pattern: /dokladny wynik|correct score/, code: "CORRECT_SCORE" },
  { pattern: /parzyste\/?nieparzyste|odd\/?even/, code: "ODD_EVEN_GOALS" },
  { pattern: /wygrana do zera|win to nil/, code: "WIN_TO_NIL" },
  { pattern: /czyste konto|clean sheet/, code: "CLEAN_SHEET" },
  { pattern: /pierwszy strzelec|first goalscorer/, code: "GOALSCORER_FIRST" },
  { pattern: /strzelec|goalscorer/, code: "GOALSCORER_ANYTIME" },
];

const PARAMETERIZED_MARKETS = new Set<NormalizedMarketType>([
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
]);

function extractSuperbetMarketId(marketName: string): number | null {
  const match = marketName.match(/^Rynek\s+(\d+)$/iu);
  return match ? Number(match[1]) : null;
}

function resolveMarketCode(raw: RawBookmakerMarket): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
  rawId?: number;
} {
  const marketId = raw.bookmakerMarketId
    ? Number(raw.bookmakerMarketId)
    : extractSuperbetMarketId(raw.name);

  if (marketId && SUPERBET_MARKET_ID_TO_CODE[marketId]) {
    return {
      marketCode: SUPERBET_MARKET_ID_TO_CODE[marketId],
      matchedBy: "id",
      rawId: marketId,
    };
  }

  const normalizedName = normalizeMarketName(raw.name);
  for (const { pattern, code } of SUPERBET_NAME_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return { marketCode: code, matchedBy: "pattern", rawId: marketId ?? undefined };
    }
  }

  return {
    marketCode: "OTHER",
    matchedBy: "name",
    rawId: marketId ?? undefined,
  };
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const lower = trimmed.toLowerCase();

  const override = SUPERBET_SELECTION_OVERRIDES[lower];
  if (override) return override;

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
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

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

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
    case "GOALSCORER_ANYTIME":
    case "GOALSCORER_LAST":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "OTHER":
      return "UNKNOWN";

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(marketCode: NormalizedMarketType, raw: RawBookmakerMarket): string | undefined {
  if (!PARAMETERIZED_MARKETS.has(marketCode)) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);

  if (marketCode === "ASIAN_HANDICAP" || marketCode === "EUROPEAN_HANDICAP") {
    for (const name of selectionNames) {
      const handicap = parseHandicapLine(name);
      if (handicap) return handicap;
    }
    const handicapFromName = parseHandicapLine(raw.name);
    if (handicapFromName) return handicapFromName;
  }

  const paramFromSelections = parseOverUnderLine(selectionNames);
  if (paramFromSelections) return paramFromSelections;

  const decimalLine = parseDecimalLine(raw.name);
  if (decimalLine) return decimalLine;

  const integerLine = parseIntegerLine(raw.name);
  if (integerLine) return integerLine;

  return undefined;
}

export const superbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "superbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId } = resolveMarketCode(raw);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[superbet] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const marketMetadata = getMarketMetadata(marketCode);
    const marketName = marketMetadata?.labels.pl ?? raw.name;

    const paramValue = extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode, ctx),
      label: sel.name,
      odds: sel.odds,
    }));

    if (marketCode === "OTHER") {
      console.warn(`[superbet] Unmapped market "${raw.name}" (id: ${rawId ?? "none"})`);
    }

    return {
      marketCode,
      paramValue,
      marketKey,
      marketName,
      selections,
      debug: {
        rawName: raw.name,
        rawId: rawId ?? undefined,
        matchedBy,
      },
    } as NormalizedMarketOutput;
  },

};

export default superbetNormalizer;
