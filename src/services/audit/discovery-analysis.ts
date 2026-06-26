import type { PrepMarketEntry } from "./types.js";

/** A market name that carries no semantic meaning (scraper fallback / raw code / empty). */
export function isPlaceholderName(name: string): boolean {
  const n = (name ?? "").trim();
  if (n.length === 0) return true;
  if (/^rynek\s/i.test(n)) return true; // Fortuna-style "Rynek <id>" fallback
  if (/:/.test(n) && /[a-z]+:[a-z0-9]/i.test(n)) return true; // raw code like "ufo:mtyp:00-ox"
  return false;
}

export interface DiscoveryAnalysis {
  total: number;
  recognized: number;
  recognizedPct: number;
  uniqueNames: number;
  placeholderNames: number;
  emptyBookmakerId: number;
  topUnrecognized: { name: string; count: number }[];
}

export function analyzeDiscovery(markets: PrepMarketEntry[], topN = 20): DiscoveryAnalysis {
  const total = markets.length;
  const recognized = markets.filter((m) => m.normalized.marketCode !== "OTHER").length;
  const uniqueNames = new Set(markets.map((m) => m.raw.name)).size;
  const placeholderNames = new Set(
    markets.map((m) => m.raw.name).filter((n) => isPlaceholderName(n)),
  ).size;
  const emptyBookmakerId = markets.filter((m) => !m.raw.bookmakerMarketId).length;

  const unrecognizedCounts = new Map<string, number>();
  for (const m of markets) {
    if (m.normalized.marketCode === "OTHER") {
      unrecognizedCounts.set(m.raw.name, (unrecognizedCounts.get(m.raw.name) ?? 0) + 1);
    }
  }
  const topUnrecognized = [...unrecognizedCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  return {
    total,
    recognized,
    recognizedPct: total === 0 ? 0 : Math.round((recognized / total) * 100),
    uniqueNames,
    placeholderNames,
    emptyBookmakerId,
    topUnrecognized,
  };
}
