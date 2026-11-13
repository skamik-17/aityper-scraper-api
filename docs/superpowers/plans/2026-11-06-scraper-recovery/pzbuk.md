# PZBuk Scraper Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring PZBuk back from 0 to 20 premier-league matches on its new `sportsbook-api/ws` JSON-envelope WebSocket transport. Restore the real API market names that the capture currently throws away, and do not let those names (or the id map they expose) leak half-time, card or corner markets into full-match codes.

**Architecture:** A new pure module `pzbuk/ws-protocol.ts` owns everything protocol-level: frame decoding (new envelope plus the legacy RSocket shape), chunk reassembly, single-event accumulation and capture diagnostics. It is unit-tested on durable trimmed frames captured on 2026-11-06. `navigation.ts` keeps the Playwright work only. `index.ts` passes the concrete failure cause into `result.error`. The normalizer gets name-proven id corrections, a scope guard and an ordinal gate, and it lands before the capture wiring that brings data back. A new real-names golden fixture and a smoke script lock it all in.

**Tech Stack:** TypeScript (NodeNext ESM), Playwright `WebSocket` frame events, Vitest, tsx.

**Spec:** the Observations section of this file. Evidence lives in `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/pzbuk/`:
- `ws-league-frames.json`, `ws-event-frames.json`: trimmed wire frames (test fixtures)
- `premier-league_everton_coventry_city__2026-11-06.json`: PrepAuditOutput archive for the golden fixture
- `market-type-ids-2026-11-06.json`: id → real name / originalName / code table
- `replay-summary-2026-11-06.txt`, `smoke-current-code-2026-11-06.txt`, `backend-log-excerpt-2026-11-06.txt`, `site-bundle-chunking-2026-11-06.txt`
- `league-deltas-heads-2026-11-06T1756.json`: second live league-page capture (socket match, legacy-slice error, delta message heads)
- `capture-full-2026-11-06.json.gz`: full untrimmed capture
- `tools/`: capture, trim, replay, archive and id-compare scripts

To reproduce the numbers (absolute paths; the cwd does not matter):
```bash
mkdir -p /tmp/pzbuk-replay
gunzip -c /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/pzbuk/capture-full-2026-11-06.json.gz > /tmp/pzbuk-replay/cap.json
/home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules/.bin/tsx /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/pzbuk/tools/replay.mts /tmp/pzbuk-replay/cap.json /tmp/pzbuk-replay
```
This runs the current `parseAllMarkets` plus the normalizer from `src/` (imported by absolute path, replay.mts:5-9) and only reads them. The output directory must exist. Proven on 2026-11-06 18:20: it prints `FIXED accumulation (union of markets): scraped markets=167 (placeholder names=0)` and writes four `replay.*.json` files.

## Observations (pre-fix analysis)

### Status today (2026-11-06)

| Run | Time (CET) | pzbuk result | Run summary line |
|---|---|---|---|
| `7067e5f0` | ~16:45 | `success=false, 0 matches` (log l.1331) | `10 success, 4 errors, 200 total matches` (l.35886) |
| `440d2fc6` | 17:00 | `success=false, 0 matches` (log l.36730) | `9 success, 5 errors, 180 total matches` (l.65473) |

The symptom is the same in both runs (`backend-log-excerpt-2026-11-06.txt`):

```
[PZBuk/Navigation] Navigating to: https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league
[PZBuk/WS] Max wait reached with 0 selections        # after WS_MAX_WAIT = 25 s (constants.ts:271)
[Aggregator/FullOffer] pzbuk completed: success=false, 0 matches
```

The real error string, `"No WebSocket data captured"` (index.ts:338-347), is never printed: aggregator.ts:268-271 logs only `success` and the match count. The standalone smoke command (see Acceptance criteria) reproduces the outage on the current code: `SMOKE {"success":false,"error":"No WebSocket data captured","matches":0,"markets":0,"durationMs":25211}` (`smoke-current-code-2026-11-06.txt`).

### Root cause (re-verified with a fresh capture, 17:16 CET)

The fresh capture loaded one league page and one event page, using the scraper's UA and locale and the same timing as single-event mode (`evidence/pzbuk/tools/capture.mjs <outdir> 0`).

