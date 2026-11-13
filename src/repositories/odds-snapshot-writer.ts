/**
 * Writes one bookmaker save to the snapshot model (migration 13's save_odds_snapshot):
 * one RPC per match, sequential, each its own transaction. Never throws.
 */
import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import { isPruneGuardEnabled } from "../config/odds-storage.js";
import { formatDbError } from "../services/run-outcome.js";
import type { MarketSelection } from "../types/full-offer.js";
import type { OddsInsert, PruneSkip } from "./full-offer-repository.js";

export interface SnapshotMatchHeader {
  match_id: string;
  league_slug: string;
  home_team: string;
  away_team: string;
  event_url: string | null;
  start_time: string | null;
}

export interface SnapshotRow {
  market_key: string;
  market_type_id: number;
  param_value: string | null;
  custom_name: string | null;
  raw_market_name: string | null;
  selections: MarketSelection[];
}

export interface SaveOddsSnapshotResult {
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  prune_skipped: boolean;
  previous_rows: number | null;
  /** Set when the match kicked off: nothing was written (migration 14's in-play rule). */
  rejected?: "kickoff_passed";
}

export interface SnapshotWriteSummary {
  calls: number;
  failedCalls: number;
  failedRows: number;
  firstError: string | null;
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  pruneSkipped: PruneSkip[];
  /** Matches rejected after kickoff: not counted in received/inserted/…. */
  rejectedStarted: string[];
  durationMs: number;
}

/** The per-row payload: the match header travels once per call, not on every row. */
export function toSnapshotRows(records: readonly OddsInsert[]): SnapshotRow[] {
  return records.map((r) => ({
    market_key: r.market_key,
    market_type_id: r.market_type_id,
    param_value: r.param_value ?? null,
    custom_name: r.custom_name ?? null,
    raw_market_name: r.raw_market_name ?? null,
    selections: r.selections,
  }));
}

export async function writeOddsSnapshots(
  runId: string | null,
  bookmaker: PolishBookmaker,
  perMatch: ReadonlyArray<{ header: SnapshotMatchHeader; records: readonly OddsInsert[] }>
): Promise<SnapshotWriteSummary> {
  const started = Date.now();
  const summary: SnapshotWriteSummary = {
    calls: 0,
    failedCalls: 0,
    failedRows: 0,
    firstError: null,
    received: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    pruneSkipped: [],
    rejectedStarted: [],
    durationMs: 0,
  };
  const supabase = getSupabase();
  const guard = isPruneGuardEnabled();

  for (const { header, records } of perMatch) {
    summary.calls++;
    let error: unknown = null;
    let data: Partial<SaveOddsSnapshotResult> | null = null;
    try {
      const res = await (supabase as any).rpc("save_odds_snapshot", {
        p_run_id: runId,
        p_bookmaker: bookmaker,
        p_match: header,
        p_rows: toSnapshotRows(records),
        p_guard: guard,
      });
      error = res.error;
      data = res.data;
    } catch (thrown) {
      error = thrown;
    }

    if (error) {
      const message = formatDbError(error);
      console.error(`[OddsSnapshotWriter] save_odds_snapshot failed for ${bookmaker}/${header.match_id}: ${message}`);
      summary.failedCalls++;
      summary.failedRows += records.length;
      summary.firstError ??= message;
      continue;
    }

    if (data?.rejected === "kickoff_passed") {
      summary.rejectedStarted.push(header.match_id);
      continue;
    }
    // One failed match never stops the next one
    const received = Number(data?.received ?? 0);
    summary.received += received;
    summary.inserted += Number(data?.inserted ?? 0);
    summary.updated += Number(data?.updated ?? 0);
    summary.unchanged += Number(data?.unchanged ?? 0);
    summary.removed += Number(data?.removed ?? 0);
    if (data?.prune_skipped) {
      summary.pruneSkipped.push({ match_id: header.match_id, new_rows: received, previous_rows: Number(data.previous_rows ?? 0) });
    }
  }

  summary.durationMs = Date.now() - started;
  return summary;
}
