/**
 * How long one (bookmaker, league) scrape may run, by transport. A leaf module: it
 * imports only DEFAULT_MAX_DURATION_MS and types, so plan 08's browser policy can use it.
 */
import type { PolishBookmaker } from "../config/index.js";
import { DEFAULT_MAX_DURATION_MS } from "./shared/scraper-contract.js";

export type JobTransport = keyof typeof DEFAULT_MAX_DURATION_MS;

/**
 * Browser-path budgets above the 240 s default: max(240 s, 2 × observed max) rounded up
 * to the minute, or the recovery code's retry worst case when that is larger.
 * betcris: 16 good games then 3 failing ones before its breaker trips, each failing match
 * 2 × (45 s first useful frame + 15 s + 30 s) + 3 s = 183 s, about 636 s in all, so 720 s
 * keeps the games captured before the breaker.
 */
export const BROWSER_MAX_DURATION_OVERRIDES_MS: Readonly<Partial<Record<PolishBookmaker, number>>> = Object.freeze({
  pzbuk: 600_000,
  betcris: 720_000,
  sts: 360_000,
});

/** How long after the budget's deadline a scrape that ignores its signal is given up on. */
export const HARD_DEADLINE_GRACE_MS = 5_000;

export function maxDurationMsFor(bookmaker: PolishBookmaker, transport: JobTransport): number {
  if (transport === "browser") return BROWSER_MAX_DURATION_OVERRIDES_MS[bookmaker] ?? DEFAULT_MAX_DURATION_MS.browser;
  return DEFAULT_MAX_DURATION_MS[transport];
}
