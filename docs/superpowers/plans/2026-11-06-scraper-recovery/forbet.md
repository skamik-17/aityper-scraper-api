# Forbet — health check 2026-11-06 + odds-integrity fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop forbet's "TurboPrzewaga - 2 gole przewagi lub wygrana" product from being published as the `EUROPEAN_HANDICAP:+2` line. Today it shows up there in 20/20 Premier League matches at 1.4–3.2x the peer price, and it displaces forbet's real "Handicap 2:0" row in 19/20.

**Architecture:** This is a normalizer-only fix. The forbet game-type id map sends `-31170` to the 3-way catalog code `MATCH_RESULT_OR_WIN_BY_2`, which already exists in the catalog and in the `market_types` table. As a second guard, `EUROPEAN_HANDICAP` lines may only be derived from an explicit score line (`x:y`) or a signed selection line, never from a stray digit in the market name. An optional Task 2 maps forbet's six "Wydarzy się min. jedno z" alternative bets (ids `-8041..-8046`) to the codes etoto already uses for the same shared-platform ids.

**Tech Stack:** TypeScript (ESM, tsx), Vitest, Playwright (scraper only, untouched).

**Spec:** the Observations section of this file. Evidence: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/forbet/`: trimmed and full raw captures, game list, run-2 log extracts, API sweep, DB select, smoke output, and `acceptance-check.py` with its baseline.

---

## Observations (pre-fix analysis)

### Status today: DEGRADED (odds integrity). No regression in volume or coverage vs August

| Metric | Aug 2026 baseline (Arsenal v Coventry, 2026-08-20) | Today (2026-11-06, run 2 = 16:00Z) |
|---|---|---|
| Fixtures scraped / merged | 1 audited | 20/20 listed, 20/20 merged (same `matchId` as the other 9 bookmakers, 0 orphans, 0 duplicates) |
| Raw markets per match | 413 (1382 selections) | round 11 (6–8 Nov): 419–494; round 12 (21–23 Nov): 148–149. Total 5995 raw, 5869 DB rows saved |
| Normalized codes / entries / selections (API) | 120 / 443 / 1340 | Arsenal v Hull 123 / 477 / 1482; Everton v Coventry 139 / 486 / 1528; Man City v Fulham (round 12) 93 / 137 / 522 |
| UNKNOWN selections | 0 | 0 (both full-offer matches) |
| OTHER bucket (offline parse+normalize of the full captures `evidence/forbet/forbet-event-57945911-arsenal-hull.full.json` / `…-57945881-everton-coventry.full.json`) | n/a (bucket was merged then) | 42/470 (8.9%) Arsenal v Hull = 6 normalizer `OTHER` + 36 `null`; 51/494 (10.3%) Everton v Coventry = 6 + 45. `null` is stored as OTHER (`src/services/normalization/factory.ts:130-131`). The 6 normalizer `OTHER` per match are exactly the 6 alternative bets in Task 2; the rest are intended |
| Raw-name leaks / duplicate codes in a param | 14 (MULTI_RESULT raw labels) / 0 | 0 / 0 |
| 1X2 vs peer median (20 matches × 3) | n/a | max 4.5%, mean 1.4%. No axis swaps |
| O/U 2.5 vs peer median (20 × 2) | n/a | max 2.0%. No axis swaps |
| `EUROPEAN_HANDICAP:+2` integrity | blessed misroute present (see below) | **20/20 matches contaminated** |
| Tests | — | `src/scrapers/bookmakers/forbet` 4/4, `forbet-audit-fixes.test.ts` 48/48, golden `forbet` 486 blessed / 119 unblessed / 0 failures |

Catalog codes covered in August but missing today: 9. Seven of them were removed or merged from the catalog on 2026-08-20 (`DRAW_OR_OVER_2_5` became `RESULT_OR_TOTAL`, the `HALF_TIME_*`/`SECOND_HALF_*_CLEAN_SHEET` codes became `*_TO_SCORE`, `TEAM_HALF_WITH_MORE_GOALS` became `HOME_/AWAY_HALF_WITH_MOST_GOALS`). `OTHER` is hidden from the API now. The remaining two, `CORNERS_HANDICAP` and `HALF_TIME_CORNERS_HANDICAP`, are not offered by forbet for the current matches: neither full capture (471 and 497 games) has a corner-handicap game, see `evidence/forbet/forbet-full-capture-game-list.tsv` (index / gameType / gameName / outcome count for every game; `-31170` is at index 1 in both, `-6048` "Handicap 2:0" first appears at index 37 for Everton v Coventry). So nothing was lost. 28 codes are new compared with August.

Log symptoms in run 2:
- 19× `[FullOfferRepo] marketKey collision with overlapping selection code "AWAY" for forbet EUROPEAN_HANDICAP:+2 (...) — possible misroute, keeping first-seen odds`. This is every match except Arsenal v Hull, where forbet has no Handicap 2:0. Evidence: `evidence/forbet/backend-log-run2-collisions.txt`.
- 73 distinct `[forbet] Unknown market` names from 36 game-type ids (`evidence/forbet/backend-log-run2-unknown-markets.txt`: 74 lines, line 1 is a header; `grep -oE 'gameType: -?[0-9]+' <file> | sort -u | wc -l` = 36). Run 3 (17:00Z) gives the same 73/36. These are new forbet products: bet-builder specials "Zakłady specjalne #N" / "<team> - zakłady specjalne #N.M", branded specials "BetPewniak/BetPołówka/BetWin/BetSzot/BetFaul/BetMix/BetOver", and soccerstats-settled combos ("Każdy min. 1 celny strzał…", "<team> wygra + celne strzały zawodnika"). None of them is a renamed version of a market we used to map, and OTHER is the correct bucket for all of them.

### Root cause (TurboPrzewaga)

`src/services/normalization/bookmakers/forbet-normalizer.ts:48` maps `"-31170": "EUROPEAN_HANDICAP"`. The raw name carries no score line, so `extractParamValue` (forbet-normalizer.ts:1511-1517) finds no `x:y`. The handicap branch (forbet-normalizer.ts:1551-1576) then finds no signed selection line and falls back to `stripped.match(/([+-]?\d+(?:[.,]\d+)?)/)` (forbet-normalizer.ts:1570-1572). That picks up the `2` in "2 gole" and produces `+2`. The real "Handicap 2:0" (`-6048`, forbet-normalizer.ts:59) gets the same key. The raw event lists `-31170` first, and `mergeMarketRecord` (`src/repositories/full-offer-repository.ts:197-247`) keeps the first-seen code, so the real handicap odds are thrown away.

Reproduced on the current code with `scripts/forbet-market-discovery.ts` (`evidence/forbet/smoke-discovery-current-code-2026-11-06.txt`):
```
📦 MARKET: TurboPrzewaga - 2 gole przewagi lub wygrana
✅ NORMALIZED: EUROPEAN_HANDICAP
   Market Key: EUROPEAN_HANDICAP:+2
   Everton 1.63 HOME | remis 3.90 DRAW | Coventry 4.50 AWAY
