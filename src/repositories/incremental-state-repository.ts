/**
 * Detail state of incremental scraping (migration 16): when each snapshot's
 * detail was last fetched and with which listing fingerprint, plus the RPC
 * that stamps fetched events and confirms unchanged ones after a pass.
 */
import type { PolishBookmaker } from "../config/index.js";
import { getSupabase } from "../config/database.js";
import { formatDbError } from "../services/run-outcome.js";
import { HARD_CAP_FAR_MS, HARD_CAP_NEAR_MS, type EventFetchState } from "../services/incremental/due-plan.js";
import { parseDbTimestamp } from "../utils/db-timestamp.js";

/** One event of a pass: its odds_snapshot.match_id and the listing fingerprint. */
export interface PassKey {
  matchKey: string;
  fingerprint: string | null;
}

export interface RecordPassResult {
  stamped: number;
  confirmed: number;
  notConfirmed: number;
  confirmedRows: number;
}

interface StateRow {
  match_id: string;
  status: string;
  last_detail_at: string | null;
  listing_fingerprint: string | null;
}

const hoursInterval = (ms: number): string => `${ms / 3_600_000} hours`;

/** State per odds_snapshot.match_id of one bookmaker in one league. Throws on a DB error. */
export async function getIncrementalState(
  leagueSlug: string,
  bookmaker: PolishBookmaker,
): Promise<Map<string, EventFetchState>> {
  const { data, error } = await (getSupabase() as any)
    .from("odds_snapshot")
    .select("match_id,status,last_detail_at,listing_fingerprint")
    .eq("league_slug", leagueSlug)
    .eq("bookmaker", bookmaker);
  if (error) throw new Error(`odds_snapshot state read failed: ${formatDbError(error)}`);

  const out = new Map<string, EventFetchState>();
  for (const r of (data ?? []) as StateRow[]) {
    const at = r.last_detail_at === null ? null : parseDbTimestamp(r.last_detail_at).getTime();
    out.set(r.match_id, {
      lastDetailAt: at === null || Number.isNaN(at) ? null : at,
      fingerprint: r.listing_fingerprint,
      status: r.status === "degenerate" ? "degenerate" : "ok",
    });
  }
  return out;
}

/** Stamp the events fetched in run `runId` and confirm the unchanged ones. Throws on a DB error. */
export async function recordIncrementalPass(
  runId: string,
  bookmaker: PolishBookmaker,
  fetched: PassKey[],
  confirmed: PassKey[],
): Promise<RecordPassResult> {
  const toJson = (keys: PassKey[]) => keys.map((k) => ({ match_id: k.matchKey, fingerprint: k.fingerprint }));
  const { data, error } = await (getSupabase() as any).rpc("record_incremental_pass", {
    p_run_id: runId,
    p_bookmaker: bookmaker,
    p_fetched: toJson(fetched),
    p_confirmed: toJson(confirmed),
    p_cap_near: hoursInterval(HARD_CAP_NEAR_MS),
    p_cap_far: hoursInterval(HARD_CAP_FAR_MS),
  });
  if (error) throw new Error(`record_incremental_pass failed: ${formatDbError(error)}`);

  const d = (data ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
  return {
    stamped: n(d.stamped),
    confirmed: n(d.confirmed),
    notConfirmed: n(d.not_confirmed),
    confirmedRows: n(d.confirmed_rows),
  };
}
