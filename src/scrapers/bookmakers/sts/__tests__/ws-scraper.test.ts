import { describe, it, expect, vi } from "vitest";
vi.mock("../parser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../parser.js")>();
  return { ...original, parseWebSocketJson: vi.fn(original.parseWebSocketJson) };
});
import * as parser from "../parser.js";
import { createScrapeBudget } from "../../../shared/budget.js";
import { hasTransportStats } from "../../../shared/scraper-contract.js";
import { StsWsScraper } from "../ws-scraper.js";
import { STS_WS_HEADERS } from "../ws-protocol.js";
import { createFakeStsServer, runWsPath } from "./helpers/fake-sts-server.js";
import { WS_IDS, readStsFixture, wsInput, wsIplFrame, wsSnapshotFrame } from "./helpers/sts-frames.js";

const URL = "wss://www.sts.pl/sbk/api/sbk";
const DELTA = readStsFixture("f_f2921896_pl.leeds-tottenham.delta.txt");
const ALL = '{"t":1,"u":[{"s":"i_pl"},{"s":"f_f2921896_pl","n":0},{"s":"f_f2921905_pl","n":0},{"s":"f_f2921906_pl","n":0},{"s":"f_f2921911_pl","n":0}]}';
const MISS = (n: number) => `${n} of 4 details failed | ws timeout 5000ms ${URL}`;
const HINT = (kind: string) => `[STS/WS] ${kind} - set SCRAPER_TRANSPORT_STS=browser to use the browser path`;

