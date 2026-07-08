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
} from "../helpers/index.js";
import { isValidMarketCode } from "../../../data/market-catalog.js";

const BETCRIS_MARKET_TYPE_TO_CODE: Record<string, NormalizedMarketType> = {
  "P1XP2": "MATCH_WINNER",
  "1X12X2": "DOUBLE_CHANCE",
  "P1XP2DC": "DOUBLE_CHANCE",
  "DrawNoBet": "DRAW_NO_BET",
  "OverUnder": "TOTAL_GOALS",
  "BothTeamsToScore": "BTTS",
  "OddEven": "ODD_EVEN_GOALS",
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
  "BothTeamsToScoreFirstHalf": "HALF_TIME_BTTS",
  "AsianHandicap": "ASIAN_HANDICAP",
  "EuropeanHandicap": "EUROPEAN_HANDICAP",
  "CorrectScore": "CORRECT_SCORE",
  "HalftimeFulltime": "HALFTIME_FULLTIME",
  // Audited mappings keyed by raw bookmakerMarketId
  "Team2HalfWithMostGoals": "AWAY_HALF_WITH_MOST_GOALS",
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
  "1-30MinutesBothTeamToScore": "BTTS_FIRST_30_MIN",
  "1-30Handicap": "TIME_PERIOD_HANDICAP",
  "1-30Result": "TIME_PERIOD_RESULT",
  "1-15MinutesBothTeamToScore": "FIRST_15_MIN_BTTS",
  "1-15Handicap": "FIRST_15_MIN_HANDICAP",
  "1-15Result": "TIME_PERIOD_RESULT",
  "Team2ScoreYes/No": "AWAY_TEAM_TO_SCORE",
  "Team1ScoreYes/no": "HOME_TEAM_TO_SCORE",
  "Handicap": "EUROPEAN_HANDICAP",
  // Binary Yes/No prop ("Dokładnie 1 gol w całym meczu") — matches the
  // EXACT_GOALS_YN code lvbet uses; it must NOT be flattened into the
  // EXACT_GOALS 0..6+ distribution (its YES/NO selections were orphans there).
  "Exactly1GoalsinMatch": "EXACT_GOALS_YN",
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
  "PlayerToScore4OrMore": "PLAYER_GOALS",
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
    return String(raw.bookmakerMarketId);
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
    if (isSecondHalf) return isLast ? "SECOND_HALF_LAST_GOAL" : "SECOND_HALF_FIRST_GOAL";
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

  if (/wynik\s+1\.?\s*po[lł]owy/i.test(lower) || /1\.?\s*po[lł]owa.*wynik/i.test(lower)) return "HALF_TIME_RESULT";
  if (/gole?\s+1\.?\s*po[lł]ow/i.test(lower) || /1\.?\s*po[lł]owa.*gol/i.test(lower)) return "HALF_TIME_TOTAL_GOALS";
  if (/obie.*strzela.*1\.?\s*po[lł]ow/i.test(lower) || /1\.?\s*po[lł]owa.*obie.*strzela/i.test(lower)) return "HALF_TIME_BTTS";

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
    case "SECOND_HALF_LAST_GOAL":
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
    // "Nieparzysty"/"Parzysty" (masculine singular) on stat parity markets
    case "CORNERS_ODD_EVEN":
    case "CARDS_ODD_EVEN":
      return normalizeOddEvenSelection(trimmed);

    case "CORNERS_TOTAL_3WAY":
      if (/^dok[lł]adnie/i.test(lowerTrimmed)) return "EXACTLY" as NormalizedSelection;
      return normalizeOverUnderSelection(trimmed);

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
    case "PLAYER_HEADER_GOAL":
    case "PLAYER_GOAL_OR_ASSIST":
    case "PLAYER_GOAL_AND_ASSIST":
    case "PLAYER_GOAL_AND_TEAM_WIN":
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
      // Canonical "Firstname Lastname" order shared across all bookmakers.
      return canonicalizePlayerName(
        trimmed.replace(/^\d+\.\s*/, "")
      ) as NormalizedSelection;

    case "BOTH_PLAYERS_ANYTIME":
    case "TWO_PLAYERS_ANYTIME":
      // Catalog vocabulary is a single PLAYER_PAIR code (betclic convention);
      // raw "A and B"/"A i B" strings never matched any catalog selection.
      return "PLAYER_PAIR" as NormalizedSelection;

    case "THREE_PLAYERS_ANYTIME":
    case "ALL_PLAYERS_SCORE":
      // Catalog vocabulary is a single PLAYER_TRIO code (betclic convention).
      return "PLAYER_TRIO" as NormalizedSelection;

    case "CORRECT_SCORE":
    case "HALF_TIME_CORRECT_SCORE":
    case "SECOND_HALF_CORRECT_SCORE":
    case "ANYTIME_CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
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
  "HALF_TIME_TOTAL_GOALS",
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
      // Asian quarter-line totals ("Azjatycka suma goli") settle with a
      // split stake — do not present them as plain TOTAL_GOALS lines.
      return null;
    }
    if (/przedzia[lł]/i.test(raw.name) && OVER_UNDER_PARAM_MARKETS.includes(marketCode)) {
      // Goal-band variants ("(przedziały)") reuse the totals ids but carry
      // range selections (0-1/2-3/4-6/7+) with no catalog counterpart.
      return null;
    }
    if (marketCode === "DOUBLE_CHANCE") {
      // "1. Połowa. Podwójna szansa" was mis-slotted into the full-match
      // market, poisoning best-odds with half-scoped prices.
      if (/1\.?\s*po[lł]ow/i.test(raw.name)) marketCode = "HALF_TIME_DOUBLE_CHANCE";
      else if (/2\.?\s*po[lł]ow/i.test(raw.name)) marketCode = "SECOND_HALF_DOUBLE_CHANCE";
    }
    if (marketCode === "HALF_TIME_RED_CARD" && /2\.?\s*po[lł]ow/i.test(raw.name)) {
      // The "HalfRedCard" Swarm id also covers "2. Połowa. Czerwona kartka".
      marketCode = "SECOND_HALF_RED_CARD";
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
      const playerMatch = raw.name.match(/^([^(.:]+?)\s*\(/);
      const playerName = playerMatch?.[1]?.trim();
      if (playerName && !/^zawodnik/i.test(playerName)) {
        paramValue = canonicalizePlayerName(playerName);
      }
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
