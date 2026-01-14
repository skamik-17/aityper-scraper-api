-- ============================================================================
-- Migration: Add missing market types
-- Date: 2026-01-13
-- Description: Adds missing market types from market-catalog.ts to the database
-- ============================================================================

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- 74: HALF_TIME_CORNERS_RACE
  (74, 'HALF_TIME_CORNERS_RACE', 'Więcej rożnych 1. połowa', 'Half Time Corners Race',
   'Która drużyna wykona więcej rzutów rożnych w pierwszej połowie?', 'Which team will have more corners in first half?',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['HOME', 'DRAW', 'AWAY'], 83),

   -- 103: HALF_TIME_RESULT_AND_BTTS
   (103, 'HALF_TIME_RESULT_AND_BTTS', 'Wynik 1. połowy + BTTS', 'Half Time Result & BTTS',
    'Wynik 1. połowy i czy obie strzelą', 'Half time result and both teams score',
    'COMBINATION', 'PIERWSZA_POLOWA', FALSE, NULL,
    ARRAY['HOME_YES', 'HOME_NO', 'DRAW_YES', 'DRAW_NO', 'AWAY_YES', 'AWAY_NO'], 47),

   -- 104: HALF_TIME_HOME_TO_SCORE
   (104, 'HALF_TIME_HOME_TO_SCORE', '1. połowa - gospodarz strzeli', 'Home Team To Score (1st Half)',
    'Czy gospodarze strzelą w 1. połowie?', 'Will the home team score in the first half?',
    'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
    ARRAY['YES', 'NO'], 48),

   -- 105: HALF_TIME_AWAY_TO_SCORE
   (105, 'HALF_TIME_AWAY_TO_SCORE', '1. połowa - gość strzeli', 'Away Team To Score (1st Half)',
    'Czy goście strzelą w 1. połowie?', 'Will the away team score in the first half?',
    'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
    ARRAY['YES', 'NO'], 49),

   -- 106: SECOND_HALF_HOME_TO_SCORE
   (106, 'SECOND_HALF_HOME_TO_SCORE', '2. połowa - gospodarz strzeli', 'Home Team To Score (2nd Half)',
    'Czy gospodarze strzelą w 2. połowie?', 'Will the home team score in the second half?',
    'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
    ARRAY['YES', 'NO'], 50),

   -- 107: SECOND_HALF_ASIAN_HANDICAP
   (107, 'SECOND_HALF_ASIAN_HANDICAP', 'Handicap azjatycki 2. połowa', 'Second Half Asian Handicap',
    'Azjatycki handicap w drugiej połowie', 'Asian handicap in second half',
    'HANDICAP_SELECTOR', 'HANDICAP', TRUE, 'handicap',
    ARRAY['HOME', 'AWAY'], 17),

   -- 190: SECOND_HALF_FIRST_GOAL
  (190, 'SECOND_HALF_FIRST_GOAL', 'Pierwszy gol 2. połowy', 'First Goal 2nd Half',
   'Która drużyna strzeli pierwszego gola w 2. połowie?', 'Which team scores first in second half?',
   'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['HOME', 'AWAY', 'NONE'], 52),

  -- 191: SECOND_HALF_AWAY_TO_SCORE
  (191, 'SECOND_HALF_AWAY_TO_SCORE', '2. połowa - gość strzeli', 'Away Team To Score (2nd Half)',
   'Czy goście strzelą w 2. połowie?', 'Will away team score in second half?',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['YES', 'NO'], 51),

  -- 200: HALF_TIME_FIRST_GOAL
  (200, 'HALF_TIME_FIRST_GOAL', 'Pierwszy gol 1. połowy', 'First Goal 1st Half',
   'Kto strzeli pierwszego gola w 1. połowie?', 'Who scores first in 1st half?',
   'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['HOME', 'AWAY', 'NONE'], 200),

  -- 201: HALF_TIME_DOUBLE_CHANCE
  (201, 'HALF_TIME_DOUBLE_CHANCE', 'Podwójna szansa 1. połowa', 'Double Chance 1st Half',
   'Podwójna szansa w pierwszej połowie', 'Double chance in first half',
   'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['HOME_OR_DRAW', 'HOME_OR_AWAY', 'DRAW_OR_AWAY'], 201),

  -- 202: HALF_TIME_DRAW_NO_BET
  (202, 'HALF_TIME_DRAW_NO_BET', 'Remis = zwrot 1. połowa', 'Draw No Bet 1st Half',
   'Zakład bez remisu w pierwszej połowie', 'Draw no bet in first half',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['HOME', 'AWAY'], 202),

  -- 203: HALF_TIME_RESULT_AND_TOTAL
  (203, 'HALF_TIME_RESULT_AND_TOTAL', 'Wynik 1. połowy + liczba goli', '1st Half Result + Total',
   'Wynik 1. połowy i liczba goli', '1st Half result and total goals',
   'COMBINATION', 'PIERWSZA_POLOWA', TRUE, 'decimal',
   ARRAY['HOME_OVER', 'HOME_UNDER', 'DRAW_OVER', 'DRAW_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 203),

  -- 204: SECOND_HALF_CORRECT_SCORE
  (204, 'SECOND_HALF_CORRECT_SCORE', 'Dokładny wynik 2. połowy', 'Correct Score 2nd Half',
   'Dokładny wynik drugiej połowy', 'Exact score of the second half',
   'SCORE_GRID', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['SCORE'], 204),

  -- 205: HALF_TIME_TEAM_TOTAL_GOALS
  (205, 'HALF_TIME_TEAM_TOTAL_GOALS', 'Gole drużyny w 1. połowie', 'Team Goals 1st Half',
   'Liczba goli drużyny w pierwszej połowie', 'Team goals in first half',
   'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal',
   ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 205),

  -- 206: SECOND_HALF_TEAM_TOTAL_GOALS
  (206, 'SECOND_HALF_TEAM_TOTAL_GOALS', 'Gole drużyny w 2. połowie', 'Team Goals 2nd Half',
   'Liczba goli drużyny w drugiej połowie', 'Team goals in second half',
   'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal',
   ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 206),

  -- 207: HALF_TIME_EXACT_GOALS
  (207, 'HALF_TIME_EXACT_GOALS', 'Dokładna liczba goli 1. połowa', 'Exact Goals 1st Half',
   'Dokładna liczba goli w pierwszej połowie', 'Exact number of goals in first half',
   'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['0', '1', '2', '3+'], 207),

  -- 208: SECOND_HALF_EXACT_GOALS
  (208, 'SECOND_HALF_EXACT_GOALS', 'Dokładna liczba goli 2. połowa', 'Exact Goals 2nd Half',
   'Dokładna liczba goli w drugiej połowie', 'Exact number of goals in second half',
   'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['0', '1', '2+'], 208),

  -- 209: FIRST_HALF_EUROPEAN_HANDICAP
  (209, 'FIRST_HALF_EUROPEAN_HANDICAP', 'Handicap europejski 1. połowa', 'European Handicap 1st Half',
   'Handicap europejski w pierwszej połowie', 'European handicap in first half',
   'HANDICAP_SELECTOR', 'PIERWSZA_POLOWA', TRUE, 'handicap',
   ARRAY['HOME', 'DRAW', 'AWAY'], 209),

  -- 210: FIRST_HALF_ASIAN_HANDICAP
  (210, 'FIRST_HALF_ASIAN_HANDICAP', 'Handicap azjatycki 1. połowa', 'Asian Handicap 1st Half',
   'Handicap azjatycki w pierwszej połowie', 'Asian handicap in first half',
   'HANDICAP_SELECTOR', 'PIERWSZA_POLOWA', TRUE, 'handicap',
   ARRAY['HOME', 'AWAY'], 210),

   -- 211: TEAM_WIN_AT_LEAST_ONE_HALF
   (211, 'TEAM_WIN_AT_LEAST_ONE_HALF', 'Wygra przynajmniej jedną połowę', 'To Win Either Half',
    'Czy drużyna wygra przynajmniej jedną połowę?', 'Will team win at least one half?',
    'BINARY_BUTTONS', 'WYNIK_MECZU', TRUE, 'decimal',
    ARRAY['YES', 'NO'], 211),

   -- 212: HALF_WITH_MORE_GOALS
  (212, 'HALF_WITH_MORE_GOALS', 'Połowa z większą liczbą goli', 'Half with Most Goals',
   'W której połowie padnie więcej goli?', 'In which half will more goals be scored?',
   'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
   ARRAY['1st', '2nd', 'Draw'], 212),

  -- 213: TEAM_HALF_WITH_MORE_GOALS
  (213, 'TEAM_HALF_WITH_MORE_GOALS', 'Połowa z większą liczbą goli drużyny', 'Team Half with Most Goals',
   'W której połowie drużyna strzeli więcej goli?', 'In which half will team score more goals?',
   'COMBINATION', 'GOLE', TRUE, 'decimal',
   ARRAY['HOME_1ST', 'HOME_2ND', 'HOME_EQUAL', 'AWAY_1ST', 'AWAY_2ND', 'AWAY_EQUAL'], 213),

  -- 214: BTTS_BY_HALF
  (214, 'BTTS_BY_HALF', 'BTTS w połowach', 'BTTS in Halves',
   'W której połowie obie drużyny strzelą?', 'In which half will both teams score?',
   'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
   ARRAY['1st', '2nd', 'Both', 'None'], 214),

   -- 215: TEAM_SCORES_BOTH_HALVES
   (215, 'TEAM_SCORES_BOTH_HALVES', 'Strzeli w obu połowach', 'Score in Both Halves',
    'Czy drużyna strzeli w obu połowach?', 'Will team score in both halves?',
    'BINARY_BUTTONS', 'GOLE', TRUE, 'decimal',
    ARRAY['YES', 'NO'], 215),

   -- 216: BOTH_HALVES_TOTAL_GOALS
  (216, 'BOTH_HALVES_TOTAL_GOALS', 'Liczba goli w obu połowach', 'Goals in Both Halves',
   'Czy w obu połowach padnie powyżej/poniżej X goli?', 'Over/Under goals in both halves',
   'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal',
   ARRAY['OVER', 'UNDER'], 216),

  -- 217: CORNERS_TEAM_RANGE
  (217, 'CORNERS_TEAM_RANGE', 'Rzuty rożne drużyny (przedział)', 'Team Corners Range',
   'Przedział rzutów rożnych drużyny', 'Range of team corners',
   'TRIPLE_BUTTONS', 'STATYSTYKI', TRUE, 'decimal',
   ARRAY['HOME_0-2', 'HOME_3-4', 'HOME_5+', 'AWAY_0-2', 'AWAY_3-4', 'AWAY_5+'], 217),

  -- 218: HALF_TIME_CORNERS_HANDICAP
  (218, 'HALF_TIME_CORNERS_HANDICAP', 'Handicap rożnych 1. połowa', 'Corners Handicap 1st Half',
   'Handicap rzutów rożnych w pierwszej połowie', 'Corners handicap in first half',
   'HANDICAP_SELECTOR', 'STATYSTYKI', TRUE, 'handicap',
   ARRAY['HOME', 'AWAY'], 218),

  -- 219: EXACT_GOALS
  (219, 'EXACT_GOALS', 'Dokładna liczba goli', 'Exact Goals',
   'Dokładna liczba goli w meczu', 'Exact number of goals in match',
   'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
   ARRAY['0', '1', '2', '3', '4', '5', '6+'], 219),

  -- 220: CORNERS_RANGE
  (220, 'CORNERS_RANGE', 'Przedział rzutów rożnych', 'Corners Range',
   'Przedział liczby rzutów rożnych w meczu', 'Range of total corners',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['0-8', '9-11', '12+'], 220),

  -- 221: HALF_TIME_CORNERS_RANGE
  (221, 'HALF_TIME_CORNERS_RANGE', 'Przedział rożnych 1. połowa', 'Corners Range 1st Half',
   'Przedział rożnych w 1. połowie', 'Corners range in 1st half',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['0-4', '5-6', '7+'], 221),

  -- 222: HALF_TIME_CORNERS_TEAM_RANGE
  (222, 'HALF_TIME_CORNERS_TEAM_RANGE', 'Przedział rożnych drużyny 1. poł.', 'Team Corners Range 1st Half',
   'Przedział rożnych drużyny w 1. połowie', 'Team corners range in 1st half',
   'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
   ARRAY['HOME_0-1', 'HOME_2-3', 'HOME_4+', 'AWAY_0-1', 'AWAY_2-3', 'AWAY_4+'], 222),

  -- 223: HALF_TIME_DOUBLE_CHANCE_BTTS
  (223, 'HALF_TIME_DOUBLE_CHANCE_BTTS', 'Podwójna szansa 1. poł. + BTTS 1. poł.', 'DC 1st Half + BTTS 1st Half',
   'Podwójna szansa i BTTS w 1. połowie', 'Double chance and BTTS in 1st half',
   'COMBINATION', 'KOMBINACJE', FALSE, NULL,
   ARRAY['1X_YES', '1X_NO', 'X2_YES', 'X2_NO', '12_YES', '12_NO'], 223),

  -- 224: SECOND_HALF_DOUBLE_CHANCE_BTTS
  (224, 'SECOND_HALF_DOUBLE_CHANCE_BTTS', 'Podwójna szansa 2. poł. + BTTS 2. poł.', 'DC 2nd Half + BTTS 2nd Half',
   'Podwójna szansa i BTTS w 2. połowie', 'Double chance and BTTS in 2nd half',
   'COMBINATION', 'KOMBINACJE', FALSE, NULL,
   ARRAY['1X_YES', '1X_NO', 'X2_YES', 'X2_NO', '12_YES', '12_NO'], 224),

   -- 225: SECOND_HALF_RESULT_AND_BTTS
   (225, 'SECOND_HALF_RESULT_AND_BTTS', 'Wynik 2. poł. + BTTS 2. poł.', 'Result 2nd Half + BTTS 2nd Half',
    'Wynik i BTTS w 2. połowie', 'Result and BTTS in 2nd half',
    'COMBINATION', 'KOMBINACJE', FALSE, NULL,
    ARRAY['HOME_YES', 'HOME_NO', 'DRAW_YES', 'DRAW_NO', 'AWAY_YES', 'AWAY_NO'], 225),

   -- 226: TEAM_WIN_BOTH_HALVES
   (226, 'TEAM_WIN_BOTH_HALVES', 'Wygra obie połowy', 'To Win Both Halves',
    'Czy drużyna wygra obie połowy meczu?', 'Will team win both halves?',
    'BINARY_BUTTONS', 'WYNIK_MECZU', TRUE, 'decimal',
    ARRAY['YES', 'NO'], 226),

   -- 227: HOME_WIN_AT_LEAST_ONE_HALF
   (227, 'HOME_WIN_AT_LEAST_ONE_HALF', 'Gospodarz wygra przynajmniej jedną połowę', 'Home Win Either Half',
    'Czy gospodarz wygra przynajmniej jedną połowę?', 'Will home team win at least one half?',
    'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL,
    ARRAY['YES', 'NO'], 227),

   -- 228: AWAY_WIN_AT_LEAST_ONE_HALF
   (228, 'AWAY_WIN_AT_LEAST_ONE_HALF', 'Gość wygra przynajmniej jedną połowę', 'Away Win Either Half',
    'Czy gość wygra przynajmniej jedną połowę?', 'Will away team win at least one half?',
    'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL,
    ARRAY['YES', 'NO'], 228),

   -- 229: HOME_WIN_BOTH_HALVES
   (229, 'HOME_WIN_BOTH_HALVES', 'Gospodarz wygra obie połowy', 'Home Win Both Halves',
    'Czy gospodarz wygra obie połowy?', 'Will home team win both halves?',
    'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL,
    ARRAY['YES', 'NO'], 229),

   -- 230: AWAY_WIN_BOTH_HALVES
   (230, 'AWAY_WIN_BOTH_HALVES', 'Gość wygra obie połowy', 'Away Win Both Halves',
    'Czy gość wygra obie połowy?', 'Will away team win both halves?',
    'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL,
    ARRAY['YES', 'NO'], 230),

   -- 231: HOME_WIN_TO_NIL
   (231, 'HOME_WIN_TO_NIL', 'Gospodarz wygra do zera', 'Home Win To Nil',
    'Czy gospodarz wygra do zera?', 'Will home team win to nil?',
    'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL,
    ARRAY['YES', 'NO'], 231),

   -- 232: AWAY_WIN_TO_NIL
   (232, 'AWAY_WIN_TO_NIL', 'Gość wygra do zera', 'Away Win To Nil',
    'Czy gość wygra do zera?', 'Will away team win to nil?',
    'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL,
    ARRAY['YES', 'NO'], 232),

   -- 233: HOME_EXACT_GOALS
   (233, 'HOME_EXACT_GOALS', 'Gospodarz - dokładna liczba goli', 'Home Exact Goals',
    'Dokładna liczba goli gospodarzy', 'Home team exact goals',
    'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['0', '1', '2', '3+'], 233),

   -- 234: AWAY_EXACT_GOALS
   (234, 'AWAY_EXACT_GOALS', 'Gość - dokładna liczba goli', 'Away Exact Goals',
    'Dokładna liczba goli gości', 'Away team exact goals',
    'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['0', '1', '2', '3+'], 234),

   -- 235: HOME_GOAL_RANGE
   (235, 'HOME_GOAL_RANGE', 'Gospodarz - przedział goli', 'Home Goal Range',
    'Przedział goli gospodarzy', 'Home team goal range',
    'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['0-1', '2-3', '4-5', '6+'], 235),

   -- 236: AWAY_GOAL_RANGE
   (236, 'AWAY_GOAL_RANGE', 'Gość - przedział goli', 'Away Goal Range',
    'Przedział goli gości', 'Away team goal range',
    'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['0-1', '2-3', '4-5', '6+'], 236),

   -- 237: HOME_CORNERS_RANGE
   (237, 'HOME_CORNERS_RANGE', 'Gospodarz - przedział rożnych', 'Home Corners Range',
    'Przedział rożnych gospodarzy', 'Home team corners range',
    'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
    ARRAY['0-2', '3-4', '5+'], 237),

   -- 238: AWAY_CORNERS_RANGE
   (238, 'AWAY_CORNERS_RANGE', 'Gość - przedział rożnych', 'Away Corners Range',
    'Przedział rożnych gości', 'Away team corners range',
    'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL,
    ARRAY['0-2', '3-4', '5+'], 238),

   -- 239: HOME_HALF_WITH_MOST_GOALS
   (239, 'HOME_HALF_WITH_MOST_GOALS', 'Gospodarz - połowa z większą liczbą goli', 'Home Half with Most Goals',
    'W której połowie gospodarz strzeli więcej?', 'In which half will home score more?',
    'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['1st', '2nd', 'Draw'], 239),

   -- 240: AWAY_HALF_WITH_MOST_GOALS
   (240, 'AWAY_HALF_WITH_MOST_GOALS', 'Gość - połowa z większą liczbą goli', 'Away Half with Most Goals',
    'W której połowie gość strzeli więcej?', 'In which half will away score more?',
    'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['1st', '2nd', 'Draw'], 240),

   -- 241: HOME_SCORE_BOTH_HALVES
   (241, 'HOME_SCORE_BOTH_HALVES', 'Gospodarz strzeli w obu połowach', 'Home Score Both Halves',
    'Czy gospodarz strzeli w obu połowach?', 'Will home score in both halves?',
    'BINARY_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['YES', 'NO'], 241),

   -- 242: AWAY_SCORE_BOTH_HALVES
   (242, 'AWAY_SCORE_BOTH_HALVES', 'Gość strzeli w obu połowach', 'Away Score Both Halves',
    'Czy gość strzeli w obu połowach?', 'Will away score in both halves?',
    'BINARY_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['YES', 'NO'], 242),

   -- 243: SECOND_HALF_HOME_EXACT_GOALS
   (243, 'SECOND_HALF_HOME_EXACT_GOALS', '2. połowa - gospodarz - dokładna liczba goli', '2nd Half Home Exact Goals',
    'Dokładna liczba goli gospodarzy w 2. połowie', 'Home exact goals in 2nd half',
    'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
    ARRAY['0', '1', '2+'], 243),

   -- 244: HOME_TEAM_TOTAL_GOALS
   (244, 'HOME_TEAM_TOTAL_GOALS', 'Gole gospodarzy', 'Home Team Goals',
    'Liczba goli gospodarzy', 'Home team goal count',
    'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal',
    ARRAY['OVER', 'UNDER'], 244),

   -- 245: AWAY_TEAM_TOTAL_GOALS
   (245, 'AWAY_TEAM_TOTAL_GOALS', 'Gole gości', 'Away Team Goals',
    'Liczba goli gości', 'Away team goal count',
    'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal',
    ARRAY['OVER', 'UNDER'], 245),

   -- 246: HALF_TIME_HOME_TEAM_TOTAL_GOALS
   (246, 'HALF_TIME_HOME_TEAM_TOTAL_GOALS', '1. połowa - gole gospodarzy', '1st Half Home Team Goals',
    'Liczba goli gospodarzy w 1. połowie', 'Home team goals in 1st half',
    'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal',
    ARRAY['OVER', 'UNDER'], 246),

   -- 247: HALF_TIME_AWAY_TEAM_TOTAL_GOALS
   (247, 'HALF_TIME_AWAY_TEAM_TOTAL_GOALS', '1. połowa - gole gości', '1st Half Away Team Goals',
    'Liczba goli gości w 1. połowie', 'Away team goals in 1st half',
    'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal',
    ARRAY['OVER', 'UNDER'], 247),

   -- 248: SECOND_HALF_HOME_TEAM_TOTAL_GOALS
   (248, 'SECOND_HALF_HOME_TEAM_TOTAL_GOALS', '2. połowa - gole gospodarzy', '2nd Half Home Team Goals',
    'Liczba goli gospodarzy w 2. połowie', 'Home team goals in 2nd half',
    'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal',
    ARRAY['OVER', 'UNDER'], 248),

   -- 249: SECOND_HALF_AWAY_TEAM_TOTAL_GOALS
   (249, 'SECOND_HALF_AWAY_TEAM_TOTAL_GOALS', '2. połowa - gole gości', '2nd Half Away Team Goals',
    'Liczba goli gości w 2. połowie', 'Away team goals in 2nd half',
    'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal',
    ARRAY['OVER', 'UNDER'], 249),

   -- 250: LAST_TEAM_TO_SCORE
   (250, 'LAST_TEAM_TO_SCORE', 'Ostatni gol', 'Last Team To Score',
    'Która drużyna strzeli ostatniego gola?', 'Which team will score the last goal?',
    'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL,
    ARRAY['HOME', 'AWAY', 'NONE', 'BOTH'], 250),

   -- 251: TEAMS_TO_SCORE
   (251, 'TEAMS_TO_SCORE', 'Która drużyna strzeli', 'Teams To Score',
    'Które drużyny strzelą gola?', 'Which teams will score?',
    'COMBINATION', 'GOLE', FALSE, NULL,
    ARRAY['HOME_ONLY', 'AWAY_ONLY', 'BOTH', 'NONE'], 251),

   -- UPDATE 12: GOAL_RANGE
   (12, 'GOAL_RANGE', 'Przedział goli', 'Goal Range',
    'W jakim przedziale będzie liczba goli?', 'Goal range bracket',
    'COMBINATION', 'GOLE', FALSE, NULL,
    ARRAY['0', '1', '2', '3', '4', '5', '6+', '7+', '0-1', '0-2', '1-2', '1-3', '1-4', '1-5', '1-6', '2-3', '2-4', '2-5', '2-6', '3-4', '3-5', '3-6', '4-5', '4-6', '5-6', '5+'], 19)

 ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  category = EXCLUDED.category,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  selections = EXCLUDED.selections,
  display_order = EXCLUDED.display_order;
