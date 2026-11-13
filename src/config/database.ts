import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "./index.js";
import type { Database } from "../types/database.js";
import { formatDbError } from "../services/run-outcome.js";

let supabaseClient: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (!supabaseClient) {
    supabaseClient = createClient<Database>(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_SERVICE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return supabaseClient;
}

export type DbProbe = { ok: true } | { ok: false; error: string };

/** Bound of one probe request: a hung PostgREST or a blackholed host must not stall the preflight. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * One read through PostgREST to a real table, so a PostgREST that answers
 * while Postgres is still starting (PGRST002) counts as not ready.
 * Never throws: an unreachable DB, a request that takes longer than
 * PROBE_TIMEOUT_MS or a client that cannot be created gives `{ ok: false }`
 * with the formatted cause.
 */
export async function probeDatabase(): Promise<DbProbe> {
  try {
    const { error } = await getSupabase()
      .from("market_types")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(PROBE_TIMEOUT_MS));
    // PGRST116 (no rows for a single-row read) still proves the DB answered
    if (error && error.code !== "PGRST116") {
      return { ok: false, error: formatDbError(error) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatDbError(error) };
  }
}

/** Probe until the DB answers or `timeoutMs` has passed; returns the last probe. */
export async function waitForDatabase(timeoutMs: number, intervalMs = 5000): Promise<DbProbe> {
  const deadline = Date.now() + timeoutMs;
  let probe = await probeDatabase();
  if (!probe.ok) {
    console.warn(
      `[Database] Not reachable yet, retrying every ${intervalMs / 1000}s for up to ${timeoutMs / 1000}s: ${probe.error}`
    );
  }

  while (!probe.ok && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
    probe = await probeDatabase();
  }
  return probe;
}

export async function testConnection(): Promise<boolean> {
  const probe = await probeDatabase();
  if (!probe.ok) {
    console.error("Database connection test failed:", probe.error);
  }
  return probe.ok;
}
