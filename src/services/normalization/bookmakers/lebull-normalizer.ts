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
  parseDecimalLine,
  parseHandicapLine,
  parseOverUnderLine,
  normalize1x2Selection,
  normalizeDoubleChanceSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const LEBULL_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  2: "ASIAN_HANDICAP",
  3: "TOTAL_GOALS",
  4: "HALFTIME_FULLTIME",
  5: "HALF_TIME_RESULT",
  6: "HALF_TIME_TOTAL_GOALS",
  // sbteam.xyz stake type 7 is "Połowa z największym wynikiem" (half with more
  // goals), not correct score — mirrors the betters mapping (shared backend).
  7: "HALF_WITH_MORE_GOALS",
  9: "DRAW_NO_BET",
  11: "HALF_TIME_RESULT",
  12: "HALF_TIME_TOTAL_GOALS",
  26: "BTTS",
  27: "HOME_TEAM_TO_SCORE",
  28: "AWAY_TEAM_TO_SCORE",
  32: "BOTH_HALVES_GOALS",
  36: "DRAW_NO_BET",
  37: "DOUBLE_CHANCE",
  38: "FIRST_GOAL_TIME",
  274556: "DRAW_NO_BET",
  40390: "ONE_TEAM_TO_SCORE",
  748: "NEXT_TEAM_TO_SCORE",
  333649: "LAST_TEAM_TO_SCORE",
  618: "TOTAL_GOALS_3WAY",
  5699564: "DOUBLE_CHANCE_GOAL_RANGE",
  5774433: "TOTAL_GOALS_AND_BTTS",
  607: "HT_OR_FT_RESULT",
  68: "FIRST_GOAL_METHOD",
  682: "CORRECT_SCORE",
  40424: "MULTI_RESULT",
  311019: "SCORE_REACHED",
  311021: "SCORE_OCCURS_DURING_MATCH",
  311022: "SCORE_TO_OCCUR",
  333182: "BTTS_BY_HALF",
  332816: "BTTS_AT_LEAST_ONE_HALF",
  262063: "BTTS_BOTH_HALVES",
  // 332818 ("Obie drużyny suma powyżej X") is routed by name + goal line in
  // resolveMarketCode — only the 0.5/1.5 lines have catalog counterparts
  // (BTTS / BTTS_2PLUS_GOALS), so a blanket id mapping would misroute other lines.
  332819: "BOTH_TEAMS_UNDER_GOALS",
  350077: "SECOND_HALF_RESULT_OR_BTTS",
  40414: "HOME_WIN_BOTH_HALVES",
  39504: "HOME_WIN_AT_LEAST_ONE_HALF",
  39505: "TEAM_WIN_AT_LEAST_ONE_HALF",
  332821: "EACH_TEAM_WINS_ONE_HALF",
  30: "HALF_TIME_GOAL",
  31: "SECOND_HALF_GOAL",
  332813: "BOTH_HALVES_OVER_GOALS",
  332814: "BOTH_HALVES_UNDER_GOALS",
  424467: "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE",
  583: "FIRST_GOAL_TIME_ALT",
  655: "FIRST_GOAL_TIME",
  329307: "GOAL_IN_TIME_PERIOD",
  40379: "GOAL_IN_TIME_PERIOD",
  40380: "GOAL_IN_TIME_PERIOD",
  40381: "GOAL_IN_TIME_PERIOD",
  40382: "GOAL_IN_TIME_PERIOD",
  40384: "GOAL_IN_TIME_PERIOD",
  40385: "GOAL_IN_TIME_PERIOD",
  40383: "GOAL_IN_TIME_PERIOD",
  40386: "GOAL_IN_TIME_PERIOD",
  40387: "GOAL_IN_TIME_PERIOD",
  40388: "GOAL_IN_TIME_PERIOD",
  40493: "GOAL_IN_TIME_PERIOD",
  40494: "GOAL_IN_TIME_PERIOD",
  40389: "GOAL_IN_TIME_PERIOD",
  290: "SCORING_DRAW",
  647: "DRAW_IN_AT_LEAST_ONE_HALF",
  5685188: "BOTH_TEAMS_TO_LEAD",
  40393: "HOME_WIN_TO_NIL",
  40394: "HOME_WIN_TO_NIL",
  650: "ANY_TEAM_WINNING_MARGIN_EXACT",
  651: "WINNING_MARGIN_ANY_EXACT",
  652: "ANY_TEAM_WIN_BY_MARGIN",
  543: "WIN_BY_1_OR_DRAW",
  677: "FIRST_GOAL_HALF",
  261964: "RACE_TO_GOALS",
  261965: "RACE_TO_GOALS",
  40497: "TOTAL_GOAL_MINUTES",
  5685190: "TEAM_GOAL_MINUTES_SUM",
  672: "TEAM_MINUTES_LEADING",
  671: "DRAW_MINUTES_TOTAL",
  670: "TEAM_MINUTES_IN_LEAD",
  421317: "HALF_TIME_AND_SECOND_HALF_RESULT",
  262275: "BOTH_HALVES_OVER_COMBO",
  270586: "TIME_PERIOD_TOTAL_GOALS",
  268285: "TIME_PERIOD_RESULT",
  270587: "TIME_PERIOD_TOTAL_GOALS",
  270588: "TIME_BAND_TOTAL_GOALS",
  268287: "TIME_PERIOD_RESULT",
  270589: "TIME_PERIOD_TOTAL_GOALS",
  270590: "TIME_PERIOD_TOTAL_GOALS",
  268289: "TIME_PERIOD_RESULT",
  270591: "TIME_PERIOD_TOTAL_GOALS",
  270618: "TIME_PERIOD_RESULT",
  175094: "TIME_PERIOD_RESULT",
  175095: "TIME_PERIOD_RESULT",
  270825: "TIME_SEGMENT_TOTAL_GOALS",
  270826: "TIME_PERIOD_TOTAL_GOALS",
  270827: "TIME_PERIOD_GOALS",
  270828: "TIME_PERIOD_TOTAL_GOALS",
  270829: "TIME_PERIOD_TOTAL_GOALS",
  270830: "TIME_PERIOD_TOTAL_GOALS",
  270831: "TIME_PERIOD_TOTAL_GOALS",
  270832: "TIME_PERIOD_TOTAL_GOALS",
  270833: "TIME_PERIOD_TOTAL_GOALS",
};

