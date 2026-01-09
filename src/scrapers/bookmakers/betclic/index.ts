/**
 * Betclic Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses gRPC-web API with protobuf encoding to fetch odds data.
 *
 * Architecture:
 * - index.ts (this file): Orchestration and interface implementation
 * - navigation.ts: gRPC API request handling
 * - parser.ts: Protobuf parsing and data transformation
 * - types.ts: Internal type definitions
 * - constants.ts: URLs, IDs, and configuration
 *
 * Key Features:
 * - Direct gRPC-web API access (no DOM scraping needed)
 * - Protobuf message encoding/decoding
 * - Full offer extraction with all available markets
 * - Support for very large match IDs (BigInt)
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
import {
  fetchLeagueMatches,
  fetchMatchDetails,
  extractMatchIdFromUrl,
  buildEventUrl,
  isLeagueSupported,
} from "./navigation.js";
import {
  parseListingResponse,
  parseMatchDetailsResponse,
  parseAllMarkets,
  parseAllMarketsFromProto,
  parseTeamNames,
  extract1X2Market,
  extractDoubleChanceMarket,
  extractBTTSMarket,
  extractOverUnderMarkets,
  isValidMatch,
} from "./parser.js";
import type { BetclicListingMatch } from "./types.js";

/**
 * Betclic Playwright Scraper Implementation
 *
 * Note: Despite extending PlaywrightScraper, this scraper primarily uses
 * the gRPC-web API. Playwright is only used when DOM interaction is needed
 * (e.g., for establishing sessions in restricted scenarios).
 */
