import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient, type ReplayRoute } from "../../../../__tests__/helpers/replay-http.js";
import { createScrapeBudget } from "../../../shared/budget.js";
import { createHttpClient } from "../../../shared/http/http-client.js";
import { abortedError } from "../../../shared/http/http-error.js";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import { createHttpFetchJson, fetchEventDetail, type FetchJson } from "../api-client.js";
import { TotalbetPlaywrightScraper, type TotalbetDeps } from "../index.js";

const raw = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const PL = "8793bb6a-4684-44ba-b92e-4d896e6cbfbf";
const LIST_P1 = `https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=${PL}&category_type=sport&type=standard`;
const DETAIL_PREFIX = "https://totalbet.pl/dealer/bdata/v1/bet/events/";
const EVENT = "00000000-0000-0000-0000-000000000000";
const LEEDS = "0e45932b-1433-4cf5-b658-5c308b7c2b60";
const CP = "f91beb39-9b93-4b91-a3b1-a1063efec44d";
const LIST_UUIDS: string[] = JSON.parse(raw("pl-events-list.json")).data.events.map((e: { uuid: string }) => e.uuid);

const scraperWith = (deps: TotalbetDeps) => new TotalbetPlaywrightScraper(undefined, deps);

// The verbatim list page, Leeds and Crystal Palace details, and the 404 envelope for every other detail.
function replayRoutes(): Record<string, ReplayRoute> {
  const routes: Record<string, ReplayRoute> = { [LIST_P1]: { body: raw("pl-events-list.json") } };
  for (const uuid of LIST_UUIDS) routes[`${DETAIL_PREFIX}${uuid}`] = { status: 404, body: raw("event-not-found.json") };
  routes[`${DETAIL_PREFIX}${LEEDS}`] = { body: raw("event-detail-leeds-tottenham.trimmed.json") };
  routes[`${DETAIL_PREFIX}${CP}`] = { body: raw("event-detail-crystal-palace-liverpool.core.json") };
  return routes;
}

