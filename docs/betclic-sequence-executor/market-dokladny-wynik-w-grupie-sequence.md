# Dokładny wynik w grupie - Sekwencja wykonania

## Informacje o rynku
- **Nazwa:** Dokładny wynik w grupie
- **Bookmaker:** Betclic
- **Match ID:** 905675290968064 (West Ham - Sunderland)
- **Group ID:** subca_ftb_cos (Handicap)
- **Znormalizowany typ:** CORRECT_SCORE_GROUP
- **ViewType:** COMBINATION

## Krok 1: Analiza normalizacji
**Status:** ✅ POPRAWNA NORMALIZACJA

Market był nieobsługiwany w betclic-normalizer.ts. Użytkownik zainicjował agenta @betclic-normalizer, który:
1. Dodał nowy typ marketu `CORRECT_SCORE_GROUP` do market-catalog.ts
2. Dodał mapowanie `"dokladny wynik w grupie": "CORRECT_SCORE_GROUP"` w betclic-normalizer.ts
3. Utworzył funkcję `normalizeCorrectScoreGroupSelection()` z regex patternami dla każdej grupy wyników
4. Dodał nowe selekcje do NormalizedSelection w types.ts

**Problem naprawiony przez użytkownika:**
- Regex patterns brakowały słowa "lub" między wynikami (np. `1 - 0, 2 - 0 lub 3 - 0`)
- Dodano `HOME_WIN_GROUP_0` do NormalizedSelection (brakowało w implementacji agenta)

## Krok 2: Sprawdzenie selekcji
**Status:** ✅ SELEKCJE POPRAWNIE ZNORMALIZOWANE

Wszystkie 11 selekcji zostało poprawnie zmapowanych:
- HOME_WIN_GROUP_0: "1 - 0, 2 - 0 lub 3 - 0"
- HOME_WIN_GROUP_1: "4 - 0, 5 - 0 lub 6 - 0"
- HOME_WIN_GROUP_2: "2 - 1, 3 - 1 lub 4 - 1"
- HOME_WIN_GROUP_3: "3 - 2, 4 - 2, 4 - 3 lub 5 - 1"
- HOME_OTHER: "West Ham - Inny wynik"
- DRAW: "Remis"
- AWAY_WIN_GROUP_1: "0 - 1, 0 - 2 lub 0 - 3"
- AWAY_WIN_GROUP_2: "0 - 4, 0 - 5 lub 0 - 6"
- AWAY_WIN_GROUP_3: "1 - 2, 1 - 3 lub 1 - 4"
- AWAY_WIN_GROUP_4: "2 - 3, 2 - 4, 3 - 4 lub 1 - 5"
- AWAY_OTHER: "Sunderland - Inny wynik"

**Problem naprawiony przez użytkownika:**
- Dodano `HOME_WIN_GROUP_0` do listy selekcji w market-catalog.ts (brakowało w implementacji agenta)

## Krok 3: Sprawdzenie view_type
**Status:** ✅ VIEW TYPE POPRAWNY (po poprawce)

Agent @betclic-view-type-checker potwierdził, że viewType `COMBINATION` jest odpowiedni dla tego marketu, ale zgłosił brakujące `descriptionTemplates`.

**Problem naprawiony przez użytkownika:**
- Dodano `descriptionTemplates` do definicji CORRECT_SCORE_GROUP w market-catalog.ts

## Wykonane zmiany

### 1. backend/src/services/normalization/types.ts
- Dodano `HOME_WIN_GROUP_0: "HOME_WIN_GROUP_0"` do NormalizedSelection

### 2. backend/src/services/normalization/bookmakers/betclic-normalizer.ts
- Dodano mapowanie: `"dokladny wynik w grupie": "CORRECT_SCORE_GROUP"`
- Dodano funkcję `normalizeCorrectScoreGroupSelection()` z regex patternami
- Poprawiono regex patterns (dodano słowo "lub" między wynikami)
- Dodano case "CORRECT_SCORE_GROUP" w normalizeSelectionForMarket()

