/**
 * Betters Playwright Scraper
 * Scrapes odds from betters.pl using headless Chromium
 *
 * Betters uses an embedded iframe for the sportsbook from betterspl-ssr.boxwebcdn.work
 * We navigate directly to the iframe source URL to avoid iframe handling complexity.
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

// Betters sportsbook is loaded from this external domain in an iframe
// We navigate directly to it to avoid iframe complexity
const SPORTSBOOK_BASE_URL = "https://betterspl-ssr.boxwebcdn.work/pl";

// League URLs - direct paths to the sportsbook iframe content
// Format: /league/{sport_id}/{league_id}
// Sport 1 = Football
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: `${SPORTSBOOK_BASE_URL}/league/1/4440`, // Polish Ekstraklasa
  "premier-league": `${SPORTSBOOK_BASE_URL}/league/1/4485`, // English Premier League
};

// CSS selectors for Betters sportsbook page structure
const SELECTORS = {
  // Match row container - each match is wrapped in this
  gameRowWrapper: ".game-row-wrapper",
  gameRow: ".game-row.bg-main-2",

  // Team names - span elements containing team text
  teamName: ".team-column-name",
  teamColumn: ".team-column",

  // Odds container and values
  oddsGroup: ".game-row-odds-group",
  oddsWrapper: ".outcome-wrapper.odd-cell",
  oddsValue: ".odd-cell-value",

  // Market name (to identify 1X2 market)
  marketName: ".market-name",

  // Featured/card matches (top section)
  marketCard: ".market-card",
  marketCardTeamName: ".market-card-teams-name-wr",
  marketCardOddsGroup: ".market-card-odds-group",
  marketCardOddsWrapper: ".outcome-wrapper.odd",
};

export class BettersScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betters";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.betters, ...config, enabled: true };
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
      await this.delay(500 + Math.random() * 500);

      // Navigate directly to the sportsbook iframe URL (bypasses main site wrapper)
      await this.navigateWithRetry(page, leagueUrl, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });

      // Wait for SPA rendering - Betters uses React
      await this.delay(4000);

      // Set tall viewport to load all matches via lazy loading
      await page.setViewportSize({ width: 1920, height: 3000 });
      await this.delay(2000);

      // Wait for game rows to appear
      const hasMatches = await this.waitForSelector(page, SELECTORS.gameRowWrapper, 15000);

      if (!hasMatches) {
        // Try alternative selector for featured matches
        const hasFeatured = await this.waitForSelector(page, SELECTORS.marketCard, 5000);
        if (!hasFeatured) {
          return this.createNotFoundResult(
            `No ${league} matches found on page`,
            Date.now() - startTime
          );
        }
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

      console.log(`[Betters] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[Betters] Scraping error for ${league}:`, error);
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

      // Extract from game rows (main match list - "Nadchodzące" section)
      document.querySelectorAll(selectors.gameRowWrapper).forEach((wrapper) => {
        const row = wrapper.querySelector(selectors.gameRow);
        if (!row) return;

        // Get team names - there should be 2 team-column elements
        const teamElements = row.querySelectorAll(selectors.teamName);
        if (teamElements.length < 2) return;

        const homeTeam = teamElements[0]?.textContent?.trim() || "";
        const awayTeam = teamElements[1]?.textContent?.trim() || "";

        if (!homeTeam || !awayTeam) return;

        // Get odds from the first odds group (should be 1X2 "Wynik meczu")
        const oddsGroup = wrapper.querySelector(selectors.oddsGroup);
        if (!oddsGroup) return;

        const oddsElements = oddsGroup.querySelectorAll(selectors.oddsValue);
        const odds: number[] = [];

        oddsElements.forEach((el) => {
          const text = el.textContent?.trim() || "";
          const value = parseFloat(text.replace(",", "."));
          if (!isNaN(value) && value > 1 && value < 100) {
            odds.push(value);
          }
        });

        // Need exactly 3 odds for 1X2
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

      // Also extract from featured market cards if present (top carousel section)
      document.querySelectorAll(selectors.marketCard).forEach((card) => {
        // Get team names from card
        const teamElements = card.querySelectorAll(selectors.marketCardTeamName);
        if (teamElements.length < 2) return;

        const homeTeam = teamElements[0]?.textContent?.trim() || "";
        const awayTeam = teamElements[1]?.textContent?.trim() || "";

        if (!homeTeam || !awayTeam) return;

        // Check if this match is already in the list
        const alreadyExists = matches.some(
          (m) => m.homeTeam === homeTeam && m.awayTeam === awayTeam
        );
        if (alreadyExists) return;

        // Get odds from card
        const oddsGroup = card.querySelector(selectors.marketCardOddsGroup);
        if (!oddsGroup) return;

        const oddsElements = oddsGroup.querySelectorAll(selectors.marketCardOddsWrapper);
        const odds: number[] = [];

        oddsElements.forEach((el) => {
          const text = el.textContent?.trim() || "";
          // Extract number from text like "1 2.68" or "X 3.10"
          const match = text.match(/(\d+[.,]\d+)/);
          if (match) {
            const value = parseFloat(match[1].replace(",", "."));
            if (!isNaN(value) && value > 1 && value < 100) {
              odds.push(value);
            }
          }
        });

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
      bookmaker: "betters" as PolishBookmaker,
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
export const bettersScraper = new BettersScraper();
