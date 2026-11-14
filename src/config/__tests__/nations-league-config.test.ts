import { describe, expect, it } from "vitest";
import { getBookmakerLeagueId, getLeagueConfig } from "../leagues.js";
import { getTsdbLeagueMeta } from "../../data/tsdb-leagues.js";
import { LEAGUE_CONFIG as STS_LEAGUES } from "../../scrapers/bookmakers/sts/constants.js";
import { TOURNAMENT_IDS as FORTUNA_IDS } from "../../scrapers/bookmakers/fortuna/constants.js";
import { COMPETITION_IDS as BETCLIC_IDS, LEAGUE_SLUGS as BETCLIC_SLUGS } from "../../scrapers/bookmakers/betclic/constants.js";
import { TOURNAMENT_IDS as SUPERBET_IDS } from "../../scrapers/bookmakers/superbet/constants.js";
import { TOURNAMENT_IDS as LVBET_IDS } from "../../scrapers/bookmakers/lvbet/constants.js";

const L = "nations-league";

describe("nations-league configuration (live discovery 2026-11-14)", () => {
  it("is a league with its Polish name", () =>
    expect(getLeagueConfig(L)).toMatchObject({ displayName: "UEFA Nations League", displayNamePl: "Liga Narodów UEFA" }));

  it("group A bookmakers carry the discovered competition ids", () => {
    expect(getBookmakerLeagueId(L, "sts")).toBe(12277);
    expect(STS_LEAGUES[L]).toMatchObject({ tournamentId: 12277, categoryId: 3, strictTournamentId: true });
    expect(getBookmakerLeagueId(L, "fortuna")).toBe("ufo:tour:00-078");
    expect(FORTUNA_IDS[L]).toBe("ufo:tour:00-078");
    expect(getBookmakerLeagueId(L, "betclic")).toBe(22676);
    expect(BETCLIC_IDS[L]).toBe(22676);
    expect(BETCLIC_SLUGS[L]).toBe("uefa-liga-narodow-c22676");
    // Superbet splits the league phase into 14 groups (A1-A4, B1-B4, C1-C4, D1-D2)
    expect(SUPERBET_IDS[L]).toEqual([32375, 32376, 32377, 32378, 32379, 32380, 32381, 32382, 32374, 32383, 32384, 32385, 32386, 32387]);
    expect(getBookmakerLeagueId(L, "lvbet")).toBe(35699);
    expect(LVBET_IDS[L]).toBe(35699);
  });

  it("TSDB metadata: league 4490, season 2026-2027, rounds 1-6", () =>
    expect(getTsdbLeagueMeta(L)).toEqual({ theSportsDbId: "4490", totalRounds: 6, season: "2026-2027", rounds: [1, 2, 3, 4, 5, 6] }));
});
