# Browserless HTTP Scrapers for Fortuna, Superbet and LVBet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move fortuna, superbet and lvbet off Chromium onto the §3 `HttpScraper` + `HttpClient`. The `FullMatchOffer[]` output stays byte-identical. Detail fetches run at concurrency 4, and a failed detail skips its match. The old Playwright classes stay available as `<Brand>BrowserScraper` behind `SCRAPER_TRANSPORT_<BM>=browser`.

**Architecture:** Each bookmaker is one independently mergeable task group, in four steps:
1. Extract the pure mapping (`listing + detail payload → FullMatchOffer`) out of today's `index.ts` loop and make the browser path call it. A characterization test proves the output on recorded payloads; a fake page drives the browser path offline.
2. Add `<Brand>HttpScraper extends HttpScraper`, which calls the same mapping. A contract test feeds the browser path and the HTTP path the same route table.
3. Pick the HTTP class in `src/scrapers/bookmakers/index.ts` unless `getTransportOverride` returns `"browser"`.
4. Run the live parity gate with `scripts/perf-smoke.ts`.

A test-only harness (Task 0) drives any `PlaywrightScraper` offline, including `page.request.fetch` (lvbet).

**Tech Stack:** TypeScript (ESM, Node 20), Vitest, tsx; plan 02's `src/scrapers/shared/*`, `src/scrapers/base/http-scraper.ts` and `scripts/perf-smoke.ts`; plan 01's `toIsoStartTime` and `buildSuperbetListingUrl`.

