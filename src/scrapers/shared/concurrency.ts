/**
 * Bounded-concurrency map that never throws: every item settles, in input
 * order. Items not started when the signal aborts are rejected without
 * calling `fn`.
 */
import pLimit from "p-limit";

function reasonError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<R>[]> {
  const run = pLimit(limit);
  return Promise.allSettled(
    items.map((item, index) =>
      run(() => {
        if (signal?.aborted) throw reasonError(signal);
        return fn(item, index);
      }),
    ),
  );
}
