import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { lvbetNormalizer, LVBET_PLAYER_LADDER_PATTERNS } from "../lvbet-normalizer.js";
import { parseAllMarkets, PLAYER_STAT_LADDER_NAMES } from "../../../../scrapers/bookmakers/lvbet/parser.js";
import type { NormalizationContext } from "../../types.js";
import type { LVBetMarket } from "../../../../scrapers/bookmakers/lvbet/types.js";

/**
 * LVBet recovery (2026-11): end-to-end parser + normalizer tests over a
 * verbatim client-api/v5 markets/search capture (Arsenal vs Hull City,
 * 2026-11-06, 39 raw markets in payload order).
 */
const evidence = JSON.parse(
  readFileSync(
    new URL("../../../../scrapers/bookmakers/lvbet/__tests__/fixtures/markets-search-arsenal-hull-2026-11-06.json", import.meta.url),
    "utf8"
  )
) as LVBetMarket[];
const teams = { homeTeam: "Arsenal", awayTeam: "Hull City" };
const ctx: NormalizationContext = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };

describe("LVBet 'Zawodnicy - statystyki' player ladders", () => {
  const norm = (name: string, player: string) =>
    lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === name && m.paramValue === player)!, ctx)!;

  it.each([
    ["Strzały", "Viktor Gyokeres", "PLAYER_SHOTS", [["3+", 1.35], ["4+", 1.88], ["5+", 2.95], ["6+", 5.2]]],
    ["Strzały celne", "Ben White", "PLAYER_SHOTS_ON_TARGET", [["1+", 4.2], ["2+", 15]]],
    ["Popełnione faule", "Ben White", "PLAYER_FOULS", [["1+", 1.6], ["2+", 3.85], ["3+", 10], ["4+", 21]]],
    ["Faule na zawodniku", "Viktor Gyokeres", "PLAYER_FOULS_WON", [["1+", 1.28], ["2+", 2.22], ["3+", 5], ["4+", 11]]],
    ["Odbiory (tackle)", "Ben White", "PLAYER_TACKLES", [["1+", 1.14], ["2+", 1.62], ["3+", 2.9], ["4+", 6.25]]],
    ["Asysty", "Ben White", "PLAYER_ASSISTS", [["1+", 4.35]]],
    ["Spalone zawodnika", "Viktor Gyokeres", "PLAYER_OFFSIDES", [["1+", 1.95], ["2+", 5.75], ["3+", 14]]],
    ["Obrony bramkarza", "Jack Butland", "PLAYER_SAVES", [["4+", 1.38], ["5+", 1.85], ["6+", 2.7], ["7+", 4.35]]],
    ["Strzały celne głową", "Viktor Gyokeres", "PLAYER_HEADER_SHOTS_ON_TARGET", [["1+", 2.9], ["2+", 11], ["3+", 25]]],
    ["Strzały celne spoza pola karnego", "Ben White", "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX", [["1+", 9.5], ["2+", 23]]],
  ])("maps ladder %s / %s to %s", (name, player, code, tiers) => {
    const out = norm(name, player);
    expect(out.marketCode).toBe(code);
    expect(out.paramValue).toBe(player);
    expect(out.marketKey).toBe(`${code}:${player}`);
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual(tiers);
  });

  it("drops a tier outside the catalog vocabulary but keeps the player (PLAYER_FOULS 5+)", () => {
    expect(norm("Popełnione faule", "Tim Iroegbunam").selections.map((s) => [s.code, s.odds])).toEqual([["2+", 1.42], ["3+", 2.25], ["4+", 4.3]]);
  });

  it("drops a ladder tier past the catalog ladder instead of publishing it as a line-less OVER", () => {
    // PLAYER_SHOTS_ON_TARGET's vocabulary stops at 7+ but also holds OVER; an
    // 8+ tier ("Powyzej 7.5") must be dropped, not leak as OVER.
    const ladder = evidence.find((m) => m.name === "Strzały celne")!;
    const deep: LVBetMarket = {
      ...ladder,
      market_id: "bc:deep",
      selections: [
        { selection_id: "bc:1", name: "Ben White 1+", order: 0, rate: { decimal: 4.2 } },
        { selection_id: "bc:2", name: "Ben White 8+", order: 1, rate: { decimal: 60 } },
      ],
    };
    const rows = parseAllMarkets([deep], teams);
    expect(rows.map((m) => [m.paramValue, m.selections.map((s) => s.name)])).toEqual([["Ben White", ["Powyzej 0.5", "Powyzej 7.5"]]]);
    const out = lvbetNormalizer.normalizeMarket(rows[0], ctx)!;
    expect(out.marketKey).toBe("PLAYER_SHOTS_ON_TARGET:Ben White");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["1+", 4.2]]);
  });

  it("maps the renamed 'Zawodnik strzeli gola i zanotuje asystę' to PLAYER_GOAL_AND_ASSIST", () => {
    const raw = parseAllMarkets(evidence, teams).find((m) => m.name === "Zawodnik strzeli gola i zanotuje asystę")!;
    const out = lvbetNormalizer.normalizeMarket(raw, ctx)!;
    expect(out.marketCode).toBe("PLAYER_GOAL_AND_ASSIST");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["Christos Tzolis", 4.45], ["Noni Madueke", 5.25], ["Martin Odegaard", 5.65], ["Viktor Gyokeres", 6.25]]);
  });

  it("an unsplit ladder without paramValue normalizes to null", () => {
    expect(lvbetNormalizer.normalizeMarket({ name: "Strzały", selections: [{ name: "Abdulkadir Omur 1+", odds: 1.5 }] }, ctx)).toBeNull();
    expect(lvbetNormalizer.normalizeMarket({ name: "Strzały", selections: [{ name: "Powyzej 2.5", odds: 1.35 }] }, ctx)).toBeNull();
  });

  it("does not split N+ selections outside the Zawodnicy - statystyki group, and the unsplit row normalizes to null", () => {
    const fake = { ...evidence.find((m) => m.name === "Strzały")!, market_id: "bc:x", markets_group: { name: "Drużyna 1", markets_group_id: 1 } };
    const rows = parseAllMarkets([fake], teams);
    expect(rows).toHaveLength(1);
    expect(lvbetNormalizer.normalizeMarket(rows[0], ctx)).toBeNull();
  });

  it("every parser ladder name has exactly one normalizer ladder pattern", () => {
    for (const n of PLAYER_STAT_LADDER_NAMES) expect(LVBET_PLAYER_LADDER_PATTERNS.filter((p) => p.pattern.test(n))).toHaveLength(1);
  });
});

describe("LVBet goal-or-assist markets", () => {
  it("routes the goal-or-assist Podwójna szansa pair market to TWO_PLAYERS_GOAL_OR_ASSIST", () => {
    const out = lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === "Zawodnik strzeli gola lub zanotuje asystę - Podwójna szansa")!, ctx)!;
    expect(out.marketKey).toBe("TWO_PLAYERS_GOAL_OR_ASSIST");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["C. Tzolis & K. Havertz", 1.18], ["K. Havertz & M. Odegaard", 1.2], ["C. Tzolis & M. Odegaard", 1.22]]);
  });

  it("keeps single-player PLAYER_GOAL_OR_ASSIST free of pair selections", () => {
    const out = lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === "Zawodnik strzeli gola lub zanotuje asystę")!, ctx)!;
    expect(out.marketKey).toBe("PLAYER_GOAL_OR_ASSIST");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["Christos Tzolis", 1.5], ["Viktor Gyokeres", 1.55], ["Kai Havertz", 1.57], ["Noni Madueke", 1.65]]);
  });
});
