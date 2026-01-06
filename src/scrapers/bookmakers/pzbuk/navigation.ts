/**
 * PZBuk Navigation Module
 *
 * Handles all Playwright interactions for the PZBuk scraper.
 * Responsible for:
 * - Navigating to league/event pages
 * - Capturing WebSocket/RSocket data
 * - Expanding market sections to load all available markets
 *
 * NOTE: PZBuk uses WebSocket with RSocket protocol for real-time data.
 * We intercept WebSocket frames to capture INITIAL_STATE messages
 * containing all events, markets, and selections.
 *
 * PZBuk loads markets lazily - initial page load only shows a subset.
 * To get all markets, we need to:
 * 1. Dismiss the cookie consent popup
 * 2. Click "Pokaż więcej" (Show more) button
 * 3. Accumulate selections from multiple WebSocket messages
 */

import type { Page, WebSocket as PlaywrightWebSocket } from "playwright";
import type { PZBukInitialState, PZBukSelection } from "./types.js";
import {
  LEAGUE_URLS,
  WEBSOCKET_URL_PATTERN,
  WS_POLL_INTERVAL,
  WS_MIN_WAIT,
  WS_MAX_WAIT,
  REQUEST_TIMEOUT,
  MIN_SELECTIONS_FOR_FULL_OFFER,
} from "./constants.js";

/**
 * Dismiss the OneTrust cookie consent popup if present
 */
async function dismissCookieConsent(page: Page): Promise<void> {
  try {
    // Try to click "Accept All" or similar button
    const acceptButtonSelectors = [
      '#onetrust-accept-btn-handler',
      'button[id*="accept"]',
      'button:has-text("Akceptuję")',
      'button:has-text("Accept")',
      'button:has-text("Zgadzam się")',
    ];

    for (const selector of acceptButtonSelectors) {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        await button.click();
        console.log("[PZBuk/Navigation] Dismissed cookie consent popup");
        await page.waitForTimeout(500);
        return;
      }
    }

    // If no accept button found, try to close the popup
    const closeButton = page.locator('[class*="onetrust"] button[aria-label="Close"]').first();
    if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeButton.click();
      console.log("[PZBuk/Navigation] Closed cookie consent popup");
      await page.waitForTimeout(500);
    }
  } catch {
    // Cookie consent not present or already dismissed - that's fine
  }
}

/**
 * Click "Pokaż więcej" (Show more) to load all markets
 * Returns true if the button was clicked
 */
async function clickShowMore(page: Page): Promise<boolean> {
  try {
    const showMore = page.getByText("Pokaż więcej").first();
    if (await showMore.isVisible({ timeout: 500 }).catch(() => false)) {
      await showMore.click({ timeout: 5000 });
      return true;
    }
  } catch {
    // Button not found or click failed
  }
  return false;
}

/**
 * Market groups to expand to load additional data
 * These are the group headers that contain collapsed markets
 */
const MARKET_GROUPS_TO_EXPAND = [
  "Strzelcy",       // Goalscorers - adds ~114 selections
  "1 połowa",       // First half - adds ~59 selections
  "Gole",           // Goals - adds ~71 selections
  "Rzuty rożne",    // Corners - adds ~45 selections
  "Dokładny wynik", // Exact score - adds ~37 selections
  "Kartki",         // Cards - adds ~49 selections
  "Drużynowe",      // Team markets - adds ~24 selections
  "2 połowa",       // Second half - adds ~68 selections
  "Kombo",          // Combos - adds ~74 selections
  "Specjalne",      // Specials - adds ~12 selections
];

/**
 * Expand all collapsed market groups to trigger WebSocket data loading
 * PZBuk loads market data lazily when groups are expanded
 */
async function expandMarketGroups(page: Page): Promise<number> {
  let expandedCount = 0;

  for (const groupName of MARKET_GROUPS_TO_EXPAND) {
    try {
      // Find the group header by text content
      const header = page.locator('[class*="content-box__HeaderContainer"]').filter({
        hasText: groupName,
      }).first();

      if (await header.isVisible({ timeout: 500 }).catch(() => false)) {
        await header.click();
        expandedCount++;
        // Small delay to allow WebSocket response
        await page.waitForTimeout(300);
      }
    } catch {
      // Group not found or click failed - continue with others
    }
  }

  return expandedCount;
}

