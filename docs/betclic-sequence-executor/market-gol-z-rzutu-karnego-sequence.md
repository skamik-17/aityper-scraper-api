# Sekwencja dla marketu "Gol z rzutu karnego" (PENALTY_GOAL)

## Status: ✅ UKOŃCZONY

## Krok 1: Analiza normalizacji marketu

### Problem:
Market "Gol z rzutu karnego" nie był znormalizowany w systemie.

### RAW Market Data (from saved match 905675290968064):
```json
{
  "id": "1011617328713730",
  "name": "Gol z rzutu karnego",
  "selections": [
    { "id": "1011617328627715", "name": "West Ham strzeli rzut karny", "odds": 6.5 },
    { "id": "1011617328627716", "name": "Sunderland strzeli rzut karny", "odds": 7.5 },
    { "id": "1011617328627717", "name": "Którykolwiek zawodnik strzeli rzut karny", "odds": 3.8 },
    { "id": "1011617328627718", "name": "Żaden zespół nie strzeli rzutu karnego", "odds": 1.18 }
  ]
}
```

### Rozwiązanie:
Uruchomiono agenta `betclic-normalizer`, który:
1. Dodał `PENALTY_GOAL` do `market-catalog.ts`
2. Zmapował nazwę marketu: "gol z rzutu karnego" → PENALTY_GOAL
3. Zaimplementował funkcję `normalizePenaltyGoalSelection()` z mapowaniem:
   - "{TEAM} strzeli rzut karny" → TEAM_HOME / TEAM_AWAY
   - "Którykolwiek zawodnik strzeli rzut karny" → ANY
   - "Żaden zespół nie strzeli rzutu karnego" → NONE

### Wynik:
✅ Market znormalizowany poprawnie na `PENALTY_GOAL`

## Krok 2: Sprawdzenie selekcji

### Normalizacja selekcji:
| Selekcja RAW | Selekcja Normalizowana | Status |
|-------------|----------------------|--------|
| West Ham strzeli rzut karny | TEAM_HOME | ✅ |
| Sunderland strzeli rzut karny | TEAM_AWAY | ✅ |
| Którykolwiek zawodnik strzeli rzut karny | ANY | ✅ |
| Żaden zespół nie strzeli rzutu karnego | NONE | ✅ |

### Wynik:
✅ Wszystkie selekcje poprawnie znormalizowane

## Krok 3: Sprawdzenie view_type

### Konfiguracja marketu:
- `viewType`: COMBINATION
- `hasParameter`: false
- `selections`: ["TEAM_HOME", "TEAM_AWAY", "ANY", "NONE"]
- `selectionOrder`: ["TEAM_HOME", "TEAM_AWAY", "ANY", "NONE"]

### Weryfikacja przez agenta betclic-view-type-checker:
- ✅ `CombinationView` komponent poprawnie wyświetli 4 selekcje
- ✅ Układ pionowy (flex-col) jest odpowiedni dla długich nazw selekcji
- ✅ `selectionOrder` zostanie zachowany
- ✅ `descriptionTemplates` są poprawne

### Wynik:
✅ view_type COMBINATION poprawnie obsłuży market PENALTY_GOAL

## Zmiany w kodzie

### backend/src/data/market-catalog.ts
- Dodano wpis `PENALTY_GOAL` z:
  - Kategorią: `GOLE`
  - 4 selekcjami: TEAM_HOME, TEAM_AWAY, ANY, NONE
  - view_type: COMBINATION
  - descriptionTemplates z placeholderami {homeTeam} i {awayTeam}

### backend/src/services/normalization/bookmakers/betclic-normalizer.ts
- Dodano mapowanie nazwy: "gol z rzutu karnego" → PENALTY_GOAL
- Dodano funkcję `normalizePenaltyGoalSelection()`
- Dodano case w `normalizeSelectionForMarket()` dla PENALTY_GOAL

## Test poprawności

Normalizacja została przetestowana przy użyciu zapisanych danych z meczu 905675290968064:

```json
{
  "marketCode": "PENALTY_GOAL",
  "marketKey": "PENALTY_GOAL",
  "selections": [
    { "code": "TEAM_HOME", "label": "West Ham strzeli rzut karny", "odds": 6.5 },
    { "code": "TEAM_AWAY", "label": "Sunderland strzeli rzut karny", "odds": 7.5 },
    { "code": "ANY", "label": "Którykolwiek zawodnik strzeli rzut karny", "odds": 3.8 },
    { "code": "NONE", "label": "Żaden zespół nie strzeli rzutu karnego", "odds": 1.18 }
  ],
  "debug": {
    "rawName": "Gol z rzutu karnego",
    "rawId": "1011617328713730",
    "matchedBy": "name"
  }
}
```

✅ Wszystkie testy zakończone pomyślnie
