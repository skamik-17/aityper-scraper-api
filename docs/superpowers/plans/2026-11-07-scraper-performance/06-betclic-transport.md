# Betclic Transport (no fallback, gzip, bounded concurrency, budget) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:**
> - **Base moved.** Target = `recovery/integration` (≥ `aaf7c07`) + `recovery/observability` + `recovery/fortuna` (README "Revision 2026-11-13"). betclic.md Task 1 is merged (221bc41 / b9106de, merge 2e42083) **without** this plan's Task 1: `tab-scraper.ts` (548 lines) and `fetchMarketsHybrid` (`navigation.ts:577-678`, browser launch `:636`) are intact and `index.ts:280` calls it, so a match left with only TOP valid reaches the broken fallback, is written with TOP only, and its other markets are pruned. **Task 1 is now an immediate follow-up on integration (README §5.0 F1) and needs neither plan 02 nor observability.**
> - **Task 2 shrinks.** The complete-frame reader landed (`navigation.ts:206-302`, `GRPC_FRAME_DEADLINE = 10000` at `constants.ts:172`) and already destroys `res` on non-200 (`:108-112`), trailers-only (`:114-120`) and every reader settle (`:225-231`). Left: `req.destroy` on those paths, gzip with a `release` hook that destroys the **source**, the unsupported-encoding reject, and stats.
> - **Task 4 shrinks** to the header's category list (field 10). Betclic `start_time` stays with plan 01 Task 4 (listing field 3); this plan never sets `startTime` (cross-plan #1).
> - **Rebaseline:** the post-fix sequential smoke takes **10.2 s for 19 matches** (`smoke-after-fix-betclic.txt`, unloaded, bytes unchanged because there is no gzip). Task 8's concurrency gate is now relative to a sequential run in the same hour.
> - Line refs: `navigation.ts` +118 (`fetchAllMarketGroups :481-523`, hash helpers + `fetchMarketsHybrid :525-678`, protected lines `:490-492/:500-503/:514/:518-520`, `>= 100` filter `:512`); `index.ts`, `constants.ts`, `parser.ts`, `types.ts`, `src/AGENTS.md` and README refs unchanged. The Arsenal–Hull fixtures are already tracked, `grpc-web-frame.test.ts` is extended rather than duplicated, `check-log-vs-smoke.py` (b9106de) now counts more retry kinds.
> - EXECUTION workspace rules adopted (worktree from `recovery/integration`, `bin/heavy`, no `npm install`, dead-port `.env`, scratch in `.scratch/`, absolute evidence paths, persisting live checks deferred to the owner); `.env.example` entries for `BETCLIC_MATCH_CONCURRENCY` / `BETCLIC_HTTP2` (cross-plan #33); the class declares `transport = "http"` (README §3, plan 07 classification); the `full-offer-fixtures.test.ts` mock is updated if plan 01's harness exists (cross-plan #3).
> - Evidence: `evidence/delta-audit-transport-2026-11-13.md` ("Cross-cutting", "06-betclic-transport"), `evidence/cross-plan-review-2026-11-07.md` #1, #3, #28, #33.

**Goal:** Delete betclic's broken Playwright fallback now (it is reachable on integration), then cut a premier-league run's wire bytes ≈ 5× with gzip (25.9 MB → ≈ 5 MB, ≤ 0.7 MB per OPTA match) and its wall time below the ≈ 10 s sequential reference by fetching 3 matches at a time, without losing markets. Parse each distinct group payload once, require only the groups the match declares in its header, and bound the run with a 90 s budget.

**Architecture:** Betclic already runs without a browser (gRPC-web-text over Node `https`).
- **Per match:** one function fetches the 7 category groups and judges them with a pure rule (`assessMatchGroups`). The match is skipped unless TOP is present and every *required* group completed. Payloads byte-identical to an earlier group are dropped, the rest are parsed, and the declared categories come from the match header that every group response carries.
- **Transport:** gzip sits in front of betclic.md Task 1's complete-frame reader (`readGrpcWebTextStream`, `navigation.ts:206-302`) as `stream.pipeline(res, zlib.createGunzip())`. Every settle destroys the **source** `res` and `req` through one `release()` hook. Counters are exposed through plan 02's `TransportStatsSource`.
- **Run:** `scrapeFullOffer(league, budget?)` maps over the listing with `mapLimit(…, 3)` under a `ScrapeBudget` capped at 90 s.

**Tech Stack:** TypeScript (ESM, Node 20.19), `node:https`/`node:http`/`node:zlib`/`node:stream`/`node:events`/`node:timers/promises`, Vitest 4, tsx, python3 (existing log checker).

**Spec:**
- README: §1.1 (betclic −9…−12 % markets, −15…−40 % selections under load), §1.5 (fallback row), §2 (betclic box), §3, §5.0 (F1, P3), §5.2 (betclic row), §6, §7 (betclic loss 0). From §3 this plan uses `ScrapeBudget`, `createScrapeBudget`, `BudgetExceededError`, `mapLimit`, `MAX_SKIPPED_DETAIL_RATIO`, `FullOfferScraper`, `DeclaresTransport`, and the refinements `TransportStats` / `TransportStatsSource` / `hasTransportStats` (cumulative, monotonic counters) and the HttpScraper `success: true` + `error` rule.
- Plans: 02 Task 1 (budget and `mapLimit` semantics), Task 5 (`TransportStats`), Task 10 (`perf-smoke.ts`); 01 Task 4 (betclic `start_time` from listing field 3 — **not** this plan); 07 Task 0 (`partial` mapping of this plan's result contract).
- Evidence. `$E` = `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence` (untracked: always read it by this absolute path, never copy it from a relative path inside a worktree). `$R` = `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic` (tracked on integration, so it exists inside the worktree).
  - `$E/betclic-fortuna/`: `betclic-probe{,2}.mjs`, `betclic-tabs.mjs`, `tabscraper-check.mts`, `parse-cpu.mts`, `top.bin`, `gsc.bin`.
  - `$E/profiling/summary-{individual,parallel-p1,parallel-p2nonet}.json`, `$E/profiling/metrics-individual-betclic.json`; `$E/findings-notes.md`: BETCLIC-1…8.
  - `$R/`: `stream-probe-output.txt`, `group-sizes-run{1-run2,3}.txt`, `truncation-repro-output.txt`, `check-log-vs-smoke.py`, `log-vs-smoke-current.txt`, `smoke-after-fix-betclic.txt`, `smoke-full-offer.mts`, the two `arsenal-hull_*.grpc-web-text.b64` captures (also tracked at `src/scrapers/bookmakers/betclic/__tests__/fixtures/`).

## Global Constraints

- **Workspace (recovery `EXECUTION.md`, README §6 revision).** `H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees`. Work in your own worktree under `$H` (e.g. `$H/perf-06-betclic`, branch `perf/06-betclic`) created from `recovery/integration` like the recovery worktrees: `node_modules` is a symlink to the main checkout's, `.env` is a copy of `$H/integration/.env` (Supabase on the dead port `http://127.0.0.1:9`; never change it). Never `npm install`/`npm ci`, never edit or run anything that writes in the main checkout, never start the server or the scheduler, never write to the DB. **`heavy`** below means `$H/bin/heavy`: every `npx vitest`, `npx tsc` and `npx tsx` runs through it, with `--live` for anything that reaches betclic. During TDD run only the scoped tests; run `heavy npx vitest run` and `heavy npx tsc --noEmit` once at the end of each task. Scratch output goes to `<worktree>/.scratch/`. Record the worktree's own baseline before the first change (integration alone: 91 files / 1 725 tests; future base: 125 / 2 243).
- **README §6 applies** (golden test unchanged, no attribution footers, one commit per task with the message given).
- **Order (README §5.0).**
  - **Task 1 = F1:** an immediate follow-up on `recovery/integration`. It needs neither plan 02 nor observability.
  - Tasks 3, 4 and 5 need only Task 1. Tasks 2, 6 and 7 also need plan 02 (`TransportStats*`, `mapLimit`, budget). Task 8 runs after Task 7.
  - Plan 01 Task 4 (betclic `startTime` from listing field 3) lands after Task 1 and sets `startTime` inside `fetchMatchOffer`'s offer construction. If plan 01 Task 4 landed first, Task 1 carries its `startTime` line over verbatim.
- **Protected log lines.** Each is one `console.*` call, so concurrent matches interleave whole lines only:
  - `[Betclic/FullOffer] Found ${n} events in listing` (`index.ts:258`);
  - `[Betclic/FullOffer] ${home} vs ${away}: ${n} markets total` (`index.ts:311-313`);
  - `[Betclic/Navigation] Failed to fetch group ${group}:` (`navigation.ts:500-503`);
  - betclic.md Task 1's retry line `[Betclic/Navigation] Attempt n/3 failed: <message>` (`navigation.ts:63-65`), whose message starts with one of `check-log-vs-smoke.py`'s `RETRY_KINDS` (`incomplete`, `deadline`, `trailer`, `compressed`, `emptyFrame`, `grpcError`, `requestTimeout`; anything else counts as `otherRetries`).

  New lines start with `[Betclic/Transport]`, `[Betclic/FullOffer] Skipping`, `[Betclic/FullOffer] Budget` or `[betclic] `; none matches the checker's patterns. New retry messages: `Incomplete gRPC-web frame: gzip Z_…` (counted as `incomplete`), `gRPC-web unsupported content-encoding <enc>` and `gRPC aborted <url>` (both `otherRetries`).
- **Required groups (K).**
  - TOP must complete and be ≥ `MIN_GROUP_BYTES` = 100 (today's filter, `navigation.ts:512`).
  - Task 1 requires all 7 groups.
  - Task 5 requires TOP plus every fetched category that TOP's header declares. That is 6 on both recorded OPTA matches, where `ca_ftb_goalm` is undeclared. All 7 stay required when the header is unreadable.
- **Result contract (same as §3 `HttpScraper`).**
  - With `n` skipped out of `m = written + n` and `n > 0`: `error = "<n> of <m> details failed | <first reason>"`, logged as `console.warn(\`[betclic] ${error}\`)`.
  - `n/m > MAX_SKIPPED_DETAIL_RATIO` → `success: false, matches: []`. Otherwise `success: true` **with** that `error`.
  - Budget-stopped matches are not counted in `m`. They add `budget exhausted: <k> of <listed> matches not completed`, joined after any skip text with `"; "`.
  - 0 written → `success: false`.
- **Outcome mapping.** `success: true` + `error` + `marketsSaved > 0` → `partial` (an OK status; `scraper_runs.error_message` keeps the cause). Observability's `classifyBookmakerRun` does not do this yet (`run-outcome.ts:79-80` returns `success` and drops the cause); **plan 07 Task 0 (README §5.0 F3) adds the rule**. Until it lands, the cause lives only in the `[betclic]` / `Skipping` / `Budget` lines.
- **Constants.**
  - `BETCLIC_MATCH_CONCURRENCY` = 3. The env override `BETCLIC_MATCH_CONCURRENCY` accepts integers 1–7; anything else gives 3.
  - `BETCLIC_MAX_DURATION_MS` = 90 000.
  - `GRPC_FRAME_DEADLINE` = 10 000 (`constants.ts:172`).
  - `MAX_RETRIES` = 3 and `RETRY_DELAY` = 1000 stay unchanged (`constants.ts:177`, `:182`).
- **`Accept-Encoding: gzip` only.** It is added in `fetchGrpcWithNodeHttp`. `GRPC_HEADERS` (`constants.ts:32-44`) stays as is, because `$R/stream-probe.mts` sends it raw and expects text.
- **Parser.** `parser.ts` only gains `parseMatchHeader` (Task 4) and, optionally, the Task 10 extraction. `parseAllMarketsFrom*` output is unchanged, and the golden test passes unchanged.
- **Transport declaration.** `BetclicPlaywrightScraper` declares `readonly transport = "http" as const` (README §3 `DeclaresTransport`; plan 07 Task 2 classifies jobs by it). Task 1 adds it because it is the first task that touches the class.
- **No new dependencies.** Tests make no live network calls: full-offer tests mock `../navigation.js`, transport tests use `node:http` on `127.0.0.1:0`, and no test may reach `PlaywrightScraper.prototype.initBrowser` (spied to reject, like `totalbet/__tests__/scraper.test.ts:55`).

## Review Focus

1. **A settle that leaves the request or the socket open.** Today non-200 (`navigation.ts:108-112`) and trailers-only (`:114-120`) call `res.destroy()` only, and the reader destroys whatever stream it was given (`:229`), which after gzip is the gunzip wrapper, not the socket. Every settle path must destroy the source `res` **and** `req` exactly once through `release()`: frame complete, deadline, non-200, `grpc-status`, unsupported encoding, abort. Tests: `HTTP 503 rejects and closes the socket`, `closes the source socket on the frame deadline`, `readGrpcWebTextStream calls release exactly once per settle` (Task 2).
2. **A gzip stream cut mid-member and then ended** (proxy reset). zlib raises `Z_BUF_ERROR` instead of `end`. The read must reject as `Incomplete gRPC-web frame: gzip Z_BUF_ERROR …`, which is retried and counted by the checker as `incomplete`. It must never resolve partial data. Test: `a gzip stream that ends mid-member rejects as an incomplete frame` (Task 2).
3. **The server stops compressing, or picks another coding.** Identity decodes as today. `br`/`deflate` reject with `gRPC-web unsupported content-encoding <enc>` before reading. Tests: `identity response still resolves…` and `rejects an unsupported content-encoding…` (Task 2).
4. **Echo groups and undeclared categories.** An undeclared category returns TOP's bytes (`ca_ftb_goalm`, and the far-match echoes). Today `uniqueHashes.length === 1` (`navigation.ts:597-600`) launches the broken browser path. Now:
   - the match is written from the API, and `initBrowser` is never reached;
   - each distinct payload is parsed once;
   - a failed undeclared group never skips the match;
   - an unreadable header never relaxes K.

   Tests: `writes every match whose groups completed, never touching a browser` (Task 1), `far-match echo…` (Task 3), `METODA_GOLA failing on an OPTA match does not skip it` / `an unreadable header keeps all 7 required` (Task 5).
5. **The budget expires with matches in flight.**
   - In-flight sockets close, and nothing is retried after the abort.
   - A match whose required groups completed is kept.
   - Aborted matches are neither written nor counted as failed.
   - Unstarted matches never start.
   - A parent budget that is already spent fails cleanly. It must not raise `RangeError`: plan 02's `remainingMs()` is 0 once aborted, and `createScrapeBudget(0)` throws.

   Tests (Task 7): `stops starting matches once the budget aborts…`, `a match aborted in flight is not counted as failed`, `a spent caller budget fails before the listing`, `an abort mid-stream rejects "gRPC aborted <url>"…`.

---

## Observations (pre-fix analysis)

Line numbers are on the future base (identical to `recovery/integration` for every betclic file).

- **Run shape today.**
  - Each run is one listing call, then 7 parallel `GetMatchWithNotification` calls per match through `fetchMarketsHybrid` (`index.ts:280`) → `fetchAllMarketGroups` (`navigation.ts:487-523`).
  - Matches run strictly one after another, with `delay(50)` between them (`index.ts:264-323`, `:316`).
  - On 2026-11-06 (before betclic.md Task 1) a run of 19 matches made 134 requests, moved 25 855 136 bytes and took 27.6 s alone (`$E/profiling/metrics-individual-betclic.json`). After betclic.md Task 1 the same 19 matches take **10.2 s** sequentially, unloaded, with unchanged bytes (`$R/smoke-after-fix-betclic.txt`, 2026-11-07 01:02Z, `durationMs: 10192`).
- **The reader is complete-frame now.** betclic.md Task 1 replaced the 1000 ms cut-off with `readGrpcWebTextStream` (`navigation.ts:206-302`): it resolves on the first complete frame, rejects on `end` mid-frame, on the `GRPC_FRAME_DEADLINE` (10 s, counted from the request start), on a trailer, compressed or empty frame, and destroys `res` on every settle. That precondition for concurrency is met.
- **No compression.**
  - No `Accept-Encoding` is sent, so one OPTA match (Arsenal–Hull) costs 3 087 120 base64 chars on the wire (the sum of `b64Chars` in `$R/stream-probe-output.txt`).
  - Live gzip is 5–5.7× smaller (`betclic-probe2.mjs`, BETCLIC-1). Offline with zlib defaults and a sync flush: `top.bin` 259 304 chars → 36 489 B, `gsc.bin` 1 691 272 → 194 707 B. At 5×, an OPTA match comes to ≈ 0.62 MB.
- **Every group response starts with the match header** (decoded from Arsenal–Hull TOP and HANDICAP, Leeds–Tottenham `top.bin` and `gsc.bin`).
  - Field 3 is the kickoff, e.g. `"2026-11-07T15:00:00.0000000Z"`; plan 01 Task 4 already takes the same value from the listing's field 3, so this plan ignores it.
  - Field 10 lists the declared categories (field 2 = id). Both OPTA matches declare the same 8: `ca_ftb_top, ca_ftb_ft, ca_ftb_rslt, ca_ftb_pssb, ca_ftb_gsc, ca_ftb_goa, ca_ftb_cshcp, ca_ftb_prp`.
  - **`ca_ftb_goalm` (METODA_GOLA) is not among them, so the server answers it with TOP's payload.** Evidence: 197 816 B for both in `$R/stream-probe-output.txt`, and equal sizes in 16/20 matches of run 3 (2–242 B apart in the other 4).
- **Live probe (2026-11-07 02:11Z, 2 requests: listing + one TOP).**
  - Both endpoints honour `Accept-Encoding: gzip`.
  - All 19 listing entries carry field 3 but none carries field 10.
  - The far match Brentford–Everton declares only `top, ft, rslt, goa, cshcp`. So STRZELCY (`gsc`), STATYSTYKI (`prp`) and METODA_GOLA are undeclared, and these are exactly the 3 groups that equal TOP's size on all 10 far matches of run 3. Its TOP was 14 858 B, or 5 633 B gzipped on the wire.
- **Unfetched categories.** `ca_ftb_ft` ("⚡ Fast") and `ca_ftb_pssb` (SuperSub) are declared but never fetched (Open Question 3).
- **Parse cost.** Offline, TOP takes 10 ms and STRZELCY 63 ms; a whole match is ~200 ms of synchronous work (BETCLIC-5). `Buffer.equals` on 194 KB takes 0.1 ms.
- **Group failures are rare; a missing group is expensive.**
  - 420 loaded group fetches failed 0 times (3 runs, `$R/log-vs-smoke-current.txt`). The smallest group was 8 230 B.
  - A missing declared group loses markets no other group has: STRZELCY truncated gives 265 → 242 markets, STATYSTYKI halved gives 152 (`$R/truncation-repro-output.txt`). Those rows would then be pruned for an hour.
- **The Playwright fallback is broken and reachable now.**
  - When all valid responses share one hash (`navigation.ts:597-600`), `fetchMarketsHybrid` (`:577-678`) launches `BetclicPlaywrightTabScraper` (`tab-scraper.ts`, 548 lines; launch at `navigation.ts:636`). When it fails, the API responses are returned "as ultimate fallback". With none valid, `[]` is returned silently.
  - It is broken three ways (verified, `tabscraper-check.mts`, `betclic-tabs.mjs`):
    1. `route.abort()` aborts the main document (`tab-scraper.ts:203` route, `net::ERR_FAILED`).
    2. The `[role="tab"]` selectors match nothing.
    3. The session it caches was already closed by `executeWithBrowser`'s `finally` (`playwright-base.ts:348-350`). The next call reuses a closed page and releases the browser a second time.
  - Since betclic.md Task 1 merged, a match whose non-TOP groups failed (or only echo TOP) reaches this path: the browser fails, the match is written from TOP alone, and the prune deletes its other markets for an hour.
- **Loss under load.**
  - In the parallel profiling runs, with no browser involved, betclic kept 19/19 matches but saved 2 894 / 3 019 markets instead of 3 302, and 18 129 / 25 977 selections instead of 30 438 (`$E/profiling/summary-parallel-p{1,2nonet}.json`). The cause was the 1000 ms cut-off firing while the event loop was blocked (`$E/db-pipeline/eventloop-timer-demo.mjs`), which betclic.md Task 1 removed.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/bookmakers/betclic/tab-scraper.ts` | **deleted** | 1 |
| `src/scrapers/bookmakers/betclic/match-groups.ts` (new) | `BetclicGroupName`, `BetclicGroupResult`, `assessMatchGroups` (required-group rule), duplicate detection, declared categories | 1, 3, 5 |
| `src/scrapers/bookmakers/betclic/navigation.ts` | `fetchMarketGroupResults`; `fetchAllMarketGroups` becomes a wrapper; `fetchMarketsHybrid` and the hash helpers are deleted. Later: gzip, `release`, stats, http seam, `signal` | 1, 2, 7 |
| `src/scrapers/bookmakers/betclic/parser.ts` | `parseMatchHeader` (new export only) | 4 |
| `src/scrapers/bookmakers/betclic/constants.ts` | delete the `TAB_SELECTORS` block; `resolveBetclicMatchConcurrency`, `BETCLIC_MAX_DURATION_MS` | 1, 6, 7 |
| `src/scrapers/bookmakers/betclic/index.ts` | `transport`, per-match `fetchMatchOffer`, result contract, transport lines, `transportStats()`, `mapLimit`, budget | 1–7 |
| `src/scrapers/bookmakers/betclic/README.md`, `src/AGENTS.md` | Data Flow, fallback docs removed, gzip troubleshooting row | 1, 2 |
| `.env.example` | commented `BETCLIC_MATCH_CONCURRENCY` (6) and `BETCLIC_HTTP2` (9) entries | 6, 9 |
| `src/scrapers/bookmakers/betclic/__tests__/betclic-fixtures.ts` (new, test helper) | `TOP_B64`, `HANDICAP_B64`, `TOP_MSG`, `HANDICAP_MSG`, `ORDER`, `groupResults()` | 1 |
| `src/scrapers/bookmakers/betclic/__tests__/match-groups.test.ts` (new) | required-group rule, duplicates, declared categories, header | 1, 3, 4, 5 |
| `src/scrapers/bookmakers/betclic/__tests__/full-offer.test.ts` (new) | `scrapeFullOffer` with mocked navigation | 1–7 |
| `src/scrapers/bookmakers/betclic/__tests__/grpc-web-frame.test.ts` (existing) | reader `release` contract | 2 |
| `src/scrapers/bookmakers/betclic/__tests__/grpc-transport.test.ts` (new) | gzip, destroy, stats and abort against a local `node:http` server | 2, 7 |
| `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` (plan 01, only if it exists) | betclic mock moves to `fetchMarketGroupResults` | 1 |

Fixtures: `src/scrapers/bookmakers/betclic/__tests__/fixtures/arsenal-hull_{HANDICAP,TOP}.grpc-web-text.b64` are tracked already (betclic.md Task 1); no copy step.

---

### Task 1: Delete the broken Playwright fallback; skip incomplete matches (README §5.0 F1)

An immediate follow-up on `recovery/integration`. No dependency on plan 02 or observability.

**Files:**
- Delete: `src/scrapers/bookmakers/betclic/tab-scraper.ts`.
- Create: `src/scrapers/bookmakers/betclic/match-groups.ts` and `__tests__/betclic-fixtures.ts`.
- Modify `navigation.ts`:
  - `:29-30`: drop the `tab-scraper` and `crypto` imports;
  - `:481-523`: replace `fetchAllMarketGroups` with `fetchMarketGroupResults` plus a wrapper;
  - delete `:525-678` (`calculateBufferHash`, `calculateBufferHashes`, `fetchMarketsHybrid`).
- Modify `constants.ts:274-327`: delete `TAB_SELECTORS`, `TabSelectorEntry`, `TabName` and `getTabSelector`. Their only other references are `tab-scraper.ts` and `src/AGENTS.md`.
- Modify `index.ts`: imports at `:23-30`; class field `readonly transport = "http" as const` after `:50`; the loop body at `:262-336` becomes `fetchMatchOffer` plus the result contract.
- Docs:
  - `src/scrapers/bookmakers/betclic/README.md:79-100`: Data Flow;
  - `src/AGENTS.md:250`: drop `TAB_SELECTORS`;
  - delete `src/AGENTS.md:255-297` (TAB_SELECTORS Pattern and the tab-scraper performance patterns).
- Only if plan 01 Task 2 already created `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts`: replace its betclic `fetchMarketsHybrid` mock with `fetchMarketGroupResults` resolving 7 `BetclicGroupResult`s (`groupResults()` from this task's helper). If it does not exist yet, plan 01 writes its harness against `fetchMarketGroupResults`.
- Test: `__tests__/match-groups.test.ts`, `__tests__/full-offer.test.ts`.

**Interfaces:**
- Produces (`match-groups.ts`):
  ```ts
  export type BetclicGroupName = keyof typeof MARKET_GROUP_FILTERS; // "TOP" | "WYNIK" | "STRZELCY" | "GOLE" | "METODA_GOLA" | "HANDICAP" | "STATYSTYKI"
  export interface BetclicGroupResult { group: BetclicGroupName; response: Buffer | null; error: string | null }
  export const MIN_GROUP_BYTES = 100;
  export type MatchGroupAssessment =
    | { ok: true; responses: Buffer[]; emptyGroups: BetclicGroupName[] }
    | { ok: false; reason: string };
  export function assessMatchGroups(results: readonly BetclicGroupResult[]): MatchGroupAssessment;
  ```
  Rules, in order:
  1. TOP absent, errored, or < 100 B → `TOP missing: <error | "<n> bytes">`.
  2. Every group is required in this task. A group is *valid* when it completed without error, whatever its size. An absent group fails with `not fetched`. If any required group is not valid → `<valid>/<required> required groups valid; failed: <G> (<error>); <G> (<error>)`, listing only the failed required groups, in `MARKET_GROUP_FILTERS` order.
  3. Otherwise `ok`. `responses` holds the completed buffers ≥ 100 B in group order. `emptyGroups` holds the completed groups under 100 B.
- Produces (`navigation.ts`):
  - `fetchMarketGroupResults(matchId: string): Promise<BetclicGroupResult[]>` returns 7 entries in `MARKET_GROUP_FILTERS` order and never throws. It keeps the 4 existing log lines byte-for-byte (`:490-492`, `:500-503`, `:514`, `:518-520`).
  - `fetchAllMarketGroups(matchId): Promise<Buffer[]>` keeps its contract for `scripts/betclic-{prep,selections,strict}-audit.ts` (`:15/:208`, `:18/:73`, `:21/:70`): the ≥ 100 B responses, in order.
- Produces (`index.ts`):
  - `readonly transport = "http" as const;` on `BetclicPlaywrightScraper`.
  - private `fetchMatchOffer(m: BetclicListingMatch, ctx: MatchFetchContext): Promise<BetclicMatchOutcome>`; `MatchFetchContext = { league: string }` (Tasks 2 and 7 add fields); `BetclicMatchOutcome = { kind: "written"; offer: FullMatchOffer } | { kind: "skipped"; reason: string }` (Task 7 adds `{ kind: "budget" }`).
  - The offer is built exactly as `index.ts:296-309` builds it today (no `startTime`; plan 01 Task 4 adds it there later).
  - A skipped match logs `console.warn(\`[Betclic/FullOffer] Skipping ${home} vs ${away} (ID: ${id}): ${reason}\`)` and produces no `FullMatchOffer`, so nothing is written or pruned.
  - Valid groups that parse to 0 markets are skipped with `0 markets parsed`. An exception is skipped with its message.
  - The result contract is the one in Global Constraints. Task 1 uses a local `const MAX_SKIPPED_MATCH_RATIO = 0.5`, the value of plan 02's `MAX_SKIPPED_DETAIL_RATIO`, which Task 7 imports.
  - The `received` line (`index.ts:285-287`) becomes `` `[Betclic/FullOffer] ${home} vs ${away}: received ${responses.length} response(s) from 7 market groups` ``.

**Why all 7 here:** Task 1 cannot yet tell echo groups from real ones, so it uses the strict default, which costs almost nothing:
- 0 outright group failures in 420 loaded fetches.
- Every declared group carries markets no other group has. STRZELCY missing loses 265 → 242 markets and ~1 000 selections, pruned for an hour.
- A false skip only leaves one match one hour stale (its previous rows stay).

Task 5 relaxes the rule only for categories that TOP itself does not declare.

- [ ] **Step 1: Write the failing tests**

`__tests__/betclic-fixtures.ts` exports:
- `b64(file)`: reads `fixtures/<file>` as text (the same helper `grpc-web-frame.test.ts:10` uses).
- `TOP_B64`, `HANDICAP_B64`: the fixture texts. `TOP_MSG = decodeGrpcWebTextFrame(TOP_B64).message` (197 814 B, 29 markets) and `HANDICAP_MSG` (11 926 B, 4 markets); `decodeGrpcWebTextFrame` is exported at `navigation.ts:176`.
- `ORDER`: the 7 group names.
- `groupResults(over?: Partial<Record<BetclicGroupName, Buffer | string>>)`: a string becomes `{ response: null, error: string }`. Defaults: TOP = `TOP_MSG`, HANDICAP = `HANDICAP_MSG`, and every other group = `Buffer.from(TOP_MSG)` (the echo pattern). The default parses to 32 markets / 460 selections (measured; `parser.ts` is unchanged since master).

`match-groups.test.ts` uses its own `distinct(over)` builder: `Buffer.alloc(200 + i, i + 1)` per group, so Task 3's dedupe and Task 5's header lookup cannot interfere.

```ts
it("TOP floor is 100 bytes", () => expect(MIN_GROUP_BYTES).toBe(100));
it("all 7 complete: ok, responses in MARKET_GROUP_FILTERS order", () => {
  const a = assessMatchGroups(distinct());
  expect(a.ok && a.responses.map((b) => b.length)).toEqual([200, 201, 202, 203, 204, 205, 206]);
});
it("TOP failed: skipped with the transport error", () =>
  expect(assessMatchGroups(distinct({ TOP: "Incomplete gRPC-web frame: 5995/197814 bytes" })))
    .toEqual({ ok: false, reason: "TOP missing: Incomplete gRPC-web frame: 5995/197814 bytes" }));
it("TOP under 100 bytes: skipped", () =>
  expect(assessMatchGroups(distinct({ TOP: Buffer.alloc(37) }))).toEqual({ ok: false, reason: "TOP missing: 37 bytes" }));
it("one non-TOP group failed: skipped", () =>
  expect(assessMatchGroups(distinct({ STRZELCY: "Incomplete gRPC-web frame: 388976/1295527 bytes" }))).toEqual({ ok: false,
    reason: "6/7 required groups valid; failed: STRZELCY (Incomplete gRPC-web frame: 388976/1295527 bytes)" }));
it("two failed groups are listed in group order", () =>
  expect(assessMatchGroups(distinct({ STATYSTYKI: "gRPC request failed: HTTP 503", GOLE: "gRPC-web frame deadline (10000 ms): 0/null bytes" })))
    .toEqual({ ok: false, reason: "5/7 required groups valid; failed: GOLE (gRPC-web frame deadline (10000 ms): 0/null bytes); STATYSTYKI (gRPC request failed: HTTP 503)" }));
it("an absent group counts as failed", () =>
  expect(assessMatchGroups(distinct().filter((r) => r.group !== "HANDICAP")))
    .toEqual({ ok: false, reason: "6/7 required groups valid; failed: HANDICAP (not fetched)" }));
it("a completed non-TOP group under 100 bytes is valid but not parsed", () => {
  const a = assessMatchGroups(distinct({ HANDICAP: Buffer.alloc(40) }));
  expect(a).toMatchObject({ ok: true, emptyGroups: ["HANDICAP"] });
  expect(a.ok && a.responses).toHaveLength(6);
});
```

`full-offer.test.ts` setup:
- Mock `../navigation.js` via `importOriginal`, replacing `fetchLeagueMatches` (resolves `Buffer.alloc(16)`) and `fetchMarketGroupResults` (from `vi.hoisted`). Until Step 3 the mock also carries a network guard `fetchMarketsHybrid: vi.fn(async () => { throw new Error("network guard") })`, so the pre-change code never reaches the network; **Step 3 deletes that line** together with the function.
- Mock `../parser.js` via `importOriginal`, replacing only `parseListingResponse` (`listing`).
- `beforeEach`: `vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockRejectedValue(new Error("browser disabled in unit tests"))` (the `totalbet/__tests__/scraper.test.ts:55` pattern; the tab scraper launches through `executeWithBrowser` → `initBrowser`).
- Listing rows, all with synthetic odds 1.3 / 5.5 / 9:
  - `ARSENAL = { matchId: "1261715874385920", homeTeam: "Arsenal", awayTeam: "Hull", matchName: "Arsenal - Hull" }`: real id, from `$R/stream-probe-output.txt`.
  - `LEEDS = { matchId: "1261714312019968", homeTeam: "Leeds", awayTeam: "Tottenham" }`: real id, from `tabscraper-check.mts`.
  - `THIRD = { matchId: "1261700000000003", homeTeam: "Home3", awayTeam: "Away3" }`: synthetic.
- Spy on `console.log` / `console.warn` and join each call into `logLines()` / `warnLines()`.
- `scrape = () => new BetclicPlaywrightScraper().scrapeFullOffer("premier-league")`.

```ts
it("declares the http transport (plan 07 job classification)", () =>
  expect(new BetclicPlaywrightScraper().transport).toBe("http"));
it("writes every match whose groups completed, never touching a browser", async () => {
  const initBrowser = vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser");
  listing.mockReturnValue([ARSENAL, LEEDS]); nav.fetchMarketGroupResults.mockResolvedValue(groupResults());
  const r = await scrape();
  expect(r.success).toBe(true); expect("error" in r).toBe(false);
  expect(r.matches.map((m) => m.markets.length)).toEqual([32, 32]);
  expect(initBrowser).not.toHaveBeenCalled();
  expect(logLines()).toContain("[Betclic/FullOffer] Arsenal vs Hull: 32 markets total");
});
it("skips a match whose TOP failed, says why, and keeps the cause on success", async () => { /* ARSENAL: groupResults({ TOP: "Incomplete gRPC-web frame: 5995/197814 bytes" }), LEEDS: default */
  expect(r).toMatchObject({ success: true, error: "1 of 2 details failed | TOP missing: Incomplete gRPC-web frame: 5995/197814 bytes" });
  expect(r.matches.map((m) => m.matchId)).toEqual([LEEDS.matchId]);
  expect(warnLines()).toContain("[Betclic/FullOffer] Skipping Arsenal vs Hull (ID: 1261715874385920): TOP missing: Incomplete gRPC-web frame: 5995/197814 bytes");
  expect(warnLines()).toContain("[betclic] 1 of 2 details failed | TOP missing: Incomplete gRPC-web frame: 5995/197814 bytes");
});
it("skips a match when one non-TOP group failed (today: TOP-only write after the broken fallback)", async () => { /* ARSENAL: STRZELCY error */ expect(r.matches).toHaveLength(1); });
it("a completed group under 100 bytes is not a failure", async () => { /* ARSENAL: HANDICAP: Buffer.alloc(40) */ expect(r.matches[0].markets).toHaveLength(29); });
it("a match whose groups parse to 0 markets is skipped, not dropped silently", async () => {
  listing.mockReturnValue([ARSENAL]);
  nav.fetchMarketGroupResults.mockResolvedValue(groupResults(Object.fromEntries(ORDER.map((g) => [g, TOP_MSG.subarray(0, 5995)]))));
  expect(await scrape()).toMatchObject({ success: false, matches: [], error: "1 of 1 details failed | 0 markets parsed" });
});
it("fails the run when more than half of the attempted matches are skipped", async () => { /* ARSENAL + LEEDS with TOP error, THIRD ok */
  expect(await scrape()).toMatchObject({ success: false, matches: [], error: "2 of 3 details failed | TOP missing: Incomplete gRPC-web frame: 5995/197814 bytes" });
});
```

`TOP_MSG.subarray(0, 5995)` parses to 0 markets (`$R/truncation-repro-output.txt`: TOP cut at 8000 chars → 0).

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/scrapers/bookmakers/betclic/__tests__/match-groups.test.ts src/scrapers/bookmakers/betclic/__tests__/full-offer.test.ts`. Expected:
  - `match-groups.test.ts`: `Failed to load url ../match-groups.js`.
  - full-offer: `transport` is `undefined`; `fetchMarketGroupResults` is never called (the guard throws inside the old per-match `try`), so `r.matches` is `[]` and no `Skipping` line appears.
- [ ] **Step 3: Implement** `assessMatchGroups`, `fetchMarketGroupResults`, `fetchMatchOffer` and the `transport` field, then the deletions and the docs.
  - Delete the `fetchMarketsHybrid` guard line from `full-offer.test.ts`.
  - The README Data Flow becomes `fetchMarketGroupResults` → `assessMatchGroups` (skip unless TOP is present and the required groups completed) → `parseAllMarketsFromMultipleResponses`.
  - `git grep -n "tab-scraper\|TabScraper\|fetchMarketsHybrid\|TAB_SELECTORS\|getTabSelector" -- src scripts` prints nothing (tests included; cross-plan #3: nothing is excluded).
- [ ] **Step 4: Run them and confirm they pass.** Same command: 15 passed. Then `heavy npx vitest run src/scrapers/bookmakers/betclic` (including `grpc-web-frame.test.ts`, `navigation.test.ts`, `parser.test.ts`), then once `heavy npx tsc --noEmit` and `heavy npx vitest run` (baseline + 15; golden unchanged). If `full-offer-fixtures.test.ts` exists, it passes with the new mock.
- [ ] **Step 5: Commit**
  ```bash
  git add -A src/scrapers/bookmakers/betclic src/AGENTS.md
  git add src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts 2>/dev/null || true   # only if plan 01's harness exists
  git commit -m "fix(betclic): delete the broken Playwright fallback, skip matches with missing groups"
  ```

### Task 2: gzip in front of the complete-frame reader; one `release()` on every settle; transport stats

After Task 1 and plan 02 (Task 5: `TransportStats*`).

**Files:**
- Modify `navigation.ts`: `fetchGrpcStream` (`:44-76`), `fetchGrpcWithNodeHttp` (`:82-138`, exported now), `readGrpcWebTextStream` (`:206-302`, settle `:225-231`), `fetchLeagueMatches` (`:363-385`), `fetchMarketGroupResults`.
- Modify `index.ts`: the transport log lines and `transportStats()`.
- Modify `README.md:216-223`: add one troubleshooting row.
- Test: extend `__tests__/grpc-web-frame.test.ts` (`describe("readGrpcWebTextStream")`, `:51-…`, reuse its `b64()` / `grpcWebTextFrame()` helpers); create `__tests__/grpc-transport.test.ts`; extend `__tests__/full-offer.test.ts`.

**Interfaces:**
- Consumes:
  - betclic.md Task 1 (built): `readGrpcWebTextStream(res, { deadlineMs })`, `GRPC_FRAME_DEADLINE`.
  - §3 / plan 02 Task 5: `HttpStats`, `TransportStats`, `TransportStatsSource`, `hasTransportStats`.
- Produces (`navigation.ts`):
  ```ts
  // HttpStats semantics of plan 02 Task 2: requests = HTTP attempts sent, retries = attempts after the first per fetchGrpcStream call,
  // failures = fetchGrpcStream calls that rejected, bytes = response body bytes as received (compressed when gzip),
  // byStatus = status string per response, or "timeout" | "network" | "aborted" for an attempt that got no response headers
  export interface BetclicTransportStats extends HttpStats { gzipResponses: number }
  export function createBetclicTransportStats(): BetclicTransportStats;                          // all zero, byStatus {}
  export function addBetclicTransportStats(into: BetclicTransportStats, from: Readonly<BetclicTransportStats>): void;  // sums; merges byStatus
  export function formatBetclicTransportStats(s: Readonly<BetclicTransportStats>): string;
  //   `wire ${bytes} B, ${requests} requests, ${retries} retries, ${failures} failures, gzip ${gzipResponses}/${byStatus["200"] ?? 0}`
  export interface GrpcCallOptions { stats?: BetclicTransportStats; deadlineMs?: number }      // Task 7 adds signal
  export function fetchGrpcStream(url: string, body: Buffer, timeoutMs?: number, opts?: GrpcCallOptions): Promise<Buffer>;
  export function fetchGrpcWithNodeHttp(url: string, frame: Buffer, timeoutMs: number, opts?: GrpcCallOptions): Promise<Buffer>; // now exported; one attempt
  // readGrpcWebTextStream gains opts.release?: () => void — called exactly once on every settle, right after res.destroy?.()
  export function fetchLeagueMatches(league: string, opts?: GrpcCallOptions): Promise<Buffer | null>;
  export function fetchMarketGroupResults(matchId: string, opts?: GrpcCallOptions): Promise<BetclicGroupResult[]>;
  ```
- Produces (`index.ts`):
  - `BetclicPlaywrightScraper implements TransportStatsSource`. `transportStats()` returns `{ http: { requests, retries, failures, bytes, byStatus: { ...byStatus } } }`: a copy of the instance's **cumulative** totals since construction (README §3), so plan 07 and `perf-smoke.ts` diff before/after a unit. `hasTransportStats(betclicScraper)` is true.
  - Log lines:
    - after each match: `` `[Betclic/Transport] ${home} vs ${away}: ${formatBetclicTransportStats(match)}` ``;
    - once per run, before `Completed`: `` `[Betclic/Transport] ${league}: ${written}/${listed} matches in ${ms} ms, ${formatBetclicTransportStats(run)}` ``. The run stats include the listing call.
  - `MatchFetchContext` gains `stats`.
- Seam: the module is picked from the URL (`http:` → `node:http`, else `node:https`), with `port: url.port || 443` (today `port: 443` is hard-coded at `:95`). Production URLs stay https.

- [ ] **Step 1: Write the failing tests.**

In `grpc-web-frame.test.ts` (existing `describe("readGrpcWebTextStream")`):
```ts
it("readGrpcWebTextStream calls release exactly once per settle", async () => {
  const ok = new PassThrough(); const r1 = vi.fn();
  const p1 = readGrpcWebTextStream(ok, { deadlineMs: 5000, release: r1 }); ok.write(HANDICAP);
  await expect(p1).resolves.toHaveLength(11926); ok.write("more"); expect(r1).toHaveBeenCalledTimes(1);
  const cut = new PassThrough(); const r2 = vi.fn();
  const p2 = readGrpcWebTextStream(cut, { deadlineMs: 5000, release: r2 }); cut.end(HANDICAP.slice(0, 8000));
  await expect(p2).rejects.toThrow(/^Incomplete gRPC-web frame: 5995\/11926 bytes$/); expect(r2).toHaveBeenCalledTimes(1);
});
```

In the new `grpc-transport.test.ts`, test-local helpers:
- `startFakeGrpc(handler)` starts a `node:http` server on `127.0.0.1:0`. It records the request headers in `requests` and counts sockets opened and closed (`socket.on("close")`). It exposes `url`, `waitClosed(n, ms)` (resolves with the closed count once it reaches `n`, rejects after `ms`) and `close()` (`closeAllConnections()` + `close()`).
- `gzipOpen(text)` is a handler. It answers 200 with `content-encoding: gzip` when the request's `accept-encoding` contains `gzip`, and plain text otherwise. It compresses with `zlib.createGzip()` + `flush(Z_SYNC_FLUSH)`, records the compressed length in `written`, writes it in 3 chunks 10 ms apart, and **never ends** the response.
- `TOP_B64`, `HANDICAP_B64` from `betclic-fixtures.ts`. `FRAME` is any 5-byte-header request frame.

```ts
it("requests gzip and resolves a gzip stream that never ends (HANDICAP)", async () => {
  const s = await startFakeGrpc(gzipOpen(HANDICAP_B64));
  const msg = await fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000);
  expect(s.requests[0]["accept-encoding"]).toBe("gzip");
  expect(msg.length).toBe(11926); expect(parseAllMarketsFromProto(msg)).toHaveLength(4);
});
it("gzip TOP decodes to the same bytes as the identity response", async () => { /* gzip server vs a server that ignores accept-encoding */
  expect(gz.equals(identity)).toBe(true); expect(gz.length).toBe(197814); expect(parseAllMarketsFromProto(gz)).toHaveLength(29);
});
it("closes the source socket after resolving (gzip)", async () => { await fetchGrpcWithNodeHttp(...); await expect(s.waitClosed(1, 1000)).resolves.toBe(1); });
it("closes the source socket on the frame deadline", async () => { /* writes the first 30000 compressed bytes of TOP, then stalls */
  await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000, { deadlineMs: 200 })).rejects.toThrow(/^gRPC-web frame deadline \(\d+ ms\): \d+\/197814 bytes$/);
  await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
});
it("a gzip stream that ends mid-member rejects as an incomplete frame", async () => { /* 20000 compressed bytes of TOP, then res.end() */
  await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000)).rejects.toThrow(/^Incomplete gRPC-web frame: gzip Z_BUF_ERROR unexpected end of file$/);
});
it("identity response still resolves and closes the socket", async () => { expect(msg.length).toBe(11926); await expect(s.waitClosed(1, 1000)).resolves.toBe(1); });
it("rejects an unsupported content-encoding and closes the socket", async () => { /* content-encoding: br */
  await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000)).rejects.toThrow("gRPC-web unsupported content-encoding br");
  await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
});
it("HTTP 503 rejects and closes the socket", async () => { /* 503 + res.write("x"), never ended */
  const stats = createBetclicTransportStats();
  await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000, { stats })).rejects.toThrow("gRPC request failed: HTTP 503");
  await expect(s.waitClosed(1, 1000)).resolves.toBe(1); expect(stats.byStatus).toEqual({ "503": 1 });
});
it("a trailers-only response rejects with the gRPC error and closes the socket", async () => { /* 200 + grpc-status: 5, grpc-message: x, never ended */
  await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000)).rejects.toThrow("gRPC error 5: x");
  await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
});
it("counts compressed wire bytes with HttpStats semantics", async () => {
  const stats = createBetclicTransportStats();
  await fetchGrpcStream(`${s.url}/x`, Buffer.from([0x08, 0x03]), 5000, { stats });
  expect(stats).toEqual({ requests: 1, retries: 0, failures: 0, bytes: s.written[0], byStatus: { "200": 1 }, gzipResponses: 1 });
});
```

In `full-offer.test.ts`:
- The `fetchMarketGroupResults` mock adds `{ requests: 7, retries: 0, failures: 0, bytes: 1000, byStatus: { "200": 7 }, gzipResponses: 7 }` to `opts.stats`. The `fetchLeagueMatches` mock adds `{ 1, 0, 0, 100, { "200": 1 }, 1 }`.
- With `[ARSENAL, LEEDS]`:
  - `logLines()` contains `[Betclic/Transport] Arsenal vs Hull: wire 1000 B, 7 requests, 0 retries, 0 failures, gzip 7/7`.
  - One line matches `/^\[Betclic\/Transport\] premier-league: 2\/2 matches in \d+ ms, wire 2100 B, 15 requests, 0 retries, 0 failures, gzip 15\/15$/`.
  - `hasTransportStats(s)` is true, `s.transportStats()` equals `{ http: { requests: 15, retries: 0, failures: 0, bytes: 2100, byStatus: { "200": 15 } } }`, a second scrape on the same instance doubles every counter (cumulative), and two calls return different objects.

- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/scrapers/bookmakers/betclic/__tests__/grpc-web-frame.test.ts src/scrapers/bookmakers/betclic/__tests__/grpc-transport.test.ts src/scrapers/bookmakers/betclic/__tests__/full-offer.test.ts`. Expected: `release` never called; `fetchGrpcWithNodeHttp` / `createBetclicTransportStats` not exported; no `[Betclic/Transport]` lines; `hasTransportStats` false. The existing reader tests stay green.
- [ ] **Step 3: Implement.**
  - Headers are `{ ...GRPC_HEADERS, "Accept-Encoding": "gzip" }`.
  - The non-200 and trailers-only branches (`:108-120`) call `release()` instead of `res.destroy()`; the unsupported-encoding reject is new and also calls `release()`.
  - The response path is exactly:
  ```ts
  const release = () => { res.destroy(); req.destroy(); };            // the SOURCE response + request/socket, never only a wrapper
  bump(stats, String(res.statusCode));                                 // byStatus
  res.on("data", (c: Buffer) => { if (stats) stats.bytes += c.length; });
  const enc = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
  if (enc !== "gzip" && enc !== "identity") { release(); return reject(new Error(`gRPC-web unsupported content-encoding ${enc}`)); }
  if (enc === "gzip" && stats) stats.gzipResponses++;
  const body = enc === "gzip" ? pipeline(res, createGunzip(), () => {}) : res;   // callback required (else ERR_INVALID_ARG_TYPE); errors reach the reader via body 'error'
  readGrpcWebTextStream(body, { deadlineMs, release }).then(resolve, (e: NodeJS.ErrnoException) =>
    reject(e.code?.startsWith("Z_") ? new Error(`Incomplete gRPC-web frame: gzip ${e.code} ${e.message}`) : e));
  ```
  - Measured on Node 20.19 in a scratch prototype: with `stream.pipeline`, destroying only the gunzip already tears down `res` and the socket. With `res.pipe(gunzip)` the socket stays open (server `closed = 0`), which is the leak README §5.1 warns about. Destroying the source explicitly keeps the guarantee whichever way the body is wired.
  - README row: `| Incomplete gRPC-web frame: gzip Z_… | Stream cut mid-gzip | Retried automatically; if persistent, check the response content-encoding |`.
