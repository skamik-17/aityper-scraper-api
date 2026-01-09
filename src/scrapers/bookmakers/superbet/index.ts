/**
 * Superbet Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses network interception to fetch odds directly from Superbet API.
 *
 * Architecture:
 * - index.ts (this file): Orchestration and interface implementation
 * - navigation.ts: Playwright browser interactions
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
  RawScrapedMatchOdds,
  EventUrlEntry,
} from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";

// Import modular components
import { LEAGUE_URLS, TOURNAMENT_IDS, BASE_URL } from "./constants.js";
import {
  navigateToLeaguePage,
  navigateToBaseSite,
  fetchLeagueEvents,
  fetchEventDetails,
  extractEventIdFromUrl,
  buildEventUrl,
} from "./navigation.js";
import {
  parseTeamNames,
  parse1X2Odds,
  parseDoubleChance,
  parseBTTS,
  parseOverUnder,
  parseAllMarkets,
  isValidEvent,
  hasValid1X2Odds,
} from "./parser.js";

/**
 * Superbet Playwright Scraper Implementation
 */
export class SuperbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "superbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.superbet,
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

    // Validate league
    if (!LEAGUE_URLS[league] || !TOURNAMENT_IDS[league]) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate to establish session cookies
      const navSuccess = await navigateToLeaguePage(page, league);
      if (!navSuccess) {
        return this.createErrorResult(
          new Error("Failed to navigate to league page"),
          Date.now() - startTime
        );
      }

      // Fetch events from API
      const apiData = await fetchLeagueEvents(page, league);
      if (!apiData || !apiData.data || apiData.data.length === 0) {
        return this.createNotFoundResult(
          "Could not capture Superbet API data",
          Date.now() - startTime
        );
      }

      console.log(`[Superbet] Captured ${apiData.data.length} events from API`);

      // Transform API data to RawScrapedOdds
      const matches: RawScrapedOdds[] = apiData.data
        .filter(isValidEvent)
        .map((event) => {
          const teams = parseTeamNames(event.matchName);
          const odds1x2 = parse1X2Odds(event);

          return {
            bookmaker: this.bookmaker,
            eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
            homeTeam: getCanonicalTeamName(teams.homeTeam, league),
            awayTeam: getCanonicalTeamName(teams.awayTeam, league),
            homeOdds: odds1x2.home,
            drawOdds: odds1x2.draw,
            awayOdds: odds1x2.away,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            eventUrl: buildEventUrl(event.eventId),
          };
        })
        .filter((m) => m.homeOdds > 0);

      console.log(`[Superbet] Found ${matches.length} matches with valid odds`);

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
        `Match not found on Superbet: ${match.homeTeam} vs ${match.awayTeam}`,
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
      // Extract event ID from URL
      const eventId = extractEventIdFromUrl(eventUrl);
      if (!eventId) {
        return this.createMatchDetailNotFoundResult(
          "Invalid Superbet event URL",
          Date.now() - startTime
        );
      }

      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate to establish session
      const navSuccess = await navigateToBaseSite(page);
      if (!navSuccess) {
        return this.createMatchDetailErrorResult(
          new Error("Failed to navigate to base site"),
          Date.now() - startTime
        );
      }

      // Fetch event details from API
      const detailData = await fetchEventDetails(page, eventId);
      if (!detailData || !detailData.data || detailData.data.length === 0) {
        return this.createMatchDetailNotFoundResult(
          "Could not capture Superbet detail API data",
          Date.now() - startTime
        );
      }

      const event = detailData.data[0];
      const teams = parseTeamNames(event.matchName);
      const odds = event.odds || [];

      // Parse all standard markets
      const odds1x2 = parse1X2Odds(event);
      const doubleChance = parseDoubleChance(odds);
      const btts = parseBTTS(odds);
      const overUnder = parseOverUnder(odds);

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName: event.matchName || "",
        homeTeam: teams.homeTeam,
        awayTeam: teams.awayTeam,
        eventUrl,
        hasNoTaxPromo: false,
        scrapedAt: new Date(),
        market1X2: {
          home: odds1x2.home,
          draw: odds1x2.draw,
          away: odds1x2.away,
        },
        marketDoubleChance: doubleChance || undefined,
        marketBTTS: btts || undefined,
        marketOverUnder: overUnder || undefined,
      };

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matchOdds,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
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

    // Validate league
    if (!LEAGUE_URLS[league] || !TOURNAMENT_IDS[league]) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate to establish session
      const navSuccess = await navigateToLeaguePage(page, league);
      if (!navSuccess) {
        return this.createFullOfferErrorResult(
          league,
          new Error("Failed to navigate to league page"),
          Date.now() - startTime
        );
      }

      // Fetch events list
      const apiData = await fetchLeagueEvents(page, league);
      if (!apiData || !apiData.data || apiData.data.length === 0) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No events found from API",
          duration: Date.now() - startTime,
        };
      }

      console.log(`[Superbet/FullOffer] Found ${apiData.data.length} events`);

      // Process each event and fetch full details
      const matches: FullMatchOffer[] = [];

      for (const event of apiData.data) {
        if (!isValidEvent(event)) continue;

        try {
          // Fetch detailed data for this event
          const detailData = await fetchEventDetails(page, String(event.eventId));

          if (detailData && detailData.data && detailData.data.length > 0) {
            const fullEvent = detailData.data[0];
            const teams = parseTeamNames(fullEvent.matchName);

            // Parse all available markets
            const markets = parseAllMarkets(fullEvent, teams);

            if (markets.length > 0) {
              matches.push({
                matchId: String(fullEvent.eventId),
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(teams.homeTeam, league),
                awayTeam: getCanonicalTeamName(teams.awayTeam, league),
                eventUrl: buildEventUrl(fullEvent.eventId),
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[Superbet/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
              );
            }
          }

          // Small delay between requests to avoid rate limiting
          await this.delay(100);
        } catch (error) {
          console.warn(
            `[Superbet/FullOffer] Failed to fetch details for event ${event.eventId}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[Superbet/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
   * Not used for Superbet since we use API directly
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // Superbet uses API for data fetching, not DOM scraping
    // This method is kept for interface compatibility
    return [];
  }
}

// Export singleton instance
export const superbetScraper = new SuperbetPlaywrightScraper();
