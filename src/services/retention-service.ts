/**
 * Odds retention: runs after every completed scrape cycle, once at boot and in the 03:00
 * cleanup. Single-flight and never throws. Per write model: the legacy table's 24 h cleanup
 * while it is written (not in "snapshot"), the snapshot model's cleanup_odds in "switched"
 * and "snapshot", and scraper_runs older than 30 days always (owner B11).
 */
import { getOddsWriteModel } from "../config/odds-storage.js";
import { cleanupOdds, cleanupOldOdds, type CleanupOddsResult } from "../repositories/odds-repository.js";
import { deleteScraperRunsOlderThan } from "../repositories/scraper-run-repository.js";

export const RETENTION_HOURS = 24;
const SCRAPER_RUNS_RETENTION_DAYS = 30;

export interface RetentionResult {
  /** Odds rows deleted: legacy rows plus the snapshot model's current quotes. */
  deleted: number;
  durationMs: number;
  /** The first failing step's message, else null. */
  error: string | null;
}

let inFlight: Promise<RetentionResult> | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runOnce(): Promise<RetentionResult> {
  const started = Date.now();
  const model = getOddsWriteModel();
  let deleted = 0;
  let oddsStepOk = false;
  let error: string | null = null;
  const failed = (e: unknown) => {
    const message = messageOf(e);
    console.error(`[Retention] cleanup failed: ${message}`);
    error ??= message;
  };

  // Each step is isolated: one failure never skips the others
  if (model !== "snapshot") {
    try {
      deleted += (await cleanupOldOdds(RETENTION_HOURS)).deleted;
      oddsStepOk = true;
    } catch (e) {
      failed(e);
    }
  }
  let snapshot: CleanupOddsResult | null = null;
  if (model === "switched" || model === "snapshot") {
    try {
      snapshot = await cleanupOdds();
      deleted += snapshot.current;
      oddsStepOk = true;
    } catch (e) {
      failed(e);
    }
  }
  let runsDeleted: number | null = null;
  try {
    runsDeleted = await deleteScraperRunsOlderThan(SCRAPER_RUNS_RETENTION_DAYS);
  } catch (e) {
    failed(e);
  }

  const durationMs = Date.now() - started;
  if (oddsStepOk) {
    const what = snapshot ? "(snapshot model)" : `older than ${RETENTION_HOURS}h`;
    const breakdown = snapshot
      ? ` (matches=${snapshot.matches}, snapshots=${snapshot.snapshots}, scraper_runs=${runsDeleted ?? "failed"})`
      : "";
    console.log(`[Retention] deleted ${deleted} odds rows ${what} in ${durationMs}ms${breakdown}`);
  }
  return { deleted, durationMs, error };
}

/** One cleanup at a time: an overlapping call shares the one in flight. */
export function runRetentionCleanup(): Promise<RetentionResult> {
  if (!inFlight) {
    inFlight = runOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
