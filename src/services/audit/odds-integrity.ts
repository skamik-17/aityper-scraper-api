/**
 * Odds-integrity detectors — the zero-tolerance mechanical class of the match
 * audit (spec: docs/audit-ledger/SPEC.md §3.3). Catches structurally broken
 * odds: decimal shifts, placeholder values, impossible odds, swapped axes and
 * broken overround.
 *
 * Pure functions, no I/O. Called from match-audit-core's analyzeApiMarket with
 * FRESH quotes only (the §3.1 staleness windowing happens in the caller).
 */

export type OddsIntegrityDetector =
  | "decimal_shift"
  | "placeholder_odds"
  | "impossible_odds"
  | "axis_swap"
  | "overround";

export interface OddsIntegrityFlag {
  bookmaker: string;
  param: string;
  selectionType: string;
  detector: OddsIntegrityDetector;
  odds: number;
  expected: number | null;
  evidence: string;
}

export interface IntegrityQuote {
  selectionType: string;
  odds: number;
  /** true when selectionType is a canonical/catalog code (poolable across books). */
  canonical: boolean;
}

export interface IntegrityBookmakerQuotes {
  bookmaker: string;
  quotes: IntegrityQuote[];
}

export interface IntegrityParamInput {
  param: string;
  bookmakers: IntegrityBookmakerQuotes[];
}

export interface IntegrityMarketInput {
  /** Catalog selection codes in catalog order; null when dynamic/unknown. */
  catalogSelections: string[] | null;
  /** Markets with dynamic vocabularies (scores, players) skip vector detectors. */
  vocabExempt: boolean;
  /**
   * Market type code (e.g. "HT_OR_FT_RESULT"). Compound "wins one of several
   * ways" markets are named with "_OR_" at the TYPE level (not the selection
   * level) and legitimately sum overround > 1 — see detectOverround.
   */
  marketType: string;
  /** FRESH quotes only — staleness exclusion happens in the caller (§3.1). */
  params: IntegrityParamInput[];
}

// ---------------------------------------------------------------------------
// Thresholds (spec §3.3)
// ---------------------------------------------------------------------------

const PLACEHOLDER_MIN_ODDS = 1000;
const REPEATED_ODDS_MIN = 5;
const REPEATED_PEER_VARIATION = 0.2;

const DECIMAL_SHIFT_MIN_PEERS = 3;
/** "Deviate > 300%" read as a symmetric ratio: >3x off the peer median. */
const DECIMAL_SHIFT_RATIO = 3;
const DECIMAL_SHIFT_TOLERANCE = 0.15;

const AXIS_SWAP_MIN_PEERS = 4;
/**
 * Per-component tolerance for the permuted match. The spec's ground-truth case
 * (pzbuk 3.63 vs peer-median 5.5 = 34% off) forces widening beyond the
 * notional 15%; the >40%-on->=2-components identity gate keeps this safe.
 */
const AXIS_SWAP_PERM_TOLERANCE = 0.35;
const AXIS_SWAP_IDENTITY_DEV = 0.4;
const AXIS_SWAP_MIN_DEV_COMPONENTS = 2;

const OVERROUND_MIN = 0.95;
const OVERROUND_MAX = 1.45;

/**
 * Markets whose catalog selections are independent per-team YES props, not a
 * partition of the outcome space: both legs can happen together, and the
 * dominant "neither did" branch is never priced at all. Summing their implied
 * probabilities is meaningless — betcris PENALTY_MISSED prices HOME=14 (7.1%)
 * and AWAY=46 (2.2%), which sums to 9.3%, yet the SAME book's own "no penalty
 * at all" quote (1.31 = 76%) shows that price is exactly right.
 */
