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
  parseOverUnderLine,
  normalize1x2Selection,
  normalizeDoubleChanceSelection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
  canonicalizePlayerName,
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
  // audit-match (Arsenal vs Coventry City): stake type 38 ("czas 1. gola")
  // quotes cumulative minute-cutoff pairs ("Od 1 do 17 min." / "Od 18 do 90
  // min.", ~39 rows sweeping the cutoff minute one-by-one), NOT the catalog's
  // fixed 10-minute-bucket vocabulary. Stake type 655 (below) is the genuine
  // 10-min-bucket market ("Od 1 do 10 min." ... "Od 81 do 90 min.", 9 rows)
  // and is the correct FIRST_GOAL_TIME source. Mapping 38 to FIRST_GOAL_TIME
  // too force-merged its ~39 incompatible cutoff-pair selections into the
  // same combination market as 655's 9 real buckets, producing 49 selection
  // entries for lebull vs ~10 for every other bookmaker — including several
  // (e.g. "1-17", "18-90") that don't even belong to the closed selection
  // set. No catalog code represents the cutoff-pair shape, so route it to
  // OTHER (dropped from user-facing output) instead of corrupting
  // FIRST_GOAL_TIME.
  38: "OTHER",
  // Combo stake types (sbteam.xyz feed): result/DC/BTTS crossed with a goal
  // line or BTTS leg. Selections are Polish phrases mapped per market code
  // in normalizeSelectionForMarket.
  134: "RESULT_AND_TOTAL",
  261946: "RESULT_AND_BTTS",
  270665: "DOUBLE_CHANCE_BTTS",
  332815: "DOUBLE_CHANCE_TOTAL",
  350010: "RESULT_OR_BTTS",
  274556: "DRAW_NO_BET",
  40390: "ONE_TEAM_TO_SCORE",
  // Stake type 748 ("kolejny gol:") bundles goal #1..#5 into one row (5 x
  // HOME/AWAY/NONE, descending). Pre-match the FIRST tranche IS the
  // first-goal market (verified: 75.8/17.5/6.8% vs sts 76.3/18.3/5.4% and 9
  // more books); tranches 2-5 have no catalog slot and would collide on the
  // same selection codes, so the leading triple is kept in normalizeMarket.
  748: "FIRST_TEAM_TO_SCORE",
  333649: "LAST_TEAM_TO_SCORE",
  618: "TOTAL_GOALS_3WAY",
  5699564: "DOUBLE_CHANCE_GOAL_RANGE",
  5774433: "TOTAL_GOALS_AND_BTTS",
  607: "HT_OR_FT_RESULT",
  68: "FIRST_GOAL_METHOD",
  682: "CORRECT_SCORE",
  // Stake type 40424 ("Multiwynik", groupName "Dokladny wynik") is NOT the
  // standard Multi Result market: audit /audit-match (Arsenal vs Coventry
  // City, and world-cup-2026 France vs Morocco fixture) confirms it is a
  // combo-builder product quoting 8-11 OVERLAPPING 3-score buckets (e.g.
  // "1:0, 2:0 lub 2:1" and "1:0, 2:0 lub 3:0" both include the 1:0 outcome)
  // that do not partition the scoreline space the way MULTI_RESULT's catalog
  // vocabulary does. Only one row happens to textually match a standard
  // MULTI_RESULT bucket; mapping the id there silently dropped the other
  // 7-10 combos and misrepresented lebull as offering a single-selection
  // Multi Result market. No catalog code models this overlapping shape, so
  // route it to OTHER (dropped) instead.
  40424: "OTHER",
  // 311019/311021/311022 are per-score instances of ONE product ("X:Y w
  // czasie meczu" - will this score occur at any point). They were mapped
  // to three separate one-off codes (SCORE_REACHED / SCORE_OCCURS_DURING_
  // MATCH / SCORE_TO_OCCUR), rendering three near-identically-labeled
  // Tak/Nie cards, while lvbet quotes the same product as one
  // SCORE_DURING_MATCH grid with per-score odds. Routed into that grid:
  // the score becomes the selection code and "Tak" carries the price (see
  // the selections transform below; the same YES-collapse convention as
  // RESULT_AND_GOAL_RANGE / MULTI_RESULT). Market-display audit, Arsenal
  // vs Coventry City.
  311019: "SCORE_DURING_MATCH",
  311021: "SCORE_DURING_MATCH",
  311022: "SCORE_DURING_MATCH",
  333182: "BTTS_BY_HALF",
  332816: "BTTS_AT_LEAST_ONE_HALF",
  262063: "BTTS_BOTH_HALVES",
  // 332818 ("Obie drużyny suma powyżej X") is routed by name + goal line in
  // resolveMarketCode — only the 0.5/1.5 lines have catalog counterparts
  // (BTTS / BTTS_2PLUS_GOALS), so a blanket id mapping would misroute other lines.
  // 332819 ("obie drużyny suma poniżej") is QUARANTINED to OTHER (audit
  // cluster #20, Arsenal vs Coventry City) — unlike 332818, this raw name
  // carries no goal threshold anywhere (name/groupName/selections all
  // number-free), so there is no line to parameterize BOTH_TEAMS_UNDER_GOALS
  // with; that catalog code has been retired. See market-catalog.ts's
  // numericId 1242 comment.
  332819: "OTHER",
  350077: "SECOND_HALF_RESULT_OR_BTTS",
  40414: "HOME_WIN_BOTH_HALVES",
  // 39504/39505 ("<Team> wygra co najmniej jedną połowę") are the team-A/
  // team-B variants on the sbteam.xyz feed. Routed primarily by the
  // name-pattern + team-side detection block in resolveMarketCode into the
  // side-specific codes every other bookmaker uses; these id entries are the
  // fallback when the raw name cannot be matched to a side. A previous
  // TEAM_WIN_AT_LEAST_ONE_HALF mapping for 39505 split lebull's rows across
  // two coding schemes (live audit, Arsenal vs Coventry City).
  39504: "HOME_WIN_AT_LEAST_ONE_HALF",
  39505: "AWAY_WIN_AT_LEAST_ONE_HALF",
  332821: "EACH_TEAM_WINS_ONE_HALF",
  // Ids 30/31 ("Gol w 1./2. połowie") are a plain Tak/Nie "will a goal be
  // scored in this half" market — exactly the 0.5 line of the Over/Under
  // per-half goals market (Over 0.5 == "yes, a goal happens"). Routing them
  // to the standalone HALF_TIME_GOAL/SECOND_HALF_GOAL codes produced a
  // second card duplicating the 0.5-line row every other bookmaker already
  // reports under HALF_TIME_TOTAL_GOALS/SECOND_HALF_TOTAL_GOALS (audit
  // cluster #10, market-display audit). Fold onto that fixed line instead —
  // see extractParamValue and normalizeSelectionForMarket below for the
  // Tak/Nie -> OVER/UNDER + fixed "0.5" param transform.
  30: "HALF_TIME_TOTAL_GOALS",
  31: "SECOND_HALF_TOTAL_GOALS",
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
  // audit-loop cluster #2 (winning-margin family): 650/651/652 are the SAME
  // "any team wins by exactly N goals" bet for N=1/2/3 (raw names all share
  // the "jakikolwiek zespół. Margines zwycięstwa: N" shape, one with the
  // extra word "dokładnie") — a previous round split them across three
  // near-duplicate catalog codes instead of one parameterized market. All
  // three now route to the single surviving WINNING_MARGIN_ANY_EXACT code;
  // extractParamValue's generic "integer" branch below already recovers the
  // margin (1/2/3) from the bare digit in raw.name.
  650: "WINNING_MARGIN_ANY_EXACT",
  651: "WINNING_MARGIN_ANY_EXACT",
  652: "WINNING_MARGIN_ANY_EXACT",
  // 543 ("<Team>: wygra różnicą 1 gola lub remis") is a team-specific Tak/Nie
  // bet routed by team side in resolveMarketCode (HOME_/AWAY_WIN_BY_1_OR_DRAW);
  // a blanket WIN_BY_1_OR_DRAW mapping expects HOME/AWAY selections and would
  // collapse Tak/Nie into a single UNKNOWN entry.
  677: "FIRST_GOAL_HALF",
  261964: "RACE_TO_GOALS",
  261965: "RACE_TO_GOALS",
  // 40497 ("łączna liczba minut goli"), 5685189/5685190 ("<Team> suma minut,
  // w których padnie gol"), 671 ("Łączna liczba minut remisowych") and
  // 670/672 ("<Team> liczba minut na prowadzeniu") are all routed to OTHER
  // by the name-pattern block in resolveMarketCode (see the comment there):
  // audit /audit-match (Arsenal vs Coventry City) found lebull's raw feed
  // never publishes a line for this market family, so TOTAL_GOAL_MINUTES /
  // TEAM_GOAL_MINUTES_SUM / DRAW_MINUTES_TOTAL / TEAM_MINUTES_LEADING would
  // otherwise render Over/Under buttons with no threshold to bet on.
  40497: "OTHER",
  5685189: "OTHER",
  5685190: "OTHER",
  671: "OTHER",
  421317: "HALF_TIME_AND_SECOND_HALF_RESULT",
  262275: "BOTH_HALVES_OVER_COMBO",
  // Round 9 /audit-match (Arsenal vs Coventry City): these ids ("suma
  // między X-Y min") are lebull's disjoint-segment goal-total family — the
  // SAME product shape as 270588/270825/270827 below, which were already
  // correctly split off to their own TIME_BAND_TOTAL_GOALS/
  // TIME_SEGMENT_TOTAL_GOALS/TIME_PERIOD_GOALS codes. Sharing the generic
  // TIME_PERIOD_TOTAL_GOALS code with fuksiarz's structurally different
  // cumulative-from-kickoff windows ("first N minutes, over threshold X.5")
  // mixed two incompatible bet shapes into one comparison column — a "15"
  // row (fuksiarz: goals in the first 15 minutes) sitting next to an
  // "11-20" row (lebull: goals scored strictly within that 10-minute slice)
  // isn't a real "same bet, different price" comparison. Consolidated onto
  // TIME_SEGMENT_TOTAL_GOALS so the disjoint-segment family stays together
  // under codes fuksiarz never uses, and TIME_PERIOD_TOTAL_GOALS becomes
  // fuksiarz's alone.
  //
  // audit-match (Arsenal vs Coventry City) round 2: TIME_BAND_TOTAL_GOALS
  // (270588) and TIME_PERIOD_GOALS (270827) turned out to be the exact same
  // "suma między X-Y min" product as TIME_SEGMENT_TOTAL_GOALS, just split
  // onto two extra one-off codes purely because those two ids had been
  // mapped independently — three near-identically-labeled cards ("Suma
  // goli w przedziale czasowym" / "Gole w przedziale czasowym" / "Gole w
  // przedziale minutowym") for what is a single bet family. lebull is the
  // sole emitter of all three catalog codes (grep verified), so it is safe
  // to fold both into TIME_SEGMENT_TOTAL_GOALS, which already carries the
  // other 9 ids of this family.
  270586: "TIME_SEGMENT_TOTAL_GOALS",
  268285: "TIME_PERIOD_RESULT",
  270587: "TIME_SEGMENT_TOTAL_GOALS",
  270588: "TIME_SEGMENT_TOTAL_GOALS",
  268287: "TIME_PERIOD_RESULT",
  270589: "TIME_SEGMENT_TOTAL_GOALS",
  270590: "TIME_SEGMENT_TOTAL_GOALS",
  268289: "TIME_PERIOD_RESULT",
  270591: "TIME_SEGMENT_TOTAL_GOALS",
  270618: "TIME_PERIOD_RESULT",
  175094: "TIME_PERIOD_RESULT",
  175095: "TIME_PERIOD_RESULT",
  // The 268284-268289 / 175092-175095 / 270618-270621 blocks are consecutive
  // ids of ONE family (period 1X2); only every other id was mapped, so half
  // the windows fell through to OTHER. Verified by the monotonic draw price
  // across windows (1-10=1.11 ... 1-80=4.75).
  268284: "TIME_PERIOD_RESULT",
  268286: "TIME_PERIOD_RESULT",
  268288: "TIME_PERIOD_RESULT",
  175092: "TIME_PERIOD_RESULT",
  270619: "TIME_PERIOD_RESULT",
  270621: "TIME_PERIOD_RESULT",
  270825: "TIME_SEGMENT_TOTAL_GOALS",
  270826: "TIME_SEGMENT_TOTAL_GOALS",
  270827: "TIME_SEGMENT_TOTAL_GOALS",
  270828: "TIME_SEGMENT_TOTAL_GOALS",
  270829: "TIME_SEGMENT_TOTAL_GOALS",
  270830: "TIME_SEGMENT_TOTAL_GOALS",
  270831: "TIME_SEGMENT_TOTAL_GOALS",
  270832: "TIME_SEGMENT_TOTAL_GOALS",
  270833: "TIME_SEGMENT_TOTAL_GOALS",
  // Team-scoped odd/even: verified against 6 peers (home EVEN 1.77-1.88 /
  // ODD 1.80-1.90, away EVEN 1.37-1.42 / ODD 2.57-2.82).
  2381: "HOME_TEAM_ODD_EVEN_GOALS",
  2382: "AWAY_TEAM_ODD_EVEN_GOALS",
  // Simple Tak/Nie propositions with existing catalog codes; verified
  // against peers (betcris "Gol samobójczy" 8.2/1.05, betcris/lvbet "Rzut
  // karny" ~3.15/1.30 — both closely matching lebull's own prices).
  39506: "OWN_GOAL",
  8: "PENALTY_AWARDED",
  310988: "HALF_TIME_PENALTY_AWARDED",
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
  // "Metoda zwycięstwa" quotes 9 selections mixing unqualified generic props
  // ("Wygra w regulaminowym czasie") with team-qualified ET/penalties outcomes
  // ("Wygra w dogrywce Francja"); only the latter map onto WIN_METHOD's
  // HOME_/AWAY_ + method codes (see normalizeSelectionForMarket).
  "metoda zwyciestwa": "WIN_METHOD",
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
  // Bare period-range names like "1-80 min" bundle a "still leading after
  // minute N" 1X2 leg with a double-chance leg into one raw entry. Route the
  // whole thing to TIME_PERIOD_RESULT: the HOME/DRAW/AWAY leg normalizes via
  // normalize1x2Selection, while the bundled 1X/12/X2 leg (no catalog slot on
  // this axis) resolves to UNKNOWN and is dropped via UNKNOWN_FILTERED_MARKETS.
  { pattern: /^\d+\s*[-–]\s*\d+\s*min\b/, code: "TIME_PERIOD_RESULT" },
  { pattern: /wygrana\s*do\s*zera/, code: "WIN_TO_NIL" },
  { pattern: /czyste\s*konto/, code: "CLEAN_SHEET" },
  { pattern: /pierwszy\s*strzelec/, code: "GOALSCORER_FIRST" },
  { pattern: /ostatni\s*strzelec/, code: "GOALSCORER_LAST" },
  { pattern: /strzelec/, code: "GOALSCORER_ANYTIME" },
];

