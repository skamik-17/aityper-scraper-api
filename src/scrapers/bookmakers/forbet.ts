/**
 * forBET Playwright Scraper
 * Scrapes odds from iforbet.pl using headless Chromium
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

// League URLs for forBET (iforbet.pl)
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.iforbet.pl/zaklady-bukmacherskie/320/29994",
  "premier-league":
    "https://www.iforbet.pl/zaklady-bukmacherskie/155/199",
};

// CSS selectors for forBET page structure
const SELECTORS = {
  // Cookie consent
  cookieAccept: "button[class*='cookie'], button:has-text('Akceptuję'), button:has-text('Zgadzam się'), .cookie-accept",
  // Match elements - based on data-test attributes
  matchCard: "[data-test^='event_']", // Each match has data-test="event_{id}"
  eventHeader: "[data-test='event_header']", // Contains "Team A - Team B"
  outcomeRow: "[data-test='outcome_row']", // Container for odds
  oddsButton: "button[data-test='outcome']", // Individual odds buttons
};

export class ForbetScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "forbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.forbet, ...config, enabled: true };
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

      console.log(`[forBET] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[forBET] Scraping error for ${league}:`, error);
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
        eventId: string;
      }> = [];

      // Find all match cards using data-test^="event_" selector
      const cards = document.querySelectorAll(selectors.matchCard);

      cards.forEach((card) => {
        // Get event ID from data-test attribute
        const dataTest = card.getAttribute("data-test") || "";
        const eventId = dataTest.replace("event_", "");

        // Get team names from event_header element
        // Format: "Team A - Team B"
        const headerEl = card.querySelector(selectors.eventHeader);
        const headerText = headerEl?.textContent?.trim() || "";

        // Parse teams from header using " - " separator
        const teamMatch = headerText.match(/^(.+?)\s*-\s*(.+)$/);
        if (!teamMatch) {
          return;
        }

        const homeTeam = teamMatch[1].trim();
        const awayTeam = teamMatch[2].trim();

        if (!homeTeam || !awayTeam) {
          return;
        }

        // Get odds from outcome_row
        // The first outcome_row contains 1X2 odds (home, draw, away)
        const outcomeRow = card.querySelector(selectors.outcomeRow);
        if (!outcomeRow) {
          return;
        }

        // Get the first grid of odds (1X2 market)
        const firstOddsGrid = outcomeRow.querySelector(".grid");
        if (!firstOddsGrid) {
          return;
        }

        const oddsButtons = firstOddsGrid.querySelectorAll(selectors.oddsButton);
        const odds: number[] = [];

        oddsButtons.forEach((btn) => {
          const text = btn.textContent?.trim() || "";
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
            eventId,
          });
        }
      });

      return matches;
    }, SELECTORS);

    // Convert to RawScrapedOdds format with canonical team names
    return matchData.map((match) => ({
      bookmaker: "forbet" as PolishBookmaker,
      eventName: `${match.homeTeam} - ${match.awayTeam}`,
      homeTeam: getCanonicalTeamName(match.homeTeam, league),
      awayTeam: getCanonicalTeamName(match.awayTeam, league),
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
      eventId: match.eventId,
    }));
  }
}

// Singleton instance
export const forbetScraper = new ForbetScraper();