```
Raw (`evidence/forbet/forbet-event-57945881-everton-coventry.trimmed.json`): `-31170 TurboPrzewaga` Everton 1.63 / remis 3.9 / Coventry 4.5, and `-6048 Handicap 2:0` Everton (2:0) 1.03 / X 11 / Coventry 30.

User impact, from a sweep of the API (`evidence/forbet/api-sweep-european-handicap-plus2.json`). Forbet's HOME price on the "+2" row compared with the peer median:

| Match | forbet HOME on +2 | peer median HOME on +2 |
|---|---|---|
| Everton v Coventry | 1.63 | 1.04 |
| Crystal Palace v Liverpool | 4.70 | 1.545 |
| Hull v Brighton | 5.00 | 1.55 |
| Newcastle v Arsenal | 4.80 | 1.48 |
| Arsenal v Hull | 1.16 | — (no peer quotes +2) |

Because of this, forbet always "wins" best odds on +2. That is the worst class of failure for this product: it creates fake +EV.

This is not new. The golden fixture blesses it: `src/services/normalization/__fixtures__/forbet/world-cup-2026_france_morocco.expected.json` entry #1 (TurboPrzewaga → `EUROPEAN_HANDICAP:+2`, blessed) and entry #39 (`Handicap 2:0` → the same key). The August audit data shows the same row (`aityper/docs/match-audit/.tmp/premier-league_arsenal_coventry_city.json`: forbet EH param 2 = TurboPrzewaga 1.17/7/13). The mapping was introduced in commit `91e8cdb` (2026-06-26).

The proposed target is `MATCH_RESULT_OR_WIN_BY_2` (`src/data/market-catalog.ts:5022-5035`; HOME/DRAW/AWAY, TRIPLE_BUTTONS, templates "{homeTeam} wygrywa lub prowadzi 2 golami"). The `market_types` row exists in the DB, so **no catalog change and no sync are needed**. Evidence: a read-only select returns `{"id":1325,"code":"MATCH_RESULT_OR_WIN_BY_2","name_pl":"Wynik meczu lub 2 gole przewagi","view_type":"TRIPLE_BUTTONS",…}` (`evidence/forbet/db-market-types-MATCH_RESULT_OR_WIN_BY_2.txt`). Note that id 1325 appearing in `/api/odds/market-types` is not proof by itself, because the route falls back to the catalog's own `numericId` when the DB row is missing (`src/routes/odds.ts:311-315`). The route does return `shortLabelPl == namePl` ("Wynik meczu lub 2 gole przewagi") for this code, which only the DB branch (`src/routes/odds.ts:288-296`) can produce, since `SHORT_LABELS` has no entry for it. A betclic cross-check supports the HOME/AWAY legs: betclic's 2-way `WIN_OR_WIN_BY_2` "Przewaga dwoma bramkami lub wygrana w meczu" (catalog: "wins or takes a 2-goal lead at any point", `market-catalog.ts:469`) is Everton 1.60 / Coventry 4.50 against forbet's 1.63 / 4.50. The DRAW leg is **not** verified (see Risks).

### Second finding (optional Task 2): six alternative bets still in OTHER

Ids `-8041/-8042/-8043` ("Wydarzy się min. jedno z: <team>|remis … lub obie drużyny strzelą gola"), `-8044/-8046` ("<team> wygra lub którakolwiek drużyna zachowa czyste konto") and `-8045` ("remis w meczu lub którakolwiek…") all fall to OTHER through `resolveForbetSpecialMarket` (forbet-normalizer.ts:519-521: the id map has no entry). etoto already maps the very same shared-platform ids (`etoto-normalizer.ts:197-217`) to `RESULT_OR_BTTS`, `TEAM_WIN_OR_CLEAN_SHEET` and `DRAW_OR_CLEAN_SHEET`, and folds the side into the selection code (`etoto-normalizer.ts:734-744`). Their peer prices match forbet's: for Everton v Coventry, -8041 is forbet tak 1.13 / nie 4.7, etoto 1.13 / 5.0 and superbet 1.13 / 5.0. These markets were already unclaimed in August (August `rawUnclaimed` for forbet), so this is a coverage-parity gain, not a regression fix. The id map alone is not enough for the clean-sheet pair. `TEAM_WIN_OR_CLEAN_SHEET` takes its HOME/AWAY param from `detectTeamSide`, and that function cuts the raw name at the first colon (`forbet-normalizer.ts:344`), so it never sees the team (details in Task 2 Interfaces). With the prefix strip, a scratch run over both full captures yields `TEAM_WIN_OR_CLEAN_SHEET:HOME`/`:AWAY` for "Arsenal FC"/"Hull City" and "Everton"/"Coventry", with 0 bare-key outputs.

### What still works and must not break
- The `-6048` scoreline handicaps (`+1`, `-1..-4`) and the `-2557/-2558` half handicaps.
- `RESULT_OR_TOTAL` from `-8035..-8040` (forbet-normalizer.ts:96-101). Today 6 raw markets merge into `RESULT_OR_TOTAL:2.5` with distinct codes.
- `PLAYER_GOALS` from `-2417`, where the 1+ tier is deliberately dropped. When only 1+ exists the market becomes OTHER (11–16 per match), and that is intended.
- The forbet 101-sentinel filter in `src/scrapers/bookmakers/forbet/parser.ts`: the event-wide repeat count at `:246-264`, and the filter itself at `:296-299`.

### Risks & unknowns
- Peers for `MATCH_RESULT_OR_WIN_BY_2`: at first forbet will be the only bookmaker on the card. fortuna drops its equivalent "Wynik meczu lub 2 gole przewagi" on purpose (`fortuna-normalizer.ts:1159-1165`), and that decision predates the 3-way code. Routing fortuna's version to the same code is out of scope (fortuna plan).
- The "no digit fallback" guard for `EUROPEAN_HANDICAP` changes no blessed golden entry other than #1 (verified by the expected rebless diff below). If the dry run shows more entries, stop and inspect.
- The DB needs no cleanup. `pruneStaleOddsRows` (full-offer-repository.ts, called after every batch write) drops the old `EUROPEAN_HANDICAP:+2` TurboPrzewaga rows on the next forbet scrape of each match.
- **DRAW-leg settlement of TurboPrzewaga is unverified.** The catalog's DRAW template reads "Remis bez przewagi 2 goli którejś ze stron" (`market-catalog.ts:5033`), which is a specific settlement rule. forbet prices "remis" like the plain 1X2 draw: 3.9 vs 1X2 3.95 for Everton v Coventry, 7.2 vs 7.2 for Arsenal v Hull (`evidence/forbet/forbet-event-*.trimmed.json`, games `1` and `-31170`). A draw that also required "no 2-goal lead at any time" would be priced *above* the plain draw, so the forbet leg is most likely the plain final-result draw and the catalog DRAW label may misdescribe it. No forbet rule page for "TurboPrzewaga" was found (web search 2026-11-06, no hit). `MATCH_RESULT_OR_WIN_BY_2` is also an orphan code: no normalizer emits it today (`grep -rn MATCH_RESULT_OR_WIN_BY_2 src` → only `market-catalog.ts:5024` and `types.ts:758`). See Open question 1.
- **Task 2 inherits a catalog-copy defect on `RESULT_OR_BTTS *_OR_BTTS_NO`.** The raw "nie" leg of "Wydarzy się min. jedno z: Everton wygra lub obie drużyny strzelą gola" means NOT(Everton wins OR BTTS) = neither happens. The catalog template `HOME_OR_BTTS_NO: "{homeTeam} wygrywa lub nie obie drużyny strzelą"` (`market-catalog.ts:8682`) reads as "Everton wins OR not BTTS", a different proposition whose fair odds would be about 1.5, not 4.7. etoto (`etoto-normalizer.ts:739-744`) and superbet already publish under these codes with matching prices (Everton v Coventry `HOME_OR_BTTS_NO`: etoto 5.0–5.2, superbet 5.0–5.15 on 2026-11-06, forbet 4.7), so the codes are right and only the Polish copy is wrong. Task 2 adds a third bookmaker to the mislabelled card. Follow-up, out of scope for forbet: change the three `*_OR_BTTS_NO` templates to e.g. "Ani {homeTeam} nie wygra, ani obie drużyny nie strzelą" / "Ani remisu, ani obu drużyn strzelających". `descriptionTemplates` come from the file even on the DB branch (`src/routes/odds.ts:307`), so that fix needs no DB sync.

### Open questions for the owner
1. Where should TurboPrzewaga go? Both options remove the `EUROPEAN_HANDICAP:+2` contamination, which is the urgent part.
   - (a) **3-way `MATCH_RESULT_OR_WIN_BY_2`** (plan default). It keeps all three forbet legs, but the card is peerless (only forbet), and its DRAW label "Remis bez przewagi 2 goli którejś ze stron" may misdescribe forbet's rule (see Risks).
   - (b) **2-way `WIN_OR_WIN_BY_2`** (catalog `market-catalog.ts:462-479`, HOME/AWAY, DB row id 294). It drops the "remis" leg the same way `RESULT_OR_TOTAL` drops "nie" (`forbet-normalizer.ts:1691-1715`). The card gets a peer comparison with betclic right away (1.60/4.50 vs 1.63/4.50), and the dropped leg is effectively the 1X2 draw that forbet already shows on `MATCH_WINNER`. If chosen: map `-31170` → `WIN_OR_WIN_BY_2`, add a `-31170` branch next to the `RESULT_OR_TOTAL` one that keeps only the two team-named selections, and change the Task 1 tests to `marketKey "WIN_OR_WIN_BY_2"`, selections `[["HOME",1.63],["AWAY",4.5]]` (EC) / `[["HOME",1.16],["AWAY",14]]` (AH); golden #1 then reads `WIN_OR_WIN_BY_2` HOME 1.57 / AWAY 5.4.
   Keep (a) only if the owner accepts a peerless card whose DRAW label may be wrong. Otherwise take (b).
2. Should Task 2 (alternative-bet parity, +6 markets per match) ship with Task 1, or later?

### Acceptance criteria (live, after the next scheduled scrape or a manual one)
Thresholds are relative to **N** = number of matches in `GET /api/odds?league=premier-league` that carry a forbet `MATCH_WINNER` at check time. Today N = 20, but round 11 finishes this weekend (Everton v Coventry kicks off 2026-11-06T20:00Z), so N will be lower by the time the fix runs. Only the **last** premier-league run in the log counts: the log already holds 57 forbet collision lines from runs 1–3.

1. Raw volume: every listed forbet match kicking off within 3 days has ≥ 400 raw markets, and every match further out has ≥ 140. Today round 11 has 419–494 and round 12 has 148–149, and etoto shows the same drop (183–186 for round 12 against 466–508 for round 11), so the lower tier is normal for the platform.
2. Collisions in the last run: `awk '/\[ScraperService\] Starting scrape for premier-league/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' /tmp/backend.clean.log | grep -c 'marketKey collision.*for forbet '` = **0** (any forbet code, not only `EUROPEAN_HANDICAP`). Today it is 19, all on `EUROPEAN_HANDICAP:+2`.
3. `bad_eh2_rows == 0`: no forbet row on `EUROPEAN_HANDICAP` param `2`/`+2` has raw name "TurboPrzewaga…" or a HOME price more than 15% from the peer median.
4. `matches_with_forbet_turbo >= N-1`: TurboPrzewaga is on its new code (`MATCH_RESULT_OR_WIN_BY_2` for option a, `WIN_OR_WIN_BY_2` for option b) in all matches but at most one.
5. `unknown_sel == 0`: no forbet selection with `type == "UNKNOWN"` across all normalized-markets categories.
6. Peer agreement, max relative deviation of forbet from the peer median: 1X2 (`MATCH_WINNER` HOME/DRAW/AWAY) ≤ 10%, and O/U 2.5 (`TOTAL_GOALS` param `2.5`, OVER/UNDER) ≤ 10%. Today: 1X2 max 3.7% (4.5% in run 2, mean 1.4%), O/U 2.5 max 1.9%.

One command checks 1–6. The script is `evidence/forbet/acceptance-check.py`: read-only GETs on `localhost:3001`, it slices the last run itself, prints `PASS`/`FAIL` per criterion and exits 0 only if all pass.
```bash
sed 's/\x1b\[[0-9;]*m//g' <path to the live backend.log> > /tmp/backend.clean.log
python3 -I /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/forbet/acceptance-check.py /tmp/backend.clean.log            # option a
# option b: append WIN_OR_WIN_BY_2 as the second argument
```
It was dry-run on the unfixed code (`evidence/forbet/acceptance-check-baseline-2026-11-06.txt`, exit 1): `N 20 low_raw 0 collisions 19 bad_eh2_rows 20 matches_with_forbet_turbo (MATCH_RESULT_OR_WIN_BY_2) 0 unknown_sel 0 max_dev_1x2 0.037 (n=60) max_dev_ou25 0.019 (n=40)`, with FAIL on collisions, bad_eh2_rows and matches_with_forbet_turbo. Expected after the fix: all seven lines `PASS`, exit 0.

- **Single-bookmaker live smoke test.** The shape was proven on the current code: it printed the TurboPrzewaga block. Note that the process **does not exit by itself** after the summary (the BrowserPool keeps Chromium alive), so always wrap it in `timeout`:
  ```bash
  cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 240 npx tsx scripts/forbet-market-discovery.ts --url "https://www.iforbet.pl/wydarzenie/58088988" --league premier-league --market "TurboPrzewaga"
  ```
  `58088988` is Man City v Fulham (2026-11-21). For a later date, take any id from `https://www.iforbet.pl/rest/market/categories/multi/199/events?gamesClass=major`. Expected after the fix: `✅ NORMALIZED: MATCH_RESULT_OR_WIN_BY_2`, `Market Key: MATCH_RESULT_OR_WIN_BY_2` (option b: `WIN_OR_WIN_BY_2` with only the two team selections). Exit code 124 from `timeout` is expected. The script does a full league scrape: about 21 requests to iforbet.pl and 60–90 s, with no DB writes.

