# 2026-11-07 Scraper Performance & Resource Plan: Index

This directory holds the analysis and the implementation plans for making the 14 scrapers faster, lighter on the machine and more robust. It is the **performance companion** to the correctness-focused set in [`../2026-11-06-scraper-recovery/`](../2026-11-06-scraper-recovery/README.md). Those plans fix wrong data and dead platforms; these plans change *how* data is fetched, scheduled, normalized and stored. Where the two touch the same code, this README states the order and the amendments.

**State as of 2026-11-13.** Analysis and plans only: no source file has been changed by this set. This directory is untracked in the main checkout (`?? docs/superpowers/`); implementers read it by absolute path until the owner commits it to `recovery/integration` (§8 Q11).

**Revision 2026-11-13 — the base moved.** The plans were first written against `master` @ `377b47e` (2026-11-07). Since then the recovery plans were executed in worktrees (`aityper-scraper-api-worktrees/<plan>`) and merged into **`recovery/integration`** (≥ `aaf7c07`: sts, pzbuk, totalbet, lvbet, betclic, superbet, fuksiarz, etoto, forbet, betfan, betby, betcris); `recovery/observability` (16 commits, Tasks 1–9) and `recovery/fortuna` (11) are not merged yet; `master` is unchanged until the owner merges. The owner's decisions are recorded in the recovery `EXECUTION.md` (tracked on integration). **All plans here now target the future base** = `recovery/integration` + observability + fortuna, which merges cleanly: **125 test files / 2 243 tests green, `tsc --noEmit` exit 0** (measured on a scratch merge). Each plan carries a `Revision 2026-11-13` note; the evidence for the revision is `evidence/delta-audit-transport-2026-11-13.md`, `evidence/delta-audit-infra-2026-11-13.md` and `evidence/cross-plan-review-2026-11-07.md`. Section 5.2 lists what changed in the order and in the amendments.

**How the analysis was done.** Ten parallel agents: seven read two scrapers each end to end and probed the live sites (plain GETs, low volume); one profiled all 14 scrapers live, alone and in parallel, with request/byte/CPU/PSS instrumentation (no DB writes, no overlap with the hourly run); one analysed normalization, the team matcher and the database (read-only SQL against the local Supabase, plus a throwaway Postgres for the proposed SQL); one analysed the core orchestration and browser layer with local Chromium experiments. Every number below comes from `evidence/` (index at the end). `[V]` = measured or read in code, `[I]` = inference.

---

## 1. What the measurements say

### 1.1 One production-like cycle today (premier-league, all 14 in parallel, no DB writes) [V]

| Metric | Value | Source |
|---|---|---|
| Wall time of the cycle | **117–126 s** | `evidence/profiling/summary-parallel-*.json` |
| Critical path | STS 117–120 s and betcris 117–126 s; the other 12 finish by 24–53 s | same |
| Peak memory | **≈ 5.7 GB** (Chromium 5.1–5.3 GB PSS + Node 1.2 GB) | `samples/` |
| Chromium processes | 80 at peak, 100 created per cycle | same |
| CPU | peak 16.4 of 20 hardware threads in the first ~10 s; **584 CPU-s** per cycle, 530 of them in Chromium | same |
| Requests / bytes | ≈ 27 000 requests, 131 MB (run one by one) | `summary-individual.json` |
| Idle waste | from ~55 s to the end only 2 scrapers work, but 13 finished browsers keep **2.1–2.5 GB** until `closeAllBrowsers()` | `samples/` |
| Data loss under contention | **betclic −9…−12 % markets, −15…−40 % selections** in the parallel run, although betclic uses no browser | `summary-parallel-*.json` |

Per bookmaker, run alone (wall s / requests / MB / Chromium CPU-s): betcris 101.9 / 13 758 / 23.1 / 158.9 · sts 97.4 / 10 472 / 10.7 / 171.9 · betclic 27.6 / 134 gRPC / 24.7 / 0 · pzbuk 25.3 (0 matches) · superbet 17.1 / 152 / 8.6 / 10.8 · fortuna 13.4 / 822 / 13.8 / 23.3 · lvbet 10.5 / 539 / 21.4 / 4.6 · betfan 9.3 · betters 8.1 (0) · lebull 8.1 (0) · etoto 7.3 · forbet 6.5 · fuksiarz 6.5 · totalbet 1.2 (HTTP 404).

### 1.2 Persistence and read path (local Supabase, ~9 h / ~10 runs since Postgres start) [V]

| Metric | Value | Source |
|---|---|---|
| Rows written per run | 64 211 inserts + about as many deletes, **0 updates** | `evidence/db-pipeline/` |
| Rows unchanged between consecutive scrapes | **97.2 %** (93.4 % betfan … 99.3 % lvbet) | same |
| WAL from odds writes | 2 340 MB upserts + 676 MB per-match deletes = **75 % of all WAL** | same |
| `odds` size | 175 MB heap + **428 MB indexes** for 187 k rows (unique index ~14× bloated) | same |
| Rows older than 24 h | 57.6 % (33 already-played matches back to August) | same |
| `getFullOfferByMatch` (per-match page) | 24 357 calls, **1 355 s DB time, ~51 GB temp writes** in 9 h | `pg_stat_statements` |
| `getMatchOdds` (frontend `src/lib/actions/odds.ts`) | **7.7 s per request** (filter on team names cannot pass the window function); 45 ms when filtered by `match_id` | EXPLAIN |
| Upload per run | ≈ 64 MB JSON, 154 upsert batches + 190 sequential prune DELETEs | profiling + DB |

### 1.3 Normalization [V]

- ~3.6–4.5 s CPU per cycle replaying the live run (`evidence/profiling/norm/`), up to ~17 s on golden fixtures (`evidence/db-pipeline/bench-normalize.mts`). In both, **~42 % is `matchToCanonical` falling through to a Fuse.js fuzzy search on labels that are not team names** ("Tak", "Nie", "powyżej", player names; 70–600 µs per call, no memoization).
- Normalization runs synchronously on the shared event loop right after `await scrapeFullOffer()` (`scrape-helpers.ts:32-49`). A demo (`evidence/db-pipeline/eventloop-timer-demo.mjs`) shows a 900 ms block making a 1000 ms read-cutoff timer fire with 1 of 10 chunks processed — the exact pattern of betclic's `GRPC_READ_TIMEOUT`. Together with ~43 MB/run of JSON structured-cloned over CDP into Node (superbet, fortuna, betfan, forbet, etoto `page.evaluate` returning parsed objects), this is the most likely mechanism behind the "load-dependent" betclic/sts losses the recovery README describes.
- Log volume: one PL run = 27 439 lines (2.5 MB); fortuna and superbet log ~1 800 "mapped to OTHER" lines **per match**.

### 1.4 The single most important finding: no bookmaker needs a browser [V]

Every agent probed the data source its scraper really uses. **All 14 answer a plain Node client without cookies or tokens today**:

| Transport | Bookmakers | Evidence |
|---|---|---|
| JSON over HTTP (`fetch`) | fortuna, superbet, lvbet, betfan, forbet, etoto, fuksiarz; totalbet and betters/lebull (already planned browserless in recovery) | curl + Node `fetch` 200 JSON, no challenge (`evidence/*/`) |
| gRPC-web over Node `https` | betclic (already browserless) | `evidence/betclic-fortuna/` |
| Raw WebSocket from Node | **sts** (one subscription → `i_pl` + all 19 PL snapshots in 467 ms, market counts identical to the browser runs), **betcris** (Swarm: 19 games, 8 644 markets in 1.0 s), **pzbuk** (one subscription → 3 138 markets in 0.7–0.8 s) | `evidence/sts-superbet/sts-ws-probe.mjs`, `evidence/betcris-pzbuk/swarm-bulk.mjs`, `pzbuk-direct2.mjs` |

