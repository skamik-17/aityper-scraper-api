import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBudget } from "../../../__tests__/helpers/run-fixtures.js";
import type { FullOfferScraperResult } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS, type ScraperConfig } from "../../../types/scraper.js";
import { runInScrapeJob } from "../../shared/job-context.js";

vi.mock("../browser-runtime.js", async (orig) => ({
  ...(await orig<typeof import("../browser-runtime.js")>()),
  browserRuntime: { openSession: vi.fn(), closeAll: vi.fn(), closeIfIdle: vi.fn(), activeSessions: 0, waitingSessions: 0 },
}));

const { browserRuntime } = await import("../browser-runtime.js");
const { PlaywrightScraper } = await import("../playwright-base.js");
const { browserPool } = await import("../browser-pool.js");
const { closeAllBrowsers } = await import("../../aggregator.js");

class TestScraper extends PlaywrightScraper {
  bookmaker = "sts" as const;
  config: ScraperConfig = DEFAULT_SCRAPER_CONFIGS.sts;
}

interface FakeSessionOpts {
  crashed?: boolean;
  remainingMs?: number;
  lifetimeMs?: number;
  runtime?: boolean;
}

function fakeSession(o: FakeSessionOpts = {}) {
  const close = vi.fn(async () => {});
  return {
    page: new EventEmitter(),
    browser: {},
    context: { close },
    cleanup: vi.fn(async () => {}),
    ...(o.runtime === false
      ? {}
      : {
          runtime: {
            crashed: () => o.crashed ?? false,
            remainingMs: () => o.remainingMs ?? 240_000,
            lifetimeMs: o.lifetimeMs ?? 240_000,
          },
        }),
  };
}

const CLOSED = "Target page, context or browser has been closed";

