# PZBuk Direct WebSocket Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:**
> - pzbuk.md Tasks 1–7 are built on `recovery/integration` (c0c03e9 … 19c9331). The browser wiring this plan once replaced "instead of pzbuk.md Task 5" exists and works at code level: `pzbuk/index.ts:322-491`, `captureWebSocketData(page, single, id) → {state, diagnostics}`, ≈ 17 s/event. 05c now **replaces working code** as the default path. README §6 gate (2) is restored: a same-hour comparison against the browser path, next to the declared-group-totals check (`evidence/delta-audit-transport-2026-11-13.md` "05c").
> - Task 2's characterization mocks resolve `{state, diagnostics: emptyDiagnostics()}`. `mapEventOffer` replaces only the push at `index.ts:427-436` (through its builder half `buildPzbukMatchOffer`). `recordFailure`, the "0 markets parsed" / "groups never answered" logic and the per-event log line stay.
> - `DirectSessionState` embeds pzbuk.md's `CaptureDiagnostics`/`emptyDiagnostics` (and the now-exported `lastFrameDetails`) instead of a duplicate state type. The local `type TransportStats` (`index.ts:45`) becomes `PzbukFrameCounters`, and its per-call counters become cumulative `frameCounters()` (README §3's monotonic rule). `PzbukWsScraper` declares `transport = "websocket"` (cross-plan #19) with cumulative `transportStats()`.
> - Task 5's importer list gains `scripts/pzbuk-smoke.ts`, which reads `.lastTransportStats`, and its `smoke-script.test.ts` (`delta-audit-infra-2026-11-13.md` 02 item 11). Optional Task 6 is now the README §5.1 browser-path speedups. Its blocking uses only plan 08's CDP `urlPatterns`, or is dropped; no `page.route` (cross-plan #23). Fixtures are copied via absolute evidence paths (#28).
> - Deleted: the obsolete "Amendments to pzbuk.md" rows (Tasks 2, 3, 5 and Task 7 "script unchanged") and the "0 matches today" observation. The A7′ regex accepts both per-event line formats. Adopts the EXECUTION.md workspace rules; the persisting live steps are DEFERRED to the owner.

**Goal:** Fetch the whole PZBuk league offer over one Node WebSocket session, without Chromium, in about 1 s: one listing subscription and one offer subscription for all listed events. It replaces the recovery plan's browser capture (about 17.4 s per event, about 6 min per league) as the default path.

**Architecture:**
- A pure reducer (`ws-direct.ts`) drives the protocol over §3 `openWsSession`/`collect`. It reuses pzbuk.md Task 1's `FrameAssembler` and `decodeFrame` unchanged, and records what it sees in pzbuk.md Task 2's `CaptureDiagnostics`.
- A pure coverage check (`offer-coverage.ts`) decides per event whether every declared market group arrived.
- Only complete events are mapped, through `mapEventOffer` (`full-offer-mapper.ts`). Its builder half is first extracted from today's browser path and proven byte-identical there.
- The old class stays as `PzbukBrowserScraper` behind `SCRAPER_TRANSPORT_PZBUK=browser`.

**Tech Stack:** TypeScript (NodeNext ESM, Node 20), `ws` through the §3 `WsSession`, Vitest 4, tsx.

**Spec:** README §1.4 (pzbuk row), §3 as refined by `02-shared-transport.md` Tasks 5–8 and 10 (`ScrapeBudget`, `FullOfferScraper`, `DEFAULT_MAX_DURATION_MS`, `MAX_SKIPPED_DETAIL_RATIO`, `WsSession`/`openWsSession`, `getTransportOverride`, the one-pick rule, the empty-listing rule, `DeclaresTransport`, cumulative `transportStats()`, the parity pattern), §5 (P7) and §5.1 (pzbuk.md row), §6, §7.
- Evidence (main checkout, untracked, read-only, absolute paths):
  - `evidence/findings-notes.md` (PZBUK-1…5);
  - `evidence/betcris-pzbuk/`: `pzbuk-direct.mjs` + `pzbuk-direct-results.json`, `pzbuk-direct2.mjs` + `pzbuk-direct2-results.json`, `pzbuk-direct3.mjs` + `pzbuk-direct3-summary.json` + `pzbuk-direct3-frames.json.gz` (the 2026-11-07 01:44Z probe), `pzbuk-full-summary.json`;
  - `pzcap/cap.json`, byte-identical (md5 `e5270a9f…`) to the recovery `evidence/pzbuk/capture-full-2026-11-06.json.gz`;
  - the two delta audits.
- Recovery, tracked on integration: `docs/superpowers/plans/2026-11-06-scraper-recovery/pzbuk.md` (Observations, Tasks 1–7, acceptance A1–A12) and `EXECUTION.md`.

## Global Constraints

README §6 applies in full: `tsc` and `vitest` green before each commit, the golden test unchanged, the parity gate, modest live traffic, and no attribution footers. Plan-specific:
- **Workspace (EXECUTION.md):**
  - Worktree `$WTS/perf-pzbuk-ws` on branch `perf/pzbuk-websocket`, from `recovery/integration`.
  - `node_modules` is a symlink to the main checkout's; never `npm install`/`npm ci`. `ws` 8.19.0 is in the lockfile, and plan 02 adds the `package.json` entries.
  - `.env` is a copy of the integration worktree's dead-port `.env`. Never change it.
  - Every `npx vitest`/`tsc`/`tsx` and `python3` over large files goes through `$HEAVY`; anything that calls pzbuk.pl or opens a browser uses `$HEAVY --live`, one at a time.
  - Scoped tests during TDD, the full suite + `tsc` once per task.
  - Never start the server or the scheduler, never write the DB. Persisting live acceptance is DEFERRED: record the command and the expected result.
  - Scratch output goes to `$WT/.scratch/`. Never write into the main checkout (`/home/skamik/Documents/repositories/personal/aityper-scraper-api`), whose `docs/` evidence is read by absolute path only.
- Baseline: the future base has 125 test files / 2243 tests; record the worktree's own count first.
- **Lands after pzbuk.md Tasks 1–7 (all on integration) and plan 02.**
  - Reused unchanged: pzbuk.md Task 1's `decodeFrame`, `initialStatesOf` and `FrameAssembler` (`ws-protocol.ts:112,133,164-182`; the default chunk size 0 means this plan pre-sets it); Task 2's `CaptureDiagnostics`/`emptyDiagnostics`/`isEmptyListing` (`:270-306`); Task 3's legacy helpers; Task 4's normalizer; Task 6's golden pair.
  - Task 5's browser wiring stays as `PzbukBrowserScraper` behind the flag.
  - Task 7's smoke script is repointed to the picked instance (Task 5 here).
- **Data flows only from Task 5 of this plan.** Task 5 Step 1 still checks that pzbuk.md Task 4's normalizer commit is in the tree; it is on integration.
- The owner's answer to README §8 Q1 is "yes, with fallback". EXECUTION Group C's "no Node Swarm client" concerns betcris only; pzbuk follows "each plan's own default".
- Socket: `wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl`. The headers are exactly `origin: https://www.pzbuk.pl` and `user-agent: DEFAULT_USER_AGENT` (plan 02 `http-client.ts`, Chrome/143). The probes used the same two headers with a Chrome/120 UA. No cookies and no page load.
- Streams: `1` = listing, `3` = offer. Apart from the stream id, the listing filter is byte-identical to the site's own sidebar subscription (`pzcap/cap.json` event phase, stream 7; also stream 7 of the tracked `__tests__/fixtures/ws-event-frames.json`).
- Timeouts:
  - connect `10_000` ms;
  - one `collect` covers the whole exchange with `min(15_000, budget.remainingMs())` ms;
  - one retry, after a 0–499 ms full-jitter delay, only for `ws failed`, `ws closed`, `ws timeout`, a handshake 429/5xx, or a collect that timed out before the listing or the offer arrived;
  - the default budget is `DEFAULT_MAX_DURATION_MS.websocket` (120 000 ms).
- An event is written only when **every declared group** delivered at least its `marketsCount` markets. Incomplete events are skipped, so they get no write and no prune.
- The result shape is plan 02's `HttpScraper` template:
  - More than `MAX_SKIPPED_DETAIL_RATIO` (0.5) skipped → `{ success:false, matches:[], error: "<n> of <m> details failed | <first reason>" }`.
  - Fewer skips → `success:true` with the same `error` text. No skips → no `error` key.
  - An empty listing (an INITIAL_STATE with 0 events) → `success:true, matches:[]` (README §3 empty-listing rule; observability classifies it `empty`).
- `SELECTION_DELTA` / `EVENT_DELTA` are ignored. Odds come from the INITIAL_STATE snapshot, as in pzbuk.md.
- Wire ids are JSON numbers. They are sent back as numbers, and lookups key on `String(id)`. `matchId` keeps the wire value, exactly as the browser path does.
- Do not edit `src/scrapers/aggregator.ts` or `src/services/scraper-service.ts`. Error text uses the §3 `ws …` wording; extra detail is appended after `" | "` (the observability separator). Aggregator greps use observability's `[Aggregator/FullOffer] pzbuk <status>: N matches, M markets found, K saved[ - err]`.

## Review Focus

1. **Offer length is an exact multiple of `chunkSize`.** The assembler then waits for a tail that never comes. Expected: the collect times out, the error names `buffered: <n> bytes`, the session is retried once, and nothing is written. Pinned by Task 3 "records invalid frames, the last control frame and buffered bytes" and Task 4 "names the last control frame when the offer never arrives".
2. **The listing and the offer come from different server snapshots** (a market is added between them). Coverage reads the offer event's own `marketGroups`, from the same snapshot as its markets, and falls back to the listing only when the offer lacks the event. Pinned by Task 3 "prefers the offer event's marketGroups over the listing's".
3. **Socket drop, refused connection or a server `ERROR` frame mid-offer.** Expected: `ws closed <code> <url>`, `ws failed <code> <url>` or `ws timeout … | no offer … last control: ERROR …`, one retry, no partial write. Pinned by Task 4 "retries once after the socket drops", "retries a refused connection once, then reports it" and "names the last control frame when the offer never arrives".
4. **A listed event that is missing from the offer or declares no groups.** It is skipped and counted in the ratio. An event with no declared groups is not even subscribed and never holds `done` open. Pinned by Task 3 "does not target an event that declares no market groups" and Task 4 "skips incomplete events and fails when more than half are skipped".
5. **Numeric ids.** The offer `SUBSCRIBE` must carry numbers (`[4408475,…]`, not strings), and `matchId` must stay the wire number, as in the browser path. Pinned by the exact literals in Task 3 and `matchId: 4408475` in Task 2.
6. **The picked instance changes class.** `scripts/pzbuk-smoke.ts` must read its frame counters from whichever class is picked, and the counters must stay meaningful when both transports are in play (cumulative, never reset per call). Pinned by Task 4 "counters are cumulative across calls" and Task 5 "the smoke reads frame counters from either class".

---

## Observations (pre-fix analysis)

All `file:line` refer to `recovery/integration` (≥ `aaf7c07`). Observability and fortuna do not touch `src/scrapers/bookmakers/pzbuk/`, `scripts/pzbuk-*.ts` or `src/config/leagues.ts`; `playwright-base.ts` refs are observability's.

**The browser path today [V].** pzbuk.md Task 5 (adcd488, 935fcb0) wired the capture to `sportsbook-api/ws` (`constants.ts:253`). `scrapeFullOffer` (`index.ts:322-491`) works in three phases.
- **Listing:** `captureWebSocketData(page, false)` + `navigateToLeaguePage` (`:330-341`).
  - A null state with `isEmptyListing(diagnostics)` → `success:true, matches:[]` (`:344-356`).
  - Any other null → `No WebSocket data captured: <describeCaptureFailure>` (`:358-367`).
- **Per valid event,** sequentially:
  - `captureWebSocketData(page, true, event.id)` + `navigateToEventPage` (`:400-401`);
  - a failed navigation still awaits the capture, up to `WS_MAX_WAIT` 25 s (`:403-409`);
  - `recordFailure` for a null state (`:415-416`) or 0 parsed markets (`:422-425`);
  - otherwise the push (`:427-436`), the per-event log line `<label>: <n> markets (groups X/Y) (frames: invalid …, chunked …, max … B)` (`:438-441`) and a "market groups never answered" warning (`:443-448`);
  - `delay(200)` (`:452`).
- **End:** 0 matches → `No markets captured for any of N listed events (first failure: …)` (`:467-480`).

The single-event capture costs about 17.4 s per event:
- a 2 s sleep (`navigation.ts:402`) and the cookie banner;
- the one-shot expansion trigger at ≥ 3 s (`:420-433`): header clicks plus up to 40 "Pokaż więcej" clicks via `clickAllShowMore` (`:92-114`), 3–5 s with no data effect (pzbuk.md Observations);
- `MIN_CAPTURE_MS` 8 s (`constants.ts:289`), `STREAM_SILENCE_MS` 2.5 s (`:295`) and the `WS_MAX_WAIT` 25 s cap (`:269`).

That adds up to about 6 min per 20-event league, with a Chromium slot held throughout. No live run of this path after the fix is recorded (pzbuk.md Task 7 Steps 2–4 fall under EXECUTION rule 4). None of the README §5.1 browser amendments is applied (findings PZBUK-2/3/4; delta audit).

**Direct protocol (verified).** Three probes: `pzbuk-direct.mjs`, `pzbuk-direct2.mjs` and `pzbuk-direct3.mjs` (2026-11-07 01:44Z, the same client without the probe's stream-3 header step; `pzbuk-direct3-summary.json`).
- Handshake: 101 with Origin + UA only; the socket opened at 199 ms. The first frame is `{"type":"SETUP","chunkSize":1048576}` (36 B), 4 ms after open.
- Listing `SUBSCRIBE` on stream 1, `{sportIds:[1], leagueIds:[134], eventTypes:["Fixture"], marketTypeFilters:[], isLive:false}` + `orders:[2,5]`: one INITIAL_STATE with 19 events, 0 markets, 159 572 B, RTT 80 ms. **Every listed event carries `marketGroups{id,name,marketsCount}`**, also in the 2026-11-06 browser capture (stream 7, 20/20 events).
- Offer `SUBSCRIBE` on stream 3, `{eventIds:[…19], includeEntities:["MARKET","SELECTION"]}`, with no `marketGroupIds` filter (`pzbuk-direct.mjs` s9 = all groups):
  - one INITIAL_STATE: 3 138 markets, 19 722 selections (all Active), 8 278 184 B;
  - received as 7 × 1 048 576 B + 938 152 B, the first live confirmation of pzbuk.md Task 1's chunk rule;
  - complete 530 ms after the subscribe (0.69–0.84 s in the earlier probes);
  - no further message on stream 3 within 2 s; the offer's events carry `marketGroups` too (19/19).
- **Coverage rule.** For every event and every declared group g, the number of the event's markets whose `marketType.marketGroupIds` contains g equals `g.marketsCount`.
  - It held for 19/19 events live (0 mismatches) and for 10/10 groups of Everton–Coventry in the recorded capture (Σ 242, 232 unique).
  - Unique markets = declared total − markets listed in two declared groups: 4408509 has 237 − 9 = 228, and 4454791 has 114 − 6 = 108 (`pzbuk-direct2-results.json` rows).
  - The browser path's union over group streams (pzbuk.md Task 2) is not needed: the offer is one message, and markets are merged by id.

**Code facts.**
- Per event, the browser loop (`index.ts:382-460`) maps a listing event plus its capture through `isValidEvent` (`parser.ts:799`), `parseTeamNames` (`:31`), `buildEventUrl` (`navigation.ts:489`), `parseAllMarkets` (`parser.ts:698`) and `getCanonicalTeamName`, with `startTime: event.startingOn` and `matchId: event.id`.
- The events cache is written at `index.ts:136-140` (`scrapeLeague`), `:260` (`scrapeMatchDetails`) and `:418` (`scrapeFullOffer`), and defined at `:20`, `:55-59` and `:80-98`. Its only read (`:232-237`) keys on `/\/event\/(\d+)/` (`:229`), which never matches `/events/<id>-…` (pzbuk.md Tooling gotchas), so the cache is write-only. `PZBukCachedEvent` (`:49-53`) stays; `buildMatchDetailResult` (`:274`) uses it.
- `type TransportStats = Pick<CaptureDiagnostics, "invalidFrames" | "chunkedFrames" | "maxFrameBytes">` (`:45`), `emptyTransportStats` (`:47`) and `lastTransportStats` (`:64-69`, reset per call at `:323`, summed by `addTransportStats` `:100-105`) are per-call. Plan 02 exports a different `TransportStats` from `shared/scraper-contract.ts`. `scripts/pzbuk-smoke.ts` reads the per-call object: it imports `pzbukScraper` (`:38`), types `type TransportStats = typeof pzbukScraper.lastTransportStats` (`:78`) and copies it after the call (`:376-378`). `smoke-script.test.ts:4-15` imports the script.
- The league id comes from `getBookmakerLeagueId(slug, "pzbuk")`: "134" for premier-league (`config/leagues.ts:60, 162-169`). `constants.ts:17-24` `LEAGUE_IDS` duplicates it and is unused.
- Importers of `pzbukScraper`, checked with `git grep` on integration:
  - **directly from `pzbuk/index.js`:** `src/services/audit/bookmaker-registry.ts:14`, `scripts/pzbuk-market-discovery.ts:14`, `scripts/pzbuk-prep-audit.ts:17`, `scripts/pzbuk-smoke.ts:38`;
  - **through `bookmakers/index.ts:19`:** `aggregator.ts:28,46`, `src/scripts/analyze-bookmaker-markets.ts:32,53` (its map is typed `PlaywrightScraper` at `:36,41`) and `scripts/match-audit-raw-capture.ts:57`.
  - `scripts/test-scrapers.sh:34` names the class `PzbukPlaywrightScraper`.
- pzbuk.md Task 2's diagnostics already describe everything the direct reducer needs: `CaptureDiagnostics` (`ws-protocol.ts:270-286`: `framesReceived`, `invalidFrames`, `lastInvalidError`, `chunkedFrames`, `maxFrameBytes`, `initialStates`, `maxEvents`, `lastControl`), `emptyDiagnostics` (`:288`), `isEmptyListing` (`:304`), and the module-local `lastFrameDetails` (`:308`), which this plan exports.

### Relation to pzbuk.md (all tasks on integration)

| pzbuk.md task | Under this plan |
|---|---|
| Tasks 1, 2 (decoder, assembler, `CaptureDiagnostics`) | Reused unchanged; Task 3 here embeds `CaptureDiagnostics` and exports `lastFrameDetails` |
| Tasks 3, 4, 6 | Unaffected (legacy helpers, normalizer, golden pair) |
| Task 5 (browser wiring) | Kept as `PzbukBrowserScraper` behind `SCRAPER_TRANSPORT_PZBUK=browser`; its push goes through `buildPzbukMatchOffer` (Task 2 here); the README §5.1 speedups are optional Task 6 here |
| Task 7 (`scripts/pzbuk-smoke.ts`) | Repointed to the picked instance and cumulative frame counters (Task 5 here); its thresholds and SMOKE schema are unchanged, and A8's `durationMs` becomes < 3 000 on the default path |

### Acceptance (replaces pzbuk.md A7 and A8 for the default path; A1–A6, A9–A12 unchanged)

| # | Check | Threshold |
|---|---|---|
| A7′ | One per-event line per written event, in either format: WS `[PZBuk/FullOffer] <home> vs <away>: <n> markets (groups Y/Y, markets counted A/B)`, or browser `…: <n> markets (groups X/Y) (frames: …)` | No `skipped` line on a normal run. Every WS line has X = Y and `B ≤ A ≤ 1.02·B`; every browser line has X = Y. matches = valid listed fixtures (19/19 on 2026-11-07). |
| A8′ | `scrapeFullOffer` wall time (perf-smoke) | < 3 000 ms on the default transport; no `browserPool.acquire` call (Task 4 test). The browser path keeps ≤ 600 000 ms. |
| A10 | Legacy `scripts/test-scrapers.sh test pzbuk premier-league` | Unchanged in meaning: it exercises `PzbukBrowserScraper`'s legacy methods (pzbuk.md Task 3), which never had a WS counterpart. |

## Preconditions and worktree

```bash
REPO=/home/skamik/Documents/repositories/personal/aityper-scraper-api           # main checkout: read only
WTS=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees
HEAVY=$WTS/bin/heavy
P=$REPO/docs/superpowers/plans/2026-11-07-scraper-performance/evidence         # untracked, absolute, read only
WT=$WTS/perf-pzbuk-ws
PS=$WT/.scratch/perf-smoke
BASE=recovery/integration            # once it contains plan 02; until then, the branch that does
git -C "$REPO" worktree add -b perf/pzbuk-websocket "$WT" "$BASE"
ln -s "$REPO/node_modules" "$WT/node_modules" && cp "$WTS/integration/.env" "$WT/.env"
cd "$WT" && mkdir -p .scratch && grep -c '^SUPABASE_URL=.*:9$' .env                        # 1 (dead port)
grep -c "export function decodeFrame\|export function initialStatesOf\|export class FrameAssembler\|export function emptyDiagnostics" src/scrapers/bookmakers/pzbuk/ws-protocol.ts   # 4
grep -c "captureWebSocketData(page, true, event.id)" src/scrapers/bookmakers/pzbuk/index.ts  # 1 (pzbuk.md Task 5 built)
ls src/scrapers/shared/budget.ts src/scrapers/shared/ws/ws-session.ts src/scrapers/shared/scraper-contract.ts src/config/transport.ts scripts/perf-smoke.ts
grep -c "Record<PolishBookmaker, FullOfferScraper>" src/scrapers/aggregator.ts            # >= 1
node -e "require.resolve('ws')" && grep -c SCRAPER_TRANSPORT_PZBUK .env                   # resolves; 0
$HEAVY npx vitest run 2>&1 | grep -E "Test Files|Tests "                                  # record the baseline
```

All commands below run from `$WT`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/bookmakers/pzbuk/__tests__/fixtures/ws-direct-session.json` | Recorded SETUP, listing and offer messages (trimmed, 144 883 B) | 1 |
| `src/scrapers/bookmakers/pzbuk/__tests__/helpers/direct-fixture.ts` | Test-only fixture accessors, `wire`, `chunk`, `SETUP_32K` | 1 |
| `src/scrapers/bookmakers/pzbuk/offer-coverage.ts` | `groupCoverage`, `isCoverageComplete`, `describeCoverage` | 1 |
| `src/scrapers/bookmakers/pzbuk/full-offer-mapper.ts` | `buildPzbukMatchOffer`, `mapEventOffer`: the one mapping both transports call | 2 |
| `src/scrapers/bookmakers/pzbuk/index.ts` (→ `browser-scraper.ts` in Task 5) | Browser push through `buildPzbukMatchOffer`; events cache deleted; cumulative `frameCounters()` | 2, 5 |
| `src/scrapers/bookmakers/pzbuk/ws-protocol.ts` | export `lastFrameDetails`; add `PzbukFrameCounters`, `emptyFrameCounters`, `addFrameCounters` | 3, 4 |
| `src/scrapers/bookmakers/pzbuk/ws-direct.ts` | Protocol constants, message builders, frame reducer (with embedded `CaptureDiagnostics`), `done` predicate, per-event split | 3 |
| `src/scrapers/bookmakers/pzbuk/__tests__/helpers/scripted-ws-session.ts` | Test-only scripted `WsSession` | 4 |
| `src/scrapers/bookmakers/pzbuk/ws-scraper.ts` | `PzbukWsScraper implements FullOfferScraper` | 4 |
| `src/scrapers/bookmakers/pzbuk/index.ts` (new) | Re-exports both classes, `createPzbukScraper(env)`, `hasFrameCounters` | 5 |
| `src/scrapers/bookmakers/index.ts:19` (the pick), `src/services/audit/bookmaker-registry.ts:14`, `scripts/pzbuk-market-discovery.ts:14`, `scripts/pzbuk-prep-audit.ts:17`, `scripts/pzbuk-smoke.ts:5-6,29-31,38,75,78,376-378`, `scripts/test-scrapers.sh:34`, `src/scripts/analyze-bookmaker-markets.ts:36,41` | Transport pick and every direct importer | 5 |
| `src/scrapers/bookmakers/pzbuk/__tests__/smoke-script.test.ts` | Imports `scripts/pzbuk-smoke.ts`: must stay green unchanged | 5 |
| `src/scrapers/bookmakers/pzbuk/navigation.ts`, `browser-scraper.ts`, `__tests__/capture.test.ts` | Browser-path speedups | 6 (optional) |

---

### Task 1: Direct-session fixture and group coverage

**Files:**
- Create: `src/scrapers/bookmakers/pzbuk/__tests__/fixtures/ws-direct-session.json` (generated, Step 1)
- Create: `src/scrapers/bookmakers/pzbuk/__tests__/helpers/direct-fixture.ts`
- Create: `src/scrapers/bookmakers/pzbuk/offer-coverage.ts`
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/offer-coverage.test.ts`

**Interfaces:**
- Consumes: from pzbuk.md Task 1, `PZBukMarketGroup { id; name; marketsCount }`, `PZBukEvent.marketGroups?: Record<string, PZBukMarketGroup>` and `PZBukMarketType.marketGroupIds?: number[]` (`types.ts`).
- Produces:
  ```ts
  // offer-coverage.ts
  export interface GroupCoverage {
    declared: number[];        // ids of event.marketGroups, ascending
    complete: number[];        // declared ids whose counted markets >= marketsCount, ascending
    declaredMarkets: number;   // Σ marketsCount
    countedMarkets: number;    // Σ over markets of |marketType.marketGroupIds ∩ declared|
    uniqueMarkets: number;     // markets.length
  }
  export function groupCoverage(event: PZBukEvent, markets: readonly PZBukMarket[]): GroupCoverage; // markets of this event only
  export function isCoverageComplete(c: GroupCoverage): boolean;   // declared.length > 0 && complete.length === declared.length
  export function describeCoverage(c: GroupCoverage): string;      // "groups <complete>/<declared>, markets counted <counted>/<declaredMarkets>"
  // __tests__/helpers/direct-fixture.ts (test-only)
  export const fx: { messages: [setup: unknown, listing: DataMessage, offer: DataMessage] };
  export function wire(message: unknown): Buffer;                 // Buffer.from(JSON.stringify(message))
  export function chunk(bytes: Buffer, size: number): Buffer[];
  export function listingMessage(eventIds?: number[]): DataMessage; // deep copy of messages[1], events filtered (default: all 3)
  export function offerMessage(): DataMessage;                      // deep copy of messages[2]
  export function listingEvents(): PZBukEvent[];                    // events of messages[1], in order 4408475, 4408509, 4408525
  export function offerState(): PZBukInitialState;                  // payload of messages[2]
  export const SETUP_32K: Buffer;                                   // {"type":"SETUP","chunkSize":32768}
  // DataMessage = { type: "DATA"; streamId: number; payload: [{ type: "INITIAL_STATE"; payload: any }] }
  ```

- [ ] **Step 1: Generate the fixture from the recorded capture**

The fixture has three parts:
- the recorded SETUP;
- the listing: the recorded event-page **stream 7**, which uses the exact filter the direct client sends (20 events, 0 markets), trimmed to the trio of `ws-league-frames.json`;
- the offer: the union by id of the recorded group streams of 4408475.

To stay small, the offer keeps only groups 1 (Popularne, 28) and 7 (1 połowa, 24), and the event's `marketGroups` are trimmed the same way in the listing and the offer copy. That keeps the 7 markets listed in both groups 1 and 7, and 3 markets that also list the dropped group 28. The capture is read by absolute path (cross-plan #28: `docs/superpowers/plans/2026-11-07-scraper-performance/` is not tracked, so it is absent from the worktree):

```bash
mkdir -p src/scrapers/bookmakers/pzbuk/__tests__/fixtures src/scrapers/bookmakers/pzbuk/__tests__/helpers
$HEAVY python3 -I - "$P/betcris-pzbuk/pzcap/cap.json" src/scrapers/bookmakers/pzbuk/__tests__/fixtures/ws-direct-session.json <<'EOF'
import base64, json, sys
cap = json.load(open(sys.argv[1]))
EVENTS, GROUPS, EID = [4408475, 4408509, 4408525], {1, 7}, 4408475
def trim(e):
    if e["id"] == EID: e["marketGroups"] = {k: g for k, g in e["marketGroups"].items() if g["id"] in GROUPS}
    return e
msgs = [json.loads(base64.b64decode(f["b64"])) for f in cap["frames"]["event"] if f["dir"] == "recv"]
data = [(m["streamId"], m["payload"][0]["payload"]) for m in msgs if m["type"] == "DATA"]
listing = next(st for sid, st in data if sid == 7)
groups = [st for sid, st in data if len(st["events"]) == 1 and st["markets"]]
mk = {m["id"]: m for st in groups for m in st["markets"] if set(m["marketType"]["marketGroupIds"]) & GROUPS}
sel = {s["id"]: s for st in groups for s in st["selections"] if s["marketId"] in mk}
listing["events"] = [trim(e) for e in listing["events"] if e["id"] in EVENTS]
offer = dict(listing, events=[trim(groups[0]["events"][0])], markets=list(mk.values()), selections=list(sel.values()), totalPageCount=1)
env = lambda sid, st: {"type": "DATA", "streamId": sid, "payload": [{"type": "INITIAL_STATE", "payload": st}]}
json.dump({"source": "evidence/betcris-pzbuk/pzcap/cap.json (event phase, 2026-11-06T16:17Z)",
           "trim": "listing = recorded stream 7 (same filter as the direct listing), 3 events; offer = union by id of the recorded group streams of 4408475, groups 1 and 7 only, declared marketGroups trimmed alike",
           "messages": [next(m for m in msgs if m["type"] == "SETUP"), env(1, listing), env(3, offer)]},
          open(sys.argv[2], "w"), ensure_ascii=False, separators=(",", ":"))
EOF
md5sum src/scrapers/bookmakers/pzbuk/__tests__/fixtures/ws-direct-session.json
```
Expected: 144 883 bytes, md5 `9f2bede7baa3143090dc968182aa9fa8` (checked by the plan writer with this command; the source file has not changed since). The byte lengths of the three messages, `wire()`d in Node, are 36 / 34 573 / 109 588 B. The offer holds 45 markets and 222 selections; the listing holds 3 events, 0 markets and 0 selections.

- [ ] **Step 2: Write the helper and the failing tests**

```ts
// offer-coverage.test.ts
import { groupCoverage, isCoverageComplete, describeCoverage } from "../offer-coverage.js";
import { listingEvents, offerState } from "./helpers/direct-fixture.js";
const off = offerState(); const ev = off.events[0];
const has = (g: number) => (m: (typeof off.markets)[number]) => m.marketType.marketGroupIds!.includes(g);

describe("pzbuk group coverage", () => {
  it("counts every declared group of the recorded event as complete", () => {
    const c = groupCoverage(ev, off.markets);
    expect(c).toEqual({ declared: [1, 7], complete: [1, 7], declaredMarkets: 52, countedMarkets: 52, uniqueMarkets: 45 });
    expect([isCoverageComplete(c), describeCoverage(c)]).toEqual([true, "groups 2/2, markets counted 52/52"]);
  });
  it("counts a market listed in two declared groups once per group", () =>
    expect(off.markets.filter((m) => has(1)(m) && has(7)(m))).toHaveLength(7)); // 45 unique + 7 = 52 counted
  it("ignores marketGroupIds the event does not declare", () => {
    expect(off.markets.filter(has(28))).toHaveLength(3); // group 28 trimmed from the declaration
    expect(groupCoverage(ev, off.markets).countedMarkets).toBe(52);
  });
  it("is incomplete when one group delivers fewer markets than declared", () => {
    const c = groupCoverage(ev, off.markets.filter((m) => String(m.id) !== "459164851")); // a group-7-only market
    expect([c.complete, isCoverageComplete(c), describeCoverage(c)]).toEqual([[1], false, "groups 1/2, markets counted 51/52"]);
  });
  it("is never complete for an event without declared groups, and reports an absent event", () => {
    const none = groupCoverage({ ...ev, marketGroups: undefined }, off.markets);
    expect([none.declared, isCoverageComplete(none), describeCoverage(none)]).toEqual([[], false, "groups 0/0, markets counted 0/0"]);
    expect(describeCoverage(groupCoverage(listingEvents()[1], []))).toBe("groups 0/10, markets counted 0/235"); // 4408509 Leeds
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/offer-coverage.test.ts`
Expected: FAIL. The suite does not load (`Cannot find module '…/offer-coverage.js'`).

- [ ] **Step 4: Implement `groupCoverage(event, markets): GroupCoverage` in `offer-coverage.ts`.** Read the declared groups from `Object.values(event.marketGroups ?? {})`. Count per group over `market.marketType.marketGroupIds ?? []`, intersected with the declared ids. `describeCoverage` and `isCoverageComplete` are exactly the one-liners above.

- [ ] **Step 5: Run it and confirm it passes**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/offer-coverage.test.ts && $HEAVY npx tsc --noEmit`
Expected: 5 passed; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
$HEAVY npx tsc --noEmit && $HEAVY npx vitest run
git add src/scrapers/bookmakers/pzbuk/offer-coverage.ts src/scrapers/bookmakers/pzbuk/__tests__/offer-coverage.test.ts src/scrapers/bookmakers/pzbuk/__tests__/helpers/direct-fixture.ts src/scrapers/bookmakers/pzbuk/__tests__/fixtures/ws-direct-session.json
git commit -m "feat(pzbuk): per-event market-group coverage check with recorded direct-session fixture"
```

### Task 2: One event mapping for both transports; drop the write-only events cache

This is the README §3 parity pattern. The old path calls the extracted builder, which is proven byte-identical on recorded snapshots. The browser path keeps all of its recovery logic (`recordFailure`, "0 markets parsed", "groups never answered", the per-event log line). Only the object construction at the push moves.

**Files:**
- Create: `src/scrapers/bookmakers/pzbuk/full-offer-mapper.ts`
- Modify: `src/scrapers/bookmakers/pzbuk/index.ts`:
  - `:427-436`: the `matches.push({...})` object becomes `matches.push(buildPzbukMatchOffer(event, teams, markets, leagueSlug, new Date()))`. The parse at `:420`, the `markets.length === 0` failure (`:422-425`) and the log/warn lines (`:438-448`) stay byte-identical.
  - Cache removal:
    - `:20` (the `ScraperCache, CACHE_TTLS` import), `:55-59` (the instance), `:80-98` (`updateCache`, `getCachedEvent`);
    - `:136-140` (the write in `scrapeLeague`);
    - `:232-237` (the never-matching read in `scrapeMatchDetails`; keep the `eventId` extraction at `:229-230`, which feeds `captureWebSocketData`);
    - `:260` (the write in `scrapeMatchDetails`) and `:418` (the write in `scrapeFullOffer`).
  - `PZBukCachedEvent` (`:49-53`) stays; `buildMatchDetailResult` uses it. Plan 01 leaves the pzbuk cache to this plan.
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/full-offer-mapper.test.ts`

**Interfaces:**
- Consumes: `isValidEvent`, `parseTeamNames`, `parseAllMarkets` (`parser.ts:799, :31, :698`, unchanged), `buildEventUrl` (`navigation.ts:489`; only `import type` from playwright there, so no runtime browser dependency), `getCanonicalTeamName` (`utils/team-matcher.ts`), `emptyDiagnostics` (`ws-protocol.ts:288`). Test seam: `PlaywrightScraper.initBrowser()` (observability `playwright-base.ts:93`, protected), which returns a `BrowserSession` (`:32`).
- Produces:
  ```ts
  // full-offer-mapper.ts
  export function buildPzbukMatchOffer(event: PZBukEvent, teams: ParsedTeams, markets: ScrapedMarket[], league: string, scrapedAt: Date): FullMatchOffer;
  // exactly the object index.ts:427-436 builds today (matchId: event.id, home/away via getCanonicalTeamName,
  // eventUrl from buildEventUrl(event.id, teams.homeTeam, teams.awayTeam, event.leagueId, event.leagueName), startTime: event.startingOn)
  export function mapEventOffer(event: PZBukEvent, offer: PZBukInitialState, league: string, scrapedAt: Date): FullMatchOffer | null;
  // null when !isValidEvent(event), a team name is missing, or parseAllMarkets(offer, event.id, teams) is empty;
  // otherwise buildPzbukMatchOffer(event, teams, markets, league, scrapedAt)
  ```

- [ ] **Step 1: Write the characterization test (it must pass on the current code)**

```ts
// full-offer-mapper.test.ts
import { EventEmitter } from "node:events";
import type { BrowserSession } from "../../../base/playwright-base.js";
import { PzbukPlaywrightScraper } from "../index.js";
import { emptyDiagnostics } from "../ws-protocol.js";
import { listingMessage, listingEvents, offerState } from "./helpers/direct-fixture.js";
const h = vi.hoisted(() => ({ resolveCapture: (_s: unknown) => {} }));
vi.mock("../navigation.js", async (orig) => ({
  ...(await orig<typeof import("../navigation.js")>()),
  navigateToLeaguePage: vi.fn(async () => true),
  navigateToEventPage: vi.fn(async (_p: unknown, url: string) => {
    h.resolveCapture({ state: url.includes("/events/4408475-") ? offerState() : null, diagnostics: emptyDiagnostics() });
    return true;
  }),
  captureWebSocketData: vi.fn((_p: unknown, single?: boolean) => single
    ? new Promise((r) => { h.resolveCapture = r; })
    : Promise.resolve({ state: listingMessage().payload[0].payload, diagnostics: emptyDiagnostics() })),
  delay: vi.fn(async () => {}),
}));
// EventEmitter + mainFrame/url/title, so observability's navigation recorder can attach
class OfflineBrowserScraper extends PzbukPlaywrightScraper {
  protected override async initBrowser(): Promise<BrowserSession> {
    const page = Object.assign(new EventEmitter(), { mainFrame: () => null, url: () => "about:blank", title: async () => "" });
    return { page, browser: {}, context: {}, cleanup: async () => {} } as unknown as BrowserSession;
  }
}
const runBrowserPath = () => new OfflineBrowserScraper().scrapeFullOffer("premier-league");
afterEach(() => vi.restoreAllMocks());

describe("pzbuk browser path on the recorded snapshots", () => {
  it("maps only the event whose capture has markets and keeps the recovery failure lines", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runBrowserPath();
    expect(r).toMatchObject({ success: true, bookmaker: "pzbuk", league: "premier-league" });
    expect(r.matches.map(({ markets, scrapedAt, ...m }) => ({ ...m, markets: markets.length,
      selections: markets.reduce((a, x) => a + x.selections.length, 0), at: scrapedAt instanceof Date }))).toEqual([{
      matchId: 4408475, bookmaker: "pzbuk", homeTeam: "Everton", awayTeam: "Coventry City",
      eventUrl: "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-premier-league/events/4408475-everton-fc-coventry-city",
      startTime: "2026-11-06T20:00:00Z", markets: 38, selections: 222, at: true }]);
    expect(log.mock.calls.flat().join("\n")).toContain("[PZBuk/FullOffer] Everton FC vs Coventry City: 38 markets (groups 0/0) (frames: invalid 0, chunked 0, max 0 B)");
    expect(warn.mock.calls.flat().join("\n")).toContain('[PZBuk/FullOffer] Leeds United vs Tottenham Hotspur: no socket matched "sportsbook-api/ws" (sockets seen: none)');
  });
});
```

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/full-offer-mapper.test.ts`
Expected: PASS (1 test) on the unchanged code. This is the oracle.
- The 38 / 222 values were computed by the plan writer on 377b47e's `parseAllMarkets`, `getCanonicalTeamName` and `buildEventUrl`. Between there and integration, pzbuk.md Tasks 3–4 changed only `PZBUK_ID_LABELS` names and the legacy helpers, so the counts are expected to hold.
- If the run fails, stop: the fixture or the mock is wrong, not the code. If only a count differs, re-derive it from the unchanged code and update the literal before Step 2.

- [ ] **Step 2: Add the mapping tests and confirm they fail**

```ts
import { mapEventOffer, buildPzbukMatchOffer } from "../full-offer-mapper.js";
import { parseTeamNames, parseAllMarkets } from "../parser.js";
describe("mapEventOffer", () => {
  const at = new Date("2026-11-06T16:17:11Z");
  it("reproduces the browser path byte for byte", async () => {
    const [old] = (await runBrowserPath()).matches;
    expect(JSON.stringify(mapEventOffer(listingEvents()[0], offerState(), "premier-league", old.scrapedAt))).toBe(JSON.stringify(old));
  });
  it("buildPzbukMatchOffer is the browser push given the parsed markets", () => {
    const ev = listingEvents()[0]; const teams = parseTeamNames(ev); const markets = parseAllMarkets(offerState(), ev.id, teams);
    expect(buildPzbukMatchOffer(ev, teams, markets, "premier-league", at)).toEqual(mapEventOffer(ev, offerState(), "premier-league", at));
  });
  it("keeps real API names and raw selection labels", () => {
    const m = mapEventOffer(listingEvents()[0], offerState(), "premier-league", at)!;
    expect(m.markets.filter((x) => /^Rynek \d+$/.test(x.name))).toEqual([]);
    const x12 = m.markets.find((x) => x.bookmakerMarketId === "1")!;
    expect([x12.name, x12.selections.map((s) => [s.name, s.odds])]).toEqual(["1x2", [["Everton FC", 1.66], ["Remis", 3.92], ["Coventry City", 4.91]]]);
  });
  it("returns null when the event has no parsed markets", () =>
    expect(mapEventOffer(listingEvents()[1], { events: [], markets: [], selections: [] }, "premier-league", at)).toBeNull());
  it("returns null for a suspended event", () =>
    expect(mapEventOffer({ ...listingEvents()[0], isSuspended: true }, offerState(), "premier-league", at)).toBeNull());
});
```

Run: same command. Expected: FAIL; the suite does not load (`Cannot find module '…/full-offer-mapper.js'`).

- [ ] **Step 3: Implement `buildPzbukMatchOffer`/`mapEventOffer` and switch the browser push to the builder.** Move the object literal of `index.ts:427-436` into `buildPzbukMatchOffer` as it is. In `scrapeFullOffer`, replace only that `matches.push({...})` with `matches.push(buildPzbukMatchOffer(event, teams, markets, leagueSlug, new Date()))`; everything around it stays. Delete the cache lines listed under Files and drop the now-unused imports.

- [ ] **Step 4: Run it and confirm it passes**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk && $HEAVY npx tsc --noEmit`
Expected: 6 passed in `full-offer-mapper.test.ts`, plus the existing pzbuk tests (capture, parser, ws-protocol, smoke-script) unchanged; tsc exit 0.

- [ ] **Step 5: Confirm the cache is gone**

Run: `grep -n "eventsCache\|updateCache\|getCachedEvent\|ScraperCache" src/scrapers/bookmakers/pzbuk/index.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
$HEAVY npx tsc --noEmit && $HEAVY npx vitest run
git add src/scrapers/bookmakers/pzbuk/full-offer-mapper.ts src/scrapers/bookmakers/pzbuk/index.ts src/scrapers/bookmakers/pzbuk/__tests__/full-offer-mapper.test.ts
git commit -m "refactor(pzbuk): extract the event-to-FullMatchOffer mapping and drop the write-only events cache"
```

### Task 3: Direct protocol reducer

**Files:**
- Create: `src/scrapers/bookmakers/pzbuk/ws-direct.ts`
- Modify: `src/scrapers/bookmakers/pzbuk/ws-protocol.ts:308` (`export function lastFrameDetails`; no other change)
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/ws-direct.test.ts`

**Interfaces:**
- Consumes: `FrameAssembler`, `decodeFrame`, `initialStatesOf`, `CaptureDiagnostics`, `emptyDiagnostics`, `lastFrameDetails` (pzbuk.md Tasks 1–2, unchanged apart from the export); `isValidEvent` (`parser.ts:799`); `groupCoverage`, `isCoverageComplete` (Task 1); `DEFAULT_USER_AGENT` (plan 02 `src/scrapers/shared/http/http-client.ts`).
- Produces:
  ```ts
  export const PZBUK_WS_URL = "wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl";
  export const PZBUK_WS_HEADERS: Readonly<Record<string, string>>; // { origin: "https://www.pzbuk.pl", "user-agent": DEFAULT_USER_AGENT }
  export const LISTING_STREAM_ID = 1, OFFER_STREAM_ID = 3, PZBUK_DEFAULT_CHUNK_SIZE = 1_048_576;
  export function listingSubscribe(leagueId: number): string;
  export function offerSubscribe(eventIds: ReadonlyArray<string | number>): string; // ids serialized as given (numbers on the wire)
  export function closeStream(streamId: number): string;
  export interface DirectSessionState {
    assembler: FrameAssembler; pendingBytes: number;          // bytes pushed since the last complete message
    listing: PZBukInitialState | null; targetIds: Array<string | number>;
    offerEvents: Map<string, PZBukEvent>; offerMarkets: Map<string, PZBukMarket>;
    offerSelections: Map<string, PZBukSelection>; offerMessages: number; // INITIAL_STATE messages merged on stream 3
    diagnostics: CaptureDiagnostics;   // pzbuk.md Task 2's type: emptyDiagnostics() with socketUrls [PZBUK_WS_URL], matchedSockets 1
  }
  export function initialDirectState(): DirectSessionState;   // assembler pre-set to PZBUK_DEFAULT_CHUNK_SIZE
  export function reduceDirectFrame(state: DirectSessionState, frame: Buffer, leagueId: number, send: (data: string) => void): DirectSessionState; // mutates and returns state
  export function isDirectSessionDone(state: DirectSessionState): boolean;
  export function offerFor(state: DirectSessionState, eventId: string | number): PZBukInitialState; // events: [offer event ?? listing event], that event's markets + selections
  export function coverageFor(state: DirectSessionState, eventId: string | number): GroupCoverage;
  export function describeDirectState(state: DirectSessionState): string;
  // `frames: ${d.framesReceived}, invalid: ${d.invalidFrames}` + lastFrameDetails(d) (", last error: …", ", last control: TYPE[ message]")
  //   + `, buffered: ${pendingBytes} bytes` when pendingBytes > 0
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// ws-direct.test.ts
import { initialDirectState, reduceDirectFrame, isDirectSessionDone, offerFor, coverageFor, describeDirectState, PZBUK_WS_URL } from "../ws-direct.js";
import { describeCoverage } from "../offer-coverage.js";
import { fx, wire, chunk, listingMessage, offerMessage, SETUP_32K } from "./helpers/direct-fixture.js";
const SETUP = wire(fx.messages[0]);
const LISTING_SUB = '{"type":"SUBSCRIBE","streamId":1,"route":"events","version":1,"payload":{"filters":{"sportIds":[1],"leagueIds":[134],"eventTypes":["Fixture"],"marketTypeFilters":[],"isLive":false},"orders":[2,5]}}';
const CLOSE_1 = '{"type":"CLOSE","streamId":1,"reason":"NORMAL","message":null}';
const offerSub = (ids: number[]) => `{"type":"SUBSCRIBE","streamId":3,"route":"events","version":1,"payload":{"filters":{"eventIds":[${ids.join(",")}],"includeEntities":["MARKET","SELECTION"]}}}`;
const run = (frames: Buffer[]) => {
  const sent: string[] = []; const done: boolean[] = []; let s = initialDirectState();
  for (const f of frames) { s = reduceDirectFrame(s, f, 134, (d) => sent.push(d)); done.push(isDirectSessionDone(s)); }
  return { s, sent, done };
};

describe("pzbuk direct session reducer", () => {
  it("subscribes the league listing with the site's own sidebar filter after SETUP", () =>
    expect(run([SETUP]).sent).toEqual([LISTING_SUB]));
  it("closes the listing stream and subscribes the offer for every target event", () => {
    const { s, sent, done } = run([SETUP, wire(listingMessage())]);
    expect(sent).toEqual([LISTING_SUB, CLOSE_1, offerSub([4408475, 4408509, 4408525])]);
    expect([s.targetIds, done.at(-1)]).toEqual([[4408475, 4408509, 4408525], false]);
    expect(s.diagnostics).toMatchObject({ socketUrls: [PZBUK_WS_URL], matchedSockets: 1, initialStates: 1, maxEvents: 3 });
  });
  it("reassembles 32 KiB chunks and is done on the last offer chunk", () => {
    const offerChunks = chunk(wire(offerMessage()), 32768);
    const { s, done } = run([SETUP_32K, ...chunk(wire(listingMessage([4408475])), 32768), ...offerChunks]);
    expect(offerChunks.map((c) => c.length)).toEqual([32768, 32768, 32768, 11284]);
    expect(done).toEqual([false, false, false, false, false, true]);
    expect([offerFor(s, 4408475).markets.length, offerFor(s, 4408475).selections.length]).toEqual([45, 222]);
    expect([s.diagnostics.framesReceived, s.diagnostics.chunkedFrames, s.diagnostics.maxFrameBytes]).toEqual([6, 3, 109588]);
  });
  it("never completes while a listed event is missing from the offer", () => {
    const { s, done } = run([SETUP, wire(listingMessage()), wire(offerMessage())]);
    expect(done.at(-1)).toBe(false);
    expect(describeCoverage(coverageFor(s, 4408509))).toBe("groups 0/10, markets counted 0/235");
    expect(offerFor(s, 4408509)).toMatchObject({ markets: [], selections: [] });
  });
  it("prefers the offer event's marketGroups over the listing's", () => {
    const listing = listingMessage([4408475]); // the listing copy alone also declares Gole (24)
    listing.payload[0].payload.events[0].marketGroups["2"] = { id: 2, name: "Gole ", order: 5, marketsCount: 24 };
    expect(run([SETUP, wire(listing), wire(offerMessage())]).done.at(-1)).toBe(true);
  });
  it("does not target an event that declares no market groups", () => {
    const listing = listingMessage([4408475, 4408509]); listing.payload[0].payload.events[1].marketGroups = {};
    const { s, sent } = run([SETUP, wire(listing)]);
    expect([s.targetIds, sent.at(-1)]).toEqual([[4408475], offerSub([4408475])]);
  });
  it("ignores deltas and foreign streams and merges a split offer by id", () => {
    const st = offerMessage().payload[0].payload; const first = new Set(st.markets.slice(0, 22).map((m: any) => m.id));
    const part = (ms: any[], ss: any[]) => wire({ type: "DATA", streamId: 3, payload: [{ type: "INITIAL_STATE", payload: { ...st, markets: ms, selections: ss } }] });
    const delta = Buffer.from('{"type":"DATA","streamId":3,"payload":[{"type":"SELECTION_DELTA","payload":{"id":1,"trueOdds":1.7}}]}');
    const { s, done } = run([SETUP, wire(listingMessage([4408475])), delta, wire({ ...offerMessage(), streamId: 9 }),
      part(st.markets.slice(0, 22), st.selections.filter((x: any) => first.has(x.marketId))),
      part(st.markets.slice(22), st.selections.filter((x: any) => !first.has(x.marketId)))]);
    expect(done).toEqual([false, false, false, false, false, true]);
    expect([s.offerMessages, offerFor(s, 4408475).markets.length, offerFor(s, 4408475).selections.length]).toEqual([2, 45, 222]);
  });
  it("records invalid frames, the last control frame and buffered bytes", () => {
    const { s } = run([SETUP, Buffer.from("garbage"), Buffer.from('{"type":"ERROR","streamId":3,"message":"Unknown route"}'), Buffer.alloc(1048576, 0x20)]);
    expect(describeDirectState(s)).toBe("frames: 4, invalid: 1, last error: not JSON, last control: ERROR Unknown route, buffered: 1048576 bytes");
    expect(s.diagnostics).toMatchObject({ framesReceived: 4, invalidFrames: 1, chunkedFrames: 1, lastInvalidError: "not JSON", lastControl: { type: "ERROR", message: "Unknown route" } });
  });
  it("is done after an empty listing without subscribing an offer", () => {
    const { s, sent, done } = run([SETUP, wire(listingMessage([]))]);
    expect([sent, done.at(-1)]).toEqual([[LISTING_SUB, CLOSE_1], true]);
    expect([s.diagnostics.initialStates, s.diagnostics.maxEvents]).toEqual([1, 0]);   // isEmptyListing(s.diagnostics) === true
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/ws-direct.test.ts`
Expected: FAIL; the suite does not load (`Cannot find module '…/ws-direct.js'`).

- [ ] **Step 3: Implement `reduceDirectFrame` in `ws-direct.ts`** (and export `lastFrameDetails` from `ws-protocol.ts`). The step-by-step rule, with `d = state.diagnostics`:

```text
d.framesReceived++; pendingBytes += frame.length; text = assembler.push(frame)
text === null → d.chunkedFrames++; return
pendingBytes = 0; d.maxFrameBytes = max(d.maxFrameBytes, Buffer.byteLength(text)); f = decodeFrame(text)
setup   → assembler.setChunkSize(f.chunkSize || PZBUK_DEFAULT_CHUNK_SIZE); send(listingSubscribe(leagueId))
invalid → d.invalidFrames++, d.lastInvalidError = f.error
control → d.lastControl = { type, message }
data    → for each st of initialStatesOf(f): d.initialStates++, d.maxEvents = max(d.maxEvents, st.events.length), then
  stream 1 and listing === null → listing = st
       targetIds = ids of st.events with isValidEvent(e) && Object.keys(e.marketGroups ?? {}).length > 0 (listing order)
       send(closeStream(1)); if targetIds.length > 0 → send(offerSubscribe(targetIds))
  stream 3 → offerMessages++; merge st.events / st.markets / st.selections into the maps keyed by String(id)
  any other stream, a second listing, or non-INITIAL_STATE messages → ignored
done = listing !== null && targetIds.every((id) => isCoverageComplete(coverageFor(state, id)))
coverageFor(id) = groupCoverage(offerEvents.get(id) with marketGroups ?? the listing event, markets with String(eventId) === String(id))
```

The message builders produce exactly the test literals: `JSON.stringify` of the objects in the order `type, streamId, route, version, payload`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk && $HEAVY npx tsc --noEmit`
Expected: 9 passed in `ws-direct.test.ts`, the other pzbuk tests unchanged; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
$HEAVY npx tsc --noEmit && $HEAVY npx vitest run
git add src/scrapers/bookmakers/pzbuk/ws-direct.ts src/scrapers/bookmakers/pzbuk/ws-protocol.ts src/scrapers/bookmakers/pzbuk/__tests__/ws-direct.test.ts
git commit -m "feat(pzbuk): direct sportsbook-api/ws session reducer (listing + one offer subscription)"
```

### Task 4: `PzbukWsScraper`

**Files:**
- Create: `src/scrapers/bookmakers/pzbuk/ws-scraper.ts`
- Create: `src/scrapers/bookmakers/pzbuk/__tests__/helpers/scripted-ws-session.ts`
- Modify: `src/scrapers/bookmakers/pzbuk/ws-protocol.ts`: add `PzbukFrameCounters`, `emptyFrameCounters`, `addFrameCounters` next to `CaptureDiagnostics`.
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/ws-scraper.test.ts`

**Interfaces:**
- Consumes (§3):
  - `openWsSession`, `WsSession`, `WsSessionOptions` (`src/scrapers/shared/ws/ws-session.ts`);
  - `ScrapeBudget`, `createScrapeBudget` (`shared/budget.ts`);
  - `FullOfferScraper`, `DEFAULT_MAX_DURATION_MS`, `TransportStats`, `TransportStatsSource`, `hasTransportStats` (`shared/scraper-contract.ts`); plan 07 `DeclaresTransport` (duck type);
  - `MAX_SKIPPED_DETAIL_RATIO` (`shared/detail-fetch.ts`);
  - `getBookmakerLeagueId`, `isLeagueSupported` (`config/leagues.ts:162, :178`);
  - Task 1–3 exports.

  Plan 02 Task 8 guarantees what this task relies on:
  - Frames that arrive before the first `collect`, such as SETUP about 4 ms after `open`, are queued and replayed.
  - `collect` resolves `{ timedOut: true }` on timeout. It rejects with `ws closed <code> <url>` on a close, with `BudgetExceededError` on a budget abort, and with any error thrown by `reduce`.
  - Pre-handshake errors reject `openWsSession` with `ws failed <code> <url>`.
  - `ws` keeps its 100 MiB default `maxPayload`. `reduce` may call `session.send` synchronously; `send` throws `ws closed …` only on a closed socket.
- Produces:
  ```ts
  // ws-protocol.ts (the browser class's local `type TransportStats` at index.ts:45, renamed and moved here; Task 5 switches the browser class to it)
  export type PzbukFrameCounters = Pick<CaptureDiagnostics, "invalidFrames" | "chunkedFrames" | "maxFrameBytes">;
  export function emptyFrameCounters(): PzbukFrameCounters;
  export function addFrameCounters(into: PzbukFrameCounters, d: CaptureDiagnostics): void; // sums invalid/chunked, max of maxFrameBytes
  // ws-scraper.ts
  export const PZBUK_CONNECT_TIMEOUT_MS = 10_000;
  export const PZBUK_COLLECT_TIMEOUT_MS = 15_000;
  export interface PzbukWsDeps { openSession?: (opts: WsSessionOptions) => Promise<WsSession>; retryDelayMs?: () => number } // defaults: openWsSession, () => Math.floor(Math.random() * 500)
  export class PzbukWsScraper implements FullOfferScraper, TransportStatsSource {
    readonly bookmaker: PolishBookmaker;   // "pzbuk"
    readonly transport = "websocket" as const;   // plan 07 DeclaresTransport (cross-plan #19)
    constructor(deps?: PzbukWsDeps);
    scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult>;
    transportStats(): TransportStats;      // { ws: { framesReceived, bytesReceived } }: CUMULATIVE since construction (README §3: monotonic; consumers diff), a copy; every attempt's session stats are added
    frameCounters(): PzbukFrameCounters;   // CUMULATIVE since construction: addFrameCounters over every attempt's state.diagnostics; a copy
    cleanup(): Promise<void>;              // no-op
  }
  // __tests__/helpers/scripted-ws-session.ts (test-only)
  export interface ScriptStep { after: "open" | RegExp; frames: Buffer[] }
  export interface ScriptedSession extends WsSession { sent: string[]; timeouts: number[]; closed: boolean }
  export function scriptedSession(steps: ScriptStep[], opts?: { failWith?: Error }): ScriptedSession;
  // collect: queues the "open" step's frames, feeds queued frames through reduce in order (isBinary = true) and checks done after each;
  // a send() matching the next unconsumed step's RegExp appends that step's frames; when the queue drains before done it
  // rejects with opts.failWith if given, else resolves { state, timedOut: true }; pushes timeoutMs to `timeouts`; close() sets closed;
  // `stats` counts delivered frames and their bytes.
  ```
- Log lines (A7′ and Task 7 read them):
  - `[PZBuk/FullOffer] Found <n> events in listing` (the same text as `index.ts:370-372`);
  - `[PZBuk/FullOffer] <home> vs <away>: <parsed> markets (<describeCoverage>)`;
  - `console.warn("[PZBuk/FullOffer] skipped <reason>")`;
  - `[PZBuk/FullOffer] listing is empty`;
  - `[PZBuk/WS] <framesReceived> frames, <bytesReceived> bytes in <ms>ms[ (timed out)]`, using `session.stats`;
  - `[PZBuk/FullOffer] Completed: <n> matches, <m> total markets` (the same text as `index.ts:462-465`);
  - on failure, `console.error("[pzbuk] Full offer scraper error: <error>")`, the same line as `HttpScraper` and observability's `playwright-base.ts:302`.
- Skip reasons follow `<id> <home> vs <away>: <kind>`, where the names come from `parseTeamNames` and `<kind>` is one of `not in offer (<describeCoverage>)`, `incomplete (<describeCoverage>)`, `no market groups declared` or `0 parsed markets`. The result follows plan 02's `HttpScraper` template, steps 4–5:
  - `error = "<n> of <m> details failed | <first reason>"`;
  - more than half skipped → `{ success:false, matches:[], error }`;
  - otherwise `{ success:true, matches, error }`;
  - no skips → no `error` key.

- [ ] **Step 1: Write the failing tests**

```ts
// ws-scraper.test.ts
import { PzbukWsScraper } from "../ws-scraper.js";
import { PZBUK_WS_URL, PZBUK_WS_HEADERS } from "../ws-direct.js";
import { mapEventOffer } from "../full-offer-mapper.js";
import { createScrapeBudget } from "../../../shared/budget.js";
import { hasTransportStats } from "../../../shared/scraper-contract.js";
import { browserPool } from "../../../base/browser-pool.js";
import { scriptedSession } from "./helpers/scripted-ws-session.js";
import { wire, chunk, listingMessage, listingEvents, offerMessage, offerState, SETUP_32K } from "./helpers/direct-fixture.js";
const SUB1 = /^\{"type":"SUBSCRIBE","streamId":1,/, SUB3 = /^\{"type":"SUBSCRIBE","streamId":3,/;
const ERROR_3 = Buffer.from('{"type":"ERROR","streamId":3,"message":"Unknown route"}');
const happy = (ids = [4408475]) => scriptedSession([{ after: "open", frames: [SETUP_32K] },
  { after: SUB1, frames: chunk(wire(listingMessage(ids)), 32768) }, { after: SUB3, frames: chunk(wire(offerMessage()), 32768) }]);
const make = (...attempts: Array<ReturnType<typeof scriptedSession> | Error>) => {
  const open = vi.fn();
  for (const a of attempts) a instanceof Error ? open.mockRejectedValueOnce(a) : open.mockResolvedValueOnce(a);
  return { open, scraper: new PzbukWsScraper({ openSession: open, retryDelayMs: () => 0 }) };
};
const strip = (m: object) => ({ ...m, scrapedAt: null });
afterEach(() => vi.restoreAllMocks());

describe("PzbukWsScraper", () => {
  it("maps a complete event exactly like the browser path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const session = happy(); const { open, scraper } = make(session);
    const r = await scraper.scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, bookmaker: "pzbuk", league: "premier-league" });
    expect(scraper.transport).toBe("websocket");
    expect(r.matches.map(strip)).toEqual([strip(mapEventOffer(listingEvents()[0], offerState(), "premier-league", new Date())!)]);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ url: PZBUK_WS_URL, headers: PZBUK_WS_HEADERS, connectTimeoutMs: 10_000 }));
    expect([session.sent.length, session.closed, typeof r.duration, "error" in r]).toEqual([3, true, "number", false]);
    expect(log.mock.calls.flat().join("\n")).toContain("[PZBuk/FullOffer] Everton FC vs Coventry City: 38 markets (groups 2/2, markets counted 52/52)");
  });
  it("reports ws transport counters and frame counters", async () => {
    const { scraper } = make(happy()); await scraper.scrapeFullOffer("premier-league");
    expect(hasTransportStats(scraper)).toBe(true);
    expect(scraper.transportStats()).toEqual({ ws: { framesReceived: 6, bytesReceived: 120_723 } }); // 34 + 11 101 + 109 588
    expect(scraper.frameCounters()).toEqual({ invalidFrames: 0, chunkedFrames: 3, maxFrameBytes: 109_588 });
  });
  it("counters are cumulative across calls (README §3: monotonic; consumers diff)", async () => {
    const { scraper } = make(happy(), happy());
    await scraper.scrapeFullOffer("premier-league"); await scraper.scrapeFullOffer("premier-league");
    expect(scraper.transportStats()).toEqual({ ws: { framesReceived: 12, bytesReceived: 241_446 } });
    expect(scraper.frameCounters()).toEqual({ invalidFrames: 0, chunkedFrames: 6, maxFrameBytes: 109_588 });
  });
  it("skips incomplete events and fails when more than half are skipped", async () => {
    const r = await make(happy([4408475, 4408509, 4408525])).scraper.scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, matches: [],
      error: "2 of 3 details failed | 4408509 Leeds United vs Tottenham Hotspur: not in offer (groups 0/10, markets counted 0/235)" });
  });
  it("succeeds with one skipped event out of two (0.5 is not above the limit) and keeps the cause", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await make(happy([4408475, 4408509])).scraper.scrapeFullOffer("premier-league");
    expect([r.success, r.matches.length, r.error]).toEqual([true, 1,
      "1 of 2 details failed | 4408509 Leeds United vs Tottenham Hotspur: not in offer (groups 0/10, markets counted 0/235)"]);
    expect(warn.mock.calls.flat().join("\n")).toContain("[PZBuk/FullOffer] skipped 4408509 Leeds United vs Tottenham Hotspur: not in offer (groups 0/10, markets counted 0/235)");
  });
  it("returns success with no matches for an empty listing", async () => {
    const session = happy([]);
    expect(await make(session).scraper.scrapeFullOffer("premier-league")).toMatchObject({ success: true, matches: [] });
    expect(session.sent).toHaveLength(2);
  });
  it("passes a handshake 4xx through in ws wording without retrying", async () => {
    const { open, scraper } = make(new Error(`ws handshake HTTP 403 ${PZBUK_WS_URL}`));
    expect(await scraper.scrapeFullOffer("premier-league")).toMatchObject({ success: false, matches: [], error: `ws handshake HTTP 403 ${PZBUK_WS_URL}` });
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("retries once after the socket drops", async () => {
    const dropped = scriptedSession([{ after: "open", frames: [SETUP_32K] }], { failWith: new Error(`ws closed 1006 ${PZBUK_WS_URL}`) });
    const { open, scraper } = make(dropped, happy());
    expect((await scraper.scrapeFullOffer("premier-league")).success).toBe(true);
    expect([open.mock.calls.length, dropped.closed]).toEqual([2, true]);
  });
  it("retries a refused connection once, then reports it", async () => {
    const refused = () => new Error(`ws failed ECONNREFUSED ${PZBUK_WS_URL}`);
    const { open, scraper } = make(refused(), refused());
    expect((await scraper.scrapeFullOffer("premier-league")).error).toBe(`ws failed ECONNREFUSED ${PZBUK_WS_URL}`);
    expect(open).toHaveBeenCalledTimes(2);
  });
  it("names the phase when no listing arrives, after one retry", async () => {
    const setupOnly = () => scriptedSession([{ after: "open", frames: [SETUP_32K] }]);
    const { open, scraper } = make(setupOnly(), setupOnly());
    expect((await scraper.scrapeFullOffer("premier-league")).error).toBe(`ws timeout 15000ms ${PZBUK_WS_URL} | no listing (frames: 1, invalid: 0)`);
    expect(open).toHaveBeenCalledTimes(2);
  });
  it("names the last control frame when the offer never arrives", async () => {
    const noOffer = () => scriptedSession([{ after: "open", frames: [SETUP_32K] },
      { after: SUB1, frames: [wire(listingMessage([4408475]))] }, { after: SUB3, frames: [ERROR_3] }]);
    expect((await make(noOffer(), noOffer()).scraper.scrapeFullOffer("premier-league")).error)
      .toBe(`ws timeout 15000ms ${PZBUK_WS_URL} | no offer for 1 event(s) (frames: 3, invalid: 0, last control: ERROR Unknown route)`);
  });
  it("bounds the collect timeout by the remaining budget", async () => {
    const session = happy();
    await make(session).scraper.scrapeFullOffer("premier-league", createScrapeBudget(2_000));
    expect(session.timeouts[0]).toBeLessThanOrEqual(2_000);
  });
  it("rejects an unsupported league without opening a socket", async () => {
    const { open, scraper } = make();
    expect(await scraper.scrapeFullOffer("bundesliga")).toMatchObject({ success: false, matches: [], error: "Unknown league: bundesliga" });
    expect(open).not.toHaveBeenCalled();
  });
  it("never touches the browser pool", async () => {
    const acquire = vi.spyOn(browserPool, "acquire");
    await make(happy()).scraper.scrapeFullOffer("premier-league");
    expect(acquire).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/ws-scraper.test.ts`
Expected: FAIL; the suite does not load (`Cannot find module '…/ws-scraper.js'`).

- [ ] **Step 3: Implement the frame-counter helpers, the scripted session helper and `PzbukWsScraper.scrapeFullOffer`.** One attempt:

```text
session = openSession({ url: PZBUK_WS_URL, headers: PZBUK_WS_HEADERS, budget, connectTimeoutMs: PZBUK_CONNECT_TIMEOUT_MS })
ms = min(PZBUK_COLLECT_TIMEOUT_MS, budget.remainingMs())
state = initialDirectState()      // held here: reduceDirectFrame mutates it, so it is readable even when collect rejects
{ timedOut } = session.collect(state, (s, f) => reduceDirectFrame(s, f, leagueId, (d) => session.send(d)), isDirectSessionDone, ms)
finally: add session.stats to the ws totals, addFrameCounters(this.counters, state.diagnostics), session.close()
timedOut && listing === null                       → attempt error `ws timeout ${ms}ms ${PZBUK_WS_URL} | no listing (${describeDirectState})`
timedOut && targets > 0 && offerMessages === 0     → attempt error `ws timeout ${ms}ms ${PZBUK_WS_URL} | no offer for ${targets} event(s) (${describeDirectState})`
```

- Retry rule: retry once, after `retryDelayMs()` and `budget.checkpoint()`, when the attempt error matches `/^ws (failed|closed|timeout) /` or `/^ws handshake HTTP (429|5\d\d) /`, and only while `budget.remainingMs() >= PZBUK_COLLECT_TIMEOUT_MS`. Never retry on `BudgetExceededError`. The reported error is the last attempt's. Both counters (`transportStats()`, `frameCounters()`) sum over every attempt and never reset.
- League gate:
  - `!isLeagueSupported(league, "pzbuk")` → `success:false`, `error: "Unknown league: <slug>"`.
  - Otherwise `leagueId = Number(getBookmakerLeagueId(league, "pzbuk"))`, and the budget defaults to `createScrapeBudget(DEFAULT_MAX_DURATION_MS.websocket)`.
- Mapping:
  - Walk `listing.events` in order, ignoring `!isValidEvent` events as today.
  - Each remaining event is skipped with its reason, or mapped with `mapEventOffer(event, offerFor(state, event.id), league, scrapedAt)`.
  - Apply the ratio rule last. `duration` is always set.
  - Log the lines listed under Interfaces.

- [ ] **Step 4: Run it and confirm it passes**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk && $HEAVY npx tsc --noEmit`
Expected: 14 passed in `ws-scraper.test.ts`, all other pzbuk tests green; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
$HEAVY npx tsc --noEmit && $HEAVY npx vitest run
git add src/scrapers/bookmakers/pzbuk/ws-scraper.ts src/scrapers/bookmakers/pzbuk/ws-protocol.ts src/scrapers/bookmakers/pzbuk/__tests__/ws-scraper.test.ts src/scrapers/bookmakers/pzbuk/__tests__/helpers/scripted-ws-session.ts
git commit -m "feat(pzbuk): browserless full-offer scraper over one sportsbook-api/ws session"
```

### Task 5: Transport selection; old class becomes `PzbukBrowserScraper` (data flow starts here)

**Files:**
- Rename: `src/scrapers/bookmakers/pzbuk/index.ts` → `browser-scraper.ts` (`git mv`). In it:
  - rename the class at `:61` to `PzbukBrowserScraper` and delete `export const pzbukScraper` at `:498`;
  - replace the local `type TransportStats`/`emptyTransportStats` (`:45-47`) with `PzbukFrameCounters`/`emptyFrameCounters` from `ws-protocol.ts`;
  - replace `lastTransportStats` (`:64-69`) and its per-call reset (`:323`) with a private cumulative `counters` plus `frameCounters(): PzbukFrameCounters` (a copy);
  - `addTransportStats` (`:100-105`) calls `addFrameCounters(this.counters, diagnostics)`.
- Create: `src/scrapers/bookmakers/pzbuk/index.ts`
- Modify (the pick and **every** direct importer, README §3 one-pick rule):
  - `src/scrapers/bookmakers/index.ts:19`: the pick.
  - `src/services/audit/bookmaker-registry.ts:14`, `scripts/pzbuk-market-discovery.ts:14`, `scripts/pzbuk-prep-audit.ts:17`: import `pzbukScraper` from `…/scrapers/bookmakers/index.js`.
  - `scripts/pzbuk-smoke.ts`:
    - `:38` imports `pzbukScraper` from `../src/scrapers/bookmakers/index.js`, plus `hasFrameCounters` and `type PzbukFrameCounters` from `../src/scrapers/bookmakers/pzbuk/index.js`;
    - `:78` becomes `type FrameCounters = PzbukFrameCounters` and the `summarize` input field type follows;
    - `:376-378` read `before = frameCountersOf(pzbukScraper)` before and `after` after the one `scrapeFullOffer` call, and report `{ invalidFrames: after − before, chunkedFrames: after − before, maxFrameBytes: after.maxFrameBytes }`. The smoke makes one call per process, so the max is that call's;
    - doc comment `:5-6` and USAGE `:75`: "calls pzbuk.pl over its WebSocket API (a browser only with `SCRAPER_TRANSPORT_PZBUK=browser`)"; `:29-31`: A8 `durationMs` < 3 000 on the default transport (≤ 600 000 on the browser);
    - the SMOKE JSON schema and every threshold stay unchanged.
  - `scripts/test-scrapers.sh:34` → `PzbukBrowserScraper`.
  - `src/scripts/analyze-bookmaker-markets.ts:36,41`: map typed `FullOfferScraper`, which needs only `scrapeFullOffer` and `cleanup` (`:122, :246`). Skip this if an earlier plan already did it.
  - `__tests__/full-offer-mapper.test.ts`: import `PzbukBrowserScraper` from `../browser-scraper.js`.
- Unchanged but verified: `src/scrapers/bookmakers/pzbuk/__tests__/smoke-script.test.ts` (it imports `scripts/pzbuk-smoke.ts`, which now loads `bookmakers/index.js` transitively, without network) and `scripts/match-audit-raw-capture.ts:57` (reads through `bookmakers/index.js`).
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/transport.test.ts`

**Interfaces:**
- Consumes: `getTransportOverride(bookmaker, env?)` (§3, `src/config/transport.ts`); plan 02's `SCRAPERS: Record<PolishBookmaker, FullOfferScraper>` in `aggregator.ts`; `PzbukFrameCounters`, `emptyFrameCounters`, `addFrameCounters` (Task 4).
- Produces:
  ```ts
  // pzbuk/index.ts
  export { PzbukBrowserScraper } from "./browser-scraper.js";
  export { PzbukWsScraper } from "./ws-scraper.js";
  export type { PzbukFrameCounters } from "./ws-protocol.js";
  export interface PzbukFrameCounterSource { frameCounters(): PzbukFrameCounters }        // both classes; cumulative since construction
  export function hasFrameCounters(s: FullOfferScraper): s is FullOfferScraper & PzbukFrameCounterSource;
  export function createPzbukScraper(env?: NodeJS.ProcessEnv): FullOfferScraper; // "browser" → PzbukBrowserScraper, else PzbukWsScraper
  // bookmakers/index.ts:19 (the pick happens here, per README §3: plans 03, 04, 05c pick in bookmakers/index.ts)
  export { PzbukBrowserScraper, PzbukWsScraper } from "./pzbuk/index.js";
  export const pzbukScraper: FullOfferScraper = createPzbukScraper();
  ```

- [ ] **Step 1: Confirm the preconditions**

Run: `git log --oneline -3 -- src/services/normalization/bookmakers/pzbuk-normalizer.ts && grep -c "captureWebSocketData(page, true, event.id)" src/scrapers/bookmakers/pzbuk/index.ts && grep -n "Record<PolishBookmaker, FullOfferScraper>" src/scrapers/aggregator.ts`
Expected:
- pzbuk.md Task 4's commit "fix(pzbuk): route half-time, card and corner markets by their real names" (0c62652) is listed;
- the browser wiring count is 1;
- the aggregator line exists.

If any is missing, stop.

- [ ] **Step 2: Write the failing test**

```ts
// transport.test.ts
import { createPzbukScraper, hasFrameCounters, PzbukBrowserScraper, PzbukWsScraper } from "../index.js";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("pzbuk transport selection", () => {
  it("defaults to the WebSocket scraper", () => {
    const s = createPzbukScraper({});
    expect(s).toBeInstanceOf(PzbukWsScraper); expect((s as PzbukWsScraper).transport).toBe("websocket");
  });
  it("returns the browser scraper for SCRAPER_TRANSPORT_PZBUK=browser", () =>
    expect(createPzbukScraper({ SCRAPER_TRANSPORT_PZBUK: "browser" })).toBeInstanceOf(PzbukBrowserScraper));
  it("ignores any other override value", () =>
    expect(createPzbukScraper({ SCRAPER_TRANSPORT_PZBUK: "chromium" })).toBeInstanceOf(PzbukWsScraper));
  it("keeps the legacy 1X2 methods only on the browser class", () =>
    expect(["scrapeLeague" in PzbukBrowserScraper.prototype, "scrapeLeague" in PzbukWsScraper.prototype]).toEqual([true, false]));
  it("the smoke reads frame counters from either class (cumulative, both start at zero)", () => {
    for (const s of [createPzbukScraper({}), createPzbukScraper({ SCRAPER_TRANSPORT_PZBUK: "browser" })]) {
      expect(hasFrameCounters(s)).toBe(true);
      expect((s as any).frameCounters()).toEqual({ invalidFrames: 0, chunkedFrames: 0, maxFrameBytes: 0 });
      expect("lastTransportStats" in s).toBe(false);
    }
  });
  it("bookmakers/index exports the picked instance", async () => {
    vi.stubEnv("SCRAPER_TRANSPORT_PZBUK", ""); vi.resetModules();
    const all = await import("../../index.js");
    expect(all.pzbukScraper).toBeInstanceOf(all.PzbukWsScraper);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/transport.test.ts`
Expected: FAIL (`createPzbukScraper` / `PzbukBrowserScraper` / `hasFrameCounters` not exported by `../index.js`).

- [ ] **Step 4: Implement** the rename, the counter change, the new `index.ts` and the importer edits listed under Files.

- [ ] **Step 5: Run it and confirm it passes; check the scripts and the leftovers**

```bash
$HEAVY npx vitest run src/scrapers/bookmakers/pzbuk && $HEAVY npx tsc --noEmit
$HEAVY npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule scripts/pzbuk-market-discovery.ts scripts/pzbuk-prep-audit.ts scripts/pzbuk-smoke.ts
$HEAVY npx tsx scripts/pzbuk-smoke.ts --help; echo "exit=$?"
grep -rn "PzbukPlaywrightScraper\|lastTransportStats" src scripts; grep -rn "import { pzbukScraper } from .*pzbuk/index" src scripts
```
Expected:
- The tests pass: transport 6 plus the existing pzbuk tests, with `smoke-script.test.ts` green unchanged.
- Both `tsc` runs exit 0.
- `--help` prints the usage and `exit=0`, with no browser and no network.
- Both greps print nothing. The only remaining `pzbuk/index.js` imports are `src/scrapers/bookmakers/index.ts` and the type/helper import in `scripts/pzbuk-smoke.ts`.

- [ ] **Step 6: Commit**

```bash
$HEAVY npx tsc --noEmit && $HEAVY npx vitest run
git add -A src/scrapers/bookmakers/pzbuk src/scrapers/bookmakers/index.ts src/services/audit/bookmaker-registry.ts src/scripts/analyze-bookmaker-markets.ts scripts/pzbuk-market-discovery.ts scripts/pzbuk-prep-audit.ts scripts/pzbuk-smoke.ts scripts/test-scrapers.sh
git commit -m "feat(pzbuk): use the direct WebSocket client by default, keep PzbukBrowserScraper behind SCRAPER_TRANSPORT_PZBUK=browser"
```

### Task 6 (optional): Browser-path speedups

Build this only if 05c is delayed, or if `SCRAPER_TRANSPORT_PZBUK=browser` is used for more than a week (Open Question 1). These are the README §5.1 pzbuk amendments, none of which is applied on integration. Each sub-step is its own TDD cycle in `__tests__/capture.test.ts` (fake page, fake timers, as pzbuk.md Task 5's tests).

**Files:** `src/scrapers/bookmakers/pzbuk/navigation.ts:92-114, 262-480`, `browser-scraper.ts:400-409`, `__tests__/capture.test.ts`; with plan 08 landed also `src/types/scraper.ts` (pzbuk policy).

- [ ] **Step 1: Finish when every declared group answered.** In single-event mode, resolve once `accumulator.stats().marketGroupsSeen` covers `marketGroupsDeclared` (non-empty), instead of waiting for `MIN_CAPTURE_MS` 8 s + `STREAM_SILENCE_MS` 2.5 s. `WS_MAX_WAIT` stays the cap and the silence rule the fallback. Test: "resolves once every declared group answered (well before MIN_CAPTURE_MS)".
- [ ] **Step 2: Drop the "Pokaż więcej" clicks.** Delete `clickAllShowMore` (`navigation.ts:92-114`) and its call (`:423-425`). It makes up to 40 clicks with no added subscription (pzbuk.md Observations), costing 3–5 s per event. The header expansion stays. Test: "never clicks Pokaż więcej" (the fake page's `getByText` is never called).
- [ ] **Step 3: Cancel the capture on a failed navigation.** `captureWebSocketData` gains `signal?: AbortSignal`. Aborting detaches the listeners, clears the timers, stops the expansion loop and resolves with the data so far. `browser-scraper.ts:403-409` aborts instead of awaiting up to `WS_MAX_WAIT`. Test: "an aborted capture detaches its listeners and timers".
- [ ] **Step 4: Blocking: only through plan 08, or not at all** (cross-plan #23). Never use `page.route`/`context.route`: they disable the HTTP cache. Never fulfil images with a 1×1 PNG: that needs request interception, the cost plan 08 avoids.
  - If plan 08 has landed, OneTrust (`cdn-ukwest.onetrust.com`) may be blocked through its CDP `Network.setBlockedURLs` `urlPatterns`, via the pzbuk policy or `SCRAPER_BROWSER_BLOCK_PZBUK`. Measure it with plan 08 Task 8's A/B. Plan 08 Open Question 2 keeps pzbuk at `block: "none"` by default, because a CDP-blocked icon may retry like the 160× abort storm.
  - Otherwise, drop this step.
  - Never block stylesheets (0 matches).
- [ ] **Step 5: Acceptance for this path** (read-only):
  - `SCRAPER_TRANSPORT_PZBUK=browser $HEAVY --live npx tsx scripts/pzbuk-smoke.ts --league premier-league` → pzbuk.md A1–A7 hold, and `durationMs` ≤ 5 000 × events.
  - Then README §6 parity against the WS path, in the same hour: `$HEAVY --live npx tsx scripts/perf-smoke.ts --bookmaker pzbuk --baseline $PS/pzbuk-browser.json`, with the browser baseline from Task 7 Step 3. Pass: `PARITY` `matchesEqual: true, pass: true`.
- [ ] **Step 6: Commit** `perf(pzbuk): browser fallback finishes when all declared groups answered and skips the show-more clicks`.

### Task 7: Live verification (no code)

Run outside HH:55–HH:10, never while the live backend's `/api/health` shows a run in progress, one bookmaker at a time, through `$HEAVY --live`. perf-smoke and `pzbuk-smoke.ts` write no DB, so they are allowed read-only probes (EXECUTION rule 4). Outputs go to `$PS` (`.scratch`).

- [ ] **Step 1: Offline gates.** `$HEAVY npx tsc --noEmit && $HEAVY npx vitest run` → green. The golden logs for pzbuk are unchanged from pzbuk.md Task 6 (`entries=167 blessed=89 … failures=0`, `entries=155 blessed=36 … failures=0`).
- [ ] **Step 2: Perf smoke on the default transport (plan 02 Task 10).** If plan 02 builds it on observability's `scripts/smoke-bookmaker.ts`, use the final name; the flags and keys are plan 02's.
  ```bash
  mkdir -p "$PS" && T=$(date -u +%Y%m%dT%H%M)
  $HEAVY --live npx tsx scripts/perf-smoke.ts --bookmaker pzbuk --league premier-league --out $PS/pzbuk-ws-$T.json --dump $PS/pzbuk-ws-$T-raw.json 2>&1 | tee $PS/pzbuk-ws-$T.log
  ```
  Pass is exit 0, with a `PERF_SMOKE` line that shows:
  - `scraperClass: "PzbukWsScraper"`, `transportOverride: null`, `success: true`, `error: null`, `timedOut: false`, `thrown: null`;
  - `matches` = the number of valid listed fixtures, given by the log line `Found <n> events in listing` (19 on 2026-11-07);
  - `wallMs < 3000` (A8′; the probe's end-to-end was 0.81 s);
  - `memory.chromiumProcessesEver: 0` and `chromiumPeakRssMb: 0`;
  - `transport.ws.bytesReceived` between 7 000 000 and 10 000 000 (8 278 184 + 159 572 + 36 on 2026-11-07).
- [ ] **Step 3: README §6 gate (2) — same-hour comparison with the browser path, plus the declared group totals.** The browser path works at code level again (pzbuk.md Task 5), so gate (2) is no longer replaced, only complemented. The browser run takes about 6 min for 19 events, so start it at about HH:12 and run the WS comparison right after, in the same hour, with no listed kickoff in between:
  ```bash
  SCRAPER_TRANSPORT_PZBUK=browser $HEAVY --live npx tsx scripts/perf-smoke.ts --bookmaker pzbuk --league premier-league --out $PS/pzbuk-browser-$T.json 2>&1 | tee $PS/pzbuk-browser-$T.log; echo "exit=$?"
  $HEAVY --live npx tsx scripts/perf-smoke.ts --bookmaker pzbuk --league premier-league --baseline $PS/pzbuk-browser-$T.json --out $PS/pzbuk-ws2-$T.json 2>&1 | tee $PS/pzbuk-ws2-$T.log; echo "exit=$?"
  python3 -I -c "import re,sys;t=open(sys.argv[1]).read();r=re.findall(r'\[PZBuk/FullOffer\] (?!skipped )(.+?): (\d+) markets \(groups (\d+)/(\d+)(?:, markets counted (\d+)/(\d+))?\)',t);bad=[x for x in r if x[2]!=x[3] or (x[5] and not int(x[5])<=int(x[4])<=1.02*int(x[5]))];print(len(r),'written',len(re.findall(r'\[PZBuk/FullOffer\] skipped ',t)),'skipped',bad)" $PS/pzbuk-ws-$T.log
  ```
  The A7′ one-liner accepts both per-event formats. A WS line has the `markets counted` part; a browser line (`(groups X/Y) (frames: …)`) has only X/Y. Its shape was proven on 2026-11-13 on a sample with two good lines of each format, one browser line with `groups 6/7` and one `skipped` line: it printed `3 written 1 skipped [('Arsenal vs Hull City', '100', '6', '7', '', '')]`. Pass:
  - Browser run: exit 0, `scraperClass: "PzbukBrowserScraper"`, `transportOverride: "browser"`. Running the same one-liner on its log gives every line X = Y on ≥ 18 of 20 events (pzbuk.md A7).
  - WS run against it: exit 0, `PARITY` `matchesEqual: true, pass: true` (markets and selections within ±2 %).
  - A7′ on the Step 2 log: `19 written 0 skipped []`, meaning every written event has all groups and counted markets within [declared, +2 %].
  - If the browser run fails, judge on A7′ alone and record its error for the owner. It would be the first live run of pzbuk.md Task 5's path; never compare against a failed run.
- [ ] **Step 4: Integrity smoke (read-only).** `$HEAVY --live timeout 120 npx tsx scripts/pzbuk-smoke.ts --league premier-league --peers http://localhost:3001` → exit 0. `--peers` makes one read-only GET to the live backend, which is allowed. This covers A1–A6 and A12: `collisions: 0`, `max1x2Deviation ≤ 0.08`, `minNonOther ≥ 40`, `minParsedMarkets ≥ 90`, `gatedNonOther: 0`. `durationMs` must be < 3 000 (A8′). A11: `invalidFrames` 0, and `chunkedFrames` > 0 is now expected, because the offer arrives as 7 × 1 MiB + tail. Chunk reassembly therefore counts as live-verified, which settles that pzbuk.md Risks entry.
- [ ] **Step 5: Service run and observability expectations — DEFERRED (owner; EXECUTION rule 4).** Record these commands and expectations; do not trigger a scrape:
  - After the owner merges and a scheduled run, `sed 's/\x1b\[[0-9;]*m//g' <service log> | grep -E '^\[Aggregator/FullOffer\] pzbuk [a-z_]+: |marketKey collision.*pzbuk|\[PZBuk/(FullOffer|WS)\]'` shows `[Aggregator/FullOffer] pzbuk success: 19 matches, <found> markets found, <saved> saved`, with saved > 0, no `- <error>` suffix and no `marketKey collision … pzbuk` line (A9). This replaces pzbuk.md:1038's `pzbuk completed:` grep.
  - `curl -s 'http://localhost:3001/api/health/scrapers?league=premier-league'` shows pzbuk with `consecutiveFailures: 0` and a non-null `lastSuccessAt`.
    - The pzbuk row of observability A4 (`websockets opened: …`) described the broken state and is no longer expected.
    - A later failure shows `lastError` in the §3 wording (`ws handshake HTTP …`, `ws failed …`, `ws closed …`, `ws timeout …ms … | …` or `<n> of <m> details failed | …`), with no `diagnostics`: there is no page to record.
    - Plan 07's `[ScrapeMetrics]` gets the ws counters through `hasTransportStats`.
  - `/api/odds?league=premier-league` → `meta.bookmakerStatus.pzbuk === "available"`, so pzbuk counts toward A5's "≥ 9 available".
  - A10 analogue: `RUN2_OK` has no pzbuk value. Record the first post-merge run's `markets_saved` as the pzbuk baseline; the next scheduled run must save ≥ 0.75 × that baseline.
  - Rollback: `SCRAPER_TRANSPORT_PZBUK=browser` in the live `.env` + restart (owner). The browser path needs plan 07's `PZBUK_BROWSER_MAX_DURATION_MS` (600 s) once plan 07 has landed.

---

## Self-Review

1. **Spec coverage.**
   - Listing on the same socket with no page load: Task 3, using the site's own sidebar filter.
   - One subscription for all events via `openWsSession`/`collect`, collecting until every target is complete or 15 s; incomplete events skipped with no write; budget-bounded; §3 error wording: Tasks 3–4.
   - `transport = "websocket"` (#19) and cumulative `transportStats()`/`frameCounters()`: Task 4 (three tests) and Task 5.
   - The parity pattern on the **built** browser path: the same `buildPzbukMatchOffer`/`mapEventOffer` in both paths, the browser push only (recovery logic kept), proven on the old path first with `{state, diagnostics}` mocks: Task 2.
   - Fixtures copied and trimmed from `pzcap/cap.json` by absolute path (#28), with the exact command and size: Task 1.
   - `PzbukBrowserScraper` behind `getTransportOverride`, and every direct importer repointed, including `scripts/pzbuk-smoke.ts` and its test: Task 5.
   - Browser speedups with CDP-only blocking (#23): optional Task 6.
   - Cache removal: Task 2.
   - Live verification: Task 7, where gate (2) is restored against the browser path, A7′ accepts both line formats, and the persisting steps are DEFERRED.
2. **Step scan.**
   - Every test step gives names and assertions with exact values.
   - Values computed by the plan writer with the generator command: sizes, md5, 52/45, 0/235, chunk lengths, and the 6/3/109 588 frame counters, which follow from those chunk lengths. The 38/222 counts were computed on 377b47e, and Task 2 Step 1 re-confirms them on the future base before anything depends on them.
   - Anchors re-verified on integration on 2026-11-13: `index.ts:20,45-47,49-53,55-59,61,64-69,80-98,100-105,136-140,229-237,260,322-491,323,330-367,370-372,382-460,400-409,418,420-448,452,462-480,498`; `ws-protocol.ts:112,133,164-182,208,270-306,308,319`; `navigation.ts:92-114,262,402,420-433,489`; `constants.ts:17,253,269,289,295`; `parser.ts:31,698,799`; `config/leagues.ts:60,162,178`; `pzbuk-smoke.ts:5-6,29-31,38,75,78,376-378,391`; the importer lines.
   - The A7′ regex was proven on a sample.
3. **Type consistency.**
   - `GroupCoverage` (Task 1) feeds `coverageFor` (Task 3) and the skip reasons (Task 4).
   - `buildPzbukMatchOffer`/`mapEventOffer` (Task 2) are called by the browser path (Task 2), `PzbukWsScraper` (Task 4) and the parity checks.
   - `CaptureDiagnostics`, `emptyDiagnostics` and `lastFrameDetails` (pzbuk.md Task 2) are embedded in `DirectSessionState` and `describeDirectState`.
   - `PzbukFrameCounters` (Task 4) replaces the local `TransportStats` in the browser class and the smoke script (Task 5); plan 02's `TransportStats` keeps its name and shape.
   - Ids are `string | number` in all signatures, because wire ids are numbers while `types.ts` says `string`. Map keys are `String(id)`.
4. **Review Focus.** Each of the six items names its pinning test (Tasks 2, 3, 4 and 5).
5. **Proportion.** Code blocks are tests, the fixture command, two short algorithm sketches (the reducer and one scraper attempt) and the A7′ one-liner.

Fixed during review:
- An earlier draft read `marketGroups` only from the listing. That is the snapshot-skew case, now Review Focus 2.
- It also waited on events without declared groups, which would hold `done` open for 15 s.
- Aligned with plan 02: the `HttpScraper` result shape, `ws failed …` in the retry rule, `DEFAULT_USER_AGENT`, `TransportStatsSource`, and the concrete `perf-smoke` flags and keys. Plan 02 Task 8 already queues frames that arrive before the first `collect`.
- Aligned with the built recovery code (2026-11-13):
  - the browser push only, not the whole mapping block;
  - `{state, diagnostics}` mocks;
  - `CaptureDiagnostics` embedded instead of duplicated;
  - the per-call `lastTransportStats` made cumulative and renamed;
  - `pzbuk-smoke.ts` added to the importers;
  - gate (2) restored;
  - the "0 matches today" premise removed.

## Open Questions

1. **Build Task 6 (browser-path speedups) now?** The browser path works but costs about 17.4 s per event, about 5 s after Task 6. Recommended default: no. Keep the flag for the plan-10 window, and build Task 6 only if the direct socket is blocked or the flag stays set for more than a week.
2. **Waiting on incomplete events.** If an event stays incomplete, the run waits the full 15 s collect timeout before skipping it (0 mismatches in 19/19 live events). Recommended default: accept. The alternative, finishing on the first offer message, would hide a server that splits the offer across messages.
