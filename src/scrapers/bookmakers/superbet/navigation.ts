/**
 * Superbet Navigation Module
 *
 * Handles all Playwright interactions for the Superbet scraper.
 * Responsible for:
 * - Establishing browser sessions
 * - Navigating to pages to set cookies
 * - Fetching data from the Superbet API
 *
 * NOTE: Superbet uses a REST API for data, not DOM scraping.
 * We still need Playwright to establish a valid browser session
 * with cookies before making API requests.
 */

import type { Page } from "playwright";
import {
  API_BASE_URL,
  BASE_URL,
  LEAGUE_URLS,
  SPORT_ID_FOOTBALL,
  TOURNAMENT_IDS,
  REQUEST_TIMEOUT,
} from "./constants.js";
import type {
  SuperbetEventsResponse,
  SuperbetEventDetailResponse,
} from "./types.js";

/**
 * Navigate to the league page to establish session cookies
 * This is required before making API requests
 */
export async function navigateToLeaguePage(
  page: Page,
  league: string
): Promise<boolean> {
  const url = LEAGUE_URLS[league];
  if (!url) {
    console.error(`[Superbet/Navigation] Unknown league: ${league}`);
    return false;
  }

  try {
    console.log(`[Superbet/Navigation] Navigating to: ${url}`);
    await page.goto(url, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[Superbet/Navigation] Failed to navigate:`, error);
    return false;
  }
}

/**
 * Navigate to the base site to establish session
 * Used when fetching individual event details
 */
export async function navigateToBaseSite(page: Page): Promise<boolean> {
  try {
    console.log(`[Superbet/Navigation] Navigating to base site: ${BASE_URL}`);
    await page.goto(BASE_URL, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[Superbet/Navigation] Failed to navigate to base site:`, error);
    return false;
  }
}

/**
 * Fetch events for a league from the Superbet API
 * Executes the API request within the browser context to use session cookies
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns API response with events or null on error
 */
export async function fetchLeagueEvents(
  page: Page,
  league: string
): Promise<SuperbetEventsResponse | null> {
  const tournamentIds = TOURNAMENT_IDS[league];
  if (!tournamentIds || tournamentIds.length === 0) {
    console.error(`[Superbet/Navigation] No tournament ID for league: ${league}`);
    return null;
  }

  const tournamentId = tournamentIds[0];

  try {
    const apiData = await page.evaluate(
      async ({ apiBaseUrl, sportId, tid }) => {
        try {
          const today = new Date().toISOString().split("T")[0];
          // Fetch events up to 2027 to catch all upcoming matches
          const apiUrl = `${apiBaseUrl}/events/by-date?offerState=prematch&startDate=${today}+00:00:00&endDate=2027-12-30+00:00:00&sportId=${sportId}&tournamentIds=${tid}`;
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
      { apiBaseUrl: API_BASE_URL, sportId: SPORT_ID_FOOTBALL, tid: tournamentId }
    );

    if (apiData?.error) {
      console.error(`[Superbet/Navigation] API error: ${apiData.error}`);
    }

    return apiData as SuperbetEventsResponse;
  } catch (error) {
    console.error(`[Superbet/Navigation] Failed to fetch league events:`, error);
    return null;
  }
}

/**
 * Fetch detailed data for a single event
 * This endpoint returns all available markets for the match
 *
 * @param page - Playwright page with established session
 * @param eventId - Superbet event ID
 * @returns API response with full event data or null on error
 */
export async function fetchEventDetails(
  page: Page,
  eventId: string
): Promise<SuperbetEventDetailResponse | null> {
  try {
    console.log(`[Superbet/Navigation] Fetching event details for: ${eventId}`);

    const apiData = await page.evaluate(
      async ({ apiBaseUrl, eid }) => {
        try {
          const apiUrl = `${apiBaseUrl}/events/${eid}`;
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
      { apiBaseUrl: API_BASE_URL, eid: eventId }
    );

    if (apiData?.error) {
      console.error(`[Superbet/Navigation] API error: ${apiData.error}`);
    }

    return apiData as SuperbetEventDetailResponse;
  } catch (error) {
    console.error(`[Superbet/Navigation] Failed to fetch event details:`, error);
    return null;
  }
}

/**
 * Extract event ID from a Superbet event URL
 *
 * @param eventUrl - Full URL to the event page
 * @returns Event ID string or null if not found
 */
export function extractEventIdFromUrl(eventUrl: string): string | null {
  // URL format: https://superbet.pl/zaklady-bukmacherskie/pilka-nozna/123456
  const match = eventUrl.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Build the canonical event URL from an event ID
 */
export function buildEventUrl(eventId: number | string): string {
  return `${BASE_URL}/zaklady-bukmacherskie/pilka-nozna/${eventId}`;
}
