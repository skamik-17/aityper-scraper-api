/**
 * Offline DB-down drill for the aggregator (replaces the live forbet check that
 * Task 7's preflight makes unreachable: once runScrapeAndPersist probes the DB
 * first, a dead DB aborts before the aggregator runs).
 *
 * Real code under test: runAllFullOfferScrapers -> normalizeAndSaveMatches ->
 * saveBatchFullOfferMarkets -> formatDbError. Faked: the 14 scrapers, the
 * normalizer (pass-through) and the Supabase client, which answers every
 * upsert with the error object supabase-js logged for a closed port in
 * docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/observability/repro-db-down-forbet.txt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullMatchOffer, FullOfferScraperResult, ScrapedMarket } from "../../types/full-offer.js";
import { createFakeSupabase } from "../../__tests__/helpers/fake-supabase.js";

const { scrapers, db } = vi.hoisted(() => {
  const fakeScraper = () => ({
    scrapeFullOffer: vi.fn(
      async (_league: string): Promise<FullOfferScraperResult> => ({
        success: false,
        bookmaker: "sts",
        league: "premier-league",
        matches: [],
        error: "not under test",
      }),
    ),
    cleanup: vi.fn(async () => {}),
  });
  const scrapers = {
    sts: fakeScraper(),
    fortuna: fakeScraper(),
    betclic: fakeScraper(),
    superbet: fakeScraper(),
    lvbet: fakeScraper(),
    fuksiarz: fakeScraper(),
    betfan: fakeScraper(),
    totalbet: fakeScraper(),
    forbet: fakeScraper(),
    etoto: fakeScraper(),
    betters: fakeScraper(),
    lebull: fakeScraper(),
    betcris: fakeScraper(),
    pzbuk: fakeScraper(),
  };
  return { scrapers, db: { client: null as unknown } };
});

vi.mock("../bookmakers/index.js", async () => ({
  stsScraper: scrapers.sts,
  fortunaScraper: scrapers.fortuna,
  betclicScraper: scrapers.betclic,
  superbetScraper: scrapers.superbet,
  lvbetScraper: scrapers.lvbet,
  fuksiarzScraper: scrapers.fuksiarz,
  betfanScraper: scrapers.betfan,
  totalbetScraper: scrapers.totalbet,
  forbetScraper: scrapers.forbet,
  etotoScraper: scrapers.etoto,
  bettersScraper: scrapers.betters,
  lebullScraper: scrapers.lebull,
  betcrisScraper: scrapers.betcris,
  pzbukScraper: scrapers.pzbuk,
}));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));
// Normalization is not under test: the markets below are already canonical.
vi.mock("../../services/normalization/index.js", async () => ({
  normalizeMarketsForBookmaker: (markets: ScrapedMarket[]) => markets,
}));

import { runAllFullOfferScrapers } from "../aggregator.js";

// supabase-js PostgrestError for a closed port, verbatim from repro-db-down-forbet.txt (batch 1).
const ECONNREFUSED_59999 = {
  message: "TypeError: fetch failed",
  details:
    "TypeError: fetch failed\n" +
    "\n" +
    "Caused by: Error: connect ECONNREFUSED 127.0.0.1:59999 (ECONNREFUSED)\n" +
    "Error: connect ECONNREFUSED 127.0.0.1:59999\n" +
    "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)\n" +
    "    at TCPConnectWrap.callbackTrampoline (node:internal/async_hooks:130:17)",
  hint: "",
  code: "",
};

const TEAMS = ["Arsenal", "Chelsea", "Liverpool", "Everton", "Fulham", "Brentford", "Burnley", "Sunderland", "Aston Villa", "Bournemouth"];

/** 20 distinct fixtures (each pair home and away), each with `perMatch` distinct OTHER markets (one DB row each). */
function twentyMatches(perMatch: number): FullMatchOffer[] {
  const matches: FullMatchOffer[] = [];
  for (let i = 0; i < TEAMS.length; i += 2) {
    for (const [home, away] of [
      [TEAMS[i], TEAMS[i + 1]],
      [TEAMS[i + 1], TEAMS[i]],
      [TEAMS[i], TEAMS[(i + 2) % TEAMS.length]],
      [TEAMS[(i + 2) % TEAMS.length], TEAMS[i]],
    ]) {
      matches.push({
        bookmaker: "forbet",
        homeTeam: home,
        awayTeam: away,
        scrapedAt: new Date("2026-11-06T16:27:41.000Z"),
        markets: Array.from(
          { length: perMatch },
          (_, j) =>
            ({
              name: `Rynek ${j}`,
              normalizedType: "OTHER",
              marketKey: "OTHER",
              bookmakerMarketId: `${j}`,
              selections: [{ name: "Tak", normalizedName: "YES", odds: 1.9 }],
            }) as ScrapedMarket,
        ),
      } as FullMatchOffer);
    }
  }
  return matches;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  warnSpy.mockRestore();
  vi.clearAllMocks();
  db.client = null;
});

const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");

describe("runAllFullOfferScrapers with the database down (offline drill)", () => {
  it("logs forbet as persist_failed with the batch count and the socket cause, and the run as 0 ok, 1 failed", async () => {
    const fake = createFakeSupabase(() => ({ error: ECONNREFUSED_59999 }));
    db.client = fake.client;
    const matches = twentyMatches(300);
    expect(new Set(matches.map((m) => `${m.homeTeam}|${m.awayTeam}`)).size).toBe(20);
    scrapers.forbet.scrapeFullOffer.mockResolvedValueOnce({
      success: true,
      bookmaker: "forbet",
      league: "premier-league",
      matches,
    });

    const r = await runAllFullOfferScrapers("premier-league", ["forbet"]);

    const err = "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";
    expect(r.outcomes).toEqual([
      expect.objectContaining({ bookmaker: "forbet", status: "persist_failed", matchesFound: 20, marketsFound: 6000, marketsSaved: 0, error: err }),
    ]);
    expect(r.summary).toMatchObject({ successCount: 0, errorCount: 1, totalMarketsSaved: 0 });
    expect(logged(errorSpy)).toContain(
      `[Aggregator/FullOffer] forbet persist_failed: 20 matches, 6000 markets found, 0 saved - ${err}`,
    );
    expect(logged(logSpy)).toMatch(
      new RegExp(
        `\\[Aggregator/FullOffer\\] Run ${r.runId} completed in \\d+ms: 0 ok, 1 failed, 20 matches, 6000 markets found, 0 saved`,
      ),
    );
    // 12 upserts of 500 rows to odds, all refused; no prune and no other table touched.
    expect(fake.queries.map((q) => q.table)).toEqual(Array(12).fill("odds"));
  });
});
