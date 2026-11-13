import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapedMarket } from "../../types/full-offer.js";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { saveBatchFullOfferMarkets } from "../full-offer-repository.js";

const shapes = JSON.parse(
  readFileSync(
    new URL("../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url),
    "utf8",
  ),
);

function matchWinner(home: number, draw: number, away: number): ScrapedMarket {
  return {
    name: "1X2",
    normalizedType: "MATCH_WINNER",
    marketKey: "MATCH_WINNER",
    selections: [
      { name: "1", normalizedName: "HOME", odds: home },
      { name: "X", normalizedName: "DRAW", odds: draw },
      { name: "2", normalizedName: "AWAY", odds: away },
    ],
  } as ScrapedMarket;
}

// One distinct storage row per line, so `count` markets become `count` upsert records.
function totalGoalsLadder(count: number): ScrapedMarket[] {
  return Array.from({ length: count }, (_, i) => {
    const line = `${i}.5`;
    return {
      name: `Liczba goli ${line}`,
      normalizedType: "TOTAL_GOALS",
      marketKey: `TOTAL_GOALS:${line}`,
      paramValue: line,
      selections: [
        { name: "Powyżej", normalizedName: "OVER", odds: 1.9 },
        { name: "Poniżej", normalizedName: "UNDER", odds: 1.9 },
      ],
    } as ScrapedMarket;
  });
}

let fake: ReturnType<typeof createFakeSupabase>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}

const methods = (q: RecordedQuery) => q.calls.map(([m]) => m);

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  db.client = null;
});

describe("saveBatchFullOfferMarkets: batch errors", () => {
  it("reports failed batches and the first formatted DB error", async () => {
    useFake(() => ({ error: shapes.econnrefused }));
    const r = await saveBatchFullOfferMarkets(
      [{ homeTeam: "Everton", awayTeam: "Coventry City", markets: [matchWinner(1.65, 4.0, 5.0)] }],
      "forbet",
      "premier-league",
    );
    expect(r).toMatchObject({
      inserted: 0,
      failedBatches: 1,
      totalBatches: 1,
      firstError: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)",
    });
    // One upsert, and no stale-row prune after a failed write.
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].table).toBe("odds");
    expect(methods(fake.queries[0])).toEqual(["upsert"]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("keeps the error of the first failed batch when later batches fail too", async () => {
    // 1001 records = 3 batches of BATCH_SIZE 500 (500 + 500 + 1).
    useFake((q) => {
      const i = fake.queries.indexOf(q);
      if (i === 1) return { error: shapes.schemaCacheNotReady };
      if (i === 2) return { error: shapes.socketClosed };
      return {};
    });
    const r = await saveBatchFullOfferMarkets(
      [{ homeTeam: "Everton", awayTeam: "Coventry City", markets: totalGoalsLadder(1001) }],
      "forbet",
      "premier-league",
    );
    expect(r).toMatchObject({
      inserted: 500,
      errors: 501,
      failedBatches: 2,
      totalBatches: 3,
      firstError: "Could not query the database for the schema cache. Retrying. [PGRST002]",
    });
    expect(fake.queries.map(methods)).toEqual([["upsert"], ["upsert"], ["upsert"]]);
  });

  it("a clean save reports no failed batch and still prunes stale rows", async () => {
    useFake(() => ({}));
    const r = await saveBatchFullOfferMarkets(
      [{ homeTeam: "Everton", awayTeam: "Coventry City", markets: [matchWinner(1.65, 4.0, 5.0)] }],
      "forbet",
      "premier-league",
    );
    expect(r).toMatchObject({ inserted: 1, errors: 0, failedBatches: 0, totalBatches: 1, firstError: null });
    expect(fake.queries.map(methods)).toEqual([["upsert"], ["rpc"]]);
    expect(fake.queries[1].table).toBe("rpc:prune_stale_odds");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
