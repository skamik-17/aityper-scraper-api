import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import { groupResults, ORDER, TOP_MSG } from "./betclic-fixtures.js";
import { hasTransportStats } from "../../../shared/scraper-contract.js";
import { addBetclicTransportStats, type BetclicTransportStats } from "../navigation.js";
import { toIsoStartTime } from "../../../shared/start-time.js";

const h = vi.hoisted(() => ({
  fetchLeagueMatches: vi.fn(),
  fetchMarketGroupResults: vi.fn(),
  listing: vi.fn(),
}));

vi.mock("../navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../navigation.js")>()),
  fetchLeagueMatches: h.fetchLeagueMatches,
  fetchMarketGroupResults: h.fetchMarketGroupResults,
}));

vi.mock("../parser.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../parser.js")>()),
  parseListingResponse: h.listing,
}));

import { BetclicPlaywrightScraper } from "../index.js";
import { resolveBetclicMatchConcurrency } from "../constants.js";

const odds = { homeOdds: 1.3, drawOdds: 5.5, awayOdds: 9 };
const ARSENAL = { matchId: "1261715874385920", matchName: "Arsenal - Hull", homeTeam: "Arsenal", awayTeam: "Hull", ...odds };
const LEEDS = { matchId: "1261714312019968", matchName: "Leeds - Tottenham", homeTeam: "Leeds", awayTeam: "Tottenham", ...odds };
const THIRD = { matchId: "1261700000000003", matchName: "Home3 - Away3", homeTeam: "Home3", awayTeam: "Away3", ...odds };

const TOP_ERR = "Incomplete gRPC-web frame: 5995/197814 bytes";

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
const joined = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: unknown[]) => c.map(String).join(" "));
const logLines = () => joined(logSpy);
const warnLines = () => joined(warnSpy);

const scrape = () => new BetclicPlaywrightScraper().scrapeFullOffer("premier-league");

/** Per-match group results keyed by match id. */
const byMatch = (map: Record<string, ReturnType<typeof groupResults>>) =>
  h.fetchMarketGroupResults.mockImplementation(async (id: string) => map[id] ?? groupResults());

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockRejectedValue(new Error("browser disabled in unit tests"));
  h.fetchLeagueMatches.mockResolvedValue(Buffer.alloc(16));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const SEVEN = Array.from({ length: 7 }, (_, i) => ({
  matchId: `126170000000000${i}`, matchName: `Home${i} - Away${i}`, homeTeam: `Home${i}`, awayTeam: `Away${i}`, ...odds,
}));

/** Counts in-flight matches; later matches finish first. */
function trackConcurrency() {
  const seen = { inFlight: 0, peak: 0 };
  h.fetchMarketGroupResults.mockImplementation(async (id: string) => {
    seen.inFlight++;
    seen.peak = Math.max(seen.peak, seen.inFlight);
    await new Promise((r) => setTimeout(r, 40 - 5 * Number(id.slice(-1))));
    seen.inFlight--;
    return groupResults();
  });
  return seen;
}

