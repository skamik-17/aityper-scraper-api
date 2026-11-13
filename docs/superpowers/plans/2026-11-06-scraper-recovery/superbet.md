# Superbet — Health Check 2026-11-06 + Misroute/Coverage Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Superbet is healthy against the August baseline. This plan fixes four pre-existing defects that the health check found: a name pattern that sends any market whose team or player name contains "ou" into `TOTAL_GOALS`; the unmapped exact-goals family; `externalId: "undefined"` on every selection; and today's player-name format, which no fixture pins yet. An optional fifth task maps the player stat-line markets.

**Architecture:** Most of the work is in the normalizer: one regex, id-map entries, and two player-stat sets. The parser gets a one-line `externalId` fix, a type update, and, in the optional Task 5, one grouping set. No catalog change. A new focused Premier League golden fixture pins today's formats. The WC golden fixture gets no blessed change; this was verified offline with a patched copy of the normalizer.

**Tech Stack:** TypeScript (ESM, tsx), Vitest. Playwright is used only by the read-only smoke and harvest scripts.

**Spec:** the Observations section of this file. Evidence is in `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/superbet/`:
- `parsed-ars-hul-2026-11-06.json`: the full parsed capture of event 14438716. It is the input to the offline A/B.
- `exact-goals-1x2-raw-and-parsed-ars-hul-2026-11-06.json`: raw rows with `uuid`/`outcomeId`, plus the parsed exact-goals markets.
- `event-odds-sample-arsenal-hull-2026-11-06.json`: player stat-line raw rows.
- `db-bournemouth-total-goals-*.json`
- `unmapped-markets-run2-2026-11-06.txt`
- `unknown-excl-231194.txt`
- `discovery-*-2026-11-06.txt`
- `tools/exact_goals_check.py`, `tools/fetch_near_term.py`

The shared A/B tools are in `evidence/lvbet/tools/`.

## Observations (pre-fix analysis)

### Status today: HEALTHY. No bookmaker-side regression in volume or coverage, and 4 pre-existing defects

#### How it was measured

- Run-2 log (`440d2fc6`, 2026-11-06T16:00Z). Excerpt: `evidence/superbet/run2-log-lines.txt`. Run 3 (`de6129e8`) repeats run 2 almost exactly: 20 matches, 29,624 markets, 13,547 saved, 14,486 `Unmapped market` lines.
- DB rows (`market_comparison`, read-only PostgREST) and `GET /api/matches/<H>/<A>/normalized-markets?league=premier-league` for these matches:
  - near-term, full offer: Arsenal–Hull City, Leeds United–Tottenham Hotspur, Everton–Coventry City;
  - far-dated, small offer: Manchester City–Fulham.

  Stats: `evidence/superbet/db-stats-2026-11-06.txt`.
- **Offline A/B.** The CURRENT normalizer (HEAD `377b47e`) was run over two inputs:
  - (a) the August raw capture `aityper/docs/match-audit/.tmp/raw-r13-superbet/premier_league_arsenal_coventry_city.json` (2026-08-19);
  - (b) the live capture of event `14438716` (Arsenal–Hull City), taken today and parsed with the CURRENT parser. Durable copy: `evidence/superbet/parsed-ars-hul-2026-11-06.json`.

  The same code runs on both sides, so any difference comes from the bookmaker and not from our commits since August. Output: `evidence/superbet/offline-ab-summary.json`.

  Reproduce with: `node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/tools/offline-norm.ts docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/superbet/parsed-ars-hul-2026-11-06.json superbet Arsenal "Hull City" premier-league out.json`. It prints `{"markets":2610,"codes":185,...,"unknownPct":56.3,...,"warns":1400}`. Re-proven 2026-11-06.
- 1X2 and O/U sanity against the median of the other 9 bookmakers: `evidence/superbet/mw-1x2-sanity-2026-11-06.txt` and `ou-sanity-2026-11-06.txt`.

#### Measured numbers vs baseline

| Metric | August baseline | Today | Verdict |
|---|---|---|---|
| Events found / scraped (run 2) | 20/20 (Aug runs) | 20/20, 29,390 parsed markets, 13,353 saved | ok |
| Parsed markets per near-term match (log) | 2,445 raw markets Arsenal–Coventry (r13 bundle) | 2,378–2,813 (10 matches); far-dated 321–351 | ok |
| Arsenal match, parsed markets / selections | 2,445 / 4,544 | 2,610 / 4,585 (event `marketCount` 340) | ok |
| Catalog codes produced (offline A/B) | 169 | 185 (+16, **0 lost**) | ok |
| Codes in API per match | 164 (Aug API dump, Arsenal–Coventry) | 185 Ars–Hul, 186 Lee–Tot, 178 Eve–Cov (177 in DB stats), 84 MCI–FUL (far-dated) | ok |
| UNKNOWN share of selections (offline, bet-builder combos id 231194 excluded) | 48.7 % (2,021/4,149) | 51.7 % (2,143/4,145) | +3 pts. Ids 236222/238453 contribute 301 UNKNOWN today and 0 in the August capture. Computation: `evidence/superbet/unknown-excl-231194.txt` |
| UNKNOWN share, all selections (offline) | 53.2 % | 56.3 % | same structure as August |
| DB OTHER rows / all rows | n/a (the August OTHER bucket was collapsed) | 584/1,055 (Ars–Hul), 651/1,117 (Lee–Tot); league-wide 6,955/13,353 | structural, see below |
| UNKNOWN selections visible in API | 0 | 0 | ok (the grouper hides OTHER) |
| `[superbet] Unmapped market` warnings per run | n/a | 14,451 lines, 510 distinct (id, name). 13,434 (93 %) come from 12 player-stat ids | log noise, D2 / Task 5 |
| `externalId` on stored selections | n/a | `"undefined"` (string) on 4,562/4,562 selections (Ars–Hul), and on 60/60 superbet MATCH_WINNER selections in `/api/odds` | **defect D3** |
| 1X2 max abs deviation vs peer median (20 matches) | n/a | 12.5 % (Arsenal–Hull AWAY 14 vs 16); no axis swaps, no x10 shifts | ok |
| O/U 1.5/2.5/3.5 deviation vs peer median (3 matches) | n/a | within ±7.4 %; OVER/UNDER orientation correct | ok |
| Team-name merge | 20/20 | 20/20 current fixtures share their `matchId` with the other 9 bookmakers; 0 orphans, 0 duplicates. The 30 extra `match_id`s in the DB are past fixtures scraped 2026-08-21..24, which the API filters out | ok |
| `aityper/docs/audit-ledger/coverage.json` (bookmaker → code → selections; built 2026-07-09 from WC France–Morocco) | 173 codes | 186 codes across 3 PL matches. 17 coverage.json codes are absent: WC-only or match-specific markets (KICKOFF_TEAM, VAR_REVIEW, PLAYER_OF_THE_MATCH, CLEARANCES_TOTAL…), or codes that our own August commits removed or renamed (RED_CARDS_TOTAL, GOAL_RANGE; see below). The like-for-like PL A/B loses 0 codes | weak baseline (code churn), ok |
| Tests (unmodified tree, 2026-11-06) | — | `npx vitest run` 65 files / 1182 tests pass; `npx tsc --noEmit` exit 0; golden `superbet/world-cup-2026_france_morocco` entries=3701 blessed=559 failures=0 | ok |

