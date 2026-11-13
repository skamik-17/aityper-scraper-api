# Rest-Market Family (etoto, forbet, fuksiarz, betfan) Browserless Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch the full offer of etoto, forbet, fuksiarz and betfan with Node HTTP instead of Chromium, through one shared module. A failed detail skips that match and never writes listing-only data.

**Architecture:** `src/scrapers/shared/rest-market/` holds a brand contract (`RestMarketBrand<E>`), a runner (listing, then `fetchDetailsSkippingFailures` at concurrency 4, then the brand mapping) and `RestMarketHttpScraper` on top of README §3 `HttpScraper`. Each brand first gets a pure `offer-mapping.ts` (listing event + detail → `FullMatchOffer`). The mapping is proven equal to today's browser output on recorded payloads, and the old class is switched to it. Then the HTTP path uses the same mapping. Parsers do not change. The old classes stay as `<Brand>BrowserScraper`, selected by `getTransportOverride` in `src/scrapers/bookmakers/index.ts`.

**Tech Stack:** TypeScript (ESM, Node 20), Vitest 4, plan 02's `HttpClient` / `HttpScraper` / `fetchDetailsSkippingFailures`, Playwright (fallback path only).

**Spec:** README §1.4, §1.5 (rows "Detail failure silently downgrades…" and "`start_time` never stored"), §2 principles 1 and 3, §3 (whole contract and "Parity pattern"), §5 step P4, §6 "Parity gate", §7 row "HTTP scrapers 6–17 s → 1–3 s". Evidence (`$E` = `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence`): `$E/forbet-etoto/` (`probe-http-run.mjs`, `et_list.json`, `et_detail.json`, `fb_list_major.json`, `fb_detail.json`, `*.hdr`, `home_www.etoto.pl.html`), `$E/lvbet-fuksiarz/fk_cat.json`, `fk_ev.json`, `fk_ev2.json`, `fk_*.hdr`, `$E/betfan-totalbet/bf-list-244.json`, `bf-ev-40932985.json`, `bf-par-*.json`, `bf-*.hdr`; `$E/findings-notes.md` (sections "betfan + totalbet", "forbet + etoto", "lvbet + fuksiarz").

