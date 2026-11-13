# Shared Transport Layer (Plan 02) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:** rebased on the future base (`recovery/integration` ≥ `aaf7c07` + `recovery/observability` + `recovery/fortuna`) and the owner's `EXECUTION.md` (recovery dir on `recovery/integration`). Evidence: `evidence/delta-audit-infra-2026-11-13.md` (README items, section 02), `evidence/delta-audit-transport-2026-11-13.md` (Cross-cutting), `evidence/cross-plan-review-2026-11-07.md` (#12).
> - Worktree from `recovery/integration`, symlinked `node_modules` (never `npm install`/`npm ci`), heavy commands through `bin/heavy`, dead-port `.env`; no server, no DB writes.
> - Task 6 deletes the caller-less `runAllScrapers`/`runSingleScraper`/`AggregatedResult` instead of adding `legacyScraper()`; observability already deleted `runSingleFullOfferScraper`. `getScraper` stays (`scripts/smoke-bookmaker.ts`).
> - Task 8: `ws` 8.19.0 / `@types/ws` 8.18.1 are already in the lockfile; the task adds `package.json` entries only and **stops to report the dependency to the owner** before its commit.
> - Task 10: `scripts/perf-smoke.ts` now extends observability's `scripts/smoke-bookmaker.ts` (shared dry-scrape code, same exit codes) and keeps its forced dead `SUPABASE_URL`.
> - The "adapters need no task" section is replaced by real tasks for the built totalbet and Betby clients: Tasks 11–12 (timeouts, one retry, budget/signal, `transport = "http"`, cumulative `transportStats()`, §3 error wording; ungated) and Task 13 (skip a match on a failed detail instead of writing listing markets; **gated on an owner yes**, Open Question 3).
> - `HttpScraper` declares `transport = "http"` (plan 07's `DeclaresTransport`); `transportStats()` is cumulative since instance creation; transport-pick wording follows README §3's one-pick rule.

**Goal:** Ship the README §3 contract (budget, `mapLimit`, `HttpClient`/`HttpError`, replay client, `fetchDetailsSkippingFailures`, `FullOfferScraper`/`HttpScraper`, transport override, `WsSession`) plus `scripts/perf-smoke.ts`, so plans 03–08 can move scrapers off Chromium with bounded, typed, measurable network calls; then put the two browserless clients that already exist (totalbet, Betby) on the same bounded transport.

**Architecture:** Additions under `src/scrapers/shared/` (budget, concurrency, `http/`, `ws/`, detail fetch, contract), `src/scrapers/base/http-scraper.ts`, `src/config/transport.ts`, a test-only replay client and two small `src/utils/` modules for the smoke script. Edits to live code in Tasks 1–10 are typing changes and dead-code removal: `aggregator.ts` types `SCRAPERS` as `FullOfferScraper` and loses the caller-less legacy runners, and `PlaywrightScraper` declares `implements FullOfferScraper`. Tasks 11–12 move totalbet's and Betby's own fetch seams onto `HttpClient` without changing what they write; Task 13 (gated) changes what they write when a detail fails.

**Tech Stack:** TypeScript ESM (NodeNext), Node 20.19.5 global `fetch` (undici) + `AbortSignal.any`, `p-limit` 7.2.0, `ws` 8.19.0, Vitest 4, tsx.

**Spec:** README §3 (names and signatures, used verbatim, incl. "Rule: exactly ONE pick", "Empty listing rule", `DeclaresTransport`, cumulative `transportStats()`, `HttpErrorDetails`), §5 step P2 and §5.1 rows totalbet/betby/observability Task 2, §6, §7 last row. Evidence: `evidence/core/target-architecture.ts` §5 and §8 (sketch; §3 wins on names), `evidence/profiling/harness.mts` + `sampler.py` + `summary-individual.json`, `evidence/findings-notes.md` (CORE-4, CORE-9, CORE-15), `evidence/delta-audit-infra-2026-11-13.md` (section 02), `evidence/betfan-totalbet/`, `evidence/betters-lebull/`. Recovery plans (tracked on `recovery/integration`): `../2026-11-06-scraper-recovery/EXECUTION.md` (owner decisions and workspace rules; it wins over this plan), `observability.md` (Global Constraints, Task 2 `" | "` separator, Task 9 `scripts/smoke-bookmaker.ts`), `totalbet.md` (`FetchJson`, as built: `src/scrapers/bookmakers/totalbet/api-client.ts`), `betby-betters-lebull.md` (`FetchText`, `BetbyHttpError`, as built: `src/scrapers/shared/betby/`).

## Global Constraints

- README §6 applies, **overridden by the owner's `EXECUTION.md` workspace rules** wherever they differ:
  - Worktree: `git -C /home/skamik/Documents/repositories/personal/aityper-scraper-api worktree add ../aityper-scraper-api-worktrees/perf-02 -b perf/02-shared-transport recovery/integration` (or `master` once the owner has merged integration into it). Tasks 6, 10, 11 and 12 need observability's code (`runFullOfferForBookmaker`, `scripts/smoke-bookmaker.ts`, the `[Aggregator/FullOffer] <bm> <status>:` line). If `git merge-base --is-ancestor recovery/observability recovery/integration` fails, the first commit of this branch is `git merge --no-edit recovery/observability` (your own branch only; never rebase or touch another branch). `recovery/fortuna` is not needed here.
  - `ln -s /home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules node_modules` and copy an existing recovery worktree's `.env` (its `SUPABASE_URL` points at the dead port `http://127.0.0.1:9`; never change it). **Never run `npm install` or `npm ci`.** Task 8 is the only task that touches the dependency list, and it stops for the owner before committing.
  - Every `npx vitest`, `npx tsc`, `npx tsx`, `node` and `python3` command below runs through the shared runner: `H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy`, then `$H npx vitest run …`. Anything that reaches a bookmaker site runs as `$H --live …`, one at a time.
  - During TDD run only the scoped test files; at the end of each task run `$H npx vitest run` and `$H npx tsc --noEmit` once. Commit only on this branch, after each task, with the plan's message and no signature or attribution footer.
  - Never start the server or the scheduler and never write to the DB (no `npm run dev`, no `src/index.ts`, no full aggregator run, no `smoke-bookmaker.ts --persist`). Scratch output goes under `<worktree>/.scratch/` (gitignored via `.git/info/exclude`), never into the main checkout.
- Test baseline: run `$H npx vitest run` in the fresh worktree before Task 1 and record the count (the delta audit measured **125 files / 2243 tests** on the future base; README's 68/1206 is the old `master` figure). Tasks 1–10 add 11 test files; Tasks 11–13 change existing totalbet and Betby tests.
- Live-code edits: `src/scrapers/aggregator.ts`, `src/scrapers/base/playwright-base.ts`, `src/scripts/analyze-bookmaker-markets.ts`, `scripts/smoke-bookmaker.ts`, `package.json`, `package-lock.json`, `.env.example` (Tasks 1–10); `src/scrapers/bookmakers/totalbet/{api-client,constants,index}.ts` and `src/scrapers/shared/betby/{http,types,client,discovery,scraper}.ts` plus their tests (Tasks 11–13). Everything else is new.
- Timers: budget, HTTP client and WS session use the global `setTimeout`/`clearTimeout` only, so `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })` controls them. Never use `AbortSignal.timeout` or `timers/promises` here.
- Never call `addEventListener` on a caller-supplied signal. Listen on a derived `AbortSignal.any([signal])` instead. The 11th listener on one signal triggers `MaxListenersExceededWarning`, and derived signals do not count (verified, Observations 4).
- Tests: no live network. Local servers on `127.0.0.1` port 0 are allowed (Task 2 has one, Task 8 several). Close every server in `afterEach`.
- `tsc` covers neither tests nor `scripts/`. Type-check the replay helper (Task 3), `scripts/smoke-bookmaker.ts` (Tasks 6, 10) and `scripts/perf-smoke.ts` (Task 10) with observability's standalone command: `npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule <files>`.
- Live runs (Tasks 10–13) are read-only probes under `$H --live`: one bookmaker at a time, never in HH:55–HH:10, and never while the live backend's `/api/health` shows a run in progress. They never write to the DB: `perf-smoke` forces `SUPABASE_URL=http://127.0.0.1:9` before importing any `src/` module (the worktree `.env` already points there). Live acceptance that needs a persisted scrape is DEFERRED to the owner (EXECUTION rule 4): record the command and the expected result in the task report instead of running it.

## Review Focus

1. **One signal shared by many waiters.** Plan 07 hands the run signal to every budget, and `mapLimit` fans details out over one budget signal. The rule: no listener on the caller's signal, and no `MaxListenersExceededWarning`. Pinned by Task 1 "adds no listener to a shared parent" and Task 2 "shares one signal across 30 requests without a warning".
2. **Headers arrive, then the body stalls.** lvbet sends 1.37 MB uncompressed per call. The per-attempt timeout must cover the body read and produce `fetch timeout <ms>ms <url>`. Pinned by Task 2 "times out a body that never finishes".
3. **The budget aborts while a request is queued behind a saturated host or sleeping in backoff.** It rejects at once with `fetch aborted <url>` and never calls `fetch` again. Pinned by Task 2 "a queued request whose signal aborts rejects at once" and "abort during backoff stops retrying".
4. **The budget runs out halfway through the details.** Started details finish. Unstarted ones are skipped: no `FullMatchOffer`, so no write and no prune. The scraper fails only when more than 50 % are skipped. Pinned by Task 4 "an exhausted budget skips the remaining events" and Task 5 "fails when more than half the details failed".
5. **The server pushes frames before the first `collect()`**, as pzbuk `SETUP` and the Swarm session reply do, or closes mid-collect. Buffered frames are delivered in order. A close rejects with `ws closed <code> <url>`. Pinned by Task 8 "collects until done, including frames sent before collect" and "a server close rejects the collect".
6. **One league's budget aborts while another league waits on the same Betby snapshot.** Betby's `TtlCache` shares one in-flight load across leagues (`shared/betby/client.ts:49-67`), and leagues run in parallel. A caller's abort must stop only that caller's wait, never the shared load, and a budget abort must never turn into a listing-market write. Pinned by Task 12 "a budget abort leaves the shared snapshot load to the other league" and "a budget abort fails the scrape instead of falling back", and Task 11 "a budget abort fails the scrape and writes nothing".

---

## Observations (pre-fix analysis)

1. **No network call is bounded today.** There are 20 `page.evaluate(fetch)` calls without a timeout in 6 `navigation.ts` files (fortuna 6, fuksiarz 4, forbet 3, betfan 3, superbet 2, etoto 2; totalbet's navigation was deleted by the recovery migration). `src/scrapers/aggregator.ts:352` `Promise.all` has no deadline, so one stalled response hangs the run (README §1.5, findings CORE-4). The two browserless clients that recovery built are unbounded too (Observation 8). The budget, the HTTP timeouts and `WsSession` close this. Plan 07 adds the coordinator's hard deadline.
2. **Typing and dead code** (line numbers on the future base). `aggregator.ts:33` types `SCRAPERS` as `Record<PolishBookmaker, PlaywrightScraper>`. Only the legacy path needs that type: `runAllScrapers` (`:68-162`, calls `scrapeLeague` at `:98`) and `runSingleScraper` (`:167-188`) have **no caller** in `src/` or `scripts/` (observability Task 7 removed the `scraper-service.ts` import; observability also deleted `runSingleFullOfferScraper`). `AggregatedResult` (`:50-63`) is used only by them. `getScraper` (`:193-195`) is used by observability's `scripts/smoke-bookmaker.ts:24, 93, 175`. `runFullOfferForBookmaker` (`:261-333`, lookup `:267`) and `runAllFullOfferScrapers` (`:339`) call only `scrapeFullOffer`/`cleanup`. A second `Record<PolishBookmaker, PlaywrightScraper>` map is `src/scripts/analyze-bookmaker-markets.ts:41` (import `:36`). In `src/scrapers/base/playwright-base.ts` the class is at `:39`, `scrapeFullOffer(league)` at `:84-86`, the no-op `cleanup()` at `:229-231`, the "Unknown league" result at `:360-366` and the `Full offer scraper error` log at `:302`. `FullOfferScraperResult` is `src/types/full-offer.ts:99-114` and now carries an optional `diagnostics` (observability), which `HttpScraper` leaves unset.
3. **Dependencies.** `p-limit` ^7.2.0 is declared (`package.json:34`) and unused in `src/`. Its default export `pLimit(n)` throws `TypeError("Expected \`concurrency\` to be a number from 1 and up")` for non-integers or values below 1. `ws` 8.19.0 and `@types/ws` 8.18.1 are **already in `package-lock.json`** (`node_modules/ws` at `:3202`, `node_modules/@types/ws` at `:1064`), hoisted transitively through `@supabase/realtime-js`, and present in the symlinked `node_modules` (`ws/package.json` 8.19.0, `@types/ws` 8.18.1 with `index.d.mts`). So `import WebSocket from "ws"` resolves without any install; declaring them in `package.json` (`dependencies` `:23-38`, `devDependencies` `:39-49`) only makes the dependency explicit. EXECUTION forbids adding a dependency without reporting it first (Task 8).
4. **Runtime facts**, verified on Node 20.19.5 against local servers in the writer's scratch dir (`writer-02/enc.mjs`, `enc2.mjs`, `sig.mjs`, `sig2.mjs`, `wsx.mjs`):
   - `AbortSignal.any` exists and is typed by TS 5.9.3 `lib.dom`.
   - `fetch` sends `accept-encoding: gzip, deflate` and `user-agent: node` by default. It decodes gzip and br. An explicit `accept-encoding: gzip, deflate, br` reaches the wire unchanged, and the br reply is decoded.
   - `content-length` reports compressed bytes. `new Response(string)` has no content-length and gets `content-type: text/plain;charset=UTF-8`.
   - Errors: `TypeError("fetch failed")` with `cause.code` `ECONNREFUSED` or `ENOTFOUND`, or `cause.message` `bad port`. An abort during the body read rejects `text()`.
   - Once `text()` has locked the body, `res.body.cancel()` fails with `ERR_INVALID_STATE`.
   - Listeners: the 11th `addEventListener("abort")` on one signal, including 11 concurrent `timers/promises` sleeps on it, emits `MaxListenersExceededWarning`. 50 `AbortSignal.any([shared, …])` emit none.
5. **Encodings of the APIs that plans 03/04 move onto `HttpClient`** (recorded headers):
   - br: fortuna `evidence/betclic-fortuna/fortuna-full.hdr` (63 KB br vs 1.7 MB decoded), betfan `evidence/betfan-totalbet/bf-ev.hdr`.
   - gzip: forbet, etoto, fuksiarz (`evidence/forbet-etoto/*.hdr`, `evidence/lvbet-fuksiarz/fk_ev.hdr`), totalbet dealer (`tb-dealer-ev.hdr`).
   - Uncompressed: lvbet, with `content-length: 1370859` per markets call (`lv_mk1.hdr`).
   - All are `application/json`, some with `; charset=utf-8`. Brotli must be requested explicitly.
6. **`ws` client behaviour**, verified the same way:
   - A 403 handshake fires `unexpected-response`, then close 1006. A refused connection gives an error with `code: "ECONNREFUSED"`. A server that never upgrades produces no event until our own timer fires.
   - The client offers `permessage-deflate` by default, but a `ws` server only accepts it when it is created with `perMessageDeflate`.
   - All three WebSocket targets answered with only `Origin` and `User-Agent` headers: `evidence/sts-superbet/sts-ws-probe.mjs`, `evidence/betcris-pzbuk/swarm-bulk.mjs`, `pzbuk-direct2.mjs`.
7. **Profiling method that `perf-smoke` reproduces** (`evidence/profiling/harness.mts`, `sampler.py`):
   - The harness races `scrapeFullOffer` against 10 min, forces `SUPABASE_URL` to `127.0.0.1:9`, and samples `/proc` every 0.5 s.
   - Chromium is every descendant whose `comm` contains `chrome` or `headless`. Its CPU is the sum of the last-seen `utime+stime` ticks (`CLK_TCK` 100). Reaped-children CPU is unusable: 24.1 s for sts against 171.9 s sampled (`summary-individual.json`).
   - RSS baselines to compare against: `peak_chrome_rss_MB` fortuna 1035, sts 1728, betclic 0; `peak_node_rss_MB` fortuna 337.
   - Observability's `scripts/smoke-bookmaker.ts` (Task 9 of observability.md) already does the dry half of this: `--bookmaker <bm> [--league <slug>]`, `getScraper(bm).scrapeFullOffer(league)` with a throw turned into a failed result (`:92-100`), in-memory normalization metrics (`:102-140`), one `SMOKE_RESULT {json}` line, exit 0 / 1 (`scrape_failed` or `empty`) / 2 (usage, unknown bookmaker), and `closeAllBrowsers()` in `finally` (`:188-191`). It imports `src/` statically and calls `main()` at module level (`:194-201`). `perf-smoke` reuses that code instead of duplicating it (Task 10).
8. **The browserless clients recovery built** (future base; neither existed on `master` when this plan was written):
   - **totalbet** (`src/scrapers/bookmakers/totalbet/`). Seam `FetchJson = (url) => Promise<{status, contentType, body}>` (`api-client.ts:23`); default `nodeFetchJson` sends Node's default `user-agent: node` with a 30 s `AbortSignal.timeout` (`:30-45`, `constants.ts:36`), no retry. `requestJson` (`:178-195`) words failures as `Request failed: <msg> (<url>)`, `HTTP <status>[ (<envelope reason>)] from <url>` and `Non-JSON response (HTTP <s>, <ct>) from <url>`. `fetchEventDetail` (`:146-169`) returns `{event}`, `{event: null, error}` or `{event: null, notPrematch, error}` (kicked off between list and detail: a state change, not a failure). The scraper (`index.ts`) is a module singleton (`:377`) whose deps are injected once (`:63-72`, `fetchJson` at `:70`). Details are fetched sequentially with `DETAIL_DELAY_MS = 250` (`:254-255`, `constants.ts:31`), no budget. A failed detail writes the **list 1X2 only** (`:274-280`), and the run is `success` unless every reachable detail failed (`:319`); that shape is pinned by `__tests__/scraper.test.ts:67-89, :105-108, :163-237`. An empty prematch list is reported as an error (`api-client.ts:113-121`, totalbet.md's own rule: an unknown UUID answers 200 with an empty list).
   - **Betby** (betters, lebull: `src/scrapers/shared/betby/`). Seam `FetchText = (url) => Promise<string>` (`types.ts:12`); default `createFetchText` sends a Chrome/131 UA with a 15 s timeout (`http.ts:3-4, 36-67`), no retry; non-2xx throws `BetbyHttpError` (`HTTP <status> from <host><path>`, `:20-29`), transport errors `Betby request failed: <host><path>: <reason>`. `BetbyClient` (`client.ts:124-225`) memoizes in-flight loads in `TtlCache` (`:49-67`: endpoints 6 h, snapshot 45 s, descriptions 6 h) — reuse it. `loadSnapshot` fetches all chunk versions in parallel (`:200-202`; 7 in the evidence), so a per-host limit below 8 would serialize them. The scraper fetches events sequentially with `DEFAULT_EVENT_DELAY_MS = 150` (`scraper.ts:38, 150-152`); **any** missing, mismatched or failed event payload falls back to the snapshot's listing markets (`fullEvent`, `:299-316`; use at `:152-155`) and the run stays `success:true` with no `error` (`:177`). `lastRunStats` (`:112-113`) is a per-run split of event ids (`full`/`listingOnly`), not a transport counter; nothing outside the tests reads it (`scripts/betby-smoke.ts` was never built). Zero upcoming matches is reported as an error (`:141-145`, the Betby plan's own rule).
   - Both still `extends PlaywrightScraper` only for the shared interface and never open a browser. Neither has a browser fallback, so `SCRAPER_TRANSPORT_TOTALBET/BETTERS/LEBULL` has no pick site and no effect.
   - With the owner's **B13 (prune guard deferred)**, every listing-market write above deletes that match's previous full snapshot until the next run (totalbet detail `market_count` 439–488 vs 1 market written; Betby 220–242 markets vs 14–16). That is the README §5.1 amendment "skip the match on a failed detail". EXECUTION's owner rule "pzbuk, totalbet, betby: follow each plan's own default" makes the fallback the current default, so changing it is gated (Task 13, Open Question 3).

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/shared/budget.ts` | `ScrapeBudget`, `createScrapeBudget`, `BudgetExceededError` | 1 |
| `src/scrapers/shared/concurrency.ts` | `mapLimit` over p-limit | 1 |
| `src/scrapers/shared/http/http-error.ts` | `HttpError`, kinds, message factories | 2 |
| `src/scrapers/shared/http/http-client.ts` | `createHttpClient`, `DEFAULT_USER_AGENT`, retry/timeout/limit/stats | 2 |
| `src/__tests__/helpers/replay-http.ts` | `createReplayHttpClient` (test-only) | 3 |
| `src/scrapers/shared/detail-fetch.ts` | `fetchDetailsSkippingFailures`, `MAX_SKIPPED_DETAIL_RATIO` | 4 |
| `src/scrapers/shared/scraper-contract.ts` | `FullOfferScraper`, `DEFAULT_MAX_DURATION_MS`, `TransportStatsSource`, `hasTransportStats` | 5 |
| `src/scrapers/base/http-scraper.ts` | `HttpScraper` template | 5 |
| `src/scrapers/aggregator.ts`, `src/scrapers/base/playwright-base.ts`, `src/scripts/analyze-bookmaker-markets.ts` | `FullOfferScraper` typing; caller-less legacy runners deleted | 6 |
| `src/config/transport.ts`, `.env.example` | `getTransportOverride` | 7 |
| `src/scrapers/shared/ws/ws-session.ts`, `package.json`, `package-lock.json` | `openWsSession`; explicit `ws`/`@types/ws` entries (owner report first) | 8 |
| `src/utils/proc-sampler.ts`, `src/utils/perf-summary.ts` | `/proc` sampling, offer counts, parity comparison, transport-stats diff | 9 |
| `scripts/smoke-bookmaker.ts` (observability), `scripts/perf-smoke.ts` | shared dry scrape; one-bookmaker scrape with perf JSON and parity check | 10 |
| `src/scrapers/bookmakers/totalbet/{api-client,constants,index}.ts` + tests | `HttpClient` seam, timeouts/retry/budget/stats, §3 error wording | 11 |
| `src/scrapers/shared/betby/{http,types,client,discovery,scraper}.ts` + tests | same for Betby; shared-load abort rule | 12 |
| totalbet `index.ts`, Betby `scraper.ts` + tests | skip a match on a failed detail (**gated**, Open Question 3) | 13 |

---

### Task 1: Scrape budget and `mapLimit`

**Files:**
- Create: `src/scrapers/shared/budget.ts`, `src/scrapers/shared/concurrency.ts`
- Test: `src/scrapers/shared/__tests__/budget.test.ts`, `src/scrapers/shared/__tests__/concurrency.test.ts`

**Interfaces:**
- Produces: README §3 `BudgetExceededError`, `ScrapeBudget`, `createScrapeBudget(maxDurationMs, parent?)`, `mapLimit(items, limit, fn, signal?)`. In addition:
  - `BudgetExceededError` sets `name = "BudgetExceededError"`.
  - At the deadline the budget aborts with reason `new BudgetExceededError(\`scrape budget of ${maxDurationMs}ms exceeded\`)`.
  - After a parent abort, `signal.reason` is the parent's reason, and `checkpoint()` throws `new BudgetExceededError(\`scrape aborted: ${reason instanceof Error ? reason.message : String(reason)}\`)`.
  - `remainingMs()` is `0` once aborted.
  - `createScrapeBudget` throws `RangeError(\`maxDurationMs must be a positive finite number, got ${maxDurationMs}\`)` unless the duration is finite and > 0.
  - `mapLimit`: items not started when `signal` aborts settle as rejected, without calling `fn`. The reason is `signal.reason` if it is an Error, else `new Error(String(signal.reason))`. An invalid `limit` rejects with p-limit's TypeError.

- [ ] **Step 1: Write the failing tests**

```ts
// budget.test.ts
beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(new Date("2026-11-07T10:00:00.000Z")); });
afterEach(() => vi.useRealTimers());
it("aborts at the deadline with BudgetExceededError", () => {
  const b = createScrapeBudget(1000);
  expect(b.deadline).toBe(Date.parse("2026-11-07T10:00:01.000Z"));
  vi.advanceTimersByTime(400);
  expect(b.remainingMs()).toBe(600); expect(b.signal.aborted).toBe(false); expect(() => b.checkpoint()).not.toThrow();
  vi.advanceTimersByTime(600);
  expect(b.signal.aborted).toBe(true); expect(b.remainingMs()).toBe(0);
  expect(b.signal.reason).toBeInstanceOf(BudgetExceededError);
  expect(() => b.checkpoint()).toThrow(new BudgetExceededError("scrape budget of 1000ms exceeded"));
});
it("follows a parent abort and names its reason", () => {
  const p = new AbortController(); const b = createScrapeBudget(60_000, p.signal);
  p.abort(new Error("shutdown"));
  expect(b.signal.aborted).toBe(true); expect(b.remainingMs()).toBe(0);
  expect(() => b.checkpoint()).toThrow(expect.objectContaining({ name: "BudgetExceededError", message: "scrape aborted: shutdown" }));
});
it("is aborted at creation when the parent already is", () =>
  expect(() => createScrapeBudget(1000, AbortSignal.abort("stop")).checkpoint()).toThrow("scrape aborted: stop"));
it("rejects a non-positive or non-finite duration", () => {
  expect(() => createScrapeBudget(0)).toThrow(RangeError);
  expect(() => createScrapeBudget(Number.NaN)).toThrow("maxDurationMs must be a positive finite number, got NaN");
});
it("adds no listener to a shared parent", async () => {
  const warn = vi.fn(); process.on("warning", warn);
  const p = new AbortController(); for (let i = 0; i < 20; i++) createScrapeBudget(60_000, p.signal);
  await new Promise((r) => setImmediate(r)); process.off("warning", warn);
  expect(warn).not.toHaveBeenCalled();
});

// concurrency.test.ts (real timers)
it("keeps input order and never exceeds the limit", async () => {
  let active = 0, peak = 0;
  const r = await mapLimit([30, 10, 20, 0], 2, async (ms, i) => { active++; peak = Math.max(peak, active); await new Promise((res) => setTimeout(res, ms)); active--; return i; });
  expect(peak).toBe(2);
  expect(r).toEqual([0, 1, 2, 3].map((value) => ({ status: "fulfilled", value })));
});
it("turns sync and async throws into rejected entries", async () => {
  const r = await mapLimit([1, 2], 2, (x) => { if (x === 1) throw new Error("sync"); return Promise.reject(new Error("async")); });
  expect(r.map((s) => s.status === "rejected" && (s.reason as Error).message)).toEqual(["sync", "async"]);
});
it("does not start items after the signal aborts", async () => {
  const ctl = new AbortController();
  const fn = vi.fn(async (x: number) => { if (x === 1) ctl.abort(new Error("stop")); return x; });
  const r = await mapLimit([1, 2, 3], 1, fn, ctl.signal);
  expect(fn).toHaveBeenCalledTimes(1); expect(r[0]).toEqual({ status: "fulfilled", value: 1 });
  expect(r.slice(1).map((s) => s.status === "rejected" && (s.reason as Error).message)).toEqual(["stop", "stop"]);
});
it("returns [] for no items and rejects an invalid limit", async () => {
  expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  await expect(mapLimit([1], 0, async () => 1)).rejects.toThrow("Expected `concurrency` to be a number from 1 and up");
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/scrapers/shared/__tests__/budget.test.ts src/scrapers/shared/__tests__/concurrency.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement.**
  - `createScrapeBudget` owns an `AbortController`. Its global `setTimeout` (unref'd) aborts with the deadline error. `signal = parent ? AbortSignal.any([parent, own.signal]) : own.signal`.
  - `mapLimit` wraps each item as `limit(() => { if (signal?.aborted) throw reasonError(signal); return fn(item, index); })` and maps each promise to a `PromiseSettledResult`.
- [ ] **Step 4: Run them and confirm they pass.** Same command, then `npx tsc --noEmit` and `npx vitest run`.
- [ ] **Step 5: Commit.** `git add src/scrapers/shared/budget.ts src/scrapers/shared/concurrency.ts src/scrapers/shared/__tests__` and `git commit -m "feat(scrapers): scrape budget and bounded mapLimit"`

---

### Task 2: `HttpError` and `HttpClient`

**Files:**
- Create: `src/scrapers/shared/http/http-error.ts`, `src/scrapers/shared/http/http-client.ts`
- Test: `src/scrapers/shared/http/__tests__/http-client.test.ts`

**Interfaces:**
- Consumes: nothing beyond p-limit.
- Produces: README §3 `HttpErrorKind`, `HttpError`, `HttpRequestOptions`, `HttpStats`, `HttpClient`, `createHttpClient(cfg?)`, with the message formats verbatim. That includes the coordinator's §3 refinement: an `http`-kind message appends ` cf-mitigated=<value>` when the response carries a `cf-mitigated` header, and the value is exposed as `cfMitigated`. Additions, which go to the orchestrator as §3 additions:
  ```ts
  // http-error.ts
  export const HTTP_ERROR_BODY_SNIPPET_CHARS = 4096;
  export interface HttpErrorDetails { contentType?: string | null; bodySnippet?: string; cfMitigated?: string }
  export class HttpError extends Error {
    constructor(readonly kind: HttpErrorKind, readonly url: string, readonly status: number | null, message: string, details?: HttpErrorDetails); // 5th param optional, additive
    readonly contentType: string | null;     // response content-type; null when there was no response
    readonly bodySnippet: string;            // first 4096 chars of the response body; "" when none
    readonly cfMitigated?: string;           // value of the `cf-mitigated` response header (e.g. "challenge"), when present
  }
  // `fetch HTTP ${status} ${url}` + (cfMitigated ? ` cf-mitigated=${cfMitigated}` : "")
  export function httpStatusError(url: string, status: number, contentType: string | null, body: string, cfMitigated?: string): HttpError;
  export function contentTypeError(url: string, status: number, contentType: string | null, body: string): HttpError; // `fetch non-JSON ${contentType ?? "none"} ${url}`
  export function timeoutError(url: string, timeoutMs: number): HttpError;  // `fetch timeout ${timeoutMs}ms ${url}`
  export function networkError(url: string, err: unknown): HttpError;       // cause = err.cause ?? err; `fetch failed ${cause.code ?? cause.message ?? String(cause)} ${url}`
  export function abortedError(url: string): HttpError;                     // `fetch aborted ${url}`
  // http-client.ts
  export const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
  ```
- Behaviour that the tests pin:
  - **Default transport.** Without `cfg.fetchImpl` the client calls `globalThis.fetch` **on every attempt**, never a reference captured at creation. Module singletons are created at import time (totalbet `index.ts:377`), and tests replace `fetch` later with `vi.stubGlobal` (totalbet `scraper.test.ts:154-161`).
  - **Headers.** Lower-case keys, merged as built-in defaults < `cfg.defaultHeaders` < `opts.headers`, and passed to `fetchImpl` as a plain object. The defaults are `user-agent: cfg.userAgent ?? DEFAULT_USER_AGENT`, `accept-language: pl-PL,pl;q=0.9` and `accept-encoding: gzip, deflate, br`. `accept` is `application/json, text/plain, */*` for `getJson` and `*/*` for `getText`.
  - **JSON.** `getJson` requires `/json/i` in content-type. A body that fails `JSON.parse` is also `content-type` kind, with the same message. APIs that serve JSON as `text/plain` use `getText` + `JSON.parse`.
  - **Stats.**
    - `requests` counts `fetchImpl` calls, and `retries` counts attempts after the first.
    - `failures` counts rejected `getJson`/`getText` calls.
    - `bytes` adds `content-length` when it is a finite number, else `Buffer.byteLength(text)`. That is wire bytes when the server states them.
    - `byStatus` is keyed by the status as a string, or by `"timeout"`/`"network"`/`"aborted"` for an attempt that got no response.
  - **Errors and retry.**
    - The per-attempt timeout covers the body read.
    - The per-host limit holds one slot per attempt. Backoff sleeps outside the slot.
    - A request whose signal aborts while it waits for a slot rejects at once, and its slot, when granted, is released without a fetch.

- [ ] **Step 1: Write the failing tests**

```ts
const U = "https://api.test/x";
const json = (body: unknown, h: Record<string, string> = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...h } });
const hang = (_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)));
const seq = (...rs: Array<Response | Error | "hang">) => vi.fn(async (u: string, init: RequestInit) => { const r = rs.shift()!; if (r === "hang") return hang(u, init); if (r instanceof Error) throw r; return r; });
const client = (f: unknown, cfg = {}) => createHttpClient({ fetchImpl: f as typeof fetch, ...cfg });
const fake = () => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(new Date("2026-11-07T10:00:00.000Z")); };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("getJson parses JSON and sends merged lower-case headers", async () => {
  const f = seq(json({ ok: 1 }));
  expect(await client(f, { defaultHeaders: { "X-Brand": "forbet" } }).getJson(U, { headers: { "User-Agent": "UA-test" } })).toEqual({ ok: 1 });
  expect(f.mock.calls[0][1].headers).toEqual({ "user-agent": "UA-test", accept: "application/json, text/plain, */*",
    "accept-language": "pl-PL,pl;q=0.9", "accept-encoding": "gzip, deflate, br", "x-brand": "forbet" });
});
it("getText sends accept */* and the default Chrome 143 UA", async () => {
  const f = seq(new Response("<html/>", { headers: { "content-type": "text/html" } }));
  expect(await client(f).getText(U)).toBe("<html/>");
  expect(f.mock.calls[0][1].headers).toMatchObject({ accept: "*/*", "user-agent": DEFAULT_USER_AGENT });
  expect(DEFAULT_USER_AGENT).toMatch(/Chrome\/143\.0\.0\.0 Safari\/537\.36$/);
});
it("404: http kind, no retry, keeps content-type and a 4096-char body snippet", async () => {
  const f = seq(new Response("x".repeat(5000), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }));
  const http = client(f);
  const err = await http.getJson(U).catch((e) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect(err).toMatchObject({ name: "HttpError", kind: "http", status: 404, url: U, message: `fetch HTTP 404 ${U}`, contentType: "text/html; charset=utf-8" });
  expect(err.bodySnippet).toHaveLength(4096); expect(err.cfMitigated).toBeUndefined();
  expect(f).toHaveBeenCalledTimes(1);
  expect(http.stats).toEqual({ requests: 1, retries: 0, failures: 1, bytes: 5000, byStatus: { "404": 1 } });
});
it("a Cloudflare challenge names cf-mitigated in the message and the field", async () => {
  const f = seq(new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } }));
  await expect(client(f).getJson(U)).rejects.toMatchObject({ kind: "http", status: 403, cfMitigated: "challenge", message: `fetch HTTP 403 ${U} cf-mitigated=challenge` });
  expect(f).toHaveBeenCalledTimes(1); // 4xx: not retried
});
it("retries 503 once after a full-jitter delay", async () => {
  fake(); vi.spyOn(Math, "random").mockReturnValue(0.5);
  const f = seq(json({}, {}, 503), json({ ok: 1 })); const http = client(f); const p = http.getJson(U);
  await vi.advanceTimersByTimeAsync(249); expect(f).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await expect(p).resolves.toEqual({ ok: 1 });
  expect(http.stats).toMatchObject({ requests: 2, retries: 1, failures: 0, byStatus: { "503": 1, "200": 1 } });
});
it.each([["2", 2000], ["120", 5000], ["Sat, 07 Nov 2026 10:00:03 GMT", 3000]])("honours Retry-After %s (capped at 5 s)", async (ra, ms) => {
  fake(); const f = seq(json({}, { "retry-after": ra }, 429), json({ ok: 1 })); const p = client(f).getJson(U);
  await vi.advanceTimersByTimeAsync(ms - 1); expect(f).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await expect(p).resolves.toEqual({ ok: 1 });
});
it("gives up after `retries` and throws the last error", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  await expect(client(seq(json({}, {}, 500), json({}, {}, 502))).getJson(U)).rejects.toThrow(`fetch HTTP 502 ${U}`);
  const f = seq(json({}, {}, 500)); await expect(client(f).getJson(U, { retries: 0 })).rejects.toThrow(`fetch HTTP 500 ${U}`);
  expect(f).toHaveBeenCalledTimes(1);
});
it("timeout kind is retried", async () => {
  fake(); vi.spyOn(Math, "random").mockReturnValue(0);
  const http = client(seq("hang", "hang")); const p = http.getJson(U, { timeoutMs: 1000 });
  const done = expect(p).rejects.toMatchObject({ kind: "timeout", status: null, message: `fetch timeout 1000ms ${U}` });
  await vi.advanceTimersByTimeAsync(2000); await done;
  expect(http.stats.byStatus).toEqual({ timeout: 2 });
});
it("times out a body that never finishes", async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } });
  const f = seq(new Response(body, { headers: { "content-type": "application/json" } }));
  await expect(client(f).getJson(U, { timeoutMs: 50, retries: 0 })).rejects.toThrow(`fetch timeout 50ms ${U}`);
});
it("network kind names the cause code, else the cause message, else the error message", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const refused = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  const f = seq(refused, refused);
  await expect(client(f).getJson(U)).rejects.toMatchObject({ kind: "network", message: `fetch failed ECONNREFUSED ${U}` });
  expect(f).toHaveBeenCalledTimes(2);
  await expect(client(seq(new TypeError("fetch failed", { cause: new Error("bad port") }))).getJson(U, { retries: 0 })).rejects.toThrow(`fetch failed bad port ${U}`);
  await expect(client(seq(new Error("boom"))).getJson(U, { retries: 0 })).rejects.toThrow(`fetch failed boom ${U}`);
});
it("content-type kind for non-JSON or unparsable bodies, never retried", async () => {
  const html = seq(new Response("<p>", { headers: { "content-type": "text/html" } }));
  await expect(client(html).getJson(U)).rejects.toMatchObject({ kind: "content-type", status: 200, message: `fetch non-JSON text/html ${U}` });
  expect(html).toHaveBeenCalledTimes(1);
  await expect(client(seq(new Response("{", { headers: { "content-type": "application/json" } }))).getJson(U)).rejects.toThrow(`fetch non-JSON application/json ${U}`);
  const bare = new Response("{}"); bare.headers.delete("content-type");
  await expect(client(seq(bare)).getJson(U)).rejects.toThrow(`fetch non-JSON none ${U}`);
});
it("aborted kind: no fetch after abort, no retry after abort", async () => {
  const f0 = seq(json({})); const http = client(f0);
  await expect(http.getJson(U, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: "aborted", message: `fetch aborted ${U}` });
  expect(f0).not.toHaveBeenCalled(); expect(http.stats).toMatchObject({ requests: 0, failures: 1 });
  const ctl = new AbortController(); const f1 = seq("hang", json({}));
  const p = client(f1).getJson(U, { signal: ctl.signal }); ctl.abort();
  await expect(p).rejects.toThrow(`fetch aborted ${U}`); expect(f1).toHaveBeenCalledTimes(1);
});
it("abort during backoff stops retrying", async () => {
  fake(); vi.spyOn(Math, "random").mockReturnValue(0.5);
  const ctl = new AbortController(); const f = seq(json({}, {}, 503), json({ ok: 1 }));
  const p = client(f).getJson(U, { signal: ctl.signal }); const done = expect(p).rejects.toThrow(`fetch aborted ${U}`);
  await vi.advanceTimersByTimeAsync(100); ctl.abort(); await done;
  await vi.advanceTimersByTimeAsync(1000); expect(f).toHaveBeenCalledTimes(1);
});
it("limits concurrency per host, not across hosts", async () => {
  const open: Record<string, number> = {}; let peakA = 0; const release: Array<() => void> = [];
  const f = vi.fn((u: string) => { const h = new URL(u).host; open[h] = (open[h] ?? 0) + 1; peakA = Math.max(peakA, open["a.test"] ?? 0);
    return new Promise<Response>((res) => release.push(() => { open[h]--; res(json({})); })); });
  const http = client(f, { perHostConcurrency: 2 });
  const all = [1, 2, 3, 4, 5].map((i) => http.getJson(`https://a.test/${i}`)).concat(http.getJson("https://b.test/1"));
  await new Promise((r) => setImmediate(r));
  expect(f).toHaveBeenCalledTimes(3); // a.test ×2 + b.test ×1
  while (release.length) { release.shift()!(); await new Promise((r) => setImmediate(r)); }
  await Promise.all(all); expect(peakA).toBe(2);
});
it("a queued request whose signal aborts rejects at once without fetching", async () => {
  let first!: () => void; const f = vi.fn(() => new Promise<Response>((res) => { first = () => res(json({})); }));
  const http = client(f, { perHostConcurrency: 1 }); const ctl = new AbortController();
  const p1 = http.getJson("https://a.test/1"); const p2 = http.getJson("https://a.test/2", { signal: ctl.signal });
  ctl.abort(); await expect(p2).rejects.toThrow("fetch aborted https://a.test/2");
  first(); await p1; await new Promise((r) => setImmediate(r)); expect(f).toHaveBeenCalledTimes(1);
});
it("counts bytes from content-length, else from the UTF-8 body", async () => {
  const http = client(seq(json({}, { "content-length": "173" }), new Response("zażółć", { headers: { "content-type": "text/plain" } })));
  await http.getJson(U); await http.getText(U); expect(http.stats.bytes).toBe(183);
});
it("shares one signal across 30 requests without a warning", async () => {
  const warn = vi.fn(); process.on("warning", warn); const ctl = new AbortController();
  const http = client(vi.fn(async () => json({})));
  await Promise.all(Array.from({ length: 30 }, (_, i) => http.getJson(`https://a.test/${i}`, { signal: ctl.signal })));
  await new Promise((r) => setImmediate(r)); process.off("warning", warn); expect(warn).not.toHaveBeenCalled();
});
it("without fetchImpl it reads globalThis.fetch at call time", async () => {
  const http = createHttpClient();                       // created before the stub, like a module singleton
  const stub = vi.fn(async () => json({ late: true })); vi.stubGlobal("fetch", stub);
  try { expect(await http.getJson(U)).toEqual({ late: true }); expect(stub).toHaveBeenCalledTimes(1); } finally { vi.unstubAllGlobals(); }
});
it("real fetch: requests br from a local server and counts compressed bytes", async () => {
  // http.createServer on 127.0.0.1:0 records req.headers and answers brotliCompressSync('{"ok":1,"pad":"<3000 x>"}')
  // with content-type application/json, content-encoding br, content-length = compressed length (close the server in afterEach)
  const http = createHttpClient();
  expect(await http.getJson(`http://127.0.0.1:${port}/`)).toMatchObject({ ok: 1 });
  expect(seen["accept-encoding"]).toBe("gzip, deflate, br"); expect(seen["user-agent"]).toBe(DEFAULT_USER_AGENT);
  expect(http.stats.bytes).toBe(compressed.length);
});
```

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run src/scrapers/shared/http/__tests__/http-client.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement.** `createHttpClient` calls `pLimit(perHostConcurrency ?? 4)` once at creation, so a bad value throws there. It keeps one limiter per `new URL(url).host` and builds both methods on `request(url, opts, asJson)`:

```
request:
  if signal?.aborted: failures++; throw abortedError(url)
  for attempt = 0 .. retries:
    retryAfterMs = null
    try return await raceAbort(limiterFor(host)(attemptOnce), AbortSignal.any([signal]))  // queue wait is abortable
    catch e:
      if e is not HttpError, or kind ∈ {aborted, content-type}, or (kind == http and status != 429 and status < 500),
         or attempt == retries: failures++; throw e
      retries++
      delay = retryAfterMs ?? floor(random() * 500 * 2 ** attempt)    // retryAfterMs already capped at 5000
      await abortableSleep(delay, signal)                             // abort → failures++; throw abortedError(url)
