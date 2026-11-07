/**
 * PZBuk Navigation Module
 *
 * Handles all Playwright interactions for the PZBuk scraper.
 * Responsible for:
 * - Navigating to league/event pages
 * - Capturing the sportsbook WebSocket stream
 * - Expanding market sections to load all available markets
 *
 * NOTE: PZBuk streams its offer over a WebSocket that speaks UTF-8 JSON
 * envelopes (`sportsbook-api/ws`). Frame decoding, chunk reassembly and the
 * per-event market union live in the pure `ws-protocol.ts`; this module only
 * wires them to Playwright and records what each capture saw.
 *
 * For a single event the page opens one stream per market group. We capture
 * the full offer by:
 * 1. Dismissing the cookie consent popup
 * 2. Merging every single-event INITIAL_STATE of the expected event
 * 3. Firing one light expansion trigger (expand every group header that is not
 *    already subscribed + click every "Pokaż więcej") so each group subscribes
 * 4. Resolving once the stream goes quiet (stream-silence stabilization)
 */

import type { Page, WebSocket as PlaywrightWebSocket } from "playwright";
import type { PZBukInitialState } from "./types.js";
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
import {
  decodeFrame,
  initialStatesOf,
  subscribedGroupIds,
  FrameAssembler,
  SingleEventAccumulator,
  emptyDiagnostics,
  isEmptyListing,
  type CaptureDiagnostics,
} from "./ws-protocol.js";

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
 * A click on an open group collapses it and sends `CLOSE` for its stream,
 * which cancels the group if it has not answered yet (the default-open
 * "Popularne" group under load). The headers carry no `aria-expanded`, so
 * `skipHeader` decides from the header text: a header whose group is already
 * subscribed or answered is not clicked. If the text cannot be read, the
 * header is clicked as before.
 */
