/**
 * Totalbet normalizer (dealer API component layout)
 *
 * The grid parser (src/scrapers/bookmakers/totalbet/grid-parser.ts) emits one raw
 * market per market_uuid with a namespaced id: "mid:<UOF market_id>" for column
 * layouts and "slug:<component slug>" for line layouts, the line itself in
 * paramValue. This normalizer maps exactly the phase-1 keys below to catalog
 * codes, plus the id-less, line-less "Wynik meczu" by name. Everything else is
 * OTHER: no regex patterns, no legacy numeric ids, and no log line per unmapped
 * market.
 *
 * Integrity rules:
 * - a parameterized code needs a well-formed line, else the market is dropped
 * - a handicap line read from the grid position must equal the line printed in
 *   each selection ("Leeds (-1.5)", "remis (1:0)"), else the market is dropped
 * - sides come from Totalbet's labels against the context teams, never from a
 *   bare fuzzy team match; a label that matches both teams resolves to nothing
 * - a team-scoped market whose displayed team is not its code's side is dropped
 * - a market whose selections resolve to the same code twice is dropped
 * - OTHER outputs keep raw.paramValue so each line stays its own storage row
 */

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
  normalizeMarketName,
  normalizeOddEvenSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  parseScoreSelection,
} from "../helpers/index.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { getMarketMetadata, isValidMarketCode } from "../../../data/market-catalog.js";

type Side = "HOME" | "DRAW" | "AWAY" | "NONE" | "UNKNOWN";

/**
 * Selection families. The three line families (total, asian, european) are
 * exactly the codes the catalog marks hasParameter.
 */
type Family = "result" | "twoWay" | "doubleChance" | "total" | "asian" | "european" | "yesNo" | "oddEven" | "score";

type TotalbetMarketOutput = NormalizedMarketOutput & { marketName: string };

/** Phase-1 keys (grid-parser bookmakerMarketId) -> catalog code. */
export const TOTALBET_MARKET_KEY_TO_CODE: Readonly<Record<string, NormalizedMarketType>> = Object.freeze({
  "mid:10": "DOUBLE_CHANCE", "mid:63": "HALF_TIME_DOUBLE_CHANCE", "mid:85": "SECOND_HALF_DOUBLE_CHANCE",
  "mid:29": "BTTS", "mid:75": "HALF_TIME_BTTS", "mid:95": "SECOND_HALF_BTTS",
  "mid:11": "DRAW_NO_BET", "mid:64": "HALF_TIME_DRAW_NO_BET", "mid:86": "SECOND_HALF_DRAW_NO_BET",
  "mid:60": "HALF_TIME_RESULT", "mid:83": "SECOND_HALF_RESULT",
  "mid:26": "ODD_EVEN_GOALS", "mid:74": "HALF_TIME_ODD_EVEN_GOALS", "mid:94": "SECOND_HALF_ODD_EVEN_GOALS",
  "mid:32": "HOME_TEAM_TO_SCORE", "mid:31": "AWAY_TEAM_TO_SCORE",
  "mid:77": "HALF_TIME_HOME_TO_SCORE", "mid:76": "HALF_TIME_AWAY_TO_SCORE",
  "mid:97": "SECOND_HALF_HOME_TO_SCORE", "mid:96": "SECOND_HALF_AWAY_TO_SCORE",
  "slug:suma": "TOTAL_GOALS", "slug:1_poaowa_suma": "HALF_TIME_TOTAL_GOALS", "slug:2_poaowa_suma": "SECOND_HALF_TOTAL_GOALS",
  "slug:competitor1_total_suma": "HOME_TEAM_TOTAL_GOALS", "slug:competitor2_total_suma": "AWAY_TEAM_TOTAL_GOALS",
  "slug:1_poaowa_competitor_1_suma_goli": "HALF_TIME_HOME_TEAM_TOTAL_GOALS", "slug:1_poaowa_competitor_2_suma_goli": "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  "slug:2_poaowa_competitor1_suma_goli_": "SECOND_HALF_HOME_TEAM_TOTAL_GOALS", "slug:2_poaowa_competitor2_suma_goli_": "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  "slug:handicap": "ASIAN_HANDICAP", "slug:1_poaowa_handicap": "FIRST_HALF_ASIAN_HANDICAP", "slug:2_poaowa_handicap": "SECOND_HALF_ASIAN_HANDICAP",
  "slug:handicap_hcp": "EUROPEAN_HANDICAP", "slug:1_poaowa_handicap_3way": "FIRST_HALF_EUROPEAN_HANDICAP", "slug:2_poaowa_handicap_3": "SECOND_HALF_EUROPEAN_HANDICAP",
  "slug:dokaadny_wynik": "CORRECT_SCORE", "slug:1_poaowa_dokaadny_wynik": "HALF_TIME_CORRECT_SCORE", "slug:2_poaowa_dokaadny_wynik": "SECOND_HALF_CORRECT_SCORE",
});

