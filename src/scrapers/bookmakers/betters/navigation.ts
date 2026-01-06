/**
 * Betters Navigation Module
 *
 * Handles all Playwright interactions for the Betters scraper.
 * Uses network interception to capture API responses from sbteam.xyz.
 *
 * KEY INSIGHT: The sbteam.xyz API requires explicit stakeTypes parameter.
 * We use route interception to modify requests and inject EXTENDED_STAKE_TYPE_IDS
 * to get ALL available markets, not just the default 6.
 */

import type { Page } from "playwright";
import {
  LEAGUE_IDS,
  REQUEST_TIMEOUT,
  CAPTURE_TIMEOUT,
  CACHE_TTL,
  EXTENDED_STAKE_TYPE_IDS,
  buildLeagueUrl,
  buildEventUrl as buildEventUrlFromConstants,
} from "./constants.js";
import type { BettersEvent } from "./types.js";

// Module-level cache for events data
let cachedEvents: Map<string, BettersEvent> = new Map();
let cacheTimestamp: number = 0;

/**
 * Get cached event by ID if cache is still valid
 */
export function getCachedEvent(eventId: string): BettersEvent | null {
  if (Date.now() - cacheTimestamp >= CACHE_TTL) {
    return null;
  }
  return cachedEvents.get(eventId) || null;
}

/**
 * Check if the cache is still valid
 */
export function isCacheValid(): boolean {
  return Date.now() - cacheTimestamp < CACHE_TTL;
}

/**
 * Clear the events cache
 */
export function clearCache(): void {
  cachedEvents.clear();
  cacheTimestamp = 0;
}

/**
 * Set up route interception to inject extended stakeTypes into API requests.
 * This is the key to getting ALL markets instead of just the default 6.
 *
 * @param page - Playwright page instance
 */
export async function setupRouteInterception(page: Page): Promise<void> {
  await page.route("**/leagues/*/upcoming*", async (route) => {
    const url = route.request().url();

    try {
      // Parse the URL and replace stakeTypes with extended list
      const urlObj = new URL(url);
      urlObj.searchParams.set("stakeTypes", JSON.stringify(EXTENDED_STAKE_TYPE_IDS));

      // Continue with modified request
      await route.continue({
        url: urlObj.toString(),
      });
    } catch (error) {
      // If URL parsing fails, continue with original request
      await route.continue();
    }
  });
}

/**
 * Navigate to league page and capture API response with ALL markets.
 * Uses route interception to inject extended stakeTypes.
 *
 * @param page - Playwright page instance
 * @param navigateWithRetry - Navigation function from base scraper
 * @param leagueId - Betters league ID
 * @param useExtendedStakeTypes - Whether to use route interception for extended markets
 * @returns Array of events or empty array on failure
 */
export async function captureLeagueEvents(
  page: Page,
  navigateWithRetry: (page: Page, url: string, options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" }) => Promise<void>,
  leagueId: number,
  useExtendedStakeTypes: boolean = false
): Promise<BettersEvent[]> {
  let capturedData: BettersEvent[] = [];

  // Set up route interception if extended stake types are requested
  if (useExtendedStakeTypes) {
    await setupRouteInterception(page);
  }

  // Set up response interception with timeout
  const capturePromise = new Promise<BettersEvent[]>((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`[Betters/Navigation] Capture timeout after ${CAPTURE_TIMEOUT}ms`);
      resolve([]);
    }, CAPTURE_TIMEOUT);

    const responseHandler = async (response: import("playwright").Response) => {
      const url = response.url();
      if (url.includes(`/leagues/${leagueId}/upcoming`)) {
        try {
          const data = await response.json();
          if (data && Array.isArray(data) && data.length > 0) {
            const games = data[0].games || [];
            if (games.length > 0) {
              clearTimeout(timeout);
              page.off("response", responseHandler);
              resolve(games);
            }
          }
        } catch (error) {
          console.warn(`[Betters/Navigation] Failed to parse response:`, error);
        }
      }
    };

    page.on("response", responseHandler);
  });

  // Navigate to the league page to trigger the API call
  const leagueUrl = buildLeagueUrl(leagueId);
  console.log(`[Betters/Navigation] Navigating to: ${leagueUrl}${useExtendedStakeTypes ? " (extended markets)" : ""}`);

  try {
    await navigateWithRetry(page, leagueUrl, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    console.error(`[Betters/Navigation] Navigation failed:`, error);
  }

  capturedData = await capturePromise;

  // Update cache with captured data
  if (capturedData.length > 0) {
    cacheTimestamp = Date.now();
    for (const event of capturedData) {
      cachedEvents.set(String(event.eventId), event);
    }

    // Log market counts for debugging
    if (capturedData[0]?.stakeTypes) {
      const totalStakes = capturedData[0].stakeTypes.reduce(
        (sum, st) => sum + (st.stakes?.length || 0),
        0
      );
      console.log(
        `[Betters/Navigation] Cached ${capturedData.length} events with ${capturedData[0].stakeTypes.length} stake types, ~${totalStakes} markets per event`
      );
    } else {
      console.log(`[Betters/Navigation] Cached ${capturedData.length} events`);
    }
  }

  return capturedData;
}

