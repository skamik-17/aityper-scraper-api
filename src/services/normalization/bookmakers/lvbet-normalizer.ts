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
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  parseScoreSelection,
  parseHtFtSelection,
  canonicalizePlayerName,
  canonicalizePlayerComboSelection,
} from "../helpers/index.js";
import { getMarketMetadata, isValidMarketCode, getMarketByCode } from "../../../data/market-catalog.js";
import { matchToCanonical } from "../../../utils/team-matcher.js";

const LVBET_MARKET_ID_TO_CODE: Record<number, NormalizedMarketType> = {};

const LVBET_MARKET_NAME_TO_CODE: Record<string, NormalizedMarketType> = {
  "zwyciezca meczu": "MATCH_WINNER",
  "wynik meczu": "MATCH_WINNER",
  "podwojna szansa": "DOUBLE_CHANCE",
  "remis = zwrot": "DRAW_NO_BET",
  "dokładny wynik": "CORRECT_SCORE",
  "obie druzyny strzela gola": "BTTS",
  "obie druzyny strzela": "BTTS",
  "parzyste / nieparzyste": "ODD_EVEN_GOALS",
  "suma goli": "TOTAL_GOALS",
  "liczba goli": "TOTAL_GOALS",
  "azjatycka suma goli": "TOTAL_GOALS_ASIAN",
  "1. połowa - wynik": "HALF_TIME_RESULT",
  "2. połowa - wynik": "SECOND_HALF_RESULT",
};

const LVBET_MARKET_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  { pattern: /dokładny wynik/, code: "CORRECT_SCORE" },
  // "Mix szans" is lvbet's 30-selection combo/parlay product (e.g. "Arsenal
  // wygra lub powyżej 2.5 goli", "Remis lub poniżej 3,5 goli") — none of its
  // selections are plain double-chance picks (audit-match, Arsenal vs
  // Coventry City, WYNIK_MECZU/DOUBLE_CHANCE index 44). It used to collide
  // with the "podwojna szansa"/"dwojtyp" alternation below via the shared
  // "mix szans" substring, forcing all 30 combo selections into UNKNOWN
  // under DOUBLE_CHANCE (plus letting three unrelated stale DB rows —
  // "Arsenal lub remis"/"Arsenal lub Coventry City"/"Coventry City lub
  // remis", not present in any current lvbet raw market — surface as a
  // fabricated HOME_OR_DRAW/HOME_OR_AWAY/DRAW_OR_AWAY set). No catalog code
  // exists for this parlay shape — exclude it. Must run before the generic
  // alternation, which would otherwise still match "mix szans".
  { pattern: /^mix szans$/, code: "OTHER" },
  { pattern: /podwojna szansa|dwojtyp/, code: "DOUBLE_CHANCE" },
  { pattern: /remis = zwrot|zaklad bez/, code: "DRAW_NO_BET" },
  { pattern: /obie druzyny strzela/, code: "BTTS" },
  { pattern: /parzyste|nieparzyst/, code: "ODD_EVEN_GOALS" },
  { pattern: /zwyciezca meczu|wynik meczu|zwyciezca/, code: "MATCH_WINNER" },
  // Full-match goal-range brackets (audit-match, Arsenal vs Coventry City,
  // round 8) — anchored end-to-end so half-/team-scoped variants ("2. Połowa
  // - Dokładna liczba goli (przedział)", "Arsenal - Liczba goli (przedziały)")
  // stay on their own already-handled routes instead of collapsing here.
  // Two DIFFERENT products share the "przedział(y)" wording: "Dokładna
  // liczba goli (przedział)" is a disjoint exhaustive band scale (0-1/2-3/
  // 4-6/7+, implied probs sum to ~1) — catalog code GOAL_RANGE. "Suma goli
  // (przedziały)" is a cumulative multi-goal ladder (1-2/1-3/.../7+,
  // overlapping ranges, implied probs sum well above 1) — catalog code
  // MULTI_GOAL_RANGE. Must run BEFORE the generic TOTAL_GOALS catch-all
  // below, which used to swallow both (their selections don't map to
  // OVER/UNDER, so they fell into rawUnclaimed).
  { pattern: /^dokładna liczba goli \(przedział\)$/, code: "GOAL_RANGE" },
  { pattern: /^suma goli \(przedziały\)$/, code: "MULTI_GOAL_RANGE" },
  // Two more DIFFERENT products share generic "liczba goli"/"bramek" wording
  // with the plain 2-way Total Goals market and used to be swallowed by the
  // catch-all below (audit-match, Arsenal vs Coventry City, GOLE/TOTAL_GOALS
  // index 10): "Liczba goli 3-drogowo (regulaminowy czas) N" is a genuine
  // 3-way (Powyżej/Dokładnie/Poniżej) exact-goals-count market for line N —
  // catalog code TOTAL_GOALS_3WAY (mirrors betcris' identical raw shape).
  // "Wynik i liczba bramek w meczu N" is a match-result + total-goals combo
  // (12 selections: 3 sides x over/under x plain/double-chance) — catalog
  // code RESULT_AND_TOTAL covers only the plain 3-side x over/under half (the
  // extra double-chance legs are dropped in normalizeSelectionForMarket).
  // Both must run BEFORE the generic TOTAL_GOALS catch-all, which used to
  // force-fit their selections into a 2-way OVER/UNDER slot, leaving a
  // spurious UNKNOWN selection and understating the true 2-way probability.
  { pattern: /^liczba goli 3-drogowo\b/, code: "TOTAL_GOALS_3WAY" },
  { pattern: /^wynik i liczba bramek w meczu\b/, code: "RESULT_AND_TOTAL" },
  { pattern: /suma goli|liczba goli|dokładna liczba goli|gole|bramek/, code: "TOTAL_GOALS" },
];

