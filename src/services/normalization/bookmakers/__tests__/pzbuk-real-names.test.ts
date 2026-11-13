import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pzbukNormalizer } from "../pzbuk-normalizer.js";
const ctx = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" };
type Row = [id: string, name: string, param: string, sels: [string, number][], code: string, sel?: [string, number]];
const norm = ([id, name, param, sels]: Row) =>
  pzbukNormalizer.normalizeMarket({ bookmakerMarketId: id, name, paramValue: param, selections: sels.map(([n, o]) => ({ name: n, odds: o })) }, ctx);
const SCORERS: [string, number][] = [["Keane, Michael", 11.19], ["Barry, Thierno", 4.18]];
// Labels of the 2026-11-06 capture (premier-league_everton_coventry_city.json #14, #46, #153).
const HT_FT: [string, number][] = [["Everton FC/Everton FC", 2.36], ["Everton FC/remis", 15.74], ["Everton FC/Coventry City", 49.18], ["remis/Everton FC", 4.52], ["remis/remis", 5.71], ["remis/Coventry City", 10.33], ["Coventry City/Everton FC", 24.59], ["Coventry City/remis", 16.72], ["Coventry City/Coventry City", 8.26]];
const RESULT_BTTS: [string, number][] = [["Everton FC & tak", 3.39], ["Everton FC & nie", 2.6], ["remis & tak", 4.9], ["remis & nie", 11.2], ["Coventry City & tak", 9.1], ["Coventry City & nie", 15.3]];
const DC_BTTS: [string, number][] = [["Everton FC/remis & tak", 3.67], ["Everton FC/remis & nie", 1.46], ["Everton FC/Coventry City & tak", 4.07], ["Everton FC/Coventry City & nie", 1.51], ["remis/Coventry City & tak", 6.1], ["remis/Coventry City & nie", 2.58]];
// Team x method knockout market (world-cup-2026_france_morocco.json #11, with this context's teams).
const TEAM_METHOD: [string, number][] = [["Everton FC regulaminowy czas gry", 1.43], ["Coventry City regulaminowy czas gry", 5.31], ["Everton FC po dogrywce", 7.97], ["Coventry City po dogrywce", 24.59], ["Everton FC po rzutach karnych", 12.29], ["Coventry City po rzutach karnych", 12.29]];
const rows: Row[] = [
  ["126", "Kartki 1x2", "0", [["Everton FC", 2.75], ["remis", 3.83], ["Coventry City", 1.95]], "CARDS_RACE", ["HOME", 2.75]],
  ["78", "2. Połowa - Podwójna szansa", "0", [["Everton FC lub remis", 1.18], ["Everton FC lub Coventry City", 1.38], ["remis lub Coventry City", 1.64]], "SECOND_HALF_DOUBLE_CHANCE", ["HOME_OR_DRAW", 1.18]],
  ["79", "2. Połowa - Remis bez zakładu", "0", [["Everton FC", 1.33], ["Coventry City", 2.8]], "SECOND_HALF_DRAW_NO_BET", ["AWAY", 2.8]],
  ["36", "1. strzelec gola", "0", SCORERS, "GOALSCORER_FIRST", ["Thierno Barry", 4.18]],
  ["37", "Strzelec ostatniego gola", "0", SCORERS, "GOALSCORER_LAST", ["Michael Keane", 11.19]],
  ["147", "1. Połowa - Coventry City Dokładna liczba kartek", "0", [["0", 1.82], ["1", 2.32], ["2", 5.61], ["3+", 16.72]], "HALF_TIME_AWAY_EXACT_CARDS", ["3+", 16.72]],
  ["501", "2. Połowa - 1x2 & oba zespoły strzelą", "0", [["Everton FC & tak", 8.95], ["Everton FC & nie", 2.27], ["remis & tak", 6.2], ["remis & nie", 3.84], ["Coventry City & tak", 19.67], ["Coventry City & nie", 5.11]], "SECOND_HALF_RESULT_AND_BTTS", ["HOME_YES", 8.95]],
  ["167", "1. Połowa - Suma rzutów rożnych", "4.5", [["ponad 4.5", 1.88], ["poniżej 4.5", 1.73]], "HALF_TIME_CORNERS_TOTAL", ["OVER", 1.88]],
  ["142", "1. Połowa - Suma kartek", "1.5", [["ponad 1.5", 2.1], ["poniżej 1.5", 1.55]], "HALF_TIME_CARDS_TOTAL", ["UNDER", 1.55]],
  ["58", "1. Połowa - Podwójna szansa", "0", [["Everton FC lub remis", 1.15], ["Everton FC lub Coventry City", 1.49], ["remis lub Coventry City", 1.57]], "HALF_TIME_DOUBLE_CHANCE", ["DRAW_OR_AWAY", 1.57]],
  ["59", "1. Połowa - Remis bez zakładu", "0", [["Everton FC", 1.32], ["Coventry City", 2.99]], "HALF_TIME_DRAW_NO_BET", ["HOME", 1.32]],
  ["75", "1. Połowa - Dokładny wynik", "0", [["0:0", 2.85], ["1:0", 3.4], ["inny", 12.3]], "HALF_TIME_CORRECT_SCORE", ["0-0", 2.85]],
  ["60", "1. Połowa - handicap", "0", [["Everton FC (1:0)", 1.13], ["remis (1:0)", 5.21], ["Coventry City (1:0)", 21.61]], "OTHER"],
  ["61", "1. Połowa - handicap", "0.5", [["Everton FC (+0.5)", 1.14], ["Coventry City (-0.5)", 4.52]], "OTHER"],
  ["80", "2. Połowa - handicap", "0", [["Everton FC (1:0)", 1.17], ["remis (1:0)", 5.11], ["Coventry City (1:0)", 15.71]], "OTHER"],
  ["146", "1. Połowa - Everton FC Dokładna liczba kartek", "0", [["0", 1.63], ["1", 2.41], ["2", 6.69], ["3+", 23.61]], "HALF_TIME_HOME_EXACT_CARDS", ["3+", 23.61]],
  // 2-way half handicaps: OTHER until verified as FIRST/SECOND_HALF_ASIAN_HANDICAP (plan OQ1, ruling 10)
  ["81", "2. Połowa - handicap", "0.5", [["Everton FC (+0.5)", 1.17], ["Coventry City (-0.5)", 4.03]], "OTHER"],
  // id map entries that win over a blank or placeholder name (the id map runs before matchMarketByName).
  // Proven by real names: id 2 "Zakwalifikowanie się" (WC #13), id 42 "Połowa/Reg. czas gry" (PL #14).
  ["2", "Rynek 2", "0", [["Everton FC", 1.2], ["Coventry City", 4.02]], "TEAM_TO_QUALIFY", ["HOME", 1.2]],
  ["42", "Rynek 42", "0", HT_FT, "HALFTIME_FULLTIME", ["HOME_HOME", 2.36]],
  // Unverified or refuted guesses parked in OTHER (evidence/pzbuk/market-type-ids-2026-11-06.json).
  ["3", "Rynek 3", "0", [["Everton FC (1:0)", 1.13], ["remis (1:0)", 5.21], ["Coventry City (1:0)", 21.61]], "OTHER"],
  ["4", "Rynek 4", "0", HT_FT, "OTHER"],
  ["5", "Rynek 5", "0", TEAM_METHOD, "OTHER"],
  ["20", "Rynek 20", "1.5", [["ponad 1.5", 1.69], ["poniżej 1.5", 2.01]], "OTHER"],
  ["38", "Rynek 38", "0", [["0", 5.4], ["1", 3.05], ["2", 3.29], ["3+", 3.14]], "OTHER"],
  ["39", "Rynek 39", "0", RESULT_BTTS, "OTHER"],
  ["41", "Rynek 41", "0", DC_BTTS, "OTHER"],
  ["499", "Podwójna szansa (mecz) & 2. połowa oba zespoły strzelą", "0", DC_BTTS, "OTHER"],
  ["500", "1. Połowa - Podwójna szansa & oba zespoły strzelą", "0", DC_BTTS, "OTHER"],
  ["2395", "Zawodnik z kartką (lub zmiennik)", "0", [["Maitland-Niles, Ainsley", 5.68], ["Branthwaite, Jarrad", 5.38]], "OTHER"],
  // ordinal templates ({SpecialIntValue1}): the "2." names are synthetic (live-only), odds illustrative
  ["36", "2. strzelec gola", "0", SCORERS, "OTHER"],
  ["8", "2. gol", "0", [["Everton FC", 2.1], ["żaden", 5.0], ["Coventry City", 3.2]], "OTHER"],
  ["57", "1. Połowa - 2. gol", "0", [["Everton FC", 2.9], ["żaden", 1.9], ["Coventry City", 4.4]], "OTHER"],
  ["92", "Kiedy zostanie strzelony 2. gol (10 min interwał)", "0", [["1-10", 9.1], ["żaden", 2.2]], "OTHER"],
  // unrendered ordinal templates: a blank market.name makes the parser fall back to marketType.name
  // (parser.ts apiName), which still holds the template, so the live ordinal is unknown. Names are the
  // captured marketType.name values (ws-event-frames.json) and selections are the captured "1." odds;
  // the pairing is synthetic (no blank market.name has been observed).
  ["8", "{SpecialIntValue1}. gol", "0", [["Everton FC", 1.5], ["żaden", 12.77], ["Coventry City", 2.75]], "OTHER"],
  ["36", "{SpecialIntValue1}. strzelec gola", "0", SCORERS, "OTHER"],
  ["57", "1. Połowa - {SpecialIntValue1}. gol", "0", [["Everton FC", 1.95], ["żaden", 3.14], ["Coventry City", 3.73]], "OTHER"],
  ["77", "2. Połowa - {SpecialIntValue1}. gol", "0", [["Everton FC", 1.8], ["żaden", 4.22], ["Coventry City", 3.24]], "OTHER"],
  ["91", "Kiedy zostanie strzelony {SpecialIntValue1}. gol (15 min interwał)", "0", [["1-15", 2.8], ["16-30", 3.59], ["31-45", 4.52], ["46-60", 7.87], ["61-75", 11.56], ["76-90", 14.75], ["żaden", 12.05]], "OTHER"],
  ["92", "Kiedy zostanie strzelony {SpecialIntValue1}. gol (10 min interwał)", "0", [["1-10", 4.03], ["11-20", 4.52], ["21-30", 5.71], ["31-40", 7.28]], "OTHER"],
  ["140", "1. Połowa - {SpecialIntValue1}. kartka", "0", [["Everton FC", 2.55], ["żaden", 3.29], ["Coventry City", 2.2]], "OTHER"],
  // regression guards: must not move
  ["77", "2. Połowa - 1. gol", "0", [["Everton FC", 1.8], ["żaden", 4.22], ["Coventry City", 3.24]], "SECOND_HALF_FIRST_GOAL", ["NONE", 4.22]],
  ["1", "1x2", "0", [["Everton FC", 1.66], ["Remis", 3.92], ["Coventry City", 4.91]], "MATCH_WINNER", ["HOME", 1.66]],
  ["10", "Podwójna szansa", "0", [["Everton FC lub remis", 1.19], ["Everton FC lub Coventry City", 1.26], ["remis lub Coventry City", 2.13]], "DOUBLE_CHANCE", ["HOME_OR_DRAW", 1.19]],
  ["11", "Remis bez zakładu", "0", [["Everton FC", 1.26], ["Coventry City", 3.53]], "DRAW_NO_BET", ["AWAY", 3.53]],
  ["62", "1. Połowa - Suma", "0.5", [["ponad 0.5", 1.32], ["poniżej 0.5", 3.04]], "HALF_TIME_TOTAL_GOALS", ["OVER", 1.32]],
  ["82", "2. Połowa - Suma", "0.5", [["ponad 0.5", 1.2], ["poniżej 0.5", 3.93]], "SECOND_HALF_TOTAL_GOALS", ["UNDER", 3.93]],
  ["55", "1. Połowa - 1x2", "0", [["Everton FC", 2.14], ["remis", 2.3], ["Coventry City", 5.11]], "HALF_TIME_RESULT", ["DRAW", 2.3]],
  ["76", "2. Połowa - 1x2", "0", [["Everton FC", 1.99], ["remis", 2.65], ["Coventry City", 4.52]], "SECOND_HALF_RESULT", ["AWAY", 4.52]],
  ["167", "Rynek 167", "4.5", [["ponad 4.5", 1.88], ["poniżej 4.5", 1.73]], "HALF_TIME_CORNERS_TOTAL", ["OVER", 1.88]],
  ["8", "1. gol", "0", [["Everton FC", 1.5], ["żaden", 12.77], ["Coventry City", 2.75]], "FIRST_TEAM_TO_SCORE", ["NONE", 12.77]],
  ["57", "1. Połowa - 1. gol", "0", [["Everton FC", 2.9], ["żaden", 1.9], ["Coventry City", 4.4]], "HALF_TIME_FIRST_GOAL", ["NONE", 1.9]],
  // 21/23 are parked in OTHER by id until verified (coverage follow-up, plan OQ1)
  ["21", "Everton FC Dokładna liczba goli", "0", [["0", 5.4], ["1", 3.05], ["2", 3.29], ["3+", 3.14]], "OTHER"],
  ["23", "Zakres liczby goli", "0", [["0-1", 3.64], ["2-3", 1.92], ["4-5", 3.44], ["6+", 12.04]], "OTHER"],
  // scope guard: unknown ids with half/stat-scoped names never reach full-match codes
  ["99001", "1. Połowa - Liczba goli gospodarzy", "1.5", [["ponad 1.5", 3.1], ["poniżej 1.5", 1.3]], "OTHER"],
  ["99002", "2. Połowa - Dokładny wynik", "0", [["0:0", 3.79], ["1:0", 3.79]], "OTHER"],
  ["99003", "Kartki - Podwójna szansa", "0", [["Everton FC lub remis", 1.3]], "OTHER"],
];
describe("pzbuk routing by real API names (2026-11-06 capture)", () => {
  it.each(rows)("id %s %s -> $4", (...row) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let out: ReturnType<typeof norm>;
    try {
      out = norm(row as Row);
      // A dropped market (the scope-guard rows) is logged as unknown; a routed one is not.
      expect(warn.mock.calls.length > 0).toBe(out === null);
    } finally {
      warn.mockRestore();
    }
    const [, , param, , code, sel] = row as Row;
    expect(out?.marketCode ?? "OTHER").toBe(code);
    if (sel) expect(out!.selections.find((s) => String(s.code) === sel[0])?.odds).toBe(sel[1]);
    if (code.endsWith("_TOTAL") || code.endsWith("TOTAL_GOALS")) expect(out!.paramValue).toBe(param);
  });
});

