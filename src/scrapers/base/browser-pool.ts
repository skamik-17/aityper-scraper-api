/**
 * Browser Pool
 * Manages a pool of reusable Playwright browsers to reduce overhead
 */

import { chromium, Browser } from "playwright";
import { BROWSER_ARGS } from "./browser-runtime.js";

export { BROWSER_ARGS } from "./browser-runtime.js";

export type BrowserLauncher = () => Promise<Browser>;

interface Waiter {
  /** A browser to use, or null: "a slot may be free now, try again". */
  resolve(browser: Browser | null): void;
  reject(error: Error): void;
}

export class BrowserPool {
  private pool: Browser[] = []; // launched and not closed
  private leased = new Set<Browser>();
  private waiting: Waiter[] = [];
  private pendingCreations = 0;
  private isClosing = false;
  private generation = 0; // bumped by closeAll, so a launch that finishes later is discarded

  constructor(
    private readonly maxSize = 4,
    private readonly launch: BrowserLauncher = () => chromium.launch({ headless: true, args: [...BROWSER_ARGS] }),
  ) {}

  /**
   * Acquire a browser. Launches one while the pool has room, otherwise waits
   * for a release. Every waiter is settled: it gets a browser, retries when a
   * slot frees up, or is rejected by closeAll.
   */
  async acquire(): Promise<Browser> {
    for (;;) {
      if (this.isClosing) {
        throw new Error("Browser pool is closing, cannot acquire new browser");
      }

      if (this.pool.length + this.pendingCreations < this.maxSize) {
        const generation = this.generation;
        this.pendingCreations++;
        console.log(`[BrowserPool] Creating new browser (${this.pool.length + this.pendingCreations}/${this.maxSize})`);
        let browser: Browser;
        try {
          browser = await this.launch();
        } catch (error) {
          this.wakeOne();
          throw error;
        } finally {
          this.pendingCreations--;
        }
        if (generation !== this.generation || this.isClosing) {
          browser.close().catch(() => {});
          throw new Error("Browser pool closed while launching a browser");
        }
        this.pool.push(browser);
        this.leased.add(browser);
        return browser;
      }

      console.log(`[BrowserPool] Pool full, waiting for available browser...`);
      const handed = await new Promise<Browser | null>((resolve, reject) => {
        this.waiting.push({ resolve, reject });
      });
      if (handed) return handed;
    }
  }

  /**
   * Return a browser. It goes to the oldest waiter, or is closed when nobody
   * waits (an idle browser would otherwise hold its memory until closeAll).
   */
  release(browser: Browser): void {
    if (!this.leased.delete(browser)) {
      console.warn("[BrowserPool] Ignoring release of a browser that is not leased");
      return;
    }

    if (this.isClosing || !browser.isConnected()) {
      this.drop(browser);
      this.wakeOne();
      return;
    }

    const waiter = this.waiting.shift();
    if (waiter) {
      this.leased.add(browser);
      console.log(`[BrowserPool] Giving browser to waiting request`);
      waiter.resolve(browser);
      return;
    }

    this.drop(browser);
    console.log(`[BrowserPool] Closing released browser (no waiters, ${this.pool.length} total)`);
  }

  /**
   * Remove a browser from the pool (when it's known to be invalid)
   */
  remove(browser: Browser): void {
    this.leased.delete(browser);
    this.drop(browser);
    console.log(`[BrowserPool] Browser removed from pool (${this.pool.length} total)`);
    this.wakeOne();
  }

  /**
   * Close all browsers and reject every pending waiter.
   * Should be called at the end of a scraping cycle.
   */
  async closeAll(): Promise<void> {
    this.isClosing = true;
    this.generation++;

    const waiters = this.waiting;
    this.waiting = [];
    for (const waiter of waiters) {
      waiter.reject(new Error("Browser pool closed while waiting for a browser"));
    }

    console.log(`[BrowserPool] Closing all ${this.pool.length} browsers`);

    await Promise.all(
      this.pool.map(async (browser) => {
        try {
          if (browser.isConnected()) {
            await browser.close();
          }
        } catch (error) {
          console.error("[BrowserPool] Error closing browser:", error);
        }
      }),
    );

    this.pool = [];
    this.leased.clear();
    this.isClosing = false;

    console.log("[BrowserPool] All browsers closed");
  }

  /**
   * Get current pool statistics. Idle browsers are closed on release, so
   * `available` is always 0.
   */
  getStats(): { total: number; available: number; inUse: number; waiting: number } {
    return { total: this.pool.length, available: 0, inUse: this.leased.size, waiting: this.waiting.length };
  }

  private drop(browser: Browser): void {
    this.pool = this.pool.filter((b) => b !== browser);
    browser.close().catch(() => {});
  }

  /** Let one waiter retry: a slot may have freed up. */
  private wakeOne(): void {
    this.waiting.shift()?.resolve(null);
  }
}

// Singleton instance with 14 browsers max (one per scraper per league)
export const browserPool = new BrowserPool(14);