Codes gained since August, all from new Superbet markets: AWAY_TEAM_GOAL_KICKS, AWAY_TEAM_TOTAL_THROW_INS, EACH_TEAM_TOTAL_THROW_INS_OVER, FIRST_GOAL_KICK, FIRST_OFFSIDE, GOAL_KICKS_TOTAL, HALF_TIME_FOULS_TOTAL, HALF_TIME_HOME_TEAM_FOULS_TOTAL, HALF_TIME_SHOTS_HANDICAP, HOME_TEAM_TOTAL_GOAL_KICKS, HOME_TEAM_TOTAL_THROW_INS, SHOTS_HANDICAP, SHOTS_ON_TARGET_HANDICAP, TACKLES_TOTAL, TEAM_TOTAL_TACKLES, THROW_INS_TOTAL.

Ten codes from the August API dump do not appear in today's three near-term matches: AWAY_CORNERS_RANGE, DRAW_OR_BTTS, GOAL_BY_MINUTE, GOAL_RANGE, HALF_TIME_AWAY_TEAM_CARDS, HOME_CORNERS_RANGE, NTH_CORNER, RED_CARDS_TOTAL, RESULT_AT_MINUTE, plus the old collapsed `OTHER`. All of them come from our own August commits, not from Superbet:
- RED_CARDS_TOTAL 0.5 is now aliased to RED_CARD (`superbet-normalizer.ts:1701-1716`).
- CORNERS ranges now go to CORNERS_TEAM_RANGE.
- Superbet id 200807 "Przedział goli" was rerouted GOAL_RANGE → MULTI_GOAL_RANGE by `58e7360` (2026-08-20 06:07). This was intentional: Superbet quotes a cumulative ladder, not a disjoint partition. GOAL_RANGE itself is still live, with 7 peers on Ars–Hul.
- The rest come from the display-merge commits `5ed0d73`, `5f71706`, `98a1403`.

The offline A/B confirms that no catalog code was lost.

### Bookmaker-side format changes since August (no impact today; pinned by Task 4)

| Change | August (r13 bundle, 2026-08-19) | Today (event 14438716) | Our code |
|---|---|---|---|
| Player names | `"Lastname, Firstname"`: 236216 208/208, 236218 259/259, 236226 48/48 with a comma (`Gyokeres, Viktor`, `Hamer, Gustavo - powyżej 0.5`) | `"Firstname Lastname"`: 0 commas in 172 / 209 / 41 selections (`Viktor Gyokeres`, `John Egan - powyżej 0.5`) | `canonicalizePlayerName` passes comma-less names through unchanged. Ars–Hul has 568 superbet player params: 531 shared with peers, 37 superbet-only (`player_orphans.py`). The comments at `superbet-normalizer.ts:1404` and `:1414` still describe the old format |
| `specialBetValue` on player stat lines | the threshold (`"0.5"`), as the comment at `parser.ts:346-358` says | `"sr:player:<id>-<Name>-<line>"` (`sr:player:100578-John Egan-0.5`) on 1,707 of 4,713 odds, all of them on 16 `Zawodnik - …` ids; a new structured `specifiers: {player_id, player_name, total}` | The 3 mapped stat-line ids (236218, 236224, 238465) group by player name (`parser.ts:428-429`), so nothing changes for them. The 12 unmapped ids now arrive as one raw market per (player, line) because of the generic `marketId_specialBetValue` key (`parser.ts:430-431`). They are OTHER today, but this matters for Task 5 |
| Selection identity | numeric `id` (`types.ts:13`) | no `id` field on any of 4,713 odds. Each odd has `uuid` and `marketUuid` (the uuid is stable across captures: 4,707/4,707 identical between 16:23Z and 17:08Z) and an `outcomeId`, which is **not** unique: 418 on every 236216 row, for every player and line | `externalId: String(sel.id)` → `"undefined"` (D3) |

### Root causes

**D1: the bare `o\/?u` alternative routes any name containing "ou" into `TOTAL_GOALS`. This predates August.**
- `superbet-normalizer.ts:571` is `{ pattern: /liczba goli|suma goli|over\/?under|o\/?u/, code: "TOTAL_GOALS" }`. Unmapped ids fall through to the name patterns at `:934-938`. The pattern runs on the lowercased, diacritic-folded name, so `o\/?u` matches the letters "ou" inside "B**ou**rnemouth", "T**ou**louse", "Tcha**ou**na" and "**Ou**nahi".
- The previous theory, that "AFC Bournemouth" fails to match "Bournemouth", is ruled out: `AFC Bournemouth będzie prowadzić…` also lands in `TOTAL_GOALS`, and `Arsenal będzie prowadzić…` lands in `OTHER`.
- The probe against the current normalizer (scratch `recovery/revise-superbet/probe.ts`, not durable) is reproduced as the Task 1 tests. Results:

| raw (id) | ctx | today |
|---|---|---|
| `Bournemouth będzie prowadzić w dowolnym momencie` (232515) | AFC Bournemouth / Nottingham Forest | `TOTAL_GOALS`, matchedBy `pattern`, UNKNOWN Tak 1.49 / Nie 2.42 |
| `Bournemouth strzeli co najmniej 2 gole z rzędu` (232507) | same | `TOTAL_GOALS:2`, Tak 2.27 / Nie 1.54 |
| `Bournemouth wygra wcześniej przegrywając` (232513) | same | `TOTAL_GOALS` |
| `Toulouse będzie prowadzić w dowolnym momencie` (no id) | Toulouse / Lyon, ligue-1 | `TOTAL_GOALS` |
| `Więcej asyst: Odegaard, Martin vs Tchaouna, Loum` (232370, August bundle) | Arsenal / Coventry City | `TOTAL_GOALS` |
| `Arsenal będzie prowadzić…` (232515), `Nottingham Forest będzie prowadzić…` (232516) | | `OTHER` (matchedBy `name`, warns) |

- Blast radius today: Bournemouth is the only PL team affected.
  - Ids 232507, 232508, 232513, 232515 and 232516 each have 19 run-2 `Unmapped market` lines (all teams except Bournemouth); 232514 has 16. In the last run there were 111 lines for these 6 ids, all from non-Bournemouth teams.
  - In both Bournemouth fixtures, `… będzie prowadzić…` and `… wygra wcześniej przegrywając` both resolve to the bare key `TOTAL_GOALS`. This causes the only 2 superbet `marketKey collision … superbet TOTAL_GOALS` warnings per run (6 in 3 runs), and `FullOfferRepo` keeps whichever came first. DB rows: `evidence/superbet/db-bournemouth-total-goals-*.json`.
  - The grouper drops them: `Ipswich Town vs AFC Bournemouth` in the API shows only superbet TOTAL_GOALS lines 0.5–6.5. Nothing reaches users today.
  - Ligue 1 (Toulouse) and player head-to-heads with "ou" names (WC fixture: 32 entries with Ounahi, El Khannouss, Kounde, Bouaddi, Ouahbi) reach the same branch. Most of them are rescued to OTHER only by the `isNonGoalsLineName` guard at `:1648`.
