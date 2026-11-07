# STS Scraper Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore STS's Premier League offer, except the group r=12 `(z dogrywką)` player props and fouls, which wait for the owner's decision (Open question 1). That means no more 1-market matches, player markets back in the catalog (anytime scorer, shots, cards, assists, goal-or-assist, first booking), team cards/corners lines ingested, and no wasted navigations to non-PL fixtures.

**Architecture:** Three layers change. (1) `sts/navigation.ts` records WebSocket frames through a pure, unit-tested reducer that keeps only fixture *snapshots* and waits for that snapshot. `sts/index.ts` retries once and skips a match rather than emitting a partial one. This part ships first. (2) `sts-normalizer.ts` learns STS's renumbered market ids and aligns team cards/corners vocabularies with peers. It lands *before* the parser changes, because the new mappings stay inert until the parser emits those ids, so no intermediate commit writes wrongly shaped rows. (3) `sts/parser.ts` keeps every O/U line, reads the extra team-stats market group, folds STS's new per-player lines back into the dropdown shape the normalizer already knows, and names nameless "yes" outcomes. An offline replay test over the committed snapshots is the calendar-independent acceptance gate.

**Tech Stack:** TypeScript (ESM, Node 20), Playwright, Vitest, tsx.

**Spec:** the Observations section of this file. Evidence: `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/` contains captured WebSocket frames, log excerpts for runs 1-3, API measurements, the smoke script and its current output, `api-sanity.py`, `sts-run-check.py` and `make-golden-archive.mts`. That directory is **untracked** (`git status`: `?? docs/superpowers/`), so always reference it by this absolute path.

## Observations (pre-fix analysis)

### Status today: DEGRADED

Measured 2026-11-06 on the running service, plus standalone captures and a dry-run smoke (no DB). Run 1 = 15:45Z startup, run 2 = 16:00Z scheduled, run 3 = 17:00Z scheduled. The table uses run-2 data from 16:17Z.

| Metric | Aug 20 baseline (Arsenal vs Coventry City) | Nov 6 Arsenal vs Hull City | Nov 6 Everton vs Coventry City | Nov 6 Leeds vs Tottenham |
|---|---|---|---|---|
| Raw markets from scraper | 832 | 467 | 434 (**1** in run 3) | **1** (runs 2-3) / 453 (run 1) |
| Catalog codes served by API | 148 | 132 | 134 | **1** |
| (market, param) entries in API | 1309 | 621 | 566 | **1** |
| Selections in API | 3190 | 1338 | 1266 | 3 |
| Raw markets routed to OTHER (hidden by API) | 1 | 117 (25%) | 102 (24%) | n/a |

- 1-market matches per run (`evidence/sts/backend-log-excerpt.txt`, cleaned-log line numbers):
  - Run 1: 0/20.
  - Run 2: 2/20, `Leeds vs Tottenham` and `Nottingham vs Manchester City` (run 1 had 453 and 432).
  - Run 3: **5/20**, which is 5 of the 10 full-offer matches: `Manchester United vs Aston Villa` (67589), `Leeds vs Tottenham` (68130), `Fulham vs Newcastle` (71169), `Everton vs Coventry City` (94537) and `Brighton vs Brentford` (94689).
  - Every capture, good or bad, logs `initial: ~3.26 MB`, so the `i_pl` frame was always present when the wait ended. The result depends on whether the fixture snapshot had already landed, without a delta overwriting it, by then. The race is load-driven and now hits about 50% of full-offer matches.
- The repository prunes the previous good snapshot each time. Run 2 logged `Pruned 453 stale row(s) for sts/premier-league:leeds united:tottenham hotspur` and `Pruned 432 ... nottingham forest:manchester city`. In run 3 (lines 100836-100844), the 434/435/434/467-row snapshots of Man Utd-Villa, Fulham-Newcastle, Everton-Coventry and Brighton-Brentford were replaced by 1 row each.
- At 17:25Z the API serves only `MATCH_WINNER` for STS on all five (verified with `GET /api/matches/<H>/<A>/normalized-markets`: `sts codes 1 entries 1`).
- The 1-row state heals on the first successful write for that match, because `pruneStaleOddsRows` deletes every older row for the pair. This was seen live: run 3 logged `Pruned 1 stale row(s) for sts/premier-league:nottingham forest:manchester city` (100841) after Forest-City captured 432 markets again. Task 1 is ship-first.
- 842 `[sts] Unknown market` lines in run 2, all from 4 ids: 2003 `<Player> - strzały` (278), 2008 `<Player> - celne strzały` (278), 2146 `<Player> - asysty` (278), 2291 `Zawodnik - otrzyma 1. kartkę` (8).
- `Found 36 fixtures for premier-league`, then 16 navigations end in `Skipping ... Teams not in premier-league whitelist` (10) or `Youth team match` (6).
- Dry-run smoke on current code (`evidence/sts/smoke-current-sts.txt`, unloaded, 16:40Z): 20 matches, min 153 / median 332 normalized markets, OTHER share 17.8%, UNKNOWN-selection share 15.1%, `GOALSCORER_ANYTIME`, `PLAYER_SHOTS`, `PLAYER_CARDS`, `CARDS_TEAM`, `CORNERS_TEAM` present in **0/20** matches. The 1-market race did not trigger in this unloaded run.

Catalog codes STS covered in August and serves in neither current full-offer match (entries in Aug): `GOALSCORER_ANYTIME` (49), `PLAYER_CARDS` (48), `PLAYER_RED_CARD` (48), `PLAYER_FOULS` (47), `PLAYER_GOAL_OR_ASSIST` (44), `PLAYER_SHOTS` (43), `PLAYER_SHOTS_ON_TARGET` (43), `PLAYER_ASSISTS` (43), `PLAYER_FOULS_WON` (43), all seven `PLAYER_*_LINEUP` codes (17-34 each), `HOME/AWAY_CORNERS_RANGE` and `GOAL_RANGE` (1). New since August: `CORNERS_TEAM_RANGE`, `MULTI_GOAL_RANGE`, `TOTAL_GOALS_ASIAN` (audit-display renames). Full diff: `evidence/sts/api-measurements-vs-august.txt`.
- Two of the "lost" codes are not losses. `HOME/AWAY_CORNERS_RANGE` are now pooled as `CORNERS_TEAM_RANGE` by design. `GOAL_RANGE` is the same raw market `Liczba goli - przedziały` with the same selections (`1-2`, `1-3`, ...), now served as `MULTI_GOAL_RANGE`; compare the August baseline with today's Arsenal vs Hull City API.
- Known gaps this plan does not close: `PLAYER_FOULS`, `PLAYER_FOULS_WON` and the seven `PLAYER_*_LINEUP` codes. They only exist in group r=12 now (Open question 1).

### Root causes

**RC1 - partial capture races the fixture snapshot (0/20, 2/20 and 5/20 matches in runs 1-3; 5 of 10 full-offer matches in run 3).**
- `src/scrapers/bookmakers/sts/navigation.ts:116-125` stores *any* `f_<id>_pl` frame longer than 1000 bytes, so a small delta frame overwrites the full snapshot. Snapshot frames carry `"f":1` in their header line (`{"s":"f_f2921896_pl","n":1793982199183325,"f":1}`); deltas do not (`{"s":"f_f2921896_pl","n":1793982479552366}`).
- `navigation.ts:233-238` stops waiting as soon as `initialData.length > 100000`, i.e. when the 3.2 MB `i_pl` frame lands, even if the fixture snapshot has not arrived. Poll interval is 500 ms (`constants.ts:398`).
- Live frame order, Leeds vs Tottenham (`evidence/sts/frame-order-leeds-tottenham.json`): `i_pl` 3,290,817 B at 3391 ms, snapshot 206,563 B at 3883 ms, deltas 4,516 B / 4,441 B at 3889 / 3894 ms. Both the early exit and the delta overwrite produce exactly the logged symptom. Reproduced offline from the durable frames: `parseAllMarkets` with snapshot+i_pl = **452** markets, delta+i_pl = **1**, no fixture frame+i_pl = **1**.
- Amplifier (cross-cutting, see observability plan): `src/repositories/full-offer-repository.ts:267-284` (`pruneStaleOddsRows`) deletes the previous complete snapshot whenever a newer write lands, even a 1-market one.

**RC2 - STS replaced the "Zawodnik - X" dropdowns with per-player lines whose single outcome has no name.** Ids 2012 (`<P> - otrzyma kartkę`), 2153 (`<P> - otrzyma czerwoną kartkę`), 2435 (`\t <P> - strzeli gola`, note the leading tab), 2436 (`<P> - gol lub asysta`): every line has one outcome `{"74": {"O": <odds>}}` without `n`. `getSelectionName` (`src/scrapers/bookmakers/sts/parser.ts:487-492`) returns `null` for outcome 74 (not in the outcome map), `parseLineSelections` drops it, the line has 0 selections and the market disappears silently (no warning). In the Arsenal vs Hull snapshot outcome id 74 without a name occurs only in these four ids.

**RC3 - renumbered / new player ids unknown to the normalizer.** `src/services/normalization/bookmakers/sts-normalizer.ts:25` (`STS_MARKET_ID_TO_CODE`) maps 2394/2395/2397 (lines 91-94) but STS now sends 2003/2008/2146 with the identical `<Lastname Firstname> - <stat>` shape and N+ ladders; they hit `sts-normalizer.ts:1537` and become OTHER. This is the second renumbering: the comment at `sts-normalizer.ts:272-273` documents that 2004/2005/2011 were replaced by 2398/2399/2401. 2291 (`Zawodnik - otrzyma 1. kartkę`, a 41-player dropdown) has a catalog code (`FIRST_PLAYER_CARDED`, PLAYER_DROPDOWN) but no mapping.

| Aug id | Aug shape | Nov id | Nov shape | Today |
|---|---|---|---|---|
| 54 `Zawodnik - strzeli gola` | dropdown, player-name outcomes | 2435 | per-player line, nameless outcome 74 | dropped in parser |
| 1894 `Zawodnik - otrzyma kartkę` | dropdown | 2012 | per-player line, outcome 74 | dropped in parser |
| 1896 `Zawodnik - otrzyma czerwoną kartkę` | dropdown | 2153 | per-player line, outcome 74 | dropped in parser (normalizer already maps 2153) |
| 1903 `Zawodnik - gol lub asysta` | dropdown | 2436 | per-player line, outcome 74 | dropped in parser |
| 2394 / 2395 / 2397 | `<P> - strzały / celne strzały / asysty` | 2003 / 2008 / 2146 | same | OTHER (Unknown) |
| 2398 / 2399 (fouls) | per-player ladder | none in main group | `(z dogrywką)` variants 2407/2408 in group r=12 | not read |
| 1845-1855 `(musi wyjść w "11", z dogrywką)` | per-player ladders | 2406-2417 `(z dogrywką)` | group r=12 | not read |
| - | - | 2291 `Zawodnik - otrzyma 1. kartkę` | dropdown, 41 players | OTHER (Unknown) |

