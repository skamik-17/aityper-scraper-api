/**
 * The main markets of one normalized match offer (1X2, BTTS, O/U, double chance), as
 * scripts/scraper-check.ts prints them. A market is reported only when every one of its
 * selections is present.
 */
import type { ScrapedMarket } from "../types/full-offer.js";

export interface MainMarketsSummary {
  x12?: { home: number; draw: number; away: number };
  btts?: { yes: number; no: number };
  ou25?: { over: number; under: number };
  /** Every TOTAL_GOALS line, sorted numerically. */
  ouLines: string[];
  dc?: { homeOrDraw: number; drawOrAway: number; homeOrAway: number };
}

function pick<K extends string>(market: ScrapedMarket, names: Record<K, string>): Record<K, number> | undefined {
  const out = {} as Record<K, number>;
  for (const [key, selection] of Object.entries(names) as Array<[K, string]>) {
    const odds = market.selections.find((s) => s.normalizedName === selection)?.odds;
    if (typeof odds !== "number") return undefined;
    out[key] = odds;
  }
  return out;
}

export function summarizeMainMarkets(normalized: readonly ScrapedMarket[]): MainMarketsSummary {
  const out: MainMarketsSummary = { ouLines: [] };
  const lines = new Set<string>();
  for (const market of normalized) {
    switch (market.normalizedType) {
      case "MATCH_WINNER":
        out.x12 ??= pick(market, { home: "HOME", draw: "DRAW", away: "AWAY" });
        break;
      case "BTTS":
        out.btts ??= pick(market, { yes: "YES", no: "NO" });
        break;
      case "DOUBLE_CHANCE":
        out.dc ??= pick(market, { homeOrDraw: "HOME_OR_DRAW", drawOrAway: "DRAW_OR_AWAY", homeOrAway: "HOME_OR_AWAY" });
        break;
      case "TOTAL_GOALS":
        if (market.paramValue === undefined) break;
        lines.add(market.paramValue);
        if (Number(market.paramValue) === 2.5) out.ou25 ??= pick(market, { over: "OVER", under: "UNDER" });
        break;
    }
  }
  out.ouLines = [...lines].sort((a, b) => Number(a) - Number(b));
  // A market without all its selections is reported as missing
  for (const k of ["x12", "btts", "ou25", "dc"] as const) if (out[k] === undefined) delete out[k];
  return out;
}
