import { describe, it, expect } from "vitest";
import { matchToCanonical, matchTeamByExactAlias } from "../team-matcher.js";

/**
 * Fortuna's own team labels, as captured read-only on 2026-11-07 (laliga,
 * serie-a; docs/superpowers/plans/2026-11-06-scraper-recovery/fortuna.md,
 * Task 2 review). Before the aliases below, the fuzzy tier sent "Atl. Madryt"
 * (fixture label) and "Atl.Madrid" (parlay label) to Real Madrid, so
 * Atletico's fixtures were saved as Real Madrid's.
 */
describe("team-matcher: Fortuna labels", () => {
  it.each([
    ["Atl. Madryt", "laliga", "Atletico Madrid"],
    ["Atl.Madrid", "laliga", "Atletico Madrid"],
    ["FC Sevilla", "laliga", "Sevilla"],
    ["Real M.", "laliga", "Real Madrid"],
    ["A.Bergamo", "serie-a", "Atalanta"],
    ["Inter M.", "serie-a", "Inter Milan"],
  ])("matchToCanonical(%s, %s) is %s", (label, league, canonical) => {
    expect(matchToCanonical(label, league)?.name).toBe(canonical);
  });

  it.each([
    ["Atl. Madryt", "laliga", "Atletico Madrid"],
    ["AS Roma", "serie-a", "Roma"],
    ["W.Ziel.Przyl.", "world-cup-2026", "Cape Verde"],
    ["Maroko", "world-cup-2026", "Morocco"],
  ])("matchTeamByExactAlias(%s, %s) is %s", (label, league, canonical) => {
    expect(matchTeamByExactAlias(label, league)?.name).toBe(canonical);
  });

  it.each([
    // resolved only by the substring or fuzzy tiers of matchToCanonical
    ["Real M.", "laliga"],
    ["Van", "ligue-1"],
    ["Nottingham Murillo", "premier-league"],
    ["Roma", "serie-a"], // the canonical name itself, not an alias
  ])("matchTeamByExactAlias(%s, %s) is null", (label, league) => {
    expect(matchTeamByExactAlias(label, league)).toBeNull();
  });

  it(
    "KNOWN GAP: Fortuna's 'A Coruňa' has no canonical team in laliga-teams.ts " +
      "(roster predates Deportivo's promotion), so it stays an unmatched label",
    () => {
      expect(matchToCanonical("A Coruňa", "laliga")).toBeNull();
      expect(matchTeamByExactAlias("A Coruňa", "laliga")).toBeNull();
    }
  );
});
