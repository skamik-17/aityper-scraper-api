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

import { monitorEventLoopDelay } from "node:perf_hooks";
// The same function as the global in production. Fake timers patch only the
// global, so under them this stays a real I/O turn that costs no fake time
// (a faked zero-delay timer created inside a fired timer is due 1 ms later).
import { setImmediate } from "node:timers";
import type { Page, WebSocket as PlaywrightWebSocket } from "playwright";
import {
  BASE_URL,
  LEAGUE_URLS,
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

/**
 * Navigate to a league page to trigger WebSocket connection
 *
 * @param page - Playwright page instance
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Whether navigation was successful
 */
export async function navigateToLeaguePage(
  page: Page,
  league: string
): Promise<boolean> {
  const url = LEAGUE_URLS[league];
  if (!url) {
    console.error(`[Betcris/Navigation] Unknown league: ${league}`);
    return false;
  }

  try {
    console.log(`[Betcris/Navigation] Navigating to: ${url}`);
    await page.goto(url, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[Betcris/Navigation] Failed to navigate:`, error);
    return false;
  }
}

/**
 * Navigate to a match detail page
 *
 * @param page - Playwright page instance
 * @param eventUrl - Full URL to the match page
 * @returns Whether navigation was successful
 */
export async function navigateToMatchPage(
  page: Page,
  eventUrl: string
): Promise<boolean> {
  try {
    console.log(`[Betcris/Navigation] Navigating to match: ${eventUrl}`);
    await page.goto(eventUrl, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[Betcris/Navigation] Failed to navigate to match:`, error);
    return false;
  }
}

/**
 * Capture Swarm WebSocket data from the page
 *
 * This function sets up WebSocket interception and waits for relevant data.
 * It handles both league listing mode (filter by competition ID) and
 * single event mode (look for a specific game with its full market offer).
 *
 * IMPORTANT: BetConstruct/Swarm streams a game's offer across several frames -
 * an initial snapshot plus per-market-group subscription responses (All/Goals/
 * Halves/Corners/Bookings/Player-props ...). A single frame therefore only ever
 * contains a subset of the markets. We accumulate (union) every frame within the
 * wait window - keyed by market id - instead of resolving on the first frame that
 * happens to cross a market threshold. For single-event mode we resolve only once
 * the accumulated market count reaches the game's self-reported `markets_count`
 * (the completeness target/validator), or once growth plateaus / the window ends.
 *
 * @param page - Playwright page with active WebSocket connection
 * @param config - Capture configuration
 * @returns Promise resolving to the merged SwarmData or null on timeout
 */
export function captureSwarmData(
  page: Page,
  config: CaptureConfig = {}
): Promise<SwarmData | null> {
  const { competitionId, singleEventMode = false, targetGameNumber } = config;

  // Scope what is unioned into the accumulator to bound memory: in single-event
  // mode keep only the target game, in league mode keep only the target
  // competition. This is essential because the page (and its WebSocket) is reused
  // across many matches during a full-offer scrape.
  const mergeFilter: MergeFilter = {
    competitionId: singleEventMode ? undefined : competitionId,
    targetGameNumber: singleEventMode ? targetGameNumber : undefined,
  };

  return new Promise((resolve) => {
    let resolved = false;
    // Accumulator that unions markets/events across every relevant frame.
    const merged: SwarmData = {};
    let bestMarketCount = 0;
    let lastGrowthTime = Date.now();

    // Track attached listeners so they can be detached on resolve. The page is
    // reused across matches, so leaving listeners attached leaks memory/CPU.
    const wsCleanups: Array<() => void> = [];

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (resolved) {
        clearInterval(checkInterval);
        return;
      }
      tick();
    }, WS_CONFIG.POLL_INTERVAL);

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearInterval(checkInterval);
      page.off("websocket", onWebSocket);
      for (const cleanup of wsCleanups) cleanup();
      resolve(merged.sport ? merged : null);
    };

    // Evaluate the accumulated data and decide whether to resolve.
    const tick = () => {
      if (resolved) return;
      const elapsed = Date.now() - startTime;
      if (elapsed < WS_CONFIG.MIN_WAIT_TIME) return;

      if (bestMarketCount > 0) {
        if (singleEventMode) {
          // Plateau: no new markets unioned for a while -> treat as complete.
          if (Date.now() - lastGrowthTime >= WS_CONFIG.PLATEAU_WAIT_TIME) {
            finish();
            return;
          }
        } else {
          // League listing only needs the target competition's base markets.
          const hasCompetition =
            !competitionId || checkCompetitionExists(merged, competitionId);
          if (hasCompetition) {
            finish();
            return;
          }
        }
      }

      const maxWait = singleEventMode
        ? WS_CONFIG.MAX_WAIT_TIME_SINGLE_EVENT
        : WS_CONFIG.MAX_WAIT_TIME;
      if (elapsed >= maxWait) {
        finish();
      }
    };

    // Frame handler shared by every Swarm WebSocket on the page.
    const onFrame = (frame: { payload: Buffer | string }) => {
      if (resolved) return;

      try {
        const payload = frame.payload.toString();
        // Skip non-JSON frames
        if (!payload.startsWith("{")) return;

        const msg = JSON.parse(payload);

        // Look for game data responses (sport > region > competition > game structure)
        if (msg.code === 0 && msg.data?.data?.sport) {
          const data = msg.data.data as SwarmData;

          // Union this frame into the accumulator (markets keyed by id), scoped
          // to the relevant game/competition only.
          mergeSwarmData(merged, data, mergeFilter);

          const stats = analyzeSwarmData(merged, targetGameNumber);

          // Track the metric that drives completeness for this mode.
          const currentBest = singleEventMode
            ? targetGameNumber
              ? stats.targetMarketCount
              : stats.maxGameMarketCount
            : stats.maxGameMarketCount;

          if (currentBest > bestMarketCount) {
            bestMarketCount = currentBest;
            lastGrowthTime = Date.now();
          }

          if (singleEventMode) {
            // Resolve as soon as the accumulated markets reach the game's
            // self-reported total (full offer captured).
            const target = targetGameNumber ? stats.targetMarketsCount : 0;
            if (target > 0 && currentBest >= target) {
              finish();
              return;
            }
          } else if (
            stats.hasGamesWithMarkets &&
            (!competitionId || checkCompetitionExists(merged, competitionId))
          ) {
            // League listing: resolve once the target competition is present.
            finish();
            return;
          }
        }
      } catch {
        // Not valid JSON or parsing error - ignore
      }
    };

    // Attach the frame handler to every relevant Swarm WebSocket on the page.
    const onWebSocket = (ws: PlaywrightWebSocket) => {
      // Only intercept Swarm WebSocket connections
      if (!ws.url().includes("swarm") && !ws.url().includes("trexname.com")) {
        return;
      }
      ws.on("framereceived", onFrame);
      wsCleanups.push(() => ws.off("framereceived", onFrame));
    };

    page.on("websocket", onWebSocket);
  });
}

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
 * without awaiting it, and unions every Swarm sport frame (see captureSwarmData
 * for why frames are unioned). Completion:
 * - league: the target competition has at least one game with markets;
 * - single-event: the target game's markets_count is reached, or no growth for
 *   PLATEAU_WAIT_TIME, or MAX_WAIT_TIME_SINGLE_EVENT after the target first
 *   appeared.
 * Deadlines:
 * - goto settled (resolved or rejected) and no Swarm socket within
 *   wsOpenTimeoutMs -> navigation_failed (goto rejected) / no_swarm_socket;
 * - first socket opened and no useful frame within firstUsefulFrameTimeoutMs ->
 *   no_sport_frames / competition_missing / no_games_with_markets /
 *   target_game_missing.
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
      timing.firstUsefulFrameTimeoutMs ?? WS_CONFIG.FIRST_USEFUL_FRAME_TIMEOUT,
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

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();

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
  };

  // Same scoping as captureSwarmData: keep only the target game (single-event)
  // or the target competition (league) to bound memory on a reused page.
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
  const socketCleanups: Array<() => void> = [];

  return new Promise<CaptureAttemptResult>((resolve) => {
    const finish = async (failure: SwarmCaptureFailure | null): Promise<void> => {
      if (done) return;
      done = true;
      clearTimeout(wsOpenTimer);
      clearTimeout(firstUsefulTimer);
      clearTimeout(maxWaitTimer);
      clearInterval(plateauPoll);
      page.off("websocket", onWebSocket);
      for (const cleanup of socketCleanups) cleanup();

      attempt.failure = failure;
      try {
        attempt.finalUrl = page.url();
      } catch {
        attempt.finalUrl = null;
      }
      attempt.eventLoopDelayMaxMs = Math.round(loopDelay.max / 1e6);
      loopDelay.disable();
      if (failure) {
        attempt.pageTitle = await readPageTitle(page);
      }
      resolve({ attempt, data: failure ? null : merged });
    };

    // A deadline fired. After a long synchronous stretch Node runs expired timers
    // before it polls for socket I/O, so frames that already arrived may still be
    // queued: give them one setImmediate turn, then decide. A frame that completes
    // the capture during that turn finishes it, so `done` is the completion re-check.
    const afterQueuedIo = (decide: () => void) => {
      setImmediate(() => {
        if (!done) decide();
      });
    };

    const onWsOpenDeadline = () =>
      afterQueuedIo(() => {
        // A socket opened during the turn: its own deadline is already armed.
        if (attempt.wsOpenMs !== null) return;
        void finish(attempt.navError !== null ? "navigation_failed" : "no_swarm_socket");
      });

    const onFirstUsefulDeadline = () =>
      afterQueuedIo(() => {
        // Single-event: the target appeared, its completion timers are running.
        if (attempt.firstUsefulFrameMs !== null) return;
        void finish(classifyMissingData());
      });

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
      maxWaitTimer = setTimeout(
        () => afterQueuedIo(() => void finish(null)),
        WS_CONFIG.MAX_WAIT_TIME_SINGLE_EVENT
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
        firstUsefulTimer = setTimeout(onFirstUsefulDeadline, timing.firstUsefulFrameTimeoutMs);
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
        wsOpenTimer = setTimeout(onWsOpenDeadline, timing.wsOpenTimeoutMs);
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
