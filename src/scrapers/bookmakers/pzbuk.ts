/**
 * PZBuk Playwright Scraper
 * Scrapes odds from pzbuk.pl using headless Chromium
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

// League URLs for PZBuk
// PZBuk uses /pl/sportsbook/sport/1-pilka-nozna/leagues/{id}-{name} URL structure
// League IDs found by navigating the site:
// - 524 = Polska Ekstraklasa
// - 134 = England Premier League (note: redirects to "anglia-premier-league")
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/524-polska-ekstraklasa",
  "premier-league":
    "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league",
};

// CSS selectors for PZBuk page structure (styled-components based)
// Classes use pattern: sportsbook-{component}__StyledName-sc-{hash}-{n}
const SELECTORS = {
  // Cookie consent - OneTrust
  cookieAccept: "#onetrust-accept-btn-handler",
  // Game cards - the main container for each match
  gameCard: "[data-at='game-card'], [class*='game-card-base__GameCardWrapper']",
  // Team names within scoreboard
  teamName: "[class*='ParticipantLabel'], small[class*='Participant']",
  // Score rows containing team names (home is first, away is second)
  scoreRow: "[class*='ScoreRow']",
  // Odds selection buttons
  oddsButton: "button[data-at='sportsbook-selection-btn']",
  // Odds value within button
  oddsValue: "[class*='SelectionButtonOdds']",
  // Alternative: get odds from label inside button (shows "1", "X", "2" labels and values)
  oddsLabel: "[class*='SelectionButtonLabel']",
};

export class PzbukScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "pzbuk";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.pzbuk, ...config, enabled: true };
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

      // Try to dismiss cookie consent if present (OneTrust)
      try {
        const cookieButton = page.locator(SELECTORS.cookieAccept);
        if (await cookieButton.isVisible({ timeout: 2000 })) {
          await cookieButton.click();
          console.log("[PZBuk] Cookie consent dismissed");
          await this.delay(1000);
        }
      } catch {
        // Cookie modal might not be present, continue
      }

      // Set tall viewport to load all matches
      await page.setViewportSize({ width: 1920, height: 3000 });
      await this.delay(2000);

      // Wait for game cards to load
      const hasMatches = await this.waitForSelector(page, SELECTORS.gameCard, 15000);

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

      console.log(`[PZBuk] Successfully scraped ${data.length} ${league} matches`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[PZBuk] Scraping error for ${league}:`, error);
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
   * PZBuk uses styled-components with game cards containing:
   * - Scoreboard section with ParticipantLabel elements for team names
   * - Selection buttons with SelectionButtonOdds for 1X2 odds
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

      // Find all game cards
      const cards = document.querySelectorAll(selectors.gameCard);

      cards.forEach((card) => {
        // Get team names from ParticipantLabel elements
        // Structure: ScoreRow (home) > ParticipantLabel, ScoreRow (away) > ParticipantLabel
        const teamElements = card.querySelectorAll(selectors.teamName);
        let homeTeam = "";
        let awayTeam = "";

        if (teamElements.length >= 2) {
          homeTeam = teamElements[0]?.textContent?.trim() || "";
          awayTeam = teamElements[1]?.textContent?.trim() || "";
        }

        if (!homeTeam || !awayTeam) {
          return;
        }

        // Get odds from selection buttons
        // Each button contains: SelectionButtonLabel (1, X, 2) and SelectionButtonOdds (value)
        const oddsButtons = card.querySelectorAll(selectors.oddsButton);
        const odds: number[] = [];

        oddsButtons.forEach((btn) => {
          // Find the odds value element within the button
          const oddsEl = btn.querySelector(selectors.oddsValue);
          if (oddsEl) {
            const text = oddsEl.textContent?.trim() || "";
            const value = parseFloat(text.replace(",", "."));
            if (!isNaN(value) && value > 1 && value < 100) {
              odds.push(value);
            }
          }
        });

        // Need exactly 3 odds for 1X2 market (home win, draw, away win)
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
      bookmaker: "pzbuk" as PolishBookmaker,
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
export const pzbukScraper = new PzbukScraper();
