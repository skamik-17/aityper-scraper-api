/**
 * STS Navigation Module
 *
 * Handles all Playwright interactions for the STS scraper.
 * Responsible for:
 * - WebSocket interception and data capture
 * - Cookie consent handling
 * - Page navigation
 *
 * NOTE: STS uses WebSocket for real-time odds data.
 * We intercept WebSocket frames to extract JSON data.
 */

import type { Page, WebSocket } from "playwright";
import {
  BASE_URL,
  COOKIE_BUTTON_TEXT,
  LEAGUE_CONFIG,
  REQUEST_TIMEOUT,
  WS_DATA_TIMEOUT,
  WS_POLL_INTERVAL,
  WS_URL_PATTERN,
} from "./constants.js";
import type { WSCaptureResult, STSWebSocketData } from "./types.js";

/**
 * Convert team name to URL slug (e.g., "Manchester United" -> "manchester-united")
 * Used to construct /kursy/ URLs for match detail pages
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the event URL from team names and fixture ID
 */
export function buildEventUrl(
  homeTeam: string,
  awayTeam: string,
  fixtureId: string
): string {
  const homeSlug = slugify(homeTeam);
  const awaySlug = slugify(awayTeam);
  return `${BASE_URL}/kursy/${homeSlug}-${awaySlug}/${fixtureId}`;
}

/**
 * Extract fixture ID from a STS event URL
 * URL format: https://www.sts.pl/kursy/team-team/f1234567
 *
 * @param eventUrl - Full URL to the event page
 * @returns Fixture ID string (e.g., "f1234567") or empty string if not found
 */
export function extractFixtureIdFromUrl(eventUrl: string): string {
  const match = eventUrl.match(/f(\d+)/);
  return match ? `f${match[1]}` : "";
}

/**
 * Accept cookie consent if the dialog is visible
 */
async function handleCookieConsent(page: Page): Promise<void> {
  try {
    const cookieButton = page.locator(`text=${COOKIE_BUTTON_TEXT}`).first();
    if (await cookieButton.isVisible({ timeout: 2000 })) {
      await cookieButton.click();
    }
  } catch {
    // Cookie dialog not present or already accepted
  }
}

/**
 * Wait for WebSocket data with polling and early exit
 *
 * @param checkCondition - Function that returns true when data is ready
 * @param maxWait - Maximum wait time in milliseconds
 * @param pollInterval - Interval between checks in milliseconds
 */
async function waitForData(
  checkCondition: () => boolean,
  maxWait: number = WS_DATA_TIMEOUT,
  pollInterval: number = WS_POLL_INTERVAL
): Promise<void> {
  const iterations = Math.ceil(maxWait / pollInterval);
  for (let i = 0; i < iterations; i++) {
    if (checkCondition()) break;
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Set up WebSocket listener for capturing STS data
 * Returns captured data through the result object
 */
function setupWebSocketCapture(page: Page, result: WSCaptureResult): void {
  page.on("websocket", (ws: WebSocket) => {
    if (!ws.url().includes(WS_URL_PATTERN)) return;

    ws.on("framereceived", (frame) => {
      const data = typeof frame.payload === "string" ? frame.payload : "";

      // Capture initial data (largest message with "i_pl" subscription)
      // This contains the fixture list with team names
      if (data.includes('"s":"i_pl"') && data.length > result.initialData.length) {
        result.initialData = data;
      }

      // Capture fixture-specific data (contains extended markets)
      // Format: "s":"f_{fixtureId}_pl"
      const fixtureMatch = data.match(/"s":"f_(f\d+)_pl"/);
      if (fixtureMatch && data.length > 1000) {
        try {
          const lines = data.split("\n");
          const jsonData = JSON.parse(lines[1] || lines[0]) as STSWebSocketData;
          result.fixtureData.set(fixtureMatch[1], jsonData);
        } catch {
          // Ignore parse errors for incomplete frames
        }
      }
    });
  });
}

/**
 * Navigate to league page and capture WebSocket data
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Captured WebSocket data or null on error
 */
export async function navigateAndCaptureLeagueData(
  page: Page,
  league: string
): Promise<WSCaptureResult | null> {
  const config = LEAGUE_CONFIG[league];
  if (!config) {
    console.error(`[STS/Navigation] Unknown league: ${league}`);
    return null;
  }

  // Initialize capture result
  const result: WSCaptureResult = {
    initialData: "",
    fixtureData: new Map(),
  };

  // Clean up any existing WebSocket listeners to prevent accumulation
  page.removeAllListeners("websocket");

  // Set up WebSocket capture before navigation
  setupWebSocketCapture(page, result);

  try {
    console.log(`[STS/Navigation] Navigating to: ${config.url}`);
    await page.goto(config.url, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });

    // Wait for page to stabilize
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Handle cookie consent
    await handleCookieConsent(page);

    // Wait for WebSocket data with early exit
    // Initial data should be at least 10KB to contain fixture info
    await waitForData(() => result.initialData.length > 10000);

    if (!result.initialData) {
      console.error("[STS/Navigation] No WebSocket data received");
      return null;
    }

    console.log(
      `[STS/Navigation] Captured ${result.initialData.length} bytes of initial data`
    );
    return result;
  } catch (error) {
    console.error(`[STS/Navigation] Navigation error:`, error);
    return null;
  }
}

/**
 * Navigate to match detail page and capture WebSocket data
 * This page triggers fixture-specific WebSocket subscription with extended markets
 *
 * @param page - Playwright page with established session
 * @param eventUrl - Full URL to the match page
 * @returns Captured WebSocket data or null on error
 */
export async function navigateAndCaptureMatchData(
  page: Page,
  eventUrl: string
): Promise<WSCaptureResult | null> {
  const fixtureId = extractFixtureIdFromUrl(eventUrl);

  // Initialize capture result
  const result: WSCaptureResult = {
    initialData: "",
    fixtureData: new Map(),
  };

  // Clean up any existing WebSocket listeners to prevent accumulation
  page.removeAllListeners("websocket");

  // Set up WebSocket capture before navigation
  setupWebSocketCapture(page, result);

  try {
    console.log(`[STS/Navigation] Navigating to match: ${eventUrl}`);
    await page.goto(eventUrl, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });

    // Wait for page to stabilize
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Handle cookie consent
    await handleCookieConsent(page);

    // Wait for fixture-specific data or initial data
    // The match page triggers subscription for the specific fixture
    // Increased timeout from 5s to 10s for slower connections
    await waitForData(
      () =>
        (fixtureId && result.fixtureData.has(fixtureId)) ||
        result.initialData.length > 100000,
      10000
    );

    if (!result.fixtureData.has(fixtureId) && !result.initialData) {
      console.error("[STS/Navigation] No WebSocket data received for match");
      return null;
    }

    console.log(
      `[STS/Navigation] Captured match data (fixture: ${fixtureId}, initial: ${result.initialData.length} bytes)`
    );
    return result;
  } catch (error) {
    console.error(`[STS/Navigation] Match navigation error:`, error);
    return null;
  }
}
