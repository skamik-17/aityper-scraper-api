import { describe, it, expect } from "vitest";
import {
  normalizeFirstGoalTimeSelection,
  normalizeFirstGoalTimeAltSelection,
} from "../betclic-normalizer";

// Betclic quotes TWO first-goal-time markets that route separately:
//  - "czas 1. gola"            -> FIRST_GOAL_TIME     (catalog: 10-minute buckets)
//  - "czas 1. gola - opcja II" -> FIRST_GOAL_TIME_ALT (catalog: 15-minute buckets)
// Selections must map onto the exact catalog selection codes of their market;
// the legacy behavior squashed 10-minute ranges into lossy 15-minute labels
// (and used "0-15", which exists in neither catalog entry).

describe("normalizeFirstGoalTimeSelection (FIRST_GOAL_TIME, 10-min buckets)", () => {
  it("maps 10-minute HH:MM ranges to catalog buckets", () => {
    expect(normalizeFirstGoalTimeSelection("00:00 - 09:59")).toBe("1-10");
    expect(normalizeFirstGoalTimeSelection("10:00 - 19:59")).toBe("11-20");
    expect(normalizeFirstGoalTimeSelection("20:00 - 29:59")).toBe("21-30");
    expect(normalizeFirstGoalTimeSelection("30:00 - 39:59")).toBe("31-40");
    expect(normalizeFirstGoalTimeSelection("40:00 - 49:59")).toBe("41-50");
    expect(normalizeFirstGoalTimeSelection("50:00 - 59:59")).toBe("51-60");
    expect(normalizeFirstGoalTimeSelection("60:00 - 69:59")).toBe("61-70");
    expect(normalizeFirstGoalTimeSelection("70:00 - 79:59")).toBe("71-80");
  });

  it('maps "80:00 - Koniec meczu (90min)" to "81-90"', () => {
    expect(normalizeFirstGoalTimeSelection("80:00 - Koniec meczu (90min)")).toBe("81-90");
  });

  it('maps "Brak Gola" to "NONE" (case insensitive)', () => {
    expect(normalizeFirstGoalTimeSelection("Brak Gola")).toBe("NONE");
    expect(normalizeFirstGoalTimeSelection("brak gola")).toBe("NONE");
    expect(normalizeFirstGoalTimeSelection("BRAK GOLA")).toBe("NONE");
  });

  it("handles trim properly", () => {
    expect(normalizeFirstGoalTimeSelection("  00:00 - 09:59  ")).toBe("1-10");
    expect(normalizeFirstGoalTimeSelection("\tBrak Gola\n")).toBe("NONE");
  });

  it("returns normalized string for unknown patterns", () => {
    expect(normalizeFirstGoalTimeSelection("Unknown pattern")).toBe("Unknown pattern");
  });
});

describe("normalizeFirstGoalTimeAltSelection (FIRST_GOAL_TIME_ALT, 15-min buckets)", () => {
  it("maps 15-minute HH:MM ranges to catalog buckets", () => {
    expect(normalizeFirstGoalTimeAltSelection("00:00 - 14:59")).toBe("1-15");
    expect(normalizeFirstGoalTimeAltSelection("15:00 - 29:59")).toBe("16-30");
    expect(normalizeFirstGoalTimeAltSelection("60:00 - 74:59")).toBe("61-75");
  });

  it("maps Przerwa / Koniec meczu boundary labels", () => {
    expect(normalizeFirstGoalTimeAltSelection("30:00 - Przerwa")).toBe("31-45");
    expect(normalizeFirstGoalTimeAltSelection("Przerwa - 59:59")).toBe("46-60");
    expect(normalizeFirstGoalTimeAltSelection("75:00 - Koniec meczu (90min)")).toBe("76-90");
    expect(normalizeFirstGoalTimeAltSelection("75:00 - Koniec meczu")).toBe("76-90");
  });

  it('maps "Brak Gola" to "NONE"', () => {
    expect(normalizeFirstGoalTimeAltSelection("Brak Gola")).toBe("NONE");
  });
});