1. **Socket URL moved.** The only socket is now `wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl`. `WEBSOCKET_URL_PATTERN = "sportsbook-api/websocket"` (constants.ts:249) never matches, so navigation.ts:236 returns before attaching a frame listener. Zero frames are processed.
2. **Frames are JSON envelopes now.** Recv frames are binary, UTF-8 JSON: `{"type":"SETUP","chunkSize":1048576}`, then `{"type":"DATA","streamId":N,"payload":[{"type":"INITIAL_STATE","payload":{events,markets,selections,selectionPacks,marketTypes,page,pageSize,totalPageCount,requestedFromApi,createdByApi}}]}`. navigation.ts:242-248 slices from the first `[{` and runs `JSON.parse` on the rest. The trailing envelope `}` makes that throw (`Unexpected non-whitespace character after JSON at position 233949`, from the first diagnosis), and navigation.ts:299-301 swallows the error. So fixing the URL alone still yields 0 INITIAL_STATE.
3. **Chunking (latent).** The site bundle buffers every frame with `byteLength >= chunkSize` and concatenates it with the next one (`bufferAndAssemble`, `site-bundle-chunking-2026-11-06.txt`). The largest frame seen today is 451,513 B (the "Zawodnicy" group, 1,302 selections), under the 1,048,576 B limit. Nothing has been chunked yet, but a heavier player-prop offer would be.
4. **Deeper, pre-existing: real market names are thrown away.** On an event page, every market group is its own `SUBSCRIBE` / `INITIAL_STATE` stream (10 groups for Everton–Coventry). navigation.ts:265 keeps only the **largest** `markets` array (80, "Zawodnicy") instead of the union (232). `parseAllMarkets` (parser.ts:717-731) then cannot find API names for the other groups and falls back to switch labels or `Rynek <id>` placeholders. Replaying the full capture through the current `parseAllMarkets` gives 167 markets; 69 are named `Rynek <id>` today and 0 after taking the union. Every captured market has a real name (0 blank or placeholder in the payload). The July golden fixture was harvested under the same bug: 80 of its 155 entries are placeholders. The "placeholder names come from PZBuk itself" note in the August audit was an artefact of this bug.
5. **Deeper: names prove 16 misrouted ids, 2 latent ones and 1 lost one.** Market-type ids are stable. All 14 ids that had real names in the July golden have identical names today (1, 8, 10, 11, 14, 17, 27, 42, 55, 62, 2099, 2179, 2186, 2395). But the names, plus `marketType.originalName`, show that 8 id-map entries and 8 name-rule hits send half/card/corner/Nth-goal markets into full-match codes. Two more id-map entries (21, 23) are wrong but masked by the all-UNKNOWN drop, and id 146 (HT home bookings) is dropped. See the table below. The `{SpecialIntValue1}` templates (ids 8, 36, 57, 77, 91, 92, 140) carry an ordinal: `1. gol` before kick-off, `2. gol` after the first goal of a live event. Storage keeps the **first-seen** odds per selection code on a marketKey collision (`mergeMarketRecord`, full-offer-repository.ts:197, warning at :245). Groups arrive in header order: Popularne, Zawodnicy, 1 połowa, Gole, Rzuty rożne, Dokładny wynik, Kartki, 2 połowa, Kombo, Specjalne. Inside a group the parser order decides. Ids 33 and 501 are both in group 19 "Kombo" (`marketGroupIds [19]`), and 33 comes first (archive #155 vs #158). So 33 keeps `RESULT_AND_BTTS` and 501 is dropped with a collision warning. The silent harm is id 167: its corner lines 3.5/4.5/5.5 land as `HALF_TIME_TOTAL_GOALS:3.5/4.5/5.5` with corner odds and no warning, because id 62 only carries 0.5/1.5/2.5.
6. **Legacy path broken by numeric ids.** Every id on the wire is a JSON number (event.id, market.id, selection.id, eventId, marketTypeId), while types.ts:25/91 declare `string`. parse1X2Odds, parseDoubleChance, parseBTTS and parseOverUnder (parser.ts:559, 591, 631, 667) compare `=== "1"` and so on, and never match: parse1X2Odds returns `{home:0,draw:0,away:0}` on the captured selections and `{home:1.66,draw:3.92,away:4.91}` with `String()` coercion. As a result scrapeLeague (index.ts:138-142) skips every event, and `scripts/test-scrapers.sh test pzbuk` fails. scrapeFullOffer does not use these helpers.

### What still works and must not break

- HTTP 200 on the league page and on the URL from `buildEventUrl` (`…/leagues/134-premier-league/events/4408475-everton-fc-coventry-city`). No captcha, geo block or consent wall. `#onetrust-accept-btn-handler` is visible and clickable.
- `[class*="content-box__HeaderContainer"]` matches 10 headers (`role="button"`, no `aria-expanded`). Group 1 "Popularne" is open by default: its `SUBSCRIBE` (stream 5) is sent at page load and its DATA arrives 384 ms after the socket opens. The **first** header click collapses it and sends `CLOSE` for stream 5 (event frame 12, 1,464 ms after open). The other 9 clicks each fire one group `SUBSCRIBE`. 10/10 groups answered and the capture ended after 17.4 s. There were 14 `SUBSCRIBE` frames in total: event, selection pack, 2 sidebar listings and 10 groups. The 40 "Pokaż więcej" clicks hit the loop cap (navigation.ts:86) and added **no** subscriptions beyond those. Header texts equal the trimmed `event.marketGroups[].name` (`"Gole "` → `Gole`).
- Payload field names match types.ts. Events are `type:"Fixture"`. `primaryParticipants[].venueRole/name` is present. `outcomeType` is `Home/Tie/Away/Over/Under/Yes/No`, otherwise `""`. `points` is always a number (0 for non-line markets, giving `paramValue "0"`). Status is `"Active"`. `pageSize` is 2147483647, so there is no pagination.
- `parseAllMarkets` works with numeric ids (`String(marketTypeId)` at parser.ts:738/777). `getSelectionName` (parser.ts:301-521) **never** matches numeric ids, so selection labels stay raw, e.g. `"Everton FC lub remis"`. The golden fixture and the normalizer rely on that, so it must stay uncoerced.
- All 20 fixtures pass `isValidEvent` and canonicalize to pairs that already exist in `/api/odds` (20/20).
- The 1X2 matches peers: PZBuk 1.66/3.92/4.91 vs the peer median 1.655/3.95/5.0 (10 bookmakers, Everton–Coventry), max deviation 1.8%.
- These audit-proven mappings agree with the real names: 19 AWAY total (Coventry), 33 RESULT_AND_BTTS, 72 → OTHER (1st-half combo), 133 HOME_EXACT_CARDS, 152 CORNERS_RACE, 155 CORNERS_HANDICAP, 162/163/173, 504 DOUBLE_CHANCE_BTTS, 498/503 → OTHER.
- All six LEAGUE_URLS return 200. 171 and 148 redirect to shorter slugs; the numeric prefix is what matters. Only premier-league WS data was verified.

### New data shape

| Item | Old (≤ 2026-08-20) | New (2026-11-06) |
|---|---|---|
| Socket | `…/sportsbook-api/websocket` (RSocket) | `wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl` |
| Recv frame | binary header + `[{type:"INITIAL_STATE",…}]` | `{"type":"SETUP","chunkSize":1048576}` / `{"type":"DATA","streamId":N,"payload":[{type:"INITIAL_STATE",payload}]}` |
| DATA message types | `INITIAL_STATE` | `INITIAL_STATE`, plus `SELECTION_DELTA` and `EVENT_DELTA` on stream 1 within seconds of load (second live capture, 17:56: 121 B and 1,163 B frames; `evidence/pzbuk/league-deltas-heads-2026-11-06T1756.json`). Only the 60-char heads were recorded, so the delta payload shape is unknown. The plan ignores deltas: odds come from the INITIAL_STATE snapshots and are at most about 17 s old. |
| Sent frames | n/a | `{"type":"SUBSCRIBE","streamId":N,"route":"events","version":1,"payload":{filters}}` (group subscriptions carry `filters.eventIds` + `filters.marketGroupIds`) and `{"type":"CLOSE","streamId":N,"reason":"NORMAL","message":null}` |
| Other recv control frames | n/a | none observed besides `SETUP`. A server `ERROR`-style frame is plausible but unseen. |
| Chunking | none | frames with `byteLength >= chunkSize` are continuations; the next shorter frame ends the message |
| Ids | strings (assumed) | JSON numbers everywhere |
| New fields | – | `event.marketGroups{id,name,marketsCount}`, `market.marketType.originalName` (English template), `marketType.marketGroupIds`, `selection.templateId/betslipLine` |

Event page 4408475, 10 groups, 242 group markets (232 unique): 1 Popularne 28, 28 Zawodnicy 80, 7 "1 połowa" 24, 2 Gole 24, 13 Rzuty rożne 21, 17 Dokładny wynik 2, 12 Kartki 19, 8 "2 połowa" 25, 19 Kombo 13, 15 Specjalne 6. The capture has 1,780 active selections and 131 distinct marketTypeIds. The next round's fixtures declare 10 groups (220-242 markets); the round after declares 7 groups (113-117 markets).

### Impact on parser / normalizer / catalog / golden / audit knowledge

**Integrity misroutes.** The current code would show these once data flows again. Values are from the 2026-11-06 capture. All target codes exist in market-catalog.ts, so no catalog change and no sync-market-types run.

| id | Real API name (originalName) | Today | Via | Correct code | Proof (odds) |
|---|---|---|---|---|---|
| 126 | Kartki 1x2 (Booking 1x2) | MATCH_WINNER | id map :246 | CARDS_RACE (catalog :2358) | 2.75/3.83/1.95 vs id 1 1.66/3.92/4.91 |
| 78 | 2. Połowa - Podwójna szansa | DOUBLE_CHANCE | id map :210 | SECOND_HALF_DOUBLE_CHANCE (:977) | 1.18/1.38/1.64 vs id 10 1.19/1.26/2.13 |
| 79 | 2. Połowa - Remis bez zakładu | DRAW_NO_BET | id map :211 | SECOND_HALF_DRAW_NO_BET (:992) | 1.33/2.8 vs id 11 1.26/3.53 |
| 36 | 1. strzelec gola (`{SpecialIntValue1}. goalscorer`) | EXACT_GOALS | id map :118 | id → OTHER; the name `1. strzelec gola` → GOALSCORER_FIRST (:1391) via a new name override. `2. strzelec gola` (live, after a goal) is the 2nd scorer and stays OTHER. | player selections |
| 8 | 1. gol (`{SpecialIntValue1}. goal`) | CORRECT_SCORE for every name except `1. gol` | id map :31 | id → OTHER. `1. gol` keeps FIRST_TEAM_TO_SCORE via the existing override :446. | `Everton FC 1.5 / żaden 12.77 / Coventry City 2.75`; a `2. gol` name would get team-name codes under CORRECT_SCORE |
| 57, 77, 91, 92 | `… {SpecialIntValue1}. goal …` (1st half, 2nd half, 15-min and 10-min goal time) | first-goal codes for every ordinal | id map :163, :209, :244, :245 | unchanged for `1.`; an ordinal ≥ 2 before `gol`/`strzelec`/`kartk` parks the market in OTHER (new ordinal gate) | live-only names, not captured |
| 37 | Strzelec ostatniego gola (Last goalscorer) | HOME_EXACT_GOALS | id map :119 | GOALSCORER_LAST (:1405) | player selections |
| 147 | 1. Połowa - Coventry City Dokładna liczba kartek (`Competitors[1]`) | HALF_TIME_HOME_EXACT_CARDS | id map :283 | HALF_TIME_AWAY_EXACT_CARDS (:4297) | away team in name |
| 146 | 1. Połowa - Everton FC Dokładna liczba kartek (`Competitors[0]`) | dropped (`null`, not in the id map) | – | HALF_TIME_HOME_EXACT_CARDS (:4283) | home team in name; 0/1/2/3+ = 1.63/2.41/6.69/23.61 |
| 21, 23 | Everton FC Dokładna liczba goli (`Competitors[0]` exact goals); Zakres liczby goli (Goal range) | ODD_EVEN_GOALS / SECOND_HALF_TOTAL_GOALS, dropped only because every selection is UNKNOWN | id map :81, :85 | OTHER (latent; coverage, open question 1) | `0/1/2/3+`; `0-1/2-3/4-5/6+` |
| 501 | 2. Połowa - 1x2 & oba zespoły strzelą | RESULT_AND_BTTS | id map :343 | SECOND_HALF_RESULT_AND_BTTS (:3564) | HOME_YES 8.95 vs id 33 3.39 |
| 167 | 1. Połowa - Suma rzutów rożnych | HALF_TIME_TOTAL_GOALS* | name override :458 | HALF_TIME_CORNERS_TOTAL (id map already) | 4.5: 1.88/1.73 |
| 142 | 1. Połowa - Suma kartek | HALF_TIME_TOTAL_GOALS* | name override :458 | HALF_TIME_CARDS_TOTAL (:2301, decimal O/U) | 1.5: 2.1/1.55 vs id 62 2.5/1.45 |
| 58 | 1. Połowa - Podwójna szansa | DOUBLE_CHANCE* | `matchMarketByName` :1079 | HALF_TIME_DOUBLE_CHANCE (:3076) | 1.15/1.49/1.57 |
| 59 | 1. Połowa - Remis bez zakładu | DRAW_NO_BET* | :1080 | HALF_TIME_DRAW_NO_BET (:3091) | 1.32/2.99 |
| 75 | 1. Połowa - Dokładny wynik | CORRECT_SCORE* | :1098 | HALF_TIME_CORRECT_SCORE (:1250) | 0:0 2.85 |
| 60, 80 | 1./2. Połowa - handicap (3-way `(1:0)`) | EUROPEAN_HANDICAP* | :1089 | OTHER (no half-time EH code) | `remis (x:y)` → UNKNOWN |
| 61 | 1. Połowa - handicap (2-way ±0.5/1.5) | EUROPEAN_HANDICAP* | :1089 | OTHER (see open question 1) | 0.5: 1.14/4.52 |

`*` = only once real names are restored (root cause 4). Line numbers refer to `src/services/normalization/bookmakers/pzbuk-normalizer.ts` and `src/data/market-catalog.ts`. On the full capture with names restored, 8 non-OTHER marketKeys collide with overlapping selection codes (MATCH_WINNER, DOUBLE_CHANCE, DRAW_NO_BET, RESULT_AND_BTTS, HALF_TIME_TOTAL_GOALS ×3, EUROPEAN_HANDICAP:0). With the Task 4 routing there are **0**: 76 non-OTHER markets, 76 distinct marketKeys, 0 UNKNOWN among 320 selections. This was checked offline on a scratch copy of the patched normalizer run over the evidence archive.

**Final-review amendment (F1, F2).** The id map runs before `matchMarketByName`'s scope guard, so a non-OTHER guess wins over a blank or half-scoped real name. Ids proven by a real name now carry their code: 2 → TEAM_TO_QUALIFY ("Zakwalifikowanie się", WC golden #13) and 42 → HALFTIME_FULLTIME ("Połowa/Reg. czas gry"). Unverified or refuted guesses are parked in OTHER: 3, 4 (never observed), 5 (team × method, not ASIAN_HANDICAP), 20 (the home total is id 18), 38 (away exact goals is id 22), 39/41 (would share the trusted keys of 33/504), 499/500 (DC & BTTS variants; 499 reached DOUBLE_CHANCE by name), 725 (player goals incl. extra time; reached TOTAL_GOALS by name, where a player label starting with "pon" reads as UNDER) and 2395 (substitute-inclusive player cards, like 2179/2186). "W jaki sposób rozstrzygnie się mecz?" with team × method selections (6-way WIN_METHOD shape) no longer publishes as the 3-way MATCH_RESOLUTION_METHOD: a label that names a side normalizes to UNKNOWN, and `normalizeMarket` drops every non-OTHER market that repeats a selection code (`[pzbuk] Dropping …`). WC golden #11 is reblessed to `null`, PL golden #22 to OTHER.

**Coverage baseline** (`aityper/docs/audit-ledger/coverage.json`, read by `scripts/match-audit-prep.ts` as a monotonic gate). After Task 4, no pzbuk baseline code is lost on this archive: HALF_TIME_HOME_EXACT_CARDS `['0','1','2','3+']` now comes from id 146 instead of the misrouted 147. Twelve codes are added (CARDS_RACE, GOALSCORER_FIRST/LAST, HALF_TIME_AWAY_EXACT_CARDS, HALF_TIME_CARDS_TOTAL, HALF_TIME_CORNERS_TOTAL, HALF_TIME_CORRECT_SCORE, HALF_TIME_DOUBLE_CHANCE, HALF_TIME_DRAW_NO_BET, SECOND_HALF_DOUBLE_CHANCE, SECOND_HALF_DRAW_NO_BET, SECOND_HALF_RESULT_AND_BTTS). Four codes disappear: EUROPEAN_HANDICAP, EXACT_GOALS, HOME_EXACT_GOALS and CORRECT_SCORE. None of them is in the pzbuk baseline, and all four were misroutes.

**Coverage opportunities** (today OTHER or dropped, so harmless, and out of scope; see open question 1):
- 18 = `{home} total` → HOME_TEAM_TOTAL_GOALS
- 21 / 22 = home / away exact goals. Task 4 sets 21 to an explicit OTHER; 22 is OTHER already.
- 23 = Goal range. Task 4 sets it to an explicit OTHER.
- 24 = Odd/even
- 29 / 30 = clean sheets
- 40 = Correct score
- 87 = 2nd-half BTTS
- 134 = away exact bookings
- 63/64/83/84 = half-time team totals
- 72 / 73 / 502 / 503 = half-scoped combos by real name ("1. Połowa - 1x2 & Oba zespoły zdobędą gola", "1. Połowa - 1x2 & Suma", "2. Połowa - 1x2 & suma", "2. Połowa - Podwójna szansa & oba zespoły strzelą"). They stay OTHER, and Task 6 leaves them unblessed on purpose.
- 2393-2406 = player props

**Golden fixtures.**
- `pzbuk/world-cup-2026_france_morocco` has 155 entries, 36 of them blessed. Exactly one blessed entry flips under the Task 4 normalizer: #127 "Zakład bez remisu" (id 79, Francja 1.24 / Maroko 3.29 vs the real DNB id 11 1.17/4.61) goes DRAW_NO_BET → SECOND_HALF_DRAW_NO_BET. It was blessed wrongly, so rebless it with an inspected diff. The other affected ids in that fixture are unblessed and never fail: #14 id 8 "1. gol" (unchanged), #53 id 23, #65 id 21, #91 id 126, #101 id 146, #103 id 147.
- A new real-names fixture `premier-league_everton_coventry_city` (167 entries) is harvested from the evidence archive. If it were harvested on the current normalizer, the ledger policy would bless 10 of the misroutes, e.g. #24 last-goalscorer → HOME_EXACT_GOALS and #137 → DRAW_NO_BET. Harvest therefore runs **after** Task 4.
- The ledger blessing policy cannot be used as is for that fixture. It unblesses by substring: `!openRefs.some((ref) => ref.includes(marketCode))` (harvest-fixtures.ts:346-347). The frontend registry has 50 open pzbuk refs, including `INNE/OTHER`, `WYNIK_MECZU/MATCH_WINNER`, `WYNIK_MECZU/DOUBLE_CHANCE`, `POLOWY/HALF_TIME_TOTAL_GOALS` (which contains `TOTAL_GOALS`), `POLOWY/HALF_TIME_BTTS` (contains `BTTS`) and `KOMBINACJE/RESULT_AND_BTTS`. A policy-only harvest therefore blesses only 54 of 167 entries. Task 6 blesses the verified entries by exact raw name, giving 89 blessed; the 78 unblessed entries are all OTHER.
- The archive keeps `raw.paramValue` (the vendor line). buildPrepAuditOutput drops it (scraper-audit-core.ts:369-375), while production forwards it.

**Tooling gotchas.** `scripts/harvest-fixtures.ts` still assumes the old monorepo (`REPO_ROOT` = repo/.. at :193; default `--out-dir` `<root>/backend/...` at :224), so always pass `--out-dir` and `--registry` explicitly. In `--bless`/`--only` mode it refreshes only the matched entries, matching exact trimmed names first (harvest-fixtures.ts:297). `scripts/test-scrapers.sh scrape-pl` POSTs `/api/admin/scrape` without a `bookmakers` list (test-scrapers.sh:145-148). That runs all 14 scrapers and writes the DB (routes/admin.ts:32-50). The script prints "Scraping zakończony" although the endpoint only answers 202 `status:"started"` (admin.ts:64-77). Its default key `dev-admin-key-12345` (test-scrapers.sh:19) also differs from the service default `dev-api-key` (config/index.ts:36; `.env` sets no `ADMIN_API_KEY`). `scripts/` is outside the tsconfig `include` (`src/**/*`), so `npx tsc --noEmit` never type-checks a script. `scripts/test-scrapers.sh test pzbuk` goes through scrapeLeague and scrapeMatchDetails (the legacy path, :198-240). The scrapeMatchDetails cache lookup regex `/\/event\/(\d+)/` (index.ts:213) never matches `/events/<id>-…`. That is intentionally left as is: fixing it would serve the thin 2-market league snapshot instead of the event page.

### Risks & unknowns

- Chunk reassembly copies the site bundle but has never been observed live; it is tested synthetically only (Task 1 assembler tests, Task 5 test "counts chunked frames and the largest reassembled frame"). It stays **unverified live** until a smoke run reports `chunkedFrames` > 0 with `invalidFrames` = 0 (A11). The largest live frame so far is 451,513 B against a chunkSize of 1,048,576 B, so a premier-league run will most likely report `chunkedFrames: 0`. A bad reassembly fails closed: the frame decodes as `invalid`, its market group goes missing, and A7 warns.
- Only premier-league was live-verified. Other leagues use the same transport (same page app), but their WS data was not checked.
- Under a full parallel run (13 browsers), group answers may arrive after `STREAM_SILENCE_MS` (2.5 s). Task 5's per-event `groups seen/declared` log line and its "never answered" warning make that visible.
- **Collapse race.** Today the first header click collapses the default-open "Popularne" group and sends `CLOSE` for its stream. Under load, if Popularne answers more than about 1 s late, that click cancels it and the event loses 1X2/DC/DNB/O/U/BTTS. A7 would tolerate that on 2 of 20 events. Task 5 therefore skips headers whose group is already subscribed or answered. The rule is data-driven (sent `SUBSCRIBE` frames plus `event.marketGroups` names) because the headers carry no `aria-expanded`.
- **Ordinal templates on live events.** Ids 8, 36, 57, 77, 91, 92 and 140 are `{SpecialIntValue1}` templates. After the first goal or booking of a live event they read `2. …` and mean a different bet. Task 4's ordinal gate parks any `N.` with N ≥ 2 before `gol`/`strzelec`/`kartk` in OTHER. Only the `1.` forms were captured; the `2.` rows in the tests are synthetic. The gate stays **unverified live** until a smoke run reports `ordinalMarkets` > 0 with `gatedNonOther` = 0 (A12). A pre-match premier-league run only sees the `1.` forms, so A3-A6 pass with or without the gate; only an in-play event that has had a goal or booking can verify it.
- **Unrendered ordinal templates.** The gate needs the rendered market name. When `market.name` is blank, the parser falls back to `marketType.name` (parser.ts `apiName`), which still holds the template (`1. Połowa - {SpecialIntValue1}. gol`). Task 4 parks any `{SpecialIntValue…}` name in OTHER. When there is no market object at all, the parser uses its id label (`Pierwszy gol 1. połowy`, `Czas pierwszego gola (10 min)`), which names no live ordinal, so ids 57/77/91/92 still route by id to their first-goal codes. The capture has 0 blank names, so this needs a payload never seen so far. Closing it needs an owner decision (open question 9).
- **Deltas ignored.** `SELECTION_DELTA` / `EVENT_DELTA` messages are decoded but not applied, so odds are the INITIAL_STATE snapshot (at most about 17 s old per event). Deltas also do not reset the stream-silence timer, so a busy live event still settles.
- **League rule relaxed.** Task 5 accepts a one-event listing (`events.length >= 1`, was `> 1`). This is safe on today's league page, which opens exactly one stream (full capture: one `SUBSCRIBE`, `filters.leagueIds [134]`). If PZBuk ever adds a single-event widget stream to the league page that answers first, the listing would shrink to that event. A1 (≥ 18 matches) would catch it.
- Scrape time is about 17.4 s per event, so roughly 6 min per 20-event league.
- Everton–Coventry kicks off 2026-11-06 20:00Z. Live events stay valid (`isValidEvent` ignores `isLive`), and their live page shape was not checked.
- **A transport rollback is not matched.** `"sportsbook-api/websocket"` does not contain `"sportsbook-api/ws"`, so a return to the legacy `/websocket` path captures no frames and the scrape fails closed, with no data and never wrong prices. Until Task 5 the error is the bare `No WebSocket data captured`. After Task 5 it shows up as `no socket matched "sportsbook-api/ws" (sockets seen: …/websocket)`. Matching both paths needs an owner decision (open question 8).
- The legacy RSocket *frame* decoder branch is kept, but it is reachable only if the matched `/ws` socket itself serves RSocket frames: sockets are filtered by URL before any decoding (navigation.ts:236 today; the Task 5 matching rule). It is tested with a synthetic frame only. The `ERROR` control-frame shape is synthetic too.

### Open questions for the owner

1. Should the coverage ids (18, 21-24, 29/30, 40, 87, 134, 63/64/83/84, 72/73/502/503, and 61/81 → FIRST/SECOND_HALF_ASIAN_HANDICAP) be mapped in a follow-up `/audit-loop` round on Everton–Coventry? This plan parks them in OTHER and leaves them unblessed in the new fixture. Under FIXER-CONTRACT.md step 1, a fixer would treat a blessed passing entry as "presumed unnecessary".
2. Should `marketType.originalName` (English, locale-stable, e.g. `1st half - total corners`) become the primary identity key in the normalizer, instead of Polish names plus numeric ids?
3. Is id 126 "Kartki 1x2" right as CARDS_RACE ("Więcej kartek", HOME/DRAW/AWAY), or should it be parked in OTHER until peers are compared?
4. Should `buildPrepAuditOutput` keep `raw.paramValue` for every bookmaker? This is cross-cutting: golden fixtures currently never exercise the vendor-line path.
5. Should the evidence archive also be copied to the ledger raw-archive (`aityper/docs/audit-ledger/raw-archive/pzbuk/`, frontend repo)?
6. Should the 40 "Pokaż więcej" clicks per event (no data effect, about 3-5 s) be dropped later?
7. An INITIAL_STATE listing with 0 events (off-season) is reported here as `success:true, matches:[]`, so the observability plan's `empty` status and its league-level collapse see it. Is that the wanted semantics, or should it stay a failure?
8. Is it acceptable that a rollback to `/websocket` is not matched? The plan default is the single pattern `"sportsbook-api/ws"`, which Task 1 ships and Tasks 2 and 5 pin. With it, a rollback becomes a loud capture failure after Task 5 (see Risks). The alternative is rollback tolerance: `WEBSOCKET_URL_PATTERNS = ["sportsbook-api/ws?", "sportsbook-api/websocket"]` in constants.ts, and `.some((p) => url.includes(p))` in the Task 5 matching rule. The `describeCaptureFailure` first message and the Task 2 and Task 5 expected `no socket matched …` strings would then have to name both patterns. Either choice is odds-safe: an unmatched socket captures nothing, and a matched legacy socket goes through the same `initialStatesOf` path.
9. Should ids 57/77/91/92 route by id only when the name proves the ordinal is `1.`? Today a market with no market object gets the parser's id label, which names no live ordinal, so it reaches HALF_TIME_FIRST_GOAL / SECOND_HALF_FIRST_GOAL / FIRST_GOAL_TIME_ALT / FIRST_GOAL_TIME by id (Risks, "Unrendered ordinal templates"). The plan default keeps today's behaviour. The stricter rule would also flip four blessed `world-cup-2026_france_morocco` entries to OTHER, because they route through the id-label fallback: #32 `Pierwszy gol 1. połowy`, #57 `Czas pierwszego gola (10 min)`, #58 `Czas pierwszego gola (15 min)` and #135 `Pierwszy gol 2. połowy`.

### Acceptance criteria

| # | Live check | Threshold | Measured on 2026-11-06 capture (offline replay, post-plan logic) |
|---|---|---|---|
| A1 | `scrapeFullOffer("premier-league")` | `success:true`, matches ≥ 18 | listing has 20 valid fixtures, 20/20 canonicalize |
| A2 | Parsed markets per match | ≥ 90 on every match; ≥ 120 on 10-group events (read from the `(groups 10/10)` log lines) | 167 on the 10-group event; about 105 estimated for a 7-group event (markets whose `marketGroupIds` hit groups 1/2/7/8/15/17/19) |
| A3 | Non-OTHER normalized markets, every match | ≥ 40 | 76 (7-group estimate: 51) |
| A4 | UNKNOWN share among selections of non-OTHER markets | ≤ 2% | 0% (2.3% before Task 4). The overall share, including OTHER, is 69% by design, so it is not used. |
| A5 | Non-OTHER marketKey collisions with overlapping selection codes, per match | 0 | 0 (8 marketKeys before Task 4) |
| A6 | PZBuk MATCH_WINNER vs median of other bookmakers, same match | ~~every selection within ±8%~~ (controller ruling 11) every selection within 2.5 pp of the peer median's implied probability (`|1/p − 1/median| ≤ 0.025`) only (the peer [min, max] is no pass criterion); `--peers` given but unavailable fails | max 1.8% (0.37 pp). A leak of id 126 would be +66% on HOME (23.9 pp); Arsenal v Hull City AWAY 16.68 vs 15.375 is 0.51 pp and passes. |
| A7 | Log `(groups X/Y)` per event | X = Y on ≥ 18/20 events | 10/10 |
| A8 | `scrapeFullOffer` duration | ≤ 10 min | ≈ 17.4 s/event |
| A9 | Service run | `pzbuk completed: ≥18 matches, >0 markets saved`, 0 `marketKey collision … pzbuk` warnings | – |
| A10 | `scripts/test-scrapers.sh test pzbuk premier-league` | `✓ Listing: ≥18 matches` and `✓ Details` with 1X2/BTTS/O/U 2.5/DC lines | fails today (parse1X2Odds 0/0/0) |
| A11 | Transport counters `invalidFrames`, `chunkedFrames`, `maxFrameBytes` (SMOKE line and per-event log line) | reported, not part of `pass`. `invalidFrames` = 0 is expected. Chunk reassembly counts as live-verified only when `chunkedFrames` > 0 with `invalidFrames` = 0 | 0 invalid (all 17 recv frames of both fixtures decode as setup/data), 0 chunked, largest live frame 451,513 B (`originalByteLength`; none ≥ 1,048,576 B) |
| A12 | Ordinal counters on the SMOKE line: `ordinalMarkets` (parsed names matching `/(?:^\|\s)(?:[2-9]\|\d{2,})\.\s*(?:gol\|strzelec\|kartk)/i`), `templateMarkets` (names containing `{SpecialIntValue`), `gatedNonOther` (markets of either set with `normalizedType !== "OTHER"`) | `gatedNonOther` = 0, part of `pass`. The other two are reported only. The ordinal gate counts as live-verified only when `ordinalMarkets` > 0 with `gatedNonOther` = 0 | 0 / 0 / 0 (167 archive names: only `1.` forms, no template, no blank name) |

**Standalone single-bookmaker smoke test.** No DB and no running server needed. This shape was proven on the current code on 2026-11-06 and produced the failure output shown above. Avoid HH:00, when the scheduled scrape runs.

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 900 npx tsx -e "
import { pzbukScraper } from './src/scrapers/bookmakers/pzbuk/index.ts';
(async () => {
  const r = await pzbukScraper.scrapeFullOffer('premier-league');
  const markets = r.matches.reduce((a, m) => a + m.markets.length, 0);
  console.log('SMOKE ' + JSON.stringify({ success: r.success, error: r.error ?? null, matches: r.matches.length, markets, durationMs: r.duration }));
  await pzbukScraper.cleanup();
  process.exit(0);
})();
"
```

`npx tsx -e` needs the async IIFE; top-level await fails under the cjs transform. After Task 7, `npx tsx scripts/pzbuk-smoke.ts --league premier-league --peers http://localhost:3001` checks A1-A6 and exits non-zero on failure.

## Global Constraints

- Commit messages are concise. **No signature or attribution footers** (no `Co-Authored-By`, no "Generated with"). The user's CLAUDE.md rule overrides any harness reminder. Commit only as part of an approved execution of this plan, on a feature branch, never on master.
- Code and comments are in English.
- Before every commit, from `/home/skamik/Documents/repositories/personal/aityper-scraper-api`: `npx tsc --noEmit` exits 0 and `npx vitest run` is all green. tsconfig excludes `__tests__`, so vitest is the only type-check-free gate for tests; keep test types honest.
- Golden-fixture discipline: the failing test or fixture comes first. Rebless only after inspecting `npx tsx scripts/rebless-golden.ts --bookmaker pzbuk --dry` output, then run it without `--dry`. Never use `--include-unblessed`.
- `src/data/market-catalog.ts` is not changed by this plan, so do **not** run `scripts/sync-market-types.ts`. Run it only if a task ends up changing the catalog.
- Editing anything under `src/` restarts the running dev server (tsx watch). Coordinate with other sessions that use port 3001.
- **Data flow returns only with Task 5.** The service scrapes every hour from whatever is saved in `src/`. Tasks 1-4 alone leave pzbuk at 0 matches: the old capture loop still slices `[{` and fails on the envelope's trailing `}`. Task 5 restores real names and data. Do **not** save Task 5's `navigation.ts` / `index.ts` changes into a tree watched by a running dev server unless Task 4's normalizer changes are already in that same tree. Otherwise stop the dev server first, or work in a separate git worktree. Without Task 4, any HH:00 run writes misrouted pzbuk rows: 167's corner lines as HALF_TIME_TOTAL_GOALS, 75 as the only CORRECT_SCORE, players under EXACT_GOALS/HOME_EXACT_GOALS, and half-time handicaps as EUROPEAN_HANDICAP.
- Wire ids are JSON numbers, although types.ts declares `string`. Never compare an id with a string literal without `String()`. Do **not** coerce ids inside `getSelectionName` (raw labels are load-bearing for the normalizer and the golden fixture).
- Do not edit `src/scrapers/aggregator.ts` or `src/services/scraper-service.ts`. Run-level error reporting belongs to the observability plan.
- Keep live bookmaker traffic modest: at most one full-league smoke run per task.

## Review Focus

1. A frame over 1 MiB (player-prop-heavy fixtures) split at a multi-byte UTF-8 boundary (`ł`, `ż`) must reassemble byte-exact. Task 1 test: "reassembles when a chunk boundary splits a multi-byte character". Task 5 test "counts chunked frames and the largest reassembled frame" covers the capture wiring. Live, it stays unverified until A11 reports `chunkedFrames` > 0 with `invalidFrames` = 0.
2. A future unknown market id whose real name is half-scoped (`1./2. Połowa - …`) or card/corner-scoped, or a live `2. gol` / `2. strzelec gola` ordinal, must never land in a full-match result, goals or first-goal code. Task 4 tests: ids 99001-99003, the `2.` ordinal rows and the unrendered `{SpecialIntValue1}` template rows. Live, the gate stays unverified until A12 reports `ordinalMarkets` > 0 with `gatedNonOther` = 0.
3. Two raw markets mapping to one non-OTHER marketKey with overlapping selection codes are silently resolved first-seen in storage. Task 6 test: "has no non-OTHER marketKey collision with overlapping selection codes".
4. If the transport drifts again (new socket path, envelope or a server control frame), the concrete cause must reach `result.error` and the log, not a bare "No WebSocket data captured". Task 5 tests: "names the unmatched socket when the URL pattern drifts" and "reports undecodable frames on a matched socket"; Task 2 test "names the last server control frame".
5. A group subscription that never answers must be visible (groups seen < declared) while the partial offer is still used, and the expansion clicks must not cancel a group that is already subscribed. Task 2 tests: "reports a market group that never answered" and "maps header texts to market-group ids"; Task 1 test "reads subscribed market-group ids from sent SUBSCRIBE frames"; Task 5 log lines.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/scrapers/bookmakers/pzbuk/ws-protocol.ts` | Create | Pure protocol: `decodeFrame`, `initialStatesOf`, `subscribedGroupIds`, `FrameAssembler`, `SingleEventAccumulator`, `CaptureDiagnostics`, `describeCaptureFailure`, `isEmptyListing` |
| `src/scrapers/bookmakers/pzbuk/types.ts` | Modify | `PZBukWebSocketMessage` (types.ts:120-125) payload becomes `unknown`; add `PZBukMarketGroup`, optional `marketGroups` / `originalName` / `marketGroupIds` |
| `src/scrapers/bookmakers/pzbuk/constants.ts:249` | Modify | `WEBSOCKET_URL_PATTERN = "sportsbook-api/ws"` |
| `src/scrapers/bookmakers/pzbuk/navigation.ts:104-147, 203-430` | Modify | Playwright wiring only; returns `CaptureResult`; header clicks skip already-subscribed groups |
| `src/scrapers/bookmakers/pzbuk/index.ts` | Modify | Consume `CaptureResult`; real cause in `error`; empty listing = `success:true`; per-event groups log |
| `src/scrapers/bookmakers/pzbuk/parser.ts:226,227,244,245,253,559,591,631,667` | Modify | Legacy helpers coerce ids; corrected id labels plus a new 146 label |
| `src/services/normalization/bookmakers/pzbuk-normalizer.ts` | Modify | Name-proven id corrections, ordinal gate, `1. strzelec gola` override, tightened `suma` rules, scope guard, selection cases |
| `src/scrapers/bookmakers/pzbuk/__tests__/fixtures/ws-{league,event}-frames.json` | Create (copy) | Durable wire frames from evidence |
| `src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts` | Create | Decoder, assembler, accumulator, diagnostics |
| `src/scrapers/bookmakers/pzbuk/__tests__/capture.test.ts` | Create | `captureWebSocketData` against a fake page |
| `src/scrapers/bookmakers/pzbuk/__tests__/parser.test.ts` | Modify | Legacy helpers on numeric ids; id labels |
| `src/services/normalization/bookmakers/__tests__/pzbuk-real-names.test.ts` | Create | Routing by real names, collision invariant |
| `src/services/normalization/__fixtures__/pzbuk/premier-league_everton_coventry_city{,.expected}.json` | Create (harvest) | Real-names golden fixture |
| `src/services/normalization/__fixtures__/pzbuk/world-cup-2026_france_morocco.expected.json` | Modify (rebless) | #127 only |
| `scripts/pzbuk-smoke.ts` | Create | Live acceptance check A1-A6 |

All test paths below assume `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api`.

**Task order is deliberate:** 1 → 2 → 3 → 4 → 5 → 6 → 7. The normalizer (Task 4) lands before the capture wiring (Task 5) that brings data back (see Global Constraints). Task 4 does not depend on Tasks 1-3: its rows are synthetic and it only consumes `normalizeMarket`.

---

### Task 1: URL pattern, envelope-aware frame decoder, chunk reassembly

**Files:**
- Create: `src/scrapers/bookmakers/pzbuk/ws-protocol.ts`
- Create: `src/scrapers/bookmakers/pzbuk/__tests__/fixtures/ws-league-frames.json`, `ws-event-frames.json` (copied from evidence)
- Modify: `src/scrapers/bookmakers/pzbuk/types.ts` (`PZBukWebSocketMessage` at :120-125, plus appended types), `src/scrapers/bookmakers/pzbuk/constants.ts:246-249`
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts: reuse the existing, otherwise unreferenced PZBukWebSocketMessage (:120-125);
  // its payload becomes unknown because DATA envelopes also carry SELECTION_DELTA / EVENT_DELTA
  export interface PZBukWebSocketMessage { type: string; payload: unknown }
  export interface PZBukMarketGroup { id: number; name: string; marketsCount: number }
  // PZBukEvent gains: marketGroups?: Record<string, PZBukMarketGroup>
  // PZBukMarketType gains: originalName?: string; marketGroupIds?: number[]
  // ws-protocol.ts
  export type DecodedFrame =
    | { kind: "setup"; chunkSize: number }
    | { kind: "data"; streamId: number | null; messages: PZBukWebSocketMessage[] }
    | { kind: "control"; type: string; message: string | null }
    | { kind: "invalid"; error: string };
  export function decodeFrame(text: string): DecodedFrame;
  export function initialStatesOf(frame: DecodedFrame): PZBukInitialState[]; // INITIAL_STATE payloads only
  export function subscribedGroupIds(sentText: string): number[];          // filters.marketGroupIds of a sent SUBSCRIBE, else []
  export class FrameAssembler {
    setChunkSize(bytes: number): void;
    push(payload: Buffer | string): string | null; // full frame text, or null while buffering
  }
  ```

- [ ] **Step 1: Copy the durable fixtures**

```bash
mkdir -p src/scrapers/bookmakers/pzbuk/__tests__/fixtures
cp docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/pzbuk/ws-league-frames.json \
   docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/pzbuk/ws-event-frames.json \
   src/scrapers/bookmakers/pzbuk/__tests__/fixtures/
```

Fixture shape: `{ capturedAt, phase, socketUrl, pageUrl, keptExtraEventIds, frames: [{ dir: "recv"|"sent", binary, originalByteLength, trimmed, text }] }`. League: 3 frames (SETUP, SUBSCRIBE, DATA with events 4408475/4408509/4408525). Event: 31 frames (15 recv); stream 11 is trimmed to market types 36/37/2179, and streams 7/9 to 3 events.

- [ ] **Step 2: Write the failing tests**

```ts
// ws-protocol.test.ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { decodeFrame, initialStatesOf, subscribedGroupIds, FrameAssembler } from "../ws-protocol.js";
import { WEBSOCKET_URL_PATTERN } from "../constants.js";
const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const league = load("ws-league-frames.json");
const event = load("ws-event-frames.json");
const group1 = event.frames.find((f: any) => f.dir === "recv" && f.text.startsWith('{"type":"DATA","streamId":5,')).text;

describe("pzbuk ws transport", () => {
  it("matches the captured sportsbook socket URL", () => {
    expect(league.socketUrl).toBe("wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl");
    expect(league.socketUrl.includes(WEBSOCKET_URL_PATTERN)).toBe(true);
    // The legacy RSocket path ("/websocket") does not contain "sportsbook-api/ws": a transport
    // rollback to it captures no frames, so the scrape fails instead of returning data.
    expect("wss://www.pzbuk.pl/sportsbook-api/websocket".includes(WEBSOCKET_URL_PATTERN)).toBe(false);
  });
  it("reads chunkSize from the SETUP frame", () => {
    expect(decodeFrame(league.frames[0].text)).toEqual({ kind: "setup", chunkSize: 1048576 });
  });
  it("unwraps the DATA envelope into INITIAL_STATE messages", () => {
    const f = decodeFrame(league.frames[2].text);
    if (f.kind !== "data") throw new Error(f.kind);
    expect(f.streamId).toBe(1);
    expect(f.messages.map((m) => m.type)).toEqual(["INITIAL_STATE"]);
    const [state] = initialStatesOf(f);
    expect(state.events.map((e) => e.id)).toEqual([4408475, 4408509, 4408525]);
    expect(state.selections).toHaveLength(18);
  });
  it("keeps delta messages but yields no INITIAL_STATE for them", () => {
    // Synthetic: the 17:56 live capture recorded only the 60-char head of SELECTION_DELTA / EVENT_DELTA frames.
    const f = decodeFrame('{"type":"DATA","streamId":1,"payload":[{"type":"SELECTION_DELTA","payload":{"id":1,"trueOdds":1.7}}]}');
    expect(f).toMatchObject({ kind: "data", streamId: 1, messages: [{ type: "SELECTION_DELTA" }] });
    expect(initialStatesOf(f)).toEqual([]);
  });
  it("classifies CLOSE and ERROR as control frames with their message", () => {
    expect(decodeFrame('{"type":"CLOSE","streamId":7,"reason":"NORMAL","message":null}')).toEqual({ kind: "control", type: "CLOSE", message: null });
    // Synthetic shape: no server ERROR frame has been observed.
    expect(decodeFrame('{"type":"ERROR","streamId":1,"message":"Unknown route"}')).toEqual({ kind: "control", type: "ERROR", message: "Unknown route" });
  });
  it("reads subscribed market-group ids from sent SUBSCRIBE frames", () => {
    const sent: number[][] = event.frames.filter((f: any) => f.dir === "sent").map((f: any) => subscribedGroupIds(f.text));
    expect(sent.find((ids) => ids.length > 0)).toEqual([1]); // stream 5, sent at page load (default-open "Popularne")
    expect(sent.flat().sort((a, b) => a - b)).toEqual([1, 2, 7, 8, 12, 13, 15, 17, 19, 28]);
    expect(subscribedGroupIds('{"type":"CLOSE","streamId":5,"reason":"NORMAL","message":null}')).toEqual([]);
  });
  it("still decodes a legacy RSocket frame (binary header + bare array)", () => {
    const legacy = "\u0000\u0000\u0000\u0001\u0010" + JSON.stringify([{ type: "INITIAL_STATE", payload: { events: [], markets: [], selections: [] } }]);
    expect(decodeFrame(legacy)).toMatchObject({ kind: "data", streamId: null, messages: [{ type: "INITIAL_STATE" }] });
  });
  it("reports truncated JSON as invalid instead of throwing", () => {
    expect(decodeFrame(league.frames[2].text.slice(0, 1000)).kind).toBe("invalid");
    expect(decodeFrame("garbage").kind).toBe("invalid");
  });
});

describe("pzbuk FrameAssembler", () => {
  const split = (bytes: Buffer, size: number) => { const out: Buffer[] = []; for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size)); return out; };
  it("passes frames through while chunking is disabled", () => {
    expect(new FrameAssembler().push(Buffer.from(group1))).toBe(group1);
  });
  it("reassembles a frame split into chunkSize-byte chunks", () => {
    const a = new FrameAssembler(); a.setChunkSize(32768);
    const parts = split(Buffer.from(group1), 32768);
    expect(parts.at(-1)!.length).toBeLessThan(32768);
    const results = parts.map((p) => a.push(p));
    expect(results.slice(0, -1).every((r) => r === null)).toBe(true);
    expect(results.at(-1)).toBe(group1);
    expect(initialStatesOf(decodeFrame(results.at(-1)!))[0].markets).toHaveLength(28);
  });
  it("reassembles when a chunk boundary splits a multi-byte character", () => {
    const bytes = Buffer.from(group1);
    const size = bytes.indexOf(Buffer.from("ł")) + 1; // first chunk ends mid-"ł"
    const a = new FrameAssembler(); a.setChunkSize(size);
    const results = split(bytes, size).map((p) => a.push(p));
    expect(results.at(-1)).toBe(group1);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts`
Expected: FAIL. The suite does not load (`Error: Cannot find module '…/ws-protocol.js' imported from '…/ws-protocol.test.ts'`), so no test runs and there is no separate URL-test failure. Checked on vitest 4.0.16 with a scratch test importing the missing module.

- [ ] **Step 4: Implement**

- constants.ts:246-249: `export const WEBSOCKET_URL_PATTERN = "sportsbook-api/ws";`. Comment: it matches the JSON-envelope socket (`sportsbook-api/ws?franchiseCode=…&locale=…`). The legacy RSocket path (`sportsbook-api/websocket`) does not match: a transport rollback to it captures no frames, so the scrape fails instead of returning data (Risks, open question 8).
- types.ts: change `PZBukWebSocketMessage.payload` to `unknown` and update its doc comment (INITIAL_STATE, SELECTION_DELTA, EVENT_DELTA). `grep -rn PZBukWebSocketMessage src` finds no other user. Append the other types listed under Interfaces.
- `decodeFrame`: `trimStart()`.
  - Text starting with `{`: parse it. `SETUP` gives `setup` (`chunkSize ?? 0`). `DATA` gives `data` (`streamId`, plus `payload` if it is an array, otherwise `[]`). Any other `type` gives `control` with `message: typeof j.message === "string" ? j.message : null`.
  - Text starting with `[`: `data` with `streamId: null`.
  - Otherwise use the legacy slice from `indexOf("[{")`.
  - A parse error gives `invalid` with `error.message`; text that is neither JSON nor legacy gives `invalid("not JSON")`.
- `initialStatesOf`: for `data` frames, the payloads of messages with `type === "INITIAL_STATE"` cast to `PZBukInitialState`; `[]` for every other frame kind and message type.
- `subscribedGroupIds`: parse in a `try`. When `type === "SUBSCRIBE"` and `payload.filters.marketGroupIds` is an array, return its numbers; otherwise (including parse errors) return `[]`.
- `FrameAssembler.push`: this mirrors the site's `bufferAndAssemble`. Convert to bytes (`Buffer.from(text, "utf8")` for strings). When `chunkSize <= 0`, return the text. Otherwise append to the buffer; if `bytes.byteLength >= chunkSize`, return `null`; else return `Buffer.concat(buffer).toString("utf8")` and clear the buffer. Always concat bytes before decoding.

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts`
Expected: PASS (11 tests: 8 transport, 3 assembler).

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/scrapers/bookmakers/pzbuk/ws-protocol.ts src/scrapers/bookmakers/pzbuk/types.ts src/scrapers/bookmakers/pzbuk/constants.ts src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts src/scrapers/bookmakers/pzbuk/__tests__/fixtures
git commit -m "fix(pzbuk): decode sportsbook-api/ws JSON envelope frames with chunk reassembly"
```

### Task 2: Single-event accumulator (market union) and capture diagnostics

**Files:**
- Modify: `src/scrapers/bookmakers/pzbuk/ws-protocol.ts`
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts` (new `describe` blocks)

**Interfaces:**
- Consumes: `decodeFrame`, `initialStatesOf` (Task 1), `parseAllMarkets` / `parseTeamNames` (parser.ts, unchanged).
- Produces:
  ```ts
  export interface AccumulatorStats { selections: number; markets: number; marketGroupsDeclared: number[]; marketGroupsSeen: number[] }
  export class SingleEventAccumulator {
    constructor(expectedEventId?: number | string); // when set, single-event payloads for any other event are rejected
    add(state: PZBukInitialState): boolean;     // true only for a merged single-event payload
    snapshot(): PZBukInitialState | null;       // null until ≥ 1 Active selection merged
    stats(): AccumulatorStats;                  // seen = per-payload intersection of marketGroupIds
    groupIdForHeader(headerText: string): number | null; // trimmed, case-insensitive match on event.marketGroups[].name
  }
  export interface CaptureDiagnostics {
    socketUrls: string[]; matchedSockets: number; framesReceived: number;
    invalidFrames: number; lastInvalidError: string | null;
    chunkedFrames: number;                                        // FrameAssembler.push calls that returned null (chunk continuations)
    maxFrameBytes: number;                                        // byte length of the largest complete (reassembled) frame
    initialStates: number; maxEvents: number;                     // maxEvents = max events.length over decoded INITIAL_STATEs
    lastControl: { type: string; message: string | null } | null; // last received non-SETUP control frame
    groups?: { declared: number[]; seen: number[] };
  }
  export function emptyDiagnostics(): CaptureDiagnostics;
  export function isEmptyListing(d: CaptureDiagnostics): boolean; // initialStates > 0 && maxEvents === 0
  export function describeCaptureFailure(d: CaptureDiagnostics): string;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { SingleEventAccumulator, describeCaptureFailure, emptyDiagnostics, isEmptyListing } from "../ws-protocol.js";
import { parseAllMarkets, parseTeamNames } from "../parser.js";
const states = (frames: any[], skipStream?: number) => frames.filter((f) => f.dir === "recv").flatMap((f) => {
  const d = decodeFrame(f.text);
  return d.kind === "data" && d.streamId !== skipStream ? initialStatesOf(d) : [];
});
const GROUPS = [1, 2, 7, 8, 12, 13, 15, 17, 19, 28];

describe("pzbuk SingleEventAccumulator", () => {
  it("unions markets and selections across all market-group messages", () => {
    const acc = new SingleEventAccumulator();
    states(event.frames).forEach((s) => acc.add(s));
    const snap = acc.snapshot()!;
    expect(snap.events[0].id).toBe(4408475);
    expect(acc.stats()).toEqual({ selections: 656, markets: 157, marketGroupsDeclared: GROUPS, marketGroupsSeen: GROUPS });
  });
  it("ignores multi-event listing messages on the event page", () => {
    const acc = new SingleEventAccumulator();
    const listing = states(event.frames).find((s) => s.events.length === 3 && s.selections.length === 18)!;
    expect(acc.add(listing)).toBe(false);
    expect(acc.snapshot()).toBeNull();
  });
  it("reports a market group that never answered", () => {
    const acc = new SingleEventAccumulator();
    states(event.frames, 11).forEach((s) => acc.add(s)); // stream 11 = group 28 "Zawodnicy"
    expect(acc.stats().marketGroupsSeen).toEqual([1, 2, 7, 8, 12, 13, 15, 17, 19]);
    expect(acc.snapshot()).not.toBeNull();
  });
  it("rejects single-event payloads for another event", () => {
    const acc = new SingleEventAccumulator(4408509);
    expect(states(event.frames).map((s) => acc.add(s)).some(Boolean)).toBe(false);
    expect(acc.snapshot()).toBeNull();
  });
  it("maps header texts to market-group ids", () => {
    const acc = new SingleEventAccumulator(4408475);
    states(event.frames).forEach((s) => acc.add(s));
    // marketGroups["2"].name is "Gole " (trailing space) on the wire
    expect(["Popularne", "Gole", "1 połowa", "Nieznane"].map((t) => acc.groupIdForHeader(t))).toEqual([1, 2, 7, null]);
  });
  it("feeds parseAllMarkets real API names (no placeholders) and raw selection labels", () => {
    const acc = new SingleEventAccumulator();
    states(event.frames).forEach((s) => acc.add(s));
    const snap = acc.snapshot()!;
    const markets = parseAllMarkets(snap, snap.events[0].id, parseTeamNames(snap.events[0]));
    expect(markets).toHaveLength(147);
    expect(markets.filter((m) => /^Rynek \d+$/.test(m.name))).toEqual([]);
    expect(markets.find((m) => m.bookmakerMarketId === "167" && m.paramValue === "4.5")?.name).toBe("1. Połowa - Suma rzutów rożnych");
    const x12 = markets.find((m) => m.bookmakerMarketId === "1")!;
    expect([x12.name, x12.selections.map((s) => [s.name, s.odds])]).toEqual(["1x2", [["Everton FC", 1.66], ["Remis", 3.92], ["Coventry City", 4.91]]]);
    expect(markets.find((m) => m.bookmakerMarketId === "10")!.selections.map((s) => s.name))
      .toEqual(["Everton FC lub remis", "Everton FC lub Coventry City", "remis lub Coventry City"]);
  });
});

describe("pzbuk describeCaptureFailure", () => {
  const WS = "wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl";
  it("names the sockets when none matched", () => {
    expect(describeCaptureFailure(emptyDiagnostics())).toBe('no socket matched "sportsbook-api/ws" (sockets seen: none)');
  });
  it("names the decode error when the socket matched", () => {
    expect(describeCaptureFailure({ ...emptyDiagnostics(), socketUrls: [WS], matchedSockets: 1, framesReceived: 2, invalidFrames: 1,
      lastInvalidError: "Unexpected non-whitespace character after JSON at position 233949" }))
      .toBe("socket matched but no INITIAL_STATE decoded (frames: 2, invalid: 1, last error: Unexpected non-whitespace character after JSON at position 233949)");
  });
  it("reports INITIAL_STATE without a usable snapshot", () => {
    expect(describeCaptureFailure({ ...emptyDiagnostics(), socketUrls: [WS], matchedSockets: 1, framesReceived: 3, initialStates: 2, maxEvents: 20 }))
      .toBe("2 INITIAL_STATE message(s) but no usable snapshot (max events per message: 20, frames: 3)");
  });
  it("reports an empty listing", () => {
    const d = { ...emptyDiagnostics(), socketUrls: [WS], matchedSockets: 1, framesReceived: 2, initialStates: 1, maxEvents: 0 };
    expect([isEmptyListing(d), isEmptyListing(emptyDiagnostics())]).toEqual([true, false]);
    expect(describeCaptureFailure(d)).toBe("listing is empty (1 INITIAL_STATE message(s) with 0 events, frames: 2)");
  });
  it("names the last server control frame", () => {
    expect(describeCaptureFailure({ ...emptyDiagnostics(), socketUrls: [WS], matchedSockets: 1, framesReceived: 2,
      lastControl: { type: "ERROR", message: "Unknown route" } }))
      .toBe("socket matched but no INITIAL_STATE decoded (frames: 2, invalid: 0, last control: ERROR Unknown route)");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts -t "SingleEventAccumulator|describeCaptureFailure"`
Expected: FAIL with `SingleEventAccumulator is not a constructor` / `describeCaptureFailure is not a function`.

- [ ] **Step 3: Implement**

- `add()` accepts only `state.events.length === 1`, and, when `expectedEventId` is set, only `String(events[0].id) === String(expectedEventId)`. Without `expectedEventId` it locks to the event of the first accepted payload (final review F4). The event comes from the first accepted payload. Markets are a `Map` keyed by `market.id` (last write wins). Selections are a `Map` keyed by `selection.id`, Active only.
- `marketGroupsDeclared` = `Object.keys(event.marketGroups ?? {}).map(Number)`, sorted ascending.
- `marketGroupsSeen`: ~~for each merged payload with ≥ 1 market, take the **intersection** of its markets' `marketType.marketGroupIds`~~. Amended by controller ruling 6 (final review): `add(state, streamGroupIds)` marks seen only the market groups that the delivering stream's own `SUBSCRIBE` requested (`parseSubscription`: `streamId` + `filters.marketGroupIds`, tracked per socket in Task 5), and only for a merged payload with ≥ 1 market; sorted ascending. The intersection marked a silent group 1 "Popularne" as seen whenever another group's stream carried only markets also listed under group 1 (e.g. 2179 `[28, 1]`). Neither the union nor the intersection of the markets' own group ids is used.
- `groupIdForHeader`: compare `headerText.trim().toLowerCase()` with each `marketGroups[].name.trim().toLowerCase()`; `null` before an event is stored or without a match.
- `describeCaptureFailure` checks in order: `matchedSockets === 0`, then `initialStates === 0`, then `isEmptyListing(d)`, then the no-usable-snapshot case. Messages are exactly the test strings. Use `WEBSOCKET_URL_PATTERN` in the first message. In the three matched-socket messages, append inside the parentheses `, last error: …` when `lastInvalidError` is set and `, last control: <type>[ <message>]` when `lastControl` is set.
- `emptyDiagnostics()` sets `chunkedFrames` and `maxFrameBytes` to 0, like the other counters. Task 5 counts them, and the per-event log line and the Task 7 SMOKE line print them (A11). `describeCaptureFailure` does not print them, so its strings stay exactly the tested ones.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts`
Expected: PASS (22 tests: the 11 from Task 1, 6 accumulator, 5 describeCaptureFailure).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/scrapers/bookmakers/pzbuk/ws-protocol.ts src/scrapers/bookmakers/pzbuk/__tests__/ws-protocol.test.ts
git commit -m "fix(pzbuk): union markets across market-group streams and describe capture failures"
```

### Task 3: Legacy helpers on numeric ids

**Files:**
- Modify: `src/scrapers/bookmakers/pzbuk/parser.ts:559, 591, 631, 667`
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/parser.test.ts`

**Interfaces:**
- Consumes: `SingleEventAccumulator` (Task 2), `decodeFrame`, `initialStatesOf` (Task 1). Fixtures only; no data flow is restored by this task.
- Produces: no new names. `parse1X2Odds`, `parseDoubleChance`, `parseBTTS`, `parseOverUnder` and `hasValid1X2Odds` now work on numeric `marketTypeId`.

- [ ] **Step 1: Write the failing tests** (append to `parser.test.ts`; load the fixtures and build `sels` = `snapshot().selections` from the event fixture, as in Task 2)

```ts
describe("pzbuk legacy helpers on numeric wire ids", () => {
  it("parse1X2Odds reads id 1", () => expect(parse1X2Odds(sels)).toEqual({ home: 1.66, draw: 3.92, away: 4.91 }));
  it("parseDoubleChance reads id 10 by selection name", () =>
    expect(parseDoubleChance(sels)).toEqual({ homeOrDraw: 1.19, drawOrAway: 2.13, homeOrAway: 1.26 }));
  it("parseBTTS reads id 27", () => expect(parseBTTS(sels)).toEqual({ yes: 1.76, no: 1.92 }));
  it("parseOverUnder reads id 17 lines", () => {
    const ou = parseOverUnder(sels)!;
    expect(Object.keys(ou).sort()).toEqual(["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"]);
    expect(ou["2.5"]).toEqual({ over: 1.77, under: 1.98 });
  });
  it("hasValid1X2Odds accepts the league snapshot event", () => {
    const [listing] = initialStatesOf(decodeFrame(league.frames[2].text));
    const ls = listing.selections.filter((s) => s.eventId === (4408475 as unknown as string));
    expect(hasValid1X2Odds(ls)).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/parser.test.ts -t "numeric wire ids"`
Expected: FAIL (`{ home: 0, draw: 0, away: 0 }`, and `null` for the others).

- [ ] **Step 3: Implement**

Use `String(s.marketTypeId) === MARKET_TYPES.X` at parser.ts:559, 591, 631, 667 only. Leave `getSelectionName` (parser.ts:301-521) untouched; the Task 2 test pins its raw labels.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/scrapers/bookmakers/pzbuk`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/scrapers/bookmakers/pzbuk/parser.ts src/scrapers/bookmakers/pzbuk/__tests__/parser.test.ts
git commit -m "fix(pzbuk): compare numeric marketTypeId in legacy 1X2/DC/BTTS/OU helpers"
```

### Task 4: Normalizer integrity for real names

Lands **before** the capture wiring (Task 5). It needs nothing from Tasks 1-3.

**Files:**
- Modify: `src/services/normalization/bookmakers/pzbuk-normalizer.ts`. Id map at :31, :81, :85, :118, :119, :210, :211, :246, :282, :283, :343, plus new entries for 58/59/60/61/75/80/146. Overrides at :446 (two new entries next to it) and :458-459. Selection cases at :598-599, :638-656, :673-677, :811-820. Param list at :925-957. `matchMarketByName` at :1063-1110.
- Modify: `src/scrapers/bookmakers/pzbuk/parser.ts:226, 227, 244, 245, 253` plus a new `"146"` entry (`PZBUK_ID_LABELS`)
- Modify (rebless): `src/services/normalization/__fixtures__/pzbuk/world-cup-2026_france_morocco.expected.json`
- Test: `src/services/normalization/bookmakers/__tests__/pzbuk-real-names.test.ts`, `src/scrapers/bookmakers/pzbuk/__tests__/parser.test.ts`

**Interfaces:**
- Consumes: `pzbukNormalizer.normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null` (unchanged signature).
- Produces: behaviour only (the routing table in Observations).

- [ ] **Step 1: Write the failing routing tests** (values from the 2026-11-06 capture)

```ts
import { describe, it, expect } from "vitest";
import { pzbukNormalizer } from "../pzbuk-normalizer.js";
const ctx = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" };
type Row = [id: string, name: string, param: string, sels: [string, number][], code: string, sel?: [string, number]];
const norm = ([id, name, param, sels]: Row) =>
  pzbukNormalizer.normalizeMarket({ bookmakerMarketId: id, name, paramValue: param, selections: sels.map(([n, o]) => ({ name: n, odds: o })) }, ctx);
const SCORERS: [string, number][] = [["Keane, Michael", 11.19], ["Barry, Thierno", 4.18]];
const rows: Row[] = [
  ["126", "Kartki 1x2", "0", [["Everton FC", 2.75], ["remis", 3.83], ["Coventry City", 1.95]], "CARDS_RACE", ["HOME", 2.75]],
  ["78", "2. Połowa - Podwójna szansa", "0", [["Everton FC lub remis", 1.18], ["Everton FC lub Coventry City", 1.38], ["remis lub Coventry City", 1.64]], "SECOND_HALF_DOUBLE_CHANCE", ["HOME_OR_DRAW", 1.18]],
  ["79", "2. Połowa - Remis bez zakładu", "0", [["Everton FC", 1.33], ["Coventry City", 2.8]], "SECOND_HALF_DRAW_NO_BET", ["AWAY", 2.8]],
  ["36", "1. strzelec gola", "0", SCORERS, "GOALSCORER_FIRST", ["Thierno Barry", 4.18]],
  ["37", "Strzelec ostatniego gola", "0", SCORERS, "GOALSCORER_LAST", ["Michael Keane", 11.19]],
  ["147", "1. Połowa - Coventry City Dokładna liczba kartek", "0", [["0", 1.82], ["1", 2.32], ["2", 5.61], ["3+", 16.72]], "HALF_TIME_AWAY_EXACT_CARDS", ["3+", 16.72]],
  ["501", "2. Połowa - 1x2 & oba zespoły strzelą", "0", [["Everton FC & tak", 8.95], ["Everton FC & nie", 2.27], ["remis & tak", 6.2], ["remis & nie", 3.84], ["Coventry City & tak", 19.67], ["Coventry City & nie", 5.11]], "SECOND_HALF_RESULT_AND_BTTS", ["HOME_YES", 8.95]],
  ["167", "1. Połowa - Suma rzutów rożnych", "4.5", [["ponad 4.5", 1.88], ["poniżej 4.5", 1.73]], "HALF_TIME_CORNERS_TOTAL", ["OVER", 1.88]],
  ["142", "1. Połowa - Suma kartek", "1.5", [["ponad 1.5", 2.1], ["poniżej 1.5", 1.55]], "HALF_TIME_CARDS_TOTAL", ["UNDER", 1.55]],
  ["58", "1. Połowa - Podwójna szansa", "0", [["Everton FC lub remis", 1.15], ["Everton FC lub Coventry City", 1.49], ["remis lub Coventry City", 1.57]], "HALF_TIME_DOUBLE_CHANCE", ["DRAW_OR_AWAY", 1.57]],
  ["59", "1. Połowa - Remis bez zakładu", "0", [["Everton FC", 1.32], ["Coventry City", 2.99]], "HALF_TIME_DRAW_NO_BET", ["HOME", 1.32]],
  ["75", "1. Połowa - Dokładny wynik", "0", [["0:0", 2.85], ["1:0", 3.4], ["inny", 12.3]], "HALF_TIME_CORRECT_SCORE", ["0-0", 2.85]],
  ["60", "1. Połowa - handicap", "0", [["Everton FC (1:0)", 1.13], ["remis (1:0)", 5.21], ["Coventry City (1:0)", 21.61]], "OTHER"],
  ["61", "1. Połowa - handicap", "0.5", [["Everton FC (+0.5)", 1.14], ["Coventry City (-0.5)", 4.52]], "OTHER"],
  ["80", "2. Połowa - handicap", "0", [["Everton FC (1:0)", 1.17], ["remis (1:0)", 5.11], ["Coventry City (1:0)", 15.71]], "OTHER"],
  ["146", "1. Połowa - Everton FC Dokładna liczba kartek", "0", [["0", 1.63], ["1", 2.41], ["2", 6.69], ["3+", 23.61]], "HALF_TIME_HOME_EXACT_CARDS", ["3+", 23.61]],
  // ordinal templates ({SpecialIntValue1}): the "2." names are synthetic (live-only), odds illustrative
  ["36", "2. strzelec gola", "0", SCORERS, "OTHER"],
  ["8", "2. gol", "0", [["Everton FC", 2.1], ["żaden", 5.0], ["Coventry City", 3.2]], "OTHER"],
  ["57", "1. Połowa - 2. gol", "0", [["Everton FC", 2.9], ["żaden", 1.9], ["Coventry City", 4.4]], "OTHER"],
  ["92", "Kiedy zostanie strzelony 2. gol (10 min interwał)", "0", [["1-10", 9.1], ["żaden", 2.2]], "OTHER"],
  // regression guards: must not move
  ["1", "1x2", "0", [["Everton FC", 1.66], ["Remis", 3.92], ["Coventry City", 4.91]], "MATCH_WINNER", ["HOME", 1.66]],
  ["10", "Podwójna szansa", "0", [["Everton FC lub remis", 1.19], ["Everton FC lub Coventry City", 1.26], ["remis lub Coventry City", 2.13]], "DOUBLE_CHANCE", ["HOME_OR_DRAW", 1.19]],
  ["11", "Remis bez zakładu", "0", [["Everton FC", 1.26], ["Coventry City", 3.53]], "DRAW_NO_BET", ["AWAY", 3.53]],
  ["62", "1. Połowa - Suma", "0.5", [["ponad 0.5", 1.32], ["poniżej 0.5", 3.04]], "HALF_TIME_TOTAL_GOALS", ["OVER", 1.32]],
  ["82", "2. Połowa - Suma", "0.5", [["ponad 0.5", 1.2], ["poniżej 0.5", 3.93]], "SECOND_HALF_TOTAL_GOALS", ["UNDER", 3.93]],
  ["55", "1. Połowa - 1x2", "0", [["Everton FC", 2.14], ["remis", 2.3], ["Coventry City", 5.11]], "HALF_TIME_RESULT", ["DRAW", 2.3]],
  ["76", "2. Połowa - 1x2", "0", [["Everton FC", 1.99], ["remis", 2.65], ["Coventry City", 4.52]], "SECOND_HALF_RESULT", ["AWAY", 4.52]],
  ["167", "Rynek 167", "4.5", [["ponad 4.5", 1.88], ["poniżej 4.5", 1.73]], "HALF_TIME_CORNERS_TOTAL", ["OVER", 1.88]],
  ["8", "1. gol", "0", [["Everton FC", 1.5], ["żaden", 12.77], ["Coventry City", 2.75]], "FIRST_TEAM_TO_SCORE", ["NONE", 12.77]],
  ["57", "1. Połowa - 1. gol", "0", [["Everton FC", 2.9], ["żaden", 1.9], ["Coventry City", 4.4]], "HALF_TIME_FIRST_GOAL", ["NONE", 1.9]],
  // 21/23 pass today only because every selection is UNKNOWN and the market is dropped
  ["21", "Everton FC Dokładna liczba goli", "0", [["0", 5.4], ["1", 3.05], ["2", 3.29], ["3+", 3.14]], "OTHER"],
  ["23", "Zakres liczby goli", "0", [["0-1", 3.64], ["2-3", 1.92], ["4-5", 3.44], ["6+", 12.04]], "OTHER"],
  // scope guard: unknown ids with half/stat-scoped names never reach full-match codes
  ["99001", "1. Połowa - Liczba goli gospodarzy", "1.5", [["ponad 1.5", 3.1], ["poniżej 1.5", 1.3]], "OTHER"],
  ["99002", "2. Połowa - Dokładny wynik", "0", [["0:0", 3.79], ["1:0", 3.79]], "OTHER"],
  ["99003", "Kartki - Podwójna szansa", "0", [["Everton FC lub remis", 1.3]], "OTHER"],
];
describe("pzbuk routing by real API names (2026-11-06 capture)", () => {
  it.each(rows)("id %s %s -> %s", (...row) => {
    const out = norm(row as Row);
    const [, , param, , code, sel] = row as Row;
    expect(out?.marketCode ?? "OTHER").toBe(code);
    if (sel) expect(out!.selections.find((s) => String(s.code) === sel[0])?.odds).toBe(sel[1]);
    if (code.endsWith("_TOTAL") || code.endsWith("TOTAL_GOALS")) expect(out!.paramValue).toBe(param);
  });
});
```

Add to `parser.test.ts`: `it("labels blank-named id 126 as Kartki 1x2")`. Build `parseAllMarkets` input with one market `{ id: "m", name: "", marketType: { id: "126", name: "" } }` and one Active selection `marketTypeId: "126"`, and assert `markets[0].name === "Kartki 1x2"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/pzbuk-real-names.test.ts src/scrapers/bookmakers/pzbuk/__tests__/parser.test.ts`
Expected: 23 of the 35 routing rows FAIL: the 20 integrity rows (15 misroutes, 146, 4 ordinal rows) and the 3 guard rows, e.g. `expected 'MATCH_WINNER' to be 'CARDS_RACE'` and `'HALF_TIME_TOTAL_GOALS' to be 'HALF_TIME_CORNERS_TOTAL'`. The label test fails too. The 12 regression guards PASS. These counts were checked on 2026-11-06 by running these exact rows against the current normalizer (23 fail / 12 pass) and against a scratch copy patched as in Step 3 (35 pass).

- [ ] **Step 3: Implement**

- **Id map.** Set `"36": OTHER`, `"37": GOALSCORER_LAST`, `"78": SECOND_HALF_DOUBLE_CHANCE`, `"79": SECOND_HALF_DRAW_NO_BET`, `"126": CARDS_RACE`, `"142": HALF_TIME_CARDS_TOTAL`, `"147": HALF_TIME_AWAY_EXACT_CARDS`, `"501": SECOND_HALF_RESULT_AND_BTTS`. Also set `"8": OTHER` (`{SpecialIntValue1}. goal`), `"21": OTHER` (`{Competitors[0]} exact goals`) and `"23": OTHER` (`Goal range`). Add `"58": HALF_TIME_DOUBLE_CHANCE`, `"59": HALF_TIME_DRAW_NO_BET`, `"75": HALF_TIME_CORRECT_SCORE`, `"146": HALF_TIME_HOME_EXACT_CARDS`, `"60"/"61"/"80": OTHER`. Give each entry a one-line comment with its captured real name or `originalName` and `evidence/pzbuk/market-type-ids-2026-11-06.json`.
- **Overrides.** Add as the **first** `PZBUK_NAME_OVERRIDES` entry the ordinal gate `{ pattern: /(?:^|\s)(?:[2-9]|\d{2,})\.\s*(?:gol|strzelec|kartk)/i, code: "OTHER" }`. It catches the `{SpecialIntValue1}` families (8, 36, 57, 77, 91, 92, 140) once the ordinal is ≥ 2. It does not touch `2. Połowa - …`, because `Połowa` follows the ordinal there. Right after the gate, add `{ pattern: /\{SpecialIntValue\d*\}/i, code: "OTHER" }` for an unrendered `marketType.name` template (review fix round 1; Risks, "Unrendered ordinal templates"), tested by one row per captured template (8, 36, 57, 77, 91, 92, 140). Next to the `1. gol` override (:446), add `{ pattern: /^1\.\s*strzelec gola$/i, code: "GOALSCORER_FIRST" }`. Anchor the `suma` patterns as `suma\s*$` at :458-459 and in `matchMarketByName` :1071-1072.
- **Scope guard.** In `matchMarketByName`, right after the half-scoped patterns (:1074), add: `if (/^[12]\.?\s*po[łl]owa\b/.test(lower) || /kartk|ro[żz]n/.test(lower)) return null;`.
- **Selection cases.** Add `SECOND_HALF_DOUBLE_CHANCE` to the DC case (:598-599), `HALF_TIME_CARDS_TOTAL` to the O/U case (:638-656) and to `parameterizedMarkets` (:925-957), `HALF_TIME_AWAY_EXACT_CARDS` to the bucket case (:673-677), and `SECOND_HALF_RESULT_AND_BTTS` to the combination case (:811-820). `HALF_TIME_HOME_EXACT_CARDS` is already in the bucket case (:673).
- **Labels.** In `PZBUK_ID_LABELS`, set `"78": "2. Połowa - Podwójna szansa"`, `"79": "2. Połowa - Remis bez zakładu"`, `"126": "Kartki 1x2"`, `"147": "Dokładna liczba kartek - goście - 1. połowa"`, `"501": "2. Połowa - 1x2 & oba zespoły strzelą"`, and add `"146": "Dokładna liczba kartek - gospodarze - 1. połowa"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__ src/scrapers/bookmakers/pzbuk`
Expected: PASS, including the existing `pzbuk-audit-fixes.test.ts`.

- [ ] **Step 5: Confirm the one expected golden failure**

Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t pzbuk`
Expected: FAIL with exactly 1 failure, entry `#127` "Zakład bez remisu" (DRAW_NO_BET → SECOND_HALF_DRAW_NO_BET). This was checked offline with the Step 3 patch: 1 blessed failure, 44 unblessed diffs that never fail. Any other failing entry: stop and inspect.

- [ ] **Step 6: Inspect, then rebless**

Run: `npx tsx scripts/rebless-golden.ts --bookmaker pzbuk --dry`
Expected: stderr `[rebless] pzbuk/world-cup-2026_france_morocco: 1 entry updated` / `    - Zakład bez remisu`, stdout `{"changedTotal":1,"dry":true}`.

Then run `npx tsx scripts/rebless-golden.ts --bookmaker pzbuk`. `git diff` must show only #127's `marketCode` / `marketKey` changing to `SECOND_HALF_DRAW_NO_BET`, with odds 1.24/3.29 unchanged.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/services/normalization/bookmakers/pzbuk-normalizer.ts src/scrapers/bookmakers/pzbuk/parser.ts src/services/normalization/bookmakers/__tests__/pzbuk-real-names.test.ts src/scrapers/bookmakers/pzbuk/__tests__/parser.test.ts src/services/normalization/__fixtures__/pzbuk/world-cup-2026_france_morocco.expected.json
git commit -m "fix(pzbuk): route half-time, card and corner markets by their real names"
```

### Task 5: Wire the protocol into capture and propagate the real cause

This task brings pzbuk data back. Saving its files under a running dev server writes rows to the DB at the next HH:00 run.

**Files:**
- Modify: `src/scrapers/bookmakers/pzbuk/navigation.ts:104-147` (`expandAllMarketGroups`), `:203-430` (`captureWebSocketData`)
- Modify: `src/scrapers/bookmakers/pzbuk/index.ts:22, 93-114, 225-250, 322-347, 370-432`
- Test: `src/scrapers/bookmakers/pzbuk/__tests__/capture.test.ts`

**Interfaces:**
- Requires: Task 4 committed, or at least present in the same working tree, before any file of this task is saved where a dev server watches (Global Constraints).
- Consumes: `decodeFrame`, `initialStatesOf`, `subscribedGroupIds`, `FrameAssembler` (Task 1); `SingleEventAccumulator`, `CaptureDiagnostics`, `emptyDiagnostics`, `isEmptyListing`, `describeCaptureFailure` (Task 2).
- Produces:
  ```ts
  // navigation.ts
  export interface CaptureResult { state: PZBukInitialState | null; diagnostics: CaptureDiagnostics }
  export function captureWebSocketData(page: Page, singleEvent?: boolean, expectedEventId?: number | string): Promise<CaptureResult>;
  // internal: expandAllMarketGroups(page, shouldStop, skipHeader?: (headerText: string) => boolean): Promise<{ clicked: number; skipped: number }>
  // index.ts: run-level transport counters of the last scrapeFullOffer call (consumed by Task 7)
  lastTransportStats: Pick<CaptureDiagnostics, "invalidFrames" | "chunkedFrames" | "maxFrameBytes">; // public field of the PZBuk scraper class
  ```
  Error strings in index.ts: `No WebSocket data captured: <describeCaptureFailure>` (scrapeLeague, scrapeFullOffer listing), `No WebSocket data for match details: <…>` (scrapeMatchDetails), and `No markets captured for any of <n> listed events (first failure: <…>)` (scrapeFullOffer when `matches.length === 0` after a non-empty listing). An empty listing (`isEmptyListing`) is `success: true, matches: []` in scrapeFullOffer.

- [ ] **Step 1: Confirm the precondition**

Run: `git log --oneline -3 -- src/services/normalization/bookmakers/pzbuk-normalizer.ts`
Expected: the Task 4 commit "fix(pzbuk): route half-time, card and corner markets by their real names" is listed. If it is not, and a dev server watches this tree, stop. Either land Task 4 first, stop the dev server, or work in a separate git worktree.

- [ ] **Step 2: Write the failing tests**

```ts
// capture.test.ts
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureWebSocketData } from "../navigation.js";
import { describeCaptureFailure, isEmptyListing } from "../ws-protocol.js";
const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const league = load("ws-league-frames.json");
const event = load("ws-event-frames.json");
const fakePage = () => new EventEmitter() as unknown as Page & EventEmitter;
const fakeSocket = (url: string) => Object.assign(new EventEmitter(), { url: () => url });
const replay = (ws: EventEmitter, frames: any[]) => frames.filter((f) => f.dir === "recv").forEach((f) => ws.emit("framereceived", { payload: Buffer.from(f.text) }));
const recv = (ws: EventEmitter, text: string) => ws.emit("framereceived", { payload: Buffer.from(text) });

describe("pzbuk captureWebSocketData", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("captures the league snapshot from the new socket and detaches", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws); replay(ws, league.frames);
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect([r.state?.events.length, r.state?.selections.length]).toEqual([3, 18]);
    expect(r.diagnostics).toMatchObject({ matchedSockets: 1, framesReceived: 2, invalidFrames: 0, initialStates: 1, maxEvents: 3 });
    expect(page.listenerCount("websocket")).toBe(0);
  });
  it("accepts a one-event listing", async () => {
    const env = JSON.parse(league.frames[2].text);
    const st = env.payload[0].payload;
    st.events = st.events.slice(0, 1);
    st.markets = st.markets.filter((m: any) => m.eventId === 4408475);
    st.selections = st.selections.filter((s: any) => s.eventId === 4408475);
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws); recv(ws, JSON.stringify(env));
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect([r.state?.events.length, r.state?.selections.length]).toEqual([1, 6]);
  });
  it("treats a 0-event listing as empty, not as a failure", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws);
    recv(ws, '{"type":"DATA","streamId":1,"payload":[{"type":"INITIAL_STATE","payload":{"events":[],"markets":[],"selections":[]}}]}');
    await vi.advanceTimersByTimeAsync(1500); // resolves after WS_MIN_WAIT, not at WS_MAX_WAIT
    const r = await p;
    expect(r.state).toBeNull();
    expect(isEmptyListing(r.diagnostics)).toBe(true);
  });
  it("accumulates the event offer across market-group streams", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, true, 4408475);
    const ws = fakeSocket(event.socketUrl); page.emit("websocket", ws); replay(ws, event.frames);
    await vi.advanceTimersByTimeAsync(26_000);
    const r = await p;
    expect([r.state?.markets.length, r.state?.selections.length]).toEqual([157, 656]);
    expect(r.diagnostics.groups).toEqual({ declared: [1, 2, 7, 8, 12, 13, 15, 17, 19, 28], seen: [1, 2, 7, 8, 12, 13, 15, 17, 19, 28] });
  });
  it("counts chunked frames and the largest reassembled frame", async () => {
    // Synthetic chunking: no live frame has reached the announced 1048576 B yet.
    const group1 = Buffer.from(event.frames.find((f: any) => f.dir === "recv" && f.text.startsWith('{"type":"DATA","streamId":5,')).text);
    const page = fakePage();
    const p = captureWebSocketData(page, true, 4408475);
    const ws = fakeSocket(event.socketUrl); page.emit("websocket", ws);
    recv(ws, '{"type":"SETUP","chunkSize":32768}');
    for (let i = 0; i < group1.length; i += 32768) ws.emit("framereceived", { payload: group1.subarray(i, i + 32768) }); // 32768, 32768, 16671 B
    await vi.advanceTimersByTimeAsync(26_000);
    const r = await p;
    expect([r.state?.markets.length, r.state?.selections.length]).toEqual([28, 169]);
    expect(r.diagnostics).toMatchObject({ framesReceived: 4, invalidFrames: 0, chunkedFrames: 2, maxFrameBytes: 82207, initialStates: 1 });
  });
  it("single-event mode resolves at WS_MAX_WAIT with no frames", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, true);
    await vi.advanceTimersByTimeAsync(25_500);
    const r = await p;
    expect(r.state).toBeNull();
    expect(describeCaptureFailure(r.diagnostics)).toBe('no socket matched "sportsbook-api/ws" (sockets seen: none)');
    expect(page.listenerCount("websocket")).toBe(0);
  });
  it("names the unmatched socket when the URL pattern drifts", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    page.emit("websocket", fakeSocket("wss://www.pzbuk.pl/sportsbook-api/v3/stream"));
    await vi.advanceTimersByTimeAsync(25_500);
    const r = await p;
    expect(r.state).toBeNull();
    expect(describeCaptureFailure(r.diagnostics)).toBe('no socket matched "sportsbook-api/ws" (sockets seen: wss://www.pzbuk.pl/sportsbook-api/v3/stream)');
  });
  it("reports undecodable frames on a matched socket", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws);
    recv(ws, league.frames[2].text.slice(0, 1000));
    await vi.advanceTimersByTimeAsync(25_500);
    expect(describeCaptureFailure((await p).diagnostics)).toMatch(/^socket matched but no INITIAL_STATE decoded \(frames: 1, invalid: 1, last error: /);
  });
  it("records a server control frame", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws);
    recv(ws, '{"type":"ERROR","streamId":1,"message":"Unknown route"}'); // synthetic shape
    await vi.advanceTimersByTimeAsync(25_500);
    expect(describeCaptureFailure((await p).diagnostics)).toBe("socket matched but no INITIAL_STATE decoded (frames: 1, invalid: 0, last control: ERROR Unknown route)");
  });
});
```

The fake page has no `locator`/`getByText`. `dismissCookieConsent`, `expandAllMarketGroups` and `clickAllShowMore` catch the resulting TypeError, so single-event mode runs its normal loop under fake timers (`Date.now` is faked too).

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/scrapers/bookmakers/pzbuk/__tests__/capture.test.ts`
Expected: 9 FAIL. Three tests time out at 10000 ms: "captures the league snapshot…", "accepts a one-event listing" and "treats a 0-event listing…". The current loop cannot parse the envelope and resolves only at WS_MAX_WAIT (25 s), while these tests advance 1.5 s, so they hit vitest's `testTimeout: 10000`. The other six fail with `TypeError: Cannot read properties of null (reading 'state')` or `(reading 'diagnostics')`, because the current function resolves a bare `null`. These results were checked on the current code with this harness on 2026-11-06. All 9 were re-checked on 2026-11-07 against the post-Task-1 loop, which matches the new socket but still slices `[{`: 3 timeouts and 6 TypeErrors. The chunk-counter test gives `(reading 'state')`.