On `master` 13 of 14 scrapers launch Chromium (on the future base: 10, plus betclic's fallback — totalbet and betters/lebull were migrated browserless by their recovery plans), and 7 of them only to run `page.evaluate(() => fetch(url))` against an API that answers curl. The profiling memory model shows why fixing the browser pool alone is not enough: page content dominates (~300 MB per bookmaker homepage; one STS page peaks at 1.4–1.5 GB PSS), so "1 browser × 14 contexts" saves only ~15 % on real pages. **Removing Chromium from the steady-state path is the lever.**

### 1.5 Other verified defects found along the way

| Defect | Where | Effect |
|---|---|---|
| Resource blocking + stealth never applied | `playwright-base.ts:119` returns before `:140-150` | Every scraper downloads images/fonts/CSS (fortuna 10.2 MB images = 74 % of its traffic) |
| …and the obvious fix is a trap | `page.route`/`context.route` disables the HTTP cache | STS traffic 10.7 → 101–143 MB with route blocking; betcris and pzbuk return **0 matches** when stylesheets are blocked |
| Our launch args undo Playwright's own `--disable-features` list | `browser-pool.ts:9-18` | Translate, OptimizationHints, HttpsUpgrades, storage partitioning, … re-enabled |
| `closeAll()` drops pool waiters unresolved | `browser-pool.ts:127-131` | Callers hang forever; `POST /api/admin/scrape` (bypasses `isRunning`, closes all browsers) can wedge the scheduler |
| 23 `page.evaluate(fetch)` calls with no timeout + no per-scraper deadline | 8 `navigation.ts` files, `aggregator.ts:291` | One stalled response hangs the whole run; `isRunning` stays true forever |
| `*/N` cron | `config/index.ts:43` | `*/45` → gaps 45/15 min; `*/60`, `*/90`, `*/120` all hourly |
| Startup scrape on every restart | `scheduler-service.ts:151-165` | This session: 52 `tsx watch` restarts → 44 full runs, **37 killed mid-write** |
| Detail failure silently downgrades to listing data, then the prune deletes the good snapshot | forbet, etoto, fuksiarz, betfan `index.ts` (`detailData?.data || event`); planned in totalbet.md:891 | One transient 5xx wipes ~90 % of a match's offer for an hour |
| `start_time` never stored | betfan/forbet (`eventStartTime`), etoto (`startTime`), lvbet (`start_time`) vs API `eventStart` / `date`; superbet and betclic also 100 % NULL (read-only query, 01:00Z run: superbet 12 490/12 490, betclic 3 121/3 121, lvbet 8 824/8 824); fuksiarz is correct (0/5 751) | NULL kickoff on every row of 6 bookmakers |
| Write-only caches holding full payloads | superbet (~55 MB/run), forbet (≤ 215 MB), etoto (unbounded Map), fuksiarz, betcris (~34 MB/run), pzbuk; `cache-manager.ts` only expires on read | Slow heap growth in a long-lived process |
| Betclic Playwright fallback broken three ways | `betclic/tab-scraper.ts` | Aborts its own document, stale selectors, double-releases a browser; becomes reachable once betclic recovery Task 1 lands |
| Superbet listing `endDate=2027-12-30` hard-coded | `superbet/navigation.ts:103` | Silent empty listing after that date |
| Fuzzy team matcher maps non-team labels to clubs | `matchToCanonical` → Fuse on "tak" → Stoke City, "nie" → Sunderland (premier-league) | Callers that use the result for team-side detection on selection labels can mis-side a selection; plan 01 Task 6 memoizes the behaviour unchanged — fixing it is a behaviour change (README §8 Q9) |
| Stale and in-play quotes served as fresh | no freshness filter in `odds-service.ts:62`; writes after kickoff accepted | betcris 21:02Z quotes served at 00:46Z after a failed run; Everton–Coventry written at 21:00Z after a 20:00Z kickoff |

---

## 2. Target architecture

```
                   RunCoordinator (one run at a time, incl. admin; per-job hard deadline)
                                        │
          one job per bookmaker, walks enabled leagues sequentially; global caps
                                        │
   ┌───────────────┬───────────────────┼────────────────────┬──────────────────────┐
   │ HttpScraper   │ RestMarket family  │ WebSocket scrapers │ betclic (gRPC-web)   │ PlaywrightScraper
   │ fortuna,      │ forbet, etoto,     │ sts, betcris,      │ Node https, gzip,    │ (fallback / audit
   │ superbet,     │ fuksiarz, betfan   │ pzbuk              │ bounded concurrency  │  tooling only; one
   │ lvbet,        │ (shared client +   │ (shared WsSession) │                      │  shared browser)
   │ totalbet*,    │  runner)           │                    │                      │
   │ betby*        │                    │                    │                      │
   └──────┬────────┴─────────┬──────────┴─────────┬──────────┴──────────┬───────────┘
          └──── shared/http HttpClient (timeouts, retry+jitter, per-host limit, typed errors, stats)
                                        │
          normalize (memoized team matcher, yields between matches, aggregated warnings)
                                        │
          save_odds_snapshot RPC: hash-diff, update-in-place, prune guard, history on change
                                        │
              odds_current / odds_snapshot / odds_history / matches  (+ compat views)
   (* = migrated by the recovery plans; this set only amends their transport details)
```

Principles:
1. **Browserless by default.** Chromium is kept as an opt-in fallback per scraper (`SCRAPER_TRANSPORT_<BM>=browser`) and for audit tooling; it is no longer on the hourly path once plans 03–05 land.
2. **Every network call is bounded**: per-request timeout, one retry with jitter on network/5xx/429, a per-scraper budget (deadline + `AbortSignal`), and a coordinator-level hard deadline as the last line of defence.
3. **Never downgrade silently.** A failed detail fetch skips that match (no write, no prune); more than half skipped → the scraper fails with the cause. A degenerate write never prunes a good snapshot.
4. **Don't rewrite what didn't change.** 97 % of rows are identical run to run; write only changes, bump one freshness row per (match, bookmaker), keep history only on change.
5. **Protect the event loop**: no large structured clones over CDP, memoized fuzzy matching, yield between matches, measure event-loop delay every run.

---

## 3. Shared interface contract (every plan must use exactly these names)

These are defined by plan 02 and consumed by 03–08. If a plan needs a change, it says so in its "Interfaces" block and the change is made in 02 first.

```ts
// src/scrapers/shared/budget.ts
export class BudgetExceededError extends Error {}
export interface ScrapeBudget {
  readonly signal: AbortSignal;       // aborted when the deadline passes or the parent aborts
  readonly deadline: number;          // epoch ms
  remainingMs(): number;
  checkpoint(): void;                 // throws BudgetExceededError when aborted
}
export function createScrapeBudget(maxDurationMs: number, parent?: AbortSignal): ScrapeBudget;

// src/scrapers/shared/concurrency.ts  (wraps p-limit, already a dependency)
export function mapLimit<T, R>(
  items: readonly T[], limit: number,
  fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal,
): Promise<PromiseSettledResult<R>[]>;

// src/scrapers/shared/http/http-error.ts
export type HttpErrorKind = "http" | "timeout" | "network" | "content-type" | "aborted";
export interface HttpErrorDetails { contentType?: string | null; bodySnippet?: string; cfMitigated?: string } // snippet ≤ 4 096 chars
export class HttpError extends Error {
  constructor(readonly kind: HttpErrorKind, readonly url: string, readonly status: number | null, message: string,
              details?: HttpErrorDetails);
  readonly cfMitigated?: string;     // value of the `cf-mitigated` response header, if any
  readonly contentType: string | null; // null when there was no response
  readonly bodySnippet: string;      // "" when none
}
// message formats (observability wording, see 2026-11-06 observability.md Task 2):
//   http          -> `fetch HTTP ${status} ${url}` + (cfMitigated ? ` cf-mitigated=${cfMitigated}` : "")
//   timeout       -> `fetch timeout ${timeoutMs}ms ${url}`
//   network       -> `fetch failed ${causeCode ?? cause.message} ${url}`
//   content-type  -> `fetch non-JSON ${contentType} ${url}`
//   aborted       -> `fetch aborted ${url}`

// src/scrapers/shared/http/http-client.ts
export interface HttpRequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;                    // default 10_000
  retries?: number;                      // default 1 → at most 2 attempts
  signal?: AbortSignal;                  // usually budget.signal
}
export interface HttpStats { requests: number; retries: number; failures: number; bytes: number; byStatus: Record<string, number> }
export interface HttpClient {
  getJson<T>(url: string, opts?: HttpRequestOptions): Promise<T>;
  getText(url: string, opts?: HttpRequestOptions): Promise<string>;
  readonly stats: HttpStats;
}
export function createHttpClient(cfg?: {
  userAgent?: string;                    // default: a current desktop Chrome UA
  defaultHeaders?: Record<string, string>;
  perHostConcurrency?: number;           // default 4
  fetchImpl?: typeof fetch;              // test seam
}): HttpClient;
// retry policy: retry on kind network|timeout and on status 429 or >= 500, never on other 4xx,
// full-jitter backoff base 500 ms, honour Retry-After (capped at 5 s), never retry after signal abort.

// src/scrapers/shared/detail-fetch.ts
export const MAX_SKIPPED_DETAIL_RATIO = 0.5;
export interface DetailFetchOutcome<E, D> {
  fetched: Array<{ event: E; detail: D }>;
  skipped: Array<{ id: string; error: string }>;
}
export function fetchDetailsSkippingFailures<E, D>(
  events: readonly E[], idOf: (e: E) => string,
  fetchDetail: (e: E, signal: AbortSignal) => Promise<D>,
  opts: { concurrency: number; budget: ScrapeBudget },
): Promise<DetailFetchOutcome<E, D>>;
// `fetched` and `skipped` are both in INPUT order, regardless of completion order.
// a skipped event produces NO FullMatchOffer (so no write and no prune for that match)

// src/scrapers/shared/scraper-contract.ts
export interface FullOfferScraper {
  readonly bookmaker: PolishBookmaker;
  scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult>;
  cleanup(): Promise<void>;
}
export const DEFAULT_MAX_DURATION_MS = { http: 120_000, websocket: 120_000, browser: 240_000 } as const;

// src/scrapers/base/http-scraper.ts
export abstract class HttpScraper implements FullOfferScraper {
  abstract readonly bookmaker: PolishBookmaker;
  protected constructor(protected readonly http: HttpClient = createHttpClient());
  protected abstract isLeagueSupported(league: string): boolean;
  protected abstract fetchFullOffer(league: string, budget: ScrapeBudget): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }>;
  scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult>;
  // template: league check → budget (DEFAULT_MAX_DURATION_MS.http if none) → fetchFullOffer →
  //   success:false + error "<n> of <m> details failed | <first error>" when skipped/(matches+skipped) > MAX_SKIPPED_DETAIL_RATIO,
  //   success:false + error = HttpError.message on a listing failure, duration always set.
  cleanup(): Promise<void>;              // no-op
}

// src/scrapers/shared/ws/ws-session.ts  (needs `ws` + `@types/ws` as explicit dependencies)
export interface WsSessionOptions { url: string; headers?: Record<string, string>; budget: ScrapeBudget; connectTimeoutMs?: number }
export interface WsSession {
  send(data: string): void;
  collect<S>(init: S, reduce: (state: S, frame: Buffer, isBinary: boolean) => S,
             done: (state: S) => boolean, timeoutMs: number): Promise<{ state: S; timedOut: boolean }>;
  close(): Promise<void>;
  readonly stats: { framesReceived: number; bytesReceived: number };
}
export function openWsSession(opts: WsSessionOptions): Promise<WsSession>;
// errors: `ws handshake HTTP ${status} ${url}`, `ws closed ${code} ${url}`, `ws timeout ${ms}ms ${url}`

// src/__tests__/helpers/replay-http.ts  (test-only)
export function createReplayHttpClient(
  routes: Record<string, { status?: number; body: string; contentType?: string } | Error>,
): HttpClient & { calls: string[] };

// src/config/transport.ts  — per-bookmaker fallback to the old browser implementation
export type TransportOverride = "browser";
export function getTransportOverride(bookmaker: PolishBookmaker, env?: NodeJS.ProcessEnv): TransportOverride | undefined;
// reads SCRAPER_TRANSPORT_<BOOKMAKER_UPPERCASE>, e.g. SCRAPER_TRANSPORT_STS=browser; any other value → undefined.
// Rule: exactly ONE pick per bookmaker — either a create<Brand>Scraper() factory in the brand module or the export in
// src/scrapers/bookmakers/index.ts — and EVERY direct importer is repointed to the picked instance (several bypass
// bookmakers/index.ts: src/services/audit/bookmaker-registry.ts, scripts/<bm>-market-discovery.ts,
// scripts/<bm>-prep-audit.ts, src/scripts/analyze-bookmaker-markets.ts, scripts/test-scrapers.sh). A selection test
// pins the pick. Plans 03, 04, 05c pick in bookmakers/index.ts; 05a and 05b in the brand module; plan 10 Task 18 lists
// each location and test. A migrated bookmaker keeps its old Playwright class (renamed <Brand>BrowserScraper) for one
// release; plan 10 deletes the browser classes but keeps getTransportOverride as a stub returning undefined.
//
// Empty listing rule (all transports): HTTP 200 / valid envelope / 0 events → success:true, matches:[] (observability
// classifies it `empty`); a malformed envelope or transport error → success:false with the HttpError/ws message.
//
// Every non-browser scraper declares `readonly transport: "http" | "websocket"` (plan 07's DeclaresTransport), so job
// classification and budgets never depend on file layout.
```

Parity pattern for transport migrations (plans 03–05): first extract the pure mapping from today's `index.ts` (`listing + detail payload → FullMatchOffer`) into a tested module that the **old** path calls, proving byte-identical output on recorded payloads; then the new transport calls the same mapping. Output parity then holds by construction, and the live smoke only has to confirm the transport.

**Additive refinements fixed in plan 02 (02 is authoritative for the details):**
- `HttpError` gets an optional 5th constructor argument `{ contentType?: string; bodySnippet?: string }` (first 4 096 chars) exposed as readonly fields, plus five error factories in `http-error.ts`; a body that fails `JSON.parse` uses kind `content-type` / `fetch non-JSON …`.
- `DEFAULT_USER_AGENT` (Chrome 143 desktop) exported from `http-client.ts`; the client sends `accept-encoding: gzip, deflate, br` explicitly (Node 20.19 `fetch` decodes `br` but does not request it).
- `HttpStats.byStatus` also counts `"timeout"`, `"network"`, `"aborted"`.
- `WsSession` adds `ws failed ${code ?? message} ${url}` for a connection error before the handshake. Frames that arrive while no `collect` is running are queued and replayed into the next `collect`; only one `collect` may run at a time (a second concurrent call rejects).
- `TransportStats`, `TransportStatsSource`, `hasTransportStats()`; `HttpScraper` implements `TransportStatsSource` (`transportStats()`), read by `scripts/perf-smoke.ts` and plan 07's `[ScrapeMetrics]`. **Counters are cumulative and monotonic since the scraper instance was created** (HTTP: `HttpClient.stats`; WebSocket scrapers add every session's `stats` to a running total); consumers diff before/after a unit of work. There is no separate `wsStats` result field.
- `HttpScraper` with ≤ 50 % skipped details returns `success: true` **and** sets `error` to `"<n> of <m> details failed | <first error>"`; plan 07 decides how that maps onto observability's outcome statuses.
- `createScrapeBudget` throws `RangeError` for a non-finite or non-positive duration.

