# LVBet Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
1. Restore the LVBet player-stat props and the exact-goals markets lost to LVBet API/offer changes since August.
2. Stop the misroutes that drop LVBet from the O/U 2.5 and 3.5 comparison (20/20 Premier League matches) and from half-time O/U line 1 (20/20) and line 2 (7/20), and the one that puts "X or Y" pairs into single-player PLAYER_GOAL_OR_ASSIST.

**Architecture:** Four focused fixes in the LVBet pipeline. No catalog change.
1. The parser types are aligned with the real `client-api/v5` payload (`market_id`, `selection_id`, `markets_class_id`, numeric `line`), so de-duplication no longer collapses distinct markets that share a name.
2. A parser splitter turns the new "Zawodnicy - statystyki" ladder markets (`"<Player> <N>+"`) into per-player markets. These reuse the existing `"Powyzej X"` → `"N+"` normalizer path. Exact-name normalizer patterns are added for them and accept only parser-split rows (with `paramValue`).
3. Three goal-family products are routed out of the `TOTAL_GOALS` catch-all, the half-time 3-way total out of `HALF_TIME_TOTAL_GOALS`, and the goal-or-assist pair market out of `PLAYER_GOAL_OR_ASSIST`.
4. The shared prep-audit archive keeps `paramValue`, so the per-player rows can be frozen in a golden fixture.

**Tech Stack:** TypeScript (NodeNext ESM), Vitest, tsx; Playwright only for the live smoke test.

