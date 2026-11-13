import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockedUrlPatterns, DEFAULT_BROWSER_POLICY } from "../browser-policy.js";
import { BROWSER_ARGS, BROWSER_CONTEXT_USER_AGENT, BrowserRuntime } from "../browser-runtime.js";
import { createFakeLauncher, type FakeLauncher } from "./helpers/fake-playwright.js";

let fake: FakeLauncher;
let rt: BrowserRuntime;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fake = createFakeLauncher();
  rt = new BrowserRuntime({ maxSessions: 3, idleCloseMs: 60_000, launcher: fake.launcher });
});

afterEach(async () => {
  await rt.closeAll().catch(() => {});
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const open = (bookmaker: "sts" | "fortuna" | "pzbuk" = "sts", extra: { signal?: AbortSignal; maxSessionMs?: number } = {}) =>
  rt.openSession({ bookmaker, maxSessionMs: extra.maxSessionMs ?? 10_000, signal: extra.signal });

describe("BrowserRuntime", () => {
  it("launches once for concurrent sessions (single-flight) with the headless shell and BROWSER_ARGS", async () => {
    await Promise.all([1, 2, 3].map(() => open()));
    expect(fake.launchCalls).toEqual([{ headless: true, args: [...BROWSER_ARGS] }]);
    expect(fake.browsers[0].contexts).toHaveLength(3);
  });

  it("launch args never carry --disable-features (ported from plan 01's browser-pool.test.ts)", () =>
    expect(BROWSER_ARGS.filter((a) => a.startsWith("--disable-features"))).toEqual([]));

  it("creates one context per session with the lean defaults", async () => {
    await open();
    expect(fake.browsers[0].contexts[0].options).toEqual({
      userAgent: BROWSER_CONTEXT_USER_AGENT,
      locale: "pl-PL",
      viewport: { width: 1366, height: 768 },
      serviceWorkers: "block",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });
    expect(BROWSER_CONTEXT_USER_AGENT).toContain("Chrome/120.0.0.0");
  });

  it("caps sessions at maxSessions and hands the permit to the next waiter on cleanup", async () => {
    rt = new BrowserRuntime({ maxSessions: 2, idleCloseMs: 60_000, launcher: fake.launcher });
    const s1 = await open();
    await open();
    let third: unknown = null;
    const p3 = open().then((s) => (third = s));
    await new Promise((r) => setTimeout(r, 5));
    expect([third, rt.activeSessions, rt.waitingSessions]).toEqual([null, 2, 1]);
    expect(console.log).toHaveBeenCalledWith("[BrowserRuntime] sts waiting for a browser session (2/2 in use)");
    await s1.cleanup();
    await p3;
    expect(third).not.toBeNull();
    expect([rt.activeSessions, rt.waitingSessions]).toEqual([2, 0]);
    expect(fake.browsers[0].contexts[0].closed).toBe(true);
  });

  it("a waiter whose signal aborts rejects with the reason and consumes no permit", async () => {
    rt = new BrowserRuntime({ maxSessions: 1, idleCloseMs: 60_000, launcher: fake.launcher });
    await open();
    const ac = new AbortController();
    const p = open("fortuna", { signal: ac.signal });
    ac.abort(new Error("deadline"));
    await expect(p).rejects.toThrow("deadline");
    expect([rt.activeSessions, rt.waitingSessions]).toEqual([1, 0]);
    expect(fake.browsers[0].contexts).toHaveLength(1);
  });

  it("closeAll rejects waiters, closes every context and the browser; the next session relaunches", async () => {
    rt = new BrowserRuntime({ maxSessions: 1, idleCloseMs: 60_000, launcher: fake.launcher });
    await open();
    const waiter = open();
    await rt.closeAll();
    await expect(waiter).rejects.toThrow("BrowserRuntime closeAll");
    expect(fake.browsers[0].contexts[0].closed).toBe(true);
    expect(fake.browsers[0].closed).toBe(true);
    expect(rt.activeSessions).toBe(0);
    await open();
    expect(fake.launchCalls).toHaveLength(2);
  });

  it("closes the idle browser after idleCloseMs; a session opened earlier cancels the timer", async () => {
    vi.useFakeTimers();
    const s = await open();
    await s.cleanup();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fake.browsers[0].closed).toBe(false);
    const s2 = await open();
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.browsers[0].closed).toBe(false);
    await s2.cleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.browsers[0].closed).toBe(true);
  });

  it("closeIfIdle closes at once with no sessions and is a no-op while one is open", async () => {
    const s = await open();
    await rt.closeIfIdle();
    expect(fake.browsers[0].closed).toBe(false);
    await s.cleanup();
    await rt.closeIfIdle();
    expect(fake.browsers[0].closed).toBe(true);
  });

  it("closeIfIdle without a browser launches nothing", async () => {
    await rt.closeIfIdle();
    expect(fake.launchCalls).toEqual([]);
  });

  it("disconnect frees permits and the waiter runs on generation 2", async () => {
    rt = new BrowserRuntime({ maxSessions: 2, idleCloseMs: 60_000, launcher: fake.launcher });
    const s1 = await open();
    const s2 = await open();
    const p3 = open("fortuna");
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.waitingSessions).toBe(1);
    fake.browsers[0].crash();
    expect([s1.runtime!.crashed(), s2.runtime!.crashed()]).toEqual([true, true]);
    expect(s1.runtime!.remainingMs()).toBeGreaterThan(0);
    const s3 = await p3;
    expect(s3.browser).toBe(fake.browsers[1]);
    expect(fake.launchCalls).toHaveLength(2);
    expect(s3.runtime!.crashed()).toBe(false);
    expect(console.log).toHaveBeenCalledWith("[BrowserRuntime] browser disconnected (generation 1, 2 open sessions failed)");
  });

  it("a launch failure rejects every single-flight caller, frees their permits, and the next call launches again", async () => {
    fake.failNext(new Error("spawn failed"));
    const results = await Promise.allSettled([open(), open()]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect((results[0] as PromiseRejectedResult).reason.message).toBe("spawn failed");
    expect(rt.activeSessions).toBe(0);
    const s = await open();
    expect(s.browser).toBe(fake.browsers[0]);
    expect(fake.launchCalls).toHaveLength(2);
  });

  it("closeAll during launch closes the late browser", async () => {
    fake = createFakeLauncher({ deferred: true });
    rt = new BrowserRuntime({ maxSessions: 3, idleCloseMs: 60_000, launcher: fake.launcher });
    const pending = open();
    await new Promise((r) => setTimeout(r, 5));
    const closing = rt.closeAll();
    fake.finishLaunch();
    await closing;
    await expect(pending).rejects.toThrow("BrowserRuntime is closing");
    expect(fake.browsers[0].closed).toBe(true);
    expect(fake.browsers[0].contexts).toHaveLength(0);
    expect(rt.activeSessions).toBe(0);
  });

  it("lifetime expiry closes the context and frees the permit without cleanup", async () => {
    vi.useFakeTimers();
    const s = await rt.openSession({ bookmaker: "pzbuk", maxSessionMs: 1000 });
    expect(s.runtime!.lifetimeMs).toBe(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.browsers[0].contexts[0].closeReason).toBe("browser session exceeded 1000ms");
    expect(s.runtime!.remainingMs()).toBe(0);
    expect(rt.activeSessions).toBe(0);
  });

  it("signal abort after the grant closes the context with the reason; cleanup twice releases once", async () => {
    rt = new BrowserRuntime({ maxSessions: 1, idleCloseMs: 60_000, launcher: fake.launcher });
    const ac = new AbortController();
    const s = await open("sts", { signal: ac.signal });
    ac.abort(new Error("scrape budget of 5000ms exceeded"));
    await vi.waitFor(() => expect(fake.browsers[0].contexts[0].closeReason).toBe("scrape budget of 5000ms exceeded"));
    expect(s.runtime!.remainingMs()).toBe(0);
    expect(rt.activeSessions).toBe(0);
    const other = await open();
    await s.cleanup();
    await s.cleanup();
    expect(rt.activeSessions).toBe(1);
    await other.cleanup();
    expect(rt.activeSessions).toBe(0);
  });

  it("an already-aborted signal opens no session", async () => {
    const ac = new AbortController();
    ac.abort(new Error("gone"));
    await expect(open("sts", { signal: ac.signal })).rejects.toThrow("gone");
    expect(fake.launchCalls).toEqual([]);
  });

  it("openSession during closeAll rejects with 'BrowserRuntime is closing'", async () => {
    await open();
    const closing = rt.closeAll();
    await expect(open()).rejects.toThrow("BrowserRuntime is closing");
    await closing;
  });

  it("a failing newContext frees the permit and rejects", async () => {
    rt = new BrowserRuntime({ maxSessions: 1, idleCloseMs: 60_000, launcher: fake.launcher });
    await open().then((s) => s.cleanup());
    vi.spyOn(fake.browsers[0], "newContext").mockRejectedValueOnce(new Error("newContext boom"));
    await expect(open()).rejects.toThrow("newContext boom");
    expect(rt.activeSessions).toBe(0);
  });
});

