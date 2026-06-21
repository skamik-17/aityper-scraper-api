import { describe, it, expect } from "vitest";
import { extractNormalizerSnippet } from "../normalizer-snippet.js";

describe("sts-audit extractNormalizerSnippet", () => {
  it("returns sts-normalizer lines mentioning a known code", () => {
    const snippet = extractNormalizerSnippet("MATCH_WINNER");
    expect(typeof snippet).toBe("string");
    expect(snippet.length).toBeGreaterThan(0);
    expect(snippet).toContain("MATCH_WINNER");
  });
});
