# Betcris: Browser-Path Speedups (Part A) and Direct Swarm Client (Part B) Implementation Plan

**Blocked by owner decision (EXECUTION C) — kept as a ready option; do not execute Part B without an explicit owner yes.** Part A (browser path only, not vetoed) is executable now.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:**
> - The owner answered betcris.md OQ1 / README §8 Q1 for betcris: **no Node Swarm client** ("keep today's pooling, keep the `betcris.pl` `BASE_URL`", recovery `EXECUTION.md` Group C). The plan is therefore split. **Part A** has two browser-path changes, executable now. **Part B** is the Swarm client, blocked until an explicit owner yes (`evidence/delta-audit-transport-2026-11-13.md` "05b", `delta-audit-infra-2026-11-13.md` README item 8).
> - betcris.md Tasks 1–6 are built on integration (962cd10, 39a6a36, 95b247a, 9fbfc9a, 2ea100a; merged in `aaf7c07`). That code includes `captureSwarm(page, url, config, timing?) → {data, failure, attempts}` (`navigation.ts:106-137`), cleared race timers (`finish()` `:212-221`, `readPageTitle` `:434-448`), the 3-consecutive-failure breaker (`index.ts:281-294`) and the `target_game_missing` skip. Obsolete and removed here: the `raceTimeout` red step, the "1-market listing copy" defect, the "Defects in today's browser path" list (only the cache remains), the "Relation to betcris.md" table, old Task 9 Step 2 (baseline B) and old Task 8's bespoke fake.
> - **Part A**: Task A1 (old Task 8) finishes the single-event capture on the `SINGLE_GAME_VIEW` reply inside `runCaptureAttempt.onFrame` (`navigation.ts:346-363`) and edits `capture.test.ts:162` (≈ −3 s × 19 games). Task A2 removes the never-pruned events cache (`index.ts:39-51`, `:66-72`, `:159-194`, `:310-316`).
> - **Part B** now replaces the *built* `captureSwarm` path:
>   - `buildBetcrisMatchOffer` replaces only `index.ts:297-335`; the breaker (`:281-294`) and the aborted result (`:352-362`) stay.
>   - `BetcrisPlaywrightScraper` stays an alias (`scraper-flow.test.ts:29,43`, `scripts/test-scrapers.sh:25,332,387`).
>   - Tests reuse `__tests__/helpers/fake-swarm-page.ts` and the tracked recordings.
>   - `BetcrisSwarmScraper` declares `transport = "websocket"` (cross-plan #19), with cumulative `transportStats()` (README §3).
>   - Live thresholds come from betcris.md acceptance A1 (19 matches, 12 128 markets) instead of 9 253 / 7 315.
> - Adopts the EXECUTION.md workspace rules (worktree from `recovery/integration`, `bin/heavy`, dead-port `.env`, `.scratch/`). Persisting acceptance is DEFERRED to the owner, with the command and expected result recorded.

**Goal:**
- **Part A:** shave the 3 s plateau wait off every per-game page load of the browser path (≈ 57 s per 19-game run) and drop the full-game cache that is written every run and never pruned (~34 MB/run). There is no change to transport, pooling or output.
- **Part B (blocked):** betcris's full offer comes from one Node WebSocket session to its BetConstruct "Swarm" backend instead of 1 + N Chromium page loads. That is one listing request plus one request per game, 4 in flight. The betcris job drops from ~100 s and ~13 758 requests to under 5 s, with 2 + N request/reply pairs (N = games) on one socket and byte-identical `FullMatchOffer` output.

**Architecture:**
- **Part A** changes only `navigation.ts`'s single-event completion rule and `index.ts`'s cache code. The milestone deadlines, the retries, the breaker and the plateau fallback built by betcris.md stay as they are.
- **Part B** starts from Part A's code.
  - The browser class is renamed `BetcrisBrowserScraper` (`browser-scraper.ts`, alias `BetcrisPlaywrightScraper`). Its per-game mapping (`index.ts:297-335`) moves into a pure module (`swarm-offer.ts`) that both paths call (README §3 parity pattern). The breaker and the aborted result stay in the browser loop.
  - The new `BetcrisSwarmScraper` reads the site id and socket URL from `partnerConfigs` once per 6 h (§3 `HttpClient`, with a constant fallback).
  - It opens a §3 `WsSession` and runs a small rid-matched request/response client on top of it (`request_session`, then a competition listing).
  - It fetches the games with `fetchDetailsSkippingFailures` (4 at a time; failed or slow games are skipped, never downgraded) and maps every reply through the same pure module.
  - It returns plan 02's `HttpScraper` result shape. `getTransportOverride("betcris")` keeps the browser class reachable for one release.

**Tech Stack:** TypeScript ESM (tsx), Playwright (Part A), `ws` via plan 02's `openWsSession` (Part B), Vitest 4 (fake timers), BetConstruct Swarm JSON protocol.

**Spec:** README §1.4, §2 (principles 1, 3, 5), §3 (`openWsSession`, `HttpClient`, `fetchDetailsSkippingFailures`/`mapLimit`, `FullOfferScraper`, `createScrapeBudget`, `getTransportOverride`, the one-pick rule, `DeclaresTransport`, cumulative `transportStats()`, `createReplayHttpClient`, parity pattern), §5 (P7) and the §5.1 betcris row, §6 (parity gate), §7, §8 Q1.
- Evidence (main checkout, untracked, read-only, absolute paths): `evidence/betcris-pzbuk/swarm-bulk.mjs` (the verified protocol), `swarm-bulk-stats.json`, `swarm-bulk-per-game.json`, `body_www.betcris.pl.html`; `evidence/profiling/summary-individual.json`, `metrics-blocked-betcris*.json`; `evidence/findings-notes.md` (BETCRIS-1…3); the two delta audits.
- Recovery, tracked on integration: `docs/superpowers/plans/2026-11-06-scraper-recovery/betcris.md` (Tasks 1–7, Acceptance A1–A4), `EXECUTION.md`, `evidence/betcris/acceptance-2026-11-07.json`, and the recordings now committed as test fixtures (`src/scrapers/bookmakers/betcris/__tests__/fixtures/{league-538,match-31321159}-frames.json`).

## Global Constraints (both parts)

- README §6 applies in full (green `tsc` + `vitest` before every commit, golden test unchanged, no attribution footers, commit only when the owner asked). The EXECUTION.md workspace rules also apply:
  - One worktree per part under `/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/`, branched from `recovery/integration`. Never write in the main checkout or the frontend repo.
  - `node_modules` is a symlink to the main checkout's; never `npm install`/`npm ci`.
  - `.env` is a copy of the integration worktree's dead-port `.env` (`SUPABASE_URL=…:9`).
  - Every `npx vitest`/`tsc`/`tsx`, `python3` over large files and Playwright run goes through `$HEAVY`; anything that opens a browser or calls betcris/betsport uses `$HEAVY --live`, one at a time.
  - Scoped tests during TDD; the full suite + `tsc` once per task.
  - Never start the server or the scheduler, never write the DB. Live acceptance that needs a persisted scrape is DEFERRED: record the command and the expected result.
  - Scratch output and the test tsconfig go in `$WT/.scratch/`, not `/tmp`.
- Baseline: the future base (integration + observability + fortuna) has 125 test files / 2243 tests; record the worktree's own count first.
- `tsc` skips tests (`tsconfig.json` excludes `src/**/__tests__/**/*`). Type-check new tests with `$WT/.scratch/tsconfig.betcris-tests.json`, which is betcris.md's scratch config moved out of `/tmp`: `{ "extends": "<WT>/tsconfig.json", "compilerOptions": { "noEmit": true, "rootDir": "<WT>", "declaration": false, "declarationMap": false }, "include": ["<WT>/src/scrapers/bookmakers/betcris/**/*.ts"], "exclude": [] }`. Run it as `$HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json`.
- Owner decision C stands for both parts: `BASE_URL`, `LEAGUE_URLS`, `COMPETITION_IDS` and `buildEventUrl` keep `www.betcris.pl` (`constants.ts:11,17-37`, `navigation.ts:692-701`), there is no coverage pass, and today's pooling is kept. Part A changes neither pooling nor transport.
- **Never block stylesheets for betcris.** The browser path keeps `disableResourceBlocking: true` (`src/types/scraper.ts:253`); with CSS blocked the site returns 0 matches (`evidence/profiling/metrics-blocked-betcris.json`). Plan 08 Task 3 later expresses the same guard as `resolveBrowserPolicy("betcris", …)` (cross-plan #5).
- Kept log formats: `[Betcris/FullOffer] Found N games for <league>`, `[Betcris/FullOffer] <home> vs <away>: N markets` (betcris.md's A1 helper greps it), `[Betcris/FullOffer] Completed: …`, `[Betcris/FullOffer] Skipped game <id> (<home> vs <away>): …`, `[Betcris/FullOffer] Aborting per-match loop: …`, and the `[Betcris] capture ok: …` success line (betcris.md A2 greps it). Aggregator greps use observability's `[Aggregator/FullOffer] betcris <status>: N matches, M markets found, K saved[ - err]` (`aggregator.ts:244-245`).
- Fake timers in tests follow `capture.test.ts`/`scraper-flow.test.ts` (`vi.useFakeTimers()`). `navigation.ts` deliberately takes `setImmediate`/`setInterval` for its sampler from `node:timers`, so fakes leave them real.
- Tests never touch the network. Live checks run one smoke at a time and never within HH:55–HH:10.

## Review Focus

Part A:
1. **An early, empty `SINGLE_GAME_VIEW` reply** (the recording has one at t=1873 with `sport:{}`) must not finish the capture. Only a `SINGLE_GAME_VIEW`-tagged frame that itself carries the target game with ≥ 1 market does. Pinned by Task A1 "resolves on the SINGLE_GAME_VIEW reply, before the plateau" (finish time exactly 2654, 613 markets).
2. **A page that never tags its reply** (a renamed rid) still completes through the `markets_count` target or the 3 s plateau, exactly as today. Pinned by Task A1 "without a SINGLE_GAME_VIEW-tagged reply the plateau still decides".
3. **No cache, no stale detail.** `scrapeMatchDetails` right after `scrapeFullOffer` must navigate again instead of serving a game captured in an earlier run. Pinned by Task A2 "navigates even right after scrapeFullOffer captured the game".

Part B (blocked):
4. **A game request is never answered while the socket stays open.** Only that game is skipped, after 10 s, with `ws timeout 10000ms <socket>`; the others are written. A late reply is ignored without an unhandled rejection. Pinned by Task B4 "a timed-out request rejects alone and its late reply is ignored" and Task B5 "skips a game whose request times out".
5. **The socket drops (code 1006) with requests in flight.** Every pending and later request fails with `ws closed 1006 <socket>`. A drop before the listing reply gives `success:false` with that cause and writes nothing. Pinned by Task B4 "a dropped socket rejects every pending request" and Task B5 "fails with the close cause when the socket drops before the listing".
6. **`partnerConfigs` is unusable.** The cases are HTTP 4xx/5xx (including a Cloudflare `cf-mitigated=challenge` 403), a page without it, invalid JSON, a non-`wss` URL and a non-numeric partner id. The fallback constants are used, one warn line names the cause, the fallback is cached for 10 min, and the scrape is never blocked. Pinned by Task B3.
7. **The cached socket host is retired or refuses connections.** The first open fails, the config cache is invalidated, and the second attempt re-reads `partnerConfigs`. Two failures give `success:false` with the last cause. Pinned by Task B5 "handshake fails twice" and "recovers on the second open attempt".
8. **A reply lacks the requested game** (it went live, or was removed between listing and detail). The game is skipped with `swarm game <id> missing from reply`, the same outcome as the browser path's `target_game_missing` skip (`index.ts:281-284`), and is never written from its 1-market listing copy. Pinned by Task B5 "skips a game missing from its reply".

---

## Observations (pre-fix analysis)

All `file:line` refer to `recovery/integration` ≥ `aaf7c07`. Observability and fortuna do not touch `src/scrapers/bookmakers/betcris/`; `aggregator.ts`/`playwright-base.ts` refs are observability's.

**The browser path today [V].** `scrapeFullOffer` (`index.ts:231-373`) works in this order:
- The listing comes from `captureSwarm(page, LEAGUE_URLS[league], { competitionId })` (`:247`); a failure logs `[Betcris] No WebSocket data captured: …` (`:249-250`).
- Then, per game, sequentially: `captureSwarm(page, eventUrl, { singleEventMode: true, targetGameNumber })` (`:275`).
- A site-level failure counts toward the breaker (`:281-294`, `WS_CONFIG.MAX_CONSECUTIVE_MATCH_FAILURES: 3`, `constants.ts:235`).
- On success the loop:
  - picks the richest copy of the game (`:297-308`);
  - writes it to the events cache (`:310-316`);
  - parses it (`:318`);
  - pushes and logs it (`:320-335`);
  - waits `delay(100)` (`:338`).
- An abort returns what was captured, with `error: "aborted after 3 consecutive per-match capture failures"` (`:352-362`).

Every load is two cross-origin documents (the betcris.pl → betsport.pl client redirect), about 650 requests each. Acceptance A1 on the browser path (2026-11-07 02:13Z, `recovery/betcris` @ 2ea100a, `evidence/betcris/acceptance-2026-11-07.json`): **19 matches, 12 128 normalized markets** (2 289 OTHER, share 0.189), at least 344 per match, `durationMs` 100 841, no skipped game, no retry.

**The per-game 3 s wait [V].** Single-event completion (`runCaptureAttempt.onFrame`, `navigation.ts:346-363`) finishes in one of three ways:
- when the unioned markets reach the game's `markets_count` (`:359-363`);
- on the plateau, with no growth for `PLATEAU_WAIT_TIME` 3 000 ms (`constants.ts:241`), polled every 300 ms (`:303-306`);
- at `MAX_WAIT_TIME_SINGLE_EVENT` 16 000 ms.

The target is never reached: 19 of 19 games fall 5–22 short. The recorded game has 613 of 635 (`match-31321159-frames.json`), and the direct reply shows the same shortfall (`swarm-bulk-per-game.json`: 560 of 577, 595 of 617, …).

The match page delivers the whole game in **one** reply tagged `rid: "SINGLE_GAME_VIEWSubscribeCmd…"`: t=2654, 972 974 B, 613 markets. An earlier `SINGLE_GAME_VIEW` reply at t=1873 carries `sport: {}`. Later frames (`GameList…` at t=2700/2786) add only the target's 1-market listing copy. So every game waits ≈ 3 s for nothing: about 57 s per 19-game run (findings BETCRIS-1).

**The events cache [V].** `eventsCache` (`index.ts:47-51`, `maxSize: 500`, `CACHE_TTLS.EVENTS`) stores every captured full game (~1.70 MB, ~34 MB/run) at `:310-316`. `ScraperCache` expires entries only on read (`cache-manager.ts`). The only read is the legacy `scrapeMatchDetails` branch (`:159-194`), which only `scripts/test-scrapers.sh` calls, and which then serves a game from an earlier run instead of navigating. Plan 01 leaves this cache to this plan (delta audit 01: "betcris (`index.ts:47`) … caches remain").

**Resource blocking [V].** With CSS blocked the result is `success:false`, `No WebSocket data captured`, 0 matches (`evidence/profiling/metrics-blocked-betcris.json`). With images/fonts/media blocked: 18 matches. With trackers only: 19 matches.

**Direct Swarm client, verified [V]** (Part B; `evidence/betcris-pzbuk/swarm-bulk.mjs`, `swarm-bulk-stats.json`):

| Item | Value |
|---|---|
| Connect | `new WebSocket(url, { headers: { Origin: "https://www.betcris.pl", "User-Agent": <Chrome/120 UA> } })`, permessage-deflate (the `ws` client default), no cookies |
| Session | send `{"command":"request_session","params":{"language":"pol","site_id":"1874631","source":42},"rid":…}` → `{code:0, rid, data:{sid, ctx:{site:1874631}, …}}`. The SPA's extra `is_wrap_app`/`afec` fields are not needed |
| Query | `{"command":"get","rid":…,"params":{"source":"betting","what":{…},"where":{…},"subscribe":false}}` → `{code:0, rid, data:{data:{sport:{<id>:{region:{…competition:{…game:{<id>:{market:{<id>:{event:{…}}}}}}}}}}}}`. Subscription replies (SPA) also carry `data.subid`; we never subscribe |
| Bulk (rejected design) | one request for competition 538: 19 games, 8 644 markets, 63 842 events, **10.86 MB in one frame**, 1 001 ms. One synchronous `JSON.parse` of 10.9 MB blocks the event loop (README principle 5) |
| Per game | `where:{game:{id}}`: 834–901 KB per reply. Three requests pipelined on one socket all came back within 264 ms → 4 at a time keeps every parse ≤ ~1 MB |

**Where the site id and socket come from [V]** (Part B). `partnerConfigs` is one JSON line in the page HTML: `swarmUrl` gives the socket and `springConfig.partnerId` the site id.
- `www.betcris.pl` (`evidence/betcris-pzbuk/body_www.betcris.pl.html:402`): `wss://eu-swarm-ws-re.trexname.com/`, `1874631`.
- `www.betsport.pl`: `wss://eu-swarm-springre.trexname.com/`, `1874631` (live GET 2026-11-07 01:4xZ, HTTP 200, 283 676 B, no challenge). This is the socket the SPA actually opens (the recordings' `open` events) and the one every probe used.
- `eu-swarm-ws-re` also accepts a session for site 1874631 (live check 2026-11-07: reply `code 0` in 200 ms). After a client-initiated close that socket reported code **1006**, so our own `close()` must never surface as an error.

**What plan 02's `WsSession` gives and requires** (`02-shared-transport.md` Task 8; this shapes Task B4):
- Only **one** `collect` may run at a time; a second one rejects with `ws collect already active`. Frames that arrive while no `collect` runs are buffered and replayed into the next one.
- A socket close rejects the active `collect` with `ws closed <code> <url>`. A budget abort terminates the socket and rejects with `BudgetExceededError` (`scrape aborted: …` / `scrape budget of …ms exceeded`).
- `collect`'s own timeout resolves `{ timedOut: true }`. `send` on a closed socket throws.
- `close()` sends 1000 and terminates after 1 000 ms when the server does not answer. Live, eu-swarm reported 1006 for our own close, so this plan never awaits that close on the result path.
- Pre-handshake errors are `ws failed <code> <url>`. The default `user-agent` is `DEFAULT_USER_AGENT` (Chrome/143); the probes used Chrome/120, so Task B8 is the first live run with Chrome/143 [I].

**Fields `parser.ts` reads [V]** (Part B). These are the fields the client requests (`SWARM_WHAT`):
- sport `alias` (`parser.ts:646`); region `alias` (`:661`); competition `id`.
- game: `id`, `team1_name`, `team2_name` (`:36-40`), `is_blocked` (`:653`), `start_ts` (`index.ts:328`), `market`.
- market: `type`, `name`, `base`, `event` (`getMarketName` `:173`, `parseAllMarkets` `:388`, ladder split `:297-386`).
- event: `id`, `name`, `price`, `type_1`, `base` (`getSelectionName` `:224`, `:410`).
- `SwarmGame`/`SwarmMarket`/`SwarmEvent` (`types.ts:11-74`) add `team1_id`, `team2_id`, `markets_count`, `game_number`, `order` and `col_count`, which are requested too.

Task B4's projection test re-proves on the recorded 613-market game that these fields cover the parser, including betcris.md Task 3's ladder split.

## Part A — browser path (executable now)

Worktree `perf/betcris-browser`:

```bash
REPO=/home/skamik/Documents/repositories/personal/aityper-scraper-api           # main checkout: read only
WTS=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees
HEAVY=$WTS/bin/heavy
WT=$WTS/perf-betcris-browser
git -C "$REPO" worktree add -b perf/betcris-browser "$WT" recovery/integration
ln -s "$REPO/node_modules" "$WT/node_modules" && cp "$WTS/integration/.env" "$WT/.env"
cd "$WT" && mkdir -p .scratch && grep -c '^SUPABASE_URL=.*:9$' .env                       # 1 (dead port)
grep -c "export async function captureSwarm" src/scrapers/bookmakers/betcris/navigation.ts   # 1 (betcris.md Tasks 1-2 built)
$HEAVY npx vitest run 2>&1 | grep -E "Test Files|Tests "                                 # record the baseline
```

### File Structure (Part A)

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/bookmakers/betcris/navigation.ts:346-363` | single-event branch of `runCaptureAttempt.onFrame`: finish on the `SINGLE_GAME_VIEW` reply | A1 |
| `src/scrapers/bookmakers/betcris/__tests__/capture.test.ts:162-170` | the single-event test resolves on the SGV reply; one fallback test | A1 |
| `src/scrapers/bookmakers/betcris/index.ts:16,37,39-51,66-72,159-194,310-316` | no events cache | A2 |
| `src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts:27-28,64` (+2 tests) | cache-removal tests; stale comments fixed | A2 |

### Task A1: Finish the single-event capture on the `SINGLE_GAME_VIEW` reply

**Files:**
- Modify: `src/scrapers/bookmakers/betcris/navigation.ts:346-363` (single-event branch of `onFrame`)
- Test: `src/scrapers/bookmakers/betcris/__tests__/capture.test.ts:162-170` (rename + timing assertion), plus one new test after it

**Interfaces:**
- Consumes: `captureSwarm`, `analyzeSwarmData` (`navigation.ts:106`, `:581`, module-local); `createFakeSwarmPage`, `loadRecording`, `settle` (`__tests__/helpers/fake-swarm-page.ts`); the local `findGame` helper of `capture.test.ts:44-49`.
- Produces: one rule, in single-event mode only. After the frame is merged and `onTargetSeen()` has run: if `String(msg.rid ?? "").startsWith("SINGLE_GAME_VIEW")` and `analyzeSwarmData(msg.data.data, targetGameNumber).targetMarketCount > 0` (the target is in **this** frame), call `void finish(null)`. The `markets_count` rule (`:359-363`), the plateau and `MAX_WAIT_TIME_SINGLE_EVENT` stay as fallbacks. League mode is unchanged.

- [ ] **Step 1: Write the failing tests.** Replace the test at `capture.test.ts:162` ("single-event mode unions game 31321159 and resolves on plateau") with the first test below, and add the second after it:

```ts
it("betcris capture: single-event mode resolves on the SINGLE_GAME_VIEW reply, before the plateau", async () => {
  const url = `${LEAGUE}/31321159`;
  const t0 = Date.now(); let at = -1;
  const out = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: match })).page, url, { singleEventMode: true, targetGameNumber: 31321159 })
    .then((o) => ((at = Date.now() - t0), o)));
  expect(out.failure).toBeNull();
  expect(out.attempts[0].firstUsefulFrameMs).toBe(2654);
  expect(at).toBe(2654);                                   // before: the 3 s plateau, >= 5654
  const g = findGame(out.data!, 31321159);                 // local helper
  expect(Object.keys(g.market ?? {})).toHaveLength(613);
  expect(g.markets_count).toBe(635);
});
it("betcris capture: without a SINGLE_GAME_VIEW-tagged reply the plateau still decides", async () => {
  const url = `${LEAGUE}/31321159`;
  const untagged = match.map((e) => (e.kind === "recv" && e.t === 2654 ? { ...e, payload: e.payload!.replace('"rid":"SINGLE_GAME_VIEW', '"rid":"Other') } : e));
  const t0 = Date.now(); let at = -1;
  const out = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: untagged })).page, url, { singleEventMode: true, targetGameNumber: 31321159 })
    .then((o) => ((at = Date.now() - t0), o)));
  expect(out.failure).toBeNull();
  expect(at).toBeGreaterThanOrEqual(2654 + 3000);
  expect(Object.keys(findGame(out.data!, 31321159).market ?? {})).toHaveLength(613);
});
```

The recording has exactly one `"rid":"SINGLE_GAME_VIEW` occurrence in the t=2654 payload (checked on integration 2026-11-13). The t=1873 SGV reply carries `"sport":{}` and stays untouched.

