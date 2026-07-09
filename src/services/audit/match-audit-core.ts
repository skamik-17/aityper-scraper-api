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
import {
  detectOddsIntegrity,
  type IntegrityParamInput,
  type OddsIntegrityFlag,
} from "./odds-integrity.js";

export type { OddsIntegrityFlag } from "./odds-integrity.js";

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
  /** ISO timestamp of the scrape this entry comes from; absent → treated as fresh. */
  scrapedAt?: string;
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

/** Optional knobs for the analysis (spec §3.1, §3.4). */
export interface MatchAuditOpts {
  /**
   * Coverage baseline gate: returns true when the bookmaker is known to have
   * EVER offered that selection for that market type. Absent → all selection
   * gaps are flagged (today's behaviour).
   */
  coverage?: (bookmaker: string, marketType: string, selectionCode: string) => boolean;
  /**
   * Optional ISO reference time. When provided it joins each pool's
   * newest-scrape computation, so quotes >60 min older than `now` are stale
   * even when the whole pool is old (scraper-health signal).
   */
  now?: string;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export interface MatchMarketFlags {
  unknown_selection_entries: { bookmaker: string; param: string; count: number; rawMarketName: string }[];
  orphan_selection_entries: { bookmaker: string; param: string; codes: string[] }[];
  mixed_vocabulary: { canonical: string[]; rawish: string[] } | null;
  selection_gaps: { bookmaker: string; param: string; missing: string[] }[];
  odds_disagreements: {
    bookmaker: string;
    param: string;
    selectionType: string;
    odds: number;
    median: number;
    deviationPct: number;
    /** Deviation in implied-probability space, percent (spec §3.2). */
    impliedDevPct: number;
  }[];
  /** Zero-tolerance detector hits (spec §3.3); replaces the old impossible_odds. */
  odds_integrity: OddsIntegrityFlag[];
  /** Informational (severity weight 0); at most one entry per bookmaker per market. */
  stale_bookmakers: { bookmaker: string; ageMinutes: number }[];
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
  /** Total odds_integrity flag count across all markets (spec §3.3). */
  integrityViolations: number;
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

// _1H/_2H is a newer half-scoped suffix convention (e.g. PLAYER_OFFSIDES_1H,
// NEXT_CORNER_1H) that predates this regex; without it every such market's
// own half-mentioning raw names falsely misroute-hint against themselves.
const TYPE_HALF_RE = /HALF|_HT\b|^HT_|_1H\b|_2H\b/;
const TYPE_BTTS_RE = /BTTS|BOTH_TEAMS|BOTH_SCORE/;
// DOUBLE_CHANCE(_TOTAL) markets are themselves the "double chance + goals"
// combo the plus_combo hint looks for; without this they flag against
// themselves on every bookmaker.
const TYPE_COMBO_RE = /_AND_|COMBO|MULTI|1X2_|DOUBLE_CHANCE/;

/**
 * Catalog selection lists that are dynamic wildcard placeholders (the actual
 * codes are combinatorially generated player names, e.g. "K. Mbappe & O.
 * Dembele"), not a finite enumerable set. orphan_selection/mixed_vocabulary
 * checks must not flag every literal player-pair/trio string against these.
 */
const DYNAMIC_WILDCARD_SELECTIONS = new Set([
  JSON.stringify(["PLAYER_PAIR"]),
  JSON.stringify(["PLAYER_TRIO"]),
]);

function isDynamicWildcardCatalog(catalog: CatalogSnapshot | undefined): boolean {
  if (!catalog || catalog.selections.length === 0) return false;
  return DYNAMIC_WILDCARD_SELECTIONS.has(JSON.stringify(catalog.selections));
}

/** Quotes older than the pool's newest scrape by more than this are stale (§3.1). */
const STALE_AFTER_MS = 60 * 60 * 1000;

/** Implied-probability disagreement thresholds (§3.2). */
const DISAGREEMENT_MIN_POOL = 4;
const DISAGREEMENT_DEV_FAVOURITE = 0.35; // p_med >= 0.2 (odds <= 5)
const DISAGREEMENT_DEV_LONGSHOT = 0.6; // p_med < 0.2 — longshots disagree legitimately

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

interface FreshnessQuote {
  bookmaker: string;
  selectionType: string;
  odds: number;
  canonical: boolean;
  scrapedAtMs: number; // NaN when the entry carries no scrapedAt
}

function isVocabExempt(market: ApiMarket, catalog: CatalogSnapshot | undefined): boolean {
  const vt = market.viewType ?? catalog?.viewType ?? "";
  return VOCAB_EXEMPT_VIEW_TYPES.has(vt) || isDynamicWildcardCatalog(catalog);
}

// ---------------------------------------------------------------------------
// Per-market analysis
// ---------------------------------------------------------------------------

export function analyzeApiMarket(
  market: ApiMarket,
  lookup: CatalogLookup,
  opts?: MatchAuditOpts,
): MatchMarketFlags {
  const catalog = lookup(market.type);
  const vocabExempt = isVocabExempt(market, catalog);
  const nowMs = opts?.now ? Date.parse(opts.now) : NaN;

  const flags: MatchMarketFlags = {
    unknown_selection_entries: [],
    orphan_selection_entries: [],
    mixed_vocabulary: null,
    selection_gaps: [],
    odds_disagreements: [],
    odds_integrity: [],
    stale_bookmakers: [],
    misroute_hints: [],
    placeholder_names: [],
    param_anomalies: [],
    view_type_mismatch: null,
  };

  // Market-level stale tracking: at most one flag per bookmaker (max age wins).
  const staleByBookmaker = new Map<string, number>();
  const integrityParams: IntegrityParamInput[] = [];

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
    // --- every quote in this param, for freshness windowing + odds analysis
    const rawQuotes: FreshnessQuote[] = [];
    // --- canonical codes quoted per bookmaker, for gap detection
    const perBmCanonical = new Map<string, Set<string>>();

    for (const entry of param.bookmakers) {
      const raw = entry.rawMarketName ?? "";
      const scrapedAtMs = entry.scrapedAt ? Date.parse(entry.scrapedAt) : NaN;

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
        const isCatalogCode =
          sel.type !== "UNKNOWN" &&
          (catalogSelections ? catalogSelections.has(sel.type) : CANONICAL_CODE_RE.test(sel.type));

        rawQuotes.push({
          bookmaker: entry.bookmaker,
          selectionType: sel.type,
          odds: sel.odds,
          canonical: isCatalogCode,
          scrapedAtMs,
        });

        if (sel.type === "UNKNOWN") continue;
        renderedCodes.add(sel.type);

        if (!vocabExempt) {
          if (isCatalogCode) canonicalUsed.add(sel.type);
          else if (!CANONICAL_CODE_RE.test(sel.type)) rawishUsed.add(sel.type);

          if (catalogSelections && !catalogSelections.has(sel.type)) orphanCodes.push(sel.type);
        }

        if (isCatalogCode) bmCanonical.add(sel.type);
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
        if (peers < 2) continue;
        // Coverage gate (§3.4): only flag codes the bookmaker has EVER offered.
        if (opts?.coverage && !opts.coverage(bookmaker, market.type, code)) continue;
        missing.push(code);
      }
      if (missing.length > 0) {
        flags.selection_gaps.push({ bookmaker, param: param.value, missing: missing.sort() });
      }
    }

    // --- Freshness windowing per (param, selectionType) pool (§3.1)
    const bySelection = new Map<string, FreshnessQuote[]>();
    for (const q of rawQuotes) {
      if (!bySelection.has(q.selectionType)) bySelection.set(q.selectionType, []);
      bySelection.get(q.selectionType)!.push(q);
    }
    const freshQuotes: FreshnessQuote[] = [];
    for (const pool of bySelection.values()) {
      let newest = Number.isNaN(nowMs) ? -Infinity : nowMs;
      for (const q of pool) {
        if (!Number.isNaN(q.scrapedAtMs) && q.scrapedAtMs > newest) newest = q.scrapedAtMs;
      }
      for (const q of pool) {
        const stale =
          !Number.isNaN(q.scrapedAtMs) &&
          Number.isFinite(newest) &&
          newest - q.scrapedAtMs > STALE_AFTER_MS;
        if (stale) {
          const ageMinutes = Math.round((newest - q.scrapedAtMs) / 60000);
          staleByBookmaker.set(
            q.bookmaker,
            Math.max(staleByBookmaker.get(q.bookmaker) ?? 0, ageMinutes),
          );
        } else {
          freshQuotes.push(q);
        }
      }
    }

    // --- Odds disagreements per (param, selectionType) in implied-probability space (§3.2)
    const oddsPools = new Map<string, { bookmaker: string; odds: number }[]>();
    for (const q of freshQuotes) {
      if (!q.canonical || q.odds <= 1.0) continue;
      if (!oddsPools.has(q.selectionType)) oddsPools.set(q.selectionType, []);
      oddsPools.get(q.selectionType)!.push({ bookmaker: q.bookmaker, odds: q.odds });
    }
    for (const [selectionType, quotes] of oddsPools) {
      if (quotes.length < DISAGREEMENT_MIN_POOL) continue;
      const oddsMed = median(quotes.map((q) => q.odds));
      const pMed = median(quotes.map((q) => 1 / q.odds));
      if (oddsMed <= 0 || pMed <= 0) continue;
      const threshold = pMed >= 0.2 ? DISAGREEMENT_DEV_FAVOURITE : DISAGREEMENT_DEV_LONGSHOT;
      for (const q of quotes) {
        const impliedDev = Math.abs(1 / q.odds - pMed) / pMed;
        if (impliedDev <= threshold) continue;
        flags.odds_disagreements.push({
          bookmaker: q.bookmaker,
          param: param.value,
          selectionType,
          odds: q.odds,
          median: round2(oddsMed),
          deviationPct: Math.round((Math.abs(q.odds - oddsMed) / oddsMed) * 100),
          impliedDevPct: Math.round(impliedDev * 100),
        });
      }
    }

    // --- Fresh quotes feed the odds-integrity detectors (§3.3)
    const perBmFresh = new Map<string, { selectionType: string; odds: number; canonical: boolean }[]>();
    for (const q of freshQuotes) {
      if (!perBmFresh.has(q.bookmaker)) perBmFresh.set(q.bookmaker, []);
      perBmFresh.get(q.bookmaker)!.push({
        selectionType: q.selectionType,
        odds: q.odds,
        canonical: q.canonical,
      });
    }
    integrityParams.push({
      param: param.value,
      bookmakers: [...perBmFresh].map(([bookmaker, quotes]) => ({ bookmaker, quotes })),
    });
  }

