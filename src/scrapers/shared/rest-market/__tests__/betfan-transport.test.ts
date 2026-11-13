import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { browserRuntime } from "../../../base/browser-runtime.js";
import { BetfanBrowserScraper } from "../../../bookmakers/index.js";
import { BETFAN_REST_MARKET, BetfanHttpScraper } from "../brands/betfan.js";
import { driveBrowserScraperOffline, loadFixtureRoutes, withoutScrapedAt, type ReplayRoutes } from "./offline-harness.js";

const URLS = {
  list: "https://betfan.pl/api/v1/market/categories/244/events",
  detail: (id: string) => `https://betfan.pl/api/v1/market/events/${id}`,
};
const IDS = ["40932985", "40933001", "40932982"];

async function bothPaths(routes: ReplayRoutes) {
  const replay = createReplayHttpClient(routes);
  const http = await new BetfanHttpScraper(replay).scrapeFullOffer("premier-league");
  const browserScraper = new BetfanBrowserScraper();
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

describe("betfan over HTTP", () => {
  it("listing and detail URLs are byte-identical to the in-page fetches", () => {
    expect(BETFAN_REST_MARKET.listingUrl(244)).toBe(URLS.list);
    expect(BETFAN_REST_MARKET.detailUrl("1")).toBe(URLS.detail("1"));
  });

  it("declares transport http", () => expect(new BetfanHttpScraper().transport).toBe("http"));

  it("HTTP and browser paths produce deep-equal offers", async () => {
    const { http, browser } = await bothPaths(loadFixtureRoutes("betfan", URLS));
    expect(http.success).toBe(true);
    expect(http.matches.map((m) => m.matchId)).toEqual(IDS);
    expect(http.matches.map(withoutScrapedAt)).toEqual(browser.matches.map(withoutScrapedAt));
  });

  it("both paths skip a match whose detail returns 404 (no listing fallback)", async () => {
    const routes = loadFixtureRoutes("betfan", URLS);
    routes[URLS.detail("40933001")] = { status: 404, body: '{"code":404}' };
    const { http, browser } = await bothPaths(routes);
    expect(http.matches.map((m) => m.matchId)).toEqual(["40932985", "40932982"]);
    expect(browser.matches.map((m) => m.matchId)).toEqual(["40932985", "40932982"]);
    expect(http.matches.map(withoutScrapedAt)).toEqual(browser.matches.map(withoutScrapedAt));
    expect(http.success).toBe(true);
  });

  it("HTTP path fails the run when 2 of 3 details fail", async () => {
    const routes = loadFixtureRoutes("betfan", URLS);
    routes[URLS.detail("40933001")] = { status: 404, body: '{"code":404}' };
    routes[URLS.detail("40932982")] = { status: 404, body: '{"code":404}' };
    const r = await new BetfanHttpScraper(createReplayHttpClient(routes)).scrapeFullOffer("premier-league");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^2 of 3 details failed \| fetch HTTP 404 https:\/\/betfan\.pl\/api\/v1\/market\/events\/(40933001|40932982)$/);
  });

  it("HTTP path requests the listing and 3 details and opens no browser", async () => {
    const openSession = vi.spyOn(browserRuntime, "openSession");
    const replay = createReplayHttpClient(loadFixtureRoutes("betfan", URLS));
    await new BetfanHttpScraper(replay).scrapeFullOffer("premier-league");
    expect([...replay.calls].sort()).toEqual([URLS.list, ...IDS.map(URLS.detail)].sort());
    expect(openSession).not.toHaveBeenCalled();
  });

  it("skips betfan's error envelope", async () => {
    const routes = loadFixtureRoutes("betfan", URLS);
    routes[URLS.detail("40933001")] = { body: '{"isError":true,"code":404,"data":null}' };
    const replay = createReplayHttpClient(routes);
    const http = await new BetfanHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(http.error).toBe(`1 of 3 details failed | detail without event data ${URLS.detail("40933001")}`);
    const { browser } = await bothPaths(routes);
    expect(http.matches.map((m) => m.matchId)).toEqual(["40932985", "40932982"]);
    expect(browser.matches.map((m) => m.matchId)).toEqual(["40932985", "40932982"]);
  });

  it("a category list without events is an empty listing", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { body: '{"isError":false,"code":200,"data":{"categories":[]}}' } });
    const r = await new BetfanHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, matches: [] });
    expect(replay.calls).toEqual([URLS.list]);
    expect(console.warn).toHaveBeenCalledWith(`[Betfan/FullOffer] No events found from API ${URLS.list}`);
  });

  it("a listing without categories is an error", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { body: '{"isError":true,"code":500,"data":null}' } });
    const r = await new BetfanHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, error: `listing without events ${URLS.list}` });
  });

  it("an empty listing is success:true with 0 matches", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { body: '{"isError":false,"code":200,"data":{"categories":[{"events":[]}]}}' } });
    const r = await new BetfanHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, matches: [] });
    expect(replay.calls).toEqual([URLS.list]);
  });

  it("a challenged listing names SCRAPER_TRANSPORT_BETFAN", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { status: 403, body: "<html>", contentType: "text/html" } });
    const r = await new BetfanHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r.error).toBe(`fetch HTTP 403 ${URLS.list} | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_BETFAN=browser`);
  });
});
