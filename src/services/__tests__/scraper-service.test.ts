import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullOfferAggregatedResult } from "../../scrapers/aggregator.js";
import type { FullOfferScraperResult } from "../../types/full-offer.js";
import type { PolishBookmaker } from "../../config/index.js";
import { isOkRunStatus, type BookmakerRunOutcome } from "../run-outcome.js";
import { outcome, RUN_ID } from "../../__tests__/helpers/run-fixtures.js";

const { runAllFullOfferScrapers, closeAllBrowsers } = vi.hoisted(() => ({
  runAllFullOfferScrapers: vi.fn(),
  closeAllBrowsers: vi.fn(async () => {}),
}));

vi.mock("../../scrapers/aggregator.js", async () => ({
  runAllFullOfferScrapers,
  closeAllBrowsers,
  runAllScrapers: vi.fn(),
}));

import { runScrapeAndPersist } from "../scraper-service.js";
import { scraperHealth } from "../scraper-health.js";

const FORBET_ERR =
  "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";
const SAVE_THREW = "Save failed: Cannot read properties of undefined (reading 'length')";

/** A FullOfferAggregatedResult built from outcomes only; `results` is passed in when a test needs it. */
function aggregated(
  outcomes: BookmakerRunOutcome[],
  results: Map<PolishBookmaker, FullOfferScraperResult> = new Map(),
): FullOfferAggregatedResult {
  const ok = outcomes.filter((o) => isOkRunStatus(o.status));
  return {
    runId: outcomes[0]?.runId ?? RUN_ID,
    league: "premier-league",
    startedAt: new Date("2026-11-06T16:00:00.350Z"),
    completedAt: new Date("2026-11-06T16:02:49.798Z"),
    totalDuration: 169448,
    results,
    allMatches: [],
    outcomes,
    summary: {
      successCount: ok.length,
      errorCount: outcomes.length - ok.length,
      totalMatchesFound: outcomes.reduce((sum, o) => sum + o.matchesFound, 0),
      totalMarketsFound: 0,
      totalMarketsSaved: ok.reduce((sum, o) => sum + o.marketsSaved, 0),
    },
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // scraperHealth is a module singleton: start every test from an empty history.
  scraperHealth.reset();
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
});

describe("runScrapeAndPersist: health and errors[] follow the outcomes", () => {
  it("reports a bookmaker that saved nothing in errors[] and as failing, even when its scraper result says success", async () => {
    // Real shape after Task 3: the scraper succeeded, so `results` holds success:true, but no market was saved.
    const results = new Map<PolishBookmaker, FullOfferScraperResult>([
      ["forbet", { success: true, bookmaker: "forbet", league: "premier-league", matches: [], duration: 7171 }],
    ]);
    runAllFullOfferScrapers.mockResolvedValueOnce(
      aggregated(
        [
          outcome({ bookmaker: "forbet", status: "persist_failed", marketsFound: 5995, marketsSaved: 0, error: FORBET_ERR }),
          outcome({ bookmaker: "betclic", status: "success", marketsSaved: 3150 }),
        ],
        results,
      ),
    );

    const r = await runScrapeAndPersist("premier-league", ["forbet", "betclic"]);

    expect(r).toMatchObject({ successCount: 1, errorCount: 1 });
    expect(r.errors).toEqual([`forbet: ${FORBET_ERR}`]);
    expect(scraperHealth.getHealth("forbet")).toMatchObject({ status: "failing", successRate: 0, lastError: FORBET_ERR });
    expect(scraperHealth.getHealth("betclic")).toMatchObject({ status: "healthy", successRate: 100, lastError: null });
  });

  it("reports a save that threw ('Save failed: ...') in errors[] and in health lastError", async () => {
    runAllFullOfferScrapers.mockResolvedValueOnce(
      aggregated([outcome({ bookmaker: "lvbet", status: "persist_failed", marketsSaved: 0, error: SAVE_THREW })]),
    );

    const r = await runScrapeAndPersist("premier-league", ["lvbet"]);

    expect(r.errors).toContain(`lvbet: ${SAVE_THREW}`);
    expect(scraperHealth.getHealth("lvbet")).toMatchObject({ status: "failing", lastError: SAVE_THREW });
  });

  it("counts an empty run as a failure (owner decision 6) and keeps partial runs healthy", async () => {
    runAllFullOfferScrapers.mockResolvedValueOnce(
      aggregated([
        outcome({ bookmaker: "etoto", status: "empty", matchesFound: 0, error: "Scraper reported success with 0 matches" }),
        outcome({ bookmaker: "fortuna", status: "partial", marketsSaved: 12897, error: "Normalization failed for A vs B: x" }),
        outcome({ bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: "No events found from API" }),
      ]),
    );

    const r = await runScrapeAndPersist("premier-league", ["etoto", "fortuna", "betters"]);

    expect(r.errors).toEqual([
      "etoto: Scraper reported success with 0 matches",
      "betters: No events found from API",
    ]);
    expect(scraperHealth.getHealth("etoto")).toMatchObject({ status: "failing", successRate: 0 });
    expect(scraperHealth.getHealth("fortuna")).toMatchObject({ status: "healthy", successRate: 100, lastError: null });
    expect(scraperHealth.getHealth("betters")).toMatchObject({ status: "failing", lastError: "No events found from API" });
  });

  it("records the outcome's duration for a successful run", async () => {
    runAllFullOfferScrapers.mockResolvedValueOnce(
      aggregated([outcome({ bookmaker: "superbet", status: "success", marketsSaved: 13353, durationMs: 42_000 })]),
    );

    await runScrapeAndPersist("premier-league", ["superbet"]);

    expect(scraperHealth.getHealth("superbet").avgDuration).toBe(42_000);
  });
});
