/**
 * STS Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses WebSocket interception to extract odds data from sts.pl
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
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";

// Import modular components
import { LEAGUE_CONFIG } from "./constants.js";
import {
  navigateAndCaptureLeagueData,
  navigateAndCaptureMatchData,
  extractFixtureIdFromUrl,
} from "./navigation.js";
import {
  parseLeagueData,
  parseWebSocketJson,
  parseFixtures,
  extractOdds,
  parseAllMarkets,
  hasValid1X2Odds,
  oddsToMarketOverUnder,
} from "./parser.js";

/**
 * STS Playwright Scraper Implementation
 */
export class STSPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "sts";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.sts,
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
    if (!LEAGUE_CONFIG[league]) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate and capture WebSocket data
      const captureResult = await navigateAndCaptureLeagueData(page, league);
      if (!captureResult) {
        return this.createNotFoundResult(
          "No WebSocket data received",
          Date.now() - startTime
        );
      }

      // Parse fixtures with odds
      const parsedData = parseLeagueData(captureResult, league);
      if (parsedData.length === 0) {
        return this.createNotFoundResult(
          `No matches found for ${league}`,
          Date.now() - startTime
        );
      }

      // Transform to RawScrapedOdds
      const matches: RawScrapedOdds[] = parsedData.map(({ fixture, odds }) => ({
        bookmaker: this.bookmaker,
        eventName: `${fixture.home} - ${fixture.away}`,
        homeTeam: getCanonicalTeamName(fixture.home, league),
        awayTeam: getCanonicalTeamName(fixture.away, league),
        homeOdds: odds.odds1!,
        drawOdds: odds.oddsX!,
        awayOdds: odds.odds2!,
        hasNoTaxPromo: false,
        scrapedAt: new Date(),
        eventUrl: fixture.eventUrl,
      }));

      console.log(`[STS] Found ${matches.length} matches with valid odds`);

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
        `Match not found on STS: ${match.homeTeam} vs ${match.awayTeam}`,
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

      // Navigate and capture WebSocket data for the match
      const captureResult = await navigateAndCaptureMatchData(page, eventUrl);
      if (!captureResult) {
        return this.createMatchDetailNotFoundResult(
          "No WebSocket data received",
          Date.now() - startTime
        );
      }

      // Extract fixture ID for targeting
      const fixtureId = extractFixtureIdFromUrl(eventUrl);

      // Parse initial JSON to find fixture info
      const initialJson = parseWebSocketJson(captureResult.initialData);
      const fixtureJson = fixtureId
        ? captureResult.fixtureData.get(fixtureId) || null
        : null;

      // Find the target fixture in the data
      const matchData = this.findAndParseMatchData(
        fixtureJson,
        initialJson,
        fixtureId,
        eventUrl
      );

      if (!matchData) {
        return this.createMatchDetailNotFoundResult(
          "Could not parse match data",
          Date.now() - startTime
        );
      }

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matchData,
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
   * Find fixture in data and parse match details
   */
  private findAndParseMatchData(
    fixtureJson: import("./types.js").STSWebSocketData | null,
    initialJson: import("./types.js").STSWebSocketData | null,
    targetFixtureId: string,
    eventUrl: string
  ): RawScrapedMatchOdds | null {
    // Use the data source that contains fixture info
    const dataSource = initialJson || fixtureJson;
    if (!dataSource) return null;

    // Navigate to football fixtures: B.S.1.C.{catId}.T.{tournId}.FX.{fixId}
    const footballData = dataSource.B?.S?.["1"];
    if (!footballData?.C) return null;

    // Search through all categories and tournaments
    for (const [, cat] of Object.entries(footballData.C)) {
      if (!cat.T) continue;

      for (const [, tourn] of Object.entries(cat.T)) {
        if (!tourn.FX) continue;

        for (const [fixId, fix] of Object.entries(tourn.FX)) {
          // Only process the target fixture
          if (fixId !== targetFixtureId) continue;

          if (!fix.H?.n || !fix.A?.n) continue;

          const fixture = {
            id: fixId,
            home: fix.H.n,
            away: fix.A.n,
            startTime: fix.t || "",
            stsId: fix.sid || 0,
            tournament: tourn.n || "",
            country: cat.n || "",
            eventUrl,
          };

          // Extract odds from both sources
          const odds = extractOdds(fixture, fixtureJson, initialJson);

          return {
            bookmaker: this.bookmaker,
            eventName: `${fixture.home} - ${fixture.away}`,
            homeTeam: fixture.home,
            awayTeam: fixture.away,
            eventUrl,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            market1X2: {
              home: odds.odds1 || 0,
              draw: odds.oddsX || 0,
              away: odds.odds2 || 0,
            },
            marketDoubleChance: odds.odds1X
              ? {
                  homeOrDraw: odds.odds1X,
                  drawOrAway: odds.oddsX2 || 0,
                  homeOrAway: odds.odds12 || 0,
                }
              : undefined,
            marketOverUnder: oddsToMarketOverUnder(odds),
            marketBTTS: odds.bttsYes
              ? {
                  yes: odds.bttsYes,
                  no: odds.bttsNo || 0,
                }
              : undefined,
          };
        }
      }
    }

    return null;
  }

  /**
   * Scrape FULL offer (all markets) for all matches in a league
   * This is the new primary method for comprehensive market extraction
   */
  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    // Validate league
    if (!LEAGUE_CONFIG[league]) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate and capture WebSocket data for the league
      const captureResult = await navigateAndCaptureLeagueData(page, league);
      if (!captureResult) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No WebSocket data received",
          duration: Date.now() - startTime,
        };
      }

      // Parse initial JSON to get fixtures
      const initialJson = parseWebSocketJson(captureResult.initialData);
      if (!initialJson) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "Failed to parse WebSocket data",
          duration: Date.now() - startTime,
        };
      }

      // Get all fixtures for this league
      const fixtures = parseFixtures(initialJson, league);
      if (fixtures.length === 0) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No fixtures found for league",
          duration: Date.now() - startTime,
        };
      }

      console.log(`[STS/FullOffer] Found ${fixtures.length} fixtures for ${league}`);

      // For each fixture, navigate to detail page for extended markets
      const matches: FullMatchOffer[] = [];

      for (const fixture of fixtures) {
        try {
          // Navigate to match detail page to get fixture-specific data
          const matchCaptureResult = await navigateAndCaptureMatchData(
            page,
            fixture.eventUrl
          );

          if (!matchCaptureResult) {
            console.warn(
              `[STS/FullOffer] No data for ${fixture.home} vs ${fixture.away}`
            );
            continue;
          }

          // Get fixture-specific JSON (has extended markets)
          const fixtureJson = matchCaptureResult.fixtureData.get(fixture.id) || null;
          const matchInitialJson = parseWebSocketJson(matchCaptureResult.initialData);

          // Parse all available markets
          const markets = parseAllMarkets(fixture, fixtureJson, matchInitialJson);

          if (markets.length > 0) {
            matches.push({
              matchId: fixture.id,
              bookmaker: this.bookmaker,
              homeTeam: getCanonicalTeamName(fixture.home, league),
              awayTeam: getCanonicalTeamName(fixture.away, league),
              eventUrl: fixture.eventUrl,
              markets,
              scrapedAt: new Date(),
            });

            console.log(
              `[STS/FullOffer] ${fixture.home} vs ${fixture.away}: ${markets.length} markets`
            );
          }

          // Small delay between requests
          await this.delay(200);
        } catch (error) {
          console.warn(
            `[STS/FullOffer] Failed to fetch details for ${fixture.home} vs ${fixture.away}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[STS/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
   * Not used for STS since we get URLs from WebSocket data
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // STS uses WebSocket for data fetching, not DOM scraping
    // Event URLs are constructed from fixture data
    return [];
  }
}

// Export singleton instance
export const stsScraper = new STSPlaywrightScraper();

// Also export with legacy name for backward compatibility
export { STSPlaywrightScraper as STSScraper };
