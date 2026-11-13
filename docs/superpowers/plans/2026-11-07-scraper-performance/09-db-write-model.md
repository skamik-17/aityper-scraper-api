# DB Write Model and Read Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:** rebased on the future base (`recovery/integration` ≥ `aaf7c07` + `recovery/observability` + `recovery/fortuna`) and the owner's `EXECUTION.md`. Evidence: `evidence/delta-audit-infra-2026-11-13.md` (README items 10, 14; section 09; "Already done / obsolete"), `evidence/cross-plan-review-2026-11-07.md` (#10, #20, #25, #37).
> - New **Task 0** (first, mandatory): the `(league_slug, bookmaker, scraped_at DESC)` freshness index, migration `11a_odds_freshness_index.sql`; observability's freshness check runs 14 single-row queries on `odds` per `/api/odds`, `/api/bookmakers`, `/api/health/scrapers` request and per league of `/api/odds/batch`. `scripts/sql-test.sh` moves into Task 0.
> - Prune: batched (one statement per bookmaker save) unconditionally; the degenerate-write guard is built but **disabled by default** (`ODDS_PRUNE_GUARD`, owner B13 deferred), with Open Question 1 re-asking the owner (new evidence: totalbet's and Betby's listing-fallback writes). `pruneSkipped` is optional.
> - `cleanup_odds()` has no `scraper_runs` branch (observability's `runDailyCleanup` does it in TS, owner B11); the `[Retention]` line follows the shared format; Task 9 rewrites plan 07's retention tests.
> - Kickoff-rejected writes never classify as `persist_failed`; the stale exclusion flag stays off (owner B12); the "plan 10 must widen the threshold" instruction is dropped (plan 10 uses `last_detail_at`).
> - Fresh A10 baseline from post-merge `scraper_runs` (14 bookmakers now save); run ids are per league and leagues run in parallel; observability tests that pin today's prune and freshness shapes are rewritten in Tasks 2 and 7; every migration apply and live check is an owner step (EXECUTION rules 3–4).

**Goal:** Stop rewriting 64 k unchanged odds rows per run and make every per-match read a single indexed call: first the freshness index observability's status reads need, then three quick wins on today's schema (`match_id` read filter, one batched prune per bookmaker save with an optional guard, one-call match read), then a snapshot write model (`matches` / `odds_snapshot` / `odds_current` / `odds_history` + `save_odds_snapshot`) rolled out by dual-write, a per-run diff, an in-place view switch, retention and stale rules, and finally the drop of the legacy table.

**Architecture:** Task 0 adds one index (migration `11a`). Phase A changes only the repository queries plus two SQL functions in migration 12 (`prune_stale_odds`, `get_match_market_rows`); the frontend contract is untouched. Phase B adds the new tables next to `odds` (migration 13, with backfill and a comparison function), writes both models behind `ODDS_WRITE_MODEL`, proves equality run by run, then redefines `latest_odds` / `get_matches_with_odds` over the new tables in place (migration 14, same columns plus two) while the legacy table keeps being written for 7 days as an instant rollback anchor, and drops it in migration 15. All SQL is tested in a throwaway container of the same Postgres image before the owner applies it.

**Tech Stack:** PostgreSQL 17.6 (`public.ecr.aws/supabase/postgres:17.6.1.066`, container `supabase_db_backend`), PostgREST v14.2 through `@supabase/supabase-js` ^2.89, TypeScript ESM on Node 20, Vitest, tsx, Docker (throwaway SQL test container), jq.

**Spec:** README §1.2, §2 (write-path box), §4 row 09, §5 step P6 and §5.1 row "observability.md Task 5", §6, §7 rows "DB rows written", "WAL per row", "`getMatchOdds`", "Per-match page DB time", §8 Q2, Q3, Q4, Q8 (Q2 and Q3 as overridden by the owner's B13 and B12 below). `evidence/findings-notes.md` section "DB + normalization" (DB-2 … DB-7), `evidence/delta-audit-infra-2026-11-13.md` (section 09). Evidence in `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence/db-pipeline/` (`$E` below; untracked, read it from the main checkout): `README-evidence.txt`, `proposed-write-model.sql` (cited by line, the implementer copies the sections named in each task), `wal-sim.sql` / `wal-sim.out`, `smoke.sql`, `explain-read-paths.txt`, `explain-proxies.txt`, `snapshot-diffs.psv`. Recovery (tracked on `recovery/integration`): `../2026-11-06-scraper-recovery/EXECUTION.md` (owner decisions and workspace rules; it wins over this plan), `observability.md` (migration 11, Tasks 1, 4, 5, 6) and recovery README OQ11–13.

**Owner decisions that shape this plan** (`EXECUTION.md`): **B11** `scraper_runs` kept 30 days, already done in TS by observability's `runDailyCleanup` (`scheduler-service.ts:98-113`); **B12** stale quotes stay in place and are only made visible; **B13** the prune guard is deferred; **A6** an `empty` run counts as a failure.

## Global Constraints

README §6 applies, **overridden by `EXECUTION.md`** where they differ:
- Worktree per branch: `git -C /home/skamik/Documents/repositories/personal/aityper-scraper-api worktree add ../aityper-scraper-api-worktrees/perf-09-<branch> -b perf/09-<branch> recovery/integration` (or `master` once the owner has merged integration). This plan consumes observability's code (`createFakeSupabase`, `formatDbError`, `parseDbTimestamp`, `staleAfterMs`, `getOddsFreshnessByBookmaker`, `runDailyCleanup`, `classifyBookmakerRun`, `BatchSaveResult` failure fields): if `git merge-base --is-ancestor recovery/observability recovery/integration` fails, the branch's first commit is `git merge --no-edit recovery/observability` (own branch only). `ln -s` the main checkout's `node_modules` (never `npm install`/`npm ci`) and copy a recovery worktree's dead-port `.env` (never change it).
- Heavy commands run through `H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy` (`$H npx vitest run …`, `$H npx tsc --noEmit`, `$H npx tsx …`); scoped tests during TDD, the full suite once per task. Baseline: record the worktree's own count before the first change (the delta audit measured 125 files / 2243 tests on the future base).
- **Implementers never apply a migration, never start the server or the scheduler, never write to the DB** (EXECUTION rule 3: no `apply-migrations.sh`, no `db:migrate`, no `clear-database*`, no `clean-ghost-matches.ts`). Migration files are written and tested only in the throwaway SQL container (`scripts/sql-test.sh`). Every "apply", "set `.env`", "restart" and "live pass criteria" step below is an **owner step**: the implementer records the exact commands and expected results in the task report (EXECUTION rule 4) and stops. Read-only GETs against the live backend (`http://localhost:3001/api/...`) are allowed.
- Migration numbers and branches: **11a** `11a_odds_freshness_index.sql` (Task 0, branch A0, applied first), **12** `12_odds_quick_wins.sql` (Tasks 2 + 3, branch A = Tasks 1–4), **13** `13_odds_snapshot_model.sql` (Task 5, branch B1 = Tasks 5–6), **14** `14_odds_read_switch.sql` (Tasks 7 + 8, branch B2 = Tasks 7–8), **15** `15_drop_legacy_odds.sql` (Task 9, branch B3). `11a` sorts after observability's `11_scraper_runs_observability.sql` and before `12_…`, so 12–17 keep the numbers README §6 assigns (plan 10 = 16, metrics = 17). Each file is complete before it is applied, applied once, only after migration 11, only with owner approval, only via `./scripts/apply-migrations.sh <file>`, between runs and never HH:55–HH:10. Migration 11 itself is written but not applied yet (delta audit): it goes first.
- Every migration that adds or changes a function ends with `NOTIFY pgrst, 'reload schema';` so PostgREST sees new functions without a restart.
- Rollback SQL lives in `supabase/rollback/`, never in `supabase/migrations/` (the sorted no-argument form would run `14_….down.sql` before `14_….sql`).
- SQL tests live in `supabase/sql-tests/` (not `supabase/tests/`, which `supabase test db` treats as pgTAP) and run only through `scripts/sql-test.sh` (created in Task 0) in the throwaway container `aityper-sqltest` built from the same image as `supabase_db_backend`. Starting that container needs owner approval (it is not the shared DB, but it is a Docker container on a RAM-short machine; run it through `$H`); the runner never targets `supabase_db_backend`.
- Guard constants, identical in `prune_stale_odds` and `save_odds_snapshot`: a write is **degenerate** when `previous >= 20 AND new < previous * 0.10` (strict `<`). **The guard is off unless `ODDS_PRUNE_GUARD=true`** (`isPruneGuardEnabled()`, Task 2): both SQL functions take `p_guard boolean DEFAULT false` and skip nothing while it is false (B13 deferred; Open Question 1).
- Retention constants: current quotes of a match go 3 h after kickoff, a snapshot unseen for 24 h goes, `odds_history` is never touched. `scraper_runs` older than 30 days is **not** a SQL concern here: observability's `runDailyCleanup` (`deleteScraperRunsOlderThan(30)`, B11) keeps doing it in TS.
- PostgREST facts every SQL object respects (read-only checks 2026-11-07): `max_rows = 1000` (`supabase/config.toml:18`), so per-match reads return one `json` value; role `authenticator` has `statement_timeout=8s` and preloads `safeupdate`, so every RPC finishes well under 8 s and every DELETE/UPDATE sent through PostgREST carries a filter; aggregates are disabled (no `PGRST_DB_AGGREGATES_ENABLED` in `supabase_rest_backend`).
- Write functions (`prune_stale_odds`, `save_odds_snapshot`, `backfill_odds_snapshot_model`, `cleanup_odds`) are `REVOKE`d from `PUBLIC, anon, authenticated` and granted to `service_role`. New tables keep the grants `odds` has today (no RLS).
- `ODDS_WRITE_MODEL` defaults to `legacy` and `ODDS_PRUNE_GUARD` to off. Only the owner changes them, together with a service restart, between runs.
- Response shapes change additively only: `latest_odds` gains `changed_at`, `snapshot_status`; `bookmakerOdds[bm].stale?: true`; normalized-markets `stats.staleBookmakers`. Known value changes are listed per task (`paramValue` becomes `min()` over bookmakers; `/api/matches/:matchId` `startTime` becomes the max over bookmakers instead of an arbitrary row's).
- This plan consumes observability's delivered code (Tasks 1, 4, 5, 6 and 9 are built on `recovery/observability`): `createFakeSupabase` (`src/__tests__/helpers/fake-supabase.ts`; it has no `rpc` yet), `formatDbError` and `classifyBookmakerRun` (`src/services/run-outcome.ts`), `parseDbTimestamp`, `staleAfterMs` (`src/services/bookmaker-status.ts:66-68`), `getOddsFreshnessByBookmaker` (`odds-repository.ts:145-157`), `runDailyCleanup` (`scheduler-service.ts:98-113`), `BatchSaveResult.failedBatches/totalBatches/firstError` (`full-offer-repository.ts:562-572`). Observability's classifier already yields `partial` for a save error with `marketsSaved > 0` (`run-outcome.ts:79`), which is all this plan's degenerate-write line needs; plan 07 Task 0 (the `success:true` + scraper `error` → `partial` rule) is not required here. README §3 contributes nothing.

## Review Focus

1. **A match whose markets all filter out** (0 canonical records) is still "written" (`full-offer-repository.ts:662-664`). Expected: it is sent with `new_rows = 0`. With the guard **off** (the default, B13) it is pruned as today; with `ODDS_PRUNE_GUARD=true` and ≥ 20 previous rows the old snapshot stays, with fewer it is pruned. Pinned by Task 2 test "a match with 0 canonical records is sent with 0, not dropped" + SQL cases (guard off and on), and Task 5 SQL case "empty p_rows".
2. **Guard boundaries and the default.** With `p_guard = false` nothing is ever skipped (every Task 2/5 SQL case runs once with the default). With `p_guard = true`: 4 of 40 (exactly 10 %) is not degenerate; 19 previous rows are never guarded; a first write (no previous) is never guarded. Pinned by the boundary cases in Task 2 and Task 5 SQL tests.
3. **Duplicate `market_key` in one RPC payload** (a merge bug upstream) fails that call loudly (`unique_violation` on `_incoming`), is counted as a failed call with its formatted cause, and the next match is still written. Pinned by Task 5 SQL case and Task 6 test "a failed call is counted, formatted, and the next match is still written".
4. **Kickoff moves.** Stored kickoff in the past and the incoming report later (postponement): accepted and `matches.start_time` follows the bookmakers. Stored kickoff in the past and no later report: rejected, snapshot untouched, and the run is **not** `persist_failed` even when every match was rejected (that would raise `[ALERT] … NOT saved` on every run between kickoff and the 3 h cleanup). Pinned by Task 8 SQL cases "postponed match is accepted" and "started match is rejected", and Task 8 test "all matches rejected is partial, not persist_failed".
5. **A bookmaker that stops writing** (failed scraper or dropped match). Its quotes keep their `last_seen_at`, are flagged stale after `staleAfterMs`, are removed after 24 h unseen, and are never deleted by another bookmaker's write. Timestamps arrive as `+00:00`. Pinned by Task 2 SQL case "other bookmaker untouched", Task 8 `isStaleQuote` test with `+00:00`, and Task 8 SQL case "unseen 25 h is removed".

---

## Observations (pre-fix analysis)

All line numbers below are on the future base (scratch merge of `recovery/integration` `aaf7c07` + `recovery/observability` `f0361f0` + `recovery/fortuna` `a8cdb71`).

**Write path today** (`src/repositories/full-offer-repository.ts`, `saveBatchFullOfferMarkets` `:574-704`). Per (bookmaker, league) save:
- records are built per match (`mergeMarketRecord`, `:628-660`; the same-club drop `:619-626`) and upserted in 500-row batches on `(match_id, bookmaker, market_key, scraped_at)` (`:669-691`, failures counted in observability's `failedBatches`/`firstError`). Because `scraped_at` is new each run, every row is an INSERT: 64 211 inserts and as many deletes per run, **0 updates**, although **97.2 %** of rows are byte-identical to the previous scrape (`snapshot-diffs.psv`; 93.4 % betfan … 99.3 % lvbet).
- then one DELETE per match, sequentially (`:698-702` → `pruneStaleOddsRows`, `:268-286`): 3 082 calls of ~1.2 ms in 9 h (`explain-proxies.txt` C), 676 MB WAL. Upserts add 2 340 MB: 75 % of all WAL. The single-match path prunes at `:368-371`.
- the prune has no guard. A match with 1 market, or with 0 canonical records (it still enters `matchIdsWritten`, `:662-664`), deletes a 300–1 200-row snapshot (recovery OQ13, sts runs 2–4). **The owner deferred the guard (B13).** Degenerate-write producers on the future base: the rest-market listing downgrade (`detailData?.data || event` in forbet/etoto/fuksiarz/betfan `index.ts`, until plan 03), **totalbet** (a failed detail writes the list 1X2 only, `totalbet/index.ts:274-280`; details carry `market_count` 439–488) and **Betby** (a failed or missing event payload writes the snapshot's 14–16 listing markets, `shared/betby/scraper.ts:150-155`; near matches have 220–242 markets). Plan 02 Task 13 (gated) removes the totalbet/Betby transport-failure cases.
- `wal-sim.out` (throwaway PG): 2 261 B/row for append + prune vs **218 B/row** for the proposed RPC at 2 % changed rows.
- `scrape-helpers.ts`: `NormalizeAndSaveResult` `:7-12`, `normalizeAndSaveMatches(…, options: { useBatchInsert?: boolean } = {})` `:14-19`, the batch block `:59-73` (pushes `Batch insert failed (<k> of <n> batches): <cause>`), the per-match branch `:73-92`. The aggregator calls it at `aggregator.ts:290` inside `runFullOfferForBookmaker(runId, bookmaker, league)` (`:261-333`), so `runId` is in scope. Run ids are **per league**, and the leagues of one cycle run in parallel (`runAllLeaguesScrape`, `scheduler-service.ts:38-92`), each ending with its own `[ScrapeRun] <league> run=<8 hex> …` line.
- Observability tests that pin today's shapes and must change with this plan: `full-offer-repository-batch-errors.test.ts:111-121` (a clean save ends with `["delete","eq","eq","lt"]`, Task 2) and `odds-repository-freshness.test.ts:38-56` (the freshness query on table `odds`, `scraped_at`, error text `odds freshness query failed for <bm>: …`, Task 7). `scrape-helpers-batch-errors.test.ts:68` compares a `NormalizeAndSaveResult` with `toEqual`, and `aggregator.ts:294` builds one literally, so any new result field must be optional.

**Read paths today:**

| Path | Code | Measured | Cause |
|---|---|---|---|
| `getMatchOdds` (frontend `fetchMatchOdds` → `/api/odds/match`) | `odds-repository.ts:51-77` | 1.67 s per 1 000-row page, ~7 pages ≈ **7.7 s** (`explain-read-paths.txt` #7) | filters `latest_odds` on `league_slug/home_team/away_team`; those are not window partition keys, so Postgres sorts all 186 884 rows (114 MB external merge) before filtering. By `match_id` the filter goes below the window: **45 ms** (#1). Pages are ordered only by `market_key`, so ties across bookmakers make offset paging non-deterministic. |
| `getFullOfferByMatch` (normalized-markets, full-offer) | `full-offer-repository.ts:376-460` (`fetchAllRows` block `:386-395`), `supabase-pagination.ts:11-23` | 24 357 calls, **1 355 s DB, ~51 GB temp** in 9 h; page 7 spills (#2, external merge 4 136 kB, `work_mem` 4 MB) | every 1 000-row page recomputes the window and the final sort. One `json_agg` call: 64.9 ms on the plain table (`explain-proxies.txt` B). |
| `get_matches_with_odds` | `supabase/migrations/10_filter_market_keys.sql:28-129` | 76 ms MATCH_WINNER, 4.36 s full (#5, #6) | 60 of 76 ms in the full-league `match_start` scan (`:67-74`); `paramValue` comes from `DISTINCT ON` without an order (`:90-103`), i.e. an arbitrary bookmaker's row. |
| `getMatchInfoById` | `odds-repository.ts:87-110` | 6.9 ms seq scan (#3) | `LIMIT 1` of an arbitrary row; `start_time` NULL when that bookmaker does not report it. |
| `getLastScrapeTime` (observability freshness) | `odds-repository.ts:116-138`, called 14× by `getOddsFreshnessByBookmaker` (`:145-157`) inside `getBookmakerStatusSnapshot` (`bookmaker-status.ts:204`) | 97 ms for lebull (`explain-proxies.txt` E); 14 such index walks per call, issued in parallel | walks `idx_odds_scraped_at` backwards past 173 784 rows. The snapshot runs on **every** `/api/odds`, `/api/bookmakers` and `/api/health/scrapers` request and once per league of `/api/odds/batch`; migration 11 indexed only `scraper_runs`. Task 0 fixes it now; Task 7 moves the read to `odds_snapshot`. |

**Storage:** `odds` 167 MB heap + **428 MB indexes** for 186 048 rows; `odds_unique_entry` 248 MB. Since 2026-11-06 15:44Z (read-only `pg_stat_user_indexes`, 2026-11-07 ~03:30): `idx_odds_match_market` 3 scans (27 MB), `idx_odds_match_league_scraped` 10 (19 MB), `idx_odds_bookmaker` 62 (17 MB). 57.6 % of rows are older than 24 h: `cleanup_old_odds` (`06_functions_and_data_fixes.sql:40-50`, called by `cleanupOldOdds`, `odds-repository.ts:159-170`) only runs from observability's `runDailyCleanup` at the 03:00 cron (`scheduler-service.ts:98-113`, which then deletes `scraper_runs` older than 30 days, B11; pinned by `scheduler-service.test.ts:126-150`). It never fires when the service is started by hand. Plan 07 Task 6 builds its `runRetentionCleanup()` seam on top of `runDailyCleanup`.

**Integrity gaps:** no freshness rule in the price path: `updateBestOdds` at `odds-service.ts:65` (`getAllLatestOdds`, loop `:56-66`) and `:168` (`getOddsForMatch`, `:161-168`) uses betcris quotes from 21:02Z at 00:46Z. Observability made bookmaker staleness visible per league (`stale` status, `staleAfterMs`), not per quote, and the owner wants it to stay "only visible" (B12). Writes after kickoff are accepted (Everton–Coventry City stored at 21:00Z after a 20:00Z kickoff).

**A10 baseline.** Observability's A10 check (≥ 0.75 × the run-2 `markets_saved`) has baselines for 9 bookmakers only (`RUN2_OK`, `src/__tests__/helpers/run-fixtures.ts:24-33`); on the future base totalbet, betters, lebull, pzbuk and betcris save too. Every "A10 holds" check below therefore uses a **fresh baseline** that the owner takes after the recovery merge, before the first migration of this plan (Task 0 Step 6): the median `markets_saved` of the last 3 OK runs per (bookmaker, league) in `scraper_runs`.

**Environment facts (read-only, 2026-11-07):** local Postgres is 17.6 (the evidence sketch was tested on 16). There are 52 match ids and 525 (match, bookmaker) pairs. Every `match_id` maps to exactly one `(home_team, away_team)` pair, and there are 0 rows with `home_team = away_team`. The gateway accepts a 2.4 MB RPC body (POST to a non-existent function returned PostgREST's 404, not 413). The authenticator role has `safeupdate` and an 8 s `statement_timeout`.

**Writer verification on a throwaway container of the same image (scratch only, nothing applied to the live DB):**
- Migrations 01–10 apply to a fresh DB.
- Sketch lines 13–224 apply on PG17, and `smoke.sql` returns exactly the documented counts (40 inserted → 40 unchanged → updated 1 / removed 2 → `prune_skipped` true with `row_count` kept at 38).
- The `prune_stale_odds` clauses below delete 45 rows and skip the 40→2 match.
- `get_match_market_rows` is **text-identical** to `json_agg` over `market_comparison ORDER BY category, market_key`.
- `CREATE OR REPLACE VIEW latest_odds` over the new tables succeeds while table `odds` still exists. The rollback (drop cascade + 03/10 bodies) restores it, and re-applying works.
- The backfill needs a `home_team <> away_team` filter, because `matches` has `CHECK (home_team <> away_team)`.

**Design decisions taken here:**
- **No rename at the switch.** The sketch renames `odds` → `odds_legacy` in its migration 13. That would break the still-running legacy writes, the prune and `cleanup_old_odds` at the moment the DDL lands. Instead `latest_odds` is redefined in place, and table `odds` keeps being written for 7 days, so rollback is one SQL file with no data gap. The read-only compat view named `odds` therefore appears in Task 9, when the table is dropped.
- **`matches.start_time` = max over the bookmakers' current reports.** This is migration 10's semantics. The sketch's monotonic `GREATEST` would never move a kickoff earlier.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/11a_odds_freshness_index.sql` (new), `supabase/sql-tests/11a_odds_freshness_index.test.sql` (new), `scripts/sql-test.sh` (new) | freshness index; SQL test runner | 0 |
| `src/repositories/odds-repository.ts` | `getMatchOdds` by `match_id` (1); `getMatchInfoById` → `matches`, `getLastScrapeTime` → `odds_snapshot` (7); `cleanupOdds` (8); `cleanupOldOdds` removed (9) | 1, 7, 8, 9 |
| `src/repositories/full-offer-repository.ts` | export `generateMatchId` (1); batched prune with an optional guard (2); `getMatchMarketRows` (3); write legs per model (6); stale flags in `getFullOfferByMatch` (8); legacy code removed (9) | 1, 2, 3, 6, 8, 9 |
| `src/repositories/odds-snapshot-writer.ts` (new) | `toSnapshotRows`, `writeOddsSnapshots` | 6, 8 |
| `src/config/odds-storage.ts` (new) | `isPruneGuardEnabled` (2), `getOddsWriteModel` (6), `isStaleExclusionEnabled` (8); `getOddsWriteModel` removed (9) | 2, 6, 8, 9 |
| `src/services/scrape-helpers.ts` | `runId` pass-through; degenerate writes into `errors`; rejected writes counted | 2, 6, 8, 9 |
| `src/services/run-outcome.ts` (observability) | "every match rejected after kickoff" → `partial`, never `persist_failed` | 8 |
| aggregator call site of `normalizeAndSaveMatches` (`src/scrapers/aggregator.ts:290`, inside `runFullOfferForBookmaker`) | pass `runId` | 6 |
| `src/services/odds-freshness.ts` (new) | `isStaleQuote`, `staleQuoteThresholdMs` | 8 |
| `src/services/odds-service.ts`, `src/routes/normalized-markets.ts`, `src/types/database.ts` | stale flags, optional best-odds exclusion (off, B12), additive types | 7, 8 |
| plan 07's `runRetentionCleanup()` seam (fallback: observability's `runDailyCleanup`, `src/services/scheduler-service.ts:98-113`) | retention per write model | 8, 9 |
| `src/__tests__/helpers/fake-supabase.ts` (observability) | `rpc()` recording (additive) | 2 |
| `src/repositories/__tests__/full-offer-repository-batch-errors.test.ts:111-121`, `odds-repository-freshness.test.ts:38-56` (observability) | rewritten for the batched prune / the snapshot freshness read | 2, 7 |
| `src/__tests__/fixtures/db/market-comparison-rows.json` (new) | recorded per-match rows | 1, 3 |
| `supabase/migrations/12_odds_quick_wins.sql` … `15_drop_legacy_odds.sql` (new) | SQL | 2, 3, 5, 7, 8, 9 |
| `supabase/rollback/14_odds_read_switch.down.sql` (new) | switch rollback | 7 |
| `supabase/sql-tests/*.test.sql` (new) | SQL tests | 2, 3, 5, 7, 8, 9 |
| `scripts/compare-odds-models.ts` (new) | per-cycle legacy vs model diff | 6 |
| `scripts/clean-ghost-matches.ts`, `scripts/clear-database.ts`, `scripts/match-audit-raw-capture.ts` | repoint to the new tables | 7, 9 |
| `.env.example` | `ODDS_PRUNE_GUARD`, `ODDS_WRITE_MODEL`, `EXCLUDE_STALE_FROM_BEST_ODDS` (commented, after observability's `# Alerts` block) | 2, 6, 8 |

---

### Task 0: Freshness index for observability's status reads (first, mandatory)

Observability's `getBookmakerStatusSnapshot` (`bookmaker-status.ts:204-210`) calls `getOddsFreshnessByBookmaker` (`odds-repository.ts:145-157`), which runs `getLastScrapeTime` (`:116-138`) once per bookmaker: 14 `SELECT scraped_at FROM odds WHERE league_slug = $1 AND bookmaker = $2 ORDER BY scraped_at DESC LIMIT 1` per `/api/odds`, `/api/bookmakers` and `/api/health/scrapers` request, and per league of `/api/odds/batch`. Without an index they walk `idx_odds_scraped_at` backwards (97 ms for lebull, `explain-proxies.txt` E). This is README §5.1's amendment to observability Task 5; migration 11 only indexed `scraper_runs`. It does not wait for Task 7, which moves the read to `odds_snapshot` weeks later.

**Files:**
- Create: `supabase/migrations/11a_odds_freshness_index.sql`, `supabase/sql-tests/11a_odds_freshness_index.test.sql`, `scripts/sql-test.sh`
- Unchanged and must stay green: `src/repositories/__tests__/odds-repository-freshness.test.ts:38-56` (it pins exactly the query shape the index serves).

**Interfaces:**
- Produces (SQL), the whole migration:
  ```sql
  -- 11a: freshness index for getLastScrapeTime (observability Task 5, README §5.1). No BEGIN/COMMIT:
  -- CREATE INDEX CONCURRENTLY cannot run in a transaction; apply-migrations.sh pipes the file to psql without -1.
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odds_league_bm_scraped ON odds (league_slug, bookmaker, scraped_at DESC);
  ```
  It is dropped together with table `odds` in migration 15.
- `scripts/sql-test.sh <first.test.sql> [more.sql …]` (test infrastructure for every later SQL test):
  - Refuses to run if a container `aityper-sqltest` exists.
  - `docker run -d --rm --name aityper-sqltest -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:17.6.1.066` (no published port), then waits ≤ 60 s for `pg_isready`.
  - Applies every `supabase/migrations/*.sql` whose **leading digits** are ≤ the first file's leading digits, in sort order, with `psql -U postgres -d postgres -v ON_ERROR_STOP=1` (so `11a_…` counts as 11 and runs after `11_…`).
  - Pipes each given file through the same `psql`, prints `SQL TESTS PASSED <files>`, and always `docker rm -f aityper-sqltest` (trap EXIT).
  - Never references `supabase_db_backend`.
- SQL test convention (all tasks): plain psql with `\set ON_ERROR_STOP 1`; each file inserts the `market_types` rows it needs; assertions are `DO $$ BEGIN ASSERT <cond>, '<message>'; END $$;`.

- [ ] **Step 1: Write the failing SQL test and the runner.** `11a_odds_freshness_index.test.sql` inserts 14 bookmakers × 2 000 `odds` rows for `premier-league` with increasing `scraped_at` (`generate_series`), runs `ANALYZE odds`, then asserts:
  - `to_regclass('idx_odds_league_bm_scraped') IS NOT NULL` and its definition (`pg_get_indexdef`) is `… (league_slug, bookmaker, scraped_at DESC)`;
  - `EXPLAIN (FORMAT JSON) SELECT scraped_at FROM odds WHERE league_slug = 'premier-league' AND bookmaker = 'lebull' ORDER BY scraped_at DESC LIMIT 1` names `idx_odds_league_bm_scraped` as its scan's `Index Name` (read the plan JSON into a variable in a `DO` block).
- [ ] **Step 2: Run it and confirm it fails** (owner approval to start the throwaway container): `$H scripts/sql-test.sh supabase/sql-tests/11a_odds_freshness_index.test.sql` → FAIL on the first assertion: the runner applies migrations 01–11 (and `11a` once it exists), and the index is not there yet.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run and confirm.** Same command → `SQL TESTS PASSED`. `bash -n scripts/sql-test.sh`. `$H npx vitest run src/repositories/__tests__/odds-repository-freshness.test.ts` stays green unchanged; `$H npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `git add supabase/migrations/11a_odds_freshness_index.sql supabase/sql-tests/11a_odds_freshness_index.test.sql scripts/sql-test.sh` and `git commit -m "perf(db): freshness index for per-bookmaker last-scrape reads"`
- [ ] **Step 6: Owner steps (DEFERRED; record, do not run).** Between runs, never HH:55–HH:10, after migration 11:
  1. Fresh A10 baseline (read-only), saved with the report: `docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' supabase_db_backend psql -U postgres -d postgres -X -c "select bookmaker, league_slug, percentile_disc(0.5) within group (order by markets_saved) as baseline, count(*) runs from (select *, row_number() over (partition by bookmaker, league_slug order by started_at desc) rn from scraper_runs where status in ('success','partial')) x where rn <= 3 group by 1, 2 order by 1, 2"`. Expected: a row for each of the 14 bookmakers that saves in each enabled league (betters/lebull have no `world-cup-2026`).
  2. `EXPLAIN ANALYZE SELECT scraped_at FROM odds WHERE league_slug = 'premier-league' AND bookmaker = 'lebull' ORDER BY scraped_at DESC LIMIT 1;` (read-only). Expected today: ~97 ms via `idx_odds_scraped_at`.
  3. `./scripts/apply-migrations.sh 11a_odds_freshness_index.sql` → `✓ Migration applied successfully`.
  4. Step 2's `EXPLAIN ANALYZE` again. Pass: `Index Scan using idx_odds_league_bm_scraped`, execution < 1 ms; `curl -s -o /dev/null -w '%{time_total}\n' 'http://localhost:3001/api/bookmakers?league=premier-league'` is lower than before step 3.

---

## Phase A: quick wins on the current schema

### Task 1: `getMatchOdds` filters by `match_id`

**Files:**
- Modify: `src/repositories/full-offer-repository.ts:65-69` (export `generateMatchId`), `src/repositories/odds-repository.ts:51-77`
- Test: `src/services/__tests__/odds-for-match.test.ts` (+ file snapshot `src/services/__tests__/__snapshots__/odds-for-match.json`)
- Fixture (one read-only REST GET against the shared DB, between runs; shared with Task 3). The worktree `.env` deliberately points at a dead port, so this reads the main checkout's `.env` for this one command only and writes only inside the worktree. EXECUTION pre-approves only GETs to the live backend: ask the owner once before running it, or let the owner run it.
  ```bash
  # from the WORKTREE root (never cd into the main checkout: the output must land in the worktree)
  ( set -a && . /home/skamik/Documents/repositories/personal/aityper-scraper-api/.env && set +a
  M=$(curl -s 'http://localhost:3001/api/odds?league=premier-league' | jq -r '.data.matches[0].matchId')
  mkdir -p src/__tests__/fixtures/db
  curl -s -G "$SUPABASE_URL/rest/v1/market_comparison" --data-urlencode "match_id=eq.$M" \
    --data-urlencode "order=category,market_key,bookmaker" --data-urlencode "limit=1000" \
    -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  | jq '[.[] | select(.bookmaker == "sts" or .bookmaker == "fortuna" or .bookmaker == "betclic")] | .[0:150]' \
  > src/__tests__/fixtures/db/market-comparison-rows.json )
  jq 'length, ([.[].category] | unique | length), ([.[].bookmaker] | unique)' src/__tests__/fixtures/db/market-comparison-rows.json
  ```
  Expected: ≥ 100 rows, ≥ 2 categories, `["betclic","fortuna","sts"]`. Re-record if not.

**Interfaces:**
- Consumes: `createFakeSupabase` (observability Task 1).
- Produces: `export function generateMatchId(homeTeam: string, awayTeam: string, leagueSlug: string): string` (body unchanged). `getMatchOdds` keeps its signature and return type.

- [ ] **Step 1: Write the failing tests** (`vi.mock("../../config/database.js")` returns the fake; `respond` slices `ROWS` by the recorded `range` call)

```ts
const ROWS = JSON.parse(readFileSync(new URL("../../__tests__/fixtures/db/market-comparison-rows.json", import.meta.url), "utf8"));
const { match_id: MATCH_ID, home_team: HOME, away_team: AWAY } = ROWS[0];

it("filters latest_odds by match_id, never by team names", async () => {
  await getMatchOdds(HOME, AWAY, "premier-league");
  expect(fake.queries[0].table).toBe("latest_odds");
  expect(fake.queries[0].calls).toContainEqual(["eq", "match_id", MATCH_ID]);
  expect(fake.queries[0].calls.filter(([m, c]) => m === "eq" && ["home_team", "away_team", "league_slug"].includes(c as string))).toEqual([]);
});
it("pages in a total order (market_key, then bookmaker)", async () => {
  await getMatchOdds(HOME, AWAY, "premier-league");
  expect(fake.queries[0].calls.filter(([m]) => m === "order").map(([, col]) => col)).toEqual(["market_key", "bookmaker"]);
});
it("getOddsForMatch output for the recorded rows is unchanged", async () => {
  await expect(JSON.stringify(await getOddsForMatch(HOME, AWAY, "premier-league"), null, 1))
    .toMatchFileSnapshot("./__snapshots__/odds-for-match.json");
});
```

- [ ] **Step 2: Run on the unchanged code.** `npx vitest run src/services/__tests__/odds-for-match.test.ts` (without `CI=true`). Expected: the first two tests FAIL, and the third writes the snapshot from **today's** mapping. Keep that file as written; it is the parity reference.
- [ ] **Step 3: Implement.** `getMatchOdds` computes `generateMatchId(homeTeam, awayTeam, leagueSlug)` and filters `.eq("match_id", matchId)`, then `.order("market_key").order("bookmaker")`. Drop the now-unused `getCanonicalTeamName` import if tsc reports it.
  - `(match_id, bookmaker, market_key)` is unique in `latest_odds`, so the order is total and offset paging is stable.
  - Effect: ties in `bestOdds` now go deterministically to the alphabetically first bookmaker, where today the winner is arbitrary.
- [ ] **Step 4: Run and confirm.** Same command → PASS (snapshot unchanged), then `$H npx vitest run`, `$H npx tsc --noEmit`.
- [ ] **Step 5: Live row-set parity — owner step, DEFERRED** (read-only, but it needs the shared DB's credentials, which worktrees deliberately lack; the implementer records the command and the pass criterion in the report). Run from the merged checkout, outside HH:55–HH:10:

```bash
npx tsx -e '(async () => {
  const { getSupabase } = await import("./src/config/database.ts");
  const { fetchAllRows } = await import("./src/utils/supabase-pagination.ts");
  const { getMatchOdds } = await import("./src/repositories/odds-repository.ts");
  const sb = getSupabase();
  const { data: list } = await sb.rpc("get_matches_with_odds", { p_league_slug: "premier-league", p_market_keys: ["MATCH_WINNER"] });
  const key = (r: any) => `${r.bookmaker}|${r.market_key}|${JSON.stringify(r.selections)}`;
  for (const m of list.slice(0, 3)) {
    let t = Date.now();
    const old = await fetchAllRows((f: number, to: number) => sb.from("latest_odds").select("*").eq("league_slug", "premier-league")
      .eq("home_team", m.home_team).eq("away_team", m.away_team).order("market_key").order("bookmaker").range(f, to) as any);
    const tOld = Date.now() - t; t = Date.now();
    const neu = await getMatchOdds(m.home_team, m.away_team, "premier-league");
    const a = (old.data as any[]).map(key).sort(), b = neu.map(key).sort();
    console.log(m.match_id, a.length, b.length, JSON.stringify(a) === JSON.stringify(b) ? "EQUAL" : "DIFF", `${tOld}ms`, `${Date.now() - t}ms`);
  }
  process.exit(0);
})()'
```
Pass: 3 × `EQUAL`, new ≤ 1 000 ms each (old is expected ≥ 5 000 ms). Every PL `match_id` has one name pair today (Observations), so the row sets must be equal. For teams outside the canonical list the new filter returns a superset (all bookmakers whose names normalize alike); that is intended.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/odds-repository.ts src/repositories/full-offer-repository.ts src/services/__tests__/odds-for-match.test.ts src/services/__tests__/__snapshots__/odds-for-match.json src/__tests__/fixtures/db/market-comparison-rows.json
git commit -m "perf(odds): read match odds by match_id (7.7 s -> sub-second)"
```

---

### Task 2: One batched prune per bookmaker save, guard behind a disabled flag (migration 12, part 1)

**Decision: a SQL function, not supabase-js.**
1. The guard needs, for every written match, the previous snapshot's row count. PostgREST here has aggregates disabled, so supabase-js could only count with one HEAD request per match (the round trips this task removes) or by downloading ~13 k rows per bookmaker through 1 000-row pages.
2. One statement makes the prune atomic per bookmaker save. Readers no longer see a half-pruned bookmaker between per-match deletes.
3. `save_odds_snapshot` (Task 5) reuses the same predicate, and both SQL tests pin it.

Batching cuts prune calls from one per match (~190 per run, today sequential at `full-offer-repository.ts:698-702`) to one per bookmaker save (≤ 14 per league-run). It does **not** reduce WAL, because the same rows are deleted. The 676 MB only goes away with Phase B's update-in-place.

**Owner decision B13 (prune guard deferred).** The batching ships unconditionally. The guard is implemented and tested, but **off by default**: `prune_stale_odds(…, p_guard boolean DEFAULT false)` skips nothing unless the code passes `p_guard: true`, which it does only when `ODDS_PRUNE_GUARD=true`. With the flag unset, every written match is pruned exactly as today, so this task changes no data. Open Question 1 asks the owner again with the new evidence.

**Files:**
- Create: `supabase/migrations/12_odds_quick_wins.sql` (section `prune_stale_odds`), `supabase/sql-tests/12_prune_stale_odds.test.sql`, `src/config/odds-storage.ts` (`isPruneGuardEnabled`; Tasks 6 and 8 add to it)
- Modify:
  - `src/repositories/full-offer-repository.ts`: `:268-286` (replace `pruneStaleOddsRows`), `:368-371` (single-match path), `:562-572` (`BatchSaveResult`), `:605` + `:662-664` (row count per match), `:693-702`
  - `src/services/scrape-helpers.ts:7-12, :59-73`
  - `src/__tests__/helpers/fake-supabase.ts` (add `rpc`; observability's helper)
  - `src/repositories/__tests__/full-offer-repository-batch-errors.test.ts:111-121` (observability): "a clean save … still prunes stale rows" now expects `[["upsert"], ["rpc"]]` (one `rpc:prune_stale_odds` call) instead of `[["upsert"], ["delete", "eq", "eq", "lt"]]`
  - `.env.example`: commented `# ODDS_PRUNE_GUARD=false` with one line explaining it (after observability's `# Alerts` block)
- Test: `src/repositories/__tests__/full-offer-repository-prune.test.ts`, `src/services/__tests__/scrape-helpers-prune.test.ts`, `src/config/__tests__/odds-storage.test.ts`
- Must stay green unchanged: `src/services/__tests__/scrape-helpers-batch-errors.test.ts:68` (exact `toEqual` on a `NormalizeAndSaveResult` without prune fields), `src/scrapers/__tests__/aggregator-outcomes.test.ts`, `aggregator-db-down.test.ts` (no prune on a failed batch), `src/services/normalization/__tests__/unmapped-summary.test.ts` (mocks `saveBatchFullOfferMarkets` with a partial result).

**Interfaces:**
- Consumes: `createFakeSupabase`, `formatDbError`, `classifyBookmakerRun` (observability).
- Produces:
  ```ts
  // src/config/odds-storage.ts
  export function isPruneGuardEnabled(env?: NodeJS.ProcessEnv): boolean;   // ODDS_PRUNE_GUARD === "true"; anything else false (B13: default off)
  // full-offer-repository.ts
  export interface PruneSkip { match_id: string; new_rows: number; previous_rows: number }
  export interface PruneStaleOddsResult { deleted: number; pruned_matches: number; prune_skipped: PruneSkip[] }
  async function pruneStaleOdds(bookmaker: PolishBookmaker, scrapedAt: string, newCounts: ReadonlyMap<string, number>): Promise<PruneStaleOddsResult | null>;
  //   one rpc("prune_stale_odds", { p_bookmaker, p_scraped_at, p_new_counts: Object.fromEntries(newCounts), p_guard: isPruneGuardEnabled() });
  //   null on error (logged), never throws
  export interface BatchSaveResult { /* existing + observability fields */ pruneSkipped?: PruneSkip[] }   // set only when non-empty
  // scrape-helpers.ts
  export interface NormalizeAndSaveResult { /* existing */ pruneSkipped?: number }                        // set only when > 0
  // fake-supabase.ts (additive): client.rpc(fn, args) -> thenable; recorded as { table: `rpc:${fn}`, calls: [["rpc", args]] }
  ```
  Both new result fields are **optional** and absent when empty: `aggregator.ts:294` builds a `NormalizeAndSaveResult` literally and `scrape-helpers-batch-errors.test.ts:68` compares one with `toEqual`.
  ```sql
  prune_stale_odds(p_bookmaker text, p_scraped_at timestamptz, p_new_counts jsonb,   -- {"<match_id>": <rows written>, ...}
                   p_min_ratio numeric DEFAULT 0.10, p_min_prev integer DEFAULT 20, p_guard boolean DEFAULT false)
    RETURNS jsonb   -- {"deleted": int, "pruned_matches": int, "prune_skipped": [{"match_id","new_rows","previous_rows"}]}
  ```
  Key clauses (`LANGUAGE sql`, verified on PG17 without the `p_guard` term):
  - `n` = `jsonb_each_text(p_new_counts)`.
  - `prev` = `count(DISTINCT market_key)` of `odds` rows with `bookmaker = p_bookmaker AND scraped_at < p_scraped_at`, grouped by `match_id`, joined to `n`.
  - `skip` = `p_guard AND COALESCE(prev_rows >= p_min_prev AND new_rows < prev_rows * p_min_ratio, false)`.
  - One `DELETE FROM odds o USING g WHERE o.match_id = g.match_id AND NOT g.skip AND o.bookmaker = p_bookmaker AND o.scraped_at < p_scraped_at`.
  - `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`
- Log lines (replace today's per-match `Pruned N stale row(s) for …`; no script parses it):
  - `[FullOfferRepo] Pruned ${deleted} stale row(s) across ${pruned_matches} match(es) for ${bookmaker}` (only when deleted > 0)
  - `console.warn`: `[FullOfferRepo] Prune skipped for ${bookmaker}/${match_id}: degenerate write (${new_rows} of ${previous_rows} rows)` (only possible with the guard on)
  - `console.error`: `[FullOfferRepo] Stale-row prune failed for ${bookmaker}: ${formatDbError(e)}`, plus ` (apply supabase/migrations/12_odds_quick_wins.sql)` when `e.code === "PGRST202"`
- `scrape-helpers` pushes `` `Prune skipped (degenerate write) for ${k} of ${batchResult.matchesProcessed} matches: ${s.match_id} ${s.new_rows}/${s.previous_rows} rows` `` (`s` = first skip) into `errors` and sets `pruneSkipped = k`, only when `k > 0`. With `marketsSaved > 0`, observability's `classifyBookmakerRun` already yields **`partial`** (`run-outcome.ts:79`): the run counts as OK (no streak alert), and the cause lands in `scraper_runs.error_message` and on `/api/health/scrapers`. With the guard off this never happens.

- [ ] **Step 1: Write the failing tests**

```ts
// odds-storage.test.ts
it("the prune guard is off unless ODDS_PRUNE_GUARD=true (owner B13)", () => {
  expect(isPruneGuardEnabled({})).toBe(false);
  expect(isPruneGuardEnabled({ ODDS_PRUNE_GUARD: "1" })).toBe(false);
  expect(isPruneGuardEnabled({ ODDS_PRUNE_GUARD: "true" })).toBe(true);
});
// full-offer-repository-prune.test.ts (fake: upsert ok; rpc:prune_stale_odds -> { data: PRUNE_OK } unless a test overrides)
const LEEDS = "premier-league:leeds united:tottenham hotspur", ARSENAL = "premier-league:arsenal:hull city";
it("prunes once per bookmaker save with every written match and its row count, guard off by default", async () => {
  await saveBatchFullOfferMarkets([{ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", markets: [matchWinner(2.1, 3.4, 3.3), totalGoals("2.5")] },
                                   { homeTeam: "Arsenal", awayTeam: "Hull City", markets: [matchWinner(1.3, 5.5, 9.0)] }], "forbet", "premier-league");
  const rpc = fake.queries.filter((q) => q.table === "rpc:prune_stale_odds");
  expect(rpc).toHaveLength(1);
  expect(rpc[0].calls[0][1]).toMatchObject({ p_bookmaker: "forbet", p_new_counts: { [LEEDS]: 2, [ARSENAL]: 1 }, p_guard: false });
  expect(fake.queries.filter((q) => q.table === "odds" && q.calls.some(([m]) => m === "delete"))).toEqual([]);
});
it("ODDS_PRUNE_GUARD=true passes p_guard: true", async () => { vi.stubEnv("ODDS_PRUNE_GUARD", "true"); /* same save */ expect(rpcArgs().p_guard).toBe(true); });
it("a match with 0 canonical records is sent with 0, not dropped (Review Focus 1)", async () => { /* Arsenal's only market has normalizedType "NOT_IN_CATALOG" */
  expect(rpcArgs().p_new_counts[ARSENAL]).toBe(0);
});
it("does not prune when a batch failed", async () => { /* upsert -> { error: shapes.econnrefused } */ expect(rpcCalls()).toHaveLength(0); });
it("returns degenerate writes as pruneSkipped and warns", async () => {
  // rpc -> { data: { deleted: 0, pruned_matches: 1, prune_skipped: [{ match_id: ARSENAL, new_rows: 1, previous_rows: 312 }] } }
  expect(r.pruneSkipped).toEqual([{ match_id: ARSENAL, new_rows: 1, previous_rows: 312 }]);
  expect(warnSpy).toHaveBeenCalledWith(`[FullOfferRepo] Prune skipped for forbet/${ARSENAL}: degenerate write (1 of 312 rows)`);
});
it("no skip leaves pruneSkipped absent", async () => { expect("pruneSkipped" in r).toBe(false); });
it("a missing function is logged with the migration name and never throws", async () => {
  // rpc -> { error: { code: "PGRST202", message: "Could not find the function public.prune_stale_odds(p_bookmaker, p_guard, p_new_counts, p_scraped_at) in the schema cache", details: null, hint: null } }
  await expect(saveBatchFullOfferMarkets(two, "forbet", "premier-league")).resolves.toMatchObject({ inserted: 3 });
  expect(errorSpy.mock.calls.flat().join("\n")).toContain("(apply supabase/migrations/12_odds_quick_wins.sql)");
});
// scrape-helpers-prune.test.ts (saveBatchFullOfferMarkets mocked; classifyBookmakerRun real)
it("a degenerate write makes the run partial with its cause", async () => {
  // save -> { inserted: 5130, matchesProcessed: 20, errors: 0, failedBatches: 0, totalBatches: 11, firstError: null, pruneSkipped: [{ match_id: ARSENAL, new_rows: 1, previous_rows: 312 }] }
  expect(r.errors).toContain(`Prune skipped (degenerate write) for 1 of 20 matches: ${ARSENAL} 1/312 rows`);
  expect(r.pruneSkipped).toBe(1);
  expect(classifyBookmakerRun({ success: true, matches: twenty }, r).status).toBe("partial");
});
it("no skip adds neither an error nor a pruneSkipped key", async () => { expect(r.errors).toEqual([]); expect("pruneSkipped" in r).toBe(false); });
```
`matchWinner` / `totalGoals` build canonical `ScrapedMarket`s (observability Task 1 test helper style). Also update `full-offer-repository-batch-errors.test.ts:111-121` as listed under Files (it fails after Step 3 until then).

```sql
-- supabase/sql-tests/12_prune_stale_odds.test.sql: previous scrape at 10:00, new scrape at 11:00, bookmaker fortuna
-- A: 40 -> 40, B: 40 -> 2, C: 5 -> 1 (previous < 20), D: 40 -> 4 (exactly 10 %), E: 40 -> 0 rows; plus one sts row on A at 10:00
-- Case 1, default (p_guard false, owner B13): everything is pruned as today
SELECT prune_stale_odds('fortuna', '2026-11-07 11:00+00', '{"premier-league:a:b":40,"premier-league:c:d":2,"premier-league:e:f":1,"premier-league:g:h":4,"premier-league:i:j":0}') AS r \gset
-- ASSERT: (r->>'deleted')::int = 165 (40 + 40 + 5 + 40 + 40); r->>'pruned_matches' = '5'; r->'prune_skipped' = '[]'
-- Case 2: reseed, same call with p_guard => true
-- ASSERT: (r->>'deleted')::int = 85 (A 40 + C 5 + D 40); r->>'pruned_matches' = '3'
--         r->'prune_skipped' = '[{"match_id":"premier-league:c:d","new_rows":2,"previous_rows":40},{"match_id":"premier-league:i:j","new_rows":0,"previous_rows":40}]'
--         (SELECT count(*) FROM latest_odds WHERE match_id = 'premier-league:c:d') = 40
-- Both cases: the sts row on A still exists (Review Focus 5)
--         NOT has_function_privilege('anon', 'prune_stale_odds(text,timestamptz,jsonb,numeric,integer,boolean)', 'EXECUTE')
```

- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/config/__tests__/odds-storage.test.ts src/repositories/__tests__/full-offer-repository-prune.test.ts src/services/__tests__/scrape-helpers-prune.test.ts` → FAIL (module missing, `delete` calls, no `rpc`). `$H scripts/sql-test.sh supabase/sql-tests/12_prune_stale_odds.test.sql` → FAIL: `function prune_stale_odds(…) does not exist`. Starting the container needs owner approval.
- [ ] **Step 3: Implement** `isPruneGuardEnabled`, `prune_stale_odds` in `12_odds_quick_wins.sql` (clauses above) and `pruneStaleOdds`.
  - `saveBatchFullOfferMarkets` records `recordsMap.size` per `matchId` next to `matchIdsWritten`, and calls `pruneStaleOdds` once under the existing `errors === 0 && inserted > 0` rule.
  - `saveFullOfferMarkets` calls it with a one-entry map.
  - `BatchSaveResult.pruneSkipped` and `NormalizeAndSaveResult.pruneSkipped` are set only when non-empty / > 0.
  - Update `full-offer-repository-batch-errors.test.ts:111-121`.
- [ ] **Step 4: Run and confirm.** Both commands above → PASS / `SQL TESTS PASSED`, plus `$H npx vitest run src/repositories src/services/__tests__/scrape-helpers-batch-errors.test.ts src/scrapers/__tests__`. Then `$H npx vitest run`, `$H npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/12_odds_quick_wins.sql supabase/sql-tests/12_prune_stale_odds.test.sql src/config/odds-storage.ts src/config/__tests__/odds-storage.test.ts src/repositories/full-offer-repository.ts src/services/scrape-helpers.ts src/__tests__/helpers/fake-supabase.ts src/repositories/__tests__/full-offer-repository-prune.test.ts src/repositories/__tests__/full-offer-repository-batch-errors.test.ts src/services/__tests__/scrape-helpers-prune.test.ts .env.example
git commit -m "perf(db): one batched prune per bookmaker save; degenerate-write guard behind ODDS_PRUNE_GUARD (off)"
```

---

### Task 3: `get_match_market_rows` for `getFullOfferByMatch` (migration 12, part 2) + Phase A rollout

`get_match_market_rows` reads `latest_odds`, so it works on today's window view (the `match_id` filter goes below the window, one sort in 16 MB). After Task 7 it reads the new model without being redefined.

**Files:**
- Modify: `supabase/migrations/12_odds_quick_wins.sql` (append section), `src/repositories/full-offer-repository.ts:376-400` (`getFullOfferByMatch` head and its `fetchAllRows` block)
- Create: `supabase/sql-tests/12_get_match_market_rows.test.sql`
- Test: `src/repositories/__tests__/full-offer-by-match.test.ts` (+ `src/repositories/__tests__/__snapshots__/full-offer-by-match.json`), fixture from Task 1.

**Interfaces:**
- Produces:
  ```ts
  export interface MarketComparisonRow {
    match_id: string; league_slug: string; home_team: string; away_team: string; market_key: string; market_type_id: number;
    market_code: string; market_name_pl: string; market_name_en: string; view_type: string; category: string;
    param_value: string | null; raw_market_name: string | null; bookmaker: string; selections: MarketSelection[];
    event_url: string | null; scraped_at: string;
  }
  export async function getMatchMarketRows(matchId: string): Promise<MarketComparisonRow[]>;
  //   rpc("get_match_market_rows", { p_match_id }); error -> RepositoryError("Failed to get full offer", "getFullOfferByMatch", error) as today
  ```
  ```sql
  get_match_market_rows(p_match_id text) RETURNS json LANGUAGE sql STABLE SET work_mem = '16MB'
  -- copy $E/proposed-write-model.sql lines 306-313 verbatim (json_agg ORDER BY category, market_key, bookmaker; '[]' when empty)
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// full-offer-by-match.test.ts: fake serves ROWS both as from("market_comparison") pages (old path) and as rpc:get_match_market_rows (new path)
it("reads the whole match in one RPC call", async () => {
  await getFullOfferByMatch(HOME, AWAY, "premier-league");
  expect(fake.queries.map((q) => q.table)).toEqual(["rpc:get_match_market_rows"]);
  expect(fake.queries[0].calls[0][1]).toEqual({ p_match_id: MATCH_ID });
});
it("returns today's FullOfferComparison for the recorded rows", async () => {
  await expect(JSON.stringify(await getFullOfferByMatch(HOME, AWAY, "premier-league"), null, 1))
    .toMatchFileSnapshot("./__snapshots__/full-offer-by-match.json");
});
it("no rows is null, not an error", async () => { /* rpc -> { data: [] } */ expect(await getFullOfferByMatch(HOME, AWAY, "premier-league")).toBeNull(); });
```
```sql
-- 12_get_match_market_rows.test.sql (two bookmakers, two categories, two scrapes of one key)
-- ASSERT get_match_market_rows('premier-league:a:b')::text =
--   (SELECT json_agg(x)::text FROM (SELECT * FROM market_comparison WHERE match_id = 'premier-league:a:b' ORDER BY category, market_key) x)
-- ASSERT get_match_market_rows('nope')::text = '[]'
```

- [ ] **Step 2: Run on the unchanged code.** `$H npx vitest run src/repositories/__tests__/full-offer-by-match.test.ts` → test 1 FAILS (`market_comparison` pages), and test 2 writes the snapshot from today's path; keep it as written. `$H scripts/sql-test.sh supabase/sql-tests/12_get_match_market_rows.test.sql` → FAIL: function missing.
- [ ] **Step 3: Implement** the SQL section and `getMatchMarketRows`. `getFullOfferByMatch` replaces the `fetchAllRows` block (`:386-400`, incl. its error branch) with it; the grouping loop (`:405-451`) is unchanged.
- [ ] **Step 4: Run and confirm.** Both commands PASS (snapshot unchanged), then `$H scripts/sql-test.sh supabase/sql-tests/12_prune_stale_odds.test.sql supabase/sql-tests/12_get_match_market_rows.test.sql`, `$H npx vitest run`, `$H npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/12_odds_quick_wins.sql supabase/sql-tests/12_get_match_market_rows.test.sql src/repositories/full-offer-repository.ts src/repositories/__tests__/full-offer-by-match.test.ts src/repositories/__tests__/__snapshots__/full-offer-by-match.json
git commit -m "perf(odds): read a match's full offer in one RPC instead of 7 window-recomputing pages"
```

- [ ] **Step 6: Baseline before rollout — owner step, DEFERRED** (read-only, same inter-run window as Step 7; the implementer records Steps 6–8 in the report). Save the output as `before.txt` and the time of one normalized-markets call:

```bash
docker exec supabase_db_backend psql -U postgres -d postgres -c "SELECT now(), calls, round(total_exec_time) total_ms, round(mean_exec_time::numeric,1) mean_ms, temp_blks_written, left(regexp_replace(query,'\s+',' ','g'),90) q FROM pg_stat_statements WHERE query ~* '(prune_stale_odds|get_match_market_rows|market_comparison|DELETE FROM \"public\"\.\"odds\")' ORDER BY calls DESC LIMIT 20"
HT=$(jq -r '.[0].home_team|@uri' src/__tests__/fixtures/db/market-comparison-rows.json); AT=$(jq -r '.[0].away_team|@uri' src/__tests__/fixtures/db/market-comparison-rows.json)
curl -s -o /dev/null -w '%{time_total}\n' "http://localhost:3001/api/matches/$HT/$AT/normalized-markets?league=premier-league"
```
- [ ] **Step 7: Apply migration 12, then merge branch A — owner step, DEFERRED** (between runs, never HH:55–HH:10; Task 0's `11a` and observability's `11` first):
  1. `./scripts/apply-migrations.sh 12_odds_quick_wins.sql`. Expected: `✓ Migration applied successfully`.
  2. Verify `docker exec supabase_db_backend psql -U postgres -d postgres -Atc "select proname from pg_proc where proname in ('get_match_market_rows','prune_stale_odds') order by 1"`. Expected: both names.
  3. Merge the branch (one restart).
- [ ] **Step 8: Live pass criteria after the next scheduled cycle — owner step, DEFERRED** (all leagues of the cycle: run ids are per league and leagues run in parallel, so wait for every league's `[ScrapeRun]` line):
  - The log has ≤ 1 `Pruned … across … match(es) for <bm>` line per bookmaker save and 0 `Stale-row prune failed` lines. With `ODDS_PRUNE_GUARD` unset (default) there are 0 `Prune skipped` lines; if the owner has turned the guard on, every `Prune skipped` line names a match whose new rows are < 10 % of its previous rows.
  - Run the Step 6 SQL again. `prune_stale_odds` calls = the number of bookmaker saves, and the per-match `DELETE FROM "public"."odds"` count stays the same.
  - `get_match_market_rows`: `mean_ms` ≤ 150 and `temp_blks_written` = 0 after ≥ 20 calls.
  - The normalized-markets `time_total` is lower than in Step 6.
  - A10 holds against the fresh baseline (Task 0 Step 6): every (bookmaker, league) that saves reaches ≥ 0.75 × its baseline `markets_saved` (14 bookmakers now save; observability's `RUN2_OK` covers only 9).

---

### Task 4: Index hygiene runbook (owner, no code)

These steps tune the legacy table that migration 15 drops, so they are deliberately not migrations. **All of them are owner steps** (EXECUTION rule 3: implementers never touch the shared DB); the implementer only hands this runbook over. Run every command as `docker exec supabase_db_backend psql -U postgres -d postgres -c "<sql>"`, one statement per call (`CONCURRENTLY` cannot run in a transaction). Do it between runs, never HH:55–HH:10. The freshness index `idx_odds_league_bm_scraped` is Task 0's migration, not part of this runbook, and is never dropped here.

- [ ] **Step 1 (day 0, after branch A merged): baseline.** `SELECT now(), indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_stat_user_indexes WHERE relname = 'odds' ORDER BY 2;` Save the output, and the Task 3 Step 6 `prune_stale_odds` `mean_ms`. Start counting from here, because the batched prune may use `idx_odds_bookmaker` (the BitmapAnd in `explain-proxies.txt` D).
- [ ] **Step 2 (day ≥ 7): drop indexes that stayed unused.** Rerun the Step 1 query. Drop each of the three indexes whose `idx_scan` grew by ≤ 10 since Step 1:
  - `DROP INDEX CONCURRENTLY IF EXISTS idx_odds_match_market;`
  - `DROP INDEX CONCURRENTLY IF EXISTS idx_odds_match_league_scraped;`
  - `DROP INDEX CONCURRENTLY IF EXISTS idx_odds_bookmaker;`

  Keep any index that grew by more than 10.
- [ ] **Step 3 (same window): rebuild.** `REINDEX TABLE CONCURRENTLY odds;`. Pass: `SELECT pg_size_pretty(pg_indexes_size('odds'));` ≤ 120 MB (from 428 MB).
- [ ] **Step 4 (24 h later): check.**
  - Read `prune_stale_odds` `mean_ms` with the Task 3 Step 6 SQL. Pass: ≤ 2 × the Step 1 value. Otherwise recreate the index: `CREATE INDEX CONCURRENTLY idx_odds_bookmaker ON odds (bookmaker);`.
  - Re-measure `pg_indexes_size('odds')`. If it is ≥ 200 MB, repeat Step 3 weekly until Task 9.

---

## Phase B: write-model redesign

### Task 5: Additive snapshot model (migration 13) + SQL tests

**Files:**
- Create: `supabase/migrations/13_odds_snapshot_model.sql`, `supabase/sql-tests/13_odds_snapshot_model.test.sql`

**Interfaces:**
- Produces (SQL). Sections and what to copy from `$E/proposed-write-model.sql`:
  1. Tables `matches`, `odds_snapshot`, `odds_current`, `odds_history` and `odds_content_hash(...)`: lines **16–92** verbatim.
  2. `save_odds_snapshot(p_run_id uuid, p_bookmaker text, p_match jsonb, p_rows jsonb, p_min_ratio numeric DEFAULT 0.10, p_min_prev integer DEFAULT 20, p_guard boolean DEFAULT false) RETURNS jsonb` + grants: lines **102–224**, with three edits:
     - (a) Step 1 becomes insert-if-missing: `ON CONFLICT (match_id) DO NOTHING`.
     - (b) After step 4 (snapshot upsert), recompute the kickoff as the max over the bookmakers' current reports: `UPDATE matches m SET start_time = x.st, updated_at = v_now FROM (SELECT max(start_time) AS st FROM odds_snapshot WHERE match_id = v_match_id) x WHERE m.match_id = v_match_id AND m.start_time IS DISTINCT FROM x.st`.
     - (c) The sketch's degenerate test becomes `v_skip := p_guard AND <sketch predicate>` (owner B13: off by default, same flag as Task 2). With `p_guard = false` the function never sets `prune_skipped` or `status 'degenerate'`; the TS writer passes `p_guard: isPruneGuardEnabled()`.

     Return value: `{received, inserted, updated, unchanged, removed, prune_skipped, previous_rows}`. `p_match` = `{match_id, league_slug, home_team, away_team, event_url, start_time}`; `p_rows` = `[{market_key, market_type_id, param_value, custom_name, raw_market_name, selections}]`.
  3. `latest_odds_v2`: the body of lines **242–254** under that name (today's 21 columns, then `changed_at`, `snapshot_status`).
  4. `latest_odds_legacy`: today's `latest_odds` body (`supabase/migrations/03_odds_schema_views.sql:28-60`) under that name, so the comparison works before and after the switch.
  5. `compare_odds_models(p_run_id uuid) RETURNS jsonb`: `{run_id, pairs, legacy_rows, model_rows, only_legacy, only_model, differing, samples}` (samples ≤ 20 `{match_id, bookmaker, market_key, kind}`). Key clauses:
     - `p` = `(match_id, bookmaker)` from `odds_snapshot WHERE last_run_id = p_run_id`.
     - Both views are filtered with `match_id = ANY (ARRAY(SELECT DISTINCT match_id FROM p))`, so the filter passes below the legacy window, and joined to `p`.
     - `FULL JOIN … USING (match_id, bookmaker, market_key)`. `differing` = `(market_type_id, param_value, custom_name, raw_market_name, selections, event_url, home_team, away_team, league_slug) IS DISTINCT FROM` the other side. `scraped_at` and `id` are not compared.
  6. `backfill_odds_snapshot_model() RETURNS jsonb` (`{matches, snapshots, current}`; idempotent, `ON CONFLICT DO NOTHING`, writer-verified on PG17), then `SELECT backfill_odds_snapshot_model();`. Key clauses:
     - `matches`: `DISTINCT ON (match_id)` newest row, `start_time = max(start_time) OVER (PARTITION BY match_id)`, `WHERE home_team <> away_team`.
     - `odds_snapshot`: `DISTINCT ON (match_id, bookmaker)` newest row; `last_seen_at = last_changed_at = max(scraped_at)`, `start_time = max(start_time)`, `row_count = count(DISTINCT market_key)` per pair, `status 'ok'`. Only pairs whose match was inserted.
     - `odds_current`: `DISTINCT ON (match_id, bookmaker, market_key)` newest row, `content_hash = odds_content_hash(...)`, `first_seen_at = changed_at = scraped_at`.
  7. `REVOKE ALL ON FUNCTION save_odds_snapshot(...), backfill_odds_snapshot_model() FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`, then `NOTIFY pgrst, 'reload schema';`.

- [ ] **Step 1: Write the failing SQL test** (`13_odds_snapshot_model.test.sql`). It asserts with `->>` on each result:
  - **Smoke sequence, guard on** (`p_guard => true`): `$E/smoke.sql` lines 1–16, four writes for `premier-league:arsenal:hull city` (kickoff 2030, so Task 8's in-play rule never rejects them).
    - Write 1: `inserted 40`.
    - Write 2: `unchanged 40`, `previous_rows 40`.
    - Write 3: `updated 1, removed 2, unchanged 37`.
    - Write 4: `prune_skipped true, removed 0`. The snapshot keeps `row_count 38`, `status 'degenerate'`, `degenerate_since` not null, and `last_seen_at` equal to write 3's.
    - Afterwards `odds_history` holds 42 rows with selections and 2 tombstones.
  - **Recovery (guard on):** a fifth write of 38 rows → `status 'ok'`, `degenerate_since IS NULL`.
  - **Default, guard off** (same four writes on a second match, `p_guard` omitted): write 4 → `prune_skipped false`, `removed 36`, `row_count 2`, `status 'ok'`, `last_seen_at` moves.
  - **Boundaries (guard on):**
    - previous 40, new 4 → `prune_skipped false`, `removed 36`;
    - previous 19, new 0 → `prune_skipped false`, `removed 19`;
    - first write with `'[]'` → `row_count 0`, `status 'ok'`.
  - **Duplicate key:** `p_rows` with `MATCH_WINNER` twice raises `unique_violation` (`DO` block with `EXCEPTION WHEN unique_violation THEN ok := true`).
  - **Kickoff = max over bookmakers:**
    - bookmaker X reports 15:00 and Y reports 15:30 → `matches.start_time` 15:30;
    - Y then reports 15:00 → 15:00.
  - **Backfill:**
    - Seed legacy `odds` with two scrapes of two matches across two bookmakers, one ghost row (`home_team = away_team`) and one 40→2 degenerate pair.
    - `SELECT backfill_odds_snapshot_model()` → the `FULL JOIN` of `latest_odds_legacy` (ghost excluded) and `latest_odds_v2` on `(match_id, bookmaker, market_key)` has 0 rows that differ on the compared columns. The degenerate pair's `row_count` is 40.
    - A second call returns `{"matches":0,"snapshots":0,"current":0}`.
  - **Compare:**
    - Write identical rows through a legacy `INSERT` and `save_odds_snapshot('77777777-7777-7777-7777-777777777777', …)` → `compare_odds_models('77777777-…')` has `differing 0, only_legacy 0, only_model 0`.
    - After `UPDATE odds_current SET selections = '[]'` on one key: `differing 1`, and `samples->0->>'market_key'` names that key.
  - **Privileges:** `NOT has_function_privilege('anon', 'save_odds_snapshot(uuid,text,jsonb,jsonb,numeric,integer,boolean)', 'EXECUTE')`.
- [ ] **Step 2: Run it and confirm it fails.** `$H scripts/sql-test.sh supabase/sql-tests/13_odds_snapshot_model.test.sql` → FAIL: `relation "matches" does not exist` (migration 13 missing).
- [ ] **Step 3: Implement** `13_odds_snapshot_model.sql` from the sections above.
- [ ] **Step 4: Run and confirm.** The same command → `SQL TESTS PASSED`. Also re-run the two `12_*` test files to confirm migration 13 changes nothing there.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/13_odds_snapshot_model.sql supabase/sql-tests/13_odds_snapshot_model.test.sql
git commit -m "feat(db): additive odds snapshot model with save_odds_snapshot RPC, backfill and model comparison"
```

---

### Task 6: Dual-write behind `ODDS_WRITE_MODEL` + per-run comparison

**Files:**
- Create: `src/repositories/odds-snapshot-writer.ts`, `scripts/compare-odds-models.ts`
- Modify:
  - `src/config/odds-storage.ts` (Task 2's module: add `getOddsWriteModel`)
  - `src/repositories/full-offer-repository.ts:574-704` (`saveBatchFullOfferMarkets`: legs per model, header per match)
  - `src/services/scrape-helpers.ts:14-19, :59-73` (`runId` option)
  - the aggregator's `normalizeAndSaveMatches(…, { useBatchInsert: true })` call (`src/scrapers/aggregator.ts:290`, inside `runFullOfferForBookmaker(runId, …)`, so `runId` is in scope; if plan 07 has moved the call, wherever it lives) gains `runId`
  - `.env.example` (commented `ODDS_WRITE_MODEL=legacy` + one line per value)
- Test: `src/config/__tests__/odds-storage.test.ts` (extend Task 2's file), `src/repositories/__tests__/odds-snapshot-writer.test.ts`, `src/repositories/__tests__/full-offer-repository-write-model.test.ts`, `src/services/__tests__/scrape-helpers-run-id.test.ts`

**Interfaces:**
- Consumes: `save_odds_snapshot`, `compare_odds_models` (Task 5); `PruneSkip` (Task 2); `formatDbError`, `BatchSaveResult.failedBatches/totalBatches/firstError` (observability Task 1); `OddsInsert` (`full-offer-repository.ts:17-32`, `import type` only); `isPruneGuardEnabled` (Task 2).
- Produces:
  ```ts
  // src/config/odds-storage.ts
  export type OddsWriteModel = "legacy" | "dual" | "switched" | "snapshot";
  //   legacy: odds only | dual: both, legacy primary | switched: both, snapshot primary | snapshot: snapshot only
  export function getOddsWriteModel(env?: NodeJS.ProcessEnv): OddsWriteModel;  // ODDS_WRITE_MODEL; unknown -> "legacy" + console.warn once
  // src/repositories/odds-snapshot-writer.ts
  export interface SnapshotMatchHeader { match_id: string; league_slug: string; home_team: string; away_team: string; event_url: string | null; start_time: string | null }
  export interface SnapshotRow { market_key: string; market_type_id: number; param_value: string | null; custom_name: string | null; raw_market_name: string | null; selections: MarketSelection[] }
  export interface SaveOddsSnapshotResult { received: number; inserted: number; updated: number; unchanged: number; removed: number; prune_skipped: boolean; previous_rows: number | null }
  export interface SnapshotWriteSummary {
    calls: number; failedCalls: number; failedRows: number; firstError: string | null;
    received: number; inserted: number; updated: number; unchanged: number; removed: number; pruneSkipped: PruneSkip[]; durationMs: number;
  }
  export function toSnapshotRows(records: readonly OddsInsert[]): SnapshotRow[];  // undefined -> null
  export async function writeOddsSnapshots(runId: string | null, bookmaker: PolishBookmaker,
    perMatch: ReadonlyArray<{ header: SnapshotMatchHeader; records: readonly OddsInsert[] }>): Promise<SnapshotWriteSummary>;
  //   sequential, one rpc per match (incl. 0-record matches) with p_guard: isPruneGuardEnabled(), never throws;
  //   received/inserted/... summed over successful calls
  // full-offer-repository.ts
  export async function saveBatchFullOfferMarkets(matches: …, bookmaker: PolishBookmaker, leagueSlug?: string,
    options?: { runId?: string | null }): Promise<BatchSaveResult>;
  export interface BatchSaveResult { /* … */ pruneSkipped: PruneSkip[]; snapshot: SnapshotWriteSummary | null; secondaryFailures: number }
  // scrape-helpers.ts
  normalizeAndSaveMatches(matches, bookmaker, league, options?: { useBatchInsert?: boolean; runId?: string })
  ```
- Leg rules (primary leg runs first):
  - Primary `legacy` (models `legacy`, `dual`): `BatchSaveResult` as today plus Task 2's prune.
  - Primary `snapshot` (models `switched`, `snapshot`):
    - `inserted = summary.received`, `errors = summary.failedRows`;
    - `totalBatches = summary.calls`, `failedBatches = summary.failedCalls`, `firstError = summary.firstError`;
    - `pruneSkipped = summary.pruneSkipped`.
  - A secondary leg's failures only `console.error` `[FullOfferRepo] ${leg} write (secondary) failed for ${bookmaker}: ${firstError}` and add to `secondaryFailures`; they never touch `errors`. The secondary leg is snapshot in `dual` and legacy in `switched`.
- Observability mapping: `markets_saved` = `inserted` above, i.e. **Σ `received`** of successful calls (rows now current for this write, the same meaning as today's upserted count, so A10 thresholds stay comparable). `degenerate` = `pruneSkipped` → Task 2's error line → `partial` (only possible with `ODDS_PRUNE_GUARD=true`). `p_run_id` = the aggregator's `runId` = `outcome.runId` = `scraper_runs.run_id` (observability Task 4), stored in `odds_snapshot.last_run_id` and `odds_history.run_id`. Run ids are **per league** (each league's `runAllFullOfferScrapers` call mints one), and the leagues of a cycle run in parallel. There is no FK, because `scraper_runs` rows are written after the run.
- One log line per bookmaker save and leg: `` `[FullOfferRepo] ${bookmaker} snapshot (${primary|secondary}): ${calls} calls, received ${r}, inserted ${i}, updated ${u}, unchanged ${n}, removed ${x}, prune skipped ${k}, failed ${f} in ${ms}ms` ``.
- `scripts/compare-odds-models.ts [--run <uuid> …]`:
  - Without `--run`, it compares **every run id of the newest cycle**: the distinct `scraper_runs.run_id` whose `started_at` is within 10 minutes of the newest `started_at` (one per enabled league; the leagues of a cycle start together and run in parallel).
  - It prints one line `ODDS_MODEL_COMPARE <json>` per run id.
  - Exit 0 when `only_legacy + only_model + differing = 0` for every run id, 1 otherwise, 2 on a DB error or when no run id is found.

- [ ] **Step 1: Write the failing tests**

```ts
// odds-storage.test.ts
it("defaults to legacy", () => expect(getOddsWriteModel({})).toBe("legacy"));
it.each(["legacy", "dual", "switched", "snapshot"] as const)("accepts %s", (m) => expect(getOddsWriteModel({ ODDS_WRITE_MODEL: m })).toBe(m));
it("unknown values fall back to legacy with a warning", () => {
  expect(getOddsWriteModel({ ODDS_WRITE_MODEL: "both" })).toBe("legacy");
  expect(warnSpy).toHaveBeenCalledWith('[Config] Unknown ODDS_WRITE_MODEL "both" - using "legacy"');
});
// odds-snapshot-writer.test.ts
const RUN_ID = "440d2fc6-658b-46fe-b288-05261faa0caf";
const HEADER = { match_id: "premier-league:arsenal:hull city", league_slug: "premier-league", home_team: "Arsenal", away_team: "Hull City", event_url: null, start_time: null };
it("rows carry no per-row match header and use null for absent fields", () =>
  expect(toSnapshotRows([rec({ market_key: "MATCH_WINNER", market_type_id: 48, raw_market_name: "1X2" })]))
    .toEqual([{ market_key: "MATCH_WINNER", market_type_id: 48, param_value: null, custom_name: null, raw_market_name: "1X2", selections: SEL }]));
it("one rpc per match, in order, with the run id", async () => {
  const leeds = { ...HEADER, match_id: "premier-league:leeds united:tottenham hotspur", home_team: "Leeds United", away_team: "Tottenham Hotspur" };
  await writeOddsSnapshots(RUN_ID, "fortuna", [{ header: HEADER, records: [rec()] }, { header: leeds, records: [] }]);
  expect(fake.queries.map((q) => q.table)).toEqual(["rpc:save_odds_snapshot", "rpc:save_odds_snapshot"]);
  expect(fake.queries[0].calls[0][1]).toMatchObject({ p_run_id: RUN_ID, p_bookmaker: "fortuna", p_match: HEADER });
  expect(fake.queries[1].calls[0][1]).toMatchObject({ p_rows: [] });
});
it("sums the counts of successful calls", async () => { /* rpc -> {received:40,inserted:0,updated:1,unchanged:39,removed:2,...} x2 */
  expect(s).toMatchObject({ calls: 2, failedCalls: 0, received: 80, updated: 2, unchanged: 78, removed: 4 }); });
it("a failed call is counted, formatted, and the next match is still written (Review Focus 3)", async () => {
  // first rpc -> { error: { code: "23505", message: 'duplicate key value violates unique constraint "_incoming_pkey"', details: "Key (market_key)=(MATCH_WINNER) already exists.", hint: null } }
  expect(s).toMatchObject({ calls: 2, failedCalls: 1, failedRows: 1,
    firstError: 'duplicate key value violates unique constraint "_incoming_pkey" [23505]: Key (market_key)=(MATCH_WINNER) already exists.' });
});
it("collects degenerate snapshots", async () => { /* rpc -> {..., received: 2, prune_skipped: true, previous_rows: 38} */
  expect(s.pruneSkipped).toEqual([{ match_id: HEADER.match_id, new_rows: 2, previous_rows: 38 }]); });
it("never throws when the client rejects", async () => { /* rpc rejects new Error("fetch failed") */
  expect(s).toMatchObject({ failedCalls: 1, firstError: "fetch failed" }); });
// full-offer-repository-write-model.test.ts (vi.stubEnv("ODDS_WRITE_MODEL", …); two matches, 3 canonical records)
it("legacy: no snapshot RPC", …)                       // tables never include "rpc:save_odds_snapshot"
it("dual: legacy is primary; a snapshot failure is logged, not an error", …)
  // r toMatchObject({ inserted: 3, errors: 0, secondaryFailures: 1 }); error log contains "[FullOfferRepo] snapshot write (secondary) failed for fortuna"
it("switched: snapshot counts are primary and the legacy leg still runs", …)
  // r toMatchObject({ inserted: 3 /* Σ received */, totalBatches: 2, failedBatches: 0 }); tables include "odds" upserts and "rpc:prune_stale_odds"
it("snapshot: no legacy upsert and no prune RPC", …)  // no "odds" query, no "rpc:prune_stale_odds"
// scrape-helpers-run-id.test.ts (saveBatchFullOfferMarkets mocked)
it("passes the aggregator run id to the save", async () => {
  await normalizeAndSaveMatches(twenty, "fortuna", "premier-league", { useBatchInsert: true, runId: RUN_ID });
  expect(saveBatch).toHaveBeenCalledWith(expect.any(Array), "fortuna", "premier-league", { runId: RUN_ID });
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/config/__tests__/odds-storage.test.ts src/repositories/__tests__/odds-snapshot-writer.test.ts src/repositories/__tests__/full-offer-repository-write-model.test.ts src/services/__tests__/scrape-helpers-run-id.test.ts` → FAIL: `getOddsWriteModel` and the writer do not exist.
- [ ] **Step 3: Implement** the module, the writer, the legs, the `runId` plumbing and the script. `saveBatchFullOfferMarkets` builds `{ header, records }` per written match from the values it already computes (`matchId`, canonical names, `match.eventUrl ?? null`, `match.startTime ?? null`).
- [ ] **Step 4: Run and confirm.** The same command → PASS, then `npx vitest run`, `npx tsc --noEmit`, and the scripts tsc command from observability Global Constraints for `scripts/compare-odds-models.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/config/odds-storage.ts src/repositories/odds-snapshot-writer.ts src/repositories/full-offer-repository.ts src/services/scrape-helpers.ts src/scrapers/aggregator.ts scripts/compare-odds-models.ts .env.example src/config/__tests__/odds-storage.test.ts src/repositories/__tests__/odds-snapshot-writer.test.ts src/repositories/__tests__/full-offer-repository-write-model.test.ts src/services/__tests__/scrape-helpers-run-id.test.ts
git commit -m "feat(db): dual-write odds to the snapshot model behind ODDS_WRITE_MODEL, with per-run comparison"
```

- [ ] **Step 6: Roll out B1 — owner step, DEFERRED** (the implementer records Steps 6–7 in the report). Do it in one inter-run window that starts ≥ 15 min after the **last** `[ScrapeRun]` line of the cycle (one per league), never HH:55–HH:10:
  1. Merge branch B1. The flag defaults to `legacy`, so behaviour is unchanged.
  2. `./scripts/apply-migrations.sh 13_odds_snapshot_model.sql` → `✓`, and the output ends with the backfill counts.
  3. Set `ODDS_WRITE_MODEL=dual` in `.env` and restart the service.

  Applying 13 and flipping the flag in the same window keeps the backfill and the first dual run consistent.
- [ ] **Step 7: Live pass criteria (gate for Task 7) — owner step, DEFERRED.** After each scheduled cycle, run `npx tsx scripts/compare-odds-models.ts` once every league's `[ScrapeRun]` line of that cycle has appeared.
  - Exit 0 on **≥ 24 consecutive cycles spanning ≥ 24 h**.
  - Every `snapshot (secondary)` line shows `failed 0`.
  - From the second dual run on, Σ unchanged / Σ received ≥ 0.90 (evidence 0.972).
  - A10 still holds against the Task 0 Step 6 baseline.
  - Any diff blocks Task 7 until explained, e.g. a legacy batch failure (no legacy prune) against a successful RPC.

---

### Task 7: Read switch (migration 14, part 1) + repoints

**Files:**
- Create: `supabase/migrations/14_odds_read_switch.sql` (section "switch"), `supabase/rollback/14_odds_read_switch.down.sql`, `supabase/sql-tests/14_odds_read_switch.test.sql`, `supabase/sql-tests/14_rollback.test.sql`
- Modify:
  - `src/repositories/odds-repository.ts:87-110` (`getMatchInfoById`) and `:116-138` (`getLastScrapeTime`, observability's version; its caller `getOddsFreshnessByBookmaker` `:145-157` is unchanged)
  - `src/types/database.ts:176-198` (`latest_odds` Row: `changed_at?: string; snapshot_status?: "ok" | "degenerate"`)
  - `src/repositories/__tests__/odds-repository-freshness.test.ts:38-56` (observability): the per-bookmaker query now targets `odds_snapshot` with `["order", "last_seen_at", { ascending: false }]` and rows `{ last_seen_at }`; `["eq", "league_slug", …]`, `["limit", 1]`, the one-query-per-bookmaker count and the error text `odds freshness query failed for <bm>: <formatDbError>` stay
  - `scripts/clean-ghost-matches.ts:30-79`, `scripts/clear-database.ts:47-72,101-151`, `scripts/match-audit-raw-capture.ts:122-147`
- Test: `src/repositories/__tests__/odds-repository-snapshot-reads.test.ts`

**Interfaces:**
- Consumes: tables and views from Task 5.
- Produces (SQL, section "switch"):
  - `CREATE OR REPLACE VIEW latest_odds AS <the latest_odds_v2 body>`. The body is duplicated, not `SELECT * FROM latest_odds_v2`, so Task 9 can drop v2. Same 21 columns in the same order, plus `changed_at`, `snapshot_status`. `market_comparison` and `matches_with_odds` are not touched; they follow `latest_odds`. `get_match_market_rows` and `get_best_odds` follow too.
  - `CREATE OR REPLACE FUNCTION get_matches_with_odds(p_league_slug text, p_market_keys text[] DEFAULT NULL)`: `$E/proposed-write-model.sql` lines **267–299** verbatim. Same signature and output; `start_time` comes from `matches` (index `matches_league_start`), and `paramValue = min(param_value)` (deterministic; today it is an arbitrary bookmaker's row).
  - Rollback file: `BEGIN; DROP VIEW latest_odds CASCADE;`, then `03_odds_schema_views.sql:28-95`, then `10_filter_market_keys.sql:28-129`, then `COMMIT; NOTIFY pgrst, 'reload schema';` (writer-verified on PG17).
- Produces (TS):
  - `getMatchInfoById(matchId)`: same signature and return shape; reads `matches` (`select("match_id, home_team, away_team, league_slug, start_time").eq("match_id", id).limit(1)`). `start_time` is now the max over bookmakers rather than an arbitrary row's, so it is non-null more often.
  - `getLastScrapeTime(bookmaker, leagueSlug)`: same signature; reads `odds_snapshot.last_seen_at` (`.eq("league_slug").eq("bookmaker").order("last_seen_at", { ascending: false }).limit(1)`), served by index `odds_snapshot_league_bm_seen`. The error text stays `odds freshness query failed for ${bookmaker}: ${formatDbError(error)}`. A degenerate snapshot (guard on only) keeps its last good `last_seen_at`, so freshness reports the last good write. This is the long-term form of README §5.1's amendment for observability Task 5's `getOddsFreshnessByBookmaker`; Task 0's `odds` index serves until then and goes with the table in Task 9.
- Scripts:
  - `clean-ghost-matches.ts` counts and deletes in `matches` (cascades), and in table `odds` while `to_regclass` finds it (`select` probe: a PGRST205 error means the table is gone).
  - `clear-database.ts --odds` clears `odds_current`, `odds_snapshot`, `matches` (each `.delete().not("match_id", "is", null)`, because `safeupdate` needs a filter) plus legacy `odds` while it exists. A new `--history` flag is the only way to clear `odds_history`. `showStats` lists the new tables.
  - `match-audit-raw-capture.ts` reads `odds_snapshot.select("bookmaker, event_url").eq("match_id", id)`.

- [ ] **Step 1: Write the failing tests**

```ts
// odds-repository-snapshot-reads.test.ts
it("getMatchInfoById reads the matches row", async () => { /* data: [{ match_id: ID, home_team: "Arsenal", away_team: "Hull City", league_slug: "premier-league", start_time: "2026-11-08T15:00:00+00:00" }] */
  expect(await getMatchInfoById(ID)).toEqual({ match_id: ID, home_team: "Arsenal", away_team: "Hull City", league_slug: "premier-league", start_time: "2026-11-08T15:00:00+00:00" });
  expect(fake.queries[0]).toMatchObject({ table: "matches" });
  expect(fake.queries[0].calls).toContainEqual(["eq", "match_id", ID]);
});
it("getLastScrapeTime reads odds_snapshot.last_seen_at and parses +00:00", async () => { /* data: [{ last_seen_at: "2026-11-06T16:00:45.385+00:00" }] */
  expect((await getLastScrapeTime("fortuna", "premier-league"))!.toISOString()).toBe("2026-11-06T16:00:45.385Z");
  expect(fake.queries[0].table).toBe("odds_snapshot");
  expect(fake.queries[0].calls).toContainEqual(["limit", 1]);
});
```
```sql
-- 14_odds_read_switch.test.sql
-- ASSERT (SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'latest_odds')
--      = ARRAY['id','match_id','league_slug','home_team','away_team','bookmaker','event_url','market_type_id','market_key','param_value',
--              'custom_name','raw_market_name','selections','scraped_at','market_code','market_name_pl','market_name_en','view_type',
--              'category','has_parameter','expected_selections','changed_at','snapshot_status']
-- after save_odds_snapshot for 2 bookmakers: (SELECT count(*) FROM market_comparison WHERE match_id = M) = (SELECT count(*) FROM odds_current WHERE match_id = M)
-- get_matches_with_odds('premier-league'): a match with start_time now()-1h is absent; one with NULL start_time is present;
--   bookmakers reporting param_value '3.5' and '2.5' for one key -> markets->K->>'paramValue' = '2.5' (min)
-- get_matches_with_odds('premier-league', ARRAY['MATCH_WINNER']) returns only that key
-- 14_rollback.test.sql (run as: scripts/sql-test.sh supabase/sql-tests/14_odds_read_switch.test.sql supabase/rollback/14_odds_read_switch.down.sql supabase/sql-tests/14_rollback.test.sql)
-- ASSERT latest_odds has 21 columns again; inserting one legacy odds row changes count(*) of latest_odds; get_matches_with_odds still callable
```

- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/repositories/__tests__/odds-repository-snapshot-reads.test.ts` → FAIL (table `odds`). `$H scripts/sql-test.sh supabase/sql-tests/14_odds_read_switch.test.sql` → FAIL: column list without `changed_at`.
- [ ] **Step 3: Implement** the switch section, the rollback file, the two repository functions, the types and the three scripts, and rewrite `odds-repository-freshness.test.ts:38-56` as listed under Files (it fails after the `getLastScrapeTime` change until then).
- [ ] **Step 4: Run and confirm.** Both commands plus the rollback chain from Step 1 → PASS, and `$H npx vitest run src/repositories src/services/__tests__/bookmaker-status.test.ts`. Then `$H npx vitest run`, `$H npx tsc --noEmit`, and the scripts tsc command for the three scripts.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/14_odds_read_switch.sql supabase/rollback/14_odds_read_switch.down.sql supabase/sql-tests/14_odds_read_switch.test.sql supabase/sql-tests/14_rollback.test.sql src/repositories/odds-repository.ts src/types/database.ts scripts/clean-ghost-matches.ts scripts/clear-database.ts scripts/match-audit-raw-capture.ts src/repositories/__tests__/odds-repository-snapshot-reads.test.ts src/repositories/__tests__/odds-repository-freshness.test.ts
git commit -m "feat(db): switch latest_odds and get_matches_with_odds to the snapshot model in place"
```

- [ ] **Step 6: Switch window — owner step, DEFERRED** (run after Task 8 Step 5; the implementer records Steps 6–7 in the report). Precondition: the Task 6 gate passed, and Task 8 is committed on the same branch, because migration 14 must be complete. Do everything in one inter-run window: start ≥ 15 min after the cycle's last `[ScrapeRun]` line, finish ≥ 10 min before the next run, never HH:55–HH:10. `D=$(mktemp -d)`.
  1. Align the legacy window: `docker exec supabase_db_backend psql -U postgres -d postgres -Atc "SELECT cleanup_old_odds(24)"`.
  2. Capture the "before" state:
     - `curl -s 'http://localhost:3001/api/odds?league=premier-league&full=true' > $D/odds-before.json`;
     - for the first 3 matches, `jq -r '.data.matches[0:3][] | [(.homeTeam|@uri), (.awayTeam|@uri)] | @tsv' $D/odds-before.json`, then `curl -s "http://localhost:3001/api/matches/$HT/$AT/normalized-markets?league=premier-league" > $D/nm-$i-before.json`.
  3. `./scripts/apply-migrations.sh 14_odds_read_switch.sql` → `✓`. Then `docker exec supabase_db_backend psql -U postgres -d postgres -Atc "SELECT cleanup_odds()"`, using Task 8's function from the same file.
  4. Capture the same URLs as `*-after.json`.
  5. Compare:
     - `NORM='del(.meta) | .data.matches |= (sort_by(.matchId) | map(.markets |= map_values(del(.paramValue) | .bookmakerOdds |= map_values(del(.scrapedAt)))))'`;
     - `diff <(jq -S "$NORM" $D/odds-before.json) <(jq -S "$NORM" $D/odds-after.json)`;
     - `diff <(jq -S . $D/nm-$i-before.json) <(jq -S . $D/nm-$i-after.json)` for i = 1..3;
     - report `paramValue` changes separately: `diff <(jq -r '.data.matches[] | .matchId as $m | .markets | to_entries[] | "\($m)|\(.key)|\(.value.paramValue)"' $D/odds-before.json | sort) <(… after …)`.

  **Pass:** both strict diffs are empty. `paramValue` differences only appear on keys whose bookmakers disagree on `param_value` (spot-check 3 with `SELECT bookmaker, param_value FROM odds_current WHERE match_id = … AND market_key = …`).
  **Fail:** run `./scripts/apply-migrations.sh supabase/rollback/14_odds_read_switch.down.sql` and stop.
- [ ] **Step 7: Flip and verify** (same window).
  1. Merge branch B2. Set `ODDS_WRITE_MODEL=switched` and restart.
  2. After the next scheduled cycle (every league's `[ScrapeRun]` line), check:
     - `compare-odds-models.ts` exits 0;
     - the snapshot lines say `snapshot (primary) … failed 0`;
     - A10 holds against the Task 0 Step 6 baseline, with `markets_saved` now Σ `received`;
     - `/api/bookmakers?league=premier-league` still lists every saving bookmaker as `available` (the freshness read now comes from `odds_snapshot`);
     - in the Task 3 Step 6 SQL extended with `get_matches_with_odds`, its `mean_ms` for the MATCH_WINNER call is below the pre-switch value (76 ms).
  3. **Rollback** at any time within the 7 days: apply the down file, set `ODDS_WRITE_MODEL=dual`, restart. Legacy rows are current, because they kept being written.

---

### Task 8: Retention, in-play rule, stale flag (migration 14, part 2)

**Files:**
- Modify:
  - `supabase/migrations/14_odds_read_switch.sql` (append sections "retention" and "in-play"), `src/repositories/odds-repository.ts` (add `cleanupOdds` after `cleanupOldOdds`, `:159-170`)
  - the retention seam: plan 07's `runRetentionCleanup()` (`src/services/retention-service.ts`, built around observability's `runDailyCleanup`); if plan 07 has not landed, observability's `runDailyCleanup` itself (`src/services/scheduler-service.ts:98-113`, pinned by `scheduler-service.test.ts:126-150`)
  - `src/repositories/odds-snapshot-writer.ts` (`rejected`), `src/repositories/full-offer-repository.ts` (`BatchSaveResult.rejectedStarted`; stale flag in `getFullOfferByMatch`'s bookmaker loop `:438-443` and the `calculateBestOdds` input `:450`)
  - `src/services/scrape-helpers.ts` (`NormalizeAndSaveResult.rejectedStarted?`), `src/services/run-outcome.ts` (observability's `classifyBookmakerRun`: one rule for "every match rejected after kickoff"; plan 07 Task 0 edits the same function, rebase by snippet)
  - `src/services/odds-service.ts:56-66, :161-168`, `src/routes/normalized-markets.ts:89-94, :215-220`, `src/types/database.ts:48-52`, `src/config/odds-storage.ts`, `.env.example`
- Create: `src/services/odds-freshness.ts`, `supabase/sql-tests/14_cleanup_and_inplay.test.sql`
- Test: `src/services/__tests__/odds-freshness.test.ts`, `src/repositories/__tests__/odds-repository-cleanup.test.ts`, `src/services/__tests__/odds-service-stale.test.ts`, `src/routes/__tests__/normalized-markets-stale.test.ts`, the seam's test (plan 07's `src/services/__tests__/retention-service.test.ts`, or `scheduler-service.test.ts:126-150` in the fallback), appended cases in `src/services/__tests__/run-outcome.test.ts` (observability)

**Interfaces:**
- Consumes: `staleAfterMs` (observability, `bookmaker-status.ts:66-68`), `parseDbTimestamp` (observability), `getOddsWriteModel` (Task 6), `deleteScraperRunsOlderThan` (observability, `scraper-run-repository.ts:196`), plan 07's `runRetentionCleanup()` seam (called after every run, at startup and at 03:00). Keep plan 07's exact seam contract: `runRetentionCleanup(): Promise<RetentionResult>` with `RetentionResult = { deleted: number; durationMs: number; error: string | null }`, single-flight, never throws, and it keeps the `scraper_runs` 30-day delete in TS (owner B11). `deleted` is always **odds rows**: legacy rows from `cleanupOldOdds(24)` plus `CleanupOddsResult.current` when `cleanup_odds` ran.
- Produces (SQL):
  - `cleanup_odds(p_kickoff_grace interval DEFAULT '3 hours', p_unseen interval DEFAULT '24 hours', p_history_keep interval DEFAULT NULL) RETURNS jsonb` (`{current, matches, snapshots, history}`): `$E/proposed-write-model.sql` lines **319–342** with two edits:
    - **No `scraper_runs` branch** (drop the `IF to_regclass('public.scraper_runs') … END IF;` block and the `p_runs_keep` parameter): observability's `runDailyCleanup` already deletes `scraper_runs` older than 30 days in TS (B11), and two owners of one retention rule would drift.
    - Count `current` (odds rows): before the sketch's cascading deletes, `DELETE FROM odds_current c USING matches m WHERE c.match_id = m.match_id AND m.start_time < now() - p_kickoff_grace` and `DELETE FROM odds_current c USING odds_snapshot s WHERE c.match_id = s.match_id AND c.bookmaker = s.bookmaker AND s.last_seen_at < now() - p_unseen`, summing both `ROW_COUNT`s.
    - Plus the grants. It never deletes `odds_history` unless `p_history_keep` is passed, and the code never passes it.
  - `CREATE OR REPLACE FUNCTION save_odds_snapshot(...)`: the Task 5 body (incl. `p_guard`) plus, before step 1, `v_start := GREATEST((SELECT start_time FROM matches WHERE match_id = v_match_id), (p_match->>'start_time')::timestamptz); IF v_start <= v_now THEN RETURN jsonb_build_object('received', jsonb_array_length(p_rows), 'inserted', 0, 'updated', 0, 'unchanged', 0, 'removed', 0, 'prune_skipped', false, 'previous_rows', NULL, 'rejected', 'kickoff_passed'); END IF;`. `GREATEST` ignores NULLs; when both are NULL the write is accepted.
- Produces (TS):
  ```ts
  // src/services/odds-freshness.ts
  export function isStaleQuote(scrapedAt: string, now: Date, staleAfter: number): boolean; // now - parseDbTimestamp(scrapedAt) > staleAfter
  export function staleQuoteThresholdMs(): number;                                       // staleAfterMs(CONFIG.SCRAPE_INTERVAL_MINUTES)
  // src/config/odds-storage.ts
  export function isStaleExclusionEnabled(env?: NodeJS.ProcessEnv): boolean;            // EXCLUDE_STALE_FROM_BEST_ODDS === "true"; default false (B12)
  // src/repositories/odds-repository.ts
  export interface CleanupOddsResult { current: number; matches: number; snapshots: number; history: number }
  export async function cleanupOdds(): Promise<CleanupOddsResult>;  // rpc("cleanup_odds", {}); throws Error(`cleanup_odds failed: ${formatDbError(e)}`)
  // writer / repository / helpers
  SaveOddsSnapshotResult.rejected?: "kickoff_passed";  SnapshotWriteSummary.rejectedStarted: string[];  BatchSaveResult.rejectedStarted?: string[]
  NormalizeAndSaveResult.rejectedStarted?: number                                         // set only when > 0
  // run-outcome.ts: classifyBookmakerRun's `save` Pick gains the optional "rejectedStarted"
  // types (additive): BookmakerOddsData.stale?: true; FullOfferComparison bookmakerOdds entry stale?: true;
  //   normalized-markets NormalizedMarketsResponse.stats.staleBookmakers: string[] (sorted)
  ```
- Rules:
  - **Stale (visible only, owner B12).** A quote is stale when `isStaleQuote(scrapedAt, new Date(), staleQuoteThresholdMs())`. It gets `stale: true` (the key is absent otherwise) in `getAllLatestOdds` (`odds-service.ts:56-66`), `getOddsForMatch` (`:161-168`) and `getFullOfferByMatch`. Normalized-markets lists the stale bookmakers of the match in `stats.staleBookmakers`; the grouper is not touched. `bestOdds` keeps stale quotes: the exclusion exists only behind `EXCLUDE_STALE_FROM_BEST_ODDS`, which **stays off** (B12: "stale quotes stay in place and are only made visible"); turning it on needs a new owner decision (Open Question 2). The threshold is observability's `staleAfterMs` and is **not** widened per kickoff tier: plan 10 confirms every listed, unchanged event on each pass, so its `last_seen_at` stays fresh (plan 10 Observations, "Plan 09 semantics").
  - **Rejected writes.** Rejected matches go to `rejectedStarted` and are logged once per save: `[FullOfferRepo] ${bookmaker}: ${k} match(es) rejected, kickoff passed: ${ids}`. They do not count in `markets_saved`. When **every** processed match was rejected and nothing else failed, `scrape-helpers` sets `rejectedStarted = n` and pushes **no** error, and `classifyBookmakerRun` gets one rule before its `marketsSaved === 0` block: `if (save.marketsSaved === 0 && (save.rejectedStarted ?? 0) > 0 && save.errors.length === 0) return { status: "partial", error: \`All ${save.rejectedStarted} matches rejected: kickoff passed\` }`. The run is OK (no streak alert, no `[ALERT] … NOT saved` line, which observability's `buildRunAlerts` raises for every `persist_failed` outcome on every run) and the cause stays visible in `scraper_runs.error_message`. Some matches rejected and others saved is a plain `success`.
  - **Retention seam.** `cleanupOldOdds(24)` runs while the model is not `snapshot`; `cleanupOdds()` runs in `switched` and `snapshot`; `deleteScraperRunsOlderThan(30)` runs in every model (B11, unchanged). Each call is isolated in its own try/catch. One `[Retention]` line per seam call, in the shared format (cross-plan review #25; plan 07's check is a prefix match): `` `[Retention] deleted ${n} odds rows … in ${ms}ms` `` with `…` = `older than 24h` under `legacy`/`dual` (plan 07's text) and `(snapshot model)` under `switched`/`snapshot`, followed by the optional breakdown `` ` (matches=${m}, snapshots=${s}, scraper_runs=${r})` `` whenever `cleanup_odds` ran (`r` from the TS `scraper_runs` step).
  - **Visible effect.** A match's odds disappear from per-match reads 3 h after kickoff (today ~24 h).

- [ ] **Step 1: Write the failing tests**

```ts
// odds-freshness.test.ts (Review Focus 5)
const NOW = new Date("2026-11-06T16:16:18.614Z");
it("older than the threshold is stale; +00:00 parses", () => {
  expect(isStaleQuote("2026-11-06T14:00:00+00:00", NOW, 7_200_000)).toBe(true);
  expect(isStaleQuote("2026-11-06T16:00:45.385+00:00", NOW, 7_200_000)).toBe(false);
});
// odds-repository-cleanup.test.ts
it("calls cleanup_odds and returns its counts", async () => { /* rpc -> { data: { current: 412, matches: 33, snapshots: 2, history: 0 } } */
  expect(await cleanupOdds()).toEqual({ current: 412, matches: 33, snapshots: 2, history: 0 });
  expect(fake.queries[0].table).toBe("rpc:cleanup_odds");
  expect(fake.queries[0].calls[0][1]).toEqual({});   // never p_history_keep, and there is no p_runs_keep
});
it("throws a formatted error", async () => { /* rpc -> { error: shapes.schemaCacheNotReady } */
  await expect(cleanupOdds()).rejects.toThrow("cleanup_odds failed: Could not query the database for the schema cache. Retrying. [PGRST002]"); });
// odds-service-stale.test.ts (getAggregatedOdds mocked; ../bookmaker-status.js getBookmakerStatusSnapshot mocked, because
//   getAllLatestOdds awaits it at odds-service.ts:29; vi.setSystemTime(NOW))
// MATCH_WINNER: sts HOME 2.50 scrapedAt "2026-11-06T11:00:00+00:00" (5 h old), betclic HOME 2.40 scrapedAt "2026-11-06T16:15:00+00:00"
it("flags the stale quote and keeps it in bestOdds (owner B12: visible only)", async () => {
  expect(mw.bookmakerOdds.sts.stale).toBe(true);
  expect("stale" in mw.bookmakerOdds.betclic).toBe(false);
  expect(mw.bestOdds.HOME).toEqual({ bookmaker: "sts", odds: 2.5 });
});
it("the exclusion exists only behind EXCLUDE_STALE_FROM_BEST_ODDS=true (off by default, B12)", async () => {
  vi.stubEnv("EXCLUDE_STALE_FROM_BEST_ODDS", "true");
  expect(mw.bestOdds.HOME).toEqual({ bookmaker: "betclic", odds: 2.4 });
});
// normalized-markets-stale.test.ts (express on port 0; getFullOfferByMatch mocked with the same two bookmakers)
it("lists stale bookmakers in stats", async () => expect(body.data.stats.staleBookmakers).toEqual(["sts"]));
// the seam's test (plan 07's retention-service.test.ts; cleanupOldOdds / cleanupOdds / deleteScraperRunsOlderThan mocked)
it.each([["legacy", 1, 0], ["dual", 1, 0], ["switched", 1, 1], ["snapshot", 0, 1]] as const)("%s runs legacy %i, model %i, scraper_runs always", async (m, legacy, model) => {
  vi.stubEnv("ODDS_WRITE_MODEL", m); await runRetentionCleanup();
  expect(cleanupOldOdds).toHaveBeenCalledTimes(legacy); expect(cleanupOdds).toHaveBeenCalledTimes(model);
  expect(deleteScraperRunsOlderThan).toHaveBeenCalledWith(30);
});
it("snapshot model logs odds rows and the breakdown in the shared [Retention] format", async () => {
  // cleanupOdds -> { current: 412, matches: 33, snapshots: 2, history: 0 }; deleteScraperRunsOlderThan -> 3
  vi.stubEnv("ODDS_WRITE_MODEL", "snapshot");
  expect(await runRetentionCleanup()).toMatchObject({ deleted: 412, error: null });
  expect(logSpy.mock.calls.flat().join("\n")).toMatch(/^\[Retention\] deleted 412 odds rows \(snapshot model\) in \d+ms \(matches=33, snapshots=2, scraper_runs=3\)$/m);
});
// odds-snapshot-writer.test.ts (append): rpc -> {..., rejected: "kickoff_passed"} -> s.rejectedStarted = [HEADER.match_id], s.received excludes it
// scrape-helpers-run-id.test.ts (append): all 20 rejected -> r.rejectedStarted === 20, r.errors === [], r.marketsSaved === 0
// run-outcome.test.ts (append, observability's file)
it("all matches rejected is partial, not persist_failed (Review Focus 4)", () =>
  expect(classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 4100, marketsSaved: 0, errors: [], rejectedStarted: 20 }))
    .toEqual({ status: "partial", error: "All 20 matches rejected: kickoff passed" }));
it("a rejection next to a real save error stays persist_failed with that error", () =>
  expect(classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 4100, marketsSaved: 0, errors: ["Batch insert failed (1 of 1 batches): x"], rejectedStarted: 3 }).status)
    .toBe("persist_failed"));
```
```sql
-- 14_cleanup_and_inplay.test.sql
-- cleanup (seed M1/M2 by direct INSERT into matches/odds_snapshot/odds_current: the RPC now rejects started matches):
--   M1 start now()-4h (2 bookmakers x 3 keys), M2 start now()-2h, M3 snapshot last_seen_at now()-25h (only snapshot, 4 keys), M4 fresh;
--   scraper_runs rows started now()-31 days and now()-29 days; odds_history rows for M1
-- ASSERT cleanup_odds() = '{"current":10,"matches":1,"snapshots":1,"history":0}' (6 rows of M1 + 4 of M3; M3's match is removed as orphan, not counted)
-- ASSERT M1 and M3 gone from matches/odds_snapshot/odds_current; M2, M4 kept; M1 history rows still present
-- ASSERT both scraper_runs rows are still present: cleanup_odds never touches scraper_runs (B11 is done in TS)
-- ASSERT to_regprocedure('cleanup_odds(interval,interval,interval)') IS NOT NULL (no p_runs_keep parameter)
-- started match is rejected: stored start now()-1h, incoming same -> r->>'rejected' = 'kickoff_passed', last_seen_at and history unchanged
-- postponed match is accepted: stored start now()-1h, incoming now()+1h -> r ? 'rejected' is false, matches.start_time = incoming
-- NULL kickoff everywhere -> accepted
```

- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/services/__tests__/odds-freshness.test.ts src/repositories/__tests__/odds-repository-cleanup.test.ts src/services/__tests__/odds-service-stale.test.ts src/routes/__tests__/normalized-markets-stale.test.ts src/services/__tests__/run-outcome.test.ts` plus the seam's test file → FAIL. `$H scripts/sql-test.sh supabase/sql-tests/14_cleanup_and_inplay.test.sql` → FAIL: `cleanup_odds` does not exist.
- [ ] **Step 3: Implement** the two SQL sections and the TS above.
- [ ] **Step 4: Run and confirm.** Both commands, then all `14_*` SQL tests in one chain, `$H npx vitest run`, `$H npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/14_odds_read_switch.sql supabase/sql-tests/14_cleanup_and_inplay.test.sql src/services/odds-freshness.ts src/config/odds-storage.ts src/repositories/odds-repository.ts src/repositories/odds-snapshot-writer.ts src/repositories/full-offer-repository.ts src/services/scrape-helpers.ts src/services/run-outcome.ts src/services/odds-service.ts src/routes/normalized-markets.ts src/types/database.ts src/services/retention-service.ts .env.example src/services/__tests__/odds-freshness.test.ts src/repositories/__tests__/odds-repository-cleanup.test.ts src/services/__tests__/odds-service-stale.test.ts src/routes/__tests__/normalized-markets-stale.test.ts src/services/__tests__/retention-service.test.ts src/services/__tests__/run-outcome.test.ts src/repositories/__tests__/odds-snapshot-writer.test.ts src/services/__tests__/scrape-helpers-run-id.test.ts
git commit -m "feat(db): cleanup_odds retention, reject writes after kickoff, flag stale quotes"
```
(If plan 07 has not landed, add `src/services/scheduler-service.ts` and `src/services/__tests__/scheduler-service.test.ts` instead of the two `retention-service` files.)

- [ ] **Step 6: Live check — owner step, DEFERRED** (runs with Task 7 Step 7; the implementer records it). After the first cycle in `switched`, the log has one `[Retention] deleted … odds rows (snapshot model) in …ms (matches=…, snapshots=…, scraper_runs=…)` line per seam call and no `cleanup_odds failed`.
  - A read-only `SELECT count(*) FROM matches WHERE start_time < now() - interval '3 hours'` returns 0.
  - `SELECT count(*) FROM odds_snapshot WHERE last_seen_at < now() - interval '24 hours'` returns 0.
  - `SELECT count(*) FROM scraper_runs WHERE started_at < now() - interval '30 days'` returns 0 (still the TS step).
  - When a run happens after a kickoff, the log shows `rejected, kickoff passed` for those matches, and `odds_snapshot.last_seen_at` of that match stops moving; no `[ALERT] … NOT saved` line names a bookmaker whose matches were only rejected.

---

### Task 9: Drop the legacy table (migration 15) + remove legacy code

**Gate (owner):**
- ≥ 7 × 24 h in `switched` without a rollback.
- `compare-odds-models.ts` exit 0 on the latest cycle of each of those 7 days.
- Task 8 Step 6 checks green.

**Then (owner):** set `ODDS_WRITE_MODEL=snapshot`, restart, and wait for one clean cycle (A10 holds against the Task 0 Step 6 baseline; the log has no `odds` upserts). Only then apply migration 15 and merge branch B3. The B2 code in `snapshot` mode never touches table `odds`, so the order is safe.

**Files:**
- Create: `supabase/migrations/15_drop_legacy_odds.sql`, `supabase/sql-tests/15_drop_legacy_odds.test.sql`
- Modify:
  - `src/repositories/full-offer-repository.ts`: delete `saveFullOfferMarkets`, `pruneStaleOdds`, `deleteOldFullOfferData` and the legacy leg; `saveBatchFullOfferMarkets` always writes snapshots.
  - `src/services/scrape-helpers.ts`: delete the non-batch branch (today `:73-92`). `useBatchInsert` stays accepted and is ignored, so the aggregator call is untouched.
  - `src/repositories/odds-repository.ts`: delete `cleanupOldOdds` (`:159-170`).
  - `src/config/odds-storage.ts`: delete `OddsWriteModel` and `getOddsWriteModel`; `isPruneGuardEnabled` and `isStaleExclusionEnabled` stay.
  - Retention seam: `cleanupOdds()` plus the unchanged TS `scraper_runs` step (B11).
  - `src/types/database.ts`: `Tables.odds` (`:102`), `OddsInsert` (`:61`) and the `cleanup_old_odds` function type (`:245-248`) removed if tsc shows them unused.
  - `scripts/clean-ghost-matches.ts`, `scripts/clear-database.ts` (legacy branches), `scripts/compare-odds-models.ts` (delete), `.env.example` (drop `ODDS_WRITE_MODEL`).
  - **Tests that assert `cleanupOldOdds` are rewritten in this commit** (cross-plan review #10): plan 07's `src/services/__tests__/retention-service.test.ts` (every `cleanupOldOdds(24)` expectation becomes `cleanupOdds()` with the snapshot-model `[Retention]` line), and observability's `src/services/__tests__/scheduler-service.test.ts` (`:10`, `:21`, `:67`, `:126-150`) wherever `runDailyCleanup` still calls the odds cleanup directly. Find them with `git grep -n cleanupOldOdds -- src`.
  - Observability tests built on the legacy upsert: `src/repositories/__tests__/full-offer-repository-batch-errors.test.ts` (500-row batches → failed `save_odds_snapshot` calls counted in `failedBatches`/`firstError`) and `src/scrapers/__tests__/aggregator-db-down.test.ts:168-169` (12 refused `odds` upserts → 20 refused `rpc:save_odds_snapshot` calls, still `persist_failed` with the same formatted cause).
  - Tests from Tasks 2 and 6 that exercise legacy modes are deleted, and their snapshot-mode cases are kept.
- Test: `src/repositories/__tests__/full-offer-repository-snapshot-only.test.ts`

**Interfaces:**
- Produces (SQL), in this order:
  1. `DROP VIEW latest_odds_legacy;`, `DROP VIEW latest_odds_v2;`
  2. `DROP FUNCTION compare_odds_models(uuid);`, `DROP FUNCTION backfill_odds_snapshot_model();`, `DROP FUNCTION prune_stale_odds(text, timestamptz, jsonb, numeric, integer, boolean);`, `DROP FUNCTION cleanup_old_odds(integer);`
  3. `DROP TABLE odds;` (takes Task 0's `idx_odds_league_bm_scraped` with it; the freshness read moved to `odds_snapshot` in Task 7).
  4. `CREATE VIEW odds AS` `$E/proposed-write-model.sql` lines **259–263**. This is the read-only compat view, a join, so not auto-updatable.
  5. `NOTIFY pgrst, 'reload schema';`

  The `get_latest_odds_by_league` function (06) has no callers and keeps working on the compat view.
- Produces (TS): `saveBatchFullOfferMarkets` keeps its Task 6 signature; `BatchSaveResult` keeps its fields (`secondaryFailures` is always 0).

- [ ] **Step 1: Write the failing tests**

```ts
it("writes only through save_odds_snapshot", async () => {
  await saveBatchFullOfferMarkets(two, "fortuna", "premier-league", { runId: RUN_ID });
  expect(new Set(fake.queries.map((q) => q.table))).toEqual(new Set(["rpc:save_odds_snapshot"]));
});
```
```sql
-- 15_drop_legacy_odds.test.sql
-- ASSERT (SELECT relkind FROM pg_class WHERE relname = 'odds') = 'v'
-- ASSERT inserting into odds raises (DO block catching object_not_in_prerequisite_state / feature_not_supported)
-- ASSERT to_regprocedure('prune_stale_odds(text,timestamptz,jsonb,numeric,integer,boolean)') IS NULL AND to_regprocedure('cleanup_old_odds(integer)') IS NULL
-- after save_odds_snapshot: count(*) FROM odds = count(*) FROM latest_odds for the match
```
- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/repositories/__tests__/full-offer-repository-snapshot-only.test.ts` → FAIL (legacy upsert in the default `legacy` model). `$H scripts/sql-test.sh supabase/sql-tests/15_drop_legacy_odds.test.sql` → FAIL: `odds` is a table.
- [ ] **Step 3: Implement** the migration and the deletions, and rewrite the listed tests.
- [ ] **Step 4: Run and confirm.** Both commands PASS. `grep -rn 'from("odds")' src scripts` and `git grep -n cleanupOldOdds -- src scripts` print nothing. `$H npx vitest run` and `$H npx tsc --noEmit` pass, and so does the scripts tsc command for the two remaining scripts.
- [ ] **Step 5: Commit**

```bash
git rm scripts/compare-odds-models.ts
git add -u src scripts .env.example
git add supabase/migrations/15_drop_legacy_odds.sql supabase/sql-tests/15_drop_legacy_odds.test.sql src/repositories/__tests__/full-offer-repository-snapshot-only.test.ts
git commit -m "chore(db): drop the legacy odds table and its write path"
```
- [ ] **Step 6: Apply and verify — owner step, DEFERRED** (inter-run window, never HH:55–HH:10; the implementer records it).
  1. `./scripts/apply-migrations.sh 15_drop_legacy_odds.sql` → `✓`, then merge branch B3.
  2. **WAL per run** (read-only): read `SELECT pg_current_wal_lsn()` at HH:50 and again at HH:15 of the next hour, then compute `SELECT pg_size_pretty(pg_wal_lsn_diff('<HH:15>', '<HH:50>'))`. Pass: ≤ 60 MB per PL run. Today it is ~300 MB (3 016 MB of odds WAL over ~10 runs); `wal-sim.out` predicts ~14 MB at 2 % change.
  3. **Size:** `SELECT pg_size_pretty(pg_total_relation_size('odds_current') + pg_total_relation_size('odds_snapshot') + pg_total_relation_size('matches'))` ≤ 150 MB (today `odds` = 596 MB).
  4. `/api/odds/batch`, `/api/odds/match` and normalized-markets return 200 for 3 matches; `/api/bookmakers?league=premier-league` lists every saving bookmaker as `available`. A10 holds against the Task 0 Step 6 baseline.

---

## Self-Review

Re-run 2026-11-13 against the future base (scratch merge of `recovery/integration` `aaf7c07` + `recovery/observability` `f0361f0` + `recovery/fortuna` `a8cdb71`); every kept line reference was re-read there.

1. **Spec coverage.**
   - Brief items 1–9 map 1:1 to Tasks 1–9; Task 0 is README §5.1's freshness amendment, now mandatory and first (delta audit README item 10).
   - `markets_saved`, `degenerate` and `p_run_id` mapping: Task 6 Interfaces (run ids are per league; the comparison covers every run id of a cycle). Observability's freshness read: Task 0 now (index), Task 7 later (`odds_snapshot`).
   - README §8 as overridden by the owner: Q2 is Tasks 2/5 with the guard built but off (B13; Open Question 1), Q3 the flag in Task 8, off (B12; Open Question 2), Q4 Task 8 (rejections never become `persist_failed`), Q8 `odds_history` (never cleaned). `scraper_runs` retention stays in TS (B11); `cleanup_odds` has no such branch.
   - README §7 targets: `getMatchOdds` (Task 1 Step 5), per-match DB time (Task 3 Step 8), rows and WAL (Task 9 Step 6).
   - Cross-plan review rows: #10 (Task 9 rewrites plan 07's retention tests), #20 (no "plan 10 must widen"), #25 (shared `[Retention]` format), #37 (Q3 quote fixed).
2. **Step scan.** Every code step names its function and its test. Every live step is an owner step with a command, a time window and a numeric pass (EXECUTION rules 3–4). Fixed while writing:
   - the comparison filters by run id, so failing bookmakers' untouched pairs do not count as diffs;
   - the switch window aligns both retention rules before the before/after diff;
   - `clear-database` deletes carry a filter because of `safeupdate`;
   - 2026-11-13: the fixture recording no longer `cd`s into the main checkout (its output would have landed there); `sql-test.sh` moved to Task 0; A10 uses a fresh 14-bookmaker baseline; observability tests that pin the old prune and freshness shapes are rewritten in the tasks that change those shapes; new result fields are optional because observability builds and compares those objects literally.
3. **Type consistency.**
   - `PruneSkip` (Task 2) is reused by `SnapshotWriteSummary` (Task 6).
   - `BatchSaveResult` and `NormalizeAndSaveResult` grow additively and optionally in Tasks 2, 6 and 8 on top of observability's fields.
   - `src/config/odds-storage.ts` is created in Task 2 (`isPruneGuardEnabled`); Task 6 adds `getOddsWriteModel` (removed in Task 9), Task 8 adds `isStaleExclusionEnabled`.
   - SQL signatures are the same in Interfaces, tests and drops: `prune_stale_odds(text,timestamptz,jsonb,numeric,integer,boolean)`, `save_odds_snapshot(uuid,text,jsonb,jsonb,numeric,integer,boolean)`, `cleanup_odds(interval,interval,interval)` returning `{current, matches, snapshots, history}`.
   - `classifyBookmakerRun` gains one optional input (`rejectedStarted`) and one rule; plan 07 Task 0 edits the same function (rebase by snippet).
4. **Review focus.** Each of the five items names its pinning test and the owning task; items 1 and 2 cover the guard both off (default) and on.
5. **Proportion.**
   - SQL is given as signatures plus key clauses, and the long bodies are referenced by line range in the evidence sketch.
   - Three edits to the sketch (insert-if-missing plus kickoff recompute, the `p_guard` flag, and no rename at the switch) and two to `cleanup_odds` (no `scraper_runs` branch, a `current` count) are stated with their reasons.
   - The tests give names and assertions, not bodies.

## Open Questions

1. **(For the owner, re-asked with new evidence) Turn the prune guard on?** You deferred it (B13), so Tasks 2 and 5 build the guard but keep it off (`ODDS_PRUNE_GUARD` unset): every degenerate write still deletes the match's full snapshot until the next run, exactly as today. Since the deferral, the recovery merge added two more degenerate-write producers: totalbet writes the list 1X2 only when a detail fails (`totalbet/index.ts:274-280`; its details carry `market_count` 439–488) and Betby writes the snapshot's 14–16 listing markets when an event payload fails or is missing (`shared/betby/scraper.ts:150-155`; near matches have 220–242 markets), both reported as `success`. They add to the rest-market listing downgrade (forbet/etoto/fuksiarz/betfan, until plan 03) and sts runs 2–4 (recovery OQ13). The threshold catches all of these (1 of ~450, 16 of ~240), but misses betfan's worst-case listing fallback (35 of ~240 = 14.6 %). Plan 02 Task 13 (gated, plan 02 Open Question 3) removes the totalbet/Betby transport-failure cases at the source. **Recommended default:** set `ODDS_PRUNE_GUARD=true` once branch A is live, keep `0.10` / `≥ 20`; a tripped guard is visible as `partial` with `Prune skipped (degenerate write) …`, so it never hides a failure. If you keep it off, nothing else in this plan changes.
2. **Stale quotes in best odds.** README §8 Q3 (as revised) and recovery OQ12 agree with your B12: stale quotes stay in place and are only made visible. Task 8 marks them (`stale: true`, `stats.staleBookmakers`) and ships `EXCLUDE_STALE_FROM_BEST_ODDS` **off**; turning it on changes `bestOdds` values (not the response shape) and needs a new decision from you. [keep off]
3. **Kickoff grace 3 h.** Per-match pages of a finished match lose their odds 3 h after kickoff, where today it is up to ~24 h. [3 h; `odds_history` keeps the closing line]
4. **Legacy write cost for 7 days after the switch.** The cost is doubled for that time, in exchange for a no-gap rollback. [accept]
