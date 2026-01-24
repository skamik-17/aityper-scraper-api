# Sekwencja normalizacji: 2 graczy strzeli pow. 1,5 gole

## Informacje o markecie

| Pole | Wartość |
|------|---------|
| Nazwa | 2 graczy strzeli pow. 1,5 gole |
| Tab | STRZELCY |
| Group ID | subca_ftb_dat |
| Group Name | Dwóch i trzech zawodników |
| Match ID | 905675314241536 |

## Krok 1: Analiza normalizacji

**Status:** OK - Market poprawnie normalizuje się do OTHER

**Uzasadnienie:**
- Market "2 graczy strzeli pow. 1,5 gole" to zakład na kombinację dwóch graczy, którzy łącznie strzelą >1.5 gola
- Jest to bardzo specyficzny market Betclic z kategorii strzelców
- Nie ma odpowiednika w market-catalog.ts
- Nie występuje u innych polskich bukmacherów
- Normalizacja do `OTHER` jest poprawna i zamierzona

## Krok 2: Sprawdzenie selekcji

**Status:** OK - Selekcje poprawnie przekazywane (pass-through)

**Szczegóły:**
- 171 selekcji (kombinacje par graczy)
- Przykłady: "E. Haaland & A. Semenyo", "E. Haaland & P. Foden"
- Selekcje są dynamiczne (zależą od składów drużyn)
- Dla marketu OTHER selekcje są przekazywane bez normalizacji

## Krok 3: Sprawdzenie view_type

**Status:** OK - view_type akceptowalny

**Szczegóły:**
- viewType: BINARY_BUTTONS (domyślny dla OTHER)
- Liczba selekcji: 171 (RAW) = 171 (FRONTEND) ✓
- hasParameters: false ✓

## Podsumowanie

Market "2 graczy strzeli pow. 1,5 gole" jest poprawnie obsługiwany jako `OTHER`:
1. Jest to niszowy market występujący tylko u Betclic
2. Selekcje to dynamiczne kombinacje par graczy
3. Nie wymaga dodawania nowego typu do market-catalog.ts
4. Normalizacja i przekazywanie danych działa poprawnie

## Data wykonania

2026-01-24
