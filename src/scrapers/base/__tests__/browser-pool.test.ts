import { describe, it, expect, vi } from "vitest";

const { launch } = vi.hoisted(() => ({
  launch: vi.fn(async () => ({ isConnected: () => true, close: async () => {} })),
}));
vi.mock("playwright", () => ({ chromium: { launch } }));

import type { Browser } from "playwright";
import { BROWSER_ARGS, browserPool, BrowserPool } from "../browser-pool.js";

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

type FakeBrowser = Browser & { close: ReturnType<typeof vi.fn> };
const fakeBrowser = (): FakeBrowser => {
  let up = true;
  return { isConnected: () => up, close: vi.fn(async () => { up = false; }) } as unknown as FakeBrowser;
};
const deferred = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const make = (max = 1) => {
  const launch = vi.fn(async () => fakeBrowser());
  return { pool: new BrowserPool(max, launch), launch };
};
const ZERO = { total: 0, available: 0, inUse: 0, waiting: 0 };

describe("BrowserPool", () => {
  it("release closes the browser when nobody waits", async () => {
    const { pool } = make();
    const b = (await pool.acquire()) as FakeBrowser;
    pool.release(b);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toEqual(ZERO);
  });

  it("release hands the browser to the oldest waiter without closing it", async () => {
    const { pool, launch } = make();
    const b = (await pool.acquire()) as FakeBrowser;
    const w1 = pool.acquire();
    pool.acquire();
    pool.release(b);
    await expect(w1).resolves.toBe(b);
    expect(b.close).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toEqual({ total: 1, available: 0, inUse: 1, waiting: 1 });
  });

  it("closeAll rejects every pending waiter instead of leaving it hanging", async () => {
    const { pool } = make();
    const b = (await pool.acquire()) as FakeBrowser;
    const settled = Promise.allSettled([pool.acquire(), pool.acquire()]);
    await pool.closeAll();
    expect((await settled).map((r) => r.status === "rejected" && (r.reason as Error).message)).toEqual([
      "Browser pool closed while waiting for a browser",
      "Browser pool closed while waiting for a browser",
    ]);
    expect(b.close).toHaveBeenCalledTimes(1);
    await expect(pool.acquire()).resolves.toBeDefined(); // usable again
  });

  it("a launch failure wakes a waiter, which launches its own browser (Review Focus 2)", async () => {
    const d = deferred<Browser>();
    const launch = vi.fn().mockReturnValueOnce(d.promise).mockImplementation(async () => fakeBrowser());
    const pool = new BrowserPool(1, launch);
    const first = pool.acquire().catch((e: Error) => e.message);
    const waiter = pool.acquire();
    d.reject(new Error("browserType.launch: Executable doesn't exist"));
    expect(await first).toBe("browserType.launch: Executable doesn't exist");
    await expect(waiter).resolves.toBeDefined();
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("closeAll during an in-flight launch closes the late browser and rejects its caller (Review Focus 1)", async () => {
    const d = deferred<Browser>();
    const pool = new BrowserPool(1, () => d.promise);
    const a = pool.acquire().catch((e: Error) => e.message);
    await pool.closeAll();
    const late = fakeBrowser();
    d.resolve(late);
    expect(await a).toBe("Browser pool closed while launching a browser");
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toEqual(ZERO);
  });

  it("remove() of a broken browser wakes a waiter, which launches a replacement", async () => {
    const { pool, launch } = make();
    const b = (await pool.acquire()) as FakeBrowser;
    const w = pool.acquire();
    pool.remove(b);
    expect(await w).not.toBe(b);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it("a crashed browser is never handed to a waiter", async () => {
    const { pool, launch } = make();
    const b = (await pool.acquire()) as FakeBrowser;
    const w = pool.acquire();
    await b.close();
    pool.release(b);
    expect(await w).not.toBe(b);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("a second release of the same browser is ignored", async () => {
    const { pool } = make();
    const b = (await pool.acquire()) as FakeBrowser;
    pool.release(b);
    pool.release(b);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toEqual(ZERO);
  });
});
