/**
 * Playwright Base Scraper
 * Abstract class providing common Playwright functionality for all scrapers
 */

import { Browser, Page, BrowserContext } from "playwright";
import type { PolishBookmaker } from "../../config/index.js";
import type { ScraperConfig } from "../../types/scraper.js";
import type { FullOfferScraperResult } from "../../types/full-offer.js";
import { browserPool } from "./browser-pool.js";
import { currentScrapeJob } from "../shared/job-context.js";
import type { FullOfferScraper } from "../shared/scraper-contract.js";
import type { ScrapeBudget } from "../shared/budget.js";
import {
  attachNavigationRecorder,
  enrichFullOfferFailure,
  isFailedOrEmptyResult,
  type NavigationRecorder,
} from "./navigation-diagnostics.js";

// Default browser options
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Return type for initBrowser - includes cleanup function for proper resource management
export interface BrowserSession {
  page: Page;
  browser: Browser;
  context: BrowserContext;
  cleanup: () => Promise<void>;
}

export abstract class PlaywrightScraper implements FullOfferScraper {
  abstract bookmaker: PolishBookmaker;
  abstract config: ScraperConfig;

  /**
   * Scrape full offer (all markets) for all matches in a league
   * This is the new primary method for full offer scraping
   * Default implementation returns "not implemented" - subclasses should override
   * @param league - League slug (e.g., "ekstraklasa", "premier-league")
   */
  scrapeFullOffer(league: string, _budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    return Promise.resolve(this.createFullOfferNotImplementedResult(league));
  }

  /**
   * Initialize browser session with proper resource management
   * Returns browser, context, page and a cleanup function
   * Safe for concurrent usage across multiple leagues
   */
  protected async initBrowser(): Promise<BrowserSession> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    // Try up to 2 times to get a valid browser
    for (let attempt = 0; attempt < 2; attempt++) {
      browser = await browserPool.acquire();

      try {
        context = await browser.newContext({
          userAgent: DEFAULT_USER_AGENT,
          locale: "pl-PL",
          viewport: { width: 1920, height: 1080 },
          javaScriptEnabled: true,
          ignoreHTTPSErrors: true,
          bypassCSP: true,
        });

        const page = await context.newPage();

        // Create cleanup function with captured references
        const capturedBrowser = browser;
        const capturedContext = context;
        const cleanup = async () => {
          try {
            if (capturedContext) await capturedContext.close();
            if (capturedBrowser) browserPool.release(capturedBrowser);
          } catch (error) {
            console.error(`[${this.bookmaker}] Error during cleanup:`, error);
          }
        };

        return { page, browser, context, cleanup };
      } catch (error) {
        console.log(`[${this.bookmaker}] Browser invalid, retrying...`);
        if (browser) browserPool.remove(browser);
        continue;
      }
    }

    // Last attempt
    browser = await browserPool.acquire();
    context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      locale: "pl-PL",
      viewport: { width: 1920, height: 1080 },
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });

    const page = await context.newPage();

    await this.applyStealthScripts(page);

    const capturedBrowser = browser;
    const capturedContext = context;
    const cleanup = async () => {
      try {
        if (capturedContext) await capturedContext.close();
        if (capturedBrowser) browserPool.release(capturedBrowser);
      } catch (error) {
        console.error(`[${this.bookmaker}] Error during cleanup:`, error);
      }
    };

    return { page, browser, context, cleanup };
  }

  /**
   * Apply stealth scripts to hide automation detection
   */
  protected async applyStealthScripts(page: Page): Promise<void> {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
          { name: "Native Client", filename: "internal-nacl-plugin" },
        ],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["pl-PL", "pl", "en-US", "en"],
      });
      (window as unknown as { chrome: unknown }).chrome = { runtime: {} };
    });
  }

  /**
   * Navigate to a URL with retry logic
   */
  protected async navigateWithRetry(
    page: Page,
    url: string,
    options: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" } = {}
  ): Promise<void> {
    const { timeout = this.config.timeout, waitUntil = "networkidle" } = options;
    const maxRetries = this.config.retries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await page.goto(url, { timeout, waitUntil });
        return;
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }
  }

  /**
   * Wait for a selector with timeout
   */
  protected async waitForSelector(page: Page, selector: string, timeout?: number): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { timeout: timeout || this.config.timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * No-op cleanup for backwards compatibility with aggregator
   */
  async cleanup(): Promise<void> {
    // Session-based cleanup is handled by each scraper's finally block
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Full offer helper methods

  protected createFullOfferErrorResult(
    league: string,
    error: unknown,
    duration: number
  ): FullOfferScraperResult {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${this.bookmaker}] Full offer scraper error: ${errorMessage}`);
    return {
      success: false,
      bookmaker: this.bookmaker,
      league,
      matches: [],
      error: errorMessage,
      duration,
    };
  }

  protected createFullOfferTimeoutResult(league: string, duration: number): FullOfferScraperResult {
    return {
      success: false,
      bookmaker: this.bookmaker,
      league,
      matches: [],
      error: `Full offer scraping timed out after ${this.config.timeout}ms`,
      duration,
    };
  }

  protected createFullOfferNotImplementedResult(league: string): FullOfferScraperResult {
    return {
      success: false,
      bookmaker: this.bookmaker,
      league,
      matches: [],
      error: `Full offer scraping not yet implemented for ${this.bookmaker}`,
      duration: 0,
    };
  }

  protected async executeWithBrowser<T>(
    operation: (page: Page, session: BrowserSession) => Promise<T>,
    errorHandler: (error: unknown, duration: number) => T
  ): Promise<T> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;
    let detach: (() => void) | null = null;

    try {
      const session = await this.initBrowser();
      cleanup = session.cleanup;
      // The job's budget closes the context, so a scrape that ignores its signal still stops
      const signal = currentScrapeJob()?.budget.signal;
      const closeContext = () => {
        void session.context.close().catch(() => {});
      };
      if (signal?.aborted) {
        closeContext();
      } else if (signal) {
        signal.addEventListener("abort", closeContext, { once: true });
        detach = () => signal.removeEventListener("abort", closeContext);
      }
      return await operation(session.page, session);
    } catch (error) {
      return errorHandler(error, Date.now() - startTime);
    } finally {
      detach?.();
      if (cleanup) await cleanup();
    }
  }

  protected async executeFullOfferScrape(
    league: string,
    leagueValidator: (league: string) => boolean,
    scrapeLogic: (page: Page, league: string) => Promise<FullOfferScraperResult>
  ): Promise<FullOfferScraperResult> {
    const startTime = Date.now();

    if (!leagueValidator(league)) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    // Records HTTP status, host and websockets so a failed or empty result
    // carries the navigation cause. Read by the error handler too.
    let recorder: NavigationRecorder | null = null;

    return this.executeWithBrowser(
      async (page) => {
        const rec = attachNavigationRecorder(page);
        recorder = rec;
        try {
          const result = await scrapeLogic(page, league);
          if (!isFailedOrEmptyResult(result)) return result;
          return enrichFullOfferFailure(result, await rec.snapshot(page));
        } finally {
          rec.detach();
        }
      },
      (error, duration) => {
        const result = this.createFullOfferErrorResult(league, error, duration);
        // The page may already be closed or crashed: use what was recorded so far.
        return recorder ? enrichFullOfferFailure(result, recorder.current()) : result;
      }
    );
  }
}