/**
 * Get league ID for a given league slug
 *
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns League ID or null if not found
 */
export function getLeagueId(league: string): number | null {
  return LEAGUE_IDS[league] ?? null;
}

/**
 * Extract event ID from Betters event URL
 *
 * @param eventUrl - Full URL to the event page
 * @returns Event ID string or null if not found
 */
export function extractEventIdFromUrl(eventUrl: string): string | null {
  // URL format: https://betterspl-ssr.boxwebcdn.work/pl/event/1/{leagueId}/{eventId}
  const match = eventUrl.match(/\/event\/\d+\/\d+\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract league ID from Betters event URL
 *
 * @param eventUrl - Full URL to the event page
 * @returns League ID number or null if not found
 */
export function extractLeagueIdFromUrl(eventUrl: string): number | null {
  // URL format: https://betterspl-ssr.boxwebcdn.work/pl/event/1/{leagueId}/{eventId}
  const match = eventUrl.match(/\/event\/\d+\/(\d+)\/\d+/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Build the canonical event URL from league ID and event ID
 * Re-export from constants for convenience
 */
export function buildEventUrl(leagueId: number, eventId: number | string): string {
  return buildEventUrlFromConstants(leagueId, eventId);
}

/**
 * Get all supported league IDs
 */
export function getAllLeagueIds(): Array<{ league: string; id: number }> {
  return Object.entries(LEAGUE_IDS).map(([league, id]) => ({ league, id }));
}

/**
 * Find event in cache across all leagues
 * Useful when we only have the event ID but not the league
 *
 * @param eventId - Event ID to find
 * @returns Event if found in cache, null otherwise
 */
export function findEventInCache(eventId: string): BettersEvent | null {
  if (!isCacheValid()) {
    return null;
  }
  return cachedEvents.get(eventId) || null;
}

/**
 * @deprecated The event detail page does not make additional API calls.
 * Use captureLeagueEvents with useExtendedStakeTypes=true instead.
 *
 * This function is kept for backward compatibility but will always return
 * the cached event data (no additional markets).
 */
export async function captureEventDetails(
  page: Page,
  navigateWithRetry: (page: Page, url: string, options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" }) => Promise<void>,
  leagueId: number,
  eventId: number | string
): Promise<BettersEvent | null> {
  // Check cache first - the event detail page doesn't provide additional data
  const cached = getCachedEvent(String(eventId));
  if (cached) {
    console.log(`[Betters/Navigation] Returning cached event ${eventId} with ${cached.stakeTypes?.length || 0} stake types`);
    return cached;
  }

  // If not cached, we need to fetch the league listing again
  console.log(`[Betters/Navigation] Event ${eventId} not in cache, returning null (use captureLeagueEvents with extended markets)`);
  return null;
}
