# Betby (Betters + LeBull) Scraper Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Betters and LeBull odds by replacing the dead sbteam-SSR scrapers with one shared, browserless Betby (Sportradar UOF) client, parser and id-based normalizer, parameterized per brand. The bookmaker keys stay `betters` and `lebull`.

**Architecture:** A shared module `src/scrapers/shared/betby/` covers endpoint discovery with pinned fallback, an HTTP client for the manifest/version-chunk snapshot protocol and the per-event endpoint, and a pure parser from UOF markets to `ScrapedMarket[]`. Each brand is a thin subclass that differs only in endpoints and event-URL builder. One `createBetbyNormalizer(bookmaker)` maps UOF market ids, specifiers and outcome ids to catalog codes from a declarative rule table. Outcome ids travel in `MarketSelection.externalId`, and specifiers travel in `ScrapedMarket.paramValue`. The audit and golden harness is extended to carry `externalId` and `paramValue` through.

**Tech Stack:** TypeScript (ESM/NodeNext, `.js` import suffixes), Node 20 global `fetch` (gzip/br decoded by undici), Vitest 4, tsx. Neither brand uses Playwright anymore.

**Spec:** the "Observations (pre-fix analysis)" section of this file. Durable evidence (captured 2026-11-06 16:45–18:16 CET) lives in `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betters/` and `.../evidence/lebull/`. These directories are **untracked** in git (`git status` → `?? docs/superpowers/`), so the tasks cite them by absolute path (see Task S). The earlier read-only diagnosis (betters/lebull entry) is copied to `evidence/betters/prior-diagnosis.json`. It was re-verified here; one correction is noted under "Impact".

---

## Observations (pre-fix analysis)

### Status today (2026-11-06, dev server `tsx watch`, premier-league only, hourly schedule)

| Check | betters | lebull |
|---|---|---|
| Run 1 (16:45 CET) | `success=false, 0 matches` | `success=false, 0 matches` |
| Run 2 (17:00 CET) | `success=false, 0 matches` | `success=false, 0 matches` |
| `GET /api/odds?league=premier-league` (20 matches, 10 bookmakers present) | 0 / 20 matches | 0 / 20 matches |
| `GET /api/health` (run 2) | aggregate only: `successCount: 9, errorCount: 5`, with no bookmaker names | same |
| Live Betby offer right now (prematch snapshot) | 11 PL matches + 1 outright | 11 PL matches + 1 outright |
| Betby 1X2 vs median of the 10 other bookmakers (same 11 matches) | max deviation 4.0 % | max deviation 4.8 % |

All 11 Betby PL matches exist in our API, so team-name canonicalization works for PL (see the team table below). No stale August betters/lebull rows are surfaced by the API.

### Symptom in logs

`evidence/betters/backend-log-excerpt.txt` (ANSI stripped, line numbers from the live log):

```
92:[Betters/Navigation] Navigating to: https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485 (extended markets)
93:[LeBull/Navigation] Navigating to: https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485 (extended markets)
220:[Betters/Navigation] Capture timeout after 8000ms
221:[LeBull/Navigation] Capture timeout after 8000ms
233:[Aggregator/FullOffer] betters completed: success=false, 0 matches
235:[Aggregator/FullOffer] lebull completed: success=false, 0 matches
```

The same lines repeat at 36395–36518 for run 2. No `Navigation failed` line appears, because `page.goto` does not throw on HTTP 404.

### Root cause (re-verified)

Both brands moved their sportsbook from the sbteam "classic" SSR platform to **Betby (bettech, Sportradar UOF data)** between 2026-08-22 and 2026-11-06. The intercepted endpoint `/leagues/{id}/upcoming` and the numeric league ids no longer exist. Changing constants alone will not fix this.

| # | Evidence (command → output excerpt) | Sample |
|---|---|---|
| 1 | `curl -s -o /dev/null -w "%{http_code}" https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485` → `404`. Same `404` for `https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485`, re-checked 17:19 CET. Both hosts return 404 for every path, `/` included. | `evidence/{betters,lebull}/old-ssr-host-404.html` (nginx 404, 548 B) |
| 2 | `curl -s https://www.betters.pl/share/bootstrap` → `"sb_host":"https://betterspl-ssr.boxwebcdn.work/"` (stale), `"bettech_brand_id":"2658970707769307140"`, `"bettech_script":"https://betters.sptpub.com/bt-renderer.min.js"` | `evidence/betters/bootstrap.json` (ip redacted) |
| 3 | `curl -sL https://betters.sptpub.com/bt-renderer.min.js` → 302 to `https://start26.sptpub.com/bt-renderer.min.js` (23 784 B), which contains `n=r("https://api-h-c7818b61-608.sptpub.com")`. The betters SPA passes no `apiUrl` (its init object is `{brand_id, token, themeName, lang, target, …}`), so this constant is the API origin. | `evidence/betters/bt-renderer.head.js` |
| 4 | `curl -s https://www.lebull.pl/share/bootstrap` → `"sb_host":"https://lebull-pl-bb.boxwebcdn.work/","bettech_brand_id":null`. `curl -s https://lebull-pl-bb.boxwebcdn.work/assets/public/config.json` → `"betbyApiUrl":"https://betting-betby-secundus.prod.sbteam.xyz","betbyBrandId":"2694137186776920067"`. The lebull bundle builds `v3`/`v4`/`v5` from `betbyApiUrl`. | `evidence/lebull/bootstrap.json`, `evidence/lebull/sb-config.json` |
| 5 | Current code still navigates to the dead host and listens only for `/leagues/${leagueId}/upcoming`: `src/scrapers/bookmakers/betters/constants.ts:14` (BASE_URL), `:20-27` (numeric LEAGUE_IDS), `src/scrapers/bookmakers/betters/navigation.ts:110` (URL match), `:131-141` (navigate; 404 not detected), `:103-106` (8 s timer resolves `[]`), `src/scrapers/bookmakers/betters/index.ts:258-267` (generic "No events found from API"). LeBull: `src/scrapers/bookmakers/lebull/constants.ts:12,23-30,35-42`, `navigation.ts:121`, `:143-153`, `:113-116`, `index.ts:240-249`. | — |
| 6 | Current-code standalone smoke (the command shape the acceptance section reuses): `timeout 120 npx tsx scripts/betters-market-discovery.ts --url "https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/leeds-united-tottenham-hotspur-2725816334213586962" --league premier-league` → `[Betters/Navigation] Navigating to: https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485` … `Capture timeout after 8000ms` … `[audit-core] scrapeFullOffer(premier-league) failed or empty: No events found from API` … `[discovery] No match found`. The process then hangs until `timeout` kills it (exit 124), because the Playwright browser pool keeps it alive. | `evidence/betters/smoke-current-code.txt` |

Plain `curl` without cookies gets HTTP 200 from every Betby endpoint below, so this is not a geo or bot block.

### What still works and must not break

- The other bookmakers' runs: fortuna, superbet, lvbet, fuksiarz, forbet, etoto, betfan, sts and betclic saved in run 2. Betcris, pzbuk and totalbet are separate plans.
- Baseline before any change: `npx tsc --noEmit` is clean, and `npx vitest run` passes 65 files / 1182 tests. The golden suite is 25 tests over 12 bookmaker dirs. betters has no golden fixture. lebull has one sbteam-era fixture, which this plan retires.
- The shared audit and golden harness used by every `/audit-<bm>` skill: `scripts/harvest-fixtures.ts`, `scripts/rebless-golden.ts`, `src/services/audit/scraper-audit-core.ts`. Changes there must be passthrough only and must leave committed fixtures byte-identical. Archiving `paramValue` is a deliberate fidelity change for future archives of 5 bookmakers; Task 1 spells it out.
- Frontend contract: bookmaker keys `betters`/`lebull` at `aityper/src/lib/bookmakers.ts:15-16` (ALL_BOOKMAKER_IDS) and `:93-106` (BOOKMAKERS entries), and the union at `aityper/src/types/odds.ts:15-16`. Also `eventUrl`, selection `name` and `normalizedName` in `/api/odds` and `/normalized-markets`.
- Export names that other code imports:
  - `bettersScraper`/`lebullScraper` and the classes `BettersPlaywrightScraper`/`LebullPlaywrightScraper`: `src/scrapers/bookmakers/index.ts:11,18`, `src/scrapers/aggregator.ts:25-26,43-44`, `src/services/audit/bookmaker-registry.ts:10,13,43,46`, `scripts/test-scrapers.sh` (class names).
  - `bettersNormalizer`/`lebullNormalizer`: `src/services/normalization/bookmakers/index.ts:7,11`, `bookmaker-registry.ts:23,26`.
  - The golden lookup `${bm}Normalizer` at `src/services/normalization/__tests__/golden.test.ts:193-195`.
  - `scripts/{betters,lebull}-market-discovery.ts:14-16` and `scripts/{betters,lebull}-prep-audit.ts:17-19`.
- `src/data/market-catalog.ts` has **no** per-bookmaker id mappings; betters/lebull appear only in comments. Phase 1 needs **no catalog change** and therefore no `sync-market-types`.

### New platform: endpoints (all `lang=pl`, verified 200 on 2026-11-06)

| Purpose | betters (direct Betby) | lebull (sbteam proxy) |
|---|---|---|
| Discovery | `https://www.betters.pl/share/bootstrap` → `bettech_brand_id`, `bettech_script` → renderer → `api-h-…sptpub.com` | `https://www.lebull.pl/share/bootstrap` → `sb_host` → `${sb_host}assets/public/config.json` → `betbyApiUrl`, `betbyBrandId` |
| brandId | `2658970707769307140` | `2694137186776920067` |
| prematchBase | `https://api-h-c7818b61-608.sptpub.com/api/v4` | `https://betting-betby-secundus.prod.sbteam.xyz/v5` |
| descriptionsBase | `https://api-h-c7818b61-608.sptpub.com/api/v3` | `https://betting-betby-secundus.prod.sbteam.xyz/v4` |
| Manifest | `${prematchBase}/prematch/brand/${brandId}/pl/0` | same template |
| Snapshot chunk | `${prematchBase}/prematch/brand/${brandId}/pl/${version}` | same |
| Full event | `${prematchBase}/prematch/brand/${brandId}/event/pl/${eventId}` | same |
| Market descriptions | `${descriptionsBase}/descriptions/brand/${brandId}/markets/pl` | same |
| Event descriptions (players; phase 2) | `${descriptionsBase}/descriptions/brand/${brandId}/event/${eventId}/pl` | same |
| User-facing event URL | `https://www.betters.pl/zaklady-sportowe/soccer/${categorySlug}/${tournamentSlug}/${eventSlug}-${eventId}` (Betby route pattern `/:sportSlug/:categorySlug/:tournamentSlug/:eventSlugAndId` under the betters sportsbook route `/zaklady-sportowe*`) | `https://lebull-pl-bb.boxwebcdn.work/event/1/${categoryId}/${tournamentId}/${eventId}` (route `/event/:sportId/:countryId/:leagueId/:eventId` in the lebull bundle) |

Both event URLs were **confirmed in a headless browser** at 18:13 CET for Leeds–Tottenham (`2725816334213586962`). Each returned HTTP 200 with the final URL unchanged and rendered the Leeds United – Tottenham Hotspur event page with its 1X2/DC/Suma blocks, with no "Nie znaleziono" or 404 text. Script: `evidence/betters/eventurl-check.mjs`. Screenshots: `evidence/{betters,lebull}/eventurl-leeds-tottenham-2026-11-06.jpg`. The lebull page also lists every PL match in its sidebar, so a text match on the team names alone is weak evidence; the screenshot is the real check.

The market descriptions are **byte-identical** across brands (both 668 505 B, same sha256; see the `_note` in `evidence/*/descriptions-markets.trimmed.json`). Per-event descriptions are identical too. Odds differ per brand only on a few markets: on Leeds–Tottenham, betters 1X2 is 2.74/3.3/2.54 and lebull is 2.76/3.3/2.56, while DC/1X2 differ and every other phase-1 market was identical at capture time. They remain two separate offers.

### Runtime discovery vs hardcode (question 1)

The decision is **pinned defaults plus best-effort discovery, cached for 6 h.**
- Discovery costs two small GETs per brand per 6 h: betters bootstrap 317 B plus renderer 23 KB; lebull bootstrap 283 B plus config.json 406 B.
- On any discovery failure (HTTP error, missing field, regex miss), the client uses the pinned endpoints and logs `[Betby/<Tag>] endpoint discovery failed: <reason>; using pinned <prematchBase>`.
- If discovery succeeds but differs from the pinned value, it logs `endpoint drift` once, so the pinned constant can be updated.
- Reason: the lebull `sb_host` already changed once (`lebullpl-ssr` → `lebull-pl-bb`), and the `bootstrap` reflected the change. The betters `api-h-<hash>-<n>` host looks rotatable.
- betters' `bootstrap.sb_host` is stale and must be ignored.

### Snapshot protocol (question 2)

- **Manifest** `…/pl/0` returns `{epoch, version, top_events_versions:[v], rest_events_versions:[v+1…v+6], generated}`. Examples: betters `version 1793982002415`, lebull `1793981968429`.
- **Chunks** form a linked list. Each chunk's `version` is the *next* chunk's version, and the last chunk has `snapshot_complete: true` and `version` set to a delta version (e.g. `3587963017057`). Each chunk carries up to 400 `events`, plus `sports`, `categories` and `tournaments` for those events.
- **The snapshot rotates about every 60 s** (betters `1793981941980` → `1793982002415`). My first sequential fetch (0.5 s gaps, one 1.17 s response) got chunks `…985`/`…986` back as `{"epoch":…,"version":0,"generated":…,"status":{…}}`, with no `events` at all (`evidence/betters/chunk-rotated-1793981941985.json`). A parallel refetch immediately after a fresh manifest returned 7 valid chunks. Rule: fetch all chunks **in parallel right after the manifest**, validate the chain, and retry once with a fresh manifest.
- **Only some tournaments?** Not possible with the observed API. Neither SPA calls any tournament endpoint: the network logs show only `/pl/{version}` chunk calls. Chunks are priority-ordered pages:
  - Chunk 0 holds featured events across tournaments.
  - Today PL, LaLiga, Serie A and Ligue 1 sit in chunk 1.
  - Ekstraklasa straddles chunks 0, 1 and 2 (see `evidence/betters/snapshot-target-tournaments.txt`).

  Fetching everything costs 557 KB on the wire for betters and 570 KB for lebull (about 3.1 MB decoded), at about 0.1 s per chunk in parallel. The decision is to fetch all chunks once per run per brand and cache them for 45 s (shorter than the rotation period), so several leagues reuse the same snapshot. An early-stop heuristic is rejected: it is fragile and saves at most about 40 %.
- **Listing chunks carry only markets 1, 10, 16 and 18.** Full markets come from the event endpoint: 161 market ids, 547–579 (market, specifier) pairs, about 16–18 KB on the wire and about 120 KB decoded per event.
- Delta polling (the 3587… versions) and the WebSocket (`wss://api1-ws.sptpub.com/api/v1`) are not needed for prematch polling.

### Data shape

```
envelope: { epoch, version, generated, snapshot_complete, fixtures_complete, status{…}, sports, categories, tournaments, events }
events[eventId: 19-digit string] = {
  desc: { scheduled: <unix seconds>, type: "match"|"tournament"|"stage", slug, sport: "1", category, tournament,
          competitors: [{ id, name, abbreviation }, { … }], player_props, bet_builder },
  markets: { [marketId]: { [specifier]: { [outcomeId]: { k: "<odds string>", b?: 1 } } } },
  state: { provider, status: 0, match_status: 0 } }
descriptions[marketId] = { id, name: "<pl template>", specifiers?: [...], market_type?, variants: { "" | "variant=…": [{ outcomes: [{ id, name }] }] } }
```

- **Specifier strings:**
  - `""`, `total=2.5`, `total=3` (integer, i.e. push-able).
  - `hcp=-1.5`, `hcp=-1.0` / `hcp=1` (inconsistent integer formatting), `hcp=1:0` (European handicap).
  - `goalnr=1`, `goalnr=1|type=general`.
  - `variant=sr:goal_range:7+`, `from=0:00|to=15:00|total=0.5`, `variant=dst:playerprops:…` (player props).
- **Template tokens:** `{$competitor1}`, `{$competitor2}`, `{total}`, `{hcp}`, `{+hcp}`, `{-hcp}`, `{goalnr}`, `{!cardnr}` (ordinal), `{from}`, `{to}`.
- **Blocked outcomes** look like `{"k":"0.0","b":1}`. Leeds–Tottenham has 5 non-quotable outcomes: market 45 ids `382`, `322`; market 81 ids `488`, `506`; market 50066 `bb:exact_goals:6`.
- **IDs:** brand, category, tournament and event ids are 19-digit strings, above `2^53`. JSON keeps them as strings, but `Number("2725816334213586962")` gives `2725816334213587000`. They must never be converted to numbers. Manifest and chunk versions are 13-digit numbers and safe as numbers.

Tournament ids are identical on both brands (Betby is global) and verified in both fresh snapshots:

| League slug | Betby tournament id | Category id (slug) | Today: `type=match` / outright | Chunks |
|---|---|---|---|---|
| ekstraklasa | `1669818868635406336` | `1669818868555714560` (poland) | 9 / 1 | 0,1,2 |
| premier-league | `1669818860469096448` | `1669818860410376192` (england) | 11 / 1 | 1 |
| laliga | `1669819032615915520` | `1669817290067152896` (spain) | 10 / 1 | 1 |
| serie-a | `1669819042829045760` | `1669819042774519808` (italy) | 10 / 1 | 1 |
| ligue-1 | `1669818844560101376` | `1669818844505575424` (france) | 9 / 1 | 1 |
| world-cup-2026 | **none**: Betby lists only the *next* edition, tournament `1670073988614852608` ("Mistrzostwa Świata", slug `world-cup`). Its only event is the outright `2716754885658947592`, scheduled 2030-07-21. The 2026 tournament ended in July. Mapping this id would file 2030 matches under `world-cup-2026`, so betters/lebull stay unmapped. | `1669818805871841280` | 0 / 1 | 1 |

