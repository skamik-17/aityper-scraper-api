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
