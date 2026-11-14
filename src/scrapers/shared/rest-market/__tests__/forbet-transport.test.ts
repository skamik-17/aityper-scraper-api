import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { browserRuntime } from "../../../base/browser-runtime.js";
import { ForbetBrowserScraper } from "../../../bookmakers/index.js";
import { FORBET_REST_MARKET, ForbetHttpScraper } from "../brands/forbet.js";
import { driveBrowserScraperOffline, loadFixtureRoutes, withoutScrapedAt, type ReplayRoutes } from "./offline-harness.js";

const URLS = {
  list: "https://www.iforbet.pl/rest/market/categories/multi/199/events?gamesClass=major",
  detail: (id: string) => `https://www.iforbet.pl/rest/market/events/${id}`,
};
const IDS = ["57945888", "57945911", "57945945"];

async function bothPaths(routes: ReplayRoutes) {
  const replay = createReplayHttpClient(routes);
  const http = await new ForbetHttpScraper(replay).scrapeFullOffer("premier-league");
  const browserScraper = new ForbetBrowserScraper();
  driveBrowserScraperOffline(browserScraper, routes);
  const browser = await browserScraper.scrapeFullOffer("premier-league");
  return { http, browser, replay };
}

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("forbet over HTTP", () => {
  it("listing and detail URLs are byte-identical to the in-page fetches", () => {
    expect(FORBET_REST_MARKET.listingUrl(199)).toBe(URLS.list);
    expect(FORBET_REST_MARKET.detailUrl("1")).toBe(URLS.detail("1"));
  });

  it("declares transport http", () => expect(new ForbetHttpScraper().transport).toBe("http"));

  it("HTTP and browser paths produce deep-equal offers", async () => {
    const { http, browser } = await bothPaths(loadFixtureRoutes("forbet", URLS));
    expect(http.success).toBe(true);
    expect(http.matches.map((m) => m.matchId)).toEqual(IDS);
    expect(http.matches.map(withoutScrapedAt)).toEqual(browser.matches.map(withoutScrapedAt));
  });

  it("both paths skip a match whose detail returns 404 (no listing fallback)", async () => {
    const routes = loadFixtureRoutes("forbet", URLS);
    routes[URLS.detail("57945945")] = { status: 404, body: '{"code":404}' };
    const { http, browser } = await bothPaths(routes);
    expect(http.matches.map((m) => m.matchId)).toEqual(["57945888", "57945911"]);
    expect(browser.matches.map((m) => m.matchId)).toEqual(["57945888", "57945911"]);
    expect(http.matches.map(withoutScrapedAt)).toEqual(browser.matches.map(withoutScrapedAt));
    expect(http.success).toBe(true);
  });

  it("HTTP path fails the run when 2 of 3 details fail", async () => {
    const routes = loadFixtureRoutes("forbet", URLS);
    routes[URLS.detail("57945911")] = { status: 404, body: '{"code":404}' };
    routes[URLS.detail("57945945")] = { status: 404, body: '{"code":404}' };
    const r = await new ForbetHttpScraper(createReplayHttpClient(routes)).scrapeFullOffer("premier-league");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^2 of 3 details failed \| fetch HTTP 404 https:\/\/www\.iforbet\.pl\/rest\/market\/events\/579459(11|45)$/);
  });

  it("HTTP path requests the listing and 3 details and opens no browser", async () => {
    const openSession = vi.spyOn(browserRuntime, "openSession");
    const replay = createReplayHttpClient(loadFixtureRoutes("forbet", URLS));
    await new ForbetHttpScraper(replay).scrapeFullOffer("premier-league");
    expect([...replay.calls].sort()).toEqual([URLS.list, ...IDS.map(URLS.detail)].sort());
    expect(openSession).not.toHaveBeenCalled();
  });

  it("an empty listing is success:true with 0 matches", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { body: '{"code":200,"data":[]}' } });
    const r = await new ForbetHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, matches: [] });
    expect(replay.calls).toEqual([URLS.list]);
  });

  it("a challenged listing names SCRAPER_TRANSPORT_FORBET", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { status: 403, body: "<html>", contentType: "text/html" } });
    const r = await new ForbetHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r.error).toBe(`fetch HTTP 403 ${URLS.list} | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_FORBET=browser`);
  });
});
