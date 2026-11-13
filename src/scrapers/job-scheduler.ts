/**
 * Runs bookmaker jobs under two independent caps: browser jobs (few at once, their
 * starts spread out so Chromium launches do not pile up) and every other job.
 * Results come back in input order; a job not started when the signal aborts never starts.
 */
import { mapLimit } from "./shared/concurrency.js";

export interface JobCaps {
  browserLimit: number;
  browserStaggerMs: number;
  otherLimit: number;
}

export interface CappedJob<T> {
  key: string;
  browser: boolean;
  /** `queueMs`: how long the job waited for its slot (and stagger) since the call. */
  run(queueMs: number): Promise<T>;
}

function reasonOf(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("aborted");
}

/** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(reasonOf(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(reasonOf(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runJobsWithCaps<T>(
  jobs: readonly CappedJob<T>[],
  caps: JobCaps,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<T>[]> {
  const queuedAt = Date.now();
  let nextBrowserAt = Number.NEGATIVE_INFINITY;

  const start = async (job: CappedJob<T>): Promise<T> => {
    if (signal?.aborted) throw reasonOf(signal);
    if (job.browser) {
      const now = Date.now();
      const wait = Math.max(0, nextBrowserAt - now);
      nextBrowserAt = Math.max(now, nextBrowserAt) + caps.browserStaggerMs;
      if (wait > 0) await sleep(wait, signal);
      if (signal?.aborted) throw reasonOf(signal);
    }
    return job.run(Date.now() - queuedAt);
  };

  const indexed = jobs.map((job, index) => ({ job, index }));
  const browser = indexed.filter((x) => x.job.browser);
  const other = indexed.filter((x) => !x.job.browser);
  const [browserResults, otherResults] = await Promise.all([
    mapLimit(browser, caps.browserLimit, (x) => start(x.job), signal),
    mapLimit(other, caps.otherLimit, (x) => start(x.job), signal),
  ]);

  const results = new Array<PromiseSettledResult<T>>(jobs.length);
  browser.forEach((x, i) => (results[x.index] = browserResults[i]));
  other.forEach((x, i) => (results[x.index] = otherResults[i]));
  return results;
}