/** Id-less, line-less markets by normalizeMarketName(name): only the detail and list-fallback 1X2. */
export const TOTALBET_MARKET_NAME_TO_CODE: Readonly<Record<string, NormalizedMarketType>> = Object.freeze({
  "wynik meczu": "MATCH_WINNER",
});

const FAMILY_BY_CODE: Readonly<Partial<Record<NormalizedMarketType, Family>>> = Object.freeze({
  MATCH_WINNER: "result", HALF_TIME_RESULT: "result", SECOND_HALF_RESULT: "result",
  DRAW_NO_BET: "twoWay", HALF_TIME_DRAW_NO_BET: "twoWay", SECOND_HALF_DRAW_NO_BET: "twoWay",
  DOUBLE_CHANCE: "doubleChance", HALF_TIME_DOUBLE_CHANCE: "doubleChance", SECOND_HALF_DOUBLE_CHANCE: "doubleChance",
  BTTS: "yesNo", HALF_TIME_BTTS: "yesNo", SECOND_HALF_BTTS: "yesNo",
  HOME_TEAM_TO_SCORE: "yesNo", AWAY_TEAM_TO_SCORE: "yesNo",
  HALF_TIME_HOME_TO_SCORE: "yesNo", HALF_TIME_AWAY_TO_SCORE: "yesNo",
  SECOND_HALF_HOME_TO_SCORE: "yesNo", SECOND_HALF_AWAY_TO_SCORE: "yesNo",
  ODD_EVEN_GOALS: "oddEven", HALF_TIME_ODD_EVEN_GOALS: "oddEven", SECOND_HALF_ODD_EVEN_GOALS: "oddEven",
  TOTAL_GOALS: "total", HALF_TIME_TOTAL_GOALS: "total", SECOND_HALF_TOTAL_GOALS: "total",
  HOME_TEAM_TOTAL_GOALS: "total", AWAY_TEAM_TOTAL_GOALS: "total",
  HALF_TIME_HOME_TEAM_TOTAL_GOALS: "total", HALF_TIME_AWAY_TEAM_TOTAL_GOALS: "total",
  SECOND_HALF_HOME_TEAM_TOTAL_GOALS: "total", SECOND_HALF_AWAY_TEAM_TOTAL_GOALS: "total",
  ASIAN_HANDICAP: "asian", FIRST_HALF_ASIAN_HANDICAP: "asian", SECOND_HALF_ASIAN_HANDICAP: "asian",
  EUROPEAN_HANDICAP: "european", FIRST_HALF_EUROPEAN_HANDICAP: "european", SECOND_HALF_EUROPEAN_HANDICAP: "european",
  CORRECT_SCORE: "score", HALF_TIME_CORRECT_SCORE: "score", SECOND_HALF_CORRECT_SCORE: "score",
});

/**
 * The six "Strzeli gola" columns. Their UOF ids mean "clean sheet", so the team
 * named in the column header (the text after the market name's last " - ") must
 * be the code's side; otherwise the market is dropped rather than re-sided.
 */
const TEAM_COLUMN_SIDE: Readonly<Record<string, "HOME" | "AWAY">> = Object.freeze({
  "mid:32": "HOME", "mid:31": "AWAY",
  "mid:77": "HOME", "mid:76": "AWAY",
  "mid:97": "HOME", "mid:96": "AWAY",
});

