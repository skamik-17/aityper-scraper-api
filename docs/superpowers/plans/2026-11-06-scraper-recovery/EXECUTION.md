# Execution notes (2026-11-07)

Read this before any plan in this directory. It records the owner's answers to README section 5 and the rules every implementer follows. Where this file and a plan disagree, this file wins.

## Owner decisions

Group A (blocking):
1. **Docs commit:** this directory is committed on `recovery/integration`, not on `master`. `master` stays untouched until the owner asks for a merge.
2. **Stop-gaps:** not applied. They would change `master`, which serves the owner's UI work. The integration branch migrates betters, lebull and totalbet instead. Skip betby Task 0 and totalbet Task 0.
3. **TurboPrzewaga:** option **(b)**. forbet `-31170` maps to the 2-way `WIN_OR_WIN_BY_2`, keeping only the two team legs (forbet.md open question 1 lists the exact test values). fortuna Task 6 runs with option (b) as well.
4. **D1 team fouls:** yes. Use `HOME_/AWAY_TEAM_TOTAL_FOULS` for etoto and betfan. fuksiarz's side-less `TEAM_TOTAL_FOULS` is a later follow-up and out of scope here.
5. **Betby integer handicap lines:** `ASIAN_HANDICAP`.
6. **Empty runs:** an `empty` run counts as a failure. One league-level alert fires when at least half the bookmakers are empty.
7. **Shared archive change:** approved. betby Task 1 implements it. lvbet Task 4 and the archive half of betcris Task 5 only verify it.

Group B (operations):
- B8: `ALERT_CONSECUTIVE_FAILURES=3`. The webhook is optional and off when `ALERT_WEBHOOK_URL` is unset.
- B9: `lastError` may appear on `/api/health/scrapers` (local-first).
- B10: accept that `lastUpdated` becomes non-null. The frontend relabel is deferred.
- B11: keep `scraper_runs` for 30 days.
- B12: stale quotes stay in place and are only made visible.
- B13: the prune guard is not implemented (deferred).
- B14: plan default.
- B15: the dead browser path is not touched.
- B16: keep the plan's retry budget.

Group C (scope):
- **sts:** skip r=12, do not map r=17, apply the strict filter to the Premier League only, leave the name flips.
- **fortuna:** do not map `00-bu`. The composite-markets plan comes later.
- **betclic:** "Punkty za kartki" drop is deferred because no task covers it.
- **lvbet:** keep today's merge, defer the AH collision, map outside-box shots per Task 2.
- **fuksiarz:** skip Task 3 (cosmetic). Task 4 includes -30640. The Fortuna red-card param is deferred.
- **superbet:** run Task 5, keep `PLAYER_ASSISTS` `3+`, put 200685 in the backlog.
- **forbet:** ship Task 2 together with Task 1.
- **betcris:** no Node Swarm client, keep today's pooling, keep the `betcris.pl` `BASE_URL`, run no coverage pass.
- **pzbuk, totalbet, betby:** follow each plan's own default. Where a plan has none, keep today's behaviour.

Group D (catalog): no new codes, tiers or `hasParameter` flips unless a task's own tests require one. Never run `scripts/sync-market-types.ts`.

Group E: leave unblessed golden entries unblessed. All frontend-repo follow-ups (betby Task 9, ledger and coverage edits) are deferred.

## Workspace layout

- `/home/skamik/Documents/repositories/personal/aityper-scraper-api` is the **main checkout** (`master`). It runs the live backend on :3001 for the owner's UI work. **Never edit, checkout, reset, stash or run anything that writes there.** Reading its files is fine.
- `/home/skamik/Documents/repositories/personal/aityper` is the **frontend repo**, where the owner is working on the UI. **Never write there.**
- `/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/<plan>` holds one worktree per plan on branch `recovery/<plan>`. Each was branched from `recovery/integration`, and `integration/` is the integration worktree. `node_modules` is a symlink to the main checkout's, so **never run `npm install`/`npm ci`**, and never add a dependency without stopping to report it.
- Each worktree's `.env` points Supabase at a dead port on purpose, so no worktree can write to the shared local DB that the UI reads. Do not change it. For read-only peer data, `GET http://localhost:3001/api/...` (the live backend) is allowed.

## Rules for every implementer

1. **Heavy commands go through the shared runner:** `/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy <cmd>`. This covers every `npx vitest`, `npx tsc`, `npx tsx`, `node *.mjs`, `python3` over large files and every Playwright run. It queues for a slot and waits for free RAM. Add `--live` (`heavy --live <cmd>`) for anything that opens a browser or calls a bookmaker site. The machine is short of RAM, and the owner's dev servers must not be OOM-killed.
2. **During TDD, run only the scoped tests** (`heavy npx vitest run src/path`). At the end of a task, run `heavy npx vitest run` and `heavy npx tsc --noEmit` once.
3. **Never start the server or the scheduler.** That means no `npm run dev`, no `src/index.ts`, no `dev:stack`, and no full aggregator run. Never run anything that writes to the DB: `clear-database*`, `nuke-database.sh`, `clean-ghost-matches.ts`, `sync-market-types.ts`, `sync-tsdb.ts`, `apply-migrations.sh`/`db:migrate`, `audit-ledger-*`, `build-coverage-baseline.ts`, `match-audit-prep.ts`. Migration files may be written and unit-tested but are not applied.
4. **Live acceptance that needs a scheduled or manual scrape to persist to the DB is DEFERRED.** Record the exact command and expected result in your report instead of running it. A read-only live probe that a code step needs (a discovery or smoke script that only fetches and prints or writes files inside the worktree) is allowed under `heavy --live`, one at a time.
5. **Absolute evidence paths in plans** point into the main checkout. Prefer the identical copy in your worktree (`docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/...`). Write scratch output under `<worktree>/.scratch/` (gitignored via `.git/info/exclude`), not under `/tmp`.
6. **Git:**
   - Commit after each task, with the plan's message.
   - Messages carry no signature or `Co-Authored-By` footer.
   - Commit only on your own branch. Never touch `master`, never push, never rebase another branch, never delete branches or worktrees.
7. **Code and comments are in English. UI copy is in Polish.**
8. **Odds integrity comes first.** A wrong price is worse than a missing market. If a step would publish a price you cannot justify, drop the market and report it.
9. **Deviations:** if the code no longer matches the plan (line numbers drift, a function was renamed), adapt and note it. If a plan step is wrong, fix it the way the plan's intent requires and report the deviation with evidence.
