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
  canonicalizePlayerName,
  normalizeMultiResultSelection,
  rerouteWholeGoalLineToAsian,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode, getMarketByCode } from "../../../data/market-catalog.js";
import { MARKET_TYPE_IDS } from "../../../scrapers/bookmakers/fortuna/constants.js";

// Round-3 audit: id identities re-verified against the live markets API
// (fixture "Norwegia - Anglia", 2026-07-08). Many ids previously guessed from
// odds shapes turned out to be different markets — the API market names (now
// captured by the parser instead of being rejected for containing ":") are the
// source of truth recorded next to each mapping.
const FORTUNA_MARKET_ID_TO_CODE: Record<string, NormalizedMarketType> = {
  [MARKET_TYPE_IDS.MATCH_RESULT]: "MATCH_WINNER",
  [MARKET_TYPE_IDS.DOUBLE_CHANCE]: "DOUBLE_CHANCE",
  [MARKET_TYPE_IDS.OVER_UNDER]: "TOTAL_GOALS",
  [MARKET_TYPE_IDS.BTTS]: "BTTS",
  [MARKET_TYPE_IDS.HALF_TIME_RESULT]: "HALF_TIME_RESULT",
  [MARKET_TYPE_IDS.HALF_TIME_OVER_UNDER]: "HALF_TIME_TOTAL_GOALS",
  [MARKET_TYPE_IDS.HALF_TIME_BTTS]: "HALF_TIME_BTTS",
  // NOTE: 00-0v ("ASIAN_HANDICAP") and 00-0w ("EUROPEAN_HANDICAP") are NOT
  // handicaps on the live API — both carry a 4-way goal-band book ("0-1", "2",
  // "3", "4+") of unknown scope. Excluded; real handicaps arrive via
  // 00-0b/00-0h/00-re (2-way lines) and 00-61 (score-style 3-way).
  // NOTE: 00-04 ("CORRECT_SCORE") is live-named "1.połowa lub wynik meczu
  // (podwójna szansa)" — a HT-or-FT double chance, mapped below.
  "ufo:mtyp:00-04": "HT_OR_FT_RESULT",
  "ufo:mtyp:00-6w": "CORRECT_SCORE", // "Mecz: dokładny wynik" (full grid, 0:0@12)
  [MARKET_TYPE_IDS.DRAW_NO_BET]: "DRAW_NO_BET",
  // 00-1a is live-named "Mecz: <team1> Liczba goli P/N" — the home-team
  // odd/even market, not the match-level one; the name router flips sides.
  [MARKET_TYPE_IDS.ODD_EVEN_GOALS]: "HOME_TEAM_ODD_EVEN_GOALS",
  // Player props (stable Fortuna marketTypeId)
  "ufo:mtyp:00-ox": "PLAYER_HEADER_GOAL",
  "ufo:mtyp:00-ln": "PLAYER_GOALS",
  // "Zawodnik - liczba strzałów w światło bramki spoza pola karnego (OPTA)"
  "ufo:mtyp:00-o6": "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX",
  // NOTE: 00-og ("...w światło bramki nogą") and 00-ok ("...w światło bramki
  // z pola karnego") are SOT-by-foot / SOT-in-box variants with no catalog
  // codes — excluded so they stop diluting PLAYER_SHOTS_ON_TARGET.
  "ufo:mtyp:00-lf": "PLAYER_SHOTS",
  "ufo:mtyp:00-la": "PLAYER_ASSISTS",
  "ufo:mtyp:00-lk": "PLAYER_CARDS",
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
  "ufo:mtyp:00-hm": "PLAYER_GOAL_OR_ASSIST",
  "ufo:mtyp:00-71": "WIN_AND_PLAYER_SHOTS_ON_TARGET",
  "ufo:mtyp:00-76": "PLAYER_RED_CARD",
  "ufo:mtyp:00-70": "PLAYER_GOAL_AND_RESULT",
  // NOTE: 00-lo is live-named "SuperSub: Zawodnik i jego zmiennik - liczba
  // strzałów" (player+substitute combo) — NOT match TOTAL_GOALS_MINIMUM.
  // Excluded; no catalog code for SuperSub combos.
  // Handicaps
  "ufo:mtyp:00-0b": "ASIAN_HANDICAP",
  "ufo:mtyp:00-0h": "ASIAN_HANDICAP",
  "ufo:mtyp:00-re": "ASIAN_HANDICAP",
  "ufo:mtyp:00-37": "ASIAN_HANDICAP_PUSH",
  "ufo:mtyp:00-61": "EUROPEAN_HANDICAP", // "Mecz: handicap 1:0" (score-style 3-way)
  "ufo:mtyp:00-5z": "FIRST_HALF_EUROPEAN_HANDICAP", // "1.połowa: handicap 2:0"
  "ufo:mtyp:00-2h": "FIRST_HALF_ASIAN_HANDICAP", // "1.połowa: handicap" (2-way lines)
  // Goals
  "ufo:mtyp:00-2i": "HALF_TIME_TOTAL_GOALS", // "1.połowa: liczba goli"
  "ufo:mtyp:00-3b": "SECOND_HALF_TOTAL_GOALS", // "2.połowa: liczba goli"
  "ufo:mtyp:00-10": "HOME_TEAM_TOTAL_GOALS", // "Mecz: <team1> - liczba goli"
  "ufo:mtyp:00-13": "AWAY_TEAM_TOTAL_GOALS", // "Mecz: <team2> - liczba goli"
  "ufo:mtyp:00-2j": "HALF_TIME_HOME_TEAM_TOTAL_GOALS", // "1.połowa: <team1> liczba goli"
  "ufo:mtyp:00-2k": "HALF_TIME_AWAY_TEAM_TOTAL_GOALS", // "1.połowa: <team2> liczba goli"
  "ufo:mtyp:00-3c": "SECOND_HALF_HOME_TEAM_TOTAL_GOALS", // "2.połowa: <team1> liczba goli"
  "ufo:mtyp:00-3d": "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS", // "2.połowa: <team2> liczba goli"
  // "Mecz: multigole" is fortuna's cumulative Multigoal ladder (17 overlapping
  // bands: 0, 1-2..5-6, 7+ — several are simultaneously true for one final
  // score), structurally distinct from GOAL_RANGE's exhaustive disjoint
  // partition. MULTI_GOAL_RANGE's own catalog entry documents this exact
  // full-match-only scope (audit-match Arsenal vs Coventry City, round 6/7).
  "ufo:mtyp:00-24": "MULTI_GOAL_RANGE", // "Mecz: multigole"
  // Per-team and per-half "multigole" variants (audit /audit-match,
  // premier-league Arsenal vs Coventry City): same 4-way goal-band product
  // as 00-24, just scoped to one team or one half. Catalog codes exist
  // (HOME_GOAL_RANGE/AWAY_GOAL_RANGE/HALF_TIME_GOAL_RANGE/
  // SECOND_HALF_GOAL_RANGE) but were never wired up, so these ids fell
  // through to the generic OTHER bucket.
  "ufo:mtyp:00-25": "HOME_GOAL_RANGE", // "Mecz: <team1> - multigole"
  "ufo:mtyp:00-27": "AWAY_GOAL_RANGE", // "Mecz: <team2> - multigole"
  "ufo:mtyp:00-29": "HALF_TIME_GOAL_RANGE", // "1.połowa: multigole"
  "ufo:mtyp:00-2a": "SECOND_HALF_GOAL_RANGE", // "2.połowa: multigole"
  // NOTE: 00-0m was previously mapped to GOAL_RANGE, but its 4-band book
  // ("0-2"@3.5, "3-4"@2.6, "5-6"@3.55, "7+"@5.2) is far too flat for match
  // goals and deviates ~3x from every peer — a different (non-goals) range
  // market. Excluded until verified live (absent from the checked fixture).
  // NOTE: 00-s6/00-rw are quarter-scoped goal totals ("2.kwarta: liczba
  // goli") — no catalog code for quarter totals; excluded.
  // NOTE: 00-k6 is "Mecz: liczba asyst w meczu" — no ASSISTS_TOTAL catalog
  // code; excluded (was wrongly bucketed into TOTAL_GOALS).
  // Statistics (OPTA)
  "ufo:mtyp:00-0i": "CORNERS_TOTAL", // "Mecz: liczba rzutów rożnych"
  "ufo:mtyp:00-0t": "HALF_TIME_CORNERS_TOTAL", // "1.połowa: liczba rzutów rożnych"
  "ufo:mtyp:00-0j": "CORNERS_TEAM", // "Mecz: <team1> - liczba rzutów rożnych"
  "ufo:mtyp:00-0k": "CORNERS_TEAM", // "Mecz: <team2> - liczba rzutów rożnych"
  "ufo:mtyp:00-0l": "CORNERS_RANGE",
  "ufo:mtyp:00-0e": "CORNERS_RACE", // "Mecz: więcej rzutów rożnych"
  "ufo:mtyp:00-hb": "CARDS_TOTAL", // "Mecz: liczba Żółtych Kartek"
  "ufo:mtyp:00-l5": "CARDS_TEAM", // "Mecz: <team1> - liczba Żółtych Kartek"
  "ufo:mtyp:00-l6": "CARDS_TEAM", // "Mecz: <team2> - liczba Żółtych Kartek"
  "ufo:mtyp:00-gj": "CARDS_RACE", // "Mecz: więcej Żółtych Kartek"
  "ufo:mtyp:00-o0": "FIRST_CARD", // "Mecz: pierwsza żółta kartka"
  // "Mecz: Czerwona Kartka (bez CK dla trenera i sztabu)" is a plain
  // whole-match YES/NO ("Tak"/"Nie" selections, handled by the default
  // switch case below) — the same bet other bookmakers already pool under
  // RED_CARD. Was previously unmapped and fell through to OTHER (audit
  // cluster #5: "Czerwona kartka w meczu" duplicate).
  "ufo:mtyp:00-06": "RED_CARD",
  "ufo:mtyp:00-h3": "OFFSIDES_TOTAL", // "Mecz: liczba spalonych"
  "ufo:mtyp:00-kx": "HOME_TEAM_TOTAL_OFFSIDES", // "Mecz: <team1> - liczba spalonych"
  "ufo:mtyp:00-ky": "AWAY_TEAM_TOTAL_OFFSIDES", // "Mecz: <team2> - liczba spalonych"
  "ufo:mtyp:00-gh": "OFFSIDES_1X2", // "Mecz: więcej spalonych"
  "ufo:mtyp:00-h5": "TOTAL_SHOTS", // "Mecz: liczba strzałów"
  "ufo:mtyp:00-h7": "TOTAL_SHOTS_ON_TARGET", // "Mecz: liczba strzałów w światło bramki"
  "ufo:mtyp:00-kp": "TEAM_TOTAL_SHOTS", // "Mecz: <team1> - liczba strzałów"
  "ufo:mtyp:00-kq": "TEAM_TOTAL_SHOTS", // "Mecz: <team2> - liczba strzałów"
  "ufo:mtyp:00-kr": "TEAM_TOTAL_SHOTS_ON_TARGET", // "Mecz: <team1> - liczba celnych"
  "ufo:mtyp:00-ks": "TEAM_TOTAL_SHOTS_ON_TARGET", // "Mecz: <team2> - liczba celnych"
  "ufo:mtyp:00-gd": "MOST_SHOTS", // "Mecz: więcej strzałów"
  "ufo:mtyp:00-gg": "MOST_SHOTS_ON_TARGET", // "Mecz: więcej strzałów w światło bramki"
  "ufo:mtyp:00-hv": "FOULS_TOTAL", // "Mecz: liczba fauli"
  "ufo:mtyp:00-kn": "HOME_TEAM_TOTAL_FOULS", // "Mecz: <team1> - liczba fauli"
  "ufo:mtyp:00-ko": "AWAY_TEAM_TOTAL_FOULS", // "Mecz: <team2> - liczba fauli"
  "ufo:mtyp:00-hu": "FOUL_RACE", // "Mecz: więcej fauli" (was wrongly MATCH_WINNER)
  // Combos
  "ufo:mtyp:00-23": "DOUBLE_CHANCE_TOTAL", // "Mecz: dwójtyp/liczba goli"
  "ufo:mtyp:00-1k": "TOTAL_GOALS_AND_BTTS", // "Mecz: obie drużyny strzelą gola/liczba goli"
  "ufo:mtyp:00-1l": "RESULT_AND_TOTAL", // "Mecz: wynik/liczba goli"
  "ufo:mtyp:00-20": "RESULT_AND_TOTAL",
  "ufo:mtyp:00-1j": "RESULT_AND_BTTS", // "Mecz: wynik/obie drużyny strzelą gola"
  "ufo:mtyp:00-2q": "HALF_TIME_RESULT_AND_BTTS", // "1.połowa: wynik/obie... w 1.połowie"
  "ufo:mtyp:00-2r": "HALF_TIME_RESULT_AND_TOTAL", // "1.połowa: wynik/liczba goli w 1.połowie"
  "ufo:mtyp:00-1z": "SECOND_HALF_RESULT_AND_BTTS", // "2.połowa: wynik/obie... w 2.połowie"
  "ufo:mtyp:00-0z": "FIRST_GOAL_AND_RESULT", // "Mecz: 1. gol/wynik"
  "ufo:mtyp:00-28": "MULTI_RESULT", // "Mecz: multiwynik"
  "ufo:mtyp:00-1n": "HALFTIME_FULLTIME", // "1.połowa/wynik meczu"
  "ufo:mtyp:00-21": "DOUBLE_CHANCE_BTTS",
  "ufo:mtyp:00-22": "DOUBLE_CHANCE_BTTS",
  // 00-1y is live-named "1.połowa: dwójtyp/obie drużyny strzelą gola" — the
  // half-time-scoped variant of the same product (was previously excluded
  // here on a since-superseded worry that its higher BTTS-yes prices meant a
  // different product; they are simply half-scoped, same as 00-21's
  // "2.połowa:" variant just below). The half-scope reroute further down
  // (matchedBy === "id", "^1.połowa:" prefix) rewrites this to
  // HALF_TIME_DOUBLE_CHANCE_BTTS, matching etoto/sts's half-time figures for
  // this fixture (10/Tak@6 vs etoto HT 1X_YES@6).
  "ufo:mtyp:00-1y": "DOUBLE_CHANCE_BTTS",
  // audit-match (Arsenal vs Coventry City) UX gap-analysis, then cluster #3
  // (RESULT_OR_TOTAL fragmentation): these 4 ids are fortuna's own
  // {home,away} x {over,under} 2x2 grid for "team wins or total goals
  // over/under X" — verified via fresh raw capture: 7b="Arsenal wygra /
  // powyżej", 7c="Mecz: Arsenal wygra / poniżej" (previously entirely
  // unmapped, logged as "Unknown market" and dropped), 7d="Coventry wygra /
  // powyżej", 7e="Coventry wygra / poniżej". They used to route to two
  // fortuna-only catalog codes (TEAM_WIN_OR_OVER_GOALS/TEAM_WIN_OR_TOTAL_
  // UNDER, side carried in the param as "HOME:2.5"); now all 4 pool into the
  // shared, plain-line-parameterized RESULT_OR_TOTAL code (the same one
  // superbet already uses) so fortuna's prices merge with superbet/etoto/
  // forbet's instead of sitting in fortuna-only cards. The specific
  // HOME_OVER/AWAY_UNDER/etc. selection for each id comes from
  // FORTUNA_RESULT_OR_TOTAL_ID_COMBO in normalizeMarket below.
  "ufo:mtyp:00-7b": "RESULT_OR_TOTAL",
  "ufo:mtyp:00-7c": "RESULT_OR_TOTAL",
  "ufo:mtyp:00-7d": "RESULT_OR_TOTAL",
  "ufo:mtyp:00-7e": "RESULT_OR_TOTAL",
  // Match result family
  "ufo:mtyp:00-60": "MATCH_WINNER",
  "ufo:mtyp:00-2x": "MATCH_WINNER",
  "ufo:mtyp:00-0p": "MATCH_WINNER",
  "ufo:mtyp:00-9b": "VAR_REVIEW",
  "ufo:mtyp:00-r7": "PENALTY_IN_BOTH_HALVES",
  "ufo:mtyp:00-rx": "TIME_PERIOD_RESULT", // "2.kwarta"
  "ufo:mtyp:00-rz": "TIME_PERIOD_RESULT", // "3.kwarta"
  "ufo:mtyp:00-s1": "TIME_PERIOD_RESULT", // "4.kwarta"
  "ufo:mtyp:00-ru": "TIME_PERIOD_RESULT", // "1.kwarta" (was wrongly MATCH_WINNER)
  "ufo:mtyp:00-m8": "HALF_TIME_SUBSTITUTION",
  "ufo:mtyp:00-2d": "HALF_TIME_RESULT", // "1.połowa"
  "ufo:mtyp:00-1e": "TEAMS_TO_SCORE",
  "ufo:mtyp:00-2y": "SECOND_HALF_DOUBLE_CHANCE", // "2.połowa: dwójtyp" (was full-match DC)
  "ufo:mtyp:00-2z": "SECOND_HALF_DRAW_NO_BET", // "2.połowa: bez remisu" (was full-match DNB)
  "ufo:mtyp:00-1t": "HALF_WITH_MORE_GOALS",
  "ufo:mtyp:00-m7": "SUBSTITUTE_GOAL",
  "ufo:mtyp:00-2m": "HALF_TIME_ODD_EVEN_GOALS", // "1.połowa: suma goli" P/N
  "ufo:mtyp:00-3j": "SECOND_HALF_CORRECT_SCORE", // "2.połowa: dokładny wynik"
  "ufo:mtyp:00-2t": "HALF_TIME_CORRECT_SCORE", // "1.połowa: dokładny wynik"
  "ufo:mtyp:00-3g": "SECOND_HALF_BTTS", // "2.połowa: obie drużyny strzelą gola"
  "ufo:mtyp:00-2g": "HALF_TIME_DRAW_NO_BET", // "1.połowa: bez remisu (remis = zwrot)"
  "ufo:mtyp:00-2s": "FIRST_TEAM_TO_SCORE", // "Mecz: 1.gol"
  // NOTE: this id is reused for two different products (live-verified):
  // bare "2.połowa" (who wins the 2nd half, HOME/DRAW/AWAY) and "2.połowa:
  // 1. gol" (who scores the FIRST goal of the 2nd half — no draw concept,
  // HOME/AWAY/NONE). The live name is authoritative; the latter is rerouted
  // to SECOND_HALF_FIRST_GOAL below.
  "ufo:mtyp:00-2w": "SECOND_HALF_RESULT", // "2.połowa"
  // "1.połowa: 1. gol" (first goal of the 1st half, HOME/AWAY/NONE) has no
  // other id or name-pattern route, so it fell all the way through to null
  // -> OTHER before the firstGoalHalf name-regex below ever ran (that regex
  // only rewrites an ALREADY-resolved marketCode; it never runs when
  // marketCode is still null, since normalizeMarket returns early in that
  // case). Map the id directly to the correct half-scoped code; the name
  // regex below still handles "2.połowa: 1. gol" via id 00-2x (reused for
  // MATCH_WINNER) and remains authoritative for any future scope drift.
  "ufo:mtyp:00-2e": "HALF_TIME_FIRST_GOAL",
  "ufo:mtyp:00-1v": "HOME_HALF_WITH_MOST_GOALS",
  "ufo:mtyp:00-7a": "FIRST_GOAL_TIME",
  "ufo:mtyp:00-26": "BTTS_BY_HALF",
  "ufo:mtyp:00-1b": "HOME_TEAM_ODD_EVEN_GOALS",
  "ufo:mtyp:00-1f": "TEAM_CLEAN_SHEET",
  "ufo:mtyp:00-38": "TEAM_WIN",
  "ufo:mtyp:00-3a": "LAST_TEAM_TO_SCORE",
  // 00-1g is the second team's clean-sheet prop ("Mecz: <team2> - nie straci
  // gola") — route through the TEAM_CLEAN_SHEET name router instead of
  // hardcoding HOME.
  "ufo:mtyp:00-1g": "TEAM_CLEAN_SHEET",
  // Half-scoped clean-sheet props (audit /audit-match, premier-league
  // Arsenal vs Coventry City): each id is already team- and window-specific
  // (unlike 00-1f/00-1g, which share the TEAM_CLEAN_SHEET intermediate code
  // and need the name router below to pick a side).
  //
  // Retired the dedicated HALF_TIME/SECOND_HALF_*_CLEAN_SHEET catalog codes
  // (audit cluster #0, findings 3/4): "{team} won't concede" is the exact
  // same real-world proposition as "opponent won't score" — with a
  // half-disjoint bookmaker pool (this family: betfan/betclic/fortuna/
  // pzbuk/forbet/etoto; the TO_SCORE family: sts/betcris/superbet/fuksiarz/
  // lvbet). Route straight to the OPPOSING side's *_TO_SCORE code instead;
  // the selection-normalizer default case below inverts YES/NO for these
  // (fortuna has no other raw source for HALF_TIME/SECOND_HALF_*_TO_SCORE,
  // so an unconditional inversion here is safe).
  "ufo:mtyp:00-2o": "HALF_TIME_AWAY_TO_SCORE", // "1.połowa: <team1=home> nie straci gola" -> away didn't score
  "ufo:mtyp:00-2p": "HALF_TIME_HOME_TO_SCORE", // "1.połowa: <team2=away> nie straci gola" -> home didn't score
  "ufo:mtyp:00-3h": "SECOND_HALF_AWAY_TO_SCORE", // "2.połowa: <team1=home> nie straci gola" -> away didn't score
  "ufo:mtyp:00-3i": "SECOND_HALF_HOME_TO_SCORE", // "2.połowa: <team2=away> nie straci gola" -> home didn't score
  "ufo:mtyp:00-36": "TEAM_WINS_MATCH",
  "ufo:mtyp:00-q0": "HALF_TIME_STOPPAGE_TIME_GOAL",
  "ufo:mtyp:00-q1": "SECOND_HALF_ADDED_TIME_GOAL",
  "ufo:mtyp:00-q2": "INJURY_TIME_GOAL",
  // 00-2f live-verified as "1.połowa: dwójtyp" (its odds were previously
  // inconsistent with full-match double chance for exactly this reason).
  "ufo:mtyp:00-2f": "HALF_TIME_DOUBLE_CHANCE",
  // "Jedna z drużyn wygra mecz" = the same bet as etoto/forbet's
  // ANY_TEAM_TO_WIN ("Którakolwiek z drużyn wygra mecz") - routed there so
  // all three bookmakers share one comparison card instead of fortuna
  // rendering an identically-priced twin (market-display audit: fortuna
  // 1.10/6.00 alone vs etoto 1.10/6.00 + forbet 1.11/6.40 in the other card).
  "ufo:mtyp:00-39": "ANY_TEAM_TO_WIN",
  "ufo:mtyp:00-1u": "HOME_HALF_WITH_MOST_GOALS",
};

