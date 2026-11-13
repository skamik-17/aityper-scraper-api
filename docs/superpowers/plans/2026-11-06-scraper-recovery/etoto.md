# Etoto — health check 2026-11-06 + team-stat side axis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give etoto's per-team OPTA lines (shots, shots on target, fouls) their team side so they merge with peers instead of landing on side-less params, and map etoto's penalty market id -30591 ("Suma 0.5 rzutów karnych") to `PENALTY_AWARDED`.

**Architecture:** Changes are confined to `etoto-normalizer.ts`:
1. Mark the per-team ids with a side and prefix the line with `HOME:`/`AWAY:`. This is the convention CORNERS_TEAM already uses in this file and that forbet, betclic, fortuna, fuksiarz and superbet use for `TEAM_TOTAL_SHOTS(_ON_TARGET)`.
2. Route team fouls to the existing side-specific codes `HOME_/AWAY_TEAM_TOTAL_FOULS` (used by forbet, fortuna, superbet).
3. Map id `-30591` (O/U 0.5 penalties) to `PENALTY_AWARDED`.

No catalog change.

**Tech Stack:** TypeScript (ESM, tsx), Vitest.

**Spec:** the Observations section of this file. Evidence (durable, absolute): `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/etoto/`: `etoto-event-6224065-everton-coventry.trimmed.json` (raw capture, test fixture), `api-everton-coventry-team-stat-markets.json`, `observations-stats-2026-11-06.json` (numbers behind the status table), `penalty-markets-etoto-vs-siblings-2026-11-06.json`, `smoke-discovery-current-code-2026-11-06.txt`, `backend-log-*.txt`, `etoto-league-206-events.json`, `acceptance_check.py` and its current-code output `acceptance-check-current-code-2026-11-06.txt`. `docs/superpowers/` is untracked (`git status`: `?? docs/superpowers/`), so always use these absolute paths.

---

## Observations (pre-fix analysis)

### Status today: DEGRADED (comparison and display defect on team stats, penalty market now under an unmapped id). Volume and coverage are at or above the August level

Evidence column: file names are under `evidence/etoto/`; `obs.<key>` means a key in `observations-stats-2026-11-06.json`.

| Metric | Aug 2026 baseline (Arsenal v Coventry, 2026-08-20) | Today (2026-11-06, run 2 = 16:00Z) | Evidence |
|---|---|---|---|
| League listing / fixtures | — | 22 events → 20 fixtures. The 2 dropped are combo pseudo-events "10. kolejka 06-08.11 - 10 meczów" and "Dzień meczowy 07.11 - 4 mecze", correctly rejected by `isValidEvent` → `isComboEvent` (`src/scrapers/bookmakers/etoto/parser.ts:368-373`, `:378-389`) | `etoto-league-206-events.json`, `backend-log-per-match-counts.txt` |
| Merge with other bookmakers | — | 20/20 same `matchId`, 0 orphans, 0 duplicates | `acceptance-check-current-code-2026-11-06.txt` (`fixtures 20 orphans 0`) |
| Raw markets per match | 456 (1791 selections) | round 11: 466–508; round 12: 183–186. Total 6693 raw, 6553 DB rows | `obs.aug_baseline_raw_arsenal_coventry`; `backend-log-per-match-counts.txt` |
| Normalized codes / entries / selections (API) | 143 / 544 / 1695 | Arsenal v Hull 138 / 568 / 1846; Everton v Coventry 150 / 570 / 1863; Man City v Fulham 103 / 174 / 686 | `obs.aug_baseline_api_arsenal_coventry_2026-08-20`, `obs.today_api` |
| UNKNOWN selections | 1 (0.06%) | 0 | same as above (`unknown`) |
| OTHER + deliberately skipped (offline parse+normalize of the captured events) | — | 4/493 (0.8%) Arsenal v Hull, 5/508 (1.0%) Everton v Coventry | `obs.offline_parse_normalize` |
| Raw-name leaks / duplicate codes in a param | 23 (MULTI_RESULT) / 1 | 0 / 0 | `obs.*` (`leak`, `dupSelEntries`) |
| 1X2 vs peer median (20 × 3) | — | max 4.5%, mean 1.4% (17:00Z run: max 3.7%, mean 1.0%) | `obs.x12_vs_peer_median`; `acceptance-check-current-code-2026-11-06.txt` |
| O/U 2.5 vs peer median (20 × 2) | — | max 2.3%, no axis swap | `obs.ou25_vs_peer_median` |
| Tests | — | `src/scrapers/bookmakers/etoto` 3/3; golden `etoto` 506 blessed / 25 unblessed / 0 failures | `obs.tests_baseline` |

All 12 non-OTHER codes covered in August but missing today were removed or merged from the catalog on 2026-08-20 (`*_WIN_OR_OVER/UNDER`, `DRAW_OR_*_2_5` → `RESULT_OR_TOTAL`; `WIN_OR_BTTS`/`DRAW_OR_BTTS` → `RESULT_OR_BTTS`; half clean sheets → `*_TO_SCORE`). No real loss. 20 codes are new (set difference of the `codes` lists in `obs.aug_baseline_api_…` and `obs.today_api`).

Against `coverage.json` (World Cup baseline), `PENALTY_AWARDED` is missing. etoto does not send id 15 "Rzut karny" today. The only penalty market in the Everton v Coventry capture is **id -30591 "Suma 0.5 rzutów karnych"** (Poniżej 0.5 1.25 / Powyżej 0.5 3.55), which is logged once as `[etoto] Unmapped market "Suma 0.5 rzutów karnych" (id: -30591)` (`etoto-normalizer.ts:1315-1317`). The peers on `PENALTY_AWARDED` for the same match are betcris/betfan/forbet/lvbet YES 3.4 and fuksiarz 3.3, with NO at 1.25–1.28. So etoto offers -30591 instead of 15 today. "Over 0.5 penalties" means "at least one penalty", and the prices agree (3.55 vs 3.4), so the two markets are treated as the same proposition. That rests on wording and prices: etoto's settlement rules were not checked. The sibling brands on the same platform still publish id 15 for this very match: forbet event 57945881 `(15, "Rzut karny")` Tak 3.4 / Nie 1.25 and betfan 40932978 `(15, "Rzut karny w meczu")` Tak 3.4 / Nie 1.27 (`evidence/etoto/penalty-markets-etoto-vs-siblings-2026-11-06.json`). etoto may therefore publish both ids for one match (see Risks). On 2026-11-06 17:03Z, -30591 was present only on the matchday event (Everton v Coventry) and absent from Leeds v Tottenham and Arsenal v Hull (`acceptance-check-current-code-2026-11-06.txt`, pre-check block).

