#!/usr/bin/env npx tsx
/**
 * Golden-fixture re-bless (in place, no re-scrape).
 *
 * Recomputes the normalizer output for every entry of an already-committed
 * fixture pair and rewrites ONLY the entries whose projection changed, keeping
 * each entry's `blessed` flag untouched. Use it after a deliberate normalizer
 * fix, when the frozen raw inputs are still valid and re-harvesting from a live
 * scrape would be pure noise.
 *
 * Usage:
 *   npx tsx scripts/rebless-golden.ts --bookmaker lvbet [--fixture <matchIdSafe>] [--dry]
 *   npx tsx scripts/rebless-golden.ts --all --dry
 *
 * Only entries with `blessed: true` are refreshed (those are the ones
 * golden.test.ts asserts); pass --include-unblessed to refresh the rest too.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as bookmakerNormalizers from "../src/services/normalization/bookmakers/index.js";
import type {
  BookmakerMarketNormalizer,
  NormalizedMarketOutput,
  NormalizationContext,
  RawBookmakerMarket,
} from "../src/services/normalization/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, "..", "src", "services", "normalization", "__fixtures__");

interface FixtureRawMarket {
  bookmakerMarketId?: string | number;
  name: string;
  groupName?: string;
  paramValue?: string;
  selections: { name: string; odds: number }[];
}
interface FixtureFile {
  ctx: NormalizationContext;
  entries: { index: number; raw: FixtureRawMarket }[];
}
interface ExpectedEntry {
  index: number;
  rawName: string;
  marketCode: string;
  blessed: boolean;
  expected: unknown;
}
interface ExpectedFile {
  entries: ExpectedEntry[];
  [k: string]: unknown;
}

/** KEEP IN SYNC with toRawBookmakerMarket in __tests__/golden.test.ts. */
function toRawBookmakerMarket(raw: FixtureRawMarket): RawBookmakerMarket {
  return {
    bookmakerMarketId: raw.bookmakerMarketId ? String(raw.bookmakerMarketId) : undefined,
    name: raw.name,
    groupName: raw.groupName || undefined,
    paramValue: raw.paramValue || undefined,
    selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
  };
}

/** Key-order-independent comparison/serialisation (the committed fixtures are written with sorted keys). */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** KEEP IN SYNC with projectNormalized in __tests__/golden.test.ts. */
function projectNormalized(out: NormalizedMarketOutput | null): unknown {
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

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  return {
    bookmaker: get("--bookmaker"),
    fixture: get("--fixture"),
    all: argv.includes("--all"),
    dry: argv.includes("--dry"),
    includeUnblessed: argv.includes("--include-unblessed"),
  };
}

function main() {
  const args = parseArgs();
  if (!args.all && !args.bookmaker) {
    console.error("Usage: --bookmaker <bm> [--fixture <matchIdSafe>] [--dry]  |  --all [--dry]");
    process.exit(1);
  }
  const bookmakers = args.all
    ? readdirSync(FIXTURES_ROOT).filter((n) => statSync(join(FIXTURES_ROOT, n)).isDirectory())
    : [args.bookmaker!];

  let changedTotal = 0;
  for (const bm of bookmakers.sort()) {
    const dir = join(FIXTURES_ROOT, bm);
    if (!existsSync(dir)) {
      console.error(`[rebless] no fixtures for ${bm}`);
      continue;
    }
    const normalizer = (bookmakerNormalizers as Record<string, unknown>)[`${bm}Normalizer`] as
      | BookmakerMarketNormalizer
      | undefined;
    if (!normalizer) {
      console.error(`[rebless] missing normalizer export "${bm}Normalizer"`);
      continue;
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
      .filter((f) => !args.fixture || f === `${args.fixture}.json`);

    for (const file of files) {
      const matchIdSafe = file.replace(/\.json$/, "");
      const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as FixtureFile;
      const expectedPath = join(dir, `${matchIdSafe}.expected.json`);
      const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as ExpectedFile;
      const rawByIndex = new Map(fixture.entries.map((m) => [m.index, m.raw]));

      const changed: string[] = [];
      for (const entry of expected.entries) {
        // Only blessed entries are asserted by golden.test.ts. Unblessed rows
        // are informational and may legitimately drift, so leave them alone —
        // refreshing them would bury the real diff in unrelated churn.
        if (!entry.blessed && !args.includeUnblessed) continue;
        const raw = rawByIndex.get(entry.index);
        if (!raw) continue;
        const out = normalizer.normalizeMarket(toRawBookmakerMarket(raw), fixture.ctx);
        const actual = projectNormalized(out);
        if (JSON.stringify(stable(actual)) !== JSON.stringify(stable(entry.expected))) {
          changed.push(entry.rawName);
          entry.expected = stable(actual);
          if (out?.marketCode) entry.marketCode = out.marketCode;
        }
      }
      if (changed.length === 0) continue;
      changedTotal += changed.length;
      console.error(
        `[rebless] ${bm}/${matchIdSafe}: ${changed.length} entr${changed.length === 1 ? "y" : "ies"} updated`,
      );
      for (const name of changed.slice(0, 20)) console.error(`    - ${name}`);
      if (!args.dry) writeFileSync(expectedPath, `${JSON.stringify(expected, null, 2)}\n`);
    }
  }
  console.log(JSON.stringify({ changedTotal, dry: args.dry }));
}

main();
