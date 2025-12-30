/**
 * Playwright Base Scraper
 * Abstract class providing common Playwright functionality for all scrapers
 */

import { Browser, Page, BrowserContext } from "playwright";
import type { PolishBookmaker } from "../../config/index.js";
import type {
  ScraperResult,
  ScraperConfig,
  MatchIdentifier,
  MatchDetailResult,
  EventUrlEntry,
} from "../../types/scraper.js";
import { browserPool } from "./browser-pool.js";

// Default browser options
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Resource types to block for faster loading
const BLOCKED_RESOURCE_TYPES = ["image", "stylesheet", "font", "media"];

// Return type for initBrowser - includes cleanup function for proper resource management
export interface BrowserSession {
  page: Page;
  browser: Browser;
  context: BrowserContext;
  cleanup: () => Promise<void>;
}

export abstract class PlaywrightScraper {
  abstract bookmaker: PolishBookmaker;
  abstract config: ScraperConfig;

  /**
   * Scrape all matches for a specific league
   * @param league - League slug (e.g., "ekstraklasa", "premier-league")
   */
  abstract scrapeLeague(league: string): Promise<ScraperResult>;

  /**
   * Scrape all Ekstraklasa matches (backwards compatibility)
   */
  scrapeEkstraklasa(): Promise<ScraperResult> {
    return this.scrapeLeague("ekstraklasa");
  }

  /**
   * Scrape all Premier League matches
   */
  scrapePremierLeague(): Promise<ScraperResult> {
    return this.scrapeLeague("premier-league");
  }

  /**
   * Scrape a specific match
   */
  abstract scrapeMatch(match: MatchIdentifier): Promise<ScraperResult>;

  /**
   * Scrape detailed match page for extended markets (Double Chance, Over/Under, BTTS)
   */
  abstract scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult>;

  /**
   * Extract event URLs from the current listing page
   */
  abstract extractEventUrls(page: Page): Promise<EventUrlEntry[]>;

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

    if (!this.config.disableResourceBlocking) {
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
          return route.abort();
        }
        return route.continue();
      });
    }

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

  protected createErrorResult(error: unknown, duration: number): ScraperResult {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${this.bookmaker}] Scraper error: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      console.error(`[${this.bookmaker}] Stack:`, error.stack.split('\n').slice(0, 3).join('\n'));
    }
    return { status: "error", bookmaker: this.bookmaker, error: errorMessage, duration, timestamp: new Date() };
  }

  protected createTimeoutResult(duration: number): ScraperResult {
    return {
      status: "timeout",
      bookmaker: this.bookmaker,
      error: `Scraping timed out after ${this.config.timeout}ms`,
      duration,
      timestamp: new Date(),
    };
  }

  protected createNotFoundResult(message: string, duration: number): ScraperResult {
    return { status: "not_found", bookmaker: this.bookmaker, error: message, duration, timestamp: new Date() };
  }

  protected createMatchDetailErrorResult(error: unknown, duration: number): MatchDetailResult {
    return {
      status: "error",
      bookmaker: this.bookmaker,
      error: error instanceof Error ? error.message : "Unknown error",
      duration,
      timestamp: new Date(),
    };
  }

  protected createMatchDetailTimeoutResult(duration: number): MatchDetailResult {
    return {
      status: "timeout",
      bookmaker: this.bookmaker,
      error: `Match detail scraping timed out after ${this.config.timeout}ms`,
      duration,
      timestamp: new Date(),
    };
  }

  protected createMatchDetailNotFoundResult(message: string, duration: number): MatchDetailResult {
    return { status: "not_found", bookmaker: this.bookmaker, error: message, duration, timestamp: new Date() };
  }

  protected createNotImplementedResult(duration: number): MatchDetailResult {
    return {
      status: "error",
      bookmaker: this.bookmaker,
      error: `Extended market scraping not yet implemented for ${this.bookmaker}`,
      duration,
      timestamp: new Date(),
    };
  }
}
