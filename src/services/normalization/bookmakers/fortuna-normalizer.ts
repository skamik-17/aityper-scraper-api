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
  // NOTE: "ufo:mtyp:00-61" was previously mapped to MATCH_WINNER but audit showed
  // its odds are inconsistent with full-time 1X2 on multiple fixtures (it shadowed
  // the canonical 00-00 market). Excluded until its real identity is verified live.
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
  // NOTE: "ufo:mtyp:00-2f" was previously mapped to DOUBLE_CHANCE but audit showed
  // its DRAW_OR_AWAY odds are probabilistically inconsistent with full-match double
  // chance (likely a half-scoped variant). Excluded until verified live; the
  // canonical DOUBLE_CHANCE (00-01) still covers this market.
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

// Per-player OPTA stat-line markets: the player (from the market name) becomes
// the market parameter (same convention as STS), selections are thresholds
// ("1+", "2+") or Yes/No.
const FORTUNA_PLAYER_STAT_MARKETS = new Set<NormalizedMarketType>([
  "PLAYER_GOALS",
  "PLAYER_ASSISTS",
  "PLAYER_CARDS",
  "PLAYER_FOULS",
  "PLAYER_SHOTS",
  "PLAYER_SHOTS_ON_TARGET",
  "PLAYER_PASSES",
  "PLAYER_RED_CARD",
]);

// Per-player dropdown markets: the player becomes the selection code (same
// convention as Fuksiarz), so per-player Fortuna markets merge into one
// aggregated dropdown market.
const FORTUNA_PLAYER_DROPDOWN_MARKETS = new Set<NormalizedMarketType>([
  "GOALSCORER_FIRST",
  "GOALSCORER_LAST",
  "GOALSCORER_ANYTIME",
  "PLAYER_HEADER_GOAL",
  "PLAYER_GOAL_OR_ASSIST",
]);

/**
 * Extracts the player name from Fortuna per-player OPTA market names:
 * - dash form: "Zerrouki, Ramiz - liczba fauli (OPTA)"
 * - verb form (optionally with abbreviated team prefix):
 *   "W.Ziel.Przyl. Cabral, Jovane strzeli pierwszego gola w meczu (OPTA)"
 */