attemptOnce:
  if signal?.aborted: throw abortedError(url)       // slot granted after abort: no fetch
  ctl = new AbortController(); timedOut = false
  timer = setTimeout(() => { timedOut = true; ctl.abort() }, timeoutMs)
  s = signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal
  requests++
  try:
    res = await fetchImpl(url, { headers, signal: s })
    text = await raceAbort(res.text(), s)           // abandon the losing text() with .catch(() => {}); never res.body.cancel() (locked)
    bytes += contentLength ?? Buffer.byteLength(text); byStatus[String(res.status)]++
    if !res.ok: retryAfterMs = min(5000, parseRetryAfter(res.headers.get("retry-after")))
                throw httpStatusError(url, res.status, ct, text, res.headers.get("cf-mitigated") ?? undefined)
    asJson: no /json/i in content-type, or JSON.parse fails → throw contentTypeError(...)
    return asJson ? parsed : text
  catch e:
    if e instanceof HttpError: throw e
    if signal?.aborted: byStatus.aborted++; throw abortedError(url)
    if timedOut: byStatus.timeout++; throw timeoutError(url, timeoutMs)
    byStatus.network++; throw networkError(url, e)
  finally clearTimeout(timer)
```

  - `parseRetryAfter` accepts delta-seconds or an HTTP-date (`Date.parse(v) - Date.now()`, floored at 0). It returns null for anything else.
  - `raceAbort` and `abortableSleep` listen on `AbortSignal.any([signal])`, never on `signal` itself.
  - `stats` is one live object, mutated in place.
- [ ] **Step 4: Run it and confirm it passes.** Same command, then `npx tsc --noEmit` and `npx vitest run`.
- [ ] **Step 5: Commit.** `git add src/scrapers/shared/http` and `git commit -m "feat(scrapers): HttpClient with timeouts, retry, per-host limit and typed errors"`

---

### Task 3: Replay HTTP client (test helper)

**Files:**
- Create: `src/__tests__/helpers/replay-http.ts`
- Test: `src/__tests__/helpers/replay-http.test.ts` (matched by `src/**/__tests__/**/*.test.ts`)

**Interfaces:**
- Consumes: `HttpClient`, `HttpStats`, `HttpRequestOptions` (Task 2), `httpStatusError`, `contentTypeError`, `abortedError`.
- Produces: README §3 `createReplayHttpClient(routes): HttpClient & { calls: string[] }`.
  - Exact-URL lookup. `status` defaults to 200 and `contentType` to `"application/json"`.
  - An `Error` route is thrown as-is. Tests of the Cloudflare path route `httpStatusError(url, 403, "text/html", "", "challenge")`, because a route has no headers, so a routed 403 never carries `cfMitigated`.
  - An unrouted URL throws `Error(\`replay-http: no route for ${url}\`)`.
  - Non-2xx throws `httpStatusError` and a non-JSON or unparsable `getJson` throws `contentTypeError`, so the messages match the real client exactly.
  - An aborted `opts.signal` throws `abortedError` and is not recorded in `calls`. Everything else is recorded in order.
  - `stats` is updated like the real client. `retries` stays 0. Timeouts, retries and headers are ignored.

- [ ] **Step 1: Write the failing test**

```ts
const L = "https://api.test/list", D = "https://api.test/e/1";
it("replays routes with the real client's error texts and records calls", async () => {
  const boom = new HttpError("timeout", D, null, `fetch timeout 10000ms ${D}`);
  const r = createReplayHttpClient({ [L]: { body: '{"events":[1]}' }, [D]: boom, "https://api.test/404": { status: 404, body: "nope", contentType: "text/html" },
    "https://api.test/html": { body: "<p>", contentType: "text/html" } });
  expect(await r.getJson(L)).toEqual({ events: [1] });
  expect(await r.getText(L)).toBe('{"events":[1]}');
  await expect(r.getJson(D)).rejects.toBe(boom);
  await expect(r.getJson("https://api.test/404")).rejects.toMatchObject({ kind: "http", status: 404, message: "fetch HTTP 404 https://api.test/404", bodySnippet: "nope" });
  await expect(r.getJson("https://api.test/html")).rejects.toThrow("fetch non-JSON text/html https://api.test/html");
  await expect(r.getJson("https://api.test/none")).rejects.toThrow("replay-http: no route for https://api.test/none");
  await expect(r.getJson(L, { signal: AbortSignal.abort() })).rejects.toThrow(`fetch aborted ${L}`);
  expect(r.calls).toEqual([L, L, D, "https://api.test/404", "https://api.test/html", "https://api.test/none"]);
  expect(r.stats).toEqual({ requests: 6, retries: 0, failures: 5, bytes: 35, byStatus: { "200": 3, "404": 1 } });
});
```
  Notes on the expected values:
  - `bytes` counts the bodies of the four routed responses: 14 + 14 + 4 + 3 = 35.
  - `requests` counts every recorded call. An Error route and an unrouted URL count as requests but add no status.

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run src/__tests__/helpers/replay-http.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `createReplayHttpClient`** as specified above. There is no network and there are no timers.
- [ ] **Step 4: Run it and confirm it passes.** Then type-check the helper, which `tsc` excludes: `npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule src/__tests__/helpers/replay-http.ts`. Expected: exit 0. Then `npx tsc --noEmit` and `npx vitest run`.
- [ ] **Step 5: Commit.** `git add src/__tests__/helpers/replay-http.ts src/__tests__/helpers/replay-http.test.ts` and `git commit -m "test: replay HttpClient helper for offline transport tests"`

---

### Task 4: `fetchDetailsSkippingFailures`

**Files:**
- Create: `src/scrapers/shared/detail-fetch.ts`
- Test: `src/scrapers/shared/__tests__/detail-fetch.test.ts`

**Interfaces:**
- Consumes: `mapLimit`, `ScrapeBudget`, `createScrapeBudget` (Task 1). Tests also use `httpStatusError` (Task 2).
- Produces: README §3 `MAX_SKIPPED_DETAIL_RATIO = 0.5`, `DetailFetchOutcome<E, D>`, `fetchDetailsSkippingFailures(events, idOf, fetchDetail, { concurrency, budget })`.
  - `fetched` and `skipped` are both in **input order**, whatever order the details complete in (coordinator refinement to §3). Plans 03–05 rely on this for byte-identical parity output.
  - `error` is `e.message` for an Error, else `String(e)`.
  - Each item runs `budget.checkpoint()` before `fetchDetail(e, budget.signal)`. Events not started after the budget aborted are therefore skipped with the `BudgetExceededError` text, and `fetchDetail` is never called for them.

- [ ] **Step 1: Write the failing test**

```ts
const ev = (id: string) => ({ id });
it("keeps order and skips failures with their message", async () => {
  const out = await fetchDetailsSkippingFailures([ev("a"), ev("b"), ev("c")], (e) => e.id,
    async (e) => { if (e.id === "b") throw httpStatusError("https://api.test/b", 503, "text/html", ""); return e.id.toUpperCase(); },
    { concurrency: 2, budget: createScrapeBudget(60_000) });
  expect(out).toEqual({ fetched: [{ event: ev("a"), detail: "A" }, { event: ev("c"), detail: "C" }], skipped: [{ id: "b", error: "fetch HTTP 503 https://api.test/b" }] });
});
it("returns fetched and skipped in input order regardless of completion order", async () => {
  const delay = { a: 30, b: 25, c: 20, d: 0, e: 5 } as const;   // completion order: d, e, c, b, a
  const out = await fetchDetailsSkippingFailures(["a", "b", "c", "d", "e"].map(ev), (e) => e.id, async (e) => {
    await new Promise((r) => setTimeout(r, delay[e.id as keyof typeof delay]));
    if (e.id === "b" || e.id === "d") throw new Error(`fail ${e.id}`); return e.id; }, { concurrency: 5, budget: createScrapeBudget(60_000) });
  expect(out.fetched.map((f) => f.detail)).toEqual(["a", "c", "e"]);                        // completed e, c, a
  expect(out.skipped).toEqual([{ id: "b", error: "fail b" }, { id: "d", error: "fail d" }]); // completed d, b
});
it("passes budget.signal and respects concurrency", async () => {
  const budget = createScrapeBudget(60_000); let active = 0, peak = 0; const signals: AbortSignal[] = [];
  await fetchDetailsSkippingFailures(["1", "2", "3", "4", "5"].map(ev), (e) => e.id, async (_e, s) => {
    signals.push(s); active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return 1; }, { concurrency: 2, budget });
  expect(peak).toBe(2); expect(signals.every((s) => s === budget.signal)).toBe(true);
});
it("an exhausted budget skips the remaining events", async () => {
  const p = new AbortController(); p.abort(new Error("shutdown")); const fetchDetail = vi.fn(async () => 1);
  const out = await fetchDetailsSkippingFailures([ev("a"), ev("b")], (e) => e.id, fetchDetail, { concurrency: 4, budget: createScrapeBudget(60_000, p.signal) });
  expect(fetchDetail).not.toHaveBeenCalled();
  expect(out).toEqual({ fetched: [], skipped: [{ id: "a", error: "scrape aborted: shutdown" }, { id: "b", error: "scrape aborted: shutdown" }] });
});
it("stringifies non-Error rejections", async () => {
  const out = await fetchDetailsSkippingFailures([ev("a")], (e) => e.id, () => Promise.reject("boom"), { concurrency: 1, budget: createScrapeBudget(1000) });
  expect(out.skipped).toEqual([{ id: "a", error: "boom" }]); expect(MAX_SKIPPED_DETAIL_RATIO).toBe(0.5);
});
```

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run src/scrapers/shared/__tests__/detail-fetch.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `fetchDetailsSkippingFailures`** as `mapLimit(events, concurrency, (e) => { budget.checkpoint(); return fetchDetail(e, budget.signal); })`, then split the settled results into `fetched` and `skipped`.
- [ ] **Step 4: Run it and confirm it passes.** Same command, then `npx tsc --noEmit` and `npx vitest run`.
- [ ] **Step 5: Commit.** `git add src/scrapers/shared/detail-fetch.ts src/scrapers/shared/__tests__/detail-fetch.test.ts` and `git commit -m "feat(scrapers): fetch details with skip-on-failure instead of listing fallback"`

---

### Task 5: `FullOfferScraper` contract and `HttpScraper`

**Files:**
- Create: `src/scrapers/shared/scraper-contract.ts`, `src/scrapers/base/http-scraper.ts`
- Test: `src/scrapers/base/__tests__/http-scraper.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4. `FullMatchOffer` (`src/types/full-offer.ts:58-75`), `FullOfferScraperResult` (`:99-114`; its optional `diagnostics` stays unset here). `PolishBookmaker` (`src/config/index.ts:24`).
- Produces: README §3 `FullOfferScraper`, `DEFAULT_MAX_DURATION_MS`, `HttpScraper`. In addition, in `scraper-contract.ts` (perf-smoke and plan 07 read transport counters through it):
  ```ts
  export interface TransportStats { http?: HttpStats; ws?: { framesReceived: number; bytesReceived: number } }
  export interface TransportStatsSource { transportStats(): TransportStats }   // returns copies, never live objects
  export function hasTransportStats(s: FullOfferScraper): s is FullOfferScraper & TransportStatsSource;
  // HttpScraper implements TransportStatsSource: transportStats() => ({ http: { ...this.http.stats, byStatus: { ...this.http.stats.byStatus } } })
  ```
  - **Counters are cumulative and monotonic since the scraper instance was created** (README §3): `HttpScraper` creates or receives its `HttpClient` once, in the constructor, and never resets it. Consumers diff two readings around a unit of work (Task 9 `diffTransportStats`). pzbuk's module-private `type TransportStats` (`pzbuk/index.ts:45`, per-run frame diagnostics read by `scripts/pzbuk-smoke.ts:78`) is unrelated, not exported, and renamed by plan 05c; this plan does not touch it.
  - `HttpScraper` declares `readonly transport = "http" as const`, the property plan 07's `DeclaresTransport` reads (README §3), so job classification never depends on file layout. Plan 02 defines no interface for it; the property is structural.
- `scrapeFullOffer` template, in order. `duration = Date.now() - start` is set on every result.
  1. If `!isLeagueSupported(league)`, return `{ success:false, matches:[], error: \`Unknown league: ${league}\` }`. This is the wording of `playwright-base.ts:360-366`.
  2. `budget ??= createScrapeBudget(DEFAULT_MAX_DURATION_MS.http)`, then `budget.checkpoint()`, then `fetchFullOffer(league, budget)`.
  3. Anything thrown in step 2 gives `{ success:false, matches:[], error: e instanceof Error ? e.message : String(e) }`. Also `console.error(\`[${bookmaker}] Full offer scraper error: ${error}\`)`, the same line as `playwright-base.ts:302`.
  4. With `n = skipped.length` and `m = matches.length + n`: if `n > 0`, `error = \`${n} of ${m} details failed | ${skipped[0].error}\`` (the observability `" | "` separator), logged with `console.warn` as `[${bookmaker}] ${error}`.
     - If `n / m > MAX_SKIPPED_DETAIL_RATIO`, return `{ success:false, matches:[], error }`.
     - Otherwise return `{ success:true, matches, error }`.
  5. With no skips, return `{ success:true, matches }` with no `error` key. 0 matches and 0 skips is an empty success (README §3 "Empty listing rule": observability classifies it `empty`, which the owner's A6 counts as a failure; a malformed envelope is a thrown error, step 3).

- [ ] **Step 1: Write the failing test**

```ts
const offer = (id: string): FullMatchOffer => ({ matchId: id, bookmaker: "fortuna", homeTeam: "Arsenal", awayTeam: "Hull City",
  eventUrl: `https://x.test/${id}`, markets: [], scrapedAt: new Date(0) });
type Impl = (league: string, budget: ScrapeBudget, http: HttpClient) => Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }>;
class TestScraper extends HttpScraper {
  readonly bookmaker = "fortuna" as const;
  constructor(http: HttpClient, private readonly impl: Impl) { super(http); }
  protected isLeagueSupported(l: string) { return l === "premier-league"; }
  protected fetchFullOffer(l: string, b: ScrapeBudget) { return this.impl(l, b, this.http); }
}
const skip = (n: number, error: string) => Array.from({ length: n }, (_, i) => ({ id: String(i), error }));
const run = (impl: Impl, budget?: ScrapeBudget, http: HttpClient = createReplayHttpClient({})) => new TestScraper(http, impl).scrapeFullOffer("premier-league", budget);

it("unknown league", async () => {
  const impl = vi.fn();
  expect(await new TestScraper(createReplayHttpClient({}), impl).scrapeFullOffer("la-liga"))
    .toMatchObject({ success: false, bookmaker: "fortuna", league: "la-liga", matches: [], error: "Unknown league: la-liga", duration: expect.any(Number) });
  expect(impl).not.toHaveBeenCalled();
});
it("a listing HttpError becomes the error text", async () => {
  const http = createReplayHttpClient({ "https://api.test/list": { status: 503, body: "" } });
  expect(await run(async (_l, _b, h) => { await h.getJson("https://api.test/list"); return { matches: [], skipped: [] }; }, undefined, http))
    .toMatchObject({ success: false, matches: [], error: "fetch HTTP 503 https://api.test/list" });
});
it("fails when more than half the details failed", async () =>
  expect(await run(async () => ({ matches: [offer("a"), offer("b")], skipped: skip(3, "fetch HTTP 500 https://api.test/e/1") })))
    .toMatchObject({ success: false, matches: [], error: "3 of 5 details failed | fetch HTTP 500 https://api.test/e/1" }));
it("succeeds at exactly half, keeping the cause", async () => {
  const r = await run(async () => ({ matches: [offer("a"), offer("b")], skipped: skip(2, "fetch timeout 10000ms https://api.test/e/1") }));
  expect(r).toMatchObject({ success: true, error: "2 of 4 details failed | fetch timeout 10000ms https://api.test/e/1" }); expect(r.matches).toHaveLength(2);
});
it("clean success has no error key; empty listing is an empty success", async () => {
  const r = await run(async () => ({ matches: [offer("a")], skipped: [] }));
  expect(r).toMatchObject({ success: true, league: "premier-league" }); expect("error" in r).toBe(false);
  expect(await run(async () => ({ matches: [], skipped: [] }))).toMatchObject({ success: true, matches: [] });
});
it("default budget is DEFAULT_MAX_DURATION_MS.http; a given budget is forwarded", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(0);
  let seen!: ScrapeBudget; await run(async (_l, b) => { seen = b; return { matches: [], skipped: [] }; });
  expect(seen.deadline).toBe(120_000); expect(DEFAULT_MAX_DURATION_MS).toEqual({ http: 120_000, websocket: 120_000, browser: 240_000 });
  const mine = createScrapeBudget(5_000); await run(async (_l, b) => { seen = b; return { matches: [], skipped: [] }; }, mine);
  expect(seen).toBe(mine); vi.useRealTimers();
});
it("budget exhaustion and parser crashes surface their message", async () => {
  expect((await run(async () => { throw new BudgetExceededError("scrape budget of 120000ms exceeded"); })).error).toBe("scrape budget of 120000ms exceeded");
  expect((await run(async () => { throw new TypeError("x is undefined"); })).error).toBe("x is undefined");
});
it("transportStats returns a cumulative copy of the client stats; cleanup is a no-op", async () => {
  const http = createReplayHttpClient({ "https://api.test/l": { body: "{}" } }); const s = new TestScraper(http, async (_l, _b, h) => { await h.getJson("https://api.test/l"); return { matches: [], skipped: [] }; });
  await s.scrapeFullOffer("premier-league");
  expect(hasTransportStats(s)).toBe(true); expect(s.transportStats()).toEqual({ http: http.stats }); expect(s.transportStats().http).not.toBe(http.stats);
  await s.scrapeFullOffer("premier-league");
  expect(s.transportStats().http!.requests).toBe(2);   // never reset between scrapes (README §3)
  await expect(s.cleanup()).resolves.toBeUndefined();
});
it("declares the http transport for plan 07's job classification", () =>
  expect(new TestScraper(createReplayHttpClient({}), async () => ({ matches: [], skipped: [] })).transport).toBe("http"));
```

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run src/scrapers/base/__tests__/http-scraper.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement `scraper-contract.ts` and `HttpScraper`** as specified above. `scraper-contract.ts` uses type-only imports, so there is no runtime cycle. `hasTransportStats` checks `typeof (s as Partial<TransportStatsSource>).transportStats === "function"`.
- [ ] **Step 4: Run it and confirm it passes.** Same command, then `npx tsc --noEmit` and `npx vitest run`.
- [ ] **Step 5: Commit.** `git add src/scrapers/shared/scraper-contract.ts src/scrapers/base/http-scraper.ts src/scrapers/base/__tests__/http-scraper.test.ts` and `git commit -m "feat(scrapers): FullOfferScraper contract and HttpScraper template"`

---

### Task 6: Aggregator typed on `FullOfferScraper`; caller-less legacy runners deleted

**Files** (line numbers on the future base, Observation 2):
- Modify `src/scrapers/aggregator.ts`:
  - `:9`: delete the legacy type import (`ScraperResult`, `RawScrapedOdds`).
  - `:11`: replace `import { PlaywrightScraper } from "./base/playwright-base.js";` with `import type { FullOfferScraper } from "./shared/scraper-contract.js";`.
  - `:33`: `const SCRAPERS: Record<PolishBookmaker, FullOfferScraper> = {`.
  - Delete `:50-188`: `AggregatedResult`, `runAllScrapers`, `runSingleScraper` and their doc comments. They have no caller in `src/` or `scripts/` (`git grep -n "runAllScrapers\|runSingleScraper\|AggregatedResult\b" -- src scripts` lists only `aggregator.ts`; `FullOfferAggregatedResult` is a different name and stays).
  - `:193`: `export function getScraper(bookmaker: PolishBookmaker): FullOfferScraper | undefined`. Kept: `scripts/smoke-bookmaker.ts:24, 93, 175` uses it.
  - `uuidv4`, `CONFIG`, `browserPool`, `runFullOfferForBookmaker` (`:261-333`) and `runAllFullOfferScrapers` (`:339`) are untouched; the last two call only `scrapeFullOffer`/`cleanup`.
- Modify `src/scrapers/base/playwright-base.ts`: after `:15` add `import type { FullOfferScraper } from "../shared/scraper-contract.js";` and `import type { ScrapeBudget } from "../shared/budget.js";`; `:39` `export abstract class PlaywrightScraper implements FullOfferScraper {`; `:84` `scrapeFullOffer(league: string, _budget?: ScrapeBudget): Promise<FullOfferScraperResult> {`. The legacy abstract members (`:47`, `:66`, `:71`, `:76`) stay until plan 10 Part B.
- Modify `src/scripts/analyze-bookmaker-markets.ts:36` (import) and `:41`: the second `Record<PolishBookmaker, PlaywrightScraper>` map in `src/` (`git grep -n "Record<PolishBookmaker, PlaywrightScraper>" -- src`). Retype it as `Record<PolishBookmaker, FullOfferScraper>`; it only calls `scrapeFullOffer`. Without this, the first migration plan (03–05) to merge fails `tsc` on that file.
- Test: `src/scrapers/__tests__/aggregator-contract.test.ts`

**Interfaces:**
- Consumes: `FullOfferScraper`, `ScrapeBudget`.
- Produces: `SCRAPERS: Record<PolishBookmaker, FullOfferScraper>`; `getScraper(bookmaker): FullOfferScraper | undefined`. `runAllScrapers`, `runSingleScraper` and `AggregatedResult` no longer exist (plan 10 Task 13's guard test then passes without an aggregator edit).
- Observability's tests that mock the bookmakers index with plain `{ scrapeFullOffer, cleanup }` objects (`aggregator-db-down.test.ts:16-60`, `aggregator-outcomes.test.ts`) keep working; this typing accepts them.

- [ ] **Step 1: Write the failing test**

```ts
const h = vi.hoisted(() => {
  const bms = ["sts", "fortuna", "betclic", "superbet", "lvbet", "fuksiarz", "betfan", "totalbet", "forbet", "etoto", "betters", "lebull", "betcris", "pzbuk"] as const;
  const scrapers = Object.fromEntries(bms.map((bm) => [bm, { bookmaker: bm, cleanup: vi.fn(async () => {}),
    scrapeFullOffer: vi.fn(async (league: string) => ({ success: true, bookmaker: bm, league, matches: [] })) }]));
  return { scrapers };
});
vi.mock("../bookmakers/index.js", async () => Object.fromEntries(Object.entries(h.scrapers).map(([bm, s]) => [`${bm}Scraper`, s])));
vi.mock("../../services/scrape-helpers.js", async () => ({ normalizeAndSaveMatches: vi.fn() }));

it("getScraper returns any FullOfferScraper", () => expect(getScraper("lvbet")).toBe(h.scrapers.lvbet));
it("the full-offer path runs a scraper that is not a PlaywrightScraper", async () => {
  const r = await runAllFullOfferScrapers("premier-league", ["fortuna"]);
  expect(h.scrapers.fortuna.scrapeFullOffer.mock.calls[0][0]).toBe("premier-league");
  expect(h.scrapers.fortuna.cleanup).toHaveBeenCalledTimes(1); expect(r.results.get("fortuna")?.success).toBe(true);
});
it("the aggregator no longer exports the caller-less legacy 1X2 runners", async () => {
  const mod: Record<string, unknown> = await import("../aggregator.js");
  expect(Object.keys(mod).filter((k) => ["runAllScrapers", "runSingleScraper"].includes(k))).toEqual([]);
  expect(typeof mod.getScraper).toBe("function");
});
```

- [ ] **Step 2: Run it and confirm it fails.** `$H npx vitest run src/scrapers/__tests__/aggregator-contract.test.ts`. Expected: FAIL only in the last test (`["runAllScrapers", "runSingleScraper"]`); the first two pass on today's code, and `tsc` is the proof for the typing.
- [ ] **Step 3: Implement** the hunks listed under Files.
  - `PlaywrightScraper` keeps every existing member.
  - Subclasses' `scrapeFullOffer(league)` overrides stay valid, because fewer parameters are assignable.
  - `tsc` now proves that all 14 instances satisfy `FullOfferScraper`, through the `SCRAPERS` literal.
- [ ] **Step 4: Run it and confirm it passes.** Same command, then `$H npx tsc --noEmit` (the structural proof), the standalone scripts `tsc` command on `scripts/smoke-bookmaker.ts` (it now receives a `FullOfferScraper`), and `$H npx vitest run`.
- [ ] **Step 5: Commit.** `git add src/scrapers/aggregator.ts src/scrapers/base/playwright-base.ts src/scripts/analyze-bookmaker-markets.ts src/scrapers/__tests__/aggregator-contract.test.ts` and `git commit -m "refactor(aggregator): type scrapers as FullOfferScraper, drop dead legacy runners"`

---

### Task 7: Transport override flag

**Files:**
- Create: `src/config/transport.ts`
- Modify: `.env.example` (append the documented variable after observability's `# Alerts` block, which now ends the file at `:25`)
- Test: `src/config/__tests__/transport.test.ts`

**Interfaces:**
- Produces: README §3 `TransportOverride`, `getTransportOverride(bookmaker, env = process.env)`.
  - It reads `SCRAPER_TRANSPORT_${bookmaker.toUpperCase()}`.
  - `value.trim().toLowerCase() === "browser"` returns `"browser"`.
  - Unset or empty returns `undefined`.
  - Any other value returns `undefined` and logs `console.warn(\`[transport] Ignoring SCRAPER_TRANSPORT_${BM}="${value}": only "browser" is recognised\`)`.
  - Where it is read follows README §3 "Rule: exactly ONE pick per bookmaker": either a `create<Brand>Scraper()` factory in the brand module or the export in `src/scrapers/bookmakers/index.ts`, never both, with **every** direct importer repointed to the picked instance (several bypass `bookmakers/index.ts`: `src/services/audit/bookmaker-registry.ts`, `scripts/<bm>-market-discovery.ts`, `scripts/<bm>-prep-audit.ts`, `src/scripts/analyze-bookmaker-markets.ts`, `scripts/test-scrapers.sh`) and a selection test pinning the pick. Plans 03, 04, 05c pick in `bookmakers/index.ts`; 05a and 05b in the brand module; plan 10 Task 18 lists each location and test and finally reduces this function to a stub returning `undefined` (the module stays: plan 07 and `perf-smoke` import it). This plan wires it nowhere.
  - totalbet, betters and lebull have no browser implementation, so no pick site reads their variable.

- [ ] **Step 1: Write the failing test**

```ts
it.each([["browser", "browser"], [" BROWSER ", "browser"], ["", undefined], [undefined, undefined]])("SCRAPER_TRANSPORT_LVBET=%j → %s", (v, out) =>
  expect(getTransportOverride("lvbet", v === undefined ? {} : { SCRAPER_TRANSPORT_LVBET: v })).toBe(out));
it("warns on an unknown value and ignores other bookmakers' variables", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(getTransportOverride("sts", { SCRAPER_TRANSPORT_STS: "http", SCRAPER_TRANSPORT_FORTUNA: "browser" })).toBeUndefined();
  expect(warn).toHaveBeenCalledWith('[transport] Ignoring SCRAPER_TRANSPORT_STS="http": only "browser" is recognised');
});
```

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run src/config/__tests__/transport.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `getTransportOverride`.** Import `PolishBookmaker` from `./index.js` as a type only, so importing this module never runs `dotenv`. Append to `.env.example`:
  ```
  # Per-bookmaker fallback to the old Playwright scraper (plans 03-05), e.g.:
  # SCRAPER_TRANSPORT_STS=browser
  ```
- [ ] **Step 4: Run it and confirm it passes.** Same command, then `npx tsc --noEmit` and `npx vitest run`.
- [ ] **Step 5: Commit.** `git add src/config/transport.ts src/config/__tests__/transport.test.ts .env.example` and `git commit -m "feat(config): per-bookmaker SCRAPER_TRANSPORT override"`

---

### Task 8: `WsSession` (declares `ws` and `@types/ws`; owner report before the commit)

**Files:**
- Modify: `package.json` (`"ws": "^8.19.0"` into `dependencies` `:23-38`, `"@types/ws": "^8.18.1"` into `devDependencies` `:39-49`, alphabetical), plus the root `packages[""]` block of `package-lock.json`. No `npm install`: both packages are already in the lockfile and in the symlinked `node_modules` (Observation 3).
- Create: `src/scrapers/shared/ws/ws-session.ts`
- Test: `src/scrapers/shared/ws/__tests__/ws-session.test.ts`

**Interfaces:**
- Consumes: `ScrapeBudget`, `createScrapeBudget`, `BudgetExceededError` (Task 1), `DEFAULT_USER_AGENT` (Task 2).
- Produces: README §3 `WsSessionOptions`, `WsSession`, `openWsSession(opts)` with the error texts `ws handshake HTTP ${status} ${url}`, `ws closed ${code} ${url}` and `ws timeout ${ms}ms ${url}`. One addition (a §3 addition): a connection error before the handshake rejects with `ws failed ${err.code ?? err.message} ${url}`, the same pattern as `fetch failed`.
- **Opening the session:**
  - Uses `import WebSocket from "ws"` with `{ headers: { "user-agent": DEFAULT_USER_AGENT, ...opts.headers }, perMessageDeflate: true }`.
  - `connectTimeoutMs` defaults to 10 000. Expiry terminates the socket and rejects with `ws timeout <ms>ms <url>`.
  - An already-aborted budget rejects with `BudgetExceededError` before connecting. An abort before `open` terminates the socket and rejects with the same error.
- **Frames:**
  - Each frame is passed to `reduce` as a Buffer with `isBinary`.
  - Frames that arrive while no `collect` is active are queued, and the next `collect` replays them first.
  - `stats` counts decoded bytes.
  - Only one `collect` may run at a time; a second concurrent call rejects with `Error("ws collect already active")`.
- **`collect` outcomes:**
  - `done(state)` returning true resolves `{ state, timedOut:false }`. Frames left in the queue stay queued.
  - On timeout it resolves `{ state, timedOut:true }` and leaves the socket open.
  - A socket close rejects with `ws closed <code> <url>`.
  - A budget abort terminates the socket and rejects with `BudgetExceededError` (`budget.checkpoint()` semantics).
  - A throw from `reduce` or `done` rejects with that error.
- **`send` and `close`:**
  - `send` on a closed socket throws `ws closed <code> <url>`.
  - `close()` sends close 1000 and resolves on `close`, or terminates after 1000 ms. It is idempotent and removes the budget listener, which sits on `AbortSignal.any([budget.signal])`.

- [ ] **Step 1: Write the failing test** (real timers; `WebSocketServer({ port: 0, host: "127.0.0.1", perMessageDeflate: { threshold: 0 } })` per test, closed in `afterEach`)

```ts
const budget = () => createScrapeBudget(60_000);
it("rejects with the handshake status", async () => { // server: verifyClient: (_i, cb) => cb(false, 403)
  await expect(openWsSession({ url: `ws://127.0.0.1:${port}/sbk`, budget: budget() })).rejects.toThrow(`ws handshake HTTP 403 ws://127.0.0.1:${port}/sbk`);
});
it("rejects with the connection error code", async () => { // port of a just-closed net server
  await expect(openWsSession({ url: `ws://127.0.0.1:${dead}/`, budget: budget() })).rejects.toThrow(`ws failed ECONNREFUSED ws://127.0.0.1:${dead}/`);
});
it("times out a handshake that never answers", async () => { // net.createServer(() => {}) that never upgrades
  await expect(openWsSession({ url: `ws://127.0.0.1:${silent}/`, budget: budget(), connectTimeoutMs: 100 })).rejects.toThrow(`ws timeout 100ms ws://127.0.0.1:${silent}/`);
});
it("never connects with an aborted budget", async () => {
  const p = new AbortController(); p.abort(new Error("shutdown"));
  await expect(openWsSession({ url, budget: createScrapeBudget(1000, p.signal) })).rejects.toBeInstanceOf(BudgetExceededError);
  expect(connections).toBe(0);
});
it("sends headers, offers permessage-deflate and decodes a compressed frame", async () => { // server sends Buffer of 100_000 "z" on connection
  const s = await openWsSession({ url, budget: budget(), headers: { Origin: "https://www.sts.pl" } });
  const { state } = await s.collect(0, (n, f) => n + f.length, (n) => n >= 100_000, 2000);
  expect(state).toBe(100_000);
  expect(seenHeaders).toMatchObject({ origin: "https://www.sts.pl", "user-agent": DEFAULT_USER_AGENT });
  expect(seenHeaders["sec-websocket-extensions"]).toContain("permessage-deflate");
  expect(s.stats).toEqual({ framesReceived: 1, bytesReceived: 100_000 }); await s.close(); await s.close();
});
it("collects until done, including frames sent before collect", async () => { // server: send "hello" on connection; on "sub" send "a","b","c"
  const s = await openWsSession({ url, budget: budget() }); await new Promise((r) => setTimeout(r, 30)); s.send("sub");
  expect(await s.collect<string[]>([], (st, f) => [...st, f.toString()], (st) => st.includes("c"), 2000)).toEqual({ state: ["hello", "a", "b", "c"], timedOut: false });
});
it("timeout returns partial state and keeps the socket open", async () => { // server: send "a" on connection; echo "ping" back as "pong"
  const s = await openWsSession({ url, budget: budget() });
  expect(await s.collect<string[]>([], (st, f) => [...st, f.toString()], () => false, 100)).toEqual({ state: ["a"], timedOut: true });
  s.send("ping"); expect((await s.collect("", (_s, f) => f.toString(), (x) => x === "pong", 1000)).state).toBe("pong");
});
it("budget abort closes the socket and rejects the collect", async () => {
  const p = new AbortController(); const s = await openWsSession({ url, budget: createScrapeBudget(60_000, p.signal) });
  const c = s.collect(0, (n) => n + 1, () => false, 10_000); p.abort(new Error("shutdown"));
  await expect(c).rejects.toThrow(new BudgetExceededError("scrape aborted: shutdown"));
  await vi.waitFor(() => expect(serverClosed).toBe(true), { timeout: 1000 });
});
it("a server close rejects the collect", async () => { // server: sock.close(4001, "bye") after 20 ms
  const s = await openWsSession({ url, budget: budget() });
  await expect(s.collect(0, (n) => n, () => false, 2000)).rejects.toThrow(`ws closed 4001 ${url}`);
});
```

- [ ] **Step 2: Run it and confirm it fails.** `$H npx vitest run src/scrapers/shared/ws/__tests__/ws-session.test.ts`. Expected: FAIL, `ws-session.js` not found. `ws` itself already resolves (hoisted 8.19.0 in the symlinked `node_modules`); do not install anything.
- [ ] **Step 3: Implement `openWsSession`** as specified above. Handshake failure:
  - Listen to `unexpected-response`: reject with the status, then `ws.terminate()`.
  - The `error` event before `open` gives `ws failed …`. Ignore it when the promise has already settled.
- [ ] **Step 4: Run it and confirm it passes.** Same command, then `$H npx tsc --noEmit` and `$H npx vitest run`.
- [ ] **Step 5: Declare the dependency.** Add the two `package.json` entries (Files). Then update only the lockfile's root block: `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` (it never touches `node_modules`). If it wants the network or rewrites more than `packages[""]`, discard that (`git checkout -- package-lock.json`) and add the two entries to `packages[""].dependencies` / `.devDependencies` by hand. Check: `git diff --stat package-lock.json` shows a handful of lines, and `npm ls ws @types/ws` (read-only) lists `ws@8.19.0` and `@types/ws@8.18.1` at top level.
- [ ] **Step 6: STOP and report the dependency to the owner** (EXECUTION workspace rule: "never add a dependency without stopping to report it"; README §6's allowance for `ws`/`@types/ws` does not replace that). Report: the two entries, that both versions were already resolved in the lockfile through `@supabase/realtime-js`, the lockfile diff, and that nothing was installed. Wait for the owner's yes. If the answer is no, commit the task without the `package.json`/lockfile hunks (the code still resolves `ws` transitively) and record that plans 05a–05c must not land before the dependency is declared.
- [ ] **Step 7: Commit** (after the yes). `git add package.json package-lock.json src/scrapers/shared/ws` and `git commit -m "feat(scrapers): WsSession over ws with budget-bound collect"`

---

### Task 9: `/proc` sampler and perf summary helpers

**Files:**
- Create: `src/utils/proc-sampler.ts`, `src/utils/perf-summary.ts`
- Test: `src/utils/__tests__/proc-sampler.test.ts`, `src/utils/__tests__/perf-summary.test.ts`

**Interfaces:**
- Consumes: `FullOfferScraperResult`, `TransportStats` (types; Task 5).
- Produces:
  ```ts
  // proc-sampler.ts (Linux /proc; mirrors evidence/profiling/sampler.py)
  export const CLOCK_TICKS_PER_S = 100;
  export interface ProcTree { rootRssBytes: number; chromium: Array<{ pid: number; rssBytes: number; cpuTicks: number }> } // chromium sorted by pid
  export function readProcessTree(rootPid: number, procRoot?: string): Promise<ProcTree>;   // procRoot default "/proc"
  export interface ProcessSamplerSummary { samples: number; nodePeakRssMb: number; chromiumPeakRssMb: number; chromiumPeakProcesses: number; chromiumProcessesEver: number; chromiumCpuS: number }
  export function createProcSummary(): { add(t: ProcTree): void; summary(): ProcessSamplerSummary };
  export function startProcessSampler(opts: { rootPid: number; intervalMs: number; procRoot?: string }): { stop(): Promise<ProcessSamplerSummary> };
  // perf-summary.ts
  export interface PerfCounts { matches: number; markets: number; selections: number }
  export function countOffer(result: Pick<FullOfferScraperResult, "matches"> | null): PerfCounts;
  export interface PerfParity { matchesEqual: boolean; marketsDeltaPct: number | null; selectionsDeltaPct: number | null; pass: boolean }
  export function comparePerfParity(baseline: PerfCounts, current: PerfCounts, tolerancePct?: number): PerfParity; // default 2
  export function diffTransportStats(before: TransportStats, after: TransportStats): TransportStats;
  // field-wise after - before for http (requests, retries, failures, bytes, every byStatus key; keys absent before count from 0)
  // and ws (framesReceived, bytesReceived); a side present only in `after` is copied. README §3: counters are cumulative.
  ```
- `/proc` parsing and accounting:
  - `stat`: `comm` sits between the first `(` and the **last** `)`. The fields after `") "` are state, ppid, … utime (index 11) and stime (index 12).
  - RSS comes from `status` `VmRSS: <kB>`.
  - Chromium means a descendant of `rootPid` whose comm contains `chrome` or `headless`.
  - Pids that vanish mid-read are skipped.
- Summary and parity math:
  - `chromiumCpuS` is the sum over every pid ever seen of its last-seen ticks, divided by 100, rounded to 0.01.
  - MB values are `Math.round(bytes / 1048576)`.
  - The delta is `round2((cur - base) / base * 100)`, or `null` when the baseline is 0.
  - `pass = baseline.matches > 0 && matchesEqual && |Δmarkets| ≤ tol && |Δselections| ≤ tol`.

- [ ] **Step 1: Write the failing tests**

```ts
// proc-sampler.test.ts: fake /proc under mkdtempSync(join(tmpdir(), "proc-"))
// writeProc(pid, comm, ppid, utime, stime, rssKb) writes `${pid} (${comm}) S ${ppid} 1 1 0 -1 4194560 0 0 0 0 ${utime} ${stime} 0 0` to <pid>/stat and `VmRSS:\t${rssKb} kB` to <pid>/status
// tree: 100 node(ppid 1, 300000 kB) · 200 headless_shell(100) · 201 headless_shell(200) · 202 chrome_crashpad(200) · 300 chrome(1, not a descendant)
//       · 400 python3(100) · 500 "Web Content (x)"(1) · 600 = empty dir (vanished) · "self" = non-numeric
it("reads the root RSS and the chromium descendants only", async () => {
  const t = await readProcessTree(100, root);
  expect(t.rootRssBytes).toBe(300000 * 1024);
  expect(t.chromium.map((c) => c.pid)).toEqual([200, 201, 202]);
  expect(t.chromium[0]).toEqual({ pid: 200, rssBytes: 102400 * 1024, cpuTicks: 50 });
});
it("summarises peaks, process counts and last-seen CPU", () => {
  const s = createProcSummary(); const MB = 1048576;
  s.add({ rootRssBytes: 200 * MB, chromium: [{ pid: 200, rssBytes: 100 * MB, cpuTicks: 50 }, { pid: 201, rssBytes: 50 * MB, cpuTicks: 20 }] });
  s.add({ rootRssBytes: 300 * MB, chromium: [{ pid: 200, rssBytes: 120 * MB, cpuTicks: 80 }, { pid: 203, rssBytes: 10 * MB, cpuTicks: 5 }] });
  expect(s.summary()).toEqual({ samples: 2, nodePeakRssMb: 300, chromiumPeakRssMb: 150, chromiumPeakProcesses: 2, chromiumProcessesEver: 3, chromiumCpuS: 1.05 });
});
it("startProcessSampler samples until stop and takes a final sample", async () => {
  const sampler = startProcessSampler({ rootPid: 100, intervalMs: 10, procRoot: root });
  await new Promise((r) => setTimeout(r, 35));
  const s = await sampler.stop(); expect(s.samples).toBeGreaterThanOrEqual(3); expect(s.chromiumProcessesEver).toBe(3);
});
// perf-summary.test.ts
it("counts matches, markets and selections", () =>
  expect(countOffer({ matches: [{ markets: [{ selections: [{}, {}] }, { selections: [{}] }] }, { markets: [] }] as never })).toEqual({ matches: 2, markets: 2, selections: 3 }));
it("parity passes within ±2 % with equal matches", () =>
  expect(comparePerfParity({ matches: 19, markets: 12345, selections: 22846 }, { matches: 19, markets: 12400, selections: 22900 }))
    .toEqual({ matchesEqual: true, marketsDeltaPct: 0.45, selectionsDeltaPct: 0.24, pass: true }));
it("parity fails on a match difference, a 3 % drop or an empty baseline", () => {
  expect(comparePerfParity({ matches: 19, markets: 100, selections: 100 }, { matches: 18, markets: 100, selections: 100 }).pass).toBe(false);
  expect(comparePerfParity({ matches: 19, markets: 100, selections: 100 }, { matches: 19, markets: 97, selections: 100 })).toMatchObject({ marketsDeltaPct: -3, pass: false });
  expect(comparePerfParity({ matches: 0, markets: 0, selections: 0 }, { matches: 0, markets: 0, selections: 0 })).toEqual({ matchesEqual: true, marketsDeltaPct: null, selectionsDeltaPct: null, pass: false });
});
it("diffTransportStats subtracts cumulative counters", () =>
  expect(diffTransportStats(
    { http: { requests: 3, retries: 1, failures: 0, bytes: 900, byStatus: { "200": 3 } } },
    { http: { requests: 5, retries: 1, failures: 1, bytes: 1500, byStatus: { "200": 4, timeout: 1 } }, ws: { framesReceived: 2, bytesReceived: 100 } }))
    .toEqual({ http: { requests: 2, retries: 0, failures: 1, bytes: 600, byStatus: { "200": 1, timeout: 1 } }, ws: { framesReceived: 2, bytesReceived: 100 } }));
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/utils/__tests__/proc-sampler.test.ts src/utils/__tests__/perf-summary.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement.**
  - `readProcessTree` reads all numeric `<procRoot>/<pid>/stat` with `fs.promises` in parallel, builds a ppid→children map and walks it from `rootPid`.
  - `startProcessSampler` chains global `setTimeout(intervalMs)` after each finished sample, never `setInterval`, so samples cannot overlap.
  - `stop()` waits for the in-flight sample, takes one last sample and returns `summary()`.
- [ ] **Step 4: Run them and confirm they pass.** Same command, then `npx tsc --noEmit` and `npx vitest run`.
- [ ] **Step 5: Commit.** `git add src/utils/proc-sampler.ts src/utils/perf-summary.ts src/utils/__tests__/proc-sampler.test.ts src/utils/__tests__/perf-summary.test.ts` and `git commit -m "feat(utils): /proc process-tree sampler and perf parity helpers"`

---

### Task 10: `scripts/perf-smoke.ts` on top of observability's `scripts/smoke-bookmaker.ts`

**Files:**
- Modify: `scripts/smoke-bookmaker.ts` (observability Task 9): export its dry-scrape parts and run `main()` only as the entry point. Its CLI, output and exit codes stay byte-identical.
- Create: `scripts/perf-smoke.ts`

**Interfaces:**
- `scripts/smoke-bookmaker.ts` (refactor only, no behaviour change when run directly):
  ```ts
  export interface SmokeResult { /* :38-56, unchanged, now exported */ }
  export function isBookmaker(bm: string): bm is PolishBookmaker;                       // :79-81, now exported
  export async function scrapeOnce(bookmaker: PolishBookmaker, league: string): Promise<FullOfferScraperResult>;
  //   today's :93-100: getScraper(bookmaker)!.scrapeFullOffer(league); a throw becomes { success:false, …, error } (the aggregator's rule)
  export function summarizeDryRun(bookmaker: PolishBookmaker, league: string, scrape: FullOfferScraperResult, startedAt: number):
    { result: SmokeResult; code: number };                                              // today's :102-140 (normalization metrics, exit 0/1)
  //   dryRun(bm, league, t0) becomes summarizeDryRun(bm, league, await scrapeOnce(bm, league), t0)
  // :194-201: main().then(...) runs only when this file is the entry point:
  //   if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { main().then(…) }
  ```
- Consumes: the above; `startProcessSampler`, `countOffer`, `comparePerfParity`, `diffTransportStats` (Task 9); `getTransportOverride` (Task 7); `hasTransportStats` (Task 5); `getScraper` and `closeAllBrowsers` (aggregator).
- Produces the CLI:
  `npx tsx scripts/perf-smoke.ts --bookmaker <bm> [--league premier-league] [--out <file>] [--dump <file>] [--baseline <file>] [--force]`
  - **stdout:** one line `PERF_SMOKE <json>`, plus `PARITY <json>` when `--baseline` is given. Scraper logs pass through.
  - **`--out`** writes the summary JSON (indent 1).
  - **`--dump`** writes `JSON.stringify(result)`, the raw `FullOfferScraperResult`.
  - **`--baseline`** reads an earlier `--out` file and compares it with `comparePerfParity(baseline, current)`. This is the §6 parity gate (2).
  - **Summary keys, in order:**
    - `bookmaker, league, startedAt` (ISO), `scraperClass` (`scraper.constructor.name`), `transportOverride` (`"browser"` or `null`)
    - `wallMs, success, error` (`null` when absent; a scraper throw is already a failed result carrying its message), `timedOut, matches, markets, selections`
    - `smoke`: the `SmokeResult` of `summarizeDryRun` (status `scraped|empty|scrape_failed`, normalization metrics). Normalization runs after the measured window, so it is not in `wallMs` or `cpu`.
    - `transport`: `diffTransportStats(before, after)` of `transportStats()` around the scrape (README §3: counters are cumulative), or `null` without `hasTransportStats`
    - `memory: { nodePeakRssMb, chromiumPeakRssMb, chromiumPeakProcesses, chromiumProcessesEver }`
    - `cpu: { nodeS, chromiumS }`
    - `samples`
    - `parity` (only with `--baseline`)
  - **Exit codes** (aligned with `smoke-bookmaker.ts`):
    - **0**: `summarizeDryRun` gave code 0 (status `scraped`: success and > 0 matches) and, with `--baseline`, `parity.pass`.
    - **1**: `scrape_failed`, `empty` (owner A6 counts it as a failure), timed out, or parity failed.
    - **2**: usage error, unknown bookmaker, or the minute is in [55, 59] ∪ [0, 9] without `--force`.

- [ ] **Step 1: Refactor `smoke-bookmaker.ts` and write `perf-smoke.ts`.** No unit test; Steps 2 and 4 are their checks.
  1. `smoke-bookmaker.ts`: extract `scrapeOnce` and `summarizeDryRun` as specified, export them with `SmokeResult` and `isBookmaker`, and wrap the module-level `main().then(…)` in the entry-point guard (`pathToFileURL` from `node:url`, `resolve` from `node:path`). Nothing else changes.
  2. `perf-smoke.ts`: parse the flags. Missing `--bookmaker` prints `Usage: perf-smoke.ts --bookmaker <bm> [--league <slug>] [--out <file>] [--dump <file>] [--baseline <file>] [--force]` to stderr and exits 2. In the window without `--force`, print `Refusing to run between HH:55 and HH:10 (scheduled scrape window); pass --force to override` and exit 2.
  3. Set `process.env.SUPABASE_URL = "http://127.0.0.1:9"` and `process.env.SUPABASE_SERVICE_KEY = "perf-smoke-no-db"` (kept although the worktree `.env` already points at the dead port: the script must stay safe when run from any checkout). Only then `const smoke = await import("./smoke-bookmaker.js")` and `const agg = await import("../src/scrapers/aggregator.js")`. Static imports are limited to `node:*`, `../src/utils/*.js`, `../src/config/transport.js` (type-only import of config) and type-only imports. `!smoke.isBookmaker(bm) || !agg.getScraper(bm)` prints `Unknown bookmaker: <bm>` and exits 2.
  4. Start the sampler with `{ rootPid: process.pid, intervalMs: 500 }`. Record `cpu0 = process.cpuUsage()`, `t0 = Date.now()` and `before = hasTransportStats(scraper) ? scraper.transportStats() : null`.
  5. Race `smoke.scrapeOnce(bm, league)` against a 600 000 ms guard. Pass no budget, so each scraper's production default applies. A guard win sets `timedOut: true` and an empty failed result.
  6. In `finally`: `await scraper.cleanup()`, `await agg.closeAllBrowsers().catch((e) => console.error("perf-smoke: closing browsers failed:", e))` (smoke-bookmaker's rule: a failed close never changes the exit code), wait 1000 ms (to sample the Chromium exit), then `sampler.stop()`.
  7. Compute the fields:
     - `nodeS` is `process.cpuUsage(cpu0)` (user+system) / 1e6, rounded to 0.01.
     - `nodePeakRssMb` is `Math.max(sampler.nodePeakRssMb, Math.round(process.resourceUsage().maxRSS / 1024))`.
     - `smoke` = `smoke.summarizeDryRun(bm, league, result, t0).result`.
  8. Write the outputs, then call `process.exit(code)` explicitly, because keep-alive sockets or the browser pool can hold the loop open.
- [ ] **Step 2: Type-check and run the offline checks.**
  - The standalone scripts `tsc` command (Global Constraints) on `scripts/perf-smoke.ts scripts/smoke-bookmaker.ts`. Expected: no output, exit 0.
  - `$H npx tsx scripts/perf-smoke.ts; echo $?`. Expected: the perf-smoke usage line, `2`.
  - `$H npx tsx scripts/perf-smoke.ts --bookmaker nosuchbm --force; echo $?`. Expected: `Unknown bookmaker: nosuchbm`, `2`, no Chromium started, and **no** `SMOKE_RESULT` or smoke-bookmaker usage line (proves the entry-point guard).
  - `$H npx tsx scripts/smoke-bookmaker.ts; echo $?`. Expected: smoke-bookmaker's own usage line, `2` (run directly, it still runs `main()`).
- [ ] **Step 3: `$H npx tsc --noEmit` and `$H npx vitest run`.** Expected: green, with the test count unchanged since Task 9.
- [ ] **Step 4: Live verification** (read-only probes, `$H --live`, one bookmaker per run, sequentially, outside HH:55–HH:10 and never while the live backend shows a run in progress). `O=.scratch/perf-smoke; mkdir -p $O` (EXECUTION rule 5: output stays in the worktree).

| Command (from the worktree root) | Pass criterion |
|---|---|
| `$H --live npx tsx scripts/perf-smoke.ts --bookmaker betclic --out $O/betclic-default.json --dump $O/betclic-default-raw.json` | exit 0. `matches` ≥ 15 and `markets` ≥ 2000 (baseline 19 / 3302; recovery's post-fix smoke: 19 matches in 10.2 s). `memory.chromiumProcessesEver` = 0 and `chromiumPeakRssMb` = 0. `transport` = `null`. The dump parses with `python3 -I -m json.tool`. On the future base betclic's broken Playwright fallback (`tab-scraper.ts`) is still reachable on an API error until plan 06 Task 1 lands; if the log shows it fired, the Chromium criterion fails for that reason only: rerun once and record it. |
| `$H --live npx tsx scripts/perf-smoke.ts --bookmaker fortuna --out $O/fortuna-browser.json` | exit 0. `matches` ≥ 15. `chromiumProcessesEver` ≥ 3. `chromiumPeakRssMb` between 200 and 3000 (baseline 1035). `cpu.chromiumS` > 1 (baseline 23.3). `nodePeakRssMb` < 1500 (baseline 337). |
| `$H --live npx tsx scripts/perf-smoke.ts --bookmaker fortuna --baseline $O/fortuna-browser.json`, in the same hour | exit 0. `PARITY` has `matchesEqual: true` and `pass: true`. This proves the comparator on an identical transport. |

  Record the three `PERF_SMOKE` lines in the commit message body. They prove the tool; they are not shared baselines. Each migration plan (03–06, and Tasks 11–12 here) takes its own same-hour baseline in its own worktree (README §6 gate 2): `SCRAPER_TRANSPORT_<BM>=browser` gives the old path where a fallback exists, the default gives the new one.
- [ ] **Step 5: Commit.** `git add scripts/perf-smoke.ts scripts/smoke-bookmaker.ts` and `git commit -m "feat(scripts): perf-smoke single-bookmaker perf and parity tool on top of smoke-bookmaker"`

---

### Task 11: totalbet on `HttpClient` (bounded transport; what it writes is unchanged)

**Files** (future base, Observation 8):
- Modify: `src/scrapers/bookmakers/totalbet/api-client.ts` (`FetchJson` `:23`, `nodeFetchJson` `:30-45`, `fetchLeagueEvents` `:84-124`, `fetchEventDetail` `:146-169`, `requestJson` `:178-195`), `constants.ts` (`DETAIL_DELAY_MS` `:31`, `REQUEST_TIMEOUT` `:36`), `index.ts` (`TotalbetDeps` `:43-48`, constructor `:63-72`, `scrapeFullOffer` `:204-216`, `scrapeLeagueOffer` `:222-326`)
- Test: `src/scrapers/bookmakers/totalbet/__tests__/transport.test.ts` (new); text updates in `__tests__/api-client.test.ts` and `__tests__/scraper.test.ts` (listed below)

**Interfaces:**
- Consumes: `HttpClient`, `createHttpClient`, `HttpError`, `contentTypeError` (Task 2); `createReplayHttpClient` (Task 3); `ScrapeBudget`, `createScrapeBudget`, `BudgetExceededError`, `mapLimit` (Task 1); `TransportStats` (Task 5).
- Produces:
  ```ts
  // api-client.ts
  export type FetchJson = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number; contentType: string; body: unknown }>;
  //   `init` is optional and additive: every existing `(url) => …` fake still type-checks
  export function createHttpFetchJson(http: HttpClient, opts: { timeoutMs: number; retries?: number }): FetchJson;
  //   http.getText(url, { headers: { accept: "application/json" }, timeoutMs, retries: opts.retries ?? 1, signal: init?.signal })
  //   → { status: 200, contentType: "application/json", body: JSON.parse(text) } (a parse failure throws contentTypeError(url, 200, ct, text))
  //   HttpError kind "http" → resolved as { status, contentType: e.contentType ?? "", body: tryJson(e.bodySnippet) ?? e.bodySnippet },
  //     so requestJson still reads the envelope `_meta.reason`; every other HttpError (timeout, network, aborted, content-type) is thrown
  export function fetchLeagueEvents(categoryUuid: string, fetchJson?: FetchJson, signal?: AbortSignal): Promise<ListEventsResult>;
  export function fetchEventDetail(eventUuid: string, fetchJson?: FetchJson, signal?: AbortSignal): Promise<EventDetailResult>;
  // constants.ts (replace DETAIL_DELAY_MS and REQUEST_TIMEOUT)
  export const TOTALBET_REQUEST_TIMEOUT_MS = 10_000;   // §5.1: 10–15 s instead of 30 s
  export const TOTALBET_DETAIL_CONCURRENCY = 4;        // §5.1: 3–4 instead of sequential + 250 ms
  export const TOTALBET_BUDGET_MS = 90_000;            // §5.1: ~90 s
  // index.ts
  export interface TotalbetDeps { fetchJson?: FetchJson; http?: HttpClient; detailConcurrency?: number }   // detailDelayMs removed
  //   TotalbetPlaywrightScraper gains: readonly transport = "http" as const;
  //   scrapeFullOffer(league: string, budget?: ScrapeBudget); transportStats(): TransportStats
  ```
- **Error wording** (README §3 and §5.1 row "observability.md Task 2"; replaces totalbet.md's transport texts):

  | Case | Today (`requestJson`) | After |
  |---|---|---|
  | transport failure | `Request failed: <msg> (<url>)` | the `HttpError` message verbatim (`fetch timeout 10000ms <url>`, `fetch failed <code> <url>`, `fetch aborted <url>`, `fetch non-JSON application/json <url>`); a non-`HttpError` throw from an injected fake → `fetch failed <message> <url>` |
  | non-2xx | `HTTP <status>[ (<reason>)] from <url>` | `fetch HTTP <status> <url>`, plus ` reason=<_meta.reason>` when the envelope has one |
  | 2xx, not JSON | `Non-JSON response (HTTP <s>, <ct>) from <url>` | `fetch non-JSON <ct or "none"> <url>` |
  | malformed payload, empty list, not prematch | `Malformed … from <url>`, `No prematch events for category …`, `Event … is not an active prematch event …` | unchanged |

  The run-level shapes stay (`Detail fetch failed for k/n events (first: <cause>)`, `No parsable Totalbet events for <league> | …`); only `<cause>` changes. totalbet's empty-list error stays too: it is totalbet.md's own rule (an unknown UUID answers 200 with an empty list), and under owner A6 `scrape_failed` and `empty` both count as failures.
- **Behaviour:**
  - The constructor builds one client per instance: `createHttpFetchJson(deps.http ?? createHttpClient({ perHostConcurrency: TOTALBET_DETAIL_CONCURRENCY }), { timeoutMs: TOTALBET_REQUEST_TIMEOUT_MS })`; `deps.fetchJson` (tests) wins. The client's `DEFAULT_USER_AGENT` (Chrome 143) replaces Node's `user-agent: node`; Step 5's live parity run is its check.
  - Retry: one, on network/timeout/429/≥ 500 with `Retry-After` honoured, never on 404 (§5.1), all inside `HttpClient`.
  - `scrapeFullOffer(league, budget?)`: `budget ??= createScrapeBudget(TOTALBET_BUDGET_MS)`; `budget.signal` goes to the list pages and every detail. Details run through `mapLimit(list.events, detailConcurrency, (e) => { budget.checkpoint(); return fetchEventDetail(e.uuid, fetchJson, budget.signal); })`, then today's loop body (`:245-299`: participants, `notPrematch` skip, drift check, **list-1X2 fallback**, the per-match log line) runs over the settled results **in list order**, so the output equals today's for the same responses. `DETAIL_DELAY_MS` and the `this.delay(...)` call (`:255`) go.
  - A budget abort (`BudgetExceededError`, or a detail whose error is `fetch aborted …` after `budget.signal` aborted) fails the scrape: `success:false`, `matches: []`, `error` = the budget message. No partial write and no fallback, so plan 07's hard deadline never produces 1X2-only rows.
  - `transportStats()` = `{ http: { ...stats, byStatus: { ...stats.byStatus } } }` of the instance's client: cumulative since construction (README §3); zero counters when a test injects `fetchJson`.
  - `readonly transport = "http" as const` (plan 07's `DeclaresTransport`). The class keeps `extends PlaywrightScraper` until plan 10 Part B.
- **Existing tests that change** (texts and pacing only; the write behaviour stays pinned as is):
  - `api-client.test.ts:113-136` (list status, later-page 404, non-JSON and network texts), `:172-175` (detail 404 → `fetch HTTP 404 <url> reason=not_found`), `:266-288` (`nodeFetchJson` cases become `createHttpFetchJson` cases: JSON by content type, `init.signal` forwarded, an unparsable JSON body → `fetch non-JSON application/json <url>`).
  - `scraper.test.ts:77, :88, :113, :157-158, :168, :235` (run-level texts: `HTTP 404 (not_found) from …` → `fetch HTTP 404 … reason=not_found`, `HTTP 404 from ${LIST_P1}` → `fetch HTTP 404 ${LIST_P1}`), and the legacy-method texts at `:279`, `:291` (plan 10 Task 16 deletes those tests later).
  - `scraper.test.ts:141-145` keeps "the list once, then each detail in list order": `mapLimit` starts items in input order and the synchronous fake records them that way.
  - `scraper.test.ts:147-152` (`DETAIL_DELAY_MS` pauses) is replaced by "fetches at most TOTALBET_DETAIL_CONCURRENCY details at once" (a fake that holds each detail until released; peak = 4).
  - `scraper.test.ts:154-161`: the global `fetch` stub still sees exactly one call for `LIST_P1` (Task 2: `HttpClient` reads `globalThis.fetch` per attempt; 404 is not retried); only the error text changes.

- [ ] **Step 1: Record the old-transport baseline** (before any code change; Task 10 is on this branch). `$H --live npx tsx scripts/perf-smoke.ts --bookmaker totalbet --out .scratch/perf-smoke/totalbet-before.json`. Expected: exit 0 (or exit 1 with the cause recorded if totalbet is down; then Step 5 waits for a healthy hour).
- [ ] **Step 2: Write the failing tests** (`transport.test.ts`; the list and detail fixtures are the existing `__tests__/fixtures/` files):
  ```ts
  it("createHttpFetchJson resolves a 404 envelope as a value so the reason survives", async () => {
    const f = createHttpFetchJson(createReplayHttpClient({ [U]: { status: 404, body: '{"_meta":{"reason":"not_found"}}' } }), { timeoutMs: 1000 });
    expect(await f(U)).toEqual({ status: 404, contentType: "application/json", body: { _meta: { reason: "not_found" } } });
    expect((await fetchEventDetail(EVENT, f)).error).toBe(`fetch HTTP 404 ${DETAIL_PREFIX}${EVENT} reason=not_found`);
  });
  it("a timeout is retried once, then surfaces in §3 wording", async () => { /* fetchImpl hangs on every call; timeoutMs 50 */
    expect(await fetchEventDetail(LEEDS, f)).toEqual({ event: null, error: `fetch timeout 50ms ${DETAIL_PREFIX}${LEEDS}` });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("passes the budget signal to every request", async () => { /* FetchJson spy; parent never aborts */
    await scraperWith({ fetchJson: spy }).scrapeFullOffer("premier-league", createScrapeBudget(60_000, parent.signal));
    parent.abort(new Error("late")); expect(spy.mock.calls.every(([, init]) => init?.signal?.aborted === true)).toBe(true);
  });
  it("a budget abort fails the scrape and writes nothing", async () => { /* the parent aborts once the list has answered */
    expect(await s.scrapeFullOffer("premier-league", budget)).toMatchObject({ success: false, matches: [], error: "scrape aborted: shutdown" });
  });
  it("transportStats counts requests cumulatively", async () => { /* replay client: list page + 20 details */
    await s.scrapeFullOffer("premier-league"); expect(s.transportStats().http!.requests).toBe(21);
    await s.scrapeFullOffer("premier-league"); expect(s.transportStats().http!.requests).toBe(42);
  });
  it("declares the http transport", () => expect(new TotalbetPlaywrightScraper().transport).toBe("http"));
  ```
- [ ] **Step 3: Run them and confirm they fail.** `$H npx vitest run src/scrapers/bookmakers/totalbet`. Expected: the new file fails (`createHttpFetchJson` missing); the existing files still pass.
- [ ] **Step 4: Implement** as specified, update the listed existing tests, then `$H npx vitest run src/scrapers/bookmakers/totalbet` (green), `$H npx tsc --noEmit`, `$H npx vitest run`. `src/services/normalization/__tests__/golden.test.ts` is unchanged.
- [ ] **Step 5: Live parity** (read-only, same hour as Step 1 or a fresh pair of runs within one hour; outside HH:55–HH:10). `$H --live npx tsx scripts/perf-smoke.ts --bookmaker totalbet --baseline .scratch/perf-smoke/totalbet-before.json --out .scratch/perf-smoke/totalbet-after.json`. Pass: exit 0; `PARITY` `matchesEqual: true`, markets and selections within ±2 %; `transport.http.requests` = 1 + listed events (+ `retries`); no `cf-mitigated` in `error`; `wallMs` below the baseline's. If the old run (Node UA) passes and the new one is refused only because of the Chrome UA (403 or a challenge), set `userAgent: "node"` in this client's `createHttpClient` call, rerun, and record why.
- [ ] **Step 6: Commit.** `git add src/scrapers/bookmakers/totalbet` and `git commit -m "feat(totalbet): bounded HttpClient transport with budget, retry and stats"`. Record the two `PERF_SMOKE` lines and the `PARITY` line in the body.
- **Deferred owner acceptance** (EXECUTION rule 4; record, do not run): after the merge, the next scheduled run logs `[Aggregator/FullOffer] totalbet (success|partial): N matches, …` for every enabled league with a totalbet UUID, and its `scraper_runs` row has `markets_saved` ≥ 0.75 × the previous OK totalbet run of that league.

---

### Task 12: Betby (betters, lebull) on `HttpClient` (bounded transport; what it writes is unchanged)

**Files** (future base, Observation 8):
- Modify: `src/scrapers/shared/betby/types.ts:12` (`FetchText`), `http.ts` (whole file: `createFetchText` and `BetbyHttpError` replaced; `hostAndPath` kept), `client.ts` (`BetbyClientDeps` `:37-42`, constructor `:133-144`, `getEndpoints`/`fetchSnapshot`/`fetchDescriptions` `:147-186`, `fetchEvent` `:160-173`, `fetchJson` `:217-224`), `scraper.ts` (`BetbyScraperDeps` `:40-45`, constructor `:121-130`, `scrapeFullOffer` `:132-181`, `fullEvent` `:299-316`)
- Unchanged: `discovery.ts` (its `catch` at `:127` is type-agnostic; it only receives the load-timeout `FetchText`).
- Test: `src/scrapers/shared/betby/__tests__/transport.test.ts` (new); `__tests__/fake-fetch.ts` (`:44`, `:83`) and text updates in `__tests__/{client,discovery,scraper}.test.ts` (listed below)

**Interfaces:**
- Consumes: as Task 11, plus Task 2's abort-race helper (`raceAbort`, listening on `AbortSignal.any([signal])`; export it from `http-client.ts` if Task 2 kept it private).
- Produces:
  ```ts
  // types.ts
  export type FetchText = (url: string, init?: { signal?: AbortSignal }) => Promise<string>;   // init optional: existing fakes still type-check
  // http.ts
  export const BETBY_EVENT_TIMEOUT_MS = 5_000;     // §5.1: 5 s for event calls
  export const BETBY_LOAD_TIMEOUT_MS = 10_000;     // manifest, chunks, descriptions, discovery (today 15 s for everything)
  export const BETBY_BUDGET_MS = 45_000;           // §5.1: ~45 s (worst case today ≈ 4.3 min)
  export const BETBY_PER_HOST_CONCURRENCY = 8;     // loadSnapshot fetches every chunk at once (7 in the evidence): a lower limit serializes them
  export function createBetbyFetchText(http: HttpClient, opts: { timeoutMs: number }): FetchText;
  //   (url, init) => http.getText(url, { timeoutMs: opts.timeoutMs, retries: 1, signal: init?.signal }); HttpErrors propagate unchanged
  // client.ts
  export interface BetbyClientDeps { fetchText?: FetchText; http?: HttpClient; now?: () => number; warn?: (message: string) => void }
  //   BetbyClient: getEndpoints(signal?), fetchSnapshot(signal?), fetchDescriptions(signal?)  -- the signal bounds only this caller's wait
  //                fetchEvent(eventId, signal?)                                               -- the signal goes to the request
  //                transportStats(): TransportStats
  // scraper.ts
  export interface BetbyScraperDeps { fetchText?: FetchText; http?: HttpClient; now?: () => number; eventDelayMs?: number }
  //   BetbyScraper gains: readonly transport = "http" as const; scrapeFullOffer(league, budget?: ScrapeBudget); transportStats(): TransportStats
  ```
- **Behaviour:**
  - One `HttpClient` per `BetbyClient`, i.e. per brand instance: `deps.http ?? createHttpClient({ perHostConcurrency: BETBY_PER_HOST_CONCURRENCY })`, with two `FetchText` views over it: loads (`BETBY_LOAD_TIMEOUT_MS`) and events (`BETBY_EVENT_TIMEOUT_MS`). `deps.fetchText` (tests) replaces both. The client's Chrome 143 UA replaces Chrome/131 (`http.ts:3`); Step 5 checks it live. Prices are never shared between the brands (README §5.1).
  - **Shared loads never take a caller's signal** (Review Focus 6). `TtlCache.get(load)` (`client.ts:49-67`, reused unchanged) starts `load()` without a signal; each caller awaits `raceAbort(cache.get(load), signal)`. A league whose budget aborts stops waiting with its `BudgetExceededError`; the load finishes for the other leagues and is cached as today. Loads stay bounded by their own per-request timeouts and the snapshot's 2 attempts.
  - `fetchEvent`: 404 → `null` now tests `err instanceof HttpError && err.kind === "http" && err.status === 404`; `BetbyHttpError` is deleted.
  - **Error wording** (§3): non-2xx `fetch HTTP <status> <url>` (full URL; was `HTTP <status> from <host><path>`); transport `fetch timeout …` / `fetch failed …` / `fetch aborted …` (was `Betby request failed: <host><path>: <reason>`). `Betby invalid JSON from <host><path>: …`, the descriptions check and `snapshot incomplete after 2 attempts (…)` keep their text. Discovery's warning keeps its shape with the new cause, e.g. `endpoint discovery failed: fetch HTTP 503 https://www.betters.pl/share/bootstrap; using pinned …`.
  - **Budget:** `scrapeFullOffer(league, budget?)`: `budget ??= createScrapeBudget(BETBY_BUDGET_MS)`; `budget.checkpoint()` before each event; `budget.signal` to every event request and to the cached-load waits. `fullEvent` rethrows `BudgetExceededError` and an `HttpError` of kind `aborted` instead of falling back, so the scrape returns its failure result (`createFullOfferErrorResult`, `success:false`, `matches: []`) and nothing is written. Every other `fullEvent` outcome (no payload, teams mismatch, a failed request) keeps today's listing fallback; changing that is Task 13 (gated).
  - Pacing unchanged: sequential events with `eventDelayMs` (150 ms default): the Betby plan's default, and §5.1 asks for nothing else.
  - `transportStats()` = `{ http: copy }` of the brand's client, cumulative since construction; zero counters when a test injects `fetchText`. `lastRunStats` (`scraper.ts:112-113`) stays: it is the per-run content split (`full` / `listingOnly` event ids), not a transport counter, and needs no diffing.
  - `readonly transport = "http" as const`; the class keeps `extends PlaywrightScraper` until plan 10 Part B.
  - §5.1's "stop after 2 consecutive transport failures" is **not** in this task: with today's fallback it would turn every remaining match into a listing write. It is part of Task 13.
- **Existing tests that change** (texts and the fake's error type only):
  - `__tests__/fake-fetch.ts:44, :83`: throw `httpStatusError(url, status, null, "")` instead of `BetbyHttpError`.
  - `discovery.test.ts:153-194` (`createFetchText` block → `createBetbyFetchText` over a stubbed-global or replay client: `fetch HTTP 503 https://www.betters.pl/share/bootstrap`, `fetch failed …`, `fetch timeout 20ms <url>`), `:59` (warning cause text).
  - `client.test.ts:69, :161, :195` (`HTTP <s> from <host><path>` → `fetch HTTP <s> https://<host><path>`); the fake at `:156` throws `httpStatusError(url, 503, null, "")`.
  - `scraper.test.ts:77` (`fetch HTTP 404 https://api-h-c7818b61-608.sptpub.com/…`), `:141` (warn text with `fetch HTTP 500 https://…/event/pl/${LEEDS}`), `:165` (`fetch HTTP 503 https://api-h-c7818b61-608.sptpub.com/api/v3/descriptions`).
  - `scraper.test.ts:215-227` (150 ms pause) is unchanged.

- [ ] **Step 1: Record the old-transport baselines** (before any code change). `$H --live npx tsx scripts/perf-smoke.ts --bookmaker betters --out .scratch/perf-smoke/betters-before.json`, then the same for `lebull`. Note each run's `[Betters/FullOffer] Completed: N matches (F full, L listing-only), M markets` line.
- [ ] **Step 2: Write the failing tests** (`transport.test.ts`, evidence fixtures via `createEvidenceFetch` or a replay client built from them):
  ```ts
  it("a budget abort leaves the shared snapshot load to the other league", async () => {
    // one BettersPlaywrightScraper; fetchText holds the manifest until release(); league A's parent aborts while it waits
    const a = s.scrapeFullOffer("premier-league", createScrapeBudget(60_000, parentA.signal));
    const b = s.scrapeFullOffer("laliga", createScrapeBudget(60_000));
    parentA.abort(new Error("shutdown")); release();
    expect(await a).toMatchObject({ success: false, matches: [], error: "scrape aborted: shutdown" });
    expect((await b).success).toBe(true); expect(f.calls.filter((u) => u.endsWith("/pl/0"))).toHaveLength(1);
  });
  it("a budget abort fails the scrape instead of falling back", async () => { /* the parent aborts during the 3rd event request */
    expect(r).toMatchObject({ success: false, matches: [] });
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("using listing markets"))).toHaveLength(2); // only the two before the abort
  });
  it("event requests use 5 s and one retry; loads use 10 s", …);   // spy on HttpClient.getText opts per URL kind
  it("snapshot chunks stay parallel on one host", …);              // fetchImpl counts in-flight chunk requests: peak 7, not 4
  it("transportStats counts requests cumulatively", …);            // two scrapes: second reading = 2 × first (snapshot cached: compare event counts)
  it("declares the http transport", () => expect(bettersScraper.transport).toBe("http"));
  ```
- [ ] **Step 3: Run them and confirm they fail.** `$H npx vitest run src/scrapers/shared/betby`. Expected: the new file fails; the existing files pass.
- [ ] **Step 4: Implement** as specified, update the listed existing tests, then `$H npx vitest run src/scrapers/shared/betby src/scrapers/bookmakers/betters src/scrapers/bookmakers/lebull`, `$H npx tsc --noEmit`, `$H npx vitest run`. Golden unchanged.
- [ ] **Step 5: Live parity**, one brand per run, in the same hour as Step 1 (or a fresh pair): `$H --live npx tsx scripts/perf-smoke.ts --bookmaker betters --baseline .scratch/perf-smoke/betters-before.json`, then `lebull`. Pass per brand: exit 0, `PARITY` pass, the `Completed:` line's `F full` / `L listing-only` split within ±1 of Step 1's, `transport.http.byStatus` without `timeout`. Same UA fallback rule as Task 11 Step 5 (`userAgent` = the old Chrome/131 string) if the Chrome 143 UA is refused.
- [ ] **Step 6: Commit.** `git add src/scrapers/shared/betby src/scrapers/bookmakers/betters src/scrapers/bookmakers/lebull` and `git commit -m "feat(betby): bounded HttpClient transport with budget, retry and stats"`. Record the `PERF_SMOKE` and `PARITY` lines in the body.
- **Deferred owner acceptance** (record, do not run): the next scheduled run logs `[Aggregator/FullOffer] betters (success|partial): …` and the same for lebull for every enabled league with a Betby tournament id (none for `world-cup-2026`).

---

### Task 13: Skip a match on a failed detail (totalbet, Betby) — GATED on an owner yes

> **Do not start this task without the owner's explicit yes on Open Question 3.** EXECUTION's owner rule "pzbuk, totalbet, betby: follow each plan's own default" makes today's listing fallback the default; this task changes what is written. Tasks 11–12 do not depend on it. If the answer is no, the task is dropped and the prune-guard question (plan 09 Open Question 1, B13) is the remaining mitigation.

**What changes** (README §2 principle 3 and §5.1 rows totalbet/betby):
- **totalbet** (`index.ts`, `scrapeLeagueOffer` after Task 11): a detail that answered with `error` and no `notPrematch` skips the match: no `listEventToMatchWinnerMarket` fallback (`:274-280`), no write, so no prune. `notPrematch` and "no active market" stay "no offer" (skipped, not counted). With `n` failed details and `m = matches + n`: `n / m > MAX_SKIPPED_DETAIL_RATIO` → `{ success:false, matches: [], error }`; otherwise `success:true` with `error = "<n> of <m> details failed | <first error>"`, joined with the drift errors by `" | "`. This replaces `Detail fetch failed for k/n events (first: …)` and the "every reachable detail failed" rule (`:319`). Zero matches with `n = 0` stays today's `No parsable Totalbet events for <league>` failure. The `listEventToMatchWinnerMarket` import leaves `index.ts` only if the legacy `scrapeLeague` (`:91`) no longer needs it; plan 10 Task 16 deletes that path.
- **Betby** (`scraper.ts`, `fullEvent` after Task 12) returns one of three outcomes:
  - `{ event }`: used as today.
  - `{ none: reason }`: no payload for this id (HTTP 200 envelope without `events`, or 404) or teams that differ from the snapshot. **Today's listing fallback stays** for these: thin or far events structurally have no payload, the snapshot's listing prices are correct, and the Betby plan's acceptance already expects ≤ 1 listing-only near match (`listingOnlyGated ≤ 1`, betby-betters-lebull.md:1217).
  - `{ failed: error }`: the request itself failed (non-404 HTTP status, timeout, network, invalid JSON). The match is skipped (no write, no prune) and counted.
  - After **2 consecutive** `failed` outcomes, stop fetching (§5.1): `{ success:false, matches: [], error: "stopped after 2 consecutive event failures | <first error>" }`, so the previous rows stay. Otherwise the 50 % rule over `failed` as for totalbet.
  - `BetbyRunStats` gains `failed: string[]`; the log line becomes `[<Tag>/FullOffer] Completed: N matches (F full, L listing-only, X failed), M markets`.
- **Effects the owner sees:** on a bad run fewer matches are written (a skipped match keeps its previous rows), and the outcome becomes `partial` or `scrape_failed` where today it says `success`. `success:true` + `error` only shows as `partial` once plan 07 Task 0 (the `partial` rule in `classifyBookmakerRun`) has landed; until then observability reports `success` and drops the cause, so land this after plan 07 Task 0.

**Files:** `src/scrapers/bookmakers/totalbet/index.ts`, `__tests__/scraper.test.ts`; `src/scrapers/shared/betby/scraper.ts`, `__tests__/scraper.test.ts`.

**Tests to rewrite** (all on the future base after Tasks 11–12):
- totalbet `scraper.test.ts`. Its default fake answers only Leeds and Crystal Palace (18 of 20 details 404), so add a helper `allDetails()` that answers every listed uuid with the Leeds trimmed detail, `data.event.uuid` patched (teams come from the list event). Then:
  - `:67-81`: on `allDetails()` → 20 matches, no `error`; on the default fake → `success:false`, `matches: []`, `error` `18 of 20 details failed | fetch HTTP 404 https://totalbet.pl/dealer/bdata/v1/bet/events/495716e5-fd45-43e5-8947-a0bf3ff676ab reason=not_found`.
  - `:83-89`: `20 of 20 details failed | fetch HTTP 404 …`.
  - `:105-108` becomes "a failed detail skips the match": `allDetails()` with Everton answering 503 twice → 19 matches, Everton absent, `success:true`, `error` `1 of 20 details failed | fetch HTTP 503 …/495716e5-…`.
  - `:163-169` and `:171-179`: the `Everton vs Coventry City: 1 markets` lines disappear; the warning is `[Totalbet/FullOffer] 18 of 20 details failed | …`.
  - `:191-204`: on `allDetails()`, Leeds turned live/suspended → 19 matches, `success:true`, no `error` (not counted).
  - `:206-215`: the only reachable detail went live → `success:false`, `matches: []`, `error` `No parsable Totalbet events for premier-league | 19 of 19 details failed | …`.
  - `:217-227`: Leeds without an active market → skipped, not counted.
  - `:229-237`: `error` starts `No parsable Totalbet events for premier-league | 20 of 20 details failed | fetch HTTP 404`.
- Betby `scraper.test.ts`:
  - `:51-57` (no `events` in the payload), `:59-67` (event endpoint 404) and `:145-158` (teams differ): listing fallback **kept**, assertions unchanged (if the owner picks Open Question 3's stricter alternative, these three become "skipped, not counted" and the match disappears).
  - `:135-143` becomes "a failed event request skips the match": Leeds answers 500 → 10 matches, Leeds absent, `success:true`, `error` `1 of 11 details failed | fetch HTTP 500 https://…/event/pl/2725816334213586962`, warning `[Betters/FullOffer] 2725816334213586962: event request failed (fetch HTTP 500 …); match skipped`.
  - `:30-40` and `:125-133`: unchanged counts; the `Completed:` line gains `, 0 failed`.
  - New: "stops after 2 consecutive event failures": two consecutive 500s → `success:false`, `matches: []`, `error` starts `stopped after 2 consecutive event failures | fetch HTTP 500`.

- [ ] **Step 1: Confirm the owner's yes** (quote it in the commit body).
- [ ] **Step 2: Rewrite the listed tests** and run them: `$H npx vitest run src/scrapers/bookmakers/totalbet src/scrapers/shared/betby`. Expected: FAIL on the new expectations.
- [ ] **Step 3: Implement** as described.
- [ ] **Step 4: Run and confirm.** Same command green, then `$H npx tsc --noEmit`, `$H npx vitest run`; golden unchanged.
- [ ] **Step 5: Live healthy-path check** (read-only): `$H --live npx tsx scripts/perf-smoke.ts --bookmaker totalbet --baseline .scratch/perf-smoke/totalbet-after.json`, then betters and lebull against their Task 12 runs. Pass: exit 0 and `PARITY` pass (a healthy hour has no failed details, so nothing is skipped).
- [ ] **Step 6: Commit.** `git add src/scrapers/bookmakers/totalbet src/scrapers/shared/betby` and `git commit -m "fix(totalbet,betby): skip a match on a failed detail instead of writing listing markets"`.
- **Deferred owner acceptance** (record, do not run): over the next 24 scheduled runs, no totalbet or Betby `scraper_runs` row whose `markets_saved` falls below 0.5 × the same bookmaker's previous OK run while `status` is `success`; failed details appear as `partial` with `… details failed | …` in `error_message`.

---

## Self-Review

Re-run 2026-11-13 against the future base (scratch merge of `recovery/integration` `aaf7c07` + `recovery/observability` `f0361f0` + `recovery/fortuna` `a8cdb71`); every kept line reference was re-read there.

1. **Spec coverage.** Every §3 symbol is produced:
   - `budget` and `mapLimit`: Task 1.
   - `HttpError`, `HttpClient` and the 5 message formats, including the coordinator's ` cf-mitigated=<value>` suffix and the `cfMitigated` field: Task 2. The default transport reads `globalThis.fetch` per attempt (module singletons, `vi.stubGlobal`).
   - Stable input order of `fetched`/`skipped` (coordinator refinement): Task 4 test "returns fetched and skipped in input order regardless of completion order".
   - The retry policy (network/timeout/429/≥500, full jitter with base 500, Retry-After ≤ 5 s, no retry after abort): Task 2 tests.
   - `createReplayHttpClient`: Task 3. `fetchDetailsSkippingFailures`: Task 4. `FullOfferScraper`, `DEFAULT_MAX_DURATION_MS` and `HttpScraper` with both failure texts, the empty-listing rule, `transport = "http"` and cumulative `transportStats()`: Task 5.
   - Aggregator typing and removal of the caller-less legacy runners: Task 6. `getTransportOverride` with README §3's one-pick rule: Task 7. `WsSession` with its 3 error texts, and the `ws`/`@types/ws` declaration behind an owner report: Task 8.
   - The README §2 file list's `scripts/perf-smoke.ts`, built on observability's `smoke-bookmaker.ts`, with `diffTransportStats` for cumulative counters: Tasks 9–10.
   - §5.1 rows: totalbet and betby transport (timeouts, one retry, budget, stats, `transport`, §3 wording): Tasks 11–12; "skip the match on a failed detail": Task 13, gated (EXECUTION owner rule; Open Question 3). The observability `" | "` separator: `HttpScraper` and Task 13.
2. **Step scan.** No step says "handle edge cases" or leaves a type undefined. The algorithms the signatures do not determine (the HTTP request loop, the `/proc` field indexes, the shared-load abort rule) are written out. Fixed while writing:
   - The first draft cancelled `res.body` on timeout. That fails with `ERR_INVALID_STATE` once `text()` has locked the body (verified), so the client now abandons the read instead.
   - The draft used `AbortSignal.timeout`, which fake timers cannot drive. It now uses global `setTimeout`.
   - The draft used `addEventListener` on caller signals, which warns at 11 listeners (verified). It now uses derived signals.
   - 2026-11-13: `npm install` steps removed (symlinked `node_modules`; `ws` already resolvable); `master` worktree base replaced by `recovery/integration`; perf-smoke output moved from the main checkout's `docs/` to `<worktree>/.scratch/` (EXECUTION rule 5); a budget abort in totalbet/Betby fails the scrape instead of reaching their listing fallbacks.
3. **Type consistency.** The §3 names are used verbatim. The additions are listed in each task's Produces block: the optional 5th `HttpError` constructor parameter `details` and the readonly `contentType`/`bodySnippet`/`cfMitigated` fields it fills, the factories, `DEFAULT_USER_AGENT`, `TransportStats`/`TransportStatsSource`/`hasTransportStats`, `ws failed …`, `ProcTree`, `PerfCounts`, `PerfParity`, `diffTransportStats`, `createHttpFetchJson`, `createBetbyFetchText` and the totalbet/Betby constants. `TransportStats.ws` is declared structurally, so Task 5 does not import Task 8. `FetchJson`/`FetchText` gain an optional second parameter, so every existing fake still type-checks. pzbuk's private `TransportStats` is left to plan 05c. README §3 abbreviates `HttpError.contentType`/`bodySnippet` as optional; this plan types them `string | null` / `string` (02 is authoritative for the details).
4. **Review Focus.** Each of the six items names its pinning test and owning task.
5. **Proportion.**
   - Task splits: aggregator typing is its own Task 6, because a reviewer could reject it apart from `HttpScraper`; the sampler (Task 9, unit-tested) is apart from the script (Task 10, live-verified); the transport moves of totalbet and Betby (Tasks 11–12, ungated) are apart from the write-behaviour change (Task 13, gated), so the owner's answer never blocks the bounded transport.
   - The replay helper moved ahead of `HttpScraper`, which uses it.
   - Test code states only assertions. Server fixtures in Tasks 2 and 8 are described in comments, not written out; Tasks 11–13 list the existing test lines that change instead of restating them.

## Open Questions

1. **The perf-smoke time-window guard.** The script refuses HH:55–HH:10 unless `--force` is passed. Recommended default: keep the guard. It enforces README §6 mechanically, and `--force` covers off-hours use when the scheduler is stopped.
2. **Where perf-smoke baselines live.** EXECUTION forbids writing into the main checkout, so Task 10 and Tasks 11–13 write to `<worktree>/.scratch/perf-smoke/` and record the `PERF_SMOKE`/`PARITY` lines in the commit bodies. Recommended default: yes; each migration plan takes its own same-hour baseline in its own worktree (README §6 gate 2 needs same-hour runs anyway).
3. **(New, for the owner) Skip a match on a failed detail for totalbet and Betby?** EXECUTION says "pzbuk, totalbet, betby: follow each plan's own default", and both plans' default is a listing fallback. Evidence (future base): totalbet writes the list 1X2 only when a detail fails (`totalbet/index.ts:274-280`) and calls the run `success` unless every detail failed (`:319`); Betby writes the snapshot's 14–16 listing markets when an event request fails (`shared/betby/scraper.ts:150-155`) and always returns `success:true` without an `error` (`:177`). With the prune guard deferred (B13), each such write deletes that match's previous full snapshot until the next run: totalbet details carry `market_count` 439–488, Betby near matches 220–242 markets. Task 13 would skip only real request failures (totalbet: any detail error that is not `notPrematch`; Betby: a failed request, plus a stop after 2 consecutive failures), keep Betby's listing fallback for events that have no payload or mismatched teams (structural for thin far events), and report the cause as `partial` (after plan 07 Task 0). **Recommended default: yes**, landed after plan 07 Task 0. Alternative if you want no listing writes at all: Betby also skips events without a payload (HTTP 200 without `events`, or 404) and with mismatched teams; then `shared/betby/__tests__/scraper.test.ts:51-57, :59-67, :145-158` change too, and every thin far match disappears from betters/lebull until its payload exists (in the evidence fixtures 7 of 11 PL matches have no payload; how many do live is visible in the `Completed: … listing-only` line of one `$H --live npx tsx scripts/perf-smoke.ts --bookmaker betters` run). If no: Task 13 is dropped, today's fallbacks stay, and the remaining mitigation is turning on the prune guard that plan 09 Task 2 builds behind a disabled flag (plan 09 Open Question 1).
