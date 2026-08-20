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
  collapseBothHalvesOverGoalsZeroFive,
  normalizeMarketName,
  parseDecimalLine,
  parseHandicapLine,
  parseIntegerLine,
  parseOverUnderLine,
  normalize1x2Selection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  parseScoreSelection,
  parseHtFtSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

const BETTERS_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  2: "ASIAN_HANDICAP",
  3: "TOTAL_GOALS",
  4: "HALFTIME_FULLTIME",
  5: "CORRECT_SCORE",
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
  333649: "LAST_TEAM_TO_SCORE",
  618: "TOTAL_GOALS_3WAY",
  5699564: "DOUBLE_CHANCE_GOAL_RANGE",
  5774433: "TOTAL_GOALS_AND_BTTS",
  40495: "HALFTIME_FULLTIME",
  40498: "HALFTIME_FULLTIME_DOUBLE_CHANCE",
  607: "HT_OR_FT_RESULT",
  8: "PENALTY_AWARDED",
  39593: "RED_CARD_AND_PENALTY",
  39594: "PENALTY_OR_RED_CARD",
  310988: "HALF_TIME_PENALTY_AWARDED",
  310989: "SECOND_HALF_PENALTY_AWARDED",
  314168: "TEAM_MISSES_PENALTY",
  314169: "PENALTY_GOAL",
  // "Penalty Missed in the Match" is a Tak/Nie market -> MISSED_PENALTY
  // (YES/NO), not PENALTY_MISSED (HOME/AWAY).
  5755153: "MISSED_PENALTY",
  175100: "RED_CARD_TEAM",
  175105: "RED_CARD_TEAM",
  310990: "HALF_TIME_RED_CARD",
  310991: "SECOND_HALF_RED_CARD",
  350214: "BOTH_TEAMS_RED_CARD",
  39506: "OWN_GOAL",
  39507: "BRACE_IN_MATCH",
  39508: "HAT_TRICK",
  66: "SUBSTITUTE_GOAL",
  682: "CORRECT_SCORE",
  40421: "CORRECT_SCORE_COMBINATION",
  332816: "BTTS_AT_LEAST_ONE_HALF",
  262063: "BTTS_BOTH_HALVES",
  // 332818 ("Obie drużyny suma powyżej X") is routed by name + goal line in
  // resolveMarketCode — only the 0.5/1.5 lines have catalog counterparts
  // (BTTS / BTTS_2PLUS_GOALS), so a blanket id mapping would misroute other lines.
  // 332819 ("obie drużyny suma poniżej") is QUARANTINED to OTHER (audit
  // cluster #20, Arsenal vs Coventry City) — unlike 332818, this raw name
  // carries no goal threshold anywhere (same sbteam.xyz feed shape as
  // lebull's identical id), so there is no line to parameterize
  // BOTH_TEAMS_UNDER_GOALS with; that catalog code has been retired. See
  // market-catalog.ts's numericId 1242 comment.
  332819: "OTHER",
  // 40414/40415 and 39504/39505 are team-A/team-B stake-type variants
  // (team A = home side): "Algieria wygra..." carries the lower id.
  40414: "HOME_WIN_BOTH_HALVES",
  40415: "AWAY_WIN_BOTH_HALVES",
  39504: "HOME_WIN_AT_LEAST_ONE_HALF",
  39505: "AWAY_WIN_AT_LEAST_ONE_HALF",
  // Id 30 ("Gol w 1. połowie") is a plain Tak/Nie "goal in this half"
  // market — exactly the 0.5 line of the Over/Under HALF_TIME_TOTAL_GOALS
  // market (Over 0.5 == "yes, a goal happens"). Fold onto that fixed line
  // instead of the standalone HALF_TIME_GOAL code, which duplicated the
  // 0.5-line row every other bookmaker already reports under
  // HALF_TIME_TOTAL_GOALS (audit cluster #10, market-display audit; same
  // sbteam.xyz feed id as lebull's identical fix). See extractParamValue
  // and normalizeSelectionForMarket for the Tak/Nie -> OVER/UNDER + fixed
  // "0.5" param transform. Id 31 ("Gol w 2. połowie") is 30's 2nd-half
  // twin on the same shared feed (see scrapers/bookmakers/betters/
  // constants.ts SECOND_HALF_GOAL=31) — previously unmapped here, so it
  // never even reached the standalone-duplicate bug, but also never
  // pooled into SECOND_HALF_TOTAL_GOALS's 0.5 line either. Not directly
  // observed live (betters returns no rows for the Arsenal vs Coventry
  // City audit match), added by analogy with 30 and with lebull's
  // identical 30/31 pair on the same sbteam.xyz backend.
  30: "HALF_TIME_TOTAL_GOALS",
  31: "SECOND_HALF_TOTAL_GOALS",
  332813: "BOTH_HALVES_OVER_GOALS",
  7: "HALF_WITH_MORE_GOALS",
  424467: "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE",
  583: "FIRST_GOAL_TIME_ALT",
  655: "FIRST_GOAL_TIME",
  // Stake type 677 ("Czas pierwszego gola") is quoted per half
  // (W 1. Połowie / W 2. Połowie / Brak gola), not in minute intervals.
  677: "FIRST_GOAL_HALF",
  40317: "SECOND_GOAL_TIME",
  329307: "GOAL_IN_TIME_WINDOW",
  40380: "GOAL_IN_TIME_PERIOD",
  40381: "GOAL_IN_TIME_PERIOD",
  40382: "GOAL_IN_TIME_PERIOD",
  40385: "GOAL_IN_TIME_PERIOD",
  40383: "GOAL_IN_TIME_PERIOD",
  40386: "GOAL_IN_TIME_PERIOD",
  40387: "GOAL_IN_TIME_PERIOD",
  40388: "GOAL_IN_TIME_PERIOD",
  40493: "GOAL_IN_TIME_PERIOD",
  40494: "GOAL_IN_TIME_PERIOD",
  40389: "GOAL_IN_TIME_PERIOD",
  299442: "GOAL_IN_90_PLUS",
  290: "SCORING_DRAW",
  647: "DRAW_IN_AT_LEAST_ONE_HALF",
  5685188: "BOTH_TEAMS_TO_LEAD",
  40393: "HOME_WIN_TO_NIL",
  40394: "HOME_WIN_TO_NIL",
  650: "ANY_TEAM_WINNING_MARGIN",
  651: "ANY_TEAM_EXACT_WINNING_MARGIN",
  652: "ANY_TEAM_WINNING_MARGIN",
  653: "ANY_TEAM_WINNING_MARGIN_2PLUS",
  654: "ANY_TEAM_WIN_BY_3PLUS",
  543: "HOME_WIN_BY_1_OR_DRAW",
  673: "TEAM_FIRST_GOAL_PERIOD",
  261965: "GOAL_RACE",
  40497: "TOTAL_GOAL_MINUTES",
  5685189: "TEAM_GOAL_MINUTES_SUM",
  // 670 ("<Team> liczba minut na prowadzeniu") is handled by the
  // name-pattern + team-side detection block in resolveMarketCode, not this
  // static id map — see the comment there.
  671: "DRAW_MINUTES_TOTAL",
  270586: "TIME_PERIOD_TOTAL_GOALS",
  270588: "TIME_PERIOD_TOTAL_GOALS",
  270590: "TIME_PERIOD_TOTAL_GOALS",
  270591: "TIME_PERIOD_TOTAL_GOALS",
  175092: "TIME_PERIOD_RESULT",
  270619: "TIME_PERIOD_RESULT",
  175095: "TIME_PERIOD_RESULT",
  270825: "TIME_PERIOD_TOTAL_GOALS",
  270826: "TIME_PERIOD_TOTAL_GOALS",
  270827: "TIME_PERIOD_TOTAL_GOALS",
  270828: "TIME_PERIOD_TOTAL_GOALS",
  270829: "TIME_PERIOD_TOTAL_GOALS",
  270830: "TIME_PERIOD_TOTAL_GOALS",
  270832: "TIME_PERIOD_TOTAL_GOALS",
  270833: "TIME_PERIOD_TOTAL_GOALS",
};

