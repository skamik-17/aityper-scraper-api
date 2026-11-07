# Betcris Scraper Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Betcris returns ≥18 of 20 Premier League matches on every scheduled run, logs a classified reason when it cannot, and gets back the stats-family markets (player/team shots, fouls, offsides, saves, throw-ins) that Betcris renamed between August and November.

**Architecture:** Two independent changes. (1) Capture: replace `captureSwarmData()` plus the outer `Promise.race` timers with one `captureSwarm(page, url, config)`. It attaches its listener before `page.goto`, starts each deadline at a navigation or socket milestone instead of at call time, survives the live betcris.pl → betsport.pl client redirect, classifies failures, records diagnostics (final URL, Node event-loop lag), and retries site-level failures once. All four scraper entry points switch to it and log the reason on failure and the timings on success. (2) Data: the parser splits the renamed Swarm "N+" ladder markets into one entry per rung (team totals) or per player (player props). The normalizer maps the 25 new Swarm ids to existing catalog codes. The catalog does not change. Two small supporting changes: the prep-audit archive keeps `paramValue` so the new golden fixture freezes real keys, and one per-run unmapped-market summary line makes the next Swarm rename visible.

**Tech Stack:** TypeScript ESM (tsx), Playwright 1.57 (bundled Chromium), Vitest (fake timers), BetConstruct Swarm WebSocket protocol.

**Spec:** the Observations section of this file. Evidence lives in `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/`: `league-538-frames.json`, `match-31321159-frames.json`, `match-31321159-stat-ladders.json`, `timing-probes.json`, `data-health-2026-11-06.json`, `swarm-type-renames.json`, `log-excerpt.txt`, `redirect-probe-2026-11-06.json`, `ladder-presence-and-peer-check-2026-11-06.json`, plus `tools/` (`record.mjs`, `direct-swarm.mjs`, `health.py`, `phantom_strict.py`, `probe-redirect.mjs`, `ladder_coverage.py`).

## Observations (pre-fix analysis)

### Status today (2026-11-06, times UTC)

| Run | Result for betcris | Evidence |
|---|---|---|
| Run 1, 15:45Z (startup) | 20 matches, 9966 scraped / 9753 saved markets, about 164 s | `log-excerpt.txt`, health `avgDuration: 163890` |
| Run 2, 16:00Z | `success=false, 0 matches`, error `No WebSocket data captured` | `GET /api/admin/scrapers/health` (dev default key `dev-api-key`): `{"scraper":"betcris","successRate":50,"status":"degraded","lastError":"No WebSocket data captured"}` |
| Run 3, 17:00Z | 20 matches, 9592 markets saved. The listing capture finished ≥ 9.2 s after navigation (after the 17:00:11.321Z line, with navigation logged before 17:00:02.163Z), so it succeeded with less than 3 s to spare inside the 12 s window | `log-excerpt.txt` |
| DB today | all 20 PL matches carry betcris odds with `scrapedAt 2026-11-06T15:46:48Z`. After run 2 these are stale but still served | `GET /api/odds?league=premier-league` |
| Standalone today | 25/25 page loads succeed. `./scripts/test-scrapers.sh test betcris premier-league`: listing 20 matches in 2413 ms, details 6039 ms. Full-offer smoke (command under Acceptance criteria): `SMOKE {"success":true,"error":null,"matches":20,"scrapedMarkets":9989,"minMarketsPerMatch":344,"otherShare":0.257,"durationMs":110475}` | `timing-probes.json` |

**Symptom in logs (run 2).** Only two betcris lines appear: `[Betcris/Navigation] Navigating to: …/England/538` and `[Aggregator/FullOffer] betcris completed: success=false, 0 matches`. The full-offer path returns the error without logging it (`src/scrapers/bookmakers/betcris/index.ts:274-283`). The aggregator logs `success=` without `result.error` (`src/scrapers/aggregator.ts:270`). `[Betcris/FullOffer] Found N games` (index.ts:286) is never printed. No navigation error is logged either (navigation.ts:48-50 would print one). So by elimination the capture resolved `null`. It finished between 16:00:16.75Z and 16:00:21.10Z, which is at least 15.5 s after the `Navigating to` line (≤16:00:01.18Z). `null` also means Node processed **no sport frame at all** within the 12 s window: `mergeSwarmData` sets `merged.sport` on the first sport frame of any competition (navigation.ts:264-265), and `finish()` resolves `merged.sport ? merged : null` (navigation.ts:139). A single sport frame would have produced `Found 0 games`.

### Root cause: capture flakiness

1. **The window is fixed and its clock starts before navigation.** `captureSwarmData()` starts its clock when it is called (`navigation.ts:124`). Every caller calls it before `page.goto` (index.ts:79→81, 203→208, 258→260, 294→299). `tick()` resolves `null` once `elapsed >= MAX_WAIT_TIME` (navigation.ts:166-171, `MAX_WAIT_TIME: 12000` at constants.ts:168). The outer `Promise.race([wsDataPromise, this.delay(15000)])` (index.ts:89-92, 269-272) never decides anything because the capture always settles first. So the real budget is 12 s, shared by navigation, SPA bootstrap and subscription replies, with one attempt, no retry and no recorded reason.
2. **Time to the first useful frame scales with Chromium CPU.** The SPA needs about 1.6 s of renderer main-thread CPU before the first useful frame (`taskDurationSAtUseful` 1.64 s at 1x), and CDP CPU throttling stretches the whole chain roughly in proportion. Server-side latency was not recorded separately, so this plan does not claim it is flat. All times are ms since `page.goto` (from `timing-probes.json`):

   | Condition | navMs | wsOpenMs | first GameList frame | Passes 12 s? |
   |---|---|---|---|---|
   | solo (seq1-5, base1x) | 655-792 | 726-940 | 1905-2908 | yes |
   | 4 concurrent betcris pages | 755-836 | 831-936 | 2444-2990 | yes |
   | 8 concurrent betcris pages | 868-1173 | 945-1367 | 3519-4594 | yes |
   | stampede: betcris plus 12 other bookmaker SPAs launched together, 2 runs | 1113 / 1534 | — | ≈5725 / ≈6041 | yes, about 2x headroom |
   | CDP CPU throttle 4x | 1562 | 2207 | 7994 | yes |
   | CDP CPU throttle 8x (3 runs) | 3137-3691 | 4728-5324 | 17774-21294 | **no** |
   | CDP CPU throttle 12x | 5138 | 7539 | 34101 | **no** |

   Blocking image/font/media at 8x does not help (17774 vs 18845 ms), because the cost is script execution.
3. **Production is heavier than the emulation, and its listing time sits on the 12 s edge. The extra delay can come from Chromium or from the Node side; today's evidence cannot separate them.**
   - *Chromium side.* At run start, 13 Chromium instances boot together (`browser-pool.ts:57-70`, max 14). The machine has 20 cores, and load average was already 6-10 before the run. The 13-SPA stampede emulation reached only about 6 s, so CPU contention alone does not obviously reach 12 s.
   - *Node side.* Every Playwright event, every Swarm frame `JSON.parse`, and the other 13 scrapers' parsing (STS's 3.2 MB payload, Betclic's groups of up to 1.3 MB) share one Node main thread with the HTTP API. The frontend's `/normalized-markets` poll (a ~2 MB response, about every 3.3 s) has a 12.9 s gap exactly in betcris's run-2 window: 16:00:08.181 → 16:00:21.102. Other requests were still logged at 16:00:14.907-16:00:16.752 (`log-excerpt.txt`, run-2 request section), so the loop was heavily loaded but not blocked in one piece. After a long synchronous stretch, Node runs expired timers before polling for queued I/O. A deadline can therefore fire while frames that already arrived are still waiting in the socket buffer.
   - *Context, not causal support.* Betcris's position among the `/Navigation] Navigating to` lines from each run start was #1 in run 1 (success), #4 in run 2 (failure) and #9 in run 3 (success, `Found 20 games` after the 8 s LeBull/Betters timeouts, so 9.2-12 s). That is non-monotonic, so it does not show a position effect.

   So in production, time to the first useful frame is about 8-12+ s, against 2-3 s solo. The fixed 12 s window sits in the middle of that distribution. That is the flakiness. Any transient event (a Swarm socket reconnect, a slow DOMContentLoaded, the cross-origin redirect below, a Node stall) pushes the run over the edge into a silent total failure. The fix therefore widens and re-anchors the windows, and it also records `eventLoopDelayMaxMs` per attempt so the next failure shows which side was slow.
4. **The exact trigger in run 2 cannot be proven after the fact.** Nothing records navigation time, socket open, frame counts or page title. `scraper_runs` is empty: `insertScraperRuns` is imported but never called (`src/services/scraper-service.ts:3`), and `SELECT count(*) FROM scraper_runs` returns 0. Diagnostics are therefore part of this fix.

**Ruled out:**
- *Listener race.* The listener is registered synchronously before `goto` (navigation.ts:239 runs inside the call at index.ts:79), and Playwright emits `websocket` when the socket is created.
- *Rate limiting.* 4 and 8 concurrent sessions from this IP all reached a GameList frame (`timing-probes.json`, `par4`/`par8`).
- *Consent, geo or age walls.* All 25 probe loads reached a GameList frame (`timing-probes.json`: every run has `firstUsefulFrameMs`), and the SPA only requests it after bootstrapping the sportsbook. `partnerConfigs` has `"verifyAgePopup":false` (`redirect-probe-2026-11-06.json`, `partnerConfigsFacts`).
- *Binary frames.* The league HTML's `partnerConfigs` contains `"swarmBinaryMessageEnabled":false`.
- *Resource blocking.* See above. Betcris also already sets `disableResourceBlocking: true` (`src/types/scraper.ts:253`).

**Cross-cutting, not betcris-specific.** `initBrowser()` applies stealth scripts and resource blocking only on its fallback path (`src/scrapers/base/playwright-base.ts:87-119` vs `140-150`). The context UA claims Chrome/120 while the bundled Chromium is about 143. Neither affects betcris today (25/25 loads and 2/2 stampedes worked without stealth). They belong to the observability/browser plan.

### Data health: 2 PL matches vs the August baseline

- **1X2 vs the median of 9 other bookmakers.** Everton v Coventry City at 16:2xZ: HOME 1.69 vs 1.65 (+2.4%), DRAW 4.0 vs 3.95 (+1.3%), AWAY 5.4 vs 5.0 (+8.0%). At 17:3xZ: AWAY 5.5 vs 5.0 (+10.0%, implied probability 18.2% vs 20.0%), which is legitimate betcris pricing (`ladder-presence-and-peer-check-2026-11-06.json`). Leeds v Tottenham: all within 2.4%.
- **Phantom player selections are not present.** These are the August match-audit BROKEN findings, which that audit's section 14 had already re-classified as a false alarm. Each betcris player-parameter row from `/normalized-markets` was checked against a fresh raw Swarm fetch of the same game, matching on the same raw market name, then player token, then price within ±5% (`tools/phantom_strict.py`):

  | Match | Rows | Confirmed | Present, drift >5% | Absent from raw |
  |---|---|---|---|---|
  | Everton–Coventry | 811 | 796 | 15 | 0 |
  | Leeds–Tottenham | 750 | 743 | 7 | 0 |

  The drift is expected: the DB rows are about 40 minutes older than the raw fetch.
- **UNKNOWN selections for betcris:** 0 rows in `/normalized-markets`. That number cannot detect OTHER: the grouper drops every OTHER market before the response is built (`market-type-grouper.ts:1380-1382`). The OTHER share is measured at normalizer level instead (smoke `otherShare`: 0.257). 1X2 and the main markets are healthy.
- **REGRESSION: the stats family was renamed.**
  - 55 betcris codes in the August baseline (`aityper/docs/audit-ledger/coverage.json`) no longer appear in the two matches; 27 new codes appear. The 55 include PLAYER_SHOTS, PLAYER_FOULS(_WON), PLAYER_SAVES, PLAYER_ASSISTS, PLAYER_OFFSIDES, FOULS_TOTAL, OFFSIDES_TOTAL, TEAM_TOTAL_SHOTS(_ON_TARGET), THROW_INS_TOTAL and more (`data-health-2026-11-06.json`).
  - Cause: Betcris renamed those Swarm market-type ids (e.g. `FoulsOver/Under` → `FoulsTotal`, `PlayerShotsOver` → `PlayerShots`, `GoalkeeperSaves` → `PlayerSaves`). The selections also changed from `Powyżej`/`Poniżej` with a base line to an "N+" ladder (`22+`, `Ainsley Maitland-Niles 2+`).
  - The normalizer still keys on the August ids (`betcris-normalizer.ts:29-312`, e.g. `"FoulsOver/Under"`), so everything in this family now lands in OTHER.
  - Effect on game 31321159 (production capture → parse → normalize): 613 Swarm markets → 687 scraped markets → 191 OTHER (27.8%); 155 of 362 Swarm types are unmapped. The run-1 log has 2243 `[betcris] Unknown market` lines covering 146 unique types.
- **Collision warnings (run 1, every first-matchday match, `full-offer-repository.ts:243-246`):**
  - `EXACT_GOALS "1"` comes from `TotalGoalsExact` `" 1"` (betcris-normalizer.ts:35) colliding with `Exactly1GoalsinMatch` `Tak`, which is deliberately recoded onto `"1"` (lines 112, 1551). `ExactNumberOfGoals` is excluded (line 347) and never reaches EXACT_GOALS. The pair is identical in Leeds–Tottenham (4.3 / 4.3), but 4.57 vs 4.75 in the Everton recording. The repository keeps the first-seen odds (`full-offer-repository.ts:243-247`), so no row breaks, but the served "1" price depends on order. This goes into open question 2, not into a task.
  - `FIRST_CARD`/`LAST_CARD "AWAY"` is a mixed row. HOME/AWAY come from the 2-way yellow-only `MatchYellowCard{First,Last}Team` (1.93/1.77). NONE comes from the 3-way any-card `TeamtoReceive{First,Last}Card` (1.93/1.80/29). The pooling is deliberate (`lvbet-normalizer.ts:211-217`, `betcris-normalizer.ts:211-212,274,282`), so this is left as open question 2 rather than a task.

### What still works and must not break

- **Listing:** the GameList frame carries 20 games with P1XP2 for competition 538 (`league-538-frames.json`, t=1908 and t=2009).
- **Per-match capture:** the SINGLE_GAME_VIEW frame has 613 markets, while the game reports `markets_count` 635, so capture resolves on the plateau rule (`match-31321159-frames.json`, t=2654).
- **Existing id mappings and the golden fixture.**
  - `world-cup-2026_france_morocco` has 1662 entries, 631 of them blessed.
  - `npx tsx scripts/rebless-golden.ts --bookmaker betcris --dry` → `{"changedTotal":0,"dry":true}`.
  - `npx vitest run src/scrapers/bookmakers/betcris src/services/normalization/__tests__/golden.test.ts -t betcris` → `Test Files 2 passed (2) / Tests 4 passed | 23 skipped (27)`.
  - None of the 25 new ids appear in the golden fixture, so mapping them is purely additive.
  - The fixture's raw entries carry no `paramValue` (0 of 1662), because the prep-audit archive drops it (`scraper-audit-core.ts:370-376`; `harvest-fixtures.ts:63`: "Not archived today (prep drops it)"). The 45 split `ToAssistaGoal` rows are frozen as `PLAYER_ASSISTS` with `paramValue: null` (all `blessed: false`). Task 5 fixes the archive before harvesting the new fixture.
  - Whole suite today: `npx vitest run` → `Test Files 65 passed (65) / Tests 1182 passed (1182)`. `npx tsx scripts/rebless-golden.ts --all --dry` → `{"changedTotal":0,"dry":true}`.
