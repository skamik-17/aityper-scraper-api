import type { Page } from "playwright";
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported as isLeagueSupportedCentral } from "../../../config/leagues.js";
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
  parseAllMarkets,
  parseEventMarkets,
  isValidEvent,
} from "./parser.js";
import type { FuksiarzEvent } from "./types.js";

const eventsCache = new ScraperCache<FuksiarzEvent>({
  name: "fuksiarz-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class FuksiarzPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "fuksiarz";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.fuksiarz,
      ...config,
      enabled: true,
    };
  }

  private updateCache(events: FuksiarzEvent[]): void {
    eventsCache.setMany(events.map((e) => ({ key: String(e.eventId), value: e })));
  }

  private getCachedEvent(eventId: string): FuksiarzEvent | undefined {
    return eventsCache.get(eventId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupportedCentral(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createErrorResult(
            new Error("Failed to navigate to base site"),
            Date.now() - startTime
          );
        }

        const events = await fetchLeagueEvents(page, leagueSlug);
        if (!events || events.length === 0) {
          return this.createNotFoundResult("Could not fetch Fuksiarz API data", Date.now() - startTime);
        }

        console.log(`[Fuksiarz] Captured ${events.length} events from API`);
        this.updateCache(events);

        const matches: RawScrapedOdds[] = events
          .filter(isValidEvent)
          .map((event) => {
            const teams = parseTeamNames(event.eventName);
            const { m1X2 } = parseEventMarkets(event);

            return {
              bookmaker: this.bookmaker,
              eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
              homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
              awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
              homeOdds: m1X2.home,
              drawOdds: m1X2.draw,
              awayOdds: m1X2.away,
              hasNoTaxPromo: false,
              scrapedAt: new Date(),
              eventUrl: buildEventUrl(event.eventId),
            };
          })
          .filter((m) => m.homeOdds > 1 && m.drawOdds > 1 && m.awayOdds > 1);

        console.log(`[Fuksiarz] Found ${matches.length} matches with valid odds`);

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
        `Match not found on Fuksiarz: ${match.homeTeam} vs ${match.awayTeam}`,
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
      return this.createMatchDetailNotFoundResult("Invalid Fuksiarz event URL", Date.now() - startTime);
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

        const allEvents = await fetchAllLeagueEvents(page);
        this.updateCache(Array.from(allEvents.values()));

        const event = allEvents.get(eventId);
        if (!event) {
          return this.createMatchDetailNotFoundResult("Event not found in Fuksiarz API", Date.now() - startTime);
        }

        return this.buildMatchDetailResult(event, eventUrl, startTime);
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  private buildMatchDetailResult(event: FuksiarzEvent, eventUrl: string, startTime: number): MatchDetailResult {
    const { m1X2, mDC, mBTTS, mOU } = parseEventMarkets(event);
    const teams = parseTeamNames(event.eventName);

    console.log(`[Fuksiarz] Parsed match details for: ${teams.homeTeam} vs ${teams.awayTeam}`);
    console.log(
      `[Fuksiarz] Markets: 1X2=${m1X2.home > 0}, DC=${mDC.homeOrDraw > 0}, BTTS=${mBTTS.yes > 0}, O/U lines=${Object.keys(mOU).length}`
    );

    const matchOdds: RawScrapedMatchOdds = {
      bookmaker: this.bookmaker,
      eventName: event.eventName || "",
      homeTeam: teams.homeTeam,
      awayTeam: teams.awayTeam,
      eventUrl,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
      market1X2: m1X2,
      marketDoubleChance: mDC.homeOrDraw > 0 ? mDC : undefined,
      marketBTTS: mBTTS.yes > 0 ? mBTTS : undefined,
      marketOverUnder: Object.keys(mOU).length > 0 ? mOU : undefined,
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
      (l) => isLeagueSupportedCentral(l, this.bookmaker),
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

        const events = await fetchLeagueEvents(page, leagueSlug);
        if (!events || events.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No events found from API",
            duration: Date.now() - startTime,
          };
        }

        console.log(`[Fuksiarz/FullOffer] Found ${events.length} events`);
        this.updateCache(events);

        const matches: FullMatchOffer[] = [];

        for (const event of events) {
          if (!isValidEvent(event)) continue;

          try {
            const eventId = String(event.eventId);
            const teams = parseTeamNames(event.eventName);

            const detailResponse = await fetchEventDetails(page, eventId);
            const fullEvent = detailResponse?.data || event;

            if (detailResponse?.data) {
              eventsCache.set(eventId, detailResponse.data);
            }

            const markets = parseAllMarkets(fullEvent, teams);

            if (markets.length > 0) {
              matches.push({
                matchId: eventId,
                bookmaker: this.bookmaker,
                homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
                awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
                eventUrl: buildEventUrl(event.eventId),
                markets,
                scrapedAt: new Date(),
              });

              console.log(
                `[Fuksiarz/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`
              );
            }

            await this.delay(100);
          } catch (error) {
            console.warn(`[Fuksiarz/FullOffer] Failed to parse event ${event.eventId}:`, error);
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(`[Fuksiarz/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`);

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

export const fuksiarzScraper = new FuksiarzPlaywrightScraper();
