import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { envelope, runBrowserPathOffline, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
import { SuperbetPlaywrightScraper } from "../index.js";
import { buildSuperbetListingUrl } from "../navigation.js";
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
    const { result, requests } = await runBrowserPathOffline(new SuperbetPlaywrightScraper(), "premier-league", ROUTES);
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
