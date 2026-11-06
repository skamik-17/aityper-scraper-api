import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FullMatchOffer,
  FullOfferScraperResult,
  NavigationDiagnostics,
} from "../../../types/full-offer.js";
import type { MatchDetailResult, ScraperConfig, ScraperResult } from "../../../types/scraper.js";
import {
  attachNavigationRecorder,
  describeNavigationIssues,
  enrichFullOfferFailure,
  type NavigationRecorder,
} from "../navigation-diagnostics.js";
import { PlaywrightScraper, type BrowserSession } from "../playwright-base.js";

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/navigation-recorder-live-2026-11-06.json", import.meta.url), "utf8"),
) as Record<"betters" | "totalbet" | "pzbuk", NavigationDiagnostics>;

const RECORDED_EVENTS = ["request", "response", "requestfinished", "requestfailed", "websocket"] as const;

// --- Playwright fakes -------------------------------------------------------
// Only the accessors the recorder may touch are modelled; everything is a
// function so a test can swap one for a throwing implementation.

interface FakeRequest {
  url: () => string;
  resourceType: () => string;
  frame: () => unknown;
  failure: () => { errorText: string } | null;
  redirectedFrom: () => FakeRequest | null;
}

interface FakeResponse {
  url: () => string;
  status: () => number;
  request: () => FakeRequest;
  frame: () => unknown;
}

const IFRAME = { name: "iframe" };

function createFakePage() {
  const mainFrame = { name: "main" };
  return Object.assign(new EventEmitter(), {
    mainFrame: () => mainFrame,
    url: (): string => "about:blank",
    title: (): Promise<string> => Promise.resolve(""),
  });
}
type FakePage = ReturnType<typeof createFakePage>;

const asPage = (page: FakePage) => page as unknown as Page;

function fakeRequest(o: {
  url: string;
  type: string;
  frame?: unknown;
  errorText?: string;
  redirectedFrom?: FakeRequest;
}): FakeRequest {
  return {
    url: () => o.url,
    resourceType: () => o.type,
    frame: () => o.frame ?? IFRAME,
    failure: () => (o.errorText === undefined ? null : { errorText: o.errorText }),
    redirectedFrom: () => o.redirectedFrom ?? null,
  };
}

function fakeResponse(o: {
  url: string;
  status: number;
  type: string;
  frame?: unknown;
  request?: FakeRequest;
}): FakeResponse {
  const request = o.request ?? fakeRequest({ url: o.url, type: o.type, frame: o.frame });
  return {
    url: () => o.url,
    status: () => o.status,
    request: () => request,
    frame: () => request.frame(),
  };
}

const fakeWebSocket = (url: string) => ({ url: () => url });

/** A full main-frame document load: request, response, requestfinished. */
function loadDocument(page: FakePage, url: string, status: number): void {
  const request = fakeRequest({ url, type: "document", frame: page.mainFrame() });
  page.emit("request", request);
  page.emit("response", fakeResponse({ url, status, type: "document", request }));
  page.emit("requestfinished", request);
}

const EMPTY: Omit<NavigationDiagnostics, "documents"> = {
  failedNavigations: [],
  failedRequests: [],
  websockets: [],
  finalUrl: null,
  title: null,
};