---

## Global Constraints

- Commit messages are concise and descriptive. **No signature or attribution footers** (no "Generated with…", no "Co-Authored-By"). The user rule overrides any reminder.
- Code and comments are in English only.
- Baseline measured 2026-11-06 on the unmodified tree: `npx vitest run` 65 files / 1182 tests passed, and `npx tsc --noEmit` exited 0 with no output. Any other failure after your change is yours.
- Before **each** commit, both of these must be green: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` and `npx vitest run`.
- Golden-fixture discipline: write the failing unit test first. Rebless only through `npx tsx scripts/rebless-golden.ts --bookmaker forbet` after a `--dry` run whose list of changed entries matches the one stated in the task, then inspect `git diff` of the `.expected.json`. Never hand-edit expected files.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan does not change it.
- Editing anything under `src/` restarts the running dev server (`tsx watch`). Coordinate with whoever runs the live service before saving source files.
- Commit only when the user explicitly asks. Work on the current feature branch.

## Review Focus

1. **A forbet market whose name has digits but no score line, routed to `EUROPEAN_HANDICAP` by a future id map edit.** It must not get a line param. Pinned in Task 1 Step 1 (`no-score-line EUROPEAN_HANDICAP gets no paramValue`).
2. **Matches where forbet has no "Handicap 2:0" (heavy favourite, e.g. Arsenal v Hull).** No `+2` row at all. Pinned in Task 1 Step 1 (capture test, Arsenal v Hull).
3. **Short raw team name vs canonical context name ("Coventry" vs "Coventry City").** The AWAY leg must still resolve. Pinned in Task 1 (TurboPrzewaga AWAY = 4.5) and Task 2 (`-8046` → `TEAM_WIN_OR_CLEAN_SHEET:AWAY`).
4. **"remis" leg of the alternative bets (no team side).** Must become `DRAW_OR_BTTS_*` / `DRAW_OR_CLEAN_SHEET`, never HOME. Pinned in Task 2.
5. **Merge of the three RESULT_OR_BTTS raw markets into one DB row.** Codes must be disjoint, so `mergeMarketRecord` logs no collision. Pinned in Task 2 (capture test asserts 6 distinct codes on `RESULT_OR_BTTS`).
6. **`detectTeamSide` on "Wydarzy się min. jedno z: <team> …" names.** The cut at the first colon (`forbet-normalizer.ts:344`) used to swallow the team. The new prefix strip must resolve HOME and AWAY without changing any other caller's blessed output. Pinned in Task 2 (bare `TEAM_WIN_OR_CLEAN_SHEET` count = 0; golden dry run lists only #117/#121/#125).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/services/normalization/bookmakers/forbet-normalizer.ts` | forbet raw → catalog | id map (`:48`, plus `-8041..-8046` for Task 2), EH param guard (`:1551-1576`); Task 2: RESULT_OR_BTTS selection resolver next to `resolveResultOrTotalCombo` (`:469`), alternative-bet prefix strip in `detectTeamSide` (`:339`), comment at `:367-371` |
| `src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts` | new regression tests on real 2026-11-06 values | create |
| `src/services/normalization/bookmakers/__tests__/fixtures/forbet-event-57945881-everton-coventry.trimmed.json` | captured raw event (copy of evidence) | create |
| `src/services/normalization/bookmakers/__tests__/fixtures/forbet-event-57945911-arsenal-hull.trimmed.json` | captured raw event (copy of evidence) | create |
| `src/services/normalization/__fixtures__/forbet/world-cup-2026_france_morocco.expected.json` | golden | rebless only |

