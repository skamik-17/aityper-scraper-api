/**
 * Totalbet Navigation Module
 *
 * Handles all Playwright interactions for the Totalbet scraper.
 * Responsible for:
 * - Establishing browser sessions
 * - Navigating to pages to set cookies
 * - Fetching data from the Totalbet REST API
 *
 * NOTE: Totalbet uses a REST API for data, not DOM scraping.
 * We still need Playwright to establish a valid browser session
 * with cookies before making API requests.
 */

import type { Page } from "playwright";
import {
  API_BASE_URL,
  BASE_URL,
  CATEGORY_IDS,
  REQUEST_TIMEOUT,
} from "./constants.js";
import type {
  TotalbetEventsResponse,
  TotalbetEventDetailResponse,
  TotalbetEvent,
} from "./types.js";

/**
 * Navigate to the base site to establish session cookies
 * This is required before making API requests
 */
export async function navigateToBaseSite(page: Page): Promise<boolean> {
  try {
    console.log(`[Totalbet/Navigation] Navigating to base site: ${BASE_URL}`);
    await page.goto(BASE_URL, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[Totalbet/Navigation] Failed to navigate to base site:`, error);
    return false;
  }
}

/**
 * Fetch events for a league from the Totalbet API
 * Executes the API request within the browser context to use session cookies
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns API response with events or null on error
 */
export async function fetchLeagueEvents(
  page: Page,
  league: string
): Promise<TotalbetEventsResponse | null> {
  const categoryId = CATEGORY_IDS[league];
  if (!categoryId) {
    console.error(`[Totalbet/Navigation] No category ID for league: ${league}`);
    return null;
  }

  try {
    console.log(`[Totalbet/Navigation] Fetching events for category: ${categoryId}`);

    const apiData = await page.evaluate(
      async ({ apiBaseUrl, catId }) => {
        try {
          const apiUrl = `${apiBaseUrl}/categories/multi/${catId}/events`;
          const res = await fetch(apiUrl);
          if (!res.ok) {
            return { data: [], error: `HTTP ${res.status}` };
          }
          const json = await res.json();
          return json;
        } catch (err) {
          return { data: [], error: String(err) };
        }
      },
      { apiBaseUrl: API_BASE_URL, catId: categoryId }
    );

    if (apiData?.error) {
      console.error(`[Totalbet/Navigation] API error: ${apiData.error}`);
    }

    return apiData as TotalbetEventsResponse;
  } catch (error) {
    console.error(`[Totalbet/Navigation] Failed to fetch league events:`, error);
    return null;
  }
}

/**
 * Fetch events from multiple leagues to find a specific event
 * Used when we have an event ID but don't know which league it belongs to
 *
 * @param page - Playwright page with established session
 * @returns All events from all configured leagues
 */
export async function fetchAllLeagueEvents(
  page: Page
): Promise<TotalbetEvent[]> {
  const allEvents: TotalbetEvent[] = [];
  const categoryIds = Object.values(CATEGORY_IDS);

  for (const categoryId of categoryIds) {
    try {
      const apiData = await page.evaluate(
        async ({ apiBaseUrl, catId }) => {
          try {
            const apiUrl = `${apiBaseUrl}/categories/multi/${catId}/events`;
            const res = await fetch(apiUrl);
            if (!res.ok) {
              return { data: [] };
            }
            const json = await res.json();
            return json;
          } catch {
            return { data: [] };
          }
        },
        { apiBaseUrl: API_BASE_URL, catId: categoryId }
      );

      if (apiData?.data && Array.isArray(apiData.data)) {
        allEvents.push(...apiData.data);
      }
    } catch (error) {
      console.warn(`[Totalbet/Navigation] Failed to fetch category ${categoryId}:`, error);
    }
  }

  return allEvents;
}

/**
 * Fetch detailed data for a single event
 * This endpoint returns all available markets for the match
 *
 * @param page - Playwright page with established session
 * @param eventId - Totalbet event ID
 * @returns API response with full event data or null on error
 */
export async function fetchEventDetails(
  page: Page,
  eventId: string
): Promise<TotalbetEventDetailResponse | null> {
  try {
    console.log(`[Totalbet/Navigation] Fetching event details for: ${eventId}`);

    const apiData = await page.evaluate(
      async ({ apiBaseUrl, eid }) => {
        try {
          // Totalbet uses /events/{eventId} endpoint for full event details
          const apiUrl = `${apiBaseUrl}/events/${eid}`;
          const res = await fetch(apiUrl);
          if (!res.ok) {
            return { error: `HTTP ${res.status}` };
          }
          const json = await res.json();
          return json;
        } catch (err) {
          return { error: String(err) };
        }
      },
      { apiBaseUrl: API_BASE_URL, eid: eventId }
    );

    if (apiData?.error) {
      console.error(`[Totalbet/Navigation] API error: ${apiData.error}`);
    }

    return apiData as TotalbetEventDetailResponse;
  } catch (error) {
    console.error(`[Totalbet/Navigation] Failed to fetch event details:`, error);
    return null;
  }
}

/**
 * Extract event ID from a Totalbet event URL
 *
 * @param eventUrl - Full URL to the event page
 * @returns Event ID string or null if not found
 */
export function extractEventIdFromUrl(eventUrl: string): string | null {
  // URL format: https://totalbet.pl/sports/event/123456
  // or: https://totalbet.pl/zaklady-sportowe/.../123456
  const match = eventUrl.match(/\/event\/(\d+)/) || eventUrl.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Build the canonical event URL from an event ID
 */
export function buildEventUrl(eventId: number | string): string {
  return `${BASE_URL}/sports/event/${eventId}`;
}

/**
 * Get category ID for a league
 */
export function getCategoryId(league: string): number | undefined {
  return CATEGORY_IDS[league];
}
