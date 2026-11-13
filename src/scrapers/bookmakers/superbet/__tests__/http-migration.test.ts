import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { captureLogs, envelope, runBrowserPathOffline, stripScrapedAt, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
import { browserPool } from "../../../base/browser-pool.js";
import type { HttpClient } from "../../../shared/http/http-client.js";
import { SuperbetHttpScraper } from "../http-scraper.js";
import { SuperbetBrowserScraper } from "../index.js";
import { buildSuperbetListingUrl, superbetEventDetailUrl } from "../navigation.js";
import { parseAllMarkets, parseTeamNames } from "../parser.js";
import type { SuperbetEventDetailResponse, SuperbetEventsResponse } from "../types.js";
import { mapSuperbetEventOffer, selectUpcomingSuperbetEvents } from "../full-offer-mapping.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/http-migration/${n}`, import.meta.url), "utf8");
const CAPTURED_AT = new Date("2026-11-07T00:40:00Z");
const API = "https://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL";
const LISTING_URL = `${API}/events/by-date?offerState=prematch&startDate=2026-11-07+00:00:00&endDate=2027-02-05+00:00:00&sportId=5&tournamentIds=106`;
const DETAIL_URL = (id: number) => `${API}/events/${id}`;
const ROUTES: ReplayRoutes = {
  [LISTING_URL]: { body: fx("by-date-premier-league.json") },
  [DETAIL_URL(14438716)]: { body: fx("event-14438716.json") }, // Arsenal–Hull City (near-term)
  [DETAIL_URL(14656301)]: { body: fx("event-14656301.json") }, // Manchester City–Fulham (far)
  [DETAIL_URL(14438722)]: { status: 500, body: "upstream" }, // Leeds–Tottenham: failure
};
const EVENT = (id: number) => (JSON.parse(fx(`event-${id}.json`)) as SuperbetEventDetailResponse).data[0];
const parsed = (id: number) => parseAllMarkets(EVENT(id), parseTeamNames(EVENT(id).matchName));
const ENVELOPES = [
  { matchId: "14438716", bookmaker: "superbet", homeTeam: "Arsenal", awayTeam: "Hull City", startTime: "2026-11-07T15:00:00.000Z",
    eventUrl: "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/14438716" },
  { matchId: "14656301", bookmaker: "superbet", homeTeam: "Manchester City", awayTeam: "Fulham", startTime: "2026-11-21T12:30:00.000Z",
    eventUrl: "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/14656301" },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: CAPTURED_AT });
  for (const level of ["warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("superbet browser path (characterization, recorded 2026-11-07)", () => {
  it("listing URL equals plan 01's builder output (literal '+' and ':')", () => expect(buildSuperbetListingUrl("106", CAPTURED_AT)).toBe(LISTING_URL));

  it("browser path (characterization): kickoff order, finished event dropped, failed detail absent", async () => {
    const { result, requests } = await runBrowserPathOffline(new SuperbetBrowserScraper(), "premier-league", ROUTES);
    expect(result.success).toBe(true);
    expect(result.matches.map(envelope)).toEqual(ENVELOPES);
    expect(result.matches.map((m) => m.markets)).toEqual([parsed(14438716), parsed(14656301)]);
    expect(requests).toEqual([LISTING_URL, DETAIL_URL(14438722), DETAIL_URL(14438716), DETAIL_URL(14656301)]);
  });
});

describe("superbet full-offer mapping", () => {
  it("selectUpcomingSuperbetEvents filters finished and kicked-off events and sorts by kickoff", () => {
    const listing = (JSON.parse(fx("by-date-premier-league.json")) as SuperbetEventsResponse).data;
    expect(selectUpcomingSuperbetEvents(listing, CAPTURED_AT.getTime()).map((e) => e.eventId)).toEqual([14438722, 14438716, 14656301]);
    expect(selectUpcomingSuperbetEvents(listing, Date.parse("2026-11-07T13:00:00Z")).map((e) => e.eventId)).toEqual([14438716, 14656301]);
  });

  it("mapSuperbetEventOffer maps data[0] and returns null for no event", () => {
    expect(envelope(mapSuperbetEventOffer({ data: [EVENT(14438716)] } as SuperbetEventDetailResponse, "premier-league")!)).toEqual(ENVELOPES[0]);
    expect(mapSuperbetEventOffer({ data: [] } as unknown as SuperbetEventDetailResponse, "premier-league")).toBeNull();
    expect(mapSuperbetEventOffer(null, "premier-league")).toBeNull();
  });
});

