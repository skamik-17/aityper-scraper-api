# Browser Runtime (Fallback-Only Playwright Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2026-11-13:**
> - **Base moved** to `recovery/integration` (≥ `aaf7c07`) + observability + fortuna. **Blocked until plan 06 Task 1** (README §5.0 F1): `betclic/tab-scraper.ts` and its `fetchMarketsHybrid` launch path are still on integration. **Plan 07 Task 1 is a hard precondition**: admin still calls `runScrapeAndPersist` with `closeBrowsers = true` (`admin.ts:58` → `scraper-service.ts:154-161`), which with one shared browser would close every running session. Plan 07 Task 2 is the rebase partner for `executeWithBrowser` (its abort → `context.close` hook is kept).
> - Observability's code in `executeFullOfferScrape` landed (`playwright-base.ts:353-391`, navigation recorder inside the operation). Task 5 adds a trailing `budget?` there, forwards it to `initBrowser(budget)`, and `initBrowser` falls back to `currentScrapeJob()?.budget` (cross-plan #9).
> - **sts and betcris stay on the browser by default** (owner C for betcris; sts until 05a). The session lifetime now comes from plan 07's `maxDurationMsFor(bm, "browser")` — sts 360 s, betcris and pzbuk 600 s, others 240 s — so the runtime never cuts a run plan 07 allows; Task 8's A/B for them runs on the default path. Returning partial results when betcris's budget expires is left as Open Question 4.
> - The 10 browser classes are listed (Task 5); the non-existent betby `browserPool` guard and the `betters/`/`lebull/navigation.ts` hunk are dropped (betby deleted those files); existing guards stub `initBrowser`. `navigateWithRetry` has no caller left once `tab-scraper.ts` is gone, so Task 7 deletes it instead of extending it.
> - Cross-plan fixes: Task 3 turns 05b's betcris stylesheet guard into `resolveBrowserPolicy("betcris", …)` + "no stylesheet pattern" (#5); Task 5 deletes plan 01's `browser-pool.test.ts` and ports what still matters (#6); the UA constant is `BROWSER_CONTEXT_USER_AGENT` (#22); the rollout keeps pzbuk at `block: "none"` (#24); `.env.example` gets `SCRAPER_BROWSER_BLOCK_<BM>` / `SCRAPER_BROWSER_STEALTH_<BM>` (#33); a test pins that a retried crash carries the second attempt's diagnostics.
> - Anchors re-pinned (`initBrowser :93-170`, route block `:146-154`, `executeWithBrowser :335-351`, `scraper-audit-core.ts :119/:126`; `browser-pool.ts` unchanged since master); EXECUTION workspace rules adopted.
> - Evidence: `evidence/delta-audit-infra-2026-11-13.md` (README items 6, 15; section "08-browser-runtime"), `evidence/cross-plan-review-2026-11-07.md` #5, #6, #9, #22, #24, #33.

**Goal:** Make the Playwright layer that remains cheap and correct. That layer is the scrapers still on the browser (on the future base: 10 default classes, incl. sts and betcris, which stay there by owner decision or until 05a), the per-bookmaker browser fallbacks plans 03–05 keep, and the audit/discovery tooling. The work: one shared headless-shell browser with a context per session, a session cap whose waiters always settle, session lifetimes that match plan 07's budgets, opt-in CDP blocking that keeps the HTTP cache, opt-in client-hint-consistent stealth, and deletion of the dead route/stealth/`navigateWithRetry` code.

**Architecture:** `BrowserRuntime` (`src/scrapers/base/browser-runtime.ts`) replaces `BrowserPool`: one Chromium headless shell launched on demand (single-flight), one `BrowserContext` per session behind a `Semaphore`, sessions that end on abort, lifetime expiry or crash, and an idle close. A per-page CDP setup counts traffic and applies the scraper's `policy.browser` (blocking via `Network.setBlockedURLs` URLPattern `urlPatterns`; stealth via `Network.setUserAgentOverride` with `userAgentMetadata` plus init-script shims). `PlaywrightScraper.initBrowser(budget?)` keeps its name and `{page, browser, context, cleanup}` shape and takes its budget from the caller or from plan 07's job context; `browserPool` and `closeAllBrowsers` stay as shims. Defaults (`block: "none"`, `stealth: false`) change no bookmaker's traffic; Task 8 turns policies on one bookmaker at a time behind a measured A/B.

**Tech Stack:** TypeScript (ESM, Node 20.19), Playwright 1.57 (`chromium_headless_shell-1200`, Chrome 143.0.7499.4), Chrome DevTools Protocol (`Network`, `SystemInfo`), Vitest 4.

**Spec:** README §1.5 (rows "Resource blocking + stealth never applied", "…the obvious fix is a trap", launch args, `closeAll()`), §2 principle 1, §3 (`ScrapeBudget`, `createScrapeBudget`, `BudgetExceededError`, `DEFAULT_MAX_DURATION_MS`, `getTransportOverride`), §4 row 08, §5.0 (F1, P8), §6, §8 Q7, Q12. Plan 07 Tasks 1–2 (`runCoordinator`, `currentScrapeJob()`, `maxDurationMsFor`, the abort hook). Evidence (`$E` = `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence`; untracked, always read by this absolute path):
- `$E/findings-notes.md`: CORE-1…CORE-4, CORE-14, and the per-bookmaker "safe-block" lines (lines 14, 26, 73, 76, 84).
- `$E/core/`: `cache-vs-route.mts`, `fingerprint.mts`, `ua-metadata.mts`, `features2.mts`, `target-architecture.ts` §3–4.
- `$E/profiling/`: `memmodel.json`, `metrics-blocked-*.json`, `metrics-control-nonet-*.json`, `whatif-runner.log`, `whatif2-runner.log`, `block-hosts-*.txt`; `$E/betcris-pzbuk/pzbuk-3p-summary.json`.

## Global Constraints

README §6 applies. Plan-specific constraints:
- **Workspace (recovery `EXECUTION.md`, README §6 revision).** `H=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees`. Your own worktree under `$H` (e.g. `$H/perf-08-browser`, branch `perf/08-browser`) created from `recovery/integration` once the preconditions below are merged there; `node_modules` symlinked to the main checkout's (Playwright's headless shell is already installed with it), `.env` copied from `$H/integration/.env` (dead-port Supabase; never change it). Never `npm install`/`npm ci`, never write in the main checkout, never start the server or the scheduler, never write to the DB. **`heavy`** below means `$H/bin/heavy`; `heavy --live` for every command that launches Chromium (the real-Chromium test files, live smokes). During TDD run only the scoped tests; `heavy npx vitest run` and `heavy npx tsc --noEmit` once at the end of each task (the full suite includes the real-Chromium files, so run it as `heavy --live npx vitest run`). Scratch output goes to `<worktree>/.scratch/`. Record the baseline first.
- **Preconditions (hard):**
  - plan 06 Task 1 merged — `tab-scraper.ts` deleted (the last `page.route` user, the last `navigateWithRetry` caller and the only code that touches `session.browser`/`session.context`);
  - plan 07 Task 1 merged — admin goes through `runCoordinator` and never calls `closeAllBrowsers()` under a running run;
  - plan 07 Task 2 merged — `currentScrapeJob()`, `src/scrapers/job-budgets.ts` (`maxDurationMsFor`), the abort → `context.close` hook in `executeWithBrowser` (rebase partner);
  - plan 01 Tasks 1–2 merged — exported `BROWSER_ARGS` without `--disable-features`, pool waiter fixes, `src/scrapers/base/__tests__/browser-pool.test.ts`;
  - plan 02 merged — `src/scrapers/shared/budget.ts`, `scraper-contract.ts` (`DEFAULT_MAX_DURATION_MS`).
