/**
 * Browser Pool
 * Manages a pool of reusable Playwright browsers to reduce overhead
 */

import { chromium, Browser } from "playwright";

// Browser launch arguments (shared with playwright-base.ts)
const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--window-size=1920,1080",
];

class BrowserPool {
  private pool: Browser[] = [];
  private available: Browser[] = [];
  private maxSize: number;
  private waiting: Array<(browser: Browser) => void> = [];
  private isClosing = false;
  private pendingCreations = 0; // Track browsers being created

  constructor(maxSize = 4) {
    this.maxSize = maxSize;
  }

  /**
   * Acquire a browser from the pool
   * Returns an existing available browser or creates a new one if pool not full
   * Waits if all browsers are in use and pool is at max capacity
   */
  async acquire(): Promise<Browser> {
    // Don't allow acquisition while closing
    if (this.isClosing) {
      throw new Error("Browser pool is closing, cannot acquire new browser");
    }

    // Return available browser if exists
    if (this.available.length > 0) {
      const browser = this.available.pop()!;
      // Check if browser is still connected
      if (browser.isConnected()) {
        console.log(`[BrowserPool] Reusing browser (${this.available.length} available, ${this.pool.length} total)`);
        return browser;
      }
      // Browser disconnected, remove from pool and try again
      this.pool = this.pool.filter(b => b !== browser);
      return this.acquire();
    }

    // Create new browser if pool not full (including pending creations)
    if (this.pool.length + this.pendingCreations < this.maxSize) {
      this.pendingCreations++;
      console.log(`[BrowserPool] Creating new browser (${this.pool.length + this.pendingCreations}/${this.maxSize})`);
      try {
        const browser = await chromium.launch({
          headless: true,
          args: BROWSER_ARGS,
        });
        this.pool.push(browser);
        return browser;
      } finally {
        this.pendingCreations--;
      }
    }

    // Wait for available browser
    console.log(`[BrowserPool] Pool full, waiting for available browser...`);
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * Release a browser back to the pool
   */
  release(browser: Browser): void {
    if (this.isClosing) {
      // If closing, just close the browser
      browser.close().catch(() => {});
      return;
    }

    // Check if browser is still valid
    if (!browser.isConnected()) {
      this.pool = this.pool.filter(b => b !== browser);
      console.log(`[BrowserPool] Browser disconnected, removed from pool (${this.pool.length} total)`);
      return;
    }

    // If someone is waiting, give them the browser directly
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      console.log(`[BrowserPool] Giving browser to waiting request`);
      resolve(browser);
      return;
    }

    // Otherwise add to available pool
    this.available.push(browser);
    console.log(`[BrowserPool] Browser released (${this.available.length} available, ${this.pool.length} total)`);
  }

  /**
   * Remove a browser from the pool (when it's known to be invalid)
   */
  remove(browser: Browser): void {
    this.pool = this.pool.filter(b => b !== browser);
    this.available = this.available.filter(b => b !== browser);
    console.log(`[BrowserPool] Browser removed from pool (${this.pool.length} total)`);
    browser.close().catch(() => {});
  }

  /**
   * Close all browsers in the pool
   * Should be called at the end of a scraping cycle
   */
  async closeAll(): Promise<void> {
    this.isClosing = true;

    // Reject any waiting requests
    for (const resolve of this.waiting) {
      // This will cause the waiting promise to resolve with a closed browser
      // which will throw an error - but that's better than hanging forever
    }
    this.waiting = [];

    console.log(`[BrowserPool] Closing all ${this.pool.length} browsers`);

    // Close all browsers
    const closePromises = this.pool.map(async (browser) => {
      try {
        if (browser.isConnected()) {
          await browser.close();
        }
      } catch (error) {
        console.error("[BrowserPool] Error closing browser:", error);
      }
    });

    await Promise.all(closePromises);

    // Reset state
    this.pool = [];
    this.available = [];
    this.isClosing = false;

    console.log("[BrowserPool] All browsers closed");
  }

  /**
   * Get current pool statistics
   */
  getStats(): { total: number; available: number; inUse: number; waiting: number } {
    return {
      total: this.pool.length,
      available: this.available.length,
      inUse: this.pool.length - this.available.length,
      waiting: this.waiting.length,
    };
  }
}

// Singleton instance with 14 browsers max (one per scraper per league)
export const browserPool = new BrowserPool(14);