The other log warnings in run 2 are known and deliberate (`evidence/etoto/backend-log-run2-warnings.txt`): 60× id -30005 (3 names "1. poł./mecz i suma goli X w 1. poł") and 20× id -30006 "1. poł./mecz i dokładna suma goli", both "Skipping unsupported market … no catalog code yet" (`etoto-normalizer.ts:1183-1188`). The same names were already unclaimed in August, and no change is planned.

### Root cause (team-stat side axis)

`etoto-normalizer.ts:264-272` maps the per-team ids `162/163` → `TEAM_TOTAL_FOULS`, `168/169` → `TEAM_TOTAL_SHOTS_ON_TARGET` and `-30727/-30728` → `TEAM_TOTAL_SHOTS`. However, `ETOTO_MARKET_ID_TEAM_SIDE` (`:291-331`) has no entry for these ids, and the side-prefix branch only fires for `CORNERS_TEAM` (`:1239-1241`). The param therefore stays the bare line. Reproduced on the current code by the live smoke test (`evidence/etoto/smoke-discovery-current-code-2026-11-06.txt`, excerpt block at the end; `grep -n "Market Key: TEAM_TOTAL" <file>` → lines 93, 96, 102, 105):
```
5024: 📦 MARKET: Everton suma 4.5 strzałów celnych   → 5029: Market Key: TEAM_TOTAL_SHOTS_ON_TARGET:4.5
5077: 📦 MARKET: Coventry suma 3.5 strzałów celnych  → 5082: Market Key: TEAM_TOTAL_SHOTS_ON_TARGET:3.5
5183: 📦 MARKET: Everton suma 17.5 strzałów          → 5188: Market Key: TEAM_TOTAL_SHOTS:17.5
5236: 📦 MARKET: Coventry suma 10.5 strzałów         → 5241: Market Key: TEAM_TOTAL_SHOTS:10.5
```
The same keys come out of an offline parse+normalize of the trimmed capture on the current code. The golden entries #469-474 and #480-485/#489-494 have the same side-less shape (below).

The API for Everton v Coventry (`evidence/etoto/api-everton-coventry-team-stat-markets.json`) shows the effect. etoto sits alone on `TEAM_TOTAL_SHOTS` param `17.5` (label "17.5", no team), while betclic, fortuna, fuksiarz and superbet quote the same bet on `HOME:17.5` ("Gospodarze 17.5"). etoto's `10.5` row likewise sits apart from five peers on `AWAY:10.5`. Team fouls are worse: etoto "Everton suma 11.5 fauli" is on side-less `TEAM_TOTAL_FOULS:11.5`, while fortuna quotes the same line on `HOME_TEAM_TOTAL_FOULS:11.5`, and etoto "Coventry suma 12.5 fauli" sits apart from forbet/fortuna/superbet on `AWAY_TEAM_TOTAL_FOULS:12.5`.

The latent collision is already frozen in the golden fixture (`src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.expected.json`). Entries #480 "Francja suma 4.5 strzałów celnych" and #485 "Maroko suma 4.5 strzałów celnych" are both blessed as `TEAM_TOTAL_SHOTS_ON_TARGET:4.5`, and #469/#474 (France/Morocco 12.5 fouls) both as `TEAM_TOTAL_FOULS:12.5`. In the DB, `mergeMarketRecord` (`src/repositories/full-offer-repository.ts:197-248`) keeps the first team's odds and drops the other team's, with only a log warning (`:243-247`, `marketKey collision … keeping first-seen odds`). The survivor is then shown with no team name. This mapping dates from commit `f68c4e5` (2026-07-03). It did not show up in the August audit because etoto had no OPTA team stats for Arsenal v Coventry when that audit captured it. The team OPTA lines are a **matchday-only** offer. Everton v Coventry (KO 2026-11-06 20:00Z, `eventStart` 1793995200000) carries them at T-4h, with 6 rows. Leeds v Tottenham (event 6224070, KO 2026-11-07 12:30Z) has none of ids 161/162/163/167/168/169/-30726/-30727/-30728/-30591 at T-19.5h, and neither does Arsenal v Hull (6224078) at T-22.6h (`acceptance-check-current-code-2026-11-06.txt`, pre-check block). The exact onset time is unknown.

