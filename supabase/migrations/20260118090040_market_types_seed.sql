INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order) VALUES
(1, 'MATCH_WINNER', 'Wynik meczu', 'Match Result', 'Obstawiasz kto wygra mecz (1X2)', 'Bet on match result (1X2)', 'TRIPLE_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 1),
(2, 'DOUBLE_CHANCE', 'Podwojna szansa', 'Double Chance', 'Obstawiasz dwa mozliwe wyniki (1X, X2, 12)', 'Bet on two possible outcomes', 'TRIPLE_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['HOME_OR_DRAW', 'DRAW_OR_AWAY', 'HOME_OR_AWAY'], 2),
(3, 'DRAW_NO_BET', 'Remis bez zakladu', 'Draw No Bet', 'Przy remisie zwrot stawki', 'Stake returned if draw', 'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['HOME', 'AWAY'], 3),
(4, 'TOTAL_GOALS', 'Liczba goli', 'Total Goals', 'Obstawiasz czy padnie wiecej/mniej goli niz linia', 'Bet on total goals over/under a line', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 10),
(5, 'BTTS', 'Obie strzela', 'Both Teams To Score', 'Czy obie druzyny strzela gola?', 'Will both teams score?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 11),
(6, 'ODD_EVEN_GOALS', 'Parzyste/Nieparzyste', 'Odd/Even Goals', 'Czy laczna liczba goli bedzie parzysta czy nieparzysta?', 'Will total goals be odd or even?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['ODD', 'EVEN'], 12),
(7, 'WIN_TO_NIL', 'Wygrana do zera', 'Win To Nil', 'Druzyna wygra nie tracac gola', 'Team wins without conceding', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['HOME', 'AWAY'], 13),
(8, 'CLEAN_SHEET', 'Czyste konto', 'Clean Sheet', 'Druzyna nie straci gola', 'Team keeps clean sheet', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['HOME', 'AWAY'], 14),
(9, 'HOME_TEAM_TO_SCORE', 'Gospodarz strzeli', 'Home Team To Score', 'Czy druzyna gospodarzy strzeli gola?', 'Will home team score?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 15),
(10, 'AWAY_TEAM_TO_SCORE', 'Gosc strzeli', 'Away Team To Score', 'Czy druzyna gosci strzeli gola?', 'Will away team score?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 16),
(11, 'TEAM_TOTAL_GOALS', 'Gole druzyny', 'Team Total Goals', 'Liczba goli konkretnej druzyny', 'Goals scored by specific team', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 17),
(12, 'GOAL_RANGE', 'Przedzial goli', 'Goal Range', 'W jakim przedziale bedzie liczba goli?', 'Goal range bracket', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0-1', '2-3', '4-5', '6+'], 18),
(13, 'BOTH_HALVES_GOALS', 'Gole w obu polowach', 'Goals In Both Halves', 'Czy padnie gol w obu polowach?', 'Will there be goals in both halves?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 19),
(14, 'WINNING_MARGIN', 'Margines zwyciestwa', 'Winning Margin', 'Roznica bramek zwyciezcy', 'Winner''s goal difference', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'integer', ARRAY['HOME', 'AWAY', 'DRAW'], 20),
(15, 'ASIAN_HANDICAP', 'Handicap azjatycki', 'Asian Handicap', 'Wynik z uwzglednieniem przewagi/straty bramkowej', 'Result with goal advantage/disadvantage', 'HANDICAP_SELECTOR', 'HANDICAP', TRUE, 'handicap', ARRAY['HOME', 'AWAY'], 30),
(16, 'EUROPEAN_HANDICAP', 'Handicap europejski', 'European Handicap', 'Handicap z mozliwoscia remisu', 'Handicap with draw option', 'HANDICAP_SELECTOR', 'HANDICAP', TRUE, 'handicap', ARRAY['HOME', 'DRAW', 'AWAY'], 31),
(17, 'HALF_TIME_RESULT', 'Wynik 1. polowy', 'Half Time Result', 'Wynik po pierwszej polowie', 'Result at half time', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 40),
(18, 'HALF_TIME_TOTAL_GOALS', 'Gole 1. polowy', 'Half Time Goals', 'Liczba goli w pierwszej polowie', 'Goals in first half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 41),
(19, 'HALF_TIME_BTTS', 'BTTS 1. polowa', 'Half Time BTTS', 'Obie strzela w pierwszej polowie', 'Both teams score in first half', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 42),
(20, 'SECOND_HALF_RESULT', 'Wynik 2. polowy', 'Second Half Result', 'Wynik drugiej polowy', 'Result of second half', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 43),
(21, 'SECOND_HALF_TOTAL_GOALS', 'Gole 2. polowy', 'Second Half Goals', 'Liczba goli w drugiej polowie', 'Goals in second half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 44),
(22, 'CORRECT_SCORE', 'Dokladny wynik', 'Correct Score', 'Przewidywany dokladny wynik meczu', 'Exact final score prediction', 'SCORE_GRID', 'DOKLADNY_WYNIK', FALSE, NULL, ARRAY['SCORE'], 50),
(23, 'GOALSCORER_FIRST', 'Pierwszy strzelec', 'First Goalscorer', 'Ktory zawodnik strzeli pierwszego gola?', 'Which player scores first?', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['PLAYER'], 60),
(24, 'GOALSCORER_LAST', 'Ostatni strzelec', 'Last Goalscorer', 'Ktory zawodnik strzeli ostatniego gola?', 'Which player scores last?', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['PLAYER'], 61),
(25, 'GOALSCORER_ANYTIME', 'Strzelec w meczu', 'Anytime Goalscorer', 'Zawodnik strzeli gola w meczu', 'Player scores anytime in match', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['PLAYER'], 62),
(26, 'PLAYER_SHOTS', 'Strzaly zawodnika', 'Player Shots', 'Liczba strzalow zawodnika', 'Player shot count', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['OVER', 'UNDER'], 63),
(27, 'PLAYER_CARDS', 'Kartki zawodnika', 'Player Cards', 'Zawodnik otrzyma kartke', 'Player receives card', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['YES', 'NO'], 64),
(28, 'PLAYER_ASSISTS', 'Asysty zawodnika', 'Player Assists', 'Zawodnik zaliczy asyste', 'Player provides assist', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['YES', 'NO'], 65),
(29, 'CORNERS_TOTAL', 'Rzuty rozne', 'Total Corners', 'Laczna liczba rzutow roznych', 'Total corners in match', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 70),
(30, 'CORNERS_TEAM', 'Rozne druzyny', 'Team Corners', 'Rzuty rozne konkretnej druzyny', 'Corners for specific team', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 71),
(31, 'CARDS_TOTAL', 'Kartki w meczu', 'Total Cards', 'Laczna liczba kartek', 'Total cards in match', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 72),
(32, 'CARDS_TEAM', 'Kartki druzyny', 'Team Cards', 'Kartki dla konkretnej druzyny', 'Cards for specific team', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 73),
(33, 'FOULS_TOTAL', 'Faule w meczu', 'Total Fouls', 'Laczna liczba fauli', 'Total fouls in match', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 74),
(34, 'OFFSIDES_TOTAL', 'Spalone w meczu', 'Total Offsides', 'Laczna liczba spalonych', 'Total offsides in match', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 75),
(35, 'RESULT_AND_BTTS', 'Wynik + BTTS', 'Result & BTTS', 'Wynik meczu i czy obie strzela', 'Match result and both teams score', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['HOME_YES', 'HOME_NO', 'DRAW_YES', 'DRAW_NO', 'AWAY_YES', 'AWAY_NO'], 80),
(36, 'RESULT_AND_TOTAL', 'Wynik + Gole', 'Result & Total', 'Wynik meczu i liczba goli', 'Match result and total goals', 'COMBINATION', 'KOMBINACJE', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'DRAW_OVER', 'DRAW_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 81),
(37, 'HALFTIME_FULLTIME', 'Przerwa/Koniec', 'HT/FT', 'Wynik w przerwie i na koniec meczu', 'Half time and full time result', 'HALFTIME_FULLTIME', 'KOMBINACJE', FALSE, NULL, ARRAY['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'], 82),
(38, 'DOUBLE_RESULT', 'Podwojny wynik', 'Double Result', 'Kto prowadzi w dwoch punktach czasowych', 'Who leads at two time points', 'HALFTIME_FULLTIME', 'KOMBINACJE', FALSE, NULL, ARRAY['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'], 83),
(39, 'DOUBLE_CHANCE_BTTS', 'Podwojna szansa + BTTS', 'Double Chance & BTTS', 'Podwojna szansa i obie strzela', 'Double chance and both teams score', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['1X_YES', '1X_NO', 'X2_YES', 'X2_NO', '12_YES', '12_NO'], 84),
(40, 'DOUBLE_CHANCE_TOTAL', 'Podwojna szansa + Gole', 'Double Chance & Total', 'Podwojna szansa i liczba goli', 'Double chance and total goals', 'COMBINATION', 'KOMBINACJE', TRUE, 'decimal', ARRAY['1X_OVER', '1X_UNDER', 'X2_OVER', 'X2_UNDER', '12_OVER', '12_UNDER'], 85);

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES (99, 'OTHER', 'Inne', 'Other', 'Rynki nieobslugiwane przez system normalizacji', 'Markets not supported by normalization system', 'TRIPLE_BUTTONS', 'INNE', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 999)
ON CONFLICT (id) DO NOTHING;

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(41, 'CORNERS_RACE', 'Wiecej rzutow roznych', 'Corners Race', 'Ktora druzyna wykona wiecej rzutow roznych?', 'Which team will have more corners?', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 76),
(42, 'FIRST_CORNER', 'Pierwszy rzut rozny', 'First Corner', 'Ktora druzyna wykona pierwszy rzut rozny?', 'Which team will take the first corner?', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['HOME', 'NONE', 'AWAY'], 77),
(43, 'CORNERS_HANDICAP', 'Rzuty rozne - handicap', 'Corners Handicap', 'Handicap na liczbe rzutow roznych', 'Handicap on total corners', 'HANDICAP_SELECTOR', 'STATYSTYKI', TRUE, 'handicap', ARRAY['HOME', 'AWAY'], 78),
(44, 'CARDS_RACE', 'Wiecej kartek', 'Cards Race', 'Ktora druzyna otrzyma wiecej kartek?', 'Which team will receive more cards?', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 79),
(45, 'FIRST_CARD', 'Pierwsza kartka', 'First Card', 'Ktora druzyna otrzyma pierwsza kartke?', 'Which team will receive the first card?', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['HOME', 'NONE', 'AWAY'], 80)
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

UPDATE market_types SET display_order = 85 WHERE code = 'RESULT_AND_BTTS';
UPDATE market_types SET display_order = 86 WHERE code = 'RESULT_AND_TOTAL';
UPDATE market_types SET display_order = 87 WHERE code = 'HALFTIME_FULLTIME';
UPDATE market_types SET display_order = 88 WHERE code = 'DOUBLE_RESULT';
UPDATE market_types SET display_order = 89 WHERE code = 'DOUBLE_CHANCE_BTTS';
UPDATE market_types SET display_order = 90 WHERE code = 'DOUBLE_CHANCE_TOTAL';

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(46, 'FIRST_TEAM_TO_SCORE', 'Ktora druzyna strzeli gola', 'First Team To Score', 'Ktora druzyna strzeli pierwszego/ostatniego gola?', 'Which team will score first/last?', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['HOME', 'AWAY', 'NONE', 'BOTH'], 21),
(47, 'FIRST_GOAL_TIME', 'Czas pierwszego gola', 'First Goal Time', 'W ktorym przedziale czasowym padnie pierwszy gol?', 'In which time period will the first goal be scored?', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', 'NONE'], 22),
(48, 'TIME_PERIOD_RESULT', 'Wynik w przedziale czasowym', 'Time Period Result', 'Jaki bedzie wynik w okreslonym przedziale czasowym?', 'What will be the result in a specific time period?', 'TRIPLE_BUTTONS', 'GOLE', TRUE, 'integer', ARRAY['HOME', 'DRAW', 'AWAY'], 23)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(49, 'FIRST_GOAL_AND_RESULT', 'Pierwszy gol i wynik', 'First Goal & Result', 'Ktora druzyna strzeli pierwszego gola i jaki bedzie wynik?', 'Which team scores first and what will be the result?', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['HOME_HOME', 'HOME_DRAW', 'HOME_AWAY', 'AWAY_HOME', 'AWAY_DRAW', 'AWAY_AWAY', 'NONE'], 86)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(50, 'PLAYER_GOAL_AND_RESULT', 'Gol zawodnika i wynik', 'Player Goal & Result', 'Zawodnik strzeli gola i jaki bedzie wynik meczu?', 'Player scores and what will be the match result?', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['PLAYER_HOME', 'PLAYER_DRAW', 'PLAYER_AWAY'], 66),
(51, 'PLAYER_SHOTS_ON_TARGET', 'Celne strzaly zawodnika', 'Player Shots On Target', 'Liczba celnych strzalow zawodnika', 'Player shots on target count', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['OVER', 'UNDER'], 67),
(52, 'PLAYER_PASSES', 'Podania zawodnika', 'Player Passes', 'Liczba podan zawodnika', 'Player pass count', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['OVER', 'UNDER'], 68)
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

UPDATE market_types SET display_order = 76 WHERE code = 'CORNERS_RACE';
UPDATE market_types SET display_order = 77 WHERE code = 'FIRST_CORNER';
UPDATE market_types SET display_order = 78 WHERE code = 'CORNERS_HANDICAP';
UPDATE market_types SET display_order = 79 WHERE code = 'CARDS_RACE';
UPDATE market_types SET display_order = 80 WHERE code = 'FIRST_CARD';
UPDATE market_types SET display_order = 85 WHERE code = 'RESULT_AND_BTTS';
UPDATE market_types SET display_order = 86 WHERE code = 'RESULT_AND_TOTAL';
UPDATE market_types SET display_order = 87 WHERE code = 'HALFTIME_FULLTIME';
UPDATE market_types SET display_order = 88 WHERE code = 'DOUBLE_RESULT';
UPDATE market_types SET display_order = 89 WHERE code = 'DOUBLE_CHANCE_BTTS';
UPDATE market_types SET display_order = 90 WHERE code = 'DOUBLE_CHANCE_TOTAL';
UPDATE market_types SET display_order = 91 WHERE code = 'FIRST_GOAL_AND_RESULT';

UPDATE market_types
SET selections = ARRAY['HOME', 'NONE', 'AWAY']
WHERE code = 'FIRST_CORNER' AND 'DRAW' = ANY(selections);

UPDATE market_types
SET selections = ARRAY['HOME', 'NONE', 'AWAY']
WHERE code = 'FIRST_CARD' AND 'DRAW' = ANY(selections);

UPDATE market_types
SET selections = ARRAY['HOME', 'AWAY', 'NONE', 'BOTH']
WHERE code = 'FIRST_TEAM_TO_SCORE';

UPDATE market_types
SET selections = ARRAY['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', 'NONE']
WHERE code = 'FIRST_GOAL_TIME';

UPDATE market_types
SET selections = ARRAY['HOME_HOME', 'HOME_DRAW', 'HOME_AWAY', 'AWAY_HOME', 'AWAY_DRAW', 'AWAY_AWAY', 'NONE']
WHERE code = 'FIRST_GOAL_AND_RESULT';

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (46, 'FIRST_TEAM_TO_SCORE', 'Ktora druzyna strzeli pierwszego gola', 'First Team To Score', 'Ktora druzyna strzeli pierwszego gola?', 'Which team will score first?', 'GOLE', ARRAY['HOME', 'AWAY', 'NONE', 'BOTH'], 'TRIPLE_BUTTONS', false, null, 21)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (47, 'FIRST_GOAL_TIME', 'Czas pierwszego gola', 'First Goal Time', 'W ktorym przedziale czasowym padnie pierwszy gol?', 'In which time period will the first goal be scored?', 'GOLE', ARRAY['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', 'NONE'], 'TRIPLE_BUTTONS', false, null, 22)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (48, 'TIME_PERIOD_RESULT', 'Wynik w przedziale czasowym', 'Time Period Result', 'Jaki bedzie wynik w okreslonym przedziale czasowym?', 'What will be the result in a specific time period?', 'GOLE', ARRAY['HOME', 'DRAW', 'AWAY'], 'TRIPLE_BUTTONS', true, 'integer', 23)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (49, 'FIRST_GOAL_AND_RESULT', 'Pierwszy gol i wynik', 'First Goal & Result', 'Ktora druzyna strzeli pierwszego gola i jaki bedzie wynik?', 'Which team scores first and what will be the result?', 'KOMBINACJE', ARRAY['HOME_HOME', 'HOME_DRAW', 'HOME_AWAY', 'AWAY_HOME', 'AWAY_DRAW', 'AWAY_AWAY', 'NONE'], 'COMBINATION', false, null, 86)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (50, 'PLAYER_GOAL_AND_RESULT', 'Gol zawodnika i wynik', 'Player Goal & Result', 'Zawodnik strzeli gola i jaki bedzie wynik meczu?', 'Player scores and what will be the match result?', 'ZAWODNICY', ARRAY['PLAYER_HOME', 'PLAYER_DRAW', 'PLAYER_AWAY'], 'PLAYER_DROPDOWN', true, 'player', 66)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (51, 'PLAYER_SHOTS_ON_TARGET', 'Celne strzaly zawodnika', 'Player Shots On Target', 'Liczba celnych strzalow zawodnika', 'Player shots on target count', 'ZAWODNICY', ARRAY['OVER', 'UNDER'], 'PLAYER_DROPDOWN', true, 'player', 67)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, category, selections, view_type, has_parameter, param_type, display_order)
VALUES (52, 'PLAYER_PASSES', 'Podania zawodnika', 'Player Passes', 'Liczba podan zawodnika', 'Player pass count', 'ZAWODNICY', ARRAY['OVER', 'UNDER'], 'PLAYER_DROPDOWN', true, 'player', 68)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  category = EXCLUDED.category,
  selections = EXCLUDED.selections,
  view_type = EXCLUDED.view_type,
  has_parameter = EXCLUDED.has_parameter,
  param_type = EXCLUDED.param_type,
  display_order = EXCLUDED.display_order;

INSERT INTO market_types (
  id,
  code,
  name_pl,
  name_en,
  description_pl,
  description_en,
  view_type,
  category,
  has_parameter,
  param_type,
  selections,
  display_order
) VALUES (
  53,
  'TOTAL_GOALS_ASIAN',
  'Liczba goli (z mozliwym zwrotem)',
  'Total Goals (Asian)',
  'Obstawiasz czy padnie wiecej/mniej goli niz linia (przy trafieniu linii zwrot stawki)',
  'Bet on total goals with push/refund on exact line hit',
  'PARAMETER_SLIDER',
  'GOLE',
  true,
  'integer',
  ARRAY['OVER', 'UNDER'],
  11
) ON CONFLICT (id) DO UPDATE SET
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

INSERT INTO market_types (
  code,
  name_pl,
  name_en,
  description_pl,
  description_en,
  view_type,
  category,
  has_parameter,
  param_type,
  selections,
  display_order
) VALUES (
  'TOTAL_GOALS_ASIAN',
  'Liczba goli (z mozliwym zwrotem)',
  'Total Goals (Asian)',
  'Obstawiasz czy padnie wiecej/mniej goli niz linia (przy trafieniu linii zwrot stawki)',
  'Bet on total goals with push/refund on exact line hit',
  'PARAMETER_SLIDER',
  'GOLE',
  true,
  'integer',
  ARRAY['OVER', 'UNDER'],
  11
) ON CONFLICT (code) DO UPDATE SET
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(72, 'HALF_TIME_CORNERS_TOTAL', 'Rzuty rozne 1. polowy', 'Half Time Corners', 'Laczna liczba rzutow roznych w pierwszej polowie', 'Total corners in first half', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 81),
(73, 'HALF_TIME_CORNERS_TEAM', 'Rozne druzyny 1. polowa', 'Half Time Team Corners', 'Rzuty rozne konkretnej druzyny w pierwszej polowie', 'Corners for specific team in first half', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 82),
(74, 'HALF_TIME_CORNERS_RACE', 'Wiecej roznych 1. polowa', 'Half Time Corners Race', 'Ktora druzyna wykona wiecej rzutow roznych w pierwszej polowie?', 'Which team will have more corners in first half?', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 83)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(22, 'SECOND_HALF_BTTS', 'BTTS 2. polowa', 'Second Half BTTS', 'Obie strzela w drugiej polowie', 'Both teams score in second half', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 45),
(23, 'SECOND_HALF_RESULT_AND_TOTAL', 'Wynik 2. polowy + Gole', 'Second Half Result & Total', 'Wynik drugiej polowy i liczba goli', 'Second half result and total goals', 'COMBINATION', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'DRAW_OVER', 'DRAW_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 46)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(54, 'TEAM_GOAL_RANGE', 'Gole druzyny - przedzial', 'Team Goal Range', 'Przedzial goli dla konkretnej druzyny', 'Goal range for specific team', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0', '1', '2', '3', '4', '5+'], 25),
(55, 'HALF_TIME_GOAL_RANGE', 'Gole 1. polowy - przedzial', 'Half Time Goal Range', 'Przedzial goli w pierwszej polowie', 'Goal range in first half', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['0', '1', '2', '3', '4+'], 47),
(56, 'SECOND_HALF_GOAL_RANGE', 'Gole 2. polowy - przedzial', 'Second Half Goal Range', 'Przedzial goli w drugiej polowie', 'Goal range in second half', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['0', '1', '2', '3', '4+'], 48)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(60, 'PLAYER_2_OR_MORE_GOALS', 'Strzelec 2+ goli', 'Player 2+ Goals', 'Zawodnik strzeli 2 lub wiecej goli', 'Player to score 2 or more goals', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['YES', 'NO'], 69),
(61, 'PLAYER_3_OR_MORE_GOALS', 'Strzelec 3+ goli', 'Player 3+ Goals', 'Zawodnik strzeli 3 lub wiecej goli', 'Player to score 3 or more goals', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['YES', 'NO'], 70),
(62, 'PLAYER_HAT_TRICK', 'Hat-trick', 'Hat-trick', 'Zawodnik strzeli 3 gole w jednym meczu', 'Player to score 3 goals in one match', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['YES', 'NO'], 71),
(63, 'TEAM_TOTAL_SCORERS', 'Liczba strzelcow', 'Total Scorers', 'Liczba roznych zawodnikow strzelajacych gole', 'Number of different players scoring goals', 'TRIPLE_BUTTONS', 'GOLE', TRUE, 'integer', ARRAY['OVER', 'UNDER'], 49)
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

UPDATE market_types SET display_order = 92 WHERE code = 'TEAM_TOTAL_SCORERS';
UPDATE market_types SET display_order = 93 WHERE code = 'PLAYER_GOAL_AND_RESULT';
UPDATE market_types SET display_order = 94 WHERE code = 'DOUBLE_CHANCE_BTTS';
UPDATE market_types SET display_order = 95 WHERE code = 'DOUBLE_CHANCE_TOTAL';
UPDATE market_types SET display_order = 96 WHERE code = 'HALFTIME_FULLTIME';
UPDATE market_types SET display_order = 97 WHERE code = 'DOUBLE_RESULT';
UPDATE market_types SET display_order = 98 WHERE code = 'FIRST_GOAL_AND_RESULT';

UPDATE market_types
SET view_type = 'PLAYER_STAT_LINES'
WHERE code IN (
  'PLAYER_SHOTS',
  'PLAYER_CARDS',
  'PLAYER_ASSISTS',
  'PLAYER_SHOTS_ON_TARGET',
  'PLAYER_PASSES'
);

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(100, 'CORRECT_SCORE', 'Dokladny wynik', 'Correct Score', 'Przewidywany dokladny wynik meczu', 'Exact final score prediction', 'SCORE_GRID', 'DOKLADNY_WYNIK', FALSE, NULL, ARRAY['SCORE'], 50),
(104, 'HALF_TIME_HOME_TO_SCORE', '1. polowa - gospodarz strzeli', 'Home Team To Score (1st Half)', 'Czy gospodarze strzela w 1. polowie?', 'Will home team score in first half?', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 48),
(105, 'HALF_TIME_AWAY_TO_SCORE', '1. polowa - gosc strzeli', 'Away Team To Score (1st Half)', 'Czy goscie strzela w 1. polowie?', 'Will away team score in first half?', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 49),
(106, 'SECOND_HALF_HOME_TO_SCORE', '2. polowa - gospodarz strzeli', 'Home Team To Score (2nd Half)', 'Czy gospodarze strzela w 2. polowie?', 'Will home team score in second half?', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 50),
(102, 'HT_FT_CORRECT_SCORE', '1. polowa / wynik koncowy - dokladny wynik', 'HT/FT Correct Score', 'Dokladny wynik do przerwy i na koniec meczu', 'Exact score at half time and full time', 'SCORE_GRID', 'DOKLADNY_WYNIK', FALSE, NULL, ARRAY['0:0 / 0:0', '0:0 / 1:0', '0:0 / 2:0', '0:0 / 3:0', '0:0 / 0:1', '0:0 / 1:1', '0:0 / 2:1', '0:0 / 0:2', '0:0 / 1:2', '0:0 / 2:2', '0:0 / 0:3', '0:0 / 1:3', '0:0 / 2:3', '1:0 / 1:0', '1:0 / 1:1', '1:0 / 1:2', '2:0 / 2:0', '2:0 / 2:1', '2:0 / 2:2'], 50),
(103, 'SECOND_HALF_FIRST_GOAL', 'Pierwszy gol 2. polowy', 'First Goal 2nd Half', 'Ktora druzyna strzeli pierwszego gola w 2. polowie?', 'Which team scores first in second half?', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME', 'AWAY', 'NONE'], 52),
(109, 'MULTI_RESULT', 'Multiwynik', 'Multi Result', 'Wynik meczu z dokladniejszym scenariuszem', 'Match result with extended score scenarios', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['1 o 1 gol', '2 o 1 gol', '1 o 2+ gole', '2 o 2+ gole', 'Remis 0:0', 'Remis 1:1', 'Remis 2:2', 'Remis 3+', 'Inne'], 99),
(111, 'TOTAL_GOALS_AND_BTTS', 'Gole + BTTS', 'Total Goals & BTTS', 'Liczba goli i czy obie strzela', 'Total goals and both teams score', 'COMBINATION', 'KOMBINACJE', TRUE, 'decimal', ARRAY['OVER_YES', 'UNDER_YES', 'OVER_NO', 'UNDER_NO'], 92),
(107, 'SECOND_HALF_ASIAN_HANDICAP', 'Handicap azjatycki 2. polowa', 'Second Half Asian Handicap', 'Azjatycki handicap w drugiej polowie', 'Asian handicap in second half', 'HANDICAP_SELECTOR', 'HANDICAP', TRUE, 'handicap', ARRAY['HOME', 'AWAY'], 16),
(108, 'HT_OR_FT_RESULT', '1. polowa lub wynik koncowy', 'Half Time or Full Time Result', 'Wybierasz wynik 1. polowy lub koncowy', 'Pick the half time or full time result', 'TRIPLE_BUTTONS', 'KOMBINACJE', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 98),
(110, 'HALFTIME_FULLTIME_AND_TOTAL', 'HT/FT + gole', 'HT/FT + Total', 'Wynik do przerwy i na koniec meczu oraz liczba goli', 'Half time/full time result with total goals', 'COMBINATION', 'KOMBINACJE', TRUE, NULL, ARRAY['HOME_OVER', 'HOME_UNDER', 'DRAW_OVER', 'DRAW_UNDER', 'AWAY_OVER', 'AWAY_UNDER']::text[], 97),
(101, 'GOALSCORER_FIRST', 'Pierwszy strzelec', 'First Goalscorer', 'Ktory zawodnik strzeli pierwszego gola?', 'Which player scores first?', 'PLAYER_DROPDOWN', 'ZAWODNICY', TRUE, 'player', ARRAY['PLAYER'], 60)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(113, 'HALF_TIME_CORRECT_SCORE', 'Dokladny wynik 1. polowy', 'Half Time Correct Score', 'Przewidywany dokladny wynik po pierwszej polowie', 'Exact score at half time', 'SCORE_GRID', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['SCORE'], 53)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(114, 'SECOND_HALF_EUROPEAN_HANDICAP', 'Handicap europejski 2. polowy', 'Second Half European Handicap', 'Handicap europejski w drugiej polowie', 'European handicap in second half', 'HANDICAP_SELECTOR', 'PIERWSZA_POLOWA', TRUE, 'handicap', ARRAY['HOME', 'DRAW', 'AWAY'], 54)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(115, 'SECOND_HALF_ODD_EVEN_GOALS', 'Parzyste/Nieparzyste 2. polowa', 'Second Half Odd/Even Goals', 'Parzyste/nieparzyste w drugiej polowie', 'Odd/Even goals in second half', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['ODD', 'EVEN'], 54)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(74, 'HALF_TIME_CORNERS_RACE', 'Wiecej roznych 1. polowa', 'Half Time Corners Race', 'Ktora druzyna wykona wiecej rzutow roznych w pierwszej polowie?', 'Which team will have more corners in first half?', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['HOME', 'DRAW', 'AWAY'], 83),
(103, 'HALF_TIME_RESULT_AND_BTTS', 'Wynik 1. polowy + BTTS', 'Half Time Result & BTTS', 'Wynik 1. polowy i czy obie strzela', 'Half time result and both teams score', 'COMBINATION', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME_YES', 'HOME_NO', 'DRAW_YES', 'DRAW_NO', 'AWAY_YES', 'AWAY_NO'], 47),
(104, 'HALF_TIME_HOME_TO_SCORE', '1. polowa - gospodarz strzeli', 'Home Team To Score (1st Half)', 'Czy gospodarze strzela w 1. polowie?', 'Will the home team score in the first half?', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 48),
(105, 'HALF_TIME_AWAY_TO_SCORE', '1. polowa - gosc strzeli', 'Away Team To Score (1st Half)', 'Czy goscie strzela w 1. polowie?', 'Will the away team score in the first half?', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 49),
(106, 'SECOND_HALF_HOME_TO_SCORE', '2. polowa - gospodarz strzeli', 'Home Team To Score (2nd Half)', 'Czy gospodarze strzela w 2. polowie?', 'Will the home team score in the second half?', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 50),
(107, 'SECOND_HALF_ASIAN_HANDICAP', 'Handicap azjatycki 2. polowa', 'Second Half Asian Handicap', 'Azjatycki handicap w drugiej polowie', 'Asian handicap in second half', 'HANDICAP_SELECTOR', 'HANDICAP', TRUE, 'handicap', ARRAY['HOME', 'AWAY'], 17),
(190, 'SECOND_HALF_FIRST_GOAL', 'Pierwszy gol 2. polowy', 'First Goal 2nd Half', 'Ktora druzyna strzeli pierwszego gola w 2. polowie?', 'Which team scores first in second half?', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME', 'AWAY', 'NONE'], 52),
(191, 'SECOND_HALF_AWAY_TO_SCORE', '2. polowa - gosc strzeli', 'Away Team To Score (2nd Half)', 'Czy goscie strzela w 2. polowie?', 'Will away team score in second half?', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['YES', 'NO'], 51),
(200, 'HALF_TIME_FIRST_GOAL', 'Pierwszy gol 1. polowy', 'First Goal 1st Half', 'Kto strzeli pierwszego gola w 1. polowie?', 'Who scores first in 1st half?', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME', 'AWAY', 'NONE'], 200),
(201, 'HALF_TIME_DOUBLE_CHANCE', 'Podwojna szansa 1. polowa', 'Double Chance 1st Half', 'Podwojna szansa w pierwszej polowie', 'Double chance in first half', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME_OR_DRAW', 'HOME_OR_AWAY', 'DRAW_OR_AWAY'], 201),
(202, 'HALF_TIME_DRAW_NO_BET', 'Remis = zwrot 1. polowa', 'Draw No Bet 1st Half', 'Zaklad bez remisu w pierwszej polowie', 'Draw no bet in first half', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['HOME', 'AWAY'], 202),
(203, 'HALF_TIME_RESULT_AND_TOTAL', 'Wynik 1. polowy + liczba goli', '1st Half Result + Total', 'Wynik 1. polowy i liczba goli', '1st Half result and total goals', 'COMBINATION', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'DRAW_OVER', 'DRAW_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 203),
(204, 'SECOND_HALF_CORRECT_SCORE', 'Dokladny wynik 2. polowy', 'Correct Score 2nd Half', 'Dokladny wynik drugiej polowy', 'Exact score of the second half', 'SCORE_GRID', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['SCORE'], 204),
(205, 'HALF_TIME_TEAM_TOTAL_GOALS', 'Gole druzyny w 1. polowie', 'Team Goals 1st Half', 'Liczba goli druzyny w pierwszej polowie', 'Team goals in first half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 205),
(206, 'SECOND_HALF_TEAM_TOTAL_GOALS', 'Gole druzyny w 2. polowie', 'Team Goals 2nd Half', 'Liczba goli druzyny w drugiej polowie', 'Team goals in second half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['HOME_OVER', 'HOME_UNDER', 'AWAY_OVER', 'AWAY_UNDER'], 206),
(207, 'HALF_TIME_EXACT_GOALS', 'Dokladna liczba goli 1. polowa', 'Exact Goals 1st Half', 'Dokladna liczba goli w pierwszej polowie', 'Exact number of goals in first half', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['0', '1', '2', '3+'], 207),
(208, 'SECOND_HALF_EXACT_GOALS', 'Dokladna liczba goli 2. polowa', 'Exact Goals 2nd Half', 'Dokladna liczba goli w drugiej polowie', 'Exact number of goals in second half', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['0', '1', '2+'], 208),
(209, 'FIRST_HALF_EUROPEAN_HANDICAP', 'Handicap europejski 1. polowa', 'European Handicap 1st Half', 'Handicap europejski w pierwszej polowie', 'European handicap in first half', 'HANDICAP_SELECTOR', 'PIERWSZA_POLOWA', TRUE, 'handicap', ARRAY['HOME', 'DRAW', 'AWAY'], 209),
(210, 'FIRST_HALF_ASIAN_HANDICAP', 'Handicap azjatycki 1. polowa', 'Asian Handicap 1st Half', 'Handicap azjatycki w pierwszej polowie', 'Asian handicap in first half', 'HANDICAP_SELECTOR', 'PIERWSZA_POLOWA', TRUE, 'handicap', ARRAY['HOME', 'AWAY'], 210),
(211, 'TEAM_WIN_AT_LEAST_ONE_HALF', 'Wygra przynajmniej jedna polowe', 'To Win Either Half', 'Czy druzyna wygra przynajmniej jedna polowe?', 'Will team win at least one half?', 'BINARY_BUTTONS', 'WYNIK_MECZU', TRUE, 'decimal', ARRAY['YES', 'NO'], 211),
(212, 'HALF_WITH_MORE_GOALS', 'Polowa z wieksza liczba goli', 'Half with Most Goals', 'W ktorej polowie padnie wiecej goli?', 'In which half will more goals be scored?', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['1st', '2nd', 'Draw'], 212),
(213, 'TEAM_HALF_WITH_MORE_GOALS', 'Polowa z wieksza liczba goli druzyny', 'Team Half with Most Goals', 'W ktorej polowie druzyna strzeli wiecej goli?', 'In which half will team score more goals?', 'COMBINATION', 'GOLE', TRUE, 'decimal', ARRAY['HOME_1ST', 'HOME_2ND', 'HOME_EQUAL', 'AWAY_1ST', 'AWAY_2ND', 'AWAY_EQUAL'], 213),
(214, 'BTTS_BY_HALF', 'BTTS w polowach', 'BTTS in Halves', 'W ktorej polowie obie druzyny strzela?', 'In which half will both teams score?', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['1st', '2nd', 'Both', 'None'], 214),
(215, 'TEAM_SCORES_BOTH_HALVES', 'Strzeli w obu polowach', 'Score in Both Halves', 'Czy druzyna strzeli w obu polowach?', 'Will team score in both halves?', 'BINARY_BUTTONS', 'GOLE', TRUE, 'decimal', ARRAY['YES', 'NO'], 215),
(216, 'BOTH_HALVES_TOTAL_GOALS', 'Liczba goli w obu polowach', 'Goals in Both Halves', 'Czy w obu polowach padnie powyzej/ponizej X goli?', 'Over/Under goals in both halves', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 216),
(217, 'CORNERS_TEAM_RANGE', 'Rzuty rozne druzyny (przedzial)', 'Team Corners Range', 'Przedzial rzutow roznych druzyny', 'Range of team corners', 'TRIPLE_BUTTONS', 'STATYSTYKI', TRUE, 'decimal', ARRAY['HOME_0-2', 'HOME_3-4', 'HOME_5+', 'AWAY_0-2', 'AWAY_3-4', 'AWAY_5+'], 217),
(218, 'HALF_TIME_CORNERS_HANDICAP', 'Handicap roznych 1. polowa', 'Corners Handicap 1st Half', 'Handicap rzutow roznych w pierwszej polowie', 'Corners handicap in first half', 'HANDICAP_SELECTOR', 'STATYSTYKI', TRUE, 'handicap', ARRAY['HOME', 'AWAY'], 218),
(219, 'EXACT_GOALS', 'Dokladna liczba goli', 'Exact Goals', 'Dokladna liczba goli w meczu', 'Exact number of goals in match', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0', '1', '2', '3', '4', '5', '6+'], 219),
(220, 'CORNERS_RANGE', 'Przedzial rzutow roznych', 'Corners Range', 'Przedzial liczby rzutow roznych w meczu', 'Range of total corners', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['0-8', '9-11', '12+'], 220),
(221, 'HALF_TIME_CORNERS_RANGE', 'Przedzial roznych 1. polowa', 'Corners Range 1st Half', 'Przedzial roznych w 1. polowie', 'Corners range in 1st half', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['0-4', '5-6', '7+'], 221),
(222, 'HALF_TIME_CORNERS_TEAM_RANGE', 'Przedzial roznych druzyny 1. pol.', 'Team Corners Range 1st Half', 'Przedzial roznych druzyny w 1. polowie', 'Team corners range in 1st half', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['HOME_0-1', 'HOME_2-3', 'HOME_4+', 'AWAY_0-1', 'AWAY_2-3', 'AWAY_4+'], 222),
(223, 'HALF_TIME_DOUBLE_CHANCE_BTTS', 'Podwojna szansa 1. pol. + BTTS 1. pol.', 'DC 1st Half + BTTS 1st Half', 'Podwojna szansa i BTTS w 1. polowie', 'Double chance and BTTS in 1st half', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['1X_YES', '1X_NO', 'X2_YES', 'X2_NO', '12_YES', '12_NO'], 223),
(224, 'SECOND_HALF_DOUBLE_CHANCE_BTTS', 'Podwojna szansa 2. pol. + BTTS 2. pol.', 'DC 2nd Half + BTTS 2nd Half', 'Podwojna szansa i BTTS w 2. polowie', 'Double chance and BTTS in 2nd half', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['1X_YES', '1X_NO', 'X2_YES', 'X2_NO', '12_YES', '12_NO'], 224),
(225, 'SECOND_HALF_RESULT_AND_BTTS', 'Wynik 2. pol. + BTTS 2. pol.', 'Result 2nd Half + BTTS 2nd Half', 'Wynik i BTTS w 2. polowie', 'Result and BTTS in 2nd half', 'COMBINATION', 'KOMBINACJE', FALSE, NULL, ARRAY['HOME_YES', 'HOME_NO', 'DRAW_YES', 'DRAW_NO', 'AWAY_YES', 'AWAY_NO'], 225),
(226, 'TEAM_WIN_BOTH_HALVES', 'Wygra obie polowy', 'To Win Both Halves', 'Czy druzyna wygra obie polowy meczu?', 'Will team win both halves?', 'BINARY_BUTTONS', 'WYNIK_MECZU', TRUE, 'decimal', ARRAY['YES', 'NO'], 226),
(227, 'HOME_WIN_AT_LEAST_ONE_HALF', 'Gospodarz wygra przynajmniej jedna polowe', 'Home Win Either Half', 'Czy gospodarz wygra przynajmniej jedna polowe?', 'Will home team win at least one half?', 'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['YES', 'NO'], 227),
(228, 'AWAY_WIN_AT_LEAST_ONE_HALF', 'Gosc wygra przynajmniej jedna polowe', 'Away Win Either Half', 'Czy gosc wygra przynajmniej jedna polowe?', 'Will away team win at least one half?', 'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['YES', 'NO'], 228),
(229, 'HOME_WIN_BOTH_HALVES', 'Gospodarz wygra obie polowy', 'Home Win Both Halves', 'Czy gospodarz wygra obie polowy?', 'Will home team win both halves?', 'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['YES', 'NO'], 229),
(230, 'AWAY_WIN_BOTH_HALVES', 'Gosc wygra obie polowy', 'Away Win Both Halves', 'Czy gosc wygra obie polowy?', 'Will away team win both halves?', 'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['YES', 'NO'], 230),
(231, 'HOME_WIN_TO_NIL', 'Gospodarz wygra do zera', 'Home Win To Nil', 'Czy gospodarz wygra do zera?', 'Will home team win to nil?', 'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['YES', 'NO'], 231),
(232, 'AWAY_WIN_TO_NIL', 'Gosc wygra do zera', 'Away Win To Nil', 'Czy gosc wygra do zera?', 'Will away team win to nil?', 'BINARY_BUTTONS', 'WYNIK_MECZU', FALSE, NULL, ARRAY['YES', 'NO'], 232),
(233, 'HOME_EXACT_GOALS', 'Gospodarz - dokladna liczba goli', 'Home Exact Goals', 'Dokladna liczba goli gospodarzy', 'Home team exact goals', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0', '1', '2', '3+'], 233),
(234, 'AWAY_EXACT_GOALS', 'Gosc - dokladna liczba goli', 'Away Exact Goals', 'Dokladna liczba goli gosci', 'Away team exact goals', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0', '1', '2', '3+'], 234),
(235, 'HOME_GOAL_RANGE', 'Gospodarz - przedzial goli', 'Home Goal Range', 'Przedzial goli gospodarzy', 'Home team goal range', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0-1', '2-3', '4-5', '6+'], 235),
(236, 'AWAY_GOAL_RANGE', 'Gosc - przedzial goli', 'Away Goal Range', 'Przedzial goli gosci', 'Away team goal range', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['0-1', '2-3', '4-5', '6+'], 236),
(237, 'HOME_CORNERS_RANGE', 'Gospodarz - przedzial roznych', 'Home Corners Range', 'Przedzial roznych gospodarzy', 'Home team corners range', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['0-2', '3-4', '5+'], 237),
(238, 'AWAY_CORNERS_RANGE', 'Gosc - przedzial roznych', 'Away Corners Range', 'Przedzial roznych gosci', 'Away team corners range', 'TRIPLE_BUTTONS', 'STATYSTYKI', FALSE, NULL, ARRAY['0-2', '3-4', '5+'], 238),
(239, 'HOME_HALF_WITH_MOST_GOALS', 'Gospodarz - polowa z wieksza liczba goli', 'Home Half with Most Goals', 'W ktorej polowie gospodarz strzeli wiecej?', 'In which half will home score more?', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['1st', '2nd', 'Draw'], 239),
(240, 'AWAY_HALF_WITH_MOST_GOALS', 'Gosc - polowa z wieksza liczba goli', 'Away Half with Most Goals', 'W ktorej polowie gosc strzeli wiecej?', 'In which half will away score more?', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['1st', '2nd', 'Draw'], 240),
(241, 'HOME_SCORE_BOTH_HALVES', 'Gospodarz strzeli w obu polowach', 'Home Score Both Halves', 'Czy gospodarz strzeli w obu polowach?', 'Will home score in both halves?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 241),
(242, 'AWAY_SCORE_BOTH_HALVES', 'Gosc strzeli w obu polowach', 'Away Score Both Halves', 'Czy gosc strzeli w obu polowach?', 'Will away score in both halves?', 'BINARY_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['YES', 'NO'], 242),
(243, 'SECOND_HALF_HOME_EXACT_GOALS', '2. polowa - gospodarz - dokladna liczba goli', '2nd Half Home Exact Goals', 'Dokladna liczba goli gospodarzy w 2. polowie', 'Home exact goals in 2nd half', 'TRIPLE_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['0', '1', '2+'], 243),
(244, 'HOME_TEAM_TOTAL_GOALS', 'Gole gospodarzy', 'Home Team Goals', 'Liczba goli gospodarzy', 'Home team goal count', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 244),
(245, 'AWAY_TEAM_TOTAL_GOALS', 'Gole gosci', 'Away Team Goals', 'Liczba goli gosci', 'Away team goal count', 'PARAMETER_SLIDER', 'GOLE', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 245),
(246, 'HALF_TIME_HOME_TEAM_TOTAL_GOALS', '1. polowa - gole gospodarzy', '1st Half Home Team Goals', 'Liczba goli gospodarzy w 1. polowie', 'Home team goals in 1st half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 246),
(247, 'HALF_TIME_AWAY_TEAM_TOTAL_GOALS', '1. polowa - gole gosci', '1st Half Away Team Goals', 'Liczba goli gosci w 1. polowie', 'Away team goals in 1st half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 247),
(248, 'SECOND_HALF_HOME_TEAM_TOTAL_GOALS', '2. polowa - gole gospodarzy', '2nd Half Home Team Goals', 'Liczba goli gospodarzy w 2. polowie', 'Home team goals in 2nd half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 248),
(249, 'SECOND_HALF_AWAY_TEAM_TOTAL_GOALS', '2. polowa - gole gosci', '2nd Half Away Team Goals', 'Liczba goli gosci w 2. polowie', 'Away team goals in 2nd half', 'PARAMETER_SLIDER', 'PIERWSZA_POLOWA', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 249),
(250, 'LAST_TEAM_TO_SCORE', 'Ostatni gol', 'Last Team To Score', 'Ktora druzyna strzeli ostatniego gola?', 'Which team will score the last goal?', 'TRIPLE_BUTTONS', 'GOLE', FALSE, NULL, ARRAY['HOME', 'AWAY', 'NONE', 'BOTH'], 250),
(251, 'TEAMS_TO_SCORE', 'Ktora druzyna strzeli', 'Teams To Score', 'Ktore druzyny strzela gola?', 'Which teams will score?', 'COMBINATION', 'GOLE', FALSE, NULL, ARRAY['HOME_ONLY', 'AWAY_ONLY', 'BOTH', 'NONE'], 251),
(12, 'GOAL_RANGE', 'Przedzial goli', 'Goal Range', 'W jakim przedziale bedzie liczba goli?', 'Goal range bracket', 'COMBINATION', 'GOLE', FALSE, NULL, ARRAY['0', '1', '2', '3', '4', '5', '6+', '7+', '0-1', '0-2', '1-2', '1-3', '1-4', '1-5', '1-6', '2-3', '2-4', '2-5', '2-6', '3-4', '3-5', '3-6', '4-5', '4-6', '5-6', '5+'], 19)
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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(252, 'BOTH_HALVES_UNDER_GOALS', 'Obie polowy ponizej X goli', 'Both Halves Under X Goals', 'Czy obie polowy beda mialy ponizej X goli?', 'Will both halves have under X goals?', 'BINARY_BUTTONS', 'GOLE', TRUE, 'decimal', ARRAY['YES', 'NO'], 252)
ON CONFLICT (id) DO NOTHING;

UPDATE market_types
SET view_type = 'COMBINATION'
WHERE code = 'EXACT_GOALS';

UPDATE market_types
SET
  view_type = 'COMBINATION',
  selections = ARRAY['0', '1', '2', '3', '4', '5', '6+']
WHERE code = 'HOME_EXACT_GOALS';

UPDATE market_types
SET
  view_type = 'COMBINATION',
  selections = ARRAY['0', '1', '2', '3', '4', '5', '6+']
WHERE code = 'AWAY_EXACT_GOALS';

UPDATE market_types
SET view_type = 'COMBINATION'
WHERE code = 'FIRST_GOAL_TIME';

INSERT INTO market_types (
  id,
  code,
  name_pl,
  name_en,
  description_pl,
  description_en,
  view_type,
  category,
  has_parameter,
  param_type,
  selections,
  display_order
) VALUES (
  116,
  'HOME_TEAM_ODD_EVEN_GOALS',
  'Gospodarz - parzyste/nieparzyste',
  'Home Team Odd/Even Goals',
  'Czy liczba goli gospodarzy bedzie parzysta czy nieparzysta?',
  'Will home team goals be odd or even?',
  'BINARY_BUTTONS',
  'GOLE',
  FALSE,
  NULL,
  ARRAY['ODD', 'EVEN'],
  14
) ON CONFLICT (id) DO NOTHING;

INSERT INTO market_types (
  id,
  code,
  name_pl,
  name_en,
  description_pl,
  description_en,
  view_type,
  category,
  has_parameter,
  param_type,
  selections,
  display_order
) VALUES (
  117,
  'AWAY_TEAM_ODD_EVEN_GOALS',
  'Gosc - parzyste/nieparzyste',
  'Away Team Odd/Even Goals',
  'Czy liczba goli gosci bedzie parzysta czy nieparzysta?',
  'Will away team goals be odd or even?',
  'BINARY_BUTTONS',
  'GOLE',
  FALSE,
  NULL,
  ARRAY['ODD', 'EVEN'],
  15
) ON CONFLICT (id) DO NOTHING;

UPDATE market_types
SET selections = ARRAY['0-3', '4-6', '7+', '0-8', '9-11', '12+']
WHERE code = 'CORNERS_RANGE';

UPDATE market_types
SET 
    selections = ARRAY['0', '1', '2', '3+', '0-2', '3-4', '5+'],
    view_type = 'COMBINATION'
WHERE code = 'HOME_CORNERS_RANGE';

UPDATE market_types
SET 
    selections = ARRAY['0', '1', '2', '3+', '0-2', '3-4', '5+'],
    view_type = 'COMBINATION'
WHERE code = 'AWAY_CORNERS_RANGE';

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES (
  254,
  'HALF_TIME_HOME_EXACT_CORNERS',
  '1. polowa - gospodarz - dokladna liczba roznych',
  '1st Half Home Exact Corners',
  'Dokladna liczba roznych gospodarzy w 1. polowie',
  'Exact corners for home team in 1st half',
  'COMBINATION',
  'STATYSTYKI',
  FALSE,
  NULL,
  ARRAY['0', '1', '2', '3+'],
  254
)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  selections = EXCLUDED.selections;

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES (
  255,
  'HALF_TIME_AWAY_EXACT_CORNERS',
  '1. polowa - gosc - dokladna liczba roznych',
  '1st Half Away Exact Corners',
  'Dokladna liczba roznych gosci w 1. polowie',
  'Exact corners for away team in 1st half',
  'COMBINATION',
  'STATYSTYKI',
  FALSE,
  NULL,
  ARRAY['0', '1', '2', '3+'],
  255
)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name_pl = EXCLUDED.name_pl,
  name_en = EXCLUDED.name_en,
  description_pl = EXCLUDED.description_pl,
  description_en = EXCLUDED.description_en,
  view_type = EXCLUDED.view_type,
  selections = EXCLUDED.selections;

UPDATE market_types
SET selections = ARRAY['0-2', '3-4', '5+', '0-4', '5-6', '7+']
WHERE code = 'HALF_TIME_CORNERS_RANGE';

UPDATE market_types
SET
  view_type = 'PLAYER_STAT_LINES',
  selections = ARRAY['HOME', 'DRAW', 'AWAY']
WHERE code = 'PLAYER_GOAL_AND_RESULT';

UPDATE market_types
SET 
  selections = ARRAY['OVER', 'UNDER', '1+', '2+', '3+', '4+', '5+'],
  view_type = 'PLAYER_STAT_LINES'
WHERE code = 'PLAYER_SHOTS_ON_TARGET';

INSERT INTO market_types (
  id,
  code,
  name_pl,
  name_en,
  description_pl,
  description_en,
  view_type,
  category,
  has_parameter,
  param_type,
  selections,
  display_order
) VALUES (
  143,
  'PLAYER_RED_CARD',
  'Zawodnik otrzyma czerwona kartke',
  'Player Red Card',
  'Czy zawodnik otrzyma czerwona kartke?',
  'Will the player receive a red card?',
  'PLAYER_STAT_LINES',
  'ZAWODNICY',
  TRUE,
  'player',
  ARRAY['YES'],
  76
)
ON CONFLICT (id) DO NOTHING;

DELETE FROM market_types WHERE id = 115 AND code = 'SECOND_HALF_ODD_EVEN_GOALS';
DELETE FROM market_types WHERE code = 'SECOND_HALF_ODD_EVEN_GOALS';

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(253, 'BOTH_HALVES_OVER_GOALS', 'Obie polowy powyzej X goli', 'Both Halves Over X Goals', 'Czy obie polowy beda mialy powyzej X goli?', 'Will both halves have over X goals?', 'BINARY_BUTTONS', 'GOLE', TRUE, 'decimal', ARRAY['YES', 'NO'], 253),
(130, 'PLAYER_GOALS', 'Gole zawodnika', 'Player Goals', 'Liczba goli zawodnika', 'Player goal count', 'PLAYER_STAT_LINES', 'ZAWODNICY', TRUE, 'player', ARRAY['1+', '2+', '3+', '4+'], 66),
(120, 'SECOND_HALF_ODD_EVEN_GOALS', '2. polowa - parzyste/nieparzyste', '2nd Half Odd/Even Goals', 'Czy liczba goli w 2. polowie bedzie parzysta czy nieparzysta?', 'Will total goals in second half be odd or even?', 'BINARY_BUTTONS', 'PIERWSZA_POLOWA', FALSE, NULL, ARRAY['ODD', 'EVEN'], 46)

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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(268, 'CARDS_EXACT_RANGE', 'Dokladna liczba kartek', 'Exact Card Count Range', 'Przedzial liczby kartek w meczu', 'Exact range of cards in match', 'COMBINATION', 'STATYSTYKI', FALSE, NULL, ARRAY['0-1', '2-3', '4-5', '6-7', '8+', '0-2', '3-4', '5-6', '7+', '9+'], 90)

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

INSERT INTO market_types (id, code, name_pl, name_en, description_pl, description_en, view_type, category, has_parameter, param_type, selections, display_order)
VALUES
(269, 'HALF_TIME_CARDS_TOTAL', 'Kartki 1. polowy', 'Half Time Total Cards', 'Laczna liczba kartek w pierwszej polowie', 'Total cards in first half', 'STAT_RANGE', 'STATYSTYKI', TRUE, 'decimal', ARRAY['OVER', 'UNDER'], 84)

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

COMMENT ON TABLE market_types IS 'Canonical market definitions with 64 standard types (IDs 1-64) plus OTHER (ID 99) as fallback. Categories: WYNIK_MECZU (1-3), GOLE (4-14, 46-49, 54-56, 63), HANDICAP (15-16), PIERWSZA_POLOWA (17-23, 40-48), DOKLADNY_WYNIK (22), ZAWODNICY (23-28, 50-52, 60-62, 66), STATYSTYKI (29-34, 72-74), KOMBINACJE (35-40, 49, 94-97). Last updated: Migration 007 - Added 12 new STS market types for full coverage (125/125 mapped).';
