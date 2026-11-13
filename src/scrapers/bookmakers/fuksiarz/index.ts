
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported as isLeagueSupportedCentral } from "../../../config/leagues.js";
import type {
  ScraperConfig,
} from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";

import {
  navigateToBaseSite,
  fetchLeagueEvents,
  fetchEventDetails,
} from "./navigation.js";
import {
  isValidEvent,
} from "./parser.js";
import { toFuksiarzOffer } from "./offer-mapping.js";

/** fuksiarz's browser path, kept as the SCRAPER_TRANSPORT_FUKSIARZ=browser fallback (src/scrapers/bookmakers/index.ts picks). */
export class FuksiarzBrowserScraper extends PlaywrightScraper {
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

        const matches: FullMatchOffer[] = [];

        for (const event of events) {
          if (!isValidEvent(event)) continue;

          try {
            const eventId = String(event.eventId);
            const detailResponse = await fetchEventDetails(page, eventId);
            if (!detailResponse?.data) {
              // No listing fallback: a thin listing write would replace the match's full offer
              console.warn(`[Fuksiarz/FullOffer] Skipping ${eventId}: detail failed`);
              continue;
            }
            const offer = toFuksiarzOffer(event, detailResponse.data, leagueSlug);
            if (offer) {
              matches.push(offer);
              console.log(`[Fuksiarz/FullOffer] ${offer.homeTeam} vs ${offer.awayTeam}: ${offer.markets.length} markets`);
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
}