### What still works and must not break
- `CORNERS_TEAM` (ids 115/116): today `CORNERS_TEAM:HOME:4.5/5.5/6.5` and `CORNERS_TEAM:AWAY:2.5/3.5/4.5`.
- `CARDS_TEAM` side-prefixed selections (`etoto-normalizer.ts:727-731`), and the `RESULT_OR_BTTS` / `TEAM_WIN_OR_CLEAN_SHEET` side folding through the same side map (`:308-315`).
- The whole-match totals `FOULS_TOTAL` (161), `TOTAL_SHOTS_ON_TARGET` (167) and `TOTAL_SHOTS` (-30726), which must stay side-less: today `FOULS_TOTAL:23.5`, `TOTAL_SHOTS_ON_TARGET:7.5/8.5/9.5`, `TOTAL_SHOTS:28.5` (capture), golden blessed #466-468, #475-479, #486-488.
- PENALTY_AWARDED from id 15 "Rzut karny" (golden #463, Tak 3.2 / Nie 1.3).

### Risks & unknowns
- **Team-fouls code choice (decision D1):** `HOME_/AWAY_TEAM_TOTAL_FOULS` (forbet, fortuna, superbet) or `TEAM_TOTAL_FOULS` with a `HOME:`/`AWAY:` param (would need forbet, fortuna and superbet changes). This plan takes the first option. The betfan plan (`betfan.md`) makes the same choice, and the two must stay consistent. fuksiarz also emits side-less `TEAM_TOTAL_FOULS`; that is out of scope here and listed under open questions.
- The catalog's `AWAY_TEAM_TOTAL_FOULS` has viewType `PARAMETER_SLIDER` while `HOME_TEAM_TOTAL_FOULS` is `STAT_RANGE` (`market-catalog.ts:7202-7231`). This is a display inconsistency outside this plan.
- etoto could later publish "Suma 1.5 rzutów karnych" under id -30591. Only the 0.5 line equals PENALTY_AWARDED, and it is guarded in Task 3.
- etoto could reuse id -30591 for another market. Negative gameType ids do not keep one meaning on this platform: fuksiarz, on the same `/rest/market/events` API, sends -30591 as "Zmiana w 1. połowie" (`src/services/normalization/__fixtures__/fuksiarz/world-cup-2026_france_morocco.json:3087`, mapped to `HALF_TIME_LEAD_CHANGE` at `fuksiarz-normalizer.ts:80`). Task 3 therefore also requires the penalty-kick wording in the name, so another O/U 0.5 market under -30591 stays `OTHER` and never publishes its Over price as PENALTY_AWARDED YES.
- **etoto could send both id 15 and id -30591 for one match.** forbet and betfan still do id 15 on the same platform (see above). After Task 3 both normalize to marketKey `PENALTY_AWARDED`, so `mergeMarketRecord` (`full-offer-repository.ts:197-248`) keeps the first one seen and logs `marketKey collision with overlapping selection code … for etoto PENALTY_AWARDED … keeping first-seen odds` (`:243-247`). This is acceptable because both are the same proposition. Task 3 pins that both raws produce the same key and the same YES/NO code set, so whichever one wins is correct. The monitor below excludes this one key.
- After the fix, the next scrape writes new keys (`…:HOME:17.5`). `pruneStaleOddsRows` (`full-offer-repository.ts:267`) deletes the old side-less rows for the match/bookmaker, so no DB cleanup is needed.
- Live verification is time-boxed by the matchday-only window (see Root cause). When no etoto event carries the ids, the live team-stat and penalty criteria are "not yet verifiable", and the capture-based unit tests decide.

### Open questions for the owner
1. Confirm D1 (side-specific fouls codes) for etoto and betfan. Should fuksiarz's `TEAM_TOTAL_FOULS` get the same treatment in its own plan?
2. Should the two HT/FT + total-goals combos (ids -30005/-30006, 4 skips per fixture, so 80 per run for the 20 fixtures of 2026-11-06) get catalog codes, or stay skipped?
3. **Follow-up outside this repo:** `aityper/docs/audit-ledger/coverage.json` lists etoto `TEAM_TOTAL_FOULS` (etoto block `:5419-6572`, entry at `:6500`) and has no etoto `HOME_TEAM_TOTAL_FOULS` / `AWAY_TEAM_TOTAL_FOULS`. After Task 2, a health check against that baseline would report a false "missing TEAM_TOTAL_FOULS". Should the ledger be updated (drop `TEAM_TOTAL_FOULS`, add `HOME_/AWAY_TEAM_TOTAL_FOULS` with `OVER`/`UNDER`) when Task 2 lands? This plan does not touch the frontend repo.

### Acceptance criteria (live, after the next scrape)
All commands are read-only. `E=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/etoto`.

**Pre-check (gate for the team-stat and penalty criteria).** Team OPTA lines and -30591 are a matchday-only offer: present at T-4h (Everton v Coventry), absent at T-19.5h (Leeds v Tottenham) and at T-22.6h (Arsenal v Hull). Before a team-stat, penalty or smoke check counts, this must print a non-empty list for the event under test:
```bash
curl -s --compressed https://api.etoto.pl/rest/market/events/<eventId> | python3 -I -c "import json,sys;g={x['gameType'] for x in json.load(sys.stdin)['data']['eventGames']};print(sorted(g&{162,163,168,169,-30727,-30728,-30591}))"
```
Proven on 2026-11-06 17:03Z: event 6224065 → `[-30728, -30727, -30591, 162, 163, 168, 169]`; 6224070 and 6224078 → `[]`. The next window is Sat 2026-11-07, Leeds v Tottenham (event 6224070, KO 12:30Z). Poll from about 09:00Z; the exact onset is unknown. If no event prints a non-empty list, the team-stat and penalty criteria are **not yet verifiable**, and the capture-based unit tests in Tasks 1–3 decide. An empty list is not a pass.

**Which backend runs the fix.** `acceptance_check.py` reads `BASE = http://localhost:3001`, which is the main checkout's `tsx watch` on `master`. Tasks 1–3 live on `recovery/etoto` only; `master` stays untouched until the owner asks for a merge (EXECUTION.md Group A1), and merging into `recovery/integration` does not change what :3001 runs. A scrape on that backend runs the unfixed normalizer and prints `penalty_awarded_etoto 0 []` and `unmapped 1` even when the pre-check lists -30591: that is a false fail, not a verdict on Task 3. So run the API, log and collision checks only when both hold:
1. `master` contains the fix: in the main checkout `grep -c PENALTY_TOTAL_ZERO_FIVE_NAME src/services/normalization/bookmakers/etoto-normalizer.ts` prints ≥ 1. That symbol comes from the final-review fix wave (it replaced the Task 3 `PENALTY_KICK_WORDING`), so it also proves Tasks 1–3 and the final-review fixes are in. The grep also works after a squash merge, where `git merge-base --is-ancestor` would say no.
2. The live backend has logged a `[Aggregator/FullOffer] etoto success:` (or `partial:`) run whose `[eToto/FullOffer] Found` line comes after the merge.

Then re-run the pre-check for the next matchday event. After Leeds v Tottenham that is Sat 2026-11-07 15:00Z (6224074 Fulham v Newcastle, 6224078 Arsenal v Hull City) or 17:30Z (6224083 Nottingham v Manchester City), or Sun 2026-11-08 14:00Z (6224081, 6224084, 6224085, 6224086) or 16:30Z (6224088), kick-offs per `$E/etoto-league-206-events.json`.

Status 2026-11-07 00:10Z: **not yet verifiable.** `master` does not contain Tasks 1–3 (`git merge-base --is-ancestor cdef392 master` exits 1 in the main checkout), and the 2026-11-06 23:57Z pre-check of 6224070 printed `[]`. Until both gates above hold, the capture-based unit tests in Tasks 1–3 decide.

**One command for the API criteria** (about 20 local GETs, about 8 s): `python3 -I $E/acceptance_check.py`. Current-code output (17:00Z scrape): `$E/acceptance-check-current-code-2026-11-06.txt`.

| Criterion | Line printed by `acceptance_check.py` | Today (unfixed) | Expected after Tasks 1–3 |
|---|---|---|---|
| Fixtures: etoto count = valid listing events (below), 0 orphans | `fixtures N orphans K` | `fixtures 20 orphans 0` | N = valid events, K = 0 |
| 1X2 within 10% of peer median | `1x2_n … max_pct … over10 …` | `1x2_n 60 max_pct 3.7 mean_pct 1.0 over10 0` | `over10 0` |
| Team shots side axis (only when the pre-check is non-empty) | `etoto_sideless … etoto_shared … etoto_solo …` | `etoto_sideless 6 etoto_shared 0 etoto_solo 0` | `etoto_sideless 0`, `etoto_shared` > 0 (historical, Everton v Coventry: 4 of 4, because peers already sit on `HOME:4.5`, `AWAY:3.5`, `HOME:17.5` and `AWAY:10.5`) |
| Team fouls on HOME_/AWAY_ codes (pre-check shows 162/163) | `… etoto_fouls_rows … etoto_fouls_shared …` | `etoto_fouls_rows 0 etoto_fouls_shared 0` | both > 0 (2 and 2 for Everton v Coventry, historical) |
| O/U 2.5 within 10% of peer median | `ou25_n … max_pct …` | `ou25_n 40 max_pct 1.8` | max ≤ 10 |
| PENALTY_AWARDED carries etoto, YES within 15% of peer median (pre-check shows -30591) | `penalty_awarded_etoto n [(matchId, yes, dev%)]` | `penalty_awarded_etoto 0 []` | n ≥ 1 per matchday event, every dev ≤ 15 (historical: 3.55 vs 3.4 = 4.4%) |
| UNKNOWN selections | `unknown_selections …` | `unknown_selections 0` | 0 |

Valid listing events (expected fixture count; it changes with the round, 20 on 2026-11-06):
```bash
curl -s --compressed https://api.etoto.pl/rest/market/categories/multi/206/events -o /tmp/etoto-206.json && cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsx -e 'import { readFileSync } from "node:fs"; import { isValidEvent } from "./src/scrapers/bookmakers/etoto/parser.ts"; const ev = JSON.parse(readFileSync(process.argv[1], "utf8")).data; console.log("listing", ev.length, "valid", ev.filter(isValidEvent).length);' /tmp/etoto-206.json
```
Proven 2026-11-06: `listing 22 valid 20`.

Raw volume and OTHER share from the backend log of the last **completed** run, i.e. one that already shows `[Aggregator/FullOffer] etoto success:` (or `partial:`). The share counts unmapped OTHER plus the deliberate -30005/-30006 skips and must be ≤ 2% of raw. Every fixture that kicks off within 3 days must have ≥ 450 raw markets in the `[eToto/FullOffer] <match>: <n> markets` lines. First strip ANSI from the live log with `sed 's/\x1b\[[0-9;]*m//g' <backend.log> > <clean log>`:
```bash
L=<clean log>; S=$(grep -n '\[eToto/FullOffer\] Found' $L | tail -1 | cut -d: -f1); tail -n +$S $L | python3 -I -c "
import sys,re
t=sys.stdin.read()
per_match=[int(x) for x in re.findall(r'\[eToto/FullOffer\] .+?: (\d+) markets',t)]
raw=sum(per_match); fx=len(per_match)
un=len(re.findall(r'\[etoto\] Unmapped market',t)); sk=len(re.findall(r'\[etoto\] Skipping unsupported',t))
print('etoto_raw',raw,'fixtures',fx,'unmapped',un,'skipped',sk,'skipped_expected',4*fx,'unclaimed_pct',round(100*(un+sk)/raw,2))"
```
Today (2026-11-06, printed before this one-liner gained `fixtures` and `skipped_expected`): runs 1–2 print `etoto_raw 6693 unmapped 1 skipped 80 unclaimed_pct 1.21`, and run 3 prints `etoto_raw 6709 unmapped 1 skipped 80 unclaimed_pct 1.21`. That is 4 skips × 20 fixtures: every fixture carries exactly 3× -30005 (0.5/1.5/2.5) and 1× -30006, and run 2 logged each of those 4 names 20 times (`$E/backend-log-run2-warnings.txt`). Expected after Task 3: `unmapped 0`, `skipped` == `skipped_expected` (4 × valid fixtures), `unclaimed_pct` ≤ 2. `fixtures` counts that run's `[eToto/FullOffer] <match>: <n> markets` lines. It must equal the `valid` count of the `isValidEvent` command above, taken at the time of the run. It falls as matches kick off: 19 on 2026-11-07, after Everton v Coventry was played, so `skipped 76`. Never compare against a fixed 80.

**Single-bookmaker live smoke test.** The command shape was proven on the current code: it printed the four side-less keys at log lines 5029/5082/5188/5241 (excerpt in `$E/smoke-discovery-current-code-2026-11-06.txt`). The process does not exit after the summary, so wrap it in `timeout`. Run it only after the pre-check is non-empty for `<eventId>`:
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 240 npx tsx scripts/etoto-market-discovery.ts --url "https://www.etoto.pl/zaklady-bukmacherskie/wydarzenie/<eventId>" --league premier-league --market "strzałów"
```
`--market` is a case-insensitive substring filter on the raw name (`src/services/audit/scraper-audit-core.ts:753-754`); use `--market "fauli"` for fouls. Expected after the fix: `Market Key: TEAM_TOTAL_SHOTS:HOME:<line>` / `TEAM_TOTAL_SHOTS:AWAY:<line>` (and `TEAM_TOTAL_SHOTS_ON_TARGET:…`), and with `"fauli"`: `HOME_TEAM_TOTAL_FOULS:<line>` / `AWAY_TEAM_TOTAL_FOULS:<line>`. Exit code 124 is expected. The script performs a full league scrape: about 23 requests, about 60 s, no DB writes.

---

## Global Constraints

- Commit messages are concise and descriptive. **No signature or attribution footers** (no "Generated with…", no "Co-Authored-By"). The user rule overrides any reminder.
- Code and comments are in English only.
- Baseline measured 2026-11-06 on the unmodified tree: `npx vitest run` 65 files / 1182 tests passed, and `npx tsc --noEmit` exited 0 with no output. Any other failure after your change is yours.
- Before **each** commit, both must be green: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` and `npx vitest run`. When you work in the worktree from Task 0, run the same commands from the worktree root.
- The repo is on `master`, and `docs/superpowers/` is untracked. Work on branch `fix/etoto-team-stat-side` (Task 0), and copy evidence by absolute path only.
- Golden-fixture discipline: write the failing unit test first. Rebless only through `npx tsx scripts/rebless-golden.ts --bookmaker etoto` after a `--dry` run whose changed-entry list matches the one stated in the task, then inspect `git diff`. Never hand-edit expected files.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan does not change it: all target codes already exist in `market_types` (TEAM_TOTAL_SHOTS 309, TEAM_TOTAL_SHOTS_ON_TARGET 421, HOME_/AWAY_TEAM_TOTAL_FOULS 1107/1108, PENALTY_AWARDED 432).
- Editing anything under `src/` of the main checkout restarts the running dev server (`tsx watch`). Edits inside the Task 0 worktree do not.
- Commit only when the user explicitly asks (repo `CLAUDE.md`: "Only commit when explicitly requested"). Every per-task "Commit" step is conditional on that.

## Review Focus

1. **Both teams quote the same line** (France 4.5 and Morocco 4.5 shots on target): the two must produce two distinct keys. Pinned in Task 1 (`same line both teams`).
2. **Whole-match totals sharing the family** (ids 161 `Suma X fauli`, 167 `Suma X strzałów celnych`, -30726 `Suma X strzałów`): must stay side-less. Pinned in Task 1 test 4 on the capture (`FOULS_TOTAL:23.5`, `TOTAL_SHOTS_ON_TARGET:7.5/8.5/9.5`, `TOTAL_SHOTS:28.5`) and by golden blessed #466-468 (161), #475-479 (167), #486-488 (-30726).
3. **CORNERS_TEAM regression** when the side-prefix branch is generalized. Pinned in Task 1 (capture asserts the six existing CORNERS_TEAM keys unchanged).
4. **Penalty market at a line other than 0.5** under id -30591: must not become PENALTY_AWARDED. Pinned in Task 3. **Both penalty ids in one match** (15 and -30591): same key and same YES/NO code set, so the collision winner does not matter. Pinned in Task 3.
5. **Team-fouls lines on both sides equal** (France 12.5 / Morocco 12.5, golden #469/#474): they must become HOME_ and AWAY_ codes, not one key. Pinned in Task 2.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/services/normalization/bookmakers/etoto-normalizer.ts` | etoto raw → catalog | side map `:291-331`, id map `:265-266` (fouls), `:158` area (id -30591), param branch `:1239-1241`, O/U selection case list `:696-724`, PENALTY_AWARDED in the Tak/Nie group `:746-785` |
| `src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts` | regression tests on real 2026-11-06 values | create |
| `src/services/normalization/bookmakers/__tests__/fixtures/etoto-event-6224065-everton-coventry.trimmed.json` | captured raw event (copy of evidence) | create |
| `src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.expected.json` | golden | rebless only (18 entries) |

---

### Task 0: Branch or worktree

- [ ] **Step 1: Isolate the work.** Preferred: a worktree, so editing `src/` does not restart the running `tsx watch`:
```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api
git worktree add ../aityper-scraper-api-etoto -b fix/etoto-team-stat-side master
ln -s /home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules ../aityper-scraper-api-etoto/node_modules
cd ../aityper-scraper-api-etoto && npx vitest run src/scrapers/bookmakers/etoto
```
Expected: `Tests  3 passed (3)`. If modules do not resolve through the symlink, run `npm ci` in the worktree instead. Alternative, accepting dev-server restarts: `git switch -c fix/etoto-team-stat-side` in the main checkout. All later relative paths are relative to whichever root you chose.

---

### Task 1: Side-prefix TEAM_TOTAL_SHOTS and TEAM_TOTAL_SHOTS_ON_TARGET

**Files:**
- Modify: `src/services/normalization/bookmakers/etoto-normalizer.ts`. Add `[168]: "HOME", [169]: "AWAY", [-30727]: "HOME", [-30728]: "AWAY"` to `ETOTO_MARKET_ID_TEAM_SIDE` (`:291`). Replace `marketCode === "CORNERS_TEAM"` at `:1239` with membership in the new set below.
- Create: `src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts`
- Create: `src/services/normalization/bookmakers/__tests__/fixtures/etoto-event-6224065-everton-coventry.trimmed.json`, copied from `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/etoto/`. It has 22 games. Each is an unmodified game object from the full capture, kept in capture order: -30006, 3 × -30005, 6 × CORNERS_TEAM (115/116), 161, 162, 163, 3 × 167, 168, 169, -30726, -30727, -30728, -30591.
- Rebless: etoto golden (12 entries)

**Interfaces:**
- Consumes: `parseAllMarkets(event: EtotoEvent, teams?: ParsedTeams): ScrapedMarket[]` and `parseTeamNames(eventName: string): ParsedTeams` (`src/scrapers/bookmakers/etoto/parser.ts:287`, `:33`); `etotoNormalizer.normalizeMarket(raw, ctx)`.
- Produces:
  - `const ETOTO_TEAM_LINE_PARAM_MARKETS: Set<NormalizedMarketType>` = `CORNERS_TEAM`, `TEAM_TOTAL_SHOTS`, `TEAM_TOTAL_SHOTS_ON_TARGET` (module-private, next to `ETOTO_TEAM_PARAM_MARKETS` at `:339`).
  - The test helper `normalizeCapture(ctx): NormalizedMarketOutput[]` in the new test file. It parses the fixture, maps each `ScrapedMarket` to `{bookmakerMarketId, name, groupName, paramValue, selections}`, normalizes it, and drops nulls. Tasks 2–3 reuse it.

- [ ] **Step 1: Copy the fixture and write the failing tests**

```bash
mkdir -p src/services/normalization/bookmakers/__tests__/fixtures
cp /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/etoto/etoto-event-6224065-everton-coventry.trimmed.json src/services/normalization/bookmakers/__tests__/fixtures/
```
Contexts: `ctxEC = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" }` and `ctxFM = { homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026", leagueName: "world-cup-2026" }`. `ctxFM` is exactly the `ctx` of the golden input `src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.json`. Wrap everything in `describe("etoto recovery 2026-11", …)`. Keep the test names below verbatim, because the `-t` filters in Tasks 2–3 depend on them. Vitest 4.0.16 builds `-t` as `new RegExp(pattern)` with no flags (`node_modules/vitest/dist/chunks/coverage.BuJUwVtg.js:2619`) and matches it against the full name including the describe (`node_modules/@vitest/runner/dist/chunk-tasks.js:74`), so the match is case-sensitive.

```ts
it("etoto team shot lines carry the team side (Everton v Coventry capture)", () => {
  const keyed = Object.fromEntries(normalizeCapture(ctxEC)
    .filter((o) => o.marketCode === "TEAM_TOTAL_SHOTS" || o.marketCode === "TEAM_TOTAL_SHOTS_ON_TARGET")
    .map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));
  expect(keyed).toEqual({
    "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5": [["UNDER", 2.4], ["OVER", 1.5]],
    "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:3.5": [["UNDER", 1.65], ["OVER", 2.1]],
    "TEAM_TOTAL_SHOTS:HOME:17.5": [["UNDER", 1.68], ["OVER", 2.05]],
    "TEAM_TOTAL_SHOTS:AWAY:10.5": [["UNDER", 2.4], ["OVER", 1.5]],
  });
});

it("etoto CORNERS_TEAM keys are unchanged by the generalized side prefix", () => {
  const keys = normalizeCapture(ctxEC).filter((o) => o.marketCode === "CORNERS_TEAM").map((o) => o.marketKey);
  expect(keys).toEqual(["CORNERS_TEAM:HOME:4.5", "CORNERS_TEAM:HOME:5.5", "CORNERS_TEAM:HOME:6.5",
    "CORNERS_TEAM:AWAY:2.5", "CORNERS_TEAM:AWAY:3.5", "CORNERS_TEAM:AWAY:4.5"]);
});

it("etoto same line both teams: shots on target 4.5 for France and Morocco stay on two keys", () => {
  const fr = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "168", name: "Francja suma 4.5 strzałów celnych",
    selections: [{ name: "Poniżej 4.5", odds: 2.9 }, { name: "Powyżej 4.5", odds: 1.35 }] }, ctxFM)!;
  const ma = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "169", name: "Maroko suma 4.5 strzałów celnych",
    selections: [{ name: "Poniżej 4.5", odds: 1.25 }, { name: "Powyżej 4.5", odds: 3.55 }] }, ctxFM)!;
  expect(fr.marketKey).toBe("TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5");
  expect(ma.marketKey).toBe("TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:4.5");
});

it("etoto whole-match totals (161 / 167 / -30726) stay side-less (Everton v Coventry capture)", () => {
  const keys = normalizeCapture(ctxEC)
    .filter((o) => ["FOULS_TOTAL", "TOTAL_SHOTS_ON_TARGET", "TOTAL_SHOTS"].includes(o.marketCode))
    .map((o) => o.marketKey);
  expect(keys).toEqual(["FOULS_TOTAL:23.5", "TOTAL_SHOTS_ON_TARGET:7.5", "TOTAL_SHOTS_ON_TARGET:8.5",
    "TOTAL_SHOTS_ON_TARGET:9.5", "TOTAL_SHOTS:28.5"]);
});
```
(All values were checked on the current code by parsing and normalizing the trimmed capture offline. Tests 2 and 4 produce exactly these keys today. Tests 1 and 3 produce the side-less `TEAM_TOTAL_SHOTS_ON_TARGET:4.5` / `:3.5` and `TEAM_TOTAL_SHOTS:17.5` / `:10.5` with the same odds.)

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `npx vitest run src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts`
Expected: `Tests  2 failed | 2 passed (4)`. Tests 1 and 3 fail (keys are `TEAM_TOTAL_SHOTS_ON_TARGET:4.5` etc.). Tests 2 and 4 pass, because they guard behaviour that already works.

- [ ] **Step 3: Implement** the four side-map entries and `ETOTO_TEAM_LINE_PARAM_MARKETS`. Line 1239 becomes `if (ETOTO_TEAM_LINE_PARAM_MARKETS.has(marketCode) && teamSide)`. Update the comment at `:1233-1238` so it names all three codes.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `npx vitest run src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts src/scrapers/bookmakers/etoto`
Expected: `Test Files  2 passed (2)`, `Tests  7 passed (7)` (4 new + 3 in `parser-market-name.test.ts`).

- [ ] **Step 5: Golden. Confirm the diff, then rebless**
Run: `npx tsx scripts/rebless-golden.ts --bookmaker etoto --dry`
Expected: `[rebless] etoto/world-cup-2026_france_morocco: 12 entries updated`. The names listed are exactly "Francja suma 4.5/5.5/6.5 strzałów celnych", "Maroko suma 2.5/3.5/4.5 strzałów celnych", "Francja suma 14.5/15.5/16.5 strzałów" and "Maroko suma 8.5/9.5/10.5 strzałów" (#480-485, #489-494), followed by `{"changedTotal":12,"dry":true}`.
Run: `npx tsx scripts/rebless-golden.ts --bookmaker etoto`, then:
```bash
git diff --numstat -- src/services/normalization/__fixtures__/etoto/
git diff -U0 -- src/services/normalization/__fixtures__/etoto/ | grep -E '^[-+] ' | grep -vcE '"(marketKey|paramValue)"'
```
Expected: `24	24	src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.expected.json` (12 entries × `expected.marketKey` + `expected.paramValue`), then `0`. The second command counts changed lines that are neither `marketKey` nor `paramValue`, so `0` proves that no `marketCode`, selection or odds line changed. Read the 24 `+` lines: each gains `HOME:` (Francja) or `AWAY:` (Maroko), e.g. `"marketKey": "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5"`. The counts are exact: the expected file round-trips byte-for-byte through `JSON.stringify(…, null, 2)` (`scripts/rebless-golden.ts:170`), as checked on a simulated rebless. If you are not committing, stage the reblessed file (`git add src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.expected.json`) so that Task 2's `git diff` shows only Task 2's change.

- [ ] **Step 6: Full verification**: `npx tsc --noEmit && npx vitest run`. Expected: `npx tsc` prints nothing and exits 0. Vitest is green with one more test file and exactly 4 more tests than the tree you started from (on the 2026-11-06 baseline: 66 files / 1186 tests).

- [ ] **Step 7: Commit (only if the user has asked for commits)**
```bash
git add src/services/normalization/bookmakers/etoto-normalizer.ts src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts src/services/normalization/bookmakers/__tests__/fixtures/etoto-event-6224065-everton-coventry.trimmed.json src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.expected.json
git commit -m "fix(etoto): side-prefix team shot lines so they merge with peers and never collide"
```

---

### Task 2: Route etoto team fouls to HOME_/AWAY_TEAM_TOTAL_FOULS (decision D1)

**Files:**
- Modify: `etoto-normalizer.ts:265-266`: `[162]: "HOME_TEAM_TOTAL_FOULS"`, `[163]: "AWAY_TEAM_TOTAL_FOULS"`. Add both codes to the O/U selection case list at `:696-724` (next to `case "TEAM_TOTAL_FOULS":`).
- Test: `src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts`
- Rebless: etoto golden (6 entries)

**Interfaces:**
- Consumes: `normalizeCapture` (Task 1).
- Produces: none. The param stays the bare decimal line from `extractParamValue` (`:1137`), the same key shape forbet/fortuna/superbet use (`HOME_TEAM_TOTAL_FOULS:11.5`).

- [ ] **Step 1: Write the failing tests**
```ts
it("etoto team fouls use the side-specific codes (Everton v Coventry capture)", () => {
  const keyed = Object.fromEntries(normalizeCapture(ctxEC)
    .filter((o) => /TEAM_TOTAL_FOULS$/.test(o.marketCode))
    .map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));
  expect(keyed).toEqual({
    "HOME_TEAM_TOTAL_FOULS:11.5": [["UNDER", 1.83], ["OVER", 1.87]],
    "AWAY_TEAM_TOTAL_FOULS:12.5": [["UNDER", 1.65], ["OVER", 2.1]],
  });
});

it("etoto same fouls line both teams (12.5) lands on HOME_ and AWAY_ codes", () => {
  const sels = (u: number, o: number) => [{ name: "Poniżej 12.5", odds: u }, { name: "Powyżej 12.5", odds: o }];
  const fr = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "162", name: "Francja suma 12.5 fauli", selections: sels(2.2, 1.6) }, ctxFM)!;
  const ma = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "163", name: "Maroko suma 12.5 fauli", selections: sels(1.6, 2.2) }, ctxFM)!;
  expect([fr.marketKey, ma.marketKey]).toEqual(["HOME_TEAM_TOTAL_FOULS:12.5", "AWAY_TEAM_TOTAL_FOULS:12.5"]);
  expect(ma.selections.map((s) => s.code)).toEqual(["UNDER", "OVER"]);
});
```
- [ ] **Step 2: Run and confirm they fail**: `npx vitest run src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts -t fouls`. Both new names contain lowercase `fouls`, and no Task 1 name does. Expected: `Tests  2 failed | 4 skipped (6)`. The keys are `TEAM_TOTAL_FOULS:11.5` / `:12.5`.
- [ ] **Step 3: Implement** the two id-map edits and the selection case entries.
- [ ] **Step 4: Run and confirm they pass**: same command. Expected: `Tests  2 passed | 4 skipped (6)`. Then run the whole file without `-t`: `Tests  6 passed (6)`.
- [ ] **Step 5: Golden**: `npx tsx scripts/rebless-golden.ts --bookmaker etoto --dry` lists exactly 6 entries, "Francja suma 12.5/13.5/14.5 fauli" and "Maroko suma 10.5/11.5/12.5 fauli" (#469-474), followed by `{"changedTotal":6,"dry":true}`. Rebless (`npx tsx scripts/rebless-golden.ts --bookmaker etoto`), then, with Task 1's fixture change committed or staged:
```bash
git diff --numstat -- src/services/normalization/__fixtures__/etoto/
git diff -U0 -- src/services/normalization/__fixtures__/etoto/ | grep -E '^[-+] ' | grep -vcE '"(marketCode|marketKey)"'
```
Expected: `18	18	src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.expected.json`, then `0`. The 18 lines are the top-level `entry.marketCode`, `expected.marketCode` and `expected.marketKey` of each of the 6 entries. `paramValue` stays `"12.5"` etc., and selections and odds do not change. The `+` lines read `HOME_TEAM_TOTAL_FOULS` for Francja and `AWAY_TEAM_TOTAL_FOULS` for Maroko, e.g. `"marketKey": "AWAY_TEAM_TOTAL_FOULS:12.5"` for #474. (Without staging, the cumulative diff against HEAD is `42	42`.)
- [ ] **Step 6: Full verification**: `npx tsc --noEmit && npx vitest run`. Expected: tsc silent with exit 0, vitest green with 2 more tests than after Task 1.
- [ ] **Step 7: Commit (only if the user has asked for commits)**
```bash
git add src/services/normalization/bookmakers/etoto-normalizer.ts src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.expected.json
git commit -m "fix(etoto): route team fouls to HOME_/AWAY_TEAM_TOTAL_FOULS like forbet/fortuna/superbet"
```

---

### Task 3: Map "Suma 0.5 rzutów karnych" (id -30591) to PENALTY_AWARDED

**Files:**
- Modify: `etoto-normalizer.ts`. Add the id map entry `[-30591]: "PENALTY_AWARDED"` next to `[15]` (`:158`). In `normalizeMarket`, when `marketId === -30591` and the raw line is not `0.5`, or the name lacks the penalty-kick wording (`/rzut\p{L}*\s+karn/iu`; JS `\w` is ASCII-only and would miss the "ó" of "rzutów"), return the market as `OTHER`, which keeps today's behaviour for other lines and other markets reusing the id. Review fix round 1 added a fifth test for that case (-30591 "Suma 0.5 goli w 1. połowie", Poniżej/Powyżej 0.5 → `OTHER`), so the file has 11 tests after Task 3. Pull `PENALTY_AWARDED` (`case` at `:771`) out of the shared Tak/Nie fall-through group (`:746-785`, which ends in `return normalizeYesNoSelection(trimmed)` at `:785`) into its own case. That case maps `normalizeOverUnderSelection` OVER → `YES` and UNDER → `NO`, then falls back to `normalizeYesNoSelection`.
- Test: `src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts`

**Interfaces:**
- Consumes: `normalizeCapture` (Task 1).
- Produces: none.

- [ ] **Step 1: Write the failing tests**
```ts
it("etoto 'Suma 0.5 rzutów karnych' (-30591) is PENALTY_AWARDED with over = YES", () => {
  const pen = normalizeCapture(ctxEC).find((o) => o.debug?.rawName === "Suma 0.5 rzutów karnych")!;
  expect(pen.marketCode).toBe("PENALTY_AWARDED");
  expect(pen.marketKey).toBe("PENALTY_AWARDED");
  expect(pen.selections.map((s) => [s.code, s.odds])).toEqual([["NO", 1.25], ["YES", 3.55]]);
});

it("etoto penalty totals at another line (-30591, 1.5) do not become PENALTY_AWARDED", () => {
  const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-30591", name: "Suma 1.5 rzutów karnych",
    selections: [{ name: "Poniżej 1.5", odds: 1.02 }, { name: "Powyżej 1.5", odds: 15 }] }, ctxEC);
  expect(out?.marketCode).not.toBe("PENALTY_AWARDED");
});

it("etoto 'Rzut karny' (id 15) still maps Tak/Nie", () => {
  const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "15", name: "Rzut karny",
    selections: [{ name: "Tak", odds: 3.2 }, { name: "Nie", odds: 1.3 }] }, ctxEC)!;
  expect(out.selections.map((s) => s.code)).toEqual(["YES", "NO"]);
});

it("etoto penalty ids 15 and -30591 give the same key and YES/NO codes, so either collision winner is correct", () => {
  // forbet 57945881 quotes id 15 "Rzut karny" Tak 3.4 / Nie 1.25 for this same match
  // (evidence/etoto/penalty-markets-etoto-vs-siblings-2026-11-06.json).
  const id15 = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "15", name: "Rzut karny",
    selections: [{ name: "Tak", odds: 3.4 }, { name: "Nie", odds: 1.25 }] }, ctxEC)!;
  const id30591 = normalizeCapture(ctxEC).find((o) => o.debug?.rawName === "Suma 0.5 rzutów karnych")!;
  expect(id30591.marketKey).toBe(id15.marketKey);
  expect(id30591.selections.map((s) => s.code).sort()).toEqual(id15.selections.map((s) => s.code).sort());
});
```
(`debug.rawName` is set at `etoto-normalizer.ts:1326`.)
- [ ] **Step 2: Run and confirm it fails**: `npx vitest run src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts -t "penalty|PENALTY_AWARDED|Rzut karny"`. The pattern selects exactly the four Task 3 tests. Test 1 matches via `PENALTY_AWARDED`, tests 2 and 4 via lowercase `penalty`, and test 3 via `Rzut karny`. No Task 1 or Task 2 name matches. Expected: `Tests  2 failed | 2 passed | 6 skipped (10)`. Test 1 fails because it gets `marketCode` `OTHER` with codes `UNKNOWN`/`UNKNOWN` (checked on the current code). Test 4 fails on `OTHER` vs `PENALTY_AWARDED`. Tests 2 and 3 pass.
- [ ] **Step 3: Implement** as described in Files.
- [ ] **Step 4: Run and confirm it passes**: same command. Expected: `Tests  4 passed | 6 skipped (10)`. Then run the whole file without `-t`: `Tests  10 passed (10)`.
- [ ] **Step 5: Golden**: `npx tsx scripts/rebless-golden.ts --bookmaker etoto --dry`. Expected: `{"changedTotal":0,"dry":true}`, because the World Cup fixture has no id -30591 and #463 (id 15, Tak 3.2 / Nie 1.3 → YES/NO) is unchanged.
- [ ] **Step 6: Full verification**: `npx tsc --noEmit && npx vitest run`. Expected: tsc silent with exit 0, vitest green with 4 more tests than after Task 2.
- [ ] **Step 7: Commit (only if the user has asked for commits)**
```bash
git add src/services/normalization/bookmakers/etoto-normalizer.ts src/services/normalization/bookmakers/__tests__/etoto-recovery-2026-11.test.ts
git commit -m "fix(etoto): map penalty total 0.5 (id -30591) to PENALTY_AWARDED"
```

---

## What to monitor
- New `[etoto] Unmapped market` ids. The baseline is 1 (-30591) on 2026-11-06, and it should be 0 after Task 3.
- The skip counter for -30005/-30006: `skipped` == 4 × valid fixtures (`skipped_expected` in the raw-volume one-liner, where `fixtures` must equal the `isValidEvent` `valid` count at the time of the run). That was 80 for the 20 fixtures of 2026-11-06 and is 76 for 19 on 2026-11-07, and it falls as matches kick off. Only a mismatch against 4 × valid fixtures means etoto renamed or changed those markets.
- Whether the number of valid etoto league events (the `isValidEvent` command in Acceptance criteria) still equals the fixture count (22 − 2 = 20 on 2026-11-06).
- Collision warnings for etoto other than `PENALTY_AWARDED`: `grep 'marketKey collision' <clean log> | grep ' for etoto ' | grep -vc ' for etoto PENALTY_AWARDED '`. This is 0 today, and the target is 0. A `PENALTY_AWARDED` collision means etoto sent both id 15 and id -30591 (accepted, see Risks).
- `[etoto] Unmapped market … (id: -30591)` reappearing after Task 3 means etoto published a penalty line other than 0.5, or reused -30591 for a market whose name lacks the penalty-kick wording. The quoted name says which one.

## Self-review
- Spec coverage: the side axis is covered by Task 1 (shots) and Task 2 (fouls), and the penalty market under id -30591 by Task 3. The deliberate skips and the 22→20 event filter are documented as no-change.
- Types: `ETOTO_TEAM_LINE_PARAM_MARKETS` is defined in Task 1, and `normalizeCapture` is defined in Task 1 and reused in Tasks 2–3.
- Review Focus 1–5 are pinned in Tasks 1–3.
- `-t` filters were checked against vitest's case-sensitive matching: `fouls` selects only the two Task 2 tests, and `penalty|PENALTY_AWARDED|Rzut karny` selects only the four Task 3 tests.
- Golden diff counts (24/24, 18/18, cumulative 42/42, 0 other lines) were checked on a simulated rebless of the expected file.
- Decision D1 must match `betfan.md` Task 2.
