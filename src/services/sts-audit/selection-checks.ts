import type { MarketCatalogEntry } from "../../data/market-catalog.js";

/**
 * Market codes where duplicate selection codes within a single market are
 * semantically expected (multiple handicap lines, one HOME/AWAY/DRAW per line).
 * Shared by betclic-prep-audit.ts and betclic-selections-audit.ts.
 */
export const HANDICAP_CODES = new Set([
  "ASIAN_HANDICAP", "ASIAN_HANDICAP_3WAY", "ASIAN_HANDICAP_PUSH",
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_ASIAN_HANDICAP", "FIRST_HALF_ASIAN_HANDICAP_PUSH",
  "SECOND_HALF_ASIAN_HANDICAP", "SECOND_HALF_ASIAN_HANDICAP_PUSH",
  "FIRST_HALF_EUROPEAN_HANDICAP", "SECOND_HALF_EUROPEAN_HANDICAP",
  "CORNERS_HANDICAP", "HALF_TIME_CORNERS_HANDICAP",
]);

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
