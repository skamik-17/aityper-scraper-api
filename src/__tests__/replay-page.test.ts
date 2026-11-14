import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserRuntime } from "../scrapers/base/browser-runtime.js";
import { PlaywrightScraper } from "../scrapers/base/playwright-base.js";
import type { FullOfferScraperResult } from "../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS, type ScraperConfig } from "../types/scraper.js";
import { driveBrowserScraperOffline, runBrowserPathOffline, withoutScrapedAt, type ReplayRoutes } from "./helpers/replay-page.js";

class Probe extends PlaywrightScraper {
  bookmaker = "fortuna" as const;
  config: ScraperConfig = DEFAULT_SCRAPER_CONFIGS.fortuna;

  constructor(private readonly logic: (page: Page) => Promise<void>) {
    super();
  }

  scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    return this.executeFullOfferScrape(league, () => true, async (page) => {
      await this.logic(page);
      return { success: true, bookmaker: "fortuna", league, matches: [] };
    });
  }
}

const ROUTES: ReplayRoutes = {
  "https://api.test/a": { body: '{"v":1}' },
  "https://api.test/b": { body: '{"v":2}' },
  "https://api.test/down": new Error("socket hang up"),
};

afterEach(() => vi.restoreAllMocks());

describe("runBrowserPathOffline", () => {
  it("serves page.evaluate(fetch) and page.request.fetch from the routes and records every URL", async () => {
    const probe = new Probe(async (page) => {
      await page.goto("https://site.test/");
      const a = await page.evaluate(async (u) => (await (await fetch(u)).json()).v, "https://api.test/a");
      const b = await (await page.request.fetch("https://api.test/b")).json();
      const c = await page.evaluate(async (u) => (await fetch(u)).status, "https://api.test/unrouted");
      console.log(`[Probe] ${a} ${b.v} ${c}`);
    });
    const { result, requests, logs } = await runBrowserPathOffline(probe, "premier-league", ROUTES);
    expect(result.success).toBe(true);
    expect(requests).toEqual(["https://api.test/a", "https://api.test/b", "https://api.test/unrouted"]);
    expect(logs).toContain("[Probe] 1 2 404");
  });

  it("an Error route rejects fetch with that error", async () => {
    const probe = new Probe(async (page) => {
      await page.evaluate(async (u) => fetch(u), "https://api.test/down");
    });
    // toMatchObject: the failed result also carries observability's `diagnostics`
    expect((await runBrowserPathOffline(probe, "premier-league", ROUTES)).result).toMatchObject({ success: false, error: "socket hang up" });
  });

  it("moved names are still reachable from plan 03's harness path", async () => {
    const old = await import("../scrapers/shared/rest-market/__tests__/offline-harness.js");
    expect(old.driveBrowserScraperOffline).toBe(driveBrowserScraperOffline);
    expect(old.withoutScrapedAt).toBe(withoutScrapedAt);
  });

  it("never acquires a browser and restores globalThis.fetch", async () => {
    const openSession = vi.spyOn(browserRuntime, "openSession");
    const before = globalThis.fetch;
    await runBrowserPathOffline(new Probe(async () => {}), "premier-league", ROUTES);
    expect(openSession).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(before);
  });

  it("offers the hooks observability's navigation recorder attaches to", async () => {
    const probe = new Probe(async (page) => {
      const h = () => {};
      page.on("request", h);
      page.off("request", h);
      console.log(`[Probe] ${page.url()} "${await page.title()}" ${typeof page.mainFrame()}`);
    });
    expect((await runBrowserPathOffline(probe, "premier-league", ROUTES)).logs).toContain('[Probe] about:blank "" object');
  });
});
