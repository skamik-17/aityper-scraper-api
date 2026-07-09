/**
 * Golden-fixture regression tests (Audit Process v2, SPEC §6).
 *
 * For every fixture dir under __fixtures__/<bookmaker>/, re-run that
 * bookmaker's normalizer on each frozen raw entry and deep-equal the projected
 * output against <matchIdSafe>.expected.json wherever `blessed === true`.
 * Entries with `blessed === false` are counted and logged but never fail.
 *
 * Fixtures are produced by `scripts/harvest-fixtures.ts` from raw-archive
 * captures — no network, no DB, no scraping here.
 *
 * FIXER-CONTRACT: every test name starts with the bookmaker directory name, so
 * fixers can filter with:
 *   npx vitest run src/services/normalization/__tests__/golden.test.ts -t "<bm>"
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as bookmakerNormalizers from "../bookmakers/index.js";
import type {
  BookmakerMarketNormalizer,
  NormalizationContext,
  NormalizedMarketOutput,
  RawBookmakerMarket,
} from "../types.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");
/** Big fixtures (superbet: ~3700 entries) need more than the global 10s. */
const PER_FIXTURE_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Fixture file shapes (as written by scripts/harvest-fixtures.ts)
// ---------------------------------------------------------------------------

interface FixtureRawMarket {
  name: string;
  groupName?: string;
  groupId?: string;
  bookmakerMarketId?: string | number;
  paramValue?: string | null;
  selections: { name: string; odds: number }[];
}

interface FixtureFile {
  bookmaker: string;
  matchId: string;
  matchIdSafe: string;
  sourceArchive: string;
  ctx: NormalizationContext;
  entries: { index: number; raw: FixtureRawMarket }[];
}

interface ExpectedNormalized {
  marketCode: string;
  marketKey: string;
  paramValue: string | null;
  parameters: string[] | null;
  customLabel: string | null;
  matchedBy: string | null;
  selections: { code: string; label: string; odds: number }[];
}

interface ExpectedFile {
  bookmaker: string;
  matchIdSafe: string;
  entries: {
    index: number;
    rawName: string;
    marketCode: string;
    blessed: boolean;
    expected: ExpectedNormalized | null;
  }[];
}

// ---------------------------------------------------------------------------
// Shared helpers (KEEP IN SYNC with scripts/harvest-fixtures.ts)
// ---------------------------------------------------------------------------

/**
 * Rebuild the RawBookmakerMarket the normalizer consumes from a frozen raw
 * block. Mirrors scraper-audit-core's scrapedMarketsToRaw semantics: empty
 * strings written by the archiver stand for "absent" and become undefined.
 * KEEP IN SYNC with the copy in scripts/harvest-fixtures.ts.
 */
function toRawBookmakerMarket(raw: FixtureRawMarket): RawBookmakerMarket {
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
 * KEEP IN SYNC with the copy in scripts/harvest-fixtures.ts.
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
// Compact first-difference reporter (avoids dumping whole markets on failure)
// ---------------------------------------------------------------------------

function firstDiff(actual: unknown, expected: unknown, path = "$"): string | null {
  if (Object.is(actual, expected)) return null;
  const ta = actual === null ? "null" : typeof actual;
  const te = expected === null ? "null" : typeof expected;
  if (ta !== te || typeof actual !== "object" || actual === null || expected === null) {
    return `${path}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return `${path}: array/object mismatch`;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      return `${path}.length: actual=${actual.length} expected=${expected.length}`;
    }
    for (let i = 0; i < actual.length; i++) {
      const d = firstDiff(actual[i], expected[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(e)])) {
    const d = firstDiff(a[key], e[key], `${path}.${key}`);
    if (d) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test generation
// ---------------------------------------------------------------------------

const bookmakerDirs = existsSync(FIXTURES_ROOT)
  ? readdirSync(FIXTURES_ROOT).filter((name) =>
      statSync(join(FIXTURES_ROOT, name)).isDirectory(),
    ).sort()
  : [];

describe("golden fixtures", () => {
  if (bookmakerDirs.length === 0) {
    it("no fixtures harvested yet", () => {
      expect(bookmakerDirs).toEqual([]);
    });
    return;
  }

  for (const bm of bookmakerDirs) {
    describe(bm, () => {
      const dir = join(FIXTURES_ROOT, bm);
      const fixtureFiles = readdirSync(dir)
        .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
        .sort();

      it(`${bm} has at least one fixture pair`, () => {
        expect(fixtureFiles.length).toBeGreaterThan(0);
        for (const f of fixtureFiles) {
          expect(existsSync(join(dir, f.replace(/\.json$/, ".expected.json")))).toBe(true);
        }
      });

      for (const file of fixtureFiles) {
        const matchIdSafe = file.replace(/\.json$/, "");
        it(
          `${bm} ${matchIdSafe}: blessed entries match current normalizer output`,
          () => {
            const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as FixtureFile;
            const expectedFile = JSON.parse(
              readFileSync(join(dir, `${matchIdSafe}.expected.json`), "utf8"),
            ) as ExpectedFile;

            const normalizer = (bookmakerNormalizers as Record<string, unknown>)[
              `${bm}Normalizer`
            ] as BookmakerMarketNormalizer | undefined;
            expect(
              normalizer && typeof normalizer.normalizeMarket === "function",
              `missing normalizer export "${bm}Normalizer" in bookmakers/index.ts`,
            ).toBe(true);

            const rawByIndex = new Map(fixture.entries.map((e) => [e.index, e.raw]));
            const failures: string[] = [];
            let blessedCount = 0;
            let unblessedCount = 0;

            for (const entry of expectedFile.entries) {
              const raw = rawByIndex.get(entry.index);
              if (!raw) {
                failures.push(
                  `#${entry.index} "${entry.rawName}": no matching raw entry in fixture file`,
                );
                continue;
              }
              if (!entry.blessed) {
                unblessedCount++;
                console.log(
                  `[golden] ${bm} unblessed #${entry.index} [${entry.marketCode}] ${entry.rawName}`,
                );
                continue;
              }
              blessedCount++;
              const normalized = normalizer!.normalizeMarket(
                toRawBookmakerMarket(raw),
                fixture.ctx,
              );
              // Same JSON round-trip the harvester applies before freezing.
              const actual = JSON.parse(
                JSON.stringify(projectNormalized(normalized)),
              ) as ExpectedNormalized | null;
              const diff = firstDiff(actual, entry.expected);
              if (diff) {
                failures.push(`#${entry.index} "${entry.rawName}": ${diff}`);
              }
            }
            // Expected entries without raw counterpart are caught above; also
            // catch raw entries missing from expected (corrupted pair).
            const expectedIdx = new Set(expectedFile.entries.map((e) => e.index));
            for (const entry of fixture.entries) {
              if (!expectedIdx.has(entry.index)) {
                failures.push(
                  `#${entry.index} "${entry.raw.name}": no expected entry (re-run harvester)`,
                );
              }
            }

            console.log(
              `[golden] ${bm}/${matchIdSafe}: entries=${expectedFile.entries.length} ` +
                `blessed=${blessedCount} unblessed=${unblessedCount} failures=${failures.length}`,
            );
            if (failures.length > 0) {
              throw new Error(
                `${failures.length} blessed entr${failures.length === 1 ? "y" : "ies"} of ` +
                  `${bm}/${matchIdSafe} diverged from expected:\n  ${failures
                    .slice(0, 40)
                    .join("\n  ")}${failures.length > 40 ? `\n  ... +${failures.length - 40} more` : ""}`,
              );
            }
          },
          PER_FIXTURE_TIMEOUT_MS,
        );
      }
    });
  }
});
