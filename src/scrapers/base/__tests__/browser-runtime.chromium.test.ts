/**
 * BrowserRuntime against the locally installed Playwright headless shell (no internet).
 * Run through `heavy --live`: these tests launch Chromium.
 */
import { chromium } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRuntime } from "../browser-runtime.js";

const canLaunch = await chromium.launch({ headless: true }).then(
  async (b) => {
    await b.close();
    return true;
  },
  () => false,
);

describe.skipIf(!canLaunch)("BrowserRuntime on real Chromium", () => {
  let rt: BrowserRuntime;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    rt = new BrowserRuntime({ maxSessions: 3, idleCloseMs: 60_000 });
  });

  afterEach(async () => {
    await rt.closeAll();
    vi.restoreAllMocks();
  });

  it("serves concurrent sessions from one browser with separate contexts and a 1366x768 viewport", { timeout: 30_000 }, async () => {
    const [a, b] = await Promise.all([
      rt.openSession({ bookmaker: "sts", maxSessionMs: 30_000 }),
      rt.openSession({ bookmaker: "fortuna", maxSessionMs: 30_000 }),
    ]);
    expect(a.browser).toBe(b.browser);
    expect(a.context).not.toBe(b.context);
    expect(await a.page.evaluate(() => [innerWidth, innerHeight])).toEqual([1366, 768]);
  });

  it("lifetime expiry rejects pending page work with the reason", { timeout: 30_000 }, async () => {
    const s = await rt.openSession({ bookmaker: "sts", maxSessionMs: 300 });
    await expect(s.page.evaluate(() => new Promise(() => {}))).rejects.toThrow("browser session exceeded 300ms");
  });

  it("Browser.crash marks open sessions crashed and the next session runs on a new browser", { timeout: 30_000 }, async () => {
    const s1 = await rt.openSession({ bookmaker: "sts", maxSessionMs: 30_000 });
    await (await s1.browser.newBrowserCDPSession()).send("Browser.crash").catch(() => {});
    await expect.poll(() => s1.runtime!.crashed()).toBe(true);
    const s2 = await rt.openSession({ bookmaker: "sts", maxSessionMs: 30_000 });
    expect(s2.browser).not.toBe(s1.browser);
    expect(s2.browser.isConnected()).toBe(true);
    await s1.cleanup();
    await s2.cleanup();
  });
});
