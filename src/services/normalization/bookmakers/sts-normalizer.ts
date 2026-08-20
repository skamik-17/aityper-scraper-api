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
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
  canonicalizePlayerName,
} from "../helpers/index.js";
import { isValidMarketCode, getCategoryForMarket } from "../../../data/market-catalog.js";

export const STS_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {
  1: "MATCH_WINNER",
  10: "DOUBLE_CHANCE",
  4: "DRAW_NO_BET",
  11: "DRAW_NO_BET",
  259: "DRAW_NO_BET",
  314: "DRAW_NO_BET",
  368: "DRAW_NO_BET",

  14: "EUROPEAN_HANDICAP",
  17: "WINNING_MARGIN",
  20: "ASIAN_HANDICAP_PUSH",
  22: "ASIAN_HANDICAP",
  33: "EXACT_GOALS",
  52: "GOALSCORER_FIRST",
  53: "GOALSCORER_LAST",
  54: "GOALSCORER_ANYTIME",
  2356: "HALF_TIME_GOALSCORER_ANYTIME",
  57: "HT_FT_CORRECT_SCORE",
  74: "HALF_TIME_DOUBLE_CHANCE",
  75: "HALF_TIME_DRAW_NO_BET",
  76: "FIRST_HALF_EUROPEAN_HANDICAP",
  77: "FIRST_HALF_ASIAN_HANDICAP_PUSH",
  79: "FIRST_HALF_ASIAN_HANDICAP",
  // Audit /audit-match (Arsenal vs Coventry City): STS quotes whole-number
  // goal lines as a separate "z możliwym zwrotem" market; peers publish the
  // identical push line inside the plain total-goals family, so route it
  // there instead of into a bookmaker-exclusive *_ASIAN code.
  80: "HALF_TIME_TOTAL_GOALS",
  82: "HALF_TIME_TOTAL_GOALS",
  85: "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
  88: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  95: "HALF_TIME_BTTS",
  101: "HALF_TIME_CORRECT_SCORE",
  102: "SECOND_HALF_RESULT",
  106: "SECOND_HALF_EUROPEAN_HANDICAP",
  107: "SECOND_HALF_ASIAN_HANDICAP_PUSH",
  109: "SECOND_HALF_ASIAN_HANDICAP",
  // Same reasoning as id 80 above.
  110: "SECOND_HALF_TOTAL_GOALS",
  112: "SECOND_HALF_TOTAL_GOALS",
  124: "SECOND_HALF_CORRECT_SCORE",
  1051: "PLAYER_GOAL_AND_RESULT",

  // Audit /audit-match (premier-league Arsenal vs Coventry City): STS quotes
  // every player stat twice — unconditionally, and again with
  // 'musi wyjść w "11", z dogrywką' (settled only if the player starts,
  // counted through extra time). The conditional ids below used to own the
  // shared PLAYER_* codes, so their prices were compared against the plain bet
  // every other bookmaker offers, while STS's own unconditional markets
  // (ids 2394/2395/2396/2397/2404, 42 players each) were dropped entirely.
  1851: "PLAYER_SHOTS_LINEUP",
  1263: "PLAYER_SHOTS_LINEUP",
  1852: "PLAYER_SHOTS_ON_TARGET_LINEUP",
  1264: "PLAYER_SHOTS_ON_TARGET_LINEUP",
  1853: "PLAYER_PASSES_LINEUP",
  1855: "PLAYER_CARDS_LINEUP",
  1854: "PLAYER_TACKLES_LINEUP",
  2394: "PLAYER_SHOTS",
  2395: "PLAYER_SHOTS_ON_TARGET",
  2396: "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX",
  2397: "PLAYER_ASSISTS",
  // id 2361 ("Zawodnik - celne strzały głową - N lub więcej") is the
  // transposed twin of 2404 with cell-for-cell identical prices. Because
  // PLAYER_HEADER_SHOTS_ON_TARGET is not in extractParamValue()'s
  // parameterizedMarkets list and the generic per-player regex excludes
  // names starting with "Zawodnik", all three of 2361's raw sub-markets
  // (1+/2+/3+) resolve to the same bare "PLAYER_HEADER_SHOTS_ON_TARGET" key
  // with no player param, colliding with each other under the grouper's
  // "first raw market wins" rule and losing 2 of the 3 thresholds - not
  // colliding with 2404, which keys per player. Intentionally left unmapped.
  2404: "PLAYER_HEADER_SHOTS_ON_TARGET",

  // Audit /audit-match (Arsenal vs Coventry City): six "Zawodnik - <event>"
  // dropdown markets (one raw market, 32-47 player-name selections) that the
  // catalog already carries codes for and that 4-7 other bookmakers feed.
  1892: "PLAYER_HEADER_GOAL",
  1896: "PLAYER_RED_CARD",
  1903: "PLAYER_GOAL_OR_ASSIST",
  2168: "PLAYER_GOAL_AND_ASSIST",
  2357: "PLAYER_LEFT_FOOT_GOAL",
  2358: "PLAYER_RIGHT_FOOT_GOAL",
  2318: "PLAYER_GOAL_OUTSIDE_BOX",

  25: "TOTAL_GOALS",
  28: "HOME_TEAM_TOTAL_GOALS",
  31: "AWAY_TEAM_TOTAL_GOALS",
  // Same reasoning as id 80/110 above: route the "z możliwym zwrotem"
  // whole-number line into the plain TOTAL_GOALS family instead of the
  // bookmaker-exclusive *_ASIAN code.
  23: "TOTAL_GOALS",

  43: "BTTS",
  121: "SECOND_HALF_BTTS",

  8: "FIRST_TEAM_TO_SCORE",
  9: "LAST_TEAM_TO_SCORE",
  71: "HALF_TIME_RESULT",
  283: "CORRECT_SCORE",
  44: "TEAMS_TO_SCORE",
  35: "HOME_EXACT_GOALS",
  36: "AWAY_EXACT_GOALS",
  47: "HOME_WIN_TO_NIL",
  48: "AWAY_WIN_TO_NIL",
  236: "HOME_CORNERS_RANGE",
  237: "AWAY_CORNERS_RANGE",
  814: "HOME_GOAL_RANGE",
  815: "AWAY_GOAL_RANGE",

  220: "CORNERS_RACE",
  221: "FIRST_CORNER",
  225: "CORNERS_HANDICAP",
  228: "CORNERS_TOTAL",
  235: "CORNERS_RANGE",
  239: "HALF_TIME_CORNERS_RACE",
  244: "HALF_TIME_CORNERS_HANDICAP",
  247: "HALF_TIME_CORNERS_TOTAL",
  257: "HALF_TIME_CORNERS_ODD_EVEN",

  238: "CORNERS_ODD_EVEN",

  231: "CORNERS_TEAM",
  234: "CORNERS_TEAM",
  254: "HALF_TIME_HOME_EXACT_CORNERS",
  255: "HALF_TIME_AWAY_EXACT_CORNERS",
  256: "HALF_TIME_CORNERS_RANGE",
  807: "HALF_TIME_DOUBLE_CHANCE_BTTS",
  808: "SECOND_HALF_RESULT_AND_BTTS",
  809: "SECOND_HALF_RESULT_AND_TOTAL",
  810: "SECOND_HALF_DOUBLE_CHANCE_BTTS",
  811: "DOUBLE_CHANCE_BTTS",
  812: "DOUBLE_CHANCE_TOTAL",
  // Audit /audit-loop round 6 (Arsenal vs Coventry City): "Liczba goli -
  // przedziały" (813) lists 17 overlapping/cumulative bands (0, 1-2..1-6,
  // 2-3..2-6, 3-4..3-6, 4-5, 4-6, 5-6, 7+) - this is the same cumulative
  // multi-goal ladder etoto/forbet quote as MULTI_GOAL_RANGE, not the
  // disjoint exhaustive-partition GOAL_RANGE family. The selection set
  // matches the MULTI_GOAL_RANGE catalog entry exactly (17/17).
  813: "MULTI_GOAL_RANGE",
  816: "MULTI_RESULT",
  817: "HALF_TIME_GOAL_RANGE",
  818: "SECOND_HALF_GOAL_RANGE",

  178: "CARDS_RACE",
  199: "HALF_TIME_CARDS_RACE",
  179: "FIRST_CARD",
  185: "CARDS_TOTAL",
  192: "CARDS_EXACT_RANGE",
  206: "HALF_TIME_CARDS_TOTAL",
  188: "CARDS_TEAM",
  191: "CARDS_TEAM",
  193: "HOME_EXACT_CARDS",
  194: "AWAY_EXACT_CARDS",
  214: "HALF_TIME_HOME_EXACT_CARDS",
  215: "HALF_TIME_AWAY_EXACT_CARDS",
  196: "RED_CARD",
  197: "OTHER",
  198: "OTHER",
  217: "HALF_TIME_RED_CARD",
  2098: "EACH_TEAM_TOTAL_CARDS_OVER",

  125: "FIRST_GOAL_TIME_ALT",
  126: "FIRST_GOAL_TIME",
  132: "TIME_PERIOD_RESULT",

  49: "RESULT_AND_BTTS",
  50: "TOTAL_GOALS_AND_BTTS",
  51: "RESULT_AND_TOTAL",
  99: "HALF_TIME_RESULT_AND_TOTAL",
  58: "HALFTIME_FULLTIME",
  258: "FIRST_GOAL_AND_RESULT",

   1229: "HOME_TEAM_TO_SCORE",
  1224: "AWAY_TEAM_TO_SCORE",

  40: "ODD_EVEN_GOALS",
  41: "HOME_TEAM_ODD_EVEN_GOALS",
  42: "AWAY_TEAM_ODD_EVEN_GOALS",

  59: "HOME_WIN_BOTH_HALVES",
  60: "AWAY_WIN_BOTH_HALVES",
  61: "HOME_WIN_AT_LEAST_ONE_HALF",
  62: "AWAY_WIN_AT_LEAST_ONE_HALF",
  63: "HALF_WITH_MORE_GOALS",
  64: "HOME_HALF_WITH_MOST_GOALS",
  65: "AWAY_HALF_WITH_MOST_GOALS",
  66: "BTTS_BY_HALF",
  67: "HOME_SCORE_BOTH_HALVES",
  68: "AWAY_SCORE_BOTH_HALVES",
  69: "BOTH_HALVES_OVER_GOALS",
  70: "BOTH_HALVES_UNDER_GOALS",

  73: "HALF_TIME_FIRST_GOAL",

  90: "HALF_TIME_EXACT_GOALS",
  94: "HALF_TIME_ODD_EVEN_GOALS",
  98: "HALF_TIME_RESULT_AND_BTTS",

  103: "SECOND_HALF_FIRST_GOAL",
  104: "SECOND_HALF_DOUBLE_CHANCE",
  105: "SECOND_HALF_DRAW_NO_BET",

  115: "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
  118: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  119: "SECOND_HALF_EXACT_GOALS",
  120: "SECOND_HALF_ODD_EVEN_GOALS",

  1012: "HALFTIME_FULLTIME_AND_TOTAL",
  1232: "HALF_TIME_AWAY_TO_SCORE",
  1233: "HALF_TIME_HOME_TO_SCORE",
  1234: "SECOND_HALF_AWAY_TO_SCORE",
  1235: "SECOND_HALF_HOME_TO_SCORE",
  1244: "HT_OR_FT_RESULT",

  1413: "PENALTY_AWARDED",
  1561: "MOST_SHOTS_ON_TARGET",
  1562: "OTHER",
  1897: "PLAYER_TACKLES",
  2006: "PLAYER_INTERCEPTIONS",
  2004: "PLAYER_FOULS_WON",
  2005: "PLAYER_FOULS",
  2011: "PLAYER_SAVES",
  // Audit /audit-match (Arsenal vs Coventry City): STS renumbered its
  // player-stat markets; 2004/2005/2011 no longer appear in the offer.
  2398: "PLAYER_FOULS",
  2399: "PLAYER_FOULS_WON",
  2400: "PLAYER_OFFSIDES",
  2401: "PLAYER_SAVES",
  1898: "OTHER",
  1899: "RED_CARD_AND_PENALTY",
  1845: "PLAYER_ASSISTS_LINEUP",
  1850: "PLAYER_GOALS_LINEUP",
  2111: "FOULS_TOTAL",
  2112: "OTHER",
  2113: "OTHER",
  2114: "OWN_GOAL",
  2097: "EACH_TEAM_TOTAL_CORNERS_OVER",
  2153: "PLAYER_RED_CARD",
};