// Audited name-pattern -> code mappings.
// LVBET exposes no stable market id, so markets are recognized purely by their
// (normalized: lowercased, diacritics-stripped, whitespace-collapsed) name.
// Each pattern anchors on the STABLE phrase of a market and generalizes embedded
// team/player names and over/under lines. Order matters: more specific patterns
// MUST appear before generic catch-alls within the same family.
const LVBET_AUDIT_NAME_PATTERNS: Array<{ pattern: RegExp; code: NormalizedMarketType }> = [
  // --- Time-period stats (must precede generic corner/throw-in families) ---
  // A prior special case routed ONLY the "…Rzuty rożne 0.5" line to the
  // param-less TIME_PERIOD_CORNERS_TOTAL catalog code (hasParameter: false —
  // it can hold exactly one line). LVBet actually publishes TWO first-10-min
  // corner lines (0.5 AND 1.5) — the 1.5 line already fell through to the
  // generic FIRST_10_MIN_CORNERS_TOTAL pattern below (hasParameter: true,
  // decimal — built for exactly this multi-line ladder, and where betcris/
  // superbet already publish their own 0.5/1.5 lines). Force-fitting only
  // the 0.5 line into the param-less sibling code silently dropped the 1.5
  // line and left the surviving entry's own parameter value/label blank
  // (audit-match, Arsenal vs Coventry City, STATYSTYKI/
  // TIME_PERIOD_CORNERS_TOTAL index 370). Worse, being unanchored past
  // "pierwsze 10 minut", the same special case ALSO caught the raw name's
  // TEAM-SCOPED variant ("Pierwsze 10 minut (…) - <Team>: Rzuty rożne 0.5")
  // before the team-scope exclusion below could run, leaking a team's own
  // corners prop into the match-total market. Removing the special case
  // lets every "…rzuty rozne" shape — match-total AND team-scoped — reach
  // its correct existing route below (FIRST_10_MIN_CORNERS_TOTAL with a
  // real parameter, or OTHER for the team-scoped exclusion).
  { pattern: /pierwsze 10 minut.*wrzuty z autu/, code: "FIRST_PERIOD_THROW_INS" },
  // Team-scoped 10-minute corner props ("Pierwsze 10 minut (…) - Kolumbia:
  // Rzuty rożne") have no catalog code — exclude them instead of letting
  // them contaminate the match-total FIRST_10_MIN_CORNERS_TOTAL.
  { pattern: /pierwsze 10 minut.*\) - .*: rzuty rozne/, code: "OTHER" },
  { pattern: /pierwsze 10 minut.*rzuty rozne/, code: "FIRST_10_MIN_CORNERS_TOTAL" },

  // --- Time-window handicaps ("1-75 min. - Handicap") ---
  // These must never reach the generic goal-handicap family: the minute
  // window used to be parsed as the handicap line, producing absurd
  // ASIAN_HANDICAP params (-15/-30/-60/-75). Only the 1-15 min window has a
  // catalog code; the wider windows are excluded until codes exist.
  { pattern: /^1\s*-\s*15\s*min\b.*handicap|^handicap.*\b1\s*-\s*15\s*min\b/, code: "FIRST_15_MIN_HANDICAP" },
  { pattern: /^\d+\s*-\s*\d+\s*min\b.*handicap|^handicap.*\b\d+\s*-\s*\d+\s*min\b/, code: "OTHER" },

  // --- Corners (rzuty rozne) ---
  // Handicap / odd-even / 2nd-half sub-markets must run before the generic
  // corner catch-alls below so they are not swallowed by CORNERS_TEAM.
  { pattern: /rzuty rozne: 1\. połowa.*handicap/, code: "HALF_TIME_CORNERS_HANDICAP" },
  { pattern: /rzuty rozne:.*handicap/, code: "CORNERS_HANDICAP" },
  { pattern: /rzuty rozne:.*(parzyste|nieparzyste)/, code: "CORNERS_ODD_EVEN" },
  { pattern: /rzuty rozne: 2\. połowa - wynik/, code: "SECOND_HALF_CORNERS_RACE" },
  { pattern: /rzuty rozne: 2\. połowa - suma/, code: "SECOND_HALF_CORNERS_TOTAL" },
  { pattern: /rzuty rozne: 2\. połowa/, code: "SECOND_HALF_CORNERS_TEAM" },
  { pattern: /rzuty rozne: 1\. połowa - wynik/, code: "HALF_TIME_CORNERS_RACE" },
  { pattern: /rzuty rozne: 1\. połowa - suma/, code: "HALF_TIME_CORNERS_TOTAL" },
  { pattern: /rzuty rozne: 1\. połowa -/, code: "HALF_TIME_CORNERS_TEAM" },
  { pattern: /rzuty rozne: wyscig do/, code: "CORNERS_RACE_TO" },
  { pattern: /rzuty rozne: suma \(przedział\)/, code: "CORNERS_RANGE" },
  { pattern: /rzuty rozne: suma \(3-drogowo\)/, code: "CORNERS_TOTAL_3WAY" },
  { pattern: /rzuty rozne: suma/, code: "CORNERS_TOTAL" },
  { pattern: /rzuty rozne: wynik/, code: "CORNERS_RACE" },
  { pattern: /rzuty rozne:/, code: "CORNERS_TEAM" },
  { pattern: /pierwszy rzut rozny/, code: "FIRST_CORNER" },
  { pattern: /ostatni rzut rozny/, code: "LAST_CORNER" },
  { pattern: /połowa z najwieksza liczba rzutow roznych/, code: "HALF_WITH_MORE_CORNERS" },

  // --- Fouls (faule) ---
  // Foul handicaps must not fall into the team/total foul buckets.
  { pattern: /faule: 1\. połowa.*handicap/, code: "HALF_TIME_FOULS_HANDICAP" },
  { pattern: /faule:.*handicap/, code: "FOULS_HANDICAP" },
  { pattern: /faule: 1\. połowa - wynik/, code: "HALF_TIME_FOUL_RACE" },
  { pattern: /faule: 1\. połowa - suma/, code: "HALF_TIME_FOULS_TOTAL" },
  { pattern: /faule: 1\. połowa -/, code: "HALF_TIME_TEAM_FOULS" },
  { pattern: /faule: suma/, code: "FOULS_TOTAL" },
  { pattern: /faule:/, code: "TEAM_TOTAL_FOULS" },

  // --- Yellow cards (zołte kartki) ---
  // Card handicaps and odd/even variants are distinct bet types — route them
  // to their dedicated catalog codes before the team/total card buckets.
  { pattern: /zołte kartki - 1\. połowa:.*handicap/, code: "HALF_TIME_CARDS_HANDICAP" },
  { pattern: /zołte kartki - 2\. połowa:.*handicap/, code: "SECOND_HALF_CARDS_HANDICAP" },
  { pattern: /zołte kartki:.*handicap/, code: "CARDS_HANDICAP" },
  { pattern: /zołte kartki:.*(parzyste|nieparzyste)/, code: "CARDS_ODD_EVEN" },
  { pattern: /zołte kartki - 1\. połowa: wynik/, code: "FIRST_HALF_CARDS_1X2" },
  { pattern: /zołte kartki - 1\. połowa: suma/, code: "HALF_TIME_CARDS_TOTAL" },
  { pattern: /zołte kartki - 1\. połowa:/, code: "HALF_TIME_CARDS_TEAM" },
  { pattern: /zołte kartki - 2\. połowa: wynik/, code: "SECOND_HALF_CARDS_1X2" },
  { pattern: /zołte kartki - 2\. połowa: suma/, code: "SECOND_HALF_CARDS_TOTAL" },
  { pattern: /zołte kartki - 2\. połowa:/, code: "SECOND_HALF_CARDS_TEAM" },
  // "Żółte kartki: Wynik" is a yellow-cards-only 1X2 — mapping it into the
  // all-cards CARDS_RACE mixed structurally different products (confirmed
  // odds outlier vs peers). No yellow-only 1X2 catalog code exists yet.
  { pattern: /zołte kartki: wynik/, code: "OTHER" },
  { pattern: /zołte kartki: suma \d+$/, code: "YELLOW_CARDS_TOTAL" },
  { pattern: /zołte kartki: suma/, code: "CARDS_TOTAL" },
  { pattern: /zołte kartki:/, code: "CARDS_TEAM" },
  { pattern: /pierwsza zołta kartka/, code: "FIRST_CARD" },
  { pattern: /ostatnia zołta kartka/, code: "LAST_YELLOW_CARD" },

  // --- Card points ---
  { pattern: /kartki: suma punktow/, code: "CARDS_POINTS_OVER_UNDER" },
  { pattern: /kartki: wynik \(zk/, code: "CARDS_POINTS_1X2" },
  // "Kartki: Handicap punktowy (ŻK - 1p, CzK - 2p)" is a disciplinary-points
  // handicap (yellow=1pt/red=2pt), a different statistic from the goal
  // ASIAN_HANDICAP family it used to fall through to via the generic
  // HANDICAP_PATTERN fallback. The catalog has a dedicated code for it.
  { pattern: /kartki: handicap punktowy/, code: "CARDS_POINTS_HANDICAP" },

  // --- Red cards (czerwona kartka) ---
  { pattern: /czerwone kartki: suma/, code: "RED_CARDS_TOTAL" },
  { pattern: /czerwona kartka: 1\. połowa/, code: "HALF_TIME_RED_CARD" },
  { pattern: /czerwona kartka: 2\. połowa/, code: "SECOND_HALF_RED_CARD" },
  { pattern: /czerwona kartka: (?:belgia|belgium|nowa zelandia|new zealand)/, code: "RED_CARD_TEAM" },
  { pattern: /bezposrednia czerwona kartka/, code: "DIRECT_RED_CARD" },
  { pattern: /rzut karny i czerwona kartka/, code: "RED_CARD_AND_PENALTY" },
  { pattern: /rzut karny lub czerwona kartka/, code: "PENALTY_OR_RED_CARD" },
  { pattern: /obie druzyny otrzymaja czerwona kartke/, code: "BOTH_TEAMS_RED_CARD" },
  { pattern: /zawodnik otrzyma czerwona kartke/, code: "PLAYER_RED_CARD" },

  // --- Penalties ---
  { pattern: /1 połowa: rzut karny/, code: "HALF_TIME_PENALTY_AWARDED" },
  { pattern: /rzut karny w meczu/, code: "PENALTY_AWARDED" },
  { pattern: /strzeli gola z rzutu karnego/, code: "PENALTY_SCORER" },
  { pattern: /strzela karnego/, code: "PENALTY_GOAL" },

  // --- Offsides (spalone) ---
  // Offsides handicap is a prop handicap — it must never fall through to the
  // generic goal ASIAN_HANDICAP family. No catalog code exists for the
  // half-time variant yet, so it is excluded (OTHER) instead of misrouted.
  { pattern: /spalone: [12]\.\s*połowa.*handicap/, code: "OTHER" },
  { pattern: /spalone:.*handicap/, code: "OFFSIDES_HANDICAP" },
  { pattern: /spalone: wynik/, code: "OFFSIDES_1X2" },
  { pattern: /spalone: 1\. spalony/, code: "FIRST_OFFSIDE" },
  { pattern: /spalone: suma/, code: "OFFSIDES_TOTAL" },
  // Team-scoped offsides totals ("Spalone: <Team> suma <line>") used to be
  // hardcoded to the Belgium/New Zealand fixture's team names and matched no
  // other match (round-? audit, Arsenal vs Coventry City: rawUnclaimed).
  // Resolved generically via detectTeamSide in resolveMarketCode instead.

  // --- Shots (strzały) — team/total markets carry a colon after the stat ---
  // Shot handicaps are spread bets, not totals — route them out first. The
  // half-scoped shots-on-target handicap has no catalog code yet.
  { pattern: /strzały celne: [12]\. połowa.*handicap/, code: "OTHER" },
  { pattern: /strzały celne:.*handicap/, code: "SHOTS_ON_TARGET_HANDICAP" },
  { pattern: /strzały: [12]\. połowa.*handicap/, code: "OTHER" },
  { pattern: /strzały:.*handicap/, code: "SHOTS_HANDICAP" },
  // The full-match shots-on-target race ("Strzały celne: Wynik") shares its
  // prefix with the half-scoped variant ("Strzały celne: 1. Połowa - Wynik"),
  // which has no dedicated catalog code yet — route it out first so it never
  // leaks into the full-match MOST_SHOTS_ON_TARGET bucket alongside genuinely
  // full-match peer odds (round-2 audit, Argentina vs Switzerland).
  { pattern: /strzały celne: [12]\. połowa - wynik/, code: "OTHER" },
  { pattern: /strzały celne: wynik/, code: "MOST_SHOTS_ON_TARGET" },
  { pattern: /strzały celne: 1\. strzał celny/, code: "FIRST_SHOT_ON_TARGET" },
  { pattern: /strzały celne: suma/, code: "TOTAL_SHOTS_ON_TARGET" },
  { pattern: /strzały celne:/, code: "TEAM_TOTAL_SHOTS_ON_TARGET" },
  { pattern: /strzały: wynik/, code: "MOST_SHOTS" },
  { pattern: /strzały: suma/, code: "TOTAL_SHOTS" },
  { pattern: /strzały:/, code: "TEAM_TOTAL_SHOTS" },

  // --- Player props (no colon after stat; carry "(must start)" / "(musi rozpoczac" / "zawodnicy") ---
  { pattern: /total shots on target/, code: "PLAYER_SHOTS_ON_TARGET" },
  { pattern: /total shots \(must start\)/, code: "PLAYER_SHOTS" },
  { pattern: /strzały celne \(musi rozpoczac/, code: "PLAYER_SHOTS_ON_TARGET" },
  { pattern: /zawodnicy \(strzały celne\)/, code: "PLAYER_SHOTS_ON_TARGET" },
  { pattern: /strzały \(musi rozpoczac/, code: "PLAYER_SHOTS" },
  // The 7.5 threshold used to be carved out to the PLAYER_SHOTS_OVER
  // PLAYER_DROPDOWN code (audit-match, Arsenal vs Coventry City, round 8 P4):
  // it is NOT a separate product, just another rung of the same PLAYER_SHOTS
  // ladder (parser.ts's splitBulkPlayerListMarket now carries every threshold
  // via market.line, and normalizeLvbetPlayerThreshold below maps "Powyżej
  // 7.5" -> "8+"). Carving it out here dropped every player from that line
  // into a separate, differently-shaped market instead of the shared ladder.
  { pattern: /zawodnicy \(strzały\)/, code: "PLAYER_SHOTS" },
  { pattern: /zawodnicy \(faule popełnione\) - powyzej 3\.5/, code: "PLAYER_FOULS_OVER" },
  { pattern: /zawodnicy \(faule popełnione\)/, code: "PLAYER_FOULS" },
  { pattern: /zawodnicy \(faule zarobione\)/, code: "PLAYER_FOULS_WON" },
  { pattern: /odbiory- tackles/, code: "PLAYER_TACKLES" },
  // Any "powyżej <line>" goalkeeper-saves market shares the same shape
  // (fixed threshold, per-keeper rows) regardless of the specific line — the
  // catalog's dedicated GOALKEEPER_SAVES_OVER code applies to all of them,
  // not just the 2.5 line that used to be hardcoded here.
  { pattern: /obrony bramkarza - powyzej/, code: "GOALKEEPER_SAVES_OVER" },

  // --- Goalscorer markets ---
  // "Podwójna szansa" player combos are two-player OR bets — structurally
  // different from single-player markets; route them to pair codes first.
  { pattern: /strzelec pierwszego gola - podwojna szansa/, code: "ANY_PLAYER_FIRST_GOAL" },
  // Raw label is "Strzelec gola - Podwójna szansa" (matching its sibling
  // "Strzelec gola - Potrójna szansa" below, both using "gola" not "bramki")
  // — the previous "strzelec bramki - podwojna szansa" pattern never matched
  // anything (audit-match, Arsenal vs Coventry City, WYNIK_MECZU/
  // DOUBLE_CHANCE: this dead pattern let all 91 player-pair combo cells fall
  // through to the generic "podwojna szansa" catch-all and pollute the
  // full-match DOUBLE_CHANCE market with an UNKNOWN-typed selection).
  { pattern: /strzelec gola - podwojna szansa/, code: "TWO_PLAYERS_ANYTIME" },
  { pattern: /pierwszy strzelec/, code: "GOALSCORER_FIRST" },
  { pattern: /ostatni strzelec/, code: "GOALSCORER_LAST" },
  { pattern: /strzelec pierwszego gola/, code: "GOALSCORER_FIRST" },
  { pattern: /strzelec ostatniego gola/, code: "GOALSCORER_LAST" },
  { pattern: /strzelec gola - potrojna szansa/, code: "THREE_PLAYERS_ANYTIME" },
  { pattern: /strzelec bramki/, code: "GOALSCORER_ANYTIME" },
  { pattern: /trzech zawodnikow strzeli gola/, code: "ALL_PLAYERS_SCORE" },
  { pattern: /obaj zawodnicy strzela gola/, code: "BOTH_PLAYERS_ANYTIME" },

  // --- Throw-ins (auty) ---
  { pattern: /auty:.*handicap/, code: "THROW_INS_HANDICAP" },
  // "Auty: Wynik" is the throw-ins 1X2, not the goal MATCH_WINNER.
  { pattern: /auty: wynik/, code: "THROW_INS_1X2" },
  // "Auty: 1. Połowa - Suma" is a first-half, BOTH-teams-combined total — a
  // different stat from the full-match TEAM_TOTAL_THROW_INS catch-all below
  // (no team qualifier, no catalog code for the half-scoped combined total
  // yet). Exclude it instead of letting it masquerade as the full-match code.
  { pattern: /auty: 1\. połowa - suma/, code: "OTHER" },
  { pattern: /auty: suma/, code: "THROW_INS_TOTAL" },
  // Team-scoped throw-ins ("Auty: <Team> suma <line>") used to be hardcoded
  // to the Belgium/New Zealand fixture's team names (and to two specific
  // hardcoded lines with distinct, likely-mistaken codes THROW_INS_TEAM /
  // TEAM_THROW_INS instead of the catalog's HOME/AWAY_TEAM_TOTAL_THROW_INS).
  // The generic "auty:" catch-all below already routes every other team-
  // scoped throw-ins market to TEAM_TOTAL_THROW_INS, which
  // refineTeamScopedStatCode then resolves to the correct side via
  // detectTeamSide — verified against the france/morocco golden fixture.
  { pattern: /auty:/, code: "TEAM_TOTAL_THROW_INS" },

  // --- Goal kicks (wybicia od bramki) ---
  { pattern: /wybicia od bramki:.*handicap/, code: "GOAL_KICKS_HANDICAP" },
  // "Wybicia od bramki: 1. Połowa - Suma" is a first-half segment total, not
  // the full-match team total the generic catch-all below represents — no
  // catalog code exists for the half-scoped variant yet.
  { pattern: /wybicia od bramki: 1\. połowa - suma/, code: "OTHER" },
  { pattern: /wybicia od bramki: suma/, code: "GOAL_KICKS_TOTAL" },
  // Team-scoped goal kicks used to be hardcoded to the Belgium/New Zealand
  // fixture's team names AND to specific line values (4.5/7.5/14.5), so they
  // never matched any other match or line. The generic "wybicia od bramki:"
  // catch-all below already routes every team-scoped goal-kicks market to
  // TEAM_GOAL_KICKS, which refineTeamScopedStatCode resolves to the correct
  // side via detectTeamSide — verified against the france/morocco golden fixture.
  { pattern: /wybicia od bramki:/, code: "TEAM_GOAL_KICKS" },

  // --- Half-time / second-half scoring & results (specific phrases) ---
  // Result + BTTS combos must run before the generic "połowa ... wynik" heuristic
  { pattern: /1\. połowa - wynik i obie druzyny strzela/, code: "HALF_TIME_RESULT_AND_BTTS" },
  { pattern: /2\. połowa - wynik i obie druzyny strzela/, code: "SECOND_HALF_RESULT_AND_BTTS" },
  { pattern: /wynik i obie druzyny strzela/, code: "RESULT_AND_BTTS" },
  // "1./2. Połowa - Podwójna szansa" (half-scoped double chance) shares the
  // "podwojna szansa" substring with the generic full-match DOUBLE_CHANCE
  // catch-all (LVBET_MARKET_NAME_PATTERNS, checked only after this list) and
  // used to collide onto it — a genuinely different product (2nd-half-only
  // odds 1.04/1.25/2.55) was overwriting the full-match market's own
  // 1.03/1.09/4.5 (audit-match, Arsenal vs Coventry City, WYNIK_MECZU/
  // DOUBLE_CHANCE). Both catalog codes already exist and share the same
  // selection shape as DOUBLE_CHANCE in normalizeSelectionForMarket.
  { pattern: /1\. połowa - podwojna szansa/, code: "HALF_TIME_DOUBLE_CHANCE" },
  { pattern: /2\. połowa - podwojna szansa/, code: "SECOND_HALF_DOUBLE_CHANCE" },
  // Odd/even goal counts phrased as "Liczba goli: nieparzysta/parzysta" must not
  // fall into the over/under TOTAL_GOALS family
  { pattern: /1\. połowa - liczba goli: nieparzysta/, code: "HALF_TIME_ODD_EVEN_GOALS" },
  { pattern: /2\. połowa - liczba goli: nieparzysta/, code: "SECOND_HALF_ODD_EVEN_GOALS" },
  { pattern: /liczba goli: nieparzysta/, code: "ODD_EVEN_GOALS" },
  // "Gole w obu połowach" is a YES/NO market, not a goals total
  { pattern: /gole w obu połowach/, code: "BOTH_HALVES_GOALS" },
  // "Rezultat i dokładny wynik" is a combined result-or-exact-score YES/NO
  // market with no catalog equivalent — exclude it from CORRECT_SCORE.
  { pattern: /rezultat i dokładny wynik/, code: "OTHER" },
  { pattern: /1\. połowa - dokładny wynik/, code: "HALF_TIME_CORRECT_SCORE" },
  { pattern: /2\. połowa - dokładny wynik/, code: "SECOND_HALF_CORRECT_SCORE" },
  { pattern: /1\. połowa - pierwsza druzyna/, code: "HALF_TIME_FIRST_GOAL" },
  { pattern: /2\. połowa - pierwsza druzyna/, code: "SECOND_HALF_FIRST_GOAL" },
  { pattern: /1\. połowa - ostatnia druzyna/, code: "HALF_TIME_LAST_TEAM_TO_SCORE" },
  { pattern: /2\. połowa - ostatnia druzyna/, code: "SECOND_HALF_LAST_TEAM_TO_SCORE" },
  // "<Team> wygra do 0/zera" (half-scoped win-to-nil) and "<Team> strzeli
  // gola [w N. połowie]" (team-to-score, full-match or half-scoped) used to
  // be hardcoded to the Belgium/New Zealand fixture's team names, so they
  // matched no other match (round-? audit, Arsenal vs Coventry City:
  // rawUnclaimed). Resolved generically via detectTeamSide in
  // resolveMarketCode instead — see the team-aware block after the loop.
  { pattern: /zawodnik strzeli gola w 1\. połowie/, code: "HALF_TIME_GOALSCORER_ANYTIME" },
  { pattern: /player to score in second half/, code: "SECOND_HALF_GOALSCORER_ANYTIME" },
  { pattern: /gol w 1\. połowie/, code: "HALF_TIME_GOAL" },
  { pattern: /gol w 2\. połowie/, code: "SECOND_HALF_GOAL" },

  // --- Team to score (full match) & by-half ---
  // "<Team> strzeli w obu połowach" (team scores in both halves) used to be
  // hardcoded to Belgium/New Zealand AND routed BOTH teams to
  // HOME_SCORE_BOTH_HALVES regardless of side — resolved generically below.
  { pattern: /strzeli w pierwszej\/drugiej połowie/, code: "TEAM_SCORE_BY_HALF" },
  { pattern: /pierwsza druzyna, ktora zdobedzie gola/, code: "FIRST_TEAM_TO_SCORE" },
  { pattern: /ostatnia druzyna, ktora zdobedzie gola/, code: "LAST_TEAM_TO_SCORE" },

  // --- Player goal markets ---
  { pattern: /zawodnik strzeli gola w obu połowach/, code: "PLAYER_SCORES_BOTH_HALVES" },
  { pattern: /zawodnik strzeli gola spoza pola karnego/, code: "PLAYER_GOAL_OUTSIDE_BOX" },
  { pattern: /zawodnik strzeli gola i jego zespoł przegra/, code: "PLAYER_GOAL_TEAM_LOSES" },
  { pattern: /zawodnik strzeli gola i mecz zakonczy sie remisem/, code: "PLAYER_GOAL_AND_RESULT" },
  { pattern: /zawodnik strzeli gola lub zanotuje asyste/, code: "PLAYER_GOAL_OR_ASSIST" },
  { pattern: /zawodnik strzeli gola głowa/, code: "PLAYER_HEADER_GOAL" },
  { pattern: /dowolny zawodnik strzeli 3 lub wiecej goli/, code: "HAT_TRICK" },
  { pattern: /zawodnik strzeli 2 lub wiecej goli/, code: "PLAYER_2_OR_MORE_GOALS" },
  // "Zawodnik strzeli 3 lub więcej goli (Sub-Hero)" is a per-player YES-shaped
  // threshold market (same shape as PLAYER_2_OR_MORE_GOALS above — one row per
  // player, no split threshold parameter). Routing N=3 through the generic
  // \d+ PLAYER_GOALS pattern below collapsed it onto the SAME marketKey as the
  // unrelated N=4 "Zawodnik strzeli 4 lub więcej goli" markets (both carry no
  // paramValue), mixing two different thresholds' odds under one bucket. The
  // catalog's dedicated PLAYER_3_OR_MORE_GOALS code (already used the same way
  // by sts/betcris/superbet) keeps this threshold on its own marketKey.
  { pattern: /zawodnik strzeli 3 lub wiecej goli/, code: "PLAYER_3_OR_MORE_GOALS" },
  // "Zawodnik strzeli 4 lub więcej goli" (audit-match, Arsenal vs Coventry
  // City, round 8): LVBet never publishes the tiered PLAYER_GOALS ladder
  // (only "1+"/"2+"/"3+" exist there) — its own "4 lub więcej" row is a
  // standalone one-price product shared with betcris' PlayerToScore4OrMore,
  // now the catalog's dedicated PLAYER_4_OR_MORE_GOALS code (same YES-shaped
  // per-player structure as PLAYER_2/3_OR_MORE_GOALS above, not a rung of
  // the ladder). Must be excluded from the generic \d+ pattern below, which
  // otherwise merged it onto PLAYER_GOALS' marketKey — the ladder has no "4+"
  // slot, so every N=4 row was silently dropped as an orphan selection.
  { pattern: /zawodnik strzeli 4 lub wiecej goli/, code: "PLAYER_4_OR_MORE_GOALS" },
  { pattern: /zawodnik strzeli \d+ lub wiecej goli/, code: "PLAYER_GOALS" },
  // Two-player OR combos ("Podwójna szansa") must not pollute single-player markets
  { pattern: /zawodnik zanotuje asyste - podwojna szansa/, code: "PLAYER_ASSIST_PAIRS" },
  { pattern: /zawodnik zanotuje asyste/, code: "PLAYER_ASSISTS" },
  { pattern: /pierwszy zawodnik, ktory otrzyma kartke/, code: "FIRST_CARD_PLAYER" },
  // No catalog code exists for a two-player OR card combo yet — exclude it
  // from PLAYER_CARDS instead of mixing combo odds with single-player odds.
  { pattern: /zawodnik otrzyma kartke - podwojna szansa/, code: "OTHER" },
  { pattern: /zawodnik otrzyma kartke/, code: "PLAYER_CARDS" },
  { pattern: /strzeli gola i zaliczy asyste/, code: "PLAYER_GOAL_AND_ASSIST" },
  { pattern: /rezerwowy strzeli bramke/, code: "SUBSTITUTE_GOAL" },
  { pattern: /goal by a direct free kick/, code: "FREE_KICK_GOAL" },
  { pattern: /an own goal in the match/, code: "OWN_GOAL" },

  // --- First-goal method / timing ---
  { pattern: /sposob zdobycia pierwszego gola/, code: "FIRST_GOAL_METHOD" },
  { pattern: /czas zdobycia pierwszego gola/, code: "FIRST_GOAL_TIME" },
  { pattern: /1\. gol - czas/, code: "FIRST_GOAL_TIME_ALT" },
  { pattern: /bedzie wynik w trakcie meczu/, code: "SCORE_DURING_MATCH" },
  { pattern: /dokładnie 1 gol w meczu/, code: "EXACT_GOALS_YN" },
  // Other exact counts ("Dokładnie 3 gole w meczu") cannot share
  // EXACT_GOALS_YN (hasParameter=false — different counts would collide on
  // one market key) and are not over/under bets — exclude them instead of
  // letting the generic goals patterns drop them into TOTAL_GOALS.
  { pattern: /dokładnie \d+ gol\w* w meczu/, code: "OTHER" },

  // --- Win / result variants ---
  // "<Team> wygra do zera" (full-match win-to-nil) is routed team-aware
  // further down (via detectTeamSide), same as the half-scoped variant —
  // used to be hardcoded to the Belgium/New Zealand fixture's team names.
  { pattern: /wygra obie połowy/, code: "TEAM_WIN_BOTH_HALVES" },
  // "<Team> wygra przynajmniej jedną połowę" is routed team-aware further
  // down (via detectTeamSide) instead of a static pattern here, since a
  // static regex cannot tell which team's name appears in the raw label.
  { pattern: /remis przynajmniej w jednej z połow/, code: "DRAW_AT_LEAST_ONE_HALF" },
  { pattern: /wygra pierwsza połowe \/ wygra druga połowe/, code: "HALF_TIME_SECOND_HALF_RESULT" },
  // "LV Zaliczka" is a 3-way (HOME/DRAW/AWAY) insured-1X2 promo product; the
  // catalog's WIN_OR_WIN_BY_2 is strictly binary HOME/AWAY, so mapping it
  // there contaminated best odds with a structurally different bet. Excluded
  // until a dedicated 3-way "win or 2-goal lead" code exists.
  { pattern: /druzyna wygra mecz lub bedzie prowadzic dwoma bramkami/, code: "OTHER" },
  { pattern: /wynik - kombinacje/, code: "MULTI_RESULT" },
  // "(Do przerwy / koniec meczu) i suma goli X" is an HT/FT + total-goals
  // combo (audit-match, Arsenal vs Coventry City, round 8: verified via
  // implied-probability convergence — at param 2.5, lvbet's selections sum
  // to 1.374, matching betcris' 1.372 and etoto's 1.358 for the same
  // catalog code). Selections are parsed by the dedicated case below.
  { pattern: /do przerwy\s*\/\s*koniec meczu.*suma goli/, code: "HALFTIME_FULLTIME_AND_TOTAL" },
  { pattern: /do przerwy\s*\/\s*koniec meczu/, code: "HALFTIME_FULLTIME" },

  // --- Both halves goals ---
  { pattern: /obie połowy powyzej/, code: "BOTH_HALVES_OVER_GOALS" },
  { pattern: /obie połowy ponizej/, code: "BOTH_HALVES_UNDER_GOALS" },
  { pattern: /obie połowy wygraja rozne/, code: "DIFFERENT_HALF_WINNERS" },

  // --- Both teams cards / BTTS-by-half ---
  { pattern: /obie druzyny otrzymaja min/, code: "BOTH_TEAMS_MIN_CARDS" },
  { pattern: /obie druzyny otrzymaja kartke/, code: "BOTH_TEAMS_CARDED" },
  { pattern: /kartka w obu połowach/, code: "BOTH_HALVES_CARDS" },
  { pattern: /obydwie druzyny strzela/, code: "BTTS_BY_HALF" },

  // --- At-least-one-team goals ---
  { pattern: /co najmniej jeden zespoł strzeli 1\.5 goli/, code: "AT_LEAST_ONE_TEAM_TOTAL_GOALS" },
  { pattern: /co najmniej jeden zespoł strzeli/, code: "AT_LEAST_ONE_TEAM_OVER_GOALS" },

  // --- Result+total combos ---
  // NOTE: "Total Goals (Extended Bands)" and "Outcome And … Total Goals"
  // markets are routed via ctx-aware blocks in resolveMarketCode (team-scoped
  // variants need the home/away context, so a static pattern cannot classify
  // them).

  // --- Misc stat totals ---
  { pattern: /liczba zmian/, code: "SUBSTITUTIONS_TOTAL" },
  { pattern: /var: suma/, code: "VAR_REVIEWS_TOTAL" },
  { pattern: /liczba pomocy medycznych/, code: "MEDICAL_AIDS_TOTAL" },
];

const HALF_TIME_PATTERN = /(1\.?\s*połowa|1st half)/i;
const SECOND_HALF_PATTERN = /(2\.?\s*połowa|2nd half)/i;
const GOAL_TOTAL_PATTERN = /(suma goli|liczba goli|gole|bramek|azjatycka liczba goli|azjatycka suma goli)/i;
const BTTS_PATTERN = /obie druzyny strzela/i;
const HANDICAP_PATTERN = /handicap/i;
const EUROPEAN_HANDICAP_PATTERN = /(3[-\s]?drogowy|3[-\s]?drogowo)/i;

/**
 * Detects whether a raw market name is scoped to the home or away team.
 * Fast path: normalized substring match against the context team names.
 * Fallback: strips known market phrases/numbers from the ORIGINAL name and
 * resolves the remaining fragment via the league alias map (bookmaker names
 * are Polish, context names are canonical English — e.g. "Republika
 * Zielonego Przylądka" -> "Cape Verde").
 */
function detectTeamSide(
  rawName: string,
  ctx: NormalizationContext
): "HOME" | "AWAY" | null {
  const normalizedName = normalizeMarketName(rawName);
  const home = normalizeMarketName(ctx.homeTeam ?? "");
  const away = normalizeMarketName(ctx.awayTeam ?? "");
  if (home && normalizedName.includes(home)) return "HOME";
  if (away && normalizedName.includes(away)) return "AWAY";

  // Stat sub-markets scope the team as an index ("Drużyna 1." / "Drużyna 2.")
  // instead of a name.
  if (/\b(druzyna|team)\s*1\b/.test(normalizedName)) return "HOME";
  if (/\b(druzyna|team)\s*2\b/.test(normalizedName)) return "AWAY";

  if (!ctx.league) return null;

  const fragment = rawName
    .replace(/\b(1st|2nd)\s+half\b/gi, " ")
    .replace(/[12]\.\s*połowa/gi, " ")
    .replace(/\(extended bands\)/gi, " ")
    .replace(/\(przedział\)/gi, " ")
    .replace(/połowa z większą liczbą goli/gi, " ")
    .replace(/dokładna liczba goli/gi, " ")
    .replace(/suma goli|liczba goli|total goals/gi, " ")
    // Stat-market phrases ("Faule: Kolumbia suma", "Auty: Kolumbia suma",
    // "Outcome And Szwajcaria Total Goals") must not pollute the team
    // fragment passed to the alias matcher.
    .replace(/rzuty ro[żz]ne|[żz][óo]łte kartki|czerwone kartki|kartki|faule|spalone|strza[łl]y celne|strza[łl]y|auty|wybicia od bramki|wrzuty z autu|pierwsze \d+ minut/gi, " ")
    .replace(/\b(outcome and|azjatycka|asian|suma|handicap|wynik|liczba|parzyste|nieparzyste)\b/gi, " ")
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, " ")
    .replace(/[–:()\-–]/g, " ")
    // Leftover single letters ("(X)" placeholders) confuse the alias matcher
    .replace(/\b\p{L}\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (fragment.length < 3) return null;

  const fragMatch = matchToCanonical(fragment, ctx.league);
  if (!fragMatch) return null;
  const homeMatch = ctx.homeTeam ? matchToCanonical(ctx.homeTeam, ctx.league) : null;
  const awayMatch = ctx.awayTeam ? matchToCanonical(ctx.awayTeam, ctx.league) : null;
  if (homeMatch && fragMatch.name === homeMatch.name) return "HOME";
  if (awayMatch && fragMatch.name === awayMatch.name) return "AWAY";
  return null;
}

/**
 * Refines generic team-stat buckets to the side-scoped catalog codes when the
 * raw name identifies the team ("Auty: Kolumbia suma" -> away throw-ins).
 * The generic codes stay as a fallback when no side can be resolved.
 */
function refineTeamScopedStatCode(
  code: NormalizedMarketType,
  rawName: string,
  ctx: NormalizationContext
): NormalizedMarketType {
  if (code === "TEAM_TOTAL_THROW_INS") {
    const side = detectTeamSide(rawName, ctx);
    if (side) return side === "HOME" ? "HOME_TEAM_TOTAL_THROW_INS" : "AWAY_TEAM_TOTAL_THROW_INS";
  }
  if (code === "TEAM_GOAL_KICKS") {
    const side = detectTeamSide(rawName, ctx);
    if (side) return side === "HOME" ? "HOME_TEAM_TOTAL_GOAL_KICKS" : "AWAY_TEAM_GOAL_KICKS";
  }
  return code;
}

function resolveMarketCode(
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): { code: NormalizedMarketType; matchedBy: "id" | "name" | "pattern" } {
  const rawId = raw.bookmakerMarketId ? Number(raw.bookmakerMarketId) : null;
  if (rawId !== null && !Number.isNaN(rawId)) {
    const idMatch = LVBET_MARKET_ID_TO_CODE[rawId];
    if (idMatch) {
      return { code: idMatch, matchedBy: "id" };
    }
  }

  const normalizedName = normalizeMarketName(raw.name);

  // Audited name-pattern mappings take precedence over the generic heuristics
  // below, since LVBET has no stable market id. Patterns are ordered
  // specific-first so e.g. corner/foul/card "1. połowa" variants are not
  // swallowed by the generic half-time result heuristic.
  for (const { pattern, code } of LVBET_AUDIT_NAME_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return { code: refineTeamScopedStatCode(code, raw.name, ctx), matchedBy: "pattern" };
    }
  }

  // Team-scoped offsides total ("Spalone: <Team> suma <line>") — generalized
  // from a Belgium/New Zealand-hardcoded pair of patterns (audit /audit-match,
  // Arsenal vs Coventry City: rawUnclaimed for every other match). No generic
  // catch-all bucket code exists for this stat family (unlike throw-ins/goal
  // kicks below), so the side is resolved directly here.
  if (/^spalone:.*suma/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (side === "HOME") return { code: "HOME_TEAM_TOTAL_OFFSIDES", matchedBy: "pattern" };
    if (side === "AWAY") return { code: "AWAY_TEAM_TOTAL_OFFSIDES", matchedBy: "pattern" };
  }

  // "<Team> wygra do zera / wygra do 0" (win-to-nil, full-match or half-
  // scoped) and "<Team> strzeli gola [w N. połowie]" (team-to-score) and
  // "<Team> strzeli w obu połowach" (team scores in both halves) were
  // previously hardcoded to the Belgium/New Zealand fixture's team names —
  // generalized here via detectTeamSide (audit /audit-match, Arsenal vs
  // Coventry City). Half-scoped win-to-nil is checked first since its prefix
  // ("N. Połowa - ") would otherwise also satisfy the full-match pattern.
  const halfWinToNilMatch = normalizedName.match(
    /^([12])\.\s*połowa\s*-\s*.+\s+wygra do (?:0|zera)$/
  );
  if (halfWinToNilMatch) {
    const side = detectTeamSide(raw.name, ctx);
    const isFirstHalf = halfWinToNilMatch[1] === "1";
    if (side === "HOME") {
      return {
        code: isFirstHalf ? "HALF_TIME_HOME_WIN_TO_NIL" : "SECOND_HALF_HOME_WIN_TO_NIL",
        matchedBy: "pattern",
      };
    }
    if (side === "AWAY") {
      return {
        code: isFirstHalf ? "HALF_TIME_AWAY_WIN_TO_NIL" : "SECOND_HALF_AWAY_WIN_TO_NIL",
        matchedBy: "pattern",
      };
    }
  }

  if (/^.+\s+wygra do zera$/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (side === "HOME") return { code: "HOME_WIN_TO_NIL", matchedBy: "pattern" };
    if (side === "AWAY") return { code: "AWAY_WIN_TO_NIL", matchedBy: "pattern" };
  }

  if (/^.+\s+strzeli w obu połowach$/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (side === "HOME") return { code: "HOME_SCORE_BOTH_HALVES", matchedBy: "pattern" };
    if (side === "AWAY") return { code: "AWAY_SCORE_BOTH_HALVES", matchedBy: "pattern" };
  }

  const teamToScoreMatch = normalizedName.match(
    /^.+\s+strzeli gola(?:\s+w\s+([12])\.\s*połowie)?$/
  );
  if (teamToScoreMatch) {
    const side = detectTeamSide(raw.name, ctx);
    const half = teamToScoreMatch[1];
    if (side === "HOME") {
      return {
        code:
          half === "1" ? "HALF_TIME_HOME_TO_SCORE" : half === "2" ? "SECOND_HALF_HOME_TO_SCORE" : "HOME_TEAM_TO_SCORE",
        matchedBy: "pattern",
      };
    }
    if (side === "AWAY") {
      return {
        code:
          half === "1" ? "HALF_TIME_AWAY_TO_SCORE" : half === "2" ? "SECOND_HALF_AWAY_TO_SCORE" : "AWAY_TEAM_TO_SCORE",
        matchedBy: "pattern",
      };
    }
  }

  // "Outcome And <Team> Total Goals" is a result + TEAM-total combo with no
  // catalog code; only the match-total variant maps to RESULT_AND_TOTAL.
  if (/outcome and .*total goals/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    return { code: side ? "OTHER" : "RESULT_AND_TOTAL", matchedBy: "pattern" };
  }

  // "<Team> wygra przynajmniej jedną połowę" (team wins at least one half) —
  // resolve the side from the raw name instead of a hardcoded AWAY code, so
  // the home team's own market never lands in the away bucket.
  if (/wygra przynajmniej jedna połowe/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    return {
      code:
        side === "HOME"
          ? "HOME_WIN_AT_LEAST_ONE_HALF"
          : side === "AWAY"
            ? "AWAY_WIN_AT_LEAST_ONE_HALF"
            : "OTHER",
      matchedBy: "pattern",
    };
  }

  // "Total Goals (Extended Bands)" family — team-scoped variants need ctx to
  // resolve the side, so they cannot be routed by static patterns.
  if (/total goals \(extended bands\)/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (/2nd half/.test(normalizedName)) {
      return {
        code: side ? "SECOND_HALF_TEAM_GOAL_RANGE" : "SECOND_HALF_GOAL_RANGE",
        matchedBy: "pattern",
      };
    }
    if (/1st half/.test(normalizedName)) {
      // No catalog code exists for 1st-half team goal bands — exclude instead
      // of polluting the match-level HALF_TIME_GOAL_RANGE.
      return { code: side ? "OTHER" : "HALF_TIME_GOAL_RANGE", matchedBy: "pattern" };
    }
    if (side) {
      return {
        code: side === "HOME" ? "HOME_GOAL_RANGE" : "AWAY_GOAL_RANGE",
        matchedBy: "pattern",
      };
    }
    return { code: "GOAL_RANGE", matchedBy: "pattern" };
  }

  // "Połowa z większą liczbą goli: Podwójna szansa" is a DOUBLE-CHANCE
  // variant of the half-with-more-goals market (selections "1. lub w obu
  // połowach po równo" / "1. lub 2." / "2. lub w obu połowach po równo"),
  // not the plain 1st/Draw/2nd pick the generic branch below routes to
  // (audit-match, Arsenal vs Coventry City, GOLE/HALF_WITH_MORE_GOALS index
  // 43). Forcing it into plain HALF_WITH_MORE_GOALS collided its two
  // "X lub równo" selections onto the single Draw slot and left "1. lub 2."
  // unmapped raw text — must be checked before the generic substring branch,
  // which would otherwise also match this name.
  if (/połowa z wieksza liczba goli.*podwojna szansa/.test(normalizedName)) {
    return { code: "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE", matchedBy: "pattern" };
  }

  // "<Team> Połowa z większą liczbą goli" (half-with-more-goals comparison,
  // optionally team-scoped) — a comparison market, never a goals total.
  if (/połowa z wieksza liczba goli/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (side === "HOME") return { code: "HOME_HALF_WITH_MOST_GOALS", matchedBy: "pattern" };
    if (side === "AWAY") return { code: "AWAY_HALF_WITH_MOST_GOALS", matchedBy: "pattern" };
    return { code: "HALF_WITH_MORE_GOALS", matchedBy: "pattern" };
  }

  // "<Team> - Liczba goli (przedziały)" (e.g. "Arsenal - Liczba goli
  // (przedziały)", "Coventry City - Liczba goli (przedziały)") is a
  // team-scoped cumulative goal-band ladder (selections "1-2"/"1-3"/"1-4"/
  // "2-3"/"2-4"/"3-4"/"Każdy inny"), not an over/under total — it shares the
  // "liczba goli" substring with the plain team total-goals family below,
  // which used to force-fit its band labels into OVER/UNDER parsing and
  // leave every selection UNKNOWN (audit-match, Arsenal vs Coventry City,
  // GOLE/HOME_TEAM_TOTAL_GOALS, round 7b MINOR). Route it to the existing
  // team goal-range codes instead (their catalog selection lists — 0/0-1/
  // 1-2/1-3/2-3/4+ — already only accept a subset of LVBet's bands; the
  // "1-4"/"2-4"/"3-4"/"Każdy inny" extras are dropped by
  // normalizeSelectionForMarket, same as the existing HOME_GOAL_RANGE/
  // AWAY_GOAL_RANGE handling for other bookmakers' extended-band offers).
  // Anchored on a literal dash right before "liczba goli" so the half-scoped
  // team variant ("1./2. Połowa - <Team> liczba goli (przedziały)", no dash
  // there) and the match-level half variants ("1./2. Połowa - Liczba goli
  // (przedziały)", no team name so detectTeamSide returns null) fall through
  // unchanged to the generic block below. "przedzia.y" is deliberately a
  // one-char wildcard, not a typo — see the NFD/"ł" note further down.
  if (/^.+\s-\sliczba goli \(przedzia.y\)$/.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (side) {
      return { code: side === "HOME" ? "HOME_GOAL_RANGE" : "AWAY_GOAL_RANGE", matchedBy: "pattern" };
    }
  }

  // Team-scoped goal totals ("Austria - Suma goli", "2. Połowa - Argentyna
  // liczba goli", "2. Połowa - <Team> dokładna liczba goli (przedział)") must
  // not be merged into the match-level TOTAL_GOALS family.
  if (GOAL_TOTAL_PATTERN.test(normalizedName)) {
    const side = detectTeamSide(raw.name, ctx);
    if (side) {
      // "Parzyste"/"Nieparzyste" (odd/even team goals) share the same
      // team+"gole" wording as the over/under family below but are a
      // distinct proposition — route them to the dedicated odd/even code
      // before the over/under branches, instead of letting them fall into
      // HOME/AWAY_TEAM_TOTAL_GOALS as unmapped UNKNOWN selections.
      const isOddEven =
        raw.selections.length > 0 &&
        raw.selections.every((s) => /^(parzyst|nieparzyst)/.test(normalizeMarketName(s.name)));
      if (isOddEven) {
        return {
          code: side === "HOME" ? "HOME_TEAM_ODD_EVEN_GOALS" : "AWAY_TEAM_ODD_EVEN_GOALS",
          matchedBy: "pattern",
        };
      }
      const secondHalf = SECOND_HALF_PATTERN.test(normalizedName);
      const firstHalf = HALF_TIME_PATTERN.test(normalizedName);
      if (/dokładna liczba goli/.test(normalizedName)) {
        if (secondHalf) {
          return { code: "SECOND_HALF_TEAM_GOAL_RANGE", matchedBy: "pattern" };
        }
        if (firstHalf) {
          // Only the home-team 1st-half exact-goals code exists in the catalog
          return {
            code: side === "HOME" ? "HALF_TIME_HOME_EXACT_GOALS" : "OTHER",
            matchedBy: "pattern",
          };
        }
        return {
          code: side === "HOME" ? "HOME_EXACT_GOALS" : "AWAY_EXACT_GOALS",
          matchedBy: "pattern",
        };
      }
      if (secondHalf) {
        return {
          code:
            side === "HOME"
              ? "SECOND_HALF_HOME_TEAM_TOTAL_GOALS"
              : "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
          matchedBy: "pattern",
        };
      }
      if (firstHalf) {
        return {
          code:
            side === "HOME"
              ? "HALF_TIME_HOME_TEAM_TOTAL_GOALS"
              : "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
          matchedBy: "pattern",
        };
      }
      return {
        code: side === "HOME" ? "HOME_TEAM_TOTAL_GOALS" : "AWAY_TEAM_TOTAL_GOALS",
        matchedBy: "pattern",
      };
    }
  }

  const nameMatch = LVBET_MARKET_NAME_TO_CODE[normalizedName];
  if (nameMatch) {
    return { code: nameMatch, matchedBy: "name" };
  }

  // Exact-goal-count selections ("0"/"1"/"2"/"3"/"4+") mark an exact-goals
  // product even when the raw name only says "liczba goli" — such markets
  // must not merge into the OVER/UNDER goal totals.
  const hasExactCountSelections =
    raw.selections.length > 0 &&
    raw.selections.every((s) => /^\d+\s*\+?$/.test(s.name.trim()));

  if (HALF_TIME_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "HALF_TIME_RESULT", matchedBy: "pattern" };
    }
    if (BTTS_PATTERN.test(normalizedName)) {
      return { code: "HALF_TIME_BTTS", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName) && !HANDICAP_PATTERN.test(normalizedName)) {
      return {
        code: hasExactCountSelections ? "HALF_TIME_EXACT_GOALS" : "HALF_TIME_TOTAL_GOALS",
        matchedBy: "pattern",
      };
    }
  }

  if (SECOND_HALF_PATTERN.test(normalizedName)) {
    if (/wynik/.test(normalizedName)) {
      return { code: "SECOND_HALF_RESULT", matchedBy: "pattern" };
    }
    // Audit r10: this branch was missing the BTTS check its HALF_TIME_PATTERN
    // sibling above already has — "2. Połowa - Obie drużyny strzelą gola"
    // (Tak/Nie 4.25/1.18) fell through all the way to the generic
    // "obie druzyny strzela" pattern and landed in plain (full-match) BTTS.
    if (BTTS_PATTERN.test(normalizedName)) {
      return { code: "SECOND_HALF_BTTS", matchedBy: "pattern" };
    }
    if (GOAL_TOTAL_PATTERN.test(normalizedName) && !HANDICAP_PATTERN.test(normalizedName)) {
      return {
        code: hasExactCountSelections ? "SECOND_HALF_EXACT_GOALS" : "SECOND_HALF_TOTAL_GOALS",
        matchedBy: "pattern",
      };
    }
  }

  // "Handicap - Suma goli w pierwszej połowie vs. Suma goli w drugiej
  // połowie [line]" is a 1st-half-goals-total vs 2nd-half-goals-total
  // handicap — an entirely different statistic from the match-result
  // Asian/European Handicap despite containing "handicap" as a substring
  // (audit-match, Arsenal vs Coventry City, HANDICAP/ASIAN_HANDICAP index
  // 39). It was falling through the generic HANDICAP_PATTERN branch below
  // (neither HALF_TIME_PATTERN nor SECOND_HALF_PATTERN match its "pierwszej
  // połowie"/"drugiej połowie" wording, unlike the "1./2. połowa" prefix
  // those check for), landing in full-match ASIAN_HANDICAP and colliding
  // with the genuine handicap entry sharing the same numeric line (e.g.
  // both quote "-1.5"), injecting a spurious UNKNOWN third selection. No
  // catalog code exists for this halves-comparison handicap — exclude it.
  if (/suma goli w pierwszej połowie.*suma goli w drugiej połowie/.test(normalizedName)) {
    return { code: "OTHER", matchedBy: "pattern" };
  }

  if (HANDICAP_PATTERN.test(normalizedName)) {
    const european = EUROPEAN_HANDICAP_PATTERN.test(normalizedName);
    // Half-scoped handicaps must not land in the full-match markets
    if (HALF_TIME_PATTERN.test(normalizedName)) {
      return {
        code: european ? "FIRST_HALF_EUROPEAN_HANDICAP" : "FIRST_HALF_ASIAN_HANDICAP",
        matchedBy: "pattern",
      };
    }
    if (SECOND_HALF_PATTERN.test(normalizedName)) {
      return {
        code: european ? "SECOND_HALF_EUROPEAN_HANDICAP" : "SECOND_HALF_ASIAN_HANDICAP",
        matchedBy: "pattern",
      };
    }
    return {
      code: european ? "EUROPEAN_HANDICAP" : "ASIAN_HANDICAP",
      matchedBy: "pattern",
    };
  }

  if (/azjatycka/.test(normalizedName)) {
    return { code: "TOTAL_GOALS_ASIAN", matchedBy: "pattern" };
  }

  // Audit r9 (Arsenal vs Coventry City): these three parlay/combo product
  // names each contain a substring the generic patterns below were written
  // for ("suma goli", "zwyciezca meczu", "obie druzyny strzela") and so were
  // silently colliding onto the plain base market — TOTAL_GOALS, MATCH_WINNER
  // and BTTS all showed a mix of real per-line prices and combo-cell prices
  // typed as the same OVER/UNDER/HOME/AWAY code (e.g. TOTAL_GOALS param 0.5
  // carried both the genuine "Poniżej 0.5" AND fourteen unrelated "Powyżej X
  // goli w 1. połowie oraz powyżej Y w 2. połowie/meczu" combo cells).
  //
  // "Kombinowana suma goli" (first-half-total x second-half-total combo) and
  // "<Team> strzeli gola / zwycięzca meczu" (team-to-score x match-winner
  // combo) have no matching catalog code — park in OTHER, checked before the
  // substring patterns can reach them.
  if (normalizedName === "kombinowana suma goli") {
    return { code: "OTHER", matchedBy: "pattern" };
  }
  if (/strzeli gola \/ zwyciezca meczu$/.test(normalizedName)) {
    return { code: "OTHER", matchedBy: "pattern" };
  }
  // "Pierwsze 10 minut (00:00 – 09:59): <stat> X.5" — real, cataloged
  // first-10-minutes products. The corners variant already has a route above
  // in LVBET_AUDIT_NAME_PATTERNS (checked earlier in this function); goals
  // and cards did not, so they fell all the way through to the generic
  // "gole"/"suma goli" substring pattern and landed in plain TOTAL_GOALS/
  // CARDS_TOTAL. Found chasing a match-level TOTAL_GOALS:0.5 collision:
  // this window's own Powyżej/Poniżej (0.5) — 3.9/1.2, correctly
  // UNDER-favoured for a 10-minute window — was overwriting the real
  // match-total 0.5 line's 1.02/13.
  if (/^pierwsze 10 minut \(00:00 [-–] 09:59\): gole [\d.]+$/.test(normalizedName)) {
    return { code: "FIRST_10_MIN_TOTAL_GOALS", matchedBy: "pattern" };
  }
  if (/^pierwsze 10 minut \(00:00 [-–] 09:59\): zołte kartki [\d.]+$/.test(normalizedName)) {
    return { code: "FIRST_10_MIN_CARDS", matchedBy: "pattern" };
  }
  // "Obie drużyny strzelą 2 gole lub więcej" is BTTS_2PLUS_GOALS — a real,
  // cataloged, DIFFERENT product from plain BTTS ("obie druzyny strzela"
  // substring made it collide onto plain BTTS: Tak/Nie 8.75/1.04 for the
  // 2+-each variant was overwriting the real BTTS Tak/Nie 2.55/1.5).
  if (normalizedName === "obie druzyny strzela 2 gole lub wiecej") {
    return { code: "BTTS_2PLUS_GOALS", matchedBy: "pattern" };
  }
  // "Obie drużyny strzelą gola w obu połowach" — BTTS in EVERY half, a
  // third distinct "obie druzyny strzela" variant found chasing the same
  // BTTS pollution (single-sided raw market, Tak only, odds ~10.5).
  if (normalizedName === "obie druzyny strzela gola w obu połowach") {
    return { code: "BTTS_BOTH_HALVES", matchedBy: "pattern" };
  }

  // "1-N min. - Zwycięzca" IS a real, cataloged product (TIME_PERIOD_RESULT,
  // param = the window's end minute) — checked before the bare "zwyciezca"
  // substring pattern below sends it to plain MATCH_WINNER. Selection
  // shape (Arsenal/Remis/Coventry City) is handled by the MATCH_WINNER-
  // style branch in normalizeSelectionForMarket; the end-minute param is
  // extracted in extractParamValue (a market-name-generic parseIntegerLine
  // would grab the window's START minute "1" instead).
  if (/^\d+-\d+ min\.\s*-\s*zwyciezca$/.test(normalizedName)) {
    return { code: "TIME_PERIOD_RESULT", matchedBy: "pattern" };
  }
  // Remaining "…/ wynik meczu" and "…zwyciezca meczu" combo shapes with no
  // catalog counterpart — all four contain "wynik meczu" or "zwyciezca meczu"
  // as a substring and were colliding onto plain MATCH_WINNER (225-selection
  // HT/FT correct-score grid "Wynik 1. połowy/Wynik meczu" was the worst
  // offender, but the pair below also contaminated it):
  //   "Wynik 1. połowy/Wynik meczu" — half-time score / full-time score grid
  //   "Drużyna, która strzeli pierwszego gola i wynik meczu" — scorer+result
  //   "1. Połowa lub zwycięzca meczu" — HT-result-OR-FT-result (looser bet)
  if (
    normalizedName === "wynik 1. połowy/wynik meczu" ||
    normalizedName === "druzyna, ktora strzeli pierwszego gola i wynik meczu" ||
    normalizedName === "1. połowa lub zwyciezca meczu"
  ) {
    return { code: "OTHER", matchedBy: "pattern" };
  }
  // "Obie drużyny strzelą i powyżej/poniżej X.5 goli w meczu" IS a real,
  // cataloged product (TOTAL_GOALS_AND_BTTS) — recover it instead of parking
  // it, its selection shape is handled in normalizeSelectionForMarket below.
  if (/^obie druzyny strzela i powyzej\/ponizej [\d.]+ goli w meczu$/.test(normalizedName)) {
    return { code: "TOTAL_GOALS_AND_BTTS", matchedBy: "pattern" };
  }
  // Three more parlay shapes found while chasing the BTTS/TOTAL_GOALS
  // contamination above — same substring-collision mechanism, no quick safe
  // recovery (raw selection labels are inconsistent — mixed Polish/English,
  // "Drużyna 1" team-number placeholders — parsing them under uncertainty
  // risks inventing wrong data, worse than dropping the market):
  //   "Podwójna szansa i obie drużyny strzelą" (double-chance x BTTS combo,
  //   6 cells) contains "obie druzyny strzela" -> was landing in plain BTTS.
  //   "(Do przerwy / koniec meczu) i suma goli X.5 X.5" (HT-or-FT-result x
  //   total-goals combo, 5 line variants, 14-18 cells each) and "Podwójna
  //   szansa oraz suma goli (przedziały)" (48 cells) both contain "suma
  //   goli" -> were landing in plain TOTAL_GOALS.
  // NOTE: "przedzia.y" below is deliberately a one-char wildcard, not a typo
  // for "przedzialy" — normalizeMarketName's NFD diacritic strip removes the
  // accent from ó/ą/ż/etc. but Polish "ł" has NO NFD decomposition, so it
  // survives untouched as "ł" (audit-match, Arsenal vs Coventry City: an
  // ASCII-"l" literal here never matched the real normalized string, letting
  // this exact combo fall through to the "podwojna szansa" catch-all and
  // pollute full-match DOUBLE_CHANCE with 46 unrelated UNKNOWN cells).
  if (
    normalizedName === "podwojna szansa i obie druzyny strzela" ||
    /^podwojna szansa oraz suma goli \(przedzia.y\)$/.test(normalizedName) ||
    /^\(do przerwy \/ koniec meczu\) i suma goli [\d.]+ [\d.]+$/.test(normalizedName)
  ) {
    return { code: "OTHER", matchedBy: "pattern" };
  }
  // "Podwójna szansa Combo" (double-chance x total-goals/BTTS/win-to-nil
  // multi-way parlay, 27 cells with inconsistent "Drużyna 1"/team-name
  // labels) shares the same "podwojna szansa" substring and no catalog shape
  // fits it — exclude it the same way as the sibling combo products above
  // instead of letting it pollute full-match DOUBLE_CHANCE (audit-match,
  // Arsenal vs Coventry City, WYNIK_MECZU/DOUBLE_CHANCE).
  if (normalizedName === "podwojna szansa combo") {
    return { code: "OTHER", matchedBy: "pattern" };
  }

  for (const { pattern, code } of LVBET_MARKET_NAME_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return { code, matchedBy: "pattern" };
    }
  }

  return { code: "OTHER", matchedBy: "pattern" };
}

