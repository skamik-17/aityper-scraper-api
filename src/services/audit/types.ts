/**
 * Shared types and runtime validators for the Betclic audit pipeline.
 * Used by prep-audit script, judge subagent reply parsing, fixer reply parsing,
 * and the final report writer.
 */

import type { RelatedCodeSummary } from "./family-codes.js";

// ---------------------------------------------------------------------------
// Mechanical flags computed during data prep
// ---------------------------------------------------------------------------

export interface MechanicalFlags {
  recognized: boolean;
  collision: boolean;
  unknown_count: number;
  orphan_codes: string[];
  duplicate_codes: boolean;
  count_mismatch: boolean;
  missing_expected: boolean;
  selection_label_count: number;
  selection_odds_range: { min: number; max: number };
  param_format: "decimal_comma" | "decimal_dot" | "signed_integer" | "team_side" | "none";
}

// ---------------------------------------------------------------------------
// Prep-audit JSON shape (intermediate, written to docs/betclic-audit/.tmp/)
// ---------------------------------------------------------------------------

export interface MatchContextRow {
  raw_name: string;
  marketCode: string;
  selection_count: number;
  paramValue: string | null;
}

export interface CatalogEntrySnapshot {
  code: string;
  labels: { pl: string };
  selections: string[];
  viewType: string;
  hasParameter: boolean;
}

export interface PrepMarketEntry {
  index: number;
  raw: {
    name: string;
    groupName: string;
    groupId: string;
    bookmakerMarketId: string;
    selections: { name: string; odds: number }[];
  };
  normalized: {
    marketCode: string;
    marketKey: string;
    paramValue: string | null;
    matchedBy: string | null;
    selections: { label: string; code: string; odds: number }[];
  };
  catalogEntry: CatalogEntrySnapshot | null;
  relatedCodes: RelatedCodeSummary[];
  mechanicalFlags: MechanicalFlags;
}

export interface PrepAuditOutput {
  meta: {
    matchId: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    fetchedAt: string;
    rawAllTabs: number;
    rawDeduped: number;
    recognized: number;
    unrecognized: number;
  };
  matchContext: MatchContextRow[];
  markets: PrepMarketEntry[];
}

// ---------------------------------------------------------------------------
// Judge verdict (parsed from <verdict>{...}</verdict> in subagent reply)
// ---------------------------------------------------------------------------

export type VerdictLevel = "OK" | "MINOR" | "MAJOR" | "BROKEN" | "parse_failed";
export type VerdictCategory =
  | "wrong_market_code"
  | "wrong_selection_mapping"
  | "wrong_view_type"
  | "missing_param"
  | "wrong_param"
  | "name_mismatch"
  | "selection_count_unexpected"
  | "catalog_entry_missing"
  | "other";

export interface SuggestedFix {
  file: "market-catalog.ts" | "betclic-normalizer.ts" | "betclic-selection-mapper";
  change_type:
    | "add_alias"
    | "add_code_entry"
    | "change_view_type"
    | "add_selection_code"
    | "change_normalization_target"
    | "other";
  description: string;
  patch_hint: string;
}

export interface JudgeVerdict {
  verdict: VerdictLevel;
  confidence: number;
  category: VerdictCategory;
  reasoning: string;
  suggested_fix: SuggestedFix | null;
}

const VALID_VERDICTS: VerdictLevel[] = ["OK", "MINOR", "MAJOR", "BROKEN", "parse_failed"];
const VALID_CATEGORIES: VerdictCategory[] = [
  "wrong_market_code",
  "wrong_selection_mapping",
  "wrong_view_type",
  "missing_param",
  "wrong_param",
  "name_mismatch",
  "selection_count_unexpected",
  "catalog_entry_missing",
  "other",
];
const VALID_FIX_FILES = ["market-catalog.ts", "betclic-normalizer.ts", "betclic-selection-mapper"] as const;
const VALID_FIX_CHANGE_TYPES = [
  "add_alias",
  "add_code_entry",
  "change_view_type",
  "add_selection_code",
  "change_normalization_target",
  "other",
] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isJudgeVerdict(v: unknown): v is JudgeVerdict {
  if (!isObject(v)) return false;
  if (!VALID_VERDICTS.includes(v.verdict as VerdictLevel)) return false;
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) return false;
  if (!VALID_CATEGORIES.includes(v.category as VerdictCategory)) return false;
  if (typeof v.reasoning !== "string") return false;
  if (v.suggested_fix !== null) {
    if (!isObject(v.suggested_fix)) return false;
    const f = v.suggested_fix;
    if (!VALID_FIX_FILES.includes(f.file as typeof VALID_FIX_FILES[number])) return false;
    if (!VALID_FIX_CHANGE_TYPES.includes(f.change_type as typeof VALID_FIX_CHANGE_TYPES[number])) return false;
    if (typeof f.description !== "string") return false;
    if (typeof f.patch_hint !== "string") return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fix result (parsed from <fix_result>{...}</fix_result> in subagent reply)
// ---------------------------------------------------------------------------

export type FixStatus = "applied" | "failed" | "noop";

export interface FixResult {
  status: FixStatus;
  commit: string | null;
  files: string[];
  reason: string | null;
}

const VALID_FIX_STATUSES: FixStatus[] = ["applied", "failed", "noop"];

export function isFixResult(v: unknown): v is FixResult {
  if (!isObject(v)) return false;
  if (!VALID_FIX_STATUSES.includes(v.status as FixStatus)) return false;
  if (v.commit !== null && typeof v.commit !== "string") return false;
  if (!Array.isArray(v.files)) return false;
  if (!v.files.every((f) => typeof f === "string")) return false;
  if (v.reason !== null && typeof v.reason !== "string") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Final audit report (committed JSON)
// ---------------------------------------------------------------------------

export interface AuditReportMeta {
  schemaVersion: 1;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  runAt: string;
  judge: { model: string; via: "subagent" };
  autoFixEnabled: boolean;
  autoFixThreshold: number;
  autoFixBranch: string | null;
}

export interface AuditReportSummary {
  rawAllTabs: number;
  rawDeduped: number;
  evaluated: number;
  verdicts: Record<VerdictLevel, number>;
  byCategory: Partial<Record<VerdictCategory, number>>;
  autoFix: {
    applied: number;
    failed: number;
    skipped_low_confidence: number;
    skipped_no_suggestion: number;
    skipped_noop: number;
  };
}

export interface AuditReportEntry {
  marketIndex: number;
  rawName: string;
  marketCode: string;
  marketKey: string;
  judge: JudgeVerdict;
  mechanicalFlags: MechanicalFlags;
  autoFixResult: FixResult | null;
}

export interface AuditReport {
  meta: AuditReportMeta;
  summary: AuditReportSummary;
  verdicts: AuditReportEntry[];
}

// ---------------------------------------------------------------------------
// Verdict tag extraction (used by orchestrator-side parsing helper, but
// belongs here so judge-subagent's expected output format is documented in code)
// ---------------------------------------------------------------------------

export function extractVerdictBlock(text: string): unknown | null {
  const match = text.match(/<verdict>\s*([\s\S]*?)\s*<\/verdict>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function extractFixResultBlock(text: string): unknown | null {
  const match = text.match(/<fix_result>\s*([\s\S]*?)\s*<\/fix_result>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
