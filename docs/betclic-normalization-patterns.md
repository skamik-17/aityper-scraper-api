# Betclic Normalization Patterns

## Stałe Identyfikatory (Spójne między meczami)

### Tab IDs (Category Filters)
```
ca_ftb_top      = TOP (no filter needed)
ca_ftb_rslt     = WYNIK (Results)
ca_ftb_gsc      = STRZELCY (Goalscorers)
ca_ftb_goa      = GOLE (Goals)
ca_ftb_goalm    = METODA_GOLA (Goal Method)
ca_ftb_cshcp    = HANDICAP
ca_ftb_prp      = STATYSTYKI (Statistics)
```

### Group IDs (Subcategories)
```
WYNIK:
  subca_ftb_brs   = Wynik - popularne
  subca_ftb_dbcc  = Podwójna szansa
  subca_ftb_voi   = Zwrot, jesli...
  subca_ftb_byh   = Przez drużynę w połowie
  subca_ftb_rsh   = Wynik & połowy
  subca_ftb_rsg   = Wynik & gole

STRZELCY:
  subca_ftb_mgs   = Wielu strzelców
  subca_ftb_dat   = Dwóch i trzech zawodników
  subca_ftb_gsas  = Strzelcy i asysty
  subca_ftb_sts   = Pierwszy skład i rezerwowi

GOLE:
  subca_ftb_bgo   = Gole - popularne
  subca_ftb_bot   = Obie drużyny
  subca_ftb_gbt   = Gole drużyny
  subca_ftb_gbh   = Gole w połowie
  subca_ftb_gbp   = Gole w przedziale czasu
  subca_ftb_oev   = nieparzyste / parzyste

METODA_GOLA:
  subca_ftb_pen   = Rzut karny
  subca_ftb_hea   = Główka
  subca_ftb_frk   = Rzuty wolne

HANDICAP:
  subca_ftb_hcp   = Handicap
  subca_ftb_cos   = Dokładny wynik

STATYSTYKI:
  subca_ftb_crnr  = Rzuty rożne
  subca_ftb_sho   = Strzały
  subca_ftb_sht   = Strzały celne
  subca_ftb_crd   = Kartki
  subca_ftb_fos   = Faule
  subca_ftb_ofs   = Spalone
  subca_ftb_bpo   = Posiadanie piłki
  subca_ftb_pass  = Podania / Asysty
```

## Unikalne Identyfikatory (Różne per mecz)
- `market.id` - unikalne per mecz
- `selection.id` - unikalne per mecz

## Wzorce Nazw Marketów

### 1. Proste markety (bez parametrów)
```
Wynik meczu (z wyłączeniem dogrywki)     -> MATCH_WINNER
Podwójna Szansa                          -> DOUBLE_CHANCE
Oba zespoły strzelą gola                 -> BTTS
Remis - zwrot                            -> DRAW_NO_BET
Hat-trick                                -> HAT_TRICK
Czerwona kartka                          -> RED_CARD
Bramka rezerwowego                       -> SUBSTITUTE_GOAL
```

### 2. Markety z linią (Over/Under)
Format: `{nazwa} Powyżej/Poniżej` lub `Gole Powyżej/Poniżej`
```
Gole Powyżej/Poniżej                     -> TOTAL_GOALS
```

### 3. Markety z nazwą drużyny
Format: `{market} - {TEAM}` lub `{market}- {TEAM}` (niespójne spacje!)
```
Liczba goli - {TEAM}                     -> TEAM_TOTAL_GOALS
Czerwona kartka- {TEAM}                  -> TEAM_RED_CARD
Strzelą w obu połowach - {TEAM}          -> TEAM_SCORE_BOTH_HALVES
Wygrają obie połowy - {TEAM}             -> TEAM_WIN_BOTH_HALVES
Wygrają jedną z połów- {TEAM}            -> TEAM_WIN_EITHER_HALF
1. połowa Gole - {TEAM}                  -> TEAM_GOALS_1H
2. połowa Gole - {TEAM}                  -> TEAM_GOALS_2H
```

### 4. Markety połówkowe
Format: `{period} {market}` lub `{market} - {period}`
```
1. połowa Wynik                          -> HALF_TIME_RESULT
2. połowa Wynik                          -> SECOND_HALF_RESULT
Dokładny wynik - 1. połowa               -> CORRECT_SCORE_1H
Oba zespoły strzelą gola - 1. połowa     -> BTTS_1H
Oba zespoły strzelą gola - 2. połowa     -> BTTS_2H
```

### 5. Markety kombinowane
Format: `{market1} & {market2}` lub `{market1} / {market2}`
```
Wynik meczu & oba zespoły strzelą        -> RESULT_BTTS
Wynik i gole                             -> RESULT_TOTAL_GOALS
Podwójna szansa & oba zespoły strzelą    -> DOUBLE_CHANCE_BTTS
Podwójna szansa & powyżej/poniżej        -> DOUBLE_CHANCE_TOTAL
Wynik Meczu Połowa / Cały                -> HT_FT
```

### 6. Markety Handicap
```
Handicap                                 -> EUROPEAN_HANDICAP
Handicap (2-drożny)                      -> ASIAN_HANDICAP
Handicap 1. połowa                       -> HANDICAP_1H
```

### 7. Markety Correct Score
```
Dokładny wynik                           -> CORRECT_SCORE
Dokładny wynik - 1. połowa               -> CORRECT_SCORE_1H
Dokładny wynik w grupie                  -> CORRECT_SCORE_GROUP
```

