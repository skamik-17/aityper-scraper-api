# Sekwencja: Suma celnych strzałów w meczu (OPTA)

**Data:** 2026-01-25
**Match ID:** 905675391942656
**Match:** Arsenal - Manchester United

## Krok 1: Analiza normalizacji

### Problem
Market "Suma celnych strzałów w meczu (OPTA)" mapował się na `OTHER`.

### Rozwiązanie
Agent @betclic-normalizer dodał:
1. Nowy typ `TOTAL_SHOTS_ON_TARGET` do `NormalizedMarketType` w `types.ts`
2. Wpis w `market-catalog.ts` z definicją marketu (kategoria STATYSTYKI, viewType STAT_RANGE)
3. Mapowanie w `BETCLIC_MARKET_NAME_TO_CODE` dla nazwy "suma celnych strzalow w meczu (opta)"
4. Obsługę selekcji Over/Under w funkcji `normalizeSelectionForMarket`

### Wynik
Market poprawnie normalizuje się do `TOTAL_SHOTS_ON_TARGET` z parametrem linii.

## Krok 2: Sprawdzenie selekcji

### Selekcje RAW
- Powyżej 6,5, Poniżej 6,5
- Powyżej 7,5, Poniżej 7,5
- Powyżej 8,5, Poniżej 8,5
- Powyżej 9,5, Poniżej 9,5
- Powyżej 10,5, Poniżej 10,5

### Selekcje znormalizowane
- OVER, UNDER (dla każdej linii)

### Wynik
OK - selekcje poprawnie mapują się na OVER/UNDER.

## Krok 3: Sprawdzenie view_type

### Konfiguracja
- **viewType:** STAT_RANGE
- **Parametry:** 5 linii (6.5, 7.5, 8.5, 9.5, 10.5)
- **Selekcje:** OVER, UNDER

### Weryfikacja
Agent @betclic-view-type-checker potwierdził:
- STAT_RANGE mapowany na komponent ParameterSlider
- Obsługuje dowolne pary selekcji (OVER/UNDER)
- Parametry wyświetlane jako przyciski wyboru linii
- Kompatybilność: 100%

### Wynik
OK - view_type STAT_RANGE poprawnie wyświetli market.

## Podsumowanie

| Krok | Status | Uwagi |
|------|--------|-------|
| 1. Normalizacja | OK | Dodano TOTAL_SHOTS_ON_TARGET |
| 2. Selekcje | OK | OVER/UNDER |
| 3. view_type | OK | STAT_RANGE |

## Pliki zmodyfikowane
- `backend/src/types/index.ts` - dodano typ TOTAL_SHOTS_ON_TARGET
- `backend/src/data/market-catalog.ts` - dodano definicję marketu
- `backend/src/services/normalization/bookmakers/betclic-normalizer.ts` - dodano mapowanie
