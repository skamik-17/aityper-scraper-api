import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

const ctx = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };
type Row = [name: string, selections: [string, number][], paramValue: string, marketKey: string];
const ROWS: Row[] = [
  ["Liczba odbiorów (OPTA) (z dogrywką) - Arsenal", [["Powyżej 10,5", 1.32], ["Poniżej 10,5", 2.55]], "HOME:10.5", "TEAM_TOTAL_TACKLES:HOME:10.5"],
  ["Liczba odbiorów (OPTA) (z dogrywką) - Hull", [["Powyżej 15,5", 1.24], ["Poniżej 15,5", 2.95]], "AWAY:15.5", "TEAM_TOTAL_TACKLES:AWAY:15.5"],
];

describe("betclic TEAM_TOTAL_TACKLES carries the team side", () => {
  it.each(ROWS)("betclic team tackles: %s", (name, sels, paramValue, marketKey) => {
    const out = betclicNormalizer.normalizeMarket({ name, selections: sels.map(([n, odds]) => ({ name: n, odds })) }, ctx);
    expect(out?.marketCode).toBe("TEAM_TOTAL_TACKLES");
    expect(out?.paramValue).toBe(paramValue);
    expect(out?.marketKey).toBe(marketKey);
    expect(out?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });
  it("betclic team tackles: equal lines for both teams get distinct keys (Fulham vs Newcastle 16.5 collision)", () => {
    // Arsenal 14.5 is real; the Hull 14.5 line is synthetic (same odds) to reproduce the equal-line collision
    const sels = [{ name: "Powyżej 14,5", odds: 2.75 }, { name: "Poniżej 14,5", odds: 1.27 }];
    const home = betclicNormalizer.normalizeMarket({ name: "Liczba odbiorów (OPTA) (z dogrywką) - Arsenal", selections: sels }, ctx);
    const away = betclicNormalizer.normalizeMarket({ name: "Liczba odbiorów (OPTA) (z dogrywką) - Hull", selections: sels }, ctx);
    expect([home?.marketKey, away?.marketKey]).toEqual(["TEAM_TOTAL_TACKLES:HOME:14.5", "TEAM_TOTAL_TACKLES:AWAY:14.5"]);
  });

  // Derby guard: "Manchester United" shares "united" with "Newcastle United", so
  // the team matcher reports both sides. A side-keyed tackles line whose side is
  // ambiguous stays OTHER instead of being published under a guessed side.
  it("betclic team tackles: keeps the line OTHER when the label matches both sides", () => {
    const derby = { homeTeam: "Newcastle United", awayTeam: "Manchester United", league: "premier-league" };
    const ou = (line: string): { name: string; odds: number }[] => [
      { name: `Powyżej ${line}`, odds: 1.8 },
      { name: `Poniżej ${line}`, odds: 1.9 },
    ];

    const ambiguous = betclicNormalizer.normalizeMarket({ name: "Liczba odbiorów (OPTA) (z dogrywką) - Manchester United", selections: ou("16,5") }, derby);
    expect(ambiguous?.marketCode).toBe("OTHER");
    expect(ambiguous?.marketKey).toBe("OTHER");

    const home = betclicNormalizer.normalizeMarket({ name: "Liczba odbiorów (OPTA) (z dogrywką) - Newcastle", selections: ou("16,5") }, derby);
    expect(home?.marketCode).toBe("TEAM_TOTAL_TACKLES");
    expect(home?.paramValue).toBe("HOME:16.5");
    expect(home?.marketKey).toBe("TEAM_TOTAL_TACKLES:HOME:16.5");
    expect(home?.selections.map((s) => [s.code, s.odds])).toEqual([["OVER", 1.8], ["UNDER", 1.9]]);
  });

  // A team part carrying a period qualifier is a period-scoped line and stays
  // OTHER instead of pooling with full-match HOME:/AWAY: tackles lines.
  it.each([
    "Liczba odbiorów (OPTA) (z dogrywką) - Arsenal - 1. połowa",
    "Liczba odbiorów (OPTA) (z dogrywką) - Arsenal (1. połowa)",
    "Liczba odbiorów (OPTA) - Hull- 2. połowa",
  ])("betclic team tackles: keeps a period-scoped line OTHER: %s", (name) => {
    const out = betclicNormalizer.normalizeMarket({ name, selections: [{ name: "Powyżej 7,5", odds: 1.8 }, { name: "Poniżej 7,5", odds: 1.9 }] }, ctx);
    expect(out?.marketCode).toBe("OTHER");
    expect(out?.marketKey).toBe("OTHER");
  });

  it("betclic team tackles: a hyphenated team name (Saint-Étienne) still resolves its side", () => {
    const out = betclicNormalizer.normalizeMarket(
      { name: "Liczba odbiorów (OPTA) (z dogrywką) - Saint-Étienne", selections: [{ name: "Powyżej 15,5", odds: 1.8 }, { name: "Poniżej 15,5", odds: 1.9 }] },
      { homeTeam: "Lyon", awayTeam: "Saint-Etienne", league: "ligue-1" },
    );
    expect(out?.marketCode).toBe("TEAM_TOTAL_TACKLES");
    expect(out?.marketKey).toBe("TEAM_TOTAL_TACKLES:AWAY:15.5");
  });
});
