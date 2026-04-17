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
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { ScraperCache, CACHE_TTLS } from "../../../services/cache-manager.js";

import { REQUEST_DELAY } from "./constants.js";
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
import type { LVBetMatch } from "./types.js";

const matchesCache = new ScraperCache<LVBetMatch>({
  name: "lvbet-matches",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

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

  private updateCache(matches: LVBetMatch[]): void {
    matchesCache.setMany(matches.map((m) => ({ key: m.match_id, value: m })));
  }

  private getCachedMatch(matchId: string): LVBetMatch | undefined {
    return matchesCache.get(matchId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createErrorResult(
            new Error("Failed to navigate to base site"),
            Date.now() - startTime
          );
        }

        const matchesData = await fetchLeagueMatches(page, leagueSlug);
        if (!matchesData?.matches || matchesData.matches.length === 0) {
          return this.createNotFoundResult(
            "Could not fetch LVBet matches",
            Date.now() - startTime
          );
        }

        console.log(`[LVBet] Found ${matchesData.matches.length} matches from API`);
        this.updateCache(matchesData.matches);

        const matchIds = matchesData.matches.map((m) => m.match_id);
        const marketsData = await fetchMarketsForMatches(page, matchIds);
        if (!marketsData) {
          return this.createNotFoundResult(
            "Could not fetch LVBet markets",
            Date.now() - startTime
          );
        }

        const oddsMap = buildOddsMap(marketsData);
        console.log(`[LVBet] Found odds for ${oddsMap.size}/${matchesData.matches.length} matches`);

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
            homeTeam: getCanonicalTeamName(homeTeam, leagueSlug),
            awayTeam: getCanonicalTeamName(awayTeam, leagueSlug),
            homeOdds: odds.home,
            drawOdds: odds.draw,
            awayOdds: odds.away,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            eventUrl: buildEventUrl(m, leagueSlug),
          });
        }

        if (matches.length === 0) {
          return this.createNotFoundResult(
            "No matches with odds found on LVBet",
            Date.now() - startTime
          );
        }

        console.log(`[LVBet] Successfully scraped ${matches.length} matches for ${leagueSlug}`);

        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: matches,
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }
    );
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";

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

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    const matchId = extractMatchIdFromUrl(eventUrl);

    if (!matchId) {
      return this.createMatchDetailNotFoundResult(
        "Invalid LVBet event URL - cannot extract match_id",
        Date.now() - startTime
      );
    }

    return this.executeWithBrowser(
      async (page) => {
        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createMatchDetailErrorResult(
            new Error("Failed to navigate to base site"),
            Date.now() - startTime
          );
        }

        const marketsData = await fetchMarketsForMatch(page, matchId);
        if (!marketsData || marketsData.length === 0) {
          return this.createMatchDetailNotFoundResult(
            "Could not fetch LVBet markets for match",
            Date.now() - startTime
          );
        }

        const parsedMarkets = parseExtendedMarkets(marketsData);

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
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    return this.executeFullOfferScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createFullOfferErrorResult(
            leagueSlug,
            new Error("Failed to navigate to base site"),
            Date.now() - startTime
          );
        }

        const matchesData = await fetchLeagueMatches(page, leagueSlug);
        if (!matchesData?.matches || matchesData.matches.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No matches found from API",
            duration: Date.now() - startTime,
          };
        }

        console.log(`[LVBet/FullOffer] Found ${matchesData.matches.length} matches`);
        this.updateCache(matchesData.matches);

        const matches: FullMatchOffer[] = [];

        for (const match of matchesData.matches) {
          if (!isValidMatch(match)) continue;

          try {
            const marketsData = await fetchMarketsForMatch(page, match.match_id);

            if (marketsData && marketsData.length > 0) {
              const homeTeam = match.home![0];
              const awayTeam = match.away![0];

              const markets = parseAllMarkets(marketsData, {
                homeTeam,
                awayTeam,
              });

              if (markets.length > 0) {
                matches.push({
                  matchId: match.match_id,
                  bookmaker: this.bookmaker,
                  homeTeam: getCanonicalTeamName(homeTeam, leagueSlug),
                  awayTeam: getCanonicalTeamName(awayTeam, leagueSlug),
                  eventUrl: buildEventUrl(match, leagueSlug),
                  markets,
                  startTime: match.start_time,
                  scrapedAt: new Date(),
                });

                console.log(
                  `[LVBet/FullOffer] ${homeTeam} vs ${awayTeam}: ${markets.length} markets`
                );
              }
            }

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
          league: leagueSlug,
          matches,
          duration: Date.now() - startTime,
        };
      }
    );
  }

  async extractEventUrls(_page: Page): Promise<EventUrlEntry[]> {
    return [];
  }
}

export const lvbetScraper = new LVBetPlaywrightScraper();
