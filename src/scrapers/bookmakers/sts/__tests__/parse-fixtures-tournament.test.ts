import { describe, it, expect, vi, afterEach } from "vitest";
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

/**
 * A renumbering (the Premier League moving to new category/tournament keys)
 * makes the strict listing empty, and index.ts then returns success:false
 * before its "Found N fixtures" log. The warning names the name-filter
 * candidates, so the service log shows where the league went.
 */
describe("STS parseFixtures strict-id miss diagnostic", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names the moved tournament and the other name-filter candidates when strict ids match nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = ipl();
    const C = data.B!.S!["1"].C!;
    C["249"].T!["17"] = C["1"].T!["17"];
    delete C["1"].T!["17"];
    expect(parseFixtures(data, "premier-league")).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      '[STS] Strict id filter for premier-league (C1/T17) matched 0 fixtures; name-filter candidates: ' +
        'C249/T17 "Anglia Amatorzy" / "Premier League" (21 fixtures), ' +
        'C249/T1000 "Anglia Amatorzy" / "Northern Premier League - Premier Division" (10 fixtures), ' +
        'C249/T1009 "Anglia Amatorzy" / "Premier League 2" (6 fixtures)'
    );
  });

  it("stays silent on a normal listing even though category 249 matches the name filters", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseFixtures(ipl(), "premier-league")).toHaveLength(20);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent on an empty listing when nothing else matches the name filters", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = ipl();
    const C = data.B!.S!["1"].C!;
    delete C["1"].T!["17"];
    delete C["249"];
    expect(parseFixtures(data, "premier-league")).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never warns for a non-strict league", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseFixtures(ipl(), "ekstraklasa")).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
