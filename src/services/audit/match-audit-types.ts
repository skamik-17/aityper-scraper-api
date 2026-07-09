/**
 * Types and runtime validators for the cross-bookmaker match audit
 * (/audit-match): data-judge verdicts and frontend visual-judge verdicts.
 * Mirrors the conventions of ./types.ts (per-bookmaker pipeline).
 */

// ---------------------------------------------------------------------------
// Data judge (cross-bookmaker) verdict
// ---------------------------------------------------------------------------

export type MatchVerdictLevel = "OK" | "MINOR" | "MAJOR" | "BROKEN" | "parse_failed";

export type MatchIssueKind =
  | "misrouted_entry"
  | "selection_gap"
  | "unknown_selection"
  | "odds_disagreement"
  | "placeholder_name"
  | "mixed_vocabulary"
  | "param_anomaly"
  | "view_type_mismatch"
  | "silent_merge"
  | "nonsense"
  | "other";

/** Where the fix belongs: a bookmaker's normalizer, its scraper, the catalog, or the grouper. */
export type MatchIssueRoute =
  | `bookmaker:${string}`
  | `scraper:${string}`
  | "catalog"
  | "grouper";

export interface MatchIssue {
  kind: MatchIssueKind;
  bookmaker: string | null;
  detail: string;
  route: MatchIssueRoute;
  suggested_action: string;
}

export interface MatchJudgeVerdict {
  marketKey: string;
  verdict: MatchVerdictLevel;
  confidence: number;
  issues: MatchIssue[];
}

const VALID_LEVELS: MatchVerdictLevel[] = ["OK", "MINOR", "MAJOR", "BROKEN", "parse_failed"];
const VALID_KINDS: MatchIssueKind[] = [
  "misrouted_entry",
  "selection_gap",
  "unknown_selection",
  "odds_disagreement",
  "placeholder_name",
  "mixed_vocabulary",
  "param_anomaly",
  "view_type_mismatch",
  "silent_merge",
  "nonsense",
  "other",
];
const ROUTE_RE = /^(bookmaker:[a-z0-9_-]+|scraper:[a-z0-9_-]+|catalog|grouper)$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isMatchIssue(v: unknown): v is MatchIssue {
  if (!isObject(v)) return false;
  if (!VALID_KINDS.includes(v.kind as MatchIssueKind)) return false;
  if (v.bookmaker !== null && typeof v.bookmaker !== "string") return false;
  if (typeof v.detail !== "string") return false;
  if (typeof v.route !== "string" || !ROUTE_RE.test(v.route)) return false;
  if (typeof v.suggested_action !== "string") return false;
  return true;
}

export function isMatchJudgeVerdict(v: unknown): v is MatchJudgeVerdict {
  if (!isObject(v)) return false;
  if (typeof v.marketKey !== "string" || v.marketKey.length === 0) return false;
  if (!VALID_LEVELS.includes(v.verdict as MatchVerdictLevel)) return false;
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) return false;
  if (!Array.isArray(v.issues) || !v.issues.every(isMatchIssue)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Visual judge verdict (frontend render ground truth)
// ---------------------------------------------------------------------------

export interface MatchVisualVerdict {
  marketRef: string;
  view_type_ok: boolean;
  selections_rendered: boolean;
  lines_ok: boolean;
  no_placeholder_leak: boolean;
  market_makes_sense: boolean;
  discrepancies: string[];
  confidence: number;
}

export function isMatchVisualVerdict(v: unknown): v is MatchVisualVerdict {
  if (!isObject(v)) return false;
  if (typeof v.marketRef !== "string" || v.marketRef.length === 0) return false;
  for (const key of [
    "view_type_ok",
    "selections_rendered",
    "lines_ok",
    "no_placeholder_leak",
    "market_makes_sense",
  ] as const) {
    if (typeof v[key] !== "boolean") return false;
  }
  if (!Array.isArray(v.discrepancies) || !v.discrepancies.every((d) => typeof d === "string")) return false;
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) return false;
  return true;
}

/** A market fails the visual audit when any ground-truth dimension is false. */
export function isVisualFail(v: MatchVisualVerdict): boolean {
  return (
    !v.view_type_ok ||
    !v.selections_rendered ||
    !v.lines_ok ||
    !v.no_placeholder_leak ||
    !v.market_makes_sense
  );
}

// ---------------------------------------------------------------------------
// Tag extractors
// ---------------------------------------------------------------------------

function extractTaggedJson(text: string, tag: string): unknown[] {
  const results: unknown[] = [];
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      results.push(JSON.parse(m[1]));
    } catch {
      // Skip unparseable block; orchestrator retries or records parse_failed.
    }
  }
  return results;
}

export function extractMatchVerdictBlocks(text: string): unknown[] {
  return extractTaggedJson(text, "match_verdict");
}

export function extractMatchVisualVerdictBlocks(text: string): unknown[] {
  return extractTaggedJson(text, "match_visual_verdict");
}
