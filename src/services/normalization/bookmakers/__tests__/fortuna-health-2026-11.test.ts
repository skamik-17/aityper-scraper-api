import { readFileSync } from "fs";
import { describe, it, expect, vi } from "vitest";
import { fortunaNormalizer } from "../fortuna-normalizer.js";
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