- [ ] **Step 2: Run them and confirm the first fails.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/capture.test.ts` → test 1 FAILS on `expect(at).toBe(2654)` (today it resolves on the plateau, ≥ 5654); test 2 and every other capture test pass.

- [ ] **Step 3: Implement the rule** as specified under Produces. Keep the existing order in `onFrame` (merge → stats → growth → `onTargetSeen()` → `markets_count` check), so `firstUsefulFrameMs` is set before `finish`.

- [ ] **Step 4: Run and confirm.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris` → green: capture, scraper-flow (its per-game fakes replay the same match recording, so each game now ends at 2654), parser and stat-ladders. Then `$HEAVY npx tsc --noEmit && $HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run`.

- [ ] **Step 5: Commit.**
```bash
git add src/scrapers/bookmakers/betcris/navigation.ts src/scrapers/bookmakers/betcris/__tests__/capture.test.ts
git commit -m "perf(betcris): finish single-event capture on the SINGLE_GAME_VIEW reply"
```

### Task A2: Remove the never-pruned events cache

**Files:**
- Modify: `src/scrapers/bookmakers/betcris/index.ts`:
  - delete `:16` (`ScraperCache, CACHE_TTLS` import);
  - delete `CachedBetcrisGame` + `eventsCache` (`:39-51`) and `updateCache`/`getCachedEvent` (`:66-72`);
  - delete the cache branch of `scrapeMatchDetails` (`:159-194`), so the legacy method always navigates;
  - delete the `updateCache` call in `scrapeFullOffer` (`:310-316`);
  - drop `SwarmGame, ParsedTeams` from the type import at `:37` if nothing else uses them.

  `parseSwarmDataForMatchDetails` stays imported; the browser branch at `:208` uses it.
