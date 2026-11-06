# Scraper Observability & Run Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scrape run reports, for each of the 14 bookmakers, the truth: whether the bookmaker was scraped, whether its markets were saved, and the concrete reason when either step failed. A run against an unreachable database is refused loudly. Run history is persisted to `scraper_runs` and exposed through a correct `bookmakerStatus`, an unauthenticated summary endpoint, a CLI, and one loud summary/alert line per run.

**Architecture:** A pure *run-outcome* layer classifies each `(scrape, save)` pair into one of five statuses and carries the formatted cause. A *navigation recorder*, attached once in the shared `PlaywrightScraper.executeFullOfferScrape`, adds HTTP status, host and websocket facts to any failed scrape. The aggregator returns outcomes. `runScrapeAndPersist` runs a DB preflight first; after the run it persists the outcomes to `scraper_runs`, summarises them, and emits the alert lines. A single `getBookmakerStatusSnapshot()` turns `scraper_runs` plus per-bookmaker odds freshness into the status served by `/api/odds`, `/api/odds/batch`, `/api/bookmakers`, `/api/health/scrapers` and `scripts/scraper-status.ts`.

**Tech Stack:** TypeScript (ESM, `module: NodeNext`), Node 20.19.5, Express 4, Playwright ^1.57, `@supabase/supabase-js` ^2.89 (PostgREST, `max_rows = 1000`), node-cron 3, Vitest (`globals: true`, `src/**/__tests__/**/*.test.ts`), tsx.

**Spec:** the Observations section of this file. Evidence lives in `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/observability/`:
`backend-log-excerpts.txt`, `api-status-snapshot-2026-11-06.json`, `db-probe-2026-11-06.txt`, `db-error-shapes-2026-11-06.json`, `navigation-recorder-live-2026-11-06.json`, `lebull-league-404-2026-11-06.txt`, `repro-db-down-forbet.txt`, `smoke-current-betters.txt`, `smoke-normalize-forbet.txt`, and the throw-away probes `recorder-proto.mts`, `repro-db-down.mts`, `smoke-current.mts`, `smoke-normalize.mts`.
Upstream diagnosis of the five broken bookmakers (betters/lebull → Betby, pzbuk → new WS, totalbet → UUID API, betcris flaky) is a separate set of plans. This plan does not fix any scraper. It makes their failures visible and gives them a smoke-test command (Task 9).

## Observations (pre-fix analysis)

### Status today (2026-11-06, premier-league only, `SCRAPE_INTERVAL_MINUTES=60`)

| Signal | What it says | Truth |
|---|---|---|
| Run 1 `7067e5f0` (startup ~15:44Z, Supabase still starting) | `10 success, 4 errors, 200 total matches, 101713 total markets` (log L35886) | 3 bookmakers saved anything (betclic 3262 + sts 6013 + betcris 9753 = **19 028** rows). 7 bookmakers logged `20 matches, 0 markets saved` and were still counted as success. There were **123** `Batch insert error` lines. |
| Run 2 `440d2fc6` (16:00:00.350Z–16:02:49.798Z) | `9 success, 5 errors, 180 total matches, 90752 total markets` (L65473) | 9 bookmakers saved **68 201** rows. The "90752 markets" figure is the normalized count, not the saved count. betters, lebull, pzbuk and totalbet returned 0 matches, and so did betcris, which had worked in run 1. |
| `GET /api/admin/scrapers/health` | fortuna, superbet, lvbet, fuksiarz, betfan, forbet, etoto are `healthy 100%` | Their run-1 data was thrown away. `lastError` is generic: `No events found from API` for betters, lebull and totalbet. |
| `GET /api/odds?league=premier-league` meta | `bookmakerStatus`: **1/14 available** (sts), 13 `stale`. `lastUpdated: null` | 9 bookmakers wrote odds between 16:00:33Z and 16:02:49Z (db-probe §3). |
| `GET /api/bookmakers` | **0/14 available**, every `lastSuccessfulScrape: null` | The route queries `ekstraklasa`, which is not scraped. |
| `scraper_runs` table | **0 rows** (db-probe §4) | Nothing has ever written to it. |
| Standalone repro on current code (`repro-db-down-forbet.txt`) | DB at a closed port: `1 success, 0 errors`, `errors: []`, health `healthy 100%` | 12 of 12 batches failed with `ECONNREFUSED 127.0.0.1:59999`, and 0 rows were saved. |

### Root causes (verified file:line, current HEAD `377b47e`)

**(a) A bookmaker counts as a success when it scraped matches, even if 0 rows were saved.**
- `src/scrapers/aggregator.ts:260-272`: `normalizeAndSaveMatches(...)` runs. Its `saveResult` is only logged (`had N errors`) and then dropped.
- `src/scrapers/aggregator.ts:306`: `successCount++` when `result.success && result.matches.length > 0`. Persistence is never considered.
- `src/services/scraper-service.ts:49-55`: `scraperHealth.recordRun(bookmaker, result.success, ...)` records the scraper's own flag. Note that a `success:true` with 0 matches is "error" in the aggregator but "success" in health.
- `src/repositories/full-offer-repository.ts:668-671` only counts failed rows. The DB error object is printed with `console.error` and lost. `src/services/scrape-helpers.ts:55-57` turns it into `Batch insert had N errors`, with no cause.
- Run 1 had four cause shapes (evidence `backend-log-excerpts.txt` §E): `ECONNREFUSED` ×80, `PGRST002 Could not query the database for the schema cache. Retrying.` ×19, `other side closed (UND_ERR_SOCKET)` ×16, and `write EPIPE` ×8.

**(b) A run starts against an unreachable DB and silently throws the data away.**
- `src/index.ts:84-99`: if `testConnection()` fails, the code only warns (`some features may not work`) and **skips `syncMarketTypes()`**. Nothing retries that sync later.
- `src/services/scheduler-service.ts:151-165`: the startup scrape fires 5 s later regardless. `src/services/scraper-service.ts:19-36` has no preflight check.
- Log §A shows the sequence: ECONNREFUSED at startup, then the scheduler starts and the scrape begins at L45-50.
- The same defect hits the TSDB fixture sync. `scheduler-service.ts:197-207` runs `syncStaleLeagues()` once, 1 s after start, and after that only the 04:00 Europe/Warsaw cron (`:179-195`) runs it. Log §A L35-44 shows `[Scheduler] Initial TSDB sync failed` (ECONNREFUSED). The frontend's fixture cache then stays stale until 04:00. That is about 11 h after today's 16:44 local start, and up to ~24 h in general.

**(c) The real failure cause is dropped.**
- `aggregator.ts:268-271` logs `success=${result.success}, N matches` without `result.error`.
- `scraper-service.ts:57-59` collects `errors[]`. `scheduler-service.ts:45-47` logs only counts, and `routes/health.ts:34-42` / `types/api.ts:27-35` (`ScrapeStats`) have no error field.
- The causes that do exist sit only in scraper-local `console.*` lines (log §D):
  - totalbet: `API error: HTTP 404` (`totalbet/navigation.ts:72-74,84-86`) becomes `No events found from API` (`totalbet/index.ts:254-262`).
  - betters / lebull: `Capture timeout after 8000ms` becomes `No events found from API` (`betters/index.ts:258-267`, `lebull/index.ts:246`).
  - betcris, run 2: **no log line at all** between L36389 `Navigating to` and L36618 `completed: success=false`. Its `No WebSocket data captured` (`betcris/index.ts:274-283`) is invisible.

**(d) `page.goto` HTTP status and host are never checked.**
- `playwright-base.ts:189-206` `navigateWithRetry` discards the `Response`.
- 15 direct `page.goto` calls in 11 `navigation.ts` files do the same: lvbet:30, forbet:31, superbet:45/63, sts:161/219, pzbuk:168/192, betfan:31, betcris:43/67, etoto:36, fuksiarz:31, totalbet:35, fortuna:36.
- 13/14 scrapers go through `PlaywrightScraper.executeFullOfferScrape` (`playwright-base.ts:347-366`). Betclic is API-only (`betclic/index.ts:233`), so that method is the one shared place for a fix.
- A live prototype of the recorder (`recorder-proto.mts` → `navigation-recorder-live-2026-11-06.json`) captures each cause directly:

| Target | What the recorder sees |
|---|---|
| betters | document `404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485`, title `404 Not Found` |
| totalbet | document 200 for `https://totalbet.pl/`, **fetch 404** `https://totalbet.pl/rest/market/categories/multi/7124/events` (an in-page `fetch()` fires Playwright `response` events) |
| pzbuk | document 200, websocket `wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl` (the scraper listens for `sportsbook-api/websocket`), SPA final URL `.../134-premier-league` |

**(e) Scraper health is in memory only, and `scraper_runs` is never written.**
- `scraper-service.ts:3` imports `insertScraperRuns` and never calls it.
- `scraper-run-repository.ts:96-123` takes the legacy `Map<PolishBookmaker, ScraperResult>` (the 1X2 `status/data` shape), not `FullOfferScraperResult`.
- Schema `supabase/migrations/04_scraper_runs_schema.sql:1-12`: `id, bookmaker, league_slug, started_at, finished_at, status (default 'running'), matches_found, markets_saved, error_message, duration_ms`. There is no run id and no found/saved split.
- These readers get nothing today because the table has 0 rows:
  - `odds-service.ts:26` (`getLastSuccessfulScrapeTime`, which is global and not per league) returns null, so `meta.lastUpdated: null`.
  - `routes/bookmakers.ts:61` (`avgScrapeDurationMs: null`).
  - `routes/admin.ts:88` (`/api/admin/runs` is empty).
- They would also break once rows exist, because the existing timestamp helpers are wrong for real PostgREST output:
  - `odds.scraped_at`, `scraper_runs.started_at` and `scraper_runs.finished_at` are all `timestamp with time zone` (read-only `information_schema.columns` query, 2026-11-06).
  - PostgREST returns them with an offset, for example `2026-11-06T16:02:49.048+00:00` (db-probe §3).
  - The Z-append helpers at `scraper-run-repository.ts:193-197` and `:271-273` turn that into `…+00:00Z`. That is `Invalid Date`, and `.toISOString()` on it throws `RangeError: Invalid time value` (verified with `node -e`).
  - Consequence 1: `getRunsSummary` → `getBatchId` (`:200-206`) throws, so `GET /api/admin/runs` returns 500.
  - Consequence 2: `getLastSuccessfulScrapeTime` returns an Invalid Date. `odds-service.ts:103` (`isNaN` guard) turns it into `lastUpdated: null`.
  - A correct, offset-aware check already exists in `tsdb-sync-service.ts:17` (inside `parseKickoffTime`, `:14-27`). Task 4 extracts it.
- `/api/admin/runs` also groups rows by `started_at` minute (`scraper-run-repository.ts:199-206`), not by run. It counts only `status === "success"` as OK (`admin.ts:91-92`, `:100`), so a `partial` run would be reported as an error.
- `scraper-health.ts:30` keeps state in a `Map` that is lost on every `tsx watch` restart. `/api/admin/scrapers/health` sits behind `requireAdminAuth` (`admin.ts:26`), and the default key is `dev-api-key` (`config/index.ts:36`, not set in `.env`).

**(f) `bookmakerStatus` is wrong, and wrong in a misleading way.**
- `odds-repository.ts:131-164` (`getBookmakerStatus`) selects **every** odds row for the league with no limit or paging. PostgREST caps the result at `max_rows = 1000` (`supabase/config.toml:18`).
  - The league has 185 672 rows. The 1 000 newest are all sts (db-probe §2), so the other 13 bookmakers look absent and are reported `stale`.
- `odds-service.ts:175-204` uses a fixed 60-minute threshold and has no `error` state. With interval = 60 min and a run that lasts ~170 s, statuses would flip to stale every hour even with correct data.
- `routes/bookmakers.ts:60` calls `getBookmakerStatus()` with the default `ekstraklasa`.
- `routes/odds.ts:221-231` (batch merge) reads `.status` off a string value, so `getStatusPriority(undefined)` is 0 and the first league always wins. "Worst status wins" never works for more than one league.
- Real per-bookmaker freshness (db-probe §3, latest `scraped_at`):

| Bookmaker | Latest `scraped_at` |
|---|---|
| sts | 16:02:49.048Z |
| fortuna | 16:00:45.385Z |
| betclic | 16:00:54.051Z |
| superbet | 16:00:46.014Z |
| lvbet | 16:00:43.873Z |
| fuksiarz | 16:00:33.997Z |
| betfan | 16:00:38.841Z |
| forbet | 16:00:35.746Z |
| etoto | 16:00:35.985Z |
| betcris | 15:46:48.552Z (run 1; a time-only rule would show "available" until 16:46 although run 2 failed) |
| lebull | 2026-08-22T08:00:07.846Z |
| pzbuk | 2026-08-24T14:03:32.135Z |
| betters | none |
| totalbet | none |

**(g) / (h)** There is no unauthenticated summary, no CLI, and no alerting. Log lines carry no timestamps; only the request logger does (`index.ts:41-44`).

**Operator ergonomics.**
- The Supabase containers had been stopped. `npx supabase start` failed (the operator reported a corrupted npx cache), and the stack came up around 15:42Z, judging by container uptime. The server had started ~15:44Z (`/api/health` uptime 1940 s at 16:16:18Z) and logged ECONNREFUSED on port 54321.
- The containers carry the label `com.supabase.cli.project=backend` (db-probe §5). `docker start` of the 11 non-edge containers is enough. `supabase_edge_runtime_backend` has been `Exited (255) 10 months ago`.
- `scripts/apply-migrations.sh` with no argument re-runs 01–10 against a live DB (`:72-99`). That includes `CREATE TABLE`, seeds, migration 06's mass `UPDATE odds`, and a redefinition of `get_matches_with_odds`. It must only ever be called with a single file. Yet `package.json:16` (`"db:migrate": "./scripts/apply-migrations.sh"`) and `CLAUDE.md:50` advertise exactly the no-argument form. Task 10 guards it.

### Incidental findings (not fixed here, for the owner)

- `playwright-base.ts:96-119` returns the page **before** resource blocking (`:140-148`) and stealth scripts (`:150`) are applied. Both only run on the third, "last attempt" path. As a result `config.disableResourceBlocking` and `applyStealthScripts` are effectively dead for all 13 Playwright scrapers. Changing this would alter bot-detection exposure for every bookmaker at once, so it stays out of scope (see Open questions).
- Betclic is API-only, so the Task 2 recorder does not cover it. `betclic/navigation.ts:248-265` (`fetchLeagueMatches`) logs the exception with `console.error` and returns `null`. `betclic/index.ts:245-252` then reports only `No events found from API`. Follow-up: make the returned error carry the HTTP status or the exception message. It is not done here because betclic works today and this plan changes no scraper.

### What still works and must not break

- The 9 working bookmakers: fortuna, superbet, lvbet, fuksiarz, betfan, forbet, etoto, sts, betclic.
  - Run 2 saved counts: 12897 / 13353 / 9427 / 6222 / 5600 / 5869 / 6553 / 5130 / 3150.
  - The baseline is noisy. STS saved 6013 rows in run 1 and 5130 in run 2, an hour apart (−15%). The August STS rows still in the DB average 347 rows/match (11 113 rows over 32 matches), against 257 today (5130 / 20). This comes from a read-only SQL query on 2026-11-06. Task 11 therefore uses a 0.75× floor per bookmaker, not equality.
  - Dry smoke of forbet today: 20 matches, 5995 markets, `minMarketsPerMatch` 148, `otherMarketShare` 0.0661, `unknownSelectionShare` 0.0376 (`smoke-normalize-forbet.txt`).
- Response shapes the frontend reads (verified read-only in `../aityper/src`):
  - `BookmakerStatus = "available" | "error" | "stale"` (`lib/api/odds-api.ts:5`). `"error"` is already in the union.
  - Every consumer compares `=== "available"` / `!== "available"` (`lib/actions/odds.ts:34,37,115,118,212`).
  - The only live reader of `meta.bookmakerStatus` is `hooks/use-polling-odds.ts:91`, and it stores the value without rendering it. The visible bookmaker list is computed from odds presence (`components/ako/betting-workspace.tsx:183`).
  - That reader is fed by **`POST /api/odds/batch`**, not `GET /api/odds`: `fetchLatestOddsBatch(leagues)` (`use-polling-odds.ts:86`, `lib/api/odds-api.ts:119-122`). The batch merge (`routes/odds.ts:222-239`) is therefore the response that must be right, and Task 8 tests it directly.
  - `meta.lastUpdated` falls back to `new Date()` when null (`use-polling-odds.ts:92`) and feeds `Pobrano: HH:MM` (`components/ako/odds-status.tsx:51`).
  - `/api/bookmakers`, `/api/health` and `/api/admin/*` have no frontend callers. The server actions that call `/api/bookmakers` are never invoked.
- `/api/matches/:home/:away/normalized-markets`, catalog sync at startup, `pruneStaleOddsRows` (runs only when a batch had 0 errors, `full-offer-repository.ts:681-685`), and the admin endpoints.
- Baseline: `npx vitest run` gives **65 files / 1182 tests passed** (golden.test.ts 25), and `npx tsc --noEmit` is clean (2026-11-06 17:24 local).

### New data shapes, ids, endpoints

Run status vocabulary (written to `scraper_runs.status`, used everywhere):

