import { describe, it, expect } from "vitest";
import { scrapedMarketsToRaw, buildPrepAuditOutput } from "../scraper-audit-core.js";
import type { BookmakerMarketNormalizer, RawBookmakerMarket } from "../../normalization/types.js";
import { lvbetNormalizer } from "../../normalization/bookmakers/lvbet-normalizer.js";

const market = { name: "Suma 2.5", bookmakerMarketId: "18", paramValue: "total=2.5",
  selections: [{ name: "ponad 2.5", odds: 1.93, externalId: "12" }, { name: "poniżej 2.5", odds: 1.85, externalId: "13" }] };

describe("audit harness passthrough", () => {
  it("scrapedMarketsToRaw keeps selection externalId and paramValue", () => {
    const [raw] = scrapedMarketsToRaw([market]);
    expect(raw.paramValue).toBe("total=2.5");
    expect(raw.selections.map((s) => s.externalId)).toEqual(["12", "13"]);
  });
  it("buildPrepAuditOutput hands externalId and paramValue to the normalizer and archives both", () => {
    const seen: RawBookmakerMarket[] = [];
    const spy: BookmakerMarketNormalizer = { bookmaker: "betters", normalizeMarket: (raw) => { seen.push(raw); return null; } };
    const out = buildPrepAuditOutput({ normalizer: spy, ctx: { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur" },
      rawMarkets: scrapedMarketsToRaw([market]), meta: { matchId: "2725816334213586962", homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league" } });
    expect(seen[0].paramValue).toBe("total=2.5");
    expect(seen[0].selections[0].externalId).toBe("12");
    expect(out.markets[0].raw.paramValue).toBe("total=2.5");
    expect(out.markets[0].raw.selections[1].externalId).toBe("13");
  });
  it("archives entries without paramValue or externalId without those keys", () => {
    const bare = { name: "1x2", bookmakerMarketId: "1", selections: [{ name: "Leeds United", odds: 2.74 }] };
    const spy: BookmakerMarketNormalizer = { bookmaker: "betters", normalizeMarket: () => null };
    const out = buildPrepAuditOutput({ normalizer: spy, ctx: { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur" },
      rawMarkets: scrapedMarketsToRaw([bare]), meta: { matchId: "2725816334213586962", homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league" } });
    expect("paramValue" in out.markets[0].raw).toBe(false);
    expect(Object.keys(out.markets[0].raw.selections[0]).sort()).toEqual(["name", "odds"]);
  });
});

describe("prep archive paramValue (lvbet ladder)", () => {
  const ctx = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };
  const meta = { matchId: "premier-league:arsenal:hull city", homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };

  it("archives a split LVBet ladder row with its paramValue", () => {
    const out = buildPrepAuditOutput({ normalizer: lvbetNormalizer, ctx, meta, rawMarkets: [{ name: "Strzały", bookmakerMarketId: "12238",
      paramValue: "Viktor Gyokeres", selections: [{ name: "Powyzej 2.5", odds: 1.35 }, { name: "Powyzej 3.5", odds: 1.88 }] }] });
    expect(out.markets[0].raw.paramValue).toBe("Viktor Gyokeres");
    expect(out.markets[0].normalized.marketKey).toBe("PLAYER_SHOTS:Viktor Gyokeres");
    expect(out.markets[0].normalized.selections.map((s) => [s.code, s.odds])).toEqual([["3+", 1.35], ["4+", 1.88]]);
  });
});
