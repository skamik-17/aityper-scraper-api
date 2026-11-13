/**
 * Betters runs on Betby (Sportradar UOF data) and is scraped browserless by the shared
 * BetbyScraper. The class keeps its historical name because the aggregator, the audit
 * registry and scripts/test-scrapers.sh refer to it.
 */
import { BETBY_BRANDS } from "../../shared/betby/brands.js";
import { BetbyScraper, type BetbyScraperDeps } from "../../shared/betby/scraper.js";

export class BettersPlaywrightScraper extends BetbyScraper {
  constructor(deps?: BetbyScraperDeps) {
    super(BETBY_BRANDS.betters, deps);
  }
}

export const bettersScraper = new BettersPlaywrightScraper();
