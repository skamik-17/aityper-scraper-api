/**
 * Which transport a scraper instance uses, read from the instance itself: the
 * SCRAPER_TRANSPORT_<BM> pick happens at module load, so classifying the picked
 * instance is the truth and survives file moves.
 */
import { PlaywrightScraper } from "./base/playwright-base.js";
import type { JobTransport } from "./job-budgets.js";
import type { FullOfferScraper } from "./shared/scraper-contract.js";

export * from "./job-budgets.js";

/** README §3: every non-browser scraper declares its transport. */
export interface DeclaresTransport {
  readonly transport: JobTransport;
}

const TRANSPORTS: readonly JobTransport[] = ["http", "websocket", "browser"];

export function resolveJobTransport(scraper: FullOfferScraper): JobTransport {
  const declared = (scraper as Partial<DeclaresTransport>).transport;
  if (declared !== undefined && TRANSPORTS.includes(declared)) return declared;
  // An undeclared Playwright subclass launches Chromium
  if (scraper instanceof PlaywrightScraper) return "browser";
  return "http";
}