describe("BetclicPlaywrightScraper.scrapeFullOffer concurrency", () => {
  it("fetches at most 3 matches at a time and keeps listing order", async () => {
    h.listing.mockReturnValue(SEVEN);
    const seen = trackConcurrency();
    const r = await scrape();
    expect(seen.peak).toBe(3);
    expect(r.matches.map((m) => m.matchId)).toEqual(SEVEN.map((m) => m.matchId));
  });

  it("BETCLIC_MATCH_CONCURRENCY=1 runs one match at a time", async () => {
    vi.stubEnv("BETCLIC_MATCH_CONCURRENCY", "1");
    h.listing.mockReturnValue(SEVEN);
    const seen = trackConcurrency();
    const r = await scrape();
    expect(seen.peak).toBe(1);
    expect(r.matches).toHaveLength(7);
  });

  it("keeps the check-log-vs-smoke formats under concurrency", async () => {
    h.listing.mockReturnValue(SEVEN);
    trackConcurrency();
    await scrape();
    const totals = logLines().filter((l) => /^\[Betclic\/FullOffer\] (.+?) vs (.+?): (\d+) markets total$/.test(l));
    expect(totals).toHaveLength(7);
    expect(logLines().filter((l) => l === "[Betclic/FullOffer] Found 7 events in listing")).toHaveLength(1);
  });

  it("the first skip reason follows listing order, not completion order", async () => {
    h.listing.mockReturnValue(SEVEN);
    h.fetchMarketGroupResults.mockImplementation(async (id: string) => {
      await new Promise((r) => setTimeout(r, 40 - 5 * Number(id.slice(-1))));
      return id.endsWith("1") || id.endsWith("5") ? groupResults({ TOP: `TOP down ${id.slice(-1)}` }) : groupResults();
    });
    expect((await scrape()).error).toBe("2 of 7 details failed | TOP missing: TOP down 1");
  });

  it("resolveBetclicMatchConcurrency accepts 1-7 only", () => {
    expect(resolveBetclicMatchConcurrency({})).toBe(3);
    expect(resolveBetclicMatchConcurrency({ BETCLIC_MATCH_CONCURRENCY: "1" })).toBe(1);
    expect(resolveBetclicMatchConcurrency({ BETCLIC_MATCH_CONCURRENCY: "7" })).toBe(7);
    for (const v of ["0", "8", "2.5", "x"]) expect(resolveBetclicMatchConcurrency({ BETCLIC_MATCH_CONCURRENCY: v })).toBe(3);
  });
});

