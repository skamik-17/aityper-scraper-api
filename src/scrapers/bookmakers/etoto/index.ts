
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
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
import { toEtotoOffer } from "./offer-mapping.js";

/** etoto's browser path, kept as the SCRAPER_TRANSPORT_ETOTO=browser fallback (src/scrapers/bookmakers/index.ts picks). */
export class EtotoBrowserScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "etoto";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.etoto,
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

        const navSuccess = await navigateToBaseSite(page);
        if (!navSuccess) {
          return this.createFullOfferErrorResult(
            leagueSlug,
            new Error("Failed to navigate to eToto"),
            Date.now() - startTime
          );
        }

        await this.delay(500);

        const events = await fetchLeagueEvents(page, leagueSlug);
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

        console.log(`[eToto/FullOffer] Found ${events.length} events, fetching details for each...`);

        const matches: FullMatchOffer[] = [];

        for (const event of events) {
          if (!isValidEvent(event)) continue;

          try {
            const detailData = await fetchEventDetails(page, String(event.eventId));
            if (!detailData?.data) {
              // No listing fallback: a thin listing write would replace the match's full offer
              console.warn(`[eToto/FullOffer] Skipping ${event.eventId}: detail failed`);
              continue;
            }
            const offer = toEtotoOffer(event, detailData.data, leagueSlug);
            if (offer) {
              matches.push(offer);
              console.log(`[eToto/FullOffer] ${offer.homeTeam} vs ${offer.awayTeam}: ${offer.markets.length} markets`);
            }

            await this.delay(100);
          } catch (error) {
            console.warn(
              `[eToto/FullOffer] Failed to fetch details for event ${event.eventId}:`,
              error
            );
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[eToto/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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