**Team names (question 6)** use Betby's international forms with suffixes and trailing spaces:
- Trailing spaces: `"Tottenham Hotspur "`, `"Manchester City "`, `"Newcastle United "`, `"Crystal Palace "`, `"Brighton & Hove Albion "`, `"AS Monaco "`.
- Suffixes and prefixes: `"Everton FC"`, `"FC Sunderland"`.
- Polish exonyms: `"Inter Mediolan"`, `"Atletico Madryt"`.

`getCanonicalTeamName(name.trim(), league)` maps **all 20 PL names correctly** (`evidence/betters/team-matcher-betby-names.txt`). Pre-existing gaps outside PL (not enabled today, so out of scope; the fix belongs to the team-matcher):
- `"Wisła Kraków"` → `"Cracovia Krakow"` (**wrong**, a fuzzy match).
- `"Paris Saint-Germain FC"`, `"FC Malaga"`, `"Le Mans FC"`, `"Troyes AC"`, `"Frosinone Calcio"`, `"Deportivo A Coruna"`, `"Racing Santander"` and `"Wieczysta Krakow"` pass through unmapped.

**Outrights and live (question 6):** keep `desc.type === "match"` and `desc.sport === "1"`. The PL outright `2697520988786135084` (`type: "tournament"`, markets `2000000…`) must be excluded. Use the prematch snapshot only, and drop events with `scheduled * 1000 <= now`. The live snapshot `/live/brand/{brand}/pl/{v}` exists but is ignored.

**Missing or withdrawn event.** This happens when an event goes live or is withdrawn after the snapshot. The event endpoint does **not** return 404 for it. A live probe at 18:12 CET used the non-existent id `2725815896848338000`:
- `curl -s -w "%{http_code}" …/api/v4/prematch/brand/2658970707769307140/event/pl/2725815896848338000` → `200`.
- The same request on lebull (`…/v5/…`) → `200`.
- Both bodies are an envelope with keys `epoch, fixtures_complete:false, generated, snapshot_complete:false, status, strict_providers, version:0` and **no `events` key** (`evidence/{betters,lebull}/event-missing-envelope.json`).

`fetchEvent` therefore returns `null` both when `events` is absent and when `events[eventId]` is absent. It also returns `null` on HTTP 404, which was never observed but stays handled. In every case that match falls back to its listing markets. Reading `body.events[eventId]` without checking `events` first would throw a TypeError.

**Far-future events carry a thin market list.** Liverpool–Man Utd (`2725446939305979931`, scheduled 2026-11-22, 16 days out) returns a full event payload (HTTP 200). It holds only 11 market ids (`1,10,16,18,19,20,29,60,63,66,68`) and 39 pairs, which gives 34 phase-1 markets. The 10 matches on 6–8 Nov hold 140–170 ids and give 66–73 (`evidence/betters/phase1-counts-pl-2026-11-06.txt`, computed by `evidence/betters/phase1_count.py`; the thin payload is `evidence/betters/event-2725446939305979931.json`). Depth gates therefore apply only to matches within 7 days (A2).

### UOF market inventory → our catalog (question 3)

The inventory covers 3 PL events × 2 brands: Leeds–Tottenham `2725816334213586962`, Arsenal–Hull `2725816334213586981` and Man Utd–Aston Villa `2726177353700085769`. There are 161 distinct market ids, and the same ids appear on both brands. Full dump: `evidence/betters/uof-inventory-3-pl-events.txt`.

Outcome-id groups shared across markets:
- `1/2/3` = home/draw/away; `4/5` = competitor1/competitor2.
- `9/10/11` = 1X/12/X2; `12/13` = over/under; `74/76` = yes/no.
- `1714/1715` = handicap home/away. `hcp` is quoted from the home side: 1714 is `{$competitor1} ({+hcp})` and 1715 is `{$competitor2} ({-hcp})`.
- `1711/1712/1713` = European handicap home/draw/away.
- `70/72` = odd/even; `6/7/8` = home/none/away (races).

**Phase 1 — exact mappings (36 market ids, all to existing catalog codes):**

| UOF id | Betby name (pl) | Specifier rule | Outcome id → selection | Our code / paramValue |
|---|---|---|---|---|
| 1 | 1x2 | — | 1 HOME, 2 DRAW, 3 AWAY | MATCH_WINNER |
| 10 | Podwójna szansa | — | 9 HOME_OR_DRAW, 10 HOME_OR_AWAY, 11 DRAW_OR_AWAY | DOUBLE_CHANCE |
| 11 | Zakład bez remisu | — | 4 HOME, 5 AWAY | DRAW_NO_BET |
| 18 | Suma | `total`: half line / integer or quarter | 12 OVER, 13 UNDER | TOTAL_GOALS `"2.5"` / TOTAL_GOALS_ASIAN `"3"`, `"2.75"` |
| 68 | 1. połowa - suma | same | same | HALF_TIME_TOTAL_GOALS / HALF_TIME_TOTAL_GOALS_ASIAN |
| 90 | 2. połowa - suma | same | same | SECOND_HALF_TOTAL_GOALS / SECOND_HALF_TOTAL_GOALS_ASIAN |
| 19 / 20 | {$competitor1/2} - suma | `total`, half lines only (integer → skip) | 12 OVER, 13 UNDER | HOME_TEAM_TOTAL_GOALS / AWAY_TEAM_TOTAL_GOALS `"1.5"` |
| 16 | Handicap | `hcp`: half and integer lines → one code (decision D1); quarter → skip | 1714 HOME, 1715 AWAY | ASIAN_HANDICAP `"-1.5"`,`"+1.5"`,`"-1"`,`"0"`,`"+1"` (default D1) |
| 66 | 1. połowa - handicap | same | same | FIRST_HALF_ASIAN_HANDICAP `"0"`, … (default D1) |
| 14 | Handicap europejski {hcp} | `hcp=a:b` → signed(a−b); a==b → skip | 1711 HOME, 1712 DRAW, 1713 AWAY | EUROPEAN_HANDICAP `"+1"` (1:0), `"-1"` (0:1) |
| 65 | 1. połowa – handicap europejski {hcp} | same | same | FIRST_HALF_EUROPEAN_HANDICAP |
| 29 / 75 / 95 | Obie drużyny strzelą gola (full / 1st half / 2nd half) | — | 74 YES, 76 NO | BTTS / HALF_TIME_BTTS / SECOND_HALF_BTTS |
| 60 / 83 | 1./2. połowa - 1x2 | — | 1/2/3 | HALF_TIME_RESULT / SECOND_HALF_RESULT |
| 63 / 85 | 1./2. połowa - podwójna szansa | — | 9/10/11 | HALF_TIME_DOUBLE_CHANCE / SECOND_HALF_DOUBLE_CHANCE |
| 64 | 1. połowa - zakład bez remisu | — | 4 HOME, 5 AWAY | HALF_TIME_DRAW_NO_BET |
| 26 | Parzyste/nieparzyste | — | 70 ODD, 72 EVEN | ODD_EVEN_GOALS |
| 45 / 81 | Dokładny wynik / 1. połowa - dokładny wynik | — | name `h:a` → `"h-a"`, name `inny` → `"OTHER"` | CORRECT_SCORE / HALF_TIME_CORRECT_SCORE |
| 47 | Do przerwy / koniec meczu | — | 418 HOME_HOME, 420 HOME_DRAW, 422 HOME_AWAY, 424 DRAW_HOME, 426 DRAW_DRAW, 428 DRAW_AWAY, 430 AWAY_HOME, 432 AWAY_DRAW, 434 AWAY_AWAY | HALFTIME_FULLTIME |
| 35 | 1x2 i obie drużyny strzelą gola | — | 78 HOME_YES, 80 HOME_NO, 82 DRAW_YES, 84 DRAW_NO, 86 AWAY_YES, 88 AWAY_NO | RESULT_AND_BTTS |
| 37 | 1x2 i suma | `total`, half lines only | 794 HOME_UNDER, 796 HOME_OVER, 798 DRAW_UNDER, 800 DRAW_OVER, 802 AWAY_UNDER, 804 AWAY_OVER | RESULT_AND_TOTAL `"2.5"` |
| 36 | Suma i obie drużyny strzelą gola | `total`, half lines only | 90 OVER_YES, 92 UNDER_YES, 94 OVER_NO, 96 UNDER_NO | TOTAL_GOALS_AND_BTTS `"2.5"` |
| 546 | Podwójna szansa i obie drużyny strzelą gola | — | 1718 1X_YES, 1719 1X_NO, 1720 12_YES, 1721 12_NO, 1722 X2_YES, 1723 X2_NO | DOUBLE_CHANCE_BTTS |
| 547 | Podwójna szansa i suma | `total`, half lines only | 1724 1X_UNDER, 1725 12_UNDER, 1726 X2_UNDER, 1727 1X_OVER, 1728 12_OVER, 1729 X2_OVER | DOUBLE_CHANCE_TOTAL `"2.5"` |
| 560 / 561 | {$competitor1/2} strzeli gola | — | 74 YES, 76 NO | HOME_TEAM_TO_SCORE / AWAY_TEAM_TO_SCORE |
| 8 | {goalnr}. gol | `goalnr=1` only | 6 HOME, 7 NONE, 8 AWAY | FIRST_TEAM_TO_SCORE |
| 13670 | Ostatnia drużyna, która strzeli gola | — | 6 HOME, 7 NONE, 8 AWAY | LAST_TEAM_TO_SCORE |
| 52 | Połowa z większą liczbą goli | — | 436 1ST_HALF, 438 2ND_HALF, 440 DRAW | HALF_WITH_MORE_GOALS |
| 25 | Przedział goli | `variant=sr:goal_range:7+` | name leading token: `0-1 goli`→`0-1`, `2-3 gole`→`2-3`, `4-6 goli`→`4-6`, `7+ goli`→`7+` | GOAL_RANGE |
| 50063 | Dokładna liczba goli | — | `bb:exact_goals:N` → `"N"` (catalog has 0–9) | EXACT_GOALS |

On Leeds–Tottenham this yields **68 normalized market instances with 68 distinct marketKeys** (simulated on the evidence). The keys are `TOTAL_GOALS:0.5…4.5` (5), `TOTAL_GOALS_ASIAN:1…4` (4), `ASIAN_HANDICAP:-1.5/+1.5/-1/0/+1` (5; Betby sends `hcp=-1.0`, `hcp=0`, `hcp=1`), `FIRST_HALF_ASIAN_HANDICAP:0`, `EUROPEAN_HANDICAP:+1/+2/-1`, and so on. The other two evidence events yield 71 and 66. Under the PUSH alternative of D1 the count stays 68; only 4 keys change code.

**Decision D1, taken by the owner before Task 5: the code for integer handicap lines.** The blessed goldens disagree with the catalog wording.
- The catalog describes ASIAN_HANDICAP as `"Handicap (linie połówkowe)"` (`src/data/market-catalog.ts:706-711`). ASIAN_HANDICAP_PUSH, the code for handicaps where an exact result refunds the stake, is at `:723-728`.
- In practice, fortuna, etoto, betfan, fuksiarz, lvbet and the retired lebull normalizer all label integer lines `ASIAN_HANDICAP` (e.g. fortuna `ASIAN_HANDICAP:-1`/`:0`, betfan `:+0`, lvbet `:0.0`, FH lvbet `FIRST_HALF_ASIAN_HANDICAP:-1`). **Only sts** uses `ASIAN_HANDICAP_PUSH` (`:+0/-1/-2`).
- The audit ledger already holds a fingerprint `HANDICAP/ASIAN_HANDICAP_PUSH` whose diagnosis reads "genuine full-match coverage collapses to STS alone … Best-odds comparison for this market is currently illusory" (frontend `docs/audit-ledger/registry.json:17266`).
- **Default (used by Tasks 5 and 7 unless the owner picks PUSH):** route integer lines to ASIAN_HANDICAP / FIRST_HALF_ASIAN_HANDICAP with params `"-1"`, `"0"`, `"+1"` (the fortuna/etoto/old-lebull format). Betby then pools with the 5 other bookmakers that quote integer lines (fortuna, etoto, betfan, fuksiarz, lvbet), as old lebull did.
- **PUSH alternative:** ASIAN_HANDICAP_PUSH / FIRST_HALF_ASIAN_HANDICAP_PUSH. This is semantically exact but pools with sts alone. With PUSH: make zero `"+0"` (the sts spelling) in `formatSignedLine` and its Task 4 test, flip the three integer expectations in Task 5, and expect the 4 PUSH keys in the Task 7 spot-check.
- The zero spelling does not affect pooling on `/normalized-markets`. `canonicalizeParamValue` folds `"+0"`, `"0"` and `"0.0"` to `"0"` (`src/services/market-type-grouper.ts:79-94`). `/api/odds`, however, groups rows by raw `market_key` (`src/services/odds-service.ts:148`), so the plan picks the majority spelling `"0"`.

**Phase 2 — candidates (an existing code fits; needs its own tests or a semantic check):**

| UOF id(s) | Suggested code | Caveat |
|---|---|---|
| 33/34, 18304 | HOME_WIN_TO_NIL / AWAY_WIN_TO_NIL; WIN_TO_NIL (HOME/AWAY) | 18304 is a 2-way team pick |
| 50059, 50165 | CLEAN_SHEET (HOME/AWAY); 1st-half variant has no code | 31/32 (YES/NO per team) have no code |
| 48/49, 50/51 | HOME/AWAY_WIN_BOTH_HALVES, HOME/AWAY_WIN_AT_LEAST_ONE_HALF | straight YES/NO |
| 56/57, 13667 | HOME/AWAY_SCORE_BOTH_HALVES; TEAM_SCORES_BOTH_HALVES (HOME/AWAY) | 13667 semantics inferred from its outcomes (4/5 = teams); verify on site |
| 562, 18303, 50305, 50306, 146 | BTTS_BOTH_HALVES, BTTS_2PLUS_GOALS, PENALTY_AWARDED, OWN_GOAL, RED_CARD | YES/NO |
| 50166/50167, 69/70, 91 | HALF_TIME_HOME/AWAY_TO_SCORE, HALF_TIME_HOME/AWAY_TEAM_TOTAL_GOALS, SECOND_HALF_HOME_TEAM_TOTAL_GOALS | half lines only |
| 27/28, 74 | HOME/AWAY_TEAM_ODD_EVEN_GOALS, HALF_TIME_ODD_EVEN_GOALS | — |
| 50064/50065, 50066 | HOME/AWAY_EXACT_GOALS, HALF_TIME_EXACT_GOALS | Betby open counts vs catalog `3+`/`4+` buckets: only exact members pool |
| 399/400, 635 | HOME/AWAY_GOAL_RANGE, HALF_TIME_GOAL_RANGE | vocabulary partly overlaps |
| 101 (`goalnr=1`) | FIRST_GOAL_TIME (598 `1-10` … 614 `81-90`, 616 NONE) | 18307 (30-min) has no code |
| 50001, 50003 | TIME_PERIOD_RESULT `"15"`, TIME_PERIOD_TOTAL_GOALS `"15:0.5"` (fuksiarz/superbet format) | keep the lebull rule "drop when window unparsable" |
| 50060 | RESULT_AND_FIRST_GOAL | outcome ids 1482–1487, 1716 |
| 166, 177, 165, 176, 162, 173, 172, 183, 167/168, 170/171 | CORNERS_TOTAL, HALF_TIME_CORNERS_TOTAL, CORNERS_HANDICAP, HALF_TIME_CORNERS_HANDICAP, CORNERS_RACE, HALF_TIME_CORNERS_RACE, CORNERS_ODD_EVEN, HALF_TIME_CORNERS_ODD_EVEN, CORNERS_TEAM, CORNERS_TEAM_RANGE | team-param shape check |
| 139, 152, 140/141, 136, 137 (`bookingnr=1`) | CARDS_TOTAL, HALF_TIME_CARDS_TOTAL, CARDS_TEAM, CARDS_RACE, FIRST_CARD | check booking-count rule vs peers |
| 50237, 50242, 50238/50239, 50243/50244, 50236, 50256, 50258 | TOTAL_SHOTS_ON_TARGET, TOTAL_SHOTS, TEAM_TOTAL_SHOTS_ON_TARGET, TEAM_TOTAL_SHOTS, MOST_SHOTS_ON_TARGET, OFFSIDES_TOTAL, HOME_TEAM_TOTAL_OFFSIDES | — |
| 40 (`type=general`), 38 (`goalnr=1\|type=general`), 39 | GOALSCORER_ANYTIME / GOALSCORER_FIRST / GOALSCORER_LAST | outcome = player id (`ab:player:…`); names come from event descriptions (+1 request per event); reuse `canonicalizePlayerName`; `1716` = `bez gola` |
| 150122, 150123, 50032, 50033 | PLAYER_CARDS, PLAYER_RED_CARD, PLAYER_SHOTS, PLAYER_SHOTS_ON_TARGET | player props with `variant=dst:playerprops:…` lines |

**Unmappable without a catalog addition (stay OTHER and hidden):**
- 12/13 (`{$competitor} bez zakładu`).
- 31/32, 76/77, 50169/50170, 618/619, 636/637, 50067/50068, 178/179, 18300/18301.
- 13611/13612 (win from behind), 881 (any team wins), 50007, 13672, 13668/13669 (team-pick shapes), 18302, 18307, 142/155 (vocabulary mismatch), 50002 (time-window handicap), 50804/50805.
- Player combos and accumulators 50212/50213/50266/50267/50268/50296/50807/50808/898/899/770/50031/50034/50035/50036.

**Parser emission policy:**
- Emit every (market, specifier) pair except player and accumulator pairs. A pair is excluded when the specifier contains `variant=dst:`, or when any outcome id contains `:player:` or starts with `dst:`. Leeds–Tottenham: 560 pairs → 318 excluded → **242 emitted, 699 selections**. Arsenal–Hull: 238 emitted; Man Utd–Villa: 220.
- Unmapped pairs become hidden OTHER rows, so audit tooling can still see the coverage gaps.

### Impact on parser / normalizer / catalog / golden fixtures / prior audit knowledge (questions 4, 7)