### 3. backend/src/data/market-catalog.ts
- Dodano nowy market CORRECT_SCORE_GROUP z:
  - code: "CORRECT_SCORE_GROUP"
  - slug: "correct-score-group"
  - category: MarketCategory.DOKLADNY_WYNIK
  - labels: pl/en
  - descriptions: pl/en
  - hasParameter: false
  - selections: [HOME_WIN_GROUP_0, HOME_WIN_GROUP_1, HOME_WIN_GROUP_2, HOME_WIN_GROUP_3, DRAW, AWAY_WIN_GROUP_1, AWAY_WIN_GROUP_2, AWAY_WIN_GROUP_3, AWAY_WIN_GROUP_4, HOME_OTHER, AWAY_OTHER]
  - selectionOrder: [takie samo jak selections]
  - viewType: ViewType.COMBINATION
  - displayOrder: 52
  - descriptionTemplates: {templates dla każdej selekcji}

## Frontend JSON (MarketWithParams format)
```json
{
  "marketKey": "CORRECT_SCORE_GROUP",
  "type": "CORRECT_SCORE_GROUP",
  "category": "DOKLADNY_WYNIK",
  "label": "Dokładny wynik w grupie",
  "description": "Grupowane wyniki dokładne - uproszczona wersja correct score",
  "displayOrder": 52,
  "viewType": "COMBINATION",
  "parameters": [
    {
      "value": "base",
      "label": "",
      "bookmakers": [
        {
          "bookmaker": "betclic",
          "bookmakerName": "betclic",
          "selections": [
            { "type": "HOME_WIN_GROUP_0", "odds": 3.7, "hasNoTaxPromo": false },
            { "type": "HOME_WIN_GROUP_1", "odds": 45, "hasNoTaxPromo": false },
            { "type": "HOME_WIN_GROUP_2", "odds": 5.4, "hasNoTaxPromo": false },
            { "type": "HOME_WIN_GROUP_3", "odds": 18, "hasNoTaxPromo": false },
            { "type": "HOME_OTHER", "odds": 101, "hasNoTaxPromo": false },
            { "type": "DRAW", "odds": 3.15, "hasNoTaxPromo": false },
            { "type": "AWAY_WIN_GROUP_1", "odds": 5, "hasNoTaxPromo": false },
            { "type": "AWAY_WIN_GROUP_2", "odds": 101, "hasNoTaxPromo": false },
            { "type": "AWAY_WIN_GROUP_3", "odds": 7.2, "hasNoTaxPromo": false },
            { "type": "AWAY_WIN_GROUP_4", "odds": 25, "hasNoTaxPromo": false },
            { "type": "AWAY_OTHER", "odds": 101, "hasNoTaxPromo": false }
          ]
        }
      ]
    }
  ],
  "defaultParameter": "base",
  "hasParameters": false
}
```

## RAW JSON
```json
{
  "name": "Dokładny wynik w grupie",
  "groupId": "subca_ftb_cos",
  "groupName": "Dokładny wynik",
  "selections": [
    { "name": "1 - 0, 2 - 0 lub 3 - 0", "odds": 3.7 },
    { "name": "4 - 0, 5 - 0 lub 6 - 0", "odds": 45 },
    { "name": "2 - 1, 3 - 1 lub 4 - 1", "odds": 5.4 },
    { "name": "3 - 2, 4 - 2, 4 - 3 lub 5 - 1", "odds": 18 },
    { "name": "West Ham - Inny wynik", "odds": 101 },
    { "name": "Remis ", "odds": 3.15 },
    { "name": "0 - 1, 0 - 2 lub 0 - 3", "odds": 5 },
    { "name": "0 - 4, 0 - 5 lub 0 - 6", "odds": 101 },
    { "name": "1 - 2, 1 - 3 lub 1 - 4", "odds": 7.2 },
    { "name": "2 - 3, 2 - 4, 3 - 4 lub 1 - 5", "odds": 25 },
    { "name": "Sunderland - Inny wynik", "odds": 101 }
  ]
}
```

## Status: ✅ UKOŃCZONY
Market "Dokładny wynik w grupie" został pomyślnie znormalizowany i jest gotowy do użycia w systemie.
