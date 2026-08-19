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
  canonicalizePlayerName,
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
  // Audit r4 (France vs Morocco): id 13 delivered match-level selections
  // ("Francja"/"remis"), the same non-goalscorer shape already found for id
  // 12 — real identity unknown, park in OTHER so it cannot poison
  // GOALSCORER_LAST with team names.
  "13": "OTHER",
  "14": "GOALSCORER_ANYTIME",
  "17": "TOTAL_GOALS",
  // Audit r6 (France vs Morocco, audit-loop v2 round 1): id 18 ("Liczba goli
  // 1. polowa X.5", group "Pierwsza polowa") emits the SAME HALF_TIME_TOTAL_
  // GOALS param lines (0.5/1.5/2.5/3.5) as ids 62/63/64, but its OVER/UNDER
  // odds are wrong on every line (e.g. 0.5: OVER 1.13/UNDER 4.91 vs id 62's
  // OVER 1.43/UNDER 2.55, which matches the cross-bookmaker peer median
  // ~1.46/~2.60 almost exactly). Id 18's numbers instead track the FULL-MATCH
  // total-goals market (id 17) shifted one line up (id 18's 2.5 UNDER 1.30 ==
  // id 17's 3.5 UNDER 1.3 exactly; id 18's 3.5 OVER/UNDER 6.38/1.07 nearly
  // equal id 17's 4.5 6.57/1.09) — a scraper-side table mix-up, not a genuine
  // half-time price. Park in OTHER; ids 62/63/64 remain the trusted source
  // (0.5/1.5 lines only — 2.5/3.5 have no other verified source and are lost).
  "18": "OTHER",
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
  // Audit r3 (Switzerland vs Colombia): id 29 delivered YES 3.14 / NO 1.28
  // while every HALF_TIME_BTTS peer sits at YES ~5.2-6.5 / NO ~1.1 — a
  // different BTTS scope (likely 2nd-half or full-match variant); identity
  // unverified, park in OTHER (id 69 remains the HT BTTS route).
  "29": "OTHER",
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
  // Audit r3: id 34 selections are "<ponad|poniżej> X.Y & <tak|nie>" — an
  // Over/Under + BTTS combo matching the catalog's TOTAL_GOALS_AND_BTTS
  // (OVER_YES/UNDER_YES/OVER_NO/UNDER_NO with a decimal line).
  "34": "TOTAL_GOALS_AND_BTTS",
  // Audit r2 (both matches): id 35 selections are "<team|remis> & <ponad|
  // poniżej> 4.5" — a Match Result + Total Goals combo, not goal ranges.
  "35": "RESULT_AND_TOTAL",
  "36": "EXACT_GOALS",
  "37": "HOME_EXACT_GOALS",
  "38": "AWAY_EXACT_GOALS",
  "39": "RESULT_AND_BTTS",
  // Audit r3: id 40 surfaced in RESULT_AND_TOTAL at bogus param "0" with a
  // single UNKNOWN selection — the RESULT_AND_TOTAL shape was never verified
  // for this id; park in OTHER (ids 35/73/502 carry the verified combos).
  "40": "OTHER",
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
  // Audit /audit-match (Arsenal vs Coventry City): id 55 carries
  // "1. Połowa - 1x2" — the first-half result, not the match winner.
  "55": "HALF_TIME_RESULT",
  "57": "HALF_TIME_FIRST_GOAL",
  "62": "HALF_TIME_TOTAL_GOALS",
  // Audit /audit-match (Arsenal vs Coventry City): the bookmaker also serves a
  // NAMED "1. Połowa - Suma" market (0.5 -> ponad 1.23 / poniżej 3.63) that
  // matches every peer. The unnamed ids 63/64 duplicate those lines with
  // different numbers and id 64 is outright inverted (0.5 -> ponad 3.83 /
  // poniżej 1.19, identical to id 70's tak/nie pair), so they are not the
  // first-half total. Park them and let the named market win via
  // matchMarketByName().
  "63": "OTHER",
  "64": "OTHER",
  "69": "HALF_TIME_BTTS",
  "72": "RESULT_AND_BTTS",
  // Audit r6 (France vs Morocco, audit-loop v2 round 1): id 73 ("Rynek 73")
  // collides with id 35's RESULT_AND_TOTAL data at the SAME param (1.5) with
  // materially different odds (HOME_OVER 4.23 vs id 35's 1.85; HOME_UNDER
  // 3.29 vs id 35's 6.29). Id 35's values match the cross-bookmaker peer
  // median almost exactly (~1.88/~6.0), confirming id 35 is correct and id 73
  // is a mismatched duplicate feeding corrupted odds into the same bucket —
  // park id 73 in OTHER; id 35 remains the trusted RESULT_AND_TOTAL source.
  "73": "OTHER",
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
  // Audit r3: id 90 odds are a uniformly scaled-down, capped-at-2-2 copy of
  // forbet/fortuna's confirmed 2nd-half correct-score pattern (0-0 @2.95,
  // "inny" @13.3) — a half-scoped market, not the full-match CORRECT_SCORE.
  "90": "SECOND_HALF_CORRECT_SCORE",
  "91": "FIRST_GOAL_TIME_ALT",
  "92": "FIRST_GOAL_TIME",
  "126": "MATCH_WINNER",
  // Audit r3: id 127 odds (HOME 1.89 / AWAY 1.85 / NONE 17.68) contradict the
  // full-match first-team-to-score shape (peers: clear HOME/AWAY split, NONE
  // ~8) — identity unverified, park in OTHER; the "1. gol" name override
  // remains the trusted FIRST_TEAM_TO_SCORE route.
  "127": "OTHER",
  "128": "TOTAL_SHOTS",
  "129": "OTHER",
  "133": "GOAL_RANGE",
  "134": "GOAL_RANGE",
  // Audit r3: id 139 delivered DRAW 1.97 / AWAY 3.14 with peers at DRAW
  // ~3.0-3.2 / AWAY ~2.2-2.4 — the values sit on the wrong selections, same
  // untrustworthy pattern as ids 76/163; park in OTHER (id 1 is the real 1X2).
  "139": "OTHER",
  "141": "OTHER",
  "142": "OTHER",
  "147": "HALF_TIME_HOME_EXACT_CARDS",
  // Audit /audit-match (premier-league Arsenal vs Coventry City, 2026-08-19):
  // ground truth from the bookmaker page shows the real 1X2 market (id 1,
  // API name "1x2") at 1.16 / 6.77 / 14.48, in line with all 11 peers, while
  // id 152 delivers 1.07 / 11.79 / 7.57 — a different market that overwrote
  // the genuine 1X2 row. Same untrustworthy pattern as ids 139/163.
  "152": "OTHER",
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
  // Audit r4 (France vs Morocco + 3 other fixtures cross-checked in the same
  // run): id 501 selections are consistently "<team|remis> & <tak|nie>" (the
  // same 6-outcome Result+BTTS shape as id 33) with internally consistent
  // implied probabilities (~120-125% overround) in every fixture checked —
  // confirms this is a genuine full-match RESULT_AND_BTTS source. Round r3's
  // "wildly inconsistent" odds were observed on a different fixture and are
  // more likely a one-off stale price than a different market identity.
  "501": "RESULT_AND_BTTS",
  "502": "RESULT_AND_TOTAL",
  "503": "DOUBLE_CHANCE_BTTS",
  "504": "DOUBLE_CHANCE_BTTS",
  "506": "GOAL_RANGE",
  "509": "MULTI_RESULT",
  "510": "HALF_TIME_GOAL_RANGE",
  // Audit r5 (France vs Morocco): id 511 always surfaces the 5-bucket
  // {0,1-2,1-3,2-3,4+} shape (never the ~17-bucket full-match vocabulary
  // other ids under GOAL_RANGE deliver), and its odds match peer
  // SECOND_HALF_GOAL_RANGE values almost exactly (e.g. this fixture's "0"
  // bucket at 3.37-3.42 vs sts/forbet/betfan/etoto second-half "0" prices of
  // 3.55-4.0) while being far off full-match "0 goals" consensus (~8-12) —
  // id 511 is the 2nd-half goal-range market, not the full-match one.
  "511": "SECOND_HALF_GOAL_RANGE",
  // Audit /audit-match (Arsenal vs Coventry City): id 2099 is the "Early
  // Payout" promo variant of 1X2 (own settlement rules, AWAY 12.52 vs the
  // plain market's 14.48) and it was overwriting the genuine 1X2 (id 1).
  "2099": "OTHER",
  "2179": "GOALSCORER_ANYTIME",
  // Audit-loop v2 round 2: id 2186's raw name is "Zawodnik (lub zmiennik)
  // strzeli gola lub zaliczy asystę" (goal OR assist), a distinct market
  // from the pure-goalscorer id 2179 above ("strzeli gola" only). Every
  // other bookmaker offering the same market shape (fortuna "ufo:mtyp:00-hm",
  // forbet -30704, lvbet "zawodnik strzeli gola lub zanotuje asyste",
  // fuksiarz -4890) routes it to PLAYER_GOAL_OR_ASSIST — this id was
  // wrongly folded into GOALSCORER_ANYTIME, inflating pure-scorer odds with
  // assist-inclusive prices (e.g. defenders who assist more than they score).
  "2186": "PLAYER_GOAL_OR_ASSIST",
  // Audit /audit-match (Arsenal vs Coventry City): id 2395 is the bookmaker's
  // "Zawodnik z kartką (lub zmiennik)" card market — it was overwriting the
  // real scorer market (id 2179, "Zawodnik (lub zmiennik) strzeli gola"), so
  // goalscorer odds were showing booking prices (Gyokeres 4.09 vs peers 1.9).
  "2395": "PLAYER_CARDS",
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
  // Audit r3: "Połowa/Reg. czas gry" (half-time/full-time result) surfaced
  // under a numeric id mapped to DOUBLE_CHANCE_TOTAL at bogus param "0" —
  // route it to the HT/FT catalog market by name.
  { pattern: /^po[łl]owa\s*\/\s*reg\.?\s*czas/i, code: "HALFTIME_FULLTIME" },
  // Audit /audit-match (Arsenal vs Coventry City): the bookmaker's half-scoped
  // markets arrive under ids that the numeric map assigns to the FULL-MATCH
  // code (e.g. "1. Połowa - 1x2" is id 55 -> MATCH_WINNER), so the half line
  // hijacked the match winner. The name is authoritative — pin it here, ahead
  // of the id map.
  { pattern: /^1\.?\s*po[łl]owa\s*[-–]\s*1x2$/i, code: "HALF_TIME_RESULT" },
  { pattern: /^2\.?\s*po[łl]owa\s*[-–]\s*1x2$/i, code: "SECOND_HALF_RESULT" },
  { pattern: /^1\.?\s*po[łl]owa\s*[-–]\s*suma/i, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^2\.?\s*po[łl]owa\s*[-–]\s*suma/i, code: "SECOND_HALF_TOTAL_GOALS" },
  { pattern: /obie.*strzel[aą].*[-–]\s*1\.?\s*po[łl]owa/i, code: "HALF_TIME_BTTS" },
  { pattern: /obie.*strzel[aą].*[-–]\s*2\.?\s*po[łl]owa/i, code: "SECOND_HALF_BTTS" },
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
    // Audit r3: stat totals share the same "ponad/poniżej" vocabulary but
    // were falling through to the 1X2 default and normalizing to UNKNOWN.
    case "TOTAL_SHOTS":
    case "CORNERS_TOTAL":
      return normalizeOverUnderSelection(trimmed);

    case "GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    // Audit r5: id 511 (re-routed from GOAL_RANGE, see PZBUK_MARKET_ID_TO_CODE)
    // shares the same "bez gola"/range-bucket vocabulary as the other
    // goal-range markets above.
    case "SECOND_HALF_GOAL_RANGE":
    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS":
    // Audit r3: range/exact-count stat markets ("0-8", "9-11", "12+", "3+")
    // use the same literal bucket codes as the catalog — map them identically
    // instead of the 1X2 default that produced UNKNOWN/HOME/AWAY orphans.
    case "CORNERS_RANGE":
    case "HALF_TIME_HOME_EXACT_CARDS": {
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

    case "CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      if (score) return score as NormalizedSelection;
      // PZBuk labels the catch-all score-grid column "inny"/"pozostałe" —
      // align with the canonical OTHER code used by peers for the same
      // column instead of leaking the raw Polish text as its own selection.
      if (/^(inny|inny wynik|pozosta[łl]e?)$/i.test(trimmed)) {
        return "OTHER" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "MULTI_RESULT": {
      // Catalog's canonical draw code is "X" — mapping "remis" through the
      // 1X2 helper produced "DRAW", stranding the draw price outside the
      // catalog selection set. Multi-score buckets pass through as-is.
      if (/^(x|remis|draw)$/i.test(trimmed)) return "X" as NormalizedSelection;
      // Audit r5 (France vs Morocco): pzbuk lowercases the "other win" rows
      // ("inne zwycięstwo gospodarzy"/"inne zwycięstwo gości") while the
      // catalog's canonical strings are capitalized — align casing so these
      // match the catalog exactly instead of surviving as an uncomparable
      // raw-cased duplicate selection.
      if (/^inne zwyci[eę]stwo gospodarzy$/i.test(trimmed)) {
        return "Inne zwycięstwo gospodarzy" as NormalizedSelection;
      }
      if (/^inne zwyci[eę]stwo go[śs]ci$/i.test(trimmed)) {
        return "Inne zwycięstwo gości" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "DOUBLE_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      if (htft) return htft as NormalizedSelection;
      // PZBuk may render HT/FT selections with team names/"remis" instead of
      // 1/X/2 notation, e.g. "Szwajcaria/Remis" — resolve both legs.
      const legs = trimmed.split("/");
      if (legs.length === 2) {
        const first = normalize1x2Selection(
          legs[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const second = normalize1x2Selection(
          legs[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        if (first !== "UNKNOWN" && second !== "UNKNOWN") {
          return `${first}_${second}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "PLAYER_GOAL_OR_ASSIST":
      // Shared helper flips "Lastname, Firstname" to natural order so player
      // odds merge with peers in the aggregator.
      return canonicalizePlayerName(
        trimmed.replace(/^\d+\.\s*/, "")
      ) as NormalizedSelection;

    case "RESULT_AND_BTTS":
    case "RESULT_AND_TOTAL":
    case "DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_TOTAL":
    case "TOTAL_GOALS_AND_BTTS":
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
    const firstRaw = comboParts[0].trim();
    const secondLower = comboParts[1].toLowerCase().trim();
    let suffix: string | null = null;
    if (/^(tak|yes)\b/.test(secondLower)) suffix = "YES";
    else if (/^(nie|no)\b/.test(secondLower)) suffix = "NO";
    else if (/^(ponad|powy[żz]ej|over|\+)/.test(secondLower)) suffix = "OVER";
    else if (/^(poni[żz]ej|under|-)/.test(secondLower)) suffix = "UNDER";

    if (suffix) {
      // Double-chance first leg ("Szwajcaria/remis", "remis/Kolumbia",
      // "Szwajcaria/Kolumbia") must resolve to the catalog's 1X/X2/12
      // prefixes — the audit showed mapping them to bare HOME/AWAY collides
      // the three combos into two keys and silently drops one of them.
      const dcLegs = firstRaw.split(/\s*(?:\/|\blub\b)\s*/i).filter((p) => p);
      if (dcLegs.length === 2) {
        const legA = normalize1x2Selection(
          dcLegs[0], ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const legB = normalize1x2Selection(
          dcLegs[1], ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const legSet = new Set([legA, legB]);
        let dcPrefix: string | null = null;
        if (legSet.has("HOME") && legSet.has("DRAW")) dcPrefix = "1X";
        else if (legSet.has("DRAW") && legSet.has("AWAY")) dcPrefix = "X2";
        else if (legSet.has("HOME") && legSet.has("AWAY")) dcPrefix = "12";
        if (dcPrefix) return `${dcPrefix}_${suffix}` as NormalizedSelection;
      }

      const side = normalize1x2Selection(
        firstRaw, ctx.homeTeam, ctx.awayTeam, ctx.league
      );
      if (side === "HOME" || side === "DRAW" || side === "AWAY") {
        return `${side}_${suffix}` as NormalizedSelection;
      }

      // Over/Under first leg ("ponad 2,5 & tak") — TOTAL_GOALS_AND_BTTS
      // catalog codes are OVER_YES/UNDER_YES/OVER_NO/UNDER_NO.
      if (suffix === "YES" || suffix === "NO") {
        const ou = normalizeOverUnderSelection(firstRaw);
        if (ou === "OVER" || ou === "UNDER") {
          return `${ou}_${suffix}` as NormalizedSelection;
        }
      }
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
    "TOTAL_GOALS_AND_BTTS",
    "TOTAL_SHOTS",
    "CORNERS_TOTAL",
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

    // Audit r3: id 502 (RESULT_AND_TOTAL) carries textually correct
    // ponad/poniżej labels whose odds are systematically attached to the
    // opposite side (pzbuk HOME_UNDER 5.21 / HOME_OVER 8.66 vs peer
    // HOME_OVER ~4.8-5.1 / HOME_UNDER ~8.5-8.8, impossible at low lines
    // where "<result> & under" is the rarer outcome) — flip the O/U suffix.
    const flipOverUnder =
      marketCode === "RESULT_AND_TOTAL" &&
      String(raw.bookmakerMarketId ?? "") === "502";

    const selections = raw.selections.map((sel) => {
      let code = normalizeSelectionForMarket(sel.name, marketCode!, ctx);
      if (flipOverUnder) {
        if (code.endsWith("_OVER")) {
          code = code.replace(/_OVER$/, "_UNDER") as NormalizedSelection;
        } else if (code.endsWith("_UNDER")) {
          code = code.replace(/_UNDER$/, "_OVER") as NormalizedSelection;
        }
      }
      return {
        code,
        label: sel.name,
        odds: sel.odds,
      };
    });

    // Markets where no selection could be identified contribute nothing to
    // cross-bookmaker comparison and only pollute parameter lists (audit r3:
    // single-UNKNOWN rows at bogus params) — drop them entirely.
    if (
      marketCode !== "OTHER" &&
      selections.length > 0 &&
      selections.every((s) => s.code === "UNKNOWN")
    ) {
      return null;
    }

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

  // Half-scoped markets first: the generic patterns below (e.g. /obie strzelą/,
  // /liczba goli/) would otherwise swallow "1. Połowa - ..." names and route a
  // half market into a full-match code.
  if (/^1\.?\s*po[łl]owa\s*[-–]\s*1x2$/i.test(lower)) return "HALF_TIME_RESULT";
  if (/^2\.?\s*po[łl]owa\s*[-–]\s*1x2$/i.test(lower)) return "SECOND_HALF_RESULT";
  if (/^1\.?\s*po[łl]owa\s*[-–]\s*suma/i.test(lower)) return "HALF_TIME_TOTAL_GOALS";
  if (/^2\.?\s*po[łl]owa\s*[-–]\s*suma/i.test(lower)) return "SECOND_HALF_TOTAL_GOALS";
  if (/obie.*strzel[aą].*1\.?\s*po[łl]ow/i.test(lower)) return "HALF_TIME_BTTS";
  if (/obie.*strzel[aą].*2\.?\s*po[łl]ow/i.test(lower)) return "SECOND_HALF_BTTS";

  if (/^(wynik meczu|1x2|match result)$/i.test(lower)) return "MATCH_WINNER";
  if (/^suma goli$/i.test(lower)) return "TOTAL_GOALS";
  if (/^oba zespo[łl]y zdob[eę]d[aą] gola$/i.test(lower)) return "BTTS";
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
