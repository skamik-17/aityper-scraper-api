/**
 * PZBuk scrapers: the direct WebSocket client by default, the Playwright
 * class behind SCRAPER_TRANSPORT_PZBUK=browser. The pick itself happens once in
 * `bookmakers/index.ts` (README §3 single pick); every importer reads
 * `pzbukScraper` from there.
 */
import { getTransportOverride } from "../../../config/transport.js";
import type { FullOfferScraper } from "../../shared/scraper-contract.js";
import { PzbukBrowserScraper } from "./browser-scraper.js";
import { PzbukWsScraper } from "./ws-scraper.js";
import type { PzbukFrameCounters } from "./ws-protocol.js";

export { PzbukBrowserScraper } from "./browser-scraper.js";
export { PzbukWsScraper } from "./ws-scraper.js";
export type { PzbukFrameCounters } from "./ws-protocol.js";

/** Both classes; counters are cumulative since construction. */
export interface PzbukFrameCounterSource {
  frameCounters(): PzbukFrameCounters;
}

export function hasFrameCounters(s: FullOfferScraper): s is FullOfferScraper & PzbukFrameCounterSource {
  return typeof (s as Partial<PzbukFrameCounterSource>).frameCounters === "function";
}

/** "browser" → PzbukBrowserScraper; anything else → PzbukWsScraper. */
export function createPzbukScraper(env: NodeJS.ProcessEnv = process.env): FullOfferScraper {
  return getTransportOverride("pzbuk", env) === "browser" ? new PzbukBrowserScraper() : new PzbukWsScraper();
}