---

### Task 1: Route TurboPrzewaga to MATCH_RESULT_OR_WIN_BY_2 and harden the EUROPEAN_HANDICAP line

**Files:**
- Modify: `src/services/normalization/bookmakers/forbet-normalizer.ts:48` and `:1551-1576` only. The selection switch needs no change: its `default` (`:1368-1369`) already calls `normalize1x2Selection`, which yields HOME/DRAW/AWAY for "Everton"/"remis"/"Coventry" and "Arsenal FC"/"remis"/"Hull City" (verified: all five tests below pass in a scratch copy with only these two edits).
- Create: `src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts`
- Create: `src/services/normalization/bookmakers/__tests__/fixtures/forbet-event-57945881-everton-coventry.trimmed.json` and `…/forbet-event-57945911-arsenal-hull.trimmed.json`, copied byte-for-byte from `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/forbet/`
- Rebless: `src/services/normalization/__fixtures__/forbet/world-cup-2026_france_morocco.expected.json`

**Interfaces:**
- Consumes: `parseAllMarkets(event: ForbetEvent, teams?: ParsedTeams): ScrapedMarket[]` (`src/scrapers/bookmakers/forbet/parser.ts:232`); `forbetNormalizer.normalizeMarket(raw: RawBookmakerMarket, ctx: NormalizationContext): NormalizedMarketOutput | null`.
- Produces: the test helper `normalizeCapture(file: string, ctx: NormalizationContext): NormalizedMarketOutput[]` in the new test file. It parses the fixture with `parseAllMarkets`, maps each `ScrapedMarket` to `{ bookmakerMarketId, name, groupName, paramValue, selections: {name, odds}[] }`, normalizes it, and drops nulls. Task 2 reuses it.