/**
 * True when the catalog defines `code` as a selection of `marketCode`.
 * Used to drop LVBet-only buckets (e.g. extended-band combos "1-4"/"2-4",
 * "Każdy inny", "4+") that would otherwise surface as orphan selections no
 * other bookmaker quotes.
 */
function isCatalogSelection(marketCode: NormalizedMarketType, code: string): boolean {
  const metadata = getMarketMetadata(marketCode);
  return metadata ? metadata.selections.includes(code) : false;
}

/**
 * LVBet quotes some players by a longer/differently-composed name than the
 * network-wide canonical form other bookmakers converge on for the SAME
 * real person, so the shared canonicalizePlayerName() helper (which only
 * reorders "Lastname, Firstname" -> "Firstname Lastname") does not merge
 * them (audit-match, Arsenal vs Coventry City, ZAWODNICY/
 * PLAYER_GOAL_AND_ASSIST): LVBet's "Victor Torp Overgaard" (his full legal
 * surname) vs betfan/etoto/forbet/sts/superbet's "Torp, Victor" ->
 * "Victor Torp", fragmenting one player's odds across two selection codes.
 * Add further real-world aliases here as they are found.
 */
const LVBET_PLAYER_NAME_ALIASES: Record<string, string> = {
  "victor torp overgaard": "Victor Torp",
  // Audit-match (Arsenal vs Coventry City, round 6/5c): LVBet's "Coventry
  // City - Pierwszy strzelec" (AWAY_GOALSCORER_FIRST) lists both a
  // short-form and a full-legal-name (with middle name) row for the SAME
  // real player at DIFFERENT prices — "Ellis Reco Simms" 4.7 alongside
  // "Ellis Simms" 6.75, and "Ephron Jardell Mason-Clark" 6.75 alongside
  // "Ephron Mason-Clark" 9.5. Without this alias both rows keep distinct
  // codes and the downstream grouper's first-seen-wins tie-break (which
  // sees "Reco"/"Jardell" first, since it precedes the short form in
  // LVBet's own selection order) shows the WORSE price under the short
  // canonical name. Folding both onto the canonical short form here lets
  // dedupePlayerNameDuplicates (below) resolve the collision by keeping the
  // higher (correct, better-for-the-bettor) price instead.
  "ellis reco simms": "Ellis Simms",
  "ephron jardell mason-clark": "Ephron Mason-Clark",
};

