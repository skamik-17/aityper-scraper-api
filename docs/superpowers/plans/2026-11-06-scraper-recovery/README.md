# 2026-11-06 Scraper Recovery: Index

This directory holds the analysis and implementation plans from the 2026-11-06 scraper health check. There is one plan per broken or degraded bookmaker, one shared plan for Betters and LeBull, and one cross-cutting observability plan. Each plan has its own evidence under `evidence/<bm>/`.

**State as of 2026-11-06 ~18:10Z.**
- Analysis only: no source file has been changed.
- Every plan got one review pass, and every verdict was **needs-changes**. Each plan was then revised to address every review issue. None was rejected outright; where a fix differs from the reviewer's suggestion, the plan documents why. No second review has been run.
- `docs/superpowers/` is untracked in git (`git status` → `?? docs/superpowers/`). See step 0.1 in section 4.

All `file:line` references below were re-checked against `master` @ `377b47e` while this index was written.

---

## 1. Context

On 2026-11-06 the scraper service ran for the first time since about 2026-08-22 (`tsx watch`, premier-league only, hourly schedule).

The first run (`7067e5f0`, ~15:45Z) started while the local Supabase stack was still down. That was an operator error, but it exposed a reporting bug: 7 bookmakers scraped 20 matches each and saved 0 rows, yet the run reported `10 success` and health showed them 100 % healthy. Runs 2–4 (DB up) saved 9–10 bookmakers each.

Four scrapers return 0 matches in every run because their sites changed platform:
- **betters and lebull:** moved to Betby.
- **pzbuk:** moved to a new WebSocket protocol.
- **totalbet:** moved to a UUID "dealer" API. Its old API has returned 404 since at least June 2026.

Betcris failed once (run 2): it has a single fixed 12 s capture window, no retry and no logged reason.

The per-bookmaker checks also found:
- load-dependent data loss (sts, betclic);
- bookmaker-side offer changes that silently push markets to OTHER (sts, lvbet, betcris, fuksiarz, etoto);
- two live fake +EV integrity defects (forbet, fortuna).

None of this was visible in the service's own reporting:
- failures surface as a generic `No events found from API`;
- `scraper_runs` has never been written;
- `bookmakerStatus` reports 1 of 14 bookmakers available (re-checked 18:06Z: only `sts` is `available`, and `lastUpdated` is `null`).

| Run | Start (UTC) | Reported | What was actually saved |
|---|---|---|---|
| `7067e5f0` | ~15:45 (DB down at start) | `10 success` | 3 bookmakers (betclic, sts, betcris; 19 028 rows). 7 logged `20 matches, 0 markets saved` and still counted as success |
| `440d2fc6` | 16:00 | `9 success` | 9 bookmakers; betcris returned 0 matches; sts had 2 matches with 1 market |
| `de6129e8` | 17:00 | `10 success` | 10 bookmakers; sts had 5 matches with 1 market |
| `89d8432f` | 18:00 | `10 success` | 10 bookmakers; sts had 1 match with 1 market |

betters, lebull, pzbuk and totalbet returned 0 matches in all four runs. Source: the cleaned live log, `[Aggregator/FullOffer] <bm> completed` lines.

---

## 2. Per-bookmaker status

Status:
- **healthy:** no regression versus August.
- **degraded:** the scraper runs, but data is wrong, misrouted or missing.
- **flaky:** a load-dependent loss of whole runs or groups.
- **broken:** 0 matches in every run.

Effort uses each plan's own S / M / L scale. The task counts come from the revised plan files and exclude no-code verification tasks.

