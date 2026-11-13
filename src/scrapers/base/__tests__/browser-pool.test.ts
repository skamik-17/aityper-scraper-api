import { describe, it, expect, vi } from "vitest";

const { launch } = vi.hoisted(() => ({
  launch: vi.fn(async () => ({ isConnected: () => true, close: async () => {} })),
}));
vi.mock("playwright", () => ({ chromium: { launch } }));

import { BROWSER_ARGS, browserPool } from "../browser-pool.js";

describe("BROWSER_ARGS", () => {
  it("never passes --disable-features (it would replace Playwright's own list)", () => {
    expect(BROWSER_ARGS.filter((a) => a.startsWith("--disable-features"))).toEqual([]);
    expect(BROWSER_ARGS).toEqual(["--disable-blink-features=AutomationControlled", "--disable-site-isolation-trials"]);
  });

  it("the shared pool launches headless Chromium with exactly these args", async () => {
    await browserPool.acquire();
    expect(launch).toHaveBeenCalledWith({ headless: true, args: [...BROWSER_ARGS] });
    await browserPool.closeAll();
  });
});
