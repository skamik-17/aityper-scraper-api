/**
 * Odds quarantine helper (SPEC.md §5 - product safety net).
 *
 * This service marks obviously broken quotes (placeholder values like 1501,
 * decimal-shifted odds vs the cross-bookmaker pool median) with
 * `suspect: true` during aggregation (see market-type-grouper.ts). Suspect
 * quotes stay in the API payload for transparency and audit tooling, but
 * they must NEVER win a best-odds computation.
 *
 * The frontend repo keeps its own copy of this exact check (it needs the
 * same filter for client-side best-odds/rendering logic) - this is a
 * deliberate small duplication rather than a shared package, since it's one
 * pure ~3-line function and the two repos otherwise have no shared code.
 */

/** Minimal selection shape the quarantine check needs. */
export interface QuarantinableSelection {
  odds: number;
  suspect?: boolean;
}

/**
 * Returns true when a selection's odds may be used as a real price
 * (best-odds computation, default display). False for quarantined quotes.
 */
export function isUsableOdds(sel: QuarantinableSelection): boolean {
  return sel.suspect !== true;
}
