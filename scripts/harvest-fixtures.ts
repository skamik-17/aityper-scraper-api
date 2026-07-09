#!/usr/bin/env npx tsx
/**
 * Golden-fixture harvester (Audit Process v2, SPEC §6).
 *
 * Converts a `<bm>-prep-audit` raw-archive file (verbatim PrepAuditOutput with
 * `markets[].{raw,normalized}`) into a pair of committed fixture files:
 *
 *   backend/src/services/normalization/__fixtures__/<bm>/<matchIdSafe>.json
 *     raw inputs + minimal normalization ctx (frozen scrape snapshot)
 *   backend/src/services/normalization/__fixtures__/<bm>/<matchIdSafe>.expected.json
 *     CURRENT normalizer outputs per entry, each carrying `blessed: boolean`
 *
 * Blessing policy (SPEC §6): `blessed = false` when the ledger registry has an
 * entry in state open/attempted/regressed whose fingerprint.bookmaker matches
 * this bookmaker (lowercase; comma-joined lists are split) AND whose
 * fingerprint.marketRef contains the entry's normalized marketCode; else true.
 *
 * Usage (cwd may be backend/ or the repo root; paths may be relative or absolute):
 *   npx tsx scripts/harvest-fixtures.ts --archive <raw-archive file>
 *     [--out-dir <fixtures root>]        default: backend/src/services/normalization/__fixtures__
 *     [--registry <path>]                default: docs/audit-ledger/registry.json
 *     [--bookmaker <bm>]                 default: archive's parent directory name
 *     [--bless-all]                      force blessed=true on every harvested entry
 *     [--bless "<rawName>"]              refresh expected + force blessed=true for that raw market only
 *     [--only "<rawName>"]               harvest/refresh that raw market only (policy blessing)
 *
 * `--bless`/`--only` are selective: when the fixture pair already exists, only
 * the matching entries are refreshed (merged by archive index) and every other
 * entry is kept byte-identical — a fixer re-blessing one market never rewrites
 * unrelated expected outputs. Both flags may repeat. Raw-name matching is
 * case-insensitive: exact (trimmed) match first, substring fallback.
 *
 * Output is deterministic: recursively sorted object keys, 2-space indent,
 * trailing newline. No timestamps are written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as bookmakerNormalizers from "../src/services/normalization/bookmakers/index.js";
import { loadRegistry, type LedgerRegistry } from "../src/services/audit/fingerprint.js";
import type {
  BookmakerMarketNormalizer,
  NormalizationContext,
  NormalizedMarketOutput,
  RawBookmakerMarket,
} from "../src/services/normalization/types.js";

// ---------------------------------------------------------------------------
// Archive / fixture file shapes
// ---------------------------------------------------------------------------

interface ArchiveSelection {
  name: string;
  odds: number;
}

/** Raw market block exactly as archived by the prep-audit scripts. */
interface ArchiveRawMarket {
  name: string;
  groupName?: string;
  groupId?: string;
  bookmakerMarketId?: string | number;
  /** Not archived today (prep drops it); kept for forward compatibility. */
  paramValue?: string | null;
  selections: ArchiveSelection[];
}

interface ArchiveMarketEntry {
  index: number;
  raw: ArchiveRawMarket;
}

interface ArchiveFile {
  meta: {
    matchId: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
  };
  markets: ArchiveMarketEntry[];
}

/** Projection of NormalizedMarketOutput frozen into .expected.json. */
interface ExpectedNormalized {
  marketCode: string;
  marketKey: string;
  paramValue: string | null;
  parameters: string[] | null;
  customLabel: string | null;
  matchedBy: string | null;
  selections: { code: string; label: string; odds: number }[];
}

interface FixtureEntry {
  index: number;
  raw: ArchiveRawMarket;
}

interface FixtureFile {
  bookmaker: string;
  matchId: string;
  matchIdSafe: string;
  sourceArchive: string;
  ctx: NormalizationContext;
  entries: FixtureEntry[];
}

