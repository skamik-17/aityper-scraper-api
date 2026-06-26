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
 * For a single event PZBuk streams the complete offer as a short burst of
 * INITIAL_STATE messages right after navigation. We capture the full offer by:
 * 1. Dismissing the cookie consent popup
 * 2. Accumulating selections from every message (de-duplicated by id)
 * 3. Firing one light expansion trigger (expand every group header + click
 *    every "Pokaż więcej") to surface any genuinely lazy-loaded group
 * 4. Resolving once the stream goes quiet (stream-silence stabilization)
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
  MIN_CAPTURE_MS,
  STREAM_SILENCE_MS,
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
 * Click every visible "Pokaż więcej" (Show more) button to reveal additional
 * markets that PZBuk keeps collapsed inside a group. There can be many such
 * buttons (one per group/sub-section), so we keep clicking the first visible
 * one until none remain.
 *
 * Returns the number of buttons clicked.
 */
async function clickAllShowMore(
  page: Page,
  shouldStop: () => boolean = () => false
): Promise<number> {
  let clicks = 0;
  // Guard against an unexpected infinite loop if a button never disappears.
  for (let i = 0; i < 40; i++) {
    if (shouldStop()) break;
    try {
      const showMore = page.getByText("Pokaż więcej").first();
      if (!(await showMore.isVisible({ timeout: 300 }).catch(() => false))) {
        break;
      }
      await showMore.click({ timeout: 3000 }).catch(() => {});
      clicks++;
      // Small delay to allow lazy WebSocket subscription to respond
      await page.waitForTimeout(60);
    } catch {
      break;
    }
  }
  return clicks;
}

/**
 * Expand EVERY collapsed market group header to trigger PZBuk's lazy
 * WebSocket subscriptions.
 *
 * Rather than relying on a brittle hard-coded allowlist of Polish group
 * names (which silently misses groups like "Zawodnicy"/"Popularne" and lists
 * groups that no longer exist), we enumerate every group header in the DOM
 * and click each one.
 *
 * Note: captured selections are accumulated across messages and never
 * discarded, so even if a click toggles an already-expanded group closed, the
 * subscription has already fired and its data has been captured. Clicking an
 * even number of times therefore never loses data.
 *
 * Returns the number of headers clicked.
 */
async function expandAllMarketGroups(
  page: Page,
  shouldStop: () => boolean = () => false
): Promise<number> {
  let clicks = 0;
  try {
    const headers = page.locator('[class*="content-box__HeaderContainer"]');
    const count = await headers.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      if (shouldStop()) break;
      try {
        const header = headers.nth(i);
        if (await header.isVisible({ timeout: 300 }).catch(() => false)) {
          await header.click({ timeout: 3000 }).catch(() => {});
          clicks++;
          // Small delay to allow lazy WebSocket subscription to respond
          await page.waitForTimeout(60);
        }
      } catch {
        // Header not clickable - continue with the rest
      }
    }
  } catch {
    // No headers found - nothing to expand
  }
  return clicks;
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
 * 3. Fires one expansion trigger (all group headers + all "Pokaż więcej")
 * 4. Waits for stream-silence stabilization before returning
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

    // Set up WebSocket listener
    const wsHandler = (ws: PlaywrightWebSocket) => {
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
    };
    page.on("websocket", wsHandler);

    const startTime = Date.now();

    if (singleEvent) {
      // Match-details mode.
      //
      // PZBuk streams the complete offer for an event over a short burst of
      // INITIAL_STATE messages right after navigation. We capture the whole
      // offer by waiting until that burst goes quiet (stream-silence based),
      // which is reliable for the first event AND for subsequent events whose
      // burst can arrive more slowly.
      //
      // We additionally fire a single, light "expansion" trigger (expand every
      // group header + click every "Pokaż więcej") to surface any group that
      // genuinely lazy-loads. Captured selections are accumulated and never
      // discarded, so this can only add data. We deliberately avoid repeated
      // heavy clicking, which was observed to disrupt the stream for the next
      // event navigated on the same page.
      void (async () => {
        const finish = () => {
          if (resolved) return;
          resolved = true;
          // Detach the websocket listener so a later capture on the same page
          // is not processed by this (now stale) closure.
          page.off("websocket", wsHandler);
          console.log(
            `[PZBuk/WS] Single-event capture complete with ${accumulatedSelections.size} selections`
          );
          resolve(bestState);
        };

        // Allows the expansion helpers to bail out promptly once we resolve.
        const shouldStop = () => resolved;

        // Hard safety cap independent of the loop below.
        const hardCap = setTimeout(finish, WS_MAX_WAIT);

        try {
          // Let the initial event feed begin, then clear the cookie banner.
          await delay(2000);
          await dismissCookieConsent(page).catch(() => {});

          let expansionTriggered = false;

          // Stabilization loop: resolve when the stream has been quiet for
          // STREAM_SILENCE_MS after the minimum capture window, or at the hard
          // cap.
          while (!resolved) {
            const elapsed = Date.now() - startTime;
            const silence = Date.now() - lastUpdateTime;

            if (elapsed >= WS_MAX_WAIT) break;

            // Fire the one-shot expansion trigger once the first burst has
            // settled a little, to surface any lazy-loaded groups.
            if (!expansionTriggered && elapsed >= 3000) {
              expansionTriggered = true;
              const expanded = await expandAllMarketGroups(page, shouldStop).catch(
                () => 0
              );
              const shown = await clickAllShowMore(page, shouldStop).catch(
                () => 0
              );
              if (expanded > 0 || shown > 0) {
                console.log(
                  `[PZBuk/WS] Expansion trigger: expanded ${expanded} headers, clicked ${shown} "Pokaż więcej"`
                );
              }
              continue;
            }

            // Resolve once the burst has gone quiet, but never before the
            // minimum capture window (subsequent events can stream slowly).
            if (
              accumulatedSelections.size > 0 &&
              elapsed >= MIN_CAPTURE_MS &&
              silence >= STREAM_SILENCE_MS
            ) {
              break;
            }

            await delay(300);
          }
        } catch {
          // Best-effort - resolve with whatever we captured.
        } finally {
          clearTimeout(hardCap);
          finish();
        }
      })();
      return;
    }

    // League-listing mode: poll until we have a multi-event snapshot.
    const checkInterval = setInterval(() => {
      if (resolved) {
        clearInterval(checkInterval);
        return;
      }

      const elapsed = Date.now() - startTime;

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

      // Maximum timeout
      if (elapsed >= WS_MAX_WAIT) {
        console.log(
          `[PZBuk/WS] Max wait reached with ${bestState?.selections?.length || 0} selections`
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