- [ ] **Step 1: Copy the fixtures and write the failing tests**

```bash
mkdir -p src/services/normalization/bookmakers/__tests__/fixtures
cp docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/forbet/forbet-event-*.trimmed.json src/services/normalization/bookmakers/__tests__/fixtures/
```

Contexts are `ctxEC = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" }` and `ctxAH = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" }`. Wrap everything in `describe("forbet recovery 2026-11", …)`.

```ts
it("forbet TurboPrzewaga (-31170) maps to MATCH_RESULT_OR_WIN_BY_2, not EUROPEAN_HANDICAP", () => {
  const out = forbetNormalizer.normalizeMarket({
    bookmakerMarketId: "-31170",
    name: "TurboPrzewaga - 2 gole przewagi lub wygrana",
    selections: [{ name: "Everton", odds: 1.63 }, { name: "remis", odds: 3.9 }, { name: "Coventry", odds: 4.5 }],
  }, ctxEC)!;
  expect(out.marketCode).toBe("MATCH_RESULT_OR_WIN_BY_2");
  expect(out.marketKey).toBe("MATCH_RESULT_OR_WIN_BY_2");
  expect(out.paramValue).toBeUndefined();
  expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 1.63], ["DRAW", 3.9], ["AWAY", 4.5]]);
});

it("forbet Handicap 2:0 (-6048) stays on EUROPEAN_HANDICAP:+2", () => {
  const out = forbetNormalizer.normalizeMarket({
    bookmakerMarketId: "-6048", name: "Handicap 2:0",
    selections: [{ name: "Everton (2:0)", odds: 1.03 }, { name: "X (2:0)", odds: 11 }, { name: "Coventry (2:0)", odds: 30 }],
  }, ctxEC)!;
  expect(out.marketKey).toBe("EUROPEAN_HANDICAP:+2");
  expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 1.03], ["DRAW", 11], ["AWAY", 30]]);
});

it("forbet no-score-line EUROPEAN_HANDICAP gets no paramValue", () => {
  const out = forbetNormalizer.normalizeMarket({
    bookmakerMarketId: "-6048", name: "Handicap specjalny 2 gole",
    selections: [{ name: "Everton", odds: 1.63 }, { name: "remis", odds: 3.9 }, { name: "Coventry", odds: 4.5 }],
  }, ctxEC)!;
  expect(out.marketCode).toBe("EUROPEAN_HANDICAP");
  expect(out.paramValue).toBeUndefined();
  expect(out.marketKey).toBe("EUROPEAN_HANDICAP");
});

it("forbet Everton v Coventry capture: exactly one EUROPEAN_HANDICAP:+2, priced from Handicap 2:0", () => {
  const outs = normalizeCapture("forbet-event-57945881-everton-coventry.trimmed.json", ctxEC);
  const plus2 = outs.filter((o) => o.marketKey === "EUROPEAN_HANDICAP:+2");
  expect(plus2).toHaveLength(1);
  expect(plus2[0].selections.find((s) => s.code === "HOME")?.odds).toBe(1.03);
  expect(outs.filter((o) => o.marketCode === "MATCH_RESULT_OR_WIN_BY_2")).toHaveLength(1);
});

it("forbet Arsenal v Hull capture: no EUROPEAN_HANDICAP:+2, TurboPrzewaga 1.16/7.2/14 on MATCH_RESULT_OR_WIN_BY_2", () => {
  const outs = normalizeCapture("forbet-event-57945911-arsenal-hull.trimmed.json", ctxAH);
  expect(outs.filter((o) => o.marketKey === "EUROPEAN_HANDICAP:+2")).toHaveLength(0);
  const mr = outs.find((o) => o.marketCode === "MATCH_RESULT_OR_WIN_BY_2")!;
  expect(mr.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 1.16], ["DRAW", 7.2], ["AWAY", 14]]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts`
