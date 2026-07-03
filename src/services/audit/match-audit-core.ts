/**
 * Cross-bookmaker match audit — mechanical analysis core.
 *
 * Operates on the JSON returned by our own API (the frontend's source of truth):
 *   GET /api/matches/:homeTeam/:awayTeam/normalized-markets?league=<slug>
 *
 * Pure functions only — no I/O. The prep script (scripts/match-audit-prep.ts)
 * fetches the API, resolves catalog entries, and feeds everything here.
 */

import { isPlaceholderName } from "./discovery-analysis.js";

// ---------------------------------------------------------------------------
// Input shape (mirrors the HTTP response; kept local so the audit validates
// the wire format rather than backend-internal types)
// ---------------------------------------------------------------------------

export interface ApiSelection {
  type: string;
  odds: number;
  label?: string;
}

export interface ApiBookmakerEntry {
  bookmaker: string;
  bookmakerName: string;
  rawMarketName?: string;
  selections: ApiSelection[];
}

export interface ApiParameter {
  value: string;
  label: string;
  bookmakers: ApiBookmakerEntry[];
}

export interface ApiMarket {
  marketKey: string;
  type: string;
  category: string;
  subCategory?: string;
  label: string;
  description?: string;
  displayOrder?: number;
  viewType?: string;
  parameters: ApiParameter[];
  defaultParameter?: string;
  hasParameters: boolean;
}

export interface ApiCategory {
  name: string;
  label: string;
  order: number;
  markets: ApiMarket[];
}

export interface NormalizedMarketsData {
  match: { homeTeam: string; awayTeam: string; league: string };
  categories: ApiCategory[];
  stats: {
    totalMarkets: number;
    normalizedMarkets: number;
    coveragePercent: number;
    bookmakersWithOdds: string[];
  };
}

/** Minimal catalog view the core needs; prep resolves it from market-catalog. */
export interface CatalogSnapshot {
  selections: string[];
  viewType: string;
  hasParameter: boolean;
  labelPl: string;
}

export type CatalogLookup = (code: string) => CatalogSnapshot | undefined;

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export interface MatchMarketFlags {
  unknown_selection_entries: { bookmaker: string; param: string; count: number; rawMarketName: string }[];
  orphan_selection_entries: { bookmaker: string; param: string; codes: string[] }[];
  mixed_vocabulary: { canonical: string[]; rawish: string[] } | null;
  selection_gaps: { bookmaker: string; param: string; missing: string[] }[];
  odds_outliers: {
    bookmaker: string;
    param: string;
    selectionType: string;
    odds: number;
    median: number;
    deviationPct: number;
  }[];
  impossible_odds: { bookmaker: string; param: string; selectionType: string; odds: number }[];
  misroute_hints: { bookmaker: string; param: string; rawMarketName: string; hints: string[] }[];
  placeholder_names: { bookmaker: string; rawMarketName: string }[];
  param_anomalies: string[]; // "base_visible" | "non_numeric_param:<value>"
  view_type_mismatch: { viewType: string; expected: number; actual: number; codes: string[] } | null;
}

export interface MarketAuditEntry {
  marketRef: string; // "<category>/<marketKey>"
  marketKey: string;
  type: string;
  category: string;
  label: string;
  viewType?: string;
  paramCount: number;
  bookmakerCount: number;
  flags: MatchMarketFlags;
  severity: number;
}

export interface MatchAuditSummary {
  totalMarkets: number;
  totalFlagged: number;
  flagTotals: Record<string, number>;
  culpritMatrix: Record<string, Record<string, number>>; // bookmaker -> issueKind -> count
}

