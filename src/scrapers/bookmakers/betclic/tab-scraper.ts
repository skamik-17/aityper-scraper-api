/**
 * Betclic Playwright Tab Scraper
 *
 * IMPORTANT NOTE: Based on research-002 and research-003 (2026-01-23),
 * tab switching does NOT trigger new gRPC network requests on Betclic's current implementation.
 * All market data is loaded in the initial GetMatchWithNotification request.
 * Tab switching is purely client-side JavaScript filtering.
 *
 * This class is implemented to satisfy the PRD story impl-001, but should be used
 * in conjunction with DOM extraction for missing market types (hybrid approach).
 *
 * See: backend/docs/betclic-tab-discovery-2026.md for detailed analysis.
 */

import type { Page, Response } from "playwright";
import { PlaywrightScraper } from "../../base/playwright-base.js";

export const TAB_NAMES = [
  "MyCombi",
  "Top",
  "Wynik",
  "Strzelcy",
  "Gole",
  "Metoda gola",
  "Wynik / Handicap",
  "Statystyki",
] as const;

const MARKET_TABS = TAB_NAMES.filter((tab) => tab !== "MyCombi");

export interface TabResponse {
  tabName: string;
  response?: Buffer;
  responseSize: number;
  hadNetworkRequest: boolean;
  error?: string;
}

export class BetclicPlaywrightTabScraper extends PlaywrightScraper {
  bookmaker = "betclic" as const;
  config = {
    bookmaker: "betclic" as const,
    type: "headless" as const,
    baseUrl: "https://www.betclic.pl",
    enabled: true,
    retries: 3,
    timeout: 30000,
    rateLimit: 20,
    disableResourceBlocking: true,
  };

  async scrapeLeague(_league: string): Promise<ReturnType<typeof this.createErrorResult>> {
    return this.createErrorResult(new Error("Use BetclicPlaywrightScraper.scrapeLeague() instead - TabScraper is a specialized utility class only"), 0);
  }

  async scrapeMatch(_match: unknown): Promise<ReturnType<typeof this.createErrorResult>> {
    return this.createErrorResult(new Error("Use BetclicPlaywrightScraper.scrapeMatch() instead - TabScraper is a specialized utility class only"), 0);
  }

  async scrapeMatchDetails(_eventUrl: string): Promise<ReturnType<typeof this.createNotImplementedResult>> {
    return this.createNotImplementedResult(0);
  }

  async extractEventUrls(_page: unknown): Promise<never[]> {
    return [];
  }

  async fetchMarketsWithTabClicks(matchUrl: string): Promise<Buffer[]> {
    return this.executeWithBrowser(
      async (page) => this.captureTabsAndResponses(page, matchUrl),
      (error, duration) => {
        console.error(
          `[Betclic/TabScraper] Error during tab scraping:`,
          error
        );
        return [];
      }
    );
  }