- Test: `src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts`. Add two tests. Fix the stale comments at `:27-28` ("eventsCache … is module-level") and `:64` ("the cache path (index.ts:164-199) is skipped"); `vi.resetModules()` stays.

**Interfaces:**
- Consumes: `ScraperCache` (`src/services/cache-manager.ts`), imported **dynamically inside the test** after `beforeEach`'s `vi.resetModules()` + `import("../index.js")`, so the spy hits the same module instance the scraper uses; `createFakeSwarmPage`, `loadRecording`, `settle`; `scraper-flow.test.ts`'s local `retarget` and `useFakeBrowser`.
- Produces: no new export. `scrapeMatchDetails` always takes the `executeWithBrowser` branch.

- [ ] **Step 1: Write the failing tests** (in `scraper-flow.test.ts`'s `describe`):

```ts
const offerPage = () => createFakeSwarmPage((url) => (url.endsWith("/538") ? { events: league } : { events: retarget(match, Number(url.split("/").pop())) }));

it("betcris scrapeFullOffer: writes no module-level events cache", async () => {
  const { ScraperCache } = await import("../../../../services/cache-manager.js");
  const setMany = vi.spyOn(ScraperCache.prototype, "setMany");
  useFakeBrowser(offerPage());
  await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
  expect(setMany).not.toHaveBeenCalled();                 // today: once per captured game (20)
});
it("betcris scrapeMatchDetails: navigates even right after scrapeFullOffer captured the game", async () => {
  const fake = offerPage(); useFakeBrowser(fake);
  const s = new BetcrisPlaywrightScraper();
  await settle(s.scrapeFullOffer("premier-league"));
  expect(fake.gotoAt).toHaveLength(1 + 20);
  const r = await settle(s.scrapeMatchDetails(`${LEAGUE}/31321159`));
  expect(r.status).toBe("success");
  expect(fake.gotoAt).toHaveLength(1 + 20 + 1);           // today: served from the cache, no navigation
});
```

- [ ] **Step 2: Run and confirm they fail.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts` → both new tests FAIL (20 `setMany` calls; `gotoAt` stays at 21). The 8 existing tests pass.

- [ ] **Step 3: Implement** the deletions listed under Files. Then the mechanical check: `grep -n "eventsCache\|ScraperCache\|updateCache\|getCachedEvent\|CachedBetcrisGame" src/scrapers/bookmakers/betcris/index.ts` → no output.

- [ ] **Step 4: Run and confirm.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris` → green. Then `$HEAVY npx tsc --noEmit && $HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run` → baseline + 3 tests (1 from A1, 2 here).

- [ ] **Step 5: Commit.**
```bash
git add src/scrapers/bookmakers/betcris/index.ts src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts
git commit -m "perf(betcris): drop the never-read events cache"
```

### Task A3: Live check (read-only; no code)

- [ ] **Step 1: A1 smoke on Part A's head.** This is betcris.md Task 7 Step 1: the exact Task 4 Step 5 command, writing `.scratch/smoke.txt` and `.scratch/smoke-full.txt`. Run it from `$WT` through `$HEAVY --live`, outside HH:55–HH:10. It writes no DB. Pass:
  - betcris.md Acceptance A1 holds: `success:true`, `matches ≥ 18` (listing − 2 per the ledger ruling), `minMarketsPerMatch ≥ 300`, `otherShare ≤ 0.21`, the ladder helpers (Σ `ladderTypes ≥ 10 × R`, no `Unknown market` line for a ladder id), `residual`/`dupRungs`/`zeroTier`/`normCollisions` 0;
  - `durationMs` ≤ 70 000 (100 841 in `acceptance-2026-11-07.json`; the saving is ≈ 3 s × games);
  - `grep -c "Skipped game\|Aborting per-match loop" .scratch/smoke-full.txt` → `0`.
  Record the numbers next to A1's (19 / 12 128 / 2 289 / 344 / 100 841).
- [ ] **Step 2: DEFERRED (owner).** After the owner merges `perf/betcris-browser`, the merge itself and betcris.md A2 run on persisted, full 14-bookmaker runs. Record: on 3 consecutive runs, `sed 's/\x1b\[[0-9;]*m//g' <service log> | grep -E '^\[Aggregator/FullOffer\] betcris [a-z_]+: |\[Betcris\] capture ok'` shows `betcris success:` (or `partial:`) with `N ≥ 18` matches, and one `[Betcris] capture ok: …` line per run.

## Part B — direct Swarm client (BLOCKED: owner said no; needs an explicit yes)

**Do not start Part B** until the owner records an explicit "yes" to a Node Swarm client, overriding EXECUTION.md Group C. Everything below is kept current against the code so it can run on that answer.

### Additional constraints (Part B)

- **Hard preconditions:**
  - (a) That owner yes, recorded in the task report.
  - (b) Part A merged into the base.
  - (c) Plan 02 merged: §3 modules exist, and `src/scrapers/aggregator.ts` types `SCRAPERS` as `Record<PolishBookmaker, FullOfferScraper>`.
- Worktree `perf/betcris-swarm`, created like Part A (`WT=$WTS/perf-betcris-swarm`), from a base that contains Part A and plan 02.
- Bootstrap page: `https://www.betsport.pl/`. It is only a GET of the SPA config; stored `eventUrl`s keep `www.betcris.pl`. TTL is 6 h after a parsed page and 10 min after a fallback. Fallback constants: `site_id "1874631"`, socket `wss://eu-swarm-springre.trexname.com/`. If the owner's yes excludes betsport.pl traffic, set `PARTNER_CONFIG_URL` to `https://www.betcris.pl/`, whose `partnerConfigs` names `eu-swarm-ws-re`, which also accepts site 1874631.
- Swarm requests always carry `subscribe: false`. Each `scrapeFullOffer` call opens one socket and closes it in `finally`.
- At most 4 game requests are in flight. Per-request timeouts: session 5 s, listing 10 s, game 10 s. Connect timeout 5 s. Two open attempts, 1 s apart. The default budget is `DEFAULT_MAX_DURATION_MS.websocket` (120 000 ms).
- Socket headers are exactly `{ origin: "https://www.betcris.pl", "user-agent": DEFAULT_USER_AGENT }`, with lower-case keys, as in 05a/05c. No cookies.
- Result shape: plan 02 `HttpScraper` template steps 1, 3–5.
  - An unsupported league gives `Unknown league: <league>`.
  - Anything thrown gives `success:false`, `matches:[]`, error = its message, plus `console.error("[betcris] Full offer scraper error: <error>")`, the line the browser path logs (observability `playwright-base.ts:302`).
  - Any skip gives `error: "<n> of <m> details failed | <first error>"`, logged as `console.warn("[betcris] <error>")`. More than half skipped → `success:false`, `matches:[]`; otherwise `success:true` and the error is kept.
- Like plan 02: never `addEventListener` on `budget.signal` or any caller signal. The budget reaches the socket only through `openWsSession({ budget })` and `budget.checkpoint()`.
- A new `[Betcris] capture ok: transport=swarm, …` line on success keeps betcris.md A2's success grep working.

### File Structure (Part B)

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/bookmakers/betcris/browser-scraper.ts` (`git mv` of `index.ts`) | `BetcrisBrowserScraper`; calls `buildBetcrisMatchOffer` | B1, B2 |
| `src/scrapers/bookmakers/betcris/index.ts` (new) | re-exports both classes and the alias; `betcrisScraper` picked by `getTransportOverride` (the pick, README §3) | B1, B7 |
| `src/scrapers/bookmakers/index.ts:17` | exports `betcrisScraper`, `BetcrisBrowserScraper`, `BetcrisSwarmScraper`, alias `BetcrisPlaywrightScraper` | B1, B7 |
| `src/scrapers/bookmakers/betcris/swarm-offer.ts` | pure: `buildBetcrisMatchOffer`, `findGameInSwarmData`, `buildEventUrl` (moved) | B2 |
| `src/scrapers/bookmakers/betcris/navigation.ts:692-701` | re-export `buildEventUrl` from `swarm-offer.ts` | B2 |
| `src/scrapers/bookmakers/betcris/constants.ts` (append at the end) | `SWARM_TRANSPORT` | B3 |
| `src/scrapers/bookmakers/betcris/swarm-config.ts` | `parsePartnerConfigs`, `createSwarmPartnerConfigCache` | B3 |
| `src/scrapers/bookmakers/betcris/swarm-client.ts` | `SWARM_WHAT`, param builders, `openSwarmClient` (rid-matched RPC over `WsSession`) | B4 |
| `src/scrapers/bookmakers/betcris/swarm-scraper.ts` | `BetcrisSwarmScraper implements FullOfferScraper` | B5 |
| `src/scripts/analyze-bookmaker-markets.ts:36,41` | map typed `FullOfferScraper` (only if `tsc` flags it) | B7 |
| `src/scrapers/bookmakers/betcris/__tests__/helpers/swarm-fixtures.ts` | `recordedListing`, `recordedGame`, `RECORDED_GAME_IDS`, `retarget`, `browserOfferPage`, `loadFixtureText`, `projectSwarmData`, on top of `fake-swarm-page.ts` | B1, B3, B4 |
| `src/scrapers/bookmakers/betcris/__tests__/helpers/fake-swarm-session.ts` | `createFakeSwarm`, `recordedAnswer` | B4 |
| `src/scrapers/bookmakers/betcris/__tests__/fixtures/swarm/` | `partner-configs.html`, `session-reply.json` (small; the game/listing payloads come from the tracked recordings) | B3, B4 |
| `__tests__/browser-class.test.ts`, `swarm-offer.test.ts`, `swarm-config.test.ts`, `swarm-client.test.ts`, `swarm-scraper.test.ts`, `parity.test.ts`, `transport-selection.test.ts` | tests | B1–B7 |

### Task B1: The browser class becomes `BetcrisBrowserScraper`

**Files:**
- Move: `git mv src/scrapers/bookmakers/betcris/index.ts src/scrapers/bookmakers/betcris/browser-scraper.ts`. In it, rename the class (`:53`) and delete the singleton (`:400`). The cache is already gone (Part A) and the race timers are already cleared (betcris.md Task 1).
- Create: `src/scrapers/bookmakers/betcris/index.ts`
- Modify: `src/scrapers/bookmakers/index.ts:17`
- Create: `src/scrapers/bookmakers/betcris/__tests__/helpers/swarm-fixtures.ts`
- Test: `src/scrapers/bookmakers/betcris/__tests__/browser-class.test.ts`. `scraper-flow.test.ts:29,43` keeps importing `BetcrisPlaywrightScraper` from `../index.js` unchanged; the alias makes it work.

**Interfaces:**
- Produces:
  ```ts
  // browser-scraper.ts
  export class BetcrisBrowserScraper extends PlaywrightScraper { /* unchanged public surface */ }
  // index.ts (until Task B7)
  export { BetcrisBrowserScraper, BetcrisBrowserScraper as BetcrisPlaywrightScraper } from "./browser-scraper.js";
  export const betcrisScraper = new BetcrisBrowserScraper();
  // bookmakers/index.ts:17
  export { betcrisScraper, BetcrisBrowserScraper, BetcrisPlaywrightScraper } from "./betcris/index.js";
  // __tests__/helpers/swarm-fixtures.ts (on top of fake-swarm-page.ts: loadFixture, loadRecording, settle, createFakeSwarmPage)
  export function recordedListing(): SwarmData;      // data.data of the first GameList reply in loadRecording("league-538-frames.json") (t=1908, 20 games, P1XP2 only)
  export function recordedGame(gameId: number): SwarmData; // data.data of the SINGLE_GAME_VIEW reply in loadRecording("match-31321159-frames.json") (t=2654, 613 markets), "31321159" → gameId
  export const RECORDED_GAME_IDS: readonly number[]; // the 20 listing ids in listing (ascending) order, below
  export function retarget(events: RecordedSwarmEvent[], id: number): RecordedSwarmEvent[]; // scraper-flow.test.ts:20-24, moved here
  export function browserOfferPage(): FakeSwarmPage; // /538 → league recording; any other URL → retarget(match recording, its trailing id)
  export function loadFixtureText(fileName: string): string;   // readFileSync of __tests__/fixtures/<fileName>
  ```
  `RECORDED_GAME_IDS = [31321159, 31333512, 31333513, 31333514, 31333515, 31340647, 31340648, 31340664, 31340665, 31340666, 31419243, 31419244, 31419245, 31419246, 31419296, 31419297, 31419298, 31419299, 31419300, 31419348]`. These are the ids of the recorded GameList (checked 2026-11-13). JS iterates integer-like object keys ascending, so this is also `parseSwarmDataForFullOffer`'s order.

- [ ] **Step 1: Write the failing test.**
```ts
it("bookmakers/index keeps BetcrisPlaywrightScraper as an alias of BetcrisBrowserScraper (test-scrapers.sh, scraper-flow.test.ts)", async () => {
  const all: any = await import("../../index.js"); const b: any = await import("../index.js");
  expect(b.BetcrisBrowserScraper).toBeDefined();
  expect(b.BetcrisPlaywrightScraper).toBe(b.BetcrisBrowserScraper);
  expect(all.BetcrisPlaywrightScraper).toBe(b.BetcrisBrowserScraper);
  expect(all.betcrisScraper).toBe(b.betcrisScraper);
});
```
- [ ] **Step 2: Run and confirm it fails.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/browser-class.test.ts` → FAIL (`BetcrisBrowserScraper` undefined).
- [ ] **Step 3: Implement** the move, rename and re-exports; move `retarget` from `scraper-flow.test.ts:20-24` into `swarm-fixtures.ts` and import it there.
- [ ] **Step 4: Run and confirm.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris && $HEAVY npx tsc --noEmit && $HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run` → green; scraper-flow unchanged.
- [ ] **Step 5: Commit.**
```bash
git add -A src/scrapers/bookmakers/betcris src/scrapers/bookmakers/index.ts
git commit -m "refactor(betcris): browser class becomes BetcrisBrowserScraper behind the legacy alias"
```

### Task B2: Extract the pure Swarm-game → `FullMatchOffer` mapping (`swarm-offer.ts`)

**Files:**
- Create: `src/scrapers/bookmakers/betcris/swarm-offer.ts`
- Modify: `src/scrapers/bookmakers/betcris/browser-scraper.ts`. Only the success branch, `index.ts:297-335` before the move (richest-copy search, parse, push, per-match log), becomes one `buildBetcrisMatchOffer` call. The breaker (`:281-294`), `consecutiveFailures = 0` (`:296`), `delay(100)` (`:338`), the `catch` (`:339-344`) and the aborted result (`:352-362`) stay.
- Modify: `src/scrapers/bookmakers/betcris/navigation.ts:692-701`: the body moves to `swarm-offer.ts`, and `navigation.ts` keeps `export { buildEventUrl } from "./swarm-offer.js"`.
- Test: `src/scrapers/bookmakers/betcris/__tests__/swarm-offer.test.ts`, plus one test in `scraper-flow.test.ts`

**Interfaces:**
- Consumes: `parseAllMarkets`, `parseSwarmDataForFullOffer` (`parser.ts:388`, `:628`), `getCanonicalTeamName` (`src/utils/team-matcher.ts`), `BASE_URL` (`constants.ts:11`), `FullMatchOffer` (`src/types/full-offer.ts`).
- Produces:
  ```ts
  export type BetcrisListingEntry = ReturnType<typeof parseSwarmDataForFullOffer>[number]; // { game, teams, regionAlias, competitionId }
  export function buildEventUrl(regionAlias: string, competitionId: number, gameId: number): string;
  export function findGameInSwarmData(data: SwarmData, gameId: number): SwarmGame | null; // copy with the most markets; first wins ties
  export function buildBetcrisMatchOffer(entry: BetcrisListingEntry, detail: SwarmData, league: string, scrapedAt: Date): FullMatchOffer | null;
  // game = the detail copy if it has strictly more markets than entry.game, else entry.game (index.ts:297-308);
  // markets = parseAllMarkets(game, entry.teams); none → null; matchId = String(entry.game.id);
  // home/away = getCanonicalTeamName(entry.teams.*, league); eventUrl = buildEventUrl(entry.regionAlias, entry.competitionId, entry.game.id);
  // startTime = game.start_ts ? new Date(game.start_ts * 1000).toISOString() : undefined   (index.ts:328)
  ```

- [ ] **Step 1: Write the failing tests.** In `swarm-offer.test.ts`: `const entries = parseSwarmDataForFullOffer(recordedListing(), "premier-league", 538)` and `const at = new Date("2026-11-07T02:00:00.000Z")`.
```ts
it("buildBetcrisMatchOffer: maps recorded game 31321159 as the browser loop did", () => {
  const offer = buildBetcrisMatchOffer(entries[0], recordedGame(31321159), "premier-league", at)!;
  expect(offer).toMatchObject({ matchId: "31321159", bookmaker: "betcris", homeTeam: "Everton", awayTeam: "Coventry City", scrapedAt: at,
    eventUrl: "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538/31321159", startTime: "2026-11-06T20:00:00.000Z" });
  expect(offer.markets).toEqual(parseAllMarkets(findGameInSwarmData(recordedGame(31321159), 31321159)!, entries[0].teams));
  expect(offer.markets.length).toBeGreaterThan(600);     // 613 Swarm markets; the ladder split only adds entries
  expect(offer.markets.find((m) => m.bookmakerMarketId === "P1XP2")!.selections.map((s) => [s.name, s.odds])).toEqual([["  W1", 1.67], ["Remis", 4.1], ["W2", 5.5]]);
});
it("buildBetcrisMatchOffer: keeps the listing game when the detail has no richer copy", () => {
  expect(buildBetcrisMatchOffer(entries[0], {}, "premier-league", at)!.markets.map((m) => m.bookmakerMarketId)).toEqual(["P1XP2"]);
});
it("buildBetcrisMatchOffer: returns null when the chosen game has no markets", () => {
  expect(buildBetcrisMatchOffer({ ...entries[0], game: { ...entries[0].game, market: {} } }, {}, "premier-league", at)).toBeNull();
});
it("findGameInSwarmData: richest copy of the id, null when absent", () => {
  const rich = findGameInSwarmData(recordedGame(31321159), 31321159)!;
  const tree = (games: Record<string, SwarmGame>): SwarmData => ({ sport: { "1": { id: 1, name: "", alias: "Soccer", region: { "2": { id: 2, name: "", alias: "England",
    competition: { "538": { id: 538, name: "", game: games } } } } } } });
  expect(findGameInSwarmData(tree({ a: entries[0].game, b: rich }), 31321159)).toBe(rich);
  expect(findGameInSwarmData(tree({ a: rich, b: entries[0].game }), 31321159)).toBe(rich);
  expect(findGameInSwarmData(recordedGame(31321159), 99999999)).toBeNull();
});
it("buildEventUrl: keeps the stored www.betcris.pl form although the site redirects to betsport.pl", () => {
  expect(buildEventUrl("England", 538, 31321159)).toBe("https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538/31321159");
});
```
In `scraper-flow.test.ts`:
```ts
it("betcris scrapeFullOffer: every offer equals buildBetcrisMatchOffer on the same recorded payloads", async () => {
  useFakeBrowser(browserOfferPage());
  const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
  const strip = ({ scrapedAt: _s, ...m }: FullMatchOffer) => m;
  const expected = parseSwarmDataForFullOffer(recordedListing(), "premier-league", 538)
    .map((e) => strip(buildBetcrisMatchOffer(e, recordedGame(e.game.id), "premier-league", new Date())!));
  expect(r.matches.map((m) => m.matchId)).toEqual(RECORDED_GAME_IDS.map(String));
  expect(r.matches.map(strip)).toEqual(expected);
});
```
Since Part A, each per-game capture ends on the t=2654 SGV reply, so the browser union equals that reply's game.
- [ ] **Step 2: Run and confirm they fail.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/swarm-offer.test.ts src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts` → FAIL: `Cannot find module '../swarm-offer.js'`.
- [ ] **Step 3: Implement** `swarm-offer.ts`. In the browser loop, replace the success branch with:
  - `const offer = buildBetcrisMatchOffer({ game, teams, regionAlias, competitionId: compId }, matchWsData, leagueSlug, new Date());`
  - ``if (offer) { matches.push(offer); console.log(`[Betcris/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${offer.markets.length} markets`); }``

  Move `buildEventUrl`.
- [ ] **Step 4: Run and confirm they pass.** Same command → green. Then `$HEAVY npx vitest run src/services/normalization/__tests__/golden.test.ts -t betcris && $HEAVY npx tsc --noEmit && $HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run`.
- [ ] **Step 5: Commit.**
```bash
git add src/scrapers/bookmakers/betcris/swarm-offer.ts src/scrapers/bookmakers/betcris/browser-scraper.ts src/scrapers/bookmakers/betcris/navigation.ts src/scrapers/bookmakers/betcris/__tests__/swarm-offer.test.ts src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts src/scrapers/bookmakers/betcris/__tests__/helpers/swarm-fixtures.ts
git commit -m "refactor(betcris): pure Swarm game to FullMatchOffer mapping shared by both transports"
```

### Task B3: `partnerConfigs` bootstrap with an in-memory cache

**Files:**
- Modify: `src/scrapers/bookmakers/betcris/constants.ts` (append at the end, after `WS_CONFIG`)
- Create: `src/scrapers/bookmakers/betcris/swarm-config.ts`, `__tests__/fixtures/swarm/partner-configs.html`
- Test: `src/scrapers/bookmakers/betcris/__tests__/swarm-config.test.ts`

**Interfaces:**
- Consumes: §3 `HttpClient.getText(url, { timeoutMs, signal })` and the `HttpError` messages. In tests: §3 `createReplayHttpClient` and plan 02's `httpStatusError(url, status, contentType, body, cfMitigated?)`. A replay route has no headers, so the Cloudflare case routes that error, as plan 02 Task 3 prescribes.
- Produces:
  ```ts
  // constants.ts
  export const SWARM_TRANSPORT = {
    PARTNER_CONFIG_URL: "https://www.betsport.pl/", PARTNER_CONFIG_TIMEOUT_MS: 10_000,
    PARTNER_CONFIG_TTL_MS: 6 * 60 * 60 * 1000, PARTNER_CONFIG_FAILURE_TTL_MS: 10 * 60 * 1000,
    FALLBACK_SITE_ID: "1874631", FALLBACK_SOCKET_URL: "wss://eu-swarm-springre.trexname.com/",
    ORIGIN: "https://www.betcris.pl", LANGUAGE: "pol", SOURCE: 42,
    CONNECT_TIMEOUT_MS: 5_000, SESSION_TIMEOUT_MS: 5_000, LISTING_TIMEOUT_MS: 10_000, GAME_TIMEOUT_MS: 10_000,
    GAME_CONCURRENCY: 4, OPEN_ATTEMPTS: 2, OPEN_RETRY_DELAY_MS: 1_000,
  } as const;
  // swarm-config.ts
  export interface SwarmPartnerConfig { siteId: string; socketUrl: string }
  export interface ResolvedSwarmConfig extends SwarmPartnerConfig { source: "page" | "fallback" }
  export function parsePartnerConfigs(html: string): SwarmPartnerConfig | null;
  // the line matching /partnerConfigs\s*=\s*(\{.*\})\s*;?\s*$/m → JSON.parse; socketUrl = swarmUrl (must match ^wss://), siteId = String(springConfig.partnerId) (must match ^\d+$); else null
  export interface SwarmPartnerConfigCache { get(signal?: AbortSignal): Promise<ResolvedSwarmConfig>; invalidate(): void }
  export function createSwarmPartnerConfigCache(http: HttpClient): SwarmPartnerConfigCache;
  // one in-flight promise shared by concurrent callers; "page" result cached PARTNER_CONFIG_TTL_MS, "fallback" cached PARTNER_CONFIG_FAILURE_TTL_MS
  // fallback warn: `[Betcris/Swarm] partnerConfigs unusable (${reason}); using fallback site_id=1874631 socket=wss://eu-swarm-springre.trexname.com/`
  //   reason = the HttpError message (incl. plan 02's " cf-mitigated=<value>" suffix), or `no usable partnerConfigs in ${PARTNER_CONFIG_URL}`
  // GET: http.getText(PARTNER_CONFIG_URL, { timeoutMs: PARTNER_CONFIG_TIMEOUT_MS, signal }) - default retries (1)
  ```

- [ ] **Step 1: Write the failing tests.** The fixture is the `<script>` block of the recorded betcris.pl page (9 154 B). It names the ws-re socket, which keeps the parser host-agnostic. Extract it by absolute path: `sed -n '401,404p' $REPO/docs/superpowers/plans/2026-11-07-scraper-performance/evidence/betcris-pzbuk/body_www.betcris.pl.html > src/scrapers/bookmakers/betcris/__tests__/fixtures/swarm/partner-configs.html`.

  The tests use fake timers with `vi.setSystemTime(new Date("2026-11-07T02:00:00Z"))`, `PAGE = "https://www.betsport.pl/"`, `HTML = loadFixtureText("swarm/partner-configs.html")` and `FALLBACK = { siteId: "1874631", socketUrl: "wss://eu-swarm-springre.trexname.com/", source: "fallback" }`.
```ts
it("parsePartnerConfigs reads site id and socket URL from the recorded page", () => {
  expect(parsePartnerConfigs(HTML)).toEqual({ siteId: "1874631", socketUrl: "wss://eu-swarm-ws-re.trexname.com/" });
});
it.each([
  ["no partnerConfigs", "<html><head></head></html>"],
  ["invalid JSON", HTML.replace('{"pageParams"', '{pageParams')],
  ["non-wss socket", HTML.replace('"swarmUrl":"wss:', '"swarmUrl":"https:')],
  ["non-numeric partner id", HTML.replace('"partnerId":"1874631"', '"partnerId":"x"')],
  ["missing springConfig", HTML.replace('"springConfig"', '"springConfigX"')],
])("parsePartnerConfigs returns null: %s", (_label, html) => expect(parsePartnerConfigs(html)).toBeNull());
it("cache: one shared GET, reused for 6 h, refetched after", async () => {
  const http = createReplayHttpClient({ [PAGE]: { body: HTML, contentType: "text/html; charset=utf-8" } });
  const cache = createSwarmPartnerConfigCache(http);
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  expect(a).toEqual({ siteId: "1874631", socketUrl: "wss://eu-swarm-ws-re.trexname.com/", source: "page" });
  expect(b).toEqual(a);
  expect(http.calls).toEqual([PAGE]);
  vi.setSystemTime(Date.now() + 6 * 3600_000 - 1); await cache.get(); expect(http.calls).toHaveLength(1);
  vi.setSystemTime(Date.now() + 2); await cache.get(); expect(http.calls).toHaveLength(2);
});
it("cache: HTTP 404 → fallback constants, one warn line, retried after 10 min", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const http = createReplayHttpClient({ [PAGE]: { status: 404, body: "" } });
  const cache = createSwarmPartnerConfigCache(http);
  expect(await cache.get()).toEqual(FALLBACK);
  expect(await cache.get()).toEqual(FALLBACK);
  expect(http.calls).toHaveLength(1);
  expect(warn.mock.calls.map(([m]) => m)).toEqual([`[Betcris/Swarm] partnerConfigs unusable (fetch HTTP 404 ${PAGE}); using fallback site_id=1874631 socket=wss://eu-swarm-springre.trexname.com/`]);
  vi.setSystemTime(Date.now() + 10 * 60_000 + 1); await cache.get(); expect(http.calls).toHaveLength(2);
});
it("cache: a Cloudflare challenge on the page → fallback naming cf-mitigated", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const cache = createSwarmPartnerConfigCache(createReplayHttpClient({ [PAGE]: httpStatusError(PAGE, 403, "text/html", "", "challenge") }));
  expect(await cache.get()).toEqual(FALLBACK);
  expect(String(warn.mock.calls[0][0])).toContain(`(fetch HTTP 403 ${PAGE} cf-mitigated=challenge)`);
});
it("cache: a page without usable partnerConfigs → fallback with the reason", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const cache = createSwarmPartnerConfigCache(createReplayHttpClient({ [PAGE]: { body: "<html></html>", contentType: "text/html" } }));
  expect(await cache.get()).toEqual(FALLBACK);
  expect(String(warn.mock.calls[0][0])).toContain(`(no usable partnerConfigs in ${PAGE})`);
});
it("cache: invalidate() forces the next get() to refetch", async () => {
  const http = createReplayHttpClient({ [PAGE]: { body: HTML, contentType: "text/html" } });
  const cache = createSwarmPartnerConfigCache(http);
  await cache.get(); cache.invalidate(); await cache.get();
  expect(http.calls).toEqual([PAGE, PAGE]);
});
```
- [ ] **Step 2: Run and confirm they fail.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/swarm-config.test.ts` → FAIL: `Cannot find module '../swarm-config.js'`.
- [ ] **Step 3: Implement** `SWARM_TRANSPORT`, `parsePartnerConfigs` and `createSwarmPartnerConfigCache` as specified.
- [ ] **Step 4: Run and confirm they pass.** Same command → 11 passed (6 `it` + 5 `it.each` rows). Then `$HEAVY npx tsc --noEmit && $HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run`.
- [ ] **Step 5: Commit.**
```bash
git add src/scrapers/bookmakers/betcris/constants.ts src/scrapers/bookmakers/betcris/swarm-config.ts src/scrapers/bookmakers/betcris/__tests__/swarm-config.test.ts src/scrapers/bookmakers/betcris/__tests__/fixtures/swarm/partner-configs.html
git commit -m "feat(betcris): read Swarm site id and socket from partnerConfigs, cached with fallback"
```

