import { describe, expect, it } from "vitest";
import { getBookmakerLeagueId, getLeagueConfig } from "../leagues.js";
import { getTsdbLeagueMeta } from "../../data/tsdb-leagues.js";
import { LEAGUE_CONFIG as STS_LEAGUES } from "../../scrapers/bookmakers/sts/constants.js";
import { TOURNAMENT_IDS as FORTUNA_IDS } from "../../scrapers/bookmakers/fortuna/constants.js";
import { COMPETITION_IDS as BETCLIC_IDS, LEAGUE_SLUGS as BETCLIC_SLUGS } from "../../scrapers/bookmakers/betclic/constants.js";
import { TOURNAMENT_IDS as SUPERBET_IDS } from "../../scrapers/bookmakers/superbet/constants.js";
import { TOURNAMENT_IDS as LVBET_IDS } from "../../scrapers/bookmakers/lvbet/constants.js";
import { CATEGORY_IDS as FUKSIARZ_IDS } from "../../scrapers/bookmakers/fuksiarz/constants.js";
import { CATEGORY_IDS as FORBET_IDS } from "../../scrapers/bookmakers/forbet/constants.js";
import { CATEGORY_IDS as ETOTO_IDS } from "../../scrapers/bookmakers/etoto/constants.js";
import { CATEGORY_IDS as BETFAN_IDS } from "../../scrapers/bookmakers/betfan/constants.js";
import {
  COMPETITION_IDS as BETCRIS_IDS,
  LEAGUE_URLS as BETCRIS_URLS,
  REGION_ALIASES as BETCRIS_REGIONS,
} from "../../scrapers/bookmakers/betcris/constants.js";
import { LEAGUE_IDS as PZBUK_IDS } from "../../scrapers/bookmakers/pzbuk/constants.js";
import { betbyTournamentIds } from "../../scrapers/shared/betby/scraper.js";
import { getSupportedLeagues } from "../leagues.js";
import type { PolishBookmaker } from "../index.js";

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

  it("group B and C bookmakers carry the discovered competition ids", () => {
    // Fuksiarz splits the league into League A-D categories; its multi endpoint takes a comma list
    expect(getBookmakerLeagueId(L, "fuksiarz")).toBe("178719,178718,178722,231480");
    expect(FUKSIARZ_IDS[L]).toBe("178719,178718,178722,231480");
    expect(getBookmakerLeagueId(L, "forbet")).toBe(29929);
    expect(FORBET_IDS[L]).toBe(29929);
    expect(getBookmakerLeagueId(L, "etoto")).toBe(286);
    expect(ETOTO_IDS[L]).toBe(286);
    expect(getBookmakerLeagueId(L, "betfan")).toBe(277);
    expect(BETFAN_IDS[L]).toBe(277);
    expect(getBookmakerLeagueId(L, "totalbet")).toBe("3de58c0b-4015-42f6-88c8-38ae34897b82");
    // Betby lists League A and League B as two tournaments
    expect(betbyTournamentIds(L, "betters")).toEqual(["2707230903544983592", "2707230903544983600"]);
    expect(betbyTournamentIds(L, "lebull")).toEqual(["2707230903544983592", "2707230903544983600"]);
    // The Swarm scraper reads COMPETITION_IDS, not leagues.ts
    expect(getBookmakerLeagueId(L, "betcris")).toBe(27844);
    expect(BETCRIS_IDS[L]).toBe(27844);
    expect(BETCRIS_URLS[L]).toBe("https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/Europe/27844");
    expect(BETCRIS_REGIONS[L]).toBe("Europe");
    expect(getBookmakerLeagueId(L, "pzbuk")).toBe("1336");
    expect(PZBUK_IDS[L]).toBe("1336");
  });

  it("every one of the 14 bookmakers supports the league", () => {
    const all: PolishBookmaker[] = ["sts", "fortuna", "betclic", "superbet", "lvbet", "fuksiarz", "betfan", "forbet",
      "etoto", "totalbet", "betters", "lebull", "betcris", "pzbuk"];
    for (const bm of all) expect(getSupportedLeagues(bm), bm).toContain(L);
  });

  it("never maps the outright or specials categories found next to the league", () => {
    expect(getBookmakerLeagueId(L, "fuksiarz")).not.toContain("231641");
    expect(getBookmakerLeagueId(L, "etoto")).not.toBe(30639);
    expect(getBookmakerLeagueId(L, "betfan")).not.toBe(231);
    expect(getBookmakerLeagueId(L, "forbet")).not.toBe(63062);
  });

  it("TSDB metadata: league 4490, season 2026-2027, rounds 1-6", () =>
    expect(getTsdbLeagueMeta(L)).toEqual({ theSportsDbId: "4490", totalRounds: 6, season: "2026-2027", rounds: [1, 2, 3, 4, 5, 6] }));
});