- **Player-name canonicalization:** the alias `"victor torp overgaard"` → `"Victor Torp"` (`betcris-normalizer.ts:637-645`).
- **Other paths:** the `scrapeMatchDetails` cache path (index.ts:164-199), event URL format (`navigation.ts:446-452`) and `COMPETITION_IDS` (`constants.ts:17-24`).

### New data shape: endpoint, frames, renamed ids

| Item | Value (2026-11-06) |
|---|---|
| Swarm socket | `wss://eu-swarm-springre.trexname.com/`. The HTML `partnerConfigs.swarmUrl` says `wss://eu-swarm-ws-re.trexname.com/`; both match the existing `trexname.com` filter (navigation.ts:232) |
| Session | `{"command":"request_session","params":{"language":"pol","site_id":"1874631","source":42,…}}` |
| League page frames, in order | `TOP_LEAGUE_COMPACT…` (t=1857, lists competition 538 with **0 games**) → `GameList…` (t=1908, 20 games, P1XP2 only) → `SINGLE_GAME_VIEW…` (t=2891, about 970 KB, first game, 614 markets). The SPA auto-opens the first game |
| Match page frames | `SINGLE_GAME_VIEW…` (t=2654, 613 markets) arrives **before** GameList (t=2700) |
| Envelope | `{code:0, rid:"<SPA prefix>SubscribeCmd<n>", data:{subid, data:{sport:{…}}}}`. Delta updates use `rid:"0"` keyed by subid and are ignored |
| **Client redirect (live)** | The `<head>` of every www.betcris.pl page starts with `<!-- skrypt wykonujący redirect ze strony betcris.pl na betsport.pl -->` and `window.location.href = url.replace("betcris.pl","betsport.pl")`. Probe (`redirect-probe-2026-11-06.json`, `tools/probe-redirect.mjs`), ms since `page.goto`: betcris document committed at 98, navigation request to www.betsport.pl at 105, betsport DOMContentLoaded and `goto` resolved at 688 (response URL still betcris, `page.url()` betsport), Swarm socket at 788, first sport frame at 1657. The SPA then pushes `/538/31321159` (t=1999). So every one of the 21 page loads per run is two cross-origin documents. Here `goto` resolved. If the first document's lifecycle is superseded, Playwright can instead reject with `Navigation to "…" is interrupted by another navigation to "…"` |
| Page title / partner config | Title after the redirect: "Piłka Nożna - Everton - Coventry City … - Betsport Zakłady Bukmacherskie …". The served HTML still says `"domain":"www.betcris.pl"`, `"siteName":"Betcris"`, `site_id` 1874631: same Swarm backend, same partner |

Renamed stats-family ids. The full table with samples is in `swarm-type-renames.json`.

| New Swarm id | August id | Catalog code | Parser shape |
|---|---|---|---|
| `FoulsTotal`, `FoulsTeam1Total`, `FoulsTeam2Total` | `FoulsOver/Under`, `HomeTeamFoulsOver/Under`, `AwayTeamFoulsOver/Under` | FOULS_TOTAL, HOME_TEAM_TOTAL_FOULS, AWAY_TEAM_TOTAL_FOULS | team ladder |
| `OffsidesTotal`, `OffsidesTeam1Total`, `OffsidesTeam2Total` | `OffsidesOver/Under`, (`HomeTeamOffsidesOver/Under`), — | OFFSIDES_TOTAL, HOME_TEAM_TOTAL_OFFSIDES, AWAY_TEAM_TOTAL_OFFSIDES | team ladder |
| `ShotsTeam1Total` | `Shots:Team1Total` | TEAM_TOTAL_SHOTS (param `HOME:<line>`) | team ladder |
| `ShotsonTargetTotal`, `ShotsonTargetTeam1Total`, `ShotsonTargetTeam2Total` | `ShotsOnGoalOver/Under`, `ShotsongoalTeam1`, `ShotsongoalTeam2` | TOTAL_SHOTS_ON_TARGET, TEAM_TOTAL_SHOTS_ON_TARGET (`HOME:`/`AWAY:`) | team ladder |
| `ShotsonTarget1stHalfTotal` | — | HALF_TIME_TOTAL_SHOTS_ON_TARGET | team ladder |
| `ThrowInsTotal`, `ThrowInsTeam1Total`, `ThrowInsTeam2Total` | `MatchThrowInCommonTotalOverUnder2Way`, `…Team1TotalOverUnder2Way`, `…Team2TotalOverUnder2Way1` | THROW_INS_TOTAL, HOME_/AWAY_TEAM_TOTAL_THROW_INS | team ladder |
| `PlayerShots`, `PlayerShotsonTarget`, `PlayerFouls`, `PlayerFoulsWon`, `PlayerOffsides`, `PlayerSaves`, `PlayerAssists` | `PlayerShotsOver`, `PlayerShotsonTargetOver`, `PlayerFoulsCommittedOver`, `PlayerToBeFouledOver`, `PlayertoBeinOffsideOver`, `GoalkeeperSaves`, `ToAssistaGoal` | PLAYER_SHOTS, PLAYER_SHOTS_ON_TARGET, PLAYER_FOULS, PLAYER_FOULS_WON, PLAYER_OFFSIDES, PLAYER_SAVES, PLAYER_ASSISTS | player ladder |
| `PlayerTackles`, `PlayerShotsonTargetOutsidetheBox` | — | PLAYER_TACKLES, PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX (catalog codes already exist, parameterType player) | player ladder |
| `PlayerHeadedShotsonTarget` | — | PLAYER_HEADER_SHOTS_ON_TARGET (`market-catalog.ts:2019`, `hasParameter:true`, parameterType player, selections `1+..3+`; peers map it at `fortuna-normalizer.ts:77`, `betfan-normalizer.ts:180`, `superbet-normalizer.ts:426`) | player ladder: 33 players, tiers 1-4 in 31321159 (only Thierno Barry has `4+`, dropped); 36 players, tiers 1-3 in 31333513 |
| `PlayerShotsAgainstWoodwork` | `PlayerShottoHittheWoodwork` | PLAYER_HIT_WOODWORK | player list (only `1+` events, trailing ` 1+` stripped) |
| stay OTHER | `PlayerShotsOutsidetheBox` (catalog PLAYER_SHOTS_OUTSIDE_BOX has `hasParameter:false`), `Player1stHalfShotsonTarget` (catalog PLAYER_SHOTS_ON_TARGET_1H has `hasParameter:false`), `PlayerLeftFoot/RightFootShotsonTarget` (PLAYER_FOOT_SHOTS_ON_TARGET is either foot, a different bet), `Player2ndHalfShotsonTarget`, `ShotsonTarget1stHalfTeam{1,2}Total`, `ShotsonTarget2ndHalf*` | no usable catalog code | unchanged |

**Ladder semantics.** For a team ladder, `"N+"` is the same bet as Over (N − 0.5): `22+` = Over 21.5 fouls. The parser emits one entry per rung with `paramValue: "21.5"` and a single `Powyżej` selection, which is exactly the shape the August normalizer path already accepts. I verified this with the live normalizer: old id `FoulsOver/Under` + `{paramValue:"21.5", selections:[Powyżej 1.46]}` → `{"code":"FOULS_TOTAL","key":"FOULS_TOTAL:21.5","sel":[["OVER",1.46]]}`, and `Shots:Team1Total` with param 14.5 → key `TEAM_TOTAL_SHOTS:HOME:14.5`. For a player ladder, the parser emits one entry per player with `paramValue: <player>` and `N+` selections. The normalizer then needs a param rule and catalog tier gating. Today `PlayerShotsOver` + N+ selections gives `{"key":"PLAYER_SHOTS"}` with no player, and `PLAYER_FOULS` lets `5+` through even though the catalog only declares `1+..4+`. Peer prices support the N − 0.5 reading (`ladder-presence-and-peer-check-2026-11-06.json`, Everton–Coventry, lines quoted by ≥ 2 peers). FOULS_TOTAL `22+/23+/24+` vs the peer median on 21.5/22.5/23.5 is −13.9% / −9.4% / 0.0%. TOTAL_SHOTS_ON_TARGET `8+..12+` vs 7.5..11.5 is −7.0% to −16.0%, with a median of −11.0%. Betcris prices sit consistently below the peers (its margin), and reading `N+` as Over N + 0.5 would put them further off.

**Ladder presence varies by game.** Everton–Coventry (31321159) carries all 14 team ladders and 11 player types (10 ladders plus the woodwork list). Leeds–Tottenham (31333513, kick-off 2026-11-07T12:30Z) carries **no** team ladders, only the same 11 player types (direct Swarm fetch, 565 of 582 markets). Live checks must therefore compare against the raw game, not against fixed counts.

### Impact on parser / normalizer / catalog / golden fixtures / prior audit knowledge

- **Parser** (`src/scrapers/bookmakers/betcris/parser.ts:293-391`): adds a split for 25 ladder types (14 team ladders, 10 player ladders, 1 player list). The existing `BULK_PLAYER_LIST_MARKET_SELECTION` (parser.ts:267-281) stays for the old ids.
- **Normalizer** (`betcris-normalizer.ts`):
  - 25 new entries in `BETCRIS_MARKET_TYPE_TO_CODE`;
  - a player-tier param and gating block next to the `PLAYER_OU_PARAM_MARKETS` block (1615-1636). It also gates PLAYER_ASSISTS tiers, whose existing param block is at 1704-1718;
  - `HALF_TIME_TOTAL_SHOTS_ON_TARGET` added to `STAT_OVER_UNDER_PARAM_MARKETS` (1090-1135);
  - `PLAYER_TACKLES`, `PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX` and `PLAYER_HEADER_SHOTS_ON_TARGET` added to the player-prop selection case group (915-950). Without that, `"2+"` falls to `normalize1x2Selection` → `UNKNOWN` (`helpers/index.ts:195`).
- **Catalog:** no change, so `sync-market-types.ts` is not run.
- **Golden:** the existing fixture is unchanged (no new ids in it). The prep-audit archive learns to keep `paramValue` (Task 5). Existing fixtures lack the field, so they stay byte-identical. A new PL fixture is then harvested offline from the durable recording.
- **Audit tooling:** prep-audit archives gain `raw.paramValue` for every bookmaker (additive; `PrepMarketEntry.raw` in `src/services/audit/types.ts:47-53`). `harvest-fixtures.ts:138` and `golden.test.ts:91` already read it.
- **Prior audit knowledge:** the August tier-collision fixes (normalizer 1638-1702: OVER→tier conversion and catalog gating instead of clamping) still apply to the old ids. The new block follows the same rule: gate against the catalog and drop rather than clamp.

### Risks & unknowns

- **The run-2 trigger is unproven.** The capture fix is defensive and adds diagnostics. If the next failure is classified `no_swarm_socket` with a title such as "Just a moment…", the fix is a stealth/UA change in the shared base instead.
- **Node-side lag may dominate.** If failures or slow successes show a large `eventLoopDelayMaxMs` (seconds, not tens of ms), longer windows only mask the problem. The remedy is then the direct Swarm client (open question 1) or moving parse/normalize off the main thread, not more timeout.
- **Timeout constants come from CDP throttling.** Real contention may be uneven. Each window is measured from its own anchor. Against the emulated 12x worst case, the 15 s socket window is armed at `goto` settle (5138 ms) and the socket opened at 7539 ms: 2401 ms, about 6x headroom. The 30 s first-useful-frame window is armed at socket open (7539 ms) and the frame came at 34101 ms: 26562 ms, about 1.13x headroom. For today's production listings, which finish within 12 s of the old capture start, the split is unknown. The lower bounds are 1.25x for the socket window and 2.5x for the frame window. The new success line (Task 2) measures the real values.
- **Worst-case duration grows.** A dead site now costs the listing ≤ 2 × (30 s nav + 15 s + 30 s) + 3 s ≈ 2.5 min, versus 12 s today. The per-match loop is capped by the breaker, which counts 3 consecutive site-level failures.
- **Swarm ids changed once in under 2.5 months and may change again.** The per-market warn spam (2243 lines per run) hides it. Task 6 adds one summary line per bookmaker per run (`unmapped market ids`). observability.md has no such item, so this plan owns it.
- **The rebrand redirect is live** (see New data shape). The new capture tolerates a superseded `goto` and records `finalUrl`, so the stored `eventUrl` (www.betcris.pl) keeps working as long as betcris.pl keeps redirecting. If betcris.pl stops serving the redirect page, every load fails `navigation_failed` with the final URL in the log. Switching `BASE_URL` is open question 6.
- **Partial ladders.** Some N+ tiers have no catalog code (PLAYER_FOULS 5+, PLAYER_FOULS_WON 5+, PLAYER_HEADER_SHOTS_ON_TARGET 4+, …) and are dropped. Peers show the same limited ladders.
- **Cross-plan ordering.** observability.md Task 2 wraps `executeFullOfferScrape` (`playwright-base.ts:347-366`) with a NavigationRecorder that appends ` | <issues>` to `result.error`. Its Task 3 rewrites the aggregator line to `[Aggregator/FullOffer] ${bm} ${status}: …`. The fake page, the assertions and the A2 grep in this plan pass in either landing order (Task 2 notes).

### Open questions for the owner

1. **Direct Swarm client (follow-up, not in this plan).** A Node `ws` connection to `wss://eu-swarm-springre.trexname.com/` with `Origin: https://www.betcris.pl` and `site_id 1874631` returned all 20 PL games plus a 613-market game in about 300 ms, with no browser and without the SPA's `afec` field (`tools/direct-swarm.mjs`). That would remove the CPU dependency entirely and cut the full offer from 110-165 s to a few seconds. Should it be adopted as a separate plan (it is an undocumented protocol, and ToS needs a look)?
2. **Collision rows for betcris.** (a) FIRST_CARD/LAST_CARD: keep pooling the 2-way yellow-only market with the 3-way any-card market, which produces a mixed HOME/AWAY/NONE row? Or prefer `TeamtoReceive{First,Last}Card` when both exist? (b) EXACT_GOALS `"1"`: keep recoding `Exactly1GoalsinMatch` `Tak` onto `"1"`, although its price can differ from `TotalGoalsExact` `" 1"` (4.75 vs 4.57 in the Everton recording) and the first-seen one wins?
3. **Catalog expansion.** Do you want catalog codes for the stats markets that still have none: left-foot/right-foot shots on target, 2nd-half shots on target (player and team), 1st-half team shots on target? Or a `hasParameter:true` flip for PLAYER_SHOTS_OUTSIDE_BOX / PLAYER_SHOTS_ON_TARGET_1H so `PlayerShotsOutsidetheBox` / `Player1stHalfShotsonTarget` can be keyed by player? Either needs `sync-market-types`.
4. **Listing retry budget.** Is a worst case of about 2.5 min acceptable when betcris is down? The alternative is `MAX_ATTEMPTS: 1` for the listing.
5. **Unknown types.** 146 unknown betcris types per run, mostly time-window and combo markets. Should they get a separate coverage pass?
6. **Switch to www.betsport.pl?** Changing `BASE_URL` / `LEAGUE_URLS` (`constants.ts:11,30-37`) would skip one cross-origin document per load (21 per run). It would also change every stored `eventUrl`, and through it the deep links users click. `scrapeOneMatchFullOffer` matching (`scraper-audit-core.ts:124-134`) falls back to the numeric game id, so audits keep working. The frontend still brands and links betcris as `https://www.betcris.pl` (`aityper/src/lib/bookmakers.ts:107-112`). The `betcris` bookmaker key stays either way. This plan keeps the current URLs.

### Acceptance criteria

**Unit level (deterministic, CI):** `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit && npx vitest run` is green (baseline today: 65 files / 1182 tests). That includes the new betcris capture, flow and stat-ladder suites, the prep-archive and unmapped-summary tests, and the golden test with the new PL fixture.

