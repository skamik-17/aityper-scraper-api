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
  parseDecimalLine,
  normalize1x2Selection,
  normalizeOverUnderSelection,
  normalizeYesNoSelection,
  normalizeDoubleChanceSelection,
  normalizeOddEvenSelection,
  normalizeHandicapSelection,
  parseScoreSelection,
  parseHtFtSelection,
  canonicalizePlayerName,
  canonicalizePlayerComboSelection,
} from "../helpers/index.js";
import { isValidMarketCode, getMarketByCode } from "../../../data/market-catalog.js";

const BETCRIS_MARKET_TYPE_TO_CODE: Record<string, NormalizedMarketType> = {
  "P1XP2": "MATCH_WINNER",
  "1X12X2": "DOUBLE_CHANCE",
  "P1XP2DC": "DOUBLE_CHANCE",
  "DrawNoBet": "DRAW_NO_BET",
  "OverUnder": "TOTAL_GOALS",
  "TotalGoalsExact": "EXACT_GOALS",
  // round8 audit (Arsenal vs Coventry City): betcris publishes both goal-band
  // families under the identical raw name "Liczba goli (przedziały)" but
  // distinct Swarm ids — without these two mappings betcris had zero rows in
  // either catalog code (both fell through matchMarketByName's blanket
  // /przedzia[lł]/i exclusion). "TotalGoals" is the disjoint exhaustive
  // partition (0 lub 1 / 2 lub 3 / 4 - 6 / 7+, implied probs sum to ~1) — the
  // GOAL_RANGE shape. "MultiGoal" is the cumulative overlapping ladder
  // (1-2/1-3/.../4-6/5-6, implied probs sum well above 1) — the
  // MULTI_GOAL_RANGE shape (see that catalog entry's comment for the split
  // rationale).
  "TotalGoals": "GOAL_RANGE",
  "MultiGoal": "MULTI_GOAL_RANGE",
  "BothTeamsToScore": "BTTS",
  "OddEven": "ODD_EVEN_GOALS",
  "EvenOddTotal": "ODD_EVEN_GOALS",
  "WinToNil": "WIN_TO_NIL",
  "CleanSheet": "CLEAN_SHEET",
  // Side-specific catalog codes (plain OVER/UNDER selections): the shared
  // TEAM_TOTAL_GOALS bucket emitted un-prefixed OVER/UNDER for both teams,
  // silently merging betcris home-team rows into the away team's parameter
  // rows of other bookmakers (best-odds poisoning).
  "Team1OverUnder": "HOME_TEAM_TOTAL_GOALS",
  "Team2OverUnder": "AWAY_TEAM_TOTAL_GOALS",
  "P1XP2FirstHalf": "HALF_TIME_RESULT",
  "HalfTimeOverUnder": "HALF_TIME_TOTAL_GOALS",
  "HalfTimeOverUnderAsian": "HALF_TIME_TOTAL_GOALS_ASIAN",
  "BothTeamsToScoreFirstHalf": "HALF_TIME_BTTS",
  "1stHalfBothTeamsToScore": "HALF_TIME_BTTS",
  "AsianHandicap": "ASIAN_HANDICAP",
  "EuropeanHandicap": "EUROPEAN_HANDICAP",
  "CorrectScore": "CORRECT_SCORE",
  "2ndHalfCornersOver/Under": "SECOND_HALF_CORNERS_TOTAL",
  "HalftimeFulltime": "HALFTIME_FULLTIME",
  // Audited mappings keyed by raw bookmakerMarketId
  "Team2HalfWithMostGoals": "AWAY_HALF_WITH_MOST_GOALS",
  "HalfTimeCornersResult": "HALF_TIME_CORNERS_RACE",
  "Team1HalfWithMostGoals": "HOME_HALF_WITH_MOST_GOALS",
  "1st Goal Time": "FIRST_GOAL_TIME",
  "BothHalfLessThen1.5Goal": "BOTH_HALVES_UNDER_GOALS",
  "HalfWithMostGoals": "HALF_WITH_MORE_GOALS",
  "HalforMatchResult": "HT_OR_FT_RESULT",
  "HalfTimeFullTime": "HALFTIME_FULLTIME",
  "GoalsInBothHalfes": "BOTH_HALVES_GOALS",
  "GoalInSecondHalf": "SECOND_HALF_TOTAL_GOALS",
  "2ndHalfBothTeamsToScore": "SECOND_HALF_BTTS",
  "2ndHalfAsianHandicap": "SECOND_HALF_ASIAN_HANDICAP",
  "SecondHalfResult": "SECOND_HALF_RESULT",
  "SecondHalfHandicap": "SECOND_HALF_EUROPEAN_HANDICAP",
  "SecondHalfOutcomeAndBothTeamToScore": "SECOND_HALF_RESULT_AND_BTTS",
  "FirstHalfHandicap": "FIRST_HALF_EUROPEAN_HANDICAP",
  "1-75Result": "TIME_PERIOD_RESULT",
  "1-60MinutesBothTeamToScore": "BTTS_FIRST_60_MIN",
  "1-60": "TIME_PERIOD_RESULT",
  "1-60Result": "TIME_PERIOD_RESULT",
  "1-30MinutesBothTeamToScore": "BTTS_FIRST_30_MIN",
  "1-30Handicap": "TIME_PERIOD_HANDICAP",
  "1-30Result": "TIME_PERIOD_RESULT",
  "1-15MinutesBothTeamToScore": "FIRST_15_MIN_BTTS",
  "1-15Handicap": "FIRST_15_MIN_HANDICAP",
  "1-15Result": "TIME_PERIOD_RESULT",
  "Team2ScoreYes/No": "AWAY_TEAM_TO_SCORE",
  // Note the Swarm id typo: Team2's 1st-half id uses a lowercase "in"
  // ("Team2ScoreinFirstHalf") while every other pair here uses "In".
  "Team1ScoreInFirstHalf": "HALF_TIME_HOME_TO_SCORE",
  "Team2ScoreinFirstHalf": "HALF_TIME_AWAY_TO_SCORE",
  "Team1ScoreInSecondHalf": "SECOND_HALF_HOME_TO_SCORE",
  "Team2ScoreInSecondHalf": "SECOND_HALF_AWAY_TO_SCORE",
  "Team1ScoreYes/no": "HOME_TEAM_TO_SCORE",
  "Handicap": "EUROPEAN_HANDICAP",
  // Binary Yes/No prop ("Dokładnie 1 gol w całym meczu") — matches the
  // EXACT_GOALS_YN code lvbet uses; it must NOT be flattened into the
  // EXACT_GOALS 0..6+ distribution (its YES/NO selections were orphans there).
  "Exactly1GoalsinMatch": "EXACT_GOALS_YN",
  "AnytimeGoalscorerDoubleChance": "TWO_PLAYERS_ANYTIME",
  "PlayerWillScoreandTheOpponentTeamWillWin": "PLAYER_GOAL_TEAM_LOSES",
  "MatchScoreDraw": "SCORING_DRAW",
  "Team2ToWinToNil": "AWAY_WIN_TO_NIL",
  "Team1ToWinToNil": "HOME_WIN_TO_NIL",
  "OutcomeandBothTeamToScore": "RESULT_AND_BTTS",
  "FirstTeamToScoreAndResult": "FIRST_GOAL_AND_RESULT",
  "LastTeamToScore": "LAST_TEAM_TO_SCORE",
  "FirstTeamToScore": "FIRST_TEAM_TO_SCORE",
  "HalfTimeAsianHandicap": "FIRST_HALF_ASIAN_HANDICAP",
  "ScoreCombinations": "MULTI_RESULT",
  "AnytimeCorrectScore": "ANYTIME_CORRECT_SCORE",
  "MatchAwayNoBet": "AWAY_NO_BET",
  "MatchHomeNoBet": "HOME_NO_BET",
  "Drawatleastinoneofthehalves": "DRAW_IN_AT_LEAST_ONE_HALF",
  "FirstHalfSecondHalfResult": "HALF_TIME_SECOND_HALF_RESULT",
  "SecondHalfAwayTeamToWinToNil": "SECOND_HALF_AWAY_WIN_TO_NIL",
  "SecondHalfHomeTeamToWinToNil": "SECOND_HALF_HOME_WIN_TO_NIL",
  "SecondHalfFirstTeamToScore": "SECOND_HALF_FIRST_GOAL",
  "SecondHalfAwayTeamToWinWithExactMargin": "SECOND_HALF_AWAY_WIN_EXACT_MARGIN",
  "SecondHalfHomeTeamToWinWithExactMargin": "SECOND_HALF_HOME_WIN_EXACT_MARGIN",
  "FirstHalfAwayTeamToWinToNil": "HALF_TIME_AWAY_WIN_TO_NIL",
  "FirstHalfHomeTeamToWinToNil": "HALF_TIME_HOME_WIN_TO_NIL",
  "FirstGoalMethod": "FIRST_GOAL_METHOD",
  "ToScoreaPenalty": "PENALTY_GOAL",
  "ToMissaPenalty": "PENALTY_MISSED",
  "1stGoalTimeTeam2": "AWAY_FIRST_GOAL_TIME",
  "1stGoalTimeTeam1": "HOME_FIRST_GOAL_TIME",
  "Team1FirstGoalscorer": "HOME_GOALSCORER_FIRST",
  "Team2FirstGoalscorer": "AWAY_GOALSCORER_FIRST",
  "Team1LastGoalscorer": "HOME_GOALSCORER_LAST",
  "Team2LastGoalscorer": "AWAY_GOALSCORER_LAST",
  "AtLeastOneTeamWillScoreOverGoals": "AT_LEAST_ONE_TEAM_OVER_GOALS",
  "AutoGoal": "OWN_GOAL",
  "AnytimeGoalscorerTripleChance": "THREE_PLAYERS_ANYTIME",
  "AnytimeGoalscorerThreePlayersToScore": "ALL_PLAYERS_SCORE",
  "AnytimeGoalscorerBothPlayersToScore": "BOTH_PLAYERS_ANYTIME",
  "FirstGoalscorer": "GOALSCORER_FIRST",
  "LastGoalscorer": "GOALSCORER_LAST",
  "ToAssistaGoal": "PLAYER_ASSISTS",
  "PlayerToScorebyHeader": "PLAYER_HEADER_GOAL",
  "PlayerToScore2OrMore": "PLAYER_2_OR_MORE_GOALS",
  "AnytimeGoalscorer": "GOALSCORER_ANYTIME",
  "PlayertoScoreorAssist": "PLAYER_GOAL_OR_ASSIST",
  "PlayerToScore3OrMore": "PLAYER_3_OR_MORE_GOALS",
  "1stGoalTime15min": "FIRST_GOAL_TIME_ALT",
  "BothTeamstobeAwardedaPenalty": "BOTH_TEAMS_PENALTY_AWARDED",
  "TwoPenaltiesintheMatch": "TWO_PENALTIES_IN_MATCH",
  "HalfPenalty": "HALF_TIME_PENALTY_AWARDED",
  "Penalty": "PENALTY_AWARDED",
  // round8 audit (Arsenal vs Coventry City): betcris's "4+" is a standalone
  // one-price product (same YES-shaped family as PlayerToScore2/3OrMore),
  // not a rung of the PLAYER_GOALS 1+/2+/3+ tiered ladder — see catalog
  // entry PLAYER_4_OR_MORE_GOALS's comment. Routing it to PLAYER_GOALS
  // leaked a bare "4+" selection code the catalog never declared there.
  "PlayerToScore4OrMore": "PLAYER_4_OR_MORE_GOALS",
  "PlayerWillScoreandMatchWillEndDraw": "PLAYER_GOAL_AND_RESULT",
  "PlayerWillScoreandHisTeamWillWin": "PLAYER_GOAL_AND_TEAM_WIN",
  "PlayertoScoreinBothHalves": "PLAYER_SCORES_BOTH_HALVES",
  "PlayertoScoreinFirstHalf": "HALF_TIME_GOALSCORER_ANYTIME",
  "PlayerToScoreFromOutsideTheBox": "PLAYER_GOAL_OUTSIDE_BOX",
  "FirstPlayerGetsCard": "FIRST_PLAYER_CARDED",
  "PlayerGetsCard": "PLAYER_CARDS",
  "PlayerToScoreaPenalty": "PENALTY_SCORER",
  "PlayerToScoreandAssist": "PLAYER_GOAL_AND_ASSIST",
  "CornersOverUnder": "CORNERS_TOTAL",
  "First10Minutes(00:00–09:59)Corners": "FIRST_10_MIN_CORNERS_TOTAL",
  "TotalCorners": "CORNERS_RANGE",
  "HalfTimeCornersOverUnder": "HALF_TIME_CORNERS_TOTAL",
  "CornersRaceTo": "CORNERS_RACE_TO",
  "CornerTotal3": "CORNERS_TOTAL_3WAY",
  "CornerHandicap": "CORNERS_HANDICAP",
  "AwayTeamCornersOverUnder": "CORNERS_TEAM",
  "HomeTeamCornersOverUnder": "CORNERS_TEAM",
  "HalfWithTheMostCorners": "HALF_WITH_MOST_CORNERS",
  "HalfTimeCornerHandicap": "HALF_TIME_CORNERS_HANDICAP",
  "TeamWithMostCornersWithDraw": "CORNERS_RACE",
  "CornerOddEven": "CORNERS_ODD_EVEN",
  "HalfTimeTeam2CornersOverUnder": "HALF_TIME_CORNERS_TEAM",
  "HalfTimeTeam1CornersOverUnder": "HALF_TIME_CORNERS_TEAM",
  "MatchCornerFirstTeam": "FIRST_CORNER",
  "MatchCornerLastTeam": "LAST_CORNER",
  "NextShotOn": "FIRST_SHOT_ON_TARGET",
  "PlayerShotsOver": "PLAYER_SHOTS",
  "PlayerShotsonTargetOver": "PLAYER_SHOTS_ON_TARGET",
  "PlayerTotalShots": "PLAYER_SHOTS",
  "PlayerTotalShotsonTarget": "PLAYER_SHOTS_ON_TARGET",
  "FirstMinute(00:00–00:59)Corner": "FIRST_MINUTE_CORNER",
  "GoalkeeperSaves": "PLAYER_SAVES",
  "MatchYellowCardLastTeam": "LAST_CARD",
  "MatchYellowCardFirstTeam": "FIRST_CARD",
  "YellowCardsHandicap": "CARDS_HANDICAP",
  "Team2YellowCardsOverUnder": "CARDS_TEAM",
  "Team1YellowCardsOverUnder": "CARDS_TEAM",
  "YellowCardsOverUnder": "CARDS_TOTAL",
  "FoulsResult": "FOUL_RACE",
  "YellowCards:2ndHalfAsianHandicap": "SECOND_HALF_CARDS_HANDICAP",
  "YellowCards:2ndHalfTeam2Total": "SECOND_HALF_AWAY_TEAM_TOTAL_CARDS",
  "YellowCards:2ndHalfTeam1Total": "SECOND_HALF_HOME_TEAM_TOTAL_CARDS",
  "2ndHalfYellowCardsOver/Under": "SECOND_HALF_CARDS_TOTAL",
  "YellowCards:2ndHalfResult": "SECOND_HALF_CARDS_1X2",
  "HalfTimeYellowCardHandicap": "HALF_TIME_CARDS_HANDICAP",
  "YellowCards1stHalfTeam2Total": "HALF_TIME_AWAY_TEAM_CARDS",
  "YellowCards:1stHalfTeam1Total": "HALF_TIME_HOME_TEAM_TOTAL_CARDS",
  "1stHalfYellowCardsOver/Under": "HALF_TIME_CARDS_TOTAL",
  "HalfTimeFoulsHandicap": "HALF_TIME_FOULS_HANDICAP",
  "Woodworks:Team2Total": "TEAM_TOTAL_WOODWORK_SHOTS",
  "Woodworks:Handicap": "WOODWORK_SHOTS_HANDICAP",
  "Woodworks:Result": "WOODWORK_HITS_1X2",
  "PostOrCrossbarTotal": "POST_OR_CROSSBAR_TOTAL",
  "GoalKicks:AsianHandicap": "GOAL_KICKS_HANDICAP",
  "MatchThrowInHandicap2Way": "THROW_INS_HANDICAP",
  "MatchThrowInResult3Way": "THROW_INS_1X2",
  "Shots:AsianHandicap": "SHOTS_HANDICAP",
  "FirstMinute(00:00–00:59)Goal": "FIRST_MINUTE_GOAL",
  "Shots:Team2Total": "TEAM_TOTAL_SHOTS",
  "ToBeSentOff": "PLAYER_RED_CARD",
  "RedCardsOverUnder": "RED_CARDS_TOTAL",
  "HalfTimeFoulsTotalOverUnder": "HALF_TIME_FOULS_TOTAL",
  "HalfTimeTeam1FoulsTotalOverUnder": "HALF_TIME_HOME_TEAM_FOULS_TOTAL",
  "HalfTimeTeam2FoulsTotalOverUnder": "HALF_TIME_AWAY_TEAM_TOTAL_FOULS",
  "AwayTeamOffsidesOver/Under": "AWAY_TEAM_TOTAL_OFFSIDES",
  "HomeTeamOffsidesOver/Under": "HOME_TEAM_TOTAL_OFFSIDES",
  "OffsidesOver/Under": "OFFSIDES_TOTAL",
  "ShotsOnGoalOver/Under": "TOTAL_SHOTS_ON_TARGET",
  "Shots:Total": "TOTAL_SHOTS",
  "ShotsongoalTeam1": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "ShotsongoalTeam2": "TEAM_TOTAL_SHOTS_ON_TARGET",
  "Cards:Result": "CARDS_POINTS_1X2",
  "MatchBookingCommonTotalOverUnder2Way": "CARDS_POINTS_OVER_UNDER",
  "Team1RedCard": "RED_CARD_TEAM",
  "MatchBookingCommonHandicap2Way": "CARDS_POINTS_HANDICAP",
  "BothTeamstoReceiveaCard": "BOTH_TEAMS_CARDED",
  "Team2RedCard": "RED_CARD_TEAM",
  "StraightRedCard": "STRAIGHT_RED_CARD",
  "Offsides1stOffside": "FIRST_OFFSIDE",
  "PenaltyandRedCard": "RED_CARD_AND_PENALTY",
  "PenaltyorRedCardintheMatchYes": "PENALTY_OR_RED_CARD",
  // The "No" side of the same market — without this, matchMarketByName's
  // "karn"/"kartk" guard bails out (to avoid misrouting card/penalty combos)
  // and this Swarm id fell through to unmatched/OTHER, silently dropping the
  // NO price for the whole market.
  "PenaltyorRedCardintheMatchNo": "PENALTY_OR_RED_CARD",
  "ACardinBothHalves": "BOTH_HALVES_CARDS",
  "HalfRedCard": "HALF_TIME_RED_CARD",
  "TeamtoReceiveFirstCard": "FIRST_CARD",
  "MatchThrowInCommonTotalOverUnder2Way": "THROW_INS_TOTAL",
  "MatchThrowInTeam1TotalOverUnder2Way": "HOME_TEAM_TOTAL_THROW_INS",
  "MatchThrowInTeam2TotalOverUnder2Way1": "AWAY_TEAM_TOTAL_THROW_INS",
  "ShotsonGoalAsianHandicap": "SHOTS_ON_TARGET_HANDICAP",
  "BothTeamstoReceiveaCardinBothHalves": "BOTH_TEAMS_CARD_BOTH_HALVES",
  "First10Minutes(00:00–09:59)YellowCards": "FIRST_10_MIN_CARDS",
  "BothTeamstoReceive2orMoreCards": "BOTH_TEAMS_2PLUS_CARDS",
  "TeamtoReceiveLastCard": "LAST_CARD",
  "Shotsontarget:Total(Bands)": "TOTAL_SHOTS_ON_TARGET_RANGE",
  "FoulsOver/Under": "FOULS_TOTAL",
  "HomeTeamFoulsOver/Under": "HOME_TEAM_TOTAL_FOULS",
  "AwayTeamFoulsOver/Under": "AWAY_TEAM_TOTAL_FOULS",
  "Goal Kicks:Total": "GOAL_KICKS_TOTAL",
  "GoalKicks:Team2Total": "AWAY_TEAM_GOAL_KICKS",
  "GoalKicks:Team1Total": "HOME_TEAM_TOTAL_GOAL_KICKS",
  "PlayerShottoHittheWoodwork": "PLAYER_HIT_WOODWORK",
  "3orMoreShotsonTargetFromOutsideTheBox": "TOTAL_SHOTS_ON_TARGET_OUTSIDE_BOX",
  "ACardtobeShowninSecondHalfAddedTime(90+min)": "SECOND_HALF_ADDED_TIME_CARD",
  "Hat-trickYesNo": "HAT_TRICK",
  "1-60Handicap": "TIME_PERIOD_ASIAN_HANDICAP",
  "ToScoreInFirst10Mins": "PLAYER_SCORE_FIRST_10_MIN",
  "YellowCardsOdd/Even": "CARDS_ODD_EVEN",
  "PlayertoScoreinSecondHalf": "SECOND_HALF_GOALSCORER_ANYTIME",
  "OffsidesAsianHandicap": "OFFSIDES_HANDICAP",
  "ShotsonGoalWinner": "MOST_SHOTS_ON_TARGET",
  "ScoredGoalbyaDirectFreeKick": "FREE_KICK_GOAL",
  "Shots:Result": "MOST_SHOTS",
  "Shots:Team1Total": "TEAM_TOTAL_SHOTS",
  "BothTeamstoReceiveaRedCard": "BOTH_TEAMS_RED_CARD",
  "OffsidesMatchResult": "OFFSIDES_1X2",
  "ExpectedGoals(xG):Handicap": "XG_HANDICAP",
  "PlayerFoulsCommittedOver": "PLAYER_FOULS",
  "PlayerToBeFouledOver": "PLAYER_FOULS_WON",
  "PlayerToScoreWithRightFoot": "PLAYER_RIGHT_FOOT_GOAL",
  "PlayerToScoreWithLeftFoot": "PLAYER_LEFT_FOOT_GOAL",
  "PlayertoBeinOffsideOver": "PLAYER_OFFSIDES",
  "GoalFromOutsidetheBox": "GOAL_OUTSIDE_BOX",
};

