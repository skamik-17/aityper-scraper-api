import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type { ScraperConfig } from "../../../types/scraper.js";
import type {
  FullOfferScraperResult,
  FullMatchOffer,
} from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
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
  parseAllMarkets,
  isValidEvent,
} from "./parser.js";

/**
 * The Playwright PZBuk scraper: the fallback behind SCRAPER_TRANSPORT_PZBUK=browser
 * (the default is PzbukWsScraper).
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
}