describe("StsWsScraper", () => {
  it("one session: i_pl, then all four fixture snapshots in one message", async () => {
    const { value: r, lines, server, scraper } = await runWsPath(wsInput());
    expect(r).toMatchObject({ success: true, bookmaker: "sts", league: "premier-league" });
    expect("error" in r).toBe(false);
    expect(r.matches.map((m) => m.matchId)).toEqual([...WS_IDS]);
    expect(server.opened).toEqual([{ url: URL, headers: STS_WS_HEADERS, connectTimeoutMs: 10000, budget: expect.anything() }]);
    expect(server.sent).toEqual(['{"t":1,"u":[{"s":"i_pl","n":0}]}', '{"t":4}', ALL]);
    expect(server.collectTimeouts).toEqual([10000, 5000]);
    expect(server.closeCalls).toBe(1);
    expect(lines).toContain("[STS/FullOffer] Found 4 fixtures for premier-league");
    expect(lines.some((l) => /^\[STS\/WS\] Done in \d+ms: \d+ frames, \d+ bytes, 0 re-sent$/.test(l))).toBe(true);
    expect(scraper.transport).toBe("websocket");
    expect(hasTransportStats(scraper)).toBe(true);
    expect(scraper.transportStats()).toEqual({ ws: { framesReceived: 5, bytesReceived: expect.any(Number) } }); // i_pl + 4 snapshots
  });

  it("re-sends once, with n:0 only for the missing fixture", async () => {
    const { value: r, lines, server } = await runWsPath(wsInput(), { silentFirst: ["f2921906"] });
    expect(server.sent[3]).toBe('{"t":1,"u":[{"s":"i_pl"},{"s":"f_f2921896_pl"},{"s":"f_f2921905_pl"},{"s":"f_f2921906_pl","n":0},{"s":"f_f2921911_pl"}]}');
    expect(server.sent).toHaveLength(4);
    expect(server.collectTimeouts).toEqual([10000, 5000, 5000]);
    expect(r.matches).toHaveLength(4);
    expect("error" in r).toBe(false);
    expect(lines.some((l) => / 1 re-sent$/.test(l))).toBe(true);
  });

  it("transportStats() is cumulative across calls on one instance", async () => {
    const server = createFakeStsServer({ ipl: [wsIplFrame()], fixtures: wsInput().byFixture });
    const s = new StsWsScraper({ openSession: server.open });
    await s.scrapeFullOffer("premier-league"); const first = s.transportStats().ws!;
    await s.scrapeFullOffer("premier-league");
    expect(s.transportStats().ws).toEqual({ framesReceived: 10, bytesReceived: 2 * first.bytesReceived });
    expect(server.opened).toHaveLength(2);
  });

  it("a fixture delta before its snapshot does not complete the fixture", async () => {
    const input = wsInput(); input.byFixture.f2921896 = [DELTA, wsSnapshotFrame("f2921896")];
    const { value: r, server } = await runWsPath(input);
    expect(r.matches).toHaveLength(4);
    expect(r.matches.find((m) => m.matchId === "f2921896")!.markets.length).toBeGreaterThan(400);
    expect(server.sent).toHaveLength(3);
  });

  it("an i_pl delta before the i_pl snapshot does not end the listing wait", async () => {
    const { value: r, lines } = await runWsPath(wsInput(), { ipl: [readStsFixture("ws-2026-11-07/i_pl.delta.txt"), wsIplFrame()] });
    expect(lines).toContain("[STS/FullOffer] Found 4 fixtures for premier-league");
    expect(r.matches).toHaveLength(4);
  });

  it("skips a fixture whose snapshot never comes", async () => {
    const { value: r, lines } = await runWsPath(wsInput(), { silentAlways: ["f2921906"] });
    expect(r).toMatchObject({ success: true, error: MISS(1) });
    expect(r.matches.map((m) => m.matchId)).toEqual(["f2921896", "f2921905", "f2921911"]);
    expect(lines).toContain("[STS/FullOffer] No fixture snapshot for Chelsea vs Leeds after 2 attempts - skipping (previous snapshot kept)");
    expect(lines.some((l) => /^\[STS\/FullOffer\] Completed: 3 matches, \d+ total markets$/.test(l))).toBe(true);
  });

  it("a delta-only fixture is skipped like a missing one", async () => {
    const input = wsInput(); input.byFixture.f2921896 = [DELTA];
    const { value: r, lines, server } = await runWsPath(input);
    expect(r.matches).toHaveLength(3);
    expect(r.error).toBe(MISS(1));
    expect(lines).toContain("[STS/FullOffer] No fixture snapshot for Leeds vs Tottenham after 2 attempts - skipping (previous snapshot kept)");
    expect(JSON.parse(server.sent[3]).u).toContainEqual({ s: "f_f2921896_pl", n: 0 });
  });

  it("trips the breaker when 3 of 4 snapshots never come", async () => {
    const { value: r, lines, server } = await runWsPath(wsInput(), { silentAlways: ["f2921905", "f2921906", "f2921911"] });
    expect(r).toMatchObject({ success: false, matches: [], error: MISS(3) });
    expect(lines.some((l) => l.startsWith("[STS/FullOffer] Completed:"))).toBe(false);
    expect(lines).toContain(HINT("protocol"));
    expect(server.closeCalls).toBe(1);
  });

  it("2 of 4 missing does not trip the breaker", async () => {
    const { value: r } = await runWsPath(wsInput(), { silentAlways: ["f2921905", "f2921911"] });
    expect(r).toMatchObject({ success: true, error: MISS(2) });
    expect(r.matches).toHaveLength(2);
  });

  it("handshake 403: session message, fallback hint, nothing sent", async () => {
    const msg = `ws handshake HTTP 403 ${URL}`;
    const { value: r, lines, server } = await runWsPath(wsInput(), { openError: new Error(msg) });
    expect(r).toMatchObject({ success: false, error: msg, matches: [] });
    expect(lines).toContain(`[sts] Full offer scraper error: ${msg}`);
    expect(lines).toContain(HINT("blocked"));
    expect(server.sent).toEqual([]);
    expect(server.closeCalls).toBe(0);
  });

  it.each([`ws timeout 10000ms ${URL}`, `ws failed ECONNRESET ${URL}`])("connect failure is transient, no fallback hint: %s", async (msg) => {
    const { value: r, lines, scraper } = await runWsPath(wsInput(), { openError: new Error(msg) });
    expect(r.error).toBe(msg);
    expect(lines.some((l) => l.startsWith("[STS/WS]"))).toBe(false);
    expect(scraper.transportStats()).toEqual({ ws: { framesReceived: 0, bytesReceived: 0 } });
  });

  it("i_pl never arrives", async () => {
    const { value: r, server } = await runWsPath(wsInput(), { ipl: [] });
    expect(r).toMatchObject({ success: false, matches: [], error: `no i_pl snapshot | ws timeout 10000ms ${URL}` });
    expect(server.sent).toHaveLength(2);
    expect(server.closeCalls).toBe(1);
  });

  it("socket closes while snapshots stream", async () => {
    const msg = `ws closed 1006 ${URL}`;
    const { value: r, server } = await runWsPath(wsInput(), { closeOnFixtureRequest: new Error(msg) });
    expect(r).toMatchObject({ success: false, error: msg, matches: [] });
    expect(server.closeCalls).toBe(1);
  });

  it("unknown league: no session", async () => {
    const { value: r, server } = await runWsPath(wsInput(), {}, undefined, "bundesliga");
    expect(r).toMatchObject({ success: false, error: "Unknown league: bundesliga" });
    expect(server.opened).toEqual([]);
  });

  it("caps every collect timeout by the budget", async () => {
    const budget = createScrapeBudget(1500);
    const { server } = await runWsPath(wsInput(), { silentFirst: ["f2921906"] }, budget);
    expect(server.collectTimeouts).toHaveLength(3);
    for (const t of server.collectTimeouts) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(1500);
    }
    expect(server.opened[0].budget).toBe(budget);
  });

  it("an aborted budget opens no session", async () => {
    const { value: r, server } = await runWsPath(wsInput(), {}, createScrapeBudget(60_000, AbortSignal.abort()));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^scrape aborted: /);
    expect(server.opened).toEqual([]);
  });

  it("parses the i_pl snapshot once per run (STS-2)", async () => {
    const parse = vi.mocked(parser.parseWebSocketJson);
    parse.mockClear();
    await runWsPath(wsInput());
    expect(parse.mock.calls.filter(([raw]) => raw.startsWith('{"s":"i_pl"'))).toHaveLength(1);
  });
});