describe("describeNavigationIssues (live 2026-11-06 captures)", () => {
  it("betters: 404 document", () =>
    expect(describeNavigationIssues(fx.betters)).toEqual([
      "document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
    ]));

  it("totalbet: in-page fetch 404 to the retired REST API", () =>
    expect(describeNavigationIssues(fx.totalbet)).toEqual([
      "fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events",
    ]));

  it("pzbuk: websocket list only when asked", () => {
    expect(describeNavigationIssues(fx.pzbuk)).toEqual([]);
    expect(describeNavigationIssues(fx.pzbuk, { includeWebsockets: true })).toEqual([
      "websockets opened: wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl",
    ]);
  });

  const base = EMPTY;

  it("off-host redirect and soft-404 title", () => {
    expect(
      describeNavigationIssues({
        ...base,
        documents: [
          { requestedUrl: "https://www.betters.pl/pl/league/1/4485", finalUrl: "https://betters.sptpub.com/", status: 200 },
        ],
      }),
    ).toEqual(["redirected www.betters.pl -> betters.sptpub.com"]);
    expect(
      describeNavigationIssues({
        ...base,
        title: "404 - STRONA NIE ISTNIEJE",
        documents: [
          {
            requestedUrl: "https://www.betters.pl/pl/league/1/4485",
            finalUrl: "https://www.betters.pl/pl/league/1/4485",
            status: 200,
          },
        ],
      }),
    ).toEqual(['page title "404 - STRONA NIE ISTNIEJE"']);
  });

  it("navigation that never got a response (DNS, refused, TLS, timeout)", () =>
    expect(
      describeNavigationIssues({
        ...base,
        documents: [],
        failedNavigations: [{ url: "https://totalbet.pl/", errorText: "net::ERR_NAME_NOT_RESOLVED" }],
      }),
    ).toEqual(["document failed net::ERR_NAME_NOT_RESOLVED https://totalbet.pl/"]));

  it("own-site failed requests first; other-site 401/403 dropped", () =>
    expect(
      describeNavigationIssues({
        ...fx.totalbet,
        failedRequests: [
          { url: "https://analytics.example.com/collect", status: 401, resourceType: "xhr" },
          { url: "https://cdn.example.net/cfg.json", status: 500, resourceType: "fetch" },
          { url: "https://totalbet.pl/rest/market/categories/multi/7124/events", status: 404, resourceType: "fetch" },
        ],
      }),
    ).toEqual([
      "fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events",
      "fetch HTTP 500 https://cdn.example.net/cfg.json",
    ]));

  it("keeps own-site 401/403 and lists at most 3 failed requests", () =>
    expect(
      describeNavigationIssues({
        ...fx.totalbet,
        failedRequests: [
          { url: "https://cdn.example.net/a.json", status: 500, resourceType: "fetch" },
          { url: "https://api.totalbet.pl/session", status: 401, resourceType: "xhr" },
          { url: "https://totalbet.pl/rest/a", status: 403, resourceType: "fetch" },
          { url: "https://totalbet.pl/rest/b", status: 404, resourceType: "fetch" },
          { url: "https://totalbet.pl/rest/c", status: 410, resourceType: "fetch" },
        ],
      }),
    ).toEqual([
      "xhr HTTP 401 https://api.totalbet.pl/session",
      "fetch HTTP 403 https://totalbet.pl/rest/a",
      "fetch HTTP 404 https://totalbet.pl/rest/b",
    ]));

  it("with no document every failed request counts as other-site", () =>
    expect(
      describeNavigationIssues({
        ...base,
        documents: [],
        failedRequests: [
          { url: "https://totalbet.pl/rest/a", status: 403, resourceType: "fetch" },
          { url: "https://totalbet.pl/rest/b", status: 502, resourceType: "fetch" },
        ],
      }),
    ).toEqual(["fetch HTTP 502 https://totalbet.pl/rest/b"]));

  it("websocket list reads 'none' when nothing was opened", () =>
    expect(describeNavigationIssues(fx.betters, { includeWebsockets: true })).toEqual([
      "document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
      "websockets opened: none",
    ]));

  it("lists every issue kind in rule order, one line per distinct fact", () => {
    const d: NavigationDiagnostics = {
      documents: [
        { requestedUrl: "https://lebull.pl/", finalUrl: "https://lebull.pl/", status: 200 },
        { requestedUrl: "https://lebull.pl/pl/league/1", finalUrl: "https://lebullpl-ssr.boxwebcdn.work/pl/league/1", status: 404 },
        { requestedUrl: "https://lebull.pl/pl/league/1", finalUrl: "https://lebullpl-ssr.boxwebcdn.work/pl/league/1", status: 404 },
      ],
      failedNavigations: [
        { url: "https://lebull.pl/pl/event/7", errorText: "net::ERR_ABORTED" },
        { url: "https://lebull.pl/pl/event/7", errorText: "net::ERR_ABORTED" },
        { url: "https://lebull.pl/pl/event/7", errorText: "no response" },
      ],
      failedRequests: [{ url: "https://lebull.pl/api/x", status: 500, resourceType: "xhr" }],
      websockets: ["wss://lebull.pl/ws"],
      finalUrl: "https://lebullpl-ssr.boxwebcdn.work/pl/league/1",
      title: "404 Not Found",
    };
    expect(describeNavigationIssues(d, { includeWebsockets: true })).toEqual([
      "document HTTP 404 https://lebullpl-ssr.boxwebcdn.work/pl/league/1",
      "document failed net::ERR_ABORTED https://lebull.pl/pl/event/7",
      "document failed no response https://lebull.pl/pl/event/7",
      "redirected lebull.pl -> lebullpl-ssr.boxwebcdn.work",
      "xhr HTTP 500 https://lebull.pl/api/x",
      "websockets opened: wss://lebull.pl/ws",
    ]);
  });

  it("does not throw on a URL it cannot parse", () =>
    expect(
      describeNavigationIssues({
        ...base,
        documents: [{ requestedUrl: "not a url", finalUrl: "also not a url", status: 500 }],
        failedRequests: [{ url: "::", status: 500, resourceType: "fetch" }],
      }),
    ).toEqual(["document HTTP 500 also not a url", "fetch HTTP 500 ::"]));
});