- **Never block with `page.route` / `context.route`.** They disable the HTTP cache: STS traffic went from 10.7 MB to 101–143 MB under route blocking. Blocking happens only through CDP `Network.setBlockedURLs({ urlPatterns })`.
- **Never block stylesheets.** With stylesheets blocked, betcris and pzbuk return 0 matches. `BrowserBlockLevel` has no stylesheet level, and no pattern may contain `css`.
- **Defaults are inert.** `block: "none"` and `stealth: false` for every bookmaker. Only Task 8 commits turn on a policy, one bookmaker per commit. pzbuk stays `none` (Open Question 2; cross-plan #24).
- Launch with the headless shell: `headless: true`, no `channel` (`channel: "chromium"` measured +50 % PSS). Use plan 01's `BROWSER_ARGS`. Never pass `--disable-features`.
- Context options: viewport 1366×768, `serviceWorkers: "block"`, `locale: "pl-PL"`, `ignoreHTTPSErrors: true`, `bypassCSP: true`. The user agent stays today's `Chrome/120` string (`BROWSER_CONTEXT_USER_AGENT`, moved verbatim from `playwright-base.ts:25-26`) unless `stealth` is on.
- Limits and env:
  - `BROWSER_MAX_SESSIONS`, default 3 (= plan 07's browser job cap).
  - `BROWSER_IDLE_CLOSE_MS`, default 60 000.
  - Session lifetime `policy.browser.maxSessionMs`, default **`maxDurationMsFor(bookmaker, "browser")`** from plan 07 (`DEFAULT_MAX_DURATION_MS.browser` = 240 000; sts 360 000; betcris and pzbuk 600 000), further capped by the session's budget.
  - Policy overrides: `SCRAPER_BROWSER_BLOCK_<BM>` (`none` | `media` | `media+trackers`) and `SCRAPER_BROWSER_STEALTH_<BM>` (`1` | `true` | `0` | `false`).
- Scraper code never closes `session.browser`, because the browser is shared. It closes only through `cleanup()`.
- Seams that other plans' tests depend on must keep working:
  - `PlaywrightScraper.prototype.initBrowser()`: stubbed by `totalbet/__tests__/scraper.test.ts:55, :68`, `betcris/__tests__/scraper-flow.test.ts:33`, the betclic guard of plan 06 Task 1 and the betby guard of plan 07 Task 2; overridden by `TestScraper` in `navigation-diagnostics.test.ts:641-684` and plan 07's `playwright-base-abort.test.ts`. The new optional `budget` parameter keeps every override valid.
  - `closeAllBrowsers()` in `aggregator.ts:201-203` (used by `scraper-service.ts:156`, `scripts/smoke-bookmaker.ts:190`, `scripts/perf-smoke.ts`), and `browserPool.closeAll()`.
- Observability's `executeFullOfferScrape` (`playwright-base.ts:353-391`, `attachNavigationRecorder` / `enrichFullOfferFailure` inside the operation) is built. Task 5 only adds the trailing `budget?` parameter and forwards it; the recorder code is unchanged.
- This plan's hunks in `playwright-base.ts`: imports `:6-22`, constants `:24-37`, `initBrowser :88-170` (route block `:146-154`), `applyStealthScripts :172-190`, `navigateWithRetry :192-212`, `executeWithBrowser :335-351`, the `executeFullOfferScrape` signature `:353-357`.
- The real-Chromium tests use the locally installed Playwright headless shell and a local `node:http` server, with no internet. Each file computes `canLaunch` with top-level `await` and wraps its suites in `describe.skipIf(!canLaunch)`.
- Live checks: read-only smokes only (`perf-smoke.ts` forces a dead `SUPABASE_URL`), one bookmaker at a time under `heavy --live`, never HH:55–HH:10 (after plan 07 Task 4: ≥ 5 min from `nextScrapeAt`, never while `currentRun` is set), A and B arms back-to-back in the same hour. Anything that needs a scheduled run that persists is deferred to the owner.

## Review Focus

1. **The browser crashes while sessions are open and another caller is waiting for a permit.** The open sessions report `crashed() === true`, and their permits are freed at once, without waiting for `cleanup()`. The waiter gets a session on a freshly launched browser (generation 2). Pinned by Task 2: "disconnect frees permits and the waiter runs on generation 2" (fake), and the real-Chromium `Browser.crash` test; Task 5: "a retried crash carries the second attempt's diagnostics".
2. **A scraper operation never settles and is not tied to the page,** so `executeWithBrowser`'s `finally` never runs. When the lifetime expires, the runtime closes the context with reason `browser session exceeded <ms>ms` and frees the permit itself. Pinned by Task 2: "lifetime expiry closes the context and frees the permit without cleanup".
3. **`closeAll()` races an in-flight launch.** The browser that arrives late is closed as soon as the launch resolves, so no orphan Chromium is left. Pinned by Task 2: "closeAll during launch closes the late browser".
4. **A popup or second page in a session** gets the same blocking, counters and stealth. A new page does *not* inherit CDP settings (measured). Pinned by Task 4: "popup pages are prepared too" (fake) and "blocks in popups too" (real Chromium), and Task 6: "stealth sets the context UA, adds the init script once and overrides every page incl. popups".
5. **One-shot scripts** (`*-market-discovery.ts`, `*-prep-audit.ts`, `audit-probe.ts`) exit right after their scrape, not `BROWSER_IDLE_CLOSE_MS` later. An open browser keeps Node alive until it is closed (measured). Pinned by Task 5: "scrapeOneMatchFullOffer closes an idle browser after success and after a throw".
6. **A long browser run must not be cut by the runtime before plan 07's budget.** betcris's A1 run took 100.8 s and its breaker path can take ≈ 546 s; a 240 s session lifetime would close its context mid-loop and lose the league (betcris returns only at the end of its loop, `betcris/index.ts:271-362`). Pinned by Task 3 "sts sessions live 360 s, betcris and pzbuk 600 s" and Task 5 "initBrowser falls back to the job budget".

---

## Observations (pre-fix analysis)

### Today's browser layer (future base)

- **Dead code in `initBrowser()`** (`src/scrapers/base/playwright-base.ts:93-170`). The first loop returns at `:125`. Route blocking (`:146-154`) and `applyStealthScripts` (call `:156`, body `:175-190`) run only on the duplicated "last attempt" path (`:133-169`), which has no retry and no cleanup if `newContext` throws. So `disableResourceBlocking` (`src/types/scraper.ts:93`; set at `:171` superbet, `:253` betcris, `:263` pzbuk) and the stealth script do nothing for any scraper.
- **Context:** viewport 1920×1080 (`:105`, `:138`), UA `Chrome/120` (`:25-26`), no `serviceWorkers` option.
- **Pool** (`browser-pool.ts`, byte-identical to master): up to 14 browsers (`:170`), dropped waiters (`:127-131`), overriding args (`:9-18`). This plan assumes plan 01 Tasks 1–2 landed: `BROWSER_ARGS = ["--disable-blink-features=AutomationControlled", "--disable-site-isolation-trials"]` with a no-`--disable-features` test, `closeAll()` rejects waiters, `release()` closes a browser nobody waits for.
- **Who launches Chromium.** On the future base 10 default classes do, all through observability's `executeFullOfferScrape` → `executeWithBrowser` → `initBrowser`: sts `STSScraper`, `FortunaPlaywrightScraper`, `SuperbetPlaywrightScraper`, `LVBetPlaywrightScraper`, `FuksiarzPlaywrightScraper`, `BetfanPlaywrightScraper`, `ForbetPlaywrightScraper`, `EtotoPlaywrightScraper`, `BetcrisPlaywrightScraper`, `PzbukPlaywrightScraper` (`src/scrapers/bookmakers/index.ts`). betclic reaches it only through `tab-scraper.ts` until plan 06 Task 1. totalbet and betby (betters/lebull) still `extends PlaywrightScraper` but never call `initBrowser` (plan 07 classifies them `http`). sts stays here until 05a, pzbuk until 05c, betcris indefinitely (owner C), the others until plans 03/04 move them to HTTP and keep them as `<Brand>BrowserScraper` fallbacks behind `SCRAPER_TRANSPORT_<BM>=browser`.
- **Run times on the browser** (plan 07 Task 2): betcris 100.8 s (A1, 19 games) up to ≈ 546 s through its breaker; sts 97–170 s; pzbuk ≈ 17.4 s/event (pzbuk.md A8) ≈ 330 s per league. Plan 07 budgets them 600 s / 360 s / 600 s.
- **Memory model** (`$E/profiling/memmodel.json`): 14 browsers × 1 context = 1 038 MB PSS / 84 processes (blank) vs 1 browser × 14 contexts = 401 MB / 19; on real homepages 5 227 vs 4 460 MB (page content dominates). Launch 50 ms, context + page 34 ms. Viewport 1280×800 −7 %; 572 "Creating new browser" lines in one session log (CORE-3).
- **`navigateWithRetry`** (`:195-212`): `networkidle` default, discards the `Response`, fixed 2^n s backoff, no budget. Its only caller left is `betclic/tab-scraper.ts:285`; betby deleted `betters/navigation.ts` and `lebull/navigation.ts`. After plan 06 Task 1 it is dead code.
- No scraper depends on viewport size beyond clicks in `sts/navigation.ts:71` and `pzbuk/navigation.ts:53-114`. No scraper touches `session.browser`/`session.context` except `tab-scraper.ts`.

### Blocking: measured facts

- **Route blocking costs the HTTP cache** (`$E/core/cache-vs-route.mts`, CORE-1): `context.route` refetched `app.js` 5× in 5 navigations vs 1× with CDP blocking. STS under route blocking: 10.7 → 100.9 / 142.7 MB; image/font/media only: identical 5 589 markets but 135.8 s vs 93–97 s; CSS + 72 hosts: 5 152 vs 5 589 markets (−7.8 %) (`metrics-blocked-sts*.json`, `metrics-control-nonet-sts.json`).
- **Stylesheet blocking kills betcris** ("No WebSocket data captured", 0 matches, `metrics-blocked-betcris.json`) **and pzbuk** (findings line 76). betcris route-based: its 36 hosts only → identical 19 matches / 9 331 markets; image/font/media → 18 / 8 981.
- fortuna route-blocked: 13.8 → 1.9 MB, PSS 680 → 356 MB, Chromium CPU 23.3 → 5.9 s, markets 12 345 → 12 346. betfan: DCL 1.3 → 0.7 s, 4.9 → 1.9 MB, renderer CPU 5.3 → 2.1 s, identical results. pzbuk with aborted images retried one icon 160× (1 111 aborts).
- **CDP `Network.setBlockedURLs` semantics** (measured 2026-11-07 on headless shell 143; Tasks 2–6 re-prove each point in real-Chromium tests):
  - The legacy `urls` form matches *substrings*: `*.png` blocks `/api/c.png.json` and `?logo=e.png`; a host pattern blocks a first-party URL that mentions the host in its query; `*.webp` would block `runtime.webpack.js`. Unusable.
  - `urlPatterns: [{ urlPattern, block: true }]` (URLPattern syntax) works: `*://*/*.webp` blocks `a.webp` and `b.webp?x=1` but not `runtime.webpack.js`; `*://h/*` + `*://*.h/*` block the host and its subdomains but not `noth.test` or a query mention; 5 navigations still fetch `app.js` and `style.css` once (cache kept). Matching is case-sensitive (`G.PNG` passes).
  - A page created later in the same context does **not** inherit `setBlockedURLs`; every page needs its own setup.
  - `SystemInfo.getProcessInfo` on a browser CDP session returns `cpuTime` per Chromium process in the headless shell.
- **Hosts verified safe to block** per bookmaker: findings lines 14, 26, 73, 84; `$E/profiling/block-hosts-{betcris,fortuna}.txt`; `$E/betcris-pzbuk/pzbuk-3p-summary.json` (`blocked`). Compiled in Task 3.

### Bot signals and lifecycle: measured facts

- Default context today (`$E/core/fingerprint.mts`, re-measured): `sec-ch-ua: "HeadlessChrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"` on document and XHR while the UA claims `Chrome/120`; `navigator.platform` `"Linux x86_64"` against a Windows UA; `plugins.length` 0, `mimeTypes` 0, `pdfViewerEnabled` false, `window.chrome` undefined, `languages` `["pl-PL"]`; `webdriver` already false (`--disable-blink-features=AutomationControlled`).
- `Network.setUserAgentOverride` + `userAgentMetadata` (brands from `browser.version()`) + context UA `Chrome/143.0.0.0` turns `sec-ch-ua` on document and XHR into `"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"`, with matching `userAgentData.brands` and `platform: "Win32"` (`$E/core/ua-metadata.mts`, re-measured). `userAgentData` is not exposed on `about:blank` (not a secure context), so Task 6 derives brands from Chromium's GREASE rule and checks them against the browser's own in a real-Chromium test.
- `context.close({ reason })` rejects pending page work with that reason (`page.evaluate: browser session exceeded 1000ms`). `Browser.crash` on `browser.newBrowserCDPSession()` fires `disconnected`; pending work rejects with `Target page, context or browser has been closed`; `context.close()` on the dead context resolves.
- A launched browser keeps the Node process alive until it is closed (with or without an `unref()`'d idle timer), so one-shot scripts need an explicit close.

---

## File Structure

Line numbers are on the future base. Re-pin them after plans 01, 06 Task 1 and 07 Tasks 1–2 merge (07 Task 2 adds its hook inside `executeWithBrowser`).

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/base/semaphore.ts` (new) | FIFO permits; abortable waiters; `rejectAll` | 1 |
| `src/scrapers/base/browser-runtime.ts` (new) | `BrowserRuntime`, `browserRuntime` singleton, `BrowserSession`, `BROWSER_ARGS` (moved from plan 01's pool), `BROWSER_CONTEXT_USER_AGENT` (moved from `playwright-base.ts:25-26`), session lifecycle, stats | 2, 4, 6 |
| `src/scrapers/base/__tests__/helpers/fake-playwright.ts` (new, test-only) | fake launcher, browser, context, page and CDP sessions | 2 |
| `src/types/scraper.ts` | `BrowserBlockLevel`, `BrowserPolicy`, `ScraperConfig.policy`; remove `disableResourceBlocking` (`:93`, `:171`, `:253`, `:263`) | 3 |
| `src/scrapers/base/browser-blocklist.ts` (new) | extension lists, `TRACKER_HOSTS`, `NEVER_BLOCK_HOSTS` (single source) | 3 |
| `src/scrapers/base/browser-policy.ts` (new) | `DEFAULT_BROWSER_POLICY`, `resolveBrowserPolicy` (lifetime from plan 07's `maxDurationMsFor`), `blockedUrlPatterns` | 3 |
| `src/scrapers/base/browser-page-setup.ts` (new) | per-page CDP: `Network.enable`, counters, `setBlockedURLs`, UA override | 4, 6 |
| `src/scrapers/base/browser-stealth.ts` (new) | `clientHintBrands`, `stealthUserAgent`, `userAgentOverride`, `STEALTH_INIT_SCRIPT` | 6 |
| `src/scrapers/base/playwright-base.ts` | `initBrowser(budget?)` → runtime; crash retry and `budget?` in `executeWithBrowser` / `executeFullOfferScrape`; delete the dead route/stealth code and `navigateWithRetry` | 3, 5, 7 |
| `src/scrapers/base/browser-pool.ts` | `BROWSER_ARGS` re-export (2); shim over `browserRuntime` (5) | 2, 5 |
| `src/scrapers/base/__tests__/browser-pool.test.ts` (plan 01) | **deleted**; still-meaningful cases ported | 5 |
| `src/scrapers/aggregator.ts:12`, `:201-203` | `closeAllBrowsers` → `browserRuntime.closeAll()` | 5 |
| `src/services/audit/scraper-audit-core.ts:119`/`:126`, `scripts/audit-probe.ts:31-58` | close the idle browser after one-shot scrapes | 5 |
| `.env.example` | `BROWSER_MAX_SESSIONS`, `BROWSER_IDLE_CLOSE_MS` (2); `SCRAPER_BROWSER_BLOCK_<BM>`, `SCRAPER_BROWSER_STEALTH_<BM>` (3) | 2, 3 |
| tests: `src/scrapers/base/__tests__/{semaphore,browser-runtime,browser-runtime.chromium,browser-policy,browser-stealth,playwright-base}.test.ts`, `src/scrapers/base/__tests__/navigation-diagnostics.test.ts` (extended), `src/services/audit/__tests__/scraper-audit-core-close.test.ts` | | 1–7 |

---

### Task 1: `Semaphore` whose waiters always settle

**Files:**
- Create: `src/scrapers/base/semaphore.ts`
- Test: `src/scrapers/base/__tests__/semaphore.test.ts`
- Plan 07 does **not** ship a semaphore: it caps *jobs* with two `mapLimit` pools (browser jobs ≤ 3, staggered 1.5 s; other jobs ≤ 12). This task's semaphore caps browser *sessions* inside the runtime (audit tooling and smokes open sessions outside plan 07's jobs), a different level, so it is required.

**Interfaces:**
- Produces:
  ```ts
  export class Semaphore {
    constructor(max: number);
    acquire(signal?: AbortSignal): Promise<() => void>; // the release fn is idempotent
    rejectAll(reason: unknown): void;                    // rejects queued waiters only; held permits stay held
    get active(): number;
    get waiting(): number;
  }
  ```

- [ ] **Step 1: Write the failing test**
  ```ts
  it("grants up to max at once and queues the rest", async () => {
    const s = new Semaphore(2); await s.acquire(); await s.acquire();
    const third = s.acquire(); expect([s.active, s.waiting]).toEqual([2, 1]);
  });
  it("release hands the permit to the oldest waiter (FIFO)", async () => { /* waiters A then B; release → A resolves first */ });
  it("release is idempotent", async () => { const s = new Semaphore(1); const r = await s.acquire(); r(); r(); expect(s.active).toBe(0); });
  it("an aborted waiter rejects with signal.reason and leaves the queue", async () => {
    const s = new Semaphore(1); await s.acquire(); const ac = new AbortController();
    const p = s.acquire(ac.signal); ac.abort(new Error("deadline")); await expect(p).rejects.toThrow("deadline");
    expect([s.active, s.waiting]).toEqual([1, 0]);
  });
  it("an already-aborted signal rejects without queueing", ...);
  it("rejectAll rejects every waiter; active permits stay held", async () => { /* 1 held + 2 waiting → both reject "shutdown"; active 1, waiting 0 */ });
  ```
- [ ] **Step 2: Run it and confirm it fails.** `heavy npx vitest run src/scrapers/base/__tests__/semaphore.test.ts`. Expected: FAIL, `Cannot find module '../semaphore.js'`.
- [ ] **Step 3: Implement `Semaphore`.** Use a FIFO queue of `{ resolve, reject }`. `acquire` removes its abort listener when it settles. A `release` hands its permit straight to the next waiter, so `active` stays the same.
- [ ] **Step 4: Run it and confirm it passes.** The same command (6 passed), then `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/base/semaphore.ts src/scrapers/base/__tests__/semaphore.test.ts
  git commit -m "feat(browser): semaphore with abortable waiters that always settle"
  ```

---

### Task 2: `BrowserRuntime` core (one browser, context per session, lifecycle)

**Files:**
- Create: `src/scrapers/base/browser-runtime.ts`, `src/scrapers/base/__tests__/helpers/fake-playwright.ts`
- Modify: `.env.example`. Under "# Scraper Configuration" (`:15-19`) add `# BROWSER_MAX_SESSIONS=3        # concurrent browser contexts in the one shared Chromium` and `# BROWSER_IDLE_CLOSE_MS=60000   # close the idle browser after this long`.
- Modify: `src/scrapers/base/browser-pool.ts`. Move plan 01's `BROWSER_ARGS` definition into `browser-runtime.ts`; the pool imports it from there and re-exports it (`export { BROWSER_ARGS } from "./browser-runtime.js"`), so plan 01's test import keeps working until Task 5.
- Test: `src/scrapers/base/__tests__/browser-runtime.test.ts`, `src/scrapers/base/__tests__/browser-runtime.chromium.test.ts`

**Interfaces:**
- Consumes: `Semaphore` (Task 1). `BROWSER_ARGS` (plan 01; moved here). `PolishBookmaker` (`src/config/index.ts:24`).
- Produces:
  ```ts
  export const BROWSER_CONTEXT_USER_AGENT: string; // moved verbatim from playwright-base.ts:25-26 (Chrome/120); distinct from plan 02's DEFAULT_USER_AGENT (Chrome/143, HTTP client)
  export const SESSION_VIEWPORT: { width: 1366; height: 768 };
  export interface BrowserLauncher { launch(options: LaunchOptions): Promise<Browser> }
  export interface BrowserRuntimeOptions {
    maxSessions?: number;          // default Number(process.env.BROWSER_MAX_SESSIONS) || 3
    idleCloseMs?: number;          // default Number(process.env.BROWSER_IDLE_CLOSE_MS) || 60_000
    launchOptions?: LaunchOptions; // default { headless: true, args: [...BROWSER_ARGS] }
    launcher?: BrowserLauncher;    // default playwright `chromium` (test seam)
  }
  export interface OpenSessionOptions {
    bookmaker: PolishBookmaker;
    signal?: AbortSignal;  // aborts the permit wait; after the grant it closes the context
    maxSessionMs: number;  // lifetime counted from the permit grant
    // Task 4 adds: policy?: ResolvedBrowserPolicy
  }
  export interface SessionRuntimeInfo { crashed(): boolean; remainingMs(): number; readonly lifetimeMs: number }
  export interface BrowserSession {   // moved from playwright-base.ts:32-37; `runtime` is new and optional
    page: Page; browser: Browser; context: BrowserContext; cleanup: () => Promise<void>;
    runtime?: SessionRuntimeInfo;
  }
  export class BrowserRuntime {
    constructor(options?: BrowserRuntimeOptions);
    openSession(options: OpenSessionOptions): Promise<BrowserSession>;
    closeIfIdle(): Promise<void>; // closes the browser now if no session is open, otherwise no-op
    closeAll(): Promise<void>;    // rejects waiters, closes every context, then the browser; usable again afterwards
    get activeSessions(): number;
    get waitingSessions(): number;
  }
  export const browserRuntime: BrowserRuntime;
  ```
- Session rules: the context gets `{ userAgent: BROWSER_CONTEXT_USER_AGENT, locale: "pl-PL", viewport: SESSION_VIEWPORT, serviceWorkers: "block", javaScriptEnabled: true, ignoreHTTPSErrors: true, bypassCSP: true }`. A session **ends** on the first of `signal` abort, lifetime expiry or browser disconnect; ending closes the context with reason `browser session exceeded ${maxSessionMs}ms` or `String(signal.reason)`, frees the permit and deregisters the session. `cleanup()` is idempotent and performs whichever of those steps have not run. `runtime.remainingMs()` is `max(0, grantedAt + maxSessionMs − now)` and 0 after a signal abort; a crash does not change it (Task 5's retry rule reads it).
- Log lines: `[BrowserRuntime] launched Chromium ${version} (generation ${n})`; `[BrowserRuntime] ${bm} waiting for a browser session (${active}/${max} in use)` (once per waiter); `[BrowserRuntime] browser disconnected (generation ${n}, ${k} open sessions failed)`.
- Test helper surface: `createFakeLauncher({ failWith?: Error; deferred?: boolean })` → `{ launcher, browsers: FakeBrowser[], launchCalls: LaunchOptions[], finishLaunch(): void }`. `FakeBrowser`: `contexts`, `closed`, `crash()` (emits `disconnected`), `version()` = `"143.0.7499.4"`, `processInfo`, `newBrowserCDPSession()`. `FakeContext`: `options`, `pages`, `closed`, `closeReason`, `initScripts`, `routeCalls`, `cdpOf(page)`, `openPopup()`. `FakeCdp`: `sent: {method, params}[]`, `emit(event, payload)`, `failOn: Set<string>`.

- [ ] **Step 1: Write the failing tests** (fake launcher; fake timers where noted)
  ```ts
  beforeEach(() => { fake = createFakeLauncher(); rt = new BrowserRuntime({ maxSessions: 3, idleCloseMs: 60_000, launcher: fake.launcher }); });
  it("launches once for concurrent sessions (single-flight) with the headless shell and BROWSER_ARGS", async () => {
    await Promise.all([1, 2, 3].map(() => rt.openSession({ bookmaker: "sts", maxSessionMs: 10_000 })));
    expect(fake.launchCalls).toEqual([{ headless: true, args: [...BROWSER_ARGS] }]);
    expect(fake.browsers[0].contexts).toHaveLength(3);
  });
  it("launch args never carry --disable-features (ported from plan 01's browser-pool.test.ts)", () =>
    expect(BROWSER_ARGS.filter((a) => a.startsWith("--disable-features"))).toEqual([]));
  it("creates one context per session with the lean defaults", async () => {
    expect(fake.browsers[0].contexts[0].options).toEqual({ userAgent: BROWSER_CONTEXT_USER_AGENT, locale: "pl-PL",
      viewport: { width: 1366, height: 768 }, serviceWorkers: "block", javaScriptEnabled: true, ignoreHTTPSErrors: true, bypassCSP: true });
  });
  it("caps sessions at maxSessions and hands the permit to the next waiter on cleanup", ...);          // max 2, 3rd waits, cleanup(1st) → 3rd resolves
  it("a waiter whose signal aborts rejects with the reason and consumes no permit", ...);
  it("closeAll rejects waiters, closes every context and the browser; the next session relaunches", async () => {
    /* 1 open + 1 waiting → waiter rejects "BrowserRuntime closeAll"; contexts[0].closed; browsers[0].closed; next openSession → launchCalls.length 2 */
  });
  it("closes the idle browser after idleCloseMs; a session opened earlier cancels the timer", ...);    // advance 59_999 → open; 1 more ms → closed
  it("closeIfIdle closes at once with no sessions and is a no-op while one is open", ...);
  it("disconnect frees permits and the waiter runs on generation 2", async () => {
    /* max 2: s1, s2 open, s3 waiting; browsers[0].crash() → s1.runtime.crashed() && s2.runtime.crashed(); s1.runtime.remainingMs() > 0;
       s3 resolves without any cleanup call; s3.browser === browsers[1]; launchCalls.length 2 */
  });
  it("a launch failure rejects every single-flight caller, frees their permits, and the next call launches again", ...);
  it("closeAll during launch closes the late browser", async () => { /* deferred launch; closeAll(); finishLaunch(); browsers[0].closed === true; open session rejects */ });
  it("lifetime expiry closes the context and frees the permit without cleanup", async () => {
    vi.useFakeTimers(); const s = await rt.openSession({ bookmaker: "pzbuk", maxSessionMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.browsers[0].contexts[0].closeReason).toBe("browser session exceeded 1000ms");
    expect(s.runtime!.remainingMs()).toBe(0); expect(rt.activeSessions).toBe(0);
  });
  it("signal abort after the grant closes the context with the reason; cleanup twice releases once", ...);
  it("openSession during closeAll rejects with 'BrowserRuntime is closing'", ...);
  ```
  Real Chromium (`browser-runtime.chromium.test.ts`; `const canLaunch = await chromium.launch({ headless: true }).then(async (b) => { await b.close(); return true; }, () => false);`; each test `{ timeout: 30_000 }`; `afterEach(() => rt.closeAll())`):
  ```ts
  it("serves concurrent sessions from one browser with separate contexts and a 1366x768 viewport", async () => {
    const [a, b] = await Promise.all([rt.openSession({ bookmaker: "sts", maxSessionMs: 30_000 }), rt.openSession({ bookmaker: "fortuna", maxSessionMs: 30_000 })]);
    expect(a.browser).toBe(b.browser); expect(a.context).not.toBe(b.context);
    expect(await a.page.evaluate(() => [innerWidth, innerHeight])).toEqual([1366, 768]);
  });
  it("lifetime expiry rejects pending page work with the reason", async () => {
    const s = await rt.openSession({ bookmaker: "sts", maxSessionMs: 300 });
    await expect(s.page.evaluate(() => new Promise(() => {}))).rejects.toThrow("browser session exceeded 300ms");
  });
  it("Browser.crash marks open sessions crashed and the next session runs on a new browser", async () => {
    const s1 = await rt.openSession(...); await (await s1.browser.newBrowserCDPSession()).send("Browser.crash").catch(() => {});
    await expect.poll(() => s1.runtime!.crashed()).toBe(true);
    const s2 = await rt.openSession(...); expect(s2.browser).not.toBe(s1.browser); expect(s2.browser.isConnected()).toBe(true);
  });
  ```
- [ ] **Step 2: Run them and confirm they fail.** `heavy --live npx vitest run src/scrapers/base/__tests__/browser-runtime.test.ts src/scrapers/base/__tests__/browser-runtime.chromium.test.ts`. Expected: FAIL, the module is not found.
- [ ] **Step 3: Implement `BrowserRuntime`.** Browser held as `Promise<Browser> | null` plus a generation counter; on `disconnected` of generation *g*, null the promise only if *g* is current and end every session of *g* with `crashed = true` (relaunch is lazy, on the next `openSession`). The idle timer starts when the session count reaches 0 and is `unref()`'d. `closeAll` awaits a pending launch and closes its result, swallowing a launch error.
- [ ] **Step 4: Run them and confirm they pass.** The same command (14 fake + 3 real-Chromium tests), then `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/base/browser-runtime.ts src/scrapers/base/browser-pool.ts src/scrapers/base/__tests__/helpers/fake-playwright.ts src/scrapers/base/__tests__/browser-runtime.test.ts src/scrapers/base/__tests__/browser-runtime.chromium.test.ts .env.example
  git commit -m "feat(browser): shared browser runtime with per-session contexts, caps, idle close and crash recovery"
  ```

---

### Task 3: Browser policy, blocklist constants and URL patterns

**Files:**
- Create: `src/scrapers/base/browser-blocklist.ts`, `src/scrapers/base/browser-policy.ts`
- Modify:
  - `src/types/scraper.ts:85-94`: remove `disableResourceBlocking` (`:93`) and add `policy?`.
  - `src/types/scraper.ts:171` (superbet), `:253` (betcris), `:263` (pzbuk): delete the three `disableResourceBlocking: true` lines. If plan 04 already removed superbet's line, skip that delete. No bookmaker gets a `policy` entry here: defaults are inert and lifetimes come from plan 07's budgets.
  - If another plan already added `ScraperConfig.policy`, add `browser` to it.
  - `src/scrapers/base/playwright-base.ts:28-29` and `:146-154`: delete `BLOCKED_RESOURCE_TYPES` and the dead route block, the last readers of the removed field. Behaviour is unchanged, because the block never ran.
  - `.env.example` under "# Scraper Configuration": `# SCRAPER_BROWSER_BLOCK_<BM>=none     # none | media | media+trackers (never stylesheets); e.g. SCRAPER_BROWSER_BLOCK_FORTUNA` and `# SCRAPER_BROWSER_STEALTH_<BM>=0     # 1/true: client-hint-consistent UA + JS shims for that bookmaker's browser sessions`.
  - Only if a test asserts betcris's `disableResourceBlocking` (05b's stylesheet guard, if its revision kept one: `git grep -n disableResourceBlocking -- 'src/**/__tests__/*.ts'`): rewrite it to `expect(blockedUrlPatterns(resolveBrowserPolicy("betcris", DEFAULT_SCRAPER_CONFIGS.betcris, {}).block).filter((p) => /css/i.test(p))).toEqual([])` (cross-plan #5).
- Precondition: `test ! -e src/scrapers/bookmakers/betclic/tab-scraper.ts` (plan 06 Task 1 deleted it; it sets `disableResourceBlocking: false` at `:107` and route-blocks at `:203`). If the file exists, stop and land plan 06 Task 1 first.
- Test: `src/scrapers/base/__tests__/browser-policy.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_MAX_DURATION_MS` (§3, `src/scrapers/shared/scraper-contract.ts`); `maxDurationMsFor` (plan 07 Task 2, `src/scrapers/job-budgets.ts`, a leaf module, so `playwright-base.ts` → `browser-policy.ts` → `job-budgets.ts` has no cycle); `DEFAULT_SCRAPER_CONFIGS` (`src/types/scraper.ts:135`).
- Produces:
  ```ts
  // src/types/scraper.ts
  export type BrowserBlockLevel = "none" | "media" | "media+trackers";
  export interface BrowserPolicy { block: BrowserBlockLevel; stealth: boolean; maxSessionMs?: number }
  // ScraperConfig gains: policy?: { browser?: BrowserPolicy }
  // src/scrapers/base/browser-blocklist.ts
  export const BLOCKED_EXTENSIONS: { image: readonly string[]; font: readonly string[]; media: readonly string[] };
  export const TRACKER_HOSTS: readonly string[];
  export const NEVER_BLOCK_HOSTS: readonly string[];
  // src/scrapers/base/browser-policy.ts
  export type ResolvedBrowserPolicy = Required<BrowserPolicy>;
  export const DEFAULT_BROWSER_POLICY: ResolvedBrowserPolicy; // { block: "none", stealth: false, maxSessionMs: DEFAULT_MAX_DURATION_MS.browser }
  export function resolveBrowserPolicy(bookmaker: PolishBookmaker, config: Pick<ScraperConfig, "policy">, env?: NodeJS.ProcessEnv): ResolvedBrowserPolicy;
  export function blockedUrlPatterns(block: BrowserBlockLevel): string[]; // URLPattern strings
  ```
- Data (the whole content of `browser-blocklist.ts`; each list carries a comment naming its `findings-notes.md` source line):
  - `BLOCKED_EXTENSIONS`: image `png jpg jpeg gif webp avif svg ico`; font `woff woff2 ttf otf eot`; media `mp4 webm mp3 m3u8 ogg`.
  - `TRACKER_HOSTS` (46 hosts; each matches the host and its subdomains), compiled from the "safe-block" lists:
    - analytics and tags: `googletagmanager.com google-analytics.com analytics.google.com doubleclick.net googlesyndication.com cloudflareinsights.com clarity.ms plausible.io exponea.com emarsys.net tagcommander.com sentry.io sentry-cdn.com growthbook.io smart.idmnet.pl pollster.pl capi-automation.s3.us-east-2.amazonaws.com server-side-tagging-kp74km7qlq-uc.a.run.app`
    - ads and social: `connect.facebook.net facebook.com adform.net snapchat.com sc-static.net bat.bing.com bat.bing.net c.bing.com prdredir.com iconvert.network pushpushgo.com`
    - consent: `cookiebot.com usercentrics.eu onetrust.com cookie-script.com trustcommander.net`
    - chat and widgets: `livechatinc.com zdassets.com zendesk.com ladesk.com ada.support userway.org statscore.com widgets.sir.sportradar.com static.app.delivery seal.certcga.com`
    - push: `firebaseinstallations.googleapis.com fcmregistrations.googleapis.com`
  - Deliberately **excluded** (listed with reasons in the file comment): `fonts.googleapis.com` (serves stylesheets); `www.recaptcha.net`, `www.google.com`, `www.gstatic.com` (captcha); `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`, `code.jquery.com` (carry app code); `*.cloudfront.net` (opaque CDNs); `openfpcdn.io`, `fpjs.dev` (blocking fingerprinting may raise bot scores); `js.pusher.com`, `*.firebasedatabase.app` (may carry live data); bookmaker infrastructure (`begmedia.com`, `efortuna.pl`, `feg.eu`); the STS ad-sync hosts of `block-hosts-sts.txt` (unverified: that run also blocked CSS and lost 7.8 % of markets).
  - `NEVER_BLOCK_HOSTS`: `betcris.pl betsport.pl trexname.com springbuilder.site bcapps.net d3j4vz29nirhst.cloudfront.net begmedia.com efortuna.pl feg.eu`.
- `blockedUrlPatterns`: `"none"` → `[]`; `"media"` → `*://*/*.<ext>` for image, then font, then media extensions (18); `"media+trackers"` → the media patterns, then `*://<h>/*` and `*://*.<h>/*` per tracker host in list order (110).
- `resolveBrowserPolicy` precedence: env override > `config.policy.browser` > default; missing fields come from the default, except `maxSessionMs`, whose default is **`maxDurationMsFor(bookmaker, "browser")`** (plan 07: sts 360 000, betcris and pzbuk 600 000, others 240 000), so a session never ends before the job budget plan 07 gives that bookmaker. An invalid env value is ignored with one `console.warn`: `[browser-policy] ignoring SCRAPER_BROWSER_BLOCK_STS="stylesheet" (expected none|media|media+trackers)`.

- [ ] **Step 1: Write the failing test**
  ```ts
  it("defaults to none/false/240000", () =>
    expect(resolveBrowserPolicy("fortuna", {}, {})).toEqual({ block: "none", stealth: false, maxSessionMs: 240_000 }));
  it("sts sessions live 360 s, betcris and pzbuk 600 s (plan 07 budgets; Review Focus 6)", () =>
    expect(["sts", "betcris", "pzbuk"].map((bm) => resolveBrowserPolicy(bm as PolishBookmaker, DEFAULT_SCRAPER_CONFIGS[bm as PolishBookmaker], {}).maxSessionMs))
      .toEqual([360_000, 600_000, 600_000]));
  it("config wins over the default; missing fields come from the default", () =>
    expect(resolveBrowserPolicy("fortuna", { policy: { browser: { block: "media", stealth: false } } }, {})).toEqual({ block: "media", stealth: false, maxSessionMs: 240_000 }));
  it("env wins over config", () =>
    expect(resolveBrowserPolicy("sts", { policy: { browser: { block: "media", stealth: false } } },
      { SCRAPER_BROWSER_BLOCK_STS: "media+trackers", SCRAPER_BROWSER_STEALTH_STS: "1" })).toMatchObject({ block: "media+trackers", stealth: true }));
  it("ignores an invalid env value with one warning", () => { /* SCRAPER_BROWSER_BLOCK_STS=stylesheet → block "none"; warn text as above */ });
  it("no config carries disableResourceBlocking any more", () =>
    expect(Object.values(DEFAULT_SCRAPER_CONFIGS).some((c) => "disableResourceBlocking" in c)).toBe(false));
  it("none blocks nothing", () => expect(blockedUrlPatterns("none")).toEqual([]));
  it("media blocks 18 extensions by pathname", () => {
    const p = blockedUrlPatterns("media");
    expect(p).toHaveLength(18); expect(p.slice(0, 2)).toEqual(["*://*/*.png", "*://*/*.jpg"]); expect(p).toContain("*://*/*.woff2");
  });
  it("media+trackers adds host and subdomain patterns per tracker host", () => {
    const p = blockedUrlPatterns("media+trackers");
    expect(p).toHaveLength(110); expect(p).toContain("*://googletagmanager.com/*"); expect(p).toContain("*://*.googletagmanager.com/*");
  });
  it("never blocks stylesheets, even for betcris and pzbuk at the strongest env level (cross-plan #5)", () => {
    expect(blockedUrlPatterns("media+trackers").filter((x) => /css/i.test(x))).toEqual([]);
    for (const bm of ["betcris", "pzbuk"] as const) {
      const env = { [`SCRAPER_BROWSER_BLOCK_${bm.toUpperCase()}`]: "media+trackers" };
      expect(blockedUrlPatterns(resolveBrowserPolicy(bm, DEFAULT_SCRAPER_CONFIGS[bm], env).block).filter((x) => /css/i.test(x))).toEqual([]);
    }
  });
  it("tracker hosts are unique and disjoint from never-block and bookmaker hosts", () => {
    const own = [...NEVER_BLOCK_HOSTS, ...Object.values(DEFAULT_SCRAPER_CONFIGS).map((c) => new URL(c.baseUrl).hostname)];
    const covers = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
    expect(new Set(TRACKER_HOSTS).size).toBe(TRACKER_HOSTS.length);
    expect(TRACKER_HOSTS.flatMap((t) => own.filter((o) => covers(t, o)))).toEqual([]);
  });
  ```
- [ ] **Step 2: Run it and confirm it fails.** `heavy npx vitest run src/scrapers/base/__tests__/browser-policy.test.ts`. Expected: FAIL, the module is not found.
- [ ] **Step 3: Implement** the types, the two modules and the config edits as specified above.
- [ ] **Step 4: Run it and confirm it passes.**
  - The same command (12 passed), then `heavy npx tsc --noEmit` (exit 0).
  - Expected: `git grep -n "disableResourceBlocking\|BLOCKED_RESOURCE_TYPES" -- src scripts ':(exclude)*__tests__*'` prints nothing (the tests name the field on purpose).
- [ ] **Step 5: Commit**
  ```bash
  git add src/types/scraper.ts src/scrapers/base/playwright-base.ts src/scrapers/base/browser-blocklist.ts src/scrapers/base/browser-policy.ts src/scrapers/base/__tests__/browser-policy.test.ts .env.example
  git commit -m "feat(browser): per-scraper browser policy with a CDP-safe blocklist and budget-sized session lifetimes"
  ```

---

### Task 4: Per-page CDP setup, CDP blocking and runtime stats

**Files:**
- Create: `src/scrapers/base/browser-page-setup.ts`
- Modify: `src/scrapers/base/browser-runtime.ts` (Task 2)
- Test: `src/scrapers/base/__tests__/browser-runtime.test.ts` (new `describe("page setup and stats")`), `src/scrapers/base/__tests__/browser-runtime.chromium.test.ts` (new `describe("blocking")`)

**Interfaces:**
- Consumes: `ResolvedBrowserPolicy`, `DEFAULT_BROWSER_POLICY`, `blockedUrlPatterns` (Task 3).
- Produces:
  ```ts
  // browser-page-setup.ts
  export interface PageSetup {
    label: string;                                  // bookmaker, for log lines
    blockPatterns: readonly string[];               // URLPattern strings; empty → no setBlockedURLs call
    userAgentOverride?: UserAgentOverrideParams;    // Task 6
    onNetwork(e: { bytes: number; failed: boolean; blocked: boolean }): void;
  }
  export function preparePage(context: BrowserContext, page: Page, setup: PageSetup): Promise<void>; // never throws
  // browser-runtime.ts
  // OpenSessionOptions gains: policy?: ResolvedBrowserPolicy (default DEFAULT_BROWSER_POLICY)
  export interface BrowserRuntimeStats { launches: number; sessions: number; crashes: number; requests: number; encodedBytes: number; blockedRequests: number; chromiumCpuMs: number }
  // BrowserRuntime gains: stats(): BrowserRuntimeStats
  ```
- `preparePage` order: `context.newCDPSession(page)` → subscribe `Network.loadingFinished` (`{ bytes: encodedDataLength, failed: false, blocked: false }`) and `Network.loadingFailed` (`{ bytes: 0, failed: true, blocked: !!blockedReason }`) → `Network.enable` → if patterns: `Network.setBlockedURLs({ urlPatterns: blockPatterns.map((urlPattern) => ({ urlPattern, block: true })) })`. A failed `send` is logged once per session as `[BrowserRuntime] ${label} page setup degraded: ${method} ${message}`; a failed `setBlockedURLs` leaves the session unblocked and never falls back to the substring `urls` form.
- Runtime wiring: the first page is prepared (awaited) before `openSession` resolves; later pages via `context.on("page")`, best effort, once per page (`WeakSet`).
- CPU: one `browser.newBrowserCDPSession()` per launch; sample `SystemInfo.getProcessInfo` at each session end (before `context.close`) and before every browser close; keep the max `cpuTime` per pid; `chromiumCpuMs = Math.round(Σ max × 1000)`.
- Closed line, logged on every browser close (`idle` | `closeAll` | `closeIfIdle` | `disconnected`); the counters reset after it:
  ```
  [BrowserRuntime] closed (${reason}): launches=${n} sessions=${n} crashes=${n} requests=${n} bytes=${n} blocked=${n} chromiumCpuMs=${n}
  ```
  Task 8 parses this line from the perf smoke's output.

- [ ] **Step 1: Write the failing tests**

  Fake:
  ```ts
  it("prepares the first page before openSession resolves", async () => {
    const s = await rt.openSession({ bookmaker: "fortuna", maxSessionMs: 10_000, policy: { ...DEFAULT_BROWSER_POLICY, block: "media" } });
    const cdp = fake.browsers[0].contexts[0].cdpOf(s.page);
    expect(cdp.sent.map((x) => x.method)).toEqual(["Network.enable", "Network.setBlockedURLs"]);
    expect(cdp.sent[1].params).toEqual({ urlPatterns: blockedUrlPatterns("media").map((urlPattern) => ({ urlPattern, block: true })) });
  });
  it("policy none sends no setBlockedURLs and never routes", async () => { /* sent == ["Network.enable"]; context.routeCalls === 0 */ });
  it("popup pages are prepared too", async () => { /* const p = await ctx.openPopup(); await vi.waitFor(() => expect(ctx.cdpOf(p).sent.map(x => x.method)).toContain("Network.setBlockedURLs")) */ });
  it("a failing setBlockedURLs degrades with one warning and the session still opens", ...);
  it("counts requests, bytes and blocked requests", async () => {
    cdp.emit("Network.loadingFinished", { encodedDataLength: 1000 }); cdp.emit("Network.loadingFinished", { encodedDataLength: 1000 });
    cdp.emit("Network.loadingFailed", { blockedReason: "inspector" });
    expect(rt.stats()).toMatchObject({ requests: 3, encodedBytes: 2000, blockedRequests: 1 });
  });
  it("sums Chromium CPU keeping the max per pid", async () => {
    /* processInfo [{id:1,cpuTime:1.5},{id:2,cpuTime:0.5}] at cleanup, then [{id:1,cpuTime:2.0}] at closeAll → chromiumCpuMs 2500 */
  });
  it("logs the closed line on closeAll and resets the counters", async () => {
    expect(logSpy).toHaveBeenCalledWith("[BrowserRuntime] closed (closeAll): launches=1 sessions=1 crashes=0 requests=3 bytes=2000 blocked=1 chromiumCpuMs=2500");
    expect(rt.stats()).toEqual({ launches: 0, sessions: 0, crashes: 0, requests: 0, encodedBytes: 0, blockedRequests: 0, chromiumCpuMs: 0 });
  });
  ```

  Real Chromium: runtime with `launchOptions: { headless: true, args: [...BROWSER_ARGS, \`--host-resolver-rules=MAP * 127.0.0.1:${port}\`] }`; the local server counts hits by `host + path`, serves `/match/<i>` (HTML linking `/style.css`, `/app.js`, `/img.png`, `/f.woff2` and `http://www.googletagmanager.com/gtm.js`), makes the four assets cacheable (`cache-control: public, max-age=3600`) and sends ACAO `*` everywhere.
  ```ts
  it("media+trackers keeps the HTTP cache and never blocks stylesheets", async () => {
    // 5 navigations http://first.test/match/0..4 (waitUntil "load")
    expect(hits["first.test/app.js"]).toBe(1); expect(hits["first.test/style.css"]).toBe(1);
    expect(hits["first.test/img.png"] ?? 0).toBe(0); expect(hits["first.test/f.woff2"] ?? 0).toBe(0);
    expect(hits["www.googletagmanager.com/gtm.js"] ?? 0).toBe(0);
  });
  it("none loads everything (img 1x cached, gtm 5x)", ...);
  it("never blocks the scrapers' data URLs, look-alike hosts or query mentions", async () => {
    // all fetched from the page under media+trackers; each must resolve
    const urls = ["http://api.efortuna.pl/offer/markets/api/v1_0/fixture/1/markets", "http://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL/events/1",
      "http://offer.lvbet.pl/client-api/v5/markets/search?matches_ids=1", "http://betfan.pl/api/v1/market/events/40932985",
      "http://www.iforbet.pl/rest/market/events/1", "http://api.etoto.pl/rest/market/events/1", "http://fuksiarz.pl/rest/market/events/1",
      "http://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/175", "http://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538/28660755",
      "http://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league",
      "http://first.test/runtime.webpack.js", "http://first.test/vendor.icons.js", "http://first.test/api?ref=http://www.googletagmanager.com/", "http://notgoogletagmanager.com/x"];
    expect(await page.evaluate((u) => Promise.all(u.map((x) => fetch(x).then(() => "ok", () => "BLOCKED"))), urls)).toEqual(urls.map(() => "ok"));
  });
  it("blocks in popups too", ...);  // page.evaluate(() => window.open("/match/9")); img hits stay 0
  it("reports traffic and Chromium CPU in the closed line", async () => {
    // after closeAll: line matches /requests=[1-9]\d* bytes=[1-9]\d* blocked=[1-9]\d* chromiumCpuMs=[1-9]\d*/
  });
  ```
- [ ] **Step 2: Run them and confirm they fail.** `heavy --live npx vitest run src/scrapers/base/__tests__/browser-runtime.test.ts src/scrapers/base/__tests__/browser-runtime.chromium.test.ts`. Expected: the new tests FAIL (`stats is not a function`, `img.png` hit 1), and the Task 2 tests stay green.
- [ ] **Step 3: Implement `preparePage` and the runtime wiring** as specified above.
- [ ] **Step 4: Run them and confirm they pass.** The same command, then `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/base/browser-page-setup.ts src/scrapers/base/browser-runtime.ts src/scrapers/base/__tests__/browser-runtime.test.ts src/scrapers/base/__tests__/browser-runtime.chromium.test.ts
  git commit -m "feat(browser): per-page CDP setup with cache-preserving URLPattern blocking and traffic/CPU stats"
  ```

---

### Task 5: Wire `PlaywrightScraper` to the runtime; budgets; shims; delete the dead code

**Files:**
- Modify:
  - `src/scrapers/base/playwright-base.ts`: imports `:6-22` (add `browserRuntime`, `resolveBrowserPolicy`, `currentScrapeJob`, `createScrapeBudget`; drop the `browserPool` import `:16`; re-export `BrowserSession` from `./browser-runtime.js`), constants `:24-37` (delete the local `DEFAULT_USER_AGENT` and `BrowserSession`), `initBrowser :88-170` (replace), `applyStealthScripts :172-190` (delete), `executeWithBrowser :335-351` (budget + crash retry; plan 07 Task 2's abort hook stays), `executeFullOfferScrape :353-357` (trailing `budget?`, forwarded; the recorder body `:358-390` unchanged).
  - `src/scrapers/base/browser-pool.ts`: the whole file becomes a shim; it re-exports `BROWSER_ARGS`.
  - **Delete** plan 01's `src/scrapers/base/__tests__/browser-pool.test.ts` (cross-plan #6) after checking each of its 10 cases against the table below.
  - `src/scrapers/aggregator.ts:12`, `:201-203`.
  - `src/services/audit/scraper-audit-core.ts:119-126`: `try { … } finally { await browserRuntime.closeIfIdle(); }` around the `scrapeFullOffer` call at `:126`.
  - `scripts/audit-probe.ts:31-58`: add `finally { await browserRuntime.closeIfIdle(); }`.
  - `scripts/perf-smoke.ts` (plan 02): only if it lacks `closeAllBrowsers()` in a `finally`, add it (`scripts/smoke-bookmaker.ts:190` already has it).
- Test: `src/scrapers/base/__tests__/playwright-base.test.ts`, extend `src/scrapers/base/__tests__/navigation-diagnostics.test.ts` (`describe("PlaywrightScraper.executeFullOfferScrape")`, `:641-…`), `src/services/audit/__tests__/scraper-audit-core-close.test.ts`.

Plan 01's `browser-pool.test.ts` cases and where each lives on:

| Plan 01 case | Now pinned by |
|---|---|
| never passes `--disable-features` | Task 2 "launch args never carry --disable-features" |
| the shared pool launches headless Chromium with exactly these args | Task 2 "launches once … with the headless shell and BROWSER_ARGS" |
| release closes the browser when nobody waits | Task 2 idle-close and `closeIfIdle` tests |
| release hands the browser to the oldest waiter | Task 1 FIFO + Task 2 "hands the permit to the next waiter on cleanup" |
| closeAll rejects every pending waiter | Task 1 `rejectAll` + Task 2 "closeAll rejects waiters…" |
| a launch failure wakes a waiter, which launches its own browser | Task 2 "a launch failure rejects every single-flight caller … next call launches again" |
| closeAll during an in-flight launch closes the late browser | Task 2 "closeAll during launch closes the late browser" |
| remove() of a broken browser wakes a waiter / a crashed browser is never handed out | Task 2 "disconnect frees permits and the waiter runs on generation 2" |
| a second release of the same browser is ignored | Task 1 "release is idempotent" + Task 2 "cleanup twice releases once" |

**Interfaces:**
- Consumes: `browserRuntime`, `BrowserSession`, `SessionRuntimeInfo` (Task 2); `resolveBrowserPolicy` (Task 3); `ScrapeBudget`, `createScrapeBudget` (§3); `currentScrapeJob()` (plan 07 Task 2).
- Produces:
  ```ts
  protected initBrowser(budget?: ScrapeBudget): Promise<BrowserSession>;
  // budget ??= currentScrapeJob()?.budget;  const policy = resolveBrowserPolicy(this.bookmaker, this.config);
  // → browserRuntime.openSession({ bookmaker, policy, signal: budget?.signal, maxSessionMs: Math.min(policy.maxSessionMs, budget?.remainingMs() ?? Infinity) })
  protected executeWithBrowser<T>(operation: (page: Page, session: BrowserSession) => Promise<T>,
    errorHandler: (error: unknown, duration: number) => T, budget?: ScrapeBudget): Promise<T>;
  protected executeFullOfferScrape(league: string, leagueValidator: (league: string) => boolean,
    scrapeLogic: (page: Page, league: string) => Promise<FullOfferScraperResult>, budget?: ScrapeBudget): Promise<FullOfferScraperResult>; // forwards budget
  // browser-pool.ts shim:
  export const browserPool: { closeAll(): Promise<void>; acquire(): Promise<never> }; // getStats/release/remove have no callers (grep) and go
  ```
- The 10 scrapers keep calling `executeFullOfferScrape(league, validator, logic)` without a budget; inside a plan 07 job `initBrowser` takes the job's budget (sts ≤ 360 s, betcris ≤ 600 s, pzbuk ≤ 600 s, others ≤ 240 s); outside one (audit tooling, smokes) the policy lifetime applies.
- Crash retry rule: when the operation settles (resolved or rejected) and `session.runtime?.crashed()` is true: if `runtime.remainingMs() >= 0.4 * runtime.lifetimeMs`, call `cleanup()`, log `[${bm}] browser disconnected mid-session; retrying once (${s}s of ${l}s left)` and run the operation once more on `this.initBrowser(budget ?? createScrapeBudget(runtime.remainingMs()))`; otherwise log `…; not retrying (…)` and settle as today (the value, or `errorHandler(error, duration)`). A mocked session without `runtime` never retries, so the betcris and observability mocks stay valid. Because observability's recorder is attached inside the operation (`playwright-base.ts:373-382`) and `recorder` is reassigned per attempt, a retried run reports the **second** attempt's diagnostics.
- Plan 07 Task 2's hook (abort listener on `currentScrapeJob()?.budget.signal` → `session.context.close()`) stays right after `initBrowser` in `executeWithBrowser`, for both attempts; with the runtime's own `signal` close it is a harmless second close.
- Shims: `browserPool.closeAll()` → `browserRuntime.closeAll()`; `browserPool.acquire()` rejects with `browserPool.acquire() is retired; use browserRuntime.openSession()`. No test spies `browserPool` any more (`git grep -n "spyOn(browserPool" -- src` prints nothing: plan 06 Task 1's betclic guard and plan 07 Task 2's betby guard spy `initBrowser`, like totalbet `scraper.test.ts:55, :68` and betcris `scraper-flow.test.ts:33`); a hit added meanwhile is converted to an `initBrowser` spy.

- [ ] **Step 1: Write the failing tests**
  ```ts
  // playwright-base.test.ts
  // vi.mock("../browser-runtime.js", async (orig) => ({ ...(await orig()), browserRuntime: { openSession: vi.fn(), closeAll: vi.fn(), closeIfIdle: vi.fn(), activeSessions: 0, waitingSessions: 0 } }))
  // TestScraper extends PlaywrightScraper with bookmaker "sts", config DEFAULT_SCRAPER_CONFIGS.sts and stub abstract methods.
  it("initBrowser opens a runtime session with the resolved policy and the sts lifetime", async () => {
    await (new TestScraper() as any).initBrowser();
    expect(browserRuntime.openSession).toHaveBeenCalledWith({ bookmaker: "sts", policy: { block: "none", stealth: false, maxSessionMs: 360_000 }, signal: undefined, maxSessionMs: 360_000 });
  });
  it("initBrowser(budget) bounds the session by the budget", async () => { /* remainingMs 50_000 → maxSessionMs 50_000, signal budget.signal */ });
  it("initBrowser falls back to the job budget (plan 07 currentScrapeJob; Review Focus 6)", async () => {
    const b = fakeBudget(Date.now() + 50_000);
    await runInScrapeJob({ runId: "r", bookmaker: "sts", league: "premier-league", transport: "browser", budget: b }, () => (new TestScraper() as any).initBrowser());
    expect(browserRuntime.openSession).toHaveBeenCalledWith(expect.objectContaining({ signal: b.signal, maxSessionMs: 50_000 }));
  });
  it("executeFullOfferScrape forwards its budget to initBrowser", async () => { /* spy initBrowser; executeFullOfferScrape("premier-league", () => true, logic, b) → initBrowser called with b */ });
  it("retries once on a crashed session with >= 40% lifetime left, inside the remaining time", async () => {
    vi.useFakeTimers({ now: 0 });
    const first = fakeSession({ crashed: true, remainingMs: 200_000, lifetimeMs: 240_000 }), second = fakeSession({ crashed: false });
    const spy = vi.spyOn(TestScraper.prototype as any, "initBrowser").mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const op = vi.fn().mockRejectedValueOnce(new Error("Target page, context or browser has been closed")).mockResolvedValueOnce("ok");
    await expect((new TestScraper() as any).executeWithBrowser(op, () => "err")).resolves.toBe("ok");
    expect(first.cleanup.mock.invocationCallOrder[0]).toBeLessThan(spy.mock.invocationCallOrder[1]); // cleanup before the 2nd session
    expect(spy.mock.calls[1][0].deadline).toBe(200_000);                                               // retry budget = remaining time
    expect(second.cleanup).toHaveBeenCalledTimes(1);
  });
  it("does not retry with < 40% left and hands the error to errorHandler", ...);   // remainingMs 60_000 of 240_000
  it("never retries a mocked session without runtime info", ...);
  it("closeAllBrowsers and browserPool.closeAll delegate to browserRuntime.closeAll", ...);
  it("browserPool.acquire is retired", async () => expect(browserPool.acquire()).rejects.toThrow("browserPool.acquire() is retired"));
  it("the dead route/stealth path is gone", () => {
    const src = readFileSync(new URL("../playwright-base.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\.route\(|applyStealthScripts|BLOCKED_RESOURCE_TYPES|disableResourceBlocking|DEFAULT_USER_AGENT/);
  });

  // navigation-diagnostics.test.ts, describe("PlaywrightScraper.executeFullOfferScrape"): TestScraper's initBrowser now returns
  // sessions from a queue (default: the single page as today).
  it("a retried crash carries the second attempt's diagnostics", async () => {
    // session 1: pageA + runtime { crashed: () => true, remainingMs: () => 200_000, lifetimeMs: 240_000 };
    //   logic on pageA emits a main-frame document response 200 for LEAGUE_URL (the file's request/response fakes), then rejects
    //   new Error("Target page, context or browser has been closed")
    // session 2: pageB; logic emits a main-frame document response 404 for LEAGUE_URL and returns
    //   { success: false, bookmaker: "betters", league: "premier-league", matches: [], error: "No events found from API" }
    const r = await scraper.scrapeFullOffer("premier-league");
    expect(r.error).toBe(`No events found from API | document HTTP 404 ${LEAGUE_URL}`);
    expect(r.diagnostics!.documents).toEqual([{ requestedUrl: LEAGUE_URL, finalUrl: LEAGUE_URL, status: 404 }]);   // nothing from pageA
  });

  // src/services/audit/__tests__/scraper-audit-core-close.test.ts
  it("scrapeOneMatchFullOffer closes an idle browser after success and after a throw", ...); // closeIfIdle called once in each case; the throw propagates
  ```
- [ ] **Step 2: Run them and confirm they fail.** `heavy npx vitest run src/scrapers/base/__tests__/playwright-base.test.ts src/scrapers/base/__tests__/navigation-diagnostics.test.ts src/services/audit/__tests__/scraper-audit-core-close.test.ts`. Expected: FAIL. `openSession` is not called, because `initBrowser` still uses `browserPool`; the retried-crash test sees no retry.
- [ ] **Step 3: Implement** the hunks listed in Files, following the interfaces and the retry rule above; `git rm src/scrapers/base/__tests__/browser-pool.test.ts`.
- [ ] **Step 4: Run them and confirm they pass.** Then once `heavy --live npx vitest run` (full suite; `golden.test.ts` unchanged; totalbet, betcris, betby and betclic guards green), `heavy npx tsc --noEmit`, and the standalone script check `heavy npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule scripts/audit-probe.ts scripts/perf-smoke.ts scripts/smoke-bookmaker.ts`. Expected: `git grep -n "\.route(\|applyStealthScripts\|disableResourceBlocking" -- src scripts ':(exclude)*__tests__*'` and `git grep -n "spyOn(browserPool" -- src` both print nothing.
- [ ] **Step 5: Commit**
  ```bash
  git add -A src/scrapers/base src/scrapers/aggregator.ts src/services/audit scripts/audit-probe.ts
  git commit -m "refactor(browser): route PlaywrightScraper through the shared runtime with job budgets, keep pool shims, drop the dead route/stealth path"
  ```
- [ ] **Step 6: Live parity before merging (no code), HH:15–HH:50.** Bookmakers: the 10 whose default class still launches Chromium (plan 07's `resolveJobTransport` = `browser`; on the future base sts, fortuna, superbet, lvbet, fuksiarz, betfan, forbet, etoto, betcris, pzbuk), plus any migrated bookmaker forced with `SCRAPER_TRANSPORT_<BM>=browser`. Per bookmaker run **A** (base code), **B** (this worktree), **A2** (base code) back-to-back. The A arms run read-only in `$H/integration` when its `HEAD` equals this branch's merge base (`git -C $H/integration rev-parse HEAD` = `git merge-base HEAD recovery/integration`); otherwise record the commands and defer the check to the owner. Output goes to this worktree's `.scratch/`. pzbuk takes ≈ 6 min per arm. E.g. for sts:
  ```bash
  WT=$(pwd); S=$WT/.scratch/browser-rollout; mkdir -p $S
  (cd $H/integration && $H/bin/heavy --live npx tsx scripts/perf-smoke.ts --bookmaker sts --league premier-league) 2>&1 | tee $S/runtime-sts-A.txt
  $H/bin/heavy --live npx tsx scripts/perf-smoke.ts --bookmaker sts --league premier-league 2>&1 | tee $S/runtime-sts-B.txt
  (cd $H/integration && $H/bin/heavy --live npx tsx scripts/perf-smoke.ts --bookmaker sts --league premier-league) 2>&1 | tee $S/runtime-sts-A2.txt
  ```
  Pass: matches equal across A, B, A2; B's markets and selections within ±1 % of mean(A, A2); B's log has exactly one `[BrowserRuntime] launched` line and its closed line shows `crashes=0`. If |A − A2| > 1 % the window is too noisy: repeat next hour.

---

### Task 6: Opt-in stealth (consistent UA and client hints, JS shims)

**Files:**
- Create: `src/scrapers/base/browser-stealth.ts`
- Modify: `src/scrapers/base/browser-runtime.ts` (context UA and init script when `policy.stealth`), `src/scrapers/base/browser-page-setup.ts` (`userAgentOverride` sent after `Network.enable`)
- Test: `src/scrapers/base/__tests__/browser-stealth.test.ts`, `src/scrapers/base/__tests__/browser-runtime.test.ts` (`describe("stealth")`), `src/scrapers/base/__tests__/browser-runtime.chromium.test.ts` (`describe("stealth")`)

**Interfaces:**
- Produces:
  ```ts
  export interface ClientHintBrand { brand: string; version: string }
  export function clientHintBrands(major: number): ClientHintBrand[];             // Chromium's GREASE rule with "Google Chrome" as the brand
  export function stealthUserAgent(fullVersion: string): string;                  // Windows Chrome/<major>.0.0.0 UA
  export interface UserAgentOverrideParams { userAgent: string; acceptLanguage: string; platform: string; userAgentMetadata: Record<string, unknown> }
  export function userAgentOverride(fullVersion: string): UserAgentOverrideParams;
  export const STEALTH_INIT_SCRIPT: string;  // window.chrome, navigator.plugins/mimeTypes/pdfViewerEnabled, languages
  ```
- GREASE rule, applied to a seed equal to the major version:
  - The GREASE brand is `` `Not${C[major % 11]}A${C[(major + 1) % 11]}Brand` `` with `C = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"]`. Its version is `["8", "99", "24"][major % 3]`.
  - Positions: `order = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]][major % 6]`, then `list[order[0]] = grease`, `list[order[1]] = Chromium`, `list[order[2]] = Google Chrome`.
  - At 143 this gives the measured `Google Chrome, Chromium, Not A(Brand/24`. The real-Chromium test guards against drift when Playwright bumps Chromium.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("brands for Chrome 143 match the measured headless-shell order", () =>
    expect(clientHintBrands(143)).toEqual([{ brand: "Google Chrome", version: "143" }, { brand: "Chromium", version: "143" }, { brand: "Not A(Brand", version: "24" }]));
  it("userAgentOverride is consistent with browser.version()", () => expect(userAgentOverride("143.0.7499.4")).toEqual({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    acceptLanguage: "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7", platform: "Win32",
    userAgentMetadata: { brands: clientHintBrands(143),
      fullVersionList: [{ brand: "Google Chrome", version: "143.0.7499.4" }, { brand: "Chromium", version: "143.0.7499.4" }, { brand: "Not A(Brand", version: "24.0.0.0" }],
      fullVersion: "143.0.7499.4", platform: "Windows", platformVersion: "10.0.0", architecture: "x86", bitness: "64", model: "", mobile: false, wow64: false } }));
  // fake runtime
  it("stealth sets the context UA, adds the init script once and overrides every page incl. popups", ...);
  it("stealth off changes nothing (BROWSER_CONTEXT_USER_AGENT, no init script, no setUserAgentOverride)", ...);
  // real Chromium, local server on 127.0.0.1 (secure context, so client hints are sent).
  // headersAndFingerprint(policy) is test-local: it opens a session with the policy, loads "/" (whose script fetches "/xhr"),
  // and returns { secChUa, xhrSecChUa, ua, fp } from the server's recorded headers and one page.evaluate.
  it("stealth: document and fetch carry the browser's own brands with HeadlessChrome replaced", async () => {
    const plain = await headersAndFingerprint({ ...DEFAULT_BROWSER_POLICY });
    const st = await headersAndFingerprint({ ...DEFAULT_BROWSER_POLICY, stealth: true });
    expect(plain.secChUa).toContain('"HeadlessChrome"');                   // default unchanged
    expect(st.secChUa).toBe(plain.secChUa.replace('"HeadlessChrome"', '"Google Chrome"'));
    expect(st.xhrSecChUa).toBe(st.secChUa);
    expect(st.fp).toMatchObject({ platform: "Win32", plugins: 5, mimeTypes: 2, pdfViewerEnabled: true, chrome: "object",
      pluginsTag: "[object PluginArray]", webdriver: false, languages: ["pl-PL", "pl", "en-US", "en"] });
    expect(st.ua).toMatch(/Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/); expect(st.ua).not.toContain("Headless");
  });
  ```
- [ ] **Step 2: Run them and confirm they fail.** `heavy --live npx vitest run src/scrapers/base/__tests__/browser-stealth.test.ts src/scrapers/base/__tests__/browser-runtime.test.ts src/scrapers/base/__tests__/browser-runtime.chromium.test.ts`. Expected: FAIL on the new tests (missing module; `HeadlessChrome` still in `sec-ch-ua`).
- [ ] **Step 3: Implement.**
  - The context `userAgent` is `stealthUserAgent(browser.version())` when stealth is on.
  - `context.addInitScript(STEALTH_INIT_SCRIPT)` runs once per context.
  - `preparePage` sends `Network.setUserAgentOverride(userAgentOverride(version))` after `Network.enable`.
  - The plugins shim builds objects on `PluginArray.prototype` / `Plugin.prototype` with own `length`/index properties. It exposes the five PDF viewers Chrome 143 reports (`PDF Viewer`, `Chrome PDF Viewer`, `Chromium PDF Viewer`, `Microsoft Edge PDF Viewer`, `WebKit built-in PDF`).
- [ ] **Step 4: Run them and confirm they pass.** The same command, then `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/base/browser-stealth.ts src/scrapers/base/browser-runtime.ts src/scrapers/base/browser-page-setup.ts src/scrapers/base/__tests__
  git commit -m "feat(browser): opt-in stealth with client hints consistent with the real Chromium version"
  ```

---

### Task 7: Retire the dead `navigateWithRetry`

`navigateWithRetry` (`playwright-base.ts:192-212`) has no caller left: betby deleted `betters/navigation.ts` and `lebull/navigation.ts`, and plan 06 Task 1 deleted `betclic/tab-scraper.ts:285`. Its defaults (`networkidle`, fixed 2^n s backoff, no budget, discarded `Response`) would be wrong for any new caller, so it goes instead of being extended.

**Files:**
- Modify: `src/scrapers/base/playwright-base.ts:192-212` (delete the method and its doc comment).
- Test: extend `src/scrapers/base/__tests__/playwright-base.test.ts` ("the dead route/stealth path is gone").

**Interfaces:**
- Precondition: `git grep -n "navigateWithRetry(" -- src scripts` prints only the definition. If a caller appeared meanwhile, keep the method and give it these rules instead: attempts `this.config.retries`; `waitUntil` default `"domcontentloaded"`; per-attempt timeout `Math.min(timeout ?? this.config.timeout, budget?.remainingMs() ?? Infinity)`; `budget?.checkpoint()` before every attempt and after every backoff; full-jitter backoff `Math.random() * 1000 * 2 ** n` that wakes early on `budget.signal`; returns the `Response` (an HTTP status is returned, never retried).
- Produces: nothing; `PlaywrightScraper` loses `navigateWithRetry`.

- [ ] **Step 1: Write the failing test.** Extend the Task 5 source scan to `/\.route\(|applyStealthScripts|BLOCKED_RESOURCE_TYPES|disableResourceBlocking|DEFAULT_USER_AGENT|navigateWithRetry/`.
- [ ] **Step 2: Run it and confirm it fails.** `heavy npx vitest run src/scrapers/base/__tests__/playwright-base.test.ts`. Expected: FAIL, the source still contains `navigateWithRetry`.
- [ ] **Step 3: Implement.** Delete the method.
- [ ] **Step 4: Run it and confirm it passes.** Then once `heavy --live npx vitest run` and `heavy npx tsc --noEmit`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/base/playwright-base.ts src/scrapers/base/__tests__/playwright-base.test.ts
  git commit -m "refactor(browser): delete navigateWithRetry, which has no caller left"
  ```

---

### Task 8: Roll policies out one bookmaker at a time (no new code)

Each step is a measured A/B, followed by a one-line config commit in `src/types/scraper.ts` (`DEFAULT_SCRAPER_CONFIGS.<bm>.policy.browser`), made in a worktree per README §6. Run it after Tasks 1–7 are merged, at HH:15–HH:50 (or ≥ 5 min from `nextScrapeAt` once plan 07 Task 4 is live), with only one bookmaker in flight. The A/B needs no code change, because the env overrides from Task 3 select the level. The A/B smokes are read-only (`heavy --live`); the post-commit A10 check on a scheduled run is **deferred to the owner**.

- [ ] **Step 1: Candidates and order** (start level → fallback level):

  | Order | Bookmaker | Start | If B fails | Evidence |
  |---|---|---|---|---|
  | 1 | fortuna | `media+trackers` | `media` | 13.8 → 1.9 MB, CPU 23.3 → 5.9 s, same markets (route what-if) |
  | 2 | betfan | `media+trackers` | `media` | 4.9 → 1.9 MB, CPU 5.3 → 2.1 s, identical results |
  | 3–5 | forbet, etoto, fuksiarz | `media+trackers` | `media` | home pages 4.5 / 5.2 / 6.6 MB, mostly waste |
  | 6–7 | lvbet, superbet | `media+trackers` | `media` | — |
  | 8 | sts | `media` | `none` | stylesheets plus 72 hosts lost 7.8 % of markets; images/fonts/media alone kept 5 589 |
  | 9 | betcris | `media+trackers` | `media`, then `none` | hosts-only identical; image/font/media gave 18 / 19 matches in route mode |

  **Not rolled out:** pzbuk stays `none` (Open Question 2; a CDP-blocked icon may retry like the 160× abort storm, and 05c replaces its browser path); betclic, betters, lebull and totalbet have no browser path. Stylesheets cannot be blocked for anyone; for betcris and pzbuk this is guaranteed by the type and pinned by Task 3.
- [ ] **Step 2: Run A, B and A2 back-to-back** for one bookmaker from the worktree root. `<bm>` is lowercase, `<BM>` uppercase, and `<level>` is the Start (or fallback) level from Step 1. sts and betcris run on their **default** path (they stay on the browser: owner C, and sts until 05a); for a bookmaker whose default transport is no longer the browser (after plans 03/04), prefix `SCRAPER_TRANSPORT_<BM>=browser`:
  ```bash
  WT=$(pwd); S=$WT/.scratch/browser-rollout; mkdir -p $S
  for arm in A B A2; do lvl=none; [ "$arm" = B ] && lvl=<level>
    SCRAPER_BROWSER_BLOCK_<BM>=$lvl $H/bin/heavy --live npx tsx scripts/perf-smoke.ts --bookmaker <bm> --league premier-league 2>&1 | tee $S/<bm>-$lvl-$arm.txt; done
  ```
  - Read `matches`, `markets` and `selections` from the perf smoke's summary (plan 02).
  - Read `requests`, `bytes` and `chromiumCpuMs` from the `[BrowserRuntime] closed (closeAll): …` line (Task 4).
- [ ] **Step 3: Apply the pass criterion.** B passes only if **all** of these hold:
  - B succeeded;
  - `matches_B == matches_A == matches_A2`;
  - markets and selections of B within ±1 % of mean(A, A2);
  - `bytes_B < min(bytes_A, bytes_A2)`;
  - `chromiumCpuMs_B < min(cpu_A, cpu_A2)`;
  - `requests_B <= max(requests_A, requests_A2)`, so no retry storm.

  If |A − A2| > 1 % on markets, discard the window and repeat in the next hour. If B fails, rerun B at the fallback level. If the last level fails, keep `none`.
- [ ] **Step 4: Commit the passing level** (one bookmaker per commit, `heavy npx tsc --noEmit` and `heavy --live npx vitest run` green):
  ```bash
  git add src/types/scraper.ts && git commit -m "perf(<bm>): block <level> in the browser path (A/B: -<x> MB, -<y> CPU-s, markets ±<z>%)"
  ```
  - If the bookmaker's **default** path is still the browser, the owner checks observability A10 on the next scheduled run after the merge (deferred): `grep -a '^\[Aggregator/FullOffer\] <bm> \(success\|partial\):' $LOG | tail -1` shows `K saved` with K ≥ 0.75 × its run-2 `markets_saved` (`RUN2_OK` in `src/__tests__/helpers/run-fixtures.ts:24-34`). If it fails, revert the commit.
  - Record the A/B outputs from `.scratch/browser-rollout/` in the task report; the owner copies them to `$E/browser-rollout/`.
- [ ] **Step 5: Stealth stays off** unless a browser-path run fails with a challenge signature. The signatures are a document HTTP 403/503, or a `page title "Just a moment…"` in the observability error text.
  - In that case run the same A/B with `SCRAPER_BROWSER_STEALTH_<BM>=1`, at the bookmaker's current block level.
  - Pass: B succeeds, and B's matches equal those of the HTTP-path run (the perf smoke without `SCRAPER_TRANSPORT_<BM>`) in the same hour; for sts and betcris, which have no HTTP path, B's matches equal the last successful scheduled run's.
  - Commit `stealth: true` for that bookmaker only.

---

## Self-Review

1. **Spec coverage.** Brief item 1 (runtime: single-flight launch, context per session, `serviceWorkers: "block"`, 1366×768, semaphore of 3 with settling waiters, 60 s idle close, relaunch on `disconnected`, one retry if ≥ 40 % left, shims) → Tasks 1, 2, 5. Item 2 (`policy.browser` replacing `disableResourceBlocking`, CDP blocking, one constants file, never stylesheets, dead route/stealth deleted) → Tasks 3, 4, 5. Item 3 (stealth from `browser.version()` + init shims, opt-in) → Task 6. Item 4 (rollout A/B with numeric criteria, never stylesheets, pzbuk `none`) → Task 8. Item 5 (`navigateWithRetry`) → Task 7, now a deletion because no caller is left. The revision adds: session lifetimes from plan 07's budgets so sts/betcris (still on the browser) are never cut early (Tasks 3, 5; Review Focus 6), `budget ??= currentScrapeJob()?.budget` and the forwarded `executeFullOfferScrape` budget (Task 5), the retried-crash diagnostics test, and the ported plan 01 pool tests.
2. **Step scan.** No "TBD"; every conditional names its trigger (plan 06 Task 1 tab-scraper, plan 07 Tasks 1–2, plan 01 exports, a 05b guard if it exists, a `navigateWithRetry` caller if one appears, perf-smoke `finally`, the integration worktree's HEAD for the A arms). Every vitest/tsc/tsx command runs through `heavy` (`--live` when Chromium launches); outputs go to `.scratch/`; persisting checks are deferred to the owner. Fixed during the first review: (a) the substring `urls` form of `setBlockedURLs` was replaced by `urlPatterns` after measuring that `*.webp` blocks `runtime.webpack.js` and host patterns block query mentions; (b) Task 3 deletes the dead route block itself, so `tsc` is green at every commit.
3. **Type consistency.** `BrowserSession` only gains the optional `runtime`, so existing mocks type-check and never retry. `OpenSessionOptions.policy` arrives in Task 4 (Task 2 tests omit it). `ResolvedBrowserPolicy` is used by Tasks 4–6; its `maxSessionMs` default is plan 07's `maxDurationMsFor`, imported from the leaf `job-budgets.ts` (no import cycle through `playwright-base.ts`). `initBrowser(budget?)` keeps every existing zero-argument override valid. `BROWSER_CONTEXT_USER_AGENT` (Chrome/120, browser contexts) cannot collide with plan 02's `DEFAULT_USER_AGENT` (Chrome/143, HTTP client). The retry-order assertion uses `invocationCallOrder`.
4. **Review focus.** Each of the six items names its pinning test (Tasks 2, 2, 2, 4/6, 5, 3/5).
5. **Proportion.** Code blocks hold signatures, tests and commands. Only two rules are spelled out, because no test fully determines them: the GREASE algorithm and the crash-retry rule.

## Open Questions

1. **Stealth policy.** Should stealth be enabled proactively on the browser paths of Cloudflare-fronted bookmakers (sts, etoto), or only after a challenge is observed (Task 8 Step 5)? It changes bot-detection exposure; this is recovery README OQ15 and observability OQ8. **Recommended: only after a challenge.**
2. **pzbuk images.** If `media` triggers an icon retry storm on pzbuk's browser path, keep `none`. The alternative is a CDP `Fetch`-domain 1×1 fulfilment, as in README §5.1 pzbuk. That needs request interception, a cost this plan avoids, and 05c replaces pzbuk's browser path. **Decided: pzbuk stays `none`; it is not in the Task 8 rollout.**
3. **Blast radius of one shared browser.** A Chromium crash fails every open session (≤ 3), and each retries once if enough time is left. With sts and betcris staying on the browser, a crash late in a betcris run (< 40 % of its 600 s left) loses that run. Running 2 browsers would halve the blast radius at about 200 MB PSS more. **Recommended: 1 browser.**
4. **betcris partial results on a budget abort** (new; README §8 Q12 residual). betcris returns only at the end of its per-game loop (`betcris/index.ts:271-362`), so a run cut by plan 07's 600 s deadline or a session lifetime loses every game it had captured, and the previous snapshot stays. A loop that checks `currentScrapeJob()?.budget.signal` between games and returns the captured games as `success: true` + `error: "budget exhausted: <k> of <n> games not completed"` (→ `partial` via plan 07 Task 0) would keep them. It changes recovery-built betcris code (owner C keeps "today's pooling"), so it needs an owner yes; it would land with 05b Part A. **Recommended: yes, as a small betcris task.**
