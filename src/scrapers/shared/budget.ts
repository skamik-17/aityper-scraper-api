/**
 * Per-scrape time budget: a deadline plus an AbortSignal that every network
 * call of the scrape listens to, so one stalled request cannot hang a run.
 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface ScrapeBudget {
  /** Aborted when the deadline passes or the parent aborts. */
  readonly signal: AbortSignal;
  /** Epoch ms. */
  readonly deadline: number;
  remainingMs(): number;
  /** Throws BudgetExceededError when the budget is aborted. */
  checkpoint(): void;
}

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** The error a scrape fails with once `signal` (a budget's signal) has aborted. */
export function budgetAbortReason(signal: AbortSignal): BudgetExceededError {
  const reason = signal.reason;
  if (reason instanceof BudgetExceededError) return reason;
  return new BudgetExceededError(`scrape aborted: ${reasonText(reason)}`);
}

export function createScrapeBudget(maxDurationMs: number, parent?: AbortSignal): ScrapeBudget {
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new RangeError(`maxDurationMs must be a positive finite number, got ${maxDurationMs}`);
  }

  const own = new AbortController();
  const deadline = Date.now() + maxDurationMs;
  const timer = setTimeout(
    () => own.abort(new BudgetExceededError(`scrape budget of ${maxDurationMs}ms exceeded`)),
    maxDurationMs,
  );
  (timer as { unref?: () => void }).unref?.();

  // AbortSignal.any follows the parent without adding a listener to it, so
  // many budgets can share one parent signal.
  const signal = parent ? AbortSignal.any([parent, own.signal]) : own.signal;

  return {
    signal,
    deadline,
    remainingMs: () => (signal.aborted ? 0 : Math.max(0, deadline - Date.now())),
    checkpoint: () => {
      if (signal.aborted) throw budgetAbortReason(signal);
    },
  };
}