- [ ] **Step 4: Implement in navigation.ts**

- Every `websocket` event pushes `ws.url()` to `socketUrls`. Matching sockets (`includes(WEBSOCKET_URL_PATTERN)`) increment `matchedSockets` and get their own `FrameAssembler`. They also get a `framesent` listener that adds `subscribedGroupIds(text)` to a `subscribed` set. Text is `Buffer.isBuffer(p) ? p.toString("utf8") : String(p)`.
- The `framereceived` handler: `framesReceived++`, then `assembler.push(frame.payload)`. A `null` result (a chunk continuation) increments `chunkedFrames` and ends the handler. Otherwise set `maxFrameBytes = Math.max(maxFrameBytes, Buffer.byteLength(text, "utf8"))`, then `decodeFrame`:
  - `setup` calls `assembler.setChunkSize`.
  - `invalid` increments `invalidFrames` and sets `lastInvalidError`.
  - `control` sets `lastControl = { type, message }`.
  - `data`: for each `initialStatesOf(frame)`, do `initialStates++` and `maxEvents = Math.max(maxEvents, events.length)`. Delta messages are ignored and do not refresh `lastUpdateTime`.
    - League mode resolves on the first state with `events.length >= 1 && selections.length > 0`. The rule was `> 1`; see Risks.
    - Single-event mode calls `accumulator.add` on a `new SingleEventAccumulator(expectedEventId)` and refreshes `lastUpdateTime` only when it returns `true`.
