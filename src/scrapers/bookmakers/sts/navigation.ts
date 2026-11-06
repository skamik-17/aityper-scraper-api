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
 * Header line of an STS WebSocket frame, e.g.
 * `{"s":"f_f2921896_pl","n":1793982199183325,"f":1}`.
 * `s` is the subscription; `f: 1` marks a full snapshot, deltas omit it.
 */
interface STSFrameHeader {
  s: string;
  f?: number;
}

/** Subscription of a fixture frame: `f_<fixtureId>_pl` */
const FIXTURE_SUBSCRIPTION = /^f_(f\d+)_pl$/;

/**
 * Parse the header (first line) of a frame. Only the first line is read, so
 * a multi-megabyte i_pl frame costs one short JSON.parse.
 */
function parseFrameHeader(payload: string): STSFrameHeader | null {
  const newline = payload.indexOf("\n");
  const headerLine = newline === -1 ? payload : payload.slice(0, newline);
  try {
    const header: unknown = JSON.parse(headerLine);
    if (
      typeof header === "object" &&
      header !== null &&
      typeof (header as { s?: unknown }).s === "string"
    ) {
      return header as STSFrameHeader;
    }
  } catch {
    // Not an STS header line (ping, binary payload, truncated frame)
  }
  return null;
}

/**
 * True when the frame's header marks a full snapshot (`"f":1`).
 * Delta frames carry the same subscription without `f`.
 */
export function isSnapshotFrame(payload: string): boolean {
  return parseFrameHeader(payload)?.f === 1;
}

/**
 * Record one WebSocket frame into the capture result.
 *
 * - `i_pl` (fixture list + main markets): keep the longest frame.
 * - `f_<fixtureId>_pl` (extended markets): store snapshots only. A newer
 *   snapshot replaces an older one; a delta never replaces a snapshot,
 *   because a delta alone parses to a near-empty market list.
 */
export function recordStsFrame(result: WSCaptureResult, payload: string): void {
  const header = parseFrameHeader(payload);
  if (!header) return;

  if (header.s === "i_pl") {
    if (payload.length > result.initialData.length) {
      result.initialData = payload;
    }
    return;
  }

  const fixtureMatch = FIXTURE_SUBSCRIPTION.exec(header.s);
  if (!fixtureMatch || header.f !== 1) return;

  // The snapshot body is the second line; a header-only frame has no markets
  const bodyStart = payload.indexOf("\n") + 1;
  if (bodyStart === 0) return;
  const bodyEnd = payload.indexOf("\n", bodyStart);
  try {
    const body: unknown = JSON.parse(
      payload.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd)
    );
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      result.fixtureData.set(fixtureMatch[1], body as STSWebSocketData);
    }
  } catch {
    // Incomplete snapshot frame: keep whatever was stored before
  }
}

/** True when a full snapshot frame for the fixture has been recorded */
export function hasFixtureSnapshot(result: WSCaptureResult, fixtureId: string): boolean {
  return result.fixtureData.has(fixtureId);
}

/**
 * Capture a match page until its fixture snapshot arrives.
 * An attempt without the snapshot, or one that failed to navigate (`null`),
 * counts as a miss and is retried. Returns `null` after `attempts` misses,
 * so the caller can skip the match instead of emitting a partial one.
 */
export async function captureMatchWithRetry(
  capture: (eventUrl: string) => Promise<WSCaptureResult | null>,
  eventUrl: string,
  fixtureId: string,
  attempts = 2
): Promise<WSCaptureResult | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await capture(eventUrl);
    if (result && hasFixtureSnapshot(result, fixtureId)) return result;
  }
  return null;
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
      recordStsFrame(result, data);
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

    // Wait for the fixture snapshot. The match page subscribes to
    // f_<fixtureId>_pl; i_pl usually lands first (~0.5 s earlier on live
    // captures), so leaving when i_pl arrives would drop the extended markets.
    await waitForData(() => hasFixtureSnapshot(result, fixtureId), WS_DATA_TIMEOUT);

    const hasSnapshot = hasFixtureSnapshot(result, fixtureId);
    if (!hasSnapshot && !result.initialData) {
      console.error("[STS/Navigation] No WebSocket data received for match");
      return null;
    }

    console.log(
      `[STS/Navigation] Captured match data (fixture: ${fixtureId}, snapshot: ${hasSnapshot ? "yes" : "no"}, initial: ${result.initialData.length} bytes)`
    );
    return result;
  } catch (error) {
    console.error(`[STS/Navigation] Match navigation error:`, error);
    return null;
  }
}
