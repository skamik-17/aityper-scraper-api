import type { Page } from "playwright";
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
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
  ScrapedMarket,
} from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { ScraperCache, CACHE_TTLS } from "../../../services/cache-manager.js";

import {
  fetchLeagueMatches,
  fetchMatchDetails,
  fetchAllMarketGroups,
  fetchMarketsHybrid,
  extractMatchIdFromUrl,
  buildEventUrl,
} from "./navigation.js";
import {
  parseListingResponse,
  parseAllMarketsFromProto,
  parseAllMarketsFromMultipleResponses,
  parseTeamNames,
  isValidMatch,
  extract1X2FromMarkets,
  extractDoubleChanceFromMarkets,
  extractBTTSFromMarkets,
  extractOverUnderFromMarkets,
} from "./parser.js";
import type { BetclicListingMatch } from "./types.js";

const eventsCache = new ScraperCache<BetclicListingMatch>({
  name: "betclic-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

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

  private updateCache(matches: BetclicListingMatch[]): void {
    eventsCache.setMany(
      matches
        .filter((m) => m.matchId !== null)
        .map((m) => ({ key: m.matchId!, value: m }))
    );
  }

  private getCachedEvent(matchId: string): BetclicListingMatch | undefined {
    return eventsCache.get(matchId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();

    if (!isLeagueSupported(league, this.bookmaker)) {
      return this.createNotFoundResult(
        `Unknown league: ${league}`,
        Date.now() - startTime
      );
    }

    try {
      const responseData = await fetchLeagueMatches(league);
      if (!responseData) {
        return this.createNotFoundResult(
          `No ${league} matches found on Betclic`,
          Date.now() - startTime
        );
      }

      const parsedMatches = parseListingResponse(responseData, league);

      if (parsedMatches.length === 0) {
        return this.createNotFoundResult(
          `Could not parse any ${league} match data from Betclic`,
          Date.now() - startTime
        );
      }

      this.updateCache(parsedMatches);

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

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "premier-league";

    const allMatches = await this.scrapeLeague(league);
    if (allMatches.status !== "success" || !allMatches.data) {
      return allMatches;
    }

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
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();

    try {
      const matchId = extractMatchIdFromUrl(eventUrl);
      if (!matchId) {
        return this.createMatchDetailNotFoundResult(
          "Could not extract match ID from URL",
          Date.now() - startTime
        );
      }

      const responseData = await fetchMatchDetails(matchId);
      if (!responseData) {
        return this.createMatchDetailNotFoundResult(
          "No match data received",
          Date.now() - startTime
        );
      }

      const markets = parseAllMarketsFromProto(responseData);
      if (markets.length === 0) {
        return this.createMatchDetailNotFoundResult(
          "Could not parse match data",
          Date.now() - startTime
        );
      }

      const cachedEvent = this.getCachedEvent(matchId);
      const homeTeam = cachedEvent?.homeTeam || "";
      const awayTeam = cachedEvent?.awayTeam || "";
      const eventName = cachedEvent?.matchName || `${homeTeam} - ${awayTeam}`;

      const market1X2 = extract1X2FromMarkets(markets, homeTeam, awayTeam);
      const marketDoubleChance = extractDoubleChanceFromMarkets(markets);
      const marketBTTS = extractBTTSFromMarkets(markets);
      const marketOverUnder = extractOverUnderFromMarkets(markets);

      const matchOdds: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName,
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

  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startTime = Date.now();

    if (!isLeagueSupported(league, this.bookmaker)) {
      return this.createFullOfferErrorResult(
        league,
        new Error(`Unknown league: ${league}`),
        Date.now() - startTime
      );
    }

    try {
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

      const listingMatches = parseListingResponse(listingData, league);
      console.log(`[Betclic/FullOffer] Found ${listingMatches.length} events in listing`);

      this.updateCache(listingMatches);

      const matches: FullMatchOffer[] = [];

      for (const listingMatch of listingMatches) {
        if (!listingMatch.matchId) continue;

        try {
          // Build full match URL for Playwright fallback
          const matchUrl = buildEventUrl(
            listingMatch.matchId,
            league,
            listingMatch.homeTeam,
            listingMatch.awayTeam
          );

          console.log(
            `[Betclic/FullOffer] Fetching markets for ${listingMatch.homeTeam} vs ${listingMatch.awayTeam} (ID: ${listingMatch.matchId})`
          );

          const responses = await fetchMarketsHybrid(
            listingMatch.matchId,
            matchUrl
          );

          console.log(
            `[Betclic/FullOffer] ${listingMatch.homeTeam} vs ${listingMatch.awayTeam}: received ${responses.length} response(s) from hybrid fetch`
          );

          // Parse and merge all responses
          const markets = parseAllMarketsFromMultipleResponses(responses);

          if (markets.length > 0) {
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
              `[Betclic/FullOffer] ${homeTeam} vs ${awayTeam}: ${markets.length} markets total`
            );
          }

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

  async extractEventUrls(_page: Page): Promise<EventUrlEntry[]> {
    return [];
  }
}

export const betclicScraper = new BetclicPlaywrightScraper();
