/**
 * Plan 10 Part B guard: the legacy 1X2 path (scrapeLeague & co.) only shrinks.
 * Tasks 14-16 remove directories from ALLOWED as they delete each group's methods.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportedNames, findLegacyCalls, findLegacyMethods, legacyDirOf } from "../../__tests__/helpers/legacy-scan.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

// Every legacyDirOf(...) the scan reports at this commit (`npx tsx scripts/legacy-lines.ts`)
const ALLOWED = new Set([
  "bookmakers/betclic",
  "bookmakers/betcris",
  "bookmakers/betfan",
  "bookmakers/etoto",
  "bookmakers/forbet",
  "bookmakers/fortuna",
  "bookmakers/fuksiarz",
  "bookmakers/lvbet",
  "bookmakers/pzbuk",
  "bookmakers/sts",
  "bookmakers/superbet",
  "bookmakers/totalbet",
  "shared/betby",
]);

describe("legacy 1X2 path", () => {
  it("legacy 1X2 methods exist only in allowed directories", () =>
    expect([...new Set(findLegacyMethods(ROOT).map((h) => legacyDirOf(h.file)))].filter((d) => !ALLOWED.has(d))).toEqual([]));

  it("nothing calls a legacy 1X2 method", () => expect(findLegacyCalls(ROOT)).toEqual([]));

  it("test-scrapers.sh calls no legacy method", () =>
    expect(readFileSync(join(ROOT, "scripts/test-scrapers.sh"), "utf8")).not.toMatch(/\.(scrapeLeague|scrapeMatchDetails|scrapeMatch|extractEventUrls)\(/));

  it("aggregator exports no legacy runner", () => {
    const names = exportedNames(ROOT, "src/scrapers/aggregator.ts");
    for (const n of ["runAllScrapers", "runSingleScraper", "AggregatedResult"]) expect(names).not.toContain(n);
    expect(names).toContain("getScraper");
  });
});
