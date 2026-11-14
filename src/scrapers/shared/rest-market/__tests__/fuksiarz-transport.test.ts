import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { browserRuntime } from "../../../base/browser-runtime.js";
import { FuksiarzBrowserScraper } from "../../../bookmakers/index.js";
import { FUKSIARZ_REST_MARKET, FuksiarzHttpScraper } from "../brands/fuksiarz.js";
import { driveBrowserScraperOffline, loadFixtureRoutes, withoutScrapedAt, type ReplayRoutes } from "./offline-harness.js";

const URLS = {
  list: "https://fuksiarz.pl/rest/market/categories/multi/625/events",
  detail: (id: string) => `https://fuksiarz.pl/rest/market/events/${id}`,
};
const IDS = ["23464740", "23464877", "23615576"];

async function bothPaths(routes: ReplayRoutes) {
  const replay = createReplayHttpClient(routes);
  const http = await new FuksiarzHttpScraper(replay).scrapeFullOffer("premier-league");
  const browserScraper = new FuksiarzBrowserScraper();
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

describe("fuksiarz over HTTP", () => {
  it("listing and detail URLs are byte-identical to the in-page fetches", () => {
    expect(FUKSIARZ_REST_MARKET.listingUrl(625)).toBe(URLS.list);
    expect(FUKSIARZ_REST_MARKET.detailUrl("1")).toBe(URLS.detail("1"));
  });

  it("declares transport http", () => expect(new FuksiarzHttpScraper().transport).toBe("http"));

  it("HTTP and browser paths produce deep-equal offers", async () => {
    const { http, browser } = await bothPaths(loadFixtureRoutes("fuksiarz", URLS));
    expect(http.success).toBe(true);
    expect(http.matches.map((m) => m.matchId)).toEqual(IDS);
    expect(http.matches.map(withoutScrapedAt)).toEqual(browser.matches.map(withoutScrapedAt));
  });

  it("both paths skip a match whose detail returns 404 (no listing fallback)", async () => {
    const routes = loadFixtureRoutes("fuksiarz", URLS);
    routes[URLS.detail("23615576")] = { status: 404, body: '{"code":404}' };
    const { http, browser } = await bothPaths(routes);
    expect(http.matches.map((m) => m.matchId)).toEqual(["23464740", "23464877"]);
    expect(browser.matches.map((m) => m.matchId)).toEqual(["23464740", "23464877"]);
    expect(http.matches.map(withoutScrapedAt)).toEqual(browser.matches.map(withoutScrapedAt));
    expect(http.success).toBe(true);
  });

  it("HTTP path fails the run when 2 of 3 details fail", async () => {
    const routes = loadFixtureRoutes("fuksiarz", URLS);
    routes[URLS.detail("23464877")] = { status: 404, body: '{"code":404}' };
    routes[URLS.detail("23615576")] = { status: 404, body: '{"code":404}' };
    const r = await new FuksiarzHttpScraper(createReplayHttpClient(routes)).scrapeFullOffer("premier-league");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^2 of 3 details failed \| fetch HTTP 404 https:\/\/fuksiarz\.pl\/rest\/market\/events\/(23464877|23615576)$/);
  });

  it("HTTP path requests the listing and 3 details and opens no browser", async () => {
    const openSession = vi.spyOn(browserRuntime, "openSession");
    const replay = createReplayHttpClient(loadFixtureRoutes("fuksiarz", URLS));
    await new FuksiarzHttpScraper(replay).scrapeFullOffer("premier-league");
    expect([...replay.calls].sort()).toEqual([URLS.list, ...IDS.map(URLS.detail)].sort());
    expect(openSession).not.toHaveBeenCalled();
  });

  it("an empty listing is success:true with 0 matches", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { body: '{"code":200,"data":[]}' } });
    const r = await new FuksiarzHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, matches: [] });
    expect(replay.calls).toEqual([URLS.list]);
  });

  it("a challenged listing names SCRAPER_TRANSPORT_FUKSIARZ", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { status: 403, body: "<html>", contentType: "text/html" } });
    const r = await new FuksiarzHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r.error).toBe(`fetch HTTP 403 ${URLS.list} | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_FUKSIARZ=browser`);
  });
});
