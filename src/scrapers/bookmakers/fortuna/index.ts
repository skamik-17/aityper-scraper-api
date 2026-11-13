
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type {
  ScraperConfig,
} from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";

import { API_REQUEST_DELAY } from "./constants.js";
import {
  navigateToBaseSite,
  fetchLeagueData,
  fetchAllMarketsForFixture,
} from "./navigation.js";
import { mapFortunaFixtureOffer, selectFortunaFixtures } from "./full-offer-mapping.js";

/** fortuna's browser path, kept as the SCRAPER_TRANSPORT_FORTUNA=browser fallback (src/scrapers/bookmakers/index.ts picks). */
export class FortunaBrowserScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "fortuna";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.fortuna,
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
            new Error("Failed to navigate to base site"),
            Date.now() - startTime
          );
        }

        const leagueData = await fetchLeagueData(page, leagueSlug);
        if (!leagueData || !leagueData.fixtures || leagueData.fixtures.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No fixtures found from API",
            duration: Date.now() - startTime,
          };
        }

        console.log(`[Fortuna/FullOffer] Found ${leagueData.fixtures.length} fixtures`);

        const matches: FullMatchOffer[] = [];

        for (const fixture of selectFortunaFixtures(leagueData)) {
          try {
            const allMarkets = await fetchAllMarketsForFixture(page, fixture.id);
            const offer = allMarkets ? mapFortunaFixtureOffer(fixture, allMarkets, leagueSlug) : null;
            if (offer) matches.push(offer);

            await this.delay(API_REQUEST_DELAY);
          } catch (error) {
            console.warn(
              `[Fortuna/FullOffer] Failed to fetch details for fixture ${fixture.id}:`,
              error
            );
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[Fortuna/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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

export { FortunaHttpScraper } from "./http-scraper.js";
