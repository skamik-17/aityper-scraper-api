import { describe, expect, it } from "vitest";
import { betbyTournamentIds } from "../scraper.js";

describe("betbyTournamentIds", () => {
  it("one tournament for a whole league", () =>
    expect(betbyTournamentIds("premier-league", "betters")).toEqual(["1669818860469096448"]));

  it("the Nations League spans League A and League B tournaments on both brands", () => {
    for (const bm of ["betters", "lebull"] as const) {
      expect(betbyTournamentIds("nations-league", bm)).toEqual(["2707230903544983592", "2707230903544983600"]);
    }
  });

  it("a league the brand does not map is null", () => expect(betbyTournamentIds("world-cup-2026", "betters")).toBeNull());
});