export const NON_EXHAUSTIVE_SELECTION_MARKETS = new Set<string>([
  "PENALTY_MISSED",
  "TEAM_MISSES_PENALTY",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** All non-identity permutations of [0..n-1] (only ever called with n = 2 or 3). */
function nonIdentityPermutations(n: number): number[][] {
  const result: number[][] = [];
  const permute = (cur: number[], rest: number[]) => {
    if (rest.length === 0) {
      result.push(cur);
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      permute([...cur, rest[i]], rest.filter((_, j) => j !== i));
    }
  };
  permute([], Array.from({ length: n }, (_, i) => i));
  return result.filter((p) => p.some((v, i) => v !== i));
}

/** Human description of a permutation, e.g. "HOME<->AWAY" or "A->B->C->A". */
function describePermutation(selections: string[], perm: number[]): string {
  const visited = new Set<number>();
  const parts: string[] = [];
  for (let i = 0; i < perm.length; i++) {
    if (visited.has(i) || perm[i] === i) continue;
    const cycle = [i];
    visited.add(i);
    let j = perm[i];
    while (j !== i) {
      cycle.push(j);
      visited.add(j);
      j = perm[j];
    }
    if (cycle.length === 2) {
      parts.push(`${selections[cycle[0]]}<->${selections[cycle[1]]}`);
    } else {
      parts.push([...cycle.map((k) => selections[k]), selections[cycle[0]]].join("->"));
    }
  }
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/** 0 < odds <= 1.0 — a probability >= 100% is impossible. */
function detectImpossibleOdds(input: IntegrityMarketInput, out: OddsIntegrityFlag[]): void {
  for (const param of input.params) {
    for (const bmq of param.bookmakers) {
      for (const q of bmq.quotes) {
        if (q.odds > 0 && q.odds <= 1.0) {
          out.push({
            bookmaker: bmq.bookmaker,
            param: param.param,
            selectionType: q.selectionType,
            detector: "impossible_odds",
            odds: q.odds,
            expected: null,
            evidence: `odds ${q.odds} <= 1.0 (implied probability >= 100%)`,
          });
        }
      }
    }
  }
}

/**
 * Placeholder odds: (i) odds >= 1000; (ii) the same odds value repeated across
 * >= 5 selections of one bookmaker within the market while peer medians for
 * those selections vary by > 20%.
 */
function detectPlaceholderOdds(input: IntegrityMarketInput, out: OddsIntegrityFlag[]): void {
  // Rule (i): absurd absolute value, per quote.
  for (const param of input.params) {
    for (const bmq of param.bookmakers) {
      for (const q of bmq.quotes) {
        if (q.odds >= PLACEHOLDER_MIN_ODDS) {
          out.push({
            bookmaker: bmq.bookmaker,
            param: param.param,
            selectionType: q.selectionType,
            detector: "placeholder_odds",
            odds: q.odds,
            expected: null,
            evidence: `odds ${q.odds} >= ${PLACEHOLDER_MIN_ODDS} (placeholder value)`,
          });
        }
      }
    }
  }

  // Rule (ii): identical value repeated while peers vary.
  const perBookmaker = new Map<string, { param: string; selectionType: string; odds: number }[]>();
  for (const param of input.params) {
    for (const bmq of param.bookmakers) {
      if (!perBookmaker.has(bmq.bookmaker)) perBookmaker.set(bmq.bookmaker, []);
      const list = perBookmaker.get(bmq.bookmaker)!;
      for (const q of bmq.quotes) {
        list.push({ param: param.param, selectionType: q.selectionType, odds: q.odds });
      }
    }
  }

  const peerOdds = (bookmaker: string, param: string, selectionType: string): number[] => {
    const p = input.params.find((x) => x.param === param);
    if (!p) return [];
    const odds: number[] = [];
    for (const bmq of p.bookmakers) {
      if (bmq.bookmaker === bookmaker) continue;
      for (const q of bmq.quotes) {
        if (q.selectionType === selectionType && q.odds > 0) odds.push(q.odds);
      }
    }
    return odds;
  };

  for (const [bookmaker, quotes] of perBookmaker) {
    // This bookmaker's own highest price in the market — used below to tell a
    // house ceiling (repeated on purpose) from a pasted placeholder.
    const bookMax = Math.max(...quotes.map((q) => q.odds));
    const byValue = new Map<number, { param: string; selectionType: string }[]>();
    for (const q of quotes) {
      // Values >= 1000 are already covered by rule (i); <= 1 by impossible_odds.
      if (q.odds >= PLACEHOLDER_MIN_ODDS || q.odds <= 1) continue;
      if (!byValue.has(q.odds)) byValue.set(q.odds, []);
      byValue.get(q.odds)!.push({ param: q.param, selectionType: q.selectionType });
    }
    for (const [value, members] of byValue) {
      if (members.length < REPEATED_ODDS_MIN) continue;
      const medians: number[] = [];
      for (const m of members) {
        const peers = peerOdds(bookmaker, m.param, m.selectionType);
        if (peers.length > 0) medians.push(median(peers));
      }
      if (medians.length < 2) continue;
      const min = Math.min(...medians);
      const max = Math.max(...medians);
      if (min <= 0 || max / min - 1 <= REPEATED_PEER_VARIATION) continue;

      // House-ceiling guard: a bookmaker that truncates the tail of a grid
      // (etoto/fortuna capping correct-score/HT-FT families at 100, sts at
      // 500) prints its OWN maximum price repeatedly on those longshots.
      // That is a real, faithful price, not a pasted placeholder, so only
      // suppress when (a) the repeated value equals this bookmaker's own
      // ceiling AND (b) every peer prices those same cells at or above it —
      // a genuine placeholder also lands on favourites, so some peer median
      // there sits below the repeated value and the guard does not apply.
      if (value === bookMax && medians.every((m) => m >= value)) continue;

      const codes = [...new Set(members.map((m) => m.selectionType))].sort();
      out.push({
        bookmaker,
        param: "*",
        selectionType: codes.join(","),
        detector: "placeholder_odds",
        odds: value,
        expected: null,
        evidence: `odds ${value} repeated across ${members.length} selections while peer medians vary ${round2((max / min - 1) * 100)}%`,
      });
    }
  }
}

/**
 * Decimal shift: a quote >3x off its peer median whose power-of-ten shift
 * lands on the peers, or an integer that reads as a comma-decimal misparse
 * ("1,50" scraped as 150).
 */
function detectDecimalShift(input: IntegrityMarketInput, out: OddsIntegrityFlag[]): void {
  for (const param of input.params) {
    const pools = new Map<string, { bookmaker: string; odds: number }[]>();
    for (const bmq of param.bookmakers) {
      for (const q of bmq.quotes) {
        // Impossible and placeholder ranges are owned by their own detectors.
        if (!q.canonical || q.odds <= 1 || q.odds >= PLACEHOLDER_MIN_ODDS) continue;
        if (!pools.has(q.selectionType)) pools.set(q.selectionType, []);
        pools.get(q.selectionType)!.push({ bookmaker: bmq.bookmaker, odds: q.odds });
      }
    }
    for (const [selectionType, pool] of pools) {
      if (pool.length < DECIMAL_SHIFT_MIN_PEERS + 1) continue;
      for (const q of pool) {
        const peers = pool.filter((p) => p !== q).map((p) => p.odds);
        if (peers.length < DECIMAL_SHIFT_MIN_PEERS) continue;
        const peerMed = median(peers);
        if (peerMed <= 0) continue;
        const ratio = Math.max(q.odds / peerMed, peerMed / q.odds);
        if (ratio <= DECIMAL_SHIFT_RATIO) continue;

        const candidates = [q.odds * 10, q.odds / 10, q.odds / 100];
        const shiftMatch = candidates.find(
          (c) => Math.abs(c - peerMed) / peerMed <= DECIMAL_SHIFT_TOLERANCE,
        );
        // "1,50" misparsed as 150: a 3-digit integer whose /100 form is a
        // plausible odds value, while peers sit far away.
        const commaMisparse =
          Number.isInteger(q.odds) &&
          q.odds >= 100 &&
          q.odds / 100 >= 1.01 &&
          q.odds / 100 <= 9.99 &&
          q.odds > peerMed;

        if (shiftMatch === undefined && !commaMisparse) continue;
        out.push({
          bookmaker: q.bookmaker,
          param: param.param,
          selectionType,
          detector: "decimal_shift",
          odds: q.odds,
          expected: round2(peerMed),
          evidence:
            shiftMatch !== undefined
              ? `odds ${q.odds} looks decimal-shifted: ${round2(shiftMatch)} matches peer median ${round2(peerMed)}`
              : `odds ${q.odds} reads as ${(q.odds / 100).toFixed(2)} misparsed x100 (peer median ${round2(peerMed)})`,
        });
      }
    }
  }
}

/**
 * Collect complete, sane per-bookmaker odds vectors over the catalog
 * selections for one param. Vectors with odds outside (1, 1000) are dropped —
 * those quotes belong to impossible_odds / placeholder_odds.
 */
function completeVectors(
  param: IntegrityParamInput,
  selections: string[],
): { bookmaker: string; vector: number[] }[] {
  const result: { bookmaker: string; vector: number[] }[] = [];
  for (const bmq of param.bookmakers) {
    const bySel = new Map<string, number>();
    for (const q of bmq.quotes) {
      if (!bySel.has(q.selectionType)) bySel.set(q.selectionType, q.odds);
    }
    const vector: number[] = [];
    let complete = true;
    for (const sel of selections) {
      const odds = bySel.get(sel);
      if (odds === undefined || odds <= 1 || odds >= PLACEHOLDER_MIN_ODDS) {
        complete = false;
        break;
      }
      vector.push(odds);
    }
    if (complete) result.push({ bookmaker: bmq.bookmaker, vector });
  }
  return result;
}

/**
 * Axis swap: the bookmaker's odds vector matches a non-identity permutation
 * of the peer-median vector while the identity mapping is badly off.
 */
function detectAxisSwap(
  input: IntegrityMarketInput,
  selections: string[],
  out: OddsIntegrityFlag[],
): void {
  const perms = nonIdentityPermutations(selections.length);
  for (const param of input.params) {
    const vectors = completeVectors(param, selections);
    for (const { bookmaker, vector } of vectors) {
      const peers = vectors.filter((v) => v.bookmaker !== bookmaker);
      if (peers.length < AXIS_SWAP_MIN_PEERS) continue;
      const medianVector = selections.map((_, i) => median(peers.map((p) => p.vector[i])));
      if (medianVector.some((m) => m <= 0)) continue;

      const identityDevs = vector.map((v, i) => Math.abs(v - medianVector[i]) / medianVector[i]);
      const deviating = identityDevs.filter((d) => d > AXIS_SWAP_IDENTITY_DEV).length;
      if (deviating < AXIS_SWAP_MIN_DEV_COMPONENTS) continue;

      let best: { perm: number[]; totalDev: number } | null = null;
      for (const perm of perms) {
        let totalDev = 0;
        let fits = true;
        for (let i = 0; i < perm.length; i++) {
          const dev = Math.abs(vector[i] - medianVector[perm[i]]) / medianVector[perm[i]];
          if (dev > AXIS_SWAP_PERM_TOLERANCE) {
            fits = false;
            break;
          }
          totalDev += dev;
        }
        if (fits && (best === null || totalDev < best.totalDev)) best = { perm, totalDev };
      }
      if (!best) continue;

      const firstMoved = best.perm.findIndex((v, i) => v !== i);
      out.push({
        bookmaker,
        param: param.param,
        selectionType: selections[firstMoved],
        detector: "axis_swap",
        odds: vector[firstMoved],
        expected: round2(medianVector[firstMoved]),
        evidence: describePermutation(selections, best.perm),
      });
    }
  }
}

/**
 * Overround: sum of implied probabilities of a complete 2/3-way book outside
 * [0.95, 1.45]. Markets with overlapping outcomes legitimately sum outside
 * that band and are skipped: double-chance-style "_OR_" SELECTION codes
 * (sum ~2), compound "wins one of several ways" markets whose "_OR_" is in
 * the market TYPE code instead (e.g. HT_OR_FT_RESULT, WIN_OR_WIN_BY_2 —
 * confirmed structural, not a bug: 5 independent bookmakers agree on
 * HT_OR_FT_RESULT's overround ~1.5), and NON_EXHAUSTIVE_SELECTION_MARKETS
 * (independent per-team YES props with no priced "neither" branch).
 */
function detectOverround(
  input: IntegrityMarketInput,
  selections: string[],
  out: OddsIntegrityFlag[],
): void {
  if (selections.some((s) => s.includes("_OR_"))) return;
  if (input.marketType.includes("_OR_")) return;
  if (NON_EXHAUSTIVE_SELECTION_MARKETS.has(input.marketType)) return;
  for (const param of input.params) {
    for (const { bookmaker, vector } of completeVectors(param, selections)) {
      const sum = vector.reduce((acc, odds) => acc + 1 / odds, 0);
      if (sum >= OVERROUND_MIN && sum <= OVERROUND_MAX) continue;
      out.push({
        bookmaker,
        param: param.param,
        selectionType: "*",
        detector: "overround",
        odds: round4(sum),
        expected: null,
        evidence: `sum of implied probabilities ${round4(sum)} outside [${OVERROUND_MIN}, ${OVERROUND_MAX}] for ${selections.join("/")}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Run all §3.3 detectors on one market's fresh quotes. */
export function detectOddsIntegrity(input: IntegrityMarketInput): OddsIntegrityFlag[] {
  const flags: OddsIntegrityFlag[] = [];
  detectImpossibleOdds(input, flags);
  detectPlaceholderOdds(input, flags);
  detectDecimalShift(input, flags);

  const selections = input.catalogSelections;
  const isNWay =
    selections !== null &&
    !input.vocabExempt &&
    (selections.length === 2 || selections.length === 3);
  if (isNWay) {
    detectAxisSwap(input, selections, flags);
    detectOverround(input, selections, flags);
  }
  return flags;
}
