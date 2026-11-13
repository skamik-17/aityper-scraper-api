# STS WebSocket Transport (05a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:**
> - Re-anchored on the future base (`recovery/integration` ≥ `aaf7c07` + unmerged `recovery/observability` and `recovery/fortuna`). sts.md Tasks 1–7 are on integration (d626d09, 3f67cbc, 29a0a09, …). `sts/index.ts` anchors moved by about +5 lines. On the future-base parser the 2026-11-07 frames give **6 146** markets (all 19 fixtures) and **527** for f2921896, where 377b47e gave 5 589 / 453. The thresholds are unchanged (`evidence/delta-audit-transport-2026-11-13.md` "05a").
> - New **Task 0**: a browser-path circuit breaker as a follow-up fix on the recovery code. Integration has none: `sts/index.ts:310-326` retries every fixture twice and never stops. Task 0 is a precondition of Tasks 1–6. It also fixes `sts-run-check.py:21` for observability's `sts scrape_failed:` line (`delta-audit-infra-2026-11-13.md` README item 7).
> - `StsWsScraper` declares `readonly transport = "websocket" as const` (cross-plan #19). It sets `error = "<missing> of <requested> details failed | <first cause>"` whenever 0 < missing and the breaker did not trip (#15). Its `transportStats()` counters are cumulative since construction (README §3), and a test pins that.
> - Adopts the EXECUTION.md workspace rules: worktree from `recovery/integration`, symlinked `node_modules` and never `npm install`, the dead-port `.env`, `bin/heavy` (`--live` for network/browser), outputs under `.scratch/`, and no server, scheduler or DB write. The merge and the scheduled-run checks are DEFERRED to the owner, with the command and the expected result recorded.
> - Removed: the evidence-copy precondition (the recovery docs are tracked on integration) and Task 4's "when sts.md Task 7 has merged" condition (`replay-2026-11.test.ts` exists). Task 5's signal table gains the strict-filter "matched 0 fixtures" warning. Task 6 runs the recovery F17 probe with `SCRAPER_TRANSPORT_STS=browser`. Aggregator greps use observability's `[Aggregator/FullOffer] sts <status>: …` line.

**Goal:** Replace STS's ~30 Chromium page loads per league run with one Node WebSocket session. Today that path costs 97–120 s, 1.4 GB PSS and 172 Chromium CPU-s, and it is the critical path of the whole cycle. The session reads the listing from `i_pl` and every fixture snapshot from one subscription, in under 3 s, with byte-identical `FullMatchOffer` output. Before that, give today's browser path a circuit breaker, so a systemic snapshot miss costs about a minute instead of 10–29 min.

**Architecture:** Task 0 adds a consecutive-miss breaker to the recovery loop in `sts/index.ts`. Next, the pure mapping `listing fixture + fixture snapshot + i_pl → FullMatchOffer` is extracted from `sts/index.ts` into `sts/offer-mapping.ts`. The existing browser class, renamed `StsBrowserScraper`, calls it; its breaker counters stay in the loop. A new `StsWsScraper` opens one README §3 `WsSession` per `scrapeFullOffer` call and subscribes to `i_pl`. It derives the fixture list with the recovery plan's strict filter and subscribes to all `f_<id>_pl` snapshots in one message. It re-sends once for missing ids and skips what is still missing. A systemic miss trips a breaker. Every fixture goes through the same mapping. `createStsScraper()` picks the class through `getTransportOverride("sts")` (`SCRAPER_TRANSPORT_STS=browser`).

**Tech Stack:** TypeScript (ESM, Node 20), README §3 `WsSession` (plan 02, `ws`), Vitest 4, tsx.

**Spec:** README §1.4 (STS row), §2 principles 1–3, §3 (`WsSession`, `ScrapeBudget`, `FullOfferScraper`, `DEFAULT_MAX_DURATION_MS`, `getTransportOverride`, the one-pick rule, `DeclaresTransport`, cumulative `transportStats()`, parity pattern), §5 (P5, P7) and §5.1 (sts.md row), §6, §7.
- Evidence (main checkout, untracked, read-only): `evidence/sts-superbet/` (`sts-ws-probe.mjs`, `sts-ws-probe-save.mjs`, `sts-parity.mts`, `sts-probe.mjs`, `data/ws-probe-ipl.json`, `data/ws-probe-ipl.json.frames.ndjson`, `data/ws-probe-noipl.json`, `data/sts-probe.json`), `evidence/profiling/summary-individual.json` (sts entry), `evidence/findings-notes.md` (STS-1…STS-7), `evidence/delta-audit-transport-2026-11-13.md`, `evidence/delta-audit-infra-2026-11-13.md`.
- Plan 02 (`02-shared-transport.md`): Task 1 budget texts, Task 2 `DEFAULT_USER_AGENT`, Task 5 `TransportStats`, Task 6 aggregator typing, Task 7 override, Task 8 `WsSession` semantics, Task 10 `perf-smoke` CLI. Plan 07: `DeclaresTransport`, the `partial` rule.
- Recovery, tracked on integration: `docs/superpowers/plans/2026-11-06-scraper-recovery/sts.md` (Tasks 1–7 built; Acceptance B/C) and its `evidence/sts/` (`sts-run-check.py`, `smoke-full-offer.mts`, frame fixtures), plus `EXECUTION.md` in the same directory.

## Global Constraints

- README §6 applies in full: `tsc` + `vitest` green before every commit, the golden test unchanged, the parity gate, no footers, and the live traffic rules. On top of that, the EXECUTION.md workspace rules apply:
  - One worktree per branch under `/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/`, branched from `recovery/integration`. Never edit, checkout or write in the main checkout `/home/skamik/Documents/repositories/personal/aityper-scraper-api` (reading is fine), and never write in the frontend repo.
  - `node_modules` is a symlink to the main checkout's. Never run `npm install`/`npm ci`. `ws` 8.19.0 is already in the lockfile, and plan 02 adds the `package.json` entries.
  - `.env` is a copy of the integration worktree's, which points Supabase at a dead port (`SUPABASE_URL=…:9`). Never change it.
  - Every `npx vitest`, `npx tsc`, `npx tsx`, `python3` over large files and Playwright run goes through `$HEAVY` (`…-worktrees/bin/heavy`). Network or browser runs use `$HEAVY --live`, one at a time. During TDD run only the scoped tests. Run the full suite and `tsc` once at the end of each task.
  - Never start the server or the scheduler, and never run anything that writes to the DB. Live acceptance that needs a persisted scrape is **DEFERRED**: record the exact command and the expected result in the task report.
  - Scratch output goes to `$WT/.scratch/` (gitignored through `.git/info/exclude`), not `/tmp`. That includes the perf-smoke JSON and logs.
  - Commits carry the plan's message, no footer, and go only on this plan's branch. Commit only when the owner has asked for commits.
- Baseline: the future base has 125 test files / 2243 tests (integration alone 91 / 1725). Record the worktree's own count before the first change.
- Preconditions (checked in "Preconditions and worktree"):
  - Task 0 needs only `recovery/integration`.
  - Tasks 1–6 need plan 02 merged (`budget.ts`, `ws/ws-session.ts`, `scraper-contract.ts`, `config/transport.ts`, `scripts/perf-smoke.ts`, the aggregator typed `Record<PolishBookmaker, FullOfferScraper>`).
  - Tasks 1–6 also need Task 0 in the base.
- Endpoint `wss://www.sts.pl/sbk/api/sbk`. The headers are exactly these three, with lower-case keys as plan 02 merges them: `origin: https://www.sts.pl`, `user-agent: DEFAULT_USER_AGENT` (plan 02 `shared/http/http-client.ts`, Chrome/143) and `accept-language: pl-PL,pl;q=0.9`. No cookies.
- The client sends only `{"t":1,"u":[…]}` topic subscriptions and one `{"t":4}`. It never sends the browser's `"b"` subscriptions (`place.rsp`, `session`, `slips.rsp`, `cashout`), `bonus.req/*` requests or anything account-related.
- Timeouts: connect 10 000 ms; `i_pl` snapshot 10 000 ms; fixture snapshots 5 000 ms, plus exactly one re-send with another 5 000 ms. Every wait is `min(timeout, budget.remainingMs())`. The default budget is `DEFAULT_MAX_DURATION_MS.websocket` (120 000 ms).
- WebSocket breaker: after the re-send, if `missing >= 3` or `missing / requested > MAX_SKIPPED_DETAIL_RATIO (0.5)`, the result is `success: false` with `matches: []`. Observability's `aggregator.ts:288` then writes and prunes nothing for STS in that run. Below the breaker, when 0 < missing, the result is `success: true` with `error: "<missing> of <requested> details failed | ws timeout <ms>ms <url>"`. Plan 07's `partial` rule turns that shape into `partial`; until it lands, observability classifies it `success` and drops the text.
- Browser breaker (Task 0): after `MAX_CONSECUTIVE_MATCH_FAILURES` (3) consecutive `captureMatchWithRetry` misses → `{ success: false, matches: [], error: "<misses> of <n> details failed | no fixture snapshot <first missed eventUrl>" }`. Fewer misses → `success: true` with the same `error` text.
- One session per `scrapeFullOffer` call, closed in `finally`; no reuse across leagues.
- `recordStsFrame` (`navigation.ts:148`), `hasFixtureSnapshot` (`:179`), `isSnapshotFrame` (`:136`), `captureMatchWithRetry` (`:189`, sts.md Task 1) and `parseFixtures`'s strict filter (`parser.ts:163`, sts.md Task 2) are reused unchanged. `parser.ts`, `sts-normalizer.ts` and the catalog are not touched.
- Both transports call `parseAllMarkets(fixture, snapshotJson, iplJson)` only through `mapStsFixtureToOffer`.
- The log lines that `sts-run-check.py` parses stay byte-identical: `:27` `[STS/FullOffer] Found N fixtures for <league>`, `:32` `[STS/FullOffer] Completed: N matches, M total markets`, `:34` `[STS/FullOffer] No fixture snapshot for <home> vs <away> after 2 attempts - skipping (previous snapshot kept)`, `:36` `[STS/FullOffer] Skipping <home> vs <away>: Youth team match` / `: Teams not in <league> whitelist`, and `:38` `[STS/FullOffer] <home> vs <away>: N markets`. Its `:21` (aggregator outcome) and `:23` (strict-id miss) patterns read lines this plan does not print itself.
- The browser fallback keeps its 1500 ms sleeps (`navigation.ts:254,312`), its per-match `i_pl` re-parse (`index.ts:329`) and `delay(200)` (`index.ts:397`). The WS path has none of them.
- Live: one WS session per smoke, never HH:55–HH:10. The browser comparison run happens in the same hour, with no listed kickoff between the two runs.

## Review Focus

1. **A delta arrives before the snapshot** (a fixture `f_<id>_pl` delta, or an `i_pl` delta before the 3 MB `i_pl` snapshot). The wait must not end on it, and a delta-only fixture is a miss. Pinned by Task 3 `a fixture delta before its snapshot does not complete the fixture`, `an i_pl delta before the i_pl snapshot does not end the listing wait`, `a delta-only fixture is skipped like a missing one`.
2. **The server answers only part of the subscription.** One re-send follows, with `n:0` only for the missing ids (the others listed without `n`). A fixture still missing after it gets the recovery log line and no `FullMatchOffer`. Below the breaker the result is `success: true` with `error: "<missing> of <requested> details failed | ws timeout …"`. With 3 or more missing, or more than half, it is `success:false`, `matches: []`. Pinned by Task 3 `re-sends once, with n:0 only for the missing fixture`, `skips a fixture whose snapshot never comes`, `trips the breaker when 3 of 4 snapshots never come`, `2 of 4 missing does not trip the breaker`.
3. **Cloudflare starts blocking non-browser clients** (handshake 403/429/503, close 1008), the connection fails before the handshake (`ws failed ECONNRESET …`), or the socket dies mid-run (1006). Expected: `success:false` with the §3 message verbatim, a `[STS/WS] blocked - …` hint only for the blocking signals, the session closed, and no partial matches. Pinned by Task 2's `classifyStsWsFailure` table and Task 3 `handshake 403 …`, `connect timeout is transient …`, `socket closes while snapshots stream`.
4. **A budget shorter than the protocol timeouts** (plan 07 deadlines). Every `collect` timeout must be ≤ `budget.remainingMs()`, and an already-aborted budget opens no socket. Pinned by Task 3 `caps every collect timeout by the budget`, `an aborted budget opens no session`.
5. **The two transports drift apart** (in the mapping, the order, or the log lines the recovery scripts parse). Expected: deep-equal `FullMatchOffer[]` (ignoring `scrapedAt`) and identical `[STS/FullOffer]` line sequences on two recorded sets. Pinned by Task 1 `stsLog lines match the sts-run-check.py patterns` and Task 4 `both transports produce deep-equal offers and the same [STS/FullOffer] lines`.
6. **The browser path loses every fixture snapshot** (a site change, or a blocked match page). The loop must stop after 3 consecutive misses and return `success:false`, so nothing is written and nothing pruned. A captured fixture resets the count, and the error names the first miss. Pinned by Task 0 `stops after 3 consecutive fixtures without a snapshot`, `a captured fixture resets the count; the error names the first miss`.

---

## Observations (pre-fix analysis)

All `file:line` refer to the future base: `recovery/integration` (≥ `aaf7c07`), plus observability for `aggregator.ts` and `playwright-base.ts`. Neither observability nor fortuna touches `src/scrapers/bookmakers/sts/`.

### Today's browser path (what leaves the hourly run)

- Run alone (`evidence/profiling/summary-individual.json`, sts, measured on master 377b47e): 97.4 s wall, 10 472 requests, 10.72 MB, 60 navigations, peak Chromium PSS 1 388 MB, Chromium CPU 171.9 s, **19 matches / 5 589 markets / 20 570 selections**. In the parallel cycle it took 117–120 s and was the critical path (README §1.1). The recovery parser on integration turns the same frames into **6 146** markets (delta audit).
- Flow on integration:
  - the league page: `navigateAndCaptureLeagueData` (`navigation.ts:224`), `goto`, a 1500 ms sleep at `:254`, the cookie probe and a poll;
  - then per fixture: `captureMatchWithRetry` (`:189`, 2 attempts), each attempt a full `goto` via `navigateAndCaptureMatchData` (`:286`), a 1500 ms sleep at `:312` and a poll of up to `WS_DATA_TIMEOUT` 12 s (`constants.ts:464`);
  - a re-parse of the ~3.06 MB `i_pl` (`index.ts:329`, 65–87 ms each, STS-2) and `delay(200)` (`index.ts:397`).
  sts.md Task 2's strict filter (`constants.ts:44-52`, `parser.ts:179,185`) brings the listing from 29 fixtures down to the 19 PL ones.
- **No circuit breaker** (`index.ts:310-326`): a fixture without a snapshot logs `No fixture snapshot … skipping (previous snapshot kept)` (`:323`) and the loop goes on. A systemic miss therefore costs 19 × 2 attempts (10–29 min) and ends `success: true` with no error and 0 matches. Betcris on integration already has the pattern this plan copies: `WS_CONFIG.MAX_CONSECUTIVE_MATCH_FAILURES: 3` (`betcris/constants.ts:235`), used at `betcris/index.ts:285-294`.
- Observability `aggregator.ts:288` saves only when `success && matches.length > 0`. A `success:false` result writes and prunes nothing. The outcome line is `[Aggregator/FullOffer] sts <success|partial|empty|scrape_failed|persist_failed>: N matches, M markets found, K saved[ - <error>]` (`aggregator.ts:244-245`). `sts-run-check.py:21` still matches only the pre-observability `sts completed: success=…` / `sts failed:` forms. A tripped breaker (or any failed STS run) on observability therefore never reaches its problem list.

### Verified WebSocket protocol

- Node `ws` client (`sts-ws-probe.mjs`, `data/ws-probe-ipl.json`, 2026-11-07 00:43Z), with no browser and no cookies. Headers were `Origin`, a Chrome/120 `User-Agent` and `Accept-Language`. This plan sends plan 02's Chrome/143 `DEFAULT_USER_AGENT` instead; Task 6 is its first live use [I].
  - Handshake 101 at 187 ms. The response carried `server: cloudflare`, `cf-ray` and only `set-cookie: __cflb=…`; `permessage-deflate` was negotiated.
  - Sent at 195 ms: `{"t":1,"u":[{"s":"i_pl","n":0},{"s":"f_f2921895_pl","n":0},…]}`, then `{"t":4}`.
  - Received: the 19 PL snapshots between 254 and 467 ms, the `i_pl` snapshot (3 060 815 chars) at 386 ms, and `{"t":5}` at 468 ms. In all, 745 546 wire bytes for 41 frames in 12 s (5.1 MB decoded).
- Without `i_pl` (`data/ws-probe-noipl.json`), `{"t":5}` arrives at 206 ms, **before** the snapshots (229–301 ms). So `{"t":5}` is not an end-of-snapshots marker. The done condition is "every requested id has a snapshot".
- Frame format: `<header JSON>\n<body JSON>`. Snapshots carry `"f":1` (`{"s":"f_f2921896_pl","n":1794012195802791,"f":1}`); deltas do not. `i_pl` deltas arrive about once per second, and fixture deltas after the snapshot (`data/ws-probe-ipl.json` frames 10–15, 29–41).
- Browser framing (`data/sts-probe.json`, a CDP capture of the real page) [V]:
  - The first frames are `{"t":1,"u":[{"s":"i_pl","n":0}]}` and `{"t":4}`. Every later `t:1` repeats the whole topic set. `n:0` asks for a snapshot, and topics already synced are listed without `n` (`{"s":"i_pl"}`).
  - The match page re-sent `{"s":"f_f2921896_pl","n":0}` at 9 607 ms and got a second 206 719-char snapshot at 11 388 ms.
  - That a topic listed without `n` stays subscribed without a new snapshot is inferred from the same capture [I]. This plan sends exactly these shapes.
- STS-6 (the unanchored `/f(\d+)/` URL regex), the cookie handler (`COOKIE_BUTTON_TEXT`, `constants.ts:474`) and both 1500 ms sleeps do not apply on the WS path: ids come from the listing, and there is no page.

### Parity evidence

- On 2026-11-07, `sts-parity.mts` on `data/ws-probe-ipl.json.frames.ndjson` with 377b47e's parser found 19 PL fixtures, all with a snapshot. For all 19, `parseAllMarkets(fx, snapshot, i_pl)` was byte-identical to `parseAllMarkets(fx, snapshot, null)`. The near fixtures had 428–467 markets each and the far ones 153–156; the total of 5 589 equalled the browser run. On the future-base parser the same frames give **6 146** in total.
- The trimmed 4-fixture set used by this plan's tests (Task 1 Step 1) gives f2921896 **527** on the future base (453 on 377b47e). The three far-future fixtures f2921905/f2921906/f2921911 gave 153/155/153 on 377b47e; the tests do not pin them. Canonical names: Leeds United–Tottenham Hotspur, Newcastle United–Arsenal, Chelsea–Leeds United, AFC Bournemouth–Nottingham Forest.

### Cloudflare and failure signals

- Browser handshakes carry `cf_clearance` and `__cflb` cookies (`data/sts-probe.json`). The cookie-less Node handshake got 101 in both probes. No challenge has been observed; the signals in Task 5's table are the standard Cloudflare/WebSocket outcomes [I]. The fallback is the existing browser class behind `SCRAPER_TRANSPORT_STS=browser` (README §8 Q1: yes, with fallback).

### Risks and non-goals

- The protocol is undocumented. The parity test (Task 4) and the breaker make a silent change visible within one run.
- `i_pl` is one ~3 MB message. Plan 02 Task 8 keeps the `ws` defaults (`maxPayload` 100 MiB) and enables `permessage-deflate` (~0.75 MB on the wire instead of ~5.1 MB). Its session buffers frames that arrive while no `collect` runs and replays them into the next one, so late snapshots from the first wait still count in the re-send wait.
- One 65–87 ms `JSON.parse` per league run stays on the event loop (today there are ~30 per run).
- Non-goals: one session for all leagues (plan 07/10); delta-based incremental updates (plan 10); filtering youth or non-whitelisted fixtures before subscribing (that keeps the mapping identical); a cookie bootstrap from a browser (the flag covers it); deleting the browser class (plan 10); the module-level `eventsCache` of `sts/index.ts:35-39`, which the WS path never writes (plan 10 deletes it with the browser class).

## Preconditions and worktree

```bash
REPO=/home/skamik/Documents/repositories/personal/aityper-scraper-api           # main checkout: read only
WTS=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees
HEAVY=$WTS/bin/heavy
EVP=$REPO/docs/superpowers/plans/2026-11-07-scraper-performance/evidence/sts-superbet   # untracked, absolute, read only
EVR=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts                    # tracked on integration: relative to the worktree
```

**Task 0** (its own branch, mergeable before plan 02 and plan 07):

```bash
WT=$WTS/perf-sts-breaker
git -C "$REPO" worktree add -b perf/sts-breaker "$WT" recovery/integration
ln -s "$REPO/node_modules" "$WT/node_modules" && cp "$WTS/integration/.env" "$WT/.env"
cd "$WT" && grep -c '^SUPABASE_URL=.*:9$' .env                                             # 1 (dead port)
grep -c "export function recordStsFrame\|export function hasFixtureSnapshot\|export async function captureMatchWithRetry" src/scrapers/bookmakers/sts/navigation.ts   # 3
grep -c "MAX_CONSECUTIVE_MATCH_FAILURES" src/scrapers/bookmakers/sts/constants.ts        # 0 (Task 0 not built yet)
$HEAVY npx vitest run 2>&1 | grep -E "Test Files|Tests "                                 # record the baseline
```

**Tasks 1–6** (`perf/sts-websocket`). Branch from `recovery/integration` once it contains Task 0 and plan 02; until the owner merges them there, branch from the branch that has both:

```bash
WT=$WTS/perf-sts-ws
PS=$WT/.scratch/perf-smoke
BASE=recovery/integration            # or the branch carrying Task 0 + plan 02
git -C "$REPO" worktree add -b perf/sts-websocket "$WT" "$BASE"
ln -s "$REPO/node_modules" "$WT/node_modules" && cp "$WTS/integration/.env" "$WT/.env"
cd "$WT" && mkdir -p .scratch && grep -c '^SUPABASE_URL=.*:9$' .env                       # 1
grep -c "export function recordStsFrame\|export function hasFixtureSnapshot\|export function isSnapshotFrame\|export async function captureMatchWithRetry" src/scrapers/bookmakers/sts/navigation.ts   # 4
grep -c "strictTournamentId" src/scrapers/bookmakers/sts/constants.ts src/scrapers/bookmakers/sts/parser.ts                                                          # >= 1 each
ls src/scrapers/bookmakers/sts/__tests__/fixtures/{i_pl.trimmed.txt,f_f2921896_pl.leeds-tottenham.snapshot.txt,f_f2921896_pl.leeds-tottenham.delta.txt,f_f2921898_pl.arsenal-hull.snapshot.txt} src/scrapers/bookmakers/sts/__tests__/replay-2026-11.test.ts
grep -c "MAX_CONSECUTIVE_MATCH_FAILURES" src/scrapers/bookmakers/sts/constants.ts && ls src/scrapers/bookmakers/sts/__tests__/snapshot-breaker.test.ts   # Task 0: 1, file exists
ls src/scrapers/shared/budget.ts src/scrapers/shared/ws/ws-session.ts src/scrapers/shared/scraper-contract.ts src/config/transport.ts scripts/perf-smoke.ts
grep -c "Record<PolishBookmaker, FullOfferScraper>" src/scrapers/aggregator.ts   # >= 1
node -e "require.resolve('ws')" && grep -c SCRAPER_TRANSPORT_STS .env            # resolves; 0
$HEAVY npx vitest run 2>&1 | grep -E "Test Files|Tests "                         # record the baseline
```

If any line fails, a dependency has not landed: stop. The recovery evidence (`$EVR`) is tracked on integration and is present in the worktree. The perf evidence (`$EVP`) is read from the main checkout by absolute path and is never copied into `docs/`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/bookmakers/sts/constants.ts` (after `WS_POLL_INTERVAL`, `:469`) | `MAX_CONSECUTIVE_MATCH_FAILURES = 3` | 0 |
| `src/scrapers/bookmakers/sts/index.ts:308-326`, `:411-417` | browser breaker in the per-fixture loop; `error` on the success result when fixtures were missed | 0 |
| `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py:5-10,21` | also catch observability's `sts empty|scrape_failed|persist_failed:` lines | 0 |
| `src/scrapers/bookmakers/sts/offer-mapping.ts` (new) | `mapStsFixtureToOffer`, `stsLog`: the one mapping and log vocabulary both transports use | 1 |
| `src/scrapers/bookmakers/sts/index.ts` | the browser path calls the mapping; the class is renamed `StsBrowserScraper` (old names kept as aliases); later `createStsScraper` + `stsScraper` | 1, 5 |
| `src/scrapers/bookmakers/sts/ws-protocol.ts` (new) | endpoint, headers, timeouts, subscription framing, frame reducer adapter, breaker predicate, failure classification | 2 |
| `src/scrapers/bookmakers/sts/ws-scraper.ts` (new) | `StsWsScraper`: one session per league call | 3 |
| `src/scrapers/bookmakers/index.ts:16` | exports `stsScraper`, `StsBrowserScraper`, `StsWsScraper`, `STSScraper`, `STSPlaywrightScraper` | 5 |
| `src/scrapers/bookmakers/sts/README.md` (`## Architecture` `:6`, `### Core Scraper` `:9-10`) | the flag and the operator signals (`.env.example` already shows `SCRAPER_TRANSPORT_STS=browser`, plan 02 Task 7) | 5 |
| `src/scripts/analyze-bookmaker-markets.ts:36,41` | retype only if `tsc` flags it | 5 |
| `src/scrapers/bookmakers/sts/__tests__/fixtures/ws-2026-11-07/` (new) | 6 recorded WS frames (386 181 bytes) | 1 |
| `src/scrapers/bookmakers/sts/__tests__/helpers/sts-frames.ts` (new) | fixture readers (`capture.test.ts`'s `fx`/`empty()` moved here), `captureFrom`, `captureLines`, `restrictIplFrame` | 1, 4 |
| `src/scrapers/bookmakers/sts/__tests__/capture.test.ts`, `replay-2026-11.test.ts` | import `readStsFixture`/`emptyCapture` instead of their local copies (no assertion change) | 1 |
| `src/scrapers/bookmakers/sts/__tests__/helpers/browser-replay.ts` (new) | `runBrowserPath` over recorded frames | 1 |
| `src/scrapers/bookmakers/sts/__tests__/helpers/fake-sts-server.ts` (new) | `createFakeStsServer`, `runWsPath` | 3 |
| `__tests__/snapshot-breaker.test.ts` | the browser breaker | 0 |
| `__tests__/browser-path-replay.test.ts`, `__tests__/offer-mapping.test.ts` | characterization + mapping | 1 |
| `__tests__/ws-protocol.test.ts` | protocol helpers | 2 |
| `__tests__/ws-scraper.test.ts` | WS orchestration | 3 |
| `__tests__/transport-parity.test.ts` | README §6 gate (1) | 4 |
| `__tests__/transport-select.test.ts` | flag selection (the pick) | 5 |

(All test paths are under `src/scrapers/bookmakers/sts/`.)

---

### Task 0: Browser-path circuit breaker (follow-up on sts.md Task 1)

Branch `perf/sts-breaker`. It needs nothing from plan 02. It must merge before plan 07's 240 s browser deadline (README §5 P5) and before Tasks 1–6.

**Files:**
- Modify: `src/scrapers/bookmakers/sts/constants.ts`: insert after `WS_POLL_INTERVAL` (`:469`).
- Modify: `src/scrapers/bookmakers/sts/index.ts`:
  - `:24-33`: import `MAX_CONSECUTIVE_MATCH_FAILURES` (`./constants.js`) and `STSFixture` (already imported at `:33`);
  - `:308`: counters before the loop;
  - `:321-326`: the miss branch;
  - `:411-417`: the success return.
- Modify: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py:5-10,21`.
- Test: `src/scrapers/bookmakers/sts/__tests__/snapshot-breaker.test.ts`.

**Interfaces:**
- Consumes: `captureMatchWithRetry`, `recordStsFrame`, `navigateAndCaptureLeagueData`, `navigateAndCaptureMatchData` (`navigation.ts:189,148,224,286`); `PlaywrightScraper.executeFullOfferScrape`/`delay` (observability `playwright-base.ts:353`, `:233`; integration `:347`, `:227`), spied; `WSCaptureResult` (`types.ts:169`). The pattern is betcris's `WS_CONFIG.MAX_CONSECUTIVE_MATCH_FAILURES` (`betcris/constants.ts:235`, `betcris/index.ts:285-294`).
- Produces:
  ```ts
  // constants.ts
  /** The per-fixture loop stops after this many consecutive fixtures without a snapshot */
  export const MAX_CONSECUTIVE_MATCH_FAILURES = 3;
  // index.ts, per-fixture loop (behaviour)
  // miss  → warn the unchanged "No fixture snapshot … (previous snapshot kept)" line; misses++; firstMissed ??= fixture;
  //         ++consecutiveMisses >= MAX_CONSECUTIVE_MATCH_FAILURES →
  //           console.warn(`[STS/FullOffer] Aborting per-fixture loop: ${consecutiveMisses} consecutive fixtures without a snapshot`);
  //           return { success: false, bookmaker, league, matches: [], duration,
  //                    error: `${misses} of ${fixtures.length} details failed | no fixture snapshot ${firstMissed.eventUrl}` };
  // hit   → consecutiveMisses = 0, then the unchanged mapping
  // end   → Completed line unchanged; success: true, plus the same `error` text when misses > 0 (no `error` key otherwise)
  ```

- [ ] **Step 1: Write the failing test**

```ts
// snapshot-breaker.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
vi.mock("../navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../navigation.js")>()),
  navigateAndCaptureLeagueData: vi.fn(), navigateAndCaptureMatchData: vi.fn(),
}));
import * as nav from "../navigation.js";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import { STSPlaywrightScraper } from "../index.js";
import { MAX_CONSECUTIVE_MATCH_FAILURES } from "../constants.js";
import type { WSCaptureResult } from "../types.js";