- No real goals market depends on the bare alternative. In today's Ars–Hul capture, 0 of 2,610 raw markets reach TOTAL_GOALS by pattern; every O/U goals line comes by id 200734. In the August capture, 1 of 2,445 does: the 232370 misroute.

**D2: Superbet's whole exact-goals family is unmapped, and was never mapped (`git log -G` finds no entry for 540/541/545/568/569).**
- These ids are not in `SUPERBET_MARKET_ID_TO_CODE`. The name guard at `:921-926` (`liczba goli` + `dokladna liczba`) forces them to OTHER and warns: 20 lines per id per run, 100 in total. Their twin 558 is mapped (`:152` → HALF_TIME_HOME_EXACT_GOALS, blessed in golden), so the mapping is lopsided.

| id | name (Ars–Hul) | selections (odds) | catalog code (selections) | peers on Ars–Hul |
|---|---|---|---|---|
| 541 | `Dokładna liczba goli` | 0 17, 1 6.3, 2 4.3, 3 4, 4 4.85, 5 7, 6+ 7.4 | EXACT_GOALS (`market-catalog.ts:3434`: 0…6+…9) | 8 |
| 540 | `Arsenal - dokładna liczba goli` | 0 9.5, 1 4.55, 2 3.55, 3+ 1.85 | HOME_EXACT_GOALS (`:3677`, has `3+`) | 7 |
| 545 | `Hull City - dokładna liczba goli` | 0 1.6, 1 2.87, 2 8.2, 3+ 26 | AWAY_EXACT_GOALS (`:3701`, has `3+`) | 8 |
| 568 | `1.połowa - dokładna liczba goli` | 0 3.85, 1 2.67, 2 3.55, 3+ 4.6 | HALF_TIME_EXACT_GOALS (`:3189`: 0,1,2,2+,3+) | 6 |
| 569 | `1.połowa - Hull City - dokładna liczba goli` | 0 1.2, 1 4.4, 2 21, 3+ 50 | HALF_TIME_AWAY_EXACT_GOALS (`:4757`: 0,1,2,3,3+) | 1 (fuksiarz) |
| 558 (mapped) | `1.połowa - Arsenal - dokładna liczba goli` | 0 3, 1 2.5, 2 3.75, 3+ 5.8 → `3` | HALF_TIME_HOME_EXACT_GOALS (`:5738`: 0,1,2,2+,3; **no `3+`**, hence the strip at `:1171-1179`) | 1 |

- All five catalog codes contain every Superbet selection literally, so the literal passthrough at `superbet-normalizer.ts:980-986` handles them. No selection case and no `+`-strip are needed; a patched copy proves this.
- The codes are not in `PARAMETERIZED_MARKETS`, so the `1.` in `1.połowa` never becomes a param.
- Peer top bands agree: betclic/betfan/etoto/forbet/sts all use `3+` for team exact goals, and fuksiarz uses `3+` for HT away.
- Against the peer median on Ars–Hul, Superbet's selections with a median below 10 are within 14.1 % (AWAY `2`: 8.2 vs 9.55). Long-shot tails differ more (AWAY `3+` 26 vs 45).

**D3: `externalId` is the string `"undefined"` (since the payload dropped `id`, at the latest by 2026-11-06).**
- `parser.ts:467` is `externalId: String(sel.id)`, and `types.ts:13` still declares `id: number`. Today `id` is absent, so every stored and served selection carries `"undefined"`.
- No consumer reads it today. The scraper side only declares the field (`src/types/full-offer.ts:24`, `src/services/normalization/types.ts:925`), and so does the frontend (`aityper/src/types/markets.ts:66`).
- lvbet shows the same symptom and is covered by `lvbet.md`.

**D4: the only golden fixture pins the old player format.** `superbet/world-cup-2026_france_morocco` (captured 2026-07-09) has only `Lastname, Firstname` names and threshold-only `specialBetValue`. Today's `First Last` shape and the new `specialBetValue` shape are unpinned, and the comments at `superbet-normalizer.ts:1404`, `:1414` and `parser.ts:346-358` are stale.

### Coverage backlog (not regressions)

1. **Player stat-line markets have been unmapped since at least July.**
   - **Twelve ids emit warnings.** They are listed exactly as in `unmapped-markets-run2-2026-11-06.txt`, with run-2 lines:

     | id | name | run-2 lines |
     |---|---|---|
     | 236222 | Zawodnik - liczba odbiorów | 1,823 |
     | 236216 | popełnionych fauli | 1,778 |
     | 238449 | fauli na zawodniku | 1,664 |
     | 236220 | celnych strzałów | 1,218 |
     | 238453 | odbiorów na zawodniku | 1,177 |
     | 238485 | strzałów spoza pola karnego | 1,012 |
     | 238477 | strzałów prawą nogą | 1,012 |
     | 238473 | strzałów lewą nogą | 965 |
     | 238461 | celnych strzałów prawą nogą | 781 |
     | 238457 | celnych strzałów lewą nogą | 685 |
     | 239621 | asyst | 672 |
     | 238469 | celnych strzałów spoza pola karnego | 647 |
     | **Total** | | **13,434** |
   - `238481` "liczba strzałów głową" is a separate case. It is explicitly OTHER by id (`superbet-normalizer.ts:427`, no catalog code) and never warns.
   - `236222` and `238453` existed in July: the WC golden fixture has 208 and 176 entries for them. They were absent from the August PL capture and are present again now. They are not new products.
   - In the golden fixture (unblessed, so not asserted), all twelve are OTHER.
   - Catalog codes exist for 7 of the 12 ids. Mapping them needs four touchpoints, which is Task 5 (optional). A bare id-map entry would make every player collide on one key: proven offline, `PLAYER_FOULS` with UNKNOWN selections for both John Egan and Viktor Gyokeres.
2. `200685` "Każda z drużyn powyżej X rzutów rożnych" (68 lines per run) → EACH_TEAM_TOTAL_CORNERS_OVER. Its rows arrive one per line (`Powyżej 0.5 - tak` 1.04 … `Powyżej 5.5 - tak` 7.5), so it needs the `EACH_TEAM_OVER_MARKET_IDS` / `EACH_TEAM_OVER_ONLY_MARKETS` handling. Not planned here; see open question 3.
3. **Abbreviated player labels (fuksiarz grouper tie-break).** Superbet sends full names, and in some player params the label shows the initial form ("O. Zambrano"). Measured with `python3 -I evidence/lvbet/tools/player_orphans.py <normalized-markets.json> superbet`: 76 abbreviated-initial params that include superbet on Ars–Hul, and 15 on Lee–Tot. The 101/86 figures in `fuksiarz.md` count all bookmakers. The cause and the fix are in `fuksiarz.md`; Superbet's own data is correct.
4. 56 % of Superbet selections are OTHER/UNKNOWN by construction. The two sources are bet-builder combos (id `231194`, mapped to OTHER on purpose at `superbet-normalizer.ts:221-229`) and the player stat lines above. The August share was the same, so this number does not indicate degradation.