/**
 * The six team-total line components. Their keys are CMS slugs ("competitor1"),
 * so the team in the displayed name, "[N. połowa - ]Leeds - Total (suma)", must
 * be the code's side; otherwise the market is dropped rather than re-sided.
 */
const TEAM_TOTAL_SIDE: Readonly<Record<string, "HOME" | "AWAY">> = Object.freeze({
  "slug:competitor1_total_suma": "HOME", "slug:competitor2_total_suma": "AWAY",
  "slug:1_poaowa_competitor_1_suma_goli": "HOME", "slug:1_poaowa_competitor_2_suma_goli": "AWAY",
  "slug:2_poaowa_competitor1_suma_goli_": "HOME", "slug:2_poaowa_competitor2_suma_goli_": "AWAY",
});

const TEAM_TOTAL_NAME = /^(?:\d\. połowa - )?(.+) - Total \(suma\)$/i;

const SIDES_BY_FAMILY: Readonly<Partial<Record<Family, readonly Side[]>>> = Object.freeze({
  result: ["HOME", "DRAW", "AWAY"],
  twoWay: ["HOME", "AWAY"],
  asian: ["HOME", "AWAY"],
  european: ["HOME", "DRAW", "AWAY"],
});

const TOTAL_LINE = /^\d+\.5$/;
const ASIAN_LINE = /^[+-]\d+(\.\d+)?$/;
/** The line a handicap selection carries in its own name: "Leeds (-1.5)", "remis (1:0)". */
const SELECTION_ASIAN_LINE = /\(([+-]?\d+(?:\.\d+)?)\)$/;
const SELECTION_SCORE = /\((\d+:\d+)\)$/;
const MIN_TEAM_LABEL_LENGTH = 3;
const CANONICAL_PREFIX_LENGTH = 4;

/** Same behaviour as the grid parser's cleanName; kept private so no runtime import crosses into the scraper layer. */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Case- and diacritics-insensitive form for team-name comparison ("ł" has no NFD decomposition). */
function fold(s: string): string {
  return collapseWhitespace(s)
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** European handicap line from Totalbet's virtual start score: "1:0" -> "+1", "0:2" -> "-2", "0:0" -> "0". */
export function europeanLineFromScore(score: string): string | undefined {
  const match = /^(\d+):(\d+)$/.exec(score);
  if (!match) return undefined;
  const diff = Number(match[1]) - Number(match[2]);
  return diff > 0 ? `+${diff}` : String(diff);
}

/**
 * Side of a Totalbet selection or column label, e.g. "Leeds (-1.5)" -> HOME.
 * getCanonicalTeamName is fuzzy ("nie" -> Sunderland, "nikt" -> Leeds United),
 * so its answer counts only when the label also starts like the canonical name.
 */
export function resolveSide(label: string, ctx: NormalizationContext): Side {
  const cleaned = collapseWhitespace(label).replace(/\s*\([^)]*\)$/, "");
  if (/^remis$/i.test(cleaned)) return "DRAW";
  if (/^(nikt|żaden|brak)$/i.test(cleaned)) return "NONE";

  const folded = fold(cleaned);
  if (folded.length < MIN_TEAM_LABEL_LENGTH) return "UNKNOWN";

  const contains = (team: string) => {
    const t = fold(team);
    return t !== "" && (folded.includes(t) || t.includes(folded));
  };
  const home = contains(ctx.homeTeam);
  const away = contains(ctx.awayTeam);
  if (home || away) return home && away ? "UNKNOWN" : home ? "HOME" : "AWAY";

  const canonical = getCanonicalTeamName(cleaned, ctx.league);
  if (folded.slice(0, CANONICAL_PREFIX_LENGTH) !== fold(canonical).slice(0, CANONICAL_PREFIX_LENGTH)) return "UNKNOWN";
  const isHome = ctx.homeTeam !== "" && canonical === ctx.homeTeam;
  const isAway = ctx.awayTeam !== "" && canonical === ctx.awayTeam;
  if (isHome === isAway) return "UNKNOWN";
  return isHome ? "HOME" : "AWAY";
}