export class BetclicPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betclic";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.betclic,
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

    // Validate league
    if (!isLeagueSupported(league)) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      // Fetch listing data via gRPC API
      const responseData = await fetchLeagueMatches(league);
      if (!responseData) {
        return this.createNotFoundResult(
          `No ${league} matches found on Betclic`,
          Date.now() - startTime
        );
      }

      // Parse the protobuf response
      const parsedMatches = parseListingResponse(responseData, league);

      if (parsedMatches.length === 0) {
        return this.createNotFoundResult(
          `Could not parse any ${league} match data from Betclic`,
          Date.now() - startTime
        );
      }

      // Transform to RawScrapedOdds format
      const matches: RawScrapedOdds[] = parsedMatches
        .filter(isValidMatch)
        .map((match) => ({
          bookmaker: this.bookmaker,
          eventName: match.matchName,
          homeTeam: getCanonicalTeamName(match.homeTeam, league),
          awayTeam: getCanonicalTeamName(match.awayTeam, league),
          homeOdds: match.homeOdds,
          drawOdds: match.drawOdds,
          awayOdds: match.awayOdds,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          eventUrl: match.matchId
            ? buildEventUrl(match.matchId, league, match.homeTeam, match.awayTeam)
            : undefined,
        }));

      console.log(`[Betclic] Successfully scraped ${matches.length} ${league} matches via gRPC API`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matches,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Betclic] API scraping error:", error);
      return this.createErrorResult(error, Date.now() - startTime);
    }
  }

  /**
   * Scrape a specific match by team names
   */
  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "premier-league";

    try {
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
          `Match not found on Betclic: ${match.homeTeam} vs ${match.awayTeam}`,
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
   * Scrape detailed match page for extended markets
   * Returns 1X2, Double Chance, BTTS, and Over/Under markets
   */
  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();

    try {
      // Extract match ID from URL
      const matchId = extractMatchIdFromUrl(eventUrl);
      if (!matchId) {
        return this.createMatchDetailNotFoundResult(
          "Could not extract match ID from URL",
          Date.now() - startTime
        );
      }

      // Fetch match details via gRPC API
      const responseData = await fetchMatchDetails(matchId);
      if (!responseData) {
        return this.createMatchDetailNotFoundResult(
          "No match data received",
          Date.now() - startTime
        );
      }

      // Parse match details
      const matchDetails = parseMatchDetailsResponse(responseData);
      if (!matchDetails) {
        return this.createMatchDetailNotFoundResult(
          "Could not parse match data",
          Date.now() - startTime
        );
      }

      const { homeTeam, awayTeam, outcomes } = matchDetails;

      // Extract specific markets
      const market1X2 = extract1X2Market(outcomes, homeTeam, awayTeam);
      const marketDoubleChance = extractDoubleChanceMarket(outcomes, homeTeam, awayTeam);
      const marketBTTS = extractBTTSMarket(outcomes);
      const marketOverUnder = extractOverUnderMarkets(outcomes);

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName: matchDetails.matchName,
        homeTeam,
        awayTeam,
        eventUrl,
        hasNoTaxPromo: false,
        scrapedAt: new Date(),
        market1X2: market1X2 || { home: 0, draw: 0, away: 0 },
        marketDoubleChance: marketDoubleChance || undefined,
        marketBTTS: marketBTTS || undefined,
        marketOverUnder: marketOverUnder || undefined,
      };

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matchOdds,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Betclic] Error scraping match details:", error);
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    }
  }

  /**
   * Scrape FULL offer (all markets) for all matches in a league
   * This is the new primary method for comprehensive market extraction
   */
  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startTime = Date.now();

    // Validate league
    if (!isLeagueSupported(league)) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    try {
      // Fetch listing to get all matches
      const listingData = await fetchLeagueMatches(league);
      if (!listingData) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No events found from API",
          duration: Date.now() - startTime,
        };
      }

      // Parse listing to get match IDs
      const listingMatches = parseListingResponse(listingData, league);
      console.log(`[Betclic/FullOffer] Found ${listingMatches.length} events in listing`);

      const matches: FullMatchOffer[] = [];

      // Process each match and fetch full details
      for (const listingMatch of listingMatches) {
        if (!listingMatch.matchId) continue;

        try {
          // Fetch detailed data for this match
          const detailData = await fetchMatchDetails(listingMatch.matchId);

          if (detailData) {
            // Try parsing markets directly from protobuf structure first
            const markets = parseAllMarketsFromProto(detailData);

            if (markets.length > 0) {
              // Extract team names from listing match or parse from first market
              const homeTeam = listingMatch.homeTeam;
              const awayTeam = listingMatch.awayTeam;

              matches.push({
                matchId: listingMatch.matchId,
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(homeTeam, league),
                awayTeam: getCanonicalTeamName(awayTeam, league),
                eventUrl: buildEventUrl(
                  listingMatch.matchId,
                  league,
                  homeTeam,
                  awayTeam
                ),
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[Betclic/FullOffer] ${homeTeam} vs ${awayTeam}: ${markets.length} markets`
              );
            } else {
              // Fallback: use the legacy parseMatchDetailsResponse + parseAllMarkets
              const details = parseMatchDetailsResponse(detailData);

              if (details && details.outcomes.length > 0) {
                const teams = parseTeamNames(details.matchName);
                const fallbackMarkets = parseAllMarkets(details.outcomes, teams);

                if (fallbackMarkets.length > 0) {
                  matches.push({
                    matchId: listingMatch.matchId,
                    bookmaker: this.bookmaker,
                    homeTeam: getCanonicalTeamName(teams.homeTeam, league),
                    awayTeam: getCanonicalTeamName(teams.awayTeam, league),
                    eventUrl: buildEventUrl(
                      listingMatch.matchId,
                      league,
                      teams.homeTeam,
                      teams.awayTeam
                    ),
                    markets: fallbackMarkets,
                    scrapedAt: new Date(),
                  });

                  console.log(
                    `[Betclic/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${fallbackMarkets.length} markets (fallback)`
                  );
                }
              }
            }
          }

          // Small delay between requests to avoid rate limiting
          await this.delay(100);
        } catch (error) {
          console.warn(
            `[Betclic/FullOffer] Failed to fetch details for match ${listingMatch.matchId}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[Betclic/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
    }
  }

  /**
   * Extract event URLs from the current listing page
   * Not used for Betclic since we use gRPC API directly
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // Betclic uses gRPC API for data fetching, not DOM scraping
    // This method is kept for interface compatibility
    return [];
  }
}

// Export singleton instance
export const betclicScraper = new BetclicPlaywrightScraper();
