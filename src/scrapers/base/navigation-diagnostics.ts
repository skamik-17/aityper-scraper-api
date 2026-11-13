/**
 * Navigation diagnostics for the shared full-offer path.
 *
 * A recorder attached to the scraper page keeps the facts a failed scrape
 * otherwise loses: the main-frame document HTTP status and host, navigations
 * that never got a response, failed fetch/xhr calls and opened websockets.
 * describeNavigationIssues turns them into short issue lines, and
 * enrichFullOfferFailure appends those lines to the error of a failed or
 * empty result:
 *   "<scraper error> | <issue>; <issue>"
 * The " | " and "; " separators are a contract: run outcomes and the
 * acceptance checks match on them.
 */
import type { Page, Request, Response, WebSocket } from "playwright";
import type { FullOfferScraperResult, NavigationDiagnostics } from "../../types/full-offer.js";

const MAX_DOCUMENTS = 50;
const MAX_FAILED_NAVIGATIONS = 10;
const MAX_FAILED_REQUESTS = 20;
const MAX_WEBSOCKETS = 10;
/** Failed fetch/xhr calls listed in the issue text. */
const MAX_LISTED_FAILED_REQUESTS = 3;
/** Error documents, and off-host redirects, listed in the issue text; the rest are counted. */
const MAX_LISTED_PER_RULE = 3;
/** Bound for page.url() / page.title() at snapshot time: a navigating page can stall title(). */
const SNAPSHOT_READ_TIMEOUT_MS = 2000;
/** Redirect hops followed back to the requested URL (Playwright chains are short). */
const MAX_REDIRECT_HOPS = 20;
const SOFT_404_TITLE = /\b404\b|nie istnieje|nie znaleziono|not found/i;
/** A main-frame document with neither a response nor a requestfailed event, e.g. a goto timeout. */
const NO_RESPONSE = "no response";

export interface NavigationRecorder {
  /** Facts recorded so far. Synchronous, so it works after the page is gone. */
  current(): NavigationDiagnostics;
  /** current() plus the page URL and title, each read with a 2 s timeout. Never throws. */
  snapshot(page: Page): Promise<NavigationDiagnostics>;
  /** Removes the page listeners. What was recorded stays readable. */
  detach(): void;
}

/**
 * Wraps a page listener so it never throws. Playwright accessors can throw
 * (request.frame() for Service Worker requests, or for a navigation issued
 * before its frame exists), and a throw inside a listener would escape into
 * Playwright's event dispatch and break the scrape.
 */
function guard<T>(listener: (arg: T) => void): (arg: T) => void {
  return (arg) => {
    try {
      listener(arg);
    } catch {
      // Diagnostics are best-effort: drop the event.
    }
  };
}

function firstRequestInChain(request: Request): Request {
  let first = request;
  for (let hops = 0; hops < MAX_REDIRECT_HOPS; hops++) {
    const previous = first.redirectedFrom();
    if (!previous) break;
    first = previous;
  }
  return first;
}

