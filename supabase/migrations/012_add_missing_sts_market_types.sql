INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
  -- CORRECT_SCORE (ID 100)
  (100, 'CORRECT_SCORE', 'Dokładny wynik', 'Correct Score',
   'Przewidywany dokładny wynik meczu', 'Exact final score prediction',
   'SCORE_GRID', 'DOKLADNY_WYNIK', FALSE, NULL,
   ARRAY['SCORE'], 50),

  -- HALF_TIME_HOME_TO_SCORE (ID 104)
  (104, 'HALF_TIME_HOME_TO_SCORE', '1. połowa - gospodarz strzeli', 'Home Team To Score (1st Half)',
   'Czy gospodarze strzelą w 1. połowie?', 'Will home team score in first half?',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['YES', 'NO'], 48),

  -- HALF_TIME_AWAY_TO_SCORE (ID 105)
  (105, 'HALF_TIME_AWAY_TO_SCORE', '1. połowa - gość strzeli', 'Away Team To Score (1st Half)',
   'Czy goście strzelą w 1. połowie?', 'Will away team score in first half?',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['YES', 'NO'], 49),

  -- SECOND_HALF_HOME_TO_SCORE (ID 106)
  (106, 'SECOND_HALF_HOME_TO_SCORE', '2. połowa - gospodarz strzeli', 'Home Team To Score (2nd Half)',
   'Czy gospodarze strzelą w 2. połowie?', 'Will home team score in second half?',
   'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['YES', 'NO'], 50),

  -- HT_FT_CORRECT_SCORE (ID 102)
  (102, 'HT_FT_CORRECT_SCORE', '1. połowa / wynik końcowy - dokładny wynik', 'HT/FT Correct Score',
   'Dokładny wynik do przerwy i na koniec meczu', 'Exact score at half time and full time',
   'SCORE_GRID', 'DOKLADNY_WYNIK', FALSE, NULL,
   ARRAY['0:0 / 0:0', '0:0 / 1:0', '0:0 / 2:0', '0:0 / 3:0',
        '0:0 / 0:1', '0:0 / 1:1', '0:0 / 2:1',
        '0:0 / 0:2', '0:0 / 1:2', '0:0 / 2:2',
        '0:0 / 0:3', '0:0 / 1:3', '0:0 / 2:3',
        '1:0 / 1:0', '1:0 / 1:1', '1:0 / 1:2',
        '2:0 / 2:0', '2:0 / 2:1', '2:0 / 2:2'], 50),

  -- SECOND_HALF_FIRST_GOAL (ID 103)
  (103, 'SECOND_HALF_FIRST_GOAL', 'Pierwszy gol 2. połowy', 'First Goal 2nd Half',
   'Która drużyna strzeli pierwszego gola w 2. połowie?', 'Which team scores first in second half?',
   'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL,
   ARRAY['HOME', 'AWAY', 'NONE'], 52),

  -- MULTI_RESULT (ID 109)
  (109, 'MULTI_RESULT', 'Multiwynik', 'Multi Result',
   'Wynik meczu z dokładniejszym scenariuszem', 'Match result with extended score scenarios',
   'COMBINATION', 'KOMBINACJE', FALSE, NULL,
   ARRAY['1 o 1 gol', '2 o 1 gol', '1 o 2+ gole', '2 o 2+ gole',
       'Remis 0:0', 'Remis 1:1', 'Remis 2:2', 'Remis 3+', 'Inne'], 99),

  -- TOTAL_GOALS_AND_BTTS (ID 111)
  (111, 'TOTAL_GOALS_AND_BTTS', 'Gole + BTTS', 'Total Goals & BTTS',
   'Liczba goli i czy obie strzelą', 'Total goals and both teams score',
   'COMBINATION', 'KOMBINACJE', TRUE, 'decimal',
   ARRAY['OVER_YES', 'UNDER_YES', 'OVER_NO', 'UNDER_NO'], 92),

  -- SECOND_HALF_ASIAN_HANDICAP (ID 107)
  (107, 'SECOND_HALF_ASIAN_HANDICAP', 'Handicap azjatycki 2. połowa', 'Second Half Asian Handicap',
   'Azjatycki handicap w drugiej połowie', 'Asian handicap in second half',
   'HANDICAP_SELECTOR', 'HANDICAP', TRUE, 'handicap',
   ARRAY['HOME', 'AWAY'], 16),

  -- HT_OR_FT_RESULT (ID 108)
  (108, 'HT_OR_FT_RESULT', '1. połowa lub wynik końcowy', 'Half Time or Full Time Result',
   'Wybierasz wynik 1. połowy lub końcowy', 'Pick the half time or full time result',
   'TRIPLE_BUTTONS', 'KOMBINACJE', FALSE, NULL,
   ARRAY['HOME', 'DRAW', 'AWAY'], 98),

  -- HALFTIME_FULLTIME_AND_TOTAL (ID 110)
  (110, 'HALFTIME_FULLTIME_AND_TOTAL', 'HT/FT + gole', 'HT/FT + Total',
    'Wynik do przerwy i na koniec meczu oraz liczba goli', 'Half time/full time result with total goals',
    'COMBINATION', 'KOMBINACJE', TRUE, NULL,
    ARRAY['HOME_OVER', 'HOME_UNDER', 'DRAW_OVER', 'DRAW_UNDER', 'AWAY_OVER', 'AWAY_UNDER']::text[], 97),

  -- GOALSCORER_FIRST (ID 101)
  (101, 'GOALSCORER_FIRST', 'Pierwszy strzelec', 'First Goalscorer',
    'Który zawodnik strzeli pierwszego gola?', 'Which player scores first?',
    'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player',
    ARRAY['PLAYER'], 60)
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