### What still works and must not break

- Event discovery (20/20), offer sizes, 1X2/O/U sanity, team-name merge.
- Every O/U goals line arrives by id 200734 (not by pattern), so D1's regex change cannot touch it. The name-based `O/U 2.5` / `Over/Under 2.5` still resolve to `TOTAL_GOALS:2.5` (Review Focus 2).
- 558 → HALF_TIME_HOME_EXACT_GOALS with `3+` → `3` (blessed golden entry).
- Per-player grouping for 236218/236224/238465, `PLAYER_SHOTS:John Egan` 1+ 2.12 / 2+ 6 / 3+ 17. 231194 → OTHER.
- Golden WC fixture: 0 blessed changes from Tasks 1, 2 and 5. Verified offline with a patched copy: 42 unblessed entries change.
  - 5 exact-goals entries: OTHER → codes.
  - 5 entries for 232507/08/13/15/16: OTHER `name` → OTHER `id`.
  - 32 "ou"-name entries: OTHER `pattern` → OTHER `name`.

### Impact

- **Parser:** Task 3 (`externalId`, types), Task 4 (comment), Task 5 (`PLAYER_STAT_LINE_MARKET_IDS`).
- **Normalizer:** Tasks 1, 2 and 5, plus the Task 4 comments.
- **Catalog:** none, so no `sync-market-types.ts`.
- **Golden:**
  - WC fixture: 0 blessed changes.
  - New focused PL fixture (Task 4).
- **Offline A/B on `parsed-ars-hul-2026-11-06.json` after Tasks 1+2:**
  - codes 185 → 190 (+5 exact-goals, 0 lost);
  - warns 1,400 → 1,391;
  - on the August bundle, 169 → 174, and `232370` moves TOTAL_GOALS → OTHER.
- **Audit knowledge:** `coverage.json` superbet gains the 5 exact-goals codes (+7 player codes with Task 5).
- **Frontend:** no change. The exact-goals codes already render for peers.

### Risks & unknowns

- `\bo\/u\b` stops matching a bare `ou` token such as `OU 2.5`. No Superbet name in either capture uses it.
- After Task 1, the "ou"-name head-to-heads that the guard used to swallow silently start emitting `Unmapped market` warnings. That is 32 in the WC fixture and 0 on today's Ars–Hul capture.
- HALF_TIME_AWAY_EXACT_GOALS has a single peer, so it offers little comparison value, but the data is correct.
- `uuid` stability over days is unknown; it was stable over 45 min. `outcomeId` must not be used as `externalId`: it is an outcome-type id shared across rows.
- Task 5 has three known issues:
  - PLAYER_ASSISTS lines up to 2.5 produce `3+` (Gyokeres 29), but the catalog lists `YES, NO, 1+, 2+`.
  - PLAYER_SHOTS_OUTSIDE_BOX is `hasParameter: false` in the catalog (`market-catalog.ts:1997`), even though fortuna already keys it by player.
  - 238453 "odbiory na zawodniku" (tackles suffered) has no catalog code.

### Open questions for the owner

1. Should the 5 WC golden exact-goals entries (indexes 2740, 2741, 2742, 2788, 2790; unblessed) be blessed? Default: no. The Task 4 PL fixture pins the family.
2. Should Task 5 run? If it does, should 238485 go to PLAYER_SHOTS_OUTSIDE_BOX (catalog says no parameter), and should PLAYER_ASSISTS `3+` be kept? Default: run it, map 238485, and keep `3+` (the same behaviour as PLAYER_SHOTS).
3. Should 200685 → EACH_TEAM_TOTAL_CORNERS_OVER be a follow-up? Default: backlog.

### Acceptance criteria

1. **Unit and golden:** `npx tsc --noEmit` exits 0 and `npx vitest run` is green. `npx vitest run src/services/normalization/__tests__/golden.test.ts -t superbet` prints `failures=0` for `world-cup-2026_france_morocco` (blessed=559) and for the new `premier-league_*` fixture.
2. **Offline A/B (pre-merge).** Run `offline-norm.ts` on `evidence/superbet/parsed-ars-hul-2026-11-06.json` before Task 1 (`before.json`) and after Task 2 (`after.json`). Then `python3 -I -c "import json;a=set(json.load(open('before.json'))['codes']);b=set(json.load(open('after.json'))['codes']);print('lost',sorted(a-b),'gained',sorted(b-a))"` prints `lost [] gained ['AWAY_EXACT_GOALS', 'EXACT_GOALS', 'HALF_TIME_AWAY_EXACT_GOALS', 'HALF_TIME_EXACT_GOALS', 'HOME_EXACT_GOALS']`, and the printed `codes` goes 185 → 190. UNKNOWN share excluding 231194, using the command in `unknown-excl-231194.txt`: ≤ 51.7 % (it falls after Task 2).
3. **Live, last run only.** After the next scheduled run, use a fresh clean log `LOG` and set `START=$(grep -n 'Starting run' $LOG | tail -1 | cut -d: -f1)`. Each value below was dry-run on run 3:
   - `tail -n +$START $LOG | grep -c 'marketKey collision.*for superbet TOTAL_GOALS'` = 0 (today 2).
   - `tail -n +$START $LOG | grep -cE '^\[superbet\] Unmapped market .*\(id: (232507|232508|232513|232514|232515|232516)\)$'` = 0 (today 111).
   - The same grep with `(540|541|545|568|569)` = 0 (today 100).
   - `[Superbet/FullOffer] Completed: N matches` with N ≥ the number of PL fixtures the other bookmakers list (today 20).
   - `python3 -I evidence/superbet/tools/fetch_near_term.py <dir> && python3 -I evidence/superbet/tools/exact_goals_check.py <dir>/*.json` prints `RESULT PASS files=<n>` with n ≥ 1. That means superbet is present in all 5 exact-goals codes on every match kicking off within 72 h, and is within 20 % of the peer median wherever that median is below 10. Today it prints `RESULT FAIL (50)`. With no file arguments (no PL fixture within 72 h) the tool exits 1 with a usage line instead of passing.
   - `/api/odds` superbet MATCH_WINNER `externalId == "undefined"`: 0 of 60 (today 60/60). Command in Task 3 Step 6.
4. **Single-bookmaker live smoke (standalone, read-only, no DB writes).** Command shape proven on the current code on 2026-11-06 17:34Z; output in `evidence/superbet/discovery-smoke-derived-url-2026-11-06.txt`:

```bash
set -o pipefail
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api
IFS=$'\t' read -r SB_URL SB_HOME SB_AWAY < <(curl -s --compressed 'http://localhost:3001/api/odds?league=premier-league' | python3 -I -c "
import json,sys,datetime as dt
cut=dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=2)
m=[x for x in json.load(sys.stdin)['data']['matches'] if 'superbet' in x['markets']['MATCH_WINNER']['bookmakerOdds'] and dt.datetime.fromisoformat(x['startTime'])>cut]
x=min(m,key=lambda x:x['startTime'])
print(x['markets']['MATCH_WINNER']['bookmakerOdds']['superbet']['eventUrl'],x['homeTeam'],x['awayTeam'],sep='\t')")
SMOKE=${TMPDIR:-/tmp}/superbet-smoke.txt
timeout 300 npx tsx scripts/superbet-market-discovery.ts --url "$SB_URL" --home "$SB_HOME" --away "$SB_AWAY" \
  --league premier-league --market "liczba goli" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' > "$SMOKE"; echo "exit=$?"
sed -n '/SUMMARY/,/With issues/p' "$SMOKE"
grep -cE '^Liczba goli +→ TOTAL_GOALS +PARAMETER_SLIDER' "$SMOKE"
grep -cE '→ (EXACT_GOALS|HOME_EXACT_GOALS|AWAY_EXACT_GOALS|HALF_TIME_EXACT_GOALS|HALF_TIME_AWAY_EXACT_GOALS) ' "$SMOKE"
sed -n '/UNMAPPED MARKETS/,$p' "$SMOKE" | grep -ci 'dokładna liczba goli'
```

   The URL is derived from the earliest superbet fixture that kicks off more than 2 h from now, so the command does not go stale. `--home`/`--away` make the match lookup independent of the numeric slug (`scrapeOneMatchFullOffer`, `src/services/audit/scraper-audit-core.ts:98-165`).

   The BrowserPool keeps Chromium alive, so the process runs until `timeout` ends it. With `pipefail` that prints `exit=124`; it took the full 300 s in the proof run. `exit=124` alone proves nothing, because a run that found no match also idles until the timeout. Judge the run by its output:
   - **Pass:** `SUMMARY` printed, `Total markets` ≥ 100, the TOTAL_GOALS row count ≥ 6, and `Mapped` ≥ 75. Before the fixes, also: the exact-goals row count = 0 and the unmapped `dokładna liczba goli` count = 5. After Task 2: 5 and 0.
   - **Today (Everton–Coventry City):** `exit=124`; 110 / 79 / 31; 7 TOTAL_GOALS rows; 0 exact-goals rows; 5 unmapped exact-goals rows.
   - **Fail:** an empty `SUMMARY` or any other exit code.

## Global Constraints

- Commit messages are concise and descriptive. **No signature or attribution footers** (no "Generated with…", no "Co-Authored-By"). The owner's rule overrides any tool reminder.
- Code and comments are in English only. UI copy is untouched.
- Work on a branch from `master` (`git switch -c fix/superbet-normalizer-2026-11`). Commit only after the owner has approved executing this plan.
- Before **each** commit, both of these must be green: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` (exit 0) and `npx vitest run`. The baseline is 65 files / 1182 tests.
- Golden-fixture discipline: write the failing unit test first. Rebless only via `npx tsx scripts/rebless-golden.ts --bookmaker superbet --dry`, and only if its list of changed blessed entries matches the one the task states (here it is always empty). Never hand-edit `.expected.json`.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan does not change it.
- Editing anything under `src/` restarts the running dev server (`tsx watch`). Coordinate with whoever runs the live service before saving source files.
- The bookmaker key `superbet` and the API response shapes stay unchanged. No new catalog codes.
- Live traffic stays modest: one smoke or prep run per verification step.

## Review Focus

1. **Team or player names that contain "ou"** (Bournemouth, Toulouse, Tchaouna) must never resolve to `TOTAL_GOALS`. This is pinned in Task 1 by tests (a), (b), (c), (d) and (f).
2. **Genuine `O/U 2.5` / `Over/Under 2.5` names** must stay `TOTAL_GOALS:2.5` with OVER/UNDER. Pinned in Task 1 by test (e).
3. **`3+` vs `3` top bands on exact goals.** 558 keeps `3` (its catalog has no `3+`); 540/545/568/569 keep `3+`; 541 keeps `6+`. The `1.` of `1.połowa` must never become a `paramValue`. Pinned in Task 2.
4. **Selections without an `id` field.** `externalId` must be the `uuid`, or `undefined`, never the string `"undefined"`. Legacy `id` payloads still work. Pinned in Task 3.
5. **`First Last` player names and the `sr:player:<id>-<Name>-<line>` `specialBetValue`.** The player stays the param or selection with no comma inversion, and one raw market per player. Pinned in Task 4, plus Task 5 for the newly grouped ids.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/services/normalization/bookmakers/superbet-normalizer.ts` | Modify | `:571` pattern (T1); id map: after `:152` (T2), after `:229` (T1), after `:427` (T5); `PLAYER_STAT_PARAM_MARKETS` `:709-716` and the case list `:1423-1428` (T5); comments `:1404`, `:1414` (T4) |
| `src/scrapers/bookmakers/superbet/types.ts` | Modify | `SuperbetOddsSelection` `:11-28` (T3) |
| `src/scrapers/bookmakers/superbet/parser.ts` | Modify | `:467` externalId (T3); comment `:346-358` (T4); `PLAYER_STAT_LINE_MARKET_IDS` `:360-364` (T5) |
| `src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts` | Create | Tests for T1, T2, T4 and T5. Uses the `forbet-audit-fixes.test.ts` pattern (`run(raw, ctx)` helper that throws on `null`) |
| `src/scrapers/bookmakers/superbet/__tests__/parser.test.ts` | Modify | T3 and T5 parser tests |
| `src/scrapers/bookmakers/superbet/__tests__/fixtures/event-14438716-odds-sample.json` | Create (copy) | Copy of `evidence/superbet/event-odds-sample-arsenal-hull-2026-11-06.json` (T5) |
| `src/services/normalization/__fixtures__/superbet/premier-league_<home>_<away>.json` + `.expected.json` | Create (harvest) | T4 |

All odds in the tests below are copied from `evidence/superbet/exact-goals-1x2-raw-and-parsed-ars-hul-2026-11-06.json`, `event-odds-sample-arsenal-hull-2026-11-06.json` and `db-bournemouth-total-goals-*.json`.

---

### Task 1: Names containing "ou" never become TOTAL_GOALS

**Files:**
- Modify: `src/services/normalization/bookmakers/superbet-normalizer.ts:571`, and the id map after `:229`
- Test: `src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts` (create)

**Interfaces:**
- Consumes: `superbetNormalizer.normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null`.
- Produces: the pattern `/liczba goli|suma goli|over\/?under|\bo\/u\b/`, and id-map entries `232507`, `232508`, `232513`, `232514`, `232515`, `232516` → `"OTHER"`, each commented `// "{team} …" - no catalog counterpart`. The names, in order: strzeli co najmniej 2 gole z rzędu (home/away), wygra wcześniej przegrywając (home/away), będzie prowadzić w dowolnym momencie (home/away).

