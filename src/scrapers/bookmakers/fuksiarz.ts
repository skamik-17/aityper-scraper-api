/**
 * Fuksiarz Playwright Scraper
 * Scrapes odds from fuksiarz.pl using headless Chromium
 */

import type { Page } from "playwright";
import type { PolishBookmaker } from "../../config/index.js";
import type {
  ScraperConfig,
  ScraperResult,
  RawScrapedOdds,
  MatchIdentifier,
} from "../../types/scraper.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../types/scraper.js";
import { PlaywrightScraper } from "../base/playwright-base.js";
import { findMatchingEvent } from "../normalizer.js";

// Fuksiarz Ekstraklasa URL (with category ID)
const EKSTRAKLASA_URL =
  "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/265/1";

// CSS selectors for Fuksiarz page structure (discovered via DOM analysis)
const SELECTORS = {
  // Event rows are LI elements with eventListPeriodItemPartial class
  eventRow: "li.eventListPeriodItemPartial",
  // Odds buttons have btn-odd class
  oddsButton: "button.btn-odd, .outcomeButtonPartial.btn-odd",
};

export class FuksiarzPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "fuksiarz";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.fuksiarz, ...config, enabled: true };
  }

  async scrapeEkstraklasa(): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.initBrowser();

      // Navigate to Ekstraklasa page
      await this.navigateWithRetry(page, EKSTRAKLASA_URL, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });

      // Wait extra time for dynamic content to load
      await this.delay(4000);

      // Wait for event rows to appear
      const hasEvents = await this.waitForSelector(page, SELECTORS.eventRow, 15000);

      if (!hasEvents) {
        return this.createNotFoundResult(
          "No Ekstraklasa matches found on Fuksiarz page",
          Date.now() - startTime
        );
      }

      // Extract match data from page
      const data = await this.extractMatchData(page);

      if (data.length === 0) {
        return this.createNotFoundResult(
          "Could not parse any match data from Fuksiarz",
          Date.now() - startTime
        );
      }

      console.log(`[Fuksiarz] Successfully scraped ${data.length} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Fuksiarz] Scraping error:", error);
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();

    try {
      // Get all matches first
      const allMatches = await this.scrapeEkstraklasa();

      if (allMatches.status !== "success" || !allMatches.data) {
        return allMatches;
      }

      // Find matching event
      const matchResult = findMatchingEvent(
        { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
        allMatches.data
      );

      if (!matchResult) {
        return this.createNotFoundResult(
          `Match not found on Fuksiarz: ${match.homeTeam} vs ${match.awayTeam}`,
          Date.now() - startTime
        );
      }

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: [matchResult.event],
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    }
  }

  /**
   * Extract match data from page using evaluate
   * Fuksiarz uses LI elements with eventListPeriodItemPartial class
   */
  private async extractMatchData(page: Page): Promise<RawScrapedOdds[]> {
    const matchData = await page.evaluate((selectors) => {
      const matches: Array<{
        homeTeam: string;
        awayTeam: string;
        homeOdds: number;
        drawOdds: number;
        awayOdds: number;
      }> = [];

      // Find all event rows
      const eventRows = document.querySelectorAll(selectors.eventRow);

      for (const row of eventRows) {
        // Extract match name from text - format is "Team A - Team B"
        const rowText = row.textContent || "";
        const matchNameMatch = rowText.match(
          /([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\s.]+)\s*-\s*([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\s.]+)/
        );

        if (!matchNameMatch) continue;

        const homeTeam = matchNameMatch[1].trim();
        const awayTeam = matchNameMatch[2].trim();

        if (!homeTeam || !awayTeam) continue;

        // Get odds from buttons - first 3 are 1X2 market
        const oddsButtons = row.querySelectorAll(selectors.oddsButton);
        const odds: number[] = [];

        for (let i = 0; i < Math.min(3, oddsButtons.length); i++) {
          const text = oddsButtons[i]?.textContent?.trim() || "";
          const val = parseFloat(text.replace(",", "."));
          if (!isNaN(val) && val >= 1.01 && val <= 100) {
            odds.push(val);
          }
        }

        // Need exactly 3 odds for 1X2 market
        if (odds.length === 3) {
          matches.push({
            homeTeam,
            awayTeam,
            homeOdds: odds[0],
            drawOdds: odds[1],
            awayOdds: odds[2],
          });
        }
      }

      return matches;
    }, SELECTORS);

    // Convert to RawScrapedOdds format
    return matchData.map((match) => ({
      bookmaker: "fuksiarz" as PolishBookmaker,
      eventName: `${match.homeTeam} - ${match.awayTeam}`,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      hasNoTaxPromo: false, // Standard 12% tax applies
      scrapedAt: new Date(),
    }));
  }
}

// Singleton instance
export const fuksiarzPlaywrightScraper = new FuksiarzPlaywrightScraper();
