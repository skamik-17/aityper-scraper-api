import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullMatchOffer, ScrapedMarket } from "../../types/full-offer.js";
import { createFakeSupabase } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));
// Normalization is not under test here: pass the already-canonical market through.
vi.mock("../normalization/index.js", async () => ({
  normalizeMarketsForBookmaker: (markets: ScrapedMarket[]) => markets,
}));

import { normalizeAndSaveMatches } from "../scrape-helpers.js";

const shapes = JSON.parse(
  readFileSync(new URL("./fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url), "utf8"),
);

function evertonCoventry(): FullMatchOffer {
  return {
    matchId: "premier-league:everton:coventry-city",
    bookmaker: "forbet",
    homeTeam: "Everton",
    awayTeam: "Coventry City",
    eventUrl: "https://bookmaker.example/everton-coventry-city",
    scrapedAt: new Date("2026-11-06T16:00:35.746Z"),
    markets: [
      {
        name: "1X2",
        normalizedType: "MATCH_WINNER",
        marketKey: "MATCH_WINNER",
        selections: [
          { name: "1", normalizedName: "HOME", odds: 1.65 },
          { name: "X", normalizedName: "DRAW", odds: 4.0 },
          { name: "2", normalizedName: "AWAY", odds: 5.0 },
        ],
      } as ScrapedMarket,
    ],
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  db.client = null;
});

describe("normalizeAndSaveMatches: batch insert errors", () => {
  it("names the failed batch count and the DB cause", async () => {
    db.client = createFakeSupabase(() => ({ error: shapes.econnrefused })).client;
    const r = await normalizeAndSaveMatches([evertonCoventry()], "forbet", "premier-league", { useBatchInsert: true });
    expect(r).toEqual({
      matchesProcessed: 1,
      marketsNormalized: 1,
      marketsSaved: 0,
      errors: ["Batch insert failed (1 of 1 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)"],
    });
  });

  it("adds no error when every batch was written", async () => {
    db.client = createFakeSupabase(() => ({})).client;
    const r = await normalizeAndSaveMatches([evertonCoventry()], "forbet", "premier-league", { useBatchInsert: true });
    expect(r).toEqual({ matchesProcessed: 1, marketsNormalized: 1, marketsSaved: 1, errors: [] });
  });
});
