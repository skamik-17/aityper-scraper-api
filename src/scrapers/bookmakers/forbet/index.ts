/**
 * forBET Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses network interception to fetch odds directly from forBET API.
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
import { CATEGORY_IDS, CACHE_TTL } from "./constants.js";
import {
  navigateToBaseSite,
  fetchLeagueEvents,
  fetchAllLeagueEvents,
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
import type { ForbetEvent } from "./types.js";

// Cache for events data (module-level for cross-instance persistence)
let cachedEvents: Map<string, ForbetEvent> = new Map();
let cacheTimestamp: number = 0;

/**
 * forBET Playwright Scraper Implementation
 */
export class ForbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "forbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.forbet,
      ...config,
      enabled: true,
    };
  }

  /**
   * Update the events cache with fresh data
   */
  private updateCache(events: ForbetEvent[]): void {
    cacheTimestamp = Date.now();
    for (const event of events) {
      cachedEvents.set(String(event.eventId), event);
    }
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    return Date.now() - cacheTimestamp < CACHE_TTL;
  }

  /**
   * Get event from cache if available
   */
  private getCachedEvent(eventId: string): ForbetEvent | undefined {
    if (!this.isCacheValid()) {
      return undefined;
    }
    return cachedEvents.get(eventId);
  }

  /**
   * Scrape all matches for a specific league
   * Returns 1X2 odds for listing/comparison purposes
   */
  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    // Validate league
    if (!CATEGORY_IDS[league]) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate to establish session cookies
      console.log(`[forBET] Fetching data for category: ${CATEGORY_IDS[league]}`);
      const navSuccess = await navigateToBaseSite(page);
      if (!navSuccess) {
        return this.createErrorResult(
          new Error("Failed to navigate to base site"),
          Date.now() - startTime
        );
      }

      // Small delay to ensure session is established
      await this.delay(500);

      // Fetch events from API
      const events = await fetchLeagueEvents(page, league);

      if (events.length === 0) {
        return this.createNotFoundResult(
          "Could not fetch forBET API data",
          Date.now() - startTime
        );
      }

      // Update cache with fresh data
      this.updateCache(events);

      // Transform API data to RawScrapedOdds
      const matches: RawScrapedOdds[] = events
        .filter(isValidEvent)
        .filter(hasValid1X2Odds)
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
        });

      console.log(`[forBET] Found ${matches.length} matches with valid odds`);

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
        `Match not found on forBET: ${match.homeTeam} vs ${match.awayTeam}`,
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
          "Invalid forBET event URL",
          Date.now() - startTime
        );
      }

      // Check cache first
      let event = this.getCachedEvent(eventId);

      // If not in cache, fetch fresh data
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

        await this.delay(500);

        // Fetch all leagues to find the event
        const allEvents = await fetchAllLeagueEvents(page);
        event = allEvents.get(eventId);

        // Update cache
        this.updateCache(Array.from(allEvents.values()));
      }

      if (!event) {
        return this.createMatchDetailNotFoundResult(
          "Event not found in forBET API",
          Date.now() - startTime
        );
      }

      // Parse team names and markets
      const teams = parseTeamNames(event.eventName);
      const odds1x2 = parse1X2Odds(event);
      const doubleChance = parseDoubleChance(event);
      const btts = parseBTTS(event);
      const overUnder = parseOverUnder(event);

      console.log(`[forBET] Parsed match details for: ${teams.homeTeam} vs ${teams.awayTeam}`);
      console.log(
        `[forBET] Markets: 1X2=${odds1x2.home > 0}, DC=${!!doubleChance}, BTTS=${!!btts}, O/U lines=${overUnder ? Object.keys(overUnder).length : 0}`
      );

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName: event.eventName || "",
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
    if (!CATEGORY_IDS[league]) {
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

      await this.delay(500);

      // Fetch events for the league
      const events = await fetchLeagueEvents(page, league);

      if (events.length === 0) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No events found from API",
          duration: Date.now() - startTime,
        };
      }

      console.log(`[forBET/FullOffer] Found ${events.length} events, fetching details for each...`);

      // Process each event and fetch full details
      // The listing API only returns "major" games (~16 markets)
      // The detail API returns ALL available markets (50+ markets)
      const matches: FullMatchOffer[] = [];

      for (const event of events) {
        if (!isValidEvent(event)) continue;

        try {
          // Fetch detailed data for this event (all markets)
          const detailData = await fetchEventDetails(page, String(event.eventId));

          // Use detail data if available, otherwise fall back to listing data
          const fullEvent = detailData?.data || event;

          // Update cache with full event data
          if (detailData?.data) {
            this.updateCache([detailData.data]);
          }

          const teams = parseTeamNames(fullEvent.eventName);

          // Parse all available markets from the detailed event
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
              `[forBET/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
            );
          }

          // Small delay between requests to avoid rate limiting
          await this.delay(100);
        } catch (error) {
          console.warn(
            `[forBET/FullOffer] Failed to parse event ${event.eventId}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[forBET/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
   * Not used for forBET since we use API directly
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // forBET uses API for data fetching, not DOM scraping
    // This method is kept for interface compatibility
    return [];
  }
}

// Export singleton instance
export const forbetScraper = new ForbetPlaywrightScraper();
