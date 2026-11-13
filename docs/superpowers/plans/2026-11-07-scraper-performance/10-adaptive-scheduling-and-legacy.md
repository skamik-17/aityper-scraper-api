# Adaptive Scheduling and Legacy Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:** rebased on the future base (`recovery/integration` ≥ `aaf7c07` + `recovery/observability` + `recovery/fortuna`) and the owner's `EXECUTION.md`. Evidence: `evidence/delta-audit-infra-2026-11-13.md` (section 10, "Already done / obsolete"), `evidence/delta-audit-transport-2026-11-13.md` ("start_time on the future base"), `evidence/cross-plan-review-2026-11-07.md` (#2, #7, #16, #21, #27, #36).
> - Prerequisites add plan 07 Task 0 (the `partial` rule) and observability Task 9 (`scripts/scraper-status.ts`, built) and Task 10 (`npm run dev:stack`, **not built**: live steps use the owner's documented start procedure instead and are owner steps).
> - Outcomes, `[ScrapeRun]`, alerts (incl. the "half the bookmakers empty" league alert) and `STATUS_WINDOW_RUNS` stay in **hourly units**: incremental ticks between hourly ticks record no outcome and raise no alert; the hourly outcome of an incremental bookmaker summarizes its hour (Tasks 4–5).
> - Betclic (Task 8) reuses plan 01's `BetclicListingMatch.startTime` (raw) + `toIsoStartTime` and plan 01's `fixtures/full-offer/betclic-listing.bin`, adding only `marketCount` (field 7); rest-market (Task 6) imports `toIsoStartTime` (no `kickoffIso`).
> - Task 18: the 14-day gate counts `empty` as a failure (owner A6); `getTransportOverride` stays as a stub returning `undefined`; every pick location and selection test is listed.
> - Part B: legacy inventory re-measured on the future base (~2 300 lines incl. totalbet, Betby and pzbuk), extra legacy tests listed, `getStalestOkRunAt` → `getLastSuccessfulScrapeTime`, `scripts/scraper-check.ts` built on `scripts/smoke-bookmaker.ts`, dead `insertScraperRun`/`updateScraperRun` deleted; plan 02 Task 6 already removed the legacy aggregator runners.

**Goal:** Fetch a match's detail only when its kickoff tier or a listing price change makes it due (a cheap listing every 10 min instead of an hourly full pass), then delete the dead legacy 1X2 path and, after a clean fortnight, the browser fallback classes.

**Architecture:** Part A adds an `IncrementalScraper` contract (`listEvents` + `fetchEvent`) on top of §3 `FullOfferScraper`, a pure due-plan (kickoff tiers + listing fingerprint), per-snapshot detail state in `odds_snapshot` (migration 16) with one RPC that stamps fetched events and confirms unchanged ones, and a dispatcher that plugs into plan 07's coordinator and interval loop behind `INCREMENTAL_BOOKMAKERS` (empty by default, which keeps today's behaviour). The HTTP scrapers (plans 03, 04) and betclic (plan 06) implement the contract. Their full pass becomes `listEvents` + `fetchEvent` (betclic keeps plan 06's), so the full pass is unchanged by construction. Part B ports `scripts/test-scrapers.sh` to the full-offer path, deletes the legacy methods group by group under an AST guard test, then the legacy types, and finally the `<Brand>BrowserScraper` classes behind a numeric `scraper_runs` gate.

**Tech Stack:** TypeScript (ESM, Node 20), Vitest, tsx, the TypeScript compiler API (already a devDependency) for the legacy scan, PostgreSQL 16 plpgsql via PostgREST, `node:crypto` sha1.

**Spec:** README §2 (principle 4), §3 (incl. "Rule: exactly ONE pick" and the `getTransportOverride` stub), §4 row 10, §5 P9, §8 Q5. `evidence/findings-notes.md` CORE-11 and CORE-12 (core section). `evidence/core/target-architecture.ts:49-62` (contract sketch), `:438-500` (coordinator), `:512-532` (interval loop), `:535-546` (`detailRefreshDue`). `evidence/core/legacy-lines.mts`, `legacy-helpers.mts`. `evidence/db-pipeline/proposed-write-model.sql`. Listing and detail payloads in `evidence/{forbet-etoto,lvbet-fuksiarz,betfan-totalbet,sts-superbet,betclic-fortuna,betcris-pzbuk}/`. `evidence/delta-audit-infra-2026-11-13.md` (section 10). Recovery (tracked on `recovery/integration`): `../2026-11-06-scraper-recovery/EXECUTION.md` (owner decisions and workspace rules; it wins over this plan), `observability.md` (Tasks 6, 9, 10).

## Global Constraints

- README §6 applies, **overridden by `EXECUTION.md`** where they differ. `$E` = `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence` (untracked: read it from the main checkout by absolute path; never write there).
  - Worktree per branch from `recovery/integration` (or `master` once the owner has merged it): `git -C /home/skamik/Documents/repositories/personal/aityper-scraper-api worktree add ../aityper-scraper-api-worktrees/perf-10-<part> -b perf/10-<part> recovery/integration`, then merge the prerequisite branches below into it if the owner has not merged them yet (own branch only). `ln -s` the main checkout's `node_modules` (never `npm install`/`npm ci`), copy a recovery worktree's dead-port `.env` (never change it).
  - Heavy commands through `H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy` (`$H npx vitest run …`, `$H npx tsc --noEmit`, `$H npx tsx …`, `$H python3 -I …`); anything that calls a bookmaker or opens a browser as `$H --live …`, one at a time. Scoped tests during TDD, the full suite once per task. Scratch output under `<worktree>/.scratch/`.
  - **Implementers never start the server or the scheduler, never write to the DB and never apply a migration** (EXECUTION rule 3). Every "restart", "set `.env`", "apply", "leave it running" and "after the next scheduled run" step below is an **owner step**: the implementer records the exact commands and the expected results in the task report and stops (EXECUTION rule 4). Read-only GETs to the live backend (`http://localhost:3001/api/...`) and read-only SQL (`RO_PSQL` below) are allowed.
- Prerequisites:
  - plans 02–07 and 09 merged, including 09's read switch (`latest_odds` reads `odds_snapshot.last_seen_at`) and **plan 07 Task 0** (`classifyBookmakerRun` maps `success:true` + scraper `error` with `marketsSaved > 0` to `partial`; observability built no such rule, `run-outcome.ts:79-80`). Without it an incremental pass with a few failed details reads as `success` and drops the cause.
  - Recovery 4a (totalbet), 4b (pzbuk) and 4c (Betby): merged on `recovery/integration`.
  - Observability (`recovery/observability`): Tasks 1–9, in particular Task 6 (`run-alerts.ts`) and Task 9 (`scripts/scraper-status.ts`, `scripts/smoke-bookmaker.ts`). **Observability Task 10 (`npm run dev:stack`) is not built**: Tasks 10–11 use the owner's documented start procedure instead (README.md:150/:204, CLAUDE.md:44: `npm run dev` in the main checkout, after the Supabase stack is up), or `npm run dev:stack` if Task 10 has landed by then.
  - Part B (Tasks 12–18) does not need Part A and may be worked in a parallel worktree; merges still go one branch at a time.
- Migration `supabase/migrations/16_incremental_scrape_state.sql` (plan 09 owns `11a` and 12–15) follows plan 09's rules. It ends with `NOTIFY pgrst, 'reload schema';`. It is tested only through plan 09's `scripts/sql-test.sh` (throwaway `aityper-sqltest` container, owner approval to start it). It is applied only by the owner: `./scripts/apply-migrations.sh 16_incremental_scrape_state.sql`, between runs.
- Read-only SQL uses `RO_PSQL` = `docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000' supabase_db_backend psql -U postgres -d postgres -X -P pager=off` (shape from `$E/db-pipeline/q.sh`).
- Tier table (exact; README §8 Q5): kickoff in < 1 h → 10 min; 1 h ≤ x < 3 h → 20 min; 3 h ≤ x < 24 h → 60 min; 24 h ≤ x < 72 h → 120 min; ≥ 72 h → 360 min; unknown kickoff → 10 min. `PASS_TOLERANCE_MS = 120_000`. Confirmation caps `2 hours` (kickoff within 72 h or unknown) and `6 hours`.
- `INCREMENTAL_BOOKMAKERS` defaults to empty, `INCREMENTAL_PASS_MINUTES` to 10 (integer, 5 ≤ x ≤ `SCRAPE_INTERVAL_MINUTES`), `INCREMENTAL_DRY_RUN` to false. Any invalid value logs one error and disables incremental mode (today's behaviour), never crashes the service.
- Log lines parsed by Task 9: `[IncrementalPass] {json}` and `[FullPassCost] {json}`, one line per pass, JSON on one line. Betclic's `[Betclic/FullOffer] Found N events in listing`, `… X vs Y: N markets total` and `Failed to fetch group` lines keep their format and count per full pass. Observability's protected lines keep their format and **hourly** cadence: `[Aggregator/FullOffer] <bm> <status>: …`, `Run … ok, … failed`, `[ScrapeRun] …`, `[ALERT] …`, `[ALERT-RESOLVED] …` (Tasks 4–5).
- No new dependencies. No parser or normalizer output changes, so `src/services/normalization/__tests__/golden.test.ts` passes unchanged.
- Live checks in Tasks 10, 11 and 18 observe scheduled traffic only and are owner steps. Any manual smoke is a read-only `$H --live npx tsx scripts/perf-smoke.ts …` (plan 02), one bookmaker at a time, never within HH:55–HH:10.

## Review Focus

1. **Listing and detail disagree on team names** (the ref's `matchKey` differs from the key of the saved offer). Expected: the stamp uses the offer's key, the mismatch is logged as `[IncrementalPass] name mismatch <bm> <eventId>: "<ref home> v <ref away>" vs "<offer home> v <offer away>"` and counted in `nameMismatch`; the event is then fetched on every pass (costlier, never stale). Test: Task 4 `name mismatch is counted and the stamp uses the offer key`.
2. **Kickoff parsed without its UTC offset** (superbet `matchDate` is local, `utcDate` is UTC; lvbet carries `+00:00`; betclic has seven fractional digits). Expected: every `EventRef.kickoff` is ISO UTC with `.000Z`; an event one hour away never looks started. Tests: Tasks 6–8 pin `kickoff` per bookmaker.
3. **Pass gaps** (±10 % tick jitter, a slow run, a restart) push an event past its tier. Expected: the 2-minute tolerance fetches the < 1 h tier on every pass at 9–11-minute gaps; the report fails any pre-pass age above tier + 12 min. Tests: Task 2 rows `lt1h age 8 min is due` and `lt1h age 7 min is fresh`; Task 9 `staleness above tier + 12 min fails the window`.
4. **Same-club keys and non-match listing entries** (etoto lists `Dzień meczowy 07.11 - 4 mecze`). Expected: degenerate keys are dropped before planning, and `listEvents` returns exactly the events the full pass maps, so nothing is fetched on every pass for nothing. Tests: Task 4 `drops refs whose home and away resolve to the same key`; Task 6 `etoto refs equal the full pass's match ids`.
5. **Tiny due sets and one transient detail error.** Expected: with fewer than 4 due events a failure never fails the pass (no `scrape_failed` outcome, no streak alert); the failed event stays unconfirmed and due, and the cause is in `error`. Test: Task 4 `one failed detail of two keeps success and leaves it due`.
6. **Alerts and status in hourly units on a 10-minute tick.** A 10-minute pass must not turn observability's 3-failure streak into 30 minutes, fill `STATUS_WINDOW_RUNS` (50 rows per bookmaker, `bookmaker-status.ts:63`) with 8 hours instead of 50, print `[ScrapeRun]` six times an hour, or fire the "half the bookmakers returned 0 matches" league alert (`run-alerts.ts:63-69`) because a small tick lists few bookmakers. Expected: outcomes, `[ScrapeRun]` and alerts are produced only on the hourly tick; a failure on an incremental tick is carried into that bookmaker's next hourly outcome. Tests: Task 4 `the hourly outcome carries the hour's failed passes` and `nothing due with all events confirmed is success, not empty`; Task 5 `an incremental tick records no outcome and emits no [ScrapeRun] or alert`.

---

## Observations (pre-fix analysis)

**Part A.**
- CORE-11 (`$E/findings-notes.md`, core section): the tier table above, detail fetch on a listing price change, never a prematch detail for a started event, staleness capped at 2 h inside 72 h. The sketch `detailRefreshDue` (`$E/core/target-architecture.ts:535-546`) treats an unknown kickoff as always due and has no tolerance for tick jitter. This plan gives unknown kickoffs the 10-minute tier and adds a 2-minute tolerance.
- 97.2 % of odds rows are identical between consecutive scrapes (README §1.2), so most hourly detail fetches return what we already have.
- What a listing costs and carries (decoded JSON sizes of the evidence files, PL, 2026-11-06/07):

| bookmaker | listing | detail per event | listing prices → fingerprint | kickoff |
|---|---|---|---|---|
| forbet | `forbet-etoto/fb_list_major.json` 142 KB, 19 events | `fb_detail.json` 335 KB | `eventGames[].outcomes[].outcomeOdds`, `gamesCount` | `eventStart` (epoch ms) |
| etoto | `forbet-etoto/et_list.json` 415 KB, 20 entries | `et_detail.json` 299 KB | same | same |
| fuksiarz | `lvbet-fuksiarz/fk_cat.json` 216 KB, 19 | `fk_ev.json` 248 KB | same | same |
| betfan | `betfan-totalbet/bf-list-244.json` 425 KB, 19 (`data.categories[0].events`) | `bf-ev-40932985.json` 263 KB | `games[].outcomes[].outcomeOdds`, `gamesCount` | `eventStart` |
| superbet | `sts-superbet/data/sb-bydate.json` 48 KB, 19 | 3.99 MB near / 706 KB far | `odds[].price` (by `uuid`), `marketCount` | `utcDate` |
| lvbet | `lvbet-fuksiarz/lv_comp.json` 147 KB, 19 | `lv_mk1.json` 1.37 MB | `primary_column_markets[].selections[].rate.decimal` (by `selection_id`), `state.markets_count` | `date` (`+00:00`) |
| fortuna | `betclic-fortuna/fortuna-fixtures.json` 21 KB, 19 | `fortuna-full.json` 1.74 MB | none (prices only in a 4.7 KB `/markets/overview` per fixture) | `startDatetime` (epoch ms) |
| betclic | gRPC listing 43 KB, 19 (live, 2026-11-07 02:47 CET) | 7 group streams | 1X2 already parsed (`parser.ts:871-931`), field 7 = market count (464 for Leeds–Tottenham) | field 3 = `"2026-11-07T12:30:00.0000000Z"` |

  The betclic fields come from one listing fetched with `fetchLeagueMatches("premier-league")` and dumped with a scratch protobuf walker. A 10-minute listing costs 6 × listing per hour. That is ≤ 0.6 % of an hourly full pass for fortuna, superbet, lvbet and betclic, 2–5 % for forbet and fuksiarz, and ~8 % for betfan and etoto. Fortuna gets `fingerprint: null`: fetching 19 overviews per pass would triple its requests to save one hour of 1X2 latency, and the tiers already bound its staleness.
- **WebSocket scrapers (plans 05a–c): not migrated.** STS: the league index `i_pl` is 419 KB of the 745 KB wire bytes of a whole-league subscription (`sts-superbet/data/ws-probe-ipl.json` 745 546 B vs `ws-probe-noipl.json` 326 355 B). A 10-minute listing alone would cost 3.4× today's hourly full pass, so incremental makes STS more expensive. Betcris and pzbuk: one request or subscription returns the whole league in about 1 s (betcris 10.9 MB / 19 games, `betcris-pzbuk/swarm-bulk-stats.json`; pzbuk 8.3 MB / 19 events, `pzbuk-direct2-results.json`). Incremental would save bytes only when most events are more than 24 h away, and it needs new request shapes against undocumented protocols. All three keep the full pass at `SCRAPE_INTERVAL_MINUTES`. On the future base betcris keeps its browser path for good (owner C: no Node Swarm client, plan 05b blocked), which makes an extra pass even more expensive. Near-kickoff freshness for them is Open Question 1. Delta-based WebSocket updates (a non-goal of plan 05a that points here) are also out of scope: they would keep a session open across ticks, which the listing/detail split does not model.
- Not migrated here either: totalbet and Betby (recovery 4a/4c, built on the future base). Their scrapers are built on injected `FetchJson`/`FetchText`, not `HttpScraper`, and still `extends PlaywrightScraper`; plan 02 Tasks 11–12 give them a budget, `transport = "http"` and `transportStats()`. totalbet's `fetchLeagueEvents`/`fetchEventDetail` (`totalbet/api-client.ts:84-124`, `:146-169`) map 1:1 onto `listEvents`/`fetchEvent`, so it can adopt the contract later with the recipe of Task 7 (Open Question 4); Betby's whole league comes from one cached snapshot, like the WebSocket scrapers. Both keep the full pass here.
- **Plan 09 semantics this plan relies on** (`$E/db-pipeline/proposed-write-model.sql`): `odds_snapshot.last_seen_at` = "last successful confirmation of this snapshot" (`:39`). The save RPC sets `last_run_id` on every write and keeps `last_seen_at` on a degenerate write (`:165-166`). `odds_current.changed_at` moves only when content changes (`:62`). `latest_odds.scraped_at` is `last_seen_at` (`:245`, `:262`). `cleanup_odds` deletes snapshots unseen for 24 h (`:329`). Neither `last_seen_at` nor `changed_at` records "last detail fetch", so this plan adds `last_detail_at` and `listing_fingerprint`. **Rule:** an event counts as seen in a run iff `save_odds_snapshot` wrote it non-degenerately in that run, or `record_incremental_pass` confirmed it (listed, not started, `status='ok'`, same fingerprint, detail younger than the cap). Both set `last_seen_at = now` and `last_run_id = run`. Every observability or plan 09 rule keyed on those columns (bookmaker freshness, stale exclusion, the 24 h cleanup) therefore treats a confirmed event like a written one. An event that is not listed, has started, or whose detail is due but failed is not confirmed, so it ages normally.
  - No per-tier widening of the stale threshold is needed (plan 09 no longer asks for it): a listed, unchanged event is confirmed on every pass, so its `last_seen_at` is at most one pass old. Plan 09's `staleAfterMs` threshold (observability's, `bookmaker-status.ts:66-68`) stays as written and flags only real failures; under the owner's B12 it only makes them visible.
  - Plan 09 Task 8 rejects writes after kickoff before touching the snapshot, so a rejected event keeps its old `last_run_id` and is never stamped.
  - Plan 09's degenerate-write guard is off by default (owner B13), so `status = 'degenerate'` only occurs if the owner turns it on; the due-plan still treats it as "always due".
- Plan 07's coordinator writes one `scraper_runs` outcome per (bookmaker, league) unit, and observability builds every status and alert on those rows **in hourly units**: `ALERT_CONSECUTIVE_FAILURES=3` (owner B8) means "3 failed hourly runs", `STATUS_WINDOW_RUNS = 50` (`bookmaker-status.ts:63`) is ~50 h, `[ScrapeRun]` is one line per league per run (`run-alerts.ts:12-31`), and the league alert fires when at least half the run's outcomes are `empty` (`run-alerts.ts:63-69`; owner A6: `empty` is a failure). A 10-minute tick that wrote outcomes would shrink all of these sixfold, and a pass with nothing due would be classified `empty`. So outcomes stay hourly (Tasks 4–5): incremental ticks record none, and the hourly tick records one per (bookmaker, league) that summarizes the hour.
- Restart-time `lastFullAt`: observability has no `getStalestOkRunAt`; the stalest league's newest OK run is `min` over `CONFIG.ENABLED_LEAGUES` of `getLastSuccessfulScrapeTime(league)` (`scraper-run-repository.ts:342-362`; `null` when any league has none or the read fails).

**Part B** (line numbers on the future base: scratch merge of `recovery/integration` `aaf7c07` + `recovery/observability` `f0361f0` + `recovery/fortuna` `a8cdb71`).
- Inventory, re-measured with a TypeScript-AST scan of all of `src/scrapers` (tests excluded; the evidence scripts hard-code the repo path and read only `<bm>/index.ts`): **1 858 lines** of `scrapeLeague`/`scrapeMatch`/`scrapeMatchDetails`/`extractEventUrls`/`scrapeEkstraklasa`/`scrapePremierLeague` bodies (was 2 061 on `master`), plus ~416 lines of helpers only they use (`legacy-helpers.mts` method, was ≥ 411): **~2 300 lines** in total. The scan includes 12 lines in `betclic/tab-scraper.ts` (deleted by plan 06 Task 1) and 6 lines of wrappers in `playwright-base.ts:52-54, :59-61`. Locations that moved or are new since the plan was written:
  - totalbet `index.ts:75-202` (`scrapeLeague`, `scrapeMatch`, `scrapeMatchDetails`) and `:218-220` (`extractEventUrls`), plus the legacy-only `orientedMatchWinnerOdds` (`:335-345`) and its `Market1X2Odds` type import (`:17`);
  - Betby `shared/betby/scraper.ts:184-281`, plus the legacy-only `quotes` (`:71-87`), `halfLineTotals` (`:89-106`) and the outcome-id constants (`:53-57`); `competitorNames` (`:63-69`) is also used by `fullEvent` and stays; `bookmakers/betters/index.ts` and `bookmakers/lebull/index.ts` are thin subclasses with no legacy method;
  - pzbuk `index.ts:107-272` and `:493-495` (pzbuk.md Task 3 was implemented, 0ac0629).
  Plans 03–05 move the remaining brands' legacy methods into `<Brand>BrowserScraper` classes, so Task 13 ports the scan.
- Legacy surface: abstract members `playwright-base.ts:47, :66, :71, :76` (with the wrappers `:49-61`); legacy-only result helpers `:237-292` (`createErrorResult` … `createNotImplementedResult`) and `executeLeagueScrape` `:392-407`; legacy type imports `:8-14` (keep `ScraperConfig`). The aggregator's legacy runners (`AggregatedResult`, `runAllScrapers`, `runSingleScraper`) are **already deleted by plan 02 Task 6**; observability Task 7 already removed the `scraper-service.ts` import and observability Task 4 removed `insertScraperRuns`. What is left in `scraper-run-repository.ts` is the dead `ScraperRunRecord`/`insertScraperRun`/`updateScraperRun` block (`:55-134`, no caller in `src/`, `scripts/` or tests). Types: `src/types/scraper.ts:14-82, :97-132`, `src/types/full-offer.ts:140-175` (`MarketOverUnderOdds` … `MarketBTTSOdds`).
- The only callers are `scripts/test-scrapers.sh:207, 237, 346, 400, 411`. `getScraper` (`aggregator.ts:193-195`) is used by observability's `scripts/smoke-bookmaker.ts:24, 93, 175` and stays.
- Legacy tests that Part B deletes:
  - totalbet `__tests__/scraper.test.ts:119-130` (`totalbet scrapeLeague returns list 1X2 rows`, `totalbet scrapeMatchDetails reads 1X2 from the detail`) and `:266-314` (`scrapeLeague drops an event whose 1X2 outcome names do not match …`, `scrapeLeague reports unknown leagues and list errors`, `scrapeMatch finds one event from the list`, `scrapeMatchDetails reports detail errors and refuses a misoriented 1X2`);
  - Betby `shared/betby/__tests__/scraper.test.ts:91-101` (`scrapeLeague returns listing 1X2 and scrapeMatchDetails reads the event endpoint`), `:169-213` (`scrapeLeague fails fast …`, `scrapeMatch finds a fixture …`, three `scrapeMatchDetails …` tests) and `:229-231` (`extractEventUrls returns no entries`);
  - pzbuk `__tests__/parser.test.ts:131` (`describe("pzbuk legacy helpers on numeric wire ids")`); pzbuk.md's acceptance A10 runs `test-scrapers.sh test pzbuk`, which Task 12 ports;
  - `src/scrapers/base/__tests__/navigation-diagnostics.test.ts` keeps its `TestScraper` (`:641-688`) but loses its legacy members (`:676-687`) and the legacy type import (`:10`) in Task 17.
- Docs that describe the legacy API: `CLAUDE.md:60-81`, `README.md:76-78`, `src/scrapers/bookmakers/sts/README.md:108-126`.
- Leftovers that the other performance plans assign here:
  - plan 01 leaves dead cache types and `CACHE_TTL` constants in `<bm>/types.ts`/`constants.ts`;
  - plan 03 keeps each rest-market brand's `CATEGORY_IDS` (plus a drift guard in `shared/rest-market/__tests__/category-ids.test.ts`) only for the browser fallback;
  - plans 03–05 keep `<Brand>BrowserScraper` behind README §3's one-pick rule: plans 03, 04 and 05c pick in `src/scrapers/bookmakers/index.ts`, 05a and 05b in the brand module (Task 18 lists each location and test). Plan 05b is blocked by the owner (C: no Node Swarm client), so betcris stays on its browser path as its **primary** implementation and has no fallback class to delete.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/shared/incremental/incremental-scraper.ts` (new) | `EventRef`, `IncrementalScraper`, `isIncrementalScraper`, `fetchFullOfferIncrementally` | 1 |
| `src/scrapers/shared/incremental/listing-fingerprint.ts` (new) | `listingFingerprint` | 1 |
| `src/services/incremental/due-plan.ts` (new) | tiers, `planDetailFetches` | 2 |
| `supabase/migrations/16_incremental_scrape_state.sql`, `supabase/sql-tests/16_incremental_scrape_state.test.sql` (new) | two columns, `record_incremental_pass`, SQL test | 3 |
| `src/repositories/incremental-state-repository.ts` (new), `src/types/database.ts` | state read, RPC call, typing | 3 |
| `src/services/incremental/incremental-pass.ts` (new) | `runIncrementalPass`, `finalizeIncrementalPass`, `DryRunLedger`, `IncrementalHourLedger`, `classifyIncrementalOutcome`, log line | 4 |
| `src/config/incremental.ts` (new) | `readIncrementalConfig` | 5 |
| `src/services/incremental/scrape-dispatch.ts` (new) | `planTick`, `scrapeForRun`, `withScrapeMode` | 5 |
| plan 07: `src/services/run-coordinator.ts`, `src/scrapers/aggregator.ts` (`runFullOfferCycle`), `src/services/scraper-service.ts` (`runScrapeCycle`), `src/services/interval-scheduler.ts`, `src/services/scheduler-service.ts` | `modes`/`recordOutcomes` pass-through, mode wrapper around `scrapeWithHardDeadline`, hourly outcomes only (no outcome, `[ScrapeRun]` or alert on incremental ticks), finalize, tick by `planTick` | 5 |
| `src/scrapers/shared/rest-market/{brand,runner,rest-market-scraper}.ts` and `brands/*.ts` (plan 03) | `teamsOf`, `listRestMarketEvents`/`fetchRestMarketEvent`, `IncrementalScraper` | 6 |
| `src/scrapers/bookmakers/{fortuna,superbet,lvbet}/http-scraper.ts` (plan 04) | implement `IncrementalScraper` | 7 |
| `src/scrapers/bookmakers/betclic/{types,constants,parser,index}.ts`, `betclic/__tests__/fixtures/listing-with-market-count.bin` (derived from plan 01's fixture) | listing market count, contract (kickoff from plan 01) | 8 |
| `src/services/incremental/incremental-report.ts`, `scripts/incremental-report.ts` (new) | dry-run / live report and criteria | 9 |
| `src/services/main-markets-summary.ts`, `scripts/scraper-check.ts` (new, on top of `scripts/smoke-bookmaker.ts`), `scripts/test-scrapers.sh` | full-offer port of the tester | 12 |
| `src/__tests__/helpers/legacy-scan.ts`, `scripts/legacy-lines.ts`, `src/scrapers/__tests__/legacy-path.test.ts` (new) | AST scan, CLI, guard | 13 |
| `src/scrapers/base/playwright-base.ts` | optional legacy members (13), legacy helpers deleted (17); the legacy aggregator runners are already gone (plan 02 Task 6) | 13, 17 |
| browser and HTTP scraper classes of each bookmaker, their parsers and tests | legacy methods and helpers deleted | 14–16 |
| `src/types/scraper.ts`, `src/types/full-offer.ts`, `src/repositories/scraper-run-repository.ts` (`:55-134`), `navigation-diagnostics.test.ts`, `CLAUDE.md`, `README.md`, `sts/README.md` | legacy types, dead run-repository writers and docs | 17 |
| `<Brand>BrowserScraper` files, their pick sites (`bookmakers/index.ts`, `sts/`, `pzbuk/`), the selection tests, `src/config/transport.ts` (stub), rest-market `CATEGORY_IDS` | browser fallback removal | 18 |

---

## Part A — adaptive, incremental scraping

### Task 1: Incremental contract and listing fingerprint

**Files:**
- Create: `src/scrapers/shared/incremental/incremental-scraper.ts`, `src/scrapers/shared/incremental/listing-fingerprint.ts`
- Test: `src/scrapers/shared/incremental/__tests__/listing-fingerprint.test.ts`, `src/scrapers/shared/incremental/__tests__/incremental-scraper.test.ts`

**Interfaces:**
- Consumes: §3 `FullOfferScraper`, `ScrapeBudget`, `createScrapeBudget`, `fetchDetailsSkippingFailures`, `HttpError`; plan 02 Task 5 `TransportStats`, `TransportStatsSource`, `hasTransportStats` (`src/scrapers/shared/scraper-contract.ts`); `FullMatchOffer` (`src/types/full-offer.ts:58-75`).
- Produces:
  ```ts
  export interface EventRef<L = unknown> {
    readonly eventId: string;            // === FullMatchOffer.matchId that fetchEvent returns
    readonly homeTeam: string;           // canonical, exactly what the full pass puts in FullMatchOffer.homeTeam
    readonly awayTeam: string;
    readonly kickoff: string | null;     // ISO 8601 UTC, ms precision: "2026-11-07T12:30:00.000Z"
    readonly fingerprint: string | null; // listingFingerprint(...) of the listing's prices; null when the listing has none
    readonly eventUrl: string;
    readonly listing: L;                 // the scraper's own listing record, handed back to fetchEvent; never persisted or logged
  }
  export interface IncrementalScraper<L = unknown> extends FullOfferScraper, TransportStatsSource {
    readonly detailConcurrency: number;
    listEvents(league: string, budget: ScrapeBudget): Promise<EventRef<L>[]>;   // same filter/order as the full pass; throws HttpError on a listing failure
    fetchEvent(league: string, ref: EventRef<L>, budget: ScrapeBudget): Promise<FullMatchOffer | null>;
    // null = the detail answered but maps to no markets (the full pass drops such events too); throws on a failed detail
  }
  export function isIncrementalScraper(s: FullOfferScraper): s is IncrementalScraper;   // hasTransportStats + listEvents/fetchEvent functions
  export function transportTotals(t: TransportStats): { requests: number; bytes: number };
  // requests = t.http?.requests ?? 0; bytes = (t.http?.bytes ?? 0) + (t.ws?.bytesReceived ?? 0)
  export function fetchFullOfferIncrementally<L>(s: IncrementalScraper<L>, league: string, budget: ScrapeBudget):
    Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }>;
  // listEvents, then fetchDetailsSkippingFailures(refs, r => r.eventId, (r) => s.fetchEvent(league, r, budget),
  //   { concurrency: s.detailConcurrency, budget }); non-null offers in listing order; no started-event filter (full-pass parity)
  export function listingFingerprint(parts: ReadonlyArray<readonly [key: string, value: number | string]>): string | null;
  // null for no parts; throws Error(`duplicate fingerprint key ${key}`); sort by key, JSON.stringify, sha1 hex, first 16 chars
  ```

- [ ] **Step 1: Write the failing tests**
  ```ts
  const P = [["1:0", 2.75], ["1:1", 3.3], ["1:2", 2.55], ["count", 491]] as const;
  it("is a pinned 16-hex sha1 prefix", () => expect(listingFingerprint(P)).toBe("41f59ecfdb96fa22"));
  it("ignores part order", () => expect(listingFingerprint([P[3], P[2], P[0], P[1]])).toBe("41f59ecfdb96fa22"));
  it("changes with one price", () => expect(listingFingerprint([P[0], P[1], ["1:2", 2.6], P[3]])).toBe("4dab8becf9018ad7"));
  it("is null without parts", () => expect(listingFingerprint([])).toBeNull());
  it("rejects duplicate keys", () => expect(() => listingFingerprint([P[0], ["1:0", 2.8]])).toThrow("duplicate fingerprint key 1:0"));
  // incremental-scraper.test.ts: fake scraper with refs e1,e2,e3,e4; fetchEvent("e2") rejects with
  // new HttpError("http", "https://x/e2", 503, "fetch HTTP 503 https://x/e2"); fetchEvent("e4") resolves null
  it("isIncrementalScraper needs listEvents, fetchEvent and transportStats", () => {
    expect(isIncrementalScraper(fake)).toBe(true);
    expect(isIncrementalScraper({ bookmaker: "forbet", scrapeFullOffer: vi.fn(), cleanup: vi.fn() } as any)).toBe(false);
  });
  it("fetchFullOfferIncrementally keeps listing order, skips failed details and drops empty ones", async () => {
    const r = await fetchFullOfferIncrementally(fake, "premier-league", createScrapeBudget(10_000));
    expect(r.matches.map((m) => m.matchId)).toEqual(["e1", "e3"]);
    expect(r.skipped).toEqual([{ id: "e2", error: "fetch HTTP 503 https://x/e2" }]);
  });
  it("transportTotals sums http and ws", () =>
    expect(transportTotals({ http: { requests: 3, retries: 0, failures: 0, bytes: 900, byStatus: {} }, ws: { framesReceived: 2, bytesReceived: 100 } }))
      .toEqual({ requests: 3, bytes: 1000 }));
  it("fetchFullOfferIncrementally propagates a listing failure", async () =>
    await expect(fetchFullOfferIncrementally(failingListing, "premier-league", createScrapeBudget(10_000))).rejects.toThrow("fetch HTTP 404"));
  ```
- [ ] **Step 2: Run and confirm failure.** `npx vitest run src/scrapers/shared/incremental`: modules not found.
- [ ] **Step 3: Implement** the two modules as specified (`createHash("sha1")` from `node:crypto`).
- [ ] **Step 4: Run and confirm pass.** Same command, all green; `npx tsc --noEmit` exit 0.
- [ ] **Step 5: Commit.** `git add src/scrapers/shared/incremental && git commit -m "feat(incremental): IncrementalScraper contract and listing fingerprint"`

### Task 2: Due plan

**Files:**
- Create: `src/services/incremental/due-plan.ts`
- Test: `src/services/incremental/__tests__/due-plan.test.ts`

**Interfaces:**
- Consumes: `EventRef` (Task 1).
- Produces:
  ```ts
  export const PASS_TOLERANCE_MS = 120_000;
  export const HARD_CAP_NEAR_MS = 2 * 3_600_000;  // kickoff within 72 h or unknown
  export const HARD_CAP_FAR_MS = 6 * 3_600_000;
  export type TierLabel = "lt1h" | "1to3h" | "3to24h" | "24to72h" | "gt72h" | "noKickoff";
  export const TIER_MAX_AGE_MS: Record<TierLabel, number>;   // 10, 20, 60, 120, 360, 10 minutes
  export function tierOf(kickoffMs: number | null, now: number): TierLabel;   // ms to kickoff: (-∞,1h) [1h,3h) [3h,24h) [24h,72h) [72h,∞)
  export interface EventFetchState { lastDetailAt: number | null; fingerprint: string | null; status: "ok" | "degenerate" }
  export type DueReason = "forced" | "never-fetched" | "degenerate" | "fingerprint-changed" | "tier-age";
  export type NotDueReason = "started" | "fresh";
  export interface DueDecision { ref: EventRef; due: boolean; reason: DueReason | NotDueReason; tier: TierLabel; ageMs: number | null }
  export function planDetailFetches(refs: readonly EventRef[], stateOf: (ref: EventRef) => EventFetchState | undefined,
    now: number, opts?: { forceAll?: boolean }): DueDecision[];
  ```
- Precedence, first match wins: kickoff ≤ now → `started` (never due, even when forced); `forceAll` → `forced`; no state or `lastDetailAt === null` → `never-fetched`; `status === "degenerate"` → `degenerate`; `ref.fingerprint !== null && ref.fingerprint !== state.fingerprint` → `fingerprint-changed` (a null ref fingerprint never triggers; a null stored fingerprint against a non-null ref does); `ageMs + PASS_TOLERANCE_MS >= TIER_MAX_AGE_MS[tier]` → `tier-age`; else `fresh`. `ageMs = now - lastDetailAt`, or null without state.

- [ ] **Step 1: Write the failing test** — one table, `now = Date.parse("2026-11-07T12:00:00.000Z")` (times without a date are on 2026-11-07), a ref factory `ref(kickoff, fp = "aaaa")`, a state factory `st(lastDetail, fp = "aaaa", status = "ok")`:

  | name | kickoff | lastDetailAt / state | ref fp | → due, reason, tier |
  |---|---|---|---|---|
  | never fetched | `2026-11-09T12:00Z` | none | aaaa | true, never-fetched, 24to72h |
  | started a minute ago | `11:59Z` | none | aaaa | false, started, lt1h |
  | kickoff equals now | `12:00Z` | `11:00Z` | aaaa | false, started |
  | lt1h age 7 min is fresh | `12:30Z` | `11:53Z` | aaaa | false, fresh, lt1h |
  | lt1h age 8 min is due | `12:30Z` | `11:52Z` | aaaa | true, tier-age, lt1h |
  | 59:59.999 is still lt1h | `12:59:59.999Z` | `11:50Z` | aaaa | true, tier-age, lt1h |
  | exactly 1 h is 1to3h, 17 min fresh | `13:00Z` | `11:43Z` | aaaa | false, fresh, 1to3h |
  | 1to3h 18 min due | `13:00Z` | `11:42Z` | aaaa | true, tier-age |
  | 3h boundary, 57 min fresh | `15:00Z` | `11:03Z` | aaaa | false, fresh, 3to24h |
  | 3to24h 58 min due | `15:00Z` | `11:02Z` | aaaa | true, tier-age |
  | 24h boundary, 117 min fresh | `2026-11-08T12:00Z` | `10:03Z` | aaaa | false, fresh, 24to72h |
  | 24to72h 118 min due | `2026-11-08T12:00Z` | `10:02Z` | aaaa | true, tier-age |
  | 72h boundary, 5h57 fresh | `2026-11-10T12:00Z` | `06:03Z` | aaaa | false, fresh, gt72h |
  | gt72h 5h58 due | `2026-11-10T12:00Z` | `06:02Z` | aaaa | true, tier-age, gt72h |
  | 71h59 uses the 2 h tier | `2026-11-10T11:59Z` | `10:02Z` | aaaa | true, tier-age, 24to72h |
  | fingerprint changed | `2026-11-10T12:00Z` | `11:50Z`, fp bbbb | aaaa | true, fingerprint-changed |
  | null listing fp never triggers | `2026-11-10T12:00Z` | `11:50Z`, fp bbbb | null | false, fresh |
  | null stored fp triggers | `2026-11-10T12:00Z` | `11:50Z`, fp null | aaaa | true, fingerprint-changed |
  | degenerate snapshot | `2026-11-10T12:00Z` | `11:50Z`, status degenerate | aaaa | true, degenerate |
  | detail never stamped | `2026-11-10T12:00Z` | lastDetailAt null | aaaa | true, never-fetched |
  | unknown kickoff 8 min due | null | `11:52Z` | aaaa | true, tier-age, noKickoff |
  | unknown kickoff 7 min fresh | null | `11:53Z` | aaaa | false, fresh, noKickoff |

  Plus `it("forceAll fetches fresh events but never started ones")`: a fresh gt72h ref → `forced`; a started ref → `started`. And `it("caps inside 72 h never exceed 2 h", () => expect(Math.max(...["lt1h","1to3h","3to24h","24to72h","noKickoff"].map((t) => TIER_MAX_AGE_MS[t]))).toBe(HARD_CAP_NEAR_MS))`.
- [ ] **Step 2: Run and confirm failure.** `npx vitest run src/services/incremental/__tests__/due-plan.test.ts`: module not found.
- [ ] **Step 3: Implement** `tierOf` and `planDetailFetches` (pure, no `Date.now()`).
- [ ] **Step 4: Run and confirm pass**, 24 cases green; `npx tsc --noEmit` exit 0.
- [ ] **Step 5: Commit.** `git add src/services/incremental && git commit -m "feat(incremental): kickoff-tier due plan with jitter tolerance"`

### Task 3: Detail state in `odds_snapshot` (migration 16) and its repository

**Files:**
- Create: `supabase/migrations/16_incremental_scrape_state.sql`, `src/repositories/incremental-state-repository.ts`
- Modify: `src/types/database.ts` (plan 09's `odds_snapshot` Row/Insert/Update gain the two columns; `Functions` gains `record_incremental_pass`, where `cleanup_old_odds` sat at `:245-248` before plan 09 Task 9 removed it)
- Test: `src/repositories/__tests__/incremental-state-repository.test.ts`, `supabase/sql-tests/16_incremental_scrape_state.test.sql`

**Interfaces:**
- Consumes: plan 09 migration 13's `matches`/`odds_snapshot` (columns as in `$E/db-pipeline/proposed-write-model.sql:16-46`); `EventFetchState`, `HARD_CAP_NEAR_MS`, `HARD_CAP_FAR_MS` (Task 2); `getSupabase` (`src/config/database.ts:8`); observability's `createFakeSupabase` (with plan 09 Task 2's `rpc` recording), `parseDbTimestamp` and `formatDbError`.
- Produces:
  ```sql
  ALTER TABLE odds_snapshot ADD COLUMN last_detail_at timestamptz, ADD COLUMN listing_fingerprint text;  -- no backfill: NULL = never stamped = due
  record_incremental_pass(p_run_id uuid, p_bookmaker text, p_fetched jsonb, p_confirmed jsonb,
    p_cap_near interval DEFAULT '2 hours', p_cap_far interval DEFAULT '6 hours') RETURNS jsonb  -- {"stamped","confirmed","not_confirmed","confirmed_rows"}
  -- p_fetched / p_confirmed: [{"match_id": text, "fingerprint": text|null}]
  -- stamp:   SET last_detail_at = last_seen_at, listing_fingerprint = f.fingerprint
  --          WHERE match/bookmaker match AND last_run_id = p_run_id AND status = 'ok'   (only rows the save RPC accepted in this run)
  -- confirm: SET last_seen_at = clock_timestamp(), last_run_id = p_run_id
  --          WHERE match/bookmaker match AND status = 'ok' AND listing_fingerprint IS NOT DISTINCT FROM f.fingerprint
  --            AND last_detail_at > now - (CASE WHEN start_time > now + 72 h THEN p_cap_far ELSE p_cap_near END)
  --            AND (start_time IS NULL OR start_time > now)
  -- not_confirmed = jsonb_array_length(p_confirmed) - confirmed; confirmed_rows = Σ row_count of the confirmed snapshots (UPDATE … RETURNING row_count),
  --   the rows those confirmations keep current: Task 4's hourly outcome counts them as saved. REVOKE from PUBLIC, anon, authenticated; GRANT to service_role;
  -- NOTIFY pgrst, 'reload schema';
  ```
  ```ts
  export interface PassKey { matchKey: string; fingerprint: string | null }
  export async function getIncrementalState(leagueSlug: string, bookmaker: PolishBookmaker): Promise<Map<string, EventFetchState>>; // key = match_id
  export async function recordIncrementalPass(runId: string, bookmaker: PolishBookmaker, fetched: PassKey[], confirmed: PassKey[]):
    Promise<{ stamped: number; confirmed: number; notConfirmed: number; confirmedRows: number }>;
  ```
  Both throw `Error("odds_snapshot state read failed: <formatDbError>")` / `Error("record_incremental_pass failed: <formatDbError>")`. Caps are passed as `"2 hours"` / `"6 hours"`, computed from the Task 2 constants.

- [ ] **Step 1: Write the failing tests.** Mock `../../config/database.js` with `vi.mock(path, async () => ({ getSupabase: () => fake.client }))`, where `fake = createFakeSupabase(respond)`. `respond` answers `odds_snapshot` with `{ data: rows }` (or `{ error: dbError }`) and `rpc:record_incremental_pass` with `{ data: rpcData }`.
  ```ts
  it("reads state for one league and bookmaker", async () => {
    rows = [{ match_id: "premier-league:leeds:tottenham", status: "ok", last_detail_at: "2026-11-07T11:50:00+00:00", listing_fingerprint: "41f59ecfdb96fa22" },
            { match_id: "premier-league:arsenal:hull city", status: "degenerate", last_detail_at: null, listing_fingerprint: null }];
    const m = await getIncrementalState("premier-league", "forbet");
    expect(fake.queries[0]).toEqual({ table: "odds_snapshot", calls: [["select", "match_id,status,last_detail_at,listing_fingerprint"], ["eq", "league_slug", "premier-league"], ["eq", "bookmaker", "forbet"]] });
    expect(m.get("premier-league:leeds:tottenham")).toEqual({ lastDetailAt: Date.parse("2026-11-07T11:50:00Z"), fingerprint: "41f59ecfdb96fa22", status: "ok" });
    expect(m.get("premier-league:arsenal:hull city")).toEqual({ lastDetailAt: null, fingerprint: null, status: "degenerate" });
  });
  it("throws with the DB cause", async () => { dbError = { code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." };
    await expect(getIncrementalState("premier-league", "forbet")).rejects.toThrow("odds_snapshot state read failed: Could not query the database for the schema cache. Retrying. [PGRST002]"); });
  it("calls the RPC with match ids, fingerprints and caps", async () => {
    rpcData = { stamped: 2, confirmed: 15, not_confirmed: 1, confirmed_rows: 4210 };
    expect(await recordIncrementalPass("440d2fc6-658b-46fe-b288-05261faa0caf", "forbet",
      [{ matchKey: "premier-league:leeds:tottenham", fingerprint: "aaaa" }], [{ matchKey: "premier-league:arsenal:hull city", fingerprint: null }]))
      .toEqual({ stamped: 2, confirmed: 15, notConfirmed: 1, confirmedRows: 4210 });
    expect(fake.queries.find((q) => q.table === "rpc:record_incremental_pass")!.calls[0][1]).toEqual({ p_run_id: "440d2fc6-658b-46fe-b288-05261faa0caf", p_bookmaker: "forbet",
      p_fetched: [{ match_id: "premier-league:leeds:tottenham", fingerprint: "aaaa" }], p_confirmed: [{ match_id: "premier-league:arsenal:hull city", fingerprint: null }],
      p_cap_near: "2 hours", p_cap_far: "6 hours" });
  });
  ```
  `16_incremental_scrape_state.test.sql` follows plan 09's convention (`\set ON_ERROR_STOP 1`, `DO $$ BEGIN ASSERT …; END $$;`). It inserts `matches` rows and then three `odds_snapshot` rows under run `11111111-…`, `status 'ok'`, `last_seen_at now()`: far (kickoff now + 100 h), near (now + 30 h), and a third with `status 'degenerate'`. It asserts, in order (this exact function body was verified on a throwaway `postgres:16` on 2026-11-07; the harness runs the 17.6 image):
  1. Stamping all three under `1111…` → `{"stamped": 2, "confirmed": 0, "not_confirmed": 0}`, and `last_detail_at = last_seen_at` on the two `ok` rows.
  2. Stamping under `2222…` → `stamped` 0.
  3. Confirming far/aaaa, near/bbbb, near/XXXX and degenerate/cccc under `3333…` → `confirmed` 2, `not_confirmed` 2, `confirmed_rows` = the two snapshots' `row_count` sum. The two confirmed rows have `last_run_id = '3333…'` and `last_seen_at > last_detail_at`.
  4. Far detail 5 h 59 min old and near detail 2 h 1 min old → `confirmed` 1, `not_confirmed` 1.
  5. Near snapshot with `start_time = now() - interval '1 minute'` → `confirmed` 0.
  6. Null fingerprint on both sides → `confirmed` 1.
  7. `NOT has_function_privilege('anon', 'record_incremental_pass(uuid,text,jsonb,jsonb,interval,interval)', 'EXECUTE')`.
- [ ] **Step 2: Run and confirm failure.** `$H npx vitest run src/repositories/__tests__/incremental-state-repository.test.ts`: module not found. `$H scripts/sql-test.sh supabase/sql-tests/16_incremental_scrape_state.test.sql`: `function record_incremental_pass … does not exist`.
- [ ] **Step 3: Implement** the repository, the types and the migration. The migration's header comment states the "seen in a run" rule from Observations.
- [ ] **Step 4: Run and confirm pass.** Both commands: vitest green, `SQL TESTS PASSED`. Then `npx tsc --noEmit` exit 0.
- [ ] **Step 5: Commit.** `git add supabase/migrations/16_incremental_scrape_state.sql supabase/sql-tests/16_incremental_scrape_state.test.sql src/repositories/incremental-state-repository.ts src/repositories/__tests__/incremental-state-repository.test.ts src/types/database.ts && git commit -m "feat(db): odds_snapshot detail state and record_incremental_pass"`. The owner applies it in Task 11.

### Task 4: Incremental pass runner

**Files:**
- Create: `src/services/incremental/incremental-pass.ts`
- Test: `src/services/incremental/__tests__/incremental-pass.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; §3 `fetchDetailsSkippingFailures`, `MAX_SKIPPED_DETAIL_RATIO`, `HttpError`; `generateMatchId` (`src/repositories/full-offer-repository.ts:65-69`, exported by plan 09 Task 1), the function that yields `odds_snapshot.match_id`; observability's `BookmakerRunStatus`, `classifyBookmakerRun` (with plan 07 Task 0's `partial` rule) and `NormalizeAndSaveResult`.
- Produces:
  ```ts
  export const MIN_DUE_FOR_FAILURE_RATIO = 4;
  export type PassMode = "incremental" | "forced" | "plan-only";
  export interface IncrementalPassStats {
    mode: PassMode; ledger: "db" | "warm" | "cold"; listed: number; dropped: number; started: number; due: number;
    fetched: number; skipped: number; noMarkets: number; confirmed: number; nameMismatch: number;  // noMarkets: fetchEvent returned null
    byReason: Partial<Record<DueReason | NotDueReason, number>>;
    listingRequests: number; listingBytes: number; requests: number; bytes: number; durationMs: number;
    preAgeMinByTier: Partial<Record<TierLabel, number>>;   // max whole minutes since last detail, measured BEFORE fetching, non-started events with a known lastDetailAt
  }
  export interface IncrementalPassResult extends FullOfferScraperResult {
    incremental: IncrementalPassStats; pending: { fetched: PassKey[]; confirmed: PassKey[] };
  }
  export interface IncrementalPassDeps {
    loadState(league: string, bookmaker: PolishBookmaker): Promise<Map<string, EventFetchState>>;  // default getIncrementalState
    recordPass(runId: string, bookmaker: PolishBookmaker, fetched: PassKey[], confirmed: PassKey[]):
      Promise<{ stamped: number; confirmed: number; notConfirmed: number }>;                    // default recordIncrementalPass
    matchKey(home: string, away: string, league: string): string;                              // default generateMatchId
    now(): number; log(line: string): void;                                                    // Date.now, console.log
  }
  export class DryRunLedger { stateOf(bookmaker: PolishBookmaker, matchKey: string): EventFetchState | undefined;
    hasLeague(bookmaker: PolishBookmaker, league: string): boolean; markFetched(bookmaker: PolishBookmaker, league: string, key: PassKey, at: number): void; }
  export const dryRunLedger: DryRunLedger;
  export function runIncrementalPass(scraper: IncrementalScraper, league: string,
    opts: { runId: string; budget: ScrapeBudget; mode: PassMode; ledger?: DryRunLedger }, deps?: Partial<IncrementalPassDeps>): Promise<IncrementalPassResult>;
  export function finalizeIncrementalPass(result: IncrementalPassResult, runId: string, deps?: Partial<IncrementalPassDeps>):
    Promise<{ stamped: number; confirmed: number; notConfirmed: number; confirmedRows: number } | { recordError: string } | null>;
    // null: no record call was made (plan-only, or both lists empty)
  export function isIncrementalPassResult(r: FullOfferScraperResult): r is IncrementalPassResult;
  // Hourly units (Review Focus 6): only the hourly tick records outcomes; incremental ticks are noted here.
  export interface HourSummary { passes: number; failedPasses: number; firstError: string | null }
  export class IncrementalHourLedger {
    note(bookmaker: PolishBookmaker, league: string, r: IncrementalPassResult): void;  // counts a pass; failed = !success or skipped > 0
    take(bookmaker: PolishBookmaker, league: string): HourSummary;                    // returns and resets; zeros when nothing was noted
  }
  export const incrementalHourLedger: IncrementalHourLedger;   // in memory; a restart loses at most one hour of notes (they are in the [IncrementalPass] lines)
  export function classifyIncrementalOutcome(r: IncrementalPassResult, save: NormalizeAndSaveResult | null,
    record: { confirmedRows: number } | { recordError: string } | null, hour: HourSummary):
    { status: BookmakerRunStatus; error: string | null; matchesFound: number; marketsFound: number; marketsSaved: number };
  ```
- `classifyIncrementalOutcome` rules, first match wins (the hourly outcome of one incremental bookmaker and league; `eligible = listed - dropped - started`):
  1. Listing failed → `scrape_failed`, `error` = the listing message.
  2. `eligible === 0` → `empty` with observability's text (`Scraper reported success with 0 matches`). Owner A6 counts it as a failure, exactly as for a full pass.
  3. `!r.success` (more than half of ≥ 4 due details failed) → `scrape_failed`, `error` = `r.error`.
  4. `fetched > 0` and `save.marketsSaved === 0` → `classifyBookmakerRun({ success: true, matches: r.matches, error: r.error }, save)` (its `persist_failed` cause).
  5. `record` is `{ recordError }` and nothing was saved → `persist_failed`, `error` = `record_incremental_pass failed: …` (unconfirmed snapshots will age into `stale`).
  6. Otherwise `marketsSaved = (save?.marketsSaved ?? 0) + (record?.confirmedRows ?? 0)` (rows this pass kept current), and the causes `r.error`, the save errors (`summarizeErrors` style), a `recordError` and, when `hour.failedPasses > 0`, `` `${hour.failedPasses} of ${hour.passes} incremental passes this hour failed | ${hour.firstError}` `` are joined with `" | "`: none → `success` with `error: null`, any → `partial`.
  - `matchesFound = eligible`; `marketsFound` = the raw markets of the fetched offers.
  - So "nothing due, everything confirmed" is `success` with the confirmed rows as `marketsSaved` (A10 stays meaningful), never `empty`.
- Flow of `runIncrementalPass` (never throws):
  1. `listEvents`. On failure, return `success:false`, `error` = the error message, empty `pending`.
  2. Key every ref with `matchKey(ref.homeTeam, ref.awayTeam, league)`. Drop keys whose home and away segments are equal (`dropped`), the same test as `full-offer-repository.ts:619-626`.
  3. State: `ledger` for `plan-only`, otherwise `loadState`. If `loadState` fails, use an empty map, log `[IncrementalPass] state unavailable for <bm>/<league>: <message>; fetching all`, and set `ledger: "db"`.
  4. `planDetailFetches` with `forceAll` when `mode === "forced"`.
  5. Unless `plan-only`, fetch the due refs with `fetchDetailsSkippingFailures` at `scraper.detailConcurrency`.
  6. `pending.fetched` uses `matchKey(offer.homeTeam, offer.awayTeam, league)`, so a name mismatch still stamps the right row and is counted and logged (Review Focus 1). A `null` offer is counted in `noMarkets` and is neither stamped nor confirmed. `pending.confirmed` = the `fresh` decisions.
  7. `success = !(due >= MIN_DUE_FOR_FAILURE_RATIO && skipped / due > MAX_SKIPPED_DETAIL_RATIO)`. `error` = `"<skipped> of <due> details failed | <first error>"` whenever `skipped > 0`.
  8. `plan-only` marks every due ref fetched in the ledger at `now()` and returns `matches: []`.
- `finalizeIncrementalPass` calls `recordPass` (skipped for `plan-only` and when both lists are empty), then logs exactly one line: `[IncrementalPass] ` + `JSON.stringify({ runId, bookmaker, league, ...stats, stamped, notConfirmed, confirmedRows, stampMiss: fetched - stamped, error })`. `stamped`, `notConfirmed`, `confirmedRows` and `stampMiss` are `null` when no record call was made. A `recordPass` failure is logged as `[IncrementalPass] record failed <bm>/<league>: <message>`, returns `{ recordError: <message> }` and does not throw. It returns the record result otherwise, and `null` when it made no call.

- [ ] **Step 1: Write the failing tests.** Use a fake scraper with refs and offers in memory, fake deps (`now = 2026-11-07T12:00Z`, `matchKey = (h, a, l) => \`${l}:${h.toLowerCase()}:${a.toLowerCase()}\``) and `createScrapeBudget(10_000)`:
  - `fetches only due events and confirms fresh ones`: never-fetched A (gt72h), fresh B (gt72h, age 10 min), started C. `fetchEvent` is called once with A. Expect `matches` [A], `pending` `{ fetched: [{ matchKey: "premier-league:a home:a away", fingerprint: "fa" }], confirmed: [{ matchKey: "…b…", fingerprint: "fb" }] }`, and stats `{ listed: 3, started: 1, due: 1, fetched: 1, confirmed: 1, byReason: { "never-fetched": 1, fresh: 1, started: 1 } }`.
  - `drops refs whose home and away resolve to the same key` (`Leeds` v `Leeds`): `dropped: 1`, never fetched or confirmed.
  - `a listing failure fails the pass with the HttpError message`: `listEvents` rejects with `fetch HTTP 503 https://api.example/list`. Expect `{ success: false, error: "fetch HTTP 503 https://api.example/list" }` and empty `pending`.
  - `state read failure fetches every non-started event`.
  - `one failed detail of two keeps success and leaves it due`: `success: true`, `error: "1 of 2 details failed | fetch HTTP 503 https://x/e2"`, e2 in neither pending list.
  - `three failures of four due fail the pass`: `success: false`.
  - `forced mode fetches fresh events`: `byReason.forced` = 2.
  - `name mismatch is counted and the stamp uses the offer key`: ref `Leeds` v `Tottenham`, offer `Leeds United` v `Tottenham`. Expect `nameMismatch: 1`, `pending.fetched[0].matchKey === "premier-league:leeds united:tottenham"`, and the warning logged once.
  - `plan-only fetches nothing and warms the ledger`: first pass `ledger: "cold"`, 3 due, `fetchEvent` not called. Second pass 10 min later: `ledger: "warm"`; only an lt1h ref is due.
  - `preAgeMinByTier reports ages before fetching`: a gt72h ref aged 358 min that becomes due → `preAgeMinByTier.gt72h === 358`.
  - `transport deltas`: `transportTotals(transportStats())` goes 10/1000 → 11/1500 after listing → 13/9500 after details. Expect `listingRequests 1, listingBytes 500, requests 3, bytes 8500`.
  - `finalize logs one JSON line after recording`: `recordPass` resolves `{ stamped: 0, confirmed: 1, notConfirmed: 0, confirmedRows: 220 }` for 1 fetched. The line starts with `[IncrementalPass] {` and parses to include `"stampMiss":1` and `"confirmedRows":220`; the call returns the record result.
  - `finalize survives a record failure` (returns `{ recordError }`, logs `record failed`).
  - `nothing due with all events confirmed is success, not empty`: listed 19, due 0, confirmed 19, record `confirmedRows` 4210 → `{ status: "success", error: null, matchesFound: 19, marketsSaved: 4210 }`.
  - `an empty listing is empty (owner A6)`: listed 0 → `status: "empty"`.
  - `the hourly outcome carries the hour's failed passes`: `note` 5 passes, one with `success:false` and `error` `fetch HTTP 503 https://api.example/list`; then an OK hourly pass → `partial`, `error` `1 of 5 incremental passes this hour failed | fetch HTTP 503 https://api.example/list`; a second `take` returns zeros.
  - `a listing failure on the hourly tick is scrape_failed`, and `three failures of four due are scrape_failed with the cause`.
  - `a failed record with nothing saved is persist_failed`.
- [ ] **Step 2: Run and confirm failure.** `npx vitest run src/services/incremental/__tests__/incremental-pass.test.ts`: module not found.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run and confirm pass**; `npx tsc --noEmit` exit 0.
- [ ] **Step 5: Commit.** `git add src/services/incremental && git commit -m "feat(incremental): pass runner with stamp/confirm bookkeeping and dry-run ledger"`

### Task 5: Configuration, tick planning and coordinator wiring (outcomes in hourly units)

**Files:**
- Create: `src/config/incremental.ts`, `src/services/incremental/scrape-dispatch.ts`
- Modify (plan 07's files, as built on top of observability):
  - `src/services/run-coordinator.ts` (`RunRequest` + `modes?`, `recordOutcomes?`);
  - `src/services/scraper-service.ts` (`ScrapeCycleOptions` + `modes?`, `recordOutcomes?`, passed to `runFullOfferCycle`; with `recordOutcomes: false` it skips `insertBookmakerRunOutcomes`, the in-memory outcome history, the `[ScrapeRun]` line, `buildRunAlerts`/`emitAlerts` and the `lastResults` merge for that run);
  - `src/scrapers/aggregator.ts` (`FullOfferCycleRequest` + `modes?`, `recordOutcomes?`; per unit: `scrapeWithHardDeadline(withScrapeMode(…), job, signal)`, then the save, then `finalizeIncrementalPass`, then the outcome rule below; observability's per-unit function is `runFullOfferForBookmaker`, `:261-333`, if plan 07 kept that name);
  - `src/services/interval-scheduler.ts` (`request` may return `null`: log `[Scheduler] nothing due`, schedule the next tick with `computeNextDelayMs`);
  - `src/services/scheduler-service.ts` (wire `planTick`, `lastFullAt`, interval);
  - `.env.example` (the three variables, commented, after observability's `# Alerts` block).
- Unchanged and must stay green: observability's `run-alerts.ts` (`formatRunSummaryLine` `:12-31`, `buildRunAlerts` `:48-88`, the "half empty" league rule `:63-69`), `bookmaker-status.ts` (`STATUS_WINDOW_RUNS = 50`, `:63`) and their tests. They keep their hourly meaning because they only ever see hourly outcomes.
- Test: `src/config/__tests__/incremental.test.ts`, `src/services/incremental/__tests__/scrape-dispatch.test.ts`, plus cases appended to plan 07's aggregator-cycle, scrape-cycle and interval-scheduler tests

**Interfaces:**
- Consumes: Tasks 1, 4. Plan 07: `RunRequest`, `RunCoordinator.start`, `IntervalScheduler`/`computeNextDelayMs`, `runScrapeCycle`, `runFullOfferCycle`, `scrapeWithHardDeadline`, and the `fake-scrapers.ts` helpers. Observability: `getLastSuccessfulScrapeTime` (`src/repositories/scraper-run-repository.ts:342-362`; there is no `getStalestOkRunAt`). `ALL_POLISH_BOOKMAKERS` (`src/config/index.ts:6`).
- Produces:
  ```ts
  export interface IncrementalConfig { bookmakers: ReadonlySet<PolishBookmaker>; passMinutes: number; dryRun: boolean; error: string | null }
  export function readIncrementalConfig(env: NodeJS.ProcessEnv, scrapeIntervalMinutes: number): IncrementalConfig;
  export type ScrapeMode = "full" | "incremental" | "plan-only";
  export interface TickPlan { modes: Partial<Record<PolishBookmaker, ScrapeMode>>; hourly: boolean }   // hourly === fullDue
  export function planTick(i: { now: number; lastFullAt: number | null; fullIntervalMs: number;
    bookmakers: readonly PolishBookmaker[]; cfg: IncrementalConfig }): TickPlan;
  export function scrapeForRun(bookmaker: PolishBookmaker, scraper: FullOfferScraper, league: string, mode: ScrapeMode,
    ctx: { runId: string; budget: ScrapeBudget; cfg: IncrementalConfig }): Promise<FullOfferScraperResult>;
  export function withScrapeMode(bookmaker: PolishBookmaker, scraper: FullOfferScraper, mode: ScrapeMode,
    ctx: { runId: string; cfg: IncrementalConfig }): FullOfferScraper;
  // { bookmaker, scrapeFullOffer: (league, budget) => scrapeForRun(bookmaker, scraper, league, mode, { ...ctx, budget }),
  //   cleanup: () => scraper.cleanup(), transportStats (forwarded when hasTransportStats(scraper)),
  //   transport (forwarded from the wrapped scraper, so plan 07's DeclaresTransport classification is unchanged) }
  export async function stalestOkRunAt(leagues: readonly string[]): Promise<number | null>;
  //   min over leagues of getLastSuccessfulScrapeTime(league); null when any league has none
  // plan 07 additive fields: RunRequest / ScrapeCycleOptions / FullOfferCycleRequest gain
  //   `modes?: Partial<Record<PolishBookmaker, ScrapeMode>>` (absent = "full" for every bookmaker: startup and admin runs)
  //   `recordOutcomes?: boolean` (absent = true: startup, admin and every non-incremental configuration behave as today)
  ```
- `planTick` rules:
  - `fullDue = lastFullAt === null || now - lastFullAt >= fullIntervalMs - 60_000`; `hourly = fullDue`.
  - A bookmaker in `cfg.bookmakers`:
    - not dry-run → `incremental` on every tick;
    - dry-run → `full` when `fullDue`, otherwise `plan-only`.
  - Any other bookmaker → `full` when `fullDue`, otherwise omitted.
  - An empty `modes` map means the tick starts no run.
- `scrapeForRun` rules:
  - Not `isIncrementalScraper` → `scrapeFullOffer`. A non-`full` mode for such a scraper logs `[Incremental] <bm> is not incremental-capable; running the full pass` once per process.
  - Capable, `full`, and either not in `cfg.bookmakers` or dry-run → `scrapeFullOffer(league, budget)`, then log `[FullPassCost] {"runId","bookmaker","league","matches","requests","bytes","durationMs"}` from the `transportTotals` delta (`transportStats()` is cumulative, README §3). In dry-run, follow it with `runIncrementalPass(mode "plan-only")` and finalize it, and return the full result.
  - Capable, `full`, in `cfg.bookmakers`, not dry-run → `runIncrementalPass(mode "forced")`. This stamps state, so startup and admin runs are full passes that keep the bookkeeping.
  - `incremental` → `runIncrementalPass(mode "incremental")`.
  - `plan-only` → `runIncrementalPass(mode "plan-only")`, then finalize.
- **Outcomes in hourly units** (Review Focus 6). The interval scheduler's request carries `recordOutcomes: plan.hourly`.
  - **Hourly tick** (`recordOutcomes` true; startup and admin runs too): every unit produces exactly one outcome. A plain result goes through `classifyBookmakerRun` as today. An `IncrementalPassResult` of mode `incremental` or `forced` goes through `classifyIncrementalOutcome(result, save, record, incrementalHourLedger.take(bm, league))` (Task 4), where `record` is `finalizeIncrementalPass`'s return value. `[ScrapeRun]`, the alerts and `scraper_runs` work as today, so `ALERT_CONSECUTIVE_FAILURES=3` still means three failed hours, `STATUS_WINDOW_RUNS` still covers ~50 h, and the "half the bookmakers empty" league alert still compares whole hourly runs.
  - **Incremental tick** (`recordOutcomes` false; only incremental bookmakers run, because `planTick` omits the others): each unit saves its fetched offers and finalizes the pass, then calls `incrementalHourLedger.note(bm, league, result)`. No outcome is pushed: no `scraper_runs` row, no `[Aggregator/FullOffer] <bm> <status>:` line, no `[ScrapeRun]` line and no alert (in particular no league "0 matches" alert from a small tick). The `[IncrementalPass]` line carries the pass's own figures and error.
  - `plan-only` passes (dry-run) never produce an outcome and are not noted.
- Wiring in plan 07:
  - `runFullOfferCycle`'s unit wraps the scraper with `withScrapeMode(bm, scraper, req.modes?.[bm] ?? "full", { runId, cfg })` before `scrapeWithHardDeadline`. Transport, budget and the hard deadline are resolved from the unwrapped scraper as before.
  - After the save, the unit calls `finalizeIncrementalPass(result, runId)` when `isIncrementalPassResult(result) && result.incremental.mode !== "plan-only"`, then applies the outcome rule above.
  - `IntervalScheduler` ticks every `cfg.passMinutes` (same `computeNextDelayMs` jitter) when `cfg.bookmakers.size > 0`, otherwise every `SCRAPE_INTERVAL_MINUTES` as before.
  - Its `request("interval")` returns `{ trigger: "interval", leagues: CONFIG.ENABLED_LEAGUES, bookmakers: keys(plan.modes), modes: plan.modes, recordOutcomes: plan.hourly }`, or `null` for an empty map. `request("startup")` is unchanged (no `modes`, outcomes recorded).
  - `lastFullAt` starts at `await stalestOkRunAt(CONFIG.ENABLED_LEAGUES)` and is set to `now` whenever `planTick` returns `hourly: true`.
  - `readIncrementalConfig(process.env, CONFIG.SCRAPE_INTERVAL_MINUTES)` is logged once at startup: `[Incremental] bookmakers=<list|none> passMinutes=<n> dryRun=<bool>`, or the error.

- [ ] **Step 1: Write the failing tests**
  - `readIncrementalConfig`: `{}` → `{ bookmakers: ∅, passMinutes: 10, dryRun: false, error: null }`. `INCREMENTAL_BOOKMAKERS="forbet, etoto"` → `{forbet, etoto}`. `"forbet,nosuch"` → `bookmakers` ∅, `error: "INCREMENTAL_BOOKMAKERS: unknown bookmaker nosuch"`. `INCREMENTAL_PASS_MINUTES="4"` (interval 60) → ∅ and `"INCREMENTAL_PASS_MINUTES must be an integer between 5 and 60"`. `INCREMENTAL_DRY_RUN="true"` and `"1"` → `dryRun: true`; `"yes"` → false.
  - `planTick` with the 14 `CONFIG.BOOKMAKERS`, interval 60 min, `now = 12:00Z`:
    - no cfg, `lastFullAt` null → 14 × `full`, `hourly: true`;
    - no cfg, 11:30Z → `{ modes: {}, hourly: false }`;
    - no cfg, 11:01Z → 14 × `full`, `hourly: true`;
    - cfg `{forbet, etoto}`, 11:50Z → `{ modes: { forbet: "incremental", etoto: "incremental" }, hourly: false }`;
    - same at 11:00Z → those two `incremental` plus 12 × `full`, `hourly: true`;
    - dry-run at 11:50Z → `{ forbet: "plan-only", etoto: "plan-only" }`, `hourly: false`;
    - dry-run at 11:00Z → 14 × `full`, `hourly: true`.
  - `stalestOkRunAt`: `getLastSuccessfulScrapeTime` mocked per league (10:00Z, 11:00Z) → 10:00Z; one league `null` → `null`.
  - `scrapeForRun` with fakes:
    - non-capable + `incremental` → `scrapeFullOffer` called, warning logged once across two calls;
    - capable + `full`, enabled, not dry-run → `runIncrementalPass` in `forced` mode (asserted through the returned `incremental.mode`);
    - capable + `full`, dry-run → `[FullPassCost]` line with `"requests":20`, then one `[IncrementalPass]` line with `"mode":"plan-only"`, returning the full result;
    - `withScrapeMode` forwards `transport` and `transportStats`.
  - Plan 07's cycle tests (`fakeScraper` made incremental with a fake `listEvents` and `loadState` mocked):
    - `an incremental tick records no outcome and emits no [ScrapeRun] or alert` (`recordOutcomes: false`, every bookmaker listing 0 events: `insertBookmakerRunOutcomes` not called, no `[ScrapeRun]` line, no `[ALERT]` line; the save and `finalizeIncrementalPass` still ran once per unit);
    - `the hourly tick records one outcome per unit through classifyIncrementalOutcome` (one fresh ref confirmed with `confirmedRows` 220 → `success`, `marketsSaved` 220; a failure noted on an earlier incremental tick turns it into `partial` with `1 of 2 incremental passes this hour failed | …`);
    - `startup and admin runs record outcomes as today` (no `recordOutcomes` field).
  - Plan 07's interval-scheduler test: `a null request skips the tick and schedules the next one` (`coordinator.start` not called), and `the hourly flag reaches the run request`.
- [ ] **Step 2: Run and confirm failure.** `$H npx vitest run src/config/__tests__/incremental.test.ts src/services/incremental/__tests__/scrape-dispatch.test.ts` plus the plan 07 test files.
- [ ] **Step 3: Implement** the modules and the plan 07 wiring as specified.
- [ ] **Step 4: Run and confirm pass**; `$H npx tsc --noEmit` and the full `$H npx vitest run` green. With `INCREMENTAL_BOOKMAKERS` unset, plan 07's and observability's existing tests pass unchanged (every request records outcomes as today).
- [ ] **Step 5: Commit.** `git add src/config/incremental.ts src/config/__tests__/incremental.test.ts src/services/incremental src/services/run-coordinator.ts src/services/scraper-service.ts src/scrapers/aggregator.ts src/services/interval-scheduler.ts src/services/scheduler-service.ts src/services/__tests__ src/scrapers/__tests__ .env.example && git commit -m "feat(scheduler): incremental passes behind INCREMENTAL_BOOKMAKERS, outcomes in hourly units"`

### Task 6: Rest-market family (forbet, etoto, fuksiarz, betfan)

**Files:**
- Modify (plan 03's files):
  - `src/scrapers/shared/rest-market/brand.ts`: `RestMarketBrand<E>` gains `teamsOf(event: E, league: string): { homeTeam: string; awayTeam: string }` and `listingPrices(event: E): Array<[string, number]>`.
  - `runner.ts`: split `fetchRestMarketOffer` into `listRestMarketEvents` + `fetchRestMarketEvent`; `fetchRestMarketOffer` keeps its signature and now composes them.
  - `rest-market-scraper.ts`: `RestMarketHttpScraper<E> implements IncrementalScraper<E>`, and `fetchFullOffer` = `fetchFullOfferIncrementally(this, league, budget)`.
  - `brands/{etoto,forbet,fuksiarz,betfan}.ts`: the two new brand members, built from the same helpers `to<Brand>Offer` uses.
- Test: `src/scrapers/shared/rest-market/__tests__/incremental.test.ts`
- Fixtures: plan 03's `src/scrapers/shared/rest-market/__tests__/fixtures/<brand>/` (`list.json` with 3 games per event, `detail-<id>.json`):
  - forbet: 57945888, 57945911, 57945945;
  - etoto: 6262615, 6224070, 6224074, 6224078;
  - fuksiarz: 23464740, 23464877, 23615576;
  - betfan: 40932985, 40933001, 40932982.

**Interfaces:**
- Consumes: Task 1; plan 03's `RestMarketBrand<E>`, `REST_MARKET_DETAIL_CONCURRENCY`, `loadFixtureRoutes`, `withoutScrapedAt`; plan 01's `toIsoStartTime` (`src/scrapers/shared/start-time.ts`; plan 03 imports it instead of defining `kickoffIso`, cross-plan review #16); `createReplayHttpClient` (§3).
- Produces:
  ```ts
  export function listRestMarketEvents<E>(brand: RestMarketBrand<E>, http: HttpClient, league: string, budget: ScrapeBudget): Promise<EventRef<E>[]>;
  // listing → brand.isMatch filter, listing order; kickoff = toIsoStartTime(eventStart) ?? null;
  // fingerprint = listingFingerprint([...brand.listingPrices(e), ["gamesCount", e.gamesCount]])
  export function fetchRestMarketEvent<E>(brand: RestMarketBrand<E>, http: HttpClient, league: string, ref: EventRef<E>, budget: ScrapeBudget): Promise<FullMatchOffer | null>;
  // detail → brand.toOffer(ref.listing, detail, league)
  ```
  - `listingPrices` = `[\`o:${outcomeId}\`, outcomeOdds]` for every outcome of every listing game: `eventGames` for forbet/etoto/fuksiarz, `games` for betfan.
  - `detailConcurrency` = `REST_MARKET_DETAIL_CONCURRENCY` (4). `transportStats()` is plan 02's `HttpScraper` implementation.

- [ ] **Step 0: Record the full-pass baselines** before any code change (README §6 gate 2 needs the old code; read-only, outside HH:55–HH:10), one brand at a time: `$H --live npx tsx scripts/perf-smoke.ts --bookmaker forbet --out .scratch/perf-smoke/forbet-before.json`, then etoto, fuksiarz, betfan.
- [ ] **Step 1: Write the failing tests** (`new <Brand>HttpScraper(createReplayHttpClient(loadFixtureRoutes(dir, URLS)))`, `budget = createScrapeBudget(10_000)`):
  - `forbet listing refs`: `refs.map((r) => [r.eventId, r.kickoff])` equals `[["57945888","2026-11-07T12:30:00.000Z"], ["57945911","2026-11-07T15:00:00.000Z"], ["57945945","2026-11-07T15:00:00.000Z"]]`. Every fingerprint matches `/^[0-9a-f]{16}$/`.
  - `fuksiarz and betfan first refs`: `{ eventId: "23464740", kickoff: "2026-11-07T12:30:00.000Z" }` and `{ eventId: "40932985", kickoff: "2026-11-07T12:30:00.000Z" }`.
  - `fetchEvent over every ref equals the full pass` (all four brands, including etoto's `Dzień meczowy` entry): `(await Promise.all(refs.map((r) => s.fetchEvent(league, r, budget)))).filter(Boolean).map(withoutScrapedAt)` deep-equals `(await s.scrapeFullOffer(league, budget)).matches.map(withoutScrapedAt)`. In addition, `refs[i].homeTeam`/`awayTeam` equal the offer's.
  - `etoto refs equal the full pass's match ids`: `refs.map((r) => r.eventId)` equals the listing ids that pass `ETOTO_REST_MARKET.isMatch`, in listing order.
  - `fingerprint follows prices only`: in a cloned forbet `list.json`, set event 57945888's first `outcomeOdds` 2.75 → 2.8. Only that ref's fingerprint changes. Reversing `data` changes none.
  - `transportStats counts replayed requests`: after `listEvents`, `transportTotals(s.transportStats()).requests === 1`.
- [ ] **Step 2: Run and confirm failure.** `npx vitest run src/scrapers/shared/rest-market`: `listEvents is not a function`.
- [ ] **Step 3: Implement.** Plan 03's `runner.test.ts` and `<brand>-transport.test.ts` (browser vs HTTP deep-equal) stay unchanged and green; that is the parity proof.
- [ ] **Step 4: Run and confirm pass**; `npx tsc --noEmit`, full `npx vitest run`, golden unchanged. Then the live parity gate (README §6 (2)), one brand at a time, outside HH:55–HH:10, in the same hour:
  1. In the same hour as that brand's Step 0 run (repeat Step 0 if the hour has passed): `$H --live npx tsx scripts/perf-smoke.ts --bookmaker forbet --baseline .scratch/perf-smoke/forbet-before.json`. Expected: exit 0 and `PARITY` pass.
  2. Repeat for etoto, fuksiarz and betfan.
- [ ] **Step 5: Commit.** `git add src/scrapers/shared/rest-market && git commit -m "feat(rest-market): listEvents/fetchEvent for forbet, etoto, fuksiarz, betfan"`

### Task 7: Fortuna, superbet, lvbet

**Files:**
- Modify: `src/scrapers/bookmakers/{fortuna,superbet,lvbet}/http-scraper.ts` (plan 04's `FortunaHttpScraper`, `SuperbetHttpScraper`, `LVBetHttpScraper`): `implements IncrementalScraper`, and `fetchFullOffer` = `fetchFullOfferIncrementally(this, league, budget)`
- Test: `src/scrapers/bookmakers/{fortuna,superbet,lvbet}/__tests__/incremental.test.ts`
- Fixtures: plan 04's `__tests__/fixtures/http-migration/` per brand. Its lvbet competition-view has `primary_column_markets` emptied, so add one with prices, from the worktree root (checked 2026-11-07: 22 936 B, 3 matches, 24 primary markets):
  ```bash
  P=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence/lvbet-fuksiarz
  F=src/scrapers/bookmakers/lvbet/__tests__/fixtures/incremental
  mkdir -p $F && $H python3 -I -c "import json,sys; cv=json.load(open(sys.argv[1])); keep=['bc:31340648','bc:31340666','bc:31419246']; cv['matches']=[m for m in cv['matches'] if m['match_id'] in keep]; cv['primary_column_markets']=[p for p in cv['primary_column_markets'] if p['match_id'] in keep]; json.dump(cv,open(sys.argv[2],'w'),ensure_ascii=False,separators=(',',':'))" $P/lv_comp.json $F/competition-view-with-primary.json
  ```

**Interfaces:**
- Consumes: Task 1. Plan 04: `selectFortunaFixtures`/`mapFortunaFixtureOffer`, `selectUpcomingSuperbetEvents`/`mapSuperbetEventOffer`, `selectLvbetMatches`/`mapLvbetMatchOffer`, plus the listing and detail URL builders.
- Produces (detail concurrency 4, `transportStats()` from `HttpScraper`):
  - fortuna:
    - `listEvents` = fixtures listing → `selectFortunaFixtures`;
    - `fingerprint: null` (Observations);
    - kickoff = `new Date(startDatetime).toISOString()`;
    - `fetchEvent` = `/fixture/{id}/markets` → `mapFortunaFixtureOffer`.
  - superbet:
    - `listEvents` = by-date listing → `selectUpcomingSuperbetEvents(events, Date.now())`;
    - parts `[\`o:${uuid}\`, price]` per `odds[]`, plus `["marketCount", marketCount]`;
    - kickoff = `new Date(utcDate).toISOString()`, never `matchDate`.
  - lvbet:
    - `listEvents` = competition-view → `selectLvbetMatches`;
    - parts `[\`s:${selection_id}\`, rate.decimal]` for every `primary_column_markets` entry with the match's `match_id`, plus `["markets_count", state.markets_count]`;
    - kickoff = `new Date(date).toISOString()`.

- [ ] **Step 1: Write the failing tests** (plan 04's replay routes; superbet with `vi.setSystemTime("2026-11-07T00:00:00Z")`):
  - `fortuna refs`: `[eventId, kickoff, fingerprint]` equals `[["ufo:mtch:1xi-0a0","2026-11-07T15:00:00.000Z",null], ["ufo:mtch:1xi-0a1","2026-11-07T15:00:00.000Z",null], ["ufo:mtch:1xi-09z","2026-11-07T12:30:00.000Z",null]]`, in `selectFortunaFixtures` order.
  - `superbet refs`: `refs.map((r) => r.eventId)` equals `["14438722", "14438716", "14656301"]`. That is kickoff order, and the synthetic FINISHED `14438720` is dropped by `selectUpcomingSuperbetEvents`. `14438722` has `kickoff "2026-11-07T12:30:00.000Z"`. Changing its price 2.77 → 2.8 changes only its fingerprint.
  - `lvbet refs` on `competition-view-with-primary.json`: `bc:31340648` has `kickoff "2026-11-08T14:00:00.000Z"`. Changing its first primary rate 3.95 → 4.0 changes only its fingerprint.
  - For each brand on plan 04's fixtures: `fetchEvent over every ref equals the full pass`, as in Task 6.
- [ ] **Step 2: Run and confirm failure.** `npx vitest run src/scrapers/bookmakers/fortuna src/scrapers/bookmakers/superbet src/scrapers/bookmakers/lvbet`.
- [ ] **Step 3: Implement.** Plan 04's `http-migration.test.ts` files stay unchanged and green.
- [ ] **Step 4: Run and confirm pass**; tsc, full vitest, golden unchanged. Then the Task 6 live parity gate per brand (Step 0-style `--out` baseline recorded before Step 3, `--baseline` after, same hour).
- [ ] **Step 5: Commit.** `git add src/scrapers/bookmakers/fortuna src/scrapers/bookmakers/superbet src/scrapers/bookmakers/lvbet && git commit -m "feat(http-scrapers): listEvents/fetchEvent for fortuna, superbet, lvbet"`

### Task 8: Betclic

**Files:**
- Modify:
  - `src/scrapers/bookmakers/betclic/types.ts:34-47`: `BetclicListingMatch` gains only `marketCount?: number`. Its `startTime?: string` (the **raw** listing field 3, e.g. `"2026-11-07T12:30:00.0000000Z"`) comes from plan 01 Task 4 and is reused unchanged (cross-plan review #2).
  - `constants.ts` `PROTO_FIELDS` (`:75-…`): add `MATCH_MARKET_COUNT: 7` next to plan 01's `MATCH_START_TIME: 3`.
  - `parser.ts` `parseListingResponse` (`:871-942`): read field 7 next to plan 01's field-3 read and set `marketCount` when it is a finite integer ≥ 0. Field 3 parsing is plan 01's and is not touched.
  - `index.ts` (as reshaped by plan 06): add `listEvents`/`fetchEvent`. Plan 06's `scrapeFullOffer` and its result contract stay as they are; this is the only scraper here whose full pass is not rebuilt, because plan 06 owns a budget-aware contract.
- Test: `src/scrapers/bookmakers/betclic/__tests__/incremental.test.ts`
- Fixtures (no live recording; cross-plan review #36):
  - plan 01's `src/scrapers/bookmakers/__tests__/fixtures/full-offer/betclic-listing.bin`, reused as is: one entry, `Leeds - Tottenham`, fields 1, 2, 3 (`2026-11-07T12:30:00.0000000Z`) and its 1X2 outcomes, **no field 7**;
  - `src/scrapers/bookmakers/betclic/__tests__/fixtures/listing-with-market-count.bin`, derived from it by inserting field 7 = 464 (the value of the 2026-11-07 02:47 CET capture for Leeds–Tottenham) and fixing the two enclosing length prefixes. From the worktree root (writer-verified on a scratch copy: 395 → 398 bytes):
    ```bash
    python3 -I - src/scrapers/bookmakers/__tests__/fixtures/full-offer/betclic-listing.bin \
      src/scrapers/bookmakers/betclic/__tests__/fixtures/listing-with-market-count.bin <<'EOF'
    import sys
    b = bytearray(open(sys.argv[1], 'rb').read())
    assert bytes(b[:6]) == bytes([0x0a, 0x88, 0x03, 0x1a, 0x85, 0x03]), bytes(b[:6]).hex()  # wrapper 392 B, match entry 389 B
    i = b.index(bytes([0x4a, 0xc8, 0x02]))       # field 9 (markets, 328 B) follows field 3
    b[i:i] = bytes([0x38, 0xd0, 0x03])           # field 7, varint 464
    b[1:3] = bytes([0x8b, 0x03]); b[4:6] = bytes([0x88, 0x03])   # 392 -> 395, 389 -> 392
    open(sys.argv[2], 'wb').write(b)
    EOF
    ```

**Interfaces:**
- Consumes: Task 1; plan 01's `toIsoStartTime` (`src/scrapers/shared/start-time.ts`) and `BetclicListingMatch.startTime`; plan 06's `fetchMatchOffer(m: BetclicListingMatch, ctx: MatchFetchContext): Promise<BetclicMatchOutcome>`, `resolveBetclicMatchConcurrency()`, `transportStats()`; `fetchLeagueMatches`, `parseListingResponse`.
- Produces: `BetclicPlaywrightScraper implements IncrementalScraper<BetclicListingMatch>`:
  - `detailConcurrency` = `resolveBetclicMatchConcurrency()`;
  - `listEvents` sets `kickoff = toIsoStartTime(m.startTime) ?? null` (`.000Z` ISO; no own conversion, no `kickoffIso`);
  - parts `[["1", homeOdds], ["X", drawOdds], ["2", awayOdds], ["marketCount", marketCount ?? -1]]`;
  - `fetchEvent` maps `fetchMatchOffer` outcomes: `written` → its offer; `skipped` with reason `0 markets parsed` → `null`; any other `skipped` → `throw new Error(reason)`; `budget` → `throw new BudgetExceededError()`;
  - `listEvents` logs `[Betclic/FullOffer] Found N events in listing` exactly as plan 06's full pass does, so `check-log-vs-smoke.py` (recovery `evidence/betclic/`) finds one run start per pass. `fetchEvent` keeps plan 06's per-match lines.

- [ ] **Step 1: Write the failing tests**:
  - `parseListingResponse reads the market count`: on the derived fixture `marketCount === 464`; on plan 01's fixture `marketCount` is `undefined`; `startTime` is plan 01's raw string on both.
  - `listing refs`: on plan 01's fixture one ref with `kickoff "2026-11-07T12:30:00.000Z"` and a 16-hex fingerprint; the derived fixture's fingerprint differs (the `marketCount` part).
  - `fetchEvent over every ref equals the full pass`: on plan 06's mocked group fetches (`arsenal-hull_{TOP,HANDICAP}` fixtures, or plan 01's `betclic-top.bin`), as in Task 6.
  - `one listing log line per pass`: a `console.log` spy over `listEvents` sees exactly one `[Betclic/FullOffer] Found <n> events in listing`.
- [ ] **Step 2: Run and confirm failure.** `$H npx vitest run src/scrapers/bookmakers/betclic`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass**; tsc, full vitest, golden (plan 01's `full-offer-fixtures.test.ts` betclic case unchanged). Then:
  - one read-only live check of field 7 (`$H --live`, outside HH:55–HH:10): a scratch `.scratch/betclic-field7.mts` prints `parseListingResponse(await fetchLeagueMatches("premier-league"), "premier-league").map((m) => [m.matchName, m.marketCount])`. Pass: every entry has an integer `marketCount` > 0 (nothing is written to the repo);
  - the Task 6 live parity gate for betclic (Step 0-style baseline before Step 3).
- [ ] **Step 5: Commit.** `git add src/scrapers/bookmakers/betclic && git commit -m "feat(betclic): listing market count and IncrementalScraper"`

### Task 9: Incremental report

**Files:**
- Create: `src/services/incremental/incremental-report.ts`, `scripts/incremental-report.ts`
- Test: `src/services/incremental/__tests__/incremental-report.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReportWindow = "quiet" | "matchday";
  export interface BookmakerLeagueReport {
    bookmaker: string; league: string; warmPasses: number; coldPasses: number; fullPasses: number;
    fullBytes: number; fullRequests: number; estBytes: number; estRequests: number;
    maxPreAgeMin: Partial<Record<TierLabel, number>>; failures: string[];
  }
  export interface IncrementalReport { window: ReportWindow; rows: BookmakerLeagueReport[]; totalsOk: boolean; ok: boolean; failures: string[] }
  export function buildIncrementalReport(lines: readonly string[], o: { from: number; to: number; window: ReportWindow }): IncrementalReport;
  export function formatIncrementalReport(r: IncrementalReport): string;
  ```
- Estimates:
  - Use `plan-only` (dry-run) or `incremental` (live) `[IncrementalPass]` lines with `ledger !== "cold"`, inside `[from, to)`.
  - `avgDetailBytes = (Σ full.bytes − fullPasses × median(listingBytes)) / Σ full.matches`. `avgDetailRequests` is computed the same way.
  - `estBytes = Σ listingBytes + Σ due × avgDetailBytes`. `estRequests` is computed the same way.
  - `--live` reads `incremental`/`forced` lines, counts `ledger: "db"` as warm, and evaluates only the pass-count and staleness criteria. It has no full-pass baseline; real `bytes`/`requests` are printed for information.
- Criteria per (bookmaker, league):
  - `warmPasses ≥ 130`, `coldPasses ≤ 2`, `fullPasses ≥ 22` (dry-run only).
  - Every `maxPreAgeMin[t] ≤ TIER_MAX_AGE_MS[t] / 60_000 + 12`.
  - quiet: `estBytes ≤ 1.0 × fullBytes`.
  - matchday: `estBytes ≤ 2.0 × fullBytes`, plus at least one observation in `lt1h` and in `1to3h`.
- Totals (quiet only): `Σ estBytes ≤ 0.6 × Σ fullBytes` and `Σ estRequests ≤ 0.9 × Σ fullRequests`.
- Script: `npx tsx scripts/incremental-report.ts --log <file> --from <ISO> --to <ISO> --window quiet|matchday [--live]`. It prints the table and exits 0 iff `ok`, 1 otherwise, and 2 on usage errors.

- [ ] **Step 1: Write the failing tests** with synthetic lines built by a helper `pass({...})` / `full({...})`:
  - `quiet window passes at under half the bytes`: 144 warm forbet passes, each with `listingBytes` 142 000 and `listingRequests` 1, Σ due 152, and 24 full passes of 19 matches at 6 500 000 bytes / 20 requests. Expect `fullBytes` 156 000 000, `estBytes` 71 312 000 (avg detail = 152 592 000 / 456), `fullRequests` 480, `estRequests` 296, and `ok: true`.
  - `staleness above tier + 12 min fails the window`: one pass with `preAgeMinByTier.lt1h = 23`. `failures` contains `forbet/premier-league: lt1h max age 23 min > 22`.
  - `cold passes are excluded and more than two fail`.
  - `matchday needs lt1h and 1to3h observations`.
  - `ignores lines outside the window and non-JSON lines`.
  - `formatIncrementalReport prints one row per bookmaker-league and PASS/FAIL`.
- [ ] **Step 2: Run and confirm failure.** `npx vitest run src/services/incremental/__tests__/incremental-report.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass**; tsc, full vitest, and the standalone script check `npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule scripts/incremental-report.ts` (exit 0).
- [ ] **Step 5: Commit.** `git add src/services/incremental scripts/incremental-report.ts && git commit -m "feat(incremental): dry-run and live report with pass criteria"`

### Task 10: Live dry-run (no code; owner steps)

Everything in Tasks 10–11 is an **owner step** (EXECUTION rules 3–4: implementers never start the server or write to the DB). The implementer hands over this checklist with the exact commands. **Start procedure:** observability Task 10 (`npm run dev:stack`) is not built, so the owner uses the documented one: Supabase stack up (`npx supabase status`), then `npm run dev` in the main checkout (README.md:150, :204; CLAUDE.md:44) with its output appended to a log file; if observability Task 10 has landed by then, `npm run dev:stack` replaces `npm run dev` below.

- [ ] **Step 1:** Merge Tasks 1–9. Migration 16 is not needed for the dry-run, because `plan-only` uses the in-memory ledger. In `.env`, set `INCREMENTAL_BOOKMAKERS=forbet,etoto,fuksiarz,betfan,fortuna,superbet,lvbet,betclic` and `INCREMENTAL_DRY_RUN=true`. The owner restarts once, outside HH:55–HH:10, with output appended to a file: `npm run dev 2>&1 | tee -a /tmp/aityper-incremental-dryrun.log`. Expected startup line: `[Incremental] bookmakers=forbet,etoto,fuksiarz,betfan,fortuna,superbet,lvbet,betclic passMinutes=10 dryRun=true`.
- [ ] **Step 2:** Leave it running until two 24 h windows are covered:
  - **quiet**: no enabled-league kickoff in `[T, T+48 h]`. Check with `RO_PSQL -c "select min(start_time) from matches where start_time > now()"`.
  - **matchday**: at least 3 kickoffs inside the window.
  
  Do not restart in between; a restart shows as a `cold` pass.
- [ ] **Step 3:** `npx tsx scripts/incremental-report.ts --log /tmp/aityper-incremental-dryrun.log --from <T> --to <T+24h> --window quiet`, then the same with `--window matchday` for its window. Pass: both exit 0. Keep both outputs in the PR description. If a bookmaker fails `estBytes`, leave it out of `INCREMENTAL_BOOKMAKERS` in Task 11 and record why.

### Task 11: Enable per group and verify live staleness (no code)

- [ ] **Step 1:** The owner applies migration 16 between runs (Global Constraints). Then `RO_PSQL -c "\d odds_snapshot"` lists `last_detail_at` and `listing_fingerprint`.
- [ ] **Step 2:** Enable group 1: `INCREMENTAL_BOOKMAKERS=forbet,etoto,fuksiarz,betfan`, `INCREMENTAL_DRY_RUN=false`. Restart once (Task 10's start procedure), outside HH:55–HH:10, with `npm run dev 2>&1 | tee -a /tmp/aityper-incremental.log`. During the next 24 h, run this hourly with `RO_PSQL` (outside HH:55–HH:10):
  ```sql
  select bookmaker,
    case when start_time - now() < interval '1 hour' then 'lt1h' when start_time - now() < interval '3 hours' then '1to3h'
         when start_time - now() < interval '24 hours' then '3to24h' when start_time - now() < interval '72 hours' then '24to72h' else 'gt72h' end tier,
    count(*) n, round(extract(epoch from max(now() - last_detail_at)) / 60) max_detail_min,
    round(extract(epoch from max(now() - last_seen_at)) / 60) max_seen_min
  from odds_snapshot where bookmaker = any('{forbet,etoto,fuksiarz,betfan}') and start_time > now() and status = 'ok'
  group by 1, 2 order by 1, 2;
  ```
  Pass criteria:
  - `max_detail_min` ≤ tier max + 12 (22 / 32 / 72 / 132 / 372);
  - `max_seen_min` ≤ 22, except for an event whose last pass logged a failed detail for it;
  - `npx tsx scripts/scraper-status.ts --league premier-league` shows the four as `available`;
  - `grep -c "record failed\|name mismatch" /tmp/aityper-incremental.log` = 0;
  - hourly units hold (Review Focus 6): per league, `grep -c "^\[ScrapeRun\] premier-league " /tmp/aityper-incremental.log` grows by 1 per hour, not by 6, and no `[ALERT]` line appears at a non-hourly tick;
  - `npx tsx scripts/incremental-report.ts --live --log /tmp/aityper-incremental.log --from <enable time> --to <enable time + 24 h> --window matchday` exits 0 if the day had ≥ 3 kickoffs; otherwise run it with `--window quiet`.
- [ ] **Step 3:** Repeat Step 2 for group 2 (`+fortuna,superbet,lvbet`), then group 3 (`+betclic`), 24 h each. If any criterion fails, remove that bookmaker from the list; it falls back to the full pass on the next tick.

## Part B — legacy removal

### Task 12: Port `scripts/test-scrapers.sh` to the full-offer path

**Files:**
- Create: `src/services/main-markets-summary.ts`, `scripts/scraper-check.ts`
- Modify: `scripts/test-scrapers.sh:23-38` (plain list of bookmaker keys), `:181-283` (`test_single_scraper`), `:319-365` (`quick_test`), `:368-476` (`compare_odds`)
- Test: `src/services/__tests__/main-markets-summary.test.ts`

**Interfaces:**
- Consumes: observability's `scripts/smoke-bookmaker.ts` as plan 02 Task 10 left it (`isBookmaker`, `scrapeOnce`: `getScraper(bm).scrapeFullOffer(league)` with a throw turned into a failed result, and its `closeAllBrowsers()`-in-`finally` pattern; reuse, do not copy), `getScraper`, `closeAllBrowsers` (`aggregator.ts`), `normalizeMarketsForBookmaker`, the catalog codes `MATCH_WINNER` (HOME/DRAW/AWAY), `DOUBLE_CHANCE` (HOME_OR_DRAW/DRAW_OR_AWAY/HOME_OR_AWAY), `TOTAL_GOALS` (`paramValue`, OVER/UNDER), `BTTS` (YES/NO).
- Produces:
  ```ts
  export interface MainMarketsSummary {
    x12?: { home: number; draw: number; away: number }; btts?: { yes: number; no: number };
    ou25?: { over: number; under: number }; ouLines: string[];   // sorted numerically
    dc?: { homeOrDraw: number; drawOrAway: number; homeOrAway: number };
  }
  export function summarizeMainMarkets(normalized: readonly ScrapedMarket[]): MainMarketsSummary;
  ```
- `scripts/scraper-check.ts` modes:
  - `--bookmaker <bm> --league <slug> [--match <text>]`: prints today's lines (`✓ Listing: N matches (Xms)`, `▸ Testing: H vs A`, `✓ Details: (Yms)`, `✓ 1X2: …`, `✓ BTTS: Yes … / No …` or `✗ BTTS: brak`, `✓ O/U 2.5: Over … / Under … (n lines)` or `✗ O/U: brak`, `✓ DC: …`). Exit 1 when the scrape fails, has 0 matches, or has no `MATCH_WINNER`.
  - `--quick --league <slug>`: the 7 bookmakers of `:330-338`.
  - `--compare <team> --league <slug>`: the 6 of `:385-392`, same three tables as today.
  - Always `closeAllBrowsers()` in `finally` (a failed close never changes the exit code, as in `smoke-bookmaker.ts`).
  - Like `perf-smoke`, it sets `SUPABASE_URL=http://127.0.0.1:9` before importing `src/` (dynamic imports), so it can never write to the DB.
- The shell keeps its menu, Polish messages and API commands. `test`, `test-all`, `quick` and `compare` call `npx tsx scripts/scraper-check.ts …` under `timeout 600`.

- [ ] **Step 1: Write the failing test**: synthetic normalized markets (`normalizedType`, `paramValue`, `selections[].normalizedName`):
  - `reads 1X2, BTTS, O/U 2.5 and DC`;
  - `lists O/U lines numerically` (`["0.5","1.5","2.5","10.5"]`);
  - `missing markets stay undefined`;
  - `ignores HALF_TIME_RESULT`.
- [ ] **Step 2: Run and confirm failure.** `npx vitest run src/services/__tests__/main-markets-summary.test.ts`.
- [ ] **Step 3: Implement** the module, the script and the shell changes.
- [ ] **Step 4: Run and confirm pass**; tsc; the standalone `tsc` command of Task 9 on `scripts/scraper-check.ts`; `bash -n scripts/test-scrapers.sh`; `grep -nE "scrapeLeague|scrapeMatchDetails|PlaywrightScraper|STSScraper" scripts/test-scrapers.sh` prints nothing. Live (read-only, outside HH:55–HH:10, one at a time): `$H --live bash scripts/test-scrapers.sh test forbet premier-league` prints `✓ Listing:` with ≥ 18 matches and the 1X2/BTTS/O/U 2.5/DC lines, exit 0. Then `$H --live bash scripts/test-scrapers.sh test pzbuk premier-league` (pzbuk.md acceptance A10 wording).
- [ ] **Step 5: Commit.** `git add src/services/main-markets-summary.ts src/services/__tests__/main-markets-summary.test.ts scripts/scraper-check.ts scripts/test-scrapers.sh && git commit -m "refactor(scripts): test-scrapers.sh uses scrapeFullOffer"`

### Task 13: Legacy scan, guard test, optional legacy members

**Files:**
- Create: `src/__tests__/helpers/legacy-scan.ts` (a repo-relative port of `$E/core/legacy-lines.mts` + `legacy-helpers.mts` that walks all of `src/scrapers`), `scripts/legacy-lines.ts`, `src/scrapers/__tests__/legacy-path.test.ts`, `src/__tests__/legacy-scan.test.ts`
- Modify: `src/scrapers/base/playwright-base.ts:47, :66, :71, :76` (become optional declarations: `scrapeLeague?(league: string): Promise<ScraperResult>;` etc.; checked to compile with `tsc --strict --declaration` on a scratch class), delete `:49-61` (`scrapeEkstraklasa`, `scrapePremierLeague` with their doc comments). Nothing else: plan 02 Task 6 already deleted `AggregatedResult`, `runAllScrapers` and `runSingleScraper` from `aggregator.ts` (`getScraper` stays), and observability Task 7 already removed the `scraper-service.ts` import. If plan 02 Task 6 has not landed, delete them here (`aggregator.ts:9`, `:50-188` on the future base).

**Interfaces:**
- Produces:
  ```ts
  export const LEGACY_METHODS: readonly string[];  // scrapeLeague, scrapeMatch, scrapeMatchDetails, extractEventUrls, scrapeEkstraklasa, scrapePremierLeague
  export interface LegacyMethodHit { file: string; className: string; method: string; startLine: number; endLine: number } // file relative to repo root
  export function findLegacyMethods(repoRoot: string): LegacyMethodHit[];   // method declarations WITH a body under src/scrapers, __tests__ excluded
  export function legacyDirOf(file: string): string;                       // first two segments under src/scrapers, e.g. "bookmakers/forbet", "shared/betby"
  export function findLegacyCalls(repoRoot: string): Array<{ file: string; line: number; method: string }>;
  //   property-access calls of LEGACY_METHODS in src/ and scripts/*.ts outside legacy method bodies, __tests__ excluded
  export interface LegacyHelperHit { file: string; name: string; startLine: number; endLine: number }
  export function findLegacyOnlyHelpers(repoRoot: string, pathFilter?: string): LegacyHelperHit[];
  //   ts.createProgram over src+scripts; exported function declarations under src/scrapers whose every reference (resolved via the
  //   checker, imports and __tests__ ignored) sits inside a legacy method or inside another legacy-only helper; iterate to a fixpoint
  export function exportedNames(repoRoot: string, file: string): string[];  // names of exported declarations (ts.createSourceFile, no program)
  ```
  `scripts/legacy-lines.ts [--path <substring>] [--helpers]` prints `file:start-end Class.method (n)` per hit, `TOTAL legacy method lines: N`, and with `--helpers` `file:start-end name (n)` plus `TOTAL legacy-only helper lines: N`.

- [ ] **Step 1: Write the failing tests.**
  - `legacy-scan.test.ts` builds a temp project with `mkdtempSync`:
    - `src/scrapers/bookmakers/x/index.ts` = `import { parse1, parseAll } from "./parser.js";` / `export class X {` / `  scrapeLeague() { return parse1(); }` / `  scrapeFullOffer() { return parseAll(); }` / `}` (one statement per line, in that order);
    - `src/scrapers/bookmakers/x/parser.ts` exports `parse1` and `parseAll`.
    
    Expected:
    - `findLegacyMethods` → `[{ file: "src/scrapers/bookmakers/x/index.ts", className: "X", method: "scrapeLeague", startLine: 3, endLine: 3 }]`;
    - `findLegacyOnlyHelpers` → `[{ name: "parse1", … }]`;
    - after adding `scripts/use.ts` that imports `parse1`, the result is `[]`;
    - an optional declaration without a body is not a hit.
  - `legacy-path.test.ts` on the real repo:
    ```ts
    const ALLOWED = new Set([/* every legacyDirOf(...) the scan reports at this commit; print them with `npx tsx scripts/legacy-lines.ts` */]);
    it("legacy 1X2 methods exist only in allowed directories", () =>
      expect([...new Set(findLegacyMethods(ROOT).map((h) => legacyDirOf(h.file)))].filter((d) => !ALLOWED.has(d))).toEqual([]));
    it("nothing calls a legacy 1X2 method", () => expect(findLegacyCalls(ROOT)).toEqual([]));
    it("test-scrapers.sh calls no legacy method", () =>
      expect(readFileSync(join(ROOT, "scripts/test-scrapers.sh"), "utf8")).not.toMatch(/\.(scrapeLeague|scrapeMatchDetails|scrapeMatch|extractEventUrls)\(/));
    it("aggregator exports no legacy runner", () => {
      const names = exportedNames(ROOT, "src/scrapers/aggregator.ts");
      for (const n of ["runAllScrapers", "runSingleScraper", "AggregatedResult"]) expect(names).not.toContain(n);
      expect(names).toContain("getScraper");
    });
    ```
- [ ] **Step 2: Run and confirm failure.** `$H npx vitest run src/__tests__/legacy-scan.test.ts src/scrapers/__tests__/legacy-path.test.ts`: the scan module is missing. (The "aggregator exports no legacy runner" case already passes after plan 02 Task 6; it stays as a guard.)
- [ ] **Step 3: Implement** the scan, the CLI and the base edits. Fill `ALLOWED` from `$H npx tsx scripts/legacy-lines.ts`.
- [ ] **Step 4: Run and confirm pass**; tsc, full vitest; the standalone `tsc` on `scripts/legacy-lines.ts`. `$H npx tsx scripts/legacy-lines.ts | tail -1` prints `TOTAL legacy method lines: <n>`; record `n` in the commit body (the future base measured 1 858 before plans 03–06 moved and deleted code).
- [ ] **Step 5: Commit.** `git add src/__tests__ src/scrapers/__tests__/legacy-path.test.ts scripts/legacy-lines.ts src/scrapers/base/playwright-base.ts && git commit -m "refactor(scrapers): legacy 1X2 members optional, AST guard"`

### Tasks 14–16: Delete legacy methods and their helpers, one group per task

| Task | Group | `--path` filters |
|---|---|---|
| 14 | forbet, etoto, fuksiarz, betfan | `/bookmakers/forbet/`, `/bookmakers/etoto/`, `/bookmakers/fuksiarz/`, `/bookmakers/betfan/`, `/shared/rest-market/` |
| 15 | fortuna, superbet, lvbet, betclic | `/bookmakers/fortuna/`, `/bookmakers/superbet/`, `/bookmakers/lvbet/`, `/bookmakers/betclic/` |
| 16 | sts, betcris, pzbuk, totalbet, betters, lebull | `/bookmakers/sts/`, `/bookmakers/betcris/`, `/bookmakers/pzbuk/`, `/bookmakers/totalbet/`, `/shared/betby/` (betters and lebull live there; `bookmakers/betters/` and `bookmakers/lebull/` hold only thin subclasses without legacy code) |

Each task follows the same steps. Line numbers come from `scripts/legacy-lines.ts` at implementation time; the future-base locations in Observations (Part B) are only orientation.

**Files:** the files `scripts/legacy-lines.ts --path … --helpers` lists for the group, their now-unused imports, and the tests that exercise deleted helpers. Task 16 deletes these tests (future-base lines, Observations Part B): totalbet `__tests__/scraper.test.ts:119-130` and `:266-314` (six legacy tests); Betby `shared/betby/__tests__/scraper.test.ts:91-101`, `:169-213` and `:229-231` (seven); the whole `describe("pzbuk legacy helpers on numeric wire ids")` block (`pzbuk/__tests__/parser.test.ts:131`). It also deletes totalbet's legacy-only `orientedMatchWinnerOdds` and its `Market1X2Odds` import (`totalbet/index.ts:17`), Betby's `quotes`, `halfLineTotals` and outcome-id constants, and, if plan 02 Task 13 has landed, totalbet's then-unused `listEventToMatchWinnerMarket` (`grid-parser.ts`); the `--helpers` scan lists them.
**Interfaces:** Consumes Task 13's scan and CLI. Produces nothing new.

- [ ] **Step 1: Shrink the guard.** Remove the group's directories from `ALLOWED` in `legacy-path.test.ts`.
- [ ] **Step 2: Confirm failure.** `npx vitest run src/scrapers/__tests__/legacy-path.test.ts` fails and lists the group's directories.
- [ ] **Step 3: Delete.**
  1. Run `npx tsx scripts/legacy-lines.ts --path <filter>` for each filter of the group, and delete every listed method.
  2. Run `npx tsx scripts/legacy-lines.ts --path <filter> --helpers` and delete every listed helper. Repeat until it prints `TOTAL legacy-only helper lines: 0`.
  3. Run `npx tsc --noEmit --noUnusedLocals 2>&1 | grep -E "<group paths>"` and remove the reported unused imports and module-level constants (e.g. legacy caches) in the group's files only.
  4. Remove the dead cache types and `CACHE_TTL` constants plan 01 left. List them with `grep -nE "CACHE_TTL|Cache[A-Za-z]*" src/scrapers/bookmakers/<bm>/{types,constants}.ts`. Delete each one for which `grep -rlw <name> src scripts --include=*.ts` returns only its own file.
  5. Delete the tests named above.
- [ ] **Step 4: Run and confirm pass.**
  - `npx vitest run` and `npx tsc --noEmit` green. The golden test is unchanged.
  - `npx tsx scripts/legacy-lines.ts --path <filter>` prints `TOTAL legacy method lines: 0` for every filter of the group.
  - `$H --live bash scripts/test-scrapers.sh test <one bookmaker of the group> premier-league` exits 0 (read-only, one run, outside HH:55–HH:10).
- [ ] **Step 5: Commit.** `git add -A <group paths> src/scrapers/__tests__/legacy-path.test.ts && git commit -m "refactor(<group>): delete legacy 1X2 methods and helpers"`. Use `rest-market`, `http-scrapers` or `ws-and-platforms` for `<group>`.

### Task 17: Legacy types, base helpers and docs

**Files:**
- Modify:
  - `src/scrapers/base/playwright-base.ts`: delete the optional declarations from Task 13; delete `:237-292` (`createErrorResult` … `createNotImplementedResult`) and `:392-407` (`executeLeagueScrape`), plus the legacy type imports in `:8-14` (keep `ScraperConfig`). Future-base lines; Task 13 shifts them by the deleted wrappers.
  - `src/types/scraper.ts`: delete `:14-82` and `:97-132` (`ScraperStatus`, `RawScrapedOdds`, `RawScrapedMatchOdds`, `EventUrlEntry`, `MatchDetailResult`, `ScraperResult`, `MatchIdentifier`, `NormalizedMatch`, `AggregatedOdds`, `Scraper`) and the imports `:6-11`. Keep `ScraperConfig` and `DEFAULT_SCRAPER_CONFIGS`.
  - `src/types/full-offer.ts:140-175` (`MarketOverUnderOdds`, `Market1X2Odds`, `MarketDoubleChanceOdds`, `MarketBTTSOdds` with their doc comments).
  - `src/repositories/scraper-run-repository.ts:55-134`: the dead `ScraperRunRecord`, `insertScraperRun` and `updateScraperRun` (no caller in `src/`, `scripts/` or tests: `git grep -n "insertScraperRun\b\|updateScraperRun\b\|ScraperRunRecord" -- src scripts` lists only this file). Observability Task 4 already removed `insertScraperRuns` and its legacy `ScraperResult` shape; `toScraperRunInsert`, `insertBookmakerRunOutcomes` and the readers stay.
  - `src/scrapers/base/__tests__/navigation-diagnostics.test.ts`: its `TestScraper` (`:641-688`) drops the legacy members (`:676-687`) and the legacy type import (`:10`, keep `ScraperConfig`).
  - `CLAUDE.md:60-81`: the scraper contract is `FullOfferScraper`/`IncrementalScraper`, and the "Adding a New Scraper" steps change accordingly.
  - `README.md:76-78`.
  - `src/scrapers/bookmakers/sts/README.md:108-126`: the examples use `scrapeFullOffer`.
- Test: `src/scrapers/__tests__/legacy-path.test.ts` (extend)

- [ ] **Step 1: Extend the guard.**
  ```ts
  it("no legacy method is left anywhere", () => expect(findLegacyMethods(ROOT)).toEqual([]));
  it("legacy types are gone", () => {
    const scraperTypes = exportedNames(ROOT, "src/types/scraper.ts");
    for (const t of ["ScraperResult","RawScrapedOdds","RawScrapedMatchOdds","EventUrlEntry","MatchDetailResult","MatchIdentifier","NormalizedMatch","AggregatedOdds","Scraper","ScraperStatus"])
      expect(scraperTypes).not.toContain(t);
    expect(scraperTypes).toEqual(expect.arrayContaining(["ScraperConfig", "DEFAULT_SCRAPER_CONFIGS"]));
    for (const t of ["Market1X2Odds","MarketDoubleChanceOdds","MarketBTTSOdds","MarketOverUnderOdds"]) expect(exportedNames(ROOT, "src/types/full-offer.ts")).not.toContain(t);
  });
  ```
- [ ] **Step 2: Confirm failure.** `npx vitest run src/scrapers/__tests__/legacy-path.test.ts`.
- [ ] **Step 3: Delete.** First run `for t in ScraperResult RawScrapedOdds RawScrapedMatchOdds EventUrlEntry MatchDetailResult MatchIdentifier NormalizedMatch AggregatedOdds ScraperStatus Market1X2Odds MarketDoubleChanceOdds MarketBTTSOdds MarketOverUnderOdds createErrorResult createNotFoundResult createTimeoutResult executeLeagueScrape; do grep -rlw $t src scripts --include=*.ts | grep -v -e src/types/scraper.ts -e src/types/full-offer.ts -e playwright-base.ts; done`. Expected output: nothing, because Tasks 14–16 removed every user. Any listed file is a leftover legacy user; delete that use in this task. Then edit the files and docs.
- [ ] **Step 4: Run and confirm pass**; tsc, full vitest, golden unchanged; `npx tsx scripts/legacy-lines.ts --helpers` prints both totals `0`.
- [ ] **Step 5: Commit.** `git add -A src/types src/scrapers/base src/repositories/scraper-run-repository.ts src/scrapers/__tests__ CLAUDE.md README.md src/scrapers/bookmakers/sts/README.md && git commit -m "refactor: delete legacy 1X2 types, helpers and dead run writers; document the full-offer contract"`

### Task 18: Remove the browser fallback classes after a clean fortnight

**Pick locations and selection tests** (README §3 "Rule: exactly ONE pick per bookmaker"; cross-plan review #12, #21). Each migrated bookmaker has exactly one pick site, every direct importer was repointed to the picked instance by its plan, and one selection test pins it:

| Bookmakers | Plan | Pick site | Selection test |
|---|---|---|---|
| forbet, etoto, fuksiarz, betfan | 03 | `src/scrapers/bookmakers/index.ts` | `src/scrapers/bookmakers/__tests__/transport-selection.test.ts` |
| fortuna, superbet, lvbet | 04 | `src/scrapers/bookmakers/index.ts` | `src/scrapers/bookmakers/__tests__/transport-selection.test.ts` |
| pzbuk | 05c | `src/scrapers/bookmakers/index.ts` | `src/scrapers/bookmakers/pzbuk/__tests__/transport.test.ts` |
| sts | 05a | brand module (`createStsScraper()` in `src/scrapers/bookmakers/sts/`) | `src/scrapers/bookmakers/sts/__tests__/transport-select.test.ts` |
| betcris | 05b | brand module | `src/scrapers/bookmakers/betcris/__tests__/transport-selection.test.ts` |

- **betcris:** plan 05b is blocked by the owner (EXECUTION C: "no Node Swarm client"), so betcris's Playwright class is its **primary** path, not a fallback; this task never touches it unless 05b lands after an explicit owner yes.
- **Not in this task:** betclic (plan 06 deletes its broken Playwright fallback), totalbet, betters and lebull (browserless since recovery; no browser class, no pick site).
- Direct importers that bypass `bookmakers/index.ts` and must not name a deleted class afterwards: `src/services/audit/bookmaker-registry.ts`, `scripts/<bm>-market-discovery.ts`, `scripts/<bm>-prep-audit.ts`, `src/scripts/analyze-bookmaker-markets.ts`, `scripts/test-scrapers.sh` (keys only since Task 12).

**Files:**
- Delete: the `<Brand>BrowserScraper` classes of the bookmakers that pass the gate (files per plans 03–05) and their browser-only tests.
- Modify:
  - each passing bookmaker's pick site (table above): the browser branch goes, the picked HTTP/WebSocket instance stays.
  - For rest-market brands, the brand's `constants.ts` `CATEGORY_IDS` and its row in `src/scrapers/shared/rest-market/__tests__/category-ids.test.ts` (plan 03 keeps them only for the fallback).
  - `src/config/transport.ts` and `src/config/__tests__/transport.test.ts`: **kept** (cross-plan review #7; plan 07's `job-policy.ts` and plan 02's `scripts/perf-smoke.ts` import `getTransportOverride`). While any bookmaker still has a fallback class the function is unchanged. When none has one, it becomes a stub: `getTransportOverride(_bookmaker, _env = process.env): TransportOverride | undefined` always returns `undefined`, documented as "reserved: no bookmaker has a browser fallback", and logs `[Transport] SCRAPER_TRANSPORT_<BM> ignored: no browser implementation` once per set variable. The `SCRAPER_TRANSPORT_*` example lines leave `.env.example` at that point.
- Test: the selection tests in the table, extended (one case per passing bookmaker), and `src/config/__tests__/transport.test.ts` (pins the stub once it applies).

- [ ] **Step 1: Gate — owner step, read-only, ≥ 14 days after the bookmaker's transport migration merged.** The owner confirms that no `SCRAPER_TRANSPORT_<BM>` was set during the window. Then run with `RO_PSQL`:
  ```sql
  with active as (   -- leagues in which the bookmaker listed matches at least once in the window
         select bookmaker, league_slug from scraper_runs
         where started_at >= now() - interval '14 days' and matches_found > 0 group by 1, 2),
       r as (select s.bookmaker, s.league_slug, s.started_at, s.status, s.status in ('success','partial') ok, s.matches_found
             from scraper_runs s join active a using (bookmaker, league_slug)
             where s.started_at >= now() - interval '14 days'),           -- `empty` stays in: owner A6 counts it as a failure
       s as (select bookmaker, league_slug, ok, count(*) n from
              (select *, row_number() over (partition by bookmaker, league_slug order by started_at)
                       - row_number() over (partition by bookmaker, league_slug, ok order by started_at) g from r) x
             where not ok group by bookmaker, league_slug, ok, g)
  select r.bookmaker, min(r.started_at) first_run, count(*) runs,
         count(*) filter (where ok and matches_found > 0) ok_with_matches,
         count(*) filter (where status = 'empty') empty_runs,
         round(count(*) filter (where not ok)::numeric / count(*), 4) fail_ratio,
         coalesce((select max(n) from s where s.bookmaker = r.bookmaker), 0) worst_fail_streak
  from r group by r.bookmaker order by 1;
  ```
  `empty` counts as a failure (owner A6). Leagues where the bookmaker listed no match at all in 14 days (e.g. `world-cup-2026` off-season, or betters/lebull, which have no World Cup id) are left out by `active`: they carry no evidence about the transport. A bookmaker passes when all of these hold:
  - `first_run ≤ now() − 13 days 23 hours`;
  - `fail_ratio ≤ 0.02` (failures incl. `empty`);
  - `worst_fail_streak ≤ 2`;
  - `ok_with_matches ≥ 100`.

  Outcomes are hourly (Tasks 4–5), so the thresholds keep their meaning with incremental mode on. Only passing bookmakers are touched below; the owner hands the list to the implementer.
- [ ] **Step 2: Write the failing tests.** In each passing bookmaker's selection test (table above): `it("SCRAPER_TRANSPORT_<BM>=browser is ignored for <bm> once its browser class is gone")`: `vi.stubEnv("SCRAPER_TRANSPORT_<BM>", "browser")`, `vi.resetModules()`, re-import the pick site, then `expect(<picked instance>).not.toBeInstanceOf(PlaywrightScraper)` (e.g. `mod.forbetScraper` from `bookmakers/index.js`; `createStsScraper()` for sts). If no fallback class remains anywhere, also `it("getTransportOverride is a stub returning undefined")` in `transport.test.ts`.
- [ ] **Step 3: Run and confirm failure** (`$H npx vitest run` on those files), then delete the classes and branches.
- [ ] **Step 4: Run and confirm pass**; tsc, full vitest. `git grep -n "BrowserScraper" -- src scripts` lists only bookmakers that did not pass (and their pick sites/tests). Then one read-only `$H --live npx tsx scripts/perf-smoke.ts --bookmaker <one removed bookmaker>` outside HH:55–HH:10: exit 0, `memory.chromiumProcessesEver` = 0.
- [ ] **Step 5: Commit.** `git add -A src/scrapers src/config scripts .env.example && git commit -m "refactor: drop browser fallback for <bookmakers> after 14 clean days"`

---

## Self-Review

Re-run 2026-11-13 against the future base (scratch merge of `recovery/integration` `aaf7c07` + `recovery/observability` `f0361f0` + `recovery/fortuna` `a8cdb71`); every kept line reference was re-read there, and the legacy inventory was re-measured with an AST scan.

1. **Spec coverage.** Brief items map as follows:
   - 1 → Task 1.
   - 2 → Task 2 (exact-time table; the 2 h / 6 h caps are also enforced in SQL in Task 3).
   - 3 → Tasks 3–5 (the "seen in a run" rule is in Observations; outcomes, `[ScrapeRun]`, alerts and `STATUS_WINDOW_RUNS` stay in hourly units, Review Focus 6).
   - 4 → Tasks 6–8 (the WS verdict, with numbers, is in Observations; betclic reuses plan 01's kickoff field and fixture).
   - 5 → Tasks 9–11 (owner steps; the documented start procedure replaces the unbuilt `npm run dev:stack`).
   - 6 → Tasks 13–17. `getScraper` is kept, and line ranges come from `scripts/legacy-lines.ts` at implementation time (~2 300 lines on the future base).
   - 7 → Task 12 (on top of `scripts/smoke-bookmaker.ts`).
   - 8 → Task 18 (empty counts as failure per A6; `getTransportOverride` becomes a stub, never deleted; every pick location and selection test listed).
   - Cross-plan review rows #2, #7, #16, #21, #27, #36 are applied.
2. **Step scan.** No step says TBD. Values that only exist at implementation time come from named commands: `ALLOWED` (Task 13) and line ranges (Tasks 14–16). The betclic fixture is now derived from plan 01's by a 3-byte insertion (writer-verified), with one read-only live check of field 7. Every live step is either a read-only `$H --live` probe or an owner step with its command and pass criteria (EXECUTION rules 3–4).
3. **Type consistency.**
   - Task 1 types are used unchanged in Tasks 4–8, and Task 2 types in Tasks 3, 4 and 9. `PassKey` is defined once, in Task 3; `recordIncrementalPass` and `finalizeIncrementalPass` both carry `confirmedRows`.
   - §3 names are used exactly. Sibling-plan names were checked against the written plans:
     - plan 01 `toIsoStartTime`, `BetclicListingMatch.startTime`, `fixtures/full-offer/betclic-listing.bin`;
     - plan 02 `TransportStats`/`TransportStatsSource`/`hasTransportStats` (cumulative), `perf-smoke --out/--baseline`, `scrapeOnce` in `smoke-bookmaker.ts`, the deleted legacy runners;
     - plan 03 `RestMarketBrand`/`RestMarketHttpScraper`/fixtures (no `kickoffIso`);
     - plan 04 `select*`/`map*Offer`/`*HttpScraper`;
     - plan 06 `fetchMatchOffer`/`resolveBetclicMatchConcurrency`;
     - plan 07 `RunRequest`/`runFullOfferCycle`/`scrapeWithHardDeadline`/`IntervalScheduler`, Task 0's `partial` rule; observability's `getLastSuccessfulScrapeTime` replaces the never-built `getStalestOkRunAt`;
     - plan 09 migrations `11a` and 12–15, `sql-test.sh`, `generateMatchId` export, `createFakeSupabase` `rpc`, the guard flag (off by default).
   - The additive `modes`/`recordOutcomes` fields and the `null` scheduler request are flagged in the final message.
4. **Review focus.** Each item names its test (Tasks 2, 4, 5, 6–9). DB state unavailable, zero-outcome ticks and hourly units are also pinned (Tasks 4, 5).
5. **Proportion.** The plan gives signatures, rules and test tables only. Changes made while writing:
   - Dropped an adaptive listing clock for a fixed 10-minute listing. It keeps main-market prices 10-minute fresh at ≤ 8 % listing cost.
   - Dropped `last_seen_at` as the due-plan input, because confirmations must bump it.
   - Dropped the migration backfill.
   - Fixed the Task 9 arithmetic.
   - Added the betclic `[Betclic/FullOffer]` log prefix that `check-log-vs-smoke.py` parses.
   - Replaced a module import in the guard test with an AST export check, so the test does not load all scrapers.
   - After reading the sibling plans:
     - the migration became 16 (plan 09 owns 15) and its test uses plan 09's harness;
     - an own `TransportStats` was replaced by plan 02's;
     - `fetchEvent` may return `null`, matching plan 03/04 mappings that drop market-less events;
     - betclic keeps plan 06's full pass;
     - the lvbet fingerprint test gets its own fixture, because plan 04 empties `primary_column_markets`.
   - 2026-11-13: "no outcome for a pass with nothing due" became hourly outcomes with an hour ledger, because silent incremental passes would have hidden an `empty` league (owner A6) and a 10-minute outcome stream would have broken observability's hourly alert and status units.

## Open Questions

1. **Near-kickoff freshness for sts, betcris, pzbuk.** They stay on the hourly full pass (Observations). Should they get a league-level due check that runs their whole-league pass when any stored event is due by the tiers? Cost per extra pass with plans 05a/05c: sts 0.75 MB, pzbuk 8.3 MB; betcris stays on its browser path (owner C, plan 05b blocked), where one pass takes ~100 s of Chromium. Roughly 30 extra passes per match day. **Recommended default:** yes for sts only (after 05a), as a follow-up task; no for betcris and pzbuk.
2. **What `scrapedAt` means for a confirmed far event.** A confirmation sets `last_seen_at` (shown per bookmaker as `scrapedAt`) to now, even though markets outside the listing may be up to 6 h old (> 72 h tier). `odds_current.changed_at` stays the truthful per-market time. **Recommended default:** accept, since the README §8 Q5 caps are owner-approved; the frontend can show `changed_at` later.
3. **Browser-class removal gate.** 14 days, failure ratio ≤ 2 % **including `empty`** (owner A6), worst failure streak ≤ 2, ≥ 100 OK runs with matches, computed over the leagues where the bookmaker listed matches at least once in the window. **Recommended default:** as proposed.
4. **totalbet on the incremental contract.** Its `fetchLeagueEvents`/`fetchEventDetail` already map 1:1 onto `listEvents`/`fetchEvent`, and after plan 02 Task 11 it has a budget and `transportStats()`. **Recommended default:** a follow-up task after Task 11's group 2 has run cleanly for 24 h, with the Task 7 recipe; not part of this plan.
