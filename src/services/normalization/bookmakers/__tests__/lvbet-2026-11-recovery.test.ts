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

describe("LVBet goal-family products out of the TOTAL_GOALS catch-all", () => {
  it("routes 'Rezultat lub ilość bramek (2.5)' to RESULT_OR_TOTAL:2.5", () => {
    const raw = parseAllMarkets(evidence, teams).find((m) => m.name.startsWith("Rezultat lub ilość bramek (2.5)"))!;
    const out = lvbetNormalizer.normalizeMarket(raw, ctx)!;
    expect(out.marketKey).toBe("RESULT_OR_TOTAL:2.5");
    expect(Object.fromEntries(out.selections.map((s) => [s.code, s.odds]))).toEqual({
      HOME_OVER: 1.09, HOME_UNDER: 1.03, DRAW_OVER: 1.3, DRAW_UNDER: 2.17, AWAY_OVER: 1.42, AWAY_UNDER: 2.15,
    });
  });

  it("leaves exactly one OVER/UNDER market on TOTAL_GOALS:2.5", () => {
    const outs = parseAllMarkets(evidence, teams).map((m) => lvbetNormalizer.normalizeMarket(m, ctx)).filter((o) => o?.marketKey === "TOTAL_GOALS:2.5");
    expect(outs).toHaveLength(1);
    expect(outs[0]!.selections.map((s) => [s.code, s.odds])).toEqual([["OVER", 1.55], ["UNDER", 2.5]]);
  });

  it("drops a RESULT_OR_TOTAL leg whose side or line does not match the market", () => {
    const out = lvbetNormalizer.normalizeMarket(
      {
        name: "Rezultat lub ilość bramek (2.5) 2.5",
        selections: [
          { name: "Arsenal lub powyżej (2.5)", odds: 1.09 },
          { name: "Chelsea lub powyżej (2.5)", odds: 1.5 },
          { name: "Arsenal lub remis lub powyżej (2.5)", odds: 1.01 },
          { name: "Hull City lub poniżej (3.5)", odds: 2.6 },
          { name: "Remis lub poniżej (2.5)", odds: 2.17 },
        ],
      },
      ctx
    )!;
    expect(out.marketKey).toBe("RESULT_OR_TOTAL:2.5");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["HOME_OVER", 1.09], ["DRAW_UNDER", 2.17]]);
  });

  it.each([
    ["Obaj gracze strzelą łącznie przynajmniej 2 gole", "TWO_PLAYERS_COMBINED_GOALS:1.5", ["K. Havertz & V. Gyokeres", 2.12]],
    ["Obaj gracze strzelą łącznie przynajmniej 3 gole", "TWO_PLAYERS_COMBINED_GOALS:2.5", ["K. Havertz & V. Gyokeres", 5.5]],
  ])("routes '%s' to %s with canonical pairs", (name, key, first) => {
    const out = lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === name)!, ctx)!;
    expect(out.marketKey).toBe(key);
    expect([out.selections[0].code, out.selections[0].odds]).toEqual(first);
  });

  it("maps the digit variant of 'Dokładna liczba goli' to EXACT_GOALS and leaves the 'Bez goli' twin as OTHER", () => {
    const [a, b] = parseAllMarkets(evidence, teams).filter((m) => m.name === "Dokładna liczba goli").map((m) => lvbetNormalizer.normalizeMarket(m, ctx));
    const exact = [a, b].find((o) => o?.marketCode === "EXACT_GOALS")!;
    expect(exact.selections.map((s) => [s.code, s.odds])).toEqual([["0", 14], ["1", 5.85], ["2", 4.05], ["3", 3.85], ["4", 4.55], ["5", 6.75], ["6+", 7.25]]);
    expect([a, b].filter((o) => o === null || o.marketCode === "OTHER")).toHaveLength(1);
  });

  it("routes 'Dokładnie 1 gol w meczu' to OTHER now that the full ladder maps", () => {
    expect(lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === "Dokładnie 1 gol w meczu")!, ctx)).toBeNull();
    const outs = parseAllMarkets(evidence, teams).map((m) => lvbetNormalizer.normalizeMarket(m, ctx)).filter((o) => o?.marketKey === "EXACT_GOALS");
    expect(outs).toHaveLength(1);
  });

  it("leaves exactly one OVER/UNDER market on HALF_TIME_TOTAL_GOALS:1.0 and :2.0", () => {
    const outs = parseAllMarkets(evidence, teams).map((m) => lvbetNormalizer.normalizeMarket(m, ctx));
    const at = (key: string) => outs.filter((o) => o?.marketKey === key).map((o) => o!.selections.map((s) => [s.code, s.odds]));
    expect(at("HALF_TIME_TOTAL_GOALS:1.0")).toEqual([[["OVER", 1.47], ["UNDER", 2.55]]]);
    expect(at("HALF_TIME_TOTAL_GOALS:2.0")).toEqual([[["OVER", 3.7], ["UNDER", 1.25]]]);
  });

  it("only the exact variant of each same-named exact-goals pair maps", () => {
    const pick = (name: string) => parseAllMarkets(evidence, teams).filter((m) => m.name === name)
      .map((m) => lvbetNormalizer.normalizeMarket(m, ctx)).filter((o) => o !== null)
      .map((o) => [o!.marketKey, o!.selections.map((s) => [s.code, s.odds])]);
    expect(pick("Arsenal - Dokładna liczba goli")).toEqual([["HOME_EXACT_GOALS", [["0", 7.25], ["1", 4.75], ["2", 3.4], ["3", 3.8], ["4+", 3.1]]]]);
    expect(pick("1. Połowa - Arsenal dokładna liczba goli")).toEqual([["HALF_TIME_HOME_EXACT_GOALS", [["0", 2.95], ["1", 2.5], ["2+", 2.45]]]]);
  });
});

