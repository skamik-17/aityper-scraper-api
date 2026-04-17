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
} from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { ScraperCache, CACHE_TTLS } from "../../../services/cache-manager.js";

import { LEAGUE_URLS, WS_CAPTURE_TIMEOUT } from "./constants.js";
import {
  navigateToLeaguePage,
  navigateToEventPage,
  captureWebSocketData,
  buildEventUrl,
  delay,
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
import type { PZBukEvent, PZBukMarket, PZBukSelection } from "./types.js";

interface PZBukCachedEvent {
  event: PZBukEvent;
  markets: PZBukMarket[];
  selections: PZBukSelection[];
}

const eventsCache = new ScraperCache<PZBukCachedEvent>({
  name: "pzbuk-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class PzbukPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "pzbuk";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.pzbuk,
      ...config,
      enabled: true,
    };
  }

  private updateCache(
    events: PZBukEvent[],
    markets: PZBukMarket[],
    selections: PZBukSelection[]
  ): void {
    const entries = events.map((event) => ({
      key: event.id,
      value: {
        event,
        markets: markets.filter((m) => m.eventId === event.id),
        selections: selections.filter((s) => s.eventId === event.id),
      },
    }));
    eventsCache.setMany(entries);
  }

  private getCachedEvent(eventId: string): PZBukCachedEvent | undefined {
    return eventsCache.get(eventId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const wsDataPromise = captureWebSocketData(page, false);
        const navSuccess = await navigateToLeaguePage(page, leagueSlug);

        if (!navSuccess) {
          return this.createErrorResult(
            new Error("Failed to navigate to league page"),
            Date.now() - startTime
          );
        }

        const wsData = await Promise.race([
          wsDataPromise,
          delay(WS_CAPTURE_TIMEOUT).then(() => null),
        ]);

        if (!wsData || !wsData.events || wsData.events.length === 0) {
          console.log("[PZBuk] No WebSocket data captured");
          return this.createNotFoundResult(
            "No WebSocket data captured",
            Date.now() - startTime
          );
        }

        console.log(
          `[PZBuk] Captured ${wsData.events.length} events, ${wsData.selections?.length || 0} selections`
        );

        this.updateCache(
          wsData.events,
          wsData.markets || [],
          wsData.selections || []
        );

        const matches: RawScrapedOdds[] = [];

        for (const event of wsData.events) {
          if (!isValidEvent(event)) continue;

          const teams = parseTeamNames(event);
          if (!teams.homeTeam || !teams.awayTeam) continue;

          const eventSelections = (wsData.selections || []).filter(
            (s) => s.eventId === event.id
          );

          const odds1x2 = parse1X2Odds(eventSelections);

          if (odds1x2.home <= 1 || odds1x2.draw <= 1 || odds1x2.away <= 1) {
            continue;
          }

          const eventUrl = buildEventUrl(
            event.id,
            teams.homeTeam,
            teams.awayTeam,
            event.leagueId,
            event.leagueName
          );

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
            eventUrl,
          });
        }

        console.log(`[PZBuk] Scraped ${matches.length} matches for ${leagueSlug}`);

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
        `Match not found on PZBuk: ${match.homeTeam} vs ${match.awayTeam}`,
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

    const eventIdMatch = eventUrl.match(/\/event\/(\d+)/);
    const eventId = eventIdMatch?.[1];

    if (eventId) {
      const cached = this.getCachedEvent(eventId);
      if (cached) {
        return this.buildMatchDetailResult(cached, eventUrl, startTime);
      }
    }

    return this.executeWithBrowser(
      async (page) => {
        const wsDataPromise = captureWebSocketData(page, true);
        const navSuccess = await navigateToEventPage(page, eventUrl);

        if (!navSuccess) {
          return this.createMatchDetailNotFoundResult(
            "Failed to navigate to event page",
            Date.now() - startTime
          );
        }

        const wsData = await Promise.race([
          wsDataPromise,
          delay(WS_CAPTURE_TIMEOUT).then(() => null),
        ]);

        if (
          !wsData ||
          !wsData.events?.length ||
          !wsData.markets?.length ||
          !wsData.selections?.length
        ) {
          return this.createMatchDetailNotFoundResult(
            "No WebSocket data for match details",
            Date.now() - startTime
          );
        }

        const event = wsData.events[0];
        this.updateCache([event], wsData.markets, wsData.selections);

        const cached: PZBukCachedEvent = {
          event,
          markets: wsData.markets.filter((m) => m.eventId === event.id),
          selections: wsData.selections.filter((s) => s.eventId === event.id),
        };

        return this.buildMatchDetailResult(cached, eventUrl, startTime);
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  private buildMatchDetailResult(
    cached: PZBukCachedEvent,
    eventUrl: string,
    startTime: number
  ): MatchDetailResult {
    const teams = parseTeamNames(cached.event);

    if (!teams.homeTeam) {
      return this.createMatchDetailNotFoundResult(
        "Could not parse team names",
        Date.now() - startTime
      );
    }

    const eventSelections = cached.selections.filter((s) => s.status === "Active");

    const odds1x2 = parse1X2Odds(eventSelections);
    const doubleChance = parseDoubleChance(eventSelections);
    const btts = parseBTTS(eventSelections);
    const overUnder = parseOverUnder(eventSelections);

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
  }

  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    return this.executeFullOfferScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const wsDataPromise = captureWebSocketData(page, false);
        const navSuccess = await navigateToLeaguePage(page, leagueSlug);

        if (!navSuccess) {
          return this.createFullOfferErrorResult(
            leagueSlug,
            new Error("Failed to navigate to league page"),
            Date.now() - startTime
          );
        }

        const wsData = await Promise.race([
          wsDataPromise,
          delay(WS_CAPTURE_TIMEOUT).then(() => null),
        ]);

        if (!wsData || !wsData.events || wsData.events.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No WebSocket data captured",
            duration: Date.now() - startTime,
          };
        }

        console.log(
          `[PZBuk/FullOffer] Found ${wsData.events.length} events in listing`
        );

        const matches: FullMatchOffer[] = [];

        for (const event of wsData.events) {
          if (!isValidEvent(event)) continue;

          const teams = parseTeamNames(event);
          if (!teams.homeTeam || !teams.awayTeam) continue;

          try {
            const eventUrl = buildEventUrl(
              event.id,
              teams.homeTeam,
              teams.awayTeam,
              event.leagueId,
              event.leagueName
            );

            const eventWsPromise = captureWebSocketData(page, true);
            const eventNavSuccess = await navigateToEventPage(page, eventUrl);

            if (!eventNavSuccess) {
              console.warn(
                `[PZBuk/FullOffer] Failed to navigate to ${teams.homeTeam} vs ${teams.awayTeam}`
              );
              continue;
            }

            const eventWsData = await Promise.race([
              eventWsPromise,
              delay(WS_CAPTURE_TIMEOUT).then(() => null),
            ]);

            if (eventWsData && eventWsData.selections?.length > 0) {
              this.updateCache(
                [event],
                eventWsData.markets || [],
                eventWsData.selections
              );

              const markets = parseAllMarkets(eventWsData, event.id, teams);

              if (markets.length > 0) {
                matches.push({
                  matchId: event.id,
                  bookmaker: this.bookmaker,
                  homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
                  awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
                  eventUrl,
                  markets,
                  startTime: event.startingOn,
                  scrapedAt: new Date(),
                });

                console.log(
                  `[PZBuk/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
                );
              }
            }

            await delay(200);
          } catch (error) {
            console.warn(
              `[PZBuk/FullOffer] Failed to fetch details for ${teams.homeTeam} vs ${teams.awayTeam}:`,
              error
            );
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[PZBuk/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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

export const pzbukScraper = new PzbukPlaywrightScraper();
