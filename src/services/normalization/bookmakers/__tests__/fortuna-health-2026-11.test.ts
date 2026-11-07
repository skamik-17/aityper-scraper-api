import { readFileSync } from "fs";
import { describe, it, expect, vi } from "vitest";
import { fortunaNormalizer } from "../fortuna-normalizer.js";
import { getCanonicalTeamName } from "../../../../utils/team-matcher.js";
import type {
  NormalizationContext,
  NormalizedMarketOutput,
  RawBookmakerMarket,
} from "../../types.js";

// Verbatim Fortuna parser output (NBSP kept) captured on 2026-11-06 for the
// health-check plan: docs/superpowers/plans/2026-11-06-scraper-recovery/fortuna.md.
interface FixtureGroup {
  ctx: NormalizationContext;
  markets: RawBookmakerMarket[];
}

const FIXTURE: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./fixtures/fortuna-health-2026-11.inputs.json", import.meta.url), "utf8")
);

function groupOf(group: string): FixtureGroup {
  const g = FIXTURE[group] as FixtureGroup | undefined;
  if (!g || typeof g !== "object" || !Array.isArray(g.markets)) {
    throw new Error(`fixture has no group "${group}"`);
  }
  return g;
}

function ctxOf(group: string): NormalizationContext {
  return groupOf(group).ctx;
}

function liveAll(group: string, id: string): RawBookmakerMarket[] {
  return groupOf(group).markets.filter((m) => m.bookmakerMarketId === `ufo:mtyp:${id}`);
}

function live(
  group: string,
  id: string,
  nameIncludes = ""
): { raw: RawBookmakerMarket; ctx: NormalizationContext } {
  const hits = liveAll(group, id).filter((m) => m.name.includes(nameIncludes));
  if (hits.length !== 1) {
    throw new Error(`${group} ${id} "${nameIncludes}": expected 1 market, found ${hits.length}`);
  }
  return { raw: hits[0], ctx: ctxOf(group) };
}

