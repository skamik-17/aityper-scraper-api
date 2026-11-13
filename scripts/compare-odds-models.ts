/**
 * Per-cycle comparison of the legacy odds table and the snapshot model (plan 09 Task 6),
 * read-only: compare_odds_models(run_id) for every run id of the newest cycle.
 *
 * Usage: npx tsx scripts/compare-odds-models.ts [--run <uuid> ...]
 *   Without --run: every distinct scraper_runs.run_id that started within 10 minutes of
 *   the newest started_at (one per enabled league; a cycle's leagues start together).
 * Prints one `ODDS_MODEL_COMPARE <json>` line per run id.
 * Exit 0: no only_legacy / only_model / differing rows for any run id; 1: a difference;
 * 2: a DB error or no run id found.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getSupabase } from "../src/config/database.js";
import { formatDbError } from "../src/services/run-outcome.js";

const CYCLE_WINDOW_MS = 10 * 60_000;

export interface CompareResult {
  run_id: string;
  pairs: number;
  legacy_rows: number;
  model_rows: number;
  only_legacy: number;
  only_model: number;
  differing: number;
  samples: Array<{ match_id: string; bookmaker: string; market_key: string; kind: string }>;
}

export function parseRunIds(argv: readonly string[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run" && argv[i + 1]) ids.push(argv[++i]);
  }
  return ids;
}

/** The run ids of the newest cycle: started within CYCLE_WINDOW_MS of the newest run. */
export function newestCycleRunIds(rows: ReadonlyArray<{ run_id: string | null; started_at: string }>): string[] {
  const withId = rows.filter((r) => r.run_id);
  if (withId.length === 0) return [];
  const newest = Math.max(...withId.map((r) => Date.parse(r.started_at)));
  const ids = withId.filter((r) => newest - Date.parse(r.started_at) <= CYCLE_WINDOW_MS).map((r) => r.run_id!);
  return [...new Set(ids)];
}

export function differences(r: CompareResult): number {
  return r.only_legacy + r.only_model + r.differing;
}

async function main(): Promise<number> {
  const supabase = getSupabase();
  let runIds = parseRunIds(process.argv.slice(2));

  if (runIds.length === 0) {
    const { data, error } = await (supabase as any)
      .from("scraper_runs")
      .select("run_id, started_at")
      .not("run_id", "is", null)
      .order("started_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error(`compare-odds-models: scraper_runs read failed: ${formatDbError(error)}`);
      return 2;
    }
    runIds = newestCycleRunIds(data ?? []);
  }
  if (runIds.length === 0) {
    console.error("compare-odds-models: no run id found");
    return 2;
  }

  let failed = false;
  for (const runId of runIds) {
    const { data, error } = await (supabase as any).rpc("compare_odds_models", { p_run_id: runId });
    if (error) {
      console.error(`compare-odds-models: compare_odds_models(${runId}) failed: ${formatDbError(error)}`);
      return 2;
    }
    const result = data as CompareResult;
    console.log(`ODDS_MODEL_COMPARE ${JSON.stringify(result)}`);
    if (differences(result) > 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`compare-odds-models: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
  );
}
