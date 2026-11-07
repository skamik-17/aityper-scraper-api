import { describe, it, expect, vi, afterEach } from "vitest";
import { scrapedMarketsToRaw, buildPrepAuditOutput } from "../scraper-audit-core.js";
import { isPlaceholderExternalId } from "../placeholder-external-id.js";
import type { BookmakerMarketNormalizer, RawBookmakerMarket } from "../../normalization/types.js";

const ctx = { homeTeam: "Arsenal", awayTeam: "Hull City" };
const meta = { matchId: "35148", homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };

// LVBet v5 and Superbet payloads no longer send the selection `id` their parsers
// read, so `String(s.id)` puts the literal "undefined" on every selection.
const stringifiedMissing = {
  name: "Wynik meczu",
  bookmakerMarketId: "1",
  selections: [
    { name: "Arsenal", odds: 1.3, externalId: "undefined" },
    { name: "Remis", odds: 5.5, externalId: "undefined" },
    { name: "Hull City", odds: 9.5, externalId: "undefined" },
  ],
};

function recordingNormalizer(seen: RawBookmakerMarket[]): BookmakerMarketNormalizer {
  return { bookmaker: "lvbet", normalizeMarket: (raw) => { seen.push(raw); return null; } };
}

describe("placeholder selection externalId", () => {
  afterEach(() => vi.restoreAllMocks());

  it("recognizes what String() makes of a missing id, and nothing else", () => {
    for (const id of ["undefined", "null", "NaN", "[object Object]", "", "  "]) {
      expect(isPlaceholderExternalId(id), id).toBe(true);
    }
    for (const id of ["12", "0", "1350692789", "sr:goal_range:7+:1342", "736b2b36-4b9e-4467-8477-70f74809faf0", "undefined-1"]) {
      expect(isPlaceholderExternalId(id), id).toBe(false);
    }
  });

  it("buildPrepAuditOutput neither normalizes nor archives a placeholder id, and reports the drop", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: RawBookmakerMarket[] = [];
    const out = buildPrepAuditOutput({ normalizer: recordingNormalizer(seen), ctx, meta,
      rawMarkets: scrapedMarketsToRaw([stringifiedMissing]) });
    expect(seen[0].selections).toEqual([
      { name: "Arsenal", odds: 1.3 }, { name: "Remis", odds: 5.5 }, { name: "Hull City", odds: 9.5 }]);
    expect(out.markets[0].raw.selections.map((s) => Object.keys(s).sort())).toEqual([
      ["name", "odds"], ["name", "odds"], ["name", "odds"]]);
    expect(out.meta.droppedPlaceholderExternalIds).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/lvbet: dropped 3 placeholder selection externalId/);
  });

  it("keeps a real id next to a dropped placeholder and leaves every price and name as scraped", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: RawBookmakerMarket[] = [];
    const mixed = { name: "Suma 2.5", bookmakerMarketId: "18", paramValue: "2.5",
      selections: [{ name: "ponad 2.5", odds: 1.93, externalId: "12" }, { name: "poniżej 2.5", odds: 1.85, externalId: "null" }] };
    const out = buildPrepAuditOutput({ normalizer: recordingNormalizer(seen), ctx, meta, rawMarkets: scrapedMarketsToRaw([mixed]) });
    expect(seen[0].paramValue).toBe("2.5");
    expect(seen[0].selections).toEqual([{ name: "ponad 2.5", odds: 1.93, externalId: "12" }, { name: "poniżej 2.5", odds: 1.85 }]);
    expect(out.markets[0].raw.paramValue).toBe("2.5");
    expect(out.markets[0].raw.selections).toEqual([{ name: "ponad 2.5", odds: 1.93, externalId: "12" }, { name: "poniżej 2.5", odds: 1.85 }]);
    expect(out.meta.droppedPlaceholderExternalIds).toBe(1);
  });

  it("adds no meta key and logs nothing when every id is real or absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clean = [
      { name: "1x2", bookmakerMarketId: "1", selections: [{ name: "Arsenal", odds: 1.3, externalId: "12" }] },
      { name: "BTTS", bookmakerMarketId: "29", selections: [{ name: "Tak", odds: 1.7 }] },
    ];
    const out = buildPrepAuditOutput({ normalizer: recordingNormalizer([]), ctx, meta, rawMarkets: scrapedMarketsToRaw(clean) });
    expect("droppedPlaceholderExternalIds" in out.meta).toBe(false);
    expect(out.markets.map((m) => m.raw.selections)).toEqual([
      [{ name: "Arsenal", odds: 1.3, externalId: "12" }], [{ name: "Tak", odds: 1.7 }]]);
    expect(warn).not.toHaveBeenCalled();
  });
});