- [ ] **Step 4: Run them and confirm they pass.** Same command → green. Then `heavy npx vitest run src/scrapers/bookmakers/betclic`, and once `heavy npx tsc --noEmit` and `heavy npx vitest run`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/bookmakers/betclic
  git commit -m "perf(betclic): gzip gRPC-web responses, release the source stream on every settle, expose transport stats"
  ```

### Task 3: Parse each distinct group payload once

After Task 1.

**Files:**
- Modify: `match-groups.ts` (`assessMatchGroups`) and `index.ts` (the `received` line).
- Test: extend `__tests__/match-groups.test.ts` and `__tests__/full-offer.test.ts`.

**Interfaces:**
- Produces: the `ok` branch gains `duplicates: Array<{ group: BetclicGroupName; sameAs: BetclicGroupName }>`.
  - A completed payload ≥ 100 B that is byte-equal to an earlier payload in `responses` is left out and listed with the group it repeats. The check is `Buffer.equals` after an equal-length test.
  - Exact equality keeps `parseAllMarketsFromMultipleResponses` output unchanged, because its dedupe keeps the first of equal-size markets (`parser.ts:806-820`).
- The `received` line becomes `` `… received ${responses.length} response(s) from 7 market groups, ${duplicates.length} duplicate(s) not parsed` ``.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("drops a payload byte-identical to an earlier group, keeps a one-byte difference", () => {
    const top = Buffer.alloc(300, 7);
    const a = assessMatchGroups(distinct({ TOP: top, METODA_GOLA: Buffer.from(top) }));
    expect(a).toMatchObject({ ok: true, duplicates: [{ group: "METODA_GOLA", sameAs: "TOP" }] });
    expect(a.ok && a.responses).toHaveLength(6);
    const changed = Buffer.from(top); changed[299] = 8;
    expect(assessMatchGroups(distinct({ TOP: top, METODA_GOLA: changed }))).toMatchObject({ ok: true, duplicates: [] });
  });
  it("far-match echo: 3 duplicates of TOP are not parsed", () => {
    const top = Buffer.alloc(300, 7);
    const a = assessMatchGroups(distinct({ TOP: top, STRZELCY: Buffer.from(top), METODA_GOLA: Buffer.from(top), STATYSTYKI: Buffer.from(top) }));
    expect(a.ok && a.duplicates.map((d) => `${d.group}=${d.sameAs}`)).toEqual(["STRZELCY=TOP", "METODA_GOLA=TOP", "STATYSTYKI=TOP"]);
    expect(a.ok && a.responses).toHaveLength(4);
  });
  it("parse output with duplicates skipped deep-equals the parse of all 7 (recorded payloads)", () => {
    const all = groupResults();
    const a = assessMatchGroups(all);
    expect(a.ok && a.responses).toHaveLength(2);
    expect(parseAllMarketsFromMultipleResponses(a.ok ? a.responses : [])).toEqual(parseAllMarketsFromMultipleResponses(all.map((r) => r.response!)));
  });
  ```
  In `full-offer.test.ts`, the first scrape test also expects `[Betclic/FullOffer] Arsenal vs Hull: received 2 response(s) from 7 market groups, 5 duplicate(s) not parsed`, with markets still `[32, 32]`.
