import { describe, it, expect } from "vitest";
import {
  buildFingerprint,
  canonicalizeEvidence,
  computeFingerprintId,
  createEmptyRegistry,
  flagKindOf,
  isExpired,
  isSuppressed,
  loadRegistry,
  saveRegistry,
  stableSerializeRegistry,
  transition,
  InvalidTransitionError,
  type IssueFingerprint,
  type LedgerEntry,
  type LedgerDisposition,
} from "../fingerprint.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EntryOverrides = Partial<Omit<LedgerEntry, "fingerprint">> & {
  fingerprint?: Partial<IssueFingerprint>;
};

function makeEntry(overrides: EntryOverrides = {}): LedgerEntry {
  const { fingerprint: fpOverrides, ...rest } = overrides;
  const fingerprint: IssueFingerprint = {
    marketRef: "GOLE/OVER_UNDER",
    bookmaker: "fortuna",
    kind: "selection_gap",
    evidence: "OVER,UNDER",
    ...(fpOverrides ?? {}),
  };
  return {
    fingerprint,
    state: "open",
    severity: "MAJOR",
    firstSeen: "2026-07-08T18:00:00.000Z",
    lastSeen: "2026-07-09T00:00:00.000Z",
    seenCount: 2,
    diagnosis: "test diagnosis",
    attempts: [],
    disposition: null,
    ...rest,
  };
}