| status | condition | counts as OK | today's example |
|---|---|---|---|
| `success` | matches > 0, saved > 0, no save errors | yes | betclic run 2, 3150 saved |
| `partial` | saved > 0, some batches/normalization failed | yes | a run where the DB drops mid-write |
| `empty` | scraper `success:true`, 0 matches | no | off-season |
| `scrape_failed` | scraper `success:false` or threw | no | betters, lebull, pzbuk, totalbet, betcris (run 2) |
| `persist_failed` | matches > 0, 0 rows saved | no | 7 bookmakers in run 1; forbet repro |

`scraper_runs` migration `11_scraper_runs_observability.sql` (additive, nullable): `run_id UUID`, `markets_found INTEGER`, index `(league_slug, bookmaker, started_at DESC)`.

| Endpoint | Auth | Change |
|---|---|---|
| `GET /api/odds` meta | public | `bookmakerStatus` values gain `"error"`. New `bookmakerHealth: Record<bm,{status,lastSuccessAt,failingSince,consecutiveFailures}>`. `lastUpdated` = the league's last OK run. |
| `POST /api/odds/batch` meta | public | Worst-wins merge is fixed (error > stale > available). It runs over `leagues ∩ CONFIG.ENABLED_LEAGUES`, or over all requested leagues when that intersection is empty. Values stay plain strings. `bookmakerHealth` is merged the same way. `lastUpdated` = newest non-null per-league value, as today (`routes/odds.ts:234-239`). |
| `GET /api/bookmakers?league=` | public | default league = `CONFIG.ENABLED_LEAGUES[0]`. Status, `lastError` and `matchesFound` come from the snapshot. |
| `GET /api/health` | public | `lastScrapeStats[league]` gains `marketsSaved`, `aborted`, `failed[]` |
| `GET /api/health/scrapers?league=` | **public, new** | per-bookmaker last status, last success, consecutive failures, failing since, last error |
| `GET /api/admin/scrapers/health` | admin | same shape plus `lastStatus`, `consecutiveFailures`, `lastSuccessAt` |

New log lines, one per event:
- `[Aggregator/FullOffer] <bm> <status>: ... - <error>`
- `[ScrapeRun] ...`: exactly one per **non-aborted** league-run. An aborted run emits only the `[ALERT] scrape run ABORTED …` line.
- `[ALERT] ...` and `[ALERT-RESOLVED] ...`
- `[ScraperService] scraper_runs not persisted: ...`
- `[Scheduler] Initial TSDB sync skipped: database unreachable - ...`

The full run id is printed by the existing `[Aggregator/FullOffer] Starting run <uuid> for <league> …` line (`aggregator.ts:235-237`). `[ScrapeRun]` prints only its first 8 characters.

### Impact on parser / normalizer / catalog / golden fixtures / audit knowledge

- No parser, normalizer or `market-catalog.ts` change, so `sync-market-types.ts` and `rebless-golden.ts` are not needed. `golden.test.ts` must pass unchanged.
- `FullOfferScraperResult` gains an optional `diagnostics`, which is invisible to parsers.
- Audit ledger (`../aityper/docs/audit-ledger/SPEC.md:110`): the `stale-source` state ("source unreachable") has 37 entries in `registry.json`. All of them come from a judge backfill (`evidenceKind: "judge"`, "backfill r3-r5") and carry a TTL of 2026-07-16 that has already expired. `/api/health/scrapers` becomes the evidence source for future `stale-source` dispositions.
- The 08-20 audit wording that totalbet is "poza zakresem" (out of scope) is wrong, as the upstream diagnosis already noted. With this plan the run line will say `fetch HTTP 404 .../7124/events`.

### Risks & unknowns

- **Every save under `src/` restarts `npm run dev` (tsx watch)**, and 5 s later the startup scrape fires (`scheduler-service.ts:151-165`): 14 bookmakers, about 170 s of live traffic per edit. Partial runs leave no `scraper_runs` rows, because rows are written at the end of a run.
- `scraper_runs` grows by 14 rows per league-run (336/day at hourly). No retention is added (open question).
- `/api/health/scrapers` is unauthenticated and exposes error text, including internal hosts (`127.0.0.1:54321`). That is fine local-first, but needs review before any public deploy.
- The navigation recorder adds `request`, `response`, `requestfinished`, `requestfailed` and `websocket` listeners to each page. It does not read bodies, so the cost is negligible next to STS's 3 MB WS frames. Diagnostics are attached **only** to failed results.
  - The recorder sits in the shared base for all 13 Playwright scrapers. A throwing listener would escape into Playwright's event dispatch and could break every scraper, or the long-running tsx process. Every listener body is therefore wrapped in try/catch (Task 2, tested).
  - `sts/navigation.ts:154` and `:212` call `page.removeAllListeners("websocket")`, which also strips the recorder's websocket listener on STS pages. This is harmless: STS diagnostics simply list no websockets after that point. Do not "fix" it by re-attaching.
- `meta.lastUpdated` changes from null to a real timestamp. The frontend label `Pobrano: HH:MM` will then show the last successful scrape time instead of the client fetch time. That is more truthful, but it is visible.
- If a failing bookmaker is never re-scraped, its quotes stay in the DB and keep being served until kickoff. Example: betcris 15:46Z quotes after its 16:00Z failure. This plan makes the state visible (`error` plus `failingSince`) but does not hide those quotes (open question, odds-integrity).
- `empty` counts as a failure. A league with no listed fixtures would put all 14 bookmakers in `error`; the alerts collapse that case into one league-level line (Task 6).
- Timestamps: PostgREST returns `timestamptz` **with** an offset (`+00:00`), and the existing Z-append helpers break on that (Observation (e)). `parseDbTimestamp` keeps an explicit offset or `Z` as is. As a defensive measure, it treats offset-less input as UTC. The host timezone is Europe/Warsaw, where `new Date("2026-11-06T16:00:00.35")` evaluates to `2026-11-06T15:00:00.350Z` (verified with `node -e`).
- PGRST002 window: PostgREST answers while Postgres is still starting. The preflight must go through PostgREST to a table, as `testConnection` already does (`config/database.ts:23-38`).

### Open questions for the owner

1. Should `empty` (scraper success with 0 matches) count as a failure? Default in this plan: yes, with the league-level collapse.
2. Alert threshold: is the default `ALERT_CONSECUTIVE_FAILURES=3` right (3 h at the current interval)? Is a webhook (`ALERT_WEBHOOK_URL`, Slack-compatible `{text}`) wanted at all?
3. Is it acceptable to expose `lastError` on the unauthenticated `/api/health/scrapers`?
4. Accept the `Pobrano:` semantic shift (now the last scrape time)? Or should a follow-up frontend change relabel it, e.g. "Kursy z: HH:MM" ("odds as of HH:MM")?
5. Should `scraper_runs` have a retention period, e.g. 30 days added to the 03:00 cleanup?
6. Should quotes from a bookmaker in `error` for longer than N× interval be hidden from `/api/odds` and normalized-markets? This plan leaves them in place.
7. Should the supabase CLI be pinned as a devDependency (~56 MB binary, no npx cache)? The default here is a `docker start` fast path plus a pinned `npx --yes supabase@2.70.5 start` fallback. 2.70.5 is the version in this machine's npx cache (`~/.npm/_npx/*/node_modules/supabase/package.json`). A bare `npx supabase` now resolves to 3.x.
8. Should the `initBrowser` stealth/resource-blocking dead path (see Incidental finding) be fixed in a separate plan?

### Acceptance criteria

All checks are run from the repo root (`/home/skamik/Documents/repositories/personal/aityper-scraper-api`).

- **A1, DB-down drill.** No DB writes and no bookmaker traffic. Today's equivalent (`repro-db-down-forbet.txt`) reports `1 success, 0 errors`.
  `SUPABASE_URL=http://127.0.0.1:59999 SUPABASE_SERVICE_KEY=dummy npx tsx scripts/smoke-bookmaker.ts --bookmaker forbet --persist`
  - Exit code **3**.
  - Output contains `[ALERT] scrape run ABORTED for premier-league: database unreachable - TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)`.
  - Output contains **no** `[Aggregator/FullOffer] Starting`.
- **A2, single-bookmaker live smoke** (dry, no DB): `npx tsx scripts/smoke-bookmaker.ts --bookmaker forbet --league premier-league`.
  - Exit 0.
  - `SMOKE_RESULT` with `matches >= 18`, `minMarketsPerMatch >= 100`, `unknownSelectionShare <= 0.06` (today 20 / 148 / 0.0376).
  - The same command with `--bookmaker betters` (until the Betby plan lands): exit 1, with `error` containing `document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485`.
  - The command shape is proven on current code: `smoke-current-betters.txt` and `smoke-normalize-forbet.txt` import the same modules (`getScraper`, `closeAllBrowsers`, `normalizeMarketsForBookmaker`).
- **A3, per-run line.** After the next scheduled run, `grep -c '^\[ScrapeRun\] premier-league'` on the clean log increases by exactly 1 per **non-aborted** run. An aborted run adds no `[ScrapeRun]` line and exactly one `[ALERT] scrape run ABORTED` line.
  - Take the full run id from the preceding `[Aggregator/FullOffer] Starting run <uuid> for premier-league` line. `[ScrapeRun]` shows only 8 characters.
  - `ok=N/14` equals the number of `scraper_runs` rows of that `run_id` with status in (success, partial).
  - `saved=` equals Σ `markets_saved` of those rows.
- **A4, summary endpoint.** `curl -s 'http://localhost:3001/api/health/scrapers?league=premier-league'` with **no** Authorization header returns HTTP 200 and 14 entries.
  - While the per-bookmaker fixes are unmerged, `lastError` contains:

| Bookmaker | `lastError` contains |
|---|---|
| betters | `document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485` |
| lebull | `document HTTP 404 https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485` (evidence `lebull-league-404-2026-11-06.txt`, plus the nginx body in `../lebull/old-ssr-host-404.html`) |
| totalbet | `fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events` |
| pzbuk | `websockets opened: wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl` |

  - Every bookmaker that saved rows in the run has `status: "available"` and `consecutiveFailures: 0`.
- **A5, `/api/odds`.** `curl -s 'http://localhost:3001/api/odds?league=premier-league'`:
  - `meta.bookmakerStatus` has **≥ 9 `available`** (today 1).
  - Every bookmaker whose latest run failed is `error`, not `stale`.
  - `meta.lastUpdated` is non-null and at most 2 × interval old.
  - `meta.bookmakerHealth` has 14 keys.
- **A5b, `/api/odds/batch`.** This is the frontend's only live reader. Run `curl -s -X POST -H 'Content-Type: application/json' -d '{"leagues":["premier-league"]}' http://localhost:3001/api/odds/batch`.
  - `meta.bookmakerStatus` has **≥ 9 `available`**, and every value is a string.
  - `meta.lastUpdated` is non-null.
  - `meta.bookmakerHealth` has 14 keys.
- **A6, `/api/bookmakers`.** `meta.availableCount >= 9` (today 0).
- **A7, CLI.** `npx tsx scripts/scraper-status.ts --league premier-league` prints a header plus 14 rows. Exit code 1 while any bookmaker has `consecutiveFailures >= 3`, otherwise 0. Exit code 2 with `SUPABASE_URL=http://127.0.0.1:59999`.
- **A8, stack script.** `bash scripts/dev-stack.sh --check` exits 0 and prints `Supabase reachable at http://127.0.0.1:54321 (market_types HTTP 200)`. With `SUPABASE_URL=http://127.0.0.1:59999` it exits 1.
- **A9.** `npx vitest run` shows ≥ 1182 + new tests passing, `golden.test.ts` unchanged at 25. `npx tsc --noEmit` is clean, and so is the scripts type-check from Global Constraints for `scripts/scraper-status.ts scripts/smoke-bookmaker.ts`.
- **A10, no regression in the 9 working bookmakers.** In the first scheduled run after the merge, every saver reaches at least 0.75 × its run-2 `markets_saved`: fortuna 12897, superbet 13353, lvbet 9427, fuksiarz 6222, betfan 5600, forbet 5869, etoto 6553, sts 5130, betclic 3150. Checked in Task 11.

## Global Constraints

