
import type { PolishBookmaker } from "../../../config/index.js";
import { isLeagueSupported } from "../../../config/leagues.js";
import type {
  ScraperConfig,
} from "../../../types/scraper.js";
import type { FullOfferScraperResult, FullMatchOffer } from "../../../types/full-offer.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";

import { REQUEST_DELAY } from "./constants.js";
import {
  navigateToBaseSite,
  fetchLeagueMatches,
  fetchMarketsForMatch,
} from "./navigation.js";
import { mapLvbetMatchOffer, selectLvbetMatches } from "./full-offer-mapping.js";

/** lvbet's browser path, kept as the SCRAPER_TRANSPORT_LVBET=browser fallback (src/scrapers/bookmakers/index.ts picks). */
export class LVBetBrowserScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lvbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = {
      ...DEFAULT_SCRAPER_CONFIGS.lvbet,
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

        const matchesData = await fetchLeagueMatches(page, leagueSlug);
        if (!matchesData?.matches || matchesData.matches.length === 0) {
          return {
            success: false,
            bookmaker: this.bookmaker,
            league: leagueSlug,
            matches: [],
            error: "No matches found from API",
            duration: Date.now() - startTime,
          };
        }

        console.log(`[LVBet/FullOffer] Found ${matchesData.matches.length} matches`);

        const matches: FullMatchOffer[] = [];

        for (const match of selectLvbetMatches(matchesData)) {
          try {
            const marketsData = await fetchMarketsForMatch(page, match.match_id);
            const offer = marketsData ? mapLvbetMatchOffer(match, marketsData, leagueSlug) : null;
            if (offer) matches.push(offer);

            await this.delay(REQUEST_DELAY);
          } catch (error) {
            console.warn(
              `[LVBet/FullOffer] Failed to fetch details for match ${match.match_id}:`,
              error
            );
          }
        }

        const totalMarkets = matches.reduce((sum, m) => sum + m.markets.length, 0);
        console.log(
          `[LVBet/FullOffer] Completed: ${matches.length} matches, ${totalMarkets} total markets`
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

export { LVBetHttpScraper } from "./http-scraper.js";
