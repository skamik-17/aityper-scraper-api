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
 * single event mode (look for specific game with many markets).
 *
 * @param page - Playwright page with active WebSocket connection
 * @param config - Capture configuration
 * @returns Promise resolving to captured SwarmData or null on timeout
 */
export function captureSwarmData(
  page: Page,
  config: CaptureConfig = {}
): Promise<SwarmData | null> {
  const { competitionId, singleEventMode = false, targetGameNumber } = config;

  return new Promise((resolve) => {
    let resolved = false;
    let bestData: SwarmData | null = null;
    let bestMarketCount = 0;

    // Set up WebSocket frame interception
    page.on("websocket", (ws: PlaywrightWebSocket) => {
      // Only intercept Swarm WebSocket connections
      if (!ws.url().includes("swarm") && !ws.url().includes("trexname.com")) {
        return;
      }

      ws.on("framereceived", (frame) => {
        if (resolved) return;

        try {
          const payload = frame.payload.toString();
          // Skip non-JSON frames
          if (!payload.startsWith("{")) return;

          const msg = JSON.parse(payload);

          // Look for game data responses (sport > region > competition > game structure)
          if (msg.code === 0 && msg.data?.data?.sport) {
            const data = msg.data.data as SwarmData;

            // Analyze the response
            const analysis = analyzeSwarmData(data, targetGameNumber);

            if (analysis.hasGamesWithMarkets && analysis.gameCount > 0) {
              // Check competition filter for league listing mode
              let hasTargetCompetition = !competitionId;
              if (competitionId) {
                hasTargetCompetition = checkCompetitionExists(data, competitionId);
              }

              if (singleEventMode) {
                // For match details: look for response with target game and many markets
                if (targetGameNumber) {
                  // Only consider responses containing the target game
                  if (analysis.hasTargetGame && analysis.totalMarkets > bestMarketCount) {
                    bestMarketCount = analysis.totalMarkets;
                    bestData = data;
                    // Resolve when we have the target game with extended markets
                    if (analysis.totalMarkets >= WS_CONFIG.MIN_MARKETS_SINGLE_EVENT) {
                      resolved = true;
                      resolve(data);
                      return;
                    }
                  }
                } else {
                  // No target game, just look for many markets
                  if (analysis.totalMarkets > bestMarketCount) {
                    bestMarketCount = analysis.totalMarkets;
                    bestData = data;
                  }
                  if (analysis.totalMarkets >= WS_CONFIG.MIN_MARKETS_SINGLE_EVENT) {
                    resolved = true;
                    resolve(data);
                    return;
                  }
                }
              } else if (hasTargetCompetition) {
                // For league listing: resolve when we have the target competition
                resolved = true;
                resolve(data);
                return;
              }
            }
          }
        } catch {
          // Not valid JSON or parsing error - ignore
        }
      });
    });

    // Early-exit polling with timeout
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (resolved) {
        clearInterval(checkInterval);
        return;
      }

      const elapsed = Date.now() - startTime;

      // Exit early if we have good data after minimum wait
      if (elapsed >= WS_CONFIG.MIN_WAIT_TIME && bestData && bestMarketCount > 0) {
        resolved = true;
        clearInterval(checkInterval);
        resolve(bestData);
        return;
      }

      // Maximum timeout
      if (elapsed >= WS_CONFIG.MAX_WAIT_TIME) {
        resolved = true;
        clearInterval(checkInterval);
        resolve(bestData);
      }
    }, WS_CONFIG.POLL_INTERVAL);
  });
}

/**
 * Analyze Swarm data structure to count games and markets
 */
function analyzeSwarmData(
  data: SwarmData,
  targetGameNumber?: number
): {
  gameCount: number;
  totalMarkets: number;
  hasGamesWithMarkets: boolean;
  hasTargetGame: boolean;
} {
  let gameCount = 0;
  let totalMarkets = 0;
  let hasGamesWithMarkets = false;
  let hasTargetGame = false;

  for (const sport of Object.values(data.sport || {})) {
    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        for (const game of Object.values(competition.game || {})) {
          gameCount++;
          const marketCount = Object.keys(game.market || {}).length;
          totalMarkets += marketCount;

          if (marketCount > 0) {
            hasGamesWithMarkets = true;
          }

          // Check if this is our target game (by game_number or id)
          if (
            targetGameNumber &&
            (game.game_number === targetGameNumber || game.id === targetGameNumber)
          ) {
            hasTargetGame = true;
          }
        }
      }
    }
  }

  return { gameCount, totalMarkets, hasGamesWithMarkets, hasTargetGame };
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