- League poll (navigation.ts:399-428): additionally resolve with `state: null` once `elapsed >= WS_MIN_WAIT && isEmptyListing(diagnostics)`.
- Both modes call `page.off("websocket", wsHandler)` on resolve. Today league mode never detaches (navigation.ts:399-428).
- Single-event mode sets `diagnostics.groups` from `accumulator.stats()`.
- **Do not collapse a subscribed group.** `expandAllMarketGroups` reads `await header.innerText({ timeout: 300 })` and skips the click when `skipHeader(text)` is true. If reading the text fails, it clicks as today. `skipHeader = (t) => { const id = accumulator.groupIdForHeader(t); return id !== null && (subscribed.has(id) || accumulator.stats().marketGroupsSeen.includes(id)); }`. On the captured page this skips "Popularne" (subscribed at load as stream 5), so no `CLOSE` for stream 5 is sent. The log becomes `[PZBuk/WS] Expansion trigger: expanded <n> headers (skipped <k> already subscribed), clicked <m> "Pokaż więcej"`.
- Timing constants (`WS_MAX_WAIT`, `WS_MIN_WAIT`, `MIN_CAPTURE_MS`, `STREAM_SILENCE_MS`) and `clickAllShowMore` are unchanged.

- [ ] **Step 5: Implement in index.ts**

