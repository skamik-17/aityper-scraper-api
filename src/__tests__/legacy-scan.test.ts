import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exportedNames,
  findLegacyCalls,
  findLegacyMethods,
  findLegacyOnlyHelpers,
  legacyDirOf,
  LEGACY_METHODS,
} from "./helpers/legacy-scan.js";

let root: string;
const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "legacy-scan-"));
  write(
    "src/scrapers/bookmakers/x/index.ts",
    [
      'import { parse1, parseAll } from "./parser.js";',
      "export class X {",
      "  scrapeLeague() { return parse1(); }",
      "  scrapeFullOffer() { return parseAll(); }",
      "}",
      "",
    ].join("\n"),
  );
  write(
    "src/scrapers/bookmakers/x/parser.ts",
    ["export function parse1(): number {", "  return 1;", "}", "export function parseAll(): number {", "  return 2;", "}", ""].join("\n"),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("legacy scan", () => {
  it("lists the six legacy method names", () =>
    expect([...LEGACY_METHODS].sort()).toEqual(
      ["extractEventUrls", "scrapeEkstraklasa", "scrapeLeague", "scrapeMatch", "scrapeMatchDetails", "scrapePremierLeague"].sort(),
    ));

  it("finds legacy methods with a body", () =>
    expect(findLegacyMethods(root)).toEqual([
      { file: "src/scrapers/bookmakers/x/index.ts", className: "X", method: "scrapeLeague", startLine: 3, endLine: 3 },
    ]));

  it("an optional declaration without a body is not a hit", () => {
    write("src/scrapers/base/base.ts", "export abstract class B {\n  scrapeLeague?(league: string): Promise<number>;\n}\n");
    expect(findLegacyMethods(root).map((h) => h.file)).toEqual(["src/scrapers/bookmakers/x/index.ts"]);
  });

  it("finds helpers only legacy methods use", () => {
    expect(findLegacyOnlyHelpers(root).map((h) => [h.file, h.name, h.startLine, h.endLine])).toEqual([
      ["src/scrapers/bookmakers/x/parser.ts", "parse1", 1, 3],
    ]);
    write("scripts/use.ts", 'import { parse1 } from "../src/scrapers/bookmakers/x/parser.js";\nconsole.log(parse1());\n');
    expect(findLegacyOnlyHelpers(root)).toEqual([]);
  });

  it("follows helpers used only by other legacy-only helpers", () => {
    write(
      "src/scrapers/bookmakers/x/parser.ts",
      [
        "export function inner(): number { return 0; }",
        "export function parse1(): number { return inner(); }",
        "export function parseAll(): number { return 2; }",
        "",
      ].join("\n"),
    );
    expect(findLegacyOnlyHelpers(root).map((h) => h.name).sort()).toEqual(["inner", "parse1"]);
    expect(findLegacyOnlyHelpers(root, "/nothing/")).toEqual([]);
  });

  it("ignores references from tests", () => {
    write("src/scrapers/bookmakers/x/__tests__/p.test.ts", 'import { parse1 } from "../parser.js";\nparse1();\n');
    expect(findLegacyOnlyHelpers(root).map((h) => h.name)).toEqual(["parse1"]);
  });

  it("finds legacy calls outside legacy bodies", () => {
    write("scripts/run.ts", "declare const s: { scrapeLeague(l: string): void };\ns.scrapeLeague('premier-league');\n");
    write("src/services/use.ts", "declare const s: { scrapeMatchDetails(u: string): void };\nexport const go = () => s.scrapeMatchDetails('u');\n");
    write("src/scrapers/bookmakers/x/__tests__/c.test.ts", "declare const s: any;\ns.scrapeLeague('x');\n");
    expect(findLegacyCalls(root)).toEqual([
      { file: "scripts/run.ts", line: 2, method: "scrapeLeague" },
      { file: "src/services/use.ts", line: 2, method: "scrapeMatchDetails" },
    ]);
  });

  it("legacyDirOf takes the first two segments under src/scrapers", () => {
    expect(legacyDirOf("src/scrapers/bookmakers/forbet/index.ts")).toBe("bookmakers/forbet");
    expect(legacyDirOf("src/scrapers/shared/betby/scraper.ts")).toBe("shared/betby");
  });

  it("exportedNames lists exported declarations", () => {
    write(
      "src/a.ts",
      "export function f() {}\nexport class C {}\nexport interface I {}\nexport type T = 1;\nexport const v = 1, w = 2;\nconst h = 1;\nexport { h as k };\nfunction g() {}\n",
    );
    expect(exportedNames(root, "src/a.ts").sort()).toEqual(["C", "I", "T", "f", "k", "v", "w"]);
  });
});