/**
 * The World Cup France vs Morocco golden carries these goal-family entries
 * unblessed (owner decision: unblessed entries stay unblessed), so the golden
 * test does not assert them. Pin their new routing here instead, straight from
 * the committed raw fixture. Its selection labels use the Polish team names
 * ("Francja"/"Maroko") against the canonical English ctx.
 */
describe("LVBet goal-family routing on the World Cup France vs Morocco fixture", () => {
  const wc = JSON.parse(
    readFileSync(new URL("../../__fixtures__/lvbet/world-cup-2026_france_morocco.json", import.meta.url), "utf8")
  ) as { ctx: NormalizationContext; entries: { index: number; raw: { name: string; selections: { name: string; odds: number }[] } }[] };
  const normEntry = (index: number) => {
    const raw = wc.entries.find((e) => e.index === index)!.raw;
    return lvbetNormalizer.normalizeMarket({ name: raw.name, selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })) }, wc.ctx);
  };

  it.each([
    [775, "RESULT_OR_TOTAL:2.5", [["HOME_OVER", 1.25], ["HOME_UNDER", 1.08], ["DRAW_OVER", 1.35], ["DRAW_UNDER", 1.5], ["AWAY_OVER", 1.6], ["AWAY_UNDER", 1.47]]],
    [834, "RESULT_OR_TOTAL:3.5", [["HOME_OVER", 1.33], ["HOME_UNDER", 1.04], ["DRAW_OVER", 1.85], ["DRAW_UNDER", 1.16], ["AWAY_OVER", 2.2], ["AWAY_UNDER", 1.2]]],
    [839, "RESULT_OR_TOTAL:4.5", [["HOME_OVER", 1.4], ["DRAW_OVER", 2.25], ["DRAW_UNDER", 1.07], ["AWAY_OVER", 3.1], ["AWAY_UNDER", 1.07]]],
  ])("#%i maps to %s with every leg on a resolved side", (index, key, legs) => {
    const out = normEntry(index)!;
    expect(out.marketKey).toBe(key);
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual(legs);
  });

  it("#230 'Dokładna liczba goli' maps to EXACT_GOALS", () => {
    const out = normEntry(230)!;
    expect(out.marketKey).toBe("EXACT_GOALS");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["0", 6.5], ["1", 3.55], ["2", 2.95], ["3", 3.35], ["4", 4.8], ["5", 8.25], ["6+", 12]]);
  });

  it("#816 '1. połowa - Liczba goli (3-drogowo) 1' and #257 'Dokładnie 1 gol w meczu' normalize to null", () => {
    expect(normEntry(816)).toBeNull();
    expect(normEntry(257)).toBeNull();
  });
});