describe("enrichFullOfferFailure", () => {
  it("appends issues to a failed result and attaches diagnostics", () => {
    const r = enrichFullOfferFailure(
      { success: false, bookmaker: "betters", league: "premier-league", matches: [], error: "No events found from API" },
      fx.betters,
    );
    expect(r.error).toBe(
      "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
    );
    expect(r.diagnostics).toEqual(fx.betters);
  });

  it("adds websockets when the scraper error mentions WebSocket", () => {
    const r = enrichFullOfferFailure(
      { success: false, bookmaker: "pzbuk", league: "premier-league", matches: [], error: "No WebSocket data captured" },
      fx.pzbuk,
    );
    expect(r.error).toBe(
      "No WebSocket data captured | websockets opened: wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl",
    );
  });

  it("joins several issues with '; ' (separator contract)", () => {
    const d = {
      failedNavigations: [],
      failedRequests: [],
      websockets: [],
      finalUrl: null,
      title: null,
      documents: [
        {
          requestedUrl: "https://www.betters.pl/pl/league/1/4485",
          finalUrl: "https://betters.sptpub.com/pl/league/1/4485",
          status: 404,
        },
      ],
    };
    expect(
      enrichFullOfferFailure(
        { success: false, bookmaker: "betters", league: "premier-league", matches: [], error: "No events found from API" },
        d,
      ).error,
    ).toBe(
      "No events found from API | document HTTP 404 https://betters.sptpub.com/pl/league/1/4485; redirected www.betters.pl -> betters.sptpub.com",
    );
  });

  it("success with 0 matches gets the '0 matches' default text", () =>
    expect(
      enrichFullOfferFailure({ success: true, bookmaker: "betters", league: "premier-league", matches: [] }, fx.betters)
        .error,
    ).toBe("0 matches | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485"));

  it("a failure without an error message gets the 'Scrape failed' default text", () => {
    const failed = (): FullOfferScraperResult => ({
      success: false,
      bookmaker: "totalbet",
      league: "premier-league",
      matches: [],
    });
    expect(enrichFullOfferFailure(failed(), fx.totalbet).error).toBe(
      "Scrape failed | fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events",
    );
    expect(enrichFullOfferFailure({ ...failed(), error: "" }, fx.totalbet).error).toBe(
      "Scrape failed | fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events",
    );
  });

  it("with no issues keeps the error and only attaches diagnostics", () => {
    const failed: FullOfferScraperResult = {
      success: false,
      bookmaker: "pzbuk",
      league: "premier-league",
      matches: [],
      error: "Timeout waiting for listing",
      duration: 1234,
    };
    const r = enrichFullOfferFailure(failed, fx.pzbuk);
    expect(r).toEqual({ ...failed, diagnostics: fx.pzbuk });
    expect(r).not.toBe(failed);
    expect(failed).not.toHaveProperty("diagnostics");
  });

  it("does not mutate the input result", () => {
    const failed: FullOfferScraperResult = {
      success: false,
      bookmaker: "betters",
      league: "premier-league",
      matches: [],
      error: "No events found from API",
    };
    enrichFullOfferFailure(failed, fx.betters);
    expect(failed).toEqual({
      success: false,
      bookmaker: "betters",
      league: "premier-league",
      matches: [],
      error: "No events found from API",
    });
  });

  it("returns a successful result untouched", () => {
    const ok = {
      success: true,
      bookmaker: "sts",
      league: "premier-league",
      matches: [{} as FullMatchOffer],
    } as FullOfferScraperResult;
    expect(enrichFullOfferFailure(ok, fx.betters)).toBe(ok);
  });
});

