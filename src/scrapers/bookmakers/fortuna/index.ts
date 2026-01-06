/**
 * Fortuna Playwright Scraper
 *
 * Main entry point implementing the PlaywrightScraper interface.
 * Uses Fortuna REST API for data fetching (api.efortuna.pl).
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
import { findMatchingEvent, getCanonicalTeamName } from "../../team-matcher.js";

// Import modular components
import {
  BASE_URL,
  LEAGUE_URLS,
  TOURNAMENT_IDS,
  API_REQUEST_DELAY,
} from "./constants.js";
import {
  navigateToBaseSite,
  fetchLeagueData,
  fetchAllMarketsForFixture,
  fetchFixtureById,
  extractFixtureIdFromUrl,
  buildEventUrl,
} from "./navigation.js";
import {
  parseTeamNames,
  parse1X2Odds,
  parseDoubleChance,
  parseBTTS,
  parseOverUnder,
  parseAllMarkets,
  isValidFixture,
  hasValid1X2Odds,
} from "./parser.js";
import type { FortunaFixture, FortunaMarket } from "./types.js";

/**
 * Fortuna Playwright Scraper Implementation
 */
export class FortunaPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "fortuna";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.fortuna,
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
      const navSuccess = await navigateToBaseSite(page);
      if (!navSuccess) {
        return this.createErrorResult(
          new Error("Failed to navigate to base site"),
          Date.now() - startTime
        );
      }

      // Fetch fixtures and markets from API
      const leagueData = await fetchLeagueData(page, league);
      if (!leagueData || !leagueData.fixtures || leagueData.fixtures.length === 0) {
        return this.createNotFoundResult(
          `No fixtures found for ${league}`,
          Date.now() - startTime
        );
      }

      console.log(`[Fortuna] Found ${leagueData.fixtures.length} fixtures for ${league}`);
      console.log(`[Fortuna] Total markets captured: ${leagueData.markets.length}`);

      // Transform API data to RawScrapedOdds
      const matches: RawScrapedOdds[] = [];

      for (const fixture of leagueData.fixtures) {
        if (!isValidFixture(fixture)) continue;

        const teams = parseTeamNames(fixture);

        // Find markets for this fixture
        const fixtureMarkets = leagueData.markets.filter(
          (m) => m.fixtureId === fixture.id
        );

        const odds1x2 = parse1X2Odds(fixtureMarkets);

        // Skip fixtures without valid 1X2 odds
        if (odds1x2.home <= 0 || odds1x2.draw <= 0 || odds1x2.away <= 0) {
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
          eventUrl: buildEventUrl(fixture.id, fixture.seoName),
        });
      }

      console.log(`[Fortuna] Found ${matches.length} matches with valid odds`);

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
        `Match not found on Fortuna: ${match.homeTeam} vs ${match.awayTeam}`,
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
      // Extract fixture ID from URL
      const fixtureId = extractFixtureIdFromUrl(eventUrl);
      if (!fixtureId) {
        return this.createMatchDetailNotFoundResult(
          "Could not extract fixture ID from URL",
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

      // Fetch fixture info and all markets
      console.log(`[Fortuna] Fetching details for fixture ${fixtureId}...`);

      const fixture = await fetchFixtureById(page, fixtureId);
      const markets = await fetchAllMarketsForFixture(page, fixtureId);

      console.log(`[Fortuna] Fetched ${markets.length} markets for fixture`);

      if (!fixture && markets.length === 0) {
        return this.createMatchDetailNotFoundResult(
          "Could not fetch fixture data",
          Date.now() - startTime
        );
      }

      // Parse team names
      let homeTeam = "";
      let awayTeam = "";

      if (fixture) {
        const teams = parseTeamNames(fixture as FortunaFixture);
        homeTeam = teams.homeTeam;
        awayTeam = teams.awayTeam;
      }

      if (!homeTeam) {
        return this.createMatchDetailNotFoundResult(
          "Could not parse team names",
          Date.now() - startTime
        );
      }

      // Parse all standard markets
      const odds1x2 = parse1X2Odds(markets);
      const doubleChance = parseDoubleChance(markets);
      const btts = parseBTTS(markets);
      const overUnder = parseOverUnder(markets);

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName: `${homeTeam} - ${awayTeam}`,
        homeTeam,
        awayTeam,
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
      const navSuccess = await navigateToBaseSite(page);
      if (!navSuccess) {
        return this.createFullOfferErrorResult(
          league,
          new Error("Failed to navigate to base site"),
          Date.now() - startTime
        );
      }

      // Fetch fixtures list
      const leagueData = await fetchLeagueData(page, league);
      if (!leagueData || !leagueData.fixtures || leagueData.fixtures.length === 0) {
        return {
          success: false,
          bookmaker: this.bookmaker,
          league,
          matches: [],
          error: "No fixtures found from API",
          duration: Date.now() - startTime,
        };
      }

      console.log(`[Fortuna/FullOffer] Found ${leagueData.fixtures.length} fixtures`);

      // Process each fixture and fetch full details
      const matches: FullMatchOffer[] = [];

      for (const fixture of leagueData.fixtures) {
        if (!isValidFixture(fixture)) continue;

        try {
          // Fetch all markets for this fixture
          const allMarkets = await fetchAllMarketsForFixture(page, fixture.id);

          if (allMarkets && allMarkets.length > 0) {
            const teams = parseTeamNames(fixture);

            // Parse all available markets
            const markets = parseAllMarkets(allMarkets, teams);

            if (markets.length > 0) {
              matches.push({
                matchId: fixture.id,
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(teams.homeTeam, league),
                awayTeam: getCanonicalTeamName(teams.awayTeam, league),
                eventUrl: buildEventUrl(fixture.id, fixture.seoName),
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[Fortuna/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
              );
            }
          }

          // Small delay between requests to avoid rate limiting
          await this.delay(API_REQUEST_DELAY);
        } catch (error) {
          console.warn(
            `[Fortuna/FullOffer] Failed to fetch details for fixture ${fixture.id}:`,
            error
          );
        }
      }

      const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
      console.log(
        `[Fortuna/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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
   * Not heavily used since Fortuna uses API for data fetching
   */
  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // Fortuna uses API for data fetching, not DOM scraping
    // This method is kept for interface compatibility
    return page.evaluate(() => {
      const entries: EventUrlEntry[] = [];
      const seen = new Set<string>();

      document.querySelectorAll("a[aria-label*=' - ']").forEach((link) => {
        const label = link.getAttribute("aria-label") || "";
        const teamMatch = label.match(/^(.+?)\s*-\s*(.+)$/);
        if (teamMatch?.[1] && teamMatch[2]) {
          const h = teamMatch[1].trim();
          const a = teamMatch[2].trim();
          const key = `${h} vs ${a}`;
          if (h && a && !seen.has(key)) {
            seen.add(key);
            entries.push({ matchKey: key, eventUrl: (link as HTMLAnchorElement).href });
          }
        }
      });

      return entries;
    });
  }
}

// Export singleton instance
export const fortunaScraper = new FortunaPlaywrightScraper();
