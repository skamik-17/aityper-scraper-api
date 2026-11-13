# Scraper Quick Wins (plan 01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land eight small, independent fixes that cut memory, CPU and log volume and stop three silent data bugs, without changing any market a parser emits or any normalizer mapping: launch args, browser-pool waiters and idle browsers, write-only caches, `start_time` for six bookmakers (forbet, etoto, betfan, lvbet, superbet, betclic), superbet's hard-coded listing end date, a memoized team matcher, event-loop yields between matches, and one unmapped-market summary line instead of one warning per market.

**Architecture:** Every task is local to one or two modules and is one commit that can be reverted on its own. Tasks 1–2 touch only `src/scrapers/base/browser-pool.ts`. Tasks 3–4 share one new offline harness that drives the real `scrapeFullOffer` of seven scrapers on recorded payloads, with their `navigation.ts` modules mocked. Tasks 6–8 touch the normalization path (`team-matcher.ts`, `scrape-helpers.ts`, `factory.ts`) and are proven behaviour-preserving by the unchanged golden test. Code to edit is located by quoted snippet; line numbers are hints on the **future base** (`recovery/integration` @ `aaf7c07` + `recovery/observability` @ `f0361f0` + `recovery/fortuna` @ `a8cdb71`, merged in a scratch clone on 2026-11-13), because later plans move lines.

**Tech Stack:** TypeScript (ESM, Node 20), Vitest 4 (`globals`, node env), Playwright 1.57 (types only in tests), fuse.js.

**Spec:** README §1.3 (NORM-1/2/3), §1.5 (rows "launch args", "`closeAll()`", "`start_time`", "write-only caches", "superbet `endDate`"), §2 principle 5, §5 step P1, §6, §7 (peak memory, CPU, betclic loss). Evidence (`$E` = `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence`): `core/features.mts`, `core/features2.mts`, `core/target-architecture.ts:125-135`, `profiling/samples/parallel-*.jsonl`, `forbet-etoto/`, `betfan-totalbet/`, `lvbet-fuksiarz/`, `sts-superbet/data/`, `betclic-fortuna/top.bin`, `db-pipeline/bench-normalize.*`, `db-pipeline/bench-fuse.*`, `db-pipeline/eventloop-timer-demo.mjs`, `db-pipeline/warn-*.log`, `findings-notes.md` (CORE-2, CORE-5, F/E-5, F/E-6, FUKSIARZ-5, LVBET-5, SUPERBET-3, SUPERBET-5, NORM-1..3). One betclic listing response was captured by the plan writer on 2026-11-07 02:58 CET (`fetchLeagueMatches("premier-league")`, 43 256 bytes, 19 entries); its trimmed form is embedded in Task 4.

