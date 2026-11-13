import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pzbukNormalizer } from "../pzbuk-normalizer.js";
import { MARKET_BY_CODE } from "../../../../data/market-catalog.js";
import type { NormalizationContext, NormalizedMarketOutput } from "../../types.js";

// Live 2026-11-07 premier-league listing (.scratch/smoke-live-1.log): PZBuk names the club
// "Brighton & Hove Albion", the canonical context name is "Brighton and Hove Albion". Its "&" used
// to split a combo label such as "Brighton & Hove Albion & tak" into three parts, so the label fell
// through to loose fallbacks: HOME/HOME pairs, and "Brighton & Hove Albion/remis & tak" -> DRAW_YES.
interface Side {
  label: string;
  ctx: NormalizationContext;
  home: string;
  away: string;
}
const SIDES: Side[] = [
  {
    label: "Brighton at home",
    ctx: { homeTeam: "Brighton and Hove Albion", awayTeam: "Brentford", league: "premier-league" },
    home: "Brighton & Hove Albion",
    away: "Brentford FC",
  },
  {
    label: "Brighton away",
    ctx: { homeTeam: "Hull City", awayTeam: "Brighton and Hove Albion", league: "premier-league" },
    home: "Hull City",
    away: "Brighton & Hove Albion",
  },
];

// Selection templates are the 2026-11-06 Everton-Coventry City capture shapes ({H}/{A} = raw team names).
const DC_BTTS = ["{H}/remis & tak", "{H}/remis & nie", "{H}/{A} & tak", "{H}/{A} & nie", "remis/{A} & tak", "remis/{A} & nie"];
const RESULT_BTTS = ["{H} & tak", "{H} & nie", "remis & tak", "remis & nie", "{A} & tak", "{A} & nie"];
const resultTotal = (line: string) => [
  `{H} & poniżej ${line}`, `{H} & ponad ${line}`, `remis & poniżej ${line}`,
  `remis & ponad ${line}`, `{A} & poniżej ${line}`, `{A} & ponad ${line}`,
];
const RESULT_BTTS_CODES = ["HOME_YES", "HOME_NO", "DRAW_YES", "DRAW_NO", "AWAY_YES", "AWAY_NO"];
const RESULT_TOTAL_CODES = ["HOME_UNDER", "HOME_OVER", "DRAW_UNDER", "DRAW_OVER", "AWAY_UNDER", "AWAY_OVER"];

interface Row {
  id: string;
  name: string;
  param: string;
  sels: string[];
  code: string;
  /** Expected codes in raw order; omitted for parked (OTHER) or dropped markets. */
  codes?: string[];
}
const ROWS: Row[] = [
  { id: "504", name: "Podwójna szansa & oba zespoły strzelą", param: "0", sels: DC_BTTS, code: "DOUBLE_CHANCE_BTTS", codes: ["1X_YES", "1X_NO", "12_YES", "12_NO", "X2_YES", "X2_NO"] },
  { id: "33", name: "1x2 & Oba zespoły zdobędą gola", param: "0", sels: RESULT_BTTS, code: "RESULT_AND_BTTS", codes: RESULT_BTTS_CODES },
  { id: "501", name: "2. Połowa - 1x2 & oba zespoły strzelą", param: "0", sels: RESULT_BTTS, code: "SECOND_HALF_RESULT_AND_BTTS", codes: RESULT_BTTS_CODES },
  ...["1.5", "2.5", "3.5", "4.5"].map((line): Row => ({ id: "35", name: "1x2 & Suma", param: line, sels: resultTotal(line), code: "RESULT_AND_TOTAL", codes: RESULT_TOTAL_CODES })),
  // No team leg, but it goes through the same "&" split.
  { id: "34", name: "Suma & Oba zespoły zdobędą gola", param: "2.5", sels: ["ponad 2.5 & tak", "poniżej 2.5 & tak", "ponad 2.5 & nie", "poniżej 2.5 & nie"], code: "TOTAL_GOALS_AND_BTTS", codes: ["OVER_YES", "UNDER_YES", "OVER_NO", "UNDER_NO"] },
  // Half-scoped and unverified variants stay parked in OTHER (or dropped) whatever the team names are.
  { id: "72", name: "1. Połowa - 1x2 & Oba zespoły zdobędą gola", param: "0", sels: RESULT_BTTS, code: "OTHER" },
  { id: "73", name: "1. Połowa - 1x2 & Suma", param: "1.5", sels: resultTotal("1.5"), code: "OTHER" },
  { id: "500", name: "1. Połowa - Podwójna szansa & oba zespoły strzelą", param: "0", sels: DC_BTTS, code: "OTHER" },
  { id: "502", name: "2. Połowa - 1x2 & suma", param: "1.5", sels: resultTotal("1.5"), code: "OTHER" },
  { id: "503", name: "2. Połowa - Podwójna szansa & oba zespoły strzelą", param: "0", sels: DC_BTTS, code: "OTHER" },
  { id: "498", name: "Podwójna szansa (mecz) & 1. połowa oba zespoły strzelą", param: "0", sels: DC_BTTS, code: "OTHER" },
  { id: "499", name: "Podwójna szansa (mecz) & 2. połowa oba zespoły strzelą", param: "0", sels: DC_BTTS, code: "OTHER" },
];

