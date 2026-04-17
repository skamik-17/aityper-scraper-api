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
  captureLeagueEvents,
  getLeagueId,
  extractEventIdFromUrl,
  buildEventUrl,
  getAllLeagueIds,
} from "./navigation.js";
import {
  parseTeamNames,
  parse1X2Odds,
  parseEventMarkets,
  parseAllMarkets,
  isValidEvent,
} from "./parser.js";
import type { LebullEvent } from "./types.js";

const eventsCache = new ScraperCache<LebullEvent>({
  name: "lebull-events",
  ttl: CACHE_TTLS.EVENTS,
  maxSize: 500,
});

export class LebullPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lebull";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.lebull,
      ...config,
      enabled: true,
    };
  }

  private updateCache(events: LebullEvent[]): void {
    eventsCache.setMany(events.map((e) => ({ key: String(e.eventId), value: e })));
  }

  private getCachedEvent(eventId: string): LebullEvent | undefined {
    return eventsCache.get(eventId);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupportedCentral(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();
        const leagueId = getLeagueId(leagueSlug);

        if (!leagueId) {
          return this.createNotFoundResult(`Unknown league: ${leagueSlug}`, Date.now() - startTime);
        }

        console.log(`[LeBull] Capturing data for league: ${leagueSlug} (ID: ${leagueId})`);

        const events = await captureLeagueEvents(page, this.navigateWithRetry.bind(this), leagueId);

        if (events.length === 0) {
          return this.createNotFoundResult("Could not capture LeBull API data", Date.now() - startTime);
        }

        console.log(`[LeBull] Captured ${events.length} events from API`);
        this.updateCache(events);

        const matches: RawScrapedOdds[] = [];
        for (const event of events) {
          if (!isValidEvent(event)) continue;

          const teams = parseTeamNames(event);
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
            eventUrl: buildEventUrl(leagueId, event.eventId),
          });
        }

        console.log(`[LeBull] Found ${matches.length} matches with valid odds`);

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
        `Match not found on LeBull: ${match.homeTeam} vs ${match.awayTeam}`,
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
      return this.createMatchDetailNotFoundResult("Invalid LeBull event URL", Date.now() - startTime);
    }

    const cachedEvent = this.getCachedEvent(eventId);
    if (cachedEvent) {
      return this.buildMatchDetailResult(cachedEvent, eventUrl, startTime);
    }

    return this.executeWithBrowser(
      async (page) => {
        for (const { id: leagueId } of getAllLeagueIds()) {
          const events = await captureLeagueEvents(page, this.navigateWithRetry.bind(this), leagueId);
          const event = events.find((e) => String(e.eventId) === eventId);
          
          if (event) {
            this.updateCache(events);
            return this.buildMatchDetailResult(event, eventUrl, startTime);
          }
        }

        return this.createMatchDetailNotFoundResult("Event not found in LeBull API", Date.now() - startTime);
      },
      (error, duration) => this.createMatchDetailErrorResult(error, duration)
    );
  }

  private buildMatchDetailResult(event: LebullEvent, eventUrl: string, startTime: number): MatchDetailResult {
    const teams = parseTeamNames(event);
    const { m1X2, mDC, mBTTS, mOU } = parseEventMarkets(event);

    console.log(`[LeBull] Parsed match details for: ${teams.homeTeam} vs ${teams.awayTeam}`);
    console.log(
      `[LeBull] Markets: 1X2=${m1X2.home > 0}, DC=${mDC.homeOrDraw > 0}, BTTS=${mBTTS.yes > 0}, O/U lines=${Object.keys(mOU).length}`
    );

    const matchOdds: RawScrapedMatchOdds = {
      bookmaker: this.bookmaker,
      eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
      homeTeam: teams.homeTeam,
      awayTeam: teams.awayTeam,
      eventUrl,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
      market1X2: { home: m1X2.home, draw: m1X2.draw, away: m1X2.away },
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
        const leagueId = getLeagueId(leagueSlug);

        if (!leagueId) {
          return this.createFullOfferErrorResult(
            leagueSlug,
            new Error(`Unknown league: ${leagueSlug}`),
            Date.now() - startTime
          );
        }

        console.log(`[LeBull/FullOffer] Capturing data for league: ${leagueSlug}`);

        const events = await captureLeagueEvents(
          page,
          this.navigateWithRetry.bind(this),
          leagueId,
          true
        );

        if (events.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No events found from API",
            duration: Date.now() - startTime,
          };
        }

        console.log(`[LeBull/FullOffer] Found ${events.length} events with extended markets`);
        this.updateCache(events);

        const matches: FullMatchOffer[] = [];

        for (const event of events) {
          if (!isValidEvent(event)) continue;

          const teams = parseTeamNames(event);
          const markets = parseAllMarkets(event, teams);

          if (markets.length > 0) {
            matches.push({
              matchId: String(event.eventId),
              bookmaker: this.bookmaker,
              homeTeam: getCanonicalTeamName(teams.homeTeam, leagueSlug),
              awayTeam: getCanonicalTeamName(teams.awayTeam, leagueSlug),
              eventUrl: buildEventUrl(leagueId, event.eventId),
              markets,
              startTime: event.startDate,
              scrapedAt: new Date(),
            });

            console.log(`[LeBull/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`);
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(`[LeBull/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`);

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

export const lebullScraper = new LebullPlaywrightScraper();