- [ ] **Step 1: Write the failing tests.** `bou = { homeTeam: "AFC Bournemouth", awayTeam: "Nottingham Forest", league: "premier-league" }`; selections `Tak`/`Nie` with the odds shown.

| test | raw | ctx | assertions |
|---|---|---|---|
| (a) `232515 Bournemouth leader market is OTHER by id` | id `232515`, `Bournemouth będzie prowadzić w dowolnym momencie`, Tak 1.49 / Nie 2.42 | bou | `marketCode` `"OTHER"`, `marketKey` `"OTHER"`, `debug.matchedBy` `"id"` |
| (b) `232507 Bournemouth 2-in-a-row is OTHER, not TOTAL_GOALS:2` | id `232507`, `Bournemouth strzeli co najmniej 2 gole z rzędu`, Tak 2.27 / Nie 1.54 | bou | `marketKey` `"OTHER"`, `paramValue` undefined |
| (c) `232513 Bournemouth comeback is OTHER` | id `232513`, `Bournemouth wygra wcześniej przegrywając`, Tak 8.6 / Nie 1.04 | bou | `marketCode` `"OTHER"` |
| (d) `Toulouse leader market without id is OTHER` | no id, `Toulouse będzie prowadzić w dowolnym momencie`, Tak 1.5 / Nie 2.4 | Toulouse / Lyon, `ligue-1` | `marketCode` `"OTHER"`, `debug.matchedBy` `"name"` |
| (e) `genuine O/U names stay TOTAL_GOALS` | no id, `O/U 2.5` and `Over/Under 2.5`, `Powyżej 2.5` 1.8 / `Poniżej 2.5` 2.0 | Arsenal / Hull City | `marketKey` `"TOTAL_GOALS:2.5"`, codes `["OVER","UNDER"]` |
| (f) `player head-to-head with "ou" name is OTHER` | id `232370`, `Więcej asyst: Odegaard, Martin vs Tchaouna, Loum`, `Odegaard, Martin` 1.5 / `Tchaouna, Loum` 2.5 | Arsenal / Coventry City | `marketCode` `"OTHER"` |

- [ ] **Step 2: Run and confirm failure.**
Run: `npx vitest run src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts`
Expected: FAIL. (a), (c), (d) and (f) give `expected 'TOTAL_GOALS' to be 'OTHER'`; (b) gives `expected 'TOTAL_GOALS:2' to be 'OTHER'`; (e) passes.

- [ ] **Step 3: Implement** the regex change and the six id-map entries.

- [ ] **Step 4: Run tests and the golden dry run.**
Run: `npx vitest run src/services/normalization && npx tsx scripts/rebless-golden.ts --bookmaker superbet --dry`
Expected: PASS. The dry rebless lists 0 changed blessed entries. Golden `-t superbet` shows `failures=0`.

- [ ] **Step 5: Commit**
```bash
git add src/services/normalization/bookmakers/superbet-normalizer.ts src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts
git commit -m "fix(superbet): stop names containing 'ou' from routing to TOTAL_GOALS"
```

### Task 2: Map the exact-goals family

**Files:**
- Modify: the id map in `superbet-normalizer.ts`, next to `:152`
- Test: the same file as Task 1

**Interfaces:**
- Produces: `541: "EXACT_GOALS"`, `540: "HOME_EXACT_GOALS"`, `545: "AWAY_EXACT_GOALS"`, `568: "HALF_TIME_EXACT_GOALS"`, `569: "HALF_TIME_AWAY_EXACT_GOALS"`, each with its raw-name comment. No selection-code change: the literal passthrough at `:980-986` already returns the raw band. If a test shows otherwise, add the code to the `:1171` case, not a new one.

- [ ] **Step 1: Write the failing table test** `it.each(...)("exact goals: id %s maps to %s")`. ctx is Arsenal / Hull City / `premier-league`.

| id | name | selections (name odds) | marketCode | codes |
|---|---|---|---|---|
| `541` | `Dokładna liczba goli` | 0 17, 1 6.3, 2 4.3, 3 4, 4 4.85, 5 7, 6+ 7.4 | EXACT_GOALS | `["0","1","2","3","4","5","6+"]` |
| `540` | `Arsenal - dokładna liczba goli` | 0 9.5, 1 4.55, 2 3.55, 3+ 1.85 | HOME_EXACT_GOALS | `["0","1","2","3+"]` |
| `545` | `Hull City - dokładna liczba goli` | 0 1.6, 1 2.87, 2 8.2, 3+ 26 | AWAY_EXACT_GOALS | `["0","1","2","3+"]` |
| `568` | `1.połowa - dokładna liczba goli` | 0 3.85, 1 2.67, 2 3.55, 3+ 4.6 | HALF_TIME_EXACT_GOALS | `["0","1","2","3+"]` |
| `569` | `1.połowa - Hull City - dokładna liczba goli` | 0 1.2, 1 4.4, 2 21, 3+ 50 | HALF_TIME_AWAY_EXACT_GOALS | `["0","1","2","3+"]` |
| `558` (regression) | `1.połowa - Arsenal - dokładna liczba goli` | 0 3, 1 2.5, 2 3.75, 3+ 5.8 | HALF_TIME_HOME_EXACT_GOALS | `["0","1","2","3"]` |

Every row also asserts: `marketKey === marketCode`, `paramValue` undefined, `debug.matchedBy === "id"`, and odds unchanged.

- [ ] **Step 2: Run and confirm failure.**
Run: `npx vitest run src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts -t exact`
Expected: FAIL. The first five give `expected 'OTHER' to be 'EXACT_GOALS'` (and so on); 558 passes.

- [ ] **Step 3: Implement** the five id-map entries.

- [ ] **Step 4: Run tests, the golden dry run and the offline A/B.**
Run: `npx vitest run src/services/normalization && npx tsx scripts/rebless-golden.ts --bookmaker superbet --dry`
Expected: PASS, with 0 blessed changes. Unblessed WC entries 2740, 2741, 2742, 2788 and 2790 change OTHER → the codes above; they stay unblessed (open question 1). Then run Acceptance criterion 2 and expect `lost []` and the five gained codes.

- [ ] **Step 5: Commit**
```bash
git add src/services/normalization/bookmakers/superbet-normalizer.ts src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts
git commit -m "feat(superbet): map exact-goals markets 540/541/545/568/569"
```

### Task 3: Real `externalId` from the selection uuid

**Files:**
- Modify: `src/scrapers/bookmakers/superbet/types.ts:11-28`, `src/scrapers/bookmakers/superbet/parser.ts:467`
- Test: `src/scrapers/bookmakers/superbet/__tests__/parser.test.ts`

**Interfaces:**
- Produces: in `SuperbetOddsSelection`, `id?: number` (legacy, optional), `uuid?: string`, `marketUuid?: string` and `outcomeId?: number`, the last documented as "outcome-type id, shared across lines and players, NOT unique". The parser uses `externalId: sel.uuid ?? (sel.id != null ? String(sel.id) : undefined)`. `outcomeId` is deliberately not a fallback.

