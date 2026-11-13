# Fortuna Normalizer Fixes (Health Check 2026-11-06) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Fortuna's first-half corners race from being served as the half-time 1X2 (a live fake +EV draw on 2 of 10 full-offer matches), give every Fortuna player market its player (single-name players, dotted and multi-word team prefixes), and map the 25 live Fortuna market ids whose catalog codes already exist.

**Architecture:** Normalizer changes in `src/services/normalization/bookmakers/fortuna-normalizer.ts`: id map, a corners-race guard in front of the half-scope reroute, a stricter team-prefix stripper, a single-name fallback, a player null-guard, a pair-id flip, and three selection cases. One parser exemption in `src/scrapers/bookmakers/fortuna/parser.ts` keeps the digit labels of the exact-goals markets. The scraper transport is healthy and is not touched. Every algorithm was proven on a scratch prototype against a live capture and the WC golden fixture before this plan was written (`evidence/fortuna/prototype.diff`, `evidence/fortuna/prototype-comparison.txt`). The WC golden gets one inspected rebless (entry 861).

**Tech Stack:** TypeScript (ESM, Node 20), Vitest, tsx.

**Spec:** the Observations section of this file. Evidence lives in `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/` (`$E` below):
- `api-checks.py` + `api-checks-run3.txt`: per-match HT 1X2 integrity, team-token leaks, `base` player rows, new-leg deviations, pooling and 1X2 deviation, on the live API.
- `smoke-full-offer.mts` (now with `--dump/--from/--count-ids/--warn-pattern`) + `smoke-current-fortuna-acceptance.txt`.
- `test-inputs.json`: the verbatim parser output (NBSP kept) that every new test reads.
- `golden-drift.mts` + `golden-drift-baseline.txt`: read-only twin of the rebless dry-run that prints the full index lists.
- `prototype.diff` + `prototype-comparison.txt`.
- Supporting files: `backend-log-excerpt.txt`, `unmapped-ids-peers.txt` (+ `peers.py`), `market-types-db-check.txt`, `n1x2-probe.txt`, `raw-exact-goals-arsenal-hull.json`, `aug-renormalize.mts` + `.txt`, `api-markets-excerpt.json`, `api-measurements-vs-august.txt`, and `smoke-current-fortuna.txt` (the first smoke, superseded).

## Observations (pre-fix analysis)

### Status today: scraper HEALTHY; normalizer has one LIVE odds-integrity defect (P0, D1) and five data-quality defects (D2-D6)

| Metric (API, run 2, 16:17Z) | Aug 20 baseline (Arsenal vs Coventry City) | Nov 6 Arsenal vs Hull City | Nov 6 Everton vs Coventry City | Nov 6 Leeds vs Tottenham |
|---|---|---|---|---|
| Raw markets from scraper | 955 | 1265 | 1282 | 1152 |
| Catalog codes served by API | 102 | 122 | 125 | 122 |
| (market, param) entries | 632 | 820 | 825 | 747 |
| Selections | 1206 | 1454 | 1470 | 1358 |
| Raw markets unmapped (OTHER, smoke) | 318 (33%) | 441 (35%) | 453 (35%) | 401 (35%) |

- Transport and volume: 20 fixtures in every run. Runs 1 and 2 have byte-identical per-match counts (13,115 raw, 12,897 saved). Run 3 (17:00Z) has 13,119 raw and 12,900 saved, with small lineup drift: Everton–Coventry 1282→1283, Fulham–Newcastle 1213→1212, Man Utd–Aston Villa 1150→1154. The live smoke at 17:38Z had 13,116. The 10 matches that start by Nov 8 carry the full offer (1150-1283 raw); the rest have 109-110 (`backend-log-excerpt.txt`).
- Codes gained since August: 30 (e.g. `CARDS_TOTAL`, `CARDS_TEAM`, `FOULS_TOTAL`, `OFFSIDES_TOTAL`, `RED_CARD`, `PLAYER_RED_CARD`, `TOTAL_GOALS_ASIAN`). Codes lost: only the half-scoped `*_CLEAN_SHEET`, `AWAY/HOME_CLEAN_SHEET`, `TEAM_WIN_OR_*`, `MATCH_HAS_WINNER` and `GOAL_RANGE`, which the Aug 20 audit-display commits retired or renamed (`api-measurements-vs-august.txt`). Fortuna never had `GOALSCORER_ANYTIME` (it quotes `PLAYER_GOALS`).
- 1X2 vs the peer median over all 20 matches (60 legs): mean 2.8%, max 7.8% (Manchester City vs Fulham AWAY 5.9 vs 6.4). Team names merge with the other bookmakers on 20/20 matches ("Man.City", "Nottingham" and "Man.United" canonicalize correctly) (`api-checks-run3.txt` SUMMARY).
- Unknown-market volume is unchanged: 4,277 / 4,277 / 4,278 `[fortuna] Unknown market` lines in runs 1/2/3. Re-normalizing the August raw offer (955 markets) with today's code gives 318 unknowns and 320 OTHER, the same 33% share (`aug-renormalize.mts`, `aug-renormalize.txt`). The biggest buckets are the bet-builder `00-6z` (470 lines/run), SuperSub and OPTA per-player variants without catalog codes. Next to them, 25 ids whose catalog codes already exist are also unmapped (D3, D5).
- Smoke on today's code with the exact acceptance code list (live, 17:38Z, exit 0, no DB writes): 20 matches, min 97 / median 750 normalized, OTHER share 0.3291, UNKNOWN-selection share 0.273. `HALF_TIME_RESULT` is in 20/20 matches and every other acceptance code in 0/20 (`smoke-current-fortuna-acceptance.txt`).
- WC golden (`world-cup-2026_france_morocco`): 2010 entries, 227 blessed, `failures=0`. 184 of the 1783 unblessed entries already differ from today's output (`golden-drift-baseline.txt`). Unblessed changes are therefore only meaningful as a delta against that baseline.

### Root causes

**D1 (P0, live odds-integrity defect) - the first-half corners race is served as the half-time 1X2.** `src/services/normalization/bookmakers/fortuna-normalizer.ts:206` maps `ufo:mtyp:00-0p` to `MATCH_WINNER`. Every `00-0p` payload we have seen is the corners race `1. połowa: więcej rzutów rożnych`: the live PL offer of 2026-11-06, the August Arsenal vs Coventry raw, and WC golden entry 861. The half-scope reroute (`fortuna-normalizer.ts:1260-1272`) therefore turns it into `HALF_TIME_RESULT`, the code of the real first-half result `00-2d` `1.połowa`. `mergeMarketRecord` (`src/repositories/full-offer-repository.ts:197-248`) keeps whichever of the two arrives first and logs `marketKey collision ... keeping first-seen odds`. There were 9 / 9 / 10 such `HALF_TIME_RESULT` lines in runs 1/2/3 (run 3 adds Manchester United vs Aston Villa). Fortuna's API order decides which row wins, and we do not control that order. Live API now (`api-checks-run3.txt`):

| match | Fortuna `HALF_TIME_RESULT` served (rawMarketName) | H / D / A | peer median H / D / A (7-8 peers) | worst leg |
|---|---|---|---|---|
| Manchester United vs Aston Villa | `1. połowa: więcej rzutów rożnych` | 1.85 / 5.2 / 2.6 | 2.65 / 2.42 / 3.45 | DRAW +115% |
| Ipswich Town vs AFC Bournemouth | `1. połowa: więcej rzutów rożnych` | 2.5 / 4.8 / 1.95 | 4.13 / 2.35 / 2.43 | DRAW +104% |
| the other 8 full-offer matches | `1.połowa` | correct | | max 5.1% |

Users are shown these DRAW legs as fake +EV (5.2 vs 2.42). The typed odds-integrity detectors (10x / placeholder / swap) did not flag them. Fortuna is also missing from `HALF_TIME_CORNERS_RACE` on all 10 matches, where 9 peers quote it. Two latent variants of the same bug reproduce on today's code (`prototype-comparison.txt`, edge-case probe):
- A full-match `Mecz: więcej rzutów rożnych` under `00-0p` becomes `MATCH_WINNER` (AWAY 6.4 / HOME 1.14 / DRAW 12) and would poison the main 1X2. The same name under `00-60` or `00-2x` gives the same result.
- `2. połowa: więcej rzutów rożnych` becomes `SECOND_HALF_RESULT`.

The catalog already has `SECOND_HALF_CORNERS_RACE` (`src/data/market-catalog.ts:7838`, DB id 1148). Superbet, lvbet and forbet already emit it (`superbet-normalizer.ts:287`, `lvbet-normalizer.ts:148`, `forbet-normalizer.ts:188`), and superbet quotes it live on Arsenal vs Hull (1.25 / 5.75 / 5). The WC golden blesses the wrong mapping (entry 861).

**D2 - single-name players lose their parameter.** `extractFortunaPlayerName` (`fortuna-normalizer.ts:417-447`) needs a comma or 2+ capitalised words (no-comma fallback at 440-444). So `Murillo\u00a0- liczba strzałów\u00a0(OPTA)` returns `undefined` and the row lands under param `base`. Today 96 Fortuna `PLAYER_*`/`GOALSCORER_*` rows sit under `base` on 6 of the 10 full-offer matches (`api-checks-run3.txt`):

| player | rows | match |
|---|---|---|
| Murillo | 19 | Forest–City |
| Chema | 19 | Brighton–Brentford |
| Kevin | 19 | Fulham–Newcastle |
| Estevao | 19 | Sunderland–Chelsea |
| Rayan + Evanilson | 19 visible | Ipswich–Bournemouth |
| Alisson | 1 | Palace–Liverpool |

The 17:38Z capture has 115 such raw markets. Effects:
- Dropdown markets leak the raw label: Fortuna's `GOALSCORER_FIRST` `Tak@30` sits inside the peers' `base` bundle.
- When a match has two such players, their rows collide on the bare key and the second player's odds are dropped: 19 overlapping-code collision lines per run, all on Ipswich–Bournemouth.

The only `base` rows that should exist are `CORRECT_SCORE`, `HALF_TIME_CORRECT_SCORE`, `SECOND_HALF_CORRECT_SCORE` and `HALFTIME_FULLTIME` (4 per full-offer match today).

**D3 - five new live types that have catalog codes but no mapping.** They are absent from the August match. Values come from `test-inputs.json` (17:38Z) and peers on Arsenal vs Hull from `unmapped-ids-peers.txt`:

| id | live name | outcomes (Arsenal vs Hull) | catalog code | peers (median YES) |
|---|---|---|---|---|
| `ufo:mtyp:00-9a` | `Mecz: rzut karny` | Nie 1.29 / Tak 3.35 | `PENALTY_AWARDED` | 3 (3.1) |
| `ufo:mtyp:00-bt` | `Mecz: rzut karny i czerwona kartka` | Nie 1.01 / Tak 12 | `RED_CARD_AND_PENALTY` | 2 (10.15) |
| `ufo:mtyp:00-bv` | `Mecz: gol samobójczy` | Nie 1.05 / Tak 8 | `OWN_GOAL` | 2 (8.15) |
| `ufo:mtyp:00-k7` | `Mecz: gol zdobyty strzałem głową` | Nie 1.45 / Tak 2.6 | `HEADER_GOAL` | 1 (betclic 2.4) |
| `ufo:mtyp:00-k6` | `Mecz: liczba asyst w meczu` (two lines) | `powyżej\u00a02.5` 2.3 / `poniżej\u00a02.5` 1.56; `powyżej\u00a01.5` 1.18 / `poniżej\u00a01.5` 4.4 | `ASSISTS_TOTAL` | 0 |

`ASSISTS_TOTAL` also needs a selection case. There is no `case "ASSISTS_TOTAL"`, so `powyżej 2.5` falls to the default branch (`fortuna-normalizer.ts:1071-1077`) and comes out `UNKNOWN`. The line itself already parses (prototype output: `ASSISTS_TOTAL:2.5`). `00-bu` `Mecz: rzut karny lub czerwona kartka (Nie liczy się: CK dla ławki, po meczu, dla sztabu)` is priced Tak 2.4, against 1.9 for the peers' `PENALTY_OR_RED_CARD`. The settlement differs, so it stays unmapped (open question 1). The note at `fortuna-normalizer.ts:126-127` ("no ASSISTS_TOTAL catalog code") is stale: the code exists (`src/data/market-catalog.ts:5414`).

**D4 - dotted and multi-word team prefixes leak into player names.** `stripFortunaLeadingTeamToken` (`fortuna-normalizer.ts:398-402`) strips only one leading token, and its regex forbids dots. The unanchored `verbMatch` (`:433-436`) then starts matching inside the prefix. Today the API has 42 such Fortuna params on 3 of 10 matches (Man Utd–Villa 26, Forest–City 15, Palace–Liverpool 1), for example:
- `Man.United\u00a0Tielemans, Youri\u00a0strzeli…` → `Youri United Tielemans`
- `Man.City\u00a0Dias, Ruben…` → `Ruben City Dias`
- `Crystal Palace\u00a0Nketiah, Eddie…` → `Eddie Palace Nketiah`
- `Aston Villa\u00a0McGinn, John…` → `John Villa McGinn`
- `Aston Villa\u00a0George Lawrence Hemmings\u00a0strzeli…` → `Villa George Lawrence Hemmings`. Its `GOALSCORER_LAST` row is `George Lawrence Hemmings`, so the two never meet.