const FORTUNA_MARKET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /^wynik meczu/, code: "MATCH_WINNER" },
  { pattern: /^podwojna szansa/, code: "DOUBLE_CHANCE" },
  { pattern: /^obie druzyny strzela/, code: "BTTS" },
  { pattern: /^liczba goli.*1\.?\s*polow/, code: "HALF_TIME_TOTAL_GOALS" },
  { pattern: /^liczba goli/, code: "TOTAL_GOALS" },
  { pattern: /^wynik\s*1\.?\s*polow/, code: "HALF_TIME_RESULT" },
  { pattern: /^obie strzel.*1\.?\s*polow/, code: "HALF_TIME_BTTS" },
  // NOTE: the "handicap azjatycki"/"handicap europejski" name patterns were
  // removed — those labels were parser fallbacks for ids 00-0v/00-0w, which
  // are goal-band markets (not handicaps) on the live API. Real handicaps
  // ("Mecz: handicap ...") are routed by id.
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
  "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX",
  "PLAYER_SHOTS_OUTSIDE_BOX",
  "PLAYER_SHOTS_IN_BOX",
  "PLAYER_HEADER_SHOTS_ON_TARGET",
  "PLAYER_PASSES",
  "PLAYER_RED_CARD",
  "PLAYER_FOOT_GOAL",
  "PLAYER_PENALTY_AREA_GOAL",
  "PLAYER_OFFSIDES_1H",
  "PLAYER_FIRST_OR_LAST_GOAL",
  // The market title already names the player ("Hernandez, Lucas liczba
  // spalonych (reg.czas) (OPTA)") with the actual raw selection being a
  // plain "1+" threshold, matching the other stat-line markets' shape (not
  // the dropdown convention below, where the selection itself is the
  // player).
  "PLAYER_OFFSIDES",
]);