interface ExpectedEntry {
  index: number;
  rawName: string;
  /** Convenience copy of expected.marketCode ("OTHER" when expected is null). */
  marketCode: string;
  blessed: boolean;
  expected: ExpectedNormalized | null;
}

interface ExpectedFile {
  bookmaker: string;
  matchIdSafe: string;
  entries: ExpectedEntry[];
}

// ---------------------------------------------------------------------------
// Shared helpers (KEEP IN SYNC with __tests__/golden.test.ts)
// ---------------------------------------------------------------------------

/**
 * Rebuild the RawBookmakerMarket the normalizer consumes from an archived raw
 * block. Mirrors scraper-audit-core's scrapedMarketsToRaw semantics: empty
 * strings written by the archiver stand for "absent" and become undefined.
 * KEEP IN SYNC with the copy in __tests__/golden.test.ts.
 */
function toRawBookmakerMarket(raw: ArchiveRawMarket): RawBookmakerMarket {
  return {
    bookmakerMarketId: raw.bookmakerMarketId ? String(raw.bookmakerMarketId) : undefined,
    name: raw.name,
    groupName: raw.groupName || undefined,
    paramValue: raw.paramValue || undefined,
    selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
  };
}

/**
 * Project a normalizer output onto the stable expected shape (volatile debug
 * fields stripped; odds kept — they come from the frozen fixture).
 * KEEP IN SYNC with the copy in __tests__/golden.test.ts.
 */
function projectNormalized(out: NormalizedMarketOutput | null): ExpectedNormalized | null {
  if (!out) return null;
  return {
    marketCode: out.marketCode,
    marketKey: out.marketKey,
    paramValue: out.paramValue ?? null,
    parameters: out.parameters ?? null,
    customLabel: out.customLabel ?? null,
    matchedBy: out.debug?.matchedBy ?? null,
    selections: out.selections.map((s) => ({
      code: String(s.code),
      label: s.label,
      odds: s.odds,
    })),
  };
}

// ---------------------------------------------------------------------------
// Deterministic JSON output
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

function writeDeterministicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** This script lives at <repoRoot>/backend/scripts/. */
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

function resolveFromCwd(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  archive: string;
  outDir: string;
  registry: string;
  bookmaker?: string;
  blessAll: boolean;
  bless: string[];
  only: string[];
}

function usage(): never {
  console.error(
    'Usage: npx tsx scripts/harvest-fixtures.ts --archive <raw-archive file> ' +
      '[--out-dir <fixtures root>] [--registry <path>] [--bookmaker <bm>] ' +
      '[--bless-all] [--bless "<rawName>"]... [--only "<rawName>"]...',
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  let archive: string | undefined;
  let outDir = join(REPO_ROOT, "backend", "src", "services", "normalization", "__fixtures__");
  let registry = join(REPO_ROOT, "docs", "audit-ledger", "registry.json");
  let bookmaker: string | undefined;
  let blessAll = false;
  const bless: string[] = [];
  const only: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) usage();
      return v;
    };
    switch (flag) {
      case "--archive":
        archive = resolveFromCwd(next());
        break;
      case "--out-dir":
        outDir = resolveFromCwd(next());
        break;
      case "--registry":
        registry = resolveFromCwd(next());
        break;
      case "--bookmaker":
        bookmaker = next().toLowerCase();
        break;
      case "--bless-all":
        blessAll = true;
        break;
      case "--bless":
        bless.push(next());
        break;
      case "--only":
        only.push(next());
        break;
      default:
        console.error(`Unknown flag: ${flag}`);
        usage();
    }
  }
  if (!archive) usage();
  return { archive, outDir, registry, bookmaker, blessAll, bless, only };
}

// ---------------------------------------------------------------------------
// Bless policy
// ---------------------------------------------------------------------------

const UNRESOLVED_STATES = new Set(["open", "attempted", "regressed"]);

/**
 * marketRefs of unresolved ledger entries for this bookmaker. Comma-joined
 * fingerprint.bookmaker values (multi-culprit entries) are split.
 */
