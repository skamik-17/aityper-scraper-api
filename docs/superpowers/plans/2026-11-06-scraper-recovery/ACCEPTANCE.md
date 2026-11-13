# Post-merge acceptance runbook: AITyper scraper recovery (recovery/integration into master)

1. 117 raw deferred checks became 113 runnable checks (4 merged away as duplicates, 0 dropped); every check keeps its plan tag and id.
2. Phase 0, before the merge: 7 checks (docs move-aside, migration 11, latency baseline, archive hand-off, pre-deploy log, guarded merge).
3. Phase 1, right after the merge on the first restart and first run: 46 checks (offline gates, run/API shape, per-bookmaker volume and 1X2 sanity).
4. Phase 2, after 3 or more completed runs: 7 checks (start-burst contention, STS/Betclic/Betcris run checks, 03:00 cleanup, alerts).
5. Phase 3, PL match day or 1-3 days before a round (next PL round 21-23 Nov 2026): 51 checks (OPTA player props, ladders, Betby depth, full-offer Fortuna).
6. Phase 4, dated or waiting for full-offer Ekstraklasa and other leagues (only premier-league is enabled): 2 checks.
7. Top 5 for odds integrity: cross-cutting-5 (player-tier N+ vs peers' (N+1)+ median, catches fake +EV that the 10x detector misses).
8. betcris-95 (side-aware ladder peer check on the 10 side-scoped team ladders, swap detection) and betby-31 (no MAJOR/BROKEN outlier from betters or lebull).
9. pzbuk-42 (smoke: x12Outliers 0 by the 0.025 implied-probability band, vocabularyMisses 0, collisions 0, gatedNonOther 0) and fortuna-67 (HT labels, label leaks, shared-team tokens, 1X2 deviation <= 10%).
10. Landing is fail-soft without migration 11, but apply it first: most phase 1 checks read scraper_runs (observability-6).

Today is 2026-11-13. Plans and evidence live in the branch under docs/superpowers/plans/2026-11-06-scraper-recovery/ (EXECUTION.md, README.md, one plan per bookmaker, evidence/).

## Conventions used by every command

- Main checkout root: `M=/home/skamik/Documents/repositories/personal/aityper-scraper-api` (branch master, `tsx watch` on :3001, local Supabase). Run commands from there (`cd $M`) unless a check says otherwise.
- Integration worktree (read-only source of the plans before the merge): `WT=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/integration`.
- `H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy`: the reviewers' queueing runner for heavy commands. It is optional for the owner; drop the `$H` / `bin/heavy` prefix if you do not want to queue. `--live` is the runner's flag for commands that touch the network.
- `LOG` / `<server log>` / `<backend.log>`: the file that receives the `tsx watch` output. Find it with `readlink /proc/$(pgrep -f "tsx watch src/index.ts" | tail -1)/fd/1` (works only when stdout is redirected to a file; otherwise use the file you redirect to). Before every log check, strip colour codes into a fresh file: `sed 's/\x1b\[[0-9;]*m//g' <raw log> > /tmp/clean.log`. Checks that name their own clean file (`/tmp/backend.clean.log`, `/tmp/etoto-clean.log`, `/tmp/fortuna-run.log`) use the same sed.
- Admin key: `${ADMIN_API_KEY:-dev-api-key}`.
- Live smokes that fetch bookmaker sites: never at HH:00 (the scheduler starts a run there) and never while a scheduled scrape is in flight.
- Evidence paths such as `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/...` exist in the main checkout only after the merge (phase 0 moves the stale untracked copy away first).

## Phase 0 - Before the merge

### 0.1 Move the colliding untracked docs aside

State of the main checkout today (read-only inspection 2026-11-13): branch master @ 377b47e, which is the merge-base with recovery/integration, so the merge is a fast-forward. Untracked files that COLLIDE with files the branch adds: 264 files, all under `docs/superpowers/plans/2026-11-06-scraper-recovery/` (an older copy of these plans; the branch adds 286 files there).

| Path in the main checkout | What it is | Action |
|---|---|---|
| `docs/superpowers/plans/2026-11-06-scraper-recovery/` (264 untracked files) | Old copy of the recovery plans and evidence | MOVE aside (totalbet-34). The merge aborts otherwise. |
| `docs/superpowers/plans/2026-11-07-scraper-performance/` (364 untracked files) | The scraper performance plan set; not on the branch | LEAVE in place (no collision). Do NOT `mv docs/superpowers` as sts-48 suggested. |
| `src/data/promotions/`, `src/routes/promotions.ts`, `src/services/promotions-service.ts`, `src/types/promotions.ts`, `src/services/__tests__/promotions-service.test.ts` (untracked) and modified `src/routes/index.ts` | Your uncommitted promotions work | LEAVE. The branch does not touch `src/routes/index.ts` or add these paths; `git diff --name-only HEAD recovery/integration -- src/routes/index.ts` prints nothing. The branch does change `src/types/api.ts`, `src/types/database.ts`, `src/types/full-offer.ts`, `src/data/market-catalog.ts`; run `npx tsc --noEmit` right after the merge (betby-24) to confirm the promotions code still compiles. |

Compare the old copy with the branch copy BEFORE moving (read-only):

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api
WT=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/integration
P=docs/superpowers/plans/2026-11-06-scraper-recovery
diff -rq $P $WT/$P | grep -c '^Only in docs'      # expected 0: the old copy has no file the branch lacks
diff -rq $P $WT/$P | grep -c '^Files'             # 18 on 2026-11-13: same file, older text in the old copy
diff -rq $P $WT/$P | grep -c "^Only in $WT"       # 22 on 2026-11-13: files only the branch has
git ls-files --others --exclude-standard | grep -c "^$P/"   # 264
```

If the first number is not 0, copy those files into the aside directory's `keep/` folder (or into the branch worktree) before the merge. Keep the aside directory until phase 1 has passed; `diff -rq` between it and the merged tree should then show only the 18 older files, the 22 branch-only files and nothing else.

Then run totalbet-33 (precheck, expected today: `untrackedCollisions=264 ok=False`), totalbet-34 (the move), and totalbet-33 again (expected `ok=True`).

### 0.2 New environment variables and their defaults

Nothing is required. Both are optional and the main `.env` has no `ALERT_*` keys, so the defaults apply.

| Variable | Default | Behaviour |
|---|---|---|
| `ALERT_CONSECUTIVE_FAILURES` | `3` | Consecutive failed runs of one bookmaker before an `[ALERT]` line. Must be a positive integer; any other value logs a startup warning and falls back to 3. |
| `ALERT_WEBHOOK_URL` | unset (off) | Optional Slack-compatible webhook that also receives the alert lines as `{"text": ...}`; unset means stderr only. |

No new dependencies. `package.json` adds only the `dev:stack` script (`scripts/dev-stack.sh`; use `--check` only while :3001 is up). `npm run db:migrate` with no argument now exits 2 instead of re-running every migration. `.env.example` documents both variables.

### 0.3 Migration 11 (scraper_runs observability)

File: `supabase/migrations/11_scraper_runs_observability.sql` (in the branch; additive and idempotent: `ADD COLUMN IF NOT EXISTS run_id UUID`, `markets_found INTEGER`, one index). Not applied yet. Without it the run insert fails soft (PGRST204), is logged as `[ScraperService] scraper_runs not persisted: ... (apply supabase/migrations/11_scraper_runs_observability.sql)`, and scraping, saving and the API keep working, but `bookmakerStatus` never becomes `error` and `meta.lastUpdated` stays null. Recommended: apply it BEFORE the merge (safe on master; needs your approval; Docker container `supabase_db_backend` is running). Command and check: observability-6 below. If you merge first, run cross-cutting-1 in phase 1 and apply the migration afterwards with the single-file form.

### 0.4 Log baselines to record before the merge

```bash
LOG=$(readlink /proc/$(pgrep -f "tsx watch src/index.ts" | tail -1)/fd/1)       # re-check; the path differs per session
L0=$(wc -l < "$LOG"); echo "L0=$L0"                                           # raw-log line count (betclic-55 uses it)
sed 's/\x1b\[[0-9;]*m//g' "$LOG" > ~/sts-backend.clean.log; S=$(wc -l < ~/sts-backend.clean.log); echo "S=$S"   # sts-51 baseline (from sts-48)
sed 's/\x1b\[[0-9;]*m//g' "$LOG" > /tmp/lvbet-pre.log && grep -c 'for lvbet HALF_TIME_TOTAL_GOALS:2.0 ' /tmp/lvbet-pre.log   # lvbet-82
```

The totalbet guard in totalbet-35 writes its own `/tmp/totalbet-deploy-l0.txt` and `/tmp/totalbet-deploy-t0.txt`.

### 0.5 The merge

totalbet-35 (guarded merge, a fast-forward). A plain equivalent is `git -C $M merge --ff-only recovery/integration` after totalbet-33 prints `ok=True`. The merge changes `src/`, so `tsx watch` restarts the server on its own; the restart triggers the startup scrape. `docs/` changes do not restart it.

### Phase 0 checks

#### totalbet-33 - L1 merge precheck (Step 3a, TARGET=recovery/integration)
- When: Before the merge
- Command (from the main checkout root):
```bash
M=/home/skamik/Documents/repositories/personal/aityper-scraper-api; TARGET=recovery/integration; H=$(git -C $M merge-base --is-ancestor recovery/totalbet $TARGET && echo True || echo False); C=$(comm -12 <(git -C $M ls-files --others --exclude-standard | sort) <(git -C $M diff --name-only --diff-filter=A HEAD $TARGET | sort) | wc -l); echo "PRECHECK target=$TARGET hasTotalbet=$H untrackedCollisions=$C ok=$([ $H = True ] && [ $C -eq 0 ] && echo True || echo False)"
```
- Expected: Today: hasTotalbet=True untrackedCollisions=264 ok=False. After L2: ok=True.

#### totalbet-34 - L2 move the untracked recovery docs aside (Step 3b)
- Merged ids: sts-48
- When: Right after L1, before the merge
- Command (from the main checkout root):
```bash
M=/home/skamik/Documents/repositories/personal/aityper-scraper-api; ASIDE=/home/skamik/Documents/repositories/personal/aityper-scraper-api-untracked-recovery-docs; [ ! -e "$ASIDE" ] && mkdir -p "$ASIDE" && mv "$M/docs/superpowers/plans/2026-11-06-scraper-recovery" "$ASIDE/" && echo "MOVED-ASIDE files=$(find "$ASIDE" -type f | wc -l) to $ASIDE"
```
- Expected: MOVED-ASIDE files=264, then L1 prints ok=True.
- Note: Merged with sts-48 (same purpose: clear the untracked docs so the ff-merge does not abort with 'untracked working tree files would be overwritten'). Move ONLY the collision directory, as here: sts-48's `mv docs/superpowers ~/sts-docs-backup-$(date +%F)` would also move docs/superpowers/plans/2026-11-07-scraper-performance, which does not collide and which you want to keep. The sts-48 log baseline (S) is in section 0.4.

#### observability-6 - L0 migration 11 applied
- Merged ids: cross-cutting-2
- When: Before merging recovery/integration into master (safe on master), with owner approval
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && ./scripts/apply-migrations.sh /home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/integration/supabase/migrations/11_scraper_runs_observability.sql && set -a; . ./.env; set +a; curl -s "$SUPABASE_URL/rest/v1/scraper_runs?select=run_id,markets_found&limit=1" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```
- Expected: '✓ Migration applied successfully'; curl returns [] or rows with "run_id":null, with no 42703/PGRST204 error JSON. Always pass the single file.
- Note: Before the merge the SQL file exists only in the integration worktree, so the script gets its absolute path (the script accepts a path or a bare file name). After the merge the single-file form `./scripts/apply-migrations.sh 11_scraper_runs_observability.sql` works as well. ALWAYS pass exactly one file: on master the no-argument form re-runs EVERY migration. The SQL is additive and idempotent (ADD COLUMN IF NOT EXISTS run_id, markets_found; one index). Merged with cross-cutting-2 (same apply command; its after-run health curl is check observability-14 in phase 1).

#### observability-21 - L15 batch poll latency
- When: Twice: once on master BEFORE the merge (baseline), once after the merge and restart
- Command (from the main checkout root):
```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{time_total}\n' -X POST -H 'Content-Type: application/json' -d '{"leagues":["ekstraklasa","premier-league","laliga","bundesliga","serie-a","ligue-1","world-cup-2026"]}' http://localhost:3001/api/odds/batch; done
```
- Expected: The after-merge median is no more than about 0.3 s above the baseline; otherwise implement OBS-F13
- Note: Run the loop on master first and keep the five times; run it again in phase 1 after the restart. The check is the comparison.

#### lvbet-81 - D0 archive hand-off (Group E)
- When: Now, before any worktree cleanup
- Command (from the main checkout root):
```bash
cp /home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/lvbet/.scratch/raw-archive/lvbet/premier-league_arsenal_hull_city__2026-11-07.json /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/raw-archive/lvbet/ && sha256sum /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/raw-archive/lvbet/premier-league_arsenal_hull_city__2026-11-07.json ; then with approval: git -C /home/skamik/Documents/repositories/personal/aityper add docs/audit-ledger/raw-archive/lvbet/premier-league_arsenal_hull_city__2026-11-07.json
```
- Expected: sha256 ea4c2ba8488de4a731552a1add2aa448e73c8712afcb132a1a896922b6e9638a. Only that one path is staged (never -A).

#### lvbet-82 - D0b save the pre-deploy reference log (PRELOG)
- When: Just before restarting the backend on the merged master
- Command (from the main checkout root):
```bash
sed 's/\x1b\[[0-9;]*m//g' <backend.log> > /tmp/lvbet-pre.log && grep -c 'for lvbet HALF_TIME_TOTAL_GOALS:2.0 ' /tmp/lvbet-pre.log
```
- Expected: > 0 (7 on 2026-11-06). These are the matches that offer half-time line 2, used by D7.

#### totalbet-35 - L3 guarded merge writing T0/L0 (Step 3c)
- When: Deploy
- Command (from the main checkout root):
```bash
Step 3c one-liner from docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/acceptance-2026-11-07.txt (the line starting `M=...; LOG=...; TARGET=recovery/integration; rm -f /tmp/totalbet-deploy-t0.txt ...`), with TARGET=recovery/integration and LOG set to the real log (see section 0.4). Read it from the integration worktree before the merge (the file is not in the main checkout until the merge). It is guarded by the same precheck as totalbet-33 and ends in `git -C $M merge $TARGET; echo "exit=$?"`.
```
- Expected: A fast-forward of master to recovery/integration, then exit=0. /tmp/totalbet-deploy-t0.txt and /tmp/totalbet-deploy-l0.txt are written.

## Phase 1 - Right after the merge, on the first restart and the first run

Order: (a) offline gates and static checks, (b) DB-down drills, (c) wait for the startup scrape to finish (look for `[Scheduler] Initial scrape completed` or the first `[ScrapeRun] premier-league` line; the first scrape waits up to 120 s for the DB), (d) log and API checks on that run, (e) live read-only smokes. Re-clean the log before every log check.

#### observability-7 - L1 merge state
- When: Right after the merge
- Command (from the main checkout root):
```bash
grep -L executeFullOfferScrape src/scrapers/bookmakers/{betters,lebull,totalbet,pzbuk}/index.ts; grep -l describeCaptureFailure src/scrapers/bookmakers/pzbuk/index.ts
```
- Expected: The first command lists betters, lebull and totalbet; the second lists pzbuk. None of the A2/A4 recorder substrings apply.

#### betby-24 - Unit gate after merging into master
- When: Right after merging recovery/integration into master, before restarting the dev server
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit && npx vitest run
```
- Expected: tsc reports no errors and every test passes. The golden lines read 'betters/premier-league_leeds-united_tottenham-hotspur: entries=242 blessed=242 unblessed=0 failures=0', and the same for lebull.

#### sts-49 - Offline gate on the merged tree
- When: Right after the merge
- Command (from the main checkout root):
```bash
/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy npx vitest run src/scrapers/bookmakers/sts src/services/normalization/__tests__/sts-normalizer-2026-11.test.ts && /home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy npx vitest run src/services/normalization/__tests__/golden.test.ts -t sts
```
- Expected: All green; golden reports failures=0 for sts/premier-league_arsenal_hull_city and for sts/world-cup-2026_france_morocco (entries=270 blessed=166).

#### betcris-92 - C0 offline sanity: betcris tests, golden and rebless dry
- When: Right after recovery/integration is merged into master. No network, no DB.
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && /home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy npx vitest run src/scrapers/bookmakers/betcris src/services/normalization/__tests__/golden.test.ts src/services/normalization/__tests__/unmapped-summary.test.ts src/services/audit/__tests__/prep-archive-param.test.ts && /home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy npx tsx scripts/rebless-golden.ts --bookmaker betcris --dry
```
- Expected: All tests pass, and rebless prints {"changedTotal":0,"dry":true}.

#### etoto-106 - G0 gate: master contains the etoto fixes and the backend ran etoto on them
- When: Right after recovery/integration is merged into master and the :3001 backend is restarted
- Command (from the main checkout root):
```bash
grep -c PENALTY_TOTAL_ZERO_FIVE_NAME src/services/normalization/bookmakers/etoto-normalizer.ts && grep -c '\[168\]: "HOME"' src/services/normalization/bookmakers/etoto-normalizer.ts && sed 's/\x1b\[[0-9;]*m//g' <backend.log> > /tmp/etoto-clean.log && grep -E '\[Aggregator/FullOffer\] etoto (success|partial):' /tmp/etoto-clean.log | tail -1
```
- Expected: Both greps print >= 1, and there is a '[Aggregator/FullOffer] etoto success:' (or partial:) line after the restart. Do not wait for 'etoto completed:'; that line no longer exists.
- Note: Amendment: the first grep targets PENALTY_TOTAL_ZERO_FIVE_NAME (the removed PENALTY_KICK_WORDING no longer exists; grepping it prints 0 and fails the && chain).

#### lvbet-91 - Offline O1-O3 (calendar-independent)
- When: Any time after the merge
- Command (from the main checkout root):
```bash
EV=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet; OUT=$(mktemp -d); REPO_ROOT=$PWD npx tsx $EV/tools/lvbet-parse.ts $EV/markets-search-arsenal-hull-full-2026-11-06.json Arsenal "Hull City" $OUT/parsed.json && REPO_ROOT=$PWD npx tsx $EV/tools/offline-norm.ts $OUT/parsed.json lvbet Arsenal "Hull City" premier-league $OUT/norm.json && python3 -I -c 'import json,sys,collections; c=collections.Counter(r["key"] for r in json.load(open(sys.argv[1]))["rows"] if r["code"]!="OTHER"); print(sorted(k for k,n in c.items() if n>1))' $OUT/norm.json
```
- Expected: {"rawCount":549,"parsed":965,"withParam":428}; unknownPct <= 40 (34.7 on d2fdfd1); duplicates exactly ['HALF_TIME_CARDS_TOTAL:0.5','HALF_TIME_TOTAL_GOALS','HALF_TIME_TOTAL_GOALS:0.5','SECOND_HALF_TOTAL_GOALS','SECOND_HALF_TOTAL_GOALS:0.5'].

## betcris

#### observability-10 - L4 A8 live
- When: After the merge, Supabase up
- Command (from the main checkout root):
```bash
bash scripts/dev-stack.sh --check; echo "exit $?"
```
- Expected: 'Supabase reachable at http://127.0.0.1:54321 (market_types HTTP 200)', exit 0. Do not run dev:stack without --check while :3001 answers (it exits 1 'API already running on :3001').

#### observability-9 - L3 A7/A8 dead paths
- When: After the merge
- Command (from the main checkout root):
```bash
SUPABASE_URL=http://127.0.0.1:59999 npx tsx scripts/scraper-status.ts; echo "exit $?"; SUPABASE_URL=http://127.0.0.1:59999 bash scripts/dev-stack.sh --check; echo "exit $?"
```
- Expected: scraper-status: 'Database unreachable at http://127.0.0.1:59999: ...', exit 2. dev-stack: 'Supabase NOT reachable at http://127.0.0.1:59999 (HTTP 000)', exit 1

#### observability-8 - L2 A1 DB-down drill
- When: After the merge, any time
- Command (from the main checkout root):
```bash
SUPABASE_URL=http://127.0.0.1:59999 SUPABASE_SERVICE_KEY=dummy npx tsx scripts/smoke-bookmaker.ts --bookmaker forbet --persist; echo "exit $?"
```
- Expected: exit 3; output contains '[ALERT] scrape run ABORTED for premier-league: database unreachable - TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)' and no '[Aggregator/FullOffer] Starting'
- Note: Amendment (L2): the DB probe is bounded at 5 s per attempt. With a blackholed (non-refusing) SUPABASE_URL the message is `TimeoutError: The operation was aborted due to timeout` within about 5 s, not an undici default timeout. The ECONNREFUSED command above is the reviewers' drill.

#### cross-cutting-1 - First full run after merging to master, migration 11 not yet applied: fail-soft and API shape
- When: First scheduled or startup run after the tsx-watch restart
- Command (from the main checkout root):
```bash
grep -c '^\[ScrapeRun\] premier-league' <backend log since restart>; grep 'scraper_runs not persisted' <log>; curl -s 'http://localhost:3001/api/odds?league=premier-league' | python3 -I -c "import json,sys;m=json.load(sys.stdin)['meta'];print(sorted(set(m['bookmakerStatus'].values())),'bookmakerHealth' in m,len(m['bookmakerStatus']))"
```
- Expected: One [ScrapeRun] line per run. 14 '[Aggregator/FullOffer] <bm> <status>:' lines. One 'scraper_runs not persisted … (apply supabase/migrations/11_scraper_runs_observability.sql)' line per run. The curl prints a subset of ['available','stale'], then True and 14.
- Note: CONDITIONAL. Only meaningful when the merge happens BEFORE migration 11 is applied (the fail-soft path). If you applied migration 11 in phase 0 (recommended order), there is no 'scraper_runs not persisted' line; the expected result then is zero such lines and the same 14 FullOffer lines, and cross-cutting-1 collapses into observability-14/15.

#### cross-cutting-3 - The four revived bookmakers save in the first full run
- When: First full run after the merge
- Command (from the main checkout root):
```bash
grep -E '\[Aggregator/FullOffer\] (betters|lebull|totalbet|pzbuk) (success|partial|empty|scrape_failed|persist_failed):' <log>
```
- Expected: Four lines, each with status success or partial and 'saved' > 0.

#### observability-12 - L6 A3 per-run line vs scraper_runs
- When: After the first persisted run (the startup scrape after the merge restart, the top of the hour, or a POST /api/admin/scrape with Bearer dev-api-key)
- Command (from the main checkout root):
```bash
sed 's/\x1b\[[0-9;]*m//g' <server log> > /tmp/clean.log; RUN=$(grep -o 'Starting run [0-9a-f-]\{36\} for premier-league' /tmp/clean.log | tail -1 | cut -d' ' -f3); grep '^\[ScrapeRun\] premier-league' /tmp/clean.log | tail -1; set -a; . ./.env; set +a; curl -s "$SUPABASE_URL/rest/v1/scraper_runs?run_id=eq.$RUN&select=bookmaker,status,markets_saved" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```
- Expected: The line contains run=${RUN:0:8}; there are 14 rows; ok=N/14 equals the rows with status success|partial; saved= equals their summed markets_saved; exactly one [ScrapeRun] line per non-aborted run
- Note: Amendment (L6/L8, partial runs): a betcris run that aborted part-way, or a totalbet run with detail failures or slug drift, is now `partial` in scraper_runs with its error text. It still counts in ok=N/14 and saved=. It also shows as a `[Aggregator/FullOffer] <bm> partial: ...` warn line and as `lastError` in /api/health/scrapers. A row with status `partial` and an error text is not a defect.

#### observability-14 - L8 A4 /api/health/scrapers
- When: After L6
- Command (from the main checkout root):
```bash
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:3001/api/health/scrapers?league=premier-league'; curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3001/api/health/scrapers?league=..%2Fetc'
```
- Expected: HTTP 200 without auth, 14 entries in CONFIG order, source scraper_runs; every bookmaker that saved rows is available with consecutiveFailures 0; a failing one shows its own plan's error text. The bad slug returns 400.
- Note: Amendment (L8, partial runs): a bookmaker whose latest run is `partial` stays `available` and shows its error text in `lastError`. cross-cutting-2 (merged): after migration 11 and the next run, `curl -s 'http://localhost:3001/api/health/scrapers?league=premier-league' | python3 -I -c "import json,sys;d=json.load(sys.stdin)['data'];print(d['source'],sum(1 for b in d['bookmakers'] if b['lastStatus']))"` prints `scraper_runs 14`, there is no `scraper_runs not persisted` line, and meta.lastUpdated in /api/odds is non-null.

#### observability-15 - L9 A5 /api/odds
- When: After L6
- Command (from the main checkout root):
```bash
curl -s 'http://localhost:3001/api/odds?league=premier-league' | python3 -I -c "import json,sys,collections;m=json.load(sys.stdin)['meta'];print(collections.Counter(m['bookmakerStatus'].values()), m['lastUpdated'], len(m['bookmakerHealth']));print({k:v for k,v in m['bookmakerStatus'].items() if v!='available'})"
```
- Expected: available >= 9 (13+ expected with all fixes merged); lastUpdated non-null and at most 120 min old; 14; every bookmaker whose L6 row is not success|partial is 'error', not 'stale'

#### observability-16 - L10 A5b /api/odds/batch
- When: After L6
- Command (from the main checkout root):
```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"leagues":["premier-league"]}' http://localhost:3001/api/odds/batch | python3 -I -c "import json,sys,collections;m=json.load(sys.stdin)['meta'];s=m['bookmakerStatus'];print(collections.Counter(s.values()), all(isinstance(v,str) for v in s.values()), m['lastUpdated'], len(m['bookmakerHealth']))"
```
- Expected: available >= 9, True, a non-null lastUpdated, 14

#### observability-17 - L11 A6 /api/bookmakers
- When: After L6
- Command (from the main checkout root):
```bash
curl -s http://localhost:3001/api/bookmakers | python3 -I -c "import json,sys;print(json.load(sys.stdin)['meta'])"
```
- Expected: availableCount >= 9, errorCount = 14 - availableCount

#### observability-18 - L12 A7 live CLI
- When: After L6
- Command (from the main checkout root):
```bash
npx tsx scripts/scraper-status.ts --league premier-league | wc -l; echo "exit ${PIPESTATUS[0]}"; npx tsx scripts/scraper-status.ts --league premier-league --json | python3 -I -m json.tool > /dev/null; echo "${PIPESTATUS[1]}"
```
- Expected: 15 lines, 'source=scraper_runs' on stderr, exit 1 if any bookmaker has consecutiveFailures >= 3, otherwise 0; the JSON pipe prints 0

#### observability-19 - L13 /api/admin/runs grouping
- When: After L6
- Command (from the main checkout root):
```bash
curl -s -H 'Authorization: Bearer dev-api-key' http://localhost:3001/api/admin/runs | python3 -I -m json.tool | head -40
```
- Expected: HTTP 200; the newest run's id equals $RUN with 14 results; partial counts in successCount

#### totalbet-36 - L4 A6 log after the restart's initial scrape (Step 3d)
- When: Once totalbet has finished in the first post-merge run
- Command (from the main checkout root):
```bash
LOG=<same as L3>; tail -n +$(( $(cat /tmp/totalbet-deploy-l0.txt) + 1 )) "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Totalbet/FullOffer\] (Found|[a-z0-9-]+ failed:)|totalbet (completed|success|partial|empty|scrape_failed|persist_failed|failed):|totalbet (scraper|save) threw:|Totalbet/Navigation|Detail fetch failed|phase-1 keys missing"
```
- Expected: '[Totalbet/FullOffer] Found N prematch events for premier-league', then '[Aggregator/FullOffer] totalbet success: M matches, F markets found, S saved' with no ' - error' suffix, M >= ceil(0.9*N) and S > 0. FAIL on: partial, empty, scrape_failed or persist_failed; 'premier-league failed:'; Totalbet/Navigation; 'Detail fetch failed'; 'phase-1 keys missing'; or no completion line.

#### totalbet-37 - L5 A6 freshness (Step 4a)
- When: Within 10 minutes of T0, after L4
- Command (from the main checkout root):
```bash
Step 4a FRESHNESS one-liner from docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/acceptance-2026-11-07.txt (curl /api/odds?league=premier-league | python3 -I ... totalbet /tmp/totalbet-deploy-t0.txt; echo "exit=$?")
```
- Expected: FRESHNESS bookmaker=totalbet ... ok=True, exit=0.

#### totalbet-38 - L6 A4 1X2 vs peers (Step 4b)
- When: After L4
- Command (from the main checkout root):
```bash
Step 4b one-liner from docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/acceptance-2026-11-07.txt (NL=$(curl dealer events | count) && curl /api/odds | python3 -I ... totalbet "$NL"; echo "exit=$?")
```
- Expected: 1X2-CHECK ... ok=True, exit=0 (proxy: maxDevPct 5.6).

#### totalbet-41 - L9 health endpoint (new; observability is merged)
- When: After at least one scheduled run following L4
- Command (from the main checkout root):
```bash
curl -s "http://localhost:3001/api/health/scrapers?league=premier-league" | python3 -I -c 'import json,sys; b=[x for x in json.load(sys.stdin)["data"]["bookmakers"] if x["bookmaker"]=="totalbet"][0]; print("HEALTH", b["status"], b["consecutiveFailures"], b["lastError"]); sys.exit(0 if b["status"]=="available" and b["consecutiveFailures"]==0 else 1)'; echo "exit=$?"
```
- Expected: HEALTH available 0 None, exit=0.

## pzbuk

#### totalbet-40 - L8 A5 peer deviation on 3 upcoming PL pairs (Step 4c)
- When: After L4, for pairs that have not kicked off yet
- Command (from the main checkout root):
```bash
Step 4c loop from docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/acceptance-2026-11-07.txt (P1=<code list>; for pair in ...; do curl normalized-markets > /tmp/nm.json; python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/peer-deviation.py /tmp/nm.json totalbet --codes $P1 --threshold 15; done). Pairs in headroom order: Coventry%20City/Crystal%20Palace, AFC%20Bournemouth/Nottingham%20Forest, Brentford/Everton (then Chelsea/Leeds%20United, Aston%20Villa/Sunderland). Never Tottenham%20Hotspur/Ipswich%20Town. If over>0, run the OVER-CLASS classifier from the same file.
```
- Expected: Per pair: PEER-CHECK unknown=0 over=0, exit=0. If the classifier exits 0, record a margin-only FAIL for the owner. If it exits 1, or unknown>0, investigate the mapping before keeping totalbet enabled.

#### totalbet-39 - L7 optional re-run of A1/A3/A7/A8 on the merged code (read-only, no DB)
- When: After the merge, any time
- Command (from the main checkout root):
```bash
From the main checkout, the plan's 'Acceptance smoke' and 'Normalizing variant' tsx commands (docs/superpowers/plans/2026-11-06-scraper-recovery/totalbet.md lines 317-327)
```
- Expected: SMOKE {success:true, listed:N, matches>=ceil(0.9N), durationMs<60000}, exit=0, and every MATCH line has mapped>=70 and unknown=0.

#### pzbuk-44 - L3 service run with DB write (A9)
- When: After merge, with the :3001 dev server running merged master; not at HH:00
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && curl -s -X POST http://localhost:3001/api/admin/scrape -H "Authorization: Bearer ${ADMIN_API_KEY:-dev-api-key}" -H 'Content-Type: application/json' -d '{"league":"premier-league","bookmakers":["pzbuk"]}' ; (about 8 min later) sed 's/\x1b\[[0-9;]*m//g' <server log> | grep -E "\[Aggregator/FullOffer\] pzbuk|marketKey collision.*pzbuk|\[PZBuk/FullOffer\].*(groups|never answered|listing is empty|No markets)|\[pzbuk\] Dropping" ; npx tsx scripts/scraper-status.ts --league premier-league ; curl -s "http://localhost:3001/api/odds?league=premier-league" | python3 -I -c "import json,sys;m=json.load(sys.stdin)['data']['matches'];print(sum('pzbuk' in x['markets'].get('MATCH_WINNER',{}).get('bookmakerOdds',{}) for x in m),'/',len(m))"
```
- Expected: POST returns HTTP 202 with status 'started' and bookmakers ['pzbuk']. Log shows '[Aggregator/FullOffer] pzbuk success: >=18 matches, N markets found, K saved' with K > 0, 0 'marketKey collision … pzbuk' lines, and no '[pzbuk] Dropping' lines (each inspected if present). scraper-status shows pzbuk fresh with no lastError. MATCH_WINNER coverage >= 18 / fixtures in window. Note: the old 'pzbuk completed' grep is stale after the observability merge.

#### pzbuk-42 - L1 pzbuk live smoke (A1-A8, A11, A12, header skip)
- Merged ids: pzbuk-46
- When: After merging recovery/integration into master, with F1-F5 and rulings 6/10/11 landed; :3001 backend running for peers; not at HH:00; PL window with >= 18 fixtures (else compare with the peer fixture count, G5)
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 900 npx tsx scripts/pzbuk-smoke.ts --league premier-league --peers http://localhost:3001
```
- Expected: Exit 0; SMOKE pass:true with success:true, matches >= 18, minParsedMarkets >= 90, minNonOther >= 40, maxUnknownShareNonOther <= 0.02, collisions 0, gatedNonOther 0, peerMatched ~ matches, invalidFrames 0, durationMs <= 600000, droppedMarkets 0 (or each inspected), vocabularyMisses 0, invalidOdds 0, peers "loaded". Amendment (A6): the 1X2 rule is the implied-probability band of 0.025 ONLY (|1/p - 1/peer median| <= 0.025), with no peer [min, max] clause: x12Outliers 0 with compared ~ peerMatched (max1x2ProbabilityGap is reported). Logs: '(groups 10/10)' or '(groups 7/7)' per event, 'market groups never answered' on <= 2 events, 'skipped 1 already subscribed' on 10-group events. Merged pzbuk-46 (A11 chunk reassembly, same command): live-verified only when SMOKE shows chunkedFrames > 0 with invalidFrames 0; unlikely on PL (largest frame 490,868 B vs the 1 MiB chunk size), otherwise it stays 'unverified live'.

#### pzbuk-43 - L2 legacy scrapeLeague/scrapeMatchDetails path (A10)
- When: After merge (and after the F4 change); read-only; not at HH:00
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && bash scripts/test-scrapers.sh test pzbuk premier-league
```
- Expected: Read by hand: Listing >= 18 (calendar-limited), all three 1X2 prices > 1, a BTTS line, an 'O/U 2.5' line (not the fallback O/U list), a DC line.

#### pzbuk-45 - L4 peer semantics of newly published pzbuk codes (CARDS_RACE, HALF_TIME_CARDS_TOTAL, SECOND_HALF_RESULT_AND_BTTS, GOALSCORER_FIRST/LAST, half DC/DNB, HALF_TIME_CORRECT_SCORE, HALF_TIME_HOME/AWAY_EXACT_CARDS)
- When: After L3; read-only
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && curl -s "http://localhost:3001/api/odds?league=premier-league" | python3 -I -c "<per-code pzbuk vs peer-median script, full text in pzbuk-final-review.md section 7 L4>"
```
- Expected: Each pzbuk selection is within about 2.5 pp implied probability of the peer median. CARDS_RACE HOME/AWAY are not swapped (plan OQ3). The HOME/AWAY exact-cards rows track the peers' same side.

#### betclic-58 - D5 MATCH_WINNER prices sane (criterion 5)
- When: After the first post-merge scheduled run
- Command (from the main checkout root):
```bash
curl -s 'http://localhost:3001/api/odds?league=premier-league' | python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/odds-deviation.py
```
- Expected: betclic MATCH_WINNER: matches=<Found N> n=<3 x matches> mean=~2% max<=10.0%. The pre-fix reference is matches=19 n=57 mean=2.2% max=6.2%.

#### betfan-115 - L3 price sanity vs peer median
- When: After the merge and the first scheduled scrape
- Command (from the main checkout root):
```bash
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betfan/tools/odds-sanity.py
```
- Expected: matches 20, 1x2_max <= 10, ou25_max <= 10 (baseline 3.6 / 3.4). A ValueError on max() means betfan has no rows: FAIL.

#### betfan-116 - L4 volume
- When: First scheduled run after the merge
- Command (from the main checkout root):
```bash
grep -E '\[Betfan/FullOffer\] .* vs .*: [0-9]+ markets' <backend log of that run>
```
- Expected: 20/20 premier-league fixtures, >= 720 markets per match in the near round and >= 75 in later rounds.

#### superbet-74 - L2 log window anchored on the scheduler and proven to contain a superbet run
- When: After the :3001 backend restarts on merged master and one scheduled run completes
- Command (from the main checkout root):
```bash
START=$(grep -nE '\[Scheduler\] (Starting scheduled scrape|Running initial scrape)' "$LOG" | tail -1 | cut -d: -f1); W(){ tail -n +"$START" "$LOG"; }; W | grep -E '\[Superbet/FullOffer\] Completed: [0-9]+ matches'; W | grep -cE '\[Scheduler\] (All leagues completed|Initial scrape completed)'
```
- Expected: The Superbet Completed line prints with N >= the number of PL fixtures the other bookmakers list (20 today), and the completion count is >= 1. Without these, every L3 '0' is vacuous.

#### superbet-75 - L3a/b/c log greps: TOTAL_GOALS collisions, 2325xx and exact-goals unmapped lines
- When: On the L2 window
- Command (from the main checkout root):
```bash
W | grep -c 'marketKey collision.*for superbet TOTAL_GOALS'; W | grep -cE '^\[superbet\] Unmapped market .*\(id: (232507|232508|232513|232514|232515|232516)\)$'; W | grep -cE '^\[superbet\] Unmapped market .*\(id: (540|541|545|568|569)\)$'
```
- Expected: 0, 0, 0 (2, 111 and 100 before the merge)

#### superbet-77 - L4 externalId no longer the string 'undefined'
- When: After the L2 run
- Command (from the main checkout root):
```bash
curl -s --compressed 'http://localhost:3001/api/odds?league=premier-league' | python3 -I -c "import json,sys;m=json.load(sys.stdin)['data']['matches'];e=[s.get('externalId') for x in m for s in x['markets']['MATCH_WINNER']['bookmakerOdds'].get('superbet',{}).get('selections',[])];print(len(e), sum(v=='undefined' for v in e))"
```
- Expected: '60 0' (the first number is 3 x the superbet fixtures, the second must be 0). Master on 2026-11-13 prints '60 60'.

#### superbet-73 - L1 single-bookmaker smoke (read-only, no DB): exact-goals family mapped
- When: Any time after merging recovery/integration into master, when a superbet PL fixture more than 2 h away exists. No backend restart needed.
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api; derive SB_URL/SB_HOME/SB_AWAY from /api/odds as in plan superbet.md Acceptance 4; ../aityper-scraper-api-worktrees/bin/heavy --live timeout 300 npx tsx scripts/superbet-market-discovery.ts --url "$SB_URL" --home "$SB_HOME" --away "$SB_AWAY" --league premier-league --market "liczba goli" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' > $SMOKE; then grep the exact-goals rows and the unmapped 'dokładna liczba goli' rows (full block in superbet-final-review.md L1)
```
- Expected: exit=124 with SUMMARY printed; Total markets >= 100, Mapped >= 75, TOTAL_GOALS rows >= 6; exact-goals rows = 5 and unmapped 'dokładna liczba goli' = 0 (0 and 5 before the merge). UNKNOWN_SELECTIONS flags on exact-goals rows are a known tool false positive.

#### superbet-80 - L7 Bournemouth team-special misroute into TOTAL_GOALS gone
- When: After the L2 run, while a Bournemouth PL fixture is listed
- Command (from the main checkout root):
```bash
for P in 'home=AFC%20Bournemouth&away=Nottingham%20Forest' 'home=Fulham&away=AFC%20Bournemouth'; do curl -s --compressed "http://localhost:3001/api/odds/match/full-offer?$P&league=premier-league" | python3 -I -c "import json,re,sys;mk=json.load(sys.stdin)['data']['markets'];bad=[(k,v['bookmakerOdds']['superbet']['rawMarketName']) for k,v in mk.items() if re.match(r'TOTAL_GOALS(:|$)',k) and 'superbet' in v['bookmakerOdds'] and v['bookmakerOdds']['superbet']['rawMarketName']!='Liczba goli'];print(len(bad), bad)"; done
```
- Expected: '0 []' for both. Master on 2026-11-13 prints 2 misrouted entries per fixture (TOTAL_GOALS 'Bournemouth będzie prowadzić…' and TOTAL_GOALS:2 'Bournemouth strzeli co najmniej 2 gole z rzędu').

## lvbet

#### lvbet-88 - D6 / L5 collision lines
- When: Cleaned log of the first scheduled run on the merged code
- Command (from the main checkout root):
```bash
for k in 'TOTAL_GOALS' 'HALF_TIME_TOTAL_GOALS:1.0' 'HALF_TIME_TOTAL_GOALS:2.0' 'EXACT_GOALS'; do grep -c "for lvbet $k " $LOG; done; grep -c 'marketKey collision.*for lvbet ' $LOG
```
- Expected: 0, 0, 0, 0 (2026-11-06 baselines 20/20/7/0). Total lvbet collision lines about 101.

#### lvbet-90 - D8 / L6 1X2 regression
- When: After any scheduled run on the merged code
- Command (from the main checkout root):
```bash
curl -s 'http://localhost:3001/api/odds?league=premier-league' -o $NM/odds.json && python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/tools/mw_sanity.py $NM/odds.json
```
- Expected: LVBet worst 1X2 deviation <= 15%, and no 'lvbet | MISSING' rows.

#### fuksiarz-96 - L1 (B4) Task 4 mappings smoke
- When: Any time after the merge (read-only live, no restart needed), on an event whose page shows 'Odda co najmniej 1 celny strzał głową'
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy && mkdir -p .scratch && $H --live timeout 150 npx tsx scripts/fuksiarz-market-discovery.ts --url "https://fuksiarz.pl/szczegoly/<eventId>" --league premier-league > .scratch/fk-smoke.raw 2>&1; sed 's/\x1b\[[0-9;]*m//g' .scratch/fk-smoke.raw | sed -n '/SUMMARY/,/With issues/p'; sed 's/\x1b\[[0-9;]*m//g' .scratch/fk-smoke.raw | sed -n '/UNMAPPED MARKETS:/,$p' | grep -cE '^   (Odda co najmniej [12] .*głową|Każda drużyna powyżej)'
```
- Expected: Exit 124 is normal. Unmapped/OTHER lists only 'Zakłady specjalne #...' rows, and the grep prints 0 (before the merge it passed at 722/4).

#### fuksiarz-97 - L2 (Task 0) HALF_WITH_MORE_GOALS vs peers
- When: After F1 is merged, the :3001 restart and one scheduled Fuksiarz run; every upcoming PL match (21-23 Nov round), before kick-off
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy && PLAN=docs/superpowers/plans/2026-11-06-scraper-recovery && curl -s "http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league" > .scratch/nm-<h>-<a>.json && $H python3 -I $PLAN/evidence/fuksiarz/tools/hwmg_vs_peers.py .scratch/nm-<h>-<a>.json <h>-<a>   (script committed by F5)
```
- Expected: In >= 90% of matches (18/20 in a full window), fuksiarz DRAW is within +/-15% of the peer median and 2ND_HALF <= 1.15x the peer median. Fuksiarz is not the best 2ND_HALF price on every match. Any match without a fuksiarz HWMG row matches a 'HALF_WITH_MORE_GOALS dropped' warning in the backend log.

#### fuksiarz-101 - L6 (B1) volume
- When: Backend log of the scheduled run
- Command (from the main checkout root):
```bash
grep -E "\[Fuksiarz/FullOffer\] (Found .* events|Completed:)" <backend log>
```
- Expected: 'Found N events' and 'Completed: N matches' give the same N, and no match has fewer than 180 parsed markets. If >= 10 matches kick off within 72 h, the total is >= 7,500 markets.

#### fuksiarz-102 - L7 (B7) unchanged 1X2 / O-U sanity
- When: Same run
- Command (from the main checkout root):
```bash
curl -s 'http://localhost:3001/api/odds?league=premier-league' > .scratch/odds.json && $H python3 -I $PLAN/evidence/lvbet/tools/mw_sanity.py .scratch/odds.json | tail -1; $H python3 -I $PLAN/evidence/lvbet/tools/mw_sanity.py .scratch/odds.json | grep -c '| fuksiarz | HOME='; $H python3 -I $PLAN/evidence/lvbet/tools/mw_sanity.py .scratch/odds.json | grep -c 'fuksiarz | MISSING'; $H python3 -I $PLAN/evidence/lvbet/tools/ou_sanity.py .scratch/nm-<h>-<a>.json | grep fuksiarz
```
- Expected: fuksiarz <= 15.0; the HOME= count equals the fixture count; MISSING = 0. Lines 1.5/2.5/3.5 each have OVER and UNDER, with every deviation within +/-10%.

## forbet

#### forbet-103 - forbet acceptance script, criteria 1-6 (raw volume, collisions, EH+2 contamination, TurboPrzewaga on WIN_OR_WIN_BY_2, UNKNOWN selections, 1X2/O-U 2.5 peer deviation)
- When: After recovery/integration is merged into master, the backend is restarted on the merged code, and one premier-league scrape (scheduled or manual) has persisted
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && sed 's/\x1b\[[0-9;]*m//g' <path to live backend.log> > /tmp/backend.clean.log && python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/forbet/acceptance-check.py /tmp/backend.clean.log WIN_OR_WIN_BY_2
```
- Expected: Seven PASS lines and exit 0. The summary shows collisions 0, bad_eh2_rows 0, matches_with_forbet_turbo (WIN_OR_WIN_BY_2) >= N-1 and unknown_sel 0. The WIN_OR_WIN_BY_2 argument is mandatory: without it the script checks MATCH_RESULT_OR_WIN_BY_2 and fails.

#### forbet-104 - forbet card check on the new codes
- When: Same time as the acceptance script
- Command (from the main checkout root):
```bash
curl -s "http://localhost:3001/api/odds/match/full-offer?home=<home>&away=<away>&league=premier-league"
```
- Expected: forbet appears on WIN_OR_WIN_BY_2 with only HOME/AWAY, within about 10% of betclic/fortuna. On RESULT_OR_BTTS it has exactly HOME_/AWAY_/DRAW_OR_BTTS_YES and no *_OR_BTTS_NO. It appears on TEAM_WIN_OR_CLEAN_SHEET param HOME and AWAY (YES/NO) and on DRAW_OR_CLEAN_SHEET (YES/NO), within about 10% of etoto/superbet. No forbet 'TurboPrzewaga' row is on EUROPEAN_HANDICAP.

#### forbet-105 - Optional single-bookmaker live smoke (no DB writes)
- When: Any time after the merge
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && /home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy --live timeout 240 npx tsx scripts/forbet-market-discovery.ts --url "https://www.iforbet.pl/wydarzenie/<event id>" --league premier-league --market "TurboPrzewaga"  (repeat with --market "obie drużyny strzelą gola")
```
- Expected: 'NORMALIZED: WIN_OR_WIN_BY_2' with only HOME and AWAY. With the second filter, the three alternative-bet blocks show RESULT_OR_BTTS, each with a single <SIDE>_OR_BTTS_YES. Exit 124 from timeout is expected.

## etoto

#### betby-25 - Endpoint discovery probe (optional)
- When: Any time after the merge
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 60 npx tsx -e '(async () => { const { resolveEndpoints } = await import("./src/scrapers/shared/betby/discovery.ts"); const { BETBY_BRANDS } = await import("./src/scrapers/shared/betby/brands.ts"); const { createFetchText } = await import("./src/scrapers/shared/betby/http.ts"); for (const bm of ["betters","lebull"]) console.log(bm, JSON.stringify(await resolveEndpoints(BETBY_BRANDS[bm], createFetchText()))); })()'
```
- Expected: Both lines show "source":"discovered" with endpoints equal to the pins in brands.ts, and no [Betby/...] warning. An 'endpoint drift' line means a pin or the lebull deep-link host needs updating.

## Phase 2 - After 3 or more completed runs

Needs at least 3 completed scheduled runs after the restart (hourly, so about 3 hours), plus the L0 and S baselines from section 0.4. Re-clean the logs first.

#### cross-cutting-4 - Start-burst contention after pzbuk, totalbet and Betby land (README step 4d, betcris A2 re-run)
- When: 3 consecutive scheduled runs after the merge
- Command (from the main checkout root):
```bash
grep -E '\[Aggregator/FullOffer\] betcris |Previous scrape still running' <log>
```
- Expected: betcris is success or partial in all 3 runs. 0 'Previous scrape still running' lines.

#### betcris-94 - C2 (A2): capture robustness under real 14-bookmaker contention
- When: After the merge, over 3 consecutive full runs (startup, scheduled, or the owner-approved admin scrape without a bookmakers filter: curl -s -X POST -H "Authorization: Bearer dev-api-key" -H "Content-Type: application/json" -d '{"league":"premier-league"}' http://localhost:3001/api/admin/scrape). These runs write the DB.
- Command (from the main checkout root):
```bash
sed 's/\x1b\[[0-9;]*m//g' <server log> | grep -E '\[Aggregator/FullOffer\] betcris ([a-z_]+:|scraper threw|save threw)|\[Betcris\] (No WebSocket|capture ok)|\[ScrapeHelpers\] betcris:|\[Betcris/FullOffer\] (Found [0-9]+ games|Skipped game|Aborting per-match loop)|\[Betcris/Navigation\] (Capture attempt|[a-z-]+ deadline fired)'; then sed 's/\x1b\[[0-9;]*m//g' <server log> | grep -oE '\[Betcris/FullOffer\] (Skipped game|Aborting per-match loop)|\[Betcris/Navigation\] (Capture attempt|[a-z-]+ deadline fired)' | sort | uniq -c
```
- Expected: Per run: exactly one '[Betcris] capture ok:' line (record firstUsefulFrameMs, attempts and loopLagMaxMs; flag firstUsefulFrameMs > 12000; reference 1742/1/23). '[Aggregator/FullOffer] betcris success: N matches' with N >= ceil(0.9*G), G from 'Found G games'. Exactly one '[ScrapeHelpers] betcris: ... unmapped market ids' line with no ladder id in top. No 'Aborting per-match loop' and no 'threw' line. Few or no classified 'Skipped game' lines. Record any 'deadline fired N ms late' lines. 3 consecutive runs pass.

#### betclic-55 - D2 stability under load (criterion 3, RC1: no truncated or lost market groups)
- When: Record L0=$(wc -l < <backend.log>) as soon as the merged code is live. Then, after each of the first 3 scheduled runs (once lastScrapeCompleted on /api/health is past that run's start), in the same hour, run D1 into /tmp/betclic-smoke-<HH>.txt
- Command (from the main checkout root):
```bash
E=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic; sed 's/\x1b\[[0-9;]*m//g' <backend.log> > /tmp/backend.clean.log && python3 -I $E/check-log-vs-smoke.py /tmp/backend.clean.log /tmp/betclic-smoke-<HH>.txt && grep -n 'Found [0-9]* events in listing' /tmp/backend.clean.log | awk -F: -v l0=$L0 '$1>l0'
```
- Expected: The run line with log line > L0 for that hour reads 'matches=<that run's Found N> outOfTolerance=0 failedGroups=0 ... -> PASS'. The retry counters are informational, but deadline1ms, trailer, compressed and emptyFrame should stay at 0. After the third run there are exactly 3 run lines past L0; a missing line means a failed listing. Pre-merge runs stay FAIL; ignore them.

#### sts-51 - Acceptance C: run check over at least 3 post-merge STS runs (apply F1 first)
- When: After >=3 completed STS runs past S; re-clean $LOG first
- Command (from the main checkout root):
```bash
/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py "$LOG" "$S"; tail -n +$((S+1)) "$LOG" | grep -cE '^\[Aggregator/FullOffer\] sts (partial|empty|scrape_failed|persist_failed):|^\[Aggregator/FullOffer\] sts (scraper|save) threw'; tail -n +$((S+1)) "$LOG" | grep -c 'do not fold into'
```
- Expected: RUN_CHECK {... "pass": true ...}, exit 0; both grep counts are 0. fullOfferDrops counts from the 2nd run after S onward. A foldDrop sample showing '(no price)' is a suspended player, not a regression.

#### observability-20 - L14 03:00 cleanup
- When: The morning after the merge (server log)
- Command (from the main checkout root):
```bash
grep -E 'Cleanup complete|scraper_runs older than 30 days deleted' <server log>
```
- Expected: '[Scheduler] Cleanup complete, deleted: N' and '[Scheduler] scraper_runs older than 30 days deleted: M'

#### observability-22 - L16 streak/resolved alerts
- When: Only if a bookmaker fails 3 runs in a row after the merge
- Command (from the main checkout root):
```bash
grep -E '^\[ALERT(-RESOLVED)?\] ' <clean log>
```
- Expected: Amendment (L16): exactly one `[ALERT] <bm> (premier-league) failed <n> consecutive runs since <iso>: <error>` per streak; <n> is 3, or more when the threshold run was collapse-suppressed. Its first OK run prints `[ALERT-RESOLVED] <bm> (premier-league) ok again after <n> failed runs`. A server restart (including every tsx watch reload) forgets the in-memory streak, so an ongoing streak alerts once more after a restart; that is expected, not a duplicate-alert bug.

#### observability-23 - L17 startup DB wait (optional, disruptive)
- When: Only if the owner accepts stopping Supabase
- Command (from the main checkout root):
```bash
Stop Supabase, restart the server, start Supabase within 120 s, read the server log
```
- Expected: One '[Database] Not reachable yet ...' warn per waiter, '[Server] market_types sync failed - the next scrape run retries it', then '[marketTypesSync] Synced market_types: N entries' before '[ScraperService] Starting full offer scrape for premier-league'; no 'market_types sync failed - continuing' and no FK 23503. If the DB never comes up: one ABORTED alert, '[Scheduler] Initial TSDB sync skipped: database unreachable - ...', and no [Aggregator/FullOffer] line.

## betby

## Phase 3 - On a PL match day, or 1-3 days before a round (next PL round: 21-23 Nov 2026)

Player-prop, ladder and OPTA markets appear on the listings only close to kick-off (roughly 72 h for stat lines, match day for team ladders, about 1 day before for STS r=17). Best window: 1-3 days before the round for the volume and floor checks (observability-13, observability-11), and match day before kick-off for the OPTA, ladder and player checks. Betby depth checks need PL matches within 7 days (from about 15-16 Nov). Run the checks for a match that has not kicked off, and not at HH:00.

#### observability-11 - L5 A2 forbet dry smoke
- When: After the merge, ideally 1-3 days before a PL round
- Command (from the main checkout root):
```bash
npx tsx scripts/smoke-bookmaker.ts --bookmaker forbet --league premier-league; echo "exit $?"
```
- Expected: exit 0; SMOKE_RESULT has status 'scraped', matches >= 18, minMarketsPerMatch >= 100, unknownSelectionShare <= 0.06. Optional cross-check: betters/lebull/totalbet/pzbuk dry smokes exit 0; on exit 1 the error is that plan's own text, not a recorder 404.
- Note: Amendment (L5): smoke-bookmaker.ts now exits 2 for an unknown league. Negative check: the same command with `--league not-a-league` must print the unknown-league error and `exit 2` (not 0, not 1).

#### observability-13 - L7 A10 savers floor
- When: Only when the nearest PL round is 1-3 days away (next: 21-23 Nov 2026), same run as observability-12
- Command (from the main checkout root):
```bash
Same run and same curl as observability-12 (scraper_runs?run_id=eq.$RUN&select=bookmaker,status,markets_saved), then compare markets_saved per bookmaker with the floors below. When a saver misses its floor, run in the same hour: npx tsx scripts/smoke-bookmaker.ts --bookmaker <bm> --league premier-league
```
- Expected: Floors (unchanged): fortuna>=9673, superbet>=10015, lvbet>=7071, fuksiarz>=4667, betfan>=4200, forbet>=4402, etoto>=4915, sts>=3848, betclic>=2363. Amendment (timing rule + relative fallback): on a miss, compare that saver's markets_saved with the same-hour smoke's marketsNormalized. markets_saved near marketsNormalized (with marketsNormalized itself below the floor) = offer-side shortfall, NOT a regression. markets_saved well below the same-hour marketsNormalized = regression.

#### cross-cutting-5 - Player-tier integrity across bookmakers (catches X1-class mis-tiering)
- When: First PL match day after the merge (OPTA player props are match-day only)
- Command (from the main checkout root):
```bash
For each match in /api/odds?league=premier-league, GET /api/matches/<home>/<away>/normalized-markets?league=premier-league. For PLAYER_FOULS, PLAYER_FOULS_WON, PLAYER_SHOTS, PLAYER_SHOTS_ON_TARGET and PLAYER_TACKLES, compare each bookmaker's N+ price per player parameter with the median of the other bookmakers' (N+1)+ prices.
```
- Expected: No N+ price at or above that median. Before the etoto fix, etoto rows violated this (for example Hakimi 1+@2.95 against the peers' 2+ median of 1.95); the etoto PLAYER_FOULS / PLAYER_FOULS_WON tier fix is now in the branch, so any hit is a regression. Any hit blocks the new peers' prices from being trusted (fake +EV 1.3x-2.5x that the 10x detector does not catch).

#### betby-26 - Live Betby smoke per brand (A1-A5, A8)
- Merged ids: betby-32
- When: When premier-league matches fall within 7 days (from about 2026-11-15 or 16, for the 21-23 Nov round), with :3001 serving the other bookmakers
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 180 npx tsx scripts/betby-smoke.ts --bookmaker betters --league premier-league --max-days 7 --compare-api http://localhost:3001 ; timeout 180 npx tsx scripts/betby-smoke.ts --bookmaker lebull --league premier-league --max-days 7 --compare-api http://localhost:3001
```
- Expected: Each run prints RESULT=PASS and exits 0, with matches=snapshot, gated>0, minNormalizedGated>=50 (baseline 63-73), listingOnlyGated<=1, unknownInMapped=0, max1x2Dev<10.0% and durationMs<15000. No 'specifier keys' skip lines appear (until F1 lands, piping the output to grep -c 'specifier keys' must print 0).
- Note: Merged betby-32 (same command and expectation, steady-state re-run): run it once now and once more after the first scheduled hourly run that follows go-live; both brands must give RESULT=PASS and exit 0 each time.

#### betby-27 - Discovery script on a current event
- When: After the live smoke
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 180 npx tsx scripts/betters-market-discovery.ts --url "<eventUrl of a gated betters match from the smoke>" --league premier-league | sed 's/\x1b\[[0-9;]*m//g' | grep -E "MATCH:|Mapped:"  (then the same with scripts/lebull-market-discovery.ts and a lebull eventUrl)
```
- Expected: 'MATCH: <home> vs <away> (premier-league)' and 'Mapped: >= 50', and the process exits on its own.

#### betby-28 - Deep links render in a browser
- When: After the live smoke
- Command (from the main checkout root):
```bash
Copy docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betters/eventurl-check.mjs to a scratch dir, replace its two URLs with one gated eventUrl per brand and the Leeds/Tottenham checks with that match's team names, then run: timeout 150 node <scratch>/eventurl-check.mjs <scratch>
```
- Expected: For each brand: status 200, finalUrl equal to the requested URL, both team flags true, notFound false. The screenshots show that match's event header.

#### betby-29 - A6 persistence
- When: After the merge and a restart of npm run dev in the main checkout
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3001/api/admin/scrape -H "Authorization: Bearer ${ADMIN_API_KEY:-dev-api-key}" -H "Content-Type: application/json" -d '{"league":"premier-league","bookmakers":["betters","lebull"]}' ; curl -s "http://localhost:3001/api/health/scrapers?league=premier-league"
```
- Expected: The scrape call returns {"success":true,..."status":"started"...} with HTTP 202. The dev log shows '[Aggregator/FullOffer] betters success: <n> matches, <M> markets found, <N> saved' with n equal to the smoke's snapshot count and N>=500, and the same line for lebull. The health endpoint shows both bookmakers OK.

#### betby-30 - A6 follow-up: Betby 1X2 present in /api/odds
- When: Right after the A6 scrape completes
- Command (from the main checkout root):
```bash
curl -s "http://localhost:3001/api/odds?league=premier-league" | python3 -I -c "import json,sys; d=json.load(sys.stdin)['data']['matches']; print(sum('betters' in m['markets'].get('MATCH_WINNER',{}).get('bookmakerOdds',{}) for m in d), sum('lebull' in m['markets'].get('MATCH_WINNER',{}).get('bookmakerOdds',{}) for m in d))"
```
- Expected: Both counts are at least the smoke's snapshot count minus 1.

#### betby-31 - A7 odds outliers
- When: After A6
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsx scripts/odds-outliers.ts --league premier-league --all-matches --quiet --out /tmp/outliers.json; echo "exit=$?"; python3 -I -c "import json;r=json.load(open('/tmp/outliers.json'));print(sum(1 for m in r['matches'] for f in m['findings'] if f['bookmaker'] in ('betters','lebull') and f['severity'] in ('MAJOR','BROKEN')))"
```
- Expected: exit=0, and the last line prints 0.

#### sts-50 - Acceptance B: live smoke (no DB writes)
- When: No scheduled scrape in flight, and a PL round within ~2 days of kickoff (next: Nov 21-23, so run ~Nov 19-21; r=17 appears ~1 day before kickoff)
- Command (from the main checkout root):
```bash
/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy --live node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/smoke-full-offer.mts sts premier-league GOALSCORER_ANYTIME,PLAYER_SHOTS,PLAYER_SHOTS_ON_TARGET,PLAYER_ASSISTS,PLAYER_CARDS,PLAYER_GOAL_OR_ASSIST,FIRST_PLAYER_CARDED,PLAYER_RED_CARD,CARDS_TEAM,CORNERS_TEAM,EACH_TEAM_TOTAL_CORNERS_OVER,EACH_TEAM_TOTAL_CARDS_OVER > ~/smoke-sts.log 2>&1; echo exit=$?; grep -E 'Found [0-9]+ fixtures|^SMOKE_RESULT' ~/smoke-sts.log
```
- Expected: exit 0; 'Found N' with 1<=N<=20 and N-matches<=1; each raw>=400 match has normalized>=480 and other<=3; otherMarketShare<=0.01; requiredCodeMatchCounts>=F for the 8 main-group codes; teamStatsCodeMatchCounts==F17 for the 4 team-stats codes; foldDropWarnings==0. F or F17 == 0 means not checkable: re-run inside the window. Exit 1 with no Found line means a C1/T17 renumbering.

#### sts-52 - Acceptance D: API odds sanity on an r=17 full-offer match
- When: After a post-merge scheduled run that covers a Nov 21-23 match with raw>=400 whose fixture lists r=17 (perMatch[].teamStats true in the smoke)
- Command (from the main checkout root):
```bash
/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/api-sanity.py "<Home>" "<Away>" sts
```
- Expected: SANITY_RESULT pass true, exit 0: cards_total_ok (4-5 lines), corners_team_shape_ok and cards_team_shape_ok true. Live shape: CARDS_TOTAL 5, CORNERS_TOTAL 5, HT cards 3-4, HT corners 3. Without an r=17 match, judge only the non-team _ok flags.

#### sts-53 - F8: STS PLAYER_SHOTS ladder against the peer median
- When: Same match and timing as Acceptance D
- Command (from the main checkout root):
```bash
python3 -I -c 'import json,sys,statistics as st,urllib.parse as u,urllib.request as r;q=u.quote;h,a=sys.argv[1:3];d=json.load(r.urlopen(f"http://localhost:3001/api/matches/{q(h)}/{q(a)}/normalized-markets?league=premier-league",timeout=60))["data"];rows=[(p["value"],s["type"],b["bookmaker"],s["odds"]) for c in d["categories"] for m in c["markets"] if m["type"]=="PLAYER_SHOTS" for p in m["parameters"] for b in p["bookmakers"] for s in b["selections"]];g={};[g.setdefault((v,t),{}).__setitem__(bk,o) for v,t,bk,o in rows];rat={};[rat.setdefault(t,[]).append(x["sts"]/st.median([o for k,o in x.items() if k!="sts"])) for (v,t),x in g.items() if "sts" in x and len(x)>=4];print({t:(len(l),round(st.median(l),2)) for t,l in sorted(rat.items())})' "<Home>" "<Away>"
```
- Expected: Median STS/peer ratio within ~1.25 at 2+ and 3+. At >=1.4 against 3+ peers, treat STS 2003/2394 as a different bet: route it to OTHER until the owner decides.

## betclic

#### betclic-54 - D1 unloaded smoke (criteria 1-2: RC2 penalty ANY, RC3 OPTA mapping, RC4 side-keyed tackles)
- When: Once after recovery/integration is merged into master and :3001 has reloaded, between scheduled runs, on a day Betclic lists Premier League matches with OPTA markets
- Command (from the main checkout root):
```bash
E=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic; node_modules/.bin/tsx $E/smoke-full-offer.mts betclic premier-league OFFSIDES_TOTAL,OFFSIDES_1X2,HOME_TEAM_TOTAL_OFFSIDES,FOULS_TOTAL,HOME_TEAM_TOTAL_FOULS,FIRST_OFFSIDE,PENALTY_GOAL,HALF_TIME_PENALTY_GOAL,SECOND_HALF_PENALTY_GOAL,TEAM_TOTAL_TACKLES | grep '^SMOKE_RESULT' > /tmp/betclic-smoke-$(date -u +%H).txt && python3 -I -c "import json,sys;d=json.loads(open(sys.argv[1]).read()[13:]);ok={'Wynik meczu - Xtra Wygrana','Obaj gracze strzelą w 2. połowa','Pierwsza drużyna, która popełni faul'};print(d['success'],d['matches'],d['warnings'],d['otherMarketShare'],d['unknownSelectionShare'],d['requiredCodeMatchCounts'],d['offVocabSelections'],d['sidelessTeamTackleKeys'],sorted({n for p in d['perMatch'] for n in p['otherNames']}-ok))" /tmp/betclic-smoke-$(date -u +%H).txt
```
- Expected: Output reads 'True <listing count> 0 <=0.010 0'. The OPTA code counts equal the number of matches that carry OPTA markets (above 0 if any match does; HOME_TEAM_TOTAL_FOULS may be one lower). The penalty code counts equal the number of full-offer matches. offVocabSelections is 0 for every code, sidelessTeamTackleKeys is 0, and the final set is [] apart from ambiguous derby team lines. Pre-merge reference: matches=19, OPTA 4 each, penalty 9, otherMarketShare 0.0094.

#### betclic-56 - D3 API shape (criterion 4)
- When: After the first post-merge betclic save, for a Premier League match that has not kicked off and whose D1 perMatch shows the OPTA codes (Arsenal v Hull City has been played; substitute its canonical names)
- Command (from the main checkout root):
```bash
curl -s 'http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league' | python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/api-check.py PENALTY_GOAL,HALF_TIME_PENALTY_GOAL,SECOND_HALF_PENALTY_GOAL,TEAM_TOTAL_TACKLES,OFFSIDES_TOTAL,OFFSIDES_1X2,FOULS_TOTAL,HOME_TEAM_TOTAL_FOULS,AWAY_TEAM_TOTAL_FOULS,HOME_TEAM_TOTAL_OFFSIDES,AWAY_TEAM_TOTAL_OFFSIDES,FIRST_OFFSIDE
```
- Expected: PENALTY_GOAL '' ['TEAM_HOME','TEAM_AWAY','ANY','NONE']. Both half-time penalty codes give '' ['TEAM_HOME','TEAM_AWAY','ANY']. Every TEAM_TOTAL_TACKLES param starts with HOME: or AWAY: with ['OVER','UNDER'], and no bare numeric param remains. The totals and team totals give ['OVER','UNDER']. OFFSIDES_1X2 '' ['HOME','DRAW','AWAY'] and FIRST_OFFSIDE '' ['HOME','AWAY'].

#### betclic-57 - D4 tackles collisions gone and stale rows pruned (criterion 4, second half)
- When: Right after D3, on the cleaned log from D2
- Command (from the main checkout root):
```bash
tail -n +$((L0+1)) /tmp/backend.clean.log | grep -c 'marketKey collision.*betclic TEAM_TOTAL_TACKLES'; tail -n +$((L0+1)) /tmp/backend.clean.log | grep -c 'Pruned .* stale row(s) for betclic/'; tail -n +$((L0+1)) /tmp/backend.clean.log | grep -c 'Stale-row prune error for betclic/'
```
- Expected: 0, then >=1, then 0. If D3 still shows a bare numeric betclic tackles param and there is no Pruned line, grep the run for 'Batch insert error' and recheck after the next clean save. If there is a Pruned line and the bare param remains, that is a defect.

#### fortuna-60 - D0 setup (prerequisite for D1-D12)
- When: Before D1
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api; H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy; E=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna; CODES=HALF_TIME_RESULT,HALF_TIME_CORNERS_RACE,SECOND_HALF_CORNERS_RACE,PENALTY_AWARDED,RED_CARD_AND_PENALTY,OWN_GOAL,HEADER_GOAL,ASSISTS_TOTAL,HALF_TIME_BTTS,HOME_WIN_TO_NIL,AWAY_WIN_TO_NIL,WINNING_MARGIN,HOME_WIN_BOTH_HALVES,HOME_SCORE_BOTH_HALVES,AWAY_SCORE_BOTH_HALVES,HOME_WIN_AT_LEAST_ONE_HALF,AWAY_WIN_AT_LEAST_ONE_HALF,HOME_EXACT_GOALS,AWAY_EXACT_GOALS,RED_CARD_TEAM,HALF_TIME_RED_CARD_TEAM,HALF_TIME_RED_CARD,SECOND_HALF_EXACT_GOALS,FIRST_CORNER,ODD_EVEN_GOALS; IDS=00-9a,00-bv,00-k7,00-k6,00-2n,00-1h,00-1i,00-1o,00-1p,00-2b,00-2c,00-1r,00-1s,00-16,00-17,00-0c,00-0d,00-0a,00-3e,00-0f,00-19,00-09; mkdir -p .scratch; D=.scratch/fortuna-fullround-$(date -u +%Y%m%dT%H%MZ).json; test ! -e "$D"
```
- Expected: The variables are set and $D does not exist yet

#### fortuna-61 - D1 fresh full-offer PL smoke (criterion 2)
- When: First PL round with full offer (~1200 raw markets per match; after the international break)
- Command (from the main checkout root):
```bash
$H --live node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna premier-league $CODES --dump "$D" --count-ids $IDS --warn-pattern 'without extractable player'
```
- Expected: success true and warnPatternCount 0. With M=matches and F=perMatch entries with raw>500: HALF_TIME_RESULT, HALF_TIME_BTTS, HOME/AWAY_WIN_TO_NIL, WINNING_MARGIN, HOME_WIN_BOTH_HALVES, HOME/AWAY_SCORE_BOTH_HALVES and HOME/AWAY_WIN_AT_LEAST_ONE_HALF == M each; HALF_TIME_CORNERS_RACE, PENALTY_AWARDED, OWN_GOAL, HEADER_GOAL, ASSISTS_TOTAL, HOME/AWAY_EXACT_GOALS, HALF_TIME_RED_CARD_TEAM, HALF_TIME_RED_CARD, SECOND_HALF_EXACT_GOALS and ODD_EVEN_GOALS >= F-1 each; FIRST_CORNER >= F-2; RED_CARD_AND_PENALTY, RED_CARD_TEAM and SECOND_HALF_CORNERS_RACE == 0; otherMarketShare <= 0.305 (advisory). F=0 means NOT RUN. Do not use smoke-code-check.py until F5 is fixed.

#### fortuna-62 - D2 WIN_OR_WIN_BY_2 offline replay of the D1 dump
- When: Right after D1
- Command (from the main checkout root):
```bash
$H node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna premier-league WIN_OR_WIN_BY_2 --from "$D" --warn-pattern 'WIN_OR_WIN_BY_2: could not resolve'
```
- Expected: warnPatternCount 0 and requiredCodeMatchCounts.WIN_OR_WIN_BY_2 == matches (read the numbers; the exit code is always 0)

#### fortuna-63 - D3 Task 5 exact-goals digit labels on live data
- When: Right after D1
- Command (from the main checkout root):
```bash
$H python3 -I -c "import json,sys; c=json.load(open(sys.argv[1])); L=[s['name'] for m in c['matches'] for mk in m['markets'] if mk['bookmakerMarketId'] in ('ufo:mtyp:00-16','ufo:mtyp:00-17','ufo:mtyp:00-3e') for s in mk['selections']]; S=sorted(set(L)); print('EXACT_GOALS_LABELS', len(L), S, 'NOT RUN' if not L else ('PASS' if set(S) <= {'0','1','2','2+','3+'} else 'FAIL'))" "$D"
```
- Expected: EXACT_GOALS_LABELS <n> [...] PASS with n>0. FAIL (a Remis or team label) is a parser regression.

#### fortuna-64 - D4 player keys on the live dump (offline part of criteria 3-4)
- When: Right after D1
- Command (from the main checkout root):
```bash
$H node_modules/.bin/tsx $E/replay-player-keys.mts "$D" premier-league --mononym <name from the mononyms: lines of a full-offer match>
```
- Expected: RESULT full>=1, bare 0, leak 0, labelLeak 0, sharedTeamToken 0, collisions 0, warnNoPlayer 0, PLAYER_SHOTS and GOALSCORER_FIRST rows for the mononym, verdict CHECKED (NOT RUN or PARTIAL recorded as such)

#### fortuna-65 - D5 record the evidence
- When: After D1-D4
- Command (from the main checkout root):
```bash
Append the D1 and D2 SMOKE_RESULT lines and the D3 line to $E/smoke-after-fix-fortuna.txt, each under a '# <command> <UTC> exit=<code>' line, below the existing lines
```
- Expected: The file keeps its 2026-11-13 lines and gains the full-round lines

#### fortuna-67 - D7 API checks (criterion 3)
- When: After the merge into master, the :3001 backend restarted on master, and one scheduled PL scrape during a full-offer round
- Command (from the main checkout root):
```bash
python3 -I $E/api-checks.py --mononym <name from 'fortuna mononyms'> > $E/api-checks-after-fix.txt; grep '^SUMMARY' $E/api-checks-after-fix.txt
```
- Expected: verdict CHECKED, full>=1, htBad 0, htcMissing 0, leak 0, labelLeak 0, sharedTeamToken 0, base 0, baseCodes == [CORRECT_SCORE, HALFTIME_FULLTIME, HALF_TIME_CORRECT_SCORE, SECOND_HALF_CORRECT_SCORE], newLegsUnder5.over10Pct 0, oneXTwo.maxDevPct <= 10; every ht: line raw '1.połowa' ok=True. full 0 means NOT RUN.

#### fortuna-68 - D8 pooling and the mononym (criterion 4)
- When: Same run as D7
- Command (from the main checkout root):
```bash
Read $E/api-checks-after-fix.txt (SUMMARY.mononym and the mononym: line)
```
- Expected: SUMMARY.mononym.fortunaOnRow true; the mononym: line shows 'fortuna': ['PLAYER'] on GOALSCORER_FIRST

#### fortuna-69 - D9 FIRST_CORNER, exact goals and baseCodes by hand
- When: Same run, per listed full-offer match
- Command (from the main checkout root):
```bash
curl -s 'http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league' | python3 -I -c "import json,sys; d=json.load(sys.stdin)['data']; mk=[m for c in d['categories'] for m in c['markets']]; f=lambda t: [[(s['type'],s['odds']) for s in b['selections']] for m in mk if m['type']==t for p in m['parameters'] for b in p['bookmakers'] if b['bookmaker']=='fortuna']; print('FC',f('FIRST_CORNER')); print('HEG',f('HOME_EXACT_GOALS')); print('AEG',f('AWAY_EXACT_GOALS')); print('SHEG',f('SECOND_HALF_EXACT_GOALS')); print('base',sorted({m['type'] for m in mk for p in m['parameters'] if p['value']=='base' for b in p['bookmakers'] if b['bookmaker']=='fortuna'}))"
```
- Expected: FC: exactly one HOME and one AWAY leg, none at 100; HEG/AEG selections within 0/1/2/3+ and SHEG within 0/1/2+, one entry each; base == the four codes of D7

#### fortuna-70 - D10 WIN_OR_WIN_BY_2 card (check 5)
- When: Same run, per listed fixture (forbet is merged in the same integration)
- Command (from the main checkout root):
```bash
curl -s 'http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league' | python3 -I -c "import json,sys; d=json.load(sys.stdin)['data']; mk=[m for c in d['categories'] for m in c['markets']]; bms=lambda t: [b for m in mk if m['type']==t for p in m['parameters'] for b in p['bookmakers']]; w=bms('WIN_OR_WIN_BY_2'); fw=[{s['type']:s['odds'] for s in b['selections']} for b in w if b['bookmaker']=='fortuna']; f1=[b for b in bms('MATCH_WINNER') if b['bookmaker']=='fortuna']; mw={s['type']:s['odds'] for b in f1 for s in b['selections']}; raw=[b.get('rawMarketName') for b in f1]; n=len([m for m in mk if m['type']=='WIN_OR_WIN_BY_2']); print(n, [(b['bookmaker'],[(s['type'],s['odds']) for s in b['selections']]) for b in w], raw, mw, 'ok=%s' % (n==1 and len(fw)==1 and sorted(fw[0])==['AWAY','HOME'] and all(o<=mw.get(k,0) for k,o in fw[0].items()) and len(raw)==1 and bool(raw[0]) and not ' '.join(raw[0].split()).lower().startswith('wynik meczu lub')))"
```
- Expected: 1 card, fortuna HOME/AWAY next to forbet (and betclic where listed), ok=True

#### fortuna-71 - D11 scheduled-run log greps (criterion 5, PL only)
- When: Same run; L = the ANSI-stripped backend log from the '[Scheduler] Starting scheduled scrape' line on (sed 's/\x1b\[[0-9;]*m//g' <raw log> > /tmp/fortuna-run.log)
- Command (from the main checkout root):
```bash
L=/tmp/fortuna-run.log; grep -c 'marketKey collision with overlapping selection code .* for fortuna ' $L; grep -c '\[fortuna\] Player market without extractable player' $L; grep -c '\[fortuna\] WIN_OR_WIN_BY_2: could not resolve' $L; grep -o '\[fortuna\] Unknown market: .*(id: ufo:mtyp:[0-9a-z-]*)' $L | grep -o 'ufo:mtyp:[0-9a-z-]*' | sort | uniq -c | sort -rn | head -40
```
- Expected: 0, 0, 0; none of the 22 IDS appears in the unknown-id histogram (00-bt, 00-07, 00-08 and 00-bu still do, on purpose)

#### fortuna-72 - D12 held-back ids, owner input (not a gate)
- When: Same run, per full-offer match
- Command (from the main checkout root):
```bash
python3 -I -c "import json,sys; c=json.load(open(sys.argv[1])); [print(m['homeTeam'],m['awayTeam'],mk['bookmakerMarketId'],[(s['name'],s['odds']) for s in mk['selections']]) for m in c['matches'] for mk in m['markets'] if mk['bookmakerMarketId'] in ('ufo:mtyp:00-bt','ufo:mtyp:00-07','ufo:mtyp:00-08')]" "$D"  # compare with the peers' RED_CARD_AND_PENALTY and RED_CARD_TEAM HOME/AWAY YES from the D9 endpoint
```
- Expected: A per-match % deviation table for the owner's decision on the '(bez CK dla trenera i sztabu)' settlement

## superbet

#### superbet-76 - L3d/e/f log greps: player stat lines
- When: On an L2 window of a run where PL fixtures kick off within 72 h (stat-line markets are absent on far-dated fixtures; verified 2026-11-13)
- Command (from the main checkout root):
```bash
W | grep -cE '^\[superbet\] Unmapped market .*\(id: (236216|236220|236222|238449|238453|238457|238461|238469|238473|238477|238485|239621)\)$'; W | grep -c 'marketKey collision.*superbet PLAYER_'; W | grep -c '^\[superbet\] Unmapped market'
```
- Expected: 0; 0; about 1,500 or less (14,486 in pre-fix run 3 on a near-term week)

#### superbet-78 - L5 exact-goals coverage and peer sanity
- When: After the L2 run, when at least one PL fixture kicks off within 72 h
- Command (from the main checkout root):
```bash
T=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/superbet/tools; D=$(mktemp -d); ../aityper-scraper-api-worktrees/bin/heavy python3 -I $T/fetch_near_term.py "$D" && ls "$D"/*.json | wc -l && ../aityper-scraper-api-worktrees/bin/heavy python3 -I $T/exact_goals_check.py "$D"/*.json
```
- Expected: File count >= 1 (0 files would pass vacuously, see SB-F2); RESULT PASS with exit 0. Non-failing soft single-peer top-band notes are allowed. Any DEVIATION or ABSENT line is a failure.

#### superbet-79 - L6 per-player stat lines (Task 5)
- When: After the L2 run, on a near-term week, using the same $D as L5
- Command (from the main checkout root):
```bash
../aityper-scraper-api-worktrees/bin/heavy python3 -I $T/player_stat_lines_check.py "$D"/*.json
```
- Expected: Every line OK with players= about 36-41 (floor 25); RESULT PASS, exit 0. A suspect selection is a real failure: investigate it, do not waive it.

#### lvbet-83 - D1 single-bookmaker smoke (read-only)
- When: Once after the merge, on a PL match with published ladders
- Command (from the main checkout root):
```bash
SMOKE=$(mktemp -d); timeout 300 npx tsx scripts/lvbet-market-discovery.ts --url "<lvbet eventUrl from /api/odds?league=premier-league>" --league premier-league > $SMOKE/run.log 2>&1; echo exit=$?; sed 's/\x1b\[[0-9;]*m//g' $SMOKE/run.log | sed -n '/SUMMARY/,$p' > $SMOKE/summary.txt; grep -cE '^Strzały +→ PLAYER_SHOTS ' $SMOKE/summary.txt; grep -cE '→ TWO_PLAYERS_GOAL_OR_ASSIST ' $SMOKE/summary.txt; grep -cE '→ PLAYER_GOAL_OR_ASSIST ' $SMOKE/summary.txt; grep -E '^(Rezultat lub|Obaj gracze|Dokładna liczba goli )' $SMOKE/summary.txt
```
- Expected: exit=124 is fine. The Strzały count equals the distinct players in that match's ladder (38 on the 11-06 capture, 37 on the 11-07 archive). Pair count 1 and single count 1 (0 and 2 is a FAIL). Rezultat lub -> RESULT_OR_TOTAL, Obaj gracze -> TWO_PLAYERS_COMBINED_GOALS, Dokładna liczba goli -> EXACT_GOALS. The HT 3-way and the 7 unmapped Strzały siblings appear only under UNMAPPED.

#### lvbet-84 - D2 / L1 market floor and unsplit ladders
- When: After the first scheduled run on the merged code that logged '[FullOfferRepo] Pruned N stale row(s) for lvbet/<matchId>' with no Batch insert error, in a matchweek with ladders
- Command (from the main checkout root):
```bash
grep -E '^\[LVBet/FullOffer\]' $LOG ; python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/tools/lvbet_unsplit_ladders.py $NM/fo-*.json  (fo-*.json fetched with the full-offer loop in lvbet.md L1; LOG = ANSI-stripped backend log)
```
- Expected: Amendment (ruling 9, L1 gate): every match with published ladders has per-player ladder rows present (lvbet_unsplit_ladders.py reports split>0) AND its `[LVBet/FullOffer] <H> vs <A>: N markets` line shows N >= 850; and unsplit=0 (PASS) on every match. `Completed: N matches` where N = fixtures not yet kicked off. split=0 unsplit=0 means no ladders yet: record 'pending: no ladders'. STALE / exit 2 means wait for the next pruned run. Optional new signal: `grep -c '\[lvbet\] .*EXACT_GOALS.*: dropping' $LOG` counts dropped partial exact-goals folds (costs one selection of coverage, never a wrong price).

#### lvbet-85 - D3 / L2 market_comparison stats
- When: Same pruned run as D2, on 2 ladder matches
- Command (from the main checkout root):
```bash
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/tools/db_stats.py $NM/mc-*.json ; python3 -I -c 'import json,sys; print(sum(1 for f in sys.argv[1:] for r in json.load(open(f)) for s in r["selections"] if s.get("externalId") == "undefined"))' $NM/mc-*.json  (mc dumps via the PostgREST curl in lvbet.md L2)
```
- Expected: A single scrapedAt bucket, UNK% <= 40, and a literal 'undefined' externalId count of 0. extIdMissing is for information only.

#### lvbet-86 - D4 / L3 ladder codes and tier prices
- When: Same pruned run, matchweek with ladders
- Command (from the main checkout root):
```bash
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/tools/lvbet_ac.py --ladders $NM/nm-<A>.json $NM/nm-<B>.json
```
- Expected: PASS: all 15 REQUIRED codes present, EXACT_GOALS >= 7 selections, and >= 80% of PLAYER_SHOTS/FOULS/SAVES tiers within ±30% of the peer median. Exit 0.

#### lvbet-87 - D5 / L4 totals, HT line 1, no goal-or-assist pairs
- When: After any pruned scheduled run on the merged code
- Command (from the main checkout root):
```bash
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/tools/lvbet_ac.py $NM/nm-*.json
```
- Expected: PASS for every match and exit 0: TOTAL_GOALS 2.5/3.5 OVER/UNDER only within ±10% of the peer median, HALF_TIME_TOTAL_GOALS 1 present, no ' or ' in PLAYER_GOAL_OR_ASSIST.

#### lvbet-89 - D7 Task 3 checker (RESULT_OR_TOTAL, HT line 2, pair codes equal to betclic)
- When: Same pruned run; pairs need a week where betclic also quotes them
- Command (from the main checkout root):
```bash
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/tools/lvbet_t3_ac.py --ht2-ref /tmp/lvbet-pre.log $NM/nm-*.json
```
- Expected: A PASS line per match, SUMMARY fail=0 with pairs_checked>=1, exit 0. Exit 2 means pending (no match with both bookmakers' pairs). Without D0b the ht2 check prints 'unchecked'.

#### betcris-93 - C1 (A1 re-run, optional): read-only live full-offer smoke with LADDER diagnostics (no DB)
- When: Any time after the merge. Best on a PL match day before kick-off. Not during a scheduled run.
- Command (from the main checkout root):
```bash
From /home/skamik/Documents/repositories/personal/aityper-scraper-api, run the bash block under 'Task 4 Step 5: Live check' in docs/superpowers/plans/2026-11-06-scraper-recovery/betcris.md with two changes: its first cd points at /home/skamik/Documents/repositories/personal/aityper-scraper-api, and smoke-task4-started/smoke-task4-full/smoke-task4 are renamed to smoke-started/smoke-full/smoke. Then: R=$(grep -cE '\[Betcris/FullOffer\] .*: ([5-9][0-9]{2}|[0-9]{4,}) markets' .scratch/smoke.txt); grep -oE '"ladderTypes":[0-9]+' .scratch/smoke.txt | awk -F: '{s += $2} END {print s + 0}'; plus the 26-id Unknown-market grep over .scratch/smoke-full.txt from report section 5.
```
- Expected: SMOKE success:true, matches >= ceil(0.9*G), minMarketsPerMatch >= 300, otherShare <= 0.21, durationMs <= 240000. One LADDER line per match. residual/dupRungs/zeroTier/normCollisions are 0 in every game. Sum of ladderTypes >= 10*R. Ladder-id Unknown-market count is 0.

#### betcris-95 - C3 (A3+A4): ladder coverage, 1X2 health, phantom players, and the side-aware ladder peer check (ruling #12) after a persisted run
- When: After C2, on a PL match day before kick-off, on a game with mc >= 500 (team ladders appear only on match day).
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api; H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy; T=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools; GID=0 $H --live node $T/direct-swarm.mjs wss://eu-swarm-springre.trexname.com/ .scratch/bcl plus the listing one-liner; GID=<id> $H --live node $T/direct-swarm.mjs wss://eu-swarm-springre.trexname.com/ .scratch/bc; curl -s "http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league" > .scratch/nm.json; $H python3 -I $T/ladder_coverage.py .scratch/bc-game.json .scratch/nm.json; $H python3 -I $T/health.py .scratch/nm.json .scratch/rows.json; $H python3 -I $T/phantom_strict.py .scratch/rows.json .scratch/bc-game.json; $H python3 -I $T/ladder_peer_check.py .scratch/nm.json
```
- Expected: LADDER_COVERAGE fails=0 (exit 0). Every 1X2 dev within +-15%. No 'PLAYER ABSENT in same raw market' key. LADDER_PEER_CHECK PASS (PASS [] on a game without team ladders), exit 0. SWAP_SUSPECT [], or each listed label cleared by the same side's other family (shots vs shots on target; fouls vs offsides or throw-ins). The swap test only sees a swap where the peers' home and away prices differ by more than 5 points.
- Note: Amendment (ruling 12, A4): the old inline LADDER_PEER_CHECK heredoc is replaced by the committed tool ladder_peer_check.py. It covers the 5 side-less totals AND the 10 side-scoped team ladders (HOME_/AWAY_TEAM_TOTAL_FOULS, _OFFSIDES, _THROW_INS, TEAM_TOTAL_SHOTS and _ON_TARGET with HOME:/AWAY:), each compared with the same side of the peers and with the peers' opposite side. Exit 1 on FAIL. Known risk: on the offline merge of game 31333513 betcris fouls/offsides ladders ran 15-20% below the peers on one side (never above, so no false +EV). If the live run fails on that pattern, the owner decides whether betcris 'Faule' counts the same statistic or the +-15% limit needs a one-way margin allowance; do not waive silently.

#### fuksiarz-98 - L3 (B2) abbreviated labels
- When: Same run, a match with player props
- Command (from the main checkout root):
```bash
$H python3 -I $PLAN/evidence/lvbet/tools/abbreviated_labels.py .scratch/nm-<h>-<a>.json
```
- Expected: "withPeers": 0

#### fuksiarz-99 - L4 (B3 + G3) stranded rows and hyphen split
- When: Same run, same file
- Command (from the main checkout root):
```bash
$H python3 -I $PLAN/evidence/fuksiarz/tools/stranded_rows.py .scratch/nm-<h>-<a>.json && $H python3 -I $PLAN/evidence/fuksiarz/tools/hyphen_split.py .scratch/nm-<h>-<a>.json   (hyphen_split.py committed by F5)
```
- Expected: Every stranded sample residual is a nickname pair (Tim/Timothy, Andy/Andrew) or is blocked by Fortuna's '... wyrzucony z boiska' param, and "hyphenSplit": 0.

#### fuksiarz-100 - L5 (B5) header shots on target vs peers
- When: Same run, a match whose fuksiarz offer has -4895
- Command (from the main checkout root):
```bash
$H python3 -I $PLAN/evidence/fuksiarz/tools/header_shots_vs_peers.py .scratch/nm-<h>-<a>.json
```
- Expected: sharedWithPeer >= 80% of fuksiarzPlayers (baseline 15/15), medianAbsDevPct <= 35, maxRatio < 5.

#### pzbuk-47 - L6 ordinal gate (A12)
- When: While a PL match is in play after its first goal or booking (e.g. Saturday 15:30-16:45 UTC)
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 900 npx tsx scripts/pzbuk-smoke.ts --league premier-league --peers http://localhost:3001
```
- Expected: SMOKE ordinalMarkets > 0 with gatedNonOther 0 (same command as pzbuk-42; A6 band-only rule applies to x12Outliers).

#### etoto-107 - L1 pre-check: team OPTA ids and -30591 are on offer for a real fixture
- When: On a Premier League matchday, from about 4 h before kick-off, per real fixture. Skip 'Dzień meczowy' specials such as 6262615.
- Command (from the main checkout root):
```bash
curl -s --compressed https://api.etoto.pl/rest/market/categories/multi/206/events | python3 -I -c "import json,sys;[print(e['eventId'],e.get('eventStart'),e['eventName']) for e in json.load(sys.stdin)['data']]" ; curl -s --compressed https://api.etoto.pl/rest/market/events/<eventId> | python3 -I -c "import json,sys;g={x['gameType'] for x in json.load(sys.stdin)['data']['eventGames']};print(sorted(g&{162,163,168,169,-30727,-30728,-30591}))"
```
- Expected: A non-empty list. Shots checks need 168/169/-30727/-30728, fouls checks need 162/163, and penalty checks need -30591 still named 'Suma 0.5 rzutów karnych'. An empty list is not a pass. If it stays empty until kick-off, record 'not yet verifiable' and the capture tests decide.

#### etoto-108 - L2 single-bookmaker smoke: team shots and team fouls keys
- When: After G0, and once L1 is non-empty for <eventId>
- Command (from the main checkout root):
```bash
timeout 240 npx tsx scripts/etoto-market-discovery.ts --url "https://www.etoto.pl/zaklady-bukmacherskie/wydarzenie/<eventId>" --league premier-league --market "strzałów" > /tmp/etoto-smoke-shots.txt 2>&1; timeout 240 npx tsx scripts/etoto-market-discovery.ts --url "https://www.etoto.pl/zaklady-bukmacherskie/wydarzenie/<eventId>" --league premier-league --market "fauli" > /tmp/etoto-smoke-fouls.txt 2>&1
```
- Expected: Exit 124 is expected. grep 'Market Key: TEAM_TOTAL_SHOTS' shots.txt | grep -vE ':(HOME|AWAY):' prints nothing. Both TEAM_TOTAL_SHOTS and TEAM_TOTAL_SHOTS_ON_TARGET show at least one :HOME:<line> and one :AWAY:<line> key. TOTAL_SHOTS*/PLAYER_SHOTS* keys carry no HOME/AWAY. fouls.txt shows 'Market Key: HOME_TEAM_TOTAL_FOULS:<line>' and 'Market Key: AWAY_TEAM_TOTAL_FOULS:<line>'. grep -c 'Market Key: TEAM_TOTAL_FOULS:' prints 0, and FOULS_TOTAL has no side.

#### etoto-109 - L3 API acceptance via acceptance_check.py
- When: After G0, plus one etoto FullOffer success/partial run that scraped an event where L1 was non-empty
- Command (from the main checkout root):
```bash
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/etoto/acceptance_check.py
```
- Expected: etoto_sideless 0 with no SIDELESS lines; etoto_shared > 0; etoto_fouls_rows > 0 and etoto_fouls_shared > 0; penalty_awarded_etoto n >= 1 per pre-checked event with every dev <= 15; unknown_selections 0; 1x2 over10 0; ou25 max_pct <= 10; fixtures N orphans 0 with N = the isValidEvent valid count.

#### etoto-110 - L4 collision monitor
- When: Same run as L3
- Command (from the main checkout root):
```bash
grep 'marketKey collision' /tmp/etoto-clean.log | grep ' for etoto ' | grep -vc ' for etoto PENALTY_AWARDED '
```
- Expected: 0. It only proves the fix if some fixture in that run had both teams quoted on the same shots line.

#### etoto-111 - L5 raw volume, unmapped and skip counter
- When: Same run as L3
- Command (from the main checkout root):
```bash
Run the raw-volume one-liner at docs/superpowers/plans/2026-11-06-scraper-recovery/etoto.md:116-124 with L=/tmp/etoto-clean.log; for the valid count: curl -s --compressed https://api.etoto.pl/rest/market/categories/multi/206/events -o /tmp/etoto-206.json && npx tsx -e 'import { readFileSync } from "node:fs"; import { isValidEvent } from "./src/scrapers/bookmakers/etoto/parser.ts"; const ev = JSON.parse(readFileSync(process.argv[1], "utf8")).data; console.log("listing", ev.length, "valid", ev.filter(isValidEvent).length);' /tmp/etoto-206.json
```
- Expected: unmapped 0; skipped == skipped_expected (4 x fixtures); fixtures == the valid count at run time; unclaimed_pct <= 2; >= 450 raw markets for every fixture kicking off within 3 days.

## betfan

#### betfan-112 - L0 P1 precondition: betfan publishes OPTA team-stat games for the fixture
- When: Match day, before L1/L2
- Command (from the main checkout root):
```bash
curl -s --compressed https://betfan.pl/api/v1/market/categories/244/events | python3 -I -c "import json,sys,datetime as t;[print(e['eventId'],t.datetime.fromtimestamp(e['eventStart']/1000,t.timezone.utc).isoformat()[:16],e['eventName']) for e in sorted(json.load(sys.stdin)['data']['categories'][0]['events'],key=lambda e:e['eventStart'])[:3]]"; curl -s --compressed https://betfan.pl/api/v1/market/events/<eventId> | python3 -I -c "import json,sys;g=json.load(sys.stdin)['data']['event']['games'];print(sum(x['gameType'] in (168,169,-200054,-200055,162,163) for x in g))"
```
- Expected: The second command prints >= 1 for the chosen eventId. If it prints 0 for every listed fixture, L1/L2 are INCONCLUSIVE, not PASS.

#### betfan-113 - L1 single-bookmaker live smoke (read-only, no DB writes)
- When: Match day after L0 passes; before or after the merge
- Command (from the main checkout root):
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 240 npx tsx scripts/betfan-market-discovery.ts --url "https://betfan.pl/wydarzenie/<eventId>" --league premier-league --all > "${TMPDIR:-/tmp}/betfan-smoke.txt" 2>&1; echo "exit $?"; grep -E 'Market Key: (TEAM_TOTAL_SHOTS|TEAM_TOTAL_SHOTS_ON_TARGET|TEAM_TOTAL_FOULS|HOME_TEAM_TOTAL_FOULS|AWAY_TEAM_TOTAL_FOULS):' "${TMPDIR:-/tmp}/betfan-smoke.txt"; grep -E 'Market Key: TEAM_TOTAL_(SHOTS|SHOTS_ON_TARGET|FOULS):[0-9]' "${TMPDIR:-/tmp}/betfan-smoke.txt"; grep -E ' - liczba celnych.*→ TOTAL_SHOTS_ON_TARGET' "${TMPDIR:-/tmp}/betfan-smoke.txt"; grep -E '^(Total markets|❌ Unmapped/OTHER):' "${TMPDIR:-/tmp}/betfan-smoke.txt"; sed -n '/^❌ UNMAPPED MARKETS:/,$p' "${TMPDIR:-/tmp}/betfan-smoke.txt" | grep -c 'liczba fauli'
```
- Expected: exit 124 (exit 1 = no match found). Grep 1 shows only TEAM_TOTAL_SHOTS[_ON_TARGET]:HOME:/AWAY:<line> and HOME_/AWAY_TEAM_TOTAL_FOULS:<line>. Greps 2 and 3 print nothing. OTHER/Total <= 0.01. The last command prints 0.

#### betfan-114 - L2 team-stat sides in the live API
- When: After merging recovery/integration into master, the backend restart and a completed scheduled match-day scrape; only if L0 printed >= 1
- Command (from the main checkout root):
```bash
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betfan/tools/team-stat-check.py
```
- Expected: betfan_sideless 0, betfan_shared >= 1, betfan_team_total_fouls 0, and betfan_home_fouls_matches and betfan_away_fouls_matches each >= the number of fixtures with raw ids 162/163. Pre-fix baseline: sideless 7, shared 0, team_total_fouls 1.

#### betfan-117 - L5 monitor collisions and OTHER
- When: Same match day as L2
- Command (from the main checkout root):
```bash
grep -c 'marketKey collision.*betfan' <backend log>; check the OTHER count for betfan on the match nearest kick-off (L1 summary)
```
- Expected: 0 collision lines. Betfan OTHER on the nearest match is 4 (was 5): -200040 plus 3 combos. If F1/F2 land, any extra OTHER carries their warn line.

## Phase 4 - Dated checks, and checks waiting for full-offer Ekstraklasa or other leagues

Only premier-league is enabled (`ENABLED_LEAGUES`). Smoke scripts can still target other leagues directly with `--live`.

#### betclic-59 - D6 derby side guards live (T2-a/T3-a, the OFFSIDES_1X2 guard, and F1 once it lands)
- When: Dated: Newcastle United v Manchester United on 2026-12-02, or any Manchester derby in Betclic's PL listing with OPTA markets; between scheduled runs. F1 and F6.3 are already merged in the final-review wave.
- Command (from the main checkout root):
```bash
E=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic; node_modules/.bin/tsx $E/side-probe.mts > /tmp/side-probe.out; python3 -I $E/side-check.py /tmp/side-probe.out (plus D1 for the same hour)
```
- Expected: side-check prints bad=0, or only exp '?' lines for abbreviated legs, each confirmed by hand. That match's perMatch[].otherNames holds the ambiguous OPTA team lines. MATCH_WINNER, FOUL_RACE, PENALTY_GOAL and OFFSIDES_1X2 show distinct sides or appear as OTHER, never a repeated HOME or TEAM_HOME. No HOME_/AWAY_ code, HOME:/AWAY: param or FIRST_OFFSIDE leg is on the wrong side.

## fortuna

#### fortuna-66 - D6 leagues outside PL (Step 2b)
- When: Waiting for a full-offer round in each league (only premier-league is enabled; Ekstraklasa, laliga, serie-a, ligue-1 are smoke-only). One league at a time.
- Command (from the main checkout root):
```bash
for L in ekstraklasa laliga serie-a ligue-1; do DL=.scratch/fortuna-$L-$(date -u +%Y%m%dT%H%MZ).json; $H --live node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna $L --dump "$DL" --warn-pattern 'without extractable player' | grep '^SMOKE_RESULT'; $H node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna $L WIN_OR_WIN_BY_2 --from "$DL" --warn-pattern 'WIN_OR_WIN_BY_2: could not resolve' | grep '^SMOKE_RESULT'; $H node_modules/.bin/tsx $E/replay-player-keys.mts "$DL" $L --mononym <league-local mononym>; done
```
- Expected: Per league: warnPatternCount 0, WIN_OR_WIN_BY_2 == matches, and the fortuna-64 RESULT values (player keys NOT RUN means no full offer yet; record it as such). Ekstraklasa: check that every saved pair uses the right club names (Wisła Kraków caveat).
- Note: Amendment: the Ekstraklasa tournament id is now `ufo:tour:00-05k` (probe 2026-11-13; the old `ufo:tour:00-0b9` returned HTTP 404). Ekstraklasa is therefore no longer blocked by 'fortuna-ekstraklasa.md replaces 00-0b9' and is added to the loop (the reviewers' loop listed laliga serie-a ligue-1 only). Dry smoke already passed on 2026-11-13 (matches 9 = peer 9, WIN_OR_WIN_BY_2 9/9); player keys and exact-goals labels stayed NOT RUN until a full offer is listed. Known open issue: the shared team matcher maps 'Wisła Kraków' to Cracovia (the roster lacks Wisła Kraków and Wieczysta Kraków), so Radomiak-Wisła is saved as Radomiak-Cracovia until the data owner extends src/data/canonical-teams.ts. Do not enable Ekstraklasa before that.

## Deduplicated checks (4)

| Merged away | Kept as | Why |
|---|---|---|
| cross-cutting-2 | observability-6 (apply) and observability-14 (after-run health curl) | Same apply command (`apply-migrations.sh 11_scraper_runs_observability.sql`), same expectation. |
| sts-48 | totalbet-34 (move) and section 0.4 (log baseline S) | Same purpose, the docs move-aside. sts-48's `mv docs/superpowers` is narrowed to the colliding directory. |
| pzbuk-46 | pzbuk-42 | Same command (`pzbuk-smoke.ts --league premier-league --peers ...`); A11 is one extra expectation on the same output (chunkedFrames). |
| betby-32 | betby-26 | Same command and expectation (betby-smoke.ts per brand, RESULT=PASS), run again after the first hourly run. |

## Dropped checks (0)

None. Nothing was plainly superseded. Two were kept conditional rather than dropped: cross-cutting-1 (only if you merge before applying migration 11) and observability-23 (optional, disruptive, needs Supabase stopped).

## Where each final-review amendment was applied

| Amendment | Applied in |
|---|---|
| observability L7/A10 timing rule + relative fallback | observability-13 |
| observability L16 alert trigger and restart behaviour | observability-22 |
| observability L6/L8 partial runs | observability-12, observability-14 |
| observability L2 5 s probe | observability-8 (note) |
| observability L5 exit 2 for an unknown league | observability-11 (note + negative check) |
| etoto G0 grep PENALTY_TOTAL_ZERO_FIVE_NAME | etoto-106 |
| lvbet L1 "per-player ladder rows present AND N markets >= 850" | lvbet-84 |
| pzbuk L1 smoke fields, A6 band 0.025 only | pzbuk-42 (also pzbuk-47) |
| betcris A4 extended to the 10 side-scoped team ladders | betcris-95 (ladder_peer_check.py) |
| fortuna Ekstraklasa id ufo:tour:00-05k | fortuna-66 |
| (not in the list) pzbuk fix report still shows the older "band OR peer [min, max]" rule | Branch HEAD (d7951cf, scripts/pzbuk-smoke.ts) already implements band only; the fix report text is stale. |