const ODDS = [2.05, 2.15, 2.25, 2.35, 2.45, 2.55];
const quiet = <T>(fn: () => T): T => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return fn();
  } finally {
    warn.mockRestore();
  }
};
const fill = (template: string, side: Side) => template.split("{H}").join(side.home).split("{A}").join(side.away);
const normalizeRow = (row: Row, side: Side) =>
  quiet(() =>
    pzbukNormalizer.normalizeMarket(
      {
        bookmakerMarketId: row.id,
        name: row.name,
        paramValue: row.param,
        selections: row.sels.map((s, j) => ({ name: fill(s, side), odds: ODDS[j] })),
      },
      side.ctx,
    ),
  );

/** Every catalog COMBINATION market must carry catalog codes only, each once. */
const comboVocabularyMisses = (outs: Array<NormalizedMarketOutput | null>): string[] =>
  outs.flatMap((out) => {
    if (!out || out.marketCode === "OTHER") return [];
    const entry = MARKET_BY_CODE.get(out.marketCode);
    if (String(entry?.viewType) !== "COMBINATION") return [];
    const vocabulary = new Set(entry!.selections);
    const seen = new Set<string>();
    return out.selections.flatMap((s) => {
      const code = String(s.code);
      const miss = !vocabulary.has(code) || seen.has(code) ? [`${out.marketKey}:${code} <- ${s.label}`] : [];
      seen.add(code);
      return miss;
    });
  });

describe.each(SIDES)("pzbuk combo selections with an '&' team name ($label)", (side) => {
  it.each(ROWS)("id $id $name ($param) -> $code", (row) => {
    const out = normalizeRow(row, side);
    expect(out?.marketCode ?? "OTHER").toBe(row.code);
    if (!row.codes) return;
    // Code and price stay paired in raw order: a wrong code here is a mislabelled price.
    expect(out!.selections.map((s) => [s.code, s.odds])).toEqual(row.codes.map((c, j) => [c, ODDS[j]]));
    expect(out!.selections.map((s) => s.label)).toEqual(row.sels.map((s) => fill(s, side)));
    expect(out!.paramValue ?? "0").toBe(row.param);
  });

  it("emits only catalog codes, once each, in every COMBINATION market", () => {
    expect(comboVocabularyMisses(ROWS.map((row) => normalizeRow(row, side)))).toEqual([]);
  });
});

