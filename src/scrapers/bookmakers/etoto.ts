/**
 * eToto Playwright Scraper
 * Scrapes odds from etoto.pl using headless Chromium
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

// League URLs for eToto
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.etoto.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/666",
  "premier-league":
    "https://www.etoto.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/206",
};

// CSS selectors for eToto page structure
const SELECTORS = {
  // Cookie consent
  cookieAccept: "button[class*='cookie'], button:has-text('Akceptuję'), button:has-text('Zgadzam się'), .accept-cookies",
  // Match elements
  matchCard: "[class*='event'], [class*='Event'], [class*='match'], [class*='Match'], .event-row, .match-item",
  teamNames: "[class*='team'], [class*='Team'], [class*='participant'], [class*='Participant'], .team-name",
  oddsButton: "[class*='odds'], [class*='Odds'], [class*='odd'], [class*='Odd'], .bet-button, .odds-value",
  oddsValue: "[class*='value'], [class*='Value'], [class*='rate'], [class*='Rate']",
};

export class EtotoScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "etoto";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.etoto, ...config, enabled: true };
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
          console.log("[eToto] Cookie consent dismissed");
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

      console.log(`[eToto] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[eToto] Scraping error for ${league}:`, error);
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

      const cards = document.querySelectorAll(selectors.matchCard);

      cards.forEach((card) => {
        // Get team names
        const teamElements = card.querySelectorAll(selectors.teamNames);
        let homeTeam = "";
        let awayTeam = "";

        if (teamElements.length >= 2) {
          homeTeam = teamElements[0]?.textContent?.trim() || "";
          awayTeam = teamElements[1]?.textContent?.trim() || "";
        } else {
          // Try to find teams from text pattern
          const cardText = card.textContent || "";
          const vsMatch = cardText.match(/([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\s.-]+)\s*[-–vs]+\s*([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\s.-]+)/);
          if (vsMatch) {
            homeTeam = vsMatch[1].trim();
            awayTeam = vsMatch[2].trim();
          }
        }

        if (!homeTeam || !awayTeam) {
          return;
        }

        // Get odds - look for 1X2 values
        const oddsElements = card.querySelectorAll(selectors.oddsButton);
        const odds: number[] = [];

        oddsElements.forEach((el) => {
          const valueEl = el.querySelector(selectors.oddsValue);
          const text = (valueEl?.textContent || el.textContent)?.trim() || "";
          const value = parseFloat(text.replace(",", "."));
          if (!isNaN(value) && value > 1 && value < 100) {
            odds.push(value);
          }
        });

        // Need at least 3 odds for 1X2
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
      bookmaker: "etoto" as PolishBookmaker,
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
export const etotoScraper = new EtotoScraper();