describe("attachNavigationRecorder", () => {
  let page: FakePage;
  let rec: NavigationRecorder;

  beforeEach(() => {
    page = createFakePage();
    rec = attachNavigationRecorder(asPage(page));
  });

  afterEach(() => {
    rec.detach();
    vi.useRealTimers();
  });

  it("records main-frame documents, failed fetch/xhr and websockets; ignores 2xx fetch", () => {
    page.emit(
      "response",
      fakeResponse({ url: "https://x/league", status: 404, type: "document", frame: page.mainFrame() }),
    );
    page.emit("response", fakeResponse({ url: "https://x/api/events", status: 404, type: "fetch" }));
    page.emit("response", fakeResponse({ url: "https://x/api/ok", status: 200, type: "fetch" }));
    page.emit("websocket", fakeWebSocket("wss://x/ws"));
    // Ignored: an iframe document, a failed image, a 3xx xhr.
    page.emit("response", fakeResponse({ url: "https://ads.example/frame", status: 500, type: "document", frame: IFRAME }));
    page.emit("response", fakeResponse({ url: "https://x/logo.png", status: 404, type: "image" }));
    page.emit("response", fakeResponse({ url: "https://x/api/moved", status: 302, type: "xhr" }));

    expect(rec.current()).toEqual({
      documents: [{ requestedUrl: "https://x/league", finalUrl: "https://x/league", status: 404 }],
      failedNavigations: [],
      failedRequests: [{ url: "https://x/api/events", status: 404, resourceType: "fetch" }],
      websockets: ["wss://x/ws"],
      finalUrl: null,
      title: null,
    });
  });

  it("takes requestedUrl from the start of the redirect chain", () => {
    const first = fakeRequest({ url: "https://www.betters.pl/pl/league/1/4485", type: "document", frame: page.mainFrame() });
    page.emit("request", first);
    page.emit("response", fakeResponse({ url: first.url(), status: 301, type: "document", request: first }));
    page.emit("requestfinished", first);
    const second = fakeRequest({
      url: "https://betters.sptpub.com/",
      type: "document",
      frame: page.mainFrame(),
      redirectedFrom: first,
    });
    page.emit("request", second);
    page.emit("response", fakeResponse({ url: second.url(), status: 200, type: "document", request: second }));
    page.emit("requestfinished", second);

    const d = rec.current();
    expect(d.documents).toEqual([
      { requestedUrl: "https://www.betters.pl/pl/league/1/4485", finalUrl: "https://www.betters.pl/pl/league/1/4485", status: 301 },
      { requestedUrl: "https://www.betters.pl/pl/league/1/4485", finalUrl: "https://betters.sptpub.com/", status: 200 },
    ]);
    expect(d.failedNavigations).toEqual([]);
    expect(describeNavigationIssues(d)).toEqual(["redirected www.betters.pl -> betters.sptpub.com"]);
  });

  it("records a main-frame document that failed without a response", () => {
    const request = fakeRequest({
      url: "https://totalbet.pl/",
      type: "document",
      frame: page.mainFrame(),
      errorText: "net::ERR_NAME_NOT_RESOLVED",
    });
    page.emit("request", request);
    page.emit("requestfailed", request);
    // A failed iframe document or a failed fetch is not a navigation failure.
    page.emit("requestfailed", fakeRequest({ url: "https://ads.example/", type: "document", frame: IFRAME, errorText: "net::ERR_FAILED" }));
    page.emit("requestfailed", fakeRequest({ url: "https://totalbet.pl/api", type: "fetch", errorText: "net::ERR_FAILED" }));

    expect(rec.current().failedNavigations).toEqual([
      { url: "https://totalbet.pl/", errorText: "net::ERR_NAME_NOT_RESOLVED" },
    ]);
  });

  it("uses 'unknown' when a failed navigation carries no failure text", () => {
    const request = fakeRequest({ url: "https://totalbet.pl/", type: "document", frame: page.mainFrame() });
    page.emit("request", request);
    page.emit("requestfailed", request);
    expect(rec.current().failedNavigations).toEqual([{ url: "https://totalbet.pl/", errorText: "unknown" }]);
  });

  it("reports a main-frame document still pending at snapshot time as 'no response' (goto timeout)", async () => {
    page.emit(
      "request",
      fakeRequest({ url: "https://www.pzbuk.pl/pl/sportsbook", type: "document", frame: page.mainFrame() }),
    );
    expect(rec.current().failedNavigations).toEqual([{ url: "https://www.pzbuk.pl/pl/sportsbook", errorText: "no response" }]);
    expect((await rec.snapshot(asPage(page))).failedNavigations).toEqual([
      { url: "https://www.pzbuk.pl/pl/sportsbook", errorText: "no response" },
    ]);
  });

  it("a document that got its response or finished is no longer pending", () => {
    loadDocument(page, "https://www.pzbuk.pl/pl/sportsbook", 200);
    const finishedOnly = fakeRequest({ url: "https://www.pzbuk.pl/cached", type: "document", frame: page.mainFrame() });
    page.emit("request", finishedOnly);
    page.emit("requestfinished", finishedOnly);
    expect(rec.current().failedNavigations).toEqual([]);
  });

  it("snapshot adds the page URL and title", async () => {
    loadDocument(page, "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league", 200);
    page.url = () => "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-premier-league";
    page.title = () => Promise.resolve("Premier League | PZBuk");
    await expect(rec.snapshot(asPage(page))).resolves.toEqual({
      documents: [
        {
          requestedUrl: "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league",
          finalUrl: "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league",
          status: 200,
        },
      ],
      failedNavigations: [],
      failedRequests: [],
      websockets: [],
      finalUrl: "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-premier-league",
      title: "Premier League | PZBuk",
    });
  });

  it("snapshot never throws when the page is closed (Review Focus 5)", async () => {
    loadDocument(page, "https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485", 404);
    page.title = () => Promise.reject(new Error("Target page, context or browser has been closed"));
    page.url = () => {
      throw new Error("Target page, context or browser has been closed");
    };
    await expect(rec.snapshot(asPage(page))).resolves.toMatchObject({
      title: null,
      finalUrl: null,
      documents: [{ status: 404 }],
    });
  });

  it("snapshot gives up on a hanging title after 2 s", async () => {
    vi.useFakeTimers();
    page.url = () => "https://x/";
    page.title = () => new Promise<string>(() => {});
    const snapshot = rec.snapshot(asPage(page));
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void snapshot.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(snapshot).resolves.toMatchObject({ finalUrl: "https://x/", title: null });
  });

  it("a throwing Playwright accessor inside a listener never escapes (Review Focus 5)", () => {
    const r = fakeResponse({ url: "https://sw.example/x", status: 200, type: "document" });
    // Real Playwright throws from request.frame() (and so from response.frame()) for
    // Service Worker requests; make the accessor the recorder calls throw.
    const frame = vi.fn(() => {
      throw new Error("Service Worker requests do not have an associated frame.");
    });
    r.request().frame = frame;
    r.frame = frame;
    expect(() => page.emit("response", r)).not.toThrow();
    expect(frame).toHaveBeenCalled();
    expect(rec.current().documents).toEqual([]);
  });

  it.each(RECORDED_EVENTS)("the %s listener swallows any payload error", (event) => {
    const hostile = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("Target page, context or browser has been closed");
        },
      },
    );
    expect(() => page.emit(event, hostile)).not.toThrow();
    expect(() => page.emit(event, undefined)).not.toThrow();
    expect(rec.current()).toEqual({ documents: [], ...EMPTY });
  });

  it("caps and dedupes what it keeps", () => {
    for (let i = 0; i < 60; i++) loadDocument(page, `https://x/page/${i}`, 200);
    for (let i = 0; i < 15; i++) {
      const request = fakeRequest({ url: `https://x/fail/${i}`, type: "document", frame: page.mainFrame(), errorText: "net::ERR_FAILED" });
      page.emit("request", request);
      page.emit("requestfailed", request);
    }
    for (let i = 0; i < 30; i++) {
      page.emit("response", fakeResponse({ url: `https://x/api/${i}`, status: 500, type: "xhr" }));
      page.emit("response", fakeResponse({ url: `https://x/api/${i}`, status: 500, type: "xhr" }));
    }
    page.emit("websocket", fakeWebSocket("wss://x/0"));
    for (let i = 0; i < 15; i++) page.emit("websocket", fakeWebSocket(`wss://x/${i}`));

    const d = rec.current();
    expect(d.documents).toHaveLength(50);
    expect(d.documents[49].requestedUrl).toBe("https://x/page/49");
    expect(d.failedNavigations).toHaveLength(10);
    expect(d.failedRequests).toHaveLength(20);
    expect(new Set(d.failedRequests.map((r) => r.url)).size).toBe(20);
    expect(d.websockets).toEqual(Array.from({ length: 10 }, (_, i) => `wss://x/${i}`));
  });

  it("keeps the same URL with a different status as a separate failed request", () => {
    page.emit("response", fakeResponse({ url: "https://x/api", status: 500, type: "fetch" }));
    page.emit("response", fakeResponse({ url: "https://x/api", status: 503, type: "fetch" }));
    page.emit("response", fakeResponse({ url: "https://x/api", status: 500, type: "fetch" }));
    expect(rec.current().failedRequests).toEqual([
      { url: "https://x/api", status: 500, resourceType: "fetch" },
      { url: "https://x/api", status: 503, resourceType: "fetch" },
    ]);
  });

  it("current() returns a copy that later events do not change", () => {
    loadDocument(page, "https://x/a", 404);
    const before = rec.current();
    loadDocument(page, "https://x/b", 404);
    page.emit("websocket", fakeWebSocket("wss://x/ws"));
    expect(before.documents).toHaveLength(1);
    expect(before.websockets).toEqual([]);
  });

  it("detach() stops recording and removes every listener", () => {
    for (const event of RECORDED_EVENTS) expect(page.listenerCount(event)).toBe(1);
    rec.detach();
    for (const event of RECORDED_EVENTS) expect(page.listenerCount(event)).toBe(0);
    loadDocument(page, "https://x/after", 404);
    expect(rec.current().documents).toEqual([]);
  });
});