- [ ] **Step 2: Run and confirm they fail.** `heavy npx vitest run src/scrapers/bookmakers/betclic/__tests__/match-groups.test.ts src/scrapers/bookmakers/betclic/__tests__/full-offer.test.ts`. Expected: `duplicates` undefined, 7 responses, and the old `received 7 response(s)` line.
- [ ] **Step 3: Implement** the duplicate pass inside `assessMatchGroups`, after the required-group checks, and the new log line.
- [ ] **Step 4: Run and confirm they pass.** Then once `heavy npx tsc --noEmit` and `heavy npx vitest run` (golden unchanged).
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/bookmakers/betclic
  git commit -m "perf(betclic): parse each distinct market-group payload once"
  ```

### Task 4: Declared categories from the match header (field 10)

After Task 1. This task only reads the category list Task 5 needs. **It never sets `startTime`**: betclic's kickoff comes from the listing's field 3 (plan 01 Task 4, cross-plan #1).

**Files:**
- Modify: `parser.ts`, adding a new export after `parseAllMarketsFromMultipleResponses` (`:781-830`). No existing function changes.
- Test: extend `__tests__/match-groups.test.ts` (header cases).

**Interfaces:**
- Produces: `export function parseMatchHeader(raw: Buffer): { categories: string[] }`.
  - It walks only the top-level fields of root field 1 → field 1, the match message. It skips length-delimited fields by their length and never decodes markets.
  - `categories` is field 2 of every field-10 submessage, in order.
  - Malformed input gives `{ categories: [] }` and never throws. That covers an unknown wire type, a varint running past the end, and a length-delimited field (root, wrapper or match) longer than the bytes left.

- [ ] **Step 1: Write the failing tests**
  ```ts
  const OPTA_CATEGORIES = ["ca_ftb_top", "ca_ftb_ft", "ca_ftb_rslt", "ca_ftb_pssb", "ca_ftb_gsc", "ca_ftb_goa", "ca_ftb_cshcp", "ca_ftb_prp"];
  it("reads the declared categories from TOP (Arsenal-Hull)", () =>
    expect(parseMatchHeader(TOP_MSG)).toEqual({ categories: OPTA_CATEGORIES }));
  it("every group carries the same header (HANDICAP)", () => expect(parseMatchHeader(HANDICAP_MSG)).toEqual(parseMatchHeader(TOP_MSG)));
  it("malformed input gives an empty list", () => {
    expect(parseMatchHeader(Buffer.from("not protobuf"))).toEqual({ categories: [] });
    expect(parseMatchHeader(Buffer.alloc(0))).toEqual({ categories: [] });
    expect(parseMatchHeader(TOP_MSG.subarray(0, 5995))).toEqual({ categories: [] }); // truncated: lengths overrun
  });
  ```
- [ ] **Step 2: Run and confirm they fail** with `parseMatchHeader is not a function` (`heavy npx vitest run src/scrapers/bookmakers/betclic/__tests__/match-groups.test.ts`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** Then once `heavy npx tsc --noEmit` and `heavy npx vitest run` (golden unchanged).
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/bookmakers/betclic
  git commit -m "feat(betclic): read the declared market categories from the match header"
  ```