const BETTERS_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "remis = zwrot": "DRAW_NO_BET",
  "dokladny wynik": "CORRECT_SCORE",
  "obie druzyny strzela": "BTTS",
  "wynik 1. polowy": "HALF_TIME_RESULT",
  "wynik 2. polowy": "SECOND_HALF_RESULT",
  // NOTE: "czas pierwszego gola" is intentionally NOT mapped here — betters
  // quotes it per half (stake type 677 -> FIRST_GOAL_HALF), not in the
  // 10-minute intervals FIRST_GOAL_TIME expects.
  "parzyste/nieparzyste": "ODD_EVEN_GOALS",
  "wygrana do zera": "WIN_TO_NIL",
  "czyste konto": "CLEAN_SHEET",
};

const BETTERS_MARKET_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /wynik\s*meczu\s*i\s*suma/, code: "RESULT_AND_TOTAL" },
  { pattern: /wynik\s*meczu\s*i\s*obie\s*druzyny\s*strzela/, code: "RESULT_AND_BTTS" },
  { pattern: /podwojna\s*szansa\s*i\s*obie\s*druzyny\s*strzela/, code: "DOUBLE_CHANCE_BTTS" },
  { pattern: /podwojna\s*szansa\s*i\s*suma\s*goli/, code: "DOUBLE_CHANCE_TOTAL" },
  { pattern: /wynik\s*1\.?\s*polow/, code: "HALF_TIME_RESULT" },
  { pattern: /wynik\s*2\.?\s*polow/, code: "SECOND_HALF_RESULT" },
  { pattern: /obie\s*druzyny\s*strzela.*1\.?\s*polow/, code: "HALF_TIME_BTTS" },
  { pattern: /liczba\s*goli.*1\.?\s*polow/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /liczba\s*goli.*2\.?\s*polow/, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /wynik\s*meczu\s*w\s*przedziale/, code: "TIME_PERIOD_RESULT" },
  { pattern: /handicap\s*3[-\s]?drogowy|handicap\s*europej/, code: "EUROPEAN_HANDICAP" },
  { pattern: /handicap/, code: "ASIAN_HANDICAP" },
  { pattern: /parzyste|nieparzyst/, code: "ODD_EVEN_GOALS" },
  { pattern: /wygrana\s*do\s*zera/, code: "WIN_TO_NIL" },
  { pattern: /czyste\s*konto/, code: "CLEAN_SHEET" },
  { pattern: /pierwszy\s*strzelec/, code: "GOALSCORER_FIRST" },
  { pattern: /ostatni\s*strzelec/, code: "GOALSCORER_LAST" },
  { pattern: /strzelec/, code: "GOALSCORER_ANYTIME" },
];

