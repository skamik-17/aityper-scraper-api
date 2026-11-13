import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  captureSwarm,
  formatCaptureFailure,
  formatCaptureSuccess,
  isSiteLevelCaptureFailure,
} from "../navigation.js";
import type { SwarmCaptureFailure, SwarmData, SwarmGame } from "../types.js";
import {
  createFakeSwarmPage,
  loadRecording,
  settle,
  type RecordedSwarmEvent,
} from "./helpers/fake-swarm-page.js";

const league = loadRecording("league-538-frames.json");
const match = loadRecording("match-31321159-frames.json");
const LEAGUE = "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538";
const BETSPORT = LEAGUE.replace("betcris.pl", "betsport.pl");

function* games(data: SwarmData): Generator<{ competitionId: number; game: SwarmGame }> {
  for (const sport of Object.values(data.sport ?? {})) {
    for (const region of Object.values(sport.region ?? {})) {
      for (const competition of Object.values(region.competition ?? {})) {
        for (const game of Object.values(competition.game ?? {})) {
          yield { competitionId: competition.id, game };
        }
      }
    }
  }
}

/** Games of the competition that carry at least one market */
function countGames(data: SwarmData, competitionId: number): number {
  let count = 0;
  for (const entry of games(data)) {
    if (entry.competitionId === competitionId && Object.keys(entry.game.market ?? {}).length > 0) {
      count++;
    }
  }
  return count;
}

function findGame(data: SwarmData, gameId: number): SwarmGame {
  for (const { game } of games(data)) {
    if (game.id === gameId || game.game_number === gameId) return game;
  }
  throw new Error(`game ${gameId} not in captured data`);
}