### Task 5: Only declared categories are required

After Task 4.

**Files:**
- Modify: `match-groups.ts` (`assessMatchGroups`) and `index.ts` (passes TOP's categories).
- Test: extend `__tests__/match-groups.test.ts` and `__tests__/full-offer.test.ts`.

**Interfaces:**
- Produces: `assessMatchGroups(results, declared?: readonly string[])`.
  - When `declared` is non-empty, the required groups are TOP plus every non-TOP group whose `MARKET_GROUP_FILTERS` id is in `declared`.
  - When `declared` is empty or missing, all 7 are required (Task 1).
  - The `ok` branch gains `optionalFailed: BetclicGroupName[]`.
  - Reasons count required groups only, e.g. `5/6 required groups valid; failed: STRZELCY (…)`.
- `fetchMatchOffer` calls `assessMatchGroups(results, top ? parseMatchHeader(top).categories : [])`.

**K after this task:** 1 + the fetched categories TOP declares. That is 6 on both recorded OPTA matches (TOP + `rslt`, `gsc`, `goa`, `cshcp`, `prp`; `ca_ftb_goalm` is undeclared). It is 4 on the far match probed live (TOP + `rslt`, `goa`, `cshcp`). A category TOP does not list is served as TOP's own payload, so its failure loses nothing. A declared one carries markets no other group has.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("METODA_GOLA failing on an OPTA match does not skip it", () => {
    const a = assessMatchGroups(distinct({ METODA_GOLA: "gRPC-web frame deadline (10000 ms): 0/null bytes" }), OPTA_CATEGORIES);
    expect(a).toMatchObject({ ok: true, optionalFailed: ["METODA_GOLA"] }); expect(a.ok && a.responses).toHaveLength(6);
  });
  it("a declared group failing still skips", () =>
    expect(assessMatchGroups(distinct({ STRZELCY: "Incomplete gRPC-web frame: 388976/1295527 bytes" }), OPTA_CATEGORIES)).toEqual({ ok: false,
      reason: "5/6 required groups valid; failed: STRZELCY (Incomplete gRPC-web frame: 388976/1295527 bytes)" }));
  it("far match (live-probed declared list): STRZELCY and STATYSTYKI are optional, 4 required", () => {
    const FAR_CATEGORIES = ["ca_ftb_top", "ca_ftb_ft", "ca_ftb_rslt", "ca_ftb_goa", "ca_ftb_cshcp"];
    expect(assessMatchGroups(distinct({ STRZELCY: "x", STATYSTYKI: "y" }), FAR_CATEGORIES)).toMatchObject({ ok: true, optionalFailed: ["STRZELCY", "STATYSTYKI"] });
    expect(assessMatchGroups(distinct({ GOLE: "z" }), FAR_CATEGORIES)).toEqual({ ok: false, reason: "3/4 required groups valid; failed: GOLE (z)" });
  });
  it("an unreadable header keeps all 7 required", () =>
    expect(assessMatchGroups(distinct({ METODA_GOLA: "x" }), [])).toEqual({ ok: false, reason: "6/7 required groups valid; failed: METODA_GOLA (x)" }));
  // full-offer.test.ts
  it("writes an OPTA match whose METODA_GOLA failed", async () => { /* ARSENAL: groupResults({ METODA_GOLA: "x" }) */
    expect(r.matches[0].markets).toHaveLength(32); expect(warnLines().some((l) => l.startsWith("[Betclic/FullOffer] Skipping"))).toBe(false);
  });
  it("never sets startTime from the header (plan 01 owns betclic start_time)", async () => { /* default groups, listing rows without startTime */
    expect(r.matches[0].startTime).toBeUndefined();
  });
  ```
  If plan 01 Task 4 has landed, the last test instead gives the listing row `startTime: "2026-11-07T15:00:00.0000000Z"` and expects plan 01's converted value, proving the header is not the source.
- [ ] **Step 2: Run and confirm they fail**: `optionalFailed` undefined, and the METODA_GOLA cases are skipped.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** Then once `heavy npx tsc --noEmit` and `heavy npx vitest run`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/bookmakers/betclic
  git commit -m "fix(betclic): require only the market groups the match declares"
  ```

