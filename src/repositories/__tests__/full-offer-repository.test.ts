import { describe, it, expect } from "vitest";
import {
  mergeMarketRecord,
  resolveStorageMarketKey,
  type OddsInsert,
} from "../full-offer-repository.js";
import type { ScrapedMarket } from "../../types/full-offer.js";

/**
 * Cases reproduced from the /audit-match run on premier-league Arsenal vs
 * Coventry City (round 4), where pzbuk/forbet/lebull each had several
 * structurally unrelated raw markets collapse into ONE polluted DB row
 * because they all normalize to the literal marketKey "OTHER" and
 * mergeMarketRecord() used that bare string as its Map key.
 */
function scrapedMarket(overrides: Partial<ScrapedMarket>): ScrapedMarket {
  return {
    name: "Some raw market",
    normalizedType: "OTHER" as any,
    marketKey: "OTHER",
    selections: [],
    ...overrides,
  };
}

function insertFrom(market: ScrapedMarket, marketKey: string): OddsInsert {
  return {
    match_id: "premier-league:arsenal:coventry-city",
    league_slug: "premier-league",
    home_team: "Arsenal",
    away_team: "Coventry City",
    bookmaker: "pzbuk" as any,
    market_type_id: 99,
    market_key: marketKey,
    raw_market_name: market.name,
    selections: [...market.selections],
    scraped_at: "2026-08-19T00:00:00.000Z",
  };
}

describe("resolveStorageMarketKey", () => {
  it("leaves a real parameterized-ladder marketKey unchanged", () => {
    expect(resolveStorageMarketKey(scrapedMarket({}), "PLAYER_SHOTS:Bukayo Saka")).toBe(
      "PLAYER_SHOTS:Bukayo Saka",
    );
    expect(resolveStorageMarketKey(scrapedMarket({}), "TOTAL_GOALS:2.5")).toBe("TOTAL_GOALS:2.5");
  });

  it("suffixes OTHER by the raw bookmaker market id when available", () => {
    const key = resolveStorageMarketKey(
      scrapedMarket({ name: "Handicap", bookmakerMarketId: "14" }),
      "OTHER",
    );
    expect(key).not.toBe("OTHER");
    expect(key).toBe("OTHER:id:14");
  });

  it("gives two different raw markets with different ids two different keys", () => {
    const keyA = resolveStorageMarketKey(
      scrapedMarket({ name: "Handicap", bookmakerMarketId: "14" }),
      "OTHER",
    );
    const keyB = resolveStorageMarketKey(
      scrapedMarket({ name: "Wynik dokładny", bookmakerMarketId: "72" }),
      "OTHER",
    );
    expect(keyA).not.toBe(keyB);
  });

  it("falls back to a hash of the raw name when no bookmakerMarketId is present", () => {
    const keyA = resolveStorageMarketKey(
      scrapedMarket({ name: "Wydarzy się min. jedno z: Arsenal FC wygra lub powyżej 2.5 goli" }),
      "OTHER",
    );
    const keyB = resolveStorageMarketKey(scrapedMarket({ name: "1. połowa - liczba goli" }), "OTHER");
    expect(keyA).not.toBe("OTHER");
    expect(keyB).not.toBe("OTHER");
    expect(keyA).not.toBe(keyB);
  });

  it("is deterministic across repeated calls for the same raw market (re-scrape stability)", () => {
    const market = scrapedMarket({ name: "Handicap", bookmakerMarketId: "14" });
    expect(resolveStorageMarketKey(market, "OTHER")).toBe(resolveStorageMarketKey(market, "OTHER"));

    const namedOnly = scrapedMarket({ name: "Multiwynik" });
    expect(resolveStorageMarketKey(namedOnly, "OTHER")).toBe(
      resolveStorageMarketKey(namedOnly, "OTHER"),
    );
  });
});