Another 17 on Everton–Coventry (`Coventry City\u00a0Thomas, Bobby…` → `Bobby City Thomas`) are hidden in the API by the grouper's `reconcilePlayerNameVariants` (`src/services/market-type-grouper.ts:228`). The capture has 70 raw markets with a leaked token in total. The same bug would defeat the D2 fix for a mononym behind a dotted prefix: `Man.City\u00a0Rodri…` gives `Man.City Rodri` today.

The review proposed "strip the longest leading 3/2/1-token prefix that resolves to a side". That rule would eat first names, because `normalize1x2Selection` matches fuzzily (`n1x2-probe.txt`, today's code):
- `"Aston Villa George"` → AWAY
- `"Hull Lucas"` → AWAY, so `Hull\u00a0Lucas Herrington` would become `Herrington` (today it is correctly `Lucas Herrington`)
- `"Nottingham Murillo"` → HOME
- `"Chelsea Estevao"` → AWAY

This plan accepts a 2-3 token prefix only when every token (split on spaces and dots, ≥ 3 letters) is a prefix of a token of that side's canonical team name. Otherwise it keeps today's single-token rule, widened to tokens with dots (`Man.City`, `W.Ziel.Przyl.`). The review also proposed anchoring `verbMatch` with `^`. That is rejected: on the capture it removes the player from 12 markets whose surnames have lowercase particles (`Van de Ven, Micky`, `Loureiro da Costa, Joao Pedro`), and the new null guard would then drop them (`prototype-comparison.txt`).

**D5 - twenty more ids with catalog codes but no mapping (pre-existing; all present in the August raw, `aug-renormalize.txt`).** None of these ids appears anywhere in `fortuna-normalizer.ts`, and Fortuna is absent from every one of these codes today. Peers are counted on Arsenal vs Hull unless noted (`unmapped-ids-peers.txt`). The prototype outputs come from `test-inputs.json` (17:38Z); deviation is the worst leg priced below 5.0 against the peer median:

| id | live name | catalog code | peers | prototype output; max dev |
|---|---|---|---|---|
| `00-2n` | `1.połowa: obie drużyny strzelą gola` | `HALF_TIME_BTTS` | 8 | NO 1.12 / YES 5.4; 0.4% |
| `00-1h` / `00-1i` | `Mecz:\u00a0Arsenal\u00a0- wygra do zera` / `…Hull…` | `HOME_WIN_TO_NIL` / `AWAY_WIN_TO_NIL` | 7 / 7 | YES 1.65 / NO 2.02; 2.9% |
| `00-09` | `Mecz: wynik/różnica zwycięstwa` (`Arsenal/o 2 gole`, `Remis`, …) | `WINNING_MARGIN` | 7 | HOME_BY_1 4 / HOME_BY_2 3.7 / HOME_BY_3PLUS 2.24 / DRAW 7; < 3% |
| `00-1o` / `00-1p` | `… - wygra obie połowy` | `HOME_WIN_BOTH_HALVES` / `AWAY_WIN_BOTH_HALVES` | 8 / 8 (Forest–City) | 0.3% / 2.3% |
| `00-2b` / `00-2c` | `… - strzeli gola w obu połowach` | `HOME_SCORE_BOTH_HALVES` / `AWAY_SCORE_BOTH_HALVES` | 8 / 8 | 1.5% |
| `00-1r` / `00-1s` | `… - wygra przynajmniej jedną połowę` | `HOME_WIN_AT_LEAST_ONE_HALF` / `AWAY_WIN_AT_LEAST_ONE_HALF` | 8 / 8 | 1.2% |
| `00-16` / `00-17` | `Arsenal dokładna liczba goli` / `Hull …` | `HOME_EXACT_GOALS` / `AWAY_EXACT_GOALS` | 7 / 8 | 2.8% (needs D6) |
| `00-3e` | `2.połowa: dokładna liczba goli` | `SECOND_HALF_EXACT_GOALS` | 6 | 2.5% (needs D6) |
| `00-07` / `00-08` | `Mecz:\u00a0Arsenal\u00a0- Czerwona Kartka (bez CK dla trenera i sztabu)` | `RED_CARD_TEAM`, param HOME/AWAY | 5 / 6 | YES 11 / 8.2 (+10%, odds above 5) |
| `00-0c` / `00-0d` | `1.połowa: Arsenal\u00a0- Czerwona Kartka (…)` | `HALF_TIME_RED_CARD_TEAM`, param HOME/AWAY | 1 (etoto) | 0% |
| `00-0a` | `1.połowa:\u00a0Czerwona Kartka (…)` | `HALF_TIME_RED_CARD` | 6 | 2.2% |
| `00-0f` | `Mecz:\u00a01.rzut rożny` (Forest–City; the `Nikt`@100 leg is dropped) | `FIRST_CORNER` | 8 (Forest–City) | 1.0% |
| `00-19` | `Mecz: suma goli` (`parzysty` / `nieparzysty`) | `ODD_EVEN_GOALS` | 7 | 2.7% |

Over Tasks 3-5 the prototype produces 42 new legs priced below 5.0 that have a peer. The worst is 8.3% (`HEADER_GOAL` YES 2.6 vs betclic 2.4). The pair ids are positional: the first id of each pair is the home team. That was checked on Arsenal vs Hull, Forest–City, Bournemouth vs Nottingham, Everton vs Coventry and the August raw. It is the same convention as `FORTUNA_TEAM_SCOPED_ID_SIDE` (`fortuna-normalizer.ts:494-512`).

Deferred to a follow-up plan, `docs/superpowers/plans/<date>-fortuna-composite-markets.md` (not written yet). Each item needs a selection-vocabulary decision:
- `00-30`/`00-31`/`00-32` and `00-33`/`00-34`/`00-35` → `RESULT_OR_BTTS` (2 peers; the `*_OR_BTTS_NO` copy is disputed in `forbet.md` Risks).
- `00-6i`/`00-6j` → `RESULT_OR_TOTAL` `DRAW_UNDER`/`DRAW_OVER` (3 peers; Fortuna already pools `00-7b..7e` there).
- `00-1w`/`00-1x` → `DOUBLE_CHANCE_HALF_TIME_BTTS`/`DOUBLE_CHANCE_SECOND_HALF_BTTS` (1 peer).
- `00-0m`/`00-0n`, the per-team corner ranges → `CORNERS_TEAM_RANGE` (6 peers; revisit the note at `fortuna-normalizer.ts:120-123`).
- `00-p4`/`00-p5`, the team red-card count `+ 0.5` (no exact code).
- `00-ka`/`00-k9` (no code).
- The rare `00-2v`, `00-r5`, `00-r6`, `00-r8` and `00-r9` (1-4 lines per run).

`00-bu` and `00-p1` are covered by open questions 1 and 3.

**D6 - the parser rewrites the exact-goals digit labels into team names.** `getSelectionName` (`src/scrapers/bookmakers/fortuna/parser.ts:116`) uses `longName` only when it is not purely digits (`:124-127`). Otherwise the 1X2 switch (`:146-165`) maps `0`/`1`/`2` to `Remis`/home/away. Apart from the already exempt `00-0v`/`00-0w` (`:138-143`), only `00-16`, `00-17` and `00-3e` carry digit outcomes (scan of the Arsenal vs Hull raw). For `Arsenal dokładna liczba goli` the API sends `2 / 3+ / 1 / 0` and the parser emits `Hull / 3+ / Arsenal / Remis` (`raw-exact-goals-arsenal-hull.json` vs `test-inputs.json`). The August raw already shows the same rewrite.

Cross-cutting (observability plan, not fixed here): `GET /api/odds?league=premier-league` reports `bookmakerStatus.fortuna = "stale"` right after a successful save. The cause: `getBookmakerStatus` (`src/repositories/odds-repository.ts:131-164`) reads unlimited `odds` rows, and PostgREST caps the response at `max_rows = 1000` (`supabase/config.toml:18`).

Observations for other owners (not fixed here):
- Grouper: for `GOALSCORER_FIRST`/`LAST`, every peer publishes one `base` bundle with player names as selections (Forest–City: betcris 32, betfan 40, etoto 40, lvbet 32, sts 40, superbet 39 selections). Fortuna emits one parameter per player instead. Even after D2/D4, Fortuna's goalscorer rows will not share a comparison row with the peers. Pooling shows only where the peers also use player params: `PLAYER_SHOTS` `Murillo` (betfan, etoto, forbet, superbet) and `PLAYER_SHOTS_ON_TARGET` `Murillo` (betfan, etoto, forbet).
- Player names: today lowercase surname particles are dropped (`Van de Ven, Micky` → `Micky Ven`, `Loureiro da Costa, Joao Pedro` → `Joao Pedro Costa`). This plan keeps that behaviour, pins it with regression guards, and leaves canonicalization to a follow-up.
- Odds integrity: D1's +104-115% DRAW passed the typed detectors. A per-leg peer-median deviation detector for 1X2-shaped half markets would have caught it.

### What still works and must not break

- Scraper/API path (REST via `page.evaluate`), per-match counts, team names, 1X2 sanity.
- Player keys that are right today:
  - `Diomande, Ousmane\u00a0- liczba strzałów\u00a0(OPTA)` → `PLAYER_SHOTS:Ousmane Diomande` (2+@7, 1+@2.25)
  - `Nottingham\u00a0Diomande, Ousmane\u00a0strzeli pierwszego gola w meczu (OPTA)` → `GOALSCORER_FIRST:Ousmane Diomande` (PLAYER@30)
  - `Hull\u00a0Lucas Herrington\u00a0strzeli pierwszego gola w meczu (OPTA)` → `GOALSCORER_FIRST:Lucas Herrington`
  - the WC shapes `Maroko Diop, Issa strzeli…` → `Issa Diop` and `W.Ziel.Przyl. Cabral, Jovane strzeli…` → `Jovane Cabral`
  - `Youssef Belammari liczba spalonych w 1.połowie (OPTA)` → `Youssef Belammari`
- `PLAYER_RED_CARD` rows (`Murillo wyrzucony z boiska`; 16 per match; 16 unblessed WC entries, 1728-1987) keep their shape: bare key, player in the selection.
- `00-2d` → `HALF_TIME_RESULT`; `00-0e` → `CORNERS_RACE`; a plain `Mecz` 1X2 under `00-60` stays `MATCH_WINNER`.
- Tests green today (2026-11-06):
  - `npx vitest run`: 65 files / 1182 tests.
  - `npx tsc --noEmit`: exit 0.
  - `npx vitest run src/scrapers/bookmakers/fortuna`: 10 tests.
  - `fortuna-audit-fixes.test.ts`: 63 tests.
  - golden `-t fortuna`: 2010 entries, 227 blessed, `failures=0`.

### Impact

- Normalizer plus one parser exemption. No catalog change. All 24 target codes, plus both Task 6 options (`MATCH_RESULT_OR_WIN_BY_2`, `WIN_OR_WIN_BY_2`), have `market_types` rows (`market-types-db-check.txt`). The route's DB branch (`src/routes/odds.ts:288-296`) is the only one that yields `shortLabelPl == namePl` for codes absent from `SHORT_LABELS`. So the `odds.market_type_id` FK holds and no `sync-market-types.ts` run is needed.
- Golden (WC fixture), measured with the prototype (`prototype-comparison.txt`, `golden-drift.mts`): the only blessed change is entry 861 (Task 1). New unblessed drift against the 184-entry baseline, per task:
  - Task 2: none.
  - Task 3: 1751, 1897, 1898, 1900, 1902, 1903.
  - Task 4: 860, 1774, 1802, 1809, 1817, 1821, 1834, 1858, 1872, 1876, 1883, 1936, 1955, 1959, 1962, 1967, 1995.
  - Task 5: 1956, 1991, 1992. The frozen raw still has the legacy `Remis`/team labels, and Task 5's legacy translation normalizes them correctly.
  - Task 6, if done: 1790. Entry 1874 (`1 gol(e)`) stays OTHER, and so does 1744 (`00-bu`).
  - **Amended by the Task 4 review (fix round 1):** three ids are held back because no owner decision covers their settlement and their YES sits above the peers: `00-bt` (Task 3 review, entry 1898) and `00-07`/`00-08` (`RED_CARD_TEAM`, Task 4 review, entries 1936 and 1962). Those entries stay `null`, so the cumulative list has 20 entries after Task 4 and 23 after Task 5: 860, 1751, 1774, 1802, 1809, 1817, 1821, 1834, 1858, 1872, 1876, 1883, 1897, 1900, 1902, 1903, 1955, 1956, 1959, 1967, 1991, 1992, 1995.
- Prior audit knowledge: the August `/audit-match` (Arsenal vs Coventry City) blessed entry 861 with the wrong code, and that entry must be reblessed.
- Smoke on the same capture, prototype vs today's code: OTHER share 0.3291 → 0.3018, UNKNOWN-selection share 0.273 → 0.237. On every match `normalized` grows by exactly the number of raw markets carrying the 25 ids: 24-26 on the full-offer matches, 10 on the rest (`prototype-comparison.txt`). With the three held-back ids (Task 4 review) the mapped ids are 22: on the 2026-11-07 Task 0 capture they carry 23 raw markets on 8 full-offer matches, 21 on Arsenal vs Hull and 10 on the other 10 matches, and the OTHER share is 0.3066 after the Task 4 review and about 0.3044 after Task 5.

### Risks and unknowns

- Some team labels are not token-prefixes of the canonical name (e.g. `Wolves`, `Sheffield Utd`, `Atl. Madryt`, `AS Roma`). They are stripped only through an exact alias of the league (Task 2 amendment); a label with no alias and no token prefix is not stripped and leaks into the player name. The label-based detectors of criterion 3 and `replay-player-keys.mts` (`labelLeak`, `sharedTeamToken`) catch such a case without depending on canonical names.
- The null guard turns a player-coded market without an extractable player into OTHER and logs `[fortuna] Player market without extractable player` (`PLAYER_RED_CARD` is exempt). It fires 0 times on the capture. A new name shape will therefore show up as warnings rather than as a polluted `base` row.
- The pair ids are positional. A label that names the other team flips the code (Task 4), so a reshuffled id cannot price the wrong team.
- `00-9a` YES 3.35 is 8% above its 3 peers, and `RED_CARD_TEAM` YES is +10% (odds 8-11). These look like plausible bookmaker margins but are worth watching. Amended by the Task 4 review: on the 9 PL full-offer matches of 2026-11-07, `RED_CARD_TEAM` YES is +5.1% to +18.2% above the peer median on all 18 rows and above every peer on 10 of them (at most +7.3% over the best peer), and no owner decision covers the `(bez CK dla trenera i sztabu)` settlement, so `00-07`/`00-08` are held back (Task 4 Interfaces).
- The DB corrects itself for D1 on the first scrape after the fix: `00-2d` overwrites the bad `HALF_TIME_RESULT` row, and `pruneStaleOddsRows` removes the older snapshots.

### Open questions for the owner

1. Map `00-bu` to `PENALTY_OR_RED_CARD` despite the narrower settlement and the 26% price gap (2.4 vs 1.9)? Default: no.
2. Bless the 26 WC entries that Tasks 3-5 change (23 after the hold-backs, see Impact)? Default: leave them unblessed. 184 unblessed entries already drift, and the new unit tests pin the behaviour.
3. Fortuna's `Wynik meczu lub\u00a02\u00a0gol(e) PRZEWAGI` (`00-p1`; Arsenal vs Hull Remis 6.5 / Hull 12.5 / Arsenal 1.14) is dropped on purpose (`fortuna-normalizer.ts:1159-1165`). The same id also carries a `1 gol(e)` variant. `forbet.md` (Risks) hands its routing to this plan. Fortuna's `Remis` is priced below Fortuna's own 1X2 draw (6.5 vs 7.2 on Arsenal vs Hull, 3.75 vs 3.85 on Forest–City), so it is the plain final-result draw, as in forbet. Follow `forbet.md` open question 1:
   - (a) `MATCH_RESULT_OR_WIN_BY_2` keeps all 3 legs, and Fortuna becomes the second bookmaker on the card.
   - (b) `WIN_OR_WIN_BY_2` keeps only the two team legs.

   Default: whatever forbet's question 1 decides; Task 6 implements either option. The `1 gol(e)` variant stays dropped in both.
4. Write the deferred composite-markets plan (the list under D5) next? Default: yes, after this plan ships.

### Acceptance criteria

All commands run from `/home/skamik/Documents/repositories/personal/aityper-scraper-api` with:

```bash
E=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna
CODES=HALF_TIME_RESULT,HALF_TIME_CORNERS_RACE,SECOND_HALF_CORNERS_RACE,PENALTY_AWARDED,RED_CARD_AND_PENALTY,OWN_GOAL,HEADER_GOAL,ASSISTS_TOTAL,HALF_TIME_BTTS,HOME_WIN_TO_NIL,AWAY_WIN_TO_NIL,WINNING_MARGIN,HOME_WIN_BOTH_HALVES,HOME_SCORE_BOTH_HALVES,AWAY_SCORE_BOTH_HALVES,HOME_WIN_AT_LEAST_ONE_HALF,AWAY_WIN_AT_LEAST_ONE_HALF,HOME_EXACT_GOALS,AWAY_EXACT_GOALS,RED_CARD_TEAM,HALF_TIME_RED_CARD_TEAM,HALF_TIME_RED_CARD,SECOND_HALF_EXACT_GOALS,FIRST_CORNER,ODD_EVEN_GOALS
# Amended by the Task 4 review: 00-bt, 00-07 and 00-08 are held back (Impact), so IDS lists the 22 mapped ids.
# Task 0 ran with all 25 ids, these three included; Task 7 reads idRaw from its own file (criterion 1).
IDS=00-9a,00-bv,00-k7,00-k6,00-2n,00-1h,00-1i,00-1o,00-1p,00-2b,00-2c,00-1r,00-1s,00-16,00-17,00-0c,00-0d,00-0a,00-3e,00-0f,00-19,00-09
```

Single-bookmaker live smoke test: no DB writes, about 13 s, one Fortuna league scrape. Proven on today's code, exit 0 (`smoke-current-fortuna-acceptance.txt`):

```bash
node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna premier-league $CODES --dump /tmp/fortuna-capture.json --count-ids $IDS --warn-pattern 'without extractable player'
```

Using `--from /tmp/fortuna-capture.json` instead of `--dump` re-normalizes the same capture without network access. On today's code it reproduces the live `perMatch` exactly.

Pass when:
1. **Same capture, before vs after** (Task 0 vs Task 7). Amended by the Task 4 review (fix round 1): the 2026-11-07 Task 0 capture has 19 matches, 9 of them full-offer (raw ≥ 500; the others have 109-110 raw markets), and `00-bt`, `00-07` and `00-08` are held back (Impact). So `IDS` lists the 22 mapped ids, and `idRaw` is read from the after file, never from the Task 0 file, which counted all 25:
   - On every match, `normalized_after − normalized_before == idRaw_after` and `other_after − other_before == −idRaw_after`. On the Task 0 capture `idRaw_after` is 23 on 8 full-offer matches, 21 on Arsenal vs Hull and 10 on the others. If Task 6 was done, add the match's count of `Wynik meczu lub 2 gol(e)` markets (ledger P4): `00-p1` is deliberately not in `IDS` because its `1 gol(e)` twin stays unmapped.
   - `warnPatternCount` is 0.
   - `otherMarketShare` ≤ 0.305 (before: 0.3291; prototype: 0.3018; expected about 0.3044 with the three hold-backs, so the margin is thin).
   - `requiredCodeMatchCounts`, with `M` the number of matches and `F` the number of full-offer matches in the file (19 and 9 on the Task 0 capture):
     - `HALF_TIME_RESULT`, `HALF_TIME_BTTS`, `HOME_WIN_TO_NIL`, `AWAY_WIN_TO_NIL`, `WINNING_MARGIN`, `HOME_WIN_BOTH_HALVES`, `HOME_SCORE_BOTH_HALVES`, `AWAY_SCORE_BOTH_HALVES`, `HOME_WIN_AT_LEAST_ONE_HALF` and `AWAY_WIN_AT_LEAST_ONE_HALF`: `M` each.
     - `HALF_TIME_CORNERS_RACE`, `PENALTY_AWARDED`, `OWN_GOAL`, `HEADER_GOAL`, `ASSISTS_TOTAL`, `HOME_EXACT_GOALS`, `AWAY_EXACT_GOALS`, `HALF_TIME_RED_CARD_TEAM`, `HALF_TIME_RED_CARD`, `SECOND_HALF_EXACT_GOALS` and `ODD_EVEN_GOALS`: ≥ `F − 1` each (9 on the Task 0 capture).
     - `FIRST_CORNER`: ≥ `F − 2` (8 on the Task 0 capture).
     - `RED_CARD_AND_PENALTY` and `RED_CARD_TEAM`: 0, because `00-bt`, `00-07` and `00-08` are held back.
     - `SECOND_HALF_CORNERS_RACE`: 0, because Fortuna does not offer it today.
2. **Fresh live smoke** after the fix: exit 0, `matches` equal to the number of PL fixtures Fortuna lists at that time (20 on 2026-11-06, 19 on 2026-11-07), and the code thresholds of criterion 1 with that run's own `M` and `F` (Task 4 review). A match that has kicked off since Task 0 leaves the fresh run, so `F` can be lower than on the Task 0 capture.
   - Task 6 (amended by the Task 6 review): criterion 1's per-match formula (`normalized − before == idRaw` plus the 2-goal count) needs the Task 0 capture as `before`, so it says nothing about a fresh offer. On the fresh dump, the offline replay of Task 7 Step 2 is the check: exit 0, `warnPatternCount` 0 for the pattern `WIN_OR_WIN_BY_2: could not resolve`, and `requiredCodeMatchCounts.WIN_OR_WIN_BY_2` equal to `matches`. Fortuna lists one `00-p1` 2-goal market on every fixture, the 109-raw ones included (19 of 19 on the Task 0 capture). The fresh smoke alone cannot see a dropped 2-goal market: `CODES` has no `WIN_OR_WIN_BY_2`, its only `--warn-pattern` is `without extractable player`, `smoke-full-offer.mts` counts every other `console.warn` without printing it (`:39`, `:44`), and it exits 0 whatever the warning count.
3. **API after the next scheduled run.** Only possible once the owner has merged this work into `master`: the :3001 backend runs the main checkout, and worktrees cannot write to the DB (EXECUTION.md, decision 1 and Workspace layout). Before that, Task 7 Step 2 is the offline equivalent. `python3 -I $E/api-checks.py` prints a `SUMMARY` with:
   - `verdict` `CHECKED` and `full` ≥ 1. With `full` 0 every count below is 0 without anything having been checked: record criteria 3-4 as NOT RUN, never PASS.
   - `full` 10 (or however many full-offer matches are listed)
   - `htBad` 0 (today 2)
   - `htcMissing` 0 (today 10)
   - `leak` 0 (today 42)
   - `labelLeak` 0 and `sharedTeamToken` 0. These read Fortuna's own team labels from its raw names, so they also see labels that are no token of the canonical name (`Atl. Madryt`, `A Coruňa`, `Le Havre`).
   - `base` 0 (today 96), and `baseCodes` exactly `["CORRECT_SCORE", "HALFTIME_FULLTIME", "HALF_TIME_CORRECT_SCORE", "SECOND_HALF_CORRECT_SCORE"]`
   - `newLegsUnder5.over10Pct` 0 (prototype: 42 legs, max 8.3%)
   - `oneXTwo.maxDevPct` ≤ 10

   Every match's `ht:` line shows raw `'1.połowa'` and `ok=True`.
4. **Pooling.** In the same output, the Forest–City `pool:` line lists fortuna on the `'Murillo'` row next to betfan, etoto, forbet and superbet (`SUMMARY.mononym.fortunaOnRow` true). Today fortuna is not on that row; its Murillo rows are in `base`. Also, `GET /api/matches/Nottingham%20Forest/Manchester%20City/normalized-markets?league=premier-league` has a `GOALSCORER_FIRST` parameter `Murillo` with a fortuna selection of type `PLAYER` (the `mononym:` line of the same output). Forest–City kicks off 2026-11-07T17:30Z; Task 7 Step 3 says which mononym to use after that. If the pool line says `ABSENT`, criterion 4 is NOT RUN.
   - `WIN_OR_WIN_BY_2` (Task 6, added by the Task 6 review): on every listed fixture, check 5 of Task 7 Step 3 prints `ok=True`. That is exactly 1 `WIN_OR_WIN_BY_2` card, with fortuna on it holding exactly one HOME and one AWAY leg, next to betclic (where it lists the market) and forbet (once `recovery/forbet` is merged). Each fortuna leg is at or below fortuna's own `MATCH_WINNER` leg for the same side: winning or leading by 2 covers more outcomes than a plain win, so a higher price points to a swapped side. Fortuna's `MATCH_WINNER` `rawMarketName` does not start with `Wynik meczu lub`. Criterion 3's `newLegsUnder5.over10Pct` checks its legs under 5 against the peer median (`api-checks.py` `NEW_CODES`). Owner-gated like criteria 3-5: until the owner merges `recovery/fortuna` together with `recovery/forbet` and a scheduled run follows, record it as NOT RUN.
5. **Log of that run**, with `L` = the ANSI-stripped backend log from the run's `[Scheduler] Starting scheduled scrape` line onwards. The scheduler scrapes only `CONFIG.ENABLED_LEAGUES`, which is `['premier-league']` (`src/config/index.ts:47-49`), so these greps never cover another league; Task 7 Step 2b covers them:
   - `grep -c 'marketKey collision with overlapping selection code .* for fortuna ' $L` → 0. Run 3 had 29: 10 `HALF_TIME_RESULT` plus 19 player keys.
   - `grep -c '\[fortuna\] Player market without extractable player' $L` → 0.
   - `grep -c '\[fortuna\] WIN_OR_WIN_BY_2: could not resolve' $L` → 0 (Task 6, added by the Task 6 review). Any line is a 2-goal market dropped because its team legs did not resolve to one HOME and one AWAY.
6. `npx tsc --noEmit` exits 0, `npx vitest run` is green, and golden `-t fortuna` reports `failures=0`. `golden-drift.mts --since <Task 0 baseline>` prints `{"blessed":[],"unblessed":[860,1751,1774,1802,1809,1817,1821,1834,1858,1872,1876,1883,1897,1900,1902,1903,1955,1956,1959,1967,1991,1992,1995],"gone":[]}`, plus 1790 if Task 6 was done. That is the 26 indices listed under Impact minus the held-back 1898, 1936 and 1962 (Task 4 review).

## Global Constraints

- Code and comments in English. Commit messages are concise, with NO signature/attribution footers (no "Generated with", no "Co-Authored-By"). The owner's rule overrides any tool reminder.
- Work on a branch from `master` (`git switch -c fix/fortuna-normalizer-2026-11`). Commit only after the owner has approved executing this plan.
- Baseline measured 2026-11-06 on the unmodified tree: `npx vitest run` 65 files / 1182 tests passed, and `npx tsc --noEmit` exit 0. Any other failure after your change is yours.
- Before every commit: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` (exit 0) and `npx vitest run` (all green).
- Golden-fixture discipline:
  - Write the failing unit test first.
  - Rebless only through `npx tsx scripts/rebless-golden.ts --bookmaker fortuna`, after a `--dry` run whose output matches the task, then inspect `git diff` of the `.expected.json`.
  - Never hand-edit expected files.
  - Never pass `--include-unblessed`: 184 unrelated unblessed entries already drift. Check unblessed changes with `node_modules/.bin/tsx $E/golden-drift.mts --since /tmp/fortuna-golden-before.txt`.
- Run `npx tsx scripts/sync-market-types.ts` only if `src/data/market-catalog.ts` changes. This plan does not change it.
- Editing anything under `src/` restarts the running dev server (`tsx watch`). Coordinate with whoever runs the live service before the first edit.
- Keep live traffic modest: one smoke run per verification step (Task 0 and Task 7).
- New tests read their inputs verbatim, NBSP included, from `src/services/normalization/bookmakers/__tests__/fixtures/fortuna-health-2026-11.inputs.json`, a byte copy of `$E/test-inputs.json`. Synthetic inputs are allowed only where no live payload exists, and they are marked `// synthetic` in the test. In TS source, write NBSP as `\u00a0`.

## Review Focus

1. A corners race must never feed a 1X2 code, whatever id or scope it arrives with. `00-0p` + `Mecz: więcej rzutów rożnych` → `CORNERS_RACE`. `2. połowa: …` → `SECOND_HALF_CORNERS_RACE`. A corners-race name under any `MATCH_WINNER`-coded id (`00-60`) → `CORNERS_RACE`. Tests in Task 1.
2. Team-prefix stripping must not eat first names when the fuzzy team matcher over-matches. `Hull\u00a0Lucas Herrington…` stays `Lucas Herrington`, and `Nottingham\u00a0Murillo…` becomes `Murillo`, not empty. Tests in Task 2.
3. Surnames with lowercase particles keep today's key (`Van de Ven, Micky` → `Micky Ven`, `Loureiro da Costa, Joao Pedro` → `Joao Pedro Costa`). So `verbMatch` stays unanchored, and the null guard never fires on these names. Tests in Task 2.
4. A team name standing where the player should be (`Nottingham\u00a0- liczba strzałów\u00a0(OPTA)`) produces no row at all (null plus a warning). `PLAYER_RED_CARD` rows are exempt from that guard. Tests in Task 2.
5. A positional pair id whose label names the other team is routed by the label (`00-1h` quoting Hull → `AWAY_WIN_TO_NIL`). Test in Task 4.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/services/normalization/bookmakers/fortuna-normalizer.ts` | Modify | id map, corners guard + half reroute, team-prefix stripper, single-name fallback, player null guard, pair flip, team param for the red-card codes, selection cases (`ASSISTS_TOTAL`, `WINNING_MARGIN`, legacy exact-goals labels), `FIRST_CORNER` UNKNOWN drop, `00-p1` (Task 6) |
| `src/scrapers/bookmakers/fortuna/parser.ts` | Modify | keep the digit labels of `00-16` / `00-17` / `00-3e` |
| `src/services/normalization/bookmakers/__tests__/fortuna-health-2026-11.test.ts` | Create | normalizer tests for Tasks 1-6 |
| `src/services/normalization/bookmakers/__tests__/fixtures/fortuna-health-2026-11.inputs.json` | Create (copy of `$E/test-inputs.json`) | verbatim live inputs |
| `src/scrapers/bookmakers/fortuna/__tests__/exact-goals-selection.test.ts` | Create | Task 5 parser test |
| `src/services/normalization/__fixtures__/fortuna/world-cup-2026_france_morocco.expected.json` | Rebless | entry 861 only |

---

### Task 0: Baseline capture (no code change)

- [ ] **Step 1: Capture the offer and record the baselines on `master`**, using the variables from Acceptance criteria:

```bash
node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna premier-league $CODES --dump /tmp/fortuna-capture.json --count-ids $IDS --warn-pattern 'without extractable player' | grep '^SMOKE_RESULT' > /tmp/fortuna-smoke-before.txt
node_modules/.bin/tsx $E/golden-drift.mts > /tmp/fortuna-golden-before.txt
```

Expected:
- `/tmp/fortuna-smoke-before.txt`: `"success":true`, `"matches":20`, `"HALF_TIME_RESULT":20`, every other code `0`, `"warnPatternCount":0`.
- `/tmp/fortuna-golden-before.txt`: `GOLDEN_DRIFT {"blessedCount":0,"unblessedCount":184,…}`.

Keep both files and the capture until Task 7.

### Task 1 (P0): Corners races never feed a 1X2 code

**Files:**
- Modify: `src/services/normalization/bookmakers/fortuna-normalizer.ts`:
  - `:206`: id map.
  - `:1213-1215`: add the corners guard next to the `ASIAN_HANDICAP` corners guard.
  - `:1260-1273`: new `CORNERS_RACE` branch in the half-scope reroute.
  - `:737-753`: add `HALF_TIME_CORNERS_RACE` and `SECOND_HALF_CORNERS_RACE` after `case "CORNERS_RACE":` (line 751).
- Create: `src/services/normalization/bookmakers/__tests__/fixtures/fortuna-health-2026-11.inputs.json` (`cp $E/test-inputs.json …`)
- Create: `src/services/normalization/bookmakers/__tests__/fortuna-health-2026-11.test.ts`
- Rebless: WC golden entry 861

**Interfaces:**
- Consumes: `fortunaNormalizer.normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null`.
- Produces (test helpers at the top of the test file, reused by Tasks 2-6):
  - `ctxOf(group: string): NormalizationContext`: the group's `ctx` from the fixture.
  - `live(group: string, id: string, nameIncludes = ""): { raw: RawBookmakerMarket; ctx: NormalizationContext }`: the single market of `group` whose `bookmakerMarketId === "ufo:mtyp:" + id` and whose name contains `nameIncludes`. Throws when zero or several match.
  - `liveAll(group: string, id: string): RawBookmakerMarket[]`
  - `run(raw: RawBookmakerMarket, ctx: NormalizationContext) = fortunaNormalizer.normalizeMarket(structuredClone(raw), ctx)`
  - `legs(out: NormalizedMarketOutput | null): string[]`: `` `${code}@${odds}` `` per selection.
- Produces (normalizer):
  - `"ufo:mtyp:00-0p": "CORNERS_RACE"`.
  - Before the half-scope reroute, any `MATCH_WINNER` whose `raw.name` matches `/rzut(?:[oó]w)?\s+ro[żz]nych/iu` becomes `CORNERS_RACE`.
  - The reroute maps `CORNERS_RACE` with a `1.` prefix to `HALF_TIME_CORNERS_RACE` and with a `2.` prefix to `SECOND_HALF_CORNERS_RACE`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("Task 1: corners races never feed a 1X2 code", () => {
  it("arsenalHull 00-0p '1. połowa: więcej rzutów rożnych' is HALF_TIME_CORNERS_RACE", () => {
    const { raw, ctx } = live("arsenalHull", "00-0p");
    const out = run(raw, ctx);
    expect(out?.marketKey).toBe("HALF_TIME_CORNERS_RACE");
    expect(legs(out)).toEqual(["AWAY@5.2", "HOME@1.31", "DRAW@6.2"]);
  });
  it.each([
    ["manUtdVilla", ["HOME@1.85", "DRAW@5.2", "AWAY@2.6"], ["AWAY@3.45", "DRAW@2.38", "HOME@2.6"]],
    ["ipswichBournemouth", ["AWAY@1.95", "DRAW@4.8", "HOME@2.5"], ["AWAY@2.38", "DRAW@2.3", "HOME@4.1"]],
  ])("%s: the corners race and the real '1.połowa' never share HALF_TIME_RESULT", (group, race, ht) => {
    const a = run(live(group, "00-0p").raw, ctxOf(group));
    expect(a?.marketKey).toBe("HALF_TIME_CORNERS_RACE");
    expect(legs(a)).toEqual(race);
    const b = run(live(group, "00-2d").raw, ctxOf(group));
    expect(b?.marketKey).toBe("HALF_TIME_RESULT");
    expect(legs(b)).toEqual(ht);
  });
  it("arsenalHull 00-2d '1.połowa' stays HALF_TIME_RESULT", () => {
    expect(legs(run(live("arsenalHull", "00-2d").raw, ctxOf("arsenalHull")))).toEqual(["AWAY@12", "DRAW@2.95", "HOME@1.49"]);
  });
  it("arsenalHull 00-0e 'Mecz: wiecej rzutow roznych' stays CORNERS_RACE", () => {
    const out = run(live("arsenalHull", "00-0e").raw, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe("CORNERS_RACE");
    expect(legs(out)).toEqual(["AWAY@6.6", "DRAW@13", "HOME@1.14"]);
  });
  // synthetic (no live payload): the full-match and second-half shapes, and a plain MATCH_WINNER id
  const race = [{ name: "Hull", odds: 6.4 }, { name: "Arsenal", odds: 1.14 }, { name: "rowno", odds: 12 }];
  it.each(["00-0p", "00-60"])("%s 'Mecz: więcej rzutów rożnych' is CORNERS_RACE, never MATCH_WINNER", (id) => {
    const out = run({ bookmakerMarketId: `ufo:mtyp:${id}`, name: "Mecz: więcej rzutów rożnych", selections: race }, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe("CORNERS_RACE");
    expect(legs(out)).toEqual(["AWAY@6.4", "HOME@1.14", "DRAW@12"]);
  });
  it("00-0p '2. połowa: więcej rzutów rożnych' is SECOND_HALF_CORNERS_RACE", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-0p", name: "2. połowa: więcej rzutów rożnych",
      selections: [{ name: "Hull", odds: 4 }, { name: "Arsenal", odds: 1.4 }, { name: "Rowno", odds: 5.5 }] }, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe("SECOND_HALF_CORNERS_RACE");
    expect(legs(out)).toEqual(["AWAY@4", "HOME@1.4", "DRAW@5.5"]);
  });
  it("a plain 'Mecz' 1X2 under 00-60 stays MATCH_WINNER", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-60", name: "Mecz",
      selections: [{ name: "Arsenal", odds: 1.16 }, { name: "Remis", odds: 7.2 }, { name: "Hull", odds: 15.5 }] }, ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("MATCH_WINNER");
    expect(legs(out)).toEqual(["HOME@1.16", "DRAW@7.2", "AWAY@15.5"]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/fortuna-health-2026-11.test.ts -t "Task 1"`
Expected: FAIL.
- The live `00-0p` rows get `HALF_TIME_RESULT`.
- `Mecz:` under `00-0p`/`00-60` gets `MATCH_WINNER`.
- `2. połowa` gets `SECOND_HALF_RESULT`.
- The `00-2d`, `00-0e` and plain-`Mecz` tests already pass.

- [ ] **Step 3: Implement** the id-map entry, the guard, the reroute branch and the two case labels (Interfaces). Replace the id-map comment so it says `00-0p` is the corners race.

- [ ] **Step 4: Run tests**: the Step 2 command → PASS.

- [ ] **Step 5: Inspect and rebless**

Run: `npx tsx scripts/rebless-golden.ts --bookmaker fortuna --dry`
Expected:
- stderr: `[rebless] fortuna/world-cup-2026_france_morocco: 1 entry updated` and `    - 1. połowa: więcej rzutów rożnych`
- stdout: `{"changedTotal":1,"dry":true}`

Then:
1. Run the same command without `--dry` → `{"changedTotal":1,"dry":false}`.
2. `git diff --numstat -- src/services/normalization/__fixtures__/fortuna/world-cup-2026_france_morocco.expected.json` → `3	3	…`. `git diff -U0` shows only entry `"index": 861`: its `marketCode` and its `expected.marketCode` / `expected.marketKey` go from `HALF_TIME_RESULT` to `HALF_TIME_CORNERS_RACE`, while the odds 1.46 / 5.4 / 4 and the codes HOME / DRAW / AWAY stay unchanged. If anything else changed, stop and inspect.
3. `node_modules/.bin/tsx $E/golden-drift.mts --since /tmp/fortuna-golden-before.txt` → `GOLDEN_DRIFT_NEW {"blessed":[],"unblessed":[],"gone":[]}`.
4. Golden `-t fortuna` → `failures=0`.

- [ ] **Step 6: Commit** (after tsc + full vitest)

```bash
git add src/services/normalization/bookmakers/fortuna-normalizer.ts src/services/normalization/bookmakers/__tests__/fortuna-health-2026-11.test.ts src/services/normalization/bookmakers/__tests__/fixtures/fortuna-health-2026-11.inputs.json src/services/normalization/__fixtures__/fortuna/world-cup-2026_france_morocco.expected.json
git commit -m "fix(fortuna): keep corners races out of 1X2 codes"
```

### Task 2: Every player market carries its player (D2, D4)

**Files:**
- Modify: `fortuna-normalizer.ts`:
  - `:390-402`: docstring and `stripFortunaLeadingTeamToken`.
  - `:440-446`: single-name fallback after the no-comma fallback.
  - `:1432-1466`: null guard between `parlayPlayerParam` and `paramValue`.
  - `verbMatch` (`:433-436`) stays as it is, unanchored (D4).
- Test: same file as Task 1.

**Interfaces:**
- Produces: `isStrictFortunaTeamPrefix(prefix: string, teamName: string): boolean`. True when every token of `prefix`, split on `/[\s.]+/` and folded (NFD, combining marks removed, lowercase), has ≥ 3 characters and is a prefix of some folded token of `teamName`.
- `stripFortunaLeadingTeamToken(name, ctx)` keeps its signature. For n = 3, then n = 2, it strips the first n whitespace-separated tokens when `normalize1x2Selection(prefix, …)` is HOME/AWAY and `isStrictFortunaTeamPrefix(prefix, side === "HOME" ? ctx.homeTeam : ctx.awayTeam)` holds. Otherwise it applies today's single-token rule, with the token regex widened to `/^([\p{Lu}][\p{L}'.-]*)\s+/u`.
- `extractFortunaPlayerName`: after the no-comma fallback, a single capitalised token followed by ` - `, `liczba ` or a verb is the player: `/^([\p{Lu}][\p{L}'’.-]+)\s+(?:-\s+|liczba\s|(?:strzeli|asystuje|otrzyma|zaliczy|odda)\b)/u`. The exceptions are a token that resolves to HOME/AWAY and the tokens `Mecz`, `SuperSub` and `Zawodnik`. The result is canonicalized through `canonicalizeFortunaPlayerName`.
- `normalizeMarket`: when `isPlayerMarket && !playerName && !parlayPlayerParam && marketCode !== "PLAYER_RED_CARD"`, call ``console.warn(`[fortuna] Player market without extractable player: "${raw.name}" (id: ${marketId ?? "none"})`)`` and `return null`. Acceptance criterion 5 and the smoke's `--warn-pattern` count this exact text.
- **Amended by the Task 2 review (fix round 1), from live laliga/serie-a/ligue-1 captures of 2026-11-07:**
  - `isStrictFortunaTeamPrefix(prefix, teamName, league?)` also holds when `prefix` resolves to `teamName` through an exact alias (`matchTeamByExactAlias` in `src/utils/team-matcher.ts`: raw or normalized alias key, never the substring or fuzzy tiers), e.g. `AS Roma`, `Atl. Madryt`. Otherwise the prefix's segments (whitespace tokens, split after each dot) must match distinct team tokens in order, at least one segment must be an anchor (≥ 3 characters, prefix of the token), and the others may be a dotted abbreviation of any length (`Real M.`) or a short token equal to the whole team token (`AC`, `Le`, `FC`, `A`).
  - The single-token rule uses the same check (no fuzzy-only strip), so `Van den Boomen, Branco` keeps `Van`.
  - The no-comma fallback allows the lowercase particles `de del della di da dos du la le van von den der` between capitalized words, and backtick, acute and left-quote apostrophes are read as `'` before matching (`N`Goumou`).
  - Fortuna aliases: `Atl. Madryt` and `Atl.Madrid` → Atletico Madrid (the fuzzy tier sent both to Real Madrid), `FC Sevilla` → Sevilla, `A.Bergamo` → Atalanta.

- [ ] **Step 1: Write the failing tests**

```ts
describe("Task 2: every player market carries its player", () => {
  // The 19 Forest–City rows that sit in 'base' today (00-76 red card and the unmapped 00-he/lj/ok/og/ev excluded).
  const MURILLO = ["00-hm", "00-la", "00-lg", "00-ld", "00-lf", "00-o6", "00-oi", "00-pn", "00-lk", "00-on",
                   "00-ne", "00-oe", "00-oy", "00-ow", "00-oz", "00-ng", "00-ln", "00-ox", "00-hh"];
  it.each(MURILLO)("forestCity single-name player row %s keys <code>:Murillo", (id) => {
    const out = run(live("forestCity", id, "Murillo").raw, ctxOf("forestCity"));
    expect(out?.paramValue).toBe("Murillo");
    expect(out?.marketKey).toBe(`${out?.marketCode}:Murillo`);
  });
  it.each([
    ["00-lf", "PLAYER_SHOTS:Murillo", ["1+@1.7", "2+@4.25"]],
    ["00-ne", "GOALSCORER_FIRST:Murillo", ["PLAYER@30"]],
    ["00-ox", "PLAYER_HEADER_GOAL:Murillo", ["PLAYER_NAME@30"]],
    ["00-hm", "PLAYER_GOAL_OR_ASSIST:Murillo", ["PLAYER@8.5"]],
  ])("forestCity Murillo %s -> %s with peer-shaped selections", (id, key, expected) => {
    const out = run(live("forestCity", id, "Murillo").raw, ctxOf("forestCity"));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(expected);
  });
  it.each([
    ["manUtdVilla", "00-ne", "Tielemans", "GOALSCORER_FIRST:Youri Tielemans", "PLAYER@12"],
    ["manUtdVilla", "00-nf", "McGinn", "GOALSCORER_FIRST:John McGinn", "PLAYER@9"],
    ["manUtdVilla", "00-nf", "Hemmings", "GOALSCORER_FIRST:George Lawrence Hemmings", "PLAYER@11"],
    ["forestCity", "00-nf", "Dias", "GOALSCORER_FIRST:Ruben Dias", "PLAYER@40"],
    ["evertonCoventry", "00-nf", "Thomas", "GOALSCORER_FIRST:Bobby Thomas", "PLAYER@30"],
    ["palaceLiverpool", "00-ne", "Nketiah", "GOALSCORER_FIRST:Eddie Nketiah", "PLAYER@5"],
  ])("%s %s %s: the team prefix never leaks into the player", (group, id, needle, key, leg) => {
    const out = run(live(group, id, needle).raw, ctxOf(group));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual([leg]);
  });
  it("a mononym behind a dotted prefix keeps its name (Man.City Rodri)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-nf", name: "Man.City\u00a0Rodri\u00a0strzeli pierwszego gola w meczu (OPTA)",
      selections: [{ name: "Tak", odds: 21 }] }, ctxOf("forestCity")); // synthetic: live prefix + live mononym shape
    expect(out?.marketKey).toBe("GOALSCORER_FIRST:Rodri");
    expect(legs(out)).toEqual(["PLAYER@21"]);
  });
  it.each([
    ["arsenalHull", "00-nf", "Herrington", "GOALSCORER_FIRST:Lucas Herrington"],
    ["forestCity", "00-lf", "Diomande", "PLAYER_SHOTS:Ousmane Diomande"],
    ["forestCity", "00-ne", "Diomande", "GOALSCORER_FIRST:Ousmane Diomande"],
    ["leedsTottenham", "00-nf", "Van de Ven", "GOALSCORER_FIRST:Micky Ven"],
    ["leedsTottenham", "00-nh", "Van de Ven", "GOALSCORER_LAST:Micky Ven"],
    ["brightonBrentford", "00-ne", "Loureiro", "GOALSCORER_FIRST:Joao Pedro Costa"],
  ])("%s %s %s keeps today's key %s", (group, id, needle, key) => {
    expect(run(live(group, id, needle).raw, ctxOf(group))?.marketKey).toBe(key);
  });
  it.each([
    // synthetic: the docstring shapes of extractFortunaPlayerName (WC and Ekstraklasa payloads)
    [{ homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" }, "00-nf", "Maroko Diop, Issa strzeli pierwszego gola w meczu (OPTA)", "Tak", "GOALSCORER_FIRST:Issa Diop"],
    [{ homeTeam: "Cape Verde", awayTeam: "Spain", league: "world-cup-2026" }, "00-ne", "W.Ziel.Przyl. Cabral, Jovane strzeli pierwszego gola w meczu (OPTA)", "Tak", "GOALSCORER_FIRST:Jovane Cabral"],
    [{ homeTeam: "Nottingham Forest", awayTeam: "Manchester City", league: "premier-league" }, "00-pn", "Youssef Belammari liczba spalonych w 1.połowie (OPTA)", "1+", "PLAYER_OFFSIDES_1H:Youssef Belammari"],
  ])("today's shape %#: %s keeps its key", (ctx, id, name, sel, key) => {
    expect(run({ bookmakerMarketId: `ufo:mtyp:${id}`, name, selections: [{ name: sel, odds: 3 }] }, ctx)?.marketKey).toBe(key);
  });
  it("a team name where the player should be yields no row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-lf", name: "Nottingham\u00a0- liczba strzałów\u00a0(OPTA)",
      selections: [{ name: "1+", odds: 1.1 }] }, ctxOf("forestCity")); // synthetic
    expect(out).toBeNull();
    expect(warn.mock.calls.flat().join(" ")).toContain("Player market without extractable player");
    warn.mockRestore();
  });
  it("PLAYER_RED_CARD rows keep today's shape (no param, player in the selection)", () => {
    expect(legs(run(live("forestCity", "00-76").raw, ctxOf("forestCity")))).toEqual(["Murillo wyrzucony z boiska@29"]);
    const wc = run({ bookmakerMarketId: "ufo:mtyp:00-76", name: "Dayot Upamecano wyrzucony z boiska",
      selections: [{ name: "Dayot Upamecano wyrzucony z boiska", odds: 29 }] }, { homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" }); // WC entry 1728
    expect(wc?.marketKey).toBe("PLAYER_RED_CARD");
    expect(legs(wc)).toEqual(["Dayot Upamecano wyrzucony z boiska@29"]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/fortuna-health-2026-11.test.ts -t "Task 2"`
Expected: FAIL.
- The Murillo rows have `paramValue` undefined and a bare key (e.g. `PLAYER_SHOTS`), and `00-ne` gives `Tak@30`.
- The leak rows give e.g. `GOALSCORER_FIRST:Youri United Tielemans` and `GOALSCORER_FIRST:Villa George Lawrence Hemmings`.
- Rodri gives `GOALSCORER_FIRST:Man.City Rodri`.
- The team-name case returns `PLAYER_SHOTS` instead of null.
- The "keeps today's key" and red-card tests already pass; they are the regression guards.

- [ ] **Step 3: Implement** `isStrictFortunaTeamPrefix`, the new `stripFortunaLeadingTeamToken`, the single-name fallback and the null guard (Interfaces). Update the docstring at `:390-397`: dotted and multi-word prefixes are now stripped, under the strict-prefix rule.

- [ ] **Step 4: Run tests and both drift checks**

Run: the Step 2 command, then `npx vitest run src/services/normalization`. Expected: PASS.
Run: `node_modules/.bin/tsx $E/golden-drift.mts --since /tmp/fortuna-golden-before.txt`. Expected: `GOLDEN_DRIFT_NEW {"blessed":[],"unblessed":[],"gone":[]}` (no WC player entry changes; prototype).
Run: `node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna premier-league $CODES --from /tmp/fortuna-capture.json --count-ids $IDS --warn-pattern 'without extractable player'`. Expected: `"warnPatternCount":0`, and every `perMatch` `normalized`/`other` pair identical to `/tmp/fortuna-smoke-before.txt`. Task 2 changes keys, not counts.

- [ ] **Step 5: Commit**

```bash
git add src/services/normalization/bookmakers/fortuna-normalizer.ts src/services/normalization/bookmakers/__tests__/fortuna-health-2026-11.test.ts
git commit -m "fix(fortuna): keep the player on every player market"
```

### Task 3: Map the five new market types (D3)

**Files:**
- Modify: `fortuna-normalizer.ts`:
  - id map: add the five entries after `00-9b` / `00-r7` (`:207-208`).
  - `:126-127`: replace the stale note with `// 00-k6 "Mecz: liczba asyst w meczu" -> ASSISTS_TOTAL (O/U; the line comes from the selection).`
  - `:761-789`: add `case "ASSISTS_TOTAL":` to the O/U case group, after `case "AWAY_TEAM_TOTAL_OFFSIDES":` (line 784).
- Test: same file.

**Interfaces:**
- Produces: `"ufo:mtyp:00-9a": "PENALTY_AWARDED"`, `"ufo:mtyp:00-bt": "RED_CARD_AND_PENALTY"`, `"ufo:mtyp:00-bv": "OWN_GOAL"`, `"ufo:mtyp:00-k7": "HEADER_GOAL"`, `"ufo:mtyp:00-k6": "ASSISTS_TOTAL"`.
- The default branch (`:1071-1077`) already maps Tak/Nie to YES/NO. `extractParamValue` already yields the `ASSISTS_TOTAL` line.

- [ ] **Step 1: Write the failing tests**

```ts
describe("Task 3: five new market types", () => {
  it.each([
    ["00-9a", "Mecz: rzut karny", "PENALTY_AWARDED", ["NO@1.29", "YES@3.35"]],
    ["00-bt", "Mecz: rzut karny i czerwona kartka", "RED_CARD_AND_PENALTY", ["NO@1.01", "YES@12"]],
    ["00-bv", "Mecz: gol samobójczy", "OWN_GOAL", ["NO@1.05", "YES@8"]],
    ["00-k7", "Mecz: gol zdobyty strzałem głową", "HEADER_GOAL", ["NO@1.45", "YES@2.6"]],
  ])("arsenalHull %s %s -> %s", (id, _name, key, expected) => {
    const out = run(live("arsenalHull", id).raw, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(expected);
  });
  it("arsenalHull 00-k6 'Mecz: liczba asyst w meczu' -> one ASSISTS_TOTAL key per line", () => {
    const outs = liveAll("arsenalHull", "00-k6").map((raw) => run(raw, ctxOf("arsenalHull")));
    expect(outs.map((o) => o?.marketKey).sort()).toEqual(["ASSISTS_TOTAL:1.5", "ASSISTS_TOTAL:2.5"]);
    expect(outs.map(legs)).toEqual(expect.arrayContaining([["OVER@2.3", "UNDER@1.56"], ["OVER@1.18", "UNDER@4.4"]]));
  });
  it("arsenalHull 00-bu stays unmapped (open question 1)", () => {
    expect(run(live("arsenalHull", "00-bu").raw, ctxOf("arsenalHull"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**: `… -t "Task 3"` → FAIL: the five ids return `null` (`[fortuna] Unknown market`). The `00-bu` test passes.

- [ ] **Step 3: Implement** the five map entries, the case label and the comment (Interfaces).

- [ ] **Step 4: Run tests and drift**

Run: the Step 2 command, then `npx vitest run src/services/normalization`. Expected: PASS.
Run: `npx tsx scripts/rebless-golden.ts --bookmaker fortuna --dry`. Expected: `{"changedTotal":0,"dry":true}`.
Run: `node_modules/.bin/tsx $E/golden-drift.mts --since /tmp/fortuna-golden-before.txt`. Expected: `{"blessed":[],"unblessed":[1751,1897,1898,1900,1902,1903],"gone":[]}`. Amended by the Task 3 review (fix round 1): `00-bt` is held back, so 1898 stays `null` and the list is `[1751,1897,1900,1902,1903]`.

- [ ] **Step 5: Commit**: `git commit -m "feat(fortuna): map penalty, own goal, header goal and assists markets"` (normalizer + test file).

### Task 4: Map seventeen pre-existing ids with catalog codes (D5 minus exact goals)

**Files:**
- Modify: `fortuna-normalizer.ts`:
  - id map: 17 entries.
  - `FORTUNA_TEAM_SCOPED_ID_SIDE` (`:494-512`): add `00-07` HOME, `00-08` AWAY, `00-0c` HOME, `00-0d` AWAY.
  - `FORTUNA_SIDED_CODE_FLIP` (`:542-555`): add the HOME/AWAY pairs of `WIN_TO_NIL`, `WIN_BOTH_HALVES`, `SCORE_BOTH_HALVES` and `WIN_AT_LEAST_ONE_HALF` (8 entries).
  - flip block (`:1373-1379`): add the new fallback.
  - after the `teamWinMatchSide` param (`:1471-1473`): the red-card team param.
  - new `case "WINNING_MARGIN"` before `default:` (`:1071`).
  - UNKNOWN-drop list (`:1547-1562`): add `FIRST_CORNER`.
- Test: same file.

**Interfaces:**
- id map: `00-2n` `HALF_TIME_BTTS`, `00-1h` `HOME_WIN_TO_NIL`, `00-1i` `AWAY_WIN_TO_NIL`, `00-1o` `HOME_WIN_BOTH_HALVES`, `00-1p` `AWAY_WIN_BOTH_HALVES`, `00-2b` `HOME_SCORE_BOTH_HALVES`, `00-2c` `AWAY_SCORE_BOTH_HALVES`, `00-1r` `HOME_WIN_AT_LEAST_ONE_HALF`, `00-1s` `AWAY_WIN_AT_LEAST_ONE_HALF`, `00-07`/`00-08` `RED_CARD_TEAM`, `00-0c`/`00-0d` `HALF_TIME_RED_CARD_TEAM`, `00-0a` `HALF_TIME_RED_CARD`, `00-0f` `FIRST_CORNER`, `00-19` `ODD_EVEN_GOALS`, `00-09` `WINNING_MARGIN`.
- Produces: `resolveFortunaPrefixTeamSide(rawName: string, ctx: NormalizationContext): "HOME" | "AWAY" | undefined`. The team token is the scope-stripped name up to the first `/\s+(?:-\s|dok[łl]adna\s)/u`, resolved with `normalize1x2Selection`. It has two uses:
  - the fallback after `resolveFortunaTeamSide` in the flip block;
  - with `FORTUNA_TEAM_SCOPED_ID_SIDE[marketId]` as the next fallback, the `paramValue` of `RED_CARD_TEAM` / `HALF_TIME_RED_CARD_TEAM`. When neither yields a side, `return null`.
- `WINNING_MARGIN` selection:
  - draw label → `DRAW`
  - `/^(.+?)\s*\/\s*o\s+(\d+)\s+gol/iu` → `` `${side}_BY_${n >= 3 ? "3PLUS" : n}` `` (side from `normalize1x2Selection`)
  - anything else → `UNKNOWN`
- `FIRST_CORNER`: team names resolve through the default branch; `Nikt` becomes UNKNOWN and is dropped. `ODD_EVEN_GOALS` uses the existing case (`:927-936`).
- **Amended by the Task 4 review (fix round 1), from the 2026-11-07 PL captures and the :3001 peers:**
  - `00-07`/`00-08` are not mapped. No owner decision covers the `(bez CK dla trenera i sztabu)` settlement, and their YES is +5.1% to +18.2% above the peer median on all 18 PL rows and above every peer on 10 of them (Risks). They stay `[fortuna] Unknown market` and `null`, like `00-bt`. Their `FORTUNA_TEAM_SCOPED_ID_SIDE` entries and the red-card team param stay, so re-enabling them is the two id-map lines plus the two `RED_CARD_TEAM` test rows.
  - `00-0c`/`00-0d`/`00-0a` carry the same exclusion label and stay mapped: `00-0a` YES is −3.8% to +8.4% from the peer median, and `00-0c`/`00-0d` have one peer (etoto) at identical prices. `00-06` → `RED_CARD` on `master` has the same label and prices inside the peer range. The owner's decision on the label should cover all of them.
  - `FIRST_CORNER` has its own selection case: `Nikt` (and `żaden`/`brak`) gives `UNKNOWN` before team matching. Through the default branch, `normalize1x2Selection("Nikt", "Leeds United", …)` resolves to HOME via the fuzzy canonical fallback and would publish `HOME@100` next to the real HOME leg.
  - `WINNING_MARGIN` is also in the UNKNOWN-drop list (ledger P13). A market with any leg of margin 4 or more is dropped with a `[fortuna] WINNING_MARGIN` warning, because `o 3 gole` would then mean exactly 3. `n < 1` gives `UNKNOWN`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("Task 4: seventeen pre-existing ids with catalog codes", () => {
  it.each([
    ["arsenalHull", "00-2n", "HALF_TIME_BTTS", ["NO@1.12", "YES@5.4"]],
    ["arsenalHull", "00-1h", "HOME_WIN_TO_NIL", ["YES@1.65", "NO@2.02"]],
    ["arsenalHull", "00-1i", "AWAY_WIN_TO_NIL", ["YES@9.4", "NO@1.01"]],
    ["arsenalHull", "00-1o", "HOME_WIN_BOTH_HALVES", ["YES@2.18", "NO@1.61"]],
    ["forestCity", "00-1p", "AWAY_WIN_BOTH_HALVES", ["YES@4.2", "NO@1.18"]],
    ["arsenalHull", "00-2b", "HOME_SCORE_BOTH_HALVES", ["NO@1.99", "YES@1.73"]],
    ["arsenalHull", "00-2c", "AWAY_SCORE_BOTH_HALVES", ["YES@9.6", "NO@1.02"]],
    ["arsenalHull", "00-1r", "HOME_WIN_AT_LEAST_ONE_HALF", ["YES@1.09", "NO@6"]],
    ["arsenalHull", "00-1s", "AWAY_WIN_AT_LEAST_ONE_HALF", ["NO@1.12", "YES@5.4"]],
    ["arsenalHull", "00-07", "RED_CARD_TEAM:HOME", ["NO@1.02", "YES@11"]],
    ["arsenalHull", "00-08", "RED_CARD_TEAM:AWAY", ["NO@1.06", "YES@8.2"]],
    ["arsenalHull", "00-0c", "HALF_TIME_RED_CARD_TEAM:HOME", ["NO@1.01", "YES@12"]],
    ["arsenalHull", "00-0d", "HALF_TIME_RED_CARD_TEAM:AWAY", ["YES@12", "NO@1.01"]],
    ["arsenalHull", "00-0a", "HALF_TIME_RED_CARD", ["NO@1.01", "YES@11"]],
    ["forestCity", "00-0f", "FIRST_CORNER", ["HOME@2.21", "AWAY@1.59"]],
    ["arsenalHull", "00-19", "ODD_EVEN_GOALS", ["EVEN@1.91", "ODD@1.9"]],
    ["arsenalHull", "00-09", "WINNING_MARGIN",
      ["AWAY_BY_3PLUS@100", "DRAW@7", "HOME_BY_2@3.7", "HOME_BY_3PLUS@2.24", "AWAY_BY_1@20", "AWAY_BY_2@90", "HOME_BY_1@4"]],
  ])("%s %s -> %s", (group, id, key, expected) => {
    const out = run(live(group, id).raw, ctxOf(group));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(expected);
  });
  it("a pair id follows the team named in its label (00-1h quoting Hull -> AWAY_WIN_TO_NIL)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-1h", name: "Mecz:\u00a0Hull\u00a0- wygra do zera",
      selections: [{ name: "Tak", odds: 9.2 }, { name: "Nie", odds: 1.01 }] }, ctxOf("arsenalHull")); // synthetic
    expect(out?.marketKey).toBe("AWAY_WIN_TO_NIL");
    expect(legs(out)).toEqual(["YES@9.2", "NO@1.01"]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**: `… -t "Task 4"` → FAIL: every row returns `null` (`[fortuna] Unknown market`).

- [ ] **Step 3: Implement** (Interfaces).

- [ ] **Step 4: Run tests and drift**

Run: the Step 2 command, then `npx vitest run src/services/normalization`. Expected: PASS.
Run: `npx tsx scripts/rebless-golden.ts --bookmaker fortuna --dry`. Expected: `{"changedTotal":0,"dry":true}`.
Run: `node_modules/.bin/tsx $E/golden-drift.mts --since /tmp/fortuna-golden-before.txt`. Expected: `{"blessed":[],"unblessed":[860,1751,1774,1802,1809,1817,1821,1834,1858,1872,1876,1883,1897,1898,1900,1902,1903,1936,1955,1959,1962,1967,1995],"gone":[]}`. That is Task 3's six plus Task 4's seventeen, in entry order. Amended by the Task 3 and Task 4 reviews: 1898 (`00-bt`), 1936 and 1962 (`00-07`/`00-08`) stay `null`, so the list is `[860,1751,1774,1802,1809,1817,1821,1834,1858,1872,1876,1883,1897,1900,1902,1903,1955,1959,1967,1995]` (20 entries).

- [ ] **Step 5: Commit**: `git commit -m "feat(fortuna): map half, team and margin markets that have catalog codes"`.

### Task 5: Exact-goals markets keep their digit labels (D6)

**Files:**
- Modify: `src/scrapers/bookmakers/fortuna/parser.ts:138-143`: exempt `ufo:mtyp:00-16`, `ufo:mtyp:00-17` and `ufo:mtyp:00-3e` the same way as `00-0v`/`00-0w`, via a `Set` of ids declared next to that block, with a comment.
- Create: `src/scrapers/bookmakers/fortuna/__tests__/exact-goals-selection.test.ts`. Mirror `corner-range-team-selection.test.ts`; teams `{ homeTeam: "Arsenal", awayTeam: "Hull" }`; outcomes from `$E/raw-exact-goals-arsenal-hull.json`.
- Modify: `fortuna-normalizer.ts`:
  - id map: `00-16` `HOME_EXACT_GOALS`, `00-17` `AWAY_EXACT_GOALS`, `00-3e` `SECOND_HALF_EXACT_GOALS`.
  - `FORTUNA_SIDED_CODE_FLIP`: add the `HOME_EXACT_GOALS` / `AWAY_EXACT_GOALS` pair. `resolveFortunaPrefixTeamSide` (Task 4) reads `Arsenal dokładna …`.
  - selection switch: one case for the three codes that translates the legacy parser labels (draw label → `"0"`, HOME → `"1"`, AWAY → `"2"`, otherwise `UNKNOWN`). The frozen WC raw and any old capture still carry those labels. Digit labels already pass through the literal passthrough (`:680-691`).
- Test: same normalizer test file.

- [ ] **Step 1: Write the failing tests**

```ts
// exact-goals-selection.test.ts
// market(marketTypeId: string, name: string, outcomes: Array<[string, number]>): FortunaMarket builds outcomes
// { id, name: code, longName: code, odds } exactly as the API sends them (see raw-exact-goals-arsenal-hull.json).
describe("exact-goals selection labels", () => {
  it.each([
    ["ufo:mtyp:00-16", "Arsenal dokładna liczba goli", [["2", 3.55], ["3+", 1.85], ["1", 4.7], ["0", 12]], ["2", "3+", "1", "0"]],
    ["ufo:mtyp:00-17", "Hull dokładna liczba goli", [["0", 1.55], ["1", 2.8], ["3+", 50], ["2", 10]], ["0", "1", "3+", "2"]],
    ["ufo:mtyp:00-3e", "2.połowa: dokładna liczba goli", [["0", 4.9], ["1", 2.95], ["2+", 1.81]], ["0", "1", "2+"]],
  ])("keeps the digit labels of %s (never Remis or a team name)", (marketTypeId, name, outcomes, expected) => {
    expect(parseAllMarkets([market(marketTypeId, name, outcomes)], teams)[0].selections.map((s) => s.name)).toEqual(expected);
  });
  it("still maps bare 1X2 codes to team names for ufo:mtyp:00-00", () => {
    const out = parseAllMarkets([market("ufo:mtyp:00-00", "Mecz", [["1", 1.16], ["0", 7.2], ["2", 15.5]])], teams);
    expect(out[0].selections.map((s) => s.name)).toEqual(["Arsenal", "Remis", "Hull"]);
  });
});

// fortuna-health-2026-11.test.ts
describe("Task 5: exact-goals markets", () => {
  it.each([
    ["00-16", "HOME_EXACT_GOALS", ["2@3.55", "3+@1.85", "1@4.7", "0@12"]],
    ["00-17", "AWAY_EXACT_GOALS", ["0@1.54", "1@2.8", "3+@50", "2@10"]],
    ["00-3e", "SECOND_HALF_EXACT_GOALS", ["0@4.9", "1@2.95", "2+@1.81"]],
  ])("arsenalHull %s with today's parser labels -> %s", (id, key, expected) => {
    const out = run(live("arsenalHull", id).raw, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe(key);
    expect(legs(out)).toEqual(expected);
  });
  it("digit labels from the fixed parser give the same codes (00-16)", () => {
    const out = run({ bookmakerMarketId: "ufo:mtyp:00-16", name: "Arsenal dokładna liczba goli",
      selections: [{ name: "2", odds: 3.55 }, { name: "3+", odds: 1.85 }, { name: "1", odds: 4.7 }, { name: "0", odds: 12 }] },
      ctxOf("arsenalHull")); // synthetic: raw-exact-goals-arsenal-hull.json after the Task 5 parser
    expect(out?.marketKey).toBe("HOME_EXACT_GOALS");
    expect(legs(out)).toEqual(["2@3.55", "3+@1.85", "1@4.7", "0@12"]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/scrapers/bookmakers/fortuna src/services/normalization/bookmakers/__tests__/fortuna-health-2026-11.test.ts -t "exact"`
Expected: FAIL.
- The parser test gets `["Hull","3+","Arsenal","Remis"]`.
- The normalizer rows return `null`.
- The 1X2 parser guard passes.

- [ ] **Step 3: Implement** (Files).

- [ ] **Step 4: Run tests and drift**

Run: the Step 2 command, then `npx vitest run src/services/normalization src/scrapers/bookmakers/fortuna`. Expected: PASS.
Run: `npx tsx scripts/rebless-golden.ts --bookmaker fortuna --dry`. Expected: `{"changedTotal":0,"dry":true}`.
Run: `node_modules/.bin/tsx $E/golden-drift.mts --since /tmp/fortuna-golden-before.txt`. Expected: `{"blessed":[],"unblessed":[860,1751,1774,1802,1809,1817,1821,1834,1858,1872,1876,1883,1897,1898,1900,1902,1903,1936,1955,1956,1959,1962,1967,1991,1992,1995],"gone":[]}`. That is 26 entries, the list under Impact. Amended by the Task 3 and Task 4 reviews: 1898, 1936 and 1962 stay `null` (held back), so the expected list is the 23 entries of the Impact amendment: `[860,1751,1774,1802,1809,1817,1821,1834,1858,1872,1876,1883,1897,1900,1902,1903,1955,1956,1959,1967,1991,1992,1995]`.

- [ ] **Step 5: Commit**: `git commit -m "fix(fortuna): keep exact-goals digit labels and map exact-goals markets"` (parser, parser test, normalizer, normalizer test).

### Task 6 (only if open question 3 is answered "route it"): `Wynik meczu lub 2 gol(e) PRZEWAGI`

**Files:**
- Modify: `fortuna-normalizer.ts:1159-1165` (the `wynik meczu lub` guard).
- Modify, option (a) only: `:737-753` (case list).
- Test: same file. These expectations were not prototyped. They follow from the existing 1X2 selection mapping.

**Interfaces:**
- Inside the guard, test `normalizeMarketName(raw.name)` against `/^wynik meczu lub\s+2\s+gol/`:
  - option (a): `MATCH_RESULT_OR_WIN_BY_2`, with the 1X2 selection mapping (add the code to the case list).
  - option (b): `WIN_OR_WIN_BY_2`, keeping only the HOME/AWAY legs (drop the draw label).
- Every other `wynik meczu lub` name, including the `1 gol(e)` variant, still returns `null`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("Task 6: result or a 2-goal lead", () => {
  it("arsenalHull 00-p1 '… 2 gol(e) PRZEWAGI' is routed", () => {
    const out = run(live("arsenalHull", "00-p1", "\u00a02\u00a0").raw, ctxOf("arsenalHull"));
    expect(out?.marketKey).toBe("MATCH_RESULT_OR_WIN_BY_2");            // option (b): "WIN_OR_WIN_BY_2"
    expect(legs(out)).toEqual(["DRAW@6.5", "AWAY@12.5", "HOME@1.14"]);  // option (b): ["AWAY@12.5", "HOME@1.14"]
  });
  it("arsenalHull 00-p1 '… 1 gol(e) PRZEWAGI' stays dropped", () => {
    expect(run(live("arsenalHull", "00-p1", "\u00a01\u00a0").raw, ctxOf("arsenalHull"))).toBeNull();
  });
});
```

- [ ] **Step 2:** `… -t "Task 6"` → FAIL: the first test gets `null`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Tests PASS. `golden-drift.mts --since …` adds `1790` (WC `Wynik meczu lub 2 gol(e)`, unblessed), and `1874` does not change. The rebless `--dry` gives `{"changedTotal":0,"dry":true}`.
- [ ] **Step 5: Commit**: `git commit -m "feat(fortuna): route result-or-2-goal-lead market"`.

### Task 7: Live verification (no code)

- [ ] **Step 1: Same capture.**

```bash
node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna premier-league $CODES --from /tmp/fortuna-capture.json --count-ids $IDS --warn-pattern 'without extractable player' | grep '^SMOKE_RESULT' > /tmp/fortuna-smoke-after.txt
python3 -I -c "import json;b,a=[json.loads(open(f).read().split(' ',1)[1]) for f in ('/tmp/fortuna-smoke-before.txt','/tmp/fortuna-smoke-after.txt')];print(all(y['normalized']-x['normalized']==y['idRaw']==x['other']-y['other'] for x,y in zip(b['perMatch'],a['perMatch'])),a['warnPatternCount'],a['otherMarketShare'],a['requiredCodeMatchCounts'])"
```

Expected: `True 0 <≤ 0.305> {…}`, with the code counts of acceptance criterion 1. Amended by the Task 4 review: `idRaw` is read from the after file (`y`), which counts only the 22 ids of the amended `IDS`. The Task 0 file (`x`) also counted the held-back `00-bt`, `00-07` and `00-08`, so `x['idRaw']` prints `False` on every full-offer match. If Task 6 was done, compare against `y['idRaw']` plus the match's `Wynik meczu lub 2 gol(e)` count instead (criterion 1, ledger P4).
- [ ] **Step 2: Fresh live smoke, then the offline replay** (pre-merge equivalent of Steps 3-4). Run the Task 0 command with `--dump .scratch/fortuna-capture-after.json` instead of `/tmp/fortuna-capture.json` (under `heavy --live`), same flags → criterion 2. Then replay the same dump for the Task 6 market (amended by the Task 6 review). This runs offline under `heavy`, without `--live`, and adds no live traffic → criterion 2, Task 6 bullet:

```bash
node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna premier-league WIN_OR_WIN_BY_2 --from .scratch/fortuna-capture-after.json --warn-pattern 'WIN_OR_WIN_BY_2: could not resolve'
```

Expected: exit 0, `warnPatternCount` 0, and `requiredCodeMatchCounts.WIN_OR_WIN_BY_2` equal to `matches`. Read the numbers, not the exit code: the script exits 0 whatever the warning count. Measured at `a8cdb71` (fortuna Task 6 report, fix round 1):
- 19 of 19 with 0 warnings, both on the Task 0 capture and on the 2026-11-07 PL capture of the Task 2 review.
- With the draw-leg filter removed as a mutation, the same replay of the Task 0 capture gives 0 of 19, `warnPatternCount` 19, and still exit 0.

Save both `SMOKE_RESULT` lines to `$E/smoke-after-fix-fortuna.txt`, and add the Task 6 replay's line below them. Then replay the dump through the normalizer and the repository's own `mergeMarketRecord` (no network, no DB):

```bash
node_modules/.bin/tsx $E/replay-player-keys.mts .scratch/fortuna-capture-after.json premier-league --mononym Murillo
```

Expected `RESULT`: `full` ≥ 1, `bare` 0, `leak` 0, `labelLeak` 0, `sharedTeamToken` 0, `collisions` 0, `warnNoPlayer` 0, `mononym.rows` with `PLAYER_SHOTS:Murillo` and `GOALSCORER_FIRST:Murillo` `["PLAYER@…"]`, and `verdict` `CHECKED`. `sharedNameToken` lines are shared given names (`James`, `Lucas`); read them, they are not failures. `verdict` `NOT RUN` (no full-offer match) or `PARTIAL` (mononym absent) is recorded as such, never as PASS. If Murillo's match has started, rerun with `--mononym` set to a name from the `mononyms:` lines of a full-offer match.

Amended by the Task 7 review. Step 2 first ran on 2026-11-13, when every listed PL fixture had 109-110 raw markets, so its full-offer gates were NOT RUN. Repeat Step 2 once a round opens (PL `raw` near 1200 again), with three changes:
- **Use a new dump file.** `--dump` overwrites without asking (`smoke-full-offer.mts:42`), and evidence lines (2)-(3) cite `.scratch/fortuna-capture-after.json` as their source. Set `D=.scratch/fortuna-capture-fullround-$(date -u +%Y%m%dT%H%MZ).json`, check `test ! -e "$D"`, and use `"$D"` in the three commands above.
- **Append the evidence.** Add the new live line and the new Task 6 replay line to `$E/smoke-after-fix-fortuna.txt`, below the existing lines, each under a `#` line with the command, the UTC time and the exit code. Do not replace the existing lines.
- **Check the exact-goals digit labels of Task 5** on the dump. The code gates cannot see this path. The normalizer's legacy branch (`fortuna-normalizer.ts:1258-1269`) turns the old parser labels (`Remis`, the home team, the away team) back into `0`/`1`/`2` and emits the same `HOME_`/`AWAY_`/`SECOND_HALF_EXACT_GOALS` keys. So the `≥ F − 1` gates would pass even if the parser exemption (`parser.ts:122-126`, applied at `:157`) never fired on live data. Run this probe (offline):

```bash
python3 -I -c "import json,sys; c=json.load(open(sys.argv[1])); L=[s['name'] for m in c['matches'] for mk in m['markets'] if mk['bookmakerMarketId'] in ('ufo:mtyp:00-16','ufo:mtyp:00-17','ufo:mtyp:00-3e') for s in mk['selections']]; S=sorted(set(L)); print('EXACT_GOALS_LABELS', len(L), S, 'NOT RUN' if not L else ('PASS' if set(S) <= {'0','1','2','2+','3+'} else 'FAIL'))" "$D"
```

Expected: `EXACT_GOALS_LABELS <n> [...] PASS`, with `n` > 0 and a label set that is a non-empty subset of `['0', '1', '2', '2+', '3+']`. The other two verdicts:
- `NOT RUN` means `n` = 0, a dump without a full-offer match. All 2026-11-13 dumps print this. Record it as NOT RUN, never PASS.
- `FAIL` means a `Remis` or team label reached the dump. That is a parser regression even when every code gate passes. The Task 0 capture, taken before Task 5, prints 99 labels and `FAIL`.

- [ ] **Step 2b: Leagues outside the Premier League.** The scheduled run never scrapes them (criterion 5), so run each one explicitly, one at a time under `heavy --live` (La Liga's slug is `laliga`):

```bash
for L in laliga serie-a ligue-1 ekstraklasa; do
  node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna $L --dump .scratch/fortuna-$L-after.json --warn-pattern 'without extractable player' | grep '^SMOKE_RESULT'
  node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna $L WIN_OR_WIN_BY_2 --from .scratch/fortuna-$L-after.json --warn-pattern 'WIN_OR_WIN_BY_2: could not resolve'
  node_modules/.bin/tsx $E/replay-player-keys.mts .scratch/fortuna-$L-after.json $L --mononym <a name from its mononyms: lines>
done
```

Expected per league: `warnPatternCount` 0, and the same `RESULT` values as Step 2. Measured on the 2026-11-07 00:40Z captures with the Task 2 review fixes, contexts re-derived from Fortuna's labels by the fixed team matcher: 0 warnings, 0 leaks, 0 shared team tokens and 0 collisions in all three leagues (fortuna Task 2 report, fix round 1). Ekstraklasa answered `No fixtures found from API` for `ufo:tour:00-0b9` (`src/scrapers/bookmakers/fortuna/constants.ts:47`) on that date: record NOT RUN if it still does. Amended by the Task 7 review: it still answered that way on 2026-11-13T15:56Z. totalbet had listed 7 Ekstraklasa fixtures on 2026-11-07T01:25Z, so the id is very likely stale. The follow-up is [fortuna-ekstraklasa.md](fortuna-ekstraklasa.md): rediscover the id, replace it behind a test, then re-run this step for Ekstraklasa.

The Task 6 replay (the loop's second line, offline, amended by the Task 6 review) gives `warnPatternCount` 0 and `requiredCodeMatchCounts.WIN_OR_WIN_BY_2` equal to `matches`. Measured at `a8cdb71` on the same 2026-11-07 00:40Z captures, with the contexts of the fixed team matcher:
- La Liga 19 of 19, Serie A 19 of 19 and Ligue 1 17 of 17, with 0 warnings each.
- On the same La Liga capture with the contexts of the old team matcher, it gives 17 of 19 and `warnPatternCount` 2, so it does see an unresolved team label.
- A league with no fixtures (Ekstraklasa) exits 1 with `matches` 0: record NOT RUN.

- [ ] **Step 3: After the owner's merge into `master` and the next scheduled run.** Before the merge no scheduled scrape runs this code (criterion 3), so Steps 3-4 stay open until then. The dev server restarted itself on the `src/` edits. Then:
  1. `python3 -I $E/api-checks.py --mononym Murillo > $E/api-checks-after-fix.txt` → criterion 3: `SUMMARY.verdict` `CHECKED`, `full` ≥ 1, and the counts of criterion 3. With `full` 0, record checks 1-3 as NOT RUN.
  2. Pooling → criterion 4: the `pool:` line of the mononym's match lists fortuna on the mononym row (`SUMMARY.mononym.fortunaOnRow` true).
  3. `GOALSCORER_FIRST` → criterion 4: the `mononym:` line of that match shows `'fortuna': ['PLAYER']`.
  4. The log greps of Step 4 → criterion 5.
  5. `WIN_OR_WIN_BY_2` → criterion 4 (Task 6, added by the Task 6 review): the one-liner below, on every listed fixture. Owner-gated: run it only after the owner merges `recovery/fortuna` together with `recovery/forbet` and a scheduled run follows. Until then, record it as NOT RUN.

  Lifetime of the named matches: Fulham–Newcastle (Kevin) kicks off 2026-11-07T15:00Z and Forest–City (Murillo) at 17:30Z. Brighton–Brentford (Chema), Ipswich–Bournemouth (Rayan, Evanilson), Sunderland–Chelsea (Estevao) and Palace–Liverpool (Alisson) kick off 2026-11-08T14:00Z, Man Utd–Villa (Amad) at 16:30Z. After that the listed PL fixtures carry about 109 raw markets and no OPTA player markets until the next round opens. If the merge lands after 2026-11-08T16:30Z, run checks 2-3 with `--mononym` set to a name from the `fortuna mononyms:` lists of a full-offer match listed at that time; if none is listed, record checks 1-3 as NOT RUN.

  `baseCodes` of one match by hand (expected: the four codes of criterion 3):

```bash
curl -s 'http://localhost:3001/api/matches/Nottingham%20Forest/Manchester%20City/normalized-markets?league=premier-league' | python3 -I -c "import json,sys; d=json.load(sys.stdin)['data']; print(sorted({mk['type'] for c in d['categories'] for mk in c['markets'] for p in mk['parameters'] if p['value']=='base' for b in p['bookmakers'] if b['bookmaker']=='fortuna'}))"
```

  `FIRST_CORNER` by hand (Task 4 review), on every listed full-offer match: fortuna has exactly one HOME and one AWAY leg, and no leg is priced 100 (the `Nikt` leg is dropped). Leeds–Tottenham, where `Nikt` used to resolve to Leeds United, kicks off 2026-11-07T12:30Z. Once it has started, record the Leeds-specific check as NOT RUN; the unit test `FIRST_CORNER drops 'Nikt' before team matching` in `fortuna-health-2026-11.test.ts` pins it. Per match:

```bash
curl -s 'http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league' | python3 -I -c "import json,sys; d=json.load(sys.stdin)['data']; print([[(s['type'],s['odds']) for s in b['selections']] for c in d['categories'] for mk in c['markets'] if mk['type']=='FIRST_CORNER' for p in mk['parameters'] for b in p['bookmakers'] if b['bookmaker']=='fortuna'])"
```

  `WIN_OR_WIN_BY_2` card by hand (check 5, Task 6 review), per listed fixture:

```bash
curl -s 'http://localhost:3001/api/matches/<Home>/<Away>/normalized-markets?league=premier-league' | python3 -I -c "import json,sys; d=json.load(sys.stdin)['data']; mk=[m for c in d['categories'] for m in c['markets']]; bms=lambda t: [b for m in mk if m['type']==t for p in m['parameters'] for b in p['bookmakers']]; w=bms('WIN_OR_WIN_BY_2'); fw=[{s['type']:s['odds'] for s in b['selections']} for b in w if b['bookmaker']=='fortuna']; f1=[b for b in bms('MATCH_WINNER') if b['bookmaker']=='fortuna']; mw={s['type']:s['odds'] for b in f1 for s in b['selections']}; raw=[b.get('rawMarketName') for b in f1]; n=len([m for m in mk if m['type']=='WIN_OR_WIN_BY_2']); print(n, [(b['bookmaker'],[(s['type'],s['odds']) for s in b['selections']]) for b in w], raw, mw, 'ok=%s' % (n==1 and len(fw)==1 and sorted(fw[0])==['AWAY','HOME'] and all(o<=mw.get(k,0) for k,o in fw[0].items()) and len(raw)==1 and bool(raw[0]) and not ' '.join(raw[0].split()).lower().startswith('wynik meczu lub')))"
```

  Expected: `1`, then the card's legs per bookmaker, with fortuna HOME/AWAY next to betclic (where listed) and forbet. Next come fortuna's `MATCH_WINNER` `rawMarketName` (not starting with `Wynik meczu lub`) and its legs, then `ok=True`. `ok` requires all of:
  - exactly 1 card;
  - exactly one fortuna entry on it, with one HOME and one AWAY leg;
  - each of those legs at or below fortuna's own `MATCH_WINNER` leg for the same side;
  - a fortuna `MATCH_WINNER` `rawMarketName` that is present and does not start with `Wynik meczu lub` (NBSPs folded, case ignored).

  Checked offline on the saved Forest–City response of the Task 2 review (fortuna Task 6 report, fix round 1). With fortuna added at its capture prices it prints `ok=True`. Swapped legs, a `Wynik meczu lub…` `MATCH_WINNER` label, or no fortuna entry (master, as saved) each print `ok=False`.

  Held-back ids, for the owner's decision (by hand, not a gate): per full-offer match, Fortuna's raw YES for `00-bt` and `00-07`/`00-08` (from `.scratch/fortuna-capture-after.json`) against the peers' YES on `RED_CARD_AND_PENALTY` and `RED_CARD_TEAM` HOME/AWAY from the same endpoint. Criterion 3 counts only legs under 5, so it never sees these prices.

- [ ] **Step 4: Log greps** of that run → criterion 5 (Premier League only, see criterion 5).
- [ ] **Step 5:** `npx tsc --noEmit && npx vitest run`, golden `-t fortuna`, and `golden-drift.mts --since /tmp/fortuna-golden-before.txt` → criterion 6.

## What to monitor

- Per match, Fortuna `HALF_TIME_RESULT` must have raw name `1.połowa` and every leg within 10% of the peer median (`api-checks.py`, `ht:` line). Any `ok=False` is a P0.
- `marketKey collision with overlapping selection code … for fortuna` lines: zero expected after this plan. Merges with disjoint codes never log, so any line is a misroute.
- `[fortuna] Player market without extractable player` lines: zero expected. Any line is a new name shape.
- `[fortuna] WIN_OR_WIN_BY_2: could not resolve` lines (Task 6): zero expected. Any line is a 2-goal market dropped because a team label did not resolve.
- The `[fortuna] Unknown market` id histogram per run. New ids with ≥ 10 lines are new products worth mapping. After this plan, about 22 ids should disappear from it (25 minus the held-back `00-bt`, `00-07` and `00-08`, which stay in it on purpose).
- Fortuna legs priced at 5 or more against the best peer, on `HALF_TIME_RED_CARD_TEAM` and `HALF_TIME_RED_CARD` (YES at 9.6-12), and on `RED_CARD_TEAM` / `RED_CARD_AND_PENALTY` if the owner re-enables `00-07`/`00-08`/`00-bt`. Criterion 3 (`api-checks.py:219`) counts only legs under 5, so it cannot see them (Task 4 review).
- Per-match raw counts: lineup drift is ±4 markets between runs, so a change > 5% for the same match is a new signal.

## Self-review

- Spec coverage:
  - D1 → Task 1.
  - D2 and D4 → Task 2.
  - D3 → Task 3.
  - D5 → Tasks 4-5.
  - D6 → Task 5.
  - The cross-plan `00-p1` item from `forbet.md` → Task 6 (conditional, open question 3).
  - The deferred composite ids and the grouper, particle and integrity observations → named follow-ups.
  - Acceptance → Task 0 and Task 7.
- Types:
  - The test helpers `ctxOf`, `live`, `liveAll`, `run` and `legs` are defined in Task 1 and reused unchanged.
  - `isStrictFortunaTeamPrefix` and the guard text are defined in Task 2.
  - `resolveFortunaPrefixTeamSide` is defined in Task 4 and reused by Task 5's flip pair.
- Review Focus items 1-5 are each pinned by a named test, in Tasks 1, 2, 2, 2 and 4.
- Values: every expected value in a Task 1-5 test is the prototype's output on `test-inputs.json`. The golden and smoke deltas are prototype measurements, not estimates. Only Task 6 is not prototyped.
- Review items rejected, with evidence (see D4 and Global Constraints):
  - Longest-prefix stripping via the fuzzy team matcher: it eats first names.
  - Anchoring `verbMatch`: it drops particle surnames.
  - Absolute `--include-unblessed` counts: the baseline already has 184 drifting entries.