// Known Swarm market ids with no catalog counterpart. EXACT_GOALS_YN is not
// parameterized, so the "exactly N goals" Yes/No props for N >= 2 would all
// collide on one key (and mapping them onto EXACT_GOALS orphans their YES/NO
// selections inside the 0..6+ combination). Excluded to OTHER until a
// parameterized catalog code exists.
const BETCRIS_EXCLUDED_MARKET_IDS = new Set<string>([
  "Exactly2GoalsinMatch",
  "Exactly3GoalsinMatch",
  "Exactly4GoalsinMatch",
  // "Cards: Total Points (Bands)" is a weighted card-POINTS bands market
  // (bands 0/1-2/3-4/.../11+); folding it into the plain card-count
  // CARDS_EXACT_RANGE compared two different stats under one column.
  "Cards:Total(Bands)",
  // "Żółte kartki. Wynik (liczy się tylko pierwsza żółta kartka...)" is a
  // yellow-cards-only race with a first-booking-per-player rule set; peers'
  // CARDS_RACE counts all cards, so its odds were flagged as outliers there.
  "TeamWithMostYellowCardsWithDraw",
  // "Kto pierwszy strzeli gola i wynik 1. połowy" is a combo market (first
  // goalscorer team x half-time result, 6 selections: "Team1 i W1", "Team1 i
  // X", ..., "Team2 i W2") with no catalog counterpart yet. Without this
  // exclusion the id was unmapped and fell through to the plain
  // "wynik 1. połowy" catch-all in matchMarketByName, which matched the
  // trailing "wynik 1. połowy" substring and mis-tagged it as HALF_TIME_RESULT
  // — none of its combo selection labels resolve, so all 6 rows became
  // UNKNOWN and the aggregator kept only the first, presenting a fake
  // HALF_TIME_RESULT row (odds 2.12) instead of the real 1X2 half-time market.
  "FirstTeamToScoreAnd1stHalfResult",
  // "Dokładna liczba goli w meczu" is a duplicate render of "Dokładna
  // liczba goli" (id "TotalGoalsExact", mapped to EXACT_GOALS) with
  // identical prices under different selection labels ("Bez gola"/
  // "Dokładnie N"/"Dokładnie 6 lub więcej" vs " 0"/" 1"/" 6+"). Excluded so
  // it does not collide on the EXACT_GOALS key.
  "ExactNumberOfGoals",
  // "1. połowa / 2. połowa. Obie drużyny strzelą gola" is a per-half BTTS
  // combo (4 selections: Tak/Tak, Tak/Nie, Nie/Tak, Nie/Nie) with no
  // catalog counterpart — not the same market as the plain HALF_TIME_BTTS
  // Yes/No mapped above.
  "1stHalf-2ndHalfBothToScore",
]);