// The real 167-entry capture, re-run with the teams renamed: a team name must never change a routed
// market, its key, or any selection's code or price.
const fx = JSON.parse(readFileSync(new URL("../../__fixtures__/pzbuk/premier-league_everton_coventry_city.json", import.meta.url), "utf8"));
const runFixture = (ctx: NormalizationContext, rename: (s: string) => string) =>
  quiet(() =>
    fx.entries.map(({ raw }: any) =>
      pzbukNormalizer.normalizeMarket(
        {
          bookmakerMarketId: raw.bookmakerMarketId ? String(raw.bookmakerMarketId) : undefined,
          name: rename(raw.name),
          groupName: raw.groupName || undefined,
          paramValue: raw.paramValue || undefined,
          selections: raw.selections.map((s: { name: string; odds: number }) => ({ name: rename(s.name), odds: s.odds })),
        },
        ctx,
      ),
    ),
  ) as Array<NormalizedMarketOutput | null>;
// OTHER keeps raw labels as codes (they carry the team names), so only its prices are compared.
const project = (outs: Array<NormalizedMarketOutput | null>) =>
  outs.map((out) =>
    out === null
      ? null
      : {
          marketCode: out.marketCode,
          marketKey: out.marketKey,
          paramValue: out.paramValue ?? null,
          selections: out.selections.map((s) => (out.marketCode === "OTHER" ? [s.odds] : [String(s.code), s.odds])),
        },
  );

describe("pzbuk real-names fixture with '&' team names", () => {
  const base = runFixture(fx.ctx, (s) => s);

  it("is clean with the captured names (control)", () => {
    expect(comboVocabularyMisses(base)).toEqual([]);
  });

  it.each(SIDES)("keeps every routed code and price when the teams are renamed ($label)", (side) => {
    const renamed = runFixture(side.ctx, (s) => s.split("Everton FC").join(side.home).split("Coventry City").join(side.away));
    expect(comboVocabularyMisses(renamed)).toEqual([]);
    expect(project(renamed)).toEqual(project(base));
  });
});

describe("pzbuk combo markets fail closed", () => {
  const side = SIDES[0];
  const combo = (id: string, name: string, sels: string[]) =>
    pzbukNormalizer.normalizeMarket(
      { bookmakerMarketId: id, name, paramValue: "0", selections: sels.map((s, j) => ({ name: fill(s, side), odds: ODDS[j] })) },
      side.ctx,
    );

  // Synthetic: "Fulham" is neither context team, so its leg cannot be resolved.
  it("drops a DOUBLE_CHANCE_BTTS market with an unresolvable leg instead of reading 'remis' as DRAW_YES", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = combo("504", "Podwójna szansa & oba zespoły strzelą", ["Fulham/remis & tak", ...DC_BTTS.slice(1)]);
    expect(out).toBeNull();
    expect(warn.mock.calls.flat().join(" ")).toContain("Fulham/remis & tak");
    warn.mockRestore();
  });

  // Synthetic: two labels that resolve to the same side would publish one code at two prices.
  it("drops a RESULT_AND_BTTS market whose labels resolve to the same code twice", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = combo("33", "1x2 & Oba zespoły zdobędą gola", [...RESULT_BTTS.slice(0, 5), "{H} & nie"]);
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // Synthetic: an unresolvable team with an "x" in its name, in the "remis & tak" slot. The loose
  // /x.*tak/ fallback read it as DRAW_YES, a catalog code that no other selection uses, so neither
  // the vocabulary nor the duplicate check could catch it.
  it("does not read an 'x' inside an unresolved team name as DRAW_YES", () => {
    const sels = RESULT_BTTS.map((s) => (s === "remis & tak" ? "Exeter City & tak" : s));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = combo("33", "1x2 & Oba zespoły zdobędą gola", sels);
    expect(out).toBeNull();
    expect(warn.mock.calls.flat().join(" ")).toContain('"Exeter City & tak" -> UNKNOWN');
    warn.mockRestore();
  });

  it("keeps the complete Brighton market (regression guard for the drop rule)", () => {
    expect(quiet(() => combo("33", "1x2 & Oba zespoły zdobędą gola", RESULT_BTTS))?.selections.map((s) => s.code)).toEqual(RESULT_BTTS_CODES);
  });
});
