import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEventDetail } from "../../../../scrapers/bookmakers/totalbet/grid-parser.js";
import { resolveStorageMarketKey } from "../../../../repositories/full-offer-repository.js";
import { normalizer } from "../../index.js";
import type { NormalizedMarketOutput } from "../../types.js";
import {
  TOTALBET_MARKET_KEY_TO_CODE,
  europeanLineFromScore,
  resolveSide,
  totalbetNormalizer,
} from "../totalbet-normalizer.js";

const load = (n: string) =>
  JSON.parse(readFileSync(new URL(`../../../../scrapers/bookmakers/totalbet/__tests__/fixtures/${n}`, import.meta.url), "utf8"));

const ctx = { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league", leagueName: "premier-league" };
const run = (fixture: string, c = ctx) =>
  parseEventDetail(load(fixture).data.event).map((m) => ({
    m,
    o: totalbetNormalizer.normalizeMarket(
      { bookmakerMarketId: m.bookmakerMarketId, name: m.name, paramValue: m.paramValue, selections: m.selections },
      c,
    ),
  }));
const outs = run("event-detail-leeds-tottenham.trimmed.json");
const byKey = (key: string, rows = outs) =>
  Object.fromEntries(rows.find(({ o }) => o?.marketKey === key)!.o!.selections.map((s) => [s.code, s.odds]));

afterEach(() => vi.restoreAllMocks());

describe("totalbet normalizer (plan contract)", () => {
  it.each([
    ["MATCH_WINNER", { HOME: 2.8, DRAW: 3.35, AWAY: 2.47 }],
    ["DOUBLE_CHANCE", { HOME_OR_DRAW: 1.5, HOME_OR_AWAY: 1.33, DRAW_OR_AWAY: 1.42 }],
    ["HALF_TIME_DOUBLE_CHANCE", { HOME_OR_DRAW: 1.31, HOME_OR_AWAY: 1.57, DRAW_OR_AWAY: 1.28 }],
    ["SECOND_HALF_DOUBLE_CHANCE", { HOME_OR_DRAW: 1.37, HOME_OR_AWAY: 1.43, DRAW_OR_AWAY: 1.33 }],
    ["BTTS", { YES: 1.71, NO: 2.03 }],
    ["HALF_TIME_BTTS", { YES: 4.15, NO: 1.19 }],
    ["SECOND_HALF_BTTS", { YES: 3.25, NO: 1.29 }],
    ["DRAW_NO_BET", { HOME: 1.95, AWAY: 1.77 }],
    ["HALF_TIME_DRAW_NO_BET", { HOME: 1.91, AWAY: 1.77 }],
    ["SECOND_HALF_DRAW_NO_BET", { HOME: 1.9, AWAY: 1.77 }],
    ["HALF_TIME_RESULT", { HOME: 3.37, DRAW: 2.16, AWAY: 3.1 }],
    ["SECOND_HALF_RESULT", { HOME: 3.02, DRAW: 2.54, AWAY: 2.81 }],
    ["ODD_EVEN_GOALS", { ODD: 1.92, EVEN: 1.79 }],
    ["HALF_TIME_ODD_EVEN_GOALS", { ODD: 2.02, EVEN: 1.65 }],
    ["SECOND_HALF_ODD_EVEN_GOALS", { ODD: 1.91, EVEN: 1.73 }],
    ["TOTAL_GOALS:2.5", { UNDER: 1.82, OVER: 1.89 }],
    ["TOTAL_GOALS:0.5", { UNDER: 7.8, OVER: 1.05 }],
    ["HALF_TIME_TOTAL_GOALS:0.5", { UNDER: 2.79, OVER: 1.39 }],
    ["HOME_TEAM_TOTAL_GOALS:0.5", { UNDER: 3.15, OVER: 1.31 }],
    ["AWAY_TEAM_TOTAL_GOALS:0.5", { UNDER: 3.37, OVER: 1.28 }],
    ["HOME_TEAM_TO_SCORE", { YES: 1.31, NO: 3.15 }],
    ["AWAY_TEAM_TO_SCORE", { YES: 1.28, NO: 3.37 }],
    ["HALF_TIME_HOME_TO_SCORE", { YES: 2.08, NO: 1.61 }],
    ["HALF_TIME_AWAY_TO_SCORE", { YES: 2.0, NO: 1.67 }],
    ["SECOND_HALF_HOME_TO_SCORE", { YES: 1.79, NO: 1.85 }],
    ["SECOND_HALF_AWAY_TO_SCORE", { YES: 1.73, NO: 1.92 }],
    ["ASIAN_HANDICAP:-1.5", { HOME: 5.2, AWAY: 1.13 }],
    ["ASIAN_HANDICAP:+0.5", { HOME: 1.51, AWAY: 2.4 }],
    ["EUROPEAN_HANDICAP:+1", { HOME: 1.5, DRAW: 4.3, AWAY: 4.95 }],
    ["EUROPEAN_HANDICAP:-2", { HOME: 14, DRAW: 7.4, AWAY: 1.12 }],
  ])("totalbet maps %s with the captured Leeds-Tottenham odds", (key, expected) => expect(byKey(key)).toEqual(expected));

  it("totalbet maps correct-score grids", () => {
    expect(byKey("CORRECT_SCORE")).toMatchObject({ "1-0": 8.25, "0-0": 9, "0-1": 7.6 });
    expect(Object.keys(byKey("CORRECT_SCORE"))).toHaveLength(28);
    expect(byKey("HALF_TIME_CORRECT_SCORE")).toMatchObject({ OTHER: 18, "1-0": 4.85 });
  });

  it("totalbet maps exactly the 81 phase-1 markets with zero UNKNOWN", () => {
    const mapped = outs.filter(({ o }) => o && o.marketCode !== "OTHER");
    expect(mapped).toHaveLength(81);
    expect(new Set(mapped.map(({ o }) => o!.marketCode)).size).toBe(39);
    expect(mapped.flatMap(({ o }) => o!.selections).filter((s) => s.code === "UNKNOWN")).toEqual([]);
  });

  it("totalbet keeps negative controls OTHER", () => {
    const others = outs.filter(({ o }) => o?.marketCode === "OTHER").map(({ m }) => m.name);
    expect(others).toHaveLength(21);
    expect(new Set(others)).toEqual(
      new Set([
        "Suma rzutów rożnych",
        "Suma kartek",
        "Rzuty rożne - Handicap",
        "Zawodnik strzeli gola",
        "Wygra do zera - Leeds",
        "Wygra do zera - Tottenham",
        "Wynik + Total (suma)",
        "Strzeli 1 gola - Cały mecz",
        "Strzeli 1 gola - 1. Połowa",
        "Strzeli 1 gola - 2. Połowa",
        "Podwójna szansa + suma goli",
      ]),
    );
  });

  it("totalbet keeps the line on OTHER line markets", () => {
    expect(
      totalbetNormalizer.normalizeMarket(
        {
          bookmakerMarketId: "slug:suma_rzutaw_roanych",
          name: "Suma rzutów rożnych",
          paramValue: "8.5",
          selections: [
            { name: "poniżej 8.5", odds: 2.53 },
            { name: "powyżej 8.5", odds: 1.46 },
          ],
        },
        ctx,
      ),
    ).toMatchObject({ marketCode: "OTHER", marketKey: "OTHER", paramValue: "8.5" });
    // the 5 corner-total lines (7.5..11.5) must stay 5 storage rows on the production path
    const corners = parseEventDetail(load("event-detail-leeds-tottenham.trimmed.json").data.event).filter(
      (m) => m.bookmakerMarketId === "slug:suma_rzutaw_roanych",
    );
    const keys = corners.map((m) => {
      const n = normalizer.normalize(m, "totalbet", "Leeds United", "Tottenham Hotspur", "premier-league");
      return resolveStorageMarketKey({ ...m, paramValue: n.paramValue }, n.marketKey);
    });
    expect(new Set(keys).size).toBe(5);
  });

  it("totalbet ignores legacy numeric ids", () => {
    const sel = [
      { name: "1X", odds: 1.5 },
      { name: "X2", odds: 1.4 },
    ];
    expect(totalbetNormalizer.normalizeMarket({ bookmakerMarketId: 10, name: "Podwójna szansa", selections: sel }, ctx)!.marketCode).toBe("OTHER");
    expect(totalbetNormalizer.normalizeMarket({ bookmakerMarketId: "8", name: "Strzeli 1 gola", selections: sel }, ctx)!.marketCode).toBe("OTHER");
  });

  it("totalbet returns null for a parameterized market without a valid line", () =>
    expect(
      totalbetNormalizer.normalizeMarket(
        { bookmakerMarketId: "slug:suma", name: "Total (suma)", selections: [{ name: "powyżej 2.5", odds: 1.89 }] },
        ctx,
      ),
    ).toBeNull());

  it("totalbet cross-checks team-to-score against the team total", () =>
    expect(byKey("HOME_TEAM_TO_SCORE").YES).toBe(byKey("HOME_TEAM_TOTAL_GOALS:0.5").OVER));

  it("totalbet orients half-time team-to-score like the half totals", () => {
    // Leeds-Tottenham: within 5 % of the same team's 0.5 OVER (2.08 vs 2.13, 1.79 vs 1.82)
    expect(Math.abs(byKey("HALF_TIME_HOME_TO_SCORE").YES - byKey("HALF_TIME_HOME_TEAM_TOTAL_GOALS:0.5").OVER) / 2.13).toBeLessThan(0.05);
    expect(Math.abs(byKey("SECOND_HALF_HOME_TO_SCORE").YES - byKey("SECOND_HALF_HOME_TEAM_TOTAL_GOALS:0.5").OVER) / 1.82).toBeLessThan(0.05);
    // Everton-Coventry is unbalanced, so a home/away swap would be obvious: HT home YES 1.63 vs own 0.5 OVER 1.65 vs other 2.60
    const ev = run("event-detail-everton-coventry.orientation.json", { ...ctx, homeTeam: "Everton", awayTeam: "Coventry City" });
    expect(byKey("HALF_TIME_HOME_TO_SCORE", ev)).toEqual({ YES: 1.63, NO: 2.06 });
    expect(byKey("SECOND_HALF_AWAY_TO_SCORE", ev)).toEqual({ YES: 2.15, NO: 1.57 });
    for (const [ts, tt] of [
      ["HALF_TIME_%_TO_SCORE", "HALF_TIME_%_TEAM_TOTAL_GOALS:0.5"],
      ["SECOND_HALF_%_TO_SCORE", "SECOND_HALF_%_TEAM_TOTAL_GOALS:0.5"],
      ["%_TEAM_TO_SCORE", "%_TEAM_TOTAL_GOALS:0.5"],
    ])
      for (const [own, other] of [
        ["HOME", "AWAY"],
        ["AWAY", "HOME"],
      ]) {
        const yes = byKey(ts.replace("%", own), ev).YES;
        expect(Math.abs(yes - byKey(tt.replace("%", own), ev).OVER)).toBeLessThan(Math.abs(yes - byKey(tt.replace("%", other), ev).OVER));
      }
  });

  it("totalbet survives the factory path without groupName", () => {
    const ms = parseEventDetail(load("event-detail-leeds-tottenham.trimmed.json").data.event);
    const dc = normalizer.normalize(ms.find((m) => m.bookmakerMarketId === "mid:10")!, "totalbet", "Leeds United", "Tottenham Hotspur", "premier-league");
    expect(dc.normalizedType).toBe("DOUBLE_CHANCE");
    expect(
      normalizer.normalize(
        ms.find((m) => m.bookmakerMarketId === "slug:suma" && m.paramValue === "2.5")!,
        "totalbet",
        "Leeds United",
        "Tottenham Hotspur",
        "premier-league",
      ).marketKey,
    ).toBe("TOTAL_GOALS:2.5");
  });

  it("totalbet resolves sides without the fuzzy fallback", () => {
    expect(resolveSide("nikt", ctx)).toBe("NONE");
    expect(resolveSide("Leeds (-1.5)", ctx)).toBe("HOME");
    const cpOuts = run("event-detail-crystal-palace-liverpool.core.json", { ...ctx, homeTeam: "Crystal Palace", awayTeam: "Liverpool" });
    expect(byKey("DOUBLE_CHANCE", cpOuts)).toEqual({ HOME_OR_DRAW: 2.28, HOME_OR_AWAY: 1.21, DRAW_OR_AWAY: 1.16 });
    expect(byKey("ASIAN_HANDICAP:-0.5", cpOuts)).toEqual({ HOME: 4.65, AWAY: 1.16 });
    expect(byKey("HOME_TEAM_TO_SCORE", cpOuts).YES).toBe(byKey("HOME_TEAM_TOTAL_GOALS:0.5", cpOuts).OVER); // 1.46
    const laliga = { homeTeam: "Atletico Madrid", awayTeam: "Real Madrid", league: "laliga" };
    expect([resolveSide("Atletico Madryt", laliga), resolveSide("Real Madryt", laliga)]).toEqual(["HOME", "AWAY"]);
    // getCanonicalTeamName fuzzy-maps these tokens to the context team; the prefix guard must reject them
    expect(resolveSide("nie", { homeTeam: "Sunderland", awayTeam: "Chelsea", league: "premier-league" })).toBe("UNKNOWN");
    expect(resolveSide("gol", { homeTeam: "Liverpool", awayTeam: "Manchester United", league: "premier-league" })).toBe("UNKNOWN");
    expect(resolveSide("(-1.5)", ctx)).toBe("UNKNOWN");
  });

  it("totalbet europeanLineFromScore converts virtual scores", () =>
    expect(["1:0", "0:2", "0:0", "x"].map(europeanLineFromScore)).toEqual(["+1", "-2", "0", undefined]));

  it("totalbet is silent for OTHER markets", () => {
    // Preflight ruling T3(c): "no console output" covers log, warn and error.
    const spies = (["log", "warn", "error"] as const).map((level) => vi.spyOn(console, level));
    run("event-detail-leeds-tottenham.trimmed.json");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("totalbet normalizer (integrity guards)", () => {
  const toScore = (bookmakerMarketId: string, name: string) =>
    totalbetNormalizer.normalizeMarket(
      {
        bookmakerMarketId,
        name,
        selections: [
          { name: "nie", odds: 3.15 },
          { name: "tak", odds: 1.31 },
        ],
      },
      ctx,
    );

  it("totalbet drops a team-to-score column whose header names the other team", () => {
    // Preflight ruling T3(d): the UOF ids 31/32/76/77/96/97 mean "clean sheet", so the
    // column's team label decides the side; a disagreement is dropped, never re-sided.
    expect(toScore("mid:32", "Strzeli gola - Tottenham")).toBeNull();
    expect(toScore("mid:31", "Strzeli gola - Leeds")).toBeNull();
    expect(toScore("mid:77", "1. połowa - Strzeli gola - Tottenham")).toBeNull();
    expect(toScore("mid:96", "2. połowa - Strzeli gola - Leeds")).toBeNull();
    expect(toScore("mid:32", "Strzeli gola")).toBeNull();
    expect(toScore("mid:32", "Strzeli gola - Leeds")).toMatchObject({ marketKey: "HOME_TEAM_TO_SCORE" });
    expect(toScore("mid:96", "2. połowa - Strzeli gola - Tottenham")).toMatchObject({ marketKey: "SECOND_HALF_AWAY_TO_SCORE" });
  });

  it("totalbet never resolves a label that names both teams or no team context", () => {
    const raw = { homeTeam: "Leeds", awayTeam: "Tottenham", league: "premier-league" };
    expect(resolveSide("Leeds lub Tottenham", raw)).toBe("UNKNOWN");
    expect(resolveSide("Leeds", { homeTeam: "", awayTeam: "", league: "premier-league" })).toBe("UNKNOWN");
    expect(resolveSide("", ctx)).toBe("UNKNOWN");
    expect(resolveSide("Lee", ctx)).toBe("HOME");
    expect(resolveSide("Le", ctx)).toBe("UNKNOWN");
  });

  it("totalbet folds Polish diacritics, including ł, when matching team labels", () => {
    const ekstraklasa = { homeTeam: "Wisla Krakow", awayTeam: "Gornik Zabrze", league: "ekstraklasa" };
    expect([resolveSide("Wisła Kraków", ekstraklasa), resolveSide("Górnik Zabrze (+1.5)", ekstraklasa)]).toEqual(["HOME", "AWAY"]);
  });

  it("totalbet drops a market whose selections resolve to the same code twice", () => {
    expect(
      totalbetNormalizer.normalizeMarket(
        {
          name: "Wynik meczu",
          selections: [
            { name: "Leeds", odds: 2.8 },
            { name: "Leeds United", odds: 3.35 },
            { name: "Tottenham", odds: 2.47 },
          ],
        },
        ctx,
      ),
    ).toBeNull();
  });

  it("totalbet keeps out-of-family sides UNKNOWN", () => {
    const dnb = totalbetNormalizer.normalizeMarket(
      {
        bookmakerMarketId: "mid:11",
        name: "Remis = zwrot - Cały mecz",
        selections: [
          { name: "Leeds", odds: 1.95 },
          { name: "remis", odds: 9 },
          { name: "Tottenham", odds: 1.77 },
        ],
      },
      ctx,
    );
    expect(dnb!.selections.map((s) => s.code)).toEqual(["HOME", "UNKNOWN", "AWAY"]);
  });

  it("totalbet validates the line format per family", () => {
    // The selection carries the market's own line, as Totalbet prints it, so only the line format is under test.
    const at = (bookmakerMarketId: string, paramValue: string) =>
      totalbetNormalizer.normalizeMarket(
        { bookmakerMarketId, name: "x", paramValue, selections: [{ name: `Leeds (${paramValue})`, odds: 1.5 }] },
        ctx,
      )?.marketKey ?? null;
    expect([at("slug:suma", "2.5"), at("slug:suma", "2"), at("slug:suma", "2,5")]).toEqual(["TOTAL_GOALS:2.5", null, null]);
    expect([at("slug:handicap", "-1.5"), at("slug:handicap", "1.5"), at("slug:handicap", "0")]).toEqual(["ASIAN_HANDICAP:-1.5", null, null]);
    expect([at("slug:handicap_hcp", "0:0"), at("slug:handicap_hcp", "-1")]).toEqual(["EUROPEAN_HANDICAP:0", null]);
  });

  it("totalbet drops an Asian handicap whose selections carry another line than the market", () => {
    // The displayed name shows the slug's own period, as in the captures ("1. Połowa - handicap").
    const nameFor = (id: string) => (id.startsWith("slug:1_") ? "1. Połowa - handicap" : id.startsWith("slug:2_") ? "2. Połowa - Handicap" : "Handicap");
    const ah = (bookmakerMarketId: string, paramValue: string, names: string[]) =>
      totalbetNormalizer.normalizeMarket(
        { bookmakerMarketId, name: nameFor(bookmakerMarketId), paramValue, selections: names.map((name) => ({ name, odds: 1.13 })) },
        ctx,
      );
    // A padded row [L(-1.5), E, L(+1.5), O(away), E, E, E, E] read by grid position gives the away
    // line as the home line: "Tottenham (+1.5)" would be AWAY of ASIAN_HANDICAP:+1.5, i.e. away -1.5.
    expect(ah("slug:handicap", "+1.5", ["Tottenham (+1.5)"])).toBeNull();
    // swapped or duplicated parentheticals
    expect(ah("slug:handicap", "-1.5", ["Leeds (+1.5)", "Tottenham (-1.5)"])).toBeNull();
    expect(ah("slug:handicap", "-1.5", ["Leeds (-1.5)", "Tottenham (-1.5)"])).toBeNull();
    expect(ah("slug:1_poaowa_handicap", "+0.5", ["Leeds (-0.5)", "Tottenham (+0.5)"])).toBeNull();
    // a sided selection without its own line cannot be checked
    expect(ah("slug:handicap", "-1.5", ["Leeds", "Tottenham (+1.5)"])).toBeNull();
    // lines compare as numbers
    expect(ah("slug:handicap", "-1.5", ["Leeds (-1.50)", "Tottenham (1.5)"])).toMatchObject({ marketKey: "ASIAN_HANDICAP:-1.5" });
    expect(ah("slug:2_poaowa_handicap", "+0.5", ["Tottenham (-0.5)"])).toMatchObject({
      marketKey: "SECOND_HALF_ASIAN_HANDICAP:+0.5",
      selections: [{ code: "AWAY", label: "Tottenham (-0.5)", odds: 1.13 }],
    });
  });

  it("totalbet drops a European handicap whose selections carry another start score than the row", () => {
    const eh = (paramValue: string, names: string[]) =>
      totalbetNormalizer.normalizeMarket(
        { bookmakerMarketId: "slug:handicap_hcp", name: "Handicap", paramValue, selections: names.map((name) => ({ name, odds: 4.3 })) },
        ctx,
      );
    expect(eh("1:0", ["Leeds (0:1)", "remis (0:1)", "Tottenham (0:1)"])).toBeNull();
    expect(eh("1:0", ["Leeds (1:0)", "remis (0:1)", "Tottenham (1:0)"])).toBeNull();
    expect(eh("1:0", ["Leeds (1:0)", "remis", "Tottenham (1:0)"])).toBeNull();
    expect(eh("1:0", ["Leeds (1:0)", "remis (1:0)", "Tottenham (1:0)"])).toMatchObject({ marketKey: "EUROPEAN_HANDICAP:+1" });
  });

  it("totalbet maps the name 'Wynik meczu' only for id-less, line-less markets", () => {
    const named = (raw: { bookmakerMarketId?: string; paramValue?: string }, names: string[]) =>
      totalbetNormalizer.normalizeMarket({ ...raw, name: "Wynik meczu", selections: names.map((name) => ({ name, odds: 2.5 })) }, ctx);
    const scored = ["Leeds (1:0)", "remis (1:0)", "Tottenham (1:0)"];
    // A line component renamed "Wynik meczu": every row would share the MATCH_WINNER key and lose its line.
    expect(named({ bookmakerMarketId: "slug:new_handicap", paramValue: "1:0" }, scored)).toMatchObject({ marketCode: "OTHER", paramValue: "1:0" });
    expect(named({ bookmakerMarketId: "mid:999" }, ["Leeds", "remis", "Tottenham"])!.marketCode).toBe("OTHER");
    expect(named({ paramValue: "1:0" }, scored)!.marketCode).toBe("OTHER");
    expect(named({}, ["Leeds", "remis", "Tottenham"])).toMatchObject({ marketKey: "MATCH_WINNER", debug: { matchedBy: "name" } });
    expect(named({ bookmakerMarketId: "" }, ["Leeds", "remis", "Tottenham"])).toMatchObject({ marketKey: "MATCH_WINNER" });
  });

  it("totalbet drops a team total whose name names the other team", () => {
    // The side of the six team-total components would otherwise come only from the CMS slug.
    const tt = (bookmakerMarketId: string, name: string) =>
      totalbetNormalizer.normalizeMarket(
        {
          bookmakerMarketId,
          name,
          paramValue: "0.5",
          selections: [
            { name: "poniżej 0.5", odds: 3.15 },
            { name: "powyżej 0.5", odds: 1.31 },
          ],
        },
        ctx,
      );
    expect(tt("slug:competitor1_total_suma", "Tottenham - Total (suma)")).toBeNull();
    expect(tt("slug:competitor2_total_suma", "Leeds - Total (suma)")).toBeNull();
    expect(tt("slug:1_poaowa_competitor_1_suma_goli", "1. połowa - Tottenham - Total (suma)")).toBeNull();
    expect(tt("slug:1_poaowa_competitor_2_suma_goli", "1. połowa - Leeds - Total (suma)")).toBeNull();
    expect(tt("slug:2_poaowa_competitor1_suma_goli_", "2. połowa - Tottenham - Total (suma)")).toBeNull();
    expect(tt("slug:2_poaowa_competitor2_suma_goli_", "2. połowa - Leeds - Total (suma)")).toBeNull();
    // no team in the name, or a name that names both teams
    expect(tt("slug:competitor1_total_suma", "Total (suma)")).toBeNull();
    expect(tt("slug:competitor1_total_suma", "Leeds lub Tottenham - Total (suma)")).toBeNull();
    expect(tt("slug:competitor1_total_suma", "Leeds - Total (suma)")).toMatchObject({ marketKey: "HOME_TEAM_TOTAL_GOALS:0.5" });
    expect(tt("slug:1_poaowa_competitor_2_suma_goli", "1. połowa - Tottenham - Total (suma)")).toMatchObject({
      marketKey: "HALF_TIME_AWAY_TEAM_TOTAL_GOALS:0.5",
    });
    expect(tt("slug:2_poaowa_competitor2_suma_goli_", "2. Połowa - Tottenham - Total (suma)")).toMatchObject({
      marketKey: "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS:0.5",
    });
  });

  // Controller ruling 22 (totalbet): the period of a slug-keyed market used to
  // come from the CMS slug alone. The displayed name shows the period too
  // ("1. połowa - …", "2. Połowa - …", none for the whole match); when the two
  // disagree the slug was reused or misread, so the market is dropped rather
  // than published under another period's code.
  it("totalbet drops a slug-keyed market whose name shows another period", () => {
    const line = (bookmakerMarketId: string, name: string, paramValue = "0.5") =>
      totalbetNormalizer.normalizeMarket(
        { bookmakerMarketId, name, paramValue, selections: [{ name: "poniżej 0.5", odds: 3.15 }, { name: "powyżej 0.5", odds: 1.31 }] },
        ctx,
      );
    expect(line("slug:suma", "1. połowa - Total (suma)")).toBeNull();
    expect(line("slug:1_poaowa_suma", "2. połowa - Total (suma)")).toBeNull();
    expect(line("slug:1_poaowa_suma", "Total (suma)")).toBeNull();
    expect(line("slug:2_poaowa_suma", "1. Połowa - Total (suma)")).toBeNull();
    expect(line("slug:competitor1_total_suma", "1. połowa - Leeds - Total (suma)")).toBeNull();
    expect(line("slug:2_poaowa_competitor1_suma_goli_", "Leeds - Total (suma)")).toBeNull();
    const hcp = (bookmakerMarketId: string, name: string) =>
      totalbetNormalizer.normalizeMarket(
        { bookmakerMarketId, name, paramValue: "-1.5", selections: [{ name: "Leeds (-1.5)", odds: 3.1 }, { name: "Tottenham (+1.5)", odds: 1.36 }] },
        ctx,
      );
    expect(hcp("slug:handicap", "1. Połowa - handicap")).toBeNull();
    expect(hcp("slug:2_poaowa_handicap", "Handicap")).toBeNull();
    // agreeing names still map
    expect(line("slug:suma", "Total (suma)")).toMatchObject({ marketKey: "TOTAL_GOALS:0.5" });
    expect(line("slug:1_poaowa_suma", "1. połowa - Total (suma)")).toMatchObject({ marketKey: "HALF_TIME_TOTAL_GOALS:0.5" });
    expect(line("slug:2_poaowa_suma", "2. Połowa - Total (suma)")).toMatchObject({ marketKey: "SECOND_HALF_TOTAL_GOALS:0.5" });
    expect(hcp("slug:1_poaowa_handicap", "1. Połowa - handicap")).toMatchObject({ marketKey: "FIRST_HALF_ASIAN_HANDICAP:-1.5" });
    expect(hcp("slug:handicap", "Handicap")).toMatchObject({ marketKey: "ASIAN_HANDICAP:-1.5" });
  });

  it("totalbet looks up only own keys of its tables", () => {
    const out = totalbetNormalizer.normalizeMarket({ bookmakerMarketId: "constructor", name: "toString", selections: [] }, ctx);
    expect(out).toMatchObject({ marketCode: "OTHER", debug: { rawId: "constructor", matchedBy: "pattern" } });
  });

  it("totalbet reports the key and match path in debug, and the catalog label as marketName", () => {
    const dc = outs.find(({ m }) => m.bookmakerMarketId === "mid:10")!.o as NormalizedMarketOutput & { marketName: string };
    expect(dc.debug).toEqual({ rawName: "Podwójna szansa - Cały mecz", rawId: "mid:10", matchedBy: "id" });
    expect(dc.marketName).toBe("Podwójna szansa");
    const mw = outs.find(({ m }) => m.name === "Wynik meczu")!.o!;
    expect(mw.debug).toEqual({ rawName: "Wynik meczu", rawId: undefined, matchedBy: "name" });
    const other = outs.find(({ m }) => m.name === "Zawodnik strzeli gola")!.o!;
    expect(other.selections.every((s) => s.code === "UNKNOWN")).toBe(true);
    expect(other.selections[0].label).toBe(outs.find(({ m }) => m.name === "Zawodnik strzeli gola")!.m.selections[0].name);
  });

  it("totalbet key table holds exactly the 38 phase-1 keys", () => {
    expect(Object.keys(TOTALBET_MARKET_KEY_TO_CODE)).toHaveLength(38);
    expect(Object.keys(TOTALBET_MARKET_KEY_TO_CODE).filter((k) => k.startsWith("mid:"))).toHaveLength(20);
    expect(Object.keys(TOTALBET_MARKET_KEY_TO_CODE).filter((k) => k.startsWith("slug:"))).toHaveLength(18);
  });
});
