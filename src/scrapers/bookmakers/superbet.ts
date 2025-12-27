/**
 * Superbet Playwright Scraper
 * Scrapes odds from superbet.pl using headless Chromium
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

// League URLs for Superbet
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa",
  "premier-league": "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
};

// CSS selectors for Superbet page structure (discovered via DOM analysis)
const SELECTORS = {
  // Event container - look for match/event cards
  matchCard: "[class*='event-card'], [class*='EventCard'], .events-date ~ div",
  // Team names use e2e selectors
  teamHome: ".e2e-event-team1-name, .event-competitor__name:first-child",
  teamAway: ".e2e-event-team2-name, .event-competitor__name:last-child",
  // Odds buttons
  oddsButton: ".odd-button, [class*='odd-button']",
  oddsValue: ".odd-button__odd-value, [class*='odd-value']",
};

export class SuperbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "superbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.superbet, ...config, enabled: true };
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

      // Navigate to league page (use domcontentloaded to avoid timeout)
      await this.navigateWithRetry(page, leagueUrl, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });

      // Wait extra time for SPA to render dynamic content
      await this.delay(4000);

      // Wait for team names to appear
      const hasMatches = await this.waitForSelector(page, ".e2e-event-team1-name", 10000);

      if (!hasMatches) {
        return this.createNotFoundResult(
          `No ${league} matches found on Superbet page`,
          Date.now() - startTime
        );
      }

      // Extract match data from page
      const data = await this.extractMatchData(page, league);

      if (data.length === 0) {
        return this.createNotFoundResult(
          `Could not parse any ${league} match data from Superbet`,
          Date.now() - startTime
        );
      }

      console.log(`[Superbet] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Superbet] Scraping error:", error);
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
      // Get all matches first
      const allMatches = await this.scrapeLeague(league);

      if (allMatches.status !== "success" || !allMatches.data) {
        return allMatches;
      }

      // Find matching event
      const matchResult = findMatchingEvent(
        { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
        allMatches.data,
        league
      );

      if (!matchResult) {
        return this.createNotFoundResult(
          `Match not found on Superbet: ${match.homeTeam} vs ${match.awayTeam}`,
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
   * Superbet uses e2e test selectors and .event-card__main-content containers
   */
  private async extractMatchData(page: Page, league: string): Promise<RawScrapedOdds[]> {
    const matchData = await page.evaluate(() => {
      const matches: Array<{
        homeTeam: string;
        awayTeam: string;
        homeOdds: number;
        drawOdds: number;
        awayOdds: number;
      }> = [];

      // Find all event cards - each contains one match
      const eventCards = document.querySelectorAll(".event-card__main-content");

      for (const card of eventCards) {
        // Get team names from this card using e2e selectors
        const homeTeam = card.querySelector(".e2e-event-team1-name")?.textContent?.trim() || "";
        const awayTeam = card.querySelector(".e2e-event-team2-name")?.textContent?.trim() || "";

        if (!homeTeam || !awayTeam) continue;

        // Get odds values - use .odd-button__odd-value for clean values
        // Also get names to verify 1X2 market
        const oddValues = card.querySelectorAll(".odd-button__odd-value");

        // First 3 odds should be 1X2 market (check names if available)
        const odds: number[] = [];
        for (let i = 0; i < Math.min(3, oddValues.length); i++) {
          const text = oddValues[i]?.textContent?.trim() || "";
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
    });

    // Convert to RawScrapedOdds format with canonical team names
    return matchData.map((match) => ({
      bookmaker: "superbet" as PolishBookmaker,
      eventName: `${match.homeTeam} - ${match.awayTeam}`,
      homeTeam: getCanonicalTeamName(match.homeTeam, league),
      awayTeam: getCanonicalTeamName(match.awayTeam, league),
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      hasNoTaxPromo: false, // Standard 12% tax applies
      scrapedAt: new Date(),
    }));
  }
}

// Singleton instance
export const superbetPlaywrightScraper = new SuperbetPlaywrightScraper();
