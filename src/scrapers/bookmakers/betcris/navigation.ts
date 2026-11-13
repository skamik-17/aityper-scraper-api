/**
 * Betcris Navigation Module
 *
 * Handles all Playwright interactions for the Betcris scraper.
 * Responsible for:
 * - Navigating to pages to trigger WebSocket connections
 * - Capturing Swarm WebSocket data frames
 * - Extracting game IDs from URLs
 *
 * NOTE: Betcris uses a Swarm WebSocket API for real-time data.
 * We intercept WebSocket frames to capture betting data.
 */

// The real clock and timers. In production they are the same as the globals.
// Fake timers replace only the globals, so under them these stay real: the
// deadline yield is a real I/O turn that costs no fake time (a faked zero-delay
// timer created inside a fired timer is due 1 ms later), and the loop-gap
// sampler measures real stalls without adding fake timers.
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
  clearInterval as clearRealInterval,
  setImmediate,
  setInterval as setRealInterval,
} from "node:timers";
import type { Page, WebSocket as PlaywrightWebSocket } from "playwright";
import {
  BASE_URL,
  COMPETITION_IDS,
  REQUEST_TIMEOUT,
  WS_CONFIG,
} from "./constants.js";
import type {
  SwarmData,
  CaptureConfig,
  SwarmCaptureAttempt,
  SwarmCaptureFailure,
  SwarmCaptureOutcome,
  SwarmCaptureTiming,
} from "./types.js";

/** Failures where the page or its socket never delivered sport data. */
const SITE_LEVEL_CAPTURE_FAILURES: ReadonlySet<SwarmCaptureFailure> = new Set<SwarmCaptureFailure>([
  "navigation_failed",
  "no_swarm_socket",
  "no_sport_frames",
]);

/**
 * Upper bound for the diagnostic page.title() read on failure: Playwright's
 * title() has no timeout of its own, and a stalled renderer must not hang the
 * capture.
 */
const PAGE_TITLE_TIMEOUT_MS = 2000;

/** A deadline that fires more than this after its due time means the event loop stalled (ms). */
const STALL_LATE_MS = 100;

/**
 * How long a deadline that fired late (STALL_LATE_MS) waits, once, before it
 * decides (ms). After a stall, frames that already reached Node need several
 * loop turns before the page/socket listeners see them.
 */
const STALL_GRACE_MS = 1000;

/** Resolution of the event-loop-delay histogram and period of the loop-gap sampler (ms). */
const LOOP_SAMPLE_MS = 20;

type Timer = ReturnType<typeof setTimeout>;

interface CaptureAttemptResult {
  attempt: SwarmCaptureAttempt;
  data: SwarmData | null;
}

/**
 * Navigate to `url` and capture its Swarm WebSocket data, with deadlines
 * anchored at navigation/socket milestones, classified failures and a retry.
 *
 * Each attempt attaches the `websocket` listener, then starts `page.goto`
 * without awaiting it, and unions every Swarm sport frame. BetConstruct/Swarm
 * streams a game's offer across several frames (an initial snapshot plus
 * per-market-group subscription responses), so one frame only ever holds a
 * subset of the markets: frames are unioned, keyed by market id, and the
 * target game's self-reported `markets_count` is the completeness target.
 * Completion:
 * - league: the target competition has at least one game with markets;
 * - single-event: the target game's markets_count is reached, or no growth for
 *   PLATEAU_WAIT_TIME, or MAX_WAIT_TIME_SINGLE_EVENT after the target first
 *   appeared.
 * Deadlines:
 * - goto settled (resolved or rejected) and no Swarm socket within
 *   wsOpenTimeoutMs -> navigation_failed (goto rejected) / no_swarm_socket;
 * - first socket opened and no useful frame within firstUsefulFrameTimeoutMs
 *   (FIRST_USEFUL_FRAME_TIMEOUT for the listing,
 *   FIRST_USEFUL_FRAME_TIMEOUT_SINGLE_EVENT for a match page) ->
 *   no_sport_frames / competition_missing / no_games_with_markets /
 *   target_game_missing.
 * A deadline (or the single-event max wait) that fires more than STALL_LATE_MS
 * late, because the event loop stalled, decides only after STALL_GRACE_MS, so
 * frames queued during the stall are seen first.
 * A goto rejection alone is not fatal: the betcris.pl -> betsport.pl client
 * redirect supersedes the first document while the second one still opens the
 * socket.
 *
 * Every failure except target_game_missing (game gone or live) is retried, up
 * to maxAttempts, with fresh state and retryBackoffMs in between.
 */