  private async captureTabsAndResponses(
    page: Page,
    matchUrl: string
  ): Promise<Buffer[]> {
    console.log(`[Betclic/TabScraper] Navigating to: ${matchUrl}`);

    const responses = new Map<string, Buffer>();
    const tabResponses: TabResponse[] = [];

    const responseListener = (response: Response) => {
      const url = response.url();

      if (
        url.includes("offering.begmedia.com") &&
        url.includes("GetMatchWithNotification")
      ) {
        console.log(`[Betclic/TabScraper] Captured gRPC response from: ${url}`);
      }
    };

    page.on("response", responseListener);

    try {
      await this.navigateWithRetry(page, matchUrl, {
        timeout: this.config.timeout,
        waitUntil: "domcontentloaded",
      });

      console.log(
        `[Betclic/TabScraper] Page loaded, waiting for initial gRPC request...`
      );

      await this.delay(1000);

      const tabs = await this.findTabs(page);
      console.log(
        `[Betclic/TabScraper] Found ${tabs.length} tabs: ${tabs
          .map((t) => t.name)
          .join(", ")}`
      );

      if (tabs.length === 0) {
        console.warn(
          `[Betclic/TabScraper] No tabs found, using initial page state only`
        );
        page.off("response", responseListener);
        return Array.from(responses.values());
      }

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        console.log(
          `[Betclic/TabScraper] [${i + 1}/${tabs.length}] Clicking tab: ${tab.name}`
        );

        const tabResult = await this.clickTabAndCaptureResponse(page, tab, i);

        tabResponses.push(tabResult);

        if (tabResult.response) {
          const responseKey = tabResult.response.toString("base64");
          responses.set(responseKey, tabResult.response);
          console.log(
            `[Betclic/TabScraper] ✓ Captured ${tabResult.responseSize} bytes from ${tab.name}`
          );
        } else if (tabResult.hadNetworkRequest) {
          console.log(
            `[Betclic/TabScraper] ⚠ Tab ${tab.name} had network request but failed to capture: ${tabResult.error}`
          );
        } else {
          console.log(
            `[Betclic/TabScraper] ℹ Tab ${tab.name} did not trigger network request (expected - client-side filtering)`
          );
        }

        await this.delay(200);
      }

      console.log(
        `[Betclic/TabScraper] Total unique responses: ${responses.size}`
      );

      return Array.from(responses.values());
    } catch (error) {
      console.error(
        `[Betclic/TabScraper] Error during tab navigation:`,
        error
      );
      return Array.from(responses.values());
    } finally {
      page.off("response", responseListener);
    }
  }

  private async findTabs(page: Page): Promise<Array<{ name: string; element: any }>> {
    try {
      let container = await page.locator(TAB_SELECTORS.container).first();
      const containerExists = await container.count();

      if (!containerExists) {
        console.warn(
          `[Betclic/TabScraper] Tab container not found with any selector`
        );
        return [];
      }

      const buttons = await container.locator(TAB_SELECTORS.button).all();

      const tabs: Array<{ name: string; element: any }> = [];

      for (const button of buttons) {
        try {
          const text = await button.textContent();
          if (text && text.trim()) {
            tabs.push({
              name: text.trim(),
              element: button,
            });
          }
        } catch (error) {
          console.warn(
            `[Betclic/TabScraper] Failed to get text from button:`,
            error
          );
        }
      }

      return tabs.filter(
        (tab) => MARKET_TABS.includes(tab.name as any)
      );
    } catch (error) {
      console.error(
        `[Betclic/TabScraper] Error finding tabs:`,
        error
      );
      return [];
    }
  }

  private async clickTabAndCaptureResponse(
    page: Page,
    tab: { name: string; element: any },
    index: number
  ): Promise<TabResponse> {
    const result: TabResponse = {
      tabName: tab.name,
      response: undefined,
      responseSize: 0,
      hadNetworkRequest: false,
      error: undefined,
    };

    let requestCaptured = false;
    let capturedResponse: Buffer | undefined;

    const responseListener = async (response: Response) => {
      const url = response.url();

      if (
        url.includes("offering.begmedia.com") &&
        url.includes("GetMatchWithNotification")
      ) {
        requestCaptured = true;

        try {
          const body = await response.text();

          if (body) {
            const cleanBase64 = body.replace(/\s/g, "");
            capturedResponse = Buffer.from(cleanBase64, "base64");
            result.responseSize = capturedResponse.length;
          }
        } catch (error) {
          result.error = error instanceof Error ? error.message : String(error);
        }
      }
    };

    page.on("response", responseListener);

    try {
      const isActive = await this.isTabActive(tab.element);
      if (!isActive) {
        await tab.element.click();
        await this.delay(300);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      page.off("response", responseListener);
    }

    result.hadNetworkRequest = requestCaptured;
    result.response = capturedResponse;

    return result;
  }

  private async isTabActive(element: any): Promise<boolean> {
    try {
      for (const indicator of TAB_SELECTORS.activeIndicators) {
        const hasClass = await element
          .locator(`.${indicator}`)
          .count()
          .then((count: number) => count > 0);

        if (hasClass) return true;

        const hasAttr =
          indicator.startsWith("aria-") &&
          (await element.getAttribute(indicator)) === "true";

        if (hasAttr) return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  private decodeGrpcResponse(base64: string): Buffer {
    const clean = base64.replace(/[\s\n\r]/g, "");
    return Buffer.from(clean, "base64");
  }
}

const TAB_SELECTORS = {
  container: [
    '[class*="MarketFilters_container"]',
    '[class*="Tabs_container"]',
    '[data-testid="market-tabs"]',
  ].join(", "),
  button: [
    'button[class*="MarketFilters_button"]',
    'button[role="tab"]',
    'button[class*="tab"]',
  ].join(", "),
  activeIndicators: ["is-active", "selected", "aria-selected"],
};
