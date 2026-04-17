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

import { API_REQUEST_DELAY } from "./constants.js";
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
} from "./parser.js";
import type { FortunaFixture, FortunaMarket } from "./types.js";

const fixturesCache = new ScraperCache<FortunaFixture>({
  name: "fortuna-fixtures",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

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

  private updateCache(fixtures: FortunaFixture[]): void {
    fixturesCache.setMany(fixtures.map((f) => ({ key: f.id, value: f })));
  }

  private getCachedFixture(fixtureId: string): FortunaFixture | undefined {
    return fixturesCache.get(fixtureId);
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

        const leagueData = await fetchLeagueData(page, leagueSlug);
        if (!leagueData || !leagueData.fixtures || leagueData.fixtures.length === 0) {
          return this.createNotFoundResult(
            `No fixtures found for ${leagueSlug}`,
            Date.now() - startTime
          );
        }

        console.log(`[Fortuna] Found ${leagueData.fixtures.length} fixtures for ${leagueSlug}`);
        console.log(`[Fortuna] Total markets captured: ${leagueData.markets.length}`);

        this.updateCache(leagueData.fixtures);

        const matches: RawScrapedOdds[] = [];

        for (const fixture of leagueData.fixtures) {
          if (!isValidFixture(fixture)) continue;

          const teams = parseTeamNames(fixture);
          const fixtureMarkets = leagueData.markets.filter(
            (m) => m.fixtureId === fixture.id
          );
          const odds1x2 = parse1X2Odds(fixtureMarkets);

          if (odds1x2.home <= 0 || odds1x2.draw <= 0 || odds1x2.away <= 0) {
            continue;
          }

          matches.push({
            bookmaker: this.bookmaker,
            eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
            homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
            awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
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

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    const fixtureId = extractFixtureIdFromUrl(eventUrl);

    if (!fixtureId) {
      return this.createMatchDetailNotFoundResult(
        "Could not extract fixture ID from URL",
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

        if (fixture) {
          this.updateCache([fixture as FortunaFixture]);
        }

        return this.buildMatchDetailResult(fixture as FortunaFixture | null, markets, eventUrl, startTime);
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  private buildMatchDetailResult(
    fixture: FortunaFixture | null,
    markets: FortunaMarket[],
    eventUrl: string,
    startTime: number
  ): MatchDetailResult {
    let homeTeam = "";
    let awayTeam = "";

    if (fixture) {
      const teams = parseTeamNames(fixture);
      homeTeam = teams.homeTeam;
      awayTeam = teams.awayTeam;
    }

    if (!homeTeam) {
      return this.createMatchDetailNotFoundResult(
        "Could not parse team names",
        Date.now() - startTime
      );
    }

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

        const leagueData = await fetchLeagueData(page, leagueSlug);
        if (!leagueData || !leagueData.fixtures || leagueData.fixtures.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No fixtures found from API",
            duration: Date.now() - startTime,
          };
        }

        console.log(`[Fortuna/FullOffer] Found ${leagueData.fixtures.length} fixtures`);

        this.updateCache(leagueData.fixtures);

        const matches: FullMatchOffer[] = [];

        for (const fixture of leagueData.fixtures) {
          if (!isValidFixture(fixture)) continue;

          try {
            const allMarkets = await fetchAllMarketsForFixture(page, fixture.id);

            if (allMarkets && allMarkets.length > 0) {
              const teams = parseTeamNames(fixture);
              const markets = parseAllMarkets(allMarkets, teams);

              if (markets.length > 0) {
                matches.push({
                  matchId: fixture.id,
                  bookmaker: this.bookmaker,
                  homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
                  awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
                  eventUrl: buildEventUrl(fixture.id, fixture.seoName),
                  markets,
                  startTime: new Date(fixture.startDatetime).toISOString(),
                  scrapedAt: new Date(),
                });

                console.log(
                  `[Fortuna/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
                );
              }
            }

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

export const fortunaScraper = new FortunaPlaywrightScraper();
