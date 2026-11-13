import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { createScrapeBudget } from "../../../shared/budget.js";
import { hasTransportStats } from "../../../shared/scraper-contract.js";
import { BetcrisSwarmScraper } from "../swarm-scraper.js";
import { swarmListingParams, SWARM_WHAT } from "../swarm-client.js";
import { findGameInSwarmData } from "../swarm-offer.js";
import { parseAllMarkets, parseSwarmDataForFullOffer } from "../parser.js";
import type { SwarmGame } from "../types.js";
import { createFakeSwarm, recordedAnswer, type FakeSwarm, type FakeSwarmRequest } from "./helpers/fake-swarm-session.js";
import { loadFixtureText, projectSwarmData, recordedGame, recordedListing, RECORDED_GAME_IDS } from "./helpers/swarm-fixtures.js";
import { settle } from "./helpers/fake-swarm-page.js";

const PAGE = "https://www.betcris.pl/";
const WS = "wss://eu-swarm-ws-re.trexname.com/";
const http = () => createReplayHttpClient({ [PAGE]: { body: loadFixtureText("swarm/partner-configs.html"), contentType: "text/html; charset=utf-8" } });
const isGame = (q: FakeSwarmRequest) => q.command === "get" && q.params?.where?.game?.id !== undefined;
const scraper = (fake: FakeSwarm, h = http()) => new BetcrisSwarmScraper({ http: h, openSession: fake.open });
const perGame = parseAllMarkets(findGameInSwarmData(projectSwarmData(recordedGame(31321159), SWARM_WHAT), 31321159)!,
  parseSwarmDataForFullOffer(recordedListing(), "premier-league", 538)[0].teams).length;
const warns = () => vi.mocked(console.warn).mock.calls.map(([m]) => String(m));
const errors = () => vi.mocked(console.error).mock.calls.map(([m]) => String(m));

