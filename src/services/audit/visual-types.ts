/**
 * Types and pure helpers for the Betclic visual ground-truth audit step.
 * Mirrors ./types.ts (validators + tag extractors) but for the vision judge
 * that compares rendered screenshots against our normalized data.
 */

export type OddsMatch = "ok" | "gross_mismatch" | "drift";
export type FrontendRenderStatus = boolean | "unavailable";

export interface VisualVerdict {
  marketRef: string;
  selections_match: boolean;
  odds_match: OddsMatch;
  subject_correct: boolean;
  frontend_render_ok: FrontendRenderStatus;
  discrepancies: string[];
  confidence: number;
}

const VALID_ODDS_MATCH: OddsMatch[] = ["ok", "gross_mismatch", "drift"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isVisualVerdict(v: unknown): v is VisualVerdict {
  if (!isObject(v)) return false;
  if (typeof v.marketRef !== "string" || v.marketRef.length === 0) return false;
  if (typeof v.selections_match !== "boolean") return false;
  if (!VALID_ODDS_MATCH.includes(v.odds_match as OddsMatch)) return false;
  if (typeof v.subject_correct !== "boolean") return false;
  if (v.frontend_render_ok !== "unavailable" && typeof v.frontend_render_ok !== "boolean") return false;
  if (!Array.isArray(v.discrepancies) || !v.discrepancies.every((d) => typeof d === "string")) return false;
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) return false;
  return true;
}

/** A market is a visual mismatch when any ground-truth dimension fails. Drift is NOT a mismatch. */
export function isVisualMismatch(v: VisualVerdict): boolean {
  return (
    !v.selections_match ||
    v.odds_match === "gross_mismatch" ||
    !v.subject_correct ||
    v.frontend_render_ok === false
  );
}

/** Extract ALL <visual_verdict> blocks from one judge reply (one per market in a group). */
export function extractAllVisualVerdictBlocks(text: string): unknown[] {
  const results: unknown[] = [];
  const re = /<visual_verdict>\s*([\s\S]*?)\s*<\/visual_verdict>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      results.push(JSON.parse(m[1]));
    } catch {
      // Skip unparseable block; orchestrator handles missing markets.
    }
  }
  return results;
}

// --- Capture manifest (written by betclic-visual-capture.ts) ---

export interface BetclicGroupCapture {
  groupName: string;
  file: string; // filename relative to the manifest dir, e.g. "betclic__liczba-goli.png"
  markets: string[]; // raw market names that belong to this Betclic group
}

export interface FrontSectionCapture {
  category: string; // "all" in v1 (whole-page); per-category later
  file: string; // e.g. "front__all.png"
}

export interface VisualCaptureManifest {
  matchId: string; // Betclic matchId
  frontMatchId: string | null;
  capturedAt: string; // ISO
  frontendAvailable: boolean;
  betclicGroups: BetclicGroupCapture[];
  frontSections: FrontSectionCapture[];
}

// --- Pure helpers used by the capture script ---

/** Filesystem-safe slug: lowercased, diacritics stripped, non-alphanumerics -> "-". */
export function safeFileSlug(name: string): string {
  const slug = name
    // Polish "ł"/"Ł" are precomposed (U+0142/U+0141) and do NOT decompose under
    // NFD, so map them explicitly before stripping combining marks.
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "unnamed";
}

/** Group raw market names by Betclic groupName, preserving first-seen order. */
export function groupMarketsByGroupName(
  markets: { name: string; groupName: string }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of markets) {
    const key = m.groupName && m.groupName.trim() ? m.groupName.trim() : "(bez grupy)";
    const arr = out.get(key);
    if (arr) arr.push(m.name);
    else out.set(key, [m.name]);
  }
  return out;
}
