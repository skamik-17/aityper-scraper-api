// Betby (betters + lebull) id-based UOF normalizer. Evidence: the events captured on 2026-11-06
// (Leeds United - Tottenham Hotspur on both brands; Arsenal - Hull, Man Utd - Aston Villa and
// the thin far-future Liverpool - Man Utd on betters), shared with the Betby scraper tests
// under src/scrapers/shared/betby/__tests__/fixtures/.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { isValidMarketCode } from "../../../../data/market-catalog.js";
import { loadJson, snapshotFrom } from "../../../../scrapers/shared/betby/__tests__/fixtures.js";
import { buildScrapedMarkets } from "../../../../scrapers/shared/betby/parser.js";
import type { BetbyBookmaker, BetbyEvent, BetbyMarketDescriptions } from "../../../../scrapers/shared/betby/types.js";
import type { NormalizationContext, NormalizedMarketOutput } from "../../types.js";
import { BETBY_MARKET_RULES, betbyRuleFor, findSpecifierKeyMismatches } from "../betby-market-rules.js";
import { createBetbyNormalizer } from "../betby-normalizer.js";
import { bettersNormalizer } from "../betters-normalizer.js";
import { lebullNormalizer } from "../lebull-normalizer.js";

const LEEDS_ID = "2725816334213586962";
const descriptionsOf = (bm: BetbyBookmaker) =>
  loadJson<{ markets: BetbyMarketDescriptions }>(bm, "descriptions-markets.trimmed.json").markets;
const eventOf = (bm: BetbyBookmaker, id: string) =>
  loadJson<{ events: Record<string, BetbyEvent> }>(bm, `event-${id}.json`).events[id];
const leedsOf = (bm: BetbyBookmaker) => eventOf(bm, LEEDS_ID);

const D = descriptionsOf("betters");
const leeds = leedsOf("betters");
const C = ["Leeds United", "Tottenham Hotspur"] as [string, string];