describe("BetclicPlaywrightScraper.scrapeFullOffer", () => {
  it("declares the http transport (plan 07 job classification)", () =>
    expect(new BetclicPlaywrightScraper().transport).toBe("http"));

  it("writes every match whose groups completed, never touching a browser", async () => {
    const initBrowser = vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser");
    h.listing.mockReturnValue([ARSENAL, LEEDS]);
    h.fetchMarketGroupResults.mockResolvedValue(groupResults());
    const r = await scrape();
    expect(r.success).toBe(true);
    expect("error" in r).toBe(false);
    expect(r.matches.map((m) => m.markets.length)).toEqual([32, 32]);
    expect(initBrowser).not.toHaveBeenCalled();
    expect(logLines()).toContain("[Betclic/FullOffer] Arsenal vs Hull: 32 markets total");
    expect(logLines()).toContain("[Betclic/FullOffer] Arsenal vs Hull: received 2 response(s) from 7 market groups, 5 duplicate(s) not parsed");
  });

  it("skips a match whose TOP failed, says why, and keeps the cause on success", async () => {
    h.listing.mockReturnValue([ARSENAL, LEEDS]);
    byMatch({ [ARSENAL.matchId]: groupResults({ TOP: TOP_ERR }) });
    const r = await scrape();
    expect(r).toMatchObject({ success: true, error: `1 of 2 details failed | TOP missing: ${TOP_ERR}` });
    expect(r.matches.map((m) => m.matchId)).toEqual([LEEDS.matchId]);
    expect(warnLines()).toContain(`[Betclic/FullOffer] Skipping Arsenal vs Hull (ID: 1261715874385920): TOP missing: ${TOP_ERR}`);
    expect(warnLines()).toContain(`[betclic] 1 of 2 details failed | TOP missing: ${TOP_ERR}`);
  });

  it("skips a match when one non-TOP group failed (today: TOP-only write after the broken fallback)", async () => {
    h.listing.mockReturnValue([ARSENAL, LEEDS]);
    byMatch({ [ARSENAL.matchId]: groupResults({ STRZELCY: "Incomplete gRPC-web frame: 388976/1295527 bytes" }) });
    const r = await scrape();
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].matchId).toBe(LEEDS.matchId);
  });

  it("a completed group under 100 bytes is not a failure", async () => {
    h.listing.mockReturnValue([ARSENAL]);
    byMatch({ [ARSENAL.matchId]: groupResults({ HANDICAP: Buffer.alloc(40) }) });
    const r = await scrape();
    expect(r.success).toBe(true);
    expect(r.matches[0].markets).toHaveLength(29);
  });

  it("a match whose groups parse to 0 markets is skipped, not dropped silently", async () => {
    h.listing.mockReturnValue([ARSENAL]);
    h.fetchMarketGroupResults.mockResolvedValue(groupResults(Object.fromEntries(ORDER.map((g) => [g, TOP_MSG.subarray(0, 5995)]))));
    expect(await scrape()).toMatchObject({ success: false, matches: [], error: "1 of 1 details failed | 0 markets parsed" });
  });

  it("logs per-match and per-run transport stats and keeps cumulative totals", async () => {
    h.listing.mockReturnValue([ARSENAL, LEEDS]);
    h.fetchLeagueMatches.mockImplementation(async (_league: string, opts?: { stats?: BetclicTransportStats }) => {
      if (opts?.stats) addBetclicTransportStats(opts.stats, { requests: 1, retries: 0, failures: 0, bytes: 100, byStatus: { "200": 1 }, gzipResponses: 1 });
      return Buffer.alloc(16);
    });
    h.fetchMarketGroupResults.mockImplementation(async (_id: string, opts?: { stats?: BetclicTransportStats }) => {
      if (opts?.stats) addBetclicTransportStats(opts.stats, { requests: 7, retries: 0, failures: 0, bytes: 1000, byStatus: { "200": 7 }, gzipResponses: 7 });
      return groupResults();
    });
    const s = new BetclicPlaywrightScraper();
    await s.scrapeFullOffer("premier-league");
    expect(logLines()).toContain("[Betclic/Transport] Arsenal vs Hull: wire 1000 B, 7 requests, 0 retries, 0 failures, gzip 7/7");
    expect(logLines().filter((l) => /^\[Betclic\/Transport\] premier-league: 2\/2 matches in \d+ ms, wire 2100 B, 15 requests, 0 retries, 0 failures, gzip 15\/15$/.test(l)))
      .toHaveLength(1);
    expect(hasTransportStats(s)).toBe(true);
    const first = s.transportStats();
    expect(first).toEqual({ http: { requests: 15, retries: 0, failures: 0, bytes: 2100, byStatus: { "200": 15 } } });
    await s.scrapeFullOffer("premier-league");
    const second = s.transportStats();
    expect(second).toEqual({ http: { requests: 30, retries: 0, failures: 0, bytes: 4200, byStatus: { "200": 30 } } });
    expect(second).not.toBe(first);
    expect(second.http!.byStatus).not.toBe(first.http!.byStatus);
  });

  it("writes an OPTA match whose METODA_GOLA failed", async () => {
    h.listing.mockReturnValue([ARSENAL]);
    byMatch({ [ARSENAL.matchId]: groupResults({ METODA_GOLA: "x" }) });
    const r = await scrape();
    expect(r.success).toBe(true);
    expect(r.matches[0].markets).toHaveLength(32);
    expect(warnLines().some((l) => l.startsWith("[Betclic/FullOffer] Skipping"))).toBe(false);
  });

  it("never sets startTime from the header (plan 01 owns betclic start_time)", async () => {
    const LISTED_KICKOFF = "2026-11-07T15:00:00.0000000Z";
    h.listing.mockReturnValue([{ ...ARSENAL, startTime: LISTED_KICKOFF }, LEEDS]);
    h.fetchMarketGroupResults.mockResolvedValue(groupResults());
    const r = await scrape();
    expect(r.matches[0].startTime).toBe(toIsoStartTime(LISTED_KICKOFF));
    expect(r.matches[0].startTime).toBe("2026-11-07T15:00:00.000Z");
    expect(r.matches[1].startTime).toBeUndefined(); // no listing kickoff: the header never supplies one
  });

  it("fails the run when more than half of the attempted matches are skipped", async () => {
    h.listing.mockReturnValue([ARSENAL, LEEDS, THIRD]);
    byMatch({ [ARSENAL.matchId]: groupResults({ TOP: TOP_ERR }), [LEEDS.matchId]: groupResults({ TOP: TOP_ERR }) });
    expect(await scrape()).toMatchObject({ success: false, matches: [], error: `2 of 3 details failed | TOP missing: ${TOP_ERR}` });
  });
});
