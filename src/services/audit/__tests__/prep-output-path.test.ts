import { describe, it, expect } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPrepAuditOutPath, REPO_ROOT } from "../prep-output-path.js";

// This test file sits at <root>/src/services/audit/__tests__/.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("default prep-audit output path", () => {
  it("anchors REPO_ROOT at the root of the checkout or worktree that runs the code", () => {
    expect(REPO_ROOT).toBe(ROOT);
  });

  it("lands in the gitignored docs/<bm>-audit/.tmp/ of that checkout, whatever the cwd", () => {
    expect(defaultPrepAuditOutPath("lvbet", "35148")).toBe(resolve(ROOT, "docs/lvbet-audit/.tmp/35148.json"));
    expect(defaultPrepAuditOutPath("betby", "2725816334213586962")).toBe(
      resolve(ROOT, "docs/betby-audit/.tmp/2725816334213586962.json"));
  });

  it("keeps a matchId with path separators a single file inside .tmp", () => {
    const tmp = resolve(ROOT, "docs/lvbet-audit/.tmp");
    for (const id of ["../../../outside", "a/b\\c", "premier-league:arsenal:hull city"]) {
      const out = defaultPrepAuditOutPath("lvbet", id);
      expect(dirname(out), out).toBe(tmp);
    }
    expect(defaultPrepAuditOutPath("lvbet", "../../../outside")).toBe(join(tmp, ".._.._.._outside.json"));
  });
});
