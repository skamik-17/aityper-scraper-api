import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import { groupResults, ORDER, TOP_MSG } from "./betclic-fixtures.js";

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
afterEach(() => vi.restoreAllMocks());

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

  it("fails the run when more than half of the attempted matches are skipped", async () => {
    h.listing.mockReturnValue([ARSENAL, LEEDS, THIRD]);
    byMatch({ [ARSENAL.matchId]: groupResults({ TOP: TOP_ERR }), [LEEDS.matchId]: groupResults({ TOP: TOP_ERR }) });
    expect(await scrape()).toMatchObject({ success: false, matches: [], error: `2 of 3 details failed | TOP missing: ${TOP_ERR}` });
  });
});
