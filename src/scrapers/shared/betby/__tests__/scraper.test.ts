import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getBookmakerLeagueId } from "../../../../config/leagues.js";
import { BettersPlaywrightScraper } from "../../../bookmakers/betters/index.js";
import { LebullPlaywrightScraper } from "../../../bookmakers/lebull/index.js";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import { createEvidenceFetch } from "./fake-fetch.js";
import { loadJson } from "./fixtures.js";

const LEEDS = "2725816334213586962";
const EVERTON = "2725815896848338956";
const NOW = () => Date.parse("2026-11-06T16:00:00Z");

describe("BetbyScraper", () => {
  let s: BettersPlaywrightScraper;
  let lebull: LebullPlaywrightScraper;
  let log: MockInstance;
  let warn: MockInstance;

  // The scraper logs progress and fallbacks; keep them out of the test output and assert on them where it matters.
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    s = new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters"), now: NOW, eventDelayMs: 0 });
    lebull = new LebullPlaywrightScraper({ fetchText: createEvidenceFetch("lebull"), now: NOW, eventDelayMs: 0 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("betters scrapeFullOffer returns 11 PL matches with string ids, canonical teams and Betby URLs", async () => {
    const initBrowser = vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockRejectedValue(new Error("browser disabled in unit tests"));
    const r = await s.scrapeFullOffer("premier-league");
    expect(initBrowser).not.toHaveBeenCalled();
    expect(r.success).toBe(true); expect(r.matches).toHaveLength(11);
    const leeds = r.matches.find((m) => m.matchId === "2725816334213586962")!;
    expect(leeds).toMatchObject({ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", startTime: "2026-11-07T12:30:00.000Z",
      eventUrl: "https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/leeds-united-tottenham-hotspur-2725816334213586962" });
    expect(leeds.markets).toHaveLength(242);
    expect(r.matches.map((m) => m.markets.length).filter((n) => n > 100).sort((a, b) => a - b)).toEqual([220, 238, 242]);
    expect(s.lastRunStats!.full).toEqual(["2725816334213586962", "2725816334213586981", "2726177353700085769", "2725446939305979931"]);
    expect(s.lastRunStats!.listingOnly).toHaveLength(7);
    expect(s.lastRunStats!.failed).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it("scrapeFullOffer keeps a thin far-future event as a full payload", async () => {
    const r = await s.scrapeFullOffer("premier-league");
    const liv = r.matches.find((m) => m.matchId === "2725446939305979931")!;
    expect(liv).toMatchObject({ homeTeam: "Liverpool", awayTeam: "Manchester United", startTime: "2026-11-22T16:30:00.000Z" });
    expect(liv.markets).toHaveLength(39); // 11 market ids, 39 pairs (live 2026-11-06); not a listing fallback
    expect(new Set(liv.markets.map((m) => m.bookmakerMarketId))).toEqual(new Set(["1", "10", "16", "18", "19", "20", "29", "60", "63", "66", "68"]));
    expect(s.lastRunStats!.listingOnly).not.toContain("2725446939305979931");
  });

  it("scrapeFullOffer falls back to listing markets when the event payload has no events", async () => {
    // live behaviour for a missing event: HTTP 200, envelope without `events` (event-missing-envelope.json)
    const everton = (await s.scrapeFullOffer("premier-league")).matches.find((m) => m.matchId === "2725815896848338956")!;
    expect(everton.markets).toHaveLength(14);
    expect(new Set(everton.markets.map((m) => m.bookmakerMarketId))).toEqual(new Set(["1", "10", "16", "18"]));
    expect(s.lastRunStats!.listingOnly).toContain("2725815896848338956");
  });

  it("scrapeFullOffer falls back to listing markets when the event endpoint 404s", async () => {
    const s404 = new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters", { failures: { "/event/pl/2725816334213586962": 404 } }),
      now: () => Date.parse("2026-11-06T16:00:00Z"), eventDelayMs: 0 });
    const r = await s404.scrapeFullOffer("premier-league");
    expect(r.success).toBe(true); expect(r.matches).toHaveLength(11);
    const leeds = r.matches.find((m) => m.matchId === "2725816334213586962")!;
    expect(new Set(leeds.markets.map((m) => m.bookmakerMarketId))).toEqual(new Set(["1", "10", "16", "18"]));
    expect(leeds.markets).toHaveLength(16); // Leeds listing in snapshot-trimmed.json: 16 (market, specifier) pairs
  });

  it("lebull uses its own prices and the lebull-pl-bb event route", async () => {
    const leeds = (await lebull.scrapeFullOffer("premier-league")).matches.find((m) => m.matchId === "2725816334213586962")!;
    expect(leeds.eventUrl).toBe("https://lebull-pl-bb.boxwebcdn.work/event/1/1669818860410376192/1669818860469096448/2725816334213586962");
    expect(leeds.markets.find((m) => m.bookmakerMarketId === "1")!.selections.map((x) => x.odds)).toEqual([2.76, 3.3, 2.56]);
  });

  it("scrapeFullOffer reports the HTTP status and host instead of 'No events found'", async () => {
    const r = await new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters", { failures: { "/pl/0": 404 } }) }).scrapeFullOffer("premier-league");
    expect(r.success).toBe(false); expect(r.error).toContain("fetch HTTP 404 https://api-h-c7818b61-608.sptpub.com/");
  });

  it("unknown league fails fast and zero upcoming matches is a diagnosed failure", async () => {
    const f = createEvidenceFetch("betters");
    const r1 = await new BettersPlaywrightScraper({ fetchText: f, eventDelayMs: 0 }).scrapeFullOffer("unknown-league");
    expect(r1).toMatchObject({ success: false, error: "Unknown league: unknown-league" });
    expect(f.calls).toHaveLength(0);
    const late = new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters"), now: () => Date.parse("2027-06-01T00:00:00Z"), eventDelayMs: 0 });
    const r2 = await late.scrapeFullOffer("premier-league");
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/0 upcoming matches for tournament 1669818860469096448 in snapshot 1793982002415/);
  });

  it("getBookmakerLeagueId returns Betby tournament ids as strings", () => {
    expect(getBookmakerLeagueId("premier-league", "betters")).toBe("1669818860469096448");
    expect(getBookmakerLeagueId("ekstraklasa", "lebull")).toBe("1669818868635406336");
    expect(typeof getBookmakerLeagueId("laliga", "betters")).toBe("string");
    expect(getBookmakerLeagueId("world-cup-2026", "betters")).toBeUndefined(); // Betby lists only the 2030 edition
    expect(getBookmakerLeagueId("world-cup-2026", "lebull")).toBeUndefined();
  });

  it("every Betby league maps to the same 19-digit tournament id on both brands", () => {
    const ids: Record<string, string> = {
      ekstraklasa: "1669818868635406336",
      "premier-league": "1669818860469096448",
      laliga: "1669819032615915520",
      "serie-a": "1669819042829045760",
      "ligue-1": "1669818844560101376",
    };
    for (const [slug, id] of Object.entries(ids)) {
      expect(getBookmakerLeagueId(slug, "betters")).toBe(id);
      expect(getBookmakerLeagueId(slug, "lebull")).toBe(id);
    }
  });

  it("scrapeFullOffer warns once per listing fallback and logs the completion summary", async () => {
    const r = await s.scrapeFullOffer("premier-league");
    const fallbacks = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("using listing markets"));
    expect(fallbacks).toHaveLength(7);
    expect(fallbacks[0]).toMatch(new RegExp(`^\\[Betters/FullOffer\\] ${EVERTON}: no event payload \\(.+\\); using listing markets$`));
    const total = r.matches.reduce((n, m) => n + m.markets.length, 0);
    expect(log).toHaveBeenCalledWith(`[Betters/FullOffer] Completed: 11 matches (4 full, 7 listing-only, 0 failed), ${total} markets`);
    expect(r.matches.every((m) => m.bookmaker === "betters" && m.scrapedAt.getTime() === NOW())).toBe(true);
  });

  it("scrapeFullOffer skips a match whose event request failed instead of writing listing markets", async () => {
    const f = createEvidenceFetch("betters", { failures: { [`/event/pl/${LEEDS}`]: 500 } });
    const sf = new BettersPlaywrightScraper({ fetchText: f, now: NOW, eventDelayMs: 0 });
    const r = await sf.scrapeFullOffer("premier-league");
    const url = `https://api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2658970707769307140/event/pl/${LEEDS}`;
    expect(r.success).toBe(true); expect(r.matches).toHaveLength(10);
    expect(r.matches.map((m) => m.matchId)).not.toContain(LEEDS);
    expect(r.error).toBe(`1 of 11 details failed | fetch HTTP 500 ${url}`);
    expect(warn).toHaveBeenCalledWith(`[Betters/FullOffer] ${LEEDS}: event request failed (fetch HTTP 500 ${url}); match skipped`);
    expect(sf.lastRunStats!.failed).toEqual([LEEDS]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[Betters\/FullOffer\] Completed: 10 matches \(3 full, 7 listing-only, 1 failed\), \d+ markets$/));
  });

  it("scrapeFullOffer stops after 2 consecutive event failures, writing nothing", async () => {
    const f = createEvidenceFetch("betters", { failures: { "/event/pl/": 500 } });
    const r = await new BettersPlaywrightScraper({ fetchText: f, now: NOW, eventDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, matches: [] });
    expect(r.error).toMatch(/^stopped after 2 consecutive event failures \| fetch HTTP 500 https:\/\/api-h-c7818b61-608\.sptpub\.com\//);
    expect(f.calls.filter((u) => u.includes("/event/pl/"))).toHaveLength(2);
  });

  it("scrapeFullOffer fails the run when more than half of the event requests fail", async () => {
    // Every other event fails, so no two failures are consecutive: 6 of 11 failed.
    const first = createEvidenceFetch("betters");
    await new BettersPlaywrightScraper({ fetchText: first, now: NOW, eventDelayMs: 0 }).scrapeFullOffer("premier-league");
    const ids = first.calls.filter((u) => u.includes("/event/pl/")).map((u) => u.split("/").pop()!);
    const failing = Object.fromEntries(ids.filter((_, i) => i % 2 === 0).map((id) => [`/event/pl/${id}`, 500]));
    const r = await new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters", { failures: failing }), now: NOW, eventDelayMs: 0 })
      .scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, matches: [] });
    expect(r.error).toMatch(/^6 of 11 details failed \| fetch HTTP 500 /);
  });

  it("scrapeFullOffer ignores an event payload whose teams differ from the snapshot", async () => {
    // A payload with home and away swapped would put every price on the wrong side.
    const swapped = loadJson("betters", `event-${LEEDS}.json`);
    swapped.events[LEEDS].desc.competitors.reverse();
    const f = createEvidenceFetch("betters", { overrides: { [`/event/pl/${LEEDS}`]: JSON.stringify(swapped) } });
    const sw = new BettersPlaywrightScraper({ fetchText: f, now: NOW, eventDelayMs: 0 });
    const r = await sw.scrapeFullOffer("premier-league");
    const leeds = r.matches.find((m) => m.matchId === LEEDS)!;
    expect(leeds).toMatchObject({ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur" });
    expect(leeds.markets).toHaveLength(16);
    expect(leeds.markets.find((m) => m.bookmakerMarketId === "1")!.selections.map((x) => x.odds)).toEqual([2.74, 3.3, 2.54]);
    expect(sw.lastRunStats!.listingOnly).toContain(LEEDS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${LEEDS}: no event payload (teams Tottenham Hotspur - Leeds United differ from the snapshot)`));
  });

  it("scrapeFullOffer fails with the HTTP status when the market descriptions fail", async () => {
    const f = createEvidenceFetch("betters", { failures: { "/descriptions/brand/": 503 } });
    const sd = new BettersPlaywrightScraper({ fetchText: f, now: NOW, eventDelayMs: 0 });
    const r = await sd.scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, matches: [] });
    expect(r.error).toContain("fetch HTTP 503 https://api-h-c7818b61-608.sptpub.com/api/v3/descriptions");
    expect(sd.lastRunStats).toBeNull();
  });

  it("scrapeFullOffer pauses eventDelayMs between event requests, 150 ms by default", async () => {
    type WithDelay = { delay: (ms: number) => Promise<void> };
    const delay = vi.spyOn(BettersPlaywrightScraper.prototype as unknown as WithDelay, "delay").mockResolvedValue(undefined);
    await new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters"), now: NOW, eventDelayMs: 7 }).scrapeFullOffer("premier-league");
    expect(delay.mock.calls).toEqual(Array.from({ length: 10 }, () => [7])); // between 11 events, not before the first
    delay.mockClear();
    await new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters"), now: NOW }).scrapeFullOffer("premier-league");
    expect(delay).toHaveBeenCalledTimes(10);
    expect(delay).toHaveBeenCalledWith(150);
    delay.mockClear();
    await s.scrapeFullOffer("premier-league"); // eventDelayMs: 0
    expect(delay).not.toHaveBeenCalled();
  });
});
