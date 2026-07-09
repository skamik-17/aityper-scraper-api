/**
 * Coverage baseline builder (Audit Process v2, SPEC §8).
 *
 * Scans docs/audit-ledger/raw-archive/** (verbatim <bm>-prep-audit outputs,
 * one directory per bookmaker) and emits coverage.json:
 *
 *   { "<bookmaker>": { "<marketType>": ["<selectionCode>", ...] } }
 *
 * marketType is our normalized marketCode from the archive's `normalized`
 * section; selection codes come from the normalized selections. The output is
 * a monotonic union: it merges with an existing coverage.json and never
 * removes codes. Keys and code lists are sorted for reviewable diffs.
 *
 * Usage:
 *   npx tsx scripts/build-coverage-baseline.ts [--archive <dir>] [--out <path>] [--db]
 *
 * Options:
 *   --archive <dir>  Raw-archive root (default docs/audit-ledger/raw-archive)
 *   --out <path>     Output file (default docs/audit-ledger/coverage.json)
 *   --db             Additionally union live market_comparison rows (optional)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

type CoverageMap = Map<string, Map<string, Set<string>>>; // bookmaker -> marketType -> codes
type CoverageJson = Record<string, Record<string, string[]>>;

interface Args {
  archive: string;
  out: string;
  db: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    archive: path.join(REPO_ROOT, "docs", "audit-ledger", "raw-archive"),
    out: path.join(REPO_ROOT, "docs", "audit-ledger", "coverage.json"),
    db: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--archive") args.archive = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--db") args.db = true;
    else {
      console.error(`[build-coverage-baseline] Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function add(coverage: CoverageMap, bookmaker: string, marketType: string, code: string): void {
  const bm = bookmaker.toLowerCase().trim();
  const type = marketType.trim();
  const c = code.trim();
  if (!bm || !type || !c) return;
  if (!coverage.has(bm)) coverage.set(bm, new Map());
  const byType = coverage.get(bm)!;
  if (!byType.has(type)) byType.set(type, new Set());
  byType.get(type)!.add(c);
}

/** Seed the map from an existing coverage.json (monotonic merge, SPEC §8). */
function mergeExisting(coverage: CoverageMap, outPath: string): void {
  if (!fs.existsSync(outPath)) return;
  const existing = JSON.parse(fs.readFileSync(outPath, "utf8")) as CoverageJson;
  for (const [bookmaker, byType] of Object.entries(existing)) {
    for (const [marketType, codes] of Object.entries(byType)) {
      for (const code of codes) add(coverage, bookmaker, marketType, code);
    }
  }
}

/** Shape of the archive files we consume (verbatim <bm>-prep-audit output). */
interface ArchiveMarket {
  normalized?: {
    marketCode?: string | null;
    selections?: { code?: string | null }[] | null;
  } | null;
}

function scanArchive(coverage: CoverageMap, archiveDir: string): { files: number; markets: number } {
  let files = 0;
  let markets = 0;
  if (!fs.existsSync(archiveDir)) return { files, markets };

  for (const dirent of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue; // stray root files (e.g. event-urls.json) are not captures
    const bookmaker = dirent.name;
    const dir = path.join(archiveDir, bookmaker);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(dir, file);
      let parsed: { markets?: ArchiveMarket[] };
      try {
        parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (err) {
        console.error(`[build-coverage-baseline] Skipping unparseable ${filePath}: ${err}`);
        continue;
      }
      if (!Array.isArray(parsed.markets)) continue;
      files++;
      for (const market of parsed.markets) {
        const normalized = market.normalized;
        if (!normalized?.marketCode) continue; // unrecognized raw markets carry no coverage info
        markets++;
        for (const sel of normalized.selections ?? []) {
          if (sel?.code) add(coverage, bookmaker, normalized.marketCode, sel.code);
        }
      }
    }
  }
  return { files, markets };
}

/** Optionally union live DB rows (market_comparison normalized selections). */
async function scanDb(coverage: CoverageMap): Promise<number> {
  const { getSupabase } = await import("../src/config/database.js");
  const sb = getSupabase();
  const PAGE = 1000;
  let from = 0;
  let rows = 0;
  for (;;) {
    const { data, error } = await (sb as any)
      .from("market_comparison")
      .select("bookmaker, market_code, selections")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`market_comparison query failed: ${error.message ?? error}`);
    if (!data || data.length === 0) break;
    for (const row of data as any[]) {
      if (!row.bookmaker || !row.market_code || !Array.isArray(row.selections)) continue;
      rows++;
      for (const sel of row.selections) {
        const code = sel?.normalizedName;
        if (typeof code === "string" && code && code !== "UNKNOWN") {
          add(coverage, row.bookmaker, row.market_code, code);
        }
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

function serialize(coverage: CoverageMap): string {
  const out: CoverageJson = {};
  for (const bookmaker of [...coverage.keys()].sort()) {
    const byType = coverage.get(bookmaker)!;
    out[bookmaker] = {};
    for (const marketType of [...byType.keys()].sort()) {
      out[bookmaker][marketType] = [...byType.get(marketType)!].sort();
    }
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const coverage: CoverageMap = new Map();

  mergeExisting(coverage, args.out);
  const { files, markets } = scanArchive(coverage, args.archive);
  let dbRows = 0;
  if (args.db) dbRows = await scanDb(coverage);

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, serialize(coverage), "utf8");

  let totalCodes = 0;
  for (const byType of coverage.values()) for (const codes of byType.values()) totalCodes += codes.size;

  console.log(
    JSON.stringify({
      out: args.out,
      archiveFiles: files,
      archiveMarkets: markets,
      dbRows,
      bookmakers: [...coverage.keys()].sort(),
      totalCodes,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[build-coverage-baseline] FATAL:", err);
    process.exit(1);
  });