**Spec:** the Observations section of this file. Evidence: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/`. Raw API capture: `markets-search-arsenal-hull-full-2026-11-06.json`. Test input: `markets-search-arsenal-hull-trimmed.json` (39 raw markets). A/B result: `offline-ab-summary.json`. Tools: `tools/` (`lvbet_ac.py` is the live acceptance checker).

## Observations (pre-fix analysis)

### Status today: DEGRADED

| Metric | August baseline | Today | Verdict |
|---|---|---|---|
| Matches scraped (run 2 `440d2fc6`) | 20/20 | 20/20; 9,757 parsed, 9,427 saved | ok |
| Parsed markets, near-term match (log) | **1,378** raw markets / 3,940 sel. (Arsenal–Coventry, `aityper/docs/match-audit/.tmp/raw/premier_league_arsenal_coventry_city.json`; 886 of them per-player rows) | **615–664** (10 near-term matches; Arsenal–Hull 628, of which 86 per-player rows); far-dated 338–353 | **−54 %** |
| LVBet's own `state.markets_count` | — | 545–600 near-term, 343–358 far-dated (`evidence/lvbet/competition-view-2026-11-06.json`) | — |
| Offline A/B: CURRENT normalizer on Aug raw vs on today's live Arsenal–Hull | 1,378 mk, 162 codes, 3,899 sel., **UNKNOWN 22.2 %**, OTHER 10.8 % mk / 19.2 % sel. | 628 mk, 160 codes, 5,415 sel., **UNKNOWN 59.9 %**, OTHER 24.0 % mk / 51.1 % sel. | **degraded** |
| DB `market_comparison` per match: rows / codes / sel. / UNKNOWN / OTHER rows | — | Ars–Hul 613 / 160 / 5,219 / 58.6 % / 151; Lee–Tot 603 / 172 / 5,044 / 57.8 % / 155; Eve–Cov 635 / 179 / 4,960 / 57.3 % / 161; MCI–FUL 339 / 99 / 1,581 / 44.5 % / 87 | degraded |
| League-wide OTHER | — | 2,476 rows of 9,427, 31,784 OTHER selections | — |
| Codes visible in API (normalized-markets) | 162 (Aug API dump) | 160 (Ars–Hul), 172 (Lee–Tot), 99 (MCI–FUL) | count similar, content differs |
| Codes lost (A/B, offer-independent) | — | PLAYER_SHOTS (Aug 261 rows), PLAYER_SHOTS_ON_TARGET (151), PLAYER_FOULS (186), PLAYER_FOULS_WON (175), PLAYER_GOAL_AND_ASSIST, HOME_EXACT_GOALS, HALF_TIME_HOME_EXACT_GOALS, BOTH_TEAMS_2PLUS_CARDS (RED_CARDS_TOTAL "lost" only because today's offer has just the 0.5 line, which aliases to RED_CARD) | **regression** |
| LVBet in API `TOTAL_GOALS` 2.5 / 3.5 | missing (Aug API dump also had no LVBet at 2.5) | **missing in 20/20 matches** (all 20 `normalized-markets` fetched ~18:30). DB rows `TOTAL_GOALS:2.5` and `:3.5` contaminated in **20/20** matches; `:1.5` clean in 20/20 | pre-existing, high impact |
| LVBet in API `HALF_TIME_TOTAL_GOALS` 1 / 2 | — | **missing in 20/20** at line 1 and in **7/20** at line 2 (the 7 matches that offer the 3-way line 2) | pre-existing, high impact (root cause C) |
| LVBet `PLAYER_GOAL_OR_ASSIST` | — | base entry merges the single-player market with "X or Y" pairs: Ars–Hul 48 selections, 10 of them pairs (e.g. `Christos Tzolis or Kai Havertz` @1.18); pairs present in 6/20 matches | pre-existing misroute (root cause D) |
| `externalId` of LVBet selections | "undefined" | "undefined" for 100 % of selections | pre-existing |
| `[FullOfferRepo] marketKey collision ... for lvbet` | — | 148 lines per run, broken down in the collision table below (`evidence/lvbet/run2-marketkey-collisions.txt`) | symptom |
| 1X2 max deviation vs peer median (20 matches) | — | 12.6 % (MCI–FUL DRAW 5.35); no swaps, no x10 | ok |
| O/U 1.5 vs peers | — | within ±12 % (MCI–FUL UNDER 5.6) | ok |
| Team-name merge | 20/20 | 20/20 share their `matchId` with peers, 0 orphans, 0 duplicates | ok |
| `aityper/docs/audit-ledger/coverage.json` (bookmaker → catalog code → selection codes, built 2026-07-09 from World Cup France–Morocco) | 185 codes | 182 codes across 3 PL matches; 59 coverage.json codes are absent. Most are codes merged by the August catalog clean-up (e.g. PLAYER_FOULS_OVER → PLAYER_FOULS) or World Cup-only markets. The real losses are the A/B list above | weak baseline (code churn) |
| Tests | — | `src/scrapers/bookmakers/lvbet` 3/3. Golden `lvbet/world-cup-2026_france_morocco`: 971 entries, 418 blessed, 0 failures | green but blind (see root cause B) |

Sources: `evidence/lvbet/run2-log-lines.txt`, `db-stats-2026-11-06.txt`, `offline-ab-summary.json`, `mw-1x2-sanity-2026-11-06.txt`, `ou-sanity-2026-11-06.txt`, `db-total-goals-rows-arsenal-hull.json`.

### Symptom in logs
- LVBet has no per-bookmaker "unmapped" warning, so nothing in the log names the regression.
- It shows up only as generic `[Normalizer] Market mapped to OTHER` lines (7,993 per run across all bookmakers) and as `[FullOfferRepo] marketKey collision ... "D. Rice & R. Calafiori" for lvbet TOTAL_GOALS` (two per near-term match).

### Root cause A (bookmaker change): player-stat props moved to a new market shape
- **August:** one bulk market per stat and threshold, e.g. `Zawodnicy (strzały) - powyżej 2.5 (musi rozpocząć w wyjściowej "11")` with `line=2.5` and the selections being bare player names.
- **Today:** one market per stat in `markets_group.name = "Zawodnicy - statystyki"`, with selections `"<Player> <N>+"`. Evidence: `markets-search-arsenal-hull-trimmed.json`.

| Raw name today | `markets_class_id` | Tiers seen | Target code | Catalog tiers | August equivalent |
|---|---|---|---|---|---|
| Strzały | 12238 | 1–6 | PLAYER_SHOTS | 1+…9+ | Zawodnicy (strzały) |
| Strzały celne | 12237 | 1–4 | PLAYER_SHOTS_ON_TARGET | 1+…7+ | Zawodnicy (strzały celne) |
| Popełnione faule | 15882 | 1–5 | PLAYER_FOULS | 1+…4+ (5+ dropped) | Zawodnicy (faule popełnione) |
| Faule na zawodniku | 15872 | 1–5 | PLAYER_FOULS_WON | 1+…4+ (5+ dropped) | Zawodnicy (faule zarobione) |
| Odbiory (tackle) | 15871 | 1–5 | PLAYER_TACKLES | 1+…8+ | Odbiory- tackles (never matched in PL) |
| Asysty | 12239 | 1 | PLAYER_ASSISTS | 1+, 2+ | — |
| Spalone zawodnika | 15873 | 1–3 | PLAYER_OFFSIDES | 1+…3+ | — |
| Obrony bramkarza | 15878 | 1–7 | PLAYER_SAVES | 1+…7+ | Obrony bramkarza - powyżej X (GOALKEEPER_SAVES_OVER) |
| Strzały celne głową | 15869 | 1–3 | PLAYER_HEADER_SHOTS_ON_TARGET | 1+…3+ | — |
| Strzały celne spoza pola karnego | 15877 | 1–3 | PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX | 1+…3+ | — |
| Strzały spoza pola karnego, Strzały celne lewą/prawą nogą, Strzały celne zawodnika - 1. połowa / 2. połowa / Każda połowa, Strzały w obramowanie (słupek/poprzeczka), Podania celne, Podania (celne + niecelne) | various | — | **stay OTHER** (no player-parameter catalog code; see open questions) | — | — |

Our parser knows only the old names (`BULK_PLAYER_LIST_MARKET_PATTERNS`, `src/scrapers/bookmakers/lvbet/parser.ts:324-401`), and so does the normalizer (player-props block, `src/services/normalization/bookmakers/lvbet-normalizer.ts:292-320`). As a result all 19 new markets land in OTHER with UNKNOWN selections. That is 1,799 selections in Arsenal–Hull, the bulk of the UNKNOWN jump.
- Proven on the current code: `lvbet-market-discovery --market "Strzały"` reports `Total markets: 11 / Mapped: 0 / Unmapped/OTHER: 11` (`evidence/lvbet/discovery-strzaly-summary-2026-11-06.txt`).
- The old shape still maps: probe `"Zawodnicy (faule popełnione) - powyżej 0.5 …" + paramValue "Ben White"` gives `PLAYER_FOULS:Ben White`, `1+` @1.6.

### Root cause B (our bug, exposed by the new offer): the parser types do not match the payload
- `LVBetMarket.id` (`src/scrapers/bookmakers/lvbet/types.ts:39`) and `LVBetSelection.id` (`types.ts:23`) do not exist in the API. The real fields are `market_id: "bc:2511214432"` and `selection_id: "bc:7392424555"`. `line` is a number (`1.75`), not the declared `string` (`types.ts:47`).
- Consequences:
  1. `parseAllMarkets` de-duplicates by `` `${market.name}_${market.line}` `` because `market.id` is always undefined (`parser.ts:472-475`). LVBet now publishes **two markets with the same name and line**: `"Arsenal - Dokładna liczba goli"` exact (class 6251: 0/1/2/3/4+) and a range variant (class 2287: "0 lub 1"/"2 lub 3"/"4 do 6"/"7 lub więcej"). The same happens for `"1. Połowa - Arsenal dokładna liczba goli"` (2468 exact vs 2744 range) and for `"Dokładna liczba goli"` (2039 digits vs 3944 "Bez goli"/"Dokładnie N"). Because the range variant comes first, the exact one is silently dropped, and that loses HOME_EXACT_GOALS and HALF_TIME_HOME_EXACT_GOALS. The probe confirms the dropped exact variant would map: `HOME_EXACT_GOALS` 0 @7.25, 1 @4.75, 2 @3.4, 3 @3.8, 4+ @3.1. On the evidence, the current parser returns only the range variant for each of the 3 names. Five names are affected in total. For the two Hull City names (6745/1830 and 2063/2022) the exact variant comes first, so only the range variant is dropped, and it normalizes to null anyway. De-duplicating by `market_id` therefore adds exactly 5 markets.
  2. `bookmakerMarketId` is never set (`parser.ts:305, 444`). The August raw bundle also had 0 of 1,378 markets with an id, so this predates August.
  3. `externalId: String(s.id)` gives the literal string `"undefined"` (`parser.ts:268`), for 100 % of LVBet selections in the DB.
  4. `parseExtendedMarkets` throws `TypeError: market.line.includes is not a function` on live data (`parser.ts:543-545`). Reproduced on the evidence. This is latent, because `scrapeMatchDetails` has no caller in `src/`.
- The unit tests did not catch any of this because they use a synthetic `{ id: 998877, line: "2.5" }` (`src/scrapers/bookmakers/lvbet/__tests__/parser.test.ts:11-20`).

### Root cause C (pre-existing since at least August, high impact): the TOTAL_GOALS catch-all swallows other products
`{ pattern: /suma goli|liczba goli|dokładna liczba goli|gole|bramek/, code: "TOTAL_GOALS" }` (`lvbet-normalizer.ts:98`) catches:
- `Rezultat lub ilość bramek (X)` (6 legs "<team|Remis> lub powyżej/poniżej (X)") → `TOTAL_GOALS:X`. The repository merges these into the real `Liczba goli X` row (`db-total-goals-rows-arsenal-hull.json`: 6 UNKNOWN + OVER 1.55 / UNDER 2.5). The grouper's 3-way guard (`src/services/market-type-grouper.ts:925-932`) then drops the whole LVBet entry, so **LVBet is absent from O/U 2.5 and 3.5 (4.5 too, where offered) in every PL match**. The real product is RESULT_OR_TOTAL, which etoto/forbet/fortuna/superbet already quote: HOME_OVER 1.09–1.10, against LVBet's 1.09.
- `Obaj gracze strzelą łącznie przynajmniej N gole` (new since August, classes 11754–11756, 67–171 player pairs) → `TOTAL_GOALS` base. This is the source of 20 collisions per run. The real product is TWO_PLAYERS_COMBINED_GOALS at line N−0.5: betclic quotes `K. Havertz & V. Gyokeres` @2.15 at 1.5, LVBet @2.12.
- `Dokładna liczba goli` (match level) → `TOTAL_GOALS` base with UNKNOWN selections. It should be EXACT_GOALS for the digit variant; the "Bez goli/Dokładnie N" twin carries identical prices and stays OTHER.

The same mechanism hits the half-time totals, through a different route:
- `1. połowa - Liczba goli (3-drogowo) N` (class 5196, lines 1.0 and 2.0, legs Powyżej/Dokładnie/Poniżej) maps to `HALF_TIME_TOTAL_GOALS:N` via the generic half-time heuristic (`lvbet-normalizer.ts:989-998`). In the payload it comes before the real 2-way `1. Połowa - Liczba goli N` (index 120 vs 538), and the two are merged into one row. The grouper guard then drops LVBet's whole entry (`market-type-grouper.ts:911-932`; its comment names this exact LVBet market). As a result LVBet is absent at half-time line 1 in 20/20 matches and at line 2 in 7/20.
- Offline today, two markets land on `HALF_TIME_TOTAL_GOALS:1.0`: `[OVER 2.22, UNKNOWN 2.7, UNDER 3.8]` and `[OVER 1.47, UNDER 2.55]`.
- `HALF_TIME_TOTAL_GOALS_3WAY` exists but is `hasParameter: false` (`market-catalog.ts:5472-5478`), so it cannot hold lines 1 and 2. betcris already excludes the same shape (`betcris-normalizer.ts:1400-1410`). This predates August: WC golden #816 has the same output, unblessed.

`Wynik i liczba goli (przedział)` is also caught here (it was in August too). It lands in the base bucket, which the grouper discards, so nothing reaches users. It is out of scope.

### Root cause D (bookmaker renames)
- `Strzeli gola i zaliczy asystę` → `Zawodnik strzeli gola i zanotuje asystę` (class 15390). This loses PLAYER_GOAL_AND_ASSIST (pattern at `lvbet-normalizer.ts:477`).
- `Obie drużyny otrzymają min. 2 kartki` → `Oba zespoły otrzymają 2 lub więcej punktów za kartki (ŻK-1p. CzK-2p.)` (class 12766). This is now **points**-based (a red card counts 2), so it is not the same bet as BOTH_TEAMS_2PLUS_CARDS, which counts cards. It stays OTHER (open question 2).

Related misroute, pre-existing (missing from the August PL raw, but present and **blessed** in WC golden #22 in July):
- `Zawodnik strzeli gola lub zanotuje asystę - Podwójna szansa` (class 13940, selections `"<A> or <B>"`) is caught by the unanchored `/zawodnik strzeli gola lub zanotuje asyste/` (`lvbet-normalizer.ts:440`). It lands in PLAYER_GOAL_OR_ASSIST, the single-player market. In the live API for Ars–Hul, the LVBet base entry has 48 selections, 10 of them fake "players" such as `Christos Tzolis or Kai Havertz` @1.18, and `rawMarketName` lists both raw markets.
- The real product is TWO_PLAYERS_GOAL_OR_ASSIST ("Którykolwiek z dwóch: gol lub asysta", `market-catalog.ts:1831`). betclic quotes it as `C. Tzolis & K. Havertz` 1.16, `K. Havertz & M. Odegaard` 1.21 and `C. Tzolis & M. Odegaard` 1.24; LVBet's prices are 1.18, 1.2 and 1.22.
- Precedent: the sibling `Zawodnik zanotuje asystę - Podwójna szansa` (class 13941, same `"<A> or <B>"` labels) already maps to PLAYER_ASSIST_PAIRS (`:465`) through `canonicalizePlayerComboSelection`, and pools with betclic.

### marketKey collisions in run 2 (148 lines)

| Key | Lines | Matches | Cause | Verdict |
|---|---|---|---|---|
| `TOTAL_GOALS` (base) | 20 | 10 near-term, 2 each | `Obaj gracze …` pairs (root cause C) | Task 3 → 0 |
| `HALF_TIME_TOTAL_GOALS:1.0` / `:2.0` | 20 / 7 | 20 / 7 | 3-way half-time total merged into the 2-way line (root cause C) | Task 3 → 0 |
| `HALF_TIME_TOTAL_GOALS:0.5`, `SECOND_HALF_TOTAL_GOALS:0.5` | 20 + 20 | 20 | `Gol w N. połowie` (Tak/Nie) is the 0.5 line by design (audit cluster #10, `lvbet-normalizer.ts:424-425`); prices equal or within 0.1 (Ars–Hul 1.25/3.6 vs 1.25/3.7) | benign duplicate, unchanged |
| `SECOND_HALF_ASIAN_HANDICAP:-1` / `:-1.5` | 19 / 16 | 19 (all except Ars–Hul) | Not reproduced. Ars–Hul, the only full raw capture, quotes one direction per line and has no collision. Suspected sign loss when both directions of a line are quoted | out of scope, open question 6 |
| `HALF_TIME_CARDS_TOTAL:0.5/1.0/1.5` | 10 | 8 | `Żółte kartki - 1. połowa: Suma` (yellow-card count, `:190`) and `Kartki - 1. połowa: Suma punktów` (points, `:230`) share the code by design (audit cluster #0). From line 1.5 up they are different bets | out of scope, open question 5 |
| `TEAM_TOTAL_SHOTS_ON_TARGET`, `TEAM_TOTAL_FOULS` (base) | 7 + 1 | 1 (Eve–Cov) | not investigated (no raw capture); base key means no side/line param was found | out of scope |
| `HALF_TIME_TOTAL_GOALS`, `SECOND_HALF_TOTAL_GOALS` (base) | 4 + 4 | 4 | `(przedziały)`/`(przedział)` range ladders on the base key, all selections UNKNOWN; the API shows no base row (Ars–Hul) | out of scope (invisible) |
| `EXACT_GOALS` | 0 today | — | would appear after Task 3: `Dokładnie 1 gol w meczu` "1" plus the digit ladder's "1" (WC fixture: 4.05 vs 3.55 for the same match) | Task 3 routes the Yes/No to OTHER → 0 |

Expected after the fix: 148 − 20 − 27 = **101** lines for a comparable run (the count depends on the offer).

### What still works and must not break
- 1X2 and the other core markets: `TOTAL_GOALS:1.5`, BTTS, DOUBLE_CHANCE, handicaps and corners are present in API for 3/3 matches.
- The old bulk shapes, which may return for other leagues: `lvbet-audit-fixes.test.ts` P1/p1 cases and the golden blessed entries such as `#335 Obrony bramkarza - powyżej (2.5) 2.5 → GOALKEEPER_SAVES_OVER` and `#140 Strzeli gola i zaliczy asystę → PLAYER_GOAL_AND_ASSIST`.
- Team-scoped exact goals for the away side, and the `(przedział)` GOAL_RANGE routes (`lvbet-normalizer.ts:81-82`).
- The single-player `Zawodnik strzeli gola lub zanotuje asystę` (WC golden #190, blessed) stays PLAYER_GOAL_OR_ASSIST. The pair pattern is more specific and is placed before `:440`.

### Impact
- **Parser:** Tasks 1–2.
- **Normalizer:** Tasks 2–3.
- **Audit harness:** Task 4 makes `buildPrepAuditOutput` archive `raw.paramValue` (`src/services/audit/scraper-audit-core.ts:370-376`, type `src/services/audit/types.ts:47-53`). Without it every harvested per-player ladder row loses its player, and harvest re-normalizes `Strzały` + `Powyzej 2.5` to `PLAYER_SHOTS:2.5` (prototype-verified). `betby-betters-lebull.md` Task 1 plans the same passthrough; whichever lands first does it. Committed fixtures do not change.
- **Catalog:** none. Codes and tiers already exist (TWO_PLAYERS_GOAL_OR_ASSIST included), so do not run `sync-market-types.ts`.
- **Grouper:** none. The 3-way guard is correct; its input was wrong (`TOTAL_GOALS` and `HALF_TIME_TOTAL_GOALS`).
- **Golden fixtures:** the WC fixture has no ladder names. These WC entries change:
  - Task 2: blessed `#22` (goal-or-assist pairs, blessed on the misroute).
  - Task 3: blessed `#257 Dokładnie 1 gol w meczu`, plus the unblessed `#230 Dokładna liczba goli`, `#775/#834/#839 Rezultat lub ilość bramek` and `#816 1. połowa - Liczba goli (3-drogowo) 1`. Task 3 pins the unblessed ones first.
  - Task 5 adds a PL fixture.
- **Repository:** OTHER storage keys of LVBet now include `bookmakerMarketId`. The suffix becomes `OTHER:id:<class>:<hash>` instead of a name hash only (`full-offer-repository.ts` `resolveStorageMarketKey`). This is a one-time key change and harmless: the view reads the latest scrape.
- **Prior audit knowledge:** August audit items about `Zawodnicy (…)` threshold splitting (rounds 8 and 14) remain valid for the old shape but no longer apply to current PL data.

### Risks & unknowns
- Offer timing and calendar: the ladders exist only for near-term matches. On 2026-11-06 the 10 matches of Nov 6–8 had them (Everton–Coventry kicks off tonight). The 10 matches of Nov 21–23 (after the international break) have 338–353 markets and no ladders, and when LVBet publishes them is unverified. If the fix is deployed after Nov 8, the live ladder checks have nothing to measure until then. The offline acceptance block below does not depend on the calendar.
- Name drift: the split is gated on `markets_group.name === "Zawodnicy - statystyki"` and on every selection matching `"<Player> <N>+"`. If either fails, the parser leaves the ladder unsplit and the normalizer's `paramValue` guard (Task 2) returns null, so the ladder falls back to OTHER instead of leaking `"Abdulkadir Omur 1+"` as a player code. Detection: the smoke test count and `lvbet_ac.py --ladders` (missing codes).
- Tier cut-off: LVBet's 5+ tier for fouls and fouls won is dropped (catalog stops at 4+). It affects few players (e.g. Tim Iroegbunam 5+ @9.0).
- Repository merge: per-player rows from LVBet's ladder now key as `PLAYER_X:<Player>`, like the August shape. Peers merge via `reconcilePlayerNameVariants`, which was verified for full names. LVBet uses full names ("Viktor Gyokeres").
- Price identity of the ladders, checked offline (LVBet raw vs peers in today's API, tiers quoted by ≥ 2 peers, share within ±30 % of the peer median):
  - PLAYER_SHOTS 88 %, PLAYER_FOULS 98 %, PLAYER_SAVES 100 %, PLAYER_OFFSIDES 92 %, PLAYER_ASSISTS 84 %;
  - PLAYER_SHOTS_ON_TARGET 74 %, PLAYER_HEADER_SHOTS_ON_TARGET 69 %, PLAYER_TACKLES 63 %; median deviations −13 %, −18 % and +11 %, and every other LVBet ladder is much further off, so the identity holds;
  - **PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX 38 %**, median −36 % (sts −42 %, betfan −25 %, fortuna −6 %). It is still the closest of the five LVBet shot ladders, but this is open question 7.
- `markets_class_id` is not 1:1 with a product: 300 classes in Ars–Hul, 23 of them cover more than one name (3264 covers `Rzuty rożne: Suma` and `… (3-drogowo)`; 3944 covers the `Dokładna liczba goli` twin and `Dokładnie N gol(e) w meczu`).
- Selection `status` in the payload is `open` (5,476) or `suspended` (9), never `active`. `convertSelections` (`parser.ts:269`) maps only `active`. This is left as is on purpose: nothing downstream reads selection `status` (`src/types/full-offer.ts:26` only declares it).

### Open questions for the owner
1. Map the unmapped ladders?
   - `Strzały spoza pola karnego` → PLAYER_SHOTS_OUTSIDE_BOX and `Strzały celne zawodnika - 1. połowa` → PLAYER_SHOTS_ON_TARGET_1H both need `hasParameter: true, parameterType: "player"` plus extra tiers in the catalog, then `sync-market-types.ts`.
   - `Podania celne` vs `Podania (celne + niecelne)`: which one does PLAYER_PASSES mean (accurate or total passes)?
2. Should the points-based "Oba zespoły otrzymają 2 lub więcej punktów za kartki" get its own catalog code, or stay OTHER?
3. Should the catalog extend PLAYER_FOULS / PLAYER_FOULS_WON with "5+" (catalog change plus sync)?
4. Make `HALF_TIME_TOTAL_GOALS_3WAY` parameterized (`hasParameter: true, parameterType: "decimal"`, like TOTAL_GOALS_3WAY)? Then both LVBet's and betcris' half-time 3-way lines could map instead of going to OTHER. That is a catalog change plus sync.
5. `HALF_TIME_CARDS_TOTAL` merges a yellow-card count with card points (collision table). Keep the merge, or route the yellow-only market elsewhere?
6. `SECOND_HALF_ASIAN_HANDICAP:-1`/`-1.5` collides in 19/20 matches. Investigating it needs a raw capture of a match whose half-time handicap ladder quotes both directions. Should that be a follow-up?
7. Is LVBet `Strzały celne spoza pola karnego` the same product as the peers' PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX, given the −36 % median price gap? Task 2 maps it (best match). If the owner says no, drop that one pattern.

### Acceptance criteria

`EV=docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet`, run from the checkout under test. The tools take `REPO_ROOT` to pick the checkout whose `src/` they import (default: the main checkout).

**Offline, calendar-independent (run after Task 3 on the committed full capture).** All commands below were run on the current code on 2026-11-06; the "today" values are their real output.
```bash
OUT=$(mktemp -d)
REPO_ROOT=$PWD npx tsx $EV/tools/lvbet-parse.ts $EV/markets-search-arsenal-hull-full-2026-11-06.json Arsenal "Hull City" $OUT/parsed.json
REPO_ROOT=$PWD npx tsx $EV/tools/offline-norm.ts $OUT/parsed.json lvbet Arsenal "Hull City" premier-league $OUT/norm.json
python3 -I -c 'import json,sys,collections; c=collections.Counter(r["key"] for r in json.load(open(sys.argv[1]))["rows"] if r["code"]!="OTHER"); print(sorted(k for k,n in c.items() if n>1))' $OUT/norm.json
```
- O1. Parse line: `{"rawCount":549,"parsed":965,"withParam":428}`. Today it is `628`/`86`. The arithmetic is 628 − 10 unsplit ladders + 342 per-player rows (41 players) + 5 same-name twins.
- O2. `unknownPct` ≤ **40**. Today it is 59.9; a scratch prototype of Tasks 1–3 gives ≈ 35.
- O3. Duplicate non-OTHER keys are exactly the benign/out-of-scope whitelist from the collision table: `['HALF_TIME_CARDS_TOTAL:0.5', 'HALF_TIME_TOTAL_GOALS', 'HALF_TIME_TOTAL_GOALS:0.5', 'SECOND_HALF_TOTAL_GOALS', 'SECOND_HALF_TOTAL_GOALS:0.5']`. Today the list also contains `HALF_TIME_TOTAL_GOALS:1.0`, `:2.0`, `PLAYER_GOAL_OR_ASSIST`, `TOTAL_GOALS`, `TOTAL_GOALS:2.5`, `:3.5` and `:4.5`.

**Live, after the owner deploys or restarts and one scheduled run completes.** L1 and L3 need the first matchweek whose ladders are published (see Risks); the others work on any run.

Fetch `/api/odds` and all 20 `normalized-markets` dumps. This loop was run on 2026-11-06 and wrote 20 files:
```bash
NM=$(mktemp -d) && curl -s "http://localhost:3001/api/odds?league=premier-league" -o $NM/odds.json && python3 -I -c 'import json,sys,urllib.parse as u; [print(u.quote(m["homeTeam"]), u.quote(m["awayTeam"]), m["matchId"].split(":",1)[1].replace(":","_").replace(" ","-")) for m in json.load(open(sys.argv[1]))["data"]["matches"]]' $NM/odds.json \
 | while read -r h a s; do curl -s "http://localhost:3001/api/matches/$h/$a/normalized-markets?league=premier-league" -o "$NM/nm-$s.json"; done
```
Dump `market_comparison` (a Supabase view) for one match through PostgREST. The command was proven today: HTTP 200, 520 rows. `.env` is gitignored and exists only in the main checkout:
```bash
( set -a && . /home/skamik/Documents/repositories/personal/aityper-scraper-api/.env && set +a && curl -s "$SUPABASE_URL/rest/v1/market_comparison?bookmaker=eq.lvbet&match_id=eq.premier-league:arsenal:hull%20city&select=market_key,market_code,param_value,raw_market_name,selections,scraped_at" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" > $NM/mc-arsenal_hull-city.json )
```
`lvbet_ac.py` was checked on a synthetic copy of today's Ars–Hul dump with LVBet's hidden O/U and half-time prices injected and the pairs removed. It printed `PASS | tg2.5O=1.55(+2.0%) tg2.5U=2.5(+3.3%) tg3.5O=2.3(+0.9%) tg3.5U=1.62(+2.5%)`.

- L1. In the cleaned log, `[LVBet/FullOffer] Completed: 20 matches` (= fixture count). Every match with published ladders has **≥ 900** in its `[LVBet/FullOffer] <H> vs <A>: N markets` line (today 615–664).
- L2. `python3 -I $EV/tools/db_stats.py $NM/mc-*.json` for 2 matches with ladders: `UNK%` ≤ **40** (today 58.3) and `extIdMissing` = **0** (today 4,875 of 4,875).
- L3. `python3 -I $EV/tools/lvbet_ac.py --ladders $NM/nm-<2 matches with ladders>.json` prints `PASS`. That requires:
  - LVBet present under PLAYER_SHOTS, PLAYER_SHOTS_ON_TARGET, PLAYER_FOULS, PLAYER_FOULS_WON, PLAYER_TACKLES, PLAYER_SAVES, PLAYER_ASSISTS, PLAYER_OFFSIDES, PLAYER_HEADER_SHOTS_ON_TARGET, PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX, PLAYER_GOAL_AND_ASSIST, HOME_EXACT_GOALS, HALF_TIME_HOME_EXACT_GOALS, RESULT_OR_TOTAL and TWO_PLAYERS_COMBINED_GOALS. AWAY_EXACT_GOALS is left out because it already works today.
  - LVBet EXACT_GOALS with ≥ 7 selections.
  - For PLAYER_SHOTS, PLAYER_FOULS and PLAYER_SAVES, ≥ 80 % of the LVBet tiers quoted by ≥ 2 peers within ±30 % of the peer median. The offline baseline is 88 %, 98 % and 100 %.
  - Today the tool prints `FAIL … codes:missing=<all 15> exact:<7 selections …`.
- L4. `python3 -I $EV/tools/lvbet_ac.py $NM/nm-*.json` prints `PASS` for **20/20**. That covers three checks:
  - `TOTAL_GOALS` 2.5 and 3.5: LVBet present, OVER/UNDER only, each leg within ±10 % of the peer median. For Ars–Hul, the hidden LVBet prices against today's peer median are 1.55/2.5 vs 1.52/2.42 (+2.0 %/+3.3 %) at 2.5 and 2.3/1.62 vs 2.28/1.58 (+0.9 %/+2.5 %) at 3.5.
  - LVBet present at `HALF_TIME_TOTAL_GOALS` 1.
  - No LVBet PLAYER_GOAL_OR_ASSIST selection contains `" or "`.
  - Today the tool prints `FAIL tg2.5:missing tg3.5:missing ht1:missing` in 20/20, plus `goa:10 pair selections` in 6/20, and exits 1.
- L5. Collision lines in the cleaned log (`grep -c 'for lvbet <KEY> '`): `TOTAL_GOALS` **0** (today 20), `HALF_TIME_TOTAL_GOALS:1.0` **0** (20), `HALF_TIME_TOTAL_GOALS:2.0` **0** (7), `EXACT_GOALS` **0**. The other keys stay as in the collision table, about 101 lines in total.
- L6. Unchanged: `python3 -I $EV/tools/mw_sanity.py $NM/odds.json` reports LVBet worst 1X2 deviation ≤ 15 % (today 12.6), and 20/20 LVBet matchIds are shared with peers (no `lvbet | MISSING` rows).

**Single-bookmaker live smoke test.** It is read-only: scrape and normalize, no DB writes. One run scrapes the whole league once (`scraper-audit-core.ts:105`, about 20 matches), so run it **once** per verification step. The `--market` shape was proven on the current code (`evidence/lvbet/discovery-strzaly-summary-2026-11-06.txt`). Without `--market` and `--all`, the same run prints only the SUMMARY, for every market (`scraper-audit-core.ts:753-767`). The BrowserPool keeps the process alive after SUMMARY, so `timeout` ends it and `exit=124` is expected:
```bash
SMOKE=$(mktemp -d)
timeout 300 npx tsx scripts/lvbet-market-discovery.ts --url "<lvbet eventUrl of a match with ladders>" --league premier-league > $SMOKE/run.log 2>&1; echo "exit=$?"
sed 's/\x1b\[[0-9;]*m//g' $SMOKE/run.log | sed -n '/SUMMARY/,$p' > $SMOKE/summary.txt
grep -cE '^Strzały +→ PLAYER_SHOTS ' $SMOKE/summary.txt
grep -E '^ *(Rezultat lub|Obaj gracze|1\. połowa - Liczba goli \(3|Zawodnik strzeli gola lub zanotuje asystę - P|Strzały)' $SMOKE/summary.txt
```
- Get the `eventUrl` from `GET http://localhost:3001/api/odds?league=premier-league` (`markets.MATCH_WINNER.bookmakerOdds.lvbet.eventUrl`). Today's example: `https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/premier-league/arsenalvshullcity/--/1/35148/37685/bc:31333515/`.
- Today, the 11 `Strzały…` markets are all under `❌ UNMAPPED MARKETS:`, and the `Strzały` count is 0.
- After Tasks 2–3:
  - the count equals the number of players in the `Strzały` ladder (Ars–Hul: 38);
  - `Rezultat lub ilość bramek (X)` lines map to `RESULT_OR_TOTAL`, and `Obaj gracze …` lines to `TWO_PLAYERS_COMBINED_GOALS`;
  - the goal-or-assist `- Podwójna szansa` market maps to `TWO_PLAYERS_GOAL_OR_ASSIST`;
  - `1. połowa - Liczba goli (3-drogowo)` and the 7 unsplit `Strzały …` siblings appear only under UNMAPPED.

## Global Constraints

- Commit messages are concise and descriptive. **No signature or attribution footers**: no "Co-Authored-By", no "Generated with". The user's CLAUDE.md overrides any harness reminder.
- Commit only after the owner explicitly approves executing this plan (repo rule). Branch from `master`.
- Code and comments are in English.
- Before every commit, run `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` (exit 0) and `npx vitest run` (all green).
- Golden-fixture discipline: the failing fixture comes first. Re-bless only with an inspected diff: run `npx tsx scripts/rebless-golden.ts --bookmaker lvbet --fixture <matchIdSafe> --dry`, then rerun without `--dry`. Never hand-edit `*.expected.json`, and never bless entries the task did not intend to change.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan does not change it.
- Editing anything under `src/` restarts the running dev server (`tsx watch`). Work in a git worktree (superpowers:using-git-worktrees) or coordinate with whoever uses the live service. A fresh worktree has no `node_modules`: run `npm ci` in it before any `npx` command. Tests and the scripts used here need no `.env`; only `src/index.ts:18` calls `validateConfig`.
- The evidence tools import `src/` from `$REPO_ROOT` (default: the main checkout). From a worktree, always prefix them with `REPO_ROOT=$PWD`.
- `scripts/harvest-fixtures.ts` and `scripts/lvbet-prep-audit.ts` still default to the pre-split monorepo layout (`harvest-fixtures.ts:224-225`, `lvbet-prep-audit.ts:71`). Always pass `--out`, `--out-dir src/services/normalization/__fixtures__` and `--registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json`.
- Keep live bookmaker traffic modest. Every discovery or prep-audit run scrapes the whole league (`scraper-audit-core.ts:105`), so allow at most one run per verification step.

## Review Focus

1. **The same name appears in another group with an `"<X> N+"` shape, or a ladder arrives unsplit** (e.g. a team market with "Arsenal 1+" selections outside "Zawodnicy - statystyki", a renamed group, or one tier label off the pattern). It must not be split per "player", and the normalizer must not turn `"Abdulkadir Omur 1+"` into a player code through the passthrough at `lvbet-normalizer.ts:1975`. Tests in Task 2: "does not split N+ selections outside the Zawodnicy - statystyki group, and the unsplit row normalizes to null" and "an unsplit ladder without paramValue normalizes to null".
2. **A ladder tier is outside the catalog vocabulary** (Popełnione faule `Tim Iroegbunam 5+` @9.0). The tier is dropped and the other tiers are kept, not the whole player. Test in Task 2.
3. **Same name and line but different products** (exact vs range "Arsenal - Dokładna liczba goli"). Both reach the normalizer after Task 1: the exact one maps to HOME_EXACT_GOALS, and the range one must normalize to null and not collide on that key. Test in Task 3: "only the exact variant of each same-named exact-goals pair maps".
4. **The real O/U row must stay alone on its key**: after normalizing every evidence market, exactly one market has `marketKey === "TOTAL_GOALS:2.5"` and its codes are `["OVER","UNDER"]`; the same holds for `HALF_TIME_TOTAL_GOALS:1.0` and `:2.0`. Tests in Task 3; offline check O3.
5. **Old bulk shapes must keep working** (other leagues or a rollback). The existing `lvbet-audit-fixes.test.ts` P1/p1 tests and the golden blessed WC entries stay green. Every task runs them in its gate.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/scrapers/bookmakers/lvbet/types.ts` | Modify `:21-52` | LVBet v5 payload types |
| `src/scrapers/bookmakers/lvbet/parser.ts` | Modify `:260-310` (ids), `:459-490` (dedupe and new splitter call), `:543-545` (numeric line); add the ladder splitter after `:453` | raw → ScrapedMarket |
| `src/scrapers/bookmakers/lvbet/__tests__/parser.test.ts` | Rewrite the synthetic cases to the real shape | parser unit tests |
| `src/scrapers/bookmakers/lvbet/__tests__/fixtures/markets-search-arsenal-hull-2026-11-06.json` | Create (copy of `evidence/lvbet/markets-search-arsenal-hull-trimmed.json`, 99 KB, 39 raw markets in payload order) | durable live input |
| `src/services/normalization/bookmakers/lvbet-normalizer.ts` | Modify: `:49-99` (goal-family patterns before `:98`); `:107` (exported `LVBET_PLAYER_LADDER_PATTERNS` at the top of `LVBET_AUDIT_NAME_PATTERNS`, followed by the half-time 3-way and goal-or-assist pair patterns); `:440` (the pair pattern must sit before it); `:477` (rename); `:493` and `:2468-2486` (remove the `Dokładnie 1 gol w meczu` mapping and its `isExactOneGoalYesNo` branch); `:2459-2466` (ladder `paramValue` guard); the player case group `:1905-1937`; the combo case group `:1985-1990`; a new RESULT_OR_TOTAL selection case | name → code, label → selection |
| `src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts` | Create | normalizer and end-to-end tests |
| `src/services/audit/scraper-audit-core.ts`, `src/services/audit/types.ts` | Modify `:370-376` / `:47-53` (Task 4) | prep archive keeps `paramValue` |
| `src/services/audit/__tests__/scraper-audit-core-passthrough.test.ts` | Create (Task 4; shared name with `betby-betters-lebull.md` Task 1) | harness test |
| `src/services/normalization/__fixtures__/lvbet/world-cup-2026_france_morocco.expected.json` | Re-bless `#22` (Task 2) and `#230`, `#257`, `#775`, `#816`, `#834`, `#839` (Task 3) | golden |
| `src/services/normalization/__fixtures__/lvbet/premier-league_<home>_<away>.{json,expected.json}` | Create (Task 5) | golden for the new shapes |

Shared test helper, used by Tasks 1–3 (define it once in each new test file, it is 3 lines): `loadEvidence(): LVBetMarket[]` reads `./fixtures/markets-search-arsenal-hull-2026-11-06.json` from `parser.test.ts` (it lives in `__tests__/`), or `../../../../scrapers/bookmakers/lvbet/__tests__/fixtures/markets-search-arsenal-hull-2026-11-06.json` from the normalizer test, with `readFileSync(new URL(..., import.meta.url))`. `ctx = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" }`. `parsed = parseAllMarkets(loadEvidence(), teams)`.

---

### Task 1: Align LVBet parser types with the v5 payload (ids, numeric line, de-duplication by `market_id`)

**Files:**
- Create: `src/scrapers/bookmakers/lvbet/__tests__/fixtures/markets-search-arsenal-hull-2026-11-06.json` (a verbatim copy of `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/lvbet/markets-search-arsenal-hull-trimmed.json`)
- Modify: `src/scrapers/bookmakers/lvbet/types.ts:21-52`, `src/scrapers/bookmakers/lvbet/parser.ts:268, 305, 444, 472-475, 543-545`
- Test: `src/scrapers/bookmakers/lvbet/__tests__/parser.test.ts`

**Interfaces:**
- Produces:
  - `LVBetMarket = { market_id: string; match_id: string; name: string; line?: number | string; markets_class_id?: number; markets_group?: { name: string; markets_group_id: number }; is_primary?: boolean; selections?: LVBetSelection[]; state?: { status: string } }`
  - `LVBetSelection = { selection_id: string; name: string; order: number; rate?: LVBetRate; status?: string }` (`id` removed from both)
  - `ScrapedMarket.bookmakerMarketId = String(markets_class_id)` when present
  - `selections[].externalId = selection_id`
- `markets_class_id` is a market-type id shared by sibling products (23 of 300 classes cover more than one name). Never key `LVBET_MARKET_ID_TO_CODE` (`lvbet-normalizer.ts:31`, empty today; consulted first at `:696-701`) on it without a name check.
- Selection `status` stays as is (`open` is not mapped to `active`); see Risks.

- [ ] **Step 1: Write the failing tests** (replace the three synthetic `{ id: 998877 }` cases in `parser.test.ts`)

```ts
const evidence = JSON.parse(readFileSync(new URL("./fixtures/markets-search-arsenal-hull-2026-11-06.json", import.meta.url), "utf8")) as LVBetMarket[];
const teams = { homeTeam: "Arsenal", awayTeam: "Hull City" };

it("keeps both same-named 'Arsenal - Dokładna liczba goli' variants (de-duplicates by market_id)", () => {
  const parsed = parseAllMarkets(evidence, teams).filter((m) => m.name === "Arsenal - Dokładna liczba goli");
  expect(parsed.map((m) => m.selections.map((s) => s.name))).toEqual([
    ["0 lub 1", "2 lub 3", "4 do 6", "7 lub więcej"],
    ["0", "1", "2", "3", "4+"],
  ]);
  expect(parsed[1].selections.map((s) => s.odds)).toEqual([7.25, 4.75, 3.4, 3.8, 3.1]);
});
it("keeps both 'Dokładna liczba goli' and both '1. Połowa - Arsenal dokładna liczba goli' variants", () => {
  const names = parseAllMarkets(evidence, teams).map((m) => m.name);
  expect(names.filter((n) => n === "Dokładna liczba goli")).toHaveLength(2);
  expect(names.filter((n) => n === "1. Połowa - Arsenal dokładna liczba goli")).toHaveLength(2);
});
it("carries markets_class_id as bookmakerMarketId and selection_id as externalId", () => {
  const ou = parseAllMarkets(evidence, teams).find((m) => m.name === "Liczba goli 2.5")!;
  expect(ou.bookmakerMarketId).toBe("3499");
  expect(ou.selections.map((s) => [s.name, s.odds, s.externalId])).toEqual([
    ["Powyżej (2.5)", 1.55, "bc:7392415565"],
    ["Poniżej (2.5)", 2.5, "bc:7392415566"],
  ]);
});
it("never emits the literal externalId 'undefined'", () => {
  for (const m of parseAllMarkets(evidence, teams)) for (const s of m.selections) expect(s.externalId).not.toBe("undefined");
});
it("parseExtendedMarkets accepts a numeric line", () => {
  const ext = parseExtendedMarkets(evidence);
  expect(ext.marketOverUnder?.["2.5"]).toMatchObject({ over: 1.55, under: 2.5 });
});
```
(`MarketOverUnderOdds` is `{ over: number; under: number }`, declared at `src/types/full-offer.ts:123-126`.)

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/scrapers/bookmakers/lvbet/__tests__/parser.test.ts`
Expected failures:
- the first two cases get 1 variant instead of 2;
- `bookmakerMarketId` is `undefined`;
- `externalId` is `"undefined"`;
- `parseExtendedMarkets` fails with `TypeError: market.line.includes is not a function`.

- [ ] **Step 3: Implement**

1. Update the types as listed under Interfaces.
2. De-duplication key: `market.market_id ?? \`${market.name}_${market.line ?? ""}\``.
3. `bookmakerMarketId: market.markets_class_id != null ? String(market.markets_class_id) : undefined`, in both `parseMarket` and `splitBulkPlayerListMarket`.
4. `externalId: s.selection_id`.
5. In `parseExtendedMarkets`, build `const lineText = String(market.line)` before `parseFloat`/`includes`.
6. Fix every `tsc` error the stricter types expose. Do not add `as any`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/scrapers/bookmakers/lvbet src/services/normalization/bookmakers/__tests__/lvbet-audit-fixes.test.ts`
Expected: all PASS. `lvbet-audit-fixes` builds markets with `as unknown as LVBetMarket` and must stay green.

- [ ] **Step 5: Golden check (parser-only change; normalizer output is unchanged)**

Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t lvbet`
Expected: PASS with `failures=0`.

- [ ] **Step 6: Full gate and commit**

Run: `npx tsc --noEmit && npx vitest run` → exit 0, all green.
```bash
git add src/scrapers/bookmakers/lvbet/types.ts src/scrapers/bookmakers/lvbet/parser.ts src/scrapers/bookmakers/lvbet/__tests__/
git commit -m "lvbet: align parser with v5 payload ids so same-named markets survive dedupe"
```

### Task 2: Split and map the "Zawodnicy - statystyki" player ladders; follow the assist-combo rename; route the goal-or-assist pairs

**Files:**
- Modify: `src/scrapers/bookmakers/lvbet/parser.ts`: add `splitPlayerStatLadderMarket` after `splitBulkPlayerListMarket` (ends `:453`) and call it in `parseAllMarkets` right after the bulk split (`:477-481`).
- Modify: `src/services/normalization/bookmakers/lvbet-normalizer.ts`:
  - add the exported `LVBET_PLAYER_LADDER_PATTERNS` (10 anchored patterns) and spread it at the **top** of `LVBET_AUDIT_NAME_PATTERNS` (`:107`);
  - ladder guard in `normalizeMarket`, between `:2459` and `:2466`: when `normalizeMarketName(raw.name)` matches one of `LVBET_PLAYER_LADDER_PATTERNS` and `raw.paramValue` is empty, return null (OTHER). Only parser-split rows carry the player, and an unsplit ladder must never reach the player-name passthrough (`:1975`);
  - add `{ pattern: /zawodnik strzeli gola lub zanotuje asyste - podwojna szansa/, code: "TWO_PLAYERS_GOAL_OR_ASSIST" }` **before** `:440`, and `case "TWO_PLAYERS_GOAL_OR_ASSIST":` to the combo case group (`:1985-1990`, `canonicalizePlayerComboSelection`);
  - extend `:477` to `/strzeli gola i (zaliczy|zanotuje) asyste/`;
  - add `case "PLAYER_OFFSIDES":`, `case "PLAYER_HEADER_SHOTS_ON_TARGET":` and `case "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX":` to the player case group (`:1905-1937`).
- Modify (golden): `src/services/normalization/__fixtures__/lvbet/world-cup-2026_france_morocco.expected.json`, entry `#22` (blessed on the misroute).
- Test: `src/scrapers/bookmakers/lvbet/__tests__/parser.test.ts`, `src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts` (create)

**Interfaces:**
- Consumes: the Task 1 types (`markets_group`, `markets_class_id`, `selection_id`).
- Produces:
  - `PLAYER_STAT_LADDER_NAMES: ReadonlySet<string>`, exported from `parser.ts`. It holds the normalized names of the 10 mapped ladders: `strzały`, `strzały celne`, `popełnione faule`, `faule na zawodniku`, `odbiory (tackle)`, `asysty`, `spalone zawodnika`, `obrony bramkarza`, `strzały celne głowa`, `strzały celne spoza pola karnego`. These are `normalizeMarketName` output: lower-case, combining marks stripped, `ł` kept.
  - `splitPlayerStatLadderMarket(market: LVBetMarket, seenPlayerParams: Set<string>): ScrapedMarket[] | null`. It returns null unless `market.markets_group?.name === "Zawodnicy - statystyki"`, the normalized name is in `PLAYER_STAT_LADDER_NAMES`, and every valid selection matches `/^(.+\S)\s+(\d+)\+$/`. Otherwise it returns one ScrapedMarket per player: `name = market.name`, `paramValue = player`, and `selections` = that player's tiers in ascending N, each labelled `` `Powyzej ${N - 0.5}` `` with the original odds and `externalId`, and `bookmakerMarketId = String(markets_class_id)`.
  - `LVBET_PLAYER_LADDER_PATTERNS: ReadonlyArray<{ pattern: RegExp; code: NormalizedMarketType }>`, exported from `lvbet-normalizer.ts`. Each name is anchored `^…$` on the normalized market name and maps to the code from the root-cause-A table. Example: `{ pattern: /^strzały celne głowa$/, code: "PLAYER_HEADER_SHOTS_ON_TARGET" }`.

- [ ] **Step 1: Write the failing parser tests**

```ts
it("splits 'Strzały' (Zawodnicy - statystyki) into one market per player with 'Powyzej N-0.5' tiers", () => {
  const rows = parseAllMarkets(evidence, teams).filter((m) => m.name === "Strzały");
  const vg = rows.find((m) => m.paramValue === "Viktor Gyokeres")!;
  expect(vg.bookmakerMarketId).toBe("12238");
  expect(vg.selections.map((s) => [s.name, s.odds])).toEqual([
    ["Powyzej 2.5", 1.35], ["Powyzej 3.5", 1.88], ["Powyzej 4.5", 2.95], ["Powyzej 5.5", 5.2],
  ]);
  expect(rows.map((m) => m.paramValue).sort()).toEqual(["Abdulkadir Omur", "Ben White", "Tim Iroegbunam", "Viktor Gyokeres"]);
});
it("leaves unmapped ladder siblings unsplit", () => {
  const raw = parseAllMarkets(evidence, teams).filter((m) => m.name === "Podania celne");
  expect(raw).toHaveLength(1);
  expect(raw[0].paramValue).toBeUndefined();
});
```
(Checked against the evidence fixture: "Strzały" has exactly these 4 players. "Obrony bramkarza" has David Raya and Jack Butland.)

- [ ] **Step 2: Write the failing normalizer tests** (`lvbet-2026-11-recovery.test.ts`; parse the evidence, then normalize each row)

```ts
const norm = (name: string, player: string) =>
  lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === name && m.paramValue === player)!, ctx)!;
it.each([
  ["Strzały", "Viktor Gyokeres", "PLAYER_SHOTS", [["3+", 1.35], ["4+", 1.88], ["5+", 2.95], ["6+", 5.2]]],
  ["Strzały celne", "Ben White", "PLAYER_SHOTS_ON_TARGET", [["1+", 4.2], ["2+", 15]]],
  ["Popełnione faule", "Ben White", "PLAYER_FOULS", [["1+", 1.6], ["2+", 3.85], ["3+", 10], ["4+", 21]]],
  ["Faule na zawodniku", "Viktor Gyokeres", "PLAYER_FOULS_WON", [["1+", 1.28], ["2+", 2.22], ["3+", 5], ["4+", 11]]],
  ["Odbiory (tackle)", "Ben White", "PLAYER_TACKLES", [["1+", 1.14], ["2+", 1.62], ["3+", 2.9], ["4+", 6.25]]],
  ["Asysty", "Ben White", "PLAYER_ASSISTS", [["1+", 4.35]]],
  ["Spalone zawodnika", "Viktor Gyokeres", "PLAYER_OFFSIDES", [["1+", 1.95], ["2+", 5.75], ["3+", 14]]],
  ["Obrony bramkarza", "Jack Butland", "PLAYER_SAVES", [["4+", 1.38], ["5+", 1.85], ["6+", 2.7], ["7+", 4.35]]],
  ["Strzały celne głową", "Viktor Gyokeres", "PLAYER_HEADER_SHOTS_ON_TARGET", [["1+", 2.9], ["2+", 11], ["3+", 25]]],
  ["Strzały celne spoza pola karnego", "Ben White", "PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX", [["1+", 9.5], ["2+", 23]]],
])("maps ladder %s / %s to %s", (name, player, code, tiers) => {
  const out = norm(name, player);
  expect(out.marketCode).toBe(code);
  expect(out.paramValue).toBe(player);
  expect(out.marketKey).toBe(`${code}:${player}`);
  expect(out.selections.map((s) => [s.code, s.odds])).toEqual(tiers);
});
it("drops a tier outside the catalog vocabulary but keeps the player (PLAYER_FOULS 5+)", () => {
  expect(norm("Popełnione faule", "Tim Iroegbunam").selections.map((s) => [s.code, s.odds])).toEqual([["2+", 1.42], ["3+", 2.25], ["4+", 4.3]]);
});
it("maps the renamed 'Zawodnik strzeli gola i zanotuje asystę' to PLAYER_GOAL_AND_ASSIST", () => {
  const raw = parseAllMarkets(evidence, teams).find((m) => m.name === "Zawodnik strzeli gola i zanotuje asystę")!;
  const out = lvbetNormalizer.normalizeMarket(raw, ctx)!;
  expect(out.marketCode).toBe("PLAYER_GOAL_AND_ASSIST");
  expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["Christos Tzolis", 4.45], ["Noni Madueke", 5.25], ["Martin Odegaard", 5.65], ["Viktor Gyokeres", 6.25]]);
});
it("an unsplit ladder without paramValue normalizes to null", () => {
  expect(lvbetNormalizer.normalizeMarket({ name: "Strzały", selections: [{ name: "Abdulkadir Omur 1+", odds: 1.5 }] }, ctx)).toBeNull();
  expect(lvbetNormalizer.normalizeMarket({ name: "Strzały", selections: [{ name: "Powyzej 2.5", odds: 1.35 }] }, ctx)).toBeNull();
});
it("does not split N+ selections outside the Zawodnicy - statystyki group, and the unsplit row normalizes to null", () => {
  const fake = { ...evidence.find((m) => m.name === "Strzały")!, market_id: "bc:x", markets_group: { name: "Drużyna 1", markets_group_id: 1 } };
  const rows = parseAllMarkets([fake], teams);
  expect(rows).toHaveLength(1);
  expect(lvbetNormalizer.normalizeMarket(rows[0], ctx)).toBeNull();
});
it("every parser ladder name has exactly one normalizer ladder pattern", () => {
  for (const n of PLAYER_STAT_LADDER_NAMES) expect(LVBET_PLAYER_LADDER_PATTERNS.filter((p) => p.pattern.test(n))).toHaveLength(1);
});
it("routes the goal-or-assist Podwójna szansa pair market to TWO_PLAYERS_GOAL_OR_ASSIST", () => {
  const out = lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === "Zawodnik strzeli gola lub zanotuje asystę - Podwójna szansa")!, ctx)!;
  expect(out.marketKey).toBe("TWO_PLAYERS_GOAL_OR_ASSIST");
  expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["C. Tzolis & K. Havertz", 1.18], ["K. Havertz & M. Odegaard", 1.2], ["C. Tzolis & M. Odegaard", 1.22]]);
});
it("keeps single-player PLAYER_GOAL_OR_ASSIST free of pair selections", () => {
  const out = lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === "Zawodnik strzeli gola lub zanotuje asystę")!, ctx)!;
  expect(out.marketKey).toBe("PLAYER_GOAL_OR_ASSIST");
  expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["Christos Tzolis", 1.5], ["Viktor Gyokeres", 1.55], ["Kai Havertz", 1.57], ["Noni Madueke", 1.65]]);
});
```
(The pair codes and the null results of the unsplit/fake rows were checked with a scratch copy of the normalizer that had these patterns patched in. Without the guard, the first unsplit row gives `PLAYER_SHOTS` with the codes `"Abdulkadir Omur 1+"`, and the second gives `PLAYER_SHOTS:2.5`.)

- [ ] **Step 3: Run both test files and confirm they fail**

Run: `npx vitest run src/scrapers/bookmakers/lvbet src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts`
Expected failures:
- in the parser, "Strzały" yields 1 unsplit market;
- in the normalizer, `find(...)` returns undefined, or the code is `OTHER`/null;
- the rename test gets `null`;
- the unsplit/fake tests get `PLAYER_SHOTS`;
- the pair test gets `PLAYER_GOAL_OR_ASSIST`;
- the consistency test fails, because the two names are not exported yet.
- The single-player test already passes; it pins the split.

- [ ] **Step 4: Implement** the parser splitter, the anchored patterns, the ladder guard, the pair pattern, the case labels and the rename, as specified under Files and Interfaces.

- [ ] **Step 5: Run the tests and confirm they pass, then the regression nets**

Run: `npx vitest run src/scrapers/bookmakers/lvbet src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts src/services/normalization/bookmakers/__tests__/lvbet-audit-fixes.test.ts`
Expected: all PASS.
Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t lvbet`
Expected: FAIL on exactly `#22 "Zawodnik strzeli gola lub zanotuje asystę - Podwójna szansa"`, which was blessed on the PLAYER_GOAL_OR_ASSIST misroute with codes like `Kylian Mbappe or Ousmane Dembele`. Blessed `#140`, `#190` and `#335` are unchanged, and the WC fixture has no ladder names.

- [ ] **Step 6: Re-bless `#22` with an inspected diff**

Run: `npx tsx scripts/rebless-golden.ts --bookmaker lvbet --fixture world-cup-2026_france_morocco --dry`. Expected: stderr lists exactly 1 entry, `Zawodnik strzeli gola lub zanotuje asystę - Podwójna szansa`. `--dry` prints names only (`scripts/rebless-golden.ts:166-170`).
Then run it without `--dry`, followed by `git diff -U3 -- src/services/normalization/__fixtures__/lvbet/world-cup-2026_france_morocco.expected.json`.
Expected: only `#22` changes. It becomes `TWO_PLAYERS_GOAL_OR_ASSIST` with 10 canonical pairs, starting `["K. Mbappe & O. Dembele", 1.22]`, `["K. Mbappe & M. Olise", 1.22]`, `["B. Barcola & K. Mbappe", 1.25]` (prototype-verified). If any code still contains `" or "`, run `git checkout -- <that file>` and stop.
Then `npx vitest run src/services/normalization/__tests__/golden.test.ts -t lvbet` → `failures=0`.

- [ ] **Step 7: Full gate and commit**

Run: `npx tsc --noEmit && npx vitest run` → exit 0, all green.
```bash
git add src/scrapers/bookmakers/lvbet/parser.ts src/scrapers/bookmakers/lvbet/__tests__/parser.test.ts \
  src/services/normalization/bookmakers/lvbet-normalizer.ts \
  src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts \
  src/services/normalization/__fixtures__/lvbet/world-cup-2026_france_morocco.expected.json
git commit -m "lvbet: split and map the new per-player stat ladders, route goal-or-assist pairs"
```

### Task 3: Route the goal-family products out of the TOTAL_GOALS catch-all and the half-time 3-way total out of HALF_TIME_TOTAL_GOALS

**Files:**
- Modify: `src/services/normalization/bookmakers/lvbet-normalizer.ts`:
  - Add three patterns to `LVBET_MARKET_NAME_PATTERNS` **before** the catch-all at `:98`:
    - `/^rezultat lub ilosc bramek \(/` → RESULT_OR_TOTAL;
    - `/^obaj gracze strzela łacznie przynajmniej \d+ gol/` → TWO_PLAYERS_COMBINED_GOALS;
    - `/^dokładna liczba goli$/` → EXACT_GOALS. There is no extra selection rule: the "Bez goli"/"Dokładnie N" twin already returns null, because every selection is dropped and `selections.length === 0` returns null. A future out-of-catalog tier such as `7+` is folded into `6+` by the existing catch-all merge instead of discarding the ladder (both prototype-verified).
  - Add `{ pattern: /^1\. połowa - liczba goli \(3-drogowo\)/, code: "OTHER" }` to `LVBET_AUDIT_NAME_PATTERNS`, so it is checked before the generic half-time heuristic at `:989-998`. betcris already excludes the same shape (`betcris-normalizer.ts:1400-1410`); open question 4 covers mapping it later.
  - **Decision:** route `Dokładnie 1 gol w meczu` to OTHER now that the full ladder maps. Delete the `:493` pattern and the `isExactOneGoalYesNo` branch (`:2468-2486`), so that the existing `:498` `/dokładnie \d+ gol\w* w meczu/ → OTHER` catches it like its N = 2..4 siblings.
    - Why: keeping both would put two raw markets on `EXACT_GOALS` "1", and `mergeMarketRecord` keeps the first-seen price. Payload order differs between offers (WC: ladder first; Ars–Hul: Yes/No first), and the prices can differ: the WC fixture has `Tak` 4.05 against ladder "1" 3.55 for the same match.
    - Cost: when an offer has only the Yes/No market, EXACT_GOALS loses its single "1" selection.
  - Add a `case "RESULT_OR_TOTAL"` selection mapping, and add `case "TWO_PLAYERS_COMBINED_GOALS":` to the combo group at `:1985-1990` (it reuses `canonicalizePlayerComboSelection`).
  - Param extraction: RESULT_OR_TOTAL takes the line from "(X)"/`line`; TWO_PLAYERS_COMBINED_GOALS takes N from the name, with param = `String(N - 0.5)`.
- Modify (golden): `src/services/normalization/__fixtures__/lvbet/world-cup-2026_france_morocco.expected.json` (entries `#230`, `#257`, `#775`, `#816`, `#834`, `#839`)
- Test: `src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts`

**Interfaces:**
- Consumes: the Task 1 parser (both "Dokładna liczba goli" variants and both same-named team exact-goals variants survive).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Pin the failing golden entries first**

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api
npx tsx scripts/harvest-fixtures.ts \
  --archive /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/raw-archive/lvbet/world-cup-2026_france_morocco__2026-07-09.json \
  --bookmaker lvbet --out-dir src/services/normalization/__fixtures__ \
  --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json \
  --bless "Rezultat lub ilość bramek (2.5) 2.5" --bless "Rezultat lub ilość bramek (3.5) 3.5" \
  --bless "Rezultat lub ilość bramek (4.5) 4.5" --bless "Dokładna liczba goli" \
  --bless "1. połowa - Liczba goli (3-drogowo) 1"
npx vitest run src/services/normalization/__tests__/golden.test.ts -t lvbet
```
Expected: PASS. `git diff` shows exactly 5 entries flipped to `blessed: true`, with unchanged `expected`:
- `#230` (`TOTAL_GOALS`)
- `#775` (`TOTAL_GOALS:2.5`)
- `#834` (`TOTAL_GOALS:3.5`)
- `#839` (`TOTAL_GOALS:4.5`)
- `#816` (`HALF_TIME_TOTAL_GOALS:1.0`)

`#257` is already blessed. If the diff touches anything else, revert and stop.

- [ ] **Step 2: Write the failing unit tests**

```ts
it("routes 'Rezultat lub ilość bramek (2.5)' to RESULT_OR_TOTAL:2.5", () => {
  const raw = parseAllMarkets(evidence, teams).find((m) => m.name.startsWith("Rezultat lub ilość bramek (2.5)"))!;
  const out = lvbetNormalizer.normalizeMarket(raw, ctx)!;
  expect(out.marketKey).toBe("RESULT_OR_TOTAL:2.5");
  expect(Object.fromEntries(out.selections.map((s) => [s.code, s.odds]))).toEqual({
    HOME_OVER: 1.09, HOME_UNDER: 1.03, DRAW_OVER: 1.3, DRAW_UNDER: 2.17, AWAY_OVER: 1.42, AWAY_UNDER: 2.15,
  });
});
it("leaves exactly one OVER/UNDER market on TOTAL_GOALS:2.5", () => {
  const outs = parseAllMarkets(evidence, teams).map((m) => lvbetNormalizer.normalizeMarket(m, ctx)).filter((o) => o?.marketKey === "TOTAL_GOALS:2.5");
  expect(outs).toHaveLength(1);
  expect(outs[0]!.selections.map((s) => [s.code, s.odds])).toEqual([["OVER", 1.55], ["UNDER", 2.5]]);
});
it.each([
  ["Obaj gracze strzelą łącznie przynajmniej 2 gole", "TWO_PLAYERS_COMBINED_GOALS:1.5", ["K. Havertz & V. Gyokeres", 2.12]],
  ["Obaj gracze strzelą łącznie przynajmniej 3 gole", "TWO_PLAYERS_COMBINED_GOALS:2.5", ["K. Havertz & V. Gyokeres", 5.5]],
])("routes '%s' to %s with canonical pairs", (name, key, first) => {
  const out = lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === name)!, ctx)!;
  expect(out.marketKey).toBe(key);
  expect([out.selections[0].code, out.selections[0].odds]).toEqual(first);
});
it("maps the digit variant of 'Dokładna liczba goli' to EXACT_GOALS and leaves the 'Bez goli' twin as OTHER", () => {
  const [a, b] = parseAllMarkets(evidence, teams).filter((m) => m.name === "Dokładna liczba goli").map((m) => lvbetNormalizer.normalizeMarket(m, ctx));
  const exact = [a, b].find((o) => o?.marketCode === "EXACT_GOALS")!;
  expect(exact.selections.map((s) => [s.code, s.odds])).toEqual([["0", 14], ["1", 5.85], ["2", 4.05], ["3", 3.85], ["4", 4.55], ["5", 6.75], ["6+", 7.25]]);
  expect([a, b].filter((o) => o === null || o.marketCode === "OTHER")).toHaveLength(1);
});
it("routes 'Dokładnie 1 gol w meczu' to OTHER now that the full ladder maps", () => {
  expect(lvbetNormalizer.normalizeMarket(parseAllMarkets(evidence, teams).find((m) => m.name === "Dokładnie 1 gol w meczu")!, ctx)).toBeNull();
  const outs = parseAllMarkets(evidence, teams).map((m) => lvbetNormalizer.normalizeMarket(m, ctx)).filter((o) => o?.marketKey === "EXACT_GOALS");
  expect(outs).toHaveLength(1);
});
it("leaves exactly one OVER/UNDER market on HALF_TIME_TOTAL_GOALS:1.0 and :2.0", () => {
  const outs = parseAllMarkets(evidence, teams).map((m) => lvbetNormalizer.normalizeMarket(m, ctx));
  const at = (key: string) => outs.filter((o) => o?.marketKey === key).map((o) => o!.selections.map((s) => [s.code, s.odds]));
  expect(at("HALF_TIME_TOTAL_GOALS:1.0")).toEqual([[["OVER", 1.47], ["UNDER", 2.55]]]);
  expect(at("HALF_TIME_TOTAL_GOALS:2.0")).toEqual([[["OVER", 3.7], ["UNDER", 1.25]]]);
});
it("only the exact variant of each same-named exact-goals pair maps", () => {
  const pick = (name: string) => parseAllMarkets(evidence, teams).filter((m) => m.name === name)
    .map((m) => lvbetNormalizer.normalizeMarket(m, ctx)).filter((o) => o !== null)
    .map((o) => [o!.marketKey, o!.selections.map((s) => [s.code, s.odds])]);
  expect(pick("Arsenal - Dokładna liczba goli")).toEqual([["HOME_EXACT_GOALS", [["0", 7.25], ["1", 4.75], ["2", 3.4], ["3", 3.8], ["4+", 3.1]]]]);
  expect(pick("1. Połowa - Arsenal dokładna liczba goli")).toEqual([["HALF_TIME_HOME_EXACT_GOALS", [["0", 2.95], ["1", 2.5], ["2+", 2.45]]]]);
});
```
(Values checked on the current normalizer and a patched scratch copy. The range variants (classes 2287 and 2744) already normalize to null; the last test pins Review Focus 3 and already passes once Task 1 has landed.)

- [ ] **Step 3: Run them and confirm they fail**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts -t "RESULT_OR_TOTAL|TOTAL_GOALS:2.5|Obaj gracze|EXACT_GOALS|Dokładnie 1 gol|HALF_TIME_TOTAL_GOALS|exact variant"`
Expected failures:
- `marketKey` is `TOTAL_GOALS:2.5` instead of `RESULT_OR_TOTAL:2.5`;
- 2 markets land on `TOTAL_GOALS:2.5`;
- the pair keys are `TOTAL_GOALS`;
- `marketCode` is `TOTAL_GOALS`;
- `Dokładnie 1 gol w meczu` gives `EXACT_GOALS` and not null;
- `HALF_TIME_TOTAL_GOALS:1.0` and `:2.0` each hold 2 markets, the first `[OVER, UNKNOWN, UNDER]`.
- "only the exact variant…" passes (pin).

- [ ] **Step 4: Implement** the patterns, the half-time 3-way exclusion, the `Dokładnie 1 gol w meczu` removal, the selection case and the param extraction listed under Files.

- [ ] **Step 5: Run the tests and confirm they pass; the golden test now fails on the pinned entries**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts src/services/normalization/bookmakers/__tests__/lvbet-audit-fixes.test.ts`
Expected: all PASS.
Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t lvbet`
Expected: FAIL on exactly `#230`, `#257`, `#775`, `#816`, `#834` and `#839`.

- [ ] **Step 6: Re-bless with an inspected diff**

Run: `npx tsx scripts/rebless-golden.ts --bookmaker lvbet --fixture world-cup-2026_france_morocco --dry`
Expected: stderr lists exactly 6 entry names (`--dry` prints names, not diffs; `scripts/rebless-golden.ts:166-170`).
Then run it without `--dry` and inspect `git diff -U3 -- src/services/normalization/__fixtures__/lvbet/world-cup-2026_france_morocco.expected.json`. Expected:
- `#775` → `RESULT_OR_TOTAL:2.5`, 6 legs HOME_/DRAW_/AWAY_ × OVER/UNDER;
- `#834` → `RESULT_OR_TOTAL:3.5`, 6 legs;
- `#839` → `RESULT_OR_TOTAL:4.5` with the 5 raw legs: HOME_OVER 1.4, DRAW_OVER 2.25, DRAW_UNDER 1.07, AWAY_OVER 3.1, AWAY_UNDER 1.07 (the raw has no "Francja lub poniżej").
  - The WC raw labels are "Francja/Remis/Maroko lub powyżej/poniżej (X)". `normalize1x2Selection` was verified to resolve "Francja"→HOME, "Maroko"→AWAY and "Remis"→DRAW for ctx France/Morocco. No leg may be UNKNOWN.
- `#230` → `EXACT_GOALS`: 0 6.5, 1 3.55, 2 2.95, 3 3.35, 4 4.8, 5 8.25, 6+ 12;
- `#257` → `expected: null`. Its convenience `marketCode` stays `EXACT_GOALS` because rebless only updates it for non-null output (`rebless-golden.ts:161`); `golden.test.ts` compares `expected` only;
- `#816` → `expected: null`.

If any leg is UNKNOWN or any other entry changed, run `git checkout -- src/services/normalization/__fixtures__/lvbet/world-cup-2026_france_morocco.expected.json` and stop.
Then `npx vitest run src/services/normalization/__tests__/golden.test.ts -t lvbet` → `failures=0`.

- [ ] **Step 7: Full gate and commit**

Run: `npx tsc --noEmit && npx vitest run` → exit 0, all green.
```bash
git add src/services/normalization/bookmakers/lvbet-normalizer.ts \
  src/services/normalization/bookmakers/__tests__/lvbet-2026-11-recovery.test.ts \
  src/services/normalization/__fixtures__/lvbet/world-cup-2026_france_morocco.expected.json
git commit -m "lvbet: route result-or-total, pair goals, exact goals and half-time 3-way totals to their own codes"
```

- [ ] **Step 8: Offline acceptance (no live traffic, calendar-independent)**

Run the three commands of the "Offline" acceptance block in the Observations section, from the worktree, with `REPO_ROOT=$PWD`.
Expected:
- O1: exactly `{"rawCount":549,"parsed":965,"withParam":428}`;
- O2: `unknownPct` ≤ 40;
- O3: exactly `['HALF_TIME_CARDS_TOTAL:0.5', 'HALF_TIME_TOTAL_GOALS', 'HALF_TIME_TOTAL_GOALS:0.5', 'SECOND_HALF_TOTAL_GOALS', 'SECOND_HALF_TOTAL_GOALS:0.5']`.

Any other output is a bug in Tasks 1–3: fix it before Task 4.

### Task 4: Archive `paramValue` in the prep-audit output (shared harness)

If `betby-betters-lebull.md` Task 1 has already landed, skip Steps 1–4 and add only the first test below to its `scraper-audit-core-passthrough.test.ts`. To check whether it landed: the test file exists, and `grep -n paramValue src/services/audit/scraper-audit-core.ts` shows a hit inside the archived `raw` block (`:370-376`).

**Files:**
- Modify: `src/services/audit/scraper-audit-core.ts:370-376`: the archived `raw` adds `...(raw.paramValue !== undefined ? { paramValue: raw.paramValue } : {})`.
- Modify: `src/services/audit/types.ts:47-53`: `PrepMarketEntry.raw.paramValue?: string`.
- Modify: `scripts/harvest-fixtures.ts:63`: drop the stale "Not archived today (prep drops it)" comment.
- Test: `src/services/audit/__tests__/scraper-audit-core-passthrough.test.ts` (create)

**Interfaces:**
- Consumes: the Task 2 normalizer (ladder rows need `paramValue`).
- Produces: prep archives carry `raw.paramValue` only when it is set, so entries without it serialize byte-identically. `harvest-fixtures.ts:138` and `golden.test.ts:91` already read it.
- This changes future archives of every bookmaker whose parser sets `paramValue` (betclic, betcris, betfan, lvbet, pzbuk). Committed fixtures do not change.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildPrepAuditOutput } from "../scraper-audit-core.js";
import { lvbetNormalizer } from "../../normalization/bookmakers/lvbet-normalizer.js";

const ctx = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };
const meta = { matchId: "premier-league:arsenal:hull city", homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };

