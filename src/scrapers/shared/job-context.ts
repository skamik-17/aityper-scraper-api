/**
 * The (bookmaker, league) scrape job a piece of code runs in, without threading it
 * through every call: the browser layer reads the job's budget to close its context
 * when the budget aborts.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { PolishBookmaker } from "../../config/index.js";
import type { JobTransport } from "../job-budgets.js";
import type { ScrapeBudget } from "./budget.js";

export interface ScrapeJobContext {
  runId: string;
  bookmaker: PolishBookmaker;
  league: string;
  transport: JobTransport;
  budget: ScrapeBudget;
}

const storage = new AsyncLocalStorage<ScrapeJobContext>();

export function runInScrapeJob<T>(ctx: ScrapeJobContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentScrapeJob(): ScrapeJobContext | undefined {
  return storage.getStore();
}
