#!/usr/bin/env npx tsx
/**
 * Seed docs/audit-ledger/registry.json + panel.json from the three committed
 * France vs Morocco match-audit reports (rounds 3-5). SPEC §0-§2.
 *
 * Backfill rules:
 * - fingerprint kind = "judge_issue:<issue.kind>" with EMPTY evidence — issue
 *   descriptions churn between rounds, so dedup lands on the
 *   (marketRef, bookmaker, kind) triple.
 * - firstSeen = earliest report runAt containing the fingerprint,
 *   lastSeen = latest, seenCount = number of rounds seen.
 * - severity = parent market's verdict in the LATEST round seen.
 * - diagnosis = latest round's detail + suggested_action (~300 chars).
 * - state: default "open"; "accepted-difference" when the latest description
 *   clearly indicates a genuine bookmaker offer difference; "stale-source"
 *   when it indicates stale data. State changes go through transition() so
 *   the guards are exercised.
 *
 * Usage: npx tsx backend/scripts/audit-ledger-backfill.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  computeFingerprintId,
  createEmptyRegistry,
  isSuppressed,
  saveRegistry,
  transition,
  type FingerprintId,
  type IssueFingerprint,
  type LedgerEntry,
  type LedgerSeverity,
} from "../src/services/audit/fingerprint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const REPORTS_DIR = join(REPO_ROOT, "docs", "match-audit");
const LEDGER_DIR = join(REPO_ROOT, "docs", "audit-ledger");

const REPORT_FILES = [
  "2026-06-27__world-cup-2026_france_morocco__after-round3.json",
  "2026-06-27__world-cup-2026_france_morocco__after-round4.json",
  "2026-06-27__world-cup-2026_france_morocco__after-round5.json",
];

// -- Report shapes (only the fields the backfill consumes) ------------------

interface ReportIssue {
  kind: string;
  bookmaker?: string;
  detail?: string;
  suggested_action?: string;
}

interface ReportVerdict {
  marketRef: string;
  verdict: "OK" | "MINOR" | "MAJOR" | "BROKEN";
  issues?: ReportIssue[];
}

interface Report {
  meta: { runAt: string };
  verdicts: ReportVerdict[];
}

// -- Helpers -----------------------------------------------------------------

/** Normalize a report bookmaker string: trim/lowercase; multi-bookmaker
 *  strings ("betcris, lvbet") are split, sorted and re-joined so spacing
 *  variants dedupe; empty → null. */
function canonicalBookmaker(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)
    .sort();
  return parts.length > 0 ? parts.join(",") : null;
}

function truncate(text: string, max = 300): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Latest description clearly indicates a genuine bookmaker offer difference. */
function indicatesAcceptedDifference(text: string): boolean {
  const t = text.toLowerCase();
  if (/genuine(?!\s+(bug|issue|error|defect|regression))/.test(t)) return true;
  return (
    t.includes("offer difference") ||
    t.includes("nie oferuje") ||
    t.includes("does not offer") ||
    t.includes("doesn't offer") ||
    t.includes("no fix needed")
  );
}

/** Latest description indicates stale data. */
function indicatesStaleSource(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes("stale") || t.includes("przedawnione") || t.includes("predates");
}

// -- Accumulate fingerprints across rounds ------------------------------------

interface Occurrence {
  runAt: string;
  verdict: ReportVerdict["verdict"];
  detail: string;
  suggestedAction: string;
}

interface Accumulated {
  fingerprint: IssueFingerprint;
  occurrences: Occurrence[]; // one per round seen (first issue instance wins)
}

const accumulated = new Map<FingerprintId, Accumulated>();
const panelMarkets = new Set<string>();

const reports: Report[] = REPORT_FILES.map(
  (f) => JSON.parse(readFileSync(join(REPORTS_DIR, f), "utf8")) as Report
).sort((a, b) => a.meta.runAt.localeCompare(b.meta.runAt));

