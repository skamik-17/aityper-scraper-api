# Totalbet UUID-Platform Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Totalbet odds back, Premier League first. The scraper moves off the dead numeric REST API (`/rest/market/...`, HTTP 404) onto the UUID "dealer" API (`/dealer/bdata/v1/bet/events`). The normalizer is rewritten for the new component-grid layout so that 39 core catalog codes map deterministically.

**Architecture:** A plain Node `fetch` client replaces Playwright. It loads the league list and then one detail per event. A grid parser emits one `ScrapedMarket` per `market_uuid`, with a namespaced id (`mid:<UOF market_id>` for column layouts, `slug:<component slug>` for line layouts) and with the line taken from the row label as `paramValue`. The normalizer looks up phase-1 codes by that id and leaves everything else as `OTHER`. `src/config/leagues.ts` becomes the single source of the league→category-UUID mapping.

**Tech Stack:** TypeScript (NodeNext, strict), Node 20 global `fetch`, Vitest 4, tsx.

**Spec:** see the "Observations (pre-fix analysis)" section of this file. Evidence: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/` (index in §11).

---

## Observations (pre-fix analysis)

All checks below were re-run on 2026-11-06 between 17:05 and 17:45 local time (UTC+1). "Log" means the running service's log after ANSI codes are stripped (`backend.clean.totalbet.log`, scratch copy). The live traffic used for this analysis was 4 curl list calls, 4 detail calls, 3 Node-fetch probes and 3 Playwright page loads of `totalbet.pl` (one each from the current-code smoke commands). A review revision (18:10–18:30 local) added the following:
- one more page load, from the no-`process.exit` smoke
- local `GET /api/odds` and `normalized-markets` calls, made at 17:12–17:14Z
- offline re-analysis of the captures
- run `de6129e8`, which was added to §1

### 1. Status today

| Run | Start (UTC) | totalbet result | Log lines |
|---|---|---|---|
| `7067e5f0` (DB down at start) | 15:45 | `success=false, 0 matches` | 77, 81, 103, 113, 134 |
| `440d2fc6` (DB up) | 16:00:00 | `success=false, 0 matches` | 36382, 36396, 36408, 36437, 36439 |
| `de6129e8` (scheduled) | 17:00:00 | `success=false, 0 matches` | 67254, 67270, 67282, 67317, 67322 |

- `GET /api/odds?league=premier-league` shows 20 matches. Totalbet appears in **0 of 20** `MATCH_WINNER.bookmakerOdds`, so no August leftovers are being served.
- `meta.bookmakerStatus.totalbet = "stale"` proves nothing. `getBookmakerStatus` (`src/repositories/odds-repository.ts:131-164`) reads odds rows with no paging, so PostgREST `max_rows = 1000` truncates it, and `odds-service.ts:183` then applies a 60-minute threshold. At 17:13:54Z betclic (scraped 17:00:55Z) and etoto (17:00:35Z) were `stale`; only sts (17:03:06Z) was `available`. `observability.md` §(f) (lines 82-83) documents the bug. This plan therefore checks freshness through `scrapedAt` instead (A6).
- `GET /api/matches/Leeds%20United/Tottenham%20Hotspur/normalized-markets?league=premier-league` lists 10 bookmakers in `stats.bookmakersWithOdds`, and totalbet is not one of them.
- The last time Totalbet is known to have worked was January 2026: commit `8645734` (2026-01-05) reports 18 Ligue 1 matches, and `src/data/bookmaker-markets/totalbet-full-markets.json` has `extracted_at 2026-01-08` with 775 markets. Commit `570ab66` (2026-06-17) already noted that the numeric API was "now 404" (`src/config/leagues.ts:148-150`).

### 2. Symptom in logs

```
[Totalbet/Navigation] Navigating to base site: https://totalbet.pl
[Totalbet/Navigation] Fetching events for category: 7124
[Totalbet/Navigation] API error: HTTP 404
[Aggregator/FullOffer] totalbet completed: success=false, 0 matches
```
The real cause (`HTTP 404`) appears only on the console. `result.error` carries the generic `"No events found from API"`.

### 3. Root cause (re-verified)

Totalbet moved to a Next.js platform (the "unicorn" frontend) that identifies leagues and events by UUID. The whole numeric API is gone:

```
$ curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}B\n" https://totalbet.pl/rest/market/categories/multi/7124/events
404 text/html; charset=utf-8 60649B          # same for /rest/market/events/1 and /zaklady-sportowe/Pilka-nozna/7124/1
$ curl -s -w "%{http_code}\n" "https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=8793bb6a-4684-44ba-b92e-4d896e6cbfbf&category_type=sport&type=standard"
200   # {"data":{"events":[20 prematch]},"state":"success","_meta":{"pagination":{"total_pages":1,...}}}
```

Where the failure sits in the code:
- `src/scrapers/bookmakers/totalbet/constants.ts:16` sets `API_BASE_URL = "https://totalbet.pl/rest/market"`, and `:23-29` define the numeric `CATEGORY_IDS`.
- `src/scrapers/bookmakers/totalbet/navigation.ts:70` builds `${apiBaseUrl}/categories/multi/${catId}/events`. Line `:73` returns `{ data: [], error: "HTTP 404" }`.
- `src/scrapers/bookmakers/totalbet/index.ts:252-262` turns that into `error: "No events found from API"` and drops the cause.
- `constants.ts:38-42` (`CATEGORY_UUIDS`) is dead code: nothing reads it.
- The current code was proven to fail with the smoke command in "Acceptance criteria": `SMOKE {"success":false,"error":"No events found from API","matches":0,"markets":0}`.

### 4. What still works and must not break

- Nine bookmakers saved data in run 2. This plan touches only the totalbet files plus the `totalbet:` entries in `src/config/leagues.ts`.
- Test baseline on `master` @ `377b47e`: `npx vitest run` gives **65 files / 1182 tests passed**, and `npx tsc --noEmit` exits 0. Golden fixtures exist for 12 bookmakers, none of them totalbet.
- The audit tooling must keep working:
  - `scripts/totalbet-market-discovery.ts` and `scripts/totalbet-prep-audit.ts` go through `scrapeFullOffer` and find the match by exact `eventUrl` (`src/services/audit/scraper-audit-core.ts:105,125`).
  - Keep the `scrapeFullOffer(league)` contract, and keep `eventUrl === buildEventUrl(uuid)`.
- Keep the export names `totalbetScraper` and `TotalbetPlaywrightScraper`. They are used by:
  - `src/scrapers/bookmakers/index.ts:15`
  - `src/scrapers/aggregator.ts:22,40`
  - `src/services/audit/bookmaker-registry.ts:15,48`
  - `src/scripts/analyze-bookmaker-markets.ts:27,48`
  - `scripts/test-scrapers.sh` (by class name)
- PL team names: all 20 Totalbet participant names canonicalize correctly with `getCanonicalTeamName`. Examples: `"Crystal Palace "`→`Crystal Palace`, `FC Sunderland`→`Sunderland`, `Hull`→`Hull City`, `Ipswich`→`Ipswich Town`, `Leeds`→`Leeds United`. All 20 list events line up with the 20 `/api/odds` matches (`evidence/totalbet/list-1x2-vs-peers.txt`).

### 5. New platform: endpoints, ids, data shape

| Purpose | Request | Notes |
|---|---|---|
| League list | `GET https://totalbet.pl/dealer/bdata/v1/bet/events?page={p}&per_page=100&category_uuid={uuid}&category_type=sport&type=standard` | `per_page=100` is accepted. `type=standard` excludes outrights. Pagination is in `_meta.pagination {total_pages,current_page,items_count,per_page}`: with `per_page=5`, page 2 returned `total_pages:4`. An **unknown UUID returns 200 with an empty list** (`event_types: []`). |
| Event detail | `GET https://totalbet.pl/dealer/bdata/v1/bet/events/{eventUuid}` | About 150 KB gzip / 1.1 MB JSON, 0.1–1.8 s. An unknown UUID returns `404 {"data":null,"state":"error","_meta":{"code":404,"message":"Resource not found","reason":"not_found"}}`. |
| Event page (eventUrl) | `https://totalbet.pl/event-details/{eventUuid}` | Taken from the site's own anchors, returns 200. Variants such as `?groupUUID=betbuilder` exist. |
| Not needed | `/events/{uuid}/game-groups`, `/betbuilders/event/{uuid}`, `wss://totalbet.pl/gateway/socket/websocket` (live only) | |

Plain Node `fetch` works: default User-Agent, no cookies, gzip handled. The list returned in 298 ms and the detail in 106 ms (`node-fetch-probe`). **Playwright is not needed.**

League category UUIDs (`evidence/totalbet/league-uuids.json`). For every event, `tournament_uuid` equals the requested UUID.

| slug | UUID | Path | prematch today |
|---|---|---|---|
| ekstraklasa | `ae7d4621-313d-4df6-b3be-046b76a32938` | Piłka nożna > Polska > Ekstraklasa | 9 |
| premier-league | `8793bb6a-4684-44ba-b92e-4d896e6cbfbf` | Piłka nożna > Anglia > Premier League | 20 |
| laliga | `cfb6428c-c437-4923-a370-562871d06316` | Piłka nożna > Hiszpania > LaLiga | 20 |
| serie-a | `0253b9f3-ab3b-4d19-ab4e-87aa8c3adb8e` | Piłka nożna > Włochy > Serie A | 20 |
| ligue-1 | `f64248fd-8f4a-499f-8092-3408cecf2565` | Piłka nożna > Francja > Ligue 1 | 18 |
| world-cup-2026 | `298d1945-aed7-4b43-ba39-3dbc23a59cd0` | (tournament finished) | 0 (1 outright) |

List event (key fields only):
- `{uuid, name:"Crystal Palace  - Liverpool", type:"prematch", status:"active", start_at:"2026-11-08T14:00:00Z", tournament_uuid, market_count:385, participants:[{name:"Crystal Palace ",uuid},{name:"Liverpool",uuid}], markets:[{id:"1", name:"Wynik meczu", outcomes:[{id:"1",name,sort:1,odds:"5.40",status}, …]}]}`
- Odds are **strings**. The list carries only the 1X2 market.

Detail event: `data.event` has the same metadata plus `component_lists[]` of `{name, type, slug, grid: Cell[][]}`. `Cell` is one of:
- `{type:"label", text, market_id?}`
- `{type:"empty"}`
- `{type:"outcome", name, odds, uuid, market_uuid, market_status, outcome_status}`

In all four captured events, `market_count` equals the number of distinct `market_uuid`s in the grid (488/439/385/160), so the whole offer can be reached from `component_lists`.

| Component `type` | Leeds–Tottenham count | Grid shape (header / body rows), verified on 4 events with 0 violations | Raw-market rule |
|---|---|---|---|
| `single_market` | 259 | no header; `[L, O]` rows | one market per component; no stable id (slug = `single_market_<uuid>`) |
| `markets_in_columns` | 36 | `[E, L(market_id)…]` / `[L, O…]` | one market per column; header label carries the **UOF `market_id`** (10, 63, 85, 29, …) |
| `total` | 19 | `['', 'Poniżej', 'Powyżej']` / `[L(line), O(poniżej x), O(powyżej x)]` | one market per row; line = row label |
| `handicap_2col` | 5 | `[L(home), L(away)]` / `[L(homeLine), O(home), L(awayLine), O(away)]` | one market per row; homeLine = −awayLine (checked); the home line also appears in the outcome name `Leeds (-1.5)` |
| `handicap_3col` | 3 | `[E, L(home), L(remis), L(away)]` / `[L("1:0"), O, O, O]` | one market per row; virtual score `h:a` |
| `exact_result` | 3 | alternating label/outcome rows (`LLL`/`OOO`, `ELE`/`EOE`) | one market per component |

Quirks that matter:
- Names have trailing or double spaces: `"Crystal Palace "`, `"Crystal Palace  lub remis"`, `"Handicap "` (3-col European) next to `"Handicap"` (2-col).
- Slugs are human-made CMS strings: `test` (Remis = zwrot), `test_komponent`, mojibake such as `obie_druayny_strzela\x85_gola`. The `market_id`s are clean.
- **3 062 of 11 828 outcomes (26 %) are `outcome_status:"closed"`**, mostly player props. Their odds are placeholders (`"0.00"`, `"1.00"`) or plausible values: `"Bergvall, Lucas"` at **7.80** is closed.
- `market_id` 31/32 head the "Strzeli gola – <team>" columns (outcomes `tak`/`nie`), and id 32 is the **home** column in all 4 events. Do not infer meaning from the id's UOF definition. The odds confirm Totalbet's labels:
  - Home `tak 1.31` equals home `Total powyżej 0.5 1.31`.
  - The half-time and second-half columns are 77/76 and 97/96. Their component slugs are `1_polowa_czyste_konto` / `2_polowa_czyste_konto` ("clean sheet"), but they are labelled "Strzeli gola". On Leeds–Tottenham they are within 1.9–2.4 % of the peer medians, with 8–9 peers per key (HT home YES 2.08 vs 2.12).
  - That match is too balanced to show orientation (HT home YES 2.08, home 0.5 OVER 2.13, away 0.5 OVER 2.04). On the unbalanced Everton–Coventry capture, each YES sits next to its own team's 0.5 OVER: HT home 1.63 vs 1.65 (away 2.60), and 2H away 2.15 vs 2.20 (home 1.49). See `evidence/totalbet/event-detail-everton-coventry.orientation.json`.
- The team matcher fuzzy-matches non-team tokens through Fuse (`team-matcher.ts:677-688`):
  - `getCanonicalTeamName` in `premier-league` gives `"nikt"` → `"Leeds United"`, `"nie"` → `"Sunderland"`, `"gol"` → `"Liverpool"` and `"tak"` → `"Stoke City"`.
  - `normalize1x2Selection("nikt","Leeds United","Tottenham Hotspur","premier-league")` → `"HOME"`.

### 6. Impact

- **Scraper / parser:** both are rewritten from scratch. The legacy shape (`eventId:number`, `eventGames[].gameType`, `outcomeOdds:number`, see `types.ts:11-59`) no longer exists anywhere.
- **Normalizer:** `src/services/normalization/bookmakers/totalbet-normalizer.ts` is unfit for the new shape. When the current file is applied to a prototype flattening of 3 events (`evidence/totalbet/current-normalizer-on-new-shape.txt`):
  - 1 225 of 1 312 markets come out `OTHER` (93.4 %), and 7 469 of 8 065 selections come out `UNKNOWN`.
  - Legacy numeric ids **collide** with the new UOF ids, with a different meaning:

    | legacy `TOTALBET_MARKET_ID_TO_CODE` (`:25-37`) | new meaning of that number | result today |
    |---|---|---|
    | 10 → ODD_EVEN_GOALS | `mid 10` = Podwójna szansa (full match) | **DC stored as odd/even**: an integrity bug |
    | 8 → TOTAL_GOALS | `mid 8` = "Strzeli 1 gola" (first goal) | first-goal odds as a goal line |
    | 1, 2, 3, 4, 5, 6, 7, 9, 98 | 1X2 has no id in the detail; HT result is 60, CS/AH/EH are slug-based, DNB is 11, BTTS is 29 | ids changed |

  - Name table (`:39-47`): only `"wynik meczu"` still matches. The others now carry a column suffix (`"Podwójna szansa - Cały mecz"`) or never matched at all (`normalizeMarketName("Dokładny wynik")` keeps the `ł`).
  - Patterns (`:49-55`): `/liczba goli|suma goli/` sends 26 non-total markets per match (18 distinct names in Leeds–Tottenham: "Dokładna liczba goli", "Suma goli (przedziały)", "Podwójna szansa + suma goli", …) to `TOTAL_GOALS`. This is dangerous, so the patterns are deleted.
  - `extractParamValue` (`:129-160`) ignores `raw.paramValue`.