function extractFortunaPlayerName(rawName: string): string | undefined {
  const dashMatch = rawName.match(/^(.+?,[^-]+?)\s+-\s+/);
  if (dashMatch) return dashMatch[1].trim();

  const verbMatch = rawName.match(
    /([\p{Lu}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)*,\s*[\p{Lu}][\p{L} '.-]*?)\s+(?:strzeli|asystuje|otrzyma|zaliczy|odda)/u
  );
  if (verbMatch) return verbMatch[1].trim();

  return undefined;
}

/** Leaked internal ids like "Rynek ufo:mtyp:00-37" must never be mined for lines. */
function isPlaceholderMarketName(name: string): boolean {
  return /^rynek\s/i.test(name) || name.includes("ufo:mtyp");
}

/**
 * Parses a score-style European handicap ("0:1" = away starts one goal up)
 * into a home-perspective signed line ("-1"). Prevents parseHandicapLine from
 * grabbing the bare "0" out of "0:1" and mislabeling the line as pick'em.
 */
function parseScoreStyleHandicap(texts: string[]): string | undefined {
  for (const text of texts) {
    const match = text.match(/(\d+)\s*:\s*(\d+)/);
    if (match) {
      const diff = parseInt(match[1], 10) - parseInt(match[2], 10);
      if (diff === 0) return "0";
      return diff > 0 ? `+${diff}` : `${diff}`;
    }
  }
  return undefined;
}

/** Extracts the integer line from "więcej niż 2" / "mniej niż 2" selection labels. */
function parseFortunaThresholdLine(selectionNames: string[]): string | undefined {
  for (const name of selectionNames) {
    const normalized = normalizeMarketName(name);
    const match = normalized.match(/^(?:wiecej|mniej)\s+niz\s+(\d+(?:[.,]\d+)?)/);
    if (match) return match[1].replace(",", ".");
  }
  return undefined;
}

/**
 * Maps a handicap selection to HOME/DRAW/AWAY. Strips trailing handicap
 * decorations ("Argentyna (-1,5)", "W.Ziel.Przyl. (+1)", "Algieria (0:1)")
 * before team matching, since Fortuna heavily abbreviates team names.
 */
function normalizeFortunaHandicapSelection(
  selName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();
  if (/^1\b/.test(trimmed)) return "HOME";
  if (/^2\b/.test(trimmed)) return "AWAY";
  if (/^(x\b|remis)/i.test(trimmed)) return "DRAW";

  const teamPart = trimmed
    .replace(/\s*\((?:[+-]?\d+(?:[.,]\d+)?|\d+\s*:\s*\d+)\)\s*$/, "")
    .replace(/\s+[+-]\d+(?:[.,]\d+)?$/, "")
    .trim();
  return normalize1x2Selection(
    teamPart.length > 0 ? teamPart : trimmed,
    ctx.homeTeam,
    ctx.awayTeam,
    ctx.league
  );
}

function findMarketCodeFromName(name: string): NormalizedMarketType | null {
  const normalized = normalizeMarketName(name);

  // Combo/parlay products such as "Obie drużyny strzelą gola , Alexis Mac
  // Allister strzeli gola" (BTTS AND named scorer) have no catalog equivalent
  // and must not be routed to plain BTTS.
  if (/obie druzyny strzela/.test(normalized) && normalized.includes(",")) {
    return null;
  }

  for (const { pattern, code } of FORTUNA_MARKET_NAME_PATTERNS) {
    if (pattern.test(normalized)) return code;
  }

  return null;
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  playerName?: string
): NormalizedSelection {
  const trimmed = selName.trim();
  const normalized = normalizeMarketName(trimmed);

  // Per-player dropdown markets: the player (from the market name) is the
  // canonical selection code; raw labels are generic markers ("Tak", "1+").
  if (FORTUNA_PLAYER_DROPDOWN_MARKETS.has(marketCode)) {
    if (playerName) return playerName as NormalizedSelection;
    return trimmed as NormalizedSelection;
  }

  // Per-player stat-line markets: selections are thresholds or Yes/No.
  if (FORTUNA_PLAYER_STAT_MARKETS.has(marketCode)) {
    if (/^\d+\s*\+$/.test(trimmed)) {
      // Card markets are YES/NO in the catalog; "1+" means "receives a card".
      if (marketCode === "PLAYER_CARDS" || marketCode === "PLAYER_RED_CARD") {
        return "YES";
      }
      return trimmed.replace(/\s+/g, "") as NormalizedSelection;
    }
    const yesNo = normalizeYesNoSelection(trimmed);
    if (yesNo !== "UNKNOWN") return yesNo;
    return trimmed as NormalizedSelection;
  }

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "DRAW_NO_BET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "HALF_TIME_TOTAL_GOALS":
    case "CARDS_TOTAL":
    case "CORNERS_TOTAL":
      // Integer-line phrasing: "więcej niż 2" / "mniej niż 2"
      if (/^wiecej niz/.test(normalized)) return "OVER";
      if (/^mniej niz/.test(normalized)) return "UNDER";
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "ASIAN_HANDICAP_PUSH":
    case "ASIAN_HANDICAP_3WAY":
    case "EUROPEAN_HANDICAP":
      return normalizeFortunaHandicapSelection(trimmed, ctx);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "GOAL_RANGE":
      // Ranges arrive in canonical dash format ("1-2", "3-5") or as "6+"/"0"
      if (/^\d+\s*-\s*\d+$/.test(trimmed)) {
        return trimmed.replace(/\s+/g, "") as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "FIRST_GOAL_TIME":
      if (/^\d+\s*-\s*\d+$/.test(trimmed)) {
        return trimmed.replace(/\s+/g, "") as NormalizedSelection;
      }
      if (/^(nikt|zaden|zadna|bez gola|brak gola|nie padnie)/.test(normalized)) {
        return "NONE";
      }
      return trimmed as NormalizedSelection;

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
      if (/^(nikt|zaden|zadna|bez gola|brak gola|nie padnie)/.test(normalized)) {
        return "NONE";
      }
      if (/^obie/.test(normalized)) return "BOTH" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
      // "Pierwszy/Pierwsza", "Drugi/Druga", "Rowno/Równo"
      if (/^pierwsz/.test(normalized)) return "1st" as NormalizedSelection;
      if (/^drug/.test(normalized)) return "2nd" as NormalizedSelection;
      if (/^(rown|remis)/.test(normalized)) return "Draw" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "BTTS_BY_HALF": {
      const compact = normalized.replace(/\s*\/\s*/g, "/");
      if (compact === "tak/tak") return "Both" as NormalizedSelection;
      if (compact === "tak/nie") return "1st" as NormalizedSelection;
      if (compact === "nie/tak") return "2nd" as NormalizedSelection;
      if (compact === "nie/nie") return "None" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "TEAMS_TO_SCORE": {
      if (/^obie/.test(normalized)) return "TWO_TEAMS";
      if (/^(zadna|zaden|nikt|brak|bez goli)/.test(normalized)) return "ZERO_TEAMS";
      const onlyTeam = trimmed.match(/^tylko\s+(.+)$/i);
      if (onlyTeam) {
        const side = normalize1x2Selection(
          onlyTeam[1].trim(),
          ctx.homeTeam,
          ctx.awayTeam,
          ctx.league
        );
        if (side === "HOME") return "ONE_TEAM_HOME";
        if (side === "AWAY") return "ONE_TEAM_AWAY";
      }
      return trimmed as NormalizedSelection;
    }

    default: {
      // Many Fortuna binary markets (SUBSTITUTE_GOAL, TEAM_WIN, VAR_REVIEW, ...)
      // quote plain "Tak"/"Nie" selections.
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo !== "UNKNOWN") return yesNo;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }
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
  // Never mine digits out of leaked internal ids ("Rynek ufo:mtyp:00-37").
  const nameForParsing = isPlaceholderMarketName(raw.name) ? "" : raw.name;

  // Quarter sub-markets ("2.kwarta" = segment between hydration breaks) use a
  // quarter index, not a start minute. Prefix with "q" so the values never
  // collide with the start-minute scale used by other bookmakers on this axis.
  if (marketCode === "TIME_PERIOD_RESULT") {
    const quarter = normalizeMarketName(nameForParsing).match(/^(\d+)\s*\.?\s*kwart/);
    if (quarter) return `q${quarter[1]}`;
  }

  switch (metadata.parameterType) {
    case "handicap":
      return (
        parseScoreStyleHandicap(selectionNames) ??
        parseScoreStyleHandicap([nameForParsing]) ??
        selectionNames.map((name) => parseHandicapLine(name)).find(Boolean) ??
        parseHandicapLine(nameForParsing) ??
        parseHandicapLine(groupName)
      );

    case "integer":
      return (
        parseOverUnderLine(selectionNames) ??
        parseFortunaThresholdLine(selectionNames) ??
        parseIntegerLine(nameForParsing) ??
        parseIntegerLine(groupName)
      );

    default:
      return (
        parseOverUnderLine(selectionNames) ??
        parseFortunaThresholdLine(selectionNames) ??
        parseDecimalLine(nameForParsing) ??
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

    // A "2-way" handicap quoting a draw outcome is actually a 3-way handicap;
    // keep the DRAW price instead of polluting the 2-way market with it.
    if (
      (marketCode === "ASIAN_HANDICAP" || marketCode === "ASIAN_HANDICAP_PUSH") &&
      (raw.selections.length === 3 ||
        raw.selections.some((sel) => /^(x\b|remis)/i.test(sel.name.trim())))
    ) {
      marketCode = "ASIAN_HANDICAP_3WAY";
    }

    // Fortuna emits "team half with more goals" for both sides under the same
    // type ids; route by the team named in the market label.
    if (marketCode === "HOME_HALF_WITH_MOST_GOALS") {
      const teamPrefix = raw.name.match(/^(.+?)\s+po[łl]owa\s+z\s+wi[eę]ksz/i);
      if (teamPrefix) {
        const side = normalize1x2Selection(
          teamPrefix[1].trim(),
          ctx.homeTeam,
          ctx.awayTeam,
          ctx.league
        );
        if (side === "AWAY") marketCode = "AWAY_HALF_WITH_MOST_GOALS";
      }
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[fortuna] Market code "${marketCode}" not in catalog`);
      return null;
    }

    // Per-player OPTA markets carry the player only in the market name.
    const isPlayerMarket =
      FORTUNA_PLAYER_STAT_MARKETS.has(marketCode) ||
      FORTUNA_PLAYER_DROPDOWN_MARKETS.has(marketCode);
    const playerName = isPlayerMarket ? extractFortunaPlayerName(raw.name) : undefined;

    // Stat-line player markets use the player as the market parameter.
    const paramValue =
      playerName && FORTUNA_PLAYER_STAT_MARKETS.has(marketCode)
        ? playerName
        : extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx, playerName),
      label: sel.name,
      odds: sel.odds,
    }));

    // Two-way handicaps: when exactly one side failed team matching, infer it
    // from the resolved side (Fortuna heavily abbreviates team names).
    if (
      (marketCode === "ASIAN_HANDICAP" || marketCode === "ASIAN_HANDICAP_PUSH") &&
      selections.length === 2
    ) {
      const unknowns = selections.filter((sel) => sel.code === "UNKNOWN");
      if (unknowns.length === 1) {
        if (selections.some((sel) => sel.code === "HOME")) unknowns[0].code = "AWAY";
        else if (selections.some((sel) => sel.code === "AWAY")) unknowns[0].code = "HOME";
      }
    }

    // Three-way handicaps: fill the single missing slot the same way.
    if (
      (marketCode === "EUROPEAN_HANDICAP" || marketCode === "ASIAN_HANDICAP_3WAY") &&
      selections.length === 3
    ) {
      const unknowns = selections.filter((sel) => sel.code === "UNKNOWN");
      if (unknowns.length === 1) {
        const present = new Set(selections.map((sel) => sel.code));
        const missing = (["HOME", "DRAW", "AWAY"] as const).find(
          (code) => !present.has(code)
        );
        if (missing) unknowns[0].code = missing;
      }
    }

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
