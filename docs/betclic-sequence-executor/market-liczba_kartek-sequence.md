# Normalizacja Marketu: Liczba kartek

## Data wykonania
2026-01-25

## Szczegóły marketu
- **Nazwa Betclic**: "Liczba kartek " (z trailing space)
- **Grupa**: subca_ftb_crd (Kartki)
- **Testowany mecz**: 905675391942656 (Arsenal - Manchester United)

## Przebieg sekwencji

### Krok 1: Analiza normalizacji
**Status początkowy**: ❌ Market zmapowany na OTHER

**Problem**:
- Market "Liczba kartek " był zmapowany na OTHER
- W katalogu istniał już market CARDS_TOTAL (ID 31) z:
  - Code: CARDS_TOTAL
  - Label: "Kartki w meczu"
  - Category: STATYSTYKI
  - HasParameter: true
  - ParameterType: decimal
  - ValidParameters: ["3.5", "4.5", "5.5", "6.5", "7.5"]
  - Selections: ["OVER", "UNDER"]

**Rozwiązanie**:
Uruchomiono agenta @betclic-normalizer, który dodał mapowanie:
```typescript
"Liczba kartek " -> CARDS_TOTAL
```

**Status końcowy**: ✅ Market poprawnie zmapowany na CARDS_TOTAL

### Krok 2: Sprawdzenie selekcji
**Status**: ✅ Selekcje poprawnie znormalizowane

- Raw: "Powyżej 1,5", "Poniżej 1,5", "Powyżej 2,5", "Poniżej 2,5"...
- Normalized: OVER, UNDER
- Oczekiwane: ["OVER", "UNDER"]

Selekcje są zgodne z katalogiem market-catalog.ts.

### Krok 3: Sprawdzenie view_type
**Status**: ✅ View_type poprawny

**Weryfikacja parametrów**:
- RAW JSON: 5 parametrów (1.5, 2.5, 3.5, 4.5, 5.5)
- FRONTEND JSON: 5 parametrów (1.5, 2.5, 3.5, 4.5, 5.5)

Liczby się zgadzają.

**Agent @betclic-view-type-checker**: Potwierdził poprawne wyświetlanie, brak problemów.

ViewType z katalogu: STAT_RANGE

## Uwagi
1. Market używa polskich nazw selekcji ("Powyżej 1,5", "Poniżej 1,5")
2. Betclic używa przecinka w parametrach (1,5 zamiast 1.5)
3. Normalizator poprawnie mapuje "Powyżej" -> OVER, "Poniżej" -> UNDER
4. Trailing space w nazwie marketu ("Liczba kartek ") został uwzględniony w mapowaniu

## Wnioski
Market "Liczba kartek " z Betclic został pomyślnie znormalizowany na CARDS_TOTAL i jest poprawnie wyświetlany na frontendzie z view_type STAT_RANGE.
