/**
 * Ledger annotation for match-audit prep (Audit Process v2, SPEC §4 items 4-7).
 *
 * Pure logic only — no I/O. The prep script (scripts/match-audit-prep.ts)
 * loads the registry/panel/coverage files and feeds everything here:
 *   - enumerate a fingerprint for every mechanical flag instance,
 *   - move suppressed flags (accepted-difference / stale-source with a valid
 *     TTL) out of the judged flag set — odds_integrity is NEVER moved,
 *   - recompute severity from the remaining flags,
 *   - compute the pendingVerify lists for fixed-pending-rescrape entries.
 */

import {
  buildFingerprint,
  computeFingerprintId,
  isSuppressed,
  type EvidenceInput,
  type FingerprintId,
  type FlagKind,
  type LedgerRegistry,
  type LedgerState,
  type MechanicalFlagKind,
} from "./fingerprint.js";
import { severityScore, type MatchMarketFlags } from "./match-audit-core.js";

// ---------------------------------------------------------------------------
// Output shapes (prep entry additions, SPEC §4 items 4-5)
// ---------------------------------------------------------------------------

/**
 * One annotated fingerprint on a prep entry. `evidence` is carried beyond the
 * spec's minimal {id, kind, bookmaker, state} so the observe CLI can create
 * new registry entries without recomputing evidence from raw flags.
 */
export interface FingerprintAnnotation {
  id: FingerprintId;
  kind: FlagKind;
  bookmaker: string | null;
  evidence: string;
  /** Registry state, or "new" when the fingerprint is absent from the registry. */
  state: LedgerState | "new";
}

/** A flag instance moved out of `flags` by suppression (kept for transparency). */
export interface SuppressedFlag {
  kind: MechanicalFlagKind;
  fingerprintId: FingerprintId;
  /** The original flag payload, verbatim. */
  flag: unknown;
}

export interface AnnotatedMarket {
  /** Every fingerprint observed on this market (deduped by id, sorted by id). */
  fingerprints: FingerprintAnnotation[];
  /** Flags remaining after suppression (same shape as the core output). */
  flags: MatchMarketFlags;
  /** Flags moved out by suppression. */
  suppressed: SuppressedFlag[];
  /** Severity recomputed from the remaining flags. */
  severity: number;
}

// ---------------------------------------------------------------------------
// Flag → fingerprint enumeration + suppression
// ---------------------------------------------------------------------------

/**
 * Annotate one market's mechanical flags against the ledger registry.
 *
 * Pass `registry = null` to annotate without a ledger (all states "new",
 * nothing suppressed). `now` drives TTL validity for suppression.
 */