const BETCRIS_SELECTION_CODES: Record<string, NormalizedSelection> = {
  "W1": "HOME",
  "w1": "HOME",
  "X": "DRAW",
  "x": "DRAW",
  "W2": "AWAY",
  "w2": "AWAY",
  "1X": "HOME_OR_DRAW",
  "1x": "HOME_OR_DRAW",
  "X2": "DRAW_OR_AWAY",
  "x2": "DRAW_OR_AWAY",
  "12": "HOME_OR_AWAY",
  "Over": "OVER",
  "over": "OVER",
  "Under": "UNDER",
  "under": "UNDER",
  "Yes": "YES",
  "yes": "YES",
  "No": "NO",
  "no": "NO",
  // The betcris parser renders Swarm Yes/No selections with Polish labels
  "Tak": "YES",
  "tak": "YES",
  "Nie": "NO",
  "nie": "NO",
  "Odd": "ODD",
  "odd": "ODD",
  "Even": "EVEN",
  "even": "EVEN",
};

function extractMarketType(raw: RawBookmakerMarket): string | null {
  if (raw.bookmakerMarketId) {
    // Trim: the betcris scraper can hand back an id with leading/trailing
    // whitespace (e.g. " SecondHalfHomeTeamToWinToNil"), which would
    // otherwise never match BETCRIS_MARKET_TYPE_TO_CODE's exact keys.
    return String(raw.bookmakerMarketId).trim();
  }

  // No group-name guessing here: the betcris parser always carries the Swarm
  // market type as bookmakerMarketId, and inferring a type from a broad group
  // like "Gole" bypassed every misroute guard in matchMarketByName (e.g. a
  // time-window goals market would blanket-map to full-match TOTAL_GOALS).
  // Id-less markets fall through to name/group pattern matching below.
  return null;
}

function matchMarketByName(name: string): NormalizedMarketType | null {
  const lower = name.toLowerCase().trim();

  // Stat-prop markets (offsides/cards/penalties/fouls/corners/shots/throw-ins)
  // must never fall into the generic result/goals rules below. Examples:
  // "Spalone. 1 połowa. Wynik" is a 1st-half OFFSIDES result (not
  // HALF_TIME_RESULT) and "Zawodnik otrzyma kartkę / podwójna szansa" is a
  // player-card combo (not DOUBLE_CHANCE). Unmatched names fall to OTHER.
  if (/spalon|kartk|karn|faul|ro[żz]n|strza[lł]|wrzut|wznowien/i.test(lower)) {
    return null;
  }

  // Player-prop combo markets (e.g. "Zawodnik. Strzeli gola lub zaliczy
  // asystę / podwójna szansa") must not match DOUBLE_CHANCE & co. on a
  // trailing phrase — their selections are player names. No catalog code
  // exists for these combos, so they fall to OTHER.
  if (/zawodni|\bgracz/i.test(lower)) {
    return null;
  }

  // "Wynik meczu / Team X liczba goli" is a correlated result+team-goals
  // combo whose selections cannot map to a simple O/U threshold; forcing it
  // into *_TEAM_TOTAL_GOALS produced UNKNOWN selections. No catalog code.
  if (/wynik\s+meczu\s*\/\s*team\s*[12]/i.test(lower)) {
    return null;
  }

  // Goal-band markets ("(przedziały)", "(dodatkowe przedziały)"; selections
  // like 0-1/2-3/4-6/7+ or 1-2/1-3/"Każdy inny") do not fit any OVER/UNDER
  // or *_GOAL_RANGE catalog selection set and previously leaked UNKNOWN
  // selections into the totals markets.
  if (/przedzia[lł]/i.test(lower)) {
    return null;
  }

  // Halves-comparison markets ("1. połowa vs 2. połowa. Handicap liczby
  // goli") have no catalog counterpart — they were leaking into
  // HALF_TIME_TOTAL_GOALS with UNKNOWN selections.
  if (/\bvs\b/i.test(lower)) {
    return null;
  }

  // Asian goal totals carry quarter lines (0.75/1.25/...) with split-stake
  // settlement — presenting them as plain OVER/UNDER lines of TOTAL_GOALS
  // misrepresents the payout at boundary results.
  if (/azjatycka\s+suma/i.test(lower)) {
    return null;
  }

  // Half-scoped goal totals and correct score must be matched before the
  // generic full-match rules below (e.g. "1. połowa. Team 1. Liczba goli"
  // is a 1st-half team total, not full-match TOTAL_GOALS).
  const isFirstHalf = /1\.?\s*po[lł]ow/i.test(lower);
  const isSecondHalf = /2\.?\s*po[lł]ow/i.test(lower);
  const isHomeTeamScoped = /team\s*1\b|dru[żz]yna\s*1\b|1\.?\s*dru[żz]yn|gospodarz/i.test(lower);
  const isAwayTeamScoped = /team\s*2\b|dru[żz]yna\s*2\b|2\.?\s*dru[żz]yn|go[śs]ci/i.test(lower);

  // Time-window goal markets ("1-15 min.", "Ranga 1-30 min.", "1-75 min.",
  // "Pierwsze 10 minut (00:00-09:59)") are NOT full-match totals — their
  // odds shape is completely different and poisoned TOTAL_GOALS /
  // *_TEAM_TOTAL_GOALS best-odds. Route to existing time-window catalog
  // codes where available, otherwise exclude to OTHER.
  const windowMatch = lower.match(/\b1\s*[-–]\s*(\d{1,2})\s*\.?\s*min/);
  const isFirst10MinWindow =
    /pierwsze\s*10\s*minut/i.test(lower) || /00:00\s*[-–]\s*09:59/.test(lower);
  if (/liczba\s+goli|gole/i.test(lower) && (windowMatch || isFirst10MinWindow)) {
    const windowEnd = windowMatch?.[1];
    const isTeamScoped = isHomeTeamScoped || isAwayTeamScoped;
    if (windowEnd === "60") {
      return isTeamScoped ? "TEAM_TOTAL_GOALS_FIRST_60MIN" : "TOTAL_GOALS_BY_60_MIN";
    }
    if (windowEnd === "30" && !isTeamScoped) {
      return "FIRST_30_MIN_TOTAL_GOALS";
    }
    if (isFirst10MinWindow && !isTeamScoped) {
      return "FIRST_10_MIN_TOTAL_GOALS";
    }
    // 1-15 / 1-30 (team-scoped) / 1-75: no catalog code
    return null;
  }

  // First/last-goal races ("Która drużyna pierwsza strzeli gola") are
  // HOME/AWAY/NONE markets, not goal totals — the 1st-half variant used to
  // fall into HALF_TIME_TOTAL_GOALS via the generic "1. połowa ... gol" rule.
  // The "/ która drużyna wygra" combo variant is id-mapped and excluded here.
  if (
    /kt[oó]ra\s+dru[żz]yna\s+(pierwsza|ostatnia)\s+strzeli/i.test(lower) &&
    !/wygra/i.test(lower)
  ) {
    const isLast = /ostatnia\s+strzeli/i.test(lower);
    if (isFirstHalf) return isLast ? null : "HALF_TIME_FIRST_GOAL";
    if (isSecondHalf) return isLast ? "SECOND_HALF_LAST_TEAM_TO_SCORE" : "SECOND_HALF_FIRST_GOAL";
    return isLast ? "LAST_TEAM_TO_SCORE" : "FIRST_TEAM_TO_SCORE";
  }

  // "1. polowa/cały mecz i liczba goli" is the HT/FT + total-goals combo —
  // it must be matched before the generic half-scoped goals rules below.
  if (/po[lł]owa\s*\/\s*ca[lł]y\s+mecz\s+i\s+liczba\s+goli/i.test(lower)) {
    return "HALFTIME_FULLTIME_AND_TOTAL";
  }

  // "Wynik meczu i dokładna liczba goli" (result + exact goal count combo,
  // selections "1 / 2 gole") has no catalog counterpart; it was polluting
  // TOTAL_GOALS with UNKNOWN selections.
  if (/wynik\s+meczu\s+i\s+.*liczba\s+goli/i.test(lower)) {
    return null;
  }

  if (/dok[lł]adny\s+wynik/i.test(lower)) {
    if (isSecondHalf) return "SECOND_HALF_CORRECT_SCORE";
    if (isFirstHalf) return "HALF_TIME_CORRECT_SCORE";
  }

  // "Team 1. Dokładna liczba goli i wygra mecz" is a COMBINED bet (exact goal
  // count AND the team winning), quoted Tak/Nie. Audit /audit-match (Arsenal
  // vs Coventry City) found it inside HOME_TEAM_TOTAL_GOALS, mixing YES/NO
  // selections into an OVER/UNDER market on integer lines 1-4. No catalog
  // counterpart exists, so keep it out rather than poison the team total.
  if (/liczba\s+goli\s+i\s+wygra/i.test(lower)) {
    return null;
  }

  if (/liczba\s+goli/i.test(lower)) {
    if (isFirstHalf) {
      if (isHomeTeamScoped) return "HALF_TIME_HOME_TEAM_TOTAL_GOALS";
      if (isAwayTeamScoped) return "HALF_TIME_AWAY_TEAM_TOTAL_GOALS";
      return "HALF_TIME_TOTAL_GOALS";
    }
    if (isSecondHalf) {
      if (isHomeTeamScoped) return "SECOND_HALF_HOME_TEAM_TOTAL_GOALS";
      if (isAwayTeamScoped) return "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS";
      return "SECOND_HALF_TOTAL_GOALS";
    }
    if (isHomeTeamScoped) return "HOME_TEAM_TOTAL_GOALS";
    if (isAwayTeamScoped) return "AWAY_TEAM_TOTAL_GOALS";
  }

  if (/^wynik\s+meczu$/i.test(lower) || /^1x2$/i.test(lower)) return "MATCH_WINNER";
  // "Podwójna szansa. Kombinowane" pairs double-chance outcomes with
  // total-goals lines (~27 selections, e.g. "1X / 2-3 gole", "12 / powyżej
  // (1.5 gola)") — a combo market with no catalog counterpart. Must be
  // excluded before the broad double-chance match below, which would
  // otherwise dump all its selections into DOUBLE_CHANCE as one UNKNOWN row.
  if (/podw[oó]jna\s+szansa.*kombinowan/i.test(lower)) return null;
  if (/podw[oó]jna\s+szansa/i.test(lower)) return "DOUBLE_CHANCE";
  if (/remis\s*[=:]\s*zwrot/i.test(lower) || /draw\s*no\s*bet/i.test(lower)) return "DRAW_NO_BET";

  if (/liczba\s+goli/i.test(lower) && !/(gospodarzy|go[sś]ci|drużyny|druzyny)/i.test(lower)) return "TOTAL_GOALS";
  if (/obie\s+(drużyny\s+)?strzela/i.test(lower) || /obie\s+druzyny\s+strzela/i.test(lower)) return "BTTS";
  if (/parzyste.*nieparzyste|nieparzyste.*parzyste|odd.*even/i.test(lower)) return "ODD_EVEN_GOALS";
  if (/wygrana\s+do\s+zera/i.test(lower)) return "WIN_TO_NIL";
  if (/czyste\s+konto/i.test(lower)) return "CLEAN_SHEET";

  // Side-specific codes: the shared TEAM_TOTAL_GOALS would emit un-prefixed
  // OVER/UNDER for both teams and merge them into one bucket.
  if (/gole\s+(gospodarzy|drużyny\s+1|team\s*1)/i.test(lower)) return "HOME_TEAM_TOTAL_GOALS";
  if (/gole\s+(go[sś]ci|drużyny\s+2|team\s*2)/i.test(lower)) return "AWAY_TEAM_TOTAL_GOALS";

  // "1. połowa. Wynik / obie drużyny strzelą gola" (HT result + BTTS combo,
  // 6 selections: W1/Tak, Remis/Tak, W1/Nie, W2/Tak, Remis/Nie, W2/Nie) must
  // be matched before the plain half-time-result rule below, which would
  // otherwise swallow it and leave all 6 selections as UNKNOWN.
  if (isFirstHalf && /wynik/i.test(lower) && /obie\s*(drużyny\s+)?strzel/i.test(lower)) {
    return "HALF_TIME_RESULT_AND_BTTS";
  }
  // "Wynik 1. połowy / wynik końcowy" is the HT+FT correct-score combo
  // (literal scorelines like "1-3/3-3", not 1X2 result letters) — must be
  // checked before the plain half-time-result rule below, which otherwise
  // matches the leading "wynik 1. połowy" prefix and collapses this into a
  // single UNKNOWN HALF_TIME_RESULT selection.
  if (/wynik\s+1\.?\s*po[lł]owy\s*\/\s*wynik\s+ko[nń]cowy/i.test(lower)) return "HT_FT_CORRECT_SCORE";
  if (/wynik\s+1\.?\s*po[lł]owy/i.test(lower) || /1\.?\s*po[lł]owa.*wynik/i.test(lower)) return "HALF_TIME_RESULT";
  // Must be checked before the generic half-time-goals rule below: "1.
  // połowa. Obie drużyny strzelą gola" contains both "1. połowa" and "gol",
  // which would otherwise match the goals rule first. The stem "strzel"
  // (not "strzela") is required to match the conjugated "strzelą" form
  // betcris uses.
  if (/obie.*strzel.*1\.?\s*po[lł]ow/i.test(lower) || /1\.?\s*po[lł]owa.*obie.*strzel/i.test(lower)) return "HALF_TIME_BTTS";
  if (/gole?\s+1\.?\s*po[lł]ow/i.test(lower) || /1\.?\s*po[lł]owa.*gol/i.test(lower)) return "HALF_TIME_TOTAL_GOALS";

  if (/handicap\s+azjatycki/i.test(lower) || /asian\s+handicap/i.test(lower)) return "ASIAN_HANDICAP";
  if (/handicap\s+europejski/i.test(lower) || /european\s+handicap/i.test(lower)) return "EUROPEAN_HANDICAP";

  if (/dok[lł]adny\s+wynik/i.test(lower) || /correct\s+score/i.test(lower)) return "CORRECT_SCORE";

  if (/wynik\s+po[lł]owa.*mecz|po[lł]owa.*koniec|ht.*ft/i.test(lower)) return "HALFTIME_FULLTIME";

  return null;
}