### Task 6: Bounded match concurrency (3 matches ⇒ 21 streams)

After Task 2 and plan 02 (`mapLimit`).

**Files:**
- Modify: `constants.ts` (after `MARKET_GROUP_FILTERS`, `:218-267`) and `index.ts` (the per-match `for` loop becomes `mapLimit`).
- Modify: `.env.example`. After observability's `# Alerts` block (`:21-25`) add `# Betclic` with `# BETCLIC_MATCH_CONCURRENCY=3   # matches fetched at a time (1-7); 1 = sequential reference run`.
- Test: extend `__tests__/full-offer.test.ts`.

**Interfaces:**
- Consumes: §3 `mapLimit<T, R>(items, limit, fn, signal?)`. Settled results are index-aligned (plan 02 Task 1).
- Produces:
  - `export const BETCLIC_MATCH_CONCURRENCY = 3;`
  - `export function resolveBetclicMatchConcurrency(env: NodeJS.ProcessEnv = process.env): number`. It returns the integer in `BETCLIC_MATCH_CONCURRENCY` when that is 1–7, and 3 otherwise. It is read on every call, so `=1` gives the sequential reference run in Task 8.
- Behaviour:
  - `matches` keeps listing order.
  - A rejected settled result counts as skipped with its message.
  - `delay(50)` stays inside the per-match function.
  - No protected line changes.