Aggregator typing changes from `Record<PolishBookmaker, PlaywrightScraper>` to `Record<PolishBookmaker, FullOfferScraper>` (plan 02). The legacy 1X2 methods stay on `PlaywrightScraper` until plan 10 deletes them.

---

## 4. Plans in this directory

| # | Plan | What it delivers | Effort | Depends on |
|---|---|---|---|---|
| 01 | [01-quick-wins.md](01-quick-wins.md) | Launch-args fix, pool waiter fix + close idle browsers on release, write-only cache removal + cache expiry on write, `start_time` for betfan/forbet/etoto/lvbet/superbet/betclic (betclic from listing proto field 3), superbet rolling `endDate`, memoized team matcher, event-loop yield between matches, aggregated unmapped-market logs | S×8 | none — merge any time |
| 02 | [02-shared-transport.md](02-shared-transport.md) | §3 contract: budget, `mapLimit`, `HttpClient`/`HttpError`, `fetchDetailsSkippingFailures`, `FullOfferScraper`, `HttpScraper`, `WsSession`, replay client, transport override flag, `scripts/perf-smoke.ts` (built on observability's `smoke-bookmaker.ts`); deletes the uncalled legacy aggregator functions; Tasks 11–12 adapt the built totalbet and Betby clients (timeouts, retry, budget, stats, §3 wording); Task 13 (skip a match on a failed detail) **gated on an owner yes** | M | observability merged (R0); Task 8 stops to report the `ws` dependency; Task 13 also needs 07 Task 0 |
| 03 | [03-rest-market-family.md](03-rest-market-family.md) | Shared browserless client + runner for forbet, etoto, fuksiarz, betfan; skip-on-detail-failure; old browser classes kept behind the override flag | M | 02; each brand after its recovery integrity fix |
| 04 | [04-http-fortuna-superbet-lvbet.md](04-http-fortuna-superbet-lvbet.md) | `HttpScraper` migrations of fortuna, superbet, lvbet | M | 02; 03 Tasks 1–3 (`withChallengeHint`, offline harness, transport-selection test); superbet and lvbet also 01 Tasks 3–5; fortuna after fortuna.md Task 7 live check |
| 05a | [05a-websocket-sts.md](05a-websocket-sts.md) | One Node WebSocket session for the whole STS league (listing + all fixture snapshots) | M | Task 0 (browser-path circuit breaker + `sts-run-check.py` outcome pattern, own branch `perf/sts-breaker`, executable now); WebSocket tasks need 02 and Task 0 |
| 05b | [05b-websocket-betcris.md](05b-websocket-betcris.md) | **Part A (executable):** browser-path quick wins — finish on the `SINGLE_GAME_VIEW` reply (≈ −3 s per game), drop the never-pruned events cache. **Part B (blocked — owner said no, EXECUTION C):** direct Swarm client replacing the built browser capture | S / M | Part A: none; Part B: owner yes + 02 |
| 05c | [05c-websocket-pzbuk.md](05c-websocket-pzbuk.md) | Direct pzbuk socket, one subscription for all events, reusing the built decoder/assembler; **replaces the built browser wiring** (≈ 17 s/event → ≈ 1 s/league) | M | 02; pzbuk.md Tasks 1, 4, 5 (all built) |
| 06 | [06-betclic-transport.md](06-betclic-transport.md) | **Task 1 is urgent (F1):** delete the broken Playwright fallback, now reachable since betclic.md Task 1 merged without it. Then gzip, parse each distinct group once, match-header category list (field 10; `start_time` stays with plan 01), required groups = TOP + categories TOP lists, bounded match concurrency (3), 90 s run budget | S–M | 02 (Task 1 needs nothing); around betclic.md Task 1 (see §5) |
| 07 | [07-orchestration.md](07-orchestration.md) | `RunCoordinator` (single run incl. admin, real run id), per-job hard deadline, bookmaker-major multi-league jobs, global caps, interval scheduler, `STARTUP_SCRAPE` policy, graceful shutdown, cleanup after every run, `[ScrapeMetrics]` + event-loop delay | M | 02; observability Tasks 1–7 (Task 7 itself depends on 4–6) |
| 08 | [08-browser-runtime.md](08-browser-runtime.md) | Fallback-only browser layer: one shared browser + contexts + semaphore + idle close, CDP-based opt-in blocking (keeps HTTP cache), client-hint UA fix; delete the dead route/stealth code | M | 01 Tasks 1–2 (`BROWSER_ARGS`, pool), 06 Task 1 (`tab-scraper.ts` deleted; also removes the last `navigateWithRetry` caller, which 08 then deletes), 07 Task 1 (coordinator — admin no longer calls `closeAll`) and Task 2 (`currentScrapeJob()` budget hook, `maxDurationMsFor` session lifetimes); only needed while any scraper or audit tool still uses Playwright |
| 09 | [09-db-write-model.md](09-db-write-model.md) | Task 0: freshness index as migration `11a_odds_freshness_index.sql` (first, mandatory). Quick wins (`match_id` filter, batched prune; guard built behind `ODDS_PRUNE_GUARD`, off per owner B13; `get_match_market_rows` RPC, index hygiene), then `matches` / `odds_snapshot` / `odds_current` / `odds_history` + `save_odds_snapshot` RPC with dual-write, read switch, `cleanup_odds`, stale/in-play rules | M–L | observability Tasks 1, 4, 5 (test helper, `formatDbError`, `parseDbTimestamp`, `staleAfterMs`) and migration 11 first; migrations 12 (prune function + `get_match_market_rows`), 13 (new tables + `save_odds_snapshot` + backfill), 14 (read switch + `cleanup_odds`), 15 (drop legacy, compat view `odds`) need operator approval |
| 10 | [10-adaptive-scheduling-and-legacy.md](10-adaptive-scheduling-and-legacy.md) | `IncrementalScraper` (`listEvents`/`fetchEvent` → `FullMatchOffer \| null`) + pure kickoff-tier due-plan + migration 16 (`odds_snapshot.last_detail_at`, `listing_fingerprint`, `record_incremental_pass`) for the HTTP scrapers and betclic (not the WebSocket ones: sts/betcris/pzbuk already fetch the whole league in ≤ 1 s); deletion of the legacy 1X2 path (~2 300 lines, re-measured on the future base), `scripts/scraper-check.ts` replacing `test-scrapers.sh`, and a 14-day `scraper_runs` gate before deleting the `<Brand>BrowserScraper` classes | L | 03–07, 09; recovery 4a–4c merged; observability Tasks 9–10 (`scripts/scraper-status.ts`, `npm run dev:stack`); extends plan 07's request types with optional `modes?` and `recordOutcomes`, and lets `IntervalSchedulerOptions.request` return `null` to skip a tick |

---

## 5. Order relative to the 2026-11-06 recovery plans

The recovery README's rule still holds: **odds integrity first** (wrong prices beat missing prices in harm). Performance work never blocks an integrity fix. Every plan works in its own git worktree; merge one branch at a time, never near HH:00, and check the next scheduled run before the next merge.

| Step | What | Why here |
|---|---|---|
| R1 | Recovery steps 0.1–1d (docs commit, owner decisions, stop-gaps, forbet/fortuna/fuksiarz integrity fixes, sts Task 1, betclic Task 1) and observability Tasks 1, 2, 3, 7 | Live fake +EV and data loss first; observability makes every later merge verifiable |
| P1 | **01 quick wins** (can also go in parallel with R1; all hunks are outside the files R1 edits except where 01 says so) | Cheap, measurable, reduces event-loop pressure that causes the betclic/sts losses |
| P2 | **02 shared transport** | Foundation for 03–07; pure additions |
| P3 | **06 betclic** Task "delete fallback" *with or before* betclic.md Task 1; gzip/concurrency *after* it | Task 1 makes the broken fallback reachable; gzip needs Task 1's reader |
| P4 | **03 rest-market family**, then **04** (after 03 Tasks 1–3; superbet and lvbet after 01 Tasks 3–5; fortuna after fortuna.md Task 7) | Each removes one Chromium and 6–35 s of wall time; one brand per merge |
| P5 | **07 orchestration** (after observability Tasks 1–7) | Hard deadlines and the coordinator need observability's outcome vocabulary. Its 240 s browser deadline cuts off long browser retry paths (sts.md Task 1 without the circuit breaker, betcris.md's 2.5 min listing retry) — land the §5.1 sts breaker first, or land 05a/05b first |
| P6 | **09 DB quick wins**, then migrations 12+ | 7.7 s → 45 ms read fix and the prune guard are independent of the transport work |
| P7 | **05a/05b/05c WebSocket scrapers** (sts after sts.md Task 1; pzbuk replaces pzbuk.md Task 5; betcris replaces betcris.md Tasks 1–2 if the owner answers OQ1 "yes") | Biggest wall-time win, highest protocol risk; keeps a browser fallback |
| P8 | **08 browser runtime** (only for what still uses Playwright) | Small once 03–05 landed |
| P9 | **10 adaptive scheduling + legacy deletion** | Needs the incremental interfaces and all platform migrations merged |

