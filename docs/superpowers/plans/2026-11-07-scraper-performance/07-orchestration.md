# Scraper Run Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:**
> - **Base moved.** Target = `recovery/integration` (≥ `aaf7c07`) + `recovery/observability` (Tasks 1–9 built, 16 commits) + `recovery/fortuna`; the plan starts after README §5.0 R0 (both merged into integration). The old "Composition with observability.md" table is replaced by **Anchors on the future base**, written against the built code, with the observability tests to rebase per task (`scheduler-service.test.ts:81-89`, `:126-148`, `:150-161`; `admin-runs.test.ts:9-11`; `scraper-service.test.ts` aggregator mock).
> - **New Task 0: the `partial` rule** in observability's `classifyBookmakerRun` (`run-outcome.ts:79-80` returns `success` and drops the cause). It needs only observability and lands first as README §5.0 F3 (cross-plan #13).
> - **Task 2:** runtime transport classification replaces the grep pin (cross-plan #8): browserless today = betclic, betters, lebull, totalbet → **10 browser jobs**. betcris stays on the browser (owner C) and gets a 600 s budget, sts (until 05a) 360 s, pzbuk keeps 600 s — sized from the A1 run time and betcris.md's retry worst case. The sts breaker (05a Task 0, F2) is a precondition. totalbet/betby ignore the budget until plan 02's adapters (orphaned fetches; stated).
> - **Task 1:** the aborted run id is the coordinator's id; abort records are per league; admin runs no longer overwrite `/api/health` `lastScrapeStats` or `/health/scrapers` `lastRun`. **Task 3:** units only where `isLeagueSupported`; reuses `runFullOfferForBookmaker`, the hoisted fakes of `aggregator-db-down.test.ts` and `run-fixtures.ts`. **Task 4:** `smoke-bookmaker --persist` refuses while a run is in progress. **Task 5:** the SIGTERM drain accounts for `waitForDatabase` (no signal today) and `emitAlerts` (≤ 5 s webhook); `STARTUP_DB_WAIT_MS`.
> - **Task 6** builds on observability's `runDailyCleanup()` (`scheduler-service.ts:98-113`, keeps the 30-day `scraper_runs` delete, owner B11) with one `[Retention]` format (cross-plan #25). **Task 7** reuses plan 02's `/proc` reader (cross-plan #30); the metrics migration is 17 (#29). Protected log lines updated; the "betby T0 / totalbet T0B" clause dropped (owner A2); the `executeFullOfferScrape(` count fixed to 10 (#34).
> - EXECUTION workspace rules adopted; Task 8's live checks are **deferred to the owner** (they need the running server and persisting runs).
> - Evidence: `evidence/delta-audit-infra-2026-11-13.md` (header, README items 3, 6, 7, 8, 10, 11, 14, 15, section "07-orchestration"), `evidence/cross-plan-review-2026-11-07.md` #8, #13, #25, #29, #30, #34.

**Goal:** Classify a run that saved data but reports a cause as `partial`; one scrape run at a time from any trigger; a hard deadline on every (bookmaker, league) scrape; bookmaker-major jobs under global caps; a cadence that matches `SCRAPE_INTERVAL_MINUTES`; restarts that neither re-scrape needlessly nor kill writes; retention after every run; one metrics line per job.

**Architecture:** `classifyBookmakerRun` gains the `partial` rule (Task 0). A `RunCoordinator` (in-process mutex, real run ids, abort, drain) is the only entry for startup, interval and admin runs. `runScrapeCycle` keeps observability's order (preflight → scrape → per-league persist → alerts), but scrapes all leagues in one `runFullOfferCycle`: one job per bookmaker walks the leagues it supports sequentially, browser jobs ≤ 3 (staggered 1.5 s, longest budget first), other jobs ≤ 12, and each unit gets a §3 `ScrapeBudget` raced against deadline + 5 s. The job's transport comes from the scraper instance (`DeclaresTransport`, else `PlaywrightScraper` = browser). An `IntervalScheduler` (last start + interval ± 10 %) replaces the `*/N` cron; a startup policy decides whether a boot scrapes; shutdown drains, persists partial outcomes and exits ≤ 10 s; retention runs after every run; each job prints one `[ScrapeMetrics]` JSON line.

**Tech Stack:** TypeScript ESM (NodeNext), Node 20.19.5 (`node:async_hooks`, `node:perf_hooks`, `node:crypto`; `AbortSignal.any` ≥ 20.3), Express 4, node-cron 3 (03:00/04:00 only), Playwright ^1.57, Vitest 4 (fake timers), tsx 4.21.

**Spec:** README §2 (RunCoordinator box, principles 2 and 5), §3 (`ScrapeBudget`, `createScrapeBudget`, `DEFAULT_MAX_DURATION_MS`, `mapLimit`, `FullOfferScraper`, `DeclaresTransport`, `TransportStats*` with cumulative counters, `HttpStats`), §5.0 (F3, P5), §5.1 (observability Task 1 `partial` row, owner: this plan), §7 rows "Restarts that start a full scrape" and "A hung request", §8 Q6, Q12. Evidence (`$E` = `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence`): `$E/findings-notes.md` CORE-4…CORE-10, `$E/core/target-architecture.ts` §2/§6/§7, `$E/core/cron-check.cjs`; recovery evidence (tracked in the worktree) `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/acceptance-2026-11-07.json`. Composes with the built observability code (`recovery/observability`), never replaces it.

## Global Constraints

- **Workspace (recovery `EXECUTION.md`, README §6 revision).** `H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees`. Your own worktree under `$H` (e.g. `$H/perf-07-orchestration`, branch `perf/07-orchestration`; Task 0 may use its own small branch `perf/07-partial-rule`) created from `recovery/integration` after R0; `node_modules` symlinked to the main checkout's, `.env` copied from `$H/integration/.env` (Supabase on the dead port; never change it). Never `npm install`/`npm ci` (everything here is `node:` built-ins), never edit or run anything that writes in the main checkout, **never start the server or the scheduler** (no `npm run dev`, no `src/index.ts`), never write to the DB or apply a migration. **`heavy`** below means `$H/bin/heavy`: every `npx vitest` / `npx tsc` / `npx tsx` runs through it. During TDD run only the scoped tests; `heavy npx vitest run` and `heavy npx tsc --noEmit` once at the end of each task. Scratch output goes to `<worktree>/.scratch/`. Record the baseline first (future base: 125 files / 2 243 tests).
- README §6 applies otherwise (golden test unchanged, no attribution footers, one commit per task with the message given). `tsc` does not check `scripts/`: type-check `scripts/smoke-bookmaker.ts` with observability's standalone command `heavy npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule scripts/smoke-bookmaker.ts`.
- **Preconditions.**
  - Task 0: R0 only (observability merged). It needs nothing from plan 02 and may land alone (README §5.0 F3).
  - Tasks 1–8: R0 and plan 02 merged (§3 names, `getTransportOverride`, `TransportStats*`, plan 02 Task 9's `src/utils/proc-sampler.ts`).
  - Task 2 additionally: **05a Task 0 (sts browser-path circuit breaker, README §5.0 F2) merged**. Without it a systemic sts miss walks 19 fixtures × 2 attempts (≈ 10 min, `sts/index.ts:310-326`) into the hard deadline every run.
- **Budgets per (bookmaker, league) unit:** `DEFAULT_MAX_DURATION_MS` (http/websocket 120 000, browser 240 000); browser overrides **pzbuk 600 000, betcris 600 000, sts 360 000** (Task 2 sizes them). Hard-deadline grace 5 000 ms.
- Caps: browser jobs 3, browser starts ≥ 1 500 ms apart and longest budget first, non-browser jobs 12.
- `SCRAPE_INTERVAL_MINUTES`: integer 1–1440 (default 30); jitter ±10 %; minimum gap after an overrun `min(60 000, interval / 2)` ms.
- `STARTUP_SCRAPE`: `auto` | `always` | `never` (default `auto`, README §8 Q6); startup delay 5 000 ms; a startup run waits ≤ `STARTUP_DB_WAIT_MS` (120 000, `scheduler-service.ts:16`) for the DB.
- Shutdown: drain 3 000 ms, browsers 1 500 ms, hard exit at 10 000 ms. tsx 4.21 watch SIGKILLs 5 s after SIGTERM, so the normal path must finish in < 5 s. Two waits ignore today's run signal and are made abortable in Task 5: the startup preflight's `waitForDatabase` (`config/database.ts:46-60`, polls every 5 s up to 120 s) and `emitAlerts`' webhook (`run-alerts.ts:95-110`, `AbortSignal.timeout(5000)`).
- Retention keeps `cleanupOldOdds(24)` semantics (`DELETE … scraped_at < now() - 24 h`, `odds-repository.ts:159-170`) and observability's 30-day `scraper_runs` delete at 03:00 (`runDailyCleanup`, owner B11).
- **Protected log lines** (exact format unchanged): `[Aggregator/FullOffer] Starting run <uuid> for <league> with N bookmakers` (`aggregator.ts:347-349`); `[Aggregator/FullOffer] <bm> <status>: N matches, M markets found, K saved[ - <error>]` (`:243-246`; statuses `success|partial|empty|scrape_failed|persist_failed`, no `completed`); `[Aggregator/FullOffer] Run <id> completed in <ms>ms: <ok> ok, <failed> failed, <m> matches, <f> markets found, <s> saved` (`:383-385`); `[Aggregator/FullOffer] <bm> cleanup failed:` (`:305`); `[ScrapeRun] <league> run=<id8> finished=… ok=…/… matches=… saved=… failed=…` (`run-alerts.ts:27-30`); `[ALERT] …` (`run-alerts.ts:34`, `:60-61`, `:69`, `:80`) and `[ALERT-RESOLVED] …` (`:83`); `[ScraperService] scraper_runs not persisted: …` (`scraper-service.ts:131`); `[Scheduler] All leagues completed: …` (`scheduler-service.ts:167-169`), `[Scheduler] Initial scrape completed: …` (`:203-205`), `[Scheduler] scraper_runs older than 30 days deleted: N` (`:109`).
- **Untouched seams:** `getScraper` (`aggregator.ts:193-195`; used by `scripts/smoke-bookmaker.ts:24, :93, :175`), `closeAllBrowsers` (`aggregator.ts:201-203`; `smoke-bookmaker.ts:190`), `browserPool` (`browser-pool.ts:170`), `PlaywrightScraper.prototype.initBrowser` (stubbed by `totalbet/__tests__/scraper.test.ts:55, :68`, `betcris/__tests__/scraper-flow.test.ts:33`, overridden by `TestScraper` in `navigation-diagnostics.test.ts:641-684`), observability's `executeFullOfferScrape` (`playwright-base.ts:353-391`, recorder inside).
- Live-traffic window (amended): after Task 4 runs no longer start at HH:00. Avoid ±5 min around `/api/health` `nextScrapeAt` and any time `currentRun` is non-null. This replaces "never HH:55–HH:10" for this repo.

## Review Focus

1. **A scraper that ignores its signal and never settles** (one of the 20 in-page fetches without a timeout, a stuck socket, a totalbet/betby call that takes no budget yet) → `scrape_failed` / `hard timeout after <s>s` at exactly deadline + 5 s (120 s http, 240 s browser, 360 s sts and 600 s betcris/pzbuk on the browser); the late result is never normalized or saved; the job goes on with its next league; the lock is released. Pinned by Task 2 "never resolves…", "…never normalized or saved", Task 3 "a hard timeout in the first league…".
2. **`POST /api/admin/scrape` during a scheduled run** (today `admin.ts:58` starts a second scrape whose `closeAllBrowsers()` wedges the first) → 409 `SCRAPE_IN_PROGRESS` with the running run id; no scrape, no browser close; an accepted admin run never overwrites the health views of the last full run. Pinned by Task 1 "returns 409…", "an admin start during a running interval run…", "…admin results stay out of lastResults".
3. **SIGTERM (tsx restart) while units are mid-scrape, mid-save, in the startup DB wait or in the alert webhook** → scraping units dropped, a saving unit finishes and keeps its outcome, finished outcomes go to `scraper_runs` without `[ScrapeRun]`/alerts/retention, the DB wait and the webhook end at once, exit 0 in < 5 s (1 at the 10 s cap). Pinned by Task 5 "an abort drops units…", "an interrupted league persists…", "a SIGTERM during the startup DB wait…", "a run signal aborts the webhook…", shutdown tests.
4. **Boot with the DB down, migration 11 missing, or no OK row** under `STARTUP_SCRAPE=auto` → freshness unknown = stale → the boot scrapes (the 120 s DB wait then aborts loudly); never a silent skip. Pinned by Task 5 "auto: unknown…", "getLastOkRunAt … maps errors to null".
5. **Malformed `SCRAPE_INTERVAL_MINUTES`** (`45abc` parses as 45 today, `abc` makes `cron.schedule` throw at boot, `-5`/`1440` silently mean hourly) → `validateConfig` fails with a named message (exit 1); 45/90/120 give real 45/90/120-minute gaps. Pinned by Task 4 "rejects…", "SCRAPE_INTERVAL_MINUTES=%i starts runs…".
6. **A bookmaker that saved data but reports a cause** (totalbet's failed details `totalbet/index.ts:318-324`, betcris after its breaker with games captured `betcris/index.ts:352-361`; later 02/05a/06/09) → `partial` with the cause: an OK status (no streak, no alert), the cause in the warn line and `scraper_runs.error_message`. Never `success` with the cause dropped, never a failure status. Pinned by Task 0.

---

## Observations (pre-fix analysis)

`file:line` = the future base (integration + observability + fortuna; the files below are identical to `recovery/observability`).

- **Outcome classification.** `classifyBookmakerRun` (`run-outcome.ts:50-81`) returns `{ status: "success", error: null }` for `success: true` + `error` + saved > 0 (`:79-80`); README §5.1 assigned the `partial` rule to this plan. Producers on the base: totalbet (`success: detailsFailed < detailsCounted` with `Detail fetch failed for n/m events (first: …)`), betcris (`success: matches.length > 0`, `aborted after 3 consecutive per-match capture failures`).
- **Admin bypass (CORE-5).** `routes/admin.ts:35` defaults to `"ekstraklasa"` (`CONFIG.ENABLED_LEAGUES` is `["premier-league"]`, `config/index.ts:52-54`). `:58` calls `runScrapeAndPersist(league, bookmakers)` without the `isRunning` guard (`scheduler-service.ts:31`, checked only by the cron body `:156-161`) and with `closeBrowsers = true` (`scraper-service.ts:48`) → `closeAllBrowsers()` (`:154-161`) → `browserPool.closeAll()` drops pending waiters unresolved (`browser-pool.ts:127-131`) under a running scheduled run. `:63` returns `` `${Date.now()}-manual` ``, neither the aggregator's uuid (`aggregator.ts:343`) nor a `scraper_runs.run_id`. An admin result would also be the newest league result the health routes read (`health.ts:30-42`, `:85`) if it were merged.
- **Dead entry points.** `triggerManualScrape` / `triggerLeagueScrape` (`scheduler-service.ts:301-339`) and `runPartialScrape` (`scraper-service.ts:201-206`) have no callers (`git grep` over `src` and `scripts`); each bypasses the guard.
- **Abort records.** The preflight refusal returns `runId: "aborted"` (`scraper-service.ts:62`) and `scraperHealth.recordAbort` keeps one process-wide slot (`scraper-health.ts:50`, `:111-117`); `/health/scrapers` filters it by league (`health.ts:86-93`). With one preflight for several leagues (Task 3) the last league would overwrite the others.
- **No deadline (CORE-4).** `aggregator.ts:279` awaits `scrapeFullOffer(league)` inside `Promise.all` (`:352-354`); 20 in-page `page.evaluate(fetch)` calls in 6 `navigation.ts` files have no timeout; totalbet (30 s per detail, sequential) and betby (15 s per call) have per-request timeouts but no overall budget; `SCRAPER_TIMEOUT_MS` (`config/index.ts:44`) is read nowhere. One stalled response = a run that never ends.
- **Concurrency (CORE-10).** `runAllLeaguesScrape` (`scheduler-service.ts:38-92`) runs every enabled league in parallel and each league runs all 14 in parallel (`aggregator.ts:352-354`); the pool allows 14 browsers (`browser-pool.ts:170`). On the future base **10 of 14 launch Chromium** (the 10 whose `index.ts` calls `executeFullOfferScrape(`: sts, fortuna, superbet, lvbet, fuksiarz, betfan, forbet, etoto, betcris, pzbuk); betclic only through its broken fallback until plan 06 Task 1; totalbet, betters and lebull are browserless but still `extends PlaywrightScraper` (`aggregator.ts:33` is typed `Record<…, PlaywrightScraper>` until plan 02). pzbuk's built browser path takes ≈ 17.4 s/event (pzbuk.md A8, ≈ 330 s per league) and is the critical path until 05c.
- **Unsupported pairs.** `world-cup-2026` has no betters/lebull entry (`config/leagues.ts:144-146`); today such a pair returns `Unknown league` → `scrape_failed` every run and feeds the 3-failure alert.
- **Cron (CORE-6).** `config/index.ts:43` builds `*/${N} * * * *`. node-cron minute fields (`node $E/core/cron-check.cjs`, 2026-11-07): `*/45` → `0,45`; `*/60`, `*/90`, `*/120` → `0`; `*/abc` throws in `cron.schedule` (boot fails in `startScheduler`); `*/-5` and `*/1440` are accepted; `parseInt("45abc")` = 45. `nextRun` (`scheduler-service.ts:279-284`) and `meta.nextUpdate` (`odds-service.ts:174-181`) compute the next epoch multiple of the interval, unrelated to when the cron fires.
- **Startup/shutdown (CORE-7).** `scheduler-service.ts:196-211` starts a full run 5 s after every boot (it waits `STARTUP_DB_WAIT_MS` for the DB). A live dev session (2026-11-07) had 52 restarts, 45 runs started, 9 completed. `index.ts:70-78` calls `process.exit(0)` at once. tsx 4.21.0 watch sends SIGTERM, then SIGKILL after 5 s. No `unhandledRejection` handler: under Node 20 defaults an orphaned rejection (a page op after its context closed) kills the server. `waitForDatabase` takes no signal and `emitAlerts` may wait 5 s for the webhook.
- **Retention.** Observability's `runDailyCleanup()` (`scheduler-service.ts:98-113`) runs only from the 03:00 cron (`:183-192`): `cleanupOldOdds()` (24 h), then `deleteScraperRunsOlderThan(30)` (B11), pinned by `scheduler-service.test.ts:126-148`. node-cron has no catch-up and the service is started by hand → 57.6 % of `odds` rows were > 24 h old (`$E/db-pipeline/`).
- **Metrics (CORE-8).** Nothing per job; Node VmHWM 1.66 GB in one run vs 490 MB idle; betclic lost 9–12 % markets under parallel load with no browser (event-loop starvation, README §1.1). `monitorEventLoopDelay` on Node 20.19.5: idle p50 = resolution + 0.1 ms; a 120 ms block → max 129 ms at resolution 20 → report value − resolution.

## Anchors on the future base (read before every task)

| File | Built (observability / recovery) | This plan | Observability tests to rebase |
|---|---|---|---|
| `src/services/run-outcome.ts` | `classifyBookmakerRun :50-81` (rules doc `:45-49`) | T0 rule before `:79` | `run-outcome.test.ts` extended only |
| `src/scrapers/aggregator.ts` | `SCRAPERS :33-48`, `getScraper :193-195`, `closeAllBrowsers :201-203`, `formatOutcomeLine :243-246`, `runFullOfferForBookmaker :261-333` (lookup `:267`, scrape `:279`, cleanup `:300-307`), `runAllFullOfferScrapers :339-404` (uuid `:343`, Starting `:347-349`, completion `:383-385`) | T1 `opts`; T2 deadline at `:279`; T3 cycle around the unchanged unit, cleanup once per job; T5 `interrupted`; T7 metrics | `aggregator-outcomes.test.ts` and `aggregator-db-down.test.ts` pass **unchanged** at every commit (plain fakes → `http`, 120 s never reached; premier-league supported by all 14) |
| `src/services/scraper-service.ts` | `ScrapeResult :17-33`, `runScrapeAndPersist :45-181` (signature `:45-50`, preflight `:54-76` with `recordAbort :60`/`runId: "aborted" :62`, steps 3–9 `:78-161`), `toScrapeStats :184-199`, `runPartialScrape :201-206` | T1 options/run id/delete; T3 `runScrapeCycle`; T5 interrupted path; T6 retention call | `scraper-service.test.ts`: T3 adds `runFullOfferCycle` to its aggregator mock (`:18-21`); no assertion changes |
| `src/services/scheduler-service.ts` | `STARTUP_DB_WAIT_MS :16`, `MultiLeagueScrapeResult :20-26`, `scrapeTask :28`, `isRunning :31`, `lastResults :32`, `runAllLeaguesScrape :38-92` (forward `:52`, close `:65-71`), `runDailyCleanup :98-113`, `runInitialTsdbSync :120-136`, `startScheduler :141-212` (cron `:153-180`, 03:00 `:183-192`, startup `:196-211`), `stopScheduler :251-265`, `getSchedulerStatus :270-299`, triggers `:301-339` | T1 coordinator; T3 body → cycle; T4 interval; T5 startup; T6 retention | `scheduler-service.test.ts:81-89` (T1, T3), `:126-148` (T6), `:150-161` (T1, T3, T5) |
| `src/services/scraper-health.ts` | `lastAbort :50`, `recordAbort`/`getLastAbort :111-117`, `reset :225-229` | T1 per-league map | `scraper-health.test.ts:96-110` unchanged (no-arg `getLastAbort()` = newest) |
| `src/routes/admin.ts` | import `:19`, POST `/scrape :33-79`, GET `/runs :85-138` | T1 rewrites `:33-79` | `admin-runs.test.ts:9-11` gets a `scheduler-service.js` mock |
| `src/routes/health.ts` | `/` `data :51-61`, `/scrapers :77-99` (abort `:86-93`) | T1 abort per league; T4 `nextScrapeAt`, `currentRun` | `health-scrapers.test.ts` unchanged |
| `src/config/database.ts` | `waitForDatabase :46-60` | T5 optional `signal` | — |
| `src/services/run-alerts.ts` | `emitAlerts :95-110` | T5 optional `signal` | `run-alerts.test.ts:200-…` unchanged |
| `src/index.ts` | `gracefulShutdown :70-78`, `app.listen :114` | T5 | — |
| `src/config/index.ts` | `SCRAPE_INTERVAL_MINUTES :40-42`, `SCRAPE_CRON :43`, `SCRAPER_TIMEOUT_MS :44`, `ALERT_* :46-49`, `validateConfig :82-90` | T2 deletes `:44`; T4 `:40-43` + `validateConfig`; T5 `STARTUP_SCRAPE` after `:39` | — |
| `.env.example` | `SCRAPE_INTERVAL_MINUTES=5 :16`, `SCRAPER_TIMEOUT_MS :17`, `SCRAPERS_ON :19`, `# Alerts :21-25` | T2 deletes `:17`; T4 comment `:16`; T5 after `:19` | — |
| `src/types/full-offer.ts` | `NavigationDiagnostics :81-94`, `FullOfferScraperResult :99-114` (`diagnostics? :113`) | T7 `ScrapeMetrics` + `metrics?` | — |
| `src/scrapers/base/playwright-base.ts` | `initBrowser :93-170`, `executeWithBrowser :335-351` (session `:343`), `executeFullOfferScrape :353-391` | T2 abort hook in `executeWithBrowser` after `:343` | `navigation-diagnostics.test.ts` unchanged |
| `src/types/api.ts` | `HealthCheckData :44-54`, `ERROR_CODES :179-186` | T1 `SCRAPE_IN_PROGRESS`; T4 health fields | — |
| `src/services/odds-service.ts` | `getNextUpdateTime :174-181` | T4 | — |
| `scripts/smoke-bookmaker.ts` | `persistRun :144-167`, `main :169-192`, exit codes `:14-18` | T4 run guard | standalone `tsc` |

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/services/run-outcome.ts` | the `partial` rule | 0 |
| `src/services/run-coordinator.ts` (new) | single run, run ids, abort, drain | 1 |
| `src/services/scheduler-service.ts` | coordinator singleton + executor, interval scheduler, startup policy, retention wiring | 1, 3–6 |
| `src/services/scraper-health.ts`, `src/routes/health.ts` | per-league abort records; `nextScrapeAt`, `currentRun` | 1, 4 |
| `src/routes/admin.ts`, `src/types/api.ts` | POST `/scrape` via coordinator, 409, league check; `SCRAPE_IN_PROGRESS`; health fields | 1, 4 |
| `src/services/scraper-service.ts` | id/signal pass-through, aborted run id, `runScrapeCycle`, interrupted persistence, retention call | 1, 3, 5, 6 |
| `src/scrapers/aggregator.ts` | per-unit deadline, `runFullOfferCycle`, interruption, metrics | 1, 2, 3, 5, 7 |
| `src/scrapers/job-budgets.ts` (new, leaf) | `JobTransport`, browser budget overrides, grace, `maxDurationMsFor` (plan 08 imports it) | 2 |
| `src/scrapers/job-policy.ts` (new) | `DeclaresTransport`, `resolveJobTransport`, caps, job order | 2, 3 |
| `src/scrapers/shared/job-context.ts` (new) | `AsyncLocalStorage` job context | 2 |
| `src/scrapers/hard-deadline.ts` (new) | `scrapeWithHardDeadline`, `RunInterruptedError` | 2, 5 |
| `src/scrapers/base/playwright-base.ts` | close the context when the job budget aborts | 2 |
| `src/scrapers/bookmakers/totalbet/index.ts`, `src/scrapers/shared/betby/scraper.ts` (+ betclic if plan 06 Task 1 has not) | `readonly transport = "http" as const` | 2 |
| `src/scrapers/job-scheduler.ts` (new) | `runJobsWithCaps` | 3 |
| `src/config/index.ts`, `.env.example` | interval validation, `SCRAPE_CRON`/`SCRAPER_TIMEOUT_MS` removed, `STARTUP_SCRAPE` | 2, 4, 5 |
| `src/services/interval-scheduler.ts` (new) | `computeNextDelayMs`, `IntervalScheduler`, `getPlannedNextRun` | 4 |
| `src/services/run-guard.ts` (new), `scripts/smoke-bookmaker.ts` | `probeCurrentRun`; `--persist` refuses during a run | 4 |
| `src/services/odds-service.ts` | real `nextUpdate` | 4 |
| `src/services/startup-policy.ts`, `src/services/shutdown.ts` (new) | boot decision; drain/exit/rejection handler | 5 |
| `src/config/database.ts`, `src/services/run-alerts.ts` | abortable DB wait and webhook | 5 |
| `src/index.ts` | wire shutdown, keep the server handle | 5 |
| `src/services/retention-service.ts` (new) | `runRetentionCleanup` seam used by `runDailyCleanup` | 6 |
| `src/scrapers/metrics/scrape-metrics.ts` (new), `src/types/full-offer.ts` | metrics types, cycle sampler over plan 02's `/proc` reader, `[ScrapeMetrics]` | 7 |
| `src/__tests__/helpers/run-fixtures.ts` | appended builders: `deferred` (1); `okResult`, `twentyMatches`, `fakeBudget` (2) | 1, 2 |

---

### Task 0: `partial` rule in `classifyBookmakerRun` (README §5.0 F3)

**Files:**
- Modify: `src/services/run-outcome.ts:45-49` (rules doc) and insert one rule before `:79`.
- Test: extend `src/services/__tests__/run-outcome.test.ts` (`describe("classifyBookmakerRun")`, `:113-…`) and `src/scrapers/__tests__/aggregator-outcomes.test.ts` (one wiring test, its `saved()`/`logged()`/`warnSpy` helpers at `:77-111`).

**Interfaces:**
- `classifyBookmakerRun(scrape, save)` keeps its signature. Rules, in order: scraper failed → `scrape_failed`; 0 matches → `empty`; no save / 0 saved → `persist_failed`; **saved > 0 with a scraper cause or save errors → `partial`**, `error = [scrape.error, saveError].filter(Boolean).join(" | ")`; else `success`.
- The edit, inserted before `:79` so both causes join when both exist (`:79` and `:80` stay):
  ```ts
  if (scrape.error) return { status: "partial", error: [scrape.error, saveError].filter(Boolean).join(" | ") };
  ```
- Effects (no other code changes): `partial` is in `OK_RUN_STATUSES` (`run-outcome.ts:19`), so no failure streak and no alert; the outcome line goes to `console.warn` with ` - <cause>` (`aggregator.ts:243-252`); `scraper_runs.error_message` keeps the cause; `/api/admin/runs` maps it to `success` with `error` (`admin.ts:100-107`). An empty error string is no cause. A scraper cause never rescues a run that saved nothing.

- [ ] **Step 1: Write the failing tests**
```ts
// run-outcome.test.ts, describe("classifyBookmakerRun")
it("success with a scraper cause and saved rows is partial and keeps the cause (README §5.1)", () =>
  expect(classifyBookmakerRun({ success: true, matches: twenty, error: "aborted after 3 consecutive per-match capture failures" },
    { marketsNormalized: 6000, marketsSaved: 6000, errors: [] }))
    .toEqual({ status: "partial", error: "aborted after 3 consecutive per-match capture failures" }));
it("joins the scraper cause and the save errors with ' | '", () =>
  expect(classifyBookmakerRun({ success: true, matches: twenty, error: "1 of 20 details failed | fetch HTTP 503 https://api.example/1" },
    { marketsNormalized: 4200, marketsSaved: 4100, errors: ["Batch insert failed (1 of 12 batches): TypeError: fetch failed (other side closed)"] }))
    .toEqual({ status: "partial",
      error: "1 of 20 details failed | fetch HTTP 503 https://api.example/1 | Batch insert failed (1 of 12 batches): TypeError: fetch failed (other side closed)" }));
it("an empty scraper error string is no cause", () =>
  expect(classifyBookmakerRun({ success: true, matches: twenty, error: "" }, { marketsNormalized: 10, marketsSaved: 10, errors: [] }))
    .toEqual({ status: "success", error: null }));
it("a scraper cause never turns a run that saved nothing into partial", () =>
  expect(classifyBookmakerRun({ success: true, matches: twenty, error: "aborted after 3 consecutive per-match capture failures" },
    { marketsNormalized: 420, marketsSaved: 0, errors: [] }))
    .toEqual({ status: "persist_failed", error: "0 of 420 normalized markets saved (all filtered as non-canonical)" }));

// aggregator-outcomes.test.ts
it("a scraper that saved data but reports a cause is partial: counted ok, warn line with the cause", async () => {
  scrapers.betcris.scrapeFullOffer.mockResolvedValueOnce({ success: true, bookmaker: "betcris", league: "premier-league", matches: twenty,
    error: "aborted after 3 consecutive per-match capture failures" });
  save.mockResolvedValueOnce(saved(6000));
  const r = await runAllFullOfferScrapers("premier-league", ["betcris"]);
  expect(r.outcomes[0]).toMatchObject({ status: "partial", marketsSaved: 6000, error: "aborted after 3 consecutive per-match capture failures" });
  expect(r.summary).toMatchObject({ successCount: 1, errorCount: 0 });
  expect(logged(warnSpy)).toContain(
    "[Aggregator/FullOffer] betcris partial: 20 matches, 20 markets found, 6000 saved - aborted after 3 consecutive per-match capture failures");
});
```
- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/services/__tests__/run-outcome.test.ts src/scrapers/__tests__/aggregator-outcomes.test.ts`. Expected: the two partial cases return `{ status: "success", error: null }`; the wiring test sees `betcris success: …` on `console.log`. The other two new tests already pass (they pin behaviour that must not change).
- [ ] **Step 3: Implement** the one-line rule and update the rules doc comment (`:45-49`: "saved with a scraper cause or save errors -> partial").
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy npx vitest run` and `heavy npx tsc --noEmit`. No existing test pins `success` for a `success: true` result with a non-empty error (`git grep` over `src/**/__tests__` on the future base).
- [ ] **Step 5: Commit**
```bash
git add src/services/run-outcome.ts src/services/__tests__/run-outcome.test.ts src/scrapers/__tests__/aggregator-outcomes.test.ts
git commit -m "fix(observability): classify a run that saved data but reports a cause as partial"
```

---

### Task 1: `RunCoordinator`, admin endpoint, dead triggers, abort records

**Files:**
- Create: `src/services/run-coordinator.ts`
- Modify:
  - `src/services/scheduler-service.ts`: export `MultiLeagueScrapeResult` (`:20-26`); delete `isRunning` (`:31`); add `lastAdminResults` next to `lastResults` (`:32`); `runAllLeaguesScrape(options?: RunLeaguesOptions)` (`:38-92`, forward at `:52`); cron body `:155-175` and startup body `:197-210` → `runCoordinator.start(...)`; `getSchedulerStatus` (`:270-299`); delete `:301-339`.
  - `src/services/scraper-service.ts`: `:45-50` (default league `CONFIG.ENABLED_LEAGUES[0]`, widened `options`), preflight `:54-76` (aborted run id), delete `:201-206`.
  - `src/services/scraper-health.ts`: `:50`, `:111-117`, `:225-229` (per-league abort map). `src/routes/health.ts:86-93`.
  - `src/scrapers/aggregator.ts:339-349` (`opts`, default league).
  - `src/routes/admin.ts:19`, `:33-79`; `src/types/api.ts:179-186`.
  - `src/__tests__/helpers/run-fixtures.ts` ("Later tasks append their own builders to this file", `:6`): append `deferred<T>()` → `{ promise, resolve, reject }`.
- Test: create `src/services/__tests__/run-coordinator.test.ts`, `src/services/__tests__/scheduler-runs.test.ts`, `src/routes/__tests__/admin-scrape.test.ts`; extend `scraper-health.test.ts`, `scraper-service.test.ts`; rebase `scheduler-service.test.ts:81-89`, `:150-161` and `admin-runs.test.ts:9-11`.

**Interfaces:**
- Consumes: observability `runScrapeAndPersist(league, bookmakers, closeBrowsers, options)`, `runAllLeaguesScrape(options)`, `ScrapeResult`, `scraperHealth`.
- Produces:
  ```ts
  export type RunTrigger = "startup" | "interval" | "admin";
  export interface RunRequest { trigger: RunTrigger; leagues: readonly string[]; bookmakers: readonly PolishBookmaker[] }
  export interface RunExecutionContext { runIds: Readonly<Record<string, string>>; signal: AbortSignal }
  export interface RunHandle { runId: string; runIds: Readonly<Record<string, string>>; trigger: RunTrigger;
    leagues: readonly string[]; bookmakers: readonly PolishBookmaker[]; startedAt: Date; done: Promise<void> }
  export type StartResult = { accepted: true; run: RunHandle } | { accepted: false; running: RunHandle };
  export class RunCoordinator {
    constructor(execute: (req: RunRequest, ctx: RunExecutionContext) => Promise<void>, deps?: { uuid?: () => string; now?: () => Date });
    start(req: RunRequest): StartResult;        // one uuid per league; runId = runIds[leagues[0]]; throws "RunRequest.leagues is empty"
    current(): RunHandle | null;
    abort(reason: string): boolean;             // controller.abort(new Error(reason)); false when idle
    whenIdle(): Promise<void>;
    drain(timeoutMs: number): Promise<boolean>; // true when idle within timeoutMs
  }
  // scheduler-service.ts
  export const runCoordinator: RunCoordinator;
  export interface MultiLeagueScrapeResult { /* unchanged fields, now exported */ }
  export interface RunLeaguesOptions { dbWaitMs?: number; leagues?: readonly string[]; bookmakers?: readonly PolishBookmaker[];
    runIds?: Readonly<Record<string, string>>; signal?: AbortSignal }
  export async function runAllLeaguesScrape(options?: RunLeaguesOptions): Promise<MultiLeagueScrapeResult>;
  // getSchedulerStatus(): isRunning = runCoordinator.current() !== null; gains lastAdminResults: Record<string, ScrapeResult> (additive)
  // scraper-service.ts / aggregator.ts (widened; default league CONFIG.ENABLED_LEAGUES[0] instead of "ekstraklasa")
  runScrapeAndPersist(league?, bookmakers?, closeBrowsers = true, options?: { dbWaitMs?: number; runId?: string; signal?: AbortSignal })
  runAllFullOfferScrapers(league?, bookmakers?, opts?: { runId?: string; signal?: AbortSignal })   // runId = opts?.runId ?? uuidv4()
  // scraper-health.ts
  recordAbort(league: string, reason: string, at: Date): void       // one record per league (Map)
  getLastAbort(league?: string): RunAbort | null                    // a league's record; without a league the newest of all (back-compat)
  // types/api.ts
  ERROR_CODES.SCRAPE_IN_PROGRESS = "SCRAPE_IN_PROGRESS"
  ```
- Rules:
  - **Executor** (`scheduler-service.ts`): `runAllLeaguesScrape({ leagues: req.leagues, bookmakers: req.trigger === "admin" ? req.bookmakers : undefined, runIds: ctx.runIds, signal: ctx.signal, dbWaitMs: req.trigger === "startup" ? STARTUP_DB_WAIT_MS : undefined })`. `runAllLeaguesScrape` walks `options.leagues ?? CONFIG.ENABLED_LEAGUES` and forwards `{ dbWaitMs, runId: runIds?.[league], signal }` at `:52`.
  - **Admin runs are tagged, not merged:** startup/interval results are set per league into `lastResults`; admin results go to `lastAdminResults` only, so a one-bookmaker admin run never replaces `/api/health` `lastScrapeStats` (`health.ts:30-42`) or `/api/health/scrapers` `lastRun` (`health.ts:85`). Summary line per trigger: startup → `[Scheduler] Initial scrape completed: …`, interval and admin → `[Scheduler] All leagues completed: …` (unchanged formats).
  - **Aborted run id:** a league refused by the preflight returns `runId: options.runId ?? "aborted"` — the coordinator's id for that league, so the 202 response, the `[Coordinator]` lines and the result agree; `"aborted"` remains only for direct callers without an id (scripts). `aborted: "db_unreachable"` stays the marker; no `scraper_runs` row is written for it, as today.
  - **Per-league abort records:** `recordAbort` sets `abortsByLeague.set(league, …)`; `health.ts:86-93` becomes `scraperHealth.getLastAbort(league)`; `reset()` clears the map.
- Logs: `[Coordinator] run ${runId} started (${trigger}) at ${iso}: leagues=${leagues.join(",")} bookmakers=${n}`, `[Coordinator] run ${runId} finished in ${ms}ms`, `[Coordinator] run ${runId} failed: ${message}` (`done` never rejects). The cron skip line becomes `[Scheduler] Previous scrape still running (run ${id8}, ${trigger}), skipping...`.
- `triggerManualScrape`, `triggerLeagueScrape`, `runPartialScrape` are **deleted**: no callers, each bypasses the lock.

- [ ] **Step 1: Write the failing tests**

```ts
// run-coordinator.test.ts
const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const REQ: RunRequest = { trigger: "interval", leagues: ["premier-league", "laliga"], bookmakers: ["sts", "forbet"] };
it("one run id per league; runId is the first league's; a second start is refused", () => {
  const exec = vi.fn(() => new Promise<void>(() => {})); const c = new RunCoordinator(exec, { uuid: seq(IDS) });
  expect(c.start(REQ)).toMatchObject({ accepted: true, run: { runId: IDS[0], runIds: { "premier-league": IDS[0], laliga: IDS[1] } } });
  expect(exec).toHaveBeenCalledWith(REQ, { runIds: { "premier-league": IDS[0], laliga: IDS[1] }, signal: expect.any(AbortSignal) });
  expect(c.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] }))
    .toMatchObject({ accepted: false, running: { runId: IDS[0], trigger: "interval" } });
});
it("releases the lock when the run rejects; done never rejects", async () => { /* exec rejects new Error("boom") */
  await r.run.done; expect(c.current()).toBeNull(); expect(c.start(REQ).accepted).toBe(true);
  expect(errorSpy).toHaveBeenCalledWith(`[Coordinator] run ${IDS[0]} failed: boom`);
});
it("abort() aborts ctx.signal with new Error(reason), false when idle; drain(3000) true at 1 s, false at 3 s for a hung run", async () => {
  /* (ctxSignal.reason as Error).message === "shutdown: SIGTERM"; new RunCoordinator(vi.fn()).abort("x") === false; fake timers for drain */ });

// admin-scrape.test.ts: express().use(express.json()).use("/api/admin", adminRouter).use(errorHandler) on port 0 (the admin-runs.test.ts:16-30 setup);
// vi.mock("../../services/scheduler-service.js", () => ({ runCoordinator: { start: vi.fn() } })); runScrapeAndPersist and
// closeAllBrowsers are mocked spies that must stay uncalled. post(body) sends Bearer CONFIG.ADMIN_API_KEY.
it("returns 202 with the coordinator's run id", async () => {
  start.mockReturnValueOnce({ accepted: true, run: { runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", startedAt: new Date("2026-11-07T10:00:00.000Z") } });
  const res = await post({ league: "premier-league", bookmakers: ["pzbuk"] });
  expect(res.status).toBe(202);
  expect((await res.json()).data).toEqual({ runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", status: "started",
    league: "premier-league", bookmakers: ["pzbuk"], startedAt: "2026-11-07T10:00:00.000Z" });
  expect(start).toHaveBeenCalledWith({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] });
});
it("defaults to the first enabled league and all bookmakers", async () => { await post({});
  expect(start).toHaveBeenCalledWith({ trigger: "admin", leagues: [CONFIG.ENABLED_LEAGUES[0]], bookmakers: [...CONFIG.BOOKMAKERS] }); });
it("returns 409 with the running run (Review Focus 2)", async () => {
  start.mockReturnValueOnce({ accepted: false, running: { runId: "440d2fc6-658b-46fe-b288-05261faa0caf", trigger: "interval",
    startedAt: new Date("2026-11-07T10:00:00.350Z"), leagues: ["premier-league"], bookmakers: [...CONFIG.BOOKMAKERS] } });
  const res = await post({});
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatchObject({ code: "SCRAPE_IN_PROGRESS",
    message: "Scrape run 440d2fc6-658b-46fe-b288-05261faa0caf (interval) in progress since 2026-11-07T10:00:00.350Z",
    details: { runId: "440d2fc6-658b-46fe-b288-05261faa0caf", trigger: "interval" } });
  expect(runScrapeAndPersist).not.toHaveBeenCalled(); expect(closeAllBrowsers).not.toHaveBeenCalled();
});
it("rejects a league that is not enabled (today's default)", async () => {
  const res = await post({ league: "ekstraklasa" });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatchObject({ code: "INVALID_PARAMS", message: "League not enabled: ekstraklasa (enabled: premier-league)" });
  expect(start).not.toHaveBeenCalled();
});

// scheduler-runs.test.ts: mocks ../scraper-service.js (runScrapeAndPersist: by default resolves scrapeResult(league, options.runId)),
// ../../scrapers/aggregator.js (closeAllBrowsers), node-cron (schedule records (expr, fn) in cronJobs and returns { stop: vi.fn() }),
// ../../repositories/odds-repository.js and scraper-run-repository.js as in scheduler-service.test.ts:4-24.
it("an admin start during a running interval run is refused and closes no browsers (Review Focus 2)", async () => {
  const d = deferred<ScrapeResult>(); runScrapeAndPersist.mockReturnValueOnce(d.promise);
  const first = runCoordinator.start({ trigger: "interval", leagues: ["premier-league"], bookmakers: [...CONFIG.BOOKMAKERS] });
  expect(runCoordinator.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] }).accepted).toBe(false);
  expect(closeAllBrowsers).not.toHaveBeenCalled();
  d.resolve(scrapeResult("premier-league", first.run.runId)); await first.run.done;
  expect(runScrapeAndPersist).toHaveBeenCalledTimes(1); expect(closeAllBrowsers).toHaveBeenCalledTimes(1);
});
it("passes run id and signal down; isRunning covers every trigger; admin results stay out of lastResults (Review Focus 2)", async () => {
  const full = runCoordinator.start({ trigger: "interval", leagues: ["premier-league"], bookmakers: [...CONFIG.BOOKMAKERS] }); await full.run.done;
  const r = runCoordinator.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["forbet"] });
  expect(getSchedulerStatus().isRunning).toBe(true); await r.run.done;
  expect(runScrapeAndPersist).toHaveBeenLastCalledWith("premier-league", ["forbet"], false,
    expect.objectContaining({ runId: r.run.runIds["premier-league"], signal: expect.any(AbortSignal) }));
  expect(getSchedulerStatus().lastResults["premier-league"].runId).toBe(full.run.runId);
  expect(getSchedulerStatus().lastAdminResults["premier-league"].runId).toBe(r.run.runId);
});