### 8. Markety Statystyk
```
Suma rzutów rożnych (razem z dogrywką)   -> TOTAL_CORNERS
Rzuty rożne {TEAM} (razem z dogrywką)    -> TEAM_CORNERS
Więcej rzutów rożnych                    -> CORNERS_WINNER
Liczba kartek                            -> TOTAL_CARDS
Więcej kartek                            -> CARDS_WINNER
```

### 9. Markety Strzelców
```
Którykolwiek zawodnik strzeli gola       -> ANYTIME_GOALSCORER
Którykolwiek zawodnik strzeli gola - 3 graczy -> ANYTIME_GOALSCORER_3
Obaj gracze strzelą                      -> BOTH_PLAYERS_SCORE
Zawodnik strzeli gola i zaliczy asystę   -> GOAL_AND_ASSIST
```

## Wzorce Nazw Selekcji

### 1. Match Result (1X2)
```
{HOME_TEAM}     -> HOME (lub "1")
Remis           -> DRAW (lub "X") [UWAGA: często "Remis " ze spacją!]
{AWAY_TEAM}     -> AWAY (lub "2")
```

### 2. Double Chance
```
{HOME} lub remis        -> HOME_DRAW (1X)
{HOME} lub {AWAY}       -> HOME_AWAY (12)
Remis lub {AWAY}        -> DRAW_AWAY (X2)
```

### 3. Over/Under
Format: `Powyżej X,Y` / `Poniżej X,Y` (przecinek jako separator!)
```
Powyżej 0,5     -> OVER_0_5
Poniżej 0,5     -> UNDER_0_5
Powyżej 1,5     -> OVER_1_5
Powyżej 2,5     -> OVER_2_5
...
```

### 4. Yes/No (Tak/Nie)
```
Tak             -> YES
Nie             -> NO
```

### 5. Handicap
Format: `{TEAM} (±N)` i `Remis ({TEAM} ±N)`
```
{HOME} (-1)             -> HOME_MINUS_1
Remis ({HOME} -1)       -> DRAW_HOME_MINUS_1
{AWAY} (+1)             -> AWAY_PLUS_1
{HOME} (+2)             -> HOME_PLUS_2
...
```

### 6. Correct Score
Format: `X - Y` (ze spacjami wokół myślnika)
```
0 - 0           -> 0_0
1 - 0           -> 1_0
0 - 1           -> 0_1
2 - 1           -> 2_1
Inny            -> OTHER
```

### 7. HT/FT
Format: `{HT_RESULT} / {FT_RESULT}`
```
{HOME} / {HOME}         -> HOME_HOME
{HOME} / Remis          -> HOME_DRAW
Remis / {HOME}          -> DRAW_HOME
Remis / Remis           -> DRAW_DRAW
{AWAY} / {AWAY}         -> AWAY_AWAY
...
```

### 8. Combo Results
Format: `{RESULT} & {CONDITION}`
```
{HOME} & Powyżej 2,5    -> HOME_OVER_2_5
{HOME} & Tak            -> HOME_YES (for BTTS combo)
Remis & Poniżej 1,5     -> DRAW_UNDER_1_5
...
```

### 9. Double Chance Combo
Format: `{DC} & {CONDITION}`
```
{HOME} / Remis & Tak            -> HOME_DRAW_YES
{HOME} / Remis & Powyżej 2,5    -> HOME_DRAW_OVER_2_5
{HOME} / {AWAY} & Nie           -> HOME_AWAY_NO
...
```

### 10. Time Periods
```
00:00 - 09:59   -> 0_10
10:00 - 19:59   -> 10_20
...
```

### 11. Score Ranges
```
0 - 8           -> 0_TO_8
9 - 11          -> 9_TO_11
12+             -> 12_PLUS
```

## Uwagi Implementacyjne

### Normalizacja Drużyn
1. Wyciągnij nazwy drużyn z `match.homeTeam` i `match.awayTeam`
2. Użyj regex do zastąpienia w nazwach marketów i selekcji:
   - `{HOME_TEAM}` lub `{homeTeam}` -> HOME
   - `{AWAY_TEAM}` lub `{awayTeam}` -> AWAY

### Parsowanie Linii
1. Linie goli używają **przecinka** jako separatora: `2,5` nie `2.5`
2. Handicapy używają **nawiasów**: `(+1)`, `(-2)`
3. Wyniki używają **spacji i myślnika**: `2 - 1`

### Problematyczne Wzorce

1. **KRYTYCZNE: Niespójny format liczb dziesiętnych w handicapach!**
   - HOME team używa **przecinka**: `Bournemouth (+0,5)`, `Villarreal (-1,5)`
   - AWAY team używa **kropki**: `Liverpool (+0.5)`, `Real Madryt (-1.5)`
   - Ten wzorzec jest KONSYSTENTNY między meczami!
   - **Rozwiązanie**: Normalizuj oba formaty do jednego (np. kropka)

2. Niespójne spacje przed myślnikiem:
   - `Czerwona kartka- {TEAM}` (bez spacji)
   - `Liczba goli - {TEAM}` (ze spacją)

3. Spacja na końcu "Remis ":
   - Czasami selekcja to `"Remis "` (ze spacją na końcu)

4. Różne formy "lub":
   - Double chance używa `lub` (nie `or` czy `/`)

### Strategia Mapowania
1. **Najpierw** - użyj `group.id` do kategoryzacji
2. **Następnie** - pattern match na `market.name` (po usunięciu nazw drużyn)
3. **Na końcu** - pattern match na `selection.name` dla parametrów