### Task B4: Rid-matched Swarm client over `WsSession` (`swarm-client.ts`)

§3 `WsSession` exposes `send` and a frame-reducing `collect`, and plan 02 allows only one `collect` at a time; it has no request/response.
- This client therefore runs **one** `collect` for the lifetime of the session, as a dispatcher. Its reducer parses each text frame and settles the pending request with the same `rid`.
- `done` turns true only after `close()`, and its timeout is `budget.remainingMs()`.
- The dispatcher starts right after `openWsSession` resolves. Plan 02 buffers earlier frames anyway, so none is lost.
- Per-request timeouts are plain `setTimeout`s.
- The budget is never listened to directly (plan 02 rule). A budget abort reaches pending requests as the dispatcher's `BudgetExceededError` rejection.

**Files:**
- Create: `src/scrapers/bookmakers/betcris/swarm-client.ts`, `__tests__/helpers/fake-swarm-session.ts`, `__tests__/fixtures/swarm/session-reply.json`
- Modify: `__tests__/helpers/swarm-fixtures.ts` (add `projectSwarmData`)
- Test: `src/scrapers/bookmakers/betcris/__tests__/swarm-client.test.ts`

**Interfaces:**
- Consumes: §3 `openWsSession`, `WsSession`, `WsSessionOptions`, `ScrapeBudget` (`checkpoint`, `remainingMs`), `createScrapeBudget`, `BudgetExceededError`; plan 02 `DEFAULT_USER_AGENT`; `SWARM_TRANSPORT`, `SwarmPartnerConfig` (Task B3); `findGameInSwarmData` (Task B2); `parseAllMarkets`, `parseTeamNames`, `parseSwarmDataForFullOffer`.
- Produces:
  ```ts
  export type SwarmLevel = "sport" | "region" | "competition" | "game" | "market" | "event";
  export type SwarmWhat = Readonly<Record<SwarmLevel, readonly string[]>>;
  export const SWARM_WHAT: SwarmWhat = {
    sport: ["id", "name", "alias"], region: ["id", "name", "alias"], competition: ["id", "name"],
    game: ["id", "team1_name", "team2_name", "team1_id", "team2_id", "start_ts", "markets_count", "is_blocked", "game_number"],
    market: ["id", "name", "type", "order", "base", "col_count"],
    event: ["id", "name", "price", "order", "type_1", "base"],
  };
  export function swarmListingParams(competitionId: number): Record<string, unknown>;
  // { source: "betting", what: SWARM_WHAT, where: { sport: { alias: "Soccer" }, competition: { id }, game: { "@or": [{ type: { "@in": [0, 2] } }, { visible_in_prematch: 1 }] }, market: { type: "P1XP2" } }, subscribe: false }
  export function swarmGameParams(gameId: number): Record<string, unknown>;
  // { source: "betting", what: SWARM_WHAT, where: { game: { id } }, subscribe: false }
  export const SWARM_WS_HEADERS: Readonly<Record<string, string>>; // { origin: SWARM_TRANSPORT.ORIGIN, "user-agent": DEFAULT_USER_AGENT }
  export interface SwarmReply { code: number; rid: string; msg?: string; data?: { data?: SwarmData } }
  export interface SwarmClient {
    readonly url: string;
    readonly stats: { framesReceived: number; bytesReceived: number; nonJsonFrames: number }; // the two WsSession counters + our own
    request(command: string, params: Record<string, unknown>, timeoutMs: number): Promise<SwarmReply>;
    close(): Promise<void>; // idempotent; never rejects (live: our own close reports 1006; plan 02 terminates after 1 000 ms)
  }
  export function openSwarmClient(config: SwarmPartnerConfig, budget: ScrapeBudget, openSession?: typeof openWsSession): Promise<SwarmClient>;
  // opens { url: config.socketUrl, headers: SWARM_WS_HEADERS, budget, connectTimeoutMs: CONNECT_TIMEOUT_MS }, starts the dispatcher,
  // then request("request_session", { language: "pol", site_id: config.siteId, source: 42 }, SESSION_TIMEOUT_MS); on failure closes the session and rethrows
  ```
  Errors, with `url` = the socket URL:
  - `budget.checkpoint()` runs before each send and throws `BudgetExceededError`.
  - A per-request timeout gives `ws timeout ${timeoutMs}ms ${url}` (§3).
  - A non-zero `code` gives `swarm ${command} code ${code} ${url}`.
  - When the dispatcher `collect` rejects, its error becomes sticky for every pending and later `request`: either `ws closed ${code} ${url}` (§3) or plan 02's `BudgetExceededError`.
  - When `collect` resolves `timedOut`, the sticky error is `ws timeout ${ms}ms ${url}`.
  - A throw from `session.send` rejects that request with the thrown error.
  - Once `close()` has been called, the dispatcher's outcome is ignored.
  - Rids are `r1`, `r2`, …, never `"0"`, which Swarm uses for deltas. Frames with an unknown rid are dropped; non-JSON frames are counted.

  Test helpers:
  ```ts
  // swarm-fixtures.ts
  export function projectSwarmData(data: SwarmData, what: SwarmWhat): SwarmData; // per level keep only the requested keys (+ the child map)
  // fake-swarm-session.ts
  export interface FakeSwarmRequest { command: string; params: any; rid: string }
  export type FakeSwarmAnswer = string | { frame: string; delayMs: number } | "silent" | { closeCode: number };
  export interface FakeSwarm { open: typeof openWsSession; opened: WsSessionOptions[]; sent: FakeSwarmRequest[]; closed: number; maxInFlight: number }
  export function createFakeSwarm(answer: (req: FakeSwarmRequest) => FakeSwarmAnswer, opts?: { openErrors?: Error[] }): FakeSwarm;
  export function recordedAnswer(opts?: { override?: (req: FakeSwarmRequest) => FakeSwarmAnswer | undefined; delayMs?: (req: FakeSwarmRequest) => number }): (req: FakeSwarmRequest) => FakeSwarmAnswer;
  ```
  The fake's semantics mirror plan 02 Task 8:
  - `open` records its options. It rejects with the next `openErrors` entry if there is one, or with `opts.budget.checkpoint()`'s error when the budget is already aborted. Otherwise it resolves a session.
  - The session listens on `AbortSignal.any([opts.budget.signal])`. On abort it rejects the active `collect` with the error `opts.budget.checkpoint()` throws.
  - A second concurrent `collect` rejects with `ws collect already active`.
  - `send` parses the frame, records it, tracks in-flight requests (sent and not yet answered) and `maxInFlight`, then applies `answer`:
    - a string is delivered after 5 ms, `{frame, delayMs}` after `delayMs`;
    - `"silent"` is never answered;
    - `{closeCode}` rejects the active `collect` after 5 ms with `ws closed ${closeCode} ${url}`.
  - Delivery runs the reducer with `Buffer.from(frame)` and updates `stats` (`framesReceived`, `bytesReceived`).
  - `collect` resolves `{ timedOut: true }` on its timeout. `close()` increments `closed` and resolves the active `collect`.
  - `recordedAnswer`:
    - `request_session` → `session-reply.json` with the request's rid;
    - `get` with `where.competition.id === 538` → `{code:0, rid, data:{data: projectSwarmData(recordedListing(), params.what)}}`;
    - `get` with `where.game.id` → the same shape with `recordedGame(id)`;
    - anything else → `{code:0, rid, data:{data:{}}}`;
    - delay `opts.delayMs?.(req) ?? 5`; `override` wins when it returns a value.