/**
 * Resolve one side of a betcris combo selection ("W1", "Team 2", "remis",
 * a literal team name, ...) to a HOME/DRAW/AWAY token, or null when the
 * token cannot be resolved.
 */
function resolveResultToken(
  token: string,
  ctx: NormalizationContext
): "HOME" | "DRAW" | "AWAY" | null {
  const t = token.trim();
  if (/^(w1|1|team\s*1)$/i.test(t)) return "HOME";
  if (/^(w2|2|team\s*2)$/i.test(t)) return "AWAY";
  if (/^(x|remis)$/i.test(t)) return "DRAW";
  const side = normalize1x2Selection(t, ctx.homeTeam, ctx.awayTeam, ctx.league);
  return side === "HOME" || side === "AWAY" || side === "DRAW" ? side : null;
}

/**
 * Encode a multi-player combo selection ("Jean-Philippe Mateta and Kylian
 * Mbappe", "Kylian Mbappe or Neil El Aynaoui or Ousmane Dembele") as the
 * network-wide canonical "I. Surname & I. Surname" code instead of a fixed
 * placeholder. Betcris quotes dozens of distinct pairs/trios per market
 * under the same catalog code (PLAYER_PAIR/PLAYER_TRIO carry no per-combo
 * parameter), so a literal placeholder code collapses every combination onto
 * one aggregator row; encoding the actual names keeps each combo distinct.
 * Delegates to the shared helper (also used by superbet) so betcris's full
 * "Firstname Lastname and Firstname Lastname" names reduce to the same
 * abbreviated form betclic/lvbet/superbet converge on — round8 audit
 * (Arsenal vs Coventry City) found the previous full-name-sorted encoding
 * ("Gabriel Jesus & Viktor Gyokeres") never merged with betclic's pre-
 * abbreviated "G. Jesus & V. Gyokeres" row for the same real-world pair.
 */
function normalizeBetcrisPlayerCombo(selectionName: string): NormalizedSelection {
  return canonicalizePlayerComboSelection(selectionName) as NormalizedSelection;
}