describe("mergeMarketRecord with OTHER-catchall key suffixing", () => {
  it("keeps two unrelated raw markets that both route to OTHER as two separate rows instead of merging them", () => {
    const recordsMap = new Map<string, OddsInsert>();

    // pzbuk's genuine 15-selection Handicap grid (bookmakerMarketId "14").
    const handicapGrid = scrapedMarket({
      name: "Handicap",
      bookmakerMarketId: "14",
      selections: [
        { name: "1:0", odds: 8.5 },
        { name: "2:0", odds: 12 },
        { name: "2:1", odds: 15 },
      ],
    });
    // An entirely unrelated pzbuk scorer-list market (bookmakerMarketId "72").
    const scorerList = scrapedMarket({
      name: "Strzelcy",
      bookmakerMarketId: "72",
      selections: [
        { name: "Bukayo Saka", odds: 3.2 },
        { name: "Viktor Gyokeres", odds: 2.5 },
      ],
    });

    for (const market of [handicapGrid, scorerList]) {
      const marketKey = resolveStorageMarketKey(market, market.marketKey || market.normalizedType!);
      mergeMarketRecord(recordsMap, marketKey, insertFrom(market, marketKey));
    }

    // Root cause fixed: two rows, not one polluted merge.
    expect(recordsMap.size).toBe(2);

    const handicapRow = recordsMap.get("OTHER:id:14")!;
    const scorerRow = recordsMap.get("OTHER:id:72")!;
    expect(handicapRow).toBeDefined();
    expect(scorerRow).toBeDefined();

    // Each row keeps only its OWN raw market's selections — no cross-pollution.
    expect(handicapRow.selections).toHaveLength(3);
    expect(handicapRow.raw_market_name).toBe("Handicap");
    expect(scorerRow.selections).toHaveLength(2);
    expect(scorerRow.raw_market_name).toBe("Strzelcy");
  });

  it("still merges a genuine parameterized ladder sharing one marketKey (PLAYER_SHOTS regression guard)", () => {
    // This is the round-8 scenario mergeMarketRecord's own docstring
    // describes (betcris PLAYER_SHOTS "2+".."9+" thresholds keyed only by
    // player name) — must stay a single merged row, unaffected by the
    // OTHER-only suffixing added in round 4.
    const recordsMap = new Map<string, OddsInsert>();
    const player = "Bukayo Saka";

    const thresholds = [
      { name: "2+", odds: 1.5 },
      { name: "3+", odds: 2.1 },
      { name: "4+", odds: 3.4 },
    ];

    for (const sel of thresholds) {
      const market = scrapedMarket({
        name: `Saka - ${sel.name} strzałów`,
        normalizedType: "PLAYER_SHOTS" as any,
        marketKey: `PLAYER_SHOTS:${player}`,
        selections: [sel],
      });
      const marketKey = resolveStorageMarketKey(market, market.marketKey!);
      mergeMarketRecord(recordsMap, marketKey, insertFrom(market, marketKey));
    }

    // Ladder markets must still collapse onto ONE row with all thresholds combined.
    expect(recordsMap.size).toBe(1);
    const row = recordsMap.get(`PLAYER_SHOTS:${player}`)!;
    expect(row.selections).toHaveLength(3);
    expect(row.selections.map((s) => s.name)).toEqual(["2+", "3+", "4+"]);
  });
});

describe("mergeMarketRecord with within-market UNKNOWN-selection collisions (round 5)", () => {
  it("keeps all four legs of a raw OTHER market whose selections all normalize to the generic UNKNOWN code", () => {
    // betcris' "1-15 min. Liczba goli" (audit-match Arsenal vs Coventry
    // City, round 5): one raw market, 2 paramValues x Over/Under = 4
    // genuinely different selections. The normalizer can't classify any of
    // them beyond OTHER, so every selection.normalizedName is the generic
    // "UNKNOWN" fallback (factory.ts). Before the fix, the plain
    // `sel.normalizedName || sel.name` dedup key treated "UNKNOWN" as one
    // shared code (it's a truthy string, so `||` never fell through to the
    // distinct raw name) and every selection after the first collided away.
    const recordsMap = new Map<string, OddsInsert>();
    const goalsFirst15Min = scrapedMarket({
      name: "1-15 min. Liczba goli",
      bookmakerMarketId: "501",
      selections: [
        { name: "Powyżej 0.5", odds: 1.9, normalizedName: "UNKNOWN" as any },
        { name: "Poniżej 0.5", odds: 1.85, normalizedName: "UNKNOWN" as any },
        { name: "Powyżej 1.5", odds: 4.5, normalizedName: "UNKNOWN" as any },
        { name: "Poniżej 1.5", odds: 1.18, normalizedName: "UNKNOWN" as any },
      ],
    });

    const marketKey = resolveStorageMarketKey(
      goalsFirst15Min,
      goalsFirst15Min.marketKey || goalsFirst15Min.normalizedType!,
    );
    mergeMarketRecord(recordsMap, marketKey, insertFrom(goalsFirst15Min, marketKey));

    const row = recordsMap.get(marketKey)!;
    expect(row).toBeDefined();
    expect(row.selections).toHaveLength(4);
    expect(row.selections.map((s) => s.name)).toEqual([
      "Powyżej 0.5",
      "Poniżej 0.5",
      "Powyżej 1.5",
      "Poniżej 1.5",
    ]);
  });

  it("still collapses a genuine duplicate (same raw name AND UNKNOWN code) instead of double-counting", () => {
    const recordsMap = new Map<string, OddsInsert>();
    const marketA = scrapedMarket({
      name: "Dziwny rynek",
      bookmakerMarketId: "999",
      selections: [{ name: "Tak", odds: 1.9, normalizedName: "UNKNOWN" as any }],
    });
    const marketAAgain = scrapedMarket({
      name: "Dziwny rynek",
      bookmakerMarketId: "999",
      selections: [{ name: "Tak", odds: 1.95, normalizedName: "UNKNOWN" as any }],
    });

    const keyA = resolveStorageMarketKey(marketA, marketA.marketKey || marketA.normalizedType!);
    mergeMarketRecord(recordsMap, keyA, insertFrom(marketA, keyA));
    const keyB = resolveStorageMarketKey(
      marketAAgain,
      marketAAgain.marketKey || marketAAgain.normalizedType!,
    );
    mergeMarketRecord(recordsMap, keyB, insertFrom(marketAAgain, keyB));

    const row = recordsMap.get(keyA)!;
    // First-seen odds win on a genuine collision, matching mergeMarketRecord's
    // documented ladder-merge behavior — still just one "Tak" selection.
    expect(row.selections).toHaveLength(1);
    expect(row.selections[0].odds).toBe(1.9);
  });
});

