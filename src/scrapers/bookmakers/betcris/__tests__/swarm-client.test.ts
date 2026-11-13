import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BudgetExceededError, createScrapeBudget } from "../../../shared/budget.js";
import { DEFAULT_USER_AGENT } from "../../../shared/http/http-client.js";
import { openSwarmClient, swarmGameParams, swarmListingParams, SWARM_WHAT } from "../swarm-client.js";
import { findGameInSwarmData } from "../swarm-offer.js";
import { parseAllMarkets, parseSwarmDataForFullOffer, parseTeamNames } from "../parser.js";
import { createFakeSwarm, recordedAnswer, type FakeSwarmRequest } from "./helpers/fake-swarm-session.js";
import { projectSwarmData, recordedGame, recordedListing, RECORDED_GAME_IDS } from "./helpers/swarm-fixtures.js";
import { settle } from "./helpers/fake-swarm-page.js";

const CFG = { siteId: "1874631", socketUrl: "wss://eu-swarm-ws-re.trexname.com/" };
const WS = CFG.socketUrl;
const game = (q: FakeSwarmRequest) => q.params?.where?.game?.id as number | undefined;

describe("betcris swarm-client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("openSwarmClient: opens with origin/user-agent and sends request_session with the site id first", async () => {
    const fake = createFakeSwarm(recordedAnswer());
    const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
    expect(fake.opened[0]).toMatchObject({ url: WS, connectTimeoutMs: 5000 });
    expect(fake.opened[0].headers).toEqual({ origin: "https://www.betcris.pl", "user-agent": DEFAULT_USER_AGENT });
    expect(fake.sent).toEqual([expect.objectContaining({ command: "request_session", params: { language: "pol", site_id: "1874631", source: 42 } })]);
    await client.close(); await client.close();
    expect(fake.closed).toBe(1);
  });

  it("param builders: listing and game requests carry SWARM_WHAT and never subscribe", () => {
    expect(swarmListingParams(538)).toEqual({ source: "betting", what: SWARM_WHAT, subscribe: false, where: { sport: { alias: "Soccer" }, competition: { id: 538 },
      game: { "@or": [{ type: { "@in": [0, 2] } }, { visible_in_prematch: 1 }] }, market: { type: "P1XP2" } } });
    expect(swarmGameParams(31321159)).toEqual({ source: "betting", what: SWARM_WHAT, where: { game: { id: 31321159 } }, subscribe: false });
  });

  it("SWARM_WHAT covers every field parser.ts reads (incl. the ladder split): the projected recorded payloads parse identically", () => {
    const full = findGameInSwarmData(recordedGame(31321159), 31321159)!;
    const proj = findGameInSwarmData(projectSwarmData(recordedGame(31321159), SWARM_WHAT), 31321159)!;
    const parsed = parseAllMarkets(proj, parseTeamNames(proj));
    expect(parsed).toEqual(parseAllMarkets(full, parseTeamNames(full)));
    expect(parsed.length).toBeGreaterThan(600);
    expect(parseSwarmDataForFullOffer(projectSwarmData(recordedListing(), SWARM_WHAT), "premier-league", 538)).toEqual(
      parseSwarmDataForFullOffer(recordedListing(), "premier-league", 538).map((e) => ({ ...e, game: findGameInSwarmData(projectSwarmData(recordedListing(), SWARM_WHAT), e.game.id) })));
  });

  it("matches replies to requests by rid with 4 in flight, answered in reverse order", async () => {
    const ids = RECORDED_GAME_IDS.slice(0, 4);
    const fake = createFakeSwarm(recordedAnswer({ delayMs: (q) => (game(q) ? 100 - 20 * ids.indexOf(game(q)!) : 5) }));
    const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
    const replies = await settle(Promise.all(ids.map((id) => client.request("get", swarmGameParams(id), 10_000))));
    expect(replies.map((r, i) => findGameInSwarmData(r.data!.data!, ids[i])?.id)).toEqual(ids);
    expect(fake.maxInFlight).toBe(4);
  });

  it("a timed-out request rejects alone and its late reply is ignored", async () => {
    const fake = createFakeSwarm(recordedAnswer({ delayMs: (q) => (game(q) === 31333513 ? 15_000 : 5) }));
    const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
    const slow = client.request("get", swarmGameParams(31333513), 10_000);
    const ok = client.request("get", swarmGameParams(31333512), 10_000);
    await expect(settle(ok)).resolves.toMatchObject({ code: 0 });
    await expect(settle(slow)).rejects.toThrow(`ws timeout 10000ms ${WS}`);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.stats.framesReceived).toBe(3); // session, 31333512, and the late 31333513 frame (dropped)
  });

  it("a non-zero Swarm code rejects with command and code", async () => {
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (game(q) ? JSON.stringify({ code: 12, rid: q.rid, msg: "x" }) : undefined) }));
    const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
    await expect(settle(client.request("get", swarmGameParams(31333512), 10_000))).rejects.toThrow(`swarm get code 12 ${WS}`);
  });

  it("a dropped socket rejects every pending request and every later one", async () => {
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (game(q) === 31333514 ? { closeCode: 1006 } : undefined), delayMs: (q) => (game(q) ? 1_000 : 5) }));
    const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
    const pending = [31333512, 31333513, 31333514].map((id) => client.request("get", swarmGameParams(id), 10_000));
    // allSettled attaches a handler to every request before any of them rejects
    const outcomes = await settle(Promise.allSettled(pending));
    expect(outcomes.map((o) => (o.status === "rejected" ? String(o.reason?.message) : "fulfilled"))).toEqual(Array(3).fill(`ws closed 1006 ${WS}`));
    await expect(settle(client.request("get", swarmGameParams(31333515), 10_000))).rejects.toThrow(`ws closed 1006 ${WS}`);
    expect(client.dropped?.message).toBe(`ws closed 1006 ${WS}`);
  });

  it("dropped: null while the session is open and after our own close", async () => {
    const fake = createFakeSwarm(recordedAnswer());
    const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
    await settle(client.request("get", swarmGameParams(31333512), 10_000));
    expect(client.dropped).toBeNull();
    await client.close();
    expect(client.dropped).toBeNull();
  });

  it("openSwarmClient rejects and closes the session when request_session fails", async () => {
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (q.command === "request_session" ? JSON.stringify({ code: 1, rid: q.rid }) : undefined) }));
    await expect(settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open))).rejects.toThrow(`swarm request_session code 1 ${WS}`);
    expect(fake.closed).toBe(1);
  });

  it("a budget abort rejects pending and later requests with BudgetExceededError, without a listener of our own", async () => {
    const parent = new AbortController(); const budget = createScrapeBudget(120_000, parent.signal);
    const fake = createFakeSwarm(recordedAnswer({ override: (q) => (game(q) ? "silent" : undefined) }));
    const client = await settle(openSwarmClient(CFG, budget, fake.open));
    const add = vi.spyOn(budget.signal, "addEventListener");
    const p = client.request("get", swarmGameParams(31333512), 10_000);
    parent.abort(new Error("shutdown"));
    await expect(settle(p)).rejects.toThrow(new BudgetExceededError("scrape aborted: shutdown"));
    await expect(settle(client.request("get", swarmGameParams(31333513), 10_000))).rejects.toThrow("scrape aborted: shutdown");
    expect(add).not.toHaveBeenCalled();
  });
});