- **Parser:** complete rewrite. The sbteam `stakeTypes[]` shape is gone. The shared Betby parser replaces `betters/parser.ts` (389 lines) and `lebull/parser.ts` (536 lines).
- **Normalizer:** complete rewrite. `betters-normalizer.ts` (787 lines) and `lebull-normalizer.ts` (1508 lines) are keyed on sbteam stake-type ids, e.g. `BETTERS_MARKET_ID_TO_CODE` at `betters-normalizer.ts:27-…` with 274556, 332819, 40424, 5774433…. None of those ids exist on Betby. One id-table normalizer with brand-specific instances replaces both.
- **Correction of the earlier diagnosis:** the catalog is *not* keyed on bookmaker ids. Phase 1 changes nothing in `market-catalog.ts`.
- **Selection identity:** the facade passes `market.selections` (including `externalId`) to the normalizer (`src/services/normalization/factory.ts:255-258`). But the golden, audit and harvest harness strips everything except `{name, odds}`:
  - `golden.test.ts:86-94`
  - `scripts/rebless-golden.ts:57-65`
  - `scripts/harvest-fixtures.ts:133-141`
  - `scraper-audit-core.ts:169-177`, `:238-245`, `:450-458`

  The prep archive block at `scraper-audit-core.ts:368-376` also drops `paramValue`, which the comment at `harvest-fixtures.ts:63` acknowledges. Task 1 adds the passthrough, writing each key only when it is set.
- **Numeric id conversion:** `factory.ts:275-284` converts fully numeric `bookmakerMarketId` to `Number`. That is safe for UOF market ids (max 150123), but it is the reason why no 19-digit id may ever be put into `bookmakerMarketId`.
- **Golden fixtures:**
  - lebull's only fixture `src/services/normalization/__fixtures__/lebull/world-cup-2026_france_morocco.{json,expected.json}` (251 entries, 116 blessed, sbteam ids) will diverge under the new normalizer and is retired.
  - An empty fixture dir fails `golden.test.ts:176-181`, so the dir must be removed until the new pair lands.
  - New pairs: `__fixtures__/{betters,lebull}/premier-league_leeds-united_tottenham-hotspur.*` (Task 7).
  - The harvester's defaults are stale since the repo split (`harvest-fixtures.ts:193`, `:224-225`), so pass `--out-dir` and `--registry` explicitly.
- **Prior audit knowledge (git log 2026-06-26 → 2026-08-20, e.g. `b606e25`, `93dcc28`, `abc84ea`, `c9dc637`, `508b0c3`):**

| Knowledge | Fate on Betby |
|---|---|
| Odds floor `>= 1.01` inclusive (b606e25: a strict `>` dropped legit 1.01 legs) | **Carry over** (`MIN_VALID_ODDS = 1.01`, inclusive), plus skip `b: 1` |
| Param formats that pool across bookmakers (TOTAL_GOALS `"2.5"`, *_ASIAN integers/quarters, AH half lines `"-1.5"`, EH `"+1"`) | **Carry over** (blessed goldens of etoto/forbet/fortuna/lvbet/sts/betfan). Integer AH lines are **not** uniform. fortuna/etoto/betfan/fuksiarz/lvbet/old-lebull use ASIAN_HANDICAP (`"-1"`, `"0"`; betfan `"+0"`, lvbet `"0.0"`); sts alone uses ASIAN_HANDICAP_PUSH (`"+0"`). See decision D1 |
| "Gol w 1. połowie" folded onto HALF_TIME_TOTAL_GOALS:0.5 | Native on Betby (market 68 `total=0.5`) |
| sbteam per-team handicap regrouping (away stake quoted on its own line) | Not applicable: UOF `hcp` is home-perspective; keep the sign |
| `collapseBothHalvesOverGoalsZeroFive`, TOTAL_GOALS_3WAY bundle drop, HT/FT mislabeled-duplicate drop, Multiwynik combo collision, kolejny-gol tranche slicing | Not applicable (UOF splits per specifier and keys outcomes by id) |
| Time-period markets dropped when the window is unparsable | Carry into phase-2 rules for 50001/50003 |
| Player-name canonicalization (`canonicalizePlayerName`, `helpers/index.ts:450`) | Reuse in phase 2 goalscorers |
| Team aliases (incl. `"Bosnia and Herzegovina"` for English-name feeds, `team-matcher.ts:514`) | Still used through `getCanonicalTeamName`; 20/20 PL OK |
| 787 + 1508 lines of sbteam-id routing, lebull golden, 21 open + 8 accepted-difference lebull ledger entries, lebull `coverage.json` baseline (frontend `docs/audit-ledger/`), the frontend audit agents/commands that tell fixers to edit `BETTERS_MARKET_ID_TO_CODE`/`LEBULL_MARKET_ID_TO_CODE` | **Lost/obsolete**. Handled by the owner-gated Task 9 after go-live. `scripts/build-coverage-baseline.ts` is a monotonic union (`:11`, `:69-77`) that re-reads every directory under `raw-archive/` (`:93-97`), so a rebuild alone would restore the sbteam lebull coverage |

### Risks & unknowns

- The `api-h-<hash>-<n>.sptpub.com` host may rotate. Discovery mitigates this, and the pinned fallback keeps working only while the old host lives.
- Snapshot rotation (about 60 s) can race slow networks. The 2-attempt retry may still fail on a very slow link; the error says so explicitly.
- `state.status` and `match_status` semantics are unknown (all observed values are 0), so only `scheduled` is filtered.
- Rate limits are unknown. Load per brand per run: 1 manifest, 7 chunks, about 11–12 events, plus descriptions and discovery every 6 h, about 20 requests per hour per brand.
- Both deep-link formats were confirmed for one event only (Leeds–Tottenham, 18:13 CET). Task 8 re-checks them on the implemented `eventUrl` values.
- The two brands quote near-identical prices on most markets. Cross-bookmaker medians (odds-outliers, EV) will weight the same Sportradar price twice.
- Integer ASIAN_HANDICAP lines are inconsistent across existing bookmakers. fortuna/etoto/betfan/fuksiarz/lvbet/old-lebull put them under ASIAN_HANDICAP; sts alone uses ASIAN_HANDICAP_PUSH. The catalog label says ASIAN_HANDICAP is for half lines. Betby follows the majority by default (D1), so it inherits that mislabel; the PUSH alternative is exact but pools with sts only.
- Far-future events carry a thin market list. Liverpool–Man Utd, 16 days out, has 39 pairs and 34 normalized markets; the matches on 6–8 Nov have 524–579 pairs and 66–73 normalized. The A2 gate excludes matches more than 7 days out; they are reported as `shallow`.
- Non-PL team-name gaps listed above, e.g. `Wisła Kraków` → `Cracovia Krakow`.

### Open questions for the owner

1. Apply the stop-gap (Task 0: remove both from `CONFIG.BOOKMAKERS`) now, or wait for the migration?
2. LeBull eventUrl: keep the iframe host `lebull-pl-bb.boxwebcdn.work/event/…` (it renders the event page; see the screenshot), the same convention as the old `lebullpl-ssr` host, or find a `www.lebull.pl` deep link?
3. Accept phase 1 = 36 market ids (about 66–73 normalized markets per near-term PL match) for go-live, with phase 2 (goalscorers, corners, cards, team props) as a follow-up plan?
4. Run Task 9 (frontend ledger, coverage and audit tooling) after go-live?
5. Is the double weighting of near-identical betters/lebull prices in medians acceptable?
6. **Decision D1, needed before Task 5:** integer handicap lines go to ASIAN_HANDICAP (default; pools with 5 other bookmakers) or to ASIAN_HANDICAP_PUSH (exact; pools with sts only)? A catalog-wide unification of the other bookmakers remains a separate task either way.

### Other Polish brands on Betby? (note only)

A cheap check: GET each scraped brand's homepage plus `/share/bootstrap`, grepping for `sptpub|betby|bt-renderer|bettech|sbteam`. No hits for sts, efortuna, betclic, superbet, lvbet, fuksiarz, betfan, totalbet, etoto, betcris or pzbuk. Their `/share/bootstrap` returns the SPA HTML or 301/404, not sbteam JSON; forbet timed out. Only betters and lebull are Betby-based. The shared module accepts a new brand with a `BetbyBrandConfig` entry and a thin subclass.

### Acceptance criteria

Live and measurable after Task 8. The 2026-11-06 values are in parentheses.