function extractTimePeriodParam(name: string): string | undefined {
  const normalized = normalizeMarketName(name);

  // A window starting at minute 1 (or the API's 0-based equivalent) is the
  // cumulative "first N minutes" bet and is keyed by its end minute alone,
  // matching lebull (shares the sbteam.xyz feed). A window that does NOT
  // start at the first minute (e.g. "16-30") is a distinct segment bet, not
  // a cumulative one, and keying it by the end minute alone would collide it
  // with the cumulative window of the same end (e.g. "1-30"), showing
  // incomparable odds as if they were the same market (lebull evidence on
  // this match: segment "16-30" over=2.18 / ~46% implied vs a cumulative
  // "1-30" over reading ~63% implied on a peer book).
  const wordedRange = normalized.match(/od\s*(\d+)\.?\s*do\s*(\d+)/);
  if (wordedRange) {
    const [, start, end] = wordedRange;
    return start === "0" || start === "1" ? end : `${start}-${end}`;
  }

  const rangeMatch = normalized.match(/(\d+)\.?\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    const [, start, end] = rangeMatch;
    return start === "0" || start === "1" ? end : `${start}-${end}`;
  }

  const minuteMatch = normalized.match(/\b(\d+)\b/);
  return minuteMatch ? minuteMatch[1] : undefined;
}

/**
 * Cast helper for catalog selection codes that are not part of the shared
 * NormalizedSelection enum (e.g. "1st", "BOTH", "1ST_HALF").
 */
