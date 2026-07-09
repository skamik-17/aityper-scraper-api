/**
 * Issue fingerprint + ledger registry module (Audit Process v2, SPEC §1–§2).
 *
 * The fingerprint core is pure (no I/O). Registry load/save helpers live at
 * the bottom of this file as separate exports so the core stays pure.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Flag kinds
// ---------------------------------------------------------------------------

/** Mechanical flag kinds produced by match-audit-core / odds-integrity. */
export type MechanicalFlagKind =
  | "selection_gap"
  | "odds_disagreement"
  | "odds_integrity"
  | "unknown_selection"
  | "orphan_selection"
  | "misroute_hint"
  | "mixed_vocabulary"
  | "param_anomaly"
  | "placeholder_name"
  | "view_type_mismatch"
  | "stale_bookmaker";

/** Ledgered LLM-judge issues that have no mechanical flag. */
export type JudgeFlagKind = `judge_issue:${string}`;

export type FlagKind = MechanicalFlagKind | JudgeFlagKind;

/** Kinds that are market-level: their fingerprint carries bookmaker = null. */
export const MARKET_LEVEL_KINDS: ReadonlySet<string> = new Set([
  "mixed_vocabulary",
  "view_type_mismatch",
  "param_anomaly",
]);

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

export interface IssueFingerprint {
  /** "<category>/<marketKey>" as in MarketAuditEntry. */
  marketRef: string;
  /** null for market-level kinds (mixed_vocabulary, view_type_mismatch, param_anomaly). */
  bookmaker: string | null;
  kind: FlagKind;
  /** Canonicalized per-kind; NEVER contains odds values or param values. */
  evidence: string;
}

/** sha1(`${marketRef}|${bookmaker ?? ""}|${kind}|${evidence}`).slice(0, 12) */
export type FingerprintId = string;