  // Odds-integrity detectors (zero-tolerance class, §3.3)
  flags.odds_integrity = detectOddsIntegrity({
    catalogSelections: catalog && catalog.selections.length > 0 ? [...catalog.selections] : null,
    vocabExempt,
    marketType: market.type,
    params: integrityParams,
  });

  // Stale bookmakers: informational, one entry per bookmaker per market (§3.1)
  for (const [bookmaker, ageMinutes] of staleByBookmaker) {
    flags.stale_bookmakers.push({ bookmaker, ageMinutes });
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
        if (p.value === "base" || p.value === "") continue;
        // Team-scoped stat-range markets (e.g. TEAM_TOTAL_SHOTS) legitimately
        // prefix the line with the team side ("HOME:10.5"/"AWAY:3.5") so two
        // teams' lines don't collide in one parameter bucket — strip it
        // before checking numericity instead of flagging the convention itself.
        const numericPart = p.value.replace(/^(HOME|AWAY):/, "");
        if (Number.isNaN(parseFloat(numericPart))) {
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
  odds_integrity: 6,
  misroute_hint: 5,
  unknown_selection: 3,
  odds_disagreement: 2,
  orphan_selection: 2,
  mixed_vocabulary: 2,
  view_type_mismatch: 2,
  selection_gap: 1,
  placeholder_name: 1,
  param_anomaly: 1,
  stale_bookmaker: 0, // informational scraper-health signal only
};

export function severityScore(flags: MatchMarketFlags): number {
  let score = 0;
  score += flags.odds_integrity.length * SEVERITY_WEIGHTS.odds_integrity;
  score += flags.misroute_hints.length * SEVERITY_WEIGHTS.misroute_hint;
  score += flags.unknown_selection_entries.length * SEVERITY_WEIGHTS.unknown_selection;
  score += flags.odds_disagreements.length * SEVERITY_WEIGHTS.odds_disagreement;
  score += flags.orphan_selection_entries.length * SEVERITY_WEIGHTS.orphan_selection;
  score += (flags.mixed_vocabulary ? 1 : 0) * SEVERITY_WEIGHTS.mixed_vocabulary;
  score += (flags.view_type_mismatch ? 1 : 0) * SEVERITY_WEIGHTS.view_type_mismatch;
  score += flags.selection_gaps.length * SEVERITY_WEIGHTS.selection_gap;
  score += flags.placeholder_names.length * SEVERITY_WEIGHTS.placeholder_name;
  score += flags.param_anomalies.length * SEVERITY_WEIGHTS.param_anomaly;
  score += flags.stale_bookmakers.length * SEVERITY_WEIGHTS.stale_bookmaker;
  return score;
}

export function analyzeMatchResponse(
  data: NormalizedMarketsData,
  lookup: CatalogLookup,
  opts?: MatchAuditOpts,
): MatchAuditResult {
  const markets: MarketAuditEntry[] = [];
  const flagTotals: Record<string, number> = {};
  const culpritMatrix: Record<string, Record<string, number>> = {};
  let integrityViolations = 0;

  const bump = (kind: string, bookmaker: string | null, by = 1) => {
    flagTotals[kind] = (flagTotals[kind] ?? 0) + by;
    if (bookmaker) {
      if (!culpritMatrix[bookmaker]) culpritMatrix[bookmaker] = {};
      culpritMatrix[bookmaker][kind] = (culpritMatrix[bookmaker][kind] ?? 0) + by;
    }
  };

  for (const category of data.categories) {
    for (const market of category.markets) {
      const flags = analyzeApiMarket(market, lookup, opts);
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
      for (const f of flags.odds_disagreements) bump("odds_disagreement", f.bookmaker);
      for (const f of flags.odds_integrity) bump("odds_integrity", f.bookmaker);
      for (const f of flags.stale_bookmakers) bump("stale_bookmaker", f.bookmaker);
      integrityViolations += flags.odds_integrity.length;
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
      integrityViolations,
    },
  };
}