for (const report of reports) {
  const runAt = report.meta.runAt;
  const seenThisRound = new Set<FingerprintId>();
  for (const verdict of report.verdicts) {
    panelMarkets.add(verdict.marketRef);
    for (const issue of verdict.issues ?? []) {
      const fingerprint: IssueFingerprint = {
        marketRef: verdict.marketRef,
        bookmaker: canonicalBookmaker(issue.bookmaker),
        kind: `judge_issue:${issue.kind}`,
        // EMPTY evidence by design: descriptions churn between rounds, so
        // identity is the (marketRef, bookmaker, kind) triple.
        evidence: "",
      };
      const id = computeFingerprintId(fingerprint);
      if (seenThisRound.has(id)) continue; // count each round once per fingerprint
      seenThisRound.add(id);
      const acc = accumulated.get(id) ?? { fingerprint, occurrences: [] };
      acc.occurrences.push({
        runAt,
        verdict: verdict.verdict,
        detail: issue.detail ?? "",
        suggestedAction: issue.suggested_action ?? "",
      });
      accumulated.set(id, acc);
    }
  }
}

// -- Build ledger entries ------------------------------------------------------

const ACCEPTED_TTL = "2026-08-08T00:00:00.000Z";
const STALE_TTL = "2026-07-16T00:00:00.000Z";

function toSeverity(verdict: ReportVerdict["verdict"]): LedgerSeverity {
  return verdict === "OK" ? null : verdict;
}

const registry = createEmptyRegistry(new Date().toISOString());
const stateCounts: Record<string, number> = {};

for (const [id, acc] of accumulated) {
  const latest = acc.occurrences[acc.occurrences.length - 1];
  const diagnosis = truncate(
    [latest.detail, latest.suggestedAction].filter(Boolean).join(" — ")
  );

  let entry: LedgerEntry = {
    fingerprint: acc.fingerprint,
    state: "open",
    severity: toSeverity(latest.verdict),
    firstSeen: acc.occurrences[0].runAt,
    lastSeen: latest.runAt,
    seenCount: acc.occurrences.length,
    diagnosis,
    attempts: [],
    disposition: null,
  };

  const latestText = `${latest.detail} ${latest.suggestedAction}`;
  if (indicatesAcceptedDifference(latestText)) {
    entry = transition(entry, {
      type: "accept-difference",
      disposition: {
        reason: "judge assessed as genuine bookmaker offer difference (backfill r3-r5)",
        evidenceKind: "judge",
        ttl: ACCEPTED_TTL,
      },
    });
  } else if (indicatesStaleSource(latestText)) {
    entry = transition(entry, {
      type: "mark-stale-source",
      disposition: {
        reason: "judge assessed data as stale/predating current offer (backfill r3-r5)",
        evidenceKind: "judge",
        ttl: STALE_TTL,
      },
    });
  }

  registry.entries[id] = entry;
  stateCounts[entry.state] = (stateCounts[entry.state] ?? 0) + 1;
}

// -- Write artifacts -----------------------------------------------------------

const registryPath = join(LEDGER_DIR, "registry.json");
saveRegistry(registryPath, registry);

const panelPath = join(LEDGER_DIR, "panel.json");
const panel = { schemaVersion: 1, markets: [...panelMarkets].sort() };
writeFileSync(panelPath, `${JSON.stringify(panel, null, 2)}\n`, "utf8");

// -- Report --------------------------------------------------------------------

const now = new Date();
const suppressedNow = Object.values(registry.entries).filter((e) => isSuppressed(e, now)).length;

console.log(`Registry written: ${registryPath}`);
console.log(`  entries: ${Object.keys(registry.entries).length}`);
for (const [state, count] of Object.entries(stateCounts).sort()) {
  console.log(`  state ${state}: ${count}`);
}
console.log(`  suppressed as of now: ${suppressedNow}`);
console.log(`Panel written: ${panelPath} (${panel.markets.length} markets)`);