const STS_SELECTION_OVERRIDES: Record<string, NormalizedSelection> = {
  "3": "DRAW",
  "26": "YES",
  "27": "NO",
  "4": "HOME",
  "5": "AWAY",
};

// Name-based fallback patterns for when ID is not available
const STS_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType; extractParam?: (match: RegExpMatchArray) => string | undefined }> = [
  // Main markets
  { pattern: /^wynik\s+meczu$/i, code: "MATCH_WINNER" },
  { pattern: /^podw[oó]jna\s+szansa$/i, code: "DOUBLE_CHANCE" },
  { pattern: /^remis\s*=\s*zwrot$/i, code: "DRAW_NO_BET" },

  // Goals markets - with parameter extraction
  { pattern: /^liczba\s+goli\s+(\d+[.,]\d+)$/i, code: "TOTAL_GOALS", extractParam: (m) => m[1]?.replace(",", ".") },
  { pattern: /^liczba\s+goli\s+\(zwrot\)\s*(\d+)$/i, code: "TOTAL_GOALS", extractParam: (m) => m[1] },
  { pattern: /^obie\s+dru[zż]yny\s+strzel[aą]$/i, code: "BTTS" },

  // Half-time markets
  { pattern: /^wynik\s+1\.\s*po[lł]owy$/i, code: "HALF_TIME_RESULT" },
  { pattern: /^liczba\s+goli\s+1\.\s*po[lł]ow[ay]$/i, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^obie\s+strzel[aą]\s+1\.\s*po[lł]ow[ay]$/i, code: "HALF_TIME_BTTS" },

  // Second half markets  
  { pattern: /^wynik\s+2\.\s*po[lł]owy$/i, code: "SECOND_HALF_RESULT" },
  { pattern: /^liczba\s+goli\s+2\.\s*po[lł]ow[ay]$/i, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /^2\.?\s*po[lł]ow.*zak[lł]ad\s+bez\s+remisu/i, code: "SECOND_HALF_DRAW_NO_BET" },
  { pattern: /^2\.?\s*po[lł]ow.*podw[oó]jna\s+szansa$/i, code: "SECOND_HALF_DOUBLE_CHANCE" },

  // Correct score
  { pattern: /^dok[lł]adny\s+wynik$/i, code: "CORRECT_SCORE" },

  // Handicap markets
  { pattern: /^handicap\s+azjatycki\s+1\.?\s*po[lł]/i, code: "ASIAN_HANDICAP" },
  { pattern: /^handicap\s+europejski\s+1\.?\s*po[lł]/i, code: "EUROPEAN_HANDICAP" },
  { pattern: /^handicap\s+azjatycki\s+2\.?\s*po[lł]/i, code: "SECOND_HALF_ASIAN_HANDICAP" },
  { pattern: /^handicap\s+europejski\s+2\.?\s*po[lł]/i, code: "EUROPEAN_HANDICAP" },

  // Special markets
  { pattern: /^parzyste.*nieparzyste|^nieparzyste.*parzyste/i, code: "ODD_EVEN_GOALS" },
  { pattern: /^wygrana\s+do\s+zera/i, code: "WIN_TO_NIL" },
  { pattern: /^czyste\s+konto/i, code: "CLEAN_SHEET" },

  // Combination markets
  { pattern: /^wynik.*i.*liczba\s+goli/i, code: "RESULT_AND_TOTAL" },
  { pattern: /^wynik.*i.*obie.*strzel/i, code: "RESULT_AND_BTTS" },
  { pattern: /^po[lł]owa.*koniec|^ht.*ft/i, code: "HALFTIME_FULLTIME" },

  // Goalscorer markets
  { pattern: /^pierwszy.*strzelec|^strzelec.*pierwsz/i, code: "GOALSCORER_FIRST" },
  { pattern: /^ostatni.*strzelec|^strzelec.*ostatni/i, code: "GOALSCORER_LAST" },
  { pattern: /^strzelec\s+gola|^gol.*kiedykolwiek/i, code: "GOALSCORER_ANYTIME" },

  // Corners
  { pattern: /^rz[uó]ty\s+ro[zż]ne.*suma|^suma.*rz[uó]t[oó]w\s+ro[zż]nych/i, code: "CORNERS_TOTAL" },
  { pattern: /^pierwszy\s+rz[uó]t\s+ro[zż]ny/i, code: "FIRST_CORNER" },

  // Cards
  { pattern: /^kartki.*suma|^suma.*kartek/i, code: "CARDS_TOTAL" },
  { pattern: /^pierwsza\s+kartka/i, code: "FIRST_CARD" },
  { pattern: /otrzyma\s+kartkę/i, code: "PLAYER_CARDS" },
  // Team scoring
  { pattern: /gospodarz.*strzeli|^dru[zż]yna\s+1.*strzeli/i, code: "HOME_TEAM_TO_SCORE" },
  { pattern: /go[sś][cć].*strzeli|^dru[zż]yna\s+2.*strzeli/i, code: "AWAY_TEAM_TO_SCORE" },

  // First team to score
  { pattern: /^kt[oó]ra.*pierwsz.*strzeli|^pierwsz.*gol/i, code: "FIRST_TEAM_TO_SCORE" },
];

