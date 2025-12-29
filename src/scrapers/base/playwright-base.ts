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

export abstract class PlaywrightScraper {
  abstract bookmaker: PolishBookmaker;
  abstract config: ScraperConfig;

  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;

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
   * Override in subclasses that support extended markets
   */
  abstract scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult>;

  /**
   * Extract event URLs from the current listing page
   * Returns a list of match keys (normalized team names) with their detail page URLs
   * Override in subclasses to collect URLs during listing scrapes
   */
  abstract extractEventUrls(page: Page): Promise<EventUrlEntry[]>;

  /**
   * Initialize browser and create a new page with anti-detection measures
   * Uses browser pool for efficient resource management
   */
  protected async initBrowser(): Promise<Page> {
    // Acquire browser from pool
    this.browser = await browserPool.acquire();

    // Create new context for isolation
    this.context = await this.browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      locale: "pl-PL",
      viewport: { width: 1920, height: 1080 },
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });

    const page = await this.context.newPage();

    // Block unnecessary resources for faster loading (unless disabled for this scraper)
    if (!this.config.disableResourceBlocking) {
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
          return route.abort();
        }
        return route.continue();
      });
    }

    // Apply stealth scripts to hide automation
    await this.applyStealthScripts(page);

    return page;
  }

  /**
   * Apply stealth scripts to hide automation detection
   */
  protected async applyStealthScripts(page: Page): Promise<void> {
    await page.addInitScript(() => {
      // Remove webdriver flag
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });

      // Add fake plugins array (Chrome normally has these)
      Object.defineProperty(navigator, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
          { name: "Native Client", filename: "internal-nacl-plugin" },
        ],
      });

      // Add languages array
      Object.defineProperty(navigator, "languages", {
        get: () => ["pl-PL", "pl", "en-US", "en"],
      });

      // Hide automation-specific chrome properties
      (window as unknown as { chrome: unknown }).chrome = {
        runtime: {},
      };
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
        if (attempt === maxRetries) {
          throw error;
        }
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await this.delay(delay);
      }
    }
  }

  /**
   * Wait for a selector with timeout
   */
  protected async waitForSelector(
    page: Page,
    selector: string,
    timeout?: number
  ): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { timeout: timeout || this.config.timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up browser resources
   * Closes context and releases browser back to pool (doesn't close browser)
   */
  async cleanup(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        // Release browser back to pool instead of closing it
        browserPool.release(this.browser);
        this.browser = null;
      }
    } catch (error) {
      console.error(`[${this.bookmaker}] Error during cleanup:`, error);
    }
  }

  /**
   * Helper to delay execution
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create error result
   */
  protected createErrorResult(error: unknown, duration: number): ScraperResult {
    return {
      status: "error",
      bookmaker: this.bookmaker,
      error: error instanceof Error ? error.message : "Unknown error",
      duration,
      timestamp: new Date(),
    };
  }

  /**
   * Create timeout result
   */
  protected createTimeoutResult(duration: number): ScraperResult {
    return {
      status: "timeout",
      bookmaker: this.bookmaker,
      error: `Scraping timed out after ${this.config.timeout}ms`,
      duration,
      timestamp: new Date(),
    };
  }

  /**
   * Create not found result
   */
  protected createNotFoundResult(message: string, duration: number): ScraperResult {
    return {
      status: "not_found",
      bookmaker: this.bookmaker,
      error: message,
      duration,
      timestamp: new Date(),
    };
  }

  /**
   * Create match detail error result
   */
  protected createMatchDetailErrorResult(
    error: unknown,
    duration: number
  ): MatchDetailResult {
    return {
      status: "error",
      bookmaker: this.bookmaker,
      error: error instanceof Error ? error.message : "Unknown error",
      duration,
      timestamp: new Date(),
    };
  }

  /**
   * Create match detail timeout result
   */
  protected createMatchDetailTimeoutResult(duration: number): MatchDetailResult {
    return {
      status: "timeout",
      bookmaker: this.bookmaker,
      error: `Match detail scraping timed out after ${this.config.timeout}ms`,
      duration,
      timestamp: new Date(),
    };
  }

  /**
   * Create match detail not found result
   */
  protected createMatchDetailNotFoundResult(
    message: string,
    duration: number
  ): MatchDetailResult {
    return {
      status: "not_found",
      bookmaker: this.bookmaker,
      error: message,
      duration,
      timestamp: new Date(),
    };
  }

  /**
   * Create not implemented result for scrapers that don't support extended markets yet
   */
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