> **Revision 2026-11-13:**
> - **Base moved.** The plan now targets the future base (`recovery/integration` + observability + fortuna). The worktree branches from `recovery/integration` (or `master` after the owner's merge) and follows the recovery `EXECUTION.md` workspace rules (Global Constraints). The rules are: symlinked `node_modules`, a dead-port `.env`, `bin/heavy` for every heavy command, no server and no DB writes, and live checks that persist are deferred to the owner. Sources: `evidence/delta-audit-infra-2026-11-13.md` (header, README items 1, 14); README §6.
> - **Task 8 is now a "Modify".** betcris.md Task 6 landed `unmapped-summary.ts` (top 5) and its call in `scrape-helpers.ts:52-57`. What remains here: the exported default of 20, three tests, the factory guard and a `.env.example` entry for `NORMALIZER_LOG_OTHER`. Sources: `evidence/delta-audit-transport-2026-11-13.md` "01", infra item 9, `cross-plan-review` #33.
> - **Task 4.** The rebase contingencies are gone, because lvbet.md Task 1, superbet.md Task 3 and betclic.md Task 1 have landed. betclic's kickoff from listing field 3 stays here, as its single owner (cross-plan #1). The task also states the harness switch for when plan 06 Task 1 deletes `fetchMarketsHybrid` (cross-plan #3).
> - **Task 6.** Fortuna added `matchTeamByExactAlias` to `team-matcher.ts`. The ranges are re-anchored, and `team-matcher-fortuna-labels.test.ts` must stay green.
> - **Task 7.** The repository mock returns the full `BatchSaveResult` (observability added `failedBatches`, `totalBatches` and `firstError`).
> - **Task 9.** Re-baselined: 10 browser scrapers plus the betclic fallback still launch Chromium, while totalbet, betters and lebull are browserless. The parity smoke uses observability's dry `scripts/smoke-bookmaker.ts`. The persisting checks are deferred to the owner with commands and expected results. Greps use the `[Aggregator/FullOffer] <bm> <status>: …` line, and the kickoff check covers the 8 bookmakers that already write `start_time`.
> - **Fixtures re-proved on the future base** (2026-11-13 scratch merge). Each of the six fixtures keeps one valid event that parses to 3 markets (superbet 4), and the betclic parser is unchanged. Test totals are now deltas from the recorded worktree baseline.

## Global Constraints

README §6 applies in full, including its 2026-11-13 workspace rules (recovery `EXECUTION.md`, which wins over anything below). Plan-specific:
- **Precondition for Tasks 6–9: README §5.0 step R0 is done.** The owner has merged `recovery/observability` and `recovery/fortuna` into `recovery/integration`. Tasks 7–9 rely on observability's code and Task 6 on fortuna's `team-matcher.ts`. **Tasks 1–5 depend on neither and may start on `recovery/integration` alone** (orchestrator decision 2026-11-13); rebase onto R0 before Task 6. Check: `git -C $R merge-base --is-ancestor recovery/observability recovery/integration && git -C $R merge-base --is-ancestor recovery/fortuna recovery/integration && echo ok` → `ok`.
- **Worktree.** These variables are used throughout:
  ```bash
  R=/home/skamik/Documents/repositories/personal/aityper-scraper-api
  W=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees
  H=$W/bin/heavy
  git -C $R worktree add $W/perf-01 -b perf/01-quick-wins recovery/integration   # or master once the owner has merged integration
  ln -s $R/node_modules $W/perf-01/node_modules   # never npm install / npm ci
  cp $W/integration/.env $W/perf-01/.env          # Supabase on a dead port on purpose; never edit it
  ```
  All paths below are relative to `$W/perf-01`. Scratch output goes to `.scratch/` (gitignored via `.git/info/exclude`). Never write into the main checkout `$R`; reading `$E` there is fine.
- **Every `npx vitest`, `npx tsc`, `npx tsx` and `python3` command runs through `$H`.** Use `$H --live` for anything that opens a browser or calls a bookmaker. During TDD run only the scoped test file. At the end of each task run `$H npx vitest run` and `$H npx tsc --noEmit` once.
- Never start the server or scheduler, and never run anything that writes to the DB. Task 9 Steps 2–5 need a persisting scheduled run and are **deferred to the owner**: the plan gives the exact command and the expected result.
- **Baseline first.** Before Task 1, write `$H npx vitest run` (files/tests) and `$H npx vitest run src/services/normalization/__tests__/golden.test.ts` (tests) to `.scratch/baseline.txt`. The golden count must equal that baseline before and after every task. The plan adds **7 test files and 49 tests** to the recorded baseline: Task 8 extends an existing file.
- Fixtures are copied from the main checkout's untracked evidence (`$E` above, read-only). The recipes were re-run on the future base on 2026-11-13 with unchanged byte counts and parse results (Tasks 3 and 4).
- No change to any `parser.ts` output, normalizer mapping, catalog or golden fixture.
- Edits are located by the quoted snippet given in each Files block. Line numbers are hints on the future base. If a snippet is no longer found, a later plan (03, 04 or 06) has already changed that code. Follow that task's "Overlap" rule; never guess.
- Log prefixes kept: `[BrowserPool]`, `[ScrapeHelpers]`. The landed summary line (Task 8) keeps the format betcris.md Task 6 Step 7 A2 greps.
- No new dependency. `node:timers/promises` and `node:events` are Node 20 built-ins.
- Commit after each task on `perf/01-quick-wins` only. The branch merges once (owner), outside HH:55–HH:10, followed by Task 9.

## Review Focus

1. **`closeAll()` while a Chromium launch is still in flight.** The late browser must be closed and its caller must reject with `Browser pool closed while launching a browser`; stats return to all zeros. Test: Task 2 "closeAll during an in-flight launch …".
2. **A launch fails while another caller is waiting.** The waiter must be woken and launch its own browser instead of waiting for a release that never comes. Test: Task 2 "a launch failure wakes a waiter …".
3. **Kickoff values `0`, `null`, epoch seconds, betclic's 7-digit fraction (`…00.0000000Z`), or unparsable strings.** Must give `undefined` or the correct ISO string, never `1970-01-01T00:00:00.000Z`. Test: Task 4 `toIsoStartTime` table.
4. **Unknown league and `TEAM_MATCHER_DEBUG=true`.** Both must behave exactly as today: the unknown-league warning fires on every call and is never memoized; debug mode bypasses the memo. Tests: Task 6 "an unknown league …", "TEAM_MATCHER_DEBUG=true bypasses the memo".
5. **A match whose normalization throws.** The loop must still yield before the next match, record the error, and normalize the next match. Test: Task 7 "a throwing match still yields …".

---

## Observations (pre-fix analysis)

Measured on `master` @ `377b47e`, 2026-11-07 ~02:50 CET. Code references re-verified on the future base on 2026-11-13. These files are byte-identical to master there: `browser-pool.ts`, `cache-manager.ts`, `factory.ts`, the six brand `index.ts` files of Task 3, every brand `navigation.ts`, and betclic `index.ts`/`parser.ts`/`types.ts`. Line hints below are on the future base.

**O1 Launch args.** `browser-pool.ts:9-18` passes `--disable-features=IsolateOrigins,site-per-process`. Chromium keeps the last `--disable-features`, so this replaces Playwright 1.57's own list (`node_modules/playwright-core/lib/server/chromium/chromiumSwitches.js:24-50`, appended at `:70`): ThirdPartyStoragePartitioning, Translate, OptimizationHints, HttpsUpgrades, MediaRouter, PaintHolding come back on (`$E/core/features.mts`, `features2.mts`; CORE-2). `--no-sandbox` (`chromium.js:300-301`) and `--disable-dev-shm-usage` (`chromiumSwitches.js:68`) are already Playwright defaults, and the viewport is set per context (`playwright-base.ts:105`, `:138`). `playwright-base.ts` has no copy of the args (verified by grep); scripts that launch Chromium pass none.

**O2 Browser pool.** `closeAll()` (`browser-pool.ts:123-154`) iterates the waiters with an empty loop body (`:127-130`) and drops them, so their `acquire()` never settles. `acquire()` recurses on a disconnected browser (`:51-53`). `release()` (`:82-107`) parks finished browsers in `available` until `closeAllBrowsers()` (`aggregator.ts:201`, called at `scheduler-service.ts:67` and `scraper-service.ts:156`). Measured on 2026-11-07 in the production-like parallel run with 13 browser scrapers: from 55 s to 115–120 s only sts and betcris work, but 69–70 Chromium processes hold 2.2–2.6 GB PSS (`$E/profiling/samples/parallel-p1.jsonl`, `parallel-p2nonet.jsonl`). A failed launch (`:60-69`) and `remove()` (`:112-117`) never wake a waiter either. Only `premier-league` is enabled (`config/index.ts:52-54`). On the future base 10 scrapers still open a browser session: betcris, betfan, etoto, forbet, fortuna, fuksiarz, lvbet, pzbuk, sts and superbet. betclic's fallback can open one too, until plan 06 Task 1 deletes it. totalbet, betters and lebull are browserless. That is ≤ 11 sessions against a pool of 14, so runs never wait, and close-on-release frees each browser as soon as its scraper finishes.

**O3 Write-only caches** (every reader checked by grep over `src` and `scripts`):

| Scraper | Cache | Written in `scrapeFullOffer` | Readers | On a miss |
|---|---|---|---|---|
| superbet | `eventsCache` `index.ts:40-44` | `:287` full detail (≤ 4 MB each, ~55 MB/run, SUPERBET-3) | `scrapeMatchDetails` `:167` | opens a browser, `fetchEventDetails`, builds from the detail (richer than the cached listing event) |
| forbet | `eventsCache` `index.ts:56-60` | `:300` detail (~0.43 MB each, ≤ 215 MB at the 500 cap) | `scrapeMatchDetails` `:192` | browser + `fetchAllLeagueEvents` listing (the same listing object `scrapeLeague` cached) |
| etoto | `eventsCache` `index.ts:40-44`; module `cachedEvents` Map `navigation.ts:26-27` | `:276` listing; navigation `:90-94`, `:212-216` detail payloads, unbounded | `scrapeMatchDetails` `:179`; navigation `getCachedEvent` `:132` and `clearCache` `:164` have **no callers** | browser + `fetchAllLeagueEvents` |
| fuksiarz | `eventsCache` `index.ts:35-39` | `:248` listing, `:263` detail (~250 KB each) | `scrapeMatchDetails` `:158` | browser + `fetchAllLeagueEvents` |
| betfan | `eventsCache` `index.ts:39-43` | `:258` listing | `scrapeMatchDetails` `:165` | browser + `fetchAllLeagueEvents` |
| lvbet | `matchesCache` `index.ts:38-42` | `:276` listing | `getCachedMatch` `:61` has **no callers** | — |

`scrapeMatchDetails` is called only by `scripts/test-scrapers.sh:237,411` (legacy 1X2 debug script); production never reads these caches. `ScraperCache` (`src/services/cache-manager.ts`) expires entries only in `get`/`has`/`getAll` and via `isEmpty()` → `pruneExpired()` (`:126-128`); `set()` (`:58-69`) never drops expired entries and `evictOldest()` (`:150-165`) scans the whole map on every insert into a full cache (FUKSIARZ-5). The sts, betcris (`index.ts:47`) and pzbuk (`index.ts:55`) caches are out of scope; plans 05a/b/c rewrite those files. betclic and fortuna cache only small listing objects. betters, lebull and totalbet no longer use `ScraperCache` on the future base.

**O4 `start_time`.** Read-only SQL on the local DB, rows of the 01:00Z run (`select bookmaker, count(*) filter (where start_time is null), count(*) from odds where scraped_at > now() - interval '3 hours' group by 1`):

| bookmaker | NULL / rows | code reads | payload has |
|---|---|---|---|
| betfan | 5130 / 5130 | `eventStartTime` (`betfan/index.ts:280`, `:295`) | `eventStart` 1794054600000 (`$E/betfan-totalbet/bf-ev-40932985.json`) |
| forbet | 5531 / 5531 | `eventStartTime` (`forbet/index.ts:314`) | `eventStart` (`$E/forbet-etoto/fb_detail.json`) |
| etoto | 6080 / 6080 | `startTime` (`etoto/index.ts:298`) | `eventStart` (`$E/forbet-etoto/et_detail.json`) |
| lvbet | 8824 / 8824 | `start_time` (`lvbet/index.ts:303`) | `date` `"2026-11-08T14:00:00+00:00"` (`$E/lvbet-fuksiarz/lv_comp.json`) |
| superbet | 12490 / 12490 | `startTime` (`superbet/index.ts:300`) | `unixDateMillis`, `utcDate` (`$E/sts-superbet/data/sb-ev-far.json`) |
| betclic | 3121 / 3121 | nothing: `parseListingResponse` (`betclic/parser.ts:871-946`) reads proto fields 1, 2, 9 only; `BetclicListingMatch` (`betclic/types.ts:34-47`) has no kickoff | listing match entry field 3, a string `"2026-11-07T12:30:00.0000000Z"` (7-digit fraction; present on 19/19 entries of the 02:58 CET capture; `Date.parse` accepts it). The detail response carries the same string (`$E/betclic-fortuna/top.bin`, offset 0x26) |
| fuksiarz | **0** / 5751 | `eventStart` (`fuksiarz/index.ts:276-278`) | `eventStart` — already correct, not edited; pinned by a test |

The README §1.5 row is corrected here: fuksiarz is fine, while superbet and betclic are broken too. On the future base the six "code reads" lines are unchanged. The kickoff is already written by 8 bookmakers: fortuna (`index.ts:318`), fuksiarz, sts (`index.ts:388`), betcris (`index.ts:328`), pzbuk (`index.ts:434`), totalbet (`index.ts:294`), and betters plus lebull through betby (`shared/betby/parser.ts:85`). The type anchors moved with recovery: `LVBetMatch` is at `lvbet/types.ts:77` with `start_time` at `:87`. `SuperbetEvent` is at `superbet/types.ts:53`, with the phantom `startTime` at `:63` and the real `unixDateMillis` at `:71`. The match-level `start_time` is `MAX` over bookmakers and drives the `start_time > NOW()` filter (`supabase/migrations/10_filter_market_keys.sql:70`, `:126`), so the new values only add kickoffs the read path already expects. All four rest-market captures of Leeds–Tottenham agree on 12:30Z.

**O5 Superbet listing window.** `superbet/navigation.ts:101-103` builds `endDate=2027-12-30` inside `page.evaluate` (browser clock). A live GET with `endDate=2027-02-05` (today + 90 days, 2026-11-07 02:44 CET) returned the same 19 event ids as the 2027-12-30 capture (`$E/sts-superbet/data/sb-bydate.json`; latest kickoff 2026-11-23).

**O6 Team matcher.** `matchToCanonical` (`team-matcher.ts:621-708`) has no result cache; its Fuse step (`:685-696`) costs 70–300 µs (`$E/db-pipeline/bench-fuse.out`). Replaying the profiled PL run (`$E/profiling/raw/*.json`, 10 working bookmakers, 94 400 markets) through `normalizeMarketsForBookmaker`: 3 575 Fuse searches over only 568 distinct patterns, 1.7 s of 5.0 s. The fuzzy step also produces false team hits on labels (`tak`→Stoke City, `nie`→Sunderland, `gol`→Liverpool, `nikt`→Leeds United, totalbet.md:732); memoization keeps them byte-identical (see Open Question 1). Fortuna recovery (41fb299) added `matchTeamByExactAlias` (`:720`). It reads only the alias tiers, never calls `matchToCanonical`, and is pinned by `src/utils/__tests__/team-matcher-fortuna-labels.test.ts`.

**O7 Event loop.** `normalizeAndSaveMatches` (loop `scrape-helpers.ts:33-50`; betcris's summary block follows at `:52-57`, observability's batch-error block at `:59-73`) normalizes every match synchronously right after `await scrapeFullOffer()` (lvbet 256 ms per match warm, `$E/db-pipeline/bench-normalize.out`). `$E/db-pipeline/eventloop-timer-demo.mjs`: a 900 ms block lets a 1000 ms read-cutoff timer fire with 1 of 10 chunks processed, the pattern behind betclic's −9…−12 % markets under load (README §1.1).

**O8 Warning flood.** `factory.ts:130-131` logs `[Normalizer] Market mapped to OTHER: "<name>"` once per unmapped market, without a bookmaker tag. Replay of the profiled PL run: 10 104 of 30 509 normalization warnings (fortuna 4 063, betcris 2 400, lvbet 2 322, sts 954, forbet 289, etoto 76). **betcris.md Task 6 has landed** on the future base (2ea100a). It added `src/services/normalization/unmapped-summary.ts`, with `UnmappedSummary`, `summarizeUnmappedMarkets(markets, topN = DEFAULT_TOP_N)` and `formatUnmappedSummary`, where `const DEFAULT_TOP_N = 5` (`:14`) is not exported. It also added the call after the loop (`scrape-helpers.ts:52-57`) and three tests in `__tests__/unmapped-summary.test.ts` (`:20`, `:26`, `:31`); the third is a wiring test through `normalizeAndSaveMatches`. The line it logs is `[ScrapeHelpers] betcris: 2 unmapped market ids, 3 OTHER markets this run (top: ShotsonTarget2ndHalfTotal×2, PlayerShotsOutsidetheBox×1)`. The factory's per-market line (`factory.ts:131`) is unchanged and still fires once per OTHER market. The per-bookmaker `[superbet] Unmapped market` lines (13 108 per run) stay: they live in `superbet-normalizer.ts`, which superbet.md edited.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/base/browser-pool.ts` | `BROWSER_ARGS`; `BrowserPool` with launch seam, leases, waiter settlement, close-on-release | 1, 2 |
| `src/scrapers/base/__tests__/browser-pool.test.ts` (new) | args + pool behaviour with fake browsers | 1, 2 |
| `src/services/cache-manager.ts` | `set()` expires from the head; O(1) eviction | 3 |
| `src/services/__tests__/cache-manager.test.ts` (new) | expiry-on-write, eviction order | 3 |
| `src/scrapers/bookmakers/{superbet,forbet,etoto,fuksiarz,betfan,lvbet}/index.ts` | caches removed (3); kickoff via `toIsoStartTime` (4, not fuksiarz) | 3, 4 |
| `src/scrapers/bookmakers/etoto/navigation.ts` | module cache removed | 3 |
| `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` (new) + `fixtures/full-offer/*` (new) | offline `scrapeFullOffer` harness on recorded payloads | 3, 4 |
| `src/scrapers/shared/start-time.ts` (new) + `__tests__/start-time.test.ts` | `toIsoStartTime` | 4 |
| `src/scrapers/bookmakers/{forbet,betfan,etoto,lvbet,superbet}/types.ts` | phantom kickoff fields replaced by the real ones | 4 |
| `src/scrapers/bookmakers/betclic/{constants,types,parser,index}.ts` | listing field 3 read and stored as kickoff | 4 |
| `src/scrapers/bookmakers/superbet/navigation.ts` + `__tests__/listing-url.test.ts` (new) | `buildSuperbetListingUrl`, rolling window | 5 |
| `src/utils/team-matcher.ts` + `__tests__/team-matcher-memo.test.ts` (new) | bounded memo | 6 |
| `src/services/scrape-helpers.ts` + `src/services/__tests__/scrape-helpers.test.ts` (new) | yield per match (the summary call already exists) | 7 |
| `src/services/normalization/unmapped-summary.ts` + `__tests__/unmapped-summary.test.ts` (both landed with betcris.md Task 6) | exported default top 20; three more tests | 8 |
| `src/services/normalization/factory.ts` | per-market OTHER line opt-in only | 8 |
| `.env.example` | commented `NORMALIZER_LOG_OTHER` entry | 8 |

---

### Task 1: Launch args that keep Playwright's own feature list

**Files:**
- Modify: `src/scrapers/base/browser-pool.ts`, the block starting `const BROWSER_ARGS = [` (hint `:9-18`): export the constant; nothing else changes
- Test: `src/scrapers/base/__tests__/browser-pool.test.ts` (new)
- Overlap: none. `browser-pool.ts` is byte-identical to master on the future base. Observability Task 2 (landed) changed `executeFullOfferScrape` in `playwright-base.ts:353-391`, which this task does not touch.

**Interfaces:**
- Consumes: none.
- Produces: `export const BROWSER_ARGS: readonly string[] = ["--disable-blink-features=AutomationControlled", "--disable-site-isolation-trials"]`.

- [ ] **Step 1: Write the failing test**

```ts
const { launch } = vi.hoisted(() => ({ launch: vi.fn(async () => ({ isConnected: () => true, close: async () => {} })) }));
vi.mock("playwright", () => ({ chromium: { launch } }));
import { BROWSER_ARGS, browserPool } from "../browser-pool.js";

describe("BROWSER_ARGS", () => {
  it("never passes --disable-features (it would replace Playwright's own list)", () => {
    expect(BROWSER_ARGS.filter((a) => a.startsWith("--disable-features"))).toEqual([]);
    expect(BROWSER_ARGS).toEqual(["--disable-blink-features=AutomationControlled", "--disable-site-isolation-trials"]);
  });
  it("the shared pool launches headless Chromium with exactly these args", async () => {
    await browserPool.acquire();
    expect(launch).toHaveBeenCalledWith({ headless: true, args: [...BROWSER_ARGS] });
    await browserPool.closeAll();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `$H npx vitest run src/scrapers/base/__tests__/browser-pool.test.ts` → FAIL: `Cannot read properties of undefined (reading 'filter')` (constant not exported); the launch test fails on the old 8-arg list.
- [ ] **Step 3: Implement.** Replace the array with the two args and export it. Drop the comment "shared with playwright-base.ts" (it was never shared). Add a one-line comment: `// Never add --disable-features: Chromium keeps the last one, which would replace Playwright's own list.`
- [ ] **Step 4: Run it and confirm it passes.** Same command → `Tests 2 passed (2)`; `$H npx tsc --noEmit` → exit 0.
- [ ] **Step 5: Commit**

```bash
git add src/scrapers/base/browser-pool.ts src/scrapers/base/__tests__/browser-pool.test.ts
git commit -m "fix(browser-pool): stop overriding Playwright's --disable-features list"
```

---

### Task 2: Pool settles every waiter and closes idle browsers on release

**Files:**
- Modify: `src/scrapers/base/browser-pool.ts`, from `class BrowserPool {` to `export const browserPool = new BrowserPool(14);` (hint `:20-170`): rewrite the class body and `export` the class
- Test: `src/scrapers/base/__tests__/browser-pool.test.ts` (extend)
- Overlap: none (see Task 1). Callers keep their API: `browserPool.acquire()`/`release()`/`remove()` in `PlaywrightScraper.initBrowser` (`playwright-base.ts:93`), `closeAllBrowsers()` in `aggregator.ts:201`, and `browserPool.closeAll()` in the betcris.md smoke. Plan 08 Task 5 later replaces this class and ports these tests (cross-plan #6).

**Interfaces:**
- Consumes: `BROWSER_ARGS` (Task 1).
- Produces:
  ```ts
  export type BrowserLauncher = () => Promise<Browser>;
  export class BrowserPool {
    constructor(maxSize?: number /* 4 */, launch?: BrowserLauncher /* () => chromium.launch({ headless: true, args: [...BROWSER_ARGS] }) */);
    acquire(): Promise<Browser>;
    release(browser: Browser): void;
    remove(browser: Browser): void;
    closeAll(): Promise<void>;
    getStats(): { total: number; available: number; inUse: number; waiting: number }; // available is always 0 now
  }
  export const browserPool: BrowserPool; // new BrowserPool(14), unchanged
  ```
- Error texts: waiter on `closeAll()` → `Browser pool closed while waiting for a browser`; launch finished after `closeAll()` → `Browser pool closed while launching a browser`; acquire during closing → `Browser pool is closing, cannot acquire new browser` (unchanged).

- [ ] **Step 1: Write the failing tests** (append to the Task 1 file)

```ts
import type { Browser } from "playwright";
import { BrowserPool } from "../browser-pool.js";
type FakeBrowser = Browser & { close: ReturnType<typeof vi.fn> };
const fakeBrowser = (): FakeBrowser => { let up = true; return { isConnected: () => up, close: vi.fn(async () => { up = false; }) } as unknown as FakeBrowser; };
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const make = (max = 1) => { const launch = vi.fn(async () => fakeBrowser()); return { pool: new BrowserPool(max, launch), launch }; };
const ZERO = { total: 0, available: 0, inUse: 0, waiting: 0 };

describe("BrowserPool", () => {
  it("release closes the browser when nobody waits", async () => {
    const { pool } = make(); const b = (await pool.acquire()) as FakeBrowser;
    pool.release(b);
    expect(b.close).toHaveBeenCalledTimes(1); expect(pool.getStats()).toEqual(ZERO);
  });
  it("release hands the browser to the oldest waiter without closing it", async () => {
    const { pool, launch } = make(); const b = (await pool.acquire()) as FakeBrowser;
    const w1 = pool.acquire(); pool.acquire();
    pool.release(b);
    await expect(w1).resolves.toBe(b);
    expect(b.close).not.toHaveBeenCalled(); expect(launch).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toEqual({ total: 1, available: 0, inUse: 1, waiting: 1 });
  });
  it("closeAll rejects every pending waiter instead of leaving it hanging", async () => {
    const { pool } = make(); const b = (await pool.acquire()) as FakeBrowser;
    const settled = Promise.allSettled([pool.acquire(), pool.acquire()]);
    await pool.closeAll();
    expect((await settled).map((r) => r.status === "rejected" && (r.reason as Error).message))
      .toEqual(["Browser pool closed while waiting for a browser", "Browser pool closed while waiting for a browser"]);
    expect(b.close).toHaveBeenCalledTimes(1);
    await expect(pool.acquire()).resolves.toBeDefined(); // usable again
  });
  it("a launch failure wakes a waiter, which launches its own browser (Review Focus 2)", async () => {
    const d = deferred<Browser>();
    const launch = vi.fn().mockReturnValueOnce(d.promise).mockImplementation(async () => fakeBrowser());
    const pool = new BrowserPool(1, launch);
    const first = pool.acquire().catch((e: Error) => e.message); const waiter = pool.acquire();
    d.reject(new Error("browserType.launch: Executable doesn't exist"));
    expect(await first).toBe("browserType.launch: Executable doesn't exist");
    await expect(waiter).resolves.toBeDefined(); expect(launch).toHaveBeenCalledTimes(2);
  });
  it("closeAll during an in-flight launch closes the late browser and rejects its caller (Review Focus 1)", async () => {
    const d = deferred<Browser>(); const pool = new BrowserPool(1, () => d.promise);
    const a = pool.acquire().catch((e: Error) => e.message);
    await pool.closeAll(); const late = fakeBrowser(); d.resolve(late);
    expect(await a).toBe("Browser pool closed while launching a browser");
    expect(late.close).toHaveBeenCalledTimes(1); expect(pool.getStats()).toEqual(ZERO);
  });
  it("remove() of a broken browser wakes a waiter, which launches a replacement", async () => {
    const { pool, launch } = make(); const b = (await pool.acquire()) as FakeBrowser; const w = pool.acquire();
    pool.remove(b);
    expect(await w).not.toBe(b); expect(launch).toHaveBeenCalledTimes(2); expect(b.close).toHaveBeenCalledTimes(1);
  });
  it("a crashed browser is never handed to a waiter", async () => {
    const { pool, launch } = make(); const b = (await pool.acquire()) as FakeBrowser; const w = pool.acquire();
    await b.close(); pool.release(b);
    expect(await w).not.toBe(b); expect(launch).toHaveBeenCalledTimes(2);
  });
  it("a second release of the same browser is ignored", async () => {
    const { pool } = make(); const b = (await pool.acquire()) as FakeBrowser;
    pool.release(b); pool.release(b);
    expect(b.close).toHaveBeenCalledTimes(1); expect(pool.getStats()).toEqual(ZERO);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/scrapers/base/__tests__/browser-pool.test.ts` → the 8 new tests FAIL with `BrowserPool is not a constructor`; Task 1's 2 still pass.
- [ ] **Step 3: Implement the class** (rules the tests rely on; `available` is removed):
  - State: `pool: Browser[]` (launched, not closed), `leased: Set<Browser>`, `waiting: Array<{ resolve(b: Browser | null): void; reject(e: Error): void }>`, `pendingCreations`, `isClosing`, `generation` (incremented by `closeAll`).
  - `acquire()` is a `for (;;)` loop, no recursion: throw the closing error if `isClosing`; if `pool.length + pendingCreations < maxSize`, launch (remember `generation` first). On success, if `generation` changed or `isClosing`, close the new browser and throw the "while launching" error; else push to `pool`, add to `leased`, return it. On launch failure, wake one waiter with `null`, then rethrow (`pendingCreations--` in `finally`). Otherwise enqueue a waiter; a `Browser` result returns it, `null` loops again.
  - `release(b)`: if `!leased.delete(b)` → `console.warn("[BrowserPool] Ignoring release of a browser that is not leased")` and return. If closing or `!b.isConnected()` → drop it (remove from `pool`, `close().catch(() => {})`) and wake one waiter with `null`. Else if a waiter exists → `leased.add(b)`, resolve the oldest waiter with `b`. Else drop it and log `[BrowserPool] Closing released browser (no waiters, ${pool.length} total)`.
  - `remove(b)`: delete from `leased` and `pool`, close, wake one waiter with `null`.
  - `closeAll()`: `isClosing = true; generation++`; reject every waiter with the "while waiting" error; close every browser in `pool` (errors logged as today); reset `pool`, `leased`; `isClosing = false`.
  - `getStats()`: `{ total: pool.length, available: 0, inUse: leased.size, waiting: waiting.length }`.
  - Keep the existing `[BrowserPool]` log lines for create, hand-over and close-all.
- [ ] **Step 4: Run them and confirm they pass.** Same command → `Tests 10 passed (10)`; `$H npx tsc --noEmit` → exit 0; `$H npx vitest run` → all green.
- [ ] **Step 5: Commit**

```bash
git add src/scrapers/base/browser-pool.ts src/scrapers/base/__tests__/browser-pool.test.ts
git commit -m "fix(browser-pool): settle waiters on closeAll, close idle browsers on release, loop instead of recursion"
```

---

### Task 3: Remove write-only caches; `ScraperCache` expires on write

**Files:**
- Modify: `src/services/cache-manager.ts`, methods `set(key: string, value: T): void {` and `private evictOldest(): void {`
- Modify, in `src/scrapers/bookmakers/{superbet,forbet,etoto,fuksiarz,betfan,lvbet}/index.ts`, deleting:
  - the line `import { ScraperCache, CACHE_TTLS } from "../../../services/cache-manager.js";`;
  - the block `const eventsCache = new ScraperCache<…>({ … });` (lvbet: `const matchesCache = …`);
  - the methods `private updateCache(` and `private getCachedEvent(` (lvbet: `private getCachedMatch(`, which has no caller);
  - every `this.updateCache(…);` statement, and fuksiarz's `if (detailResponse?.data) { eventsCache.set(eventId, detailResponse.data); }`;
  - in `scrapeMatchDetails`, the block `const cachedEvent = this.getCachedEvent(eventId); if (cachedEvent) { return this.buildMatchDetailResult(cachedEvent, eventUrl, startTime); }`, so the method always takes its network path (O3).
- Modify `src/scrapers/bookmakers/etoto/navigation.ts`, deleting:
  - `CACHE_TTL,` from the constants import;
  - `const cachedEvents: Map<string, EtotoEvent> = new Map();` and `let cacheTimestamp: number = 0;`;
  - the two `cacheTimestamp = Date.now();` + `cachedEvents.set(…)` writes (keep `return events;` and `return response as EtotoEventDetailResponse;`);
  - the functions `export function getCachedEvent(` and `export function clearCache(`.

  Dead cache types and `CACHE_TTL` constants in `types.ts`/`constants.ts` stay for plan 10.
- Create: `src/scrapers/bookmakers/__tests__/fixtures/full-offer/{forbet,etoto,fuksiarz,betfan,lvbet,superbet}.json` with the command below. Run it from the worktree root; Task 4 adds the two betclic files. It was first tested on 2026-11-07 and re-proved on the future base on 2026-11-13, when the lvbet, superbet and fuksiarz parsers had changed. Sizes are unchanged: forbet 5 933, etoto 4 078, fuksiarz 4 001, betfan 21 493, lvbet 5 064 and superbet 10 562 bytes (51 KB). Each listing keeps exactly one valid event, and its trimmed detail parses to 3 markets (superbet 4, with `Date` frozen at 2026-11-07T00:00Z), so each scraper yields exactly one match:
  ```bash
  E=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence
  OUT=src/scrapers/bookmakers/__tests__/fixtures/full-offer && mkdir -p "$OUT" && $H python3 -I - "$E" "$OUT" <<'EOF'
  import json, os, sys
  E, OUT = sys.argv[1], sys.argv[2]
  load = lambda p: json.load(open(os.path.join(E, p)))
  def dump(bm, obj):
      json.dump(obj, open(os.path.join(OUT, bm + ".json"), "w"), ensure_ascii=False, indent=1)
  for bm, lst, det in [("forbet", "forbet-etoto/fb_list_major.json", "forbet-etoto/fb_detail.json"),
                       ("etoto", "forbet-etoto/et_list.json", "forbet-etoto/et_detail.json"),
                       ("fuksiarz", "lvbet-fuksiarz/fk_cat.json", "lvbet-fuksiarz/fk_ev.json")]:
      d = load(det); ev = d["data"]
      listing = next(e for e in load(lst)["data"] if e["eventId"] == ev["eventId"])
      d["data"] = {**ev, "eventGames": ev["eventGames"][:3]}
      dump(bm, {"listing": [{**listing, "eventGames": []}], "detail": d})
  ev = load("betfan-totalbet/bf-ev-40932985.json")["data"]["event"]
  listing = next(e for e in load("betfan-totalbet/bf-list-244.json")["data"]["categories"][0]["events"] if e["eventId"] == ev["eventId"])
  dump("betfan", {"listing": [{**listing, "games": []}], "detail": {**ev, "games": ev["games"][:3]}})
  mk = load("lvbet-fuksiarz/lv_mk1.json")
  match = next(m for m in load("lvbet-fuksiarz/lv_comp.json")["matches"] if m["match_id"] == mk[0]["match_id"])
  dump("lvbet", {"listing": {"matches": [match]}, "markets": mk[:3]})
  d = load("sts-superbet/data/sb-ev-far.json"); ev = d["data"][0]
  dump("superbet", {"listing": {"data": [{**ev, "odds": []}]}, "detail": {**d, "data": [{**ev, "odds": ev["odds"][:8]}]}})
  EOF
  ```
  Trimming: one event per bookmaker, its first 3 games (superbet: 8 odds, lvbet: 3 markets); listing copies carry no games.
- Test: `src/services/__tests__/cache-manager.test.ts` (new), `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` (new)
- Overlap: the recovery plans for these six brands have landed. They changed only normalizers, `parser.ts` and `types.ts` (fuksiarz `parser.ts:160-198`, superbet `types.ts:11-22`, lvbet `types.ts:19-71`). On the future base the six `index.ts` files and `etoto/navigation.ts` are byte-identical to master. Plans 03/04 run after this plan (README §5.0). They rename these classes to `<Brand>BrowserScraper`, keep them behind `SCRAPER_TRANSPORT_<BM>=browser`, and own the rename inside this harness (plan 03 Tasks 3/6/9/12, plan 04 Tasks 7/11; cross-plan #4). If one of them has landed first for a brand: instantiate `<Brand>BrowserScraper` in the harness, and delete the same cache snippets from that class. The harness still drives the browser class through its navigation mock, and plan 03/04's replay contract test covers the HTTP class.

**Interfaces:**
- Consumes: none.
- Produces: `ScraperCache` public API unchanged; `set()` now drops expired entries and keeps the map in write order, and a rewrite moves a key to the newest position. The harness (below) that Task 4 extends.

- [ ] **Step 1: Write the failing tests**

`cache-manager.test.ts` (`beforeEach`: `vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(0)`; `afterEach`: `vi.useRealTimers()`):
```ts
it("set() drops entries older than the TTL without any read", () => {
  const c = new ScraperCache<string>({ ttl: 1000, maxSize: 10 });
  c.set("a", "A"); vi.setSystemTime(500); c.set("b", "B"); vi.setSystemTime(1001); c.set("c", "C");
  expect(c.size).toBe(2); expect(c.getStats().size).toBe(2);
});
it("a full cache evicts the least recently written key; a rewrite counts as a write", () => {
  const c = new ScraperCache<string>({ ttl: 60_000, maxSize: 2 });
  c.set("a", "A1"); vi.setSystemTime(1); c.set("b", "B"); vi.setSystemTime(2); c.set("a", "A2"); vi.setSystemTime(3); c.set("c", "C");
  expect(c.get("b")).toBeUndefined(); expect(c.get("a")).toBe("A2"); expect(c.get("c")).toBe("C");
  expect(c.getStats().evictions).toBe(1);
});
```

`full-offer-fixtures.test.ts`, the harness (factories are hoisted, so fixtures are read lazily inside the mocked functions):
```ts
const fx = (bm: string) => JSON.parse(readFileSync(new URL(`./fixtures/full-offer/${bm}.json`, import.meta.url), "utf8"));
for each of forbet, etoto, fuksiarz, betfan:
  vi.mock("../<bm>/navigation.js", async (orig) => ({ ...(await orig<object>()), navigateToBaseSite: async () => true,
    fetchLeagueEvents: async () => fx("<bm>").listing, fetchEventDetails: async () => fx("<bm>").detail }));
vi.mock("../lvbet/navigation.js", …navigateToBaseSite: async () => true, fetchLeagueMatches: async () => fx("lvbet").listing, fetchMarketsForMatch: async () => fx("lvbet").markets);
vi.mock("../superbet/navigation.js", …navigateToLeaguePage: async () => true, fetchLeagueEvents: async () => fx("superbet").listing, fetchEventDetails: async () => fx("superbet").detail);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-07T00:00:00Z")); // superbet drops past kickoffs
  const page = Object.assign(new EventEmitter(), { mainFrame: () => null, url: () => "about:blank", title: async () => "" }); // observability's recorder (landed) attaches page.on/off and reads url/title, as in navigation-diagnostics.test.ts:46-53
  vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockResolvedValue({ page, browser: {}, context: {}, cleanup: async () => {} });
  vi.spyOn(PlaywrightScraper.prototype as any, "delay").mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const SCRAPERS = [["forbet", () => new ForbetPlaywrightScraper()], ["etoto", () => new EtotoPlaywrightScraper()],
  ["fuksiarz", () => new FuksiarzPlaywrightScraper()], ["betfan", () => new BetfanPlaywrightScraper()],
  ["lvbet", () => new LVBetPlaywrightScraper()], ["superbet", () => new SuperbetPlaywrightScraper()]] as const;

it.each(SCRAPERS)("%s scrapeFullOffer writes nothing to a ScraperCache", async (_bm, make) => {
  const set = vi.spyOn(ScraperCache.prototype, "set");
  const r = await make().scrapeFullOffer("premier-league");
  expect(r.matches).toHaveLength(1);
  expect(set).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/services/__tests__/cache-manager.test.ts src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` → 7 failed, 1 passed: "set() drops …" (expected 2, received 3); all 6 harness tests (`set` called 1×, fuksiarz 2×). The eviction test passes today: it pins behaviour. If a harness test fails with 0 matches instead, a fixture no longer parses on the worktree. Stop and re-check the fixture command; never relax the `toHaveLength(1)`.
- [ ] **Step 3: Implement.**
  - `set(key, value)`: take `now = Date.now()`, delete `key`, then delete entries from the head of the map while `now - timestamp > ttl`. The map is in write order, so stop at the first fresh entry. If `size >= maxSize`, evict the first key (`evictions++`). Insert `{ key, value, timestamp: now }` and update `stats.size`.
  - `evictOldest()` deletes the first key (O(1)).
  - Then the scraper and navigation deletions listed under Files.
  - Verify with `grep -nE "ScraperCache|eventsCache|matchesCache|updateCache|getCached(Event|Match)|cachedEvents|cacheTimestamp|clearCache" src/scrapers/bookmakers/{superbet,forbet,etoto,fuksiarz,betfan,lvbet}/{index,navigation}.ts` → no output.
- [ ] **Step 4: Run them and confirm they pass.** Same command → `Tests 8 passed (8)`; `$H npx tsc --noEmit` → exit 0; `$H npx vitest run` → all green.
- [ ] **Step 5: Commit**

```bash
git add src/services/cache-manager.ts src/services/__tests__/cache-manager.test.ts src/scrapers/bookmakers/{superbet,forbet,etoto,fuksiarz,betfan,lvbet}/index.ts src/scrapers/bookmakers/etoto/navigation.ts src/scrapers/bookmakers/__tests__
git commit -m "perf(scrapers): drop write-only event caches; ScraperCache expires on write"
```

---

### Task 4: Store `start_time` for forbet, etoto, betfan, lvbet, superbet and betclic

**Files:**
- Create: `src/scrapers/shared/start-time.ts`, `src/scrapers/shared/__tests__/start-time.test.ts`
- Modify (one statement each; index hunks stay one line):

  | file | find | replace with |
  |---|---|---|
  | `forbet/index.ts` | `startTime: fullEvent.eventStartTime,` | `startTime: toIsoStartTime(fullEvent.eventStart),` |
  | `etoto/index.ts` | `startTime: fullEvent.startTime ? new Date(fullEvent.startTime).toISOString() : undefined,` | `startTime: toIsoStartTime(fullEvent.eventStart),` |
  | `betfan/index.ts` | `startTime: detailEvent.eventStartTime ?? event.eventStartTime,` | `startTime: toIsoStartTime(detailEvent.eventStart ?? event.eventStart),` |
  | `betfan/index.ts` | `startTime: event.eventStartTime,` | `startTime: toIsoStartTime(event.eventStart),` |
  | `lvbet/index.ts` | `startTime: match.start_time,` | `startTime: toIsoStartTime(match.date),` |
  | `superbet/index.ts` | `startTime: fullEvent.startTime,` | `startTime: toIsoStartTime(fullEvent.unixDateMillis),` |
  | `betclic/index.ts` | in `scrapeFullOffer`, `matches.push({` … `matchId: listingMatch.matchId,` | add `startTime: toIsoStartTime(listingMatch.startTime),` after that line |

  Plus the `toIsoStartTime` import in each of these files.
- Modify, types (phantom field replaced by the real one; the comment line above each field is updated):
  - `forbet/types.ts` and `betfan/types.ts`: `eventStartTime?: string;` → `eventStart?: number;` (epoch ms).
  - `etoto/types.ts`: `startTime?: number;` in `EtotoEvent` → `eventStart?: number;`.
  - `lvbet/types.ts`, in `export interface LVBetMatch {`: `start_time?: string;` → `date?: string;` (ISO 8601 with offset). `LVBetMatchInfoResponse.start_time` has no reader and no capture: leave it.
  - `superbet/types.ts`: delete `startTime?: string;` from `SuperbetEvent` (`unixDateMillis` is the real field).
  - `betclic/types.ts`, in `export interface BetclicListingMatch {`: add `startTime?: string;` (raw listing field 3).
- Modify, betclic parsing:
  - `betclic/constants.ts`: in `export const PROTO_FIELDS = {` (`:75`), add `MATCH_START_TIME: 3,` after `MATCH_NAME: 2,` (`:82`).
  - `betclic/parser.ts`, in `export function parseListingResponse(` (`:871`): read `getFieldValue<string>(matchFields, PROTO_FIELDS.MATCH_START_TIME)` next to the `matchName` read (`:888`), and add `startTime` to the object built in `matches.push({ matchId, matchName, …` (`:926`).
- Not edited: fuksiarz (already reads `eventStart`; the harness pins it).
- Create, betclic fixtures (from the worktree root, after Task 3's fixture command):
  - The listing is the plan writer's 02:58 CET capture, trimmed to the Leeds–Tottenham entry's fields 1, 2, 3 and its three verbatim 1X2 outcomes (395 bytes; `parseListingResponse` → 1 match, odds 2.75/3.3/2.48).
  - The detail is `$E/betclic-fortuna/top.bin` with market container field 11 cut to its first 3 groups (15 404 bytes; `parseAllMarketsFromMultipleResponses` → 3 markets).
  ```bash
  E=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence
  OUT=src/scrapers/bookmakers/__tests__/fixtures/full-offer
  printf '%s' 'CogDGoUDCICAgYvc8J4CEhFMZWVkcyAtIFRvdHRlbmhhbRocMjAyNi0xMS0wN1QxMjozMDowMC4wMDAwMDAwWkrIAoIBZwiO4ICN3PCeAhAJOABKGmNvbnRlc3RhbnQ6NTQzODQxNDgwNDcxMTEyShpjb250ZXN0YW50OjU0Mzg0MTQ4MDQ3MDk5M1IFTGVlZHNaBUxlZWRzYQAAAAAAAAZAcAF4haCAjdzwngKCAWkIj+CAjdzwngIQBjgAShpjb250ZXN0YW50OjU0Mzg0MTQ4MDQ3MTExMkoaY29udGVzdGFudDo1NDM4NDE0ODA0NzA5OTNSBlJlbWlzIFoGUmVtaXMgYWZmZmZmZgpAcAF4haCAjdzwngKCAW8IkOCAjdzwngIQVjgAShpjb250ZXN0YW50OjU0Mzg0MTQ4MDQ3MTExMkoaY29udGVzdGFudDo1NDM4NDE0ODA0NzA5OTNSCVRvdHRlbmhhbVoJVG90dGVuaGFtYdejcD0K1wNAcAF4haCAjdzwngI=' | base64 -d > "$OUT/betclic-listing.bin"
  $H python3 -I - "$E/betclic-fortuna/top.bin" "$OUT/betclic-top.bin" <<'EOF'
  import sys
  def varint(b, i):
      r = s = 0
      while True:
          c = b[i]; i += 1; r |= (c & 0x7f) << s; s += 7
          if c < 0x80: return r, i
  def fields(b):  # [(field, raw bytes incl. tag, payload or None)]
      i, out = 0, []
      while i < len(b):
          s0 = i; k, i = varint(b, i); wt = k & 7; p = None
          if wt == 0: _, i = varint(b, i)
          elif wt == 1: i += 8
          elif wt == 5: i += 4
          else: n, i = varint(b, i); p = b[i:i + n]; i += n
          out.append((k >> 3, b[s0:i], p))
      return out
  def ld(f, p):
      def v(n):
          o = bytearray()
          while True:
              x = n & 0x7f; n >>= 7
              if n: o.append(x | 0x80)
              else: o.append(x); return bytes(o)
      return v(f << 3 | 2) + v(len(p)) + p
  buf = open(sys.argv[1], "rb").read()
  l1 = fields(fields(buf)[0][2]); match = fields(l1[0][2])
  groups = [x for x in fields(next(p for f, _, p in match if f == 11)) if x[0] == 3][:3]
  m11 = ld(11, b"".join(raw for _, raw, _ in groups))
  new_match = b"".join(m11 if f == 11 else raw for f, raw, _ in match)
  open(sys.argv[2], "wb").write(ld(1, ld(1, new_match) + b"".join(raw for _, raw, _ in l1[1:])))
  EOF
  ```
  (Both commands reproduce the files the harness was proven on: listing 395 bytes, detail 15 404 bytes. betclic `parser.ts`, `types.ts` and `index.ts` are byte-identical to master on the future base, so the proof still holds.)
- Test: extend `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts`
- Overlap:
  - lvbet.md Task 1 (428b02f), superbet.md Task 3 (c9ae032) and betclic.md Task 1 (221bc41) have landed, so there is no rebase step. Edit the files directly at these anchors:
    - `LVBetMatch` at `lvbet/types.ts:77`, with `start_time` at `:87`. `LVBetMatchInfoResponse.start_time` at `:121` stays.
    - `SuperbetEvent` at `superbet/types.ts:53`, with the phantom `startTime` at `:63`.
    - `BetclicListingMatch` at `betclic/types.ts:34-47`.
    - In betclic `index.ts`, the `matches.push({` is at `:296` and `matchId: listingMatch.matchId,` at `:297`.
  - **Single owner of betclic's kickoff (cross-plan #1).** This task is the only place that sets betclic `startTime`, from listing proto field 3. Plan 06 Task 4 parses only the match header's category list (field 10) and never sets `startTime`. Plan 10 reuses `BetclicListingMatch.startTime` and converts it with `toIsoStartTime`.
  - **Plan 06 Task 1** (README §5.0 F1, urgent) deletes `fetchMarketsHybrid` (`betclic/navigation.ts:577`; called at `index.ts:280`). If it has landed, the harness mocks `fetchMarketGroupResults` instead. The mock returns 7 `BetclicGroupResult` entries in `MARKET_GROUP_FILTERS` order. TOP is `{ group: "TOP", response: <betclic-top.bin>, error: null }`; the other six have `response: Buffer.alloc(0), error: null`, which plan 06 counts as valid but empty. The match therefore still yields 3 markets. Whichever of the two plans lands second makes this switch; plan 06 Task 1 does it when it is second (cross-plan #3). The `matches.push` hunk is unaffected.
  - **Plans 03/04** run after this plan (README §5.0). They import `toIsoStartTime` from this file and carry the fixed kickoff statements into their extracted mappings. If one of them has landed first for a brand, its index and types rows here are already done: skip them, and keep `toIsoStartTime`.

**Interfaces:**
- Consumes: the Task 3 harness and fixtures.
- Produces:
  - `export function toIsoStartTime(value: number | string | null | undefined): string | undefined` in `src/scrapers/shared/start-time.ts`.
    - A number `> 0` below `1e12` is epoch seconds, otherwise epoch ms (the rule fuksiarz uses).
    - A string goes through `Date.parse`.
    - Non-finite, `<= 0` or unparsable → `undefined`.
    - Returns `Date#toISOString()`. Plans 03, 04 and 10 import it from this path; none of them defines a second converter (cross-plan #16).
  - `BetclicListingMatch.startTime?: string` and `PROTO_FIELDS.MATCH_START_TIME = 3`.

- [ ] **Step 1: Write the failing tests**

`start-time.test.ts` (Review Focus 3):
```ts
it.each([
  [1794054600000, "2026-11-07T12:30:00.000Z"],                 // forbet/etoto/betfan/fuksiarz eventStart (ms)
  [1794054600, "2026-11-07T12:30:00.000Z"],                    // epoch seconds
  ["2026-11-08T14:00:00+00:00", "2026-11-08T14:00:00.000Z"],   // lvbet date
  ["2026-11-07T12:30:00.0000000Z", "2026-11-07T12:30:00.000Z"], // betclic listing field 3
  [0, undefined], [null, undefined], [undefined, undefined], ["not a date", undefined],
])("toIsoStartTime(%j) → %j", (input, expected) => expect(toIsoStartTime(input)).toBe(expected));
```
Harness additions (betclic needs no browser; its navigation mock returns the two binary fixtures):
```ts
vi.mock("../betclic/navigation.js", async (orig) => ({ ...(await orig<object>()),
  fetchLeagueMatches: async () => readFileSync(new URL("./fixtures/full-offer/betclic-listing.bin", import.meta.url)),
  fetchMarketsHybrid: async () => [readFileSync(new URL("./fixtures/full-offer/betclic-top.bin", import.meta.url))] }));
const KICKOFF_SCRAPERS = [...SCRAPERS, ["betclic", () => new BetclicPlaywrightScraper()]] as const;

it("betclic listing parser reads the kickoff string (proto field 3)", () =>
  expect(parseListingResponse(readFileSync(new URL("./fixtures/full-offer/betclic-listing.bin", import.meta.url)), "premier-league")[0].startTime)
    .toBe("2026-11-07T12:30:00.0000000Z"));
it.each([
  ["forbet", "2026-11-07T12:30:00.000Z"], ["etoto", "2026-11-07T12:30:00.000Z"], ["fuksiarz", "2026-11-07T12:30:00.000Z"],
  ["betfan", "2026-11-07T12:30:00.000Z"], ["lvbet", "2026-11-08T14:00:00.000Z"], ["superbet", "2026-11-21T12:30:00.000Z"],
  ["betclic", "2026-11-07T12:30:00.000Z"],
])("%s stores the kickoff in FullMatchOffer.startTime", async (bm, iso) => {
  const make = KICKOFF_SCRAPERS.find(([b]) => b === bm)![1];
  expect((await make().scrapeFullOffer("premier-league")).matches[0].startTime).toBe(iso);
});
```
betclic is not added to Task 3's no-cache test: its listing cache stays (small objects; plan 06 owns that file).

- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/scrapers/shared/__tests__/start-time.test.ts src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts`
  - Expected: module `../start-time.js` not found.
  - Harness: 7 failed (6 `startTime` are `undefined`, plus the parser test); fuksiarz passes.
  - Proven: all 7 kickoff scrapers yield 1 match, betclic with 3 markets. That was measured on master; on the future base the six other fixtures were re-proved (Task 3), and betclic's parser is unchanged.
- [ ] **Step 3: Implement `toIsoStartTime`,** then the betclic constant/type/parser change, then the index rows and type edits from the Files block. `tsc` now rejects any leftover read of a phantom field.
- [ ] **Step 4: Run them and confirm they pass.** Same command → `Tests 22 passed (22)` (8 + 6 + 1 + 7); `$H npx tsc --noEmit` → exit 0; golden count equal to the recorded baseline; `$H npx vitest run src/scrapers/bookmakers/betclic` → green.
- [ ] **Step 5: Commit**

```bash
git add src/scrapers/shared src/scrapers/bookmakers/{forbet,etoto,betfan,lvbet,superbet}/{index,types}.ts src/scrapers/bookmakers/betclic/{constants,types,parser,index}.ts src/scrapers/bookmakers/__tests__
git commit -m "fix(scrapers): store kickoff time for forbet, etoto, betfan, lvbet, superbet and betclic"
```

---

### Task 5: Superbet listing window = today + 90 days

**Files:**
- Modify: `src/scrapers/bookmakers/superbet/navigation.ts`, inside `export async function fetchLeagueEvents(`. The template containing `endDate=2027-12-30+00:00:00` and its `const today = new Date()…` line leave the in-page function. The URL is built in Node and passed into `page.evaluate` as its argument.
- Test: `src/scrapers/bookmakers/superbet/__tests__/listing-url.test.ts` (new)
- Overlap: superbet.md (landed) changed only `types.ts` and `parser.ts`. `superbet/navigation.ts` is byte-identical to master on the future base, and `:101-103` still builds `endDate=2027-12-30`. Plan 04's superbet `HttpScraper` calls `buildSuperbetListingUrl` directly.

**Interfaces:**
- Consumes: `API_BASE_URL`, `SPORT_ID_FOOTBALL` (`superbet/constants.ts:17`, `:55`).
- Produces: `export const SUPERBET_LISTING_WINDOW_DAYS = 90;` and `export function buildSuperbetListingUrl(tournamentIds: string, now: Date = new Date()): string` in `superbet/navigation.ts`. Both dates are UTC calendar days (`toISOString().slice(0, 10)`, same as today's `startDate`). `page.evaluate` receives `(fn, apiUrl: string)`.

- [ ] **Step 1: Write the failing test**

```ts
const BASE = "https://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL/events/by-date";
it("ends the listing window 90 days after today (UTC)", () =>
  expect(buildSuperbetListingUrl("106", new Date("2026-11-07T10:00:00Z"))).toBe(
    `${BASE}?offerState=prematch&startDate=2026-11-07+00:00:00&endDate=2027-02-05+00:00:00&sportId=5&tournamentIds=106`));
it("rolls over the year", () =>
  expect(buildSuperbetListingUrl("106", new Date("2026-12-31T23:30:00Z"))).toContain("startDate=2026-12-31+00:00:00&endDate=2027-03-31+00:00:00"));
it("fetchLeagueEvents sends the built URL into the page", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
  const page = { evaluate: vi.fn(async () => ({ data: [] })) };
  await fetchLeagueEvents(page as any, "premier-league");
  expect(page.evaluate.mock.calls[0][1]).toBe(buildSuperbetListingUrl("106", new Date("2026-11-07T10:00:00Z")));
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run it and confirm it fails.** `$H npx vitest run src/scrapers/bookmakers/superbet/__tests__/listing-url.test.ts` → `buildSuperbetListingUrl is not a function`.
- [ ] **Step 3: Implement `buildSuperbetListingUrl`.** End date = `now + SUPERBET_LISTING_WINDOW_DAYS × 86 400 000 ms`. `fetchLeagueEvents` passes `buildSuperbetListingUrl(tournamentIdsParam)`, and the in-page function only fetches it. The `2027-12-30` literal and its comment go.
- [ ] **Step 4: Run it and confirm it passes.** Same command → `Tests 3 passed (3)`; `$H npx tsc --noEmit` → exit 0.
- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/superbet/navigation.ts src/scrapers/bookmakers/superbet/__tests__/listing-url.test.ts
git commit -m "fix(superbet): rolling 90-day listing window instead of a hard-coded end date"
```

---

### Task 6: Memoize `matchToCanonical` per (league, name), misses included

**Files:**
- Modify: `src/utils/team-matcher.ts`, `export function matchToCanonical(` (hint `:621-708`): its body after the `if (teams.length === 0) { … }` guard (`:626-629`) becomes a private `resolveCanonical(scrapedName, league, teams)`, and `matchToCanonical` wraps it
- Test: `src/utils/__tests__/team-matcher-memo.test.ts` (new). These stay green and unchanged: `team-matcher-collision.test.ts`, `world-cup-team-matcher.test.ts`, **`team-matcher-fortuna-labels.test.ts`** (fortuna recovery) and `golden.test.ts`.
- Overlap: fortuna recovery (41fb299, on `recovery/fortuna`, merged by R0) edited `team-matcher.ts`. It added aliases and `matchTeamByExactAlias` (`:720`), which resolves only through the alias tiers (`LEAGUE_ALIASES`, `getNormalizedAliases`) and never calls `matchToCanonical`. Leave it untouched and do not memoize it. totalbet and betby only call `getCanonicalTeamName`.

**Interfaces:**
- Consumes: none.
- Produces: `export const TEAM_MATCH_MEMO_MAX = 10_000;` and `export function clearTeamMatchMemo(): void` (tests; also safe for a future reload of team data). Memo rules:
  - A `Map<string, CanonicalTeam | null>` keyed `` `${league}\u0000${scrapedName}` `` (raw name: the alias step `:635` reads the raw name).
  - Consulted and filled only after the unknown-league return (`console.warn(\`[TeamMatcher] Unknown league: "${league}"\`)`, which keeps warning on every call) and only when `process.env.TEAM_MATCHER_DEBUG !== "true"`.
  - Stores misses (`null`).
  - When `size >= TEAM_MATCH_MEMO_MAX`, deletes the first-inserted key before inserting (FIFO, O(1)). 10 000 entries ≈ 1.5 MB, about 17 PL runs of the 568 distinct Fuse patterns measured in O6.
  - Team data and `LEAGUE_ALIASES` are static (`src/data/index.ts:10-21`), and the Fuse index is already cached per league forever (`team-matcher.ts:563-584`). Results are therefore deterministic and identity-equal to today's.
  - `TEAM_MATCHER_DEBUG=true` also enables the ambiguous-substring warning (`:677-682`); bypassing the memo keeps it per call.

- [ ] **Step 1: Write the failing tests** (`beforeEach(() => clearTeamMatchMemo())`; `search = vi.spyOn(Fuse.prototype, "search")` with `import Fuse from "fuse.js"`, which is the same module instance team-matcher uses, verified)

```ts
it("a repeated miss runs Fuse once and still returns null", () => {
  expect(matchToCanonical("Bukayo Saka", "premier-league")).toBeNull();
  expect(matchToCanonical("Bukayo Saka", "premier-league")).toBeNull();
  expect(search).toHaveBeenCalledTimes(1);
});
it("a repeated fuzzy hit returns the same team and runs Fuse once", () => {
  expect(matchToCanonical("Totenham", "premier-league")?.name).toBe("Tottenham Hotspur");
  expect(matchToCanonical("Totenham", "premier-league")?.name).toBe("Tottenham Hotspur");
  expect(search).toHaveBeenCalledTimes(1);
});
it("memoizes per league", () => {
  matchToCanonical("Bukayo Saka", "premier-league"); matchToCanonical("Bukayo Saka", "ekstraklasa");
  expect(search).toHaveBeenCalledTimes(2);
});
it("evicts the oldest entry beyond TEAM_MATCH_MEMO_MAX", () => {
  matchToCanonical("Bukayo Saka", "premier-league");
  for (let i = 0; i < TEAM_MATCH_MEMO_MAX; i++) matchToCanonical(`Arsenal ${i}`, "premier-league"); // substring path, no Fuse (~40 ms)
  matchToCanonical("Bukayo Saka", "premier-league");
  expect(search).toHaveBeenCalledTimes(2);
});
it("an unknown league still warns on every call (Review Focus 4)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  matchToCanonical("Arsenal", "no-such-league"); matchToCanonical("Arsenal", "no-such-league");
  expect(warn).toHaveBeenCalledTimes(2); expect(warn).toHaveBeenCalledWith('[TeamMatcher] Unknown league: "no-such-league"');
});
it("TEAM_MATCHER_DEBUG=true bypasses the memo (Review Focus 4)", () => {
  vi.stubEnv("TEAM_MATCHER_DEBUG", "true"); vi.spyOn(console, "warn").mockImplementation(() => {});
  matchToCanonical("Bukayo Saka", "premier-league"); matchToCanonical("Bukayo Saka", "premier-league");
  expect(search).toHaveBeenCalledTimes(2); vi.unstubAllEnvs();
});
```
(`afterEach(() => vi.restoreAllMocks())`.)

- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/utils/__tests__/team-matcher-memo.test.ts` → FAIL: `clearTeamMatchMemo is not a function`.
- [ ] **Step 3: Implement the memo wrapper in `team-matcher.ts`** per the rules above. The matching logic and its comments move unchanged into `resolveCanonical`.
- [ ] **Step 4: Run them and confirm they pass.** Same command → `Tests 6 passed (6)`. `$H npx vitest run src/utils src/services/normalization/__tests__/golden.test.ts` → green, including `team-matcher-fortuna-labels.test.ts`, with the golden count equal to the recorded baseline. `$H npx tsc --noEmit` → exit 0.
- [ ] **Step 5: Commit**

```bash
git add src/utils/team-matcher.ts src/utils/__tests__/team-matcher-memo.test.ts
git commit -m "perf(team-matcher): memoize matchToCanonical per league and name, misses included"
```

---

### Task 7: Yield to the event loop once per match in `normalizeAndSaveMatches`

**Files:**
- Modify: `src/services/scrape-helpers.ts`: the import block at the top (`:1-5`), and the first statement inside `for (const match of matches) {` in `normalizeAndSaveMatches` (hint `:33`)
- Test: `src/services/__tests__/scrape-helpers.test.ts` (new; the existing `scrape-helpers-batch-errors.test.ts` from observability stays unchanged and green)
- Overlap: none left to rebase. betcris.md Task 6 put the summary call after the loop (`:52-57`), and observability put the batch-error branch at `:59-73` (`if (options.useBatchInsert && normalizedMatches.length > 0) {`). Both have landed. This task touches only the imports and the loop's first statement.

**Interfaces:**
- Consumes: none.
- Produces: no new export. At the **top** of each loop iteration, before normalizing, `await setImmediate()` from `node:timers/promises` (imported as `yieldToEventLoop`): N matches → N yields, the first one included, so the ready I/O of the just-finished scrape is processed first.

- [ ] **Step 1: Write the failing tests**

```ts
vi.mock("node:timers/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:timers/promises")>();
  return { ...actual, setImmediate: vi.fn(actual.setImmediate) };
});
vi.mock("../normalization/index.js", () => ({ normalizeMarketsForBookmaker: vi.fn((markets: unknown[]) => markets) }));
// The full BatchSaveResult (full-offer-repository.ts:562-572): scrape-helpers reads failedBatches/totalBatches/firstError.
vi.mock("../../repositories/full-offer-repository.js", () => ({
  saveBatchFullOfferMarkets: vi.fn(async (): Promise<BatchSaveResult> => ({ inserted: 0, filtered: 0, errors: 0, matchesProcessed: 0,
    failedBatches: 0, totalBatches: 0, firstError: null })),
  saveFullOfferMarkets: vi.fn() }));
import type { BatchSaveResult } from "../../repositories/full-offer-repository.js";
import { setImmediate as yieldSpy } from "node:timers/promises";
const match = (home: string, markets: unknown[] = []) =>
  ({ matchId: home, bookmaker: "lvbet", homeTeam: home, awayTeam: "X", eventUrl: "", markets, scrapedAt: new Date() }) as FullMatchOffer;

it("yields to the event loop once per match", async () => {
  await normalizeAndSaveMatches([match("A"), match("B"), match("C")], "lvbet", "premier-league", { useBatchInsert: true });
  expect(vi.mocked(yieldSpy)).toHaveBeenCalledTimes(3);
});
it("lets an already-queued callback run before the second match is normalized", async () => {
  const order: string[] = [];
  vi.mocked(normalizeMarketsForBookmaker).mockImplementation((mk, _bm, home) => { order.push(home!); return mk; });
  const p = normalizeAndSaveMatches([match("A"), match("B"), match("C")], "lvbet", "premier-league", { useBatchInsert: true });
  setImmediate(() => order.push("io"));
  await p;
  expect(order).toEqual(["A", "io", "B", "C"]);  // verified on Node 20 with a scratch copy of the loop
});
it("a throwing match still yields, is recorded, and the next match is normalized (Review Focus 5)", async () => {
  vi.mocked(normalizeMarketsForBookmaker).mockImplementation((mk, _bm, home) => { if (home === "B") throw new Error("boom"); return mk; });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const r = await normalizeAndSaveMatches([match("A"), match("B"), match("C")], "lvbet", "premier-league", { useBatchInsert: true });
  expect(r.matchesProcessed).toBe(2); expect(r.errors).toEqual(["Normalization failed for B vs X: boom"]);
  expect(vi.mocked(yieldSpy)).toHaveBeenCalledTimes(3);
});
```
(`beforeEach(() => vi.clearAllMocks())`; reset the `normalizeMarketsForBookmaker` implementation to identity in `beforeEach`. The markets carry no `normalizedType`, so the landed unmapped-summary call logs nothing in these tests. A test that needs the real repository uses `createFakeSupabase` from `src/__tests__/helpers/fake-supabase.ts`, as `scrape-helpers-batch-errors.test.ts` does; these three do not.)

- [ ] **Step 2: Run them and confirm they fail.** `$H npx vitest run src/services/__tests__/scrape-helpers.test.ts` → 3 failed: spy called 0 times; order `["A","B","C","io"]`.
- [ ] **Step 3: Implement the yield** as specified under Produces.
- [ ] **Step 4: Run them and confirm they pass.** Same command → `Tests 3 passed (3)`; `$H npx vitest run src/services/__tests__ src/services/normalization/__tests__/unmapped-summary.test.ts` → green (incl. `scrape-helpers-batch-errors.test.ts` and the landed wiring test); `$H npx tsc --noEmit` → exit 0; `$H npx vitest run` → all green.
- [ ] **Step 5: Commit**

```bash
git add src/services/scrape-helpers.ts src/services/__tests__/scrape-helpers.test.ts
git commit -m "perf(normalization): yield to the event loop between matches"
```

---

### Task 8: Unmapped-market summary keeps the top 20; the factory's per-market OTHER line becomes opt-in

**Files:**
- Modify: `src/services/normalization/unmapped-summary.ts` (landed with betcris.md Task 6, 2ea100a). Replace `const DEFAULT_TOP_N = 5;` (`:14`) with `export const UNMAPPED_SUMMARY_TOP_N = 20;`, and use it as the default of `summarizeUnmappedMarkets` (`:21`). Nothing else in the module changes.
- Modify: `src/services/normalization/factory.ts`, the statement `console.warn(\`[Normalizer] Market mapped to OTHER: "${originalName}"\`);` in `toNormalizedMarket` (`:131`).
- Modify: `.env.example`, right after the `# Alerts` block (cross-plan #33):
  ```text
  # Normalization
  # Set to "true" to log one "[Normalizer] Market mapped to OTHER" line per unmapped market (default: one [ScrapeHelpers] summary line per bookmaker per run)
  # NORMALIZER_LOG_OTHER=true
  ```
- Test: extend `src/services/normalization/__tests__/unmapped-summary.test.ts`, which holds 3 tests today (`:20`, `:26`, `:31`; the third is a wiring test through `normalizeAndSaveMatches`). Reuse its `mk` helper and its repository mock.
- Not edited: `src/services/scrape-helpers.ts`. The summary call already exists after the loop (`:52-57`); do not add a second one. No per-bookmaker normalizer is edited, and the `[superbet] Unmapped market` lines stay (Open Question 2).
- Overlap: none. README §5.1's "betcris Task 6 vs 01 Task 8" row is resolved: betcris Task 6 landed first, so this task only changes the default, adds tests and edits `factory.ts`.

**Interfaces:**
- Consumes (landed): `UnmappedSummary`, `summarizeUnmappedMarkets(markets: ScrapedMarket[], topN?: number): UnmappedSummary` and `formatUnmappedSummary(bookmaker: string, s: UnmappedSummary): string`. The line is `[ScrapeHelpers] <bm>: <distinctIds> unmapped market ids, <otherMarkets> OTHER markets this run (top: <key>×<n>, …)`. It counts `normalizedType === "OTHER"` with key `bookmakerMarketId ?? name`, and `top` is sorted by count desc, then by key asc.
- Produces: `export const UNMAPPED_SUMMARY_TOP_N = 20;`, the default `topN`. `factory.ts:131` logs only when `process.env.NORMALIZER_LOG_OTHER === "true"` (read per call); the text stays the same.

- [ ] **Step 1: Write the failing tests.** Append them to the file's `describe("unmapped market summary", …)` and add `import { normalizer } from "../index.js";`:

```ts
it("keeps the 20 most frequent keys", () => {
  const markets = Array.from({ length: 25 }, (_, i) => Array.from({ length: i + 1 }, () => mk(`id${String(i).padStart(2, "0")}`, "OTHER"))).flat();
  const s = summarizeUnmappedMarkets(markets);
  expect(s).toMatchObject({ otherMarkets: 325, distinctIds: 25 });
  expect(s.top).toHaveLength(20); expect(s.top[0]).toEqual(["id24", 25]); expect(s.top[19]).toEqual(["id05", 6]);
});
it("the factory no longer warns once per OTHER market", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const r = normalizer.normalize({ name: "Zupełnie nieznany rynek", bookmakerMarketId: "bc:999", selections: [{ name: "Tak", odds: 2 }] }, "lvbet", "Arsenal", "Chelsea", "premier-league");
  expect(r.normalizedType).toBe("OTHER"); expect(warn).not.toHaveBeenCalled();
});
it("NORMALIZER_LOG_OTHER=true restores the per-market line", () => {
  vi.stubEnv("NORMALIZER_LOG_OTHER", "true"); const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  normalizer.normalize({ name: "Zupełnie nieznany rynek", bookmakerMarketId: "bc:999", selections: [{ name: "Tak", odds: 2 }] }, "lvbet", "Arsenal", "Chelsea", "premier-league");
  expect(warn).toHaveBeenCalledWith('[Normalizer] Market mapped to OTHER: "Zupełnie nieznany rynek"'); vi.unstubAllEnvs();
});
```
The lvbet normalizer emits no warning of its own for this market. This was re-checked on the future base on 2026-11-13: the only line is the factory's. The tests use the default parameter and do not import the constant. The file's `afterEach(() => vi.restoreAllMocks())` restores the spies.

- [ ] **Step 2: Run them and confirm 2 failures.** `$H npx vitest run src/services/normalization/__tests__/unmapped-summary.test.ts` → 2 failed, 4 passed. The two failures are "keeps the 20 most frequent keys" (`top` has length 5) and "the factory no longer warns once per OTHER market" (warned once). "NORMALIZER_LOG_OTHER=true restores …" passes today, because it pins the opt-in. The 3 landed tests pass.
- [ ] **Step 3: Implement** the exported constant, the env guard in `factory.ts` and the `.env.example` entry.
- [ ] **Step 4: Run them and confirm they pass.** Same command → `Tests 6 passed (6)`. Golden count equal to the recorded baseline. `$H npx tsc --noEmit` → exit 0. `$H npx vitest run` → the recorded baseline + 7 files / + 49 tests, all green.
- [ ] **Step 5: Commit**

```bash
git add src/services/normalization/unmapped-summary.ts src/services/normalization/__tests__/unmapped-summary.test.ts src/services/normalization/factory.ts .env.example
git commit -m "perf(normalization): top-20 unmapped summary; per-market OTHER warning only with NORMALIZER_LOG_OTHER"
```

---

### Task 9: Live verification (no code)

**Files:** none. Step 1 runs in this worktree: it is a dry smoke with no DB access and no writes (observability's `scripts/smoke-bookmaker.ts` without `--persist`). Steps 2–5 need a merge and a persisting scheduled run, so they are **deferred to the owner** (EXECUTION rule 4). The implementer copies their commands and expected results into the task report and runs nothing against the live backend. The aggregator prints one line per bookmaker: `[Aggregator/FullOffer] <bm> <status>: N matches, M markets found, K saved[ - err]`, with status `success|partial|empty|scrape_failed|persist_failed` (observability `aggregator.ts:244-245`).

- [ ] **Step 1: Launch-args parity, before the merge** (implementer, `$H --live`). Run one bookmaker at a time, all four runs inside one HH:10–HH:50 window, with no other Playwright tool running. For `fortuna` and `betcris`, run the dry smoke first in the **integration worktree** (the pre-Task-1 pool, read-only: no file is swapped or edited there), then in this plan's worktree (orchestrator decision 2026-11-13: no temporary file swaps):
  ```bash
  INT=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/integration
  mkdir -p .scratch/task9 && : > .scratch/task9/smoke.txt
  for BM in fortuna betcris; do
    (cd "$INT" && $H --live timeout 600 npx tsx scripts/smoke-bookmaker.ts --bookmaker $BM) | grep '^SMOKE_RESULT' | sed 's/^/before /' >> .scratch/task9/smoke.txt
    $H --live timeout 600 npx tsx scripts/smoke-bookmaker.ts --bookmaker $BM | grep '^SMOKE_RESULT' | sed 's/^/after /' >> .scratch/task9/smoke.txt
  done
  ```
  Precondition for the "before" side: the integration worktree contains `scripts/smoke-bookmaker.ts` (i.e. observability is merged, R0); `git -C "$INT" status --short` must be unchanged afterwards.
  Pass, for each bookmaker:
  - `"status":"scraped"` on both sides;
  - `matches` equal;
  - the after `marketsFound` within ±2 % of the before `marketsFound`.

  On a miss, rerun the pair once. A second miss blocks the merge: revert Task 1 and report.
- [ ] **Step 2: Baseline before the merge (owner, deferred).** Measure one scheduled run of the pre-merge code.
  - 75 s after its `[Aggregator/FullOffer] Starting run <id> for premier-league with 14 bookmakers` line, record `B = pgrep -fc chromium_headless_shell`.
  - At the same moment, record `R_B`: how many of the 10 browser scrapers (betcris, betfan, etoto, forbet, fortuna, fuksiarz, lvbet, pzbuk, sts, superbet) have no `[Aggregator/FullOffer] <bm> <status>:` line yet.

  The 2026-11-07 figure, 69–70 processes with 13 browser scrapers, is no longer the baseline, because totalbet, betters and lebull are browserless now. Expected: `B > 10 × R_B`, which is the leak this plan removes.
- [ ] **Step 3: Merge, then browser memory on the first run after it (owner, deferred).** Merge outside HH:55–HH:10. The observed run is the restart's startup scrape (`scheduler-service.ts:196-201`) or the next scheduled run. Measure `A` and `R_A` the same way as in Step 2.
  - Pass: `A ≤ 10 × R_A`. Only browser scrapers that are still running hold Chromium.
  - In that run's log, `grep -c '\[BrowserPool\] Closing released browser'` ≥ the number of the 10 browser scrapers whose line is not `scrape_failed`. Each browser scraper releases once per league.
- [ ] **Step 4: Logs of that run (owner, deferred).** Strip colours with `sed 's/\x1b\[[0-9;]*m//g' <server log>`, then restrict to that run, from its `Starting run` line to its `Run <id> completed` line.
  - `grep -c '\[Normalizer\] Market mapped to OTHER'` = 0.
  - `grep -oE '^\[ScrapeHelpers\] [a-z]+:' | sort | uniq -d` prints nothing, so there is at most one summary per bookmaker.
  - `grep -cE '^\[ScrapeHelpers\] [a-z]+: [0-9]+ unmapped market ids'` ≥ 1 and ≤ the number of `^\[Aggregator/FullOffer\] [a-z]+ (success|partial|persist_failed):` lines. These are the bookmakers that normalized at least one match.
- [ ] **Step 5: Kickoffs persisted (owner, deferred; read-only SQL within 30 min of the run):**
  ```bash
  docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' supabase_db_backend psql -U postgres -d postgres -X -c "select bookmaker, count(*) filter (where start_time is null) as null_st, count(*) as total from odds where scraped_at > now() - interval '30 minutes' group by 1 order by 1;"
  ```
  Pass: `null_st = 0` for every bookmaker with `total > 0`. That covers the six fixed here (betclic, betfan, etoto, forbet, lvbet, superbet) and the eight that already write the kickoff on the future base (betcris, betters, fortuna, fuksiarz, lebull, pzbuk, sts, totalbet). Baseline at the 2026-11-07 01:00Z run: the six had 3121/5130/6080/5531/8824/12490 NULL rows.

---

## Self-Review

Re-run on 2026-11-13 against the future base.

1. **Spec coverage.** The eight scoped items map to Tasks 1–8, and Task 9 is the live gate.
   - Item 1 → Task 1.
   - Item 2 → Task 2: waiters, loop, close-on-release and the launch seam. The `browserPool`, `closeAllBrowsers` and `getStats` shapes are kept.
   - Item 3 → Task 3. Readers were checked, and the miss behaviour is stated in O3.
   - Item 4 → Task 4. The scope changed after verification, as the coordinator confirmed. fuksiarz is already correct (0/5 751 NULL), so it is pinned by a test, not edited. superbet (12 490/12 490) and betclic (3 121/3 121) were added; betclic reads listing proto field 3, proven on a live capture. This plan is the single owner of betclic's kickoff (cross-plan #1).
   - Item 5 → Task 5 (injectable clock).
   - Item 6 → Task 6: bound 10 000, FIFO, and `matchTeamByExactAlias` untouched. The short-label skip is left as Open Question 1.
   - Item 7 → Task 7.
   - Item 8 → Task 8. It is a "Modify" of the landed betcris Task 6 module: default 20, an opt-in factory line, and a `.env.example` entry.
2. **Step scan.** No TBD. Every step names the exact command (through `$H`) and the expected count. Totals are deltas from the recorded worktree baseline (+7 files / +49 tests). Two places carry implementation rules instead of code, because the tests do not fully determine them: the pool algorithm and the cache head-pruning.
   - No step writes to the DB, starts the server or writes into the main checkout. Task 9 Steps 2–5 are owner checks with exact commands and pass criteria.
3. **Type consistency.**
   - Each of these is defined once and used with the same signature: `BROWSER_ARGS`, `BrowserLauncher`, `BrowserPool`, `toIsoStartTime`, `buildSuperbetListingUrl`, `SUPERBET_LISTING_WINDOW_DAYS`, `TEAM_MATCH_MEMO_MAX`, `clearTeamMatchMemo` and `UNMAPPED_SUMMARY_TOP_N`. The last replaces the landed private `DEFAULT_TOP_N`.
   - `summarizeUnmappedMarkets`, `formatUnmappedSummary` and `BatchSaveResult` are consumed as landed.
   - No §3 name is used or shadowed; this plan consumes nothing from plan 02.
   - `toIsoStartTime` lives at `src/scrapers/shared/start-time.ts`, the path plans 03, 04 and 10 import.
4. **Review focus.** Each of the five items has a named test in its owning task.
5. **Proportion.** The plan carries signatures, rules and assertions. The only code bodies are test code, the fixture commands and the Task 9 smoke loop.
6. **Fixed during review:**
   - Unhandled-rejection traps in the pool tests: waiters get settled handlers before `closeAll()`.
   - Hoisted `vi.mock` factories read fixtures lazily.
   - The fake page is an EventEmitter, so the harness survives observability's recorder, which has landed.
   - Superbet's harness pins `Date` (its listing drops past kickoffs).
   - A rebuilt betclic listing failed the parser's string heuristic: odds bytes `ffffff\n@` decode as text. The fixture keeps the real outcome bytes instead.
   - Edits are located by quoted snippet, and each overlapping plan has a skip rule (plans 03, 04 or 06 landing first).
   - The memo bypass covers unknown leagues and debug mode, so their logging stays per call.
   - 2026-11-13 revision:
     - Task 8 no longer creates a module that exists, and no longer adds a second summary call.
     - Task 7's repository mock returns the full `BatchSaveResult`.
     - Task 4 no longer carries rebase steps for plans that have landed.
     - Task 9 no longer relies on a 13-browser baseline or the old `completed` log wording.
     - The six harness fixtures were re-proved on the future base.

## Open Questions

1. **Skip the Fuse step for labels that cannot be team names** (length < 4, or containing a digit). This is a behaviour change, not a cache. Today `tak`→Stoke City, `nie`→Sunderland, `gol`→Liverpool and `nikt`→Leeds United (totalbet.md:732; reproduced: `matchToCanonical("Tak","premier-league")` returns Stoke City). The change could alter golden output wherever such a label equals a side. *Recommended default:* not in this plan. Run it as its own task with a full golden diff, after Task 6 has removed the CPU motive.
2. **Aggregate the per-bookmaker unmapped lines too** (`[superbet] Unmapped market`: 13 108 lines per PL run; fortuna `Unknown market`: ~4 000). That means editing `superbet-normalizer.ts` and `fortuna-normalizer.ts`. superbet.md has landed on `recovery/integration`; fortuna.md's Tasks 5–6 are on `recovery/fortuna` (merged by R0). *Recommended default:* yes, as a follow-up once fortuna's recovery is merged and live-checked (fortuna.md Task 7). Route them through `summarizeUnmappedMarkets`, so each bookmaker logs a single summary line per call.