function toSelection(code: string): NormalizedSelection {
  return code as NormalizedSelection;
}

/**
 * Maps goal-time interval selections ("Od 1 do 15 min.", "Od 11 do 20 min.")
 * to the canonical "X-Y" interval codes; "Nikt"/"Brak gola" map to NONE.
 */
function normalizeGoalTimeRangeSelection(selectionName: string): NormalizedSelection {
  const normalized = normalizeMarketName(selectionName);

  if (/^(nikt|zaden|zadna|brak|bez\s*gola|brak\s*gola)/.test(normalized)) return "NONE";

  const wordedRange = normalized.match(/od\s*(\d+)\s*do\s*(\d+)/);
  if (wordedRange) return toSelection(`${wordedRange[1]}-${wordedRange[2]}`);

  const plainRange = normalized.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (plainRange) return toSelection(`${plainRange[1]}-${plainRange[2]}`);

  return toSelection(selectionName.trim());
}

/**
 * Resolves a team name embedded in a market name to a HOME/AWAY side.
 * Bookmaker market names may use Polish exonyms ("Algieria") while context
 * teams are canonical ("Algeria"), so this goes through the canonical
 * team matcher via normalize1x2Selection.
 */
function resolveTeamSide(teamText: string, ctx: NormalizationContext): NormalizedSelection {
  const trimmed = teamText.trim();
  if (trimmed.length < 3) return "UNKNOWN";
  return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
  rawId?: number;
  teamSide?: "HOME" | "AWAY";
} {
  const normalizedName = normalizeMarketName(raw.name);

  // "<Team> liczba minut na prowadzeniu" (id 670, shared with lebull on what
  // looks like the same upstream feed) is the same market offered once per
  // side. audit-match (Arsenal vs Coventry City) UX gap-analysis found the
  // identical pattern already fixed for lebull (see its normalizer for the
  // full note) — apply the same team-side-in-selection fix here so betters
  // doesn't reintroduce the same split-code bug via this shared id.
  if (/liczba minut na prowadzeniu/i.test(normalizedName)) {
    const teamPrefix = raw.name.match(/^(.+?)\s+liczba minut na prowadzeniu/iu);
    const side = teamPrefix ? resolveTeamSide(teamPrefix[1], ctx) : "UNKNOWN";
    return {
      marketCode: "TEAM_MINUTES_LEADING",
      matchedBy: "pattern",
      teamSide: side === "HOME" || side === "AWAY" ? side : undefined,
    };
  }

  const direct = BETTERS_MARKET_NAME_TO_CODE[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name" };
  }

  // --- Combo bets without a clean catalog counterpart -----------------------
  // Keep them out of the generic "suma goli"/goal-range branches so they do
  // not pollute TOTAL_GOALS / TEAM_TOTAL_GOALS / GOAL_RANGE parameters.

  // "Austria strzeli pierwsza i suma goli" (first team to score + total goals)
  if (/strzeli\s*pierwsz\w*\s*i\s*suma\s*goli/.test(normalizedName)) {
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // "Austria wygra i suma goli: 3-5" (team win + goal range, quoted as Tak/Nie)
  if (/wygra\s*i\s*suma\s*goli/.test(normalizedName)) {
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // "połowa/mecz i suma goli" (HT-or-FT + total combo) — raw selections do not
  // map onto HALFTIME_FULLTIME_AND_TOTAL codes, so keep it out of TOTAL_GOALS.
  if (/po[lł]owa\s*\/\s*mecz\s*i\s*suma/.test(normalizedName)) {
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // "Suma goli lub obie drużyny strzelą X" — only the 2.5 line has a catalog
  // counterpart (BTTS_OR_OVER_2_5).
  if (/suma\s*goli\s*lub\s*obie\s*druzyny\s*strzela/.test(normalizedName)) {
    const line = parseDecimalLine(normalizedName);
    if (line === "2.5") return { marketCode: "BTTS_OR_OVER_2_5", matchedBy: "pattern" };
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

  // "Austria. Połowa z wyższą sumą goli" — per-team half-comparison market
  // (1.<2. / 1.=2. / 1.>2.), not a team-total-goals one.
  if (/po[lł]owa\s*z\s*wyzsza\s*suma\s*goli/.test(normalizedName)) {
    const prefixMatch = raw.name.match(/^([^.:]{2,40})[.:]/);
    const side = prefixMatch ? resolveTeamSide(prefixMatch[1], ctx) : "UNKNOWN";
    if (side === "HOME") return { marketCode: "HOME_HALF_WITH_MOST_GOALS", matchedBy: "pattern" };
    if (side === "AWAY") return { marketCode: "AWAY_HALF_WITH_MOST_GOALS", matchedBy: "pattern" };
    return { marketCode: "HALF_WITH_MORE_GOALS", matchedBy: "pattern" };
  }

  // --- Team-named result markets ---------------------------------------------
  // Betters quotes these per team ("Austria wygra do zera", Tak/Nie) and the
  // team may be a Polish exonym — resolve the side through the canonical
  // matcher instead of relying on stake-type-id fallbacks.

  const winToNil = raw.name.match(/^(.+?)\s+wygra\s+do\s+zera/i);
  if (winToNil) {
    const side = resolveTeamSide(winToNil[1], ctx);
    if (side === "HOME") return { marketCode: "HOME_WIN_TO_NIL", matchedBy: "pattern" };
    if (side === "AWAY") return { marketCode: "AWAY_WIN_TO_NIL", matchedBy: "pattern" };
  }

  const winOneHalf = raw.name.match(
    /^(.+?)\s+wygra\s+(?:co\s+najmniej|przynajmniej)\s+jedn[aą]\s+po[lł]ow/i
  );
  if (winOneHalf) {
    const side = resolveTeamSide(winOneHalf[1], ctx);
    if (side === "HOME") return { marketCode: "HOME_WIN_AT_LEAST_ONE_HALF", matchedBy: "pattern" };
    if (side === "AWAY") return { marketCode: "AWAY_WIN_AT_LEAST_ONE_HALF", matchedBy: "pattern" };
  }

  const winBothHalves = raw.name.match(/^(.+?)\s+wygra\s+obie\s+po[lł]owy/i);
  if (winBothHalves) {
    const side = resolveTeamSide(winBothHalves[1], ctx);
    if (side === "HOME") return { marketCode: "HOME_WIN_BOTH_HALVES", matchedBy: "pattern" };
    if (side === "AWAY") return { marketCode: "AWAY_WIN_BOTH_HALVES", matchedBy: "pattern" };
  }

  // "{Team}: wygra różnicą 1 gola lub remis" — only the home variant has a
  // catalog code (HOME_WIN_BY_1_OR_DRAW); the away variant has no counterpart.
  const winBy1OrDraw = raw.name.match(
    /^(.+?)[.:]?\s+wygra\s+r[óo][żz]nic[aą]?\s+1\s+gola\s+lub\s+remis/i
  );
  if (winBy1OrDraw) {
    const side = resolveTeamSide(winBy1OrDraw[1], ctx);
    if (side === "HOME") return { marketCode: "HOME_WIN_BY_1_OR_DRAW", matchedBy: "pattern" };
    if (side === "AWAY") return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  const isGoalRange = /suma\s*goli[:\s]+\d+\s*[-–]\s*\d+/i.test(normalizedName);
  if (isGoalRange) {
    return { marketCode: "GOAL_RANGE", matchedBy: "pattern" };
  }

  if (/suma\s*goli/.test(normalizedName)) {
    // "Suma goli. Algieria 1.0" — total goals of a single named team. Strip
    // the market phrase and line, then resolve the remaining team name
    // (possibly a Polish exonym) against the match context.
    const teamSegment = raw.name
      .replace(/suma\s*goli/gi, " ")
      .replace(/[+-]?\d+(?:[.,]\d+)?/g, " ")
      .replace(/[.:,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (teamSegment.length >= 3) {
      const side = resolveTeamSide(teamSegment, ctx);
      if (side === "HOME") return { marketCode: "HOME_TEAM_TOTAL_GOALS", matchedBy: "pattern" };
      if (side === "AWAY") return { marketCode: "AWAY_TEAM_TOTAL_GOALS", matchedBy: "pattern" };
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

  for (const entry of BETTERS_MARKET_PATTERNS) {
    if (entry.pattern.test(normalizedName)) {
      return { marketCode: entry.code, matchedBy: "pattern" };
    }
  }

  const rawId = raw.bookmakerMarketId ? Number(raw.bookmakerMarketId) : undefined;
  if (rawId !== undefined && !Number.isNaN(rawId)) {
    const mapped = BETTERS_MARKET_ID_TO_CODE[rawId];
    if (mapped) {
      return { marketCode: mapped, matchedBy: "id", rawId };
    }
  }

  return { marketCode: "OTHER", matchedBy: "pattern", rawId };
}

function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  teamSide?: "HOME" | "AWAY"
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeMarketName(trimmed);

  switch (marketCode) {
    case "TEAM_MINUTES_LEADING": {
      // Side comes from resolveMarketCode's name-based detection; the raw
      // selection itself is plain "powyżej"/"poniżej" with no team of its own.
      const ou = normalizeOverUnderSelection(trimmed);
      if (teamSide === "HOME") return ou === "OVER" ? toSelection("HOME_OVER") : ou === "UNDER" ? toSelection("HOME_UNDER") : "UNKNOWN";
      if (teamSide === "AWAY") return ou === "OVER" ? toSelection("AWAY_OVER") : ou === "UNDER" ? toSelection("AWAY_UNDER") : "UNKNOWN";
      return "UNKNOWN";
    }
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
    case "GOAL_RACE":
      // Catalog selections are HOME/AWAY/NONE(/BOTH); "Nikt" = nobody scores.
      if (/^(nikt|zaden|zadna|brak(\s*gola)?|bez\s*gola)$/.test(normalized)) return "NONE";
      if (/^ob(ie|a|ydwie)/.test(normalized)) return toSelection("BOTH");
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS": {
      // Id 30 ("Gol w 1. połowie") routes through here too, with Tak/Nie
      // selections instead of Powyżej/Poniżej — see the id-map comment
      // above. Tak ("yes, a goal happens") == OVER the fixed 0.5 line;
      // Nie == UNDER it.
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo === "YES") return "OVER";
      if (yesNo === "NO") return "UNDER";
      return normalizeOverUnderSelection(trimmed);
    }

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "TEAM_TOTAL_GOALS":
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
    case "TIME_PERIOD_TOTAL_GOALS":
    case "TOTAL_GOAL_MINUTES":
    case "TEAM_GOAL_MINUTES_SUM":
    case "DRAW_MINUTES_TOTAL":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
      return normalizeOverUnderSelection(trimmed);

    case "TOTAL_GOALS_3WAY":
      // Raw labels: "powyżej" / "Dokładnie" / "poniżej".
      if (/^dok[lł]adnie/.test(normalized)) return toSelection("EXACTLY");
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "BOTH_HALVES_GOALS":
    case "BTTS_AT_LEAST_ONE_HALF":
    case "BTTS_BOTH_HALVES":
    case "BTTS_2PLUS_GOALS":
    case "BTTS_OR_OVER_2_5":
    case "BOTH_HALVES_OVER_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_TEAMS_TO_LEAD":
    case "ONE_TEAM_TO_SCORE":
    case "OWN_GOAL":
    case "SUBSTITUTE_GOAL":
    case "HAT_TRICK":
    case "BRACE_IN_MATCH":
    case "SCORING_DRAW":
    case "DRAW_IN_AT_LEAST_ONE_HALF":
    case "TEAM_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "HOME_WIN_BY_1_OR_DRAW":
    case "ANY_TEAM_WINNING_MARGIN":
    case "ANY_TEAM_EXACT_WINNING_MARGIN":
    case "ANY_TEAM_WINNING_MARGIN_2PLUS":
    case "ANY_TEAM_WIN_BY_3PLUS":
    case "GOAL_IN_TIME_PERIOD":
    case "GOAL_IN_TIME_WINDOW":
    case "GOAL_IN_90_PLUS":
    case "PENALTY_AWARDED":
    case "HALF_TIME_PENALTY_AWARDED":
    case "SECOND_HALF_PENALTY_AWARDED":
    case "RED_CARD_AND_PENALTY":
    case "PENALTY_OR_RED_CARD":
    case "RED_CARD_TEAM":
    case "HALF_TIME_RED_CARD":
    case "SECOND_HALF_RED_CARD":
    case "BOTH_TEAMS_RED_CARD":
    case "MISSED_PENALTY":
    case "CORRECT_SCORE_COMBINATION":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
      // Raw labels compare halves: "1. > 2." (1st half has more goals),
      // "1. < 2.", "1. = 2." — catalog selections are 1st/2nd/Draw.
      if (/^1\.?\s*>\s*2\.?$/.test(trimmed)) return toSelection("1st");
      if (/^1\.?\s*<\s*2\.?$/.test(trimmed)) return toSelection("2nd");
      if (/^1\.?\s*=\s*2\.?$/.test(trimmed)) return toSelection("Draw");
      if (/1\.?\s*po[lł]ow/.test(normalized)) return toSelection("1st");
      if (/2\.?\s*po[lł]ow/.test(normalized)) return toSelection("2nd");
      if (/^(remis|r[oó]wno)/.test(normalized)) return toSelection("Draw");
      return toSelection(trimmed);

    case "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE": {
      // Raw labels combine two half comparisons, e.g. "1.<2. lub 1.>2.",
      // "1st < 2nd or 1st = 2nd" — catalog: 1ST_OR_DRAW/1ST_OR_2ND/2ND_OR_DRAW.
      const hasFirst = /1\.?(?:st)?\s*>\s*2|2\.?(?:nd)?\s*<\s*1/.test(trimmed);
      const hasSecond = /1\.?(?:st)?\s*<\s*2|2\.?(?:nd)?\s*>\s*1/.test(trimmed);
      const hasDraw = /=/.test(trimmed);
      if (hasFirst && hasSecond) return toSelection("1ST_OR_2ND");
      if (hasFirst && hasDraw) return toSelection("1ST_OR_DRAW");
      if (hasSecond && hasDraw) return toSelection("2ND_OR_DRAW");
      return toSelection(trimmed);
    }

    case "FIRST_GOAL_HALF":
      // "W 1. Połowie" / "W 2. Połowie" / "Brak gola"
      if (/1\.?\s*po[lł]ow/.test(normalized)) return toSelection("1ST_HALF");
      if (/2\.?\s*po[lł]ow/.test(normalized)) return toSelection("2ND_HALF");
      if (/brak|bez\s*gola|nikt/.test(normalized)) return "NONE";
      return toSelection(trimmed);

    case "TEAM_FIRST_GOAL_PERIOD":
      // "W 1. Połowie" / "W 2. Połowie" / "Nie strzeli"
      if (/1\.?\s*po[lł]ow/.test(normalized)) return toSelection("FIRST_HALF");
      if (/2\.?\s*po[lł]ow/.test(normalized)) return toSelection("SECOND_HALF");
      if (/nie\s*strzeli|brak|bez\s*gola/.test(normalized)) return toSelection("NO_GOAL");
      return toSelection(trimmed);

    case "SECOND_GOAL_TIME":
      // Catalog: FIRST_HALF/SECOND_HALF. Only the exact half boundaries map;
      // shifted variants ("Od 1 do 47 min.") stay raw.
      if (/^od\s*1\s*do\s*45\b/.test(normalized)) return toSelection("FIRST_HALF");
      if (/^od\s*46\s*do\s*90\b/.test(normalized)) return toSelection("SECOND_HALF");
      if (/1\.?\s*po[lł]ow/.test(normalized)) return toSelection("FIRST_HALF");
      if (/2\.?\s*po[lł]ow/.test(normalized)) return toSelection("SECOND_HALF");
      return toSelection(trimmed);

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
      // "Od 1 do 15 min." -> "1-15", "Od 16 do 30 min." -> "16-30", etc.
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
  // parameter (same convention as lebull, which shares the sbteam.xyz feed),
  // so identical windows aggregate instead of colliding on the goal line.
  if (marketCode === "TIME_PERIOD_RESULT" || marketCode === "TIME_PERIOD_TOTAL_GOALS") {
    return extractTimePeriodParam(raw.name);
  }

  // Ids 30/31 ("Gol w 1./2. połowie") are Tak/Nie markets with no numeric
  // line at all — they represent the fixed 0.5 line of HALF_TIME_TOTAL_GOALS
  // / SECOND_HALF_TOTAL_GOALS (see the id-map comment). Pin them there
  // instead of falling through the decimal-parsing branch below, which
  // would find no number in "Tak"/"Nie" and return undefined.
  if (
    (marketCode === "HALF_TIME_TOTAL_GOALS" && String(raw.bookmakerMarketId) === "30") ||
    (marketCode === "SECOND_HALF_TOTAL_GOALS" && String(raw.bookmakerMarketId) === "31")
  ) {
    return "0.5";
  }

  const selectionNames = raw.selections.map((s) => s.name);
  const groupName = raw.groupName ?? "";

  switch (metadata.parameterType) {
    case "handicap":
      return (
        parseHandicapLine(raw.name) ??
        selectionNames.map((name) => parseHandicapLine(name)).find(Boolean) ??
        parseHandicapLine(groupName)
      );
    case "integer": {
      const integerLine = parseIntegerLine(raw.name) ?? parseIntegerLine(groupName);
      if (integerLine) return integerLine;

      const decimalLine = parseDecimalLine(raw.name) ?? parseDecimalLine(groupName);
      if (decimalLine?.endsWith(".0")) return decimalLine.replace(/\.0$/, "");

      const fromSelections = parseOverUnderLine(selectionNames);
      if (fromSelections?.endsWith(".0")) return fromSelections.replace(/\.0$/, "");

      return fromSelections;
    }
    case "decimal":
    default:
      return (
        parseDecimalLine(raw.name) ??
        parseOverUnderLine(selectionNames) ??
        parseDecimalLine(groupName)
      );
  }
}

export const bettersNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "betters",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId, teamSide } = resolveMarketCode(raw, ctx);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[betters] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const marketMetadata = getMarketMetadata(marketCode);
    let marketName = marketMetadata?.labels.pl ?? raw.name;

    let paramValue = extractParamValue(marketCode, raw);

    // audit cluster #24: "Obie połowy powyżej 0.5" (raw id 332813, sbteam.xyz
    // feed shared with lebull) is definitionally the same bet as this
    // bookmaker's OWN separate "Gol w obu połowach" row (raw id 32, mapped
    // to BOTH_HALVES_GOALS above) — collapse onto that code so the grouper's
    // existing same-bookmaker collision handling picks one and the
    // cross-bookmaker pool merges instead of forking into two cards/prices.
    let effectiveMarketCode: NormalizedMarketType = marketCode;
    const collapsed = collapseBothHalvesOverGoalsZeroFive(marketCode, paramValue);
    if (collapsed.marketCode !== marketCode) {
      effectiveMarketCode = collapsed.marketCode as NormalizedMarketType;
      paramValue = collapsed.paramValue;
      marketName = getMarketMetadata(effectiveMarketCode)?.labels.pl ?? marketName;
    }
    const marketKey = buildMarketKey(effectiveMarketCode, paramValue);

    // A time-period market without a resolvable minute window is a truncated
    // feed row — it would land in a meaningless "base" bucket and collide
    // with entries properly keyed by their window, so drop it entirely
    // (mirrors lebull, which shares the sbteam.xyz feed).
    if (
      (marketCode === "TIME_PERIOD_RESULT" || marketCode === "TIME_PERIOD_TOTAL_GOALS") &&
      paramValue === undefined
    ) {
      return null;
    }

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode, ctx, teamSide),
      label: sel.name,
      odds: sel.odds,
    }));

    if (marketCode === "OTHER") {
      console.warn(`[betters] Unmapped market "${raw.name}" (id: ${rawId ?? "none"})`);
    }

    return {
      marketCode: effectiveMarketCode,
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

export default bettersNormalizer;
