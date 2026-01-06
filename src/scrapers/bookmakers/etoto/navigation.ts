/**
 * eToto Navigation Module
 *
 * Handles all Playwright interactions for the eToto scraper.
 * Responsible for:
 * - Establishing browser sessions
 * - Navigating to pages to set cookies
 * - Fetching data from the eToto API
 *
 * NOTE: eToto uses a REST API for data, not DOM scraping.
 * We still need Playwright to establish a valid browser session
 * with cookies before making API requests.
 */

import type { Page } from "playwright";
import {
  API_BASE_URL,
  BASE_URL,
  CATEGORY_IDS,
  REQUEST_TIMEOUT,
  CACHE_TTL,
} from "./constants.js";
import type { EtotoEvent, EtotoEventsResponse } from "./types.js";

// In-memory cache for events data
const cachedEvents: Map<string, EtotoEvent> = new Map();
let cacheTimestamp: number = 0;

/**
 * Navigate to the eToto base site to establish session cookies
 * This is required before making API requests
 */
export async function navigateToBaseSite(page: Page): Promise<boolean> {
  try {
    console.log(`[eToto/Navigation] Navigating to: ${BASE_URL}`);
    await page.goto(BASE_URL, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[eToto/Navigation] Failed to navigate to base site:`, error);
    return false;
  }
}

/**
 * Fetch events for a league from the eToto API
 * Executes the API request within the browser context to use session cookies
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Array of events or empty array on error
 */
export async function fetchLeagueEvents(
  page: Page,
  league: string
): Promise<EtotoEvent[]> {
  const categoryId = CATEGORY_IDS[league];
  if (!categoryId) {
    console.error(`[eToto/Navigation] No category ID for league: ${league}`);
    return [];
  }

  const apiUrl = `${API_BASE_URL}/categories/multi/${categoryId}/events`;

  try {
    console.log(`[eToto/Navigation] Fetching events from: ${apiUrl}`);

    const response = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          return { data: [], error: `HTTP ${res.status}` };
        }
        return await res.json();
      } catch (err) {
        return { data: [], error: String(err) };
      }
    }, apiUrl);

    if (response?.error) {
      console.error(`[eToto/Navigation] API error: ${response.error}`);
      return [];
    }

    if (response && response.data) {
      const events = response.data as EtotoEvent[];

      // Update cache
      cacheTimestamp = Date.now();
      for (const event of events) {
        cachedEvents.set(String(event.eventId), event);
      }

      console.log(`[eToto/Navigation] Fetched ${events.length} events`);
      return events;
    }

    return [];
  } catch (error) {
    console.error(`[eToto/Navigation] Failed to fetch league events:`, error);
    return [];
  }
}

/**
 * Fetch events from all configured leagues
 * Useful when looking for a specific event by ID
 *
 * @param page - Playwright page with established session
 * @returns Array of all events from all leagues
 */
export async function fetchAllLeagueEvents(page: Page): Promise<EtotoEvent[]> {
  const allEvents: EtotoEvent[] = [];

  for (const league of Object.keys(CATEGORY_IDS)) {
    const events = await fetchLeagueEvents(page, league);
    allEvents.push(...events);
  }

  return allEvents;
}

/**
 * Get cached event by ID
 * Returns null if not in cache or cache is expired
 *
 * @param eventId - eToto event ID
 * @returns Cached event or null
 */
export function getCachedEvent(eventId: string): EtotoEvent | null {
  const isCacheValid = Date.now() - cacheTimestamp < CACHE_TTL;
  if (!isCacheValid) {
    return null;
  }
  return cachedEvents.get(eventId) || null;
}

/**
 * Extract event ID from an eToto event URL
 *
 * @param eventUrl - Full URL to the event page
 * @returns Event ID string or null if not found
 */
export function extractEventIdFromUrl(eventUrl: string): string | null {
  // URL format: https://www.etoto.pl/zaklady-bukmacherskie/wydarzenie/123456
  // or: https://www.etoto.pl/.../123456
  const match = eventUrl.match(/\/wydarzenie\/(\d+)/) || eventUrl.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Build the canonical event URL from an event ID
 */
export function buildEventUrl(eventId: number | string): string {
  return `${BASE_URL}/zaklady-bukmacherskie/wydarzenie/${eventId}`;
}

/**
 * Clear the events cache
 * Useful for testing or forced refresh
 */
export function clearCache(): void {
  cachedEvents.clear();
  cacheTimestamp = 0;
}

/**
 * Response type for single event detail endpoint
 */
export interface EtotoEventDetailResponse {
  data?: EtotoEvent;
  error?: string;
}

/**
 * Fetch detailed data for a single event from eToto API
 * This endpoint returns ALL available markets for the match (not just major markets)
 *
 * @param page - Playwright page with established session
 * @param eventId - eToto event ID
 * @returns API response with full event data or null on error
 */
export async function fetchEventDetails(
  page: Page,
  eventId: string
): Promise<EtotoEventDetailResponse | null> {
  // eToto API for single event: /rest/market/events/{eventId}
  const apiUrl = `${API_BASE_URL}/events/${eventId}`;

  try {
    console.log(`[eToto/Navigation] Fetching event details for: ${eventId}`);

    const response = await page.evaluate(async (url: string) => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          return { data: undefined, error: `HTTP ${res.status}` };
        }
        return await res.json();
      } catch (err) {
        return { data: undefined, error: String(err) };
      }
    }, apiUrl);

    if (response?.error) {
      console.error(`[eToto/Navigation] API error for event ${eventId}: ${response.error}`);
      return null;
    }

    // Cache the detailed event data
    if (response?.data) {
      cacheTimestamp = Date.now();
      cachedEvents.set(eventId, response.data);
    }

    return response as EtotoEventDetailResponse;
  } catch (error) {
    console.error(`[eToto/Navigation] Failed to fetch event details:`, error);
    return null;
  }
}
