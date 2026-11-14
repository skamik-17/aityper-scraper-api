/**
 * Playwright Base Scraper
 * Abstract class providing common Playwright functionality for all scrapers.
 * Sessions come from the shared browser runtime (one Chromium, a context per session).
 */

import type { Page } from "playwright";
import type { PolishBookmaker } from "../../config/index.js";
import type { ScraperConfig } from "../../types/scraper.js";
import type { FullOfferScraperResult } from "../../types/full-offer.js";
import { browserRuntime, type BrowserSession } from "./browser-runtime.js";
import { resolveBrowserPolicy } from "./browser-policy.js";
import { currentScrapeJob } from "../shared/job-context.js";
import type { FullOfferScraper } from "../shared/scraper-contract.js";
import { createScrapeBudget, type ScrapeBudget } from "../shared/budget.js";
import {
  attachNavigationRecorder,
  enrichFullOfferFailure,
  isFailedOrEmptyResult,
  type NavigationRecorder,
} from "./navigation-diagnostics.js";

export type { BrowserSession } from "./browser-runtime.js";

/** A crashed session is retried once when at least this share of its lifetime is left. */
const CRASH_RETRY_MIN_LEFT = 0.4;

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
   * Opens a browser session on the shared runtime. The budget comes from the caller or
   * from the plan 07 job this runs in; the session never outlives the bookmaker's policy
   * lifetime (its job budget by default) nor the budget.
   */
  protected async initBrowser(budget?: ScrapeBudget): Promise<BrowserSession> {
    const effective = budget ?? currentScrapeJob()?.budget;
    const policy = resolveBrowserPolicy(this.bookmaker, this.config);
    return browserRuntime.openSession({
      bookmaker: this.bookmaker,
      policy,
      signal: effective?.signal,
      maxSessionMs: Math.min(policy.maxSessionMs, effective?.remainingMs() ?? Infinity),
    });
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

  /**
   * Runs `operation` on a fresh session and always cleans it up. When the browser crashed
   * under the session (Chromium disconnected) and at least 40 % of its lifetime is left,
   * the operation runs once more on a new session within the remaining time.
   */
  protected async executeWithBrowser<T>(
    operation: (page: Page, session: BrowserSession) => Promise<T>,
    errorHandler: (error: unknown, duration: number) => T,
    budget?: ScrapeBudget
  ): Promise<T> {
    const startTime = Date.now();
    let attemptBudget = budget;

    for (let attempt = 1; ; attempt++) {
      let session: BrowserSession | null = null;
      let detach: (() => void) | null = null;
      let outcome: { ok: true; value: T } | { ok: false; error: unknown };

      try {
        session = await this.initBrowser(attemptBudget);
        // The job's budget closes the context, so a scrape that ignores its signal still stops
        const signal = currentScrapeJob()?.budget.signal;
        const context = session.context;
        const closeContext = () => {
          void context.close().catch(() => {});
        };
        if (signal?.aborted) {
          closeContext();
        } else if (signal) {
          signal.addEventListener("abort", closeContext, { once: true });
          detach = () => signal.removeEventListener("abort", closeContext);
        }
        outcome = { ok: true, value: await operation(session.page, session) };
      } catch (error) {
        outcome = { ok: false, error };
      } finally {
        detach?.();
      }

      const runtime = session?.runtime;
      if (attempt === 1 && session && runtime?.crashed()) {
        const left = runtime.remainingMs();
        const span = `${Math.round(left / 1000)}s of ${Math.round(runtime.lifetimeMs / 1000)}s left`;
        if (left > 0 && left >= CRASH_RETRY_MIN_LEFT * runtime.lifetimeMs) {
          await session.cleanup();
          console.log(`[${this.bookmaker}] browser disconnected mid-session; retrying once (${span})`);
          attemptBudget = budget ?? createScrapeBudget(left, currentScrapeJob()?.budget.signal);
          continue;
        }
        console.log(`[${this.bookmaker}] browser disconnected mid-session; not retrying (${span})`);
      }

      try {
        return outcome.ok ? outcome.value : errorHandler(outcome.error, Date.now() - startTime);
      } finally {
        if (session) await session.cleanup();
      }
    }
  }

  protected async executeFullOfferScrape(
    league: string,
    leagueValidator: (league: string) => boolean,
    scrapeLogic: (page: Page, league: string) => Promise<FullOfferScraperResult>,
    budget?: ScrapeBudget
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
      },
      budget
    );
  }
}