function normalizeSelectionForMarket(
  selName: string,
  marketCode: NormalizedMarketType,
  ctx: NormalizationContext
): NormalizedSelection {
  const trimmed = selName.trim();

  const directMapping = BETCRIS_SELECTION_CODES[trimmed];
  if (directMapping) return directMapping;

  const upperTrimmed = trimmed.toUpperCase();
  const lowerTrimmed = trimmed.toLowerCase();
  
  if (BETCRIS_SELECTION_CODES[upperTrimmed]) return BETCRIS_SELECTION_CODES[upperTrimmed];
  if (BETCRIS_SELECTION_CODES[lowerTrimmed]) return BETCRIS_SELECTION_CODES[lowerTrimmed];

  switch (marketCode) {
    case "MATCH_WINNER":
    case "HALF_TIME_RESULT":
    case "DRAW_NO_BET":
    case "WIN_TO_NIL":
    case "CLEAN_SHEET":
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "DOUBLE_CHANCE":
      return normalizeDoubleChanceSelection(trimmed);

    case "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE": {
      // Betcris quotes each leg as its own raw selection instead of combined
      // "1.<2. lub 1.=2." phrasing: "1>=2" (1st half >= 2nd, i.e. 1st half
      // or draw), "2>=1" (2nd half >= 1st, i.e. 2nd half or draw), "1. lub
      // 2." (either half, draw excluded).
      if (/^1\s*>=\s*2/.test(trimmed)) return "1ST_OR_DRAW" as NormalizedSelection;
      if (/^2\s*>=\s*1/.test(trimmed)) return "2ND_OR_DRAW" as NormalizedSelection;
      if (/^1\.?\s*lub\s*2\.?$/i.test(lowerTrimmed)) return "1ST_OR_2ND" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "GOAL_RANGE":
    case "MULTI_GOAL_RANGE": {
      // round8 audit (Arsenal vs Coventry City): betcris renders bands with
      // Polish "lub"/spaced-dash wording ("2 lub 3", "0 lub 1", "4 - 6")
      // instead of the catalog's plain "2-3"/"0-1"/"4-6"; MultiGoal's own
      // ranges ("1-2", "2-3", ...) already match and pass through unchanged.
      // "7+" (TotalGoals' open top band) also passes through unchanged.
      // "Inny" (MultiGoal's catch-all leg, @4.9 in the raw offer) has no
      // slot in either disjoint/cumulative catalog list — drop it via
      // UNKNOWN rather than inventing one.
      if (/^inny$/i.test(lowerTrimmed)) return "UNKNOWN";
      const bandMatch = trimmed.match(/^(\d+)\s*(?:lub|-)\s*(\d+)\s*$/i);
      if (bandMatch) return `${bandMatch[1]}-${bandMatch[2]}` as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "TOTAL_GOALS":
    case "HALF_TIME_TOTAL_GOALS":
    case "SECOND_HALF_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS":
    case "HOME_TEAM_TOTAL_GOALS":
    case "AWAY_TEAM_TOTAL_GOALS":
    case "HALF_TIME_HOME_TEAM_TOTAL_GOALS":
    case "HALF_TIME_AWAY_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_HOME_TEAM_TOTAL_GOALS":
    case "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS":
    case "TEAM_TOTAL_GOALS_FIRST_60MIN":
    case "TOTAL_GOALS_BY_60_MIN":
    case "FIRST_30_MIN_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
    case "SECOND_HALF_BTTS":
    // Binary YES/NO markets — raw betcris labels arrive as Polish "Tak"/"Nie"
    case "OWN_GOAL":
    case "BOTH_HALVES_GOALS":
    case "BOTH_HALVES_UNDER_GOALS":
    case "BOTH_HALVES_OVER_GOALS":
    case "HOME_TEAM_TO_SCORE":
    case "AWAY_TEAM_TO_SCORE":
    case "HOME_WIN_TO_NIL":
    case "AWAY_WIN_TO_NIL":
    case "HALF_TIME_HOME_WIN_TO_NIL":
    case "HALF_TIME_AWAY_WIN_TO_NIL":
    case "SECOND_HALF_HOME_WIN_TO_NIL":
    case "SECOND_HALF_AWAY_WIN_TO_NIL":
    case "SCORING_DRAW":
    case "DRAW_IN_AT_LEAST_ONE_HALF":
    case "EXACT_GOALS_YN":
    case "AT_LEAST_ONE_TEAM_OVER_GOALS":
      // Prefix match first: Swarm labels occasionally carry a suffix (e.g.
      // "Tak (1,5)") that the exact-match helper rejects, leaving UNKNOWN.
      if (/^(tak|yes)\b/i.test(lowerTrimmed)) return "YES";
      if (/^(nie|no)\b/i.test(lowerTrimmed)) return "NO";
      return normalizeYesNoSelection(trimmed);

    case "FIRST_TEAM_TO_SCORE":
    case "LAST_TEAM_TO_SCORE":
    case "HALF_TIME_FIRST_GOAL":
    case "SECOND_HALF_FIRST_GOAL":
    case "SECOND_HALF_LAST_TEAM_TO_SCORE":
      // "Bez gola"/"Nikt" = no goal in the covered period
      if (/^(bez gola|brak gola|nikt|[żz]aden|brak)$/i.test(lowerTrimmed)) return "NONE";
      if (/^(obie|obydwie|both)$/i.test(lowerTrimmed)) return "BOTH" as NormalizedSelection;
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "HALF_WITH_MORE_GOALS":
    case "HOME_HALF_WITH_MOST_GOALS":
    case "AWAY_HALF_WITH_MOST_GOALS":
    case "HALF_WITH_MOST_CORNERS": {
      // Betcris encodes the halves comparison as "1 > 2" (1st half more
      // goals/corners), "1 < 2" (2nd half more) and "1 = 2" (equal)
      if (/^1\s*>\s*2$/.test(trimmed)) return "1st" as NormalizedSelection;
      if (/^1\s*<\s*2$/.test(trimmed)) return "2nd" as NormalizedSelection;
      if (/^1\s*=\s*2$/.test(trimmed)) return "Draw" as NormalizedSelection;
      if (/1\.?\s*po[lł]ow/i.test(lowerTrimmed)) return "1st" as NormalizedSelection;
      if (/2\.?\s*po[lł]ow/i.test(lowerTrimmed)) return "2nd" as NormalizedSelection;
      if (/^(remis|r[oó]wno)$/i.test(lowerTrimmed)) return "Draw" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "ODD_EVEN_GOALS":
    case "HALF_TIME_ODD_EVEN_GOALS":
    // "Nieparzysty"/"Parzysty" (masculine singular) on stat parity markets
    case "CORNERS_ODD_EVEN":
    case "CARDS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "CORNERS_RANGE": {
      // Betcris quotes a 5-tier scale ("5 lub mniej", "6-8", "9-11", "12-14",
      // "15 lub więcej") — collapse it onto the catalog's coarse 3-bucket
      // scale (0-8 / 9-11 / 12+) instead of leaving it unmapped.
      const compact = lowerTrimmed.replace(/\s+/g, "");
      if (/^5lubmniej$/.test(compact) || /^6-8$/.test(compact)) return "0-8" as NormalizedSelection;
      if (/^9-11$/.test(compact)) return "9-11" as NormalizedSelection;
      if (/^12-14$/.test(compact) || /^15lubwi[eę]cej$/.test(compact)) return "12+" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "CORNERS_TOTAL_3WAY":
    case "TOTAL_GOALS_3WAY":
      if (/^dok[lł]adnie/i.test(lowerTrimmed)) return "EXACTLY" as NormalizedSelection;
      return normalizeOverUnderSelection(trimmed);

    case "EXACT_GOALS":
    case "HALF_TIME_EXACT_GOALS":
    case "SECOND_HALF_EXACT_GOALS":
    case "HOME_EXACT_GOALS":
    case "AWAY_EXACT_GOALS": {
      // Bare integer/"N+" labels (" 0", " 1", " 3+", " 4+", " 6+") map
      // directly onto the catalog's exact-goal-count selection codes once
      // whitespace is stripped. The catalog ladder is
      // 0/1/2/3/3+/4/4+/5/6+ (market-catalog.ts), so "4+" is a valid
      // catalog code just like lvbet's own "4+" mapping in this market.
      // The full-match id "TotalGoalsExact" (EXACT_GOALS) also has a
      // duplicate-render variant with "Bez gola"/"Dokładnie N" labels
      // (excluded as a raw-id duplicate, see BETCRIS_EXCLUDED_MARKET_IDS),
      // so the prefix/"no goal" forms are handled here too defensively.
      if (/^(bez\s+gola|brak\s+gola)$/i.test(lowerTrimmed)) return "0" as NormalizedSelection;
      const bandMatch = trimmed.match(/(\d+)\s*(\+|lub\s+wi[eę]cej)/i);
      if (bandMatch) return `${bandMatch[1]}+` as NormalizedSelection;
      const stripped = trimmed
        .replace(/^dok[lł]adnie\s+/i, "")
        .replace(/\s+/g, "");
      const validExactGoalsSelections = new Set(["0", "1", "2", "3", "3+", "4", "4+", "5", "6+"]);
      return (
        validExactGoalsSelections.has(stripped) ? stripped : "UNKNOWN"
      ) as NormalizedSelection;
    }

    // Race-type markets: betcris uses positional "Team 1"/"Team 2" labels and
    // English/Polish "no event" phrases ("No Card", "No Shot on Target",
    // "Żaden") that never matched the generic 1X2 resolver.
    case "FIRST_CARD":
    case "LAST_CARD":
    case "FIRST_CORNER":
    case "LAST_CORNER":
    case "FIRST_OFFSIDE":
    case "FIRST_SHOT_ON_TARGET":
    case "CORNERS_RACE_TO":
      if (/^(no\s|bez\s|brak|nikt|[żz]aden)/i.test(lowerTrimmed)) return "NONE";
      if (/^team\s*1$/i.test(lowerTrimmed)) return "HOME";
      if (/^team\s*2$/i.test(lowerTrimmed)) return "AWAY";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "RESULT_AND_BTTS":
    case "HALF_TIME_RESULT_AND_BTTS":
    case "SECOND_HALF_RESULT_AND_BTTS": {
      // "W1 / Tak", "W1/ Tak", "Remis / Nie" -> HOME_YES / DRAW_NO / ...
      // (slash spacing is inconsistent in the raw feed)
      const combo = trimmed.match(/^(w1|w2|x|remis)\s*\/\s*(tak|nie|yes|no)$/i);
      if (combo) {
        const side = /^w1$/i.test(combo[1]) ? "HOME" : /^w2$/i.test(combo[1]) ? "AWAY" : "DRAW";
        const yn = /^(tak|yes)$/i.test(combo[2]) ? "YES" : "NO";
        return `${side}_${yn}` as NormalizedSelection;
      }
      return "UNKNOWN";
    }

    case "FIRST_GOAL_AND_RESULT": {
      // "Szwajcaria / remis", "Team 1 / Team 1", "nikt / 0-0"
      const parts = trimmed.split("/");
      if (parts.length === 2) {
        const firstTok = parts[0].trim();
        if (/^(nikt|[żz]aden|brak|no\s*goal)/i.test(firstTok)) return "NONE";
        const first = resolveResultToken(firstTok, ctx);
        const second = resolveResultToken(parts[1], ctx);
        if (first && first !== "DRAW" && second) {
          return `${first}_${second}` as NormalizedSelection;
        }
      }
      return "UNKNOWN";
    }

    case "MULTI_RESULT": {
      // " 1-0 / 2-0 / 3-0" -> catalog code "1:0, 2:0 lub 3:0"
      const scores = trimmed.split("/").map((part) => part.trim());
      if (scores.length >= 2 && scores.every((s) => /^\d+\s*-\s*\d+$/.test(s))) {
        const colonScores = scores.map((s) => s.replace(/\s*-\s*/, ":"));
        const last = colonScores[colonScores.length - 1];
        return `${colonScores.slice(0, -1).join(", ")} lub ${last}` as NormalizedSelection;
      }
      if (/^(x|remis)$/i.test(lowerTrimmed)) return "X" as NormalizedSelection;
      return trimmed as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME_AND_TOTAL": {
      // "Szwajcaria/Szwajcaria i powyżej" -> HOME_HOME_OVER (line is carried
      // by the market parameter from the Swarm base field)
      const combo = trimmed.match(/^(.+?)\s+i\s+(powy[żz]ej|poni[żz]ej)\s*$/i);
      if (combo) {
        const parts = combo[1].split("/");
        if (parts.length === 2) {
          const first = resolveResultToken(parts[0], ctx);
          const second = resolveResultToken(parts[1], ctx);
          const ou = /^powy/i.test(combo[2]) ? "OVER" : "UNDER";
          if (first && second) {
            return `${first}_${second}_${ou}` as NormalizedSelection;
          }
        }
      }
      return "UNKNOWN";
    }

    case "PENALTY_GOAL":
    case "HALF_TIME_PENALTY_GOAL":
    case "SECOND_HALF_PENALTY_GOAL": {
      // Catalog vocabulary for penalty-goal markets is TEAM_HOME/TEAM_AWAY/
      // ANY/NONE — the generic HOME/AWAY codes never joined the cross-
      // bookmaker comparison (orphan selections).
      if (/^(kt[oó]rykolwiek|dowoln|any)/i.test(lowerTrimmed)) return "ANY";
      if (/^([żz]aden|nikt|brak|none)/i.test(lowerTrimmed)) return "NONE";
      const side = normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
      if (side === "HOME") return "TEAM_HOME";
      if (side === "AWAY") return "TEAM_AWAY";
      return side;
    }

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
    case "FIRST_HALF_ASIAN_HANDICAP":
    case "FIRST_HALF_EUROPEAN_HANDICAP":
    case "SECOND_HALF_ASIAN_HANDICAP":
    case "SECOND_HALF_EUROPEAN_HANDICAP":
      if (/^(1|w1|home|team\s*1)\b/i.test(trimmed)) return "HOME";
      if (/^(2|w2|away|team\s*2)\b/i.test(trimmed)) return "AWAY";
      if (/^(x|draw|remis)\b/i.test(trimmed)) return "DRAW";
      // Handles team-name labels with a trailing line, e.g. "Argentyna (-1,5)"
      return normalizeHandicapSelection(trimmed, ctx);

    case "GOALSCORER_FIRST":
    case "GOALSCORER_LAST":
    case "HOME_GOALSCORER_FIRST":
    case "AWAY_GOALSCORER_FIRST":
    case "HOME_GOALSCORER_LAST":
    case "AWAY_GOALSCORER_LAST":
    case "GOALSCORER_ANYTIME":
    case "HALF_TIME_GOALSCORER_ANYTIME":
    case "SECOND_HALF_GOALSCORER_ANYTIME":
    case "PLAYER_SCORE_FIRST_10_MIN":
    case "PLAYER_CARDS":
    case "PLAYER_ASSISTS":
    case "PLAYER_SHOTS":
    case "PLAYER_SHOTS_ON_TARGET":
    case "PLAYER_PASSES":
    case "PLAYER_GOALS":
    case "PLAYER_2_OR_MORE_GOALS":
    case "PLAYER_3_OR_MORE_GOALS":
    case "PLAYER_4_OR_MORE_GOALS":
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PLAYER_GOAL_AND_TEAM_WIN":
    case "PLAYER_GOAL_TEAM_LOSES":
    case "PLAYER_SCORES_BOTH_HALVES":
    case "PLAYER_GOAL_OUTSIDE_BOX":
    case "PLAYER_RED_CARD":
    case "PLAYER_SAVES":
    case "PLAYER_FOULS":
    case "PLAYER_FOULS_WON":
    case "PLAYER_HIT_WOODWORK":
    case "PLAYER_RIGHT_FOOT_GOAL":
    case "PLAYER_LEFT_FOOT_GOAL":
    case "PLAYER_OFFSIDES":
    case "PENALTY_SCORER":
    case "FIRST_PLAYER_CARDED":
      // Player-prop markets: keep the (cleaned) player name as the selection
      // code so distinct players do not collide under a shared UNKNOWN code
      // (same convention as the STS/etoto normalizers).
      if (/^(bez gola|brak gola|nikt|[żz]aden)$/i.test(lowerTrimmed)) return "NONE";
      // Per-player stat lines quote bare "Powyżej "/"Poniżej " labels — the
      // player lives in the market name and the line in the Swarm base field.
      if (/^(powy[żz]ej|over|ponad)\b/i.test(lowerTrimmed)) return "OVER";
      if (/^(poni[żz]ej|under)\b/i.test(lowerTrimmed)) return "UNDER";
      // PLAYER_4_OR_MORE_GOALS is a single-price YES/NO product: the parser
      // synthesizes a literal "Tak" marker per player-split entry (round8
      // audit betcris-selection-case/betcris-parser-label) that must resolve
      // to the catalog's YES code before falling through to the player-name
      // branch below (no player is ever literally named "Tak").
      if (/^(tak|yes)$/i.test(lowerTrimmed)) return "YES";
      // Canonical "Firstname Lastname" order shared across all bookmakers.
      return canonicalizePlayerName(
        trimmed.replace(/^\d+\.\s*/, "")
      ) as NormalizedSelection;

    case "BOTH_PLAYERS_ANYTIME":
    case "TWO_PLAYERS_ANYTIME":
    case "THREE_PLAYERS_ANYTIME":
    case "ALL_PLAYERS_SCORE":
      // These markets are unparameterized (PLAYER_PAIR/PLAYER_TRIO is a fixed
      // catalog selection, not a per-combo parameter), so the raw combo names
      // must live in the selection code itself — a literal placeholder code
      // collapsed every distinct pair/trio onto one aggregator row.
      return normalizeBetcrisPlayerCombo(trimmed);

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE":
    case "ANYTIME_CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HT_FT_CORRECT_SCORE": {
      // Betcris uses dash scores with no spaces ("1-3/3-3"); catalog uses
      // colons with a spaced slash ("1:3 / 3:3").
      const match = trimmed.match(/^(\d+)\s*[-:]\s*(\d+)\s*\/\s*(\d+)\s*[-:]\s*(\d+)$/);
      if (match) {
        return `${match[1]}:${match[2]} / ${match[3]}:${match[4]}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME":
    case "HALF_TIME_SECOND_HALF_RESULT": {
      const htft = parseHtFtSelection(trimmed);
      if (htft) return htft as NormalizedSelection;
      // Betcris renders these combos with W1/W2/Remis tokens or literal team
      // names ("Szwajcaria/Szwajcaria", "W1/remis") instead of "1/x/2".
      const parts = trimmed.split("/");
      if (parts.length === 2) {
        const first = resolveResultToken(parts[0], ctx);
        const second = resolveResultToken(parts[1], ctx);
        if (first && second) return `${first}_${second}` as NormalizedSelection;
      }
      return trimmed as NormalizedSelection;
    }

    case "FIRST_GOAL_METHOD":
      // Betcris quotes ("W inny sposób", "Głową", "Bezpośrednio z rzutu
      // karnego", "Bezpośrednio z rzutu wolnego") plus two legs the catalog
      // has no code for ("Nie będzie bramki" / no goal, "Gol samobójczy" /
      // own goal) — those two fall through to UNKNOWN and are dropped, same
      // as superbet's equivalent uncoded legs for this market.
      if (/g[łl]ow[ąa]/i.test(lowerTrimmed)) return "HEADER" as NormalizedSelection;
      if (/karnego/i.test(lowerTrimmed)) return "PENALTY" as NormalizedSelection;
      if (/wolnego/i.test(lowerTrimmed)) return "FREE_KICK" as NormalizedSelection;
      if (/inny\s+spos[oó]b/i.test(lowerTrimmed)) return "OTHER" as NormalizedSelection;
      return "UNKNOWN" as NormalizedSelection;

    case "FIRST_GOAL_TIME":
    case "FIRST_GOAL_TIME_ALT":
    case "HOME_FIRST_GOAL_TIME":
    case "AWAY_FIRST_GOAL_TIME": {
      // Betcris quotes minute-band labels ("11-20", "31-40", trailing-band
      // "81-90+"/"31-45+"/"76-90+") plus a "no goal" label ("Nie będzie
      // bramki", "No Goal") — the catalog bands drop the trailing "+".
      if (/nie\s+b[eę]dzie\s+bramki|no\s*goal|bez\s+gola|brak\s+gola/i.test(lowerTrimmed)) {
        return "NONE";
      }
      const band = trimmed.replace(/\s+/g, "").match(/^(\d{1,2})-(\d{1,2})\+?$/);
      if (band) return `${band[1]}-${band[2]}` as NormalizedSelection;
      return "UNKNOWN" as NormalizedSelection;
    }

    default:
      // Generic Over/Under labels appear across stat markets (cards, corners,
      // fouls, shots, ...), sometimes truncated to a bare "Powyżej "/
      // "poniżej " — resolve them before the 1X2 fallback so both outcomes
      // do not collapse into one shared UNKNOWN key.
      if (/^(powy[żz]ej|over|ponad)\b/i.test(lowerTrimmed)) return "OVER";
      if (/^(poni[żz]ej|under)\b/i.test(lowerTrimmed)) return "UNDER";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

const OVER_UNDER_PARAM_MARKETS: NormalizedMarketType[] = [
  "TOTAL_GOALS",
  "TOTAL_GOALS_ASIAN",
  "HALF_TIME_TOTAL_GOALS",
  "HALF_TIME_TOTAL_GOALS_ASIAN",
  "SECOND_HALF_TOTAL_GOALS",
  "TEAM_TOTAL_GOALS",
  "HOME_TEAM_TOTAL_GOALS",
  "AWAY_TEAM_TOTAL_GOALS",
  "HALF_TIME_HOME_TEAM_TOTAL_GOALS",
  "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  "SECOND_HALF_HOME_TEAM_TOTAL_GOALS",
  "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  "BOTH_HALVES_UNDER_GOALS",
  "BOTH_HALVES_OVER_GOALS",
  "TEAM_TOTAL_GOALS_FIRST_60MIN",
  "TOTAL_GOALS_BY_60_MIN",
  "FIRST_30_MIN_TOTAL_GOALS",
  "FIRST_10_MIN_TOTAL_GOALS",
  "AT_LEAST_ONE_TEAM_OVER_GOALS",
  // HT/FT + total combo carries its goal line in the Swarm base field
  "HALFTIME_FULLTIME_AND_TOTAL",
];

// Stat-prop O/U markets (cards/corners/fouls/offsides/shots/throw-ins/goal
// kicks) carry their line in the same Swarm "base" field as goal totals;
// without extraction every line collapses into the internal "base" bucket
// (visible as an unlabeled parameter next to peers' 0.5/1.5/2.5).
const STAT_OVER_UNDER_PARAM_MARKETS: NormalizedMarketType[] = [
  "CARDS_TOTAL",
  "HALF_TIME_CARDS_TOTAL",
  "SECOND_HALF_CARDS_TOTAL",
  "HALF_TIME_AWAY_TEAM_CARDS",
  "HALF_TIME_HOME_TEAM_TOTAL_CARDS",
  "SECOND_HALF_AWAY_TEAM_TOTAL_CARDS",
  "SECOND_HALF_HOME_TEAM_TOTAL_CARDS",
  "RED_CARDS_TOTAL",
  "CARDS_POINTS_OVER_UNDER",
  "CORNERS_TOTAL",
  "HALF_TIME_CORNERS_TOTAL",
  "SECOND_HALF_CORNERS_TOTAL",
  "FIRST_10_MIN_CORNERS_TOTAL",
  "FIRST_10_MIN_CARDS",
  "CORNERS_TOTAL_3WAY",
  // Team-scoped stat totals: the numeric line comes from the Swarm base
  // field; the team side is attached afterwards in normalizeMarket (either
  // as a HOME:/AWAY: param scope or as a HOME_/AWAY_ selection prefix).
  "CARDS_TEAM",
  "CORNERS_TEAM",
  "HALF_TIME_CORNERS_TEAM",
  "TEAM_TOTAL_SHOTS",
  "TEAM_TOTAL_SHOTS_ON_TARGET",
  "FOULS_TOTAL",
  "HOME_TEAM_TOTAL_FOULS",
  "AWAY_TEAM_TOTAL_FOULS",
  "HALF_TIME_FOULS_TOTAL",
  "HALF_TIME_HOME_TEAM_FOULS_TOTAL",
  "HALF_TIME_AWAY_TEAM_TOTAL_FOULS",
  "OFFSIDES_TOTAL",
  "HOME_TEAM_TOTAL_OFFSIDES",
  "AWAY_TEAM_TOTAL_OFFSIDES",
  "TOTAL_SHOTS",
  "TOTAL_SHOTS_ON_TARGET",
  "THROW_INS_TOTAL",
  "HOME_TEAM_TOTAL_THROW_INS",
  "AWAY_TEAM_TOTAL_THROW_INS",
  "GOAL_KICKS_TOTAL",
  "AWAY_TEAM_GOAL_KICKS",
  "HOME_TEAM_TOTAL_GOAL_KICKS",
  "POST_OR_CROSSBAR_TOTAL",
];

const HANDICAP_PARAM_MARKETS: NormalizedMarketType[] = [
  "ASIAN_HANDICAP",
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_ASIAN_HANDICAP",
  "FIRST_HALF_EUROPEAN_HANDICAP",
  "SECOND_HALF_ASIAN_HANDICAP",
  "SECOND_HALF_EUROPEAN_HANDICAP",
  // Stat handicaps share the same Swarm "base" semantics (opposite sign of
  // the home-relative catalog convention) as goal handicaps — cross-checked
  // on HALF_TIME_CORNERS_HANDICAP, where betcris' 1.45/2.55 quotes match the
  // peer consensus only at the sign-mirrored line. Without line extraction
  // these rows collapsed into an unlabelled "base" bucket and were dropped.
  "CORNERS_HANDICAP",
  "HALF_TIME_CORNERS_HANDICAP",
  "OFFSIDES_HANDICAP",
  "CARDS_HANDICAP",
  "HALF_TIME_CARDS_HANDICAP",
  "SECOND_HALF_CARDS_HANDICAP",
  "HALF_TIME_FOULS_HANDICAP",
  "SHOTS_HANDICAP",
  "SHOTS_ON_TARGET_HANDICAP",
  "CARDS_POINTS_HANDICAP",
  "GOAL_KICKS_HANDICAP",
  "THROW_INS_HANDICAP",
  "WOODWORK_SHOTS_HANDICAP",
  "XG_HANDICAP",
];

// Per-player O/U stat markets where betcris quotes one raw market per player
// ("<Player> (<Team>) strzały celne...") with bare "Powyżej "/"Poniżej "
// selections; the catalog keys these by a player-name parameter.
const PLAYER_OU_PARAM_MARKETS: NormalizedMarketType[] = [
  "PLAYER_SHOTS",
  "PLAYER_SHOTS_ON_TARGET",
  "PLAYER_FOULS",
  "PLAYER_FOULS_WON",
  "PLAYER_OFFSIDES",
  "PLAYER_SAVES",
];

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  // CORNERS_RACE_TO carries its threshold directly in raw.paramValue
  // ("3"/"5"/"7"/"9") from the Swarm "base" field. This market is neither
  // over/under nor handicap-shaped, so it fell through the two lists below
  // and always returned undefined even after the catalog was parameterized
  // (audit-match: Arsenal vs Coventry City — see catalog entry comment for
  // the cross-bookmaker collision this caused).
  if (marketCode === "CORNERS_RACE_TO") {
    return raw.paramValue && raw.paramValue !== "" ? raw.paramValue.replace(",", ".") : undefined;
  }

  // TIME_PERIOD_RESULT: betcris reuses one result-selection shape ("W1"/
  // "X"/"W2") across four distinct time windows ("1-15 min. Wynik", "1-30
  // min. Wynik", "1-60 min. Wynik", "1-75 min. Wynik") with no per-window
  // catalog id or paramValue field — without extracting the window end from
  // the market name, all four windows collapse onto one marketKey. Convention
  // matches the fuksiarz/lebull TIME_PERIOD_RESULT parameter (window end in
  // minutes as a plain string, e.g. "30").
  if (marketCode === "TIME_PERIOD_RESULT") {
    const windowMatch = raw.name.match(/\b1\s*[-–]\s*(\d{1,2})\s*\.?\s*min/i);
    return windowMatch ? windowMatch[1] : undefined;
  }

  const isOverUnder =
    OVER_UNDER_PARAM_MARKETS.includes(marketCode) ||
    STAT_OVER_UNDER_PARAM_MARKETS.includes(marketCode);
  const isHandicap = HANDICAP_PARAM_MARKETS.includes(marketCode);
  if (!isOverUnder && !isHandicap) return undefined;

  // 1. Line pre-extracted by the parser from the Swarm "base" field — the
  //    most reliable source. Without it every line of a market family would
  //    collapse into a single placeholder "base" bucket.
  if (raw.paramValue !== undefined && raw.paramValue !== "") {
    const normalized = raw.paramValue.replace(",", ".");
    if (!isHandicap) return normalized;
    const line = parseHandicapLine(normalized);
    if (line === undefined) return undefined;
    // The Swarm "base" field uses the OPPOSITE sign of our home-relative
    // catalog convention for handicap markets: cross-bookmaker audits
    // (Argentina-Cape Verde, Switzerland-Colombia) show every betcris
    // handicap row labelled P carrying the odds peers quote at -P — across
    // asian, european and 1st/2nd-half variants alike (whole rows including
    // DRAW move to the mirrored bucket, so it is a line-sign inversion, not
    // a selection swap). Negate to the home perspective. The label-derived
    // fallbacks below come from display text and keep their sign.
    const negated = -parseFloat(line);
    if (Number.isNaN(negated)) return undefined;
    return negated > 0 ? `+${negated}` : String(negated);
  }

  const selectionNames = raw.selections.map((s) => s.name);

  if (isOverUnder) {
    return parseOverUnderLine(selectionNames) ?? parseDecimalLine(raw.name);
  }

  // Handicap fallback: prefer a parenthesised line in selection labels,
  // e.g. "Argentyna (-1,5)". A bare leading number would wrongly match team
  // numbering such as "Team 1".
  for (const name of selectionNames) {
    const parenMatch = name.match(/\(([+-]?\d+[.,]?\d*)\)/);
    if (parenMatch) return parseHandicapLine(parenMatch[1]);
  }

  // Last resort: a number in the market name, after stripping half prefixes
  // ("1. połowa", "2. połowa") and the "(3-drogowy)" 3-way suffix that would
  // otherwise be misread as the handicap line.
  const cleanedName = raw.name
    .replace(/\b[12]\.?\s*po[lł]ow[aey]?\.?/gi, "")
    .replace(/3[\s-]*drogow\w*/gi, "");
  return parseHandicapLine(cleanedName);
}

export const betcrisNormalizer: BookmakerMarketNormalizer = {
  bookmaker: "betcris",

  normalizeMarket(
    raw: RawBookmakerMarket,
    ctx: NormalizationContext
  ): NormalizedMarketOutput | null {
    let marketCode: NormalizedMarketType | null = null;
    let matchedBy: "id" | "name" | "pattern" = "id";

    const marketType = extractMarketType(raw);
    if (marketType && BETCRIS_EXCLUDED_MARKET_IDS.has(marketType)) {
      // Known Swarm ids without a catalog counterpart — exclude to OTHER
      // instead of poisoning a wrong market.
      return null;
    }
    if (marketType) {
      marketCode = BETCRIS_MARKET_TYPE_TO_CODE[marketType] ?? null;
    }

    if (!marketCode) {
      matchedBy = "name";
      marketCode = matchMarketByName(raw.name);
    }

    if (!marketCode && raw.groupName) {
      matchedBy = "pattern";
      marketCode = matchMarketByName(raw.groupName);
    }

    if (!marketCode) {
      console.warn(
        `[betcris] Unknown market: "${raw.name}" (type: ${marketType ?? "none"}, group: ${raw.groupName ?? "none"})`
      );
      return null;
    }

    // --- Post-mapping reroutes: Swarm reuses one market id across match
    // periods/variants, so the id alone can land in the wrong catalog code.
    if (marketCode === "TOTAL_GOALS" && /azjatyck/i.test(raw.name)) {
      // Asian quarter-line totals ("Azjatycka liczba goli") reuse the plain
      // OverUnder id but settle with a split stake at quarter lines
      // (0.75/1.25/...) — reroute to the dedicated catalog code instead of
      // presenting them as plain TOTAL_GOALS lines.
      marketCode = "TOTAL_GOALS_ASIAN";
    }
    if (/przedzia[lł]/i.test(raw.name) && OVER_UNDER_PARAM_MARKETS.includes(marketCode)) {
      // Goal-band variants ("(przedziały)") reuse the totals ids but carry
      // range selections (0-1/2-3/4-6/7+) with no catalog counterpart.
      return null;
    }
    if (marketCode === "DOUBLE_CHANCE") {
      // "Podwójna szansa / obie drużyny strzelą gola" is a DOUBLE_CHANCE x
      // BTTS combo reusing the plain double-chance Swarm id (6 selections:
      // "1X/Tak", "1X/Nie", "12/Tak", "12/Nie", "X2/Tak", "X2/Nie"). The
      // generic DOUBLE_CHANCE selection parser only understands the leading
      // DC code, so every row normalized to the same UNKNOWN code and the
      // grouper's dedup kept only whichever quote came first — a fake price
      // baked into the real 9-bookmaker double-chance comparison, silently
      // dropping the other five combo prices. No catalog code exists for
      // this combo yet; exclude it (same "no combo catalog code" exclusion
      // pattern used elsewhere in this file, e.g.
      // FirstTeamToScoreAnd1stHalfResult).
      if (/obie\s*(drużyny\s+)?strzel/i.test(raw.name)) {
        return null;
      }
      // "Połowa z największą liczbą bramek. Podwójna szansa" is a half-with-
      // more-goals double chance (selections "1>=2"/"2>=1"/"1. lub 2."), not
      // a full-match result double chance — must be checked first since it
      // also contains "Podwójna szansa" but isn't scoped by "1./2. połowa".
      if (/po[lł]ow.*wi[eę]ksz.*(?:bramek|gol)/i.test(raw.name)) {
        marketCode = "HALF_WITH_MORE_GOALS_DOUBLE_CHANCE";
      } else if (/1\.?\s*po[lł]ow/i.test(raw.name)) {
        // "1. Połowa. Podwójna szansa" was mis-slotted into the full-match
        // market, poisoning best-odds with half-scoped prices.
        marketCode = "HALF_TIME_DOUBLE_CHANCE";
      } else if (/2\.?\s*po[lł]ow/i.test(raw.name)) marketCode = "SECOND_HALF_DOUBLE_CHANCE";
    }
    if (marketCode === "HALF_TIME_RED_CARD" && /2\.?\s*po[lł]ow/i.test(raw.name)) {
      // The "HalfRedCard" Swarm id also covers "2. Połowa. Czerwona kartka".
      marketCode = "SECOND_HALF_RED_CARD";
    }
    if (
      marketCode === "TOTAL_GOALS" &&
      /wynik\s+meczu.{0,6}(?:i|\/|oraz|lub).{0,6}liczba\s+goli/i.test(raw.name)
    ) {
      // "Wynik meczu lub/i/oraz liczba goli" is a match-result + total-goals
      // combo reusing the plain OverUnder Swarm id (hence sharing its
      // 1.5/2.5/3.5 lines) — its selections ("Francja / powyżej 2.5") don't
      // fit the plain OVER/UNDER vocabulary. No catalog code exists for this
      // combo. ("lub" was previously missing from the alternation, so this
      // guard silently let "Wynik meczu lub liczba goli" through into
      // TOTAL_GOALS with an UNKNOWN selection.)
      return null;
    }
    if (marketCode === "TOTAL_GOALS" && /3[\s-]*drogow/i.test(raw.name)) {
      // "Liczba goli 3-drogowo" (3-way: Under/Exactly/Over) reuses the plain
      // OverUnder Swarm id — force-mapping it into 2-way TOTAL_GOALS drops
      // the "Exactly N" leg's probability mass into Over/Under, inflating
      // both vs. peers' genuine 2-way lines. Route to the dedicated 3-way
      // catalog code instead.
      marketCode = "TOTAL_GOALS_3WAY";
    }
    if (
      marketCode === "HALF_TIME_TOTAL_GOALS" &&
      /3[\s-]*drogow/i.test(raw.name)
    ) {
      // "Rynek: 1. połowa. Liczba goli (3-drogowo)" is the same 3-way shape
      // for the 1st half, but no HALF_TIME_TOTAL_GOALS_3WAY catalog code
      // exists yet — exclude instead of force-mapping the "exactly 1" leg's
      // probability mass into a binary OVER/UNDER, which inflated betcris'
      // odds ~53% above peers' genuine 2-way half-time totals line.
      return null;
    }
    if (
      marketCode === "HALF_TIME_TOTAL_GOALS" &&
      /wygra\s+dok[lł]adn/i.test(raw.name)
    ) {
      // "1. połowa - Francja wygra dokładną różnicą goli" (exact winning
      // margin) reuses the HalfTimeOverUnder Swarm id but is a completely
      // different bet type (YES/NO on an exact margin, not a goals total).
      // No catalog code exists for this combo.
      return null;
    }
    if (
      marketCode === "HALF_TIME_TOTAL_GOALS" &&
      raw.selections.some((sel) => /^(parzyst|nieparzyst)/i.test(sel.name.trim()))
    ) {
      // "Parzysty"/"Nieparzysty" (1st-half odd/even goals) also reuses the
      // HalfTimeOverUnder Swarm id — route to the dedicated odd/even code
      // instead of leaking UNKNOWN selections into the totals ladder.
      marketCode = "HALF_TIME_ODD_EVEN_GOALS";
    }
    if (
      (marketCode === "HOME_TEAM_TOTAL_GOALS" || marketCode === "AWAY_TEAM_TOTAL_GOALS") &&
      raw.selections.length > 0 &&
      raw.selections.every((sel) => /^\s*\d+\+?\s*$/.test(sel.name))
    ) {
      // "Team 1/2. Liczba goli" also reuses the Team1/2OverUnder Swarm id for
      // an exact-goal-count distribution (" 0", " 1", " 2", " 3", " 4+")
      // instead of an Over/Under line — route to the dedicated exact-count
      // code instead of leaking these as UNKNOWN inside the team totals.
      marketCode = marketCode === "HOME_TEAM_TOTAL_GOALS" ? "HOME_EXACT_GOALS" : "AWAY_EXACT_GOALS";
    }

    if (!isValidMarketCode(marketCode)) {
      console.error(`[betcris] Market code "${marketCode}" not in catalog`);
      return null;
    }

    let paramValue = extractParamValue(marketCode, raw);

    // A handicap row without a resolvable line cannot be assigned to any
    // parameter bucket — drop it instead of leaking a wrong-line "base"
    // entry (e.g. "1. połowa. Handicap (3-drogowy)" with no visible number).
    if (paramValue === undefined && HANDICAP_PARAM_MARKETS.includes(marketCode)) {
      return null;
    }

    let selections = raw.selections.map((sel) => ({
      code: normalizeSelectionForMarket(sel.name, marketCode!, ctx),
      label: sel.name,
      odds: sel.odds,
    }));

    // CORNERS_RANGE: betcris quotes a 5-tier scale ("5 lub mniej"/"6-8"/
    // "9-11"/"12-14"/"15 lub więcej") that collapses onto the catalog's
    // coarse 3-bucket scale (0-8/9-11/12+), with TWO raw sub-buckets landing
    // on the same catalog code ("5 lub mniej" + "6-8" -> "0-8"; "12-14" +
    // "15 lub więcej" -> "12+"). Combine each colliding pair's implied
    // probability into one accurately-priced selection here — otherwise the
    // grouper's per-market "keep the first quote" dedup arbitrarily drops the
    // second raw quote, presenting only the "5 lub mniej" sub-bucket's own
    // (much tighter) price as if it covered the full 0-8 range.
    if (marketCode === "CORNERS_RANGE") {
      const merged = new Map<string, { code: NormalizedSelection; label: string; odds: number }>();
      for (const sel of selections) {
        const existing = merged.get(sel.code);
        if (existing && existing.odds > 0 && sel.odds > 0) {
          existing.odds = Math.round((1 / (1 / existing.odds + 1 / sel.odds)) * 100) / 100;
          existing.label = `${existing.label} / ${sel.label}`;
        } else if (!existing) {
          merged.set(sel.code, { ...sel });
        }
      }
      selections = Array.from(merged.values());
    }

    // FIRST_GOAL_AND_RESULT win/win rows carry unresolved "Team 1"/"Team 2"
    // template placeholders in the raw label (the draw-combo rows use real
    // team names instead) — the selection code already resolves correctly
    // via resolveResultToken, but substitute real team names into the
    // display label for a consistent, non-generic UI string.
    if (marketCode === "FIRST_GOAL_AND_RESULT" && (ctx.homeTeam || ctx.awayTeam)) {
      selections = selections.map((sel) => ({
        ...sel,
        label: sel.label
          .replace(/team\s*1/gi, ctx.homeTeam || "Team 1")
          .replace(/team\s*2/gi, ctx.awayTeam || "Team 2"),
      }));
    }

    // "Liczba goli 3-drogowo" (3-way total: under/exactly/over) carries an
    // extra "Dokładnie N" (exactly N goals) leg alongside the Over/Under
    // pair. TOTAL_GOALS only defines OVER/UNDER, so that leg has nowhere to
    // go — drop it instead of leaking an UNKNOWN selection into the market.
    if (marketCode === "TOTAL_GOALS") {
      selections = selections.filter((sel) => !/^dok[lł]adnie\b/i.test(sel.label.trim()));
    }

    // GOAL_RANGE/MULTI_GOAL_RANGE: drop MultiGoal's "Inny" catch-all leg
    // (normalized to UNKNOWN above — no slot in either band list) instead of
    // leaking an UNKNOWN selection into the market.
    if (marketCode === "GOAL_RANGE" || marketCode === "MULTI_GOAL_RANGE") {
      selections = selections.filter((sel) => sel.code !== "UNKNOWN");
    }

    // TEAM_TOTAL_GOALS_FIRST_60MIN uses side-prefixed catalog selections
    // (HOME_OVER/... vs AWAY_OVER/...); derive the side from the raw name
    // ("1-60 min. Team 1/2. Liczba goli").
    if (marketCode === "TEAM_TOTAL_GOALS_FIRST_60MIN") {
      const side = /team\s*2|dru[żz]yna\s*2|go[śs]c/i.test(raw.name) ? "AWAY" : "HOME";
      selections = selections.map((sel) =>
        sel.code === "OVER" || sel.code === "UNDER"
          ? { ...sel, code: `${side}_${sel.code}` as NormalizedSelection }
          : sel
      );
    }

    // Team-scoped stat markets: derive the side from the Swarm id
    // ("Team1...", "HomeTeam...") or the raw name ("Team 1. Liczba ...").
    const sideSource = `${marketType ?? ""} ${raw.name}`;
    const teamSide = /team\s*1|home\s*team/i.test(sideSource)
      ? "HOME"
      : /team\s*2|away\s*team/i.test(sideSource)
        ? "AWAY"
        : undefined;

    // Catalog selections for these codes are HOME_OVER/HOME_UNDER/AWAY_OVER/
    // AWAY_UNDER — bare OVER/UNDER rows were silently rejected downstream.
    if ((marketCode === "CARDS_TEAM" || marketCode === "HALF_TIME_CORNERS_TEAM") && teamSide) {
      selections = selections.map((sel) =>
        sel.code === "OVER" || sel.code === "UNDER"
          ? { ...sel, code: `${teamSide}_${sel.code}` as NormalizedSelection }
          : sel
      );
    }

    // Side-scoped line parameters (betclic convention: "HOME:2.5"), so the
    // two teams' lines never merge into one cross-team bucket.
    if (
      teamSide &&
      (marketCode === "CORNERS_TEAM" ||
        marketCode === "TEAM_TOTAL_SHOTS" ||
        marketCode === "TEAM_TOTAL_SHOTS_ON_TARGET")
    ) {
      paramValue = paramValue ? `${teamSide}:${paramValue}` : teamSide;
    }

    // RED_CARD_TEAM: the side is the parameter (betclic convention), so the
    // home team's odds never share a bucket with the away team's.
    if (marketCode === "RED_CARD_TEAM" && teamSide) {
      paramValue = teamSide;
    }

    // Per-player stat lines: the player lives in the market name ("Gustavo
    // Puerta (Kolumbia) strzały celne...") and selections are bare O/U
    // labels. Key the market parameter by the canonical player name so the
    // row joins the same player's bucket across bookmakers.
    if (
      PLAYER_OU_PARAM_MARKETS.includes(marketCode) &&
      selections.length > 0 &&
      selections.every((sel) => sel.code === "OVER" || sel.code === "UNDER")
    ) {
      // Bulk multi-player markets ("Zawodnik. Liczba strzałów celnych (musi
      // rozpocząć): Powyżej" etc.) are pre-split by the parser into one
      // synthetic entry per player, which carries the raw player name via
      // paramValue since there is no numeric line to report. A genuine
      // numeric line (the already-working single-market-per-player shape)
      // stays on the raw.name fallback below.
      if (raw.paramValue && !/^[+-]?\d+([.,]\d+)?$/.test(raw.paramValue)) {
        paramValue = canonicalizePlayerName(raw.paramValue);
      } else {
        const playerMatch = raw.name.match(/^([^(.:]+?)\s*\(/);
        const playerName = playerMatch?.[1]?.trim();
        if (playerName && !/^zawodnik/i.test(playerName)) {
          paramValue = canonicalizePlayerName(playerName);
        }
      }
    }

    // PLAYER_FOULS/PLAYER_FOULS_WON have no catalog "OVER" code (only
    // 1+/2+/3+/4+ tiers) — a bare "OVER" from betcris' single-threshold
    // "musi rozpocząć: Powyżej N" bulk markets is always an orphan. Convert
    // it to the matching N+ tier using the numeric line the parser recovers
    // into raw.name ("... Powyżej 3.5" -> over 3.5 -> "4+"); fall back to the
    // lowest tier when no line can be recovered.
    if (
      (marketCode === "PLAYER_FOULS" || marketCode === "PLAYER_FOULS_WON") &&
      selections.some((sel) => sel.code === "OVER")
    ) {
      const lineMatch = raw.name.match(/powy[żz]ej\s+([\d.,]+)\s*$/i);
      const line = lineMatch ? parseFloat(lineMatch[1].replace(",", ".")) : undefined;
      const tier = line !== undefined ? Math.min(4, Math.max(1, Math.floor(line) + 1)) : 1;
      selections = selections.map((sel) =>
        sel.code === "OVER" ? { ...sel, code: `${tier}+` as NormalizedSelection } : sel
      );
    }

    // PLAYER_SHOTS/PLAYER_SHOTS_ON_TARGET: betcris publishes one raw market
    // per threshold ("Zawodnik. Liczba strzałów (celnych) (musi rozpocząć):
    // Powyżej N.5"), every one of them sharing the same paramValue (the
    // player) and, before this fix, the same bare "OVER" selection code —
    // collapsing the whole 8/9-line ladder onto a single code so only the
    // last-processed threshold survived (round8 audit
    // P3-betcris-normalizer-over-to-tier / p2-betcris-over-to-tier). Recover
    // the threshold from raw.name and convert to the matching N+ tier, same
    // convention as PLAYER_FOULS above, but WITHOUT that block's 4-tier
    // clamp (these ladders run up to 9+/7+) — gate against the catalog's own
    // declared selection set instead, so an out-of-range tier is dropped
    // rather than silently clamped into a neighboring one.
    if (
      (marketCode === "PLAYER_SHOTS" || marketCode === "PLAYER_SHOTS_ON_TARGET") &&
      selections.some((sel) => sel.code === "OVER")
    ) {
      const lineMatch = raw.name.match(/powy[żz]ej\s+([\d.,]+)\s*$/i);
      const line = lineMatch ? parseFloat(lineMatch[1].replace(",", ".")) : undefined;
      const catalogSelections = getMarketByCode(marketCode)?.selections;
      selections = selections.flatMap((sel) => {
        if (sel.code !== "OVER") return [sel];
        if (line === undefined) return [];
        const tier = `${Math.floor(line) + 1}+`;
        if (!catalogSelections?.includes(tier)) return [];
        return [{ ...sel, code: tier as NormalizedSelection }];
      });
    }

    // PLAYER_OFFSIDES has only one catalog tier ("1+") and no meaningful
    // "Under" side — betcris' bare "OVER" (from "Player to Be in Offside
    // Over (Must Start)") always represents that single tier.
    if (marketCode === "PLAYER_OFFSIDES") {
      selections = selections.map((sel) =>
        sel.code === "OVER" ? { ...sel, code: "1+" as NormalizedSelection } : sel
      );
    }

    // Bulk multi-player markets with no Over/Under shape ("Zaliczy asystę w
    // meczu" -> PLAYER_ASSISTS "1+"; "Strzeli 4 gole lub więcej" ->
    // PLAYER_4_OR_MORE_GOALS "YES"; "Strzelec gola / mecz zakończy się
    // remisem" -> PLAYER_GOAL_AND_RESULT "DRAW"): same parser split/
    // paramValue convention as the PLAYER_OU_PARAM_MARKETS block above.
    if (
      (marketCode === "PLAYER_ASSISTS" ||
        marketCode === "PLAYER_4_OR_MORE_GOALS" ||
        marketCode === "PLAYER_GOAL_AND_RESULT") &&
      raw.paramValue &&
      !/^[+-]?\d+([.,]\d+)?$/.test(raw.paramValue)
    ) {
      paramValue = canonicalizePlayerName(raw.paramValue);
    }

    const marketKey = buildMarketKey(marketCode, paramValue);

    return {
      marketCode,
      paramValue,
      marketKey,
      selections,
      debug: {
        rawName: raw.name,
        rawId: marketType ?? undefined,
        matchedBy,
      },
    };
  },
};

export default betcrisNormalizer;
