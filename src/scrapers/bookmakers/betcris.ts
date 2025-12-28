/**
 * Betcris Playwright Scraper
 * Scrapes odds from betcris.pl using headless Chromium
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

// League URLs for Betcris
// Betcris uses betting page URLs with league IDs, not SEO pages
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/Poland/1978",
  "premier-league":
    "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538",
};

// CSS selectors for Betcris page structure
// Based on DOM inspection of the betting page
const SELECTORS = {
  // Cookie consent
  cookieAccept: "button[class*='cookie'], button:has-text('Akceptuję'), button:has-text('Zgadzam się'), [class*='accept'], [class*='consent']",
  // Match container - each match is wrapped in an <a> tag with data-testid="game"
  matchCard: "[data-testid='game']",
  // Team name elements inside match card
  teamName: ".comp__team-name",
  // Odds button and value
  oddsButton: "[data-testid='odd']",
  oddsValue: ".xOddButton__coef",
};

export class BetcrisScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betcris";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.betcris, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    const leagueUrl = LEAGUE_URLS[league];
    if (!leagueUrl) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      page = await this.initBrowser();

      // Human-like delay before navigation
      await this.delay(1000 + Math.random() * 1000);

      // Navigate to league page
      await this.navigateWithRetry(page, leagueUrl, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });

      // Extra delay for SPA rendering
      await this.delay(3500);

      // Try to dismiss cookie consent if present
      try {
        const cookieButton = page.locator(SELECTORS.cookieAccept).first();
        if (await cookieButton.isVisible({ timeout: 3000 })) {
          await cookieButton.click();
          await this.delay(1000);
        }
      } catch {
        // Cookie modal might not be present, continue
      }

      // Set tall viewport to load all matches
      await page.setViewportSize({ width: 1920, height: 5000 });
      await this.delay(2000);

      // Wait for match elements to load
      const hasMatches = await this.waitForSelector(page, SELECTORS.matchCard, 15000);

      if (!hasMatches) {
        return this.createNotFoundResult(
          `No ${league} matches found on page`,
          Date.now() - startTime
        );
      }

      // Additional wait for all content to load
      await this.delay(2000);

      // Extract match data from page
      const data = await this.extractMatchData(page, league);

      if (data.length === 0) {
        return this.createNotFoundResult(
          "Could not parse any match data",
          Date.now() - startTime
        );
      }

      console.log(`[Betcris] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[Betcris] Scraping error for ${league}:`, error);
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";

    try {
      const allMatches = await this.scrapeLeague(league);

      if (allMatches.status !== "success" || !allMatches.data) {
        return allMatches;
      }

      const matchResult = findMatchingEvent(
        { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
        allMatches.data,
        league
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
  private async extractMatchData(page: Page, league: string): Promise<RawScrapedOdds[]> {
    const matchData = await page.evaluate((selectors) => {
      const matches: Array<{
        homeTeam: string;
        awayTeam: string;
        homeOdds: number;
        drawOdds: number;
        awayOdds: number;
      }> = [];

      // Select all match cards
      const cards = document.querySelectorAll(selectors.matchCard);

      cards.forEach((card) => {
        // Get team names using .comp__team-name selector
        const teamElements = card.querySelectorAll(selectors.teamName);

        if (teamElements.length < 2) {
          return; // Skip if we don't have both teams
        }

        const homeTeam = teamElements[0]?.textContent?.trim() || "";
        const awayTeam = teamElements[1]?.textContent?.trim() || "";

        if (!homeTeam || !awayTeam) {
          return;
        }

        // Get odds - look for [data-testid="odd"] elements
        const oddsElements = card.querySelectorAll(selectors.oddsButton);
        const odds: number[] = [];

        oddsElements.forEach((el) => {
          // Get the odds value from .xOddButton__coef
          const valueEl = el.querySelector(selectors.oddsValue);
          const text = (valueEl?.textContent || el.textContent)?.trim() || "";
          // Handle Polish decimal format (comma instead of dot)
          const value = parseFloat(text.replace(",", "."));
          if (!isNaN(value) && value > 1 && value < 100) {
            odds.push(value);
          }
        });

        // Need exactly 3 odds for 1X2 (home, draw, away)
        if (odds.length >= 3) {
          matches.push({
            homeTeam,
            awayTeam,
            homeOdds: odds[0],
            drawOdds: odds[1],
            awayOdds: odds[2],
          });
        }
      });

      return matches;
    }, SELECTORS);

    // Convert to RawScrapedOdds format with canonical team names
    return matchData.map((match) => ({
      bookmaker: "betcris" as PolishBookmaker,
      eventName: `${match.homeTeam} - ${match.awayTeam}`,
      homeTeam: getCanonicalTeamName(match.homeTeam, league),
      awayTeam: getCanonicalTeamName(match.awayTeam, league),
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
    }));
  }
}

// Singleton instance
export const betcrisScraper = new BetcrisScraper();
