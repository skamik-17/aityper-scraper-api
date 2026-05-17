import type { MarketCatalogEntry } from "../../data/market-catalog.js";

/**
 * Returns true when a normalized selection code is "orphaned" relative to its
 * catalog entry — i.e. not in entry.selections.
 *
 * Conventions match the original implementation in betclic-selections-audit.ts:
 *  - undefined entry → treat as orphan (no catalog to validate against)
 *  - empty entry.selections (legacy market) → accept anything
 *  - otherwise: orphan iff code is not present in entry.selections
 */
export function isSelectionOrphan(
  code: string,
  entry: MarketCatalogEntry | undefined,
): boolean {
  if (!entry) return true;
  if (entry.selections.length === 0) return false;
  return !entry.selections.includes(code);
}