// Player stat-line markets whose catalog vocabulary is YES (not "N+"): the
// raw "1+" threshold means "at least one", i.e. YES.
const FORTUNA_PLAYER_YES_MARKETS = new Set<NormalizedMarketType>([
  "PLAYER_CARDS",
  "PLAYER_RED_CARD",
  "PLAYER_FIRST_OR_LAST_GOAL",
]);

// Per-player dropdown markets: the player (parsed from the raw market name)
// becomes the market PARAMETER, and per-player Fortuna markets merge into
// one aggregated dropdown market keyed by that parameter. The SELECTION
// code for all of these is the catalog's single generic code ("PLAYER" /
// "PLAYER_NAME") - matching every peer bookmaker (betcris/betfan/etoto/
// fuksiarz/lvbet/sts/superbet) - not the player name (see
// normalizeSelectionForMarket below).
const FORTUNA_PLAYER_DROPDOWN_MARKETS = new Set<NormalizedMarketType>([
  "GOALSCORER_FIRST",
  "GOALSCORER_LAST",
  "GOALSCORER_ANYTIME",
  "PLAYER_HEADER_GOAL",
  "PLAYER_GOAL_OR_ASSIST",
  "PLAYER_GOAL_OUTSIDE_BOX",
]);

/** Strips the leading scope prefix ("Mecz:", "1.połowa:", "2.połowa:"). */
function stripFortunaScope(name: string): string {
  return name
    .replace(/^\s*(?:mecz|[12]\s*\.?\s*po[lł]owa)\s*:\s*/iu, "")
    .trim();
}

/**
 * Fortuna hyphenates some compound names ("Salah-Eddine, Anass") that peer
 * bookmakers spell with a plain space ("Anass Salah Eddine"); align spelling
 * after the generic Lastname/Firstname swap so the player parameter merges
 * with peers instead of fragmenting into a second bucket. Also aligns two
 * OPTA spelling/naming variants that otherwise fragment cross-bookmaker
 * best-odds for the same real player:
 * - "El-Ouadi" (Fortuna's OPTA spelling for Morocco's Zakaria El Ouahdi) vs
 *   "El Ouahdi" (betcris/betfan/superbet's spelling).
 * - "Kouadio Kone" (Fortuna's OPTA given name for Manu Koné, whose full name
 *   is Emmanuel Kouadio Koné) vs "Kone Manu", the bucket already shared by
 *   STS/LVBet.
 * - "Cedric Jan Itten" (Fortuna's OPTA full given name for Switzerland's
 *   Cedric Itten, including his middle name "Jan") vs "Cedric Itten", the
 *   shorter form used by lvbet/betcris/most other bookmakers.
 * - "Eray Comert" (Fortuna's OPTA transliteration of Switzerland's Eray
 *   Cömert, dropping the umlaut to a plain "o") vs "Eray Coemert", the "oe"
 *   transliteration used by lvbet/betcris/most other bookmakers.
 */
function canonicalizeFortunaPlayerName(raw: string): string {
  return canonicalizePlayerName(raw)
    .replace(/\bSalah-Eddine\b/giu, "Salah Eddine")
    .replace(/\bEl[- ]Ouadi\b/giu, "El Ouahdi")
    .replace(/\bKouadio Kone\b/giu, "Kone Manu")
    .replace(/\bCedric Jan Itten\b/giu, "Cedric Itten")
    .replace(/\bEray Comert\b/giu, "Eray Coemert");
}

/**
 * Strips a leading team-name token that OPTA occasionally prefixes directly
 * onto the player name with no punctuation ("Maroko Diop, Issa strzeli
 * pierwszego gola w meczu (OPTA)"), which would otherwise leak into the
 * extracted surname ("Issa Maroko Diop"). Abbreviated team prefixes
 * ("W.Ziel.Przyl. Cabral, Jovane") already fail to match below because of
 * their embedded periods and need no special handling here.
 */
