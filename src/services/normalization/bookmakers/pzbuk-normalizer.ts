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
  // Audit: id 12 delivered match-level selections ("remis", team name),
  // not goalscorer players — real identity unknown, park in OTHER so it
  // cannot poison GOALSCORER_FIRST.
  "12": "OTHER",
  "13": "GOALSCORER_LAST",
  "14": "GOALSCORER_ANYTIME",
  "17": "TOTAL_GOALS",
  "18": "HALF_TIME_TOTAL_GOALS",
  // Home/away team totals are separate ids — map them to the dedicated
  // catalog codes so OVER/UNDER selections of both teams do not collide
  // under a single TEAM_TOTAL_GOALS key.
  "19": "HOME_TEAM_TOTAL_GOALS",
  "20": "AWAY_TEAM_TOTAL_GOALS",
  "21": "ODD_EVEN_GOALS",
  // Audit: id 22 delivered goals-count selections ("0"/"1"/"2"/"3+"),
  // not a 2nd-half 1X2 — real identity unknown, park in OTHER.
  "22": "OTHER",
  "23": "SECOND_HALF_TOTAL_GOALS",
  // Audit: id 24 delivered "Nieparzysty"/"Parzysty" (an odd/even variant),
  // not win-to-nil. Ids 25/26/31 were equally unverified guesses mapped to
  // the same binary code — park all of them in OTHER; only id 28 is the
  // confirmed Win To Nil market.
  "24": "OTHER",
  "25": "OTHER",
  "26": "OTHER",
  "27": "BTTS",
  "28": "WIN_TO_NIL",
  "29": "HALF_TIME_BTTS",
  // Audit r2 (Switzerland vs Colombia): id 30 delivered YES 2.36 / NO 1.48
  // while HALF_TIME_BTTS peers sit at YES ~5.3 / NO ~1.13 — a different BTTS
  // variant (full-match or 2nd-half); identity unverified, park in OTHER.
  "30": "OTHER",
  "31": "OTHER",
  // Audit: id 32 odds (YES 11.54 / NO 1.01) are inconsistent with
  // "goals in both halves" — real identity unknown, park in OTHER.
  "32": "OTHER",
  // Audit r2 (both matches): id 33 selections are "<team|remis> & <tak|nie>"
  // (6 outcomes) — a Match Result + BTTS combo, not a clean sheet market.
  "33": "RESULT_AND_BTTS",
  // Audit r2: id 34 was the unverified "away clean sheet" pairing guess of
  // id 33; with 33 proven to be a combo market the guess is void — park it.
  "34": "OTHER",
  // Audit r2 (both matches): id 35 selections are "<team|remis> & <ponad|
  // poniżej> 4.5" — a Match Result + Total Goals combo, not goal ranges.
  "35": "RESULT_AND_TOTAL",
  "36": "EXACT_GOALS",
  "37": "HOME_EXACT_GOALS",
  "38": "AWAY_EXACT_GOALS",
  "39": "RESULT_AND_BTTS",
  "40": "RESULT_AND_TOTAL",
  "41": "DOUBLE_CHANCE_BTTS",
  "42": "DOUBLE_CHANCE_TOTAL",
  "47": "HALF_WITH_MORE_GOALS",
  // Audit: id 49 odds pattern ("równo" @1.32) matches the away-team variant,
  // not the match-level market; 48/49 follow PZBuk's home/away id pairing.
  "48": "HOME_HALF_WITH_MOST_GOALS",
  "49": "AWAY_HALF_WITH_MOST_GOALS",
  // Audit r2 (both matches): id 50 is a 2x2 "tak/nie x tak/nie" grid whose
  // odds are near-identical to forbet's "1./2.Połowa - Obie drużyny strzelą
  // gola" (BTTS per half): first slot = BTTS in 1st half, second = BTTS in
  // 2nd half — the catalog's BTTS_BY_HALF market, not TEAMS_TO_SCORE.
  "50": "BTTS_BY_HALF",
  "55": "MATCH_WINNER",
  "57": "HALF_TIME_FIRST_GOAL",
  "62": "HALF_TIME_TOTAL_GOALS",
  "63": "HALF_TIME_TOTAL_GOALS",
  "64": "HALF_TIME_TOTAL_GOALS",
  "69": "HALF_TIME_BTTS",
  "72": "RESULT_AND_BTTS",
  "73": "RESULT_AND_TOTAL",
  // Audit r2 (both matches): id 76 produced 1X2-shaped odds wildly
  // inconsistent with all peers (Argentina: DRAW 3.39 vs peers 7.6-8.75;
  // Switzerland: DRAW/AWAY values transposed vs peer ranges) — not a
  // trustworthy match-winner source, park in OTHER.
  "76": "OTHER",
  // Audit r2 (both matches): id 77 odds (NONE ~3.2-4.4) match the 2nd-half
  // first-goal market (betfan's confirmed 2nd-half values are near-identical),
  // not the full-match first-team-to-score market.
  "77": "SECOND_HALF_FIRST_GOAL",
  "78": "DOUBLE_CHANCE",
  "79": "DRAW_NO_BET",
  // Audit r2: ids 81/155/166 landed in ASIAN_HANDICAP with UNKNOWN
  // selections (id 155 even carried match-resolution selections) — the
  // handicap guess is wrong; park all three in OTHER. Genuine
  // resolution-method entries are re-routed by detectMarketBySelections.
  "81": "OTHER",
  // Audit r2 (both matches): ids 82/83/84/129/141/142/157/167 were one
  // guess-wave mapped to TOTAL_GOALS, but their O/U odds do not match the
  // param they surface under (e.g. "0.5" rows shaped like 2.5/3.5 lines) —
  // the id->line pairing is untrustworthy, park the family in OTHER.
  "82": "OTHER",
  "83": "OTHER",
  "84": "OTHER",
  "85": "SECOND_HALF_EXACT_GOALS",
  "86": "ODD_EVEN_GOALS",
  "90": "CORRECT_SCORE",
  "91": "FIRST_GOAL_TIME_ALT",
  "92": "FIRST_GOAL_TIME",
  "126": "MATCH_WINNER",
  "127": "FIRST_TEAM_TO_SCORE",
  "128": "TOTAL_SHOTS",
  "129": "OTHER",
  "133": "GOAL_RANGE",
  "134": "GOAL_RANGE",
  "139": "MATCH_WINNER",
  "141": "OTHER",
  "142": "OTHER",
  "147": "HALF_TIME_HOME_EXACT_CARDS",
  "152": "MATCH_WINNER",
  "155": "OTHER",
  "156": "CORNERS_TOTAL",
  "157": "OTHER",
  "159": "CORNERS_RANGE",
  "162": "ODD_EVEN_GOALS",
  // Audit: id 163 produced duplicated DRAW/AWAY odds far off 1X2 peers —
  // it is not the match-winner market; park in OTHER (id 1 is the real 1X2).
  "163": "OTHER",
  "166": "OTHER",
  "167": "OTHER",
  "173": "ODD_EVEN_GOALS",
  "498": "DOUBLE_CHANCE_BTTS",
  "501": "RESULT_AND_BTTS",
  "502": "RESULT_AND_TOTAL",
  "503": "DOUBLE_CHANCE_BTTS",
  "504": "DOUBLE_CHANCE_BTTS",
  "506": "GOAL_RANGE",
  "509": "MULTI_RESULT",
  "510": "HALF_TIME_GOAL_RANGE",
  "511": "GOAL_RANGE",
  "2099": "MATCH_WINNER",
  "2179": "GOALSCORER_ANYTIME",
  "2186": "GOALSCORER_ANYTIME",
  "2395": "GOALSCORER_ANYTIME",
};