/**
 * Extracts the time-period parameter. A genuine cumulative-from-kickoff
 * window ("wynik od 1. do 75. min", "16-30 min" meaning "since kickoff to
 * minute 30") resolves to the bare END minute (e.g. "30"), matching the
 * convention used by the betters normalizer so identical periods aggregate
 * together. A window whose start is NOT the kickoff minute (e.g. "76-90 min",
 * a standalone late-segment bet, or "od 46. do 60. min") is a different bet
 * shape than "still leading cumulatively at minute X" and must not collide
 * with a cumulative bucket sharing the same end minute — it is encoded as
 * "start-end" instead, mirroring the "q"-prefix guard fortuna uses for its
 * kwarta markets so the values never share a bucket by coincidence.
 */
function extractTimePeriodParam(name: string): string | undefined {
  const normalized = normalizeMarketName(name);

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

/**
 * Market codes with a closed selection vocabulary where selections that fail
 * to map (stray outcomes from other market families, unrepresentable combos)
 * must be dropped instead of surfacing as literal/UNKNOWN entries.
 */
const UNKNOWN_FILTERED_MARKETS = new Set<NormalizedMarketType>([
  "TIME_PERIOD_RESULT",
  "TIME_PERIOD_TOTAL_GOALS",
  "RESULT_AND_TOTAL",
  "RESULT_AND_BTTS",
  "DOUBLE_CHANCE_BTTS",
  "DOUBLE_CHANCE_TOTAL",
  "TOTAL_GOALS_AND_BTTS",
  "SECOND_HALF_RESULT_OR_BTTS",
  "RESULT_OR_BTTS",
  "HALF_TIME_AND_SECOND_HALF_RESULT",
  "DOUBLE_CHANCE_GOAL_RANGE",
  "HALFTIME_FULLTIME",
  "MULTI_RESULT",
  // audit-match (Arsenal vs Coventry City): each of lebull's per-range "Suma
  // goli: X-Y" Tak/Nie sub-markets is only kept when the range has a catalog
  // slot (see the GOAL_RANGE/MULTI_GOAL_RANGE/HOME_GOAL_RANGE/AWAY_GOAL_RANGE
  // handling below); uncataloged buckets (e.g. HOME_GOAL_RANGE's "3-4",
  // MULTI_GOAL_RANGE's "0-1") keep their generic Tak/Nie -> UNKNOWN mapping
  // and must be dropped here rather than surfaced as a bare "UNKNOWN"
  // selection with no catalog label.
  "GOAL_RANGE",
  "MULTI_GOAL_RANGE",
  "HOME_GOAL_RANGE",
  "AWAY_GOAL_RANGE",
  // Closed 1st/2nd/Draw vocabulary (market-catalog.ts): any unmapped label
  // (e.g. a future sbteam.xyz wording change) is noise, not a real leg.
  "HALF_WITH_MORE_GOALS",
  "HOME_HALF_WITH_MOST_GOALS",
  "AWAY_HALF_WITH_MOST_GOALS",
  // "Metoda zwycięstwa" mixes unqualified generic props with team-qualified
  // ET/penalties outcomes; unqualified ones cannot be resolved to a side and
  // must be dropped rather than colliding under literal UNKNOWN.
  "WIN_METHOD",
]);

/**
 * Resolves the match-result side of a combo-selection prefix: a team name or
 * "Remis"/"X" -> HOME/DRAW/AWAY; anything unresolvable -> UNKNOWN.
 */
function resolveResultSide(text: string, ctx: NormalizationContext): NormalizedSelection {
  const normalized = normalizeMarketName(text);
  if (/^remis/.test(normalized)) return "DRAW";
  return normalize1x2Selection(text, ctx.homeTeam, ctx.awayTeam, ctx.league);
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

  // The sbteam.xyz "half-comparison" bet ("1. < 2." / "1. = 2." / "1. > 2.",
  // comparing 1st-half vs 2nd-half goal counts) is quoted under inconsistent
  // API-provided names across fixtures (sometimes "Dokladny wynik", sometimes
  // a label containing "goli"/"bramek" that would otherwise be swallowed by
  // the generic total-goals routing further down). Detect it by its
  // distinctive 3-way selection shape before any name-based routing, so it
  // always reaches HALF_WITH_MORE_GOALS regardless of the label LeBull sends.
  if (
    raw.selections.length > 0 &&
    raw.selections.every((s) => /^1\.?\s*[<=>]\s*2\.?$/.test(s.name.trim()))
  ) {
    // LeBull quotes the same shape three times: match-wide ("połowa z
    // największym wynikiem") and once per team ("Arsenal. Połowa z wyższą sumą
    // goli"). Audit /audit-match (Arsenal vs Coventry City) found the Coventry
    // variant occupying the match-wide code (1st 5.35 / Draw 1.45 against a
    // consensus of ~3.0 / ~3.7) while the real match market was never mapped.
    // Route the team variants to their own codes.
    const teamPrefix = raw.name.match(/^(.+?)\.\s*po[łl]owa\s+z\s+wy[żz]sz/iu);
    if (teamPrefix) {
      const side = normalize1x2Selection(
        teamPrefix[1].trim(),
        ctx.homeTeam,
        ctx.awayTeam,
        ctx.league,
      );
      if (side === "HOME") {
        return { marketCode: "HOME_HALF_WITH_MOST_GOALS", matchedBy: "pattern" };
      }
      if (side === "AWAY") {
        return { marketCode: "AWAY_HALF_WITH_MOST_GOALS", matchedBy: "pattern" };
      }
    }
    return { marketCode: "HALF_WITH_MORE_GOALS", matchedBy: "pattern" };
  }

  // "<Team> liczba minut na prowadzeniu" (ids 670/672, and the un-team-scoped
  // siblings 40497/5685189/5685190/671 mapped below) previously routed to
  // TEAM_MINUTES_LEADING/TOTAL_GOAL_MINUTES/TEAM_GOAL_MINUTES_SUM/
  // DRAW_MINUTES_TOTAL with an OVER/UNDER selection but no line param at
  // all — the catalog declares hasParameter:false for every one of these
  // four codes, so there was never anywhere to put a threshold even if one
  // existed. Audit /audit-match (Arsenal vs Coventry City) checked lebull's
  // raw feed for a hidden line: selections are the bare pair "powyżej" /
  // "poniżej" with no number embedded in the market name, group name, or
  // selection labels, and no other field on the row (verified against the
  // golden fixture, ids 40497/670/671/672/5685189/5685190 — same shape for
  // every one of the 6 rows in this family). lebull genuinely never
  // publishes a line for this market family; rendering Over/Under buttons
  // with nothing to be over/under is an undecidable bet, not a labeling
  // nitpick, so route it to OTHER instead of fabricating a param.
  if (/liczba minut na prowadzeniu/i.test(normalizedName)) {
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  const direct = LEBULL_MARKET_NAME_TO_CODE[normalizedName];
  if (direct) {
    return { marketCode: direct, matchedBy: "name" };
  }

  // Per-combo exact-score propositions ("Dokładny wynik 1:0, 2:0 lub 3:0",
  // Tak/Nie quotes) belong to the aggregate MULTI_RESULT market when the
  // combo exists in the catalog; unknown combos are excluded to OTHER.
  // NOTE: "ł" survives normalizeMarketName (NFD does not decompose it).
  const multiComboMatch = normalizedName.match(/^dok[lł]adny\s+wynik\s+(.+)$/);
  if (multiComboMatch && /(\d+\s*:\s*\d+)|^(x|remis)$/.test(multiComboMatch[1].trim())) {
    const combo = raw.name
      .replace(/^dok[lł]adny\s+wynik\s+/i, "")
      .trim()
      .replace(/\s+/g, " ");
    const comboCode = /^(x|remis)$/i.test(combo) ? "X" : combo;
    const multiMeta = getMarketMetadata("MULTI_RESULT");
    if (multiMeta?.selections.includes(comboCode)) {
      return { marketCode: "MULTI_RESULT", matchedBy: "pattern" };
    }
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // "Zawodnik zostanie usunięty z boiska. <Team>" is a team-scoped red-card
  // market — route it to RED_CARD_TEAM, not the whole-match RED_CARD (its
  // narrower probability space would pollute best-odds there).
  const sentOffMatch = normalizedName.match(
    /^zawodnik\s+zostanie\s+usuniet\w*\s+z\s+boiska[.:]?\s+(.+)$/
  );
  if (sentOffMatch) {
    const sentOffSide = normalize1x2Selection(
      sentOffMatch[1],
      ctx.homeTeam,
      ctx.awayTeam,
      ctx.league
    );
    if (sentOffSide === "HOME" || sentOffSide === "AWAY") {
      return { marketCode: "RED_CARD_TEAM", matchedBy: "pattern", teamSide: sentOffSide };
    }
  }

  const home = ctx.homeTeam ? normalizeMarketName(ctx.homeTeam) : "";
  const away = ctx.awayTeam ? normalizeMarketName(ctx.awayTeam) : "";

  // Combo bets "team wins + goal range" (e.g. "Austria wygra i suma goli: 3-5",
  // or "Remis wygra i suma goli: 2-4" for the draw leg) are Tak/Nie markets.
  // When the side + range resolve to a RESULT_AND_GOAL_RANGE combination code
  // (added to the catalog in round 1, e.g. HOME_3-5/DRAW_2-4), route there —
  // the "Tak" price IS that combination. resolveResultSide (not the plain
  // 1x2 helper) is required here so the "Remis" draw leg resolves instead of
  // falling through as UNKNOWN. Unrepresentable variants stay out of
  // GOAL_RANGE/TOTAL_GOALS via OTHER.
  const winAndRangeMatch = raw.name.match(
    /^(.+?)\s+wygra\s+i\s+suma\s+goli[:\s]+(\d+)\s*[-–]\s*(\d+)/i
  );
  if (winAndRangeMatch) {
    const side = resolveResultSide(winAndRangeMatch[1], ctx);
    const combo = `${side}_${winAndRangeMatch[2]}-${winAndRangeMatch[3]}`;
    const rangeMeta = getMarketMetadata("RESULT_AND_GOAL_RANGE");
    if (
      (side === "HOME" || side === "DRAW" || side === "AWAY") &&
      rangeMeta?.selections.includes(combo)
    ) {
      return { marketCode: "RESULT_AND_GOAL_RANGE", matchedBy: "pattern" };
    }
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }
  if (/wygra\s*i\s*suma\s*goli/.test(normalizedName)) {
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // "Kolumbia strzeli pierwsza i suma goli ..." (first team to score + total
  // goals) — a Tak/Nie combo whose selections do not map onto the
  // TEAM_FIRST_GOAL_AND_TOTAL_GOALS combination codes; keep it out of
  // TOTAL_GOALS / TEAM_TOTAL_GOALS.
  if (/strzeli\s*pierwsz\w*\s*i\s*suma\s*goli/.test(normalizedName)) {
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // "połowa/mecz i suma goli" (HT-or-FT + total combo) — raw selections do not
  // map onto HALFTIME_FULLTIME_AND_TOTAL codes, so keep it out of TOTAL_GOALS.
  // NOTE: "ł" survives normalizeMarketName (NFD does not decompose it).
  if (/po[lł]owa\s*\/\s*mecz\s*i\s*suma/.test(normalizedName)) {
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

  // "<Team> wygra co najmniej jedną połowę" (stake types 39504/39505) —
  // resolve which side the named team plays and route to the side-specific
  // catalog codes used by every other bookmaker. Routing by id alone split
  // lebull's rows across two coding schemes (39504 landed in
  // HOME_WIN_AT_LEAST_ONE_HALF while 39505 landed in the team-parameterized
  // TEAM_WIN_AT_LEAST_ONE_HALF), fragmenting the comparison pools.
  const winEitherHalfMatch = raw.name.match(
    // NOTE: \S (not \w) after "jedn" — JS \w never matches "ą" in "jedną".
    /^(.+?)\s+wygra\s+(?:co\s+najmniej|przynajmniej)\s+jedn\S*\s+po[łl]ow/iu
  );
  if (winEitherHalfMatch) {
    const side = normalize1x2Selection(
      winEitherHalfMatch[1].trim(),
      ctx.homeTeam,
      ctx.awayTeam,
      ctx.league
    );
    if (side === "HOME") {
      return { marketCode: "HOME_WIN_AT_LEAST_ONE_HALF", matchedBy: "pattern" };
    }
    if (side === "AWAY") {
      return { marketCode: "AWAY_WIN_AT_LEAST_ONE_HALF", matchedBy: "pattern" };
    }
    // Unknown team name: fall through to the 39504/39505 id fallback below.
  }

  // "<Team>: wygra różnicą 1 gola lub remis" (stake type 543) — a team-specific
  // Tak/Nie bet; resolve which side the named team plays and route to the
  // matching one-sided catalog code (both exist since round 1). Never fall
  // back to the generic WIN_BY_1_OR_DRAW, whose HOME/AWAY selections cannot
  // represent Tak/Nie.
  const winBy1OrDrawMatch = raw.name.match(
    /^(.+?)[.:]?\s+wygra\s+r[óo][żz]nic[aą]?\s+1\s+gola\s+lub\s+remis/i
  );
  if (winBy1OrDrawMatch) {
    const side = normalize1x2Selection(winBy1OrDrawMatch[1], ctx.homeTeam, ctx.awayTeam, ctx.league);
    if (side === "HOME") return { marketCode: "HOME_WIN_BY_1_OR_DRAW", matchedBy: "pattern" };
    if (side === "AWAY") return { marketCode: "AWAY_WIN_BY_1_OR_DRAW", matchedBy: "pattern" };
    return { marketCode: "OTHER", matchedBy: "pattern" };
  }

  // Combo markets whose names may contain "suma goli" must be resolved before
  // the generic total-goals routing below swallows them.
  if (/wynik\s*meczu\s*i\s*suma/.test(normalizedName)) {
    return { marketCode: "RESULT_AND_TOTAL", matchedBy: "pattern" };
  }
  if (/podwojna\s*szansa\s*i\s*suma/.test(normalizedName)) {
    return { marketCode: "DOUBLE_CHANCE_TOTAL", matchedBy: "pattern" };
  }
  if (/obie\s*(druzyny\s*)?strzela\w*\s*i\s*suma/.test(normalizedName)) {
    return { marketCode: "TOTAL_GOALS_AND_BTTS", matchedBy: "pattern" };
  }

  // Team-scoped goal lines ("Arsenal: suma goli: 0-1") must resolve to the
  // per-team side BEFORE the range/total checks below, otherwise they land
  // in the match-level buckets and mix incomparable odds (verified: Coventry
  // "0-1" prices at 1.02 / 98% implied vs match "0-1" at 3.85 / 26% implied —
  // clearly different bets, not the same market).
  const rangeSide =
    home && normalizedName.includes(home)
      ? "HOME"
      : away && normalizedName.includes(away)
        ? "AWAY"
        : null;

  // GOAL_RANGE covers dash-ranges ("Suma goli: 3-5") and "N+" buckets
  // ("Suma goli: 7+") always; a bare number ("Suma goli: 0") is a range
  // bucket only when quoted Tak/Nie — quoted powyżej/poniżej it is instead a
  // whole-number Asian total line (see isBareIntegerAsianLine below), not a
  // goal-range bucket. Without the Tak/Nie guard "Suma goli 2" (an Asian
  // line, powyżej=1.23/poniżej=3.62) would be misrouted into GOAL_RANGE,
  // which has no over/under selection slot and drops the market entirely.
  const isDecimalGoalLine = /suma\s*goli[:\s]+\d+[.,]\d/i.test(normalizedName);
  const isGoalRangeLine =
    /suma\s*goli[:\s]+\d+\s*(?:[-–]\s*\d+|\+)\b/i.test(normalizedName) ||
    (/suma\s*goli[:\s]+\d+\b/i.test(normalizedName) &&
      raw.selections.length > 0 &&
      raw.selections.every((s) => /^(tak|nie)$/i.test(s.name.trim())));
  if (isGoalRangeLine && !isDecimalGoalLine) {
    if (rangeSide === "HOME") return { marketCode: "HOME_GOAL_RANGE", matchedBy: "pattern" };
    if (rangeSide === "AWAY") return { marketCode: "AWAY_GOAL_RANGE", matchedBy: "pattern" };
    // audit-match (Arsenal vs Coventry City): lebull's whole-match "Suma
    // goli: X-Y" lines are always separate, per-range, independent Tak/Nie
    // propositions (e.g. "0-1", "1-2", "2-3", "3-4", "4-5", "4-6" alongside
    // the wider "1-3"/"2-4"/"3-5"), never a single market quoting a disjoint,
    // exhaustive partition of the scoreline space. Those OVERLAPPING ranges
    // (total=2 satisfies both "1-2" and "2-3") are the same cumulative-ladder
    // shape MULTI_GOAL_RANGE was added for (etoto/forbet "Przedział goli" /
    // "Multi-gole"), not the disjoint-band GOAL_RANGE, whose COMBINATION
    // viewType implies mutual exclusivity these ranges do not have.
    return { marketCode: "MULTI_GOAL_RANGE", matchedBy: "pattern" };
  }

  // "Suma goli N" (no dash/plus, no team prefix) quoted powyżej/poniżej is a
  // whole-number Asian total line (verified: "Suma goli 3" 1.88/1.79 sits
  // exactly between the 2.5 line 1.55/2.25 and the 3.5 line 2.37/1.50) —
  // mirrors the "liczba goli N" handling just below.
  const isBareIntegerAsianLine =
    !isDecimalGoalLine && !isGoalRangeLine && !rangeSide &&
    /suma\s*goli[:\s]+\d+\b/i.test(normalizedName);
  if (isBareIntegerAsianLine) {
    return { marketCode: "TOTAL_GOALS_ASIAN", matchedBy: "pattern" };
  }

  if (/suma\s*goli/.test(normalizedName)) {
    if (rangeSide === "HOME" || rangeSide === "AWAY") {
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
  ctx: NormalizationContext,
  teamSide?: "HOME" | "AWAY"
): NormalizedSelection {
  const trimmed = selectionName.trim();
  const normalized = normalizeMarketName(trimmed);

  switch (marketCode) {
    case "TEAM_MINUTES_LEADING": {
      // Side comes from resolveMarketCode's name-based detection (see the
      // comment there); the raw selection itself is plain "powyżej"/"poniżej"
      // with no team info of its own.
      const ou = normalizeOverUnderSelection(trimmed);
      if (teamSide === "HOME") return ou === "OVER" ? "HOME_OVER" : ou === "UNDER" ? "HOME_UNDER" : "UNKNOWN";
      if (teamSide === "AWAY") return ou === "OVER" ? "AWAY_OVER" : ou === "UNDER" ? "AWAY_UNDER" : "UNKNOWN";
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
    case "RACE_TO_GOALS":
      // Catalog selections are HOME/AWAY/NONE(/BOTH); "Nikt" = nobody scores /
      // nobody reaches the goal target.
      if (/^(nikt|zaden|zadna|brak|bez\s*gola|brak\s*gola)$/.test(normalized)) return "NONE";
      if (/^ob(ie|a|ydwie)/.test(normalized)) return "BOTH" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS": {
      // Ids 30/31 ("Gol w 1./2. połowie") route through here too, with
      // Tak/Nie selections instead of Powyżej/Poniżej — see the id-map
      // comment above. Tak ("yes, a goal happens") == OVER the fixed 0.5
      // line; Nie == UNDER it.
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo === "YES") return "OVER";
      if (yesNo === "NO") return "UNDER";
      return normalizeOverUnderSelection(trimmed);
    }

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "TEAM_TOTAL_GOALS":
    case "CORNERS_TOTAL":
    case "CARDS_TOTAL":
    case "TIME_PERIOD_TOTAL_GOALS":
    case "TIME_BAND_TOTAL_GOALS":
    case "TIME_SEGMENT_TOTAL_GOALS":
    case "TIME_PERIOD_GOALS":
    case "TOTAL_GOAL_MINUTES":
    case "TEAM_GOAL_MINUTES_SUM":
    case "DRAW_MINUTES_TOTAL":
      return normalizeOverUnderSelection(trimmed);

    case "TOTAL_GOALS_3WAY":
      // Raw labels: "powyżej" / "Dokładnie" / "poniżej".
      if (/^dok[lł]adnie/.test(normalized)) return "EXACTLY" as NormalizedSelection;
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "BOTH_HALVES_GOALS":
    case "BTTS_2PLUS_GOALS":
    case "BTTS_AT_LEAST_ONE_HALF":
    case "BTTS_BOTH_HALVES":
    case "BOTH_HALVES_OVER_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_HALVES_OVER_COMBO":
    case "HOME_WIN_AT_LEAST_ONE_HALF":
    case "AWAY_WIN_AT_LEAST_ONE_HALF":
    case "HOME_WIN_BOTH_HALVES":
    case "EACH_TEAM_WINS_ONE_HALF":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "ONE_TEAM_TO_SCORE":
    case "SCORING_DRAW":
    case "DRAW_IN_AT_LEAST_ONE_HALF":
    case "BOTH_TEAMS_TO_LEAD":
    case "GOAL_IN_TIME_PERIOD":
    case "WINNING_MARGIN_ANY_EXACT":
    case "HOME_WIN_BY_1_OR_DRAW":
    case "AWAY_WIN_BY_1_OR_DRAW":
    case "RED_CARD":
    case "RED_CARD_TEAM":
    case "OWN_GOAL":
    case "PENALTY_AWARDED":
    case "HALF_TIME_PENALTY_AWARDED":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "BTTS_BY_HALF":
      // Raw labels are "Tak/Tak", "Tak/Nie", "Nie/Tak", "Nie/Nie"
      // (BTTS in 1st half / BTTS in 2nd half).
      if (/^tak\s*\/\s*tak$/i.test(trimmed)) return "Both" as NormalizedSelection;
      if (/^tak\s*\/\s*nie$/i.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^nie\s*\/\s*tak$/i.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^nie\s*\/\s*nie$/i.test(trimmed)) return "None" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
    case "HALF_WITH_MORE_GOALS":
      // Raw labels compare halves: "1. > 2." (1st half higher), "1. < 2.",
      // "1. = 2." — catalog selections are 1st/2nd/Draw. The per-team
      // variants ("Arsenal. Połowa z wyższą sumą goli", routed to
      // HOME_/AWAY_HALF_WITH_MOST_GOALS in resolveMarketCode) use the exact
      // same selection vocabulary as the match-wide market, so they share
      // this branch. Without it they fell through to the default 1x2
      // resolver, collapsed all three legs to UNKNOWN, and the grouper's
      // duplicate-type guard kept only the first quote.
      if (/^1\.?\s*>\s*2\.?$/.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^1\.?\s*<\s*2\.?$/.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^1\.?\s*=\s*2\.?$/.test(trimmed)) return "Draw" as NormalizedSelection;
      // "ł" survives normalizeMarketName (NFD does not decompose it).
      if (/1\.?\s*po[lł]ow/.test(normalized)) return "1st" as NormalizedSelection;
      if (/2\.?\s*po[lł]ow/.test(normalized)) return "2nd" as NormalizedSelection;
      if (/^(remis|rowno)/.test(normalized)) return "Draw" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE": {
      // Raw labels combine two half comparisons, e.g. "1.<2. lub 1.>2.",
      // "1st < 2nd or 1st = 2nd" — catalog: 1ST_OR_DRAW/1ST_OR_2ND/2ND_OR_DRAW.
      const hasFirst = /1\.?(?:st)?\s*>\s*2|2\.?(?:nd)?\s*<\s*1/.test(trimmed);
      const hasSecond = /1\.?(?:st)?\s*<\s*2|2\.?(?:nd)?\s*>\s*1/.test(trimmed);
      const hasDraw = /=/.test(trimmed);
      if (hasFirst && hasSecond) return "1ST_OR_2ND" as NormalizedSelection;
      if (hasFirst && hasDraw) return "1ST_OR_DRAW" as NormalizedSelection;
      if (hasSecond && hasDraw) return "2ND_OR_DRAW" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "FIRST_GOAL_HALF":
      // "W 1. Połowie" / "W 2. Połowie" / "Brak gola" — "ł" survives
      // normalizeMarketName (NFD does not decompose it), hence [lł].
      if (/1\.?\s*po[lł]ow/.test(normalized)) return "1ST_HALF" as NormalizedSelection;
      if (/2\.?\s*po[lł]ow/.test(normalized)) return "2ND_HALF" as NormalizedSelection;
      if (/brak|bez\s*gola|nikt/.test(normalized)) return "NONE";
      return trimmed as NormalizedSelection;

    case "WIN_METHOD": {
      // Raw labels: "Wygra w dogrywce <Team>" / "Wygra w rzutach karnych <Team>"
      // map onto HOME_/AWAY_EXTRA_TIME / HOME_/AWAY_PENALTIES. Unqualified
      // variants ("Wygra w regulaminowym czasie", "Wygra w dogrywce" with no
      // team) and the "karnych lub w czasie doliczonym" combo have no matching
      // catalog slot and fall through to UNKNOWN (dropped via
      // UNKNOWN_FILTERED_MARKETS) instead of guessing a side.
      const m = trimmed.match(/^wygra\s+w\s+(dogrywce|rzutach\s*karnych)\s+(.+)$/i);
      if (m) {
        const side = normalize1x2Selection(m[2], ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (side === "HOME" || side === "AWAY") {
          const method = /dogrywce/i.test(m[1]) ? "EXTRA_TIME" : "PENALTIES";
          return `${side}_${method}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

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
      if (htft) return htft as NormalizedSelection;
      // Team-name pairs ("Szwajcaria/Kolumbia", "X/Kolumbia") -> HOME_AWAY etc.
      const parts = trimmed.split("/");
      if (parts.length === 2) {
        const first = resolveResultSide(parts[0], ctx);
        const second = resolveResultSide(parts[1], ctx);
        if (first !== "UNKNOWN" && second !== "UNKNOWN") {
          return `${first}_${second}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "HALF_TIME_AND_SECOND_HALF_RESULT": {
      // "1. połowa Kolumbia + 2. połowa remis" (separator can also be "i" and
      // "2.połowa" may lack the space) -> AWAY_DRAW.
      const halves = trimmed.match(
        /^1[.\s]*po[lł]ow\w*\s+(.+?)\s*(?:\+|\bi\b)\s*2[.\s]*po[lł]ow\w*\s+(.+)$/i
      );
      if (halves) {
        const first = resolveResultSide(halves[1], ctx);
        const second = resolveResultSide(halves[2], ctx);
        if (first !== "UNKNOWN" && second !== "UNKNOWN") {
          return `${first}_${second}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "MULTI_RESULT":
      // Combo labels arrive pre-merged from the parser and equal the catalog
      // codes ("1:0, 2:0 lub 3:0", ..., "X"); Tak/Nie sub-market quotes are
      // rewritten in normalizeMarket instead.
      if (/^(x|remis)$/.test(normalized)) return "X" as NormalizedSelection;
      if (getMarketMetadata("MULTI_RESULT")?.selections.includes(trimmed)) {
        return trimmed as NormalizedSelection;
      }
      return "UNKNOWN";

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "PLAYER_SHOTS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
      // Strip a leading shirt-number prefix and unify "Lastname, Firstname"
      // to natural order so the same player merges across bookmakers.
      return canonicalizePlayerName(
        trimmed.replace(/^\d+\.\s*/, "")
      ) as NormalizedSelection;

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT":
      // "Od 1 do 10 min." -> "1-10", "Od 16 do 30 min." -> "16-30", etc.
      return normalizeGoalTimeRangeSelection(trimmed);

    case "FIRST_GOAL_METHOD":
      // LeBull quotes ("Gol głową", "Rzuty wolny", "Karny", "Gol z gry/bez
      // gola głową", "Gol samobójczy") — audit /audit-match (Arsenal vs
      // Coventry City) found none of these were mapped, so every entry fell
      // through the default 1x2 resolver to UNKNOWN and the whole bookmaker
      // was dropped from the market. Round 2: the catalog now declares an
      // OWN_GOAL slot for this market, so "Gol samobójczy" routes there
      // instead of staying UNKNOWN. LeBull's "Metoda 1. gola" (stake type
      // 68) offer has exactly 5 legs (open play, header, free kick, penalty,
      // own goal) and no "no goal scored" leg, so there is no NO_GOAL case
      // to add here.
      // "Gol z gry/bez gola głową" (open-play goal / not-a-header) also
      // contains the "głową" substring, so it must be checked before the
      // header pattern to avoid being misrouted to HEADER.
      if (/gol\s*z\s*gry/i.test(normalized)) return "OTHER" as NormalizedSelection;
      if (/samob[oó]jcz/i.test(normalized)) return "OWN_GOAL" as NormalizedSelection;
      if (/g[łl]ow[ąa]/i.test(normalized)) return "HEADER" as NormalizedSelection;
      if (/karny/i.test(normalized)) return "PENALTY" as NormalizedSelection;
      if (/wolny/i.test(normalized)) return "FREE_KICK" as NormalizedSelection;
      return "UNKNOWN";

    case "RESULT_AND_TOTAL": {
      // "Szwajcaria i powyżej" -> HOME_OVER, "Remis i poniżej" -> DRAW_UNDER.
      const m = trimmed.match(/^(.+?)\s+i\s+(powy[żz]ej|poni[żz]ej)/i);
      if (m) {
        const side = resolveResultSide(m[1], ctx);
        if (side === "HOME" || side === "DRAW" || side === "AWAY") {
          const ou = /^powy/i.test(normalizeMarketName(m[2])) ? "OVER" : "UNDER";
          return `${side}_${ou}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_OR_BTTS":
    case "RESULT_OR_BTTS": {
      // "<Team|Remis> i/lub obie strzelą" -> SIDE_YES;
      // "<Team|Remis> i/lub Przynajmniej jedna drużyna nie strzeli" -> SIDE_NO.
      const m = trimmed.match(/^(.+?)\s+(?:i|lub)\s+(obie\s+strzel|przynajmniej\s+jedna)/i);
      if (m) {
        const side = resolveResultSide(m[1], ctx);
        if (side === "HOME" || side === "DRAW" || side === "AWAY") {
          const yes = /^obie/i.test(m[2]);
          if (marketCode === "RESULT_OR_BTTS") {
            return `${side}_OR_BTTS_${yes ? "YES" : "NO"}` as NormalizedSelection;
          }
          return `${side}_${yes ? "YES" : "NO"}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_TOTAL": {
      // "1X i Obie strzelą" -> 1X_YES; "X2 i powyżej" -> X2_OVER, etc.
      const m = trimmed.match(/^(1x|12|x2)\s+i\s+(.+)$/i);
      if (m) {
        const dc = m[1].toUpperCase();
        const rest = normalizeMarketName(m[2]);
        if (rest.startsWith("obie")) return `${dc}_YES` as NormalizedSelection;
        if (rest.startsWith("przynajmniej")) return `${dc}_NO` as NormalizedSelection;
        if (rest.startsWith("powy")) return `${dc}_OVER` as NormalizedSelection;
        if (rest.startsWith("poni")) return `${dc}_UNDER` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "TOTAL_GOALS_AND_BTTS": {
      // "Obie strzelą i powyżej" -> OVER_YES; "Przynajmniej jedna drużyna nie
      // strzeli i poniżej" -> UNDER_NO.
      const m = trimmed.match(
        /^(obie\s+strzel\S*|przynajmniej\s+jedna.*?)\s+i\s+(powy[żz]ej|poni[żz]ej)/i
      );
      if (m) {
        const yes = normalizeMarketName(m[1]).startsWith("obie");
        const over = /^powy/i.test(normalizeMarketName(m[2]));
        return `${over ? "OVER" : "UNDER"}_${yes ? "YES" : "NO"}` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "DOUBLE_CHANCE_GOAL_RANGE": {
      // "1X i 1-2 gole" -> "1X_1-2"; combos without a catalog slot map to
      // UNKNOWN and are filtered out downstream.
      const m = trimmed.match(/^(1x|12|x2)\s+i\s+(\d+)\s*[-–]\s*(\d+)/i);
      if (m) {
        const code = `${m[1].toUpperCase()}_${m[2]}-${m[3]}`;
        if (getMarketMetadata("DOUBLE_CHANCE_GOAL_RANGE")?.selections.includes(code)) {
          return code as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "FIRST_GOAL_AND_RESULT":
      return trimmed as NormalizedSelection;

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext,
  teamSide?: "HOME" | "AWAY"
): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  // Time-period markets ("Wynik meczu w przedziale 16-30 min",
  // "suma między 81-90+ min.") use the END minute of the period as the
  // parameter, matching the betters convention, so identical windows
  // aggregate across bookmakers instead of colliding in the "base" bucket.
  if (marketCode === "TIME_PERIOD_RESULT" || marketCode === "TIME_PERIOD_TOTAL_GOALS") {
    return extractTimePeriodParam(raw.name);
  }

  // audit-match (Arsenal vs Coventry City) round 2, Finding C: disjoint-
  // segment goal markets ("suma między 1-15 min", "suma między 81-90+
  // min.") fell into the generic "integer" branch below, which grabs the
  // FIRST bare number in the name — the START minute only (e.g. "1"). That
  // (a) rendered a bare digit with no visible end-minute/range in the UI,
  // an ambiguous "Over/Under 1?" bet, and (b) silently collided two
  // DIFFERENT windows that happen to share a start minute: "suma między
  // 1-15 min" (the 6-way split, ids 270586-270591) and "suma między 1-10
  // min" (the 9-way split, ids 270825-270833) both landed on
  // TIME_SEGMENT_TOTAL_GOALS:1, so only whichever quote was processed last
  // survived. Keep the FULL "start-end"/"start-end+" range as the
  // parameter (mirrors the grouper's own extractParamFromRawName recovery
  // pattern for this exact code, market-type-grouper.ts) so every window
  // gets its own unique bucket and the label shows the whole range.
  if (marketCode === "TIME_SEGMENT_TOTAL_GOALS") {
    const rangeMatch = raw.name.match(/mi[eę]dzy\s+(\d+)\s*[-–]\s*(\d+\+?)\s*min/i);
    if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2]}`;
  }

  // "1. Połowa powyżej (1.5) i 2. połowa powyżej (0.5)" — BOTH_HALVES_OVER_COMBO
  // bundles TWO distinct goal-threshold lines (first-half line, second-half
  // line) into one raw market. Neither number alone identifies the bet, so
  // both must survive into the parameter (audit cluster #20, Arsenal vs
  // Coventry City) — "<firstHalfLine>/<secondHalfLine>" keeps a bookmaker
  // that later offers a second pair from colliding with this one.
  if (marketCode === "BOTH_HALVES_OVER_COMBO") {
    const pairMatch = raw.name.match(
      /1\.\s*po[łl]owa\s*powy[żz]ej\s*\(([\d.,]+)\)\s*i\s*2\.\s*po[łl]owa\s*powy[żz]ej\s*\(([\d.,]+)\)/i
    );
    if (pairMatch) return `${pairMatch[1].replace(",", ".")}/${pairMatch[2].replace(",", ".")}`;
    return undefined;
  }

  // Ids 30/31 ("Gol w 1./2. połowie") are the Tak/Nie goal-in-this-half
  // market folded onto HALF_TIME_TOTAL_GOALS/SECOND_HALF_TOTAL_GOALS (see
  // the id-map comment). The raw name/selections carry no numeric line at
  // all ("Tak"/"Nie"), so the generic decimal-parsing fallback below would
  // return undefined and strand the market in an unkeyed bucket — pin it to
  // the fixed "0.5" line it represents instead.
  if (
    (marketCode === "HALF_TIME_TOTAL_GOALS" || marketCode === "SECOND_HALF_TOTAL_GOALS") &&
    (String(raw.bookmakerMarketId) === "30" || String(raw.bookmakerMarketId) === "31")
  ) {
    return "0.5";
  }

  // 3-way handicap names contain a literal "3" ("Handicap 3-drogowy") that
  // parseHandicapLine would swallow as the line; strip the token first and
  // otherwise trust only an explicit parenthesized line in a selection name
  // (bare selections are side digits like "Handicap 1", not lines).
  if (marketCode === "EUROPEAN_HANDICAP") {
    const cleaned = raw.name.replace(/3[\s-]?drogow\w*/gi, "").replace(/europejsk\w*/gi, "");
    // A "(H:A)" starting-score pair (e.g. "Handicap 3-drogowy (0:3) null")
    // must be checked BEFORE the naive parseHandicapLine fallback below: that
    // fallback grabs the first bare number it finds, which for "(0:3)" is the
    // home-side "0" — misbucketing the whole market as pick'em (parameter
    // "0") instead of the true home-perspective line (home - away = "-3").
    const pairMatch = cleaned.match(/\(([+-]?\d+)\s*:\s*([+-]?\d+)\)/);
    if (pairMatch) {
      const diff = Number(pairMatch[1]) - Number(pairMatch[2]);
      return parseHandicapLine(String(diff));
    }
    const fromName = parseHandicapLine(cleaned);
    if (fromName) return fromName;
    for (const sel of raw.selections) {
      const m = sel.name.match(/\(([+-]?\d+(?:[.,]\d+)?)\)/);
      if (m) return parseHandicapLine(m[1]);
    }
    return undefined;
  }

  const selectionNames = raw.selections.map((s) => s.name);
  const groupName = raw.groupName ?? "";
  const marketName = raw.name;

  switch (metadata.parameterType) {
    // audit-match (Arsenal vs Coventry City): RED_CARD_TEAM declares
    // parameterType "team" (validParameters HOME/AWAY) but this switch had no
    // case for it, so paramValue fell through to the decimal branch and came
    // back undefined for "Zawodnik zostanie usunięty z boiska. <Team>" —
    // every team-scoped row collapsed into the same param-less "base"
    // bucket, stranding one team's price behind the other's instead of
    // keying them apart like the 4 other bookmakers' HOME/AWAY rows.
    // Prefer the side resolveMarketCode already resolved (it isolates just
    // the trailing team token, e.g. "Francja", before matching — required
    // for World Cup fixtures where ctx.homeTeam/awayTeam are the canonical
    // English names ("France") but lebull's raw text is Polish ("Francja"):
    // running normalize1x2Selection over the WHOLE sentence here instead
    // would feed matchToCanonical a multi-word sentence it cannot alias-
    // match, silently returning UNKNOWN). Only fall back to a fresh
    // whole-name match for markets that don't route through that block.
    case "team": {
      if (teamSide === "HOME" || teamSide === "AWAY") return teamSide;
      const side = normalize1x2Selection(marketName, ctx.homeTeam, ctx.awayTeam, ctx.league);
      return side === "HOME" || side === "AWAY" ? side : undefined;
    }

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
    const { marketCode, matchedBy, rawId, teamSide } = resolveMarketCode(raw, ctx);

    if (!isValidMarketCode(marketCode)) {
      console.error(`[lebull] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const marketMetadata = getMarketMetadata(marketCode);
    let marketName = marketMetadata?.labels.pl ?? raw.name;

    let paramValue = extractParamValue(marketCode, raw, ctx, teamSide);

    // audit cluster #24: "Obie połowy powyżej 0.5" (raw id 332813, bottom
    // rung of lebull's Over/Under ladder) is definitionally the same bet as
    // lebull's OWN separate "Gol w obu połowach" row (raw id 32, mapped to
    // BOTH_HALVES_GOALS above) — collapse onto that code so the grouper's
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
    // feed row — it would land in a meaningless "base" bucket and duplicate
    // entries already keyed by their window, so drop it entirely.
    if (
      (marketCode === "TIME_PERIOD_RESULT" || marketCode === "TIME_PERIOD_TOTAL_GOALS") &&
      paramValue === undefined
    ) {
      return null;
    }

    // A 3-way handicap without a resolvable line cannot be attributed to any
    // parameter bucket — merging several lines under one bogus value (the "3"
    // from "3-drogowy") corrupts best-odds, so drop the market entirely.
    if (marketCode === "EUROPEAN_HANDICAP" && paramValue === undefined) {
      return null;
    }

    // Audit r12: id 618 ("suma (3-drogowo)") bundles FIVE goal lines'
    // OVER/EXACTLY/UNDER triples into one 15-selection raw market with no
    // per-selection line label at all — worse than the handicap case above,
    // this can never be split, not even by paramValue. The catalog code has
    // hasParameter:false (built for a single fixed-threshold 3-way market),
    // so every one of the 5 bundled UNDER/OVER/EXACTLY values collides onto
    // the same selection code; whichever line's price the array-collapse
    // happens to keep last poisons best-odds with a number that belongs to a
    // different line (verified: lebull UNDER 12.6 here was line 0.5's price,
    // not paired with any bookmaker's matching-line OVER — an arbitrage-
    // shaped false BROKEN). Drop unconditionally; lebull's contribution to
    // this market cannot be made correct without the source page grouping
    // its own rows by line, which we do not have.
    if (marketCode === "TOTAL_GOALS_3WAY") {
      return null;
    }

    // Stake type 748 ("kolejny gol:") bundles 5 tranches (goal #1..#5) into
    // one row, 3 selections each (HOME/AWAY/NONE), descending. Only the
    // leading tranche is the FIRST_TEAM_TO_SCORE market; tranches 2-5 have no
    // catalog slot of their own and would otherwise collide on the same
    // HOME/AWAY/NONE codes as the first, corrupting the market's odds.
    const effectiveRawSelections =
      marketCode === "FIRST_TEAM_TO_SCORE" &&
      String(raw.bookmakerMarketId) === "748" &&
      raw.selections.length > 3
        ? raw.selections.slice(0, 3)
        : raw.selections;

    let selections = effectiveRawSelections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode, ctx, teamSide),
      label: sel.name,
      odds: sel.odds,
    }));

    // audit-match (Arsenal vs Coventry City): lebull's HT/FT combo grid
    // occasionally quotes the same combo twice under differently-worded
    // labels (the "+" vs "i" connector) with materially different odds —
    // e.g. "1. połowa Coventry City + 2. połowa remis" (6.1) and "1. połowa
    // Coventry City i 2.połowa remis" (29) both resolve to AWAY_DRAW, while
    // DRAW_DRAW is missing from the same 9-row grid, consistent with a
    // mistyped label on lebull's own page rather than two genuine quotes.
    // Downstream de-dup keeps only the first-seen quote per code, silently
    // discarding the other with no signal that anything was dropped, and
    // there is no way to tell which of the two odds (if either) is the real
    // one. Rather than surface an unverifiable price as if authoritative,
    // drop every code that shows disagreeing odds within this single raw
    // market row.
    if (marketCode === "HALF_TIME_AND_SECOND_HALF_RESULT") {
      const oddsByCode = new Map<string, Set<number>>();
      for (const sel of selections) {
        if (!oddsByCode.has(sel.code)) oddsByCode.set(sel.code, new Set());
        oddsByCode.get(sel.code)!.add(sel.odds);
      }
      const ambiguousCodes = new Set(
        [...oddsByCode.entries()].filter(([, odds]) => odds.size > 1).map(([code]) => code)
      );
      if (ambiguousCodes.size > 0) {
        selections = selections.filter((sel) => !ambiguousCodes.has(sel.code));
      }
    }

    // "Suma goli: 3-5" (or the bare "Suma goli: 0" / "Suma goli: 7+" buckets,
    // or the team-scoped "Arsenal: suma goli: 0-1") is quoted as Tak/Nie:
    // "Tak" IS the range-band price (catalog code "3-5" / "0" / "7+"); "Nie"
    // has no negation slot in the mutually exclusive GOAL_RANGE /
    // MULTI_GOAL_RANGE / HOME_GOAL_RANGE / AWAY_GOAL_RANGE catalogs and must
    // be dropped, not left UNKNOWN.
    if (
      marketCode === "GOAL_RANGE" ||
      marketCode === "MULTI_GOAL_RANGE" ||
      marketCode === "HOME_GOAL_RANGE" ||
      marketCode === "AWAY_GOAL_RANGE"
    ) {
      const normalizedRawName = normalizeMarketName(raw.name);
      const dashMatch = normalizedRawName.match(/suma\s*goli[:\s]+(\d+)\s*[-–]\s*(\d+)/);
      const plusMatch =
        !dashMatch && normalizedRawName.match(/suma\s*goli[:\s]+(\d+)\s*\+/);
      const singleMatch =
        !dashMatch &&
        !plusMatch &&
        normalizedRawName.match(/suma\s*goli[:\s]+(\d+)\b(?!\s*[.,]\s*\d)/);
      const rangeCode = dashMatch
        ? (`${dashMatch[1]}-${dashMatch[2]}` as NormalizedSelection)
        : plusMatch
          ? (`${plusMatch[1]}+` as NormalizedSelection)
          : singleMatch
            ? (singleMatch[1] as NormalizedSelection)
            : undefined;
      // NOTE: HOME_GOAL_RANGE/AWAY_GOAL_RANGE catalog entries do not (yet)
      // list "3-4" as a valid selection (lebull publishes it, e.g. id 283
      // "Arsenal: suma goli: 3-4"), and MULTI_GOAL_RANGE does not (yet) list
      // "0-1" (lebull's bottom rung, id 275 "Suma goli: 0-1") — until the
      // catalog is extended, such rows fall through the includes() guard
      // below and keep their generic Tak/Nie -> UNKNOWN mapping, which
      // UNKNOWN_FILTERED_MARKETS then drops rather than silently mis-tagging
      // or leaking a bare "UNKNOWN" selection to users.
      if (rangeCode && getMarketMetadata(marketCode)?.selections.includes(rangeCode)) {
        selections = raw.selections
          .filter((sel) => normalizeYesNoSelection(sel.name) === "YES")
          .map((sel) => ({ code: rangeCode, label: sel.name, odds: sel.odds }));
      }
    }

    // "<Team|Remis> wygra i suma goli: X-Y" (Tak/Nie): "Tak" corresponds to
    // the catalog's SIDE_X-Y combination code (superbet convention), where
    // SIDE can be DRAW ("Remis") too; "Nie" has no negation slot and must be
    // dropped.
    if (marketCode === "RESULT_AND_GOAL_RANGE") {
      const comboMatch = raw.name.match(
        /^(.+?)\s+wygra\s+i\s+suma\s+goli[:\s]+(\d+)\s*[-–]\s*(\d+)/i
      );
      if (comboMatch) {
        const side = resolveResultSide(comboMatch[1], ctx);
        const comboCode = `${side}_${comboMatch[2]}-${comboMatch[3]}` as NormalizedSelection;
        selections = raw.selections
          .filter((sel) => normalizeYesNoSelection(sel.name) === "YES")
          .map((sel) => ({ code: comboCode, label: sel.name, odds: sel.odds }));
      }
    }

    // Per-score "X:Y w czasie meczu" instances (ids 311019/311021/311022,
    // see LEBULL_MARKET_ID_TO_CODE above) are quoted as Tak/Nie: "Tak" IS
    // the score's price for the shared SCORE_DURING_MATCH grid (lvbet's
    // code for the identical product); "Nie" has no negation slot in the
    // grid and is dropped, same convention as RESULT_AND_GOAL_RANGE /
    // MULTI_RESULT above.
    if (marketCode === "SCORE_DURING_MATCH") {
      const scoreMatch = raw.name.match(/^(\d+)\s*[:–\-]\s*(\d+)\s+w\s+czasie\s+meczu/i);
      const scoreCode = scoreMatch ? parseScoreSelection(`${scoreMatch[1]}:${scoreMatch[2]}`) : null;
      if (scoreCode) {
        selections = raw.selections
          .filter((sel) => normalizeYesNoSelection(sel.name) === "YES")
          .map((sel) => ({ code: scoreCode as NormalizedSelection, label: sel.name, odds: sel.odds }));
      }
    }

    // Per-combo "Dokładny wynik 1:0, 2:0 lub 3:0" sub-markets are quoted as
    // Tak/Nie: "Tak" IS the combo's price (the catalog code equals the combo
    // text); "Nie" has no slot in the mutually exclusive catalog and is dropped.
    if (marketCode === "MULTI_RESULT") {
      const comboMatch = raw.name.match(/^dok[lł]adny\s+wynik\s+(.+)$/i);
      if (comboMatch) {
        const comboRaw = comboMatch[1].trim().replace(/\s+/g, " ");
        const combo = /^(x|remis)$/i.test(comboRaw) ? "X" : comboRaw;
        if (getMarketMetadata("MULTI_RESULT")?.selections.includes(combo)) {
          selections = raw.selections
            .filter((sel) => normalizeYesNoSelection(sel.name) === "YES")
            .map((sel) => ({
              code: combo as NormalizedSelection,
              label: sel.name,
              odds: sel.odds,
            }));
        }
      }
    }

    // Stake type 40424 ("Multiwynik") is a combo-builder product routed to
    // OTHER (see LEBULL_MARKET_ID_TO_CODE): each of its 8-11 selections is a
    // genuinely distinct "either of these 3 exact scores" bet (e.g. "1:0,
    // 2:0 lub 2:1" vs "1:0, 2:0 lub 3:0"), but the default OTHER resolver
    // (normalize1x2Selection, via the switch's default case) cannot parse
    // score-triple text and collapses every combo onto the shared "UNKNOWN"
    // code. Selections sharing one code collide when the repository merges
    // same-code rows (mergeMarketRecord keeps only the first-seen odds), so
    // 7 of the 8 combos were silently lost, leaving only 1 surviving per
    // scrape. OTHER has no fixed catalog vocabulary (selections: []), so
    // derive a deterministic per-combo code straight from the raw
    // score-triple text instead (e.g. "1:0, 2:0 lub 2:1" -> "1-0_2-0_2-1"):
    // stable across scrapes (identical raw text always yields the same code,
    // so re-scrapes update rather than duplicate) and distinct across all 8
    // combos in this match's offer.
    if (marketCode === "OTHER" && String(raw.bookmakerMarketId) === "40424") {
      selections = raw.selections.map((sel) => {
        const scores = sel.name.match(/\d+\s*:\s*\d+/g);
        const code = scores?.length
          ? scores.map((s) => s.replace(/\s*:\s*/, "-")).join("_")
          : "UNKNOWN";
        return { code: code as NormalizedSelection, label: sel.name, odds: sel.odds };
      });
    }

    // Markets whose catalog vocabulary is closed (time-period 1X2/totals and
    // the combo grids mapped above) must not surface unmappable raw labels:
    // a stray outcome from another market family or an unrepresentable combo
    // is noise that would collapse into a meaningless UNKNOWN entry.
    if (UNKNOWN_FILTERED_MARKETS.has(marketCode)) {
      selections = selections.filter((sel) => sel.code !== "UNKNOWN");
    }

    if (selections.length === 0) {
      return null;
    }

    if (marketCode === "OTHER") {
      console.warn(`[lebull] Unmapped market "${raw.name}" (id: ${rawId ?? "none"})`);
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

export default lebullNormalizer;