describe("page setup and stats", () => {
  const MEDIA = { ...DEFAULT_BROWSER_POLICY, block: "media" as const };

  it("prepares the first page before openSession resolves", async () => {
    const s = await rt.openSession({ bookmaker: "fortuna", maxSessionMs: 10_000, policy: MEDIA });
    const cdp = fake.browsers[0].contexts[0].cdpOf(s.page);
    expect(cdp.sent.map((x) => x.method)).toEqual(["Network.enable", "Network.setBlockedURLs"]);
    expect(cdp.sent[1].params).toEqual({ urlPatterns: blockedUrlPatterns("media").map((urlPattern) => ({ urlPattern, block: true })) });
  });

  it("policy none sends no setBlockedURLs and never routes", async () => {
    const s = await rt.openSession({ bookmaker: "fortuna", maxSessionMs: 10_000 });
    const ctx = fake.browsers[0].contexts[0];
    expect(ctx.cdpOf(s.page).sent.map((x) => x.method)).toEqual(["Network.enable"]);
    expect(ctx.routeCalls).toBe(0);
  });

  it("popup pages are prepared too", async () => {
    await rt.openSession({ bookmaker: "fortuna", maxSessionMs: 10_000, policy: MEDIA });
    const ctx = fake.browsers[0].contexts[0];
    const p = await ctx.openPopup();
    await vi.waitFor(() => expect(ctx.cdpOf(p).sent.map((x) => x.method)).toEqual(["Network.enable", "Network.setBlockedURLs"]));
  });

  it("a failing setBlockedURLs degrades with one warning and the session still opens", async () => {
    await open().then((s) => s.cleanup());
    fake.browsers[0].cdpFailOn.add("Network.setBlockedURLs");
    const s = await rt.openSession({ bookmaker: "fortuna", maxSessionMs: 10_000, policy: MEDIA });
    const ctx = fake.browsers[0].contexts[1];
    await ctx.openPopup();
    await vi.waitFor(() => expect(ctx.pages).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 5));
    const lines = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes("page setup degraded"));
    expect(lines).toEqual([["[BrowserRuntime] fortuna page setup degraded: Network.setBlockedURLs Network.setBlockedURLs failed"]]);
    expect(ctx.cdpOf(s.page).sent.map((x) => x.method)).toEqual(["Network.enable", "Network.setBlockedURLs"]);
  });

  it("counts requests, bytes and blocked requests", async () => {
    const s = await open();
    const cdp = fake.browsers[0].contexts[0].cdpOf(s.page);
    cdp.emit("Network.loadingFinished", { encodedDataLength: 1000 });
    cdp.emit("Network.loadingFinished", { encodedDataLength: 1000 });
    cdp.emit("Network.loadingFailed", { blockedReason: "inspector" });
    cdp.emit("Network.loadingFailed", { errorText: "net::ERR_FAILED" });
    expect(rt.stats()).toMatchObject({ launches: 1, sessions: 1, requests: 4, encodedBytes: 2000, blockedRequests: 1 });
  });

  it("sums Chromium CPU keeping the max per pid", async () => {
    const s = await open();
    fake.browsers[0].processInfo = [{ id: 1, cpuTime: 1.5 }, { id: 2, cpuTime: 0.5 }];
    await s.cleanup();
    fake.browsers[0].processInfo = [{ id: 1, cpuTime: 2.0 }];
    expect(rt.stats().chromiumCpuMs).toBe(2000);
    const log = vi.mocked(console.log);
    await rt.closeAll();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[BrowserRuntime\] closed \(closeAll\): .* chromiumCpuMs=2500$/));
  });

  it("logs the closed line on closeAll and resets the counters", async () => {
    const s = await open();
    const cdp = fake.browsers[0].contexts[0].cdpOf(s.page);
    cdp.emit("Network.loadingFinished", { encodedDataLength: 1000 });
    cdp.emit("Network.loadingFinished", { encodedDataLength: 1000 });
    cdp.emit("Network.loadingFailed", { blockedReason: "inspector" });
    fake.browsers[0].processInfo = [{ id: 1, cpuTime: 1.5 }, { id: 2, cpuTime: 0.5 }];
    await s.cleanup();
    fake.browsers[0].processInfo = [{ id: 1, cpuTime: 2.0 }];
    await rt.closeAll();
    expect(console.log).toHaveBeenCalledWith(
      "[BrowserRuntime] closed (closeAll): launches=1 sessions=1 crashes=0 requests=3 bytes=2000 blocked=1 chromiumCpuMs=2500",
    );
    expect(rt.stats()).toEqual({ launches: 0, sessions: 0, crashes: 0, requests: 0, encodedBytes: 0, blockedRequests: 0, chromiumCpuMs: 0 });
  });

  it("logs a closed line with the crash when the browser disconnects", async () => {
    await open();
    fake.browsers[0].crash();
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[BrowserRuntime\] closed \(disconnected\): launches=1 sessions=1 crashes=1 /));
  });

  it("an idle close logs the closed line too", async () => {
    const s = await open();
    await s.cleanup();
    await rt.closeIfIdle();
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[BrowserRuntime\] closed \(closeIfIdle\): launches=1 sessions=1 /));
  });
});
