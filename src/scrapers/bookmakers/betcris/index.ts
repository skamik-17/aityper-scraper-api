/**
 * Betcris scraper entry point and the transport pick (README §3: one pick, at
 * module load): the direct Swarm client by default, the browser class when
 * SCRAPER_TRANSPORT_BETCRIS=browser. A change needs a restart. The browser
 * class keeps its legacy name as an alias (scripts/test-scrapers.sh,
 * scraper-flow.test.ts).
 */
import { getTransportOverride } from "../../../config/transport.js";
import type { FullOfferScraper } from "../../shared/scraper-contract.js";
import { BetcrisBrowserScraper } from "./browser-scraper.js";
import { BetcrisSwarmScraper } from "./swarm-scraper.js";

export { BetcrisBrowserScraper, BetcrisBrowserScraper as BetcrisPlaywrightScraper } from "./browser-scraper.js";
export { BetcrisSwarmScraper } from "./swarm-scraper.js";

export const betcrisScraper: FullOfferScraper =
  getTransportOverride("betcris") === "browser" ? new BetcrisBrowserScraper() : new BetcrisSwarmScraper();
