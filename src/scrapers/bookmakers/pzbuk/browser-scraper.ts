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
import { buildPzbukMatchOffer } from "./full-offer-mapper.js";

import {
  navigateToLeaguePage,
  navigateToEventPage,
  captureWebSocketData,
  buildEventUrl,
  delay,
} from "./navigation.js";
import {
  addFrameCounters,
  describeCaptureFailure,
  emptyFrameCounters,
  isEmptyListing,
  type CaptureDiagnostics,
  type PzbukFrameCounters,
} from "./ws-protocol.js";
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

/**
 * The Playwright PZBuk scraper: the fallback behind SCRAPER_TRANSPORT_PZBUK=browser
 * (the default is PzbukWsScraper), and the only class with the legacy 1X2 methods.
 */
export class PzbukBrowserScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "pzbuk";
  config: ScraperConfig;
  /**
   * Frame counters summed (max for `maxFrameBytes`) over the listing capture
   * and every event capture, whatever their outcome. Cumulative since
   * construction, never reset per call: consumers diff two readings.
   */
  private readonly counters: PzbukFrameCounters = emptyFrameCounters();

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.pzbuk,
      ...config,
      enabled: true,
    };
  }

  /** Cumulative frame counters since construction; a copy. */
  frameCounters(): PzbukFrameCounters {
    return { ...this.counters };
  }

  private addTransportStats(diagnostics: CaptureDiagnostics): void {
    addFrameCounters(this.counters, diagnostics);
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    return this.executeLeagueScrape(
      league,
      (l) => isLeagueSupported(l, this.bookmaker),
      async (page, leagueSlug) => {
        const startTime = Date.now();

        const capture = captureWebSocketData(page, false);
        const navSuccess = await navigateToLeaguePage(page, leagueSlug);

        if (!navSuccess) {
          return this.createErrorResult(
            new Error("Failed to navigate to league page"),
            Date.now() - startTime
          );
        }

        const { state: wsData, diagnostics } = await capture;

        if (!wsData) {
          const message = `No WebSocket data captured: ${describeCaptureFailure(diagnostics)}`;
          console.warn(`[PZBuk] ${message}`);
          return this.createNotFoundResult(message, Date.now() - startTime);
        }

        console.log(
          `[PZBuk] Captured ${wsData.events.length} events, ${wsData.selections?.length || 0} selections`
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

    // The capture filter must match the real "/events/<id>-<slug>" URL, or
    // any event's payload is merged.
    const captureEventId = eventUrl.match(/\/events\/(\d+)/)?.[1];

    return this.executeWithBrowser(
      async (page) => {
        const capture = captureWebSocketData(page, true, captureEventId);
        const navSuccess = await navigateToEventPage(page, eventUrl);

        if (!navSuccess) {
          return this.createMatchDetailNotFoundResult(
            "Failed to navigate to event page",
            Date.now() - startTime
          );
        }

        const { state: wsData, diagnostics } = await capture;

        if (!wsData || wsData.markets.length === 0) {
          const message = `No WebSocket data for match details: ${describeCaptureFailure(diagnostics)}`;
          console.warn(`[PZBuk] ${message}`);
          return this.createMatchDetailNotFoundResult(message, Date.now() - startTime);
        }

        const event = wsData.events[0];

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

        const listingCapture = captureWebSocketData(page, false);
        const navSuccess = await navigateToLeaguePage(page, leagueSlug);

        if (!navSuccess) {
          return this.createFullOfferErrorResult(
            leagueSlug,
            new Error("Failed to navigate to league page"),
            Date.now() - startTime
          );
        }

        const { state: listing, diagnostics: listingDiagnostics } = await listingCapture;
        this.addTransportStats(listingDiagnostics);

        if (!listing) {
          if (isEmptyListing(listingDiagnostics)) {
            console.log(
              `[PZBuk/FullOffer] listing is empty: ${describeCaptureFailure(listingDiagnostics)}`
            );
            return {
              success: true,
              bookmaker: this.bookmaker,
              league: leagueSlug,
              matches: [],
              duration: Date.now() - startTime,
            };
          }

          const message = `No WebSocket data captured: ${describeCaptureFailure(listingDiagnostics)}`;
          console.warn(`[PZBuk/FullOffer] ${message}`);
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: message,
            duration: Date.now() - startTime,
          };
        }

        console.log(
          `[PZBuk/FullOffer] Found ${listing.events.length} events in listing`
        );

        const matches: FullMatchOffer[] = [];
        let validEvents = 0;
        let firstFailure: string | null = null;
        const recordFailure = (failure: string) => {
          console.warn(`[PZBuk/FullOffer] ${failure}`);
          firstFailure ??= failure;
        };

        for (const event of listing.events) {
          if (!isValidEvent(event)) continue;

          const teams = parseTeamNames(event);
          if (!teams.homeTeam || !teams.awayTeam) continue;

          validEvents++;
          const label = `${teams.homeTeam} vs ${teams.awayTeam}`;

          try {
            const eventUrl = buildEventUrl(
              event.id,
              teams.homeTeam,
              teams.awayTeam,
              event.leagueId,
              event.leagueName
            );

            const eventCapture = captureWebSocketData(page, true, event.id);
            const eventNavSuccess = await navigateToEventPage(page, eventUrl);

            if (!eventNavSuccess) {
              // Let the capture end before the next navigation, so its
              // expansion trigger cannot click headers on the next event's
              // page; its transport counters still count.
              this.addTransportStats((await eventCapture).diagnostics);
              recordFailure(`${label}: failed to navigate to the event page`);
              continue;
            }

            const { state: eventState, diagnostics } = await eventCapture;
            this.addTransportStats(diagnostics);

            if (!eventState) {
              recordFailure(`${label}: ${describeCaptureFailure(diagnostics)}`);
            } else {
              const markets = parseAllMarkets(eventState, event.id, teams);

              if (markets.length === 0) {
                recordFailure(
                  `${label}: 0 markets parsed from ${eventState.selections.length} selections`
                );
              } else {
                matches.push(buildPzbukMatchOffer(event, teams, markets, leagueSlug, new Date()));

                const groups = diagnostics.groups ?? { declared: [], seen: [] };
                console.log(
                  `[PZBuk/FullOffer] ${label}: ${markets.length} markets (groups ${groups.seen.length}/${groups.declared.length}) (frames: invalid ${diagnostics.invalidFrames}, chunked ${diagnostics.chunkedFrames}, max ${diagnostics.maxFrameBytes} B)`
                );

                const missing = groups.declared.filter((id) => !groups.seen.includes(id));
                if (missing.length > 0) {
                  console.warn(
                    `[PZBuk/FullOffer] ${label}: market groups never answered: ${missing.join(", ")}`
                  );
                }
              }
            }

            await delay(200);
          } catch (error) {
            console.warn(
              `[PZBuk/FullOffer] Failed to fetch details for ${label}:`,
              error
            );
            firstFailure ??= `${label}: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[PZBuk/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
        );

        if (matches.length === 0) {
          const cause =
            firstFailure ?? `none attempted (${listing.events.length} listed, ${validEvents} valid)`;
          const message = `No markets captured for any of ${listing.events.length} listed events (first failure: ${cause})`;
          console.warn(`[PZBuk/FullOffer] ${message}`);
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: message,
            duration: Date.now() - startTime,
          };
        }

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