export async function captureSwarm(
  page: Page,
  url: string,
  config: CaptureConfig,
  timing: Partial<SwarmCaptureTiming> = {}
): Promise<SwarmCaptureOutcome> {
  const resolved: SwarmCaptureTiming = {
    wsOpenTimeoutMs: timing.wsOpenTimeoutMs ?? WS_CONFIG.WS_OPEN_TIMEOUT,
    firstUsefulFrameTimeoutMs:
      timing.firstUsefulFrameTimeoutMs ??
      (config.singleEventMode
        ? WS_CONFIG.FIRST_USEFUL_FRAME_TIMEOUT_SINGLE_EVENT
        : WS_CONFIG.FIRST_USEFUL_FRAME_TIMEOUT),
    maxAttempts: Math.max(1, timing.maxAttempts ?? WS_CONFIG.MAX_ATTEMPTS),
    retryBackoffMs: timing.retryBackoffMs ?? WS_CONFIG.RETRY_BACKOFF,
  };
  const attempts: SwarmCaptureAttempt[] = [];

  for (let n = 1; ; n++) {
    const { attempt, data } = await runCaptureAttempt(page, url, config, resolved, n);
    attempts.push(attempt);

    if (attempt.failure === null) {
      return { data, failure: null, attempts };
    }
    if (attempt.failure === "target_game_missing" || n >= resolved.maxAttempts) {
      return { data: null, failure: attempt.failure, attempts };
    }

    console.log(
      `[Betcris/Navigation] Capture attempt ${n}/${resolved.maxAttempts} failed: ${attempt.failure}; retrying in ${resolved.retryBackoffMs} ms`
    );
    await new Promise<void>((resolve) => setTimeout(resolve, resolved.retryBackoffMs));
  }
}

/**
 * One capture attempt. Never rejects: every outcome is recorded in the attempt.
 */