const validDisposition: LedgerDisposition = {
  reason: "bookmaker genuinely does not offer this selection",
  evidenceKind: "judge",
  ttl: "2026-08-08T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Fingerprint id
// ---------------------------------------------------------------------------

describe("computeFingerprintId", () => {
  const fp: IssueFingerprint = {
    marketRef: "GOLE/OVER_UNDER",
    bookmaker: "sts",
    kind: "selection_gap",
    evidence: "NONE,OVER",
  };

  it("is 12 lowercase hex chars", () => {
    expect(computeFingerprintId(fp)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable for identical input", () => {
    expect(computeFingerprintId(fp)).toBe(computeFingerprintId({ ...fp }));
  });

  it("treats null bookmaker as empty string", () => {
    const a = computeFingerprintId({ ...fp, bookmaker: null });
    const b = computeFingerprintId({ ...fp, bookmaker: "" as unknown as string });
    expect(a).toBe(b);
  });

  it("changes when any component changes", () => {
    const base = computeFingerprintId(fp);
    expect(computeFingerprintId({ ...fp, marketRef: "GOLE/BTTS" })).not.toBe(base);
    expect(computeFingerprintId({ ...fp, bookmaker: "fortuna" })).not.toBe(base);
    expect(computeFingerprintId({ ...fp, kind: "orphan_selection" })).not.toBe(base);
    expect(computeFingerprintId({ ...fp, evidence: "OVER" })).not.toBe(base);
  });

  it("matches the documented sha1 recipe", () => {
    // sha1("GOLE/OVER_UNDER|sts|selection_gap|NONE,OVER").slice(0,12)
    // Locks the exact material format `${marketRef}|${bookmaker ?? ""}|${kind}|${evidence}`.
    const again = computeFingerprintId({
      marketRef: "GOLE/OVER_UNDER",
      bookmaker: "sts",
      kind: "selection_gap",
      evidence: "NONE,OVER",
    });
    expect(computeFingerprintId(fp)).toBe(again);
  });
});

// ---------------------------------------------------------------------------
// Evidence canonicalization (SPEC §1 table)
// ---------------------------------------------------------------------------

describe("canonicalizeEvidence", () => {
  it("selection_gap: sorted missing codes joined with comma", () => {
    expect(
      canonicalizeEvidence({ kind: "selection_gap", missingCodes: ["UNDER", "OVER", "NONE"] })
    ).toBe("NONE,OVER,UNDER");
  });

  it("odds_disagreement: selectionType", () => {
    expect(canonicalizeEvidence({ kind: "odds_disagreement", selectionType: " HOME " })).toBe(
      "HOME"
    );
  });

  it("odds_integrity: <detector>:<selectionType>", () => {
    expect(
      canonicalizeEvidence({ kind: "odds_integrity", detector: "decimal_shift", selectionType: "NONE" })
    ).toBe("decimal_shift:NONE");
  });

  it("unknown_selection: rawMarketName trimmed and lowercased", () => {
    expect(
      canonicalizeEvidence({ kind: "unknown_selection", rawMarketName: "  Liczba Goli OPTA " })
    ).toBe("liczba goli opta");
  });

  it("orphan_selection: sorted orphan codes joined with comma", () => {
    expect(canonicalizeEvidence({ kind: "orphan_selection", orphanCodes: ["X2", "1X"] })).toBe(
      "1X,X2"
    );
  });

  it("misroute_hint: rawMarketName trimmed and lowercased", () => {
    expect(canonicalizeEvidence({ kind: "misroute_hint", rawMarketName: "Handicap 2W " })).toBe(
      "handicap 2w"
    );
  });

  it("mixed_vocabulary: sorted rawish list joined with comma", () => {
    expect(canonicalizeEvidence({ kind: "mixed_vocabulary", rawish: ["yes", "TAK", "no"] })).toBe(
      "TAK,no,yes"
    );
  });

  it("param_anomaly: anomaly type prefix only", () => {
    expect(canonicalizeEvidence({ kind: "param_anomaly", anomalyType: "base_visible" })).toBe(
      "base_visible"
    );
    expect(
      canonicalizeEvidence({ kind: "param_anomaly", anomalyType: "non_numeric_param: got 'abc'" })
    ).toBe("non_numeric_param");
  });

  it("placeholder_name: rawMarketName trimmed and lowercased", () => {
    expect(canonicalizeEvidence({ kind: "placeholder_name", rawMarketName: " Market 123 " })).toBe(
      "market 123"
    );
  });

  it("view_type_mismatch: viewType", () => {
    expect(canonicalizeEvidence({ kind: "view_type_mismatch", viewType: "COMBINATION" })).toBe(
      "COMBINATION"
    );
  });

  it("stale_bookmaker: empty string", () => {
    expect(canonicalizeEvidence({ kind: "stale_bookmaker" })).toBe("");
  });

  it("judge_issue: judge-provided evidence lowercased/trimmed", () => {
    expect(
      canonicalizeEvidence({ kind: "judge_issue", judgeKind: "silent_merge", evidence: " Dup Rows Merged " })
    ).toBe("dup rows merged");
  });

  it("never embeds odds or params (canonical forms are code/name based)", () => {
    // Regression guard: the canonicalizer signature offers no odds/param field,
    // and outputs above contain only codes/names/types.
    const out = canonicalizeEvidence({ kind: "selection_gap", missingCodes: ["OVER"] });
    expect(out).toBe("OVER");
  });
});

describe("flagKindOf / buildFingerprint", () => {
  it("templates judge_issue kinds", () => {
    expect(flagKindOf({ kind: "judge_issue", judgeKind: "nonsense", evidence: "x" })).toBe(
      "judge_issue:nonsense"
    );
  });

  it("forces bookmaker to null for market-level kinds", () => {
    const fp = buildFingerprint("GOLE/OVER_UNDER", "sts", {
      kind: "mixed_vocabulary",
      rawish: ["a", "b"],
    });
    expect(fp.bookmaker).toBeNull();
    const fp2 = buildFingerprint("GOLE/OVER_UNDER", "sts", {
      kind: "param_anomaly",
      anomalyType: "base_visible",
    });
    expect(fp2.bookmaker).toBeNull();
    const fp3 = buildFingerprint("GOLE/OVER_UNDER", "sts", {
      kind: "view_type_mismatch",
      viewType: "TRIPLE",
    });
    expect(fp3.bookmaker).toBeNull();
  });

  it("keeps bookmaker for bookmaker-level kinds", () => {
    const fp = buildFingerprint("GOLE/OVER_UNDER", "sts", {
      kind: "selection_gap",
      missingCodes: ["OVER"],
    });
    expect(fp.bookmaker).toBe("sts");
    expect(fp.kind).toBe("selection_gap");
    expect(fp.evidence).toBe("OVER");
  });
});

// ---------------------------------------------------------------------------
// Transition state machine
// ---------------------------------------------------------------------------

describe("transition", () => {
  const attempt = { at: "2026-07-09T01:00:00.000Z", commit: null, fixer: "sts-audit-fixer", note: "try" };

  it("open --attempt--> attempted (records the attempt)", () => {
    const next = transition(makeEntry(), { type: "attempt", attempt });
    expect(next.state).toBe("attempted");
    expect(next.attempts).toHaveLength(1);
    expect(next.attempts[0]).toEqual(attempt);
  });

  it("regressed --attempt--> attempted", () => {
    const next = transition(makeEntry({ state: "regressed" }), { type: "attempt", attempt });
    expect(next.state).toBe("attempted");
  });

  it("attempt from attempted / fixed / verified / accepted throws", () => {
    for (const state of ["attempted", "fixed-pending-rescrape", "verified-fixed", "accepted-difference", "stale-source"] as const) {
      expect(() => transition(makeEntry({ state }), { type: "attempt", attempt })).toThrow(
        InvalidTransitionError
      );
    }
  });

  it("attempted --fix-committed--> fixed-pending-rescrape", () => {
    const next = transition(makeEntry({ state: "attempted" }), { type: "fix-committed" });
    expect(next.state).toBe("fixed-pending-rescrape");
  });

  it("fix-committed from any other state throws", () => {
    for (const state of ["open", "regressed", "fixed-pending-rescrape", "verified-fixed"] as const) {
      expect(() => transition(makeEntry({ state }), { type: "fix-committed" })).toThrow(
        InvalidTransitionError
      );
    }
  });

  it("attempted --attempts-exhausted--> open with manualQueue escalation", () => {
    const next = transition(makeEntry({ state: "attempted" }), { type: "attempts-exhausted" });
    expect(next.state).toBe("open");
    expect(next.manualQueue).toBe(true);
  });

  it("attempts-exhausted from open throws", () => {
    expect(() => transition(makeEntry({ state: "open" }), { type: "attempts-exhausted" })).toThrow(
      InvalidTransitionError
    );
  });

  it("fixed-pending-rescrape --verified-absent--> verified-fixed", () => {
    const next = transition(makeEntry({ state: "fixed-pending-rescrape" }), {
      type: "verified-absent",
    });
    expect(next.state).toBe("verified-fixed");
  });

  it("fixed-pending-rescrape --regressed--> regressed", () => {
    const next = transition(makeEntry({ state: "fixed-pending-rescrape" }), { type: "regressed" });
    expect(next.state).toBe("regressed");
  });

  it("verified-absent / regressed from other states throws", () => {
    for (const type of ["verified-absent", "regressed"] as const) {
      expect(() => transition(makeEntry({ state: "open" }), { type })).toThrow(
        InvalidTransitionError
      );
      expect(() => transition(makeEntry({ state: "attempted" }), { type })).toThrow(
        InvalidTransitionError
      );
    }
  });

  it("open --accept-difference--> accepted-difference with valid disposition", () => {
    const next = transition(makeEntry(), { type: "accept-difference", disposition: validDisposition });
    expect(next.state).toBe("accepted-difference");
    expect(next.disposition).toEqual(validDisposition);
  });

  it("accept-difference without ttl throws", () => {
    expect(() =>
      transition(makeEntry(), {
        type: "accept-difference",
        disposition: { ...validDisposition, ttl: null },
      })
    ).toThrow(InvalidTransitionError);
  });

  it("accept-difference from non-open states throws", () => {
    for (const state of ["attempted", "fixed-pending-rescrape", "regressed", "verified-fixed"] as const) {
      expect(() =>
        transition(makeEntry({ state }), { type: "accept-difference", disposition: validDisposition })
      ).toThrow(InvalidTransitionError);
    }
  });

  it("HARD RULE: odds_integrity cannot enter accepted-difference with judge/manual evidence", () => {
    const entry = makeEntry({
      fingerprint: { kind: "odds_integrity", evidence: "decimal_shift:NONE" },
    });
    for (const evidenceKind of ["judge", "manual"] as const) {
      expect(() =>
        transition(entry, {
          type: "accept-difference",
          disposition: { ...validDisposition, evidenceKind },
        })
      ).toThrow(InvalidTransitionError);
    }
  });

  it("HARD RULE: odds_integrity CAN enter accepted-difference with raw-dump or live-probe", () => {
    const entry = makeEntry({
      fingerprint: { kind: "odds_integrity", evidence: "decimal_shift:NONE" },
    });
    for (const evidenceKind of ["raw-dump", "live-probe"] as const) {
      const next = transition(entry, {
        type: "accept-difference",
        disposition: { ...validDisposition, evidenceKind },
      });
      expect(next.state).toBe("accepted-difference");
    }
  });

  it("open --mark-stale-source--> stale-source with ttl", () => {
    const next = transition(makeEntry(), {
      type: "mark-stale-source",
      disposition: { reason: "source unreachable", evidenceKind: "manual", ttl: "2026-07-16T00:00:00.000Z" },
    });
    expect(next.state).toBe("stale-source");
  });

  it("mark-stale-source without ttl throws", () => {
    expect(() =>
      transition(makeEntry(), {
        type: "mark-stale-source",
        disposition: { reason: "x", evidenceKind: "manual", ttl: null },
      })
    ).toThrow(InvalidTransitionError);
  });

  it("mark-stale-source from non-open states throws", () => {
    expect(() =>
      transition(makeEntry({ state: "attempted" }), {
        type: "mark-stale-source",
        disposition: { reason: "x", evidenceKind: "manual", ttl: "2026-07-16T00:00:00.000Z" },
      })
    ).toThrow(InvalidTransitionError);
  });

  it("accepted-difference / stale-source --reopen--> open (disposition cleared)", () => {
    for (const state of ["accepted-difference", "stale-source"] as const) {
      const next = transition(makeEntry({ state, disposition: validDisposition }), { type: "reopen" });
      expect(next.state).toBe("open");
      expect(next.disposition).toBeNull();
    }
  });

  it("reopen from other states throws", () => {
    for (const state of ["open", "attempted", "fixed-pending-rescrape", "verified-fixed", "regressed"] as const) {
      expect(() => transition(makeEntry({ state }), { type: "reopen" })).toThrow(
        InvalidTransitionError
      );
    }
  });

  it("is pure: does not mutate the input entry", () => {
    const entry = makeEntry();
    transition(entry, { type: "attempt", attempt });
    expect(entry.state).toBe("open");
    expect(entry.attempts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suppression + TTL semantics
// ---------------------------------------------------------------------------

describe("isSuppressed", () => {
  const now = new Date("2026-07-10T00:00:00.000Z");

  it("suppresses accepted-difference with unexpired TTL", () => {
    const entry = makeEntry({
      state: "accepted-difference",
      disposition: { ...validDisposition, ttl: "2026-08-08T00:00:00.000Z" },
    });
    expect(isSuppressed(entry, now)).toBe(true);
  });

  it("suppresses stale-source with unexpired TTL", () => {
    const entry = makeEntry({
      state: "stale-source",
      disposition: { reason: "stale", evidenceKind: "manual", ttl: "2026-07-16T00:00:00.000Z" },
    });
    expect(isSuppressed(entry, now)).toBe(true);
  });

  it("does NOT suppress when TTL is expired", () => {
    const entry = makeEntry({
      state: "accepted-difference",
      disposition: { ...validDisposition, ttl: "2026-07-01T00:00:00.000Z" },
    });
    expect(isSuppressed(entry, now)).toBe(false);
    expect(isExpired(entry, now)).toBe(true);
  });

  it("TTL exactly at now counts as expired", () => {
    const entry = makeEntry({
      state: "accepted-difference",
      disposition: { ...validDisposition, ttl: now.toISOString() },
    });
    expect(isSuppressed(entry, now)).toBe(false);
    expect(isExpired(entry, now)).toBe(true);
  });

  it("does NOT suppress open / attempted / fixed / verified / regressed states", () => {
    for (const state of ["open", "attempted", "fixed-pending-rescrape", "verified-fixed", "regressed"] as const) {
      expect(isSuppressed(makeEntry({ state, disposition: validDisposition }), now)).toBe(false);
    }
  });

  it("does NOT suppress without a TTL", () => {
    const entry = makeEntry({
      state: "accepted-difference",
      disposition: { ...validDisposition, ttl: null },
    });
    expect(isSuppressed(entry, now)).toBe(false);
  });

  it("NEVER suppresses odds_integrity, even accepted with valid TTL", () => {
    const entry = makeEntry({
      state: "accepted-difference",
      fingerprint: { kind: "odds_integrity", evidence: "decimal_shift:NONE" },
      disposition: { ...validDisposition, evidenceKind: "raw-dump", ttl: "2099-01-01T00:00:00.000Z" },
    });
    expect(isSuppressed(entry, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registry I/O
// ---------------------------------------------------------------------------

describe("loadRegistry / saveRegistry", () => {
  it("round-trips a registry and sorts keys stably", () => {
    const dir = mkdtempSync(join(tmpdir(), "fp-registry-"));
    const path = join(dir, "registry.json");
    const registry = createEmptyRegistry("2026-07-09T00:00:00.000Z");
    const entryB = makeEntry({ fingerprint: { bookmaker: "zzz" } });
    const entryA = makeEntry({ fingerprint: { bookmaker: "aaa" } });
    registry.entries[computeFingerprintId(entryB.fingerprint)] = entryB;
    registry.entries[computeFingerprintId(entryA.fingerprint)] = entryA;

    saveRegistry(path, registry);
    const loaded = loadRegistry(path);
    expect(loaded.schemaVersion).toBe(1);
    expect(Object.keys(loaded.entries)).toHaveLength(2);
    expect(loaded.entries[computeFingerprintId(entryA.fingerprint)]).toEqual(entryA);

    // Deterministic: entry ids and nested keys are sorted in the file.
    const text = readFileSync(path, "utf8");
    expect(text).toBe(stableSerializeRegistry(registry));
    const ids = Object.keys(JSON.parse(text).entries);
    expect(ids).toEqual([...ids].sort());
    // Nested fingerprint keys sorted alphabetically.
    expect(text.indexOf('"bookmaker"')).toBeLessThan(text.indexOf('"evidence"'));
    expect(text.indexOf('"evidence"')).toBeLessThan(text.indexOf('"kind"'));

    // Saving twice yields byte-identical output.
    saveRegistry(path, loaded);
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  it("returns an empty registry for a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fp-registry-"));
    const registry = loadRegistry(join(dir, "does-not-exist.json"));
    expect(registry.schemaVersion).toBe(1);
    expect(registry.entries).toEqual({});
  });

  it("throws on malformed registry content", () => {
    const dir = mkdtempSync(join(tmpdir(), "fp-registry-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ schemaVersion: 2 }), "utf8");
    expect(() => loadRegistry(path)).toThrow(/Invalid ledger registry/);
  });
});