const LEBULL_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "remis = zwrot": "DRAW_NO_BET",
  "dokladny wynik": "CORRECT_SCORE",
  "obie druzyny strzela": "BTTS",
  "obie druzyny strzelą": "BTTS",
  "wynik 1. polowy": "HALF_TIME_RESULT",
  "wynik 2. polowy": "SECOND_HALF_RESULT",
};

const LEBULL_MARKET_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  // "Połowa z największym wynikiem" (1. < 2. / 1. = 2. / 1. > 2.) is a
  // half-comparison bet, not a correct score market.
  { pattern: /polowa\s*z\s*najwiekszym\s*wynikiem/, code: "HALF_WITH_MORE_GOALS" },
  // "Zawodnik zostanie usunięty z boiska" (a player will be sent off) is a
  // red-card market — must not fall through to the DRAW_NO_BET id fallback.
  { pattern: /zawodnik\s*zostanie\s*usuniet/, code: "RED_CARD" },
  { pattern: /wynik\s*meczu\s*i\s*suma/, code: "RESULT_AND_TOTAL" },
  { pattern: /wynik\s*meczu\s*i\s*obie\s*druzyny\s*strzela/, code: "RESULT_AND_BTTS" },
  { pattern: /podwojna\s*szansa\s*i\s*obie\s*druzyny\s*strzela/, code: "DOUBLE_CHANCE_BTTS" },
  { pattern: /podwojna\s*szansa\s*i\s*suma\s*goli/, code: "DOUBLE_CHANCE_TOTAL" },
  { pattern: /wynik\s*1\.?\s*polow/, code: "HALF_TIME_RESULT" },
  { pattern: /wynik\s*2\.?\s*polow/, code: "SECOND_HALF_RESULT" },
  { pattern: /obie\s*druzyny\s*strzela.*1\.?\s*polow/, code: "HALF_TIME_BTTS" },
  { pattern: /liczba\s*goli.*1\.?\s*polow/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /liczba\s*goli.*2\.?\s*polow/, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /handicap\s*3[-\s]?drogowy|handicap\s*europej/, code: "EUROPEAN_HANDICAP" },
  { pattern: /handicap/, code: "ASIAN_HANDICAP" },
  { pattern: /wygrana\s*do\s*zera/, code: "WIN_TO_NIL" },
  { pattern: /czyste\s*konto/, code: "CLEAN_SHEET" },
  { pattern: /pierwszy\s*strzelec/, code: "GOALSCORER_FIRST" },
  { pattern: /ostatni\s*strzelec/, code: "GOALSCORER_LAST" },
  { pattern: /strzelec/, code: "GOALSCORER_ANYTIME" },
];