const fullOfferLines = (l: string[]) => l.filter((line) => line.startsWith("[Superbet/FullOffer]"));

describe("SuperbetHttpScraper", () => {
  const run = (routes: ReplayRoutes) => new SuperbetHttpScraper(createReplayHttpClient(routes)).scrapeFullOffer("premier-league");

  it("URL builder reproduces the browser detail URL byte for byte", () => expect(superbetEventDetailUrl(14438716)).toBe(DETAIL_URL(14438716)));

  it("declares transport http", () => expect(new SuperbetHttpScraper().transport).toBe("http"));

  it("contract: deep-equals the browser path; the failed detail is reported, not dropped silently", async () => {
    const old = await runBrowserPathOffline(new SuperbetBrowserScraper(), "premier-league", ROUTES);
    const client = createReplayHttpClient(ROUTES);
    const { value: neu, logs } = await captureLogs(() => new SuperbetHttpScraper(client).scrapeFullOffer("premier-league"));
    expect(neu).toMatchObject({ success: true, error: `1 of 3 details failed | fetch HTTP 500 ${DETAIL_URL(14438722)}` });
    expect(neu.matches).toHaveLength(2);
    expect(stripScrapedAt(neu.matches)).toEqual(stripScrapedAt(old.result.matches));
    expect(client.calls.filter((u) => !old.requests.includes(u))).toEqual([]);
    expect(fullOfferLines(logs)).toEqual(fullOfferLines(old.logs));
  });

  it("never acquires a browser", async () => {
    const acquire = vi.spyOn(browserPool, "acquire");
    await run(ROUTES);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("fails with the first cause when more than half the details fail", async () =>
    expect(await run({ ...ROUTES, [DETAIL_URL(14438716)]: { status: 500, body: "upstream" } }))
      .toMatchObject({ success: false, error: `2 of 3 details failed | fetch HTTP 500 ${DETAIL_URL(14438722)}` }));

  it("a listing HTTP error becomes the result error", async () =>
    expect(await run({ ...ROUTES, [LISTING_URL]: { status: 404, body: "nf" } })).toMatchObject({ success: false, error: `fetch HTTP 404 ${LISTING_URL}` }));

  it("an empty listing is success:true with no matches and no detail request (README §3)", async () => {
    const client = createReplayHttpClient({ ...ROUTES, [LISTING_URL]: { body: '{"data":[]}' } });
    expect(await new SuperbetHttpScraper(client).scrapeFullOffer("premier-league")).toMatchObject({ success: true, matches: [] });
    expect(client.calls).toEqual([LISTING_URL]);
    expect(console.warn).toHaveBeenCalledWith(`[Superbet/FullOffer] No events found from API ${LISTING_URL}`);
  });

  it("a malformed listing (no data array) fails", async () =>
    expect(await run({ ...ROUTES, [LISTING_URL]: { body: '{"error":"x"}' } })).toMatchObject({ success: false, error: `fetch unexpected payload ${LISTING_URL}` }));

  it("wrong shape: a 200 without a data array is skipped; {data:[]} is no offer", async () => {
    const r = await run({ ...ROUTES, [DETAIL_URL(14438716)]: { body: '{"error":"x"}' }, [DETAIL_URL(14438722)]: { body: '{"data":[]}' } });
    expect(r).toMatchObject({ success: true, error: `1 of 2 details failed | fetch unexpected payload ${DETAIL_URL(14438716)}` });
    expect(r.matches.map((m) => m.matchId)).toEqual(["14656301"]);
  });

  it("keeps listing order when the first detail resolves last", async () => {
    const base = createReplayHttpClient(ROUTES);
    const slow: HttpClient = {
      stats: base.stats,
      getText: (u, o) => base.getText(u, o),
      getJson: async <T>(u: string, o?: Parameters<HttpClient["getJson"]>[1]) => {
        if (u === DETAIL_URL(14438716)) await new Promise((r) => setTimeout(r, 50));
        return base.getJson<T>(u, o);
      },
    };
    const r = await new SuperbetHttpScraper(slow).scrapeFullOffer("premier-league");
    expect(r.matches.map((m) => m.matchId)).toEqual(["14438716", "14656301"]);
  });
});
