/**
 * LeBull runs on Betby (Sportradar UOF data, through an sbteam proxy) and is scraped
 * browserless by the shared BetbyScraper. The class keeps its historical name because the
 * aggregator, the audit registry and scripts/test-scrapers.sh refer to it.
 */
import { BETBY_BRANDS } from "../../shared/betby/brands.js";
import { BetbyScraper, type BetbyScraperDeps } from "../../shared/betby/scraper.js";

export class LebullPlaywrightScraper extends BetbyScraper {
  constructor(deps?: BetbyScraperDeps) {
    super(BETBY_BRANDS.lebull, deps);
  }
}

export const lebullScraper = new LebullPlaywrightScraper();
