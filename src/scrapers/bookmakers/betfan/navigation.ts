/**
 * Betfan Navigation Module
 *
 * Handles all Playwright interactions for the Betfan scraper.
 * Responsible for:
 * - Establishing browser sessions
 * - Navigating to pages to set cookies
 * - Fetching data from the Betfan API
 *
 * NOTE: Betfan uses a REST API for data, not DOM scraping.
 * We still need Playwright to establish a valid browser session
 * with cookies before making API requests.
 */

import type { Page } from "playwright";
import {
  BASE_URL,
  CATEGORY_IDS,
  REQUEST_TIMEOUT,
} from "./constants.js";
import type { BetfanEvent } from "./types.js";

/**
 * Navigate to the base Betfan site to establish session cookies
 * This is required before making API requests
 */
export async function navigateToBaseSite(page: Page): Promise<boolean> {
  try {
    console.log(`[Betfan/Navigation] Navigating to base site: ${BASE_URL}`);
    await page.goto(BASE_URL, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[Betfan/Navigation] Failed to navigate to base site:`, error);
    return false;
  }
}

/**
 * Fetch events for a league from the Betfan API
 * Executes the API request within the browser context to use session cookies
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Array of events or empty array on error
 */
export async function fetchLeagueEvents(
  page: Page,
  league: string
): Promise<BetfanEvent[]> {
  const categoryId = CATEGORY_IDS[league];
  if (!categoryId) {
    console.error(`[Betfan/Navigation] Unknown league: ${league}`);
    return [];
  }

  try {
    console.log(`[Betfan/Navigation] Fetching events for category: ${categoryId}`);

    const events = await page.evaluate(async (catId) => {
      try {
        const res = await fetch(
          `https://betfan.pl/api/v1/market/categories/${catId}/events`
        );
        const data = await res.json();
        return data?.data?.categories?.[0]?.events || [];
      } catch {
        return [];
      }
    }, categoryId);

    console.log(`[Betfan/Navigation] Fetched ${events.length} events`);
    return events as BetfanEvent[];
  } catch (error) {
    console.error(`[Betfan/Navigation] Failed to fetch league events:`, error);
    return [];
  }
}

/**
 * Fetch detailed data for a single event
 * This endpoint returns ALL available markets for the match (397+ markets)
 * compared to the listing API which only returns ~34 markets
 *
 * @param page - Playwright page with established session
 * @param eventId - Betfan event ID
 * @returns Event with full market data or null on error
 */
export async function fetchEventDetails(
  page: Page,
  eventId: string
): Promise<BetfanEvent | null> {
  try {
    console.log(`[Betfan/Navigation] Fetching event details for: ${eventId}`);

    const result = await page.evaluate(async (eid) => {
      try {
        const res = await fetch(`https://betfan.pl/api/v1/market/events/${eid}`);
        if (res.status !== 200) {
          return { error: `HTTP ${res.status}`, event: null };
        }
        const data = await res.json();
        return { error: null, event: data?.data?.event || null };
      } catch (err) {
        return { error: String(err), event: null };
      }
    }, eventId);

    if (result.error) {
      console.error(`[Betfan/Navigation] API error: ${result.error}`);
      return null;
    }

    if (result.event) {
      console.log(
        `[Betfan/Navigation] Fetched event with ${result.event.games?.length || 0} games`
      );
    }

    return result.event as BetfanEvent | null;
  } catch (error) {
    console.error(`[Betfan/Navigation] Failed to fetch event details:`, error);
    return null;
  }
}

/**
 * Build the canonical event URL from an event ID
 */
export function buildEventUrl(eventId: number | string): string {
  return `${BASE_URL}/wydarzenie/${eventId}`;
}