- Remove the four redundant `Promise.race([..., delay(WS_CAPTURE_TIMEOUT)])` wrappers (index.ts:103-106, 235-238, 333-336, 380-383). `captureWebSocketData` always resolves by `WS_MAX_WAIT` in both modes. Two tests prove it: "names the unmatched socket…" (league mode) and "single-event mode resolves at WS_MAX_WAIT with no frames". Drop the unused `WS_CAPTURE_TIMEOUT` import (:22).
- Use `.state` everywhere. Append `describeCaptureFailure(diagnostics)` to the three error strings listed under Interfaces, and `console.warn` each one with the `[PZBuk]` / `[PZBuk/FullOffer]` prefix.
- scrapeFullOffer listing: when `state === null && isEmptyListing(diagnostics)`, `console.log` `[PZBuk/FullOffer] listing is empty: <describeCaptureFailure>` and return `success: true, matches: []`.
- Per event: call `captureWebSocketData(page, true, event.id)`. On success, log `[PZBuk/FullOffer] <home> vs <away>: <n> markets (groups <seen>/<declared>) (frames: invalid <invalidFrames>, chunked <chunkedFrames>, max <maxFrameBytes> B)`. When seen < declared, also `console.warn` `[PZBuk/FullOffer] <home> vs <away>: market groups never answered: <declared − seen ids>`; this covers a missing group 1 "Popularne". On an empty event capture, `console.warn` the description (today index.ts:385 skips silently).
- At the end of scrapeFullOffer, when `matches.length === 0` after a non-empty listing, return `success: false` with the "No markets captured…" error instead of `success: true` (index.ts:426-432).
- `lastTransportStats` (public field, initially all 0): scrapeFullOffer resets it to zeros at the start. After the listing capture and after every event capture it adds `invalidFrames` and `chunkedFrames` and takes the max of `maxFrameBytes`. This happens whatever the capture outcome, so a failed run still reports its counters to Task 7.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/scrapers/bookmakers/pzbuk`
Expected: PASS (9 capture tests, 22 ws-protocol tests, and `parser.test.ts`, including the Task 3 and Task 4 additions).

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/scrapers/bookmakers/pzbuk/navigation.ts src/scrapers/bookmakers/pzbuk/index.ts src/scrapers/bookmakers/pzbuk/__tests__/capture.test.ts
git commit -m "fix(pzbuk): capture via sportsbook-api/ws and report the concrete capture failure"
```

