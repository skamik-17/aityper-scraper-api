/**
 * PZBuk Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses WebSocket/RSocket interception to capture odds data from PZBuk API.
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
  RawScrapedMatchOdds,
  EventUrlEntry,
} from "../../../types/scraper.js";
import type {
  FullOfferScraperResult,
  FullMatchOffer,
} from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";

// Import modular components
import { LEAGUE_IDS, LEAGUE_URLS, WS_CAPTURE_TIMEOUT } from "./constants.js";
import {
  navigateToLeaguePage,
  navigateToEventPage,
  captureWebSocketData,
  buildEventUrl,
  delay,
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
 * PZBuk Playwright Scraper Implementation
 */
export class PzbukPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "pzbuk";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.pzbuk,
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
    if (!LEAGUE_IDS[league] || !LEAGUE_URLS[league]) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Set up WebSocket interception BEFORE navigation
      const wsDataPromise = captureWebSocketData(page, false);

      // Navigate to league page
      const navSuccess = await navigateToLeaguePage(page, league);
      if (!navSuccess) {
        return this.createErrorResult(
          new Error("Failed to navigate to league page"),
          Date.now() - startTime
        );
      }

      // Wait for WebSocket data with timeout
      const wsData = await Promise.race([
        wsDataPromise,
        delay(WS_CAPTURE_TIMEOUT).then(() => null),
      ]);

      if (!wsData || !wsData.events || wsData.events.length === 0) {
        console.log("[PZBuk] No WebSocket data captured");
        return this.createNotFoundResult(
          "No WebSocket data captured",
          Date.now() - startTime
        );
      }

      console.log(
        `[PZBuk] Captured ${wsData.events.length} events, ${wsData.selections?.length || 0} selections`
      );

      // Transform WebSocket data to RawScrapedOdds
      const matches: RawScrapedOdds[] = [];

      for (const event of wsData.events) {
        if (!isValidEvent(event)) continue;

        const teams = parseTeamNames(event);
        if (!teams.homeTeam || !teams.awayTeam) continue;

        // Get selections for this event
        const eventSelections = (wsData.selections || []).filter(
          (s) => s.eventId === event.id
        );

        // Get 1X2 odds
        const odds1x2 = parse1X2Odds(eventSelections);

        // Skip if no valid 1X2 odds
        if (odds1x2.home <= 1 || odds1x2.draw <= 1 || odds1x2.away <= 1) {
          continue;
        }

        // Build event URL
        const eventUrl = buildEventUrl(
          event.id,
          teams.homeTeam,
          teams.awayTeam,
          event.leagueId,
          event.leagueName
        );

        matches.push({
          bookmaker: this.bookmaker,
          eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
          homeTeam: getCanonicalTeamName(teams.homeTeam, league),
          awayTeam: getCanonicalTeamName(teams.awayTeam, league),
          homeOdds: odds1x2.home,
          drawOdds: odds1x2.draw,
          awayOdds: odds1x2.away,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          eventUrl,
        });
      }

      console.log(`[PZBuk] Scraped ${matches.length} matches for ${league}`);

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
        `Match not found on PZBuk: ${match.homeTeam} vs ${match.awayTeam}`,
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
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Set up WebSocket interception for single event mode
      const wsDataPromise = captureWebSocketData(page, true);

      // Navigate to event page
      const navSuccess = await navigateToEventPage(page, eventUrl);
      if (!navSuccess) {
        return this.createMatchDetailNotFoundResult(
          "Failed to navigate to event page",
          Date.now() - startTime
        );
      }

      // Wait for WebSocket data
      const wsData = await Promise.race([
        wsDataPromise,
        delay(WS_CAPTURE_TIMEOUT).then(() => null),
      ]);

      if (
        !wsData ||
        !wsData.events?.length ||
        !wsData.markets?.length ||
        !wsData.selections?.length
      ) {
        return this.createMatchDetailNotFoundResult(
          "No WebSocket data for match details",
          Date.now() - startTime
        );
      }

      const event = wsData.events[0];
      const teams = parseTeamNames(event);

      if (!teams.homeTeam) {
        return this.createMatchDetailNotFoundResult(
          "Could not parse team names",
          Date.now() - startTime
        );
      }

      // Get all selections for this event
      const eventSelections = wsData.selections.filter(
        (s) => s.eventId === event.id && s.status === "Active"
      );

      // Parse standard markets
      const odds1x2 = parse1X2Odds(eventSelections);
      const doubleChance = parseDoubleChance(eventSelections);
      const btts = parseBTTS(eventSelections);
      const overUnder = parseOverUnder(eventSelections);

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
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
   * This is the primary method for comprehensive market extraction
   */
  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    // Validate league
    if (!LEAGUE_IDS[league] || !LEAGUE_URLS[league]) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Set up WebSocket interception BEFORE navigation
      const wsDataPromise = captureWebSocketData(page, false);

      // Navigate to league page
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
        delay(WS_CAPTURE_TIMEOUT).then(() => null),
      ]);

      if (!wsData || !wsData.events || wsData.events.length === 0) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No WebSocket data captured",
          duration: Date.now() - startTime,
        };
      }

      console.log(
        `[PZBuk/FullOffer] Found ${wsData.events.length} events in listing`
      );

      // For full offer, we need to fetch detailed data for each event
      // The league listing only has basic markets
      const matches: FullMatchOffer[] = [];

      for (const event of wsData.events) {
        if (!isValidEvent(event)) continue;

        const teams = parseTeamNames(event);
        if (!teams.homeTeam || !teams.awayTeam) continue;

        try {
          // Build event URL
          const eventUrl = buildEventUrl(
            event.id,
            teams.homeTeam,
            teams.awayTeam,
            event.leagueId,
            event.leagueName
          );

          // Navigate to event page for full markets
          const eventWsPromise = captureWebSocketData(page, true);
          const eventNavSuccess = await navigateToEventPage(page, eventUrl);

          if (!eventNavSuccess) {
            console.warn(
              `[PZBuk/FullOffer] Failed to navigate to ${teams.homeTeam} vs ${teams.awayTeam}`
            );
            continue;
          }

          // Wait for WebSocket data for this event
          const eventWsData = await Promise.race([
            eventWsPromise,
            delay(WS_CAPTURE_TIMEOUT).then(() => null),
          ]);

          if (eventWsData && eventWsData.selections?.length > 0) {
            // Parse all available markets
            const markets = parseAllMarkets(eventWsData, event.id, teams);

            if (markets.length > 0) {
              matches.push({
                matchId: event.id,
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(teams.homeTeam, league),
                awayTeam: getCanonicalTeamName(teams.awayTeam, league),
                eventUrl,
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[PZBuk/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
              );
            }
          }

          // Small delay between requests
          await delay(200);
        } catch (error) {
          console.warn(
            `[PZBuk/FullOffer] Failed to fetch details for ${teams.homeTeam} vs ${teams.awayTeam}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[PZBuk/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
      );

      return {
        success: true,
        bookmaker: this.bookmaker,
        league,
        matches,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return this.createFullOfferErrorResult(
        league,
        error,
        Date.now() - startTime
      );
    } finally {
      if (cleanup) await cleanup();
    }
  }

  /**
   * Extract event URLs from the current listing page
   * Not typically used for PZBuk since we use WebSocket for data
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // PZBuk uses WebSocket for data fetching
    // This method is kept for interface compatibility
    return [];
  }
}

// Export singleton instance
export const pzbukScraper = new PzbukPlaywrightScraper();
