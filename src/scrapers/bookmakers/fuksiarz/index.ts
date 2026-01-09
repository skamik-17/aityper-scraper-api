/**
 * Fuksiarz Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses network interception to fetch odds directly from Fuksiarz REST API.
 *
 * Architecture:
 * - index.ts (this file): Orchestration and interface implementation
 * - navigation.ts: Playwright browser interactions and API fetching
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
import { CATEGORY_IDS, LEAGUE_URLS, CACHE_TTL } from "./constants.js";
import {
  navigateToBaseSite,
  fetchLeagueEvents,
  fetchAllLeagueEvents,
  fetchEventDetails,
  extractEventIdFromUrl,
  buildEventUrl,
  isLeagueSupported,
} from "./navigation.js";
import {
  parseTeamNames,
  parse1X2Odds,
  parseDoubleChance,
  parseBTTS,
  parseOverUnder,
  parseAllMarkets,
  parseEventMarkets,
  isValidEvent,
  hasValid1X2Odds,
} from "./parser.js";
import type { FuksiarzEvent } from "./types.js";

// Module-level cache for events data
let cachedEvents: Map<string, FuksiarzEvent> = new Map();
let cacheTimestamp: number = 0;

/**
 * Fuksiarz Playwright Scraper Implementation
 */
export class FuksiarzPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "fuksiarz";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.fuksiarz,
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
    if (!isLeagueSupported(league)) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate to establish session cookies
      const navSuccess = await navigateToBaseSite(page);
      if (!navSuccess) {
        return this.createErrorResult(
          new Error("Failed to navigate to base site"),
          Date.now() - startTime
        );
      }

      // Fetch events from API
      const events = await fetchLeagueEvents(page, league);
      if (!events || events.length === 0) {
        return this.createNotFoundResult(
          "Could not fetch Fuksiarz API data",
          Date.now() - startTime
        );
      }

      console.log(`[Fuksiarz] Captured ${events.length} events from API`);

      // Update cache
      cacheTimestamp = Date.now();
      for (const event of events) {
        cachedEvents.set(String(event.eventId), event);
      }

      // Transform API data to RawScrapedOdds
      const matches: RawScrapedOdds[] = events
        .filter(isValidEvent)
        .map((event) => {
          const teams = parseTeamNames(event.eventName);
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
        .filter((m) => m.homeOdds > 1 && m.drawOdds > 1 && m.awayOdds > 1);

      console.log(`[Fuksiarz] Found ${matches.length} matches with valid odds`);

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
        `Match not found on Fuksiarz: ${match.homeTeam} vs ${match.awayTeam}`,
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
          "Invalid Fuksiarz event URL",
          Date.now() - startTime
        );
      }

      // Check cache first
      const isCacheValid = Date.now() - cacheTimestamp < CACHE_TTL;
      let event = isCacheValid ? cachedEvents.get(eventId) : null;

      // If not in cache, fetch fresh data from all leagues
      if (!event) {
        const { page, cleanup: sessionCleanup } = await this.initBrowser();
        cleanup = sessionCleanup;

        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createMatchDetailErrorResult(
            new Error("Failed to navigate to base site"),
            Date.now() - startTime
          );
        }

        // Fetch all leagues to find the event
        const allEvents = await fetchAllLeagueEvents(page);

        // Update cache
        cacheTimestamp = Date.now();
        cachedEvents = allEvents;

        event = allEvents.get(eventId);
      }

      if (!event) {
        return this.createMatchDetailNotFoundResult(
          "Event not found in Fuksiarz API",
          Date.now() - startTime
        );
      }

      // Parse all markets from event
      const { m1X2, mDC, mBTTS, mOU } = parseEventMarkets(event);
      const teams = parseTeamNames(event.eventName);

      console.log(`[Fuksiarz] Parsed match details for: ${teams.homeTeam} vs ${teams.awayTeam}`);
      console.log(
        `[Fuksiarz] Markets: 1X2=${m1X2.home > 0}, DC=${mDC.homeOrDraw > 0}, BTTS=${mBTTS.yes > 0}, O/U lines=${Object.keys(mOU).length}`
      );

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName: event.eventName || "",
        homeTeam: teams.homeTeam,
        awayTeam: teams.awayTeam,
        eventUrl,
        hasNoTaxPromo: false,
        scrapedAt: new Date(),
        market1X2: m1X2,
        marketDoubleChance: mDC.homeOrDraw > 0 ? mDC : undefined,
        marketBTTS: mBTTS.yes > 0 ? mBTTS : undefined,
        marketOverUnder: Object.keys(mOU).length > 0 ? mOU : undefined,
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
    if (!isLeagueSupported(league)) {
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
      const navSuccess = await navigateToBaseSite(page);
      if (!navSuccess) {
        return this.createFullOfferErrorResult(
          league,
          new Error("Failed to navigate to base site"),
          Date.now() - startTime
        );
      }

      // Fetch events list
      const events = await fetchLeagueEvents(page, league);
      if (!events || events.length === 0) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No events found from API",
          duration: Date.now() - startTime,
        };
      }

      console.log(`[Fuksiarz/FullOffer] Found ${events.length} events`);

      // Update cache with listing data (may have limited markets)
      cacheTimestamp = Date.now();
      for (const event of events) {
        cachedEvents.set(String(event.eventId), event);
      }

      // Process each event - fetch full details for each to get ALL markets
      const matches: FullMatchOffer[] = [];

      for (const event of events) {
        if (!isValidEvent(event)) continue;

        try {
          const eventId = String(event.eventId);
          const teams = parseTeamNames(event.eventName);

          // Fetch detailed event data to get ALL markets
          const detailResponse = await fetchEventDetails(page, eventId);

          // Use detailed data if available, otherwise fall back to listing data
          const fullEvent = detailResponse?.data || event;

          // Update cache with full event data
          if (detailResponse?.data) {
            cachedEvents.set(eventId, detailResponse.data);
          }

          // Parse all available markets from the event data
          const markets = parseAllMarkets(fullEvent, teams);

          if (markets.length > 0) {
            matches.push({
              matchId: eventId,
              bookmaker: this.bookmaker,
              homeTeam: getCanonicalTeamName(teams.homeTeam, league),
              awayTeam: getCanonicalTeamName(teams.awayTeam, league),
              eventUrl: buildEventUrl(event.eventId),
              markets,
              scrapedAt: new Date(),
            });

            console.log(
              `[Fuksiarz/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
            );
          }

          // Small delay between requests to avoid rate limiting
          await this.delay(100);
        } catch (error) {
          console.warn(
            `[Fuksiarz/FullOffer] Failed to parse event ${event.eventId}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[Fuksiarz/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
   * Not used for Fuksiarz since we use API directly
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // Fuksiarz uses API for data fetching, not DOM scraping
    // This method is kept for interface compatibility
    return [];
  }
}

// Export singleton instance
export const fuksiarzScraper = new FuksiarzPlaywrightScraper();
