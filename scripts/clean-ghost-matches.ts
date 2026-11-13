/**
 * One-off cleanup for the three known "ghost match" rows in `odds` (same
 * club on both sides of a fixture). See src/scrapers/bookmakers/sts/parser.ts,
 * sts/index.ts, and repositories/full-offer-repository.ts for the guards
 * that now stop new ones from being written, and src/services/odds-service.ts
 * + routes/normalized-markets.ts for the read-time filters that already keep
 * these out of every API response regardless of whether the rows are
 * deleted. This script removes the stale rows themselves.
 *
 * The `odds` table holds tens of thousands of rows (68k+ for premier-league
 * alone per the earlier diagnosis), well past PostgREST's default 1000-row
 * page - so this targets the known-bad match_ids directly with `.in()`
 * rather than scanning the whole table client-side. With the snapshot model
 * (migration 13) it also deletes them from `matches`, which cascades to
 * `odds_snapshot` and `odds_current`; `odds` is skipped once it is dropped.
 *
 * Usage: npx tsx scripts/clean-ghost-matches.ts [--apply]
 * Without --apply, only reports what it would delete (dry run).
 */
import { getSupabase } from "../src/config/database.js";

const KNOWN_GHOST_MATCH_IDS = [
  "premier-league:manchester united:manchester united",
  "premier-league:sunderland:sunderland",
  "premier-league:luton town:luton town",
];

/** PostgREST answers PGRST205 for a table that does not exist (odds after migration 15). */
function isMissingTable(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "PGRST205";
}

/**
 * Exact per-id counts via head:true, NOT a data-returning select - the 1639 real
 * rows across these 3 ids blow straight past PostgREST's default 1000-row page,
 * which silently truncated an earlier dry run of this exact script and made the
 * Luton Town row (only 15 rows, sorted after the other two's combined 1624) look
 * like it had "already gone". Returns null when the table does not exist.
 */
async function countGhostRows(table: string): Promise<number | null> {
  const supabase = getSupabase();
  const { count: totalCount, error: countError } = await (supabase as any)
    .from(table)
    .select("*", { count: "exact", head: true });
  if (countError) {
    if (isMissingTable(countError)) {
      console.log(`${table}: table not found - skipped`);
      return null;
    }
    console.error(`Failed to count ${table} table:`, countError);
    process.exit(1);
  }
  console.log(`${table} table total row count: ${totalCount}`);

  let totalFound = 0;
  for (const id of KNOWN_GHOST_MATCH_IDS) {
    const { count, error } = await (supabase as any)
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("match_id", id);
    if (error) {
      console.error(`Failed to count ${table} ${id}:`, error);
      process.exit(1);
    }
    console.log(`  ${id}  -  ${count ?? 0} rows`);
    totalFound += count ?? 0;
  }
  return totalFound;
}

async function deleteGhostRows(table: string): Promise<void> {
  const { error, count } = await (getSupabase() as any)
    .from(table)
    .delete({ count: "exact" })
    .in("match_id", KNOWN_GHOST_MATCH_IDS);
  if (error) {
    console.error(`Delete from ${table} failed:`, error);
    process.exit(1);
  }
  console.log(`Deleted ${count} ${table} rows across ${KNOWN_GHOST_MATCH_IDS.length} known match_id(s).`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  // matches cascades to odds_snapshot and odds_current; table odds goes in migration 15
  const tables = ["matches", "odds"];

  const found = new Map<string, number>();
  for (const table of tables) {
    const n = await countGhostRows(table);
    if (n !== null) found.set(table, n);
  }
  const totalFound = [...found.values()].reduce((a, b) => a + b, 0);
  console.log(`\nTotal: ${totalFound} rows across ${KNOWN_GHOST_MATCH_IDS.length} known ghost match_ids.`);

  if (!apply) {
    console.log("\nDry run - no rows deleted. Re-run with --apply to delete.");
    return;
  }

  if (totalFound === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  for (const [table, n] of found) {
    if (n > 0) await deleteGhostRows(table);
  }
}

main();
