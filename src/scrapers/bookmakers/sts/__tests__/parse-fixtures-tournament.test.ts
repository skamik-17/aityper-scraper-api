import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWebSocketJson, parseFixtures } from "../parser.js";
import { LEAGUE_CONFIG } from "../constants.js";

/**
 * Premier League listing filter regression coverage (2026-11): the name
 * substring filter ("angli" + "premier league") also matched the Northern
 * Premier League and Premier League 2 under category 249 ("Anglia Amatorzy").
 * The real i_pl frame lists 36 fixtures that way; only the 20 in tournament
 * 17 of category 1 belong to the Premier League.
 */
const fx = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const ipl = () => parseWebSocketJson(fx("i_pl.trimmed.txt"))!;

describe("STS parseFixtures strict category + tournament filter", () => {
  it("premier-league keeps only tournament 17 in category 1 (drops Northern Premier League and Premier League 2)", () => {
    const fixtures = parseFixtures(ipl(), "premier-league");
    expect(fixtures).toHaveLength(20); // 36 today
    expect(new Set(fixtures.map((f) => f.tournament))).toEqual(new Set(["Premier League"]));
    expect(new Set(fixtures.map((f) => f.country))).toEqual(new Set(["Anglia"]));
    expect(fixtures.map((f) => f.id)).toEqual(expect.arrayContaining(["f2921896", "f2921898"]));
  });
  it("premier-league rejects tournament 17 under a non-1 category", () => {
    const data = ipl();
    const C = data.B!.S!["1"].C!;
    C["249"].T!["17"] = C["1"].T!["17"];
    delete C["1"].T!["17"];
    expect(parseFixtures(data, "premier-league")).toHaveLength(0); // 36 today (substring filter), 20 with a tournament-only check
  });
  it("only premier-league opts into strict category + tournament ids", () => {
    expect(LEAGUE_CONFIG["premier-league"]).toMatchObject({ strictTournamentId: true, categoryId: 1, tournamentId: 17 });
    expect(LEAGUE_CONFIG.ekstraklasa.strictTournamentId).toBeUndefined();
  });
});
