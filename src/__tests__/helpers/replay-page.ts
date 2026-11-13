/**
 * Test-only offline driver for browser-path scrapers: a fake Playwright page whose
 * evaluate() runs the in-page function in Node and whose fetches (global fetch and
 * page.request.fetch) are served from a route table. No Chromium, no network.
 */
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { PlaywrightScraper } from "../../scrapers/base/playwright-base.js";
import type { FullMatchOffer, FullOfferScraperResult } from "../../types/full-offer.js";
import type { createReplayHttpClient } from "./replay-http.js";

export type ReplayRoutes = Parameters<typeof createReplayHttpClient>[0];

/** fetch() over `routes`: an Error route rejects, an unrouted URL answers 404 "not routed". Records every URL. */
function serveRoutes(routes: ReplayRoutes, calls: string[]) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route === undefined) return new Response("not routed", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "application/json" },
    });
  };
}

/** The page surface the scrapers and observability's navigation recorder use. */
function fakePage(fetchImpl: (url: string) => Promise<Response>) {
  return Object.assign(new EventEmitter(), {
    goto: async () => null,
    evaluate: (fn: (arg: unknown) => unknown, arg?: unknown) => fn(arg),
    request: {
      fetch: async (url: string) => {
        const res = await fetchImpl(url);
        const text = await res.text();
        return {
          ok: () => res.ok,
          status: () => res.status,
          json: async () => JSON.parse(text) as unknown,
          text: async () => text,
          dispose: async () => {},
        };
      },
    },
    mainFrame: () => ({}),
    url: () => "about:blank",
    title: async () => "",
  });
}

const session = (page: unknown) => ({ page, browser: {}, context: {}, cleanup: async () => {} });

/**
 * Points `scraper`'s browser path at `routes` for the rest of the test: initBrowser returns
 * the fake page, delay resolves at once, and the global fetch is stubbed (tests call
 * vi.unstubAllGlobals() in afterEach).
 */
export function driveBrowserScraperOffline(scraper: PlaywrightScraper, routes: ReplayRoutes): { calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = serveRoutes(routes, calls);
  const page = fakePage(fetchImpl);
  Object.assign(scraper as object, { initBrowser: async () => session(page), delay: async () => {} });
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  return { calls };
}

/** console.log lines written while `fn` runs (arguments joined by " "); they are not printed. */
export async function captureLogs<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    return { value: await fn(), logs };
  } finally {
    console.log = original;
  }
}

/**
 * One scrapeFullOffer over the browser path, offline. initBrowser and delay are spied on
 * the instance and globalThis.fetch is swapped for the call; all three are restored after.
 */
export async function runBrowserPathOffline(
  scraper: PlaywrightScraper,
  league: string,
  routes: ReplayRoutes,
): Promise<{ result: FullOfferScraperResult; requests: string[]; logs: string[] }> {
  const requests: string[] = [];
  const fetchImpl = serveRoutes(routes, requests);
  const page = fakePage(fetchImpl);
  const init = vi.spyOn(scraper as never, "initBrowser").mockResolvedValue(session(page) as never);
  const delay = vi.spyOn(scraper as never, "delay").mockResolvedValue(undefined as never);
  const before = globalThis.fetch;
  globalThis.fetch = fetchImpl as typeof fetch;
  try {
    const { value, logs } = await captureLogs(() => scraper.scrapeFullOffer(league));
    return { result: value, requests, logs };
  } finally {
    globalThis.fetch = before;
    init.mockRestore();
    delay.mockRestore();
  }
}

export function withoutScrapedAt(o: FullMatchOffer): Omit<FullMatchOffer, "scrapedAt"> {
  const { scrapedAt: _scrapedAt, ...rest } = o;
  return rest;
}

/** withoutScrapedAt over a list. */
export const stripScrapedAt = (ms: readonly FullMatchOffer[]): Array<Omit<FullMatchOffer, "scrapedAt">> => ms.map(withoutScrapedAt);

/** The identity fields of an offer, without its markets. */
export function envelope(
  m: FullMatchOffer,
): Pick<FullMatchOffer, "matchId" | "bookmaker" | "homeTeam" | "awayTeam" | "eventUrl" | "startTime"> {
  const { matchId, bookmaker, homeTeam, awayTeam, eventUrl, startTime } = m;
  return { matchId, bookmaker, homeTeam, awayTeam, eventUrl, startTime };
}
