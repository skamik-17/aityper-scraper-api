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
// Note: LVBet uses dynamic IDs in URLs - use the parent country URL with filter
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/--/1/35131/37669/",
  "premier-league": "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/--/1/35148/",
};

// CSS selectors for LVBet page structure
// LVBet uses "ds-" prefix design system classes
const SELECTORS = {
  // Cookie consent button to dismiss
  cookieAccept: "button:has-text('Akceptuj wszystkie')",
  // Match containers - each game row
  gameRow: ".ds-single-game, [class*='ds-single-game']",
  // Team names container
  teamsContainer: ".ds-single-game__teams",
  // Individual odds values
  oddsValue: ".ds-odds-value",
  // Odds group containing 1X2 odds
  oddsGroup: ".ds-odds-group",
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
        waitUntil: "domcontentloaded",
      });

      // Wait extra time for dynamic content to load
      await this.delay(3000);

      // Try to dismiss cookie consent if present
      try {
        const cookieButton = page.locator(SELECTORS.cookieAccept);
        if (await cookieButton.isVisible({ timeout: 2000 })) {
          await cookieButton.click();
          await this.delay(1000);
        }
      } catch {
        // Cookie modal might not be present, continue
      }

      // Wait for game rows to appear
      const hasEvents = await this.waitForSelector(page, SELECTORS.gameRow, 10000);

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
   * LVBet uses ds- (design system) classes
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

      // Find all game rows using ds-single-game class
      const gameRows = document.querySelectorAll(selectors.gameRow);

      gameRows.forEach((row) => {
        // Get team names from the teams container
        // Teams are displayed in spans with team kit icons, extract text
        const teamsContainer = row.querySelector(selectors.teamsContainer);
        if (!teamsContainer) return;

        // Team names are in spans, often with icon classes like ds-icon-teamkit-*
        // Extract all text nodes from teams container
        const teamTexts: string[] = [];
        const walker = document.createTreeWalker(
          teamsContainer,
          NodeFilter.SHOW_TEXT,
          null
        );
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent?.trim();
          if (text && text.length > 1) {
            teamTexts.push(text);
          }
        }

        // Usually first two non-empty texts are team names
        if (teamTexts.length < 2) return;

        const homeTeam = teamTexts[0];
        const awayTeam = teamTexts[1];

        if (!homeTeam || !awayTeam) return;

        // Get odds values - look for ds-odds-value elements
        const oddsElements = row.querySelectorAll(selectors.oddsValue);
        const odds: number[] = [];

        // Take first 3 odds (1X2 market)
        for (let i = 0; i < Math.min(3, oddsElements.length); i++) {
          const text = oddsElements[i]?.textContent?.trim() || "";
          const val = parseFloat(text.replace(",", "."));
          if (!isNaN(val) && val >= 1.01 && val <= 100) {
            odds.push(val);
          }
        }

        // Need exactly 3 valid odds
        if (odds.length === 3) {
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