function resolveMarketCode(raw: RawBookmakerMarket): {
  marketCode: NormalizedMarketType;
  matchedBy: "id" | "name" | "pattern";
  rawId?: string;
} {
  const rawId =
    raw.bookmakerMarketId === undefined || raw.bookmakerMarketId === null ? undefined : String(raw.bookmakerMarketId);

  const byId = rawId === undefined ? undefined : lookup(TOTALBET_MARKET_KEY_TO_CODE, rawId);
  if (byId) return { marketCode: byId, matchedBy: "id", rawId };

  // Names identify only id-less, line-less markets: a component that carries an id or a
  // line is never re-coded by its name (a renamed line component would lose its line,
  // and a column without its own header would pass for another period's market).
  const idLess = (rawId === undefined || rawId === "") && (raw.paramValue === undefined || raw.paramValue === null);
  const byName = idLess ? lookup(TOTALBET_MARKET_NAME_TO_CODE, normalizeMarketName(raw.name)) : undefined;
  if (byName) return { marketCode: byName, matchedBy: "name", rawId };

  return { marketCode: "OTHER", matchedBy: "pattern", rawId };
}

/** The family's line from raw.paramValue; undefined for families without one, null when the line is invalid. */
function lineFor(family: Family, paramValue: string | undefined): string | undefined | null {
  switch (family) {
    case "total":
      return paramValue !== undefined && TOTAL_LINE.test(paramValue) ? paramValue : null;
    case "asian":
      return paramValue !== undefined && ASIAN_LINE.test(paramValue) ? paramValue : null;
    case "european":
      return (paramValue === undefined ? undefined : europeanLineFromScore(paramValue)) ?? null;
    default:
      return undefined;
  }
}

function doubleChanceCode(label: string, ctx: NormalizationContext): NormalizedSelection {
  const parts = collapseWhitespace(label).split(/\s+lub\s+/i);
  if (parts.length !== 2) return "UNKNOWN";
  const sides = new Set(parts.map((p) => resolveSide(p, ctx)));
  if (sides.size !== 2) return "UNKNOWN";
  if (sides.has("HOME") && sides.has("DRAW")) return "HOME_OR_DRAW";
  if (sides.has("HOME") && sides.has("AWAY")) return "HOME_OR_AWAY";
  if (sides.has("DRAW") && sides.has("AWAY")) return "DRAW_OR_AWAY";
  return "UNKNOWN";
}

function selectionCode(family: Family, name: string, ctx: NormalizationContext): NormalizedSelection {
  const label = collapseWhitespace(name);
  switch (family) {
    case "doubleChance":
      return doubleChanceCode(label, ctx);
    case "total":
      return normalizeOverUnderSelection(label);
    case "yesNo":
      return normalizeYesNoSelection(label);
    case "oddEven":
      return normalizeOddEvenSelection(label);
    case "score":
      // Score codes ("1-0") and "OTHER" are catalog SCORE_GRID selections outside the NormalizedSelection union.
      return (parseScoreSelection(label) ?? (/^inny$/i.test(label) ? "OTHER" : "UNKNOWN")) as NormalizedSelection;
    default: {
      const side = resolveSide(label, ctx);
      return SIDES_BY_FAMILY[family]?.includes(side) ? side : "UNKNOWN";
    }
  }
}

/** True unless the market is team-scoped and the team its name shows is not the code's side. */
function teamLabelAgrees(rawId: string | undefined, name: string, ctx: NormalizationContext): boolean {
  if (rawId === undefined) return true;
  const cleaned = collapseWhitespace(name);

  const columnSide = lookup(TEAM_COLUMN_SIDE, rawId);
  if (columnSide) {
    const separator = cleaned.lastIndexOf(" - ");
    return separator >= 0 && resolveSide(cleaned.slice(separator + 3), ctx) === columnSide;
  }

  const totalSide = lookup(TEAM_TOTAL_SIDE, rawId);
  if (totalSide) {
    const team = TEAM_TOTAL_NAME.exec(cleaned)?.[1];
    return team !== undefined && resolveSide(team, ctx) === totalSide;
  }
  return true;
}

type Period = "FULL" | "FIRST_HALF" | "SECOND_HALF";

