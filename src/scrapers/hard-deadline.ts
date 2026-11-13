/**
 * One (bookmaker, league) scrape under its budget, with a hard stop: a scraper that
 * ignores its signal is given up on at deadline + grace, and its late result is
 * discarded (never normalized or saved).
 */
import type { PolishBookmaker } from "../config/index.js";
import type { FullOfferScraperResult } from "../types/full-offer.js";
import { HARD_DEADLINE_GRACE_MS, type JobTransport } from "./job-budgets.js";
import { createScrapeBudget } from "./shared/budget.js";
import { runInScrapeJob } from "./shared/job-context.js";
import type { FullOfferScraper } from "./shared/scraper-contract.js";

export interface HardDeadlineJob {
  runId: string;
  bookmaker: PolishBookmaker;
  league: string;
  transport: JobTransport;
  maxDurationMs: number;
}

/** The run itself was aborted (shutdown) while this unit was still scraping: no outcome. */
export class RunInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunInterruptedError";
  }
}

function abortMessage(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

export function hardTimeoutMessage(maxDurationMs: number): string {
  return `hard timeout after ${Math.round(maxDurationMs / 1000)}s`;
}

export async function scrapeWithHardDeadline(
  scraper: FullOfferScraper,
  job: HardDeadlineJob,
  runSignal?: AbortSignal,
  deps: { graceMs?: number; createBudget?: typeof createScrapeBudget } = {},
): Promise<FullOfferScraperResult> {
  if (runSignal?.aborted) throw new RunInterruptedError(abortMessage(runSignal));
  const started = Date.now();
  const graceMs = deps.graceMs ?? HARD_DEADLINE_GRACE_MS;
  const budget = (deps.createBudget ?? createScrapeBudget)(job.maxDurationMs, runSignal);
  const message = hardTimeoutMessage(job.maxDurationMs);

  const scrape = runInScrapeJob({ ...job, budget }, () => scraper.scrapeFullOffer(job.league, budget));
  // A late settle of the abandoned scrape must not surface as an unhandled rejection
  scrape.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const hardStop = new Promise<FullOfferScraperResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          success: false,
          bookmaker: job.bookmaker,
          league: job.league,
          matches: [],
          error: message,
          duration: Date.now() - started,
        }),
      Math.max(0, budget.deadline + graceMs - Date.now()),
    );
  });

  // A run abort (shutdown) interrupts at once, with no grace
  let detach: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    if (!runSignal) return;
    const onAbort = () => reject(new RunInterruptedError(abortMessage(runSignal)));
    runSignal.addEventListener("abort", onAbort, { once: true });
    detach = () => runSignal.removeEventListener("abort", onAbort);
  });

  try {
    const result = await Promise.race([scrape, hardStop, interrupted]);
    // A failure that only came once the budget had run out is the deadline's doing
    if (!result.success && result.error !== message && Date.now() >= budget.deadline) {
      return { ...result, error: result.error ? `${message} | ${result.error}` : message };
    }
    return result;
  } finally {
    clearTimeout(timer);
    detach?.();
  }
}
