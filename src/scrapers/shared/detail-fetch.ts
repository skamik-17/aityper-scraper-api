/**
 * Fetch per-event details with bounded concurrency. A failed detail skips its
 * event (no FullMatchOffer, so no write and no prune for that match) instead
 * of falling back to thin listing data.
 */
import { mapLimit } from "./concurrency.js";
import type { ScrapeBudget } from "./budget.js";

/** More skipped details than this share of the attempted ones fails the scrape. */
export const MAX_SKIPPED_DETAIL_RATIO = 0.5;

export interface DetailFetchOutcome<E, D> {
  fetched: Array<{ event: E; detail: D }>;
  skipped: Array<{ id: string; error: string }>;
}

export async function fetchDetailsSkippingFailures<E, D>(
  events: readonly E[],
  idOf: (e: E) => string,
  fetchDetail: (e: E, signal: AbortSignal) => Promise<D>,
  opts: { concurrency: number; budget: ScrapeBudget },
): Promise<DetailFetchOutcome<E, D>> {
  const { budget } = opts;
  const settled = await mapLimit(events, opts.concurrency, (e) => {
    budget.checkpoint();
    return fetchDetail(e, budget.signal);
  });

  const out: DetailFetchOutcome<E, D> = { fetched: [], skipped: [] };
  settled.forEach((r, i) => {
    const event = events[i];
    if (r.status === "fulfilled") out.fetched.push({ event, detail: r.value });
    else out.skipped.push({ id: idOf(event), error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  return out;
}