function resolveMarketFromName(name: string): { code: NormalizedMarketType; param?: string } | null {
  const normalized = name.toLowerCase().trim();

  for (const { pattern, code, extractParam } of STS_NAME_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const param = extractParam?.(match);
      return { code, param };
    }
  }

  return null;
}

function extractStsMarketId(marketName: string): number | null {
  const match = marketName.match(/^Rynek\s+(\d+)$/iu);
  return match ? Number(match[1]) : null;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isTeamInSelection(normalizedSelection: string, normalizedTeamName: string): boolean {
  if (normalizedSelection.includes(normalizedTeamName)) return true;
  
  const teamParts = normalizedTeamName.split(" ");
  const selectionParts = normalizedSelection.split(" ");

  if (teamParts.length >= 2) {
    const matchingParts = teamParts.filter(part => {
      if (selectionParts.includes(part)) return true;
      // Min 4 chars for substring matching to prevent "ham" matching "wolverhampton"
      if (part.length >= 4) {
        return selectionParts.some(selPart => selPart.includes(part) || part.includes(selPart));
      }
      return false;
    });
    if (matchingParts.length >= 1) return true;
  }

  return false;
}

function normalizeSts1x2Selection(selectionName: string, ctx: NormalizationContext): NormalizedSelection {
  const normalizedSelection = normalizeName(selectionName);
  const home = normalizeName(ctx.homeTeam);
  const away = normalizeName(ctx.awayTeam);

  if (normalizedSelection === "remis" || normalizedSelection.includes("remis")) {
    return "DRAW";
  }

  if (home && isTeamInSelection(normalizedSelection, home)) {
    return "HOME";
  }
  if (away && isTeamInSelection(normalizedSelection, away)) {
    return "AWAY";
  }

  return normalize1x2Selection(selectionName, ctx.homeTeam, ctx.awayTeam, ctx.league);
}

// STS emits several player-dropdown markets' raw selections as
// space-separated "Lastname Firstname" (no comma) - e.g. "Digne Lucas",
// "Kante N'Golo" - the opposite of the canonical "Firstname Lastname" order
// used by peers (superbet/forbet/etoto emit "Lucas Digne"/"N'Golo Kante").
// canonicalizePlayerName() only reorders the comma-delimited "Last, First"
// pattern, so it silently no-ops on STS's space-only format, stranding each
// STS-quoted player as a duplicate top-level selection instead of merging
// with peers. Flip simple two-token names before handing off to the shared
// helper.
// The generic two-token flip above cannot reorder 3+ token STS names, and
// for some players STS omits a name part entirely rather than abbreviating
// it. Audit /audit-match (Arsenal vs Coventry City, GOALSCORER_ANYTIME):
// "Borges Rodrigues R." (STS's own "Lastname[ Lastname2] Firstname" order,
// here with an abbreviated firstname) and "Brau Miguel Angel" (STS drops
// the second surname "Blanquez" entirely) both stranded a duplicate row
// instead of merging into the canonical "Raphael Borges Rodrigues" /
// "Miguel Angel Brau Blanquez" already established by peer bookmakers.
// A general reorder heuristic would guess wrong for one of the two shapes,
// so these are pinned explicitly rather than inferred.
// - "Hamer G." (STS's own abbreviated-firstname shorthand for Coventry's
//   Gustavo Hamer) stranded a duplicate "G. Hamer" row instead of merging
//   into the full "Gustavo Hamer" form used by betcris/betfan/lvbet/superbet
//   (audit /audit-match, Arsenal vs Coventry City, PLAYER_GOAL_AND_ASSIST).
// - "Simms E." (same abbreviated-firstname shorthand, this time for
//   Coventry's Ellis Simms) reorders to "E. Simms" via the generic flip
//   above, which stranded a duplicate row under PLAYER_DROPDOWN markets
//   (e.g. PLAYER_GOAL_AND_ASSIST) instead of merging into the full
//   "Ellis Simms" form used by betcris/betfan/lvbet (round 7b MINOR audit,
//   Arsenal vs Coventry City).
const STS_PLAYER_NAME_OVERRIDES: Record<string, string> = {
  "Borges Rodrigues R.": "Raphael Borges Rodrigues",
  "Brau Miguel Angel": "Miguel Angel Brau Blanquez",
  "Hamer G.": "Gustavo Hamer",
  "Simms E.": "Ellis Simms",
};

// Shared reorder+override logic for STS's "Lastname Firstname" player names,
// usable both where the player is a SELECTION (stsPlayerNameSelection) and
// where the player is a PARAM extracted from the raw market name (e.g.
// "Vieira Fabio - asysty" -> paramValue). Previously only the selection path
// applied this flip, so param-extracted names like "Vieira Fabio" and
// "Zubimendi Martin" passed canonicalizePlayerName() unchanged (no comma to
// swap on) and stranded a duplicate "Lastname Firstname" row instead of
// merging with peers' canonical "Fabio Vieira" / "Martin Zubimendi" (audit
// /audit-match, Arsenal vs Coventry City, PLAYER_ASSISTS).
function stsCanonicalizePlayerName(trimmed: string): string {
  const nameOnly = trimmed.replace(/^\d+\.\s*/, "").trim();
  const override = STS_PLAYER_NAME_OVERRIDES[nameOnly];
  if (override) return override;
  const tokens = nameOnly.split(/\s+/);
  const reordered = tokens.length === 2 ? `${tokens[1]} ${tokens[0]}` : nameOnly;
  return canonicalizePlayerName(reordered);
}

function stsPlayerNameSelection(trimmed: string): NormalizedSelection {
  return stsCanonicalizePlayerName(trimmed) as NormalizedSelection;
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  marketName?: string
): NormalizedSelection {
  const trimmed = selName.trim();
  const lower = trimmed.toLowerCase();

  const override = STS_SELECTION_OVERRIDES[trimmed];
  // Markets whose selections are raw counts/ranges ("0", "1", "2", "3+") -
  // numeric selection-ID overrides must NOT be applied to them
  const numericSelectionMarkets = [
    "GOAL_RANGE",
    "MULTI_GOAL_RANGE",
    "TEAM_GOAL_RANGE",
    "HALF_TIME_GOAL_RANGE",
    "SECOND_HALF_GOAL_RANGE",
    "EXACT_GOALS",
    "CORNERS_RANGE",
    "HALF_TIME_CORNERS_RANGE",
    "HALF_TIME_EXACT_GOALS",
    "CORNERS_TEAM_RANGE",
    "HALF_TIME_CORNERS_TEAM_RANGE",
    "HOME_EXACT_GOALS",
    "AWAY_EXACT_GOALS",
    "HOME_GOAL_RANGE",
    "AWAY_GOAL_RANGE",
    "HOME_CORNERS_RANGE",
    "AWAY_CORNERS_RANGE",
    "SECOND_HALF_HOME_EXACT_GOALS",
    "SECOND_HALF_EXACT_GOALS",
    "TEAM_TOTAL_SCORERS",
    "HOME_EXACT_CARDS",
    "AWAY_EXACT_CARDS",
    "HALF_TIME_HOME_EXACT_CARDS",
    "HALF_TIME_AWAY_EXACT_CARDS",
    "CARDS_EXACT_RANGE",
    "HALF_TIME_HOME_EXACT_CORNERS",
    "HALF_TIME_AWAY_EXACT_CORNERS",
  ];
  if (override && !numericSelectionMarkets.includes(marketCode)) return override;

  if (/^1\s*\([+-]/.test(trimmed)) return "HOME";
  if (/^2\s*\([+-]/.test(trimmed)) return "AWAY";
  if (/^x\s*\(/i.test(trimmed)) return "DRAW";

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "HT_OR_FT_RESULT":
    case "TIME_PERIOD_RESULT":
    case "DRAW_NO_BET":
    case "HALF_TIME_DRAW_NO_BET":
    case "SECOND_HALF_DRAW_NO_BET":
    case "CORNERS_RACE":
    case "CARDS_RACE":
    case "HALF_TIME_CARDS_RACE":
    case "MOST_SHOTS_ON_TARGET":
      return normalizeSts1x2Selection(trimmed, ctx);

    case "FIRST_CARD":
      if (lower === "bez gola" || lower === "brak" || lower === "żaden" || lower === "bez kartek") return "NONE" as NormalizedSelection;
      return normalizeSts1x2Selection(trimmed, ctx);

    case "HALF_TIME_CORNERS_RACE":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalizeSts1x2Selection(trimmed, ctx);

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
    case "FIRST_CORNER":
      if (lower === "bez gola" || lower === "brak gola" || lower === "żaden" || lower === "brak" || lower === "remis") return "NONE" as NormalizedSelection;
      // STS emits bare positional codes derived from GLOBAL outcome IDs
      // (id 6 -> "1" = home team, id 8 -> "2" = away team). Map them
      // explicitly so the result never depends on selection order or on
      // the generic 1X2 fallback heuristics.
      if (trimmed === "1") return "HOME";
      if (trimmed === "2") return "AWAY";
      return normalizeSts1x2Selection(trimmed, ctx);

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "HALF_TIME_TOTAL_GOALS_ASIAN":
    case "SECOND_HALF_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS_ASIAN":
    case "CORNERS_TOTAL":
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
    case "HALF_TIME_HOME_TEAM_TOTAL_GOALS":
    case "HALF_TIME_AWAY_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_HOME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "TEAM_TOTAL_GOALS":
    case "HALF_TIME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_TEAM_TOTAL_GOALS":
      if (marketName) {
        const mName = marketName.toLowerCase();
        const sel = normalizeOverUnderSelection(trimmed);
        if (sel === "OVER" || sel === "UNDER") {
          if (mName.includes("gosp") || mName.includes("home") || mName.includes("1")) {
            return `HOME_${sel}` as NormalizedSelection;
          }
          if (mName.includes("gość") || mName.includes("gosc") || mName.includes("away") || mName.includes("2")) {
            return `AWAY_${sel}` as NormalizedSelection;
          }
        }
      }
      return normalizeOverUnderSelection(trimmed);

    case "HOME_EXACT_CARDS":
    case "AWAY_EXACT_CARDS":
    case "HALF_TIME_HOME_EXACT_CORNERS":
    case "HALF_TIME_AWAY_EXACT_CORNERS": {
      // STS labels these full-match/HT grids "0"/"1"/"2"/"3+", but the odds
      // line up exactly one bucket over vs peers (verified vs etoto/forbet/
      // betclic for Switzerland-Colombia: STS HT-corners "0"@2.05 == peers
      // "0-1"@2.04-2.08, "1"@3.5 == peers "2"@3.5-3.58, "2"@5.1 == peers
      // "3"@5.2-5.25, "3+"@5.1 == peers "4+"@5-5.25; a genuine exact-0 quote
      // is ~5+). The real STS buckets are the merged "0-1"/"2"/"3"/"4+"
      // scheme, so shift the labels to the correct catalog codes.
      const bucketShift: Record<string, string> = { "0": "0-1", "1": "2", "2": "3", "3+": "4+" };
      const shifted = bucketShift[trimmed];
      if (shifted) return shifted as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "HALF_TIME_HOME_EXACT_CARDS":
    case "HALF_TIME_AWAY_EXACT_CARDS":
      // STS sends "0","1","2","3+" as exact-count selections - pass through as-is
      // (card counts are NOT team sides, so no 1X2 fallback here)
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "CARDS_TOTAL":
    case "HALF_TIME_CARDS_TOTAL":
    case "FOULS_TOTAL":
    case "CARDS_TEAM":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalizeOverUnderSelection(trimmed);

    case "CARDS_EXACT_RANGE":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "HALF_TIME_CORNERS_TOTAL":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return normalizeOverUnderSelection(trimmed);

    case "HALF_TIME_CORNERS_TEAM":
    case "CORNERS_TEAM":
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      // Check market name to determine HOME or AWAY prefix
      if (marketName) {
        const mName = marketName.toLowerCase();
        const sel = normalizeOverUnderSelection(trimmed);
        if (sel === "OVER" || sel === "UNDER") {
          // "1. drużyna" = HOME team, "2. drużyna" = AWAY team
          if (mName.includes("1. drużyna") || mName.includes("1. dru") || mName.includes("gospodarz")) {
            return `HOME_${sel}` as NormalizedSelection;
          }
          if (mName.includes("2. drużyna") || mName.includes("2. dru") || mName.includes("gość") || mName.includes("gosc")) {
            return `AWAY_${sel}` as NormalizedSelection;
          }
        }
      }
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "HALF_TIME_HOME_TO_SCORE":
    case "HALF_TIME_AWAY_TO_SCORE":
    case "SECOND_HALF_HOME_TO_SCORE":
    case "SECOND_HALF_AWAY_TO_SCORE":
    case "CLEAN_SHEET":
    case "TEAM_SCORES_BOTH_HALVES":
    case "TEAM_WIN_AT_LEAST_ONE_HALF":
    case "TEAM_WIN_BOTH_HALVES":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_BOTH_HALVES":
    case "AWAY_WIN_BOTH_HALVES":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "RED_CARD":
    case "HALF_TIME_RED_CARD":
    case "PENALTY_AWARDED":
    case "RED_CARD_AND_PENALTY":
    case "OWN_GOAL":
    case "EACH_TEAM_TOTAL_CORNERS_OVER":
    case "EACH_TEAM_TOTAL_CARDS_OVER":
    // STS quotes this conditional market as a single 'Tak' outcome, not as
    // a player-name dropdown like the other *_LINEUP codes.
    case "PLAYER_CARDS_LINEUP":
      if ((marketCode === "EACH_TEAM_TOTAL_CORNERS_OVER" || marketCode === "EACH_TEAM_TOTAL_CARDS_OVER") && trimmed.startsWith("+")) return "OVER";
      return normalizeYesNoSelection(trimmed);

    case "PLAYER_RED_CARD":
      // STS shares this code between two differently-shaped raw markets:
      // id 2153 is per-player and quotes a single "Tak" outcome, while id
      // 1896 is the "Zawodnik - otrzyma czerwoną kartkę" dropdown whose
      // selections are player names. Branch on the market name shape so
      // the dropdown's player names don't get funneled into
      // normalizeYesNoSelection and come out UNKNOWN.
      if (marketName?.trim().toLowerCase().startsWith("zawodnik")) {
        return stsPlayerNameSelection(trimmed);
      }
      return normalizeYesNoSelection(trimmed);

    case "WIN_TO_NIL":
      if (marketName) {
        const mName = marketName.toLowerCase();
        if (mName.includes("gosp") || mName.includes("home") || mName.includes("1")) {
          if (lower === "tak" || lower === "yes") return "HOME" as NormalizedSelection;
        }
        if (mName.includes("gość") || mName.includes("gosc") || mName.includes("away") || mName.includes("2")) {
          if (lower === "tak" || lower === "yes") return "AWAY" as NormalizedSelection;
        }
      }
      return normalizeYesNoSelection(trimmed);

    case "TEAMS_TO_SCORE":
      if (lower.includes("tylko 1.") || lower.includes("tylko gosp") || lower.includes("only home")) return "ONE_TEAM_HOME" as NormalizedSelection;
      if (lower.includes("tylko 2.") || lower.includes("tylko goś") || lower.includes("only away")) return "ONE_TEAM_AWAY" as NormalizedSelection;
      if (lower.includes("obie") || lower.includes("both")) return "TWO_TEAMS" as NormalizedSelection;
      if (lower.includes("brak") || lower.includes("bez") || lower.includes("no goal")) return "ZERO_TEAMS" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "BOTH_HALVES_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
      // Binary YES/NO market: "Obie połowy poniżej/powyżej X goli?"
      // "Tak/Yes" = YES, "Nie/No" = NO
      return normalizeYesNoSelection(trimmed);

    case "BOTH_HALVES_GOALS":
      if (lower === "tak" || lower === "yes") return "YES";
      if (lower === "nie" || lower === "no") return "NO";
      if (lower === "remis" || lower === "równo") return "DRAW" as NormalizedSelection;
      if (lower.includes("1. połowa") || lower.includes("1 polowa")) return "FIRST_HALF" as NormalizedSelection;
      if (lower.includes("2. połowa") || lower.includes("2 polowa")) return "SECOND_HALF" as NormalizedSelection;
      if (lower === "bez goli" || lower === "brak goli") return "NONE" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    
    case "BTTS_BY_HALF":
      if (lower === "tak / nie" || lower === "tak/nie") return "1st" as NormalizedSelection;
      if (lower === "nie / tak" || lower === "nie/tak") return "2nd" as NormalizedSelection;
      if (lower === "tak / tak" || lower === "tak/tak") return "Both" as NormalizedSelection;
      if (lower === "nie / nie" || lower === "nie/nie") return "None" as NormalizedSelection;
      if (lower.includes("1. połowa") || lower.includes("1 polowa")) return "1st" as NormalizedSelection;
      if (lower.includes("2. połowa") || lower.includes("2 polowa")) return "2nd" as NormalizedSelection;
      if (lower.includes("obie") || lower.includes("both") || lower === "równo") return "Both" as NormalizedSelection;
      if (lower.includes("żadna") || lower.includes("zadna") || lower.includes("none") || lower.includes("bez goli") || lower.includes("brak goli")) return "None" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    
    case "HALF_WITH_MORE_GOALS":
    case "TEAM_HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
      if (lower.includes("1. połowa") || lower.includes("1 polowa")) return "1st" as NormalizedSelection;
      if (lower.includes("2. połowa") || lower.includes("2 polowa")) return "2nd" as NormalizedSelection;
      if (lower === "remis" || lower === "równo") return "Draw" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HOME_SCORE_BOTH_HALVES":
    case "AWAY_SCORE_BOTH_HALVES":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
    case "SECOND_HALF_ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
    case "CORNERS_ODD_EVEN":
    case "HALF_TIME_CORNERS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "ASIAN_HANDICAP_PUSH":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP_PUSH":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP_PUSH":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP":
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed)) return "DRAW";
      return normalizeSts1x2Selection(trimmed, ctx);

    case "CORRECT_SCORE": {
      // Handle "Inne" (STS) → "OTHER" for correct score markets
      if (lower === "inne" || lower === "inny" || lower === "other") {
        return "OTHER" as NormalizedSelection;
      }
      // STS's full-match correct-score grid returns raw score text in
      // away:home order: raw "0:1" carries the exact odds peers quote for
      // "1-0", raw "1:0" carries peers' "0-1" price, and so on across every
      // asymmetric cell - the opposite of every other bookmaker's home:away
      // convention. Swap the digits so the score lands on the right side.
      const swapMatch = trimmed.match(/^(\d+)\s*[:–-]\s*(\d+)$/);
      if (swapMatch) {
        return `${swapMatch[2]}-${swapMatch[1]}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      // Handle "Inne" (STS) → "OTHER" for correct score markets
      if (lower === "inne" || lower === "inny" || lower === "other") {
        return "OTHER" as NormalizedSelection;
      }
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HT_FT_CORRECT_SCORE":
      return trimmed as NormalizedSelection;

    case "MULTI_RESULT":
      return trimmed as NormalizedSelection;

    case "HALFTIME_FULLTIME_AND_TOTAL": {
      // Format: "<HT> / <FT> i <sign><line>"
      // e.g. "1 / X i -2.5" → HOME_DRAW_UNDER, "2 / 2 i +2.5" → AWAY_AWAY_OVER
      const htftMatch = trimmed.match(/^([1x2])\s*\/\s*([1x2])\s+i\s+([+-])/i);
      if (htftMatch) {
        const htToken = htftMatch[1].toUpperCase();
        const ftToken = htftMatch[2].toUpperCase();
        const sign = htftMatch[3];
        const htCode = htToken === "1" ? "HOME" : htToken === "X" ? "DRAW" : "AWAY";
        const ftCode = ftToken === "1" ? "HOME" : ftToken === "X" ? "DRAW" : "AWAY";
        // STS convention: "-" = UNDER, "+" = OVER
        const ouCode = sign === "-" ? "UNDER" : "OVER";
        return `${htCode}_${ftCode}_${ouCode}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "PLAYER_CARDS":
    case "GOALSCORER_ANYTIME":
    case "HALF_TIME_GOALSCORER_ANYTIME":
    // Audit /audit-match (Arsenal vs Coventry City): same "Zawodnik -
    // <event>" dropdown shape as the markets above (one raw market, 32-47
    // player-name selections in space-separated "Lastname Firstname" order).
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PLAYER_LEFT_FOOT_GOAL":
    case "PLAYER_RIGHT_FOOT_GOAL":
    case "PLAYER_GOAL_OUTSIDE_BOX":
      return stsPlayerNameSelection(trimmed);

    case "PLAYER_SHOTS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
    case "PLAYER_2_OR_MORE_GOALS":
    case "PLAYER_3_OR_MORE_GOALS":
    case "PLAYER_HAT_TRICK":
    case "PLAYER_TACKLES":
    case "PLAYER_INTERCEPTIONS":
    // Audit /audit-match (Arsenal vs Coventry City): these arrived with the
    // STS unconditional markets (ids 2394-2404) and the *_LINEUP split, and
    // without a branch here every threshold selection ("1+", "2+", …) fell
    // through to UNKNOWN — the markets rendered with prices but no outcome.
    case "PLAYER_HEADER_SHOTS_ON_TARGET":
    case "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX":
    case "PLAYER_SHOTS_LINEUP":
    case "PLAYER_SHOTS_ON_TARGET_LINEUP":
    case "PLAYER_ASSISTS_LINEUP":
    case "PLAYER_GOALS_LINEUP":
    case "PLAYER_PASSES_LINEUP":
    case "PLAYER_TACKLES_LINEUP":
      // Selection is a player name; canonicalize "Lastname, Firstname" forms
      // so selections group with peers that emit "Firstname Lastname"
      return canonicalizePlayerName(trimmed.replace(/^\d+\.\s*/, "").trim()) as NormalizedSelection;

    case "PLAYER_GOAL_AND_RESULT": {
      const match = trimmed.match(/^(.+?)\s+i\s+([1X2])$/i);
      if (match) {
        const result = match[2].toUpperCase();
        return (result === "1" ? "HOME" : result === "X" ? "DRAW" : "AWAY") as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "TEAM_TOTAL_SCORERS":
      if (/^\d+\+$/.test(trimmed)) return "OVER";
      if (/^\d+-$/.test(trimmed)) return "UNDER";
      return normalizeOverUnderSelection(trimmed);

    case "DOUBLE_CHANCE_BTTS":
    case "HALF_TIME_DOUBLE_CHANCE_BTTS":
    case "SECOND_HALF_DOUBLE_CHANCE_BTTS": {
      const lower = trimmed.toLowerCase();
      if (lower.includes("1x") && lower.includes("tak")) return "1X_YES" as NormalizedSelection;
      if (lower.includes("1x") && lower.includes("nie")) return "1X_NO" as NormalizedSelection;
      if (lower.includes("x2") && lower.includes("tak")) return "X2_YES" as NormalizedSelection;
      if (lower.includes("x2") && lower.includes("nie")) return "X2_NO" as NormalizedSelection;
      if (lower.includes("12") && lower.includes("tak")) return "12_YES" as NormalizedSelection;
      if (lower.includes("12") && lower.includes("nie")) return "12_NO" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "SECOND_HALF_RESULT_AND_TOTAL": {
      const match = trimmed.match(/^([1x2])\s*i\s*([+-])/i);
      if (match) {
        const result = match[1].toUpperCase();
        // STS convention: "+" = OVER, "-" = UNDER (same as RESULT_AND_TOTAL)
        const overUnder = match[2] === "+" ? "OVER" : "UNDER";
        if (result === "1") return `HOME_${overUnder}` as NormalizedSelection;
        if (result === "X") return `DRAW_${overUnder}` as NormalizedSelection;
        if (result === "2") return `AWAY_${overUnder}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "WINNING_MARGIN": {
      // Map Polish STS selection names to canonical codes
      // "1 o 1" = Gospodarz wygra różnicą 1 gola
      // "1 o 2" = Gospodarz wygra różnicą 2 goli
      // "1 o 3+" = Gospodarz wygra różnicą 3+ goli
      // "Remis" = Remis
      // "2 o 1" = Gość wygra różnicą 1 gola
      // "2 o 2" = Gość wygra różnicą 2 goli
      // "2 o 3+" = Gość wygra różnicą 3+ goli
      if (lower === "1 o 1" || lower.includes("1 o 1")) return "HOME_BY_1" as NormalizedSelection;
      if (lower === "1 o 2" || lower.includes("1 o 2")) return "HOME_BY_2" as NormalizedSelection;
      if (lower === "1 o 3+" || lower.includes("1 o 3+") || lower.includes("1 o 3 lub więcej")) return "HOME_BY_3PLUS" as NormalizedSelection;
      if (lower === "remis" || lower === "x") return "DRAW";
      if (lower === "2 o 1" || lower.includes("2 o 1")) return "AWAY_BY_1" as NormalizedSelection;
      if (lower === "2 o 2" || lower.includes("2 o 2")) return "AWAY_BY_2" as NormalizedSelection;
      if (lower === "2 o 3+" || lower.includes("2 o 3+") || lower.includes("2 o 3 lub więcej")) return "AWAY_BY_3PLUS" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "GOAL_RANGE":
    case "MULTI_GOAL_RANGE":
    case "TEAM_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "HALF_TIME_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS":
    case "SECOND_HALF_HOME_EXACT_GOALS":
      // Map numeric selections to proper codes: 0, 1, 2, 3+
      if (trimmed === "0" || trimmed === "0 goli") return "0" as NormalizedSelection;
      if (trimmed === "1" || trimmed === "1 gol") return "1" as NormalizedSelection;
      if (trimmed === "2" || trimmed === "2 gole") return "2" as NormalizedSelection;
      if (trimmed === "3" || trimmed === "3 gole") return "3" as NormalizedSelection;
      if (trimmed === "3+" || trimmed === "3 lub więcej") return "3+" as NormalizedSelection;
      if (trimmed === "4" || trimmed === "4 gole") return "4" as NormalizedSelection;
      if (trimmed === "5" || trimmed === "5 gole") return "5" as NormalizedSelection;
      if (trimmed === "6+" || trimmed === "6 lub więcej") return "6+" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
      // Pass through range selections like "0-1", "2-3", "4-5", "6+", "3+"
      if (/^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "CORNERS_RANGE": {
      // STS's full-match corners-range grid uses its own compressed bucket
      // text ("0-3"/"4-6"/"7+") for the exact same three-way market every
      // other bookmaker labels "0-8"/"9-11"/"12+" - the odds match peers'
      // buckets almost to the decimal (STS 2.25/2.7/3.25 == etoto's
      // 2.25/2.7/3.25 for 0-8/9-11/12+), confirming it's the same market
      // with different-but-corresponding labels. Remap to the canonical scheme.
      const cornersRangeShift: Record<string, string> = { "0-3": "0-8", "4-6": "9-11", "7+": "12+" };
      const shifted = cornersRangeShift[trimmed];
      if (shifted) return shifted as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "HALF_TIME_CORNERS_RANGE": {
      // Same STS bucket-label quirk as CORNERS_RANGE, but for the 1st-half
      // grid: STS's "0-2"/"3-4"/"5+" prices closely match peers'
      // "0-4"/"5-6"/"7+" (STS 1.72/3.2/4.4 vs betfan/superbet 1.76-1.77/3.3/4.3-4.55).
      const htCornersRangeShift: Record<string, string> = { "0-2": "0-4", "3-4": "5-6", "5+": "7+" };
      const shiftedHt = htCornersRangeShift[trimmed];
      if (shiftedHt) return shiftedHt as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "HOME_CORNERS_RANGE":
    case "AWAY_CORNERS_RANGE":
    case "PLAYER_GOALS":
    case "PLAYER_FOULS_WON":
    case "PLAYER_FOULS":
    case "PLAYER_SAVES":
    case "PLAYER_OFFSIDES":
      // Pass through numeric (0, 1, 2), range (0-2, 3-4), and plus (5+, 3+) selections
      if (/^\d+$/.test(trimmed) || /^\d+-\d+$/.test(trimmed) || /^\d+\+$/.test(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      const l = lower;
      if (l.includes("1") && l.includes("tak")) return "HOME_YES" as NormalizedSelection;
      if (l.includes("1") && l.includes("nie")) return "HOME_NO" as NormalizedSelection;
      if (l.includes("x") && l.includes("tak")) return "DRAW_YES" as NormalizedSelection;
      if (l.includes("x") && l.includes("nie")) return "DRAW_NO" as NormalizedSelection;
      if (l.includes("2") && l.includes("tak")) return "AWAY_YES" as NormalizedSelection;
      if (l.includes("2") && l.includes("nie")) return "AWAY_NO" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "TOTAL_GOALS_AND_BTTS": {
      const l = lower;
      const isOver = l.includes("+") || l.includes("over") || l.includes("powyżej") || l.includes("powyzej");
      const isUnder = l.includes("-") || l.includes("under") || l.includes("poniżej") || l.includes("ponizej");
      const isYes = l.includes("tak") || l.includes("yes");
      const isNo = l.includes("nie") || l.includes("no");

      if (isOver && isYes) return "OVER_YES" as NormalizedSelection;
      if (isUnder && isYes) return "UNDER_YES" as NormalizedSelection;
      if (isOver && isNo) return "OVER_NO" as NormalizedSelection;
      if (isUnder && isNo) return "UNDER_NO" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL": {
      const match = trimmed.match(/^([1x2])\s*i\s*([+-])/i);
      if (match) {
        const result = match[1].toUpperCase();
        const overUnder = match[2] === "+" ? "OVER" : "UNDER";
        if (result === "1") return `HOME_${overUnder}` as NormalizedSelection;
        if (result === "X") return `DRAW_${overUnder}` as NormalizedSelection;
        if (result === "2") return `AWAY_${overUnder}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "DOUBLE_CHANCE_TOTAL": {
      // Format: "<DC> i <sign><line>" — e.g. "1X i -1.5", "12 i +1.5", "X2 i -1.5"
      // STS convention: "-" = UNDER, "+" = OVER (same as RESULT_AND_TOTAL family)
      const dcMatch = trimmed.match(/^(1X|12|X2)\s+i\s+([+-])/i);
      if (dcMatch) {
        const dcToken = dcMatch[1].toUpperCase();
        const ouCode = dcMatch[2] === "+" ? "OVER" : "UNDER";
        return `${dcToken}_${ouCode}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT":
      if (lower === "bez gola" || lower === "brak gola") return "NONE" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "FIRST_GOAL_AND_RESULT": {
      // Map Polish STS selection names to canonical codes
      // "1 i 1" = Home scores first, Home wins
      // "1 i X" = Home scores first, Draw
      // "1 i 2" = Home scores first, Away wins
      // "2 i 1" = Away scores first, Home wins
      // "2 i X" = Away scores first, Draw
      // "2 i 2" = Away scores first, Away wins
      // "Bez gola" = No goal
      if (lower === "1 i 1") return "HOME_HOME" as NormalizedSelection;
      if (lower === "1 i x") return "HOME_DRAW" as NormalizedSelection;
      if (lower === "1 i 2") return "HOME_AWAY" as NormalizedSelection;
      if (lower === "2 i 1") return "AWAY_HOME" as NormalizedSelection;
      if (lower === "2 i x") return "AWAY_DRAW" as NormalizedSelection;
      if (lower === "2 i 2") return "AWAY_AWAY" as NormalizedSelection;
      if (lower === "bez gola") return "NONE" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "OTHER": {
      if (lower === "tak" || lower === "yes") return "YES";
      if (lower === "nie" || lower === "no") return "NO";
      return trimmed as NormalizedSelection;
    }

    default:
      return normalizeSts1x2Selection(trimmed, ctx);
  }
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const parameterizedMarkets = [
    "TOTAL_GOALS", "TOTAL_GOALS_ASIAN", "HALF_TIME_TOTAL_GOALS", "HALF_TIME_TOTAL_GOALS_ASIAN",
    "SECOND_HALF_TOTAL_GOALS", "SECOND_HALF_TOTAL_GOALS_ASIAN", "TEAM_TOTAL_GOALS", "ASIAN_HANDICAP", "ASIAN_HANDICAP_PUSH",
    "EUROPEAN_HANDICAP", "CORNERS_TOTAL", "CARDS_TOTAL", "HALF_TIME_CARDS_TOTAL", "CORNERS_HANDICAP",
    "RESULT_AND_TOTAL", "DOUBLE_CHANCE_TOTAL", "TOTAL_GOALS_AND_BTTS",
    "HALFTIME_FULLTIME_AND_TOTAL",
    "HALF_TIME_CORNERS_TOTAL", "HALF_TIME_CORNERS_TEAM", "SECOND_HALF_RESULT_AND_TOTAL",
    "HALF_TIME_GOAL_RANGE", "SECOND_HALF_GOAL_RANGE",
    "FIRST_HALF_ASIAN_HANDICAP", "FIRST_HALF_ASIAN_HANDICAP_PUSH", "FIRST_HALF_EUROPEAN_HANDICAP",
    "SECOND_HALF_ASIAN_HANDICAP", "SECOND_HALF_ASIAN_HANDICAP_PUSH", "SECOND_HALF_EUROPEAN_HANDICAP",
    "BOTH_HALVES_TOTAL_GOALS", "BOTH_HALVES_UNDER_GOALS", "BOTH_HALVES_OVER_GOALS", "HALF_TIME_TEAM_TOTAL_GOALS",
    "SECOND_HALF_TEAM_TOTAL_GOALS", "HALF_TIME_RESULT_AND_TOTAL",
    "TEAM_WIN_AT_LEAST_ONE_HALF", "TEAM_SCORES_BOTH_HALVES",
    "HOME_TEAM_TOTAL_GOALS", "AWAY_TEAM_TOTAL_GOALS",
    "HALF_TIME_HOME_TEAM_TOTAL_GOALS", "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
    "SECOND_HALF_HOME_TEAM_TOTAL_GOALS", "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
    "CARDS_TEAM",
    "CORNERS_TEAM",
    "HALF_TIME_CORNERS_HANDICAP",
    "PLAYER_GOAL_AND_RESULT",
    "EACH_TEAM_TOTAL_CORNERS_OVER",
    "EACH_TEAM_TOTAL_CARDS_OVER",
    "FIRST_GOAL_TIME",
    "TIME_PERIOD_RESULT",
  ];


  if (!parameterizedMarkets.includes(marketCode)) return undefined;

  // Extract interval type from raw market name (e.g., "1. gol - przedziały 15-minutowe" → "15min")
  if (marketCode === "FIRST_GOAL_TIME") {
    const intervalMatch = raw.name.match(/(\d+)-minutow/i);
    if (intervalMatch) return `${intervalMatch[1]}min`;
    // Fallback: infer from first selection
    const firstName = raw.selections[0]?.name;
    if (firstName?.match(/^\d+-15$/)) return "15min";
    if (firstName?.match(/^\d+-10$/)) return "10min";
    return "15min";
  }

  // STS names the window in the market title - "Wynik od 1. do 10. minuty" -
  // and the catalog keys this market by the closing minute.
  if (marketCode === "TIME_PERIOD_RESULT") {
    const windowMatch = raw.name.match(/do\s+(\d+)\.?\s*minut/i);
    if (windowMatch) return windowMatch[1];
  }

  if (marketCode === "EACH_TEAM_TOTAL_CORNERS_OVER" || marketCode === "EACH_TEAM_TOTAL_CARDS_OVER") {
    for (const sel of raw.selections) {
      const match = sel.name.match(/^\+(\d+(?:[.,]\d+)?)$/);
      if (match) {
        return match[1].replace(",", ".");
      }
    }
  }

  // Extract Corners Handicap value from selection names (e.g., "1 (-2.5)", "2 (+2.5)")
  // Format: "1 (+X)" or "1 (-X)" where X is the handicap value for HOME team
  if (marketCode === "CORNERS_HANDICAP" ||
      marketCode === "HALF_TIME_CORNERS_HANDICAP") {
    // Find HOME selection (starts with "1")
    const homeSelection = raw.selections.find(s => /^1\s*\(/.test(s.name));
    if (homeSelection) {
      const handicapMatch = homeSelection.name.match(/\(([+-]?\d+(?:[.,]\d+)?)\)/);
      if (handicapMatch) {
        // Normalize: replace comma with dot and ensure sign prefix
        let value = handicapMatch[1].replace(",", ".");
        // Ensure positive values have + prefix for consistency
        if (!value.startsWith("+") && !value.startsWith("-")) {
          value = `+${value}`;
        }
        return value;
      }
    }
  }

  // Extract the whole-number "z możliwym zwrotem" (push) line from selection
  // names (e.g., "+1", "-2") for TOTAL_GOALS / HALF_TIME_TOTAL_GOALS /
  // SECOND_HALF_TOTAL_GOALS. STS quotes this push line as its own market
  // (ids 23/80/110) instead of folding it into the ".5" over/under ladder,
  // but the line itself is the same TOTAL_GOALS family every other
  // bookmaker publishes - id23 param "1" prices identically to
  // betcris/etoto/fortuna/fuksiarz/lvbet's plain "Liczba goli 1" line - so
  // it must resolve to the same bare integer param ("1", not "1.0") those
  // peers use, or the row won't merge. Whole-.5 lines for these three codes
  // fall through unchanged to the generic parseOverUnderLine() below.
  if (
    marketCode === "TOTAL_GOALS" ||
    marketCode === "HALF_TIME_TOTAL_GOALS" ||
    marketCode === "SECOND_HALF_TOTAL_GOALS"
  ) {
    for (const sel of raw.selections) {
      const intMatch = sel.name.match(/^[+-](\d+)$/);
      if (intMatch) {
        return intMatch[1]; // Return integer without ".0"
      }
    }
    // No "+N"/"-N" selection found - this is a plain ".5" over/under line
    // (or an unrelated shape), not the whole-number push market. Do NOT
    // fall back to scanning raw.name for a trailing number here: these
    // codes are also fed by the plain TOTAL_GOALS family (ids 25/82/112),
    // whose raw market name can legitimately end in digits (e.g. the
    // scraper's "Rynek <id>" placeholder) without that number being a
    // push line. Let control fall through to parseOverUnderLine() below,
    // which reads the actual decimal line from the selection labels.
  }

  if (marketCode === "BOTH_HALVES_UNDER_GOALS") {
    const match = raw.name.match(/poniżej\s+(\d+[.,]\d+)/i);
    if (match) return match[1].replace(",", ".");
  }

  if (marketCode === "BOTH_HALVES_OVER_GOALS") {
    const match = raw.name.match(/powyżej\s+(\d+[.,]\d+)/i);
    if (match) return match[1].replace(",", ".");
  }

  if (marketCode === "TEAM_WIN_AT_LEAST_ONE_HALF" || marketCode === "TEAM_SCORES_BOTH_HALVES") {
    const lower = raw.name.toLowerCase();
    if (lower.includes("1. drużyna") || lower.includes("gospodarz")) return "HOME";
    if (lower.includes("2. drużyna") || lower.includes("gość") || lower.includes("gosc")) return "AWAY";
  }

  // Extract European Handicap value from selection names (e.g., "1 (0:1)", "X (0:2)")
  // STS uses virtual-score notation "(home:away)"; convert it to the signed
  // home-perspective value used by other bookmakers so lines group together
  // (e.g., "(1:0)" -> "+1", "(0:2)" -> "-2"). Verified against live odds:
  // STS "1 (1:0)" prices identically to peers' "+1" home line.
  if (marketCode === "EUROPEAN_HANDICAP" ||
      marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" ||
      marketCode === "SECOND_HALF_EUROPEAN_HANDICAP") {
    // Scan ALL selections (not only the first) - some lines carry the
    // "(h:a)" virtual score on a subset of selection labels only
    for (const sel of raw.selections) {
      const handicapMatch = sel.name?.match(/\((\d+):(\d+)\)/);
      if (handicapMatch) {
        const diff = Number(handicapMatch[1]) - Number(handicapMatch[2]);
        return diff > 0 ? `+${diff}` : String(diff);
      }
    }
    // Fallback: the scraper appends the raw virtual score to the market
    // name (e.g. "Handicap 1X2 0:1"). Convert every "h:a" suffix to the
    // signed home-perspective value so no line leaks a raw "0:N" param.
    const nameMatch = raw.name.match(/(\d+)\s*:\s*(\d+)\s*$/);
    if (nameMatch) {
      const diff = Number(nameMatch[1]) - Number(nameMatch[2]);
      return diff > 0 ? `+${diff}` : String(diff);
    }
  }

  // Asian handicap: emit the plain signed home-perspective value ("-2", "+1.5")
  // matching the canonical format used by other bookmakers, so identical lines
  // group into one column (a combined "-2/+2" string would fragment them).
  if (marketCode === "ASIAN_HANDICAP" ||
      marketCode === "ASIAN_HANDICAP_PUSH" ||
      marketCode === "FIRST_HALF_ASIAN_HANDICAP" ||
      marketCode === "FIRST_HALF_ASIAN_HANDICAP_PUSH" ||
      marketCode === "SECOND_HALF_ASIAN_HANDICAP" ||
      marketCode === "SECOND_HALF_ASIAN_HANDICAP_PUSH") {
    const homeSelection = raw.selections.find(s => /^1\s*\(/.test(s.name));
    if (homeSelection) {
      const homeMatch = homeSelection.name.match(/\(([+-]?\d+(?:[.,]\d+)?)\)/);
      if (homeMatch) {
        return ensureSign(homeMatch[1].replace(",", "."));
      }
    }
  }

  if (marketCode === "HALFTIME_FULLTIME_AND_TOTAL") {
    // Extract line value from first selection name, e.g. "1 / 1 i -2.5" or "1 / 1 i +2.5"
    for (const sel of raw.selections) {
      const lineMatch = sel.name.match(/i\s+[+-](\d+[.,]\d+)/i);
      if (lineMatch) {
        return lineMatch[1].replace(",", ".");
      }
    }
  }

  if (marketCode === "PLAYER_GOAL_AND_RESULT") {
    for (const sel of raw.selections) {
      const match = sel.name.match(/^(.+?)\s+i\s+[1X2]$/i);
      if (match) {
        // Param is a player name; canonicalize "Lastname, Firstname" forms
        return canonicalizePlayerName(match[1].trim());
      }
    }
  }

  const rawAny = raw as any;
  if (rawAny.lines && rawAny.lines[0]?.D) {
    return String(rawAny.lines[0].D);
  }

  const selectionNames = raw.selections.map((s) => s.name);
  return parseOverUnderLine(selectionNames);
}

export const stsNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "sts",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    let marketName = raw.name;
    let playerName: string | undefined;

    if (raw.name.includes("|")) {
      const parts = raw.name.split("|");
      marketName = parts[0];
      playerName = parts[1];
    }

    const rawId = raw.bookmakerMarketId;
    let stsId = rawId !== undefined && rawId !== null ? Number(rawId) : null;
    if (!Number.isFinite(stsId)) {
      stsId = extractStsMarketId(marketName);
    }

    if (stsId === 1845) {
      const suffix = ' - asysty (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 1850) {
      const suffix = ' - gole (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 1851 || stsId === 1263) {
      const suffixes = [
        ' - strzały (musi wyjść w "11", z dogrywką)',
        ' - liczba strzałów (musi wyjść w "11", z dogrywką)',
      ];
      for (const suffix of suffixes) {
        if (marketName.endsWith(suffix)) {
          playerName = marketName.replace(suffix, "").trim();
          break;
        }
      }
      if (!playerName && marketName.includes(" - strzały")) {
        playerName = marketName.split(" - strzały")[0].trim();
      }
      if (!playerName && marketName.includes(" - liczba strzałów")) {
        playerName = marketName.split(" - liczba strzałów")[0].trim();
      }
    }

    if (stsId === 1852 || stsId === 1264) {
      const suffixes = [
        ' - celne strzały (musi wyjść w "11", z dogrywką)',
        ' - liczba celnych strzałów (musi wyjść w "11", z dogrywką)',
      ];
      for (const suffix of suffixes) {
        if (marketName.endsWith(suffix)) {
          playerName = marketName.replace(suffix, "").trim();
          break;
        }
      }
      if (!playerName && marketName.includes(" - celne strzały")) {
        playerName = marketName.split(" - celne strzały")[0].trim();
      }
      if (!playerName && marketName.includes(" - liczba celnych strzałów")) {
        playerName = marketName.split(" - liczba celnych strzałów")[0].trim();
      }
    }

    if (stsId === 1853) {
      const suffix = ' - podania (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 1855) {
      const suffix = ' - otrzyma kartkę (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 1897) {
      const suffix = ' - odbiory (musi wyjść w "11", z dogrywką)';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      } else if (marketName.includes(" - odbiory")) {
        playerName = marketName.split(" - odbiory")[0].trim();
      }
    }

    // Generic per-player stat markets: "<Player> - <stat>" with no marker
    // suffix. Audit /audit-match (Arsenal vs Coventry City): STS's
    // UNCONDITIONAL player markets (ids 2394-2404, 42 players each) use this
    // plain shape, and without an extractor every one of them landed under a
    // single "base" parameter instead of one row per player. The optional
    // '(musi wyjść …)' tail is stripped too so the conditional ids that have
    // no dedicated block above (e.g. 1854 "odbiory") also resolve.
    if (!playerName) {
      const plain = marketName.match(
        /^(.+?)\s+-\s+(?:strza[łl]y|celne strza[łl]y(?:\s+(?:spoza pola karnego|g[łl]ow[aą]))?|asysty|gole|podania|odbiory|otrzyma kartk[eę])(?:\s*\(.*\))?$/iu,
      );
      if (plain && !/^zawodnik$/i.test(plain[1].trim())) {
        playerName = plain[1].trim();
      }
    }

    // id 2399 is the renumbered twin of the (currently absent) id 2004 -
    // same "X - faule wywalczone" market shape.
    if (stsId === 2004 || stsId === 2399) {
      const suffix = ' - faule wywalczone';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    // id 2398 is the renumbered twin of the (currently absent) id 2005 -
    // same "X - faule popełnione" market shape.
    if (stsId === 2005 || stsId === 2398) {
      const suffix = ' - faule popełnione';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 2006) {
      if (marketName.includes(" - przechwyty")) {
        playerName = marketName.split(" - przechwyty")[0].trim();
      }
    }

    // id 2401 is the renumbered twin of the (currently absent) id 2011 -
    // same "X - obronione strzały" market shape.
    if (stsId === 2011 || stsId === 2401) {
      const suffix = ' - obronione strzały';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    // id 2400: "X - spalone" (offsides) player-stat market.
    if (stsId === 2400) {
      const suffix = " - spalone";
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    if (stsId === 2153) {
      const suffix = ' - otrzyma czerwoną kartkę';
      if (marketName.endsWith(suffix)) {
        playerName = marketName.replace(suffix, "").trim();
      }
    }

    // Player-name params must be canonical ("Firstname Lastname") so player
    // markets group across bookmakers regardless of STS's "Lastname Firstname"
    // (no comma) raws - see stsCanonicalizePlayerName for the reorder logic.
    if (playerName) {
      playerName = stsCanonicalizePlayerName(playerName.trim());
    }

    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" = "id";

    if (stsId !== null) {
      marketCode = STS_MARKET_ID_TO_CODE[stsId] ?? null;
    }

    let nameParam: string | undefined;

    if (!marketCode) {
      matchedBy = "name";
      const nameResult = resolveMarketFromName(marketName);
      if (nameResult) {
        marketCode = nameResult.code;
        nameParam = nameResult.param;
      }
    }

    if (!marketCode) {
      console.warn(`[sts] Unknown market: "${raw.name}" (id: ${stsId ?? "none"})`);
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[sts] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = playerName ?? nameParam ?? extractParamValue(marketCode, raw);
    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx, marketName),
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
        rawId: stsId ?? undefined,
        matchedBy,
      },
    };
  },
};

function ensureSign(value: string): string {
  if (!value.startsWith("+") && !value.startsWith("-")) return `+${value}`;
  return value;
}

export default stsNormalizer;
