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

import { LEAGUE_URLS, TOURNAMENT_IDS } from "./constants.js";
import {
  navigateToLeaguePage,
  navigateToBaseSite,
  fetchLeagueEvents,
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
  isUpcomingOfferedEvent,
} from "./parser.js";
import type { SuperbetEvent } from "./types.js";

const eventsCache = new ScraperCache<SuperbetEvent>({
  name: "superbet-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class SuperbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "superbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.superbet,
      ...config,
      enabled: true,
    };
  }

  private updateCache(events: SuperbetEvent[]): void {
    eventsCache.setMany(events.map((e) => ({ key: String(e.eventId), value: e })));
  }

  private getCachedEvent(eventId: string): SuperbetEvent | undefined {
    return eventsCache.get(eventId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const navSuccess = await navigateToLeaguePage(page, leagueSlug);
        if (!navSuccess) {
          return this.createErrorResult(
            new Error("Failed to navigate to league page"),
            Date.now() - startTime
          );
        }

        const apiData = await fetchLeagueEvents(page, leagueSlug);
        if (!apiData || !apiData.data || apiData.data.length === 0) {
          return this.createNotFoundResult(
            "Could not capture Superbet API data",
            Date.now() - startTime
          );
        }

        console.log(`[Superbet] Captured ${apiData.data.length} events from API`);

        this.updateCache(apiData.data);

        const matches: RawScrapedOdds[] = apiData.data
          .filter(isValidEvent)
          .map((event) => {
            const teams = parseTeamNames(event.matchName);
            const odds1x2 = parse1X2Odds(event);

            return {
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
            };
          })
          .filter((m) => m.homeOdds > 0);

        console.log(`[Superbet] Found ${matches.length} matches with valid odds`);

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
        `Match not found on Superbet: ${match.homeTeam} vs ${match.awayTeam}`,
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
      return this.createMatchDetailNotFoundResult("Invalid Superbet event URL", Date.now() - startTime);
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
            new Error("Failed to navigate to base site"),
            Date.now() - startTime
          );
        }

        const detailData = await fetchEventDetails(page, eventId);
        if (!detailData || !detailData.data || detailData.data.length === 0) {
          return this.createMatchDetailNotFoundResult(
            "Could not capture Superbet detail API data",
            Date.now() - startTime
          );
        }

        const event = detailData.data[0];
        this.updateCache([event]);

        return this.buildMatchDetailResult(event, eventUrl, startTime);
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  private buildMatchDetailResult(event: SuperbetEvent, eventUrl: string, startTime: number): MatchDetailResult {
    const teams = parseTeamNames(event.matchName);
    const odds = event.odds || [];

    const odds1x2 = parse1X2Odds(event);
    const doubleChance = parseDoubleChance(odds);
    const btts = parseBTTS(odds);
    const overUnder = parseOverUnder(odds);

    const matchOdds: RawScrapedMatchOdds = {
      bookmaker: this.bookmaker,
      eventName: event.matchName || "",
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

        const navSuccess = await navigateToLeaguePage(page, leagueSlug);
        if (!navSuccess) {
          return this.createFullOfferErrorResult(
            leagueSlug,
            new Error("Failed to navigate to league page"),
            Date.now() - startTime
          );
        }

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

        console.log(`[Superbet/FullOffer] Found ${apiData.data.length} events`);

        // The by-date listing mixes already-played matches (status FINISHED,
        // marketCount 0-1) in with upcoming ones. Keep only genuine upcoming
        // events that still carry an offer, then process the soonest first so
        // matches[0] reflects the true full offer rather than a settled match.
        const now = Date.now();
        const upcomingEvents = apiData.data
          .filter((event) => isUpcomingOfferedEvent(event, now))
          .sort((a, b) => (a.unixDateMillis ?? 0) - (b.unixDateMillis ?? 0));

        console.log(
          `[Superbet/FullOffer] ${upcomingEvents.length} upcoming events with an active offer`
        );

        const matches: FullMatchOffer[] = [];

        for (const event of upcomingEvents) {

          try {
            const detailData = await fetchEventDetails(page, String(event.eventId));

            if (detailData && detailData.data && detailData.data.length > 0) {
              const fullEvent = detailData.data[0];
              this.updateCache([fullEvent]);

              const teams = parseTeamNames(fullEvent.matchName);
              const markets = parseAllMarkets(fullEvent, teams);

              if (markets.length > 0) {
                matches.push({
                  matchId: String(fullEvent.eventId),
                  bookmaker: this.bookmaker,
                  homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
                  awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
                  eventUrl: buildEventUrl(fullEvent.eventId),
                  markets,
                  startTime: fullEvent.startTime,
                  scrapedAt: new Date(),
                });

                console.log(
                  `[Superbet/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
                );
              }
            }

            await this.delay(100);
          } catch (error) {
            console.warn(
              `[Superbet/FullOffer] Failed to fetch details for event ${event.eventId}:`,
              error
            );
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[Superbet/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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

export const superbetScraper = new SuperbetPlaywrightScraper();