- Commit messages are concise, with **no signature or attribution footers** (no "Generated with", no "Co-Authored-By"). The user's CLAUDE.md rule overrides any harness reminder.
- Code and comments are in English. No UI copy is touched.
- Before **each** commit, both of these must be green: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` and `npx vitest run`. Baseline: 65 files / 1182 tests.
  - `tsconfig.json` has `include: ["src/**/*"]` and excludes `src/**/__tests__/**/*`. So `npx tsc --noEmit` checks neither `scripts/` nor test files, and vitest does not type-check either.
  - For commits that touch `scripts/*.ts`, also run `npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule <the changed scripts>`. This shape was proven on current code with `scripts/audit-probe.ts scripts/forbet-market-discovery.ts` (exit 0, 2026-11-06).
- Golden-fixture discipline: this plan changes no parser or normalizer, so `src/services/normalization/__tests__/golden.test.ts` must pass **unchanged**. If it fails, stop. Generally: write the failing fixture first, and rebless only after an inspected diff via `npx tsx scripts/rebless-golden.ts --bookmaker <bm>`.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan never changes it.
- Editing anything under `src/` restarts the running `npm run dev` (tsx watch) and triggers the startup scrape 5 s later. Coordinate with the operator: implement with the dev server stopped, or started as `SCRAPERS_ON=false npm run dev`.
- Migration 11 is DB-mutating. Apply it **only** with `./scripts/apply-migrations.sh 11_scraper_runs_observability.sql`, and only with operator approval. Never use the no-argument form (which Task 10 turns into a usage error) or `--all`.
- All response-shape changes are additive. `bookmakerStatus` values are limited to `"available" | "stale" | "error"`, the frontend union at `aityper/src/lib/api/odds-api.ts:5`. No frontend change is part of this plan.
- No new npm dependencies (no supertest). Route tests run an Express app on port 0 with Node 20's global `fetch`.
- No external services unless `ALERT_WEBHOOK_URL` is set.
- Keep live bookmaker traffic modest: smoke-test one bookmaker at a time.
- Tests that mock modules use `vi.mock(path, async () => …)` / `vi.hoisted`, because factories are hoisted. Repository tests use the shared fake client from Task 1.
- Commit only when the user has asked for commits (repo CLAUDE.md). The commit steps below assume that permission.

## Review Focus

1. **DB dies mid-run after the preflight passed, and the `scraper_runs` insert fails too.** `runScrapeAndPersist` must still resolve, log `[ScraperService] scraper_runs not persisted: …`, update in-memory health, and print the `[ScrapeRun]` line. Covered by a test in Task 7.
2. **Migration 11 not applied** (PostgREST `PGRST204` "Could not find the 'run_id' column"). The insert fails, but `select *` reads still succeed and return no current-run rows. The insert failure stays non-fatal and the message names the migration file (Task 4 test). Streak alerts must still fire from the in-memory history merged with the DB rows. They must not be computed from DB rows that lack the current run (Task 7 test "alerts from in-memory history when the insert fails but reads work").
3. **PostgREST timestamp shape.** `timestamptz` comes back as `2026-11-06T16:02:49.048+00:00`. The existing Z-append helpers turn that into `Invalid Date`, which makes `/api/admin/runs` return 500 and leaves `lastUpdated` null. `parseDbTimestamp` keeps offsets, and handles offset-less input defensively as UTC. Covered by tests in Task 4 (`+00:00` rows through `getLastSuccessfulScrapeTime` and `getRunsSummary`) and Task 5.
4. **Every bookmaker returns 0 matches** (off-season, or the league not yet listed). The result is one league-level alert, not 14 streak alerts. Covered by a test in Task 6.
5. **Recorder never throws.** First case: the page is closed or crashed before the diagnostics snapshot (scrapeLogic threw). Enrichment then uses the data recorded so far. Second case: a Playwright accessor throws inside a listener, e.g. `response.frame()` for Service Worker requests. Every listener body is wrapped in try/catch. Covered by two tests in Task 2.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/services/run-outcome.ts` (new) | status vocabulary, `classifyBookmakerRun`, `formatDbError` | 1 |
| `src/__tests__/helpers/fake-supabase.ts` (new) | chainable fake supabase client for repository tests | 1 |
| `src/__tests__/helpers/run-fixtures.ts` (new) | `outcome()`, `RUN2_OK` (Task 1), `summary()` (Task 5), `snapshotFromRun2()` (Task 8) | 1, 5, 8 |
| `src/repositories/full-offer-repository.ts` | `BatchSaveResult` gains `failedBatches/totalBatches/firstError` | 1 |
| `src/services/scrape-helpers.ts` | batch error message carries the cause | 1 |
| `src/types/full-offer.ts` | `NavigationDiagnostics`, `FullOfferScraperResult.diagnostics?` | 2 |
| `src/scrapers/base/navigation-diagnostics.ts` (new) | recorder, issue description, failure enrichment | 2 |
| `src/scrapers/base/playwright-base.ts` | attach recorder in `executeFullOfferScrape` | 2 |
| `src/scrapers/aggregator.ts` | outcomes, honest counts and log lines; delete unused `runSingleFullOfferScraper` | 3 |
| `supabase/migrations/11_scraper_runs_observability.sql` (new) | `run_id`, `markets_found`, index | 4 |
| `src/utils/db-timestamp.ts` (new) | `parseDbTimestamp`, extracted from `tsdb-sync-service.ts:17` | 4 |
| `src/services/tsdb-sync-service.ts` | `parseKickoffTime` uses `parseDbTimestamp` | 4 |
| `src/types/database.ts` | `scraper_runs` columns, `BookmakerStatus` += `"error"` | 4, 5 |
| `src/repositories/scraper-run-repository.ts` | outcome insert, recent rows, per-league last success, `getRunsSummary` grouped by `run_id` | 4 |
| `src/routes/admin.ts` | `/api/admin/runs` counts `partial` as OK | 4 |
| `src/services/bookmaker-status.ts` (new) | run summaries, row merge, status derivation, snapshot | 5 |
| `src/repositories/odds-repository.ts` | `getOddsFreshnessByBookmaker` (built on `getLastScrapeTime`) replaces the unbounded query | 5 |
| `src/services/run-alerts.ts` (new) | summary line, alert lines, optional webhook | 6 |
| `src/config/index.ts`, `.env.example` | `ALERT_CONSECUTIVE_FAILURES`, `ALERT_WEBHOOK_URL` | 6 |
| `src/config/database.ts` | `probeDatabase`, `waitForDatabase` | 7 |
| `src/services/market-types-sync.ts` | `ensureMarketTypesSynced` | 7 |
| `src/services/scraper-service.ts`, `scraper-health.ts`, `scheduler-service.ts`, `src/index.ts` | preflight, wiring, health semantics, startup DB wait for scrape and TSDB sync | 7 |
| `src/types/api.ts`, `src/routes/{odds,bookmakers,health}.ts`, `src/services/odds-service.ts` | API surfaces | 8 |
| `src/services/scraper-status-report.ts` (new) | report builder and table formatter | 8, 9 |
| `scripts/scraper-status.ts`, `scripts/smoke-bookmaker.ts` (new) | CLIs | 9 |
| `scripts/dev-stack.sh` (new), `scripts/apply-migrations.sh`, `package.json`, `CLAUDE.md` | operator start procedure; the no-argument migration form is refused | 10 |

Test fixtures are copied from the evidence directory:
- `evidence/observability/db-error-shapes-2026-11-06.json` → `src/services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json`. Repository tests under `src/repositories/__tests__/` read it as `new URL("../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url)`.
- `evidence/observability/navigation-recorder-live-2026-11-06.json` → `src/scrapers/base/__tests__/fixtures/navigation-recorder-live-2026-11-06.json`. The prototype's `gotoError` field (always `null`: no target had a navigation failure) is replaced by the typed `failedNavigations: []` while copying (the command is in Task 2's Files list).

---

### Task 1: Run-outcome classification and DB error causes

**Files:**
- Create: `src/services/run-outcome.ts`, `src/__tests__/helpers/fake-supabase.ts`, `src/__tests__/helpers/run-fixtures.ts`
- Modify: `src/repositories/full-offer-repository.ts:561-566` (`BatchSaveResult`), `:657-674` (batch loop), `src/services/scrape-helpers.ts:51-62`
- Test: `src/services/__tests__/run-outcome.test.ts`, `src/repositories/__tests__/full-offer-repository-batch-errors.test.ts`
- Fixture: copy `evidence/observability/db-error-shapes-2026-11-06.json` → `src/services/__tests__/fixtures/observability/`

**Interfaces:**
- Produces:
  ```ts
  export type BookmakerRunStatus = "success" | "partial" | "empty" | "scrape_failed" | "persist_failed";
  export const OK_RUN_STATUSES: readonly BookmakerRunStatus[]; // ["success", "partial"]
  export function isOkRunStatus(status: string | null | undefined): boolean;
  export interface BookmakerRunOutcome {
    runId: string; bookmaker: PolishBookmaker; league: string; status: BookmakerRunStatus;
    matchesFound: number; marketsFound: number; marketsSaved: number; error: string | null;
    startedAt: Date; finishedAt: Date; durationMs: number;
  }
  export function classifyBookmakerRun(
    scrape: Pick<FullOfferScraperResult, "success" | "matches" | "error">,
    save: Pick<NormalizeAndSaveResult, "marketsNormalized" | "marketsSaved" | "errors"> | null,
  ): { status: BookmakerRunStatus; error: string | null };
  export function formatDbError(error: unknown): string;
  // full-offer-repository.ts
  export interface BatchSaveResult { inserted; filtered; errors; matchesProcessed; failedBatches: number; totalBatches: number; firstError: string | null }
  // fake-supabase.ts
  export interface RecordedQuery { table: string; calls: Array<[method: string, ...args: unknown[]]> }
  export function createFakeSupabase(respond: (q: RecordedQuery) => { data?: unknown; error?: unknown }): { client: any; queries: RecordedQuery[] };
  // run-fixtures.ts (shared test data; later tasks append to it)
  export const RUN_ID = "440d2fc6-658b-46fe-b288-05261faa0caf";                 // run 2
  export const RUN2_OK: Partial<Record<PolishBookmaker, number>>;               // { fuksiarz: 6222, forbet: 5869, etoto: 6553, betfan: 5600, lvbet: 9427, fortuna: 12897, superbet: 13353, betclic: 3150, sts: 5130 }
  export function outcome(p: Partial<BookmakerRunOutcome>): BookmakerRunOutcome;
  //   defaults: runId RUN_ID, bookmaker "sts", league "premier-league", status "success", matchesFound 20, marketsFound 0,
  //   marketsSaved 0, error null, startedAt 2026-11-06T16:00:00.350Z, finishedAt 2026-11-06T16:02:49.798Z, durationMs 169448
  ```
  The fake builder records every chained call (`select/insert/upsert/update/delete/eq/in/not/order/range/limit/single`), returns itself, and is thenable, resolving to `respond(q)`.

- [ ] **Step 1: Write the failing tests**

```ts
// run-outcome.test.ts
const shapes = JSON.parse(readFileSync(new URL("./fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url), "utf8"));
const twenty = Array.from({ length: 20 }, () => ({}) as FullMatchOffer);

describe("formatDbError", () => {
  it("extracts the socket cause from a supabase fetch failure", () => {
    expect(formatDbError(shapes.econnrefused)).toBe("TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)");
    expect(formatDbError(shapes.socketClosed)).toBe("TypeError: fetch failed (other side closed)");
    expect(formatDbError(shapes.epipe)).toBe("TypeError: fetch failed (write EPIPE)");
  });
  it("appends the PostgREST code when there is no socket cause", () => {
    expect(formatDbError(shapes.schemaCacheNotReady)).toBe("Could not query the database for the schema cache. Retrying. [PGRST002]");
    expect(formatDbError({ code: "PGRST204", message: "Could not find the 'run_id' column of 'scraper_runs' in the schema cache", details: null, hint: null }))
      .toBe("Could not find the 'run_id' column of 'scraper_runs' in the schema cache [PGRST204]");
  });
  it("handles Error instances and strings", () => {
    expect(formatDbError(new Error("boom"))).toBe("boom");
    expect(formatDbError("plain")).toBe("plain");
  });
});

describe("classifyBookmakerRun", () => {
  it("scraped but nothing saved is persist_failed with the DB cause", () => {
    const err = "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";
    expect(classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 5995, marketsSaved: 0, errors: [err] }))
      .toEqual({ status: "persist_failed", error: err });
  });
  it("all markets filtered is persist_failed", () => {
    expect(classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 420, marketsSaved: 0, errors: [] }))
      .toEqual({ status: "persist_failed", error: "0 of 420 normalized markets saved (all filtered as non-canonical)" });
  });
  it("saved with some failed batches is partial", () => {
    // Synthetic but arithmetically consistent with BATCH_SIZE 500 (full-offer-repository.ts:657):
    // 3301 records = 7 batches (6 x 500 + 301); one full batch failed -> 2801 saved.
    // Not observed live: in run 1 PGRST002 failed all 19 lvbet batches (log L28318 onwards); betclic had no batch errors.
    const err = "Batch insert failed (1 of 7 batches): Could not query the database for the schema cache. Retrying. [PGRST002]";
    expect(classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 3301, marketsSaved: 2801, errors: [err] }))
      .toEqual({ status: "partial", error: err });
  });
  it("clean save is success", () => {
    expect(classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 3150, marketsSaved: 3150, errors: [] }))
      .toEqual({ status: "success", error: null });
  });
  it("scraper failure keeps the scraper's text", () => {
    const err = "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
    expect(classifyBookmakerRun({ success: false, matches: [], error: err }, null)).toEqual({ status: "scrape_failed", error: err });
    expect(classifyBookmakerRun({ success: false, matches: [] }, null).error).toBe("Scraper returned success=false without an error message");
  });
  it("success with zero matches is empty", () => {
    expect(classifyBookmakerRun({ success: true, matches: [] }, null)).toEqual({ status: "empty", error: "Scraper reported success with 0 matches" });
  });
  it("empty keeps the enriched navigation text (Task 2 output survives classification)", () => {
    const err = "0 matches | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
    expect(classifyBookmakerRun({ success: true, matches: [], error: err }, null)).toEqual({ status: "empty", error: err });
  });
  it("isOkRunStatus", () => {
    expect(["success", "partial"].every(isOkRunStatus)).toBe(true);
    expect(["empty", "scrape_failed", "persist_failed", "running", null].some(isOkRunStatus)).toBe(false);
  });
});

// full-offer-repository-batch-errors.test.ts  (getSupabase mocked with createFakeSupabase; upsert -> { error: shapes.econnrefused })
// shapes = JSON.parse(readFileSync(new URL("../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url), "utf8"))
it("reports failed batches and the first formatted DB error", async () => {
  const r = await saveBatchFullOfferMarkets([{ homeTeam: "Everton", awayTeam: "Coventry City", markets: [matchWinner(1.65, 4.0, 5.0)] }], "forbet", "premier-league");
  expect(r).toMatchObject({ inserted: 0, failedBatches: 1, totalBatches: 1, firstError: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)" });
});
```
Here `matchWinner(h, d, a)` builds a `ScrapedMarket` with `normalizedType: "MATCH_WINNER"`, `marketKey: "MATCH_WINNER"` and HOME/DRAW/AWAY selections.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/services/__tests__/run-outcome.test.ts src/repositories/__tests__/full-offer-repository-batch-errors.test.ts`
Expected: FAIL. `run-outcome.js` does not exist, and `failedBatches` is undefined.

- [ ] **Step 3: Implement**

- `formatDbError`: an `Error` gives `.message`, a string gives itself, and an object gives the steps below.
  - `cause = /Caused by: (?:\w*Error: )?(.+?)(?: \([A-Z_]+\))?$/m.exec(details)?.[1]`. This regex was verified against all three captured shapes.
  - If there is a cause, return `` `${message} (${cause})` ``.
  - Otherwise, if `code` is set, return `` `${message} [${code}]` `` plus `` `: ${firstLine(details)}` `` when `details` is a non-empty string.
  - Otherwise return `message`.
- `classifyBookmakerRun` applies its rules in the order of the tests. The `scrape_failed` error is `scrape.error ?? "Scraper returned success=false without an error message"`, and the `empty` error is `scrape.error ?? "Scraper reported success with 0 matches"`.
- `saveBatchFullOfferMarkets` counts `totalBatches` and `failedBatches`, and keeps `firstError = formatDbError(error)` from the first failed batch.
- `scrape-helpers.ts:55-57` pushes `` `Batch insert failed (${failedBatches} of ${totalBatches} batches): ${firstError}` ``.

- [ ] **Step 4: Run them and confirm they pass**

Run: the same command, plus `npx vitest run src/repositories` (existing repository tests still pass).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/run-outcome.ts src/__tests__/helpers/fake-supabase.ts src/__tests__/helpers/run-fixtures.ts src/repositories/full-offer-repository.ts src/services/scrape-helpers.ts src/services/__tests__/run-outcome.test.ts src/services/__tests__/fixtures/observability src/repositories/__tests__/full-offer-repository-batch-errors.test.ts
git commit -m "feat(observability): classify bookmaker run outcomes and keep DB error causes"
```

---

### Task 2: Navigation diagnostics in the shared full-offer path

**Files:**
- Create: `src/scrapers/base/navigation-diagnostics.ts`
- Modify: `src/types/full-offer.ts:80-93`, `src/scrapers/base/playwright-base.ts:347-366`
- Test: `src/scrapers/base/__tests__/navigation-diagnostics.test.ts`
- Fixture: copy `evidence/observability/navigation-recorder-live-2026-11-06.json` → `src/scrapers/base/__tests__/fixtures/`, replacing the prototype-only `gotoError: null` with `failedNavigations: []`. Use this command (tested 2026-11-06 on a scratch copy):
  ```bash
  mkdir -p src/scrapers/base/__tests__/fixtures && python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); [(v.pop('gotoError'), v.__setitem__('failedNavigations', [])) for k, v in d.items() if k != '_source']; json.dump(d, open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)" docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/observability/navigation-recorder-live-2026-11-06.json src/scrapers/base/__tests__/fixtures/navigation-recorder-live-2026-11-06.json
  ```

**Interfaces:**
- Produces:
  ```ts
  // types/full-offer.ts
  export interface NavigationDiagnostics {
    documents: Array<{ requestedUrl: string; finalUrl: string; status: number }>; // main-frame only, max 50
    failedNavigations: Array<{ url: string; errorText: string }>; // main-frame documents that got no response, max 10
    failedRequests: Array<{ url: string; status: number; resourceType: string }>; // fetch/xhr >= 400, dedupe url+status, max 20
    websockets: string[]; // dedupe, max 10
    finalUrl: string | null; title: string | null;
  }
  // FullOfferScraperResult gains: diagnostics?: NavigationDiagnostics
  // navigation-diagnostics.ts
  export interface NavigationRecorder { current(): NavigationDiagnostics; snapshot(page: Page): Promise<NavigationDiagnostics>; detach(): void }
  export function attachNavigationRecorder(page: Page): NavigationRecorder;
  export function describeNavigationIssues(d: NavigationDiagnostics, opts?: { includeWebsockets?: boolean }): string[];
  export function enrichFullOfferFailure(result: FullOfferScraperResult, d: NavigationDiagnostics): FullOfferScraperResult;
  ```
- Separators (Task 3 and the acceptance checks rely on these): `" | "` between the scraper error and the issues, and `"; "` between issues.

- [ ] **Step 1: Write the failing tests**

```ts
const fx = JSON.parse(readFileSync(new URL("./fixtures/navigation-recorder-live-2026-11-06.json", import.meta.url), "utf8"));

describe("describeNavigationIssues (live 2026-11-06 captures)", () => {
  it("betters: 404 document", () =>
    expect(describeNavigationIssues(fx.betters)).toEqual(["document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485"]));
  it("totalbet: in-page fetch 404 to the retired REST API", () =>
    expect(describeNavigationIssues(fx.totalbet)).toEqual(["fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events"]));
  it("pzbuk: websocket list only when asked", () => {
    expect(describeNavigationIssues(fx.pzbuk)).toEqual([]);
    expect(describeNavigationIssues(fx.pzbuk, { includeWebsockets: true }))
      .toEqual(["websockets opened: wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl"]);
  });
  const base = { failedNavigations: [], failedRequests: [], websockets: [], finalUrl: null, title: null };
  it("off-host redirect and soft-404 title", () => {
    expect(describeNavigationIssues({ ...base, documents: [{ requestedUrl: "https://www.betters.pl/pl/league/1/4485", finalUrl: "https://betters.sptpub.com/", status: 200 }] }))
      .toEqual(["redirected www.betters.pl -> betters.sptpub.com"]);
    expect(describeNavigationIssues({ ...base, title: "404 - STRONA NIE ISTNIEJE", documents: [{ requestedUrl: "https://www.betters.pl/pl/league/1/4485", finalUrl: "https://www.betters.pl/pl/league/1/4485", status: 200 }] }))
      .toEqual(['page title "404 - STRONA NIE ISTNIEJE"']);
  });
  it("navigation that never got a response (DNS, refused, TLS, timeout)", () =>
    expect(describeNavigationIssues({ ...base, documents: [], failedNavigations: [{ url: "https://totalbet.pl/", errorText: "net::ERR_NAME_NOT_RESOLVED" }] }))
      .toEqual(["document failed net::ERR_NAME_NOT_RESOLVED https://totalbet.pl/"]));
  it("own-site failed requests first; other-site 401/403 dropped", () =>
    expect(describeNavigationIssues({ ...fx.totalbet, failedRequests: [
      { url: "https://analytics.example.com/collect", status: 401, resourceType: "xhr" },
      { url: "https://cdn.example.net/cfg.json", status: 500, resourceType: "fetch" },
      { url: "https://totalbet.pl/rest/market/categories/multi/7124/events", status: 404, resourceType: "fetch" },
    ] })).toEqual([
      "fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events",
      "fetch HTTP 500 https://cdn.example.net/cfg.json",
    ]));
});

describe("enrichFullOfferFailure", () => {
  it("appends issues to a failed result and attaches diagnostics", () => {
    const r = enrichFullOfferFailure({ success: false, bookmaker: "betters", league: "premier-league", matches: [], error: "No events found from API" }, fx.betters);
    expect(r.error).toBe("No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485");
    expect(r.diagnostics).toEqual(fx.betters);
  });
  it("adds websockets when the scraper error mentions WebSocket", () => {
    const r = enrichFullOfferFailure({ success: false, bookmaker: "pzbuk", league: "premier-league", matches: [], error: "No WebSocket data captured" }, fx.pzbuk);
    expect(r.error).toBe("No WebSocket data captured | websockets opened: wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl");
  });
  it("joins several issues with '; ' (separator contract)", () => {
    const d = { failedNavigations: [], failedRequests: [], websockets: [], finalUrl: null, title: null,
      documents: [{ requestedUrl: "https://www.betters.pl/pl/league/1/4485", finalUrl: "https://betters.sptpub.com/pl/league/1/4485", status: 404 }] };
    expect(enrichFullOfferFailure({ success: false, bookmaker: "betters", league: "premier-league", matches: [], error: "No events found from API" }, d).error)
      .toBe("No events found from API | document HTTP 404 https://betters.sptpub.com/pl/league/1/4485; redirected www.betters.pl -> betters.sptpub.com");
  });
  it("success with 0 matches gets the '0 matches' default text", () =>
    expect(enrichFullOfferFailure({ success: true, bookmaker: "betters", league: "premier-league", matches: [] }, fx.betters).error)
      .toBe("0 matches | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485"));
  it("returns a successful result untouched", () => {
    const ok = { success: true, bookmaker: "sts", league: "premier-league", matches: [{} as FullMatchOffer] } as FullOfferScraperResult;
    expect(enrichFullOfferFailure(ok, fx.betters)).toBe(ok);
  });
});

describe("attachNavigationRecorder", () => {
  // FakePage: EventEmitter with on/off, mainFrame(), url(), title();
  // fakeRequest({url,type,frame}) with failure(), redirectedFrom(); fakeResponse({url,status,type,frame})
  it("records main-frame documents, failed fetch/xhr and websockets; ignores 2xx fetch", () => { /* emit 4 events */
    expect(rec.current()).toMatchObject({ documents: [{ status: 404 }], failedRequests: [{ status: 404, resourceType: "fetch" }], websockets: ["wss://x/ws"] });
  });
  it("records a main-frame document that failed without a response", () => {
    page.emit("requestfailed", fakeRequest({ url: "https://totalbet.pl/", type: "document", frame: page.mainFrame(), errorText: "net::ERR_NAME_NOT_RESOLVED" }));
    expect(rec.current().failedNavigations).toEqual([{ url: "https://totalbet.pl/", errorText: "net::ERR_NAME_NOT_RESOLVED" }]);
  });
  it("reports a main-frame document still pending at snapshot time as 'no response' (goto timeout)", async () => {
    page.emit("request", fakeRequest({ url: "https://www.pzbuk.pl/pl/sportsbook", type: "document", frame: page.mainFrame() }));
    expect((await rec.snapshot(page)).failedNavigations).toEqual([{ url: "https://www.pzbuk.pl/pl/sportsbook", errorText: "no response" }]);
  });
  it("snapshot never throws when the page is closed (Review Focus 5)", async () => {
    page.title = () => Promise.reject(new Error("Target page, context or browser has been closed"));
    await expect(rec.snapshot(page)).resolves.toMatchObject({ title: null });
  });
  it("a throwing Playwright accessor inside a listener never escapes (Review Focus 5)", () => {
    const r = fakeResponse({ url: "https://sw.example/x", status: 200, type: "document" });
    r.frame = () => { throw new Error("Service Worker requests do not have an associated frame"); };
    expect(() => page.emit("response", r)).not.toThrow();
    expect(rec.current().documents).toEqual([]);
  });
});