describe("BetcrisSwarmScraper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("betcris swarm: scrapes the 20 recorded games over one socket with 4 game requests in flight", async () => {
    const fake = createFakeSwarm(recordedAnswer()); const h = http(); const s = scraper(fake, h);
    const r = await settle(s.scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: true, bookmaker: "betcris", league: "premier-league" }); expect(r.error).toBeUndefined();
    expect(s.transport).toBe("websocket");
    expect(r.matches.map((m) => m.matchId)).toEqual(RECORDED_GAME_IDS.map(String));
    expect(r.matches.map((m) => m.markets.length)).toEqual(Array(20).fill(perGame));
    expect(fake.sent.map((q) => q.command)).toEqual(["request_session", ...Array(21).fill("get")]);
    expect(fake.sent[1].params).toEqual(swarmListingParams(538));
    expect(fake.sent.filter(isGame).map((q) => q.params.where.game.id).sort()).toEqual([...RECORDED_GAME_IDS].sort());
    expect(fake.maxInFlight).toBe(4); expect(fake.closed).toBe(1); expect(fake.opened[0].url).toBe(WS);
    const logs = vi.mocked(console.log).mock.calls.map(([m]) => String(m));
    expect(logs).toContain("[Betcris/FullOffer] Found 20 games for premier-league");
    expect(logs.some((m) => /^\[Betcris\/FullOffer\] Everton vs Coventry\s+City: \d+ markets$/.test(m))).toBe(true);
    expect(logs.filter((m) => m.startsWith("[Betcris] capture ok:"))).toEqual([expect.stringMatching(
      /^\[Betcris\] capture ok: transport=swarm, games=20, fetched=20, skipped=0, connectMs=\d+, listingMs=\d+, totalMs=\d+, frames=22, bytes=\d+, config=page$/)]);
    expect(hasTransportStats(s)).toBe(true);
    expect(s.transportStats()).toEqual({ http: expect.objectContaining({ requests: 1, failures: 0 }), ws: { framesReceived: 22, bytesReceived: expect.any(Number) } });
    await settle(s.scrapeFullOffer("premier-league")); // second run: cached partnerConfigs, fresh socket, cumulative counters
    expect(h.calls).toEqual([PAGE]); expect(fake.opened).toHaveLength(2); expect(fake.closed).toBe(2);
    expect(s.transportStats().ws!.framesReceived).toBe(44);
  });

  it("betcris swarm: skips a game whose request times out, writes nothing for it and keeps the cause", async () => {
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (isGame(q) && q.params.where.game.id === 31333513 ? "silent" : undefined) }));
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: true, error: `1 of 20 details failed | ws timeout 10000ms ${WS}` });
    expect(r.matches).toHaveLength(19); expect(r.matches.map((m) => m.matchId)).not.toContain("31333513");
    expect(warns()).toContain(`[Betcris/FullOffer] Skipped game 31333513 (Leeds vs Tottenham): ws timeout 10000ms ${WS}`);
    expect(warns()).toContain(`[betcris] 1 of 20 details failed | ws timeout 10000ms ${WS}`);
  });

  it("betcris swarm: skips a game missing from its reply instead of writing its listing copy", async () => {
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (isGame(q) && q.params.where.game.id === 31333513 ? JSON.stringify({ code: 0, rid: q.rid, data: { data: {} } }) : undefined) }));
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(r.matches).toHaveLength(19);
    expect(warns()).toContain("[Betcris/FullOffer] Skipped game 31333513 (Leeds vs Tottenham): swarm game 31333513 missing from reply");
  });

  /** The projected recorded reply to `q` (a game or the listing) with game `id` passed through `edit` */
  const editedReply = (q: FakeSwarmRequest, id: number, edit: (g: SwarmGame) => void) => {
    const data = projectSwarmData(q.params.where.competition ? recordedListing() : recordedGame(id), q.params.what);
    edit(findGameInSwarmData(data, id)!);
    return JSON.stringify({ code: 0, rid: q.rid, data: { data } });
  };
  const only1x2 = (g: SwarmGame) => {
    g.market = Object.fromEntries(Object.entries(g.market!).filter(([, m]) => m.type === "P1XP2"));
  };

  it.each([
    ["no markets", (g: SwarmGame) => { g.market = {}; }, "0"],
    ["only its listing 1X2", only1x2, "1"],
  ])("betcris swarm: skips a game whose reply holds it with %s instead of writing its listing copy", async (_label, edit, n) => {
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (isGame(q) && q.params.where.game.id === 31333513 ? editedReply(q, 31333513, edit) : undefined) }));
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    const cause = `swarm game 31333513 detail has ${n} markets, no more than its listing copy (1); 635 reported`;
    expect(r).toMatchObject({ success: true, error: `1 of 20 details failed | ${cause}` });
    expect(r.matches).toHaveLength(19); expect(r.matches.map((m) => m.matchId)).not.toContain("31333513");
    expect(warns()).toContain(`[Betcris/FullOffer] Skipped game 31333513 (Leeds vs Tottenham): ${cause}`);
  });

  it("betcris swarm: 11 of 20 thin replies fail the league", async () => {
    const thin = new Set(RECORDED_GAME_IDS.slice(0, 11));
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (isGame(q) && thin.has(q.params.where.game.id) ? editedReply(q, q.params.where.game.id, (g) => { g.market = {}; }) : undefined) }));
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: false, matches: [], error: expect.stringMatching(/^11 of 20 details failed \| swarm game \d+ detail has 0 markets/) });
  });

  it("betcris swarm: writes a game that reports no more markets than its 1X2", async () => {
    const thinGame = (g: SwarmGame) => { only1x2(g); g.markets_count = 1; };
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => {
      if (q.params?.where?.competition) return editedReply(q, 31333513, (g) => { g.markets_count = 1; });
      return isGame(q) && q.params.where.game.id === 31333513 ? editedReply(q, 31333513, thinGame) : undefined;
    } }));
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: true }); expect(r.error).toBeUndefined();
    expect(r.matches.find((m) => m.matchId === "31333513")!.markets.map((m) => m.bookmakerMarketId)).toEqual(["P1XP2"]);
  });

  it.each([[10, true, 10], [11, false, 0]])("betcris swarm: %i of 20 silent games → success %s", async (n, ok, kept) => {
    const silent = new Set(RECORDED_GAME_IDS.slice(0, n));
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (isGame(q) && silent.has(q.params.where.game.id) ? "silent" : undefined) }));
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: ok, error: `${n} of 20 details failed | ws timeout 10000ms ${WS}` });
    expect(r.matches).toHaveLength(kept);
  });

  /** A fake whose first session drops (1006) when game `RECORDED_GAME_IDS[at]` is requested; `session` holds each game request's session */
  const droppingFake = (at: number, sessionsThatDrop = 1) => {
    const session = new Map<number, number[]>();
    const fake: FakeSwarm = createFakeSwarm(recordedAnswer({ override: (q) => {
      if (!isGame(q)) return undefined;
      const n = fake.opened.length;
      session.set(n, [...(session.get(n) ?? []), q.params.where.game.id]);
      return n <= sessionsThatDrop && q.params.where.game.id === RECORDED_GAME_IDS[at] ? { closeCode: 1006 } : undefined;
    } }));
    return { fake, session };
  };

  it("betcris swarm: a mid-stream drop reopens the session once and re-requests only the failed games", async () => {
    const { fake, session } = droppingFake(12);
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: true }); expect(r.error).toBeUndefined();
    expect(r.matches.map((m) => m.matchId)).toEqual(RECORDED_GAME_IDS.map(String)); // listing order
    expect(r.matches.map((m) => m.markets.length)).toEqual(Array(20).fill(perGame));
    expect(fake.opened).toHaveLength(2); expect(fake.closed).toBe(2);
    // Games 1-12 were answered before the drop; only the 13th and later are asked again
    expect([...session.get(2)!].sort()).toEqual([...RECORDED_GAME_IDS.slice(12)].sort());
    expect(warns()).toContain(`[Betcris/Swarm] session dropped (ws closed 1006 ${WS}); reopening once for 8 failed games`);
  });

  it("betcris swarm: no reopen when the budget left is below a fresh session and one game", async () => {
    const { fake } = droppingFake(12);
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league", createScrapeBudget(15_000)));
    expect(r).toMatchObject({ success: true, error: `8 of 20 details failed | ws closed 1006 ${WS}` });
    expect(r.matches).toHaveLength(12); expect(fake.opened).toHaveLength(1);
  });

  it("betcris swarm: the reopened session dropping too ends the scrape with what both sessions got", async () => {
    const { fake, session } = droppingFake(12, 2);
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(fake.opened).toHaveLength(2); expect(fake.closed).toBe(2);
    expect(session.get(2)![0]).toBe(RECORDED_GAME_IDS[12]); // the trigger is asked first again and drops session 2
    expect(r).toMatchObject({ success: true, error: `8 of 20 details failed | ws closed 1006 ${WS}` });
    expect(r.matches.map((m) => m.matchId)).toEqual(RECORDED_GAME_IDS.slice(0, 12).map(String));
  });

  it("betcris swarm: fails with the close cause when the socket drops before the listing reply", async () => {
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (q.params?.where?.competition ? { closeCode: 1006 } : undefined) }));
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: false, matches: [], error: `ws closed 1006 ${WS}` });
    expect(fake.sent.filter(isGame)).toHaveLength(0); expect(fake.closed).toBe(1);
    expect(errors()).toContain(`[betcris] Full offer scraper error: ws closed 1006 ${WS}`);
  });

  /** A fake whose listing reply is `bad(q)` in the first `badSessions` sessions */
  const badListingFake = (bad: (q: FakeSwarmRequest) => string, badSessions = 1) => {
    const fake: FakeSwarm = createFakeSwarm(recordedAnswer({ override: (q) =>
      (q.params?.where?.competition && fake.opened.length <= badSessions ? bad(q) : undefined) }));
    return fake;
  };
  const emptyListing = (q: FakeSwarmRequest) => JSON.stringify({ code: 0, rid: q.rid, data: { data: {} } });
  const codeListing = (q: FakeSwarmRequest) => JSON.stringify({ code: 12, rid: q.rid, msg: "Invalid site" });

  it.each([
    ["0 games", emptyListing, "0 games"],
    ["a non-zero Swarm code", codeListing, `swarm get code 12 ${WS}`],
  ])("betcris swarm: a listing with %s re-reads partnerConfigs and retries once", async (_label, bad, cause) => {
    const fake = badListingFake(bad); const h = http();
    const r = await settle(scraper(fake, h).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: true }); expect(r.error).toBeUndefined();
    expect(r.matches).toHaveLength(20);
    expect(h.calls).toEqual([PAGE, PAGE]); expect(fake.opened).toHaveLength(2); expect(fake.closed).toBe(2);
    expect(warns()).toContain(`[Betcris/Swarm] listing gave ${cause}; re-reading partnerConfigs and retrying once`);
  });

  it("betcris swarm: 0 games again after the retry is an empty success, no third try", async () => {
    const fake = badListingFake(emptyListing, 2); const h = http();
    const r = await settle(scraper(fake, h).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: true, matches: [] });
    expect(h.calls).toEqual([PAGE, PAGE]); expect(fake.opened).toHaveLength(2);
  });

  it("betcris swarm: a listing code again after the retry fails with the code", async () => {
    const fake = badListingFake(codeListing, 2); const h = http();
    const r = await settle(scraper(fake, h).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: false, matches: [], error: `swarm get code 12 ${WS}` });
    expect(h.calls).toEqual([PAGE, PAGE]); expect(fake.opened).toHaveLength(2); expect(fake.closed).toBe(2);
  });

  it("betcris swarm: a listing timeout is not a config problem and is not retried", async () => {
    const fake = badListingFake(() => "silent" as any); const h = http();
    const r = await settle(scraper(fake, h).scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: false, error: `ws timeout 10000ms ${WS}` });
    expect(h.calls).toEqual([PAGE]); expect(fake.opened).toHaveLength(1);
  });

  it("betcris swarm: handshake fails twice → handshake cause, config re-read between attempts", async () => {
    const err = () => new Error(`ws handshake HTTP 403 ${WS}`);
    const fake = createFakeSwarm(recordedAnswer(), { openErrors: [err(), err()] }); const h = http(); const s = scraper(fake, h);
    const r = await settle(s.scrapeFullOffer("premier-league"));
    expect(r).toMatchObject({ success: false, matches: [], error: `ws handshake HTTP 403 ${WS}` });
    expect(fake.opened).toHaveLength(2); expect(h.calls).toEqual([PAGE, PAGE]);
    expect(s.transportStats().ws).toEqual({ framesReceived: 0, bytesReceived: 0 });
  });

  it("betcris swarm: recovers on the second open attempt", async () => {
    const fake = createFakeSwarm(recordedAnswer(), { openErrors: [new Error(`ws failed ECONNREFUSED ${WS}`)] });
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
    expect(r.success).toBe(true); expect(r.matches).toHaveLength(20); expect(fake.opened).toHaveLength(2);
  });

  it("betcris swarm: unknown league → error without network", async () => {
    const fake = createFakeSwarm(recordedAnswer()); const h = http();
    expect(await scraper(fake, h).scrapeFullOffer("bundesliga")).toMatchObject({ success: false, matches: [], error: "Unknown league: bundesliga" });
    expect(h.calls).toHaveLength(0); expect(fake.opened).toHaveLength(0);
  });

  it("betcris swarm: an aborted budget stops new game requests and closes the socket", async () => {
    const parent = new AbortController();
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => { if (!isGame(q)) return undefined; parent.abort(new Error("shutdown")); return "silent"; } }));
    const r = await settle(scraper(fake).scrapeFullOffer("premier-league", createScrapeBudget(120_000, parent.signal)));
    expect(r).toMatchObject({ success: false, matches: [], error: "20 of 20 details failed | scrape aborted: shutdown" });
    expect(fake.sent.filter(isGame).length).toBeLessThanOrEqual(4); expect(fake.closed).toBe(1);
    expect(fake.opened).toHaveLength(1); // a budget abort is never reopened
  });
});