### Task 6: Real-names golden fixture (premier-league Everton–Coventry City)

**Files:**
- Create (harvest): `src/services/normalization/__fixtures__/pzbuk/premier-league_everton_coventry_city.json`, `.expected.json`
- Test: `src/services/normalization/bookmakers/__tests__/pzbuk-real-names.test.ts` (new `describe`)

**Interfaces:**
- Consumes: the Task 4 normalizer; archive `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/pzbuk/premier-league_everton_coventry_city__2026-11-06.json` (167 raw markets with `paramValue`, ctx Everton / Coventry City / premier-league).
- Produces: fixture `matchIdSafe = "premier-league_everton_coventry_city"`, `sourceArchive = "premier-league_everton_coventry_city__2026-11-06.json"`.

- [ ] **Step 1: Write the failing invariant tests**

```ts
import { readFileSync } from "node:fs";
const fx = JSON.parse(readFileSync(new URL("../../__fixtures__/pzbuk/premier-league_everton_coventry_city.json", import.meta.url), "utf8"));
const outs = () => fx.entries.map(({ raw }: any) => ({ raw, out: pzbukNormalizer.normalizeMarket({
  bookmakerMarketId: raw.bookmakerMarketId ? String(raw.bookmakerMarketId) : undefined, name: raw.name,
  groupName: raw.groupName || undefined, paramValue: raw.paramValue || undefined, selections: raw.selections }, fx.ctx) }));
describe("pzbuk real-names fixture invariants", () => {
  it("has 167 entries from the 2026-11-06 capture", () => expect(fx.entries).toHaveLength(167));
  it("has no non-OTHER marketKey collision with overlapping selection codes", () => {
    const seen = new Map<string, Set<string>>(); const collisions: string[] = [];
    for (const { raw, out } of outs()) {
      if (!out || out.marketCode === "OTHER") continue;
      const codes = seen.get(out.marketKey) ?? new Set<string>();
      for (const s of out.selections) { if (codes.has(String(s.code))) collisions.push(`${out.marketKey}:${s.code} <- ${raw.name}`); codes.add(String(s.code)); }
      seen.set(out.marketKey, codes);
    }
    expect(collisions).toEqual([]);
  });
  it("takes MATCH_WINNER only from id 1", () => {
    const mw = outs().filter(({ out }: any) => out?.marketCode === "MATCH_WINNER");
    expect(mw.map(({ raw, out }: any) => [raw.bookmakerMarketId, out.selections.map((s: any) => s.odds)])).toEqual([["1", [1.66, 3.92, 4.91]]]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/pzbuk-real-names.test.ts -t "fixture invariants"`
