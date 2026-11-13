/**
 * Betcris scraper entry point. The browser class keeps its legacy name as an
 * alias (scripts/test-scrapers.sh, scraper-flow.test.ts).
 */
import { BetcrisBrowserScraper } from "./browser-scraper.js";

export { BetcrisBrowserScraper, BetcrisBrowserScraper as BetcrisPlaywrightScraper } from "./browser-scraper.js";

export const betcrisScraper = new BetcrisBrowserScraper();