- [ ] **Step 1: Write the failing tests.** `SEVEN` holds 7 synthetic listing rows: ids `126170000000000${i}`, teams `Home${i}` / `Away${i}`.
  ```ts
  it("fetches at most 3 matches at a time and keeps listing order", async () => {
    let inFlight = 0, peak = 0;
    listing.mockReturnValue(SEVEN);
    nav.fetchMarketGroupResults.mockImplementation(async (id: string) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 40 - 5 * Number(id.slice(-1)))); // later matches finish first
      inFlight--; return groupResults();
    });
    const r = await scrape();
    expect(peak).toBe(3);
    expect(r.matches.map((m) => m.matchId)).toEqual(SEVEN.map((m) => m.matchId));
  });
  it("BETCLIC_MATCH_CONCURRENCY=1 runs one match at a time", async () => { vi.stubEnv("BETCLIC_MATCH_CONCURRENCY", "1"); /* same mock */ expect(peak).toBe(1); });
  it("keeps the check-log-vs-smoke formats under concurrency", async () => {
    const totals = logLines().filter((l) => /^\[Betclic\/FullOffer\] (.+?) vs (.+?): (\d+) markets total$/.test(l));
    expect(totals).toHaveLength(7);
    expect(logLines().filter((l) => l === "[Betclic/FullOffer] Found 7 events in listing")).toHaveLength(1);
  });
  it("resolveBetclicMatchConcurrency accepts 1-7 only", () => {
    expect(resolveBetclicMatchConcurrency({})).toBe(3);
    expect(resolveBetclicMatchConcurrency({ BETCLIC_MATCH_CONCURRENCY: "1" })).toBe(1);
    expect(resolveBetclicMatchConcurrency({ BETCLIC_MATCH_CONCURRENCY: "7" })).toBe(7);
    for (const v of ["0", "8", "2.5", "x"]) expect(resolveBetclicMatchConcurrency({ BETCLIC_MATCH_CONCURRENCY: v })).toBe(3);
  });
  ```