### 5.0 Revised order on the future base (2026-11-13) — this replaces the table above

| Step | What | Why here |
|---|---|---|
| R0 | Owner merges `recovery/observability` and `recovery/fortuna` into `recovery/integration` (fortuna Tasks 6–7 first), applies migration 11 (single-file form), and later merges integration into `master`. **Before that merge**, move the untracked `docs/superpowers/plans/2026-11-06-scraper-recovery/` copy in the main checkout aside — it differs from the tracked one and the merge would abort with "untracked files would be overwritten". | Every plan here assumes observability's outcome vocabulary and helpers |
| F1 | **06 Task 1 — delete betclic's broken Playwright fallback** (immediately; needs nothing from 02) | betclic.md Task 1 merged without it: a match left with only TOP valid now reaches the broken fallback and the rest of its markets get pruned |
| F2 | **05a Task 0 — sts browser-path circuit breaker** (follow-up on the recovery code) | Not built by recovery; a systemic miss costs ~10 min and blocks 07's 240 s budget |
| F3 | **07 Task 0 — `partial` rule in `classifyBookmakerRun`** (needs observability merged) | Not built; without it every "n of m details failed" cause from 02/03/04/05a/06/09 is dropped and the run shows `success` |
| F4 | **09 Task 0 — `(league_slug, bookmaker, scraped_at DESC)` index** (migration `11a`), then 09 Task 1 — the `getMatchOdds` `match_id` filter | Observability's freshness runs 14 single-row queries per request; 7.7 s → 45 ms read |
| P1 | **01 quick wins** | Cheap; event-loop relief; `start_time` for 6 bookmakers |
| P2 | **02 shared transport**, incl. the adapter tasks for the built totalbet/betby clients (timeouts, retry, budget, stats; the failure-behaviour change is gated on the owner, §8 Q10) | Foundation for 03–07 |
| P3 | **06 Tasks 2–8** (gzip, parse once, required groups, concurrency, budget) | Sequential reference is now ≈ 10 s |
| P4 | **03 rest-market family**, then **04** (fortuna after its recovery Task 7 live check) | Each removes one Chromium |
| P5 | **07 orchestration** | Hard deadlines, coordinator, interval scheduler, startup policy, metrics |
| P6 | **09 remaining tasks** (batched prune; guard behind a flag that stays off per owner B13; `get_match_market_rows`; migrations 12–15) | Write amplification and read paths |
| P7 | **05a (sts WebSocket)** and **05c (pzbuk direct socket — replaces the built browser wiring)**; **05b Part A** (betcris browser quick wins); 05b Part B (Swarm client) only after an explicit owner yes | Owner C: no Node Swarm client for betcris |
| P8 | **08 browser runtime** — sts/betcris stay on the browser by default meanwhile, so it matters more than first planned | Blocked until F1 |
| P9 | **10 adaptive scheduling + legacy deletion** | Last |