// FetchJson over the replay routes; `onList` runs after the list page has answered.
function fakeFetchJson(onList?: () => void): FetchJson {
  const routes = replayRoutes();
  return async (url) => {
    const route = routes[url];
    if (!route || route instanceof Error) throw new Error(`no route ${url}`);
    const answer = { status: route.status ?? 200, contentType: "application/json", body: JSON.parse(route.body) as unknown };
    if (url === LIST_P1) onList?.();
    return answer;
  };
}

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockRejectedValue(new Error("browser disabled in unit tests"));
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("network disabled in unit tests");
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("totalbet transport (createHttpFetchJson)", () => {
  const U = `${DETAIL_PREFIX}${EVENT}`;

  it("createHttpFetchJson resolves a 404 envelope as a value so the reason survives", async () => {
    const f = createHttpFetchJson(createReplayHttpClient({ [U]: { status: 404, body: '{"_meta":{"reason":"not_found"}}' } }), { timeoutMs: 1000 });
    expect(await f(U)).toEqual({ status: 404, contentType: "application/json", body: { _meta: { reason: "not_found" } } });
    expect((await fetchEventDetail(EVENT, f)).error).toBe(`fetch HTTP 404 ${DETAIL_PREFIX}${EVENT} reason=not_found`);
  });

  it("createHttpFetchJson keeps a non-JSON error body as text", async () => {
    const f = createHttpFetchJson(createReplayHttpClient({ [U]: { status: 404, body: "<html>404</html>", contentType: "text/html" } }), { timeoutMs: 1000 });
    expect(await f(U)).toEqual({ status: 404, contentType: "text/html", body: "<html>404</html>" });
    expect((await fetchEventDetail(EVENT, f)).error).toBe(`fetch HTTP 404 ${U}`);
  });

  it("a timeout is retried once, then surfaces in §3 wording", async () => {
    // Hangs until the per-attempt timeout aborts it.
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const f = createHttpFetchJson(createHttpClient({ fetchImpl: fetchImpl as unknown as typeof fetch }), { timeoutMs: 50 });
    expect(await fetchEventDetail(LEEDS, f)).toEqual({ event: null, error: `fetch timeout 50ms ${DETAIL_PREFIX}${LEEDS}` });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a 404 is never retried", async () => {
    const fetchImpl = vi.fn(async () => new Response(raw("event-not-found.json"), { status: 404, headers: { "content-type": "application/json" } }));
    const f = createHttpFetchJson(createHttpClient({ fetchImpl: fetchImpl as unknown as typeof fetch }), { timeoutMs: 1000 });
    expect((await fetchEventDetail(EVENT, f)).error).toBe(`fetch HTTP 404 ${U} reason=not_found`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a Cloudflare challenge keeps its cf-mitigated marker in the error", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>challenge</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } }));
    const f = createHttpFetchJson(createHttpClient({ fetchImpl: fetchImpl as unknown as typeof fetch }), { timeoutMs: 1000 });
    expect((await fetchEventDetail(EVENT, f)).error).toBe(`fetch HTTP 403 ${U} cf-mitigated=challenge`);
  });

  it("an HTML 200 page reports its real content type", async () => {
    const f = createHttpFetchJson(createReplayHttpClient({ [U]: { body: "<html>challenge</html>", contentType: "text/html; charset=utf-8" } }), { timeoutMs: 1000 });
    expect((await fetchEventDetail(EVENT, f)).error).toBe(`fetch non-JSON text/html; charset=utf-8 ${U}`);
  });

  it("forwards init.signal to the client", async () => {
    const http = createReplayHttpClient({ [U]: { body: "{}" } });
    const ctl = new AbortController();
    ctl.abort();
    const f = createHttpFetchJson(http, { timeoutMs: 1000 });
    await expect(f(U, { signal: ctl.signal })).rejects.toThrow(`fetch aborted ${U}`);
    expect(http.calls).toEqual([]);
  });
});

describe("totalbet transport (scraper)", () => {
  it("passes the budget signal to every request", async () => {
    const parent = new AbortController();
    const inner = fakeFetchJson();
    const spy = vi.fn<FetchJson>((url, init) => inner(url, init));
    await scraperWith({ fetchJson: spy }).scrapeFullOffer("premier-league", createScrapeBudget(60_000, parent.signal));
    expect(spy).toHaveBeenCalledTimes(21);
    parent.abort(new Error("late"));
    expect(spy.mock.calls.every(([, init]) => init?.signal?.aborted === true)).toBe(true);
  });

  it("a budget abort fails the scrape and writes nothing", async () => {
    const parent = new AbortController();
    const budget = createScrapeBudget(60_000, parent.signal);
    const s = scraperWith({ fetchJson: fakeFetchJson(() => parent.abort(new Error("shutdown"))) });
    expect(await s.scrapeFullOffer("premier-league", budget)).toMatchObject({ success: false, matches: [], error: "scrape aborted: shutdown" });
  });

  it("a detail aborted in flight by the budget fails the scrape without list-1X2 fallbacks", async () => {
    const parent = new AbortController();
    const budget = createScrapeBudget(60_000, parent.signal);
    const list = fakeFetchJson();
    let started = 0;
    const fetchJson: FetchJson = async (url, init) => {
      if (url === LIST_P1) return list(url, init);
      // The fourth detail start aborts the budget; every started detail answers "fetch aborted".
      if (++started === 4) parent.abort(new Error("shutdown"));
      return new Promise((_resolve, reject) => {
        const signal = init!.signal!;
        if (signal.aborted) reject(abortedError(url));
        else signal.addEventListener("abort", () => reject(abortedError(url)), { once: true });
      });
    };
    expect(await scraperWith({ fetchJson }).scrapeFullOffer("premier-league", budget)).toMatchObject({
      success: false, matches: [], error: "scrape aborted: shutdown" });
  });

  it("transportStats counts requests cumulatively", async () => {
    const s = scraperWith({ http: createReplayHttpClient(replayRoutes()) });
    await s.scrapeFullOffer("premier-league");
    expect(s.transportStats().http!.requests).toBe(21);
    await s.scrapeFullOffer("premier-league");
    expect(s.transportStats().http!.requests).toBe(42);
    expect(s.transportStats().http!.byStatus).toEqual({ "200": 6, "404": 36 });
  });

  it("transportStats returns copies and zero counters when a FetchJson is injected", async () => {
    const s = scraperWith({ fetchJson: fakeFetchJson() });
    await s.scrapeFullOffer("premier-league");
    const stats = s.transportStats();
    expect(stats.http).toEqual({ requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} });
    stats.http!.byStatus.x = 1;
    expect(s.transportStats().http!.byStatus).toEqual({});
  });

  it("declares the http transport", () => expect(new TotalbetPlaywrightScraper().transport).toBe("http"));
});