describe("PlaywrightScraper.executeFullOfferScrape", () => {
  // TestScraper extends PlaywrightScraper; overrides protected initBrowser() to return { page: fakePage, cleanup: async () => {} }
  it("enriches a failed scrape with recorded navigation issues", async () => { /* scrapeLogic emits a 404 document then returns success:false */
    expect(result.error).toContain("| document HTTP 404 ");
  });
  it("enriches when scrapeLogic throws, using data recorded before the throw", async () => {
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/^boom \| document HTTP 404 /);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/scrapers/base/__tests__/navigation-diagnostics.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

- **Every listener body is wrapped in try/catch and never throws.** Playwright accessors such as `response.frame()`, `request.frame()` and `redirectedFrom()` can throw, for example on Service Worker requests. A throw inside an EventEmitter listener would escape into Playwright's dispatch.
- A main-frame document check is `request.resourceType()==="document" && request.frame()===page.mainFrame()`.
- `page.on("request")`: a main-frame document goes into a pending set.
- `page.on("response")`:
  - A main-frame document records `{ requestedUrl, finalUrl, status }` and leaves the pending set. `requestedUrl` is the first URL in the `redirectedFrom()` chain.
  - `fetch`/`xhr` with `status() >= 400` records a failed request.
- `page.on("requestfinished")` removes the request from the pending set.
- `page.on("requestfailed")`: a main-frame document leaves the pending set and records `{ url, errorText: request.failure()?.errorText ?? "unknown" }` in `failedNavigations`.
- `page.on("websocket", ws => ws.url())`.
- `current()` and `snapshot()` append each still-pending main-frame document as `{ url, errorText: "no response" }`. That case is a `page.goto` timeout before any response: Playwright fires no `requestfailed` until the context closes.
- `snapshot` adds `page.url()` and `page.title()`, each in its own try/catch with a 2 s timeout.
- Issue rules, in this order:
  1. Document ≥ 400 → `` `document HTTP ${status} ${finalUrl}` ``.
  2. Each failed navigation → `` `document failed ${errorText} ${url}` ``.
  3. Requested host ≠ final host → `` `redirected ${a} -> ${b}` ``.
  4. Failed requests:
     - "Own site" is the last two labels of the first document's `requestedUrl` host, e.g. `totalbet.pl`.
     - List own-site requests first, then the others, keeping arrival order within each group.
     - Drop 401/403 responses from other sites; these are anonymous analytics or customer calls.
     - Take the first 3 and format each as `` `${resourceType} HTTP ${status} ${url}` ``.
  5. A soft-404 title (`/\b404\b|nie istnieje|nie znaleziono|not found/i`) adds `` `page title "${title}"` ``, **only if rule 1 produced nothing**.
  6. With `includeWebsockets`, add `` `websockets opened: ${list.join(", ") || "none"}` ``.
- `enrichFullOfferFailure` acts only when `!success || matches.length === 0`.
  - `includeWebsockets` is `/websocket/i.test(error)`.
  - The default text is `"Scrape failed"` when `!success`, and `"0 matches"` when `success` is true.
  - With no issues, it returns `{ ...result, diagnostics: d }` and leaves the error unchanged.
  - Otherwise the error is `` `${result.error ?? default} | ${issues.join("; ")}` ``.
- In `executeFullOfferScrape`, attach the recorder inside the operation lambda: `enrichFullOfferFailure(await scrapeLogic(page, league), await rec.snapshot(page))`. In the error handler, enrich `createFullOfferErrorResult(...)` with `rec.current()`, guarded when the recorder is null.

- [ ] **Step 4: Run them and confirm they pass**

Run: `npx vitest run src/scrapers` (new test file plus all parser tests).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/full-offer.ts src/scrapers/base/navigation-diagnostics.ts src/scrapers/base/playwright-base.ts src/scrapers/base/__tests__
git commit -m "feat(scrapers): record HTTP status, host and websockets for failed full-offer scrapes"
```

---

### Task 3: Aggregator returns honest outcomes

**Files:**
- Modify: `src/scrapers/aggregator.ts:204-334`. Delete `runSingleFullOfferScraper` (`:336-366`), which has no callers (verified by grep over `src` and `scripts`).
- Test: `src/scrapers/__tests__/aggregator-outcomes.test.ts`

**Interfaces:**
- Consumes: `classifyBookmakerRun`, `BookmakerRunOutcome`, `isOkRunStatus` (Task 1). `NormalizeAndSaveResult` (`scrape-helpers.ts:6-11`).
- Produces: `FullOfferAggregatedResult` gains `outcomes: BookmakerRunOutcome[]`, in `targetBookmakers` order. `summary` gains `totalMarketsSaved: number`. `successCount` counts OK outcomes, and `errorCount = outcomes.length - successCount`. `results` stays for back-compat.
- Counts, decided:
  - `outcome.marketsFound` is the **raw** count, summed **before** `normalizeAndSaveMatches`, which mutates `match.markets` (`scrape-helpers.ts:34`).
  - `summary.totalMarketsFound` stays the post-normalization count it is today (`aggregator.ts:309`, run 2: 90752). `/api/health` `marketsScraped` therefore does not change meaning.
- Log formats:
  - Per bookmaker: `` `[Aggregator/FullOffer] ${bm} ${status}: ${matches} matches, ${found} markets found, ${saved} saved` `` plus `` ` - ${error}` `` when an error exists. Not-OK lines go to `console.error`.
  - Per run: `` `[Aggregator/FullOffer] Run ${runId} completed in ${ms}ms: ${ok} ok, ${failed} failed, ${matches} matches, ${found} markets found, ${saved} saved` ``.

- [ ] **Step 1: Write the failing tests**

`vi.mock("../bookmakers/index.js")` uses a factory (built with `vi.hoisted`) that exports all 14 `*Scraper` names (`aggregator.ts:14-29`), each a `fakeScraper(...)`. Tests reconfigure a scraper through `scrapers.<bm>.scrapeFullOffer.mockResolvedValueOnce(...)` / `mockRejectedValueOnce(...)`. `vi.mock("../../services/scrape-helpers.js")` stubs `normalizeAndSaveMatches` as `save`, and `errorSpy = vi.spyOn(console, "error")`.

```ts
// local to aggregator-outcomes.test.ts, defined inside the vi.hoisted(() => { ... }) block that also builds `scrapers`
const fakeScraper = (result: FullOfferScraperResult | Error = { success: false, bookmaker: "sts", league: "premier-league", matches: [], error: "not under test" }) => ({
  scrapeFullOffer: vi.fn(async () => { if (result instanceof Error) throw result; return result; }),
  cleanup: vi.fn(async () => {}),
});
const twenty = Array.from({ length: 20 }, (_, i) => ({ homeTeam: `H${i}`, awayTeam: `A${i}`, markets: [{} as ScrapedMarket] }) as FullMatchOffer);

it("counts a bookmaker whose markets were not persisted as failed", async () => {
  scrapers.forbet.scrapeFullOffer.mockResolvedValueOnce({ success: true, bookmaker: "forbet", league: "premier-league", matches: twenty });
  save.mockResolvedValueOnce({ matchesProcessed: 20, marketsNormalized: 5995, marketsSaved: 0,
    errors: ["Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)"] });
  const r = await runAllFullOfferScrapers("premier-league", ["forbet"]);
  expect(r.summary).toMatchObject({ successCount: 0, errorCount: 1, totalMarketsSaved: 0 });
  expect(r.outcomes[0]).toMatchObject({ bookmaker: "forbet", status: "persist_failed", matchesFound: 20 });
  expect(r.outcomes[0].error).toContain("ECONNREFUSED 127.0.0.1:59999");
});
it("logs the scraper's error text", async () => {
  scrapers.betters.scrapeFullOffer.mockResolvedValueOnce({ success: false, bookmaker: "betters", league: "premier-league", matches: [],
    error: "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485" });
  const r = await runAllFullOfferScrapers("premier-league", ["betters"]);
  expect(r.outcomes[0].status).toBe("scrape_failed");
  expect(errorSpy.mock.calls.flat().join("\n")).toContain("betters scrape_failed: 0 matches, 0 markets found, 0 saved - No events found from API | document HTTP 404");
});
it("sums saved markets from OK outcomes only", async () => { /* betclic and sts return `twenty`; save resolves 3150 then 5130 saved, errors [] */
  expect(r.summary).toMatchObject({ successCount: 2, totalMarketsSaved: 8280 });
});
it("turns a thrown scraper into scrape_failed with the exception message", async () => {
  scrapers.sts.scrapeFullOffer.mockRejectedValueOnce(new Error("browserType.launch: Executable doesn't exist"));
  const r = await runAllFullOfferScrapers("premier-league", ["sts"]);
  expect(r.outcomes[0]).toMatchObject({ status: "scrape_failed", error: "browserType.launch: Executable doesn't exist" });
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/scrapers/__tests__/aggregator-outcomes.test.ts`. Expected: FAIL (`outcomes` undefined).
- [ ] **Step 3: Implement** the outcome collection in `runAllFullOfferScrapers`. Record `startedAt` per bookmaker. `finishedAt` is taken after the save. `durationMs = result.duration ?? (finishedAt - startedAt)`.
- [ ] **Step 4: Run them and confirm they pass.** Run the same file, then `npx tsc --noEmit`. `scraper-service.ts` still compiles because `results` and `summary` keep their fields.
- [ ] **Step 5: Commit**

```bash
git add src/scrapers/aggregator.ts src/scrapers/__tests__/aggregator-outcomes.test.ts
git commit -m "fix(aggregator): count bookmakers by saved markets and log the real failure cause"
```

---

### Task 4: Persist outcomes to `scraper_runs`

**Files:**
- Create: `supabase/migrations/11_scraper_runs_observability.sql`, `src/utils/db-timestamp.ts`
- Modify:
  - `src/types/database.ts:140-167`
  - `src/repositories/scraper-run-repository.ts`:
    - Replace `insertScraperRuns` (`:96-123`).
    - Change `getRunsSummary` (`:158-248`): select `run_id` too, and group by `run_id ?? <minute bucket>` (`:199-206`).
    - Change `getLastSuccessfulScrapeTime` (`:253-274`).
    - Change `getAverageScrapeDurations` (`:279-315`) to the OK statuses.
    - Replace the inline Z-append helpers (`:193-197`, `:271-273`) with `parseDbTimestamp`. Today they turn PostgREST's `+00:00` output into `Invalid Date`.
  - `src/services/tsdb-sync-service.ts:14-27`: `parseKickoffTime` calls `parseDbTimestamp(ts).toISOString()` in place of its inline check at `:17`, which is moved into `db-timestamp.ts`. The 2 other branches stay as they are.
  - `src/routes/admin.ts:90-105`: `successCount`, `errorCount` and the per-result `status` use `isOkRunStatus(r.status)` instead of `=== "success"`.
  - `src/services/scraper-service.ts:3`: drop the `insertScraperRuns` import.
- Test: `src/utils/__tests__/db-timestamp.test.ts`, `src/repositories/__tests__/scraper-run-repository.test.ts`, `src/routes/__tests__/admin-runs.test.ts`
- Fixture: repository tests read `../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json` (copied in Task 1).

**Interfaces:**
- Consumes: `BookmakerRunOutcome`, `OK_RUN_STATUSES`, `isOkRunStatus`, `formatDbError` (Task 1), `createFakeSupabase` (Task 1).
- Produces:
  ```ts
  export function parseDbTimestamp(ts: string): Date; // /Z$|[+-]\d{2}:\d{2}$/ (the tsdb-sync-service.ts:17 rule) -> as is; otherwise, defensively, appended "Z"
  export type ScraperRunOutcomeRow = Required<Pick<ScraperRunInsert,
    "run_id" | "bookmaker" | "league_slug" | "status" | "matches_found" | "markets_found" | "markets_saved" |
    "error_message" | "started_at" | "finished_at" | "duration_ms">>; // every field present; satisfies RunRowLike (Task 5)
  export function toScraperRunInsert(o: BookmakerRunOutcome): ScraperRunOutcomeRow; // error_message truncated to 2000 chars
  export async function insertBookmakerRunOutcomes(outcomes: BookmakerRunOutcome[]): Promise<void>;
  //   throws Error(`scraper_runs insert failed: ${formatDbError(e)}`), with
  //   " (apply supabase/migrations/11_scraper_runs_observability.sql)" appended when e.code === "PGRST204"
  export async function getRecentRunRows(leagueSlug: string, limit: number): Promise<ScraperRunRow[]>; // order started_at desc
  export async function getLastSuccessfulScrapeTime(leagueSlug?: string): Promise<Date | null>; // status in OK_RUN_STATUSES; null on error
  // getRunsSummary keeps its signature and return shape; the group key and batchId become run_id when present
  ```
  - `ScraperRunRow` gains `run_id: string | null` and `markets_found: number | null`.
  - `ScraperRunInsert` gains `run_id?: string | null` and `markets_found?: number | null`.
  - `Required<Pick<…>>` removes the `?` from the Insert fields. Without it, `string | undefined` would not be assignable to `RunRowLike`'s `string`, and `npx tsc --noEmit` would fail in `scraper-service.ts`, Task 7 step 7.

Migration content (exact):

```sql
-- 11: scraper run observability. Additive and nullable: existing rows stay valid.
-- status written by the service from now on: success | partial | empty | scrape_failed | persist_failed
ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS markets_found INTEGER;
CREATE INDEX IF NOT EXISTS idx_scraper_runs_league_bm_started
  ON scraper_runs (league_slug, bookmaker, started_at DESC);
```

- [ ] **Step 1: Write the failing tests**

```ts
// db-timestamp.test.ts  (Review Focus 3)
it("parses the real PostgREST timestamptz shape (db-probe §3)", () => {
  expect(parseDbTimestamp("2026-11-06T16:02:49.048+00:00").toISOString()).toBe("2026-11-06T16:02:49.048Z");
  expect(parseDbTimestamp("2026-11-06T17:02:49.048+01:00").toISOString()).toBe("2026-11-06T16:02:49.048Z");
  expect(parseDbTimestamp("2026-11-06T16:02:49.048Z").toISOString()).toBe("2026-11-06T16:02:49.048Z");
});
it("defensively treats offset-less input as UTC (host is Europe/Warsaw)", () =>
  expect(parseDbTimestamp("2026-11-06T16:00:00.35").toISOString()).toBe("2026-11-06T16:00:00.350Z"));

// scraper-run-repository.test.ts
const forbet: BookmakerRunOutcome = { runId: "50a12b0c-89a9-43fe-8173-fc718d1b3bdd", bookmaker: "forbet", league: "premier-league",
  status: "persist_failed", matchesFound: 20, marketsFound: 5995, marketsSaved: 0,
  error: "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)",
  startedAt: new Date("2026-11-06T16:27:40.830Z"), finishedAt: new Date("2026-11-06T16:27:48.826Z"), durationMs: 7969 };
it("maps an outcome to a scraper_runs row", () =>
  expect(toScraperRunInsert(forbet)).toEqual({ run_id: "50a12b0c-89a9-43fe-8173-fc718d1b3bdd", bookmaker: "forbet", league_slug: "premier-league",
    status: "persist_failed", matches_found: 20, markets_found: 5995, markets_saved: 0, error_message: forbet.error,
    started_at: "2026-11-06T16:27:40.830Z", finished_at: "2026-11-06T16:27:48.826Z", duration_ms: 7969 }));
it("truncates error_message to 2000 chars", () =>
  expect(toScraperRunInsert({ ...forbet, error: "x".repeat(5000) }).error_message).toHaveLength(2000));
it("inserts all outcomes in one call", async () => { /* fake insert ok */ expect(fake.queries[0]).toMatchObject({ table: "scraper_runs" }); });
it("throws a formatted error", async () => { /* insert -> { error: shapes.schemaCacheNotReady } */
  await expect(insertBookmakerRunOutcomes([forbet])).rejects.toThrow("scraper_runs insert failed: Could not query the database for the schema cache. Retrying. [PGRST002]"); });
it("names the migration when a column is missing (Review Focus 2)", async () => { /* { code: "PGRST204", message: "Could not find the 'run_id' column of 'scraper_runs' in the schema cache" } */
  await expect(insertBookmakerRunOutcomes([forbet])).rejects.toThrow("(apply supabase/migrations/11_scraper_runs_observability.sql)"); });
it("last successful scrape is per league, counts partial, and parses +00:00 (Review Focus 3)", async () => { /* data: [{ finished_at: "2026-11-06T16:02:49.798+00:00" }] */
  expect((await getLastSuccessfulScrapeTime("premier-league"))!.toISOString()).toBe("2026-11-06T16:02:49.798Z");
  expect(fake.queries[0].calls).toContainEqual(["in", "status", ["success", "partial"]]);
  expect(fake.queries[0].calls).toContainEqual(["eq", "league_slug", "premier-league"]);
});
it("getRunsSummary groups real +00:00 rows without throwing (today: RangeError -> /api/admin/runs 500)", async () => {
  /* data, in the order the DB returns it (started_at desc), both with run_id RUN_ID and league premier-league:
     betters started_at "2026-11-06T16:01:30.1+00:00",  finished_at "2026-11-06T16:01:38.2+00:00"
     sts     started_at "2026-11-06T16:00:00.35+00:00", finished_at "2026-11-06T16:02:49.048+00:00"
     (different minutes, so the old minute bucket would split them into 2 runs) */
  const { runs, total } = await getRunsSummary(20, 0);
  expect(total).toBe(1);
  expect(runs[0].batchId).toBe("440d2fc6-658b-46fe-b288-05261faa0caf");
  expect(runs[0].startedAt.toISOString()).toBe("2026-11-06T16:00:00.350Z");
  expect(runs[0].finishedAt!.toISOString()).toBe("2026-11-06T16:02:49.048Z");
  expect(runs[0].results).toHaveLength(2);
});

// admin-runs.test.ts: express().use(express.json()).use("/api/admin", adminRouter).use(errorHandler) on port 0;
// getRunsSummary mocked to return one run whose results have statuses success, partial, scrape_failed
it("counts partial as OK in /api/admin/runs", async () => {
  const res = await fetch(`${base}/api/admin/runs`, { headers: { Authorization: `Bearer ${CONFIG.ADMIN_API_KEY}` } });
  const run = (await res.json()).data.runs[0];
  expect(run.summary).toMatchObject({ successCount: 2, errorCount: 1 });
  expect(run.results.map((r: { status: string }) => r.status)).toEqual(["success", "success", "error"]);
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/utils/__tests__/db-timestamp.test.ts src/repositories/__tests__/scraper-run-repository.test.ts src/routes/__tests__/admin-runs.test.ts`. Expected: FAIL. `getRunsSummary` throws `RangeError: Invalid time value`, and `partial` is counted as an error.
- [ ] **Step 3: Implement** the functions above. Remove `insertScraperRuns` and its now-unused `ScraperResult` import.
  - `getRecentRunRows` selects `*`, filters with `.eq("league_slug", …)`, orders by `started_at` descending and applies `.limit(limit)`.
  - `getRunsSummary` uses `row.run_id ?? <existing minute-bucket key>` both as the group key and as `batchId`. A group's `startedAt` is the earliest `started_at` in the group, and `finishedAt` is the latest `finished_at`, as today.
  - Move the offset check out of `tsdb-sync-service.ts:17` into `parseDbTimestamp`. That leaves one helper, not three variants. No TSDB test exists today. The `db-timestamp` tests cover the shared rule, since appending `+00:00` and appending `Z` are equivalent.
- [ ] **Step 4: Run them and confirm they pass.** Run the same files, then `npx tsc --noEmit`. Expected: PASS. The tsc check fails if `scraper-service.ts:3` still imports `insertScraperRuns`; remove that import in this task.
- [ ] **Step 5: Apply the migration** (operator approval, DB-mutating):

Run: `./scripts/apply-migrations.sh 11_scraper_runs_observability.sql`
Expected: `✓ Migration applied successfully`.
Verify: `set -a; . ./.env; set +a; curl -s "$SUPABASE_URL/rest/v1/scraper_runs?select=run_id,markets_found&limit=1" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"` returns `[]`, not a PGRST204 error.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/11_scraper_runs_observability.sql src/utils/db-timestamp.ts src/utils/__tests__/db-timestamp.test.ts src/types/database.ts src/repositories/scraper-run-repository.ts src/repositories/__tests__/scraper-run-repository.test.ts src/services/scraper-service.ts src/services/tsdb-sync-service.ts src/routes/admin.ts src/routes/__tests__/admin-runs.test.ts
git commit -m "feat(db): persist per-bookmaker run outcomes to scraper_runs"
```

---

### Task 5: Bookmaker status from run history and per-bookmaker freshness

**Files:**
- Create: `src/services/bookmaker-status.ts`
- Modify:
  - `src/repositories/odds-repository.ts:110-129` (`getLastScrapeTime`, no callers today: `leagueSlug` becomes required, it throws on a PostgREST error, and it parses with `parseDbTimestamp`)
  - `src/repositories/odds-repository.ts:131-164` (replace `getBookmakerStatus`)
  - `src/types/database.ts:26`
  - `src/services/odds-service.ts:175-204` (`getBookmakerStatusMap` → snapshot status)
  - `src/routes/bookmakers.ts:59-90` (interim switch to the snapshot, Step 3)
  - `src/__tests__/helpers/run-fixtures.ts` (add `summary()`)
- Test: `src/services/__tests__/bookmaker-status.test.ts`, `src/repositories/__tests__/odds-repository-freshness.test.ts`

**Interfaces:**
- Consumes: `getRecentRunRows`, `getLastSuccessfulScrapeTime`, `parseDbTimestamp`, `ScraperRunOutcomeRow` (Task 4). `isOkRunStatus`, `BookmakerRunStatus` (Task 1).
- Produces:
  ```ts
  export type BookmakerStatus = "available" | "stale" | "error"; // types/database.ts
  export type RunRowLike = Pick<ScraperRunRow, "run_id" | "bookmaker" | "status" | "started_at" | "finished_at" | "error_message" | "matches_found" | "markets_saved">;
  //   Task 4's ScraperRunOutcomeRow is assignable to RunRowLike (all fields required; checked with tsc on a scratch copy of the types)
  export function mergeRunRows(primary: RunRowLike[], secondary: RunRowLike[]): RunRowLike[];
  //   all primary rows, plus secondary rows whose key is not in primary; key = `${bookmaker}|${run_id ?? parseDbTimestamp(started_at).toISOString()}`
  export interface BookmakerRunSummary {
    bookmaker: PolishBookmaker; lastStatus: string | null; lastRunAt: string | null; lastSuccessAt: string | null;
    consecutiveFailures: number; failingSince: string | null; lastError: string | null;
    lastMatchesFound: number; lastMarketsSaved: number; recoveredAfterFailures: number;
  }
  export interface BookmakerHealthMeta { status: BookmakerStatus; lastSuccessAt: string | null; failingSince: string | null; consecutiveFailures: number }
  export interface BookmakerStatusSnapshot {
    source: "scraper_runs" | "odds_only"; status: Record<PolishBookmaker, BookmakerStatus>; health: Record<PolishBookmaker, BookmakerHealthMeta>;
    summaries: Map<PolishBookmaker, BookmakerRunSummary>; lastOddsAt: Map<PolishBookmaker, Date>; lastSuccessfulRunAt: string | null;
  }
  export const STATUS_WINDOW_RUNS = 50; // rows fetched = 50 * CONFIG.BOOKMAKERS.length = 700 < PostgREST max_rows 1000
  export function staleAfterMs(intervalMinutes: number): number; // max(2 * interval, 60) minutes
  export function summarizeBookmakerRuns(rows: RunRowLike[], bookmakers: readonly PolishBookmaker[]): Map<PolishBookmaker, BookmakerRunSummary>;
  export function deriveBookmakerStatus(s: BookmakerRunSummary | undefined, lastOddsAt: Date | null, now: Date, staleAfter: number): BookmakerStatus;
  export function worstBookmakerStatus(a: BookmakerStatus | undefined, b: BookmakerStatus): BookmakerStatus; // error > stale > available
  export async function getBookmakerStatusSnapshot(leagueSlug: string, now?: Date): Promise<BookmakerStatusSnapshot>;
  // odds-repository.ts
  export async function getLastScrapeTime(bookmaker: PolishBookmaker, leagueSlug: string): Promise<Date | null>; // existing query (:116-122); now throws on error
  export async function getOddsFreshnessByBookmaker(leagueSlug: string, bookmakers: readonly PolishBookmaker[]): Promise<Map<PolishBookmaker, Date>>;
  //   Promise.all(bookmakers.map((bm) => getLastScrapeTime(bm, leagueSlug))): one limit(1) query per bookmaker, no new query code
  // run-fixtures.ts (appended)
  export function summary(p: Partial<BookmakerRunSummary> & { bookmaker: PolishBookmaker }): BookmakerRunSummary;
  //   defaults: lastStatus "success", lastRunAt/lastSuccessAt "2026-11-06T16:00:00.350Z", consecutiveFailures 0, failingSince null,
  //   lastError null, lastMatchesFound 20, lastMarketsSaved 0, recoveredAfterFailures 0
  ```
- Summary algorithm: sort each bookmaker's rows by `started_at` descending.
  - `consecutiveFailures` = the leading run of non-OK rows. `failingSince` = `started_at` of the oldest row in that run.
  - `lastSuccessAt` = `finished_at ?? started_at` of the newest OK row.
  - `recoveredAfterFailures` = the length of the non-OK run directly after the newest row, counted only when the newest row is OK.
  - All timestamps go through `parseDbTimestamp(...).toISOString()`.
- Status rule:
  1. A summary with `consecutiveFailures > 0` gives `error`.
  2. Otherwise, the newer of `lastSuccessAt` and `lastOddsAt` within `staleAfter` gives `available`.
  3. Otherwise `stale`.
- `getBookmakerStatusSnapshot` runs three reads in parallel: `getRecentRunRows`, `getOddsFreshnessByBookmaker`, and `getLastSuccessfulScrapeTime(leagueSlug)`.
  - `lastSuccessfulRunAt = (await getLastSuccessfulScrapeTime(leagueSlug))?.toISOString() ?? null`. That is per league, over OK statuses, and not limited to the 50-run window. This keeps `getLastSuccessfulScrapeTime` as the single source; `getBookmakerStatusSnapshot` does not compute a max over the summaries.
  - Fallbacks: if `getRecentRunRows` throws, use `source: "odds_only"` with empty summaries. If the freshness query throws, every bookmaker is `stale`, as before. `getLastSuccessfulScrapeTime` already returns null on error.
  - The function never throws.

- [ ] **Step 1: Write the failing tests** (real values from `db-probe-2026-11-06.txt` and the log)

```ts
const NOW = new Date("2026-11-06T16:16:18.614Z"); const STALE = staleAfterMs(60);
const row = (bookmaker, status, started_at, extra = {}) => ({ run_id: null, bookmaker, status, started_at, finished_at: null, error_message: null, matches_found: 0, markets_saved: 0, ...extra });

it("betcris: failed after an earlier success is error, not available", () => {
  const s = summarizeBookmakerRuns([
    row("betcris", "scrape_failed", "2026-11-06T16:00:00.35+00:00", { error_message: "No WebSocket data captured" }),
    row("betcris", "success", "2026-11-06T15:44:03+00:00", { finished_at: "2026-11-06T15:46:48.552+00:00", matches_found: 20, markets_saved: 9753 }),
  ], ["betcris"]).get("betcris")!;
  expect(s).toMatchObject({ lastStatus: "scrape_failed", consecutiveFailures: 1, failingSince: "2026-11-06T16:00:00.350Z",
    lastSuccessAt: "2026-11-06T15:46:48.552Z", lastError: "No WebSocket data captured" });
  expect(deriveBookmakerStatus(s, new Date("2026-11-06T15:46:48.552Z"), NOW, STALE)).toBe("error");
});
it("no run history: fresh odds are available (fortuna, today reported stale)", () =>
  expect(deriveBookmakerStatus(undefined, new Date("2026-11-06T16:00:45.385Z"), NOW, STALE)).toBe("available"));
it("no run history: August odds or none are stale (lebull, betters)", () => {
  expect(deriveBookmakerStatus(undefined, new Date("2026-08-22T08:00:07.846Z"), NOW, STALE)).toBe("stale");
  expect(deriveBookmakerStatus(undefined, null, NOW, STALE)).toBe("stale");
});
it("offset-less timestamps are UTC (defensive, Review Focus 3)", () =>
  expect(summarizeBookmakerRuns([row("sts", "success", "2026-11-06T16:00:00.35")], ["sts"]).get("sts")!.lastSuccessAt).toBe("2026-11-06T16:00:00.350Z"));
it("mergeRunRows: in-memory rows win, DB duplicates of the same run are dropped (Review Focus 2)", () => {
  const mem = [row("betters", "scrape_failed", "2026-11-06T16:00:00.350Z", { run_id: "440d2fc6-658b-46fe-b288-05261faa0caf", error_message: "mem" })];
  const db = [
    row("betters", "scrape_failed", "2026-11-06T16:00:00.35+00:00", { run_id: "440d2fc6-658b-46fe-b288-05261faa0caf", error_message: "db" }),
    row("betters", "scrape_failed", "2026-11-06T15:00:00+00:00", { run_id: "7067e5f0-35c2-4bae-a045-5501547505a7" }),
  ];
  const merged = mergeRunRows(mem, db);
  expect(merged).toHaveLength(2);
  expect(merged.find((r) => r.run_id === "440d2fc6-658b-46fe-b288-05261faa0caf")!.error_message).toBe("mem");
  expect(summarizeBookmakerRuns(merged, ["betters"]).get("betters")!.consecutiveFailures).toBe(2);
});
it("recovery after 3 failures", () =>
  expect(summarizeBookmakerRuns(["success", "scrape_failed", "scrape_failed", "scrape_failed"].map((st, i) => row("pzbuk", st, `2026-11-06T1${6 - i}:00:00Z`)), ["pzbuk"]).get("pzbuk"))
    .toMatchObject({ consecutiveFailures: 0, recoveredAfterFailures: 3 }));
it("staleAfterMs covers one missed run", () => { expect(staleAfterMs(60)).toBe(7_200_000); expect(staleAfterMs(5)).toBe(3_600_000); });
it("worst status wins", () => {
  expect(worstBookmakerStatus("available", "error")).toBe("error");
  expect(worstBookmakerStatus("error", "stale")).toBe("error");
  expect(worstBookmakerStatus(undefined, "stale")).toBe("stale");
});

// odds-repository-freshness.test.ts (fake client)
it("issues one limit(1) query per bookmaker instead of an unbounded scan", async () => {
  const m = await getOddsFreshnessByBookmaker("premier-league", ["sts", "fortuna", "totalbet"]); // fake returns [] for totalbet
  expect(fake.queries).toHaveLength(3);
  for (const q of fake.queries) expect(q.calls).toContainEqual(["limit", 1]);
  expect(m.get("fortuna")!.toISOString()).toBe("2026-11-06T16:00:45.385Z"); // fake data: [{ scraped_at: "2026-11-06T16:00:45.385+00:00" }]
  expect(m.has("totalbet")).toBe(false);
});
it("rejects when PostgREST errors, so the snapshot falls back to all-stale", async () => { /* fake -> { error: shapes.econnrefused } */
  await expect(getOddsFreshnessByBookmaker("premier-league", ["sts"])).rejects.toThrow();
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/services/__tests__/bookmaker-status.test.ts src/repositories/__tests__/odds-repository-freshness.test.ts`
- [ ] **Step 3: Implement.** Delete `getBookmakerStatus`. Its two callers are switched to the snapshot in this task, so tsc stays green. Task 8 then finishes both surfaces.
  - `odds-service.ts:175-204`: `getBookmakerStatusMap(leagueSlug)` becomes `(await getBookmakerStatusSnapshot(leagueSlug)).status`. The local 60-min threshold and its try/catch go away, because the snapshot never throws.
  - `routes/bookmakers.ts:59-90`:
    - `const snap = await getBookmakerStatusSnapshot(CONFIG.ENABLED_LEAGUES[0])`, replacing `getBookmakerStatus()` with its `ekstraklasa` default.
    - In the loop (`:70-90`): `status = snap.status[bm]`, `lastSuccessfulScrape = snap.lastOddsAt.get(bm)?.toISOString() ?? null`, and `matchesFound = 0` until Task 8 fills it from the summary.
    - `bmStatus`, `now` and `staleThreshold` (`:63-64`, `:71`, `:78-83`) are deleted.
    - The interim `matchesFound = 0` is no regression. Today the route reports 0 for all 14 bookmakers (the `ekstraklasa` default, see the status table), and on premier-league the capped scan would credit only sts.
- [ ] **Step 4: Run them and confirm they pass.** Run the same files, then `npx vitest run`, then `npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add src/services/bookmaker-status.ts src/repositories/odds-repository.ts src/types/database.ts src/services/odds-service.ts src/routes/bookmakers.ts src/__tests__/helpers/run-fixtures.ts src/services/__tests__/bookmaker-status.test.ts src/repositories/__tests__/odds-repository-freshness.test.ts
git commit -m "fix(status): derive bookmaker status from run history; drop 1000-row-capped scan"
```

---

### Task 6: Run summary line and alert hook

**Files:**
- Create: `src/services/run-alerts.ts`
- Modify: `src/config/index.ts:26-68` (add `ALERT_CONSECUTIVE_FAILURES: parseInt(process.env.ALERT_CONSECUTIVE_FAILURES || "3")` and `ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL || null`), `.env.example`, which gets both variables commented out with one explanatory line each.
- Test: `src/services/__tests__/run-alerts.test.ts`

**Interfaces:**
- Consumes: `BookmakerRunOutcome`, `isOkRunStatus` (Task 1). `BookmakerRunSummary` (Task 5).
- Produces:
  ```ts
  export function formatRunSummaryLine(a: { league: string; runId: string; finishedAt: Date; outcomes: BookmakerRunOutcome[] }): string;
  export function buildRunAlerts(a: { league: string; outcomes: BookmakerRunOutcome[]; summaries: Map<PolishBookmaker, BookmakerRunSummary>; threshold: number }): string[];
  export function formatAbortAlert(league: string, reason: string): string;
  export async function emitAlerts(lines: string[], webhookUrl: string | null): Promise<void>; // never throws
  ```
- Exact formats:
  - Summary: `` `[ScrapeRun] ${league} run=${runId.slice(0, 8)} finished=${iso} ok=${ok}/${n} matches=${Σmatches} saved=${ΣmarketsSaved of OK} failed=${"bm:status" joined by "," | "none"}` ``
  - Abort: `` `[ALERT] scrape run ABORTED for ${league}: database unreachable - ${reason}` ``
  - Persist (always, threshold-independent, one line per run): `` `[ALERT] ${league}: ${k} bookmaker(s) scraped but NOT saved (${list}) - ${firstError}` ``
  - Streak (only when `consecutiveFailures === threshold`, so once per streak): `` `[ALERT] ${bm} (${league}) failed ${n} consecutive runs since ${failingSince}: ${lastError}` ``
  - Resolved (when `recoveredAfterFailures >= threshold`): `` `[ALERT-RESOLVED] ${bm} (${league}) ok again after ${n} failed runs` ``
  - Empty collapse (no OK outcome and `empty * 2 >= n`): `` `[ALERT] ${league}: ${empty}/${n} bookmakers returned 0 matches - per-bookmaker alerts suppressed for this run` ``. This replaces the streak alerts for that run.
- `emitAlerts`: `console.error` each line. If `webhookUrl` is set and `lines.length > 0`, POST `{"text": lines.join("\n")}` as JSON with `signal: AbortSignal.timeout(5000)`. On failure, `console.warn("[RunAlerts] webhook failed: …")`.

- [ ] **Step 1: Write the failing tests** (run-2 numbers)

```ts
import { outcome, summary, RUN2_OK } from "../../__tests__/helpers/run-fixtures.js";
const run2 = CONFIG.BOOKMAKERS.map((bm) => RUN2_OK[bm] !== undefined
  ? outcome({ bookmaker: bm, status: "success", matchesFound: 20, marketsSaved: RUN2_OK[bm] })
  : outcome({ bookmaker: bm, status: "scrape_failed", matchesFound: 0, marketsSaved: 0, error: "No events found from API" }));

it("one summary line for run 2", () =>
  expect(formatRunSummaryLine({ league: "premier-league", runId: "440d2fc6-658b-46fe-b288-05261faa0caf", finishedAt: new Date("2026-11-06T16:02:49.798Z"), outcomes: run2 }))
    .toBe("[ScrapeRun] premier-league run=440d2fc6 finished=2026-11-06T16:02:49.798Z ok=9/14 matches=180 saved=68201 failed=betters:scrape_failed,lebull:scrape_failed,betcris:scrape_failed,pzbuk:scrape_failed,totalbet:scrape_failed"));
it("abort line", () =>
  expect(formatAbortAlert("premier-league", "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)"))
    .toBe("[ALERT] scrape run ABORTED for premier-league: database unreachable - TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)"));
it("streak alert fires once at the threshold", () => {
  const s = (n: number) => new Map([["betters", summary({ bookmaker: "betters", consecutiveFailures: n, failingSince: "2026-11-06T15:44:03.000Z",
    lastError: "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485" })]]);
  expect(buildRunAlerts({ league: "premier-league", outcomes: run2, summaries: s(3), threshold: 3 })).toContain(
    "[ALERT] betters (premier-league) failed 3 consecutive runs since 2026-11-06T15:44:03.000Z: No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485");
  expect(buildRunAlerts({ league: "premier-league", outcomes: run2, summaries: s(4), threshold: 3 }).filter((l) => l.includes("betters"))).toEqual([]);
});
it("persist failures alert immediately", () => { /* outcomes: 7 x persist_failed with the ECONNREFUSED message */
  expect(lines[0]).toMatch(/^\[ALERT\] premier-league: 7 bookmaker\(s\) scraped but NOT saved \(fortuna,superbet,lvbet,fuksiarz,betfan,forbet,etoto\) - Batch insert failed/);
});
it("all-empty run collapses to one league alert (Review Focus 4)", () => { /* 14 x empty, summaries all at threshold */
  expect(lines).toEqual(["[ALERT] premier-league: 14/14 bookmakers returned 0 matches - per-bookmaker alerts suppressed for this run"]);
});
it("resolved line", () => { /* betcris summary consecutiveFailures 0, recoveredAfterFailures 3 */
  expect(lines).toContain("[ALERT-RESOLVED] betcris (premier-league) ok again after 3 failed runs"); });
it("webhook only when configured; failures never throw", async () => {
  const f = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")); vi.stubGlobal("fetch", f);
  await emitAlerts(["[ALERT] x"], null); expect(f).not.toHaveBeenCalled();
  await expect(emitAlerts(["[ALERT] x"], "http://127.0.0.1:9/hook")).resolves.toBeUndefined();
  expect(f).toHaveBeenCalledWith("http://127.0.0.1:9/hook", expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "[ALERT] x" }) }));
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/services/__tests__/run-alerts.test.ts`
- [ ] **Step 3: Implement** the four functions and the config fields.
- [ ] **Step 4: Run them and confirm they pass.** Run the same file, then `npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add src/services/run-alerts.ts src/config/index.ts .env.example src/services/__tests__/run-alerts.test.ts
git commit -m "feat(observability): one summary line per run and local-first alert hook"
```

---

### Task 7: DB preflight and run integrity in `runScrapeAndPersist`

**Files:**
- Modify:
  - `src/config/database.ts:23-38` (add the probes; `testConnection` stays as is)
  - `src/services/market-types-sync.ts` (add `ensureMarketTypesSynced`)
  - `src/services/scraper-service.ts:6-99`
  - `src/services/scraper-health.ts:30` (state) and `:35-175` (`recordRun` at `:35-76` is replaced by `recordOutcome`; `getHealth`/`getAllHealth`/`getFailingScrapers` read outcome-based stats)
  - `src/services/scheduler-service.ts`:
    - `:30-84`: `runAllLeaguesScrape(options?: { dbWaitMs?: number })`, exported for tests. It forwards `options` at `:44`: `runScrapeAndPersist(league, undefined, false, options)`.
    - `:151-165`: the startup call at `:155` becomes `runAllLeaguesScrape({ dbWaitMs: 120_000 })`. The cron call (`:113`) and `triggerManualScrape` (`:273`) pass nothing.
    - `:197-207`: the 1 s `setTimeout` calls the new `runInitialTsdbSync()`.
  - `src/index.ts:84-99` (use `ensureMarketTypesSynced`)
  - `src/types/api.ts:27-35` (`ScrapeStats` additive)
  - `src/routes/health.ts:34-42` (fill the new `ScrapeStats` fields)
- Test: `src/services/__tests__/scraper-service.test.ts`, `src/services/__tests__/scraper-health.test.ts`, `src/services/__tests__/market-types-sync.test.ts`, `src/services/__tests__/scheduler-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5, 6 (`runAllFullOfferScrapers(...).outcomes`, `insertBookmakerRunOutcomes`, `toScraperRunInsert`, `getRecentRunRows`, `summarizeBookmakerRuns`, `mergeRunRows`, `STATUS_WINDOW_RUNS`, `formatRunSummaryLine`, `buildRunAlerts`, `formatAbortAlert`, `emitAlerts`, `formatDbError`, test helper `outcome()`).
- Produces:
  ```ts
  export type DbProbe = { ok: true } | { ok: false; error: string };
  export async function probeDatabase(): Promise<DbProbe>;                     // market_types select id limit 1; error via formatDbError
  export async function waitForDatabase(timeoutMs: number, intervalMs = 5000): Promise<DbProbe>; // polls probeDatabase
  export async function ensureMarketTypesSynced(): Promise<boolean>;           // memoizes success; retries on later calls after a failure
  export interface ScrapeResult { /* existing fields */ aborted: "db_unreachable" | null; marketsSaved: number; outcomes: BookmakerRunOutcome[] }
  export async function runScrapeAndPersist(league?: string, bookmakers?: PolishBookmaker[], closeBrowsers?: boolean,
    options?: { dbWaitMs?: number }): Promise<ScrapeResult>;
  // scraper-health.ts (replaces recordRun)
  recordOutcome(o: BookmakerRunOutcome): void; recordAbort(league: string, reason: string, at: Date): void;
  getLastAbort(): { league: string; reason: string; at: string } | null;
  getRecentOutcomes(league: string): BookmakerRunOutcome[]; // newest first, 50 per bookmaker
  // HealthReport gains: lastStatus: string | null; consecutiveFailures: number; lastSuccessAt: string | null
  // ScrapeStats gains: marketsSaved: number; aborted: "db_unreachable" | null; failed: Array<{ bookmaker: string; status: string; error: string | null }>
  // scheduler-service.ts
  export async function runAllLeaguesScrape(options?: { dbWaitMs?: number }): Promise<MultiLeagueScrapeResult>; // now exported
  export async function runInitialTsdbSync(dbWaitMs = 120_000): Promise<void>; // never throws
  ```
- `runScrapeAndPersist` order (the tests pin it):
  1. `probe = dbWaitMs ? waitForDatabase(dbWaitMs) : probeDatabase()`.
  2. On failure:
     - `emitAlerts([formatAbortAlert(league, probe.error)], CONFIG.ALERT_WEBHOOK_URL)`, then `scraperHealth.recordAbort`.
     - Return `{ aborted: "db_unreachable", successCount: 0, errorCount: (bookmakers ?? CONFIG.BOOKMAKERS).length, outcomes: [], errors: [line] }`, **without** calling the aggregator.
     - The scheduler's `N success, M errors` lines (`scheduler-service.ts:116`) then say `0 success, 14 errors`, not `0 errors`.
  3. `if (!(await ensureMarketTypesSynced())) console.warn("[ScraperService] market_types sync failed - continuing")`, then proceed. The probe has just passed, so a failure here is a schema/FK problem; the per-batch errors will name it.
  4. `runAllFullOfferScrapers`.
  5. `recordOutcome` for each outcome.
  6. `insertBookmakerRunOutcomes`. On failure: `console.error("[ScraperService] scraper_runs not persisted: " + msg)` and `errors.push(msg)`.
  7. Summaries are built from in-memory history merged with DB history:
     - `rows = mergeRunRows(scraperHealth.getRecentOutcomes(league).map(toScraperRunInsert), dbRows)`.
     - `dbRows = await getRecentRunRows(league, STATUS_WINDOW_RUNS * CONFIG.BOOKMAKERS.length)`, or `[]` (with a `console.warn`) if that read throws.
     - The in-memory side always contains the current run, because step 5 has already recorded it. If step 6 failed while reads work (migration 11 missing, PGRST204), the streaks still count the current run and every earlier run of this process. If step 6 succeeded, duplicate rows of the same `run_id` are dropped.
  8. `console.log(formatRunSummaryLine(...))`, then `emitAlerts(buildRunAlerts({ threshold: CONFIG.ALERT_CONSECUTIVE_FAILURES, ... }), CONFIG.ALERT_WEBHOOK_URL)`.
  9. Close browsers.
- The scheduler's startup call passes `{ dbWaitMs: 120_000 }` through `runAllLeaguesScrape`. Cron runs, `triggerManualScrape` and admin runs pass nothing.
- `runInitialTsdbSync`: `const probe = await waitForDatabase(dbWaitMs)`.
  - If the probe is not ok: `console.error("[Scheduler] Initial TSDB sync skipped: database unreachable - " + probe.error)` and return. The 04:00 cron stays the next attempt.
  - Otherwise run `syncStaleLeagues()` inside the existing try/catch, keeping its log lines (`scheduler-service.ts:198-206`).

- [ ] **Step 1: Write the failing tests**

The tests mock `../../scrapers/aggregator.js`, `../../config/database.js` and `../market-types-sync.js`. `../../repositories/scraper-run-repository.js` is partially mocked: `vi.mock(path, async (orig) => ({ ...(await orig()), insertBookmakerRunOutcomes: vi.fn(), getRecentRunRows: vi.fn() }))`, so `toScraperRunInsert` stays real. `run-alerts` and `bookmaker-status` are real, and `console` is spied.

Local helper in `scraper-service.test.ts`: `aggregated(outcomes)` builds a `FullOfferAggregatedResult` with these fields:
- `runId = outcomes[0]?.runId ?? RUN_ID`, `league: "premier-league"`, `results: new Map()`, `allMatches: []`, `outcomes`
- `summary`: `successCount` = OK outcomes, `errorCount` = the rest, `totalMatchesFound` = Σ `matchesFound`, `totalMarketsFound: 0`, `totalMarketsSaved` = Σ OK `marketsSaved`

Defaults set in `beforeEach`:
- `probeDatabase` → `{ ok: true }`
- `waitForDatabase` → `{ ok: true }`
- `ensureMarketTypesSynced` → `true`
- `runAllFullOfferScrapers` → `aggregated([outcome({ bookmaker: "forbet", status: "persist_failed", marketsSaved: 0, error: "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)" })])`
- `insertBookmakerRunOutcomes` → resolves
- `getRecentRunRows` → `[]`

`scraperHealth` is a module singleton. Every Task 7 test file has `beforeEach(() => { scraperHealth.reset(); vi.clearAllMocks(); })`. Without the reset, the forbet `persist_failed` from "persists one row per outcome…" would make the later `consecutiveFailures: 1` assertion fail. `reset()` also clears the outcome history and the last abort.

```ts
it("aborts before launching any scraper when the database is unreachable", async () => {
  probeDatabase.mockResolvedValue({ ok: false, error: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)" });
  const r = await runScrapeAndPersist("premier-league", ["forbet"]);
  expect(runAllFullOfferScrapers).not.toHaveBeenCalled();
  expect(insertBookmakerRunOutcomes).not.toHaveBeenCalled();
  expect(r).toMatchObject({ aborted: "db_unreachable", successCount: 0, errorCount: 1, outcomes: [] });
  expect(errorSpy).toHaveBeenCalledWith("[ALERT] scrape run ABORTED for premier-league: database unreachable - TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)");
});
it("waits for the database when dbWaitMs is given", async () => {
  await runScrapeAndPersist("premier-league", undefined, false, { dbWaitMs: 120_000 });
  expect(waitForDatabase).toHaveBeenCalledWith(120_000);
});
it("syncs market_types before scraping", async () => {
  expect(ensureMarketTypesSynced.mock.invocationCallOrder[0]).toBeLessThan(runAllFullOfferScrapers.mock.invocationCallOrder[0]);
});
it("persists one row per outcome and reports honest counts", async () => { /* outcomes: forbet persist_failed, betclic success 3150 */
  expect(insertBookmakerRunOutcomes).toHaveBeenCalledWith([expect.objectContaining({ bookmaker: "forbet", status: "persist_failed" }), expect.objectContaining({ bookmaker: "betclic", status: "success" })]);
  expect(r).toMatchObject({ successCount: 1, errorCount: 1, marketsSaved: 3150, aborted: null });
  expect(logSpy.mock.calls.filter(([l]) => String(l).startsWith("[ScrapeRun]"))).toHaveLength(1);
});
it("still resolves when scraper_runs cannot be written (Review Focus 1)", async () => {
  insertBookmakerRunOutcomes.mockRejectedValue(new Error("scraper_runs insert failed: TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)"));
  getRecentRunRows.mockRejectedValue(new Error("down"));
  const r = await runScrapeAndPersist("premier-league", ["forbet"]);
  expect(r.errors).toContain("scraper_runs insert failed: TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)");
  expect(errorSpy.mock.calls.flat().join("\n")).toContain("[ScraperService] scraper_runs not persisted:");
  expect(scraperHealth.getHealth("forbet")).toMatchObject({ consecutiveFailures: 1, lastStatus: "persist_failed" });
  expect(logSpy.mock.calls.filter(([l]) => String(l).startsWith("[ScrapeRun]"))).toHaveLength(1);
});
it("alerts from in-memory history when the insert fails but reads work (Review Focus 2)", async () => {
  const BETTERS_ERR = "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
  scraperHealth.recordOutcome(outcome({ runId: "run-1400", bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR, startedAt: new Date("2026-11-06T14:00:00.000Z") }));
  scraperHealth.recordOutcome(outcome({ runId: "run-1500", bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR, startedAt: new Date("2026-11-06T15:00:00.000Z") }));
  runAllFullOfferScrapers.mockResolvedValue(aggregated([outcome({ bookmaker: "betters", status: "scrape_failed", matchesFound: 0, error: BETTERS_ERR })])); // current run, 16:00:00.350Z
  insertBookmakerRunOutcomes.mockRejectedValue(new Error("scraper_runs insert failed: Could not find the 'run_id' column of 'scraper_runs' in the schema cache [PGRST204] (apply supabase/migrations/11_scraper_runs_observability.sql)"));
  getRecentRunRows.mockResolvedValue([]); // select * still works, but holds no current-run rows
  await runScrapeAndPersist("premier-league", ["betters"]);
  expect(errorSpy.mock.calls.flat().join("\n")).toContain(`[ALERT] betters (premier-league) failed 3 consecutive runs since 2026-11-06T14:00:00.000Z: ${BETTERS_ERR}`);
});

// scraper-health.test.ts
it("persist_failed is a failure (today it would read healthy 100%)", () => {
  scraperHealth.recordOutcome(outcome({ bookmaker: "forbet", status: "persist_failed", error: "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)" }));
  expect(scraperHealth.getHealth("forbet")).toMatchObject({ status: "failing", successRate: 0, consecutiveFailures: 1 });
  expect(scraperHealth.getHealth("forbet").lastError).toContain("ECONNREFUSED");
});
it("consecutiveFailures resets on success", () => { /* fail, fail, success */ expect(h.consecutiveFailures).toBe(0); });

// market-types-sync.test.ts (getSupabase -> fake; upsert first { error: shapes.econnrefused } then { error: null })
it("retries after a failed sync and memoizes success", async () => {
  expect(await ensureMarketTypesSynced()).toBe(false);
  expect(await ensureMarketTypesSynced()).toBe(true);
  expect(await ensureMarketTypesSynced()).toBe(true);
  expect(fake.queries.filter((q) => q.table === "market_types")).toHaveLength(2);
});

// scheduler-service.test.ts: mocks ../scraper-service.js, ../../scrapers/aggregator.js (closeAllBrowsers),
// ../tsdb-sync-service.js, ../../config/database.js (waitForDatabase), ../../repositories/odds-repository.js
it("forwards dbWaitMs from runAllLeaguesScrape to runScrapeAndPersist", async () => {
  await runAllLeaguesScrape({ dbWaitMs: 120_000 });
  expect(runScrapeAndPersist).toHaveBeenCalledWith("premier-league", undefined, false, { dbWaitMs: 120_000 });
});
it("initial TSDB sync waits for the database instead of failing once", async () => {
  waitForDatabase.mockResolvedValueOnce({ ok: true });
  await runInitialTsdbSync(120_000);
  expect(waitForDatabase).toHaveBeenCalledWith(120_000);
  expect(syncStaleLeagues).toHaveBeenCalledTimes(1);
});
it("initial TSDB sync is skipped loudly when the database never comes up", async () => {
  waitForDatabase.mockResolvedValueOnce({ ok: false, error: "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)" });
  await runInitialTsdbSync(120_000);
  expect(syncStaleLeagues).not.toHaveBeenCalled();
  expect(errorSpy).toHaveBeenCalledWith("[Scheduler] Initial TSDB sync skipped: database unreachable - TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)");
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/services/__tests__/scraper-service.test.ts src/services/__tests__/scraper-health.test.ts src/services/__tests__/market-types-sync.test.ts src/services/__tests__/scheduler-service.test.ts`
- [ ] **Step 3: Implement** as specified. In `index.ts:91-98`, replace the direct `syncMarketTypes()` call with `ensureMarketTypesSynced()`; the startup log stays the same on success. Remove the now-unused imports from `scraper-service.ts:2` (`runAllScrapers`, `AggregatedResult`).
- [ ] **Step 4: Run them and confirm they pass.** Run the same files, then `npx vitest run`, then `npx tsc --noEmit`.
- [ ] **Step 5: DB-down drill on the real code** (no DB writes; one forbet scrape is **not** started):

Run: `SUPABASE_URL=http://127.0.0.1:59999 SUPABASE_SERVICE_KEY=dummy npx tsx -e '(async () => { const { runScrapeAndPersist } = await import("./src/services/scraper-service.ts"); const r = await runScrapeAndPersist("premier-league", ["forbet"]); console.log("ABORTED=" + r.aborted); process.exit(0); })()'`
(Use the IIFE form: `tsx -e` compiles to CJS, so a top-level `await` fails with "Top-level await is currently not supported with the "cjs" output format". This was verified 2026-11-06.)
Expected: one line `[ALERT] scrape run ABORTED for premier-league: database unreachable - TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)`, then `ABORTED=db_unreachable`, and no `[Aggregator/FullOffer]` line. Compare with `evidence/observability/repro-db-down-forbet.txt`.

- [ ] **Step 6: Commit**

```bash
git add src/config/database.ts src/services/market-types-sync.ts src/services/scraper-service.ts src/services/scraper-health.ts src/services/scheduler-service.ts src/index.ts src/types/api.ts src/routes/health.ts src/services/__tests__/scraper-service.test.ts src/services/__tests__/scraper-health.test.ts src/services/__tests__/market-types-sync.test.ts src/services/__tests__/scheduler-service.test.ts
git commit -m "fix(scraper): refuse runs without a database, persist outcomes, alert on failures"
```

---

### Task 8: API surfaces (`/api/odds`, batch, `/api/bookmakers`, `/api/health/scrapers`)

**Files:**
- Create: `src/services/scraper-status-report.ts`
- Modify:
  - `src/services/odds-service.ts:13-27,102-111,175-204` (snapshot, per-league `lastUpdated`, `bookmakerHealth`)
  - `src/routes/odds.ts:57-70` (`meta.bookmakerHealth`)
  - `src/routes/odds.ts:195-258` (batch merge, rules below)
  - `src/routes/odds.ts:354-361` (delete `getStatusPriority`)
  - `src/routes/bookmakers.ts:59-117`
  - `src/routes/health.ts` (new `GET /scrapers`)
  - `src/types/api.ts:54-61,73-82`
  - `src/__tests__/helpers/run-fixtures.ts` (add `snapshotFromRun2()`)
- Test: `src/routes/__tests__/health-scrapers.test.ts`, `src/routes/__tests__/odds-batch.test.ts`, `src/services/__tests__/scraper-status-report.test.ts`

**Interfaces:**
- Consumes: `getBookmakerStatusSnapshot`, `worstBookmakerStatus`, `summarizeBookmakerRuns`, `deriveBookmakerStatus` (Task 5). `toScraperRunInsert` (Task 4). `scraperHealth.getLastAbort` (Task 7). `getSchedulerStatus().lastResults` (existing). Test helpers `outcome`, `RUN2_OK` (Task 1).
- Produces:
  ```ts
  // odds-service.ts: getAllLatestOdds additionally returns bookmakerHealth: Record<PolishBookmaker, BookmakerHealthMeta>
  // run-fixtures.ts (appended)
  export function snapshotFromRun2(now?: Date): BookmakerStatusSnapshot;
  //   run-2 outcomes: 9 x success with RUN2_OK counts; betters/lebull/betcris/pzbuk/totalbet scrape_failed with the evidence strings
  //   ("No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
  //    "No events found from API | document HTTP 404 https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485", "No WebSocket data captured",
  //    "No WebSocket data captured | websockets opened: wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl",
  //    "No events found from API | fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events"),
  //   -> summarizeBookmakerRuns(outcomes.map(toScraperRunInsert)) -> deriveBookmakerStatus(s, null, now ?? 2026-11-06T16:16:18.614Z, staleAfterMs(60));
  //   lastOddsAt empty, lastSuccessfulRunAt "2026-11-06T16:02:49.798Z", source "scraper_runs"
  // types/api.ts
  export interface OddsResponseMeta { /* existing */ bookmakerHealth: Record<PolishBookmaker, BookmakerHealthMeta> }
  export interface ScraperHealthEntry { bookmaker: PolishBookmaker; status: BookmakerStatus; lastStatus: string | null; lastRunAt: string | null;
    lastSuccessAt: string | null; lastOddsAt: string | null; consecutiveFailures: number; failingSince: string | null; lastError: string | null;
    lastMatchesFound: number; lastMarketsSaved: number }
  export interface ScraperHealthReport { league: string; generatedAt: string; source: "scraper_runs" | "odds_only";
    lastRun: ScrapeStats | null; lastAbort: { league: string; reason: string; at: string } | null;
    counts: Record<BookmakerStatus, number>; bookmakers: ScraperHealthEntry[] } // CONFIG.BOOKMAKERS order
  // scraper-status-report.ts
  export function buildScraperHealthReport(league: string, snap: BookmakerStatusSnapshot, lastRun: ScrapeStats | null,
    lastAbort: ScraperHealthReport["lastAbort"], now: Date): ScraperHealthReport;
  ```
- `GET /api/health/scrapers?league=<slug>`: the default is `CONFIG.ENABLED_LEAGUES[0]`. A slug that does not match `/^[a-z0-9-]+$/` gets 400 `INVALID_PARAMS`. The response is `{ success: true, data: ScraperHealthReport }`, with **no auth middleware**.
- `/api/bookmakers`:
  - `league` comes from the query, with the same default.
  - `status` comes from the snapshot.
  - `lastSuccessfulScrape = summary.lastSuccessAt ?? lastOddsAt`.
  - `matchesFound = summary.lastMatchesFound`.
  - `lastError = summary.lastError ?? undefined`.
  - `errorCount = 14 - availableCount`, as before.
- `getAllLatestOdds` returns `lastUpdated = snapshot.lastSuccessfulRunAt` (Task 5: `getLastSuccessfulScrapeTime(league)`, so the time is per league). It also returns `bookmakerStatus = snapshot.status` and `bookmakerHealth = snapshot.health`. The global `getLastSuccessfulScrapeTime()` call at `odds-service.ts:26` goes away.
- `POST /api/odds/batch` merge rules (the frontend's only live reader, `use-polling-odds.ts:86,91-92`):
  - `mergeLeagues = leagues.filter((l) => CONFIG.ENABLED_LEAGUES.includes(l))`. If that is empty, merge over all requested leagues.
  - `bookmakerStatus[bm] = worstBookmakerStatus(merged[bm], result.bookmakerStatus[bm])` over the results of `mergeLeagues`. The values stay plain strings (`"available" | "stale" | "error"`), the shape at `aityper/src/lib/api/odds-api.ts:112`. The current code reads `.status` off those strings, so `getStatusPriority(undefined)` makes the first league win.
  - `bookmakerHealth[bm]` takes the entry of the league whose status won.
  - A league whose fetch threw (`routes/odds.ts:213-215`) contributes nothing to either map.
  - `lastUpdated` = newest non-null per-league `lastUpdated` over **all** requested leagues, unchanged (`routes/odds.ts:234-239`). The values are `toISOString()` output, so a string sort is a time sort.
  - Matches are merged over all requested leagues, unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// scraper-status-report.test.ts
it("orders 14 entries by CONFIG.BOOKMAKERS and counts statuses", () => {
  const r = buildScraperHealthReport("premier-league", snapshotFromRun2(), null, null, new Date("2026-11-06T16:16:18.614Z"));
  expect(r.bookmakers.map((b) => b.bookmaker)).toEqual([...CONFIG.BOOKMAKERS]);
  expect(r.counts).toEqual({ available: 9, stale: 0, error: 5 });
  expect(r.bookmakers.find((b) => b.bookmaker === "totalbet")).toMatchObject({ status: "error",
    lastError: "No events found from API | fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events" });
});

// health-scrapers.test.ts: express app on port 0, mocks for bookmaker-status, scheduler-service, config/database
it("is reachable without an Authorization header", async () => {
  const res = await fetch(`${base}/api/health/scrapers?league=premier-league`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data.bookmakers).toHaveLength(14);
  expect(body.data.league).toBe("premier-league");
});
it("rejects a malformed league slug", async () =>
  expect((await fetch(`${base}/api/health/scrapers?league=../etc`)).status).toBe(400));

// odds-batch.test.ts: express().use(express.json()).use("/api/odds", oddsRouter).use(errorHandler) on port 0.
// vi.mock("../../config/index.js") keeps the real module but sets CONFIG.ENABLED_LEAGUES = ["premier-league", "la-liga"].
// vi.mock("../../services/odds-service.js") keeps the real module but stubs getAllLatestOdds per league;
// st(overrides) = 14-key Record defaulting to "available"; hl(st) = matching 14-key bookmakerHealth.
//   premier-league: st({ betcris: "stale" }),                       lastUpdated "2026-11-06T16:02:49.798Z"
//   la-liga:        st({ betcris: "error" }),                       lastUpdated "2026-11-06T15:02:49.000Z"
//   ekstraklasa:    st({ fortuna: "error" }) (not enabled),         lastUpdated null
const post = (leagues: string[]) => fetch(`${base}/api/odds/batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leagues }) }).then((r) => r.json());
it("worst status wins across enabled leagues, as plain strings (today the first league wins)", async () => {
  const { meta } = await post(["premier-league", "la-liga", "ekstraklasa"]);
  expect(meta.bookmakerStatus.betcris).toBe("error");
  expect(meta.bookmakerStatus.fortuna).toBe("available"); // ekstraklasa is not enabled -> not merged
  expect(Object.values(meta.bookmakerStatus).every((v) => typeof v === "string")).toBe(true);
  expect(Object.keys(meta.bookmakerHealth)).toHaveLength(14);
  expect(meta.bookmakerHealth.betcris.status).toBe("error");
  expect(meta.lastUpdated).toBe("2026-11-06T16:02:49.798Z");
});
it("falls back to all requested leagues when none is enabled", async () =>
  expect((await post(["ekstraklasa"])).meta.bookmakerStatus.fortuna).toBe("error"));
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/routes/__tests__/health-scrapers.test.ts src/routes/__tests__/odds-batch.test.ts src/services/__tests__/scraper-status-report.test.ts`. The batch test fails today on `betcris` (`"stale"`, because the first league wins) and on the missing `bookmakerHealth`.
- [ ] **Step 3: Implement** the builder, the route, and the odds, batch and bookmakers changes.
- [ ] **Step 4: Run them and confirm they pass.** Run the same files, then `npx vitest run`, then `npx tsc --noEmit`.
- [ ] **Step 5: Frontend compatibility check** (read-only):

Run: `grep -rn '"available"' /home/skamik/Documents/repositories/personal/aityper/src/lib/actions/odds.ts /home/skamik/Documents/repositories/personal/aityper/src/hooks/use-polling-odds.ts`
Expected: only `=== "available"` / `!== "available"` comparisons. No `switch` over status values exists, so `"error"` is handled as unavailable.

- [ ] **Step 6: Commit**

```bash
git add src/services/scraper-status-report.ts src/services/odds-service.ts src/routes/odds.ts src/routes/bookmakers.ts src/routes/health.ts src/types/api.ts src/__tests__/helpers/run-fixtures.ts src/routes/__tests__/health-scrapers.test.ts src/routes/__tests__/odds-batch.test.ts src/services/__tests__/scraper-status-report.test.ts
git commit -m "feat(api): truthful bookmakerStatus, bookmakerHealth meta and public /api/health/scrapers"
```

---

### Task 9: CLIs (`scraper-status`, `smoke-bookmaker`)

**Files:**
- Create: `scripts/scraper-status.ts`, `scripts/smoke-bookmaker.ts`
- Modify: `src/services/scraper-status-report.ts` (add `formatStatusTable`)
- Test: `src/services/__tests__/scraper-status-report.test.ts` (extend)

**Interfaces:**
- Consumes: `buildScraperHealthReport`, `getBookmakerStatusSnapshot`, `probeDatabase`, `runScrapeAndPersist`, `getScraper`, `closeAllBrowsers`, `normalizeMarketsForBookmaker`.
- Produces:
  - `formatStatusTable(r: ScraperHealthReport): string`. Columns are `BOOKMAKER  STATUS  LAST RUN  LAST SUCCESS  FAILS  ERROR`. Timestamps are second-precision ISO with a `Z`, `-` stands for null, and the error is cut to 120 chars ending in `…`.
  - `scripts/scraper-status.ts [--league premier-league] [--json] [--threshold N]`: prints the table, or JSON with `--json`. Exit codes: **2** if `probeDatabase()` fails, **1** if any `consecutiveFailures >= threshold` (default `CONFIG.ALERT_CONSECUTIVE_FAILURES`), otherwise **0**.
  - `scripts/smoke-bookmaker.ts --bookmaker <bm> [--league premier-league] [--persist]`:
    - Dry mode (default, no DB) runs `scrapeFullOffer` and `normalizeMarketsForBookmaker`, then prints `SMOKE_RESULT {json}` with the fields `bookmaker, league, status ("scraped"|"empty"|"scrape_failed"), matches, marketsFound, marketsNormalized, minMarketsPerMatch, otherMarketShare, unknownSelectionShare, error, durationMs`. The two shares are rounded to 4 decimals.
    - `--persist` runs `runScrapeAndPersist(league, [bm])` and prints `SMOKE_RESULT` built from its outcome.
    - Exit codes: **0** for OK, **1** when the bookmaker failed, **2** for usage errors or an unknown bookmaker, **3** for `aborted === "db_unreachable"`.
    - It always calls `closeAllBrowsers()` in `finally`.
    - The shape was proven on current code by `evidence/observability/smoke-normalize.mts`.
- Why a new script instead of extending the two existing ones:
  - `scripts/audit-probe.ts` is the audit loop's reachability probe, documented in `aityper/docs/superpowers/specs/2026-06-26-autonomous-normalization-results.md:71`. Its contract is to exit 0 for every probe outcome, unknown bookmaker and thrown scrape included, and print `reachable`/`richestEventUrl` JSON (`audit-probe.ts:26-29`, `:40-63`). Only a missing `--bookmaker` exits 1 (`:22-25`). Its default league is `world-cup-2026`. Adding non-zero exit codes and normalization there would break that contract. Instead, `smoke-bookmaker.ts` reuses the same `scrapeFullOffer` call.
  - `scripts/test-scrapers.sh` is an interactive menu. It drives the legacy 1X2 `scrapeLeague` path (`:198-215`) and the admin API with a different default key (`dev-admin-key-12345`, `:19`), not the full-offer path.

- [ ] **Step 1: Write the failing test**

```ts
it("formats header plus 14 rows with truncated errors", () => {
  const lines = formatStatusTable(buildScraperHealthReport("premier-league", snapshotFromRun2(), null, null, NOW)).split("\n");
  expect(lines[0]).toMatch(/^BOOKMAKER\s+STATUS\s+LAST RUN\s+LAST SUCCESS\s+FAILS\s+ERROR$/);
  expect(lines).toHaveLength(15);
  expect(lines.find((l) => l.startsWith("betters"))).toMatch(/^betters\s+error\s+2026-11-06T16:00:00Z\s+-\s+1\s+No events found from API \| document HTTP 404/);
});
```

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run src/services/__tests__/scraper-status-report.test.ts`
- [ ] **Step 3: Implement** `formatStatusTable` and both scripts. Scripts import from `../src/...js`, as the other `scripts/*-market-discovery.ts` do, and run from the repo root so `.env` is loaded.
- [ ] **Step 4: Run it and confirm it passes.** Then type-check the scripts, which `npx tsc --noEmit` does not cover (see Global Constraints):

Run: `npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule scripts/scraper-status.ts scripts/smoke-bookmaker.ts`
Expected: no output, exit 0.

Then run the offline and live checks (one bookmaker at a time):

| Command | Expected |
|---|---|
| `npx tsx scripts/smoke-bookmaker.ts` (no args) | exit 2; usage line `Usage: smoke-bookmaker.ts --bookmaker <bm> [--league <slug>] [--persist]` on stderr; no browser launched |
| `npx tsx scripts/smoke-bookmaker.ts --bookmaker nosuchbm` | exit 2; `Unknown bookmaker: nosuchbm` |
| `npx tsx scripts/smoke-bookmaker.ts --bookmaker forbet` | exit 0; `"status":"scraped"`, `matches` ≥ 18 (today 20), `minMarketsPerMatch` ≥ 100, `unknownSelectionShare` ≤ 0.06 (today 0.0376) |
| `npx tsx scripts/smoke-bookmaker.ts --bookmaker betters` | exit 1; error contains `document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485` |
| `SUPABASE_URL=http://127.0.0.1:59999 SUPABASE_SERVICE_KEY=dummy npx tsx scripts/smoke-bookmaker.ts --bookmaker forbet --persist` | exit 3; the ABORTED alert line |
| `npx tsx scripts/scraper-status.ts --league premier-league` | 15 lines |
| `npx tsx scripts/scraper-status.ts --league premier-league --json \| python3 -I -m json.tool > /dev/null; echo "${PIPESTATUS[1]}"` | `0` (valid JSON). The JSON is a `ScraperHealthReport` with 14 `bookmakers`. |
| `SUPABASE_URL=http://127.0.0.1:59999 npx tsx scripts/scraper-status.ts` | exit 2 |

- [ ] **Step 5: Commit**

```bash
git add scripts/scraper-status.ts scripts/smoke-bookmaker.ts src/services/scraper-status-report.ts src/services/__tests__/scraper-status-report.test.ts
git commit -m "feat(scripts): scraper-status report and single-bookmaker smoke test"
```

---

### Task 10: Operator start procedure (`npm run dev:stack`)

**Files:**
- Create: `scripts/dev-stack.sh`
- Modify:
  - `package.json` scripts: add `"dev:stack": "bash scripts/dev-stack.sh"`. `"db:migrate"` at `:16` keeps its value, because the script itself now refuses the no-argument form.
  - `scripts/apply-migrations.sh`: right after `set -e` (`:6`), before any docker call, add a guard.
    - No argument: print `usage: apply-migrations.sh <migration_file> | --all` and exit 2.
    - `--all`: the existing apply-everything branch (`:72-99`), which is now opt-in.
    - Any other argument: the existing single-file branch (`:63-71`).
    - Update the header comment at `:4`.
  - `CLAUDE.md`:
    - Replace the `:50` line with `npm run db:migrate -- <file>   # Apply ONE migration (./scripts/apply-migrations.sh <file>; --all re-runs 01..N, never against a live DB)`.
    - Add a `npm run dev:stack` line under Development Commands.
    - Add a short "Local Supabase" subsection: the start procedure, the `--check` mode, the single-file migration command, and `scripts/scraper-status.ts` / `scripts/smoke-bookmaker.ts`.

**Interfaces:**
- Usage: `bash scripts/dev-stack.sh [--check] [--no-scrapers]`
- Steps:
  1. Load `.env` **without** overriding variables already in the environment (same rule as dotenv).
  2. Probe with `code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "$SUPABASE_URL/rest/v1/market_types?select=id&limit=1" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" || true)`. `200` means reachable.
     - The `|| true` is required. Under `set -e`, a bare `code=$(curl …)` against a closed port exits the script with curl's code 7 before anything is printed. With `|| true`, `code` is `000`. Both behaviours were verified 2026-11-06.
  3. With `--check`, print `Supabase reachable at $SUPABASE_URL (market_types HTTP 200)` and exit 0, or `Supabase NOT reachable at $SUPABASE_URL (HTTP <code>)` and exit 1. Nothing else happens in this mode.
  4. If the API is already up (`curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT:-3001}/api/health || true` returns `200`), print `API already running on :${PORT:-3001}` and exit 1.
  5. If the DB is unreachable and `SUPABASE_URL` is local (127.0.0.1/localhost):
     - Require `docker info` to succeed (exit 1 with a message if not).
     - `L=label=com.supabase.cli.project=backend`.
     - If `docker ps -a --filter $L -q` is **non-empty**, the stack exists:
       - Run `docker ps -a --filter $L --filter status=exited --format '{{.Names}}' | grep -v edge_runtime | xargs -r docker start`.
       - Do **not** run `supabase start`. Go straight to step 6. This also covers containers that are running but still starting (the PGRST002 window).
       - `-q` ignores `--format`, so the name filter needs the `--format` form. Today the only exited container is `supabase_edge_runtime_backend`.
     - Only if that list is **empty**, run `npx --yes supabase@2.70.5 start`. 2.70.5 is the version in this machine's npx cache; bare `npx supabase` now resolves to 3.0.0. If that fails, print this hint and delete nothing: `npx cache may be corrupt: find ~/.npm/_npx -maxdepth 3 -path '*node_modules/supabase' -prune and remove that _npx/<hash> dir, then retry`.
  6. Poll the probe every 3 s for up to 90 s. PGRST002 / 503 / `000` count as not ready yet. On timeout, exit 1.
  7. With `--no-scrapers`, `export SCRAPERS_ON=false`. Finish with `exec npm run dev`.

- [ ] **Step 1: Write the script and check the syntax.** Run `bash -n scripts/dev-stack.sh`. Expected: no output, exit 0.
- [ ] **Step 2: Live checks (no side effects)**

| Command | Expected |
|---|---|
| `bash scripts/dev-stack.sh --check` | `Supabase reachable at http://127.0.0.1:54321 (market_types HTTP 200)`, exit 0 |
| `SUPABASE_URL=http://127.0.0.1:59999 bash scripts/dev-stack.sh --check` | `Supabase NOT reachable at http://127.0.0.1:59999 (HTTP 000)`, exit 1 |
| `bash scripts/dev-stack.sh` while the operator's dev server runs | `API already running on :3001`, exit 1 |
| `bash scripts/apply-migrations.sh; echo "exit=$?"` | `usage: apply-migrations.sh <migration_file> \| --all`, then `exit=2`. No `Applying:` line, so nothing is applied. The guard runs before any docker call. |
| `npm run db:migrate; echo "exit=$?"` | same usage line; npm reports the non-zero exit |

- [ ] **Step 3: Verify the npm wiring.** `npm run dev:stack -- --check` gives the same result as the first row.
- [ ] **Step 4: Commit**

```bash
git add scripts/dev-stack.sh scripts/apply-migrations.sh package.json CLAUDE.md
git commit -m "chore(dev): dev:stack script that checks Supabase before starting scrapers"
```

---

### Task 11: Live verification against the acceptance criteria (no code)

Done with the operator, after the dev server has picked up Tasks 1–10 and migration 11 is applied.

- [ ] Run A1, A2 and A7–A9 as written in the Acceptance criteria and record each output. A2 smoke-tests only forbet. A10 below is the per-bookmaker regression check for the other 8 savers, which share the Task 2 base path.
- [ ] Wait for the next scheduled run (top of the hour) or trigger one with `curl -s -X POST -H 'Authorization: Bearer dev-api-key' -H 'Content-Type: application/json' -d '{"league":"premier-league"}' http://localhost:3001/api/admin/scrape`, then:
  - [ ] A3:
    - Run `sed 's/\x1b\[[0-9;]*m//g' <log> > <clean>`.
    - Get the full run id with `RUN=$(grep -o 'Starting run [0-9a-f-]\{36\} for premier-league' <clean> | tail -1 | cut -d' ' -f3)`. `[ScrapeRun]` prints only 8 characters. On today's log this command prints `440d2fc6-658b-46fe-b288-05261faa0caf`.
    - Check that `grep '^\[ScrapeRun\] premier-league' <clean> | tail -1` contains `run=${RUN:0:8}`. If the run was aborted there is no such line, only the `[ALERT] scrape run ABORTED` line.
    - Compare `ok=` and `saved=` with `curl -s "$SUPABASE_URL/rest/v1/scraper_runs?run_id=eq.$RUN&select=bookmaker,status,markets_saved" -H "apikey: …" -H "Authorization: Bearer …"`, which should return 14 rows.
  - [ ] A10, using the same query: every one of the 9 savers has `markets_saved` ≥ 0.75 × its run-2 count.
    - Floors: fortuna ≥ 9673, superbet ≥ 10015, lvbet ≥ 7071, fuksiarz ≥ 4667, betfan ≥ 4200, forbet ≥ 4402, etoto ≥ 4915, sts ≥ 3848, betclic ≥ 2363.
    - The 0.75 floor absorbs the observed run-to-run noise (STS −15% between run 1 and run 2). A miss names the bookmaker whose shared-base path (Task 2) or batch accounting (Task 1) needs a look before sign-off.
  - [ ] A4: `curl -s 'http://localhost:3001/api/health/scrapers?league=premier-league' | python3 -I -m json.tool`. Check the four `lastError` substrings and that every saver is `available`.
  - [ ] A5: `curl -s 'http://localhost:3001/api/odds?league=premier-league' | python3 -I -c "import json,sys,collections;m=json.load(sys.stdin)['meta'];print(collections.Counter(m['bookmakerStatus'].values()), m['lastUpdated'], len(m['bookmakerHealth']))"`. Expect `available >= 9`, a non-null `lastUpdated`, and `14`.
  - [ ] A5b (the frontend's path): `curl -s -X POST -H 'Content-Type: application/json' -d '{"leagues":["premier-league"]}' http://localhost:3001/api/odds/batch | python3 -I -c "import json,sys,collections;m=json.load(sys.stdin)['meta'];s=m['bookmakerStatus'];print(collections.Counter(s.values()), all(isinstance(v,str) for v in s.values()), m['lastUpdated'], len(m['bookmakerHealth']))"`. Expect `available >= 9`, `True`, a non-null `lastUpdated`, and `14`.
  - [ ] A6: `curl -s http://localhost:3001/api/bookmakers | python3 -I -c "import json,sys;print(json.load(sys.stdin)['meta'])"`. Expect `availableCount >= 9`.
- [ ] Add the outputs to `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/observability/after-fix-<date>.txt` and commit that file only: `git commit -m "docs: observability acceptance evidence"`.

---

## Self-Review

1. **Spec coverage:**

| Item | Covered by |
|---|---|
| (a) | Tasks 1 and 3 |
| (b) | Task 7 (scrape preflight, and the initial TSDB sync waiting for the DB), plus Task 1 for persist_failed |
| (c) | Tasks 1, 2, 3, and 7 (`ScrapeStats.failed`). Betclic's API-only failure text is a listed follow-up. |
| (d) | Task 2, at the single shared place `executeFullOfferScrape`, including navigations that never got a response. Betclic is API-only and noted as such. |
| (e) | Task 4 (insert, `+00:00`-safe timestamps, `/api/admin/runs` grouping and `partial`), plus wiring in Task 7 |
| (f) | Task 5, plus surfaces in Task 8, including the newly found 1000-row cap, the `ekstraklasa` default and the batch-merge bug (route-tested on the frontend's `POST /api/odds/batch` path) |
| (g) | Task 8 (endpoint) and Task 9 (CLI) |
| (h) | Task 6, plus wiring in Task 7 |
| Frontend consumption | Observations, the Task 8 batch test, A5b, and the Task 8 Step 5 check |
| Operator ergonomics | Task 10, including the `db:migrate` guard |
| Smoke command | Task 9, shape proven on current code (A2) |
| No regression in the 9 savers | A10 / Task 11 (0.75 × run-2 per bookmaker) |

2. **Step scan:** every test step names its file and its assertions with evidence values. Synthetic values are labelled as such (Task 1 `partial`). Helpers used across tasks (`outcome`, `summary`, `RUN2_OK`, `snapshotFromRun2`, `createFakeSupabase`) are declared in the Interfaces of the task that creates them, and test-local helpers (`fakeScraper`, `aggregated`) are spelled out. Code steps give signatures and exact strings. Bodies appear only for `formatDbError` (regex), the summary streak algorithm, the run-row merge key, the recorder issue rules and the service ordering. No step says only "handle errors".
3. **Type consistency:**
   - `BookmakerRunOutcome`, `BookmakerRunStatus` and `isOkRunStatus` come from Task 1 and are used in Tasks 3–9.
   - `BookmakerRunSummary`, `BookmakerStatusSnapshot` and `BookmakerHealthMeta` come from Task 5 and are used in Tasks 6–9.
   - `toScraperRunInsert` returns `ScraperRunOutcomeRow` (Task 4), i.e. `Required<Pick<ScraperRunInsert, …>>`, which is assignable to `RunRowLike` (Task 5). A plain `ScraperRunInsert` is **not** assignable, because its optional fields widen to `string | undefined`. Both facts were checked with `tsc --strict` on a scratch copy of the types. The Task 7 step 7 merge (`mergeRunRows(getRecentOutcomes(league).map(toScraperRunInsert), dbRows)`) and Task 8's `snapshotFromRun2()` rely on it.
   - `ScrapeStats` gets its new fields in Task 7 and is used in Task 8.
   - The `" | "` and `"; "` separators are fixed in Task 2. The multi-issue `"; "` join is asserted in the Task 2 test "joins several issues…", and the `" | "` prefix is asserted in Tasks 1, 3, 6, 8 and 9.
4. **Review Focus:** each of the five lines has a named test:
   - 1: Task 7 "still resolves…".
   - 2: Task 4 "names the migration…" and Task 7 "alerts from in-memory history when the insert fails but reads work".
   - 3: Task 4 "parses the real PostgREST timestamptz shape", "last successful scrape … parses +00:00" and "getRunsSummary groups real +00:00 rows…", plus Task 5 "offset-less … (defensive)".
   - 4: Task 6 "all-empty…".
   - 5: Task 2 "snapshot never throws…" and "a throwing Playwright accessor inside a listener never escapes".
5. **Proportion:** about 35 new or changed source and test files. The plan carries signatures, formats, test assertions and commands, and no implementation bodies beyond the algorithms named in item 2.