/**
 * Name-based routing overrides checked BEFORE the numeric id map.
 * The cross-bookmaker audit proved that several PZBuk market entries carry a
 * reliable API-provided name while their numeric market-type id was
 * mis-identified. Entries here either redirect a market to its correct
 * catalog code or park known non-catalog markets in OTHER so they cannot
 * poison best-odds of unrelated markets.
 */
const PZBUK_NAME_OVERRIDES: Array<{
  pattern: RegExp;
  code: NormalizedMarketType;
}> = [
  // "W jaki sposób rozstrzygnie się mecz?" (regular time / extra time /
  // penalties) — catalog code added in round 1; must not land in
  // ASIAN_HANDICAP
  { pattern: /w jaki spos[oó]b rozstrzygnie/i, code: "MATCH_RESOLUTION_METHOD" },
  // "Zakwalifikowanie się" (to qualify / advance to next stage) — catalog
  // code added in round 1; must not land in HALF_TIME_RESULT
  { pattern: /zakwalifikowanie|awans do/i, code: "TEAM_TO_QUALIFY" },
  // "1. gol" = which team scores the first goal (not a correct-score market)
  { pattern: /^1\.\s*gol$/i, code: "FIRST_TEAM_TO_SCORE" },
];

function matchNameOverride(name: string): NormalizedMarketType | null {
  const trimmed = name.trim();
  for (const override of PZBUK_NAME_OVERRIDES) {
    if (override.pattern.test(trimmed)) return override.code;
  }
  return null;
}

/**
 * Detect well-known markets by their selection vocabulary when the market
 * name is an unresolved "Rynek <id>" placeholder. The audit proved that the
 * match-resolution market (regular time / extra time / penalties) surfaces
 * under an opaque numeric id (e.g. 155) with a blank API name — routing it
 * by id alone would either misroute it or lose it.
 */
