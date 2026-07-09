/**
 * Audit-ledger mutation CLI (Audit Process v2, SPEC §4 last paragraph).
 *
 * The prep script is registry-read-only; ALL ledger mutations go through this
 * CLI, and every state change goes through the fingerprint module's
 * transition() guards (invalid transitions abort with a non-zero exit).
 *
 * Subcommands:
 *   observe --prep <path> [--registry <path>] [--now <ISO>]
 *     Bulk pass after a prep run: bump lastSeen/seenCount for every observed
 *     fingerprint, create new entries as "open", auto-transition
 *     fixed-pending-rescrape entries → verified-fixed / regressed based on
 *     presence (audited markets only; staleSkip markets never touch state),
 *     and auto-reopen expired accepted-difference / stale-source TTLs.
 *
 *   set --id <fp> --state <state> [--reason <s>] [--evidence-kind <k>]
 *       [--evidence-path <p>] [--ttl <ISO>] [--diagnosis <s>] [--registry <path>]
 *     Targeted transition to: accepted-difference | stale-source |
 *     fixed-pending-rescrape | verified-fixed | regressed | open.
 *     ("attempted" is reached only via the attempt subcommand.)
 *
 *   attempt --id <fp> --fixer <name> --note <s> [--commit <sha>] [--registry <path>]
 *     Record a fix attempt (open|regressed → attempted).
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  InvalidTransitionError,
  isExpired,
  loadRegistry,
  saveRegistry,
  transition,
  type DispositionEvidenceKind,
  type FingerprintId,
  type LedgerDisposition,
  type LedgerEntry,
  type LedgerRegistry,
  type TransitionEvent,
} from "../src/services/audit/fingerprint.js";
import type { FingerprintAnnotation } from "../src/services/audit/ledger-annotate.js";
import { computePendingVerify } from "../src/services/audit/ledger-annotate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_REGISTRY = path.join(REPO_ROOT, "docs", "audit-ledger", "registry.json");

function fail(message: string): never {
  console.error(`[audit-ledger-update] ${message}`);
  process.exit(1);
}

/** Parse --key value pairs after the subcommand. */
function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`Unexpected argument: ${a}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`Missing value for ${a}`);
    flags.set(a.slice(2), value);
    i++;
  }
  return flags;
}

// ---------------------------------------------------------------------------
// observe
// ---------------------------------------------------------------------------

/** Minimal prep-output shape observe depends on (SPEC §4 prep entry contract). */
interface PrepMarket {
  marketRef: string;
  staleSkip?: boolean;
  missingFromResponse?: boolean;
  fingerprints?: FingerprintAnnotation[];
}

interface PrepFile {
  meta?: { fetchedAt?: string };
  markets: PrepMarket[];
}

function cmdObserve(flags: Map<string, string>): void {
  const prepPath = flags.get("prep") ?? fail("observe requires --prep <path>");
  const registryPath = flags.get("registry") ?? DEFAULT_REGISTRY;
  const now = flags.get("now") ?? new Date().toISOString();
  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) fail(`--now is not a valid ISO timestamp: ${now}`);

  if (!fs.existsSync(prepPath)) fail(`Prep file not found: ${prepPath}`);
  const prep = JSON.parse(fs.readFileSync(prepPath, "utf8")) as PrepFile;
  if (!Array.isArray(prep.markets)) fail(`Invalid prep file (no markets array): ${prepPath}`);

  const registry: LedgerRegistry = loadRegistry(registryPath);

  // Fingerprints observed with fresh data; staleSkip / missing markets are
  // excluded so their ledger entries keep their state untouched (SPEC §4.3).
  const seenIds = new Set<FingerprintId>();
  const auditedRefs = new Set<string>();
  const seenDetails = new Map<FingerprintId, { marketRef: string; ann: FingerprintAnnotation }>();
  for (const market of prep.markets) {
    if (market.staleSkip || market.missingFromResponse) continue;
    auditedRefs.add(market.marketRef);
    for (const ann of market.fingerprints ?? []) {
      seenIds.add(ann.id);
      if (!seenDetails.has(ann.id)) seenDetails.set(ann.id, { marketRef: market.marketRef, ann });
    }
  }

  // 1. Auto-reopen expired accepted-difference / stale-source TTLs.
  const reopened: FingerprintId[] = [];
  for (const [id, entry] of Object.entries(registry.entries)) {
    if (isExpired(entry, nowDate)) {
      registry.entries[id] = transition(entry, { type: "reopen" });
      reopened.push(id);
    }
  }

  // 2. Auto-transition fixed-pending-rescrape by presence (computed BEFORE the
  //    seen-bumps below alter nothing state-related, but kept explicit).
  const pending = computePendingVerify(registry, seenIds, auditedRefs);
  for (const id of pending.stillPresent) {
    registry.entries[id] = transition(registry.entries[id], { type: "regressed" });
  }
  for (const id of pending.nowAbsent) {
    registry.entries[id] = transition(registry.entries[id], { type: "verified-absent" });
  }

  // 3. Bump seen entries; create new ones as "open" (mechanical severity null).
  const created: FingerprintId[] = [];
  let bumped = 0;
  for (const [id, { marketRef, ann }] of seenDetails) {
    const existing = registry.entries[id];
    if (existing) {
      registry.entries[id] = { ...existing, lastSeen: now, seenCount: existing.seenCount + 1 };
      bumped++;
    } else {
      const entry: LedgerEntry = {
        fingerprint: {
          marketRef,
          bookmaker: ann.bookmaker,
          kind: ann.kind,
          evidence: ann.evidence,
        },
        state: "open",
        severity: null,
        firstSeen: now,
        lastSeen: now,
        seenCount: 1,
        diagnosis: "",
        attempts: [],
        disposition: null,
      };
      registry.entries[id] = entry;
      created.push(id);
    }
  }

  registry.updatedAt = now;
  saveRegistry(registryPath, registry);

  console.log(
    JSON.stringify({
      registryPath,
      observed: seenIds.size,
      bumped,
      created,
      reopened,
      regressed: pending.stillPresent,
      verifiedFixed: pending.nowAbsent,
    }),
  );
}

// ---------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------

const EVIDENCE_KINDS: ReadonlySet<string> = new Set(["raw-dump", "live-probe", "judge", "manual"]);

function buildDisposition(flags: Map<string, string>): LedgerDisposition {
  const reason = flags.get("reason") ?? fail("this state requires --reason");
  const evidenceKind = flags.get("evidence-kind") ?? "manual";
  if (!EVIDENCE_KINDS.has(evidenceKind)) {
    fail(`--evidence-kind must be one of: ${[...EVIDENCE_KINDS].join(", ")}`);
  }
  const ttl = flags.get("ttl") ?? fail("this state requires --ttl <ISO>");
  if (Number.isNaN(Date.parse(ttl))) fail(`--ttl is not a valid ISO timestamp: ${ttl}`);
  return {
    reason,
    evidenceKind: evidenceKind as DispositionEvidenceKind,
    evidencePath: flags.get("evidence-path") ?? null,
    ttl,
  };
}

function cmdSet(flags: Map<string, string>): void {
  const id = flags.get("id") ?? fail("set requires --id <fingerprintId>");
  const state = flags.get("state") ?? fail("set requires --state <state>");
  const registryPath = flags.get("registry") ?? DEFAULT_REGISTRY;
  const now = new Date().toISOString();

  const registry = loadRegistry(registryPath);
  const entry = registry.entries[id];
  if (!entry) fail(`No ledger entry with id ${id} in ${registryPath}`);

  let event: TransitionEvent;
  switch (state) {
    case "accepted-difference":
      event = { type: "accept-difference", disposition: buildDisposition(flags) };
      break;
    case "stale-source":
      event = { type: "mark-stale-source", disposition: buildDisposition(flags) };
      break;
    case "fixed-pending-rescrape":
      event = { type: "fix-committed" };
      break;
    case "verified-fixed":
      event = { type: "verified-absent" };
      break;
    case "regressed":
      event = { type: "regressed" };
      break;
    case "open":
      // Two guarded roads back to open: TTL reopen or attempts-exhausted escalation.
      if (entry.state === "accepted-difference" || entry.state === "stale-source") {
        event = { type: "reopen" };
      } else if (entry.state === "attempted") {
        event = { type: "attempts-exhausted" };
      } else {
        fail(`Cannot set state "open" from "${entry.state}"`);
      }
      break;
    case "attempted":
      fail('Use the "attempt" subcommand to move an entry to "attempted"');
      break;
    default:
      fail(`Unknown target state: ${state}`);
  }

  let next = transition(entry, event);
  const diagnosis = flags.get("diagnosis");
  if (diagnosis !== undefined) next = { ...next, diagnosis };

  registry.entries[id] = next;
  registry.updatedAt = now;
  saveRegistry(registryPath, registry);
  console.log(JSON.stringify({ registryPath, id, from: entry.state, to: next.state }));
}

// ---------------------------------------------------------------------------
// attempt
// ---------------------------------------------------------------------------

function cmdAttempt(flags: Map<string, string>): void {
  const id = flags.get("id") ?? fail("attempt requires --id <fingerprintId>");
  const fixer = flags.get("fixer") ?? fail("attempt requires --fixer <name>");
  const note = flags.get("note") ?? fail("attempt requires --note <text>");
  const registryPath = flags.get("registry") ?? DEFAULT_REGISTRY;
  const now = new Date().toISOString();

  const registry = loadRegistry(registryPath);
  const entry = registry.entries[id];
  if (!entry) fail(`No ledger entry with id ${id} in ${registryPath}`);

  const next = transition(entry, {
    type: "attempt",
    attempt: { at: now, commit: flags.get("commit") ?? null, fixer, note },
  });
  registry.entries[id] = next;
  registry.updatedAt = now;
  saveRegistry(registryPath, registry);
  console.log(
    JSON.stringify({ registryPath, id, from: entry.state, to: next.state, attempts: next.attempts.length }),
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const [, , subcommand, ...rest] = process.argv;
  const flags = parseFlags(rest);
  switch (subcommand) {
    case "observe":
      cmdObserve(flags);
      break;
    case "set":
      cmdSet(flags);
      break;
    case "attempt":
      cmdAttempt(flags);
      break;
    default:
      fail(`Unknown subcommand "${subcommand ?? ""}". Use: observe | set | attempt`);
  }
}

try {
  main();
} catch (err) {
  if (err instanceof InvalidTransitionError) {
    fail(`Guard violation: ${err.message}`);
  }
  throw err;
}