/** Resolves to the read value, or null when it throws, rejects or takes longer than the timeout. */
async function readWithin<T>(read: () => T | Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SNAPSHOT_READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function attachNavigationRecorder(page: Page): NavigationRecorder {
  const documents: NavigationDiagnostics["documents"] = [];
  const failedNavigations: NavigationDiagnostics["failedNavigations"] = [];
  const failedRequests: NavigationDiagnostics["failedRequests"] = [];
  const failedRequestKeys = new Set<string>();
  const websockets: string[] = [];
  // Main-frame document requests still waiting for a response, with their URL.
  const pending = new Map<Request, string>();

  const isMainFrameDocument = (request: Request): boolean =>
    request.resourceType() === "document" && request.frame() === page.mainFrame();

  const onRequest = guard((request: Request) => {
    if (isMainFrameDocument(request)) pending.set(request, request.url());
  });

  const onResponse = guard((response: Response) => {
    const request = response.request();
    pending.delete(request);
    const type = request.resourceType();
    if (type === "document") {
      if (documents.length >= MAX_DOCUMENTS || request.frame() !== page.mainFrame()) return;
      documents.push({
        requestedUrl: firstRequestInChain(request).url(),
        finalUrl: response.url(),
        status: response.status(),
      });
    } else if (type === "fetch" || type === "xhr") {
      const status = response.status();
      if (status < 400 || failedRequests.length >= MAX_FAILED_REQUESTS) return;
      const url = response.url();
      const key = `${status} ${url}`;
      if (failedRequestKeys.has(key)) return;
      failedRequestKeys.add(key);
      failedRequests.push({ url, status, resourceType: type });
    }
  });

  const onRequestFinished = guard((request: Request) => {
    pending.delete(request);
  });

  const onRequestFailed = guard((request: Request) => {
    const wasPending = pending.delete(request);
    if (!wasPending && !isMainFrameDocument(request)) return;
    if (failedNavigations.length >= MAX_FAILED_NAVIGATIONS) return;
    failedNavigations.push({ url: request.url(), errorText: request.failure()?.errorText ?? "unknown" });
  });

  const onWebSocket = guard((ws: WebSocket) => {
    const url = ws.url();
    if (websockets.length < MAX_WEBSOCKETS && !websockets.includes(url)) websockets.push(url);
  });

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onRequestFinished);
  page.on("requestfailed", onRequestFailed);
  page.on("websocket", onWebSocket);

  const current = (): NavigationDiagnostics => ({
    documents: [...documents],
    failedNavigations: [
      ...failedNavigations,
      ...Array.from(pending.values(), (url) => ({ url, errorText: NO_RESPONSE })),
    ].slice(0, MAX_FAILED_NAVIGATIONS),
    failedRequests: [...failedRequests],
    websockets: [...websockets],
    finalUrl: null,
    title: null,
  });

  return {
    current,
    async snapshot(target: Page): Promise<NavigationDiagnostics> {
      const [finalUrl, title] = await Promise.all([
        readWithin(() => target.url()),
        readWithin(() => target.title()),
      ]);
      return { ...current(), finalUrl, title };
    },
    detach(): void {
      try {
        page.off("request", onRequest);
        page.off("response", onResponse);
        page.off("requestfinished", onRequestFinished);
        page.off("requestfailed", onRequestFailed);
        page.off("websocket", onWebSocket);
      } catch {
        // A closed page has nothing left to emit.
      }
    },
  };
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** Last two host labels, e.g. "totalbet.pl" for "api.totalbet.pl". */
function siteOf(url: string | undefined): string | null {
  return hostOf(url)?.split(".").slice(-2).join(".") ?? null;
}

/**
 * Issue lines, in rule order:
 * 1. main-frame document >= 400 (at most 3, then "(+n more)");
 * 2. navigation without a response;
 * 3. off-host redirect (at most 3, then "(+n more)"); it covers HTTP redirect
 * chains only: a JS or meta-refresh redirect to another host is a new
 * navigation and produces no "redirected" line;
 * 4. failed fetch/xhr (own site first, other-site 401/403 dropped, at most 3);
 * 5. soft-404 title, only without a rule-1 line;
 * 6. opened websockets, when asked. Identical lines are listed once.
 */
export function describeNavigationIssues(
  d: NavigationDiagnostics,
  opts: { includeWebsockets?: boolean } = {},
): string[] {
  const issues: string[] = [];
  const add = (line: string): void => {
    if (!issues.includes(line)) issues.push(line);
  };
  // The first MAX_LISTED_PER_RULE distinct lines; the last listed one counts the rest.
  const addCapped = (lines: string[]): void => {
    const distinct = [...new Set(lines)];
    const listed = distinct.slice(0, MAX_LISTED_PER_RULE);
    const more = distinct.length - listed.length;
    if (more > 0) listed[listed.length - 1] += ` (+${more} more)`;
    listed.forEach(add);
  };

  const errorDocuments = d.documents.filter((doc) => doc.status >= 400);
  addCapped(errorDocuments.map((doc) => `document HTTP ${doc.status} ${doc.finalUrl}`));
  const hasErrorDocument = errorDocuments.length > 0;

  for (const nav of d.failedNavigations) add(`document failed ${nav.errorText} ${nav.url}`);

  const redirects: string[] = [];
  for (const doc of d.documents) {
    const from = hostOf(doc.requestedUrl);
    const to = hostOf(doc.finalUrl);
    if (from && to && from !== to) redirects.push(`redirected ${from} -> ${to}`);
  }
  addCapped(redirects);

  // Other-site 401/403 are anonymous analytics or customer calls, not the cause.
  const ownSite = siteOf(d.documents[0]?.requestedUrl);
  const isOwnSite = (url: string): boolean => ownSite !== null && siteOf(url) === ownSite;
  const ownRequests = d.failedRequests.filter((r) => isOwnSite(r.url));
  const otherRequests = d.failedRequests.filter((r) => !isOwnSite(r.url) && r.status !== 401 && r.status !== 403);
  for (const r of [...ownRequests, ...otherRequests].slice(0, MAX_LISTED_FAILED_REQUESTS)) {
    add(`${r.resourceType} HTTP ${r.status} ${r.url}`);
  }

  if (!hasErrorDocument && d.title && SOFT_404_TITLE.test(d.title)) add(`page title "${d.title}"`);

  if (opts.includeWebsockets) add(`websockets opened: ${d.websockets.join(", ") || "none"}`);

  return issues;
}

/** A result that saved nothing: the scraper failed, or succeeded with 0 matches. */
export function isFailedOrEmptyResult(result: Pick<FullOfferScraperResult, "success" | "matches">): boolean {
  return !result.success || result.matches.length === 0;
}

/**
 * Appends the navigation issues to a failed or empty result's error and
 * attaches the diagnostics. A result with matches is returned untouched.
 * An empty or missing scraper error is replaced by "Scrape failed" or "0 matches".
 */
export function enrichFullOfferFailure(
  result: FullOfferScraperResult,
  d: NavigationDiagnostics,
): FullOfferScraperResult {
  if (!isFailedOrEmptyResult(result)) return result;

  const issues = describeNavigationIssues(d, { includeWebsockets: /websocket/i.test(result.error ?? "") });
  if (issues.length === 0) return { ...result, diagnostics: d };

  const cause = result.error || (result.success ? "0 matches" : "Scrape failed");
  return { ...result, error: `${cause} | ${issues.join("; ")}`, diagnostics: d };
}
