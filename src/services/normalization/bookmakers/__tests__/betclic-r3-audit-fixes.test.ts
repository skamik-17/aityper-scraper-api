import { describe, expect, it } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../../types.js";

const ctx: NormalizationContext = {
  bookmaker: "betclic",
  homeTeam: "Switzerland",
  awayTeam: "Colombia",
  league: "world-cup-2026",
} as NormalizationContext;

function norm(raw: RawBookmakerMarket) {
  return betclicNormalizer.normalizeMarket(raw, ctx);
}

describe("betclic round-3 audit fixes", () => {
  it("maps corners handicap sides to HOME/AWAY", () => {
    const out = norm({
      name: "Rzuty rożne Handicap",
      paramValue: "-0.5",
      selections: [
        { name: "Szwajcaria (-0,5)", odds: 2.38 },
        { name: "Kolumbia (+0,5)", odds: 1.55 },
      ],
    } as RawBookmakerMarket);
    expect(out?.marketCode).toBe("CORNERS_HANDICAP");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "AWAY"]);
    expect(out?.marketKey).toBe("CORNERS_HANDICAP:-0.5");
  });

  it("maps 1st-half corners handicap sides to HOME/AWAY", () => {
    const out = norm({
      name: "Rzuty rożne Handicap (2-way) 1. połowa",
      paramValue: "0.5",
      selections: [
        { name: "Szwajcaria (+0,5)", odds: 1.69 },
        { name: "Kolumbia (-0,5)", odds: 2.05 },
      ],
    } as RawBookmakerMarket);
    expect(out?.marketCode).toBe("HALF_TIME_CORNERS_HANDICAP");
    expect(out?.selections.map((s) => s.code)).toEqual(["HOME", "AWAY"]);
  });

  it("maps team cards O/U to HOME_/AWAY_ vocabulary", () => {
    const home = norm({
      name: "Kartki - Szwajcaria",
      selections: [
        { name: "Powyżej 0,5", odds: 1.3 },
        { name: "Poniżej 0,5", odds: 3.2 },
      ],
    } as RawBookmakerMarket);
    expect(home?.marketCode).toBe("CARDS_TEAM");
    expect(home?.selections.map((s) => s.code)).toEqual(["HOME_OVER", "HOME_UNDER"]);

    const away = norm({
      name: "Kartki - Kolumbia",
      selections: [
        { name: "Powyżej 1,5", odds: 1.8 },
        { name: "Poniżej 1,5", odds: 1.9 },
      ],
    } as RawBookmakerMarket);
    expect(away?.selections.map((s) => s.code)).toEqual(["AWAY_OVER", "AWAY_UNDER"]);
  });

  it("keeps distinct player trios as distinct selection codes", () => {
    const out = norm({
      name: "Wszyscy strzelą",
      selections: [
        { name: "B. Embolo & L. Diaz & Luis Suárez", odds: 38 },
        { name: "J. Rodríguez & L. Diaz & Luis Suárez", odds: 55 },
      ],
    } as RawBookmakerMarket);
    expect(out?.marketCode).toBe("ALL_PLAYERS_SCORE");
    const codes = out?.selections.map((s) => s.code);
    expect(new Set(codes).size).toBe(2);
    expect(codes?.[0]).toBe("B. Embolo & L. Diaz & Luis Suárez");
  });

  it("merges slash and ampersand player pair variants onto one sorted code", () => {
    const out = norm({
      name: "Jeden z graczy strzeli pierwszego gola",
      selections: [
        { name: "Luis Suárez / L. Diaz", odds: 3.32 },
        { name: "L. Diaz & Luis Suárez", odds: 3.4 },
      ],
    } as RawBookmakerMarket);
    expect(out?.marketCode).toBe("ANY_PLAYER_FIRST_GOAL");
    expect(out?.selections[0].code).toBe(out?.selections[1].code);
  });

  it("canonicalizes single-player scorer names to natural order", () => {
    const out = norm({
      name: "Zawodnik strzeli gola głową",
      selections: [{ name: "Hernandez, Cucho", odds: 8.0 }],
    } as RawBookmakerMarket);
    expect(out?.marketCode).toBe("PLAYER_HEADER_GOAL");
    expect(out?.selections[0].code).toBe("Cucho Hernandez");
  });
});