| # | Criterion | Command | Pass when |
|---|---|---|---|
| A1 | Match coverage | `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 180 npx tsx scripts/betby-smoke.ts --bookmaker betters --league premier-league --max-days 7` (and `--bookmaker lebull`) | `matches` equals `snapshot`, the upcoming `type=match` count of the same snapshot (11). This catches dropped matches; there is no fixed minimum. `snapshot=0` (off-season) prints `RESULT=SKIP` and exits 0 |
| A2 | Market depth | same | every match scheduled within 7 days of the run (`--max-days 7`) that has a full event payload has ≥ 50 normalized non-OTHER markets (live 2026-11-06: 66–73 over the 10 matches on 6–8 Nov). Matches further out are reported as `shallow` and do not gate (Liverpool–Man Utd on 2026-11-22: 34). Listing-only fallbacks among those 7-day matches ≤ 1 (0) |
| A3 | Selection integrity | same | 0 selections with code `UNKNOWN` inside non-OTHER markets; 0 selections with odds < 1.01 |
| A4 | Price sanity | same, plus `--compare-api http://localhost:3001` | every Betby MATCH_WINNER selection has `dev = \|odds / median − 1\| ≤ 0.10`, where the median is over ≥ 3 *other* bookmakers for the same match and selection (fewer peers → `dev=n/a`, not gated). On 2026-11-06 the max was 4.0 % for betters and 4.8 % for lebull (`evidence/betters/1x2-vs-other-bookmakers-median.txt` uses the same formula, e.g. 2.74 vs 2.8 → 2.1 %) |
| A5 | Team canonicalization | same, plus `--compare-api` | every Betby match is found in `/api/odds?league=premier-league` by canonical home/away (11/11) |
| A6 | Persistence | **only after** the branch is merged into the main checkout and the owner has restarted `npm run dev` (Task 8 Step 9): `curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3001/api/admin/scrape -H "Authorization: Bearer ${ADMIN_API_KEY:-dev-api-key}" -H "Content-Type: application/json" -d '{"league":"premier-league","bookmakers":["betters","lebull"]}'`, then the dev log | the POST returns `HTTP 202` with `{"success":true,"data":{…,"status":"started",…}}` (`src/routes/admin.ts:72-77`; `.env` has no `ADMIN_API_KEY`, so the server uses `"dev-api-key"`, `src/config/index.ts:36`). The log shows `[Aggregator/FullOffer] betters completed: <n> matches, <N> markets saved` (`src/scrapers/aggregator.ts:263`) with n = the smoke's `snapshot` and N ≥ 500, and the same for lebull. `GET /api/odds?league=premier-league` lists `betters` and `lebull` under MATCH_WINNER for ≥ n − 1 matches |
| A7 | Odds integrity | `npx tsx scripts/odds-outliers.ts --league premier-league --all-matches --quiet --out /tmp/outliers.json; echo "exit=$?"`, then `python3 -I -c "import json;r=json.load(open('/tmp/outliers.json'));print(sum(1 for m in r['matches'] for f in m['findings'] if f['bookmaker'] in ('betters','lebull') and f['severity'] in ('MAJOR','BROKEN')))"` | the script prints `exit=0` (no `--fail-on`, so other bookmakers' findings do not count); the python line prints `0`. Today the script dies with `exit=2` (`[odds-outliers] fatal: Could not list matches from the API`). `listMatches` calls `GET /api/odds/match?league=…` (`scripts/odds-outliers.ts:536-549`), which answers 400 `Missing required parameters: home, away`. Task 8 fixes this |
| A8 | Cost | smoke output `durationMs` | < 15 000 ms per brand (no browser) |

The standalone single-bookmaker smoke test has two forms. Neither touches the database.

1. **New (Task 8):** `timeout 180 npx tsx scripts/betby-smoke.ts --bookmaker <betters|lebull> --league premier-league --max-days 7 [--compare-api http://localhost:3001]`. It prints `SMOKE <bm> premier-league: matches=… RESULT=PASS|FAIL|SKIP`. It exits 0 on PASS or SKIP and 1 on FAIL.
2. **Existing, works today:** `timeout 180 npx tsx scripts/<betters|lebull>-market-discovery.ts --url "<event url containing the 19-digit event id>" --league premier-league`. Matching works by the last run of ≥ 4 digits in the URL (`scraper-audit-core.ts:66-69`). The command shape was proven on the current code (evidence row 6). Post-fix, expect `🏆 MATCH: <home> vs <away> (premier-league)` and, for a match within 7 days, `✅ Mapped: ≥ 50`.

---

## Global Constraints

- Commit messages are concise, with **no signature or attribution footers**: no `Co-Authored-By`, no "Generated with …". The user's CLAUDE.md rule overrides any harness reminder. Commit only when the owner has asked for commits in the executing session (repo CLAUDE.md).
- Code and comments are in English only. This backend has no UI text.
- Before every commit run `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` (expected: no output) and `npx vitest run` (expected: all files pass; baseline 65 files / 1182 tests before Task 1). Inside the worktree, run the same two commands from the worktree root (`cd $WT`). `tsc` excludes `__tests__` and `scripts/`, so every task that edits a script must also run that script once.
- Golden-fixture discipline:
  - For a fix, write the failing fixture or test first.
  - Rebless only after inspecting the diff: `npx tsx scripts/rebless-golden.ts --bookmaker <bm> --dry`, then without `--dry`.
  - Create new pairs only with `scripts/harvest-fixtures.ts --bookmaker <bm> --out-dir src/services/normalization/__fixtures__ --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json`.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan does not change the catalog, so do not run it.
- Editing anything under `src/` restarts the running dev server (`tsx watch`), which serves the **main checkout**. Implement Tasks 1–8 in a separate git worktree (Task S). Code in the worktree never reaches the running service. Who touches the service, and when:
  - Task 0 is meant to change the running service, so the **owner** applies it on the main checkout.
  - A6/A7 (Task 8 Step 9) run only after the branch is merged into the main checkout and the owner restarts `npm run dev`.
  - If A6 must run before the merge, start a second instance from the worktree with `cp /home/skamik/Documents/repositories/personal/aityper-scraper-api/.env $WT/ && cd $WT && SCRAPERS_ON=false PORT=3002 npm run dev`. `SCRAPERS_ON=false` skips the hourly scheduler (`src/index.ts:101-106`); never start a second instance with the scheduler on. Send the admin POST to `:3002`. That instance **writes to the same Supabase**: the scrape rows, the idempotent `market_types` upsert at start (`src/index.ts:91-98`) and the TSDB sync jobs (`:109-112`).
- Evidence paths: `docs/superpowers/` is untracked, so a worktree cut from HEAD does not contain it. Tasks copy evidence from the main checkout by absolute path: `EV=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence`.
- Keep the bookmaker keys `betters` and `lebull`, the exports `bettersScraper`, `lebullScraper`, `BettersPlaywrightScraper`, `LebullPlaywrightScraper`, `bettersNormalizer`, `lebullNormalizer`, and the file paths `src/scrapers/bookmakers/{betters,lebull}/index.ts` and `src/services/normalization/bookmakers/{betters,lebull}-normalizer.ts`.
- Betby brand, category, tournament and event ids are strings end to end. Never call `Number()` or `parseInt()` on them, and never put them in `bookmakerMarketId`.
- `MIN_VALID_ODDS = 1.01` is inclusive. Outcomes with a truthy `b` are skipped.
- Unit tests make zero live requests: use the fake fetch over the copied evidence. Live traffic happens only in Task 8 and stays modest (one smoke run per brand).

## Review Focus

1. **The snapshot rotates mid-fetch.** A chunk comes back as `{version: 0}` without `events`. Expected: the client retries with a fresh manifest and never returns a partial snapshot (a silent match loss). Test: Task 3 `fetchSnapshot retries with a fresh manifest when a chunk comes back rotated`.
2. **19-digit ids get rounded.** `2725816334213586962` becomes `2725816334213587000` via `Number`, an id in config, or URL parsing. Expected: `matchId`, `eventUrl` and league ids keep exact strings. Tests: Task 4 `selectLeagueEvents keeps 19-digit ids as exact strings`, Task 6 `getBookmakerLeagueId returns Betby tournament ids as strings`.
3. **Blocked outcomes and a legitimate 1.01 price.** `{k:"0.0", b:1}` must vanish, and a real `1.01` must stay. Test: Task 4 `buildScrapedMarkets drops blocked outcomes and keeps 1.01`.
4. **The event endpoint has no data for one match** (it went live or was withdrawn). Live behaviour: HTTP 200 with an envelope **without `events`** (`evidence/*/event-missing-envelope.json`). HTTP 404 was not observed but stays handled. Expected: `fetchEvent` returns `null` without throwing; that match falls back to its listing markets (1/10/16/18); the other matches and the run still succeed. Tests: Task 3 `fetchEvent returns null when the 200 envelope has no events`; Task 6 `scrapeFullOffer falls back to listing markets when the event payload has no events` and `scrapeFullOffer falls back to listing markets when the event endpoint 404s`.
5. **Integer and quarter lines and mixed formatting** (`hcp=-1.0` vs `hcp=1` vs `hcp=-1`, `total=3`, `total=2.75`). Expected under the D1 default: ASIAN_HANDICAP with `"-1"`, `"0"`, `"+1"`; TOTAL_GOALS_ASIAN with `"3"`, `"2.75"`; quarter handicaps skipped. Tests: Task 5 `handicap integer and quarter lines` and `totals half, integer and quarter lines`.
6. **A far-future event with a thin market list** (Liverpool–Man Utd, 16 days out: 11 ids, 39 pairs, 34 normalized). Expected: the scraper keeps it and counts it as a full payload; the smoke reports it as `shallow` and does not fail A2. Tests: Task 6 `scrapeFullOffer keeps a thin far-future event as a full payload`; Task 8 `evaluateSmoke reports a thin far-future match as shallow without failing`.

---

## File Structure

```
src/scrapers/shared/betby/
  types.ts            Betby wire types + BetbyEndpoints/BetbyBrandConfig/BetbyEventRef/FetchText
  http.ts             BetbyHttpError, createFetchText (UA, timeout, error messages naming host+path)
  discovery.ts        pure bootstrap/renderer/config parsers + discoverBetters/LebullEndpoints + resolveEndpoints
  brands.ts           BETBY_BRANDS: pinned endpoints, discover fn, eventUrl builder, log tag
  client.ts           BetbyClient: endpoints/snapshot/event/descriptions with caches and the chunk-chain protocol
  specifiers.ts       parseSpecifiers, classifyLine, formatSignedLine, formatLine (shared with the normalizer)
  parser.ts           renderTemplate, selectLeagueEvents, buildScrapedMarkets, extractBetbyEventId, MIN_VALID_ODDS
  scraper.ts          BetbyScraper extends PlaywrightScraper (browserless)
  smoke-gate.ts       pure acceptance logic for scripts/betby-smoke.ts (oneXTwoDeviation, evaluateSmoke)
  __tests__/fixtures.ts, __tests__/fake-fetch.ts, __tests__/*.test.ts, __tests__/fixtures/{betters,lebull}/*
src/scrapers/bookmakers/betters/index.ts      thin: BettersPlaywrightScraper extends BetbyScraper
src/scrapers/bookmakers/lebull/index.ts       thin: LebullPlaywrightScraper extends BetbyScraper
src/services/normalization/bookmakers/betby-market-rules.ts   declarative UOF rule table (phase 1)
src/services/normalization/bookmakers/betby-normalizer.ts     createBetbyNormalizer
src/services/normalization/bookmakers/{betters,lebull}-normalizer.ts  thin instances
src/services/normalization/__fixtures__/{betters,lebull}/premier-league_leeds-united_tottenham-hotspur.{json,expected.json}
scripts/betby-evidence-archive.ts   evidence event → prep-style archive (for harvest)
scripts/betby-smoke.ts              live single-bookmaker acceptance check (no DB)
scripts/odds-outliers.ts            listMatches reads /api/odds (A7 is unusable today)
Frontend repo (owner-gated Task 9): docs/audit-ledger/{registry.json,coverage.json}, .claude/agents/{betters,lebull}-{audit-fixer,market-judge}.md,
         .claude/commands/{audit,fix-from-audit}-{betters,lebull}.md
Deleted: src/scrapers/bookmakers/{betters,lebull}/{constants,navigation,parser,types}.ts and their __tests__/parser.test.ts;
         src/services/normalization/__fixtures__/lebull/world-cup-2026_france_morocco.*
```

---

### Task 0 (optional stop-gap, **owner, main checkout**): pause both scrapers

This task exists to change the running service, so the owner applies it in the main checkout, not in the worktree. Saving the file restarts `tsx watch`.

**Files:**
- Modify: `src/config/index.ts:62-63` (remove `"betters",` and `"lebull",` from `CONFIG.BOOKMAKERS`; keep `ALL_POLISH_BOOKMAKERS:17-18`)

**Interfaces:** Produces `CONFIG.BOOKMAKERS` without both keys. Task 8 Step 9 restores them.

**Side effects while paused** (every `CONFIG.BOOKMAKERS` consumer):
- `GET /api/bookmakers` omits both keys (`src/routes/bookmakers.ts:70`).
- The per-league status map omits them (`src/services/odds-service.ts:188-200`). The API therefore reports them as **absent** instead of `stale`.
- `POST /api/admin/scrape` with `bookmakers:["betters"]` is rejected with 400 `Invalid bookmaker: betters` (`src/routes/admin.ts:39-47`) until they are restored.

- [ ] **Step 1:** Remove the two lines. Do not touch `ALL_POLISH_BOOKMAKERS`, `SCRAPERS` in `aggregator.ts`, or the frontend.
- [ ] **Step 2:** Run `npx tsc --noEmit && npx vitest run`. Expected: no tsc output; 65 files pass.
- [ ] **Step 3:** After the dev server restarts:
  - The next run logs `Starting run … with 12 bookmakers` (`src/scrapers/aggregator.ts:76`) and no `[Betters/…]` or `[LeBull/…]` lines.
  - `curl -s http://localhost:3001/api/bookmakers | python3 -I -c "import json,sys;print([b['id'] for b in json.load(sys.stdin)['data']['bookmakers']])"` prints a 12-entry list without `betters` and `lebull`. Today it prints 14 entries.
- [ ] **Step 4:** Commit (only when the owner asks): `git add src/config/index.ts && git commit -m "chore(config): pause betters/lebull until Betby migration lands"`

---

### Task S: Worktree setup (implementer)

- [ ] **Step 1:** Create the worktree per superpowers:using-git-worktrees, cut from the branch that holds Task 0 if the owner committed it. Below, `$WT` is its absolute path and `EV=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence`. Evidence is read from `$EV` in the main checkout because `docs/superpowers/` is untracked. Alternatively, the owner commits `docs/superpowers/plans/2026-11-06-scraper-recovery/` on the base branch first.
- [ ] **Step 2:** `cd $WT && npm ci`. Expected: exit 0. A fresh worktree has no `node_modules`.
- [ ] **Step 3:** `cd $WT && npx tsc --noEmit && npx vitest run`. Expected: no tsc output; 65 files / 1182 tests pass.

---

### Task 1: Carry `externalId` and `paramValue` through the audit and golden harness

**Files:**
- Modify: `src/services/normalization/__tests__/golden.test.ts:36-43` (add `externalId?: string` to the selection type), `:86-94` (map `{ name, odds, externalId }`)
- Modify: `scripts/rebless-golden.ts:33-39`, `:57-65` (same)
- Modify: `scripts/harvest-fixtures.ts:52-55` (ArchiveSelection gets `externalId?: string`), `:133-141` (same map)
- Modify: `src/services/audit/types.ts:47-53` (`PrepMarketEntry.raw` gets `paramValue?: string` and selection `externalId?: string`)
- Modify: `src/services/audit/scraper-audit-core.ts:53-59` (RawAuditMarket selection `externalId?: string`), `:169-177` (`scrapedMarketsToRaw` keeps `externalId`), `:238-245` (forNorm keeps `externalId`), `:368-376` (archived raw adds `...(raw.paramValue !== undefined ? { paramValue: raw.paramValue } : {})` and keeps `externalId` the same way), `:450-458` (analyzeMarket keeps `externalId`)
- Test: `src/services/audit/__tests__/scraper-audit-core-passthrough.test.ts`

**Interfaces:**
- Consumes: the existing `RawBookmakerMarket.selections[].externalId?` (`src/services/normalization/types.ts:925`).
- Produces: every harness path hands `selections[].externalId` and `paramValue` to `normalizeMarket`. Prep archives contain `raw.paramValue` and `raw.selections[].externalId` **only when set**; entries without them serialize exactly as today. Tasks 5 and 7 rely on this.
- **Deliberate behaviour change (not purely additive):** five scrapers set `ScrapedMarket.paramValue`: betclic (`src/scrapers/bookmakers/betclic/parser.ts:518,626,638`), betcris (`betcris/parser.ts:364,381`), betfan (`betfan/parser.ts:411`), lvbet (`lvbet/parser.ts:447`) and pzbuk (`pzbuk/parser.ts:783`). Their *future* prep archives will carry `paramValue`, so `harvest-fixtures.ts`/`rebless-golden.ts` (which already read `raw.paramValue`, `harvest-fixtures.ts:133-141`, `rebless-golden.ts:57-65`) will normalize them with it. That matches the live path (`src/services/normalization/factory.ts:254-258` passes `paramValue`), so new goldens become *more* faithful. Committed fixtures do not change. The Step 4 checks prove only the latter. The first harvest per affected bookmaker after this task may show diffs that are fidelity fixes; inspect them like any other diff.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { scrapedMarketsToRaw, buildPrepAuditOutput } from "../scraper-audit-core.js";
import type { BookmakerMarketNormalizer, RawBookmakerMarket } from "../../normalization/types.js";

const market = { name: "Suma 2.5", bookmakerMarketId: "18", paramValue: "total=2.5",
  selections: [{ name: "ponad 2.5", odds: 1.93, externalId: "12" }, { name: "poniżej 2.5", odds: 1.85, externalId: "13" }] };

describe("audit harness passthrough", () => {
  it("scrapedMarketsToRaw keeps selection externalId and paramValue", () => {
    const [raw] = scrapedMarketsToRaw([market]);
    expect(raw.paramValue).toBe("total=2.5");
    expect(raw.selections.map((s) => s.externalId)).toEqual(["12", "13"]);
  });
  it("buildPrepAuditOutput hands externalId and paramValue to the normalizer and archives both", () => {
    const seen: RawBookmakerMarket[] = [];
    const spy: BookmakerMarketNormalizer = { bookmaker: "betters", normalizeMarket: (raw) => { seen.push(raw); return null; } };
    const out = buildPrepAuditOutput({ normalizer: spy, ctx: { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur" },
      rawMarkets: scrapedMarketsToRaw([market]), meta: { matchId: "2725816334213586962", homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league" } });
    expect(seen[0].paramValue).toBe("total=2.5");
    expect(seen[0].selections[0].externalId).toBe("12");
    expect(out.markets[0].raw.paramValue).toBe("total=2.5");
    expect(out.markets[0].raw.selections[1].externalId).toBe("13");
  });
  it("archives entries without paramValue or externalId without those keys", () => {
    const bare = { name: "1x2", bookmakerMarketId: "1", selections: [{ name: "Leeds United", odds: 2.74 }] };
    const spy: BookmakerMarketNormalizer = { bookmaker: "betters", normalizeMarket: () => null };
    const out = buildPrepAuditOutput({ normalizer: spy, ctx: { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur" },
      rawMarkets: scrapedMarketsToRaw([bare]), meta: { matchId: "2725816334213586962", homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league" } });
    expect("paramValue" in out.markets[0].raw).toBe(false);
    expect(Object.keys(out.markets[0].raw.selections[0]).sort()).toEqual(["name", "odds"]);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/services/audit/__tests__/scraper-audit-core-passthrough.test.ts`. Expected: FAIL (`externalId` is `undefined`).
- [ ] **Step 3:** Implement the passthrough at the listed lines. Add `externalId` and `paramValue` only when present (`...(s.externalId !== undefined ? { externalId: s.externalId } : {})`), so entries without them serialize byte-identically.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all pass, and the golden suite still reports `failures=0` for every bookmaker (committed fixtures unchanged). Then run `npx tsx scripts/rebless-golden.ts --all --dry`. Expected last stdout line, exactly: `{"changedTotal":0,"dry":true}` (`scripts/rebless-golden.ts:173`).
- [ ] **Step 5:** Commit: `git add -A src/services/audit src/services/normalization/__tests__/golden.test.ts scripts/rebless-golden.ts scripts/harvest-fixtures.ts && git commit -m "audit: carry selection externalId and paramValue through golden/prep harness"`

---

### Task 2: Betby types, HTTP helper, endpoint discovery and brand configs

**Files:**
- Create: `src/scrapers/shared/betby/{types.ts,http.ts,discovery.ts,brands.ts}`
- Create: `src/scrapers/shared/betby/__tests__/{fixtures.ts,fake-fetch.ts,discovery.test.ts}`
- Create (copy from `$EV`, see Step 1): `src/scrapers/shared/betby/__tests__/fixtures/betters/{bootstrap.json,bt-renderer.head.js,manifest.json,snapshot-trimmed.json,chunk-rotated-1793981941985.json,descriptions-markets.trimmed.json,event-2725816334213586962.json,event-2725816334213586981.json,event-2726177353700085769.json,event-2725446939305979931.json,event-missing-envelope.json}` and `src/scrapers/shared/betby/__tests__/fixtures/lebull/{bootstrap.json,sb-config.json,manifest.json,snapshot-trimmed.json,descriptions-markets.trimmed.json,event-2725816334213586962.json,event-missing-envelope.json}`.

**Interfaces:**
- Produces (`types.ts`):
  - `type BetbyBookmaker = "betters" | "lebull"`
  - `type FetchText = (url: string) => Promise<string>`
  - `interface BetbyEndpoints { prematchBase: string; descriptionsBase: string; brandId: string }`
  - `interface BetbyOutcome { k: string; b?: number }`
  - `type BetbyMarkets = Record<string, Record<string, Record<string, BetbyOutcome>>>`
  - `interface BetbyEvent { desc: { scheduled: number; type: string; slug: string; sport: string; category: string; tournament: string; competitors: { id: string; name: string }[] }; markets: BetbyMarkets; state?: { status?: number } }`
  - `interface BetbyEnvelope { version: number; snapshot_complete?: boolean; sports?: Record<string, { slug: string }>; categories?: Record<string, { slug: string; name: string }>; tournaments?: Record<string, { category_id: string; slug: string; name: string }>; events?: Record<string, BetbyEvent> }`
  - `interface BetbyManifest { version: number; top_events_versions: number[]; rest_events_versions: number[] }`
  - `interface BetbySnapshot { manifestVersion: number; events: Record<string, BetbyEvent>; categories: NonNullable<BetbyEnvelope["categories"]>; tournaments: NonNullable<BetbyEnvelope["tournaments"]> }`
  - `type BetbyMarketDescriptions = Record<string, { id: string; name: string; specifiers?: string[]; variants?: Record<string, { outcomes: { id: string; name: string }[] }[]> }>`
  - `interface BetbyEventRef { eventId: string; homeTeam: string; awayTeam: string; startTime: string; categoryId: string; categorySlug: string; tournamentId: string; tournamentSlug: string; eventSlug: string; listingMarkets: BetbyMarkets }`
  - `interface BetbyBrandConfig { bookmaker: BetbyBookmaker; logTag: "Betters" | "LeBull"; pinned: BetbyEndpoints; discover: (fetchText: FetchText) => Promise<BetbyEndpoints>; buildEventUrl: (ref: BetbyEventRef) => string }`
- Produces (`http.ts`):
  - `class BetbyHttpError extends Error { readonly status: number; readonly url: string }` with message `` `HTTP ${status} from ${host}${pathname}` ``
  - `createFetchText(opts?: { timeoutMs?: number }): FetchText`: UA `"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"`, `AbortSignal.timeout(15_000)`, follows redirects, throws `BetbyHttpError` on `!res.ok`, and rethrows network errors as `` `Betby request failed: ${host}${pathname}: ${message}` ``.
- Produces (`discovery.ts`):
  - `parseBettersBootstrap(json: unknown): { brandId: string; rendererUrl: string }`
  - `extractApiOriginFromRenderer(js: string): string` (first match of `/https:\/\/api-h-[a-z0-9-]+\.sptpub\.com/`)
  - `parseLebullBootstrap(json: unknown): { sbHost: string }` (with trailing `/`)
  - `parseLebullSbConfig(json: unknown): BetbyEndpoints` (`${betbyApiUrl}/v5`, `${betbyApiUrl}/v4`)
  - `discoverBettersEndpoints(f: FetchText)` (`${origin}/api/v4`, `${origin}/api/v3`)
  - `discoverLebullEndpoints(f: FetchText)`
  - `resolveEndpoints(brand: BetbyBrandConfig, f: FetchText, warn?: (m: string) => void): Promise<{ endpoints: BetbyEndpoints; source: "discovered" | "pinned" }>`
  - Constants `BETTERS_BOOTSTRAP_URL = "https://www.betters.pl/share/bootstrap"`, `LEBULL_BOOTSTRAP_URL = "https://www.lebull.pl/share/bootstrap"`.
- Produces (`brands.ts`): `BETBY_BRANDS: Record<BetbyBookmaker, BetbyBrandConfig>` with the pinned values and URL builders from the endpoint table in Observations.
- Produces (tests):
  - `__tests__/fixtures.ts`: `loadText(bm: BetbyBookmaker, file: string): string`, `loadJson<T>(bm, file): T`.
  - `__tests__/fake-fetch.ts`: `createEvidenceFetch(bm: BetbyBookmaker, opts?: { failures?: Record<string, number>; overrides?: Record<string, string>; overridesOnce?: Record<string, string> }): FetchText & { calls: string[] }`. Every URL is pushed to `calls`, then resolved by the **first** matching rule in this order:
    1. `failures[key]` where `url.includes(key)` → throw `new BetbyHttpError(status, url)`.
    2. `overridesOnce[key]` where `url.includes(key)` → that body, for the first matching request only.
    3. `overrides[key]` where `url.includes(key)` → that body, on every request.
    4. `url.includes("share/bootstrap")` → `bootstrap.json`.
    5. `url.includes("bt-renderer.min.js")` → `bt-renderer.head.js`.
    6. `url.includes("assets/public/config.json")` → `sb-config.json`.
    7. `/\/descriptions\/brand\/\d+\/markets\/pl$/` → `JSON.stringify(file.markets)` (the trimmed file wraps the raw response under `markets`).
    8. `/\/event\/pl\/(\d+)$/` → `event-<id>.json`; when that file is absent, HTTP 200 with `event-missing-envelope.json`, the live behaviour for an unknown id. The 404 case is produced explicitly with `failures: { "/event/pl/<id>": 404 }`.
    9. `/\/pl\/0$/` → `manifest.json`.
    10. `/\/pl\/(\d+)$/` → the chunk of `snapshot-trimmed.json` whose `requestedVersion === Number(v)`; no such chunk → throw `BetbyHttpError(404, url)`.
    11. Anything else → throw `Error("fake-fetch: unrouted " + url)`.

    Rule 8 is checked before rules 9–10 because `/event/pl/<id>` also ends in `/pl/<digits>`.

- [ ] **Step 1: Copy the fixtures** from the main checkout. The evidence is untracked and therefore absent from the worktree.

```bash
cd $WT
EV=/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence
F=src/scrapers/shared/betby/__tests__/fixtures
mkdir -p $F/betters $F/lebull
cp $EV/betters/{bootstrap.json,bt-renderer.head.js,manifest.json,snapshot-trimmed.json,chunk-rotated-1793981941985.json,descriptions-markets.trimmed.json,event-2725816334213586962.json,event-2725816334213586981.json,event-2726177353700085769.json,event-2725446939305979931.json,event-missing-envelope.json} $F/betters/
cp $EV/lebull/{bootstrap.json,sb-config.json,manifest.json,snapshot-trimmed.json,descriptions-markets.trimmed.json,event-2725816334213586962.json,event-missing-envelope.json} $F/lebull/
ls $F/betters | wc -l; ls $F/lebull | wc -l
```

Expected: `11` and `7`.
- [ ] **Step 2: Write the failing tests** in `discovery.test.ts`:

```ts
it("parseBettersBootstrap reads brand id and renderer url", () => {
  expect(parseBettersBootstrap(loadJson("betters", "bootstrap.json")))
    .toEqual({ brandId: "2658970707769307140", rendererUrl: "https://betters.sptpub.com/bt-renderer.min.js" });
});
it("parseBettersBootstrap rejects a bootstrap without bettech_brand_id (lebull)", () => {
  expect(() => parseBettersBootstrap(loadJson("lebull", "bootstrap.json"))).toThrow(/bettech_brand_id/);
});
it("extractApiOriginFromRenderer finds the api-h host", () => {
  expect(extractApiOriginFromRenderer(loadText("betters", "bt-renderer.head.js"))).toBe("https://api-h-c7818b61-608.sptpub.com");
  expect(() => extractApiOriginFromRenderer("console.log(1)")).toThrow(/api-h/);
});
it("parseLebullBootstrap and parseLebullSbConfig build the v5/v4 proxy bases", () => {
  expect(parseLebullBootstrap(loadJson("lebull", "bootstrap.json")).sbHost).toBe("https://lebull-pl-bb.boxwebcdn.work/");
  expect(parseLebullSbConfig(loadJson("lebull", "sb-config.json"))).toEqual({
    prematchBase: "https://betting-betby-secundus.prod.sbteam.xyz/v5",
    descriptionsBase: "https://betting-betby-secundus.prod.sbteam.xyz/v4",
    brandId: "2694137186776920067" });
});
it("resolveEndpoints returns discovered endpoints equal to the pinned ones on 2026-11-06", async () => {
  for (const bm of ["betters", "lebull"] as const) {
    const r = await resolveEndpoints(BETBY_BRANDS[bm], createEvidenceFetch(bm));
    expect(r).toEqual({ endpoints: BETBY_BRANDS[bm].pinned, source: "discovered" });
  }
});
it("resolveEndpoints falls back to pinned endpoints and warns when discovery fails", async () => {
  const warn = vi.fn();
  const r = await resolveEndpoints(BETBY_BRANDS.betters, createEvidenceFetch("betters", { failures: { "share/bootstrap": 503 } }), warn);
  expect(r.source).toBe("pinned");
  expect(warn.mock.calls[0][0]).toMatch(/endpoint discovery failed: HTTP 503 from www\.betters\.pl\/share\/bootstrap; using pinned https:\/\/api-h-c7818b61-608\.sptpub\.com\/api\/v4/);
});
it("BETBY_BRANDS build the verified event URLs", () => {
  const ref = { eventId: "2725816334213586962", categoryId: "1669818860410376192", categorySlug: "england",
    tournamentId: "1669818860469096448", tournamentSlug: "premier-league", eventSlug: "leeds-united-tottenham-hotspur" } as BetbyEventRef;
  expect(BETBY_BRANDS.betters.buildEventUrl(ref)).toBe("https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/leeds-united-tottenham-hotspur-2725816334213586962");
  expect(BETBY_BRANDS.lebull.buildEventUrl(ref)).toBe("https://lebull-pl-bb.boxwebcdn.work/event/1/1669818860410376192/1669818860469096448/2725816334213586962");
});
```

- [ ] **Step 3:** Run `npx vitest run src/scrapers/shared/betby/__tests__/discovery.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement the four files with the signatures above. `resolveEndpoints` logs `` `[Betby/${tag}] endpoint drift: discovered ${d.prematchBase} != pinned ${p.prematchBase}` `` once when the discovered value differs from the pinned one.
- [ ] **Step 5:** Run the same test (expected: PASS), then `npx tsc --noEmit && npx vitest run`.
- [ ] **Step 6:** Commit: `git add src/scrapers/shared/betby && git commit -m "betby: shared types, http helper and endpoint discovery with pinned fallback"`

---

### Task 3: BetbyClient (snapshot chunk protocol, event and descriptions, caches)

**Files:**
- Create: `src/scrapers/shared/betby/client.ts`
- Test: `src/scrapers/shared/betby/__tests__/client.test.ts`

**Interfaces:**
- Consumes: Task 2 types, `resolveEndpoints`, `BetbyHttpError`, `createFetchText`, `createEvidenceFetch`.
- Produces:
  - `class BetbyClient { constructor(brand: BetbyBrandConfig, deps?: { fetchText?: FetchText; now?: () => number; warn?: (m: string) => void }) }` with methods `getEndpoints(): Promise<BetbyEndpoints>`, `fetchSnapshot(): Promise<BetbySnapshot>`, `fetchEvent(eventId: string): Promise<BetbyEvent | null>` (null when the HTTP 200 envelope has no `events`, which is the live behaviour for an unknown or withdrawn id; null when `events[eventId]` is missing; null on HTTP 404; other errors propagate) and `fetchDescriptions(): Promise<BetbyMarketDescriptions>`.
  - Exported constants: `SNAPSHOT_TTL_MS = 45_000`, `ENDPOINTS_TTL_MS = DESCRIPTIONS_TTL_MS = 21_600_000`, `SNAPSHOT_MAX_ATTEMPTS = 2`.

The snapshot algorithm is the part that the signature does not determine:

```
for attempt in 1..SNAPSHOT_MAX_ATTEMPTS:
  manifest = GET {prematchBase}/prematch/brand/{brandId}/pl/0
  versions = [...manifest.top_events_versions, ...manifest.rest_events_versions]
  chunks = await Promise.all(versions.map(v => GET …/pl/{v}))          // parallel, no delay
  problems = []
  chunks.forEach((c, i) => {
    if (!c.events) problems.push(`chunk ${versions[i]} rotated`)
    else if (i < last && c.version !== versions[i + 1]) problems.push(`chunk ${versions[i]} points to ${c.version}`)
  })
  if (!chunks[last].snapshot_complete) problems.push(`last chunk ${versions[last]} not complete`)
  if (problems.length === 0) return merge(events, categories, tournaments) with manifestVersion = manifest.version
throw new Error(`Betby ${bookmaker}: snapshot incomplete after 2 attempts (${problems.join("; ")})`)
```

- [ ] **Step 1: Write the failing tests** (`now` injected; `fetchText = createEvidenceFetch(bm, …)`):

```ts
it("fetchSnapshot merges all 7 betters chunks", async () => {
  const f = createEvidenceFetch("betters"); const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => 0 });
  const s = await c.fetchSnapshot();
  expect(s.manifestVersion).toBe(1793982002415);
  expect(Object.keys(s.events)).toHaveLength(58);
  expect(s.tournaments["1669818860469096448"].name).toBe("Premier League");
  expect(f.calls.filter((u) => u.includes("/prematch/brand/2658970707769307140/pl/"))).toHaveLength(8);
});
it("fetchSnapshot retries with a fresh manifest when a chunk comes back rotated", async () => {
  const f = createEvidenceFetch("betters", { overridesOnce: { "/pl/1793982002420": loadText("betters", "chunk-rotated-1793981941985.json") } });
  const s = await new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => 0 }).fetchSnapshot();
  expect(s.manifestVersion).toBe(1793982002415);
  expect(f.calls.filter((u) => u.endsWith("/pl/0"))).toHaveLength(2);
});
it("fetchSnapshot throws after two rotated attempts", async () => {
  const f = createEvidenceFetch("betters", { overrides: { "/pl/1793982002420": loadText("betters", "chunk-rotated-1793981941985.json") } });
  await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: f }).fetchSnapshot())
    .rejects.toThrow(/snapshot incomplete after 2 attempts \(chunk 1793982002420 rotated/);
});
it("fetchSnapshot is cached for 45 s", async () => {
  let t = 0;
  const f = createEvidenceFetch("betters"); const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => t });
  const snapshotCalls = () => f.calls.filter((u) => u.includes("/prematch/brand/2658970707769307140/pl/")).length;
  await c.fetchSnapshot(); t = 44_000; await c.fetchSnapshot();
  expect(snapshotCalls()).toBe(8); // 1 manifest + 7 chunks; f.calls also holds the 2 discovery calls
  t = 46_000; await c.fetchSnapshot();
  expect(snapshotCalls()).toBe(16);
});
it("fetchSnapshot error names host, path and status", async () => {
  const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: createEvidenceFetch("betters", { failures: { "/pl/0": 404 } }) });
  await expect(c.fetchSnapshot()).rejects.toThrow("HTTP 404 from api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2658970707769307140/pl/0");
});
it("fetchEvent returns the raw event", async () => {
  const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: createEvidenceFetch("betters") });
  expect((await c.fetchEvent("2725816334213586962"))!.desc.competitors[1].name).toBe("Tottenham Hotspur ");
});
it("fetchEvent returns null when the 200 envelope has no events", async () => {
  // Everton-Coventry has no event-<id>.json, so the fake serves event-missing-envelope.json with HTTP 200 (live behaviour)
  const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: createEvidenceFetch("betters") });
  await expect(c.fetchEvent("2725815896848338956")).resolves.toBeNull();
});
it("fetchEvent returns null on HTTP 404", async () => {
  const f = createEvidenceFetch("betters", { failures: { "/event/pl/2725816334213586962": 404 } });
  await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: f }).fetchEvent("2725816334213586962")).resolves.toBeNull();
});
it("lebull client talks to the v5 proxy", async () => {
  const f = createEvidenceFetch("lebull");
  const s = await new BetbyClient(BETBY_BRANDS.lebull, { fetchText: f, now: () => 0 }).fetchSnapshot();
  expect(f.calls).toContain("https://betting-betby-secundus.prod.sbteam.xyz/v5/prematch/brand/2694137186776920067/pl/0");
  expect(s.manifestVersion).toBe(1793981968429);
  expect(s.tournaments["1669818860469096448"].slug).toBe("premier-league");
});
it("fetchDescriptions is cached for 6 h", async () => {
  let t = 0;
  const f = createEvidenceFetch("betters"); const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => t });
  const descCalls = () => f.calls.filter((u) => u.includes("/descriptions/brand/2658970707769307140/markets/pl")).length;
  expect((await c.fetchDescriptions())["1"].name).toBe("1x2");
  t = 21_599_000; await c.fetchDescriptions();
  expect(descCalls()).toBe(1);
  t = 21_601_000; await c.fetchDescriptions();
  expect(descCalls()).toBe(2);
});
```

- [ ] **Step 2:** Run `npx vitest run src/scrapers/shared/betby/__tests__/client.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `client.ts`. Endpoints go through `resolveEndpoints` (cached `ENDPOINTS_TTL_MS`); the snapshot follows the algorithm above (cached `SNAPSHOT_TTL_MS`); `JSON.parse` the text responses.
- [ ] **Step 4:** Run the test (expected: PASS), then `npx tsc --noEmit && npx vitest run`.
- [ ] **Step 5:** Commit: `git add src/scrapers/shared/betby && git commit -m "betby: client with validated manifest/chunk snapshot and event endpoint"`

---

### Task 4: Pure parser (specifiers, templates, event selection, ScrapedMarket building)

**Files:**
- Create: `src/scrapers/shared/betby/{specifiers.ts,parser.ts}`
- Modify: `src/scrapers/shared/betby/__tests__/fixtures.ts` (add `snapshotFrom(bm): BetbySnapshot`, which merges the `events`/`categories`/`tournaments` of every chunk in `snapshot-trimmed.json`, with `manifestVersion = manifest.version`)
- Test: `src/scrapers/shared/betby/__tests__/{specifiers.test.ts,parser.test.ts}`

**Interfaces:**
- Produces (`specifiers.ts`):
  - `parseSpecifiers(s: string): Record<string, string>` (split on `|`, then on the first `=`)
  - `classifyLine(v: number): "half" | "integer" | "quarter"`
  - `formatSignedLine(v: number): string` (`+`/`-` prefix, `"0"` for 0 per decision D1, trailing `.0` dropped)
  - `formatLine(v: number): string` (no sign, `String(v)`)
- Produces (`parser.ts`):
  - `MIN_VALID_ODDS = 1.01`
  - `renderTemplate(t: string, specs: Record<string, string>, competitors: [string, string]): string`
  - `selectLeagueEvents(s: BetbySnapshot, tournamentId: string, nowMs: number): BetbyEventRef[]`
  - `buildScrapedMarkets(markets: BetbyMarkets, d: BetbyMarketDescriptions, competitors: [string, string]): ScrapedMarket[]`
  - `extractBetbyEventId(url: string): string | null` (last run of ≥ 15 digits)

Rules that the signatures do not determine:

- **`renderTemplate`** replaces `/\{([$!+-]?)([a-z_0-9]+)\}/gi`:
  - `$competitor1` / `$competitor2` → the competitor name.
  - `+x` → `formatSignedLine(Number(v))`; `-x` → `formatSignedLine(-Number(v))`; both apply only when `v` is numeric, otherwise `v`.
  - `!x` → `` `${v}.` ``; a plain `x` → `v`.
  - Unknown keys are left untouched.
- **Market name** = rendered `d[marketId].name`, plus `" " + value` for each specifier key that the template does not reference, excluding `variant` and `type`. When there is no description, the name is `Rynek <id>`.
- **Selections:**
  - Iterate the description outcomes of the matching variant (`variants[<variant=… from specifier>]` else `variants[""]`), then any remaining outcome ids sorted.
  - `name` = rendered outcome name, or the outcome id when there is no description. `odds = Number(k)`, `externalId = outcomeId`.
  - Skip when `b` is truthy or `!(odds >= MIN_VALID_ODDS)`.
- **Pairs:**
  - Exclude a pair when the specifier contains `variant=dst:`, or when any outcome id contains `:player:` or starts with `dst:`.
  - Skip pairs left with 0 selections.
  - `bookmakerMarketId = marketId`, `paramValue = specifier || undefined`.
  - Order by `Number(marketId)`, then specifier `localeCompare(…, "en", { numeric: true })`.
- **`selectLeagueEvents`:**
  - Keep `desc.sport === "1"`, `desc.type === "match"`, `desc.tournament === tournamentId`, 2 competitors, and `scheduled * 1000 > nowMs`.
  - Trim names. `startTime = new Date(scheduled * 1000).toISOString()`.
  - Slugs come from `s.categories[desc.category].slug` and `s.tournaments[desc.tournament].slug`. `listingMarkets = event.markets`. Sort by `scheduled`, then eventId.

- [ ] **Step 1: Write the failing tests** (betters fixtures; `D = loadJson("betters","descriptions-markets.trimmed.json").markets`; `leeds = loadJson("betters","event-2725816334213586962.json").events["2725816334213586962"]`; `C = ["Leeds United","Tottenham Hotspur"] as [string,string]`):

```ts
// specifiers.test.ts
expect(parseSpecifiers("from=0:00|to=15:00|hcp=-0.5")).toEqual({ from: "0:00", to: "15:00", hcp: "-0.5" });
expect(parseSpecifiers("variant=sr:goal_range:7+")).toEqual({ variant: "sr:goal_range:7+" });
expect(parseSpecifiers("")).toEqual({});
expect([2.5, 3, -1, 0, 2.75, -0.25].map(classifyLine)).toEqual(["half", "integer", "integer", "integer", "quarter", "quarter"]);
expect([-1.5, 1.5, 0, Number("-1.0"), 1].map(formatSignedLine)).toEqual(["-1.5", "+1.5", "0", "-1", "+1"]);
expect([3, 2.5, Number("4")].map(formatLine)).toEqual(["3", "2.5", "4"]);

// parser.test.ts
it("renderTemplate substitutes competitors, signed and ordinal specifiers", () => {
  expect(renderTemplate("{$competitor2} ({-hcp})", { hcp: "-1.5" }, C)).toBe("Tottenham Hotspur (+1.5)");
  expect(renderTemplate("{$competitor1} ({+hcp})", { hcp: "-1.5" }, C)).toBe("Leeds United (-1.5)");
  expect(renderTemplate("ponad {total}", { total: "2.5" }, C)).toBe("ponad 2.5");
  expect(renderTemplate("Zawodnik otrzyma {!cardnr} kartkę", { cardnr: "1" }, C)).toBe("Zawodnik otrzyma 1. kartkę");
  expect(renderTemplate("{foo} x", {}, C)).toBe("{foo} x");
});
it("selectLeagueEvents returns the 11 upcoming PL matches without the outright", () => {
  const refs = selectLeagueEvents(snapshotFrom("betters"), "1669818860469096448", Date.parse("2026-11-06T16:00:00Z"));
  expect(refs).toHaveLength(11);
  expect(refs[0]).toMatchObject({ eventId: "2725815896848338956", homeTeam: "Everton FC", awayTeam: "Coventry City",
    startTime: "2026-11-06T20:00:00.000Z", categorySlug: "england", tournamentSlug: "premier-league", eventSlug: "everton-fc-coventry-city" });
  expect(refs.find((r) => r.eventId === "2725816334213586962")!.awayTeam).toBe("Tottenham Hotspur");
  expect(refs.map((r) => r.eventId)).not.toContain("2697520988786135084");
  expect(selectLeagueEvents(snapshotFrom("betters"), "1669818860469096448", Date.parse("2026-11-06T21:00:00Z"))).toHaveLength(10);
});
it("selectLeagueEvents keeps 19-digit ids as exact strings", () => {
  const refs = selectLeagueEvents(snapshotFrom("betters"), "1669818860469096448", Date.parse("2026-11-06T16:00:00Z"));
  for (const r of refs) { expect(typeof r.eventId).toBe("string"); expect(r.eventId).toMatch(/^\d{19}$/); }
  expect(refs.map((r) => r.eventId)).toContain("2725816334213586962"); // Number() would give 2725816334213587000
});
it("buildScrapedMarkets emits 242 non-player markets with id-tagged selections", () => {
  const m = buildScrapedMarkets(leeds.markets, D, C);
  expect(m).toHaveLength(242);
  expect(m.reduce((n, x) => n + x.selections.length, 0)).toBe(699);
  expect(m.find((x) => x.bookmakerMarketId === "1")).toEqual({ name: "1x2", bookmakerMarketId: "1", paramValue: undefined, selections: [
    { name: "Leeds United", odds: 2.74, externalId: "1" }, { name: "remis", odds: 3.3, externalId: "2" }, { name: "Tottenham Hotspur", odds: 2.54, externalId: "3" }] });
  expect(m.find((x) => x.paramValue === "total=2.5" && x.bookmakerMarketId === "18")).toMatchObject({ name: "Suma 2.5",
    selections: [{ name: "ponad 2.5", odds: 1.93, externalId: "12" }, { name: "poniżej 2.5", odds: 1.85, externalId: "13" }] });
  expect(m.find((x) => x.paramValue === "hcp=-1.5" && x.bookmakerMarketId === "16")).toMatchObject({ name: "Handicap -1.5",
    selections: [{ name: "Leeds United (-1.5)", odds: 5.8, externalId: "1714" }, { name: "Tottenham Hotspur (+1.5)", odds: 1.13, externalId: "1715" }] });
  expect(m.filter((x) => x.bookmakerMarketId === "18").map((x) => x.paramValue)).toEqual(
    ["total=0.5", "total=1", "total=1.5", "total=2", "total=2.5", "total=3", "total=3.5", "total=4", "total=4.5"]);
  expect(m.some((x) => ["38", "39", "40", "50031", "50212"].includes(x.bookmakerMarketId!))).toBe(false);
});
it("buildScrapedMarkets drops blocked outcomes and keeps 1.01", () => {
  const cs = buildScrapedMarkets(leeds.markets, D, C).find((x) => x.bookmakerMarketId === "45")!;
  expect(cs.selections).toHaveLength(30);
  expect(cs.selections.map((s) => s.externalId)).not.toContain("382");
  expect(cs.selections).toContainEqual({ name: "0:0", odds: 9.75, externalId: "274" });
  const tiny = buildScrapedMarkets({ "29": { "": { "74": { k: "1.01" }, "76": { k: "1.0" } } } }, D, C)[0];
  expect(tiny.selections).toEqual([{ name: "tak", odds: 1.01, externalId: "74" }]);
});
it("extractBetbyEventId reads both brands' URLs", () => {
  expect(extractBetbyEventId("https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/leeds-united-tottenham-hotspur-2725816334213586962")).toBe("2725816334213586962");
  expect(extractBetbyEventId("https://lebull-pl-bb.boxwebcdn.work/event/1/1669818860410376192/1669818860469096448/2725816334213586962")).toBe("2725816334213586962");
  expect(extractBetbyEventId("https://www.betters.pl/zaklady-sportowe")).toBeNull();
});
```

Here `snapshotFrom(bm)` is a test helper in `fixtures.ts` that builds a `BetbySnapshot` by merging the trimmed chunks.

- [ ] **Step 2:** Run `npx vitest run src/scrapers/shared/betby/__tests__/specifiers.test.ts src/scrapers/shared/betby/__tests__/parser.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `specifiers.ts` and `parser.ts` as specified. `ScrapedMarket` comes from `src/types/full-offer.ts:32-53`; do not set `groupName` or `type`.
- [ ] **Step 4:** Run the tests (expected: PASS), then `npx tsc --noEmit && npx vitest run`.
- [ ] **Step 5:** Commit: `git add src/scrapers/shared/betby && git commit -m "betby: pure parser for UOF markets, specifiers and league event selection"`

---

### Task 5: Shared Betby normalizer and phase-1 rule table; swap both normalizers

**Files:**
- Create: `src/services/normalization/bookmakers/betby-market-rules.ts`, `src/services/normalization/bookmakers/betby-normalizer.ts`
- Modify (rewrite): `src/services/normalization/bookmakers/betters-normalizer.ts` → `export const bettersNormalizer = createBetbyNormalizer("betters"); export default bettersNormalizer;`. Same for `lebull-normalizer.ts` with `lebullNormalizer`.
- Delete: `src/services/normalization/__fixtures__/lebull/` (`git rm -r`, then `rm -rf` if the directory remains)
- Test: `src/services/normalization/bookmakers/__tests__/betby-normalizer.test.ts`

**Interfaces:**
- Consumes: `parseSpecifiers`, `classifyLine`, `formatSignedLine`, `formatLine` (Task 4); `buildMarketKey` (`helpers/index.ts:17`); `getMarketMetadata` and `isValidMarketCode` (catalog); Task 1 passthrough.
- Produces:
  - `interface BetbyMarketRule { codes: NormalizedMarketType[]; resolve(specs: Record<string, string>): { code: NormalizedMarketType; paramValue?: string } | null; outcome(externalId: string | undefined, label: string): string | null }`
  - `BETBY_MARKET_RULES: Readonly<Record<string, BetbyMarketRule>>`: exactly the 36 phase-1 ids of the Observations table, with outcome maps and param rules as written there.
  - `createBetbyNormalizer(bookmaker: "betters" | "lebull"): BookmakerMarketNormalizer`
- `normalizeMarket` behavior:
  1. Look up the rule by `String(raw.bookmakerMarketId)`; no rule → `null`. A numeric id from the facade must work too.
  2. `resolve(parseSpecifiers(raw.paramValue ?? ""))`; `null` → `null`.
  3. Map selections through `outcome(sel.externalId, sel.name)`, then drop `null` codes and codes outside a non-empty catalog vocabulary.
  4. Zero selections left → `null`.
  5. Otherwise return `{ marketCode, paramValue, marketKey: buildMarketKey(code, paramValue), selections: [{ code, label: sel.name, odds }], debug: { rawName: raw.name, rawId: raw.bookmakerMarketId, matchedBy: "id" } }`.

- [ ] **Step 1: Write the failing tests** (`n = createBetbyNormalizer("betters")`; `ctx = { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league" }`; `sel(id, name, odds)` helper):

```ts
it("maps MATCH_WINNER by outcome id, with string or numeric market id", () => {
  for (const id of ["1", 1]) {
    const out = n.normalizeMarket({ bookmakerMarketId: id, name: "1x2", selections: [sel("1", "Leeds United", 2.74), sel("2", "remis", 3.3), sel("3", "Tottenham Hotspur", 2.54)] }, ctx)!;
    expect(out).toMatchObject({ marketCode: "MATCH_WINNER", marketKey: "MATCH_WINNER", debug: { matchedBy: "id" } });
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 2.74], ["DRAW", 3.3], ["AWAY", 2.54]]);
  }
});
it("totals half, integer and quarter lines", () => {
  const t = (p: string) => n.normalizeMarket({ bookmakerMarketId: "18", name: "Suma", paramValue: p, selections: [sel("12", "ponad", 1.93), sel("13", "poniżej", 1.85)] }, ctx)!;
  expect(t("total=2.5").marketKey).toBe("TOTAL_GOALS:2.5");
  expect(t("total=3").marketKey).toBe("TOTAL_GOALS_ASIAN:3");
  expect(t("total=2.75").marketKey).toBe("TOTAL_GOALS_ASIAN:2.75");
  expect(t("total=2.5").selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
});
it("handicap integer and quarter lines", () => {
  const h = (p: string) => n.normalizeMarket({ bookmakerMarketId: "16", name: "Handicap", paramValue: p, selections: [sel("1714", "Leeds United (-1.5)", 5.8), sel("1715", "Tottenham Hotspur (+1.5)", 1.13)] }, ctx);
  expect(h("hcp=-1.5")!.marketKey).toBe("ASIAN_HANDICAP:-1.5");
  expect(h("hcp=-1.5")!.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 5.8], ["AWAY", 1.13]]);
  // Decision D1 default: integer lines pool with fortuna/etoto/betfan/fuksiarz/lvbet under ASIAN_HANDICAP
  expect(h("hcp=-1.0")!.marketKey).toBe("ASIAN_HANDICAP:-1");
  expect(h("hcp=-1")!.marketKey).toBe("ASIAN_HANDICAP:-1");
  expect(h("hcp=0")!.marketKey).toBe("ASIAN_HANDICAP:0");
  expect(h("hcp=1")!.marketKey).toBe("ASIAN_HANDICAP:+1");
  expect(h("hcp=-0.25")).toBeNull();
  const fh = n.normalizeMarket({ bookmakerMarketId: "66", name: "1. połowa - handicap", paramValue: "hcp=0", selections: [sel("1714", "Leeds United (0)", 1.91), sel("1715", "Tottenham Hotspur (0)", 1.84)] }, ctx)!;
  expect(fh.marketKey).toBe("FIRST_HALF_ASIAN_HANDICAP:0");
  expect(fh.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 1.91], ["AWAY", 1.84]]);
});
it("european handicap a:b -> signed home goal start", () => {
  const e = (p: string) => n.normalizeMarket({ bookmakerMarketId: "14", name: "Handicap europejski", paramValue: p, selections: [sel("1711", "Leeds United (1:0)", 1.5), sel("1712", "remis (1:0)", 3.9), sel("1713", "Tottenham Hotspur (1:0)", 4.9)] }, ctx);
  expect(e("hcp=1:0")!.marketKey).toBe("EUROPEAN_HANDICAP:+1");
  expect(e("hcp=1:0")!.selections.map((s) => s.code)).toEqual(["HOME", "DRAW", "AWAY"]);
  expect(e("hcp=0:1")!.marketKey).toBe("EUROPEAN_HANDICAP:-1");
  expect(e("hcp=1:1")).toBeNull();
});
it("correct score names -> h-a codes and inny -> OTHER", () => {
  // Leeds evidence: 274 "0:0" 9.75, 276 "1:0" 8.5; 324 "inny" is in the descriptions but not offered on Leeds, so its odds are synthetic
  const cs = n.normalizeMarket({ bookmakerMarketId: "45", name: "Dokładny wynik", selections: [sel("274", "0:0", 9.75), sel("276", "1:0", 8.5), sel("324", "inny", 40)] }, ctx)!;
  expect(cs.marketKey).toBe("CORRECT_SCORE");
  expect(cs.selections.map((s) => [s.code, s.odds])).toEqual([["0-0", 9.75], ["1-0", 8.5], ["OTHER", 40]]);
});
it("goal range, exact goals and first goal rules", () => {
  const g = n.normalizeMarket({ bookmakerMarketId: "25", name: "Przedział goli", paramValue: "variant=sr:goal_range:7+", selections: [
    sel("sr:goal_range:7+:1342", "0-1 goli", 3.1), sel("sr:goal_range:7+:1343", "2-3 gole", 1.9), sel("sr:goal_range:7+:1344", "4-6 goli", 3.4), sel("sr:goal_range:7+:1345", "7+ goli", 30)] }, ctx)!;
  expect(g.marketKey).toBe("GOAL_RANGE");
  expect(g.selections.map((s) => s.code)).toEqual(["0-1", "2-3", "4-6", "7+"]);
  const x = n.normalizeMarket({ bookmakerMarketId: "50063", name: "Dokładna liczba goli", selections: [
    sel("bb:exact_goals:0", "0", 10), sel("bb:exact_goals:8", "8", 100), sel("bb:exact_goals:10", "10", 150)] }, ctx)!;
  expect(x.selections.map((s) => [s.code, s.odds])).toEqual([["0", 10], ["8", 100]]); // catalog EXACT_GOALS has no "10"
  const f = (p: string) => n.normalizeMarket({ bookmakerMarketId: "8", name: "1. gol", paramValue: p, selections: [
    sel("6", "Leeds United", 2.0), sel("7", "żaden", 9.5), sel("8", "Tottenham Hotspur", 1.95)] }, ctx);
  expect(f("goalnr=1")!.marketKey).toBe("FIRST_TEAM_TO_SCORE");
  expect(f("goalnr=1")!.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 2], ["NONE", 9.5], ["AWAY", 1.95]]);
  expect(f("goalnr=2")).toBeNull();
});
it("unknown outcome ids are dropped and unmapped ids return null", () => {
  const partial = n.normalizeMarket({ bookmakerMarketId: "1", name: "1x2", selections: [sel("1", "Leeds United", 2.74), sel("99", "?", 5), sel("3", "Tottenham Hotspur", 2.54)] }, ctx)!;
  expect(partial.selections.map((s) => s.code)).toEqual(["HOME", "AWAY"]);
  expect(n.normalizeMarket({ bookmakerMarketId: "1", name: "1x2", selections: [sel("99", "?", 2)] }, ctx)).toBeNull();
  expect(n.normalizeMarket({ bookmakerMarketId: "50031", name: "Zawodnik strzeli", selections: [sel("1", "x", 2)] }, ctx)).toBeNull();
  expect(n.normalizeMarket({ bookmakerMarketId: "19", name: "Leeds United - suma", paramValue: "total=1", selections: [sel("12", "ponad 1", 1.5), sel("13", "poniżej 1", 2.5)] }, ctx)).toBeNull();
});
it("every rule code exists in the catalog", () => {
  for (const r of Object.values(BETBY_MARKET_RULES)) for (const c of r.codes) expect(isValidMarketCode(c)).toBe(true);
  expect(Object.keys(BETBY_MARKET_RULES)).toHaveLength(36);
});
it("phase-1 coverage on Leeds-Tottenham evidence: 68 of 242 markets, distinct keys, no UNKNOWN", () => {
  const markets = buildScrapedMarkets(leeds.markets, D, C);
  const outs = markets.map((m) => n.normalizeMarket(m, ctx)).filter(Boolean);
  expect(outs).toHaveLength(68);
  expect(new Set(outs.map((o) => o!.marketKey)).size).toBe(68);
  expect(outs.flatMap((o) => o!.selections).some((s) => s.code === "UNKNOWN")).toBe(false);
});
it("bettersNormalizer and lebullNormalizer keep their bookmaker keys", () => {
  expect(bettersNormalizer.bookmaker).toBe("betters"); expect(lebullNormalizer.bookmaker).toBe("lebull");
});
```

`leeds`, `D` and `C` load from `src/scrapers/shared/betby/__tests__/fixtures/betters/`, as in Task 4.

- [ ] **Step 2:** Run `npx vitest run src/services/normalization/bookmakers/__tests__/betby-normalizer.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the rule table and the normalizer, rewrite the two thin normalizer files, and run `git rm -r src/services/normalization/__fixtures__/lebull`. The old lebull golden encodes sbteam stake ids that no longer exist; Task 7 adds the replacement.
- [ ] **Step 4:** Run the test (expected: PASS). Then run `npx tsc --noEmit && npx vitest run`. Expected: all pass; the golden suite now lists 11 bookmaker dirs.
- [ ] **Step 5:** Commit: `git add -A src/services/normalization && git commit -m "betby: id-based UOF normalizer for betters and lebull; retire sbteam normalizers"`

---

### Task 6: BetbyScraper and brand wiring; Betby tournament ids; remove the sbteam scrapers

**Files:**
- Create: `src/scrapers/shared/betby/scraper.ts`
- Modify (rewrite): `src/scrapers/bookmakers/betters/index.ts`, `src/scrapers/bookmakers/lebull/index.ts`
- Modify: `src/config/leagues.ts:35-36,57-58,79-80,101-102,123-124`. Replace betters/lebull ids with string tournament ids: ekstraklasa `"1669818868635406336"`, premier-league `"1669818860469096448"`, laliga `"1669819032615915520"`, serie-a `"1669819042829045760"`, ligue-1 `"1669818844560101376"`.
- Modify: `src/config/leagues.ts:144-145` (world-cup-2026). **Delete** both lines and add a comment in the style of the totalbet one at `:148-150`: `// betters, lebull: Betby lists only the next (2030) World Cup (tournament 1670073988614852608); mapping it would file 2030 matches under world-cup-2026 — intentionally omitted.`
- Delete: `src/scrapers/bookmakers/{betters,lebull}/{constants,navigation,parser,types}.ts`, `src/scrapers/bookmakers/{betters,lebull}/__tests__/parser.test.ts`
- Test: `src/scrapers/shared/betby/__tests__/scraper.test.ts`

**Interfaces:**
- Consumes: `BetbyClient` (Task 3), `selectLeagueEvents`, `buildScrapedMarkets`, `extractBetbyEventId` (Task 4), `BETBY_BRANDS` (Task 2), `getBookmakerLeagueId` (`src/config/leagues.ts:163-169`), `getCanonicalTeamName`, `findMatchingEvent` (`src/utils/team-matcher.ts`), `DEFAULT_SCRAPER_CONFIGS` (`src/types/scraper.ts:227-244`).
- Produces:
  - `interface BetbyScraperDeps { fetchText?: FetchText; now?: () => number; eventDelayMs?: number }`
  - `class BetbyScraper extends PlaywrightScraper { constructor(brand: BetbyBrandConfig, deps?: BetbyScraperDeps); readonly client: BetbyClient; lastRunStats: { full: string[]; listingOnly: string[] } | null }`. `lastRunStats` holds the eventIds of the last `scrapeFullOffer` call, split by whether `fetchEvent` returned a payload; `scripts/betby-smoke.ts` reads it. The class implements `scrapeFullOffer`, `scrapeLeague` (1X2 from `listingMarkets["1"][""]`; `RawScrapedOdds` with `eventId: ref.eventId`, canonical team names and `eventUrl`), `scrapeMatch` (existing pattern via `findMatchingEvent`), `scrapeMatchDetails` (event endpoint → `market1X2` from 1, `marketDoubleChance` from 10, `marketBTTS` from 29, `marketOverUnder` from half lines of 18), and `extractEventUrls` (returns `[]`).
  - `class BettersPlaywrightScraper extends BetbyScraper { constructor(deps?: BetbyScraperDeps) }`, `bettersScraper`, plus the same for `LebullPlaywrightScraper` / `lebullScraper`.
- `scrapeFullOffer(league)`:
  1. Resolve the tournament id via `getBookmakerLeagueId`. A missing id returns `{success:false, error:"Unknown league: <slug>"}` without any fetch.
  2. Fetch the snapshot and compute `refs`. Zero refs returns `{success:false, error:"Betby <Tag>: 0 upcoming matches for tournament <id> in snapshot <manifestVersion> (<n> events)"}`.
  3. Fetch the descriptions. For each ref, run `fetchEvent` sequentially with `eventDelayMs` (default 150). On `null` (200 envelope without `events`, or 404) or an error, warn `` `[${tag}/FullOffer] ${eventId}: no event payload (${reason}); using listing markets` `` and use `ref.listingMarkets`. Record the eventId in `lastRunStats.full` or `lastRunStats.listingOnly`.
  4. Build `FullMatchOffer { matchId: ref.eventId, bookmaker, homeTeam: getCanonicalTeamName(ref.homeTeam, league), awayTeam: …, eventUrl: brand.buildEventUrl(ref), markets, startTime: ref.startTime, scrapedAt }`.
  5. Log `` `[${tag}/FullOffer] Completed: ${n} matches (${full} full, ${listing} listing-only), ${total} markets` ``.
  6. Any thrown error → `createFullOfferErrorResult(league, err, ms)`, so the `BetbyHttpError` text reaches `result.error`.

- [ ] **Step 1: Write the failing tests.** `s = new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters"), now: () => Date.parse("2026-11-06T16:00:00Z"), eventDelayMs: 0 })`, and `lebull` is the same with `LebullPlaywrightScraper` and `createEvidenceFetch("lebull")`. The betters fixtures hold 4 event payloads: Leeds, Arsenal, Man Utd–Villa and the thin far-future Liverpool–Man Utd. For the other 7 betters matches, the fake serves the live 200 envelope without `events`, so they use the listing fallback. Only the Leeds event is in the lebull fixtures, so the other 10 lebull matches use the listing fallback.

```ts
it("betters scrapeFullOffer returns 11 PL matches with string ids, canonical teams and Betby URLs", async () => {
  const r = await s.scrapeFullOffer("premier-league");
  expect(r.success).toBe(true); expect(r.matches).toHaveLength(11);
  const leeds = r.matches.find((m) => m.matchId === "2725816334213586962")!;
  expect(leeds).toMatchObject({ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", startTime: "2026-11-07T12:30:00.000Z",
    eventUrl: "https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/leeds-united-tottenham-hotspur-2725816334213586962" });
  expect(leeds.markets).toHaveLength(242);
  expect(r.matches.map((m) => m.markets.length).filter((n) => n > 100).sort((a, b) => a - b)).toEqual([220, 238, 242]);
  expect(s.lastRunStats!.full).toEqual(["2725816334213586962", "2725816334213586981", "2726177353700085769", "2725446939305979931"]);
  expect(s.lastRunStats!.listingOnly).toHaveLength(7);
});
it("scrapeFullOffer keeps a thin far-future event as a full payload", async () => {
  const r = await s.scrapeFullOffer("premier-league");
  const liv = r.matches.find((m) => m.matchId === "2725446939305979931")!;
  expect(liv).toMatchObject({ homeTeam: "Liverpool", awayTeam: "Manchester United", startTime: "2026-11-22T16:30:00.000Z" });
  expect(liv.markets).toHaveLength(39); // 11 market ids, 39 pairs (live 2026-11-06); not a listing fallback
  expect(new Set(liv.markets.map((m) => m.bookmakerMarketId))).toEqual(new Set(["1", "10", "16", "18", "19", "20", "29", "60", "63", "66", "68"]));
  expect(s.lastRunStats!.listingOnly).not.toContain("2725446939305979931");
});
it("scrapeFullOffer falls back to listing markets when the event payload has no events", async () => {
  // live behaviour for a missing event: HTTP 200, envelope without `events` (event-missing-envelope.json)
  const everton = (await s.scrapeFullOffer("premier-league")).matches.find((m) => m.matchId === "2725815896848338956")!;
  expect(everton.markets).toHaveLength(14);
  expect(new Set(everton.markets.map((m) => m.bookmakerMarketId))).toEqual(new Set(["1", "10", "16", "18"]));
  expect(s.lastRunStats!.listingOnly).toContain("2725815896848338956");
});
it("scrapeFullOffer falls back to listing markets when the event endpoint 404s", async () => {
  const s404 = new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters", { failures: { "/event/pl/2725816334213586962": 404 } }),
    now: () => Date.parse("2026-11-06T16:00:00Z"), eventDelayMs: 0 });
  const r = await s404.scrapeFullOffer("premier-league");
  expect(r.success).toBe(true); expect(r.matches).toHaveLength(11);
  const leeds = r.matches.find((m) => m.matchId === "2725816334213586962")!;
  expect(new Set(leeds.markets.map((m) => m.bookmakerMarketId))).toEqual(new Set(["1", "10", "16", "18"]));
  expect(leeds.markets).toHaveLength(16); // Leeds listing in snapshot-trimmed.json: 16 (market, specifier) pairs
});
it("lebull uses its own prices and the lebull-pl-bb event route", async () => {
  const leeds = (await lebull.scrapeFullOffer("premier-league")).matches.find((m) => m.matchId === "2725816334213586962")!;
  expect(leeds.eventUrl).toBe("https://lebull-pl-bb.boxwebcdn.work/event/1/1669818860410376192/1669818860469096448/2725816334213586962");
  expect(leeds.markets.find((m) => m.bookmakerMarketId === "1")!.selections.map((x) => x.odds)).toEqual([2.76, 3.3, 2.56]);
});
it("scrapeFullOffer reports the HTTP status and host instead of 'No events found'", async () => {
  const r = await new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters", { failures: { "/pl/0": 404 } }) }).scrapeFullOffer("premier-league");
  expect(r.success).toBe(false); expect(r.error).toContain("HTTP 404 from api-h-c7818b61-608.sptpub.com");
});
it("unknown league fails fast and zero upcoming matches is a diagnosed failure", async () => {
  const f = createEvidenceFetch("betters");
  const r1 = await new BettersPlaywrightScraper({ fetchText: f, eventDelayMs: 0 }).scrapeFullOffer("unknown-league");
  expect(r1).toMatchObject({ success: false, error: "Unknown league: unknown-league" });
  expect(f.calls).toHaveLength(0);
  const late = new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters"), now: () => Date.parse("2027-06-01T00:00:00Z"), eventDelayMs: 0 });
  const r2 = await late.scrapeFullOffer("premier-league");
  expect(r2.success).toBe(false);
  expect(r2.error).toMatch(/0 upcoming matches for tournament 1669818860469096448 in snapshot 1793982002415/);
});
it("scrapeLeague returns listing 1X2 and scrapeMatchDetails reads the event endpoint", async () => {
  const league = await s.scrapeLeague("premier-league");
  expect(league.status).toBe("success");
  expect(league.data!.find((o) => o.eventId === "2725816334213586962")).toMatchObject({ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", homeOdds: 2.74, drawOdds: 3.3, awayOdds: 2.54 });
  const d = await s.scrapeMatchDetails("https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/leeds-united-tottenham-hotspur-2725816334213586962");
  expect(d.status).toBe("success");
  expect(d.data).toMatchObject({ market1X2: { home: 2.74, draw: 3.3, away: 2.54 }, marketBTTS: { yes: 1.7, no: 2.08 },
    marketDoubleChance: { homeOrDraw: 1.49, drawOrAway: 1.43, homeOrAway: 1.32 } });
  expect(d.data!.marketOverUnder!["2.5"]).toEqual({ over: 1.93, under: 1.85 });
  expect(d.data!.marketOverUnder!["3"]).toBeUndefined(); // integer lines are not part of the legacy O/U shape
});
it("getBookmakerLeagueId returns Betby tournament ids as strings", () => {
  expect(getBookmakerLeagueId("premier-league", "betters")).toBe("1669818860469096448");
  expect(getBookmakerLeagueId("ekstraklasa", "lebull")).toBe("1669818868635406336");
  expect(typeof getBookmakerLeagueId("laliga", "betters")).toBe("string");
  expect(getBookmakerLeagueId("world-cup-2026", "betters")).toBeUndefined(); // Betby lists only the 2030 edition
  expect(getBookmakerLeagueId("world-cup-2026", "lebull")).toBeUndefined();
});
```

- [ ] **Step 2:** Run `npx vitest run src/scrapers/shared/betby/__tests__/scraper.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `scraper.ts`, rewrite the two `index.ts` files, update `leagues.ts` (including the world-cup-2026 removal and comment), and `git rm` the old sbteam files and their tests. Run `grep -rn "betters/\(constants\|navigation\|parser\|types\)\|lebull/\(constants\|navigation\|parser\|types\)" src scripts`. Expected: no output.
- [ ] **Step 4:** Run the test (expected: PASS), then `npx tsc --noEmit && npx vitest run`.
- [ ] **Step 5:** Commit: `git add -A src/scrapers src/config/leagues.ts && git commit -m "betby: browserless BetbyScraper for betters/lebull; Betby tournament ids"`

---

### Task 7: Golden fixtures for both brands from durable evidence

**Files:**
- Create: `scripts/betby-evidence-archive.ts`
- Create (generated): `src/services/normalization/__fixtures__/{betters,lebull}/premier-league_leeds-united_tottenham-hotspur.json` and `.expected.json`

**Interfaces:**
- Consumes: `buildScrapedMarkets` (Task 4), `scrapedMarketsToRaw` (Task 1), `getCanonicalTeamName`.
- Produces: `npx tsx scripts/betby-evidence-archive.ts --bookmaker <bm> --event <event json> --descriptions <descriptions json; accepts raw or {markets}> --league <slug> --out <archive path>`. It writes `{ meta: { matchId, homeTeam: canonical, awayTeam: canonical, league }, markets: [{ index, raw: { name, groupName: "", groupId: "", bookmakerMarketId, paramValue, selections: [{ name, odds, externalId }] } }] }` in `buildScrapedMarkets` order.

- [ ] **Step 1: Prove the fixtures are missing (failing check).** Run `cd $WT && ls src/services/normalization/__fixtures__/betters src/services/normalization/__fixtures__/lebull; echo "exit=$?"`. Expected: two `No such file or directory` errors and `exit=2`. betters never had a dir, and Task 5 removed lebull's. The golden suite cannot fail here, because it skips bookmakers without a fixture dir, so the `ls` is the red step.
- [ ] **Step 2:** Implement the script, then build both archives from the fixture copies that Task 2 committed into the worktree. These are byte-identical to `$EV/<bm>/…`.

```bash
cd $WT
for bm in betters lebull; do
  npx tsx scripts/betby-evidence-archive.ts --bookmaker $bm \
    --event src/scrapers/shared/betby/__tests__/fixtures/$bm/event-2725816334213586962.json \
    --descriptions src/scrapers/shared/betby/__tests__/fixtures/$bm/descriptions-markets.trimmed.json \
    --league premier-league \
    --out /tmp/betby-archive/$bm/premier-league_leeds-united_tottenham-hotspur__2026-11-06.json
done
```

Expected: `[betby-archive] betters: 242 markets, 699 selections`, and the same for lebull.

- [ ] **Step 3:** Harvest both brands, then inspect the result before anything is committed. Harvest overwrites the pair on every re-run, so a wrong output is fixed in code and re-harvested.

```bash
for bm in betters lebull; do
  npx tsx scripts/harvest-fixtures.ts --archive /tmp/betby-archive/$bm/premier-league_leeds-united_tottenham-hotspur__2026-11-06.json \
    --bookmaker $bm --out-dir src/services/normalization/__fixtures__ \
    --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json --bless-all
done
python3 -I -c "import json,collections,sys
for bm in ('betters','lebull'):
  e=json.load(open(f'src/services/normalization/__fixtures__/{bm}/premier-league_leeds-united_tottenham-hotspur.expected.json'))['entries']
  x=[i['expected'] for i in e if i['expected']]
  print(bm,len(e),len(x),len({i['marketKey'] for i in x}),sum(s['code']=='UNKNOWN' for i in x for s in i['selections']))"
```

Expected: `betters 242 68 68 0` and `lebull 242 68 68 0`. Spot-check by hand:
- `MATCH_WINNER` = HOME 2.74 / DRAW 3.3 / AWAY 2.54 for betters, and 2.76 / 3.3 / 2.56 for lebull.
- `ASIAN_HANDICAP:-1.5` = HOME 5.8 / AWAY 1.13.
- Under the D1 default: `ASIAN_HANDICAP:-1` = HOME 4.7 / AWAY 1.18, `ASIAN_HANDICAP:0` = HOME 1.97 / AWAY 1.82, `ASIAN_HANDICAP:+1` = HOME 1.21 / AWAY 4.3, `FIRST_HALF_ASIAN_HANDICAP:0` = HOME 1.91 / AWAY 1.84, and no `*_PUSH` key.
- `EUROPEAN_HANDICAP:+1` = HOME 1.5 / DRAW 3.9 / AWAY 4.9.
- `CORRECT_SCORE` has 30 selections.

Bless only if all of these match; otherwise fix the code and re-run. `--bless-all` is acceptable here because no prior Betby fixture exists and every entry was inspected.

- [ ] **Step 4:** Run `npx vitest run src/services/normalization/__tests__/golden.test.ts -t "betters"` and `-t "lebull"`. Expected: PASS with `[golden] betters/premier-league_leeds-united_tottenham-hotspur: entries=242 blessed=242 unblessed=0 failures=0`, and the same for lebull. Then run `npx tsc --noEmit && npx vitest run`.
- [ ] **Step 5:** Commit: `git add scripts/betby-evidence-archive.ts src/services/normalization/__fixtures__/betters src/services/normalization/__fixtures__/lebull && git commit -m "golden: Betby fixtures for betters and lebull (Leeds-Tottenham)"`

---

### Task 8: Smoke gate, live smoke, odds-outliers listing fix, acceptance

**Files:**
- Create: `src/scrapers/shared/betby/smoke-gate.ts`; Test: `src/scrapers/shared/betby/__tests__/smoke-gate.test.ts`
- Create: `scripts/betby-smoke.ts`
- Modify: `scripts/odds-outliers.ts:535-549`. `listMatches` reads `GET <backend>/api/odds?league=<slug>`; the parsing moves into a new export `matchPairsFromOddsList`. Test: add one case to `src/services/__tests__/odds-outliers.test.ts`, which already imports from `../../../scripts/odds-outliers.js` (`:2-7`).
- Modify (**owner, main checkout**, only if Task 0 ran): `src/config/index.ts` (restore `"betters", "lebull",` in `CONFIG.BOOKMAKERS` between `"etoto"` and `"betcris"`)

**Interfaces:**
- Produces (`smoke-gate.ts`, pure):
  - `oneXTwoDeviation(odds: number, peers: number[]): number | null`. Returns `null` when `peers.length < 3`, otherwise `Math.abs(odds / median(peers) - 1)`. This is the formula of `evidence/betters/1x2-vs-other-bookmakers-median.txt`.
  - `interface SmokeMatchRow { eventId: string; startTime: string; full: boolean; normalized: number; unknownInMapped: number; minOdds: number; apiFound: boolean | null; max1x2Dev: number | null }`
  - `interface SmokeGateOptions { nowMs: number; maxDays: number; minMarkets: number; maxListingOnly: number; max1x2Dev: number; maxDurationMs: number }`
  - `evaluateSmoke(snapshotCount: number, rows: SmokeMatchRow[], durationMs: number, o: SmokeGateOptions): { result: "PASS" | "FAIL" | "SKIP"; reasons: string[]; gated: number; shallow: number }`. The rules, in order:
    - `snapshotCount === 0` → SKIP.
    - `rows.length !== snapshotCount` → FAIL (A1), reason `matches=<rows> != snapshot=<S>`.
    - A row is *gated* when `Date.parse(startTime) - nowMs <= maxDays * 86_400_000`.
    - A gated full row with `normalized < minMarkets` → FAIL (A2).
    - A non-gated full row with `normalized < minMarkets` → counted in `shallow`, no FAIL.
    - Gated rows with `!full` > `maxListingOnly` → FAIL (A2).
    - Any `unknownInMapped > 0` or `minOdds < 1.01` → FAIL (A3).
    - Any `max1x2Dev > o.max1x2Dev` → FAIL (A4); `null` is ignored.
    - Any `apiFound === false` → FAIL (A5); `null` means no `--compare-api`.
    - `durationMs >= maxDurationMs` → FAIL (A8).
    - Every per-match reason names the eventId and the value, e.g. `2725446939305979931 normalized=34 < 50`.
    - The result is FAIL when any reason exists, otherwise PASS.
- Produces (`scripts/betby-smoke.ts`): `npx tsx scripts/betby-smoke.ts --bookmaker <betters|lebull> --league <slug> [--compare-api <url>] [--max-days 7] [--min-markets 50] [--max-listing-only 1] [--max-1x2-dev 0.10]`.
  - Consumes: `bettersScraper`/`lebullScraper` (`scrapeFullOffer`, then `lastRunStats` for `full`), `bettersNormalizer`/`lebullNormalizer`, `client.fetchSnapshot()` + `selectLeagueEvents` for `snapshotCount`, and `--compare-api` → `GET <api>/api/odds?league=<slug>` → `data.matches[].markets.MATCH_WINNER.bookmakerOdds[<other bm>].selections[].{normalizedName,odds}`.
  - Per match: `<eventId> <home> - <away> start=<iso> scope=<gated|far> markets=<n> normalized=<k> unknownInMapped=<u> full=<yes|no> 1x2=<h>/<d>/<a> dev=<pct|n/a> api=<found|missing|n/a>`.
  - Summary: `SMOKE <bm> <league>: matches=<N> (snapshot=<S>, gated=<G>, shallow=<H>) minNormalizedGated=<k> listingOnlyGated=<L> unknownInMapped=<U> max1x2Dev=<pct> durationMs=<ms> RESULT=PASS|FAIL|SKIP`, followed by one `  reason: …` line per FAIL reason.
  - Exit 0 on PASS or SKIP, 1 on FAIL. It ends with `process.exit`, so no handle can keep it alive (see evidence row 6).
- Produces (`scripts/odds-outliers.ts`): `export function matchPairsFromOddsList(body: unknown): { home: string; away: string }[]`. It reads `data.matches[].{homeTeam,awayTeam}` and drops entries with an empty name. `listMatches` fetches `/api/odds?league=…` and keeps its existing error when the list is empty.

- [ ] **Step 1: Write the failing tests.**

```ts
// src/scrapers/shared/betby/__tests__/smoke-gate.test.ts
const NOW = Date.parse("2026-11-06T17:12:00Z");
const O = { nowMs: NOW, maxDays: 7, minMarkets: 50, maxListingOnly: 1, max1x2Dev: 0.10, maxDurationMs: 15_000 };
const row = (eventId: string, startTime: string, normalized: number, full = true) =>
  ({ eventId, startTime, full, normalized, unknownInMapped: 0, minOdds: 1.01, apiFound: true, max1x2Dev: 0.04 });
// live 2026-11-06 (evidence/betters/phase1-counts-pl-2026-11-06.txt): 10 matches on 6-8 Nov with 66-73, Liverpool-Man Utd on 22 Nov with 34
const live = [
  row("2725815896848338956", "2026-11-06T20:00:00.000Z", 67), row("2725816334213586962", "2026-11-07T12:30:00.000Z", 68),
  row("2725816334213586981", "2026-11-07T15:00:00.000Z", 71), row("2725818574789816354", "2026-11-07T15:00:00.000Z", 72),
  row("2725824060671029267", "2026-11-07T17:30:00.000Z", 73), row("2726134779970986000", "2026-11-08T14:00:00.000Z", 72),
  row("2726134779970986001", "2026-11-08T14:00:00.000Z", 72), row("2726134779970986002", "2026-11-08T14:00:00.000Z", 71),
  row("2726134779970986003", "2026-11-08T14:00:00.000Z", 71), row("2726177353700085769", "2026-11-08T16:30:00.000Z", 66),
  row("2725446939305979931", "2026-11-22T16:30:00.000Z", 34)];

it("oneXTwoDeviation uses |odds / median - 1| over at least 3 peers", () => {
  expect(oneXTwoDeviation(2.74, [2.75, 2.8, 2.85])).toBeCloseTo(0.0214, 4);
  expect(oneXTwoDeviation(5.2, [5.0, 4.9, 5.1, 5.0])).toBeCloseTo(0.04, 4);
  expect(oneXTwoDeviation(2.74, [2.8, 2.7])).toBeNull();
});
it("evaluateSmoke reports a thin far-future match as shallow without failing", () => {
  expect(evaluateSmoke(11, live, 9_000, O)).toEqual({ result: "PASS", reasons: [], gated: 10, shallow: 1 });
  const wide = evaluateSmoke(11, live, 9_000, { ...O, maxDays: 30 });
  expect(wide.result).toBe("FAIL");
  expect(wide.reasons).toContain("2725446939305979931 normalized=34 < 50");
});
it("evaluateSmoke fails on dropped matches, listing-only, UNKNOWN, price and duration; skips an empty snapshot", () => {
  expect(evaluateSmoke(0, [], 500, O).result).toBe("SKIP");
  expect(evaluateSmoke(11, live.slice(0, 10), 9_000, O).reasons).toContain("matches=10 != snapshot=11");
  const twoListing = live.map((r, i) => (i < 2 ? { ...r, full: false, normalized: 7 } : r));
  expect(evaluateSmoke(11, twoListing, 9_000, O).result).toBe("FAIL");
  expect(evaluateSmoke(11, live.map((r, i) => (i === 0 ? { ...r, unknownInMapped: 1 } : r)), 9_000, O).result).toBe("FAIL");
  expect(evaluateSmoke(11, live.map((r, i) => (i === 0 ? { ...r, max1x2Dev: 0.12 } : r)), 9_000, O).result).toBe("FAIL");
  expect(evaluateSmoke(11, live.map((r, i) => (i === 0 ? { ...r, apiFound: false } : r)), 9_000, O).result).toBe("FAIL");
  expect(evaluateSmoke(11, live, 15_000, O).result).toBe("FAIL");
});

// src/services/__tests__/odds-outliers.test.ts (add)
it("matchPairsFromOddsList reads /api/odds?league= matches", () => {
  expect(matchPairsFromOddsList({ success: true, data: { matches: [
    { homeTeam: "AFC Bournemouth", awayTeam: "Nottingham Forest", markets: {} }, { homeTeam: "", awayTeam: "X" }] } }))
    .toEqual([{ home: "AFC Bournemouth", away: "Nottingham Forest" }]);
  expect(matchPairsFromOddsList({ success: false })).toEqual([]);
});
```

- [ ] **Step 2:** Run `npx vitest run src/scrapers/shared/betby/__tests__/smoke-gate.test.ts src/services/__tests__/odds-outliers.test.ts`. Expected: FAIL (missing exports).
- [ ] **Step 3:** Implement `smoke-gate.ts`, `scripts/betby-smoke.ts` (a thin wrapper: scrape, normalize, build `SmokeMatchRow[]`, call `evaluateSmoke`, print) and the `odds-outliers.ts` change. Run the tests (expected: PASS), then `npx tsc --noEmit && npx vitest run`.
- [ ] **Step 4: odds-outliers works again** (read-only against the running :3001):

```bash
cd $WT
npx tsx scripts/odds-outliers.ts --league premier-league --all-matches --quiet --out /tmp/outliers-pre.json; echo "exit=$?"
```

Expected: a JSON summary line with `"matches":20` (or the current PL count) and `exit=0`. Before this task the same command prints `[odds-outliers] fatal: Could not list matches from the API` and `exit=2`.
- [ ] **Step 5: Live smoke, one run per brand** (from the worktree; no DB; modest traffic: about 20 requests per brand):

```bash
cd $WT
timeout 180 npx tsx scripts/betby-smoke.ts --bookmaker betters --league premier-league --max-days 7 --compare-api http://localhost:3001
timeout 180 npx tsx scripts/betby-smoke.ts --bookmaker lebull  --league premier-league --max-days 7 --compare-api http://localhost:3001
```

Expected: `RESULT=PASS`, `matches` equal to `snapshot`, `minNormalizedGated ≥ 50`, `listingOnlyGated ≤ 1`, `unknownInMapped=0`, `max1x2Dev < 10%`, `durationMs < 15000`. A far match such as Liverpool–Man Utd appears with `scope=far` and counts in `shallow`. If PL fixtures have changed since 2026-11-06, the counts differ from 11; the criteria still apply. With no upcoming PL match: `RESULT=SKIP`, exit 0.
- [ ] **Step 6: Existing discovery command on a current event.** Take any eventId from the smoke output and run `timeout 180 npx tsx scripts/betters-market-discovery.ts --url "https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/x-<eventId>" --league premier-league | sed 's/\x1b\[[0-9;]*m//g' | grep -E "MATCH:|Total markets|Mapped:"`. Expected: `🏆 MATCH: <home> vs <away> (premier-league)` and `✅ Mapped: ≥ 50` for a gated match. The process exits on its own, because no browser is involved.
- [ ] **Step 7: The implemented eventUrls render in a browser.** Copy `$EV/betters/eventurl-check.mjs` to a scratch dir. Replace its two hard-coded URLs with the `eventUrl` of one gated match per brand, taken from the smoke output. Run it with `timeout 150 node <scratch>/eventurl-check.mjs <scratch>`. Expected per brand: `status: 200`, `finalUrl` equal to the requested URL, `leeds`/`tottenham` (renamed to the two team names) `true`, `notFound: false`. Check the two screenshots by eye: they must show the event header of that match, not a listing. Proven on the current URLs at 18:13 CET (`evidence/{betters,lebull}/eventurl-leeds-tottenham-2026-11-06.jpg`).
- [ ] **Step 8:** Commit in the worktree: `git add src/scrapers/shared/betby scripts/betby-smoke.ts scripts/odds-outliers.ts src/services/__tests__/odds-outliers.test.ts && git commit -m "betby: smoke gate and live smoke script; odds-outliers lists matches from /api/odds"`
- [ ] **Step 9 (owner, main checkout): go-live, A6 and A7.**
  1. Merge the branch into the main checkout (superpowers:finishing-a-development-branch). If Task 0 ran, restore both keys in `CONFIG.BOOKMAKERS`. Run `npx tsc --noEmit && npx vitest run`. Restart `npm run dev` (the merge itself restarts `tsx watch`; a manual restart makes sure all of `src/` is reloaded).
  2. Then run:

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3001/api/admin/scrape \
  -H "Authorization: Bearer ${ADMIN_API_KEY:-dev-api-key}" -H "Content-Type: application/json" \
  -d '{"league":"premier-league","bookmakers":["betters","lebull"]}'
# expected: {"success":true,"data":{"runId":"…-manual","status":"started",…}} then "HTTP 202"
# wait for "[Aggregator/FullOffer] betters completed: <n> matches, <N> markets saved" (N >= 500) and the same for lebull in the dev log
curl -s "http://localhost:3001/api/odds?league=premier-league" | python3 -I -c "import json,sys; d=json.load(sys.stdin)['data']['matches']; print(sum('betters' in m['markets'].get('MATCH_WINNER',{}).get('bookmakerOdds',{}) for m in d), sum('lebull' in m['markets'].get('MATCH_WINNER',{}).get('bookmakerOdds',{}) for m in d))"
npx tsx scripts/odds-outliers.ts --league premier-league --all-matches --quiet --out /tmp/outliers.json; echo "exit=$?"
python3 -I -c "import json;r=json.load(open('/tmp/outliers.json'));print(sum(1 for m in r['matches'] for f in m['findings'] if f['bookmaker'] in ('betters','lebull') and f['severity'] in ('MAJOR','BROKEN')))"
```

Expected: both counts ≥ the smoke's `snapshot` − 1; `exit=0`; the last line prints `0`. The report keys `matches[].findings[].{bookmaker,severity}` come from `scripts/odds-outliers.ts:100-114` (Finding), `:616-622` (perMatch entries) and `:661` (`matches: perMatch`). A7 is judged from this count, not from an exit code; `--fail-on major` would also fail on other bookmakers' findings. If the owner wants A6 before the merge, use the second instance on :3002 from Global Constraints and replace `localhost:3001` in the POST.

---

### Task 9 (owner-gated, after go-live): retire sbteam-era audit state in the frontend repo

Run this only after Task 8 Step 9 passes and the owner approves (open question 4). Ledger mutations go through the scraper repo's CLI; the files live in the frontend repo `/home/skamik/Documents/repositories/personal/aityper`. Its working tree has unrelated untracked files (`.claude/agents/ux-*.md`, …), so stage files **by name only**.

**Files (frontend repo):**
- Modify: `docs/audit-ledger/registry.json` (21 open lebull entries, via `scripts/audit-ledger-update.ts`)
- Modify: `docs/audit-ledger/coverage.json` (drop the `lebull` key)
- Move: `docs/audit-ledger/raw-archive/lebull/` → `docs/audit-ledger/retired-archive/lebull-sbteam/` (outside `raw-archive/`, so `build-coverage-baseline.ts:93-97` never re-reads it)
- Modify: `.claude/agents/{betters,lebull}-market-judge.md:17,56`, `.claude/agents/{betters,lebull}-audit-fixer.md:62`, `.claude/commands/audit-{betters,lebull}.md:257`, `.claude/commands/fix-from-audit-{betters,lebull}.md:236-241,410`

**Decisions:**
- **The 21 open lebull entries go `open → attempted → fixed-pending-rescrape`.** They are not closed. The ledger has no "closed" state. `stale-source` and `accepted-difference` would *suppress* any of these fingerprints that recur on Betby data (SPEC §2 suppression semantics). `fixed-pending-rescrape` is the ledger's designed path for "the code was replaced": the first Betby `/audit-lebull` prep plus `observe` turns each into `verified-fixed` (absent) or `regressed` (present, so re-judged).
- The 8 `accepted-difference` lebull entries are left alone. Their TTL `2026-08-08T00:00:00.000Z` has expired, so the next `observe` reopens them automatically.
- A bookmaker missing from `coverage.json` falls back to "flag the gap" (`scripts/match-audit-prep.ts:157-161`). Dropping the key is therefore safe; the Betby coverage rebuilds from new archives.

- [ ] **Step 1: Pin the starting state.**

```bash
python3 -I -c "import json;r=json.load(open('/home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json'))['entries'];ids=[k for k,e in r.items() if (e.get('fingerprint') or {}).get('bookmaker')=='lebull' and e.get('state')=='open'];open('/tmp/lebull-open-fps.txt','w').write('\n'.join(ids)+'\n');print(len(ids))"
```

Expected: `21`.
- [ ] **Step 2: Move the 21 entries to fixed-pending-rescrape.** `SHA` is the Task 5 commit ("betby: id-based UOF normalizer …") on the merged branch.

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api
REG=/home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json
SHA=$(git log --format=%h --grep "id-based UOF normalizer" -1)
while read -r fp; do
  npx tsx scripts/audit-ledger-update.ts attempt --id "$fp" --fixer betby-migration --commit "$SHA" \
    --note "sbteam lebull normalizer replaced by the Betby UOF normalizer (platform migrated 2026-08/11)" --registry "$REG" &&
  npx tsx scripts/audit-ledger-update.ts set --id "$fp" --state fixed-pending-rescrape --registry "$REG" || echo "FAILED $fp"
done < /tmp/lebull-open-fps.txt
python3 -I -c "import json,collections;r=json.load(open('$REG'))['entries'];print(dict(collections.Counter(e['state'] for e in r.values() if (e.get('fingerprint') or {}).get('bookmaker')=='lebull')))"
```

Expected: no `FAILED` line; `{'fixed-pending-rescrape': 21, 'accepted-difference': 8}` (key order may differ).
- [ ] **Step 3: Retire the sbteam coverage and archive.**

```bash
cd /home/skamik/Documents/repositories/personal/aityper
mkdir -p docs/audit-ledger/retired-archive && git mv docs/audit-ledger/raw-archive/lebull docs/audit-ledger/retired-archive/lebull-sbteam
python3 -I -c "import json;p='docs/audit-ledger/coverage.json';c=json.load(open(p,encoding='utf-8'));c.pop('lebull');open(p,'w',encoding='utf-8').write(json.dumps(c,indent=2,ensure_ascii=False)+'\n')"
python3 -I -c "import json;print('lebull' in json.load(open('docs/audit-ledger/coverage.json')))"; ls docs/audit-ledger/raw-archive | grep -c lebull
git diff --stat docs/audit-ledger/coverage.json
```

Expected: `False`, `0`, and a diff that only removes the `lebull` block (`indent=2, ensure_ascii=False` plus a trailing newline round-trips today's file byte-identically, checked 2026-11-06). `build-coverage-baseline.ts` defaults resolve outside both repos since the split (`REPO_ROOT` at `:28`), so any later rebuild must pass `--archive /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/raw-archive --out /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/coverage.json`.
- [ ] **Step 4: Repoint the audit tooling** at the shared rule table. Keep each file's existing language.
  - Wherever the files tell a fixer to add `<marketTypeId>: "<CODE>"` to `BETTERS_MARKET_ID_TO_CODE`/`LEBULL_MARKET_ID_TO_CODE`, or to edit `betters-normalizer.ts`/`lebull-normalizer.ts`, replace that with: add or adjust the rule for the **UOF market id** in `BETBY_MARKET_RULES` (`aityper-scraper-api/src/services/normalization/bookmakers/betby-market-rules.ts`). Outcomes map by `selection.externalId` (the UOF outcome id), and lines come from `paramValue` specifiers (`total=2.5`, `hcp=-1.5`, `hcp=1:0`).
  - Add one line to each of the 8 files: *a rule change affects betters and lebull together; the per-brand normalizer files are thin `createBetbyNormalizer(...)` instances; check the other brand's golden too.*
  - Expected: `grep -rn "BETTERS_MARKET_ID_TO_CODE\|LEBULL_MARKET_ID_TO_CODE" /home/skamik/Documents/repositories/personal/aityper/.claude/` → no output.
- [ ] **Step 5:** Commit in the frontend repo, on a branch the owner chooses, with no attribution footer: `git add docs/audit-ledger/registry.json docs/audit-ledger/coverage.json docs/audit-ledger/retired-archive docs/audit-ledger/raw-archive .claude/agents/betters-market-judge.md .claude/agents/lebull-market-judge.md .claude/agents/betters-audit-fixer.md .claude/agents/lebull-audit-fixer.md .claude/commands/audit-betters.md .claude/commands/audit-lebull.md .claude/commands/fix-from-audit-betters.md .claude/commands/fix-from-audit-lebull.md && git commit -m "audit: retire sbteam-era lebull ledger/coverage; point betters/lebull tooling at Betby rules"`

---

## Self-Review

1. **Spec coverage:**
   - (1) discovery vs hardcode → Observations plus Task 2.
   - (2) manifest/chunk protocol, tournament subset, event endpoint → Observations plus Task 3.
   - (3) UOF inventory and mapping → Observations tables plus Task 5 (phase 1); phase 2 and unmappable are listed for a follow-up plan.
   - (4) carry-over knowledge → Impact table, with the 1.01 floor and param formats enforced in Tasks 4–5.
   - (5) 19-digit strings → Global Constraints, Review Focus 2, tests in Tasks 4 and 6, `leagues.ts` in Task 6.
   - (6) trailing spaces, outrights, live, missing events (HTTP 200 without `events`), far-future thin events → Task 4 `selectLeagueEvents` tests, Task 3 `fetchEvent` null tests, Task 6 fallback and thin-event tests.
   - (7) golden fixtures → Task 7 (and the retirement in Task 5).
   - (8) bookmaker keys → verified at `aityper/src/lib/bookmakers.ts:15-16,93-106` and kept by Global Constraints.
   - The stop-gap is Task 0 (owner, main checkout, with its API side effects listed). The other-brands check is a note.
   - Acceptance A1–A8 → Task 8 (`smoke-gate.ts` unit-tested; A7 made runnable by the odds-outliers fix; A6/A7 only after merge and restart).
   - Prior audit knowledge that is lost (ledger, coverage, audit tooling) → owner-gated Task 9.
   - Worktree feasibility (untracked evidence, no `node_modules`) → Task S and absolute `$EV` paths.
2. **Step scan:** every code step names its file, signature and pinned values. Algorithm text appears only for the snapshot chain, template rendering, line classification and emission policy, which the signatures do not determine. No TBDs.
3. **Type consistency:**
   - `BetbyEventRef.listingMarkets: BetbyMarkets` (Task 2) is used by Task 6.
   - `buildScrapedMarkets(markets, descriptions, competitors)` is the same signature in Tasks 4, 5 and 7.
   - `createEvidenceFetch(bm, { failures, overrides, overridesOnce })` is the same in Tasks 2, 3 and 6; an absent `event-<id>.json` yields HTTP 200 with `event-missing-envelope.json` everywhere.
   - `BetbyScraperDeps` (Task 6) wraps the `fetchText`/`now` deps of Task 3's client.
   - `BetbyScraper.lastRunStats` (Task 6) is what `scripts/betby-smoke.ts` (Task 8) turns into `SmokeMatchRow.full`.
   - `formatSignedLine(0) === "0"` (Task 4) is what produces `ASIAN_HANDICAP:0` and `FIRST_HALF_ASIAN_HANDICAP:0` (Tasks 5 and 7) under the D1 default.
4. **Review Focus:** each of the six lines has a named test in its owning task: 1→Task 3, 2→Tasks 4/6, 3→Task 4, 4→Tasks 3/6, 5→Task 5, 6→Tasks 6/8. Discovery fallback is also tested (Task 2).
5. **Proportion:** the code blocks are tests and signatures. The bodies of the rule table, client and parser are left to the implementer. The evidence-derived values are what the plan pins.
