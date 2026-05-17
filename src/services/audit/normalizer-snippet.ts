import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SnippetOptions {
  /** Lines of context to include before and after each match. Default 20. */
  contextLines?: number;
  /** Maximum total content lines (excluding header + omission markers). Default 100. */
  maxTotalLines?: number;
  /**
   * Path to the normalizer file.
   * Default: src/services/normalization/bookmakers/betclic-normalizer.ts
   * resolved from cwd (which is the backend/ directory when run via npx vitest).
   */
  filePath?: string;
}

// Relative to the backend/ directory (cwd when vitest or ts-node runs from there).
const DEFAULT_FILE_PATH = "src/services/normalization/bookmakers/betclic-normalizer.ts";
const DEFAULT_CONTEXT_LINES = 20;
const DEFAULT_MAX_TOTAL_LINES = 100;

/**
 * Returns a string containing one or more annotated snippets from the Betclic
 * normalizer that mention the given marketCode, with merged overlapping ranges
 * and a middle-truncation marker if the total exceeds maxTotalLines.
 *
 * If no matches are found, returns a single comment line indicating absence.
 */
export function extractNormalizerSnippet(
  marketCode: string,
  options: SnippetOptions = {},
): string {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const maxTotalLines = options.maxTotalLines ?? DEFAULT_MAX_TOTAL_LINES;
  const filePath = options.filePath
    ? resolve(options.filePath)
    : resolve(process.cwd(), DEFAULT_FILE_PATH);

  const source = readFileSync(filePath, "utf8");
  const lines = source.split("\n");

  // Collect 0-indexed line numbers that contain the marketCode.
  const matchIndices: number[] = [];
  lines.forEach((line, idx) => {
    if (line.includes(marketCode)) matchIndices.push(idx);
  });

  if (matchIndices.length === 0) {
    return `// No direct references to ${marketCode} found in betclic-normalizer.ts`;
  }

  // Build ranges as [start, end] inclusive, 1-indexed (for display).
  type Range = { start: number; end: number };
  const ranges: Range[] = matchIndices.map((idx) => ({
    start: Math.max(1, idx + 1 - contextLines),
    end: Math.min(lines.length, idx + 1 + contextLines),
  }));

  // Sort and merge overlapping (or adjacent) ranges.
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  // Render each merged block into a header + body.
  const blocks: { header: string; body: string[] }[] = merged.map((r) => ({
    header: `// Lines ${r.start}-${r.end} of betclic-normalizer.ts`,
    body: lines.slice(r.start - 1, r.end),
  }));

  const totalContent = blocks.reduce((sum, b) => sum + b.body.length, 0);

  // Under cap: render all blocks.
  if (totalContent <= maxTotalLines) {
    return blocks.map((b) => `${b.header}\n${b.body.join("\n")}`).join("\n\n");
  }

  // Over cap with a single block: split it head/tail with an omission marker in the middle.
  if (blocks.length === 1) {
    const b = blocks[0];
    const keepEachSide = Math.max(1, Math.floor((maxTotalLines - 1) / 2));
    const omitted = b.body.length - keepEachSide * 2;
    if (omitted <= 0) {
      return `${b.header}\n${b.body.join("\n")}`;
    }
    const head = b.body.slice(0, keepEachSide);
    const tail = b.body.slice(b.body.length - keepEachSide);
    return `${b.header}\n${head.join("\n")}\n// ... (${omitted} more lines omitted) ...\n${tail.join("\n")}`;
  }

  // Over cap with two blocks: trim the larger block from its far edge.
  if (blocks.length === 2) {
    const [first, last] = blocks;
    const targetTrim = totalContent - maxTotalLines;
    if (first.body.length >= last.body.length) {
      const keepFirst = Math.max(1, first.body.length - targetTrim);
      const omitted = first.body.length - keepFirst;
      const trimmedFirst = first.body.slice(0, keepFirst);
      return `${first.header}\n${trimmedFirst.join("\n")}\n// ... (${omitted} more lines omitted) ...\n\n${last.header}\n${last.body.join("\n")}`;
    } else {
      const keepLast = Math.max(1, last.body.length - targetTrim);
      const omitted = last.body.length - keepLast;
      const trimmedLast = last.body.slice(last.body.length - keepLast);
      return `${first.header}\n${first.body.join("\n")}\n\n${last.header}\n// ... (${omitted} more lines omitted) ...\n${trimmedLast.join("\n")}`;
    }
  }

  // Over cap with 3+ blocks: keep first and last blocks in full; collapse all
  // middle blocks into a single omission marker.
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const omittedLines = blocks.slice(1, -1).reduce((sum, b) => sum + b.body.length, 0);
  return `${first.header}\n${first.body.join("\n")}\n\n// ... (${omittedLines} more lines omitted) ...\n\n${last.header}\n${last.body.join("\n")}`;
}