- [ ] **Step 1: Write the failing test.** Add `describe("parseAllMarkets - selection externalId")`. Event: `{ eventId: 14438716, matchName: "Arsenal·Hull City", tournamentId: 0, sportId: 5, odds }`, where `odds` is:
  - `{ uuid: "3b3179ac-c756-573c-8cd2-fdc0d5f5d00b", outcomeId: 1470, marketId: 547, code: "1", name: "1", price: 1.17, status: "active" }`
  - `{ uuid: "49ac60ac-1c1c-57e0-ae08-4b42023d1615", outcomeId: 1471, marketId: 547, code: "0", name: "X", price: 7.5, status: "active" }`
  - `{ marketId: 547, code: "2", name: "2", price: 14, status: "active" }`

  Assertions:
  - The externalIds of the single market equal `["3b3179ac-c756-573c-8cd2-fdc0d5f5d00b", "49ac60ac-1c1c-57e0-ae08-4b42023d1615", undefined]`.
  - No selection has `externalId === "undefined"`.
  - A legacy event `{ id: 1, marketId: 547, code: "1", name: "Lech Poznan", price: 2.1 }` still gives `"1"`.

- [ ] **Step 2: Run and confirm failure.**
Run: `npx vitest run src/scrapers/bookmakers/superbet`
Expected: FAIL with `expected 'undefined' to be '3b3179ac-c756-573c-8cd2-fdc0d5f5d00b'`.

- [ ] **Step 3: Implement** the type fields and the parser line.

- [ ] **Step 4: Run tests.**
Run: `npx vitest run src/scrapers/bookmakers/superbet && npx tsc --noEmit`
Expected: PASS (the 2 existing tests plus the new ones), and tsc exits 0. `parser.ts:467` is the only reader of `sel.id`.

- [ ] **Step 5: Commit**
```bash
git add src/scrapers/bookmakers/superbet/types.ts src/scrapers/bookmakers/superbet/parser.ts src/scrapers/bookmakers/superbet/__tests__/parser.test.ts
git commit -m "fix(superbet): use selection uuid as externalId"
```

- [ ] **Step 6 (after the next scheduled run): live check.**
`curl -s --compressed 'http://localhost:3001/api/odds?league=premier-league' | python3 -I -c "import json,sys;m=json.load(sys.stdin)['data']['matches'];e=[s.get('externalId') for x in m for s in x['markets']['MATCH_WINNER']['bookmakerOdds'].get('superbet',{}).get('selections',[])];print(len(e), sum(v=='undefined' for v in e))"`
Expected: `60 0`. Today it prints `60 60`.

### Task 4: Pin today's player formats (characterization tests, a PL golden fixture, refreshed comments)

**Files:**
- Modify: comments at `superbet-normalizer.ts:1404` and `:1414` ("Superbet switched to `First Last` between 2026-08-19 and 2026-11-06; `Last, First` is still accepted"), and `parser.ts:346-358` (`specialBetValue` is now `sr:player:<id>-<Name>-<line>`, one value per player-line row)
- Test: the same file as Task 1
- Create (harvest): `src/services/normalization/__fixtures__/superbet/premier-league_<home>_<away>.{json,expected.json}`

**Interfaces:**
- Consumes: Tasks 1 and 2 (harvest after them, so the fixture blesses the fixed outputs). `scripts/superbet-prep-audit.ts` and `scripts/harvest-fixtures.ts` as they are today.

- [ ] **Step 1: Write the characterization tests.** ctx is Arsenal / Hull City / `premier-league`. Expected: PASS on the current code, because these pin today's format.
  - `236218 First-Last stat line keys the player`: `{ bookmakerMarketId: "236218", name: "Zawodnik - liczba strzałów", selections: John Egan - powyżej 0.5 2.12 / 1.5 6 / 2.5 17 }` → `marketKey` `"PLAYER_SHOTS:John Egan"`, codes `["1+","2+","3+"]`.
  - `236226 First-Last goalscorer stays verbatim`: `Viktor Gyokeres` 1.78, `Kai Havertz` 2 → codes `["Viktor Gyokeres","Kai Havertz"]`.
  - `233484 First-Last pair becomes combo form`: `Christos Tzolis lub Kai Havertz` 1.45 → code `"C. Tzolis & K. Havertz"`.
  - `547 Mecz` with `Arsenal` 1.17 / `Remis` 7.5 / `Hull City` 14 → `["HOME","DRAW","AWAY"]`.

- [ ] **Step 2: Capture and harvest a near-term PL fixture.** Derive `SB_URL`/`SB_HOME`/`SB_AWAY` as in the Acceptance smoke. Then:
```bash
ARCH=${TMPDIR:-/tmp}/premier-league_<home>_<away>__$(date -u +%F).json   # team names lowercased, spaces -> '-'
timeout 300 npx tsx scripts/superbet-prep-audit.ts --url "$SB_URL" --league premier-league --home "$SB_HOME" --away "$SB_AWAY" --out "$ARCH"
npx tsx scripts/harvest-fixtures.ts --archive "$ARCH" --bookmaker superbet \
  --out-dir src/services/normalization/__fixtures__ \
  --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json \
  --bless "Mecz" --bless "Liczba goli" --bless "Zawodnik - strzeli gola" --bless "Zawodnik - liczba strzałów" \
  --bless "Którykolwiek z zawodników strzeli gola" --bless "Dokładna liczba goli" --bless "- dokładna liczba goli"
```
  The script defaults (`backend/…`) are stale after the repo split, so `--out-dir` and `--registry` are mandatory. The `--bless` names match exactly first. `"- dokładna liczba goli"` falls back to a substring match and picks up 540/545/558/568/569.

  Expected: stderr shows `NOTE: fixture pair did not exist yet — writing only the N selected entries`, and stdout JSON has `blessed == entries`. On Ars–Hul, N would be 1 + 8 + 1 + 41 + 1 + 6 = 58.

- [ ] **Step 3: Inspect the fixture.** In `.expected.json`:
  - every `GOALSCORER_ANYTIME` selection code has no comma;
  - every `PLAYER_SHOTS` key is `PLAYER_SHOTS:<First Last>`;
  - the 5 exact-goals codes from Task 2 and `HALF_TIME_HOME_EXACT_GOALS` are present;
  - `TOTAL_GOALS:<line>` entries have `OVER`/`UNDER`.

  Run `npx vitest run src/services/normalization/__tests__/golden.test.ts -t superbet`. Expected: two `failures=0` lines.

- [ ] **Step 4: Update the three comments.**

- [ ] **Step 5: Commit**
```bash
git add src/services/normalization/__fixtures__/superbet/premier-league_* src/services/normalization/bookmakers/superbet-normalizer.ts src/scrapers/bookmakers/superbet/parser.ts src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts
git commit -m "test(superbet): pin First-Last player names and sr:player stat lines"
```

### Task 5 (optional, open question 2): Map player stat-line markets