const fx = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const IPL = fx("i_pl.trimmed.txt");                                     // 20 valid PL fixtures, f2921895 first
const LEEDS = fx("f_f2921896_pl.leeds-tottenham.snapshot.txt");
const snapshotFor = (id: string) => LEEDS.replaceAll("f2921896", id);    // the same snapshot, re-keyed to another fixture
const capture = (...frames: string[]): WSCaptureResult => {
  const r: WSCaptureResult = { initialData: "", fixtureData: new Map() };
  for (const f of frames) nav.recordStsFrame(r, f);
  return r;
};
const FIRST = "https://www.sts.pl/kursy/manchester-united-aston-villa/f2921895";

async function run(hit: (id: string) => boolean) {
  vi.mocked(nav.navigateAndCaptureLeagueData).mockResolvedValue(capture(IPL));
  vi.mocked(nav.navigateAndCaptureMatchData).mockImplementation(async (_page: unknown, url: string) => {
    const id = url.split("/").pop()!;
    return capture(IPL, ...(hit(id) ? [snapshotFor(id)] : []));
  });
  vi.spyOn(PlaywrightScraper.prototype as any, "executeFullOfferScrape")
    .mockImplementation((league: any, _valid: any, logic: any) => logic({}, league));   // bypasses the browser and the recorder
  vi.spyOn(PlaywrightScraper.prototype as any, "delay").mockResolvedValue(undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const r = await new STSPlaywrightScraper().scrapeFullOffer("premier-league");
  return { r, warns: warn.mock.calls.map(([m]) => String(m)), logs: log.mock.calls.map(([m]) => String(m)),
    pages: vi.mocked(nav.navigateAndCaptureMatchData).mock.calls.length };
}
afterEach(() => { vi.restoreAllMocks(); vi.mocked(nav.navigateAndCaptureMatchData).mockReset(); });

describe("sts browser path: snapshot circuit breaker", () => {
  it("stops after 3 consecutive fixtures without a snapshot", async () => {
    const { r, warns, logs, pages } = await run(() => false);
    expect(r).toMatchObject({ success: false, matches: [], error: `3 of 20 details failed | no fixture snapshot ${FIRST}` });
    expect(pages).toBe(6);                                                  // 3 fixtures x 2 attempts; today 40
    expect(warns.filter((w) => w.startsWith("[STS/FullOffer] No fixture snapshot for "))).toHaveLength(3);
    expect(warns).toContain("[STS/FullOffer] Aborting per-fixture loop: 3 consecutive fixtures without a snapshot");
    expect(logs.some((l) => l.startsWith("[STS/FullOffer] Completed:"))).toBe(false);
  });
  it("a captured fixture resets the count; the error names the first miss", async () => {
    // fixtures 1 miss, 2 hit, 3 miss, 4 hit, 5-7 miss -> trips at fixture 7 with 5 misses
    const { r, pages } = await run((id) => id === "f2921896" || id === "f2921898");
    expect(r).toMatchObject({ success: false, matches: [], error: `5 of 20 details failed | no fixture snapshot ${FIRST}` });
    expect(pages).toBe(12);
  });
  it("a miss below the breaker keeps success and names the cause", async () => {
    const { r, logs } = await run((id) => id !== "f2921897");
    expect(r.success).toBe(true);
    expect(r.error).toBe("1 of 20 details failed | no fixture snapshot https://www.sts.pl/kursy/fulham-newcastle/f2921897");
    expect(r.matches.map((m) => m.matchId)).not.toContain("f2921897");
    expect(r.matches.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.startsWith("[STS/FullOffer] Completed:"))).toBe(true);
  });
  it("no miss: success without an error key (characterization)", async () => {
    const { r, pages } = await run(() => true);
    expect([r.success, "error" in r, pages]).toEqual([true, false, 20]);
  });
  it("the breaker limit is 3", () => expect(MAX_CONSECUTIVE_MATCH_FAILURES).toBe(3));
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts/__tests__/snapshot-breaker.test.ts`
Expected: tests 1, 2, 3 and 5 FAIL. Test 1 gets `success: true` and 40 page captures; test 2 gets `success: true`; test 3 gets `r.error` `undefined`; test 5 gets `undefined`. Test 4 passes.

- [ ] **Step 3: Implement the breaker** as specified under Produces. The `No fixture snapshot …` line at `:323` stays byte-identical and is still printed for every miss, including the one that trips the breaker. The `Completed:` line is printed only when the loop finishes. The thrown-error `catch` (`:398-403`) does not count as a miss, as today.

- [ ] **Step 4: Fix `sts-run-check.py` for observability's outcome line.** Replace the pattern at `:21` with `r"^\[Aggregator/FullOffer\] sts (completed: success=.*|failed:.*|(?:empty|scrape_failed|persist_failed): .*)$"`, which keeps the pre-observability forms. In the docstring (`:5-10`), name the new statuses: `success` and `partial` lines are not problems, while `empty`, `scrape_failed` (this includes a tripped breaker) and `persist_failed` are. Proof on a sample, with the shape checked by the plan writer on 2026-11-13:

```bash
mkdir -p .scratch && cat > .scratch/run-check-sample.log <<'EOF'
[STS/FullOffer] Found 20 fixtures for premier-league
[STS/FullOffer] No fixture snapshot for Manchester United vs Aston Villa after 2 attempts - skipping (previous snapshot kept)
[STS/FullOffer] No fixture snapshot for Leeds vs Tottenham after 2 attempts - skipping (previous snapshot kept)
[STS/FullOffer] No fixture snapshot for Fulham vs Newcastle after 2 attempts - skipping (previous snapshot kept)
[STS/FullOffer] Aborting per-fixture loop: 3 consecutive fixtures without a snapshot
[Aggregator/FullOffer] sts scrape_failed: 0 matches, 0 markets found, 0 saved - 3 of 20 details failed | no fixture snapshot https://www.sts.pl/kursy/manchester-united-aston-villa/f2921895
[Aggregator/FullOffer] sts success: 19 matches, 6146 markets found, 5130 saved
EOF
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py .scratch/run-check-sample.log 0; echo "exit=$?"
```

Expected: `RUN_CHECK {"completedRuns": 0, "pass": false, "runs": [], "problems": [{"line": 6, "stsFailed": "scrape_failed: 0 matches, 0 markets found, 0 saved - 3 of 20 details failed | no fixture snapshot https://www.sts.pl/kursy/manchester-united-aston-villa/f2921895"}]}` and `exit=1`. The unchanged script prints `"problems": []` for the same log.

- [ ] **Step 5: Run it and confirm it passes**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts && $HEAVY npx vitest run src/services/normalization/__tests__/golden.test.ts -t sts`
Expected: all PASS (snapshot-breaker 5, plus `capture`, `replay-2026-11`, `parse-*` unchanged); golden `failures=0`. Then `$HEAVY npx tsc --noEmit && $HEAVY npx vitest run`: exit 0, with the baseline count + 5.

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/bookmakers/sts/constants.ts src/scrapers/bookmakers/sts/index.ts src/scrapers/bookmakers/sts/__tests__/snapshot-breaker.test.ts docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py
git commit -m "fix(sts): stop the full-offer loop after 3 consecutive fixtures without a snapshot"
```

- [ ] **Step 7: Live check (read-only, optional before merge).** Run recovery Acceptance B from `$WT`: `$HEAVY --live node_modules/.bin/tsx $EVR/smoke-full-offer.mts sts premier-league <the 12 codes of sts.md Acceptance B> > .scratch/smoke-breaker.log 2>&1`. Expected: the sts.md Acceptance B criteria hold (`success: true`, `Found N` with `1 <= N <= 20`, `N - matches <= 1`), and `grep -c "Aborting per-fixture loop" .scratch/smoke-breaker.log` prints `0`. The merge into `recovery/integration` and Acceptance C on scheduled runs are **DEFERRED** (owner): after the merge and three scheduled runs, `python3 -I $EVR/sts-run-check.py "$LOG" "$S"` must print `"pass": true`.

### Task 1: One mapping for both transports; the browser class becomes `StsBrowserScraper`

**Files:**
- Create: `src/scrapers/bookmakers/sts/offer-mapping.ts`
- Modify: `src/scrapers/bookmakers/sts/index.ts`. Line numbers are integration's, before Task 0. Task 0 adds about 17 lines in and around the loop, so locate each hunk by its snippet.
  - `:41`: the class name.
  - `:305`: the Found line.
  - The per-fixture loop `:310-404`: replace the parse + youth/whitelist/same-club/push/log block `:328-394` with the mapping. Task 0's counters and breaker stay in the loop, and the no-snapshot warning uses `stsLog.noSnapshot`.
  - `:406-409`: the Completed line.
  - `:427-429`: the exports.
- Create: `src/scrapers/bookmakers/sts/__tests__/fixtures/ws-2026-11-07/` (Step 1 command), `__tests__/helpers/sts-frames.ts`, `__tests__/helpers/browser-replay.ts`
- Modify: `__tests__/capture.test.ts:19-21` and `__tests__/replay-2026-11.test.ts:16`: import `readStsFixture` (and `emptyCapture`) from `./helpers/sts-frames.js` instead of the local `fx`/`empty()`; no assertion changes.
- Test: `src/scrapers/bookmakers/sts/__tests__/browser-path-replay.test.ts`, `src/scrapers/bookmakers/sts/__tests__/offer-mapping.test.ts`

**Interfaces:**
- Consumes: `recordStsFrame(result: WSCaptureResult, payload: string): void` and `captureMatchWithRetry` (sts.md Task 1); `parseWebSocketJson` (`parser.ts:59`), `parseFixtures` (`parser.ts:163`, strict filter from sts.md Task 2), `parseAllMarkets` (`parser.ts:405`); `matchToCanonical` (`utils/team-matcher.ts`); `WSCaptureResult` (`types.ts:169`); `MAX_CONSECUTIVE_MATCH_FAILURES` (Task 0).
- Produces:
  ```ts
  // offer-mapping.ts
  export type StsOfferResult =
    | { kind: "offer"; offer: FullMatchOffer }
    | { kind: "skip"; warning: string | null };          // null = no markets (silent, as today)
  export function mapStsFixtureToOffer(fixture: STSFixture, fixtureJson: STSWebSocketData | null,
    initialJson: STSWebSocketData | null, leagueSlug: string): StsOfferResult;
  export const stsLog: {
    found(count: number, leagueSlug: string): string;
    matchMarkets(fixture: STSFixture, markets: number): string;
    completed(matches: number, markets: number): string;
    noSnapshot(fixture: STSFixture): string;
    youth(fixture: STSFixture): string;
    notWhitelisted(fixture: STSFixture, leagueSlug: string): string;
    sameClub(fixture: STSFixture, canonicalName: string): string;
  };
  // index.ts
  export class StsBrowserScraper extends PlaywrightScraper { /* unchanged behaviour, incl. Task 0's breaker */ }
  export { StsBrowserScraper as STSPlaywrightScraper, StsBrowserScraper as STSScraper };
  // __tests__/helpers/sts-frames.ts
  export const WS_IDS: readonly ["f2921896", "f2921905", "f2921906", "f2921911"];
  export interface StsReplayInput { ipl: string; byFixture: Record<string, readonly string[]> }
  export function readStsFixture(rel: string): string;        // capture.test.ts's `fx`, relative to __tests__/fixtures/
  export function emptyCapture(): WSCaptureResult;             // capture.test.ts's `empty()`
  export function wsIplFrame(): string;                        // ws-2026-11-07/i_pl.snapshot.txt
  export function wsSnapshotFrame(id: string): string;         // ws-2026-11-07/f_<id>_pl.snapshot.txt
  export function wsInput(): StsReplayInput;                   // fresh object: ipl + one snapshot per WS_IDS entry
  export function captureFrom(frames: readonly string[]): WSCaptureResult; // emptyCapture(), recordStsFrame in order
  export function captureLines<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }>; // console.log/warn/error in call order
  // __tests__/helpers/browser-replay.ts
  export type MockedNav = { navigateAndCaptureLeagueData: Mock; navigateAndCaptureMatchData: Mock };
  export function runBrowserPath(nav: MockedNav, input: StsReplayInput, league?: string /* "premier-league" */):
    Promise<{ value: FullOfferScraperResult; lines: string[] }>;
  // league capture = captureFrom([input.ipl]); match capture for ".../<id>" = captureFrom([input.ipl, ...(input.byFixture[id] ?? [])]);
  // spies PlaywrightScraper.prototype.executeFullOfferScrape → (league, _v, logic) => logic({} as Page, league)
  // (bypasses the browser and observability's page recorder) and .delay → resolves at once; runs new STSScraper()
  // (the alias exists before and after the rename).
  ```

- [ ] **Step 1: Copy the fixtures and write the tests**

The fixture command trims the 3 MB `i_pl` to the Premier League entries and the `P` groups of four fixtures; the snapshots are copied verbatim. It reads `$EVP` by absolute path:

```bash
D=src/scrapers/bookmakers/sts/__tests__/fixtures/ws-2026-11-07 && mkdir -p "$D" && $HEAVY python3 -I - "$EVP/data/ws-probe-ipl.json.frames.ndjson" "$D" <<'EOF'
import json, sys
src, out = sys.argv[1], sys.argv[2]
keep = ["f2921896", "f2921905", "f2921906", "f2921911"]
for f in (json.loads(l) for l in open(src, encoding="utf-8")):
    head, body = f.split("\n", 1)
    h = json.loads(head)
    if h["s"] == "i_pl" and h.get("f") == 1:
        b = json.loads(body)
        sport = b["B"]["S"]["1"]; cat = sport["C"]["1"]; t17 = cat["T"]["17"]
        t17["FX"] = {k: v for k, v in t17["FX"].items() if k in keep}
        cat["T"] = {"17": t17}; sport["C"] = {"1": cat}; b["B"]["S"] = {"1": sport}
        b["P"] = {k: v for k, v in b["P"].items() if v.get("f") in keep}
        b.pop("Y", None)
        open(f"{out}/i_pl.snapshot.txt", "w", encoding="utf-8").write(head + "\n" + json.dumps(b, ensure_ascii=False, separators=(",", ":")))
    elif h["s"] == "i_pl":
        open(f"{out}/i_pl.delta.txt", "w", encoding="utf-8").write(f)
    elif h.get("f") == 1 and h["s"][2:-3] in keep:
        open(f"{out}/{h['s']}.snapshot.txt", "w", encoding="utf-8").write(f)
EOF
ls -l "$D" | awk 'NR>1 {print $5, $9}'
```

Expected (proven on a scratch copy; the source file has not changed since): `208635 f_f2921896_pl.snapshot.txt`, `45033 f_f2921905_pl.snapshot.txt`, `45390 f_f2921906_pl.snapshot.txt`, `45223 f_f2921911_pl.snapshot.txt`, `1151 i_pl.delta.txt`, `40749 i_pl.snapshot.txt`. The recovery fixtures from sts.md Task 1 (`i_pl.trimmed.txt`, the Leeds snapshot and delta, the Arsenal–Hull snapshot) stay where Task 1 put them and are reused, not copied.

`browser-path-replay.test.ts` is a characterization test: it must pass **before** the refactor. The file declares the navigation mock that `runBrowserPath` drives. Every later file that uses `runBrowserPath` repeats these lines:

```ts
vi.mock("../navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../navigation.js")>()),
  navigateAndCaptureLeagueData: vi.fn(), navigateAndCaptureMatchData: vi.fn(),
}));
import * as nav from "../navigation.js";