function normalizeLvbetPlayerName(raw: string): string {
  const alias = LVBET_PLAYER_NAME_ALIASES[normalizeMarketName(raw)];
  return alias ?? canonicalizePlayerName(raw);
}

/**
 * Folds a bare numeric exact-goals selection ("2", "3", "5") that has no
 * literal catalog match into the market's own highest "N+" catch-all bucket
 * that it still satisfies (e.g. SECOND_HALF_EXACT_GOALS's "2+" swallows raw
 * "2"/"3"/"4+"; AWAY_EXACT_GOALS's "3+" swallows raw "4"/"5"/"6+"), instead of
 * silently dropping the whole tail the way a literal-only match would.
 */
function mergeIntoExactGoalsCatchAll(
  marketCode: NormalizedMarketType,
  compact: string
): NormalizedSelection | null {
  if (isCatalogSelection(marketCode, compact)) return compact as NormalizedSelection;
  const value = parseInt(compact.replace("+", ""), 10);
  if (Number.isNaN(value)) return null;
  const metadata = getMarketMetadata(marketCode);
  const catchAllThreshold = (metadata?.selections ?? [])
    .filter((s) => /^\d+\+$/.test(s))
    .map((s) => parseInt(s, 10))
    .sort((a, b) => b - a)
    .find((threshold) => value >= threshold);
  return catchAllThreshold !== undefined ? (`${catchAllThreshold}+` as NormalizedSelection) : null;
}

