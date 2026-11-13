import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { lvbetNormalizer, LVBET_PLAYER_LADDER_PATTERNS } from "../lvbet-normalizer.js";
import { betclicNormalizer } from "../betclic-normalizer.js";
import { parseAllMarkets, PLAYER_STAT_LADDER_NAMES } from "../../../../scrapers/bookmakers/lvbet/parser.js";
import { getMarketByCode } from "../../../../data/market-catalog.js";
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

  it("parser ladder names and normalizer ladder patterns match one to one", () => {
    expect(LVBET_PLAYER_LADDER_PATTERNS).toHaveLength(PLAYER_STAT_LADDER_NAMES.size);
    for (const n of PLAYER_STAT_LADDER_NAMES) expect(LVBET_PLAYER_LADDER_PATTERNS.filter((p) => p.pattern.test(n))).toHaveLength(1);
    for (const { pattern } of LVBET_PLAYER_LADDER_PATTERNS) expect([...PLAYER_STAT_LADDER_NAMES].filter((n) => pattern.test(n))).toHaveLength(1);
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
    const raw = parseAllMarkets(evidence, teams).find((m) => m.name === name)!;
    const out = lvbetNormalizer.normalizeMarket(raw, ctx)!;
    expect(out.marketKey).toBe(key);
    expect([out.selections[0].code, out.selections[0].odds]).toEqual(first);
    // Every raw pair survives once, at its own leg's price: a canonicalization
    // merge or a duplicate pair code cannot pass.
    expect(out.selections).toHaveLength(raw.selections.length);
    const codes = out.selections.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(out.selections.map((s) => [s.label, s.odds])).toEqual(raw.selections.map((s) => [s.name, s.odds]));
  });

  // LVBet's pair labels carry betclic's feed truncation of "Gabriel
  // Magalhães" ("V. Gyokeres & Gabriel Mag"). TWO_PLAYERS_COMBINED_GOALS is
  // a decimal-param market, so the grouper never reconciles player-name
  // variants on it: the pair code must equal betclic's at the source.
  it.each([
    ["Obaj gracze strzelą łącznie przynajmniej 2 gole", "V. Gyokeres & Gabriel Mag", "2 graczy strzeli pow. 1,5 gola", "Gabriel Mag & V. Gyokeres", "TWO_PLAYERS_COMBINED_GOALS:1.5", "G. Magalhaes & V. Gyokeres"],
    ["Obaj gracze strzelą łącznie przynajmniej 3 gole", "C. Tzolis & Gabriel Mag", "2 graczy strzeli pow. 2,5 gola", "C. Tzolis & Gabriel Mag", "TWO_PLAYERS_COMBINED_GOALS:2.5", "C. Tzolis & G. Magalhaes"],
    ["Obaj gracze strzelą łącznie przynajmniej 4 gole", "Gabriel Mag & N. Madueke", "2 graczy strzeli pow. 3,5 gola", "N. Madueke & Gabriel Mag", "TWO_PLAYERS_COMBINED_GOALS:3.5", "G. Magalhaes & N. Madueke"],
  ])("'%s' / '%s' gives betclic's pair code", (lvName, lvPair, bcName, bcPair, key, code) => {
    const lv = lvbetNormalizer.normalizeMarket({ name: lvName, selections: [{ name: lvPair, odds: 3.1 }] }, ctx)!;
    const bc = betclicNormalizer.normalizeMarket({ name: bcName, selections: [{ name: bcPair, odds: 3.2 }] }, { ...ctx, bookmaker: "betclic" } as NormalizationContext)!;
    expect(lv.marketKey).toBe(key);
    expect(bc.marketKey).toBe(key);
    expect(lv.selections.map((s) => [s.code, s.odds])).toEqual([[code, 3.1]]);
    expect(bc.selections.map((s) => s.code)).toEqual([code]);
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

/**
 * Final whole-branch review (2026-11-13): integrity hardening of sibling
 * names and the exact-goals catch-all fold.
 */
describe("LVBet final-review hardening", () => {
  const norm = (name: string, sels: Array<[string, number]>, bookmakerMarketId?: string) =>
    lvbetNormalizer.normalizeMarket({ name, bookmakerMarketId, selections: sels.map(([n, odds]) => ({ name: n, odds })) }, ctx);
  const pairs = (out: ReturnType<typeof norm>) => out!.selections.map((s) => [s.code, s.odds]);
  const withWarnSpy = (fn: (warn: ReturnType<typeof vi.spyOn>) => void) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fn(warn);
    } finally {
      warn.mockRestore();
    }
  };

  describe("exact-goals catch-all never publishes a partial fold (ruling 7)", () => {
    it("ladder 0..6 plus 7+ publishes literal 0..6 and no 6+ derived from 7+", () => {
      withWarnSpy((warn) => {
        const out = norm("Dokładna liczba goli", [["0", 14], ["1", 5.85], ["2", 4.05], ["3", 3.85], ["4", 4.55], ["5", 6.75], ["6", 9.5], ["7+", 11]]);
        expect(out!.marketKey).toBe("EXACT_GOALS");
        expect(pairs(out)).toEqual([["0", 14], ["1", 5.85], ["2", 4.05], ["3", 3.85], ["4", 4.55], ["5", 6.75], ["6", 9.5]]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"7+"'));
      });
    });

    it("ladder 0..5 plus 6+ is unchanged and does not warn", () => {
      withWarnSpy((warn) => {
        const out = norm("Dokładna liczba goli", [["0", 16.5], ["1", 5.85], ["2", 4.05], ["3", 3.85], ["4", 4.55], ["5", 6.75], ["6+", 7.25]]);
        expect(pairs(out)).toEqual([["0", 16.5], ["1", 5.85], ["2", 4.05], ["3", 3.85], ["4", 4.55], ["5", 6.75], ["6+", 7.25]]);
        expect(warn).not.toHaveBeenCalled();
      });
    });

    it("drops a 5+ tail next to a literal 4 instead of publishing it as 4+", () => {
      withWarnSpy(() => {
        expect(pairs(norm("Dokładna liczba goli", [["4", 5], ["5+", 6]]))).toEqual([["4", 5]]);
      });
    });

    it("drops a 3+ tail that would land on HALF_TIME_HOME_EXACT_GOALS 2+ next to a literal 2", () => {
      withWarnSpy(() => {
        const out = norm("1. Połowa - Arsenal dokładna liczba goli", [["0", 2.95], ["1", 2.5], ["2", 4.2], ["3+", 9]]);
        expect(out!.marketKey).toBe("HALF_TIME_HOME_EXACT_GOALS");
        expect(pairs(out)).toEqual([["0", 2.95], ["1", 2.5], ["2", 4.2]]);
      });
    });

    it("drops literals that would fold onto an N+ bucket without the tail", () => {
      withWarnSpy(() => {
        expect(pairs(norm("1. Połowa - Dokładna liczba goli", [["0", 2.6], ["1", 2.55], ["2", 3.7], ["3", 8.75]]))).toEqual([["0", 2.6], ["1", 2.55], ["2", 3.7]]);
      });
    });

    it("keeps a complete fold: literals from N up to the tail still merge into N+", () => {
      withWarnSpy((warn) => {
        const ht = norm("1. Połowa - Dokładna liczba goli", [["0", 2.6], ["1", 2.55], ["2", 3.7], ["3", 8.75], ["4+", 21]]);
        expect(ht!.marketKey).toBe("HALF_TIME_EXACT_GOALS");
        expect(pairs(ht)).toEqual([["0", 2.6], ["1", 2.55], ["2", 3.7], ["3+", 6.18]]);
        const sh = norm("2. Połowa - Dokładna liczba goli", [["0", 3.85], ["1", 2.35], ["2", 3.55], ["3", 5.1], ["4+", 8.5]]);
        expect(sh!.marketKey).toBe("SECOND_HALF_EXACT_GOALS");
        expect(pairs(sh)).toEqual([["0", 3.85], ["1", 2.35], ["2+", 1.68]]);
        expect(warn).not.toHaveBeenCalled();
      });
    });
  });

  it("routes the second-half 3-way total '2. połowa - Liczba goli (3-drogowo) 1' to OTHER", () => {
    expect(norm("2. połowa - Liczba goli (3-drogowo) 1", [["Powyżej (1.0)", 2.2], ["Dokładnie (1.0)", 2.7], ["Poniżej (1.0)", 3.8]])).toBeNull();
  });

  it.each([
    ["Zawodnik strzeli gola lub zanotuje asystę - Potrójna szansa", "Kai Havertz or Viktor Gyokeres or Noni Madueke"],
    ["Zawodnik strzeli gola lub zanotuje asystę w 1. połowie", "Kai Havertz"],
  ])("routes the goal-or-assist sibling '%s' to OTHER", (name, selection) => {
    expect(norm(name, [[selection, 3.1]])).toBeNull();
  });

  it("never routes on bookmakerMarketId: products sharing markets_class_id 3944 resolve by name", () => {
    const ladder = norm("Dokładna liczba goli", [["0", 16.5], ["1", 5.85], ["6+", 7.25]], "3944");
    expect(ladder!.marketKey).toBe("EXACT_GOALS");
    expect(ladder!.debug?.matchedBy).toBe("pattern");
    expect(norm("Dokładnie 1 gol w meczu", [["Tak", 4.05], ["Nie", 1.22]], "3944")).toBeNull();
    for (const m of parseAllMarkets(evidence, teams)) expect(lvbetNormalizer.normalizeMarket(m, ctx)?.debug?.matchedBy).not.toBe("id");
  });

  it("RESULT_OR_TOTAL selection descriptions say OR, like its label and description", () => {
    expect(getMarketByCode("RESULT_OR_TOTAL")!.descriptionTemplates).toEqual({
      HOME_OVER: "{homeTeam} wygrywa lub powyżej {param} goli",
      HOME_UNDER: "{homeTeam} wygrywa lub poniżej {param} goli",
      DRAW_OVER: "Remis lub powyżej {param} goli",
      DRAW_UNDER: "Remis lub poniżej {param} goli",
      AWAY_OVER: "{awayTeam} wygrywa lub powyżej {param} goli",
      AWAY_UNDER: "{awayTeam} wygrywa lub poniżej {param} goli",
    });
  });
});