describe("mergeMarketRecord raw_market_name concatenation (round 7)", () => {
  it("concatenates distinct source names when a merge genuinely adds new selections", () => {
    // CARDS_TEAM (audit-match Arsenal vs Coventry City, round 6/7): a
    // bookmaker's separate "Arsenal - liczba kartek" (HOME_OVER/HOME_UNDER)
    // and "Coventry - liczba kartek" (AWAY_OVER/AWAY_UNDER) raw markets
    // legitimately merge into one HOME/AWAY row via declared vocabulary.
    // Before the fix, raw_market_name kept only the first-seen name, silently
    // misattributing the label for the second market's selections.
    const recordsMap = new Map<string, OddsInsert>();
    const arsenalCards: OddsInsert = {
      match_id: "premier-league:arsenal:coventry-city",
      league_slug: "premier-league",
      home_team: "Arsenal",
      away_team: "Coventry City",
      bookmaker: "superbet" as any,
      market_type_id: 99,
      market_key: "CARDS_TEAM:1.5",
      raw_market_name: "Arsenal - liczba kartek",
      selections: [
        { name: "Powyżej 1.5", odds: 1.5, normalizedName: "HOME_OVER" as any },
        { name: "Poniżej 1.5", odds: 2.5, normalizedName: "HOME_UNDER" as any },
      ],
      scraped_at: "2026-08-20T00:00:00.000Z",
    };
    const coventryCards: OddsInsert = {
      ...arsenalCards,
      raw_market_name: "Coventry - liczba kartek",
      selections: [
        { name: "Powyżej 1.5", odds: 3.5, normalizedName: "AWAY_OVER" as any },
        { name: "Poniżej 1.5", odds: 1.3, normalizedName: "AWAY_UNDER" as any },
      ],
    };

    mergeMarketRecord(recordsMap, "CARDS_TEAM:1.5", arsenalCards);
    mergeMarketRecord(recordsMap, "CARDS_TEAM:1.5", coventryCards);

    const row = recordsMap.get("CARDS_TEAM:1.5")!;
    expect(row.selections).toHaveLength(4);
    expect(row.raw_market_name).toBe("Arsenal - liczba kartek / Coventry - liczba kartek");
  });

  it("does not append a name when the merge adds no new selections (pure collision)", () => {
    const recordsMap = new Map<string, OddsInsert>();
    const first: OddsInsert = {
      match_id: "premier-league:arsenal:coventry-city",
      league_slug: "premier-league",
      home_team: "Arsenal",
      away_team: "Coventry City",
      bookmaker: "superbet" as any,
      market_type_id: 99,
      market_key: "CARDS_TEAM:1.5",
      raw_market_name: "Arsenal - liczba kartek",
      selections: [{ name: "Powyżej 1.5", odds: 1.5, normalizedName: "HOME_OVER" as any }],
      scraped_at: "2026-08-20T00:00:00.000Z",
    };
    const duplicate: OddsInsert = { ...first, raw_market_name: "Arsenal - liczba kartek (duplicate feed)" };

    mergeMarketRecord(recordsMap, "CARDS_TEAM:1.5", first);
    mergeMarketRecord(recordsMap, "CARDS_TEAM:1.5", duplicate);

    const row = recordsMap.get("CARDS_TEAM:1.5")!;
    expect(row.selections).toHaveLength(1);
    expect(row.raw_market_name).toBe("Arsenal - liczba kartek");
  });
});
