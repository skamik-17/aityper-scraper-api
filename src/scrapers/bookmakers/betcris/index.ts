/**
 * Betcris Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses WebSocket interception to capture odds from the Swarm API.
 *
 * Architecture:
 * - index.ts (this file): Orchestration and interface implementation
 * - navigation.ts: Playwright browser interactions and WebSocket capture
 * - parser.ts: Pure data transformation logic
 * - types.ts: Internal type definitions
 * - constants.ts: URLs, IDs, and configuration
 */

import type { Page } from "playwright";
import type { PolishBookmaker } from "../../../config/index.js";
import type {
  ScraperConfig,
  ScraperResult,
  RawScrapedOdds,
  MatchIdentifier,
  MatchDetailResult,
  EventUrlEntry,
} from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../team-matcher.js";

// Import modular components
import {
  LEAGUE_URLS,
  COMPETITION_IDS,
} from "./constants.js";
import {
  navigateToLeaguePage,
  navigateToMatchPage,
  captureSwarmData,
  extractGameIdFromUrl,
  buildEventUrl,
  getCompetitionId,
} from "./navigation.js";
import {
  parseSwarmDataForLeague,
  parseSwarmDataForMatchDetails,
  parseSwarmDataForFullOffer,
  parseAllMarkets,
  parseTeamNames,
} from "./parser.js";

/**
 * Betcris Playwright Scraper Implementation
 */
