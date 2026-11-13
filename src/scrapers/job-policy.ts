/**
 * Which transport a scraper instance uses, read from the instance itself: the
 * SCRAPER_TRANSPORT_<BM> pick happens at module load, so classifying the picked
 * instance is the truth and survives file moves.
 */
import { PlaywrightScraper } from "./base/playwright-base.js";
import type { PolishBookmaker } from "../config/index.js";
import { maxDurationMsFor, type JobTransport } from "./job-budgets.js";
import type { JobCaps } from "./job-scheduler.js";
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

/** At most 3 browsers at once, started 1.5 s apart; 12 other jobs at once. */
export const DEFAULT_JOB_CAPS: JobCaps = Object.freeze({ browserLimit: 3, browserStaggerMs: 1_500, otherLimit: 12 });

/** Longest browser budgets first (so the long jobs start at once), ties in input order. */
export function orderBrowserJobs(bookmakers: readonly PolishBookmaker[]): PolishBookmaker[] {
  return bookmakers
    .map((bm, index) => ({ bm, index, budget: maxDurationMsFor(bm, "browser") }))
    .sort((a, b) => b.budget - a.budget || a.index - b.index)
    .map((x) => x.bm);
}