**Files:**
- Modify: `parser.ts:360-364` (`PLAYER_STAT_LINE_MARKET_IDS`), `superbet-normalizer.ts` id map after `:427`, `PLAYER_STAT_PARAM_MARKETS` `:709-716`, and the selection case list `:1423-1428`
- Create: `src/scrapers/bookmakers/superbet/__tests__/fixtures/event-14438716-odds-sample.json` (copy of `evidence/superbet/event-odds-sample-arsenal-hull-2026-11-06.json`)
- Test: `parser.test.ts`, and the same file as Task 1

**Interfaces:**
- Produces:
  - id map: `236216: "PLAYER_FOULS"`, `238449: "PLAYER_FOULS_WON"`, `236220: "PLAYER_SHOTS_ON_TARGET"`, `236222: "PLAYER_TACKLES"`, `238485: "PLAYER_SHOTS_OUTSIDE_BOX"`, `238469: "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX"`, `239621: "PLAYER_ASSISTS"`. These get no catalog counterpart and map to `"OTHER"`: `238453` (tackles suffered), `238477`/`238473` (shots right/left foot), `238461`/`238457` (shots on target right/left foot).
  - `PLAYER_STAT_LINE_MARKET_IDS` gains the 7 mapped ids. The 5 OTHER ids are left out on purpose: grouping is irrelevant for OTHER.
  - `PLAYER_STAT_PARAM_MARKETS` and the `:1423` case list gain `PLAYER_FOULS`, `PLAYER_FOULS_WON`, `PLAYER_TACKLES`, `PLAYER_SHOTS_OUTSIDE_BOX` and `PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX`. PLAYER_SHOTS_ON_TARGET and PLAYER_ASSISTS are already there.

- [ ] **Step 1: Write the failing tests.** All of them use `parseAllMarkets({ eventId: 14438716, matchName: "Arsenal·Hull City", tournamentId: 0, sportId: 5, odds: sample.oddsSample })`.
  - Parser test `player stat lines group one raw market per player`: the count of raw markets per `bookmakerMarketId` equals `{ "236216": 2, "236222": 2, "239621": 2, "238453": 5, "200685": 6 }`. Today it is `{ "236216": 8, "236222": 8, "239621": 4, "238453": 5, "200685": 6 }`.
  - Normalizer test, parse then normalize:
    - `PLAYER_FOULS:John Egan` → `["1+@1.36","2+@2.7","3+@5.75","4+@13"]`;
    - `PLAYER_FOULS:Viktor Gyokeres` → `["1+@1.33","2+@2.55","3+@5.4","4+@12"]`;
    - `PLAYER_TACKLES:John Egan` → `["1+@1.13","2+@1.77","3+@3.2","4+@5.5","5+@11"]`;
    - `PLAYER_ASSISTS:Viktor Gyokeres` → `["1+@4.1","2+@17","3+@29"]`;
    - every 238453 market is `OTHER` with `matchedBy` `"id"`.

- [ ] **Step 2: Run and confirm failure.**
Run: `npx vitest run src/scrapers/bookmakers/superbet src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts`
Expected: FAIL. The counts differ (8 vs 2), and the keys are `OTHER`.

- [ ] **Step 3: Implement** the four touchpoints. An id-map entry alone is not enough: it was proven offline to give `PLAYER_FOULS` with UNKNOWN selections for both players.

- [ ] **Step 4: Run tests and the golden dry run.**
Run: `npx vitest run && npx tsx scripts/rebless-golden.ts --bookmaker superbet --dry`
Expected: PASS, with 0 blessed changes (all WC entries for these ids are unblessed).

- [ ] **Step 5: Commit**
```bash
git add src/scrapers/bookmakers/superbet src/services/normalization/bookmakers/superbet-normalizer.ts src/services/normalization/bookmakers/__tests__/superbet-audit-fixes.test.ts
git commit -m "feat(superbet): map player fouls, tackles, assists and shot stat lines"
```

## After the tasks: live verification (no code)

1. Run the Acceptance smoke (criterion 4). After Task 2, the exact-goals row count must be 5 and the unmapped count 0.
2. After the next scheduled run, check criterion 3 (log greps, `fetch_near_term.py` + `exact_goals_check.py`, Task 3 Step 6).
3. If Task 5 ran: `tail -n +$START $LOG | grep -c '^\[superbet\] Unmapped market'` must drop by at least 13,000 (today 14,486 in run 3). There must be no `marketKey collision … superbet PLAYER_` lines.

## What to monitor

| Signal | How | Alert threshold |
|---|---|---|
| Events per run | log `[Superbet/FullOffer] Found N events` / `Completed: N matches` | < number of PL fixtures listed by the other bookmakers |
| Near-term offer size | `[Superbet/FullOffer] A vs B: N markets` | median of near-term matches < 2,000 (today 2,378–2,813) |
| Codes per near-term match | `normalized-markets` → count distinct `type` with a superbet entry | < 165 (today 177–186: Ars–Hul 185, Lee–Tot 186, Eve–Cov 178 API / 177 DB); +5 after Task 2 |
| UNKNOWN share excluding 231194 | `offline-norm.ts` on a fresh parsed capture → `out.json`, then the one-liner in `evidence/superbet/unknown-excl-231194.txt` | > 55 % (today 51.7) |
| New unmapped ids | `grep '^\[superbet\] Unmapped market' log` → distinct ids not in `evidence/superbet/unmapped-markets-run2-2026-11-06.txt` | any new id with more than 20 lines per run |
| Superbet collisions | `grep -c 'marketKey collision.*for superbet'` on the last run | > 0 after Task 1 (today 2) |
| 1X2 / O/U 2.5 sanity | `evidence/lvbet/tools/mw_sanity.py`, `ou_sanity.py` | any deviation > 25 %, or an inverted OVER/UNDER |
| Golden | `npx vitest run src/services/normalization/__tests__/golden.test.ts -t superbet` | any failure |

## Self-review

- **Spec coverage:**
  - D1 → Task 1.
  - D2 → Task 2.
  - D3 → Task 3.
  - D4 → Task 4.
  - Player stat-line backlog → Task 5 (optional).
  - 200685 and the abbreviated labels are documented as out of scope (open question 3; `fuksiarz.md`).
- **Step scan:** every test step names its inputs (real 2026-11-06 values) and assertions. Every run step gives the command and the expected FAIL/PASS text.
- **Type consistency:**
  - `SuperbetOddsSelection.uuid` is introduced in Task 3. Task 5's sample rows already carry it, but nothing in Task 5 depends on Task 3.
  - Code names match `market-catalog.ts` (`:3189`, `:3434`, `:3677`, `:3701`, `:4757`, `:1669`, `:1701`, `:1716`, `:1991`, `:5680`).
- **Review Focus:** items 1–5 are pinned in Tasks 1, 1, 2, 3 and 4/5 respectively.
- **Proportion:** the plan has no function bodies, only one regex, the id lists and the test tables. The offline proofs (patched copies in the scratch dir `revise-superbet/`) back every "Expected" line.
