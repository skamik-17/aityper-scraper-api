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
} from "./constants.js";
import type { EtotoEvent } from "./types.js";

// In-memory cache for events data

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
 * Build the canonical event URL from an event ID
 */
export function buildEventUrl(eventId: number | string): string {
  return `${BASE_URL}/zaklady-bukmacherskie/wydarzenie/${eventId}`;
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

    return response as EtotoEventDetailResponse;
  } catch (error) {
    console.error(`[eToto/Navigation] Failed to fetch event details:`, error);
    return null;
  }
}