const fx = JSON.parse(readFileSync(new URL("../../__fixtures__/pzbuk/premier-league_everton_coventry_city.json", import.meta.url), "utf8"));
// Mirrors toRawBookmakerMarket in __tests__/golden.test.ts (not exported): empty archive strings become undefined.
// Unmapped markets (player props etc.) log "[pzbuk] Unknown market" by design; muted to keep output clean.
const outs = () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return fx.entries.map(({ raw }: any) => ({ raw, out: pzbukNormalizer.normalizeMarket({
      bookmakerMarketId: raw.bookmakerMarketId ? String(raw.bookmakerMarketId) : undefined, name: raw.name,
      groupName: raw.groupName || undefined, paramValue: raw.paramValue || undefined, selections: raw.selections }, fx.ctx) }));
  } finally {
    warn.mockRestore();
  }
};
describe("pzbuk real-names fixture invariants", () => {
  it("has 167 entries from the 2026-11-06 capture", () => expect(fx.entries).toHaveLength(167));
  it("has no non-OTHER marketKey collision with overlapping selection codes", () => {
    const seen = new Map<string, Set<string>>(); const collisions: string[] = []; let nonOther = 0;
    for (const { raw, out } of outs()) {
      if (!out || out.marketCode === "OTHER") continue;
      nonOther++;
      const codes = seen.get(out.marketKey) ?? new Set<string>();
      for (const s of out.selections) { if (codes.has(String(s.code))) collisions.push(`${out.marketKey}:${s.code} <- ${raw.name}`); codes.add(String(s.code)); }
      seen.set(out.marketKey, codes);
    }
    expect(collisions).toEqual([]);
    // Non-vacuity: the invariant is only meaningful while the fixture still routes its markets.
    expect([nonOther, seen.size]).toEqual([76, 76]);
  });
  it("takes MATCH_WINNER only from id 1", () => {
    const mw = outs().filter(({ out }: any) => out?.marketCode === "MATCH_WINNER");
    expect(mw.map(({ raw, out }: any) => [raw.bookmakerMarketId, out.selections.map((s: any) => s.odds)])).toEqual([["1", [1.66, 3.92, 4.91]]]);
  });
});

