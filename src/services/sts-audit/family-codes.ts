import { MARKET_CATALOG, getMarketByCode } from "../../data/market-catalog.js";

export interface RelatedCodeSummary {
  code: string;
  labelPl: string;
}

const FAMILY_PREFIXES = [
  "FIRST_HALF_",
  "SECOND_HALF_",
  "HOME_",
  "AWAY_",
  "CORNERS_",
  "CARDS_",
  "HALF_TIME_",
];

function stripFamilyPrefix(code: string): string | null {
  for (const p of FAMILY_PREFIXES) {
    if (code.startsWith(p)) return code.slice(p.length);
  }
  return null;
}

/**
 * Returns codes in the same "family" as the input, excluding the input itself.
 *
 * Heuristic:
 *  1. If input has a known family prefix, root = code without prefix; family =
 *     root + all variants prefixed by any FAMILY_PREFIXES.
 *  2. Else, root = input; family = root + all variants prefixed by any FAMILY_PREFIXES.
 *  3. If (1) and (2) both yield zero matches beyond the input itself, fall back
 *     to all catalog entries with the same `category`.
 *
 * Always excludes the input code from the result. Returns empty array if input
 * is not in the catalog at all.
 */
export function getRelatedCodes(code: string): RelatedCodeSummary[] {
  const self = getMarketByCode(code);
  if (!self) return [];

  const root = stripFamilyPrefix(code) ?? code;

  const candidateCodes = new Set<string>();
  // Root itself if different from input
  if (root !== code) candidateCodes.add(root);
  // All prefix variants of the root
  for (const p of FAMILY_PREFIXES) {
    candidateCodes.add(`${p}${root}`);
  }

  let family = MARKET_CATALOG.filter(
    (m) => m.code !== code && candidateCodes.has(m.code),
  );

  // Fallback to category if no family found
  if (family.length === 0) {
    family = MARKET_CATALOG.filter(
      (m) => m.code !== code && m.category === self.category,
    );
  }

  return family.map((m) => ({ code: m.code, labelPl: m.labels.pl }));
}
