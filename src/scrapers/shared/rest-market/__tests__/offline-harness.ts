/**
 * Test-only helpers for the /rest/market brands: fixture routes, and an offline driver
 * that runs a brand's browser scraper against those routes (no Chromium, no network).
 */
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { vi } from "vitest";
import type { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import type { FullMatchOffer } from "../../../../types/full-offer.js";
import type { PlaywrightScraper } from "../../../base/playwright-base.js";

export type ReplayRoutes = Parameters<typeof createReplayHttpClient>[0];
export type RestMarketBrandDir = "etoto" | "forbet" | "fuksiarz" | "betfan";

const FIXTURES = new URL("./fixtures/", import.meta.url);

/** `fixtures/<dir>/list.json` at urls.list, and every `detail-<id>.json` at urls.detail(id). */
export function loadFixtureRoutes(dir: RestMarketBrandDir, urls: { list: string; detail: (id: string) => string }): ReplayRoutes {
  const base = new URL(`${dir}/`, FIXTURES);
  const routes: ReplayRoutes = { [urls.list]: { body: readFileSync(new URL("list.json", base), "utf8") } };
  for (const file of readdirSync(base)) {
    const id = /^detail-(.+)\.json$/.exec(file)?.[1];
    if (id !== undefined) routes[urls.detail(id)] = { body: readFileSync(new URL(file, base), "utf8") };
  }
  return routes;
}

/**
 * Runs `scraper`'s browser path offline: initBrowser returns a fake page whose evaluate()
 * runs the in-page function in Node, and the global fetch serves `routes` (an Error route
 * throws, a missing one answers 404). Tests call vi.unstubAllGlobals() in afterEach.
 */
export function driveBrowserScraperOffline(scraper: PlaywrightScraper, routes: ReplayRoutes): { calls: string[] } {
  const calls: string[] = [];
  const page = Object.assign(new EventEmitter(), {
    goto: async () => null,
    evaluate: (fn: (arg: unknown) => unknown, arg?: unknown) => fn(arg),
    mainFrame: () => ({}),
    url: () => "about:blank",
    title: async () => "",
  });
  Object.assign(scraper as object, {
    initBrowser: async () => ({ page, browser: {}, context: {}, cleanup: async () => {} }),
    delay: async () => {},
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      const route = routes[url];
      if (route instanceof Error) throw route;
      if (route === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      return new Response(route.body, { status: route.status ?? 200, headers: { "content-type": route.contentType ?? "application/json" } });
    }),
  );
  return { calls };
}

export function withoutScrapedAt(o: FullMatchOffer): Omit<FullMatchOffer, "scrapedAt"> {
  const { scrapedAt: _scrapedAt, ...rest } = o;
  return rest;
}