/** The period a catalog code is about. */
function codePeriod(code: NormalizedMarketType): Period {
  if (code.startsWith("HALF_TIME_") || code.startsWith("FIRST_HALF_")) return "FIRST_HALF";
  if (code.startsWith("SECOND_HALF_")) return "SECOND_HALF";
  return "FULL";
}

/** The period a slug component's displayed name shows: "1. połowa - …", "2. Połowa - …", or none (whole match). */
function namePeriod(name: string): Period {
  const half = /^([12])\.\s*po[łl]owa\b/iu.exec(collapseWhitespace(name))?.[1];
  return half === "1" ? "FIRST_HALF" : half === "2" ? "SECOND_HALF" : "FULL";
}

/**
 * True unless the market is slug-keyed and its displayed name shows another period
 * than its code. A slug is a CMS key that carries the period on its own
 * ("1_poaowa_suma"); a name that disagrees means a reused or misread slug.
 * Column markets (mid keys) are not checked: their period is the column header.
 */
function periodAgrees(rawId: string | undefined, marketCode: NormalizedMarketType, name: string): boolean {
  if (rawId === undefined || !rawId.startsWith("slug:")) return true;
  return namePeriod(name) === codePeriod(marketCode);
}

/**
 * True when every selection carries the market's own line. The grid parser reads a
 * handicap line from the grid position; Totalbet also prints it in each selection
 * name, so a mismatch means the position was misread:
 * - asian: HOME shows the home line, AWAY its negation ("Leeds (-1.5)", "Tottenham (+1.5)")
 * - european: every selection shows the row's start score ("remis (1:0)")
 * A checked selection without its own line fails. Asian selections that resolve to
 * no side are never priced as HOME or AWAY (they stay UNKNOWN), so they are not checked.
 */
function selectionLinesAgree(family: Family, rawLine: string | undefined, selections: TotalbetMarketOutput["selections"]): boolean {
  switch (family) {
    case "asian": {
      const homeLine = Number(rawLine);
      return selections.every((s) => {
        if (s.code !== "HOME" && s.code !== "AWAY") return true;
        const own = SELECTION_ASIAN_LINE.exec(collapseWhitespace(s.label))?.[1];
        return own !== undefined && Number(own) === (s.code === "HOME" ? homeLine : -homeLine);
      });
    }
    case "european":
      return selections.every((s) => SELECTION_SCORE.exec(collapseWhitespace(s.label))?.[1] === rawLine);
    default:
      return true;
  }
}

function hasDuplicateCode(selections: TotalbetMarketOutput["selections"]): boolean {
  const codes = selections.map((s) => s.code).filter((code) => code !== "UNKNOWN");
  return new Set(codes).size !== codes.length;
}

export const totalbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "totalbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const { marketCode, matchedBy, rawId } = resolveMarketCode(raw);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[totalbet] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const marketName = getMarketMetadata(marketCode)?.labels.pl ?? raw.name;
    const debug = { rawName: raw.name, rawId, matchedBy };
    const family = FAMILY_BY_CODE[marketCode];

    if (!family) {
      // Same shape as the factory's null path: keeping paramValue gives each line
      // of an unmapped line component its own storage row.
      const other: TotalbetMarketOutput = {
        marketCode: "OTHER",
        paramValue: raw.paramValue,
        marketKey: "OTHER",
        marketName,
        selections: raw.selections.map((sel) => ({ code: "UNKNOWN", label: sel.name, odds: sel.odds })),
        debug,
      };
      return other;
    }

    const paramValue = lineFor(family, raw.paramValue);
    if (paramValue === null) return null;
    if (!teamLabelAgrees(rawId, raw.name, ctx)) return null;
    if (!periodAgrees(rawId, marketCode, raw.name)) return null;

    const selections = raw.selections.map((sel) => ({
      code: selectionCode(family, sel.name, ctx),
      label: sel.name,
      odds: sel.odds,
    }));
    if (!selectionLinesAgree(family, raw.paramValue, selections)) return null;
    if (hasDuplicateCode(selections)) return null;

    const output: TotalbetMarketOutput = {
      marketCode,
      paramValue,
      marketKey: buildMarketKey(marketCode, paramValue),
      marketName,
      selections,
      debug,
    };
    return output;
  },
};

export default totalbetNormalizer;