/**
 * Extracts the time-period parameter as the END minute of the period range
 * (e.g. "Wynik meczu w przedziale 16-30 min" -> "30"), matching the convention
 * used by the betters normalizer so identical periods aggregate together.
 */
function extractTimePeriodParam(name: string): string | undefined {
  const normalized = normalizeMarketName(name);
  const rangeMatch = normalized.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) return rangeMatch[2];

  const minuteMatch = normalized.match(/\b(\d+)\b/);
  return minuteMatch ? minuteMatch[1] : undefined;
}

/**
 * Maps goal-time interval selections ("Od 1 do 15 min.", "Od 11 do 20 min.")
 * to the canonical "X-Y" interval codes; "Nikt"/"Brak gola" map to NONE.
 */
function normalizeGoalTimeRangeSelection(selectionName: string): NormalizedSelection {
  const normalized = normalizeMarketName(selectionName);

  if (/^(nikt|zaden|zadna|brak|bez\s*gola|brak\s*gola)/.test(normalized)) return "NONE";

  const wordedRange = normalized.match(/od\s*(\d+)\s*do\s*(\d+)/);
  if (wordedRange) return `${wordedRange[1]}-${wordedRange[2]}` as NormalizedSelection;

  const plainRange = normalized.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (plainRange) return `${plainRange[1]}-${plainRange[2]}` as NormalizedSelection;

  return selectionName.trim() as NormalizedSelection;
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): { marketCode: NormalizedMarketType; matchedBy: "id" | "name" | "pattern"; rawId?: number } {
  const normalizedName = normalizeMarketName(raw.name);

  const direct = LEBULL_MARKET_NAME_TO_CODE[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name" };
  }

  const home = ctx.homeTeam ? normalizeMarketName(ctx.homeTeam) : "";
  const away = ctx.awayTeam ? normalizeMarketName(ctx.awayTeam) : "";

  // Combo bets "team wins + goal range" (e.g. "Austria wygra i suma goli: 3-5")
  // are Tak/Nie markets with no catalog counterpart — keep them out of GOAL_RANGE.
  if (/wygra\s*i\s*suma\s*goli/.test(normalizedName)) {
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // "Suma goli parzyste/nieparzyste" is an odd/even market, not an over/under one.
  if (/parzyst/.test(normalizedName) && /(suma|liczba)\s*goli/.test(normalizedName)) {
    return { marketCode: "ODD_EVEN_GOALS", matchedBy: "pattern" };
  }

  // "Obie drużyny suma powyżej X" = each team scores over X goals. Only the
  // 0.5 line (both teams score = BTTS) and the 1.5 line (both teams score 2+
  // = BTTS_2PLUS_GOALS) have catalog counterparts; other lines fall to OTHER.
  if (/obie\s*druzyny\s*suma\s*powyzej/.test(normalizedName)) {
    const line = parseDecimalLine(normalizedName);
    if (line === "0.5") return { marketCode: "BTTS", matchedBy: "pattern" };
    if (line === "1.5") return { marketCode: "BTTS_2PLUS_GOALS", matchedBy: "pattern" };
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // "<Team> wygra do zera" — resolve which side the named team is so the
  // away-team variant does not land in HOME_WIN_TO_NIL (id fallback maps
  // both stake types there).
  const winToNilMatch = normalizedName.match(/^(.+?)\s*wygra\s*do\s*zera/);
  if (winToNilMatch) {
    const side = normalize1x2Selection(winToNilMatch[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
    if (side === "HOME") return { marketCode: "HOME_WIN_TO_NIL", matchedBy: "pattern" };
    if (side === "AWAY") return { marketCode: "AWAY_WIN_TO_NIL", matchedBy: "pattern" };
  }

  const isGoalRange = /suma\s*goli[:\s]+\d+\s*[-–]\s*\d+/i.test(normalizedName);
  if (isGoalRange) {
    return { marketCode: "GOAL_RANGE", matchedBy: "pattern" };
  }

  if (/suma\s*goli/.test(normalizedName)) {
    if ((home && normalizedName.includes(home)) || (away && normalizedName.includes(away))) {
      return { marketCode: "TEAM_TOTAL_GOALS", matchedBy: "pattern" };
    }
    return { marketCode: "TOTAL_GOALS", matchedBy: "pattern" };
  }

  if (/liczba\s*goli/.test(normalizedName)) {
    const lineMatch = normalizedName.match(/liczba\s*goli\s*(\d+(?:[.,]\d+)?)/);
    if (lineMatch) {
      const line = lineMatch[1].replace(",", ".");
      if (line.endsWith(".0") || /^\d+$/.test(line)) {
        return { marketCode: "TOTAL_GOALS_ASIAN", matchedBy: "pattern" };
      }
    }
    return { marketCode: "TOTAL_GOALS", matchedBy: "pattern" };
  }

  for (const entry of LEBULL_MARKET_PATTERNS) {
    if (entry.pattern.test(normalizedName)) {
      return { marketCode: entry.code, matchedBy: "pattern" };
    }
  }

  const rawId = raw.bookmakerMarketId ? Number(raw.bookmakerMarketId) : undefined;
  if (rawId !== undefined && !Number.isNaN(rawId)) {
    const mapped = LEBULL_MARKET_ID_TO_CODE[rawId];
    if (mapped) {
      return { marketCode: mapped, matchedBy: "id", rawId };
    }
  }

  return { marketCode: "OTHER", matchedBy: "pattern", rawId };
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeMarketName(trimmed);

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
    case "TIME_PERIOD_RESULT":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
    case "NEXT_TEAM_TO_SCORE":
      // Catalog selections are HOME/AWAY/NONE(/BOTH); "Nikt" = nobody scores.
      if (/^(nikt|zaden|zadna|brak|bez\s*gola|brak\s*gola)$/.test(normalized)) return "NONE";
      if (/^ob(ie|a|ydwie)/.test(normalized)) return "BOTH" as NormalizedSelection;
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
    case "TIME_PERIOD_TOTAL_GOALS":
    case "TIME_BAND_TOTAL_GOALS":
    case "TIME_SEGMENT_TOTAL_GOALS":
    case "TIME_PERIOD_GOALS":
    case "TOTAL_GOAL_MINUTES":
    case "TEAM_GOAL_MINUTES_SUM":
    case "TEAM_MINUTES_LEADING":
    case "TEAM_MINUTES_IN_LEAD":
    case "DRAW_MINUTES_TOTAL":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "BOTH_HALVES_GOALS":
    case "BTTS_2PLUS_GOALS":
    case "BTTS_AT_LEAST_ONE_HALF":
    case "BTTS_BOTH_HALVES":
    case "BOTH_TEAMS_UNDER_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_HALVES_OVER_COMBO":
    case "TEAM_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_BOTH_HALVES":
    case "EACH_TEAM_WINS_ONE_HALF":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "ONE_TEAM_TO_SCORE":
    case "SCORING_DRAW":
    case "DRAW_IN_AT_LEAST_ONE_HALF":
    case "BOTH_TEAMS_TO_LEAD":
    case "HALF_TIME_GOAL":
    case "SECOND_HALF_GOAL":
    case "GOAL_IN_TIME_PERIOD":
    case "SCORE_REACHED":
    case "SCORE_OCCURS_DURING_MATCH":
    case "SCORE_TO_OCCUR":
    case "ANY_TEAM_WINNING_MARGIN_EXACT":
    case "WINNING_MARGIN_ANY_EXACT":
    case "ANY_TEAM_WIN_BY_MARGIN":
    case "RED_CARD":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "BTTS_BY_HALF":
      // Raw labels are "Tak/Tak", "Tak/Nie", "Nie/Tak", "Nie/Nie"
      // (BTTS in 1st half / BTTS in 2nd half).
      if (/^tak\s*\/\s*tak$/i.test(trimmed)) return "Both" as NormalizedSelection;
      if (/^tak\s*\/\s*nie$/i.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^nie\s*\/\s*tak$/i.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^nie\s*\/\s*nie$/i.test(trimmed)) return "None" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HALF_WITH_MORE_GOALS":
      // Raw labels compare halves: "1. > 2." (1st half higher), "1. < 2.",
      // "1. = 2." — catalog selections are 1st/2nd/Draw.
      if (/^1\.?\s*>\s*2\.?$/.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^1\.?\s*<\s*2\.?$/.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^1\.?\s*=\s*2\.?$/.test(trimmed)) return "Draw" as NormalizedSelection;
      if (/1\.?\s*polow/.test(normalized)) return "1st" as NormalizedSelection;
      if (/2\.?\s*polow/.test(normalized)) return "2nd" as NormalizedSelection;
      if (/^(remis|rowno)/.test(normalized)) return "Draw" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
      if (/handicap\s*1/.test(normalized)) return "HOME";
      if (/handicap\s*2/.test(normalized)) return "AWAY";
      if (/handicap\s*x/.test(normalized)) return "DRAW";
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

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT":
      // "Od 1 do 10 min." -> "1-10", "Od 16 do 30 min." -> "16-30", etc.
      return normalizeGoalTimeRangeSelection(trimmed);

    case "RESULT_AND_TOTAL":
    case "RESULT_AND_BTTS":
    case "DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_TOTAL":
    case "FIRST_GOAL_AND_RESULT":
      return trimmed as NormalizedSelection;

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(marketCode: NormalizedMarketType, raw: RawBookmakerMarket): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  // Time-period markets ("Wynik meczu w przedziale 16-30 min",
  // "suma między 81-90+ min.") use the END minute of the period as the
  // parameter, matching the betters convention, so identical windows
  // aggregate across bookmakers instead of colliding in the "base" bucket.
  if (marketCode === "TIME_PERIOD_RESULT" || marketCode === "TIME_PERIOD_TOTAL_GOALS") {
    return extractTimePeriodParam(raw.name);
  }

  const selectionNames = raw.selections.map((s) => s.name);
  const groupName = raw.groupName ?? "";
  const marketName = raw.name;

  switch (metadata.parameterType) {
    case "handicap":
      return (
        parseHandicapLine(marketName) ??
        selectionNames.map((name) => parseHandicapLine(name)).find(Boolean) ??
        parseHandicapLine(groupName)
      );

    case "integer": {
      const intMatch = marketName.match(/\b(\d+)\b/);
      if (intMatch) return intMatch[1];

      const decimalLine = parseDecimalLine(marketName) ?? parseDecimalLine(groupName);
      if (decimalLine?.endsWith(".0")) return decimalLine.replace(/\.0$/, "");

      const fromSelections = parseOverUnderLine(selectionNames);
      if (fromSelections?.endsWith(".0")) return fromSelections.replace(/\.0$/, "");

      return fromSelections;
    }

    case "decimal":
    default:
      return (
        parseDecimalLine(marketName) ??
        parseOverUnderLine(selectionNames) ??
        parseDecimalLine(groupName)
      );
  }
}

export const lebullNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "lebull",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId } = resolveMarketCode(raw, ctx);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[lebull] Market code "${marketCode}" not in catalog`);
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
      console.warn(`[lebull] Unmapped market "${raw.name}" (id: ${rawId ?? "none"})`);
    }

    return {
      marketCode,
      marketName,
      paramValue,
      marketKey,
      selections,
      debug: {
        rawName: raw.name,
        rawId: rawId ?? raw.bookmakerMarketId,
        matchedBy,
      },
    } as NormalizedMarketOutput;
  },

};

export default lebullNormalizer;