export function computeFingerprintId(fp: IssueFingerprint): FingerprintId {
  const material = `${fp.marketRef}|${fp.bookmaker ?? ""}|${fp.kind}|${fp.evidence}`;
  return createHash("sha1").update(material, "utf8").digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Per-kind evidence canonicalization (SPEC §1 table)
// ---------------------------------------------------------------------------

/**
 * Discriminated evidence input, one variant per flag kind. Canonicalization
 * MUST be stable across scrapes — never include odds, params or timestamps.
 */
export type EvidenceInput =
  | { kind: "selection_gap"; missingCodes: string[] }
  | { kind: "odds_disagreement"; selectionType: string }
  | { kind: "odds_integrity"; detector: string; selectionType: string }
  | { kind: "unknown_selection"; rawMarketName: string }
  | { kind: "orphan_selection"; orphanCodes: string[] }
  | { kind: "misroute_hint"; rawMarketName: string }
  | { kind: "mixed_vocabulary"; rawish: string[] }
  | { kind: "param_anomaly"; anomalyType: string }
  | { kind: "placeholder_name"; rawMarketName: string }
  | { kind: "view_type_mismatch"; viewType: string }
  | { kind: "stale_bookmaker" }
  | { kind: "judge_issue"; judgeKind: string; evidence: string };

function sortedJoin(items: string[]): string {
  return [...items].map((s) => s.trim()).sort().join(",");
}

/** Canonicalize evidence per the SPEC §1 table. */
export function canonicalizeEvidence(input: EvidenceInput): string {
  switch (input.kind) {
    case "selection_gap":
      return sortedJoin(input.missingCodes);
    case "odds_disagreement":
      return input.selectionType.trim();
    case "odds_integrity":
      return `${input.detector.trim()}:${input.selectionType.trim()}`;
    case "unknown_selection":
    case "misroute_hint":
    case "placeholder_name":
      return input.rawMarketName.trim().toLowerCase();
    case "orphan_selection":
      return sortedJoin(input.orphanCodes);
    case "mixed_vocabulary":
      return sortedJoin(input.rawish);
    case "param_anomaly":
      // Anomaly type prefix only (e.g. "base_visible", "non_numeric_param").
      return input.anomalyType.split(":")[0].trim();
    case "view_type_mismatch":
      return input.viewType.trim();
    case "stale_bookmaker":
      return ""; // bookmaker + marketRef suffices
    case "judge_issue":
      return input.evidence.trim().toLowerCase();
  }
}

/** Resolve the FlagKind for an EvidenceInput (judge_issue is templated). */
export function flagKindOf(input: EvidenceInput): FlagKind {
  return input.kind === "judge_issue" ? `judge_issue:${input.judgeKind}` : input.kind;
}

/**
 * Build a full fingerprint from a flag instance. Market-level kinds force
 * bookmaker to null regardless of the argument.
 */
export function buildFingerprint(
  marketRef: string,
  bookmaker: string | null,
  input: EvidenceInput
): IssueFingerprint {
  const kind = flagKindOf(input);
  return {
    marketRef,
    bookmaker: MARKET_LEVEL_KINDS.has(kind) ? null : bookmaker,
    kind,
    evidence: canonicalizeEvidence(input),
  };
}

// ---------------------------------------------------------------------------
// Ledger registry types (SPEC §2)
// ---------------------------------------------------------------------------

export type LedgerState =
  | "open"
  | "attempted"
  | "fixed-pending-rescrape"
  | "verified-fixed"
  | "regressed"
  | "accepted-difference"
  | "stale-source";

export type LedgerSeverity = "BROKEN" | "MAJOR" | "MINOR" | null;

export type DispositionEvidenceKind = "raw-dump" | "live-probe" | "judge" | "manual";

export interface LedgerDisposition {
  reason: string;
  evidenceKind: DispositionEvidenceKind;
  evidencePath?: string | null;
  /** ISO timestamp or null (no expiry recorded). */
  ttl: string | null;
}

export interface LedgerAttempt {
  at: string;
  commit: string | null;
  fixer: string;
  note: string;
}

export interface LedgerEntry {
  fingerprint: IssueFingerprint;
  state: LedgerState;
  severity: LedgerSeverity;
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
  /** Carried between rounds — latest judge reasoning / suggested fix, 1-3 lines. */
  diagnosis: string;
  attempts: LedgerAttempt[];
  /** Required for accepted-difference / stale-source. */
  disposition: LedgerDisposition | null;
  /** Set when the entry is escalated to the manual queue after failed attempts. */
  manualQueue?: boolean;
}

export interface LedgerRegistry {
  schemaVersion: 1;
  updatedAt: string;
  entries: Record<FingerprintId, LedgerEntry>;
}

export function createEmptyRegistry(updatedAt: string = new Date().toISOString()): LedgerRegistry {
  return { schemaVersion: 1, updatedAt, entries: {} };
}

// ---------------------------------------------------------------------------
// State machine (SPEC §2)
// ---------------------------------------------------------------------------

export type TransitionEvent =
  /** open|regressed → attempted (records the attempt). */
  | { type: "attempt"; attempt: LedgerAttempt }
  /** attempted → fixed-pending-rescrape. */
  | { type: "fix-committed" }
  /** attempted → open after 2 failed attempts (sets manualQueue escalation flag). */
  | { type: "attempts-exhausted" }
  /** fixed-pending-rescrape → verified-fixed (fingerprint absent in fresh flags). */
  | { type: "verified-absent" }
  /** fixed-pending-rescrape → regressed (fingerprint present in fresh flags). */
  | { type: "regressed" }
  /** open → accepted-difference (requires disposition with evidenceKind + ttl). */
  | { type: "accept-difference"; disposition: LedgerDisposition }
  /** open → stale-source (requires disposition with ttl). */
  | { type: "mark-stale-source"; disposition: LedgerDisposition }
  /** accepted-difference|stale-source → open (expired TTL auto-reopen). */
  | { type: "reopen" };

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

function assertState(entry: LedgerEntry, event: TransitionEvent, allowed: LedgerState[]): void {
  if (!allowed.includes(entry.state)) {
    throw new InvalidTransitionError(
      `Event "${event.type}" is not valid from state "${entry.state}" (allowed: ${allowed.join(", ")})`
    );
  }
}

/**
 * Apply a state-machine event to a ledger entry, enforcing all guards.
 * Pure: returns a NEW entry; invalid transitions throw InvalidTransitionError.
 */
export function transition(entry: LedgerEntry, event: TransitionEvent): LedgerEntry {
  switch (event.type) {
    case "attempt": {
      assertState(entry, event, ["open", "regressed"]);
      return {
        ...entry,
        state: "attempted",
        attempts: [...entry.attempts, event.attempt],
      };
    }
    case "fix-committed": {
      assertState(entry, event, ["attempted"]);
      return { ...entry, state: "fixed-pending-rescrape" };
    }
    case "attempts-exhausted": {
      assertState(entry, event, ["attempted"]);
      // Escalate: back to open with the manual-queue flag set.
      return { ...entry, state: "open", manualQueue: true };
    }
    case "verified-absent": {
      assertState(entry, event, ["fixed-pending-rescrape"]);
      return { ...entry, state: "verified-fixed" };
    }
    case "regressed": {
      assertState(entry, event, ["fixed-pending-rescrape"]);
      return { ...entry, state: "regressed" };
    }
    case "accept-difference": {
      assertState(entry, event, ["open"]);
      const d = event.disposition;
      if (!d || !d.evidenceKind || !d.ttl) {
        throw new InvalidTransitionError(
          "accepted-difference requires a disposition with evidenceKind and ttl"
        );
      }
      // Hard rule: odds_integrity may NOT be accepted without raw evidence.
      if (
        entry.fingerprint.kind === "odds_integrity" &&
        d.evidenceKind !== "raw-dump" &&
        d.evidenceKind !== "live-probe"
      ) {
        throw new InvalidTransitionError(
          'odds_integrity entries may not enter accepted-difference unless disposition.evidenceKind is "raw-dump" or "live-probe"'
        );
      }
      return { ...entry, state: "accepted-difference", disposition: d };
    }
    case "mark-stale-source": {
      assertState(entry, event, ["open"]);
      const d = event.disposition;
      if (!d || !d.ttl) {
        throw new InvalidTransitionError("stale-source requires a disposition with ttl");
      }
      return { ...entry, state: "stale-source", disposition: d };
    }
    case "reopen": {
      assertState(entry, event, ["accepted-difference", "stale-source"]);
      return { ...entry, state: "open", disposition: null };
    }
  }
}

// ---------------------------------------------------------------------------
// Suppression semantics (SPEC §2, consumed by prep §4)
// ---------------------------------------------------------------------------

/**
 * True when the entry's flags must be hidden from judges and excluded from
 * severity: state accepted-difference / stale-source with a valid (unexpired)
 * TTL. odds_integrity entries are NEVER suppressed. A missing/null TTL never
 * suppresses (conservative: guards require a TTL to enter these states).
 */
export function isSuppressed(entry: LedgerEntry, now: Date = new Date()): boolean {
  if (entry.fingerprint.kind === "odds_integrity") return false;
  if (entry.state !== "accepted-difference" && entry.state !== "stale-source") return false;
  const ttl = entry.disposition?.ttl;
  if (!ttl) return false;
  const expiry = new Date(ttl);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() > now.getTime();
}

/** True when a suppressing state has an expired TTL and must auto-reopen. */
export function isExpired(entry: LedgerEntry, now: Date = new Date()): boolean {
  if (entry.state !== "accepted-difference" && entry.state !== "stale-source") return false;
  const ttl = entry.disposition?.ttl;
  if (!ttl) return false;
  const expiry = new Date(ttl);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() <= now.getTime();
}

// ---------------------------------------------------------------------------
// Registry I/O (fs helpers — kept separate so the core stays pure)
// ---------------------------------------------------------------------------

/** Recursively sort object keys for deterministic, diff-friendly JSON. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Stable JSON serialization: all object keys sorted, 2-space indent. */
export function stableSerializeRegistry(registry: LedgerRegistry): string {
  return `${JSON.stringify(sortKeysDeep(registry), null, 2)}\n`;
}

/**
 * Load the registry from disk. A missing file yields an empty registry so
 * first runs work without a seed; malformed content throws.
 */
export function loadRegistry(path: string): LedgerRegistry {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyRegistry();
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as LedgerRegistry;
  if (parsed.schemaVersion !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
    throw new Error(`Invalid ledger registry at ${path}: expected schemaVersion 1 with entries map`);
  }
  return parsed;
}

/** Save the registry with sorted keys + stable serialization. */
export function saveRegistry(path: string, registry: LedgerRegistry): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stableSerializeRegistry(registry), "utf8");
}
