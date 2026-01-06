/**
 * forBET Navigation Module
 *
 * Handles all Playwright interactions for the forBET scraper.
 * Responsible for:
 * - Establishing browser sessions
 * - Navigating to pages to set cookies
 * - Fetching data from the forBET API
 *
 * NOTE: forBET uses a REST API for data, not DOM scraping.
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
import type { ForbetEvent, ForbetEventsResponse, ForbetEventDetailResponse } from "./types.js";

/**
 * Navigate to the forBET base site to establish session cookies
 * This is required before making API requests
 */
export async function navigateToBaseSite(page: Page): Promise<boolean> {
  try {
    console.log(`[forBET/Navigation] Navigating to base site: ${BASE_URL}`);
    await page.goto(BASE_URL, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[forBET/Navigation] Failed to navigate to base site:`, error);
    return false;
  }
}

/**
 * Fetch events for a league from the forBET API
 * Executes the API request within the browser context to use session cookies
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Array of forBET events or empty array on error
 */
export async function fetchLeagueEvents(
  page: Page,
  league: string
): Promise<ForbetEvent[]> {
  const categoryId = CATEGORY_IDS[league];
  if (!categoryId) {
    console.error(`[forBET/Navigation] No category ID for league: ${league}`);
    return [];
  }

  const apiUrl = `${API_BASE_URL}/${categoryId}/events?gamesClass=major`;

  try {
    console.log(`[forBET/Navigation] Fetching events from: ${apiUrl}`);

    const response = await page.evaluate(async (url: string) => {
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
      console.error(`[forBET/Navigation] API error: ${response.error}`);
      return [];
    }

    const events = (response as ForbetEventsResponse)?.data || [];
    console.log(`[forBET/Navigation] Fetched ${events.length} events for ${league}`);
    return events;
  } catch (error) {
    console.error(`[forBET/Navigation] Failed to fetch league events:`, error);
    return [];
  }
}

/**
 * Fetch events for all configured leagues from forBET API
 * Used when searching for a specific event by ID
 *
 * @param page - Playwright page with established session
 * @returns Map of eventId to event data
 */
export async function fetchAllLeagueEvents(
  page: Page
): Promise<Map<string, ForbetEvent>> {
  const allEvents = new Map<string, ForbetEvent>();

  // Fetch all leagues in parallel
  const leaguePromises = Object.entries(CATEGORY_IDS).map(async ([league, categoryId]) => {
    const apiUrl = `${API_BASE_URL}/${categoryId}/events?gamesClass=major`;

    try {
      const response = await page.evaluate(async (url: string) => {
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
        console.warn(`[forBET/Navigation] API error for ${league}: ${response.error}`);
        return [];
      }

      return (response as ForbetEventsResponse)?.data || [];
    } catch (error) {
      console.warn(`[forBET/Navigation] Failed to fetch ${league}:`, error);
      return [];
    }
  });

  const results = await Promise.all(leaguePromises);

  // Merge all events into the map
  for (const events of results) {
    for (const event of events) {
      allEvents.set(String(event.eventId), event);
    }
  }

  console.log(`[forBET/Navigation] Fetched ${allEvents.size} total events across all leagues`);
  return allEvents;
}

/**
 * Fetch detailed data for a single event from forBET API
 * This endpoint returns ALL available markets for the match (not just "major" games)
 *
 * @param page - Playwright page with established session
 * @param eventId - forBET event ID
 * @returns API response with full event data or null on error
 */
export async function fetchEventDetails(
  page: Page,
  eventId: string
): Promise<ForbetEventDetailResponse | null> {
  // forBET API for single event: /rest/market/events/{eventId}
  const apiUrl = `${BASE_URL}/rest/market/events/${eventId}`;

  try {
    console.log(`[forBET/Navigation] Fetching event details for: ${eventId}`);

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
      console.error(`[forBET/Navigation] API error for event ${eventId}: ${response.error}`);
      return null;
    }

    return response as ForbetEventDetailResponse;
  } catch (error) {
    console.error(`[forBET/Navigation] Failed to fetch event details:`, error);
    return null;
  }
}

/**
 * Extract event ID from a forBET event URL
 *
 * @param eventUrl - Full URL to the event page
 * @returns Event ID string or null if not found
 */
export function extractEventIdFromUrl(eventUrl: string): string | null {
  // URL format: https://www.iforbet.pl/wydarzenie/123456
  const match = eventUrl.match(/\/wydarzenie\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Build the canonical event URL from an event ID
 */
export function buildEventUrl(eventId: number | string): string {
  return `${BASE_URL}/wydarzenie/${eventId}`;
}

/**
 * Small delay helper for rate limiting
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