| Bookmaker | Status | Root cause (short) | Effort | Plan | Review |
|---|---|---|---|---|---|
| sts | degraded | **Capture race:** the wait ends on the 3.2 MB `i_pl` frame, and small delta frames overwrite the fixture snapshot (`sts/navigation.ts:116-125`, `:233-238`). As a result 2 / 5 / 1 matches in runs 2–4 came out with 1 market, and the prune step deleted their good snapshots. **Lost player markets:** player ids were renumbered (2003/2008/2146), and the new per-player lines have a nameless outcome 74, so `GOALSCORER_ANYTIME` and `PLAYER_*` appear in 0/20 matches. **Also:** the r=17 team-stats group is never read, and a substring tournament filter adds 16 non-PL navigations per run. | L (7 tasks + live switch; Task 1 ships first) | [sts.md](sts.md) | needs-changes (14) → revised |
| fortuna | degraded (scraper healthy) | **Live P0, odds integrity:** `ufo:mtyp:00-0p`, the first-half corners race, maps to `MATCH_WINNER` (`fortuna-normalizer.ts:206`) and is rerouted to `HALF_TIME_RESULT`. On 2 matches the served half-time draw is a corners-race price: Man Utd–Aston Villa DRAW 5.2 vs peer median 2.435, re-checked 18:06Z. **Also:** single-name players land under `base`, team prefixes leak into player names, 25 live ids with existing catalog codes are unmapped, and the exact-goals digit labels are rewritten. | M (5 tasks + optional Task 6; Task 1 alone is small). The pre-review draft said S | [fortuna.md](fortuna.md) | needs-changes (16) → revised |
| betclic | flaky | **Truncated responses:** the gRPC-web reader resolves after a fixed 1000 ms cutoff (`betclic/navigation.ts:111-117`, `GRPC_READ_TIMEOUT` at `betclic/constants.ts:172`) without checking that the frame is complete. Under load groups are truncated: 2 / 8 / 4 matches lost markets in runs 1–3. **Also:** the penalty "any team" label leaks as a raw code, OPTA offsides and fouls go to OTHER, and `TEAM_TOTAL_TACKLES` keys have no side. | M (3 tasks) | [betclic.md](betclic.md) | needs-changes (18) → revised |
| superbet | healthy | No regression: the like-for-like A/B loses 0 codes and gains 16. **Four pre-existing defects:** the bare `o\/?u` in the TOTAL_GOALS name pattern (`superbet-normalizer.ts:571`) catches "B**ou**rnemouth" and "T**ou**louse"; the exact-goals family is unmapped; `externalId` is stored as the string `"undefined"`; and no fixture pins the new player-name format. | S (4 tasks + optional Task 5). The pre-review draft said "none" | [superbet.md](superbet.md) | needs-changes (12) → revised |
| lvbet | degraded | **New ladder shape:** player-stat props moved to `<Player> N+` ladders in "Zawodnicy - statystyki", which neither the parser nor the normalizer knows. **Parser types:** they read id fields the v5 API does not send, so same-name exact-goals twins are de-duplicated away. **Catch-all patterns:** the `TOTAL_GOALS` catch-all (`lvbet-normalizer.ts:98`) and a merge with the half-time 3-way total drop LVBet from O/U 2.5/3.5 and from half-time line 1 in 20/20 matches. | M (5 tasks) | [lvbet.md](lvbet.md) | needs-changes (15) → revised |
| fuksiarz | degraded | Raw odds are correct. **P0 (Task 0, added after review):** `repairHalfWithMoreGoalsLabels` (`parser.ts:173-187`) now inverts the corrected upstream HALF_WITH_MORE_GOALS prices in 20/20 matches (fake best price on 2ND_HALF). **Player names:** the new "I. Surname" names win the grouper's label tie-break (`market-type-grouper.ts:236-242`). 101 / 86 player labels per match show the abbreviation, and 2 / 17 rows per match are stranded outside the peer comparison. **Unmapped:** gameTypes -4895/-4896 and -30640. | S (3 tasks + optional Task 3). Tasks 1–2 change the **shared** grouper | [fuksiarz.md](fuksiarz.md) | needs-changes (14) → revised |
| betfan | degraded | **Side-less team lines:** `TEAM_LINE_PARAM_MARKETS` (`betfan-normalizer.ts:1401`) holds only CORNERS_TEAM and CARDS_TEAM, so team shots lines have no side and miss the peers' `HOME:`/`AWAY:` rows. **Fouls:** team fouls are side-less, and the away id 163 is unmapped and lands in OTHER. OPTA team lines appear on match day only. Volume is at or above August. | S (2 tasks) | [betfan.md](betfan.md) | needs-changes (12) → revised |
| forbet | degraded (odds integrity) | **Live fake +EV:** `-31170` TurboPrzewaga maps to `EUROPEAN_HANDICAP` (`forbet-normalizer.ts:48`), and the digit fallback (`:1570-1572`) turns "2 gole" into the +2 line. forbet sits on EH +2 in 20/20 matches at 1.4–3.2× the peer price (Everton–Coventry HOME 1.6 vs median 1.04, re-checked 18:06Z) and displaces the real "Handicap 2:0" row in 19/20. | S (1 task + optional Task 2) | [forbet.md](forbet.md) | needs-changes (10) → revised |
| etoto | degraded | **Side-less team lines:** team OPTA ids (162/163, 168/169, -30727/-30728) have no entry in `ETOTO_MARKET_ID_TEAM_SIDE` (`etoto-normalizer.ts:291`), and the side prefix fires only for CORNERS_TEAM (`:1239-1241`). **Penalty:** the market was renamed to id -30591, which is unmapped, so `PENALTY_AWARDED` is lost. | S (3 tasks) | [etoto.md](etoto.md) | needs-changes (11) → revised |
| betters | broken | **Platform move:** the brand moved from sbteam SSR to Betby (Sportradar UOF). The old host (`betters/constants.ts:14`) returns 404 on every path, the 8 s capture times out, and the run reports "No events found from API". The new API answers plain `fetch`, so no browser is needed. | L, shared with lebull (8 tasks + optional stop-gap + owner-gated frontend Task 9) | [betby-betters-lebull.md](betby-betters-lebull.md) | needs-changes (15) → revised |
| lebull | broken | **Platform move:** same move to Betby, served through the sbteam proxy `betting-betby-secundus.prod.sbteam.xyz`. The old host (`lebull/constants.ts:12`) returns 404. One shared Betby client, parser and normalizer serves both brands. | (shared plan above) | [betby-betters-lebull.md](betby-betters-lebull.md) | (same) |
| betcris | flaky | **Capture window:** one 12 s window (`betcris/constants.ts:168`) whose clock starts before `page.goto` (`betcris/navigation.ts:124`, `:166-171`), with no retry and no logged reason. The production listing takes 8–12+ s, so run 2 failed; 3 of 4 runs succeeded. **Renamed stats ids:** separately, Betcris renamed its stats-family Swarm ids and switched them to `N+` ladders, so 55 August codes now land in OTHER (27.8 % of one match). **Redirect:** a live betcris.pl → betsport.pl client redirect is in place. | M (6 tasks) | [betcris.md](betcris.md) | needs-changes (23) → revised |
| pzbuk | broken | **New transport:** the socket moved to `sportsbook-api/ws`, and frames are now JSON DATA envelopes. The URL filter (`pzbuk/constants.ts:249`) and the slice-and-parse (`pzbuk/navigation.ts:242-248`) drop every frame. **Deeper, pre-existing:** only the largest markets array is kept (`:265`), so 69 of 167 markets get placeholder names. Once the real names are back they expose 16 misrouted ids (e.g. 126 "Kartki 1x2" → `MATCH_WINNER`). | M (7 tasks, strict order) | [pzbuk.md](pzbuk.md) | needs-changes (10) → revised |
| totalbet | broken | **Platform move:** the site moved to a UUID "dealer" API (`/dealer/bdata/v1/bet/events`). The scraper still calls the removed numeric API (`totalbet/constants.ts:16`, HTTP 404) and reports "No events found from API" (`totalbet/index.ts:252-262`). **Unsafe old normalizer:** its numeric ids now mean other markets, e.g. double chance would be stored as odd/even. It last worked in January 2026. | M (5 tasks + optional stop-gap) | [totalbet.md](totalbet.md) | needs-changes (14) → revised |
| *(all 14)* | cross-cutting | **Reporting records claims, not saves:** run reporting and health record what each scraper claimed, not what was saved. There is no DB preflight, the real failure causes are dropped, `scraper_runs` is never written, and `bookmakerStatus` is truncated by PostgREST `max_rows`. See section 3. | L (10 tasks + 1 DB migration) | [observability.md](observability.md) | needs-changes (20) → revised |