beforeEach(() => {
  vi.mocked(browserRuntime.openSession).mockReset().mockResolvedValue(fakeSession() as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PlaywrightScraper on the browser runtime", () => {
  it("initBrowser opens a runtime session with the resolved policy and the sts lifetime", async () => {
    await (new TestScraper() as any).initBrowser();
    expect(browserRuntime.openSession).toHaveBeenCalledWith({
      bookmaker: "sts",
      policy: { block: "none", stealth: false, maxSessionMs: 360_000 },
      signal: undefined,
      maxSessionMs: 360_000,
    });
  });

  it("initBrowser(budget) bounds the session by the budget", async () => {
    vi.useFakeTimers({ now: 0 });
    const b = fakeBudget(50_000);
    await (new TestScraper() as any).initBrowser(b);
    expect(browserRuntime.openSession).toHaveBeenCalledWith(expect.objectContaining({ signal: b.signal, maxSessionMs: 50_000 }));
  });

  it("initBrowser falls back to the job budget (plan 07 currentScrapeJob; Review Focus 6)", async () => {
    vi.useFakeTimers({ now: 0 });
    const b = fakeBudget(50_000);
    await runInScrapeJob({ runId: "r", bookmaker: "sts", league: "premier-league", transport: "browser", budget: b }, () =>
      (new TestScraper() as any).initBrowser(),
    );
    expect(browserRuntime.openSession).toHaveBeenCalledWith(expect.objectContaining({ signal: b.signal, maxSessionMs: 50_000 }));
  });

  it("the policy lifetime caps a longer budget", async () => {
    vi.useFakeTimers({ now: 0 });
    await (new TestScraper() as any).initBrowser(fakeBudget(900_000));
    expect(browserRuntime.openSession).toHaveBeenCalledWith(expect.objectContaining({ maxSessionMs: 360_000 }));
  });

  it("executeFullOfferScrape forwards its budget to initBrowser", async () => {
    const s = new TestScraper() as any;
    const spy = vi.spyOn(s, "initBrowser");
    const b = fakeBudget(Date.now() + 50_000);
    const logic = vi.fn(async (): Promise<FullOfferScraperResult> => ({ success: true, bookmaker: "sts", league: "premier-league", matches: [{} as never] }));
    await s.executeFullOfferScrape("premier-league", () => true, logic, b);
    expect(spy).toHaveBeenCalledWith(b);
    expect(logic).toHaveBeenCalledTimes(1);
  });

  it("retries once on a crashed session with >= 40% lifetime left, inside the remaining time", async () => {
    vi.useFakeTimers({ now: 0 });
    const first = fakeSession({ crashed: true, remainingMs: 200_000, lifetimeMs: 240_000 });
    const second = fakeSession({ crashed: false });
    const spy = vi.spyOn(TestScraper.prototype as any, "initBrowser").mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const op = vi.fn().mockRejectedValueOnce(new Error(CLOSED)).mockResolvedValueOnce("ok");
    await expect((new TestScraper() as any).executeWithBrowser(op, () => "err")).resolves.toBe("ok");
    expect(first.cleanup.mock.invocationCallOrder[0]).toBeLessThan(spy.mock.invocationCallOrder[1]);
    expect((spy.mock.calls[1][0] as { deadline: number }).deadline).toBe(200_000);
    expect(first.cleanup).toHaveBeenCalledTimes(1);
    expect(second.cleanup).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("[sts] browser disconnected mid-session; retrying once (200s of 240s left)");
  });

  it("retries a crashed session whose operation resolved, and only once", async () => {
    vi.useFakeTimers({ now: 0 });
    const first = fakeSession({ crashed: true, remainingMs: 200_000, lifetimeMs: 240_000 });
    const second = fakeSession({ crashed: true, remainingMs: 200_000, lifetimeMs: 240_000 });
    const spy = vi.spyOn(TestScraper.prototype as any, "initBrowser").mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const op = vi.fn().mockResolvedValueOnce("partial-1").mockResolvedValueOnce("partial-2");
    await expect((new TestScraper() as any).executeWithBrowser(op, () => "err")).resolves.toBe("partial-2");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(second.cleanup).toHaveBeenCalledTimes(1);
  });

  it("an explicit budget is reused for the retry", async () => {
    vi.useFakeTimers({ now: 0 });
    const b = fakeBudget(300_000);
    const first = fakeSession({ crashed: true, remainingMs: 200_000, lifetimeMs: 240_000 });
    const spy = vi.spyOn(TestScraper.prototype as any, "initBrowser").mockResolvedValueOnce(first).mockResolvedValueOnce(fakeSession());
    await (new TestScraper() as any).executeWithBrowser(vi.fn().mockRejectedValueOnce(new Error(CLOSED)).mockResolvedValueOnce("ok"), () => "err", b);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([b, b]);
  });

  it("does not retry with < 40% left and hands the error to errorHandler", async () => {
    const first = fakeSession({ crashed: true, remainingMs: 60_000, lifetimeMs: 240_000 });
    const spy = vi.spyOn(TestScraper.prototype as any, "initBrowser").mockResolvedValueOnce(first);
    const errorHandler = vi.fn((e: unknown) => `handled: ${(e as Error).message}`);
    const r = await (new TestScraper() as any).executeWithBrowser(vi.fn().mockRejectedValue(new Error(CLOSED)), errorHandler);
    expect(r).toBe(`handled: ${CLOSED}`);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.cleanup).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("[sts] browser disconnected mid-session; not retrying (60s of 240s left)");
  });

  it("never retries a mocked session without runtime info", async () => {
    const first = fakeSession({ runtime: false });
    const spy = vi.spyOn(TestScraper.prototype as any, "initBrowser").mockResolvedValueOnce(first);
    const r = await (new TestScraper() as any).executeWithBrowser(vi.fn().mockRejectedValue(new Error(CLOSED)), () => "err");
    expect(r).toBe("err");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.cleanup).toHaveBeenCalledTimes(1);
  });

  it("closeAllBrowsers and browserPool.closeAll delegate to browserRuntime.closeAll", async () => {
    await closeAllBrowsers();
    await browserPool.closeAll();
    expect(browserRuntime.closeAll).toHaveBeenCalledTimes(2);
  });

  it("browserPool.acquire is retired", async () => expect(browserPool.acquire()).rejects.toThrow("browserPool.acquire() is retired"));

  it("the dead route/stealth path is gone", () => {
    const src = readFileSync(new URL("../playwright-base.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\.route\(|applyStealthScripts|BLOCKED_RESOURCE_TYPES|disableResourceBlocking|DEFAULT_USER_AGENT|browserPool/);
  });
});