- **Catalog:** no change. All 39 phase-1 codes already exist in `src/data/market-catalog.ts` (for example `HALF_TIME_DRAW_NO_BET` 202, `SECOND_HALF_DOUBLE_CHANCE` 425, `SECOND_HALF_AWAY_TO_SCORE` 191, `FIRST_HALF_EUROPEAN_HANDICAP` 209). As a consequence, **`scripts/sync-market-types.ts` must not run.**
- **Production path:** `src/services/normalization/factory.ts:255-259` builds the raw market **without `groupName`**, and `:275-279` converts fully numeric ids to `Number`. The normalizer therefore must not depend on `groupName`, and Totalbet ids must be non-numeric strings.
- **Golden fixtures / prior audit knowledge:** none exist for totalbet.
  - `__fixtures__/` holds 12 bookmaker dirs and no totalbet.
  - `aityper/docs/audit-ledger/coverage.json` covers 12 bookmakers and not totalbet. `registry.json` has 0 totalbet refs. `raw-archive/` has no totalbet dir. `docs/totalbet-audit/` was never created.
  - Agents and skills exist (`aityper/.claude/agents/totalbet-market-judge.md`, `totalbet-audit-fixer.md`, `/audit-totalbet`) and contain no legacy-URL assumptions.
  - The only parser test (`totalbet/__tests__/parse-all-markets-id.test.ts`) uses synthetic legacy data.
  - The January snapshot `totalbet-full-markets.json` is 81 % `OTHER` (625/775) and is not referenced by any code.
  - The audit docs: `aityper/docs/match-audit/2026-08-19__premier-league_arsenal_coventry_city.md:601` diagnosed this correctly. `…2026-08-20….md:8` ("poza zakresem projektu dla tej ligi") is wrong.
- **Audit-script quirks:**
  - `scripts/totalbet-prep-audit.ts:71` defaults its output to `../docs/totalbet-audit/.tmp/…`, which resolves **outside** the repo.
  - `scripts/harvest-fixtures.ts:192-225` defaults to the old `backend/` layout.
  - Pass explicit paths to both.
  - `buildPrepAuditOutput` writes `markets[].raw` **without `paramValue`** (`src/services/audit/scraper-audit-core.ts:370-376`; the harvest comment at `scripts/harvest-fixtures.ts:63` says "Not archived today (prep drops it)"). Harvest (`:138`) and `golden.test.ts:91` re-normalize from that archived raw. Every Totalbet line lives only in `paramValue`, so 57 of the 81 phase-1 markets would be harvested as `expected: null`. Task 5 copies the lines into its archive. A `/audit-totalbet` prep archive has the same gap (open question 7).
  - On the current code, `totalbet-market-discovery.ts` prints `[discovery] No match found` and then hangs, because BrowserPool keeps the process alive (it had to be killed with `timeout`).

### 7. Phase-1 mapping (decision) and measured coverage

Parser output key (`bookmakerMarketId`) → catalog code. Sample odds are from Leeds–Tottenham (`evidence/totalbet/event-detail-leeds-tottenham.trimmed.json`).

| `bookmakerMarketId` | Totalbet component | Code(s) | `paramValue` → param | Selection rule | Sample |
|---|---|---|---|---|---|
| — (name `Wynik meczu`) | single_market | MATCH_WINNER | – | side | 2.80 / 3.35 / 2.47 |
| `mid:10` `mid:63` `mid:85` | Podwójna szansa | DOUBLE_CHANCE, HALF_TIME_DOUBLE_CHANCE, SECOND_HALF_DOUBLE_CHANCE | – | `A lub B` | 1X 1.50, 12 1.33, X2 1.42 |
| `mid:29` `mid:75` `mid:95` | Obie drużyny strzelą gola | BTTS, HALF_TIME_BTTS, SECOND_HALF_BTTS | – | tak/nie | 1.71 / 2.03 |
| `mid:11` `mid:64` `mid:86` | Remis = zwrot | DRAW_NO_BET, HALF_TIME_DRAW_NO_BET, SECOND_HALF_DRAW_NO_BET | – | side | 1.95 / 1.77 |
| `mid:60` `mid:83` | Wynik połowy | HALF_TIME_RESULT, SECOND_HALF_RESULT | – | side | 3.37 / 2.16 / 3.10 |
| `mid:26` `mid:74` `mid:94` | Parzyste/Nieparzyste | ODD_EVEN_GOALS, HALF_TIME_…, SECOND_HALF_ODD_EVEN_GOALS | – | (nie)parzysta | odd 1.92 / even 1.79 |
| `mid:32` `mid:31` | Strzeli gola (home / away column) | HOME_TEAM_TO_SCORE, AWAY_TEAM_TO_SCORE | – | tak/nie | home tak 1.31 |
| `mid:77` `mid:76` `mid:97` `mid:96` | 1./2. połowa – Strzeli gola | HALF_TIME_HOME_TO_SCORE, HALF_TIME_AWAY_TO_SCORE, SECOND_HALF_HOME_TO_SCORE, SECOND_HALF_AWAY_TO_SCORE | – | tak/nie | 2.08 / 2.00 |
| `slug:suma` `slug:1_poaowa_suma` `slug:2_poaowa_suma` | Total (suma) | TOTAL_GOALS, HALF_TIME_TOTAL_GOALS, SECOND_HALF_TOTAL_GOALS | row label `2.5` | poniżej/powyżej | 2.5: u 1.82 / o 1.89 |
| `slug:competitor1_total_suma` `slug:competitor2_total_suma` | `<team> - Total (suma)` | HOME_TEAM_TOTAL_GOALS, AWAY_TEAM_TOTAL_GOALS | row label | same | 0.5: u 3.15 / o 1.31 |
| `slug:1_poaowa_competitor_1_suma_goli` `slug:1_poaowa_competitor_2_suma_goli` `slug:2_poaowa_competitor1_suma_goli_` `slug:2_poaowa_competitor2_suma_goli_` | half-time team totals | HALF_TIME_HOME_TEAM_TOTAL_GOALS, HALF_TIME_AWAY_TEAM_TOTAL_GOALS, SECOND_HALF_HOME_TEAM_TOTAL_GOALS, SECOND_HALF_AWAY_TEAM_TOTAL_GOALS | row label | same | |
| `slug:handicap` `slug:1_poaowa_handicap` `slug:2_poaowa_handicap` | Handicap (2-col, half lines only) | ASIAN_HANDICAP, FIRST_HALF_ASIAN_HANDICAP, SECOND_HALF_ASIAN_HANDICAP | home line `-1.5` / `+0.5` | side (strip `(…)`) | −1.5: 5.20 / 1.13 |
| `slug:handicap_hcp` `slug:1_poaowa_handicap_3way` `slug:2_poaowa_handicap_3` | "Handicap " (3-col) | EUROPEAN_HANDICAP, FIRST_HALF_EUROPEAN_HANDICAP, SECOND_HALF_EUROPEAN_HANDICAP | `1:0`→`+1`, `0:2`→`-2` | side incl. remis | +1: 1.50 / 4.30 / 4.95 |
| `slug:dokaadny_wynik` `slug:1_poaowa_dokaadny_wynik` `slug:2_poaowa_dokaadny_wynik` | Dokładny wynik | CORRECT_SCORE, HALF_TIME_CORRECT_SCORE, SECOND_HALF_CORRECT_SCORE | – | `1:0`→`1-0`, `inny`→`OTHER` | 1-0 8.25 |

All 20 phase-1 `market_id`s are present, with no duplicates, in all 4 captured events, and all 18 phase-1 slugs appear in every event. Lines seen: totals 0.5–5.5 (only .5), AH ±0.5..±2.5 (only .5), EH 0:5..4:0. The conventions match the peers' golden outputs: `ASIAN_HANDICAP:-1.5` is the home line, `EUROPEAN_HANDICAP:+1` comes from `1:0` (etoto `extractScorelineHandicap`, `etoto-normalizer.ts:1106`, and `sts-normalizer.ts:1290`), and `CORRECT_SCORE` uses codes like `1-0` with `OTHER` for "inny".

Coverage under this mapping (`evidence/totalbet/phase-coverage.txt`, 4 PL events):

| Event | `market_count` | phase-1 markets | phase-1 selections |
|---|---|---|---|
| Everton – Coventry City | 488 | 81 (17 %) | 225 / 2 705 |
| Leeds – Tottenham | 439 | 81 (18 %) | 225 / 2 759 |
| Crystal Palace – Liverpool | 385 | 82 (21 %) | 227 / 2 601 |
| Manchester City – Fulham (21 Nov) | 160 | 80 (50 %) | 223 / 701 |

What remains `OTHER` across the 3 near events (1 312 markets):

| Bucket | Markets | Share |
|---|---|---|
| goals/result combos and specials | 253 | 19 % |
| corners | 124 | 9 % |
| cards | 90 | 7 % |
| player props | 534 | 41 % |
| match stats | 67 | 5 % |

**Semantic validation:** the final 38-key table was applied to the full Leeds–Tottenham capture and compared with peer medians from the live `normalized-markets` endpoint, fetched 17:12Z (`evidence/totalbet/proposed-mapping-peer-check-leeds-tottenham.txt`, regenerated with the final table).
- All **81** phase-1 market keys have peers. That includes the four HALF_TIME/SECOND_HALF_*_TO_SCORE keys, which have 8–9 peers each and 1.9–2.4 % deviation. 0 selections come out `UNKNOWN`, and 0 markets return `null`.
- For the 141 selections with odds ≤ 5.0 and at least 3 peer quotes, the maximum deviation is **8.9 %** (`FIRST_HALF_EUROPEAN_HANDICAP:+1` DRAW 3.60 vs 3.95) and p95 is 4.7 %.
- 1X2 for all 20 list events is within **5.6 %** of the peer median, with overround 1.057–1.063.
- For calibration, healthy peers on the same codes reach a maximum of 8.2 % (betclic), 8.9 % (etoto, superbet), 11.1 % (fortuna) and 14.4 % (betfan).

### 8. Scope phases (decision)

- **Phase 0 (optional, Task 0):** stop-gap. Remove the `totalbet:` entries from `leagues.ts`. The scraper then fails fast with no browser and no network.
- **Phase 1 (this plan, Tasks 1–6):**
  - Platform migration plus the 39 codes in §7.
  - Reasons:
    - It covers every comparison-critical family (1X2, DC, BTTS, O/U, AH, EH, DNB, CS).
    - The HT/2H and team variants come from the same four component types, so each extra family costs one table row and one assertion.
    - It is validated against 10 peers, needs no catalog change, and gives a deterministic golden baseline.
    - Effort is M.
- **Phase 2 (separate plan, after the Task 5 baseline and one `/audit-totalbet` run):** goals/result combos and specials, about 84 markets per match:
  - `mid:35/78/543` → RESULT_AND_BTTS family
  - `mid:546/542/545` → DOUBLE_CHANCE_BTTS family
  - `mid:79/544` → half-time result + total
  - `mid:33/34` → WIN_TO_NIL; its shape is per-team yes/no, which needs a selection-shape decision
  - `mid:27/28` → team odd/even
  - `mid:8/62/84` → first team to score (`nikt` → NONE)
  - also: Dokładna liczba goli, Suma goli (przedziały), 1. połowa/wynik końcowy, Rozmiar zwycięstwa, `Wynik + Total (suma) ` lines, Podwójna szansa + suma goli
  - Phase 2 also adds the non-PL aliases (§9 risk 6) before any of those leagues is enabled.
- **Phase 3 (separate plan):** corners, cards and match stats (about 94 markets per match), then player props (about 178 per match: closed placeholders, and one component per player under identical names, so the player must move into `name` or `paramValue`).

### 9. Risks and unknowns

1. **Slug drift.** Slugs are CMS strings and could be renamed. Mitigations:
   - Column layouts use `market_id`.
   - A renamed slug degrades to `OTHER`; it is never mis-mapped.
   - A3 catches a rename only at deploy time. So Task 4 checks every scrape: when an event has `market_count ≥ 150` and any of the 38 phase-1 keys is absent from its raw `component_lists` (slugs and header `market_id`s, read before status filtering), it logs `[Totalbet/FullOffer] phase-1 keys missing for <h> vs <a>: <keys>` and adds that text to `result.error`. All 4 captures (160–488 markets) have all 38 keys.
2. **Id meaning vs. Totalbet labels** (31/32 under "Strzeli gola"). The mapping follows Totalbet's labels, and a test pins HOME_TEAM_TO_SCORE YES == HOME_TEAM_TOTAL_GOALS:0.5 OVER on two fixtures. A second test pins the HT/2H columns 77/76/97/96, whose slugs say "czyste_konto" (clean sheet). It checks that each YES is nearer its own team's 0.5 OVER than the other team's, on the unbalanced Everton–Coventry fixture.
3. **Bot protection could appear.** `FetchJson` is injectable, and non-JSON or non-2xx responses surface as explicit errors. Fallback: a Playwright `page.evaluate(fetch)` implementation of the same `FetchJson`.
4. **Live and in-play events.** The site's own call uses `sort_by=live,desc`. The client keeps only `type === "prematch" && status === "active"`.
5. **Merging of `OTHER` storage rows.**
   - **Line components.** `toNormalizedMarket` (`src/services/normalization/factory.ts:166`) and `normalizeMarketsForBookmaker` (`src/services/normalization/index.ts:103`) overwrite `market.paramValue` with the normalizer's output. If an `OTHER` output had no `paramValue`, `resolveStorageMarketKey` (`src/repositories/full-offer-repository.ts:116-148`) would lose its line suffix, and all lines of one component would collapse into one row. That is the betcris round-7 collision class. Leeds–Tottenham has 12 such non-phase-1 line components with 37 lines: corner and card totals, the corner handicaps and the team corner and card totals. Task 3 therefore makes `OTHER` outputs carry `raw.paramValue`.
   - **Player props.** Single-market player props share a name and have no id, so they still merge into one `OTHER:name:<hash>` row. Nothing is lost; this is fixed in phase 3.
6. **Cross-cutting team issues outside PL** (only PL is in `CONFIG.ENABLED_LEAGUES`, `src/config/index.ts:47-49`):
   - `Wisła Kraków` → `Cracovia Krakow` (fuzzy collision; commit `377b47e` rejects same-club fixtures)
   - unmapped: `Wieczysta Kraków`, `FC Genua` (alias `Genua` exists, `team-matcher.ts:306`), `Le Mans FC`, `Troyes AC`, `Frosinone`, `Deportivo La Coruna`, `Racing Santander`, `Malaga`
   - The canonical lists predate the 2026/27 promotions.
   - The prefix guard in `resolveSide` step 5 (Task 3) has a measured cost on the five league lists. It resolves all 20 PL names through step 4, plus `Real Madryt`, `Atletico Madryt` and `Inter Mediolan` through step 5. It **rejects** `PSG`→`Paris SG` and `Olympique Marsylia`→`Marseille` (an explicit alias, `team-matcher.ts:359`), so those sides come out `UNKNOWN` (safe). It also rejects the `Wisła Kraków`→`Cracovia Krakow` fuzzy collision (correct). Phase 2 must resolve the two Ligue 1 names before `ligue-1` is enabled.
