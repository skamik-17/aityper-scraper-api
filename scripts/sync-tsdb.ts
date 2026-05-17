#!/usr/bin/env npx tsx
/**
 * Manually trigger TheSportsDB fixtures sync.
 *
 * Usage:
 *   npx tsx scripts/sync-tsdb.ts                       # sync all CONFIG.ENABLED_LEAGUES
 *   npx tsx scripts/sync-tsdb.ts premier-league        # sync one or more specific leagues
 *   npx tsx scripts/sync-tsdb.ts premier-league laliga
 */

import { CONFIG, validateConfig } from "../src/config/index.js";
import { syncLeagueFixtures } from "../src/services/tsdb-sync-service.js";
import { TSDB_LEAGUE_META } from "../src/data/tsdb-leagues.js";
import {
  countTsdbFixtures,
  countUpcomingTsdbFixtures,
} from "../src/repositories/tsdb-fixtures-repository.js";

async function main(): Promise<void> {
  validateConfig();

  const args = process.argv.slice(2);
  const targets =
    args.length > 0 ? args : ([...CONFIG.ENABLED_LEAGUES] as string[]);

  const unknown = targets.filter((slug) => !TSDB_LEAGUE_META[slug]);
  if (unknown.length > 0) {
    console.error(
      `Unknown league(s): ${unknown.join(", ")}\n` +
        `Known leagues: ${Object.keys(TSDB_LEAGUE_META).join(", ")}`
    );
    process.exit(1);
  }

  console.log(`Syncing TSDB fixtures for: ${targets.join(", ")}`);
  console.log("─".repeat(60));

  let totalSynced = 0;
  let totalFailedRounds = 0;
  let leaguesWithErrors = 0;

  for (const league of targets) {
    const beforeTotal = await countTsdbFixtures(league);
    const beforeUpcoming = await countUpcomingTsdbFixtures(league);
    console.log(
      `[${league}] before: total=${beforeTotal} upcoming=${beforeUpcoming}`
    );

    try {
      const result = await syncLeagueFixtures(league);
      const afterTotal = await countTsdbFixtures(league);
      const afterUpcoming = await countUpcomingTsdbFixtures(league);
      totalSynced += result.synced;
      totalFailedRounds += result.failedRounds.length;
      console.log(
        `[${league}] after:  total=${afterTotal} upcoming=${afterUpcoming} ` +
          `(fetched=${result.fetched}, synced=${result.synced}, ` +
          `failed_rounds=${result.failedRounds.length})`
      );
      if (result.failedRounds.length > 0) {
        console.log(
          `[${league}] failed rounds: ${result.failedRounds.join(", ")}`
        );
      }
    } catch (error) {
      leaguesWithErrors += 1;
      console.error(
        `[${league}] ERROR:`,
        error instanceof Error ? error.message : error
      );
    }
    console.log();
  }

  console.log("─".repeat(60));
  console.log(
    `Done. synced=${totalSynced} failed_rounds=${totalFailedRounds} leagues_with_errors=${leaguesWithErrors}`
  );

  if (leaguesWithErrors > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
