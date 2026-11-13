import { describe, expect, it, vi, afterEach } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../../types.js";

/**
 * Controller ruling 22 (betclic, latent): the MOST_SHOTS and FOUL_RACE name
 * patterns were anchored only at the start, so a period- or stat-scoped
 * variant ("1x2 Strzały - 1. połowa", "1x2 Strzały celne") would have been
 * published as the full-match race. Only the names betclic actually sends
 * (WC golden fixture: "1x2 Strzały (120 min)", "Faule 1X2 (OPTA) (z
 * dogrywką)") and their suffix-less forms may map.
 */
const ctx = { homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" } as NormalizationContext;
const race = (name: string) =>
  betclicNormalizer.normalizeMarket(
    {
      name,
      selections: [
        { name: "Francja", odds: 1.45 },
        { name: "Remis", odds: 7.5 },
        { name: "Maroko", odds: 3.6 },
      ],
    } as RawBookmakerMarket,
    ctx,
  )?.marketCode ?? null;

describe("betclic race-market name patterns", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["1x2 Strzały (120 min)", "MOST_SHOTS"],
    ["1x2 Strzały", "MOST_SHOTS"],
    ["Faule 1X2 (OPTA) (z dogrywką)", "FOUL_RACE"],
    ["Faule 1X2 (OPTA)", "FOUL_RACE"],
  ])("%s maps to %s", (name, code) => {
    expect(race(name)).toBe(code);
  });

  it.each([
    "1x2 Strzały - 1. połowa",
    "1x2 Strzały celne (120 min)",
    "1x2 Strzały na bramkę",
    "Faule 1X2 (OPTA) - 1. połowa",
    "Faule 1X2 (OPTA) - 2. połowa (z dogrywką)",
  ])("%s is not the full-match race", (name) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const code = race(name);
    expect(code).not.toBe("MOST_SHOTS");
    expect(code).not.toBe("FOUL_RACE");
  });
});
