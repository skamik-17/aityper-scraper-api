/**
 * TOTALbet Playwright Scraper
 * Scrapes odds from totalbet.pl using headless Chromium
 *
 * URL Structure: https://totalbet.pl/sports/events/Pi%C5%82ka-no%C5%BCna/{leagueId}?uncheckAll=true
 * League IDs:
 *   - 7124: Premier League
 *   - Ekstraklasa: Unknown (likely similar pattern, needs verification when matches available)
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

// League URLs for TOTALbet
// TOTALbet uses /sports/events/Pi%C5%82ka-no%C5%BCna/{leagueId}?uncheckAll=true format
const LEAGUE_URLS: Record<string, string> = {
  // Ekstraklasa league ID needs to be discovered when matches are available
  ekstraklasa:
    "https://totalbet.pl/sports/events/Pi%C5%82ka-no%C5%BCna/7023?uncheckAll=true",
  "premier-league":
    "https://totalbet.pl/sports/events/Pi%C5%82ka-no%C5%BCna/7124?uncheckAll=true",
};

// CSS selectors for TOTALbet page structure
// Based on DOM inspection: li.eventListPeriodItemPartial contains each match
const SELECTORS = {
  // Cookie consent
  cookieAccept: "button:has-text('Akceptuję')",
  // Match container - each match is in a li.eventListPeriodItemPartial element
  matchCard: "li.eventListPeriodItemPartial",
  // Event name contains "Team A - Team B" format
  eventName: "span.event-name",
  // Odds buttons - first 3 buttons in .game-layout-1 are 1X2 odds
  oddsContainer: ".game-layout-1 .game",
  oddsButton: "button.outcomeButtonPartial.btn-odd",
};

export class TotalbetScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "totalbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.totalbet, ...config, enabled: true };
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

      // Extra delay for SPA rendering - TOTALbet is React-based
      await this.delay(4000);

      // Try to dismiss cookie consent if present
      try {
        const cookieButton = page.locator(SELECTORS.cookieAccept).first();
        if (await cookieButton.isVisible({ timeout: 3000 })) {
          await cookieButton.click();
          console.log("[TOTALbet] Cookie consent dismissed");
          await this.delay(1000);
        }
      } catch {
        // Cookie modal might not be present, continue
      }

      // Set tall viewport to load all matches
      await page.setViewportSize({ width: 1920, height: 3000 });
      await this.delay(2000);

      // Scroll to load lazy content
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.delay(2000);

      // Wait for match elements to load
      const hasMatches = await this.waitForSelector(page, SELECTORS.matchCard, 15000);

      if (!hasMatches) {
        // Check if we got redirected to 404
        const currentUrl = page.url();
        if (currentUrl.includes("404") || currentUrl.includes("error")) {
          return this.createNotFoundResult(
            `League page not found (404): ${league}`,
            Date.now() - startTime
          );
        }
        return this.createNotFoundResult(
          `No ${league} matches found on page`,
          Date.now() - startTime
        );
      }

      // Additional wait for all content to load
      await this.delay(1500);

      // Extract match data from page
      const data = await this.extractMatchData(page, league);

      if (data.length === 0) {
        return this.createNotFoundResult(
          "Could not parse any match data",
          Date.now() - startTime
        );
      }

      console.log(`[TOTALbet] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[TOTALbet] Scraping error for ${league}:`, error);
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
   * TOTALbet structure:
   *   - li.eventListPeriodItemPartial = match container
   *   - span.event-name = "Team A - Team B"
   *   - .game-layout-1 .game button.outcomeButtonPartial = 1X2 odds (first 3 buttons)
   */
  private async extractMatchData(page: Page, league: string): Promise<RawScrapedOdds[]> {
    const matchData = await page.evaluate((selectors) => {
      const matches: Array<{
        homeTeam: string;
        awayTeam: string;
        homeOdds: number;
        drawOdds: number;
        awayOdds: number;
        eventId?: string;
      }> = [];

      const cards = document.querySelectorAll(selectors.matchCard);

      cards.forEach((card) => {
        // Get event ID from data attribute
        const eventId = (card as HTMLElement).dataset.eventId || "";

        // Get event name which contains "Team A - Team B"
        const eventNameEl = card.querySelector(selectors.eventName);
        const eventName = eventNameEl?.textContent?.trim() || "";

        if (!eventName) {
          return;
        }

        // Parse team names from event name (format: "Team A - Team B")
        const teamMatch = eventName.match(/^(.+?)\s*-\s*(.+)$/);
        if (!teamMatch) {
          return;
        }

        const homeTeam = teamMatch[1].trim();
        const awayTeam = teamMatch[2].trim();

        if (!homeTeam || !awayTeam) {
          return;
        }

        // Get 1X2 odds from the game-layout-1 container (first 3 buttons are 1X2)
        const oddsContainer = card.querySelector(selectors.oddsContainer);
        if (!oddsContainer) {
          return;
        }

        const oddsButtons = oddsContainer.querySelectorAll(selectors.oddsButton);
        const odds: number[] = [];

        // First 3 buttons are 1X2 odds
        for (let i = 0; i < Math.min(3, oddsButtons.length); i++) {
          const text = oddsButtons[i]?.textContent?.trim() || "";
          // The button text is the odds value directly (e.g., "2.67")
          const value = parseFloat(text.replace(",", "."));
          if (!isNaN(value) && value > 1 && value < 100) {
            odds.push(value);
          }
        }

        // Need exactly 3 odds for 1X2
        if (odds.length === 3) {
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
      bookmaker: "totalbet" as PolishBookmaker,
      eventName: `${match.homeTeam} - ${match.awayTeam}`,
      homeTeam: getCanonicalTeamName(match.homeTeam, league),
      awayTeam: getCanonicalTeamName(match.awayTeam, league),
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
      eventId: match.eventId,
      eventUrl: match.eventId
        ? `https://totalbet.pl/sports/event/${match.eventId}`
        : undefined,
    }));
  }
}

// Singleton instance
export const totalbetScraper = new TotalbetScraper();
