import { describe, it, expect } from "vitest";
import { normalizeFirstGoalTimeSelection } from "../betclic-normalizer";

describe("normalizeFirstGoalTimeSelection", () => {
  describe("Standard format HH:MM - HH:MM", () => {
    it('maps "00:00 - 09:59" to "0-15"', () => {
      expect(normalizeFirstGoalTimeSelection("00:00 - 09:59")).toBe("0-15");
    });

    it('maps "10:00 - 19:59" to "16-30"', () => {
      expect(normalizeFirstGoalTimeSelection("10:00 - 19:59")).toBe("16-30");
    });

    it('maps "20:00 - 29:59" to "16-30"', () => {
      expect(normalizeFirstGoalTimeSelection("20:00 - 29:59")).toBe("16-30");
    });

    it('maps "30:00 - 39:59" to "31-45"', () => {
      expect(normalizeFirstGoalTimeSelection("30:00 - 39:59")).toBe("31-45");
    });

    it('maps "40:00 - 49:59" to "46-60"', () => {
      expect(normalizeFirstGoalTimeSelection("40:00 - 49:59")).toBe("46-60");
    });

    it('maps "50:00 - 59:59" to "46-60"', () => {
      expect(normalizeFirstGoalTimeSelection("50:00 - 59:59")).toBe("46-60");
    });

    it('maps "60:00 - 69:59" to "61-75"', () => {
      expect(normalizeFirstGoalTimeSelection("60:00 - 69:59")).toBe("61-75");
    });

    it('maps "70:00 - 79:59" to "76-90"', () => {
      expect(normalizeFirstGoalTimeSelection("70:00 - 79:59")).toBe("76-90");
    });

    it('maps "Brak Gola" to "NONE"', () => {
      expect(normalizeFirstGoalTimeSelection("Brak Gola")).toBe("NONE");
    });

    it('maps "80:00 - Koniec meczu (90min)" to "76-90"', () => {
      expect(normalizeFirstGoalTimeSelection("80:00 - Koniec meczu (90min)")).toBe("76-90");
    });
  });

  describe("Special patterns with Przerwa and Koniec meczu", () => {
    it('maps "00:00 - 14:59" to "0-15"', () => {
      expect(normalizeFirstGoalTimeSelection("00:00 - 14:59")).toBe("0-15");
    });

    it('maps "15:00 - 29:59" to "16-30"', () => {
      expect(normalizeFirstGoalTimeSelection("15:00 - 29:59")).toBe("16-30");
    });

    it('maps "30:00 - Przerwa" to "31-45"', () => {
      expect(normalizeFirstGoalTimeSelection("30:00 - Przerwa")).toBe("31-45");
    });

    it('maps "Przerwa - 59:59" to "46-60"', () => {
      expect(normalizeFirstGoalTimeSelection("Przerwa - 59:59")).toBe("46-60");
    });

    it('maps "60:00 - 74:59" to "61-75"', () => {
      expect(normalizeFirstGoalTimeSelection("60:00 - 74:59")).toBe("61-75");
    });

    it('maps "75:00 - Koniec meczu (90min)" to "76-90"', () => {
      expect(normalizeFirstGoalTimeSelection("75:00 - Koniec meczu (90min)")).toBe("76-90");
    });

    it('maps "75:00 - Koniec meczu" to "76-90"', () => {
      expect(normalizeFirstGoalTimeSelection("75:00 - Koniec meczu")).toBe("76-90");
    });

    it('maps "Brak Gola" to "NONE"', () => {
      expect(normalizeFirstGoalTimeSelection("Brak Gola")).toBe("NONE");
    });
  });

  describe("Unknown patterns and edge cases", () => {
    it('maps "Brak gola" to "NONE" (case insensitive)', () => {
      expect(normalizeFirstGoalTimeSelection("Brak gola")).toBe("NONE");
      expect(normalizeFirstGoalTimeSelection("brak gola")).toBe("NONE");
      expect(normalizeFirstGoalTimeSelection("BRAK GOLA")).toBe("NONE");
    });

    it('handles trim properly', () => {
      expect(normalizeFirstGoalTimeSelection("  00:00 - 09:59  ")).toBe("0-15");
      expect(normalizeFirstGoalTimeSelection("\tBrak Gola\n")).toBe("NONE");
    });

    it('returns normalized string for unknown patterns', () => {
      const result = normalizeFirstGoalTimeSelection("Unknown pattern");
      expect(result).toBe("Unknown pattern");
    });
  });
});