// scraper-service.test.ts (extend "DB preflight and run integrity")
it("a refused league carries the coordinator's run id", async () => {
  m.probeDatabase.mockResolvedValue({ ok: false, error: DB_DOWN });
  const r = await runScrapeAndPersist("premier-league", ["forbet"], false, { runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11" });
  expect(r).toMatchObject({ runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", aborted: "db_unreachable", outcomes: [] });
});
// scraper-health.test.ts (extend "scraperHealth aborts")
it("keeps one abort record per league", () => {
  scraperHealth.recordAbort("premier-league", "a", new Date("2026-11-06T15:44:05.000Z"));
  scraperHealth.recordAbort("laliga", "b", new Date("2026-11-06T15:44:06.000Z"));
  expect(scraperHealth.getLastAbort("premier-league")).toMatchObject({ league: "premier-league", reason: "a" });
  expect(scraperHealth.getLastAbort()).toMatchObject({ league: "laliga" });
});
```

Rebases in the same commit:
- `scheduler-service.test.ts:81-84` → last argument `expect.objectContaining({ dbWaitMs: 120_000 })`; `:86-89` → `expect(m.runScrapeAndPersist.mock.calls[0][3]?.dbWaitMs).toBeUndefined()`; `:154-161` → `toHaveBeenCalledWith("premier-league", undefined, false, expect.objectContaining({ dbWaitMs: 120_000 }))`.
- `admin-runs.test.ts:9-11` → add `vi.mock("../../services/scheduler-service.js", async () => ({ runCoordinator: { start: vi.fn() } }))`: admin now imports the coordinator, and `scheduler-service.ts` imports the aggregator, i.e. the whole Playwright scraper tree the file keeps out today.

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/services/__tests__/run-coordinator.test.ts src/services/__tests__/scheduler-runs.test.ts src/routes/__tests__/admin-scrape.test.ts src/services/__tests__/scraper-service.test.ts src/services/__tests__/scraper-health.test.ts`. Expected: FAIL (`run-coordinator.js` not found; admin answers 202 with `…-manual`; the refused run says `aborted`; the second league overwrites the first abort).
- [ ] **Step 3: Implement.** `crypto.randomUUID` is the default `uuid`. Admin: `typeof league === "string" && CONFIG.ENABLED_LEAGUES.includes(league)` else 400 `League not enabled: <l> (enabled: <list>)`; bookmaker validation (`admin.ts:38-52`) kept; then `runCoordinator.start`; `accepted: false` → `throw new ApiError(409, ERROR_CODES.SCRAPE_IN_PROGRESS, msg, { runId, trigger, startedAt, leagues, bookmakers })`.
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy npx vitest run` (with the rebases above) and `heavy npx tsc --noEmit`; `git grep -n "triggerManualScrape\|triggerLeagueScrape\|runPartialScrape\|-manual" -- src scripts` prints nothing.
- [ ] **Step 5: Commit**
```bash
git add src/services/run-coordinator.ts src/services/scheduler-service.ts src/services/scraper-service.ts src/services/scraper-health.ts src/routes/health.ts src/scrapers/aggregator.ts src/routes/admin.ts src/types/api.ts src/__tests__/helpers/run-fixtures.ts src/services/__tests__/run-coordinator.test.ts src/services/__tests__/scheduler-runs.test.ts src/services/__tests__/scheduler-service.test.ts src/services/__tests__/scraper-service.test.ts src/services/__tests__/scraper-health.test.ts src/routes/__tests__/admin-scrape.test.ts src/routes/__tests__/admin-runs.test.ts
git commit -m "feat(scheduler): RunCoordinator - one run at a time, real admin run ids, 409 while busy"
```

---

### Task 2: Per-unit hard deadline, runtime transport classification, browser budgets

Precondition: plan 02 merged; 05a Task 0 (sts breaker) merged.

**Files:**
- Create: `src/scrapers/job-budgets.ts`, `src/scrapers/job-policy.ts`, `src/scrapers/shared/job-context.ts`, `src/scrapers/hard-deadline.ts`.
- Modify: `src/scrapers/aggregator.ts` (`runFullOfferForBookmaker :261-333`: transport after the lookup `:267`, the scrape call `:279`); `src/scrapers/base/playwright-base.ts` (`executeWithBrowser :335-351`, after `:343`); `src/scrapers/bookmakers/totalbet/index.ts:57` and `src/scrapers/shared/betby/scraper.ts:108` (`readonly transport = "http" as const`; betclic's comes from plan 06 Task 1 — add it at `betclic/index.ts:50` only if absent); `src/config/index.ts:44` and `.env.example:17` (delete the dead `SCRAPER_TIMEOUT_MS`); `src/__tests__/helpers/run-fixtures.ts` (append builders).
- Test: create `src/scrapers/__tests__/job-policy.test.ts`, `src/scrapers/__tests__/hard-deadline.test.ts`, `src/scrapers/base/__tests__/playwright-base-abort.test.ts`, `src/scrapers/__tests__/aggregator-deadline.test.ts`; extend `src/scrapers/shared/betby/__tests__/scraper.test.ts:30` (no-browser guard).

**Interfaces:**
- Consumes: §3 `ScrapeBudget`, `createScrapeBudget`, `DEFAULT_MAX_DURATION_MS`, `FullOfferScraper`; Task 1 `opts.signal`.
- Produces:
  ```ts
  // job-budgets.ts (leaf: imports only DEFAULT_MAX_DURATION_MS and types; plan 08's browser-policy.ts imports it)
  export type JobTransport = keyof typeof DEFAULT_MAX_DURATION_MS;           // "http" | "websocket" | "browser"
  export const BROWSER_MAX_DURATION_OVERRIDES_MS: Readonly<Partial<Record<PolishBookmaker, number>>>; // { pzbuk: 600_000, betcris: 600_000, sts: 360_000 }
  export const HARD_DEADLINE_GRACE_MS = 5_000;
  export function maxDurationMsFor(bookmaker: PolishBookmaker, transport: JobTransport): number;
  //   "browser" -> BROWSER_MAX_DURATION_OVERRIDES_MS[bookmaker] ?? DEFAULT_MAX_DURATION_MS.browser; else DEFAULT_MAX_DURATION_MS[transport]
  // job-policy.ts (re-exports job-budgets)
  export interface DeclaresTransport { readonly transport: JobTransport }    // README §3: every non-browser scraper declares it
  export function resolveJobTransport(scraper: FullOfferScraper): JobTransport;
  //   1. a valid DeclaresTransport.transport -> it
  //   2. scraper instanceof PlaywrightScraper -> "browser"   (an undeclared Playwright subclass launches Chromium)
  //   3. else "http"
  // job-context.ts (plan 08 reads currentScrapeJob() for its session budget)
  export interface ScrapeJobContext { runId: string; bookmaker: PolishBookmaker; league: string; transport: JobTransport; budget: ScrapeBudget }
  export function runInScrapeJob<T>(ctx: ScrapeJobContext, fn: () => Promise<T>): Promise<T>;   // AsyncLocalStorage.run
  export function currentScrapeJob(): ScrapeJobContext | undefined;
  // hard-deadline.ts
  export interface HardDeadlineJob { runId: string; bookmaker: PolishBookmaker; league: string; transport: JobTransport; maxDurationMs: number }
  export function hardTimeoutMessage(maxDurationMs: number): string;   // `hard timeout after ${Math.round(maxDurationMs / 1000)}s`
  export function scrapeWithHardDeadline(scraper: FullOfferScraper, job: HardDeadlineJob, runSignal?: AbortSignal,
    deps?: { graceMs?: number; createBudget?: typeof createScrapeBudget }): Promise<FullOfferScraperResult>;
  // run-fixtures.ts (appended; deferred<T>() came with Task 1): okResult(bm, matches = [], league = "premier-league");
  // twentyMatches(): FullMatchOffer[] (H0..H19 vs A0..A19); fakeBudget(deadline) -> ScrapeBudget & { controller: AbortController }
  ```
- **No env rule in the classifier:** `SCRAPER_TRANSPORT_<BM>` picks the *instance* at module load (README §3, one pick per bookmaker); classifying the picked instance is the truth and survives file moves (cross-plan #8).
- **Future-base classification (pinned):** `browser` for the 10 default instances that are undeclared Playwright subclasses — sts, fortuna, superbet, lvbet, fuksiarz, betfan, forbet, etoto, betcris, pzbuk (the 10 whose `index.ts` calls `executeFullOfferScrape(`); `http` for betclic, betters, lebull, totalbet (declared). The declarations are backed by no-browser guards: totalbet `scraper.test.ts:55, :68`, betclic plan 06 Task 1, betby this task.
- **Browser budgets** (owner C keeps betcris on the browser; sts stays on it until 05a; README §8 Q12). Rule: `max(240 s, 2 × observed max)` rounded up to the minute, or the recovery code's retry worst case when that is larger:
  - **pzbuk 600 000** (unchanged): built browser path ≈ 17.4 s/event (pzbuk.md A8) × 19 ≈ 330 s.
  - **betcris 600 000**: A1 2026-11-07 took 100.8 s for 19 games at one attempt each (`docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/acceptance-2026-11-07.json`), recovery run 1 164 s. A failing capture costs ≤ 2 × (30 s goto + 15 s socket + 30 s first frame) + 3 s ≈ 153 s (betcris.md "Worst-case duration grows"; `WS_CONFIG` `betcris/constants.ts:225-235`), and the breaker stops after 3 consecutive site-level failures (`index.ts:287`), so a run that ends through it after 16 good games takes ≈ 2 + 16 × 5.3 + 3 × 153 ≈ 546 s. At 240 s every such run would be cut and, because betcris returns only at the end of its loop (`index.ts:271-362`), lose the games it had captured. Not covered: failures that alternate with successes never trip the breaker; the 600 s deadline is then the backstop and the league is lost for that run (plan 08 Open Question 4).
  - **sts 360 000**: alone 97.4 s, parallel 117–120 s (README §1.1), recovery runs 130–170 s. Each snapshot miss below the breaker adds a second attempt (≈ 15.5 s: 1.5 s settle + 12 s `WS_DATA_TIMEOUT`, `sts/constants.ts:464`, + navigation). 360 s = 2 × 170 s rounded up; 05a Task 0's breaker ends a systemic miss as `success: false` long before it.
  - After 05a (sts) and 05c (pzbuk) their websocket transport takes 120 s; the overrides apply only to `transport === "browser"`.
- **totalbet and betby take no budget or signal yet:** their `scrapeFullOffer(league)` ignores the second argument. After a hard timeout their loop keeps running — totalbet fetches details sequentially, 30 s each (`totalbet/constants.ts:31, :36`), betby 15 s per call (`shared/betby/http.ts:4`) — and its late result is discarded; the job may already be on its next league. Accepted until plan 02's adapter tasks pass `budget.signal` down.
- `scrapeWithHardDeadline`: budget = `createBudget(job.maxDurationMs, runSignal)`; call `scraper.scrapeFullOffer(job.league, budget)` inside `runInScrapeJob`; race it against a `setTimeout` at `budget.deadline + graceMs - Date.now()` that resolves `{ success: false, bookmaker, league, matches: [], error: hardTimeoutMessage, duration }`. A `success: false` result that arrives when `Date.now() >= budget.deadline` gets error `` `${hardTimeoutMessage} | ${result.error}` ``. A throw is rethrown (observability's `scrape_failed` path, `aggregator.ts:280-283`). The orphaned promise gets `.catch(() => {})`.
- Edits: in `runFullOfferForBookmaker`, `const transport = resolveJobTransport(scraper)` after `:267`; `:279` `await scraper.scrapeFullOffer(league)` → `await scrapeWithHardDeadline(scraper, { runId, bookmaker, league, transport, maxDurationMs: maxDurationMsFor(bookmaker, transport) }, runSignal)`. In `executeWithBrowser`, after `const session = await this.initBrowser()` (`:343`): `const signal = currentScrapeJob()?.budget.signal`; if it is already aborted, close `session.context` at once, otherwise add a `{ once: true }` abort listener calling `void session.context.close().catch(() => {})`; remove it in `finally` before `cleanup()`. `initBrowser` is not touched (plan 08 Task 5 is the rebase partner and keeps this hook).

- [ ] **Step 1: Write the failing tests**

```ts
// job-policy.test.ts
const pw = (bm: string, extra = {}) => Object.assign(Object.create(PlaywrightScraper.prototype), { bookmaker: bm, ...extra }) as FullOfferScraper;
const plain = (bm: string, extra = {}) => ({ bookmaker: bm, scrapeFullOffer: vi.fn(), cleanup: vi.fn(), ...extra }) as FullOfferScraper;
it("classifies by declaration first, then by Playwright inheritance", () => {
  expect([resolveJobTransport(pw("sts")), resolveJobTransport(pw("betclic", { transport: "http" })), resolveJobTransport(plain("forbet")),
    resolveJobTransport(plain("sts", { transport: "websocket" })), resolveJobTransport(plain("forbet", { transport: "bogus" }))])
    .toEqual(["browser", "http", "http", "websocket", "http"]);
});
it("budgets", () => expect([maxDurationMsFor("pzbuk", "browser"), maxDurationMsFor("betcris", "browser"), maxDurationMsFor("sts", "browser"),
  maxDurationMsFor("fortuna", "browser"), maxDurationMsFor("pzbuk", "websocket"), maxDurationMsFor("forbet", "http")])
  .toEqual([600_000, 600_000, 360_000, 240_000, 120_000, 120_000]));
it("pins the transport of every getScraper(bm) default instance (cross-plan #8)", () => {
  const BROWSERLESS = new Set(["betclic", "betters", "lebull", "totalbet"]);   // plans 03-05 update this set when they change a pick
  expect(Object.fromEntries(CONFIG.BOOKMAKERS.map((bm) => [bm, resolveJobTransport(getScraper(bm)!)])))
    .toEqual(Object.fromEntries(CONFIG.BOOKMAKERS.map((bm) => [bm, BROWSERLESS.has(bm) ? "http" : "browser"])));
});

// shared/betby/__tests__/scraper.test.ts:30 ("betters scrapeFullOffer returns 11 PL matches…"), added lines:
const initBrowser = vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockRejectedValue(new Error("browser disabled in unit tests"));
/* …existing body… */ expect(initBrowser).not.toHaveBeenCalled();

// hard-deadline.test.ts (vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") }); s = a plain fake scraper)
const JOB = { runId: "6f1c2b9e-0d4a-4c43-9a57-2a1f3c0e9b11", bookmaker: "forbet", league: "premier-league", transport: "http", maxDurationMs: 120_000 } as const;
it("passes a budget ending at start + maxDurationMs and exposes the job context", async () => {
  let seen: unknown; s.scrapeFullOffer.mockImplementationOnce(async (league, budget) => { seen = { league, deadline: budget.deadline, job: currentScrapeJob() }; return okResult("forbet"); });
  await scrapeWithHardDeadline(s, JOB);
  expect(seen).toMatchObject({ league: "premier-league", deadline: Date.parse("2026-11-07T10:02:00.000Z"), job: { bookmaker: "forbet", runId: JOB.runId } });
});
it("a scraper that never resolves becomes 'hard timeout after 120s' at deadline + 5 s, not earlier (Review Focus 1)", async () => {
  s.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {}));
  let done = false; const p = scrapeWithHardDeadline(s, JOB).finally(() => (done = true));
  await vi.advanceTimersByTimeAsync(124_999); expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await p).toEqual({ success: false, bookmaker: "forbet", league: "premier-league", matches: [], error: "hard timeout after 120s", duration: 125_000 });
});
it("betcris on the browser gets 600 s", async () => { /* JOB with bookmaker betcris, transport browser, maxDurationMs 600_000: still pending at 604_999, 'hard timeout after 600s' at 605_000 */ });
it("a failure arriving after the deadline is labelled as the hard timeout", async () => {
  s.scrapeFullOffer.mockReturnValueOnce(new Promise((res) => setTimeout(() => res({ success: false, bookmaker: "forbet",
    league: "premier-league", matches: [], error: "page.goto: Target page, context or browser has been closed" }), 121_000)));
  const p = scrapeWithHardDeadline(s, JOB); await vi.advanceTimersByTimeAsync(121_000);
  expect((await p).error).toBe("hard timeout after 120s | page.goto: Target page, context or browser has been closed");
});
it("rethrows; uses the run signal as the budget's parent", async () => {
  s.scrapeFullOffer.mockRejectedValueOnce(new Error("boom")); await expect(scrapeWithHardDeadline(s, JOB)).rejects.toThrow("boom");
  const createBudget = vi.fn((ms: number) => fakeBudget(Date.now() + ms)); const run = new AbortController();
  await scrapeWithHardDeadline(s, JOB, run.signal, { createBudget }); expect(createBudget).toHaveBeenCalledWith(120_000, run.signal);
});

// playwright-base-abort.test.ts: AbortTestScraper extends PlaywrightScraper (abstract members stubbed); initBrowser() returns
// { page: {}, browser: {}, context: { close }, cleanup }; close() rejects the pending op with
// new Error("Target page, context or browser has been closed"); run(op) = this.executeWithBrowser(op, (e) => ({ error: (e as Error).message }))
it("closes the context when the job budget aborts mid-scrape", async () => {
  const b = fakeBudget(Date.now() + 240_000);
  const p = runInScrapeJob({ ...JOB, transport: "browser", budget: b }, () => s.run(() => new Promise((_, rej) => (s.rejectPending = rej))));
  b.controller.abort(new Error("deadline"));
  expect(await p).toEqual({ error: "Target page, context or browser has been closed" });
  expect(s.context.close).toHaveBeenCalledTimes(1); expect(s.cleanup).toHaveBeenCalledTimes(1);
});
it("an already-aborted budget closes right after acquisition; a finished scrape detaches the listener; no job context = nothing attached", async () => {
  /* three cases: close called once / close not called by a later abort / close never called outside runInScrapeJob */
});

// aggregator-deadline.test.ts: the hoisted-fakes pattern of aggregator-db-down.test.ts:16-60, with the export map built in one line:
//   const { scrapers, save } = vi.hoisted(() => { const BMS = ["sts", …, "pzbuk"];   // the 14 names
//     return { scrapers: Object.fromEntries(BMS.map((bm) => [bm, { bookmaker: bm, scrapeFullOffer: vi.fn(), cleanup: vi.fn(async () => {}) }])), save: vi.fn() }; });
//   vi.mock("../bookmakers/index.js", async () => Object.fromEntries(Object.entries(scrapers).map(([bm, s]) => [`${bm}Scraper`, s])));
//   vi.mock("../../services/scrape-helpers.js", async () => ({ normalizeAndSaveMatches: save })); fake timers
it("a never-resolving bookmaker is scrape_failed 'hard timeout after 120s' while the other saves", async () => {
  scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {}));
  scrapers.betclic.scrapeFullOffer.mockResolvedValueOnce(okResult("betclic", twentyMatches()));
  save.mockResolvedValueOnce({ matchesProcessed: 20, marketsNormalized: 3150, marketsSaved: 3150, errors: [] });
  const p = runAllFullOfferScrapers("premier-league", ["betclic", "forbet"]); await vi.advanceTimersByTimeAsync(125_000);
  expect((await p).outcomes.map((o) => [o.bookmaker, o.status, o.error]))
    .toEqual([["betclic", "success", null], ["forbet", "scrape_failed", "hard timeout after 120s"]]);
});
it("a result that arrives after the hard timeout is never normalized or saved (Review Focus 1)", async () => {
  scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(new Promise((res) => setTimeout(() => res(okResult("forbet", twentyMatches())), 130_000)));
  const p = runAllFullOfferScrapers("premier-league", ["forbet"]); await vi.advanceTimersByTimeAsync(130_000); await p;
  expect(save).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/scrapers/__tests__/job-policy.test.ts src/scrapers/__tests__/hard-deadline.test.ts src/scrapers/base/__tests__/playwright-base-abort.test.ts src/scrapers/__tests__/aggregator-deadline.test.ts src/scrapers/shared/betby/__tests__/scraper.test.ts`. Expected: FAIL (modules missing; the aggregator test hangs to its timeout). The betby guard already passes (it pins behaviour).
- [ ] **Step 3: Implement** the four modules, the declarations and the two edits. Delete `SCRAPER_TIMEOUT_MS`.
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy npx vitest run` (`aggregator-outcomes.test.ts`, `aggregator-db-down.test.ts`, `navigation-diagnostics.test.ts`, totalbet and betcris tests unchanged) and `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```bash
git add src/scrapers/job-budgets.ts src/scrapers/job-policy.ts src/scrapers/shared/job-context.ts src/scrapers/hard-deadline.ts src/scrapers/aggregator.ts src/scrapers/base/playwright-base.ts src/scrapers/bookmakers/totalbet/index.ts src/scrapers/shared/betby/scraper.ts src/scrapers/bookmakers/betclic/index.ts src/config/index.ts .env.example src/__tests__/helpers/run-fixtures.ts src/scrapers/__tests__/job-policy.test.ts src/scrapers/__tests__/hard-deadline.test.ts src/scrapers/base/__tests__/playwright-base-abort.test.ts src/scrapers/__tests__/aggregator-deadline.test.ts src/scrapers/shared/betby/__tests__/scraper.test.ts
git commit -m "feat(scrapers): per-job ScrapeBudget and hard deadline, transport from the instance, browser budgets for sts/betcris/pzbuk"
```

---

### Task 3: Bookmaker-major cycle with global caps

**Files:**
- Create: `src/scrapers/job-scheduler.ts`
- Modify: `src/scrapers/aggregator.ts` (`runFullOfferForBookmaker` stays the unit; its cleanup block `:300-307` moves verbatim into the job wrapper; new `runFullOfferCycle`; `runAllFullOfferScrapers` becomes the one-league cycle); `src/scrapers/job-policy.ts` (caps, order); `src/services/scraper-service.ts` (`runScrapeAndPersist` body → `runScrapeCycle` + `persistLeagueRun` + wrapper); `src/services/scheduler-service.ts:38-92` (body → `runScrapeCycle`; delete the `closeAllBrowsers` block `:65-71` and import `:10`).
- Test: create `src/scrapers/__tests__/job-scheduler.test.ts`, `src/scrapers/__tests__/aggregator-cycle.test.ts`, `src/services/__tests__/scrape-cycle.test.ts`; rebase `scheduler-runs.test.ts` (Task 1), `scheduler-service.test.ts:14, :80-97, :150-161`, `scraper-service.test.ts:18-21`.

**Interfaces:**
- Consumes: §3 `mapLimit`; Task 2 `resolveJobTransport`, `maxDurationMsFor`, `scrapeWithHardDeadline`; observability `classifyBookmakerRun`, `runFullOfferForBookmaker`, steps 1–9 of `runScrapeAndPersist`; `isLeagueSupported(slug, bookmaker)` (`src/config/leagues.ts:178-181`).
- Produces:
  ```ts
  // job-scheduler.ts
  export interface JobCaps { browserLimit: number; browserStaggerMs: number; otherLimit: number }
  export interface CappedJob<T> { key: string; browser: boolean; run(queueMs: number): Promise<T> }
  export function runJobsWithCaps<T>(jobs: readonly CappedJob<T>[], caps: JobCaps, signal?: AbortSignal): Promise<PromiseSettledResult<T>[]>;
  //   two independent mapLimit pools; browser starts >= browserStaggerMs apart; results in input order;
  //   a job not started when signal aborts never starts (rejected with signal.reason)
  // job-policy.ts
  export const DEFAULT_JOB_CAPS: JobCaps = { browserLimit: 3, browserStaggerMs: 1_500, otherLimit: 12 };
  export function orderBrowserJobs(bookmakers: readonly PolishBookmaker[]): PolishBookmaker[]; // descending maxDurationMsFor(bm, "browser"), ties in input order
  // aggregator.ts
  export interface FullOfferCycleRequest { leagues: readonly string[]; bookmakers?: readonly PolishBookmaker[];
    runIds?: Readonly<Record<string, string>>; signal?: AbortSignal; caps?: JobCaps }
  export function runFullOfferCycle(req: FullOfferCycleRequest): Promise<Map<string, FullOfferAggregatedResult>>; // key order = req.leagues
  //   runAllFullOfferScrapers(league, bookmakers, opts) = the one-league cycle (same signature as Task 1)
  // scraper-service.ts
  export interface ScrapeCycleOptions { dbWaitMs?: number; runIds?: Readonly<Record<string, string>>; signal?: AbortSignal; closeBrowsers?: boolean }
  export function runScrapeCycle(leagues: readonly string[], bookmakers?: readonly PolishBookmaker[], options?: ScrapeCycleOptions): Promise<Map<string, ScrapeResult>>;
  //   runScrapeAndPersist(league, bookmakers, closeBrowsers, options) = (await runScrapeCycle([league], …)).get(league)!
  ```
- Cycle rules:
  - **Units only where supported:** a bookmaker's job walks `req.leagues.filter((l) => isLeagueSupported(l, bm))`; a bookmaker with none gets no job and no outcome (betters/lebull have no `world-cup-2026` entry). A league's `Starting run … with N bookmakers` counts only its supported bookmakers.
  - **Per league:** its own run id, `Starting run` line, completion line and result; `startedAt` / `completedAt` are the cycle's.
  - **Jobs:** one per bookmaker, `browser = transport === "browser"`, walking its leagues in order. Each unit is observability's `runFullOfferForBookmaker` plus the Task 2 deadline. `scraper.cleanup()` runs once per job, after its last league, with the unchanged `cleanup failed:` line and outcome-keeping behaviour (`aggregator-outcomes.test.ts:301-318` stays green: one league = one cleanup).
  - **Order:** browser jobs are queued by `orderBrowserJobs` (betcris and pzbuk 600 s, then sts 360 s, then input order), so the three long jobs start at t = 0 / 1.5 / 3 s; outcomes keep `targetBookmakers` order.
  - **`runScrapeCycle`:** observability steps 1–3 once (`scraper-service.ts:54-81`); a refused preflight gives, per league, one `formatAbortAlert` line through `emitAlerts`, `scraperHealth.recordAbort(league, …)` (per league since Task 1) and an aborted result whose `runId` is that league's run id — no cycle. Step 4 = `runFullOfferCycle`; steps 5–8 per league in league order (`persistLeagueRun`, the code at `:112-151`); step 9 once (`:153-161`).
- Scheduling estimate on the future base (10 browser jobs, 3 lanes, solo durations from README §1.1 and pzbuk.md A8): betcris (≈ 100 s), pzbuk (≈ 330 s) and sts (≈ 97–120 s) start at 0–3 s; the seven short browser jobs (6.5–17 s each) follow on the two lanes freed at ≈ 100–120 s and end by ≈ 160 s; the four http jobs run at once. The cycle ≈ pzbuk's ≈ 330 s until 05c, as today (all 14 in parallel today also wait for pzbuk), with ≤ 3 Chromium instances instead of 10.
- Own-test rebase: Task 1's `scheduler-runs.test.ts` now mocks `runScrapeCycle` too. Its calls become `runScrapeCycle(["premier-league"], ["forbet"], expect.objectContaining({ runIds: r.run.runIds, signal: expect.any(AbortSignal) }))`, and its browser assertion becomes "`closeAllBrowsers` is never called by the scheduler" (the cycle closes).
- Observability rebases: `scraper-service.test.ts:18-21` adds `runFullOfferCycle: vi.fn(async (req) => new Map([[req.leagues[0], await m.runAllFullOfferScrapers(req.leagues[0], req.bookmakers)]]))` (hoisted `m`), no assertion changes. `scheduler-service.test.ts:14` adds `runScrapeCycle: m.runScrapeCycle` (resolving `new Map([["premier-league", scrapeResult()]])`); `:81-84` → `expect(m.runScrapeCycle).toHaveBeenCalledWith(["premier-league"], undefined, expect.objectContaining({ dbWaitMs: 120_000 }))`; `:86-89` → `m.runScrapeCycle.mock.calls[0][2]?.dbWaitMs` undefined; `:91-96` → the cycle mock returns the aborted result; `:154-161` → `runScrapeCycle(["premier-league"], undefined, expect.objectContaining({ dbWaitMs: 120_000 }))`.

- [ ] **Step 1: Write the failing tests**

```ts
// job-scheduler.test.ts (fake timers; job(key, browser) records [key, Date.now() - T0, queueMs] and awaits gates[key])
it("browser jobs: <= 3 at once, starts >= 1.5 s apart, a freed slot refills", async () => {
  void runJobsWithCaps(["b1", "b2", "b3", "b4", "b5"].map((k) => job(k, true)), DEFAULT_JOB_CAPS);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(started).toEqual([["b1", 0, 0], ["b2", 1_500, 1_500], ["b3", 3_000, 3_000]]);
  gates.b1.resolve(); await vi.advanceTimersByTimeAsync(0);
  expect(started[3]).toEqual(["b4", 10_000, 10_000]);
});
it("non-browser: 12 at once, unstaggered, independent of the browser pool", async () => { /* 3 browser + 14 http: h1..h12 at 0, h13/h14 wait; b1..b3 at 0/1500/3000 */ });
it("results keep input order; a queued job never starts after the signal aborts", async () => {
  /* 4 browser jobs, abort at 500 ms: started keys ["b1"]; results[1..3] rejected with the abort reason */ });
it("orderBrowserJobs puts the longest budgets first", () =>
  expect(orderBrowserJobs(["fortuna", "sts", "betcris", "superbet", "pzbuk"])).toEqual(["betcris", "pzbuk", "sts", "fortuna", "superbet"]));

// aggregator-cycle.test.ts (hoisted fakes as aggregator-deadline.test.ts; ID_PL / ID_LL fixed uuids; real isLeagueSupported)
it("one job per bookmaker walks the leagues sequentially; cleanup once per job", async () => {
  const pl = deferred<FullOfferScraperResult>();
  scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(pl.promise).mockResolvedValueOnce(okResult("forbet", twentyMatches(), "laliga"));
  const p = runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["forbet"] });
  await vi.advanceTimersByTimeAsync(0);
  expect(scrapers.forbet.scrapeFullOffer.mock.calls.map((c) => c[0])).toEqual(["premier-league"]);
  pl.resolve(okResult("forbet", twentyMatches())); await p;
  expect(scrapers.forbet.scrapeFullOffer.mock.calls.map((c) => c[0])).toEqual(["premier-league", "laliga"]);
  expect(scrapers.forbet.cleanup).toHaveBeenCalledTimes(1);
});
it("different bookmakers run concurrently", async () => { /* betclic and forbet both called before either resolves */ });
it("keeps observability's per-league shape, run ids and Starting lines", async () => {
  const r = await runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["betclic", "forbet"], runIds: { "premier-league": ID_PL, laliga: ID_LL } });
  expect([...r.keys()]).toEqual(["premier-league", "laliga"]);
  expect(r.get("laliga")!.outcomes.map((o) => [o.bookmaker, o.runId, o.league])).toEqual([["betclic", ID_LL, "laliga"], ["forbet", ID_LL, "laliga"]]);
  expect(logSpy.mock.calls.flat()).toContain(`[Aggregator/FullOffer] Starting run ${ID_LL} for laliga with 2 bookmakers`);
});
it("builds units only where the league is supported", async () => {
  const r = await runFullOfferCycle({ leagues: ["premier-league", "world-cup-2026"], bookmakers: ["betters", "forbet"] });
  expect(scrapers.betters.scrapeFullOffer.mock.calls.map((c) => c[0])).toEqual(["premier-league"]);
  expect(r.get("world-cup-2026")!.outcomes.map((o) => o.bookmaker)).toEqual(["forbet"]);
  expect(logSpy.mock.calls.flat().join("\n")).toMatch(/Starting run \S+ for world-cup-2026 with 1 bookmakers/);
});
it("a hard timeout in the first league does not stop the job's second league (Review Focus 1)", async () => {
  scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(okResult("forbet", twentyMatches(), "laliga"));
  save.mockResolvedValue({ matchesProcessed: 20, marketsNormalized: 5869, marketsSaved: 5869, errors: [] });
  const p = runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["forbet"] }); await vi.advanceTimersByTimeAsync(125_000);
  const r = await p;
  expect(r.get("premier-league")!.outcomes[0]).toMatchObject({ status: "scrape_failed", error: "hard timeout after 120s" });
  expect(r.get("laliga")!.outcomes[0]).toMatchObject({ status: "success", marketsSaved: 5869 });
});

