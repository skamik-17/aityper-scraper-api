/**
 * Plan 10 Task 8: betclic implements IncrementalScraper on top of plan 06's
 * per-match fetch; the listing gains its market count (proto field 7).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripScrapedAt } from "../../../../__tests__/helpers/replay-page.js";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import { BudgetExceededError, createScrapeBudget } from "../../../shared/budget.js";
import { isIncrementalScraper } from "../../../shared/incremental/incremental-scraper.js";
import { groupResults } from "./betclic-fixtures.js";

const h = vi.hoisted(() => ({ fetchLeagueMatches: vi.fn(), fetchMarketGroupResults: vi.fn() }));
vi.mock("../navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../navigation.js")>()),
  fetchLeagueMatches: h.fetchLeagueMatches,
  fetchMarketGroupResults: h.fetchMarketGroupResults,
}));

import { BetclicPlaywrightScraper } from "../index.js";
import { parseListingResponse } from "../parser.js";
import { resolveBetclicMatchConcurrency } from "../constants.js";

const PLAN01 = readFileSync(new URL("../../__tests__/fixtures/full-offer/betclic-listing.bin", import.meta.url));
const WITH_COUNT = readFileSync(new URL("./fixtures/listing-with-market-count.bin", import.meta.url));
const LEAGUE = "premier-league";
const budget = () => createScrapeBudget(10_000);
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockRejectedValue(new Error("browser disabled in unit tests"));
  h.fetchLeagueMatches.mockResolvedValue(PLAN01);
  h.fetchMarketGroupResults.mockResolvedValue(groupResults());
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("betclic listing market count", () => {
  it("parseListingResponse reads the market count", () => {
    const withCount = parseListingResponse(WITH_COUNT, LEAGUE);
    const plain = parseListingResponse(PLAN01, LEAGUE);
    expect(withCount).toHaveLength(1);
    expect(withCount[0].marketCount).toBe(464);
    expect(plain[0].marketCount).toBeUndefined();
    expect(withCount[0].startTime).toBe("2026-11-07T12:30:00.0000000Z");
    expect(plain[0].startTime).toBe("2026-11-07T12:30:00.0000000Z");
  });
});

describe("betclic as IncrementalScraper", () => {
  it("is incremental-capable with the match concurrency as detail concurrency", () => {
    const s = new BetclicPlaywrightScraper();
    expect(isIncrementalScraper(s)).toBe(true);
    expect(s.detailConcurrency).toBe(resolveBetclicMatchConcurrency());
  });

  it("listing refs", async () => {
    const refs = await new BetclicPlaywrightScraper().listEvents(LEAGUE, budget());
    expect(refs).toHaveLength(1);
    expect(refs[0].kickoff).toBe("2026-11-07T12:30:00.000Z");
    expect(refs[0].fingerprint).toMatch(/^[0-9a-f]{16}$/);
    h.fetchLeagueMatches.mockResolvedValue(WITH_COUNT);
    const withCount = await new BetclicPlaywrightScraper().listEvents(LEAGUE, budget());
    expect(withCount[0].fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(withCount[0].fingerprint).not.toBe(refs[0].fingerprint);
  });

  it("fetchEvent over every ref equals the full pass", async () => {
    const s = new BetclicPlaywrightScraper();
    const refs = await s.listEvents(LEAGUE, budget());
    const perEvent = (await Promise.all(refs.map((r) => s.fetchEvent(LEAGUE, r, budget())))).filter((o) => o !== null);
    const full = await new BetclicPlaywrightScraper().scrapeFullOffer(LEAGUE);
    expect(full.success).toBe(true);
    expect(full.matches).toHaveLength(1);
    expect(stripScrapedAt(perEvent)).toEqual(stripScrapedAt(full.matches));
    expect([refs[0].homeTeam, refs[0].awayTeam]).toEqual([full.matches[0].homeTeam, full.matches[0].awayTeam]);
    expect(refs[0].eventId).toBe(full.matches[0].matchId);
  });

  it("one listing log line per pass", async () => {
    await new BetclicPlaywrightScraper().listEvents(LEAGUE, budget());
    const lines = logSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).filter((l: string) => /^\[Betclic\/FullOffer\] Found \d+ events in listing$/.test(l));
    expect(lines).toEqual(["[Betclic/FullOffer] Found 1 events in listing"]);
  });

  it("fetchEvent maps plan 06's outcomes: failed groups throw, a budget stop throws BudgetExceededError", async () => {
    const s = new BetclicPlaywrightScraper();
    const [ref] = await s.listEvents(LEAGUE, budget());
    h.fetchMarketGroupResults.mockResolvedValueOnce(groupResults({ TOP: "Incomplete gRPC-web frame: 5995/197814 bytes" }));
    await expect(s.fetchEvent(LEAGUE, ref, budget())).rejects.toThrow(/TOP/);

    const aborted = createScrapeBudget(10_000, AbortSignal.abort(new Error("run aborted")));
    h.fetchMarketGroupResults.mockRejectedValueOnce(new Error("aborted"));
    await expect(s.fetchEvent(LEAGUE, ref, aborted)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("a listing without data fails listEvents", async () => {
    h.fetchLeagueMatches.mockResolvedValue(null);
    await expect(new BetclicPlaywrightScraper().listEvents(LEAGUE, budget())).rejects.toThrow("No events found from API");
  });
});