function run(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null {
  return fortunaNormalizer.normalizeMarket(structuredClone(raw), ctx);
}

function legs(out: NormalizedMarketOutput | null): string[] {
  return (out?.selections ?? []).map((s) => `${s.code}@${s.odds}`);
}

describe("Task 1: corners races never feed a 1X2 code", () => {
  it("arsenalHull 00-0p '1. połowa: więcej rzutów rożnych' is HALF_TIME_CORNERS_RACE", () => {
    const { raw, ctx } = live("arsenalHull", "00-0p");
    const out = run(raw, ctx);
    expect(out?.marketKey).toBe("HALF_TIME_CORNERS_RACE");
    expect(legs(out)).toEqual(["AWAY@5.2", "HOME@1.31", "DRAW@6.2"]);
  });
  it.each([
    ["manUtdVilla", ["HOME@1.85", "DRAW@5.2", "AWAY@2.6"], ["AWAY@3.45", "DRAW@2.38", "HOME@2.6"]],
    ["ipswichBournemouth", ["AWAY@1.95", "DRAW@4.8", "HOME@2.5"], ["AWAY@2.38", "DRAW@2.3", "HOME@4.1"]],
  ])("%s: the corners race and the real '1.połowa' never share HALF_TIME_RESULT", (group, race, ht) => {
    const a = run(live(group, "00-0p").raw, ctxOf(group));
    expect(a?.marketKey).toBe("HALF_TIME_CORNERS_RACE");
    expect(legs(a)).toEqual(race);
    const b = run(live(group, "00-2d").raw, ctxOf(group));
    expect(b?.marketKey).toBe("HALF_TIME_RESULT");
    expect(legs(b)).toEqual(ht);
  });
  it("arsenalHull 00-2d '1.połowa' stays HALF_TIME_RESULT", () => {
    expect(legs(run(live("arsenalHull", "00-2d").raw, ctxOf("arsenalHull")))).toEqual(["AWAY@12", "DRAW@2.95", "HOME@1.49"]);
  });
  it("arsenalHull 00-0e 'Mecz: wiecej rzutow roznych' stays CORNERS_RACE", () => {
    const out = run(live("arsenalHull", "00-0e").raw, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe("CORNERS_RACE");
    expect(legs(out)).toEqual(["AWAY@6.6", "DRAW@13", "HOME@1.14"]);
  });
  // synthetic (no live payload): the full-match and second-half shapes, and a plain MATCH_WINNER id
  const race = [{ name: "Hull", odds: 6.4 }, { name: "Arsenal", odds: 1.14 }, { name: "rowno", odds: 12 }];
  it.each(["00-0p", "00-60"])("%s 'Mecz: więcej rzutów rożnych' is CORNERS_RACE, never MATCH_WINNER", (id) => {
    const out = run({ bookmakerMarketId: `ufo:mtyp:${id}`, name: "Mecz: więcej rzutów rożnych", selections: race }, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe("CORNERS_RACE");
    expect(legs(out)).toEqual(["AWAY@6.4", "HOME@1.14", "DRAW@12"]);
  });
  it("00-0p '2. połowa: więcej rzutów rożnych' is SECOND_HALF_CORNERS_RACE", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-0p", name: "2. połowa: więcej rzutów rożnych",
      selections: [{ name: "Hull", odds: 4 }, { name: "Arsenal", odds: 1.4 }, { name: "Rowno", odds: 5.5 }] }, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe("SECOND_HALF_CORNERS_RACE");
    expect(legs(out)).toEqual(["AWAY@4", "HOME@1.4", "DRAW@5.5"]);
  });
  it("a plain 'Mecz' 1X2 under 00-60 stays MATCH_WINNER", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-60", name: "Mecz",
      selections: [{ name: "Arsenal", odds: 1.16 }, { name: "Remis", odds: 7.2 }, { name: "Hull", odds: 15.5 }] }, ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("MATCH_WINNER");
    expect(legs(out)).toEqual(["HOME@1.16", "DRAW@7.2", "AWAY@15.5"]);
  });

  // synthetic (no live payload): a corners race under the half-scoped 1X2 ids
  // (00-2d HALF_TIME_RESULT, 00-2w SECOND_HALF_RESULT) never feeds them either.
  const halfRace = [{ name: "Hull", odds: 5.2 }, { name: "Arsenal", odds: 1.31 }, { name: "Rowno", odds: 6.2 }];
  it.each([
    ["00-2d", "1. połowa: więcej rzutów rożnych", "HALF_TIME_CORNERS_RACE"],
    ["00-2w", "2. połowa: więcej rzutów rożnych", "SECOND_HALF_CORNERS_RACE"],
    // An explicit "Mecz:" scope is authoritative over the id's half.
    ["00-2d", "Mecz: więcej rzutów rożnych", "CORNERS_RACE"],
  ])("%s '%s' is %s, never a half 1X2", (id, name, key) => {
    const out = run({ bookmakerMarketId: `ufo:mtyp:${id}`, name, selections: halfRace }, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(["AWAY@5.2", "HOME@1.31", "DRAW@6.2"]);
  });
  // synthetic (no live payload): a race name without a scope prefix keeps the
  // scope of its id instead of being filed as the full-match race.
  it.each([
    ["00-2d", "HALF_TIME_CORNERS_RACE"],
    ["00-2w", "SECOND_HALF_CORNERS_RACE"],
    ["00-60", "CORNERS_RACE"],
  ])("%s unscoped 'więcej rzutów rożnych' is %s", (id, key) => {
    const out = run({ bookmakerMarketId: `ufo:mtyp:${id}`, name: "więcej rzutów rożnych", selections: halfRace }, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(["AWAY@5.2", "HOME@1.31", "DRAW@6.2"]);
  });
  // synthetic (no live payload): a handicap-style corners name under a 1X2 or
  // corners-race id is neither a 1X2 nor a race; it is dropped.
  it.each([
    ["00-60", "Mecz: liczba rzutów rożnych handicap"],
    ["00-0p", "1. połowa: więcej rzutów rożnych (0:1)"],
  ])("%s '%s' is dropped with a warning", (id, name) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = run({ bookmakerMarketId: `ufo:mtyp:${id}`, name,
        selections: [{ name: "Arsenal (0:1)", odds: 1.9 }, { name: "Remis (0:1)", odds: 3.4 }, { name: "Hull (0:1)", odds: 3.1 }] }, ctxOf("arsenalHull"));
      expect(out).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[fortuna] Corners handicap"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("Task 2: every player market carries its player", () => {
  // The 19 Forest–City rows that sit in 'base' today (00-76 red card and the unmapped 00-he/lj/ok/og/ev excluded).
  const MURILLO = ["00-hm", "00-la", "00-lg", "00-ld", "00-lf", "00-o6", "00-oi", "00-pn", "00-lk", "00-on",
                   "00-ne", "00-oe", "00-oy", "00-ow", "00-oz", "00-ng", "00-ln", "00-ox", "00-hh"];
  it.each(MURILLO)("forestCity single-name player row %s keys <code>:Murillo", (id) => {
    const out = run(live("forestCity", id, "Murillo").raw, ctxOf("forestCity"));
    expect(out?.paramValue).toBe("Murillo");
    expect(out?.marketKey).toBe(`${out?.marketCode}:Murillo`);
  });
  it.each([
    ["00-lf", "PLAYER_SHOTS:Murillo", ["1+@1.7", "2+@4.25"]],
    ["00-ne", "GOALSCORER_FIRST:Murillo", ["PLAYER@30"]],
    ["00-ox", "PLAYER_HEADER_GOAL:Murillo", ["PLAYER_NAME@30"]],
    ["00-hm", "PLAYER_GOAL_OR_ASSIST:Murillo", ["PLAYER@8.5"]],
  ])("forestCity Murillo %s -> %s with peer-shaped selections", (id, key, expected) => {
    const out = run(live("forestCity", id, "Murillo").raw, ctxOf("forestCity"));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(expected);
  });
  it.each([
    ["manUtdVilla", "00-ne", "Tielemans", "GOALSCORER_FIRST:Youri Tielemans", "PLAYER@12"],
    ["manUtdVilla", "00-nf", "McGinn", "GOALSCORER_FIRST:John McGinn", "PLAYER@9"],
    ["manUtdVilla", "00-nf", "Hemmings", "GOALSCORER_FIRST:George Lawrence Hemmings", "PLAYER@11"],
    ["forestCity", "00-nf", "Dias", "GOALSCORER_FIRST:Ruben Dias", "PLAYER@40"],
    ["evertonCoventry", "00-nf", "Thomas", "GOALSCORER_FIRST:Bobby Thomas", "PLAYER@30"],
    ["palaceLiverpool", "00-ne", "Nketiah", "GOALSCORER_FIRST:Eddie Nketiah", "PLAYER@5"],
  ])("%s %s %s: the team prefix never leaks into the player", (group, id, needle, key, leg) => {
    const out = run(live(group, id, needle).raw, ctxOf(group));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual([leg]);
  });
  it("a mononym behind a dotted prefix keeps its name (Man.City Rodri)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-nf", name: "Man.City Rodri strzeli pierwszego gola w meczu (OPTA)",
      selections: [{ name: "Tak", odds: 21 }] }, ctxOf("forestCity")); // synthetic: live prefix + live mononym shape
    expect(out?.marketKey).toBe("GOALSCORER_FIRST:Rodri");
    expect(legs(out)).toEqual(["PLAYER@21"]);
  });
  it.each([
    ["arsenalHull", "00-nf", "Herrington", "GOALSCORER_FIRST:Lucas Herrington"],
    ["forestCity", "00-lf", "Diomande", "PLAYER_SHOTS:Ousmane Diomande"],
    ["forestCity", "00-ne", "Diomande", "GOALSCORER_FIRST:Ousmane Diomande"],
    ["leedsTottenham", "00-nf", "Van de Ven", "GOALSCORER_FIRST:Micky Ven"],
    ["leedsTottenham", "00-nh", "Van de Ven", "GOALSCORER_LAST:Micky Ven"],
    ["brightonBrentford", "00-ne", "Loureiro", "GOALSCORER_FIRST:Joao Pedro Costa"],
  ])("%s %s %s keeps today's key %s", (group, id, needle, key) => {
    expect(run(live(group, id, needle).raw, ctxOf(group))?.marketKey).toBe(key);
  });
  it.each([
    // synthetic: the docstring shapes of extractFortunaPlayerName (WC and Ekstraklasa payloads)
    [{ homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" }, "00-nf", "Maroko Diop, Issa strzeli pierwszego gola w meczu (OPTA)", "Tak", "GOALSCORER_FIRST:Issa Diop"],
    [{ homeTeam: "Cape Verde", awayTeam: "Spain", league: "world-cup-2026" }, "00-ne", "W.Ziel.Przyl. Cabral, Jovane strzeli pierwszego gola w meczu (OPTA)", "Tak", "GOALSCORER_FIRST:Jovane Cabral"],
    [{ homeTeam: "Nottingham Forest", awayTeam: "Manchester City", league: "premier-league" }, "00-pn", "Youssef Belammari liczba spalonych w 1.połowie (OPTA)", "1+", "PLAYER_OFFSIDES_1H:Youssef Belammari"],
  ])("today's shape %#: %s keeps its key", (ctx, id, name, sel, key) => {
    expect(run({ bookmakerMarketId: `ufo:mtyp:${id}`, name, selections: [{ name: sel, odds: 3 }] }, ctx)?.marketKey).toBe(key);
  });
  it("a team name where the player should be yields no row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = run({ bookmakerMarketId: "ufo:mtyp:00-lf", name: "Nottingham - liczba strzałów (OPTA)",
        selections: [{ name: "1+", odds: 1.1 }] }, ctxOf("forestCity")); // synthetic
      expect(out).toBeNull();
      expect(warn.mock.calls.flat().join(" ")).toContain("Player market without extractable player");
    } finally {
      warn.mockRestore();
    }
  });
  it("PLAYER_RED_CARD rows keep today's shape (no param, player in the selection)", () => {
    expect(legs(run(live("forestCity", "00-76").raw, ctxOf("forestCity")))).toEqual(["Murillo wyrzucony z boiska@29"]);
    const wc = run({ bookmakerMarketId: "ufo:mtyp:00-76", name: "Dayot Upamecano wyrzucony z boiska",
      selections: [{ name: "Dayot Upamecano wyrzucony z boiska", odds: 29 }] }, { homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" }); // WC entry 1728
    expect(wc?.marketKey).toBe("PLAYER_RED_CARD");
    expect(legs(wc)).toEqual(["Dayot Upamecano wyrzucony z boiska@29"]);
  });
});

