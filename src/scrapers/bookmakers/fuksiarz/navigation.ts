/**
 * Fuksiarz Navigation Module
 *
 * Handles all Playwright interactions for the Fuksiarz scraper.
 * Responsible for:
 * - Establishing browser sessions
 * - Navigating to pages to set cookies
 * - Fetching data from the Fuksiarz REST API
 *
 * NOTE: Fuksiarz uses a REST API for data, not DOM scraping.
 * We still need Playwright to establish a valid browser session
 * before making API requests via page.evaluate.
 */

import type { Page } from "playwright";
import {
  API_BASE_URL,
  BASE_URL,
  CATEGORY_IDS,
  REQUEST_TIMEOUT,
} from "./constants.js";
import type { FuksiarzEventsResponse, FuksiarzEvent, FuksiarzEventDetailResponse } from "./types.js";

/**
 * Navigate to the base site to establish session cookies
 * This is required before making API requests
 */
export async function navigateToBaseSite(page: Page): Promise<boolean> {
  try {
    console.log(`[Fuksiarz/Navigation] Navigating to: ${BASE_URL}`);
    await page.goto(BASE_URL, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[Fuksiarz/Navigation] Failed to navigate to base site:`, error);
    return false;
  }
}

/**
 * Fetch events for a league from the Fuksiarz API
 * Executes the API request within the browser context to use session cookies
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Array of Fuksiarz events or empty array on error
 */
export async function fetchLeagueEvents(
  page: Page,
  league: string
): Promise<FuksiarzEvent[]> {
  const categoryId = CATEGORY_IDS[league];
  if (!categoryId) {
    console.error(`[Fuksiarz/Navigation] Unknown league: ${league}`);
    return [];
  }

  try {
    console.log(`[Fuksiarz/Navigation] Fetching category ${categoryId} for ${league}`);

    const events = await page.evaluate(async (catId) => {
      try {
        const res = await fetch(
          `https://fuksiarz.pl/rest/market/categories/multi/${catId}/events`
        );
        if (!res.ok) {
          return [];
        }
        const data = await res.json();
        return data?.data || [];
      } catch {
        return [];
      }
    }, categoryId);

    return events as FuksiarzEvent[];
  } catch (error) {
    console.error(`[Fuksiarz/Navigation] Failed to fetch league events:`, error);
    return [];
  }
}

/**
 * Fetch events from all supported leagues
 * Used when looking for a specific event across leagues
 *
 * @param page - Playwright page with established session
 * @returns Map of eventId to event data
 */
export async function fetchAllLeagueEvents(
  page: Page
): Promise<Map<string, FuksiarzEvent>> {
  const allEvents = new Map<string, FuksiarzEvent>();

  // Fetch all leagues in parallel
  const results = await Promise.all(
    Object.values(CATEGORY_IDS).map(async (categoryId) => {
      try {
        const events = await page.evaluate(async (catId) => {
          try {
            const res = await fetch(
              `https://fuksiarz.pl/rest/market/categories/multi/${catId}/events`
            );
            if (!res.ok) return [];
            const data = await res.json();
            return data?.data || [];
          } catch {
            return [];
          }
        }, categoryId);
        return events as FuksiarzEvent[];
      } catch {
        return [];
      }
    })
  );

  // Merge all results into the map
  for (const events of results) {
    for (const event of events) {
      allEvents.set(String(event.eventId), event);
    }
  }

  return allEvents;
}

/**
 * Fetch detailed data for a single event from Fuksiarz API
 * This endpoint returns ALL available markets for the match (not just listing data)
 *
 * API endpoint: https://fuksiarz.pl/rest/market/events/{eventId}
 *
 * @param page - Playwright page with established session
 * @param eventId - Fuksiarz event ID
 * @returns API response with full event data or null on error
 */
export async function fetchEventDetails(
  page: Page,
  eventId: string
): Promise<FuksiarzEventDetailResponse | null> {
  const apiUrl = `${BASE_URL}/rest/market/events/${eventId}`;

  try {
    console.log(`[Fuksiarz/Navigation] Fetching event details for: ${eventId}`);

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
      console.error(`[Fuksiarz/Navigation] API error for event ${eventId}: ${response.error}`);
      return null;
    }

    return response as FuksiarzEventDetailResponse;
  } catch (error) {
    console.error(`[Fuksiarz/Navigation] Failed to fetch event details:`, error);
    return null;
  }
}

/**
 * Extract event ID from a Fuksiarz event URL
 *
 * @param eventUrl - Full URL to the event page
 * @returns Event ID string or null if not found
 */
export function extractEventIdFromUrl(eventUrl: string): string | null {
  // URL format: https://fuksiarz.pl/szczegoly/123456
  const match = eventUrl.match(/\/szczegoly\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Build the canonical event URL from an event ID
 */
export function buildEventUrl(eventId: number | string): string {
  return `${BASE_URL}/szczegoly/${eventId}`;
}

/**
 * Check if the league is supported by Fuksiarz scraper
 */
export function isLeagueSupported(league: string): boolean {
  return league in CATEGORY_IDS;
}