- [ ] **Step 1: Write the failing tests.** The fixture is the recorded `request_session` reply from the **tracked** recording, trimmed to `code`/`rid`/`ctx`/`sid` (2 754 B → about 174 B):
```bash
$HEAVY python3 -I - src/scrapers/bookmakers/betcris/__tests__/fixtures/league-538-frames.json src/scrapers/bookmakers/betcris/__tests__/fixtures/swarm/session-reply.json <<'EOF'
import json, sys
m = next(json.loads(e["payload"]) for e in json.load(open(sys.argv[1]))["events"] if e["kind"] == "recv" and '"request_session' in e["payload"])
json.dump({"code": m["code"], "rid": m["rid"], "data": {"ctx": m["data"]["ctx"], "sid": m["data"]["sid"]}}, open(sys.argv[2], "w"), separators=(",", ":"))
EOF
```
All tests use fake timers. `CFG = { siteId: "1874631", socketUrl: "wss://eu-swarm-ws-re.trexname.com/" }`, `WS = CFG.socketUrl`, `game = (q) => q.params?.where?.game?.id as number | undefined`.
```ts
it("openSwarmClient: opens with origin/user-agent and sends request_session with the site id first", async () => {
  const fake = createFakeSwarm(recordedAnswer());
  const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
  expect(fake.opened[0]).toMatchObject({ url: WS, connectTimeoutMs: 5000 });
  expect(fake.opened[0].headers).toEqual({ origin: "https://www.betcris.pl", "user-agent": DEFAULT_USER_AGENT });
  expect(fake.sent).toEqual([expect.objectContaining({ command: "request_session", params: { language: "pol", site_id: "1874631", source: 42 } })]);
  await client.close(); await client.close();
  expect(fake.closed).toBe(1);
});
it("param builders: listing and game requests carry SWARM_WHAT and never subscribe", () => {
  expect(swarmListingParams(538)).toEqual({ source: "betting", what: SWARM_WHAT, subscribe: false, where: { sport: { alias: "Soccer" }, competition: { id: 538 },
    game: { "@or": [{ type: { "@in": [0, 2] } }, { visible_in_prematch: 1 }] }, market: { type: "P1XP2" } } });
  expect(swarmGameParams(31321159)).toEqual({ source: "betting", what: SWARM_WHAT, where: { game: { id: 31321159 } }, subscribe: false });
});
it("SWARM_WHAT covers every field parser.ts reads (incl. the ladder split): the projected recorded payloads parse identically", () => {
  const full = findGameInSwarmData(recordedGame(31321159), 31321159)!;
  const proj = findGameInSwarmData(projectSwarmData(recordedGame(31321159), SWARM_WHAT), 31321159)!;
  const parsed = parseAllMarkets(proj, parseTeamNames(proj));
  expect(parsed).toEqual(parseAllMarkets(full, parseTeamNames(full)));
  expect(parsed.length).toBeGreaterThan(600);
  expect(parseSwarmDataForFullOffer(projectSwarmData(recordedListing(), SWARM_WHAT), "premier-league", 538)).toEqual(
    parseSwarmDataForFullOffer(recordedListing(), "premier-league", 538).map((e) => ({ ...e, game: findGameInSwarmData(projectSwarmData(recordedListing(), SWARM_WHAT), e.game.id) })));
});
it("matches replies to requests by rid with 4 in flight, answered in reverse order", async () => {
  const ids = RECORDED_GAME_IDS.slice(0, 4);
  const fake = createFakeSwarm(recordedAnswer({ delayMs: (q) => (game(q) ? 100 - 20 * ids.indexOf(game(q)!) : 5) }));
  const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
  const replies = await settle(Promise.all(ids.map((id) => client.request("get", swarmGameParams(id), 10_000))));
  expect(replies.map((r, i) => findGameInSwarmData(r.data!.data!, ids[i])?.id)).toEqual(ids);
  expect(fake.maxInFlight).toBe(4);
});
it("a timed-out request rejects alone and its late reply is ignored", async () => {
  const fake = createFakeSwarm(recordedAnswer({ delayMs: (q) => (game(q) === 31333513 ? 15_000 : 5) }));
  const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
  const slow = client.request("get", swarmGameParams(31333513), 10_000);
  const ok = client.request("get", swarmGameParams(31333512), 10_000);
  await expect(settle(ok)).resolves.toMatchObject({ code: 0 });
  await expect(settle(slow)).rejects.toThrow(`ws timeout 10000ms ${WS}`);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(client.stats.framesReceived).toBe(3); // session, 31333512, and the late 31333513 frame (dropped)
});
it("a non-zero Swarm code rejects with command and code", async () => {
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => (game(q) ? JSON.stringify({ code: 12, rid: q.rid, msg: "x" }) : undefined) }));
  const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
  await expect(settle(client.request("get", swarmGameParams(31333512), 10_000))).rejects.toThrow(`swarm get code 12 ${WS}`);
});
it("a dropped socket rejects every pending request and every later one", async () => {
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => (game(q) === 31333514 ? { closeCode: 1006 } : undefined), delayMs: (q) => (game(q) ? 1_000 : 5) }));
  const client = await settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open));
  const pending = [31333512, 31333513, 31333514].map((id) => client.request("get", swarmGameParams(id), 10_000));
  for (const p of pending) await expect(settle(p)).rejects.toThrow(`ws closed 1006 ${WS}`);
  await expect(settle(client.request("get", swarmGameParams(31333515), 10_000))).rejects.toThrow(`ws closed 1006 ${WS}`);
});
it("openSwarmClient rejects and closes the session when request_session fails", async () => {
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => (q.command === "request_session" ? JSON.stringify({ code: 1, rid: q.rid }) : undefined) }));
  await expect(settle(openSwarmClient(CFG, createScrapeBudget(120_000), fake.open))).rejects.toThrow(`swarm request_session code 1 ${WS}`);
  expect(fake.closed).toBe(1);
});
it("a budget abort rejects pending and later requests with BudgetExceededError, without a listener of our own", async () => {
  const parent = new AbortController(); const budget = createScrapeBudget(120_000, parent.signal);
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => (game(q) ? "silent" : undefined) }));
  const client = await settle(openSwarmClient(CFG, budget, fake.open));
  const add = vi.spyOn(budget.signal, "addEventListener");
  const p = client.request("get", swarmGameParams(31333512), 10_000);
  parent.abort(new Error("shutdown"));
  await expect(settle(p)).rejects.toThrow(new BudgetExceededError("scrape aborted: shutdown"));
  await expect(settle(client.request("get", swarmGameParams(31333513), 10_000))).rejects.toThrow("scrape aborted: shutdown");
  expect(add).not.toHaveBeenCalled();
});
```
- [ ] **Step 2: Run and confirm they fail.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/swarm-client.test.ts` → FAIL: `Cannot find module '../swarm-client.js'`.
- [ ] **Step 3: Implement** `swarm-client.ts`, `projectSwarmData` and `fake-swarm-session.ts` as specified.
- [ ] **Step 4: Run and confirm they pass.** Same command → 9 passed. Then `$HEAVY npx tsc --noEmit && $HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run`.
- [ ] **Step 5: Commit.**
```bash
git add src/scrapers/bookmakers/betcris/swarm-client.ts src/scrapers/bookmakers/betcris/__tests__/swarm-client.test.ts src/scrapers/bookmakers/betcris/__tests__/helpers src/scrapers/bookmakers/betcris/__tests__/fixtures/swarm/session-reply.json
git commit -m "feat(betcris): rid-matched Swarm request client on the shared WsSession"
```

### Task B5: `BetcrisSwarmScraper`

**Files:**
- Create: `src/scrapers/bookmakers/betcris/swarm-scraper.ts`
- Test: `src/scrapers/bookmakers/betcris/__tests__/swarm-scraper.test.ts`

**Interfaces:**
- Consumes:
  - §3 / plan 02: `FullOfferScraper`, `TransportStats`, `TransportStatsSource`, `hasTransportStats`, `DEFAULT_MAX_DURATION_MS.websocket`, `ScrapeBudget`, `createScrapeBudget`, `fetchDetailsSkippingFailures` (whose `fetched`/`skipped` keep **input order**, plan 02 Task 4), `MAX_SKIPPED_DETAIL_RATIO`, `HttpClient`, `createHttpClient`, `openWsSession`; plan 07 `DeclaresTransport` (duck type).
  - Tasks B2–B4: `buildBetcrisMatchOffer`, `findGameInSwarmData`, `createSwarmPartnerConfigCache`, `openSwarmClient`, `swarmListingParams`, `swarmGameParams`, `SWARM_TRANSPORT`.
  - `parseSwarmDataForFullOffer`, `COMPETITION_IDS`, `isLeagueSupported` (`src/config/leagues.ts:178`).
- Produces:
  ```ts
  export interface BetcrisSwarmDeps { http?: HttpClient; openSession?: typeof openWsSession }
  export class BetcrisSwarmScraper implements FullOfferScraper, TransportStatsSource {
    readonly bookmaker: PolishBookmaker = "betcris";
    readonly transport = "websocket" as const;   // plan 07 DeclaresTransport (cross-plan #19)
    constructor(deps?: BetcrisSwarmDeps);  // owns one SwarmPartnerConfigCache → per-process cache via the betcrisScraper singleton
    scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult>;
    transportStats(): TransportStats;      // { http: copy of this.http.stats, ws: { framesReceived, bytesReceived } }: CUMULATIVE since construction (README §3: monotonic; consumers diff); each closed session adds to the running total; zeros before the first session
    cleanup(): Promise<void>;              // no-op: each call closes its own socket
  }
  ```
  Flow (the result fields follow plan 02's `HttpScraper` template; `duration` is always set):
  1. Unsupported league → `{ success:false, matches:[], error:"Unknown league: <league>" }`, with no network.
  2. `budget ??= createScrapeBudget(DEFAULT_MAX_DURATION_MS.websocket)`.
  3. Up to `OPEN_ATTEMPTS`: `budget.checkpoint()`, `config = await cache.get(budget.signal)`, `openSwarmClient(config, budget, openSession)`. A failed open calls `cache.invalidate()` and sleeps `OPEN_RETRY_DELAY_MS` (a plain `setTimeout`, followed by `budget.checkpoint()`).
  4. The listing reply goes through `parseSwarmDataForFullOffer(reply.data?.data ?? {}, league, competitionId)`. An empty listing gives `success:true, matches:[]` (README §3 empty-listing rule).
  5. `fetchDetailsSkippingFailures(entries, (e) => String(e.game.id), fetchGame, { concurrency: GAME_CONCURRENCY, budget })`. `fetchGame` requests `swarmGameParams(id)` with `GAME_TIMEOUT_MS`. It throws `swarm game ${id} missing from reply` when `findGameInSwarmData` is null, else returns `buildBetcrisMatchOffer(e, data, league, new Date())`. Because the mapping runs inside the callback, no raw payload outlives its game.
  6. `matches` = the non-null offers of `fetched`, in listing order. A `null` offer (0 markets) is dropped silently, as in the browser path.
  7. With `n = skipped.length` and `m = fetched.length + n`: if `n > 0`, `error = "${n} of ${m} details failed | ${skipped[0].error}"`, logged `console.warn("[betcris] " + error)`. If `n / m > MAX_SKIPPED_DETAIL_RATIO`, return `success:false` with `matches:[]`; otherwise return `success:true` and keep the error.
  8. Any throw in steps 3–4 (open or listing) → `success:false`, `matches:[]`, `error` = its message, `console.error("[betcris] Full offer scraper error: " + error)`.
  9. `finally`: add the session counters to the running totals, then `void client?.close()`. The close is not awaited, so a server that ignores our close frame (live: 1006) cannot add plan 02's 1 000 ms terminate delay to the result.

  Log lines:
  - `console.log("[Betcris/FullOffer] Found ${n} games for ${league}")`;
  - per offer, in listing order: `console.log("[Betcris/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets")`;
  - per skipped game: `console.warn("[Betcris/FullOffer] Skipped game ${id} (${home} vs ${away}): ${error}")`;
  - `console.log("[Betcris/FullOffer] Completed: ${m} matches, ${k} total markets")`;
  - when `success:true`: `console.log("[Betcris] capture ok: transport=swarm, games=${n}, fetched=${m}, skipped=${s}, connectMs=${c}, listingMs=${l}, totalMs=${t}, frames=${ws.framesReceived}, bytes=${ws.bytesReceived}, config=${source}")`. `connectMs` covers bootstrap, open and session; `listingMs` is the listing request; `totalMs` is the whole call.

- [ ] **Step 1: Write the failing tests.** Fake timers; `console.log`, `console.warn` and `console.error` mocked.
  - `PAGE = "https://www.betsport.pl/"`, `WS = "wss://eu-swarm-ws-re.trexname.com/"`.
  - `http = () => createReplayHttpClient({ [PAGE]: { body: loadFixtureText("swarm/partner-configs.html"), contentType: "text/html; charset=utf-8" } })`.
  - `isGame = (q) => q.command === "get" && q.params?.where?.game?.id !== undefined`.
  - `scraper = (fake, h = http()) => new BetcrisSwarmScraper({ http: h, openSession: fake.open })`.
  - `perGame = parseAllMarkets(findGameInSwarmData(projectSwarmData(recordedGame(31321159), SWARM_WHAT), 31321159)!, parseSwarmDataForFullOffer(recordedListing(), "premier-league", 538)[0].teams).length`.
  - `warns = () => vi.mocked(console.warn).mock.calls.map(([m]) => String(m))`, `errors = () => vi.mocked(console.error).mock.calls.map(([m]) => String(m))`.
```ts
it("betcris swarm: scrapes the 20 recorded games over one socket with 4 game requests in flight", async () => {
  const fake = createFakeSwarm(recordedAnswer()); const h = http(); const s = scraper(fake, h);
  const r = await settle(s.scrapeFullOffer("premier-league"));
  expect(r).toMatchObject({ success: true, bookmaker: "betcris", league: "premier-league" }); expect(r.error).toBeUndefined();
  expect(s.transport).toBe("websocket");
  expect(r.matches.map((m) => m.matchId)).toEqual(RECORDED_GAME_IDS.map(String));
  expect(r.matches.map((m) => m.markets.length)).toEqual(Array(20).fill(perGame));
  expect(fake.sent.map((q) => q.command)).toEqual(["request_session", ...Array(21).fill("get")]);
  expect(fake.sent[1].params).toEqual(swarmListingParams(538));
  expect(fake.sent.filter(isGame).map((q) => q.params.where.game.id).sort()).toEqual([...RECORDED_GAME_IDS].sort());
  expect(fake.maxInFlight).toBe(4); expect(fake.closed).toBe(1); expect(fake.opened[0].url).toBe(WS);
  const logs = vi.mocked(console.log).mock.calls.map(([m]) => String(m));
  expect(logs).toContain("[Betcris/FullOffer] Found 20 games for premier-league");
  expect(logs.some((m) => /^\[Betcris\/FullOffer\] Everton vs Coventry\s+City: \d+ markets$/.test(m))).toBe(true);
  expect(logs.filter((m) => m.startsWith("[Betcris] capture ok:"))).toEqual([expect.stringMatching(
    /^\[Betcris\] capture ok: transport=swarm, games=20, fetched=20, skipped=0, connectMs=\d+, listingMs=\d+, totalMs=\d+, frames=22, bytes=\d+, config=page$/)]);
  expect(hasTransportStats(s)).toBe(true);
  expect(s.transportStats()).toEqual({ http: expect.objectContaining({ requests: 1, failures: 0 }), ws: { framesReceived: 22, bytesReceived: expect.any(Number) } });
  await settle(s.scrapeFullOffer("premier-league")); // second run: cached partnerConfigs, fresh socket, cumulative counters
  expect(h.calls).toEqual([PAGE]); expect(fake.opened).toHaveLength(2); expect(fake.closed).toBe(2);
  expect(s.transportStats().ws!.framesReceived).toBe(44);
});
it("betcris swarm: skips a game whose request times out, writes nothing for it and keeps the cause", async () => {
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => (isGame(q) && q.params.where.game.id === 31333513 ? "silent" : undefined) }));
  const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
  expect(r).toMatchObject({ success: true, error: `1 of 20 details failed | ws timeout 10000ms ${WS}` });
  expect(r.matches).toHaveLength(19); expect(r.matches.map((m) => m.matchId)).not.toContain("31333513");
  expect(warns()).toContain(`[Betcris/FullOffer] Skipped game 31333513 (Leeds vs Tottenham): ws timeout 10000ms ${WS}`);
  expect(warns()).toContain(`[betcris] 1 of 20 details failed | ws timeout 10000ms ${WS}`);
});
it("betcris swarm: skips a game missing from its reply instead of writing its listing copy", async () => {
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => (isGame(q) && q.params.where.game.id === 31333513 ? JSON.stringify({ code: 0, rid: q.rid, data: { data: {} } }) : undefined) }));
  const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
  expect(r.matches).toHaveLength(19);
  expect(warns()).toContain("[Betcris/FullOffer] Skipped game 31333513 (Leeds vs Tottenham): swarm game 31333513 missing from reply");
});
it.each([[10, true, 10], [11, false, 0]])("betcris swarm: %i of 20 silent games → success %s", async (n, ok, kept) => {
  const silent = new Set(RECORDED_GAME_IDS.slice(0, n));
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => (isGame(q) && silent.has(q.params.where.game.id) ? "silent" : undefined) }));
  const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
  expect(r).toMatchObject({ success: ok, error: `${n} of 20 details failed | ws timeout 10000ms ${WS}` });
  expect(r.matches).toHaveLength(kept);
});
it("betcris swarm: fails with the close cause when the socket drops before the listing reply", async () => {
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => (q.params?.where?.competition ? { closeCode: 1006 } : undefined) }));
  const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
  expect(r).toMatchObject({ success: false, matches: [], error: `ws closed 1006 ${WS}` });
  expect(fake.sent.filter(isGame)).toHaveLength(0); expect(fake.closed).toBe(1);
  expect(errors()).toContain(`[betcris] Full offer scraper error: ws closed 1006 ${WS}`);
});
it("betcris swarm: handshake fails twice → handshake cause, config re-read between attempts", async () => {
  const err = () => new Error(`ws handshake HTTP 403 ${WS}`);
  const fake = createFakeSwarm(recordedAnswer(), { openErrors: [err(), err()] }); const h = http(); const s = scraper(fake, h);
  const r = await settle(s.scrapeFullOffer("premier-league"));
  expect(r).toMatchObject({ success: false, matches: [], error: `ws handshake HTTP 403 ${WS}` });
  expect(fake.opened).toHaveLength(2); expect(h.calls).toEqual([PAGE, PAGE]);
  expect(s.transportStats().ws).toEqual({ framesReceived: 0, bytesReceived: 0 });
});
it("betcris swarm: recovers on the second open attempt", async () => {
  const fake = createFakeSwarm(recordedAnswer(), { openErrors: [new Error(`ws failed ECONNREFUSED ${WS}`)] });
  const r = await settle(scraper(fake).scrapeFullOffer("premier-league"));
  expect(r.success).toBe(true); expect(r.matches).toHaveLength(20); expect(fake.opened).toHaveLength(2);
});
it("betcris swarm: unknown league → error without network", async () => {
  const fake = createFakeSwarm(recordedAnswer()); const h = http();
  expect(await scraper(fake, h).scrapeFullOffer("bundesliga")).toMatchObject({ success: false, matches: [], error: "Unknown league: bundesliga" });
  expect(h.calls).toHaveLength(0); expect(fake.opened).toHaveLength(0);
});
it("betcris swarm: an aborted budget stops new game requests and closes the socket", async () => {
  const parent = new AbortController();
  const fake = createFakeSwarm(recordedAnswer({ override: (q) => { if (!isGame(q)) return undefined; parent.abort(new Error("shutdown")); return "silent"; } }));
  const r = await settle(scraper(fake).scrapeFullOffer("premier-league", createScrapeBudget(120_000, parent.signal)));
  expect(r).toMatchObject({ success: false, matches: [], error: "20 of 20 details failed | scrape aborted: shutdown" });
  expect(fake.sent.filter(isGame).length).toBeLessThanOrEqual(4); expect(fake.closed).toBe(1);
});
```
- [ ] **Step 2: Run and confirm they fail.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/swarm-scraper.test.ts` → FAIL: `Cannot find module '../swarm-scraper.js'`.
- [ ] **Step 3: Implement** `BetcrisSwarmScraper` per the flow above.
- [ ] **Step 4: Run and confirm they pass.** Same command → 10 passed. Then `$HEAVY npx tsc --noEmit && $HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run`.
- [ ] **Step 5: Commit.**
```bash
git add src/scrapers/bookmakers/betcris/swarm-scraper.ts src/scrapers/bookmakers/betcris/__tests__/swarm-scraper.test.ts
git commit -m "feat(betcris): BetcrisSwarmScraper - one socket, per-game requests 4 at a time, skip on failure"
```