// Verbatim Fortuna parser output (NBSP kept) from read-only laliga, serie-a
// and ligue-1 captures of 2026-11-07, for the review of Task 2: team labels
// that are not token prefixes of the canonical name, and name shapes the
// null guard used to drop. See the fixture's "source" field.
interface LeagueGroup extends FixtureGroup {
  matchId: string;
  labels: [string, string];
}

const LEAGUE_FIXTURE: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./fixtures/fortuna-health-2026-11-leagues.inputs.json", import.meta.url), "utf8")
);

function leagueGroup(group: string): LeagueGroup {
  const g = LEAGUE_FIXTURE[group] as LeagueGroup | undefined;
  if (!g || typeof g !== "object" || !Array.isArray(g.markets)) {
    throw new Error(`league fixture has no group "${group}"`);
  }
  return g;
}

function leagueLive(group: string, id: string, nameIncludes: string): RawBookmakerMarket {
  const hits = leagueGroup(group).markets.filter(
    (m) => m.bookmakerMarketId === `ufo:mtyp:${id}` && m.name.includes(nameIncludes)
  );
  if (hits.length !== 1) {
    throw new Error(`${group} ${id} "${nameIncludes}": expected 1 market, found ${hits.length}`);
  }
  return hits[0];
}

function runLeague(group: string, id: string, nameIncludes: string): NormalizedMarketOutput | null {
  return run(leagueLive(group, id, nameIncludes), leagueGroup(group).ctx);
}