Expected: FAIL with `ENOENT … premier-league_everton_coventry_city.json`.

- [ ] **Step 3: Harvest the fixture**

```bash
ARCH=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/pzbuk/premier-league_everton_coventry_city__2026-11-06.json
REG=/home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json
npx tsx scripts/harvest-fixtures.ts --archive "$ARCH" --bookmaker pzbuk --out-dir src/services/normalization/__fixtures__ --registry "$REG"
```

Expected stdout JSON (keys in this order, paths omitted): `"entries": 167, "blessed": 54, "unblessed": 113, "refreshed": 167, "openLedgerRefs": 50`. The summary ends with `openLedgerRefs`. 50 is the open pzbuk ref count in the frontend registry on 2026-11-06; if it differs, re-check the blessed count before going on. The explicit `--out-dir` and `--registry` are required; the defaults point at the old monorepo. Inspect the per-entry table: `python3 -I -c "import json;[print(x['index'],x['rawName'],x['marketCode'],x['blessed']) for x in json.load(open('src/services/normalization/__fixtures__/pzbuk/premier-league_everton_coventry_city.expected.json'))['entries']]"`.

- [ ] **Step 4: Bless the verified entries by exact raw name (one invocation)**

After Step 3, 22 non-OTHER entries (and 91 OTHER ones) are unblessed. Besides the integrity rows, they include `TOTAL_GOALS` (6 lines), `BTTS`, `RESULT_AND_BTTS`, `RESULT_AND_TOTAL` (3 lines), `DOUBLE_CHANCE_BTTS`, `HALF_TIME_BTTS`, `HOME_EXACT_CARDS` and `MULTI_RESULT`. Bless them, the integrity rows and the permanent parkings explicitly. `--bless` repeats, and each name matches exact trimmed names first (harvest-fixtures.ts:297), so each name hits only its own id. Do **not** use `--bless-all`. It would also freeze the coverage-opportunity OTHER entries (18, 22, 24, 63/64, 72/73, 134, 502/503, …), and FIXER-CONTRACT.md step 1 treats a blessed passing entry as "presumed unnecessary", which would block the follow-up mapping round.

