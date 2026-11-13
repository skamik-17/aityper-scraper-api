import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { browserPool } from "../../../base/browser-pool.js";
import { EtotoBrowserScraper } from "../../../bookmakers/index.js";
import { ETOTO_REST_MARKET, EtotoHttpScraper } from "../brands/etoto.js";
import { driveBrowserScraperOffline, loadFixtureRoutes, withoutScrapedAt, type ReplayRoutes } from "./offline-harness.js";

const URLS = {
  list: "https://api.etoto.pl/rest/market/categories/multi/206/events",
  detail: (id: string) => `https://api.etoto.pl/rest/market/events/${id}`,
};
const IDS = ["6224070", "6224074", "6224078"];
const comboEvent = JSON.parse(readFileSync(new URL("./fixtures/etoto/list.json", import.meta.url), "utf8")).data.find(
  (e: { eventId: number }) => e.eventId === 6262615,
);

async function bothPaths(routes: ReplayRoutes) {
  const replay = createReplayHttpClient(routes);
  const http = await new EtotoHttpScraper(replay).scrapeFullOffer("premier-league");
  const browserScraper = new EtotoBrowserScraper();
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

describe("etoto over HTTP", () => {
  it("listing and detail URLs are byte-identical to the in-page fetches", () => {
    expect(ETOTO_REST_MARKET.listingUrl(206)).toBe(URLS.list);
    expect(ETOTO_REST_MARKET.detailUrl("1")).toBe(URLS.detail("1"));
  });

  it("declares transport http", () => expect(new EtotoHttpScraper().transport).toBe("http"));

  it("HTTP and browser paths produce deep-equal offers", async () => {
    const { http, browser } = await bothPaths(loadFixtureRoutes("etoto", URLS));
    expect(http.success).toBe(true);
    expect(http.matches.map((m) => m.matchId)).toEqual(IDS);
    expect(http.matches.map(withoutScrapedAt)).toEqual(browser.matches.map(withoutScrapedAt));
  });

  it("both paths skip a match whose detail returns 404 (no listing fallback)", async () => {
    const routes = loadFixtureRoutes("etoto", URLS);
    routes[URLS.detail("6224078")] = { status: 404, body: '{"code":404}' };
    const { http, browser } = await bothPaths(routes);
    expect(http.matches.map((m) => m.matchId)).toEqual(["6224070", "6224074"]);
    expect(browser.matches.map((m) => m.matchId)).toEqual(["6224070", "6224074"]);
    expect(http.matches.map(withoutScrapedAt)).toEqual(browser.matches.map(withoutScrapedAt));
    expect(http.success).toBe(true);
  });

  it("HTTP path fails the run when 2 of 3 details fail", async () => {
    const routes = loadFixtureRoutes("etoto", URLS);
    routes[URLS.detail("6224074")] = { status: 404, body: '{"code":404}' };
    routes[URLS.detail("6224078")] = { status: 404, body: '{"code":404}' };
    const r = await new EtotoHttpScraper(createReplayHttpClient(routes)).scrapeFullOffer("premier-league");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^2 of 3 details failed \| fetch HTTP 404 https:\/\/api\.etoto\.pl\/rest\/market\/events\/62240(74|78)$/);
  });

  it("HTTP path requests the listing and 3 details and opens no browser", async () => {
    const acquire = vi.spyOn(browserPool, "acquire");
    const replay = createReplayHttpClient(loadFixtureRoutes("etoto", URLS));
    await new EtotoHttpScraper(replay).scrapeFullOffer("premier-league");
    expect([...replay.calls].sort()).toEqual([URLS.list, ...IDS.map(URLS.detail)].sort());
    expect(acquire).not.toHaveBeenCalled();
  });

  it("listing of only combo events", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { body: JSON.stringify({ code: 200, data: [comboEvent] }) } });
    const r = await new EtotoHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, matches: [] });
    expect(replay.calls).toEqual([URLS.list]);
  });

  it("an empty listing is success:true with 0 matches", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { body: '{"code":200,"data":[]}' } });
    const r = await new EtotoHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, matches: [] });
    expect(replay.calls).toEqual([URLS.list]);
  });

  it("a challenged listing names SCRAPER_TRANSPORT_ETOTO", async () => {
    const replay = createReplayHttpClient({ [URLS.list]: { status: 403, body: "<html>", contentType: "text/html" } });
    const r = await new EtotoHttpScraper(replay).scrapeFullOffer("premier-league");
    expect(r.error).toBe(`fetch HTTP 403 ${URLS.list} | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser`);
  });
});