describe("Task 2 review: team labels and name shapes outside the Premier League", () => {
  const GROUPS = [
    "atlBarcelona", "espanyolCoruna", "valenciaRealMadrid", "romaSassuolo", "genoaMilan",
    "monzaAtalanta", "leMansMonaco", "leHavreLorient", "angersNice", "auxerreParisFC",
  ];
  it.each(GROUPS)("%s: the fixture context is what the scraper derives from Fortuna's labels", (group) => {
    const { labels, ctx } = leagueGroup(group);
    expect([getCanonicalTeamName(labels[0], ctx.league), getCanonicalTeamName(labels[1], ctx.league)])
      .toEqual([ctx.homeTeam, ctx.awayTeam]);
  });

  it.each([
    // exact alias ("Atl. Madryt" -> Atletico Madrid; "Madryt" is no prefix of "Madrid")
    ["atlBarcelona", "00-ne", "Lookman", "GOALSCORER_FIRST:Ademola Lookman", "PLAYER@5"],
    ["atlBarcelona", "00-ne", "Koke", "GOALSCORER_FIRST:Koke", "PLAYER@25"],
    ["atlBarcelona", "00-ne", "Le Normand", "GOALSCORER_FIRST:Robin Le Normand", "PLAYER@35"],
    ["romaSassuolo", "00-ne", "Soule", "GOALSCORER_FIRST:Matias Soule", "PLAYER@5"],
    ["romaSassuolo", "00-ne", "Lulli", "GOALSCORER_FIRST:Emanuele Lulli", "PLAYER@16"],
    // short token equal to a whole team token ("A", "AC", "Le", "FC")
    ["espanyolCoruna", "00-nf", "Jensen", "GOALSCORER_FIRST:Jonathan Asp Jensen", "PLAYER@6"],
    ["espanyolCoruna", "00-nf", "Villares", "GOALSCORER_FIRST:Diego Villares Yanez", "PLAYER@15"],
    ["espanyolCoruna", "00-nf", "Angelino", "GOALSCORER_FIRST:Angelino", "PLAYER@30"],
    ["genoaMilan", "00-nf", "Modric", "GOALSCORER_FIRST:Luka Modric", "PLAYER@15"],
    ["leMansMonaco", "00-ne", "Vercruysse", "GOALSCORER_FIRST:Jean Vercruysse", "PLAYER@14"],
    ["leHavreLorient", "00-ne", "Nakamura", "GOALSCORER_FIRST:Sota Nakamura", "PLAYER@7"],
    ["auxerreParisFC", "00-nf", "Lees Melou", "GOALSCORER_FIRST:Pierre Lees Melou", "PLAYER@14"],
    // dotted abbreviation of any length ("Real M." for Real Madrid), mononym behind it
    ["valenciaRealMadrid", "00-nf", "Endrick", "GOALSCORER_FIRST:Endrick", "PLAYER@5"],
  ])("%s %s %s: the team label never leaks into the player (%s)", (group, id, needle, key, leg) => {
    const out = runLeague(group, id, needle);
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual([leg]);
  });

  it("the Real M. mononym lands on the same key as his own dash-form markets", () => {
    expect(runLeague("valenciaRealMadrid", "00-lg", "Endrick")?.marketKey).toBe("PLAYER_FOULS:Endrick");
  });

  it("a comma name behind a dotted label keeps today's key (Real M. Alexander-Arnold)", () => {
    expect(runLeague("valenciaRealMadrid", "00-nf", "Alexander-Arnold")?.marketKey)
      .toBe("GOALSCORER_FIRST:Trent Alexander-Arnold");
  });

  it.each([
    ["00-lf", "- liczba strzałów", "PLAYER_SHOTS:Aaron Ndive Mayol de la Cueva", ["2+@6", "1+@2"]],
    ["00-pn", "liczba spalonych", "PLAYER_OFFSIDES_1H:Aaron Ndive Mayol de la Cueva", ["1+@13"]],
    ["00-la", "asystuje", "PLAYER_ASSISTS:Aaron Ndive Mayol de la Cueva", ["1+@10"]],
    ["00-ne", "Valencia", "GOALSCORER_FIRST:Aaron Ndive Mayol de la Cueva", ["PLAYER@20"]],
  ])("lowercase particles in a no-comma name: valenciaRealMadrid %s (%s) -> %s", (id, needle, key, expected) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = runLeague("valenciaRealMadrid", id, needle);
      expect(out?.marketKey).toBe(key);
      expect(legs(out)).toEqual(expected);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    // "Van" fuzzy-resolves to Angers; only an exact alias or a strict prefix may strip a token
    ["00-oe", "Van den Boomen", "PLAYER_SHOTS_IN_BOX:Branco Van den Boomen", ["2+@5", "1+@1.82"]],
    ["00-pn", "Van den Boomen", "PLAYER_OFFSIDES_1H:Branco Van den Boomen", ["1+@15"]],
    ["00-lf", "Van den Boomen", "PLAYER_SHOTS:Branco Van den Boomen", ["1+@1.24", "2+@2.2", "3+@4.75"]],
    // backtick apostrophe in the count form
    ["00-oe", "N`Goumou", "PLAYER_SHOTS_IN_BOX:Nathan N'Goumou", ["1+@1.42", "2+@3"]],
    ["00-pn", "N`Goumou", "PLAYER_OFFSIDES_1H:Nathan N'Goumou", ["1+@3.8"]],
    ["00-lf", "N`Goumou", "PLAYER_SHOTS:Nathan N'Goumou", ["2+@2.2", "3+@4.5", "1+@1.24"]],
    ["00-nf", "N`Goumou", "GOALSCORER_FIRST:Nathan N'Goumou", ["PLAYER@6.5"]],
  ])("angersNice %s %s -> %s", (id, needle, key, expected) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = runLeague("angersNice", id, needle);
      expect(out?.marketKey).toBe(key);
      expect(legs(out)).toEqual(expected);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("a particle surname in the verb form keeps today's key (verbMatch stays unanchored, D4)", () => {
    expect(runLeague("angersNice", "00-ox", "Van den Boomen")?.marketKey).toBe("PLAYER_HEADER_GOAL:Branco Boomen");
  });

  it.each([
    ["atlBarcelona", "00-70", "Pablo Barrios", "PLAYER_GOAL_AND_RESULT:Pablo Barrios", "HOME@10"],
    ["monzaAtalanta", "00-70", "Krstovic", "PLAYER_GOAL_AND_RESULT:Nikola Krstovic", "AWAY@3.3"],
  ])("%s parlay %s %s resolves its winning side", (group, id, needle, key, leg) => {
    const out = runLeague(group, id, needle);
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual([leg]);
  });

  it.each([
    // synthetic: a lone short token or a lone initial has no anchor and is never a team label
    [{ homeTeam: "Le Havre", awayTeam: "Lorient", league: "ligue-1" }, "00-lf", "Le Fée, Enzo - liczba strzałów (OPTA)", "PLAYER_SHOTS:Enzo Le Fee"],
    [{ homeTeam: "Valencia", awayTeam: "Real Madrid", league: "laliga" }, "00-lf", "M. Endrick - liczba strzałów (OPTA)", "PLAYER_SHOTS:M. Endrick"],
    // synthetic: a first name that is a whole token of the team name survives a 2-token label
    [{ homeTeam: "Genoa", awayTeam: "AC Milan", league: "serie-a" }, "00-nf", "AC Milan Milan Badelj strzeli pierwszego gola w meczu (OPTA)", "GOALSCORER_FIRST:Milan Badelj"],
  ])("guard %#: %s keeps its player", (ctx, id, name, key) => {
    expect(run({ bookmakerMarketId: `ufo:mtyp:${id}`, name, selections: [{ name: "1+", odds: 3 }] }, ctx)?.marketKey).toBe(key);
  });
});

