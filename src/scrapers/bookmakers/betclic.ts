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

// League URLs for Betclic
// Note: URLs redirect to canonical form (e.g., anglia-premier-league-c3 -> premier-league-c3)
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.betclic.pl/pilka-nozna-sfootball/ekstraklasa-c221",
  "premier-league": "https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3",
};

// CSS selectors for Betclic page structure (updated Dec 2025)
const SELECTORS = {
  eventCard: "a.cardEvent",
  teamNames: ".scoreboard_contestantLabel",
  oddsContainer: ".market_odds",
  oddsButton: ".btn.is-odd",
};

export class BetclicPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betclic";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.betclic, ...config, enabled: true };
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

      // Navigate to league page (Angular SPA needs more time)
      await this.navigateWithRetry(page, leagueUrl, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });

      // Wait extra time for Angular to hydrate and render content
      await this.delay(6000);

      // Wait for event cards to appear
      const hasEvents = await this.waitForSelector(page, SELECTORS.eventCard, 15000);

      if (!hasEvents) {
        return this.createNotFoundResult(
          `No ${league} matches found on Betclic page`,
          Date.now() - startTime
        );
      }

      // Extract match data from page
      const data = await this.extractMatchData(page, league);

      if (data.length === 0) {
        return this.createNotFoundResult(
          `Could not parse any ${league} match data from Betclic`,
          Date.now() - startTime
        );
      }

      console.log(`[Betclic] Successfully scraped ${data.length} ${league} matches`);

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
  private async extractMatchData(page: Page, league: string): Promise<RawScrapedOdds[]> {
    const matchData = await page.evaluate((selectors) => {
      const matches: Array<{
        homeTeam: string;
        awayTeam: string;
        homeOdds: number;
        drawOdds: number;
        awayOdds: number;
      }> = [];

      // Find all event cards (a.cardEvent)
      document.querySelectorAll(selectors.eventCard).forEach((card) => {
        // Get team names from .scoreboard_contestantLabel
        const teamElements = card.querySelectorAll(selectors.teamNames);
        if (teamElements.length < 2) return;

        const homeTeam = teamElements[0]?.textContent?.trim() || "";
        const awayTeam = teamElements[1]?.textContent?.trim() || "";

        if (!homeTeam || !awayTeam) return;

        // Extract odds from card text - look for pattern like "4,85" or "4.85"
        const cardText = card.textContent || "";
        const oddsMatches = cardText.match(/\d+[,\.]\d{2}/g) || [];
        const odds = oddsMatches.slice(0, 3).map(o => parseFloat(o.replace(",", ".")));

        if (odds.length < 3 || odds.some((o) => isNaN(o) || o <= 1)) {
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
export const betclicPlaywrightScraper = new BetclicPlaywrightScraper();
