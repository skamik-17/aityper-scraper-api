/**
 * Playwright Base Scraper
 * Abstract class providing common Playwright functionality for all scrapers
 */

import { chromium, Browser, Page, BrowserContext } from "playwright";
import type { PolishBookmaker } from "../../config/index.js";
import type { ScraperResult, ScraperConfig, MatchIdentifier } from "../../types/scraper.js";

// Default browser options
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
   * Initialize browser and create a new page with anti-detection measures
   */
  protected async initBrowser(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          // Anti-detection arguments
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
          "--window-size=1920,1080",
        ],
      });

      this.context = await this.browser.newContext({
        userAgent: DEFAULT_USER_AGENT,
        locale: "pl-PL",
        viewport: { width: 1920, height: 1080 },
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
        bypassCSP: true,
      });
    }

    const page = await this.context!.newPage();

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
   */
  async cleanup(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
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
}
