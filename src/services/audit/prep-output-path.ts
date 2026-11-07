/**
 * Default output location of the `scripts/<bm>-prep-audit.ts` archives.
 *
 * The scripts used to default to `resolve(cwd, "../docs/<bm>-audit/.tmp/...")`,
 * written for the pre-split layout where this code lived in `aityper/backend/`.
 * Since the split that path resolves outside the repository: from the main
 * checkout into `<parent>/docs/`, and from a worktree into a directory every
 * worktree shares. The default is now anchored at the root of the checkout
 * that runs the code, whatever the cwd, and lands in the gitignored
 * `docs/<bm>-audit/.tmp/` (`.gitignore`: `docs/*-audit/.tmp/`).
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Root of the checkout or worktree that runs this code (this file is `<root>/src/services/audit/`). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `<root>/docs/<bookmaker>-audit/.tmp/<matchId>.json`; path separators in `matchId` become `_`. */
export function defaultPrepAuditOutPath(bookmaker: string, matchId: string): string {
  return join(REPO_ROOT, "docs", `${bookmaker}-audit`, ".tmp", `${matchId.replace(/[\\/]/g, "_")}.json`);
}
