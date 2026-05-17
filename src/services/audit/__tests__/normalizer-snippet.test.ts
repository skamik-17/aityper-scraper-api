import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractNormalizerSnippet } from "../normalizer-snippet.js";

function writeFixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "norm-snippet-"));
  const path = join(dir, "betclic-normalizer.ts");
  writeFileSync(path, content, "utf8");
  return path;
}

describe("extractNormalizerSnippet", () => {
  it("returns 'no references' message when marketCode is absent from file", () => {
    const path = writeFixture("const x = 1;\nconst y = 2;\n");
    const out = extractNormalizerSnippet("NONEXISTENT_CODE", { filePath: path });
    expect(out).toBe("// No direct references to NONEXISTENT_CODE found in betclic-normalizer.ts");
    rmSync(path, { force: true });
  });

  it("extracts ±contextLines around a single match with header comment", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `// line ${i + 1}`);
    lines[24] = `  return { marketCode: "TOTAL_GOALS" };`;
    const path = writeFixture(lines.join("\n"));
    const out = extractNormalizerSnippet("TOTAL_GOALS", { filePath: path, contextLines: 5 });
    expect(out).toMatch(/^\/\/ Lines 20-30 of betclic-normalizer\.ts/);
    expect(out).toContain(`  return { marketCode: "TOTAL_GOALS" };`);
    expect(out).toContain("// line 20");
    expect(out).toContain("// line 30");
    expect(out).not.toContain("// line 19");
    expect(out).not.toContain("// line 31");
    rmSync(path, { force: true });
  });

  it("merges overlapping ranges from multiple matches", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `// line ${i + 1}`);
    lines[19] = `  marketCode: "FOO",`;
    lines[24] = `  marketCode: "FOO",`;
    const path = writeFixture(lines.join("\n"));
    const out = extractNormalizerSnippet("FOO", { filePath: path, contextLines: 5 });
    // Match 1 → [15..25], Match 2 → [20..30]. Merged → [15..30].
    expect(out).toMatch(/^\/\/ Lines 15-30 of betclic-normalizer\.ts/);
    expect((out.match(/^\/\/ Lines /gm) ?? []).length).toBe(1);
    rmSync(path, { force: true });
  });

  it("emits separate blocks for non-overlapping matches", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`);
    lines[9] = `  marketCode: "BAR",`;
    lines[79] = `  marketCode: "BAR",`;
    const path = writeFixture(lines.join("\n"));
    const out = extractNormalizerSnippet("BAR", { filePath: path, contextLines: 5 });
    expect((out.match(/^\/\/ Lines /gm) ?? []).length).toBe(2);
    expect(out).toMatch(/^\/\/ Lines 5-15 of betclic-normalizer\.ts/);
    expect(out).toContain("// Lines 75-85 of betclic-normalizer.ts");
    rmSync(path, { force: true });
  });

  it("truncates to maxTotalLines with middle omission marker", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `// line ${i + 1}`);
    // 4 well-separated matches, each yielding ~21 lines context, ~84 total > 50
    [9, 49, 99, 149].forEach((idx) => { lines[idx] = `  "BAZ" reference`; });
    const path = writeFixture(lines.join("\n"));
    const out = extractNormalizerSnippet("BAZ", { filePath: path, contextLines: 10, maxTotalLines: 50 });
    expect(out).toContain("// ... (");
    expect(out).toContain("more lines omitted) ...");
    // Total non-blank lines (excluding header + omission marker) must be <= maxTotalLines
    const contentLines = out.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("// Lines ") && !l.startsWith("// ... ("));
    expect(contentLines.length).toBeLessThanOrEqual(50);
    rmSync(path, { force: true });
  });

  it("uses the project's betclic-normalizer.ts by default and finds a real code", () => {
    // MATCH_WINNER is a stable code that has been in the catalog and normalizer for a long time.
    const out = extractNormalizerSnippet("MATCH_WINNER");
    // Either we find references (snippet contains the code) OR we get the 'no references' message.
    // For MATCH_WINNER we expect at least one reference in the real file.
    expect(out).toMatch(/MATCH_WINNER/);
    expect(out).toMatch(/^\/\/ Lines /m);
  });
});