/**
 * Maps the synthetic "Powyżej X" / "Powyżej" marker the LVBet parser
 * synthesizes for bulk player-roster markets (see splitBulkPlayerListMarket
 * in the scraper's parser.ts) to the market's threshold-tiered catalog code
 * (e.g. PLAYER_SHOTS_ON_TARGET's "Powyżej 1.5" -> "2+"), falling back to the
 * market's own OVER selection when no numeric line is present or no
 * matching tier exists in the catalog. Returns null for any other text (a
 * real player name reaching this market's default case) so callers can fall
 * through to the normal player-name handling.
 */
function normalizeLvbetPlayerThreshold(
  marketCode: NormalizedMarketType,
  trimmed: string
): NormalizedSelection | null {
  const normalized = normalizeMarketName(trimmed);
  const match = normalized.match(/^powyzej\s*(\d+(?:[.,]\d+)?)?$/);
  if (!match) return null;
  const lineText = match[1];
  if (lineText) {
    const line = parseFloat(lineText.replace(",", "."));
    if (!Number.isNaN(line)) {
      const tierCode = `${Math.floor(line) + 1}+`;
      if (isCatalogSelection(marketCode, tierCode)) return tierCode as NormalizedSelection;
    }
  }
  return isCatalogSelection(marketCode, "OVER") ? "OVER" : null;
}

/**
 * Over/Under detection tolerant of LVBet's stat-market label variants:
 * "Powyżej (6.5)", "Poniżej 2,5", "Ponad 9", "Więcej"/"Mniej".
 * Returns null (not UNKNOWN) when the label is not an over/under phrase.
 */
function normalizeLvbetOverUnder(label: string): "OVER" | "UNDER" | null {
  const normalized = normalizeMarketName(label);
  if (/^(powyzej|ponad|wiecej|over)\b/.test(normalized)) return "OVER";
  if (/^(ponizej|mniej|under)\b/.test(normalized)) return "UNDER";
  return null;
}

/**
 * Maps a raw LVBet selection label to a canonical selection code.
 * Returns null when the label has no catalog counterpart for the market —
 * such selections are dropped instead of leaking raw text or colliding on a
 * shared UNKNOWN code.
 */
