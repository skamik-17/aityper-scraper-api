import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createFakeSwarmPage,
  loadRecording,
  settle,
  type FakeSwarmPage,
  type RecordedSwarmEvent,
} from "./helpers/fake-swarm-page.js";
import { retarget } from "./helpers/swarm-fixtures.js";

const league = loadRecording("league-538-frames.json");
const match = loadRecording("match-31321159-frames.json");
const LEAGUE = "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538";
/** A page that loads but never opens a Swarm socket */
const EMPTY: RecordedSwarmEvent[] = [
  { t: 0, kind: "goto" },
  { t: 700, kind: "domcontentloaded" },
];

describe("betcris scraper flow", () => {
  // A fresh module per test, so no module-level state of the scraper leaks
  // from one test into the next.
  let BetcrisPlaywrightScraper: typeof import("../index.js").BetcrisPlaywrightScraper;

  /** Every browser session of the scraper gets the fake page */
  function useFakeBrowser(fake: FakeSwarmPage): void {
    vi.spyOn(BetcrisPlaywrightScraper.prototype as any, "initBrowser").mockResolvedValue({
      page: fake.page,
      browser: {},
      context: {},
      cleanup: async () => {},
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    ({ BetcrisPlaywrightScraper } = await import("../index.js"));
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Characterization test: passes before and after this task (guards the listing path).
  it("betcris scrapeLeague: returns 20 matches from the recorded listing", async () => {
    const fake = createFakeSwarmPage(() => ({ events: league }));
    useFakeBrowser(fake);
    const r = await settle(new BetcrisPlaywrightScraper().scrapeLeague("premier-league"));
    expect(r.status).toBe("success");
    expect(r.data).toHaveLength(20);
  });

  it("betcris scrapeMatchDetails: browser branch returns game 31321159 from the recorded frames", async () => {
    const url = `${LEAGUE}/31321159`;
    const fake = createFakeSwarmPage(() => ({ events: match }));
    useFakeBrowser(fake);
    const r = await settle(new BetcrisPlaywrightScraper().scrapeMatchDetails(url));
    expect(r.status).toBe("success");
    expect(r.data).toMatchObject({ homeTeam: "Everton", eventUrl: url });
    expect(fake.calls).toContain(`goto:${url}`);
  });

  it("betcris scrapeFullOffer: listing failure is bounded to two attempts and reports the reason", async () => {
    const fake = createFakeSwarmPage(() => ({ events: EMPTY, title: "Betcris" }));
    useFakeBrowser(fake);
    const t0 = Date.now();
    const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
    expect(r.success).toBe(false);
    // `^` prefix, no `$`: observability's recorder may append " | websockets opened: none"
    expect(r.error).toMatch(/^No WebSocket data captured: no_swarm_socket \(attempts=2, navMs=700, wsOpenMs=n\/a, frames=0, sportFrames=0, title="Betcris", finalUrl=https:\/\/www\.betcris\.pl\/zaklady-bukmacherskie\/match\/Soccer\/England\/538, loopLagMaxMs=\d+\)/);
    expect(fake.gotoAt).toHaveLength(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700 + 15000 + 3000 + 700 + 15000);
    expect(Date.now() - t0).toBeLessThanOrEqual(700 + 15000 + 3000 + 700 + 15000 + 200); // settle() steps of 100 ms
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[Betcris] No WebSocket data captured: no_swarm_socket"));
  });

  it("betcris scrapeFullOffer: logs one capture-ok line with the listing timings", async () => {
    const fake = createFakeSwarmPage((url) => (url.endsWith("/538") ? { events: league } : { events: retarget(match, Number(url.split("/").pop())) }));
    useFakeBrowser(fake);
    await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
    const ok = vi.mocked(console.log).mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith("[Betcris] capture ok:"));
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatch(/^\[Betcris\] capture ok: navMs=698, wsOpenMs=766, firstUsefulFrameMs=1908, attempts=1, loopLagMaxMs=\d+, finalUrl=https:\/\/www\.betcris\.pl\//);
  });

  it("betcris scrapeFullOffer: skips failed games with a logged reason and stops after 3 consecutive per-match capture failures", async () => {
    let perMatch = 0;
    const fake = createFakeSwarmPage((url) => {
      if (url.endsWith("/538")) return { events: league };
      const id = Number(url.split("/").pop());
      return ++perMatch <= 2 ? { events: retarget(match, id) } : { events: EMPTY };
    });
    useFakeBrowser(fake);
    const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
    expect(r.success).toBe(true);
    expect(r.matches).toHaveLength(2);
    expect(r.error).toBe("aborted after 3 consecutive per-match capture failures");
    expect(fake.gotoAt).toHaveLength(1 + 2 + 3 * 2);
    expect(vi.mocked(console.warn).mock.calls.filter(([m]) => String(m).startsWith("[Betcris/FullOffer] Skipped game"))).toHaveLength(3);
  });

  it("betcris scrapeFullOffer: game-level misses do not trip the breaker and are not retried", async () => {
    let perMatch = 0;
    const fake = createFakeSwarmPage((url) => {
      if (url.endsWith("/538")) return { events: league };
      const id = Number(url.split("/").pop());
      // First 3 games: the target never appears. The recorded GameList frames (t=2700, 2786) list all 20 ids, so drop
      // every frame that mentions the id; TOP_LEAGUE_COMPACT (t=1771) and SportsbookSportsMenu (t=2781) remain as
      // sport frames, so the failure is target_game_missing, not the site-level no_sport_frames.
      return { events: ++perMatch <= 3 ? retarget(match, 99999999).filter((e) => !e.payload?.includes(String(id))) : retarget(match, id) };
    });
    useFakeBrowser(fake);
    const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
    expect(r.success).toBe(true);
    expect(r.matches).toHaveLength(17);
    expect(r.error).toBeUndefined();
    expect(fake.gotoAt).toHaveLength(1 + 3 + 17); // no retry for target_game_missing
    const warns = vi.mocked(console.warn).mock.calls.map(([m]) => String(m));
    expect(warns.filter((m) => m.startsWith("[Betcris/FullOffer] Skipped game") && m.includes("target_game_missing"))).toHaveLength(3);
    expect(warns.some((m) => m.includes("Aborting per-match loop"))).toBe(false);
  });

  it("betcris scrapeFullOffer: a captured game resets the consecutive-failure count", async () => {
    // Per-game pattern F F S F F S S ...: never 3 site-level failures in a row.
    // The script runs once per goto and a failed game is retried, so key it by game.
    const failing = new Set([1, 2, 4, 5]);
    const gameOrder: number[] = [];
    const fake = createFakeSwarmPage((url) => {
      if (url.endsWith("/538")) return { events: league };
      const id = Number(url.split("/").pop());
      if (!gameOrder.includes(id)) gameOrder.push(id);
      return failing.has(gameOrder.indexOf(id) + 1) ? { events: EMPTY } : { events: retarget(match, id) };
    });
    useFakeBrowser(fake);
    const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
    expect(r.success).toBe(true);
    expect(r.matches).toHaveLength(16);
    expect(r.error).toBeUndefined();
    expect(fake.gotoAt).toHaveLength(1 + 4 * 2 + 16);
    const warns = vi.mocked(console.warn).mock.calls.map(([m]) => String(m));
    expect(warns.filter((m) => m.startsWith("[Betcris/FullOffer] Skipped game") && m.includes("no_swarm_socket"))).toHaveLength(4);
    expect(warns.some((m) => m.includes("Aborting per-match loop"))).toBe(false);
  });

  it("betcris scrapeFullOffer: a game-level miss between site-level failures leaves the count unchanged", async () => {
    // Per-game pattern F F G F: the miss neither counts nor resets, so the 4th game trips the breaker.
    const gameOrder: number[] = [];
    const fake = createFakeSwarmPage((url) => {
      if (url.endsWith("/538")) return { events: league };
      const id = Number(url.split("/").pop());
      if (!gameOrder.includes(id)) gameOrder.push(id);
      const n = gameOrder.indexOf(id) + 1;
      // target_game_missing: drop every frame that mentions the id (see the game-level test above)
      if (n === 3) return { events: retarget(match, 99999999).filter((e) => !e.payload?.includes(String(id))) };
      return n <= 4 ? { events: EMPTY } : { events: retarget(match, id) };
    });
    useFakeBrowser(fake);
    const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
    expect(r.success).toBe(false);
    expect(r.matches).toHaveLength(0);
    expect(r.error).toBe("aborted after 3 consecutive per-match capture failures");
    expect(fake.gotoAt).toHaveLength(1 + 2 * 2 + 1 + 2); // the miss is not retried
    const skipped = vi.mocked(console.warn).mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith("[Betcris/FullOffer] Skipped game"));
    expect(skipped.map((m) => m.match(/captured: (\w+)/)?.[1])).toEqual(["no_swarm_socket", "no_swarm_socket", "target_game_missing", "no_swarm_socket"]);
    expect(console.warn).toHaveBeenCalledWith("[Betcris/FullOffer] Aborting per-match loop: 3 consecutive capture failures");
  });

  const offerPage = () => createFakeSwarmPage((url) => (url.endsWith("/538") ? { events: league } : { events: retarget(match, Number(url.split("/").pop())) }));

  it("betcris scrapeFullOffer: writes no module-level events cache", async () => {
    const { ScraperCache } = await import("../../../../services/cache-manager.js");
    const setMany = vi.spyOn(ScraperCache.prototype, "setMany");
    useFakeBrowser(offerPage());
    await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
    expect(setMany).not.toHaveBeenCalled(); // before: once per captured game (20)
  });

  it("betcris scrapeMatchDetails: navigates even right after scrapeFullOffer captured the game", async () => {
    const fake = offerPage(); useFakeBrowser(fake);
    const s = new BetcrisPlaywrightScraper();
    await settle(s.scrapeFullOffer("premier-league"));
    expect(fake.gotoAt).toHaveLength(1 + 20);
    const r = await settle(s.scrapeMatchDetails(`${LEAGUE}/31321159`));
    expect(r.status).toBe("success");
    expect(fake.gotoAt).toHaveLength(1 + 20 + 1); // before: served from the cache, no navigation
  });

  // The budget module the scraper sees (fresh per test after vi.resetModules), so its
  // BudgetExceededError is recognised by the scraper's budgetAbortReason.
  const createScrapeBudget = async (maxMs: number) => (await import("../../../shared/budget.js")).createScrapeBudget(maxMs);

  // README §8 Q13: listing at 1908 ms, then each game ends on its SGV reply 2654 ms
  // after goto plus the 100 ms pause, so game 2 is done at 7416 ms and game 3 in flight.
  it("betcris scrapeFullOffer: a budget cut returns the games captured so far with the cause", async () => {
    const fake = offerPage(); useFakeBrowser(fake);
    const maxMs = 1908 + 2 * 2754 + 1000;
    const t0 = Date.now();
    const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league", await createScrapeBudget(maxMs)));
    expect(r.success).toBe(true);
    expect(r.matches.map((m) => m.matchId)).toEqual(["31321159", "31333512"]);
    expect(r.error).toBe(`scrape budget of ${maxMs}ms exceeded`);
    expect(Date.now() - t0).toBeLessThanOrEqual(maxMs + 100); // settle() steps of 100 ms
    expect(fake.gotoAt).toHaveLength(1 + 3); // no game starts after the cut
    expect(console.warn).toHaveBeenCalledWith(`[Betcris/FullOffer] Stopping per-match loop: scrape budget of ${maxMs}ms exceeded`);
  });

  it("betcris scrapeFullOffer: a budget cut before any game is captured is a failure with the cause", async () => {
    const fake = offerPage(); useFakeBrowser(fake);
    const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league", await createScrapeBudget(3000)));
    expect(r).toMatchObject({ success: false, matches: [], error: "scrape budget of 3000ms exceeded" });
    expect(fake.gotoAt).toHaveLength(1 + 1);
  });

  it("betcris scrapeFullOffer: a breaker abort with nothing captured is a failure", async () => {
    const fake = createFakeSwarmPage((url) => (url.endsWith("/538") ? { events: league } : { events: EMPTY }));
    useFakeBrowser(fake);
    const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
    expect(r.success).toBe(false);
    expect(r.matches).toHaveLength(0);
    expect(r.error).toBe("aborted after 3 consecutive per-match capture failures");
    expect(fake.gotoAt).toHaveLength(1 + 3 * 2);
    expect(console.warn).toHaveBeenCalledWith("[Betcris/FullOffer] Aborting per-match loop: 3 consecutive capture failures");
  });
});