export function annotateMarket(
  marketRef: string,
  flags: MatchMarketFlags,
  registry: LedgerRegistry | null,
  now: Date = new Date(),
): AnnotatedMarket {
  const annotations = new Map<FingerprintId, FingerprintAnnotation>();
  const suppressed: SuppressedFlag[] = [];

  /** Register a flag instance's fingerprint; returns its id + suppression verdict. */
  const record = (
    bookmaker: string | null,
    input: EvidenceInput,
  ): { id: FingerprintId; suppress: boolean } => {
    const fp = buildFingerprint(marketRef, bookmaker, input);
    const id = computeFingerprintId(fp);
    const entry = registry?.entries[id];
    if (!annotations.has(id)) {
      annotations.set(id, {
        id,
        kind: fp.kind,
        bookmaker: fp.bookmaker,
        evidence: fp.evidence,
        state: entry ? entry.state : "new",
      });
    }
    // odds_integrity is never suppressed (also guarded inside isSuppressed).
    const suppress =
      fp.kind !== "odds_integrity" && entry !== undefined && isSuppressed(entry, now);
    return { id, suppress };
  };

  /** Partition an array flag kind into kept instances; suppressed go aside. */
  const keep = <T>(
    items: T[],
    kind: MechanicalFlagKind,
    toInput: (item: T) => { bookmaker: string | null; input: EvidenceInput },
  ): T[] => {
    const kept: T[] = [];
    for (const item of items) {
      const { bookmaker, input } = toInput(item);
      const { id, suppress } = record(bookmaker, input);
      if (suppress) suppressed.push({ kind, fingerprintId: id, flag: item });
      else kept.push(item);
    }
    return kept;
  };

  const next: MatchMarketFlags = {
    unknown_selection_entries: keep(flags.unknown_selection_entries, "unknown_selection", (f) => ({
      bookmaker: f.bookmaker,
      input: { kind: "unknown_selection", rawMarketName: f.rawMarketName },
    })),
    orphan_selection_entries: keep(flags.orphan_selection_entries, "orphan_selection", (f) => ({
      bookmaker: f.bookmaker,
      input: { kind: "orphan_selection", orphanCodes: f.codes },
    })),
    mixed_vocabulary: flags.mixed_vocabulary,
    selection_gaps: keep(flags.selection_gaps, "selection_gap", (f) => ({
      bookmaker: f.bookmaker,
      input: { kind: "selection_gap", missingCodes: f.missing },
    })),
    odds_disagreements: keep(flags.odds_disagreements, "odds_disagreement", (f) => ({
      bookmaker: f.bookmaker,
      input: { kind: "odds_disagreement", selectionType: f.selectionType },
    })),
    // odds_integrity: annotate every instance but NEVER move any (zero-tolerance).
    odds_integrity: keep(flags.odds_integrity, "odds_integrity", (f) => ({
      bookmaker: f.bookmaker,
      input: { kind: "odds_integrity", detector: f.detector, selectionType: f.selectionType },
    })),
    stale_bookmakers: keep(flags.stale_bookmakers, "stale_bookmaker", (f) => ({
      bookmaker: f.bookmaker,
      input: { kind: "stale_bookmaker" },
    })),
    misroute_hints: keep(flags.misroute_hints, "misroute_hint", (f) => ({
      bookmaker: f.bookmaker,
      input: { kind: "misroute_hint", rawMarketName: f.rawMarketName },
    })),
    placeholder_names: keep(flags.placeholder_names, "placeholder_name", (f) => ({
      bookmaker: f.bookmaker,
      input: { kind: "placeholder_name", rawMarketName: f.rawMarketName },
    })),
    param_anomalies: keep(flags.param_anomalies, "param_anomaly", (anomaly) => ({
      bookmaker: null,
      input: { kind: "param_anomaly", anomalyType: anomaly },
    })),
    view_type_mismatch: flags.view_type_mismatch,
  };

  // Nullable singleton kinds (market-level; fingerprint bookmaker is null).
  if (flags.mixed_vocabulary) {
    const { id, suppress } = record(null, {
      kind: "mixed_vocabulary",
      rawish: flags.mixed_vocabulary.rawish,
    });
    if (suppress) {
      suppressed.push({ kind: "mixed_vocabulary", fingerprintId: id, flag: flags.mixed_vocabulary });
      next.mixed_vocabulary = null;
    }
  }
  if (flags.view_type_mismatch) {
    const { id, suppress } = record(null, {
      kind: "view_type_mismatch",
      viewType: flags.view_type_mismatch.viewType,
    });
    if (suppress) {
      suppressed.push({
        kind: "view_type_mismatch",
        fingerprintId: id,
        flag: flags.view_type_mismatch,
      });
      next.view_type_mismatch = null;
    }
  }

  return {
    fingerprints: [...annotations.values()].sort((a, b) => a.id.localeCompare(b.id)),
    flags: next,
    suppressed,
    severity: severityScore(next),
  };
}

// ---------------------------------------------------------------------------
// pendingVerify (SPEC §4 item 7)
// ---------------------------------------------------------------------------

export interface PendingVerify {
  /** fixed-pending-rescrape fingerprints seen again this run (→ regressed). */
  stillPresent: FingerprintId[];
  /** fixed-pending-rescrape fingerprints absent this run (→ verified-fixed). */
  nowAbsent: FingerprintId[];
}

/**
 * Classify registry entries in `fixed-pending-rescrape` by presence in this
 * run. Only entries whose marketRef was actually audited with fresh data
 * (`auditedMarketRefs`: non-staleSkip markets present in the response) are
 * classified — absence cannot be verified on stale or missing markets, so
 * those entries appear in neither list and keep their state untouched.
 */
export function computePendingVerify(
  registry: LedgerRegistry,
  seenIds: ReadonlySet<FingerprintId>,
  auditedMarketRefs: ReadonlySet<string>,
): PendingVerify {
  const stillPresent: FingerprintId[] = [];
  const nowAbsent: FingerprintId[] = [];
  for (const [id, entry] of Object.entries(registry.entries)) {
    if (entry.state !== "fixed-pending-rescrape") continue;
    if (!auditedMarketRefs.has(entry.fingerprint.marketRef)) continue;
    if (seenIds.has(id)) stillPresent.push(id);
    else nowAbsent.push(id);
  }
  stillPresent.sort();
  nowAbsent.sort();
  return { stillPresent, nowAbsent };
}
