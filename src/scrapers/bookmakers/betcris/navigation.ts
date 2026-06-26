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

import type { Page, WebSocket as PlaywrightWebSocket } from "playwright";
import {
  BASE_URL,
  LEAGUE_URLS,
  COMPETITION_IDS,
  REQUEST_TIMEOUT,
  WS_CONFIG,
} from "./constants.js";
import type { SwarmData, CaptureConfig } from "./types.js";

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