async function expandAllMarketGroups(
  page: Page,
  shouldStop: () => boolean = () => false,
  skipHeader?: (headerText: string) => boolean
): Promise<{ clicked: number; skipped: number }> {
  let clicked = 0;
  let skipped = 0;
  try {
    const headers = page.locator('[class*="content-box__HeaderContainer"]');
    const count = await headers.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      if (shouldStop()) break;
      try {
        const header = headers.nth(i);
        if (await header.isVisible({ timeout: 300 }).catch(() => false)) {
          if (skipHeader) {
            const text = await header.innerText({ timeout: 300 }).catch(() => null);
            if (text !== null && skipHeader(text)) {
              skipped++;
              continue;
            }
          }
          await header.click({ timeout: 3000 }).catch(() => {});
          clicked++;
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
  return { clicked, skipped };
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

/** What one capture produced: the snapshot (null if none) and what it saw on the wire. */
export interface CaptureResult {
  state: PZBukInitialState | null;
  diagnostics: CaptureDiagnostics;
}

function frameText(payload: string | Buffer): string {
  return Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload);
}

/**
 * Capture PZBuk's sportsbook WebSocket stream.
 *
 * Listens for sockets whose URL contains `WEBSOCKET_URL_PATTERN`, reassembles
 * chunked frames, decodes the JSON envelopes and records every step in
 * `diagnostics`, so a failed capture can name its cause
 * (`describeCaptureFailure`). Delta messages are ignored: the result is the
 * INITIAL_STATE snapshot.
 *
 * League mode resolves on the first INITIAL_STATE with at least one event and
 * one selection, with `state: null` once the socket has answered an empty
 * listing (after `WS_MIN_WAIT`), or with `state: null` at `WS_MAX_WAIT`.
 *
 * Single-event mode (match details) merges the single-event INITIAL_STATE
 * payloads of `expectedEventId` (any event when omitted) across the page's
 * market-group streams:
 * 1. Dismisses the cookie consent popup
 * 2. Fires one expansion trigger (group headers that are not yet subscribed +
 *    all "Pokaż więcej")
 * 3. Resolves once the stream has been quiet for `STREAM_SILENCE_MS` after
 *    `MIN_CAPTURE_MS`, or at `WS_MAX_WAIT`
 *
 * Both modes always resolve by `WS_MAX_WAIT` and detach their listeners.
 *
 * @param page - Playwright page, before navigation
 * @param singleEvent - If true, capture one event's full offer (match details mode)
 * @param expectedEventId - Single-event mode only: reject payloads of any other event
 */
export async function captureWebSocketData(
  page: Page,
  singleEvent = false,
  expectedEventId?: number | string
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const diagnostics = emptyDiagnostics();
    const accumulator = new SingleEventAccumulator(expectedEventId);
    // Market-group ids requested by SUBSCRIBE frames this page sent.
    const subscribed = new Set<number>();
    const startTime = Date.now();
    // Last time a single-event payload was merged (stream-silence timer).
    let lastUpdateTime = startTime;
    let leagueInterval: ReturnType<typeof setInterval> | undefined;

    const socketListeners: Array<{
      ws: PlaywrightWebSocket;
      onSent: (frame: { payload: string | Buffer }) => void;
      onReceived: (frame: { payload: string | Buffer }) => void;
    }> = [];

    const finish = (state: PZBukInitialState | null) => {
      if (resolved) return;
      resolved = true;
      if (leagueInterval !== undefined) clearInterval(leagueInterval);
      // Detach every listener so a later capture on the same page is not
      // processed by this (now stale) closure.
      page.off("websocket", wsHandler);
      for (const { ws, onSent, onReceived } of socketListeners) {
        ws.off("framesent", onSent);
        ws.off("framereceived", onReceived);
      }
      resolve({ state, diagnostics });
    };

    const handleInitialState = (state: PZBukInitialState) => {
      diagnostics.initialStates++;
      diagnostics.maxEvents = Math.max(diagnostics.maxEvents, state.events.length);
      if (singleEvent) {
        if (accumulator.add(state)) lastUpdateTime = Date.now();
      } else if (state.events.length >= 1 && state.selections.length > 0) {
        finish(state);
      }
    };

    const wsHandler = (ws: PlaywrightWebSocket) => {
      const url = ws.url();
      diagnostics.socketUrls.push(url);
      // Only listen to the sportsbook API WebSocket
      if (!url.includes(WEBSOCKET_URL_PATTERN)) return;
      diagnostics.matchedSockets++;

      const assembler = new FrameAssembler();
      const onSent = (frame: { payload: string | Buffer }) => {
        if (resolved) return;
        for (const id of subscribedGroupIds(frameText(frame.payload))) subscribed.add(id);
      };
      const onReceived = (frame: { payload: string | Buffer }) => {
        if (resolved) return;
        diagnostics.framesReceived++;
        const text = assembler.push(frame.payload);
        if (text === null) {
          diagnostics.chunkedFrames++;
          return;
        }
        diagnostics.maxFrameBytes = Math.max(diagnostics.maxFrameBytes, Buffer.byteLength(text, "utf8"));

        const decoded = decodeFrame(text);
        switch (decoded.kind) {
          case "setup":
            assembler.setChunkSize(decoded.chunkSize);
            break;
          case "invalid":
            diagnostics.invalidFrames++;
            diagnostics.lastInvalidError = decoded.error;
            break;
          case "control":
            diagnostics.lastControl = { type: decoded.type, message: decoded.message };
            break;
          case "data":
            for (const state of initialStatesOf(decoded)) {
              if (resolved) break;
              handleInitialState(state);
            }
            break;
        }
      };
      ws.on("framesent", onSent);
      ws.on("framereceived", onReceived);
      socketListeners.push({ ws, onSent, onReceived });
    };
    page.on("websocket", wsHandler);

    if (singleEvent) {
      // Match-details mode.
      //
      // The event page answers each market-group stream with one INITIAL_STATE
      // burst. We merge them until the stream goes quiet (stream-silence
      // based), which is reliable for the first event AND for subsequent
      // events whose burst can arrive more slowly.
      //
      // We additionally fire a single, light "expansion" trigger (expand every
      // group header that is not yet subscribed + click every "Pokaż więcej")
      // so each collapsed group subscribes. Merged selections are never
      // discarded, so this can only add data. We deliberately avoid repeated
      // heavy clicking, which was observed to disrupt the stream for the next
      // event navigated on the same page.
      const complete = () => {
        if (resolved) return;
        const stats = accumulator.stats();
        diagnostics.groups = { declared: stats.marketGroupsDeclared, seen: stats.marketGroupsSeen };
        console.log(`[PZBuk/WS] Single-event capture complete with ${stats.selections} selections`);
        finish(accumulator.snapshot());
      };

      // Allows the expansion helpers to bail out promptly once we resolve.
      const shouldStop = () => resolved;

      // A header is skipped when its group is already subscribed or answered:
      // clicking an open group would CLOSE its stream.
      const skipHeader = (headerText: string) => {
        const id = accumulator.groupIdForHeader(headerText);
        return id !== null && (subscribed.has(id) || accumulator.stats().marketGroupsSeen.includes(id));
      };

      void (async () => {
        // Hard safety cap independent of the loop below.
        const hardCap = setTimeout(complete, WS_MAX_WAIT);

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
              const expanded = await expandAllMarketGroups(page, shouldStop, skipHeader).catch(
                () => ({ clicked: 0, skipped: 0 })
              );
              const shown = await clickAllShowMore(page, shouldStop).catch(
                () => 0
              );
              if (expanded.clicked > 0 || expanded.skipped > 0 || shown > 0) {
                console.log(
                  `[PZBuk/WS] Expansion trigger: expanded ${expanded.clicked} headers (skipped ${expanded.skipped} already subscribed), clicked ${shown} "Pokaż więcej"`
                );
              }
              continue;
            }

            // Resolve once the burst has gone quiet, but never before the
            // minimum capture window (subsequent events can stream slowly).
            if (
              accumulator.stats().selections > 0 &&
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
          complete();
        }
      })();
      return;
    }

    // League-listing mode: the frame handler resolves on the first usable
    // snapshot; this poll ends an empty listing early and caps the wait.
    leagueInterval = setInterval(() => {
      if (resolved) return;

      const elapsed = Date.now() - startTime;

      if (elapsed >= WS_MIN_WAIT && isEmptyListing(diagnostics)) {
        finish(null);
        return;
      }

      // Maximum timeout
      if (elapsed >= WS_MAX_WAIT) {
        console.log(
          `[PZBuk/WS] Max wait reached without a listing snapshot (frames: ${diagnostics.framesReceived}, INITIAL_STATE: ${diagnostics.initialStates})`
        );
        finish(null);
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
