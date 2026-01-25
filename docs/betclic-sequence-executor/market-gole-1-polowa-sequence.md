# Sekwencja normalizacji: Gole 1. połowa

## Krok 1: Analiza normalizacji marketu
- **Status**: ✓ Poprawna normalizacja (po naprawie)
- **Początkowy problem**: Market był mapowany na OTHER
- **Rozwiązanie**: Uruchomiono agenta @betclic-normalizer, który dodał mapowanie na HALF_TIME_TOTAL_GOALS
- **Mapowanie**: "Gole 1. połowa" → HALF_TIME_TOTAL_GOALS
- **Group**: subca_ftb_gbh (Gole w polowie)

## Krok 2: Sprawdzenie selekcji
- **Status**: ✓ Poprawne
- **Selekcje**: OVER/UNDER poprawnie zmapowane z formatu "Powyżej X,Y" / "Poniżej X,Y"
- **Format liczb**: Używa przecinka (np. 0,5, 1,5, 2,5)
- **Wartości**: 0.5, 1.5, 2.5

## Krok 3: Sprawdzenie view_type
- **Status**: ✓ Poprawny
- **ViewType**: PARAMETER_SLIDER
- **Parametry w RAW JSON**: 3 wartości (0,5; 1,5; 2,5)
- **Parametry w FRONTEND JSON**: 3 elementy (0.5, 1.5, 2.5)
- **Kompatybilność**: 100%
- **Komponent**: ParameterSlider.tsx wyświetli przyciski wyboru linii oraz przyciski z kursami (OVER/UNDER)

## Podsumowanie
Market "Gole 1. połowa" został poprawnie znormalizowany na HALF_TIME_TOTAL_GOALS z view_type PARAMETER_SLIDER. Wszystkie selekcje są poprawnie mapowane i wyświetlane.