**RC4 - the parser reads one of three market groups.** `parser.ts:290` reads only `P["1m<stsId>"]`. The fixture snapshot now has three `P` entries, each with `f: <fixtureId>` and a group type `r`:

| P key | r | markets | contents |
|---|---|---|---|
| `1m72221372` | 1 | 145 | main offer (read today) |
| `17mce764d13e2f04334843db305388877c7` | 17 | 9 | 188/191 team cards O/U, 231/234 team corners O/U, 1287 each team corners N+, 2287 each team cards N+, 1413 penalty, 1899 red card and penalty, 2131 red card or penalty |
| `12m4r89qpxwvwa8fk2nohapha3o4` | 12 | 11 | 2406-2417 player props `(z dogrywką)` (assists, fouls won/committed, tackles, shots, shots on/off target, blocked shots, cards, goals, saves) |

Prices: r=17 stat lines match peers (Arsenal corners O6.5 STS 1.6 vs betclic 1.64 / fortuna 1.63 / superbet 1.7; Arsenal cards O1.5 3.4 vs 2.6-3.6). r=17 penalty-type markets do not (1413 "Rzut karny" Tak 4.0 vs peers 3.0-3.1; 1899 15 vs 10-10.3; 2131 3.1 vs 1.9). r=12 ladders differ from the plain markets for the same player (Madueke shots 3+: 1.55 in 2003 vs 1.21 in 2414).

**RC5 - tournament filter is a substring match.** `parser.ts:83` (`countryName.includes("angli")`) also accepts category 249 "Anglia Amatorzy"; `parser.ts:88` (`includes("premier league")`) accepts "Northern Premier League - Premier Division" (10 fixtures) and "Premier League 2" (6 U21 fixtures). `parseFixtures(i_pl, "premier-league")` returns 36 instead of 20; each extra fixture costs a page navigation. PL is tournament key `17` in category `1` ("Anglia"); `LEAGUE_CONFIG["premier-league"].tournamentId` is also 17 (`constants.ts:39`). Tournament keys alone are not unique: `ligue-1` (`constants.ts:57`) and `world-cup-2026` (`constants.ts:69`) are both 16, in different categories. A strict filter must therefore check the category key as well. `i_pl` lists 21 entries under `C["1"].T["17"].FX`, and 20 of them have home/away names (the 21st has no `H`).

**Pre-existing since <= August: O/U lines collapse.** `constants.ts:222-245` (`OVER_UNDER_LINE_MARKET_IDS`) lacks 185 "Liczba kartek" (5 lines), 228 "Liczba rzutów rożnych" (5), 206 / 247 first-half cards / corners (3 each for Arsenal vs Hull City; Leeds vs Tottenham has 4 first-half cards lines), so the name-based dedup in `parseAllMarkets` keeps one line: the API shows STS `CARDS_TOTAL` only at 1.5 today (Aug: only 5.5) and `CORNERS_TOTAL` only at 10.5, while peers quote 6-20 lines. 188/191/231/234 (RC4) share the problem.

### What still works and must not break

- 1X2: 20/20 matches merged under the same matchId as the other bookmakers; mean deviation from the peer median 2.5%, max 7.0% (Hull vs Brighton draw 4.0 vs 4.3); no home/away flips. O/U 2.5 within 3.3%, BTTS within 2.6%.
- Dropdown markets 52/53 (first/last scorer), 1892, 2168, 2318, 2356-2358 and per-player 1051, 2396, 2400, 2401, 2404 normalize correctly today.
- Old ids must keep normalizing, because STS flips ids back and forth. 54, 1896, 1903, 2394-2399 and the 1845-1855 entries in `STS_MARKET_ID_TO_CODE` resolve by id. 1894 is **not** in the map: it resolves by name (`/otrzyma\s+kartkę/i`, `sts-normalizer.ts:355`, `matchedBy: "name"`).
- The WC golden only partly guards them. #58 (54) and #231 (1894) are blessed. #232 (1896) and #233 (1903) are `blessed: false` with stale `OTHER`/`null` expectations, so they are never asserted, and 2394/2395/2397 are absent. Task 3 adds explicit old-id regression rows.
- Tests green today: `npx vitest run src/scrapers/bookmakers/sts` (3 tests), and golden `-t sts` prints `[golden] sts/world-cup-2026_france_morocco: entries=270 blessed=166 unblessed=104 failures=0` (re-run 18:30Z). `npx tsc --noEmit` exits 0.

### Impact

- Navigation: Task 1. Listing filter: Task 2. Normalizer: Task 3. Parser: Tasks 4-6. Replay gate and golden: Task 7. Catalog: none (`FIRST_PLAYER_CARDED`, `EACH_TEAM_TOTAL_*_OVER`, `CARDS_TEAM`, `CORNERS_TEAM` exist), so no `sync-market-types.ts` run.
- Golden: the WC fixture contains none of 2003/2008/2146/2012/2153/2435/2436/2291/188/191/231/234/1287/2287 (verified), so its 166 blessed entries must stay byte-identical. Task 7 adds a new pair `premier-league_arsenal_hull_city`, generated by `scripts/harvest-fixtures.ts` from the real post-fix parse of the Arsenal vs Hull City snapshot.
- Team vocabularies after the fix:
  - `CARDS_TEAM` joins the peer majority, `CARDS_TEAM:<line>` with `HOME_*`/`AWAY_*` (betclic, betcris, forbet, fuksiarz, lvbet, superbet). betfan and fortuna use `HOME:<line>` params; that split already exists among peers and is out of scope.
  - `CORNERS_TEAM` joins every peer: `HOME:<line>`/`AWAY:<line>` with `OVER`/`UNDER`.
  - Both were checked on today's Arsenal vs Hull City API.
- Prior audit knowledge: the August audits documented the 2394-2404 / *_LINEUP split; that split's conditional half no longer exists in the main group.

### Risks and unknowns

- The race depends on load: 0/20 (run 1), 2/20 (run 2), 5/20 (run 3, 17:00Z), and 0/20 in the unloaded smoke. Verification needs several scheduled runs, not one.
- The live checkout is the one `tsx watch` serves, and the hourly scrape writes to the DB the frontend reads. Implementing in place would restart the service on every save and could write intermediate data shapes. Global Constraints therefore require a separate worktree.
- The live criteria depend on the calendar. STS published the full offer (raw >= 400, full main group r=1) only for matches up to ~2 days ahead. The extra groups come later: r=17 (team stats, the only source of `CARDS_TEAM`, `CORNERS_TEAM` and `EACH_TEAM_TOTAL_*_OVER`) is listed only about one day before kickoff. In the listing `a` lists it was present 20-25 h before kickoff (the Nov 6 16:28Z listing in `i_pl.trimmed.txt`: f2921896-900) and absent 37-48 h before. Fixture snapshots captured 2026-11-07T00:43Z showed nine full-offer matches (main group 145-147 markets, 575-636 lines), and only the four kicking off on Nov 7 (f2921896/97/98/900, 12:30-17:30Z) carried r=17. Brighton vs Brentford had r=12 only; Man Utd-Villa, Sunderland-Chelsea, Palace-Liverpool and Ipswich-Bournemouth had r=1 only. A full offer therefore does not imply r=17, and Acceptance B judges the team-stats codes against F17, not F. The Nov 21-23 round has 151-156 raw markets and only group r=1. See `evidence/sts/far-future-f2921905.txt`: Newcastle vs Arsenal has 153 markets and a single `P` entry `r=1`. Its frame is in `f_f2921905_pl.newcastle-arsenal.far-future.snapshot.txt`. All 10 current full-offer matches kick off by 2026-11-08T16:30Z. Between ~Nov 9 and ~Nov 19 a live smoke cannot show the new markets, so the offline replay test (Task 7) is the gate and the live checks are relative.
- STS renumbers again: keep both old and new ids in every map.
- STS sends some player names in Firstname-Lastname order: `Jack Butland` in 2291, 2012, 2153 and 2401. `stsCanonicalizePlayerName` (`sts-normalizer.ts:479-486`) swaps every two-token name, so these become `Butland Jack` and do not merge with peers' `Jack Butland`. This is visible today: the API serves STS `PLAYER_SAVES` under param `Butland Jack`. It is a pre-existing problem, kept out of scope (Open question 5). Task 3 pins today's behaviour.
- Two players with the same display name in one folded dropdown stay two selections in the parser (Task 6). The normalizer then emits two identical codes, and downstream they land on the same per-player parameter (`splitBundledPlayerSelections`, `market-type-grouper.ts:363`), where one shadows the other. STS sends nothing that tells them apart, so this is out of scope.
- Group r=12 semantics ("z dogrywką" without "musi wyjść w 11") and the r=17 penalty price gaps are unexplained; this plan does not ingest them.
- Cookie text `COOKIE_BUTTON_TEXT = "Akceptuj wszystkie"` (`constants.ts:403`) no longer matches the banner ("Zgoda"); WebSocket data flows anyway, so left alone.

### Open questions for the owner

