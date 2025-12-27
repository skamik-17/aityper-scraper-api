/**
 * LVBet Playwright Scraper
 * Scrapes odds from lvbet.pl using headless Chromium
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

// League URLs for LVBet
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa",
  "premier-league": "https://www.lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
};

// CSS selectors for LVBet page structure
// LVBet uses "components-sportsbook-odds-*" CSS classes
const SELECTORS = {
  eventRow: "[class*='EventRow'], [class*='event-row'], .event-item",
  teamName: "[class*='TeamName'], [class*='team-name'], .participant-name",
  oddsButton: "[class*='OddsButton'], [class*='odds-button'], [class*='components-sportsbook-odds']",
  oddsValue: "[class*='OddsValue'], [class*='odds-value']",
};

export class LVBetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lvbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.lvbet, ...config, enabled: true };
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

      // Navigate to league page
      await this.navigateWithRetry(page, leagueUrl, {
        timeout: this.config.timeout,
        waitUntil: "networkidle",
      });

      // Wait extra time for dynamic content to load
      await this.delay(2500);

      // Wait for event rows to appear
      const hasEvents = await this.waitForSelector(page, SELECTORS.eventRow, 10000);

      if (!hasEvents) {
        return this.createNotFoundResult(
          `No ${league} matches found on LVBet page`,
          Date.now() - startTime
        );
      }

      // Extract match data from page
      const data = await this.extractMatchData(page, league);

      if (data.length === 0) {
        return this.createNotFoundResult(
          `Could not parse any ${league} match data from LVBet`,
          Date.now() - startTime
        );
      }

      console.log(`[LVBet] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[LVBet] Scraping error:", error);
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
          `Match not found on LVBet: ${match.homeTeam} vs ${match.awayTeam}`,
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

      // Find all event rows
      document.querySelectorAll(selectors.eventRow).forEach((row) => {
        // Get team names
        const teamElements = row.querySelectorAll(selectors.teamName);
        if (teamElements.length < 2) return;

        const homeTeam = teamElements[0]?.textContent?.trim() || "";
        const awayTeam = teamElements[1]?.textContent?.trim() || "";

        if (!homeTeam || !awayTeam) return;

        // Get odds - try oddsValue first, then oddsButton
        let oddsElements = row.querySelectorAll(selectors.oddsValue);
        if (oddsElements.length === 0) {
          oddsElements = row.querySelectorAll(selectors.oddsButton);
        }

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
      bookmaker: "lvbet" as PolishBookmaker,
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
export const lvbetPlaywrightScraper = new LVBetPlaywrightScraper();
