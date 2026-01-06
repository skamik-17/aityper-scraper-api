/**
 * Betfan Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses Betfan's REST API for data fetching, with Playwright to establish
 * browser session cookies.
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
import { findMatchingEvent, getCanonicalTeamName } from "../../team-matcher.js";

// Import modular components
import { CATEGORY_IDS, BASE_URL } from "./constants.js";
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
import type { BetfanEvent, EventsCacheEntry } from "./types.js";
import { CACHE_TTL } from "./constants.js";

/**
 * Events cache for avoiding redundant API calls
 */
let eventsCache: EventsCacheEntry | null = null;

/**
 * Get cached event by ID if cache is still valid
 */
function getCachedEvent(eventId: string): BetfanEvent | null {
  if (!eventsCache) return null;
  if (Date.now() - eventsCache.timestamp > CACHE_TTL) return null;
  return eventsCache.events.get(eventId) || null;
}

/**
 * Update the events cache
 */
function updateCache(events: BetfanEvent[]): void {
  const eventsMap = new Map<string, BetfanEvent>();
  for (const event of events) {
    eventsMap.set(String(event.eventId), event);
  }
  eventsCache = {
    events: eventsMap,
    timestamp: Date.now(),
  };
}

/**
 * Betfan Playwright Scraper Implementation
 */
export class BetfanPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betfan";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.betfan,
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
      console.log(`[Betfan] Fetching data for category: ${CATEGORY_IDS[league]}`);
      const navSuccess = await navigateToBaseSite(page);
      if (!navSuccess) {
        return this.createErrorResult(
          new Error("Failed to navigate to Betfan"),
          Date.now() - startTime
        );
      }

      // Fetch events from API
      const events = await fetchLeagueEvents(page, league);
      if (events.length === 0) {
        return this.createNotFoundResult(
          "Could not fetch Betfan API data",
          Date.now() - startTime
        );
      }

      console.log(`[Betfan] Captured ${events.length} events from API`);

      // Update cache
      updateCache(events);

      // Transform API data to RawScrapedOdds
      const matches: RawScrapedOdds[] = [];

      for (const event of events) {
        if (!isValidEvent(event)) continue;

        const teams = parseTeamNames(event);
        const odds1x2 = parse1X2Odds(event);

        // Skip events without valid 1X2 odds
        if (odds1x2.home <= 1 || odds1x2.draw <= 1 || odds1x2.away <= 1) {
          continue;
        }

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
          eventUrl: buildEventUrl(event.eventId),
        });
      }

      console.log(`[Betfan] Found ${matches.length} matches with valid odds`);

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
        `Match not found on Betfan: ${match.homeTeam} vs ${match.awayTeam}`,
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
          "Invalid Betfan event URL",
          Date.now() - startTime
        );
      }

      // Check cache first
      let event = getCachedEvent(eventId);

      // If not in cache, fetch fresh data from all leagues
      if (!event) {
        const { page, cleanup: sessionCleanup } = await this.initBrowser();
        cleanup = sessionCleanup;

        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createMatchDetailErrorResult(
            new Error("Failed to navigate to Betfan"),
            Date.now() - startTime
          );
        }

        // Fetch all league events to find this event
        const allEvents = await fetchAllLeagueEvents(page);

        // Update cache
        const eventsArray = Array.from(allEvents.values());
        updateCache(eventsArray);

        event = allEvents.get(eventId) || null;
      }

      if (!event) {
        return this.createMatchDetailNotFoundResult(
          "Event not found in Betfan API",
          Date.now() - startTime
        );
      }

      // Parse all markets from event
      const teams = parseTeamNames(event);
      const odds1x2 = parse1X2Odds(event);
      const doubleChance = parseDoubleChance(event);
      const btts = parseBTTS(event);
      const overUnder = parseOverUnder(event);

      console.log(`[Betfan] Parsed match details for: ${teams.homeTeam} vs ${teams.awayTeam}`);
      console.log(
        `[Betfan] Markets: 1X2=${odds1x2.home > 0}, DC=${doubleChance !== null}, BTTS=${btts !== null}, O/U lines=${overUnder ? Object.keys(overUnder).length : 0}`
      );

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
          new Error("Failed to navigate to Betfan"),
          Date.now() - startTime
        );
      }

      // Fetch events list - Betfan returns all markets in the events endpoint
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

      console.log(`[Betfan/FullOffer] Found ${events.length} events`);

      // Update cache with listing data (used for scrapeMatchDetails fallback)
      updateCache(events);

      // Process each event - fetch full market data from event detail endpoint
      const matches: FullMatchOffer[] = [];

      for (const event of events) {
        if (!isValidEvent(event)) continue;

        const teams = parseTeamNames(event);

        try {
          // Fetch detailed data for this event (returns 300+ markets vs ~34 from listing)
          const detailEvent = await fetchEventDetails(page, String(event.eventId));

          if (detailEvent && detailEvent.games && detailEvent.games.length > 0) {
            // Parse all available markets from the detailed event data
            const markets = parseAllMarkets(detailEvent);

            if (markets.length > 0) {
              matches.push({
                matchId: String(event.eventId),
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(teams.homeTeam, league),
                awayTeam: getCanonicalTeamName(teams.awayTeam, league),
                eventUrl: buildEventUrl(event.eventId),
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[Betfan/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
              );
            }
          } else {
            // Fallback to listing data if detail fetch fails
            const markets = parseAllMarkets(event);
            if (markets.length > 0) {
              matches.push({
                matchId: String(event.eventId),
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(teams.homeTeam, league),
                awayTeam: getCanonicalTeamName(teams.awayTeam, league),
                eventUrl: buildEventUrl(event.eventId),
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[Betfan/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets (fallback)`
              );
            }
          }

          // Small delay between requests to avoid rate limiting
          await this.delay(100);
        } catch (error) {
          console.warn(
            `[Betfan/FullOffer] Failed to fetch details for event ${event.eventId}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[Betfan/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
   * Not used for Betfan since we use API directly
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // Betfan uses API for data fetching, not DOM scraping
    // This method is kept for interface compatibility
    return [];
  }
}

// Export singleton instance
export const betfanScraper = new BetfanPlaywrightScraper();