describe("PlaywrightScraper.executeFullOfferScrape", () => {
  class TestScraper extends PlaywrightScraper {
    bookmaker = "betters" as const;
    config: ScraperConfig = {
      bookmaker: "betters",
      type: "headless",
      baseUrl: "https://betterspl-ssr.boxwebcdn.work",
      timeout: 1000,
      retries: 1,
      rateLimit: 60,
      enabled: true,
    };
    readonly cleanup = vi.fn(async () => {});
    initError: Error | null = null;

    constructor(
      readonly page: FakePage,
      private readonly logic: (page: Page, league: string) => Promise<FullOfferScraperResult>,
    ) {
      super();
    }

    protected async initBrowser(): Promise<BrowserSession> {
      if (this.initError) throw this.initError;
      return {
        page: asPage(this.page),
        browser: {} as Browser,
        context: {} as BrowserContext,
        cleanup: this.cleanup,
      };
    }

    scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
      return this.executeFullOfferScrape(league, (l) => l === "premier-league", this.logic);
    }

    scrapeLeague(): Promise<ScraperResult> {
      throw new Error("not used");
    }
    scrapeMatch(): Promise<ScraperResult> {
      throw new Error("not used");
    }
    scrapeMatchDetails(): Promise<MatchDetailResult> {
      throw new Error("not used");
    }
    extractEventUrls(): Promise<never[]> {
      throw new Error("not used");
    }
  }

  const LEAGUE_URL = "https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
  let page: FakePage;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    page = createFakePage();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("enriches a failed scrape with recorded navigation issues", async () => {
    const scraper = new TestScraper(page, async (p, league) => {
      loadDocument(page, LEAGUE_URL, 404);
      expect(p).toBe(asPage(page));
      return { success: false, bookmaker: "betters", league, matches: [], error: "No events found from API" };
    });
    const result = await scraper.scrapeFullOffer("premier-league");
    expect(result.error).toContain("| document HTTP 404 ");
    expect(result.error).toBe(`No events found from API | document HTTP 404 ${LEAGUE_URL}`);
    expect(result.diagnostics?.documents).toEqual([{ requestedUrl: LEAGUE_URL, finalUrl: LEAGUE_URL, status: 404 }]);
    expect(scraper.cleanup).toHaveBeenCalledTimes(1);
    for (const event of RECORDED_EVENTS) expect(page.listenerCount(event)).toBe(0);
  });

  it("enriches when scrapeLogic throws, using data recorded before the throw", async () => {
    const title = vi.fn(() => Promise.reject(new Error("Target page, context or browser has been closed")));
    page.title = title;
    const scraper = new TestScraper(page, async () => {
      loadDocument(page, LEAGUE_URL, 404);
      throw new Error("boom");
    });
    const result = await scraper.scrapeFullOffer("premier-league");
    expect(result).toMatchObject({ success: false, bookmaker: "betters", league: "premier-league", matches: [] });
    expect(result.error).toMatch(/^boom \| document HTTP 404 /);
    expect(result.diagnostics?.title).toBeNull();
    expect(title).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("[betters] Full offer scraper error: boom");
    expect(scraper.cleanup).toHaveBeenCalledTimes(1);
    for (const event of RECORDED_EVENTS) expect(page.listenerCount(event)).toBe(0);
  });

  it("returns a successful result untouched without taking a snapshot", async () => {
    const title = vi.fn(() => Promise.resolve("Premier League"));
    page.title = title;
    const ok: FullOfferScraperResult = {
      success: true,
      bookmaker: "betters",
      league: "premier-league",
      matches: [{} as FullMatchOffer],
    };
    const scraper = new TestScraper(page, async () => {
      loadDocument(page, LEAGUE_URL, 404);
      return ok;
    });
    const result = await scraper.scrapeFullOffer("premier-league");
    expect(result).toBe(ok);
    expect(result).not.toHaveProperty("diagnostics");
    expect(title).not.toHaveBeenCalled();
    for (const event of RECORDED_EVENTS) expect(page.listenerCount(event)).toBe(0);
  });

  it("a browser that fails to start gives the plain error result", async () => {
    const scraper = new TestScraper(page, async () => {
      throw new Error("not reached");
    });
    scraper.initError = new Error("Browser pool is closing, cannot acquire new browser");
    const result = await scraper.scrapeFullOffer("premier-league");
    expect(result).toMatchObject({
      success: false,
      error: "Browser pool is closing, cannot acquire new browser",
    });
    expect(result).not.toHaveProperty("diagnostics");
  });

  it("an unknown league never opens a browser", async () => {
    const logic = vi.fn();
    const scraper = new TestScraper(page, logic);
    const result = await scraper.scrapeFullOffer("ekstraklasa");
    expect(result).toMatchObject({ success: false, error: "Unknown league: ekstraklasa" });
    expect(logic).not.toHaveBeenCalled();
    expect(scraper.cleanup).not.toHaveBeenCalled();
  });
});
