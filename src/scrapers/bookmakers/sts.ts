/**
 * STS Playwright Scraper
 * Scrapes odds from sts.pl using headless Chromium
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

// STS Ekstraklasa URL with proper ID path
const EKSTRAKLASA_URL =
  "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/1/46/201";

// CSS selectors for STS page structure
const SELECTORS = {
  matchTile: ".one-ticket-match-tile",
  teamHome: ".one-ticket-match-tile-event-details-desktop__team-home span",
  teamAway: ".one-ticket-match-tile-event-details-desktop__team-away span",
  oddsValue: ".odds-button__odd-value",
  matchDate: ".match-tile-start-time__date",
  matchTime: ".match-tile-start-time__time",
};

export class STSScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "sts";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.sts, ...config, enabled: true };
  }

  async scrapeEkstraklasa(): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.initBrowser();

      // Human-like delay before navigation (1-2 seconds)
      await this.delay(1000 + Math.random() * 1000);

      // Navigate to Ekstraklasa page
      await this.navigateWithRetry(page, EKSTRAKLASA_URL, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });

      // Extra delay for SPA rendering
      await this.delay(2000);

      // Set very tall viewport to force loading all matches at once
      // STS uses lazy loading based on viewport visibility
      await page.setViewportSize({ width: 1920, height: 5000 });
      await this.delay(3000);

      // Wait for initial match tiles to load
      const hasMatches = await this.waitForSelector(page, SELECTORS.matchTile, 15000);

      if (!hasMatches) {
        return this.createNotFoundResult(
          "No Ekstraklasa matches found on page",
          Date.now() - startTime
        );
      }

      // Additional wait to ensure all matches are loaded in the large viewport
      await this.delay(2000);

      // Extract match data from page
      const data = await this.extractMatchData(page);

      if (data.length === 0) {
        return this.createNotFoundResult(
          "Could not parse any match data",
          Date.now() - startTime
        );
      }

      console.log(`[STS] Successfully scraped ${data.length} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[STS] Scraping error:", error);
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
          `Match not found: ${match.homeTeam} vs ${match.awayTeam}`,
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
        date: string;
        time: string;
      }> = [];

      const tiles = document.querySelectorAll(selectors.matchTile);

      tiles.forEach((tile) => {
        // Get team names
        const homeTeamEl = tile.querySelector(selectors.teamHome);
        const awayTeamEl = tile.querySelector(selectors.teamAway);

        const homeTeam = homeTeamEl?.textContent?.trim() || "";
        const awayTeam = awayTeamEl?.textContent?.trim() || "";

        // Skip if we don't have both teams
        if (!homeTeam || !awayTeam) {
          return;
        }

        // Get odds (should be 3 values: home, draw, away)
        const oddsElements = tile.querySelectorAll(selectors.oddsValue);
        const odds = Array.from(oddsElements)
          .slice(0, 3)
          .map((el) => {
            const text = el.textContent?.trim() || "0";
            return parseFloat(text.replace(",", "."));
          });

        // Need at least 3 odds
        if (odds.length < 3 || odds.some((o) => isNaN(o) || o <= 0)) {
          return;
        }

        // Get date/time
        const dateEl = tile.querySelector(selectors.matchDate);
        const timeEl = tile.querySelector(selectors.matchTime);
        const date = dateEl?.textContent?.trim() || "";
        const time = timeEl?.textContent?.trim() || "";

        matches.push({
          homeTeam,
          awayTeam,
          homeOdds: odds[0],
          drawOdds: odds[1],
          awayOdds: odds[2],
          date,
          time,
        });
      });

      return matches;
    }, SELECTORS);

    // Convert to RawScrapedOdds format with canonical team names
    return matchData.map((match) => ({
      bookmaker: "sts" as PolishBookmaker,
      eventName: `${match.homeTeam} - ${match.awayTeam}`,
      homeTeam: getCanonicalTeamName(match.homeTeam),
      awayTeam: getCanonicalTeamName(match.awayTeam),
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      hasNoTaxPromo: false, // STS doesn't typically have no-tax promo
      scrapedAt: new Date(),
    }));
  }
}

// Singleton instance
export const stsScraper = new STSScraper();