Notes:
- **fortuna** is listed as degraded. The pre-review metadata said "healthy", but the revised plan treats the half-time 1X2 defect as a live P0. The scraper transport itself is healthy.
- **Review counts** are the issue counts the reviewer reported. A few revision notes count fewer, because some items were merged: observability 18, fuksiarz 13, superbet 11.

---

## 3. Cross-cutting work

### 3.1 Observability ([observability.md](observability.md))

What it fixes. Every citation below was re-verified:

- **Success is counted without persistence.**
  - `normalizeAndSaveMatches` runs at `src/scrapers/aggregator.ts:260-272`. Its result is only logged.
  - `successCount++` at `:307` depends only on `result.success && matches.length > 0`.
  - `src/services/scraper-service.ts:49-55` records the scraper's own flag in health.
  - Consequence: run 1 reported "10 success" with 7 bookmakers at 0 rows saved.
- **No DB preflight.**
  - `src/index.ts:84-99` only warns when the DB is unreachable, and skips the `market_types` sync.
  - The startup scrape still fires 5 s later (`src/services/scheduler-service.ts:151-165`).
- **Real causes are dropped.** pzbuk, betters, lebull and totalbet all end up as `No events found from API` or `No WebSocket data captured`. A navigation recorder prototype already captures the real cause for each: `document HTTP 404` (betters, lebull), `fetch HTTP 404` (totalbet) and the unmatched socket URL (pzbuk).
- **`scraper_runs` is never written.** `insertScraperRuns` is imported at `scraper-service.ts:3` and never called. As a result `meta.lastUpdated` is `null` and `/api/admin/runs` is empty.
- **`bookmakerStatus` is wrong.**
  - `getBookmakerStatus` (`src/repositories/odds-repository.ts:131-164`) selects every odds row with no limit.
  - PostgREST caps the result at `max_rows = 1000` (`supabase/config.toml:18`), and the newest 1 000 rows are all sts.
  - Result: 13 of 14 bookmakers show `stale`, including the 9 that saved data minutes earlier.