describe("Task 3: new market types (00-bt and 00-bu held back)", () => {
  it.each([
    ["00-9a", "Mecz: rzut karny", "PENALTY_AWARDED", ["NO@1.29", "YES@3.35"]],
    ["00-bv", "Mecz: gol samobójczy", "OWN_GOAL", ["NO@1.05", "YES@8"]],
    ["00-k7", "Mecz: gol zdobyty strzałem głową", "HEADER_GOAL", ["NO@1.45", "YES@2.6"]],
  ])("arsenalHull %s %s -> %s", (id, _name, key, expected) => {
    const out = run(live("arsenalHull", id).raw, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(expected);
  });
  it("arsenalHull 00-k6 'Mecz: liczba asyst w meczu' -> one ASSISTS_TOTAL key per line", () => {
    const outs = liveAll("arsenalHull", "00-k6").map((raw) => run(raw, ctxOf("arsenalHull")));
    expect(outs.map((o) => o?.marketKey).sort()).toEqual(["ASSISTS_TOTAL:1.5", "ASSISTS_TOTAL:2.5"]);
    expect(outs.map(legs)).toEqual(expect.arrayContaining([["OVER@2.3", "UNDER@1.56"], ["OVER@1.18", "UNDER@4.4"]]));
  });
  it.each([
    // settlement differs from the peers' PENALTY_OR_RED_CARD (open question 1)
    ["00-bu", "Mecz: rzut karny lub czerwona kartka"],
    // settlement unverified; YES 12 sits 15-29% above every peer (review of Task 3)
    ["00-bt", "Mecz: rzut karny i czerwona kartka"],
  ])("arsenalHull %s '%s' stays unmapped", (id, name) => {
    const { raw, ctx } = live("arsenalHull", id);
    expect(raw.name.startsWith(name)).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(run(raw, ctx)).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[fortuna] Unknown market"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`(id: ufo:mtyp:${id})`));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("Task 4: pre-existing ids with catalog codes (00-07 and 00-08 held back)", () => {
  // A held-back id falls through to the name lookup, finds nothing and is logged as unknown.
  function expectUnknownMarket(raw: RawBookmakerMarket, ctx: NormalizationContext, id: string): void {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(run(raw, ctx)).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[fortuna] Unknown market"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`(id: ufo:mtyp:${id})`));
    } finally {
      warn.mockRestore();
    }
  }
  it.each([
    ["arsenalHull", "00-2n", "HALF_TIME_BTTS", ["NO@1.12", "YES@5.4"]],
    ["arsenalHull", "00-1h", "HOME_WIN_TO_NIL", ["YES@1.65", "NO@2.02"]],
    ["arsenalHull", "00-1i", "AWAY_WIN_TO_NIL", ["YES@9.4", "NO@1.01"]],
    ["arsenalHull", "00-1o", "HOME_WIN_BOTH_HALVES", ["YES@2.18", "NO@1.61"]],
    ["forestCity", "00-1p", "AWAY_WIN_BOTH_HALVES", ["YES@4.2", "NO@1.18"]],
    ["arsenalHull", "00-2b", "HOME_SCORE_BOTH_HALVES", ["NO@1.99", "YES@1.73"]],
    ["arsenalHull", "00-2c", "AWAY_SCORE_BOTH_HALVES", ["YES@9.6", "NO@1.02"]],
    ["arsenalHull", "00-1r", "HOME_WIN_AT_LEAST_ONE_HALF", ["YES@1.09", "NO@6"]],
    ["arsenalHull", "00-1s", "AWAY_WIN_AT_LEAST_ONE_HALF", ["NO@1.12", "YES@5.4"]],
    ["arsenalHull", "00-0c", "HALF_TIME_RED_CARD_TEAM:HOME", ["NO@1.01", "YES@12"]],
    ["arsenalHull", "00-0d", "HALF_TIME_RED_CARD_TEAM:AWAY", ["YES@12", "NO@1.01"]],
    ["arsenalHull", "00-0a", "HALF_TIME_RED_CARD", ["NO@1.01", "YES@11"]],
    ["forestCity", "00-0f", "FIRST_CORNER", ["HOME@2.21", "AWAY@1.59"]],
    ["arsenalHull", "00-19", "ODD_EVEN_GOALS", ["EVEN@1.91", "ODD@1.9"]],
    ["arsenalHull", "00-09", "WINNING_MARGIN",
      ["AWAY_BY_3PLUS@100", "DRAW@7", "HOME_BY_2@3.7", "HOME_BY_3PLUS@2.24", "AWAY_BY_1@20", "AWAY_BY_2@90", "HOME_BY_1@4"]],
  ])("%s %s -> %s", (group, id, key, expected) => {
    const out = run(live(group, id).raw, ctxOf(group));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(expected);
  });
  it("FIRST_CORNER drops 'Nikt' before team matching (the fuzzy matcher resolves 'Nikt' to Leeds United)", () => {
    // Verbatim from the 2026-11-07 PL capture (Leeds United vs Tottenham Hotspur); this id is not in the fixture.
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-0f", name: "Mecz:\u00a01.rzut rożny",
      selections: [{ name: "Leeds", odds: 1.89 }, { name: "Nikt", odds: 100 }, { name: "Tottenham", odds: 1.82 }] }, ctxOf("leedsTottenham"));
    expect(out?.marketKey).toBe("FIRST_CORNER");
    expect(legs(out)).toEqual(["HOME@1.89", "AWAY@1.82"]);
  });
  it("a pair id follows the team named in its label (00-1h quoting Hull -> AWAY_WIN_TO_NIL)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-1h", name: "Mecz:\u00a0Hull\u00a0- wygra do zera",
      selections: [{ name: "Tak", odds: 9.2 }, { name: "Nie", odds: 1.01 }] }, ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("AWAY_WIN_TO_NIL");
    expect(legs(out)).toEqual(["YES@9.2", "NO@1.01"]);
  });
  it.each([
    // RED_CARD_TEAM is held back (review of Task 4): no owner decision covers the
    // "(bez CK dla trenera i sztabu)" settlement, and YES sits 5-18% above the peer
    // median on every PL full-offer match of 2026-11-07.
    ["00-07", "Mecz:\u00a0Arsenal\u00a0- Czerwona Kartka (bez CK dla trenera i sztabu)"],
    ["00-08", "Mecz:\u00a0Hull\u00a0- Czerwona Kartka (bez CK dla trenera i sztabu)"],
  ])("arsenalHull %s (team red card) stays unmapped", (id, name) => {
    const { raw, ctx } = live("arsenalHull", id);
    expect(raw.name).toBe(name);
    expectUnknownMarket(raw, ctx, id);
  });
  it("a red-card team id quoting the other team stays unmapped too (00-07 quoting Hull)", () => {
    expectUnknownMarket({ bookmakerMarketId: "ufo:mtyp:00-07", name: "Mecz:\u00a0Hull\u00a0- Czerwona Kartka (bez CK dla trenera i sztabu)",
      selections: [{ name: "Nie", odds: 1.06 }, { name: "Tak", odds: 8.2 }] }, ctxOf("arsenalHull"), "00-07"); // synthetic
  });
  it("a placeholder red-card team name stays unmapped too (00-08)", () => {
    expectUnknownMarket({ bookmakerMarketId: "ufo:mtyp:00-08", name: "Rynek ufo:mtyp:00-08",
      selections: [{ name: "Nie", odds: 1.06 }, { name: "Tak", odds: 8.2 }] }, ctxOf("arsenalHull"), "00-08"); // synthetic
  });
  it("a half-time red-card team id follows the team named in its label (00-0c quoting Hull -> HALF_TIME_RED_CARD_TEAM:AWAY)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-0c", name: "1.połowa: Hull\u00a0- Czerwona Kartka (bez CK dla trenera i sztabu)",
      selections: [{ name: "Nie", odds: 1.01 }, { name: "Tak", odds: 12 }] }, ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("HALF_TIME_RED_CARD_TEAM:AWAY");
    expect(legs(out)).toEqual(["NO@1.01", "YES@12"]);
  });
  it("a placeholder name is never team-matched: the half-time red-card team side comes from the id (00-0d -> AWAY)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-0d", name: "Rynek ufo:mtyp:00-0d",
      selections: [{ name: "Tak", odds: 12 }, { name: "Nie", odds: 1.01 }] }, ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("HALF_TIME_RED_CARD_TEAM:AWAY");
    expect(legs(out)).toEqual(["YES@12", "NO@1.01"]);
  });
  it("WINNING_MARGIN drops a leg it cannot resolve instead of emitting UNKNOWN", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-09", name: "Mecz: wynik/różnica zwycięstwa",
      selections: [{ name: "Arsenal/o 1 gol", odds: 4 }, { name: "Remis", odds: 7 }, { name: "Inny wynik", odds: 50 }] }, ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("WINNING_MARGIN");
    expect(legs(out)).toEqual(["HOME_BY_1@4", "DRAW@7"]);
  });
  it("WINNING_MARGIN with an 'o 4 gole' leg is dropped: 'o 3 gole' would then mean exactly 3, not 3+", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = run({ bookmakerMarketId: "ufo:mtyp:00-09", name: "Mecz: wynik/różnica zwycięstwa",
        selections: [{ name: "Arsenal/o 1 gol", odds: 4 }, { name: "Arsenal/o 3 gole", odds: 4.6 }, { name: "Arsenal/o 4 gole", odds: 5.5 }, { name: "Remis", odds: 7 }] }, ctxOf("arsenalHull")); // synthetic
      expect(out).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[fortuna] WINNING_MARGIN"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("Task 5: exact-goals markets", () => {
  it.each([
    ["00-16", "HOME_EXACT_GOALS", ["2@3.55", "3+@1.85", "1@4.7", "0@12"]],
    ["00-17", "AWAY_EXACT_GOALS", ["0@1.54", "1@2.8", "3+@50", "2@10"]],
    ["00-3e", "SECOND_HALF_EXACT_GOALS", ["0@4.9", "1@2.95", "2+@1.81"]],
  ])("arsenalHull %s with today's parser labels -> %s", (id, key, expected) => {
    const out = run(live("arsenalHull", id).raw, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(expected);
  });
  it("digit labels from the fixed parser give the same codes (00-16)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-16", name: "Arsenal dokładna liczba goli",
      selections: [{ name: "2", odds: 3.55 }, { name: "3+", odds: 1.85 }, { name: "1", odds: 4.7 }, { name: "0", odds: 12 }] },
      ctxOf("arsenalHull")); // synthetic: raw-exact-goals-arsenal-hull.json after the Task 5 parser
    expect(out?.marketKey).toBe("HOME_EXACT_GOALS");
    expect(legs(out)).toEqual(["2@3.55", "3+@1.85", "1@4.7", "0@12"]);
  });
  it("a pair id follows the team named in its label (00-16 quoting Hull -> AWAY_EXACT_GOALS)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-16", name: "Hull dokładna liczba goli",
      selections: [{ name: "0", odds: 1.55 }, { name: "1", odds: 2.8 }, { name: "3+", odds: 50 }, { name: "2", odds: 10 }] },
      ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("AWAY_EXACT_GOALS");
    expect(legs(out)).toEqual(["0@1.55", "1@2.8", "3+@50", "2@10"]);
  });
  it("a legacy label that translates outside the half's 0/1/2+ book is dropped (an away label would be '2')", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-3e", name: "2.połowa: dokładna liczba goli",
      selections: [{ name: "Remis", odds: 4.9 }, { name: "Arsenal", odds: 2.95 }, { name: "Hull", odds: 9 }, { name: "2+", odds: 1.81 }] },
      ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("SECOND_HALF_EXACT_GOALS");
    expect(legs(out)).toEqual(["0@4.9", "1@2.95", "2+@1.81"]);
  });
  it("a digit label outside the vocabulary is dropped, never read as a 1X2 code ('3' is not a draw)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-3e", name: "2.połowa: dokładna liczba goli",
      selections: [{ name: "0", odds: 4.9 }, { name: "1", odds: 2.95 }, { name: "2", odds: 4.2 }, { name: "3", odds: 9 }] },
      ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("SECOND_HALF_EXACT_GOALS");
    expect(legs(out)).toEqual(["0@4.9", "1@2.95"]);
  });
});