// scrape-cycle.test.ts: mocks as scraper-service.test.ts:8-33 plus runFullOfferCycle; outcome()/RUN_ID from run-fixtures;
// a local aggregatedFor(league, outcomes) = the scraper-service.test.ts:46-71 builder with the league as a parameter.
it("probes once for two leagues and persists per league", async () => {
  runFullOfferCycle.mockResolvedValue(new Map([["premier-league", aggregatedFor("premier-league", [outcome({ bookmaker: "betclic", marketsSaved: 3150 })])],
    ["laliga", aggregatedFor("laliga", [outcome({ runId: ID_LL, league: "laliga", bookmaker: "betclic", marketsSaved: 2000 })])]]));
  const r = await runScrapeCycle(["premier-league", "laliga"]);
  expect([probeDatabase.mock.calls.length, ensureMarketTypesSynced.mock.calls.length, insertBookmakerRunOutcomes.mock.calls.length]).toEqual([1, 1, 2]);
  expect(logSpy.mock.calls.filter(([l]) => String(l).startsWith("[ScrapeRun]"))).toHaveLength(2);
  expect([...r.keys()]).toEqual(["premier-league", "laliga"]); expect(closeAllBrowsers).toHaveBeenCalledTimes(1);
});
it("an unreachable database aborts every league before any scraper starts, with per-league ids and records", async () => {
  probeDatabase.mockResolvedValue({ ok: false, error: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)" });
  const r = await runScrapeCycle(["premier-league", "laliga"], undefined, { runIds: { "premier-league": ID_PL, laliga: ID_LL } });
  expect(runFullOfferCycle).not.toHaveBeenCalled();
  expect([...r.values()].map((x) => [x.aborted, x.runId])).toEqual([["db_unreachable", ID_PL], ["db_unreachable", ID_LL]]);
  expect(errorSpy.mock.calls.flat().filter((l) => String(l).startsWith("[ALERT] scrape run ABORTED"))).toHaveLength(2);
  expect([scraperHealth.getLastAbort("premier-league")?.league, scraperHealth.getLastAbort("laliga")?.league]).toEqual(["premier-league", "laliga"]);
});
it("runScrapeAndPersist(league) is the one-league cycle with the given run id", async () => {
  await runScrapeAndPersist("premier-league", ["forbet"], true, { runId: ID_PL });
  expect(runFullOfferCycle).toHaveBeenCalledWith(expect.objectContaining({ leagues: ["premier-league"], bookmakers: ["forbet"], runIds: { "premier-league": ID_PL } }));
});
```

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/scrapers/__tests__/job-scheduler.test.ts src/scrapers/__tests__/aggregator-cycle.test.ts src/services/__tests__/scrape-cycle.test.ts`. Expected: FAIL (`runJobsWithCaps`, `orderBrowserJobs`, `runFullOfferCycle`, `runScrapeCycle` undefined).
- [ ] **Step 3: Implement.** `runJobsWithCaps` checks `signal.aborted` before calling `job.run` (independent of `mapLimit`'s own handling). Stagger gate: `wait = max(0, nextBrowserAt - now); nextBrowserAt = max(now, nextBrowserAt) + browserStaggerMs`. Apply the rebases above.
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy npx vitest run` (`aggregator-outcomes.test.ts` and `aggregator-db-down.test.ts` unchanged) and `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```bash
git add src/scrapers/job-scheduler.ts src/scrapers/job-policy.ts src/scrapers/aggregator.ts src/services/scraper-service.ts src/services/scheduler-service.ts src/scrapers/__tests__/job-scheduler.test.ts src/scrapers/__tests__/aggregator-cycle.test.ts src/services/__tests__/scrape-cycle.test.ts src/services/__tests__/scheduler-runs.test.ts src/services/__tests__/scraper-service.test.ts src/services/__tests__/scheduler-service.test.ts
git commit -m "feat(scrapers): bookmaker-major jobs across supported leagues with global browser/http caps"
```

---

### Task 4: Interval scheduler replacing the `*/N` cron; run guard for persisting smokes

**Files:**
- Create: `src/services/interval-scheduler.ts`, `src/services/run-guard.ts`
- Modify: `src/config/index.ts:40-43`, `:82-90`; `.env.example:16` (comment); `src/services/scheduler-service.ts:28` (`scrapeTask` → `intervalScheduler`), `startScheduler :141-212` (log `:147-149`, cron `:153-180`), `stopScheduler :251-265`, `getSchedulerStatus :270-299`; `src/services/odds-service.ts:174-181`; `src/routes/health.ts:51-61`; `src/types/api.ts:44-54`; `scripts/smoke-bookmaker.ts` (`:14-18`, `main :169-192`).
- Test: create `src/config/__tests__/scrape-settings.test.ts`, `src/services/__tests__/interval-scheduler.test.ts`, `src/services/__tests__/run-guard.test.ts`.

**Interfaces:**
- Consumes: Task 1 `RunCoordinator.start` / `whenIdle` / `current`, `RunRequest`.
- Produces:
  ```ts
  // config/index.ts — CONFIG.SCRAPE_INTERVAL_MINUTES = Number(process.env.SCRAPE_INTERVAL_MINUTES ?? "30"); CONFIG.SCRAPE_CRON deleted
  export function assertScrapeIntervalMinutes(raw: string | undefined): number;
  //   undefined -> 30; /^\d+$/ and 1..1440 -> Number(raw); else throws Error(`Invalid SCRAPE_INTERVAL_MINUTES "${raw}": expected an integer 1-1440`)
  //   called by validateConfig() (index.ts:17-22 already exits 1 on a throw)
  // interval-scheduler.ts
  export const INTERVAL_JITTER_RATIO = 0.1;
  export function computeNextDelayMs(a: { lastStartedAt: number; now: number; intervalMs: number; random: number; jitterRatio?: number }): number;
  //   max(min(60_000, intervalMs / 2), lastStartedAt + intervalMs + (random * 2 - 1) * jitterRatio * intervalMs - now)
  export interface IntervalSchedulerOptions { intervalMs: number; coordinator: Pick<RunCoordinator, "start" | "whenIdle">;
    request: (trigger: "startup" | "interval") => RunRequest; random?: () => number }
  export class IntervalScheduler {
    constructor(o: IntervalSchedulerOptions);
    start(firstDelayMs: number, firstTrigger?: "startup" | "interval"): void;   // default "interval"
    stop(): void;
    nextRunAt(): Date | null;   // pending tick; null while a run is in progress or after stop()
  }
  export function getPlannedNextRun(): Date | null;   // nextRunAt() of the most recently started scheduler
  // types/api.ts HealthCheckData gains: nextScrapeAt: string | null; currentRun: { runId: string; trigger: string; startedAt: string } | null
  // run-guard.ts
  export type CurrentRunProbe =
    | { state: "idle"; nextScrapeAt: string | null }
    | { state: "running"; run: { runId: string; trigger: string; startedAt: string } }
    | { state: "due"; nextScrapeAt: string }               // the next run starts within 300 000 ms
    | { state: "unreachable"; error: string };            // no server answered: nothing can be running in it
  export function probeCurrentRun(healthUrl: string, deps?: { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number }): Promise<CurrentRunProbe>; // never throws; timeout 2 000
  ```
- Tick: `start(request(trigger))`; while refused, log `[Scheduler] ${trigger} run waits for run ${id8} (${running.trigger})`, `await whenIdle()` and retry (a tick never overlaps a run); `await run.done`; unless stopped, schedule `computeNextDelayMs({ lastStartedAt: run.startedAt, now, intervalMs, random })` and log `[Scheduler] next run at ${iso}`. node-cron stays only for 03:00 and 04:00. The start log `:147-149` becomes `[Scheduler] Starting interval loop: every ${N} minutes (±10 %)`.
- `getSchedulerStatus()`: `isScheduled = intervalScheduler !== null`, `nextRun = intervalScheduler?.nextRunAt() ?? null`, additive `currentRun`. `getNextUpdateTime()` = `(getPlannedNextRun() ?? new Date(Date.now() + intervalMs)).toISOString()`; same shape (the frontend only declares the field).
- **Persisting smokes** (`scripts/smoke-bookmaker.ts --persist` calls `runScrapeAndPersist` in its own process, outside the coordinator): before `persistRun`, `probeCurrentRun(process.env.SMOKE_HEALTH_URL ?? \`http://localhost:${CONFIG.PORT}/api/health\`)`. `running` → stderr `Refusing --persist: scrape run ${id8} (${trigger}) in progress since ${startedAt}`; `due` → `Refusing --persist: next scheduled run at ${nextScrapeAt} (within 5 min)`; both exit **4**. `unreachable` → stderr `smoke-bookmaker: no server at ${url} (${error}); no scheduled run can overlap` and continue; `idle` → continue. The header (`:14-18`) gains `4  --persist refused: a scrape run is in progress or due within 5 min`. Dry mode is unchanged.
- Until Task 5, Task 1's startup `setTimeout` stays and `start(intervalMs)` schedules the first interval run.

- [ ] **Step 1: Write the failing tests**

```ts
// scrape-settings.test.ts
it.each([["1", 1], ["60", 60], ["1440", 1440], [undefined, 30]])("accepts %j", (raw, n) => expect(assertScrapeIntervalMinutes(raw)).toBe(n));
it.each(["0", "1441", "45abc", "abc", "", "-5", "7.5"])("rejects %j (Review Focus 5)", (raw) =>
  expect(() => assertScrapeIntervalMinutes(raw)).toThrow(`Invalid SCRAPE_INTERVAL_MINUTES "${raw}": expected an integer 1-1440`));

// interval-scheduler.test.ts (fake timers; real RunCoordinator whose executor records Date.now() and resolves after 120 s)
const H = 3_600_000;
it("next start = last start + interval ± 10 %; an overrun waits min(60 s, interval / 2)", () => {
  const a = { lastStartedAt: 0, now: 120_000, intervalMs: H };
  expect([0.5, 0, 1].map((random) => computeNextDelayMs({ ...a, random }))).toEqual([H - 120_000, 0.9 * H - 120_000, 1.1 * H - 120_000]);
  expect(computeNextDelayMs({ lastStartedAt: 0, now: 180_000, intervalMs: 60_000, random: 0.5 })).toBe(30_000);
  expect(computeNextDelayMs({ lastStartedAt: 0, now: 2 * H, intervalMs: H, random: 0.5 })).toBe(60_000);
});
it.each([[45, 2_700_000], [90, 5_400_000], [120, 7_200_000]])("SCRAPE_INTERVAL_MINUTES=%i starts runs %i ms apart (cron: */45 -> :00,:45; */90, */120 -> hourly) (Review Focus 5)", async (min, gap) => {
  const s = new IntervalScheduler({ intervalMs: min * 60_000, coordinator, request, random: () => 0.5 });
  s.start(5_000); await vi.advanceTimersByTimeAsync(5_000 + 3 * gap);
  expect(diffs(startTimes)).toEqual([gap, gap, gap]);
});
it("waits for a running admin run instead of overlapping, then starts", async () => {
  const admin = deferred<void>(); /* the first executor call (admin) awaits admin.promise */
  coordinator.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] });
  s.start(5_000); await vi.advanceTimersByTimeAsync(600_000); expect(exec).toHaveBeenCalledTimes(1);
  admin.resolve(); await vi.advanceTimersByTimeAsync(0);
  expect(exec.mock.calls.map(([req]) => req.trigger)).toEqual(["admin", "interval"]); expect(maxConcurrent).toBe(1);
});
it("nextRunAt is the pending tick and null while running; stop() cancels; firstTrigger is used once", async () => {
  s.start(5_000, "startup"); expect(s.nextRunAt()!.getTime()).toBe(T0 + 5_000);
  await vi.advanceTimersByTimeAsync(5_000); expect(s.nextRunAt()).toBeNull();
  await vi.advanceTimersByTimeAsync(120_000); expect(s.nextRunAt()!.getTime()).toBe(T0 + 5_000 + H);
  await vi.advanceTimersByTimeAsync(H); expect(exec.mock.calls.map(([req]) => req.trigger)).toEqual(["startup", "interval"]);
  s.stop(); await vi.advanceTimersByTimeAsync(2 * H); expect(exec).toHaveBeenCalledTimes(2);
});

// run-guard.test.ts (fake fetch returning the /api/health envelope { success: true, data: {...} })
const NOW = Date.parse("2026-11-07T10:00:00.000Z");
it("running when /api/health reports currentRun", async () => {
  expect(await probeCurrentRun(URL, { fetchImpl: health({ currentRun: { runId: "440d2fc6-658b-46fe-b288-05261faa0caf", trigger: "interval", startedAt: "2026-11-07T09:59:00.000Z" }, nextScrapeAt: null }), now: () => NOW }))
    .toEqual({ state: "running", run: { runId: "440d2fc6-658b-46fe-b288-05261faa0caf", trigger: "interval", startedAt: "2026-11-07T09:59:00.000Z" } });
});
it("due within 5 min, idle otherwise", async () => {
  expect((await probeCurrentRun(URL, { fetchImpl: health({ currentRun: null, nextScrapeAt: "2026-11-07T10:04:59.000Z" }), now: () => NOW })).state).toBe("due");
  expect((await probeCurrentRun(URL, { fetchImpl: health({ currentRun: null, nextScrapeAt: "2026-11-07T10:05:01.000Z" }), now: () => NOW })).state).toBe("idle");
});
it("unreachable on a network error or a non-200, never throws", async () => {
  expect(await probeCurrentRun(URL, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")) })).toEqual({ state: "unreachable", error: "fetch failed" });
  expect((await probeCurrentRun(URL, { fetchImpl: vi.fn().mockResolvedValue(new Response("x", { status: 503 })) })).state).toBe("unreachable");
});
```

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/config/__tests__/scrape-settings.test.ts src/services/__tests__/interval-scheduler.test.ts src/services/__tests__/run-guard.test.ts`. Expected: FAIL (missing exports and modules).
- [ ] **Step 3: Implement** as specified. The tick timer stays referenced, like the cron it replaces; only Task 7's sampler timers are `.unref()`'d.
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy npx vitest run`, `heavy npx tsc --noEmit` (no reader of `CONFIG.SCRAPE_CRON` remains) and the standalone `tsc` on `scripts/smoke-bookmaker.ts`; `heavy npx tsx scripts/smoke-bookmaker.ts; echo $?` still prints the usage line and `2`.
- [ ] **Step 5: Commit**
```bash
git add src/services/interval-scheduler.ts src/services/run-guard.ts scripts/smoke-bookmaker.ts src/config/index.ts .env.example src/services/scheduler-service.ts src/services/odds-service.ts src/routes/health.ts src/types/api.ts src/config/__tests__/scrape-settings.test.ts src/services/__tests__/interval-scheduler.test.ts src/services/__tests__/run-guard.test.ts
git commit -m "feat(scheduler): interval loop (last start + interval +-10%) replaces */N cron; persisting smokes refuse during a run"
```

---

### Task 5: `STARTUP_SCRAPE` policy, graceful shutdown, `unhandledRejection`

**Files:**
- Create: `src/services/startup-policy.ts`, `src/services/shutdown.ts`
- Modify: `src/config/index.ts` (after `:39`, `validateConfig`), `.env.example` (after `:19`); `src/services/scheduler-service.ts:196-211`; `src/scrapers/hard-deadline.ts`, `src/scrapers/aggregator.ts`, `src/services/scraper-service.ts`; `src/config/database.ts:46-60`; `src/services/run-alerts.ts:95-110`; `src/index.ts:70-78`, `:114`.
- Test: create `src/services/__tests__/startup-policy.test.ts`, `src/services/__tests__/shutdown.test.ts`; extend `aggregator-cycle.test.ts`, `scrape-cycle.test.ts`, `scrape-settings.test.ts`, `scheduler-runs.test.ts`, `run-alerts.test.ts`; rebase `scheduler-service.test.ts:150-161`.

**Interfaces:**
- Consumes: observability `getLastSuccessfulScrapeTime(league)` (`scraper-run-repository.ts:342-…`, null on a DB error), `getOddsFreshnessByBookmaker(league, bms)` (`odds-repository.ts:145-157`); Tasks 1–4.
- Produces:
  ```ts
  // config/index.ts — CONFIG.STARTUP_SCRAPE = (process.env.STARTUP_SCRAPE ?? "auto") as StartupScrapePolicy
  export type StartupScrapePolicy = "auto" | "always" | "never";
  export function assertStartupScrape(raw: string | undefined): StartupScrapePolicy; // throws `Invalid STARTUP_SCRAPE "${raw}": expected auto|always|never`
  // startup-policy.ts
  export const STARTUP_DELAY_MS = 5_000;
  export interface StartupDecision { firstTrigger: "startup" | "interval"; firstDelayMs: number; reason: string }
  export function decideStartupScrape(policy: StartupScrapePolicy, stalestOkRunAt: Date | null, now: Date, intervalMs: number): StartupDecision;
  export function getLastOkRunAt(league: string): Promise<Date | null>;  // scraper_runs first, else the newest odds row; errors -> null
  export function getStalestOkRunAt(leagues: readonly string[]): Promise<Date | null>; // any unknown league -> null, else the oldest
  // hard-deadline.ts
  export class RunInterruptedError extends Error {}  // message = the run signal reason's message; thrown only while scraping
  // aggregator.ts: FullOfferAggregatedResult gains interrupted: string | null; outcomes then hold only finished units
  // scraper-service.ts: ScrapeResult gains interrupted: string | null (additive)
  // config/database.ts
  export function waitForDatabase(timeoutMs: number, intervalMs?: number, signal?: AbortSignal): Promise<DbProbe>; // the sleep between probes ends on abort; the loop stops
  // run-alerts.ts
  export function emitAlerts(lines: string[], webhookUrl: string | null, signal?: AbortSignal): Promise<void>;
  //   stderr first (unchanged); webhook signal = signal ? AbortSignal.any([AbortSignal.timeout(5000), signal]) : AbortSignal.timeout(5000)
  // shutdown.ts
  export const SHUTDOWN_BUDGET_MS = { drain: 3_000, browsers: 1_500, hardExit: 10_000 } as const;
  export interface ShutdownDeps { stopScheduler(): void; coordinator: Pick<RunCoordinator, "abort" | "drain">;
    closeBrowsers(): Promise<void>; closeServer(): void; exit(code: number): void }
  export function createShutdown(deps: ShutdownDeps): (signal: NodeJS.Signals) => Promise<void>;
  export function installProcessHandlers(proc: Pick<NodeJS.Process, "on">, shutdown: (signal: NodeJS.Signals) => Promise<void>): void;
  ```
- Decision reasons (exact): `STARTUP_SCRAPE=never` → interval after the full interval; `STARTUP_SCRAPE=always` → startup after 5 000; `auto: no OK run on record` → startup after 5 000; `` `auto: last OK run ${m} min ago >= ${I} min` `` → startup after 5 000; `` `auto: last OK run ${m} min ago < ${I} min` `` → interval after `max(5_000, interval - age)`.
- `startScheduler`: `decideStartupScrape(CONFIG.STARTUP_SCRAPE, await getStalestOkRunAt(CONFIG.ENABLED_LEAGUES), new Date(), intervalMs)`, log `` `[Scheduler] Startup scrape ${firstTrigger === "startup" ? "in 5s" : "skipped"} (${reason}); first run at ${iso}` ``, then `intervalScheduler.start(firstDelayMs, firstTrigger)` (replaces Task 1's `setTimeout` at `:197-211`). A startup-trigger run waits `STARTUP_DB_WAIT_MS` for the DB (Task 1 executor).
- Interruption:
  - `scrapeWithHardDeadline` rejects `RunInterruptedError` the moment `runSignal` aborts (no grace).
  - The job wrapper maps it to "no outcome", checked **before** observability's generic catch (`aggregator.ts:280-283`). A unit already in `normalizeAndSaveMatches` finishes and keeps its outcome. No new league or queued job starts after the abort.
  - The completion line becomes `` `[Aggregator/FullOffer] Run ${runId} interrupted after ${ms}ms (${reason}): ${k} of ${n} bookmakers finished` ``.
  - `runScrapeCycle`, per interrupted league: `recordOutcome` each finished unit; `insertBookmakerRunOutcomes(finished)` when `k > 0` (failure → the protected `scraper_runs not persisted:` line); log `` `[ScraperService] ${league} run ${id8} interrupted (${reason}): persisted ${k} of ${n} outcomes` ``; no `[ScrapeRun]`, no alerts; browsers closed as usual.
  - **Preflight:** `runScrapeCycle` passes the run signal to the DB wait only when it has one (`signal ? waitForDatabase(ms, 5_000, signal) : waitForDatabase(ms)`, so `scraper-service.test.ts:192-196` and `scheduler-service.test.ts:103, :168` stay unchanged). If `signal.aborted` after the preflight, every league returns `interrupted: <reason>` with no ABORTED alert, no `recordAbort`, no `[ScrapeRun]`. `runInitialTsdbSync` (`scheduler-service.ts:120-136`) also waits ≤ 120 s without a signal, but outside the coordinator: shutdown never waits for it.
  - **Alerts:** step 8 passes the run signal to `emitAlerts`, so a SIGTERM during the webhook POST (≤ 5 s) ends it at once; the lines are already on stderr.
- Shutdown: (1) a second signal → `exit(1)` at once; (2) log `` `[Server] Received ${signal}, shutting down` `` and arm the `hardExit` timer (`exit(1)`, unref); (3) `stopScheduler()`, `coordinator.abort(`shutdown: ${signal}`)`; (4) `await coordinator.drain(3_000)`; (5) race `closeBrowsers()` against 1 500 ms; (6) `closeServer()`; (7) log `` `[Server] Shutdown complete in ${ms}ms` ``, `exit(0)`.
- `unhandledRejection` → `` console.error(`[Process] Unhandled rejection (kept running): ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`) ``; no exit.
- `index.ts:70-78` → `installProcessHandlers(process, createShutdown({ stopScheduler, coordinator: runCoordinator, closeBrowsers: closeAllBrowsers, closeServer: () => server?.close(), exit: (c) => process.exit(c) }))`; `:114` keeps `server = app.listen(...)`.

- [ ] **Step 1: Write the failing tests**

```ts
// startup-policy.test.ts
const NOW = new Date("2026-11-07T10:00:00.000Z"); const H = 3_600_000;
it("auto: fresh -> resume the cadence; stale -> scrape in 5 s; due within 5 s -> clamped", () => {
  expect(decideStartupScrape("auto", new Date("2026-11-07T09:40:00.000Z"), NOW, H))
    .toEqual({ firstTrigger: "interval", firstDelayMs: 2_400_000, reason: "auto: last OK run 20 min ago < 60 min" });
  expect(decideStartupScrape("auto", new Date("2026-11-07T08:45:00.000Z"), NOW, H))
    .toEqual({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "auto: last OK run 75 min ago >= 60 min" });
  expect(decideStartupScrape("auto", new Date("2026-11-07T09:00:01.000Z"), NOW, H)).toMatchObject({ firstTrigger: "interval", firstDelayMs: 5_000 });
});
it("auto: unknown freshness scrapes (Review Focus 4); always / never", () => {
  expect(decideStartupScrape("auto", null, NOW, H)).toEqual({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "auto: no OK run on record" });
  expect(decideStartupScrape("always", NOW, NOW, H)).toEqual({ firstTrigger: "startup", firstDelayMs: 5_000, reason: "STARTUP_SCRAPE=always" });
  expect(decideStartupScrape("never", null, NOW, H)).toEqual({ firstTrigger: "interval", firstDelayMs: H, reason: "STARTUP_SCRAPE=never" });
});
it("getLastOkRunAt prefers scraper_runs, falls back to the newest odds row, maps errors to null (Review Focus 4)", async () => {
  getLastSuccessfulScrapeTime.mockResolvedValueOnce(new Date("2026-11-07T09:02:49.798Z"));
  expect(await getLastOkRunAt("premier-league")).toEqual(new Date("2026-11-07T09:02:49.798Z")); expect(getOddsFreshnessByBookmaker).not.toHaveBeenCalled();
  getLastSuccessfulScrapeTime.mockResolvedValueOnce(null);
  getOddsFreshnessByBookmaker.mockResolvedValueOnce(new Map([["sts", new Date("2026-11-07T09:02:49.048Z")], ["fortuna", new Date("2026-11-07T09:00:45.385Z")]]));
  expect(await getLastOkRunAt("premier-league")).toEqual(new Date("2026-11-07T09:02:49.048Z"));
  getLastSuccessfulScrapeTime.mockResolvedValueOnce(null); getOddsFreshnessByBookmaker.mockRejectedValueOnce(new Error("TypeError: fetch failed"));
  expect(await getLastOkRunAt("premier-league")).toBeNull();
});
it("getStalestOkRunAt: the oldest league wins; any unknown league -> null", async () => { /* [09:40, 08:45] -> 08:45; [09:40, null] -> null */ });

// scrape-settings.test.ts (extend)
it("STARTUP_SCRAPE", () => {
  expect([undefined, "auto", "always", "never"].map(assertStartupScrape)).toEqual(["auto", "auto", "always", "never"]);
  expect(() => assertStartupScrape("yes")).toThrow('Invalid STARTUP_SCRAPE "yes": expected auto|always|never');
});

// shutdown.test.ts (fake timers; each dep pushes its name into `order`)
it("SIGTERM: stop scheduler, abort the run, drain 3 s, close browsers, exit 0", async () => {
  await createShutdown(deps)("SIGTERM");
  expect(order).toEqual(["stopScheduler", "abort:shutdown: SIGTERM", "drain:3000", "closeBrowsers", "closeServer", "exit:0"]);
});
it("browsers that never close cost at most 1.5 s", async () => {
  deps.closeBrowsers = () => new Promise(() => {}); const p = createShutdown(deps)("SIGTERM");
  await vi.advanceTimersByTimeAsync(1_500); await p; expect(deps.exit).toHaveBeenCalledWith(0);
});
it("a hung drain is cut by the 10 s hard exit with code 1 (Review Focus 3)", async () => {
  deps.coordinator.drain = () => new Promise(() => {}); void createShutdown(deps)("SIGTERM");
  await vi.advanceTimersByTimeAsync(9_999); expect(deps.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(deps.exit).toHaveBeenCalledWith(1);
});
it("unhandledRejection is logged and nothing exits; a second signal exits 1 at once", async () => {
  const proc = new EventEmitter(); installProcessHandlers(proc as any, shutdown);
  proc.emit("unhandledRejection", new Error("late page.evaluate"), Promise.resolve());
  expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[Process\] Unhandled rejection \(kept running\): Error: late page\.evaluate/));
  expect(shutdown).not.toHaveBeenCalled(); /* and: shutdown("SIGINT") twice -> exit(1) before the first completes */ });

// run-alerts.test.ts (extend describe("emitAlerts"))
it("a run signal aborts the webhook at once; the lines are already on stderr", async () => {
  const f = vi.fn((_u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)))); vi.stubGlobal("fetch", f);
  const ac = new AbortController(); const p = emitAlerts(["[ALERT] x"], "https://hooks.example/x", ac.signal);
  ac.abort(new Error("shutdown: SIGTERM")); await expect(p).resolves.toBeUndefined();
  expect(errorSpy).toHaveBeenCalledWith("[ALERT] x"); expect(warnSpy).toHaveBeenCalledWith("[RunAlerts] webhook failed: shutdown: SIGTERM");
  expect(timeoutSpy).toHaveBeenCalledWith(5000);
});

// aggregator-cycle.test.ts (extend)
it("an abort drops units still scraping; a unit in its save phase finishes and is kept (Review Focus 3)", async () => {
  const ctl = new AbortController(); const saving = deferred<NormalizeAndSaveResult>();
  scrapers.betclic.scrapeFullOffer.mockResolvedValueOnce(okResult("betclic", twentyMatches())); save.mockReturnValueOnce(saving.promise);
  scrapers.forbet.scrapeFullOffer.mockReturnValueOnce(new Promise(() => {}));
  const p = runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["betclic", "forbet"], signal: ctl.signal });
  await vi.advanceTimersByTimeAsync(0); ctl.abort(new Error("shutdown: SIGTERM"));
  saving.resolve({ matchesProcessed: 20, marketsNormalized: 3150, marketsSaved: 3150, errors: [] });
  const r = await p;
  expect(r.get("premier-league")).toMatchObject({ interrupted: "shutdown: SIGTERM" });
  expect(r.get("premier-league")!.outcomes.map((o) => [o.bookmaker, o.status])).toEqual([["betclic", "success"]]);
  expect(r.get("laliga")!.outcomes).toEqual([]); expect(scrapers.betclic.scrapeFullOffer).toHaveBeenCalledTimes(1);
});
// scrape-cycle.test.ts (extend)
it("an interrupted league persists finished outcomes without [ScrapeRun] or alerts (Review Focus 3)", async () => {
  runFullOfferCycle.mockResolvedValue(new Map([["premier-league", { ...aggregatedFor("premier-league", [outcome({ bookmaker: "betclic", marketsSaved: 3150 })]), interrupted: "shutdown: SIGTERM" }]]));
  await runScrapeCycle(["premier-league"]);
  expect(insertBookmakerRunOutcomes).toHaveBeenCalledWith([expect.objectContaining({ bookmaker: "betclic" })]);
  expect(logSpy.mock.calls.flat().join("\n")).toContain(`[ScraperService] premier-league run 440d2fc6 interrupted (shutdown: SIGTERM): persisted 1 of ${CONFIG.BOOKMAKERS.length} outcomes`);
  expect(logSpy.mock.calls.filter(([l]) => String(l).startsWith("[ScrapeRun]"))).toHaveLength(0);
  expect(errorSpy.mock.calls.flat().join("\n")).not.toContain("[ALERT]");
});
it("a SIGTERM during the startup DB wait interrupts without an ABORTED alert (Review Focus 3)", async () => {
  const ctl = new AbortController();
  waitForDatabase.mockImplementationOnce(async (_ms, _iv, signal) => { ctl.abort(new Error("shutdown: SIGTERM")); return { ok: false, error: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)" }; });
  const r = await runScrapeCycle(["premier-league"], undefined, { dbWaitMs: 120_000, signal: ctl.signal });
  expect(waitForDatabase).toHaveBeenCalledWith(120_000, 5_000, ctl.signal);
  expect(r.get("premier-league")).toMatchObject({ interrupted: "shutdown: SIGTERM", aborted: null, outcomes: [] });
  expect(errorSpy.mock.calls.flat().join("\n")).not.toContain("[ALERT] scrape run ABORTED"); expect(scraperHealth.getLastAbort("premier-league")).toBeNull();
});
// scheduler-runs.test.ts (extend; ../startup-policy.js mocked)
it("a fresh boot schedules the first interval run and starts no scrape; a startup run waits 120 s for the DB", async () => {
  decideStartupScrape.mockReturnValueOnce({ firstTrigger: "interval", firstDelayMs: 2_400_000, reason: "auto: last OK run 20 min ago < 60 min" });
  startScheduler(); await vi.advanceTimersByTimeAsync(10_000);
  expect(runScrapeCycle).not.toHaveBeenCalled(); expect(getSchedulerStatus().nextRun!.getTime()).toBe(T0 + 2_400_000);
  /* second case: firstTrigger "startup" -> runScrapeCycle(["premier-league"], undefined, expect.objectContaining({ dbWaitMs: 120_000 })) */
});
```
Rebase `scheduler-service.test.ts:150-161`: mock `../startup-policy.js` (`decideStartupScrape` → `{ firstTrigger: "startup", firstDelayMs: 5_000, reason: "auto: no OK run on record" }`, `getStalestOkRunAt` → `null`); the assertion keeps `runScrapeCycle(["premier-league"], undefined, expect.objectContaining({ dbWaitMs: 120_000 }))` after `advanceTimersByTimeAsync(5_000)`.

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/services/__tests__/startup-policy.test.ts src/services/__tests__/shutdown.test.ts src/scrapers/__tests__/aggregator-cycle.test.ts src/services/__tests__/scrape-cycle.test.ts src/config/__tests__/scrape-settings.test.ts src/services/__tests__/scheduler-runs.test.ts src/services/__tests__/run-alerts.test.ts`
- [ ] **Step 3: Implement** as specified. Add `STARTUP_SCRAPE=auto` to `.env.example` after `:19` with `# auto: scrape on boot only if the last OK run is older than SCRAPE_INTERVAL_MINUTES; always | never`.
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy npx vitest run` and `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```bash
git add src/services/startup-policy.ts src/services/shutdown.ts src/config/index.ts src/config/database.ts src/services/run-alerts.ts .env.example src/services/scheduler-service.ts src/scrapers/hard-deadline.ts src/scrapers/aggregator.ts src/services/scraper-service.ts src/index.ts src/services/__tests__/startup-policy.test.ts src/services/__tests__/shutdown.test.ts src/scrapers/__tests__/aggregator-cycle.test.ts src/services/__tests__/scrape-cycle.test.ts src/config/__tests__/scrape-settings.test.ts src/services/__tests__/scheduler-runs.test.ts src/services/__tests__/run-alerts.test.ts src/services/__tests__/scheduler-service.test.ts
git commit -m "feat(server): STARTUP_SCRAPE policy, draining shutdown with partial outcomes, rejection handler"
```

---

### Task 6: Retention after every run and at boot, built on `runDailyCleanup`

**Files:**
- Create: `src/services/retention-service.ts`
- Modify: `src/services/scheduler-service.ts` (import `:11` → retention-service; `runDailyCleanup :98-113`: the odds step becomes `await runRetentionCleanup()`, the `scraper_runs` step `:107-112` stays (B11); `startScheduler`: boot call); `src/services/scraper-service.ts` (`runScrapeCycle`).
- Test: create `src/services/__tests__/retention-service.test.ts`; extend `scrape-cycle.test.ts`, `scheduler-runs.test.ts`; rebase `scheduler-service.test.ts:126-148`.

**Interfaces:**
- Consumes: `cleanupOldOdds(hoursToKeep)` (`odds-repository.ts:159-170`, untouched; returns `{ deleted: 0 }` and logs `[OddsRepository] cleanup error:` on a PostgREST error); `deleteScraperRunsOlderThan(30)` (`scraper-run-repository.ts:196`, untouched).
- Produces:
  ```ts
  export const RETENTION_HOURS = 24;
  export interface RetentionResult { deleted: number; durationMs: number; error: string | null }
  export function runRetentionCleanup(): Promise<RetentionResult>;   // single-flight; never throws
  //   success: `[Retention] deleted ${n} odds rows older than ${RETENTION_HOURS}h in ${ms}ms`
  //            + optional ` (matches=${a}, snapshots=${b}, scraper_runs=${c})` when the body reports a breakdown (plan 09's cleanup_odds; never printed here)
  //   failure: `[Retention] cleanup failed: ${message}`
  ```
- Call sites: (1) `runScrapeCycle` after per-league persistence as `void runRetentionCleanup()` — **not awaited**, so a long first DELETE (~108 k rows) never holds the run lock or the shutdown drain; skipped when any league was refused (`db_unreachable`) or interrupted; (2) `startScheduler` once at boot (not awaited); (3) the 03:00 cron through `runDailyCleanup()`: `await runRetentionCleanup()`, then the unchanged 30-day `scraper_runs` delete. Plan 09 later re-implements the body as `cleanup_odds()` and rewrites these tests in the same commit (cross-plan #10); the seam's name, result and line prefix stay (cross-plan #25).

- [ ] **Step 1: Write the failing tests**

```ts
// retention-service.test.ts (odds-repository mocked)
it("wraps cleanupOldOdds(24) and logs the count", async () => {
  cleanupOldOdds.mockResolvedValueOnce({ deleted: 108_000 });
  expect(await runRetentionCleanup()).toMatchObject({ deleted: 108_000, error: null });
  expect(cleanupOldOdds).toHaveBeenCalledWith(24);
  expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[Retention\] deleted 108000 odds rows older than 24h in \d+ms$/));
});
it("never throws", async () => {
  cleanupOldOdds.mockRejectedValueOnce(new Error("TypeError: fetch failed"));
  expect(await runRetentionCleanup()).toMatchObject({ deleted: 0, error: "TypeError: fetch failed" });
  expect(errorSpy).toHaveBeenCalledWith("[Retention] cleanup failed: TypeError: fetch failed");
});
it("is single-flight (03:00 cron overlapping a post-run call)", async () => {
  const d = deferred<{ deleted: number }>(); cleanupOldOdds.mockReturnValueOnce(d.promise);
  const [a, b] = [runRetentionCleanup(), runRetentionCleanup()]; d.resolve({ deleted: 7 });
  expect(await a).toBe(await b); expect(cleanupOldOdds).toHaveBeenCalledTimes(1);
});
// scrape-cycle.test.ts (extend; ../retention-service.js mocked)
it("starts retention once after a completed cycle, after outcomes were persisted, without awaiting it; never after a refusal or an interruption", async () => {
  runRetentionCleanup.mockReturnValue(new Promise(() => {}));               // a slow DELETE must not hold the run
  await runScrapeCycle(["premier-league"]);
  expect(runRetentionCleanup).toHaveBeenCalledTimes(1);
  expect(insertBookmakerRunOutcomes.mock.invocationCallOrder[0]).toBeLessThan(runRetentionCleanup.mock.invocationCallOrder[0]);
  /* probe fails -> 0 more calls; interrupted league -> 0 more calls */
});
// scheduler-runs.test.ts (extend)
it("boot starts retention once; the 03:00 job runs retention, then the 30-day scraper_runs delete", async () => {
  startScheduler(); expect(runRetentionCleanup).toHaveBeenCalledTimes(1);
  await cronJobs.get("0 3 * * *")!(); expect(runRetentionCleanup).toHaveBeenCalledTimes(2);
  expect(deleteScraperRunsOlderThan).toHaveBeenCalledWith(30);
  expect(runRetentionCleanup.mock.invocationCallOrder[1]).toBeLessThan(deleteScraperRunsOlderThan.mock.invocationCallOrder[0]);
});
```
Rebase `scheduler-service.test.ts:126-148` (retention-service is real there; its `cleanupOldOdds` import is the file's mock): `:129` → `toHaveBeenCalledWith(24)`; `:131` `"[Scheduler] Cleanup complete, deleted: 12"` → `expect.stringMatching(/^\[Retention\] deleted 12 odds rows older than 24h in \d+ms$/)`; `:139` `("[Scheduler] Cleanup failed:", boom)` → `"[Retention] cleanup failed: rpc failed"`; the `scraper_runs` assertions (`:130`, `:132`, `:140`, `:143-147`) stay.

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/services/__tests__/retention-service.test.ts src/services/__tests__/scrape-cycle.test.ts src/services/__tests__/scheduler-runs.test.ts src/services/__tests__/scheduler-service.test.ts`
- [ ] **Step 3: Implement** the seam and the three call sites; drop the scheduler's direct `cleanupOldOdds` import.
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy npx vitest run` and `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```bash
git add src/services/retention-service.ts src/services/scheduler-service.ts src/services/scraper-service.ts src/services/__tests__/retention-service.test.ts src/services/__tests__/scrape-cycle.test.ts src/services/__tests__/scheduler-runs.test.ts src/services/__tests__/scheduler-service.test.ts
git commit -m "feat(retention): run odds retention after every run and at boot, not only at 03:00"
```

---

### Task 7: `[ScrapeMetrics]` per bookmaker job

**Files:**
- Create: `src/scrapers/metrics/scrape-metrics.ts`
- Modify: `src/types/full-offer.ts` (after `NavigationDiagnostics :81-94` and `diagnostics? :113`); `src/scrapers/aggregator.ts` (unit, job wrapper, one cycle sampler).
- Test: create `src/scrapers/metrics/__tests__/scrape-metrics.test.ts`; extend `src/scrapers/__tests__/aggregator-cycle.test.ts` (`vi.mock("../../utils/proc-sampler.js", …)` with a constant tree).

**Interfaces:**
- Consumes: §3 `HttpStats`, `TransportStats`, `hasTransportStats` (cumulative counters, diffed per unit); plan 02 Task 9 `readProcessTree`, `createProcSummary`, `ProcTree`, `ProcessSamplerSummary` (`src/utils/proc-sampler.ts`) — no second `/proc` parser (cross-plan #30); Task 2 `JobTransport`; Task 3 job wrapper; observability `BookmakerRunStatus`.
- Produces:
  ```ts
  // types/full-offer.ts
  export interface ScrapeMetrics {                     // per (bookmaker, league); set by the aggregator after the save
    phasesMs: { scrape: number; normalizeSave: number };
    matches: number; marketsFound: number; marketsSaved: number;
    http?: { requests: number; retries: number; failures: number; bytes: number; byStatus: Record<string, number> }; // §3 HttpStats shape
    ws?: { framesReceived: number; bytesReceived: number };
  }
  // FullOfferScraperResult gains, after diagnostics?: metrics?: ScrapeMetrics (aggregator-owned)
  // scrape-metrics.ts
  export interface JobMetricsLine {
    bookmaker: PolishBookmaker; transport: JobTransport; queueMs: number; durationMs: number; interrupted: boolean;
    leagues: Record<string, ScrapeMetrics & { runId: string; status: BookmakerRunStatus }>;
    eventLoopDelayMs: { p50: number; p99: number; max: number };
    nodeRssPeakMb: number;               // process-wide peak while the job ran
    chromiumPeakRssMb: number | null;    // browser jobs: process-wide Chromium tree peak while the job ran (shared by concurrent browser jobs); else null
  }
  export function formatScrapeMetricsLine(m: JobMetricsLine): string; // "[ScrapeMetrics] " + JSON.stringify(m), keys in the order above
  export function startEventLoopWindow(resolutionMs?: number): { stop(): JobMetricsLine["eventLoopDelayMs"] };
  //   monitorEventLoopDelay({ resolution: 10 }) per job; value = max(0, ns / 1e6 - resolution), 1 decimal
  export interface CycleSampler { track(): { stop(): ProcessSamplerSummary }; stop(): Promise<void> }
  export function startCycleSampler(o?: { intervalMs?: number; read?: () => Promise<ProcTree> }): CycleSampler;
  //   ONE readProcessTree(process.pid) per tick for the whole cycle, added to a createProcSummary() per tracked job;
  //   chained setTimeout (never setInterval), unref'd, default 1 000 ms; a failed read is skipped
  export function readTransportStats(scraper: FullOfferScraper): TransportStats | undefined;  // hasTransportStats(scraper) ? scraper.transportStats() : undefined
  export function diffHttpStats(before: HttpStats | undefined, after: HttpStats | undefined): HttpStats | undefined;
  export function diffTransportStats(before: TransportStats | undefined, after: TransportStats | undefined): TransportStats | undefined;
  ```
- `runFullOfferCycle` starts one `CycleSampler`; each job calls `track()` and starts an event-loop window. Each league times `scrape` and `normalizeSave`, diffs `readTransportStats(scraper)` around the unit with `diffTransportStats`, and sets `result.metrics`. Exactly one `[ScrapeMetrics]` line is printed per job in `finally`, interrupted jobs included; the sampler is stopped in the cycle's `finally`. Persisting to `scraper_runs.metrics jsonb` is a follow-up (Open Question 3, migration 17).

- [ ] **Step 1: Write the failing tests**

```ts
// scrape-metrics.test.ts
const MB = 2 ** 20;
const tree = (nodeMb: number, chromiumMb: number): ProcTree => ({ rootRssBytes: nodeMb * MB, chromium: [{ pid: 200, rssBytes: chromiumMb * MB, cpuTicks: 0 }] });
it("one /proc read per tick feeds every tracked job; a job sees only the ticks while it was tracked", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce(tree(200, 100)).mockResolvedValueOnce(tree(300, 400)).mockResolvedValue(tree(250, 150));
  const s = startCycleSampler({ intervalMs: 1_000, read });
  const a = s.track(); await vi.advanceTimersByTimeAsync(1_000);
  const b = s.track(); await vi.advanceTimersByTimeAsync(2_000);
  expect(read).toHaveBeenCalledTimes(3);
  expect(a.stop()).toMatchObject({ samples: 3, nodePeakRssMb: 300, chromiumPeakRssMb: 400 });
  expect(b.stop()).toMatchObject({ samples: 2, nodePeakRssMb: 300 });
  await s.stop(); await vi.advanceTimersByTimeAsync(5_000); expect(read).toHaveBeenCalledTimes(3);
});
it("diffs HttpClient stats including byStatus; reads transport stats only from a TransportStatsSource", () => {
  expect(diffHttpStats({ requests: 3, retries: 0, failures: 0, bytes: 100, byStatus: { "200": 3 } },
    { requests: 23, retries: 1, failures: 1, bytes: 5_100, byStatus: { "200": 22, "503": 1 } }))
    .toEqual({ requests: 20, retries: 1, failures: 1, bytes: 5_000, byStatus: { "200": 19, "503": 1 } });
  expect(diffTransportStats({ ws: { framesReceived: 2, bytesReceived: 10 } }, { ws: { framesReceived: 9, bytesReceived: 710 } }))
    .toEqual({ ws: { framesReceived: 7, bytesReceived: 700 } });
  const base = { bookmaker: "forbet" as const, scrapeFullOffer: vi.fn(), cleanup: vi.fn() };
  const http = { requests: 1, retries: 0, failures: 0, bytes: 9, byStatus: { "200": 1 } };
  expect(readTransportStats({ ...base, transportStats: () => ({ http }) })).toEqual({ http });
  expect(readTransportStats(base)).toBeUndefined();
});
it("event-loop window reports a 120 ms block above resolution", async () => {
  const w = startEventLoopWindow(); await new Promise((r) => setTimeout(r, 30));
  const t = Date.now(); while (Date.now() - t < 120) {} await new Promise((r) => setTimeout(r, 50));
  expect(w.stop().max).toBeGreaterThanOrEqual(100);
});
it("formats one prefixed JSON line", () => expect(formatScrapeMetricsLine(line)).toBe(`[ScrapeMetrics] ${JSON.stringify(line)}`));

// aggregator-cycle.test.ts (extend): the forbet fake implements transportStats() (cumulative); its scrapeFullOffer adds 20 requests / 5 000 bytes
it("one [ScrapeMetrics] line per job across leagues; per-league metrics on the results", async () => {
  const r = await runFullOfferCycle({ leagues: ["premier-league", "laliga"], bookmakers: ["betclic", "forbet"], runIds: { "premier-league": ID_PL, laliga: ID_LL } });
  const lines = logSpy.mock.calls.flat().filter((l) => String(l).startsWith("[ScrapeMetrics] "));
  expect(lines).toHaveLength(2);
  const forbet = JSON.parse(lines.find((l) => l.includes('"bookmaker":"forbet"'))!.slice(16));
  expect(Object.keys(forbet.leagues)).toEqual(["premier-league", "laliga"]);
  expect(forbet).toMatchObject({ transport: "http", interrupted: false, chromiumPeakRssMb: null,
    leagues: { "premier-league": { runId: ID_PL, status: "success", matches: 20, marketsSaved: 5869, http: { requests: 20, bytes: 5_000 } } } });
  expect(r.get("premier-league")!.results.get("forbet")!.metrics).toMatchObject({ matches: 20, marketsSaved: 5869 });
});
```

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/scrapers/metrics/__tests__/scrape-metrics.test.ts src/scrapers/__tests__/aggregator-cycle.test.ts`
- [ ] **Step 3: Implement** as specified; every timer is `.unref()`'d and stopped in `finally`.
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy npx vitest run` and `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```bash
git add src/scrapers/metrics/scrape-metrics.ts src/types/full-offer.ts src/scrapers/aggregator.ts src/scrapers/metrics/__tests__/scrape-metrics.test.ts src/scrapers/__tests__/aggregator-cycle.test.ts
git commit -m "feat(metrics): one [ScrapeMetrics] line per bookmaker job (phases, transport, event loop, RSS)"
```

---

### Task 8: Live acceptance — DEFERRED to the owner (no code)

Every check below needs the running server and runs that persist (EXECUTION rules 3–4). **The implementer runs none of them**: record this table verbatim in the task report. The owner runs it after merging into the main checkout (which restarts tsx once). `$LOG` is the dev server log. The admin runs (L3, L4, L10) write odds and need the owner's go. Never run a check within ±5 min of `curl -s localhost:3001/api/health | python3 -I -c "import json,sys;print(json.load(sys.stdin)['data']['nextScrapeAt'])"`.

| # | When / command | Pass criterion |
|---|---|---|
| L1 | After the merge restart: `grep -a '\[Scheduler\] Startup scrape' $LOG \| tail -1` | `in 5s (auto: …)` when the last OK run is > `SCRAPE_INTERVAL_MINUTES` old, else `skipped (auto: last OK run N min ago < 60 min)` |
| L2 | After a completed run: `touch src/index.ts` in the live checkout (restart only) | New boot logs `skipped (auto: …)`; no `[Aggregator/FullOffer] Starting run` within 60 s |
| L3 | `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer ${ADMIN_API_KEY:-dev-api-key}" -H 'Content-Type: application/json' -d '{"league":"premier-league","bookmakers":["forbet"]}' http://localhost:3001/api/admin/scrape` twice within 1 s | `202` then `409`; the 409 body has `SCRAPE_IN_PROGRESS` and the first call's `runId`; afterwards `/api/health` `lastScrapeStats` still shows the last full run |
| L4 | Repeat L3 once, then `touch src/index.ts` within 3 s | `[Server] Shutdown complete in <ms>` with ms < 5000; no tsx `Force killing`; either `[ScraperService] premier-league run … interrupted (shutdown: SIGTERM): persisted k of 1 outcomes` or a normal finish |
| L5 | After two interval runs: `grep -a 'started (interval) at' $LOG \| tail -2` | Start times 54–66 min apart (interval 60) |
| L6 | After a full run: `grep -a '^\[ScrapeMetrics\] ' $LOG \| tail -n "$N" \| cut -c17- \| python3 -I -c "import json,sys;l=[json.loads(x) for x in sys.stdin];print(len(l),max(x['eventLoopDelayMs']['max'] for x in l),sorted((x['bookmaker'],x['transport']) for x in l))"` with `N` = the number of jobs (14 on premier-league) | `N` parsed lines; transports match Task 2's pin (10 `browser`, 4 `http` until plans 03–05 land); record the max event-loop delay as plan 01's baseline |
| L7 | Right after a run: `grep -ac '^\[Retention\] deleted ' $LOG` grows by 1, then `curl -s -o /dev/null -D - "$SUPABASE_URL/rest/v1/odds?select=id&scraped_at=lt.$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)&limit=1" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -H "Prefer: count=exact" \| grep -i content-range` (read-only) | `*/0` (prefix match on `[Retention] deleted `, cross-plan #25) |
| L8 | `curl -s localhost:3001/api/health` between runs | `nextScrapeAt` is a future ISO time; `currentRun` is `null` |
| L9 | After a run where a bookmaker reported a cause (e.g. totalbet `Detail fetch failed for …`): `grep -a '^\[Aggregator/FullOffer\] [a-z]* partial: ' $LOG \| tail -3` | the line ends ` - <cause>`; the same bookmaker has no `[ALERT]` line (Task 0) |
| L10 | During a run (`currentRun` non-null): `npx tsx scripts/smoke-bookmaker.ts --bookmaker forbet --persist; echo $?` | `Refusing --persist: scrape run … in progress since …` and exit `4`; no scrape started |

- [ ] Record the commands and expected results in the task report. The owner records the outputs in `$E/orchestration-after-<date>.txt` and, when asked, commits that file only: `git commit -m "docs: orchestration acceptance evidence"`.

---

## Self-Review

1. **Spec coverage.** Brief items 1–7 map to Tasks 1–7 (item 7's persistence → Open Question 3); the README §5.1 `partial` row owned by this plan is Task 0; Task 8 lists the live checks, deferred to the owner per EXECUTION. Every task names the built observability anchors it edits and the observability tests it rebases ("Anchors on the future base"); the seams (`getScraper`, `closeAllBrowsers`, `browserPool`, `initBrowser`, `executeFullOfferScrape`) are in Global Constraints and kept by construction.
2. **Step scan.** Test steps carry concrete values (run-2 counts, real error strings incl. betcris's `aborted after 3 consecutive per-match capture failures`, the tsx 5 s kill window, the 600/360 s budgets with their derivation). Open algorithms are one-line rules (stagger gate, job order, `computeNextDelayMs`, decision reasons, shutdown order, cycle sampler). Every vitest/tsc/tsx command runs through `heavy`. No "handle errors" steps.
3. **Type consistency.** `JobTransport` is keyed on §3 `DEFAULT_MAX_DURATION_MS` and lives in the leaf `job-budgets.ts` (plan 08 imports `maxDurationMsFor` from it without a cycle through `playwright-base.ts`); `DeclaresTransport.transport` is what 06 (betclic), this plan (totalbet, betby), 02/03/04 (`HttpScraper`) and 05a/05b/05c (WebSocket) declare; `RunHandle.runId === runIds[leagues[0]]` = the `Starting run` uuid = `scraper_runs.run_id` = an aborted league's `ScrapeResult.runId`; `interrupted` exists (Task 5) before Task 7 reads it; `ScrapeMetrics.http` is §3 `HttpStats`'s shape, so `types/` imports nothing from `scrapers/`. Fixed while revising: the grep pin became a runtime pin; tests use real league slugs (`laliga`), because units are filtered by `isLeagueSupported`; `aggregated()` is local to `scraper-service.test.ts`, so the new tests build their own `aggregatedFor`; the fakes follow `aggregator-db-down.test.ts:16-60` instead of a new helper module; the `/proc` reader is plan 02's.
4. **Review Focus.** Each of the six lines names its pinning tests (Tasks 0–5).
5. **Proportion.** About 12 new modules with signatures, rules and assertions, and no bodies; the bulk is test code. Task 0 is one line plus tests and can ship alone.

## Open Questions

1. **Browser budgets for sts and betcris** (README §8 Q12). Proposed and implemented in Task 2: sts 360 s, betcris 600 s, pzbuk 600 s, sized from A1 and betcris.md's retry worst case. Residual risk: a betcris run whose failures alternate with successes never trips its breaker and is cut at 600 s, losing that run's games (betcris returns only at the end of its loop). Returning the captured games on a budget abort is a change to the recovery-built loop; plan 08 Open Question 4 carries it. Default: as proposed.
2. **Admin league scope.** Only `CONFIG.ENABLED_LEAGUES` (default here), or any slug in `src/config/leagues.ts` for ad-hoc testing?
3. **Persisting metrics** (`scraper_runs.metrics jsonb`). It needs migration **17** (after plan 09's 12–15 and plan 10's 16) and a guard so the outcome insert omits `metrics` until the column exists; otherwise PGRST204 fails the **whole** insert. Default: a follow-up after plans 09/10.
4. **`unhandledRejection`.** Log and continue (default; orphaned page ops after a deadline close are expected), or graceful shutdown + exit 1?
