/**
 * LeBull Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses network interception to fetch odds from sbteam.xyz API responses.
 *
 * Architecture:
 * - index.ts (this file): Orchestration and interface implementation
 * - navigation.ts: Playwright browser interactions and API capture
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
import { LEAGUE_IDS } from "./constants.js";
import {
  captureLeagueEvents,
  getLeagueId,
  extractEventIdFromUrl,
  buildEventUrl,
  getCachedEvent,
  getAllLeagueIds,
} from "./navigation.js";
import {
  parseTeamNames,
  parse1X2Odds,
  parseEventMarkets,
  parseAllMarkets,
  isValidEvent,
  hasValid1X2Odds,
} from "./parser.js";

/**
 * LeBull Playwright Scraper Implementation
 */
export class LebullPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lebull";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.lebull,
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
    const leagueId = getLeagueId(league);
    if (!leagueId) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      console.log(`[LeBull] Capturing data for league: ${league} (ID: ${leagueId})`);

      // Capture events via network interception
      const events = await captureLeagueEvents(
        page,
        this.navigateWithRetry.bind(this),
        leagueId
      );

      if (events.length === 0) {
        return this.createNotFoundResult(
          "Could not capture LeBull API data",
          Date.now() - startTime
        );
      }

      console.log(`[LeBull] Captured ${events.length} events from API`);

      // Transform events to RawScrapedOdds
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
          eventUrl: buildEventUrl(leagueId, event.eventId),
        });
      }

      console.log(`[LeBull] Found ${matches.length} matches with valid odds`);

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
        `Match not found on LeBull: ${match.homeTeam} vs ${match.awayTeam}`,
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
          "Invalid LeBull event URL",
          Date.now() - startTime
        );
      }

      // Check cache first
      let event = getCachedEvent(eventId);

      // If not in cache, fetch fresh data by scraping all leagues
      if (!event) {
        const { page, cleanup: sessionCleanup } = await this.initBrowser();
        cleanup = sessionCleanup;

        // Search across all leagues to find this event
        for (const { id: leagueId } of getAllLeagueIds()) {
          const events = await captureLeagueEvents(
            page,
            this.navigateWithRetry.bind(this),
            leagueId
          );
          event = events.find((e) => String(e.eventId) === eventId) || null;
          if (event) break;
        }
      }

      if (!event) {
        return this.createMatchDetailNotFoundResult(
          "Event not found in LeBull API",
          Date.now() - startTime
        );
      }

      // Parse all markets from event
      const teams = parseTeamNames(event);
      const { m1X2, mDC, mBTTS, mOU } = parseEventMarkets(event);

      console.log(`[LeBull] Parsed match details for: ${teams.homeTeam} vs ${teams.awayTeam}`);
      console.log(
        `[LeBull] Markets: 1X2=${m1X2.home > 0}, DC=${mDC.homeOrDraw > 0}, BTTS=${mBTTS.yes > 0}, O/U lines=${Object.keys(mOU).length}`
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
          home: m1X2.home,
          draw: m1X2.draw,
          away: m1X2.away,
        },
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
   * This is the primary method for comprehensive market extraction
   *
   * STRATEGY: Use route interception to inject extended stakeTypes into the
   * listing API request. This returns ALL markets in a single request,
   * eliminating the need to navigate to individual event pages.
   *
   * The sbteam.xyz API filters markets by the stakeTypes parameter.
   * By default, only ~6 market types are requested. By injecting our
   * EXTENDED_STAKE_TYPE_IDS, we get 20+ market types with 40+ individual markets.
   */
  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    // Validate league
    const leagueId = getLeagueId(league);
    if (!leagueId) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      console.log(`[LeBull/FullOffer] Capturing data for league: ${league}`);

      // Capture events with EXTENDED stake types via route interception
      // This is the key: useExtendedStakeTypes=true injects all market types
      const events = await captureLeagueEvents(
        page,
        this.navigateWithRetry.bind(this),
        leagueId,
        true // useExtendedStakeTypes - returns ALL markets in listing
      );

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

      console.log(`[LeBull/FullOffer] Found ${events.length} events with extended markets`);

      // Process each event - all markets are already included from the listing
      const matches: FullMatchOffer[] = [];

      for (const event of events) {
        if (!isValidEvent(event)) continue;

        const teams = parseTeamNames(event);

        // Parse all available markets from the extended listing response
        const markets = parseAllMarkets(event, teams);

        if (markets.length > 0) {
          matches.push({
            matchId: String(event.eventId),
            bookmaker: this.bookmaker,
            homeTeam: getCanonicalTeamName(teams.homeTeam, league),
            awayTeam: getCanonicalTeamName(teams.awayTeam, league),
            eventUrl: buildEventUrl(leagueId, event.eventId),
            markets,
            scrapedAt: new Date(),
          });

          console.log(
            `[LeBull/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[LeBull/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
   * Not used for LeBull since we use API directly
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // LeBull uses API for data fetching, not DOM scraping
    // This method is kept for interface compatibility
    return [];
  }
}

// Export singleton instance
export const lebullScraper = new LebullPlaywrightScraper();
