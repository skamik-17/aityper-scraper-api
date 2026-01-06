/**
 * LeBull Navigation Module
 *
 * Handles all Playwright interactions for the LeBull scraper.
 * Responsible for:
 * - Navigating to pages to trigger API calls
 * - Intercepting API responses via network monitoring
 * - Route interception to inject extended stakeTypes for full offer
 * - Caching captured data
 *
 * NOTE: LeBull uses the sbteam.xyz backend (shared with Betters).
 * We use route interception to modify requests and inject EXTENDED_STAKE_TYPE_IDS
 * when scraping full offers, which returns ALL available markets instead of just ~6.
 */

import type { Page } from "playwright";
import type { LebullEvent, LebullEventDetailResponse } from "./types.js";
import {
  LEAGUE_IDS,
  LEAGUE_URLS,
  BASE_URL,
  SPORT_ID,
  API_CAPTURE_TIMEOUT,
  REQUEST_TIMEOUT,
  CACHE_TTL,
  buildEventPageUrl,
} from "./constants.js";

// Module-level cache for events data
let cachedEvents: Map<string, LebullEvent> = new Map();
let cacheTimestamp: number = 0;

/**
 * Get cached event by ID if cache is still valid
 */
export function getCachedEvent(eventId: string): LebullEvent | null {
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
 * Set up route interception to REMOVE the stakeTypes filter from API requests.
 * This is the key to getting ALL markets instead of just a filtered subset.
 *
 * The sbteam.xyz API filters markets by the stakeTypes parameter.
 * By removing this parameter entirely, the API returns ALL available markets
 * (253+ stake types with 1000+ markets per event).
 *
 * @param page - Playwright page instance
 */
export async function setupRouteInterception(page: Page): Promise<void> {
  await page.route("**/leagues/*/upcoming*", async (route) => {
    const url = route.request().url();

    try {
      // Parse the URL and REMOVE stakeTypes to get ALL available markets
      const urlObj = new URL(url);
      urlObj.searchParams.delete("stakeTypes");

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
 * Navigate to a league page and capture API response via network interception
 * Returns an array of events from the /leagues/{id}/upcoming endpoint
 *
 * @param page - Playwright page with established session
 * @param navigateWithRetry - Navigation function from base class
 * @param leagueId - Numeric league ID for the API
 * @param useExtendedStakeTypes - Whether to use route interception for extended markets
 * @returns Array of events or empty array on failure
 */
export async function captureLeagueEvents(
  page: Page,
  navigateWithRetry: (page: Page, url: string, options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" }) => Promise<void>,
  leagueId: number,
  useExtendedStakeTypes: boolean = false
): Promise<LebullEvent[]> {
  let capturedData: LebullEvent[] = [];

  // Set up route interception if extended stake types are requested
  if (useExtendedStakeTypes) {
    await setupRouteInterception(page);
  }

  // Set up response interception with timeout
  const capturePromise = new Promise<LebullEvent[]>((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`[LeBull/Navigation] Capture timeout after ${API_CAPTURE_TIMEOUT}ms`);
      resolve([]);
    }, API_CAPTURE_TIMEOUT);

    const responseHandler = async (response: import("playwright").Response) => {
      const url = response.url();
      // Match the upcoming endpoint for this league
      if (url.includes(`/leagues/${leagueId}/upcoming`)) {
        try {
          const data = await response.json();
          // API returns array with single object containing games array
          if (data && Array.isArray(data) && data.length > 0) {
            const games = data[0].games || [];
            if (games.length > 0) {
              clearTimeout(timeout);
              page.off("response", responseHandler);
              resolve(games);
            }
          }
        } catch (error) {
          console.warn(`[LeBull/Navigation] Failed to parse response:`, error);
        }
      }
    };

    page.on("response", responseHandler);
  });

  // Navigate to trigger the API call
  const leagueUrl = `${BASE_URL}/pl/league/${SPORT_ID}/${leagueId}`;
  console.log(`[LeBull/Navigation] Navigating to: ${leagueUrl}${useExtendedStakeTypes ? " (extended markets)" : ""}`);

  try {
    await navigateWithRetry(page, leagueUrl, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    console.error(`[LeBull/Navigation] Navigation failed:`, error);
  }

  capturedData = await capturePromise;

  // Update cache with captured data
  if (capturedData.length > 0) {
    cacheTimestamp = Date.now();
    // Calculate average markets for logging
    let totalStakeTypes = 0;
    let totalMarkets = 0;
    for (const event of capturedData) {
      cachedEvents.set(String(event.eventId), event);
      const stakeTypes = event.stakeTypes || [];
      totalStakeTypes = Math.max(totalStakeTypes, stakeTypes.length);
      for (const st of stakeTypes) {
        totalMarkets += st.stakes?.length || 0;
      }
    }
    const avgMarkets = Math.round(totalMarkets / capturedData.length);
    console.log(`[LeBull/Navigation] Cached ${capturedData.length} events with ${totalStakeTypes} stake types, ~${avgMarkets} markets per event`);
  }

  return capturedData;
}

/**
 * Get the league ID for a given league slug
 *
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Numeric league ID or null if not found
 */
export function getLeagueId(league: string): number | null {
  return LEAGUE_IDS[league] || null;
}

/**
 * Extract event ID from a LeBull event URL
 * URL format: /pl/event/{sportId}/{leagueId}/{eventId}
 *
 * @param eventUrl - Full URL to the event page
 * @returns Event ID string or null if not found
 */
export function extractEventIdFromUrl(eventUrl: string): string | null {
  const match = eventUrl.match(/\/event\/\d+\/\d+\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Build the canonical event URL from league ID and event ID
 */
export function buildEventUrl(leagueId: number, eventId: number | string): string {
  return `${BASE_URL}/pl/event/${SPORT_ID}/${leagueId}/${eventId}`;
}

/**
 * Find event in cache across all leagues
 * Useful when we only have the event ID but not the league
 *
 * @param eventId - Event ID to find
 * @returns Event if found in cache, null otherwise
 */
export function findEventInCache(eventId: string): LebullEvent | null {
  if (!isCacheValid()) {
    return null;
  }
  return cachedEvents.get(eventId) || null;
}

/**
 * Get all supported league IDs
 */
export function getAllLeagueIds(): Array<{ league: string; id: number }> {
  return Object.entries(LEAGUE_IDS).map(([league, id]) => ({ league, id }));
}

/**
 * Fetch detailed event data by navigating to the event page
 * This captures ALL available markets for the event via network interception
 *
 * @param page - Playwright page with established session
 * @param navigateWithRetry - Navigation function from base class
 * @param leagueId - Numeric league ID
 * @param eventId - Event ID to fetch details for
 * @returns Full event data with all markets or null on failure
 */
export async function fetchEventDetails(
  page: Page,
  navigateWithRetry: (page: Page, url: string, options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" }) => Promise<void>,
  leagueId: number,
  eventId: string | number
): Promise<LebullEvent | null> {
  let capturedEvent: LebullEvent | null = null;

  // Set up response interception with timeout
  const capturePromise = new Promise<LebullEvent | null>((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`[LeBull/Navigation] Event detail capture timeout for ${eventId}`);
      resolve(null);
    }, API_CAPTURE_TIMEOUT);

    const responseHandler = async (response: { url: () => string; json: () => Promise<unknown> }) => {
      const url = response.url();
      // Match event detail endpoint - pattern: /events/{eventId} or containing the eventId
      if (url.includes(`/events/${eventId}`) || url.includes(`events?eventId=${eventId}`)) {
        try {
          const data = await response.json() as unknown;

          // Handle different response formats from sbteam API
          let event: LebullEvent | null = null;

          if (data && typeof data === "object") {
            const dataObj = data as Record<string, unknown>;
            // Direct event object
            if (dataObj.eventId) {
              event = dataObj as unknown as LebullEvent;
            }
            // Nested under 'event' key
            else if (dataObj.event && typeof dataObj.event === "object") {
              event = dataObj.event as LebullEvent;
            }
            // Nested under 'data' key
            else if (dataObj.data && typeof dataObj.data === "object") {
              event = dataObj.data as LebullEvent;
            }
            // Array response - take first element
            else if (Array.isArray(dataObj)) {
              event = (dataObj as unknown[])[0] as LebullEvent;
            }
          }

          if (event && event.stakeTypes && event.stakeTypes.length > 0) {
            clearTimeout(timeout);
            page.off("response", responseHandler);
            resolve(event);
            return;
          }
        } catch {
          // JSON parse error - continue listening
        }
      }
      // Also catch league/upcoming responses that include this event
      else if (url.includes("/upcoming") || url.includes("/games")) {
        try {
          const data = await response.json() as unknown;
          if (data && Array.isArray(data)) {
            for (const item of data) {
              const itemObj = item as Record<string, unknown>;
              const games = (itemObj.games || []) as LebullEvent[];
              const foundEvent = games.find(g => String(g.eventId) === String(eventId));
              if (foundEvent && foundEvent.stakeTypes && foundEvent.stakeTypes.length > 0) {
                clearTimeout(timeout);
                page.off("response", responseHandler);
                resolve(foundEvent);
                return;
              }
            }
          }
        } catch {
          // JSON parse error - continue listening
        }
      }
    };

    page.on("response", responseHandler);
  });

  // Navigate to the event page to trigger the API call
  const eventUrl = buildEventPageUrl(leagueId, eventId);
  console.log(`[LeBull/Navigation] Fetching event details: ${eventId}`);

  try {
    await navigateWithRetry(page, eventUrl, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    console.warn(`[LeBull/Navigation] Event navigation failed for ${eventId}:`, error);
  }

  capturedEvent = await capturePromise;

  // Update cache if we got data
  if (capturedEvent) {
    cachedEvents.set(String(capturedEvent.eventId), capturedEvent);
    console.log(
      `[LeBull/Navigation] Captured event ${eventId} with ${capturedEvent.stakeTypes?.length || 0} market types`
    );
  }

  return capturedEvent;
}