7. **`leagues.ts` is also edited by the betters/lebull/pzbuk recovery plans.** Keep the totalbet hunks on `totalbet:` lines only and rebase carefully.
8. **The observability plan.**
   - `observability.md` Task 2 adds navigation diagnostics inside `executeFullOfferScrape` (`playwright-base.ts:347-366`). Totalbet will no longer go through that path, so its own `result.error` strings (Tasks 1 and 4) are the diagnostics. No conflict in files.
   - **Ordering.** The A4 table in `observability.md` (lines 218-224) is explicitly scoped "while the per-bookmaker fixes are unmerged", and its totalbet row expects `fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events`. Its unit tests at lines 488-511 use their own fixtures and are not affected.
     - If this plan lands first, the PR for `fix/totalbet-uuid-platform` also edits that row to say totalbet is expected `available` with `consecutiveFailures: 0`.
     - If observability lands first, nothing changes.
   - `meta.bookmakerStatus` becomes a valid acceptance signal only after observability Tasks 5 and 8 (`getBookmakerStatusSnapshot`). Until then, A6 uses `scrapedAt` freshness.
9. **Unknown:** whether `type=standard` ever returns more than 100 PL events (pagination is implemented and capped at 10 pages anyway), and how stable the detail payload is while a match is in play (filtered out).

### 10. Open questions for the owner

1. Apply the stop-gap (Task 0) now, or go straight to Tasks 1–6? There is also variant B: remove `"totalbet"` from `CONFIG.BOOKMAKERS` (`src/config/index.ts:66`) so it disappears from runs and from `bookmakerStatus`.
2. Is the phase-1 scope right (39 codes including HT/2H and team variants), or should it be strictly the 8 full-match families?
3. Should `world-cup-2026` be wired to `298d1945-…` even though the tournament is over (0 prematch events)? The plan does wire it.
4. `scrapeMatchDetails` is reduced to 1X2 only (no callers outside the class). Is that OK?
5. Should the `aityper` docs be corrected (the 08-20 audit says "poza zakresem") and should the Task 5 archive be copied to `aityper/docs/audit-ledger/raw-archive/totalbet/`? Both are frontend-repo changes and outside this plan.
6. Delete the unreferenced `src/data/bookmaker-markets/totalbet-full-markets.json`? It is a non-goal here.
7. Should `buildPrepAuditOutput` archive `raw.paramValue` for every bookmaker (`src/services/audit/scraper-audit-core.ts:370-376`)? This would be a cross-bookmaker change outside this plan's scope. Without it, a `/audit-totalbet` prep archive cannot be harvested into fixtures, because every line market comes back `expected: null`. Task 5 works around the gap only for its own offline archive. If approved, it is a separate task with its own test, and existing golden fixtures are unaffected because they keep their raw blocks.
8. May the plan and evidence directory be committed to `master` as a docs-only commit before work starts (Global Constraints, Step 0)? Today it is untracked (`git ls-files docs/superpowers` → 0).

### 11. Evidence index (`docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/`)

| File | Content | Used by |
|---|---|---|
| `pl-events-list.json` (78 KB) | verbatim PL list, 20 prematch events | Tasks 1, 2, 4 (copy to `src/scrapers/bookmakers/totalbet/__tests__/fixtures/`) |
| `event-detail-leeds-tottenham.trimmed.json` (143 KB) | Leeds–Tottenham detail cut to 35 components: all phase-1 components plus 8 negative controls; 102 distinct `market_uuid` | Tasks 2, 3, 4 (copy to the same fixtures dir) |
| `event-detail-crystal-palace-liverpool.core.json` (26 KB) | 6 core components with trailing and double spaces; 21 markets | Tasks 2, 3, 4 (copy) |
| `event-detail-everton-coventry.orientation.json` (28 KB) | Everton–Coventry detail cut to the 3 "Strzeli gola" column components (mids 32/31, 77/76, 97/96) and the 6 team-total components; 26 markets | Task 3 (copy) |
| `event-not-found.json` | 404 envelope | Tasks 1, 4 (copy) |
| `event-detail-leeds-tottenham.full.json` (1.17 MB) | verbatim full detail, 439 markets | Task 5 only (read in place by absolute path, not copied to `src/`) |
| `league-uuids.json`, `legacy-endpoints-404.txt` | league UUIDs, pagination probe, unknown-category probe, legacy 404s | Task 4, Observations |
| `list-1x2-vs-peers.txt` | list 1X2 for all 20 PL events vs peer medians (max 5.6 %, overround 1.057–1.063) | Observations §7, A4 calibration |
| `component-inventory-3-events.txt`, `phase-coverage.txt`, `current-normalizer-on-new-shape.txt` | analysis command outputs | Observations |
| `proposed-mapping-peer-check-leeds-tottenham.txt` | final 38-key table on the full capture vs peer medians (81 keys, 141 compared selections, max 8.9 %, p95 4.7 %) plus the team-to-score orientation table | Observations §5, §7 |
| `smoke-noexit-current-code.txt` | the no-`process.exit` smoke on the current code: `exit=124` after 60 s (BrowserPool keeps the process alive) | A7 |
| `peer-deviation.py` | acceptance helper (proven on current API data) | Task 6 |

### Acceptance criteria

Measured live after Task 4 is deployed (the dev server restarts and runs an initial scrape). Today's values are in brackets.

Every count is relative to **`N_list`**, the number of prematch events the dealer list returns at check time. Fixed counts would depend on the calendar. Today the list has 20 events: 10 on 6–8 Nov and 10 on 21–23 Nov, with an international break in between. Any run after 8 Nov sees about 10, and events that go live drop out of the list. `N_list` comes from the acceptance smoke's `listed` field, or from the run's `[Totalbet/FullOffer] Found N prematch events for premier-league` line (Task 4).

