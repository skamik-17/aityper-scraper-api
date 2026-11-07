/**
 * No committed golden fixture may freeze a placeholder selection `externalId`
 * (the "undefined" that `String(undefined)` makes when a payload loses its id).
 * `buildPrepAuditOutput` drops placeholders before archiving
 * (`src/services/audit/placeholder-external-id.ts`); this pins the same rule at
 * the fixture gate, for archives built any other way.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPlaceholderExternalId } from "../../audit/placeholder-external-id.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");

interface FixtureFile {
  entries: { index: number; raw: { name: string; selections: { name: string; externalId?: string }[] } }[];
}

describe("golden fixture raw externalIds", () => {
  it("no fixture raw selection carries a placeholder externalId", () => {
    const offenders: string[] = [];
    const dirs = existsSync(FIXTURES_ROOT)
      ? readdirSync(FIXTURES_ROOT).filter((d) => statSync(join(FIXTURES_ROOT, d)).isDirectory())
      : [];
    for (const bm of dirs) {
      for (const file of readdirSync(join(FIXTURES_ROOT, bm))) {
        if (!file.endsWith(".json") || file.endsWith(".expected.json")) continue;
        const fixture = JSON.parse(readFileSync(join(FIXTURES_ROOT, bm, file), "utf8")) as FixtureFile;
        for (const entry of fixture.entries) {
          for (const s of entry.raw.selections) {
            if (s.externalId !== undefined && isPlaceholderExternalId(s.externalId)) {
              offenders.push(`${bm}/${file} #${entry.index} "${entry.raw.name}" / "${s.name}": ${JSON.stringify(s.externalId)}`);
            }
          }
        }
      }
    }
    expect(offenders.slice(0, 20)).toEqual([]);
  });
});