export interface MatchAuditResult {
  markets: MarketAuditEntry[];
  summary: MatchAuditSummary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CANONICAL_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

/** viewTypes whose selection codes are inherently dynamic (scores, players). */
const VOCAB_EXEMPT_VIEW_TYPES = new Set([
  "SCORE_GRID",
  "PLAYER_DROPDOWN",
  "PLAYER_STAT_LINES",
]);

const BUTTON_VIEW_EXPECTED: Record<string, number> = {
  TRIPLE_BUTTONS: 3,
  BINARY_BUTTONS: 2,
  SINGLE_SELECTION: 1,
};

/** Raw-name markers that suggest the entry belongs to a different market. */
const HALF_HINT_RE = /(?:^|[\s(])(?:[12]\.\s*po[łl]ow|pierwsz[aą]\s+po[łl]ow|drug[aą]\s+po[łl]ow|do\s+przerwy|po[łl]owa\b)/i;
const BTTS_COMBO_HINT_RE = /obie\s+dru[żz]yny\s+strzel|btts/i;
const PLUS_COMBO_HINT_RE = /\s\+\s|\b1x2\s*\+|\bi\s+(?:liczba|suma)\s+goli/i;

const TYPE_HALF_RE = /HALF|_HT\b|^HT_/;
const TYPE_BTTS_RE = /BTTS|BOTH_TEAMS|BOTH_SCORE/;
const TYPE_COMBO_RE = /_AND_|COMBO|MULTI|1X2_/;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function isVocabExempt(market: ApiMarket, catalog: CatalogSnapshot | undefined): boolean {
  const vt = market.viewType ?? catalog?.viewType ?? "";
  return VOCAB_EXEMPT_VIEW_TYPES.has(vt);
}

// ---------------------------------------------------------------------------
// Per-market analysis
// ---------------------------------------------------------------------------

export function analyzeApiMarket(market: ApiMarket, lookup: CatalogLookup): MatchMarketFlags {
  const catalog = lookup(market.type);
  const vocabExempt = isVocabExempt(market, catalog);

  const flags: MatchMarketFlags = {
    unknown_selection_entries: [],
    orphan_selection_entries: [],
    mixed_vocabulary: null,
    selection_gaps: [],
    odds_outliers: [],
    impossible_odds: [],
    misroute_hints: [],
    placeholder_names: [],
    param_anomalies: [],
    view_type_mismatch: null,
  };

  const seenPlaceholders = new Set<string>();
  const canonicalUsed = new Set<string>();
  const rawishUsed = new Set<string>();
  // Every distinct non-UNKNOWN code across all params — the UI renders a column
  // per distinct type (orphans included), so the viewType check uses this set.
  const renderedCodes = new Set<string>();

  const typeIsHalf = TYPE_HALF_RE.test(market.type);
  const typeIsBtts = TYPE_BTTS_RE.test(market.type);
  const typeIsCombo = TYPE_COMBO_RE.test(market.type) || typeIsBtts;

  const catalogSelections = catalog && catalog.selections.length > 0 ? new Set(catalog.selections) : null;

  for (const param of market.parameters) {
    // --- per (param, selectionType) odds pools for outlier detection
    const oddsPools = new Map<string, { bookmaker: string; odds: number }[]>();
    // --- canonical codes quoted per bookmaker, for gap detection
    const perBmCanonical = new Map<string, Set<string>>();

    for (const entry of param.bookmakers) {
      const raw = entry.rawMarketName ?? "";

      // UNKNOWN selections
      const unknownCount = entry.selections.filter((s) => s.type === "UNKNOWN").length;
      if (unknownCount > 0) {
        flags.unknown_selection_entries.push({
          bookmaker: entry.bookmaker,
          param: param.value,
          count: unknownCount,
          rawMarketName: raw,
        });
      }

      // Placeholder raw names (unique per bookmaker+name)
      if (raw && isPlaceholderName(raw)) {
        const key = `${entry.bookmaker}|${raw}`;
        if (!seenPlaceholders.has(key)) {
          seenPlaceholders.add(key);
          flags.placeholder_names.push({ bookmaker: entry.bookmaker, rawMarketName: raw });
        }
      }

      // Misroute hints
      if (raw) {
        const hints: string[] = [];
        if (HALF_HINT_RE.test(raw) && !typeIsHalf) hints.push("half");
        if (BTTS_COMBO_HINT_RE.test(raw) && !typeIsBtts) hints.push("btts_combo");
        if (PLUS_COMBO_HINT_RE.test(raw) && !typeIsCombo) hints.push("plus_combo");
        if (hints.length > 0) {
          flags.misroute_hints.push({
            bookmaker: entry.bookmaker,
            param: param.value,
            rawMarketName: raw,
            hints,
          });
        }
      }

      // Selection-level checks
      const orphanCodes: string[] = [];
      if (!perBmCanonical.has(entry.bookmaker)) perBmCanonical.set(entry.bookmaker, new Set());
      const bmCanonical = perBmCanonical.get(entry.bookmaker)!;

      for (const sel of entry.selections) {
        if (sel.odds > 0 && sel.odds <= 1.0) {
          flags.impossible_odds.push({
            bookmaker: entry.bookmaker,
            param: param.value,
            selectionType: sel.type,
            odds: sel.odds,
          });
        }
        if (sel.type === "UNKNOWN") continue;
        renderedCodes.add(sel.type);

        const isCatalogCode = catalogSelections ? catalogSelections.has(sel.type) : CANONICAL_CODE_RE.test(sel.type);

        if (!vocabExempt) {
          if (isCatalogCode) canonicalUsed.add(sel.type);
          else if (!CANONICAL_CODE_RE.test(sel.type)) rawishUsed.add(sel.type);

          if (catalogSelections && !catalogSelections.has(sel.type)) orphanCodes.push(sel.type);
        }

        if (isCatalogCode) {
          bmCanonical.add(sel.type);
          if (sel.odds > 1.0) {
            const poolKey = sel.type;
            if (!oddsPools.has(poolKey)) oddsPools.set(poolKey, []);
            oddsPools.get(poolKey)!.push({ bookmaker: entry.bookmaker, odds: sel.odds });
          }
        }
      }

      if (orphanCodes.length > 0) {
        flags.orphan_selection_entries.push({
          bookmaker: entry.bookmaker,
          param: param.value,
          codes: orphanCodes,
        });
      }
    }

    // Selection gaps: canonical codes quoted by >=2 OTHER bookmakers but absent here
    for (const [bookmaker, own] of perBmCanonical) {
      if (own.size === 0 && param.bookmakers.find((b) => b.bookmaker === bookmaker)!.selections.every((s) => s.type === "UNKNOWN")) {
        // fully-UNKNOWN entries are already reported; a gap list of "everything" adds noise
        continue;
      }
      const missing: string[] = [];
      for (const [code, quotes] of countCanonicalQuotes(perBmCanonical)) {
        if (own.has(code)) continue;
        const peers = quotes - 0; // quotes counts bookmakers having the code; own doesn't have it
        if (peers >= 2) missing.push(code);
      }
      if (missing.length > 0) {
        flags.selection_gaps.push({ bookmaker, param: param.value, missing: missing.sort() });
      }
    }

    // Odds outliers per (param, selectionType)
    for (const [selectionType, quotes] of oddsPools) {
      if (quotes.length < 4) continue;
      const med = median(quotes.map((q) => q.odds));
      if (med <= 0) continue;
      for (const q of quotes) {
        const dev = Math.abs(q.odds - med) / med;
        if (dev > 0.4) {
          flags.odds_outliers.push({
            bookmaker: q.bookmaker,
            param: param.value,
            selectionType,
            odds: q.odds,
            median: Math.round(med * 100) / 100,
            deviationPct: Math.round(dev * 100),
          });
        }
      }
    }
  }

  // Mixed vocabulary (market-level)
  if (!vocabExempt && canonicalUsed.size > 0 && rawishUsed.size > 0) {
    flags.mixed_vocabulary = {
      canonical: [...canonicalUsed].sort(),
      rawish: [...rawishUsed].sort(),
    };
  }

  // Param anomalies
  if (market.parameters.length > 1) {
    if (market.parameters.some((p) => p.value === "base")) {
      flags.param_anomalies.push("base_visible");
    }
    const vt = market.viewType ?? catalog?.viewType ?? "";
    if (vt === "PARAMETER_SLIDER" || vt === "STAT_RANGE") {
      for (const p of market.parameters) {
        if (p.value !== "base" && p.value !== "" && Number.isNaN(parseFloat(p.value))) {
          flags.param_anomalies.push(`non_numeric_param:${p.value}`);
        }
      }
    }
  }

  // viewType vs rendered selection-column count (button views only)
  const vt = market.viewType ?? catalog?.viewType ?? "";
  const expected = BUTTON_VIEW_EXPECTED[vt];
  if (expected !== undefined && renderedCodes.size > 0 && renderedCodes.size !== expected) {
    flags.view_type_mismatch = {
      viewType: vt,
      expected,
      actual: renderedCodes.size,
      codes: [...renderedCodes].sort(),
    };
  }

  return flags;
}

/** Count, per canonical code, how many bookmakers quote it (within one param). */
function countCanonicalQuotes(perBm: Map<string, Set<string>>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const codes of perBm.values()) {
    for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Severity + match-level aggregation
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<string, number> = {
  misroute_hint: 5,
  unknown_selection: 3,
  odds_outlier: 3,
  impossible_odds: 4,
  orphan_selection: 2,
  mixed_vocabulary: 2,
  view_type_mismatch: 2,
  selection_gap: 1,
  placeholder_name: 1,
  param_anomaly: 1,
};

export function severityScore(flags: MatchMarketFlags): number {
  let score = 0;
  score += flags.misroute_hints.length * SEVERITY_WEIGHTS.misroute_hint;
  score += flags.unknown_selection_entries.length * SEVERITY_WEIGHTS.unknown_selection;
  score += flags.odds_outliers.length * SEVERITY_WEIGHTS.odds_outlier;
  score += flags.impossible_odds.length * SEVERITY_WEIGHTS.impossible_odds;
  score += flags.orphan_selection_entries.length * SEVERITY_WEIGHTS.orphan_selection;
  score += (flags.mixed_vocabulary ? 1 : 0) * SEVERITY_WEIGHTS.mixed_vocabulary;
  score += (flags.view_type_mismatch ? 1 : 0) * SEVERITY_WEIGHTS.view_type_mismatch;
  score += flags.selection_gaps.length * SEVERITY_WEIGHTS.selection_gap;
  score += flags.placeholder_names.length * SEVERITY_WEIGHTS.placeholder_name;
  score += flags.param_anomalies.length * SEVERITY_WEIGHTS.param_anomaly;
  return score;
}

export function analyzeMatchResponse(
  data: NormalizedMarketsData,
  lookup: CatalogLookup,
): MatchAuditResult {
  const markets: MarketAuditEntry[] = [];
  const flagTotals: Record<string, number> = {};
  const culpritMatrix: Record<string, Record<string, number>> = {};

  const bump = (kind: string, bookmaker: string | null, by = 1) => {
    flagTotals[kind] = (flagTotals[kind] ?? 0) + by;
    if (bookmaker) {
      if (!culpritMatrix[bookmaker]) culpritMatrix[bookmaker] = {};
      culpritMatrix[bookmaker][kind] = (culpritMatrix[bookmaker][kind] ?? 0) + by;
    }
  };

  for (const category of data.categories) {
    for (const market of category.markets) {
      const flags = analyzeApiMarket(market, lookup);
      const bookmakers = new Set<string>();
      for (const p of market.parameters) for (const b of p.bookmakers) bookmakers.add(b.bookmaker);

      markets.push({
        marketRef: `${category.name}/${market.marketKey}`,
        marketKey: market.marketKey,
        type: market.type,
        category: category.name,
        label: market.label,
        viewType: market.viewType,
        paramCount: market.parameters.length,
        bookmakerCount: bookmakers.size,
        flags,
        severity: severityScore(flags),
      });

      for (const f of flags.misroute_hints) bump("misroute_hint", f.bookmaker);
      for (const f of flags.unknown_selection_entries) bump("unknown_selection", f.bookmaker);
      for (const f of flags.odds_outliers) bump("odds_outlier", f.bookmaker);
      for (const f of flags.impossible_odds) bump("impossible_odds", f.bookmaker);
      for (const f of flags.orphan_selection_entries) bump("orphan_selection", f.bookmaker);
      for (const f of flags.selection_gaps) bump("selection_gap", f.bookmaker);
      for (const f of flags.placeholder_names) bump("placeholder_name", f.bookmaker);
      if (flags.mixed_vocabulary) bump("mixed_vocabulary", null);
      if (flags.view_type_mismatch) bump("view_type_mismatch", null);
      for (const _a of flags.param_anomalies) bump("param_anomaly", null);
    }
  }

  markets.sort((a, b) => b.severity - a.severity);

  return {
    markets,
    summary: {
      totalMarkets: markets.length,
      totalFlagged: markets.filter((m) => m.severity > 0).length,
      flagTotals,
      culpritMatrix,
    },
  };
}
