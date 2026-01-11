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

import { CATEGORY_IDS } from "./constants.js";
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
} from "./parser.js";
import type { TotalbetEvent } from "./types.js";

const eventsCache = new ScraperCache<TotalbetEvent>({
  name: "totalbet-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class TotalbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "totalbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.totalbet,
      ...config,
      enabled: true,
    };
  }

  private updateCache(events: TotalbetEvent[]): void {
    eventsCache.setMany(events.map((e) => ({ key: String(e.eventId), value: e })));
  }

  private getCachedEvent(eventId: string): TotalbetEvent | undefined {
    return eventsCache.get(eventId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();
        console.log(`[Totalbet] Fetching data for category: ${CATEGORY_IDS[leagueSlug]}`);

        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createErrorResult(
            new Error("Failed to navigate to Totalbet"),
            Date.now() - startTime
          );
        }

        await this.delay(500);
        const apiData = await fetchLeagueEvents(page, leagueSlug);

        if (!apiData || !apiData.data || apiData.data.length === 0) {
          return this.createNotFoundResult(
            "Could not fetch Totalbet API data",
            Date.now() - startTime
          );
        }

        console.log(`[Totalbet] Captured ${apiData.data.length} events from API`);
        this.updateCache(apiData.data);

        const matches: RawScrapedOdds[] = [];
        for (const event of apiData.data) {
          if (!isValidEvent(event)) continue;

          const teams = parseTeamNames(event.eventName);
          const odds1x2 = parse1X2Odds(event);

          if (odds1x2.home <= 1 || odds1x2.draw <= 1 || odds1x2.away <= 1) continue;

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
            eventUrl: buildEventUrl(event.eventId),
          });
        }

        console.log(`[Totalbet] Found ${matches.length} matches with valid odds`);

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
        `Match not found on Totalbet: ${match.homeTeam} vs ${match.awayTeam}`,
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
    const eventId = extractEventIdFromUrl(eventUrl);

    if (!eventId) {
      return this.createMatchDetailNotFoundResult("Invalid Totalbet event URL", Date.now() - startTime);
    }

    const cachedEvent = this.getCachedEvent(eventId);
    if (cachedEvent) {
      return this.buildMatchDetailResult(cachedEvent, eventUrl, startTime);
    }

    return this.executeWithBrowser(
      async (page) => {
        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createMatchDetailErrorResult(
            new Error("Failed to navigate to Totalbet"),
            Date.now() - startTime
          );
        }

        await this.delay(500);
        const allEvents = await fetchAllLeagueEvents(page);
        this.updateCache(allEvents);

        const event = allEvents.find((e) => String(e.eventId) === eventId);
        if (!event) {
          return this.createMatchDetailNotFoundResult("Event not found in Totalbet API", Date.now() - startTime);
        }

        return this.buildMatchDetailResult(event, eventUrl, startTime);
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  private buildMatchDetailResult(event: TotalbetEvent, eventUrl: string, startTime: number): MatchDetailResult {
    const teams = parseTeamNames(event.eventName);
    const odds1x2 = parse1X2Odds(event);
    const doubleChance = parseDoubleChance(event);
    const btts = parseBTTS(event);
    const overUnder = parseOverUnder(event);

    console.log(`[Totalbet] Parsed match details for: ${teams.homeTeam} vs ${teams.awayTeam}`);
    console.log(
      `[Totalbet] Markets: 1X2=${odds1x2.home > 0}, DC=${doubleChance !== null}, BTTS=${btts !== null}, O/U lines=${overUnder ? Object.keys(overUnder).length : 0}`
    );

    const matchOdds: RawScrapedMatchOdds = {
      bookmaker: this.bookmaker,
      eventName: event.eventName,
      homeTeam: teams.homeTeam,
      awayTeam: teams.awayTeam,
      eventUrl,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
      market1X2: { home: odds1x2.home, draw: odds1x2.draw, away: odds1x2.away },
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
            new Error("Failed to navigate to Totalbet"),
            Date.now() - startTime
          );
        }

        await this.delay(500);
        const apiData = await fetchLeagueEvents(page, leagueSlug);

        if (!apiData || !apiData.data || apiData.data.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No events found from API",
            duration: Date.now() - startTime,
          };
        }

        console.log(`[Totalbet/FullOffer] Found ${apiData.data.length} events`);

        const matches: FullMatchOffer[] = [];

        for (const event of apiData.data) {
          if (!isValidEvent(event)) continue;

          try {
            const detailData = await fetchEventDetails(page, String(event.eventId));

            let fullEvent = event;
            if (detailData && !detailData.error) {
              if (detailData.data && detailData.data.eventGames) {
                fullEvent = detailData.data;
              } else if (detailData.eventGames) {
                fullEvent = {
                  eventId: detailData.eventId || event.eventId,
                  eventName: detailData.eventName || event.eventName,
                  categoryId: event.categoryId,
                  eventGames: detailData.eventGames,
                };
              }
            }

            const teams = parseTeamNames(fullEvent.eventName);
            const markets = parseAllMarkets(fullEvent, teams);

            if (markets.length > 0) {
              matches.push({
                matchId: String(fullEvent.eventId),
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
                awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
                eventUrl: buildEventUrl(fullEvent.eventId),
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[Totalbet/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
              );
            }

            await this.delay(100);
          } catch (error) {
            console.warn(
              `[Totalbet/FullOffer] Failed to fetch details for event ${event.eventId}:`,
              error
            );
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[Totalbet/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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

export const totalbetScraper = new TotalbetPlaywrightScraper();