Why it should go first, or at least in parallel:
1. **It is the only safeguard against a repeat of today.** Platform moves went unnoticed for weeks (totalbet's numeric API has been gone since at least June), and a DB outage looks like success. Without it, the next silent break is found the same way: by accident.
2. **Several plans' acceptance checks cannot use `bookmakerStatus` until it lands.** totalbet A6 and betclic, for example, check `scrapedAt` freshness instead. Its `scripts/smoke-bookmaker.ts` (Task 9) and per-bookmaker run lines give every other plan one uniform verification command.
3. **It changes no parser, normalizer or catalog.** Golden fixtures must pass unchanged, so it cannot conflict with the per-bookmaker data fixes.
4. **It does not block them either.**
   - betcris says either landing order works.
   - totalbet says that if it lands first, it updates one acceptance row of observability (A4).
   - pzbuk deliberately does not touch `aggregator.ts` or `scraper-service.ts`.
   - betby is a soft dependency.

So run it in parallel, and do not gate the integrity fixes on it.

Inside the plan, the highest-value tasks are:
- **Task 1:** run-outcome classification and DB error causes.
- **Task 2:** the navigation recorder in `executeFullOfferScrape`.
- **Task 3:** honest aggregator outcomes.
- **Task 7:** DB preflight.

Tasks 4, 5 and 8 (persist runs, then status from run history and the API) need migration `11_scraper_runs_observability.sql`. Apply it only with operator approval and only in the single-file form, `./scripts/apply-migrations.sh 11_scraper_runs_observability.sql`. The no-argument form, which `package.json:16` (`npm run db:migrate`) advertises, re-applies every migration in `supabase/migrations/` against the live DB (`scripts/apply-migrations.sh:72-99`). Task 10 turns it into a usage error.

### 3.2 Shared components and conventions used by several plans

| Component | Where | Used by | Recommendation |
|---|---|---|---|
| **Prep-audit archive keeps `paramValue` (and selection `externalId`).** Today `buildPrepAuditOutput` archives `raw` without them (`src/services/audit/scraper-audit-core.ts:370-376`), so any line or player market harvested from an audit archive comes back with no line, or as `expected: null`. | betby Task 1 (superset: `paramValue` + `externalId`), lvbet Task 4, betcris Task 5 Step 1 | Golden harvests of lvbet, betcris, betby (and totalbet's archive workaround). pzbuk and totalbet ask about it as an open question | Land **once**, as betby Task 1, before any new golden harvest. lvbet and betcris already say "skip if it landed". Committed fixtures stay byte-identical (`rebless-golden --all --dry` → `changedTotal:0`). |
| **Grouper player-name reconciliation.** | fuksiarz Tasks 1–2 (`market-type-grouper.ts:228-351`) | Every bookmaker's player labels and player-row merging. Also fixes a latent hazard where an LVBet "A or B" combo price gets folded into a single-player row | Land before the other player-label work (fortuna Task 2, superbet Task 4, sts Task 6), so their live label checks measure the final grouper. |
| **Decision D1, team fouls convention:** `HOME_/AWAY_TEAM_TOTAL_FOULS` rather than `TEAM_TOTAL_FOULS` with a side param. | etoto Task 2, betfan Task 2 | Pooling with forbet, fortuna and superbet | Decide once and land etoto and betfan together. fuksiarz still emits the side-less code (open question). |
| **"Result or 2-goal lead" target code.** | forbet Task 1 (decision OQ1) | fortuna Task 6 (`00-p1`) follows forbet's answer | Decide before forbet Task 1. |
| **Integer Asian-handicap lines:** `ASIAN_HANDICAP` vs `ASIAN_HANDICAP_PUSH`. | betby decision D1, needed before betby Task 5 | Pooling with 5 bookmakers (`ASIAN_HANDICAP`) or with sts only (`_PUSH`) | Decide before betby Task 5. A catalog-wide unification is a separate task. |
| **Betby shared module** (`src/scrapers/shared/betby/`). | betby Tasks 2–6 | betters and lebull, and any future Betby brand | Already shared inside the plan. |
| **Not planned anywhere yet** | — | — | 1. A prune guard: today a degenerate new write deletes a good snapshot (sts open question 3; `pruneStaleOddsRows`, `full-offer-repository.ts:267`, called at `:683` when a batch had 0 errors). 2. The dead stealth/resource-blocking path: `initBrowser` returns at `playwright-base.ts:119`, before blocking (`:140`) and stealth (`:150`) run. 3. A per-leg peer-median deviation detector, which would have caught fortuna's half-time draw; the typed detectors did not. betby Task 8 fixes `scripts/odds-outliers.ts` (its match listing fails today), which the integrity checks of other plans could also reuse. |

### 3.3 Constraints every plan shares

- **Never edit `src/` in the live checkout.** `tsx watch` restarts on every save, and 5 s later the startup scrape runs all 14 bookmakers and writes to the DB (`scheduler-service.ts:151-165`). Every plan therefore works in its own git worktree. Merging a branch into the live checkout restarts the service once, with a full scrape.
- **Evidence is untracked.** A worktree cut from `master` has neither the plans nor `evidence/`, so plans read evidence by absolute path into this directory. See step 0.1.
- **No plan changes `src/data/market-catalog.ts`.** So none runs `scripts/sync-market-types.ts`. Every catalog change is an open question (section 5, group D).
- **Golden discipline is the same everywhere.** Write the failing test first. Rebless only after an inspected `--dry` diff. `scripts/harvest-fixtures.ts` still defaults to the pre-split monorepo layout, so always pass `--out-dir` and `--registry`.
- **Several plans edit the same files.** Keep the hunks minimal and rebase carefully:
  - `src/config/leagues.ts`: totalbet Tasks 0 and 4, betby Task 6.
  - `src/config/index.ts`: betby Task 0, totalbet Task 0 variant B, observability Task 6.
  - `src/services/audit/scraper-audit-core.ts`: the shared harness change.
- **The calendar limits live checks.**
  - The near-term round ends Sun 2026-11-08 16:30Z. Then comes the international break, and the next round is 21–23 Nov.
  - OPTA team lines appear on match day only (etoto, betfan).
  - STS publishes its full offer only about 2 days ahead.
  - LVBet ladders and Fuksiarz player props are near-term only.
  - Every plan has an offline, calendar-independent merge gate. Its live acceptance needs either 7–8 Nov or about 19–23 Nov.

---

## 4. Recommended execution order

The guiding rule is the product's odds-integrity priority: a wrong price always wins best-odds and poisons +EV, which is worse than a missing bookmaker.

So the order is:
1. Stop live fake +EV and data loss first, with quick wins.
2. Then land shared components before the brand work that consumes them.
3. Then the brand fixes.
4. Then the platform migrations.

Development can run in parallel worktrees from day one, because the plans touch mostly disjoint files. The order below is the **merge** order. Each merge restarts the live service, so merge one branch at a time, not near HH:00 (the scheduled scrape), and check the next scheduled run before the next merge.

| Step | What | Plan / tasks | Effort | Depends on | Why here |
|---|---|---|---|---|---|
| 0.1 | Commit this directory to `master` as a docs-only commit, so worktrees contain the plans and evidence. `tsx watch` does not watch `docs/`. | totalbet open question 8 (applies to all) | — | owner approval | Every plan's worktree setup otherwise depends on absolute paths into the live checkout. |
| 0.2 | Owner decisions that block code: (1) forbet TurboPrzewaga target; (2) D1 team fouls; (3) betby integer-AH convention; (4) whether `empty` counts as a failure. | section 5, group A | — | — | These decide test expectations in forbet Task 1, fortuna Task 6, etoto/betfan Task 2, betby Task 5 and observability Task 1. |
| 0.3 | Optional stop-gaps: pause betters and lebull (remove them from `CONFIG.BOOKMAKERS`, `src/config/index.ts:62-63`) and totalbet (remove the five `totalbet:` entries in `src/config/leagues.ts:32,54,76,98,120`; variant B also removes `src/config/index.ts:66`). | betby Task 0, totalbet Task 0 | S | owner approval | Reversible. Stops wasted browser time (8 s timeouts, a dead page load) in every run. The bookmakers then show as absent, not `stale`. It is **not** a measured fix for the load-driven races. |
| 1a | forbet: TurboPrzewaga off `EUROPEAN_HANDICAP:+2`. | forbet Task 1 | S | 0.2 (1) | Live fake +EV on 20/20 matches. Normalizer-only, one id plus a line guard, one blessed golden entry. |
| 1b | fortuna: a corners race never feeds a 1X2 code. | fortuna Task 1 | S | — | Live fake +EV (half-time DRAW +104–115 %). |
| 1b' | fuksiarz: price-guard the HALF_WITH_MORE_GOALS label repair (added by the orchestrator after review; see the fuksiarz.md addendum). | fuksiarz Task 0 | S | — | Live fake +EV: fuksiarz 2ND_HALF is the best price in 20/20 matches, 53–84 % above the best peer, because our own repair now inverts corrected upstream data. |
| 1c | sts: capture keeps the fixture snapshot and never emits a partial match. | sts Task 1 (ship-first) | S–M | — | Stops 1-market writes that also prune good snapshots (5/20 in run 3). |
| 1d | betclic: the gRPC-web reader resolves only on a complete frame. | betclic Task 1 | M | — | Stops per-run market loss under load. Self-contained (navigation and constants). |
| 1∥ | Observability core, in parallel with steps 1a–1d. | observability Tasks 1, 2, 3, 7, then 9 | M of the L plan | — | See 3.1. Makes every later merge verifiable from one run line, and refuses runs against a dead DB. |
| 2a | Shared harness: archive `paramValue` and `externalId`. | betby Task 1 | S | — | Consumed by the golden harvests in steps 3e, 4c and 4d. Must precede them. |
| 2b | Shared grouper: player-label tie-break, stranded abbreviated rows, combo guard. | fuksiarz Tasks 1–2 | S–M | — | Shared code that affects every bookmaker's player rows. Also removes an odds-integrity hazard (combo price folded into a single player). |
| 2c | Observability remainder: `scraper_runs` persistence, status from run history, API surfaces, CLI, dev-stack script. | observability Tasks 4–6, 8, 10, then the Task 11 live check | M | 1∥; migration 11 approval | Fixes `bookmakerStatus`, `lastUpdated` and the alert line. Needs the one DB migration. |
| 3a | etoto and betfan: team-stat side axis and fouls convention (+ etoto penalty id -30591). | etoto Tasks 0–3, betfan Tasks 1–2, one after the other | S + S | 0.2 (2) | Same convention, so land them back to back. The live check needs a matchday window. |
| 3b | fortuna remainder: player names, new and pre-existing ids, exact goals (+ Task 6 if chosen). | fortuna Tasks 2–5 (+6) | M | 2b (labels); 0.2 (1) for Task 6 | Coverage and labels. No integrity risk left after 1b. |
| 3c | superbet: "ou" misroute, exact goals, `externalId`, format pins (+ optional Task 5). | superbet Tasks 1–4 (+5) | S | 2b for the Task 4 label checks | Pre-existing defects, healthy bookmaker, so low urgency. |
| 3d | sts remainder: strict tournament filter, normalizer ids, O/U lines, r=17 group, per-player fold, replay gate, switch. | sts Tasks 2–8 | L | 1c; 2b for the label checks | Restores the player markets lost since August. The offline replay (Task 7) is the merge gate. |
| 3e | lvbet: payload types, ladders, catch-all routing, golden fixture. | lvbet Tasks 1–3, then 5 (Task 4 is already done by 2a) | M | 2a for Task 5 | Brings LVBet back into the O/U 2.5/3.5 comparison and restores the player props. |
| 3f | betclic remainder and fuksiarz mapping: penalty ANY, OPTA offsides/fouls, side-scoped tackles; fuksiarz gameTypes. | betclic Tasks 2–3, fuksiarz Task 4 (+ optional Task 3) | S | 1d, 2b | Small coverage fixes. |
| 3g | forbet optional alternative bets. | forbet Task 2 | S | 1a | Coverage parity with etoto. |
| 4a | totalbet migration to the dealer API (browserless). | totalbet Tasks 1–6 | M | 0.3 optional; rebase on `leagues.ts` | Self-contained and fully evidenced. Restores a bookmaker absent since before August. |
| 4b | pzbuk: new WS protocol, real names, normalizer integrity. | pzbuk Tasks 1–7 | M | none, but **Task 4 must be in the same tree before the Task 5 wiring is served** | Without Task 4, the first live run would publish misroutes (e.g. id 126 as `MATCH_WINNER`). |
| 4c | Betby migration for betters and lebull (browserless), then the frontend ledger reset. | betby Tasks S, 2–8, then the owner-gated Task 9 | L | 2a; 0.2 (3); rebase on `leagues.ts` | Largest piece. Its shared module and smoke gate are built before the brand wiring. |
| 4d | betcris: classified, retried capture; ladder split and renamed ids; golden; unmapped-ids summary. | betcris Tasks 1–2 (can merge as early as after step 1), then 3–4, then 5–6, then the Task 7 live acceptance | M | 2a for Task 5 | Re-run acceptance A2 (3 consecutive full runs) after 4a–4c, because they change start-burst contention. pzbuk adds about 6 minutes of browser time per league; totalbet and Betby leave Playwright. |

**Known gaps not covered by any plan in this directory** (found by the parallel audit-process review, `aityper/docs/superpowers/specs/2026-11-06-audit-process-review.md`):
- **Team side in derbies (S3 there, deadline 2026-12-02 Newcastle United – Manchester United):** the local `isTeamInSelection` matchers in `sts-normalizer.ts:394-431` and `betclic-normalizer.ts:952-1000` accept one shared word and test HOME first, so an away label containing a word of the home club's name is coded HOME. Needs its own plan (shared `resolveTeamSide`, generated side-resolution test across all normalizers, duplicate-HOME invariant at save time).
- **Ghost fixtures already in the DB** (e.g. STS "Ashton United – Ilkeston Town" stored as `premier-league:newcastle united:luton town`): sts Task 2 stops new ones, but existing rows need a dry-run/`--apply` cleanup, and the PL team whitelist (32 teams from 2024/25, Fuse threshold 0.4) still lets foreign clubs fuzzy-match (S4 there).
- **Retention:** the 03:00 cleanup cron never ran because the service is started manually; 58 % of `odds` rows are older than 24 h (S8 there).

Rationale for not doing the migrations first:
1. They are the largest items (2 × M, 1 × L).
2. Each restores one absent bookmaker, while steps 1a–1b remove wrong prices that users see today.
3. The optional stop-gaps make their absence explicit in the meantime.

They have no code dependency on steps 1–3 (except Betby on 2a), so start them in parallel worktrees right away.

---

## 5. Open questions for the owner (deduplicated)

Each item cites its source plan and open-question number (OQ#). Where a plan proposes a default, it is given in brackets.

### A. Blocking or sequencing decisions

1. **Docs commit.** Commit `docs/superpowers/plans/2026-11-06-scraper-recovery/` to `master` as a docs-only commit before work starts? (totalbet OQ8; all plans otherwise use absolute evidence paths.)
2. **Stop-gaps now?** Pause betters and lebull (`CONFIG.BOOKMAKERS`) and totalbet (`leagues.ts` entries, or variant B: also `CONFIG.BOOKMAKERS`) now, or wait for the migrations? (betby OQ1, totalbet OQ1)
3. **TurboPrzewaga** (forbet `-31170`). Two options; the same answer decides fortuna `00-p1` (fortuna Task 6). (forbet OQ1, fortuna OQ3; the plan prefers (b) unless the owner accepts a peerless card.)
   - (a) 3-way `MATCH_RESULT_OR_WIN_BY_2`: no peers, and the DRAW label may misdescribe the rule.
   - (b) 2-way `WIN_OR_WIN_BY_2`: betclic is a peer at 1.60/4.50 vs 1.63/4.50.
4. **D1 team fouls.** Use `HOME_/AWAY_TEAM_TOTAL_FOULS` for etoto and betfan? Should fuksiarz's side-less `TEAM_TOTAL_FOULS` follow in its own plan? (etoto OQ1, betfan OQ1) [yes]
5. **Betby integer handicap lines.** `ASIAN_HANDICAP` (pools with 5 bookmakers) or `ASIAN_HANDICAP_PUSH` (exact; pools with sts only)? (betby OQ6) [`ASIAN_HANDICAP`]
6. **Empty runs.** Does a run with scraper success but 0 matches (`empty`) count as a failure? pzbuk deliberately reports an empty listing as `success:true` so that this rule applies. (observability OQ1, pzbuk OQ7) [yes, with one league-level alert when at least half the bookmakers are empty]
7. **Shared archive change.** Approve, once for every bookmaker, that the prep-audit archive keeps `raw.paramValue` and selection `externalId` (`scraper-audit-core.ts:370-376`)? It is planned in betby Task 1, lvbet Task 4 and betcris Task 5, and asked in pzbuk OQ4 and totalbet OQ7.

### B. Observability, operations and integrity policy

8. **Alerts.** Is `ALERT_CONSECUTIVE_FAILURES=3` (3 h at the hourly interval) right? Is a Slack-compatible `ALERT_WEBHOOK_URL` wanted at all? (observability OQ2)
9. **Public error text.** May the unauthenticated `/api/health/scrapers` show `lastError` text, including internal hosts such as `127.0.0.1:54321`? (observability OQ3) [OK while local-first]
10. **`lastUpdated` meaning.** Accept that `meta.lastUpdated` becomes non-null, so the frontend label "Pobrano: HH:MM" shows the last scrape time? Or relabel it in a frontend follow-up? (observability OQ4)
11. **Retention.** Keep `scraper_runs` for a fixed period, e.g. 30 days in the 03:00 cleanup? (observability OQ5)
12. **Stale quotes.** Hide quotes from a bookmaker that has been in `error` longer than N × interval from `/api/odds` and normalized-markets? Today betcris's 15:46Z quotes were still served after its 16:00Z failure. (observability OQ6; odds integrity) [leave in place, only make visible]
13. **Prune guard.** Should the repository refuse to prune a previous snapshot when the new write for the same match and bookmaker is degenerate (< 10 % of its rows)? No plan implements this. (sts OQ3)
14. **Supabase CLI.** Pin the CLI as a devDependency (about 56 MB), or use the plan's default: a `docker start` fast path plus a pinned `npx --yes supabase@2.70.5 start` fallback? (observability OQ7)
15. **Dead browser path.** Fix the `initBrowser` path where stealth and resource blocking are never applied, in a separate plan? It changes bot-detection exposure for 13 scrapers at once. betcris also notes that the context UA claims Chrome/120 while the bundled Chromium is about 143. (observability OQ8)
16. **betcris retry budget.** Is a worst case of about 2.5 minutes acceptable when betcris is down (listing retried once), or should the listing use `MAX_ATTEMPTS: 1`? (betcris OQ4)

### C. Scope and mapping decisions per bookmaker

17. **sts:**
    - Ingest the r=12 "(z dogrywką)" player props? (OQ1) [skip]
    - Map the r=17 penalty markets, which are priced 30–60 % longer than peers? (OQ2) [no]
    - Enable the strict tournament filter for other leagues once their ids are verified? (OQ4)
    - Fix "Jack Butland" → "Butland Jack" name flips? (OQ5) [leave; separate plan]
18. **fortuna:**
    - Map `00-bu` to `PENALTY_OR_RED_CARD` despite its narrower settlement and a 26 % price gap? (OQ1) [no]
    - Write the deferred composite-markets plan next? (OQ4) [yes]
19. **betclic:** drop "Punkty za kartki" before save, so the count market's own prices and label are shown and about 80 collision warnings per run disappear? (OQ2) [recommended; needs approval]
20. **lvbet:**
    - Keep merging the yellow-card count and card points under `HALF_TIME_CARDS_TOTAL`? (OQ5)
    - Follow up on the `SECOND_HALF_ASIAN_HANDICAP` collision seen in 19/20 matches? (OQ6)
    - Is "Strzały celne spoza pola karnego" the peers' `PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX`, given a −36 % median price gap? (OQ7) [Task 2 maps it]
21. **fuksiarz:**
    - Ship the cosmetic Task 3? (OQ1)
    - Map -30640, although no PL peer quotes that code? (OQ2)
    - Strip " wyrzucony z boiska" from Fortuna's `PLAYER_RED_CARD` param, in the Fortuna plan? (OQ3)
22. **superbet:**
    - Run Task 5, mapping 238485 to `PLAYER_SHOTS_OUTSIDE_BOX` and keeping `PLAYER_ASSISTS` `3+`? (OQ2) [yes, yes, keep]
    - Map 200685 to `EACH_TEAM_TOTAL_CORNERS_OVER` as a follow-up? (OQ3) [backlog]
23. **forbet:** ship optional Task 2 together with Task 1, or later? (OQ2)
24. **betcris:**
    - Adopt the direct Node Swarm client as a follow-up plan? It is browserless and about 300 ms per game, but the protocol is undocumented and the ToS needs checking. (OQ1)
    - Keep pooling yellow-only and any-card first/last-card markets, and recoding `Exactly1GoalsinMatch` onto `EXACT_GOALS` "1"? (OQ2)
    - Run a coverage pass over the 146 unknown types per run? (OQ5)
    - Switch `BASE_URL` to www.betsport.pl? That changes the stored `eventUrl`s and the frontend deep links. (OQ6) [keep betcris.pl]
25. **pzbuk:**
    - Map the coverage-only ids in a follow-up `/audit-loop` round? (OQ1)
    - Make `marketType.originalName` the primary identity key? (OQ2)
    - Is id 126 "Kartki 1x2" right as `CARDS_RACE`, or should it go to OTHER? (OQ3)
    - Drop the 40 "Pokaż więcej" clicks per event (about 3–5 s each)? (OQ6)
26. **totalbet:**
    - Phase-1 scope: 39 codes, or strictly the 8 full-match families? Are phases 2 and 3 acceptable as later plans? (OQ2)
    - Wire the world-cup-2026 UUID although the tournament has ended? (OQ3) [wire it]
    - Reduce `scrapeMatchDetails` to 1X2 only? (OQ4)
    - Delete the unreferenced `src/data/bookmaker-markets/totalbet-full-markets.json`? (OQ6)
27. **betters and lebull:**
    - Keep the iframe-host LeBull `eventUrl`? (OQ2)
    - Is phase 1 (36 UOF market ids, about 66–73 normalized markets per near-term match) enough for go-live? (OQ3)
    - Accept that near-identical Betby prices are counted twice in cross-bookmaker medians? (OQ5)

### D. Catalog changes

Each needs `scripts/sync-market-types.ts`. No plan includes one.

28. **Player-parameter flips.** Set `hasParameter: true` (player) on `PLAYER_SHOTS_OUTSIDE_BOX` and `PLAYER_SHOTS_ON_TARGET_1H`, with tiers. Also define whether `PLAYER_PASSES` means accurate or total passes. (lvbet OQ1, betcris OQ3, superbet OQ2)
29. **New codes:**
    - left-foot, right-foot and 2nd-half shots on target; 1st-half team shots on target (betcris OQ3);
    - `FIRST_FOUL` (betclic OQ1) [stay OTHER];
    - points-based "both teams 2+ card points" (lvbet OQ2);
    - HT/FT + total goals combos (etoto OQ2);
    - STS r=12 props, if they get new codes (sts OQ1).
30. **New tiers:** a `5+` tier for `PLAYER_FOULS` and `PLAYER_FOULS_WON`. (lvbet OQ3)
31. **Parameterized half-time 3-way totals:** make `HALF_TIME_TOTAL_GOALS_3WAY` take a line, so LVBet's and betcris's half-time 3-way totals can map. (lvbet OQ4)
32. **Team axis:** add one to `TEAM_CORNERS_BOTH_HALVES_OVER`. (betfan OQ2)
33. **Consistent widgets:** give `AWAY_TEAM_TOTAL_FOULS` the same viewType as `HOME_TEAM_TOTAL_FOULS` (`STAT_RANGE`). (betfan OQ3; also noted in etoto Risks)
34. **Wording only, no sync needed:** fix the Polish copy of the three `*_OR_BTTS_NO` templates, which describe a different proposition from the one etoto, superbet and forbet price. (forbet Risks)

### E. Golden blessing and frontend-repo follow-ups

35. **Blessing.** Bless unblessed WC golden entries that the fixes change (fortuna: 26 entries; superbet: 5 exact-goals entries)? (fortuna OQ2, superbet OQ1) [leave unblessed]
36. **Frontend `aityper/docs/audit-ledger/` updates:**
    - copy the pzbuk and totalbet evidence archives into `raw-archive/` (pzbuk OQ5, totalbet OQ5);
    - retire the 21 open and 8 accepted-difference sbteam-era lebull entries, and reset lebull's `coverage.json` baseline after go-live (betby OQ4 / Task 9);
    - team fouls in `coverage.json`, for etoto and betfan (etoto OQ3; decision A4, etoto Task 2 and betfan Task 2). In both blocks, drop `TEAM_TOTAL_FOULS` and add `HOME_TEAM_TOTAL_FOULS` and `AWAY_TEAM_TOTAL_FOULS`, each with `["OVER", "UNDER"]`. Today both list only the side-less code: etoto at `coverage.json:6500` and betfan at `coverage.json:5371`. fuksiarz (`coverage.json:10360`) and lvbet (`coverage.json:12909`) keep `TEAM_TOTAL_FOULS`, because they still emit it. betfan still falls back to side-less `TEAM_TOTAL_FOULS` for a team name it cannot resolve (betfan.md Review Focus 4). Such a row is a name-resolution miss, not lost coverage, so drop the code for betfan anyway. This must be a manual edit. `scripts/build-coverage-baseline.ts:10-12` merges into the existing file and never removes a code, so a rebuild cannot drop `TEAM_TOTAL_FOULS`. The stale baseline has two separate effects to track:
      - a health check against it reports a false "missing `TEAM_TOTAL_FOULS`" for etoto and betfan;
      - the coverage gate hides missing-selection gaps on the new rows. The gate flags a gap only for a code that the baseline lists for that bookmaker (`scripts/match-audit-prep.ts:161-175`, applied at `src/services/audit/match-audit-core.ts:377`). Until the edit, a missing `OVER` or `UNDER` on an etoto or betfan `HOME_/AWAY_TEAM_TOTAL_FOULS` row is never reported. This happens only when the baseline is loaded, which today needs an explicit `--coverage`. The default path is stale, an older issue outside these plans: `REPO_ROOT` is `<repo>/..` (`scripts/match-audit-prep.ts:57`), and `resolveLedgerPath` (`:112-113`) returns null when the file is missing. So the "prep auto-detects" note in `aityper/.claude/commands/audit-loop.md:25` loads no coverage.
    - correct the 2026-08-20 match-audit wording that called totalbet "poza zakresem projektu" (totalbet OQ5).