/**
 * Navigate to a league page to establish WebSocket connection
 *
 * @param page - Playwright page instance
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Promise<boolean> - true if navigation succeeded
 */
export async function navigateToLeaguePage(
  page: Page,
  league: string
): Promise<boolean> {
  const url = LEAGUE_URLS[league];
  if (!url) {
    console.error(`[PZBuk/Navigation] Unknown league: ${league}`);
    return false;
  }

  try {
    console.log(`[PZBuk/Navigation] Navigating to: ${url}`);
    await page.goto(url, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[PZBuk/Navigation] Failed to navigate:`, error);
    return false;
  }
}

/**
 * Navigate to a specific event page
 *
 * @param page - Playwright page instance
 * @param eventUrl - Full URL to the event page
 * @returns Promise<boolean> - true if navigation succeeded
 */
export async function navigateToEventPage(
  page: Page,
  eventUrl: string
): Promise<boolean> {
  try {
    console.log(`[PZBuk/Navigation] Navigating to event: ${eventUrl}`);
    await page.goto(eventUrl, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[PZBuk/Navigation] Failed to navigate to event:`, error);
    return false;
  }
}

/**
 * Capture WebSocket data from PZBuk's RSocket stream
 *
 * Sets up WebSocket interception and waits for INITIAL_STATE messages
 * containing event, market, and selection data.
 *
 * For single event (match details) mode, this function:
 * 1. Accumulates selections from multiple WebSocket messages
 * 2. Dismisses cookie consent popup
 * 3. Clicks "Pokaż więcej" to load all markets
 * 4. Waits for data stabilization before returning
 *
 * @param page - Playwright page with WebSocket listeners
 * @param singleEvent - If true, wait for single event with many selections (match details mode)
 * @returns Promise with captured state or null on timeout
 */