function detectMarketBySelections(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): NormalizedMarketType | null {
  const names = raw.selections.map((s) => s.name.toLowerCase().trim());
  if (names.length < 2 || names.length > 4) return null;

  // Team-scoped variants (e.g. WIN_METHOD "<team> po dogrywce") must not be
  // collapsed into the 3-way match-resolution market.
  const homeLower = ctx.homeTeam.toLowerCase();
  const awayLower = ctx.awayTeam.toLowerCase();
  const mentionsTeam = names.some(
    (n) =>
      (homeLower.length >= 3 && n.includes(homeLower)) ||
      (awayLower.length >= 3 && n.includes(awayLower))
  );
  if (mentionsTeam) return null;

  const hasRegular = names.some((n) => n.includes("regulaminow"));
  const hasExtraTime = names.some((n) => n.includes("dogryw"));
  const hasPenalties = names.some((n) => /rzut\w* karn/.test(n));
  const hits = [hasRegular, hasExtraTime, hasPenalties].filter(Boolean).length;
  if (hits >= 2) return "MATCH_RESOLUTION_METHOD";

  return null;
}

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
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "MATCH_RESOLUTION_METHOD": {
      // "w regulaminowym czasie gry" / "po dogrywce" / "po rzutach karnych"
      if (/regulaminow/i.test(trimmed)) return "REGULAR_TIME" as NormalizedSelection;
      if (/dogryw/i.test(trimmed)) return "EXTRA_TIME" as NormalizedSelection;
      if (/karn/i.test(trimmed)) return "PENALTIES" as NormalizedSelection;
      return "UNKNOWN";
    }

    case "TEAM_TO_QUALIFY":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "BTTS_BY_HALF": {
      // PZBuk renders the market as a "<1st half>/<2nd half>" yes/no grid:
      // "tak/nie" = both teams score in the 1st half only, etc.
      const grid = trimmed.toLowerCase().match(/^(tak|nie|yes|no)\s*\/\s*(tak|nie|yes|no)$/);
      if (grid) {
        const first = grid[1] === "tak" || grid[1] === "yes";
        const second = grid[2] === "tak" || grid[2] === "yes";
        if (first && second) return "Both" as NormalizedSelection;
        if (first) return "1st" as NormalizedSelection;
        if (second) return "2nd" as NormalizedSelection;
        return "None" as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "FIRST_TEAM_TO_SCORE":
    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL": {
      // "żaden" / "nikt" / "bez gola" = no goal, "obie" = both teams
      if (/^(żaden|zaden|nikt|brak gola|bez gola|none|no goal)$/i.test(trimmed)) {
        return "NONE";
      }
      if (/^(obie|obydwie|obie dru[zż]yny|both)$/i.test(trimmed)) {
        return "BOTH" as NormalizedSelection;
      }
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "DOUBLE_CHANCE": {
      const dc = normalizeDoubleChanceSelection(trimmed);
      if (dc !== "UNKNOWN") return dc;
      // PZBuk renders double chance with team names, e.g. "Argentina lub
      // remis", "remis lub Cape Verde", "Argentina lub Cape Verde".
      const teamOrDraw = trimmed.match(/^(.+?)\s+lub\s+remis$/i);
      if (teamOrDraw) {
        const side = normalize1x2Selection(
          teamOrDraw[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        if (side === "HOME") return "HOME_OR_DRAW";
        if (side === "AWAY") return "DRAW_OR_AWAY";
      }
      const drawOrTeam = trimmed.match(/^remis\s+lub\s+(.+)$/i);
      if (drawOrTeam) {
        const side = normalize1x2Selection(
          drawOrTeam[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        if (side === "HOME") return "HOME_OR_DRAW";
        if (side === "AWAY") return "DRAW_OR_AWAY";
      }
      const teamOrTeam = trimmed.match(/^(.+?)\s+lub\s+(.+)$/i);
      if (teamOrTeam) {
        const first = normalize1x2Selection(
          teamOrTeam[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const second = normalize1x2Selection(
          teamOrTeam[2].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        if (
          (first === "HOME" && second === "AWAY") ||
          (first === "AWAY" && second === "HOME")
        ) {
          return "HOME_OR_AWAY";
        }
      }
      return "UNKNOWN";
    }

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS": {
      // "bez gola" / "0 goli" → "0"
      if (/^(bez gola|bez goli|brak goli|0 goli)$/i.test(trimmed)) {
        return "0" as NormalizedSelection;
      }
      // Range buckets "1-2", "2-3" (also en dash / spaced variants)
      const range = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (range) return `${range[1]}-${range[2]}` as NormalizedSelection;
      // Plain counts ("0", "1", "2") and open buckets ("3+", "4+")
      if (/^\d+\+?$/.test(trimmed)) return trimmed as NormalizedSelection;
      const plus = trimmed.match(/^(\d+)\s+lub wi[eę]cej$/i);
      if (plus) return `${plus[1]}+` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT": {
      // Minute buckets "1-10" / "1-15" ... "81-90" and "żaden" (no goal)
      const range = trimmed.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
      if (range) return `${range[1]}-${range[2]}` as NormalizedSelection;
      if (/^(żaden|zaden|nikt|brak gola|bez gola|none|no goal)$/i.test(trimmed)) {
        return "NONE";
      }
      return trimmed as NormalizedSelection;
    }

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS": {
      const lower = trimmed.toLowerCase();
      if (/1\.?\s*po[łl]ow/.test(lower) || /^(1st|pierwsza)/.test(lower)) {
        return "1st" as NormalizedSelection;
      }
      if (/2\.?\s*po[łl]ow/.test(lower) || /^(2nd|druga)/.test(lower)) {
        return "2nd" as NormalizedSelection;
      }
      if (/^(po\s+)?(r[óo]wno|remis|equal|draw|x)$/.test(lower)) {
        return "Draw" as NormalizedSelection;
      }
      return "UNKNOWN";
    }

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
      return trimmed.replace(/^\d+\.\s*/, "").trim() as NormalizedSelection;

    case "RESULT_AND_BTTS":
    case "RESULT_AND_TOTAL":
    case "DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_TOTAL":
      return parseCombinationSelection(trimmed, ctx);

    case "OTHER": {
      // Keep OTHER selections distinguishable: normalize the common binary
      // vocabularies, otherwise keep the raw label as the selection code so
      // different parked sub-markets do not collapse into one UNKNOWN slot.
      if (/^(tak|yes)$/i.test(trimmed)) return "YES";
      if (/^(nie|no)$/i.test(trimmed)) return "NO";
      const oddEven = normalizeOddEvenSelection(trimmed);
      if (oddEven !== "UNKNOWN") return oddEven;
      return trimmed as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function parseCombinationSelection(
  selName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const lower = selName.toLowerCase();

  // PZBuk renders result-combo selections as "<team|remis> & <tak|nie>" or
  // "<team|remis> & <ponad|poniżej> X.Y" — split on "&" and resolve the
  // result side against the context teams so e.g. "Argentina & tak" becomes
  // HOME_YES instead of collapsing into a bare HOME.
  const comboParts = selName.split(/\s*&\s*/);
  if (comboParts.length === 2) {
    const side = normalize1x2Selection(
      comboParts[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
    );
    const secondLower = comboParts[1].toLowerCase().trim();
    let suffix: string | null = null;
    if (/^(tak|yes)\b/.test(secondLower)) suffix = "YES";
    else if (/^(nie|no)\b/.test(secondLower)) suffix = "NO";
    else if (/^(ponad|powy[żz]ej|over|\+)/.test(secondLower)) suffix = "OVER";
    else if (/^(poni[żz]ej|under|-)/.test(secondLower)) suffix = "UNDER";
    if (suffix && (side === "HOME" || side === "DRAW" || side === "AWAY")) {
      return `${side}_${suffix}` as NormalizedSelection;
    }
  }

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

  return normalize1x2Selection(selName, ctx.homeTeam, ctx.awayTeam, ctx.league);
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
    "HOME_TEAM_TOTAL_GOALS",
    "AWAY_TEAM_TOTAL_GOALS",
    "ASIAN_HANDICAP",
    "EUROPEAN_HANDICAP",
    "RESULT_AND_TOTAL",
    "DOUBLE_CHANCE_TOTAL",
  ];

  if (!parameterizedMarkets.includes(marketCode)) return undefined;

  // Prefer the vendor-provided line (PZBuk selection "points") forwarded by
  // the parser — it is paired with the odds structurally, unlike numbers
  // scraped out of selection labels which the audit showed can be shifted.
  if (raw.paramValue) {
    return raw.paramValue.replace(",", ".");
  }

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
    // Name overrides take precedence over the numeric id map — see
    // PZBUK_NAME_OVERRIDES for the audit rationale.
    let marketCode: NormalizedMarketType | null = matchNameOverride(raw.name);
    let matchedBy: "id" | "name" = marketCode ? "name" : "id";

    // Selection-vocabulary detection rescues known markets hidden behind
    // opaque numeric ids with blank API names (see detectMarketBySelections).
    if (!marketCode) {
      marketCode = detectMarketBySelections(raw, ctx);
      if (marketCode) matchedBy = "name";
    }

    if (!marketCode && raw.bookmakerMarketId) {
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
