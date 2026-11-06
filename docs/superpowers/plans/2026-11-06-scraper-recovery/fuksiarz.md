# Fuksiarz Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the live fake best price on HALF_WITH_MORE_GOALS (Task 0, P0), remove the player-label regression and the stranded player odds caused by Fuksiarz's new "I. Surname" player names, and map the two Fuksiarz markets that appeared after August.

**Architecture:** Fuksiarz's raw odds are correct. Fuksiarz now writes player names as "B. White" instead of "White, Ben". That breaks two things in the grouper's player-name reconciliation (`market-type-grouper.ts`). (1) The abbreviated spelling wins label ties, so the full name a peer sent disappears. (2) In some markets the abbreviated row is never folded into the peers' row, because peers disagree on the spelling ("Jan Paul" / "Jan-Paul") or send combo params ("A or B"). Those Fuksiarz odds then sit in their own row and are left out of the comparison. Task 1 fixes the tie-break. Task 2 fixes the stranded rows. Task 3 (optional) spells out abbreviated names across the whole match. Task 4 adds two gameType mappings to the Fuksiarz normalizer. The scraper, parser and catalog stay unchanged.

**Tech Stack:** TypeScript (NodeNext ESM), Vitest, tsx; Playwright only for the live smoke test.

**Spec:** the Observations section of this file. Evidence is in `$PLAN/evidence/fuksiarz/` (frozen grouper inputs `grouper-input-player-markets-*.json`, trimmed normalizer fixture `fixture-leeds-tottenham-2026-11-06.trimmed.json`, measurement tools in `tools/`). Shared tools are in `$PLAN/evidence/lvbet/tools/`. `$PLAN` is defined under Global Constraints.

## Observations (pre-fix analysis)

### Status today: DEGRADED. Raw data is correct, but our own parser repair now inverts HALF_WITH_MORE_GOALS (P0, Task 0). Labels, 2–17 stranded player rows per match and two mappings are also wrong.

> **Addendum (orchestrator, 2026-11-06 ~19:20 CET, added after the adversarial review):** the health check below missed one live odds-integrity defect, found by the parallel audit-process review and re-verified here on all 20 PL matches.
>
> **Root cause 0 — `repairHalfWithMoreGoalsLabels` now corrupts correct data.** `src/scrapers/bookmakers/fuksiarz/parser.ts:173-187` (added in `0839593`, 2026-08-19) swaps the prices of `równo` and `2. połowa` whenever the labels arrive in template order (`[1. połowa, równo, 2. połowa]`). In August the feed paired that order with mis-assigned prices. Fuksiarz has since fixed the prices but kept the same label order, so the guard (which only inspects labels) still fires and now inverts correct data. Live: fuksiarz DRAW 1.93–2.21 and 2ND_HALF 3.30–3.80 vs peer medians ≈3.35–3.80 and ≈2.00–2.07, in **20/20** matches (`evidence/fuksiarz/hwmg-live-vs-peers-2026-11-06.txt`). Fuksiarz's 2ND_HALF is therefore the "best price" on every match, 53–84 % above the best peer. The existing parser test (`__tests__/parser.test.ts:91-106`) only covers the August price pattern, so the suite stays green. Goal math gives a price-based guard: an equal goal split is the least likely outcome and the 2nd half the favourite, so `odds(równo) > odds(2. połowa)` always holds in correct data.

| Metric | August baseline | Today | Verdict |
|---|---|---|---|
| Events found / scraped (run 2, `440d2fc6`; run 3 at 17:00Z) | 20/20 | 20/20; 7,878 / 7,885 parsed, 6,222 / 6,224 saved | ok |
| Markets per near-term match (log) | 676 raw markets / 1,699 sel., Arsenal–Coventry (`aityper/docs/match-audit/.tmp/raw/premier_league_arsenal_coventry_city.json`) | 411–753 (10 matches), far-dated 208–267 | ok, see the offer note |
| Offline A/B, CURRENT normalizer on Aug raw vs today's live Arsenal–Hull City | 676 mk, 138 codes, 1,678 sel., 0 % UNKNOWN, 0 OTHER | 411 mk, 137 codes, 1,439 sel., 0 % UNKNOWN, 5 OTHER (0.3 % sel.) | ok |
| DB rows / OTHER rows (`market_comparison`) | — | Ars–Hul 356/5, Lee–Tot 476/10, Eve–Cov 515/10, MCI–FUL 223/0; league-wide 83 OTHER of 6,222 (1.3 %) | ok |
| Codes in API | 128 (Aug API dump) | 137 (Ars–Hul), 141 (Lee–Tot), 152 (Eve–Cov DB) | ok |
| UNKNOWN selections in DB | 0 | 0 | ok |
| **Player params labelled "I. Surname" although a peer sent the full name** | ~0 (Fuksiarz sent "Surname, First") | **101** (Ars–Hul), **86** (Lee–Tot) | **regression** |
| Fuksiarz-only player params labelled "I. Surname" | ~0 | 57 (Ars–Hul), 89 (Lee–Tot) | regression (mostly cosmetic; see the next row) |
| **Fuksiarz-only "I. Surname" rows with a compatible full-name peer row in the same market** (stranded odds, Fuksiarz left out of the comparison) | ~0 ("Surname, First" canonicalized to the exact full name) | **2** (Ars–Hul), **17** (Lee–Tot) | **regression** |
| 1X2 max abs deviation vs peer median, 20 matches | — | 12.5 % (Arsenal–Hull AWAY 18 vs 16); no swaps, no x10 | ok |
| O/U 1.5/2.5/3.5 vs peer median, 3 matches | — | within ±6.6 % | ok |
| Team-name merge | 20/20 | 20/20 under the shared `matchId`, 0 orphans. Short names ("Nottingham", "Leeds", "Coventry") are canonicalized correctly | ok |
| `aityper/docs/audit-ledger/coverage.json` (bookmaker → catalog code → selection codes, built 2026-07-09 from World Cup France–Morocco) | 149 codes | 152 codes across 3 PL matches; 22 coverage.json codes are absent (renamed codes such as SECOND_HALF_WIN_TO_NIL → HOME/AWAY split, World Cup-only or offer-dependent markets). The like-for-like PL A/B loses only offer-driven codes | weak baseline (code churn), ok |
| Tests | — | `src/scrapers/bookmakers/fuksiarz` 5/5. Golden `fuksiarz`: argentina_switzerland 31/31 blessed, france_morocco 258 blessed / 409, 0 failures | ok |

