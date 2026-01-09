/**
 * LVBet Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses REST API via page.request.fetch for data acquisition.
 *
 * Architecture:
 * - index.ts (this file): Orchestration and interface implementation
 * - navigation.ts: Playwright browser interactions and API calls
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
import { TOURNAMENT_IDS, REQUEST_DELAY } from "./constants.js";
import {
  navigateToBaseSite,
  fetchLeagueMatches,
  fetchMarketsForMatches,
  fetchMarketsForMatch,
  fetchMatchInfo,
  extractMatchIdFromUrl,
  buildEventUrl,
} from "./navigation.js";
import {
  buildOddsMap,
  parseAllMarkets,
  parseExtendedMarkets,
  isValidMatch,
  hasValid1X2Odds,
} from "./parser.js";
import type { LVBetMatch, LVBetMarket } from "./types.js";

/**
 * LVBet Playwright Scraper Implementation
 */
export class LVBetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lvbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.lvbet,
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
    const tournamentId = TOURNAMENT_IDS[league];
    if (!tournamentId) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate to establish session
      const navSuccess = await navigateToBaseSite(page);
      if (!navSuccess) {
        return this.createErrorResult(
          new Error("Failed to navigate to base site"),
          Date.now() - startTime
        );
      }

      // Fetch matches from competition-view endpoint
      const matchesData = await fetchLeagueMatches(page, league);
      if (!matchesData?.matches || matchesData.matches.length === 0) {
        return this.createNotFoundResult(
          "Could not fetch LVBet matches",
          Date.now() - startTime
        );
      }

      console.log(`[LVBet] Found ${matchesData.matches.length} matches from API`);

      // Collect all match IDs for batch odds fetch
      const matchIds = matchesData.matches.map((m) => m.match_id);

      // Batch fetch odds for all matches
      const marketsData = await fetchMarketsForMatches(page, matchIds);
      if (!marketsData) {
        return this.createNotFoundResult(
          "Could not fetch LVBet markets",
          Date.now() - startTime
        );
      }

      // Build odds map by match_id using parser
      const oddsMap = buildOddsMap(marketsData);
      console.log(`[LVBet] Found odds for ${oddsMap.size}/${matchesData.matches.length} matches`);

      // Build matches with odds
      const matches: RawScrapedOdds[] = [];

      for (const m of matchesData.matches) {
        if (!isValidMatch(m)) continue;

        const homeTeam = m.home![0];
        const awayTeam = m.away![0];
        const odds = oddsMap.get(m.match_id);

        if (!odds || !hasValid1X2Odds(odds)) continue;

        matches.push({
          bookmaker: this.bookmaker,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam: getCanonicalTeamName(homeTeam, league),
          awayTeam: getCanonicalTeamName(awayTeam, league),
          homeOdds: odds.home,
          drawOdds: odds.draw,
          awayOdds: odds.away,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          eventUrl: buildEventUrl(m, league),
        });
      }

      if (matches.length === 0) {
        return this.createNotFoundResult(
          "No matches with odds found on LVBet",
          Date.now() - startTime
        );
      }

      console.log(`[LVBet] Successfully scraped ${matches.length} matches for ${league}`);

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
        `Match not found on LVBet: ${match.homeTeam} vs ${match.awayTeam}`,
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
      // Extract match ID from URL
      const matchId = extractMatchIdFromUrl(eventUrl);
      if (!matchId) {
        return this.createMatchDetailNotFoundResult(
          "Invalid LVBet event URL - cannot extract match_id",
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

      // Fetch markets for match
      const marketsData = await fetchMarketsForMatch(page, matchId);
      if (!marketsData || marketsData.length === 0) {
        return this.createMatchDetailNotFoundResult(
          "Could not fetch LVBet markets for match",
          Date.now() - startTime
        );
      }

      // Parse extended markets using parser
      const parsedMarkets = parseExtendedMarkets(marketsData);

      // Get team names from match info
      let homeTeam = "";
      let awayTeam = "";
      let eventName = "Match";

      const matchInfo = await fetchMatchInfo(page, matchId);
      if (matchInfo?.home?.[0] && matchInfo?.away?.[0]) {
        homeTeam = matchInfo.home[0];
        awayTeam = matchInfo.away[0];
        eventName = `${homeTeam} - ${awayTeam}`;
      }

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName,
        homeTeam,
        awayTeam,
        eventUrl,
        hasNoTaxPromo: false,
        scrapedAt: new Date(),
        market1X2: parsedMarkets.market1X2,
        marketDoubleChance: parsedMarkets.marketDoubleChance,
        marketBTTS: parsedMarkets.marketBTTS,
        marketOverUnder: parsedMarkets.marketOverUnder,
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
    const tournamentId = TOURNAMENT_IDS[league];
    if (!tournamentId) {
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

      // Fetch matches list
      const matchesData = await fetchLeagueMatches(page, league);
      if (!matchesData?.matches || matchesData.matches.length === 0) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No matches found from API",
          duration: Date.now() - startTime,
        };
      }

      console.log(`[LVBet/FullOffer] Found ${matchesData.matches.length} matches`);

      // Process each match and fetch full details
      const matches: FullMatchOffer[] = [];

      for (const match of matchesData.matches) {
        if (!isValidMatch(match)) continue;

        try {
          // Fetch all markets for this match
          const marketsData = await fetchMarketsForMatch(page, match.match_id);

          if (marketsData && marketsData.length > 0) {
            const homeTeam = match.home![0];
            const awayTeam = match.away![0];

            // Parse all available markets
            const markets = parseAllMarkets(marketsData, {
              homeTeam,
              awayTeam,
            });

            if (markets.length > 0) {
              matches.push({
                matchId: match.match_id,
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(homeTeam, league),
                awayTeam: getCanonicalTeamName(awayTeam, league),
                eventUrl: buildEventUrl(match, league),
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[LVBet/FullOffer] ${homeTeam} vs ${awayTeam}: ${markets.length} markets`
              );
            }
          }

          // Small delay between requests to avoid rate limiting
          await this.delay(REQUEST_DELAY);
        } catch (error) {
          console.warn(
            `[LVBet/FullOffer] Failed to fetch details for match ${match.match_id}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[LVBet/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
   * Not used for LVBet since we use API directly
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // LVBet uses API for data fetching, not DOM scraping
    // This method is kept for interface compatibility
    return [];
  }
}

// Export singleton instance
export const lvbetScraper = new LVBetPlaywrightScraper();