> **Revision 2026-11-13:**
> - **Base moved** to the future base (`recovery/integration` ≥ `aaf7c07` + observability + fortuna). Branches start from `recovery/integration`, or from `master` after the owner's merge, under the recovery `EXECUTION.md` workspace rules: symlinked `node_modules`, a dead-port `.env`, `bin/heavy`, no server and no DB writes, and output in `.scratch/`. Merges and post-merge gates (Tasks 4/7/10/13 Steps 2–3) are deferred to the owner. Sources: `evidence/delta-audit-infra-2026-11-13.md` header and item 14; `evidence/delta-audit-transport-2026-11-13.md` "Cross-cutting".
> - **Brand gates.** forbet.md Task 1 (f167c46, with Task 2 3470eaf/82ee9f6) and fuksiarz.md Task 0 (fb29603) are already on integration, but their live acceptance is deferred. Each brand group therefore waits until its recovery live acceptance is recorded (delta audit "03").
> - **Empty listing rule** (README §3, cross-plan #38). HTTP 200 with a valid envelope and 0 events gives `success:true, matches:[]`, which observability classifies as `empty`. A malformed envelope stays a failure.
> - **`kickoffIso` removed** (cross-plan #16). Mappings import plan 01's `toIsoStartTime` from `src/scrapers/shared/start-time.ts`; Task 1 creates that file at the same path only if plan 01 Task 4 has not landed.
> - **Harness.** Tasks 3/6/9/12 rename the browser class in plan 01's `full-offer-fixtures.test.ts` (cross-plan #4). The fake page is an `EventEmitter` that observability's navigation recorder accepts, and browser-path results are compared on `matches` only, because the recorder adds `diagnostics`.
> - **Task 4 signals and contract.**
>   - The Cloudflare signal is `[Aggregator/FullOffer] etoto scrape_failed: … - <error>`, `scraper_runs.error_message` or `/api/health/scrapers` `lastError`. `[ScrapeRun]` carries no error text.
>   - A10 greps use `^\[Aggregator/FullOffer\] <bm> (success|partial):`.
>   - `RestMarketHttpScraper` declares `readonly transport = "http" as const`.
> - **Re-verified on the future base** (scratch merge, 2026-11-13).
>   - The four brands' `index.ts`/`navigation.ts` are byte-identical to master. Line refs moved only in `playwright-base.ts` (`initBrowser` `:93`, `delay` `:233`) and fuksiarz `isValidEvent` (`:461`).
>   - The fixture pins still hold: etoto 40/40/40, forbet 40/15/17, fuksiarz 291/30/83, betfan 37/36/38.
>   - The `CATEGORY_IDS` guard still holds for all 24 ids, `world-cup-2026` included.

## Global Constraints

- README §6 applies in full, including its 2026-11-13 workspace rules (recovery `EXECUTION.md`, which wins over anything below): `golden.test.ts` unchanged, the parity gate, and no attribution footers.
- **Workspace.** These variables are used throughout:
  ```bash
  R=/home/skamik/Documents/repositories/personal/aityper-scraper-api
  W=/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees
  H=$W/bin/heavy
  BM=etoto   # then forbet, fuksiarz, betfan
  git -C $R worktree add $W/perf-03-$BM -b perf/03-rest-market-$BM recovery/integration   # or master once the owner has merged integration
  ln -s $R/node_modules $W/perf-03-$BM/node_modules   # never npm install / npm ci
  cp $W/integration/.env $W/perf-03-$BM/.env          # Supabase on a dead port on purpose; never edit it
  ```
  - Paths are relative to the worktree.
  - Every `npx vitest`, `npx tsc`, `npx tsx` and `python3` command runs through `$H`; anything that calls a bookmaker uses `$H --live`. During TDD run only the scoped tests. At the end of each task run `$H npx vitest run` and `$H npx tsc --noEmit` once, green before the commit.
  - Before the first change, write the worktree's `$H npx vitest run` and golden counts to `.scratch/baseline.txt`; totals are always relative to it.
  - Commit after each task on the brand's branch only.
- This plan directory is untracked in the main checkout (README §8 Q11), so a worktree has no copy. Read evidence through the absolute `$E` (read-only). Write outputs only under the worktree's `.scratch/`, never into `$E` or anywhere else in the main checkout.
- **Branches.** In fixed order: `perf/03-rest-market-etoto` (Tasks 1–4), then `perf/03-rest-market-forbet` (5–7), `perf/03-rest-market-fuksiarz` (8–10), `perf/03-rest-market-betfan` (11–13). Create each only after the previous brand merged (owner) and its post-merge gate was recorded.
- **Preconditions:**
  - README §5.0 step R0 is done: observability is merged into `recovery/integration`. The browser path's recorder, the run outcomes and `scraper_runs` come from it.
  - Plan 02 is merged.
  - Plan 01 Task 4 is merged (`toIsoStartTime`). If not, Task 1 creates `start-time.ts` itself.
- **Per-brand gate: "recovery live acceptance recorded"** (EXECUTION rule 4 deferred these checks to the owner). The forbet group starts only after the owner recorded forbet.md's "After both tasks: live verification". That means `evidence/forbet/acceptance-check.py` reported seven `PASS` lines for the code of f167c46 + 3470eaf/82ee9f6.
  - The fuksiarz group starts only after the owner recorded fuksiarz.md's live Acceptance B for Task 0 (fb29603, `fuksiarz/parser.ts:160-198`).
  - Apply the same rule to etoto and betfan whenever their recovery acceptance is still pending.
  - None of these recovery changes touches this plan's files. The gate only keeps one change per live check.
- Detail concurrency is `REST_MARKET_DETAIL_CONCURRENCY = 4`. Timeout and retry are the `HttpClient` defaults (10 000 ms, 1 retry). No `delay`/`setTimeout` anywhere in `src/scrapers/shared/rest-market/`.
- Do not model the runner on the clients recovery built for totalbet (`totalbet/api-client.ts`) or betby (`shared/betby/http.ts`). They use 15–30 s timeouts, run sequentially, and totalbet falls back to listing 1X2 on a failed detail (`totalbet/index.ts:274-280`). Use plan 02's `HttpClient` only.
- Request URLs stay byte-identical to today's in-page fetches (table in Observations). That includes forbet's `?gamesClass=major`.
- No parser changes: `git diff recovery/integration --stat -- 'src/scrapers/bookmakers/*/parser.ts'` prints nothing on every branch.
- **Empty listing rule** (README §3). A 200 with a valid envelope and 0 events (or 0 match events) gives `success: true, matches: []`, which observability classifies as `empty`; owner A6 still counts it as a failure. A body without the events array is a failure (`listing without events <url>`), and so is any transport error.
- **Transport.** `RestMarketHttpScraper` declares `readonly transport = "http" as const` (README §3, plan 07's `DeclaresTransport`), and the four brand classes inherit it. Plan 02's `HttpScraper` already declares the same property; the explicit declaration keeps the class self-describing, and each brand's test pins it.
- **Partial runs.** Until plan 07 Task 0 lands the `partial` rule (README §5.0 F3; observability's `classifyBookmakerRun`, `run-outcome.ts:50-81`), a run with ≤ 50 % skipped details is classified `success`, and its `n of m details failed | …` cause does not reach the aggregator line. After F3 it is `partial`, with the cause after ` - `. The A10 greps accept both statuses.
- **Browser-path results.** Observability's recorder runs inside `executeFullOfferScrape` (`playwright-base.ts:353-391`). A failed or empty browser result therefore carries `diagnostics`, and its `error` may get `| <issues>` appended (`enrichFullOfferFailure`, `navigation-diagnostics.ts:247-258`). Tests compare browser results on `success` and `matches` only, never with `toEqual` on the whole result.
- Line numbers are on the future base. The four brands' `index.ts`/`navigation.ts`/`constants.ts` are byte-identical to master there. Plan 01 (P1, before this plan) removes the cache writes and fixes the kickoff in the same `scrapeFullOffer` bodies. When a number has moved, locate the code by the quoted snippet.
- **Live checks.** One bookmaker at a time, never between HH:55 and HH:10.
  - perf-smoke runs are dry (plan 02 forces a dead `SUPABASE_URL`), so the implementer runs them under `$H --live`.
  - Merges and post-merge gates are the owner's: the implementer records their commands and expected results in the task report.

## Review Focus

1. **Bot challenge on the listing** (403/503 with `cf-mitigated: challenge`, or 200 `text/html`). Expected: the run fails, no rows are written, and the error names the flag: `fetch HTTP 403 <url> | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser`. Pinned in Task 1 (`names the fallback flag …`, two tests) and Task 3.
2. **The detail envelope arrives without its event** (`{"code":404,…}` with HTTP 200, or betfan `{"isError":true,"data":null}`), for example an event withdrawn between listing and detail. Expected: the match is skipped with `detail without event data <url>`, and no listing fallback. Pinned in Task 1 (`skips a detail envelope without data`) and Task 12.
3. **Details resolve out of order under concurrency 4.** Expected: matches still come back in listing order, deep-equal to the sequential browser path. Pinned in Task 1 (`returns matches in listing order …`) and the contract tests in Tasks 3/6/9/12.
4. **The listing holds only pseudo-events, or no events at all** (etoto `Dzień meczowy 07.11 - 4 mecze`, `10. kolejka … - 10 meczów`; an off-season `data: []`). Expected: 0 detail requests, `success: true`, 0 matches (status `empty`, README §3 empty-listing rule), and no throw. A body without the events array is still a failure. Pinned in Task 1 (`an empty listing is success with no matches`, `a listing without the events array is an error`) and Task 3 (`listing of only combo events`).
5. **The fallback flag is read at module load.** `SCRAPER_TRANSPORT_<BM>=browser` must yield the `<Brand>BrowserScraper` singleton, and an unset or empty value the HTTP one. A change needs a restart. Pinned in Task 3 `transport-selection.test.ts`, which is extended in Tasks 6/9/12.

---

## Observations (pre-fix analysis)

Measured on master @ `377b47e` (2026-11-07). Code references re-verified on the future base on 2026-11-13: the four brands' `index.ts`, `navigation.ts`, `constants.ts` and `types.ts` are byte-identical to master; etoto, forbet and betfan `parser.ts` are too, while fuksiarz `parser.ts` changed (fuksiarz.md Task 0).

**One transport skeleton, four copies.** Each `scrapeFullOffer` does `page.goto(home, domcontentloaded)`, then an in-page listing `fetch`, then a sequential in-page detail `fetch` per event with `delay(100)`:
- etoto `index.ts:245-330`: `delay(500)` at `:261`, detail at `:284`.
- forbet `:258-341`: `delay(500)` at `:274`.
- fuksiarz `:219-305`: no 500 ms delay.
- betfan `:229-320`.

The listing and detail functions are in each `navigation.ts`: etoto `:55-105` and `:185-223`, forbet `:50-89` and `:153-185`, fuksiarz `:50-83` and `:140-171`, betfan `:50-81` and `:134-170`. None has a timeout. The fuksiarz and betfan listing helpers swallow every error into `[]`.

Costs:
- Alone: etoto 7.3 s, forbet 6.5 s, fuksiarz 6.5 s, betfan 9.3 s. Production averages are forbet 32 s and etoto 36 s at N=19 (`findings-notes.md`).
- Each run starts one Chromium per brand. Home pages: etoto 201 req / 5.2 MB, forbet 193 req / 4.5 MB, fuksiarz 160 req / 6.6 MB, betfan 69 req / 4.9 MB.
- Serializing one detail over CDP takes 181–305 ms, against 2.5 ms for `JSON.parse` in Node.

**No browser is needed [V].** `$E/forbet-etoto/probe-http-run.mjs` (Node `fetch`, UA + `Accept` only, c=3) loads the listing plus 6 details in 323 ms (forbet) and 201 ms (etoto). Fuksiarz and betfan answer the same way (`findings-notes.md`).
- Headers carry no session: only an `lsn=…` load-balancer cookie (`fb_detail.hdr`, `fk_ev.hdr`).
- Every host is `server: cloudflare`. `api.etoto.pl` returns `content-type: application/json` with no `cf-mitigated` (`et_list.hdr`).
- `www.etoto.pl` embeds Cloudflare's `challenge-platform/scripts/jsd/main.js` (`home_www.etoto.pl.html`), which is why etoto keeps a documented fallback.
- [I] The browser path fetches `api.etoto.pl` cross-origin from `www.etoto.pl` without credentials, so it is not proven to pass a challenge that blocks Node. It is still the transport that works today.

**Payload shapes (captured 2026-11-07 00:39–00:41Z):**

| brand | listing URL (PL category) | events at | detail URL | event at | filter | teams, `matchId`, `eventUrl` from | markets |
|---|---|---|---|---|---|---|---|
| etoto | `https://api.etoto.pl/rest/market/categories/multi/206/events` | `data[]` (20, one `Dzień meczowy 07.11 - 4 mecze`) | `https://api.etoto.pl/rest/market/events/{id}` | `data` (478 games vs 50 in listing) | `isValidEvent` incl. `isComboEvent` (`parser.ts:368-389`) | detail `eventName`/`eventId` | `parseAllMarkets(detail, teams)` |
| forbet | `https://www.iforbet.pl/rest/market/categories/multi/199/events?gamesClass=major` | `data[]` (19) | `https://www.iforbet.pl/rest/market/events/{id}` | `data` (491 vs 17) | `isValidEvent` (`parser.ts:327-335`) | detail | `parseAllMarkets(detail, teams)` |
| fuksiarz | `https://fuksiarz.pl/rest/market/categories/multi/625/events` | `data[]` (19) | `https://fuksiarz.pl/rest/market/events/{id}` | `data` (329 vs 30) | `isValidEvent` (`parser.ts:461-469`) | listing `eventName`/`eventId` | `parseAllMarkets(detail, teams)` |
| betfan | `https://betfan.pl/api/v1/market/categories/244/events` | `data.categories[0].events[]` (19) | `https://betfan.pl/api/v1/market/events/{id}` | `data.event` (240 vs 34) | `isValidEvent` (`parser.ts:446-453`) | listing `participants`/`eventId` | `parseAllMarkets(detail)` |

Every listing and detail event carries `eventStart` in epoch ms. Leeds–Tottenham is `1794054600000` = `2026-11-07T12:30:00.000Z` on all four. `gamesClass=major` is a no-op: `fb_list_all.json` and `fb_list_major.json` are byte-identical. The batch endpoint `/events/multi/a,b` returns only 2 games per event and is unusable.

**Silent downgrade [V].** When a detail fails, today's code builds the offer from listing data:
- etoto `index.ts:285` `detailData?.data || event`, forbet `:297`, fuksiarz `:260`, betfan `:285-299` (the "(fallback)" branch).
- A listing event has 17–50 games against 240–491 in the detail, and the per-match prune then deletes ~90 % of that match's snapshot for an hour.
- Reproduced offline by the plan writer: driving the unchanged `EtotoPlaywrightScraper` with a fake page and a 503 on detail 6224078 saves that match with 3 markets instead of 40. Betfan does the same with 3 instead of 36.

**`start_time` [V].** Read-only SQL on the 01:00Z run (2026-11-07) counts NULL `start_time` rows:

| brand | NULL / total | why |
|---|---|---|
| etoto | 6 080 / 6 080 | reads `fullEvent.startTime` (`index.ts:298`) |
| forbet | 5 531 / 5 531 | reads `eventStartTime` (`:314`) |
| betfan | 5 130 / 5 130 | reads `eventStartTime` (`:280`, `:295`) |
| fuksiarz | 0 / 5 751 | already maps `eventStart` (`index.ts:276-278`), with a seconds-vs-ms guard |

The stale type fields are `etoto/types.ts:53` `startTime?`, `forbet/types.ts:51` and `betfan/types.ts:63` `eventStartTime?`; their only readers are the lines above. All of these are unchanged on the future base. Plan 01 Task 4 (P1, before this plan) replaces them with `eventStart` and `toIsoStartTime(…)`, and the extracted mappings carry those statements. This plan owns the fix only if plan 01 Task 4 has not landed (Task 2 Step 3).

**Category ids are duplicated.** Each brand's `constants.ts` `CATEGORY_IDS` repeats the ids in `src/config/leagues.ts` (`LEAGUES` `:18-152`). All 24 values are equal, re-checked on the future base on 2026-11-13 with `world-cup-2026` included. The HTTP path reads `getBookmakerLeagueId` (`leagues.ts:162-168`) and `isLeagueSupported` (`:178`). The constants stay for the browser fallback until plan 10 deletes it, and Task 1 adds a guard test so the two copies cannot drift.

**Offline seam [V].** A test can drive the old class without Chromium:
- Override `initBrowser` (`playwright-base.ts:93`) to return a fake page, and `delay` (`:233`) to a no-op.
- The fake page's `evaluate(fn, arg)` runs `fn(arg)` against a stubbed global `fetch`, which runs the real in-page code.
- On the trimmed fixtures below this gives today's exact output: etoto 3 matches (40/40/40 markets), forbet 40/15/17, fuksiarz 291/30/83, betfan 37/36/38. The counts were re-proved on the future base on 2026-11-13; fuksiarz is unchanged by fuksiarz.md Task 0. The etoto pseudo-event is never requested.
- Observability's recorder (landed) runs inside `executeFullOfferScrape` (`playwright-base.ts:353-391`). The fake page is therefore an `EventEmitter` with `mainFrame`, `url` and `title`, the pattern of `navigation-diagnostics.test.ts:46-53`.
- A failed or empty browser result gets `diagnostics`, and possibly `| <issues>` appended to its `error`, so tests compare `matches`.
- Recovery goldens for these brands are trimmed `data` subsets, not replayable envelopes, so the fixtures stay on recipes R1/R2. Two tracked real envelopes exist, but using them would change the pins, so they are not used:
  - `src/services/normalization/bookmakers/__tests__/fixtures/fuksiarz-leeds-tottenham-2026-11-06.json`;
  - `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/forbet/forbet-event-57945911-arsenal-hull.full.json`.

**Importers that need repointing when a brand's singleton moves to `bookmakers/index.ts`:**
- `src/services/audit/bookmaker-registry.ts` (`:7` fuksiarz, `:9` betfan, `:11` etoto, `:12` forbet).
- `scripts/<brand>-market-discovery.ts:14` and `scripts/<brand>-prep-audit.ts:17`.
- `scripts/test-scrapers.sh`: class map `:26` betfan, `:28` etoto, `:29` forbet, `:31` fuksiarz, plus `:337` fuksiarz.
- `src/scripts/analyze-bookmaker-markets.ts:36,41`, typed `Record<PolishBookmaker, PlaywrightScraper>`. It only calls `scrapeFullOffer` and `cleanup` (`:122`, `:246`).
- `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` (plan 01 Task 3) instantiates `<Brand>PlaywrightScraper` for all four brands (cross-plan #4).
- Already through `bookmakers/index.js` or `getScraper`, so no change needed: `scripts/smoke-bookmaker.ts` (observability), `scripts/match-audit-raw-capture.ts`, and the aggregator tests that mock `../bookmakers/index.js`.
- The importer lines above are unchanged on the future base.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/shared/rest-market/brand.ts` | `RestMarketBrand<E>`, constants, `/rest/market` envelope readers, `withChallengeHint` | 1 |
| `src/scrapers/shared/start-time.ts` + `src/scrapers/shared/__tests__/start-time.test.ts` (plan 01 Task 4) | `toIsoStartTime`, consumed by every mapping; created here only if plan 01 Task 4 has not landed | 1 |
| `src/scrapers/shared/rest-market/runner.ts` | `fetchRestMarketOffer`: listing → skip-on-failure details → mapping, listing order | 1 |
| `src/scrapers/shared/rest-market/rest-market-scraper.ts` | `RestMarketHttpScraper<E> extends HttpScraper` | 1 |
| `src/scrapers/shared/rest-market/__tests__/offline-harness.ts` | test-only: fixture routes, offline browser driver | 1 |
| `src/scrapers/shared/rest-market/__tests__/{runner,category-ids}.test.ts` | runner contract, id guard | 1 |
| `src/scrapers/bookmakers/<brand>/offer-mapping.ts` | pure `to<Brand>Offer` | 2, 5, 8, 11 |
| `src/scrapers/bookmakers/<brand>/__tests__/offer-mapping.test.ts` | mapping ≡ today's browser output | 2, 5, 8, 11 |
| `src/scrapers/shared/rest-market/brands/<brand>.ts` | `<BRAND>_REST_MARKET` config + `<Brand>HttpScraper` | 3, 6, 9, 12 |
| `src/scrapers/shared/rest-market/__tests__/<brand>-transport.test.ts` | parity gate (1) + HTTP-only behaviour | 3, 6, 9, 12 |
| `src/scrapers/shared/rest-market/__tests__/fixtures/<brand>/` | trimmed recorded payloads | 2, 5, 8, 11 |
| `src/scrapers/bookmakers/<brand>/index.ts`, `types.ts` | rename to `<Brand>BrowserScraper`, mapping call, skip on failed detail, `eventStart` field | 2–3, 5–6, 8–9, 11–12 |
| `src/scrapers/bookmakers/index.ts` + `__tests__/transport-selection.test.ts` | per-brand transport selection (the single pick per README §3) | 3, 6, 9, 12 |
| importers listed above | repoint to `bookmakers/index.js` / Browser class names | 3, 6, 9, 12 |
| `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` (plan 01) | `<Brand>PlaywrightScraper` → `<Brand>BrowserScraper` | 3, 6, 9, 12 |

### Fixture recipes (run from the worktree root; each task's command is prefixed with `$H`)

```bash
E=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-07-scraper-performance/evidence
F=src/scrapers/shared/rest-market/__tests__/fixtures
# R1 (/rest/market brands): keep the given listing ids in listing order, 3 games each. Write one
# detail-<id>.json per id: the captured detail if one is given, else the full listing event wrapped
# as a detail. Details keep their first 40 games.
R1='import json,sys
L=json.load(open(sys.argv[1])); out=sys.argv[2]; ids=[int(x) for x in sys.argv[3].split(",")]
full={e["eventId"]:e for e in L["data"]}
json.dump(dict(L,data=[dict(full[i],eventGames=full[i]["eventGames"][:3]) for i in ids]),open(out+"/list.json","w"),ensure_ascii=False)
det={D["data"]["eventId"]:D for D in (json.load(open(p)) for p in sys.argv[4:])}
for i in ids:
  D=det.get(i) or {"code":L["code"],"description":L["description"],"data":full[i]}
  json.dump(dict(D,data=dict(D["data"],eventGames=D["data"]["eventGames"][:40])),open(f"{out}/detail-{i}.json","w"),ensure_ascii=False)'
# R2 (betfan): same idea on data.categories[0].events / data.event.games. Drops gameTypes (209 KB) and customeBets.
R2='import json,sys
L=json.load(open(sys.argv[1])); out=sys.argv[2]; ids=[int(x) for x in sys.argv[3].split(",")]
c=L["data"]["categories"][0]; full={e["eventId"]:e for e in c["events"]}
json.dump(dict(L,data={"categories":[dict(c,gameTypes=[],events=[dict(full[i],games=full[i]["games"][:3]) for i in ids])],"gameTypes":[]}),open(out+"/list.json","w"),ensure_ascii=False)
for p in sys.argv[4:]:
  D=json.load(open(p)); e=D["data"]["event"]; i=e["eventId"]
  json.dump(dict(D,data={"event":dict(e,games=e["games"][:40])}),open(f"{out}/detail-{i}.json","w"),ensure_ascii=False)'
```

Sizes produced (verified, and re-run on the future base on 2026-11-13 with the same parse results): etoto 70 KB, forbet 44 KB, fuksiarz 106 KB, betfan 117 KB.

---

### Task 1: Shared rest-market runner and HTTP scraper

**Files:**
- Create: `src/scrapers/shared/rest-market/brand.ts`, `runner.ts`, `rest-market-scraper.ts`, `__tests__/offline-harness.ts`
- Create only if plan 01 Task 4 has not landed: `src/scrapers/shared/start-time.ts` and `src/scrapers/shared/__tests__/start-time.test.ts`, exactly as plan 01 Task 4 specifies them. That means the same path, the name `toIsoStartTime`, the same signature and rules, and its 8-row test table. Tell the plan-01 executor to skip creating them. Never define a second converter (`kickoffIso` is gone, cross-plan #16).
- Test: `src/scrapers/shared/rest-market/__tests__/runner.test.ts`, `__tests__/category-ids.test.ts`

**Interfaces:**
- Consumes (README §3, plan 02): `HttpClient`, `createHttpClient({ defaultHeaders, fetchImpl })`, `HttpError` (`kind`, `url`, `status`, message formats), `ScrapeBudget`, `createScrapeBudget`, `fetchDetailsSkippingFailures`, `HttpScraper` (template incl. `MAX_SKIPPED_DETAIL_RATIO` failure text), `createReplayHttpClient`. From `src/config/leagues.ts`: `getBookmakerLeagueId` (`:162`), `isLeagueSupported` (`:178`), `getSupportedLeagues` (`:183`). From plan 01 Task 4: `toIsoStartTime(value: number | string | null | undefined): string | undefined` in `src/scrapers/shared/start-time.ts`, which treats a number `> 0` below `1e12` as epoch seconds and otherwise as ms.
- Produces:
  ```ts
  // brand.ts
  export interface RestMarketBrand<E> {
    readonly bookmaker: PolishBookmaker;
    readonly logTag: string;                              // e.g. "[eToto/FullOffer]"
    listingUrl(categoryId: string | number): string;
    detailUrl(eventId: string): string;
    listingEvents(body: unknown, url: string): E[];       // throws Error(`listing without events ${url}`)
    detailEvent(body: unknown, url: string): E;           // throws Error(`detail without event data ${url}`)
    isMatch(event: E): boolean;
    eventId(event: E): string;
    toOffer(listed: E, detail: E, league: string): FullMatchOffer | null; // null = no markets
  }
  export const REST_MARKET_DETAIL_CONCURRENCY = 4;
  export const REST_MARKET_HEADERS: Readonly<Record<string, string>>; // { Accept: "application/json", "Accept-Language": "pl-PL,pl;q=0.9" }
  export function restMarketListing<E>(body: unknown, url: string): E[];    // body.data must be an array (may be empty)
  export function restMarketDetail<E>(body: unknown, url: string): E;       // body.data must be an object with eventId
  export function withChallengeHint(error: unknown, bookmaker: PolishBookmaker): unknown;
  // runner.ts
  export function fetchRestMarketOffer<E>(brand: RestMarketBrand<E>, http: HttpClient, league: string,
    budget: ScrapeBudget): Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }>;
  // rest-market-scraper.ts
  export class RestMarketHttpScraper<E> extends HttpScraper {
    readonly bookmaker: PolishBookmaker;
    readonly transport = "http" as const;                     // README §3 / plan 07 DeclaresTransport; brand classes inherit it
    constructor(brand: RestMarketBrand<E>, http?: HttpClient); // default createHttpClient({ defaultHeaders: REST_MARKET_HEADERS })
  }
  // __tests__/offline-harness.ts (test-only). Plan 04 Task 0 (which needs this task) later moves ReplayRoutes,
  // driveBrowserScraperOffline and withoutScrapedAt into the shared src/__tests__/helpers/replay-page.ts and leaves
  // re-exports here, so this plan's tests never change.
  export type ReplayRoutes = Parameters<typeof createReplayHttpClient>[0];
  export type RestMarketBrandDir = "etoto" | "forbet" | "fuksiarz" | "betfan";
  export function loadFixtureRoutes(dir: RestMarketBrandDir, urls: { list: string; detail: (id: string) => string }): ReplayRoutes;
  export function driveBrowserScraperOffline(scraper: PlaywrightScraper, routes: ReplayRoutes): { calls: string[] };
  export function withoutScrapedAt(o: FullMatchOffer): Omit<FullMatchOffer, "scrapedAt">;
  ```

- [ ] **Step 1: Write the failing tests.** `runner.test.ts` uses a stub brand and the real `createHttpClient({ fetchImpl: fakeFetch(routes) })`. `fakeFetch` serves `{ status?, body, contentType?, headers?, delayMs? }` per URL, 404 otherwise, and records `maxInFlight` over `/ev/` URLs.

```ts
type Ev = { eventId: number; name: string; games: string[] };
const STUB: RestMarketBrand<Ev> = {
  bookmaker: "etoto", logTag: "[Stub/FullOffer]",
  listingUrl: (c) => `https://x.test/list/${c}`, detailUrl: (id) => `https://x.test/ev/${id}`,
  listingEvents: restMarketListing, detailEvent: restMarketDetail,
  isMatch: (e) => e.name !== "combo", eventId: (e) => String(e.eventId),
  toOffer: (l, d) => d.games.length === 0 ? null : { matchId: String(d.eventId), bookmaker: "etoto", homeTeam: l.name,
    awayTeam: "B", eventUrl: `u/${d.eventId}`, markets: d.games.map((g) => ({ name: g, selections: [] })), scrapedAt: new Date(0) },
};
// list/206 = { data: [ {1,"A"}, {2,"combo"}, {3,"C"} ] }; ev/<id> = { data: { eventId: id, name, games: ["g1"] } }
const run = (routes) => fetchRestMarketOffer(STUB, createHttpClient({ fetchImpl: fakeFetch(routes) }), "premier-league", createScrapeBudget(5_000));

it("fetches the listing once, then one detail per listed match; skips combos")        // calls.sort() == [ev/1, ev/3, list/206]; ids ["1","3"]; skipped []
it("returns matches in listing order when details resolve out of order")              // ev/1 delayMs 30 → ids ["1","3"]
it("keeps at most 4 details in flight")                                               // 8 events, each detail delayMs 10 → maxInFlight === 4
it("skips a failed detail instead of falling back to listing data")                  // ev/3 status 404 → ids ["1"]; skipped [{ id: "3", error: "fetch HTTP 404 https://x.test/ev/3" }]
it("skips a detail envelope without data")                                            // ev/3 body {"code":404,"description":"Event not found"} → skipped[0].error === "detail without event data https://x.test/ev/3"
it("a detail with no markets yields no offer and no skip")                            // ev/3 games [] → ids ["1"], skipped []
it("names the fallback flag on a challenged listing (403)")                           // list 403 text/html, header cf-mitigated: challenge →
  // rejects with message "fetch HTTP 403 https://x.test/list/206 | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser"
it("names the fallback flag on an HTML listing (200 text/html)")                      // "fetch non-JSON text/html https://x.test/list/206 | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser"
it("a challenged detail carries the hint into skipped")                               // ev/3 403 → "fetch HTTP 403 https://x.test/ev/3 | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser"
it("an empty listing is success with no matches")                                    // data [] → resolves { matches: [], skipped: [] }; calls == [list/206];
  // console.warn "[Stub/FullOffer] No events found from API https://x.test/list/206" (README §3 empty-listing rule)
it("a listing without the events array is an error")                                 // body {"code":500} → rejects "listing without events https://x.test/list/206"
describe("RestMarketHttpScraper", () => {
  it("fails the run when more than half the details fail")   // ev/1 and ev/3 404 → success false, error matches /^2 of 2 details failed \| fetch HTTP 404 https:\/\/x\.test\/ev\/[13]$/
  it("an empty listing is success:true with 0 matches")      // data [] → toMatchObject({ success: true, matches: [] }); error undefined → observability `empty`
  it("opens no browser")                                     // vi.spyOn(browserPool, "acquire") → not called after a successful run
  it("rejects an unsupported league")                        // scrapeFullOffer("no-such-league") → success false
  it("declares transport http")                              // new RestMarketHttpScraper(STUB).transport === "http"
});
```

`category-ids.test.ts`: `it.each(["etoto","forbet","fuksiarz","betfan"])("%s CATEGORY_IDS equal src/config/leagues.ts")`. It imports each brand's `CATEGORY_IDS` and expects `Object.fromEntries(getSupportedLeagues(bm).map((s) => [s, getBookmakerLeagueId(s, bm)]))` to `toEqual` it. This is a guard: it passes on first run.

- [ ] **Step 2: Run and confirm the failure.** `$H npx vitest run src/scrapers/shared/rest-market`. Expected: `runner.test.ts` FAIL, cannot resolve `../brand.js`. `category-ids.test.ts` 4 passed.
- [ ] **Step 3: Implement** `brand.ts`, `runner.ts`, `rest-market-scraper.ts` and the harness.
  - `withChallengeHint` appends `` ` | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_${bookmaker.toUpperCase()}=browser` `` to the message of an `HttpError` with `kind === "content-type"`, or with `kind === "http"` and status 403 or 503. It returns a new `HttpError` with the same kind, url and status, and returns any other error unchanged.
  - `RestMarketHttpScraper.isLeagueSupported` delegates to `leagues.ts` `isLeagueSupported(league, bookmaker)`, and `fetchFullOffer` delegates to `fetchRestMarketOffer`.
  - Harness: `driveBrowserScraperOffline` assigns `initBrowser = async () => ({ page, browser: {}, context: {}, cleanup: async () => {} })` and `delay = async () => {}` on the instance.
    - The fake page is `Object.assign(new EventEmitter(), { goto: async () => null, evaluate: (fn, arg) => fn(arg), mainFrame: () => ({}), url: () => "about:blank", title: async () => "" })`. Observability's recorder attaches its `on`/`off` listeners and reads `url`/`title`, the pattern of `navigation-diagnostics.test.ts:46-53`; it emits no events, so it records no issues.
    - The function also calls `vi.stubGlobal("fetch", …)`, serving the routes as `Response`s (`Error` → throw, missing → 404). Tests call `vi.unstubAllGlobals()` in `afterEach`.
  - Runner order (the only non-obvious part):
  ```text
  url = brand.listingUrl(getBookmakerLeagueId(league, bm)); body = getJson(url, { signal: budget.signal }) (rethrow withChallengeHint)
  events = brand.listingEvents(body, url)            // throws `listing without events ${url}` on a malformed envelope
  if events is empty → console.warn(`${logTag} No events found from API ${url}`); return { matches: [], skipped: [] }
  listed = events.filter(isMatch); log `${logTag} Found ${events.length} events, ${listed.length} matches`
  outcome = fetchDetailsSkippingFailures(listed, eventId, (e, signal) => getJson(detailUrl(id), { signal })
            .then((b) => brand.detailEvent(b, u), (err) => { throw withChallengeHint(err, bm) }),
            { concurrency: REST_MARKET_DETAIL_CONCURRENCY, budget })
  sort outcome.fetched by index in `listed`; offers = toOffer(event, detail, league), drop null
  log per match `${logTag} ${home} vs ${away}: ${n} markets`, per skip `${logTag} Skipping ${id}: ${error}`,
  and `${logTag} Completed: ${matches} matches, ${markets} total markets, ${skipped} skipped`
  ```
- [ ] **Step 4: Run and confirm it passes.** `$H npx vitest run src/scrapers/shared/rest-market` → all pass (plus `src/scrapers/shared/__tests__/start-time.test.ts` if this task created it). `$H npx tsc --noEmit` → exit 0. `grep -nE "delay|setTimeout|kickoffIso" src/scrapers/shared/rest-market/*.ts` → no output. Then `$H npx vitest run` is green.
- [ ] **Step 5: Commit.** `git add src/scrapers/shared/rest-market && git commit -m "feat(scrapers): shared rest-market runner and HTTP scraper"`. If this task created `start-time.ts`, also `git add src/scrapers/shared/start-time.ts src/scrapers/shared/__tests__/start-time.test.ts`.

---

### Task 2: etoto offer mapping extracted from the browser path

**Files:**
- Create: `src/scrapers/bookmakers/etoto/offer-mapping.ts`; fixtures `src/scrapers/shared/rest-market/__tests__/fixtures/etoto/{list,detail-6262615,detail-6224070,detail-6224074,detail-6224078}.json`
- Modify: `src/scrapers/bookmakers/etoto/types.ts:52-53`, `src/scrapers/bookmakers/etoto/index.ts:284-305`
- Test: `src/scrapers/bookmakers/etoto/__tests__/offer-mapping.test.ts`

**Interfaces:**
- Consumes: `parseTeamNames`, `parseAllMarkets`, `isValidEvent` (`etoto/parser.ts:33`, `:287`, `:378`); `buildEventUrl` (`etoto/navigation.ts:156`); `getCanonicalTeamName`; `toIsoStartTime` (plan 01, `src/scrapers/shared/start-time.ts`); harness (Task 1).
- Produces: `toEtotoOffer(listed: EtotoEvent, detail: EtotoEvent, league: string): FullMatchOffer | null`. Fields:
  - `matchId: String(detail.eventId)`;
  - teams `getCanonicalTeamName(parseTeamNames(detail.eventName).*, league)`;
  - `eventUrl: buildEventUrl(detail.eventId)`;
  - `markets: parseAllMarkets(detail, teams)`, null when empty;
  - `startTime: toIsoStartTime(detail.eventStart)`;
  - `scrapedAt: new Date()`.

  `EtotoEvent.startTime?` becomes `eventStart?: number` (`etoto/types.ts:53`). Plan 01 Task 4 normally made that change already.

- [ ] **Step 1: Copy the fixtures and write the failing tests.** `mkdir -p $F/etoto && $H python3 -I -c "$R1" $E/forbet-etoto/et_list.json $F/etoto 6262615,6224070,6224074,6224078 $E/forbet-etoto/et_detail.json`

```ts
const URLS = { list: "https://api.etoto.pl/rest/market/categories/multi/206/events",
               detail: (id: string) => `https://api.etoto.pl/rest/market/events/${id}` };
// old = await new EtotoPlaywrightScraper().scrapeFullOffer("premier-league") after driveBrowserScraperOffline(...)
// mapped = list.data.filter(isValidEvent).map((e) => toEtotoOffer(e, detailOf(e), "premier-league")).filter(Boolean)
// Compare old.matches only: the browser result also carries observability's `diagnostics`.
it("equals today's browser output on the recorded payloads (scrapedAt aside)") // old.matches.map(withoutScrapedAt) toEqual mapped.map(withoutScrapedAt);
  // without plan 01 Task 4 also strip startTime on both sides
it("pins the recorded offer")      // old.matches.map((m) => [m.matchId, m.markets.length]) == [["6224070",40],["6224074",40],["6224078",40]]
it("never requests the 'Dzień meczowy' pseudo-event")  // calls does not contain URLS.detail("6262615")
it("takes the kickoff from eventStart")                // mapped[0].startTime === "2026-11-07T12:30:00.000Z"
it("returns null for a detail without markets")        // toEtotoOffer(e, { ...d, eventGames: [] }, l) === null
it("the browser path stores the kickoff")              // old.matches[0].startTime === "2026-11-07T12:30:00.000Z"
```

- [ ] **Step 2: Run and confirm the failure.** `$H npx vitest run src/scrapers/bookmakers/etoto` → FAIL, cannot resolve `../offer-mapping.js`.
- [ ] **Step 3: Implement `toEtotoOffer` only. `index.ts` stays untouched for now.** Run again.
  - **With plan 01 Task 4 landed** (the normal order, README §5.0 P1 before P4): `types.ts` already has `eventStart?: number`, and everything passes, including `the browser path stores the kickoff`. That run is the parity proof against the unmodified old code; record the output in the task notes.
  - **Without it:** replace `startTime?: number` with `eventStart?: number` (epoch ms) in `types.ts`. Everything then passes except `the browser path stores the kickoff`, which is the parity proof. This task now owns the etoto `start_time` fix: tell the plan-01 executor to drop its etoto hunk.
- [ ] **Step 4: Switch the old path.** In `index.ts:284-305` keep `const detailData = await fetchEventDetails(page, String(event.eventId));`. Replace the rest with `const offer = toEtotoOffer(event, detailData?.data || event, leagueSlug);` followed by `if (offer) { matches.push(offer); console.log(`[eToto/FullOffer] ${offer.homeTeam} vs ${offer.awayTeam}: ${offer.markets.length} markets`); }`. The listing fallback stays until Task 3. `$H npx vitest run src/scrapers` → all pass, including plan 01's `full-offer-fixtures.test.ts`. `$H npx tsc --noEmit` → 0. `$H npx vitest run` green.
- [ ] **Step 5: Commit.** `git add src/scrapers/bookmakers/etoto src/scrapers/shared/rest-market/__tests__/fixtures/etoto && git commit -m "refactor(etoto): extract full-offer mapping and store kickoff from eventStart"`

---

### Task 3: etoto over HTTP, browser path behind `SCRAPER_TRANSPORT_ETOTO`

**Files:**
- Create: `src/scrapers/shared/rest-market/brands/etoto.ts`
- Modify:
  - `src/scrapers/bookmakers/etoto/index.ts`: `:46` (rename the class to `EtotoBrowserScraper`), `:284-285` (skip on a failed detail), `:337-338` (delete the singleton).
  - `src/scrapers/bookmakers/index.ts:9`
  - `src/services/audit/bookmaker-registry.ts:11`, `scripts/etoto-market-discovery.ts:14`, `scripts/etoto-prep-audit.ts:17`, `scripts/test-scrapers.sh:28`
  - `src/scripts/analyze-bookmaker-markets.ts:36,41`, unless plan 02 already typed it `FullOfferScraper`.
  - `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts` (plan 01, cross-plan #4): `EtotoPlaywrightScraper` → `EtotoBrowserScraper`. The harness keeps driving the browser class through its navigation mock; this task's contract test covers the HTTP class.
- Test: `src/scrapers/shared/rest-market/__tests__/etoto-transport.test.ts`, `src/scrapers/bookmakers/__tests__/transport-selection.test.ts`

**Interfaces:**
- Consumes: `toEtotoOffer` (Task 2); `RestMarketHttpScraper`, `restMarketListing`, `restMarketDetail` (Task 1); `API_BASE_URL` (`etoto/constants.ts:16`); `getTransportOverride`, `FullOfferScraper`, `createReplayHttpClient` (§3).
- Produces: `ETOTO_REST_MARKET: RestMarketBrand<EtotoEvent>` (`logTag "[eToto/FullOffer]"`, `listingUrl(c) = `${API_BASE_URL}/categories/multi/${c}/events``, `detailUrl(id) = `${API_BASE_URL}/events/${id}``, `isMatch: isValidEvent`, `toOffer: toEtotoOffer`); `class EtotoHttpScraper extends RestMarketHttpScraper<EtotoEvent> { constructor(http?: HttpClient) }`, with `transport === "http"` inherited; `EtotoBrowserScraper`. `src/scrapers/bookmakers/index.ts` exports `EtotoBrowserScraper`, `EtotoHttpScraper`, and `etotoScraper: FullOfferScraper = getTransportOverride("etoto") === "browser" ? new EtotoBrowserScraper() : new EtotoHttpScraper()`. That export is the single pick per README §3, and every direct importer is repointed to it.

- [ ] **Step 1: Write the failing tests.** `routes = loadFixtureRoutes("etoto", URLS)`. The HTTP side is `new EtotoHttpScraper(createReplayHttpClient(routes))`. The browser side is `new EtotoBrowserScraper()` driven by `driveBrowserScraperOffline(…, routes)`.

```ts
it("listing and detail URLs are byte-identical to the in-page fetches")  // ETOTO_REST_MARKET.listingUrl(206) === URLS.list; detailUrl("1") === URLS.detail("1")
it("declares transport http")                                             // new EtotoHttpScraper().transport === "http"
it("HTTP and browser paths produce deep-equal offers")                    // http.matches.map(withoutScrapedAt) toEqual browser.matches.map(withoutScrapedAt); 3 matches
  // (matches only: the browser result may carry observability's `diagnostics`)
it("both paths skip a match whose detail returns 404 (no listing fallback)") // routes[URLS.detail("6224078")] = { status: 404, body: '{"code":404}' }
  // → both ids ["6224070","6224074"], deep-equal; http.success === true
it("HTTP path fails the run when 2 of 3 details fail")   // 6224074 and 6224078 → 404
  // → success false, error matches /^2 of 3 details failed \| fetch HTTP 404 https:\/\/api\.etoto\.pl\/rest\/market\/events\/62240(74|78)$/
it("HTTP path requests the listing and 3 details and opens no browser")  // replay.calls.sort() == [list, 6224070, 6224074, 6224078 URLs]; browserPool.acquire not called
it("listing of only combo events")                       // list body {"code":200,"data":[<6262615 event>]} → success true, 0 matches, calls == [list]
it("an empty listing is success:true with 0 matches")    // list body {"code":200,"data":[]} → toMatchObject({ success: true, matches: [] }); calls == [list]
it("a challenged listing names SCRAPER_TRANSPORT_ETOTO") // list { status: 403, body: "<html>", contentType: "text/html" } →
  // error === "fetch HTTP 403 https://api.etoto.pl/rest/market/categories/multi/206/events | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser"
```

`transport-selection.test.ts` (rows are added by Tasks 6/9/12):

```ts
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it.each([["etoto", "SCRAPER_TRANSPORT_ETOTO", "etotoScraper", "EtotoHttpScraper", "EtotoBrowserScraper"]])(
  "%s: HTTP by default, browser class when %s=browser", async (_bm, env, inst, httpCls, browserCls) => {
    vi.stubEnv(env, ""); let m: any = await import("../index.js"); expect(m[inst]).toBeInstanceOf(m[httpCls]);
    vi.stubEnv(env, "browser"); vi.resetModules(); m = await import("../index.js"); expect(m[inst]).toBeInstanceOf(m[browserCls]);
  });
```

- [ ] **Step 2: Run and confirm the failure.** `$H npx vitest run src/scrapers/shared/rest-market/__tests__/etoto-transport.test.ts src/scrapers/bookmakers/__tests__` → FAIL, cannot resolve `../brands/etoto.js`.
- [ ] **Step 3: Implement.**
  - Write `brands/etoto.ts`. Add a header comment with the Cloudflare signals from Task 4 Step 4.
  - Rename the class, also in plan 01's `full-offer-fixtures.test.ts`.
  - In the browser `scrapeFullOffer`, replace `const fullEvent = detailData?.data || event` with `if (!detailData?.data) { console.warn(`[eToto/FullOffer] Skipping ${event.eventId}: detail failed`); continue; }` and pass `detailData.data` to `toEtotoOffer`.
  - Move the singleton to `bookmakers/index.ts`, importing `getTransportOverride` and `type FullOfferScraper`.
  - Repoint the three importers to `src/scrapers/bookmakers/index.js`.
  - Change the `test-scrapers.sh` class name to `EtotoBrowserScraper`.
  - Retype `analyze-bookmaker-markets.ts` to `Record<PolishBookmaker, FullOfferScraper>`.
- [ ] **Step 4: Run and confirm it passes.**
  - Both test files pass, and so does `src/scrapers/bookmakers/__tests__/full-offer-fixtures.test.ts`. `$H npx tsc --noEmit` → 0. `$H npx vitest run` green.
  - Scripts type-check: `$H npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck --esModuleInterop --resolveJsonModule scripts/etoto-market-discovery.ts scripts/etoto-prep-audit.ts` → 0.
  - `grep -rn "EtotoPlaywrightScraper\|bookmakers/etoto/index.js" src scripts` → no output.
- [ ] **Step 5: Commit.** `git add src/scrapers scripts/etoto-market-discovery.ts scripts/etoto-prep-audit.ts scripts/test-scrapers.sh src/services/audit/bookmaker-registry.ts src/scripts/analyze-bookmaker-markets.ts && git commit -m "feat(etoto): browserless full offer; browser path behind SCRAPER_TRANSPORT_ETOTO"`

---

### Task 4: etoto live parity (implementer), then merge and post-merge gate (owner, deferred)

- [ ] **Step 1: Same-hour parity (parity gate 2, implementer).** Run from the worktree, between HH:10 and HH:50, one run at a time. Both runs are dry: plan 02's perf-smoke forces a dead `SUPABASE_URL` and writes only the `--out` file.
  ```bash
  mkdir -p .scratch/perf-smoke
  SCRAPER_TRANSPORT_ETOTO=browser $H --live npx tsx scripts/perf-smoke.ts --bookmaker etoto --out .scratch/perf-smoke/etoto-browser-03.json
  $H --live npx tsx scripts/perf-smoke.ts --bookmaker etoto --out .scratch/perf-smoke/etoto-http-03.json --baseline .scratch/perf-smoke/etoto-browser-03.json
  ```
  Pass:
  - Both commands exit 0. The second prints `PARITY` with `"matchesEqual":true` and `"pass":true`: `matches` equal, and `markets` and `selections` each within ±2 % of the browser run.
  - The HTTP summary has:
    - `scraperClass` `EtotoHttpScraper` and `memory.chromiumProcessesEver` 0;
    - `wallMs` ≤ 3 000 (the browser path alone took 7.3 s);
    - `transport.http.requests` ≤ 1 + listed matches + 2.
  - The HTTP run prints no `[eToto/Navigation]` line.
- [ ] **Step 2: Merge (owner).** Merge `perf/03-rest-market-etoto`, never between HH:55 and HH:10. It restarts the service once.
- [ ] **Step 3: First scheduled run after the merge (parity gate 3; owner, deferred).** The implementer copies these commands and pass criteria into the task report. `$LOG` is the backend's log with colours stripped (`sed 's/\x1b\[[0-9;]*m//g'`), restricted to that run.
  - A10: `grep -E '^\[Aggregator/FullOffer\] etoto (success|partial):' "$LOG" | tail -1 | grep -oE '[0-9]+ saved'` → ≥ **4 915**. That is 0.75 × run-2's 6 553 (`RUN2_OK` in `src/__tests__/helpers/run-fixtures.ts`). The line format is `[Aggregator/FullOffer] <bm> <status>: N matches, M markets found, K saved[ - err]`.
  - Once the owner has applied migration 11, the same bound holds for this read-only query, with `status` `success` or `partial`: `select status, markets_saved, error_message from scraper_runs where bookmaker = 'etoto' and league_slug = 'premier-league' order by started_at desc limit 1`.
  - Kickoff (read-only): `docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' supabase_db_backend psql -U postgres -d postgres -X -At -c "select count(*), count(*) filter (where start_time is null) from odds where bookmaker='etoto' and league_slug='premier-league' and scraped_at >= '<run start ISO>'"` → the second number is **0**.
  - The run's log has no `[eToto/Navigation] Navigating to:` line and at most 1 `[eToto/FullOffer] Skipping` line. More skips: investigate before the forbet group starts.
- [ ] **Step 4: Operator runbook (Cloudflare on etoto).**
  - **Signal.** etoto's run line reads `[Aggregator/FullOffer] etoto scrape_failed: 0 matches, 0 markets found, 0 saved - fetch HTTP 403 <url> | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser`, or `- fetch non-JSON text/html <url> | …`.
    - The same text appears in `scraper_runs.error_message` and in `/api/health/scrapers` `lastError`.
    - `[ScrapeRun]` carries no error text; it only lists `etoto:scrape_failed` in `failed=`.
    - After 3 consecutive failures, `[ALERT] etoto (premier-league) failed 3 consecutive runs since <iso>: <error>` fires (owner B8).
  - **Confirm** (read-only): `curl -s -o /dev/null -D - --compressed -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' https://api.etoto.pl/rest/market/categories/multi/206/events | grep -iE '^HTTP|^content-type|^cf-mitigated'`. Healthy today: `HTTP/2 200` and `content-type: application/json`, with no `cf-mitigated`. Flip on 403/503, `text/html`, or `cf-mitigated: challenge`.
  - **Flip** (owner): add `SCRAPER_TRANSPORT_ETOTO=browser` to the backend's `.env` in the main checkout, then restart. The next run logs `[eToto/Navigation] Navigating to:` again. Remove the line once the curl is healthy.
  - The same applies to every brand in this plan, with its own `SCRAPER_TRANSPORT_<BM>`.
- [ ] **Step 5: Record.** Put Step 1's `PERF_SMOKE`/`PARITY` lines in `.scratch/rest-market/etoto-<date>.txt`, never in `$E`. Put the same lines in the task report, together with Step 3's commands and pass criteria. The owner adds Step 3's output after the merge.

---

## Forbet group (branch `perf/03-rest-market-forbet`, after the owner recorded forbet.md's live verification)

| Item | Value |
|---|---|
| Precondition | etoto merged and its Task 4 Step 3 gate recorded. Also, the owner has recorded forbet.md "After both tasks: live verification" for the code of f167c46 + 3470eaf/82ee9f6, which is on integration: `evidence/forbet/acceptance-check.py` printed seven `PASS` lines. |
| Fixture command | `mkdir -p $F/forbet && $H python3 -I -c "$R1" $E/forbet-etoto/fb_list_major.json $F/forbet 57945888,57945911,57945945 $E/forbet-etoto/fb_detail.json` |
| URLS | list `https://www.iforbet.pl/rest/market/categories/multi/199/events?gamesClass=major`, detail `https://www.iforbet.pl/rest/market/events/{id}` |
| Config URLs | `listingUrl(c) = `${API_BASE_URL}/${c}/events?gamesClass=major`` (`forbet/constants.ts:17`), `detailUrl(id) = `${BASE_URL}/rest/market/events/${id}`` (`:11`) |
| Mapping fields | as etoto (all from the detail; `startTime: toIsoStartTime(detail.eventStart)`); `isValidEvent` `parser.ts:327`; `buildEventUrl` `navigation.ts:202` |
| Type change | `forbet/types.ts:51` `eventStartTime?: string` → `eventStart?: number`. Plan 01 Task 4 normally made this change already. |
| Old-path hunk | `forbet/index.ts:296-321` (future-base lines). After plan 01 Task 3 the `updateCache` lines at `:299-301` and the cache block above the class are gone, so locate the hunk by its snippet `const fullEvent = detailData?.data \|\| event;`. |
| Pins | `[["57945888",40],["57945911",15],["57945945",17]]` (re-proved on the future base); kickoff of 57945888 `2026-11-07T12:30:00.000Z` |
| 404 / 2-of-3 ids | 57945945 / 57945911 + 57945945 |
| Class, singleton | `:65` → `ForbetBrowserScraper`; delete `:348-349`; `logTag "[forBET/FullOffer]"` |
| Importers | `bookmaker-registry.ts:12`, `scripts/forbet-market-discovery.ts:14`, `scripts/forbet-prep-audit.ts:17`, `test-scrapers.sh:29`; plan 01's `full-offer-fixtures.test.ts` |
| Gates | browser alone 6.5 s; A10 forbet ≥ **4 402** (0.75 × 5 869); start_time NULL 0; no `[forBET/Navigation] Navigating to base site:` |

### Task 5: forbet offer mapping

**Files:** Create `src/scrapers/bookmakers/forbet/offer-mapping.ts` and the fixtures `$F/forbet/`. Modify `forbet/index.ts:296-321`, and `forbet/types.ts:51` if plan 01 Task 4 has not landed. Test `src/scrapers/bookmakers/forbet/__tests__/offer-mapping.test.ts`.

**Interfaces:** Produces `toForbetOffer(listed: ForbetEvent, detail: ForbetEvent, league: string): FullMatchOffer | null`. The fields come from the detail, exactly as `toEtotoOffer` (with `toIsoStartTime`).

- [ ] **Step 1:** Run the fixture command from the table. Write the six Task 2 tests with the table's URLS, pins and kickoff; the browser side is compared on `matches` only. Forbet has no pseudo-event, so replace the pseudo-event test with `requests exactly 3 details`.
- [ ] **Step 2:** `$H npx vitest run src/scrapers/bookmakers/forbet` → FAIL (module not found).
- [ ] **Step 3:** Implement the mapping. With plan 01 Task 4 landed, all tests pass; that is the parity proof. Without it, make the type change, and then only `the browser path stores the kickoff` fails. That failure is the parity proof, and this task then owns forbet's kickoff fix.
- [ ] **Step 4:** Old path, `:296-321`: `const offer = toForbetOffer(event, detailData?.data || event, leagueSlug)`, then the push and log, as in Task 2 Step 4. All pass, including plan 01's harness. `$H npx tsc --noEmit` 0. `$H npx vitest run` green.
- [ ] **Step 5:** `git commit -m "refactor(forbet): extract full-offer mapping and store kickoff from eventStart"` (add the brand dir and `$F/forbet`).

### Task 6: forbet over HTTP

**Files:** Create `src/scrapers/shared/rest-market/brands/forbet.ts`. Modify `forbet/index.ts` (the class, the skip on a failed detail at `:297`, the singleton) and `bookmakers/index.ts:10`. Repoint the importers from the table, and rename `ForbetPlaywrightScraper` → `ForbetBrowserScraper` in plan 01's `full-offer-fixtures.test.ts` (cross-plan #4). Tests: `__tests__/forbet-transport.test.ts`, plus a row in `transport-selection.test.ts`.

**Interfaces:** Produces `FORBET_REST_MARKET`, `ForbetHttpScraper` (`transport === "http"`), `ForbetBrowserScraper`, and `forbetScraper: FullOfferScraper`, with the same selection rule as etoto.

- [ ] **Step 1:** Port Task 3's tests with the table's values:
  - URL identity and `declares transport http`;
  - deep-equal `matches` on 3 matches;
  - both paths skip the 404 id;
  - the 2-of-3 failure regex on `https:\/\/www\.iforbet\.pl\/rest\/market\/events\/579459(11|45)`;
  - calls, and no browser;
  - an empty listing is `success: true` with 0 matches;
  - challenge text with `SCRAPER_TRANSPORT_FORBET`.

  Drop the combo-listing test. Add the selection row `["forbet","SCRAPER_TRANSPORT_FORBET","forbetScraper","ForbetHttpScraper","ForbetBrowserScraper"]`.
- [ ] **Step 2:** Run them: FAIL (`../brands/forbet.js` missing).
- [ ] **Step 3:** Implement as Task 3 Step 3. The skip log is `[forBET/FullOffer] Skipping ${event.eventId}: detail failed`.
- [ ] **Step 4:** Tests pass, including plan 01's harness. `$H npx tsc --noEmit` 0. `$H npx vitest run` green. The scripts `tsc` command (`$H`) on both forbet scripts → 0. `grep -rn "ForbetPlaywrightScraper\|bookmakers/forbet/index.js" src scripts` → no output.
- [ ] **Step 5:** `git commit -m "feat(forbet): browserless full offer; browser path behind SCRAPER_TRANSPORT_FORBET"`

### Task 7: forbet live parity (implementer), merge and gate (owner, deferred)

- [ ] As Task 4 Steps 1–5, with `--bookmaker forbet`, `SCRAPER_TRANSPORT_FORBET=browser`, the files `.scratch/perf-smoke/forbet-{browser,http}-03.json`, the A10 grep `^\[Aggregator/FullOffer\] forbet (success|partial):`, and the gate values from the table.

---

## Fuksiarz group (branch `perf/03-rest-market-fuksiarz`, after the owner recorded fuksiarz.md's live acceptance)

| Item | Value |
|---|---|
| Precondition | forbet merged and its gate recorded. Also, the owner has recorded fuksiarz.md's live Acceptance B for Task 0 (fb29603, `fuksiarz/parser.ts:160-198`, on integration). |
| Fixture command | `mkdir -p $F/fuksiarz && $H python3 -I -c "$R1" $E/lvbet-fuksiarz/fk_cat.json $F/fuksiarz 23464740,23464877,23615576 $E/lvbet-fuksiarz/fk_ev.json $E/lvbet-fuksiarz/fk_ev2.json` |
| URLS | list `https://fuksiarz.pl/rest/market/categories/multi/625/events`, detail `https://fuksiarz.pl/rest/market/events/{id}` |
| Config URLs | `listingUrl(c) = `${API_BASE_URL}/${c}/events`` (`fuksiarz/constants.ts:16`), `detailUrl(id) = `${BASE_URL}/rest/market/events/${id}`` (`:11`) |
| Mapping fields | `matchId`, teams and `eventUrl` from the **listing** event; `markets: parseAllMarkets(detail, teams)` (`parser.ts:338`); `startTime: toIsoStartTime(detail.eventStart)`, which applies the same seconds-vs-ms rule as `index.ts:276-278`; `isValidEvent` `parser.ts:461` |
| Type change | none (`eventStart` already exists) |
| Old-path hunk | `fuksiarz/index.ts:256-285` |
| Pins | `[["23464740",291],["23464877",30],["23615576",83]]`, re-proved on the future base after fuksiarz.md Task 0; kickoffs `2026-11-07T12:30:00.000Z`, `2026-11-07T15:00:00.000Z`, `2026-11-21T12:30:00.000Z` |
| 404 / 2-of-3 ids | 23615576 / 23464877 + 23615576 |
| Class, singleton | `:41` → `FuksiarzBrowserScraper`; delete `:312`; `logTag "[Fuksiarz/FullOffer]"` |
| Importers | `bookmaker-registry.ts:7`, `scripts/fuksiarz-market-discovery.ts:14`, `scripts/fuksiarz-prep-audit.ts:17`, `test-scrapers.sh:31` and `:337`; plan 01's `full-offer-fixtures.test.ts` |
| Gates | browser alone 6.5 s; A10 fuksiarz ≥ **4 667** (0.75 × 6 222); start_time NULL stays 0; no `[Fuksiarz/Navigation] Navigating to:` |

### Task 8: fuksiarz offer mapping

**Files:** Create `src/scrapers/bookmakers/fuksiarz/offer-mapping.ts` and the fixtures `$F/fuksiarz/`. Modify `fuksiarz/index.ts:256-285`. Test `src/scrapers/bookmakers/fuksiarz/__tests__/offer-mapping.test.ts`.

**Interfaces:** Produces `toFuksiarzOffer(listed: FuksiarzEvent, detail: FuksiarzEvent, league: string): FullMatchOffer | null`, with fields as in the table.

- [ ] **Step 1:** Run the fixture command. Write the Task 2 tests with the table's values. The old path already stores the kickoff, so the parity test strips only `scrapedAt` (`withoutScrapedAt`, on `old.matches`), and the three kickoffs are pinned on both `old.matches` and `mapped`. Replace the pseudo-event test with `requests exactly 3 details`.
- [ ] **Step 2:** `$H npx vitest run src/scrapers/bookmakers/fuksiarz` → FAIL (module not found).
- [ ] **Step 3:** Implement the mapping. All tests pass against the untouched old path; that is the parity proof.
- [ ] **Step 4:** Old path, `:256-285`: `const offer = toFuksiarzOffer(event, detailResponse?.data || event, leagueSlug)`, then push and log. Plan 01 Task 3 has already removed the `eventsCache.set` lines here; locate the hunk by its snippet `const fullEvent = detailResponse?.data || event;`. All pass, including plan 01's harness. `$H npx tsc --noEmit` 0. `$H npx vitest run` green.
- [ ] **Step 5:** `git commit -m "refactor(fuksiarz): extract full-offer mapping"`

### Task 9: fuksiarz over HTTP

**Files:** Create `src/scrapers/shared/rest-market/brands/fuksiarz.ts`. Modify `fuksiarz/index.ts` (the class, the skip on a failed detail at `:260`, the singleton) and `bookmakers/index.ts:12`. Repoint the importers from the table, including the rename in plan 01's harness. Tests: `__tests__/fuksiarz-transport.test.ts`, plus a selection row.

**Interfaces:** Produces `FUKSIARZ_REST_MARKET`, `FuksiarzHttpScraper` (`transport === "http"`), `FuksiarzBrowserScraper`, and `fuksiarzScraper: FullOfferScraper`.

- [ ] **Step 1:** Port Task 3's tests with the table's values, including `declares transport http` and the empty-listing test. The 2-of-3 regex ends `https:\/\/fuksiarz\.pl\/rest\/market\/events\/(23464877|23615576)`. The challenge text uses `SCRAPER_TRANSPORT_FUKSIARZ`. Drop the combo test. Add the selection row.
- [ ] **Step 2:** FAIL (`../brands/fuksiarz.js` missing).
- [ ] **Step 3:** Implement as Task 3 Step 3. The skip log is `[Fuksiarz/FullOffer] Skipping ${eventId}: detail failed`. Update both `test-scrapers.sh` occurrences.
- [ ] **Step 4:** Tests pass, including plan 01's harness. `$H npx tsc --noEmit` 0. `$H npx vitest run` green. The scripts `tsc` command (`$H`) on both fuksiarz scripts → 0. `grep -rn "FuksiarzPlaywrightScraper\|bookmakers/fuksiarz/index.js" src scripts` → no output.
- [ ] **Step 5:** `git commit -m "feat(fuksiarz): browserless full offer; browser path behind SCRAPER_TRANSPORT_FUKSIARZ"`

### Task 10: fuksiarz live parity (implementer), merge and gate (owner, deferred)

- [ ] As Task 4 Steps 1–5, with `--bookmaker fuksiarz`, `SCRAPER_TRANSPORT_FUKSIARZ=browser`, the files `.scratch/perf-smoke/fuksiarz-{browser,http}-03.json`, the A10 grep `^\[Aggregator/FullOffer\] fuksiarz (success|partial):`, and the gate values from the table.

---

## Betfan group (branch `perf/03-rest-market-betfan`)

| Item | Value |
|---|---|
| Precondition | fuksiarz merged and its gate recorded. If betfan.md's live acceptance (Tasks 1–2, on integration) is still pending, wait until the owner has recorded it. |
| Fixture command | `mkdir -p $F/betfan && $H python3 -I -c "$R2" $E/betfan-totalbet/bf-list-244.json $F/betfan 40932985,40933001,40932982 $E/betfan-totalbet/bf-ev-40932985.json $E/betfan-totalbet/bf-par-40933001.json $E/betfan-totalbet/bf-par-40932982.json` |
| URLS | list `https://betfan.pl/api/v1/market/categories/244/events`, detail `https://betfan.pl/api/v1/market/events/{id}` |
| Config | `listingUrl(c) = `${API_BASE_URL}/categories/${c}/events`` (`betfan/constants.ts:16`), `detailUrl(id) = `${API_BASE_URL}/events/${id}``. `listingEvents`: `body.data.categories` must be an array, else `listing without events ${url}`; events are `categories[0]?.events ?? []`, so an empty category list is an empty listing. `detailEvent`: `body.data.event` must be an object with `eventId`, else `detail without event data ${url}` |
| Mapping fields | `matchId`, teams (`parseTeamNames(listed)`, participants) and `eventUrl` from the **listing**; `markets: parseAllMarkets(detail)` (`parser.ts:370`); `startTime: toIsoStartTime(detail.eventStart ?? listed.eventStart)`; `isValidEvent` `parser.ts:446` |
| Type change | `betfan/types.ts:63` `eventStartTime?: string` → `eventStart?: number`. Plan 01 Task 4 normally made this change already. |
| Old-path hunk | `betfan/index.ts:265-300`, both branches |
| Pins | `[["40932985",37],["40933001",36],["40932982",38]]` (re-proved on the future base); kickoff of 40932985 `2026-11-07T12:30:00.000Z` |
| 404 / 2-of-3 ids | 40933001 / 40933001 + 40932982 |
| Class, singleton | `:45` → `BetfanBrowserScraper`; delete `:327`; `logTag "[Betfan/FullOffer]"` |
| Importers | `bookmaker-registry.ts:9`, `scripts/betfan-market-discovery.ts:14`, `scripts/betfan-prep-audit.ts:17`, `test-scrapers.sh:26`; plan 01's `full-offer-fixtures.test.ts` |
| Gates | browser alone 9.3 s; A10 betfan ≥ **4 200** (0.75 × 5 600); start_time NULL 0; no `[Betfan/Navigation] Navigating to base site:` |

### Task 11: betfan offer mapping

**Files:** Create `src/scrapers/bookmakers/betfan/offer-mapping.ts` and the fixtures `$F/betfan/`. Modify `betfan/index.ts:265-300`, and `betfan/types.ts:63` if plan 01 Task 4 has not landed. Test `src/scrapers/bookmakers/betfan/__tests__/offer-mapping.test.ts`.

**Interfaces:** Produces `toBetfanOffer(listed: BetfanEvent, detail: BetfanEvent, league: string): FullMatchOffer | null`, with fields as in the table.

- [ ] **Step 1:** Run the fixture command. Write the Task 2 tests with the table's values; `detailOf(e)` reads `data.event`, and the browser side is compared on `matches` only. Replace the pseudo-event test with `requests exactly 3 details`.
- [ ] **Step 2:** `$H npx vitest run src/scrapers/bookmakers/betfan` → FAIL (module not found).
- [ ] **Step 3:** Implement the mapping. With plan 01 Task 4 landed, all tests pass; that is the parity proof. Without it, make the type change, and then only `the browser path stores the kickoff` fails; that failure is the parity proof.
- [ ] **Step 4:** Old path. Replace both branches with `const offer = toBetfanOffer(event, detailEvent?.games?.length ? detailEvent : event, leagueSlug)`, which keeps today's fallback until Task 12, followed by push and log. All pass, including plan 01's harness. `$H npx tsc --noEmit` 0. `$H npx vitest run` green.
- [ ] **Step 5:** `git commit -m "refactor(betfan): extract full-offer mapping and store kickoff from eventStart"`

### Task 12: betfan over HTTP

**Files:** Create `src/scrapers/shared/rest-market/brands/betfan.ts`. Modify `betfan/index.ts` (the class, the skip when `fetchEventDetails` returns null, the singleton) and `bookmakers/index.ts:13`. Repoint the importers from the table, including the rename in plan 01's harness. Tests: `__tests__/betfan-transport.test.ts`, plus a selection row.

**Interfaces:** Produces `BETFAN_REST_MARKET` (own `listingEvents`/`detailEvent`, see the table), `BetfanHttpScraper` (`transport === "http"`), `BetfanBrowserScraper`, and `betfanScraper: FullOfferScraper`.

- [ ] **Step 1:** Port Task 3's tests with the table's values, including `declares transport http`. The 2-of-3 regex ends `https:\/\/betfan\.pl\/api\/v1\/market\/events\/(40933001|40932982)`. The challenge text uses `SCRAPER_TRANSPORT_BETFAN`. Drop the combo test. Add:
  - `it("skips betfan's error envelope")`: 40933001 → `{"isError":true,"code":404,"data":null}` with HTTP 200. On the HTTP side, `skipped[0].error === "detail without event data https://betfan.pl/api/v1/market/events/40933001"`. Both paths return ids `["40932985","40932982"]`.
  - `it("a category list without events is an empty listing")`: list `{"isError":false,"code":200,"data":{"categories":[]}}` → `toMatchObject({ success: true, matches: [] })` and calls == [list] (README §3 empty-listing rule). The runner warns `[Betfan/FullOffer] No events found from API https://betfan.pl/api/v1/market/categories/244/events`.
  - `it("a listing without categories is an error")`: list `{"isError":true,"code":500,"data":null}` → `success: false`, error `listing without events https://betfan.pl/api/v1/market/categories/244/events`.
  - The selection row.
- [ ] **Step 2:** FAIL (`../brands/betfan.js` missing).
- [ ] **Step 3:** Implement as Task 3 Step 3. In the browser path, `if (!detailEvent) { console.warn(`[Betfan/FullOffer] Skipping ${event.eventId}: detail failed`); continue; }`, then `toBetfanOffer(event, detailEvent, leagueSlug)`.
- [ ] **Step 4:** Tests pass, including plan 01's harness. `$H npx tsc --noEmit` 0. `$H npx vitest run` green. The scripts `tsc` command (`$H`) on both betfan scripts → 0. `grep -rn "BetfanPlaywrightScraper\|bookmakers/betfan/index.js" src scripts` → no output.
- [ ] **Step 5:** `git commit -m "feat(betfan): browserless full offer; browser path behind SCRAPER_TRANSPORT_BETFAN"`

### Task 13: betfan live parity (implementer), merge and gate (owner, deferred)

- [ ] As Task 4 Steps 1–5, with `--bookmaker betfan`, `SCRAPER_TRANSPORT_BETFAN=browser`, the files `.scratch/perf-smoke/betfan-{browser,http}-03.json`, the A10 grep `^\[Aggregator/FullOffer\] betfan (success|partial):`, and the gate values from the table.
- [ ] After this merge (owner, deferred): `grep -c "Navigating to" <log of one scheduled run>` must show no line from etoto, forbet, fuksiarz or betfan. That is four fewer Chromium instances per run, leaving 6 browser scrapers (betcris, fortuna, lvbet, pzbuk, sts, superbet) until plans 04/05 land.

---

## Self-Review

Re-run on 2026-11-13 against the future base.

1. **Spec coverage.**
   - One shared module with per-brand configs (Tasks 1, 3, 6, 9, 12).
   - Parity pattern: each mapping is proven against the untouched old class before the switch (Step 3 of Tasks 2, 5, 8 and 11). Browser results are compared on `matches` only, because observability's recorder adds `diagnostics`.
   - Skip on a failed detail in both transports, and the >50 % rule via `HttpScraper` (Tasks 1, 3).
   - Empty listing per README §3: `success: true, matches: []`, which observability classifies as `empty`. A malformed envelope is a failure (Tasks 1, 3, 12).
   - `start_time`: plan 01's `toIsoStartTime` is the only converter, and its ownership is stated (Task 1 Files, Task 2 Step 3). fuksiarz is shown to be already correct.
   - Browser classes are kept behind `getTransportOverride` in `bookmakers/index.ts`, the single pick per README §3. Every direct importer is repointed, including plan 01's harness (cross-plan #4).
   - `readonly transport = "http" as const` on `RestMarketHttpScraper`, pinned per brand.
   - The etoto Cloudflare detection and runbook use observability's real signals (Task 1 hint, Task 4 Step 4).
   - Fixtures come from the named evidence through trim recipes, and the pins were re-proved on the future base. Per-brand merge order, plus a "recovery live acceptance recorded" gate per brand.
   - A10 floors for all four come from `RUN2_OK` (observability `run-fixtures.ts`), grepped on the `[Aggregator/FullOffer] <bm> <status>:` line.
   - perf-smoke criteria follow README §6/§7. The category-id duplication is solved cheaply: the HTTP path reads `leagues.ts`, and a guard (still green on the future base) covers the remaining copies.
2. **Step scan.**
   - No TBD. Every test has exact values. Every heavy command goes through `$H`.
   - No step writes to the DB or into the main checkout. Merges and post-merge gates are the owner's, with exact commands and pass criteria.
   - Fixed: the betfan listing trim first kept the category-level `gameTypes` (231 KB). R2 now drops it (25 KB).
   - Fixed: the 2-of-3 failure tests use 404, which is never retried, rather than 503. That keeps them independent of the retry backoff.
   - Fixed in the 2026-11-13 revision:
     - "empty listing is an error" is now success with 0 matches;
     - the duplicate `kickoffIso` is gone;
     - the fake page has become an `EventEmitter`;
     - the evidence outputs moved from `$E` to `.scratch/`;
     - the `[ScrapeRun]` signal, which never carried error text, was replaced.
3. **Type consistency.**
   - `RestMarketBrand<E>` has one type parameter, because listing and detail share the event type in all four brands.
   - `to<Brand>Offer(listed, detail, league)` has the same shape everywhere, and every mapping uses `toIsoStartTime`.
   - `etotoScraper` and the other picks are typed `FullOfferScraper` (§3). The class names follow §3: `<Brand>BrowserScraper` and `<Brand>HttpScraper` with `transport: "http"`.
   - The harness names `ReplayRoutes`, `driveBrowserScraperOffline` and `withoutScrapedAt` are the ones plan 04 Task 0 moves.
4. **Review focus.** Each of the five items has a named test in Task 1 or 3, or in its brand variants. Item 4 now also covers a truly empty listing.
5. **Proportion.** Signatures, test names and assertions only. The one algorithm sketch is the runner order, because listing order, hint placement and the empty-listing return are not implied by the signatures. The three later brands reuse the Task 2–4 steps through a value table instead of repeating them.

## Open Questions

1. **Automatic browser fallback on a challenge.** Should the HTTP scraper retry through Chromium by itself when the listing returns 403/503/HTML? Default: **no**. Keep the manual `SCRAPER_TRANSPORT_<BM>=browser` flag, because an automatic fallback would hide a block and silently bring Chromium back onto the hourly path. The error text names the flag.
2. **The >50 % failure rule in the browser fallback.** The browser path now skips failed details but still reports `success: true`. Should it also fail the run above `MAX_SKIPPED_DETAIL_RATIO`? Default: **no**. It is a one-release fallback that plan 10 deletes, and skipping already stops the snapshot wipe.
