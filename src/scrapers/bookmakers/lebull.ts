/**
 * Le Bull Playwright Scraper
 * Scrapes odds from lebull.pl using headless Chromium
 *
 * NOTE: Le Bull embeds their betting content in an iframe from boxwebcdn.work
 * We navigate directly to the iframe URL for reliable scraping
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

// Le Bull uses iframe for betting content - these are the direct iframe URLs
// Format: https://lebullpl-ssr.boxwebcdn.work/pl/league/{sportId}/{leagueId}
const IFRAME_LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://lebullpl-ssr.boxwebcdn.work/pl/league/1/1810", // Football / Ekstraklasa
  "premier-league": "https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485", // Football / Premier League
};

// CSS selectors for Le Bull iframe page structure
// Each match is wrapped in .game-row-wrapper containing team names and odds
const SELECTORS = {
  // Match container - use game-row-wrapper which contains one match each
  matchWrapper: ".game-row-wrapper",
  // Team name elements
  teamName: ".team-column-name",
  // Odds elements - first 3 odds in .outcome-wrapper with .rank-arrow values
  oddsWrapper: ".outcome-wrapper",
  oddsValue: ".rank-arrow",
};

export class LebullScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lebull";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.lebull, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    const iframeUrl = IFRAME_LEAGUE_URLS[league];
    if (!iframeUrl) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      page = await this.initBrowser();

      // Human-like delay before navigation
      await this.delay(500 + Math.random() * 500);

      console.log(`[Le Bull] Navigating to iframe URL: ${iframeUrl}`);

      // Navigate directly to the iframe URL
      await this.navigateWithRetry(page, iframeUrl, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });

      // Wait for SPA to render content
      await this.delay(4000);

      // Set tall viewport to load all matches (lazy loading)
      await page.setViewportSize({ width: 1920, height: 5000 });
      await this.delay(2000);

      // Scroll to trigger lazy loading
      await page.evaluate(() => {
        window.scrollTo(0, 3000);
      });
      await this.delay(1500);

      // Wait for match elements to load
      const hasMatches = await this.waitForSelector(page, SELECTORS.matchWrapper, 15000);

      if (!hasMatches) {
        // Log page content for debugging
        const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log(`[Le Bull] Page content preview: ${pageText}`);

        return this.createNotFoundResult(
          `No ${league} matches found on page`,
          Date.now() - startTime
        );
      }

      // Additional wait for all odds to load
      await this.delay(2000);

      // Extract match data from page
      const data = await this.extractMatchData(page, league);

      if (data.length === 0) {
        return this.createNotFoundResult(
          "Could not parse any match data",
          Date.now() - startTime
        );
      }

      console.log(`[Le Bull] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[Le Bull] Scraping error for ${league}:`, error);
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  async scrapeEkstraklasa(): Promise<ScraperResult> {
    return this.scrapeLeague("ekstraklasa");
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
   * Extract match data from Le Bull iframe page
   *
   * Page structure:
   * - Each match is wrapped in .game-row-wrapper
   * - Team names are in .team-column-name spans (2 per match)
   * - Odds are in .outcome-wrapper divs with .rank-arrow for the value
   * - First 3 odds are 1X2 (home, draw, away)
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

      // Track seen matches to avoid duplicates (featured section shows same matches)
      const seenMatches = new Set<string>();

      // Find all match wrappers
      const wrappers = document.querySelectorAll(selectors.matchWrapper);

      wrappers.forEach((wrapper) => {
        // Get team names from .team-column-name elements
        const teamNameElements = wrapper.querySelectorAll(selectors.teamName);

        if (teamNameElements.length < 2) {
          return; // Skip if we can't find both teams
        }

        const homeTeam = teamNameElements[0]?.textContent?.trim() || "";
        const awayTeam = teamNameElements[1]?.textContent?.trim() || "";

        if (!homeTeam || !awayTeam) {
          return;
        }

        // Create unique key for deduplication
        const matchKey = `${homeTeam}-${awayTeam}`;
        if (seenMatches.has(matchKey)) {
          return; // Skip duplicate
        }

        // Get odds from .outcome-wrapper elements
        // The first 3 odds are 1X2 (home, draw, away)
        const oddsWrappers = wrapper.querySelectorAll(selectors.oddsWrapper);
        const odds: number[] = [];

        oddsWrappers.forEach((oddsWrapper) => {
          // Get the odds value from .rank-arrow element
          const valueElement = oddsWrapper.querySelector(selectors.oddsValue);
          let text = "";

          if (valueElement) {
            text = valueElement.textContent?.trim() || "";
          } else {
            // Fallback: get text directly from wrapper
            text = oddsWrapper.textContent?.trim() || "";
          }

          // Parse odds value (handle both "2.50" and "2,50" formats)
          const value = parseFloat(text.replace(",", "."));

          if (!isNaN(value) && value >= 1.01 && value <= 100) {
            odds.push(value);
          }
        });

        // Need at least 3 odds for 1X2 market
        if (odds.length >= 3) {
          seenMatches.add(matchKey);
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
      bookmaker: "lebull" as PolishBookmaker,
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
export const lebullScraper = new LebullScraper();