### 5.1 Amendments to the recovery plans (apply when those plans are executed)

> **Status 2026-11-13:** most recovery plans have been executed, so these rows are now either *applied*, *open follow-ups on the recovery code*, or *obsolete* — see §5.2, which takes precedence over the rows below.

These do not change any correctness decision; they bound cost and stop a failure mode the recovery plans introduce or leave open.

| Recovery plan | Amendment | Evidence |
|---|---|---|
| totalbet.md (dealer client) | Detail concurrency 3–4 instead of sequential + `DETAIL_DELAY_MS=250`; per-detail timeout 10–15 s instead of 30 s; scraper budget ~90 s; one retry on network/5xx/429 honouring `Retry-After`, never on 404. **Conflict at totalbet.md:891:** do not write a 1X2-only market when the detail fails — retry, then skip the match (otherwise the prune deletes a ~450-market snapshot). Use §3 `HttpClient` if plan 02 has landed. | `evidence/betfan-totalbet/` |
| betby-betters-lebull.md | Memoize in-flight promises (not only results) for endpoints/snapshot/descriptions; 5 s timeout for event calls, one retry on network/5xx/429, stop after 2 consecutive transport failures, overall budget ~45 s (worst case today ≈ 4.3 min); a test that spies `browserPool.acquire` and expects 0 calls. Do not share price fetches between the two brands (5 of 2 274 outcomes differ, incl. all three 1X2 legs). | `evidence/betters-lebull/` |
| totalbet.md Task 4, betby-betters-lebull.md, pzbuk.md Task 3 (legacy 1X2 methods) | Plan 10 Task 16 deletes the legacy `scrapeLeague`/`scrapeMatch`/`scrapeMatchDetails` path. Keep the legacy methods these plans still implement minimal (totalbet.md :877-881 + tests :963-972; betby :938 + test :1005-1015), and skip pzbuk.md Task 3 (legacy helpers on numeric ids, :534-585) — plan 05c already marks its A10 check not applicable. | `10-adaptive-scheduling-and-legacy.md` |
| betclic.md Task 1 | On every settle destroy the **source** response/request, not a wrapper stream (plan 06 adds gzip in front of the reader). Land plan 06 Task 1 (delete the Playwright fallback) with or before Task 1. | `evidence/betclic-fortuna/` |
| betcris.md | Decide OQ1 (direct Swarm client) **before** building Tasks 1–2: a verified Node client returns all 19 games in 1.0 s and makes the retried browser capture unnecessary. Tasks 3–6 still apply. If the browser path is kept, add "finish on the `SINGLE_GAME_VIEW` reply" (−3 s per match; the `markets_count` target is never reached in 19/19 games). Never block stylesheets for betcris. Knock-on edits if 05b lands instead of Tasks 1–2 (05b §amendments): Task 3 imports `loadFixture` from `__tests__/helpers/swarm-fixtures.ts` (05b Task 1) instead of the never-built `helpers/fake-swarm-page.ts`; Task 4 Step 5 and the Task 7 A1 smoke construct `BetcrisSwarmScraper`, with baseline B from 05b Task 9; Task 7 A2's `navMs`/`firstUsefulFrameMs`/`attempts`/`loopLagMaxMs` fields become the Swarm line's `totalMs`/`skipped`, and failures log `[betcris] Full offer scraper error: …`; the "What still works" list loses the `scrapeMatchDetails` cache path. Bootstrap from `https://www.betsport.pl/` (`partnerConfigs` names `wss://eu-swarm-springre.trexname.com/`, the socket the SPA really opens), fallback site id 1874631. | `evidence/betcris-pzbuk/` |
| pzbuk.md | Plan 05's direct WebSocket client (one subscription for all events, 0.7–0.8 s) replaces Task 5 (browser wiring) and most of Task 2; Task 1's decoder/chunk assembler is reused unchanged (live traffic confirms 7 × 1 MiB chunks + tail); Tasks 4 and 6 are unaffected; acceptance A7/A8 change. If the browser path is kept: drop the "Pokaż więcej" clicks, finish when all declared groups answered, cancel the capture on a failed navigation, block `cdn-ukwest.onetrust.com`, fulfil images with a 1×1 PNG instead of aborting (aborted icons retry 160×) — note this needs request interception, which disables the HTTP cache, so plan 08 keeps pzbuk at `block: "none"` instead (08 Open Question 2). Knock-on edits (05c §amendments): Task 3's tests build their input with a local union by id instead of Task 2's `SingleEventAccumulator` (expected values unchanged); A10 (`test-scrapers.sh test pzbuk`) is retired for the default transport; Task 7's duration threshold becomes < 3 s and its `test-scrapers.sh` step is dropped; observability A4's pzbuk row (`websockets opened: …`) describes the broken state and is no longer expected. | `evidence/betcris-pzbuk/` (incl. `pzbuk-direct3*`: listing events carry `marketGroups[].marketsCount`; 19/19 events matched their declared totals) |
| sts.md | Ship Task 1 first; plan 05 reuses its `recordStsFrame`/`hasFixtureSnapshot` and keeps the log line `No fixture snapshot … skipping`. Add a circuit breaker to Task 1's retry (after 3 consecutive misses stop and keep the previous rows; a systemic miss otherwise costs 10–29 min), with the same failure shape 05a uses on the WebSocket path: `success:false`, `matches: []`, `error: "<n> of <m> details failed | <first cause>"` (on the browser path the cause is `no fixture snapshot <url>`; on the WebSocket path it is e.g. `ws timeout <ms>ms <url>`). After 05a merges, sts.md Acceptance B/C run on the WebSocket path by default; checking the browser path needs `SCRAPER_TRANSPORT_STS=browser`. | `evidence/sts-superbet/` |
| betcris.md Task 6 (unmapped-ids summary) | Plan 01 Task 8 implements the same module, names and log line (default top 20 instead of 5) and extends it to the factory's per-market "mapped to OTHER" warning. If 01 lands first, skip betcris Task 6; if betcris Task 6 lands first, 01 Task 8 only changes the default, adds tests and edits `factory.ts`. Both edit the loop in `scrape-helpers.ts` that 01 Task 7 also touches — rebase by snippet. | `01-quick-wins.md` |
| observability.md Task 1 (`classifyBookmakerRun`) | Add one rule: `success: true` **with** an `error` and `marketsSaved > 0` → `partial`, carrying the cause (scraper error and save errors joined with `" | "`). Today's rule returns `success` and drops the cause. Producers of this shape: `HttpScraper` with ≤ 50 % skipped details (02), betclic skipped matches (06), sts snapshot misses below the breaker (05a), a tripped prune guard (09 `pruneSkipped`). **Owner: plan 07** (explicit task, adapted to the classifier as actually built on `recovery/observability`). | `06-betclic-transport.md`, `07-orchestration.md`, `09-db-write-model.md` |
| observability.md Task 2 | Browserless scrapers bypass the page-based navigation recorder; they must put the cause in `error` themselves using the same wording (`fetch HTTP <status> <url>`, joined with `" | "`). §3 `HttpError` produces exactly that. | — |
| observability.md Task 5 | `getLastScrapeTime` × 14 walks `idx_odds_scraped_at` backwards (97 ms for lebull on every `/api/odds`); add `(league_slug, bookmaker, scraped_at DESC)` or read `odds_snapshot` after plan 09. | `evidence/db-pipeline/` |

