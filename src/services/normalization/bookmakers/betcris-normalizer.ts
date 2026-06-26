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
  "Team1OverUnder": "TEAM_TOTAL_GOALS",
  "Team2OverUnder": "TEAM_TOTAL_GOALS",
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
  "Exactly4GoalsinMatch": "EXACT_GOALS",
  "Exactly3GoalsinMatch": "EXACT_GOALS",
  "Exactly2GoalsinMatch": "EXACT_GOALS",
  "Exactly1GoalsinMatch": "EXACT_GOALS",
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
  "TeamWithMostYellowCardsWithDraw": "CARDS_RACE",
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
  "Cards:Total(Bands)": "CARDS_EXACT_RANGE",
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
  "Odd": "ODD",
  "odd": "ODD",
  "Even": "EVEN",
  "even": "EVEN",
};

function extractMarketType(raw: RawBookmakerMarket): string | null {
  if (raw.bookmakerMarketId) {
    return String(raw.bookmakerMarketId);
  }

  if (raw.groupName) {
    const groupLower = raw.groupName.toLowerCase();
    if (groupLower.includes("wynik meczu")) return "P1XP2";
    if (groupLower.includes("podwójna szansa") || groupLower.includes("podwojna szansa")) return "1X12X2";
    if (groupLower.includes("gole") && !groupLower.includes("drużyny") && !groupLower.includes("druzyny")) return "OverUnder";
    if (groupLower.includes("obie") && groupLower.includes("strzela")) return "BothTeamsToScore";
    if (groupLower.includes("pierwsza polowa") || groupLower.includes("1. polowa")) return "P1XP2FirstHalf";
    if (groupLower.includes("handicap") && groupLower.includes("azjatycki")) return "AsianHandicap";
    if (groupLower.includes("handicap") && groupLower.includes("europejski")) return "EuropeanHandicap";
    if (groupLower.includes("dokładny wynik") || groupLower.includes("dokladny wynik")) return "CorrectScore";
  }

  return null;
}

function matchMarketByName(name: string): NormalizedMarketType | null {
  const lower = name.toLowerCase().trim();

  if (/^wynik\s+meczu$/i.test(lower) || /^1x2$/i.test(lower)) return "MATCH_WINNER";
  if (/podw[oó]jna\s+szansa/i.test(lower)) return "DOUBLE_CHANCE";
  if (/remis\s*[=:]\s*zwrot/i.test(lower) || /draw\s*no\s*bet/i.test(lower)) return "DRAW_NO_BET";

  if (/liczba\s+goli/i.test(lower) && !/(gospodarzy|go[sś]ci|drużyny|druzyny)/i.test(lower)) return "TOTAL_GOALS";
  if (/obie\s+(drużyny\s+)?strzela/i.test(lower) || /obie\s+druzyny\s+strzela/i.test(lower)) return "BTTS";
  if (/parzyste.*nieparzyste|nieparzyste.*parzyste|odd.*even/i.test(lower)) return "ODD_EVEN_GOALS";
  if (/wygrana\s+do\s+zera/i.test(lower)) return "WIN_TO_NIL";
  if (/czyste\s+konto/i.test(lower)) return "CLEAN_SHEET";

  if (/gole\s+(gospodarzy|drużyny\s+1|team\s*1)/i.test(lower)) return "TEAM_TOTAL_GOALS";
  if (/gole\s+(go[sś]ci|drużyny\s+2|team\s*2)/i.test(lower)) return "TEAM_TOTAL_GOALS";

  if (/wynik\s+1\.?\s*po[lł]owy/i.test(lower) || /1\.?\s*po[lł]owa.*wynik/i.test(lower)) return "HALF_TIME_RESULT";
  if (/gole?\s+1\.?\s*po[lł]ow/i.test(lower) || /1\.?\s*po[lł]owa.*gol/i.test(lower)) return "HALF_TIME_TOTAL_GOALS";
  if (/obie.*strzela.*1\.?\s*po[lł]ow/i.test(lower) || /1\.?\s*po[lł]owa.*obie.*strzela/i.test(lower)) return "HALF_TIME_BTTS";

  if (/handicap\s+azjatycki/i.test(lower) || /asian\s+handicap/i.test(lower)) return "ASIAN_HANDICAP";
  if (/handicap\s+europejski/i.test(lower) || /european\s+handicap/i.test(lower)) return "EUROPEAN_HANDICAP";

  if (/dok[lł]adny\s+wynik/i.test(lower) || /correct\s+score/i.test(lower)) return "CORRECT_SCORE";

  if (/wynik\s+po[lł]owa.*mecz|po[lł]owa.*koniec|ht.*ft/i.test(lower)) return "HALFTIME_FULLTIME";

  return null;
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
    case "TEAM_TOTAL_GOALS":
      return normalizeOverUnderSelection(trimmed);

    case "BTTS":
    case "HALF_TIME_BTTS":
      return normalizeYesNoSelection(trimmed);

    case "ODD_EVEN_GOALS":
      return normalizeOddEvenSelection(trimmed);

    case "ASIAN_HANDICAP":
    case "EUROPEAN_HANDICAP":
      if (/^1\b|^w1\b|^home/i.test(trimmed)) return "HOME";
      if (/^2\b|^w2\b|^away/i.test(trimmed)) return "AWAY";
      if (/^x\b|^draw/i.test(trimmed)) return "DRAW";
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);

    case "CORRECT_SCORE": {
      const score = parseScoreSelection(trimmed);
      return (score ?? trimmed) as NormalizedSelection;
    }

    case "HALFTIME_FULLTIME": {
      const htft = parseHtFtSelection(trimmed);
      return (htft ?? trimmed) as NormalizedSelection;
    }

    default:
      return normalize1x2Selection(trimmed, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }
}

function extractParamValue(
  marketCode: NormalizedMarketType,
  raw: RawBookmakerMarket
): string | undefined {
  const parameterizedMarkets = [
    "TOTAL_GOALS",
    "HALF_TIME_TOTAL_GOALS",
    "TEAM_TOTAL_GOALS",
    "ASIAN_HANDICAP",
    "EUROPEAN_HANDICAP",
  ];

  if (!parameterizedMarkets.includes(marketCode)) return undefined;

  const selectionNames = raw.selections.map((s) => s.name);
  
  if (["TOTAL_GOALS", "HALF_TIME_TOTAL_GOALS", "TEAM_TOTAL_GOALS"].includes(marketCode)) {
    return parseOverUnderLine(selectionNames);
  }

  if (["ASIAN_HANDICAP", "EUROPEAN_HANDICAP"].includes(marketCode)) {
    const nameMatch = raw.name.match(/([+-]?\d+[.,]?\d*)/);
    if (nameMatch) {
      return parseHandicapLine(nameMatch[1]);
    }
    
    for (const sel of raw.selections) {
      const handicapLine = parseHandicapLine(sel.name);
      if (handicapLine) return handicapLine;
    }
  }

  return undefined;
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

    if (!isValidMarketCode(marketCode)) {
      console.error(`[betcris] Market code "${marketCode}" not in catalog`);
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
        rawId: marketType ?? undefined,
        matchedBy,
      },
    };
  },
};

export default betcrisNormalizer;