describe("betcris captureSwarm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("betcris capture: resolves league mode on the recorded GameList frame", async () => {
    const fake = createFakeSwarmPage(() => ({ events: league }));
    const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
    expect(out.failure).toBeNull();
    expect(out.attempts).toHaveLength(1);
    expect(out.attempts[0].firstUsefulFrameMs).toBe(1908);
    expect(out.attempts[0].wsOpenMs).toBe(766);
    expect(out.attempts[0].finalUrl).toBe(LEAGUE);
    expect(typeof out.attempts[0].eventLoopDelayMaxMs).toBe("number");
    expect(countGames(out.data!, 538)).toBe(20); // local helper: games of competition 538 with >=1 market
    expect(console.log).toHaveBeenCalledWith(`[Betcris/Navigation] Navigating to: ${LEAGUE} (attempt 1/2)`);
  });

  it("betcris capture: survives the betcris.pl→betsport.pl client redirect", async () => {
    const events = [...league.filter((e) => e.t < 105), { t: 105, kind: "redirect", url: BETSPORT } as const, ...league.filter((e) => e.t >= 105)];
    const fake = createFakeSwarmPage(() => ({ events, gotoRejectAtMs: 110,
      gotoRejectMessage: `page.goto: Navigation to "${LEAGUE}" is interrupted by another navigation to "${BETSPORT}"` }));
    const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
    expect(out.failure).toBeNull();
    expect(out.attempts).toHaveLength(1);
    expect(out.attempts[0]).toMatchObject({ navMs: 110, wsOpenMs: 766, firstUsefulFrameMs: 1908, finalUrl: BETSPORT });
    expect(out.attempts[0].navError).toContain("interrupted by another navigation");
  });

  it("betcris capture: attaches the websocket listener before page.goto and detaches it after", async () => {
    const fake = createFakeSwarmPage(() => ({ events: league }));
    await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
    expect(fake.calls[0]).toBe("on:websocket");
    expect(fake.calls[1]).toBe(`goto:${LEAGUE}`);
    expect(fake.calls).toContain("off:websocket");
  });

  it("betcris capture: succeeds when the first useful frame arrives 34 s after goto (12x CPU)", async () => {
    const fake = createFakeSwarmPage(() => ({ events: league, timeScale: 17.9 }));
    const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
    expect(out.failure).toBeNull();
    expect(out.attempts[0].navMs).toBe(12494);            // round(698*17.9)
    expect(out.attempts[0].wsOpenMs).toBe(13711);         // round(766*17.9)
    expect(out.attempts[0].firstUsefulFrameMs).toBe(34153); // round(1908*17.9) - old code gave up at 12000
  });

  it("betcris capture: classifies no_games_with_markets when only TOP_LEAGUE_COMPACT arrived", async () => {
    const fake = createFakeSwarmPage(() => ({ events: league.filter((e) => e.t < 1908) }));
    const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
    expect(out.failure).toBe("no_games_with_markets");
    expect(out.attempts).toHaveLength(2);
    expect(out.attempts[1]).toMatchObject({ framesReceived: 13, sportFrames: 2, firstUsefulFrameMs: null });
  });

  it("betcris capture: classifies competition_missing and no_sport_frames", async () => {
    const noComp = league.filter((e) => !/TOP_LEAGUE|GameList/.test(e.payload?.slice(0, 120) ?? ""));
    const a = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: noComp })).page, LEAGUE, { competitionId: 538 }));
    expect(a.failure).toBe("competition_missing");
    expect(a.attempts[0]).toMatchObject({ framesReceived: 13, sportFrames: 2 });
    const noSport = league.filter((e) => e.kind !== "recv" || !e.payload!.includes('"sport"'));
    const b = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: noSport })).page, LEAGUE, { competitionId: 538 }));
    expect(b.failure).toBe("no_sport_frames");
    expect(b.attempts[0]).toMatchObject({ framesReceived: 11, sportFrames: 0 });
  });

  it("betcris capture: retries once after no_swarm_socket and succeeds on attempt 2", async () => {
    const empty: RecordedSwarmEvent[] = [{ t: 0, kind: "goto" }, { t: 700, kind: "domcontentloaded" }];
    const fake = createFakeSwarmPage((_u, i) => ({ events: i === 0 ? empty : league, title: "Betcris" }));
    const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
    expect(out.failure).toBeNull();
    expect(out.attempts.map((a) => a.failure)).toEqual(["no_swarm_socket", null]);
    expect(out.attempts[0]).toMatchObject({ navMs: 700, wsOpenMs: null, pageTitle: "Betcris" });
    expect(fake.gotoAt[1] - fake.gotoAt[0]).toBe(700 + 15000 + 3000);
  });

  it("betcris capture: navigation_failed when page.goto rejects and no socket follows", async () => {
    const fake = createFakeSwarmPage(() => ({ events: [{ t: 0, kind: "goto" }], gotoRejectAtMs: 30000 }));
    const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
    expect(out.failure).toBe("navigation_failed");
    expect(out.attempts).toHaveLength(2);
    expect(out.attempts[0]).toMatchObject({ navMs: 30000, wsOpenMs: null });
    expect(out.attempts[0].navError).toContain("Timeout 30000ms exceeded");
    expect(fake.gotoAt[1] - fake.gotoAt[0]).toBe(30000 + 15000 + 3000); // waits wsOpenTimeoutMs after the rejection
  });

  it("betcris capture: keeps capturing across a Swarm socket reconnect", async () => {
    const events = [
      ...league.filter((e) => e.t <= 900),
      { t: 900, kind: "close" } as const,
      { t: 1000, kind: "open", wsUrl: "wss://eu-swarm-ws-re.trexname.com/" } as const,
      ...league.filter((e) => e.t > 1000),
    ];
    const out = await settle(captureSwarm(createFakeSwarmPage(() => ({ events })).page, LEAGUE, { competitionId: 538 }));
    expect(out.failure).toBeNull();
    expect(out.attempts[0].wsUrls).toEqual(["wss://eu-swarm-springre.trexname.com/", "wss://eu-swarm-ws-re.trexname.com/"]);
  });

  it("betcris capture: a late page.goto timeout does not discard a completed capture", async () => {
    const fake = createFakeSwarmPage(() => ({ events: league.filter((e) => e.kind !== "domcontentloaded"), gotoRejectAtMs: 30000 }));
    const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
    expect(out.failure).toBeNull();
    expect(out.attempts[0].firstUsefulFrameMs).toBe(1908);
    await vi.advanceTimersByTimeAsync(40000); // the rejection lands after resolve; must not be unhandled
  });

  it("betcris capture: single-event mode resolves on the SINGLE_GAME_VIEW reply, before the plateau", async () => {
    const url = `${LEAGUE}/31321159`;
    const t0 = Date.now(); let at = -1;
    const out = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: match })).page, url, { singleEventMode: true, targetGameNumber: 31321159 })
      .then((o) => ((at = Date.now() - t0), o)));
    expect(out.failure).toBeNull();
    expect(out.attempts[0].firstUsefulFrameMs).toBe(2654);
    expect(at).toBe(2654); // before: the 3 s plateau, >= 5654
    const g = findGame(out.data!, 31321159); // local helper
    expect(Object.keys(g.market ?? {})).toHaveLength(613);
    expect(g.markets_count).toBe(635);
  });

  it("betcris capture: without a SINGLE_GAME_VIEW-tagged reply the plateau still decides", async () => {
    const url = `${LEAGUE}/31321159`;
    const untagged = match.map((e) => (e.kind === "recv" && e.t === 2654 ? { ...e, payload: e.payload!.replace('"rid":"SINGLE_GAME_VIEW', '"rid":"Other') } : e));
    const t0 = Date.now(); let at = -1;
    const out = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: untagged })).page, url, { singleEventMode: true, targetGameNumber: 31321159 })
      .then((o) => ((at = Date.now() - t0), o)));
    expect(out.failure).toBeNull();
    expect(at).toBeGreaterThanOrEqual(2654 + 3000);
    expect(Object.keys(findGame(out.data!, 31321159).market ?? {})).toHaveLength(613);
  });

  it("betcris capture: target_game_missing for an id that never appears, without a retry", async () => {
    const fake = createFakeSwarmPage(() => ({ events: match }));
    const out = await settle(captureSwarm(fake.page, `${LEAGUE}/99999999`, { singleEventMode: true, targetGameNumber: 99999999 }));
    expect(out.failure).toBe("target_game_missing");
    expect(out.attempts).toHaveLength(1);
    expect(fake.gotoAt).toHaveLength(1);
  });

  it("betcris capture: a match page waits 45 s for its first useful frame, the listing 30 s", async () => {
    // Nothing useful ever arrives: the socket opens at 750 (match) / 766 (league),
    // and the attempt fails when its first-useful-frame window runs out.
    let t0 = Date.now();
    const single = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: match })).page, `${LEAGUE}/99999999`,
      { singleEventMode: true, targetGameNumber: 99999999 }));
    const singleMs = Date.now() - t0;
    expect(single.failure).toBe("target_game_missing");
    expect(singleMs).toBeGreaterThanOrEqual(750 + 45000);
    expect(singleMs).toBeLessThanOrEqual(750 + 45000 + 200); // settle() steps of 100 ms

    t0 = Date.now();
    const listing = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: league.filter((e) => e.t < 1908) })).page, LEAGUE,
      { competitionId: 538 }, { maxAttempts: 1 }));
    const listingMs = Date.now() - t0;
    expect(listing.failure).toBe("no_games_with_markets");
    expect(listingMs).toBeGreaterThanOrEqual(766 + 30000);
    expect(listingMs).toBeLessThanOrEqual(766 + 30000 + 200);
  });

  it("betcris capture: a cleanup step that throws still resolves the attempt, classified", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const empty: RecordedSwarmEvent[] = [{ t: 0, kind: "goto" }, { t: 700, kind: "domcontentloaded" }];
    const failing = createFakeSwarmPage(() => ({ events: empty }));
    const ok = createFakeSwarmPage(() => ({ events: league }));
    for (const fake of [failing, ok]) {
      // e.g. a page wrapper whose listener bookkeeping throws on detach
      (fake.page as unknown as { off: () => never }).off = () => {
        throw new Error("page wrapper detached");
      };
    }

    const a = await settle(captureSwarm(failing.page, LEAGUE, { competitionId: 538 }, { maxAttempts: 1 }), 100, 60_000);
    expect(a.failure).toBe("no_swarm_socket");
    expect(a.attempts).toHaveLength(1);
    expect(a.attempts[0]).toMatchObject({ failure: "no_swarm_socket", navMs: 700, wsOpenMs: null });

    const b = await settle(captureSwarm(ok.page, LEAGUE, { competitionId: 538 }), 100, 60_000);
    expect(b.failure).toBeNull();
    expect(countGames(b.data!, 538)).toBe(20);
    expect(typeof b.attempts[0].eventLoopDelayMaxMs).toBe("number");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("[Betcris/Navigation] capture cleanup failed: page wrapper detached");
  });

  it("betcris capture: a deadline that fires late after a loop stall waits for frames queued meanwhile", async () => {
    // The GameList frames land 500 ms after the first-useful deadline is due
    // (socket at 766, deadline at 30766). Fake timers cannot queue socket I/O
    // behind an expired timer, so the stall is a 2 s clock jump at 30000: every
    // pending timer then fires 2 s late, as after a blocked main thread.
    const events = [
      ...league.filter((e) => e.t < 1908),
      ...league.filter((e) => e.t >= 1908).map((e) => ({ ...e, t: e.t - 1908 + 31266 })),
    ];
    const timing = { maxAttempts: 1 };

    const onTime = await settle(captureSwarm(createFakeSwarmPage(() => ({ events })).page, LEAGUE, { competitionId: 538 }, timing));
    expect(onTime.failure).toBe("no_games_with_markets"); // on time: no grace, exact timing
    expect(onTime.attempts[0].deadlineLateMs).toBeNull();

    const pending = captureSwarm(createFakeSwarmPage(() => ({ events })).page, LEAGUE, { competitionId: 538 }, timing);
    setTimeout(() => vi.setSystemTime(Date.now() + 2000), 30000);
    const late = await settle(pending);
    expect(late.failure).toBeNull();
    expect(late.attempts[0]).toMatchObject({ deadlineLateMs: 2000, firstUsefulFrameMs: 33266 });
    expect(console.log).toHaveBeenCalledWith(
      "[Betcris/Navigation] first-useful-frame deadline fired 2000 ms late (event loop stalled); deciding in 1000 ms"
    );
  });

  it("betcris capture: eventLoopDelayMaxMs counts a stall right after the attempt starts and right before it ends", async () => {
    // Blocks the main thread like a long synchronous callback, whatever the clocks say.
    const stall = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

    // Before the histogram's first tick: page.goto runs right after it is enabled.
    const head = createFakeSwarmPage(() => ({ events: league }));
    const headPage = head.page as unknown as { goto: (...args: unknown[]) => Promise<unknown> };
    const goto = headPage.goto.bind(headPage);
    headPage.goto = (...args) => {
      stall(200);
      return goto(...args);
    };
    const a = await settle(captureSwarm(head.page, LEAGUE, { competitionId: 538 }));

    // Inside the frame that completes the capture, just before finish() reads the lag.
    const tail = createFakeSwarmPage(() => ({ events: league }));
    let stalled = false;
    tail.page.on("websocket", (ws) =>
      ws.on("framereceived", (frame) => {
        if (!stalled && frame.payload.toString().includes("GameListSubscribeCmd")) {
          stalled = true;
          stall(200);
        }
      })
    );
    const b = await settle(captureSwarm(tail.page, LEAGUE, { competitionId: 538 }));

    expect(a.failure).toBeNull();
    expect(b.failure).toBeNull();
    expect(stalled).toBe(true);
    expect(a.attempts[0].eventLoopDelayMaxMs).toBeGreaterThanOrEqual(190);
    expect(b.attempts[0].eventLoopDelayMaxMs).toBeGreaterThanOrEqual(190);
  });

  const attempt = { attempt: 2, navMs: 700, navError: null, wsUrls: [], wsOpenMs: null, framesReceived: 0, nonJsonFrames: 0, sportFrames: 0,
    firstUsefulFrameMs: null, failure: "no_swarm_socket" as const, pageTitle: "Betcris", finalUrl: BETSPORT, eventLoopDelayMaxMs: 840 };

  it("betcris capture: formatCaptureFailure renders reason and last-attempt diagnostics", () => {
    expect(formatCaptureFailure({ data: null, failure: "no_swarm_socket", attempts: [{ ...attempt, attempt: 1 }, attempt] }))
      .toBe(`No WebSocket data captured: no_swarm_socket (attempts=2, navMs=700, wsOpenMs=n/a, frames=0, sportFrames=0, title="Betcris", finalUrl=${BETSPORT}, loopLagMaxMs=840)`);
  });

  it("betcris capture: formatCaptureSuccess renders the timings A2 records", () => {
    const ok = { ...attempt, attempt: 1, navMs: 688, wsOpenMs: 788, framesReceived: 13, sportFrames: 3, firstUsefulFrameMs: 1908, failure: null, pageTitle: null, eventLoopDelayMaxMs: 21 };
    expect(formatCaptureSuccess({ data: {}, failure: null, attempts: [ok] }))
      .toBe(`capture ok: navMs=688, wsOpenMs=788, firstUsefulFrameMs=1908, attempts=1, loopLagMaxMs=21, finalUrl=${BETSPORT}`);
    expect(["navigation_failed", "no_swarm_socket", "no_sport_frames"].every((f) => isSiteLevelCaptureFailure(f as SwarmCaptureFailure))).toBe(true);
    expect(["competition_missing", "no_games_with_markets", "target_game_missing", null].some((f) => isSiteLevelCaptureFailure(f as SwarmCaptureFailure | null))).toBe(false);
  });
});