export class BetcrisPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betcris";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.betcris,
      ...config,
      enabled: true,
    };
  }

  /**
   * Scrape all matches for a specific league
   * Returns 1X2 odds for listing/comparison purposes
   */
  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    const competitionId = COMPETITION_IDS[league];
    const url = LEAGUE_URLS[league];

    if (!competitionId || !url) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Set up WebSocket interception before navigation
      const wsDataPromise = captureSwarmData(page, { competitionId });

      // Navigate to trigger WebSocket connection
      const navSuccess = await navigateToLeaguePage(page, league);
      if (!navSuccess) {
        return this.createErrorResult(
          new Error("Failed to navigate to league page"),
          Date.now() - startTime
        );
      }

      // Wait for WebSocket data
      const wsData = await Promise.race([
        wsDataPromise,
        this.delay(15000).then(() => null),
      ]);

      if (!wsData) {
        console.log("[Betcris] No WebSocket data captured");
        return this.createNotFoundResult(
          "No WebSocket data captured",
          Date.now() - startTime
        );
      }

      // Parse Swarm data
      const matches = parseSwarmDataForLeague(wsData, league, competitionId);

      if (matches.length === 0) {
        console.log("[Betcris] No matches parsed from WebSocket");
        return this.createNotFoundResult(
          "No matches in WebSocket data",
          Date.now() - startTime
        );
      }

      console.log(`[Betcris] Scraped ${matches.length} matches for ${league} via WebSocket`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matches,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (cleanup) await cleanup();
    }
  }

  /**
   * Scrape a specific match by team names
   */
  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";

    // Get all matches from the league
    const allMatches = await this.scrapeLeague(league);
    if (allMatches.status !== "success" || !allMatches.data) {
      return allMatches;
    }

    // Find the matching event
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
  }

  /**
   * Scrape detailed match page for extended markets
   * Returns 1X2, Double Chance, BTTS, and Over/Under markets
   */
  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    try {
      // Extract game ID from URL
      const gameId = extractGameIdFromUrl(eventUrl);
      if (!gameId) {
        return this.createMatchDetailNotFoundResult(
          "Invalid URL format",
          Date.now() - startTime
        );
      }

      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Set up WebSocket interception for match details
      const wsDataPromise = captureSwarmData(page, {
        singleEventMode: true,
        targetGameNumber: gameId,
      });

      // Navigate to match page
      const navSuccess = await navigateToMatchPage(page, eventUrl);
      if (!navSuccess) {
        return this.createMatchDetailErrorResult(
          new Error("Failed to navigate to match page"),
          Date.now() - startTime
        );
      }

      // Wait for WebSocket data
      const wsData = await Promise.race([
        wsDataPromise,
        this.delay(15000).then(() => null),
      ]);

      if (wsData) {
        const matchData = parseSwarmDataForMatchDetails(wsData, eventUrl, gameId);
        if (matchData) {
          return {
            status: "success",
            bookmaker: this.bookmaker,
            data: matchData,
            duration: Date.now() - startTime,
            timestamp: new Date(),
          };
        }
        console.log(
          `[Betcris] WebSocket data received but game ${gameId} not found or has insufficient markets`
        );
      } else {
        console.log(`[Betcris] No WebSocket data received for game ${gameId}`);
      }

      return this.createMatchDetailNotFoundResult(
        `Game ${gameId} details not found`,
        Date.now() - startTime
      );
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    } finally {
      if (cleanup) await cleanup();
    }
  }

  /**
   * Scrape FULL offer (all markets) for all matches in a league
   * This is the new primary method for comprehensive market extraction
   */
  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    const competitionId = COMPETITION_IDS[league];
    const url = LEAGUE_URLS[league];

    if (!competitionId || !url) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Set up WebSocket interception
      const wsDataPromise = captureSwarmData(page, { competitionId });

      // Navigate to trigger WebSocket connection
      const navSuccess = await navigateToLeaguePage(page, league);
      if (!navSuccess) {
        return this.createFullOfferErrorResult(
          league,
          new Error("Failed to navigate to league page"),
          Date.now() - startTime
        );
      }

      // Wait for WebSocket data
      const wsData = await Promise.race([
        wsDataPromise,
        this.delay(15000).then(() => null),
      ]);

      if (!wsData) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No WebSocket data captured",
          duration: Date.now() - startTime,
        };
      }

      // Get list of games from the initial WebSocket response
      const gamesInfo = parseSwarmDataForFullOffer(wsData, league, competitionId);
      console.log(`[Betcris/FullOffer] Found ${gamesInfo.length} games for ${league}`);

      // For full offer, we need to fetch each match's detailed data
      const matches: FullMatchOffer[] = [];

      for (const { game, teams, regionAlias, competitionId: compId } of gamesInfo) {
        try {
          const eventUrl = buildEventUrl(regionAlias, compId, game.id);

          // Set up WebSocket interception for this match
          const matchWsPromise = captureSwarmData(page, {
            singleEventMode: true,
            targetGameNumber: game.id,
          });

          // Navigate to match page
          await navigateToMatchPage(page, eventUrl);

          // Wait for detailed WebSocket data
          const matchWsData = await Promise.race([
            matchWsPromise,
            this.delay(10000).then(() => null),
          ]);

          if (matchWsData) {
            // Find the game with full markets in the response
            let fullGame = game;
            for (const sport of Object.values(matchWsData.sport || {})) {
              for (const region of Object.values(sport.region || {})) {
                for (const competition of Object.values(region.competition || {})) {
                  for (const g of Object.values(competition.game || {})) {
                    if (g.id === game.id && Object.keys(g.market || {}).length > Object.keys(fullGame.market || {}).length) {
                      fullGame = g;
                    }
                  }
                }
              }
            }

            const allMarkets = parseAllMarkets(fullGame, teams);

            if (allMarkets.length > 0) {
              matches.push({
                matchId: String(game.id),
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(teams.homeTeam, league),
                awayTeam: getCanonicalTeamName(teams.awayTeam, league),
                eventUrl,
                markets: allMarkets,
                scrapedAt: new Date(),
              });

              console.log(
                `[Betcris/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${allMarkets.length} markets`
              );
            }
          }

          // Small delay between requests
          await this.delay(100);
        } catch (error) {
          console.warn(
            `[Betcris/FullOffer] Failed to fetch details for game ${game.id}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[Betcris/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
      );

      return {
        success: true,
        bookmaker: this.bookmaker,
        league,
        matches,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return this.createFullOfferErrorResult(league, error, Date.now() - startTime);
    } finally {
      if (cleanup) await cleanup();
    }
  }

  /**
   * Extract event URLs from the current listing page
   * Not directly used for Betcris since we use WebSocket API
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // Betcris uses WebSocket for data fetching
    // This method is kept for interface compatibility
    const SELECTORS = {
      matchCard: "[data-testid='game']",
      teamName: ".comp__team-name",
    };

    return page.evaluate((selectors) => {
      const entries: EventUrlEntry[] = [];
      document.querySelectorAll(selectors.matchCard).forEach((card) => {
        const teamElements = card.querySelectorAll(selectors.teamName);
        if (teamElements.length < 2) return;
        const home = teamElements[0]?.textContent?.trim() || "";
        const away = teamElements[1]?.textContent?.trim() || "";
        const link =
          (card.querySelector("a[href*='/zaklady-bukmacherskie/']") as HTMLAnchorElement) ||
          (card.closest("a") as HTMLAnchorElement);
        if (link?.href) {
          entries.push({ matchKey: `${home} vs ${away}`, eventUrl: link.href });
        }
      });
      return entries;
    }, SELECTORS);
  }
}

// Export singleton instance
export const betcrisScraper = new BetcrisPlaywrightScraper();