**Spec:**
- README sections: §3 (contract names, Parity pattern, with plan 02's refinements), §5 (P4: fortuna after fortuna.md Task 7; superbet and lvbet any time), §6 (Parity gate), §7 (HTTP scrapers 6–17 s → 1–3 s, no Chromium, no CDP clones).
- `$P` = `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence`.
- Evidence: `$P/findings-notes.md` (FORTUNA-1/3/5, SUPERBET-1..6, LVBET-3/4/5), `$P/betclic-fortuna/`, `$P/sts-superbet/` (`superbet-probe.mjs`, `sb-serialize.mjs`, `data/`), `$P/lvbet-fuksiarz/`, `$P/profiling/summary-individual.json`. Plus the tracked recovery fixture `src/scrapers/bookmakers/lvbet/__tests__/fixtures/markets-search-arsenal-hull-2026-11-06.json`, a raw v5 `/markets/search` array.

> **Revision 2026-11-13:**
> - **Base moved** to the future base (`recovery/integration` ≥ `aaf7c07` + observability + fortuna) under the recovery `EXECUTION.md` workspace rules: branch from `recovery/integration`, symlinked `node_modules`, a dead-port `.env`, `bin/heavy`, no server and no DB writes, and outputs in `.scratch/` (perf-smoke files no longer go into `$P`). Merges and A10 checks are deferred to the owner. Sources: `evidence/delta-audit-infra-2026-11-13.md` header and item 14; `evidence/delta-audit-transport-2026-11-13.md` "Cross-cutting" and "04".
> - **Task 0** (cross-plan #17, #35). The Produces block lists the names moved from plan 03 (`driveBrowserScraperOffline`, `ReplayRoutes`, `withoutScrapedAt`) and defines `stripScrapedAt = (ms) => ms.map(withoutScrapedAt)`. The "if plan 03 has not landed" sentence is gone. Anchors moved: `PlaywrightScraper` `:39`, `initBrowser` `:93`, `delay` `:233`, `executeFullOfferScrape` `:353-391`, which now wraps the logic in observability's recorder. Browser results are therefore compared on `matches` or with `toMatchObject`, and the fake page is an `EventEmitter`.
> - **Preconditions.**
>   - The lvbet clause ("after lvbet.md Tasks 1–3") is satisfied (428b02f, 230024b, 74af3cf; golden 8275b6e) and dropped.
>   - The fortuna precondition is kept and updated. Task 5 (354ed31) and Task 6 (a8cdb71, committed on 2026-11-13 after the delta audit) are on `recovery/fortuna`, which is not merged yet. No Task 7 live check is recorded.
> - **Parser refs re-anchored** on the future base: fortuna `:371`/`:426`, superbet `:545`/`:419`, lvbet `:664`/`:551`.
> - **Empty listing rule** (README §3, cross-plan #38). On the HTTP path, a valid envelope with 0 entries gives `success:true, matches:[]` (observability `empty`); a malformed listing fails with `fetch unexpected payload <url>`. Review Focus 4 and Tasks 2/6/10 changed accordingly. Every HTTP class declares `readonly transport = "http" as const`.
> - **lvbet fixtures.** The tracked recovery payload `markets-search-arsenal-hull-2026-11-06.json` replaces the trimmed Crystal Palace–Liverpool detail, and `lvbet-2026-11-recovery.test.ts` joins Task 9 Step 4.
> - **A10 greps** use `^\[Aggregator/FullOffer\] <bm> (success|partial):` and `([0-9]+) saved`.
> - **Re-verified on the future base** (scratch merge, 2026-11-13). The fixture byte counts are unchanged. Parsed markets: fortuna 61, superbet 56/25, lvbet 25 (Ipswich) and 72 (Arsenal–Hull).

## Global Constraints

- README §6 applies in full, including its 2026-11-13 workspace rules (recovery `EXECUTION.md`, which wins over anything below): golden unchanged, the parity gate, and no footers.
- One worktree and branch per bookmaker group. These variables are used throughout:
  ```bash
  R=/home/skamik/Documents/repositories/personal/aityper-scraper-api
  W=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees
  H=$W/bin/heavy
  BM=superbet   # or lvbet, fortuna
  git -C $R worktree add $W/perf-04-$BM -b perf/04-$BM-http recovery/integration   # or master once the owner has merged integration
  ln -s $R/node_modules $W/perf-04-$BM/node_modules   # never npm install / npm ci
  cp $W/integration/.env $W/perf-04-$BM/.env          # Supabase on a dead port on purpose; never edit it
  ```
  - Before the first change, write the worktree's `$H npx vitest run` count and golden count to `.scratch/baseline.txt`; every total is relative to it.
  - Task 0 ships with whichever group merges first; the other branches rebase onto it (their own branch only).
  - Commit after each task on the group's branch only.
- Every `npx vitest`, `npx tsc`, `npx tsx` and `python3` command runs through `$H`; anything that calls a bookmaker uses `$H --live`. During TDD run only the scoped test file. At the end of each task run `$H npx vitest run` and `$H npx tsc --noEmit` once.
- This plan directory is untracked in the main checkout (README §8 Q11), so a worktree has no copy. Fixture commands read the absolute `$P` (read-only). Outputs go only under the worktree's `.scratch/`, never into `$P` or anywhere else in the main checkout.
- Preconditions:
  - All groups: README §5.0 step R0 (observability merged into `recovery/integration`), plan 02, and plan 03 Tasks 1–3 (`withChallengeHint`, the offline harness, `transport-selection.test.ts`).
  - Superbet and lvbet: plan 01 Tasks 3–5 (caches removed, `startTime` via `toIsoStartTime` for both brands, `buildSuperbetListingUrl`). If plan 01 Task 4 is missing, cherry-pick its superbet/lvbet hunks and test first, as their own commit.
  - Fortuna: the owner has merged `recovery/fortuna` into `recovery/integration` (R0). Task 5 (354ed31) and Task 6 (a8cdb71) are on that branch only. fortuna.md Task 7 must also be recorded: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/smoke-after-fix-fortuna.txt` must exist, in `aityper-scraper-api-worktrees/fortuna` or on integration after the merge. On 2026-11-13 it does not.
- Line numbers are on the future base, where the three brands' `index.ts`, `navigation.ts` and `constants.ts` are byte-identical to master. After plan 01 Task 3, locate statements in `superbet/index.ts` and `lvbet/index.ts` by content.
- A test file that imports a missing module or export fails to load as a whole. Each extraction task therefore runs its characterization block **before** it adds the imports of the new functions.
- HTTP path: detail concurrency **4** (`fetchDetailsSkippingFailures`, results in input order); `HttpClient` defaults (10 000 ms timeout, 1 retry, 4 per host, `accept-encoding: gzip, deflate, br`); budget `DEFAULT_MAX_DURATION_MS.http` = 120 000 ms; **no** fixed inter-request delay (the 100 ms one stays on the browser path).
- Never edited here: `<bm>/parser.ts`, `<bm>/types.ts`, `<bm>/constants.ts`, any normalizer. fortuna.md, superbet.md, lvbet.md and plan 01 own them.
- Log lines keep their exact text on both paths; superbet.md "What to monitor" greps them:
  - `[Fortuna/FullOffer] Found N fixtures`, `[Superbet/FullOffer] Found N events`, `[Superbet/FullOffer] N upcoming events with an active offer`, `[LVBet/FullOffer] Found N matches`;
  - `[<Brand>/FullOffer] <home> vs <away>: N markets`, `[<Brand>/FullOffer] Completed: N matches, M total markets`.

  Skips are logged by the `HttpScraper` template.
- URLs are built with template literals only: no `encodeURIComponent`, `URLSearchParams` or `searchParams` (Review Focus 1).
- Tests use no live network. New fixtures are trimmed copies of at most 81 KB each; the commands are in Tasks 1, 5 and 9. lvbet also reuses the tracked 99 KB recovery fixture (Task 9).
- Changed `scripts/*.ts` are type-checked with `$H npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule <files>`.
- **Empty listing rule** (README §3). On the HTTP path, a 200 whose envelope is valid but holds 0 entries gives `success: true, matches: []`, which observability classifies as `empty`; owner A6 still counts it as a failure. That covers fortuna `{"fixtures":[]}`, superbet `{"data":[]}` and lvbet `{"matches":[]}`.
  - The scraper warns `No fixtures found from API <url>`, `No events found from API <url>` or `No matches found from API <url>`, keeping today's text plus the URL, and requests no details.
  - A body without that array fails with `fetch unexpected payload <url>`.
  - The browser path keeps today's `success: false` on an empty listing until plan 10 deletes it.
- **Transport.** `FortunaHttpScraper`, `SuperbetHttpScraper` and `LVBetHttpScraper` each declare `readonly transport = "http" as const` (README §3, plan 07's `DeclaresTransport`). Plan 02's `HttpScraper` already declares the same property; the explicit declaration keeps each class self-describing, and a test pins it.
- **Partial runs.** Until plan 07 Task 0 lands the `partial` rule (README §5.0 F3; `run-outcome.ts:50-81`), a run with ≤ 50 % skipped details (`success: true` + `error`) is classified `success`, and the cause does not reach the aggregator line. After F3 it is `partial`. The A10 greps accept both statuses.
- **Browser-path results.** Observability's recorder runs inside `executeFullOfferScrape` (`playwright-base.ts:353-391`). A failed or empty browser result therefore carries `diagnostics`, and its `error` may get `| <issues>` appended (`enrichFullOfferFailure`, `navigation-diagnostics.ts:247-258`). Tests compare browser results on `success`/`matches`, or with `toMatchObject`, never with `toEqual` on the whole result.
- Live checks:
  - One bookmaker at a time. perf-smoke refuses HH:55–HH:10 by itself.
  - Run the browser path and the HTTP path back to back, with no kickoff between them: HH:12–HH:28 or HH:32–HH:50.
  - perf-smoke is dry (plan 02 forces a dead `SUPABASE_URL`), so the implementer runs it under `$H --live` and writes its files to `.scratch/perf-smoke/`.
  - Merges, A10 and the fallback flip are the owner's (deferred): the implementer records their commands and expected results in the task report.

## Review Focus

1. **URL byte-identity.** Fortuna ids carry `:` in the path. Superbet's query has a literal `+` and `:` (`startDate=2026-11-07+00:00:00`). Lvbet's query has a raw `bc:`. Percent-encoding changes the request (a different CDN cache key, and `%2B` is not a space).
   - Expected: every HTTP URL equals the browser path's URL.
   - Pinned by the exact-string builder tests (Tasks 2, 5, 6, 9) and by the contract check that every HTTP call also appears in the browser path's requests (Tasks 2, 6, 10). The replay client throws `replay-http: no route for <url>` for any other URL.
2. **Details complete out of order.** A 4 MB near-term superbet event finishes after a 0.7 MB far one. Expected: offers stay in listing order. For superbet that is kickoff order, and the audit tooling reads `matches[0]`. Pinned by "keeps listing order when the first detail resolves last" (Tasks 6, 10).
3. **A 200 with the wrong shape**: fortuna/lvbet markets that are not an array, or a superbet body without a `data` array. Expected: the match is skipped with `fetch unexpected payload <url>` and counts toward the 50 % rule; it never becomes a silent empty offer. Pinned by the "wrong shape" tests in Tasks 2, 6 and 10.
4. **Empty listing** (off-season or wrong tournament id). Expected on the HTTP path: `success:true`, `matches: []`, and no detail request (README §3 empty-listing rule; observability reports `empty`). The scraper warns with today's text plus the URL, as plan 03 does: `No fixtures found from API <url>`, `No events found from API <url>`, `No matches found from API <url>`. A malformed listing (no array) is `success:false` with `fetch unexpected payload <url>`. Pinned by the "empty listing" and "malformed listing" tests in Tasks 2, 6 and 10.
5. **Vacuous parity.** When both paths return 0 matches, deep-equal holds trivially. Two ways to get there: superbet's kickoff filter empties the recorded listing once the real clock passes 2026-11-07T12:30Z, and a mismatched URL fails on both sides. Expected: every characterization and contract test freezes `Date` where it matters and asserts the exact match count (fortuna 1, superbet 2, lvbet 2) before the deep-equal. Pinned in Tasks 1/2, 5/6 and 9/10.

---

## Observations (pre-fix analysis)

| | fortuna | superbet | lvbet |
|---|---|---|---|
| Flow today | goto `https://www.efortuna.pl` (`fortuna/navigation.ts:33-45`); `fetchLeagueData` fetches fixtures **plus N `/markets/overview` the full-offer path never reads** (`:216-273`, FORTUNA-3); then a sequential in-page `/fixture/{id}/markets` that returns parsed objects (`:147-173`) and `delay(100)` (`fortuna/index.ts:328`) | goto league page (`superbet/navigation.ts:33-54`); in-page by-date listing (`:82-126`; plan 01 Task 5 moves the URL to Node); filter + sort (`superbet/index.ts:269-272`); sequential in-page `/events/{id}` (`navigation.ts:136-169`) and `delay(100)` (`index.ts:310`) | goto `https://lvbet.pl` (`lvbet/navigation.ts:27-39`); `page.request.fetch` competition-view (`:48-70`); sequential `markets/search/?matches_ids=<id>` (`:80-106`) and `delay(100)` (`lvbet/index.ts:313`) |
| Inline mapping to extract | `fortuna/index.ts:300-327` | `superbet/index.ts:269-308` | `lvbet/index.ts:280-311` |
| Alone, PL, 2026-11-07 (`summary-individual.json`) | 13.4 s, 822 req, 19 matches / 12 345 markets / 22 846 sel, Chromium 23.3 CPU-s | 17.0 s, 152 req, 19 / 27 063 / 53 999, Node RSS 518 MB | 10.5 s, 519 req, 19 / 9 054 / 63 016 |
| Waste | page load 752–788 req, 6.4–13.3 MB (images 74 %); 1.05–1.16 s CDP structured clone per full-offer match | 1.6–2.9 s CDP clone per 4 MB near-term event (~43 MB/run across CDP) | the SPA stays open (311 req / 2.3 MB / 3 WebSockets in 10 s); `page.request` responses never disposed (~17–20 MB held to context close) |
| Failure handling | non-OK → `[]` silently (`navigation.ts:158`); fixtures without `res.ok` (`:234-237`); no timeout | non-OK → `{ data: [] }` (`:148-150`); no timeout | no `ok()`, timeout or retry (`:62-63`, `:93-94`) |
| HTTP-only probe (no cookies, no challenge) | Cloudflare; curl/Node `fetch` 200 without `__cf_bm`, 296 ms, 63 KB br / 1.7 MB JSON (`fortuna-full.hdr`, `fortuna-node-fetch.mjs`) | Fastly, `access-control-allow-origin: *`, 347 ms + 16 ms parse, 484 KB gzip / 3.99 MB near, 78 KB / 706 KB far (`sb-ev.hdr`, `superbet-probe.mjs`) | nginx/GLB, 1.37 MB per match, sent uncompressed whatever `accept-encoding` says, no ETag (`lv_mk1.hdr`) |

- **The offline harness is proven.** The writer's scratch prototype drove all three unmodified browser classes on the trimmed fixtures (on master) with a fake page: `evaluate(fn, arg)` → `fn(arg)` with a replaying global `fetch`, and `request.fetch` → replay.
  - Result: fortuna 1 match (Arsenal–Hull, 61 raw markets) and superbet 2 (56 and 25), with exactly the request lists the characterization tests assert.
  - lvbet gave 2 matches; Task 9 now uses Ipswich (25) and Arsenal–Hull from the tracked recovery fixture (72).
  - On the future base (2026-11-13) the same fixtures and the mirrored `index.ts` calls give 61, 56/25 and 25/72 parsed markets.
  - Plan 03's `driveBrowserScraperOffline` has no `page.request.fetch` and no log capture, hence Task 0.
- **`start_time`.** Read-only SQL at 2026-11-07 ~02:50: fortuna has 28 006/28 006 rows set; lvbet 0/20 031; superbet 0/30 923.
  - On the future base, superbet `index.ts:300` (`fullEvent.startTime`) and lvbet `:303` (`match.start_time`) are still unmapped, while fortuna maps `:318`. `LVBetMatch` (`lvbet/types.ts:77-90`) has no `date` field yet.
  - Plan 01 Task 4 fixes both brands: `toIsoStartTime(match.date)` for lvbet and `toIsoStartTime(fullEvent.unixDateMillis)` for superbet (the v2 detail has no `startTime`).
  - The extracted mappings carry those statements verbatim.
- **Recovery-plan overlap.**
  - superbet.md (landed) changed its normalizer, `superbet/types.ts:11-22` and `parser.ts`.
  - lvbet.md Tasks 1–3 (landed) changed `lvbet/types.ts:19-71`, `parser.ts` and the normalizer.
  - fortuna.md, on unmerged `recovery/fortuna`, changes its normalizer and `fortuna/parser.ts` (Task 5 moved `parseAllMarkets` to `:371` and `isValidFixture` to `:426`). It also changes `team-matcher.ts` (41fb299: aliases and `matchTeamByExactAlias`, with no effect on PL names).
  - On the future base the three brands' `index.ts`, `navigation.ts` and `constants.ts` are byte-identical to master, so no rebase order conflicts.
  - These tests compute `markets` with the live `parseAllMarkets`, so they stay green when those plans change parser output.
  - fortuna.md Task 7's smoke (`smoke-full-offer.mts`) calls `getScraper(bm).scrapeFullOffer(league)` + `closeAllBrowsers()`, and observability's `scripts/smoke-bookmaker.ts` calls `getScraper`. Both follow the pick in `bookmakers/index.ts`.
- **Plan 01 Task 3's harness** `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` instantiates `SuperbetPlaywrightScraper` and `LVBetPlaywrightScraper`. Tasks 7 and 11 rename them there; fortuna is not in that harness.
- **Superbet sample.** The tracked superbet recovery sample `event-14438716-odds-sample.json` is not an envelope, so Task 5 keeps its evidence-trim recipe.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/__tests__/helpers/replay-page.ts` (new, test-only) | plan 03's `ReplayRoutes`, `driveBrowserScraperOffline` and `withoutScrapedAt` (moved here); drive a `PlaywrightScraper` offline from a route table (incl. `page.request.fetch`); log capture; `stripScrapedAt`, `envelope` | 0 |
| `src/scrapers/shared/rest-market/__tests__/offline-harness.ts` (plan 03) | re-exports the three moved names | 0 |
| `src/__tests__/replay-page.test.ts` (new) | harness tests | 0 |
| `src/scrapers/bookmakers/fortuna/full-offer-mapping.ts` (new) | `selectFortunaFixtures`, `mapFortunaFixtureOffer` | 1 |
| `src/scrapers/bookmakers/fortuna/index.ts` | loop calls the mapping (1); class → `FortunaBrowserScraper`, instance removed, HTTP class re-exported (3) | 1, 3 |
| `src/scrapers/bookmakers/fortuna/navigation.ts` | `fortunaFixturesUrl`, `fortunaFixtureMarketsUrl` | 2 |
| `src/scrapers/bookmakers/fortuna/http-scraper.ts` (new) | `FortunaHttpScraper` | 2 |
| `src/scrapers/bookmakers/fortuna/__tests__/http-migration.test.ts` + `fixtures/http-migration/` (new) | characterization, mapping and contract tests | 1, 2 |
| `src/scrapers/bookmakers/superbet/full-offer-mapping.ts` (new) | `selectUpcomingSuperbetEvents`, `mapSuperbetEventOffer` | 5 |
| `src/scrapers/bookmakers/superbet/navigation.ts` | `superbetEventDetailUrl` | 6 |
| `src/scrapers/bookmakers/superbet/{index,http-scraper}.ts`, `__tests__/http-migration.test.ts` + fixtures | as fortuna | 5–7 |
| `src/types/scraper.ts:171` | drop the stale superbet `disableResourceBlocking: true` | 7 |
| `src/scrapers/bookmakers/lvbet/full-offer-mapping.ts` (new) | `selectLvbetMatches`, `mapLvbetMatchOffer` | 9 |
| `src/scrapers/bookmakers/lvbet/navigation.ts` | `lvbetCompetitionViewUrl`, `lvbetMarketsSearchUrl` (used by both paths) | 9 |
| `src/scrapers/bookmakers/lvbet/{index,http-scraper}.ts`, `__tests__/http-migration.test.ts` + fixtures (reuses the tracked `__tests__/fixtures/markets-search-arsenal-hull-2026-11-06.json`) | as fortuna | 9–11 |
| `src/scrapers/bookmakers/index.ts:8,20,21` + `__tests__/transport-selection.test.ts` (plan 03) | transport pick, exports, one selection row per brand | 3, 7, 11 |
| `src/services/audit/bookmaker-registry.ts:4-6`; `scripts/{fortuna,superbet,lvbet}-market-discovery.ts:14`, `-prep-audit.ts:17`; `scripts/test-scrapers.sh` (class names) | repoint importers | 3, 7, 11 |
| `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` (plan 01) | renamed superbet/lvbet classes | 7, 11 |

---

### Task 0: Offline replay harness for browser paths

**One harness, not two (orchestrator decision).** Plan 03 Task 1, a precondition of this plan, creates `driveBrowserScraperOffline`, `ReplayRoutes` and `withoutScrapedAt` in `src/scrapers/shared/rest-market/__tests__/offline-harness.ts`. This task:
- **moves** those three into `src/__tests__/helpers/replay-page.ts`, re-exporting them from the old path so plan 03's tests stay untouched;
- extends the fake page with `request.fetch` and log capture;
- adds `runBrowserPathOffline` on top of the moved `driveBrowserScraperOffline`.

`withoutScrapedAt` stays the single per-offer stripper; `stripScrapedAt` is only its array form (cross-plan #17).

**Files:**
- Create: `src/__tests__/helpers/replay-page.ts`
- Modify: `src/scrapers/shared/rest-market/__tests__/offline-harness.ts` (plan 03; becomes re-exports for the three moved names)
- Test: `src/__tests__/replay-page.test.ts`

**Interfaces:**
- Consumes:
  - `PlaywrightScraper` (`src/scrapers/base/playwright-base.ts:39`), with protected `initBrowser()` (`:93`), `delay()` (`:233`) and `executeFullOfferScrape` (`:353-391`). The latter wraps the logic in observability's `attachNavigationRecorder` and, for a failed or empty result, `enrichFullOfferFailure` (`navigation-diagnostics.ts:83`, `:247`).
  - `browserPool`, and `createReplayHttpClient`'s route type (plan 02 Task 3).
  - Plan 03's `driveBrowserScraperOffline`, `ReplayRoutes` and `withoutScrapedAt` (moved here).
- Produces (test-only):
  ```ts
  // moved from plan 03's offline-harness.ts, which keeps `export { ReplayRoutes, driveBrowserScraperOffline, withoutScrapedAt } from …`
  export type ReplayRoutes = Parameters<typeof createReplayHttpClient>[0];
  export function driveBrowserScraperOffline(scraper: PlaywrightScraper, routes: ReplayRoutes): { calls: string[] };
  export function withoutScrapedAt(o: FullMatchOffer): Omit<FullMatchOffer, "scrapedAt">;
  // new
  export function runBrowserPathOffline(scraper: PlaywrightScraper, league: string, routes: ReplayRoutes):
    Promise<{ result: FullOfferScraperResult; requests: string[]; logs: string[] }>;   // built on driveBrowserScraperOffline
  export function captureLogs<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string[] }>; // console.log lines, args joined by " "
  export const stripScrapedAt: (ms: readonly FullMatchOffer[]) => Array<Omit<FullMatchOffer, "scrapedAt">>; // = (ms) => ms.map(withoutScrapedAt)
  export function envelope(m: FullMatchOffer): Pick<FullMatchOffer, "matchId" | "bookmaker" | "homeTeam" | "awayTeam" | "eventUrl" | "startTime">;
  ```
- Fake page: `Object.assign(new EventEmitter(), { … })`, the pattern of `navigation-diagnostics.test.ts:46-53`.
  - `goto` → `null`; `evaluate(fn, arg)` → `fn(arg)`; `request.fetch(url)` → `{ ok(), status(), json(), text(), dispose() }`.
  - `on`/`off` come from `EventEmitter`; `mainFrame()` → `{}`; `url()` → `"about:blank"`; `title()` → `""`. Observability's recorder attaches its listeners to these, and records no issue because the fake emits no events.
- Routes: an unrouted URL gets 404 `text/plain` `not routed`; an `Error` route rejects `fetch` with that error.
- `initBrowser` and `delay` are spied on the instance (`delay` resolves at once). `globalThis.fetch` is swapped for the call and restored in `finally`.

- [ ] **Step 1: Write the failing test.** `Probe` follows `TestScraper` in `src/scrapers/base/__tests__/navigation-diagnostics.test.ts:641-684`, which implements the same abstract members.

```ts
class Probe extends PlaywrightScraper {
  bookmaker = "fortuna" as const;
  config = DEFAULT_SCRAPER_CONFIGS.fortuna;
  // scrapeLeague / scrapeMatch / scrapeMatchDetails throw "unused"; extractEventUrls resolves []
  constructor(private readonly logic: (page: Page) => Promise<void>) { super(); }
  scrapeFullOffer(league: string) {
    return this.executeFullOfferScrape(league, () => true, async (page) => {
      await this.logic(page);
      return { success: true, bookmaker: "fortuna", league, matches: [] };
    });
  }
}
const ROUTES: ReplayRoutes = { "https://api.test/a": { body: '{"v":1}' }, "https://api.test/b": { body: '{"v":2}' }, "https://api.test/down": new Error("socket hang up") };

it("serves page.evaluate(fetch) and page.request.fetch from the routes and records every URL", async () => {
  const probe = new Probe(async (page) => {
    await page.goto("https://site.test/");
    const a = await page.evaluate(async (u) => (await (await fetch(u)).json()).v, "https://api.test/a");
    const b = await (await page.request.fetch("https://api.test/b")).json();
    const c = await page.evaluate(async (u) => (await fetch(u)).status, "https://api.test/unrouted");
    console.log(`[Probe] ${a} ${b.v} ${c}`);
  });
  const { result, requests, logs } = await runBrowserPathOffline(probe, "premier-league", ROUTES);
  expect(result.success).toBe(true);
  expect(requests).toEqual(["https://api.test/a", "https://api.test/b", "https://api.test/unrouted"]);
  expect(logs).toContain("[Probe] 1 2 404");
});
it("an Error route rejects fetch with that error", async () => {
  const probe = new Probe(async (page) => { await page.evaluate(async (u) => fetch(u), "https://api.test/down"); });
  // toMatchObject: the failed result also carries observability's `diagnostics`
  expect((await runBrowserPathOffline(probe, "premier-league", ROUTES)).result).toMatchObject({ success: false, error: "socket hang up" });
});
it("moved names are still reachable from plan 03's harness path", async () => {
  const old = await import("../scrapers/shared/rest-market/__tests__/offline-harness.js");
  expect(old.driveBrowserScraperOffline).toBe(driveBrowserScraperOffline); expect(old.withoutScrapedAt).toBe(withoutScrapedAt);
});
it("never acquires a browser and restores globalThis.fetch", async () => {
  const acquire = vi.spyOn(browserPool, "acquire");
  const before = globalThis.fetch;
  await runBrowserPathOffline(new Probe(async () => {}), "premier-league", ROUTES);
  expect(acquire).not.toHaveBeenCalled();
  expect(globalThis.fetch).toBe(before);
});
it("offers the hooks observability's navigation recorder attaches to", async () => {
  const probe = new Probe(async (page) => {
    const h = () => {}; page.on("request", h); page.off("request", h);
    console.log(`[Probe] ${page.url()} "${await page.title()}" ${typeof page.mainFrame()}`);
  });
  expect((await runBrowserPathOffline(probe, "premier-league", ROUTES)).logs).toContain('[Probe] about:blank "" object');
});
```

- [ ] **Step 2: Run it and confirm it fails** — `$H npx vitest run src/__tests__/replay-page.test.ts` → FAIL, `Cannot find module './helpers/replay-page.js'`.
- [ ] **Step 3: Implement.**
  - Move the three plan 03 names into `src/__tests__/helpers/replay-page.ts`, and leave re-exports in `offline-harness.ts`.
  - Then add `runBrowserPathOffline`, `captureLogs`, `stripScrapedAt` and `envelope`. `runBrowserPathOffline` uses `vi.spyOn(scraper as never, "initBrowser")`, resolving `{ page, browser: {}, context: {}, cleanup: async () => {} }`, and restores it in `finally`.
- [ ] **Step 4: Run it and confirm it passes** — same command → 5 passed. Plan 03's tests are unchanged and green: `$H npx vitest run src/scrapers/shared/rest-market`. Type-check the helper with the scripts command (Global Constraints) on `src/__tests__/helpers/replay-page.ts` → exit 0. `$H npx tsc --noEmit` and `$H npx vitest run` → green.
- [ ] **Step 5: Commit** — `git add src/__tests__/helpers/replay-page.ts src/__tests__/replay-page.test.ts src/scrapers/shared/rest-market/__tests__/offline-harness.ts && git commit -m "test: offline replay harness for browser-path scrapers"`

---

### Task 1: Fortuna — extract the full-offer mapping (parity step 1)

**Files:**
- Create: `src/scrapers/bookmakers/fortuna/full-offer-mapping.ts`
- Modify: `src/scrapers/bookmakers/fortuna/index.ts:300-327` (the loop calls the mapping)
- Test: `src/scrapers/bookmakers/fortuna/__tests__/http-migration.test.ts`
- Fixtures (61 of 1 302 markets: the first 60 plus the 1X2 market at index 468; 3 of 19 fixtures):
  ```bash
  E=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence/betclic-fortuna
  F=src/scrapers/bookmakers/fortuna/__tests__/fixtures/http-migration
  mkdir -p $F && $H python3 -I -c "
  import json,sys
  src,out=sys.argv[1],sys.argv[2]
  fx=json.load(open(src+'/fortuna-fixtures.json'))
  fx['fixtures']=[f for f in fx['fixtures'] if f['id'] in ('ufo:mtch:1xi-0a0','ufo:mtch:1xi-0a1','ufo:mtch:1xi-09z')]
  json.dump(fx,open(out+'/fixtures-premier-league.json','w'),ensure_ascii=False,separators=(',',':'))
  full=json.load(open(src+'/fortuna-full.json'))
  json.dump([m for i,m in enumerate(full) if i<60 or m['marketTypeId']=='ufo:mtyp:00-00'],open(out+'/markets-arsenal-hull.json','w'),ensure_ascii=False,separators=(',',':'))
  " $E $F && wc -c $F/*.json
  ```
  Expected: `3999 fixtures-premier-league.json`, `76760 markets-arsenal-hull.json`. These counts were re-run on 2026-11-13. On the future base all 3 fixtures are valid, and Arsenal–Hull parses to 61 markets with raw teams `Arsenal`/`Hull`.

**Interfaces:**
- Consumes: `parseTeamNames`, `parseAllMarkets`, `isValidFixture` (`fortuna/parser.ts:31,371,426` on the future base, after `recovery/fortuna` Task 5), `buildEventUrl` (`navigation.ts:291`), `getCanonicalTeamName`.
- Produces:
  ```ts
  export function selectFortunaFixtures(listing: FortunaFixturesResponse | null | undefined): FortunaFixture[]; // fixtures ?? [], isValidFixture, listing order
  export function mapFortunaFixtureOffer(fixture: FortunaFixture, rawMarkets: FortunaMarket[], league: string): FullMatchOffer | null;
  // null when rawMarkets is empty or parseAllMarkets yields nothing; logs "[Fortuna/FullOffer] <home> vs <away>: N markets"
  // (raw names, moved verbatim from index.ts:322-324); scrapedAt = new Date()
  ```

- [ ] **Step 1: Write the failing test**

```ts
const fx = (n: string) => readFileSync(new URL(`./fixtures/http-migration/${n}`, import.meta.url), "utf8");
const LISTING_URL = "https://api.efortuna.pl/offer/structure/api/v1_0/prematch/tournament/ufo:tour:00-03m/fixtures";
const MARKETS_URL = (id: string) => `https://api.efortuna.pl/offer/markets/api/v1_0/fixture/${id}/markets`;
const ROUTES: ReplayRoutes = {
  [LISTING_URL]: { body: fx("fixtures-premier-league.json") },
  [MARKETS_URL("ufo:mtch:1xi-0a1")]: { body: fx("markets-arsenal-hull.json") },  // Arsenal–Hull: full offer
  [MARKETS_URL("ufo:mtch:1xi-09z")]: { body: "[]" },                              // Leeds–Tottenham: no offer
  [MARKETS_URL("ufo:mtch:1xi-0a0")]: { status: 500, body: "upstream" },           // Fulham–Newcastle: failure
};
const LISTING = JSON.parse(fx("fixtures-premier-league.json")) as FortunaFixturesResponse;
const ARSENAL = LISTING.fixtures.find((f) => f.id === "ufo:mtch:1xi-0a1")!;
const ARSENAL_MARKETS = JSON.parse(fx("markets-arsenal-hull.json")) as FortunaMarket[];
const ARSENAL_ENVELOPE = { matchId: "ufo:mtch:1xi-0a1", bookmaker: "fortuna", homeTeam: "Arsenal", awayTeam: "Hull City",
  eventUrl: "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/arsenal-hull-ufo:mtch:1xi-0a1", startTime: "2026-11-07T15:00:00.000Z" };
const parsedArsenal = () => parseAllMarkets(ARSENAL_MARKETS, { homeTeam: "Arsenal", awayTeam: "Hull" });

describe("fortuna browser path (characterization, recorded 2026-11-07)", () => {
  it("returns Arsenal–Hull only: Leeds has no markets, Fulham's markets call fails", async () => {
    const { result, requests } = await runBrowserPathOffline(new FortunaPlaywrightScraper(), "premier-league", ROUTES);
    expect(result.success).toBe(true);
    expect(result.matches.map(envelope)).toEqual([ARSENAL_ENVELOPE]);
    expect(result.matches[0].markets).toEqual(parsedArsenal());
    expect(requests.filter((u) => !u.endsWith("/overview"))).toEqual(
      [LISTING_URL, MARKETS_URL("ufo:mtch:1xi-0a0"), MARKETS_URL("ufo:mtch:1xi-0a1"), MARKETS_URL("ufo:mtch:1xi-09z")]);
  });
});
describe("fortuna full-offer mapping", () => {
  it("maps Arsenal–Hull to the characterized envelope and parser output", () => {
    const offer = mapFortunaFixtureOffer(ARSENAL, ARSENAL_MARKETS, "premier-league")!;
    expect(envelope(offer)).toEqual(ARSENAL_ENVELOPE);
    expect(offer.markets).toEqual(parsedArsenal());
  });
  it("returns null for a fixture without markets", () => expect(mapFortunaFixtureOffer(ARSENAL, [], "premier-league")).toBeNull());
  it("keeps valid fixtures in listing order", () =>
    expect(selectFortunaFixtures(LISTING).map((f) => f.id)).toEqual(["ufo:mtch:1xi-0a0", "ufo:mtch:1xi-0a1", "ufo:mtch:1xi-09z"]));
  it("drops a fixture without team names", () => // synthetic
    expect(selectFortunaFixtures({ fixtures: [{ ...ARSENAL, participants: [], name: "" }] })).toEqual([]));
  it("logs the per-match line with the raw team names", async () => {
    const { logs } = await captureLogs(async () => mapFortunaFixtureOffer(ARSENAL, ARSENAL_MARKETS, "premier-league"));
    expect(logs).toEqual([`[Fortuna/FullOffer] Arsenal vs Hull: ${parsedArsenal().length} markets`]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails** — `$H npx vitest run src/scrapers/bookmakers/fortuna/__tests__/http-migration.test.ts`. Run it twice:
  1. With only the characterization block written: it **passes** on the unmodified tree. This is the "before" record.
  2. With the mapping block and its import added: the file fails to load with `Cannot find module '../full-offer-mapping.js'`.
- [ ] **Step 3: Implement `selectFortunaFixtures` and `mapFortunaFixtureOffer` in `full-offer-mapping.ts`.**
  - Move `index.ts:306-325` verbatim.
  - The loop at `:300` iterates `selectFortunaFixtures(leagueData)` and pushes the non-null results.
  - The empty-listing check (`:283-292`), the `try/catch` and `delay(API_REQUEST_DELAY)` stay.
- [ ] **Step 4: Run it and confirm it passes** — same command → all pass, with the characterization block unchanged in `git diff`. Then `$H npx vitest run src/scrapers/bookmakers/fortuna src/services/normalization/__tests__/golden.test.ts src/utils/__tests__/team-matcher-fortuna-labels.test.ts`, `$H npx tsc --noEmit` and `$H npx vitest run` → green.
- [ ] **Step 5: Commit** — `git add src/scrapers/bookmakers/fortuna/full-offer-mapping.ts src/scrapers/bookmakers/fortuna/index.ts src/scrapers/bookmakers/fortuna/__tests__/ && git commit -m "refactor(fortuna): extract the full-offer mapping from the browser path"`

---

### Task 2: Fortuna — `FortunaHttpScraper` and the contract test (parity step 2)

**Files:**
- Create: `src/scrapers/bookmakers/fortuna/http-scraper.ts`
- Modify: `src/scrapers/bookmakers/fortuna/navigation.ts` (append the two URL builders after `:293`)
- Test: `src/scrapers/bookmakers/fortuna/__tests__/http-migration.test.ts`

**Interfaces:**
- Consumes, from plan 02:
  - `HttpScraper`. Its template:
    - an unknown league fails;
    - a thrown error becomes `success:false, error: e.message`;
    - `n` skips out of `m = matches + n` give `` `${n} of ${m} details failed | ${skipped[0].error}` ``, `success:false` when `n/m > 0.5` and `true` otherwise;
    - it implements `transportStats()`.
  - `HttpClient.getJson<T>(url, { signal })`.
  - `fetchDetailsSkippingFailures(events, idOf, fetchDetail, { concurrency: 4, budget })`, results in input order.
  - `createReplayHttpClient` (tests).
- Consumes, from plan 03: `withChallengeHint(err, "fortuna")` (`src/scrapers/shared/rest-market/brand.ts`); fortuna is behind Cloudflare.
- Consumes, from Task 1 and constants: `selectFortunaFixtures`, `mapFortunaFixtureOffer`, `TOURNAMENT_IDS` (`constants.ts:46-53`).
- Produces:
  ```ts
  export function fortunaFixturesUrl(tournamentId: string): string;   // `${API_STRUCTURE_URL}/prematch/tournament/${id}/fixtures`
  export function fortunaFixtureMarketsUrl(fixtureId: string): string; // `${API_MARKETS_URL}/fixture/${id}/markets`
  export class FortunaHttpScraper extends HttpScraper {
    readonly bookmaker: PolishBookmaker = "fortuna";
    readonly transport = "http" as const;   // README §3 / plan 07 DeclaresTransport
    constructor(http?: HttpClient);
  }
  ```
- `fetchFullOffer`:
  - Listing and detail errors are rethrown through `withChallengeHint`.
  - A listing body without a `fixtures` array throws `` `fetch unexpected payload ${url}` `` (malformed envelope → `success:false`).
  - An empty `fixtures` array logs `` console.warn(`[Fortuna/FullOffer] No fixtures found from API ${url}`) `` and returns `{ matches: [], skipped: [] }`, which is `success:true` (README §3 empty-listing rule).
  - A non-array markets body throws `` `fetch unexpected payload ${url}` `` inside `fetchDetail`, so that fixture is skipped.
  - The `Found …` and `Completed: …` lines are logged as on the browser path.
  - **No `/markets/overview` request.**

- [ ] **Step 1: Write the failing test** (appended; `fullOfferLines = (l: string[]) => l.filter((s) => s.startsWith("[Fortuna/FullOffer]"))`)

```ts
describe("FortunaHttpScraper", () => {
  const run = (routes: ReplayRoutes) => new FortunaHttpScraper(createReplayHttpClient(routes)).scrapeFullOffer("premier-league");
  it("URL builders reproduce the browser URLs byte for byte", () => {
    expect(fortunaFixturesUrl("ufo:tour:00-03m")).toBe(LISTING_URL);
    expect(fortunaFixtureMarketsUrl("ufo:mtch:1xi-0a1")).toBe(MARKETS_URL("ufo:mtch:1xi-0a1"));
  });
  it("declares transport http", () => expect(new FortunaHttpScraper().transport).toBe("http"));
  it("contract: deep-equals the browser path; the failed fixture is reported, not dropped silently", async () => {
    const old = await runBrowserPathOffline(new FortunaPlaywrightScraper(), "premier-league", ROUTES);
    const client = createReplayHttpClient(ROUTES);
    const { value: neu, logs } = await captureLogs(() => new FortunaHttpScraper(client).scrapeFullOffer("premier-league"));
    expect(neu).toMatchObject({ success: true, error: `1 of 2 details failed | fetch HTTP 500 ${MARKETS_URL("ufo:mtch:1xi-0a0")}` });
    expect(neu.matches).toHaveLength(1);
    expect(stripScrapedAt(neu.matches)).toEqual(stripScrapedAt(old.result.matches));
    expect(client.calls.filter((u) => !old.requests.includes(u))).toEqual([]);
    expect(client.calls.some((u) => u.endsWith("/markets/overview"))).toBe(false);
    expect(fullOfferLines(logs)).toEqual(fullOfferLines(old.logs));
  });
  it("never acquires a browser", async () => {
    const acquire = vi.spyOn(browserPool, "acquire");
    await run(ROUTES);
    expect(acquire).not.toHaveBeenCalled();
  });
  it("fails with the first cause when more than half the details fail", async () =>
    expect(await run({ ...ROUTES, [MARKETS_URL("ufo:mtch:1xi-0a1")]: { status: 500, body: "upstream" } }))
      .toMatchObject({ success: false, matches: [], error: `2 of 2 details failed | fetch HTTP 500 ${MARKETS_URL("ufo:mtch:1xi-0a0")}` }));
  it("a listing HTTP error becomes the result error", async () =>
    expect(await run({ ...ROUTES, [LISTING_URL]: { status: 404, body: "nf" } })).toMatchObject({ success: false, error: `fetch HTTP 404 ${LISTING_URL}` }));
  it("a challenged listing names SCRAPER_TRANSPORT_FORTUNA", async () =>
    expect((await run({ ...ROUTES, [LISTING_URL]: { status: 403, body: "<html>", contentType: "text/html" } })).error)
      .toBe(`fetch HTTP 403 ${LISTING_URL} | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_FORTUNA=browser`));
  it("an empty listing is success:true with no matches and no detail request (README §3)", async () => {
    const client = createReplayHttpClient({ ...ROUTES, [LISTING_URL]: { body: '{"fixtures":[]}' } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await new FortunaHttpScraper(client).scrapeFullOffer("premier-league")).toMatchObject({ success: true, matches: [] });
    expect(client.calls).toEqual([LISTING_URL]);
    expect(warn).toHaveBeenCalledWith(`[Fortuna/FullOffer] No fixtures found from API ${LISTING_URL}`);
  });
  it("a malformed listing (no fixtures array) fails", async () =>
    expect(await run({ ...ROUTES, [LISTING_URL]: { body: '{"error":"x"}' } })).toMatchObject({ success: false, error: `fetch unexpected payload ${LISTING_URL}` }));
  it("wrong shape: a 200 that is not an array is skipped, never an empty offer", async () =>
    expect(await run({ ...ROUTES, [MARKETS_URL("ufo:mtch:1xi-0a1")]: { body: '{"error":"x"}' }, [MARKETS_URL("ufo:mtch:1xi-0a0")]: { body: "[]" } }))
      .toMatchObject({ success: false, error: `1 of 1 details failed | fetch unexpected payload ${MARKETS_URL("ufo:mtch:1xi-0a1")}` }));
});
```

- [ ] **Step 2: Run it and confirm it fails** — same test file → it fails to load: `Cannot find module '../http-scraper.js'`.
- [ ] **Step 3: Implement `FortunaHttpScraper` in `http-scraper.ts`** and the two builders in `navigation.ts`. `isLeagueSupported` delegates to `config/leagues.ts:178`.
- [ ] **Step 4: Run it and confirm it passes** — same file → all pass; `$H npx tsc --noEmit` exit 0; `$H npx vitest run` green.
- [ ] **Step 5: Commit** — `git add src/scrapers/bookmakers/fortuna/http-scraper.ts src/scrapers/bookmakers/fortuna/navigation.ts src/scrapers/bookmakers/fortuna/__tests__/http-migration.test.ts && git commit -m "feat(fortuna): browserless HTTP full-offer scraper"`

---

### Task 3: Fortuna — switch the transport, keep the browser fallback

**Files:**
- Modify `src/scrapers/bookmakers/fortuna/index.ts`: rename the class at `:45` to `FortunaBrowserScraper`, delete the instance at `:358`, and add `export { FortunaHttpScraper } from "./http-scraper.js"`.
- Modify `src/scrapers/bookmakers/index.ts:21` to pick the class and export `FortunaBrowserScraper` and `FortunaHttpScraper`:
  ```ts
  export const fortunaScraper: FullOfferScraper = getTransportOverride("fortuna") === "browser" ? new FortunaBrowserScraper() : new FortunaHttpScraper();
  ```
- Repoint the importers to `…/scrapers/bookmakers/index.js`: `src/services/audit/bookmaker-registry.ts:4`, `scripts/fortuna-prep-audit.ts:17`, `scripts/fortuna-market-discovery.ts:14`.
- In `scripts/test-scrapers.sh:30,333,388`, rename `FortunaPlaywrightScraper` to `FortunaBrowserScraper`, as plan 03 does for its brands.
- Retype `src/scripts/analyze-bookmaker-markets.ts:36,41` to `FullOfferScraper`, unless plan 03 already did.
- Test: one row in `src/scrapers/bookmakers/__tests__/transport-selection.test.ts` (plan 03 Task 3). Rename the old class import in `fortuna/__tests__/http-migration.test.ts`.

**Interfaces:**
- Consumes: `getTransportOverride(bookmaker, env?)` (`src/config/transport.ts`, plan 02 Task 7), `FullOfferScraper` (`src/scrapers/shared/scraper-contract.ts`), and plan 02 Task 6's `Record<PolishBookmaker, FullOfferScraper>` aggregator typing.
- Produces: `fortunaScraper: FullOfferScraper`, exported from `src/scrapers/bookmakers/index.ts`. `fortuna/index.ts` no longer exports an instance.

- [ ] **Step 1: Write the failing test**

```ts
// transport-selection.test.ts: add to plan 03's it.each table
["fortuna", "SCRAPER_TRANSPORT_FORTUNA", "fortunaScraper", "FortunaHttpScraper", "FortunaBrowserScraper"],
// and, in the same file:
it("the audit registry audits the selected fortuna instance", async () => {
  const m = await import("../index.js");
  const reg = await import("../../../services/audit/bookmaker-registry.js");
  expect(reg.getBookmakerAuditTargets("fortuna")!.scraper).toBe(m.fortunaScraper);
});
```

- [ ] **Step 2: Run it and confirm it fails** — `$H npx vitest run src/scrapers/bookmakers/__tests__/transport-selection.test.ts` → the fortuna row fails (`m.FortunaHttpScraper` is undefined), and the registry test fails (different instances).
- [ ] **Step 3: Implement** the rename, the pick and the importer changes listed under Files.
- [ ] **Step 4: Run it and confirm it passes**:
  - This file and `fortuna/__tests__/http-migration.test.ts` pass; `$H npx tsc --noEmit` and `$H npx vitest run` → green.
  - Scripts type-check on `scripts/fortuna-prep-audit.ts scripts/fortuna-market-discovery.ts` → exit 0.
  - `grep -rn "FortunaPlaywrightScraper\|bookmakers/fortuna/index.js" src scripts` → no output.
- [ ] **Step 5: Commit** — `git add src/scrapers scripts/fortuna-prep-audit.ts scripts/fortuna-market-discovery.ts scripts/test-scrapers.sh src/services/audit/bookmaker-registry.ts src/scripts/analyze-bookmaker-markets.ts && git commit -m "feat(fortuna): browserless full offer; browser path behind SCRAPER_TRANSPORT_FORTUNA"`

---

### Task 4: Fortuna — live parity gate (no code)

Precondition: fortuna.md Task 7 recorded `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/smoke-after-fix-fortuna.txt`, so its before/after comparison never mixes transports. `S=.scratch/perf-smoke` (in the worktree; never `$P`).

- [ ] **Step 1: Run the browser path and the HTTP path in the same window, before merging** (implementer, from the worktree, HH:12–HH:28 or HH:32–HH:50; both runs are dry):
  ```bash
  mkdir -p $S
  SCRAPER_TRANSPORT_FORTUNA=browser $H --live npx tsx scripts/perf-smoke.ts --bookmaker fortuna --out $S/fortuna-browser-04.json
  $H --live npx tsx scripts/perf-smoke.ts --bookmaker fortuna --out $S/fortuna-http-04.json --baseline $S/fortuna-browser-04.json
  ```
  Pass:
  - Both commands exit 0.
  - The second prints `PARITY` with `"matchesEqual":true` and `"pass":true`: equal matches (19 on 2026-11-07), and markets/selections within ±2 % of the same-hour browser run. The 2026-11-07 figures, ≈ 12 345 / 22 846, predate fortuna.md's new mappings and are context only.
  - The HTTP summary has:
    - `scraperClass` `FortunaHttpScraper` and `memory.chromiumProcessesEver` 0;
    - `wallMs` ≤ 5 000 (browser alone 13 412; target 1–3 s);
    - `transport.http.requests` ≤ 25 (1 listing + 19 details + retries) and `transport.http.failures` ≤ 1.
- [ ] **Step 2: Merge** (owner; never HH:55–HH:10). The service restarts once.
- [ ] **Step 3: A10 on the first scheduled run after the merge** (owner, deferred; the implementer copies the command and bound into the task report).
  - `grep -E '^\[Aggregator/FullOffer\] fortuna (success|partial):' "$LOG" | tail -1 | grep -oE '([0-9]+) saved'` → ≥ **9 673** saved. `$LOG` is the backend's log with colours stripped, and the bound is 0.75 × run-2's 12 897 (`RUN2_OK` in `src/__tests__/helpers/run-fixtures.ts`).
  - The line format is `[Aggregator/FullOffer] <bm> <status>: N matches, M markets found, K saved[ - err]`.
  - Once the owner has applied migration 11, `select status, markets_saved, error_message from scraper_runs where bookmaker = 'fortuna' and league_slug = 'premier-league' order by started_at desc limit 1` (read-only) meets the same bound, with `status` `success` or `partial`.
- [ ] **Step 4: Fallback** (owner): if Step 3 fails, set `SCRAPER_TRANSPORT_FORTUNA=browser` in the backend's `.env`, restart, and file the cause. The cause is the text after ` - ` on the `[Aggregator/FullOffer] fortuna <status>:` line, also in `scraper_runs.error_message` and `/api/health/scrapers` `lastError`.

---

### Task 5: Superbet — extract the full-offer mapping (parity step 1)

**Files:**
- Create: `src/scrapers/bookmakers/superbet/full-offer-mapping.ts`
- Modify: `src/scrapers/bookmakers/superbet/index.ts:269-308` (filter/sort and the loop body call the mapping)
- Test: `src/scrapers/bookmakers/superbet/__tests__/http-migration.test.ts`
- Fixtures: the listing keeps 4 of 19 events, reordered so that listing order differs from kickoff order; event `14438720` is copied as a **synthetic** FINISHED event. Each detail keeps the odds of its first 10 `marketId`s, skipping the bet-builder `231194` (446 odds, 965 KB):

  ```bash
  E=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence/sts-superbet/data
  F=src/scrapers/bookmakers/superbet/__tests__/fixtures/http-migration
  mkdir -p $F && $H python3 -I -c "
  import json,sys,copy
  src,out=sys.argv[1],sys.argv[2]
  bd=json.load(open(src+'/sb-bydate.json')); by={e['eventId']:e for e in bd['data']}
  fin=copy.deepcopy(by[14438720]); fin['metadata']={'status':'FINISHED','matchStatusLabel':'END'}; fin['marketCount']=1
  bd['data']=[by[14656301],by[14438716],by[14438722],fin]
  json.dump(bd,open(out+'/by-date-premier-league.json','w'),ensure_ascii=False,separators=(',',':'))
  for name,eid in (('sb-ev-14438716.json',14438716),('sb-ev-far.json',14656301)):
    d=json.load(open(src+'/'+name)); e=d['data'][0]; ids=[]
    for o in e['odds']:
      if o['marketId']!=231194 and o['marketId'] not in ids: ids.append(o['marketId'])
    keep=set(ids[:10]); e['odds']=[o for o in e['odds'] if o['marketId'] in keep]
    json.dump(d,open(out+'/event-%d.json'%eid,'w'),ensure_ascii=False,separators=(',',':'))
  " $E $F && wc -c $F/*.json
  ```
  Expected: `10346 by-date-premier-league.json`, `80796 event-14438716.json`, `37765 event-14656301.json`. These counts were re-run on 2026-11-13. On the future base, `isUpcomingOfferedEvent` at 2026-11-07T00:40Z keeps `[14438722, 14438716, 14656301]`, and the two details parse to 56 and 25 markets.

**Interfaces:**
- Consumes: `isUpcomingOfferedEvent`, `parseTeamNames`, `parseAllMarkets` (`superbet/parser.ts:545,30,419` on the future base); `buildEventUrl` (`navigation.ts:186`); plan 01's `toIsoStartTime` (Task 4) and `buildSuperbetListingUrl(tournamentIds: string, now?: Date)` (Task 5).
- Produces:
  ```ts
  export function selectUpcomingSuperbetEvents(events: readonly SuperbetEvent[], now: number): SuperbetEvent[]; // index.ts:269-272 verbatim
  export function mapSuperbetEventOffer(detail: SuperbetEventDetailResponse | null | undefined, league: string): FullMatchOffer | null;
  // data[0] or null; null when no markets; startTime = toIsoStartTime(fullEvent.unixDateMillis) (plan 01);
  // logs "[Superbet/FullOffer] <home> vs <away>: N markets" (index.ts:304-306)
  ```

- [ ] **Step 1: Write the failing test**

```ts
const CAPTURED_AT = new Date("2026-11-07T00:40:00Z");
const API = "https://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL";
const LISTING_URL = `${API}/events/by-date?offerState=prematch&startDate=2026-11-07+00:00:00&endDate=2027-02-05+00:00:00&sportId=5&tournamentIds=106`;
const DETAIL_URL = (id: number) => `${API}/events/${id}`;
const ROUTES: ReplayRoutes = {
  [LISTING_URL]: { body: fx("by-date-premier-league.json") },
  [DETAIL_URL(14438716)]: { body: fx("event-14438716.json") },   // Arsenal–Hull City (near-term)
  [DETAIL_URL(14656301)]: { body: fx("event-14656301.json") },   // Manchester City–Fulham (far)
  [DETAIL_URL(14438722)]: { status: 500, body: "upstream" },     // Leeds–Tottenham: failure
};
const EVENT = (id: number) => (JSON.parse(fx(`event-${id}.json`)) as SuperbetEventDetailResponse).data[0];
const parsed = (id: number) => parseAllMarkets(EVENT(id), parseTeamNames(EVENT(id).matchName));
const ENVELOPES = [
  { matchId: "14438716", bookmaker: "superbet", homeTeam: "Arsenal", awayTeam: "Hull City", startTime: "2026-11-07T15:00:00.000Z",
    eventUrl: "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/14438716" },
  { matchId: "14656301", bookmaker: "superbet", homeTeam: "Manchester City", awayTeam: "Fulham", startTime: "2026-11-21T12:30:00.000Z",
    eventUrl: "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/14656301" },
];
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: CAPTURED_AT }));
afterEach(() => vi.useRealTimers());

it("listing URL equals plan 01's builder output (literal '+' and ':')", () => expect(buildSuperbetListingUrl("106", CAPTURED_AT)).toBe(LISTING_URL));
it("browser path (characterization): kickoff order, finished event dropped, failed detail absent", async () => {
  const { result, requests } = await runBrowserPathOffline(new SuperbetPlaywrightScraper(), "premier-league", ROUTES);
  expect(result.success).toBe(true);
  expect(result.matches.map(envelope)).toEqual(ENVELOPES);
  expect(result.matches.map((m) => m.markets)).toEqual([parsed(14438716), parsed(14656301)]);
  expect(requests).toEqual([LISTING_URL, DETAIL_URL(14438722), DETAIL_URL(14438716), DETAIL_URL(14656301)]);
});
it("selectUpcomingSuperbetEvents filters finished and kicked-off events and sorts by kickoff", () => {
  const listing = (JSON.parse(fx("by-date-premier-league.json")) as SuperbetEventsResponse).data;
  expect(selectUpcomingSuperbetEvents(listing, CAPTURED_AT.getTime()).map((e) => e.eventId)).toEqual([14438722, 14438716, 14656301]);
  expect(selectUpcomingSuperbetEvents(listing, Date.parse("2026-11-07T13:00:00Z")).map((e) => e.eventId)).toEqual([14438716, 14656301]);
});
it("mapSuperbetEventOffer maps data[0] and returns null for no event", () => {
  expect(envelope(mapSuperbetEventOffer({ data: [EVENT(14438716)] }, "premier-league")!)).toEqual(ENVELOPES[0]);
  expect(mapSuperbetEventOffer({ data: [] }, "premier-league")).toBeNull();
  expect(mapSuperbetEventOffer(null, "premier-league")).toBeNull();
});
```

- [ ] **Step 2: Run it and confirm it fails** — `$H npx vitest run src/scrapers/bookmakers/superbet/__tests__/http-migration.test.ts`, in the two runs of Task 1 Step 2:
  1. The URL test and the characterization pass on the unmodified tree, which has plan 01. If there are 0 matches, plan 01 Task 5 is missing; if `startTime` is `undefined`, plan 01 Task 4 is missing (see Global Constraints).
  2. With the mapping blocks added, the file fails to load: `Cannot find module '../full-offer-mapping.js'`.
- [ ] **Step 3: Implement the two mapping functions.** `index.ts` keeps its `Found N events` and `N upcoming events…` logs and its empty-listing error (`:252-261`); the loop calls the mapping.
- [ ] **Step 4: Run it and confirm it passes** — the same file, plus `$H npx vitest run src/scrapers/bookmakers src/services/normalization/__tests__/golden.test.ts` (this includes plan 01's `full-offer-fixtures.test.ts`), plus `$H npx tsc --noEmit` and `$H npx vitest run`.
- [ ] **Step 5: Commit** — `git add src/scrapers/bookmakers/superbet/ && git commit -m "refactor(superbet): extract the full-offer mapping from the browser path"`

---

### Task 6: Superbet — `SuperbetHttpScraper` and the contract test (parity step 2)

**Files:**
- Create: `src/scrapers/bookmakers/superbet/http-scraper.ts`
- Modify: `src/scrapers/bookmakers/superbet/navigation.ts` (append `superbetEventDetailUrl`)
- Test: `src/scrapers/bookmakers/superbet/__tests__/http-migration.test.ts`

**Interfaces:**
- Consumes: as Task 2, except `withChallengeHint` (superbet is behind Fastly, not Cloudflare). Plus Task 5's functions, `buildSuperbetListingUrl` and `TOURNAMENT_IDS` (`constants.ts:36-50`).
- Produces: `superbetEventDetailUrl(eventId: number | string): string` (`` `${API_BASE_URL}/events/${eventId}` ``); `class SuperbetHttpScraper extends HttpScraper { readonly bookmaker: PolishBookmaker = "superbet"; readonly transport = "http" as const; constructor(http?: HttpClient) }`.
- `fetchFullOffer`:
  - Listing: `buildSuperbetListingUrl(TOURNAMENT_IDS[league].join(","), new Date())`.
    - A listing body without a `data` array throws `` `fetch unexpected payload ${url}` ``.
    - An empty `data` logs `` console.warn(`[Superbet/FullOffer] No events found from API ${url}`) `` and returns `{ matches: [], skipped: [] }`, which is `success:true` (README §3).
  - Events: `selectUpcomingSuperbetEvents(listing.data, Date.now())`.
  - Details: `fetchDetailsSkippingFailures` (concurrency 4, `idOf` = `String(eventId)`).
  - A body without a `data` array throws `` `fetch unexpected payload ${url}` ``. `{ data: [] }` is "no offer": the mapping returns null and nothing is skipped.
  - Logs are the browser path's.

- [ ] **Step 1: Write the failing test** — the cases of Task 2 with superbet values. In the base routes, Leeds fails, Arsenal and Man City succeed.

| Task 2 case | superbet value |
|---|---|
| URL builders | `superbetEventDetailUrl(14438716)` = `DETAIL_URL(14438716)` (the listing URL is pinned in Task 5) |
| transport | `new SuperbetHttpScraper().transport === "http"` |
| contract | old path `new SuperbetPlaywrightScraper()`; `neu` matches `{ success: true, error: \`1 of 3 details failed \| fetch HTTP 500 ${DETAIL_URL(14438722)}\` }`; length 2; `stripScrapedAt(neu.matches)` equals `stripScrapedAt(old.result.matches)`; calls ⊆ old requests; log lines with prefix `[Superbet/FullOffer]` equal |
| never acquires a browser | unchanged |
| more than half fail | also 500 for `DETAIL_URL(14438716)` → `{ success: false, error: \`2 of 3 details failed \| fetch HTTP 500 ${DETAIL_URL(14438722)}\` }` |
| listing HTTP error | 404 on `LISTING_URL` → `` `fetch HTTP 404 ${LISTING_URL}` `` |
| challenge hint | not applicable (drop) |
| empty listing | body `{"data":[]}` → `toMatchObject({ success: true, matches: [] })`, `client.calls` = `[LISTING_URL]`, warn `` `[Superbet/FullOffer] No events found from API ${LISTING_URL}` `` |
| malformed listing | body `{"error":"x"}` → `{ success: false, error: \`fetch unexpected payload ${LISTING_URL}\` }` |
| wrong shape | `{"error":"x"}` for `DETAIL_URL(14438716)` and `{"data":[]}` for `DETAIL_URL(14438722)` → `{ success: true, error: \`1 of 2 details failed \| fetch unexpected payload ${DETAIL_URL(14438716)}\` }`, `matchId`s `["14656301"]` |

plus:

```ts
it("keeps listing order when the first detail resolves last", async () => {
  const base = createReplayHttpClient(ROUTES);
  const slow: HttpClient = { stats: base.stats, getText: (u, o) => base.getText(u, o),
    getJson: async (u, o) => { if (u === DETAIL_URL(14438716)) await new Promise((r) => setTimeout(r, 50)); return base.getJson(u, o); } };
  const r = await new SuperbetHttpScraper(slow).scrapeFullOffer("premier-league");
  expect(r.matches.map((m) => m.matchId)).toEqual(["14438716", "14656301"]);
});
```

- [ ] **Step 2: Run it and confirm it fails** — same file (`$H npx vitest run …`) → it fails to load: `Cannot find module '../http-scraper.js'`.
- [ ] **Step 3: Implement `SuperbetHttpScraper` in `http-scraper.ts`** and `superbetEventDetailUrl`.
- [ ] **Step 4: Run it and confirm it passes** — same file; `$H npx tsc --noEmit`; `$H npx vitest run`.
- [ ] **Step 5: Commit** — `git add src/scrapers/bookmakers/superbet/ && git commit -m "feat(superbet): browserless HTTP full-offer scraper"`

---

### Task 7: Superbet — switch the transport, keep the browser fallback

**Files:**
- As Task 3, with superbet values:
  - `superbet/index.ts`: rename the class at `:46` to `SuperbetBrowserScraper`, delete the instance at `:340`, and re-export `SuperbetHttpScraper`.
  - Pick the class in `bookmakers/index.ts:8`.
  - Repoint the importers: `bookmaker-registry.ts:5`, `scripts/superbet-market-discovery.ts:14`, `scripts/superbet-prep-audit.ts:17`.
  - Rename the class in `scripts/test-scrapers.sh:36,336,391` and in plan 01's `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts`.
  - Retype `analyze-bookmaker-markets.ts` if still needed.
- Modify `src/types/scraper.ts:171`: delete `disableResourceBlocking: true`. Superbet intercepts nothing; it calls `fetch` in-page (SUPERBET-6).
- Test: `transport-selection.test.ts`.

**Interfaces:** as Task 3, for `superbetScraper: FullOfferScraper`. These already import from `bookmakers/index.js` and only call `scrapeFullOffer`/`cleanup`, so they follow the pick with no change: `src/scripts/{find-all-rynek,check-200-series,check-missing-high-freq,check-frequent-ids,debug-other-markets,debug-superbet-ids}.ts`, `scripts/match-audit-raw-capture.ts` and observability's `scripts/smoke-bookmaker.ts` (via `getScraper`).

- [ ] **Step 1: Write the failing test**:
  - Add the row `["superbet", "SCRAPER_TRANSPORT_SUPERBET", "superbetScraper", "SuperbetHttpScraper", "SuperbetBrowserScraper"]`.
  - Add Task 3's registry test with `"superbet"`.
  - Add `it("superbet no longer opts out of resource blocking", () => expect(DEFAULT_SCRAPER_CONFIGS.superbet.disableResourceBlocking).toBeUndefined());`.
- [ ] **Step 2: Run it and confirm it fails** — the row, the registry test and the flag test fail.
- [ ] **Step 3: Implement** the Files list.
- [ ] **Step 4: Run it and confirm it passes**:
  - `$H npx vitest run src/scrapers/bookmakers`, `$H npx tsc --noEmit` and `$H npx vitest run` → green.
  - Scripts type-check on `scripts/superbet-market-discovery.ts scripts/superbet-prep-audit.ts` → exit 0.
  - `grep -rn "SuperbetPlaywrightScraper\|bookmakers/superbet/index.js" src scripts` → no output.
- [ ] **Step 5: Commit** — `git add src/scrapers src/types/scraper.ts src/services/audit/bookmaker-registry.ts scripts/superbet-market-discovery.ts scripts/superbet-prep-audit.ts scripts/test-scrapers.sh src/scripts/analyze-bookmaker-markets.ts && git commit -m "feat(superbet): browserless full offer; browser path behind SCRAPER_TRANSPORT_SUPERBET"`

---

### Task 8: Superbet — live parity gate (no code)

- [ ] **Step 1** (implementer) — Task 4 Step 1 with `superbet`, `SCRAPER_TRANSPORT_SUPERBET=browser` and files `.scratch/perf-smoke/superbet-{browser,http}-04.json`. Pass:
  - Both commands exit 0, and `PARITY` has `"pass":true` (19 matches; ≈ 27 063 markets / 53 999 selections).
  - The HTTP summary has:
    - `scraperClass` `SuperbetHttpScraper` and `memory.chromiumProcessesEver` 0;
    - `wallMs` ≤ 5 000 (browser alone 17 010);
    - `transport.http.requests` ≤ 25 and `transport.http.failures` ≤ 1.
  - The HTTP run prints the same `[Superbet/FullOffer] Found N events` and `Completed: N matches` values as the browser run.
- [ ] **Step 2: Merge** (owner; never HH:55–HH:10).
- [ ] **Step 3: A10** (owner, deferred) — `grep -E '^\[Aggregator/FullOffer\] superbet (success|partial):' "$LOG" | tail -1 | grep -oE '([0-9]+) saved'` → ≥ **10 015** saved (0.75 × 13 353); `scraper_runs` as in Task 4 Step 3.
- [ ] **Step 4: Fallback** (owner) — `SCRAPER_TRANSPORT_SUPERBET=browser` as in Task 4 Step 4.

---

### Task 9: LVBet — extract the mapping and URL builders (parity step 1)

**Files:**
- Create: `src/scrapers/bookmakers/lvbet/full-offer-mapping.ts`
- Modify: `src/scrapers/bookmakers/lvbet/navigation.ts:59,90`: `fetchLeagueMatches` and `fetchMarketsForMatches` use the new builders.
- Modify: `src/scrapers/bookmakers/lvbet/index.ts:280-311`: the loop iterates `selectLvbetMatches` and calls the mapping.
- Test: `src/scrapers/bookmakers/lvbet/__tests__/http-migration.test.ts`
- Fixtures: 3 of 19 matches.
  - **Ipswich–Bournemouth** `bc:31340648`: the first 25 markets from `lv_mk3.json` (of 546), trimmed.
  - **Aston Villa–Sunderland** `bc:31419246`: the failure.
  - **Arsenal–Hull City** `bc:31333515`: the detail reuses the tracked recovery fixture `src/scrapers/bookmakers/lvbet/__tests__/fixtures/markets-search-arsenal-hull-2026-11-06.json`. It is a raw v5 `/markets/search` array (39 markets, 99 KB), already pinned by `lvbet/__tests__/parser.test.ts` and `lvbet-2026-11-recovery.test.ts`; no copy is made.

  `primary_column_markets` (154 entries, never read) is emptied.
  ```bash
  E=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence/lvbet-fuksiarz
  F=src/scrapers/bookmakers/lvbet/__tests__/fixtures/http-migration
  mkdir -p $F && $H python3 -I -c "
  import json,sys
  src,out=sys.argv[1],sys.argv[2]
  keep=['bc:31340648','bc:31333515','bc:31419246']
  cv=json.load(open(src+'/lv_comp.json')); cv['matches']=[m for m in cv['matches'] if m['match_id'] in keep]; cv['primary_column_markets']=[]
  json.dump(cv,open(out+'/competition-view-premier-league.json','w'),ensure_ascii=False,separators=(',',':'))
  mk=json.load(open(src+'/lv_mk3.json'))
  json.dump([m for m in mk if m['match_id']=='bc:31340648'][:25],open(out+'/markets-bc_31340648.json','w'),ensure_ascii=False,separators=(',',':'))
  " $E $F && wc -c $F/*.json
  ```
  Expected: `1708 competition-view-premier-league.json`, `32769 markets-bc_31340648.json`. These were run on the future base on 2026-11-13.
  - The listing order is Ipswich, Villa, Arsenal.
  - Ipswich parses to 25 markets and Arsenal–Hull to 72.
  - Canonical teams: `Ipswich Town`, `AFC Bournemouth`, `Arsenal`, `Hull City`.

**Interfaces:**
- Consumes: `isValidMatch`, `parseAllMarkets` (`lvbet/parser.ts:664,551` on the future base), `buildEventUrl` (`navigation.ts:175`), `API_BASE_URL` (`constants.ts:16`), `toIsoStartTime` (plan 01 Task 4).
- Produces:
  ```ts
  export function lvbetCompetitionViewUrl(tournamentId: number): string;          // `${API_BASE_URL}/matches/competition-view/?sports_groups_ids=${id}&lang=pl`
  export function lvbetMarketsSearchUrl(matchIds: readonly string[]): string;     // `${API_BASE_URL}/markets/search/?matches_ids=${ids.join(",")}&lang=pl`
  export function selectLvbetMatches(listing: LVBetCompetitionResponse | null | undefined): LVBetMatch[]; // matches ?? [], isValidMatch, listing order
  export function mapLvbetMatchOffer(match: LVBetMatch, rawMarkets: LVBetMarket[], league: string): FullMatchOffer | null;
  // index.ts:286-310 verbatim (startTime = toIsoStartTime(match.date) after plan 01), incl. the "[LVBet/FullOffer] <home> vs <away>: N markets" log
  ```

- [ ] **Step 1: Write the failing test**

```ts
const API = "https://offer.lvbet.pl/client-api/v5";
const LISTING_URL = `${API}/matches/competition-view/?sports_groups_ids=37685&lang=pl`;
const SEARCH_URL = (id: string) => `${API}/markets/search/?matches_ids=${id}&lang=pl`;
const ARSENAL_HULL_SEARCH = readFileSync(new URL("./fixtures/markets-search-arsenal-hull-2026-11-06.json", import.meta.url), "utf8"); // tracked recovery fixture
const ROUTES: ReplayRoutes = {
  [LISTING_URL]: { body: fx("competition-view-premier-league.json") },
  [SEARCH_URL("bc:31340648")]: { body: fx("markets-bc_31340648.json") },        // Ipswich Town–Bournemouth (trimmed)
  [SEARCH_URL("bc:31419246")]: { status: 500, body: '{"detail":"upstream"}' },  // Aston Villa–Sunderland: failure
  [SEARCH_URL("bc:31333515")]: { body: ARSENAL_HULL_SEARCH },                   // Arsenal–Hull City (recovery capture 2026-11-06)
};
const ENVELOPES = [
  { matchId: "bc:31340648", bookmaker: "lvbet", homeTeam: "Ipswich Town", awayTeam: "AFC Bournemouth", startTime: "2026-11-08T14:00:00.000Z",
    eventUrl: "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/premier-league/ipswichtownvsbournemouth/--/1/35148/37685/bc:31340648/" },
  { matchId: "bc:31333515", bookmaker: "lvbet", homeTeam: "Arsenal", awayTeam: "Hull City", startTime: "2026-11-07T15:00:00.000Z",
    eventUrl: "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/premier-league/arsenalvshullcity/--/1/35148/37685/bc:31333515/" },
]; // startTime from `date` "2026-11-08T14:00:00+00:00" / "2026-11-07T15:00:00+00:00" via toIsoStartTime (plan 01 Task 4)
const MARKETS = (id: string) =>
  JSON.parse(id === "bc:31333515" ? ARSENAL_HULL_SEARCH : fx(`markets-${id.replace(":", "_")}.json`)) as LVBetMarket[];
const CV = () => JSON.parse(fx("competition-view-premier-league.json")) as LVBetCompetitionResponse;

it("browser path (characterization): two offers in listing order, failed match absent", async () => {
  const { result, requests } = await runBrowserPathOffline(new LVBetPlaywrightScraper(), "premier-league", ROUTES);
  expect(result.success).toBe(true);
  expect(result.matches.map(envelope)).toEqual(ENVELOPES);
  expect(result.matches[0].markets).toEqual(parseAllMarkets(MARKETS("bc:31340648"), { homeTeam: "Ipswich Town", awayTeam: "Bournemouth" }));
  expect(result.matches[1].markets).toEqual(parseAllMarkets(MARKETS("bc:31333515"), { homeTeam: "Arsenal", awayTeam: "Hull City" }));
  expect(requests).toEqual([LISTING_URL, SEARCH_URL("bc:31340648"), SEARCH_URL("bc:31419246"), SEARCH_URL("bc:31333515")]);
});
it("builds URLs with a raw 'bc:' and comma-joined ids", () => {
  expect(lvbetCompetitionViewUrl(37685)).toBe(LISTING_URL);
  expect(lvbetMarketsSearchUrl(["bc:31340648"])).toBe(SEARCH_URL("bc:31340648"));
  expect(lvbetMarketsSearchUrl(["bc:1", "bc:2"])).toBe(`${API}/markets/search/?matches_ids=bc:1,bc:2&lang=pl`);
});
it("selectLvbetMatches keeps valid matches in listing order", () => {
  expect(selectLvbetMatches(CV()).map((m) => m.match_id)).toEqual(["bc:31340648", "bc:31419246", "bc:31333515"]);
  expect(selectLvbetMatches({ matches: [{ match_id: "bc:1", home: [], away: ["X"] }] })).toEqual([]); // synthetic
});
it("mapLvbetMatchOffer maps Ipswich and returns null without markets", () => {
  expect(envelope(mapLvbetMatchOffer(CV().matches![0], MARKETS("bc:31340648"), "premier-league")!)).toEqual(ENVELOPES[0]);
  expect(mapLvbetMatchOffer(CV().matches![0], [], "premier-league")).toBeNull();
});
```

- [ ] **Step 2: Run it and confirm it fails** — `$H npx vitest run src/scrapers/bookmakers/lvbet/__tests__/http-migration.test.ts`, in the two runs of Task 1 Step 2:
  1. The characterization block alone passes on the unmodified tree, which has plan 01 Task 4. If `startTime` is `undefined`, see Global Constraints.
  2. With the other blocks added, the file fails to load (`full-offer-mapping.js` missing; builders not exported).
- [ ] **Step 3: Implement** the builders (the old navigation uses them) and the two mapping functions. The browser path's empty-listing error at `index.ts:264-273` stays.
- [ ] **Step 4: Run it and confirm it passes** — the same file, plus `$H npx vitest run src/scrapers/bookmakers src/services/normalization/bookmakers/__tests__/lvbet-audit-fixes.test.ts src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts src/services/normalization/__tests__/golden.test.ts`, plus `$H npx tsc --noEmit` and `$H npx vitest run`.
- [ ] **Step 5: Commit** — `git add src/scrapers/bookmakers/lvbet/ && git commit -m "refactor(lvbet): extract the full-offer mapping and URL builders"`

---

### Task 10: LVBet — `LVBetHttpScraper` and the contract test (parity step 2)

**Files:**
- Create: `src/scrapers/bookmakers/lvbet/http-scraper.ts`
- Test: `src/scrapers/bookmakers/lvbet/__tests__/http-migration.test.ts`

**Interfaces:**
- Consumes: as Task 6, plus Task 9's functions and `TOURNAMENT_IDS` (`constants.ts:22-29`).
- Produces: `class LVBetHttpScraper extends HttpScraper { readonly bookmaker: PolishBookmaker = "lvbet"; readonly transport = "http" as const; constructor(http?: HttpClient) }`.
- `fetchFullOffer`:
  - A listing body without a `matches` array throws `` `fetch unexpected payload ${url}` ``.
  - An empty `matches` logs `` console.warn(`[LVBet/FullOffer] No matches found from API ${url}`) `` and returns `{ matches: [], skipped: [] }`, which is `success:true` (README §3).
  - Details: `lvbetMarketsSearchUrl([match_id])`, at concurrency 4, with `idOf` = `match_id`.
  - A non-array body throws `` `fetch unexpected payload ${url}` ``.
  - Every body is consumed, so nothing is retained (LVBET-4).
  - Logs are the browser path's.

- [ ] **Step 1: Write the failing test** — Task 6's table with lvbet values, plus its order test. In the order test, delay `SEARCH_URL("bc:31340648")` and expect `["bc:31340648", "bc:31333515"]`.

| Task 6 case | lvbet value |
|---|---|
| URL builders | pinned in Task 9; the contract also asserts `client.calls.every((u) => !u.includes("%3A"))` |
| transport | `new LVBetHttpScraper().transport === "http"` |
| contract | old path `new LVBetPlaywrightScraper()`; `{ success: true, error: \`1 of 3 details failed \| fetch HTTP 500 ${SEARCH_URL("bc:31419246")}\` }`; length 2; `stripScrapedAt` deep-equal on `matches`; log prefix `[LVBet/FullOffer]` |
| more than half fail | also 500 for `SEARCH_URL("bc:31340648")` → `{ success: false, error: \`2 of 3 details failed \| fetch HTTP 500 ${SEARCH_URL("bc:31340648")}\` }` |
| listing HTTP error | 503 on `LISTING_URL` → `` `fetch HTTP 503 ${LISTING_URL}` `` |
| empty listing | `{"matches":[]}` → `toMatchObject({ success: true, matches: [] })`, `client.calls` = `[LISTING_URL]`, warn `` `[LVBet/FullOffer] No matches found from API ${LISTING_URL}` `` |
| malformed listing | `{"detail":"x"}` on `LISTING_URL` → `{ success: false, error: \`fetch unexpected payload ${LISTING_URL}\` }` |
| wrong shape | `{"detail":"x"}` (200) for `SEARCH_URL("bc:31340648")` → `{ success: false, error: \`2 of 3 details failed \| fetch unexpected payload ${SEARCH_URL("bc:31340648")}\` }`. Ipswich is first in input order; Villa's 500 is the second skip. |

- [ ] **Step 2: Run it and confirm it fails** — the file (`$H npx vitest run …`) fails to load: `Cannot find module '../http-scraper.js'`.
- [ ] **Step 3: Implement `LVBetHttpScraper` in `http-scraper.ts`.**
- [ ] **Step 4: Run it and confirm it passes** — same file; `$H npx tsc --noEmit`; `$H npx vitest run`.
- [ ] **Step 5: Commit** — `git add src/scrapers/bookmakers/lvbet/ && git commit -m "feat(lvbet): browserless HTTP full-offer scraper"`

---

### Task 11: LVBet — switch the transport, keep the browser fallback

**Files:**
- As Task 3, with lvbet values:
  - `lvbet/index.ts`: rename the class at `:44` to `LVBetBrowserScraper`, delete the instance at `:343`, and re-export `LVBetHttpScraper`.
  - Pick the class in `bookmakers/index.ts:20`.
  - Repoint the importers: `bookmaker-registry.ts:6`, `scripts/lvbet-market-discovery.ts:14`, `scripts/lvbet-prep-audit.ts:17` (lvbet.md Task 5 runs this script; only its import changes).
  - Rename the class in `scripts/test-scrapers.sh:33,334,389` and in plan 01's `full-offer-fixtures.test.ts`.
  - Retype `analyze-bookmaker-markets.ts` if still needed.
- Test: `transport-selection.test.ts`.

**Interfaces:** as Task 3, for `lvbetScraper: FullOfferScraper`.

- [ ] **Step 1: Write the failing test** — the row `["lvbet", "SCRAPER_TRANSPORT_LVBET", "lvbetScraper", "LVBetHttpScraper", "LVBetBrowserScraper"]`, plus the registry test of Task 3 with `"lvbet"`.
- [ ] **Step 2: Run it and confirm it fails** — the lvbet row and the registry test fail.
- [ ] **Step 3: Implement** the Files list.
- [ ] **Step 4: Run it and confirm it passes**:
  - `$H npx vitest run src/scrapers/bookmakers`, `$H npx tsc --noEmit` and `$H npx vitest run` → green.
  - Scripts type-check on `scripts/lvbet-market-discovery.ts scripts/lvbet-prep-audit.ts` → exit 0.
  - `grep -rn "LVBetPlaywrightScraper\|bookmakers/lvbet/index.js" src scripts` → no output.
- [ ] **Step 5: Commit** — `git add src/scrapers src/services/audit/bookmaker-registry.ts scripts/lvbet-market-discovery.ts scripts/lvbet-prep-audit.ts scripts/test-scrapers.sh src/scripts/analyze-bookmaker-markets.ts && git commit -m "feat(lvbet): browserless full offer; browser path behind SCRAPER_TRANSPORT_LVBET"`

---

### Task 12: LVBet — live parity gate (no code)

- [ ] **Step 1** (implementer) — Task 4 Step 1 with `lvbet`, `SCRAPER_TRANSPORT_LVBET=browser` and files `.scratch/perf-smoke/lvbet-{browser,http}-04.json`. Pass:
  - Both commands exit 0, and `PARITY` has `"pass":true` (19 matches; ≈ 9 054 markets / 63 016 selections).
  - The HTTP summary has:
    - `scraperClass` `LVBetHttpScraper` and `memory.chromiumProcessesEver` 0;
    - `wallMs` ≤ 6 000 (browser alone 10 469; the extra second is for 19 uncompressed 1.37 MB bodies);
    - `transport.http.requests` ≤ 25 and `transport.http.failures` ≤ 1.
- [ ] **Step 2: Merge** (owner; never HH:55–HH:10).
- [ ] **Step 3: A10** (owner, deferred) — `grep -E '^\[Aggregator/FullOffer\] lvbet (success|partial):' "$LOG" | tail -1 | grep -oE '([0-9]+) saved'` → ≥ **7 071** saved (0.75 × 9 427); `scraper_runs` as in Task 4 Step 3.
- [ ] **Step 4: Fallback** (owner) — `SCRAPER_TRANSPORT_LVBET=browser` as in Task 4 Step 4.

---

## Self-Review

Re-run on 2026-11-13 against the future base.

1. **Spec coverage.**
   - §3 names are used verbatim, plus plan 02's refinements: input-order results, partial skips that succeed with an error text, `transportStats()`, and `replay-http: no route`. Also the 2026-11-13 §3 rules: one pick per bookmaker in `bookmakers/index.ts` with every importer repointed, the empty-listing rule, and `readonly transport = "http"`.
   - Parity pattern: extraction with a characterization test (Tasks 1, 5, 9), then the same mapping over HTTP with a contract test (Tasks 2, 6, 10). Browser results are compared on `matches` or with `toMatchObject`, because observability's recorder adds `diagnostics`.
   - Parity gate:
     - (1) the contract tests;
     - (2) perf-smoke `--baseline` with `PARITY pass`, run by the implementer into `.scratch/perf-smoke/` (Tasks 4, 8, 12);
     - (3) A10 at 9 673 / 10 015 / 7 071 on the `[Aggregator/FullOffer] <bm> (success|partial):` line. This is an owner check, deferred under EXECUTION rule 4.
   - Brief facts:
     - FORTUNA-3 is pinned by a Task 2 test.
     - The HTTP path makes no CDP clones.
     - LVBET-3/4 are handled by `HttpClient`.
     - The stale superbet flag goes in Task 7.
     - `endDate` and kickoff come from plan 01, not duplicated here.
     - The write-only caches are removed by plan 01 Task 3.
   - The trim commands were re-run on the future base. Their byte counts are stated, and the parsed-market counts were checked (fortuna 61, superbet 56/25, lvbet 25/72).
2. **Step scan.** No TBD. Every heavy command goes through `$H`. No step writes to the DB or into `$P`, and the merges and A10 checks are marked as owner steps.
   - Fixed during the first review:
     - fixture paths that were relative to a worktree with no `docs/superpowers/`;
     - Step 2 expectations that ignored that a missing import fails the whole file;
     - expectations that depended on whether plan 01 had landed (plan 01 is now a precondition, with literals from its tests);
     - a custom "Skipped" log line and protected-member test access, replaced by the template's error text.
   - Fixed in the 2026-11-13 revision:
     - the "if plan 03 has not landed" contradiction;
     - the satisfied lvbet clause;
     - the old `completed` grep;
     - the empty listing that failed the run;
     - the stale parser and `playwright-base.ts` anchors.
3. **Type consistency.**
   - Mapping signatures are identical in the old loop, the HTTP class and the tests.
   - `FullOfferScraper` is the instance type in all three wiring tasks.
   - The helpers are defined once (Task 0). `withoutScrapedAt` is the single per-offer stripper, `stripScrapedAt = (ms) => ms.map(withoutScrapedAt)`, and plan 03's path re-exports the moved names.
   - Error texts are shared: `fetch unexpected payload <url>` (wrong-shape detail and malformed listing), `No … found from API <url>` (empty-listing warning, as in plan 03), and the template's `n of m details failed | …`. The challenge hint applies to fortuna only.
4. **Review focus.** All five items are pinned in the owning tasks. Item 4 now expects `success:true` with no detail request, and a malformed listing still fails.
5. **Proportion.** About 13 lines of production logic move per brand, and each HTTP class is ~50 lines. The superbet and lvbet HTTP tasks reuse Task 2's cases by table. lvbet reuses a tracked recovery fixture instead of a third trimmed copy.

## Open Questions

1. **Automatic browser fallback on a challenge.** If Cloudflare (fortuna) or Fastly (superbet) starts answering Node with 403 or HTML, the HTTP path fails with `fetch HTTP 403 …`; for fortuna the message names `SCRAPER_TRANSPORT_FORTUNA=browser`. Should the scraper retry that run once through its browser class by itself? **Recommended default: no.** Keep the manual switch. Observability surfaces the cause on the first failed run, and a silent fallback would hide the Chromium cost this plan removes.
