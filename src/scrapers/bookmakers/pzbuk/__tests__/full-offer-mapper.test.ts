import { EventEmitter } from "node:events";
import type { BrowserSession } from "../../../base/playwright-base.js";
import { PzbukPlaywrightScraper } from "../index.js";
import { emptyDiagnostics } from "../ws-protocol.js";
import { listingMessage, listingEvents, offerState } from "./helpers/direct-fixture.js";
import { mapEventOffer, buildPzbukMatchOffer } from "../full-offer-mapper.js";
import { parseTeamNames, parseAllMarkets } from "../parser.js";

const h = vi.hoisted(() => ({ resolveCapture: (_s: unknown) => {} }));
vi.mock("../navigation.js", async (orig) => ({
  ...(await orig<typeof import("../navigation.js")>()),
  navigateToLeaguePage: vi.fn(async () => true),
  navigateToEventPage: vi.fn(async (_p: unknown, url: string) => {
    h.resolveCapture({ state: url.includes("/events/4408475-") ? offerState() : null, diagnostics: emptyDiagnostics() });
    return true;
  }),
  captureWebSocketData: vi.fn((_p: unknown, single?: boolean) => single
    ? new Promise((r) => { h.resolveCapture = r; })
    : Promise.resolve({ state: listingMessage().payload[0].payload, diagnostics: emptyDiagnostics() })),
  delay: vi.fn(async () => {}),
}));

// EventEmitter + mainFrame/url/title, so observability's navigation recorder can attach
class OfflineBrowserScraper extends PzbukPlaywrightScraper {
  protected override async initBrowser(): Promise<BrowserSession> {
    const page = Object.assign(new EventEmitter(), { mainFrame: () => null, url: () => "about:blank", title: async () => "" });
    return { page, browser: {}, context: {}, cleanup: async () => {} } as unknown as BrowserSession;
  }
}
const runBrowserPath = () => new OfflineBrowserScraper().scrapeFullOffer("premier-league");
afterEach(() => vi.restoreAllMocks());

describe("pzbuk browser path on the recorded snapshots", () => {
  it("maps only the event whose capture has markets and keeps the recovery failure lines", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runBrowserPath();
    expect(r).toMatchObject({ success: true, bookmaker: "pzbuk", league: "premier-league" });
    expect(r.matches.map(({ markets, scrapedAt, ...m }) => ({ ...m, markets: markets.length,
      selections: markets.reduce((a, x) => a + x.selections.length, 0), at: scrapedAt instanceof Date }))).toEqual([{
      matchId: 4408475, bookmaker: "pzbuk", homeTeam: "Everton", awayTeam: "Coventry City",
      eventUrl: "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-premier-league/events/4408475-everton-fc-coventry-city",
      startTime: "2026-11-06T20:00:00Z", markets: 38, selections: 222, at: true }]);
    expect(log.mock.calls.flat().join("\n")).toContain("[PZBuk/FullOffer] Everton FC vs Coventry City: 38 markets (groups 0/0) (frames: invalid 0, chunked 0, max 0 B)");
    expect(warn.mock.calls.flat().join("\n")).toContain('[PZBuk/FullOffer] Leeds United vs Tottenham Hotspur: no socket matched "sportsbook-api/ws" (sockets seen: none)');
  });
});

describe("mapEventOffer", () => {
  const at = new Date("2026-11-06T16:17:11Z");
  it("reproduces the browser path byte for byte", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [old] = (await runBrowserPath()).matches;
    expect(JSON.stringify(mapEventOffer(listingEvents()[0], offerState(), "premier-league", old.scrapedAt))).toBe(JSON.stringify(old));
  });
  it("buildPzbukMatchOffer is the browser push given the parsed markets", () => {
    const ev = listingEvents()[0]; const teams = parseTeamNames(ev); const markets = parseAllMarkets(offerState(), ev.id, teams);
    expect(buildPzbukMatchOffer(ev, teams, markets, "premier-league", at)).toEqual(mapEventOffer(ev, offerState(), "premier-league", at));
  });
  it("keeps real API names and raw selection labels", () => {
    const m = mapEventOffer(listingEvents()[0], offerState(), "premier-league", at)!;
    expect(m.markets.filter((x) => /^Rynek \d+$/.test(x.name))).toEqual([]);
    const x12 = m.markets.find((x) => x.bookmakerMarketId === "1")!;
    expect([x12.name, x12.selections.map((s) => [s.name, s.odds])]).toEqual(["1x2", [["Everton FC", 1.66], ["Remis", 3.92], ["Coventry City", 4.91]]]);
  });
  it("returns null when the event has no parsed markets", () =>
    expect(mapEventOffer(listingEvents()[1], { events: [], markets: [], selections: [] }, "premier-league", at)).toBeNull());
  it("returns null for a suspended event", () =>
    expect(mapEventOffer({ ...listingEvents()[0], isSuspended: true }, offerState(), "premier-league", at)).toBeNull());
});