const n = createBetbyNormalizer("betters");
const ctx: NormalizationContext = { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league" };
const sel = (id: string, name: string, odds: number) => ({ name, odds, externalId: id });

describe("betby normalizer", () => {
  // The normalizer logs one skip only (a phase-1 market whose specifier key set is not its
  // rule's). A test that expects it reads it with takeWarnings(); any other warning fails.
  let warn: MockInstance<typeof console.warn>;
  const takeWarnings = (): string[] => {
    const messages = warn.mock.calls.map((c) => String(c[0]));
    warn.mockClear();
    return messages;
  };
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    const left = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(left, "console.warn calls the test did not expect").toEqual([]);
  });

  it("maps MATCH_WINNER by outcome id, with string or numeric market id", () => {
    for (const id of ["1", 1]) {
      const out = n.normalizeMarket({ bookmakerMarketId: id, name: "1x2", selections: [sel("1", "Leeds United", 2.74), sel("2", "remis", 3.3), sel("3", "Tottenham Hotspur", 2.54)] }, ctx)!;
      expect(out).toMatchObject({ marketCode: "MATCH_WINNER", marketKey: "MATCH_WINNER", debug: { matchedBy: "id" } });
      expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 2.74], ["DRAW", 3.3], ["AWAY", 2.54]]);
    }
  });

  it("totals half, integer and quarter lines", () => {
    const t = (p: string) => n.normalizeMarket({ bookmakerMarketId: "18", name: "Suma", paramValue: p, selections: [sel("12", "ponad", 1.93), sel("13", "poniżej", 1.85)] }, ctx)!;
    expect(t("total=2.5").marketKey).toBe("TOTAL_GOALS:2.5");
    expect(t("total=3").marketKey).toBe("TOTAL_GOALS_ASIAN:3");
    expect(t("total=2.75").marketKey).toBe("TOTAL_GOALS_ASIAN:2.75");
    expect(t("total=2.5").selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });

  it("handicap integer and quarter lines", () => {
    const h = (p: string) => n.normalizeMarket({ bookmakerMarketId: "16", name: "Handicap", paramValue: p, selections: [sel("1714", "Leeds United (-1.5)", 5.8), sel("1715", "Tottenham Hotspur (+1.5)", 1.13)] }, ctx);
    expect(h("hcp=-1.5")!.marketKey).toBe("ASIAN_HANDICAP:-1.5");
    expect(h("hcp=-1.5")!.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 5.8], ["AWAY", 1.13]]);
    // Decision D1 default: integer lines pool with fortuna/etoto/betfan/fuksiarz/lvbet under ASIAN_HANDICAP
    expect(h("hcp=-1.0")!.marketKey).toBe("ASIAN_HANDICAP:-1");
    expect(h("hcp=-1")!.marketKey).toBe("ASIAN_HANDICAP:-1");
    expect(h("hcp=0")!.marketKey).toBe("ASIAN_HANDICAP:0");
    expect(h("hcp=1")!.marketKey).toBe("ASIAN_HANDICAP:+1");
    expect(h("hcp=-0.25")).toBeNull();
    const fh = n.normalizeMarket({ bookmakerMarketId: "66", name: "1. połowa - handicap", paramValue: "hcp=0", selections: [sel("1714", "Leeds United (0)", 1.91), sel("1715", "Tottenham Hotspur (0)", 1.84)] }, ctx)!;
    expect(fh.marketKey).toBe("FIRST_HALF_ASIAN_HANDICAP:0");
    expect(fh.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 1.91], ["AWAY", 1.84]]);
  });

  it("european handicap a:b -> signed home goal start", () => {
    const e = (p: string) => n.normalizeMarket({ bookmakerMarketId: "14", name: "Handicap europejski", paramValue: p, selections: [sel("1711", "Leeds United (1:0)", 1.5), sel("1712", "remis (1:0)", 3.9), sel("1713", "Tottenham Hotspur (1:0)", 4.9)] }, ctx);
    expect(e("hcp=1:0")!.marketKey).toBe("EUROPEAN_HANDICAP:+1");
    expect(e("hcp=1:0")!.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
    expect(e("hcp=0:1")!.marketKey).toBe("EUROPEAN_HANDICAP:-1");
    expect(e("hcp=1:1")).toBeNull();
  });

  it("line rules skip blank, malformed and off-grid lines", () => {
    // Each rule gets outcome ids it maps, so a null can only come from the line guard.
    type Sel = ReturnType<typeof sel>;
    const OU = [sel("12", "ponad", 1.9), sel("13", "poniżej", 1.9)];
    const AH = [sel("1714", "Leeds United", 1.9), sel("1715", "Tottenham Hotspur", 1.9)];
    const EH = [sel("1711", "Leeds United", 1.5), sel("1712", "remis", 3.9), sel("1713", "Tottenham Hotspur", 4.9)];
    const norm = (id: string, p: string, sels: Sel[]) => n.normalizeMarket({ bookmakerMarketId: id, name: "x", paramValue: p, selections: sels }, ctx);
    const LINE_RULES: [string, "total" | "hcp", string, Sel[]][] = [
      ["18", "total", "2.5", OU], ["68", "total", "2.5", OU], ["90", "total", "2.5", OU], ["19", "total", "1.5", OU], ["20", "total", "1.5", OU],
      ["37", "total", "2.5", [sel("794", "Leeds United i poniżej", 4), sel("796", "Leeds United i ponad", 4)]],
      ["36", "total", "2.5", [sel("90", "ponad i tak", 2.5), sel("92", "poniżej i tak", 5)]],
      ["547", "total", "2.5", [sel("1724", "1X i poniżej", 2.6), sel("1727", "1X i ponad", 2.2)]],
      ["16", "hcp", "-1.5", AH], ["66", "hcp", "-1.5", AH],
    ];
    for (const [id, key, good, sels] of LINE_RULES) {
      expect(norm(id, `${key}=${good}`, sels), `${id} ${key}=${good}`).not.toBeNull(); // control
      for (const bad of ["abc", "", " ", "2.3", "0.3", "Infinity", "NaN", "1e1"]) expect(norm(id, `${key}=${bad}`, sels), `${id} ${key}=${bad}`).toBeNull();
      expect(norm(id, "", sels), `${id} without ${key}`).toBeNull();
    }
    for (const id of ["18", "68", "90"]) for (const bad of ["0", "-2.5"]) expect(norm(id, `total=${bad}`, OU), `${id} total=${bad}`).toBeNull();
    for (const id of ["14", "65"]) {
      expect(norm(id, "hcp=1:0", EH)!.marketKey).toMatch(/EUROPEAN_HANDICAP:\+1$/); // control
      for (const bad of ["x:0", "0:x", "1", "1:", ":1", "", "1:1", "-1:0", "1.5:0"]) expect(norm(id, `hcp=${bad}`, EH), `${id} hcp=${bad}`).toBeNull();
    }
    // A bad line is skipped quietly; a line market with no specifier at all changed shape.
    expect(takeWarnings()).toEqual(
      LINE_RULES.map(([id, key]) => `[betters] Skipped market ${id}[]: specifier keys {} are not the rule's {${key}}`),
    );
  });

  it("correct score names -> h-a codes and inny -> OTHER", () => {
    // Leeds evidence: 274 "0:0" 9.75, 276 "1:0" 8.5; 324 "inny" is in the descriptions but not offered on Leeds, so its odds are synthetic
    const cs = n.normalizeMarket({ bookmakerMarketId: "45", name: "Dokładny wynik", selections: [sel("274", "0:0", 9.75), sel("276", "1:0", 8.5), sel("324", "inny", 40)] }, ctx)!;
    expect(cs.marketKey).toBe("CORRECT_SCORE");
    expect(cs.selections.map((s) => [s.code, s.odds])).toEqual([["0-0", 9.75], ["1-0", 8.5], ["OTHER", 40]]);
  });

  it("goal range, exact goals and first goal rules", () => {
    const g = n.normalizeMarket({ bookmakerMarketId: "25", name: "Przedział goli", paramValue: "variant=sr:goal_range:7+", selections: [
      sel("sr:goal_range:7+:1342", "0-1 goli", 3.1), sel("sr:goal_range:7+:1343", "2-3 gole", 1.9), sel("sr:goal_range:7+:1344", "4-6 goli", 3.4), sel("sr:goal_range:7+:1345", "7+ goli", 30)] }, ctx)!;
    expect(g.marketKey).toBe("GOAL_RANGE");
    expect(g.selections.map((s) => s.code)).toEqual(["0-1", "2-3", "4-6", "7+"]);
    const x = n.normalizeMarket({ bookmakerMarketId: "50063", name: "Dokładna liczba goli", selections: [
      sel("bb:exact_goals:0", "0", 10), sel("bb:exact_goals:8", "8", 100), sel("bb:exact_goals:10", "10", 150)] }, ctx)!;
    expect(x.selections.map((s) => [s.code, s.odds])).toEqual([["0", 10], ["8", 100]]); // catalog EXACT_GOALS has no "10"
    const f = (p: string) => n.normalizeMarket({ bookmakerMarketId: "8", name: "1. gol", paramValue: p, selections: [
      sel("6", "Leeds United", 2.0), sel("7", "żaden", 9.5), sel("8", "Tottenham Hotspur", 1.95)] }, ctx);
    expect(f("goalnr=1")!.marketKey).toBe("FIRST_TEAM_TO_SCORE");
    expect(f("goalnr=1")!.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 2], ["NONE", 9.5], ["AWAY", 1.95]]);
    expect(f("goalnr=2")).toBeNull();
  });

  it("unknown outcome ids are dropped and unmapped ids return null", () => {
    const partial = n.normalizeMarket({ bookmakerMarketId: "1", name: "1x2", selections: [sel("1", "Leeds United", 2.74), sel("99", "?", 5), sel("3", "Tottenham Hotspur", 2.54)] }, ctx)!;
    expect(partial.selections.map((s) => s.code)).toEqual(["HOME", "AWAY"]);
    expect(n.normalizeMarket({ bookmakerMarketId: "1", name: "1x2", selections: [sel("99", "?", 2)] }, ctx)).toBeNull();
    expect(n.normalizeMarket({ bookmakerMarketId: "50031", name: "Zawodnik strzeli", selections: [sel("1", "x", 2)] }, ctx)).toBeNull();
    expect(n.normalizeMarket({ bookmakerMarketId: "19", name: "Leeds United - suma", paramValue: "total=1", selections: [sel("12", "ponad 1", 1.5), sel("13", "poniżej 1", 2.5)] }, ctx)).toBeNull();
  });

  it("every rule code exists in the catalog", () => {
    for (const r of Object.values(BETBY_MARKET_RULES)) for (const c of r.codes) expect(isValidMarketCode(c)).toBe(true);
    expect(Object.keys(BETBY_MARKET_RULES)).toHaveLength(36);
  });

  it("phase-1 coverage on Leeds-Tottenham evidence: 68 of 242 markets, distinct keys, no UNKNOWN", () => {
    const markets = buildScrapedMarkets(leeds.markets, D, C);
    const outs = markets.map((m) => n.normalizeMarket(m, ctx)).filter(Boolean);
    expect(outs).toHaveLength(68);
    expect(new Set(outs.map((o) => o!.marketKey)).size).toBe(68);
    expect(outs.flatMap((o) => o!.selections).some((s) => s.code === "UNKNOWN")).toBe(false);
  });

  it("bettersNormalizer and lebullNormalizer keep their bookmaker keys", () => {
    expect(bettersNormalizer.bookmaker).toBe("betters"); expect(lebullNormalizer.bookmaker).toBe("lebull");
  });

  // Beyond the brief: integrity checks on the evidence and on inputs the table must not misread.

  it("evidence prices land on the right side and line for both brands", () => {
    const byKey = (bm: BetbyBookmaker) => {
      const norm = bm === "betters" ? bettersNormalizer : lebullNormalizer;
      const outs = buildScrapedMarkets(leedsOf(bm).markets, descriptionsOf(bm), C)
        .map((m) => norm.normalizeMarket(m, ctx))
        .filter((o): o is NormalizedMarketOutput => o !== null);
      return new Map(outs.map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));
    };
    const betters = byKey("betters");
    const lebull = byKey("lebull");
    expect(lebull.size).toBe(68);
    expect(betters.get("MATCH_WINNER")).toEqual([["HOME", 2.74], ["DRAW", 3.3], ["AWAY", 2.54]]);
    expect(lebull.get("MATCH_WINNER")).toEqual([["HOME", 2.76], ["DRAW", 3.3], ["AWAY", 2.56]]);
    for (const m of [betters, lebull]) {
      expect(m.get("ASIAN_HANDICAP:-1.5")).toEqual([["HOME", 5.8], ["AWAY", 1.13]]);
      expect(m.get("ASIAN_HANDICAP:-1")).toEqual([["HOME", 4.7], ["AWAY", 1.18]]);
      expect(m.get("ASIAN_HANDICAP:0")).toEqual([["HOME", 1.97], ["AWAY", 1.82]]);
      expect(m.get("ASIAN_HANDICAP:+1")).toEqual([["HOME", 1.21], ["AWAY", 4.3]]);
      expect(m.get("FIRST_HALF_ASIAN_HANDICAP:0")).toEqual([["HOME", 1.91], ["AWAY", 1.84]]);
      expect(m.get("EUROPEAN_HANDICAP:+1")).toEqual([["HOME", 1.5], ["DRAW", 3.9], ["AWAY", 4.9]]);
      expect(m.get("TOTAL_GOALS:2.5")).toEqual([["OVER", 1.93], ["UNDER", 1.85]]);
      expect(m.get("CORRECT_SCORE")).toHaveLength(30);
      expect(m.get("CORRECT_SCORE")).toContainEqual(["0-0", 9.75]);
      expect([...m.keys()].some((k) => k.includes("_PUSH"))).toBe(false);
    }
  });

  it("every evidence selection's code agrees with its Polish label", () => {
    // An oracle independent of the id table: it reads the label the parser rendered from the
    // description of each outcome id, so a swapped id in a map shows up as a mismatch.
    const WORD: Record<string, string> = {
      "1": "HOME", X: "DRAW", "2": "AWAY", tak: "YES", nie: "NO", ponad: "OVER", "poniżej": "UNDER",
      "żaden": "NONE", "bez gola": "NONE", nieparzysty: "ODD", parzysty: "EVEN",
      "1. Połowa": "1ST_HALF", "2. Połowa": "2ND_HALF", "równo": "DRAW",
    };
    const PAIR: Record<string, string> = {
      "1 lub X": "HOME_OR_DRAW", "1 lub 2": "HOME_OR_AWAY", "X lub 2": "DRAW_OR_AWAY", "1/X": "1X", "1/2": "12", "X/2": "X2",
    };
    const fromLabel = (marketCode: string, label: string): string | undefined => {
      if (marketCode === "CORRECT_SCORE" || marketCode === "HALF_TIME_CORRECT_SCORE") return label === "inny" ? "OTHER" : label.replace(":", "-");
      if (marketCode === "GOAL_RANGE") return label.split(" ")[0];
      if (marketCode === "EXACT_GOALS") return label;
      const tokens = label.replaceAll(C[0], "1").replaceAll(C[1], "2").replaceAll("remis", "X")
        .replace(/ \([^)]*\)$/, "") // handicap legs: "Leeds United (-1.5)", "remis (1:0)"
        .replace(/(ponad|poniżej) \S+/g, "$1"); // total legs: "ponad 2.5"
      return tokens.split(" & ")
        .map((p) => (marketCode === "HALFTIME_FULLTIME" ? p.split("/").map((w) => WORD[w]).join("_") : (PAIR[p] ?? WORD[p])))
        .join("_");
    };
    for (const bm of ["betters", "lebull"] as const) {
      const norm = bm === "betters" ? bettersNormalizer : lebullNormalizer;
      const outs = buildScrapedMarkets(leedsOf(bm).markets, descriptionsOf(bm), C)
        .map((m) => norm.normalizeMarket(m, ctx))
        .filter((o): o is NormalizedMarketOutput => o !== null);
      const checked = outs.flatMap((o) => o.selections.map((s) => [o.marketKey, s.label, s.code, fromLabel(o.marketCode, s.label)]));
      expect(checked.filter(([, , code, expected]) => code !== expected), bm).toEqual([]);
      expect(checked.length, bm).toBeGreaterThan(200);
    }
  });

  it("rules skip a specifier with keys their market does not define", () => {
    // UOF time windows come as extra keys (`from=0:00|to=15:00|total=0.5`): such a market is a
    // different bet, so it must not land on the full-match code.
    const OU = [sel("12", "ponad", 1.9), sel("13", "poniżej", 1.9)];
    const norm = (id: string, p: string, sels = OU) => n.normalizeMarket({ bookmakerMarketId: id, name: "x", paramValue: p, selections: sels }, ctx);
    expect(norm("18", "from=0:00|to=15:00|total=0.5")).toBeNull();
    expect(norm("18", "total=2.5|from=0:00")).toBeNull();
    expect(norm("1", "from=0:00|to=15:00", [sel("1", "Leeds United", 2), sel("2", "remis", 3), sel("3", "Tottenham Hotspur", 4)])).toBeNull();
    expect(norm("8", "goalnr=1|type=general", [sel("6", "Leeds United", 2), sel("7", "żaden", 9), sel("8", "Tottenham Hotspur", 2)])).toBeNull();
    expect(norm("25", "variant=sr:goal_range:7+|total=2.5", [sel("sr:goal_range:7+:1342", "0-1 goli", 3)])).toBeNull();
    expect(takeWarnings()).toEqual([
      "[betters] Skipped market 18[from=0:00|to=15:00|total=0.5]: specifier keys {from,to,total} are not the rule's {total}",
      "[betters] Skipped market 18[total=2.5|from=0:00]: specifier keys {total,from} are not the rule's {total}",
      "[betters] Skipped market 1[from=0:00|to=15:00]: specifier keys {from,to} are not the rule's {}",
      "[betters] Skipped market 8[goalnr=1|type=general]: specifier keys {goalnr,type} are not the rule's {goalnr}",
      "[betters] Skipped market 25[variant=sr:goal_range:7+|total=2.5]: specifier keys {variant,total} are not the rule's {variant}",
    ]);
  });

  it("goal range maps only the sr:goal_range:7+ variant, by outcome id", () => {
    // In the same description the bb:goal_range:11+ variant names `…:0-2` "0-1 goli": names are not trusted.
    const g = (variant: string, id: string, name: string) =>
      n.normalizeMarket({ bookmakerMarketId: "25", name: "Przedział goli", paramValue: `variant=${variant}`, selections: [sel(id, name, 3)] }, ctx);
    expect(g("bb:goal_range:11+", "bb:goal_range:11+:0-2", "0-1 goli")).toBeNull();
    expect(g("sr:point_range:6+", "sr:point_range:6+:1121", "0-1 goli")).toBeNull();
    expect(g("sr:goal_range:7+", "sr:goal_range:7+:9999", "0-1 goli")).toBeNull();
    expect(n.normalizeMarket({ bookmakerMarketId: "25", name: "Przedział goli", selections: [sel("sr:goal_range:7+:1342", "0-1 goli", 3)] }, ctx)).toBeNull();
    expect(takeWarnings()).toEqual(["[betters] Skipped market 25[]: specifier keys {} are not the rule's {variant}"]);
  });

  it("ids that name Object.prototype members or are missing are unknown", () => {
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(n.normalizeMarket({ bookmakerMarketId: id, name: "x", selections: [sel("1", "Leeds United", 2)] }, ctx), id).toBeNull();
      expect(n.normalizeMarket({ bookmakerMarketId: "1", name: "1x2", selections: [sel(id, "?", 2)] }, ctx), id).toBeNull();
    }
    expect(n.normalizeMarket({ name: "1x2", selections: [sel("1", "Leeds United", 2)] }, ctx)).toBeNull();
    expect(n.normalizeMarket({ bookmakerMarketId: "1", name: "1x2", selections: [{ name: "Leeds United", odds: 2 }] }, ctx)).toBeNull();
  });

  // The exact-key rule skips a market silently when the feed adds or drops a specifier key, and
  // a match can lose a whole family (the nine TOTAL_GOALS lines of 18) yet still clear the
  // smoke's market-count floor. These tests pin the keys, the detector the smoke gate uses, and
  // the per-event counts of the 2026-11-06 baseline (evidence/betters/phase1-counts-pl-2026-11-06.txt).

  it("every rule names the specifier keys its market defines", () => {
    const KEYS: Record<string, string[]> = { "8": ["goalnr"], "25": ["variant"] };
    for (const id of ["1", "10", "11", "29", "75", "95", "60", "83", "63", "85", "64", "26", "45", "81", "47", "35", "546", "560", "561", "13670", "52", "50063"]) KEYS[id] = [];
    for (const id of ["18", "68", "90", "19", "20", "37", "36", "547"]) KEYS[id] = ["total"];
    for (const id of ["16", "66", "14", "65"]) KEYS[id] = ["hcp"];
    expect(Object.fromEntries(Object.entries(BETBY_MARKET_RULES).map(([id, r]) => [id, [...r.keys]]))).toEqual(KEYS);
    // resolve guards its own keys too, whoever calls it.
    const VALID: Record<string, Record<string, string>> = { "8": { goalnr: "1" }, "25": { variant: "sr:goal_range:7+" }, "14": { hcp: "1:0" }, "65": { hcp: "1:0" } };
    for (const [id, r] of Object.entries(BETBY_MARKET_RULES)) {
      expect(Object.isFrozen(r.keys), id).toBe(true);
      const valid = VALID[id] ?? Object.fromEntries(r.keys.map((k) => [k, k === "hcp" ? "-1.5" : "2.5"]));
      expect(r.resolve(valid), `${id} control`).not.toBeNull();
      expect(r.resolve({ ...valid, from: "0:00" }), `${id} extra key`).toBeNull();
      if (r.keys.length > 0) expect(r.resolve({}), `${id} no keys`).toBeNull();
    }
    expect(betbyRuleFor(18)).toBe(BETBY_MARKET_RULES["18"]);
    for (const id of [undefined, "50031", "constructor", "__proto__"]) expect(betbyRuleFor(id), String(id)).toBeNull();
  });

  it("findSpecifierKeyMismatches reports a phase-1 pair with another key set, and only that", () => {
    const changed = [
      { bookmakerMarketId: "18", paramValue: "total=2.5|type=x" },
      { bookmakerMarketId: 1, paramValue: "from=0:00|to=15:00" },
      { bookmakerMarketId: "18" },
      { bookmakerMarketId: 16, paramValue: "hcp=-1.5|from=0:00" },
    ];
    const designed = [
      { bookmakerMarketId: "18", paramValue: "total=2.5" },
      { bookmakerMarketId: "19", paramValue: "total=1" }, // integer team-total line
      { bookmakerMarketId: "8", paramValue: "goalnr=2" }, // second goal
      { bookmakerMarketId: "25", paramValue: "variant=bb:goal_range:11+" }, // another variant
      { bookmakerMarketId: "50031", paramValue: "x=1" }, // no rule
      { bookmakerMarketId: "constructor", paramValue: "x=1" },
      { paramValue: "total=2.5" },
    ];
    const expected = ["18[total=2.5|type=x]", "1[from=0:00|to=15:00]", "18[]", "16[hcp=-1.5|from=0:00]"];
    expect(findSpecifierKeyMismatches([...changed, ...designed])).toEqual(expected);
    expect(findSpecifierKeyMismatches(designed)).toEqual([]);
    // The normalizer skips exactly the reported pairs with a warning that names the same pair.
    const OU = [sel("12", "ponad", 1.9), sel("13", "poniżej", 1.9), sel("1", "Leeds United", 2), sel("1714", "Leeds United", 2), sel("6", "Leeds United", 2)];
    for (const m of changed) expect(n.normalizeMarket({ ...m, name: "x", selections: OU }, ctx)).toBeNull();
    expect(takeWarnings().map((w) => w.split(" ")[3].replace(/:$/, ""))).toEqual(expected);
    for (const m of designed.slice(1)) expect(n.normalizeMarket({ ...m, name: "x", selections: OU }, ctx)).toBeNull();
  });

  it("evidence events: baseline counts, no key mismatch, only integer team-total lines skipped", () => {
    const EVIDENCE: [BetbyBookmaker, string, number][] = [
      ["betters", "2725816334213586962", 68], // Leeds United - Tottenham Hotspur, 7 Nov
      ["betters", "2725816334213586981", 71], // Arsenal FC - Hull City, 7 Nov
      ["betters", "2726177353700085769", 66], // Manchester United FC - Aston Villa FC, 8 Nov
      ["betters", "2725446939305979931", 34], // Liverpool FC - Manchester United FC, 22 Nov: thin far-future payload
      ["lebull", "2725816334213586962", 68],
    ];
    for (const [bm, id, count] of EVIDENCE) {
      const ev = eventOf(bm, id);
      const [home, away] = ev.desc.competitors.map((c) => c.name.trim());
      const norm = bm === "betters" ? bettersNormalizer : lebullNormalizer;
      const markets = buildScrapedMarkets(ev.markets, descriptionsOf(bm), [home, away]);
      const outs = markets.map((m) => [m, norm.normalizeMarket(m, { homeTeam: home, awayTeam: away, league: "premier-league" })] as const);
      const kept = outs.flatMap(([, o]) => (o === null ? [] : [o]));
      expect(kept, `${bm} ${id}`).toHaveLength(count);
      expect(new Set(kept.map((o) => o.marketKey)).size, `${bm} ${id}`).toBe(count);
      expect(findSpecifierKeyMismatches(markets), `${bm} ${id}`).toEqual([]);
      // HOME_/AWAY_TEAM_TOTAL_GOALS have no push settlement, so 19/20 keep half lines only.
      const skipped = outs.filter(([m, o]) => o === null && betbyRuleFor(m.bookmakerMarketId) !== null).map(([m]) => m);
      expect(skipped.length, `${bm} ${id}`).toBeGreaterThan(0);
      expect(
        skipped.filter((m) => !(["19", "20"].includes(m.bookmakerMarketId ?? "") && /^total=\d+$/.test(m.paramValue ?? ""))),
        `${bm} ${id}`,
      ).toEqual([]);
    }
  });

  it("listing markets of every snapshot event carry the keys their rules define", () => {
    for (const bm of ["betters", "lebull"] as const) {
      const events = Object.values(snapshotFrom(bm).events);
      const markets = events.flatMap((ev) => {
        const [home, away] = ev.desc.competitors.map((c) => c.name.trim());
        return buildScrapedMarkets(ev.markets, descriptionsOf(bm), [home, away]);
      });
      const phase1 = markets.filter((m) => betbyRuleFor(m.bookmakerMarketId) !== null);
      expect(new Set(phase1.map((m) => m.bookmakerMarketId)), bm).toEqual(new Set(["1", "10", "16", "18"]));
      expect(phase1.length, bm).toBeGreaterThan(events.length * 3);
      expect(findSpecifierKeyMismatches(markets), bm).toEqual([]);
    }
  });
});
