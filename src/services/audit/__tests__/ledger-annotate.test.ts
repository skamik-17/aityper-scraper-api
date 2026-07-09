import { describe, expect, it } from "vitest";
import {
  buildFingerprint,
  computeFingerprintId,
  createEmptyRegistry,
  type EvidenceInput,
  type LedgerEntry,
  type LedgerRegistry,
  type LedgerState,
} from "../fingerprint.js";
import type { MatchMarketFlags } from "../match-audit-core.js";
import {
  annotateMarket,
  computePendingVerify,
  type FingerprintAnnotation,
} from "../ledger-annotate.js";

const REF = "GOLE/TOTAL_GOALS";
const FUTURE_TTL = "2099-01-01T00:00:00.000Z";
const PAST_TTL = "2020-01-01T00:00:00.000Z";
const NOW = new Date("2026-07-09T12:00:00.000Z");

function emptyFlags(): MatchMarketFlags {
  return {
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
}

function idOf(bookmaker: string | null, input: EvidenceInput): string {
  return computeFingerprintId(buildFingerprint(REF, bookmaker, input));
}

function registryWith(
  bookmaker: string | null,
  input: EvidenceInput,
  state: LedgerState,
  ttl: string | null,
): { registry: LedgerRegistry; id: string } {
  const fp = buildFingerprint(REF, bookmaker, input);
  const id = computeFingerprintId(fp);
  const entry: LedgerEntry = {
    fingerprint: fp,
    state,
    severity: "MINOR",
    firstSeen: "2026-07-01T00:00:00.000Z",
    lastSeen: "2026-07-08T00:00:00.000Z",
    seenCount: 2,
    diagnosis: "test entry",
    attempts: [],
    disposition:
      state === "accepted-difference" || state === "stale-source"
        ? { reason: "test", evidenceKind: "judge", ttl }
        : null,
  };
  const registry = createEmptyRegistry("2026-07-09T00:00:00.000Z");
  registry.entries[id] = entry;
  return { registry, id };
}

function findAnn(anns: FingerprintAnnotation[], id: string): FingerprintAnnotation | undefined {
  return anns.find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Fingerprint enumeration: every flag kind maps to the right fingerprint
// ---------------------------------------------------------------------------

describe("annotateMarket fingerprint enumeration", () => {
  it("maps every mechanical flag kind to its spec fingerprint", () => {
    const flags = emptyFlags();
    flags.unknown_selection_entries.push({
      bookmaker: "sts",
      param: "base",
      count: 2,
      rawMarketName: "Wynik Meczu",
    });
    flags.orphan_selection_entries.push({ bookmaker: "fortuna", param: "2.5", codes: ["ZZ", "AA"] });
    flags.mixed_vocabulary = { canonical: ["HOME"], rawish: ["dom", "1"] };
    flags.selection_gaps.push({ bookmaker: "betclic", param: "base", missing: ["NONE", "DRAW"] });
    flags.odds_disagreements.push({
      bookmaker: "pzbuk",
      param: "base",
      selectionType: "HOME",
      odds: 3.6,
      median: 1.6,
      deviationPct: 125,
      impliedDevPct: 56,
    });
    flags.odds_integrity.push({
      bookmaker: "betcris",
      param: "base",
      selectionType: "AWAY",
      detector: "placeholder_odds",
      odds: 1501,
      expected: null,
      evidence: "odds=1501",
    });
    flags.stale_bookmakers.push({ bookmaker: "lvbet", ageMinutes: 90 });
    flags.misroute_hints.push({
      bookmaker: "etoto",
      param: "base",
      rawMarketName: "1. Połowa: Gole",
      hints: ["half"],
    });
    flags.placeholder_names.push({ bookmaker: "forbet", rawMarketName: "Market 123" });
    flags.param_anomalies.push("non_numeric_param:HOME");
    flags.view_type_mismatch = { viewType: "TRIPLE_BUTTONS", expected: 3, actual: 4, codes: [] };

    const { fingerprints } = annotateMarket(REF, flags, null, NOW);

    const expected: { id: string; bookmaker: string | null; kind: string; evidence: string }[] = [
      {
        id: idOf("sts", { kind: "unknown_selection", rawMarketName: "Wynik Meczu" }),
        bookmaker: "sts",
        kind: "unknown_selection",
        evidence: "wynik meczu",
      },
      {
        id: idOf("fortuna", { kind: "orphan_selection", orphanCodes: ["ZZ", "AA"] }),
        bookmaker: "fortuna",
        kind: "orphan_selection",
        evidence: "AA,ZZ",
      },
      {
        // market-level kind → bookmaker forced to null
        id: idOf(null, { kind: "mixed_vocabulary", rawish: ["dom", "1"] }),
        bookmaker: null,
        kind: "mixed_vocabulary",
        evidence: "1,dom",
      },
      {
        id: idOf("betclic", { kind: "selection_gap", missingCodes: ["NONE", "DRAW"] }),
        bookmaker: "betclic",
        kind: "selection_gap",
        evidence: "DRAW,NONE",
      },
      {
        id: idOf("pzbuk", { kind: "odds_disagreement", selectionType: "HOME" }),
        bookmaker: "pzbuk",
        kind: "odds_disagreement",
        evidence: "HOME",
      },
      {
        id: idOf("betcris", {
          kind: "odds_integrity",
          detector: "placeholder_odds",
          selectionType: "AWAY",
        }),
        bookmaker: "betcris",
        kind: "odds_integrity",
        evidence: "placeholder_odds:AWAY",
      },
      {
        id: idOf("lvbet", { kind: "stale_bookmaker" }),
        bookmaker: "lvbet",
        kind: "stale_bookmaker",
        evidence: "",
      },
      {
        id: idOf("etoto", { kind: "misroute_hint", rawMarketName: "1. Połowa: Gole" }),
        bookmaker: "etoto",
        kind: "misroute_hint",
        evidence: "1. połowa: gole",
      },
      {
        id: idOf("forbet", { kind: "placeholder_name", rawMarketName: "Market 123" }),
        bookmaker: "forbet",
        kind: "placeholder_name",
        evidence: "market 123",
      },
      {
        id: idOf(null, { kind: "param_anomaly", anomalyType: "non_numeric_param:HOME" }),
        bookmaker: null,
        kind: "param_anomaly",
        evidence: "non_numeric_param",
      },
      {
        id: idOf(null, { kind: "view_type_mismatch", viewType: "TRIPLE_BUTTONS" }),
        bookmaker: null,
        kind: "view_type_mismatch",
        evidence: "TRIPLE_BUTTONS",
      },
    ];

    expect(fingerprints).toHaveLength(expected.length);
    for (const e of expected) {
      const ann = findAnn(fingerprints, e.id);
      expect(ann, `missing annotation for ${e.kind}`).toBeDefined();
      expect(ann!.kind).toBe(e.kind);
      expect(ann!.bookmaker).toBe(e.bookmaker);
      expect(ann!.evidence).toBe(e.evidence);
      expect(ann!.state).toBe("new");
    }
    // Sorted by id
    const ids = fingerprints.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("dedupes identical fingerprints across params and reports registry state", () => {
    const flags = emptyFlags();
    // Same (bookmaker, missing codes) in two params → one fingerprint
    flags.selection_gaps.push({ bookmaker: "sts", param: "1.5", missing: ["OVER"] });
    flags.selection_gaps.push({ bookmaker: "sts", param: "2.5", missing: ["OVER"] });

    const { registry, id } = registryWith(
      "sts",
      { kind: "selection_gap", missingCodes: ["OVER"] },
      "attempted",
      null,
    );
    const { fingerprints } = annotateMarket(REF, flags, registry, NOW);
    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0].id).toBe(id);
    expect(fingerprints[0].state).toBe("attempted");
  });
});

// ---------------------------------------------------------------------------
// Suppression: state + TTL honored; odds_integrity never suppressed
// ---------------------------------------------------------------------------

describe("annotateMarket suppression", () => {
  function gapFlags(): MatchMarketFlags {
    const flags = emptyFlags();
    flags.selection_gaps.push({ bookmaker: "sts", param: "base", missing: ["NONE"] });
    return flags;
  }
  const gapInput: EvidenceInput = { kind: "selection_gap", missingCodes: ["NONE"] };

  it("moves accepted-difference flags with a valid TTL to suppressed", () => {
    const { registry, id } = registryWith("sts", gapInput, "accepted-difference", FUTURE_TTL);
    const result = annotateMarket(REF, gapFlags(), registry, NOW);
    expect(result.flags.selection_gaps).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]).toMatchObject({ kind: "selection_gap", fingerprintId: id });
    // Suppressed fingerprints stay listed (transparency)
    expect(findAnn(result.fingerprints, id)).toBeDefined();
    expect(result.severity).toBe(0);
  });

  it("moves stale-source flags with a valid TTL to suppressed", () => {
    const { registry } = registryWith("sts", gapInput, "stale-source", FUTURE_TTL);
    const result = annotateMarket(REF, gapFlags(), registry, NOW);
    expect(result.flags.selection_gaps).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
  });

  it("does NOT suppress when the TTL is expired", () => {
    const { registry } = registryWith("sts", gapInput, "accepted-difference", PAST_TTL);
    const result = annotateMarket(REF, gapFlags(), registry, NOW);
    expect(result.flags.selection_gaps).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
    expect(result.severity).toBe(1);
  });

  it("does NOT suppress open / attempted / fixed-pending-rescrape states", () => {
    for (const state of ["open", "attempted", "fixed-pending-rescrape"] as LedgerState[]) {
      const { registry } = registryWith("sts", gapInput, state, null);
      const result = annotateMarket(REF, gapFlags(), registry, NOW);
      expect(result.flags.selection_gaps, state).toHaveLength(1);
      expect(result.suppressed, state).toHaveLength(0);
    }
  });

  it("NEVER suppresses odds_integrity, even with a forged accepted-difference entry", () => {
    const flags = emptyFlags();
    flags.odds_integrity.push({
      bookmaker: "betclic",
      param: "base",
      selectionType: "NONE",
      detector: "decimal_shift",
      odds: 150,
      expected: 47.7,
      evidence: "odds=150 median=47.7",
    });
    const input: EvidenceInput = {
      kind: "odds_integrity",
      detector: "decimal_shift",
      selectionType: "NONE",
    };
    // Forge a suppressing state directly (transition() would forbid judge evidence,
    // but suppression must be robust even against hand-edited registries).
    const { registry } = registryWith("betclic", input, "accepted-difference", FUTURE_TTL);
    const result = annotateMarket(REF, flags, registry, NOW);
    expect(result.flags.odds_integrity).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
    expect(result.severity).toBe(6);
  });

  it("suppresses nullable singleton kinds (mixed_vocabulary, view_type_mismatch)", () => {
    const flags = emptyFlags();
    flags.mixed_vocabulary = { canonical: ["HOME"], rawish: ["dom"] };
    flags.view_type_mismatch = { viewType: "TRIPLE_BUTTONS", expected: 3, actual: 4, codes: [] };

    const mixedFp = buildFingerprint(REF, null, { kind: "mixed_vocabulary", rawish: ["dom"] });
    const vtFp = buildFingerprint(REF, null, {
      kind: "view_type_mismatch",
      viewType: "TRIPLE_BUTTONS",
    });
    const registry = createEmptyRegistry();
    for (const fp of [mixedFp, vtFp]) {
      registry.entries[computeFingerprintId(fp)] = {
        fingerprint: fp,
        state: "accepted-difference",
        severity: "MINOR",
        firstSeen: "2026-07-01T00:00:00.000Z",
        lastSeen: "2026-07-08T00:00:00.000Z",
        seenCount: 1,
        diagnosis: "",
        attempts: [],
        disposition: { reason: "test", evidenceKind: "judge", ttl: FUTURE_TTL },
      };
    }

    const result = annotateMarket(REF, flags, registry, NOW);
    expect(result.flags.mixed_vocabulary).toBeNull();
    expect(result.flags.view_type_mismatch).toBeNull();
    expect(result.suppressed).toHaveLength(2);
    expect(result.severity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Severity recompute
// ---------------------------------------------------------------------------

describe("annotateMarket severity recompute", () => {
  it("recomputes severity from remaining flags only", () => {
    const flags = emptyFlags();
    flags.misroute_hints.push({
      bookmaker: "sts",
      param: "base",
      rawMarketName: "1. połowa wynik",
      hints: ["half"],
    });
    flags.selection_gaps.push({ bookmaker: "sts", param: "base", missing: ["NONE"] });
    // Suppress the gap (weight 1); the misroute hint (weight 5) remains.
    const { registry } = registryWith(
      "sts",
      { kind: "selection_gap", missingCodes: ["NONE"] },
      "accepted-difference",
      FUTURE_TTL,
    );
    const result = annotateMarket(REF, flags, registry, NOW);
    expect(result.severity).toBe(5);
    expect(result.flags.misroute_hints).toHaveLength(1);
    expect(result.flags.selection_gaps).toHaveLength(0);
  });

  it("keeps severity intact when nothing is suppressed (registry null)", () => {
    const flags = emptyFlags();
    flags.selection_gaps.push({ bookmaker: "sts", param: "base", missing: ["NONE"] });
    flags.stale_bookmakers.push({ bookmaker: "lvbet", ageMinutes: 61 }); // weight 0
    const result = annotateMarket(REF, flags, null, NOW);
    expect(result.severity).toBe(1);
    expect(result.suppressed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pendingVerify
// ---------------------------------------------------------------------------

describe("computePendingVerify", () => {
  function pendingEntry(marketRef: string, suffix: string): { id: string; entry: LedgerEntry } {
    const fp = buildFingerprint(marketRef, `bm-${suffix}`, {
      kind: "odds_disagreement",
      selectionType: suffix,
    });
    return {
      id: computeFingerprintId(fp),
      entry: {
        fingerprint: fp,
        state: "fixed-pending-rescrape",
        severity: "MAJOR",
        firstSeen: "2026-07-01T00:00:00.000Z",
        lastSeen: "2026-07-08T00:00:00.000Z",
        seenCount: 3,
        diagnosis: "",
        attempts: [],
        disposition: null,
      },
    };
  }

  it("classifies stillPresent vs nowAbsent, skipping unaudited markets", () => {
    const registry = createEmptyRegistry();
    const seen = pendingEntry(REF, "HOME"); // seen this run → stillPresent
    const gone = pendingEntry(REF, "AWAY"); // audited market, not seen → nowAbsent
    const stale = pendingEntry("POLOWY/HALF_TIME_RESULT", "DRAW"); // staleSkip market → neither
    registry.entries[seen.id] = seen.entry;
    registry.entries[gone.id] = gone.entry;
    registry.entries[stale.id] = stale.entry;
    // Non-pending states are never classified
    registry.entries.aaaaaaaaaaaa = { ...seen.entry, state: "open" };

    const result = computePendingVerify(registry, new Set([seen.id]), new Set([REF]));
    expect(result.stillPresent).toEqual([seen.id]);
    expect(result.nowAbsent).toEqual([gone.id]);
  });

  it("returns empty lists on an empty registry", () => {
    const result = computePendingVerify(createEmptyRegistry(), new Set(), new Set([REF]));
    expect(result).toEqual({ stillPresent: [], nowAbsent: [] });
  });
});