| # | Check | Pass when |
|---|---|---|
| A1 | acceptance smoke `SMOKE` line | `success:true`, no `error` key, `listed ≥ 1`, `matches ≥ ceil(0.9·listed)` [listed 20] |
| A2 | `[Totalbet/FullOffer] <h> vs <a>: N markets (market_count M)` log lines | `N ≥ 0.95·M` for every match, and no `Detail fetch failed` or `phase-1 keys missing` line [N = M on 4 captures] |
| A3 | `MATCH` lines of the normalizing smoke | `mapped ≥ 70` and `unknown = 0` for every match [80–82, 0] |
| A4 | 1X2 vs peer median (`/api/odds`), `1X2-CHECK` line | `matchesWith ≥ ceil(0.9·min(future, N_list))`, where `future` = `/api/odds` matches with `startTime` after now, and `maxDevPct ≤ 10`; exit 0 [etoto today: 20/20 future, 3.7] |
| A5 | phase-1 selections with odds ≤ 5.0 and ≥ 3 peers (`peer-deviation.py --threshold 15`) for 3 matches | `over=0`, exit 0 [max 8.9] |
| A6 | the deploy-triggered (or next scheduled) run in the service log, plus `/api/odds` freshness | `totalbet completed: M matches, S markets saved` with `M ≥ ceil(0.9·N_list)` (N_list from the same run's `Found` line) and `S > 0`; no `[Totalbet/Navigation]` lines; the `FRESHNESS` line has `ok=True` (newest totalbet `MATCH_WINNER.scrapedAt` is between T0 and T0 + 10 min, where T0 is the UTC time recorded right before the deploy). `meta.bookmakerStatus` is **not** used (§1, risk 8) |
| A7 | no Playwright | the acceptance smoke has no `process.exit` and ends with `exit=0`, not `exit=124` [current code: `exit=124` after 60 s, `evidence/totalbet/smoke-noexit-current-code.txt`]; its output has no `[BrowserPool]` line; the discovery script (Task 6 Step 2) also exits 0 by itself |
| A8 | duration | `durationMs < 60000` in the acceptance smoke |

**Single-bookmaker live smoke tests.** Run from the checkout root (the main checkout, or the worktree in Task 6 Step 1). None of them touches the DB.

Quick check, any code version. Its shape was proven on the current code on 2026-11-06. It ends with `process.exit(0)`, so it cannot measure A7:

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 180 npx tsx -e 'import { totalbetScraper } from "./src/scrapers/bookmakers/totalbet/index.ts"; (async () => { const r = await totalbetScraper.scrapeFullOffer("premier-league"); console.log("SMOKE " + JSON.stringify({ success: r.success, error: r.error, matches: r.matches.length, markets: r.matches.reduce((s, m) => s + m.markets.length, 0) })); process.exit(0); })();'
# today: SMOKE {"success":false,"error":"No events found from API","matches":0,"markets":0}   (exit 0)
```

Acceptance smoke for A1, A2, A7 and A8. It runs only after Task 4, because it imports Task 1's `api-client.ts`. It has no `process.exit`. It makes one extra list call to obtain `listed`:

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 120 npx tsx -e 'import { totalbetScraper } from "./src/scrapers/bookmakers/totalbet/index.ts"; import { fetchLeagueEvents } from "./src/scrapers/bookmakers/totalbet/api-client.ts"; import { getBookmakerLeagueId } from "./src/config/leagues.ts"; (async () => { const listed = (await fetchLeagueEvents(String(getBookmakerLeagueId("premier-league", "totalbet")))).events.length; const t0 = Date.now(); const r = await totalbetScraper.scrapeFullOffer("premier-league"); console.log("SMOKE " + JSON.stringify({ success: r.success, error: r.error, listed, matches: r.matches.length, markets: r.matches.reduce((s, m) => s + m.markets.length, 0), durationMs: Date.now() - t0 })); })();'; echo "exit=$?"
# expected: SMOKE {"success":true,"listed":N,"matches":>=ceil(0.9*N),"markets":...,"durationMs":<60000} then exit=0
# the same shape without process.exit on the current code: exit=124 after 60 s (evidence/totalbet/smoke-noexit-current-code.txt)
```

Normalizing variant, used for A3 and printing one line per match:

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 180 npx tsx -e 'import { totalbetScraper } from "./src/scrapers/bookmakers/totalbet/index.ts"; import { totalbetNormalizer } from "./src/services/normalization/bookmakers/totalbet-normalizer.ts"; (async () => { const r = await totalbetScraper.scrapeFullOffer("premier-league"); for (const m of r.matches) { const ctx = { homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: "premier-league", leagueName: "premier-league" }; const out = m.markets.map((k) => totalbetNormalizer.normalizeMarket({ bookmakerMarketId: k.bookmakerMarketId, name: k.name, paramValue: k.paramValue, selections: k.selections }, ctx)).filter((o) => o && o.marketCode !== "OTHER"); const unknown = out.reduce((s, o) => s + o!.selections.filter((x) => x.code === "UNKNOWN").length, 0); console.log("MATCH " + JSON.stringify({ h: m.homeTeam, a: m.awayTeam, raw: m.markets.length, mapped: out.length, keys: new Set(out.map((o) => o!.marketKey)).size, unknown })); } console.log("SMOKE " + JSON.stringify({ success: r.success, error: r.error, matches: r.matches.length })); process.exit(0); })();'
# today: SMOKE {"success":false,"error":"No events found from API","matches":0}
```

When the observability plan's `scripts/smoke-bookmaker.ts` lands, `npx tsx scripts/smoke-bookmaker.ts --bookmaker totalbet` is the equivalent dry run.

---

## Global Constraints

- **Step 0: evidence must be reachable from the worktree.**
  - This plan and `evidence/totalbet/` are **untracked**: `git ls-files docs/superpowers` returns 0 on `master` @ `377b47e`. A fresh worktree therefore does not contain them.
  - Preferred, with the owner's approval (open question 8): before `git worktree add`, make a docs-only commit in the main checkout with `git add docs/superpowers/plans/2026-11-06-scraper-recovery && git commit -m "docs: scraper recovery plans and evidence"`. tsx watch does not watch `docs/`, so this does not restart the server.
  - Either way, every command in this plan reads evidence by its **absolute** main-checkout path, `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/`. Commands spell it out in full because shell variables do not persist between agent commands.
  - Without the docs commit, Task 6 writes its acceptance file into that main-checkout directory and does not commit it. Nothing on the branch then touches `docs/`, so the Task 6 merge cannot fail with "untracked working tree files would be overwritten".
- **Work in a separate worktree.** Create branch `fix/totalbet-uuid-platform` from `master` with `git worktree add /home/skamik/Documents/repositories/personal/aityper-scraper-api-totalbet -b fix/totalbet-uuid-platform`, then run `npm ci` there. Do not edit the checkout that the running `npm run dev` (`tsx watch src/index.ts`) watches. **Editing `src/` there restarts the dev server, and every restart runs a full 14-bookmaker initial scrape** (`src/services/scheduler-service.ts:150-161`). Deploy only at Task 6. The optional Task 0 is the one exception and has its own branch.
- Commits happen only when the owner has explicitly asked for commits in the execution session (repo `CLAUDE.md`). Commit messages are concise conventional ones (`feat(totalbet): …`). **No signature or attribution footers** (no `Co-Authored-By`, no "Generated with …"). This user rule overrides any harness reminder.
- Code, comments and this plan are in English.
- Before every commit, run from the worktree root: `npx tsc --noEmit` (exit 0) and `npx vitest run` (all green; baseline 65 files / 1182 tests plus the new ones).
- **Golden-fixture discipline:**
  - Write the failing fixture or test first.
  - Never hand-edit `*.expected.json`.
  - Rebless only with `npx tsx scripts/rebless-golden.ts --bookmaker totalbet --dry`, then inspect the diff, then run it again without `--dry`.
  - A new fixture pair is created only through Task 5.
- Run `npx tsx scripts/sync-market-types.ts` **only when `src/data/market-catalog.ts` changes**. This plan does not change it, so do not run it. No DB-mutating scripts (clear, nuke, migrate).
- Scope: totalbet files plus the `totalbet:` entries in `src/config/leagues.ts`. Other recovery plans also edit `leagues.ts`; keep hunks minimal.
- Totalbet ids are strings: event and category UUIDs, and the namespaced `mid:`/`slug:` keys. Never `Number()` them. Odds arrive as strings: `Number(odds)`, and drop anything ≤ 1.0.
- Live traffic: at most one full-offer smoke at a time. One league means 1 list call plus at most 20 detail calls, 250 ms apart.

## Review Focus

1. **Closed or suspended outcomes with plausible odds** (`"Bergvall, Lucas"` 7.80, closed) and placeholders (`"0.00"`, `"1.00"`) must never reach a market. Pinned in Task 2: `grid-parser drops closed outcomes even when their odds look valid`.
2. **Legacy-id collisions and cross-market contamination.** Numeric `10`/`8`, corner/card totals, the corner handicap, first goal and combos must never yield a phase-1 code. Pinned in Task 3: `totalbet keeps negative controls OTHER` and `totalbet ignores legacy numeric ids`.
3. **The production path differs from the audit path.** The factory drops `groupName` and coerces numeric ids. Pinned in Task 3: `totalbet survives the factory path without groupName`.
4. **Silent empty category or wrong tournament.** An unknown UUID returns 200 with an empty list, and a country-level UUID would return other tournaments. Pinned in Task 1: `reports an empty category explicitly` and `drops outrights, inactive events and other tournaments`.
5. **Whitespace and fuzzy team names.** Cases: `"Crystal Palace  lub remis"`, and `getCanonicalTeamName` itself fuzzy-matching non-team tokens (`nikt`→Leeds United, `nie`→Sunderland, `gol`→Liverpool, `tak`→Stoke City), while Polish aliases (`Atletico Madryt`) must still resolve. Pinned in Task 3: `totalbet resolves sides without the fuzzy fallback` (length guard plus the step-5 prefix guard).
6. **Lines live only in `paramValue`.** They are lost wherever `paramValue` is dropped:
   - in the prep-audit archive (`scraper-audit-core.ts:370-376`)
   - in `OTHER` outputs, through the factory overwrite (risk 5)

   Pinned in Task 5 Step 4 (`rawParam 94 mappedParam 57`) and Task 3 `totalbet keeps the line on OTHER line markets`.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/scrapers/bookmakers/totalbet/api-types.ts` | create (T1) | wire types of the dealer API |
| `src/scrapers/bookmakers/totalbet/api-client.ts` | create (T1) | `FetchJson`, list (pagination, filters), detail, URL helpers, explicit errors |
| `src/scrapers/bookmakers/totalbet/constants.ts` | modify (T1 add; T4 prune legacy, add `PHASE1_MARKET_KEYS`) | URLs, page size, delays, phase-1 keys for the slug-drift check |
| `src/scrapers/bookmakers/totalbet/grid-parser.ts` | create (T2) | `component_lists` → `ScrapedMarket[]`; list 1X2 |
| `src/services/normalization/bookmakers/totalbet-normalizer.ts` | rewrite (T3) | key→code table, side/score/line rules |
| `src/scrapers/bookmakers/totalbet/index.ts` | rewrite (T4) | scraper class with no browser |
| `src/scrapers/bookmakers/totalbet/{navigation,parser,types}.ts`, `__tests__/parse-all-markets-id.test.ts` | delete (T4) | legacy |
| `src/config/leagues.ts:32,54,76,98,120,148-150` | modify (T0 optional, T4) | category UUIDs, the single source |
| `src/scrapers/bookmakers/totalbet/__tests__/{api-client,grid-parser,scraper}.test.ts`, `__tests__/fixtures/*.json` | create | tests and fixtures copied from evidence |
| `src/services/normalization/bookmakers/__tests__/totalbet-normalizer.test.ts` | create (T3) | normalizer tests |
| `src/services/normalization/__fixtures__/totalbet/premier-league_leeds_united_tottenham_hotspur{,.expected}.json` | create (T5) | golden baseline |

Each task leaves the tree compiling. New modules sit next to the legacy ones until Task 4 switches `index.ts` over and deletes the legacy files.

---

### Task 0 (optional stop-gap): disable Totalbet in league config

**Branch:** the stop-gap only helps if it ships at once, so it does **not** go on `fix/totalbet-uuid-platform`, which deploys only at Task 6.
- Do it in its own worktree: `git worktree add /home/skamik/Documents/repositories/personal/aityper-scraper-api-totalbet-stopgap -b chore/totalbet-stopgap master`, then run `npm ci` there.
- Merge it right away (Step 5).
- Then create `fix/totalbet-uuid-platform` from the updated `master`. If the fix branch already exists, rebase it onto `master`. Task 4 re-adds the league lines and deletes `stop-gap.test.ts`.

**Files:**
- Modify: `src/config/leagues.ts:32,54,76,98,120` (delete the five `totalbet: { id: … }` lines; leave the world-cup comment at `:148-150`)
- Test: `src/scrapers/bookmakers/totalbet/__tests__/stop-gap.test.ts` (deleted again in Task 4)

**Interfaces:** Consumes `isLeagueSupported(slug, bookmaker)` (`leagues.ts:179`) and `totalbetScraper` (the current `index.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { isLeagueSupported } from "../../../../config/leagues.js";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import { totalbetScraper } from "../index.js";

describe("totalbet stop-gap", () => {
  it("totalbet stop-gap: no league is supported", () => {
    for (const slug of ["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1", "world-cup-2026"])
      expect(isLeagueSupported(slug, "totalbet")).toBe(false);
  });
  it("totalbet stop-gap: scrapeFullOffer fails fast without a browser", async () => {
    const spy = vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser");
    const r = await totalbetScraper.scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, error: "Unknown league: premier-league", matches: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run:** `npx vitest run src/scrapers/bookmakers/totalbet/__tests__/stop-gap.test.ts`. Expected: FAIL, because `premier-league` is still supported.
- [ ] **Step 3: Delete the five `totalbet:` lines in `leagues.ts`.** `executeFullOfferScrape` (`playwright-base.ts:347-366`) then rejects the league before it acquires a browser.
- [ ] **Step 4: Run the test (PASS), then `npx tsc --noEmit` and `npx vitest run`.**
- [ ] **Step 5: Commit on `chore/totalbet-stopgap`, then deploy at once (owner's go-ahead)**

```bash
git add src/config/leagues.ts src/scrapers/bookmakers/totalbet/__tests__/stop-gap.test.ts
git commit -m "chore(totalbet): disable league config until UUID migration lands"
git -C /home/skamik/Documents/repositories/personal/aityper-scraper-api merge --ff-only chore/totalbet-stopgap
```
  - The merge changes `src/config/leagues.ts` in the watched checkout. tsx watch restarts, and the restart runs a full initial scrape.
  - Expected in the log: `totalbet completed: success=false, 0 matches` within milliseconds, and no `[Totalbet/Navigation]` lines.
  - Variant B (owner's choice): also delete `"totalbet",` at `src/config/index.ts:66` in the same commit.
  - If `master` has moved since the branch was cut, `--ff-only` refuses. In that case, run a plain `merge`.
  - Afterwards, branch or rebase `fix/totalbet-uuid-platform` onto the new `master`.

---

### Task 1: Dealer API types and HTTP client (no Playwright)

**Files:**
- Create: `src/scrapers/bookmakers/totalbet/api-types.ts`, `src/scrapers/bookmakers/totalbet/api-client.ts`
- Modify: `src/scrapers/bookmakers/totalbet/constants.ts` (add exports only)
- Fixtures (run from the worktree root): `mkdir -p src/scrapers/bookmakers/totalbet/__tests__/fixtures && cp /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/pl-events-list.json /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/event-not-found.json src/scrapers/bookmakers/totalbet/__tests__/fixtures/`
- Test: `src/scrapers/bookmakers/totalbet/__tests__/api-client.test.ts`

**Interfaces:**
- Produces (`api-types.ts`):
  ```ts
  export interface TotalbetPagination { total_pages: number; current_page: number; items_count: number; per_page: number }
  export interface TotalbetMeta { code?: number; message?: string; reason?: string; pagination?: TotalbetPagination; event_types?: { type: string; count: number }[] }
  export interface TotalbetEnvelope<T> { data: T | null; state: "success" | "error"; _meta: TotalbetMeta | null }
  export interface TotalbetParticipant { name: string; uuid: string }
  export interface TotalbetListOutcome { id: string; name: string; sort: number; odds: string; status: string }
  export interface TotalbetListMarket { id: string; name: string; status: string; outcomes: TotalbetListOutcome[] }
  export interface TotalbetEventBase { uuid: string; name: string; type: string; status: string; start_at: string; tournament_uuid: string; market_count: number; participants: TotalbetParticipant[] }
  export interface TotalbetListEvent extends TotalbetEventBase { markets: TotalbetListMarket[] }
  export type TotalbetCell =
    | { type: "label"; text: string; market_id?: string }
    | { type: "empty" }
    | { type: "outcome"; name: string; odds: string; uuid: string; market_uuid: string; market_status: string; outcome_status: string };
  export interface TotalbetComponent { name: string; type: string; slug: string; grid: TotalbetCell[][] }
  export interface TotalbetDetailEvent extends TotalbetEventBase { component_lists: TotalbetComponent[] }
  ```
- Produces (`constants.ts` additions): `DEALER_API_BASE_URL = "https://totalbet.pl/dealer/bdata/v1/bet"`, `LIST_PAGE_SIZE = 100`, `MAX_LIST_PAGES = 10`, `DETAIL_DELAY_MS = 250`. Reuse the existing `BASE_URL` (`:11`) and `REQUEST_TIMEOUT` (`:125`).
- Produces (`api-client.ts`):
  ```ts
  export type FetchJson = (url: string) => Promise<{ status: number; contentType: string; body: unknown }>;
  export const nodeFetchJson: FetchJson;                 // global fetch, AbortSignal.timeout(REQUEST_TIMEOUT), Accept: application/json; body = parsed JSON iff content-type contains "json", else text
  export function buildListUrl(categoryUuid: string, page: number): string;
  export function buildEventUrl(eventUuid: string): string;               // `${BASE_URL}/event-details/${uuid}`
  export function extractEventUuidFromUrl(url: string): string | null;   // /\/event-details\/([0-9a-f-]{36})/i
  export interface ListEventsResult { events: TotalbetListEvent[]; error?: string }
  export function fetchLeagueEvents(categoryUuid: string, fetchJson?: FetchJson): Promise<ListEventsResult>;
  export interface EventDetailResult { event: TotalbetDetailEvent | null; error?: string }
  export function fetchEventDetail(eventUuid: string, fetchJson?: FetchJson): Promise<EventDetailResult>;
  ```
- Error strings (exact; Task 4 forwards them into `result.error`):
  - `HTTP ${status}${reason ? ` (${reason})` : ""} from ${url}`, where `reason` is `body._meta.reason` when the body is a JSON object
  - `Non-JSON response (HTTP ${status}, ${contentType}) from ${url}`
  - `Request failed: ${err.message} (${url})`
  - `Malformed list payload from ${url}` and `Malformed detail payload from ${url}`
  - `No prematch events for category ${uuid} (items_count=${n}, event_types=${JSON.stringify(eventTypes ?? [])})`

- [ ] **Step 1: Write the failing tests**

```ts
// helpers
const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const PL = "8793bb6a-4684-44ba-b92e-4d896e6cbfbf";
const LIST_P1 = `https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=${PL}&category_type=sport&type=standard`;
const ok = (body: unknown) => ({ status: 200, contentType: "application/json; charset=utf-8", body });
// fake(routes) returns a FetchJson that records calls; unknown URLs answer 404 with load("event-not-found.json")

it("fetchLeagueEvents returns the 20 prematch PL events from one page", async () => {
  const f = fake({ [LIST_P1]: ok(load("pl-events-list.json")) });
  const r = await fetchLeagueEvents(PL, f);
  expect(r.error).toBeUndefined();
  expect(r.events).toHaveLength(20);
  expect(r.events[1].uuid).toBe("0e45932b-1433-4cf5-b658-5c308b7c2b60");
  expect(f.calls).toEqual([LIST_P1]);
});
it("follows pagination until total_pages", async () => {
  // page 1: events 0..9, pagination {total_pages:2,current_page:1,items_count:20,per_page:100}; page 2 (buildListUrl(PL,2)): events 10..19
  expect((await fetchLeagueEvents(PL, f)).events).toHaveLength(20);
  expect(f.calls).toEqual([LIST_P1, buildListUrl(PL, 2)]);
});
it("stops after MAX_LIST_PAGES and dedupes by uuid", async () => {
  // every page: events 0..9 with total_pages: 50
  const r = await fetchLeagueEvents(PL, f);
  expect(f.calls).toHaveLength(10);
  expect(r.events).toHaveLength(10);
});
it("drops outrights, inactive events and other tournaments", async () => {
  // clone: events[0].type="outright"; events[1].status="suspended"; events[2].tournament_uuid="033125c9-6c26-42b0-b7cf-43940dbeed5c"
  const r = await fetchLeagueEvents(PL, f);
  expect(r.events).toHaveLength(17);
  expect(r.events.map((e) => e.uuid)).not.toContain("4a3c6a34-6adc-42b7-a9d1-0eaac374cf1b");
});
it("reports HTTP errors with status and URL", async () => {
  const f = fake({ [LIST_P1]: { status: 404, contentType: "text/html; charset=utf-8", body: "<html>404</html>" } });
  expect(await fetchLeagueEvents(PL, f)).toEqual({ events: [], error: `HTTP 404 from ${LIST_P1}` });
});
it("reports non-JSON bodies", async () => {
  const f = fake({ [LIST_P1]: { status: 200, contentType: "text/html; charset=utf-8", body: "<html>challenge</html>" } });
  expect((await fetchLeagueEvents(PL, f)).error).toBe(`Non-JSON response (HTTP 200, text/html; charset=utf-8) from ${LIST_P1}`);
});
it("reports network failures", async () => {
  const f: FetchJson = async () => { throw new Error("fetch failed"); };
  expect((await fetchLeagueEvents(PL, f)).error).toBe(`Request failed: fetch failed (${LIST_P1})`);
});
it("reports an empty category explicitly", async () => {
  const U = "00000000-0000-0000-0000-000000000000";
  const body = { data: { events: [] }, state: "success", _meta: { pagination: { total_pages: 1, current_page: 1, items_count: 0, per_page: 100 }, event_types: [] } };
  const r = await fetchLeagueEvents(U, fake({ [buildListUrl(U, 1)]: ok(body) }));
  expect(r.error).toBe("No prematch events for category 00000000-0000-0000-0000-000000000000 (items_count=0, event_types=[])");
});
it("fetchEventDetail maps the 404 envelope to an error", async () => {
  const r = await fetchEventDetail("00000000-0000-0000-0000-000000000000", fake({}));
  expect(r).toEqual({ event: null, error: "HTTP 404 (not_found) from https://totalbet.pl/dealer/bdata/v1/bet/events/00000000-0000-0000-0000-000000000000" });
});
it("buildEventUrl and extractEventUuidFromUrl round-trip and reject legacy URLs", () => {
  const u = "0e45932b-1433-4cf5-b658-5c308b7c2b60";
  expect(buildEventUrl(u)).toBe(`https://totalbet.pl/event-details/${u}`);
  expect(extractEventUuidFromUrl(`https://totalbet.pl/event-details/${u}?groupUUID=betbuilder`)).toBe(u);
  expect(extractEventUuidFromUrl("https://totalbet.pl/sports/event/123456")).toBeNull();
});
it("nodeFetchJson parses JSON by content-type and passes a timeout signal", async () => {
  const spy = vi.fn(async () => new Response('{"ok":1}', { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", spy);
  expect(await nodeFetchJson("https://x.test/")).toEqual({ status: 200, contentType: "application/json", body: { ok: 1 } });
  expect((spy.mock.calls[0] as any)[1].signal).toBeInstanceOf(AbortSignal);
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run:** `npx vitest run src/scrapers/bookmakers/totalbet/__tests__/api-client.test.ts`. Expected: FAIL, because `../api-client.js` cannot be resolved.
- [ ] **Step 3: Implement `api-types.ts`, the constants additions and `api-client.ts`.**
  - `fetchLeagueEvents` loops `page = 1 … min(total_pages, MAX_LIST_PAGES)`.
  - It keeps events with `type === "prematch" && status === "active" && tournament_uuid === categoryUuid && participants.length === 2`.
  - It dedupes by `uuid` in first-seen order.
  - It returns the empty-category error when nothing survives the filter.
  - `fetchJson` defaults to `nodeFetchJson`.
- [ ] **Step 4: Run the test (PASS), then `npx tsc --noEmit` and `npx vitest run`.**
- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/totalbet/api-types.ts src/scrapers/bookmakers/totalbet/api-client.ts src/scrapers/bookmakers/totalbet/constants.ts src/scrapers/bookmakers/totalbet/__tests__/api-client.test.ts src/scrapers/bookmakers/totalbet/__tests__/fixtures
git commit -m "feat(totalbet): dealer API client for the UUID platform"
```

---

### Task 2: Component-grid parser

**Files:**
- Create: `src/scrapers/bookmakers/totalbet/grid-parser.ts`
- Fixtures (run from the worktree root): `cp /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/event-detail-leeds-tottenham.trimmed.json /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/event-detail-crystal-palace-liverpool.core.json src/scrapers/bookmakers/totalbet/__tests__/fixtures/`
- Test: `src/scrapers/bookmakers/totalbet/__tests__/grid-parser.test.ts`

**Interfaces:**
- Consumes: `TotalbetDetailEvent`, `TotalbetListEvent`, `TotalbetComponent` (Task 1), `ScrapedMarket` (`src/types/full-offer.ts:32`).
- Produces:
  ```ts
  export function cleanName(raw: string): string;   // collapse whitespace runs to one space, trim
  export function parseParticipants(e: TotalbetEventBase): { homeTeam: string; awayTeam: string } | null;  // cleaned participants[0|1].name
  export function parseListEvent1X2(e: TotalbetListEvent): { home: number; draw: number; away: number } | null; // market id "1", outcomes by sort 1/2/3, all active and > 1
  export function listEventToMatchWinnerMarket(e: TotalbetListEvent): ScrapedMarket | null; // { name: "Wynik meczu", groupName: "Wynik meczu", selections } with no id
  export function parseEventDetail(e: TotalbetDetailEvent): ScrapedMarket[];
  ```
- `parseEventDetail` contract (Task 3 relies on it):
  - one `ScrapedMarket` per `market_uuid`, in component order, then first appearance
  - `selections = [{ name: cleanName(cell.name), odds: Number(cell.odds), externalId: cell.uuid, status: "active" }]`, built only from cells with `outcome_status === "active" && market_status === "active" && Number(odds) > 1`
  - markets left with no selections are dropped
  - `groupName = cleanName(component.name)`
  - per `type`:

    | `type` | `name` | `bookmakerMarketId` | `paramValue` |
    |---|---|---|---|
    | `markets_in_columns` | `${cleanName(component.name)} - ${cleanName(header[col].text)}` | `mid:${header[col].market_id}` (undefined if missing) | – |
    | `total` | `cleanName(component.name)` | `slug:${slug}` | `row[0].text` |
    | `handicap_2col` | `cleanName(component.name)` | `slug:${slug}` | text of the label cell right before the row's first outcome (home line) |
    | `handicap_3col` | `cleanName(component.name)` | `slug:${slug}` | `row[0].text` (`"1:0"`) |
    | `exact_result` | `cleanName(component.name)` | `slug:${slug}` | – |
    | `single_market` and any unknown type | `cleanName(component.name)` | undefined | – |

- [ ] **Step 1: Write the failing tests**

```ts
const leeds = load("event-detail-leeds-tottenham.trimmed.json").data.event;
const cp = load("event-detail-crystal-palace-liverpool.core.json").data.event;
const list = load("pl-events-list.json").data.events;
const pick = (ms: ScrapedMarket[], id: string, p?: string) => ms.find((m) => m.bookmakerMarketId === id && m.paramValue === p)!;
const pairs = (m: ScrapedMarket) => m.selections.map((s) => [s.name, s.odds]);

it("grid-parser returns one market per distinct market_uuid", () => expect(parseEventDetail(leeds)).toHaveLength(102));
it("grid-parser keys column layouts by UOF market_id", () => {
  const dc = pick(parseEventDetail(leeds), "mid:10");
  expect(dc.name).toBe("Podwójna szansa - Cały mecz");
  expect(pairs(dc)).toEqual([["Leeds lub remis", 1.5], ["Leeds lub Tottenham", 1.33], ["remis lub Tottenham", 1.42]]);
  expect(pairs(pick(parseEventDetail(leeds), "mid:32"))).toEqual([["nie", 3.15], ["tak", 1.31]]);
});
it("grid-parser puts total lines into paramValue", () => {
  const ms = parseEventDetail(leeds);
  expect(ms.filter((m) => m.bookmakerMarketId === "slug:suma").map((m) => m.paramValue)).toEqual(["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"]);
  expect(pairs(pick(ms, "slug:suma", "2.5"))).toEqual([["poniżej 2.5", 1.82], ["powyżej 2.5", 1.89]]);
});
it("grid-parser takes the home line for 2-col handicaps and the score for 3-col", () => {
  const ms = parseEventDetail(leeds);
  expect(ms.filter((m) => m.bookmakerMarketId === "slug:handicap").map((m) => m.paramValue)).toEqual(["-1.5", "-0.5", "+0.5", "+1.5"]);
  expect(pairs(pick(ms, "slug:handicap", "-1.5"))).toEqual([["Leeds (-1.5)", 5.2], ["Tottenham (+1.5)", 1.13]]);
  expect(pairs(pick(ms, "slug:handicap_hcp", "0:2"))).toEqual([["Leeds (0:2)", 14], ["remis (0:2)", 7.4], ["Tottenham (0:2)", 1.12]]);
});
it("grid-parser collects exact-result grids including 'inny'", () => {
  const ms = parseEventDetail(leeds);
  expect(pick(ms, "slug:dokaadny_wynik").selections).toHaveLength(28);
  expect(pairs(pick(ms, "slug:1_poaowa_dokaadny_wynik"))).toContainEqual(["inny", 18]);
});
it("grid-parser drops closed outcomes even when their odds look valid", () => {
  const m = parseEventDetail(leeds).find((x) => x.name === "Zawodnik strzeli gola")!;
  expect(m.selections).toHaveLength(36);
  const names = m.selections.map((s) => s.name);
  expect(names).not.toContain("bez gola");          // closed, odds "0.00"
  expect(names).not.toContain("Bergvall, Lucas");   // closed, odds "7.80"
});
it("grid-parser leaves single markets without an id", () => {
  const m = parseEventDetail(leeds).find((x) => x.name === "Wynik meczu")!;
  expect(m.bookmakerMarketId).toBeUndefined();
  expect(pairs(m)).toEqual([["Leeds", 2.8], ["remis", 3.35], ["Tottenham", 2.47]]);
});
it("grid-parser collapses whitespace in names", () => {
  const ms = parseEventDetail(cp);
  expect(ms).toHaveLength(21);
  expect(pairs(pick(ms, "mid:10"))).toEqual([["Crystal Palace lub remis", 2.28], ["Crystal Palace lub Liverpool", 1.21], ["remis lub Liverpool", 1.16]]);
  expect(parseParticipants(cp)).toEqual({ homeTeam: "Crystal Palace", awayTeam: "Liverpool" });
});
it("grid-parser reads the list 1X2 by sort order", () => {
  expect(parseListEvent1X2(list[0])).toEqual({ home: 1.65, draw: 3.95, away: 4.9 });
  expect(listEventToMatchWinnerMarket(list[0])!.selections.map((s) => s.odds)).toEqual([1.65, 3.95, 4.9]);
});
it("grid-parser treats unknown component types as single markets", () => {
  const e = { ...leeds, component_lists: [{ ...leeds.component_lists[0], type: "new_layout", slug: "x" }] };
  expect(parseEventDetail(e)[0].bookmakerMarketId).toBeUndefined();
});
```

- [ ] **Step 2: Run:** `npx vitest run src/scrapers/bookmakers/totalbet/__tests__/grid-parser.test.ts`. Expected: FAIL, because `../grid-parser.js` cannot be resolved.
- [ ] **Step 3: Implement `grid-parser.ts`** following the contract above. For `markets_in_columns`, the header row is `grid[0]` and the body rows are `grid.slice(1)`. For `total`, `handicap_2col` and `handicap_3col`, skip the header row.
- [ ] **Step 4: Run the test (PASS), then `npx tsc --noEmit` and `npx vitest run`.**
- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/totalbet/grid-parser.ts src/scrapers/bookmakers/totalbet/__tests__/grid-parser.test.ts src/scrapers/bookmakers/totalbet/__tests__/fixtures
git commit -m "feat(totalbet): parse component_lists grids into markets"
```

---

### Task 3: Phase-1 normalizer rewrite

**Files:**
- Rewrite: `src/services/normalization/bookmakers/totalbet-normalizer.ts` (the whole file; the export name `totalbetNormalizer` and the default export stay)
- Test: `src/services/normalization/bookmakers/__tests__/totalbet-normalizer.test.ts`. Fixtures are read from `../../../../scrapers/bookmakers/totalbet/__tests__/fixtures/`.
- Fixtures (run from the worktree root): `cp /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/event-detail-everton-coventry.orientation.json src/scrapers/bookmakers/totalbet/__tests__/fixtures/`. This is an unbalanced match, so it can pin the home/away orientation of the team-to-score columns; Leeds–Tottenham is too balanced for that.

**Interfaces:**
- Consumes: `parseEventDetail` (Task 2, test-only); the helpers `normalizeOverUnderSelection`, `normalizeYesNoSelection`, `normalizeOddEvenSelection`, `parseScoreSelection`, `normalizeMarketName`, `buildMarketKey` (`src/services/normalization/helpers/index.ts`); `getCanonicalTeamName` (`src/utils/team-matcher.ts`); `getMarketMetadata` and `isValidMarketCode` (catalog). `normalize1x2Selection` is deliberately **not** used, because its canonical fallback is fuzzy. Nothing is imported from the scraper layer at runtime: the normalizer has its own module-private `collapseWhitespace(s) = s.replace(/\s+/g, " ").trim()`, which is the same behaviour as Task 2's `cleanName`.
- Produces:
  ```ts
  export const TOTALBET_MARKET_KEY_TO_CODE: Readonly<Record<string, NormalizedMarketType>>;  // exactly the 38 keys below
  export const TOTALBET_MARKET_NAME_TO_CODE: Readonly<Record<string, NormalizedMarketType>>; // { "wynik meczu": "MATCH_WINNER" }
  export function europeanLineFromScore(score: string): string | undefined;                 // "1:0"→"+1", "0:2"→"-2", "0:0"→"0", else undefined
  export function resolveSide(label: string, ctx: NormalizationContext): "HOME" | "DRAW" | "AWAY" | "NONE" | "UNKNOWN";
  export const totalbetNormalizer: BookmakerMarketNormalizer;   // debug: { rawName, rawId: <key string>, matchedBy: "id" | "name" | "pattern" }
  ```
- Key table (a decision, copy verbatim):
  ```ts
  "mid:10": "DOUBLE_CHANCE", "mid:63": "HALF_TIME_DOUBLE_CHANCE", "mid:85": "SECOND_HALF_DOUBLE_CHANCE",
  "mid:29": "BTTS", "mid:75": "HALF_TIME_BTTS", "mid:95": "SECOND_HALF_BTTS",
  "mid:11": "DRAW_NO_BET", "mid:64": "HALF_TIME_DRAW_NO_BET", "mid:86": "SECOND_HALF_DRAW_NO_BET",
  "mid:60": "HALF_TIME_RESULT", "mid:83": "SECOND_HALF_RESULT",
  "mid:26": "ODD_EVEN_GOALS", "mid:74": "HALF_TIME_ODD_EVEN_GOALS", "mid:94": "SECOND_HALF_ODD_EVEN_GOALS",
  "mid:32": "HOME_TEAM_TO_SCORE", "mid:31": "AWAY_TEAM_TO_SCORE",
  "mid:77": "HALF_TIME_HOME_TO_SCORE", "mid:76": "HALF_TIME_AWAY_TO_SCORE",
  "mid:97": "SECOND_HALF_HOME_TO_SCORE", "mid:96": "SECOND_HALF_AWAY_TO_SCORE",
  "slug:suma": "TOTAL_GOALS", "slug:1_poaowa_suma": "HALF_TIME_TOTAL_GOALS", "slug:2_poaowa_suma": "SECOND_HALF_TOTAL_GOALS",
  "slug:competitor1_total_suma": "HOME_TEAM_TOTAL_GOALS", "slug:competitor2_total_suma": "AWAY_TEAM_TOTAL_GOALS",
  "slug:1_poaowa_competitor_1_suma_goli": "HALF_TIME_HOME_TEAM_TOTAL_GOALS", "slug:1_poaowa_competitor_2_suma_goli": "HALF_TIME_AWAY_TEAM_TOTAL_GOALS",
  "slug:2_poaowa_competitor1_suma_goli_": "SECOND_HALF_HOME_TEAM_TOTAL_GOALS", "slug:2_poaowa_competitor2_suma_goli_": "SECOND_HALF_AWAY_TEAM_TOTAL_GOALS",
  "slug:handicap": "ASIAN_HANDICAP", "slug:1_poaowa_handicap": "FIRST_HALF_ASIAN_HANDICAP", "slug:2_poaowa_handicap": "SECOND_HALF_ASIAN_HANDICAP",
  "slug:handicap_hcp": "EUROPEAN_HANDICAP", "slug:1_poaowa_handicap_3way": "FIRST_HALF_EUROPEAN_HANDICAP", "slug:2_poaowa_handicap_3": "SECOND_HALF_EUROPEAN_HANDICAP",
  "slug:dokaadny_wynik": "CORRECT_SCORE", "slug:1_poaowa_dokaadny_wynik": "HALF_TIME_CORRECT_SCORE", "slug:2_poaowa_dokaadny_wynik": "SECOND_HALF_CORRECT_SCORE",
  ```
- Rules (not determined by the signatures):
  - **Code resolution:**
    - `String(raw.bookmakerMarketId)` is looked up in the key table, giving `matchedBy:"id"`.
    - Otherwise `normalizeMarketName(raw.name)` is looked up in the name table, giving `"name"`.
    - Otherwise the result is `OTHER`, with `"pattern"` and **no console output** (about 360 per match would flood the log).
    - No regex patterns and no numeric id table.
  - **Param:**
    - Totals family: `raw.paramValue` must match `/^\d+\.5$/`.
    - Asian family: `/^[+-]\d+(\.\d+)?$/`.
    - European family: `europeanLineFromScore(raw.paramValue)`.
    - A parameterized code without a valid param returns `null`.
    - `OTHER` outputs carry `paramValue: raw.paramValue` with `marketKey: "OTHER"`, the same shape as the factory's null path (`factory.ts:144-149`). Without it, `factory.ts:166` and `normalization/index.ts:103` would overwrite the line with `undefined`, and the lines of one non-phase-1 component (corner or card totals, corner handicap) would collapse into one storage row (risk 5).
  - **`resolveSide`:**
    1. Clean the label with `collapseWhitespace`, then strip a trailing `\s*\([^)]*\)`.
    2. `/^remis$/i` → DRAW.
    3. `/^(nikt|żaden|brak)$/i` → NONE.
    4. If the cleaned label has **at least 3 characters** (the same guard as `normalize1x2Selection`, `helpers/index.ts:213,217`): a diacritics- and case-insensitive containment check, in either direction, against `ctx.homeTeam` → HOME, then `ctx.awayTeam` → AWAY. An empty label (`"(-1.5)"` after stripping) never matches.
    5. `getCanonicalTeamName(label, ctx.league)` is itself fuzzy: `team-matcher.ts:677-688` uses Fuse with a score below 0.4, and gives `tak`→Stoke City, `nie`→Sunderland, `gol`→Liverpool and `nikt`→Leeds United. So its result is accepted only when it equals `ctx.homeTeam` → HOME, or `ctx.awayTeam` → AWAY, **and** the diacritics-stripped, lower-cased label has the same first 4 characters as the canonical name. This keeps `Atletico Madryt`→`Atletico Madrid` and rejects `nie`→`Sunderland` (cost: risk 6).
    6. Otherwise UNKNOWN.
  - **Selection codes by family:**
    - side families (1X2, HT/2H result, DNB, AH, EH): `resolveSide`; anything outside the family's set becomes `UNKNOWN`
    - DC: split on `/\s+lub\s+/i` → the pair of sides → `HOME_OR_DRAW` / `HOME_OR_AWAY` / `DRAW_OR_AWAY`
    - totals: `normalizeOverUnderSelection`
    - BTTS and *_TO_SCORE: `normalizeYesNoSelection`
    - odd/even: `normalizeOddEvenSelection`
    - correct score: `parseScoreSelection(label) ?? (/^inny$/i → "OTHER") ?? "UNKNOWN"`
  - **Output:** `label` is the original `sel.name`, and `marketName` is the catalog `labels.pl`.

- [ ] **Step 1: Write the failing tests**

```ts
const ctx = { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league", leagueName: "premier-league" };
const run = (fixture: string, c = ctx) => parseEventDetail(load(fixture).data.event).map((m) => ({ m,
  o: totalbetNormalizer.normalizeMarket({ bookmakerMarketId: m.bookmakerMarketId, name: m.name, paramValue: m.paramValue, selections: m.selections }, c) }));
const outs = run("event-detail-leeds-tottenham.trimmed.json");
const byKey = (key: string, rows = outs) => Object.fromEntries(rows.find(({ o }) => o?.marketKey === key)!.o!.selections.map((s) => [s.code, s.odds]));

it.each([
  ["MATCH_WINNER", { HOME: 2.8, DRAW: 3.35, AWAY: 2.47 }],
  ["DOUBLE_CHANCE", { HOME_OR_DRAW: 1.5, HOME_OR_AWAY: 1.33, DRAW_OR_AWAY: 1.42 }],
  ["HALF_TIME_DOUBLE_CHANCE", { HOME_OR_DRAW: 1.31, HOME_OR_AWAY: 1.57, DRAW_OR_AWAY: 1.28 }],
  ["SECOND_HALF_DOUBLE_CHANCE", { HOME_OR_DRAW: 1.37, HOME_OR_AWAY: 1.43, DRAW_OR_AWAY: 1.33 }],
  ["BTTS", { YES: 1.71, NO: 2.03 }], ["HALF_TIME_BTTS", { YES: 4.15, NO: 1.19 }], ["SECOND_HALF_BTTS", { YES: 3.25, NO: 1.29 }],
  ["DRAW_NO_BET", { HOME: 1.95, AWAY: 1.77 }], ["HALF_TIME_DRAW_NO_BET", { HOME: 1.91, AWAY: 1.77 }], ["SECOND_HALF_DRAW_NO_BET", { HOME: 1.9, AWAY: 1.77 }],
  ["HALF_TIME_RESULT", { HOME: 3.37, DRAW: 2.16, AWAY: 3.1 }], ["SECOND_HALF_RESULT", { HOME: 3.02, DRAW: 2.54, AWAY: 2.81 }],
  ["ODD_EVEN_GOALS", { ODD: 1.92, EVEN: 1.79 }], ["HALF_TIME_ODD_EVEN_GOALS", { ODD: 2.02, EVEN: 1.65 }], ["SECOND_HALF_ODD_EVEN_GOALS", { ODD: 1.91, EVEN: 1.73 }],
  ["TOTAL_GOALS:2.5", { UNDER: 1.82, OVER: 1.89 }], ["TOTAL_GOALS:0.5", { UNDER: 7.8, OVER: 1.05 }], ["HALF_TIME_TOTAL_GOALS:0.5", { UNDER: 2.79, OVER: 1.39 }],
  ["HOME_TEAM_TOTAL_GOALS:0.5", { UNDER: 3.15, OVER: 1.31 }], ["AWAY_TEAM_TOTAL_GOALS:0.5", { UNDER: 3.37, OVER: 1.28 }],
  ["HOME_TEAM_TO_SCORE", { YES: 1.31, NO: 3.15 }], ["AWAY_TEAM_TO_SCORE", { YES: 1.28, NO: 3.37 }],
  ["HALF_TIME_HOME_TO_SCORE", { YES: 2.08, NO: 1.61 }], ["HALF_TIME_AWAY_TO_SCORE", { YES: 2.0, NO: 1.67 }],
  ["SECOND_HALF_HOME_TO_SCORE", { YES: 1.79, NO: 1.85 }], ["SECOND_HALF_AWAY_TO_SCORE", { YES: 1.73, NO: 1.92 }],
  ["ASIAN_HANDICAP:-1.5", { HOME: 5.2, AWAY: 1.13 }], ["ASIAN_HANDICAP:+0.5", { HOME: 1.51, AWAY: 2.4 }],
  ["EUROPEAN_HANDICAP:+1", { HOME: 1.5, DRAW: 4.3, AWAY: 4.95 }], ["EUROPEAN_HANDICAP:-2", { HOME: 14, DRAW: 7.4, AWAY: 1.12 }],
])("totalbet maps %s with the captured Leeds-Tottenham odds", (key, expected) => expect(byKey(key)).toEqual(expected));

it("totalbet maps correct-score grids", () => {
  expect(byKey("CORRECT_SCORE")).toMatchObject({ "1-0": 8.25, "0-0": 9, "0-1": 7.6 });
  expect(Object.keys(byKey("CORRECT_SCORE"))).toHaveLength(28);
  expect(byKey("HALF_TIME_CORRECT_SCORE")).toMatchObject({ OTHER: 18, "1-0": 4.85 });
});
it("totalbet maps exactly the 81 phase-1 markets with zero UNKNOWN", () => {
  const mapped = outs.filter(({ o }) => o && o.marketCode !== "OTHER");
  expect(mapped).toHaveLength(81);
  expect(new Set(mapped.map(({ o }) => o!.marketCode)).size).toBe(39);
  expect(mapped.flatMap(({ o }) => o!.selections).filter((s) => s.code === "UNKNOWN")).toEqual([]);
});
it("totalbet keeps negative controls OTHER", () => {
  const others = outs.filter(({ o }) => o?.marketCode === "OTHER").map(({ m }) => m.name);
  expect(others).toHaveLength(21);
  expect(new Set(others)).toEqual(new Set(["Suma rzutów rożnych", "Suma kartek", "Rzuty rożne - Handicap", "Zawodnik strzeli gola",
    "Wygra do zera - Leeds", "Wygra do zera - Tottenham", "Wynik + Total (suma)", "Strzeli 1 gola - Cały mecz",
    "Strzeli 1 gola - 1. Połowa", "Strzeli 1 gola - 2. Połowa", "Podwójna szansa + suma goli"]));
});
it("totalbet keeps the line on OTHER line markets", () => {
  expect(totalbetNormalizer.normalizeMarket({ bookmakerMarketId: "slug:suma_rzutaw_roanych", name: "Suma rzutów rożnych", paramValue: "8.5",
    selections: [{ name: "poniżej 8.5", odds: 2.53 }, { name: "powyżej 8.5", odds: 1.46 }] }, ctx)).toMatchObject({ marketCode: "OTHER", marketKey: "OTHER", paramValue: "8.5" });
  // the 5 corner-total lines (7.5..11.5) must stay 5 storage rows on the production path
  const corners = parseEventDetail(load("event-detail-leeds-tottenham.trimmed.json").data.event).filter((m) => m.bookmakerMarketId === "slug:suma_rzutaw_roanych");
  const keys = corners.map((m) => { const n = normalizer.normalize(m, "totalbet", "Leeds United", "Tottenham Hotspur", "premier-league");
    return resolveStorageMarketKey({ ...m, paramValue: n.paramValue }, n.marketKey); });
  expect(new Set(keys).size).toBe(5);
});
it("totalbet ignores legacy numeric ids", () => {
  const sel = [{ name: "1X", odds: 1.5 }, { name: "X2", odds: 1.4 }];
  expect(totalbetNormalizer.normalizeMarket({ bookmakerMarketId: 10, name: "Podwójna szansa", selections: sel }, ctx)!.marketCode).toBe("OTHER");
  expect(totalbetNormalizer.normalizeMarket({ bookmakerMarketId: "8", name: "Strzeli 1 gola", selections: sel }, ctx)!.marketCode).toBe("OTHER");
});
it("totalbet returns null for a parameterized market without a valid line", () =>
  expect(totalbetNormalizer.normalizeMarket({ bookmakerMarketId: "slug:suma", name: "Total (suma)", selections: [{ name: "powyżej 2.5", odds: 1.89 }] }, ctx)).toBeNull());
it("totalbet cross-checks team-to-score against the team total", () =>
  expect(byKey("HOME_TEAM_TO_SCORE").YES).toBe(byKey("HOME_TEAM_TOTAL_GOALS:0.5").OVER));
it("totalbet orients half-time team-to-score like the half totals", () => {
  // Leeds-Tottenham: within 5 % of the same team's 0.5 OVER (2.08 vs 2.13, 1.79 vs 1.82)
  expect(Math.abs(byKey("HALF_TIME_HOME_TO_SCORE").YES - byKey("HALF_TIME_HOME_TEAM_TOTAL_GOALS:0.5").OVER) / 2.13).toBeLessThan(0.05);
  expect(Math.abs(byKey("SECOND_HALF_HOME_TO_SCORE").YES - byKey("SECOND_HALF_HOME_TEAM_TOTAL_GOALS:0.5").OVER) / 1.82).toBeLessThan(0.05);
  // Everton-Coventry is unbalanced, so a home/away swap would be obvious: HT home YES 1.63 vs own 0.5 OVER 1.65 vs other 2.60
  const ev = run("event-detail-everton-coventry.orientation.json", { ...ctx, homeTeam: "Everton", awayTeam: "Coventry City" });
  expect(byKey("HALF_TIME_HOME_TO_SCORE", ev)).toEqual({ YES: 1.63, NO: 2.06 });
  expect(byKey("SECOND_HALF_AWAY_TO_SCORE", ev)).toEqual({ YES: 2.15, NO: 1.57 });
  for (const [ts, tt] of [["HALF_TIME_%_TO_SCORE", "HALF_TIME_%_TEAM_TOTAL_GOALS:0.5"], ["SECOND_HALF_%_TO_SCORE", "SECOND_HALF_%_TEAM_TOTAL_GOALS:0.5"], ["%_TEAM_TO_SCORE", "%_TEAM_TOTAL_GOALS:0.5"]])
    for (const [own, other] of [["HOME", "AWAY"], ["AWAY", "HOME"]]) {
      const yes = byKey(ts.replace("%", own), ev).YES;
      expect(Math.abs(yes - byKey(tt.replace("%", own), ev).OVER)).toBeLessThan(Math.abs(yes - byKey(tt.replace("%", other), ev).OVER));
    }
});
it("totalbet survives the factory path without groupName", () => {
  const ms = parseEventDetail(load("event-detail-leeds-tottenham.trimmed.json").data.event);
  const dc = normalizer.normalize(ms.find((m) => m.bookmakerMarketId === "mid:10")!, "totalbet", "Leeds United", "Tottenham Hotspur", "premier-league");
  expect(dc.normalizedType).toBe("DOUBLE_CHANCE");
  expect(normalizer.normalize(ms.find((m) => m.bookmakerMarketId === "slug:suma" && m.paramValue === "2.5")!, "totalbet", "Leeds United", "Tottenham Hotspur", "premier-league").marketKey).toBe("TOTAL_GOALS:2.5");
});
it("totalbet resolves sides without the fuzzy fallback", () => {
  expect(resolveSide("nikt", ctx)).toBe("NONE");
  expect(resolveSide("Leeds (-1.5)", ctx)).toBe("HOME");
  const cpOuts = run("event-detail-crystal-palace-liverpool.core.json", { ...ctx, homeTeam: "Crystal Palace", awayTeam: "Liverpool" });
  expect(byKey("DOUBLE_CHANCE", cpOuts)).toEqual({ HOME_OR_DRAW: 2.28, HOME_OR_AWAY: 1.21, DRAW_OR_AWAY: 1.16 });
  expect(byKey("ASIAN_HANDICAP:-0.5", cpOuts)).toEqual({ HOME: 4.65, AWAY: 1.16 });
  expect(byKey("HOME_TEAM_TO_SCORE", cpOuts).YES).toBe(byKey("HOME_TEAM_TOTAL_GOALS:0.5", cpOuts).OVER); // 1.46
  const laliga = { homeTeam: "Atletico Madrid", awayTeam: "Real Madrid", league: "laliga" };
  expect([resolveSide("Atletico Madryt", laliga), resolveSide("Real Madryt", laliga)]).toEqual(["HOME", "AWAY"]);
  // getCanonicalTeamName fuzzy-maps these tokens to the context team; the prefix guard must reject them
  expect(resolveSide("nie", { homeTeam: "Sunderland", awayTeam: "Chelsea", league: "premier-league" })).toBe("UNKNOWN");
  expect(resolveSide("gol", { homeTeam: "Liverpool", awayTeam: "Manchester United", league: "premier-league" })).toBe("UNKNOWN");
  expect(resolveSide("(-1.5)", ctx)).toBe("UNKNOWN");
});
it("totalbet europeanLineFromScore converts virtual scores", () =>
  expect(["1:0", "0:2", "0:0", "x"].map(europeanLineFromScore)).toEqual(["+1", "-2", "0", undefined]));
it("totalbet is silent for OTHER markets", () => {
  const warn = vi.spyOn(console, "warn"); run("event-detail-leeds-tottenham.trimmed.json");
  expect(warn).not.toHaveBeenCalled(); warn.mockRestore();
});
```
(`normalizer` is imported from `../../index.js`, `resolveStorageMarketKey` from `../../../../repositories/full-offer-repository.js` (already imported without mocks by `src/repositories/__tests__/full-offer-repository.test.ts`), and `vi` from `vitest`.)

- [ ] **Step 2: Run:** `npx vitest run src/services/normalization/bookmakers/__tests__/totalbet-normalizer.test.ts`. Expected: FAIL. `resolveSide` and `europeanLineFromScore` are not exported, and the mapping assertions fail (DC comes out as `ODD_EVEN_GOALS`).
- [ ] **Step 3: Rewrite `totalbet-normalizer.ts`** following the Interfaces and Rules above. Delete `TOTALBET_MARKET_ID_TO_CODE`, `TOTALBET_MARKET_PATTERNS` and `extractParamValue`.
- [ ] **Step 4: Run the test (PASS), then `npx tsc --noEmit` and `npx vitest run`.** Golden tests for the other 12 bookmakers must be unchanged.
- [ ] **Step 5: Commit**

```bash
git add src/services/normalization/bookmakers/totalbet-normalizer.ts src/services/normalization/bookmakers/__tests__/totalbet-normalizer.test.ts
git commit -m "feat(totalbet): id-keyed phase-1 normalizer for the component layout"
```

---

### Task 4: Scraper wiring, league UUIDs, legacy removal

**Files:**
- Rewrite: `src/scrapers/bookmakers/totalbet/index.ts`
- Modify: `src/config/leagues.ts:32,54,76,98,120` (set the ids, re-adding the lines if Task 0 removed them); replace the comment at `:148-150` with `totalbet: { id: "298d1945-aed7-4b43-ba39-3dbc23a59cd0" },`
- Modify: `src/scrapers/bookmakers/totalbet/constants.ts`. Delete `API_BASE_URL`, `CATEGORY_IDS`, `CATEGORY_UUIDS`, `LEAGUE_URLS`, `GAME_TYPES`, `MARKET_GROUPS`, `MARKET_TYPES`, `CACHE_TTL` and `TEAM_SEPARATOR`. Keep `BASE_URL`, `REQUEST_TIMEOUT` and the Task 1 additions. Add `PHASE1_MARKET_KEYS: readonly string[]`, which holds the 38 keys of Task 3's key table in the same order, and `PHASE1_CHECK_MIN_MARKETS = 150`. The scraper layer does not import from the services layer at runtime, so the list is duplicated here, and a test keeps the two in sync.
- Delete: `navigation.ts`, `parser.ts`, `types.ts`, `__tests__/parse-all-markets-id.test.ts`, and `__tests__/stop-gap.test.ts` if Task 0 ran.
- Test: `src/scrapers/bookmakers/totalbet/__tests__/scraper.test.ts`

**Interfaces:**
- Consumes: Task 1 (`fetchLeagueEvents`, `fetchEventDetail`, `buildEventUrl`, `extractEventUuidFromUrl`, `FetchJson`, `DETAIL_DELAY_MS`); Task 2 (`parseEventDetail`, `parseParticipants`, `parseListEvent1X2`, `listEventToMatchWinnerMarket`); `getBookmakerLeagueId` (`leagues.ts:163`); `getCanonicalTeamName`.
- Produces:
  ```ts
  export interface TotalbetDeps { fetchJson?: FetchJson; detailDelayMs?: number }
  export class TotalbetPlaywrightScraper extends PlaywrightScraper {   // name kept for compatibility; never opens a browser
    constructor(config?: Partial<ScraperConfig>, deps?: TotalbetDeps);
    scrapeLeague(league: string): Promise<ScraperResult>;              // list only, one RawScrapedOdds per event with list 1X2
    scrapeMatch(match: MatchIdentifier): Promise<ScraperResult>;      // unchanged logic (scrapeLeague + findMatchingEvent)
    scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult>; // detail → market1X2 only
    scrapeFullOffer(league: string): Promise<FullOfferScraperResult>;
    extractEventUrls(page: Page): Promise<EventUrlEntry[]>;           // []
  }
  export const totalbetScraper: TotalbetPlaywrightScraper;
  ```
- Behaviour:
  - **League UUID:** `getBookmakerLeagueId(league, "totalbet")` must be a 36-character UUID string. Otherwise the result is `{ success:false, error:"Unknown league: <league>" }`.
  - **List errors** go to `result.error` verbatim (the Task 1 strings).
  - After the list call, log `[Totalbet/FullOffer] Found ${events.length} prematch events for ${league}`. This is `N_list` for acceptance A6.
  - **Per event, in sequence:**
    1. `fetchEventDetail`, then `await this.delay(detailDelayMs ?? DETAIL_DELAY_MS)`.
    2. Markets: `parseEventDetail(detail)` when the detail is OK. If the detail fails, use `[listEventToMatchWinnerMarket(listEvent)]` and `console.warn` the error. If neither gives a market, skip the event.
    3. `FullMatchOffer = { matchId: uuid, bookmaker: "totalbet", homeTeam/awayTeam: getCanonicalTeamName(parseParticipants(e).home/away, league), eventUrl: buildEventUrl(uuid), startTime: start_at, markets, scrapedAt: new Date() }`.
    4. Log `[Totalbet/FullOffer] ${homeTeam} vs ${awayTeam}: ${markets.length} markets (market_count ${e.market_count})`.
    5. **Slug-drift check** (risk 1). The check runs when the detail is OK and `detail.market_count >= PHASE1_CHECK_MIN_MARKETS`.
       - `present` is every `slug:${c.slug}`, plus `mid:${h.market_id}` for every header label of `markets_in_columns` components. It is read from the raw `component_lists` before status filtering, so suspended markets do not raise false alarms.
       - `missing = PHASE1_MARKET_KEYS.filter((k) => !present.has(k))`.
       - If `missing` is not empty: `console.warn` `[Totalbet/FullOffer] phase-1 keys missing for ${homeTeam} vs ${awayTeam}: ${missing.join(",")}`, and collect the text after the prefix.
  - **After the loop:**
    - Zero matches gives `success:false` with error `No parsable Totalbet events for <league>`.
    - Otherwise, count the events whose detail failed as `k` (out of `n` listed events). Then build the parts of `result.error`:
      - when `k > 0`: `Detail fetch failed for ${k}/${n} events (first: ${firstDetailError})`, also logged as `[Totalbet/FullOffer] Detail fetch failed …`
      - every collected `phase-1 keys missing for …` text
    - Join the parts with `" | "`. When there are no parts, `error` stays undefined.
    - `success` is `k < n`. When every detail fails, the run reports failure even though it has list-1X2 fallbacks, and the aggregator (`aggregator.ts:260`) saves nothing. That is intended: a run with only 1X2 is an outage, not a healthy run.
  - **`scrapeMatchDetails`:**
    - An invalid URL returns the not-found result `"Invalid Totalbet event URL"`.
    - Otherwise `market1X2` comes from the `"Wynik meczu"` market's three selections, in grid order home, draw, away.
  - No `navigateToBaseSite`, no `executeWithBrowser`, no event cache.

- [ ] **Step 1: Write the failing tests**

```ts
// fakeWith(overrides) returns a FetchJson: list URL page 1 → pl-events-list.json; detail of 0e45932b-… → Leeds trimmed; detail of f91beb39-… → Crystal Palace core;
// overrides replace a detail body by event uuid; anything else → 404 envelope (event-not-found.json). f = fakeWith({}).
// TOTALBET_MARKET_KEY_TO_CODE is imported from ../../../../services/normalization/bookmakers/totalbet-normalizer.js (test-only cross-layer import).
const scraper = new TotalbetPlaywrightScraper(undefined, { fetchJson: f, detailDelayMs: 0 });

it("totalbet full offer returns 20 matches without a browser", async () => {
  const spy = vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser");
  const r = await scraper.scrapeFullOffer("premier-league");
  expect(r.success).toBe(true); expect(r.matches).toHaveLength(20); expect(spy).not.toHaveBeenCalled();
  const leeds = r.matches.find((m) => m.matchId === "0e45932b-1433-4cf5-b658-5c308b7c2b60")!;
  expect(leeds).toMatchObject({ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", startTime: "2026-11-07T12:30:00Z",
    eventUrl: "https://totalbet.pl/event-details/0e45932b-1433-4cf5-b658-5c308b7c2b60" });
  expect(leeds.markets).toHaveLength(102);
  expect(r.matches.find((m) => m.matchId === "f91beb39-9b93-4b91-a3b1-a1063efec44d")!).toMatchObject({ homeTeam: "Crystal Palace" });
  // 18 of 20 details answer 404 in this fake; the first listed event is Everton-Coventry
  expect(r.error).toContain("Detail fetch failed for 18/20 events (first: HTTP 404 (not_found) from https://totalbet.pl/dealer/bdata/v1/bet/events/495716e5-fd45-43e5-8947-a0bf3ff676ab)");
  // the Crystal Palace core fixture keeps market_count 385 but only 6 components
  expect(r.error).toMatch(/phase-1 keys missing for Crystal Palace vs Liverpool: mid:29,.*slug:2_poaowa_dokaadny_wynik/);
  expect(r.error).not.toContain("for Leeds United vs Tottenham Hotspur");
});
it("totalbet fails the run when every detail fails", async () => {
  const listOnly: FetchJson = async (url) => url.includes("/events?") ? { status: 200, contentType: "application/json", body: load("pl-events-list.json") }
    : { status: 404, contentType: "application/json", body: load("event-not-found.json") };
  const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: listOnly, detailDelayMs: 0 }).scrapeFullOffer("premier-league");
  expect(r.success).toBe(false);
  expect(r.error).toMatch(/^Detail fetch failed for 20\/20 events \(first: HTTP 404 \(not_found\) from /);
});
it("totalbet flags missing phase-1 keys on large events", async () => {
  const leeds = load("event-detail-leeds-tottenham.trimmed.json");
  const noSuma = { ...leeds, data: { event: { ...leeds.data.event, component_lists: leeds.data.event.component_lists.filter((c: any) => c.slug !== "suma") } } };
  const warn = vi.spyOn(console, "warn");
  // same fake as above, but the Leeds detail without the "suma" component (market_count stays 439)
  const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ "0e45932b-1433-4cf5-b658-5c308b7c2b60": noSuma }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
  expect(r.error).toContain("phase-1 keys missing for Leeds United vs Tottenham Hotspur: slug:suma");
  expect(warn).toHaveBeenCalledWith("[Totalbet/FullOffer] phase-1 keys missing for Leeds United vs Tottenham Hotspur: slug:suma");
  warn.mockRestore();
});
it("totalbet PHASE1_MARKET_KEYS matches the normalizer key table", () =>
  expect([...PHASE1_MARKET_KEYS]).toEqual(Object.keys(TOTALBET_MARKET_KEY_TO_CODE)));
it("totalbet falls back to the list 1X2 when a detail fails", async () => {
  const ev = (await scraper.scrapeFullOffer("premier-league")).matches.find((m) => m.matchId === "495716e5-fd45-43e5-8947-a0bf3ff676ab")!;
  expect(ev.markets.map((m) => [m.name, m.selections.map((s) => s.odds)])).toEqual([["Wynik meczu", [1.65, 3.95, 4.9]]]);
});
it("totalbet surfaces the real list error", async () => {
  const s = new TotalbetPlaywrightScraper(undefined, { fetchJson: async () => ({ status: 404, contentType: "text/html", body: "x" }), detailDelayMs: 0 });
  expect(await s.scrapeFullOffer("premier-league")).toMatchObject({ success: false,
    error: "HTTP 404 from https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=8793bb6a-4684-44ba-b92e-4d896e6cbfbf&category_type=sport&type=standard" });
});
it("totalbet rejects leagues without a UUID", async () =>
  expect(await scraper.scrapeFullOffer("bundesliga")).toMatchObject({ success: false, error: "Unknown league: bundesliga" }));
it("totalbet scrapeLeague returns list 1X2 rows", async () => {
  const r = await scraper.scrapeLeague("premier-league");
  expect(r.status).toBe("success"); expect(r.data).toHaveLength(20);
  expect(r.data![0]).toMatchObject({ homeTeam: "Everton", awayTeam: "Coventry City", homeOdds: 1.65, drawOdds: 3.95, awayOdds: 4.9,
    eventUrl: "https://totalbet.pl/event-details/495716e5-fd45-43e5-8947-a0bf3ff676ab" });
});
it("totalbet scrapeMatchDetails reads 1X2 from the detail", async () => {
  const r = await scraper.scrapeMatchDetails("https://totalbet.pl/event-details/0e45932b-1433-4cf5-b658-5c308b7c2b60");
  expect(r.data!.market1X2).toEqual({ home: 2.8, draw: 3.35, away: 2.47 });
  expect((await scraper.scrapeMatchDetails("https://totalbet.pl/sports/event/1")).status).not.toBe("success");
});
it("totalbet league config carries the category UUIDs", () => {
  expect(Object.fromEntries(["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1", "world-cup-2026"].map((s) => [s, getBookmakerLeagueId(s, "totalbet")]))).toEqual({
    ekstraklasa: "ae7d4621-313d-4df6-b3be-046b76a32938", "premier-league": "8793bb6a-4684-44ba-b92e-4d896e6cbfbf",
    laliga: "cfb6428c-c437-4923-a370-562871d06316", "serie-a": "0253b9f3-ab3b-4d19-ab4e-87aa8c3adb8e",
    "ligue-1": "f64248fd-8f4a-499f-8092-3408cecf2565", "world-cup-2026": "298d1945-aed7-4b43-ba39-3dbc23a59cd0" });
});
```

- [ ] **Step 2: Run:** `npx vitest run src/scrapers/bookmakers/totalbet/__tests__/scraper.test.ts`. Expected: FAIL. The constructor ignores `deps`, the league ids are numeric, and the old code navigates with Playwright.
- [ ] **Step 3: Implement `index.ts`, the `leagues.ts` ids, the constants pruning and the deletions,** following the Interfaces and Behaviour above.
- [ ] **Step 4: Run all totalbet tests and the full gates:** `npx vitest run src/scrapers/bookmakers/totalbet src/services/normalization` (PASS), `npx tsc --noEmit` (exit 0) and `npx vitest run` (all green). Then run `grep -rn "rest/market\|CATEGORY_IDS\|navigateToBaseSite" src/scrapers/bookmakers/totalbet`. Expected: no output.
- [ ] **Step 5: Commit**

```bash
git add -A src/scrapers/bookmakers/totalbet src/config/leagues.ts
git commit -m "feat(totalbet): migrate scraper to the UUID dealer API without Playwright"
```

---

### Task 5: Golden baseline fixture from durable evidence

**Files:**
- Create (by the harvest script): `src/services/normalization/__fixtures__/totalbet/premier-league_leeds_united_tottenham_hotspur.json` and `.expected.json`
- Read only: `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/event-detail-leeds-tottenham.full.json` (absolute path, so it also works from the worktree; see Global Constraints Step 0)

**Interfaces:** Consumes `parseEventDetail` (Task 2), `totalbetNormalizer` (Task 3), and `scrapedMarketsToRaw`, `dedupeRawMarkets`, `buildPrepAuditOutput` (`src/services/audit/scraper-audit-core.ts:169,180,230`).

**Why the archive needs a patch.** `buildPrepAuditOutput` writes `markets[].raw` without `paramValue` (`scraper-audit-core.ts:370-376`). Harvest (`scripts/harvest-fixtures.ts:138`) and `golden.test.ts:91` re-normalize from that raw. Every Totalbet line lives in `paramValue`, so without the patch, all 57 line markets (totals, team totals, AH, EH) would be frozen as `expected: null`. That leaves 24 mapped instead of 81. `meta.recognized` would still say 81, because it is computed before the field is dropped. The `markets[i]` entries are index-aligned with `rawMarkets[i]` (`:258`, `index`), so Step 2 copies the line back into each archived raw block. `ArchiveRawMarket.paramValue` (`harvest-fixtures.ts:64`) already reads it.

- [ ] **Step 1: Confirm there is no baseline yet.** Run `npx vitest run src/services/normalization/__tests__/golden.test.ts -t "totalbet"`. Expected: `Test Files 1 skipped (1)`, `Tests 25 skipped (25)`, exit 0. No test is named after totalbet.
- [ ] **Step 2: Build the prep-audit archive offline, with the lines copied back** (deterministic, no network; a fixed directory, because shell variables do not persist between agent commands):

```bash
mkdir -p /tmp/totalbet-golden-archive && npx tsx -e 'import { readFileSync, writeFileSync } from "node:fs"; import { parseEventDetail } from "./src/scrapers/bookmakers/totalbet/grid-parser.ts"; import { totalbetNormalizer } from "./src/services/normalization/bookmakers/totalbet-normalizer.ts"; import { scrapedMarketsToRaw, dedupeRawMarkets, buildPrepAuditOutput } from "./src/services/audit/scraper-audit-core.ts"; const ev = JSON.parse(readFileSync("/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/event-detail-leeds-tottenham.full.json", "utf8")).data.event; const ctx = { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", leagueName: "premier-league", league: "premier-league" }; const raws = dedupeRawMarkets(scrapedMarketsToRaw(parseEventDetail(ev))); const out = buildPrepAuditOutput({ normalizer: totalbetNormalizer, ctx, rawMarkets: raws, meta: { matchId: ev.uuid, homeTeam: ctx.homeTeam, awayTeam: ctx.awayTeam, league: "premier-league" } }); raws.forEach((r, i) => { if (r.paramValue) (out.markets[i].raw as any).paramValue = r.paramValue; }); writeFileSync("/tmp/totalbet-golden-archive/premier-league_leeds_united_tottenham_hotspur__2026-11-06.json", JSON.stringify(out, null, 2)); console.log("ARCHIVE " + JSON.stringify({ rawDeduped: out.meta.rawDeduped, recognized: out.meta.recognized, unrecognized: out.meta.unrecognized, rawParam: out.markets.filter((m) => (m.raw as any).paramValue).length }));'
```
Expected: `ARCHIVE {"rawDeduped":439,"recognized":81,"unrecognized":358,"rawParam":94}`. 94 = 57 phase-1 lines + 37 lines of the 12 `OTHER` line components (corner and card totals and handicaps).

- [ ] **Step 3: Harvest with explicit paths** (the script's defaults still assume `backend/`):

```bash
npx tsx scripts/harvest-fixtures.ts --archive /tmp/totalbet-golden-archive/premier-league_leeds_united_tottenham_hotspur__2026-11-06.json --bookmaker totalbet --out-dir src/services/normalization/__fixtures__ --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json
```
- [ ] **Step 4: Inspect before blessing:**

```bash
python3 -I -c 'import json; d="src/services/normalization/__fixtures__/totalbet/premier-league_leeds_united_tottenham_hotspur"; f=json.load(open(d+".json"))["entries"]; e=json.load(open(d+".expected.json"))["entries"]; x=[i["expected"] for i in e if i["expected"]]; core=[i for i in x if i["marketCode"]!="OTHER"]; print("entries",len(e),"blessed",sum(i["blessed"] for i in e),"mapped",len(core),"codes",len({i["marketCode"] for i in core}),"unknown",sum(s["code"]=="UNKNOWN" for i in core for s in i["selections"]),"rawParam",sum(1 for i in f if i["raw"].get("paramValue")),"mappedParam",sum(1 for i in core if i["paramValue"]))'
```
Expected: `entries 439 blessed 439 mapped 81 codes 39 unknown 0 rawParam 94 mappedParam 57`. If the output differs, stop and do not commit:
  - `mapped 24` with `rawParam 0` means the archive lost `paramValue`. Check Step 2's copy loop, not the parser.
  - Any other difference points to Task 2 or 3.
- [ ] **Step 5: Run** `npx vitest run src/services/normalization/__tests__/golden.test.ts -t "totalbet"`. Expected: PASS. Then run `npx tsc --noEmit` and `npx vitest run`.
- [ ] **Step 6: Commit**

```bash
git add src/services/normalization/__fixtures__/totalbet
git commit -m "test(totalbet): golden baseline for Leeds United vs Tottenham Hotspur"
```
From here on, any phase-2 or phase-3 mapping change must first make this fixture fail. Then follow the Global Constraints rebless flow.

---

### Task 6: Live acceptance (no code)

**Files:** Create `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/acceptance-$(date +%F).txt` in the **main checkout** (command outputs only). It is never written on the fix branch, so the Step 3 merge cannot hit untracked-file conflicts.

- [ ] **Step 1: Standalone smoke from the worktree, before deploying.** Run the acceptance smoke and the normalizing variant from "Acceptance criteria", with the leading `cd` changed to `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api-totalbet`. Expected:
  - `SMOKE {"success":true,"listed":N,"matches":M,…}` with no `error` key, `N ≥ 1` and `M ≥ ceil(0.9·N)` (A1). Note `N` as `N_list`.
  - every `[Totalbet/FullOffer] … N markets (market_count M)` line has `N ≥ 0.95·M`, and there is no `Detail fetch failed` or `phase-1 keys missing` line (A2)
  - every `MATCH` line has `mapped ≥ 70` and `unknown: 0` (A3)
  - the acceptance smoke ends with `exit=0`, not `exit=124`, and prints no `[BrowserPool]` line (A7)
  - `durationMs < 60000` (A8)
- [ ] **Step 2: Discovery tool** (A7; the script has no explicit exit on success). One command, so the variable survives:

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api-totalbet && U=$(curl -s "https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=8793bb6a-4684-44ba-b92e-4d896e6cbfbf&category_type=sport&type=standard" | python3 -I -c 'import json,sys; print([e for e in json.load(sys.stdin)["data"]["events"] if e["type"] == "prematch" and e["status"] == "active"][0]["uuid"])') && timeout 180 npx tsx scripts/totalbet-market-discovery.ts --url "https://totalbet.pl/event-details/$U" --league premier-league; echo "exit=$?"
```
Expected: a summary is printed, then `exit=0` (not `exit=124`, which would be a hang; not `exit=1`, which would be `[discovery] No match found`).
- [ ] **Step 3: Deploy** (owner's go-ahead). Record T0 first, then merge into the checkout the dev server runs:

```bash
date -u +%FT%TZ > /tmp/totalbet-deploy-t0.txt && git -C /home/skamik/Documents/repositories/personal/aityper-scraper-api merge fix/totalbet-uuid-platform
```
  The server restarts and runs an initial scrape. Then read the dev server's log; in the analysis session it was `/tmp/claude-1000/-home-skamik-Documents-repositories-personal-aityper/3627e2c8-f787-4f71-8a6a-348993c930fc/scratchpad/backend.log`, otherwise use wherever `npm run dev` writes stdout:

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/claude-1000/-home-skamik-Documents-repositories-personal-aityper/3627e2c8-f787-4f71-8a6a-348993c930fc/scratchpad/backend.log | grep -E "Totalbet/FullOffer\] Found|totalbet completed|Totalbet/Navigation|Detail fetch failed|phase-1 keys missing" | tail -6
```
Expected (A6), for the run after T0:
  - a `[Totalbet/FullOffer] Found N prematch events for premier-league` line
  - `[Aggregator/FullOffer] totalbet completed: M matches, S markets saved` with `M ≥ ceil(0.9·N)` and `S > 0`
  - no `[Totalbet/Navigation]`, `Detail fetch failed` or `phase-1 keys missing` lines
- [ ] **Step 4: API checks** (A6 freshness, A4, A5). Each block is one command:

```bash
curl -s "http://localhost:3001/api/odds?league=premier-league" | python3 -I -c '
import json, sys
from datetime import datetime, timedelta
bm, t0 = sys.argv[1], datetime.fromisoformat(open(sys.argv[2]).read().strip().replace("Z", "+00:00"))
ts = [datetime.fromisoformat(v["scrapedAt"]) for m in json.load(sys.stdin)["data"]["matches"] for b, v in m["markets"].get("MATCH_WINNER", {}).get("bookmakerOdds", {}).items() if b == bm]
newest = max(ts) if ts else None
ok = newest is not None and t0 <= newest <= t0 + timedelta(minutes=10)
print(f"FRESHNESS bookmaker={bm} rows={len(ts)} newest={newest.isoformat() if newest else None} t0={t0.isoformat()} ok={ok}")
sys.exit(0 if ok else 1)
' totalbet /tmp/totalbet-deploy-t0.txt; echo "exit=$?"
# A6: ok=True, exit=0. Proven today with sts and T0=2026-11-06T17:00:00Z: rows=20 newest=17:03:06 ok=True; totalbet: rows=0 ok=False exit=1
```

```bash
NL=$(curl -s "https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=8793bb6a-4684-44ba-b92e-4d896e6cbfbf&category_type=sport&type=standard" | python3 -I -c 'import json,sys; print(sum(1 for e in json.load(sys.stdin)["data"]["events"] if e["type"] == "prematch" and e["status"] == "active"))') && curl -s "http://localhost:3001/api/odds?league=premier-league" | python3 -I -c '
import json, sys, math, statistics as st
from datetime import datetime, timezone
BM, N_LIST = sys.argv[1], int(sys.argv[2])
now = datetime.now(timezone.utc)
ms = [m for m in json.load(sys.stdin)["data"]["matches"] if datetime.fromisoformat(m["startTime"]) > now]
n = 0; worst = 0.0
for m in ms:
    bo = m["markets"].get("MATCH_WINNER", {}).get("bookmakerOdds", {})
    if BM not in bo: continue
    n += 1
    for s in bo[BM]["selections"]:
        peers = [p["odds"] for b, v in bo.items() if b != BM for p in v["selections"] if p.get("normalizedName") == s["normalizedName"]]
        if peers: worst = max(worst, abs(s["odds"] - st.median(peers)) / st.median(peers) * 100)
need = math.ceil(0.9 * min(len(ms), N_LIST))
ok = n >= need and worst <= 10
print(f"1X2-CHECK bookmaker={BM} matchesWith={n} future={len(ms)} listed={N_LIST} need={need} maxDevPct={worst:.1f} ok={ok}")
sys.exit(0 if ok else 1)
' totalbet "$NL"; echo "exit=$?"
# A4: ok=True, exit=0. Proven today with etoto and listed=20: matchesWith=20 future=20 need=18 maxDevPct=3.7 ok=True
```

```bash
P1=MATCH_WINNER,DOUBLE_CHANCE,HALF_TIME_DOUBLE_CHANCE,SECOND_HALF_DOUBLE_CHANCE,BTTS,HALF_TIME_BTTS,SECOND_HALF_BTTS,DRAW_NO_BET,HALF_TIME_DRAW_NO_BET,SECOND_HALF_DRAW_NO_BET,HALF_TIME_RESULT,SECOND_HALF_RESULT,ODD_EVEN_GOALS,HALF_TIME_ODD_EVEN_GOALS,SECOND_HALF_ODD_EVEN_GOALS,TOTAL_GOALS,HALF_TIME_TOTAL_GOALS,SECOND_HALF_TOTAL_GOALS,HOME_TEAM_TOTAL_GOALS,AWAY_TEAM_TOTAL_GOALS,HALF_TIME_HOME_TEAM_TOTAL_GOALS,HALF_TIME_AWAY_TEAM_TOTAL_GOALS,SECOND_HALF_HOME_TEAM_TOTAL_GOALS,SECOND_HALF_AWAY_TEAM_TOTAL_GOALS,HOME_TEAM_TO_SCORE,AWAY_TEAM_TO_SCORE,HALF_TIME_HOME_TO_SCORE,HALF_TIME_AWAY_TO_SCORE,SECOND_HALF_HOME_TO_SCORE,SECOND_HALF_AWAY_TO_SCORE,ASIAN_HANDICAP,FIRST_HALF_ASIAN_HANDICAP,SECOND_HALF_ASIAN_HANDICAP,EUROPEAN_HANDICAP,FIRST_HALF_EUROPEAN_HANDICAP,SECOND_HALF_EUROPEAN_HANDICAP,CORRECT_SCORE,HALF_TIME_CORRECT_SCORE,SECOND_HALF_CORRECT_SCORE
for pair in "Leeds%20United/Tottenham%20Hotspur" "Crystal%20Palace/Liverpool" "Manchester%20United/Aston%20Villa"; do curl -s "http://localhost:3001/api/matches/$pair/normalized-markets?league=premier-league" > /tmp/nm.json; python3 -I /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/peer-deviation.py /tmp/nm.json totalbet --codes $P1 --threshold 15; echo "exit=$?"; done
```
Expected (A5): `PEER-CHECK bookmaker=totalbet … unknown=0 … over=0` and `exit=0` for each pair. If a pair has already been played, use the next upcoming fixtures from `/api/odds`. Today etoto on the same codes gives `maxDevPct=8.9 over=0`.
- [ ] **Step 5: Save the outputs** of Steps 1–4 into `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/acceptance-$(date +%F).txt` (main checkout).
  - Commit it only if the Global Constraints Step 0 docs commit happened. The commit goes on `master` in the main checkout, touches only docs, and does not restart the server:

```bash
git -C /home/skamik/Documents/repositories/personal/aityper-scraper-api add docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/totalbet/acceptance-*.txt
git -C /home/skamik/Documents/repositories/personal/aityper-scraper-api commit -m "docs(totalbet): phase-1 live acceptance evidence"
```
  - Without Step 0, leave the file untracked next to the rest of the evidence.

---

## Self-Review

1. **Spec coverage:**
   - The root cause is fixed by Tasks 1 and 4.
   - The new shape is handled by Task 2.
   - The id collisions and the 39-code mapping are covered by Task 3.
   - League UUIDs for 5 leagues plus the World Cup are set in Task 4, and pagination in Task 1.
   - Dropping Playwright is Task 4, with test assertions.
   - Error visibility is Tasks 1 and 4: the list and HTTP errors, `Detail fetch failed k/n`, and the slug-drift `phase-1 keys missing` check.
   - Lines in `paramValue` are preserved on `OTHER` outputs (Task 3) and in the golden archive (Task 5).
   - The golden baseline is Task 5, the stop-gap is Task 0, and live acceptance A1–A8 is Task 6.
   - Phases 2 and 3 are deliberately left to separate plans (§8).
2. **Step scan:**
   - Every code step names its file, signatures and pinned values.
   - Bodies are given only for the key table (a decision) and the side, param and selection rules (not implied by the signatures).
3. **Type consistency:**
   - `FetchJson`, `TotalbetListEvent`, `TotalbetDetailEvent`, `parseEventDetail`, `resolveSide` and `europeanLineFromScore` keep the same names in Tasks 1–5.
   - `bookmakerMarketId` keys are `mid:`/`slug:` everywhere.
   - The Task 4 log formats (`Found N prematch events`, per-match `N markets (market_count M)`, `Detail fetch failed`, `phase-1 keys missing`) match A2, A6 and Task 6.
   - `PHASE1_MARKET_KEYS` (Task 4) and `TOTALBET_MARKET_KEY_TO_CODE` (Task 3) are pinned equal by a test.
   - Acceptance counts are relative to `N_list`, never to a fixed 20.
4. **Review Focus:** each of the 6 items has a named test or check in Task 1, 2, 3 or 5.
5. **Proportion:** tests carry real captured values. Implementation bodies are left to the implementer except for the decision tables and rules.