- [ ] **Step 2: Run and confirm they fail.** `heavy npx vitest run src/scrapers/bookmakers/betclic/__tests__/full-offer.test.ts`. Expected: `peak` 1 instead of 3, and `resolveBetclicMatchConcurrency is not a function`.
- [ ] **Step 3: Implement.** The loop becomes `mapLimit(listingWithIds, resolveBetclicMatchConcurrency(), (m) => this.fetchMatchOffer(m, ctx))`.
- [ ] **Step 4: Run and confirm they pass.** Then once `heavy npx tsc --noEmit` and `heavy npx vitest run`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/bookmakers/betclic .env.example
  git commit -m "perf(betclic): fetch three matches at a time"
  ```

### Task 7: Run budget (90 s) with abortable gRPC calls

After Task 6.

**Files:**
- Modify `constants.ts`.
- Modify `navigation.ts`: `GrpcCallOptions.signal`, `fetchGrpcStream` (retry loop `:57-73`), `fetchGrpcWithNodeHttp`.
- Modify `index.ts`: `scrapeFullOffer(league, budget?)` and the result contract.
- Test: extend `__tests__/grpc-transport.test.ts` and `__tests__/full-offer.test.ts`. The latter adds `vi.mock("../../../shared/budget.js", async (orig) => { const m = await orig(); return { ...m, createScrapeBudget: vi.fn(m.createScrapeBudget) }; })`.

**Interfaces:**
- Consumes:
  - §3: `ScrapeBudget`, `createScrapeBudget`, `BudgetExceededError`, `mapLimit(…, signal)`, `MAX_SKIPPED_DETAIL_RATIO`. The last replaces Task 1's local constant.
  - Plan 02 semantics: `remainingMs()` is 0 once aborted; `createScrapeBudget` throws `RangeError` for ≤ 0; unstarted `mapLimit` items reject with `signal.reason`.
- Produces:
  - `export const BETCLIC_MAX_DURATION_MS = 90_000;`
  - `GrpcCallOptions.signal?: AbortSignal`
  - `scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult>`. The class now satisfies §3 `FullOfferScraper`, `DeclaresTransport` and `TransportStatsSource`. Plan 07's hard deadline (`DEFAULT_MAX_DURATION_MS.http` = 120 s + 5 s grace) stays above this 90 s cap.
  - `MatchFetchContext` gains `budget`, and `BetclicMatchOutcome` gains `{ kind: "budget" }`.
- Budget setup:
  - `ms = budget ? Math.min(BETCLIC_MAX_DURATION_MS, budget.remainingMs()) : BETCLIC_MAX_DURATION_MS`.
  - If `ms <= 0`, return `{ success: false, matches: [], error: "budget exhausted before the listing" }` without any request.
  - Otherwise `own = createScrapeBudget(ms, budget?.signal)`, then `setMaxListeners(64, own.signal)` (`node:events`): 21 concurrent group streams plus the listing and `mapLimit` exceed the default of 10.
  - When the listing returns null while `own.signal.aborted`, the error is `budget exhausted before the listing`.
- Transport on abort:
  - A pre-aborted signal rejects with `gRPC aborted ${url}` before any request.
  - An abort during a request runs `res?.destroy(err); req.destroy(err)` with `err = new Error(\`gRPC aborted ${url}\`)`. The reader then rejects through `error` and calls `release()` once, so no deadline timer is left behind (verified in the scratch prototype for gzip and identity).
  - There is no retry after an abort. The retry wait is `setTimeout(ms, undefined, { signal })` from `node:timers/promises`, and its rejection maps to the same message.
  - `byStatus.aborted` is counted when no headers had arrived. The listener is removed on settle.
- Per match:
  - Call `own.checkpoint()` first, then pass `own.signal` to `fetchMarketGroupResults`.
  - A failed assessment while `own.signal.aborted` → `{ kind: "budget" }`.
  - A match whose required groups all completed is kept even if the budget aborted meanwhile.
  - A rejected settled result while aborted → `budget`.
- Result: the Global Constraints contract. When at least one match was budget-stopped, also `console.warn(\`[Betclic/FullOffer] Budget exhausted after ${ms} ms: ${k} of ${listed} matches not completed\`)`.

- [ ] **Step 1: Write the failing tests**

  `grpc-transport.test.ts`:
  ```ts
  it("an abort mid-stream rejects \"gRPC aborted <url>\", makes no retry and closes the socket", async () => {
    const ac = new AbortController(); setTimeout(() => ac.abort(), 50); const t0 = Date.now();   // handler: 30000 compressed bytes of TOP, then stall
    await expect(fetchGrpcStream(`${s.url}/x`, Buffer.from([0x08, 0x03]), 30_000, { signal: ac.signal })).rejects.toThrow(`gRPC aborted ${s.url}/x`);
    expect(Date.now() - t0).toBeLessThan(500); expect(s.requests).toHaveLength(1);
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
  });
  it("an abort during the retry delay rejects at once", async () => { /* handler: 503 every time; abort at 100 ms */ expect(Date.now() - t0).toBeLessThan(500); expect(s.requests).toHaveLength(1); });
  it("an already-aborted signal sends no request", async () => { /* AbortSignal.abort() */ expect(s.requests).toHaveLength(0); });
  ```

  `full-offer.test.ts`, with `vi.stubEnv("BETCLIC_MATCH_CONCURRENCY", "1")`:
  ```ts
  it("stops starting matches once the budget aborts and returns the completed ones", async () => {
    listing.mockReturnValue([ARSENAL, LEEDS, THIRD]); const parent = new AbortController();
    nav.fetchMarketGroupResults.mockImplementationOnce(async () => { parent.abort(); return groupResults(); }); // complete: kept
    const r = await new BetclicPlaywrightScraper().scrapeFullOffer("premier-league", createScrapeBudget(60_000, parent.signal));
    expect(nav.fetchMarketGroupResults).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ success: true, error: "budget exhausted: 2 of 3 matches not completed" });
    expect(r.matches.map((m) => m.matchId)).toEqual([ARSENAL.matchId]);
    expect(warnLines().some((l) => /^\[Betclic\/FullOffer\] Budget exhausted after \d+ ms: 2 of 3 matches not completed$/.test(l))).toBe(true);
  });
  it("a match aborted in flight is not counted as failed", async () => {
    // 1st call normal; 2nd: parent.abort() then groupResults({ STRZELCY: "gRPC aborted https://offering.begmedia.com/x" })
    expect(r).toMatchObject({ success: true, error: "budget exhausted: 2 of 3 matches not completed" });
    expect(warnLines().some((l) => l.startsWith("[Betclic/FullOffer] Skipping"))).toBe(false);
  });
  it("a budget spent during the listing starts no match", async () => { /* fetchLeagueMatches mock aborts the parent, then resolves */
    expect(r).toMatchObject({ success: false, matches: [], error: "budget exhausted: 3 of 3 matches not completed" });
    expect(nav.fetchMarketGroupResults).not.toHaveBeenCalled();
  });
  it("a spent caller budget fails before the listing", async () => {
    const parent = new AbortController(); const b = createScrapeBudget(60_000, parent.signal); parent.abort();
    expect(await new BetclicPlaywrightScraper().scrapeFullOffer("premier-league", b)).toMatchObject({ success: false, matches: [], error: "budget exhausted before the listing" });
    expect(nav.fetchLeagueMatches).not.toHaveBeenCalled();
  });
  it("passes an AbortSignal with raised max listeners to every group fetch", async () => {
    const signal = nav.fetchMarketGroupResults.mock.calls[0][1].signal;
    expect(signal).toBeInstanceOf(AbortSignal); expect(getMaxListeners(signal)).toBe(64);
  });
  it("uses 90 s without a caller budget and caps at the caller's remaining time", async () => {
    await scrape(); expect(vi.mocked(createScrapeBudget).mock.calls.at(-1)).toEqual([90_000, undefined]);
    const parent = new AbortController();
    await new BetclicPlaywrightScraper().scrapeFullOffer("premier-league", createScrapeBudget(60_000, parent.signal));
    const [ms, sig] = vi.mocked(createScrapeBudget).mock.calls.at(-1)!;
    expect(ms).toBeLessThanOrEqual(60_000); expect(sig).toBeInstanceOf(AbortSignal);
  });
  ```
- [ ] **Step 2: Run and confirm they fail.** `heavy npx vitest run src/scrapers/bookmakers/betclic/__tests__/grpc-transport.test.ts src/scrapers/bookmakers/betclic/__tests__/full-offer.test.ts`. Expected:
  - the abort tests time out or see 2–3 requests;
  - all 3 listing matches are fetched;
  - `createScrapeBudget` is never called.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** Then once `heavy npx tsc --noEmit` and `heavy npx vitest run`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/bookmakers/betclic
  git commit -m "feat(betclic): 90 s run budget that stops starting matches and aborts in-flight streams"
  ```

### Task 8: Live verification (no code)

Read-only live smokes are allowed under `heavy --live`, one at a time (EXECUTION rule 4): `perf-smoke.ts` forces a dead `SUPABASE_URL`, so nothing touches the DB. Run between **HH:15 and HH:50** only (once plan 07 Task 4 is live: ≥ 5 min away from `/api/health` `nextScrapeAt` and never while `currentRun` is set). One bookmaker, ≈ 134 requests per run. Step 3 needs scheduled runs that persist and is **deferred to the owner**.

**Interfaces:**
- Consumes plan 02 Task 10's perf smoke: `npx tsx scripts/perf-smoke.ts --bookmaker betclic [--out f] [--baseline f]`.
  - It passes no budget (betclic's 90 s default applies). Scraper logs pass through.
  - It prints `PERF_SMOKE <json>` with `wallMs, success, error, matches, markets, selections, transport`, plus `PARITY <json>` with `--baseline` (±2 %).
  - If plan 02's revision folds these fields into observability's `scripts/smoke-bookmaker.ts` instead, use that script and its result-line prefix; the fields read below are the same.
- Also consumes `$R/check-log-vs-smoke.py` (run line: `run i (log line n): matches=N outOfTolerance=… failedGroups=… incompleteRetries=… deadline=… deadline1ms=… trailer=… compressed=… emptyFrame=… grpcError=… requestTimeout=… otherRetries=… -> PASS|FAIL`).

Helpers (from the worktree root):
```bash
WT=$(pwd); H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees; S=$WT/.scratch; mkdir -p $S
R=$WT/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic
PS='import json,sys;d=next(json.loads(l[11:]) for l in open(sys.argv[1],encoding="utf-8") if l.startswith("PERF_SMOKE "));print(d["wallMs"],d["success"],d["error"],d["matches"],d["markets"],d["selections"],d["transport"])'
WIRE='import re,sys;s=open(sys.argv[1],encoding="utf-8").read();tot={(h,a):int(n) for h,a,n in re.findall(r"^\[Betclic/FullOffer\] (.+?) vs (.+?): (\d+) markets total$",s,re.M)};w=[int(b) for h,a,b in re.findall(r"^\[Betclic/Transport\] (.+?) vs (.+?): wire (\d+) B,",s,re.M) if tot.get((h,a),0)>=150];print("optaMatches",len(w),"maxWire",max(w) if w else None)'
```

- [ ] **Step 1: After Task 2 (gzip).** `$H/bin/heavy --live npx tsx scripts/perf-smoke.ts --bookmaker betclic > $S/betclic-gz.log 2>&1; sed 's/\x1b\[[0-9;]*m//g' $S/betclic-gz.log > $S/betclic-gz.clean.log; python3 -I -c "$PS" $S/betclic-gz.log; python3 -I -c "$WIRE" $S/betclic-gz.clean.log`.

  Pass when:
  - exit 0;
  - `optaMatches ≥ 1` (9 OPTA matches with ≥ 150 raw markets on 2026-11-07, `$R/smoke-after-fix-betclic.txt`) and `maxWire ≤ 700000`;
  - `transport.http.byStatus["200"]` equals the run line's `gzip R/R` count (every response compressed).

  Record `transport.http.bytes`: expected ≈ 4.5–5.5 MB vs 25 855 136 (2026-11-06; betclic.md Task 1 did not change bytes).
- [ ] **Step 2: After Task 7 — concurrency against a sequential run in the same hour.**
  ```bash
  BETCLIC_MATCH_CONCURRENCY=1 $H/bin/heavy --live npx tsx scripts/perf-smoke.ts --bookmaker betclic --out $S/betclic-seq.json > $S/betclic-seq.log 2>&1
  $H/bin/heavy --live npx tsx scripts/perf-smoke.ts --bookmaker betclic --baseline $S/betclic-seq.json > $S/betclic-c3.log 2>&1; echo "exit=$?"
  for f in seq c3; do sed 's/\x1b\[[0-9;]*m//g' $S/betclic-$f.log > $S/betclic-$f.clean.log; done
  python3 -I -c "import re,sys,json;t=re.findall(r'^\[Betclic/FullOffer\] (.+?) vs (.+?): (\d+) markets total$',open(sys.argv[1],encoding='utf-8').read(),re.M);print('SMOKE_RESULT '+json.dumps({'perMatch':[{'match':f'{h} vs {a}','raw':int(n)} for h,a,n in t]}))" $S/betclic-seq.clean.log > $S/betclic-seq-ref.txt
  python3 -I $R/check-log-vs-smoke.py $S/betclic-c3.clean.log $S/betclic-seq-ref.txt 1
  grep -cE '^\[Betclic/FullOffer\] (Skipping|Budget exhausted)' $S/betclic-seq.clean.log $S/betclic-c3.clean.log
  python3 -I -c "$PS" $S/betclic-seq.log; python3 -I -c "$PS" $S/betclic-c3.log; python3 -I -c "$WIRE" $S/betclic-c3.clean.log
  ```
  Pass when **all** of these hold:
  - `exit=0`, and `PARITY` has `pass: true`.
  - The checker prints exactly one run line ending `outOfTolerance=0 failedGroups=0 … -> PASS` (every match within ±1 % of the sequential run, stricter than PARITY's ±2 %). The retry counters are informational; record them.
  - `matches=N` equals both runs' `Found N events in listing` and the reference's row count.
  - Both `grep -c` counts are 0.
  - The concurrent `PERF_SMOKE` has `success: true`, `error: null`, and **`wallMs ≤ 0.7 × the sequential wallMs`** and `≤ 10 000` (README §7 gate). Reference: the sequential post-fix run took 10.2 s for 19 matches (`$R/smoke-after-fix-betclic.txt`); expected ≈ 4–6 s concurrent. If the sequential run of this hour is > 1.5 × 10.2 s, the window is too noisy: repeat the pair next hour.
  - `maxWire ≤ 700000`.

  If plan 07 has landed, note betclic's `[ScrapeMetrics]` event-loop delay p99/max (Task 10's gate).
- [ ] **Step 3: Under load, after merge — DEFERRED to the owner** (needs scheduled runs that persist and the backend log). Record in the task report: for each of the next 3 scheduled runs, betclic.md Task 4 Step 2 unchanged (`smoke-full-offer.mts` in the same hour, then `python3 -I $R/check-log-vs-smoke.py <cleaned backend log> <smoke> 2`); expected:
  - each post-merge run line prints `PASS`;
  - `grep -cE '^\[Betclic/FullOffer\] (Skipping|Budget exhausted)'` over that run's slice is 0 (README §7 "betclic loss under load: 0");
  - the outcome line `[Aggregator/FullOffer] betclic success: 19 matches, …` (or `partial` with the skip text once plan 07 Task 0 has landed).
- [ ] **Step 4: Record** Steps 1–2 as `$S/after-06-{gzip,parity}.txt` and report them; the owner copies them to `$E/betclic-fortuna/` (the evidence directory is in the main checkout, which implementers never write).

### Task 9 (optional, LOW priority): HTTP/2 session reuse

**Gate:** do this only if Task 8 Step 2 misses its wall-time criterion, or the owner wants fewer TLS handshakes. Today a run makes 7N + 1 = 134 handshakes, because every socket is destroyed on settle and the stream never ends. Before starting, run one probe: `$H/bin/heavy --live node -e "const s=require('node:http2').connect('https://offering.begmedia.com');s.on('connect',()=>{console.log(s.alpnProtocol);s.close()})"` must print `h2`.

**Files:** Modify `navigation.ts`, and `index.ts` (`cleanup()` closes the session). Modify `.env.example`: under `# Betclic` add `# BETCLIC_HTTP2=1   # opt-in: reuse one HTTP/2 session per run (default off)`. Test: `__tests__/grpc-h2.test.ts`.

**Interfaces:**
- Produces `openBetclicH2Session(origin: string): BetclicH2Session` with:
  - `request(path: string, headers: Record<string, string>, body: string): Promise<{ status: number; headers: http2.IncomingHttpHeaders; stream: http2.ClientHttp2Stream }>`;
  - `close(): Promise<void>`;
  - `readonly streamsOpened: number`.
- Opt-in with `BETCLIC_HTTP2=1` for one release.
- The destroy target on every settle is the h2 **stream** (`stream.close(http2.constants.NGHTTP2_CANCEL)`), never the session. gzip runs through `pipeline(stream, createGunzip(), () => {})`. The stats keep their HttpStats semantics.

- [ ] **Step 1: Failing tests** against `http2.createServer()` (h2c) on port 0:
  - `7 group requests share one session` (the server sees 1 session, 7 streams);
  - `each stream is cancelled after its frame completes` (`rstCode` 8 on all 7);
  - `cleanup closes the session`;
  - `without BETCLIC_HTTP2 the https/1.1 path is used` (0 h2 sessions).
- [ ] **Step 2:** `heavy npx vitest run src/scrapers/bookmakers/betclic/__tests__/grpc-h2.test.ts` fails with `openBetclicH2Session is not a function`.
- [ ] **Step 3: Implement.** The session is created lazily per `scrapeFullOffer` and closed in `finally`.
- [ ] **Step 4:** Run `heavy npx tsc --noEmit` and `heavy npx vitest run` until green, then Task 8 Step 2 with `BETCLIC_HTTP2=1` under the same criteria.
- [ ] **Step 5:** `git add src/scrapers/bookmakers/betclic .env.example && git commit -m "perf(betclic): optional HTTP/2 session reuse"`

### Task 10 (optional, LOW priority): Take betclic parsing off the hot path

**Gate:** do this only if plan 07's `[ScrapeMetrics]` shows event-loop delay **p99 > 100 ms or max > 250 ms** during the betclic job on 3 consecutive scheduled runs (read by the owner from the live log). One full-offer match parses in ≈ 200 ms as one synchronous block (STRZELCY alone takes 63 ms), so a max above 250 ms means blocks larger than one match.

**Files:**
- Modify `parser.ts:781-830`. Extract the merge/dedupe tail of `parseAllMarketsFromMultipleResponses` into `export function mergeParsedMarkets(perResponse: ScrapedMarket[][]): ScrapedMarket[]`. This is a pure refactor: the existing function calls it.
- Modify `match-groups.ts` and `index.ts`.
- Test: extend `__tests__/match-groups.test.ts`.

**Interfaces:** `export async function parseGroupPayloads(responses: Buffer[]): Promise<ScrapedMarket[]>`. It calls `parseAllMarketsFromProto` once per payload, with `await setImmediate()` (`node:timers/promises`) in between, then `mergeParsedMarkets`. Its output deep-equals `parseAllMarketsFromMultipleResponses(responses)`.

- [ ] **Step 1: Failing tests:**
  - `parseGroupPayloads deep-equals the sync parse on [TOP_MSG, HANDICAP_MSG] (32 markets, 460 selections)`;
  - `yields between payloads` (a spied yield wrapper is called `responses.length - 1` times);
  - the golden test unchanged.
- [ ] **Step 2:** The tests fail with `parseGroupPayloads is not a function`.
- [ ] **Step 3: Implement.** `index.ts` awaits it instead of the sync call.
- [ ] **Step 4:** Run `heavy npx tsc --noEmit` and `heavy npx vitest run` until green; the owner re-reads the gate metric on 3 scheduled runs. If the max is still > 250 ms, write a separate plan for a `worker_thread` or a targeted decode, with its own parity gate.
- [ ] **Step 5:** `git commit -m "perf(betclic): yield to the event loop between group parses"`

## Self-Review

1. **Spec coverage.** Each brief item maps to a task:
   - fallback deletion with no silent `[]`, now urgent because it is reachable on integration: Task 1 (README §5.0 F1);
   - K, stated and justified: Tasks 1 and 5 (the header evidence makes K data-driven);
   - order around betclic.md Task 1 (merged): Global Constraints and the task headers;
   - gzip via `pipeline` with one `release()` on the source: Task 2, shrunk to what betclic.md Task 1 left open;
   - duplicates: Task 3, generalised to any earlier group;
   - declared categories only (no `startTime`; plan 01 owns it): Task 4;
   - concurrency 3: Task 6; the 90 s budget: Task 7;
   - protected log formats: the Task 6 test; the checker's current retry kinds: Global Constraints;
   - optional HTTP/2 and parse offload: Tasks 9 and 10;
   - fixtures (tracked), `grpc-web-frame.test.ts` reuse and the fake `node:http` server: Tasks 1, 2 and 7;
   - live numeric criteria, rebaselined to the 10.2 s sequential reference: Task 8; persisting checks deferred to the owner.

   The coordinator's refinements are covered too: `TransportStatsSource` with cumulative counters in Task 2, `DeclaresTransport` in Task 1, the `success: true` + `error` contract in Global Constraints with its `partial` mapping owned by plan 07 Task 0, `.env.example` entries in Tasks 6 and 9, and plan 01's harness mock in Task 1.
2. **Step scan.** Exact strings and values throughout; synthetic values are labelled. Every vitest/tsc/tsx command runs through `heavy`; live smokes are read-only and one at a time; output goes to `.scratch/`. Only two code blocks remain: the gzip response path and the budget arithmetic, which the brief asks to state exactly.
3. **Type consistency.** These names are used the same way in every task: `BetclicGroupName`, `BetclicGroupResult`, `MatchGroupAssessment`, `BetclicTransportStats extends HttpStats`, `GrpcCallOptions`, `MatchFetchContext`, `BetclicMatchOutcome` and `parseMatchHeader` (now `{ categories }` only). §3 names are used verbatim. Plan 02's semantics are handled explicitly:
   - `remainingMs()` is 0 once aborted;
   - `createScrapeBudget` raises `RangeError` for ≤ 0;
   - `mapLimit` rejects items that were not started;
   - `transportStats()` is cumulative, so consumers diff.
4. **Review focus.** Each of the 5 items names its tests and the task that owns them; item 1 now targets what is actually left (`req` and the wrapped stream), not the `res.destroy()` betclic.md Task 1 already added.
5. **Proportion.** Fixed while writing and revising:
   - budget and concurrency are split into separate tasks;
   - K is relaxed only from data TOP provides, never from payload sizes;
   - a spent parent budget no longer reaches `createScrapeBudget(0)`;
   - the pre-change network guard is removed in Step 3, so the grep check excludes nothing;
   - the browser guard spies `initBrowser`, which survives plan 08's runtime, instead of `browserPool.acquire`.

## Open Questions

1. **Outcome status for `success: true` + `error`.** Resolved: plan 07 Task 0 (README §5.0 F3) maps `scrape.success && scrape.error && marketsSaved > 0` to `partial`, joining save errors after `" | "`. Until it lands, betclic's skipped-match runs read `success` and the cause is only in the log lines.
2. **Stop fetching undeclared categories?** Skipping them would save 1 request per OPTA match and 3 per far match (~37 of 134 requests per run). But the listing carries no field 10 (live probe), so the declared list only arrives with TOP: fetching TOP first would add one round trip (~0.4 s) per match. Default: keep fetching all 7 in parallel. Task 3 makes the echoes nearly free and Task 5 makes them harmless. Revisit only if Task 8 misses its wall-time criterion for reasons other than TLS (Task 9).
3. **Unfetched declared categories.** `ca_ftb_ft` ("⚡ Fast") and `ca_ftb_pssb` (SuperSub) are declared on OPTA matches but never fetched. This is a coverage question, not a performance one. Default: out of scope here; run a one-off market-discovery comparison before adding them.