function normalizeSelectionForMarket(
  selectionName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext,
  rawMarketName?: string,
  siblingSelectionNames?: string[]
): NormalizedSelection | null {
  const trimmed = selectionName.trim();

  // Literal catalog-code passthrough: band/range/exact markets often quote
  // raw selection text that IS the catalog selection code ("0-2", "7+", "1+"),
  // and per-market cases below may miss them (falling through to UNKNOWN).
  const literalCatalogCodes = getMarketByCode(marketCode)?.selections;
  if (literalCatalogCodes && literalCatalogCodes.length > 0 && literalCatalogCodes.includes(trimmed)) {
    return trimmed as NormalizedSelection;
  }

  if (/^1\s*\(/.test(trimmed)) return "HOME";
  if (/^2\s*\(/.test(trimmed)) return "AWAY";
  if (/^x\s*\(/i.test(trimmed)) return "DRAW";

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "SECOND_HALF_RESULT":
    case "DRAW_NO_BET":
    case "TIME_PERIOD_RESULT":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
    case "HALF_TIME_DOUBLE_CHANCE":
    case "SECOND_HALF_DOUBLE_CHANCE": {
      // LVBet phrases double chance with team names: "<TeamA> lub remis",
      // "<TeamA> lub <TeamB>", "remis lub <TeamB>".
      const lowerSel = trimmed.toLowerCase();
      const lubIdx = lowerSel.lastIndexOf(" lub ");
      if (lubIdx > 0) {
        const left = normalize1x2Selection(
          trimmed.slice(0, lubIdx).trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const right = normalize1x2Selection(
          trimmed.slice(lubIdx + 5).trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const sides = new Set([left, right]);
        if (sides.has("HOME") && sides.has("DRAW")) return "HOME_OR_DRAW";
        if (sides.has("DRAW") && sides.has("AWAY")) return "DRAW_OR_AWAY";
        if (sides.has("HOME") && sides.has("AWAY")) return "HOME_OR_AWAY";
      }
      return normalizeDoubleChanceSelection(trimmed);
    }

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
    // Stat over/under totals share the same "Powyżej (X)"/"Poniżej (X)"
    // vocabulary — without an explicit case they fell into the YES-NO/1X2
    // default and every line collapsed into a single UNKNOWN entry.
    case "TOTAL_SHOTS":
    case "TEAM_TOTAL_SHOTS":
    case "TOTAL_SHOTS_ON_TARGET":
    case "TEAM_TOTAL_SHOTS_ON_TARGET":
    case "CORNERS_TOTAL":
    case "CORNERS_TEAM":
    case "HALF_TIME_CORNERS_TOTAL":
    case "SECOND_HALF_CORNERS_TOTAL":
    case "FIRST_10_MIN_CORNERS_TOTAL":
    case "TIME_PERIOD_CORNERS_TOTAL":
    case "FOULS_TOTAL":
    case "TEAM_TOTAL_FOULS":
    case "HALF_TIME_FOULS_TOTAL":
    case "CARDS_TOTAL":
    case "YELLOW_CARDS_TOTAL":
    case "HALF_TIME_CARDS_TOTAL":
    case "SECOND_HALF_CARDS_TOTAL":
    case "RED_CARDS_TOTAL":
    case "CARDS_POINTS_OVER_UNDER":
    case "GOAL_KICKS_TOTAL":
    case "TEAM_GOAL_KICKS":
    case "TEAM_TOTAL_GOAL_KICKS":
    case "HOME_TEAM_TOTAL_GOAL_KICKS":
    case "AWAY_TEAM_GOAL_KICKS":
    case "THROW_INS_TOTAL":
    case "TEAM_TOTAL_THROW_INS":
    case "HOME_TEAM_TOTAL_THROW_INS":
    case "AWAY_TEAM_TOTAL_THROW_INS":
    case "FIRST_PERIOD_THROW_INS":
    case "OFFSIDES_TOTAL":
    case "HOME_TEAM_TOTAL_OFFSIDES":
    case "AWAY_TEAM_TOTAL_OFFSIDES":
    case "SUBSTITUTIONS_TOTAL":
    case "VAR_REVIEWS_TOTAL":
    case "MEDICAL_AIDS_TOTAL": {
      const overUnder = normalizeLvbetOverUnder(trimmed);
      if (overUnder) return overUnder;
      return normalizeOverUnderSelection(trimmed);
    }

    // 3-way corner/goal totals add an EXACTLY leg to the over/under pair.
    // TOTAL_GOALS_3WAY (audit-match, Arsenal vs Coventry City, GOLE/
    // TOTAL_GOALS index 10) shares the identical "Powyżej"/"Dokładnie"/
    // "Poniżej" vocabulary as lvbet's corner 3-way market.
    case "CORNERS_TOTAL_3WAY":
    case "TOTAL_GOALS_3WAY": {
      const overUnder = normalizeLvbetOverUnder(trimmed);
      if (overUnder) return overUnder;
      if (/^(dokładnie|dokladnie|exactly)\b/.test(normalizeMarketName(trimmed))) {
        return "EXACTLY" as NormalizedSelection;
      }
      return normalizeOverUnderSelection(trimmed);
    }

    // "Wynik i liczba bramek w meczu N" (audit-match, Arsenal vs Coventry
    // City, GOLE/TOTAL_GOALS index 10) bundles the plain 3-side x over/under
    // combo (matching the catalog's HOME_OVER/HOME_UNDER/DRAW_OVER/
    // DRAW_UNDER/AWAY_OVER/AWAY_UNDER vocabulary) together with SIX extra
    // double-chance + total legs ("(Arsenal lub remis) i powyżej…",
    // "Drużyna 1 lub Drużyna 2 i …") that have no slot in the catalog's
    // 3-side shape. Only the plain "<side> i <Powyżej/Poniżej>" shape is
    // mapped; anything else (including the double-chance legs) is dropped
    // (returns null) instead of leaking as UNKNOWN.
    case "RESULT_AND_TOTAL": {
      const m = trimmed.match(/^(.+?)\s+i\s+(powy[żz]ej|ponad|poni[żz]ej|mniej)\b/i);
      if (!m) return null;
      const overUnder = normalizeOverUnderSelection(m[2]);
      if (overUnder !== "OVER" && overUnder !== "UNDER") return null;
      const sideToken = normalizeMarketName(m[1].trim());
      const homeToken = ctx.homeTeam ? normalizeMarketName(ctx.homeTeam) : null;
      const awayToken = ctx.awayTeam ? normalizeMarketName(ctx.awayTeam) : null;
      let side: "HOME" | "DRAW" | "AWAY" | null = null;
      if (sideToken === "remis") side = "DRAW";
      else if (homeToken && sideToken === homeToken) side = "HOME";
      else if (awayToken && sideToken === awayToken) side = "AWAY";
      if (!side) return null;
      return `${side}_${overUnder}` as NormalizedSelection;
    }

    // LVBet quotes a 5-tier corner-range scale ("5 lub mniej", "6 - 8",
    // "9 - 11", "12 - 14", "15 lub więcej") with no direct catalog match —
    // collapse it onto the catalog's coarse 3-bucket scale (0-8/9-11/12+),
    // mirroring betcris' identical raw label set for this market.
    case "CORNERS_RANGE": {
      const compact = normalizeMarketName(trimmed).replace(/\s+/g, "");
      if (/^5lubmniej$/.test(compact) || /^6-8$/.test(compact)) return "0-8" as NormalizedSelection;
      if (/^9-11$/.test(compact)) return "9-11" as NormalizedSelection;
      if (/^12-14$/.test(compact) || /^15lubwiecej$/.test(compact)) return "12+" as NormalizedSelection;
      return null;
    }

    // Team-scoped stat totals whose catalog selections are side-prefixed
    // (HOME_OVER/...): derive the side from the raw market name (team name or
    // "Drużyna 1/2" index) and the direction from the selection label.
    case "CARDS_TEAM":
    case "HALF_TIME_CARDS_TEAM":
    case "SECOND_HALF_CARDS_TEAM":
    case "HALF_TIME_CORNERS_TEAM":
    case "SECOND_HALF_CORNERS_TEAM":
    case "HALF_TIME_TEAM_FOULS": {
      const overUnder = normalizeLvbetOverUnder(trimmed);
      if (!overUnder) {
        // Range buckets ("0-2", "7+") remain valid for CARDS_TEAM-style
        // catalogs — the literal passthrough above already resolved them.
        return null;
      }
      const side = detectTeamSide(rawMarketName ?? "", ctx);
      if (!side) return null;
      return `${side}_${overUnder}` as NormalizedSelection;
    }

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    case "OWN_GOAL":
    case "SUBSTITUTE_GOAL":
    case "TEAM_WIN_BOTH_HALVES":
    case "BOTH_HALVES_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    case "SECOND_HALF_ODD_EVEN_GOALS":
    case "HOME_TEAM_ODD_EVEN_GOALS":
    case "AWAY_TEAM_ODD_EVEN_GOALS":
    case "CORNERS_ODD_EVEN":
    case "HALF_TIME_CORNERS_ODD_EVEN":
    case "CARDS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
    // Stat-prop handicaps (corners/cards/fouls/shots/...) reuse the same
    // HOME/AWAY selection vocabulary and label formats.
    case "FIRST_15_MIN_HANDICAP":
    case "CORNERS_HANDICAP":
    case "HALF_TIME_CORNERS_HANDICAP":
    case "CARDS_HANDICAP":
    case "CARDS_POINTS_HANDICAP":
    case "HALF_TIME_CARDS_HANDICAP":
    case "SECOND_HALF_CARDS_HANDICAP":
    case "FOULS_HANDICAP":
    case "HALF_TIME_FOULS_HANDICAP":
    case "SHOTS_HANDICAP":
    case "SHOTS_ON_TARGET_HANDICAP":
    case "GOAL_KICKS_HANDICAP":
    case "THROW_INS_HANDICAP":
    case "OFFSIDES_HANDICAP": {
      const normalizedSel = normalizeMarketName(trimmed);
      if (/\b(druzyna|team)\s*1\b/.test(normalizedSel)) return "HOME";
      if (/\b(druzyna|team)\s*2\b/.test(normalizedSel)) return "AWAY";
      if (/^1\b/i.test(trimmed)) return "HOME";
      if (/^2\b/i.test(trimmed)) return "AWAY";
      if (/^x\b/i.test(trimmed) || /remis/i.test(trimmed)) return "DRAW";
      // Labels that repeat the market name end with the side index,
      // e.g. "Handicap (3-drogowy) 1" -> HOME, "... 2" -> AWAY
      if (/handicap/i.test(trimmed)) {
        if (/\b1$/.test(trimmed)) return "HOME";
        if (/\b2$/.test(trimmed)) return "AWAY";
      }
      // Team-name labels may carry the line in parentheses, e.g. "Austria (+2.5)"
      const teamPart = trimmed.replace(/\s*\([+-]?\d+(?:[.,]\d+)?\)\s*$/, "").trim();
      return normalize1x2Selection(teamPart, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "SCORE_DURING_MATCH": {
      // Raw labels are plain score pairs ("0-1", "2-1", ...) matching the
      // catalog's own code format — map them directly instead of collapsing
      // the whole grid into one UNKNOWN entry.
      const score = parseScoreSelection(trimmed);
      return score ? (score as NormalizedSelection) : null;
    }

    case "MULTI_RESULT": {
      // "1-0 / 2-0 / 3-0" -> catalog code "1:0, 2:0 lub 3:0" (mirrors the
      // betcris normalizer's transform for the identical raw grouping).
      const scores = trimmed.split("/").map((part) => part.trim());
      if (scores.length >= 2 && scores.every((s) => /^\d+\s*-\s*\d+$/.test(s))) {
        const colonScores = scores.map((s) => s.replace(/\s*-\s*/, ":"));
        const last = colonScores[colonScores.length - 1];
        return `${colonScores.slice(0, -1).join(", ")} lub ${last}` as NormalizedSelection;
      }
      if (/^(x|remis)$/i.test(trimmed)) return "X" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    // "Francja i 1" / "Remis i 0" / "Maroko i 2" -> HOME_1 / DRAW_0 / AWAY_2
    // (result + exact total-goals combo, redirected here from TOTAL_GOALS by
    // refineResultAndExactGoalsMisroutedAsTotalGoals).
    case "RESULT_AND_EXACT_GOALS": {
      const m = trimmed.match(/^(.+?)\s+i\s+(\d+)\s*(\+|lub\s*wi[eę]cej)?$/i);
      if (!m) return null;
      const side = normalize1x2Selection(m[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
      if (side !== "HOME" && side !== "DRAW" && side !== "AWAY") return null;
      const code = `${side}_${m[2]}${m[3] ? "+" : ""}`;
      return isCatalogSelection(marketCode, code) ? (code as NormalizedSelection) : null;
    }

    case "HALFTIME_FULLTIME":
    case "HALF_TIME_SECOND_HALF_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      if (htft) return htft as NormalizedSelection;
      // LVBet phrases these combos with team names: "Szwajcaria/Remis",
      // "Remis/Kolumbia", ... — resolve each leg against the match context.
      const parts = trimmed.split("/");
      if (parts.length === 2) {
        const left = normalize1x2Selection(parts[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
        const right = normalize1x2Selection(parts[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
        if (left !== "UNKNOWN" && right !== "UNKNOWN") {
          return `${left}_${right}` as NormalizedSelection;
        }
      }
      // Unresolvable labels are dropped so raw team-pair strings never leak
      // as pseudo selection codes.
      return null;
    }

    // "Arsenal/Arsenal i powyżej 2.5" -> HOME_HOME_OVER, "Remis / Coventry
    // City i poniżej 2.5" -> DRAW_AWAY_UNDER, ... (audit-match, Arsenal vs
    // Coventry City, round 8 — verified via implied-probability convergence
    // with betcris/etoto at the 2.5 line).
    case "HALFTIME_FULLTIME_AND_TOTAL": {
      const lowerSel = trimmed.toLowerCase();
      const andIdx = lowerSel.lastIndexOf(" i ");
      if (andIdx <= 0) return null;
      const overUnder = normalizeLvbetOverUnder(trimmed.slice(andIdx + 3).trim());
      if (!overUnder) return null;
      const legs = trimmed.slice(0, andIdx).split("/");
      if (legs.length !== 2) return null;
      const left = normalize1x2Selection(legs[0].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
      const right = normalize1x2Selection(legs[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
      if (left === "UNKNOWN" || right === "UNKNOWN") return null;
      const code = `${left}_${right}_${overUnder}`;
      return isCatalogSelection(marketCode, code) ? (code as NormalizedSelection) : null;
    }

    // 3-way team races with a NONE leg ("Nikt", "Nie będzie strzału
    // celnego") — the negative outcome must map to NONE, not UNKNOWN.
    case "FIRST_SHOT_ON_TARGET":
    case "CORNERS_RACE_TO":
    case "FIRST_CORNER":
    case "LAST_CORNER":
    case "FIRST_CARD":
    case "LAST_YELLOW_CARD": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(nikt|zaden|nie bedzie|brak)/.test(normalized)) return "NONE";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(bez|brak)\s*gol/.test(normalized) || normalized === "zaden" || normalized === "nikt") {
        return "NONE";
      }
      if (/^(obie|obydwie|both)/.test(normalized)) return "BOTH" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
    case "HALF_TIME_LAST_TEAM_TO_SCORE":
    case "SECOND_HALF_LAST_TEAM_TO_SCORE":
    case "NEXT_GOAL": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(bez|brak)\s*gol/.test(normalized)) return "NONE";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT":
    case "HOME_FIRST_GOAL_TIME":
    case "AWAY_FIRST_GOAL_TIME": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(bez|brak)/.test(normalized)) return "NONE";
      // "31-45+" / "76-90+" -> catalog codes without the trailing plus
      const rangeMatch = trimmed.match(/^(\d{1,2})\s*-\s*(\d{1,2})\+?$/);
      if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2]}` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "GOAL_RANGE":
    case "MULTI_GOAL_RANGE":
    case "TEAM_GOAL_RANGE":
    case "HALF_TIME_GOAL_RANGE":
    case "SECOND_HALF_GOAL_RANGE":
    case "HOME_GOAL_RANGE":
    case "AWAY_GOAL_RANGE": {
      const normalized = normalizeMarketName(trimmed);
      let code: string | null = null;
      // GOAL_RANGE's disjoint full-match brackets spell each band out in
      // words instead of digits ("0 lub 1", "4 do 6", "7 lub więcej") —
      // MULTI_GOAL_RANGE's ladder already quotes plain "1-2"/"2-3" digit
      // ranges, so these three only ever fire for the word-form market.
      const wordRangeMatch = normalized.match(/^(\d+)\s+(?:lub|do)\s+(\d+)$/);
      const wordPlusMatch = normalized.match(/^(\d+)\s+lub\s+wiecej$/);
      if (/^(bez|brak)\s*gol/.test(normalized) || normalized === "0") code = "0";
      else if (wordRangeMatch) code = `${wordRangeMatch[1]}-${wordRangeMatch[2]}`;
      else if (wordPlusMatch) code = `${wordPlusMatch[1]}+`;
      else if (/^\d+\+$/.test(trimmed)) code = trimmed;
      else if (/^\d+$/.test(trimmed)) code = trimmed;
      else {
        const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)\+?$/);
        if (rangeMatch) code = `${rangeMatch[1]}-${rangeMatch[2]}`;
      }
      // "Każdy inny" (LVBet's catch-all leftover band, spanning 0 AND 5+)
      // and any other unparsable label has no catalog counterpart — drop it
      // instead of leaking raw Polish text as a selection code.
      if (code === null) return null;
      // Only surface bands the catalog defines for this market: the team
      // ranges only support 0/1-2/1-3/2-3/4+, so LVBet's extended-band
      // extras (1-4, 2-4, 3-4) must not appear as orphan columns.
      return isCatalogSelection(marketCode, code) ? (code as NormalizedSelection) : null;
    }

    case "SECOND_HALF_TEAM_GOAL_RANGE": {
      // Catalog selections are side-prefixed ranges (HOME_1-2, AWAY_4+, ...)
      const side = detectTeamSide(rawMarketName ?? "", ctx) ?? "HOME";
      let code: string | null = null;
      if (/^\d+\+$/.test(trimmed)) code = `${side}_${trimmed}`;
      else {
        const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)\+?$/);
        if (rangeMatch) code = `${side}_${rangeMatch[1]}-${rangeMatch[2]}`;
      }
      // Drop "Każdy inny"/unparsable labels and bands the catalog does not
      // define (e.g. 2-4, 3-4) instead of leaking raw or orphan codes.
      if (code === null) return null;
      return isCatalogSelection(marketCode, code) ? (code as NormalizedSelection) : null;
    }

    case "HALF_WITH_MORE_GOALS":
    case "HALF_WITH_MORE_CORNERS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS": {
      // LVBet renders half comparison as "1 > 2" / "1 = 2" / "1 < 2"
      if (/^1\s*>\s*2$/.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^1\s*<\s*2$/.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^1\s*=\s*2$/.test(trimmed)) return "Draw" as NormalizedSelection;
      const normalized = normalizeMarketName(trimmed);
      if (normalized.includes("1. połowa")) return "1st" as NormalizedSelection;
      if (normalized.includes("2. połowa")) return "2nd" as NormalizedSelection;
      if (normalized.includes("remis") || normalized.includes("rowno")) {
        return "Draw" as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    // "Połowa z większą liczbą goli: Podwójna szansa" (audit-match, Arsenal
    // vs Coventry City, GOLE/HALF_WITH_MORE_GOALS index 43) — a genuine
    // double-chance product with its own catalog selections, distinct from
    // the plain 1st/Draw/2nd HALF_WITH_MORE_GOALS shape above.
    case "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE": {
      const normalized = normalizeMarketName(trimmed);
      if (/^1\.?\s*lub\s*2\.?$/.test(normalized)) return "1ST_OR_2ND" as NormalizedSelection;
      if (/^1\..*rowno$/.test(normalized)) return "1ST_OR_DRAW" as NormalizedSelection;
      if (/^2\..*rowno$/.test(normalized)) return "2ND_OR_DRAW" as NormalizedSelection;
      return null;
    }

    case "BTTS_BY_HALF": {
      // "Tak/Tak" = both halves, "Tak/Nie" = 1st only, "Nie/Tak" = 2nd only
      if (/^tak\s*\/\s*tak$/i.test(trimmed)) return "Both" as NormalizedSelection;
      if (/^tak\s*\/\s*nie$/i.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^nie\s*\/\s*tak$/i.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^nie\s*\/\s*nie$/i.test(trimmed)) return "None" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "TEAM_SCORE_BY_HALF": {
      // "Tak/Nie" pairs = (scores in 1st half)/(scores in 2nd half); the
      // catalog vocabulary is YES_YES/YES_NO/NO_YES/NO_NO.
      if (/^tak\s*\/\s*tak$/i.test(trimmed)) return "YES_YES";
      if (/^tak\s*\/\s*nie$/i.test(trimmed)) return "YES_NO";
      if (/^nie\s*\/\s*tak$/i.test(trimmed)) return "NO_YES";
      if (/^nie\s*\/\s*nie$/i.test(trimmed)) return "NO_NO";
      return "UNKNOWN";
    }

    case "PENALTY_GOAL":
    case "HALF_TIME_PENALTY_GOAL":
    case "SECOND_HALF_PENALTY_GOAL": {
      // Catalog vocabulary for penalty-goal markets is TEAM_HOME/TEAM_AWAY/
      // ANY/NONE — plain HOME/AWAY codes are orphaned by the aggregator.
      const normalized = normalizeMarketName(trimmed);
      if (/\b(ktorakolwiek|ktorykolwiek|ktokolwiek|dowolna|dowolny|any)\b/.test(normalized)) {
        return "ANY";
      }
      if (/^(nie|no|brak|zaden|zadna|nikt)\b/.test(normalized)) return "NONE";
      const side = normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
      if (side === "HOME") return "TEAM_HOME";
      if (side === "AWAY") return "TEAM_AWAY";
      return "UNKNOWN";
    }

    case "EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS":
    case "HALF_TIME_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS":
    case "HALF_TIME_HOME_EXACT_GOALS":
    case "SECOND_HALF_HOME_EXACT_GOALS": {
      // Exact-goal labels are numeric ("0", "1", "2", "3", "4+") — they must
      // NOT fall through to the 1X2 fallback, which mis-coded them as
      // HOME/AWAY/DRAW. LVBet's grouped bands ("0 lub 1", "4 do 6", "7 lub
      // więcej") have no catalog counterpart and are dropped, but a bare
      // numeric tail beyond the catalog's exact buckets ("2", "3", "5") is
      // folded into the market's own "N+" catch-all instead of being
      // silently discarded.
      const compact = trimmed.replace(/\s+/g, "");
      if (!/^\d+\+?$/.test(compact)) return null;
      // A raw "(n)+" tail (e.g. LVBet's "4+" meaning four-or-more) folds
      // into the SAME catalog "N+" catch-all bucket as a lower literal
      // sibling (e.g. a separate literal "3") whenever both values are at
      // or above that bucket's threshold — genuinely the same outcome, not
      // a narrowing conflict. Both are mapped to that shared code here; the
      // caller combines same-code duplicates' implied probabilities into
      // one fair price via mergeDuplicateCodedSelections instead of
      // silently dropping either raw quote (audit-match, Arsenal vs
      // Coventry City, POLOWY/HALF_TIME_EXACT_GOALS index 218: LVBet's own
      // "3"=5.8 and "4+"=11 were being collapsed into a single "3+"=5.8,
      // dropping the "4+" leg's probability mass and overstating the
      // combined line's true odds).
      return mergeIntoExactGoalsCatchAll(marketCode, compact);
    }

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      // "Argentyna i Tak" / "Remis i Nie" -> HOME_YES / DRAW_NO ...
      const lowerSel = trimmed.toLowerCase();
      const andIdx = lowerSel.lastIndexOf(" i ");
      if (andIdx > 0) {
        const sidePart = normalize1x2Selection(
          trimmed.slice(0, andIdx).trim(), ctx.homeTeam, ctx.awayTeam, ctx.league
        );
        const ynPart = normalizeYesNoSelection(trimmed.slice(andIdx + 3).trim());
        if (
          (sidePart === "HOME" || sidePart === "DRAW" || sidePart === "AWAY") &&
          (ynPart === "YES" || ynPart === "NO")
        ) {
          return `${sidePart}_${ynPart}` as NormalizedSelection;
        }
      }
      return trimmed as NormalizedSelection;
    }

    case "TOTAL_GOALS_AND_BTTS": {
      // "Tak i powyżej 3.5" / "Nie i poniżej 2.5" -> OVER_YES / UNDER_NO
      // (audit r9: this combo used to collide onto plain BTTS/TOTAL_GOALS —
      // see resolveMarketCode's "obie druzyny strzela i powyzej/ponizej"
      // route). Order matches the catalog's ["OVER_YES","UNDER_YES",
      // "OVER_NO","UNDER_NO"] — Y/N comes first in the raw label, O/U second.
      const lowerSel = trimmed.toLowerCase();
      const andIdx = lowerSel.indexOf(" i ");
      if (andIdx > 0) {
        const ynPart = normalizeYesNoSelection(trimmed.slice(0, andIdx).trim());
        const ouPart = normalizeOverUnderSelection(trimmed.slice(andIdx + 3).trim());
        if ((ynPart === "YES" || ynPart === "NO") && (ouPart === "OVER" || ouPart === "UNDER")) {
          return `${ouPart}_${ynPart}` as NormalizedSelection;
        }
      }
      return "UNKNOWN" as NormalizedSelection;
    }

    // "Sposób zdobycia pierwszego gola" (audit-match, Arsenal vs Coventry
    // City, GOLE/FIRST_GOAL_METHOD): had no dedicated case, so every
    // selection fell through the default branch's YES/NO -> OVER/UNDER ->
    // 1X2 fallbacks and landed on UNKNOWN, collapsing all 6 raw prices into
    // one shared UNKNOWN row. The catalog now has 6 outcomes (HEADER/PENALTY/
    // FREE_KICK/OWN_GOAL/NO_GOAL/OTHER, see market-catalog.ts) so "Gol
    // samobójczy" (own goal) and "Bez goli" (no goals) map instead of dropping.
    case "FIRST_GOAL_METHOD": {
      const normalized = normalizeMarketName(trimmed);
      if (/^z głowki$/.test(normalized)) return "HEADER" as NormalizedSelection;
      if (/^z rzutu karnego$/.test(normalized)) return "PENALTY" as NormalizedSelection;
      if (/^z rzutu wolnego$/.test(normalized)) return "FREE_KICK" as NormalizedSelection;
      if (/^inna metoda$/.test(normalized)) return "OTHER" as NormalizedSelection;
      if (/^gol samobojczy$/.test(normalized)) return "OWN_GOAL" as NormalizedSelection;
      if (/^bez goli$/.test(normalized)) return "NO_GOAL" as NormalizedSelection;
      return null;
    }

    // Single-player markets: keep each player as its own selection code (the
    // raw label is the player name) instead of collapsing all into UNKNOWN.
    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "HOME_GOALSCORER_FIRST":
    case "AWAY_GOALSCORER_FIRST":
    case "HOME_GOALSCORER_LAST":
    case "AWAY_GOALSCORER_LAST":
    case "HALF_TIME_GOALSCORER_ANYTIME":
    case "SECOND_HALF_GOALSCORER_ANYTIME":
    case "PLAYER_GOALS":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_FOULS":
    case "PLAYER_FOULS_WON":
    case "PLAYER_FOULS_OVER":
    case "PLAYER_SHOTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_SHOTS_OVER":
    case "PLAYER_TACKLES":
    case "PLAYER_SAVES":
    case "GOALKEEPER_SAVES_OVER":
    case "PLAYER_RED_CARD":
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_GOAL_OUTSIDE_BOX":
    case "PLAYER_SCORES_BOTH_HALVES":
    case "PLAYER_2_OR_MORE_GOALS":
    case "PLAYER_3_OR_MORE_GOALS":
    case "PLAYER_4_OR_MORE_GOALS":
    case "PENALTY_SCORER":
    case "PLAYER_GOAL_TEAM_LOSES":
    case "PLAYER_GOAL_AND_RESULT":
    case "FIRST_CARD_PLAYER": {
      const normalized = normalizeMarketName(trimmed);
      if (/^(nikt|zaden|zadny|bez gola|bez goli|brak gola|brak goli)$/.test(normalized)) {
        return "NONE";
      }
      // Bulk player-roster markets are pre-split by the parser into one entry
      // per player, with the market's real threshold synthesized as a
      // "Powyżej X" marker (the raw player name moved to paramValue) — map it
      // to the market's threshold-tiered catalog code. A recognized marker
      // with no matching catalog tier is dropped (not a real player name)
      // instead of falling through to the player-name passthrough below.
      if (/^powyzej(\s*\d+(?:[.,]\d+)?)?$/.test(normalized)) {
        return normalizeLvbetPlayerThreshold(marketCode, trimmed);
      }
      // PLAYER_3_OR_MORE_GOALS / PLAYER_4_OR_MORE_GOALS (audit-match, Arsenal
      // vs Coventry City, round 8): both are fed by the SAME parser pattern
      // (BULK_PLAYER_LIST_MARKET_PATTERNS' "Zawodnik strzeli N lub więcej
      // goli", N>=3), which now synthesizes a fixed "Tak" marker for this
      // YES/NO per-player product — map it to the catalog's YES code before
      // falling through to the player-name passthrough. (The Sub-Hero-suffixed
      // variant of either market is never bulk-split, so it never reaches
      // this branch — it falls through to canonicalizePlayerName as before.)
      if (
        (marketCode === "PLAYER_3_OR_MORE_GOALS" || marketCode === "PLAYER_4_OR_MORE_GOALS") &&
        normalized === "tak"
      ) {
        return "YES";
      }
      // Same bulk-split convention for "Zawodnik strzeli gola i mecz zakończy
      // się remisem" (player scores AND match ends in a draw): every row
      // prices the fixed DRAW outcome, synthesized as the "Remis" marker.
      if (marketCode === "PLAYER_GOAL_AND_RESULT" && normalized === "remis") {
        return "DRAW";
      }
      // Unify player-name order via the shared canonical form
      // ("Lastname, Firstname" -> "Firstname Lastname") so lvbet merges with
      // bookmakers quoting the comma convention, plus lvbet-specific
      // full-name aliases (see LVBET_PLAYER_NAME_ALIASES).
      return normalizeLvbetPlayerName(trimmed) as NormalizedSelection;
    }

    // Player pair/trio combos: reduce to the shared "I. Surname & I. Surname"
    // canonical form (audit-match, Arsenal vs Coventry City, round 8) so
    // LVBet's "Kai Havertz and Viktor Gyokeres"-style combos merge with
    // betclic's pre-abbreviated "C. Tzolis & K. Havertz" and superbet's
    // "Tzolis, Christos i Havertz, Kai" for the same real-world pairing —
    // the previous local split+join kept full un-abbreviated names, which
    // never matched those peers' selection codes.
    case "BOTH_PLAYERS_ANYTIME":
    case "TWO_PLAYERS_ANYTIME":
    case "THREE_PLAYERS_ANYTIME":
    case "ALL_PLAYERS_SCORE":
    case "ANY_PLAYER_FIRST_GOAL":
    case "PLAYER_ASSIST_PAIRS":
      return canonicalizePlayerComboSelection(trimmed) as NormalizedSelection;

    default: {
      // Generic fallback: LVBet exposes many YES/NO prop markets ("Tak"/"Nie")
      // that have no dedicated case — resolve those before trying 1X2/team names.
      const yesNo = normalizeYesNoSelection(trimmed);
      if (yesNo !== "UNKNOWN") return yesNo;
      // Over/Under wording appears on niche stat totals with no dedicated
      // case — resolve it before the 1X2 fallback so both legs do not
      // collapse into one shared UNKNOWN key.
      const overUnder = normalizeLvbetOverUnder(trimmed);
      if (overUnder) return overUnder;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
    }
  }
}

/**
 * 3-way (European) goal handicaps whose LVBet label sign is INVERTED relative
 * to the catalog/peers ("Handicap (3-drogowy) -1" prices what peers price at
 * "+1" — round-2 audit verification). The full-match 2-way Asian handicap is
 * NOT inverted: the full-data audit confirmed via 10-bookmaker consensus that
 * LVBet's "Handicap Azjatycki 0.5" prices the catalog's "+0.5" bucket, so
 * negating every line mirrored the whole market onto wrong params. That
 * verification does NOT extend to FIRST_HALF_ASIAN_HANDICAP, though: a
 * dedicated audit (round 3, reconfirmed round 5) found every non-zero
 * first-half line mirrored onto the wrong sign relative to peer consensus.
 * CARDS_HANDICAP was likewise found sign-inverted (its own line progression
 * trends the opposite direction from betcris/fuksiarz/superbet's).
 * CORNERS_HANDICAP was confirmed sign-inverted across its ENTIRE curve
 * (round-1 audit, Argentina vs Switzerland, confidence 0.93): every non-zero
 * lvbet line for value=+X matches the 10-bookmaker peer consensus for
 * value=-X and vice versa (value=0 already agreed with peers directly,
 * isolating the bug to the sign of non-zero lines, not a HOME/AWAY swap).
 */
const LVBET_SIGN_INVERTED_HANDICAP_MARKETS = new Set<NormalizedMarketType>([
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_EUROPEAN_HANDICAP",
  "SECOND_HALF_EUROPEAN_HANDICAP",
  "FIRST_HALF_ASIAN_HANDICAP",
  "CARDS_HANDICAP",
  "CORNERS_HANDICAP",
  "HALF_TIME_CORNERS_HANDICAP",
]);

/**
 * SECOND_HALF_ASIAN_HANDICAP markets whose raw label omits the sign on a
 * generic line ("Handicap 1", "Handicap 2", vs. the usual explicit
 * "Handicap -2.5"/"Handicap +0.5"). Cross-checked against 4 peer bookmakers'
 * monotonic line progression: an unsigned trailing number here means the
 * HOME side is favored by that amount (i.e. it should resolve as negative),
 * not the positive default parseLvbetHandicapParam would otherwise produce.
 */
const LVBET_HANDICAP_DEFAULT_NEGATIVE_UNSIGNED_MARKETS = new Set<NormalizedMarketType>([
  "SECOND_HALF_ASIAN_HANDICAP",
]);

/**
 * Extracts the handicap line from an LVBet market name. The scraper appends
 * the line value at the END of the name ("1. Połowa - Handicap 2",
 * "Handicap (3-drogowy) 1", "Handicap -2.5"), so the LAST number is the line.
 * Digits of the "3-drogowy" qualifier, the "1./2. Połowa" prefix and minute
 * windows ("1-15 min.") are stripped first so they are never mistaken for
 * the line. The sign is negated for the markets listed in
 * LVBET_SIGN_INVERTED_HANDICAP_MARKETS (see comment there); for markets in
 * LVBET_HANDICAP_DEFAULT_NEGATIVE_UNSIGNED_MARKETS, a trailing number with NO
 * explicit sign character defaults to negative instead of positive.
 */
function parseLvbetHandicapParam(
  name: string,
  invertSign: boolean,
  defaultNegativeWhenUnsigned: boolean
): string | undefined {
  const cleaned = name
    .replace(/3[-\s]?drogow\w*/gi, "")
    .replace(/[12]\.\s*połowa/gi, "")
    .replace(/\d+\s*-\s*\d+\s*min\.?/gi, "");
  const matches = cleaned.match(/[+-]?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length === 0) return undefined;
  const lastMatch = matches[matches.length - 1];
  const value = parseFloat(lastMatch.replace(",", "."));
  if (Number.isNaN(value)) return undefined;
  let line = invertSign ? -value : value;
  if (defaultNegativeWhenUnsigned && !/^[+-]/.test(lastMatch) && line > 0) {
    line = -line;
  }
  if (line > 0) return `+${line}`;
  return `${line}`;
}

/**
 * Extracts a whole-number over/under line from selection labels
 * ("Ponad 9" / "Powyżej (9)") — parseOverUnderLine only recognizes decimals,
 * so integer corner/card lines used to fall into the parameterless bucket.
 */
function parseLvbetStatLine(selectionNames: string[]): string | undefined {
  for (const name of selectionNames) {
    const normalized = normalizeMarketName(name);
    const match = normalized.match(/^(?:powyzej|ponizej|ponad|wiecej|mniej|over|under)\D*(\d+(?:\.\d+)?)/);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Team-scoped stat markets whose catalog selections are plain OVER/UNDER
 * (no side prefix). LVBet quotes each team's line as a SEPARATE raw market
 * ("Strzały: Maroko suma" / "Strzały: Francja suma"), so without a side
 * marker both teams' lines land in the same bare numeric bucket and their
 * odds silently collide. Prefixing paramValue with HOME:/AWAY: (the
 * betclic/betcris/forbet/fortuna/superbet convention) keeps them separate.
 */
const LVBET_TEAM_SCOPED_DECIMAL_MARKETS = new Set<NormalizedMarketType>([
  "TEAM_TOTAL_SHOTS",
  "TEAM_TOTAL_SHOTS_ON_TARGET",
  "CORNERS_TEAM",
  "TEAM_TOTAL_FOULS",
]);

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): string | undefined {
  const metadata = getMarketMetadata(marketCode);
  if (!metadata?.hasParameter) return undefined;

  // LVBet used to bundle a whole player roster under ONE raw market per stat
  // threshold ("Zawodnicy (strzały celne) - powyżej 4.5" lists every eligible
  // player). The PARSER now splits these into one synthetic raw market per
  // player (see splitBulkPlayerListMarket in the lvbet scraper's parser.ts),
  // carrying the player's raw name via raw.paramValue since there is no
  // numeric line to report for a player-keyed market. Prefer that pre-split
  // value for every player-parameterized code; markets the parser does not
  // split (e.g. GOALSCORER_ANYTIME, GOALKEEPER_SAVES_OVER) leave raw.paramValue
  // unset and fall through to the grouper's bundled-player-selection recovery.
  if (metadata.parameterType === "player" && raw.paramValue) {
    return normalizeLvbetPlayerName(raw.paramValue);
  }

  const selectionNames = raw.selections.map((s) => s.name);
  const marketName = raw.name;

  switch (metadata.parameterType) {
    case "handicap":
      // A handicap name with no visible number is a level (0) line — LVBet
      // omits the zero instead of printing "Handicap 0".
      return (
        parseLvbetHandicapParam(
          marketName,
          LVBET_SIGN_INVERTED_HANDICAP_MARKETS.has(marketCode),
          LVBET_HANDICAP_DEFAULT_NEGATIVE_UNSIGNED_MARKETS.has(marketCode)
        ) ??
        parseOverUnderLine(selectionNames) ??
        "0"
      );
    case "integer":
      // "1-60 min. - Zwycięzca" -> param "60" (the window's END minute).
      // parseIntegerLine has no way to know this specific shape's SECOND
      // number is the real line — it would grab the leading "1" instead.
      if (marketCode === "TIME_PERIOD_RESULT") {
        const windowMatch = marketName.match(/^\d+-(\d+)\s*min\b/i);
        if (windowMatch) return windowMatch[1];
      }
      return parseIntegerLine(marketName) ?? parseOverUnderLine(selectionNames);
    case "decimal": {
      const line =
        parseDecimalLine(marketName) ??
        parseOverUnderLine(selectionNames) ??
        parseLvbetStatLine(selectionNames);
      if (line && LVBET_TEAM_SCOPED_DECIMAL_MARKETS.has(marketCode)) {
        const side = detectTeamSide(marketName, ctx);
        if (side) return `${side}:${line}`;
      }
      return line;
    }
    default:
      return parseOverUnderLine(selectionNames) ?? parseLvbetStatLine(selectionNames);
  }
}

/**
 * A handful of "who does more X" 3-way race markets (MOST_SHOTS_ON_TARGET,
 * MOST_SHOTS, CORNERS_RACE, FOUL_RACE) share a raw market-name prefix with
 * the corresponding team-total OVER/UNDER market ("Strzały celne: Wynik" vs
 * "Strzały celne: <Team> suma"). When the generic team-total name pattern
 * wins by mistake, its RAW SELECTIONS are team names / "Remis" instead of
 * "Powyżej"/"Poniżej" text — the OVER/UNDER catalog code cannot represent
 * that shape, so every selection ends up UNKNOWN. Detect the shape (exactly
 * 3 selections, all resolving to HOME/DRAW/AWAY) and redirect to the sibling
 * race code instead of leaking raw team names as UNKNOWN under a
 * numeric-parameter market.
 */
const TEAM_TOTAL_TO_RACE_CODE: Partial<Record<NormalizedMarketType, NormalizedMarketType>> = {
  TEAM_TOTAL_SHOTS_ON_TARGET: "MOST_SHOTS_ON_TARGET",
  TEAM_TOTAL_SHOTS: "MOST_SHOTS",
  CORNERS_TEAM: "CORNERS_RACE",
  TEAM_TOTAL_FOULS: "FOUL_RACE",
};

/**
 * LVBet publishes team-scoped variants of the goalscorer markets ("Arsenal -
 * Ostatni strzelec") under the same names the generic patterns match. The
 * audit (/audit-match, Arsenal vs Coventry City) found the team variant
 * occupying GOALSCORER_LAST — the player list was truncated to one side and
 * the genuine match-wide market never surfaced.
 */
const TEAM_SCOPED_SCORER_CODE: Partial<
  Record<NormalizedMarketType, { home: NormalizedMarketType; away: NormalizedMarketType }>
> = {
  GOALSCORER_FIRST: { home: "HOME_GOALSCORER_FIRST", away: "AWAY_GOALSCORER_FIRST" },
  GOALSCORER_LAST: { home: "HOME_GOALSCORER_LAST", away: "AWAY_GOALSCORER_LAST" },
};

/**
 * A "1-30 min." style prefix scopes the market to a time window. Audit
 * /audit-match (Arsenal vs Coventry City) found "1-30 min. - Arsenal liczba
 * goli" inside the FULL-MATCH HOME_TEAM_TOTAL_GOALS slider (OVER 1.77 at the
 * 0.5 line against a full-match consensus of ~1.05), so a 30-minute price was
 * being compared with 90-minute ones. Unless the resolved code is itself
 * time-scoped, such an entry must stay out of the canonical market.
 */
function isTimeWindowScoped(name: string): boolean {
  return /^\s*\d+\s*-\s*\d+\s*min\.?/i.test(name);
}

function isTimeScopedCode(code: NormalizedMarketType): boolean {
  return /MIN|TIME_PERIOD|INTERVAL|SEGMENT|BAND/.test(code);
}

function refineTeamScopedScorer(
  code: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext,
): NormalizedMarketType {
  const variants = TEAM_SCOPED_SCORER_CODE[code];
  if (!variants) return code;
  // Only a "<team> - <market>" prefix scopes the market; a team name appearing
  // later in the label (e.g. inside a combo) must not trigger the switch.
  const prefix = raw.name.split(/\s[-–]\s/)[0];
  if (prefix === raw.name) return code;
  const side = detectTeamSide(prefix, ctx);
  if (side === "HOME") return variants.home;
  if (side === "AWAY") return variants.away;
  return code;
}

function refineRaceMisroutedAsTeamTotal(
  code: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): NormalizedMarketType {
  const raceCode = TEAM_TOTAL_TO_RACE_CODE[code];
  if (!raceCode || raw.selections.length !== 3) return code;
  const allResolve3Way = raw.selections.every((s) => {
    const side = normalize1x2Selection(s.name, ctx.homeTeam, ctx.awayTeam, ctx.league);
    return side === "HOME" || side === "DRAW" || side === "AWAY";
  });
  return allResolve3Way ? raceCode : code;
}

/**
 * "Wynik i dokładna liczba goli" combo selections ("Francja i 1", "Remis i
 * 0", "Maroko i 2") share the generic goals-total name pattern with
 * TOTAL_GOALS and land there by default, but their shape ("<team or draw> i
 * <exact count>") does not fit TOTAL_GOALS' OVER/UNDER catalog code at all
 * (every selection ends up UNKNOWN). Detect the shape from the selections
 * themselves and redirect to the dedicated RESULT_AND_EXACT_GOALS combo code.
 */
function refineResultAndExactGoalsMisroutedAsTotalGoals(
  code: NormalizedMarketType,
  raw: RawBookmakerMarket,
  ctx: NormalizationContext
): NormalizedMarketType {
  if (code !== "TOTAL_GOALS" || raw.selections.length === 0) return code;
  const allMatch = raw.selections.every((sel) => {
    const m = sel.name.match(/^(.+?)\s+i\s+\d+\+?$/i);
    if (!m) return false;
    const side = normalize1x2Selection(m[1].trim(), ctx.homeTeam, ctx.awayTeam, ctx.league);
    return side === "HOME" || side === "DRAW" || side === "AWAY";
  });
  return allMatch ? "RESULT_AND_EXACT_GOALS" : code;
}

/**
 * Generic same-code duplicate merge, used wherever LVBet's raw scale is
 * coarser or finer than the catalog's bucket ladder and two (or more) raw
 * selections legitimately land on the same catalog code:
 *  - CORNERS_RANGE collapses LVBet's 5-tier raw scale onto the catalog's
 *    coarse 3-bucket scale (see the CORNERS_RANGE case in
 *    normalizeSelectionForMarket): "5 lub mniej"+"6 - 8" -> "0-8";
 *    "12 - 14"+"15 lub więcej" -> "12+" (round-1 audit, Argentina vs
 *    Switzerland — bucket collision confirmed structurally).
 *  - HALF_TIME_EXACT_GOALS/SECOND_HALF_EXACT_GOALS/... fold a literal count
 *    at or above the catalog's top threshold together with LVBet's own
 *    "N+" tail onto the same "<threshold>+" catch-all code (audit-match,
 *    Arsenal vs Coventry City, POLOWY/HALF_TIME_EXACT_GOALS index 218:
 *    literal "3"=5.8 and "4+"=11 both belong under "3+").
 * Left uncombined, only the first-seen sub-selection survives downstream
 * dedup and the other's price is silently dropped. Combine colliding
 * sub-selections' prices via summed implied probability (1 / (1/o1 + 1/o2))
 * so exactly one correctly-priced selection per bucket is emitted,
 * mirroring the forbet/fuksiarz normalizers' identical pattern for
 * duplicate-coded selections.
 */
const EXACT_GOALS_MERGE_FAMILY = new Set<NormalizedMarketType>([
  "EXACT_GOALS",
  "HOME_EXACT_GOALS",
  "AWAY_EXACT_GOALS",
  "HALF_TIME_EXACT_GOALS",
  "SECOND_HALF_EXACT_GOALS",
  "HALF_TIME_HOME_EXACT_GOALS",
  "SECOND_HALF_HOME_EXACT_GOALS",
]);

function mergeDuplicateCodedSelections(
  selections: Array<{ code: NormalizedSelection; label: string; odds: number }>
): Array<{ code: NormalizedSelection; label: string; odds: number }> {
  const byCode = new Map<string, { code: NormalizedSelection; label: string; odds: number }>();
  const order: string[] = [];

  for (const sel of selections) {
    const existing = byCode.get(sel.code);
    if (!existing) {
      byCode.set(sel.code, { ...sel });
      order.push(sel.code);
      continue;
    }
    if (existing.odds > 0 && sel.odds > 0) {
      existing.odds = Math.round((1 / (1 / existing.odds + 1 / sel.odds)) * 100) / 100;
    }
    existing.label = `${existing.label} / ${sel.label}`;
  }

  return order.map((code) => byCode.get(code)!);
}

/**
 * Markets whose raw selection LABEL is itself the player's name (see the
 * shared case block in normalizeSelectionForMarket ending in
 * `normalizeLvbetPlayerName(trimmed)`). When LVBET_PLAYER_NAME_ALIASES folds
 * two raw rows for the SAME real player onto one code within one of these
 * markets, dedupePlayerNameDuplicates must resolve the resulting collision.
 */
const PLAYER_NAME_AS_SELECTION_CODE_MARKETS = new Set<NormalizedMarketType>([
  "GOALSCORER_FIRST",
  "GOALSCORER_LAST",
  "GOALSCORER_ANYTIME",
  "HOME_GOALSCORER_FIRST",
  "AWAY_GOALSCORER_FIRST",
  "HOME_GOALSCORER_LAST",
  "AWAY_GOALSCORER_LAST",
  "HALF_TIME_GOALSCORER_ANYTIME",
  "SECOND_HALF_GOALSCORER_ANYTIME",
  "PLAYER_GOALS",
  "PLAYER_CARDS",
  "PLAYER_ASSISTS",
  "PLAYER_FOULS",
  "PLAYER_FOULS_WON",
  "PLAYER_FOULS_OVER",
  "PLAYER_SHOTS",
  "PLAYER_SHOTS_ON_TARGET",
  "PLAYER_SHOTS_OVER",
  "PLAYER_TACKLES",
  "PLAYER_SAVES",
  "GOALKEEPER_SAVES_OVER",
  "PLAYER_RED_CARD",
  "PLAYER_HEADER_GOAL",
  "PLAYER_GOAL_AND_ASSIST",
  "PLAYER_GOAL_OR_ASSIST",
  "PLAYER_GOAL_OUTSIDE_BOX",
  "PLAYER_SCORES_BOTH_HALVES",
  "PLAYER_2_OR_MORE_GOALS",
  "PLAYER_3_OR_MORE_GOALS",
  "PLAYER_4_OR_MORE_GOALS",
  "PENALTY_SCORER",
  "PLAYER_GOAL_TEAM_LOSES",
  "PLAYER_GOAL_AND_RESULT",
  "FIRST_CARD_PLAYER",
]);

/**
 * Resolves a same-code collision caused by LVBET_PLAYER_NAME_ALIASES folding
 * two distinct raw rows for the SAME real player (e.g. "Ellis Reco Simms"
 * and "Ellis Simms", audit-match Arsenal vs Coventry City round 6) onto one
 * selection code within a single raw market. Unlike
 * mergeDuplicateCodedSelections (which sums implied probability because its
 * callers combine genuinely DIFFERENT sub-outcomes into one bucket), both
 * rows here price the EXACT SAME real-world bet — LVBet's own duplicate
 * listing, not two alternative ways to win — so the correct resolution is to
 * keep the single best (highest) price instead of blending them into a
 * lower, fabricated one.
 */
function dedupePlayerNameDuplicates(
  selections: Array<{ code: NormalizedSelection; label: string; odds: number }>
): Array<{ code: NormalizedSelection; label: string; odds: number }> {
  const byCode = new Map<string, { code: NormalizedSelection; label: string; odds: number }>();
  const order: string[] = [];

  for (const sel of selections) {
    const existing = byCode.get(sel.code);
    if (!existing) {
      byCode.set(sel.code, { ...sel });
      order.push(sel.code);
      continue;
    }
    if (sel.odds > existing.odds) {
      existing.odds = sel.odds;
      existing.label = sel.label;
    }
  }

  return order.map((code) => byCode.get(code)!);
}

export const lvbetNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "lvbet",

  normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
    const resolved = resolveMarketCode(raw, ctx);
    let marketCode = refineRaceMisroutedAsTeamTotal(resolved.code, raw, ctx);
    marketCode = refineResultAndExactGoalsMisroutedAsTotalGoals(marketCode, raw, ctx);
    marketCode = refineTeamScopedScorer(marketCode, raw, ctx);
    // "(Sub-Hero)" is a promotional LABEL, not a different market: the audit
    // (/audit-match, Arsenal vs Coventry City) found e.g. "Strzelec bramki"
    // and "Strzelec bramki (Sub-Hero)" carrying bit-identical odds per
    // player, and four goalscorer families (GOALSCORER_FIRST, GOALSCORER_LAST,
    // PLAYER_2_OR_MORE_GOALS, PLAYER_3_OR_MORE_GOALS) exist ONLY under the
    // Sub-Hero-suffixed name — excluding it to OTHER dropped those four
    // families entirely instead of merely deduplicating a promo label. The
    // existing unanchored substring patterns above (e.g. "strzelec bramki",
    // "strzelec pierwszego gola") already match the suffixed raw name and
    // resolve it to the SAME marketKey as its non-suffixed sibling when both
    // exist; the per-match Map in saveBatchFullOfferMarkets then keeps only
    // the last-processed one, which is harmless since both carry identical
    // selections/odds (verified above) — an intentional within-bookmaker
    // duplicate collapse, not a real market loss.
    if (isTimeWindowScoped(raw.name) && !isTimeScopedCode(marketCode)) marketCode = "OTHER";
    const { matchedBy } = resolved;

    // Deliberately excluded markets must not share the single "OTHER" market
    // key: unrelated YES/NO props (e.g. half-time exact-margin bets) were
    // merging with other bookmakers' props under one pseudo-market. Returning
    // null lets the factory key them per raw name instead.
    if (marketCode === "OTHER") {
      return null;
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[lvbet] Market code "${marketCode}" not in catalog`);
      return null;
    }

    const paramValue = extractParamValue(marketCode, raw, ctx);
    const marketKey = buildMarketKey(marketCode, paramValue);

    // Selections that resolve to null have no catalog counterpart (grouped
    // bands, catch-all buckets, ...) and are dropped so they never leak raw
    // labels or orphan codes into the cross-bookmaker aggregation.
    const siblingSelectionNames = raw.selections.map((s) => s.name);
    let selections = raw.selections.flatMap((sel) => {
      const code = normalizeSelectionForMarket(sel.name, marketCode, ctx, raw.name, siblingSelectionNames);
      if (code === null) return [];
      return [{ code, label: sel.name, odds: sel.odds }];
    });

    // Combine raw sub-selections that collide on the same catalog code
    // (CORNERS_RANGE's 5-tier-to-3-bucket collapse; the exact-goals
    // family's literal-count-vs-"N+"-tail fold) instead of letting
    // downstream dedup silently drop one of them.
    if (marketCode === "CORNERS_RANGE" || EXACT_GOALS_MERGE_FAMILY.has(marketCode)) {
      selections = mergeDuplicateCodedSelections(selections);
    }

    // A player-name-aliased duplicate (LVBET_PLAYER_NAME_ALIASES, e.g. "Ellis
    // Reco Simms" -> "Ellis Simms") collides on the SAME selection code
    // within one raw market — keep the single best price instead of letting
    // downstream first-seen-wins tie-breaks surface the worse duplicate.
    if (PLAYER_NAME_AS_SELECTION_CODE_MARKETS.has(marketCode)) {
      selections = dedupePlayerNameDuplicates(selections);
    }

    // A market whose every selection was dropped carries no usable data
    // (e.g. LVBet's grouped-band exact-goals product) — exclude it entirely.
    if (selections.length === 0) return null;

    return {
      marketCode,
      marketKey,
      paramValue,
      selections,
      debug: {
        rawName: raw.name,
        rawId: raw.bookmakerMarketId,
        matchedBy,
      },
    };
  },

};

export default lvbetNormalizer;
