/**
 * Per-event market-group coverage of a PZBuk offer snapshot (pure).
 *
 * Every event declares its market groups (`marketGroups{id,name,marketsCount}`)
 * and every market lists the groups it belongs to
 * (`marketType.marketGroupIds`). An event is complete when, for every declared
 * group, at least `marketsCount` of the event's markets list that group. A
 * market listed under two declared groups counts once per group, so the counted
 * total can exceed the number of unique markets.
 */
import type { PZBukEvent, PZBukMarket } from "./types.js";

export interface GroupCoverage {
  /** Ids of event.marketGroups, ascending. */
  declared: number[];
  /** Declared ids whose counted markets >= marketsCount, ascending. */
  complete: number[];
  /** Σ marketsCount over the declared groups. */
  declaredMarkets: number;
  /** Σ over markets of |marketType.marketGroupIds ∩ declared|. */
  countedMarkets: number;
  /** markets.length. */
  uniqueMarkets: number;
}

const ascending = (a: number, b: number) => a - b;

/** Coverage of one event; `markets` must be that event's markets only. */
export function groupCoverage(event: PZBukEvent, markets: readonly PZBukMarket[]): GroupCoverage {
  const groups = Object.values(event.marketGroups ?? {});
  const counts = new Map<number, number>(groups.map((g) => [Number(g.id), 0]));

  let countedMarkets = 0;
  for (const market of markets) {
    for (const id of new Set(market.marketType?.marketGroupIds ?? [])) {
      const count = counts.get(Number(id));
      if (count === undefined) continue;
      counts.set(Number(id), count + 1);
      countedMarkets++;
    }
  }

  return {
    declared: [...counts.keys()].sort(ascending),
    complete: groups
      .filter((g) => (counts.get(Number(g.id)) ?? 0) >= g.marketsCount)
      .map((g) => Number(g.id))
      .sort(ascending),
    declaredMarkets: groups.reduce((sum, g) => sum + g.marketsCount, 0),
    countedMarkets,
    uniqueMarkets: markets.length,
  };
}

export function isCoverageComplete(c: GroupCoverage): boolean {
  return c.declared.length > 0 && c.complete.length === c.declared.length;
}

export function describeCoverage(c: GroupCoverage): string {
  return `groups ${c.complete.length}/${c.declared.length}, markets counted ${c.countedMarkets}/${c.declaredMarkets}`;
}
