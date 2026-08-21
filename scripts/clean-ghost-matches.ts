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
 * rather than scanning the whole table client-side.
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

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabase();

  const { count: totalCount, error: countError } = await supabase
    .from("odds")
    .select("*", { count: "exact", head: true });
  if (countError) {
    console.error("Failed to count odds table:", countError);
    process.exit(1);
  }
  console.log(`odds table total row count: ${totalCount}`);

  // Exact per-id counts via head:true, NOT a data-returning select - the
  // 1639 real rows across these 3 ids blow straight past PostgREST's
  // default 1000-row page, which silently truncated an earlier dry run of
  // this exact script and made the Luton Town row (only 15 rows, sorted
  // after the other two's combined 1624) look like it had "already gone".
  let totalFound = 0;
  for (const id of KNOWN_GHOST_MATCH_IDS) {
    const { count, error } = await supabase
      .from("odds")
      .select("*", { count: "exact", head: true })
      .eq("match_id", id);
    if (error) {
      console.error(`Failed to count ${id}:`, error);
      process.exit(1);
    }
    console.log(`  ${id}  -  ${count ?? 0} rows`);
    totalFound += count ?? 0;
  }
  console.log(`\nTotal: ${totalFound} rows across ${KNOWN_GHOST_MATCH_IDS.length} known ghost match_ids.`);

  if (!apply) {
    console.log("\nDry run - no rows deleted. Re-run with --apply to delete.");
    return;
  }

  if (totalFound === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  const { error: delError, count } = await supabase
    .from("odds")
    .delete({ count: "exact" })
    .in("match_id", KNOWN_GHOST_MATCH_IDS);

  if (delError) {
    console.error("Delete failed:", delError);
    process.exit(1);
  }

  console.log(`\nDeleted ${count} rows across ${KNOWN_GHOST_MATCH_IDS.length} known match_id(s).`);
}

main();
