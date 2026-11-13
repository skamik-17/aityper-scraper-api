import type { HttpClient } from "../http/http-client.js";
import type { FetchText } from "./types.js";

/** Per-attempt timeout of one event request (README §5.1: 5 s for event calls). */
export const BETBY_EVENT_TIMEOUT_MS = 5_000;
/** Per-attempt timeout of the manifest, snapshot chunks, descriptions and discovery documents. */
export const BETBY_LOAD_TIMEOUT_MS = 10_000;
/** Default time budget of one league scrape (README §5.1: ~45 s). */
export const BETBY_BUDGET_MS = 45_000;
/** loadSnapshot fetches every chunk at once (7 in the evidence); a lower limit would serialize them. */
export const BETBY_PER_HOST_CONCURRENCY = 8;

/** `host` + `pathname` of a URL, for error messages that name the endpoint without query noise. */
export function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * FetchText over the shared HttpClient: one retry on network/timeout/429/5xx (never on 404),
 * redirects followed. Failures are the client's HttpErrors, unchanged (`fetch HTTP <status> <url>`,
 * `fetch timeout <ms>ms <url>`, `fetch failed <cause> <url>`, `fetch aborted <url>`).
 */
export function createBetbyFetchText(http: HttpClient, opts: { timeoutMs: number }): FetchText {
  return (url, init) => http.getText(url, { timeoutMs: opts.timeoutMs, retries: 1, signal: init?.signal });
}