function unresolvedMarketRefs(registry: LedgerRegistry, bookmaker: string): string[] {
  const refs: string[] = [];
  for (const entry of Object.values(registry.entries)) {
    if (!UNRESOLVED_STATES.has(entry.state)) continue;
    const owner = entry.fingerprint.bookmaker;
    if (!owner) continue;
    const owners = owner.toLowerCase().split(",").map((s) => s.trim());
    if (!owners.includes(bookmaker)) continue;
    refs.push(entry.fingerprint.marketRef);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Raw-name selection (--bless / --only)
// ---------------------------------------------------------------------------

/** Indexes of archive entries matching a raw-name arg: exact first, then substring. */
function matchIndexesByRawName(markets: ArchiveMarketEntry[], nameArg: string): number[] {
  const wanted = nameArg.trim().toLowerCase();
  const exact = markets
    .filter((m) => m.raw.name.trim().toLowerCase() === wanted)
    .map((m) => m.index);
  if (exact.length > 0) return exact;
  return markets
    .filter((m) => m.raw.name.toLowerCase().includes(wanted))
    .map((m) => m.index);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function deriveMatchIdSafe(archivePath: string, meta: ArchiveFile["meta"]): string {
  // Archive naming rule (SPEC §0): <matchIdSafe>__<YYYY-MM-DD>.json
  const m = basename(archivePath).match(/^(.+?)__\d{4}-\d{2}-\d{2}\.json$/);
  if (m) return m[1];
  return meta.matchId.replace(/[^a-z0-9_-]+/gi, "_");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.archive)) {
    console.error(`[harvest] Archive not found: ${args.archive}`);
    process.exit(1);
  }
  const archive = JSON.parse(readFileSync(args.archive, "utf8")) as ArchiveFile;
  if (!archive.meta || !Array.isArray(archive.markets)) {
    console.error(`[harvest] Not a prep-audit archive (missing meta/markets): ${args.archive}`);
    process.exit(1);
  }

  const bookmaker = (args.bookmaker ?? basename(dirname(args.archive))).toLowerCase();
  const normalizer = (bookmakerNormalizers as Record<string, unknown>)[
    `${bookmaker}Normalizer`
  ] as BookmakerMarketNormalizer | undefined;
  if (!normalizer || typeof normalizer.normalizeMarket !== "function") {
    console.error(
      `[harvest] No normalizer export "${bookmaker}Normalizer" in ` +
        `src/services/normalization/bookmakers/index.ts (use --bookmaker to override)`,
    );
    process.exit(1);
  }

  const registry = loadRegistry(args.registry);
  const openRefs = unresolvedMarketRefs(registry, bookmaker);
  const blessedByPolicy = (marketCode: string): boolean =>
    !openRefs.some((ref) => ref.includes(marketCode));

  const matchIdSafe = deriveMatchIdSafe(args.archive, archive.meta);
  // Reconstruct the normalization ctx exactly like the prep-audit scripts do.
  const ctx: NormalizationContext = {
    homeTeam: archive.meta.homeTeam,
    awayTeam: archive.meta.awayTeam,
    leagueName: archive.meta.league,
    league: archive.meta.league,
  };

  // --- Select entries to (re)harvest -------------------------------------
  const selectionArgs = [...args.only, ...args.bless];
  const selective = selectionArgs.length > 0;
  let targetIndexes: Set<number>;
  if (selective) {
    targetIndexes = new Set<number>();
    for (const nameArg of selectionArgs) {
      const hits = matchIndexesByRawName(archive.markets, nameArg);
      if (hits.length === 0) {
        console.error(`[harvest] No archive market matches raw name: "${nameArg}"`);
        process.exit(1);
      }
      for (const idx of hits) targetIndexes.add(idx);
    }
  } else {
    targetIndexes = new Set(archive.markets.map((m) => m.index));
  }

  const blessIndexes = new Set<number>();
  for (const nameArg of args.bless) {
    for (const idx of matchIndexesByRawName(archive.markets, nameArg)) blessIndexes.add(idx);
  }

  // --- Harvest the selected entries ---------------------------------------
  const harvestedFixture = new Map<number, FixtureEntry>();
  const harvestedExpected = new Map<number, ExpectedEntry>();
  for (const entry of archive.markets) {
    if (!targetIndexes.has(entry.index)) continue;
    const normalized = normalizer.normalizeMarket(toRawBookmakerMarket(entry.raw), ctx);
    // JSON round-trip so the frozen expected matches what a re-run compares
    // against after file serialization (undefined/NaN handling).
    const expected = JSON.parse(
      JSON.stringify(projectNormalized(normalized)),
    ) as ExpectedNormalized | null;
    const marketCode = expected?.marketCode ?? "OTHER";
    const blessed = args.blessAll || blessIndexes.has(entry.index) || blessedByPolicy(marketCode);
    harvestedFixture.set(entry.index, { index: entry.index, raw: entry.raw });
    harvestedExpected.set(entry.index, {
      index: entry.index,
      rawName: entry.raw.name,
      marketCode,
      blessed,
      expected,
    });
  }

  // --- Merge with existing files in selective mode ------------------------
  const bmDir = join(args.outDir, bookmaker);
  const fixturePath = join(bmDir, `${matchIdSafe}.json`);
  const expectedPath = join(bmDir, `${matchIdSafe}.expected.json`);

  let fixtureEntries = [...harvestedFixture.values()];
  let expectedEntries = [...harvestedExpected.values()];
  if (selective && existsSync(fixturePath) && existsSync(expectedPath)) {
    const existingFixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureFile;
    const existingExpected = JSON.parse(readFileSync(expectedPath, "utf8")) as ExpectedFile;
    if (existingFixture.sourceArchive !== basename(args.archive)) {
      console.error(
        `[harvest] WARNING: existing fixture was harvested from ` +
          `"${existingFixture.sourceArchive}" but --archive is "${basename(args.archive)}"; ` +
          `entry indexes are merged positionally and may not line up.`,
      );
    }
    const mergedFixture = new Map<number, FixtureEntry>(
      existingFixture.entries.map((e) => [e.index, e]),
    );
    const mergedExpected = new Map<number, ExpectedEntry>(
      existingExpected.entries.map((e) => [e.index, e]),
    );
    for (const [idx, e] of harvestedFixture) mergedFixture.set(idx, e);
    for (const [idx, e] of harvestedExpected) mergedExpected.set(idx, e);
    fixtureEntries = [...mergedFixture.values()];
    expectedEntries = [...mergedExpected.values()];
  } else if (selective) {
    console.error(
      `[harvest] NOTE: fixture pair did not exist yet — writing only the ` +
        `${harvestedFixture.size} selected entr${harvestedFixture.size === 1 ? "y" : "ies"}.`,
    );
  }
  fixtureEntries.sort((a, b) => a.index - b.index);
  expectedEntries.sort((a, b) => a.index - b.index);

  const fixtureFile: FixtureFile = {
    bookmaker,
    matchId: archive.meta.matchId,
    matchIdSafe,
    sourceArchive: basename(args.archive),
    ctx,
    entries: fixtureEntries,
  };
  const expectedFile: ExpectedFile = {
    bookmaker,
    matchIdSafe,
    entries: expectedEntries,
  };

  writeDeterministicJson(fixturePath, fixtureFile);
  writeDeterministicJson(expectedPath, expectedFile);

  const blessedCount = expectedEntries.filter((e) => e.blessed).length;
  console.error(`[harvest] Wrote ${fixturePath}`);
  console.error(`[harvest] Wrote ${expectedPath}`);
  console.log(
    JSON.stringify(
      {
        bookmaker,
        matchIdSafe,
        fixturePath,
        expectedPath,
        entries: expectedEntries.length,
        blessed: blessedCount,
        unblessed: expectedEntries.length - blessedCount,
        refreshed: harvestedExpected.size,
        openLedgerRefs: openRefs.length,
      },
      null,
      2,
    ),
  );
}

main();
