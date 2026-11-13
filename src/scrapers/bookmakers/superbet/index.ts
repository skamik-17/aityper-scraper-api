
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type {
  ScraperConfig,
} from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import {
  navigateToLeaguePage,
  fetchLeagueEvents,
  fetchEventDetails,
} from "./navigation.js";
import { mapSuperbetEventOffer, selectUpcomingSuperbetEvents } from "./full-offer-mapping.js";

/** superbet's browser path, kept as the SCRAPER_TRANSPORT_SUPERBET=browser fallback (src/scrapers/bookmakers/index.ts picks). */
export class SuperbetBrowserScraper extends PlaywrightScraper {
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
        const upcomingEvents = selectUpcomingSuperbetEvents(apiData.data, Date.now());

        console.log(
          `[Superbet/FullOffer] ${upcomingEvents.length} upcoming events with an active offer`
        );

        const matches: FullMatchOffer[] = [];

        for (const event of upcomingEvents) {

          try {
            const detailData = await fetchEventDetails(page, String(event.eventId));
            const offer = mapSuperbetEventOffer(detailData, leagueSlug);
            if (offer) matches.push(offer);

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
}

export { SuperbetHttpScraper } from "./http-scraper.js";
