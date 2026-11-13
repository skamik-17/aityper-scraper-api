import type { ScrapedMarket } from "../../types/full-offer.js";

/**
 * Per-run roll-up of markets the normalizer left as OTHER, keyed by the raw
 * bookmaker market id. One line per bookmaker per run makes a renamed id
 * family visible without reading thousands of per-market warnings.
 */
export interface UnmappedSummary {
  otherMarkets: number;
  distinctIds: number;
  top: Array<[id: string, count: number]>;
}

export const UNMAPPED_SUMMARY_TOP_N = 20;

/**
 * Count normalized markets that ended up as OTHER. The key is the raw
 * `bookmakerMarketId`, or the market name when the bookmaker has no id.
 * `top` is sorted by count (desc), then by id (asc, code-unit order).
 */
export function summarizeUnmappedMarkets(markets: ScrapedMarket[], topN: number = UNMAPPED_SUMMARY_TOP_N): UnmappedSummary {
  const counts = new Map<string, number>();
  let otherMarkets = 0;

  for (const market of markets) {
    if (market.normalizedType !== "OTHER") continue;
    otherMarkets++;
    const key = market.bookmakerMarketId ?? market.name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, topN);

  return { otherMarkets, distinctIds: counts.size, top };
}

export function formatUnmappedSummary(bookmaker: string, s: UnmappedSummary): string {
  const top = s.top.map(([id, count]) => `${id}×${count}`).join(", ");
  return `[ScrapeHelpers] ${bookmaker}: ${s.distinctIds} unmapped market ids, ${s.otherMarkets} OTHER markets this run (top: ${top})`;
}