1. Group r=12 `(z dogrywką)` player props (11 markets, ~340 lines per match): ingest into the STS-exclusive `PLAYER_*_LINEUP` codes, new codes, or skip? Default in this plan: skip.
2. r=17 1413 / 1899 / 2131 are priced 30-60% longer than peers: map them (`PENALTY_AWARDED`, `RED_CARD_AND_PENALTY`, `PENALTY_OR_RED_CARD`) or keep them out? Default: keep out (filtered in the parser).
3. Should the repository refuse to prune a previous snapshot when the new write for the same match/bookmaker has <10% of its rows? This is cross-cutting (observability plan); Task 1 only stops STS from producing such writes.
4. Strict category + tournament filtering is enabled for `premier-league` only (verified category 1, tournament 17). Enable it for other leagues after verifying their pairs (tournament ids: ekstraklasa 46, laliga 8, serie-a 23, ligue-1 16; world-cup reuses 16 under category 3)?
5. Firstname-Lastname names such as `Jack Butland` are flipped to `Butland Jack`. Fix them with per-name entries in `STS_PLAYER_NAME_OVERRIDES`, with a general rule (e.g. check order against the fixture's other bookmakers), or leave them? Default: leave (pre-existing; separate plan).

### Acceptance criteria

**A. Offline gate (calendar-independent; the merge gate).** Task 7's `src/scrapers/bookmakers/sts/__tests__/replay-2026-11.test.ts` runs `parseAllMarkets` + `normalizeMarketsForBookmaker` over the committed snapshots and asserts:
- Arsenal vs Hull City: normalized (non-OTHER) >= 520. The offline estimate is 537; today it is 350.
- Leeds vs Tottenham: normalized >= 510. Estimate 524; today 341.
- OTHER <= 2 per match. Only ids 197/198 `<1./2.> drużyna - czerwona kartka` remain, mapped to OTHER on purpose at `sts-normalizer.ts:206-207`. Today OTHER is 117 / 111.
- All 12 required codes are present (today all 12 are missing): `GOALSCORER_ANYTIME`, `PLAYER_SHOTS`, `PLAYER_SHOTS_ON_TARGET`, `PLAYER_ASSISTS`, `PLAYER_CARDS`, `PLAYER_GOAL_OR_ASSIST`, `FIRST_PLAYER_CARDED`, `PLAYER_RED_CARD`, `CARDS_TEAM`, `CORNERS_TEAM`, `EACH_TEAM_TOTAL_CORNERS_OVER`, `EACH_TEAM_TOTAL_CARDS_OVER`.
- The exact cards/corners total line sets per case (`CARDS_TOTAL`, `CORNERS_TOTAL`, `HALF_TIME_CARDS_TOTAL`, `HALF_TIME_CORNERS_TOTAL`; Task 7 Step 1 lists them), each entry `+L` = OVER and `-L` = UNDER, and no two non-OTHER entries share a (marketKey, selection code). The count bars alone cannot catch a re-collapse: losing the 12 Arsenal / 13 Leeds extra lines leaves ~525 >= 520. `parse-all-markets-2026-11.test.ts` (Task 4) pins every line's prices as well.
- Plus: `npx tsc --noEmit` exits 0, `npx vitest run` is green, and golden `-t sts` prints `failures=0` for both STS fixtures.

**B. Live smoke (single bookmaker, no DB writes).** Run it from the **worktree root** (`$WT`, see Global Constraints), using the smoke copy inside the worktree, because the script resolves `REPO` six directories above its own location. Run it only when no scheduled scrape is in flight, i.e. the last `[Scheduler] Starting scheduled scrape` line in the cleaned log is already followed by `[Scheduler] premier-league completed`:

```bash
cd "$WT" && node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/smoke-full-offer.mts sts premier-league GOALSCORER_ANYTIME,PLAYER_SHOTS,PLAYER_SHOTS_ON_TARGET,PLAYER_ASSISTS,PLAYER_CARDS,PLAYER_GOAL_OR_ASSIST,FIRST_PLAYER_CARDED,CARDS_TEAM,CORNERS_TEAM,EACH_TEAM_TOTAL_CORNERS_OVER,EACH_TEAM_TOTAL_CARDS_OVER > "$EVID/smoke-after-fix-sts.log" 2>&1; echo "exit=$?"; grep -E 'Found [0-9]+ fixtures|^SMOKE_RESULT' "$EVID/smoke-after-fix-sts.log"
```

This command shape was proven on the current code from the live checkout: exit 0, ~130 s, no DB writes, output in `evidence/sts/smoke-current-sts.txt`. It prints one `SMOKE_RESULT {json}` line. Let N = the `Found N fixtures` value and F = the number of `perMatch` entries with `raw >= 400` (also printed as `fullOfferMatches`). Let F17 = `teamStatsFullOfferMatches`: the full-offer matches whose fixture lists the r=17 team-stats group (an `a` key starting with `17m`; `perMatch[].teamStats`). For STS the smoke copy in this worktree reads those `a` lists from one extra read-only listing capture before the scrape, independent of the parser, so a parser that stops reading r=17 cannot shrink F17. `teamStatsCodeMatchCounts[c]` counts the F17 matches that carry code `c`, and `perMatch[].codes` lists each match's required codes. Pass when:

1. `success: true`, a `Found N fixtures` line with `1 <= N <= 20` (today 36), and `N - matches <= 1`. The only allowed gap is one `No fixture snapshot ... skipping`; the smoke swallows `console.warn`, so the gap is computed. The exact "only tournament 17 in category 1" rule is asserted offline (Task 2). This criterion, run at the final head, is also the live check that STS still keys the Premier League as `B.S.1.C["1"].T["17"]`: after a renumbering the strict listing is empty, `sts/index.ts` returns `success: false` with `error: "No fixtures found for league"` *before* its `Found` log, and the smoke exits 1 with no `Found` line. The offline frame cannot prove the live keys, and neither can a master-code log (it still filters by name).
2. If F >= 1: every `perMatch` entry with `raw >= 400` has `normalized >= 480` (today 332-350) and `other <= 3` (today 99-117), and `otherMarketShare <= 0.01` (today 0.1776). If F == 0, the calendar has no full offer listed (see Risks): criteria 2, 3 and 5 are not checkable live. Record that and re-run once a listed round is within ~2 days of kick-off.
3. Code presence, in two parts:
   - Main-group codes (`GOALSCORER_ANYTIME`, `PLAYER_SHOTS`, `PLAYER_SHOTS_ON_TARGET`, `PLAYER_ASSISTS`, `PLAYER_CARDS`, `PLAYER_GOAL_OR_ASSIST`, `FIRST_PLAYER_CARDED`): if F >= 1, `requiredCodeMatchCounts[c] >= F` (today F = 10 and every count is 0).
   - Team-stats codes (`CARDS_TEAM`, `CORNERS_TEAM`, `EACH_TEAM_TOTAL_CORNERS_OVER`, `EACH_TEAM_TOTAL_CARDS_OVER`), which STS serves only from the r=17 group: if F17 >= 1, `teamStatsCodeMatchCounts[c] == F17`. A full-offer match without r=17 is expected to lack them (Risks), so judging them against F would false-fail: the Task 1 smoke had F = 9, and the 00:43Z snapshots showed only 4 matches with r=17. If F17 == 0, or null with `teamStatsError` set, the team-stats codes are not checkable live: record that, as with F == 0. Before calling a missing code on an F17 match a regression, check that match's r=17 group actually contains the id (188/191 cards, 231/234 corners, 1287 and 2287 each-team).
   - The F17 capture was added in Task 5 fix round 1 and verified offline only: the `a`-list loop gives f2921896-900 on `i_pl.trimmed.txt`, the same as a python read of the frame. Task 8 Step 1 is its first live run.

**C. Service log, after the live checkout is switched (Task 8).** `$LOG` is an ANSI-stripped copy of the dev server's output log: `sed 's/\x1b\[[0-9;]*m//g' <service log> > "$LOG"`. Today the service writes to `/tmp/claude-1000/-home-skamik-Documents-repositories-personal-aityper/3627e2c8-f787-4f71-8a6a-348993c930fc/scratchpad/backend.log`, a session scratch path; use wherever the service runs then. Record `S=$(wc -l < "$LOG")` just before the switch, re-clean after each run (line numbers stay stable because the log is append-only), and check:

```bash
python3 -I /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py "$LOG" "$S"
```

4. Prints `RUN_CHECK {... "pass": true ...}` and exits 0 once >= 3 STS runs have completed after `S`. Per run, the script requires:
   - no match under 100 raw markets;
   - at most 1 `No fixture snapshot ... skipping`;
   - zero `Skipping ... whitelist` / `Youth team match` lines;
   - `Found N <= 20` and `Completed == N - noSnapshot`;
   - no match that had raw >= 400 in the previous run dropping below 400.

   It also fails closed on STS runs that never reach a `Found` line, which would otherwise be invisible to it (an empty strict listing returns before that log): every `[Aggregator/FullOffer] sts completed: success=...` line (a result with no saved matches), every `[Aggregator/FullOffer] sts failed:` line and every `[STS] Strict id filter for premier-league ... matched 0 fixtures` warning after `S` is a problem. The warning lists the name-filter candidates (`C<cat>/T<tournament> "<category>" / "<tournament>" (<n> fixtures)`), so a renumbering names its new keys, while an empty calendar shows only the aggregator line. The aggregator lines carry no league; the script attributes them to `premier-league`, the only enabled league (`src/config/index.ts` `ENABLED_LEAGUES`). Run the copy committed on the branch (`docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py` in `$WT`, or in `$REPO` after the merge): an older untracked copy lacks these checks.

   The command shape was proven on today's log with `S=0`: exit 1, listing exactly the run-2/run-3 1-market matches, 16 non-PL skips per run and `found: 36`. A bare `grep` on the log would also match the 7 pre-fix lines, because the log is appended across restarts.

**D. API odds sanity (after a post-switch scheduled run, any match with STS raw >= 400 in that run whose fixture lists the r=17 team-stats group).** Pick it from the smoke (`perMatch[].teamStats: true`) or from a `17m` key in the listing's `a` list; on a full-offer match without r=17 the two team checks below fail on a correct offer (Risks). If no listed match carries r=17, run it on any raw >= 400 match, record `cards_team_shape_ok`/`corners_team_shape_ok` as not checkable, and judge the other checks by their own `_ok` flags (the overall `pass` is then false by construction).

```bash
python3 -I /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/api-sanity.py "<Home>" "<Away>" sts
```

5. Prints `SANITY_RESULT {... "pass": true ...}` and exits 0. The checks:
   - STS 1X2 max deviation from the peer median <= 10%;
   - STS `GOALSCORER_ANYTIME` for its 3 shortest-priced players within 35% of the peer median;
   - STS `CARDS_TOTAL` offers >= 4 lines;
   - every STS `CORNERS_TEAM` row has a `HOME:x`/`AWAY:x` param with `OVER`/`UNDER`.
   - every STS `CARDS_TEAM` row has a `<line>` param (or `HOME:`/`AWAY:<line>`, whose side must match the selection) with a selection in `HOME_OVER`/`HOME_UNDER`/`AWAY_OVER`/`AWAY_UNDER` (`cards_team_shape_ok`, added in Task 5 fix round 1; checked against the live API: superbet `0.5 HOME_OVER` ... and betfan `HOME:0.5 HOME_OVER` ... both pass).

   `<Home>`/`<Away>` are the canonical names printed in the smoke's `perMatch[].match` (e.g. `"Arsenal" "Hull City"`). The command shape was proven today:
   - `"Arsenal" "Hull City" sts`: exit 1, `match_winner_max_dev 0.0625`, `goalscorer_top3 []`, `cards_total_lines ["1.5"]`, `corners_team_shape_ok false`.
   - `... superbet`: `goalscorer_ok`, `cards_total_ok` and `corners_team_shape_ok` all true.

## Global Constraints

- Code and comments in English; commit messages concise; NO signature/attribution footers (no "Generated with", no "Co-Authored-By") - the owner's rule overrides any tool reminder.
- Commit only after the owner has approved executing this plan.
- **Isolation: implement in a separate git worktree that the dev server does not watch** (superpowers:using-git-worktrees). The live checkout `$REPO` (on `master`) is the one `tsx watch` serves. Every save under `src/` there restarts it, and the hourly scrape writes to the DB the frontend reads. Setup:

  ```bash
  REPO=/home/skamik/Documents/repositories/personal/aityper-scraper-api
  WT=/home/skamik/Documents/repositories/personal/aityper-scraper-api-sts-recovery
  EVID=$REPO/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts
  git -C "$REPO" worktree add -b fix/sts-recovery-2026-11 "$WT" master
  ln -s "$REPO/node_modules" "$WT/node_modules"
  cp "$REPO/.env" "$WT/.env"   # gitignored (.gitignore:9); same config for the smoke
  mkdir -p "$WT/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts"
  cp "$EVID"/*.mts "$EVID"/*.txt "$WT/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/"
  ```

  - `docs/superpowers/` is untracked, so a worktree from `master` does not contain it. The copy above makes the smoke and `make-golden-archive.mts` resolve `REPO` to the worktree. It stays untracked: never `git add docs/` or `git add -A`.
  - Every `npx tsc` / `npx vitest` / `npx tsx scripts/...` / `git add` / `git commit` below runs with cwd = `$WT`.
  - `$REPO` changes only in Task 1 Step 6 (ship-first) and Task 8 Step 2 (final switch), each by `git -C "$REPO" merge --ff-only fix/sts-recovery-2026-11` after the owner approves. Each merge restarts the live service once.
- Before every commit (in `$WT`): `npx tsc --noEmit` (exit 0) and `npx vitest run` (all green).
- Golden-fixture discipline:
  - Write the failing fixture/test first.
  - Rebless only after inspecting the diff: `npx tsx scripts/rebless-golden.ts --bookmaker sts --dry` (prints changed rawNames on stderr and `{"changedTotal":N,"dry":true}` on stdout), then without `--dry`. The WC fixture must show zero changed entries.
  - New pairs come only from `scripts/harvest-fixtures.ts`, never hand-written (Task 7). Its defaults still assume the old monorepo layout (`scripts/harvest-fixtures.ts:193`, `:224-225` resolve to `<parent>/backend/src/...` and `<parent>/docs/audit-ledger/registry.json`). Always pass `--out-dir src/services/normalization/__fixtures__ --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json`.
- Run `npx tsx scripts/sync-market-types.ts` only if `src/data/market-catalog.ts` changes (this plan does not change it).
- Never edit `src/` in `$REPO` directly: it restarts the running dev server (`tsx watch`), which other analyses use.
- Live bookmaker traffic stays modest: one smoke run per verification step, never in a loop, and never while a scheduled scrape is in flight (Acceptance B).

## Review Focus

1. A match whose snapshot never arrives (STS slow, both attempts time out or fail to navigate) must keep its previous DB rows: the scraper emits no `FullMatchOffer` for it. Tests: `captureMatchWithRetry returns null after 2 attempts without a snapshot` and `captureMatchWithRetry treats a null attempt as a miss and retries` (Task 1).
2. A newer snapshot for the same fixture may replace an older snapshot, but a delta never replaces a snapshot. Test: `recordStsFrame keeps the snapshot when a delta follows` (Task 1).
3. Parser-level only: two players with the same display name inside one folded dropdown (e.g. two "Silva" entries) must stay two selections - fold by line, not by name. Test: `fold keeps one selection per line even when names repeat` (Task 6). Downstream they still collide on one per-player parameter (Risks); that is out of scope.
4. Old ids arriving again must normalize exactly as today: 54, 1894 (`matchedBy: "name"`), 1896, 1903, 2394, 2395, 2397. Test: the old-id rows of `sts-normalizer-2026-11.test.ts` (Task 3). The WC golden only asserts 54 and 1894; 1896/1903 are unblessed there.
5. Team side for 188/191/231/234 must come from "1. drużyna" / "2. drużyna" in the name, not from odds order. Test rows 188/191/231/234 in `sts-normalizer-2026-11.test.ts` (Task 3).
6. The strict listing filter needs both keys, category `1` and tournament `17`, because tournament keys repeat across categories. Test: `premier-league rejects tournament 17 under a non-1 category` (Task 2).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/scrapers/bookmakers/sts/navigation.ts` | Modify | Pure frame reducer, snapshot wait, retry helper |
| `src/scrapers/bookmakers/sts/index.ts` | Modify | Use retry helper; skip match without snapshot |
| `src/scrapers/bookmakers/sts/constants.ts` | Modify | Inline `LEAGUE_CONFIG` type (`:22-29`) gains `strictTournamentId?`/`categoryId?`; O/U line ids, extra group types, per-player fold table |
| `src/scrapers/bookmakers/sts/types.ts` | Modify | `f`/`r` on `P` entries only (Task 5). `LeagueConfig` (`types.ts:171`) is unused and stays untouched |
| `src/scrapers/bookmakers/sts/parser.ts` | Modify | Strict category+tournament filter, extra groups, fold, outcome 74 |
| `src/services/normalization/bookmakers/sts-normalizer.ts` | Modify | New ids, FIRST_PLAYER_CARDED, team cards/corners vocab, each-team N+ params |
| `src/scrapers/bookmakers/sts/__tests__/capture.test.ts` | Create | Task 1 tests |
| `src/scrapers/bookmakers/sts/__tests__/parse-fixtures-tournament.test.ts` | Create | Task 2 tests |
| `src/services/normalization/__tests__/sts-normalizer-2026-11.test.ts` | Create | Task 3 tests (new-id + old-id rows) |
| `src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts` | Create | Tasks 4-6 tests |
| `src/scrapers/bookmakers/sts/__tests__/replay-2026-11.test.ts` | Create | Task 7 offline acceptance gate |
| `src/scrapers/bookmakers/sts/__tests__/fixtures/` | Create | Copies of the four frame files from `$EVID` |
| `src/services/normalization/__fixtures__/sts/premier-league_arsenal_hull_city{.json,.expected.json}` | Create | New golden pair, generated by `scripts/harvest-fixtures.ts` (Task 7) |

---

### Task 1: Capture keeps the fixture snapshot and never emits a partial match

**Files:**
- Modify: `src/scrapers/bookmakers/sts/navigation.ts:101-128` (frame recording), `:199-253` (match capture wait)
- Modify: `src/scrapers/bookmakers/sts/index.ts:309-325` (capture call in `scrapeFullOffer`)
- Create: `src/scrapers/bookmakers/sts/__tests__/fixtures/`. In `$WT`, copy `i_pl.trimmed.txt`, `f_f2921896_pl.leeds-tottenham.snapshot.txt`, `f_f2921896_pl.leeds-tottenham.delta.txt` and `f_f2921898_pl.arsenal-hull.snapshot.txt` from the absolute path `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/` (`$EVID`, untracked, so not in the worktree's git tree): `mkdir -p src/scrapers/bookmakers/sts/__tests__/fixtures && cp "$EVID"/{i_pl.trimmed.txt,f_f2921896_pl.leeds-tottenham.snapshot.txt,f_f2921896_pl.leeds-tottenham.delta.txt,f_f2921898_pl.arsenal-hull.snapshot.txt} src/scrapers/bookmakers/sts/__tests__/fixtures/`.
- Test: `src/scrapers/bookmakers/sts/__tests__/capture.test.ts`

**Interfaces:**
- Produces (navigation.ts):
  - `export function isSnapshotFrame(payload: string): boolean` - true when the first line parses as a header with `f === 1`.
  - `export function recordStsFrame(result: WSCaptureResult, payload: string): void` - `i_pl`: keep the longest (current rule); `f_<id>_pl`: store only snapshots; never overwrite a stored snapshot with a delta.
  - `export function hasFixtureSnapshot(result: WSCaptureResult, fixtureId: string): boolean`
  - `export async function captureMatchWithRetry(capture: (eventUrl: string) => Promise<WSCaptureResult | null>, eventUrl: string, fixtureId: string, attempts = 2): Promise<WSCaptureResult | null>` - returns the first result with a snapshot, else `null`. An attempt that returns `null` (navigation error, `navigation.ts:249-251`) counts as a miss and is retried like an empty result.
- Consumes: `parseWebSocketJson`, `parseFixtures`, `parseAllMarkets` (parser.ts, unchanged signatures).

- [ ] **Step 1: Copy the fixtures and write the failing tests**

```ts
const fx = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const SNAP = "f_f2921896_pl.leeds-tottenham.snapshot.txt", DELTA = "f_f2921896_pl.leeds-tottenham.delta.txt";
const empty = (): WSCaptureResult => ({ initialData: "", fixtureData: new Map() });

it("isSnapshotFrame: true for the f:1 snapshot header, false for a delta", () => {
  expect(isSnapshotFrame(fx(SNAP))).toBe(true);
  expect(isSnapshotFrame(fx(DELTA))).toBe(false);
  expect(isSnapshotFrame(fx("i_pl.trimmed.txt"))).toBe(true);
});
it("recordStsFrame keeps the snapshot when a delta follows (live Leeds vs Tottenham order)", () => {
  const r = empty();
  for (const f of ["i_pl.trimmed.txt", SNAP, DELTA]) recordStsFrame(r, fx(f));
  const ipl = parseWebSocketJson(r.initialData)!;
  const fixture = parseFixtures(ipl, "premier-league").find((f) => f.id === "f2921896")!;
  expect(parseAllMarkets(fixture, r.fixtureData.get("f2921896")!, ipl).length).toBeGreaterThan(400); // 452 today; 1 with the delta
});
it("hasFixtureSnapshot is false after i_pl only and after a delta only", () => {
  const r = empty(); recordStsFrame(r, fx("i_pl.trimmed.txt"));
  expect(hasFixtureSnapshot(r, "f2921896")).toBe(false);
  recordStsFrame(r, fx(DELTA)); expect(hasFixtureSnapshot(r, "f2921896")).toBe(false);
  recordStsFrame(r, fx(SNAP)); expect(hasFixtureSnapshot(r, "f2921896")).toBe(true);
});
it("captureMatchWithRetry retries once and returns the attempt that has the snapshot", async () => {
  const withSnap = empty(); recordStsFrame(withSnap, fx(SNAP));
  const results = [empty(), withSnap]; let calls = 0;
  const out = await captureMatchWithRetry(async () => results[calls++], "u", "f2921896");
  expect(out).toBe(withSnap); expect(calls).toBe(2);
});
it("captureMatchWithRetry returns null after 2 attempts without a snapshot", async () => {
  let calls = 0;
  expect(await captureMatchWithRetry(async () => { calls++; return empty(); }, "u", "f2921896")).toBeNull();
  expect(calls).toBe(2);
});
it("captureMatchWithRetry treats a null attempt as a miss and retries", async () => {
  const withSnap = empty(); recordStsFrame(withSnap, fx(SNAP));
  const results = [null, withSnap]; let calls = 0;
  const out = await captureMatchWithRetry(async () => results[calls++], "u", "f2921896");
  expect(out).toBe(withSnap); expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/scrapers/bookmakers/sts/__tests__/capture.test.ts`
Expected: FAIL - `isSnapshotFrame` / `recordStsFrame` / `hasFixtureSnapshot` / `captureMatchWithRetry` are not exported (TypeError: ... is not a function).

- [ ] **Step 3: Implement in `navigation.ts`, wire into `index.ts`**

`setupWebSocketCapture` calls `recordStsFrame(result, payload)` for every frame. `navigateAndCaptureMatchData` waits with `waitForData(() => hasFixtureSnapshot(result, fixtureId), WS_DATA_TIMEOUT)` (12000 ms; the `i_pl > 100000` exit is removed) and returns `result` whether or not the snapshot arrived (`null` only on navigation error). In `index.ts` replace the direct call with `captureMatchWithRetry((u) => navigateAndCaptureMatchData(page, u), fixture.eventUrl, fixture.id)`; on `null`, `console.warn` `[STS/FullOffer] No fixture snapshot for ${home} vs ${away} after 2 attempts - skipping (previous snapshot kept)` (the exact prefix `sts-run-check.py` counts) and `continue` without pushing a match.

The second caller, `scrapeMatchDetails` (`index.ts:154`), changes only its wait: it now waits up to 12 s for the snapshot instead of leaving when `i_pl` lands. It still returns the result without a snapshot, and parsing keeps working. `findAndParseMatchData` (`index.ts:191-197`) reads `initialJson || fixtureJson`, and both snapshots carry `B.S.1.C.1.T.17.FX.<fixtureId>` (verified on the Arsenal vs Hull City and Leeds vs Tottenham frames). No change is needed there.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/scrapers/bookmakers/sts`
Expected: PASS (existing `parser-self-fixture.test.ts` included).

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/sts/navigation.ts src/scrapers/bookmakers/sts/index.ts src/scrapers/bookmakers/sts/__tests__/capture.test.ts src/scrapers/bookmakers/sts/__tests__/fixtures
git commit -m "fix(sts): wait for the fixture snapshot, ignore deltas, skip matches without one"
```

- [ ] **Step 6: Ship first (owner approval required)**

Task 1 changes no data shape, and every hourly run without it can wipe good snapshots. Ship it alone:
1. Run Acceptance B's smoke in `$WT`. Expect exit 0 and no `perMatch` entry with `raw < 100`. N stays 36, and 16 non-PL fixtures are still skipped, until Task 2.
2. Record `S=$(wc -l < "$LOG")`.
3. Run `git -C "$REPO" merge --ff-only fix/sts-recovery-2026-11`. The service restarts and its startup scrape runs.
4. After the next completed STS run, `sts-run-check.py "$LOG" "$S"` should show no `under100` and no `fullOfferDrops` problems for that run. `found`, `nonPlSkips` and `completed` problems (36 found, 16 non-PL skips) remain expected until Task 2 ships.

### Task 2: Strict category + tournament filter for the Premier League listing

**Files:**
- Modify: `src/scrapers/bookmakers/sts/constants.ts:22-29`. The inline `LEAGUE_CONFIG` value type gains `strictTournamentId?: boolean; categoryId?: number`. Set `strictTournamentId: true, categoryId: 1` for `premier-league` only (`:37-42`). `types.ts` is not touched: its `LeagueConfig` (`types.ts:171`) is dead code.
- Modify: `src/scrapers/bookmakers/sts/parser.ts:80-90`. Iterate `[catKey, cat]` and `[tournKey, tourn]`. When strict, require `catKey === String(config.categoryId) && tournKey === String(config.tournamentId)`. The existing country/name filters and the U21/cup/lower-league exclusions stay as a second guard.
- Test: `src/scrapers/bookmakers/sts/__tests__/parse-fixtures-tournament.test.ts`

**Interfaces:**
- Consumes: `parseFixtures(data: STSWebSocketData, league: string): STSFixture[]` (unchanged signature), fixture `i_pl.trimmed.txt` from Task 1. Its `C["249"]` ("Anglia Amatorzy") holds tournaments 1000/1009/... and no `T["17"]`.

- [ ] **Step 1: Write the failing tests**

```ts
const ipl = () => parseWebSocketJson(fx("i_pl.trimmed.txt"))!;
it("premier-league keeps only tournament 17 in category 1 (drops Northern Premier League and Premier League 2)", () => {
  const fixtures = parseFixtures(ipl(), "premier-league");
  expect(fixtures).toHaveLength(20);                       // 36 today
  expect(new Set(fixtures.map((f) => f.tournament))).toEqual(new Set(["Premier League"]));
  expect(new Set(fixtures.map((f) => f.country))).toEqual(new Set(["Anglia"]));
  expect(fixtures.map((f) => f.id)).toEqual(expect.arrayContaining(["f2921896", "f2921898"]));
});
it("premier-league rejects tournament 17 under a non-1 category", () => {
  const data = ipl();
  const C = data.B!.S!["1"].C!;
  C["249"].T!["17"] = C["1"].T!["17"];
  delete C["1"].T!["17"];
  expect(parseFixtures(data, "premier-league")).toHaveLength(0);  // 36 today (substring filter), 20 with a tournament-only check
});
it("only premier-league opts into strict category + tournament ids", () => {
  expect(LEAGUE_CONFIG["premier-league"]).toMatchObject({ strictTournamentId: true, categoryId: 1, tournamentId: 17 });
  expect(LEAGUE_CONFIG.ekstraklasa.strictTournamentId).toBeUndefined();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/scrapers/bookmakers/sts/__tests__/parse-fixtures-tournament.test.ts`
Expected: FAIL (3 tests): `expected length 20, received 36`, then `expected length 0, received 36`, then the `toMatchObject` diff (`strictTournamentId`/`categoryId` missing).

- [ ] **Step 3: Implement** the config fields and the two-key check.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/scrapers/bookmakers/sts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/sts/constants.ts src/scrapers/bookmakers/sts/parser.ts src/scrapers/bookmakers/sts/__tests__/parse-fixtures-tournament.test.ts
git commit -m "fix(sts): match the Premier League by category and tournament id, not by name substring"
```

### Task 3: Normalizer maps the renumbered ids and aligns team cards/corners

Lands before the parser tasks. Live, these mappings stay inert until Tasks 5-6 emit the ids (2003/2008/2146/2291 are emitted today and are simply fixed). The rows below are handcrafted in the shape Tasks 4-6 will produce, so this task does not depend on them.

**Files:**
- Modify: `src/services/normalization/bookmakers/sts-normalizer.ts`:
  - `:25-288` (`STS_MARKET_ID_TO_CODE`);
  - `:641-681` (`CARDS_TEAM` / `CORNERS_TEAM` selections);
  - `:876-890` (dropdown case list);
  - `:1201-1208` (each-team params);
  - `CORNERS_TEAM` paramValue.
- Test: `src/services/normalization/__tests__/sts-normalizer-2026-11.test.ts`

**Interfaces:**
- Consumes: raw markets in the shape Tasks 4-6 produce: folded dropdown names and suffixed O/U names.
- Produces:
  - `STS_MARKET_ID_TO_CODE` additions: `2003: "PLAYER_SHOTS"`, `2008: "PLAYER_SHOTS_ON_TARGET"`, `2146: "PLAYER_ASSISTS"`, `2012: "PLAYER_CARDS"`, `2435: "GOALSCORER_ANYTIME"`, `2436: "PLAYER_GOAL_OR_ASSIST"`, `2291: "FIRST_PLAYER_CARDED"`, `1287: "EACH_TEAM_TOTAL_CORNERS_OVER"`, `2287: "EACH_TEAM_TOTAL_CARDS_OVER"`.
  - `FIRST_PLAYER_CARDED` joins the dropdown case list (`stsPlayerNameSelection`).
  - `CARDS_TEAM` selections become `HOME_*`/`AWAY_*` from "1./2. drużyna". The key stays `CARDS_TEAM:<line>`, the peer-majority convention (betfan/fortuna's `HOME:<line>` params are a pre-existing peer split, out of scope). HOME and AWAY raw markets at the same line merge into one row via `mergeMarketRecord` (`full-offer-repository.ts:197-248`), because their selection codes differ.
  - `CORNERS_TEAM` selections become plain `OVER`/`UNDER` with `paramValue = "<HOME|AWAY>:<line>"`, like every peer.
  - 1287/2287 take `paramValue = String(N - 0.5)` from `/(\d+)\s+lub\s+więcej/` in the name and map `"Tak"` to `OVER`.

- [ ] **Step 1: Write the failing table test**
  - Setup: ctx `{ homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" }`, `stsNormalizer.normalizeMarket(raw, ctx)`.
  - One `it.each` row per line. Each row asserts `marketCode`, `marketKey` and the ordered selection `code@odds`.
  - Every row expects `debug.matchedBy === "id"` except 1894 (`"name"`).
  - All values come from the Arsenal vs Hull City snapshot `f2921898`.

New / changed ids:

| id | raw name | raw selections | marketCode | marketKey | selection codes@odds |
|---|---|---|---|---|---|
| 2003 | `Crooks Matt - strzały` | 1+ 1.55, 2+ 4.25, 3+ 15, 4+ 35 | PLAYER_SHOTS | `PLAYER_SHOTS:Matt Crooks` | 1+@1.55 2+@4.25 3+@15 4+@35 |
| 2008 | `Crooks Matt - celne strzały` | 1+ 4.25, 2+ 20, 3+ 60 | PLAYER_SHOTS_ON_TARGET | `PLAYER_SHOTS_ON_TARGET:Matt Crooks` | 1+@4.25 2+@20 3+@60 |
| 2146 | `Crooks Matt - asysty` | 1+ 17.5 | PLAYER_ASSISTS | `PLAYER_ASSISTS:Matt Crooks` | 1+@17.5 |
| 2435 | `Zawodnik - strzeli gola` | Crooks Matt 10, Madueke Noni 3 | GOALSCORER_ANYTIME | `GOALSCORER_ANYTIME` | Matt Crooks@10 Noni Madueke@3 |
| 2012 | `Zawodnik - otrzyma kartkę` | Crooks Matt 2.5 | PLAYER_CARDS | `PLAYER_CARDS` | Matt Crooks@2.5 |
| 2436 | `Zawodnik - gol lub asysta` | Crooks Matt 6.5 | PLAYER_GOAL_OR_ASSIST | `PLAYER_GOAL_OR_ASSIST` | Matt Crooks@6.5 |
| 2291 | `Zawodnik - otrzyma 1. kartkę` | Egan John 12.5, White Ben 35, Jack Butland 30 | FIRST_PLAYER_CARDED | `FIRST_PLAYER_CARDED` | John Egan@12.5 Ben White@35 Butland Jack@30 (`Butland Jack` is the known Firstname-Lastname mismatch, pinned on purpose; Risks / Open question 5) |
| 2153 | `Crooks Matt - otrzyma czerwoną kartkę\|Crooks Matt` | Tak 20 | PLAYER_RED_CARD | `PLAYER_RED_CARD:Matt Crooks` | YES@20 (already passes; regression guard) |
| 188 | `1. drużyna - liczba kartek 1.5` | +1.5 3.4, -1.5 1.28 | CARDS_TEAM | `CARDS_TEAM:1.5` | HOME_OVER@3.4 HOME_UNDER@1.28 |
| 191 | `2. drużyna - liczba kartek 2.5` | +2.5 2.55, -2.5 1.45 | CARDS_TEAM | `CARDS_TEAM:2.5` | AWAY_OVER@2.55 AWAY_UNDER@1.45 |
| 231 | `1. drużyna - liczba rzutów rożnych 8.5` | +8.5 2.7, -8.5 1.4 | CORNERS_TEAM | `CORNERS_TEAM:HOME:8.5` | OVER@2.7 UNDER@1.4 |
| 234 | `2. drużyna - liczba rzutów rożnych 2.5` | +2.5 1.75, -2.5 1.9 | CORNERS_TEAM | `CORNERS_TEAM:AWAY:2.5` | OVER@1.75 UNDER@1.9 |
| 1287 | `Rzuty rożne - każda drużyna -  4 lub więcej` | Tak 2.9 | EACH_TEAM_TOTAL_CORNERS_OVER | `EACH_TEAM_TOTAL_CORNERS_OVER:3.5` | OVER@2.9 |
| 2287 | `Kartki - każda drużyna - 2 lub więcej` | Tak 5 | EACH_TEAM_TOTAL_CARDS_OVER | `EACH_TEAM_TOTAL_CARDS_OVER:1.5` | OVER@5 |
| 185 | `Liczba kartek 2.5` | +2.5 1.6, -2.5 2.2 | CARDS_TOTAL | `CARDS_TOTAL:2.5` | OVER@1.6 UNDER@2.2 (already passes) |

Old-id regression rows (same Crooks Matt values; all pass today, verified on the current normalizer):

| id | raw name | raw selections | marketCode | marketKey | selection codes@odds |
|---|---|---|---|---|---|
| 54 | `Zawodnik - strzeli gola` | Crooks Matt 10, Madueke Noni 3 | GOALSCORER_ANYTIME | `GOALSCORER_ANYTIME` | Matt Crooks@10 Noni Madueke@3 (identical to 2435) |
| 1894 | `Zawodnik - otrzyma kartkę` | Crooks Matt 2.5 | PLAYER_CARDS | `PLAYER_CARDS` | Matt Crooks@2.5, `matchedBy: "name"` (identical to 2012 except matchedBy) |
| 1896 | `Zawodnik - otrzyma czerwoną kartkę` | Crooks Matt 20 | PLAYER_RED_CARD | `PLAYER_RED_CARD` | Matt Crooks@20 (dropdown shape; differs from 2153's per-player key `PLAYER_RED_CARD:Matt Crooks` today, pinned as is) |
| 1903 | `Zawodnik - gol lub asysta` | Crooks Matt 6.5 | PLAYER_GOAL_OR_ASSIST | `PLAYER_GOAL_OR_ASSIST` | Matt Crooks@6.5 (identical to 2436) |
| 2394 | `Crooks Matt - strzały` | 1+ 1.55, 2+ 4.25, 3+ 15, 4+ 35 | PLAYER_SHOTS | `PLAYER_SHOTS:Matt Crooks` | identical to 2003 |
| 2395 | `Crooks Matt - celne strzały` | 1+ 4.25, 2+ 20, 3+ 60 | PLAYER_SHOTS_ON_TARGET | `PLAYER_SHOTS_ON_TARGET:Matt Crooks` | identical to 2008 |
| 2397 | `Crooks Matt - asysty` | 1+ 17.5 | PLAYER_ASSISTS | `PLAYER_ASSISTS:Matt Crooks` | identical to 2146 |

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/services/normalization/__tests__/sts-normalizer-2026-11.test.ts`

Expected: FAIL, measured on today's normalizer:
- 2003/2008/2146/2435/2436/2291/1287/2287 return `null`.
- 2012 fails only on matchedBy (expected `"id"`, received `"name"`): its code, key and selections already match through `/otrzyma\s+kartkę/i`.
- 188/191 give `OVER`/`UNDER`.
- 231/234 give keys `CORNERS_TEAM:8.5` / `CORNERS_TEAM:2.5` with `HOME_OVER`/`AWAY_OVER`.
- Rows 2153, 185 and all old-id rows pass.

- [ ] **Step 3: Implement** the map entries and the four selection/param changes listed under Interfaces. Do not touch `HALF_TIME_CORNERS_TEAM` or the 2097/2098 `"+N"` path.

- [ ] **Step 4: Run tests and the golden dry-run**

Run: `npx vitest run src/services/normalization && npx tsx scripts/rebless-golden.ts --bookmaker sts --dry`

Expected:
- PASS.
- Golden prints `[golden] sts/world-cup-2026_france_morocco: entries=270 blessed=166 unblessed=104 failures=0`.
- The dry rebless prints nothing on stderr and `{"changedTotal":0,"dry":true}` on stdout.

- [ ] **Step 5: Commit**

```bash
git add src/services/normalization/bookmakers/sts-normalizer.ts src/services/normalization/__tests__/sts-normalizer-2026-11.test.ts
git commit -m "fix(sts): map renumbered player ids, first booking, team cards/corners vocab"
```

### Task 4: Keep every cards/corners O/U line

**Files:**
- Modify: `src/scrapers/bookmakers/sts/constants.ts:222-245` (constants only)
- Test: `src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts` (created here, extended in Tasks 5-6)

**Interfaces:**
- Produces: `OVER_UNDER_LINE_MARKET_IDS` also contains `185, 206, 228, 247`, and `188, 191, 231, 234`. The second group only takes effect once Task 5 reads group r=17.
- Shared test setup for Tasks 4-6:
  - `fixture = parseFixtures(parseWebSocketJson(fx("i_pl.trimmed.txt"))!, "premier-league").find((f) => f.id === "f2921898")!` (stsId 72221372);
  - `markets = parseAllMarkets(fixture, parseWebSocketJson(fx("f_f2921898_pl.arsenal-hull.snapshot.txt")), null)`;
  - `byId = (id) => markets.filter((m) => m.bookmakerMarketId === id)`.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps every cards/corners total line", () => {
  expect(byId("185")).toHaveLength(5);
  expect(byId("185").map((m) => m.name)).toContain("Liczba kartek 2.5");
  expect(byId("228")).toHaveLength(5);
  expect(byId("206")).toHaveLength(3);
  expect(byId("247")).toHaveLength(3);
});
```

Review fix round 1 adds a normalized block to the same file: for both snapshots (production call shape: fixture frame + `i_pl`, canonical team names) it pins the exact `CARDS_TOTAL` / `CORNERS_TOTAL` / `HALF_TIME_CARDS_TOTAL` / `HALF_TIME_CORNERS_TOTAL` line sets, every line's `+L` = OVER / `-L` = UNDER prices (checked against the raw frames), and that no two non-OTHER entries share a (marketKey, selection code). Tasks 5-6 keep it green.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts`
Expected: FAIL - `byId("185")` has length 1 (today 185/228/206/247 each collapse to one market named `Liczba kartek` / `Liczba rzutów rożnych` / `1. połowa - ...`).

- [ ] **Step 3: Implement** the set additions (with a comment per id).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/scrapers/bookmakers/sts && npx vitest run src/services/normalization/__tests__/golden.test.ts -t sts`
Expected: PASS; WC golden still `failures=0` (the golden runs the normalizer on frozen raw input, so parser changes cannot move it).

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/sts/constants.ts src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts
git commit -m "fix(sts): keep every cards and corners over/under line"
```

### Task 5: Read the r=17 team-stats group

**Files:**
- Modify: `src/scrapers/bookmakers/sts/types.ts:148-155` (`P` entry gains `f?: string; r?: number`)
- Modify: `src/scrapers/bookmakers/sts/constants.ts` (two new sets; reword the comment above 188/191/231/234 in `OVER_UNDER_LINE_MARKET_IDS`)
- Modify: `src/scrapers/bookmakers/sts/parser.ts:286-293` (`parseAllMarkets` source collection)
- Test: `src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts`

**Interfaces:**
- Produces (constants.ts):
  - `export const STS_EXTRA_GROUP_TYPES = new Set<number>([17])`. Extra `P` entries are read when `entry.f === fixture.id && STS_EXTRA_GROUP_TYPES.has(entry.r)`.
  - `export const STS_EXTRA_GROUP_EXCLUDED_MARKET_IDS = new Set<number>([1413, 1899, 2131])` (Open question 2).
- Consumes: the r=17 lines' outcomes `12`/`13` carry `n` (`+1.5`/`-1.5`), and 1287/2287 use outcome `26`, which `outcome-map.ts:43` already names `"Tak"`.

- [ ] **Step 1: Write the failing tests**

```ts
it("reads the r=17 team-stats group, one market per line", () => {
  expect(byId("231").map((m) => m.name).sort()).toEqual([
    "1. drużyna - liczba rzutów rożnych 6.5", "1. drużyna - liczba rzutów rożnych 7.5", "1. drużyna - liczba rzutów rożnych 8.5"]);
  expect(byId("188")).toHaveLength(2);
  expect(byId("191")).toHaveLength(3);
  expect(byId("234")).toHaveLength(3);
  expect(byId("1287")).toHaveLength(3);
  expect(byId("1287").find((m) => m.name.includes("4 lub więcej"))!.selections).toEqual([expect.objectContaining({ name: "Tak", odds: 2.9 })]);
  expect(byId("2287")).toHaveLength(2);
});
it("skips the r=17 penalty-type markets (open question 2)", () => {
  for (const id of ["1413", "1899", "2131"]) expect(byId(id)).toHaveLength(0);
});
it("does not read the r=12 '(z dogrywką)' group", () => {
  expect(byId("2414")).toHaveLength(0);
});
it("normalizes the r=17 team cards/corners lines, side from the market name", () => {
  // normalizeMarketsForBookmaker is already imported in this file (Task 4 fix round 1)
  const n = normalizeMarketsForBookmaker(markets, "sts", "Arsenal", "Hull City", "premier-league");
  expect(n.filter((m) => m.normalizedType === "CARDS_TEAM" || m.normalizedType === "CORNERS_TEAM")
    .map((m) => `${m.bookmakerMarketId} ${m.marketKey} ${m.selections.map((s) => `${s.name}=${s.normalizedName}@${s.odds}`).join(" ")}`)
    .sort()).toEqual([
    "188 CARDS_TEAM:0.5 +0.5=HOME_OVER@1.5 -0.5=HOME_UNDER@2.35",
    "188 CARDS_TEAM:1.5 +1.5=HOME_OVER@3.4 -1.5=HOME_UNDER@1.28",
    "191 CARDS_TEAM:0.5 +0.5=AWAY_OVER@1.1 -0.5=AWAY_UNDER@6.2",
    "191 CARDS_TEAM:1.5 +1.5=AWAY_OVER@1.55 -1.5=AWAY_UNDER@2.35",
    "191 CARDS_TEAM:2.5 +2.5=AWAY_OVER@2.55 -2.5=AWAY_UNDER@1.45",
    "231 CORNERS_TEAM:HOME:6.5 +6.5=OVER@1.6 -6.5=UNDER@2.2",
    "231 CORNERS_TEAM:HOME:7.5 +7.5=OVER@2 -7.5=UNDER@1.7",
    "231 CORNERS_TEAM:HOME:8.5 +8.5=OVER@2.7 -8.5=UNDER@1.4",
    "234 CORNERS_TEAM:AWAY:1.5 +1.5=OVER@1.27 -1.5=UNDER@3.5",
    "234 CORNERS_TEAM:AWAY:2.5 +2.5=OVER@1.75 -2.5=UNDER@1.9",
    "234 CORNERS_TEAM:AWAY:3.5 +3.5=OVER@2.7 -3.5=UNDER@1.42",
  ]);
});
```

The last test pins the normalized output, so a side flip or a missing `HOME:`/`AWAY:` param fails here and not only in the live sanity check. The values were checked in Task 4 fix round 1 against the raw r=17 frame (outcome `n`/`O` read straight from the JSON) and against a simulation of this task's source collection run through the Task 3 normalizer. CARDS_TEAM:1.5 has both sides (188 HOME_*, 191 AWAY_*), CARDS_TEAM:0.5 has both sides, CARDS_TEAM:2.5 is AWAY only (188 has 2 lines, 191 has 3). The Task 5 reviewer confirms these values against the committed test. Task 4's `never publishes two prices for one (marketKey, selection)` test must stay green with the r=17 entries added (simulated: 0 duplicates).

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts`
Expected: FAIL - `byId("231")` / `188` / `191` / `234` / `1287` / `2287` have length 0, and the normalized team-lines test gets `[]`. The 1413/1899/2131 and 2414 guards already pass.

- [ ] **Step 3: Implement**: `parseAllMarkets` collects `1m${stsId}` plus the fixture's extra-group entries from each source and skips excluded ids. The extra entries inherit the existing per-line handling, so with Task 4's ids the O/U names get line suffixes. In the same commit, reword the comment above 188/191/231/234 in `OVER_UNDER_LINE_MARKET_IDS` (`constants.ts`, currently "Team cards/corners totals from the r=17 team-stats group (inert until parseAllMarkets reads that group)") to "Team cards/corners totals from the r=17 team-stats group, read via STS_EXTRA_GROUP_TYPES". This task makes the "inert" wording stale.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/scrapers/bookmakers/sts`
Expected: PASS (Task 1's `> 400` assertion still holds).

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/sts/types.ts src/scrapers/bookmakers/sts/constants.ts src/scrapers/bookmakers/sts/parser.ts src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts
git commit -m "fix(sts): read the team-stats market group"
```

### Task 6: Fold per-player lines and name outcome 74

**Files:**
- Modify: `src/scrapers/bookmakers/sts/constants.ts` (two new tables)
- Modify: `src/scrapers/bookmakers/sts/parser.ts`:
  - `:302` (trim line names);
  - `:415-493` (`getSelectionName`);
  - `:350-358` (the fold runs before the name-based dedup).
- Test: `src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts`

**Interfaces:**
- Produces (constants.ts):
  - `export const STS_PER_PLAYER_YES_MARKET_IDS = new Set<number>([2012, 2153, 2435, 2436])`. Their nameless outcome 74 becomes `"Tak"`.
  - `export const STS_PER_PLAYER_DROPDOWN_FOLDS: Record<number, { suffix: string; dropdownName: string }>` = `{ 2012: { suffix: " - otrzyma kartkę", dropdownName: "Zawodnik - otrzyma kartkę" }, 2435: { suffix: " - strzeli gola", dropdownName: "Zawodnik - strzeli gola" }, 2436: { suffix: " - gol lub asysta", dropdownName: "Zawodnik - gol lub asysta" } }`.
  - All lines of a folded id become ONE market `{ name: dropdownName, bookmakerMarketId: String(id), selections: [{ name: <trimmed line name minus suffix>, odds }] }`, with one selection per line. Fold by line, not by name.
- Consumes: `parseAllMarkets(fixture, fixtureJson, initialJson): ScrapedMarket[]` (signature unchanged).

- [ ] **Step 1: Write the failing tests**

```ts
it("folds id 2435 into one 'Zawodnik - strzeli gola' dropdown with 38 players", () => {
  expect(byId("2435")).toHaveLength(1);
  expect(byId("2435")[0].name).toBe("Zawodnik - strzeli gola");
  expect(byId("2435")[0].selections).toHaveLength(38);
  expect(byId("2435")[0].selections).toContainEqual(expect.objectContaining({ name: "Crooks Matt", odds: 10 }));
});
it("folds 2012 and 2436 the same way", () => {
  expect(byId("2012")[0]).toMatchObject({ name: "Zawodnik - otrzyma kartkę" });
  expect(byId("2012")[0].selections).toHaveLength(41);
  expect(byId("2012")[0].selections).toContainEqual(expect.objectContaining({ name: "Crooks Matt", odds: 2.5 }));
  expect(byId("2012")[0].selections).toContainEqual(expect.objectContaining({ name: "Jack Butland" }));
  expect(byId("2436")[0].selections).toContainEqual(expect.objectContaining({ name: "Crooks Matt", odds: 6.5 }));
});
it("keeps 2153 per player with a 'Tak' selection", () => {
  // 2153 is in PLAYER_STAT_MARKET_IDS, so the parser names it "<line>|<player>"
  expect(byId("2153")).toHaveLength(41);
  expect(byId("2153").find((m) => m.name === "Crooks Matt - otrzyma czerwoną kartkę|Crooks Matt")!.selections)
    .toEqual([expect.objectContaining({ name: "Tak", odds: 20 })]);
});
it("fold keeps one selection per line even when names repeat", () => {
  const snap = parseWebSocketJson(fx("f_f2921898_pl.arsenal-hull.snapshot.txt"))!;
  const lines = Object.values(snap.P!["1m72221372"].m!["2435"].l!);
  lines[0].n = "\t Silva Joao - strzeli gola"; lines[1].n = "\t Silva Joao - strzeli gola";
  const folded = parseAllMarkets(fixture, snap, null).find((m) => m.bookmakerMarketId === "2435")!;
  expect(folded.selections.filter((s) => s.name === "Silva Joao")).toHaveLength(2);
  expect(folded.selections).toHaveLength(38);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts`
Expected: FAIL - `byId("2435")`, `byId("2012")`, `byId("2436")` and `byId("2153")` have length 0 (lines dropped for 0 selections).

- [ ] **Step 3: Implement** in this order inside `parseAllMarkets`:
  1. trim `line.n` before use (2435 lines start with `"\t "`);
  2. in `getSelectionName`, return `"Tak"` for outcome 74 without `n` when the market id is in `STS_PER_PLAYER_YES_MARKET_IDS`;
  3. build the folded dropdowns after per-line parsing and before the name-based dedup.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/scrapers/bookmakers/sts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/sts/constants.ts src/scrapers/bookmakers/sts/parser.ts src/scrapers/bookmakers/sts/__tests__/parse-all-markets-2026-11.test.ts
git commit -m "fix(sts): fold per-player scorer/card lines back into dropdowns"
```

### Task 7: Offline replay gate and golden pair from the real snapshot

**Files:**
- Create: `src/scrapers/bookmakers/sts/__tests__/replay-2026-11.test.ts`
- Create (generated, never hand-edited): `src/services/normalization/__fixtures__/sts/premier-league_arsenal_hull_city.json` + `.expected.json`

**Interfaces:**
- Consumes:
  - `parseFixtures`, `parseAllMarkets`, `parseWebSocketJson` (parser.ts);
  - `normalizeMarketsForBookmaker(markets, "sts", home, away, league)` (`src/services/normalization/index.ts`; output entries carry `normalizedType`, `bookmakerMarketId`, `selections`);
  - Task 1's fixture copies.
- Tools (absolute path `$EVID`, copied into `$WT` by the Global Constraints setup):
  - `make-golden-archive.mts` writes a `scripts/harvest-fixtures.ts` archive (`{ meta: { matchId: "f2921898", homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" }, markets: [{ index, raw: { bookmakerMarketId, groupId: "", groupName, name, selections } }] }`) from the checkout's own parser.
  - The STS fixture-id `matchId` follows the WC pair (`"f482701"`).

- [ ] **Step 1: Write the replay test** (same `fx` helper as Task 1; imports `parseFixtures`/`parseAllMarkets`/`parseWebSocketJson` from `../parser.js` and `normalizeMarketsForBookmaker` from `../../../../services/normalization/index.js`)

```ts
const REQUIRED = ["GOALSCORER_ANYTIME", "PLAYER_SHOTS", "PLAYER_SHOTS_ON_TARGET", "PLAYER_ASSISTS", "PLAYER_CARDS",
  "PLAYER_GOAL_OR_ASSIST", "FIRST_PLAYER_CARDED", "PLAYER_RED_CARD", "CARDS_TEAM", "CORNERS_TEAM",
  "EACH_TEAM_TOTAL_CORNERS_OVER", "EACH_TEAM_TOTAL_CARDS_OVER"];
// Cards/corners total line sets per snapshot (Task 4). Every line's prices are pinned in parse-all-markets-2026-11.test.ts.
const CASES = [
  { id: "f2921898", file: "f_f2921898_pl.arsenal-hull.snapshot.txt", home: "Arsenal", away: "Hull City", minNormalized: 520,        // est. 537, today 350
    totals: { CARDS_TOTAL: ["0.5", "1.5", "2.5", "3.5", "4.5"], CORNERS_TOTAL: ["8.5", "9.5", "10.5", "11.5", "12.5"],
      HALF_TIME_CARDS_TOTAL: ["0.5", "1.5", "2.5"], HALF_TIME_CORNERS_TOTAL: ["3.5", "4.5", "5.5"] } },
  { id: "f2921896", file: "f_f2921896_pl.leeds-tottenham.snapshot.txt", home: "Leeds United", away: "Tottenham Hotspur", minNormalized: 510, // est. 524, today 341
    totals: { CARDS_TOTAL: ["2.5", "3.5", "4.5", "5.5", "6.5"], CORNERS_TOTAL: ["7.5", "8.5", "9.5", "10.5", "11.5"],
      HALF_TIME_CARDS_TOTAL: ["0.5", "1.5", "2.5", "3.5"], HALF_TIME_CORNERS_TOTAL: ["3.5", "4.5", "5.5"] } },
];
it.each(CASES)("replay $home vs $away: full STS offer normalizes", ({ id, file, home, away, minNormalized, totals }) => {
  const ipl = parseWebSocketJson(fx("i_pl.trimmed.txt"))!;
  const fixture = parseFixtures(ipl, "premier-league").find((f) => f.id === id)!;
  const raw = parseAllMarkets(fixture, parseWebSocketJson(fx(file)), ipl);     // same call shape as index.ts:325
  const n = normalizeMarketsForBookmaker(raw, "sts", home, away, "premier-league");
  const other = n.filter((m) => m.normalizedType === "OTHER");
  expect(n.length - other.length).toBeGreaterThanOrEqual(minNormalized);
  expect(other.length).toBeLessThanOrEqual(2);                                  // only 197/198 (mapped OTHER on purpose); today 117 / 111
  const codes = new Set(n.map((m) => m.normalizedType));
  for (const code of REQUIRED) expect(codes.has(code), code).toBe(true);        // today all 12 missing
  // Every cards/corners total line stays its own entry (Task 4): the count bars above would still pass a re-collapse (~525)
  for (const [code, lines] of Object.entries(totals)) {
    const entries = n.filter((m) => m.normalizedType === code);
    expect(entries.map((m) => m.marketKey).sort(), code).toEqual(lines.map((l) => `${code}:${l}`).sort());
    for (const m of entries) {
      const line = m.marketKey!.slice(code.length + 1);
      expect(m.selections.map((s) => [s.name, s.normalizedName]), m.marketKey).toEqual([[`+${line}`, "OVER"], [`-${line}`, "UNDER"]]);
    }
  }
  if (id === "f2921898") expect(n.find((m) => m.marketKey === "CARDS_TOTAL:2.5")!.selections.map((s) => [s.normalizedName, s.odds]))
    .toEqual([["OVER", 1.6], ["UNDER", 2.2]]);
  // One price per (marketKey, selection code) among non-OTHER entries
  const keys = n.filter((m) => m.normalizedType !== "OTHER").flatMap((m) => m.selections.map((s) => `${m.marketKey}|${s.normalizedName}`));
  const seen = new Set<string>();
  expect(keys.filter((k) => { if (seen.has(k)) return true; seen.add(k); return false; })).toEqual([]);
});
```

The cards/corners and duplicate assertions run after the count bars, so Step 2's first failure messages are unchanged (`expected 350 ...` / `expected 341 ...`).

- [ ] **Step 2: Prove the gate bites, then restore**

Temporarily put back the pre-fix parser and normalizer. `HEAD~4` is Task 2's commit; Tasks 3-6 are one commit each.

```bash
F="src/scrapers/bookmakers/sts/parser.ts src/scrapers/bookmakers/sts/constants.ts src/scrapers/bookmakers/sts/types.ts src/services/normalization/bookmakers/sts-normalizer.ts"
git checkout HEAD~4 -- $F && npx vitest run src/scrapers/bookmakers/sts/__tests__/replay-2026-11.test.ts; git checkout HEAD -- $F && git status --short
```

Expected:
- The vitest run FAILS for both cases: `expected 350 to be greater than or equal to 520` and `expected 341 to be greater than or equal to 510`. These numbers were measured today with the same logic on the current code: raw 467/452, OTHER 117/111.
- After the restore, `git status --short` shows only the untracked `docs/` and the new test.

Then run the replay test again on HEAD. Expected: PASS.

- [ ] **Step 3: Generate the archive from the post-fix parser**

Run: `node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/make-golden-archive.mts "$EVID"`

Expected: one line `{"archive":".../evidence/sts/premier-league_arsenal_hull_city__2026-11-06.json","markets":<M>}`. M is about 539 (Observations estimate); today's code gives 467, which proves the command shape. The archive lands in the durable `$EVID`, next to the snapshot it came from.

- [ ] **Step 4: Harvest the golden pair**

Run: `npx tsx scripts/harvest-fixtures.ts --archive "$EVID/premier-league_arsenal_hull_city__2026-11-06.json" --bookmaker sts --out-dir src/services/normalization/__fixtures__ --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json`

Expected: a JSON summary with:
- `"bookmaker": "sts"`, `"matchIdSafe": "premier-league_arsenal_hull_city"`, `"entries": <M>`, `"openLedgerRefs": 40`;
- the fixture file has `matchId: "f2921898"`, `sourceArchive: "premier-league_arsenal_hull_city__2026-11-06.json"` and ctx `{ homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league", leagueName: "premier-league" }`;
- the expected file has top-level `bookmaker`/`matchIdSafe`.

The run was proven today into a scratch out-dir on the pre-fix parse: entries 467, blessed 290, unblessed 177. Blessing follows the repo's ledger policy (`harvest-fixtures.ts` header, SPEC §6): an entry is unblessed when an open ledger ref names its code. Today that includes `ZAWODNICY/GOALSCORER_ANYTIME` and `ZAWODNICY/PLAYER_CARDS`.

- [ ] **Step 5: Review, then bless the two policy-held dropdowns**

1. Print the expected entries for the ids this plan touches. For each, check `marketCode`/`marketKey` and the Crooks Matt / team-line selections against Task 3's table, and the 185/206/228/247 lines against the Arsenal line table in `parse-all-markets-2026-11.test.ts` (Task 4); the odds are the same snapshot values.
   - ids: 2435, 2012, 2436, 2291, 2153, 2003, 2008, 2146, 188, 191, 231, 234, 1287, 2287, 185, 228, 206, 247.
   - command: `python3 -I -c "import json;e=json.load(open('src/services/normalization/__fixtures__/sts/premier-league_arsenal_hull_city.expected.json'));f=json.load(open('src/services/normalization/__fixtures__/sts/premier-league_arsenal_hull_city.json'));raw={x['index']:x['raw'] for x in f['entries']};ids={'2435','2012','2436','2291','2153','2003','2008','2146','188','191','231','234','1287','2287','185','228','206','247'};[print(raw[x['index']]['bookmakerMarketId'],x['blessed'],x['expected'] and (x['expected']['marketKey'],x['expected']['selections'][:2])) for x in e['entries'] if raw[x['index']]['bookmakerMarketId'] in ids]"`
2. If any of them disagrees with the table, stop. That is a bug to fix (failing test first), not something to bless.
3. Once they all match, refresh and force-bless only the two policy-held dropdowns: re-run Step 4's command with `--bless "Zawodnik - strzeli gola" --bless "Zawodnik - otrzyma kartkę"`. Exact raw-name match hits only the folded 2435 / 2012 markets. Every other entry stays byte-identical.

- [ ] **Step 6: Run the goldens and the dry rebless**

Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t sts && npx tsx scripts/rebless-golden.ts --bookmaker sts --dry`

Expected:
- `[golden] sts/premier-league_arsenal_hull_city: entries=<M> blessed=<B> unblessed=<M-B> failures=0`, where B = Step 4's `blessed` + the entries `--bless` flipped (2 with today's registry).
- `[golden] sts/world-cup-2026_france_morocco: entries=270 blessed=166 unblessed=104 failures=0`.
- The rebless prints nothing on stderr and `{"changedTotal":0,"dry":true}` on stdout.

- [ ] **Step 7: Full suite and commit**

Run: `npx tsc --noEmit && npx vitest run`. Expected: exit 0, all green.

```bash
git add src/scrapers/bookmakers/sts/__tests__/replay-2026-11.test.ts src/services/normalization/__fixtures__/sts/premier-league_arsenal_hull_city.json src/services/normalization/__fixtures__/sts/premier-league_arsenal_hull_city.expected.json
git commit -m "test(sts): offline replay gate and Arsenal vs Hull City golden pair"
```

### Task 8: Live verification and switch

**Files:** none (verification only; `$EVID` receives the smoke log).

- [ ] **Step 1: Dry-run smoke in the worktree** - run Acceptance B at the final head; expect criteria 1-3, or record `F == 0` per criterion 2 and `F17 == 0` per criterion 3. Record F, F17 and the `perMatch[].teamStats` ids. Timing: the four matches that carried r=17 at 00:43Z kick off on 2026-11-07 at 12:30-17:30Z, and whether STS adds r=17 to the Nov 8 matches before then is unverified, so run the smoke before 12:30Z if possible. A later run may see F17 = 0-3. Criterion 1 (`success: true` and a `Found N` line with N >= 1) is the explicit check that the live Premier League is still category 1 / tournament 17; record N. The log is saved as `$EVID/smoke-after-fix-sts.log`.
- [ ] **Step 2: Switch the live checkout (owner approval)**:
  1. Re-clean the log to `$LOG` and record `S=$(wc -l < "$LOG")`.
  2. Run `git -C "$REPO" merge --ff-only fix/sts-recovery-2026-11`. If it refuses because `master` moved, rebase the branch in `$WT` onto `master`, re-run Task 7 Step 7, then merge.
  3. `tsx watch` restarts the service and runs a startup scrape.
- [ ] **Step 3: Three STS runs** - after >= 3 completed STS runs past `S`, run Acceptance C (`sts-run-check.py "$LOG" "$S"`). Expect `"pass": true`, exit 0.
- [ ] **Step 4: API sanity** - pick a match with STS `raw >= 400` in the latest run whose fixture lists the r=17 group (from the smoke's `perMatch[].teamStats`, or a `17m` key in the listing's `a` list; the run's `[STS/FullOffer] <H> vs <A>: N markets` lines give only raw) and run Acceptance D. Expect `"pass": true`, exit 0. The five matches left at 1 row (Observations) must be back to a full offer, unless they have already kicked off.
  - Under EXECUTION.md (owner decision 1 keeps `master` untouched; rule 4 defers live checks that need a persisted scrape), Steps 2-4 cannot run in this recovery, and Step 1 is the only live step. The Task 8 report records Acceptance D as **DEFERRED**, with:
    - command: `python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/api-sanity.py "<Home>" "<Away>" sts`, for a match with STS raw >= 400 whose fixture lists the r=17 group, after the owner's merge and a scheduled run (no such match listed: see the Acceptance D fallback);
    - expected: `SANITY_RESULT {... "pass": true ...}` with `cards_total_ok: true` and 4-5 `cards_total_lines`, `corners_team_shape_ok: true`, and `cards_team_shape_ok: true` with `cards_team_rows` like `0.5 HOME_OVER` ... `2.5 AWAY_UNDER` (Arsenal snapshot: HOME 0.5/1.5, AWAY 0.5/1.5/2.5), exit 0;
    - expected live shape per full-offer match: `CARDS_TOTAL` 5 lines, `CORNERS_TOTAL` 5, `HALF_TIME_CARDS_TOTAL` 3-4, `HALF_TIME_CORNERS_TOTAL` 3 (the snapshots: Arsenal 5/5/3/3, Leeds 5/5/4/3).
  - No live check covers those line counts. The smoke reports only per-match counts and code presence, and `api-sanity.py` checks only `CARDS_TOTAL` (>= 4 lines). The calendar-independent pin for all four codes is offline: the line table in `parse-all-markets-2026-11.test.ts` (Task 4) and the replay test's `totals` (Task 7).
- [ ] **Step 5: Clean up** - `git -C "$REPO" worktree remove "$WT"` (superpowers:finishing-a-development-branch). Keep `$EVID`.

## What to monitor after the fix

- `[sts] Unknown market` id histogram per run: any new id with >= 20 lines means another renumbering.
- `No fixture snapshot ... skipping` count per run (expected 0-1).
- A run with no `[STS/FullOffer] Found N fixtures for premier-league` line but an `[Aggregator/FullOffer] sts completed: success=false, 0 matches` line: the strict PL listing came back empty. `[STS] Strict id filter for premier-league (C1/T17) matched 0 fixtures; name-filter candidates: ...` names where the league went (an STS id renumbering: update `categoryId`/`tournamentId` in `sts/constants.ts` after checking the frame). Without that warning, the calendar is empty or the name filters no longer match. `sts-run-check.py` reports both as problems.
- STS per-match normalized counts vs the previous run (a drop > 20% for a full-offer match is a regression).