---

### 5.2 Status of the §5.1 amendments on the future base (2026-11-13)

| Amendment | Status | Where it lives now |
|---|---|---|
| totalbet: concurrency, 10–15 s timeouts, ~90 s budget, retry; skip instead of writing 1X2-only on detail failure | **Open.** Built code is sequential (`DETAIL_DELAY_MS=250`), 30 s timeout, no retry/budget; a failed detail writes the listing 1X2 only (`totalbet/index.ts:274-280`) and the run stays `success` | 02 Task 11 (transport parts, concurrency 4); 02 Task 13 failure behaviour gated on owner (§8 Q10) |
| betby: in-flight memo, timeouts, retry, failure stop, budget, no-browser spy | **Partly applied** (in-flight memo `shared/betby/client.ts:44-67`); the rest open. New: event failure silently falls back to listing markets with `success:true` (`shared/betby/scraper.ts:150-155`) | 02 Task 12 (per-host limit 8; a league's abort never cancels the shared snapshot load); 02 Task 13 failure behaviour gated on owner (§8 Q10) |
| betclic: destroy the source response; delete the fallback with/before Task 1 | Destroy: **applied** for identity wiring (`navigation.ts:108-125`). Fallback deletion: **open — and now urgent** (F1) | 06 Task 1 |
| betcris: decide OQ1 before Tasks 1–2; finish on `SINGLE_GAME_VIEW`; never block CSS; knock-on edits | OQ1: **owner said no** (EXECUTION C); Tasks 1–2 built. CSS: applied. `SINGLE_GAME_VIEW` finish: **open** (05b Part A). Knock-ons: obsolete | 05b Part A; Part B blocked |
| betcris Task 6 vs 01 Task 8 | Task 6 **landed** (`unmapped-summary.ts`, top 5) | 01 Task 8 only changes the default to 20, adds tests, edits `factory.ts` |
| pzbuk: direct socket replaces Task 5; browser-only amendments | Task 5 (browser wiring) **built**; 05c now replaces working browser code; browser-only amendments **not applied** (only needed if 05c is delayed); "skip Task 3" obsolete (built) | 05c |
| sts: Task 1 first; circuit breaker; Acceptance B/C via flag | Task 1 **built** (`recordStsFrame`, `hasFixtureSnapshot`); breaker **open → implemented by 05a Task 0** (also fixes `sts-run-check.py:21` for observability's `sts empty\|scrape_failed\|persist_failed:` lines); F17 probe runs with `SCRAPER_TRANSPORT_STS=browser` | 05a Task 0 (F2) |
| observability Task 1: `partial` rule | **Open** (`run-outcome.ts:79-80` returns `success`) | 07 Task 0 (F3) |
| observability Task 2: browserless error wording | Matches §3 (`fetch HTTP <status> <url>`); obs joins issues as `cause \| a; b` | — |
| observability Task 5: freshness index | **Open** | 09 Task 1 (F4) |
| totalbet/betby/pzbuk legacy methods minimal | Built; legacy inventory now ~2 300 lines | 10 Part B |
| Recovery greps of `[Aggregator/FullOffer] <bm> completed: …` (betby A6, pzbuk.md:1038) | **Broken** by observability's new line `<bm> <status>: N matches, M markets found, K saved[ - err]` | fix those acceptance commands when they are run |

## 6. Global constraints (every plan inherits these)

**Revision 2026-11-13 — the recovery `EXECUTION.md` workspace rules apply to every plan here** and override any older instruction below: worktrees branch from `recovery/integration` (or `master` after the owner's merge) under `aityper-scraper-api-worktrees/`; `node_modules` is a symlink to the main checkout — never `npm install`/`npm ci`, and stop and report before adding a dependency (plan 02's `ws`/`@types/ws` are already in the lockfile); run every vitest/tsc/tsx/Playwright command through `aityper-scraper-api-worktrees/bin/heavy` (`--live` for network or browser); worktree `.env` points Supabase at a dead port on purpose; never start the server or scheduler, never write to the DB, never apply migrations — write and unit-test them only; live acceptance that needs a persisting scrape is **deferred to the owner** (record the exact command and expected result); scratch output goes to `<worktree>/.scratch/`. The main checkout runs the live backend for the owner's UI work: never edit, checkout or write there.

- **Never edit `src/` in the live checkout.** `tsx watch` restarts on save and the startup scrape runs 5 s later. Work in a git worktree per plan; merging restarts the service once.
- Before **each** commit: `npx tsc --noEmit` and `npx vitest run` green (through `bin/heavy`). Baseline on the future base: 125 files / 2 243 tests (scratch merge, 2026-11-13); record the worktree's own baseline count before the first change (do not hard-code totals). `tsc` does not check `scripts/` or tests; for `scripts/*.ts` also run the standalone `tsc` command from observability.md "Global Constraints".
- `src/services/normalization/__tests__/golden.test.ts` must pass **unchanged** unless a task says otherwise. No plan here changes a parser's output or a normalizer's mapping; transport migrations must produce byte-identical `parseAllMarkets` input.
- **Parity gate for every transport migration:** (1) offline contract test — old path and new path fed the same recorded payloads produce deep-equal `FullMatchOffer[]` (ignoring `scrapedAt`); (2) one live `scripts/perf-smoke.ts --bookmaker <bm>` run in the same hour as a browser-path run: matches equal, markets and selections within ±2 %; (3) after merge, observability A10 (≥ 0.75 × run-2 `markets_saved`) on the next scheduled run. For pzbuk, 05c runs (2) against the now-built browser path **and** checks the server's own declared per-group market totals (±2 %); if the first browser run fails, the totals check alone is the reference.
- Commit messages concise, **no signature or attribution footers** (user's CLAUDE.md). Commit only when the user has asked for commits.
- Code and comments in English. No UI copy changes. Response shapes change additively only (frontend `aityper` consumes them over HTTP).
- New dependencies: only `ws` and `@types/ws` (plan 02), which are already in the lockfile — `package.json` entries only, and the task stops to report them to the owner before committing (EXECUTION). Nothing else without asking.
- DB migrations are numbered after observability's `11_scraper_runs_observability.sql` (plan 09 uses `11a_odds_freshness_index.sql` and 12–15, plan 10 uses `16_incremental_scrape_state.sql`; a future `scraper_runs.metrics` migration — plan 07 Open Question 3 — takes 17) and are applied **only** with operator approval via `./scripts/apply-migrations.sh <file>`; never the no-argument form. Read-only SQL for analysis.
- Live traffic stays modest: one bookmaker per smoke, never within HH:55–HH:10. Once plan 07 Task 4 has landed, runs no longer start on the hour: instead stay ≥ 5 min away from `/api/health` `nextScrapeAt` and never smoke while `currentRun` is set.
- Once plan 07 Task 1 has landed, `POST /api/admin/scrape` returns 409 while a run is in progress; recovery acceptance steps that POST it (pzbuk.md:1009, betby A6, observability Task 11, betcris.md A2) must retry after the current run.
- Log lines that recovery scripts parse must keep their exact format: sts `No fixture snapshot … skipping`; betclic `Found N events in listing`, `X vs Y: N markets total`, `Failed to fetch group`, `Incomplete gRPC-web frame`.

---

## 7. Expected outcome (targets)

These are the targets the whole set aims at. Each plan's live **pass gate** is deliberately looser (e.g. fortuna/superbet ≤ 5 s, lvbet ≤ 6 s, betclic ≤ 10 s, sts < 3 s, betcris < 5 s) and is the merge criterion; the targets are re-measured with `scripts/perf-smoke.ts` and `[ScrapeMetrics]` after the set has landed.

| Metric | Today | After 01–07 + 09 | Main contributors |
|---|---|---|---|
| Cycle wall time (PL, 14 bm) | 117–126 s | **≤ 25 s** | sts 120 s → < 2 s, betcris 126 s → ~2 s (05); betclic 28 s → ~7 s (06); HTTP scrapers 6–17 s → 1–3 s (03, 04) |
| Peak memory | ≈ 5.7 GB | **≤ 1 GB** (Node only) | no Chromium on the hourly path; no CDP clones; caches removed |
| CPU per cycle | 584 CPU-s | **≤ 60 CPU-s** | 530 Chromium CPU-s removed; Fuse memoized |
| Requests per cycle | ≈ 27 000 | **≈ 400** | page loads (13 758 betcris, 10 472 sts) gone |
| Bytes per cycle | 131 MB | **≈ 40–50 MB** | gzip on betclic (5×), no page assets; lvbet's 16 MB uncompressed JSON remains |
| betclic loss under load | −9…−12 % markets | **0** | betclic Task 1 + event-loop relief (01, 04) |
| DB rows written per run | 64 k inserts + 64 k deletes | **~2–4 k updates/inserts** | write only changes (09) |
| WAL per row per run | ~2.3 KB | ~0.2 KB | 09 (measured 2 261 → 218 B/row on a throwaway DB) |
| `getMatchOdds` | 7.7 s | 45 ms | 09 Task 1 |
| Per-match page DB time | ~0.6 s, temp spills | 23–65 ms | 09 `get_match_market_rows` |
| Restarts that start a full scrape | every restart | only if the last OK run is older than the interval | 07 |
| A hung request | wedges the scheduler forever | bounded by the job budget + 5 s grace (HTTP/WebSocket 120 s, browser 240 s; overrides in plan 07 `job-budgets.ts`: sts 360 s, betcris 600 s, pzbuk 600 s while on the browser) | 02, 07 |

---

## 8. Open questions for the owner

1. **Browserless WebSocket clients for sts and pzbuk.** The protocols are undocumented and fronted by Cloudflare (sts) — accept the risk with a per-bookmaker browser fallback flag kept for at least one release? [yes, with fallback]. *For betcris the owner already answered **no** (EXECUTION C: no Node Swarm client); plan 05b Part B stays a ready option, Part A (browser-path quick wins) is executable.* Re-open betcris only with the numbers: browser path ≈ 102–126 s and 13 758 requests per run vs a verified 1.0 s Swarm request. If the answer ever becomes yes: may the Swarm config bootstrap GET `www.betsport.pl` (whose `partnerConfigs` names the socket the SPA really uses), or must it stay on `www.betcris.pl` (EXECUTION C keeps that base URL; its config names a socket that also accepts the site id)? [betcris.pl, to honour C]
2. **Prune guard** — the owner **deferred** it (EXECUTION B13). Re-ask with the new evidence: besides the sts 1-market writes, two recovery-built paths now write degenerate snapshots that prune full ones — totalbet's listing-1X2-only write on a failed detail (`totalbet/index.ts:274-280`, ~450-market snapshot pruned) and betby's silent listing fallback (`shared/betby/scraper.ts:150-155`). Plan 09 batches the prune unconditionally and implements the guard (< 10 % of previous rows, previous ≥ 20) behind a setting that stays **off** until the owner says yes. [turn it on]
3. **Stale quotes** — answered by the owner (EXECUTION B12): stale quotes stay in place and are only made visible. Plan 09 Task 8 marks them (`stale: true`, `stats.staleBookmakers`, threshold observability `staleAfterMs` = max(2 × interval, 60 min)); `EXCLUDE_STALE_FROM_BEST_ODDS` exists but stays off. [no change unless the owner revisits]
4. **In-play writes:** reject writes for matches whose kickoff has passed (Everton–Coventry was stored at 21:00Z after a 20:00Z kickoff)? [yes]
5. **Adaptive cadence** (plan 10): maximum staleness 6 h for matches more than 72 h away, 2 h inside 72 h, 10 min inside 1 h? [as proposed]
6. **`STARTUP_SCRAPE` default** in dev: `auto` (scrape on boot only if the last OK run is older than the interval). [auto]
7. **Production Playwright:** keep Chromium installed for the fallback flags and the audit/discovery tooling? [keep]
8. **History table** (`odds_history`, append on change, never pruned by retention): approve as the data foundation for the +EV model (memory note "ML value-model idea")? [yes]
9. **Fuzzy matcher on non-team labels** ("tak" → Stoke City, "nie" → Sunderland): skip Fuse for inputs shorter than 4 characters, containing digits, or in a small stop-list of selection words ("tak", "nie", "powyżej", "poniżej", "remis", …)? It is a behaviour change, so it needs its own task with a golden diff and an audit of the team-side callers (`helpers/index.ts:225-232`, `lvbet-normalizer.ts:602`, `fuksiarz-normalizer.ts:363`, `betclic-normalizer.ts:1046,1069`). Under the odds-integrity priority this should be done soon, in its own plan. [yes, separate plan]
10. **Failed detail on totalbet and betby: skip the match or write listing data?** Their recovery plans chose listing data (totalbet: 1X2 only; betby: listing markets) and EXECUTION says "follow each plan's own default". With the prune guard deferred, each such write deletes the match's full snapshot for an hour. Plan 02's adapter tasks implement the timeouts/retry/budget unconditionally and the switch to "skip the match, keep the previous snapshot" (README principle 3) only on an owner yes. [skip]
11. **Commit this plan directory** to `recovery/integration` as a docs-only commit (like the recovery plans), so worktrees contain it and implementers stop reading it from the main checkout? [yes, when the owner starts executing]
12. **betcris and sts browser budgets** while they stay on Playwright (owner C; sts until 05a): plan 07 `job-budgets.ts` gives sts 360 s and betcris 600 s (A1 took 100.8 s; its retry worst case through the breaker is ≈ 546 s), pzbuk 600 s on the browser; plan 08 uses the same values as session lifetimes. [as proposed]
13. **betcris partial results on a budget cut:** today a betcris run cut by its budget loses every game it already captured, because it returns only at the end of its loop. Return the captured games with the cause (status `partial` via 07 Task 0) instead? It changes recovery-built code that EXECUTION C says to keep ("keep today's pooling"). [yes, as a small task next to 05b Part A]
14. **Plan pin sets:** plans 03–05 change which instance `getScraper(bm)` returns; each must update plan 07's runtime transport pin test in the same commit (plan 10 Task 18 lists the pick locations). [process rule, no decision needed]

---

## 9. Evidence index

All under `evidence/` (copied from the analysis scratchpad; untracked like the rest of `docs/superpowers/`):

| Path | Contents |
|---|---|
| `findings-notes.md` | Condensed notes from all ten analyses (numbers, file:line, decisions) |
| `profiling/` | `harness.mts` (instrumented runner), `summary-individual.json`, `summary-parallel-p1.json`, `summary-parallel-p2nonet.json`, `metrics*.json`, `samples/` (500 ms process samples), `raw/<bm>.json` (14 individual `scrapeFullOffer` results), `norm/`, `cpuprof/`, `memmodel.json`, `logs/` |
| `sts-superbet/` | `sts-ws-probe.mjs` (direct WebSocket), `sts-parity.mts` (counts vs browser), `superbet-probe.mjs`, `sb-serialize.mjs`, `data/` |
| `betclic-fortuna/` | gRPC gzip probes, tab-scraper reproduction, fortuna HTTP probes, serialization benchmark |
| `lvbet-fuksiarz/` | page-load traces, API probe responses + headers |
| `betfan-totalbet/` | `probe-pageload.cjs`, `bench-evaluate.cjs`, captured list/detail payloads, headers |
| `forbet-etoto/` | `probe-http-run.mjs` (browserless prototype), page-load probe, benchmarks |
| `betters-lebull/` | dead-path cost probe, Betby endpoint probes (`probe/`, `live/`) |
| `betcris-pzbuk/` | `swarm-bulk.mjs` (Swarm client), `pzbuk-direct2.mjs` (direct socket), blocking experiments |
| `core/` | `target-architecture.ts` (full code sketch), `cache-vs-route.mts`, `fingerprint.mts`, `ua-metadata.mts`, `features2.mts`, `legacy-lines.mts` |
| `db-pipeline/` | `README-evidence.txt`, `proposed-write-model.sql` (tested on throwaway PG16), `wal-sim.out`, `bench-normalize.mts`, `eventloop-timer-demo.mjs`, EXPLAIN outputs |
| `cross-plan-review-2026-11-07.md` | 39 cross-plan consistency findings with the orchestrator's decision and owner plan for each |
| `delta-audit-transport-2026-11-13.md`, `delta-audit-infra-2026-11-13.md` | What changed on the future base (`recovery/integration` + observability + fortuna) versus the plans' original assumptions, per plan |