it("browser path over the 2026-11-07 frames: four offers in listing order", async () => {
  const { value: r, lines } = await runBrowserPath(nav as unknown as MockedNav, wsInput());
  expect(r.success).toBe(true);
  expect("error" in r).toBe(false);
  expect(r.matches.map((m) => [m.matchId, m.homeTeam, m.awayTeam, m.eventUrl, m.startTime])).toEqual([
    ["f2921896", "Leeds United", "Tottenham Hotspur", "https://www.sts.pl/kursy/leeds-tottenham/f2921896", "2026-11-07T12:30:00Z"],
    ["f2921905", "Newcastle United", "Arsenal", "https://www.sts.pl/kursy/newcastle-arsenal/f2921905", "2026-11-21T17:30:00Z"],
    ["f2921906", "Chelsea", "Leeds United", "https://www.sts.pl/kursy/chelsea-leeds/f2921906", "2026-11-21T15:00:00Z"],
    ["f2921911", "AFC Bournemouth", "Nottingham Forest", "https://www.sts.pl/kursy/bournemouth-nottingham/f2921911", "2026-11-21T15:00:00Z"],
  ]);
  const ipl = parseWebSocketJson(wsIplFrame())!;
  for (const m of r.matches) {
    const fixture = parseFixtures(ipl, "premier-league").find((f) => f.id === m.matchId)!;
    expect(m.markets).toEqual(parseAllMarkets(fixture, parseWebSocketJson(wsSnapshotFrame(m.matchId)), ipl));
  }
  expect(r.matches[0].markets.length).toBeGreaterThan(400);          // 527 on the future base (453 on 377b47e)
  expect(lines).toContain("[STS/FullOffer] Found 4 fixtures for premier-league");
  expect(lines.filter((l) => l.startsWith("[STS/FullOffer]")).at(-1)).toMatch(/^\[STS\/FullOffer\] Completed: 4 matches, \d+ total markets$/);
});
it("browser path skips a fixture whose captures have no snapshot and names it in error (Task 0)", async () => {
  const input = wsInput(); input.byFixture.f2921906 = [];
  const { value: r, lines } = await runBrowserPath(nav as unknown as MockedNav, input);
  expect(r.matches.map((m) => m.matchId)).toEqual(["f2921896", "f2921905", "f2921911"]);
  expect(r.error).toBe("1 of 4 details failed | no fixture snapshot https://www.sts.pl/kursy/chelsea-leeds/f2921906");
  expect(lines).toContain("[STS/FullOffer] No fixture snapshot for Chelsea vs Leeds after 2 attempts - skipping (previous snapshot kept)");
});
```

`offer-mapping.test.ts` uses `fx(id)` = the `parseFixtures(ipl, "premier-league")` entry, `snap(id)` = `parseWebSocketJson(wsSnapshotFrame(id))` and `ipl` = `parseWebSocketJson(wsIplFrame())!`. The `sts-run-check.py` regexes are those at `:27` (Found), `:32` (Completed), `:34` (no snapshot), `:36` (skips) and `:38` (markets):

| test | input | expected |
|---|---|---|
| `maps Leeds vs Tottenham to one offer` | `mapStsFixtureToOffer(fx("f2921896"), snap("f2921896"), ipl, "premier-league")` | `kind: "offer"`; `offer` toMatchObject `{ matchId: "f2921896", bookmaker: "sts", homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", eventUrl: "https://www.sts.pl/kursy/leeds-tottenham/f2921896", startTime: "2026-11-07T12:30:00Z" }`; `offer.markets` toEqual `parseAllMarkets(fx, snap, ipl)`; `scrapedAt` instanceof `Date` |
| `skips a youth fixture` | `{ ...fx("f2921896"), home: "Leeds U21" }` | `{ kind: "skip", warning: "[STS/FullOffer] Skipping Leeds U21 vs Tottenham: Youth team match" }` |
| `skips a team outside the league whitelist` | `home: "Avro FC"` | `warning: "[STS/FullOffer] Skipping Avro FC vs Tottenham: Teams not in premier-league whitelist"` |
| `drops two raw names that canonicalize to one club` | `home: "Leeds", away: "Leeds United"` | `warning: '[STS/FullOffer] Dropping "Leeds" vs "Leeds United": both canonicalize to Leeds United'` |
| `silent skip when no payload has the fixture's markets` | `(fx("f2921896"), null, null, …)` | `{ kind: "skip", warning: null }` |
| `stsLog lines match the sts-run-check.py patterns` | the five regexes as JS `RegExp` | `found(4, "premier-league")` matches `:27`; `matchMarkets(fx("f2921896"), 527)` is `"[STS/FullOffer] Leeds vs Tottenham: 527 markets"`, and `:38` captures `"Leeds vs Tottenham"`; `completed(4, 988)` is `"[STS/FullOffer] Completed: 4 matches, 988 total markets"` and matches `:32`; `noSnapshot(fx("f2921896"))` is `"[STS/FullOffer] No fixture snapshot for Leeds vs Tottenham after 2 attempts - skipping (previous snapshot kept)"` and matches `:34`; `youth`/`notWhitelisted` match `:36` |

- [ ] **Step 2: Run them**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts/__tests__/browser-path-replay.test.ts src/scrapers/bookmakers/sts/__tests__/offer-mapping.test.ts`
Expected: `browser-path-replay` PASSES (2 tests describing today's behaviour, Task 0 included). `offer-mapping` FAILS to load (`Failed to resolve import "../offer-mapping.js"`).

- [ ] **Step 3: Implement `mapStsFixtureToOffer` and `stsLog` in `offer-mapping.ts`; rewire `index.ts`**

Move the body of `index.ts:328-394` into `mapStsFixtureToOffer`, keeping the same order and texts: parse `:328-330`, the youth check `:335-349`, the whitelist `:351-359`, same-club `:370-376` and the offer object `:381-390`. The per-fixture loop becomes:
- `if (!capture) {` + `console.warn(stsLog.noSnapshot(fixture))` + Task 0's miss accounting and breaker, unchanged `}`;
- `consecutiveMisses = 0`;
- `const r = mapStsFixtureToOffer(fixture, capture.fixtureData.get(fixture.id) ?? null, parseWebSocketJson(capture.initialData), leagueSlug)`;
- a skip with a warning logs it and `continue`s (as today's `continue`s); a silent skip falls through to `delay(200)`; an offer is pushed and logged with `stsLog.matchMarkets`.

`:305` and `:406-409` use `stsLog.found` / `stsLog.completed`. Rename the class to `StsBrowserScraper` and keep both old names as aliases. There is no other behaviour change: the sleeps, the per-match re-parse, `delay(200)`, the breaker and the `catch` all stay. Move `capture.test.ts`'s `fx`/`empty()` and `replay-2026-11.test.ts`'s `fx` into `sts-frames.ts` as `readStsFixture`/`emptyCapture`, and import them in both files.

- [ ] **Step 4: Run them**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts && $HEAVY npx vitest run src/services/normalization/__tests__/golden.test.ts -t sts && $HEAVY npx tsc --noEmit`
Expected: all PASS (the characterization tests unchanged and green, `snapshot-breaker` green), golden `failures=0`, `tsc` exit 0.

- [ ] **Step 5: Commit**

```bash
$HEAVY npx vitest run
git add src/scrapers/bookmakers/sts/offer-mapping.ts src/scrapers/bookmakers/sts/index.ts src/scrapers/bookmakers/sts/__tests__/fixtures/ws-2026-11-07 src/scrapers/bookmakers/sts/__tests__/helpers/sts-frames.ts src/scrapers/bookmakers/sts/__tests__/helpers/browser-replay.ts src/scrapers/bookmakers/sts/__tests__/browser-path-replay.test.ts src/scrapers/bookmakers/sts/__tests__/offer-mapping.test.ts src/scrapers/bookmakers/sts/__tests__/capture.test.ts src/scrapers/bookmakers/sts/__tests__/replay-2026-11.test.ts
git commit -m "refactor(sts): extract the fixture-to-offer mapping; rename browser class to StsBrowserScraper"
```

### Task 2: WebSocket protocol helpers

**Files:**
- Create: `src/scrapers/bookmakers/sts/ws-protocol.ts` (kept out of `constants.ts`, which the recovery tasks edit)
- Test: `src/scrapers/bookmakers/sts/__tests__/ws-protocol.test.ts`

**Interfaces:**
- Consumes: `recordStsFrame`, `hasFixtureSnapshot`, `isSnapshotFrame` (sts.md Task 1); `MAX_SKIPPED_DETAIL_RATIO` (§3 `shared/detail-fetch.ts`); `DEFAULT_USER_AGENT` (plan 02 `shared/http/http-client.ts`); `WSCaptureResult`.
- Produces:
  ```ts
  export const STS_WS_URL = "wss://www.sts.pl/sbk/api/sbk";
  export const STS_WS_HEADERS: Readonly<Record<string, string>>;
  //   { origin: "https://www.sts.pl", "user-agent": DEFAULT_USER_AGENT, "accept-language": "pl-PL,pl;q=0.9" }
  export const STS_WS_CONNECT_TIMEOUT_MS = 10_000;
  export const STS_IPL_TIMEOUT_MS = 10_000;
  export const STS_SNAPSHOT_TIMEOUT_MS = 5_000;
  export const STS_SNAPSHOT_MISS_LIMIT = 3;
  export const STS_SYNC_MESSAGE = '{"t":4}';
  export const STS_FALLBACK_HINT = "set SCRAPER_TRANSPORT_STS=browser to use the browser path";
  export interface StsTopicRequest { topic: string; snapshot: boolean }
  export function fixtureTopic(fixtureId: string): string;                       // "f_<id>_pl"
  export function buildStsSubscription(requests: readonly StsTopicRequest[]): string;
  export function emptyStsCapture(): WSCaptureResult;
  export function reduceStsFrame(state: WSCaptureResult, frame: Buffer, isBinary: boolean): WSCaptureResult;
  export function hasIplSnapshot(state: WSCaptureResult): boolean;
  export function missingSnapshots(state: WSCaptureResult, fixtureIds: readonly string[]): string[];
  export function shouldTripStsBreaker(missing: number, requested: number): boolean;
  export type StsWsFailureKind = "blocked" | "transient" | "protocol";
  export function classifyStsWsFailure(message: string): StsWsFailureKind;
  ```

- [ ] **Step 1: Write the failing tests**

| test | call | expected |
|---|---|---|
| `endpoint constants` | `STS_WS_URL`, `STS_WS_HEADERS`, the four numbers | the exact values above; `STS_WS_HEADERS` toEqual the three-header object, and its `"user-agent"` `toBe(DEFAULT_USER_AGENT)` |
| `listing request is the browser's first frame` | `buildStsSubscription([{ topic: "i_pl", snapshot: true }])` | `'{"t":1,"u":[{"s":"i_pl","n":0}]}'` |
| `snapshot requests carry n:0, kept topics none, order kept` | `[{ topic: "i_pl", snapshot: false }, { topic: fixtureTopic("f2921896"), snapshot: true }, { topic: fixtureTopic("f2921905"), snapshot: false }]` | `'{"t":1,"u":[{"s":"i_pl"},{"s":"f_f2921896_pl","n":0},{"s":"f_f2921905_pl"}]}'` |
| `sync message` | `STS_SYNC_MESSAGE` | `'{"t":4}'` |
| `reduceStsFrame ignores binary frames and returns the same state` | `Buffer.from(wsSnapshotFrame("f2921905"))` with `isBinary` true, then false | `hasFixtureSnapshot(s, "f2921905")` false, then true; the return value `toBe(s)` |
| `reduceStsFrame ignores control frames` | `Buffer.from('{"t":5}')` | the state toEqual `emptyStsCapture()` |
| `hasIplSnapshot` | empty → after `readStsFixture("ws-2026-11-07/i_pl.delta.txt")` → after `wsIplFrame()` | false → false → true |
| `missingSnapshots keeps listing order` | a state with the f2921905 snapshot, `WS_IDS` | `["f2921896", "f2921906", "f2921911"]` |
| `shouldTripStsBreaker` (`it.each`) | `(0,20) (2,20) (3,20) (1,2) (2,3) (1,1)` | `false false true false true true` |
| `classifyStsWsFailure` (`it.each`, url = `wss://www.sts.pl/sbk/api/sbk`) | `ws handshake HTTP 403 <url>`, `… 503 …`, `… 429 …`, `ws closed 1008 <url>` | `blocked` ×4 |
| | `no i_pl snapshot \| ws timeout 10000ms <url>`, `3 of 4 details failed \| ws timeout 5000ms <url>` | `protocol` ×2 |
| | `ws handshake HTTP 502 <url>`, `ws closed 1006 <url>`, `ws timeout 10000ms <url>`, `ws failed ECONNRESET <url>`, `scrape budget of 120000ms exceeded`, `Unknown league: bundesliga`, `No fixtures found for league` | `transient` ×7 |

- [ ] **Step 2: Run it and confirm it fails**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts/__tests__/ws-protocol.test.ts`
Expected: FAIL to load (`Failed to resolve import "../ws-protocol.js"`).

- [ ] **Step 3: Implement `ws-protocol.ts`**
- `reduceStsFrame` = `recordStsFrame(state, frame.toString("utf8"))` for text frames, nothing for binary.
- `hasIplSnapshot` = `state.initialData !== "" && isSnapshotFrame(state.initialData)`.
- `shouldTripStsBreaker` = `missing >= STS_SNAPSHOT_MISS_LIMIT || (requested > 0 && missing / requested > MAX_SKIPPED_DETAIL_RATIO)`.
- Classification:
  - `^ws handshake HTTP (403|429|503) ` or `^ws closed 1008 ` → blocked;
  - containing ` | ws timeout ` → protocol;
  - everything else → transient. That includes plan 02's `ws failed <code> <url>`, `BudgetExceededError` texts and the empty strict listing, which is not a transport fault (Task 5 table).

- [ ] **Step 4: Run it and confirm it passes**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts/__tests__/ws-protocol.test.ts && $HEAVY npx tsc --noEmit`
Expected: PASS; `tsc` exit 0.

- [ ] **Step 5: Commit**

```bash
$HEAVY npx vitest run
git add src/scrapers/bookmakers/sts/ws-protocol.ts src/scrapers/bookmakers/sts/__tests__/ws-protocol.test.ts
git commit -m "feat(sts): websocket subscription framing, frame reducer adapter and breaker"
```

### Task 3: `StsWsScraper`, one session per league call

**Files:**
- Create: `src/scrapers/bookmakers/sts/ws-scraper.ts`
- Create: `src/scrapers/bookmakers/sts/__tests__/helpers/fake-sts-server.ts`
- Test: `src/scrapers/bookmakers/sts/__tests__/ws-scraper.test.ts`

**Interfaces:**
- Consumes:
  - §3 / plan 02:
    - `openWsSession(opts: WsSessionOptions): Promise<WsSession>`. Task 8 semantics: frames arriving outside a `collect` are buffered and replayed into the next one; one `collect` runs at a time; a close gives `ws closed <code> <url>`; a pre-handshake error gives `ws failed <code> <url>`.
    - `WsSession.collect/send/close/stats`, `ScrapeBudget`, `createScrapeBudget`, `DEFAULT_MAX_DURATION_MS`, `FullOfferScraper`.
    - `TransportStats`, `TransportStatsSource`, `hasTransportStats` (plan 02 Task 5); `DeclaresTransport` (plan 07, a duck type: only the property is required).
  - Task 1: `mapStsFixtureToOffer`, `stsLog`. Task 2: everything it produces.
  - `parseWebSocketJson`, `parseFixtures`; `isLeagueSupported` (`config/leagues.ts:178`).
- Produces:
  ```ts
  // ws-scraper.ts
  export interface StsWsScraperDeps { openSession?: (opts: WsSessionOptions) => Promise<WsSession> } // default openWsSession
  export class StsWsScraper implements FullOfferScraper, TransportStatsSource {
    readonly bookmaker: PolishBookmaker;                        // "sts"
    readonly transport = "websocket" as const;                  // plan 07 DeclaresTransport (cross-plan #19)
    constructor(deps?: StsWsScraperDeps);
    scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult>;
    transportStats(): TransportStats;   // { ws: copy of this.totalStats }: cumulative and monotonic since construction (README §3); zeros before the first session
    cleanup(): Promise<void>;                                   // no-op
  }
  // __tests__/helpers/fake-sts-server.ts
  export interface FakeStsServerOptions {
    ipl: readonly string[];                                     // frames answering an i_pl n:0 request, in order
    fixtures: Readonly<Record<string, readonly string[]>>;      // frames answering f_<id>_pl n:0, by fixture id
    silentFirst?: readonly string[];                            // ids not answered on their first n:0 request
    silentAlways?: readonly string[];                           // ids never answered
    openError?: Error;                                          // open() rejects with it
    closeOnFixtureRequest?: Error;                              // the collect active at the first fixture request rejects with it
  }
  export interface FakeStsServer {
    open(opts: WsSessionOptions): Promise<WsSession>;
    opened: WsSessionOptions[]; sent: string[]; collectTimeouts: number[]; closeCalls: number;
  }
  export function createFakeStsServer(opts: FakeStsServerOptions): FakeStsServer;
  export function runWsPath(input: StsReplayInput, extra?: Partial<FakeStsServerOptions>, budget?: ScrapeBudget, league?: string):
    Promise<{ value: FullOfferScraperResult; lines: string[]; server: FakeStsServer; scraper: StsWsScraper }>;
  ```
  The fake's semantics mirror plan 02 Task 8:
  - `send()` answers each `u` entry that has `n: 0` by queueing that topic's frames in order. `silentFirst`/`silentAlways` withhold them.
  - The queue is delivered on the next macrotask (`setImmediate`) to the active `collect`. Frames that arrive with no active `collect` stay queued and are replayed first by the next one.
  - `collect` resolves `{ timedOut: false }` as soon as `done(state)` holds after a frame; frames left over stay queued. It resolves `{ timedOut: true }` when a delivery turn ends with nothing queued and `done` false. There is no real waiting.
  - `stats` counts delivered frames and UTF-8 bytes, per session.

  `runWsPath` builds the server from `input` (`ipl: [input.ipl]`, `fixtures: input.byFixture`) plus `extra`. It then runs `scraper = new StsWsScraper({ openSession: server.open })` and `scraper.scrapeFullOffer(league ?? "premier-league", budget)` inside `captureLines`.

- [ ] **Step 1: Write the failing tests**

Shared: `URL = "wss://www.sts.pl/sbk/api/sbk"`; `DELTA = readStsFixture("f_f2921896_pl.leeds-tottenham.delta.txt")` (an sts.md Task 1 fixture); `ALL = '{"t":1,"u":[{"s":"i_pl"},{"s":"f_f2921896_pl","n":0},{"s":"f_f2921905_pl","n":0},{"s":"f_f2921906_pl","n":0},{"s":"f_f2921911_pl","n":0}]}'`; ``MISS = (n: number) => `${n} of 4 details failed | ws timeout 5000ms ${URL}` ``.

```ts
it("one session: i_pl, then all four fixture snapshots in one message", async () => {
  const { value: r, lines, server, scraper } = await runWsPath(wsInput());
  expect(r).toMatchObject({ success: true, bookmaker: "sts", league: "premier-league" });
  expect("error" in r).toBe(false);
  expect(r.matches.map((m) => m.matchId)).toEqual([...WS_IDS]);
  expect(server.opened).toEqual([{ url: URL, headers: STS_WS_HEADERS, connectTimeoutMs: 10000, budget: expect.anything() }]);
  expect(server.sent).toEqual(['{"t":1,"u":[{"s":"i_pl","n":0}]}', '{"t":4}', ALL]);
  expect(server.collectTimeouts).toEqual([10000, 5000]);
  expect(server.closeCalls).toBe(1);
  expect(lines).toContain("[STS/FullOffer] Found 4 fixtures for premier-league");
  expect(lines.some((l) => /^\[STS\/WS\] Done in \d+ms: \d+ frames, \d+ bytes, 0 re-sent$/.test(l))).toBe(true);
  expect(scraper.transport).toBe("websocket");
  expect(hasTransportStats(scraper)).toBe(true);
  expect(scraper.transportStats()).toEqual({ ws: { framesReceived: 5, bytesReceived: expect.any(Number) } }); // i_pl + 4 snapshots
});
it("re-sends once, with n:0 only for the missing fixture", async () => {
  const { value: r, lines, server } = await runWsPath(wsInput(), { silentFirst: ["f2921906"] });
  expect(server.sent[3]).toBe('{"t":1,"u":[{"s":"i_pl"},{"s":"f_f2921896_pl"},{"s":"f_f2921905_pl"},{"s":"f_f2921906_pl","n":0},{"s":"f_f2921911_pl"}]}');
  expect(server.sent).toHaveLength(4);
  expect(server.collectTimeouts).toEqual([10000, 5000, 5000]);
  expect(r.matches).toHaveLength(4);
  expect("error" in r).toBe(false);
  expect(lines.some((l) => / 1 re-sent$/.test(l))).toBe(true);
});
it("transportStats() is cumulative across calls on one instance", async () => {
  const server = createFakeStsServer({ ipl: [wsIplFrame()], fixtures: wsInput().byFixture });
  const s = new StsWsScraper({ openSession: server.open });
  await s.scrapeFullOffer("premier-league"); const first = s.transportStats().ws!;
  await s.scrapeFullOffer("premier-league");
  expect(s.transportStats().ws).toEqual({ framesReceived: 10, bytesReceived: 2 * first.bytesReceived });
  expect(server.opened).toHaveLength(2);
});
```

| test | `runWsPath` arguments | expected |
|---|---|---|
| `a fixture delta before its snapshot does not complete the fixture` | `byFixture.f2921896 = [DELTA, wsSnapshotFrame("f2921896")]` | 4 offers; f2921896 `markets.length > 400`; `sent.length` 3 |
| `an i_pl delta before the i_pl snapshot does not end the listing wait` | `ipl` frames `[i_pl.delta.txt, wsIplFrame()]` (via `extra.ipl`) | `Found 4 fixtures` line; 4 offers |
| `skips a fixture whose snapshot never comes` | `{ silentAlways: ["f2921906"] }` | `success: true`, `error: MISS(1)`; ids `["f2921896","f2921905","f2921911"]`; the lines contain `"[STS/FullOffer] No fixture snapshot for Chelsea vs Leeds after 2 attempts - skipping (previous snapshot kept)"` and `"…Completed: 3 matches, …"` |
| `a delta-only fixture is skipped like a missing one` | `byFixture.f2921896 = [DELTA]` | 3 offers; `error: MISS(1)`; the no-snapshot line for `Leeds vs Tottenham`; `sent[3]` asks `f_f2921896_pl` with `n:0` |
| `trips the breaker when 3 of 4 snapshots never come` | `{ silentAlways: ["f2921905","f2921906","f2921911"] }` | `{ success: false, matches: [], error: MISS(3) }`; no `Completed:` line; line `"[STS/WS] protocol - set SCRAPER_TRANSPORT_STS=browser to use the browser path"`; `closeCalls` 1 |
| `2 of 4 missing does not trip the breaker` | `{ silentAlways: ["f2921905","f2921911"] }` | `success: true`, 2 offers, `error: MISS(2)` |
| `handshake 403: session message, fallback hint, nothing sent` | `{ openError: new Error("ws handshake HTTP 403 wss://www.sts.pl/sbk/api/sbk") }` | `success: false`, `error` that message, `matches: []`; the lines contain `"[sts] Full offer scraper error: ws handshake HTTP 403 wss://www.sts.pl/sbk/api/sbk"` and `"[STS/WS] blocked - set SCRAPER_TRANSPORT_STS=browser to use the browser path"`; `sent` `[]`; `closeCalls` 0 |
| `connect timeout is transient: no fallback hint` | `{ openError: new Error("ws timeout 10000ms wss://www.sts.pl/sbk/api/sbk") }`, then again with `"ws failed ECONNRESET wss://www.sts.pl/sbk/api/sbk"` | `error` that message; no line starts with `[STS/WS]`; `scraper.transportStats()` toEqual `{ ws: { framesReceived: 0, bytesReceived: 0 } }` |
| `i_pl never arrives` | `{ ipl: [] }` | `error: "no i_pl snapshot \| ws timeout 10000ms wss://www.sts.pl/sbk/api/sbk"`; `sent.length` 2; `closeCalls` 1 |
| `socket closes while snapshots stream` | `{ closeOnFixtureRequest: new Error("ws closed 1006 wss://www.sts.pl/sbk/api/sbk") }` | `success: false`, that `error`, `matches: []`, `closeCalls` 1 |
| `unknown league: no session` | league `"bundesliga"` | `{ success: false, error: "Unknown league: bundesliga" }`; `opened` `[]` |
| `caps every collect timeout by the budget` | `{ silentFirst: ["f2921906"] }`, `createScrapeBudget(1500)` | `collectTimeouts` length 3, each `> 0` and `<= 1500`; `opened[0].budget` is that budget |
| `an aborted budget opens no session` | `createScrapeBudget(60_000, AbortSignal.abort())` | `success: false`, `error` matches `/^scrape aborted: /` (plan 02 Task 1 wording); `opened` `[]` |
| `parses the i_pl snapshot once per run` (STS-2) | file-level `vi.mock("../parser.js", …)` wrapping `parseWebSocketJson` in `vi.fn(original)` | calls whose argument starts with `{"s":"i_pl"` = 1 |

- [ ] **Step 2: Run it and confirm it fails**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts/__tests__/ws-scraper.test.ts`
Expected: FAIL to load (`Failed to resolve import "../ws-scraper.js"`).

- [ ] **Step 3: Implement `StsWsScraper.scrapeFullOffer(league, budget?)` in `ws-scraper.ts`**

The order of waits, the message shapes and the failure texts are the contract:

```ts
const start = Date.now();
if (!isLeagueSupported(league, "sts")) return fail(`Unknown league: ${league}`);
budget ??= createScrapeBudget(DEFAULT_MAX_DURATION_MS.websocket);
// transportStats() copies this.totalStats, which is CUMULATIVE since construction (README §3: monotonic; plan 07 diffs
// around each unit). In `finally`, add the session's stats to this.totalStats (initialised to zeros in the constructor).
let session: WsSession | undefined;
try {
  budget.checkpoint();
  session = await open({ url: STS_WS_URL, headers: { ...STS_WS_HEADERS }, budget, connectTimeoutMs: STS_WS_CONNECT_TIMEOUT_MS });
  const state = emptyStsCapture();
  const cap = (ms: number) => Math.min(ms, budget.remainingMs());
  let wait = cap(STS_IPL_TIMEOUT_MS);
  let pending = session.collect(state, reduceStsFrame, hasIplSnapshot, wait);      // collect, then send (plan 02 buffers either way)
  session.send(buildStsSubscription([{ topic: "i_pl", snapshot: true }])); session.send(STS_SYNC_MESSAGE);
  if ((await pending).timedOut) return fail(`no i_pl snapshot | ws timeout ${wait}ms ${STS_WS_URL}`);
  const ipl = parseWebSocketJson(state.initialData);                              // the run's only i_pl parse
  if (!ipl) return fail("Failed to parse WebSocket data");                         // index.ts:288 wording
  const fixtures = parseFixtures(ipl, league);                                     // logs the strict-id miss warning itself
  if (fixtures.length === 0) return fail("No fixtures found for league");          // index.ts:300 wording
  console.log(stsLog.found(fixtures.length, league));
  const ids = fixtures.map((f) => f.id);
  let missing = ids, resent = 0;
  for (let round = 0; round < 2 && missing.length > 0; round++) {                 // first request + one re-send
    budget.checkpoint();
    const ask = new Set(missing); wait = cap(STS_SNAPSHOT_TIMEOUT_MS);
    pending = session.collect(state, reduceStsFrame, (s) => missingSnapshots(s, ids).length === 0, wait);
    session.send(buildStsSubscription([{ topic: "i_pl", snapshot: false }, ...ids.map((id) => ({ topic: fixtureTopic(id), snapshot: ask.has(id) }))]));
    await pending;
    if (round === 1) resent = ask.size;
    missing = missingSnapshots(state, ids);
  }
  for (const f of fixtures) if (missing.includes(f.id)) console.warn(stsLog.noSnapshot(f));
  const missCause = `${missing.length} of ${ids.length} details failed | ws timeout ${wait}ms ${STS_WS_URL}`;
  if (shouldTripStsBreaker(missing.length, ids.length)) return fail(missCause);
  // map every fixture that has a snapshot, in listing order: mapStsFixtureToOffer(f, state.fixtureData.get(f.id)!, ipl, league);
  // skip → warn its warning when non-null; offer → push + stsLog.matchMarkets; then stsLog.completed and
  // `[STS/WS] Done in ${ms}ms: ${session.stats.framesReceived} frames, ${session.stats.bytesReceived} bytes, ${resent} re-sent`
  return { success: true, bookmaker: "sts", league, matches, ...(missing.length > 0 ? { error: missCause } : {}), duration: Date.now() - start };
} catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
finally { if (session) { this.totalStats.framesReceived += session.stats.framesReceived; this.totalStats.bytesReceived += session.stats.bytesReceived; await session.close(); } }
// fail(error): console.error(`[sts] Full offer scraper error: ${error}`) (observability playwright-base.ts:302 wording);
//   kind = classifyStsWsFailure(error); kind !== "transient" → console.error(`[STS/WS] ${kind} - ${STS_FALLBACK_HINT}`);
//   returns { success: false, bookmaker: "sts", league, matches: [], error, duration: Date.now() - start }
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts && $HEAVY npx tsc --noEmit`
Expected: PASS (all STS test files); `tsc` exit 0.

- [ ] **Step 5: Commit**

```bash
$HEAVY npx vitest run
git add src/scrapers/bookmakers/sts/ws-scraper.ts src/scrapers/bookmakers/sts/__tests__/helpers/fake-sts-server.ts src/scrapers/bookmakers/sts/__tests__/ws-scraper.test.ts
git commit -m "feat(sts): browserless full-offer scraper over one websocket session"
```

### Task 4: Parity contract between the two transports (README §6 gate 1)

**Files:**
- Modify: `src/scrapers/bookmakers/sts/__tests__/helpers/sts-frames.ts` (add `restrictIplFrame`)
- Test: `src/scrapers/bookmakers/sts/__tests__/transport-parity.test.ts`

**Interfaces:**
- Consumes: `runBrowserPath`, `MockedNav`, `wsInput`, `readStsFixture`, `wsSnapshotFrame` (Task 1); `runWsPath` (Task 3); `parseWebSocketJson`, `parseFixtures`, `parseAllMarkets`.
- Produces: `export function restrictIplFrame(frame: string, ids: readonly string[]): string`. It keeps the same header line. In the body, `B.S["1"].C` is reduced to category `"1"`, its `T` to `"17"` and `FX` to `ids`; `P` is unchanged.

- [ ] **Step 1: Write the test** (same `vi.mock("../navigation.js", …)` block as Task 1)

```ts
const NOV6 = (): StsReplayInput => ({                       // browser-captured 2026-11-06 frames, snapshot then delta
  ipl: restrictIplFrame(readStsFixture("i_pl.trimmed.txt"), ["f2921896", "f2921898"]),
  byFixture: {
    f2921896: [readStsFixture("f_f2921896_pl.leeds-tottenham.snapshot.txt"), readStsFixture("f_f2921896_pl.leeds-tottenham.delta.txt")],
    f2921898: [readStsFixture("f_f2921898_pl.arsenal-hull.snapshot.txt")],
  },
});
const comparable = (r: FullOfferScraperResult) => r.matches.map(({ scrapedAt: _s, ...m }) => m);
const fullOffer = (lines: string[]) => lines.filter((l) => l.startsWith("[STS/FullOffer]"));

it.each([{ name: "WS capture 2026-11-07, 4 fixtures", input: wsInput }, { name: "browser capture 2026-11-06", input: NOV6 }])(
  "$name: both transports produce deep-equal offers and the same [STS/FullOffer] lines", async ({ input }) => {
    const b = await runBrowserPath(nav as unknown as MockedNav, input());
    const w = await runWsPath(input());
    expect([b.value.success, w.value.success]).toEqual([true, true]);
    expect([b.value.error, w.value.error]).toEqual([undefined, undefined]);
    expect(w.value.matches).toHaveLength(Object.keys(input().byFixture).length);
    expect(comparable(w.value)).toEqual(comparable(b.value));
    expect(fullOffer(w.lines)).toEqual(fullOffer(b.lines));
  });
it("recovery replay inputs: WS-path markets are exactly what replay-2026-11.test.ts normalizes", async () => {
  const { value } = await runWsPath(NOV6());
  const ipl = parseWebSocketJson(readStsFixture("i_pl.trimmed.txt"))!;
  for (const [id, file] of [["f2921898", "f_f2921898_pl.arsenal-hull.snapshot.txt"], ["f2921896", "f_f2921896_pl.leeds-tottenham.snapshot.txt"]] as const) {
    const fixture = parseFixtures(ipl, "premier-league").find((f) => f.id === id)!;     // replay-2026-11.test.ts call shape
    expect(value.matches.find((m) => m.matchId === id)!.markets).toEqual(parseAllMarkets(fixture, parseWebSocketJson(readStsFixture(file)), ipl));
  }
});
it("negative control: a different snapshot for the same fixture is detected", async () => {
  const other = NOV6(); other.byFixture.f2921896 = [wsSnapshotFrame("f2921896")];
  const b = await runBrowserPath(nav as unknown as MockedNav, NOV6());
  const w = await runWsPath(other);
  expect(comparable(w.value)).not.toEqual(comparable(b.value));
});
```

- [ ] **Step 2: Prove the gate bites, then restore**

Temporarily change the mapping loop in `ws-scraper.ts` to iterate `[...fixtures].reverse()` and run `$HEAVY npx vitest run src/scrapers/bookmakers/sts/__tests__/transport-parity.test.ts`. Then `git checkout -- src/scrapers/bookmakers/sts/ws-scraper.ts`.
Expected while mutated: FAIL in both `it.each` cases (an array-order diff on `matchId`, and in the `[STS/FullOffer]` line order). After the restore, `git status --short` shows only the two Task 4 files.

- [ ] **Step 3: Run the gate**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts/__tests__/transport-parity.test.ts src/scrapers/bookmakers/sts/__tests__/replay-2026-11.test.ts`
Expected: PASS (transport-parity 4 tests). The recovery replay gate passes unchanged (2 cases). Its thresholds now cover the WS path through the "recovery replay inputs" test above.

- [ ] **Step 4: Full suite** — `$HEAVY npx tsc --noEmit && $HEAVY npx vitest run` → exit 0, all green.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/sts/__tests__/helpers/sts-frames.ts src/scrapers/bookmakers/sts/__tests__/transport-parity.test.ts
git commit -m "test(sts): browser and websocket transports produce identical offers on recorded frames"
```

### Task 5: Transport selection, exports and operator signals

**Files:**
- Modify: `src/scrapers/bookmakers/sts/index.ts:427-429` (integration numbering: the exports): `createStsScraper`, `stsScraper`, re-export `StsWsScraper`.
- Modify: `src/scrapers/bookmakers/index.ts:16` → `export { stsScraper, StsBrowserScraper, StsWsScraper, STSScraper, STSPlaywrightScraper } from "./sts/index.js";`
- Modify: `src/scrapers/bookmakers/sts/README.md`: add a new `## Transport` section after `## Architecture` (`:6`), and update `### Core Scraper (index.ts)` (`:9-10`, which still names `STSPlaywrightScraper` and the events cache). `.env.example` is not touched: plan 02 Task 7 already documents `# SCRAPER_TRANSPORT_STS=browser`.
- Modify only if `$HEAVY npx tsc --noEmit` reports it: `src/scripts/analyze-bookmaker-markets.ts:41` → `Record<PolishBookmaker, FullOfferScraper>`, with its import at `:36`. The script only calls `scrapeFullOffer` (`:122`) and `cleanup` (`:246`).
- Test: `src/scrapers/bookmakers/sts/__tests__/transport-select.test.ts`

**Interfaces:**
- Consumes: `getTransportOverride(bookmaker, env?)` (§3, `src/config/transport.ts`), `FullOfferScraper`, `StsBrowserScraper` (Task 1), `StsWsScraper` (Task 3).
- Produces: `export function createStsScraper(env?: NodeJS.ProcessEnv): FullOfferScraper` (default `process.env`) and `export const stsScraper: FullOfferScraper = createStsScraper();`.
  - **The pick lives in the brand module** (README §3 one-pick rule; 05a and 05b pick there). `bookmakers/index.ts` only re-exports it.
  - No direct importer of the STS instance bypasses `bookmakers/index.ts` (checked with `git grep` on integration): `aggregator.ts:15` and `src/scripts/analyze-bookmaker-markets.ts:33` import it there; `scripts/match-audit-raw-capture.ts:45` reads `scrapers.stsScraper` from it; `scripts/sts-*.ts` call `navigation.ts` directly and need no change; `src/services/audit/bookmaker-registry.ts` excludes STS.
  - `scripts/test-scrapers.sh:35,335,390` name the class `STSScraper`, which stays an alias.
  - The aggregator keeps importing `stsScraper` unchanged; plan 02 Task 6 types it `FullOfferScraper`, and its legacy 1X2 path skips non-Playwright scrapers.
  - Import order is safe. `src/index.ts:9`, `aggregator.ts:8` and `scripts/perf-smoke.ts` (plan 02 Task 10 Step 2) load `config/index.ts` (`dotenv.config()` at `:3`) before `bookmakers/index.ts`, so a `.env` flag takes effect on restart. `src/config/transport.ts` imports config as a type only and never runs `dotenv` itself.

- [ ] **Step 1: Write the failing tests**

| test | call | expected |
|---|---|---|
| `defaults to the WebSocket transport` | `createStsScraper({})` | `toBeInstanceOf(StsWsScraper)`, `bookmaker` `"sts"`, `transport` `"websocket"` |
| `SCRAPER_TRANSPORT_STS=browser selects the browser class` | `createStsScraper({ SCRAPER_TRANSPORT_STS: "browser" })` | `toBeInstanceOf(StsBrowserScraper)`, `bookmaker` `"sts"`, `"transport" in s` false |
| `any other value keeps the WebSocket transport` | `{ SCRAPER_TRANSPORT_STS: "ws" }` (silence plan 02's `[transport] Ignoring …` warning with a `console.warn` spy) | `StsWsScraper`; the spy saw `'[transport] Ignoring SCRAPER_TRANSPORT_STS="ws": only "browser" is recognised'` |
| `legacy names still point at the browser class` | `STSScraper`, `STSPlaywrightScraper` | both `toBe(StsBrowserScraper)` (used by `scripts/test-scrapers.sh:335,390`) |
| `bookmakers/index re-exports the picked instance` | `(await import("../../index.js")).stsScraper` vs `(await import("../index.js")).stsScraper` | `toBe` the same object |

- [ ] **Step 2: Run it and confirm it fails**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts/__tests__/transport-select.test.ts`
Expected: FAIL (`createStsScraper is not a function` / missing export `StsWsScraper`).

- [ ] **Step 3: Implement** the factory and exports. Then write `sts/README.md` `## Transport`. It covers the default WS path (`ws-scraper.ts`: one session, the two `t:1` messages and `{"t":4}`), the flag (`SCRAPER_TRANSPORT_STS=browser` in `.env`; a restart is required) and the browser breaker (Task 0), followed by this table:

  | Log after `[sts] Full offer scraper error:` | `[STS/WS]` kind | Meaning | Operator action |
  |---|---|---|---|
  | `ws handshake HTTP 403 …` / `503 …` | blocked | Cloudflare challenges or blocks non-browser clients (browsers carry `cf_clearance`) | `SCRAPER_TRANSPORT_STS=browser` in `.env`, restart |
  | `ws handshake HTTP 429 …` | blocked | edge rate limit | same, if the next run repeats it |
  | `ws closed 1008 …` | blocked | policy close after the upgrade | flip |
  | `no i_pl snapshot \| ws timeout …`, `<n> of <m> details failed \| ws timeout …` | protocol | upgrade accepted, subscriptions unanswered: the framing changed | flip; recapture with `evidence/sts-superbet/sts-probe.mjs` and diff against plan 05a Observations |
  | `ws timeout <ms>ms …` (connect), `ws failed <code> …`, `ws closed 1006 …`, `ws handshake HTTP 502/504/52x …`, `scrape budget …` | transient | network or edge hiccup, or the run deadline | none; flip after 3 failed runs in a row (observability alert) |
  | `No fixtures found for league`, preceded by `[STS] Strict id filter for premier-league (C1/T17) matched 0 fixtures; name-filter candidates: …` | (none; classified transient) | STS renumbered the league's category/tournament ids (the warning names the candidates), or the calendar is empty when it names none. Not a transport fault: the browser path uses the same filter | do **not** flip; move `LEAGUE_CONFIG["premier-league"]` to the named ids with a failing `parse-fixtures-tournament.test.ts` case first (sts.md OQ4). `sts-run-check.py` reports it as `strictIdMiss` |
  | `<n> of <m> details failed \| no fixture snapshot <url>` (browser path, Task 0) | (none) | 3 consecutive match pages without a fixture snapshot | none on the first run; investigate (site change) if it repeats |

- [ ] **Step 4: Run it and confirm it passes**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/sts && $HEAVY npx tsc --noEmit && $HEAVY npx vitest run`
Expected: PASS; `tsc` exit 0 (apply the `analyze-bookmaker-markets.ts` retype if, and only if, `tsc` names that file); the full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/sts/index.ts src/scrapers/bookmakers/index.ts src/scrapers/bookmakers/sts/__tests__/transport-select.test.ts src/scrapers/bookmakers/sts/README.md
git commit -m "feat(sts): websocket transport by default, browser path behind SCRAPER_TRANSPORT_STS"
```
(Add `src/scripts/analyze-bookmaker-markets.ts` to `git add` only if it was changed.)

### Task 6: Live verification and switch (no code)

**Files:** none. Outputs go to `$PS=$WT/.scratch/perf-smoke/` (EXECUTION rule 5), never into the main checkout.

- [ ] **Step 1: Offline gate on the final branch.** In `$WT`: `$HEAVY npx tsc --noEmit && $HEAVY npx vitest run && $HEAVY npx vitest run src/services/normalization/__tests__/golden.test.ts -t sts`. Expected: exit 0, all green, and every `[golden] sts/...` line `failures=0`.

- [ ] **Step 2: Same-hour live comparison (read-only).** perf-smoke forces a dead `SUPABASE_URL` and writes no DB, so it is an allowed live probe (EXECUTION rule 4). Run it through `$HEAVY --live`, one at a time, between HH:15 and HH:45, never while the live backend's `/api/health` shows a run in progress, and with no Premier League kickoff listed in the next 10 minutes. If plan 02 builds `perf-smoke` as an extension of observability's `scripts/smoke-bookmaker.ts`, use its final file name; the flags and keys below are plan 02 Task 10's.

```bash
cd "$WT" && T=$(date -u +%Y%m%dT%H%M) && mkdir -p "$PS"
SCRAPER_TRANSPORT_STS=browser $HEAVY --live npx tsx scripts/perf-smoke.ts --bookmaker sts --league premier-league --out "$PS/sts-browser-$T.json" > "$PS/sts-browser-$T.log" 2>&1; echo "exit=$?"
$HEAVY --live npx tsx scripts/perf-smoke.ts --bookmaker sts --league premier-league --baseline "$PS/sts-browser-$T.json" --out "$PS/sts-ws-$T.json" --dump "$PS/sts-ws-$T-raw.json" > "$PS/sts-ws-$T.log" 2>&1; echo "exit=$?"
grep -E '^(PERF_SMOKE|PARITY) ' "$PS/sts-browser-$T.log" "$PS/sts-ws-$T.log"; grep -c "No fixture snapshot" "$PS/sts-ws-$T.log"; grep '^\[STS/WS\] Done in' "$PS/sts-ws-$T.log"; grep -c "Aborting per-fixture loop" "$PS/sts-browser-$T.log"
$HEAVY python3 -I -c "import json,sys; r=json.load(open(sys.argv[1])); n=[len(m['markets']) for m in r['matches']]; print('MIN_MARKETS', min(n), 'UNDER_100', sum(x < 100 for x in n))" "$PS/sts-ws-$T-raw.json"
```

Pass when:
1. The browser run exits 0 with `PERF_SMOKE` `scraperClass: "StsBrowserScraper"` and `transportOverride: "browser"`, so the comparison really used the old path. Its log has `0` `Aborting per-fixture loop` lines.
2. The WS run exits 0 (plan 02 Task 10: `success && matches > 0 && parity.pass`), with `scraperClass: "StsWsScraper"`, `transportOverride: null`, **`wallMs < 3000`** (today 97 400), `memory.chromiumProcessesEver == 0` and `transport.ws.framesReceived > 0`.
3. `PARITY` shows `matchesEqual: true` (19 on 2026-11-07), `marketsDeltaPct` and `selectionsDeltaPct` within **±2** of the same-hour browser run, and `pass: true`. For scale: the 2026-11-07 frames give 6 146 markets on the future-base parser (5 589 / 20 570 selections on 377b47e).
4. The WS log has **0** `No fixture snapshot` lines and one `[STS/WS] Done in …` line, and its `PERF_SMOKE` has no `error`.
5. `MIN_MARKETS >= 100` and `UNDER_100 0`: **0 one-market matches**; far-future fixtures carry ~153.

On a miss, stop and do not merge. Fix it with a failing test first (Task 3/4 style) and repeat Step 2 in a later hour.

- [ ] **Step 3: Recovery Acceptance B on this branch (read-only).** The recovery smoke (`$EVR/smoke-full-offer.mts:28`) runs its F17 team-stats listing probe through `executeWithBrowser` on `getScraper("sts")`, which the WS class does not have. Run it twice from `$WT`, one at a time:

```bash
CODES=GOALSCORER_ANYTIME,PLAYER_SHOTS,PLAYER_SHOTS_ON_TARGET,PLAYER_ASSISTS,PLAYER_CARDS,PLAYER_GOAL_OR_ASSIST,FIRST_PLAYER_CARDED,PLAYER_RED_CARD,CARDS_TEAM,CORNERS_TEAM,EACH_TEAM_TOTAL_CORNERS_OVER,EACH_TEAM_TOTAL_CARDS_OVER
SCRAPER_TRANSPORT_STS=browser $HEAVY --live node_modules/.bin/tsx $EVR/smoke-full-offer.mts sts premier-league $CODES > .scratch/smoke-sts-browser.log 2>&1; echo "exit=$?"
$HEAVY --live node_modules/.bin/tsx $EVR/smoke-full-offer.mts sts premier-league $CODES > .scratch/smoke-sts-ws.log 2>&1; echo "exit=$?"
grep -E 'Found [0-9]+ fixtures|^SMOKE_RESULT' .scratch/smoke-sts-browser.log .scratch/smoke-sts-ws.log
```

Pass when:
- **Flagged run:** sts.md Acceptance B criteria 1–3 hold, including F17 and `foldDropWarnings == 0`.
- **Default (WS) run:**
  - Criteria 1–2 and the main-group part of criterion 3 hold, with `foldDropWarnings == 0`.
  - `teamStatsError` names `executeWithBrowser` and F17 is null. That is expected: the probe needs the browser class.
  - Judge the team-stats codes against the flagged run's F17 ids: every match that run lists with `teamStats: true` carries `CARDS_TEAM`, `CORNERS_TEAM`, `EACH_TEAM_TOTAL_CORNERS_OVER` and `EACH_TEAM_TOTAL_CARDS_OVER` in the WS run's `perMatch[].codes`.

- [ ] **Step 4: Switch — DEFERRED (owner; EXECUTION rule 4 and Group A1).** The implementer does not merge. The report records:
  1. The order: `perf/sts-breaker`, then plan 02, then `perf/sts-websocket` into `recovery/integration`. Then `recovery/integration` into the live checkout, when the owner asks for that merge. That merge restarts the service once.
  2. Before the switch, the owner ANSI-strips the service log to `$LOG` (sts.md Acceptance C) and records `S=$(wc -l < "$LOG")`.

- [ ] **Step 5: Three scheduled runs after the switch — DEFERRED (record the commands and expectations):**

```bash
python3 -I "$REPO/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py" "$LOG" "$S"; echo "exit=$?"
awk -v s="$S" 'NR>s && /^\[STS\/WS\] Done in [0-9]+ms:/ {v=$4; sub(/ms:$/,"",v); n++; if (v+0>=3000) slow++} NR>s && /^\[STS\/WS\] (blocked|protocol) - / {hint++} END {printf "WS_RUNS runs=%d slow=%d hints=%d\n", n, slow, hint}' "$LOG"
tail -n +$((S+1)) "$LOG" | grep -E '^\[Aggregator/FullOffer\] sts [a-z_]+: '
```

(The awk shape was proven on a sample log: `WS_RUNS runs=2 slow=1 hints=1`.) Expected:
- `RUN_CHECK … "pass": true` with exit 0. That means ≥ 3 completed runs, no match under 100 raw markets, `found <= 20`, `completed == found - noSnapshot`, no full-offer drop, and, with the Task 0 fix, no `sts empty|scrape_failed|persist_failed:` line.
- `WS_RUNS runs>=3 slow=0 hints=0`.
- Every aggregator line is `sts success:` or `sts partial:`.

On the first scheduled run, also check observability A10 for STS with its Task 11 query (`…/scraper_runs?run_id=eq.$RUN&bookmaker=eq.sts&select=status,markets_saved`). Expected: `markets_saved >= 3848`, which is 0.75 × `RUN2_OK.sts` 5 130 (`src/__tests__/helpers/run-fixtures.ts:24-33`).

- [ ] **Step 6: Roll back if Step 5 fails (owner).** Set `SCRAPER_TRANSPORT_STS=browser` in the live `.env` and restart the service; no code change is needed. The next run must log `[STS/FullOffer] Completed` from the browser path, with Task 0's breaker still in place. Record the failing signal from Task 5's table in `$PS/sts-rollback-<T>.log`. Remove the worktrees only when the owner says so (EXECUTION Git rules).

## Self-Review

1. **Spec coverage.**
   - Browser breaker with the §5.1 failure shape and the `sts-run-check.py` fix: Task 0, which is a precondition of Tasks 1–6.
   - One session for listing + snapshots: Task 3 (`one session …`; `sent` asserts the two `t:1` messages).
   - Listing from the same `i_pl` with sts.md Task 2's filter: Task 3 Step 3 (`parseFixtures` on the session's `i_pl`).
   - All snapshots in one message, the 5 s wait, one re-send for missing ids, and a skip without a write: Task 2 constants + Task 3 tests.
   - Breaker and partial error with the §3 wording (`<n> of <m> details failed | ws timeout …`, `ws handshake HTTP …`): Tasks 2–3; cross-plan #15 via the `MISS(n)` rows.
   - `transport = "websocket"` (#19) and cumulative `transportStats()`: Task 3 (first test + `cumulative` test) and Task 5 (`transport` assertion).
   - Browser class kept as `StsBrowserScraper` behind `getTransportOverride`, the pick in the brand module, and the re-export identity: Tasks 1 and 5.
   - Cloudflare and strict-filter signals: Task 2 classification, Task 5 table, Task 6 Step 6.
   - Parity through one mapping and recorded frames: Tasks 1 and 4. The frames are `ws-probe-ipl.json.frames.ndjson` trimmed, plus the recovery `i_pl.trimmed.txt`, the Leeds snapshot + delta and the Arsenal–Hull snapshot. The recovery replay gate runs unconditionally in Task 4.
   - STS-2 and the 1500 ms sleeps dropped on the WS path: Task 3 (`parses the i_pl snapshot once per run`; no sleeps in the algorithm).
   - Live criteria (< 3 s, matches equal, ±2 %, 0 one-market matches, recovery Acceptance B with the F17 probe on the browser flag, sts-run-check): Task 6. The persisting steps are recorded as DEFERRED.
2. **Step scan.**
   - No TBD. There is one conditional action and it is explicit: the `analyze-bookmaker-markets.ts` retype, only if `tsc` names it.
   - Re-verified on integration on 2026-11-13:
     - the line anchors (`index.ts:41,305,310-404,328-394,406-409,427-429`, `navigation.ts:136,148,179,189,224,254,286,312`, `parser.ts:59,163,405`, `types.ts:169`, `constants.ts:464,469,474`, `config/leagues.ts:178`, observability `aggregator.ts:244,288`, `playwright-base.ts:233,302,353`);
     - the `sts-run-check.py` line numbers and the new pattern (sample-log proof);
     - the listing order of `i_pl.trimmed.txt` (20 valid fixtures, `f2921895` first) behind Task 0's literals;
     - the slugs `manchester-united-aston-villa`, `fulham-newcastle`, `chelsea-leeds`.
   - Task 0's page-capture counts follow from `captureMatchWithRetry`'s 2 attempts.
3. **Type consistency.**
   - Each of these is defined once (Produces) and used with the same signature later: `MAX_CONSECUTIVE_MATCH_FAILURES`, `StsOfferResult`, `mapStsFixtureToOffer`, `stsLog`, `StsTopicRequest`, `reduceStsFrame`, `missingSnapshots`, `shouldTripStsBreaker`, `classifyStsWsFailure`, `StsWsScraper`, `StsWsScraperDeps`, `createStsScraper`, `StsReplayInput`, `readStsFixture`, `emptyCapture`, `runBrowserPath`, `runWsPath`, `restrictIplFrame`.
   - §3, plan 02 and plan 07 names are used verbatim: `openWsSession`, `WsSessionOptions`, `WsSession.collect`, `ScrapeBudget`, `createScrapeBudget`, `DEFAULT_MAX_DURATION_MS.websocket`, `FullOfferScraper`, `TransportStats`, `TransportStatsSource`, `hasTransportStats`, `DeclaresTransport`, `DEFAULT_USER_AGENT`, `getTransportOverride`, `MAX_SKIPPED_DETAIL_RATIO`.
4. **Review focus.** Each of the six items names a test in its owning task: 1 → Task 3 ×3; 2 → Task 3 ×4; 3 → Task 2 table + Task 3 ×3; 4 → Task 3 ×2; 5 → Tasks 1 and 4; 6 → Task 0 ×2.
5. **Proportion.** Code blocks are limited to the Task 0 test, the fixture-trim command, the characterization and parity tests, and the orchestration algorithm. Their ordering and failure texts are what the signatures do not determine. Everything else is signatures and test tables.

## Open Questions

1. **Automatic fallback inside a run.** When the WS path fails with a `blocked` or `protocol` signal, should `StsWsScraper` retry the same league through `StsBrowserScraper` in the same run? Data would keep flowing, at a cost of ~100 s, ~1.4 GB and one Chromium for that run. The alternative is to stay manual via `SCRAPER_TRANSPORT_STS=browser`. Recommended default: **manual**. README principle 1 keeps Chromium off the hourly path, the failure stays visible, observability alerts after 3 failed runs, and the previous rows stay served.
