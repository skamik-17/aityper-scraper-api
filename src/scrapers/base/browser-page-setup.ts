/**
 * Per-page CDP setup (plan 08 Task 4): traffic counters and URLPattern blocking.
 *
 * Blocking goes only through Network.setBlockedURLs({ urlPatterns }): it keeps the HTTP
 * cache, unlike page.route/context.route, and URLPattern matching never hits substrings
 * (the legacy `urls` form would block runtime.webpack.js for *.webp). A page created later
 * in the same context does not inherit these settings, so every page gets its own setup.
 */
import type { BrowserContext, CDPSession, Page } from "playwright";

/** Network.setUserAgentOverride parameters (plan 08 Task 6). */
export interface UserAgentOverrideParams {
  userAgent: string;
  acceptLanguage: string;
  platform: string;
  userAgentMetadata: Record<string, unknown>;
}

export interface NetworkEvent {
  bytes: number;
  failed: boolean;
  blocked: boolean;
}

export interface PageSetup {
  /** Bookmaker, for log lines. */
  label: string;
  /** URLPattern strings; empty -> no setBlockedURLs call. */
  blockPatterns: readonly string[];
  userAgentOverride?: UserAgentOverrideParams;
  onNetwork(e: NetworkEvent): void;
  /** Receives the degraded line; default console.warn. The runtime passes a once-per-session logger. */
  onDegraded?(line: string): void;
}

/** Prepares one page; never throws. A failed step leaves the page as it is (never a substring fallback). */
export async function preparePage(context: BrowserContext, page: Page, setup: PageSetup): Promise<void> {
  const degrade = (method: string, error: unknown) =>
    (setup.onDegraded ?? console.warn)(
      `[BrowserRuntime] ${setup.label} page setup degraded: ${method} ${error instanceof Error ? error.message : String(error)}`,
    );

  let cdp: CDPSession;
  try {
    cdp = await context.newCDPSession(page);
  } catch (error) {
    degrade("newCDPSession", error);
    return;
  }

  cdp.on("Network.loadingFinished", (e: { encodedDataLength?: number }) =>
    setup.onNetwork({ bytes: Math.max(0, Math.round(e.encodedDataLength ?? 0)), failed: false, blocked: false }),
  );
  cdp.on("Network.loadingFailed", (e: { blockedReason?: string }) =>
    setup.onNetwork({ bytes: 0, failed: true, blocked: !!e.blockedReason }),
  );

  // CDPSession.send is typed per protocol method; the method names below are fixed
  const send = (method: string, params?: Record<string, unknown>) =>
    (cdp.send as (m: string, p?: Record<string, unknown>) => Promise<unknown>).call(cdp, method, params).then(
      () => true,
      (error: unknown) => {
        degrade(method, error);
        return false;
      },
    );

  // Without the Network domain neither counters nor blocking work: stop there
  if (!(await send("Network.enable"))) return;
  if (setup.userAgentOverride) await send("Network.setUserAgentOverride", { ...setup.userAgentOverride });
  if (setup.blockPatterns.length > 0) {
    await send("Network.setBlockedURLs", { urlPatterns: setup.blockPatterns.map((urlPattern) => ({ urlPattern, block: true })) });
  }
}