describe("prep archive paramValue", () => {
  it("archives a split LVBet ladder row with its paramValue", () => {
    const out = buildPrepAuditOutput({ normalizer: lvbetNormalizer, ctx, meta, rawMarkets: [{ name: "Strzały", bookmakerMarketId: "12238",
      paramValue: "Viktor Gyokeres", selections: [{ name: "Powyzej 2.5", odds: 1.35 }, { name: "Powyzej 3.5", odds: 1.88 }] }] });
    expect(out.markets[0].raw.paramValue).toBe("Viktor Gyokeres");
    expect(out.markets[0].normalized.marketKey).toBe("PLAYER_SHOTS:Viktor Gyokeres");
  });
  it("archives entries without paramValue without the key", () => {
    const out = buildPrepAuditOutput({ normalizer: lvbetNormalizer, ctx, meta, rawMarkets: [{ name: "Liczba goli 2.5", bookmakerMarketId: "3499",
      selections: [{ name: "Powyżej (2.5)", odds: 1.55 }, { name: "Poniżej (2.5)", odds: 2.5 }] }] });
    expect("paramValue" in out.markets[0].raw).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/services/audit/__tests__/scraper-audit-core-passthrough.test.ts`. Expected: the first test FAILS because `raw.paramValue` is `undefined`. The second one passes (it is a pin).
- [ ] **Step 3:** Implement the passthrough and the type, as listed under Files.
- [ ] **Step 4:** Run `npx tsc --noEmit && npx vitest run`. Expected: all green, and the golden suite reports `failures=0` for every bookmaker. Then run `npx tsx scripts/rebless-golden.ts --all --dry`. Expected last stdout line, exactly: `{"changedTotal":0,"dry":true}` (`scripts/rebless-golden.ts:173`).
- [ ] **Step 5: Commit**
```bash
git add src/services/audit/scraper-audit-core.ts src/services/audit/types.ts src/services/audit/__tests__/scraper-audit-core-passthrough.test.ts scripts/harvest-fixtures.ts
git commit -m "audit: keep paramValue in prep-audit archives"
```

### Task 5: Freeze a Premier League golden fixture for the new shapes and run live acceptance

**Files:**
- Create: `src/services/normalization/__fixtures__/lvbet/premier-league_<home>_<away>.json` and `.expected.json` (via harvest)
- Create (aityper repo, tracked like the WC archives): `/home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/raw-archive/lvbet/premier-league_<home>_<away>__<YYYY-MM-DD>.json`

**Interfaces:**
- Consumes: Tasks 1–3 (the final parser shapes) and Task 4 (archived `paramValue`).
- Naming: `<home>_<away>` are the team names lower-cased, with every run of non-alphanumerics replaced by `_` (e.g. `premier-league_arsenal_hull_city__2026-11-06.json`). `deriveMatchIdSafe` (`scripts/harvest-fixtures.ts:312-317`) takes `matchIdSafe` from the part before `__`, so `sourceArchive` stays a durable name for later `--bless` re-harvests.

- [ ] **Step 1: Capture a match with published ladders, using the final parser** (live; one run; the whole league is scraped once)

```bash
cd <worktree>
ARCH=/home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/raw-archive/lvbet/premier-league_<home>_<away>__$(date +%F).json
npx tsx scripts/lvbet-prep-audit.ts --url "<lvbet eventUrl of a PL match with ladders>" --league premier-league --out "$ARCH"
python3 -I -c 'import json,sys; m=json.load(open(sys.argv[1]))["markets"]; print(len(m), sum(1 for x in m if x["raw"].get("paramValue")))' "$ARCH"
```
Expected:
- the stdout summary names the match, and the file is larger than 500 KB;
- the second number (rows with `paramValue`) is ≥ 300. Ars–Hul offline had 428 such rows before dedupe; 0 means Task 4 is missing.

- [ ] **Step 2: Harvest the new-shape entries** (the fixture is "missing" before this step)

```bash
npx tsx scripts/harvest-fixtures.ts --archive "$ARCH" --bookmaker lvbet \
  --out-dir src/services/normalization/__fixtures__ \
  --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json \
  --only "Strzały" --only "Popełnione faule" --only "Obrony bramkarza" --only "Liczba goli 2.5" \
  --only "Rezultat lub ilość bramek (2.5) 2.5" --only "Obaj gracze strzelą łącznie przynajmniej 2 gole" --only "Dokładna liczba goli" \
  --only "1. Połowa - Liczba goli 1" --only "1. połowa - Liczba goli (3-drogowo) 1" \
  --only "Zawodnik strzeli gola lub zanotuje asystę - Podwójna szansa"
EXP=src/services/normalization/__fixtures__/lvbet/<matchIdSafe>.expected.json
python3 -I -c 'import json,sys,re; e=json.load(open(sys.argv[1]))["entries"]; print(len(e), [(x["index"],x["rawName"],x["expected"] and x["expected"]["marketKey"]) for x in e if x["rawName"] in ("Strzały","Popełnione faule","Obrony bramkarza") and not (x["expected"] and re.fullmatch(r"PLAYER_(SHOTS|FOULS|SAVES):\D.*", x["expected"]["marketKey"]))])' "$EXP"
```
An `--only` name the offer lacks makes harvest exit 1 with `No archive market matches raw name`. Drop that flag and note it.
Inspect the new `.expected.json` before blessing:
- the check prints `[]`, i.e. every ladder row is `PLAYER_SHOTS:<player>` / `PLAYER_FOULS:<player>` / `PLAYER_SAVES:<player>` and never `…:2.5`;
- there are no UNKNOWN codes;
- `TOTAL_GOALS:2.5` has OVER/UNDER only, and so does `HALF_TIME_TOTAL_GOALS:1.0`;
- `RESULT_OR_TOTAL:2.5`, `TWO_PLAYERS_COMBINED_GOALS:1.5` and `TWO_PLAYERS_GOAL_OR_ASSIST` are present, with canonical `I. Surname & I. Surname` codes;
- there is one `EXACT_GOALS` and one null twin, and the 3-way half-time total is null.

Then bless the same names: rerun with `--bless` in place of `--only`.

- [ ] **Step 3: Golden test**

Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t lvbet`
Expected: PASS for both lvbet fixtures, `failures=0`.

- [ ] **Step 4: Full gate and commit**

Run: `npx tsc --noEmit && npx vitest run` → exit 0, all green.
```bash
git add src/services/normalization/__fixtures__/lvbet/
git commit -m "lvbet: golden fixture for the November premier-league market shapes"
```
The archive lives in the aityper repo, where the WC archives are tracked. With the owner's approval, commit only that path there with `git -C /home/skamik/Documents/repositories/personal/aityper add "$ARCH"`. That working tree has unrelated uncommitted changes, so never use `-A`.

- [ ] **Step 5: Live acceptance** (after the owner deploys or restarts and one scheduled run completes)

- Run the smoke test once, as specified in the Observations section. Expected results are listed there.
- Then fetch the dumps and run the checks of the Live acceptance block (all commands are spelled out there):
  - L1 and L5: `grep -E '^\[LVBet/FullOffer\]'` and `grep -c 'for lvbet <KEY> '` in the cleaned log;
  - L2: `db_stats.py` on two `market_comparison` dumps;
  - L3 and L4: `lvbet_ac.py` (`--ladders` for two matches with ladders; plain for all 20);
  - L6: `mw_sanity.py` on a fresh `/api/odds` dump.
- If the run falls in a week without published ladders, record L1/L3 as "pending: no ladders" and rerun them in the first matchweek that has them. The offline O1–O3 already cover the logic.

---

## Self-review

- **Spec coverage:**
  - Root cause A is handled by Task 2 (10 ladders plus the PLAYER_GOAL_AND_ASSIST rename, with the `paramValue` guard).
  - Root cause B is handled by Task 1: de-duplication, ids, `externalId`, and the numeric-line crash.
  - Root cause C is handled by Task 3: RESULT_OR_TOTAL, TWO_PLAYERS_COMBINED_GOALS, EXACT_GOALS (with `Dokładnie 1 gol w meczu` → OTHER), and the half-time 3-way → OTHER.
  - Root cause D, the goal-or-assist pairs, is handled by Task 2 (TWO_PLAYERS_GOAL_OR_ASSIST). The points-based cards are deliberately left OTHER (open question 2). The unmapped ladders are open question 1.
  - Collision table: TOTAL_GOALS and HALF_TIME_TOTAL_GOALS:1.0/2.0 → Task 3. The rest are benign or out of scope with reasons (open questions 5 and 6).
  - Archive gap for per-player rows → Task 4.
  - Acceptance mapping:
    - O1 → Tasks 1–2; O2 → Tasks 1–3; O3 → Tasks 2–3;
    - L1 → Tasks 1–2; L2 → Tasks 1–3; L3 → Tasks 2–3; L4 → Tasks 2–3; L5 → Task 3; L6 → all tasks (regression check).
- **Step scan:** every code step names the file, the anchor line and the exact values. The parser splitter's algorithm is fixed by its signature and the "Powyzej N-0.5" rule plus tests. The live PL fixture in Task 5 cannot pin prices in advance, so its check is structural (per-player keys, no UNKNOWN).
- **Type consistency:** `LVBetMarket.market_id` / `markets_class_id` / `markets_group` (Task 1) are used by `splitPlayerStatLadderMarket` (Task 2). `PLAYER_STAT_LADDER_NAMES` (parser) and `LVBET_PLAYER_LADDER_PATTERNS` (normalizer) are tied by the Task 2 consistency test. `PrepMarketEntry.raw.paramValue?` (Task 4) is what Task 5's harvest reads.
- **Review Focus:**
  - item 1 → the Task 2 tests "does not split N+ … and the unsplit row normalizes to null" and "an unsplit ladder without paramValue normalizes to null";
  - item 2 → Task 2 "drops a tier outside the catalog vocabulary";
  - item 3 → Task 1 "keeps both same-named variants" plus the Task 3 tests "only the exact variant of each same-named exact-goals pair maps" and the EXACT_GOALS twin test;
  - item 4 → the Task 3 tests "leaves exactly one OVER/UNDER market" (TOTAL_GOALS:2.5 and HALF_TIME_TOTAL_GOALS:1.0/2.0), plus O3;
  - item 5 → every task's gate (`lvbet-audit-fixes`, golden).
- **Proportion:** code blocks are limited to tests with real evidence values. Implementation steps state only signatures and rules.
