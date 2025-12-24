/**
 * Betclic Playwright Scraper
 * Scrapes odds from betclic.pl using headless Chromium
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
import { findMatchingEvent, getCanonicalTeamName } from "../team-matcher.js";

// Betclic Ekstraklasa URL (competition ID 221)
const EKSTRAKLASA_URL =
  "https://www.betclic.pl/pilka-nozna-sfootball/ekstraklasa-c221";

// CSS selectors for Betclic page structure
const SELECTORS = {
  eventCard: "[data-qa='event-card']",
  teamNames: ".scoreboard_contestantLabel",
  oddsButton: ".oddValue",
  marketGroup: "[data-qa='market-group']",
};

export class BetclicPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betclic";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.betclic, ...config, enabled: true };
  }

  async scrapeEkstraklasa(): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.initBrowser();

      // Navigate to Ekstraklasa page (Angular SPA needs more time)
      await this.navigateWithRetry(page, EKSTRAKLASA_URL, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });

      // Wait extra time for Angular to hydrate and render content
      await this.delay(4000);

      // Wait for event cards to appear
      const hasEvents = await this.waitForSelector(page, SELECTORS.eventCard, 15000);

      if (!hasEvents) {
        return this.createNotFoundResult(
          "No Ekstraklasa matches found on Betclic page",
          Date.now() - startTime
        );
      }

      // Extract match data from page
      const data = await this.extractMatchData(page);

      if (data.length === 0) {
        return this.createNotFoundResult(
          "Could not parse any match data from Betclic",
          Date.now() - startTime
        );
      }

      console.log(`[Betclic] Successfully scraped ${data.length} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Betclic] Scraping error:", error);
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
          `Match not found on Betclic: ${match.homeTeam} vs ${match.awayTeam}`,
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

      // Find all event cards
      document.querySelectorAll(selectors.eventCard).forEach((card) => {
        // Get team names
        const teamElements = card.querySelectorAll(selectors.teamNames);
        if (teamElements.length < 2) return;

        const homeTeam = teamElements[0]?.textContent?.trim() || "";
        const awayTeam = teamElements[1]?.textContent?.trim() || "";

        if (!homeTeam || !awayTeam) return;

        // Get odds (1X2 market should have 3 odds)
        const oddsElements = card.querySelectorAll(selectors.oddsButton);
        const odds = Array.from(oddsElements)
          .slice(0, 3)
          .map((el) => {
            const text = el.textContent?.trim() || "0";
            return parseFloat(text.replace(",", "."));
          });

        if (odds.length < 3 || odds.some((o) => isNaN(o) || o <= 0)) {
          return;
        }

        matches.push({
          homeTeam,
          awayTeam,
          homeOdds: odds[0],
          drawOdds: odds[1],
          awayOdds: odds[2],
        });
      });

      return matches;
    }, SELECTORS);

    // Convert to RawScrapedOdds format with canonical team names
    return matchData.map((match) => ({
      bookmaker: "betclic" as PolishBookmaker,
      eventName: `${match.homeTeam} - ${match.awayTeam}`,
      homeTeam: getCanonicalTeamName(match.homeTeam),
      awayTeam: getCanonicalTeamName(match.awayTeam),
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      hasNoTaxPromo: false, // Standard 12% tax applies
      scrapedAt: new Date(),
    }));
  }
}

// Singleton instance
export const betclicPlaywrightScraper = new BetclicPlaywrightScraper();
