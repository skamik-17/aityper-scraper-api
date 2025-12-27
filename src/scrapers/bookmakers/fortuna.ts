/**
 * Fortuna Playwright Scraper
 * Scrapes odds from efortuna.pl using headless Chromium
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

// League URLs for Fortuna
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/polska-3/ekstraklasa-polska",
  "premier-league":
    "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-8/premier-league-anglia",
};

// CSS selectors for Fortuna page structure
const SELECTORS = {
  marketOutcomes: ".fixture-card__market-outcomes",
  oddsValue: ".odds-button2__value",
  oddsLabel: ".odds-button2__label",
  participant: ".fixture-card__participant .m-0",
  scoreboard: ".mini-scoreboard",
};

export class FortunaPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "fortuna";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.fortuna, ...config, enabled: true };
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
      await this.delay(2000);

      // Wait for odds to appear
      const hasOdds = await this.waitForSelector(page, SELECTORS.oddsValue, 10000);

      if (!hasOdds) {
        return this.createNotFoundResult(
          `No ${league} odds found on page`,
          Date.now() - startTime
        );
      }

      // Extract match data from page
      const data = await this.extractMatchData(page, league);

      if (data.length === 0) {
        return this.createNotFoundResult(
          "Could not parse any match data",
          Date.now() - startTime
        );
      }

      console.log(`[Fortuna] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[Fortuna] Scraping error for ${league}:`, error);
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

      // Find all market outcomes sections
      document.querySelectorAll(selectors.marketOutcomes).forEach((outcomes) => {
        // Get the labels to determine if this is a 1X2 market
        const labels = outcomes.querySelectorAll(selectors.oddsLabel);
        if (labels.length < 3) return;

        // Check if middle label is "Remis" (draw) - this identifies 1X2 market
        const middleLabel = labels[1].textContent?.trim() || "";
        if (middleLabel !== "Remis") {
          return; // Skip non-1X2 markets (like double chance, etc.)
        }

        // Get the odds
        const oddsElements = outcomes.querySelectorAll(selectors.oddsValue);
        const odds = Array.from(oddsElements)
          .slice(0, 3)
          .map((el) => parseFloat(el.textContent?.trim() || "0"));

        if (odds.length < 3 || odds.some((o) => isNaN(o) || o <= 0)) {
          return;
        }

        // Get team names from labels (home = first, away = third)
        const homeLabel = labels[0].textContent?.trim() || "";
        const awayLabel = labels[2].textContent?.trim() || "";

        if (homeLabel && awayLabel) {
          matches.push({
            homeTeam: homeLabel,
            awayTeam: awayLabel,
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
      bookmaker: "fortuna" as PolishBookmaker,
      eventName: `${match.homeTeam} - ${match.awayTeam}`,
      homeTeam: getCanonicalTeamName(match.homeTeam, league),
      awayTeam: getCanonicalTeamName(match.awayTeam, league),
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      hasNoTaxPromo: false, // Standard 12% tax applies
      promoDetails: undefined,
      scrapedAt: new Date(),
    }));
  }
}

// Singleton instance
export const fortunaPlaywrightScraper = new FortunaPlaywrightScraper();
