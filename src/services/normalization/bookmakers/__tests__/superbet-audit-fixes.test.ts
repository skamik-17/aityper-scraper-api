// Regression tests for superbet normalizer fixes from the 2026-11-06 health
// check (docs/superpowers/plans/2026-11-06-scraper-recovery/superbet.md).
// Raw market names, ids and odds mirror the captured payloads in
// docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/superbet/.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { superbetNormalizer } from "../superbet-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../../types.js";

const bou: NormalizationContext = {
  homeTeam: "AFC Bournemouth",
  awayTeam: "Nottingham Forest",
  league: "premier-league",
};
const touLyo: NormalizationContext = {
  homeTeam: "Toulouse",
  awayTeam: "Lyon",
  league: "ligue-1",
};
const arsHul: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Hull City",
  league: "premier-league",
};
const arsCov: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Coventry City",
  league: "premier-league",
};

function run(raw: RawBookmakerMarket, ctx: NormalizationContext) {
  const out = superbetNormalizer.normalizeMarket(raw, ctx);
  if (!out) throw new Error("normalizeMarket returned null");
  return out;
}

// OTHER-by-name results log an expected "[superbet] Unmapped market" warning;
// silence it so the test output stays clean.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("superbet: names containing 'ou' never become TOTAL_GOALS", () => {
  it("232515 Bournemouth leader market is OTHER by id", () => {
    const out = run(
      {
        bookmakerMarketId: "232515",
        name: "Bournemouth będzie prowadzić w dowolnym momencie",
        selections: [
          { name: "Tak", odds: 1.49 },
          { name: "Nie", odds: 2.42 },
        ],
      },
      bou
    );
    expect(out.marketCode).toBe("OTHER");
    expect(out.marketKey).toBe("OTHER");
    expect(out.debug?.matchedBy).toBe("id");
  });

  it("232507 Bournemouth 2-in-a-row is OTHER, not TOTAL_GOALS:2", () => {
    const out = run(
      {
        bookmakerMarketId: "232507",
        name: "Bournemouth strzeli co najmniej 2 gole z rzędu",
        selections: [
          { name: "Tak", odds: 2.27 },
          { name: "Nie", odds: 1.54 },
        ],
      },
      bou
    );
    expect(out.marketKey).toBe("OTHER");
    expect(out.paramValue).toBeUndefined();
  });

  it("232513 Bournemouth comeback is OTHER", () => {
    const out = run(
      {
        bookmakerMarketId: "232513",
        name: "Bournemouth wygra wcześniej przegrywając",
        selections: [
          { name: "Tak", odds: 8.6 },
          { name: "Nie", odds: 1.04 },
        ],
      },
      bou
    );
    expect(out.marketCode).toBe("OTHER");
  });

  it("Toulouse leader market without id is OTHER", () => {
    const out = run(
      {
        name: "Toulouse będzie prowadzić w dowolnym momencie",
        selections: [
          { name: "Tak", odds: 1.5 },
          { name: "Nie", odds: 2.4 },
        ],
      },
      touLyo
    );
    expect(out.marketCode).toBe("OTHER");
    expect(out.debug?.matchedBy).toBe("name");
  });

  it("genuine O/U names stay TOTAL_GOALS", () => {
    for (const name of ["O/U 2.5", "Over/Under 2.5"]) {
      const out = run(
        {
          name,
          selections: [
            { name: "Powyżej 2.5", odds: 1.8 },
            { name: "Poniżej 2.5", odds: 2.0 },
          ],
        },
        arsHul
      );
      expect(out.marketKey, name).toBe("TOTAL_GOALS:2.5");
      expect(out.selections.map((s) => s.code), name).toEqual(["OVER", "UNDER"]);
    }
  });

  it("player head-to-head with 'ou' name is OTHER", () => {
    const out = run(
      {
        bookmakerMarketId: "232370",
        name: "Więcej asyst: Odegaard, Martin vs Tchaouna, Loum",
        selections: [
          { name: "Odegaard, Martin", odds: 1.5 },
          { name: "Tchaouna, Loum", odds: 2.5 },
        ],
      },
      arsCov
    );
    expect(out.marketCode).toBe("OTHER");
  });
});
