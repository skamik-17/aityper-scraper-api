/**
 * Odds retention: deletes odds rows older than RETENTION_HOURS. Runs after every completed
 * scrape cycle, once at boot and in the 03:00 cleanup. Single-flight and never throws.
 */
import { cleanupOldOdds } from "../repositories/odds-repository.js";

export const RETENTION_HOURS = 24;

export interface RetentionResult {
  deleted: number;
  durationMs: number;
  error: string | null;
}

let inFlight: Promise<RetentionResult> | null = null;

async function runOnce(): Promise<RetentionResult> {
  const started = Date.now();
  try {
    const { deleted } = await cleanupOldOdds(RETENTION_HOURS);
    const durationMs = Date.now() - started;
    console.log(`[Retention] deleted ${deleted} odds rows older than ${RETENTION_HOURS}h in ${durationMs}ms`);
    return { deleted, durationMs, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Retention] cleanup failed: ${message}`);
    return { deleted: 0, durationMs: Date.now() - started, error: message };
  }
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