**Standalone live smoke.** The command was proven on the current code on 2026-11-06 16:43Z, and again with the `otherEntries` field at 17:4xZ. It writes nothing to the DB and makes 21 betcris page loads:

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 600 npx tsx -e "
import { BetcrisPlaywrightScraper } from './src/scrapers/bookmakers/index.ts';
import { browserPool } from './src/scrapers/base/browser-pool.ts';
import { normalizeMarketsForBookmaker } from './src/services/normalization/index.ts';
(async () => {
  const t0 = Date.now();
  const r = await new BetcrisPlaywrightScraper().scrapeFullOffer('premier-league');
  let total = 0, other = 0, min = Infinity;
  for (const m of r.matches) {
    const n = normalizeMarketsForBookmaker(m.markets, 'betcris', m.homeTeam, m.awayTeam, 'premier-league');
    total += n.length; other += n.filter((x) => x.normalizedType === 'OTHER').length; min = Math.min(min, m.markets.length);
  }
  console.log('SMOKE ' + JSON.stringify({ success: r.success, error: r.error ?? null, matches: r.matches.length, scrapedMarkets: total, minMarketsPerMatch: r.matches.length ? min : 0, otherEntries: other, otherShare: total ? +(other / total).toFixed(3) : null, durationMs: Date.now() - t0 }));
  await browserPool.closeAll();
})();
" 2>&1 | grep -E '^SMOKE|\[Betcris'
```

Baseline output (16:43Z, before `otherEntries` existed): `SMOKE {"success":true,"error":null,"matches":20,"scrapedMarkets":9989,"minMarketsPerMatch":344,"otherShare":0.257,"durationMs":110475}`.
Re-run with this exact command at 17:4xZ: `SMOKE {"success":true,"error":null,"matches":20,"scrapedMarkets":9824,"minMarketsPerMatch":344,"otherEntries":2565,"otherShare":0.261,"durationMs":120238}`. In the same output R (below) was `10`.

Live pass criteria:

| # | Check | Pass |
|---|---|---|
| A1 | Smoke | `success:true`, `matches ≥ 18` (listing has 20), `minMarketsPerMatch ≥ 300`, `otherShare ≤ 0.21` (baseline 0.257; game 31321159 alone is projected at 166/1027 = 0.162), **and** `otherEntries ≤ B − 10 × R`. B is the `otherEntries` of the Task 2 smoke, which runs before the parser/normalizer change. R is the number of `[Betcris/FullOffer] <home> vs <away>: N markets` lines with N ≥ 500 in the same smoke output (command below the table). Today R is 10, the nearer matchweek. Those games carry ≥ 10 newly mapped ladder types each (31321159: 25, 31333513: 11), and each type used to be one OTHER entry. The following matchweek's games carry about 350 markets and no ladder types (31419243: 0 of 355). This absolute check rules out a share that falls only because the denominator grew. Also `durationMs ≤ 240000` |
| A2 | Robustness under real contention | Count only **full 14-bookmaker** runs: startup, scheduled, or an admin scrape **without** a `bookmakers` filter (`curl -s -X POST -H "Authorization: Bearer dev-api-key" -H "Content-Type: application/json" -d '{"league":"premier-league"}' http://localhost:3001/api/admin/scrape`, owner-approved, writes the DB). A betcris-only scrape removes the 13-browser start burst and proves nothing. Pass: 3 consecutive such runs each persist N ≥ 18 betcris matches and log one `[Betcris] capture ok: …` line for the listing. Record each run's `firstUsefulFrameMs`, `attempts` and `loopLagMaxMs` from that line, and note any run whose `firstUsefulFrameMs` exceeds 12000 (it would have failed before). `loopLagMaxMs` is the longest Node main-thread stall in that attempt: ~20 means idle (Task 7 Step 2 says how to read it). Any failure line must have the classified form `[Betcris] No WebSocket data captured: <failure> (attempts=…, …, title="…", finalUrl=…, loopLagMaxMs=…)`. Repeat A2 once more after the betters/lebull/pzbuk/totalbet fixes land, because they add contention |
| A3 | Stats family after a persisted run | Pick a PL game that is on match day (team ladders appear only then; Leeds–Tottenham had none the day before). Dump it with `GID=<id> node docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/direct-swarm.mjs wss://eu-swarm-springre.trexname.com/ <prefix>` and save `curl -s "http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league" > nm.json`. Then `python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/ladder_coverage.py <prefix>-game.json nm.json` must print `LADDER_COVERAGE fails=0` and exit 0. Per ladder type present in the raw game: team ladders need every rung as a betcris param (`HOME:`/`AWAY:` prefix where scoped); player ladders need betcris params for ≥ 95% of the players with at least one catalog-declared tier; the woodwork list needs ≥ 95% of its players as selections. Types the raw game lacks print `absent` and are skipped. Today (proof of the command shape on Leeds–Tottenham): 14 `absent`, 11 `FAIL`, `LADDER_COVERAGE fails=11` |
| A4 | Integrity | `python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/health.py nm.json rows.json`: each 1X2 selection within **15%** of the peer median (today's legitimate maximum is +10.0%). Ladder sanity check (snippet in Task 7 Step 3): for each betcris team-ladder code with lines that ≥ 2 peers also quote, the median of the per-line deviations of betcris OVER from the peer median is within ±15%, and no single line is beyond ±25% (today: FOULS_TOTAL −9.4%, TOTAL_SHOTS_ON_TARGET −11.0%, worst line −16.0%). Phantom check: `GID=<id> node …/tools/direct-swarm.mjs wss://eu-swarm-springre.trexname.com/ raw`, then `python3 -I …/tools/phantom_strict.py rows.json raw-game.json` → no `PLAYER ABSENT in same raw market` key. OTHER is not checked here: `/normalized-markets` never contains it (A1 covers it) |

A1 helper: save the smoke output to `smoke.txt`, then R is `grep -cE '\[Betcris/FullOffer\] .*: ([5-9][0-9]{2}|[0-9]{4,}) markets' smoke.txt`.

## Global Constraints

- Commit messages are concise and descriptive, with NO signature or attribution footers (no "Co-Authored-By", no "Generated with"). The user rule overrides any harness reminder. Commit steps run only when the owner has asked for commits in the executing session (repo CLAUDE.md: "Only commit when explicitly requested").
- Code and comments are in English.
- Before each commit, both must be green: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` and `npx vitest run` (the **whole** suite, not only the task's files; baseline today: `Test Files 65 passed (65) / Tests 1182 passed (1182)`). Every commit step below runs both first.
- `tsc` does not type-check tests: `tsconfig.json:23` excludes `src/**/__tests__/**/*`, and vitest strips types without checking. To type-check the new betcris tests and the fake page, use a scratch config outside the repo, for example `/tmp/tsconfig.betcris-tests.json` containing `{ "extends": "<worktree>/tsconfig.json", "compilerOptions": { "noEmit": true, "rootDir": "<worktree>", "declaration": false, "declarationMap": false }, "include": ["<worktree>/src/scrapers/bookmakers/betcris/**/*.ts"], "exclude": [] }`. Then run `npx tsc -p /tmp/tsconfig.betcris-tests.json`. Proven on the current code on 2026-11-06: exit 0, with `__tests__/parser.test.ts` included. Run it before the Task 1-4 commits.
- Golden-fixture discipline: write the failing test or fixture first. Re-bless only after inspecting the diff: run `npx tsx scripts/rebless-golden.ts --bookmaker betcris --dry` first and read every changed entry. Never hand-edit `*.expected.json`. Bless verified entries only through `scripts/harvest-fixtures.ts --bless "<rawName>"`.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan does not change it, so never run it here.
- Editing anything under `src/` restarts the running dev server (tsx watch), and its startup runs a full 14-bookmaker scrape that writes to the DB. Execute in a separate git worktree (superpowers:using-git-worktrees) and merge only when the owner agrees.
- **Worktree setup.** `node_modules` and `.env` are gitignored (`.gitignore:2,9`), so a fresh worktree cannot run `npx tsx`, vitest or the smoke. Right after creating it, run `cd <worktree> && npm ci && cp /home/skamik/Documents/repositories/personal/aityper-scraper-api/.env .env`. Then check `npx vitest run` reports 65 files / 1182 tests before Task 1. Symlinking `node_modules` from the main checkout also works, but `npm ci` keeps the two installs independent.
- Keep live bookmaker traffic modest: at most one smoke (21 page loads) per verification step, and no parallel smokes.
- No DB-mutating scripts (clear, nuke, migrate, sync-market-types) as part of this plan. The only DB-writing action is the owner-approved full admin scrape in Task 7.
- Swarm/WebSocket filter, `COMPETITION_IDS`, `LEAGUE_URLS` and `buildEventUrl` must keep their current values (www.betcris.pl, which redirects to www.betsport.pl; see open question 6).
- **Cross-plan order with observability.md.** Tasks 1-2 here and observability Tasks 2-3 may land in either order. The fake page is tolerant (generic `on`/`off`, `url()`, `mainFrame()`). Flow-test error assertions use `toMatch` with a `^` prefix, so an appended ` | websockets opened: …` passes. The A2 grep accepts both aggregator line formats.

## Review Focus

1. **Swarm socket reconnect in the middle of a capture** (the SPA opens a second socket after the first closes). Capture keeps listening and succeeds on frames from the second socket. Test: Task 1 "keeps capturing across a Swarm socket reconnect".
2. **`page.goto` rejects (DOMContentLoaded timeout under load) while useful frames already arrived.** The completed capture is returned with no unhandled rejection. Test: Task 1 "a late page.goto timeout does not discard a completed capture".
3. **A ladder market contains an event that is not `N+`** (a future `Tak`/`Powyżej 2.5`). There must be no crash and no invented tier; non-tier events go into one residual entry. Test: Task 3 "keeps non-tier events of a ladder market in one residual entry".
4. **A tier outside the catalog vocabulary** (PLAYER_FOULS `5+`). It is dropped, never clamped into `4+`. Test: Task 4 "drops tiers the catalog does not declare".
5. **The site is down for the whole run.** Duration is bounded: the listing makes exactly 2 attempts, and the per-match loop stops after 3 consecutive site-level failures. Game-level failures (`target_game_missing`) are neither retried nor counted. Tests: Task 2 "listing failure is bounded to two attempts", "stops after 3 consecutive per-match capture failures" and "game-level misses do not trip the breaker".
6. **The betcris.pl → betsport.pl client redirect supersedes the first navigation.** A rejected `goto` must not kill an attempt whose socket opens afterwards. Test: Task 1 "survives the betcris.pl→betsport.pl client redirect".

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/scrapers/bookmakers/betcris/types.ts` | add capture outcome/diagnostic types | 1 |
| `src/scrapers/bookmakers/betcris/constants.ts` | timing constants (`WS_CONFIG`), tier-ladder Swarm type sets | 1, 3 |
| `src/scrapers/bookmakers/betcris/navigation.ts` | `captureSwarm()`, `formatCaptureFailure()`, `formatCaptureSuccess()`, `isSiteLevelCaptureFailure()`; remove `captureSwarmData`, `navigateToLeaguePage`, `navigateToMatchPage` | 1, 2 |
| `src/scrapers/bookmakers/betcris/index.ts` | four entry points use `captureSwarm`; reason and success logging; per-match breaker on site-level failures | 2 |
| `src/scrapers/bookmakers/betcris/parser.ts` | `parseTierLabel()`; ladder splitting in `parseAllMarkets` | 3 |
| `src/services/normalization/bookmakers/betcris-normalizer.ts` | new id map entries; player-tier param and gating (incl. PLAYER_ASSISTS); HALF_TIME_TOTAL_SHOTS_ON_TARGET param list | 4 |
| `src/services/audit/scraper-audit-core.ts`, `src/services/audit/types.ts` | prep-audit archive keeps `raw.paramValue` | 5 |
| `src/services/normalization/unmapped-summary.ts`, `src/services/scrape-helpers.ts` | one per-run "unmapped market ids" line per bookmaker | 6 |
| `src/scrapers/bookmakers/betcris/__tests__/helpers/fake-swarm-page.ts` | Playwright-`Page` fake that replays recorded frames on fake timers; `loadFixture` / `loadRecording` / `settle` | 1 |
| `src/scrapers/bookmakers/betcris/__tests__/fixtures/` | copies of `league-538-frames.json`, `match-31321159-frames.json`, `match-31321159-stat-ladders.json` from the evidence dir | 1, 3 |
| `src/scrapers/bookmakers/betcris/__tests__/capture.test.ts` | capture state machine tests | 1 |
| `src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts` | `scrapeLeague` / `scrapeMatchDetails` / `scrapeFullOffer` behavior with the fake page | 2 |
| `src/scrapers/bookmakers/betcris/__tests__/stat-ladders.test.ts` | parser split (Task 3) and normalizer mapping (Task 4) on real ladder data | 3, 4 |
| `src/services/audit/__tests__/prep-archive-param.test.ts` | archive keeps `paramValue` | 5 |
| `src/services/normalization/__tests__/unmapped-summary.test.ts` | summary counting and format | 6 |
| `src/services/normalization/__fixtures__/betcris/premier-league_everton_coventry-city.json` + `.expected.json` | new PL golden pair (harvested offline from the recording) | 5 |

---

### Task 1: Classified, retried Swarm capture (`captureSwarm`)

**Files:**
- Modify: `src/scrapers/bookmakers/betcris/types.ts` (append after `CaptureConfig`, lines 140-147; delete the unused `CaptureResult`, lines 152-157)
- Modify: `src/scrapers/bookmakers/betcris/constants.ts:164-188` (`WS_CONFIG`: additions only. `MAX_WAIT_TIME` stays until Task 2, because `captureSwarmData` still reads it at navigation.ts:168 and `WS_CONFIG` is `as const`)
- Modify: `src/scrapers/bookmakers/betcris/navigation.ts` (add `captureSwarm`, `formatCaptureFailure`, `formatCaptureSuccess`, `isSiteLevelCaptureFailure`; keep `mergeSwarmData`/`analyzeSwarmData`/`checkCompetitionExists` and reuse them)
- Create: `src/scrapers/bookmakers/betcris/__tests__/helpers/fake-swarm-page.ts`
- Create: `src/scrapers/bookmakers/betcris/__tests__/fixtures/league-538-frames.json` and `match-31321159-frames.json`, byte copies of `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/` files
- Test: `src/scrapers/bookmakers/betcris/__tests__/capture.test.ts`

**Interfaces:**
- Consumes: `CaptureConfig` (types.ts:140-147), `mergeSwarmData`, `analyzeSwarmData`, `checkCompetitionExists` (navigation.ts:259-405), `REQUEST_TIMEOUT` (constants.ts:193), `monitorEventLoopDelay` (`node:perf_hooks`).
- Produces:
  ```ts
  // types.ts
  export type SwarmCaptureFailure =
    | "navigation_failed" | "no_swarm_socket" | "no_sport_frames"
    | "competition_missing" | "no_games_with_markets" | "target_game_missing";
  export interface SwarmCaptureAttempt {
    attempt: number;                 // 1-based
    navMs: number | null;            // goto settle (resolve OR reject) since attempt start; null while pending
    navError: string | null;
    wsUrls: string[];                // every Swarm socket seen
    wsOpenMs: number | null;         // first Swarm socket, ms since attempt start
    framesReceived: number;
    nonJsonFrames: number;
    sportFrames: number;             // frames with code 0 and data.data.sport
    firstUsefulFrameMs: number | null; // league: target competition has a game with markets; single-event: target game seen
    failure: SwarmCaptureFailure | null;
    pageTitle: string | null;        // read only on failure
    finalUrl: string | null;         // page.url() at attempt end (www.betsport.pl after the client redirect); null on throw
    eventLoopDelayMaxMs: number | null; // longest Node main-thread gap between 20 ms ticks over the attempt, rounded ms:
                                        // max(monitorEventLoopDelay max, own 20 ms gap sampler incl. the attempt's start and tail); ~20 = idle
    deadlineLateMs?: number | null;     // largest lateness of a deadline that fired > 100 ms late (loop stalled); null when none did
  }
  export interface SwarmCaptureOutcome { data: SwarmData | null; failure: SwarmCaptureFailure | null; attempts: SwarmCaptureAttempt[]; }
  export interface SwarmCaptureTiming { wsOpenTimeoutMs: number; firstUsefulFrameTimeoutMs: number; maxAttempts: number; retryBackoffMs: number; }
  // constants.ts WS_CONFIG: add WS_OPEN_TIMEOUT: 15000, FIRST_USEFUL_FRAME_TIMEOUT: 30000,
  //   MAX_ATTEMPTS: 2, RETRY_BACKOFF: 3000, MAX_CONSECUTIVE_MATCH_FAILURES: 3.
  //   MAX_WAIT_TIME_SINGLE_EVENT (16000) is now measured from firstUsefulFrameMs. MAX_WAIT_TIME is deleted in Task 2.
  // navigation.ts
  export function captureSwarm(page: Page, url: string, config: CaptureConfig, timing?: Partial<SwarmCaptureTiming>): Promise<SwarmCaptureOutcome>;
  export function formatCaptureFailure(outcome: SwarmCaptureOutcome): string;
  export function formatCaptureSuccess(outcome: SwarmCaptureOutcome): string;
  export function isSiteLevelCaptureFailure(f: SwarmCaptureFailure | null): boolean; // navigation_failed | no_swarm_socket | no_sport_frames
  // helpers/fake-swarm-page.ts (test only)
  export interface RecordedSwarmEvent { t: number; kind: "goto" | "domcontentloaded" | "redirect" | "open" | "sent" | "recv" | "close"; wsUrl?: string; url?: string; payload?: string; }
  export interface FakeAttemptScript { events: RecordedSwarmEvent[]; timeScale?: number; gotoRejectAtMs?: number; gotoRejectMessage?: string; title?: string; }
  export interface FakeSwarmPage { page: Page; calls: string[]; gotoAt: number[]; }
  export function createFakeSwarmPage(script: (url: string, gotoIndex: number) => FakeAttemptScript): FakeSwarmPage;
  export function loadFixture<T = any>(fileName: string): T;      // JSON.parse of __tests__/fixtures/<fileName>
  export function loadRecording(fileName: string): RecordedSwarmEvent[]; // loadFixture(fileName).events
  export function settle<T>(p: Promise<T>, stepMs?: number, maxMs?: number): Promise<T>; // advanceTimersByTimeAsync loop, defaults 100 / 600000
  ```

`captureSwarm` behavior, which the signature does not determine. One attempt is shown. Attempts repeat up to `maxAttempts`, with `retryBackoffMs` between them and fresh state each time. `target_game_missing` is final and never retried, because the game is gone or live and a retry only costs about 33 s:

```text
log "[Betcris/Navigation] Navigating to: <url> (attempt n/max)"   (single-event: "Navigating to match: <url> (attempt n/max)")
start an event-loop-delay histogram (monitorEventLoopDelay({ resolution: 20 }).enable())
attach page.on("websocket") (same swarm|trexname filter)        -> calls[0]
start page.goto(url, {timeout: REQUEST_TIMEOUT, waitUntil: "domcontentloaded"}) WITHOUT awaiting it first
on each frame: merge + stats (existing helpers); complete when
  league:       target competition present AND has >= 1 game with markets          (resolve immediately)
  single-event: target markets_count reached, OR PLATEAU_WAIT_TIME without growth after
                firstUsefulFrameMs (poll POLL_INTERVAL, not before MIN_WAIT_TIME), OR
                MAX_WAIT_TIME_SINGLE_EVENT after firstUsefulFrameMs
deadlines are setTimeout timers armed at milestones (exact, not poll-rounded):
  goto settles (resolves OR rejects; a rejection only records navError/navMs - the client
    redirect can supersede the first document while the second one still opens the socket),
    no socket by +wsOpenTimeoutMs           -> navError ? navigation_failed : no_swarm_socket
  first socket opened, not complete by +firstUsefulFrameTimeoutMs ->
      sportFrames == 0 -> no_sport_frames
      league: competition absent -> competition_missing; present without games -> no_games_with_markets
      single-event: target never seen -> target_game_missing
when a deadline (or the single-event max wait) fires: on time (<= 100 ms late) await one setImmediate turn and
  re-check completion before classifying; more than 100 ms late (the loop stalled) wait 1000 ms once, then the same
  turn and re-check, and record deadlineLateMs (after a stall Node runs expired timers before queued socket I/O, and a
  frame already in Node's CDP pipe needs two more setImmediate hops in Playwright 1.57: pipe transport, in-process connection)
on success or failure: page.off + ws.off all listeners; swallow a later goto rejection;
  finalUrl = page.url() (null on throw); eventLoopDelayMaxMs = round(max(histogram.max / 1e6, own gap max after one
  final tail sample)); disable histogram and the sampler (the histogram alone misses its first ~20 ms and the tail)
on failure: pageTitle = await page.title() (null on throw)
```

The on-time setImmediate yield has no dedicated unit test: under fake timers it cannot reorder real socket I/O. The stall grace has one (fix round 1: a `vi.setSystemTime` jump makes every pending timer fire late), and so do the two blind spots of `eventLoopDelayMaxMs` (a real `Atomics.wait` stall right after the attempt starts and right before it ends). These two tests bring Task 1 to 16 tests, so the Step 4/5 counts and every later expected test total in this plan are 2 higher (Step 5: 66 files / 1198 tests). Neither the Task 2 smoke nor A2 can show whether the yield or the grace worked: `loopLagMaxMs` only shows how long Node's main thread stalled. A late deadline logs `[Betcris/Navigation] <ws-open|first-useful-frame|max-wait> deadline fired N ms late (event loop stalled); deciding in 1000 ms` and sets `deadlineLateMs`.

- [ ] **Step 1: Write the test infrastructure and the failing tests.** First copy the two recordings into `__tests__/fixtures/` (`cp docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/{league-538-frames,match-31321159-frames}.json src/scrapers/bookmakers/betcris/__tests__/fixtures/`). Then implement `helpers/fake-swarm-page.ts` completely, with the semantics listed after the tests. It is test infrastructure and imports nothing from `navigation.ts`, so Step 2 fails for the intended reason. Then write `capture.test.ts`. Start each test with `vi.useFakeTimers()` and `vi.spyOn(console, "log").mockImplementation(() => {})`, and use `afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); })`. Fixtures: `league = loadRecording("league-538-frames.json")`, `match = loadRecording("match-31321159-frames.json")`, `LEAGUE = "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538"`, `BETSPORT = LEAGUE.replace("betcris.pl", "betsport.pl")`.

```ts
it("betcris capture: resolves league mode on the recorded GameList frame", async () => {
  const fake = createFakeSwarmPage(() => ({ events: league }));
  const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
  expect(out.failure).toBeNull();
  expect(out.attempts).toHaveLength(1);
  expect(out.attempts[0].firstUsefulFrameMs).toBe(1908);
  expect(out.attempts[0].wsOpenMs).toBe(766);
  expect(out.attempts[0].finalUrl).toBe(LEAGUE);
  expect(typeof out.attempts[0].eventLoopDelayMaxMs).toBe("number");
  expect(countGames(out.data!, 538)).toBe(20); // local helper: games of competition 538 with >=1 market
  expect(console.log).toHaveBeenCalledWith(`[Betcris/Navigation] Navigating to: ${LEAGUE} (attempt 1/2)`);
});
it("betcris capture: survives the betcris.pl→betsport.pl client redirect", async () => {
  const events = [...league.filter((e) => e.t < 105), { t: 105, kind: "redirect", url: BETSPORT } as const, ...league.filter((e) => e.t >= 105)];
  const fake = createFakeSwarmPage(() => ({ events, gotoRejectAtMs: 110,
    gotoRejectMessage: `page.goto: Navigation to "${LEAGUE}" is interrupted by another navigation to "${BETSPORT}"` }));
  const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
  expect(out.failure).toBeNull();
  expect(out.attempts).toHaveLength(1);
  expect(out.attempts[0]).toMatchObject({ navMs: 110, wsOpenMs: 766, firstUsefulFrameMs: 1908, finalUrl: BETSPORT });
  expect(out.attempts[0].navError).toContain("interrupted by another navigation");
});
it("betcris capture: attaches the websocket listener before page.goto and detaches it after", async () => {
  const fake = createFakeSwarmPage(() => ({ events: league }));
  await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
  expect(fake.calls[0]).toBe("on:websocket");
  expect(fake.calls[1]).toBe(`goto:${LEAGUE}`);
  expect(fake.calls).toContain("off:websocket");
});
it("betcris capture: succeeds when the first useful frame arrives 34 s after goto (12x CPU)", async () => {
  const fake = createFakeSwarmPage(() => ({ events: league, timeScale: 17.9 }));
  const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
  expect(out.failure).toBeNull();
  expect(out.attempts[0].navMs).toBe(12494);            // round(698*17.9)
  expect(out.attempts[0].wsOpenMs).toBe(13711);         // round(766*17.9)
  expect(out.attempts[0].firstUsefulFrameMs).toBe(34153); // round(1908*17.9) - old code gave up at 12000
});
it("betcris capture: classifies no_games_with_markets when only TOP_LEAGUE_COMPACT arrived", async () => {
  const fake = createFakeSwarmPage(() => ({ events: league.filter((e) => e.t < 1908) }));
  const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
  expect(out.failure).toBe("no_games_with_markets");
  expect(out.attempts).toHaveLength(2);
  expect(out.attempts[1]).toMatchObject({ framesReceived: 13, sportFrames: 2, firstUsefulFrameMs: null });
});
it("betcris capture: classifies competition_missing and no_sport_frames", async () => {
  const noComp = league.filter((e) => !/TOP_LEAGUE|GameList/.test(e.payload?.slice(0, 120) ?? ""));
  const a = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: noComp })).page, LEAGUE, { competitionId: 538 }));
  expect(a.failure).toBe("competition_missing");
  expect(a.attempts[0]).toMatchObject({ framesReceived: 13, sportFrames: 2 });
  const noSport = league.filter((e) => e.kind !== "recv" || !e.payload!.includes('"sport"'));
  const b = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: noSport })).page, LEAGUE, { competitionId: 538 }));
  expect(b.failure).toBe("no_sport_frames");
  expect(b.attempts[0]).toMatchObject({ framesReceived: 11, sportFrames: 0 });
});
it("betcris capture: retries once after no_swarm_socket and succeeds on attempt 2", async () => {
  const empty: RecordedSwarmEvent[] = [{ t: 0, kind: "goto" }, { t: 700, kind: "domcontentloaded" }];
  const fake = createFakeSwarmPage((_u, i) => ({ events: i === 0 ? empty : league, title: "Betcris" }));
  const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
  expect(out.failure).toBeNull();
  expect(out.attempts.map((a) => a.failure)).toEqual(["no_swarm_socket", null]);
  expect(out.attempts[0]).toMatchObject({ navMs: 700, wsOpenMs: null, pageTitle: "Betcris" });
  expect(fake.gotoAt[1] - fake.gotoAt[0]).toBe(700 + 15000 + 3000);
});
it("betcris capture: navigation_failed when page.goto rejects and no socket follows", async () => {
  const fake = createFakeSwarmPage(() => ({ events: [{ t: 0, kind: "goto" }], gotoRejectAtMs: 30000 }));
  const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
  expect(out.failure).toBe("navigation_failed");
  expect(out.attempts).toHaveLength(2);
  expect(out.attempts[0]).toMatchObject({ navMs: 30000, wsOpenMs: null });
  expect(out.attempts[0].navError).toContain("Timeout 30000ms exceeded");
  expect(fake.gotoAt[1] - fake.gotoAt[0]).toBe(30000 + 15000 + 3000); // waits wsOpenTimeoutMs after the rejection
});
it("betcris capture: keeps capturing across a Swarm socket reconnect", async () => {
  const events = [
    ...league.filter((e) => e.t <= 900),
    { t: 900, kind: "close" } as const,
    { t: 1000, kind: "open", wsUrl: "wss://eu-swarm-ws-re.trexname.com/" } as const,
    ...league.filter((e) => e.t > 1000),
  ];
  const out = await settle(captureSwarm(createFakeSwarmPage(() => ({ events })).page, LEAGUE, { competitionId: 538 }));
  expect(out.failure).toBeNull();
  expect(out.attempts[0].wsUrls).toEqual(["wss://eu-swarm-springre.trexname.com/", "wss://eu-swarm-ws-re.trexname.com/"]);
});
it("betcris capture: a late page.goto timeout does not discard a completed capture", async () => {
  const fake = createFakeSwarmPage(() => ({ events: league.filter((e) => e.kind !== "domcontentloaded"), gotoRejectAtMs: 30000 }));
  const out = await settle(captureSwarm(fake.page, LEAGUE, { competitionId: 538 }));
  expect(out.failure).toBeNull();
  expect(out.attempts[0].firstUsefulFrameMs).toBe(1908);
  await vi.advanceTimersByTimeAsync(40000); // the rejection lands after resolve; must not be unhandled
});
it("betcris capture: single-event mode unions game 31321159 and resolves on plateau", async () => {
  const url = `${LEAGUE}/31321159`;
  const out = await settle(captureSwarm(createFakeSwarmPage(() => ({ events: match })).page, url, { singleEventMode: true, targetGameNumber: 31321159 }));
  expect(out.failure).toBeNull();
  expect(out.attempts[0].firstUsefulFrameMs).toBe(2654);
  const g = findGame(out.data!, 31321159); // local helper
  expect(Object.keys(g.market ?? {})).toHaveLength(613);
  expect(g.markets_count).toBe(635);
});
it("betcris capture: target_game_missing for an id that never appears, without a retry", async () => {
  const fake = createFakeSwarmPage(() => ({ events: match }));
  const out = await settle(captureSwarm(fake.page, `${LEAGUE}/99999999`, { singleEventMode: true, targetGameNumber: 99999999 }));
  expect(out.failure).toBe("target_game_missing");
  expect(out.attempts).toHaveLength(1);
  expect(fake.gotoAt).toHaveLength(1);
});
const attempt = { attempt: 2, navMs: 700, navError: null, wsUrls: [], wsOpenMs: null, framesReceived: 0, nonJsonFrames: 0, sportFrames: 0,
  firstUsefulFrameMs: null, failure: "no_swarm_socket" as const, pageTitle: "Betcris", finalUrl: BETSPORT, eventLoopDelayMaxMs: 840 };
it("betcris capture: formatCaptureFailure renders reason and last-attempt diagnostics", () => {
  expect(formatCaptureFailure({ data: null, failure: "no_swarm_socket", attempts: [{ ...attempt, attempt: 1 }, attempt] }))
    .toBe(`No WebSocket data captured: no_swarm_socket (attempts=2, navMs=700, wsOpenMs=n/a, frames=0, sportFrames=0, title="Betcris", finalUrl=${BETSPORT}, loopLagMaxMs=840)`);
});
it("betcris capture: formatCaptureSuccess renders the timings A2 records", () => {
  const ok = { ...attempt, attempt: 1, navMs: 688, wsOpenMs: 788, framesReceived: 13, sportFrames: 3, firstUsefulFrameMs: 1908, failure: null, pageTitle: null, eventLoopDelayMaxMs: 21 };
  expect(formatCaptureSuccess({ data: {}, failure: null, attempts: [ok] }))
    .toBe(`capture ok: navMs=688, wsOpenMs=788, firstUsefulFrameMs=1908, attempts=1, loopLagMaxMs=21, finalUrl=${BETSPORT}`);
  expect(["navigation_failed", "no_swarm_socket", "no_sport_frames"].every((f) => isSiteLevelCaptureFailure(f as SwarmCaptureFailure))).toBe(true);
  expect(["competition_missing", "no_games_with_markets", "target_game_missing", null].some((f) => isSiteLevelCaptureFailure(f as SwarmCaptureFailure | null))).toBe(false);
});
```

Fake-page semantics that the tests rely on. The fake is also tolerant enough for observability.md's NavigationRecorder, which `executeFullOfferScrape` may wrap around it later:
- The page is an `EventEmitter`. `on`/`off` work for **any** event name and push `on:<event>`/`off:<event>` into `calls`. `goto` pushes `goto:<url>`, and `gotoAt` records `Date.now()`.
- Each `goto` cancels the previous attempt's pending timers, sets the current URL to the goto URL, and schedules every event at `Math.round(t * (timeScale ?? 1))`.
- `redirect` sets the current URL to `url` and emits `framenavigated` with the main-frame stub. `url()` returns the current URL. `mainFrame()` returns a stable stub `{ url: () => current }`.
- `open` creates a fake socket whose `url()` is `wsUrl ?? "wss://eu-swarm-springre.trexname.com/"` and emits `websocket`.
- `recv` emits `framereceived` with `{ payload }` on the latest socket; `close` emits `close`.
- `domcontentloaded` resolves `goto` (a no-op if it already rejected). `gotoRejectAtMs` rejects it with `new Error(gotoRejectMessage ?? "page.goto: Timeout 30000ms exceeded.")`.
- `title()` resolves to `title ?? ""`.

- [ ] **Step 2: Run them to verify they fail.**
Run: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx vitest run src/scrapers/bookmakers/betcris/__tests__/capture.test.ts`
Expected: FAIL. `navigation.ts` does not export `captureSwarm` / `formatCaptureFailure` / `formatCaptureSuccess` / `isSiteLevelCaptureFailure`. A "Cannot find module helpers/fake-swarm-page" error means Step 1 is incomplete.

- [ ] **Step 3: Implement** the types, the `WS_CONFIG` additions (do **not** delete `MAX_WAIT_TIME` yet), and `captureSwarm` / `formatCaptureFailure` / `formatCaptureSuccess` / `isSiteLevelCaptureFailure` in `navigation.ts`, as specified above. The default timing is `{ wsOpenTimeoutMs: WS_CONFIG.WS_OPEN_TIMEOUT, firstUsefulFrameTimeoutMs: WS_CONFIG.FIRST_USEFUL_FRAME_TIMEOUT, maxAttempts: WS_CONFIG.MAX_ATTEMPTS, retryBackoffMs: WS_CONFIG.RETRY_BACKOFF }`. `captureSwarm` uses only `page.on/off("websocket")`, `page.goto`, `page.title`, `page.url`, `ws.url()`, `ws.on/off("framereceived"|"close")`. Leave `captureSwarmData` in place in this task; Task 2 removes it.
  - `formatCaptureFailure` = `` `No WebSocket data captured: ${failure} (attempts=${n}, navMs=${v|n/a}, wsOpenMs=${v|n/a}, frames=${framesReceived}, sportFrames=${sportFrames}, title="${pageTitle ?? ""}", finalUrl=${finalUrl ?? "n/a"}, loopLagMaxMs=${v|n/a})` ``, with the values taken from the last attempt.
  - `formatCaptureSuccess` = `` `capture ok: navMs=…, wsOpenMs=…, firstUsefulFrameMs=…, attempts=${n}, loopLagMaxMs=…, finalUrl=…` ``, with the values taken from the successful (last) attempt.

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `npx vitest run src/scrapers/bookmakers/betcris/__tests__/capture.test.ts && npx tsc --noEmit && npx tsc -p /tmp/tsconfig.betcris-tests.json`
Expected: 14 passed; both tsc runs print nothing.

- [ ] **Step 5: Commit** after the whole suite is green: `npx tsc --noEmit && npx vitest run` → `Test Files 66 passed (66) / Tests 1196 passed (1196)`.
```bash
git add src/scrapers/bookmakers/betcris/types.ts src/scrapers/bookmakers/betcris/constants.ts src/scrapers/bookmakers/betcris/navigation.ts src/scrapers/bookmakers/betcris/__tests__/helpers src/scrapers/bookmakers/betcris/__tests__/fixtures/league-538-frames.json src/scrapers/bookmakers/betcris/__tests__/fixtures/match-31321159-frames.json src/scrapers/bookmakers/betcris/__tests__/capture.test.ts
git commit -m "fix(betcris): milestone-anchored, retried and classified Swarm capture"
```

### Task 2: Route all betcris entry points through `captureSwarm`

**Files:**
- Modify: `src/scrapers/bookmakers/betcris/index.ts:71-123` (`scrapeLeague`), `:156-248` (`scrapeMatchDetails` browser branch), `:250-373` (`scrapeFullOffer`)
- Modify: `src/scrapers/bookmakers/betcris/navigation.ts`: delete `captureSwarmData` (98-241), `navigateToLeaguePage` (31-52) and `navigateToMatchPage` (61-76). Their only users are in betcris/index.ts. pzbuk and superbet have their own functions with the same names. The `Navigating to` log lines that log forensics (this plan, observability.md) grep for now come from `captureSwarm` (Task 1).
- Modify: `src/scrapers/bookmakers/betcris/constants.ts`: delete `WS_CONFIG.MAX_WAIT_TIME` (line 168), in the same step that deletes `captureSwarmData`, its only reader (navigation.ts:168).
- Test: `src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts`

**Interfaces:**
- Consumes: `captureSwarm`, `formatCaptureFailure`, `formatCaptureSuccess`, `isSiteLevelCaptureFailure`, `SwarmCaptureOutcome`, `WS_CONFIG.MAX_CONSECUTIVE_MATCH_FAILURES` (Task 1); `LEAGUE_URLS`, `buildEventUrl`; test helpers `createFakeSwarmPage`, `loadRecording`, `settle`.
- Produces:
  - `scrapeFullOffer` result `error` strings: listing failure → `formatCaptureFailure(outcome)`. Breaker → `success: true` with the captured matches and `error: "aborted after 3 consecutive per-match capture failures"`. If zero matches were captured, `success` is false.
  - Log lines:
    - Listing, any mode: `console.warn("[Betcris] " + formatCaptureFailure(o))` on failure, `console.log("[Betcris] " + formatCaptureSuccess(o))` on success. A2 records the success line.
    - Per match: `[Betcris/FullOffer] Skipped game <id> (<home> vs <away>): <formatCaptureFailure>` (warn).
    - `[Betcris/FullOffer] Aborting per-match loop: 3 consecutive capture failures` (warn).
  - Breaker: only `isSiteLevelCaptureFailure(o.failure)` increments the consecutive count. Game-level failures (`target_game_missing`) are skipped and logged, and leave the count unchanged. Any success resets it.
  - No `Promise.race`/`this.delay(15000|20000)` remain in `index.ts`.

**Integration with observability.md (either order).** Its Task 2 runs `scrapeLogic` inside a NavigationRecorder (`playwright-base.ts:347-366`). The recorder subscribes to `request`/`response`/`requestfinished`/`requestfailed`/`websocket`, reads `mainFrame()`, `url()` and `title()`, and appends ` | <issues>` to a failed `result.error` (for example ` | websockets opened: none`). The Task 1 fake page supports all of that, so these tests pass before and after it lands. Only `initBrowser` is mocked.

- [ ] **Step 1: Write the failing tests.** Each test gets a fresh module, because `eventsCache` (index.ts:44) is module-level and `scrapeFullOffer` fills it: `vi.resetModules(); const { BetcrisPlaywrightScraper } = await import("../index.js");`. Then create `fake` and spy the browser session with `vi.spyOn(BetcrisPlaywrightScraper.prototype as any, "initBrowser").mockResolvedValue({ page: fake.page, browser: {}, context: {}, cleanup: async () => {} })`. Also mock `console.warn` and `console.log` with `mockImplementation(() => {})`, use fake timers, and call `vi.restoreAllMocks()` in `afterEach`. The snippets below omit the import and spy lines. Define `retarget(events, id) = events.map((e) => e.payload ? { ...e, payload: e.payload.replaceAll("31321159", String(id)) } : e)` and `EMPTY = [{ t: 0, kind: "goto" }, { t: 700, kind: "domcontentloaded" }]`.

```ts
// Characterization test: passes before and after this task (guards the listing path).
it("betcris scrapeLeague: returns 20 matches from the recorded listing", async () => {
  const fake = createFakeSwarmPage(() => ({ events: league }));
  const r = await settle(new BetcrisPlaywrightScraper().scrapeLeague("premier-league"));
  expect(r.status).toBe("success");
  expect(r.data).toHaveLength(20);
});
it("betcris scrapeMatchDetails: browser branch returns game 31321159 from the recorded frames", async () => {
  const url = `${LEAGUE}/31321159`; // fresh module, so the cache path (index.ts:164-199) is skipped
  const fake = createFakeSwarmPage(() => ({ events: match }));
  const r = await settle(new BetcrisPlaywrightScraper().scrapeMatchDetails(url));
  expect(r.status).toBe("success");
  expect(r.data).toMatchObject({ homeTeam: "Everton", eventUrl: url });
  expect(fake.calls).toContain(`goto:${url}`);
});
it("betcris scrapeFullOffer: listing failure is bounded to two attempts and reports the reason", async () => {
  const fake = createFakeSwarmPage(() => ({ events: EMPTY, title: "Betcris" }));
  const t0 = Date.now();
  const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
  expect(r.success).toBe(false);
  // `^` prefix, no `$`: observability's recorder may append " | websockets opened: none"
  expect(r.error).toMatch(/^No WebSocket data captured: no_swarm_socket \(attempts=2, navMs=700, wsOpenMs=n\/a, frames=0, sportFrames=0, title="Betcris", finalUrl=https:\/\/www\.betcris\.pl\/zaklady-bukmacherskie\/match\/Soccer\/England\/538, loopLagMaxMs=\d+\)/);
  expect(fake.gotoAt).toHaveLength(2);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(700 + 15000 + 3000 + 700 + 15000);
  expect(Date.now() - t0).toBeLessThanOrEqual(700 + 15000 + 3000 + 700 + 15000 + 200); // settle() steps of 100 ms
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[Betcris] No WebSocket data captured: no_swarm_socket"));
});
it("betcris scrapeFullOffer: logs one capture-ok line with the listing timings", async () => {
  const fake = createFakeSwarmPage((url) => (url.endsWith("/538") ? { events: league } : { events: retarget(match, Number(url.split("/").pop())) }));
  await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
  const ok = vi.mocked(console.log).mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith("[Betcris] capture ok:"));
  expect(ok).toHaveLength(1);
  expect(ok[0]).toMatch(/^\[Betcris\] capture ok: navMs=698, wsOpenMs=766, firstUsefulFrameMs=1908, attempts=1, loopLagMaxMs=\d+, finalUrl=https:\/\/www\.betcris\.pl\//);
});
it("betcris scrapeFullOffer: skips failed games with a logged reason and stops after 3 consecutive per-match capture failures", async () => {
  let perMatch = 0;
  const fake = createFakeSwarmPage((url) => {
    if (url.endsWith("/538")) return { events: league };
    const id = Number(url.split("/").pop());
    return ++perMatch <= 2 ? { events: retarget(match, id) } : { events: EMPTY };
  });
  const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
  expect(r.success).toBe(true);
  expect(r.matches).toHaveLength(2);
  expect(r.error).toBe("aborted after 3 consecutive per-match capture failures");
  expect(fake.gotoAt).toHaveLength(1 + 2 + 3 * 2);
  expect(vi.mocked(console.warn).mock.calls.filter(([m]) => String(m).startsWith("[Betcris/FullOffer] Skipped game"))).toHaveLength(3);
});
it("betcris scrapeFullOffer: game-level misses do not trip the breaker and are not retried", async () => {
  let perMatch = 0;
  const fake = createFakeSwarmPage((url) => {
    if (url.endsWith("/538")) return { events: league };
    const id = Number(url.split("/").pop());
    // First 3 games: the target never appears. The recorded GameList frames (t=2700, 2786) list all 20 ids, so drop
    // every frame that mentions the id; TOP_LEAGUE_COMPACT (t=1771) and SportsbookSportsMenu (t=2781) remain as
    // sport frames, so the failure is target_game_missing, not the site-level no_sport_frames.
    return { events: ++perMatch <= 3 ? retarget(match, 99999999).filter((e) => !e.payload?.includes(String(id))) : retarget(match, id) };
  });
  const r = await settle(new BetcrisPlaywrightScraper().scrapeFullOffer("premier-league"));
  expect(r.success).toBe(true);
  expect(r.matches).toHaveLength(17);
  expect(r.error).toBeUndefined();
  expect(fake.gotoAt).toHaveLength(1 + 3 + 17); // no retry for target_game_missing
  const warns = vi.mocked(console.warn).mock.calls.map(([m]) => String(m));
  expect(warns.filter((m) => m.startsWith("[Betcris/FullOffer] Skipped game") && m.includes("target_game_missing"))).toHaveLength(3);
  expect(warns.some((m) => m.includes("Aborting per-match loop"))).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts`
Expected: FAIL for every test except the `scrapeLeague` characterization test, which already passes on the current code. On the current code the listing error is `"No WebSocket data captured"` with no reason, no `capture ok` line exists, and each failed match is skipped silently with no breaker.

- [ ] **Step 3: Implement.**
  - Replace the 4 capture/navigate/race blocks with `captureSwarm(page, url, config)`: listing `url = LEAGUE_URLS[leagueSlug]`; match `url = eventUrl` / `buildEventUrl(regionAlias, compId, game.id)`.
  - Keep the existing parse and cache logic, and the `mockSwarmData` cache path in `scrapeMatchDetails`.
  - On a null outcome, `console.warn("[Betcris] " + formatCaptureFailure(o))`, and return the formatted string as the error/notFound message (`createNotFoundResult` / `createMatchDetailNotFoundResult` / full-offer `error`). On a listing success, `console.log("[Betcris] " + formatCaptureSuccess(o))`.
  - In the per-match loop, only site-level failures (`isSiteLevelCaptureFailure`) increment the consecutive count. A success resets it. The loop breaks at `WS_CONFIG.MAX_CONSECUTIVE_MATCH_FAILURES`.
  - Delete the three dead functions from `navigation.ts` and `WS_CONFIG.MAX_WAIT_TIME` from `constants.ts`.

- [ ] **Step 4: Run the tests to verify they pass, plus the whole betcris folder.**
Run: `npx vitest run src/scrapers/bookmakers/betcris && npx tsc --noEmit && npx tsc -p /tmp/tsconfig.betcris-tests.json && ! grep -q "Promise.race" src/scrapers/bookmakers/betcris/index.ts && echo OK`
Expected: all betcris tests pass (capture 14, flow 6, parser 2); both tsc runs silent; the last line prints `OK`.

- [ ] **Step 5: Live check** (one standalone smoke, the command under Acceptance criteria, in the worktree). Save its output as `smoke-task2.txt`. Its `otherEntries` is the baseline **B** for A1, and its R comes from the A1 helper grep.
Expected: a `SMOKE {"success":true,…,"matches":20,…}` line, `minMarketsPerMatch ≥ 300`, one `[Betcris] capture ok: …` line, and no `[Betcris] No WebSocket data captured` line. `otherEntries` should be close to today's 2565 (the parser and normalizer have not changed yet).

- [ ] **Step 6: Commit** after `npx tsc --noEmit && npx vitest run` → `Test Files 67 passed (67) / Tests 1202 passed (1202)`.
```bash
git add src/scrapers/bookmakers/betcris/index.ts src/scrapers/bookmakers/betcris/navigation.ts src/scrapers/bookmakers/betcris/constants.ts src/scrapers/bookmakers/betcris/__tests__/scraper-flow.test.ts
git commit -m "fix(betcris): use captureSwarm everywhere, log capture reasons, cap per-match failures"
```

### Task 3: Parser splits the renamed "N+" ladder markets

**Files:**
- Modify: `src/scrapers/bookmakers/betcris/constants.ts` (add three exported sets after `SWARM_MARKET_TYPES`, line 86)
- Modify: `src/scrapers/bookmakers/betcris/parser.ts:293-391` (`parseAllMarkets`), plus a new exported `parseTierLabel`
- Create: `src/scrapers/bookmakers/betcris/__tests__/fixtures/match-31321159-stat-ladders.json`, a byte copy from the evidence dir
- Test: `src/scrapers/bookmakers/betcris/__tests__/stat-ladders.test.ts` (describe `"betcris parser: tier ladders"`)

**Interfaces:**
- Consumes: `ScrapedMarket` (`src/types/full-offer.ts`), the existing `getMarketName` / `MARKET_GROUPS` / `MARKET_TYPE_MAPPING` usage in `parseAllMarkets`; the test helper `loadFixture` (Task 1, `helpers/fake-swarm-page.ts`).
- Produces:
  ```ts
  // constants.ts (14 + 10 + 1 = 25 types)
  export const TEAM_TIER_LADDER_TYPES: ReadonlySet<string>;   // FoulsTotal, FoulsTeam1Total, FoulsTeam2Total, OffsidesTotal, OffsidesTeam1Total, OffsidesTeam2Total, ShotsTeam1Total, ShotsonTargetTotal, ShotsonTargetTeam1Total, ShotsonTargetTeam2Total, ShotsonTarget1stHalfTotal, ThrowInsTotal, ThrowInsTeam1Total, ThrowInsTeam2Total
  export const PLAYER_TIER_LADDER_TYPES: ReadonlySet<string>; // PlayerShots, PlayerShotsonTarget, PlayerFouls, PlayerFoulsWon, PlayerOffsides, PlayerSaves, PlayerAssists, PlayerTackles, PlayerShotsonTargetOutsidetheBox, PlayerHeadedShotsonTarget
  export const PLAYER_TIER_LIST_TYPES: ReadonlySet<string>;   // PlayerShotsAgainstWoodwork
  // parser.ts
  export function parseTierLabel(name: string): { subject: string | null; tier: number } | null;
  ```
  - Team ladder → one entry per rung, sorted by tier: `{ name, bookmakerMarketId: type, groupName, paramValue: String(tier - 0.5), selections: [{ name: "Powyżej", odds, externalId, status }] }`.
  - Player ladder → one entry per player (first-seen order), `paramValue: subject`, selections `[{ name: "<tier>+", … }]` sorted by tier.
  - Player list → one entry whose selection names are `subject`, built **only from `1+` events**. Any other tier (a future `2+`) goes to the residual entry with its original label. It is never collapsed into the 1+ list.
  - Non-tier events of any ladder type → one residual entry with the original shape and no `paramValue`.

- [ ] **Step 1: Write the failing tests.** First copy the fixture (`cp docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/match-31321159-stat-ladders.json src/scrapers/bookmakers/betcris/__tests__/fixtures/`). Then set `const game = loadFixture("match-31321159-stat-ladders.json").game`, `const out = parseAllMarkets(game)`, `byType = (t) => out.filter((m) => m.bookmakerMarketId === t)`:

```ts
it("betcris parser: parseTierLabel reads team and player tiers", () => {
  expect(parseTierLabel("22+")).toEqual({ subject: null, tier: 22 });
  expect(parseTierLabel(" Ainsley Maitland-Niles  2+ ")).toEqual({ subject: "Ainsley Maitland-Niles", tier: 2 });
  expect(parseTierLabel("Tak")).toBeNull();
  expect(parseTierLabel("Powyżej 2.5")).toBeNull();
});
it("betcris parser: splits FoulsTotal 22+..26+ into OVER rungs 21.5..25.5", () => {
  expect(byType("FoulsTotal").map((m) => [m.paramValue, m.selections[0].name, m.selections[0].odds]))
    .toEqual([["21.5", "Powyżej", 1.46], ["22.5", "Powyżej", 1.64], ["23.5", "Powyżej", 1.9], ["24.5", "Powyżej", 2.24], ["25.5", "Powyżej", 2.7]]);
  expect(byType("ShotsTeam1Total").map((m) => m.paramValue)).toEqual(["14.5", "15.5", "16.5", "17.5", "18.5", "19.5", "20.5"]);
  expect(byType("ThrowInsTotal").map((m) => [m.paramValue, m.selections[0].odds])).toEqual([["39.5", 1.76], ["40.5", 1.94], ["41.5", 2.15]]);
});
it("betcris parser: splits PlayerShots into one entry per player with N+ selections", () => {
  const shots = byType("PlayerShots");
  expect(shots).toHaveLength(33);
  const amn = shots.find((m) => m.paramValue === "Ainsley Maitland-Niles")!;
  expect(amn.name).toBe("Zawodnik - strzały");
  expect(amn.selections.map((s) => [s.name, s.odds])).toEqual([["1+", 1.46], ["2+", 3.1], ["3+", 7.8], ["4+", 19]]);
  expect(byType("PlayerSaves").find((m) => m.paramValue === "Jordan Pickford")!.selections.map((s) => [s.name, s.odds]))
    .toEqual([["2+", 1.34], ["3+", 2.01], ["4+", 3.55], ["5+", 7.2]]);
});
it("betcris parser: splits PlayerHeadedShotsonTarget per player, keeping every raw tier", () => {
  const headed = byType("PlayerHeadedShotsonTarget");
  expect(headed).toHaveLength(33);
  expect(headed.find((m) => m.paramValue === "Thierno Barry")!.selections.map((s) => [s.name, s.odds]))
    .toEqual([["1+", 2.05], ["2+", 6.2], ["3+", 15], ["4+", 31]]); // the parser does not gate; Task 4 drops 4+
});
it("betcris parser: PlayerShotsAgainstWoodwork becomes one player-name list", () => {
  const [ww] = byType("PlayerShotsAgainstWoodwork");
  expect(byType("PlayerShotsAgainstWoodwork")).toHaveLength(1);
  expect(ww.selections).toHaveLength(33);
  expect(ww.selections).toContainEqual(expect.objectContaining({ name: "Thierno Barry", odds: 7.5 }));
});
it("betcris parser: a woodwork tier other than 1+ goes to the residual entry, never into the list", () => {
  const g = { ...game, market: { w: { id: 2, type: "PlayerShotsAgainstWoodwork", name: "Zawodnik - strzały w obramowanie bramki", order: 1, col_count: 1,
    event: { a: { id: 21, name: "Thierno Barry 1+", price: 7.5, order: 1 }, b: { id: 22, name: "Thierno Barry 2+", price: 41, order: 2 } } } } };
  expect(parseAllMarkets(g as any).map((m) => [m.paramValue, m.selections.map((s) => s.name)]))
    .toEqual([[undefined, ["Thierno Barry"]], [undefined, ["Thierno Barry 2+"]]]);
});
it("betcris parser: keeps non-tier events of a ladder market in one residual entry", () => {
  const g = { ...game, market: { m: { id: 1, type: "FoulsTotal", name: "Faule. Suma", order: 1, col_count: 1,
    event: { a: { id: 11, name: "22+", price: 1.46, order: 1, type_1: "22+" }, b: { id: 12, name: "Tak", price: 1.9, order: 2, type_1: "Tak" } } } } };
  const res = parseAllMarkets(g as any);
  expect(res.map((m) => [m.paramValue, m.selections.map((s) => s.name)])).toEqual([["21.5", ["Powyżej"]], [undefined, ["Tak"]]]);
});
it("betcris parser: total entry count on the 32-market ladder fixture", () => {
  expect(out).toHaveLength(372); // 67 team rungs + 297 player entries (264 + 33 headed) + 1 woodwork list + 7 untouched markets
  expect(byType("PlayerShotsOutsidetheBox")).toHaveLength(1); // not split: catalog PLAYER_SHOTS_OUTSIDE_BOX has hasParameter:false
});
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run src/scrapers/bookmakers/betcris/__tests__/stat-ladders.test.ts -t "betcris parser"`
Expected: FAIL. `parseTierLabel` is not exported, and FoulsTotal yields 1 entry.

- [ ] **Step 3: Implement** the sets and `parseTierLabel`. Regex: trim, then `^(?:(.*\S)\s+)?(\d+)\+$`; collapse inner whitespace in `subject`. Add the ladder branch in `parseAllMarkets` before the `BULK_PLAYER_LIST_MARKET_SELECTION` branch (parser.ts:356). Keep the `odds > 1` filter.

- [ ] **Step 4: Run the tests to verify they pass, and confirm the existing parser tests and golden test still pass.**
Run: `npx vitest run src/scrapers/bookmakers/betcris src/services/normalization/__tests__/golden.test.ts -t betcris && npx tsc --noEmit && npx tsc -p /tmp/tsconfig.betcris-tests.json`
Expected: all pass (stat-ladders: 8 parser tests); golden `betcris` unchanged.

- [ ] **Step 5: Commit** after `npx tsc --noEmit && npx vitest run` → `Test Files 68 passed (68) / Tests 1210 passed (1210)`.
```bash
git add src/scrapers/bookmakers/betcris/constants.ts src/scrapers/bookmakers/betcris/parser.ts src/scrapers/bookmakers/betcris/__tests__/stat-ladders.test.ts src/scrapers/bookmakers/betcris/__tests__/fixtures/match-31321159-stat-ladders.json
git commit -m "fix(betcris): split renamed Swarm N+ ladder markets per rung and per player"
```

### Task 4: Normalizer maps the renamed stats ids

**Files:**
- Modify: `src/services/normalization/bookmakers/betcris-normalizer.ts`
  - `BETCRIS_MARKET_TYPE_TO_CODE` (29-312): add 25 entries
  - `STAT_OVER_UNDER_PARAM_MARKETS` (1090-1135): add `"HALF_TIME_TOTAL_SHOTS_ON_TARGET"`
  - player-prop selection case group (915-950): add `"PLAYER_TACKLES"`, `"PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX"`, `"PLAYER_HEADER_SHOTS_ON_TARGET"`
  - new block after the `PLAYER_OU_PARAM_MARKETS` block (ends at line 1636)
- Test: `src/scrapers/bookmakers/betcris/__tests__/stat-ladders.test.ts` (describe `"betcris normalizer: tier ladders"`)

**Interfaces:**
- Consumes: Task 3 parser output; `canonicalizeBetcrisPlayerName` (betcris-normalizer.ts:641); `getMarketByCode` (market-catalog).
- Produces:
  - `const PLAYER_TIER_LADDER_CODES: NormalizedMarketType[] = ["PLAYER_SHOTS","PLAYER_SHOTS_ON_TARGET","PLAYER_FOULS","PLAYER_FOULS_WON","PLAYER_OFFSIDES","PLAYER_SAVES","PLAYER_ASSISTS","PLAYER_TACKLES","PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX","PLAYER_HEADER_SHOTS_ON_TARGET"]`.
  - Rule: the code is in this list, `raw.paramValue` is non-numeric, and every selection code matches `/^\d+\+$/`. Then set `paramValue = canonicalizeBetcrisPlayerName(raw.paramValue)`, drop selections whose tier is not in the catalog `selections`, and return `null` if none remain. For PLAYER_ASSISTS the param matches what the existing block at 1704-1718 already sets. The new part is the gating against `[YES, NO, 1+, 2+]`, so a future `3+` is dropped, not leaked as an orphan code. The August `ToAssistaGoal` path is untouched: its golden raw entries carry no `paramValue`.
  - PLAYER_HIT_WOODWORK: drop selections whose raw label still ends in an `N+` tier. Those are parser residuals (Task 3: only `1+` belongs to the list). Return `null` if none remain. August `PlayerShottoHittheWoodwork` labels are bare player names (golden fixture), so they are unaffected.
  - Id map additions (all to existing codes):

    | Ids | Code |
    |---|---|
    | `FoulsTotal` | FOULS_TOTAL |
    | `FoulsTeam1Total`, `FoulsTeam2Total` | HOME_TEAM_TOTAL_FOULS, AWAY_TEAM_TOTAL_FOULS |
    | `OffsidesTotal` | OFFSIDES_TOTAL |
    | `OffsidesTeam1Total`, `OffsidesTeam2Total` | HOME_TEAM_TOTAL_OFFSIDES, AWAY_TEAM_TOTAL_OFFSIDES |
    | `ShotsTeam1Total` | TEAM_TOTAL_SHOTS |
    | `ShotsonTargetTotal` | TOTAL_SHOTS_ON_TARGET |
    | `ShotsonTargetTeam1Total`, `ShotsonTargetTeam2Total` | TEAM_TOTAL_SHOTS_ON_TARGET |
    | `ShotsonTarget1stHalfTotal` | HALF_TIME_TOTAL_SHOTS_ON_TARGET |
    | `ThrowInsTotal` | THROW_INS_TOTAL |
    | `ThrowInsTeam1Total`, `ThrowInsTeam2Total` | HOME_TEAM_TOTAL_THROW_INS, AWAY_TEAM_TOTAL_THROW_INS |
    | `PlayerShots` | PLAYER_SHOTS |
    | `PlayerShotsonTarget` | PLAYER_SHOTS_ON_TARGET |
    | `PlayerFouls` | PLAYER_FOULS |
    | `PlayerFoulsWon` | PLAYER_FOULS_WON |
    | `PlayerOffsides` | PLAYER_OFFSIDES |
    | `PlayerSaves` | PLAYER_SAVES |
    | `PlayerAssists` | PLAYER_ASSISTS |
    | `PlayerTackles` | PLAYER_TACKLES |
    | `PlayerShotsonTargetOutsidetheBox` | PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX |
    | `PlayerHeadedShotsonTarget` | PLAYER_HEADER_SHOTS_ON_TARGET |
    | `PlayerShotsAgainstWoodwork` | PLAYER_HIT_WOODWORK |

- [ ] **Step 1: Write the failing tests.** Use `norm(m) = betcrisNormalizer.normalizeMarket(m, { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league", leagueName: "premier-league" })`, `pick(type, param?)` = the Task 3 parser entry, and `view(o) = o && { key: o.marketKey, sel: o.selections.map((s) => [s.code, s.odds]) }`:

```ts
it("betcris normalizer: team ladders land on existing O/U codes with side-scoped params", () => {
  expect(view(norm(pick("FoulsTotal", "21.5")))).toEqual({ key: "FOULS_TOTAL:21.5", sel: [["OVER", 1.46]] });
  expect(view(norm(pick("FoulsTeam1Total", "9.5")))).toEqual({ key: "HOME_TEAM_TOTAL_FOULS:9.5", sel: [["OVER", 1.35]] });
  expect(view(norm(pick("ShotsTeam1Total", "14.5")))).toEqual({ key: "TEAM_TOTAL_SHOTS:HOME:14.5", sel: [["OVER", 1.39]] });
  expect(view(norm(pick("ShotsonTargetTeam2Total", "2.5")))).toEqual({ key: "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:2.5", sel: [["OVER", 1.38]] });
  expect(view(norm(pick("OffsidesTeam1Total", "1.5")))).toEqual({ key: "HOME_TEAM_TOTAL_OFFSIDES:1.5", sel: [["OVER", 1.24]] });
  expect(view(norm(pick("ShotsonTarget1stHalfTotal", "2.5")))).toEqual({ key: "HALF_TIME_TOTAL_SHOTS_ON_TARGET:2.5", sel: [["OVER", 1.2]] });
  expect(view(norm(pick("ThrowInsTotal", "39.5")))).toEqual({ key: "THROW_INS_TOTAL:39.5", sel: [["OVER", 1.76]] });
});
it("betcris normalizer: new FoulsTotal rung equals the August FoulsOver/Under shape", () => {
  const rung = pick("FoulsTotal", "21.5");
  const { debug: _a, ...fresh } = norm(rung)!;
  const { debug: _b, ...old } = norm({ ...rung, bookmakerMarketId: "FoulsOver/Under" })!;
  expect(fresh).toEqual(old);
});
it("betcris normalizer: player ladders key by canonical player and keep N+ tiers", () => {
  expect(view(norm(pick("PlayerShots", "Ainsley Maitland-Niles")))).toEqual({ key: "PLAYER_SHOTS:Ainsley Maitland-Niles", sel: [["1+", 1.46], ["2+", 3.1], ["3+", 7.8], ["4+", 19]] });
  expect(view(norm(pick("PlayerFouls", "Victor Torp Overgaard")))).toEqual({ key: "PLAYER_FOULS:Victor Torp", sel: [["1+", 1.17], ["2+", 1.74], ["3+", 3.3], ["4+", 7.2]] });
  expect(view(norm(pick("PlayerSaves", "Carl Rushworth")))).toEqual({ key: "PLAYER_SAVES:Carl Rushworth", sel: [["3+", 1.35], ["4+", 1.85], ["5+", 2.9], ["6+", 5]] });
  expect(view(norm(pick("PlayerAssists", "Kiernan Dewsbury-Hall")))).toEqual({ key: "PLAYER_ASSISTS:Kiernan Dewsbury-Hall", sel: [["1+", 3.7]] });
  expect(view(norm(pick("PlayerTackles", "Ainsley Maitland-Niles")))).toEqual({ key: "PLAYER_TACKLES:Ainsley Maitland-Niles", sel: [["2+", 1.48], ["3+", 2.43], ["4+", 4.75], ["5+", 10]] });
  expect(view(norm(pick("PlayerShotsonTargetOutsidetheBox", "Kiernan Dewsbury-Hall")))).toEqual({ key: "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX:Kiernan Dewsbury-Hall", sel: [["1+", 2.85], ["2+", 11], ["3+", 23]] });
  expect(view(norm(pick("PlayerOffsides", "Thierno Barry")))).toEqual({ key: "PLAYER_OFFSIDES:Thierno Barry", sel: [["1+", 1.53], ["2+", 3.5], ["3+", 9.5]] });
});
it("betcris normalizer: drops tiers the catalog does not declare", () => {
  expect(view(norm(pick("PlayerFouls", "Caleb Yirenkyi")))!.sel).toEqual([["2+", 1.4], ["3+", 2.2], ["4+", 4.2]]); // raw 5+ 8.6 dropped
  expect(norm({ ...pick("PlayerFouls", "Caleb Yirenkyi"), selections: [{ name: "5+", odds: 8.6 }] })).toBeNull();
  expect(view(norm(pick("PlayerHeadedShotsonTarget", "Thierno Barry"))))
    .toEqual({ key: "PLAYER_HEADER_SHOTS_ON_TARGET:Thierno Barry", sel: [["1+", 2.05], ["2+", 6.2], ["3+", 15]] }); // raw 4+ 31 dropped (catalog 1+..3+)
  expect(norm({ ...pick("PlayerAssists", "Kiernan Dewsbury-Hall"), selections: [{ name: "3+", odds: 41 }] })).toBeNull(); // catalog [YES, NO, 1+, 2+]
});
it("betcris normalizer: woodwork list keeps the August PLAYER_HIT_WOODWORK shape", () => {
  const o = norm(pick("PlayerShotsAgainstWoodwork"))!;
  expect(o.marketKey).toBe("PLAYER_HIT_WOODWORK");
  expect(o.selections).toHaveLength(33);
  expect(o.selections).toContainEqual(expect.objectContaining({ code: "Victor Torp", odds: 19 }));
  // a parser residual such as "Thierno Barry 2+" is not a player name: dropped, never treated as 1+
  expect(norm({ ...pick("PlayerShotsAgainstWoodwork"), selections: [{ name: "Thierno Barry 2+", odds: 41 }] })).toBeNull();
});
it("betcris normalizer: all 372 ladder-fixture entries normalize except one excluded and two unmapped types", () => {
  const outs = parseAllMarkets(game).map((m) => [m.bookmakerMarketId, norm(m)] as const);
  expect(outs).toHaveLength(372);
  expect(outs.filter(([, o]) => o === null).map(([id]) => id).sort())
    .toEqual(["ExactNumberOfGoals", "PlayerShotsOutsidetheBox", "ShotsonTarget2ndHalfTotal"]);
  // ExactNumberOfGoals is excluded on purpose (betcris-normalizer.ts:347); verified null on the current code too
});
```

- [ ] **Step 2: Run them to verify they fail.**
Run: `npx vitest run src/scrapers/bookmakers/betcris/__tests__/stat-ladders.test.ts -t "betcris normalizer"`
Expected: FAIL. `norm(...)` returns `null` for `FoulsTotal`, `PlayerShots`, etc.

- [ ] **Step 3: Implement** the id entries, the list addition, the case-group addition, the `PLAYER_TIER_LADDER_CODES` block and the PLAYER_HIT_WOODWORK residual drop, as specified in Interfaces.

- [ ] **Step 4: Run them to verify they pass, then check the golden fixture.**
Run: `npx vitest run src/scrapers/bookmakers/betcris src/services/normalization/__tests__/golden.test.ts -t betcris && npx tsx scripts/rebless-golden.ts --bookmaker betcris --dry && npx tsc --noEmit && npx tsc -p /tmp/tsconfig.betcris-tests.json`
Expected: all pass (stat-ladders: 8 parser + 6 normalizer tests); rebless prints `{"changedTotal":0,"dry":true}`. Any non-zero count means existing entries changed: inspect them and stop before going further.

- [ ] **Step 5: Live check** (one smoke; save the output as `smoke-task4.txt`).
Expected: A1 holds. `otherShare ≤ 0.21`. `otherEntries ≤ B − 10 × R`, with B from `smoke-task2.txt` and R from this output via the A1 helper grep (today R = 10). `scrapedMarkets` is well above the Task 2 smoke's, because the ladders are now split (+340 entries per rich game such as 31321159).

- [ ] **Step 6: Commit** after `npx tsc --noEmit && npx vitest run` → `Test Files 68 passed (68) / Tests 1216 passed (1216)`.
```bash
git add src/services/normalization/bookmakers/betcris-normalizer.ts src/scrapers/bookmakers/betcris/__tests__/stat-ladders.test.ts
git commit -m "fix(betcris): map renamed Swarm stats ids to catalog codes with player tier ladders"
```

### Task 5: Archive `paramValue`, then harvest the Premier League golden fixture offline

**Files:**
- Modify: `src/services/audit/scraper-audit-core.ts:370-376` (archive `raw` gains `paramValue` when the raw market has one)
- Modify: `src/services/audit/types.ts:47-53` (`PrepMarketEntry.raw.paramValue?: string`)
- Create: `src/services/audit/__tests__/prep-archive-param.test.ts`
- Create (harvested, never hand-edited): `src/services/normalization/__fixtures__/betcris/premier-league_everton_coventry-city.json` and `.expected.json`
- Test: `src/services/normalization/__tests__/golden.test.ts` (unchanged; it picks up the new pair automatically)

**Interfaces:**
- Consumes: `buildPrepAuditOutput`, `scrapedMarketsToRaw`, `dedupeRawMarkets` (`scraper-audit-core.ts:169-192, 230`); `parseAllMarkets`, `parseTeamNames` (Task 3 parser); `betcrisNormalizer` (Task 4); `scripts/harvest-fixtures.ts` (`toRawBookmakerMarket` already reads `raw.paramValue`, line 138); the durable recording `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/match-31321159-frames.json` (SINGLE_GAME_VIEW frame t=2654, game 31321159 with 613 Swarm markets, all 25 ladder types).
- Produces: `PrepMarketEntry.raw.paramValue?: string`. The key is present only when the raw market has a value, so existing archives and fixtures stay byte-identical. Also a frozen PL raw snapshot whose expected file holds the November stats keys (`FOULS_TOTAL:21.5`, `PLAYER_SHOTS:<player>`, …). That snapshot is the regression net for the next Swarm rename.
- Why offline: the prep-audit archive drops `paramValue` today (0 of 1662 raw entries in the World Cup fixture have one). Harvesting before this fix would freeze every rung as `FOULS_TOTAL` with no line and every player ladder as `PLAYER_SHOTS` with no player. Why the recording instead of a live game: team ladders exist only around match day. Leeds–Tottenham had none the day before; Everton–Coventry, the recorded game, has all of them.

- [ ] **Step 1: Write the failing test** `prep-archive-param.test.ts`:

```ts
import { buildPrepAuditOutput } from "../scraper-audit-core.js";
import { betcrisNormalizer } from "../../normalization/bookmakers/betcris-normalizer.js";

const ctx = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league", leagueName: "premier-league" };
const meta = { matchId: "31321159", homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" };
it("prep archive keeps raw.paramValue so split ladder rungs and players survive harvesting", () => {
  const out = buildPrepAuditOutput({ normalizer: betcrisNormalizer, ctx, meta, rawMarkets: [
    { name: "Faule. Suma", bookmakerMarketId: "FoulsTotal", paramValue: "21.5", selections: [{ name: "Powyżej", odds: 1.46 }] },
    { name: "Zawodnik - strzały", bookmakerMarketId: "PlayerShots", paramValue: "Ainsley Maitland-Niles", selections: [{ name: "1+", odds: 1.46 }, { name: "2+", odds: 3.1 }] },
    { name: "Dokładna liczba goli", bookmakerMarketId: "TotalGoalsExact", selections: [{ name: " 0", odds: 10.7 }, { name: " 1", odds: 4.57 }] },
  ] });
  expect(out.markets.map((m) => m.raw.paramValue)).toEqual(["21.5", "Ainsley Maitland-Niles", undefined]);
  expect(out.markets.map((m) => m.normalized.marketKey).slice(0, 2)).toEqual(["FOULS_TOTAL:21.5", "PLAYER_SHOTS:Ainsley Maitland-Niles"]);
  expect("paramValue" in out.markets[2].raw).toBe(false); // absent, not null: old archives/fixtures stay byte-identical
});
```

- [ ] **Step 2: Run it to verify it fails.**
Run: `npx vitest run src/services/audit/__tests__/prep-archive-param.test.ts`
Expected: FAIL. `raw.paramValue` is `undefined` for the first two markets.

- [ ] **Step 3: Implement.** In `scraper-audit-core.ts:370-376`, add `...(raw.paramValue ? { paramValue: raw.paramValue } : {})` after `bookmakerMarketId`. In `types.ts:47-53`, add `paramValue?: string` to `PrepMarketEntry.raw`.

- [ ] **Step 4: Verify that nothing existing moved.**
Run: `npx vitest run src/services/audit src/services/normalization/__tests__/golden.test.ts && npx tsx scripts/rebless-golden.ts --all --dry && npx tsc --noEmit`
Expected: all pass, and rebless prints `{"changedTotal":0,"dry":true}`, the same as today.

- [ ] **Step 5: Build the archive offline from the recording** (no live traffic). This command shape was proven on the current code on 2026-11-06. It printed `ARCHIVE {"markets":687,"withParam":0,"rawIds":362}`, because before Tasks 3-5 nothing is split and nothing is archived.
```bash
mkdir -p docs/betcris-audit/.tmp && npx tsx -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { parseAllMarkets, parseTeamNames } from './src/scrapers/bookmakers/betcris/parser.ts';
import { betcrisNormalizer } from './src/services/normalization/bookmakers/betcris-normalizer.ts';
import { buildPrepAuditOutput, scrapedMarketsToRaw, dedupeRawMarkets } from './src/services/audit/scraper-audit-core.ts';
const [src, out] = process.argv.slice(1);
const rec = JSON.parse(readFileSync(src, 'utf8'));
const frame = rec.events.find((e) => e.kind === 'recv' && e.payload?.includes('\"markets_count\"') && e.payload.length > 500000);
const msg = JSON.parse(frame.payload);
const game = Object.values(msg.data.data.sport).flatMap((s) => Object.values(s.region)).flatMap((r) => Object.values(r.competition)).flatMap((c) => Object.values(c.game)).find((g) => g.id === 31321159);
const rawMarkets = dedupeRawMarkets(scrapedMarketsToRaw(parseAllMarkets(game, parseTeamNames(game))));
const ctx = { homeTeam: 'Everton', awayTeam: 'Coventry City', league: 'premier-league', leagueName: 'premier-league' };
const output = buildPrepAuditOutput({ normalizer: betcrisNormalizer, ctx, rawMarkets, meta: { matchId: '31321159', homeTeam: 'Everton', awayTeam: 'Coventry City', league: 'premier-league' } });
writeFileSync(out, JSON.stringify(output, null, 1));
console.log('ARCHIVE ' + JSON.stringify({ markets: output.markets.length, withParam: output.markets.filter((m) => 'paramValue' in m.raw).length, rawIds: new Set(output.markets.map((m) => m.raw.bookmakerMarketId)).size }));
" docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/match-31321159-frames.json docs/betcris-audit/.tmp/premier-league_everton_coventry-city__2026-11-06.json 2>&1 | grep '^ARCHIVE'
```
Expected: `ARCHIVE {"markets":1027,"withParam":785,"rawIds":362}`. That is 687 − 25 ladder markets + 365 split entries (67 rungs, 297 player entries, 1 woodwork list). `withParam` is the 421 pre-existing parameterized markets plus 364 rungs and player entries. The file name follows the archive naming rule (`harvest-fixtures.ts:312-317`), so the fixture becomes `premier-league_everton_coventry-city`. `docs/*-audit/.tmp/` is gitignored (`.gitignore:27`).

- [ ] **Step 6: Harvest.**
Run: `npx tsx scripts/harvest-fixtures.ts --archive docs/betcris-audit/.tmp/premier-league_everton_coventry-city__2026-11-06.json --bookmaker betcris --out-dir src/services/normalization/__fixtures__ --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json`
Pass `--out-dir` explicitly. The script's default is still pre-extraction: `REPO_ROOT = resolve(SCRIPT_DIR, "..", "..")` plus `"backend"` (`scripts/harvest-fixtures.ts:193,224`), which resolves outside this repo. The same command shape was proven against a scratch `--out-dir` on 2026-11-06 (`"refreshed": 687` on the current code).
Expected: a new `premier-league_everton_coventry-city.json` + `.expected.json` pair, `"refreshed": 1027`.

- [ ] **Step 7: Check the frozen keys** (read-only):
```bash
python3 -I - src/services/normalization/__fixtures__/betcris/premier-league_everton_coventry-city <<'EOF'
import json, sys
fx = {e["index"]: e["raw"] for e in json.load(open(sys.argv[1] + ".json"))["entries"]}
ex = json.load(open(sys.argv[1] + ".expected.json"))["entries"]
LADDER = {"FoulsTotal","FoulsTeam1Total","FoulsTeam2Total","OffsidesTotal","OffsidesTeam1Total","OffsidesTeam2Total","ShotsTeam1Total","ShotsonTargetTotal","ShotsonTargetTeam1Total","ShotsonTargetTeam2Total","ShotsonTarget1stHalfTotal","ThrowInsTotal","ThrowInsTeam1Total","ThrowInsTeam2Total","PlayerShots","PlayerShotsonTarget","PlayerFouls","PlayerFoulsWon","PlayerOffsides","PlayerSaves","PlayerAssists","PlayerTackles","PlayerShotsonTargetOutsidetheBox","PlayerHeadedShotsonTarget"}
lad = [e for e in ex if fx[e["index"]].get("bookmakerMarketId") in LADDER]
bad = [(fx[e["index"]]["bookmakerMarketId"], (e["expected"] or {}).get("marketKey")) for e in lad if not e["expected"] or ":" not in e["expected"]["marketKey"]]
keys = {e["expected"]["marketKey"]: e["expected"]["selections"] for e in ex if e["expected"]}
print("ladder entries", len(lad), "without param", len(bad), bad[:5])
for k in ["FOULS_TOTAL:21.5", "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:2.5", "PLAYER_SHOTS:Ainsley Maitland-Niles", "PLAYER_HEADER_SHOTS_ON_TARGET:Thierno Barry"]:
    print(k, [(s["code"], s["odds"]) for s in keys.get(k, [])])
EOF
```
Expected:
```text
ladder entries 364 without param 0 []
FOULS_TOTAL:21.5 [('OVER', 1.46)]
TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:2.5 [('OVER', 1.38)]
PLAYER_SHOTS:Ainsley Maitland-Niles [('1+', 1.46), ('2+', 3.1), ('3+', 7.8), ('4+', 19)]
PLAYER_HEADER_SHOTS_ON_TARGET:Thierno Barry [('1+', 2.05), ('2+', 6.2), ('3+', 15)]
```
Then bless the verified raw markets through the harvester, never by hand. Repeat `--bless` once per raw name you checked against the archive raw: `npx tsx scripts/harvest-fixtures.ts --archive docs/betcris-audit/.tmp/premier-league_everton_coventry-city__2026-11-06.json --bookmaker betcris --out-dir src/services/normalization/__fixtures__ --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json --bless "Faule. Suma" --bless "Zawodnik - strzały" --bless "Zawodnik - strzały celne głową" --bless "Strzały celne. Team 2. Suma"`. `--bless` matches every split entry that carries the raw name. Other entries stay byte-identical.

- [ ] **Step 8: Run the golden test.**
Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t betcris && npx tsc --noEmit`
Expected: PASS, with 3 betcris tests: "has at least one fixture pair" plus one per fixture (World Cup, Premier League).

- [ ] **Step 9: Commit** after `npx tsc --noEmit && npx vitest run` → `Test Files 69 passed (69) / Tests 1218 passed (1218)` (1 archive test + 1 golden fixture test).
```bash
git add src/services/audit/scraper-audit-core.ts src/services/audit/types.ts src/services/audit/__tests__/prep-archive-param.test.ts src/services/normalization/__fixtures__/betcris/premier-league_everton_coventry-city.json src/services/normalization/__fixtures__/betcris/premier-league_everton_coventry-city.expected.json
git commit -m "test(betcris): archive paramValue and freeze the November Swarm stats shape as a golden fixture"
```

### Task 6: One per-run "unmapped market ids" line per bookmaker

The risk "Swarm ids changed once and may change again" needs an owner. observability.md has no unknown/unmapped summary item, so this plan adds the smallest one. Today the signal is buried in 2243 per-market warn lines per run.

**Files:**
- Create: `src/services/normalization/unmapped-summary.ts`
- Modify: `src/services/scrape-helpers.ts:32-49` (normalization loop of `normalizeAndSaveMatches`, which the aggregator calls once per bookmaker per run at `aggregator.ts:261`). observability.md Task 1 edits lines 51-62 of the same file (the batch-save error text), a different hunk. Either order works.
- Test: `src/services/normalization/__tests__/unmapped-summary.test.ts`

**Interfaces:**
- Consumes: `ScrapedMarket` after `normalizeMarketsForBookmaker` (`normalizedType`, `bookmakerMarketId`, `name`).
- Produces:
  ```ts
  export interface UnmappedSummary { otherMarkets: number; distinctIds: number; top: Array<[id: string, count: number]> }
  export function summarizeUnmappedMarkets(markets: ScrapedMarket[], topN?: number): UnmappedSummary; // key = bookmakerMarketId ?? name; top sorted by count desc, then id asc; topN default 5
  export function formatUnmappedSummary(bookmaker: string, s: UnmappedSummary): string;
  ```
  - Log line, via `console.warn` once per `normalizeAndSaveMatches` call when `otherMarkets > 0`: `[ScrapeHelpers] betcris: 2 unmapped market ids, 3 OTHER markets this run (top: ShotsonTarget2ndHalfTotal×2, PlayerShotsOutsidetheBox×1)`.

- [ ] **Step 1: Write the failing tests:**
```ts
const mk = (id: string | undefined, type: string, name = "x") => ({ name, bookmakerMarketId: id, normalizedType: type, selections: [] }) as any;
it("summarizeUnmappedMarkets counts OTHER markets by bookmaker id, falling back to the name", () => {
  const s = summarizeUnmappedMarkets([mk("ShotsonTarget2ndHalfTotal", "OTHER"), mk("ShotsonTarget2ndHalfTotal", "OTHER"),
    mk("PlayerShotsOutsidetheBox", "OTHER"), mk("FoulsTotal", "FOULS_TOTAL"), mk(undefined, "OTHER", "Faule. 1. połowa")]);
  expect(s).toEqual({ otherMarkets: 4, distinctIds: 3, top: [["ShotsonTarget2ndHalfTotal", 2], ["Faule. 1. połowa", 1], ["PlayerShotsOutsidetheBox", 1]] });
});
it("formatUnmappedSummary renders one greppable line", () => {
  expect(formatUnmappedSummary("betcris", { otherMarkets: 3, distinctIds: 2, top: [["ShotsonTarget2ndHalfTotal", 2], ["PlayerShotsOutsidetheBox", 1]] }))
    .toBe("[ScrapeHelpers] betcris: 2 unmapped market ids, 3 OTHER markets this run (top: ShotsonTarget2ndHalfTotal×2, PlayerShotsOutsidetheBox×1)");
});
```
- [ ] **Step 2: Run them to verify they fail.** `npx vitest run src/services/normalization/__tests__/unmapped-summary.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** the module, then call it in `normalizeAndSaveMatches` over all normalized matches of the call, after the loop.
- [ ] **Step 4: Run them to verify they pass.** Same command, then `npx tsc --noEmit`. Expected: 2 passed, tsc silent.
- [ ] **Step 5: Commit** after `npx tsc --noEmit && npx vitest run` → `Test Files 70 passed (70) / Tests 1220 passed (1220)`.
```bash
git add src/services/normalization/unmapped-summary.ts src/services/normalization/__tests__/unmapped-summary.test.ts src/services/scrape-helpers.ts
git commit -m "feat(normalization): log one unmapped-market summary per bookmaker per run"
```

### Task 7: Live acceptance (no code)

**Files:**
- Create (optional, evidence only): `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/acceptance-<date>.json` with the measured A1-A4 values

**Interfaces:**
- Consumes: everything above, merged into the main checkout with the owner's go-ahead. The merge restarts the dev server, and its startup run (a full 14-bookmaker run) persists to the DB and counts toward A2.

- [ ] **Step 1: A1.** Run the smoke command once and save the output as `smoke.txt`. Compute R with the A1 helper grep.
Expected: `success:true`, `matches ≥ 18`, `minMarketsPerMatch ≥ 300`, `otherShare ≤ 0.21`, `otherEntries ≤ B − 10 × R` (B from Task 2 Step 5), `durationMs ≤ 240000`.

- [ ] **Step 2: A2.** Watch 3 consecutive **full** runs: startup, scheduled, or a full admin scrape without a `bookmakers` filter (command in A2; owner-approved because it writes the DB). Never use a betcris-only scrape here.
Run per run (works with today's aggregator line and with observability's `${bm} ${status}:` line):
`sed 's/\x1b\[[0-9;]*m//g' <server log> | grep -E '\[Aggregator/FullOffer\] betcris [a-z_]+:|\[Betcris\] (No WebSocket|capture ok)|\[ScrapeHelpers\] betcris:'`
Expected per run: one `[Betcris] capture ok: navMs=…, wsOpenMs=…, firstUsefulFrameMs=…, attempts=…, loopLagMaxMs=…, finalUrl=…` line; an aggregator line with N ≥ 18 matches (`betcris completed: N matches, M markets saved` today, `betcris success: N matches, …` after observability Task 3); and one `[ScrapeHelpers] betcris: … unmapped market ids` line. Record `firstUsefulFrameMs`, `attempts` and `loopLagMaxMs` for each run, and flag any run with `firstUsefulFrameMs > 12000`. Read `loopLagMaxMs` as the longest Node main-thread stall in that attempt: ~20 means idle, N means one callback (or GC) blocked the thread for roughly N-20 to N ms. It does not show browser-side slowness, and it does not show whether a deadline waited for queued frames; grep `deadline fired .* ms late` for that. Repeat after the betters/lebull/pzbuk/totalbet fixes land.

- [ ] **Step 3: A3 and A4.** Choose a PL game on match day (team ladders only appear then). List the games with `GID=0 node docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/direct-swarm.mjs wss://eu-swarm-springre.trexname.com/ /tmp/bcl && python3 -I -c "import json,datetime as d;m=json.load(open('/tmp/bcl-list.json'));[print(g['id'],d.datetime.fromtimestamp(g['start_ts'],d.timezone.utc).isoformat(),g['team1_name'].strip(),'-',g['team2_name'].strip(),'mc=',g['markets_count']) for s in m['data']['data']['sport'].values() for r in s['region'].values() for c in r['competition'].values() for g in sorted(c['game'].values(),key=lambda g:g['start_ts'])]"`. Expected lines look like `31333513 2026-11-07T12:30:00+00:00 Leeds - Tottenham mc= 582`. Take a game with `mc=` ≥ 500 that kicks off today and has not started. Then dump it and its normalized view:
```bash
GID=<id> node docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/direct-swarm.mjs wss://eu-swarm-springre.trexname.com/ /tmp/bc
curl -s "http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league" > /tmp/nm.json
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/ladder_coverage.py /tmp/bc-game.json /tmp/nm.json
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/health.py /tmp/nm.json /tmp/rows.json
python3 -I - /tmp/nm.json <<'EOF'
import json, sys, statistics
TEAM = ["FOULS_TOTAL", "TOTAL_SHOTS_ON_TARGET", "THROW_INS_TOTAL", "OFFSIDES_TOTAL", "HALF_TIME_TOTAL_SHOTS_ON_TARGET"]
d = json.load(open(sys.argv[1]))["data"]; worst = 0; bad = []
for cat in d["categories"]:
    for m in cat["markets"]:
        if m["marketKey"] not in TEAM: continue
        devs = []
        for p in m["parameters"]:
            bc = [s["odds"] for b in p["bookmakers"] if b["bookmaker"] == "betcris" for s in b["selections"] if s["type"] == "OVER"]
            peers = [s["odds"] for b in p["bookmakers"] if b["bookmaker"] != "betcris" for s in b["selections"] if s["type"] == "OVER"]
            if bc and len(peers) >= 2: devs.append(100 * (bc[0] / statistics.median(peers) - 1))
        if devs:
            med = statistics.median(devs); worst = max([worst] + [abs(x) for x in devs])
            print(m["marketKey"], "lines", len(devs), "median dev %.1f%%" % med, "worst %.1f%%" % max(devs, key=abs))
            if abs(med) > 15 or max(abs(x) for x in devs) > 25: bad.append(m["marketKey"])
print("LADDER_PEER_CHECK", "FAIL" if bad else "PASS", bad)
EOF
GID=<id> node docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/direct-swarm.mjs wss://eu-swarm-springre.trexname.com/ /tmp/raw
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/tools/phantom_strict.py /tmp/rows.json /tmp/raw-game.json
```
Expected:
- `LADDER_COVERAGE fails=0` (exit 0).
- health.py: every `1X2 … dev` within ±15%.
- `LADDER_PEER_CHECK PASS`. A game without team ladders prints no market lines and `PASS []`. Today's equivalent would be FOULS_TOTAL −9.4% and TOTAL_SHOTS_ON_TARGET −11.0%.
- phantom_strict: no `PLAYER ABSENT in same raw market` key.
- health.py's `UNKNOWN/OTHER rows` is not a criterion, because the grouper never returns OTHER.

- [ ] **Step 4: Record and close.** Write the A1-A4 numbers into the evidence file. Commit it only if the owner wants the evidence in git: `git add docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betcris/acceptance-*.json && git commit -m "docs(betcris): recovery acceptance results"`.

---

## Self-Review

1. **Spec coverage.**
   - Robust capture: the listener runs before navigation (Task 1 ordering test); retry and backoff on site-level failures only (Task 1 retry and target_game_missing tests, Task 2 bounded-listing and game-level-miss tests); adaptive timeouts (Task 1 12x test); the live client redirect (Task 1 redirect test); the real reason is logged on failure and the timings on success (Task 1 format tests, Task 2 log/error strings); Node-side lag is measured (`eventLoopDelayMaxMs`).
   - The regression test uses recorded frames (Task 1, two recordings).
   - Data quality: the renamed stats family, 25 ids including PlayerHeadedShotsonTarget (Tasks 3-4). The PL golden snapshot freezes real param keys, after the archive learns `paramValue` (Task 5). The next rename becomes visible through the unmapped summary (Task 6). Phantom players: verified absent, re-checked in A4. Collision rows: open question 2.
   - Acceptance: Task 7. A1 has an absolute OTHER check, A2 counts only full-contention runs, and A3 is relative to the chosen game's raw ladders.
   - The aggregator-level `result.error` logging and `scraper_runs` persistence are cross-cutting and left to the observability plan. Ordering with it is stated in Global Constraints and Task 2.
2. **Step scan.** Every code step names the file, the signature and the pinned values. The only body given is the capture state machine, because the signature does not determine it. The fake-page semantics are listed once in Task 1, Step 1. Every commit step runs the whole suite with an expected count: 1182 → 1196 → 1202 → 1210 → 1216 → 1218 → 1220.
3. **Type consistency.** These names match everywhere they appear across Tasks 1-4: `captureSwarm`, `formatCaptureFailure`, `formatCaptureSuccess`, `isSiteLevelCaptureFailure`, `SwarmCaptureOutcome.attempts[].{navMs,navError,wsOpenMs,framesReceived,sportFrames,firstUsefulFrameMs,failure,pageTitle,finalUrl,eventLoopDelayMaxMs}`, `WS_CONFIG.{WS_OPEN_TIMEOUT,FIRST_USEFUL_FRAME_TIMEOUT,MAX_ATTEMPTS,RETRY_BACKOFF,MAX_CONSECUTIVE_MATCH_FAILURES}` (`MAX_WAIT_TIME` is deleted only in Task 2, together with its last reader), `TEAM_TIER_LADDER_TYPES` / `PLAYER_TIER_LADDER_TYPES` / `PLAYER_TIER_LIST_TYPES` (14 + 10 + 1 = 25), `parseTierLabel`, `PLAYER_TIER_LADDER_CODES` (10 codes), `loadFixture` / `loadRecording`.
4. **Review Focus.** All 6 items have tests in their owning tasks: reconnect, late goto rejection and the redirect (T1), residual events (T3), out-of-catalog tier (T4), down site (T2).
5. **Proportion.** Code blocks are tests and signatures. Implementation bodies are left to the implementer, except for the capture algorithm.