Sources: `evidence/fuksiarz/run2-log-lines.txt`, `db-stats-2026-11-06.txt`, `offline-ab-summary.json`, `mw-1x2-sanity-2026-11-06.txt`, `ou-sanity-2026-11-06.txt`, `abbreviated-player-labels-api-2026-11-06.json`. The withPeers / fuksiarzOnly / stranded counts are reproduced offline on the CURRENT grouper from the frozen DB inputs `evidence/fuksiarz/grouper-input-player-markets-{arsenal-hull,leeds-tottenham}-2026-11-06.json` with `evidence/fuksiarz/tools/measure-grouper.mts`: `{"withPeers":101,"fuksiarzOnly":57,"stranded":2}` and `{"withPeers":86,"fuksiarzOnly":89,"stranded":17}`. The live API gives the same numbers (`evidence/fuksiarz/tools/stranded_rows.py` on today's `normalized-markets`).

**The lower Arsenal–Hull count (411) comes from the offer, not from a defect.** The offline A/B "lost" PLAYER_FOULS, PLAYER_FOULS_WON, PLAYER_SHOTS and PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX. The reason is that gameTypes `-4897..-4900`, `-30519..-30521` and `-4893/-4894` are missing from the Arsenal–Hull event JSON (`evidence/fuksiarz/event-arsenal-hull-2026-11-06.json`). They are present and mapped for Leeds–Tottenham (`event-leeds-tottenham-2026-11-06.json`; DB: PLAYER_FOULS 37, PLAYER_FOULS_WON 38, PLAYER_SHOTS 41 rows) and for Everton–Coventry.

### Symptom
- The log shows no Fuksiarz-specific warning, because Fuksiarz does not log unmapped markets. Generic `[Normalizer] Market mapped to OTHER` lines carry no bookmaker tag.
- The run produces 80 `[FullOfferRepo] marketKey collision ... for fuksiarz TIME_PERIOD_ASIAN_HANDICAP:{5,10,15,30} [AWAY]` lines (4 windows × 20 matches; `evidence/fuksiarz/run2-marketkey-collisions.txt`). This is pre-existing (see below).
- In the API, the labels of 101/86 player parameters per match show Fuksiarz's abbreviation even when Superbet/Betfan sent the full name. Examples: PLAYER_CARDS "O. Zambrano" [fuksiarz, superbet], where Superbet's raw text is "Oscar Zambrano"; PLAYER_SHOTS "I. Gruev" [fuksiarz, superbet].

### Root cause 1: Fuksiarz changed its player-name format, and the grouper tie-break prefers the abbreviation
- Bookmaker change, verified from raw captures (`evidence/fuksiarz/player-name-format-aug-vs-now.json`):
  - August "Strzeli gola": `"Amenda, Aurèle", "Bidwell, Jake", "Calafiori, Riccardo"` (43/44 "Surname, First").
  - Today: `"A. Ömür", "S. Ajayi", "B. White", "M. Bachir Belloumi"` (45/46 "I. Surname").
  - The same change shows in "Zaliczy asystę", "Strzelec 1. gola" and "Odda co najmniej 1 celny strzał".
- Our side: `reconcilePlayerNameVariants` (`src/services/market-type-grouper.ts:228`) correctly treats "O. Zambrano" and "Oscar Zambrano" as one player. Its `preferred()` (`market-type-grouper.ts:236-242`) ranks first by bookmaker count, then by token count, then by `localeCompare`. On a 1-vs-1 tie with the same token count, "O. Zambrano" sorts first because `.` sorts before letters. With 3 vs 2 tokens, "M. Bachir Belloumi" beats "Mohamed Belloumi".
- Reproduced on the current code (scratch probe):
  - `[["O. Zambrano",{fuksiarz}],["Oscar Zambrano",{superbet}]]` → alias `Oscar Zambrano → O. Zambrano`.
  - The same holds for `Ilia Gruev → I. Gruev`, `Mohamed Belloumi → M. Bachir Belloumi`, and `Marli Salmon → M. Salmon` (2 vs 1 bookmakers).
- In these 101 / 86 rows the odds still merge into one parameter, so comparison is intact there. The visible label is degraded, and the same player is shown under different names in different dropdowns of one match. The rows where the odds do NOT merge are root cause 1b.

### Root cause 1b: abbreviated Fuksiarz rows stranded next to their peers' row
- A fold happens only when the cluster of compatible names is a CLIQUE (`market-type-grouper.ts:328-337`). In August, "Surname, First" canonicalized to the exact full name, so no fold was needed. Now "J. van Hecke" must be folded, and two things break the clique:
  - **Peers disagree on the spelling.** "Jan Paul van Hecke" [betcris, fortuna, lvbet] and "Jan-Paul van Hecke" [betfan, etoto, superbet] are not compatible with each other: `sameFirstName("jan","jan-paul")` is false because neither is an initial (`:268-275`). "J. van Hecke" fits both, so nothing folds. Same shape: "T. Iroegbunam" next to "Tim Iroegbunam" [betfan] and "Timothy Iroegbunam" [betcris, lvbet].
  - **Peers send non-person params.** LVBet's PLAYER_GOAL_OR_ASSIST carries combos ("Dominic Solanke or Dominic Calvert-Lewin" @1.52, "Ao Tanaka or Archie Gray"). `describeSamePlayer` (`:281-295`) finds "D. Calvert-Lewin" compatible with the combo, so the cluster bridges two players and is not a clique. Fortuna's PLAYER_RED_CARD params are sentences ("Mohamed Bachir Belloumi wyrzucony z boiska"), which have the same effect for "M. Bachir Belloumi".
- Live examples (API, 2026-11-06): GOALSCORER_FIRST "J. van Hecke" [fuksiarz] sits next to both van Hecke spellings (8 market types). PLAYER_GOAL_OR_ASSIST "D. Calvert-Lewin", "D. Solanke", "A. Gray", "A. Tanaka", "O. Marmoush" [fuksiarz] each sit next to the full name quoted by 6 bookmakers. PLAYER_RED_CARD "M. Bachir Belloumi" sits next to "Mohamed Belloumi" [betfan, superbet].
- Latent odds-integrity hazard (pre-existing, fixed by Task 2): when the cluster IS a clique, a combo is folded into a single player. Lee–Tot: "Jayden Bogle or Mohammed Kudus" [lvbet, @2.0] folds into "Jayden Bogle" (lvbet's own quote is @4.75). The duplicate selection keeps the first quote (`market-type-grouper.ts:1149-1168`), so the API shows 4.75 only because lvbet lists the single player first. This was verified on the frozen input: reversing lvbet's selection order makes the CURRENT grouper show lvbet @2.0 for "Jayden Bogle". The Tasks 1+2 copy shows 4.75 in both orders.
- Task 1 alone does not fix these rows. Simulated on the frozen inputs, stranded stays 2 / 17.

### Simulated effect of Tasks 1–3 (offline, frozen DB inputs, scratch copy of the grouper)

| Grouper | Ars–Hul params / withPeers / fuksiarzOnly / stranded | Lee–Tot params / withPeers / fuksiarzOnly / stranded |
|---|---|---|
| current | 1300 / 101 / 57 / 2 | 1376 / 86 / 89 / 17 |
| Task 1 | 1300 / 0 / 57 / 2 | 1376 / 0 / 89 / 17 |
| Tasks 1+2 | 1291 / 0 / 60 / 2 | 1343 / 0 / 73 / 1 |
| Tasks 1+2+3 | 1288 / 0 / 10 / 2 | 1343 / 0 / 39 / 1 |

- `params` counts the player-parameter rows only. The drops come from hyphen and case spellings that now merge, for example "Jens Hjerto Dahl" [fortuna] with "Jens Hjerto-Dahl" [betfan, sts], and "Micky Van de Ven" with "Micky van de Ven". The +3 fuksiarzOnly in Ars–Hul after Task 2 are rows that were previously merged with an LVBet combo.
- Every fold of a non-abbreviated name that Tasks 1+2 add was checked by hand. All are the same player: hyphen and case spellings, a dropped middle name ("James Michael Justin" / "James Justin"), and Fortuna's "X wyrzucony z boiska" folding into "X" as it does today.
- The residual stranded rows are left alone on purpose:
  - "T. Iroegbunam" (Tim / Timothy): resolving it needs a nickname table. Folding it by "same initial and surname" would also fold "J Silva" into "Joao Silva" or "Jorge Silva" and break the guard at `player-name-reconcile.test.ts:102`.
  - "M. Bachir Belloumi" and "A. Robertson": blocked by Fortuna's sentence param plus Andy / Andrew. See open question 3.

### Root cause 2: two new Fuksiarz gameTypes are not in `FUKSIARZ_MARKET_ID_TO_CODE` (`fuksiarz-normalizer.ts:27`)

| gameType | Raw name | Shape | Today | Should be |
|---|---|---|---|---|
| `-4895`, `-4896` | "Odda co najmniej 1/2 celny strzał głową" (15 / 2 players, Lee–Tot) | parser splits it into one market per player, selection = player | OTHER (`E. Ampadu` @11) | PLAYER_HEADER_SHOTS_ON_TARGET (peers: betfan, fortuna, sts, superbet) |
| `-30640` | "Każda drużyna powyżej X rzutu rożnego", X = 1.5–4.5 | one selection "powyżej X" | OTHER (40 rows league-wide) | EACH_TEAM_TOTAL_CORNERS_OVER (catalog `market-catalog.ts:5578`, selections ["OVER"], decimal param) |

"Zakłady specjalne #3/#4/#4.1/#4.2" (gameTypes `-30063..-30060`, single-selection specials) are correctly OTHER and must stay OTHER.

No param-extraction change is needed. The generic fallback at `fuksiarz-normalizer.ts:1106` already yields the line. Verified on a scratch copy with only the three Task 4 edits, run over the whole Lee–Tot event (710 parsed markets): exactly 21 outputs change (-4895 ×15, -4896 ×2, -30640 ×4). They give `EACH_TEAM_TOTAL_CORNERS_OVER:1.5/2.5/3.5/4.5` with `OVER` @1.1/1.4/2/3.1. Unmapped/OTHER drops from 25 to 4, and the 4 left are the specials.

### What still works and must not break
- Merging "I. Surname" with full names inside one market. Existing tests in `src/services/__tests__/player-name-reconcile.test.ts` cover this, e.g. "folds an abbreviated first name into the full one" (`:25-33`) and the ambiguity guards "leaves an ambiguous prefix alone" (`:55`) and "refuses to bridge two players through a shared abbreviation" (`:102`).
- Fortuna's PLAYER_RED_CARD sentence params ("Bruno Guimaraes wyrzucony z boiska") merge into the peers' "Bruno Guimaraes" row today, through the dropped-trailing-surname rule (`market-type-grouper.ts:285-291`). On the frozen inputs, 14 of Fortuna's 16 sentence params merge this way in Ars–Hul and 14 of 16 in Lee–Tot. The counts are the same on the current grouper and on the Tasks 1+2 copy. For this reason Task 2 must NOT exclude long or "wyrzucony" params from clustering. A scratch run of the exclusion "more than 4 tokens or 'wyrzucony'" split all of them (Ars–Hul PLAYER_RED_CARD 54 → 68 parameters).
- Every mapped Fuksiarz player-line market (PLAYER_LINE_MARKETS, `fuksiarz-normalizer.ts:259-265`), for example `-4893` → `PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX:B. Aaronson`, `1+` @5.8.
- Golden fixtures `src/services/normalization/__fixtures__/fuksiarz/*` (0 failures today).

### Pre-existing issues seen but out of scope (not regressions)
- `TIME_PERIOD_ASIAN_HANDICAP` is keyed by the minute window (5/10/15/30), not by the handicap line. Each window carries two lines, so the second one collides and is dropped ("keeping first-seen odds"). The output is identical on the August raw data. The August audit routed this to `grouper`/catalog as an axis problem.
- Player props for Arsenal–Hull appear later than for other matches. That is the bookmaker's offer timing.
- Fortuna's PLAYER_RED_CARD param keeps the suffix " wyrzucony z boiska". It merges only through the trailing-surname rule. It can win the label on a token-count tie, e.g. "Declan Rice wyrzucony z boiska" [fortuna] vs "Declan Rice" [superbet] + "D. Rice" [fuksiarz]. It also blocks "M. Bachir Belloumi" and "A. Robertson" from folding. This belongs in the Fortuna normalizer (open question 3).
- Nickname pairs ("Tim" / "Timothy", "Andy" / "Andrew") are not compatible by design. There is no nickname table.

### Impact
- Parser: none. Normalizer: Task 4. Grouper: Tasks 1–3. These are shared code paths, so every bookmaker benefits. Labels that tie with an initial spelling improve. Hyphen and case spellings ("Jens Hjerto Dahl" / "Jens Hjerto-Dahl") now merge. LVBet combo params are no longer folded into a single player.
- Catalog: no change, so do not run `sync-market-types.ts`.
- Golden: existing Fuksiarz fixtures contain no `-4895/-4896/-30640` entries. Task 4 harvests them. Golden tests normalizers, not the grouper, so Tasks 1–3 do not touch it.
- Audit knowledge: the August reconcile tests assumed Fuksiarz initials were rare ("M Grimes"). Now they are the norm.

### Risks & unknowns
- False merges in Task 2. Treating `-` as a token separator everywhere would make "D. Lewin" compatible with "Dominic Calvert-Lewin" (verified on a scratch copy). Task 2 therefore applies hyphen and case insensitivity ONLY to the exact-spelling key (step 1, `:244-255`), not to `describeSamePlayer`. A test pins this.
- Task 3's match-wide expansion could map an initial to the wrong player when a full name exists for only one of two same-initial, same-surname players in the match. Mitigation: expand only when every compatible full name in the roster is mutually compatible (the "J Silva" guard), with a test. On the frozen Lee–Tot roster all 43 expansions were checked by hand and are correct.
- Diacritics: "A. Ömür" vs "Abdulkadir Ömür". `canonicalizePlayerName` (`src/services/normalization/helpers/index.ts:450`) runs in the grouper at `market-type-grouper.ts:843`, before reconciliation. Verified: it returns "A. Omur" and "Abdulkadir Omur". Task 1 therefore tests this through `groupMarketsByTypeWithParameters` with the raw accented labels.
- Calendar: the PL fixture list has no match between 2026-11-08 16:30Z (Manchester United – Aston Villa) and 2026-11-21 12:30Z (international break). Live criteria need a near-term match with player props. If execution misses 7–8 Nov, check them in the 21–23 Nov round. The offline gate below does not depend on the calendar.
- `-4895/-4896` are offer-dependent. Arsenal–Hull and far-dated fixtures do not carry them today.

### Open questions for the owner
1. Should Task 3 (match-wide spelling-out of abbreviated names in Fuksiarz-only rows) ship? It is cosmetic: fuksiarzOnly goes 60 → 10 (Ars–Hul) and 73 → 39 (Lee–Tot) after Tasks 1+2. Tasks 1 and 2 are not optional, because Task 2 fixes stranded odds.
2. Map `-30640` even though no peer currently quotes EACH_TEAM_TOTAL_CORNERS_OVER for PL? (STS maps the same code from id 2097 when it offers it.)
3. Route "strip ' wyrzucony z boiska' from Fortuna's PLAYER_RED_CARD param" to the Fortuna plan? It would clear the "M. Bachir Belloumi" residual (Ars–Hul) and fix the "Declan Rice wyrzucony z boiska" label.

### Acceptance criteria

**A. Offline gate (does not depend on the fixture calendar; run in `$WT` before merging).**
1. Grouper, frozen DB inputs. Run `cd "$WT" && for m in arsenal-hull leeds-tottenham; do npx tsx $PLAN/evidence/fuksiarz/tools/measure-grouper.mts "$WT/src/services/market-type-grouper.ts" $PLAN/evidence/fuksiarz/grouper-input-player-markets-$m-2026-11-06.json; done`. The first four fields must match exactly. The command shape was proven on the current code; it prints the "current" row.

   | After | Arsenal–Hull | Leeds–Tottenham |
   |---|---|---|
   | current (proven) | `"params":1300,"withPeers":101,"fuksiarzOnly":57,"stranded":2` | `"params":1376,"withPeers":86,"fuksiarzOnly":89,"stranded":17` |
   | Task 1 | `1300 / 0 / 57 / 2` | `1376 / 0 / 89 / 17` |
   | Task 2 | `1291 / 0 / 60 / 2` (T. Iroegbunam, M. Bachir Belloumi) | `1343 / 0 / 73 / 1` (A. Robertson) |
   | Task 3 | `1288 / 0 / 10 / 2` | `1343 / 0 / 39 / 1` |
2. Normalizer: Task 4's unit tests pass on the trimmed fixture, and the golden diff contains exactly the entries listed in Task 4 Step 6.
3. Header-shot plausibility, baseline. Run `python3 -I $PLAN/evidence/fuksiarz/tools/header_shots_vs_peers.py $PLAN/evidence/fuksiarz/nm-leeds-tottenham-header-shots-2026-11-06.json --fuksiarz-event $PLAN/evidence/fuksiarz/event-leeds-tottenham-2026-11-06.json`. Both inputs are frozen: the API snapshot was trimmed to PLAYER_HEADER_SHOTS_ON_TARGET, and the Fuksiarz odds come from the raw event. It gives `"fuksiarzPlayers": 15, "sharedWithPeer": 15, "medianAbsDevPct": 25.2, "maxRatio": 2.3`. 5 of 15 players are more than 50 % off the peer median (D. James 20 vs 8.8; J. Justin 9.4 vs 6; N. Okafor 5.0 vs 11.5; A. Tanaka 6.2 vs 14; N. Elvedi 9.9 vs 6.4). This is a sparse long-shot market, so the live criterion B5 is distributional, not per player.

**B. Live (after the owner merges and the dev server restarts, one scheduled run).** These need a near-term match with player props, so run them by 2026-11-08 16:30Z or in the 21–23 Nov round.
1. Volume. Log lines: `Found N events` equals `Completed: N matches` (N = 20 today), and no match below 180 parsed markets (today's minimum is 208, far-dated). If the window holds at least 10 matches starting within 72 h, the total is ≥ 7,500 (runs 2/3: 7,878 / 7,885). During the international break the window is all far-dated (~210–270 each), so only the per-match floor applies.
2. Labels. `curl -s 'http://localhost:3001/api/matches/Leeds%20United/Tottenham%20Hotspur/normalized-markets?league=premier-league' > /tmp/nm.json && python3 -I $PLAN/evidence/lvbet/tools/abbreviated_labels.py /tmp/nm.json` → `"withPeers": 0` (today 86). If the match has kicked off, use any near-term match. Today, Arsenal–Hull gives 101.
3. Stranded odds. `python3 -I $PLAN/evidence/fuksiarz/tools/stranded_rows.py /tmp/nm.json` → `"stranded"` ≤ 1 for Lee–Tot (today 17) and ≤ 2 for Ars–Hul (today 2). For any other match, inspect `sample`: every residual must be a nickname pair (Tim/Timothy, Andy/Andrew) or a row blocked by Fortuna's "… wyrzucony z boiska" param.
4. Mappings. The smoke test below on a match offering `-4895` prints `Unmapped/OTHER: 4`, every one of them "Zakłady specjalne #…". The grep for header-shot / each-team-corner names in the UNMAPPED list prints `0`.
5. Header shots. For a match offering `-4895`, `python3 -I $PLAN/evidence/fuksiarz/tools/header_shots_vs_peers.py /tmp/nm.json` must give: `sharedWithPeer` ≥ 12 of `fuksiarzPlayers` (baseline 15/15); `medianAbsDevPct` ≤ 35 (baseline 25.2); `maxRatio` < 5 (baseline 2.3). A ratio of 5 or more points to an x10 or swap defect.
6. If Task 3 shipped: `fuksiarzOnly` from B2 drops by ≥ 50 % against the pre-deploy value for the same match. Offline it drops 89 → 39 for Lee–Tot.
7. Unchanged sanity. Run `curl -s 'http://localhost:3001/api/odds?league=premier-league' > /tmp/odds.json && python3 -I $PLAN/evidence/lvbet/tools/mw_sanity.py /tmp/odds.json | tail -1`. Expected: `'fuksiarz'` ≤ 15.0 (today 12.5). `python3 -I $PLAN/evidence/lvbet/tools/mw_sanity.py /tmp/odds.json | grep -c '| fuksiarz | HOME='` prints the fixture count (20 today), which means every match is merged under the shared matchId. `grep -c 'fuksiarz | MISSING'` prints 0. Then run `python3 -I $PLAN/evidence/lvbet/tools/ou_sanity.py /tmp/nm.json | grep fuksiarz`. Expected: lines 1.5/2.5/3.5, each with OVER and UNDER, and every deviation within ±10 % (today ≤ 6.6 %).

**Single-bookmaker live smoke test** (read-only, no DB writes). Pin the event: Leeds United – Tottenham Hotspur, `https://fuksiarz.pl/szczegoly/23464740` (kick-off 2026-11-07 12:30Z). It carries `-4895` (15 players), `-4896` (2) and `-30640` (4 lines). After that kick-off, use Fulham – Newcastle United `23465146` (2026-11-07 15:00Z). Per `evidence/fuksiarz/db-other-rows-league-2026-11-06.json`, only Everton–Coventry, Fulham–Newcastle and Leeds–Tottenham carried `-4895/-4896` in the 16:00Z run. Arsenal–Hull and Manchester United–Aston Villa did not. After 7 Nov 15:00Z, use a 21–23 Nov fixture whose smoke output lists "Odda co najmniej 1 celny strzał głową". Each run calls `scrapeFullOffer` for the whole league (`scraper-audit-core.ts:105`), which is about 20 event fetches, so run it once per verification. Write the raw output to a file. Piping it through `sed` lost the tail when `timeout` ended the run: both 2026-11-06 captures stop on a 4 KiB boundary.
```bash
cd "$WT"   # or $LIVE for a read-only run on unmodified code
timeout 150 npx tsx scripts/fuksiarz-market-discovery.ts \
  --url "https://fuksiarz.pl/szczegoly/23464740" --league premier-league > /tmp/fk-smoke.raw 2>&1
sed 's/\x1b\[[0-9;]*m//g' /tmp/fk-smoke.raw | sed -n '/SUMMARY/,/With issues/p'
sed 's/\x1b\[[0-9;]*m//g' /tmp/fk-smoke.raw | sed -n '/UNMAPPED MARKETS:/,$p' \
  | grep -cE '^   (Odda co najmniej [12] .*głową|Każda drużyna powyżej)'
```
Exit 124 from `timeout` is expected, because the BrowserPool keeps the process alive after SUMMARY. This exact command shape was proven on the current code on 2026-11-06 at 17:40Z: `Total markets: 710 / Mapped: 685 / Unmapped/OTHER: 25`, and the grep printed `21` (15 + 2 header-shot rows and 4 corner lines; run C in `evidence/fuksiarz/smoke-leeds-tottenham-before-2026-11-06.txt`). After Task 4 expect `Mapped: 706 / Unmapped/OTHER: 4` (only "Zakłady specjalne #3/#4/#4.1/#4.2"), and the grep prints `0`. The after-values come from the offline cross-check on the same 710 markets.

## Global Constraints

- Commit messages are concise and descriptive. **No signature or attribution footers**: no "Co-Authored-By", no "Generated with". The user's CLAUDE.md overrides any harness reminder.
- Commit only after the owner has explicitly approved executing this plan (repo rule: commit only when explicitly requested). Branch from `master`.
- Code and comments are in English.
- **Paths.** Define these once per shell and use them in every command:
  ```bash
  LIVE=/home/skamik/Documents/repositories/personal/aityper-scraper-api          # running service (tsx watch): read-only
  PLAN=$LIVE/docs/superpowers/plans/2026-11-06-scraper-recovery                 # untracked, exists only in $LIVE
  WT=<absolute path of the git worktree for this plan>                          # all edits, tests, harvests, commits
  ```
  Create `$WT` with superpowers:using-git-worktrees from `master`, then run `npm ci` in it (a fresh worktree has no `node_modules`). Every command block below starts with `cd "$WT"`. Use `$LIVE` only for the read-only smoke and the curls against `:3001`. Editing anything under `$LIVE/src` restarts the running dev server.
- Before every commit, run `cd "$WT" && npx tsc --noEmit` (exit 0) and `npx vitest run` (all files pass). `tsconfig.json:23` excludes `__tests__`, so `tsc` does not check test files. vitest is the only gate for them.
- Golden-fixture discipline: the failing fixture comes first. Re-bless only after inspecting the diff, with `npx tsx scripts/rebless-golden.ts --bookmaker fuksiarz --fixture <matchIdSafe> --dry`, then the same command without `--dry`. Never hand-edit `*.expected.json`, and never re-bless entries the task did not intend to change.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan does not change it.
- `scripts/harvest-fixtures.ts` and `scripts/<bm>-prep-audit.ts` still default to the pre-split monorepo layout (`harvest-fixtures.ts:224-225` → `<parent>/backend/...`; `fuksiarz-prep-audit.ts:71` → `../docs/...`). Always pass `--out` (named `<matchIdSafe>__<YYYY-MM-DD>.json`; see Task 4), `--out-dir "$WT/src/services/normalization/__fixtures__"` and `--registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json`.
- Keep live bookmaker traffic modest. Each discovery or prep-audit run scrapes the whole league (about 20 event fetches), so do at most one per verification step.

## Review Focus

0. **HALF_WITH_MORE_GOALS in template label order with correct prices** (`równo` 3.65 at position 1, `2. połowa` 2.1 at position 2). Expected: unchanged, `równo` = 3.65. Owner: Task 0 (test "keeps correctly priced template-order labels untouched").
1. **Two different players share an initial and a surname** (e.g. "J Silva" with "Joao Silva" and "Jorge Silva" in one match). Expected: no merge and no expansion. Owner: Tasks 1–2, where the existing guard `player-name-reconcile.test.ts:102` must still pass, including Task 2's non-clique fallback. Task 3 adds the test "does not expand an initial with two candidate full names".
2. **The initial spelling has more bookmakers than the full one** ("M. Salmon" from fuksiarz and a second bookmaker vs "Marli Salmon" from one). Expected: the label is the full name. Owner: Task 1 (test "prefers the spelled-out first name even when the initial spelling has more bookmakers").
3. **Middle-name abbreviation** ("M. Bachir Belloumi" vs "Mohamed Belloumi"), and STS's trailing initial ("Zambrano O."). Expected: "Mohamed Belloumi"; a leading initial beats a trailing one. Owner: Task 1.
4. **A raw label with accents** ("A. Ömür" vs "Abdulkadir Ömür"). Expected: one parameter "Abdulkadir Omur" carrying both bookmakers. Owner: Task 1. The test goes through `groupMarketsByTypeWithParameters` with the raw accented labels, so `canonicalizePlayerName` is exercised. Today it fails with `[ 'A. Omur' ]`.
5. **A combo param is never folded into a single player** ("Jayden Bogle or Mohammed Kudus" @2.0 must not land on lvbet's "Jayden Bogle" @4.75). This is an odds-integrity hazard. Owner: Task 2.
6. **Hyphen and case spellings merge, but hyphens do not create new surname matches** ("Jan-Paul van Hecke" = "Jan Paul Van Hecke"; "D. Lewin" ≠ "Dominic Calvert-Lewin"). Owner: Task 2.
7. **Fortuna's sentence params keep merging** ("Bruno Guimaraes wyrzucony z boiska" → "Bruno Guimaraes"). Owner: Task 2 guard test, plus offline gate A1 (`params` exact).
8. **Specials stay OTHER**: "Zakłady specjalne #4.1" ("Leeds powyżej 1,5 rzutu rożnego w każdej połowie" in the fixture) must not be caught by the new `-30640` corners mapping. Owner: Task 4 test.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/scrapers/bookmakers/fuksiarz/parser.ts` | Modify `repairHalfWithMoreGoalsLabels` (`:173-187`) and its doc comment (`:160-172`) | price-guarded HWMG label repair (Task 0) |
| `src/scrapers/bookmakers/fuksiarz/__tests__/parser.test.ts` | Extend (`:91-123` block) | Task 0 tests |
| `src/services/market-type-grouper.ts` | Modify `reconcilePlayerNameVariants` (`:228-351`: `preferred` `:236-242`, spelling key `:244-248`, names filter `:230`, clique loop `:328-337`); lift `sameFirstName`/`isSubsequence`/`describeSamePlayer` (`:268-295`) to module scope; add `expandAbbreviatedPlayerNames` and its pre-pass inside `groupMarketsByTypeWithParameters` (`:696`) between `:963` and `:968` | player-label reconciliation (Tasks 1–3) |
| `src/services/__tests__/player-name-reconcile.test.ts` | Extend | unit tests for Tasks 1–3 |
| `src/services/normalization/bookmakers/fuksiarz-normalizer.ts` | Modify `:27-201` (id map, add next to `"-4893"` at `:78`), `:259-265` (PLAYER_LINE_MARKETS), `:1353-1396` (OVER/UNDER case group) | Task 4 mappings |
| `src/services/normalization/bookmakers/__tests__/fixtures/fuksiarz-leeds-tottenham-2026-11-06.json` | Create (copy of `$PLAN/evidence/fuksiarz/fixture-leeds-tottenham-2026-11-06.trimmed.json`, 5.7 KB: `{code, data:{eventId, eventName, eventStart, eventGames:[7 games: -4895, -4896, -30640 ×4, -30061]}}`) | durable raw input for Task 4 |
| `src/services/normalization/bookmakers/__tests__/fuksiarz-2026-11-markets.test.ts` | Create | Task 4 tests |
| `src/services/normalization/__fixtures__/fuksiarz/premier-league_leeds_united_tottenham_hotspur.{json,expected.json}` | Create via harvest (name follows the match actually harvested) | golden net for Task 4 |

---

### Task 0 (P0, ship first, independent of Tasks 1–4): Guard the half-with-more-goals label repair on prices

**Files:**
- Modify: `src/scrapers/bookmakers/fuksiarz/parser.ts:160-187`
- Test: `src/scrapers/bookmakers/fuksiarz/__tests__/parser.test.ts` (same `describe` as `:91`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `repairHalfWithMoreGoalsLabels(outcomes: FuksiarzOutcome[]): FuksiarzOutcome[]` keeps its signature; it swaps the `równo` / `2. połowa` labels only when the labels are in template order **and** `outcomes[1].outcomeOdds < outcomes[2].outcomeOdds`.

- [ ] **Step 1: Write the failing test** `it("keeps correctly priced template-order labels untouched")`: outcomes `1. połowa` 2.9 (pos 0), `równo` 3.65 (pos 1), `2. połowa` 2.1 (pos 2) → `bySelectionName.get("równo") === 3.65`, `get("2. połowa") === 2.1`, `get("1. połowa") === 2.9`. Keep the two existing tests at `:91` and `:108` unchanged: the August pattern (`równo` 2.09 < `2. połowa` 3.6) must still be swapped.
- [ ] **Step 2: Run it and see it fail**
  Run: `cd "$WT" && npx vitest run src/scrapers/bookmakers/fuksiarz`
  Expected: the new test FAILS with `expected 2.1 to be 3.65`; the other 5 pass.
- [ ] **Step 3: Implement** the price condition in `repairHalfWithMoreGoalsLabels` (return `outcomes` unchanged when `outcomes[1].outcomeOdds >= outcomes[2].outcomeOdds` or either price is missing/0). Rewrite the doc comment: the guard is on prices because an equal split is always the longest price; the label-order guard alone stopped being sufficient once Fuksiarz fixed the prices (2026-11).
- [ ] **Step 4: Run tests**
  Run: `cd "$WT" && npx vitest run src/scrapers/bookmakers/fuksiarz && npx vitest run src/services/normalization/__tests__/golden.test.ts -t fuksiarz && npx tsc --noEmit`
  Expected: 6/6 parser tests pass; golden fuksiarz 3 passed / 0 failures with no rebless (golden fixtures store post-parser selections, e.g. France–Morocco id 38 = `1. połowa` 3.25 / `równo` 3.3 / `2. połowa` 2.05, so a parser change cannot alter them; parser coverage comes only from the Step 1 test); tsc exit 0.
- [ ] **Step 5: Commit**
  ```bash
  git add src/scrapers/bookmakers/fuksiarz/parser.ts src/scrapers/bookmakers/fuksiarz/__tests__/parser.test.ts
  git commit -m "fix(fuksiarz): guard the half-with-more-goals label repair on prices"
  ```
- [ ] **Step 6: Live acceptance (after merge and the next scheduled scrape)**: re-run the comparison that produced `evidence/fuksiarz/hwmg-live-vs-peers-2026-11-06.txt` (per match: fuksiarz DRAW and 2ND_HALF vs the peer median from `normalized-markets`). Expected: in ≥ 18/20 matches fuksiarz DRAW is within ±15 % of the peer median and 2ND_HALF ≤ 1.15 × the peer median; fuksiarz is no longer the 2ND_HALF best price on every match.

### Task 1: A spelled-out first name wins the player-label tie-break

**Files:**
- Modify: `src/services/market-type-grouper.ts:236-242` (`preferred`), plus one new module-level helper above `:228`
- Test: `src/services/__tests__/player-name-reconcile.test.ts`

**Interfaces:**
- Consumes: `reconcilePlayerNameVariants(bookmakersByName: Map<string, Set<string>>): Map<string, string>` (unchanged signature) and `groupMarketsByTypeWithParameters` (`:696`, used by the accent test).
- Produces: `export function abbreviationRank(name: string): 0 | 1 | 2`, where a token counts as an initial when it matches `/^\p{Lu}\.?$/u`.
  - `0`: no initial token ("Oscar Zambrano").
  - `1`: the first token is an initial ("O. Zambrano", "M Grimes").
  - `2`: a later token is an initial (STS's "Zambrano O.", "Borges Rodrigues R."; `stsCanonicalizePlayerName`, `sts-normalizer.ts:479-486`, flips only two-token names at `:484`, and 3+ token shorthands survive unless pinned in `STS_PLAYER_NAME_OVERRIDES` at `:463`).
  - Also produces `export function isAbbreviatedPlayerName(name: string): boolean` (`abbreviationRank(name) > 0`). Tasks 2–3 reuse both.
  - Only UPPERCASE letters count. With `\p{L}`, the Polish "z" in Fortuna's "Mohamed Bachir Belloumi wyrzucony z boiska" counted as an initial, and a scratch run of Task 3 then silently rewrote that sentence.

- [ ] **Step 1: Write the failing tests.** Append inside the existing `describe` and reuse the file's `names()` helper. Add `groupMarketsByTypeWithParameters` to the import from `"../market-type-grouper.js"`, and `import type { ScrapedMarket } from "../../types/full-offer.js"`.

```ts
it("prefers a spelled-out first name over an initial on a bookmaker-count tie", () => {
  const alias = reconcilePlayerNameVariants(names([["O. Zambrano", ["fuksiarz"]], ["Oscar Zambrano", ["superbet"]]]));
  expect(alias.get("O. Zambrano")).toBe("Oscar Zambrano");
  expect(alias.has("Oscar Zambrano")).toBe(false);
});
it("prefers the spelled-out first name even when the initial spelling has more bookmakers", () => {
  const alias = reconcilePlayerNameVariants(names([["M. Salmon", ["fuksiarz", "lvbet"]], ["Marli Salmon", ["superbet"]]]));
  expect(alias.get("M. Salmon")).toBe("Marli Salmon");
});
it("prefers the spelled-out first name over a longer initial spelling with a middle name", () => {
  const alias = reconcilePlayerNameVariants(names([["M. Bachir Belloumi", ["fuksiarz"]], ["Mohamed Belloumi", ["superbet"]]]));
  expect(alias.get("M. Bachir Belloumi")).toBe("Mohamed Belloumi");
});
it("folds a trailing-initial and a leading-initial spelling into the full name", () => {
  const alias = reconcilePlayerNameVariants(names([
    ["Bachir Belloumi M.", ["sts"]], ["M. Bachir Belloumi", ["fuksiarz"]], ["Mohamed Belloumi", ["superbet"]],
  ]));
  expect(alias.get("Bachir Belloumi M.")).toBe("Mohamed Belloumi");
  expect(alias.get("M. Bachir Belloumi")).toBe("Mohamed Belloumi");
});
it("prefers a leading initial over STS's trailing initial", () => {
  // Guard: passes today (localeCompare tie) and must keep passing. A first-token-only
  // abbreviation check would make "Zambrano O." win.
  const alias = reconcilePlayerNameVariants(names([["Zambrano O.", ["sts"]], ["O. Zambrano", ["fuksiarz"]]]));
  expect(alias.get("Zambrano O.")).toBe("O. Zambrano");
});
it("merges an accented initial and full name under the accent-folded full name", () => {
  const mk = (paramValue: string, odds: number): ScrapedMarket => ({
    name: "Celne strzały", type: "PLAYER_SHOTS_ON_TARGET", normalizedType: "PLAYER_SHOTS_ON_TARGET",
    marketKey: `PLAYER_SHOTS_ON_TARGET:${paramValue}`, paramValue,
    selections: [{ name: "1+", normalizedName: "1+", odds }],
  }) as ScrapedMarket;
  const out = groupMarketsByTypeWithParameters([
    { market: mk("A. Ömür", 2.1), bookmaker: "fuksiarz" },
    { market: mk("Abdulkadir Ömür", 2.05), bookmaker: "superbet" },
  ]);
  const market = out.find((m) => m.type === "PLAYER_SHOTS_ON_TARGET")!;
  expect(market.parameters.map((p) => p.value)).toEqual(["Abdulkadir Omur"]);
  expect(market.parameters[0].bookmakers.map((b) => b.bookmaker).sort()).toEqual(["fuksiarz", "superbet"]);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd "$WT" && npx vitest run src/services/__tests__/player-name-reconcile.test.ts`
Expected: 5 FAIL, 1 PASS (the STS guard). Messages, verified on the current code in a scratch copy of these tests:
- `AssertionError: expected undefined to be 'Oscar Zambrano'`
- `expected undefined to be 'Marli Salmon'`
- `expected undefined to be 'Mohamed Belloumi'` (both Belloumi tests)
- `expected [ 'A. Omur' ] to deeply equal [ 'Abdulkadir Omur' ]`

- [ ] **Step 3: Implement**

In `preferred(a, b)`, rank first by `abbreviationRank`; the lower rank wins. After that, keep the existing order: bookmaker count, then token count, then `localeCompare`. Update the function's doc comment: "the majority form wins" now applies only among names that are equally spelled out.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd "$WT" && npx vitest run src/services/__tests__/player-name-reconcile.test.ts src/services/__tests__/market-type-grouper-audit-fixes.test.ts src/services/__tests__/market-type-grouper-quarantine.test.ts src/services/__tests__/triple-buttons-fix.test.ts`
Expected: all PASS, including the old cases "folds an abbreviated first name into the full one", "leaves an ambiguous prefix alone" and "refuses to bridge two players through a shared abbreviation".
Offline gate A1: `withPeers` is 0 for both inputs, and every other field is unchanged (`1300/0/57/2`, `1376/0/89/17`).

- [ ] **Step 5: Full gate and commit**

Run: `cd "$WT" && npx tsc --noEmit && npx vitest run`. Expected: exit 0, all green. Golden is unaffected, because it tests normalizers, not the grouper.
```bash
cd "$WT"
git add src/services/market-type-grouper.ts src/services/__tests__/player-name-reconcile.test.ts
git commit -m "grouper: prefer spelled-out player names over initials when reconciling labels"
```

### Task 2: Fold stranded abbreviated rows (combos, hyphen spellings, non-clique clusters)

**Files:**
- Modify: `src/services/market-type-grouper.ts`. The names filter (`:230`), the spelling key (`:244-248`) and the clique loop (`:328-337`) change. `sameFirstName`/`isSubsequence`/`describeSamePlayer` (`:268-295`) are lifted to module scope unchanged.
- Test: `src/services/__tests__/player-name-reconcile.test.ts`

**Interfaces:**
- Consumes: `abbreviationRank` and `isAbbreviatedPlayerName` (Task 1).
- Produces (module scope; Task 3 reuses them):
  - `export function isNonPersonParam(name: string): boolean`: `/\s(or|i|lub|and)\s|&|\d/i.test(name)`. These are multi-player combos and counts. Long or "wyrzucony" params are deliberately NOT excluded (see "What still works").
  - `function spellingKey(name: string): string`: lowercase, split on `/[\s-]+/`, sort, join. It is used only for the exact-spelling step (step 1). "Jan-Paul van Hecke", "Jan Paul Van Hecke" and "Jan Paul van Hecke" share one key.
  - `export function playerNamesCompatible(a: string, b: string): boolean`: `spellingKey(a) === spellingKey(b) || describeSamePlayer(tokens(a), tokens(b))`. Here `tokens` is the current whitespace tokenizer (`:233`), so a hyphen still joins surname parts and "D. Lewin" stays incompatible with "Dominic Calvert-Lewin".
- Rule changes in `reconcilePlayerNameVariants`:
  1. Names for which `isNonPersonParam` is true are dropped from `names` (`:230`), so they are never aliased and never bridge a cluster.
  2. Step 1 groups by `spellingKey` instead of the sorted whitespace tokens.
  3. Non-clique cluster: each member with `isAbbreviatedPlayerName` true folds into `candidates.reduce(preferred)`. Here `candidates` is every non-abbreviated cluster member compatible with it. The fold happens only when `candidates` is non-empty and pairwise compatible. Members with rank 0 are not touched. With "J Silva" / "Joao Silva" / "Jorge Silva", the candidates are not compatible with each other, so nothing folds.

- [ ] **Step 1: Write the failing tests.** All values are taken from the live 2026-11-06 Lee–Tot / Ars–Hul rows.

```ts
describe("reconcilePlayerNameVariants - stranded abbreviated rows (2026-11)", () => {
  it("folds an initial when peers disagree only on hyphen and case", () => {
    const alias = reconcilePlayerNameVariants(names([
      ["J. van Hecke", ["fuksiarz"]],
      ["Jan Paul van Hecke", ["betcris", "fortuna", "lvbet"]],
      ["Jan-Paul van Hecke", ["betfan", "etoto", "superbet"]],
    ]));
    expect(alias.get("J. van Hecke")).toBe("Jan Paul van Hecke");
    expect(alias.get("Jan-Paul van Hecke")).toBe("Jan Paul van Hecke");
  });
  it("merges a hyphenated and a spaced double surname", () => {
    const alias = reconcilePlayerNameVariants(names([["Jens Hjerto-Dahl", ["betfan", "sts"]], ["Jens Hjerto Dahl", ["fortuna"]]]));
    expect(alias.get("Jens Hjerto Dahl")).toBe("Jens Hjerto-Dahl");
  });
  it("does not let a hyphen create a new surname match", () => {
    const alias = reconcilePlayerNameVariants(names([["D. Lewin", ["fuksiarz"]], ["Dominic Calvert-Lewin", ["betfan"]]]));
    expect(alias.size).toBe(0);
  });
  it("ignores LVBet combo params when clustering", () => {
    const alias = reconcilePlayerNameVariants(names([
      ["D. Calvert-Lewin", ["fuksiarz"]],
      ["Dominic Calvert-Lewin", ["betcris", "betfan", "forbet", "fortuna", "lvbet", "superbet"]],
      ["Dominic Solanke or Dominic Calvert-Lewin", ["lvbet"]],
      ["Omar Marmoush or Dominic Calvert-Lewin", ["lvbet"]],
      ["Dominic Calvert-Lewin or Harry Wilson", ["lvbet"]],
    ]));
    expect(alias.get("D. Calvert-Lewin")).toBe("Dominic Calvert-Lewin");
    expect(alias.has("Dominic Solanke or Dominic Calvert-Lewin")).toBe(false);
  });
  it("never folds a combo into a single player", () => {
    // lvbet quotes "Jayden Bogle" @4.75 and "Jayden Bogle or Mohammed Kudus" @2.0.
    const alias = reconcilePlayerNameVariants(names([
      ["Jayden Bogle", ["betcris", "lvbet"]], ["J. Bogle", ["fuksiarz"]], ["Jayden Bogle or Mohammed Kudus", ["lvbet"]],
    ]));
    expect(alias.has("Jayden Bogle or Mohammed Kudus")).toBe(false);
    expect(alias.get("J. Bogle")).toBe("Jayden Bogle");
  });
  it("folds an initial out of a non-clique cluster when its full-name candidates agree", () => {
    // Lee-Tot PLAYER_RED_CARD: fortuna's sentence param fits "Jan Paul van Hecke" but not "J. van Hecke".
    const alias = reconcilePlayerNameVariants(names([
      ["J. van Hecke", ["fuksiarz"]],
      ["Jan Paul van Hecke", ["betcris", "lvbet"]],
      ["Jan-Paul van Hecke", ["betfan", "superbet"]],
      ["Jan Paul van Hecke wyrzucony z boiska", ["fortuna"]],
    ]));
    expect(alias.get("J. van Hecke")).toBe("Jan Paul van Hecke");
  });
  it("keeps folding Fortuna's red-card sentence into the player (guard)", () => {
    const alias = reconcilePlayerNameVariants(names([
      ["Bruno Guimaraes", ["betfan", "superbet"]], ["Bruno Guimaraes wyrzucony z boiska", ["fortuna"]],
    ]));
    expect(alias.get("Bruno Guimaraes wyrzucony z boiska")).toBe("Bruno Guimaraes");
  });
  it("leaves an initial alone when its candidates are different first names (guard)", () => {
    // Tim / Timothy: needs a nickname table, out of scope.
    const alias = reconcilePlayerNameVariants(names([
      ["T. Iroegbunam", ["fuksiarz"]], ["Tim Iroegbunam", ["betfan"]], ["Timothy Iroegbunam", ["betcris", "lvbet"]],
    ]));
    expect(alias.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd "$WT" && npx vitest run src/services/__tests__/player-name-reconcile.test.ts -t "stranded abbreviated rows"`
Expected: 5 FAIL and 3 PASS (the hyphen guard, the Fortuna guard and the Tim/Timothy guard). The messages are identical on the current code and on a Task-1-only scratch copy:
- `expected undefined to be 'Jan Paul van Hecke'` (hyphen/case test and non-clique test)
- `expected undefined to be 'Jens Hjerto-Dahl'`
- `expected undefined to be 'Dominic Calvert-Lewin'`
- `expected true to be false` (Bogle combo)

- [ ] **Step 3: Implement** the three rule changes listed under Interfaces. Keep the chain-collapse loop (`:339-348`) as it is.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd "$WT" && npx vitest run src/services/__tests__/player-name-reconcile.test.ts src/services/__tests__/market-type-grouper-audit-fixes.test.ts src/services/__tests__/market-type-grouper-quarantine.test.ts src/services/__tests__/triple-buttons-fix.test.ts`
Expected: all PASS. On a scratch copy with Tasks 1+2, these four files plus the 14 new Task 1–2 tests gave 62/62.
Offline gate A1 must give exactly: `"params":1291,"withPeers":0,"fuksiarzOnly":60,"stranded":2` (Ars–Hul) and `"params":1343,"withPeers":0,"fuksiarzOnly":73,"stranded":1` (Lee–Tot). Any other `params` value means an unintended fold or split. List the folds and compare them with Observations > "Simulated effect".

- [ ] **Step 5: Full gate and commit**

Run: `cd "$WT" && npx tsc --noEmit && npx vitest run` → exit 0, all green.
```bash
cd "$WT"
git add src/services/market-type-grouper.ts src/services/__tests__/player-name-reconcile.test.ts
git commit -m "grouper: fold stranded abbreviated player rows; never merge combo params into a player"
```

### Task 3 (optional, owner question 1): Spell out abbreviated player names across the whole match

**Files:**
- Modify: `src/services/market-type-grouper.ts`: a new export, plus a pre-pass inside `groupMarketsByTypeWithParameters` (`:696`). The pre-pass goes between the end of the `typeGroups` fill loop (`:963`) and `for (const [marketType, group] of typeGroups.entries())` (`:968`). `buildCategoriesWithMarketTypes` (`:1353`) only calls this function (`:1362`). The other caller, `src/services/audit/scraper-audit-core.ts:572`, groups a single bookmaker. Its roster has no peer full names, so the pass is a no-op there.
- Test: `src/services/__tests__/player-name-reconcile.test.ts`

**Interfaces:**
- Consumes: `isAbbreviatedPlayerName` (Task 1), `isNonPersonParam` and `playerNamesCompatible` (Task 2).
- Produces: `export function expandAbbreviatedPlayerNames(paramsInMatch: Iterable<string>): Map<string, string>`.
  - Input: one entry per (market type, bookmaker) row, so repeats act as weight.
  - Names for which `isNonPersonParam` is true are dropped first.
  - An abbreviated name maps to `candidates.reduce(pick)`. `candidates` are the non-abbreviated roster names compatible with it. The rule applies only when `candidates` is non-empty and pairwise `playerNamesCompatible`, which is the same rule as Task 2's non-clique fallback.
  - `pick` prefers the higher count, then more tokens, then `localeCompare`.

- [ ] **Step 1: Write the failing tests.** Add `expandAbbreviatedPlayerNames` to the import. Task 1 already added `groupMarketsByTypeWithParameters` and `ScrapedMarket`.

```ts
describe("expandAbbreviatedPlayerNames", () => {
  it("expands an initial using a full name seen in another market of the same match", () => {
    const alias = expandAbbreviatedPlayerNames(["H. Morita", "Hidemasa Morita", "Matt Crooks", "M. Crooks"]);
    expect(alias.get("H. Morita")).toBe("Hidemasa Morita");
    expect(alias.get("M. Crooks")).toBe("Matt Crooks");
    expect(alias.has("Hidemasa Morita")).toBe(false);
  });
  it("does not expand an initial with two candidate full names", () => {
    expect(expandAbbreviatedPlayerNames(["J. Silva", "Joao Silva", "Jorge Silva"]).has("J. Silva")).toBe(false);
  });
  it("ignores combo params in the roster", () => {
    const alias = expandAbbreviatedPlayerNames(["D. Calvert-Lewin", "Dominic Calvert-Lewin", "Dominic Solanke or Dominic Calvert-Lewin"]);
    expect(alias.get("D. Calvert-Lewin")).toBe("Dominic Calvert-Lewin");
  });
  it("picks the most frequent of several equivalent spellings", () => {
    const alias = expandAbbreviatedPlayerNames([
      "J. van Hecke", "Jan Paul van Hecke", "Jan-Paul van Hecke", "Jan-Paul van Hecke", "Jan Paul Van Hecke",
    ]);
    expect(alias.get("J. van Hecke")).toBe("Jan-Paul van Hecke");
  });
  it("never rewrites a sentence param (a lowercase 'z' is not an initial)", () => {
    expect(expandAbbreviatedPlayerNames(["Andrew Robertson wyrzucony z boiska", "Andrew Robertson"]).size).toBe(0);
  });
  it("spells out a Fuksiarz-only row from another market's full name (wired into the grouper)", () => {
    const mk = (type: string, paramValue: string, sel: string, odds: number): ScrapedMarket => ({
      name: type, type, normalizedType: type, marketKey: `${type}:${paramValue}`, paramValue,
      selections: [{ name: sel, normalizedName: sel, odds }],
    }) as ScrapedMarket;
    const out = groupMarketsByTypeWithParameters([
      { market: mk("PLAYER_CARDS", "H. Morita", "YES", 4.2), bookmaker: "fuksiarz" },
      { market: mk("PLAYER_SHOTS_ON_TARGET", "Hidemasa Morita", "1+", 2.6), bookmaker: "betfan" },
    ]);
    expect(out.find((m) => m.type === "PLAYER_CARDS")!.parameters.map((p) => p.value)).toEqual(["Hidemasa Morita"]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd "$WT" && npx vitest run src/services/__tests__/player-name-reconcile.test.ts -t expandAbbreviatedPlayerNames`
Expected: 6 FAIL. Five fail with `TypeError: (0 , __vite_ssr_import_1__.expandAbbreviatedPlayerNames) is not a function`, and the wiring test fails with `expected [ 'H. Morita' ] to deeply equal [ 'Hidemasa Morita' ]` (verified on a Tasks 1+2 scratch copy). If the function is exported but not wired, only the last test fails.

- [ ] **Step 3: Implement `expandAbbreviatedPlayerNames` and wire it in.** Inside `groupMarketsByTypeWithParameters`, after `:963`, build the roster from every `param !== "base"` of `typeGroups` entries whose catalog entry has `hasParameter && parameterType === "player"`. Then rewrite those entries' `param` through the alias before the per-type loop (`:968`). The per-market reconcile then sees the already-expanded names. The params are already canonicalized at `:843`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd "$WT" && npx vitest run src/services/__tests__/player-name-reconcile.test.ts src/services/__tests__/market-type-grouper-audit-fixes.test.ts src/services/__tests__/market-type-grouper-quarantine.test.ts src/services/__tests__/triple-buttons-fix.test.ts`
Expected: all PASS.
Offline gate A1 must give exactly `"params":1288,"withPeers":0,"fuksiarzOnly":10,"stranded":2` (Ars–Hul) and `"params":1343,"withPeers":0,"fuksiarzOnly":39,"stranded":1` (Lee–Tot). This re-baselines criterion B6 from a dry run instead of a guess: 89 → 39 is −56 %, 57 → 10 is −82 %. The Lee–Tot residual is mostly players no peer quotes ("S. Moreira de Oliveira" ×11, "C. Olusesi" ×9, "L. Williams-Barnett" ×8) and "J. Bahoya" ×6. For Bahoya, "Jean Bahoya" and "Jean-Matteo Bahoya" are not compatible with each other.

- [ ] **Step 5: Full gate and commit**

Run: `cd "$WT" && npx tsc --noEmit && npx vitest run` → exit 0, all green.
```bash
cd "$WT"
git add src/services/market-type-grouper.ts src/services/__tests__/player-name-reconcile.test.ts
git commit -m "grouper: expand abbreviated player names using the match-wide roster"
```

### Task 4: Map the new Fuksiarz gameTypes -4895/-4896 and -30640

**Files:**
- Create: `src/services/normalization/bookmakers/__tests__/fixtures/fuksiarz-leeds-tottenham-2026-11-06.json`, a verbatim copy of `$PLAN/evidence/fuksiarz/fixture-leeds-tottenham-2026-11-06.trimmed.json`. It is 5.7 KB: `{code, data:{eventId:23464740, eventName:"Leeds - Tottenham", eventStart, eventGames:[7]}}`, trimmed from the 246 KB `event-leeds-tottenham-2026-11-06.json` to gameTypes -4895, -4896, -30640 (4 lines) and -30061. On it, `parseAllMarkets` yields 22 markets (verified).
- Create: `src/services/normalization/bookmakers/__tests__/fuksiarz-2026-11-markets.test.ts`
- Modify: `src/services/normalization/bookmakers/fuksiarz-normalizer.ts`:
  - `FUKSIARZ_MARKET_ID_TO_CODE` (`:27-201`, next to `"-4893"` at `:78`): add `"-4895"` and `"-4896"` → `"PLAYER_HEADER_SHOTS_ON_TARGET"`, and `"-30640"` → `"EACH_TEAM_TOTAL_CORNERS_OVER"`.
  - `PLAYER_LINE_MARKETS` (`:259-265`): add `"PLAYER_HEADER_SHOTS_ON_TARGET"`.
  - The OVER/UNDER case group (`:1353-1396`): add `case "EACH_TEAM_TOTAL_CORNERS_OVER":`, for example next to `case "EACH_TEAM_OFFSIDES":` (`:1391`).
  - No param-extraction change: the generic fallback at `fuksiarz-normalizer.ts:1106` already yields the line (verified). Make only the three edits above.
- Golden: `src/services/normalization/__fixtures__/fuksiarz/premier-league_leeds_united_tottenham_hotspur.{json,expected.json}`. If Step 1 has to use another match, the name follows that match.

**Interfaces:**
- Consumes: `parseAllMarkets(event, teams)` and `parseTeamNames(eventName)` from `src/scrapers/bookmakers/fuksiarz/parser.ts`; `fuksiarzNormalizer.normalizeMarket(raw, ctx)`.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Freeze failing golden entries first (live, before any code change)**

Use Leeds–Tottenham `23464740` while it is open (kick-off 2026-11-07 12:30Z), then Fulham–Newcastle `23465146` (15:00Z), adjusting the `--out` name. Otherwise use the next near-term match whose smoke-test UNMAPPED list contains "Odda co najmniej 1 celny strzał głową". The `--out` basename must follow `<matchIdSafe>__<YYYY-MM-DD>.json`. Otherwise `deriveMatchIdSafe` (`harvest-fixtures.ts:312-317`) falls back to the numeric Fuksiarz event id (the existing fixtures store `matchId: "21211519"`).
```bash
cd "$WT"
mkdir -p /tmp/fuksiarz-harvest
npx tsx scripts/fuksiarz-prep-audit.ts --url "https://fuksiarz.pl/szczegoly/23464740" --league premier-league \
  --out /tmp/fuksiarz-harvest/premier-league_leeds_united_tottenham_hotspur__$(date -u +%F).json
npx tsx scripts/harvest-fixtures.ts --archive /tmp/fuksiarz-harvest/premier-league_leeds_united_tottenham_hotspur__$(date -u +%F).json \
  --bookmaker fuksiarz --out-dir "$WT/src/services/normalization/__fixtures__" \
  --registry /home/skamik/Documents/repositories/personal/aityper/docs/audit-ledger/registry.json \
  --bless "Odda co najmniej 1 celny strzał głową" --bless "Odda co najmniej 2 celne strzały głową" \
  --bless "Każda drużyna powyżej 2.5 rzutu rożnego" --bless "Zakłady specjalne #4.1"
npx vitest run src/services/normalization/__tests__/golden.test.ts -t fuksiarz
```
Expected: PASS, with today's OTHER output frozen and blessed.
- The parser splits `-4895/-4896` into one raw market per player (`parser.ts:387-410`), and `dedupeRawMarkets` keeps them all because their selections differ (`scraper-audit-core.ts:180-190`).
- `--bless` exact-matches every per-player entry (`harvest-fixtures.ts:297-306`), so the blessed set is N1 + N2 + 2 entries. N1 is the number of `-4895` players in the archive (15 today) and N2 the number of `-4896` players (2 today), so expect `blessed=19` in the `[golden] fuksiarz/premier-league_leeds_united_tottenham_hotspur` log line.
- Record N1 and N2.
- If no near-term match offers `-4895` (international break), skip this step and rely on Step 2. Note that in the commit message, and harvest in the 21–23 Nov round.

- [ ] **Step 2: Write the failing unit tests**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseAllMarkets, parseTeamNames } from "../../../../scrapers/bookmakers/fuksiarz/parser.js";
import { fuksiarzNormalizer } from "../fuksiarz-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../../types.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/fuksiarz-leeds-tottenham-2026-11-06.json", import.meta.url), "utf8"),
);
const markets = parseAllMarkets(fixture.data, parseTeamNames(fixture.data.eventName)) as unknown as RawBookmakerMarket[];
const ctx = { homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", league: "premier-league" } as NormalizationContext;

it("parses the trimmed fixture into 22 raw markets", () => {
  expect(markets).toHaveLength(22);
});
it("maps 'Odda co najmniej 1 celny strzał głową' (-4895) to PLAYER_HEADER_SHOTS_ON_TARGET per player", () => {
  const raw = markets.find((m) => m.bookmakerMarketId === "-4895" && m.selections[0].name === "E. Ampadu")!;
  const out = fuksiarzNormalizer.normalizeMarket(raw, ctx)!;
  expect(out.marketCode).toBe("PLAYER_HEADER_SHOTS_ON_TARGET");
  expect(out.paramValue).toBe("E. Ampadu");
  expect(out.marketKey).toBe("PLAYER_HEADER_SHOTS_ON_TARGET:E. Ampadu");
  expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["1+", 11]]);
});
it("maps the 2-shot header line (-4896) to tier 2+", () => {
  const raw = markets.find((m) => m.bookmakerMarketId === "-4896" && m.selections[0].name === "D. Calvert-Lewin")!;
  expect(fuksiarzNormalizer.normalizeMarket(raw, ctx)!.selections.map((s) => [s.code, s.odds])).toEqual([["2+", 7.3]]);
});
it("maps 'Każda drużyna powyżej X rzutu rożnego' (-30640) to EACH_TEAM_TOTAL_CORNERS_OVER:X", () => {
  const outs = markets.filter((m) => m.bookmakerMarketId === "-30640").map((m) => fuksiarzNormalizer.normalizeMarket(m, ctx)!);
  expect(outs.map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])])).toEqual([
    ["EACH_TEAM_TOTAL_CORNERS_OVER:1.5", [["OVER", 1.1]]],
    ["EACH_TEAM_TOTAL_CORNERS_OVER:2.5", [["OVER", 1.4]]],
    ["EACH_TEAM_TOTAL_CORNERS_OVER:3.5", [["OVER", 2]]],
    ["EACH_TEAM_TOTAL_CORNERS_OVER:4.5", [["OVER", 3.1]]],
  ]);
});
it("keeps 'Zakłady specjalne #4.1' (-30061) as OTHER", () => {
  const raw = markets.find((m) => m.bookmakerMarketId === "-30061")!;
  const out = fuksiarzNormalizer.normalizeMarket(raw, ctx);
  expect(out === null || out.marketCode === "OTHER").toBe(true);
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `cd "$WT" && npx vitest run src/services/normalization/bookmakers/__tests__/fuksiarz-2026-11-markets.test.ts`
Expected: 3 FAIL, 2 PASS (the parse-count test and the `#4.1` guard). Messages, verified on the current normalizer with this fixture:
- `-4895`: `AssertionError: expected 'OTHER' to be 'PLAYER_HEADER_SHOTS_ON_TARGET'`
- `-4896`: `AssertionError: expected [ [ 'D. Calvert-Lewin', 7.3 ] ] to deeply equal [ [ '2+', 7.3 ] ]`
- `-30640`: `AssertionError: expected [ [ 'OTHER', …(1) ], …(3) ] to deeply equal [ [ …(2) ], [ …(2) ], [ …(2) ], …(1) ]`. The first element is `["OTHER", [["powyżej 1.5", 1.1]]]`.

- [ ] **Step 4: Implement the mappings** listed under Files.

- [ ] **Step 5: Run the tests, then the golden test, and confirm the expected failure**

Run: `cd "$WT" && npx vitest run src/services/normalization/bookmakers/__tests__/fuksiarz-2026-11-markets.test.ts` → 5 PASS.
Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t fuksiarz`. Expect the premier-league fixture to fail with `N1+N2+1 blessed entries of fuksiarz/premier-league_leeds_united_tottenham_hotspur diverged from expected` (18 with today's offer). These are every `-4895` and `-4896` player plus the 2.5 corners line. The `#4.1` entry and both world-cup fixtures stay green. Skip this check if Step 1 was skipped.

- [ ] **Step 6: Re-bless with an inspected diff**

Run: `cd "$WT" && npx tsx scripts/rebless-golden.ts --bookmaker fuksiarz --fixture premier-league_leeds_united_tottenham_hotspur --dry`
Expected: exactly N1 + N2 + 1 changed entries:
- N1 × `OTHER → PLAYER_HEADER_SHOTS_ON_TARGET:<player>` (`1+`)
- N2 × `OTHER → PLAYER_HEADER_SHOTS_ON_TARGET:<player>` (`2+`)
- 1 × `OTHER → EACH_TEAM_TOTAL_CORNERS_OVER:2.5` (`OVER`)
- `#4.1` unchanged.

Any other changed entry stops the task. Then run it without `--dry`, followed by `npx vitest run src/services/normalization/__tests__/golden.test.ts -t fuksiarz` → PASS.

- [ ] **Step 7: Full gate and commit**

Run: `cd "$WT" && npx tsc --noEmit && npx vitest run` → exit 0, all green. No catalog change, so no sync.
```bash
cd "$WT"
git add src/services/normalization/bookmakers/fuksiarz-normalizer.ts \
  src/services/normalization/bookmakers/__tests__/fuksiarz-2026-11-markets.test.ts \
  src/services/normalization/bookmakers/__tests__/fixtures/fuksiarz-leeds-tottenham-2026-11-06.json \
  src/services/normalization/__fixtures__/fuksiarz/
git commit -m "fuksiarz: map header shots-on-target ladder and each-team corners over"
```

- [ ] **Step 8: Live verification**

Before merging, run the smoke command from Observations once, from `$WT`. It is read-only and uses the patched normalizer on live data. Expected for 23464740: `Mapped: 706 / Unmapped/OTHER: 4`, and the grep prints `0` (current code: 685 / 25 / 21). After the owner merges, the dev server restarts and one scheduled run completes. Then check acceptance criteria B1–B7 against fresh `normalized-markets` JSON for a near-term match offering `-4895`, by 2026-11-08 16:30Z or in the 21–23 Nov round.

---

## Self-review

- **Spec coverage:**
  - Root cause 1 (label tie) → Task 1.
  - Root cause 1b (stranded odds, combo folds) → Task 2.
  - Fuksiarz-only labels → Task 3 (optional).
  - Root cause 2 → Task 4.
  - Out of scope, stated as such: the pre-existing TIME_PERIOD_ASIAN_HANDICAP collision, Fortuna's sentence param (open question 3) and nickname pairs.
  - Acceptance mapping:
    - Offline gate A1 checks Tasks 1–3 with exact numbers, A2 checks Task 4, A3 is the header-shot baseline.
    - Live: B2 → Task 1, B3 → Task 2, B6 → Task 3, B4/B5 → Task 4, B1/B7 → regression sanity.
- **Verification done while planning:**
  - Every Task 1–4 test block was run as written on the current code and on scratch copies with the planned changes. The Step 2/3 failure messages above are copied from those runs.
  - The A1 numbers come from the same copies.
  - The smoke, A1, A3 and B7 command shapes were run on the current code.
- **Step scan:** every code step names the file, the symbol and the pinned values. Live-dependent counts (N1, N2) are recorded in Task 4 Step 1, and every later step refers to them. No step leaves a "TBD".
- **Type consistency:** `abbreviationRank` / `isAbbreviatedPlayerName` (Task 1) are reused by Tasks 2–3. `isNonPersonParam` and `playerNamesCompatible` (Task 2) are reused by Task 3. `expandAbbreviatedPlayerNames` takes `Iterable<string>`, where repeats act as weight.
- **Review Focus:** each item has a test in its owning task. Task 1: items 2, 3, 4. Task 2: items 1, 5, 6, 7. Task 3: item 1. Task 4: item 8.
- **Proportion:** four small tasks. Code blocks are limited to tests and commands. Rules are stated as signature plus test.