Expected: FAIL. In tests 1, 4 and 5 the `marketCode` is still `"EUROPEAN_HANDICAP"` and two outputs share `EUROPEAN_HANDICAP:+2`. Test 3 fails with `paramValue` = `"+2"`. Test 2 passes.

- [ ] **Step 3: Implement**

Set `"-31170": "MATCH_RESULT_OR_WIN_BY_2"` at forbet-normalizer.ts:48, with a one-line comment: it is a 2-goal-lead early-payout 3-way product, not a handicap. In the handicap-line branch (`:1551-1576`), skip the raw-name digit fallback (`:1570-1572`) when `marketCode === "EUROPEAN_HANDICAP"`. The score-line branch at `:1511-1517` stays the only name-based source for that code, and the selection-line loops above it remain in place.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts src/services/normalization/bookmakers/__tests__/forbet-audit-fixes.test.ts src/scrapers/bookmakers/forbet`
Expected: PASS (5 + 48 + 4).

- [ ] **Step 5: Golden. Confirm the diff, then rebless**

Run: `npx vitest run src/services/normalization/__tests__/golden.test.ts -t forbet`
Expected: FAIL with exactly `1 blessed entry of forbet/world-cup-2026_france_morocco diverged` → `#1 "TurboPrzewaga - 2 gole przewagi lub wygrana": $.marketCode: actual="MATCH_RESULT_OR_WIN_BY_2" expected="EUROPEAN_HANDICAP"`.
Run: `npx tsx scripts/rebless-golden.ts --bookmaker forbet --dry`
Expected: `[rebless] forbet/world-cup-2026_france_morocco: 1 entry updated`, `- TurboPrzewaga - 2 gole przewagi lub wygrana`, `{"changedTotal":1,"dry":true}`. If more entries are listed, the EH guard changed another line. Stop and inspect.
Run: `npx tsx scripts/rebless-golden.ts --bookmaker forbet && git diff --stat src/services/normalization/__fixtures__/forbet/`
Expected: one file changed. The diff of entry #1 is `marketCode`/`marketKey` → `MATCH_RESULT_OR_WIN_BY_2` and `paramValue` → `null`, with selections unchanged (HOME 1.57 / DRAW 3.9 / AWAY 5.4).

