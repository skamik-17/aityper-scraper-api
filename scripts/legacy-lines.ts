/**
 * Plan 10 Part B: where the legacy 1X2 path (scrapeLeague & co.) still lives.
 *
 *   npx tsx scripts/legacy-lines.ts [--path <substring>] [--helpers]
 *
 * Prints `file:start-end Class.method (n)` per legacy method and
 * `TOTAL legacy method lines: N`; with --helpers also `file:start-end name (n)` per
 * exported helper only legacy code uses and `TOTAL legacy-only helper lines: N`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findLegacyMethods, findLegacyOnlyHelpers } from "../src/__tests__/helpers/legacy-scan.js";

const USAGE = "Usage: legacy-lines.ts [--path <substring>] [--helpers]";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main(argv: string[]): number {
  let path: string | undefined;
  let helpers = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--helpers") helpers = true;
    else if (argv[i] === "--path" && argv[i + 1] !== undefined) path = argv[++i];
    else {
      console.error(USAGE);
      return 2;
    }
  }
  const matches = (file: string) => path === undefined || file.includes(path) || `/${file}`.includes(path);

  let total = 0;
  for (const h of findLegacyMethods(ROOT).filter((x) => matches(x.file))) {
    const n = h.endLine - h.startLine + 1;
    total += n;
    console.log(`${h.file}:${h.startLine}-${h.endLine} ${h.className}.${h.method} (${n})`);
  }
  console.log(`TOTAL legacy method lines: ${total}`);

  if (helpers) {
    let helperTotal = 0;
    for (const h of findLegacyOnlyHelpers(ROOT, path)) {
      const n = h.endLine - h.startLine + 1;
      helperTotal += n;
      console.log(`${h.file}:${h.startLine}-${h.endLine} ${h.name} (${n})`);
    }
    console.log(`TOTAL legacy-only helper lines: ${helperTotal}`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