### Task B6: Offline parity contract (README §6 gate 1)

**Files:**
- Test: `src/scrapers/bookmakers/betcris/__tests__/parity.test.ts`

**Interfaces:**
- Consumes:
  - Browser side: `BetcrisBrowserScraper` driven by `browserOfferPage()` and an `initBrowser` spy, as in `scraper-flow.test.ts` (`useFakeBrowser`). It gets the SPA frames as recorded.
  - Swarm side: `BetcrisSwarmScraper` with `createFakeSwarm(recordedAnswer())` and the replay `HttpClient`. It gets the same payloads projected onto the `what` it actually sends, so the test also re-proves that the field list covers the parser.
- Produces: nothing new.

- [ ] **Step 1: Write the test.** `replayHttp = () => createReplayHttpClient({ "https://www.betsport.pl/": { body: loadFixtureText("swarm/partner-configs.html"), contentType: "text/html" } })`. The second test checks that the output order comes from the listing (plan 02's input-order guarantee), not from reply timing.
```ts
const strip = (r: FullOfferScraperResult) => r.matches.map(({ scrapedAt: _s, ...m }) => m);
it("betcris parity: browser and Swarm paths write deep-equal offers from the same recorded payloads", async () => {
  useFakeBrowser(browserOfferPage());
  const browser = await settle(new BetcrisBrowserScraper().scrapeFullOffer("premier-league"));
  const swarm = await settle(new BetcrisSwarmScraper({ http: replayHttp(), openSession: createFakeSwarm(recordedAnswer()).open }).scrapeFullOffer("premier-league"));
  expect(browser.success && swarm.success).toBe(true);
  expect(strip(swarm)).toHaveLength(20);
  expect(strip(swarm)).toEqual(strip(browser));
});
it("betcris parity: holds when Swarm replies arrive in reverse order", async () => {
  const delayMs = (q: FakeSwarmRequest) => (q.params?.where?.game?.id ? 300 - 10 * RECORDED_GAME_IDS.indexOf(q.params.where.game.id) : 5);
  useFakeBrowser(browserOfferPage());
  const browser = await settle(new BetcrisBrowserScraper().scrapeFullOffer("premier-league"));
  const swarm = await settle(new BetcrisSwarmScraper({ http: replayHttp(), openSession: createFakeSwarm(recordedAnswer({ delayMs })).open }).scrapeFullOffer("premier-league"));
  expect(strip(swarm)).toEqual(strip(browser));
});
```
- [ ] **Step 2: Run it.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/parity.test.ts` → **2 passed**. Tasks B2 and B5 already give parity by construction, so this gate passes when it is written. If it fails, the two paths diverge: stop and diff `strip(swarm)[i]` against `strip(browser)[i]` before changing anything.
- [ ] **Step 3: Mutation check (no commit).** In `swarm-client.ts`, temporarily remove `"type_1"` from `SWARM_WHAT.event` and re-run → the first test FAILS (selection names change). Restore it.
- [ ] **Step 4: Run** `$HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run` → green.
- [ ] **Step 5: Commit.**
```bash
git add src/scrapers/bookmakers/betcris/__tests__/parity.test.ts
git commit -m "test(betcris): browser vs Swarm parity on recorded payloads"
```

### Task B7: Swarm by default, browser behind `SCRAPER_TRANSPORT_BETCRIS=browser`

**Files:**
- Modify: `src/scrapers/bookmakers/betcris/index.ts` (the Task B1 version)
- Modify: `src/scrapers/bookmakers/index.ts:17`
- Modify only if `$HEAVY npx tsc --noEmit` names it: `src/scripts/analyze-bookmaker-markets.ts:36,41` → `Record<PolishBookmaker, FullOfferScraper>`. The script only calls `scrapeFullOffer` (`:122`) and `cleanup` (`:246`).
- Test: `src/scrapers/bookmakers/betcris/__tests__/transport-selection.test.ts`

**Interfaces:**
- Consumes: §3 `getTransportOverride(bookmaker, env?)`, `FullOfferScraper`.
- Produces:
  ```ts
  // betcris/index.ts
  export { BetcrisBrowserScraper, BetcrisBrowserScraper as BetcrisPlaywrightScraper } from "./browser-scraper.js";
  export { BetcrisSwarmScraper } from "./swarm-scraper.js";
  export const betcrisScraper: FullOfferScraper =
    getTransportOverride("betcris") === "browser" ? new BetcrisBrowserScraper() : new BetcrisSwarmScraper();
  // bookmakers/index.ts:17
  export { betcrisScraper, BetcrisBrowserScraper, BetcrisSwarmScraper, BetcrisPlaywrightScraper } from "./betcris/index.js";
  ```
  The pick lives in the brand module `betcris/index.ts` (README §3 one-pick rule: 05a and 05b pick there). Three importers bypass `bookmakers/index.ts` and import that module directly, so they get the same instance and the audit and discovery tools follow the flag: `src/services/audit/bookmaker-registry.ts:8`, `scripts/betcris-market-discovery.ts:14`, `scripts/betcris-prep-audit.ts:17`. `scripts/match-audit-raw-capture.ts:56` and the aggregator read it through `bookmakers/index.ts`. `scripts/test-scrapers.sh:25,332,387` and `scraper-flow.test.ts:29,43` use the class alias.

- [ ] **Step 1: Precondition and failing tests.** `grep -n "Record<PolishBookmaker, FullOfferScraper>" src/scrapers/aggregator.ts` → one hit; with none, plan 02 is not merged: stop. `afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); })`.
```ts
it("betcrisScraper defaults to the Swarm transport", async () => {
  vi.stubEnv("SCRAPER_TRANSPORT_BETCRIS", ""); vi.resetModules();
  const m = await import("../index.js");
  expect(m.betcrisScraper).toBeInstanceOf(m.BetcrisSwarmScraper);
  expect((m.betcrisScraper as any).transport).toBe("websocket");
});
it("SCRAPER_TRANSPORT_BETCRIS=browser selects BetcrisBrowserScraper", async () => {
  vi.stubEnv("SCRAPER_TRANSPORT_BETCRIS", "browser"); vi.resetModules();
  const m = await import("../index.js");
  expect(m.betcrisScraper).toBeInstanceOf(m.BetcrisBrowserScraper);
});
it("bookmakers/index re-exports the selected instance, both classes and the legacy alias", async () => {
  const all: any = await import("../../index.js"); const b: any = await import("../index.js");
  expect(all.betcrisScraper).toBe(b.betcrisScraper);
  expect(all.BetcrisSwarmScraper).toBe(b.BetcrisSwarmScraper);
  expect(all.BetcrisPlaywrightScraper).toBe(b.BetcrisBrowserScraper);
});
it("the browser fallback never blocks resources (CSS blocked = 0 matches)", () => {
  // plan 08 Task 3 rewrites this guard to resolveBrowserPolicy("betcris", …) with no stylesheet pattern (cross-plan #5)
  expect(DEFAULT_SCRAPER_CONFIGS.betcris.disableResourceBlocking).toBe(true);
});
```
- [ ] **Step 2: Run and confirm.** `$HEAVY npx vitest run src/scrapers/bookmakers/betcris/__tests__/transport-selection.test.ts` → tests 1 and 3 FAIL (`BetcrisSwarmScraper` not exported; the instance is the browser class). Tests 2 and 4 pass; they are guards.
- [ ] **Step 3: Implement** the two index files (and the script typing if `tsc` asks).
- [ ] **Step 4: Run and confirm.** Same command → 4 passed. Then `$HEAVY npx tsc --noEmit && $HEAVY npx tsc -p .scratch/tsconfig.betcris-tests.json && $HEAVY npx vitest run`, and `grep -rn "BetcrisPlaywrightScraper" src --include=*.ts | grep -v __tests__` → only the alias lines in `betcris/index.ts` and `src/scrapers/bookmakers/index.ts`.
- [ ] **Step 5: Commit.**
```bash
git add src/scrapers/bookmakers/betcris/index.ts src/scrapers/bookmakers/index.ts src/scrapers/bookmakers/betcris/__tests__/transport-selection.test.ts
git commit -m "feat(betcris): Swarm transport by default, browser via SCRAPER_TRANSPORT_BETCRIS=browser"
```
(Add `src/scripts/analyze-bookmaker-markets.ts` only if it changed.)

### Task B8: Live verification (no code)

**Files:** none. Outputs go to `$WT/.scratch/perf-smoke/` (EXECUTION rule 5).

**Interfaces:**
- Consumes: plan 02 Task 10 `npx tsx scripts/perf-smoke.ts --bookmaker <bm> [--league premier-league] [--out <file>] [--baseline <file>] [--force]`. If plan 02 builds it on observability's `scripts/smoke-bookmaker.ts`, use the final name; the keys below are plan 02's.
  - It prints `PERF_SMOKE <json>` (keys `scraperClass`, `transportOverride`, `wallMs`, `success`, `error`, `matches`, `markets`, `selections`, `transport`, `memory.chromiumProcessesEver`, …) and, with `--baseline`, `PARITY <json>` (`matchesEqual`, `marketsDeltaPct`, `selectionsDeltaPct`, `pass`, ±2 %).
  - Exit codes: 0 = success with matches and parity pass; 1 = failed or parity fail; 2 = usage error or the HH:55–HH:10 guard.
  - It forces a dead `SUPABASE_URL`, so it is a read-only probe (EXECUTION rule 4).

- [ ] **Step 1: Browser baseline, then the Swarm run against it, in the same clock hour** (read-only; `$HEAVY --live`, one at a time). Start between HH:10 and HH:50; the browser run takes about 50–100 s after Part A. From `$WT`:
```bash
E=$WT/.scratch/perf-smoke; mkdir -p $E
SCRAPER_TRANSPORT_BETCRIS=browser $HEAVY --live npx tsx scripts/perf-smoke.ts --bookmaker betcris --out $E/betcris-browser.json 2>&1 | tee $E/betcris-browser.log | grep -E '^PERF_SMOKE|^\[Betcris\] capture ok' | tail -3; echo "exit ${PIPESTATUS[0]}"
$HEAVY --live npx tsx scripts/perf-smoke.ts --bookmaker betcris --baseline $E/betcris-browser.json --out $E/betcris-swarm.json 2>&1 | tee $E/betcris-swarm.log | grep -E '^(PERF_SMOKE|PARITY)|^\[Betcris\] capture ok'; echo "exit ${PIPESTATUS[0]}"
```
Pass:
  - Browser run: exit 0, `scraperClass: "BetcrisBrowserScraper"`, `transportOverride: "browser"`, `memory.chromiumProcessesEver > 0`, and a `[Betcris] capture ok: navMs=…` line. This doubles as the rollback-switch check. If this run fails, repeat both runs in the next window; never compare against a failed run.
  - Swarm run: exit 0.
    - `PARITY`: `matchesEqual: true` and `pass: true` (markets and selections within ±2 %).
    - `PERF_SMOKE`: `scraperClass: "BetcrisSwarmScraper"`, `transportOverride: null`, `wallMs < 5000`, `memory.chromiumProcessesEver: 0`, `transport.http.requests ≤ 1` and `transport.ws.framesReceived = matches + 2`.
    - Exactly one `[Betcris] capture ok: transport=swarm, … skipped=0, …` line.
- [ ] **Step 2: Acceptance A1 on the Swarm path (read-only).** Run betcris.md's A1 smoke (the Task 4 Step 5 command, writing `.scratch/smoke-swarm.txt` and `.scratch/smoke-swarm-full.txt`) with three edits: construct `new BetcrisSwarmScraper()` instead of `new BetcrisPlaywrightScraper()`, drop the `browserPool` import and the `closeAll()` call, and end the async body with `process.exit(0)`. Pass when the A1 criteria from betcris.md's Acceptance table hold on the Swarm output:
  - `success:true`, `matches ≥ 18`, `minMarketsPerMatch ≥ 300`, `otherShare ≤ 0.21`, Σ `ladderTypes ≥ 10 × R` (R from the A1 helper grep), no `Unknown market` line for a ladder id, and `residual`/`dupRungs`/`zeroTier`/`normCollisions` 0;
  - `durationMs ≤ 10 000`.

  Reference, browser path 2026-11-07: 19 matches, **12 128** `scrapedMarkets`, 2 289 OTHER, min 344, 100 841 ms (`acceptance-2026-11-07.json`). A difference beyond the live offer's own drift fails Step 1's parity first.
- [ ] **Step 3: After the owner merges (DEFERRED; record the command and the expected result).** On the next two scheduled runs: `sed 's/\x1b\[[0-9;]*m//g' <service log> | grep -E '^\[Aggregator/FullOffer\] betcris [a-z_]+: |\[Betcris\] capture ok|\[betcris\] (Full offer scraper error|[0-9]+ of [0-9]+ details failed)|\[Betcris/Navigation\]'`. Pass:
  - one `[Betcris] capture ok: transport=swarm, games=G, …, totalMs=T` line with T < 5 000;
  - no `[Betcris/Navigation]` line and no `[betcris] Full offer scraper error` line;
  - the aggregator line `betcris success: N matches, M markets found, K saved` (or `partial:`) has N = G − skipped and **K ≥ 0.75 × B**. B is betcris's `markets_saved` in the last browser-path scheduled run before the switch, read from `scraper_runs` (observability A10's 0.75 rule; `RUN2_OK` has no betcris value).

  A `success:false` with a `ws …`, `swarm …` or `… details failed | …` cause fails this verification. Roll back with `SCRAPER_TRANSPORT_BETCRIS=browser` in the live `.env` and a restart (owner).

---

## Self-Review

1. **Spec coverage.**
   - Owner decision C honoured: the status line at the top, Part B gated on an explicit yes, `BASE_URL` kept, pooling untouched.
   - SGV finish (old Task 8) on the built `captureSwarm`: Task A1 (`capture.test.ts:162` rewritten, plus a fallback test).
   - Cache removal on the built code: Task A2, with a dynamic-import spy so it survives `scraper-flow.test.ts`'s `vi.resetModules()`.
   - Part B:
     - Bootstrap from `partnerConfigs` with a 6 h TTL, a 10 min fallback TTL, the fallback constants and in-flight sharing: Task B3.
     - Handshake, listing, per-game requests 4 at a time via `fetchDetailsSkippingFailures`, skip without write, budget-bounded, §3 error wording: Tasks B4–B5.
     - `transport = "websocket"` (#19) and cumulative `transportStats()`: Task B5 (first test) and Task B7.
     - The parity pattern on the built browser path: `buildBetcrisMatchOffer` replaces only `:297-335`, the breaker and the aborted result stay; replay on the tracked recordings: Tasks B2, B6.
     - Alias and pick: Tasks B1, B7. Stylesheet guard: Task B7 test 4.
     - Live: perf-smoke parity plus A1 thresholds (19 / 12 128): Task B8.
2. **Step scan.**
   - No TBD. Values checked on integration on 2026-11-13: the SGV rid occurrences and timestamps (1873 empty, 2654 with 613), the 20 recorded listing ids, the `scraper-flow.test.ts` alias lines, the importer lines, and the line anchors (`index.ts:16,37,39-51,53,66-72,159-194,247,275,281-294,297-335,338,352-362,400`; `navigation.ts:106-137,212-221,303-306,346-363,581,692-701`; `parser.ts:36,173,224,388,628,646,653,661`; `constants.ts:11,17-37,235,241`).
   - Counts that changed with betcris.md's ladder split are asserted relationally (`perGame`, `> 600`), not as stale literals: the old 80-market trim, 10 460 selections and 1 600 markets.
3. **Type consistency.**
   - These names match across all tasks: `BetcrisBrowserScraper`, `BetcrisPlaywrightScraper` (alias), `BetcrisSwarmScraper`, `BetcrisSwarmDeps`, `BetcrisListingEntry`, `buildBetcrisMatchOffer`, `findGameInSwarmData`, `buildEventUrl`, `SwarmPartnerConfig`, `ResolvedSwarmConfig`, `createSwarmPartnerConfigCache`, `parsePartnerConfigs`, `SWARM_TRANSPORT.*`, `SWARM_WS_HEADERS`, `SWARM_WHAT`, `SwarmWhat`, `swarmListingParams`, `swarmGameParams`, `openSwarmClient`, `SwarmClient`, `SwarmReply`, `createFakeSwarm`, `recordedAnswer`, `FakeSwarmRequest`, `projectSwarmData`, `recordedGame`, `recordedListing`, `RECORDED_GAME_IDS`, `retarget`, `browserOfferPage`, `loadFixtureText`.
   - From `fake-swarm-page.ts`: `loadFixture`, `loadRecording`, `settle`, `createFakeSwarmPage`.
   - §3 / plan 02 / plan 07 names are used as written: `TransportStats`, `TransportStatsSource`, `hasTransportStats`, `DeclaresTransport`, `DEFAULT_USER_AGENT`, `httpStatusError`, `BudgetExceededError`.
4. **Review Focus.** All eight items have tests in their owning tasks (A1 ×2, A2, B4/B5, B4/B5, B3, B5, B5).
5. **Proportion.**
   - Part A is two small TDD tasks and one read-only live check.
   - Part B code blocks are tests, signatures and one fixture-trim script; the implementation bodies are left to the implementer.
   - The tracked recordings replace the old trimmed fixture files, so only `partner-configs.html` (~9 KB) and `session-reply.json` (~0.2 KB) are new.

## Open Questions

1. **ToS / undocumented-protocol risk (README §8 Q1 = betcris.md OQ1).** **Answered "no"** for betcris on 2026-11-07 (EXECUTION.md Group C: "no Node Swarm client"). Part B stays parked. If the owner revisits it, the question is: accept the undocumented Swarm protocol with `SCRAPER_TRANSPORT_BETCRIS=browser` kept for at least one release, bootstrapping from `www.betsport.pl` (or `www.betcris.pl`, see Part B constraints)? The recommendation is unchanged: yes, with the fallback. The browser path needs ~50–100 s per league against < 5 s.
