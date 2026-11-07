import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pzbukNormalizer } from "../pzbuk-normalizer.js";
const ctx = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" };
type Row = [id: string, name: string, param: string, sels: [string, number][], code: string, sel?: [string, number]];
const norm = ([id, name, param, sels]: Row) =>
  pzbukNormalizer.normalizeMarket({ bookmakerMarketId: id, name, paramValue: param, selections: sels.map(([n, o]) => ({ name: n, odds: o })) }, ctx);
const SCORERS: [string, number][] = [["Keane, Michael", 11.19], ["Barry, Thierno", 4.18]];
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
  // 21/23 pass today only because every selection is UNKNOWN and the market is dropped
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
    const out = norm(row as Row);
    // A dropped market (the scope-guard rows) is logged as unknown; a routed one is not.
    expect(warn.mock.calls.length > 0).toBe(out === null);
    warn.mockRestore();
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
    const seen = new Map<string, Set<string>>(); const collisions: string[] = [];
    for (const { raw, out } of outs()) {
      if (!out || out.marketCode === "OTHER") continue;
      const codes = seen.get(out.marketKey) ?? new Set<string>();
      for (const s of out.selections) { if (codes.has(String(s.code))) collisions.push(`${out.marketKey}:${s.code} <- ${raw.name}`); codes.add(String(s.code)); }
      seen.set(out.marketKey, codes);
    }
    expect(collisions).toEqual([]);
  });
  it("takes MATCH_WINNER only from id 1", () => {
    const mw = outs().filter(({ out }: any) => out?.marketCode === "MATCH_WINNER");
    expect(mw.map(({ raw, out }: any) => [raw.bookmakerMarketId, out.selections.map((s: any) => s.odds)])).toEqual([["1", [1.66, 3.92, 4.91]]]);
  });
});