function runCaptureAttempt(
  page: Page,
  url: string,
  config: CaptureConfig,
  timing: SwarmCaptureTiming,
  attemptNo: number
): Promise<CaptureAttemptResult> {
  const { competitionId, singleEventMode = false, targetGameNumber } = config;
  const label = singleEventMode ? "Navigating to match" : "Navigating to";
  console.log(
    `[Betcris/Navigation] ${label}: ${url} (attempt ${attemptNo}/${timing.maxAttempts})`
  );

  // Node main-thread lag over the attempt. The histogram has two blind spots:
  // it records nothing until its first tick (~LOOP_SAMPLE_MS after enable), and
  // it records a stall since its last tick only at its next tick, which
  // finish() does not wait for. The own gap sampler starts counting at enable,
  // and finish() takes one last sample, so a stall at the start of the attempt
  // or right before it ends is counted too.
  const loopDelay = monitorEventLoopDelay({ resolution: LOOP_SAMPLE_MS });
  loopDelay.enable();
  let loopTickAt = performance.now();
  let loopGapMaxMs = 0;
  const sampleLoopGap = () => {
    const now = performance.now();
    loopGapMaxMs = Math.max(loopGapMaxMs, now - loopTickAt);
    loopTickAt = now;
  };
  const loopSampler = setRealInterval(sampleLoopGap, LOOP_SAMPLE_MS);
  loopSampler.unref();

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const attempt: SwarmCaptureAttempt = {
    attempt: attemptNo,
    navMs: null,
    navError: null,
    wsUrls: [],
    wsOpenMs: null,
    framesReceived: 0,
    nonJsonFrames: 0,
    sportFrames: 0,
    firstUsefulFrameMs: null,
    failure: null,
    pageTitle: null,
    finalUrl: null,
    eventLoopDelayMaxMs: null,
    deadlineLateMs: null,
  };

  // Scope what is unioned to bound memory, because the page (and its socket) is
  // reused across many matches: keep only the target game (single-event) or the
  // target competition (league).
  const mergeFilter: MergeFilter = {
    competitionId: singleEventMode ? undefined : competitionId,
    targetGameNumber: singleEventMode ? targetGameNumber : undefined,
  };
  const merged: SwarmData = {};
  let bestMarketCount = 0;
  let lastGrowthAt = startedAt;
  let done = false;

  let wsOpenTimer: Timer | undefined;
  let firstUsefulTimer: Timer | undefined;
  let maxWaitTimer: Timer | undefined;
  let plateauPoll: ReturnType<typeof setInterval> | undefined;
  const graceTimers: Timer[] = [];
  const socketCleanups: Array<() => void> = [];

  return new Promise<CaptureAttemptResult>((resolve) => {
    const finish = async (failure: SwarmCaptureFailure | null): Promise<void> => {
      if (done) return;
      done = true;
      attempt.failure = failure;
      // Callers do `void finish(...)`: a throwing cleanup step (a page wrapper,
      // a socket) must neither leave the attempt unresolved nor become an
      // unhandled rejection. Own timers and the loop monitor are released
      // first, so a throw from the page or a socket cannot leak them.
      try {
        sampleLoopGap(); // the tail since the sampler's last tick
        clearRealInterval(loopSampler);
        clearTimeout(wsOpenTimer);
        clearTimeout(firstUsefulTimer);
        clearTimeout(maxWaitTimer);
        for (const timer of graceTimers) clearTimeout(timer);
        clearInterval(plateauPoll);
        attempt.eventLoopDelayMaxMs = Math.round(Math.max(loopDelay.max / 1e6, loopGapMaxMs));
        loopDelay.disable();

        try {
          attempt.finalUrl = page.url();
        } catch {
          attempt.finalUrl = null;
        }
        page.off("websocket", onWebSocket);
        for (const cleanup of socketCleanups) cleanup();
        if (failure) {
          attempt.pageTitle = await readPageTitle(page);
        }
      } catch (error) {
        console.warn(
          `[Betcris/Navigation] capture cleanup failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        resolve({ attempt, data: failure ? null : merged });
      }
    };

    // Decide after one setImmediate turn, and only if the attempt is still open:
    // a frame that completes the capture during the turn finishes it, so `done`
    // is the completion re-check.
    const afterQueuedIo = (decide: () => void) => {
      setImmediate(() => {
        if (!done) decide();
      });
    };

    // A deadline timer. On time, it decides after one setImmediate turn, which
    // keeps its timing exact. That turn is not enough after a stall: Node runs
    // expired timers before it polls for socket I/O, and a frame that reached
    // Node's CDP pipe while the main thread was blocked needs two more
    // setImmediate hops (Playwright's pipe transport, then its in-process
    // connection) before `framereceived` fires. So a deadline that fires more
    // than STALL_LATE_MS late decides only after STALL_GRACE_MS, once. Under
    // fake timers a deadline is never late unless a test moves the clock.
    const armDeadline = (name: string, delayMs: number, decide: () => void): Timer => {
      const dueAt = Date.now() + delayMs;
      return setTimeout(() => {
        const lateMs = Date.now() - dueAt;
        if (lateMs <= STALL_LATE_MS) {
          afterQueuedIo(decide);
          return;
        }
        attempt.deadlineLateMs = Math.max(attempt.deadlineLateMs ?? 0, lateMs);
        console.log(
          `[Betcris/Navigation] ${name} deadline fired ${lateMs} ms late (event loop stalled); deciding in ${STALL_GRACE_MS} ms`
        );
        graceTimers.push(setTimeout(() => afterQueuedIo(decide), STALL_GRACE_MS));
      }, delayMs);
    };

    const decideWsOpen = () => {
      // A socket opened in the meantime: its own deadline is already armed.
      if (attempt.wsOpenMs !== null) return;
      void finish(attempt.navError !== null ? "navigation_failed" : "no_swarm_socket");
    };

    const decideFirstUseful = () => {
      // Single-event: the target appeared, its completion timers are running.
      if (attempt.firstUsefulFrameMs !== null) return;
      void finish(classifyMissingData());
    };

    const classifyMissingData = (): SwarmCaptureFailure => {
      if (attempt.sportFrames === 0) return "no_sport_frames";
      if (singleEventMode) return "target_game_missing";
      if (competitionId && !checkCompetitionExists(merged, competitionId)) {
        return "competition_missing";
      }
      return "no_games_with_markets";
    };

    const onTargetSeen = () => {
      attempt.firstUsefulFrameMs = elapsed();
      lastGrowthAt = Date.now();
      clearTimeout(firstUsefulTimer);
      maxWaitTimer = armDeadline(
        "max-wait",
        WS_CONFIG.MAX_WAIT_TIME_SINGLE_EVENT,
        () => void finish(null)
      );
      // Plateau: no new markets unioned for a while -> treat the offer as complete.
      plateauPoll = setInterval(() => {
        if (done || elapsed() < WS_CONFIG.MIN_WAIT_TIME || bestMarketCount === 0) return;
        if (Date.now() - lastGrowthAt >= WS_CONFIG.PLATEAU_WAIT_TIME) void finish(null);
      }, WS_CONFIG.POLL_INTERVAL);
    };

    const onFrame = (frame: { payload: Buffer | string }) => {
      if (done) return;
      attempt.framesReceived++;

      try {
        const payload = frame.payload.toString();
        if (!payload.startsWith("{")) {
          attempt.nonJsonFrames++;
          return;
        }

        let msg: any;
        try {
          msg = JSON.parse(payload);
        } catch {
          attempt.nonJsonFrames++;
          return;
        }

        // Game data responses (sport > region > competition > game structure)
        if (msg?.code !== 0 || !msg.data?.data?.sport) return;
        attempt.sportFrames++;

        mergeSwarmData(merged, msg.data.data as SwarmData, mergeFilter);
        const stats = analyzeSwarmData(merged, targetGameNumber);

        if (!singleEventMode) {
          if (
            stats.hasGamesWithMarkets &&
            (!competitionId || checkCompetitionExists(merged, competitionId))
          ) {
            attempt.firstUsefulFrameMs = elapsed();
            void finish(null);
          }
          return;
        }

        const currentBest = targetGameNumber
          ? stats.targetMarketCount
          : stats.maxGameMarketCount;
        if (currentBest > bestMarketCount) {
          bestMarketCount = currentBest;
          lastGrowthAt = Date.now();
        }

        const targetSeen = targetGameNumber ? stats.hasTargetGame : stats.hasGamesWithMarkets;
        if (targetSeen && attempt.firstUsefulFrameMs === null) {
          onTargetSeen();
        }

        // Full offer captured: the union reached the game's self-reported total.
        const target = targetGameNumber ? stats.targetMarketsCount : 0;
        if (attempt.firstUsefulFrameMs !== null && target > 0 && currentBest >= target) {
          void finish(null);
        }
      } catch {
        // Unexpected frame shape - ignore the frame
      }
    };

    const onWebSocket = (ws: PlaywrightWebSocket) => {
      const wsUrl = ws.url();
      // Only intercept Swarm WebSocket connections
      if (!wsUrl.includes("swarm") && !wsUrl.includes("trexname.com")) {
        return;
      }
      attempt.wsUrls.push(wsUrl);

      if (attempt.wsOpenMs === null) {
        attempt.wsOpenMs = elapsed();
        clearTimeout(wsOpenTimer);
        firstUsefulTimer = armDeadline(
          "first-useful-frame",
          timing.firstUsefulFrameTimeoutMs,
          decideFirstUseful
        );
      }

      // A closed socket is detached; the SPA may open a new one (reconnect),
      // which this listener picks up like the first.
      const detach = () => {
        ws.off("framereceived", onFrame);
        ws.off("close", detach);
      };
      ws.on("framereceived", onFrame);
      ws.on("close", detach);
      socketCleanups.push(detach);
    };

    const onNavigationSettled = (error: unknown, rejected: boolean) => {
      // After the attempt ended, a late rejection is swallowed here.
      if (done || attempt.navMs !== null) return;
      attempt.navMs = elapsed();
      attempt.navError = rejected
        ? error instanceof Error
          ? error.message
          : String(error)
        : null;
      if (attempt.wsOpenMs === null) {
        wsOpenTimer = armDeadline("ws-open", timing.wsOpenTimeoutMs, decideWsOpen);
      }
    };

    page.on("websocket", onWebSocket);

    let navigation: Promise<unknown>;
    try {
      navigation = page.goto(url, {
        timeout: REQUEST_TIMEOUT,
        waitUntil: "domcontentloaded",
      });
    } catch (error) {
      navigation = Promise.reject(error);
    }
    navigation.then(
      () => onNavigationSettled(null, false),
      (error: unknown) => onNavigationSettled(error, true)
    );
  });
}

/**
 * page.title() for diagnostics; null when it throws or takes longer than
 * PAGE_TITLE_TIMEOUT_MS.
 */
async function readPageTitle(page: Page): Promise<string | null> {
  let timer: Timer | undefined;
  try {
    return await Promise.race([
      page.title(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PAGE_TITLE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Site-level failures: the page or its Swarm socket never delivered sport data. */
export function isSiteLevelCaptureFailure(f: SwarmCaptureFailure | null): boolean {
  return f !== null && SITE_LEVEL_CAPTURE_FAILURES.has(f);
}

function formatMs(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : String(value);
}

/** One-line failure reason with the last attempt's diagnostics. */
export function formatCaptureFailure(outcome: SwarmCaptureOutcome): string {
  const last = outcome.attempts[outcome.attempts.length - 1];
  return (
    `No WebSocket data captured: ${outcome.failure ?? "unknown"} (` +
    `attempts=${outcome.attempts.length}, ` +
    `navMs=${formatMs(last?.navMs)}, ` +
    `wsOpenMs=${formatMs(last?.wsOpenMs)}, ` +
    `frames=${last?.framesReceived ?? 0}, ` +
    `sportFrames=${last?.sportFrames ?? 0}, ` +
    `title="${last?.pageTitle ?? ""}", ` +
    `finalUrl=${last?.finalUrl ?? "n/a"}, ` +
    `loopLagMaxMs=${formatMs(last?.eventLoopDelayMaxMs)})`
  );
}

/** One-line timings of the successful (last) attempt. */
export function formatCaptureSuccess(outcome: SwarmCaptureOutcome): string {
  const last = outcome.attempts[outcome.attempts.length - 1];
  return (
    `capture ok: ` +
    `navMs=${formatMs(last?.navMs)}, ` +
    `wsOpenMs=${formatMs(last?.wsOpenMs)}, ` +
    `firstUsefulFrameMs=${formatMs(last?.firstUsefulFrameMs)}, ` +
    `attempts=${outcome.attempts.length}, ` +
    `loopLagMaxMs=${formatMs(last?.eventLoopDelayMaxMs)}, ` +
    `finalUrl=${last?.finalUrl ?? "n/a"}`
  );
}

/**
 * Filter that scopes which competitions/games are unioned into the accumulator.
 */
interface MergeFilter {
  /** Only union games belonging to this competition id (league listing mode). */
  competitionId?: number;
  /** Only union the game with this id/game_number (single-event mode). */
  targetGameNumber?: number;
}

/**
 * Deep-merge an incoming Swarm frame into an accumulator, unioning games,
 * markets (keyed by id) and selections so the full offer is reconstructed
 * across multiple subscription frames. The optional filter bounds memory by
 * discarding games/competitions that are not the capture target.
 */
function mergeSwarmData(
  target: SwarmData,
  incoming: SwarmData,
  filter: MergeFilter = {}
): void {
  if (!incoming.sport) return;
  target.sport ??= {};

  for (const [sportKey, sport] of Object.entries(incoming.sport)) {
    const tSport = (target.sport[sportKey] ??= { ...sport, region: {} });
    tSport.region ??= {};

    for (const [regionKey, region] of Object.entries(sport.region || {})) {
      const tRegion = (tSport.region[regionKey] ??= { ...region, competition: {} });
      tRegion.competition ??= {};

      for (const [compKey, comp] of Object.entries(region.competition || {})) {
        // Skip competitions outside the requested scope (league listing mode).
        if (filter.competitionId && comp.id !== filter.competitionId) continue;

        const tComp = (tRegion.competition[compKey] ??= { ...comp, game: {} });
        tComp.game ??= {};

        for (const [gameKey, game] of Object.entries(comp.game || {})) {
          // Skip games outside the requested scope (single-event mode).
          if (
            filter.targetGameNumber &&
            game.id !== filter.targetGameNumber &&
            game.game_number !== filter.targetGameNumber
          ) {
            continue;
          }

          const tGame = tComp.game[gameKey];
          if (!tGame) {
            tComp.game[gameKey] = { ...game, market: { ...(game.market || {}) } };
            continue;
          }

          // Union markets by id, merging selections within shared markets.
          tGame.market ??= {};
          for (const [marketKey, market] of Object.entries(game.market || {})) {
            const tMarket = tGame.market[marketKey];
            if (!tMarket) {
              tGame.market[marketKey] = { ...market, event: { ...(market.event || {}) } };
            } else {
              const mergedEvents = { ...(tMarket.event || {}), ...(market.event || {}) };
              Object.assign(tMarket, market);
              tMarket.event = mergedEvents;
            }
          }

          // Refresh scalar game fields from the latest frame but keep the
          // unioned market map and the highest self-reported markets_count.
          const mergedMarket = tGame.market;
          const maxMarketsCount = Math.max(
            tGame.markets_count || 0,
            game.markets_count || 0
          );
          Object.assign(tGame, game);
          tGame.market = mergedMarket;
          tGame.markets_count = maxMarketsCount;
        }
      }
    }
  }
}

/**
 * Analyze accumulated Swarm data to drive capture-completeness decisions.
 *
 * - `maxGameMarketCount`: largest unioned market count across all games.
 * - `targetMarketCount`: unioned market count for the target game (single-event).
 * - `targetMarketsCount`: the target game's self-reported total markets
 *   (used as the completeness validator).
 */
function analyzeSwarmData(
  data: SwarmData,
  targetGameNumber?: number
): {
  gameCount: number;
  maxGameMarketCount: number;
  targetMarketCount: number;
  targetMarketsCount: number;
  hasGamesWithMarkets: boolean;
  hasTargetGame: boolean;
} {
  let gameCount = 0;
  let maxGameMarketCount = 0;
  let targetMarketCount = 0;
  let targetMarketsCount = 0;
  let hasGamesWithMarkets = false;
  let hasTargetGame = false;

  for (const sport of Object.values(data.sport || {})) {
    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        for (const game of Object.values(competition.game || {})) {
          gameCount++;
          const marketCount = Object.keys(game.market || {}).length;

          if (marketCount > 0) {
            hasGamesWithMarkets = true;
          }
          if (marketCount > maxGameMarketCount) {
            maxGameMarketCount = marketCount;
          }

          // Check if this is our target game (by game_number or id)
          if (
            targetGameNumber &&
            (game.game_number === targetGameNumber || game.id === targetGameNumber)
          ) {
            hasTargetGame = true;
            targetMarketCount = marketCount;
            targetMarketsCount = game.markets_count || 0;
          }
        }
      }
    }
  }

  return {
    gameCount,
    maxGameMarketCount,
    targetMarketCount,
    targetMarketsCount,
    hasGamesWithMarkets,
    hasTargetGame,
  };
}

/**
 * Check if a competition ID exists in the Swarm data
 */
function checkCompetitionExists(data: SwarmData, competitionId: number): boolean {
  for (const sport of Object.values(data.sport || {})) {
    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        if (competition.id === competitionId) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Count total markets in Swarm data
 */
export function countMarkets(data: SwarmData): number {
  let count = 0;
  for (const sport of Object.values(data.sport || {})) {
    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        for (const game of Object.values(competition.game || {})) {
          count += Object.keys(game.market || {}).length;
        }
      }
    }
  }
  return count;
}

/**
 * Extract game ID from a Betcris event URL
 *
 * URL format: https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538/28660755
 *
 * @param eventUrl - Full URL to the event page
 * @returns Game ID or null if not found
 */
export function extractGameIdFromUrl(eventUrl: string): number | null {
  const urlParts = eventUrl.split("/");
  const gameId = parseInt(urlParts[urlParts.length - 1], 10);
  return isNaN(gameId) ? null : gameId;
}

/**
 * Build the canonical event URL from game context
 *
 * @param regionAlias - Region alias (e.g., "England")
 * @param competitionId - Competition ID
 * @param gameId - Game ID
 * @returns Full event URL
 */
export function buildEventUrl(
  regionAlias: string,
  competitionId: number,
  gameId: number
): string {
  return `${BASE_URL}/zaklady-bukmacherskie/match/Soccer/${regionAlias}/${competitionId}/${gameId}`;
}

/**
 * Get competition ID for a league
 */
export function getCompetitionId(league: string): number | undefined {
  return COMPETITION_IDS[league];
}