```bash
BLESS=(
  # integrity rows (Observations routing table)
  "Kartki 1x2" "2. Połowa - Podwójna szansa" "2. Połowa - Remis bez zakładu" "1. strzelec gola" "Strzelec ostatniego gola"
  "1. Połowa - Coventry City Dokładna liczba kartek" "1. Połowa - Everton FC Dokładna liczba kartek"
  "2. Połowa - 1x2 & oba zespoły strzelą" "1. Połowa - Suma rzutów rożnych" "1. Połowa - Suma kartek"
  "1. Połowa - Podwójna szansa" "1. Połowa - Remis bez zakładu" "1. Połowa - Dokładny wynik" "1. Połowa - handicap" "2. Połowa - handicap"
  # core markets that a substring-matching open ledger ref would otherwise unbless
  "1x2" "Podwójna szansa" "Remis bez zakładu" "1. Połowa - Suma" "2. Połowa - Suma" "Suma goli" "Oba zespoły zdobędą gola"
  "1x2 & Oba zespoły zdobędą gola" "1x2 & Suma" "Podwójna szansa & oba zespoły strzelą" "1. Połowa - Oba zespoły zdobędą gola"
  "Everton FC Dokładna liczba kartek" "Dokładny multi-wynik"
  # audit-proven permanent parkings (different product or cross-scope), frozen as OTHER
  "Early Payout" "Zawodnik (lub zmiennik) strzeli gola" "Zawodnik (lub zmiennik) strzeli gola lub zaliczy asystę"
  "Zawodnik z kartką (lub zmiennik)" "Podwójna szansa (mecz) & 1. połowa oba zespoły strzelą"
)
ARGS=(); for n in "${BLESS[@]}"; do ARGS+=(--bless "$n"); done
npx tsx scripts/harvest-fixtures.ts --archive "$ARCH" --bookmaker pzbuk --out-dir src/services/normalization/__fixtures__ --registry "$REG" "${ARGS[@]}"
```

Expected: no `No archive market matches raw name` error. Stdout JSON: `"entries": 167, "blessed": 89, "unblessed": 78, "refreshed": 54, "openLedgerRefs": 50`. Selective mode refreshes only the 54 matched entries; the other 113 stay byte-identical. These numbers come from an offline simulation of harvest-fixtures.ts:297-393 on the archive with the Task 4 patch applied to a scratch copy.

Then check the result: `python3 -I -c "import json;e=json.load(open('src/services/normalization/__fixtures__/pzbuk/premier-league_everton_coventry_city.expected.json'))['entries'];print(sum(x['blessed'] for x in e),[x['index'] for x in e if not x['blessed'] and x['marketCode']!='OTHER'])"` prints `89 []`. In the blessed set, every row from the Observations routing table shows its "Correct code", and ids 60/61/80 show `OTHER`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/pzbuk-real-names.test.ts src/services/normalization/__tests__/golden.test.ts -t pzbuk`
Expected: PASS. Golden logs `[golden] pzbuk/premier-league_everton_coventry_city: entries=167 blessed=89 unblessed=78 failures=0` and `[golden] pzbuk/world-cup-2026_france_morocco: entries=155 blessed=36 unblessed=119 failures=0`.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/services/normalization/__fixtures__/pzbuk/premier-league_everton_coventry_city.json src/services/normalization/__fixtures__/pzbuk/premier-league_everton_coventry_city.expected.json src/services/normalization/bookmakers/__tests__/pzbuk-real-names.test.ts
git commit -m "test(pzbuk): add real-names golden fixture for premier-league Everton vs Coventry City"
```

### Task 7: Smoke script and live acceptance

**Files:**
- Create: `scripts/pzbuk-smoke.ts`

**Interfaces:**
- Consumes: `pzbukScraper.scrapeFullOffer(league)`, `pzbukScraper.lastTransportStats` (Task 5), `pzbukScraper.cleanup()` (index.ts), `normalizeMarketsForBookmaker(markets, "pzbuk", home, away, league)` (`src/services/normalization/index.ts:72`, no DB; output field `normalizedType`), and optionally `GET <peers>/api/odds?league=<slug>` (`data.matches[].{homeTeam, awayTeam, markets.MATCH_WINNER.bookmakerOdds[bm].selections[].{normalizedName, odds}}`).
- Produces: CLI `npx tsx scripts/pzbuk-smoke.ts --league <slug> [--peers <baseUrl>]`, plus `--help` (prints usage, exits 0, no browser). It prints one line `SMOKE {"success":…,"matches":…,"minParsedMarkets":…,"minNonOther":…,"maxUnknownShareNonOther":…,"collisions":…,"peerMatched":…,"max1x2Deviation":…|null,"invalidFrames":…,"chunkedFrames":…,"maxFrameBytes":…,"ordinalMarkets":…,"templateMarkets":…,"gatedNonOther":…,"durationMs":…,"pass":…}` plus one line per match, and exits 1 when `pass` is false. The three transport counters are reported only and never affect `pass` (A11). Of the ordinal counters (A12), `gatedNonOther` > 0 fails `pass`; `ordinalMarkets` and `templateMarkets` are reported only. Thresholds are constants matching A1-A6: `MIN_MATCHES = 18` (A1), `MIN_PARSED = 90` (A2, every match; the 7-group estimate is 105), `MIN_NON_OTHER = 40` (A3), `MAX_UNKNOWN_SHARE = 0.02` (A4), collisions `0` (A5), ~~`MAX_1X2_DEVIATION = 0.08`~~ `MAX_1X2_IMPLIED_PROBABILITY_GAP = 0.025` (A6, ruling 11; the peer [min, max] is no pass criterion). Final-review amendment: the SMOKE line is now `{success, matches, minParsedMarkets, minNonOther, maxUnknownShareNonOther, collisions, vocabularyMisses, invalidOdds, droppedMarkets, peers, peerMatched, compared, x12Outliers, max1x2ProbabilityGap, invalidFrames, chunkedFrames, maxFrameBytes, ordinalMarkets, templateMarkets, gatedNonOther, durationMs, pass}`. `vocabularyMisses` (codes outside the closed catalog vocabulary of a non-OTHER, non-player market), `invalidOdds` (selections without a finite price above 1), `x12Outliers` and `peers: "unavailable"` fail `pass`; `droppedMarkets` (the normalizer's `[pzbuk] Dropping …` warnings) and `compared` (matches whose MATCH_WINNER was actually compared) are reported only.

- [ ] **Step 1: Write `scripts/pzbuk-smoke.ts`**

Follow the `scripts/pzbuk-market-discovery.ts` style (`#!/usr/bin/env npx tsx`, usage doc block, `parseArgs`, `main()`).
- Per match: `parsed = m.markets.length`; count `normalizedType !== "OTHER"`, UNKNOWN among their selections, and overlapping-code collisions per `marketKey` (same rule as Task 6).
- With `--peers`: join a pzbuk match to a peer row on exact `(homeTeam, awayTeam)`. Both sides already carry canonical names (`getCanonicalTeamName` in index.ts; the API serves stored canonical names). Take the median of HOME/DRAW/AWAY across `bookmakerOdds` excluding `pzbuk`. A match without a peer row, or without peers, contributes `null`. `max1x2Deviation` is the max over non-null matches, or `null` when none matched. `peerMatched` counts the joined matches. A `null` deviation does not fail `pass`.
- Ordinal counters (A12), summed over all matches on the `normalizeMarketsForBookmaker` output (it keeps each market's `name`): `ordinalMarkets` counts names matching the Task 4 gate regex `/(?:^|\s)(?:[2-9]|\d{2,})\.\s*(?:gol|strzelec|kartk)/i` (test the trimmed name), `templateMarkets` counts names matching `/\{SpecialIntValue\d*\}/i`, and `gatedNonOther` counts markets of either set with `normalizedType !== "OTHER"`.
- Copy `pzbukScraper.lastTransportStats` into the SMOKE line right after `scrapeFullOffer` returns. `maxFrameBytes` > 0 shows that the counters are wired, because every run receives at least the SETUP frame.
- Finish with `await pzbukScraper.cleanup()` and `process.exit(pass ? 0 : 1)`.

Check it before going live. `scripts/` is outside the tsconfig `include`, so the repo-wide `tsc` gate never sees it:
```bash
npx tsx scripts/pzbuk-smoke.ts --help
npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck --esModuleInterop --resolveJsonModule scripts/pzbuk-smoke.ts
```
Expected: usage text with exit 0, then tsc exit 0. The single-file tsc shape was proven on `scripts/pzbuk-market-discovery.ts` on 2026-11-06 (exit 0).

- [ ] **Step 2: Run it live**

Run: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 900 npx tsx scripts/pzbuk-smoke.ts --league premier-league --peers http://localhost:3001`
Expected: exit 0. `SMOKE {"success":true,"matches":20,…,"collisions":0,…,"pass":true}`, `minParsedMarkets` ≥ 90, `minNonOther` ≥ 40, `peerMatched` ≥ 18, ~~`max1x2Deviation` ≤ 0.08~~ `x12Outliers` 0 with `compared` ≈ `peerMatched`, `vocabularyMisses` 0, `invalidOdds` 0, `droppedMarkets` 0 (or each one inspected). Log lines `(groups 10/10)` for next-round events and `(groups 7/7)` for later ones (A7), with no "market groups never answered" warning on more than 2 events. `durationMs` ≤ 600000 (A8). A11: `invalidFrames` 0 and `maxFrameBytes` > 0. `chunkedFrames` will most likely be 0, so record chunk reassembly as live-verified only when it is > 0 with `invalidFrames` 0. Otherwise the Risks entry stays "unverified live". If `invalidFrames` > 0, investigate before signing off A7. The per-event `(frames: invalid …)` log lines name the event. A12: `gatedNonOther` 0. A pre-match run will most likely report `ordinalMarkets` 0, so record the Task 4 ordinal gate as live-verified only when `ordinalMarkets` > 0 with `gatedNonOther` 0 (an in-play event after a goal or booking). Otherwise the Risks entry "Ordinal templates on live events" stays "unverified live", just like chunk reassembly. `templateMarkets` > 0 means a live payload with a blank `market.name` was seen; report it, because it bears on open question 9.

- [ ] **Step 3: Run the legacy-path check**

Run: `bash scripts/test-scrapers.sh test pzbuk premier-league`
Expected: `✓ Listing: 20 matches`, `✓ Details`, plus 1X2, BTTS, `O/U 2.5` and DC lines (A10).

- [ ] **Step 4: Verify in the running service**

The dev server reloads on `src/` changes. Wait for the next scheduled run, or trigger a pzbuk-only run. Do **not** use `scripts/test-scrapers.sh scrape-pl`: it runs all 14 scrapers and its default key does not match the service (Tooling gotchas).

```bash
curl -s -X POST http://localhost:3001/api/admin/scrape \
  -H "Authorization: Bearer ${ADMIN_API_KEY:-dev-api-key}" -H 'Content-Type: application/json' \
  -d '{"league":"premier-league","bookmakers":["pzbuk"]}'
```

Expected: HTTP 202 with `"status":"started"` and `"bookmakers":["pzbuk"]`. The key defaults to `dev-api-key` (config/index.ts:36) when the service has no `ADMIN_API_KEY`. The scrape runs in the background, so wait until the service log shows `pzbuk completed` (about 6 min). Then:

```bash
sed 's/\x1b\[[0-9;]*m//g' <service log> | grep -E "pzbuk completed|marketKey collision.*pzbuk|\[PZBuk/FullOffer\].*(groups|never answered|listing is empty)"
curl -s "http://localhost:3001/api/odds?league=premier-league" | python3 -I -c "import json,sys;m=json.load(sys.stdin)['data']['matches'];print(sum('pzbuk' in x['markets'].get('MATCH_WINNER',{}).get('bookmakerOdds',{}) for x in m),'/',len(m))"
```

Expected: `pzbuk completed: 20 matches, <N> markets saved` with N > 0, no `marketKey collision … pzbuk` lines (A9), and `≥18 / 20` printed.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npx vitest run
git add scripts/pzbuk-smoke.ts
git commit -m "chore(pzbuk): add live smoke script with acceptance thresholds"
```

---

## Self-review

1. **Spec coverage.** URL pattern: Task 1. Envelope decoder (pure, durable fixture) and delta/control handling: Task 1. Chunk reassembly: Task 1. Numeric/string ids: Task 3, with `getSelectionName` deliberately excluded and pinned in Task 2. Normalizer updates for ids proven by real names and `originalName` templates, including the ordinal gate and 146: Task 4. Real error propagation, empty listing and the no-collapse header rule: Task 5; the run-level log is out of scope (observability plan). Golden refresh (failing first, rebless with an inspected diff, new fixture blessed by exact name): Tasks 4 and 6. Live smoke: Task 7 plus the proven one-liner. Acceptance A1-A10 map to Task 7 steps 2-4. Failure-message quality (Review Focus 4) is in the Task 2 and Task 5 tests. The rule for which groups count as answered was checked against the fixture: the union over-reports, the intersection does not. (Superseded by ruling 6: a group counts as answered only when its own subscription stream answered, because the intersection can still mark a silent group 1 as seen.)
2. **Ordering.** Data flow returns only in Task 5, after the normalizer (Task 4). Tasks 1-4 leave pzbuk at 0 matches under a running dev server, because the old loop still fails on the envelope. Task 5 Step 1 checks the precondition.
3. **Step scan.** Every test step carries names and assertions with captured values; synthetic values (deltas, `ERROR`, `2.` ordinals, 99001-99003, the 32768 B chunking) are labelled. The failing-first counts were run on the current code: Task 4 23/35 fail, Task 5 9/9 fail, Task 1 suite fails to load. Code steps give signatures and the one algorithmic rule each (assembler `>=` rule, accumulator merge rule, guard and ordinal regexes, header skip rule). No step says "handle edge cases".
4. **Type consistency.** `CaptureResult.state` / `.diagnostics`, `CaptureDiagnostics.groups {declared, seen}`, `maxEvents`, `lastControl`, `chunkedFrames` / `maxFrameBytes` (Task 2 fields, Task 5 counting and `lastTransportStats`, Task 7 SMOKE) and `AccumulatorStats.marketGroupsDeclared/Seen` are used the same way in Tasks 2, 5 and 7. `decodeFrame` returns `DecodedFrame`, and `initialStatesOf` is the only way tests and code read INITIAL_STATE payloads (Tasks 1, 2, 3 and 5). `PZBukWebSocketMessage` is reused, not duplicated. `WEBSOCKET_URL_PATTERN` changes in Task 1, before `describeCaptureFailure` (Task 2) relies on it.
5. **Review Focus.** Each of the 5 lines names its owning task's test.
6. **Proportion.** Code blocks are tests (where the values live) and commands; implementation bodies are one-line rules.
