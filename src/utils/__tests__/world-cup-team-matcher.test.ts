import { describe, it, expect } from "vitest";
import { matchToCanonical, normalize } from "../team-matcher.js";
import { WORLD_CUP_2026_TEAMS } from "../../data/world-cup-2026-teams.js";

const L = "world-cup-2026";

describe("world cup team matching", () => {
  it("has 48 canonical nations", () => {
    expect(WORLD_CUP_2026_TEAMS.length).toBe(48);
  });

  it("each canonical name self-matches and normalized mirrors normalize()", () => {
    for (const team of WORLD_CUP_2026_TEAMS) {
      expect(normalize(team.name)).toBe(team.normalized);
      expect(matchToCanonical(team.name, L)?.name).toBe(team.name);
    }
  });

  it("maps Polish bookmaker names to canonical English", () => {
    const cases: [string, string][] = [
      ["Niemcy", "Germany"],
      ["Hiszpania", "Spain"],
      ["Korea Południowa", "South Korea"],
      ["Wybrzeże Kości Słoniowej", "Ivory Coast"],
      ["Arabia Saudyjska", "Saudi Arabia"],
      ["Stany Zjednoczone", "USA"],
      ["Czechy", "Czech Republic"],
      ["Holandia", "Netherlands"],
      ["Bośnia i Hercegowina", "Bosnia-Herzegovina"],
    ];
    for (const [scraped, expected] of cases) {
      expect(matchToCanonical(scraped, L)?.name).toBe(expected);
    }
  });
});