function stripFortunaLeadingTeamToken(name: string, ctx: NormalizationContext): string {
  const leadingWord = name.match(/^([\p{Lu}][\p{L}'-]*)\s+/u)?.[1];
  if (!leadingWord) return name;
  const side = normalize1x2Selection(leadingWord, ctx.homeTeam, ctx.awayTeam, ctx.league);
  return side === "HOME" || side === "AWAY" ? name.slice(leadingWord.length).trim() : name;
}

/**
 * Extracts the player name from Fortuna per-player OPTA market names and
 * canonicalizes it to natural "Firstname Lastname" order:
 * - dash form: "Zerrouki, Ramiz - liczba fauli (OPTA)"
 * - count form (no dash): "Widmer, Silvan liczba spalonych w 1.połowie (OPTA)"
 * - verb form (optionally with abbreviated team prefix):
 *   "W.Ziel.Przyl. Cabral, Jovane strzeli pierwszego gola w meczu (OPTA)"
 * - no-comma fallback: some OPTA entries are written in plain "Firstname
 *   Lastname" order with no comma at all ("Youssef Belammari liczba
 *   spalonych w 1.połowie (OPTA)", "Ayoube Amaimouni Echghouyab - liczba
 *   fauli (OPTA)") — already in natural order, so no swap is needed.
 */
function extractFortunaPlayerName(
  rawName: string,
  ctx: NormalizationContext
): string | undefined {
  const name = stripFortunaLeadingTeamToken(stripFortunaScope(rawName), ctx);

  // The name portion may itself contain a hyphenated given/surname ("Mateta,
  // Jean-Philippe - ..."), so it must allow hyphens; only the literal " - "
  // (space-hyphen-space) is the actual dash/count separator.
  const dashMatch = name.match(/^(.+?,.+?)\s+-\s+/);
  if (dashMatch) return canonicalizeFortunaPlayerName(dashMatch[1].trim());

  const countMatch = name.match(
    /^([\p{Lu}][\p{L}'’.\- ]*,\s*[\p{Lu}][\p{L}'’. -]*?)\s+liczba\s/u
  );
  if (countMatch) return canonicalizeFortunaPlayerName(countMatch[1].trim());

  const verbMatch = name.match(
    /([\p{Lu}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)*,\s*[\p{Lu}][\p{L} '.-]*?)\s+(?:strzeli|asystuje|otrzyma|zaliczy|odda)/u
  );
  if (verbMatch) return canonicalizeFortunaPlayerName(verbMatch[1].trim());

  // No-comma fallback: capture the leading run of 2+ capitalized words
  // immediately preceding the dash separator or a known count/verb keyword.
  const noCommaMatch = name.match(
    /^([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*)+)\s+(?:-\s+|liczba\s|(?:strzeli|asystuje|otrzyma|zaliczy|odda)\b)/u
  );
  if (noCommaMatch) return canonicalizeFortunaPlayerName(noCommaMatch[1].trim());

  return undefined;
}

/** Leaked internal ids like "Rynek ufo:mtyp:00-37" must never be mined for lines. */
function isPlaceholderMarketName(name: string): boolean {
  return /^rynek\s/i.test(name) || name.includes("ufo:mtyp");
}

/**
 * Resolves which side a team-scoped market ("Mecz: Norwegia - liczba fauli
 * (OPTA)", "1.połowa: Anglia liczba goli 2.5") refers to, from the team token
 * between the scope prefix and the "liczba" keyword.
 */
function resolveFortunaTeamSide(
  rawName: string,
  ctx: NormalizationContext
): "HOME" | "AWAY" | undefined {
  if (isPlaceholderMarketName(rawName)) return undefined;
  const stripped = stripFortunaScope(rawName);
  const match = stripped.match(/^(.+?)\s*(?:-\s*)?[Ll]iczba\s/u);
  if (!match) return undefined;
  const side = normalize1x2Selection(
    match[1].trim(),
    ctx.homeTeam,
    ctx.awayTeam,
    ctx.league
  );
  return side === "HOME" || side === "AWAY" ? side : undefined;
}

/**
 * Resolves which team a "1.połowa: <team> przedział rzutów rożnych" (1st
 * half per-team corner range) raw market refers to. The team token sits
 * between the half-scope prefix and "przedział", not before a "liczba"
 * keyword like resolveFortunaTeamSide expects, so this needs its own match.
 */
function resolveFortunaHalfTimeCornerRangeSide(
  rawName: string,
  ctx: NormalizationContext
): "HOME" | "AWAY" | undefined {
  if (isPlaceholderMarketName(rawName)) return undefined;
  const stripped = stripFortunaScope(rawName);
  const teamToken = stripped.match(/^(.+?)\s+przedzia[łl]\s/iu);
  if (!teamToken) return undefined;
  const side = normalize1x2Selection(teamToken[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
  return side === "HOME" || side === "AWAY" ? side : undefined;
}

// Fortuna type ids come in team1/team2 pairs; the id itself implies the side
// when the (possibly fallback) market name cannot be team-matched. Verified
// against the live API: the first id of each pair is always the home team.
const FORTUNA_TEAM_SCOPED_ID_SIDE: Record<string, "HOME" | "AWAY"> = {
  "ufo:mtyp:00-0j": "HOME", // team corners
  "ufo:mtyp:00-0k": "AWAY",
  "ufo:mtyp:00-kp": "HOME", // team shots
  "ufo:mtyp:00-kq": "AWAY",
  "ufo:mtyp:00-kr": "HOME", // team shots on target
  "ufo:mtyp:00-ks": "AWAY",
  "ufo:mtyp:00-l5": "HOME", // team yellow cards
  "ufo:mtyp:00-l6": "AWAY",
  "ufo:mtyp:00-1a": "HOME", // team odd/even goals
  "ufo:mtyp:00-1b": "AWAY",
  "ufo:mtyp:00-7b": "HOME", // team win or over/under total goals
  "ufo:mtyp:00-7c": "HOME",
  "ufo:mtyp:00-7d": "AWAY",
  "ufo:mtyp:00-7e": "AWAY",
};

// Markets whose side lives in the parameter ("HOME:4.5"), matching the
// betclic/forbet convention — catalog selections are plain OVER/UNDER.
// TEAM_WIN_OR_OVER_GOALS / TEAM_WIN_OR_TOTAL_UNDER used to live here (side
// prefixed onto the line, e.g. "HOME:2.5") but were retired into the shared
// RESULT_OR_TOTAL code (cluster #3) - see FORTUNA_RESULT_OR_TOTAL_ID_COMBO
// and its call site in normalizeMarket below for the replacement.
const FORTUNA_TEAM_LINE_PARAM_MARKETS = new Set<NormalizedMarketType>([
  "CORNERS_TEAM",
  "TEAM_TOTAL_SHOTS",
  "TEAM_TOTAL_SHOTS_ON_TARGET",
]);

/**
 * Cluster #3 (RESULT_OR_TOTAL fragmentation): the "team win or over/under
 * total goals" 2x2 id grid resolves straight to the pooled RESULT_OR_TOTAL
 * market's six-way selection code — same {home,away} x {over,under} layout
 * as FORTUNA_TEAM_SCOPED_ID_SIDE above, just merged with the over/under leg
 * each id represents.
 */
const FORTUNA_RESULT_OR_TOTAL_ID_COMBO: Record<string, NormalizedSelection> = {
  "ufo:mtyp:00-7b": "HOME_OVER",
  "ufo:mtyp:00-7c": "HOME_UNDER",
  "ufo:mtyp:00-7d": "AWAY_OVER",
  "ufo:mtyp:00-7e": "AWAY_UNDER",
};

// Side-directional codes: when the market name resolves to the opposite team
// (Fortuna's id->side pairing is positional), flip to the counterpart code.
const FORTUNA_SIDED_CODE_FLIP: Partial<
  Record<NormalizedMarketType, { side: "HOME" | "AWAY"; counterpart: NormalizedMarketType }>
> = {
  HOME_TEAM_TOTAL_GOALS: { side: "HOME", counterpart: "AWAY_TEAM_TOTAL_GOALS" },
  AWAY_TEAM_TOTAL_GOALS: { side: "AWAY", counterpart: "HOME_TEAM_TOTAL_GOALS" },
  HALF_TIME_HOME_TEAM_TOTAL_GOALS: { side: "HOME", counterpart: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS" },
  HALF_TIME_AWAY_TEAM_TOTAL_GOALS: { side: "AWAY", counterpart: "HALF_TIME_HOME_TEAM_TOTAL_GOALS" },
  SECOND_HALF_HOME_TEAM_TOTAL_GOALS: { side: "HOME", counterpart: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS" },
  SECOND_HALF_AWAY_TEAM_TOTAL_GOALS: { side: "AWAY", counterpart: "SECOND_HALF_HOME_TEAM_TOTAL_GOALS" },
  HOME_TEAM_TOTAL_FOULS: { side: "HOME", counterpart: "AWAY_TEAM_TOTAL_FOULS" },
  AWAY_TEAM_TOTAL_FOULS: { side: "AWAY", counterpart: "HOME_TEAM_TOTAL_FOULS" },
  HOME_TEAM_TOTAL_OFFSIDES: { side: "HOME", counterpart: "AWAY_TEAM_TOTAL_OFFSIDES" },
  AWAY_TEAM_TOTAL_OFFSIDES: { side: "AWAY", counterpart: "HOME_TEAM_TOTAL_OFFSIDES" },
};

/** Splits a Fortuna combo selection ("Remis/Tak", "10 / +2.5") at the first slash. */
function splitFortunaCombo(name: string): [string, string] | null {
  const idx = name.indexOf("/");
  if (idx <= 0 || idx >= name.length - 1) return null;
  return [name.slice(0, idx).trim(), name.slice(idx + 1).trim()];
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

/**
 * Extracts the line from "więcej niż 2" / "mniej niż 2" selection labels.
 * Fortuna also quotes the short form without "niż" ("więcej 1" / "mniej 1").
 */
function parseFortunaThresholdLine(selectionNames: string[]): string | undefined {
  for (const name of selectionNames) {
    const normalized = normalizeMarketName(name);
    const match = normalized.match(/^(?:wiecej|mniej)(?:\s+niz)?\s+(\d+(?:[.,]\d+)?)/);
    if (match) return match[1].replace(",", ".");
  }
  return undefined;
}

/**
 * True when a raw selection label is a draw leg. Fortuna labels it "Remis",
 * "X" or "Równo" ("even"), optionally decorated with the handicap score
 * ("Równo (3:0)"); match on the diacritics-stripped form.
 */
function isFortunaDrawLabel(name: string): boolean {
  return /^(x\b|remis|rowno)/.test(normalizeMarketName(name.trim()));
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
  if (isFortunaDrawLabel(trimmed)) return "DRAW";

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
  playerName?: string,
  teamSide?: "HOME" | "AWAY"
): NormalizedSelection {
  const trimmed = selName.trim();

  // Per-player dropdown markets: the player (from the market name) is
  // already carried as the market PARAMETER (see paramValue below /
  // isPlayerMarket), so the SELECTION code must be the catalog's generic
  // code ("PLAYER" / "PLAYER_NAME"), not the player name again. Peers
  // (betcris/betfan/etoto/fuksiarz/lvbet/sts/superbet) all emit that
  // generic code with the player in the parameter; repeating the name here
  // instead left every Fortuna quote in a private per-player selection
  // vocabulary that never shared a comparison row with its peers
  // (/audit-match Arsenal vs Coventry City: GOALSCORER_FIRST/LAST,
  // PLAYER_HEADER_GOAL and PLAYER_GOAL_OR_ASSIST all showed 20+ Fortuna
  // player names as selection types with 20+ matching selection_gaps
  // flags). Must run before the literal passthrough — some of these
  // markets list "1+"/"Tak" in the catalog, which would otherwise swallow
  // the player identity.
  if (FORTUNA_PLAYER_DROPDOWN_MARKETS.has(marketCode)) {
    const dropdownEntry = getMarketByCode(marketCode);
    const canonicalCode =
      dropdownEntry?.hasParameter && dropdownEntry.parameterType === "player"
        ? dropdownEntry.selections?.[0]
        : undefined;
    if (playerName && canonicalCode) return canonicalCode as NormalizedSelection;
    if (playerName) return playerName as NormalizedSelection;
    return trimmed as NormalizedSelection;
  }

  // Literal catalog-code passthrough: band/range/exact markets often quote
  // raw selection text that IS the catalog selection code ("0-2", "7+", "1+"),
  // and per-market cases below may miss them (falling through to UNKNOWN).
  const literalCatalogCodes = getMarketByCode(marketCode)?.selections;
  if (
    literalCatalogCodes &&
    literalCatalogCodes.length > 0 &&
    literalCatalogCodes.includes(trimmed) &&
    !FORTUNA_PLAYER_YES_MARKETS.has(marketCode)
  ) {
    return trimmed as NormalizedSelection;
  }
  const normalized = normalizeMarketName(trimmed);

  // Per-player stat-line markets: selections are thresholds or Yes/No.
  if (FORTUNA_PLAYER_STAT_MARKETS.has(marketCode)) {
    if (/^\d+\s*\+$/.test(trimmed)) {
      // YES-vocabulary markets (cards, first-or-last goal): "1+" means YES.
      if (FORTUNA_PLAYER_YES_MARKETS.has(marketCode)) {
        return "YES";
      }
      return trimmed.replace(/\s+/g, "") as NormalizedSelection;
    }
    const yesNo = normalizeYesNoSelection(trimmed);
    if (yesNo !== "UNKNOWN") return yesNo;
    return trimmed as NormalizedSelection;
  }

  // Resolves the result leg of combo selections ("Remis", "0", team name).
  const comboSide = (part: string): "HOME" | "DRAW" | "AWAY" | undefined => {
    const p = part.trim();
    if (p === "0" || isFortunaDrawLabel(p)) return "DRAW";
    const side = normalize1x2Selection(p, ctx.homeTeam, ctx.awayTeam, ctx.league);
    return side === "HOME" || side === "AWAY" ? side : undefined;
  };
  // Resolves the over/under leg ("+ 2.5", "- 1.5", "więcej niż 2.5").
  const comboOverUnder = (part: string): "OVER" | "UNDER" | undefined => {
    const p = normalizeMarketName(part);
    if (/^(\+|wiecej|powyzej|ponad)/.test(p)) return "OVER";
    if (/^(-|mniej|ponizej)/.test(p)) return "UNDER";
    return undefined;
  };
  // Resolves the yes/no leg ("Tak", "Nie").
  const comboYesNo = (part: string): "YES" | "NO" | undefined => {
    const yn = normalizeYesNoSelection(part.trim());
    return yn === "YES" || yn === "NO" ? yn : undefined;
  };
  // Resolves the double-chance leg ("10", "02", "12") to the catalog prefix.
  const comboDoubleChance = (part: string): "1X" | "X2" | "12" | undefined => {
    const dc = normalizeDoubleChanceSelection(part.trim());
    if (dc === "HOME_OR_DRAW") return "1X";
    if (dc === "DRAW_OR_AWAY") return "X2";
    if (dc === "HOME_OR_AWAY") return "12";
    return undefined;
  };

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "DRAW_NO_BET":
    case "HALF_TIME_DRAW_NO_BET":
    case "SECOND_HALF_RESULT":
    case "SECOND_HALF_DRAW_NO_BET":
    case "TIME_PERIOD_RESULT":
    case "HT_OR_FT_RESULT":
    // 3-way stat races quote team names plus a "Rowno" ("even") draw leg.
    case "MOST_SHOTS":
    case "MOST_SHOTS_ON_TARGET":
    case "FOUL_RACE":
    case "OFFSIDES_1X2":
    case "CARDS_RACE":
    case "CORNERS_RACE":
      // Some Fortuna result markets label the draw leg "Równo" ("even").
      if (isFortunaDrawLabel(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "TOTAL_GOALS":
    case "TOTAL_GOALS_ASIAN":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
    case "HALF_TIME_HOME_TEAM_TOTAL_GOALS":
    case "HALF_TIME_AWAY_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_HOME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS":
    case "CARDS_TOTAL":
    case "CORNERS_TOTAL":
    case "HALF_TIME_CORNERS_TOTAL":
    case "CORNERS_TEAM":
    case "TOTAL_SHOTS":
    case "TOTAL_SHOTS_ON_TARGET":
    case "TEAM_TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS_ON_TARGET":
    case "FOULS_TOTAL":
    case "HOME_TEAM_TOTAL_FOULS":
    case "AWAY_TEAM_TOTAL_FOULS":
    case "OFFSIDES_TOTAL":
    case "HOME_TEAM_TOTAL_OFFSIDES":
    case "AWAY_TEAM_TOTAL_OFFSIDES":
      // Integer-line phrasing: "więcej niż 2" / "mniej niż 2", also the short
      // form without "niż" ("więcej 1" / "mniej 0,5").
      if (/^wiecej\b/.test(normalized)) return "OVER";
      if (/^mniej\b/.test(normalized)) return "UNDER";
      return normalizeOverUnderSelection(trimmed);

    case "CARDS_TEAM": {
      // Catalog vocabulary is side-prefixed (HOME_OVER, ...); the side comes
      // from the market scope, the selection text only carries the O/U leg.
      const ou = /^wiecej\b/.test(normalized)
        ? "OVER"
        : /^mniej\b/.test(normalized)
          ? "UNDER"
          : normalizeOverUnderSelection(trimmed);
      if (ou === "UNKNOWN" || !teamSide) return "UNKNOWN";
      return `${teamSide}_${ou}` as NormalizedSelection;
    }

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
      return normalizeYesNoSelection(trimmed);

    case "FIRST_GOAL_AND_RESULT": {
      // "1/2" = first goal by team 1 / away win; "Brak goli"/"No goal" -> NONE.
      if (/^(brak goli|nikt|bez gola|no goal)/.test(normalized)) return "NONE";
      const parts = splitFortunaCombo(trimmed);
      if (parts) {
        const first = comboSide(parts[0]);
        const second = comboSide(parts[1]);
        if ((first === "HOME" || first === "AWAY") && second) {
          return `${first}_${second}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME": {
      // "Kolumbia/Kolumbia", "Remis/Szwajcaria" -> AWAY_AWAY, DRAW_HOME
      const parts = splitFortunaCombo(trimmed);
      if (parts) {
        const first = comboSide(parts[0]);
        const second = comboSide(parts[1]);
        if (first && second) return `${first}_${second}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      // "Szwajcaria/Tak", "Remis/Nie" -> HOME_YES, DRAW_NO
      const parts = splitFortunaCombo(trimmed);
      if (parts) {
        const side = comboSide(parts[0]);
        const yn = comboYesNo(parts[1]);
        if (side && yn) return `${side}_${yn}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "RESULT_AND_TOTAL":
    case "HALF_TIME_RESULT_AND_TOTAL":
    case "SECOND_HALF_RESULT_AND_TOTAL": {
      // "Kolumbia/- 2.5", "0/+ 3.5" -> AWAY_UNDER, DRAW_OVER
      const parts = splitFortunaCombo(trimmed);
      if (parts) {
        const side = comboSide(parts[0]);
        const ou = comboOverUnder(parts[1]);
        if (side && ou) return `${side}_${ou}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "TOTAL_GOALS_AND_BTTS": {
      // "Tak/+ 2.5" -> OVER_YES, "Nie/- 2.5" -> UNDER_NO
      const parts = splitFortunaCombo(trimmed);
      if (parts) {
        const yn = comboYesNo(parts[0]);
        const ou = comboOverUnder(parts[1]);
        if (yn && ou) return `${ou}_${yn}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "DOUBLE_CHANCE_TOTAL": {
      // "10 / +2.5" -> 1X_OVER, "02 / -1.5" -> X2_UNDER
      const parts = splitFortunaCombo(trimmed);
      if (parts) {
        const dc = comboDoubleChance(parts[0]);
        const ou = comboOverUnder(parts[1]);
        if (dc && ou) return `${dc}_${ou}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "DOUBLE_CHANCE_BTTS":
    case "SECOND_HALF_DOUBLE_CHANCE_BTTS":
    case "HALF_TIME_DOUBLE_CHANCE_BTTS":
    case "DOUBLE_CHANCE_HALF_TIME_BTTS":
    case "DOUBLE_CHANCE_SECOND_HALF_BTTS": {
      // "10/Tak" -> 1X_YES, "12/Nie" -> 12_NO (same '10|12|02' + '/Tak|/Nie'
      // shape as the full-match variant, just half-scoped)
      const parts = splitFortunaCombo(trimmed);
      if (parts) {
        const dc = comboDoubleChance(parts[0]);
        const yn = comboYesNo(parts[1]);
        if (dc && yn) return `${dc}_${yn}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "MULTI_RESULT": {
      // Space-separated score groups ("1:0 2:0 3:0") -> the catalog's
      // structured GROUP_1_0__2_0__3_0 token; the draw leg maps to "X"; the
      // team-named catch-all ("Francja wygra dowolnym innym wynikiem" - a win
      // by any score not covered by the enumerated score-group buckets) maps
      // to HOME_OTHER/AWAY_OTHER. See normalizeMultiResultSelection.
      if (isFortunaDrawLabel(trimmed)) return "X" as NormalizedSelection;
      const canonical = normalizeMultiResultSelection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
      if (canonical) return canonical;
      return trimmed as NormalizedSelection;
    }

    case "PLAYER_GOAL_AND_RESULT":
    case "WIN_AND_PLAYER_SHOTS_ON_TARGET": {
      // Parlay label doubles as the selection ("Norwegia wygra , Erling
      // Haaland 2+ strzały..."); the catalog selection is the winning side.
      const winner = trimmed.match(/^(.+?)\s+wygra\b/iu);
      if (winner) {
        const side = normalize1x2Selection(
          winner[1].trim(),
          ctx.homeTeam,
          ctx.awayTeam,
          ctx.league
        );
        if (side === "HOME" || side === "AWAY") return side;
      }
      if (/^remis\b/.test(normalized)) return "DRAW";
      return trimmed as NormalizedSelection;
    }

    case "ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "SECOND_HALF_ODD_EVEN_GOALS":
      // Fortuna abbreviates: "Niep." = "Nieparzyste" (odd), "Parz." = "Parzyste"
      // (even). The generic helper only matches the full words.
      if (/^niep/.test(normalized)) return "ODD";
      if (/^parz/.test(normalized)) return "EVEN";
      return normalizeOddEvenSelection(trimmed);

    case "TOTAL_GOALS_MINIMUM":
      // Raw labels are the catalog's own threshold codes: "1+", "2+", "3+"...
      if (/^\d+\s*\+$/.test(trimmed)) {
        return trimmed.replace(/\s+/g, "") as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;

    case "ASIAN_HANDICAP":
    case "ASIAN_HANDICAP_PUSH":
    case "ASIAN_HANDICAP_3WAY":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP_PUSH":
    case "CORNERS_HANDICAP":
      return normalizeFortunaHandicapSelection(trimmed, ctx);

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      if (score) return score as NormalizedSelection;
      // Fortuna labels the catch-all outcome "inny"/"pozostałe" — align with
      // the canonical OTHER code peers (betclic, etoto) use for the same
      // score-grid column instead of leaking raw Polish text.
      if (normalized === "inny" || normalized === "inny wynik" || normalized === "pozostale") {
        return "OTHER" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HALF_TIME_HOME_EXACT_CORNERS":
    case "HALF_TIME_AWAY_EXACT_CORNERS":
      // Genuine range/count labels ("0-1", "2", "3", "4+", ...) are already
      // handled by the literal-catalog-code passthrough above. Fortuna
      // bundles a separate "which team gets more 1st-half corners" prop
      // (a leaked team-name selection) into the same raw entry; that label
      // isn't part of this count-based market's vocabulary and must not be
      // coerced into a spurious HOME/AWAY code via the generic 1X2 fallback
      // below (audit cluster #11).
      return "UNKNOWN";

    case "GOAL_RANGE":
    case "MULTI_GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
      // Ranges arrive in canonical dash format ("1-2", "3-5") or as "6+"/"0"
      if (/^\d+\s*-\s*\d+$/.test(trimmed)) {
        return trimmed.replace(/\s+/g, "") as NormalizedSelection;
      }
      // "Nikt" ("nobody scores") is the zero-goals band, canonical code "0".
      if (/^(nikt|zaden|zadna|brak gola|bez gola|nie padnie)/.test(normalized)) {
        return "0" as NormalizedSelection;
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
    case "FIRST_CARD":
    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
      if (/^(nikt|zaden|zadna|bez gola|brak gola|nie padnie)/.test(normalized)) {
        return "NONE";
      }
      if (/^obie/.test(normalized)) return "BOTH" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
      // "Pierwszy/Pierwsza", "Drugi/Druga", "Rowno/Równo" — canonical
      // 1ST_HALF/2ND_HALF/DRAW (audit-loop minor cluster #1).
      if (/^pierwsz/.test(normalized)) return "1ST_HALF" as NormalizedSelection;
      if (/^drug/.test(normalized)) return "2ND_HALF" as NormalizedSelection;
      if (/^(rown|remis)/.test(normalized)) return "DRAW" as NormalizedSelection;
      return trimmed as NormalizedSelection;

    case "BTTS_BY_HALF": {
      const compact = normalized.replace(/\s*\/\s*/g, "/");
      if (compact === "tak/tak") return "BOTH" as NormalizedSelection;
      if (compact === "tak/nie") return "1ST_HALF" as NormalizedSelection;
      if (compact === "nie/tak") return "2ND_HALF" as NormalizedSelection;
      if (compact === "nie/nie") return "NONE" as NormalizedSelection;
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

    // Fortuna only ever reaches these six codes via the clean-sheet router
    // above ("{opponent} nie straci gola" -> this side's TO_SCORE) — it has
    // no other raw market for HOME/AWAY_TEAM_TO_SCORE or the half-scoped
    // variants, so inverting unconditionally here is safe (audit cluster
    // #0, findings 3/4). Clean sheet YES (opponent concedes nothing) means
    // THIS side did NOT score.
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "HALF_TIME_HOME_TO_SCORE":
    case "HALF_TIME_AWAY_TO_SCORE":
    case "SECOND_HALF_HOME_TO_SCORE":
    case "SECOND_HALF_AWAY_TO_SCORE": {
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo === "YES") return "NO";
      if (yesNo === "NO") return "YES";
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

/** Negates a signed handicap line string ("-1.5" -> "+1.5", "+0" -> "0"). */
function negateHandicapLine(line: string): string {
  const value = -parseFloat(line);
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `${value}`;
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  const groupName = raw.groupName ?? "";
  // Never mine digits out of leaked internal ids ("Rynek ufo:mtyp:00-37").
  const nameForParsing = isPlaceholderMarketName(raw.name) ? "" : raw.name;

  // The threshold already lives in the selection codes ("1+", "2+", ...); mining
  // a parameter here only splits one market into phantom per-param buckets.
  if (marketCode === "TOTAL_GOALS_MINIMUM") return undefined;

  // Quarter sub-markets ("2.kwarta" = segment between hydration breaks) use a
  // quarter index, not a start minute. Prefix with "q" so the values never
  // collide with the start-minute scale used by other bookmakers on this axis.
  if (marketCode === "TIME_PERIOD_RESULT") {
    const quarter = normalizeMarketName(nameForParsing).match(/^(\d+)\s*\.?\s*kwart/);
    if (quarter) return `q${quarter[1]}`;
  }

  switch (metadata.parameterType) {
    case "handicap": {
      const scoreStyle =
        parseScoreStyleHandicap(selectionNames) ??
        parseScoreStyleHandicap([nameForParsing]);
      if (scoreStyle) return scoreStyle;

      // The parameter is the HOME-perspective line, but Fortuna orders the
      // two legs arbitrarily ("Kolumbia -1" may come first). Resolve each
      // leg's side and negate away-side lines — taking the first parseable
      // line regardless of side swapped params on roughly half the rows.
      for (const sel of raw.selections) {
        const side = normalizeFortunaHandicapSelection(sel.name, ctx);
        if (side !== "HOME" && side !== "AWAY") continue;
        const line = parseHandicapLine(sel.name);
        if (!line) continue;
        return side === "HOME" ? line : negateHandicapLine(line);
      }

      return parseHandicapLine(nameForParsing) ?? parseHandicapLine(groupName);
    }

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

    // "Wynik meczu lub 2 gol(e) przewagi" (result OR a 2-goal lead at any point)
    // settles differently from plain 1X2, and its 3-way shape does not fit the
    // 2-way WIN_OR_WIN_BY_2 catalog code either. Exclude — never route to
    // MATCH_WINNER even though the odds look 1X2-like.
    if (/^wynik meczu lub/.test(normalizeMarketName(raw.name))) {
      return null;
    }

    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" = "id";

    if (marketId && marketId in FORTUNA_MARKET_ID_TO_CODE) {
      marketCode = FORTUNA_MARKET_ID_TO_CODE[marketId];
    }

    if (!marketCode) {
      matchedBy = "name";
      // "1.połowa: <team> przedział rzutów rożnych" (a per-team, half-scoped
      // corner range) has no stable marketTypeId observed in this fixture's
      // payload; route by name so it doesn't fall through to the generic
      // OTHER bucket, which merges it with unrelated proposition markets.
      // audit-match cluster #11: its "0-1"/"2"/"3"/"4+" vocabulary is the
      // SAME grouped exact-corners scheme betclic/betfan/etoto/forbet/
      // fuksiarz/sts already pool under HALF_TIME_HOME/AWAY_EXACT_CORNERS —
      // route straight into those by detected team side instead of the
      // standalone HALF_TIME_CORNERS_TEAM_RANGE code, whose different
      // ("0","1","2","3+",...) vocabulary silently dropped the exact "3"
      // price as UNKNOWN and left fortuna isolated from that 6-bookmaker pool.
      const isHalfTimeCornerRange =
        /przedzia[łl]\s+rzut[oó]w\s+ro[żz]nych/iu.test(raw.name) &&
        /^\s*1\s*\.?\s*po[łl]owa\s*:/iu.test(raw.name);
      let halfTimeCornerRangeCode: NormalizedMarketType | null = null;
      if (isHalfTimeCornerRange) {
        const side = resolveFortunaHalfTimeCornerRangeSide(raw.name, ctx);
        halfTimeCornerRangeCode =
          side === "HOME"
            ? "HALF_TIME_HOME_EXACT_CORNERS"
            : side === "AWAY"
              ? "HALF_TIME_AWAY_EXACT_CORNERS"
              : null;
      }
      marketCode = findMarketCodeFromName(raw.name) ?? halfTimeCornerRangeCode;
    }

    if (!marketCode) {
      console.warn(`[fortuna] Unknown market: "${raw.name}" (id: ${marketId ?? "none"})`);
      return null;
    }

    // Fortuna's handicap marketTypeIds (00-0b/00-0h/00-re) are reused across
    // fixtures for both goal handicaps and corner handicaps; the live name
    // ("Mecz: liczba rzutów rożnych handicap") is authoritative over a stale
    // id assumption — never price a corners handicap into the goal-handicap
    // ASIAN_HANDICAP bucket.
    if (marketCode === "ASIAN_HANDICAP" && /rzut(?:[oó]w)?\s+ro[żz]nych/iu.test(raw.name)) {
      marketCode = "CORNERS_HANDICAP";
    }

    // A "2-way" handicap quoting a draw outcome is actually a 3-way handicap;
    // keep the DRAW price instead of polluting the 2-way market with it. The
    // draw label check covers "X"/"Remis"/"Równo" (incl. odds-filtered markets
    // where fewer than 3 selections survived).
    if (
      (marketCode === "ASIAN_HANDICAP" || marketCode === "ASIAN_HANDICAP_PUSH") &&
      (raw.selections.length >= 3 ||
        raw.selections.some((sel) => isFortunaDrawLabel(sel.name)))
    ) {
      marketCode = "ASIAN_HANDICAP_3WAY";
    }

    // "2.połowa: 1. gol" is a distinct market (first goal of the 2nd half,
    // HOME/AWAY/NONE) bundled under the same id as bare "2.połowa" (who wins
    // the half, HOME/DRAW/AWAY) — see the id-map note above. Forcing it into
    // the 1X2-shaped SECOND_HALF_RESULT can never yield a valid DRAW.
    // Audit /audit-match (premier-league Arsenal vs Coventry City): the live
    // "2.połowa: 1. gol" payload arrives under id 00-2x (MATCH_WINNER), not
    // under 00-2w, so the old code-conditioned reroute never fired and the
    // half-scope rule below turned it into SECOND_HALF_RESULT — a 1X2 market
    // fed with "Nikt / Coventry / Arsenal" first-scorer prices (AWAY 6.0 vs
    // peer median 11.0, "Nikt" mapped to UNKNOWN). Route on the NAME instead,
    // regardless of which id the payload happened to use.
    const firstGoalHalf = raw.name
      .trim()
      .match(/^([12])\s*\.?\s*po[łl]owa\s*:\s*1\s*\.\s*gol\b/iu);
    if (firstGoalHalf) {
      marketCode =
        firstGoalHalf[1] === "2" ? "SECOND_HALF_FIRST_GOAL" : "HALF_TIME_FIRST_GOAL";
    } else if (marketCode === "SECOND_HALF_RESULT" && /1\s*\.\s*gol\b/iu.test(raw.name)) {
      marketCode = "SECOND_HALF_FIRST_GOAL";
    }

    // Scope-stripped name for the team routers below — live Fortuna labels
    // carry a "Mecz:"/"1.połowa:" prefix in front of the team name.
    const scopedName = stripFortunaScope(raw.name);

    // Fortuna reuses some marketTypeIds across scopes/products (verified
    // against this fixture): the id->code static map can hand back a
    // full-match code even when the live payload's name is explicitly scoped
    // to a half. The name is authoritative — reroute to the half-scoped
    // counterpart, or drop the entry when no counterpart exists, instead of
    // silently poisoning full-match best-odds with half-scoped prices.
    if (matchedBy === "id") {
      const halfScope = raw.name.trim().match(/^([12])\s*\.?\s*po[łl]owa\s*:/iu);
      if (halfScope) {
        const isSecondHalf = halfScope[1] === "2";
        if (marketCode === "MATCH_WINNER") {
          const isHandicapStyle = /handicap|\d+\s*:\s*\d+/iu.test(scopedName);
          marketCode = isSecondHalf
            ? isHandicapStyle
              ? "SECOND_HALF_EUROPEAN_HANDICAP"
              : "SECOND_HALF_RESULT"
            : isHandicapStyle
              ? "FIRST_HALF_EUROPEAN_HANDICAP"
              : "HALF_TIME_RESULT";
        } else if (marketCode === "RESULT_AND_TOTAL" && isSecondHalf) {
          marketCode = "SECOND_HALF_RESULT_AND_TOTAL";
        } else if (marketCode === "ASIAN_HANDICAP_PUSH" && isSecondHalf) {
          marketCode = "SECOND_HALF_ASIAN_HANDICAP_PUSH";
        } else if (marketCode === "DOUBLE_CHANCE_BTTS") {
          // Audit /audit-match (Arsenal vs Coventry City): id 00-21 carries the
          // half-scoped "2.połowa: dwójtyp/obie drużyny strzelą gola w
          // 2.połowie" and was filling the full-match DOUBLE_CHANCE_BTTS with
          // second-half prices (1X_YES 4.8 vs peer median 2.55).
          marketCode = isSecondHalf
            ? "SECOND_HALF_DOUBLE_CHANCE_BTTS"
            : "HALF_TIME_DOUBLE_CHANCE_BTTS";
        }
      }
    }

    // Fortuna emits "team half with more goals" for both sides under the same
    // type ids; route by the team named in the market label.
    if (marketCode === "HOME_HALF_WITH_MOST_GOALS") {
      const teamPrefix = scopedName.match(/^(.+?)\s+po[łl]owa\s+z\s+wi[eę]ksz/i);
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

    // Per-team odd/even goals ("W.Ziel.Przyl. Liczba goli P/N", "Kolumbia
    // Liczba goli P/N") is emitted per team; route by the team named in the
    // label, falling back to the side implied by the type id. An unresolvable
    // side must not default to HOME — that poisoned home-team best-odds.
    if (marketCode === "HOME_TEAM_ODD_EVEN_GOALS") {
      let side: NormalizedSelection | undefined;
      const teamPrefix = scopedName.match(/^(.+?)\s+liczba\s+goli\s+p\s*\/\s*n/i);
      if (teamPrefix) {
        side = normalize1x2Selection(
          teamPrefix[1].trim(),
          ctx.homeTeam,
          ctx.awayTeam,
          ctx.league
        );
      }
      if (side !== "HOME" && side !== "AWAY") {
        side = marketId ? FORTUNA_TEAM_SCOPED_ID_SIDE[marketId] : undefined;
      }
      if (side === "AWAY") marketCode = "AWAY_TEAM_ODD_EVEN_GOALS";
      else if (side !== "HOME") return null;
    }

    // "X nie straci gola" (won't concede) is a per-team YES/NO clean-sheet
    // prop, not the HOME/AWAY comparison TEAM_CLEAN_SHEET. Route by team —
    // and to the OPPOSING side's TEAM_TO_SCORE code, not a dedicated
    // CLEAN_SHEET code (retired: audit cluster #0, findings 3/4 — "{team}
    // won't concede" is the same bet as "opponent won't score", and fortuna
    // had no other source for HOME/AWAY_TEAM_TO_SCORE to collide with). The
    // selection-normalizer default case below inverts YES/NO accordingly.
    if (marketCode === "TEAM_CLEAN_SHEET") {
      const teamPrefix = scopedName.match(/^(.+?)\s+-?\s*nie\s+straci\s+gola/i);
      if (!teamPrefix) return null;
      const side = normalize1x2Selection(
        teamPrefix[1].trim().replace(/\s*-$/, ""),
        ctx.homeTeam,
        ctx.awayTeam,
        ctx.league
      );
      if (side === "HOME") marketCode = "AWAY_TEAM_TO_SCORE";
      else if (side === "AWAY") marketCode = "HOME_TEAM_TO_SCORE";
      else return null;
    }

    // "X wygra mecz" (Tak/Nie) is the two-way team-wins prop etoto/forbet
    // quote as TEAM_WIN_MATCH with a HOME/AWAY parameter. Fortuna splits it
    // into two positional ids (00-38 first team, 00-36 second team) that
    // were mapped to two separate parameterless codes (TEAM_WIN /
    // TEAM_WINS_MATCH), so the UI rendered two ambiguous cards ("Drużyna
    // wygra mecz" - which team?) and fortuna's quotes never merged into the
    // shared TEAM_WIN_MATCH comparison rows (market-display audit). Route
    // both ids into TEAM_WIN_MATCH with the side as the parameter.
    let teamWinMatchSide: "HOME" | "AWAY" | undefined;
    if (marketCode === "TEAM_WIN" || marketCode === "TEAM_WINS_MATCH") {
      const teamPrefix = scopedName.match(/^(.+?)\s+wygra\s+mecz/i);
      if (!teamPrefix) return null;
      const side = normalize1x2Selection(
        teamPrefix[1].trim(),
        ctx.homeTeam,
        ctx.awayTeam,
        ctx.league
      );
      if (side !== "HOME" && side !== "AWAY") return null;
      marketCode = "TEAM_WIN_MATCH";
      teamWinMatchSide = side;
    }

    // Side-directional team codes (team goals/fouls/offsides): flip to the
    // counterpart code when the label names the opposite team — the id->side
    // pairing is positional and the label is authoritative.
    const sidedFlip = FORTUNA_SIDED_CODE_FLIP[marketCode];
    if (sidedFlip) {
      const nameSide = resolveFortunaTeamSide(raw.name, ctx);
      if (nameSide && nameSide !== sidedFlip.side) {
        marketCode = sidedFlip.counterpart;
      }
    }

    // Side-in-parameter team markets (CORNERS_TEAM, TEAM_TOTAL_SHOTS[_ON_
    // TARGET]) and side-in-selection CARDS_TEAM need a resolved team side.
    let teamSide: "HOME" | "AWAY" | undefined;
    if (FORTUNA_TEAM_LINE_PARAM_MARKETS.has(marketCode) || marketCode === "CARDS_TEAM") {
      teamSide =
        resolveFortunaTeamSide(raw.name, ctx) ??
        (marketId ? FORTUNA_TEAM_SCOPED_ID_SIDE[marketId] : undefined);
      // Without a side the entry would collide across teams — drop it.
      if (!teamSide) return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[fortuna] Market code "${marketCode}" not in catalog`);
      return null;
    }

    // Cluster #3 (RESULT_OR_TOTAL fragmentation): unlike superbet's single
    // raw market that already lists all six HOME_OVER/DRAW_UNDER/etc.
    // selections together, fortuna quotes each team x direction leg as its
    // OWN two-way Tak/Nie market ("Arsenal wygra / powyżej 2.5 goli":
    // Tak/Nie). Only the "Tak" price is the six-way selection's price; "Nie"
    // has no counterpart in that vocabulary — mapping it through the generic
    // per-selection path below would collide all four raw entries' "Nie"
    // prices onto one meaningless shared "NO" code (first-quote-wins dedup
    // in the grouper), so it is filtered out here instead.
    if (marketCode === "RESULT_OR_TOTAL") {
      const combo = marketId ? FORTUNA_RESULT_OR_TOTAL_ID_COMBO[marketId] : undefined;
      const yesSelection = raw.selections.find((sel) =>
        /^tak\b/.test(normalizeMarketName(sel.name))
      );
      if (!combo || !yesSelection) {
        console.warn(
          `[fortuna] RESULT_OR_TOTAL: could not resolve combo/Tak leg for "${raw.name}" (id: ${marketId ?? "none"})`
        );
        return null;
      }
      const paramValue = extractParamValue(marketCode, raw, ctx);
      const marketKey = buildMarketKey(marketCode, paramValue);
      return {
        marketCode,
        paramValue,
        marketKey,
        selections: [{ code: combo, label: yesSelection.name, odds: yesSelection.odds }],
        debug: {
          rawName: raw.name,
          rawId: marketId ?? undefined,
          matchedBy,
        },
      };
    }

    // Per-player OPTA markets carry the player only in the market name.
    const isPlayerMarket =
      FORTUNA_PLAYER_STAT_MARKETS.has(marketCode) ||
      FORTUNA_PLAYER_DROPDOWN_MARKETS.has(marketCode);
    const playerName = isPlayerMarket ? extractFortunaPlayerName(raw.name, ctx) : undefined;

    // Parlay-style player markets carry the player (and the shots tier) in
    // the natural-order label: "Norwegia wygra , Erling Haaland 2+ strzały w
    // światło bramki". The player (+tier) becomes the parameter so different
    // players/tiers never merge into one bucket.
    let parlayPlayerParam: string | undefined;
    if (
      marketCode === "PLAYER_GOAL_AND_RESULT" ||
      marketCode === "WIN_AND_PLAYER_SHOTS_ON_TARGET"
    ) {
      const parlay = raw.name.match(
        /wygra\s*,\s*(.+?)(?:\s+(\d+\+))?\s+(?:strzeli|strza[lł])/iu
      );
      if (parlay) {
        parlayPlayerParam =
          canonicalizeFortunaPlayerName(parlay[1].trim()) + (parlay[2] ? ` ${parlay[2]}` : "");
      }
    }

    // Player markets (both stat-line AND dropdown shape, e.g. GOALSCORER_*)
    // use the player as the market parameter. Checking isPlayerMarket here
    // (not just FORTUNA_PLAYER_STAT_MARKETS) matters: playerName IS already
    // extracted for FORTUNA_PLAYER_DROPDOWN_MARKETS too (see isPlayerMarket
    // above), but was previously discarded here, so every dropdown-shaped
    // market's rows collapsed into an unlabeled "base" bucket instead of one
    // row per player despite the selection itself already carrying the
    // correct player name.
    let paramValue =
      parlayPlayerParam ??
      (playerName && isPlayerMarket ? playerName : extractParamValue(marketCode, raw, ctx));

    // TEAM_WIN_MATCH is parameterized by team side (see the 00-36/00-38
    // router above) - without this, both teams' rows would share the bare
    // "TEAM_WIN_MATCH" key and storage would silently keep only one.
    if (teamWinMatchSide) {
      paramValue = teamWinMatchSide;
    }

    // Side-in-parameter team markets combine the side with the numeric line
    // ("HOME:4.5") so home/away lines never collide on the market key.
    // CARDS_TEAM keeps its side-prefixed selection codes, but the param must
    // also be side-scoped — storage dedupes rows by market key, so a bare
    // "CARDS_TEAM:1.5" key would silently drop one team's line.
    if (
      (FORTUNA_TEAM_LINE_PARAM_MARKETS.has(marketCode) || marketCode === "CARDS_TEAM") &&
      teamSide
    ) {
      if (!paramValue) return null;
      paramValue = `${teamSide}:${paramValue}`;
    }

    // audit cluster #12: fortuna's OVER_UNDER marketTypeId spans the whole
    // 0.5..5.5 ladder with no push/no-push distinction up front — reroute the
    // bare-integer rows (no push-risk half lines) to TOTAL_GOALS_ASIAN so
    // they pool with every other bookmaker's whole-number lines there
    // instead of fragmenting the "line 1" card.
    {
      const rerouted = rerouteWholeGoalLineToAsian(marketCode, paramValue);
      marketCode = rerouted.marketCode as NormalizedMarketType;
      paramValue = rerouted.paramValue;
    }

    const marketKey = buildMarketKey(marketCode, paramValue);

    const selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx, playerName, teamSide),
      label: sel.name,
      odds: sel.odds,
    }));

    // Two-way handicaps: when exactly one side failed team matching, infer it
    // from the resolved side (Fortuna heavily abbreviates team names).
    if (
      (marketCode === "ASIAN_HANDICAP" ||
        marketCode === "ASIAN_HANDICAP_PUSH" ||
        marketCode === "FIRST_HALF_ASIAN_HANDICAP" ||
        marketCode === "SECOND_HALF_ASIAN_HANDICAP_PUSH" ||
        marketCode === "CORNERS_HANDICAP") &&
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
      (marketCode === "EUROPEAN_HANDICAP" ||
        marketCode === "ASIAN_HANDICAP_3WAY" ||
        marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" ||
        marketCode === "SECOND_HALF_EUROPEAN_HANDICAP") &&
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

    // Handicap markets admit only HOME/DRAW/AWAY. Any selection that still
    // failed side resolution (e.g. a lone leg surviving the odds filter at an
    // extreme line like -8.5) is dropped instead of emitted as UNKNOWN, where
    // it would pollute cross-bookmaker comparisons.
    let finalSelections = selections;
    if (
      marketCode === "ASIAN_HANDICAP" ||
      marketCode === "ASIAN_HANDICAP_PUSH" ||
      marketCode === "ASIAN_HANDICAP_3WAY" ||
      marketCode === "EUROPEAN_HANDICAP" ||
      marketCode === "FIRST_HALF_ASIAN_HANDICAP" ||
      marketCode === "FIRST_HALF_EUROPEAN_HANDICAP" ||
      marketCode === "SECOND_HALF_EUROPEAN_HANDICAP" ||
      marketCode === "SECOND_HALF_ASIAN_HANDICAP_PUSH" ||
      marketCode === "CORNERS_HANDICAP" ||
      // Drops the bundled "corners race" garbage rows (see the UNKNOWN case
      // above) so only genuine range/count selections reach the output.
      marketCode === "HALF_TIME_HOME_EXACT_CORNERS" ||
      marketCode === "HALF_TIME_AWAY_EXACT_CORNERS"
    ) {
      finalSelections = selections.filter((sel) => sel.code !== "UNKNOWN");
      if (finalSelections.length === 0) return null;
    }

    return {
      marketCode,
      paramValue,
      marketKey,
      selections: finalSelections,
      debug: {
        rawName: raw.name,
        rawId: marketId ?? undefined,
        matchedBy,
      },
    };
  },

};

export default fortunaNormalizer;