describe("pzbuk fail-closed: one code on two selections", () => {
  const WC = { homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" };
  const run = (id: string, name: string, sels: [string, number][], context = ctx) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = pzbukNormalizer.normalizeMarket({ bookmakerMarketId: id, name, selections: sels.map(([n, o]) => ({ name: n, odds: o })) }, context);
      return { out, warnings: warn.mock.calls.map((c) => String(c[0])) };
    } finally {
      warn.mockRestore();
    }
  };
  const RESOLUTION = "W jaki sposób rozstrzygnie się mecz?";

  it("drops the team x method knockout market instead of publishing it as MATCH_RESOLUTION_METHOD", () => {
    // world-cup-2026_france_morocco.json #11: Polish team names against the English context.
    const wc: [string, number][] = [["Francja regulaminowy czas gry", 1.43], ["Maroko regulaminowy czas gry", 5.31], ["Francja po dogrywce", 7.97], ["Maroko po dogrywce", 24.59], ["Francja po rzutach karnych", 12.29], ["Maroko po rzutach karnych", 12.29]];
    expect(run("5", RESOLUTION, wc, WC).out).toBeNull();
    expect(run("5", RESOLUTION, TEAM_METHOD).out).toBeNull();
  });
  it("drops it when only one side resolves to a context team (duplicate UNKNOWN)", () => {
    const partial: [string, number][] = [["Francja regulaminowy czas gry", 1.43], ["Nibylandia regulaminowy czas gry", 5.31], ["Francja po dogrywce", 7.97], ["Nibylandia po dogrywce", 24.59], ["Francja po rzutach karnych", 12.29], ["Nibylandia po rzutach karnych", 12.29]];
    const { out, warnings } = run("5", RESOLUTION, partial, { ...WC, awayTeam: "Neverland" });
    expect(out).toBeNull();
    expect(warnings).toEqual([expect.stringMatching(/^\[pzbuk\] Dropping MATCH_RESOLUTION_METHOD /)]);
  });
  it("still routes the 3-way match resolution market", () => {
    const { out } = run("5", RESOLUTION, [["w regulaminowym czasie gry", 1.2], ["po dogrywce", 7.5], ["po rzutach karnych", 9.1]]);
    expect(out?.selections.map((s) => [s.code, s.odds])).toEqual([["REGULAR_TIME", 1.2], ["EXTRA_TIME", 7.5], ["PENALTIES", 9.1]]);
    expect(out?.marketCode).toBe("MATCH_RESOLUTION_METHOD");
  });
  it("drops any non-OTHER market that repeats a selection code, and keeps OTHER as is", () => {
    const twice: [string, number][] = [["Everton FC", 1.66], ["Everton FC", 1.7], ["Coventry City", 4.91]];
    const { out, warnings } = run("1", "1x2", twice);
    expect(out).toBeNull();
    expect(warnings).toEqual([expect.stringMatching(/^\[pzbuk\] Dropping MATCH_WINNER "1x2" \(id: 1\): .*"Everton FC" -> HOME/)]);
    expect(run("14", "Handicap", twice).out?.marketCode).toBe("OTHER");
  });
});