export async function captureWebSocketData(
  page: Page,
  singleEvent = false
): Promise<PZBukInitialState | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let bestState: PZBukInitialState | null = null;
    let lastUpdateTime = Date.now();

    // For single event mode, accumulate selections across messages
    const accumulatedSelections = new Map<string, PZBukSelection>();
    let eventData: PZBukInitialState["events"] | null = null;
    let marketData: PZBukInitialState["markets"] | null = null;
    let showMoreClicked = false;
    let cookieDismissed = false;

    // Set up WebSocket listener
    page.on("websocket", (ws: PlaywrightWebSocket) => {
      // Only listen to the sportsbook API WebSocket
      if (!ws.url().includes(WEBSOCKET_URL_PATTERN)) return;

      ws.on("framereceived", (frame) => {
        if (resolved) return;

        try {
          const payload = frame.payload.toString();
          // RSocket frames have binary header, find JSON array start
          const jsonStart = payload.indexOf("[{");
          if (jsonStart === -1) return;

          const jsonStr = payload.slice(jsonStart);
          const data = JSON.parse(jsonStr);

          // Look for INITIAL_STATE message with events and selections
          if (Array.isArray(data) && data[0]?.type === "INITIAL_STATE") {
            const state = data[0].payload as PZBukInitialState;

            if (state?.events?.length > 0) {
              // Track when we last received data
              lastUpdateTime = Date.now();

              if (singleEvent) {
                // For match details: accumulate selections from single-event messages
                if (state.events.length === 1) {
                  // Store event and market data
                  if (!eventData) {
                    eventData = state.events;
                  }
                  if (state.markets?.length > 0 && (!marketData || state.markets.length > marketData.length)) {
                    marketData = state.markets;
                  }

                  // Accumulate selections by ID to avoid duplicates
                  if (state.selections?.length > 0) {
                    for (const sel of state.selections) {
                      if (sel.status === "Active") {
                        accumulatedSelections.set(sel.id, sel);
                      }
                    }

                    console.log(
                      `[PZBuk/WS] Received ${state.selections.length} selections, total accumulated: ${accumulatedSelections.size}`
                    );

                    // Update bestState with accumulated data
                    bestState = {
                      events: eventData,
                      markets: marketData || [],
                      selections: Array.from(accumulatedSelections.values()),
                    };
                  }

                  // Immediate exit if we have a very large number of selections
                  if (accumulatedSelections.size >= MIN_SELECTIONS_FOR_FULL_OFFER * 4) {
                    console.log(
                      `[PZBuk/WS] Large dataset captured: ${accumulatedSelections.size} selections`
                    );
                    resolved = true;
                    resolve(bestState);
                  }
                }
              } else {
                // For league listing: want multiple events
                if (state.events.length > 1 && state.selections?.length > 0) {
                  bestState = state;
                  resolved = true;
                  resolve(state);
                }
              }
            }
          }
        } catch {
          // Not valid JSON or parsing error - ignore
        }
      });
    });

    // Polling with stabilization - wait for data to stop streaming in
    const startTime = Date.now();
    const checkInterval = setInterval(async () => {
      if (resolved) {
        clearInterval(checkInterval);
        return;
      }

      const elapsed = Date.now() - startTime;
      const timeSinceLastUpdate = Date.now() - lastUpdateTime;

      // For single event mode (match details)
      if (singleEvent) {
        // Dismiss cookie consent popup after initial load
        if (!cookieDismissed && elapsed > 1500) {
          cookieDismissed = true;
          try {
            await dismissCookieConsent(page);
          } catch {
            // Ignore errors
          }
        }

        // Expand market groups to load all markets (after cookie is dismissed)
        if (cookieDismissed && !showMoreClicked && elapsed > 2000) {
          showMoreClicked = true;
          try {
            const expandedCount = await expandMarketGroups(page);
            if (expandedCount > 0) {
              console.log(`[PZBuk/WS] Expanded ${expandedCount} market groups`);
              // Reset the lastUpdateTime to wait for new data
              lastUpdateTime = Date.now();
            }
          } catch {
            // Ignore errors
          }
        }

        // If we have enough selections and data has stabilized, resolve
        if (
          bestState &&
          accumulatedSelections.size >= MIN_SELECTIONS_FOR_FULL_OFFER &&
          timeSinceLastUpdate >= 3000 // Data has stabilized for 3 seconds
        ) {
          console.log(
            `[PZBuk/WS] Data stabilized with ${accumulatedSelections.size} selections`
          );
          resolved = true;
          clearInterval(checkInterval);
          resolve(bestState);
          return;
        }

        // Early exit if we have good data and waited long enough
        // Increased minimum wait from 3s to 8s to allow for show more click
        if (
          elapsed >= 8000 &&
          bestState &&
          accumulatedSelections.size > 0 &&
          timeSinceLastUpdate >= 2000
        ) {
          console.log(
            `[PZBuk/WS] Early exit with ${accumulatedSelections.size} selections after ${elapsed}ms`
          );
          resolved = true;
          clearInterval(checkInterval);
          resolve(bestState);
          return;
        }
      } else {
        // For league listing: exit early if we have good data after minimum wait
        if (
          elapsed >= WS_MIN_WAIT &&
          bestState &&
          bestState.events?.length > 0 &&
          bestState.selections?.length > 0
        ) {
          resolved = true;
          clearInterval(checkInterval);
          resolve(bestState);
          return;
        }
      }

      // Maximum timeout
      if (elapsed >= WS_MAX_WAIT) {
        console.log(
          `[PZBuk/WS] Max wait reached with ${accumulatedSelections.size || bestState?.selections?.length || 0} selections`
        );
        resolved = true;
        clearInterval(checkInterval);
        resolve(bestState);
      }
    }, WS_POLL_INTERVAL);
  });
}

/**
 * Build the canonical event URL from event data
 *
 * @param eventId - PZBuk event ID
 * @param homeTeam - Home team name
 * @param awayTeam - Away team name
 * @param leagueId - League ID
 * @param leagueName - League name for slug
 * @returns Full URL to the event page
 */
export function buildEventUrl(
  eventId: string,
  homeTeam: string,
  awayTeam: string,
  leagueId: string,
  leagueName: string
): string {
  const slug = `${homeTeam}-${awayTeam}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const leagueSlug =
    leagueName
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown";

  return `https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/${leagueId}-${leagueSlug}/events/${eventId}-${slug}`;
}

/**
 * Helper delay function
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