- [ ] **Step 6: Full verification**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no tsc output, and all test files pass.

- [ ] **Step 7: Commit (only if the user has authorized commits for this execution; otherwise stage and stop)**

```bash
git add src/services/normalization/bookmakers/forbet-normalizer.ts src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts src/services/normalization/bookmakers/__tests__/fixtures/forbet-event-57945881-everton-coventry.trimmed.json src/services/normalization/bookmakers/__tests__/fixtures/forbet-event-57945911-arsenal-hull.trimmed.json src/services/normalization/__fixtures__/forbet/world-cup-2026_france_morocco.expected.json
git commit -m "fix(forbet): route TurboPrzewaga to MATCH_RESULT_OR_WIN_BY_2, stop it hijacking EUROPEAN_HANDICAP:+2"
```

---

### Task 2 (optional, coverage parity): map the six "Wydarzy się min. jedno z" alternative bets like etoto

**Files:**
- Modify: `src/services/normalization/bookmakers/forbet-normalizer.ts`. Add id map entries next to `:96-101`: `-8041`, `-8042`, `-8043` → `RESULT_OR_BTTS`; `-8044`, `-8046` → `TEAM_WIN_OR_CLEAN_SHEET`; `-8045` → `DRAW_OR_CLEAN_SHEET`. Add a selection resolver next to `resolveResultOrTotalCombo` (`:469`). Strip the alternative-bet prefix in the first line of `detectTeamSide` (`:339`). Update the comment at `:367-371`.
- Test: `src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts`
- Rebless: forbet golden (entries #117, #121, #125)

**Interfaces:**
- Consumes: `normalizeCapture` (Task 1).
- Produces: `resolveResultOrBttsSide(rawName: string, ctx: NormalizationContext): "HOME" | "AWAY" | "DRAW" | null` (module-private). It strips the `wydarzy sie min. jedno z:` prefix as `resolveResultOrTotalCombo` does, then matches `^(.+?) wygra lub obie` → `resolveTeamSide`, or `^remis w meczu lub obie` → `"DRAW"`. The selection code is `` `${side}_OR_BTTS_${YES|NO}` ``, the same vocabulary as etoto (`etoto-normalizer.ts:739-744`).
- Changes: `detectTeamSide(rawName, ctx)` (`:335`), signature unchanged. `TEAM_WIN_OR_CLEAN_SHEET` is in `FORBET_TEAM_PARAM_MARKETS` (`:365-372`), so `extractParamValue` sends it to `detectTeamSide` (`:1532-1533`). Today that **cannot** resolve the side, because `detectTeamSide` cuts the name at the first colon (`:344`, `.replace(/\s*:\s*.*$/, "")`). "Wydarzy się min. jedno z: Everton wygra lub którakolwiek…" becomes "wydarzy sie min. jedno z", `paramValue` is `undefined`, and `-8044` and `-8046` both land on the bare key `TEAM_WIN_OR_CLEAN_SHEET`, where `mergeMarketRecord` would log a collision and drop the away side. Fix: the first body line becomes `let name = normalizeForbetName(rawName).replace(/^wydarzy sie min\.?\s*jedno z:\s*/, "");`, the same regex `resolveResultOrTotalCombo` uses at `:482-485`. Verified in a scratch copy: without this line the Step 1 test fails (`expected { …(2) } to deeply equal { …(3) }`, both sides on bare `TEAM_WIN_OR_CLEAN_SHEET`). With it, all 6 plan tests pass and the blessed golden diff is still exactly #1, #117, #121, #125.

- [ ] **Step 1: Write the failing tests**

```ts
it("forbet Everton v Coventry alternative bets map like etoto (RESULT_OR_BTTS / TEAM_WIN_OR_CLEAN_SHEET / DRAW_OR_CLEAN_SHEET)", () => {
  const outs = normalizeCapture("forbet-event-57945881-everton-coventry.trimmed.json", ctxEC);
  const rob = outs.filter((o) => o.marketKey === "RESULT_OR_BTTS").flatMap((o) => o.selections.map((s) => [s.code, s.odds]));
  expect(rob).toEqual([["HOME_OR_BTTS_YES", 1.13], ["HOME_OR_BTTS_NO", 4.7], ["AWAY_OR_BTTS_YES", 1.5], ["AWAY_OR_BTTS_NO", 2.31], ["DRAW_OR_BTTS_YES", 1.57], ["DRAW_OR_BTTS_NO", 2.16]]);
  const cs = Object.fromEntries(outs.filter((o) => /CLEAN_SHEET/.test(o.marketCode)).map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));
  expect(cs).toEqual({
    "TEAM_WIN_OR_CLEAN_SHEET:HOME": [["YES", 1.28], ["NO", 3.15]],
    "TEAM_WIN_OR_CLEAN_SHEET:AWAY": [["YES", 1.62], ["NO", 2.08]],
    "DRAW_OR_CLEAN_SHEET": [["YES", 1.44], ["NO", 2.47]],
  });
  // Unresolved side: both teams would collapse onto the bare key
  expect(outs.filter((o) => o.marketKey === "TEAM_WIN_OR_CLEAN_SHEET")).toHaveLength(0);
  expect(outs.filter((o) => o.marketCode === "OTHER" && /^Wydarzy się/.test(o.debug?.rawName ?? ""))).toHaveLength(0);
});
```
(The capture order is -8041, -8044, -8043, -8046, -8042, -8045, so the RESULT_OR_BTTS flat order is HOME, AWAY, DRAW. `debug.rawName` is always set on the output, `forbet-normalizer.ts:1710` and `:1767`.)

- [ ] **Step 2: Run and confirm it fails**
Run: `npx vitest run src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts -t "alternative bets"`
Expected: FAIL. `rob` is `[]` because all six are still `OTHER`.

- [ ] **Step 3: Implement** these four items:
  1. The id map entries.
  2. `resolveResultOrBttsSide`, plus the `RESULT_OR_BTTS` case in `normalizeSelectionForMarket` (`:848`; it already receives `rawMarketName`). `RESULT_OR_BTTS` must also be added to `OVERRIDE_EXEMPT_MARKETS` (`:284`). Otherwise the global `"tak"→"YES"`/`"nie"→"NO"` override (`:267-269`, applied at `:894`) short-circuits before the switch and the codes come out as bare `YES`/`NO`. Return `"UNKNOWN"` when the side does not resolve, so that a bad side shows up in tests instead of silently becoming HOME.
  3. **The `detectTeamSide` prefix strip** (see Interfaces). Without it the clean-sheet pair collides on the bare key.
  4. The comment at `:367-371`: the alternative bets are no longer kept as OTHER.
  The clean-sheet *selections* need no change, because the global override already yields `YES`/`NO`.

- [ ] **Step 4: Run and confirm it passes**
Run: `npx vitest run src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts src/services/normalization/bookmakers/__tests__/forbet-audit-fixes.test.ts`
Expected: PASS.

- [ ] **Step 5: Golden**
Run: `npx tsx scripts/rebless-golden.ts --bookmaker forbet --dry`
Expected: `3 entries updated`: `Wydarzy się min. jedno z: Francja wygra lub obie drużyny strzelą gola`, `… Maroko wygra lub obie…`, `… remis w meczu lub obie…`, then `{"changedTotal":3,"dry":true}`. The clean-sheet entries #118/#122/#126 are unblessed and stay untouched (with the prefix strip they compute `TEAM_WIN_OR_CLEAN_SHEET:HOME` 1.22/3.55, `:AWAY` 1.52/2.27 and `DRAW_OR_CLEAN_SHEET` 1.34/2.85. That is for information only: `rebless-golden.ts` writes blessed entries only unless `--include-unblessed` is passed). If the dry run lists any other entry, the `detectTeamSide` change leaked into another caller (`:577`, `:1038`, `:1585`, `:1660`, and `extractParamValue` at `:1533`): stop and inspect. Then rebless without `--dry` and inspect `git diff`. Each of the 3 entries must read `RESULT_OR_BTTS` with `HOME_/AWAY_/DRAW_OR_BTTS_YES|NO`.

- [ ] **Step 6: Full verification**: `npx tsc --noEmit && npx vitest run`. Expected: green.

- [ ] **Step 7: Commit (only if the user has authorized commits for this execution; otherwise stage and stop)**
```bash
git add src/services/normalization/bookmakers/forbet-normalizer.ts src/services/normalization/bookmakers/__tests__/forbet-recovery-2026-11.test.ts src/services/normalization/__fixtures__/forbet/world-cup-2026_france_morocco.expected.json
git commit -m "feat(forbet): map win/draw-or-BTTS and clean-sheet alternative bets (parity with etoto ids -8041..-8046)"
```

---

## After both tasks: live verification (no code)
1. Wait for the next scheduled scrape (or let the operator trigger one). Then run `evidence/forbet/acceptance-check.py` on a fresh clean copy of the log (see Acceptance criteria) and expect all seven `PASS` lines with exit 0. Compare the output line with `evidence/forbet/acceptance-check-baseline-2026-11-06.txt`.
2. Run the smoke command from Acceptance criteria and confirm `MATCH_RESULT_OR_WIN_BY_2` (or `WIN_OR_WIN_BY_2` for option b).

## What to monitor
- Collision warnings for forbet in the last run (the `awk … | grep -c 'marketKey collision.*for forbet '` command from Acceptance criteria 2). The target is 0 per run; the baseline is 19 per run, all on `EUROPEAN_HANDICAP:+2`.
- New `[forbet] Unknown market` ids outside the special/branded families above. The baseline is 36 ids and 73 names on 2026-11-06 (runs 2 and 3).
- forbet's share of OTHER > 12% of raw markets on a full-offer match. Today it is 8.9–10.3%.

## Self-review
- Spec coverage: the integrity bug → Task 1. The parity gap → Task 2. Measurements and acceptance → Observations. The "no code change" items (corner handicap absent, unknown specials) are documented as not-a-bug.
- Types: `normalizeCapture` is defined in Task 1 and reused in Task 2. `resolveResultOrBttsSide` is only used in Task 2.
- Review Focus items 1–6 are each pinned by a test in Task 1 or Task 2. Item 3 for the clean-sheet pair depends on the `detectTeamSide` prefix strip, which the explicit bare-key assertion in the Task 2 test pins.
- Acceptance is relative to N (matches listed at check time), not a hard-coded 20, and is evaluated on the last run only. Each criterion has a command, dry-run on today's data.
