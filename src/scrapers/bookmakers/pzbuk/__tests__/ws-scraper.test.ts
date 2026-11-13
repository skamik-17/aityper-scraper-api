import { PzbukWsScraper } from "../ws-scraper.js";
import { PZBUK_WS_URL, PZBUK_WS_HEADERS } from "../ws-direct.js";
import { mapEventOffer } from "../full-offer-mapper.js";
import { createScrapeBudget } from "../../../shared/budget.js";
import { hasTransportStats } from "../../../shared/scraper-contract.js";
import { browserPool } from "../../../base/browser-pool.js";
import { scriptedSession } from "./helpers/scripted-ws-session.js";
import { wire, chunk, listingMessage, listingEvents, offerMessage, offerState, SETUP_32K } from "./helpers/direct-fixture.js";

const SUB1 = /^\{"type":"SUBSCRIBE","streamId":1,/, SUB3 = /^\{"type":"SUBSCRIBE","streamId":3,/;
const ERROR_3 = Buffer.from('{"type":"ERROR","streamId":3,"message":"Unknown route"}');
const happy = (ids = [4408475]) => scriptedSession([{ after: "open", frames: [SETUP_32K] },
  { after: SUB1, frames: chunk(wire(listingMessage(ids)), 32768) }, { after: SUB3, frames: chunk(wire(offerMessage()), 32768) }]);
const make = (...attempts: Array<ReturnType<typeof scriptedSession> | Error>) => {
  const open = vi.fn();
  for (const a of attempts) a instanceof Error ? open.mockRejectedValueOnce(a) : open.mockResolvedValueOnce(a);
  return { open, scraper: new PzbukWsScraper({ openSession: open, retryDelayMs: () => 0 }) };
};
const strip = (m: object) => ({ ...m, scrapedAt: null });
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("PzbukWsScraper", () => {
  it("maps a complete event exactly like the browser path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const session = happy(); const { open, scraper } = make(session);
    const r = await scraper.scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, bookmaker: "pzbuk", league: "premier-league" });
    expect(scraper.transport).toBe("websocket");
    expect(r.matches.map(strip)).toEqual([strip(mapEventOffer(listingEvents()[0], offerState(), "premier-league", new Date())!)]);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ url: PZBUK_WS_URL, headers: PZBUK_WS_HEADERS, connectTimeoutMs: 10_000 }));
    expect([session.sent.length, session.closed, typeof r.duration, "error" in r]).toEqual([3, true, "number", false]);
    expect(log.mock.calls.flat().join("\n")).toContain("[PZBuk/FullOffer] Everton FC vs Coventry City: 38 markets (groups 2/2, markets counted 52/52)");
  });
  it("reports ws transport counters and frame counters", async () => {
    const { scraper } = make(happy()); await scraper.scrapeFullOffer("premier-league");
    expect(hasTransportStats(scraper)).toBe(true);
    expect(scraper.transportStats()).toEqual({ ws: { framesReceived: 6, bytesReceived: 120_723 } }); // 34 + 11 101 + 109 588
    expect(scraper.frameCounters()).toEqual({ invalidFrames: 0, chunkedFrames: 3, maxFrameBytes: 109_588 });
  });
  it("counters are cumulative across calls (README §3: monotonic; consumers diff)", async () => {
    const { scraper } = make(happy(), happy());
    await scraper.scrapeFullOffer("premier-league"); await scraper.scrapeFullOffer("premier-league");
    expect(scraper.transportStats()).toEqual({ ws: { framesReceived: 12, bytesReceived: 241_446 } });
    expect(scraper.frameCounters()).toEqual({ invalidFrames: 0, chunkedFrames: 6, maxFrameBytes: 109_588 });
  });
  it("skips incomplete events and fails when more than half are skipped", async () => {
    const r = await make(happy([4408475, 4408509, 4408525])).scraper.scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, matches: [],
      error: "2 of 3 details failed | 4408509 Leeds United vs Tottenham Hotspur: not in offer (groups 0/10, markets counted 0/235)" });
  });
  it("succeeds with one skipped event out of two (0.5 is not above the limit) and keeps the cause", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await make(happy([4408475, 4408509])).scraper.scrapeFullOffer("premier-league");
    expect([r.success, r.matches.length, r.error]).toEqual([true, 1,
      "1 of 2 details failed | 4408509 Leeds United vs Tottenham Hotspur: not in offer (groups 0/10, markets counted 0/235)"]);
    expect(warn.mock.calls.flat().join("\n")).toContain("[PZBuk/FullOffer] skipped 4408509 Leeds United vs Tottenham Hotspur: not in offer (groups 0/10, markets counted 0/235)");
  });
  it("returns success with no matches for an empty listing", async () => {
    const session = happy([]);
    expect(await make(session).scraper.scrapeFullOffer("premier-league")).toMatchObject({ success: true, matches: [] });
    expect(session.sent).toHaveLength(2);
  });
  it("passes a handshake 4xx through in ws wording without retrying", async () => {
    const { open, scraper } = make(new Error(`ws handshake HTTP 403 ${PZBUK_WS_URL}`));
    expect(await scraper.scrapeFullOffer("premier-league")).toMatchObject({ success: false, matches: [], error: `ws handshake HTTP 403 ${PZBUK_WS_URL}` });
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("retries once after the socket drops", async () => {
    const dropped = scriptedSession([{ after: "open", frames: [SETUP_32K] }], { failWith: new Error(`ws closed 1006 ${PZBUK_WS_URL}`) });
    const { open, scraper } = make(dropped, happy());
    expect((await scraper.scrapeFullOffer("premier-league")).success).toBe(true);
    expect([open.mock.calls.length, dropped.closed]).toEqual([2, true]);
  });
  it("retries a refused connection once, then reports it", async () => {
    const refused = () => new Error(`ws failed ECONNREFUSED ${PZBUK_WS_URL}`);
    const { open, scraper } = make(refused(), refused());
    expect((await scraper.scrapeFullOffer("premier-league")).error).toBe(`ws failed ECONNREFUSED ${PZBUK_WS_URL}`);
    expect(open).toHaveBeenCalledTimes(2);
  });
  it("names the phase when no listing arrives, after one retry", async () => {
    const setupOnly = () => scriptedSession([{ after: "open", frames: [SETUP_32K] }]);
    const { open, scraper } = make(setupOnly(), setupOnly());
    expect((await scraper.scrapeFullOffer("premier-league")).error).toBe(`ws timeout 15000ms ${PZBUK_WS_URL} | no listing (frames: 1, invalid: 0)`);
    expect(open).toHaveBeenCalledTimes(2);
  });
  it("names the last control frame when the offer never arrives", async () => {
    const noOffer = () => scriptedSession([{ after: "open", frames: [SETUP_32K] },
      { after: SUB1, frames: [wire(listingMessage([4408475]))] }, { after: SUB3, frames: [ERROR_3] }]);
    expect((await make(noOffer(), noOffer()).scraper.scrapeFullOffer("premier-league")).error)
      .toBe(`ws timeout 15000ms ${PZBUK_WS_URL} | no offer for 1 event(s) (frames: 3, invalid: 0, last control: ERROR Unknown route)`);
  });
  it("bounds the collect timeout by the remaining budget", async () => {
    const session = happy();
    await make(session).scraper.scrapeFullOffer("premier-league", createScrapeBudget(2_000));
    expect(session.timeouts[0]).toBeLessThanOrEqual(2_000);
  });
  it("rejects an unsupported league without opening a socket", async () => {
    const { open, scraper } = make();
    expect(await scraper.scrapeFullOffer("bundesliga")).toMatchObject({ success: false, matches: [], error: "Unknown league: bundesliga" });
    expect(open).not.toHaveBeenCalled();
  });
  it("never touches the browser pool", async () => {
    const acquire = vi.spyOn(browserPool, "acquire");
    await make(happy()).scraper.scrapeFullOffer("premier-league");
    expect(acquire).not.toHaveBeenCalled();
  });
});
