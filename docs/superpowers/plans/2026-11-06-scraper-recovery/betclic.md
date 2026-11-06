# Betclic Scraper Health Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Betclic's per-match offer complete and stable under scheduled load (no truncated gRPC responses) and close the normalizer gaps found on 2026-11-06: penalty "any team" label leak, OPTA offsides/fouls routed to OTHER, and team tackles lines without a team side.

**Architecture:** The gRPC-web reader in `betclic/navigation.ts` stops resolving on a 1000 ms read cutoff. A new stream-level `readGrpcWebTextStream` resolves on the first *complete* frame (decided by a pure, tested `decodeGrpcWebTextFrame`) and rejects on stream end, on a trailer frame, or on an absolute per-attempt deadline, so `fetchGrpcStream`'s existing retry loop takes over. The normalizer changes are table/regex/switch additions inside `betclic-normalizer.ts`, split into Task 2 (penalty ANY + OPTA offsides/fouls) and Task 3 (side-scoped `TEAM_TOTAL_TACKLES` keys). Each task reblesses its own WC golden entries after an inspected diff.

**Tech Stack:** TypeScript (ESM, Node 20), Node `https` + `stream`, Vitest, tsx, python3 (evidence checkers).

**Spec:** the Observations section of this file. Evidence: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/`: captured gRPC-web payloads (`arsenal-hull_*.grpc-web-text.b64`), raw-market excerpt, group sizes (`group-sizes-run1-run2.txt`, `group-sizes-run3.txt`), log excerpt, API measurements, stream timing (`stream-probe.mts` + `stream-probe-output.txt`), offline truncation reproduction (`truncation-repro.mts` + `truncation-repro-output.txt`), odds deviation (`odds-deviation.py`, `nm-deviation.py` + `odds-deviation-current.txt`), smoke (`smoke-full-offer.mts` + `smoke-current-betclic.txt`, `smoke-current-betclic-v2.txt`), log-vs-smoke checker (`check-log-vs-smoke.py` + `log-vs-smoke-current.txt`), API checker (`api-check.py` + `api-check-current.txt`).

## Observations (pre-fix analysis)

### Status today: FLAKY (coverage stable vs August, but per-run losses under load)

| Metric | Aug 20 baseline (Arsenal vs Coventry City) | Nov 6 Arsenal vs Hull City | Nov 6 Everton vs Coventry City | Nov 6 Leeds vs Tottenham |
|---|---|---|---|---|
| Catalog codes served by API | 141 | 147 | 152 | 134 |
| (market, param) entries | 238 | 247 | 255 | 235 |
| Selections | 3553 | 3236 | 2787 | 1466 |
| Raw-name selection leaks (PENALTY_GOAL family) | 0 | 3 | 3 | 3 |

- Catalog codes in August but not now: `CARDS_POINTS_OVER_UNDER`, `HALF_TIME_CARDS_POINTS_OVER_UNDER`, the four half-scoped `*_CLEAN_SHEET`, `TEAM_HALF_WITH_MORE_GOALS`, `FIRST_HALF_CARDS_1X2` - all retired/renamed by design in the Aug 20 audit-display commits (now `CARDS_TOTAL`, `HOME/AWAY_HALF_WITH_MOST_GOALS`, `HALF_TIME_CARDS_RACE`, ...). New since August: 14 codes incl. `TACKLES_TOTAL`, `TEAM_TOTAL_TACKLES`, `FOUL_RACE`, `CARDS_TEAM`. No real coverage loss (`evidence/betclic/api-measurements-vs-august.txt`).
- Per-match market counts lose markets in every run, measured against an unloaded smoke (`evidence/betclic/log-vs-smoke-current.txt`, produced by `evidence/betclic/check-log-vs-smoke.py`). Runs are run 1 (15:45Z, startup), run 2 (16:00Z) and run 3 (17:00Z); the smoke ran at 17:29Z. Matches outside ±2%: **2 / 8 / 4**. Examples (run 1 / run 2 / run 3 vs smoke):
  - Tottenham vs Ipswich: 110 / **31** / 110 vs 110.
  - Fulham vs Newcastle: **131** / **254** / **254** vs 277. 254 is truncated too: STRZELCY was 470,841 B in run 3, while the other OPTA matches got ~1.07-1.30 MB.
  - Brighton vs Brentford and Man Utd vs Aston Villa: 219 / **196** / **196** vs 219. In run 3, STRZELCY was 458,148 B and 149,811 B.
  - Bournemouth vs Nottingham Forest: 109 / 109 / **80** vs 109. In run 3, WYNIK was 24,250 B (`evidence/betclic/group-sizes-run3.txt`).
  - **Equal counts in consecutive runs do not prove completeness.**
- Unloaded smokes: 16:45Z (`evidence/betclic/smoke-current-betclic.txt`) and 17:29Z (`evidence/betclic/smoke-current-betclic-v2.txt`, extended script). Both gave 276 / 279 / 277 / 265 raw markets for the four OPTA matches, 108-266 normalized per match, and an OTHER share of 0.0182 (64 of 3518 normalized markets).
- 1X2 against the peer median, 20 matches: mean deviation 2.1%, max 6.2%. O/U 2.5 (n=10) is within 3.8% and BTTS (n=10) within 4.5%, measured on the 5 saved normalized-markets payloads. No axis swaps (`evidence/betclic/odds-deviation-current.txt`). Team names: 20/20 matches merged with the other bookmakers.
- `marketKey collision` warnings in run 2: 80 on `CARDS_TOTAL:*` / `HALF_TIME_CARDS_TOTAL:*` (by design, see below) and 1 on `TEAM_TOTAL_TACKLES:16.5` (Fulham vs Newcastle, a real bug).

### Root causes

**RC1 - truncated gRPC-web responses under load.** `src/scrapers/bookmakers/betclic/navigation.ts:111-117` resolves with whatever text arrived `GRPC_READ_TIMEOUT` (`constants.ts:172`, 1000 ms) after the response headers, and `processResponse` (`navigation.ts:154-178`, line 171 `resolve(decoded.slice(5, 5 + msgLen))`) never checks that the frame is complete. The 7 group requests per match run in parallel with 13 other scrapers. Evidence:
- `evidence/betclic/group-sizes-run1-run2.txt` shows 3 truncated group responses (2 matches) in run 1 and 12 (8 matches) in run 2. Examples: Leeds vs Tottenham STRZELCY 77,854 B vs 1,275,475 B; Tottenham vs Ipswich GOLE 6,417 B vs 48,436 B. The file's "<90% of max across runs" rule undercounts, because a group truncated in every run has a truncated max (see Fulham above). Run 3 adds 4 more truncated matches (`group-sizes-run3.txt`).
- Unloaded, all 7 groups of Arsenal vs Hull were fetched in parallel. Every first frame completed 190-923 ms after the request: HANDICAP 11,926 B at 190 ms, TOP 197,816 B at 387 ms, STRZELCY 1,295,527 B at 608 ms, STATYSTYKI 505,565 B at 923 ms (headers only arrived at 777 ms). **No stream was ended by the server** within 5 s, and an independent probe saw none end within 8 s (`evidence/betclic/stream-probe.mts`, `stream-probe-output.txt`). The reader therefore cannot wait for `end`; it must detect the complete frame itself.
- Offline reproduction with the real parser (`evidence/betclic/truncation-repro.mts`, output in `truncation-repro-output.txt`; the 7 full captures are not kept because STRZELCY alone is 1.7 MB):
  - Full offer: 265 markets.
  - STRZELCY truncated anywhere from 103,808 chars to 90% of its length: 242 markets, exactly run 1's Arsenal vs Hull count.
  - STATYSTYKI cut in half: 152 markets.
  - `arsenal-hull_HANDICAP.grpc-web-text.b64` cut at 8000 chars decodes 5,995 of 11,926 message bytes, and `parseAllMarketsFromProto` returns 0 markets instead of 4. TOP gives 0 instead of 29.

**RC2 - PENALTY_GOAL "any team" leg renamed.** August: `Którykolwiek zawodnik strzeli rzut karny` -> `ANY`. Now: `Którakolwiek drużyna strzeli gola z rzutu karnego` -> raw label leaks as the selection code in `PENALTY_GOAL`, `HALF_TIME_PENALTY_GOAL`, `SECOND_HALF_PENALTY_GOAL` on every full-offer match. Cause: `normalizePenaltyGoalSelection` (`src/services/normalization/bookmakers/betclic-normalizer.ts:1593`, check at line 1599) only tests `ktorykolwiek` / `zawodnik` / `any`.

**RC3 - OPTA offsides/fouls names not in the name table (pre-existing).** `BETCLIC_MARKET_NAME_TO_CODE` (`betclic-normalizer.ts:35`, exact lookup at 814) knows `spalone 1x2 (opta)` (135), `suma spalonych w meczu (opta)` (144) and `resolveTeamOffsidesMarket` (line 712) only `suma spalonych w meczu - <team> (opta)`. Betclic sends `Spalone 1X2 (OPTA) (z dogrywką)`, `Liczba spalonych w meczu (OPTA)`, `Liczba spalonych w meczu -\u00a0<team> (OPTA)`, `Liczba fauli w meczu (OPTA) (z dogrywką)`, `Liczba fauli (OPTA) - <team> (z dogrywką)`, `Pierwsza drużyna, która zostanie złapana na pozycji spalonej w meczu`, `Pierwsza drużyna, która popełni faul`. All of them become OTHER, which the API hides (`src/services/market-type-grouper.ts:1380`). That is 9 OPTA-family raw markets on each of Arsenal, Leeds and Fulham, and 8 on Everton vs Coventry, which offers only the Coventry fouls line (`perMatch[].otherNames` in `smoke-current-betclic-v2.txt`). Not a regression: the July WC golden fixture already blesses them as OTHER (`__fixtures__/betclic/world-cup-2026_france_morocco` entries 260-268). Peers (fortuna, superbet) already fill `OFFSIDES_TOTAL`, `OFFSIDES_1X2`, `HOME_TEAM_TOTAL_OFFSIDES`, `FOULS_TOTAL`, `HOME_TEAM_TOTAL_FOULS`, `FIRST_OFFSIDE`.

**RC4 - TEAM_TOTAL_TACKLES has no team side in its key.** `TEAM_SUFFIX_MARKETS_WITH_LINE` (`betclic-normalizer.ts:2501-2505`) side-scopes `CORNERS_TEAM`, `TEAM_TOTAL_SHOTS`, `TEAM_TOTAL_SHOTS_ON_TARGET` but not `TEAM_TOTAL_TACKLES` (resolved with a side at line 881). Keys are `TEAM_TOTAL_TACKLES:10.5` (Arsenal) and `:15.5` (Hull). The UI cannot tell the teams apart, and equal lines collide: `marketKey collision ... TEAM_TOTAL_TACKLES:16.5 (premier-league:fulham:newcastle united)` dropped one team's line. The smoke counts 24 side-less tackle keys today (`sidelessTeamTackleKeys` in `smoke-current-betclic-v2.txt`). Superbet already keys these as `HOME:x` / `AWAY:x` (`superbet-normalizer.ts:503-518`, `SIDED_PARAM_MARKETS`), so Betclic is also split from its only peer.

**Mostly by design: the points-to-count merge.** `Punkty za kartki Powyżej/Poniżej` is Betclic's card-count market on a x10 scale. `betclic-normalizer.ts:2463-2484` converts it to the card line and merges it into `CARDS_TOTAL` / `HALF_TIME_CARDS_TOTAL`, so the 80 collision warnings per run are the expected duplicate.

The prices are not identical at every line, though. On Arsenal vs Hull:
- Equal at 0.5, 1.5 and 2.5 (2.5: 1.56/2.1 in both markets).
- 3.5 UNDER: 1.46 (points) vs 1.47 (count).
- 4.5 OVER: 3.63 (points) vs 3.65 (count).

Source: `evidence/betclic/arsenal-hull-raw-markets-excerpt.json`. The points market is parsed first (raw indices 210-214 vs 238-243), and `mergeMarketRecord` keeps the first-seen odds (`src/repositories/full-offer-repository.ts:197-222`, colliding code skipped at 215-217, warning at 245). So the shown price and label ("Punkty za kartki Powyżej/Poniżej") come from the points market. The comment at `betclic-normalizer.ts:2463-2468` ("bit-for-bit identical") is out of date. See Open question 2.

**Other observations:**
- The `METODA_GOLA` filter (`ca_ftb_goalm`) returns the same payload as `TOP` (197,821 vs 197,819 B); harmless after dedup.
- Cross-cutting (observability plan, not fixed here): `GET /api/odds?league=premier-league` reports `bookmakerStatus.betclic = "stale"` minutes after a successful save. `getBookmakerStatus` (`src/repositories/odds-repository.ts:131-164`) selects all `odds` rows ordered by `scraped_at` with no limit, and PostgREST returns at most `max_rows = 1000` (`supabase/config.toml:18`), so only the last-saved bookmaker (sts) is seen as `available`.

### What still works and must not break

- Listing (20 events), match ids, all 20 matches merged by matchId, 1X2/O/U/BTTS within 6.2%.
- The `CARDS_TOTAL` points-to-count merge and every blessed WC golden entry outside the 15 listed under Impact.
- The two non-OPTA OTHER markets stay OTHER: `Wynik meczu - Xtra Wygrana` (on 19 of 20 matches today, not on Arsenal vs Hull) and `Obaj gracze strzelą w 2. połowa` (on the 10 full-offer matches). This plan does not touch them.
- Tests green today: `npx vitest run src/scrapers/bookmakers/betclic` (13 tests), golden `-t betclic` (280 entries, 252 blessed, 0 failures), betclic normalizer tests in `src/services/normalization/bookmakers/__tests__/betclic-*.test.ts`.

### Impact

- Navigation: Task 1. Normalizer: Task 2 (penalty + OPTA) and Task 3 (tackles side). Catalog: none, because all target codes exist, so no `sync-market-types.ts`.
- Golden: WC fixture `world-cup-2026_france_morocco`, all entries currently blessed. Exactly **15** entries change; this was verified by simulating `golden.test.ts` against a scratch copy of the normalizer with the changes applied.
  - Task 2, 8 entries:
    - 260 → `FOULS_TOTAL:26.5`
    - 261 → `HOME_TEAM_TOTAL_FOULS:13.5`
    - 262 → `AWAY_TEAM_TOTAL_FOULS:12.5`
    - 264 → `OFFSIDES_1X2`
    - 265 → `OFFSIDES_TOTAL:3.5`
    - 266 → `HOME_TEAM_TOTAL_OFFSIDES:1.5`
    - 267 → `AWAY_TEAM_TOTAL_OFFSIDES:1.5`
    - 268 → `FIRST_OFFSIDE`
  - Task 3, 7 entries, from `TEAM_TOTAL_TACKLES:<line>` to `TEAM_TOTAL_TACKLES:<HOME|AWAY>:<line>`:
    - 273-276 → `HOME:14.5`, `HOME:15.5`, `HOME:17.5`, `HOME:20.5`
    - 277-279 → `AWAY:16.5`, `AWAY:19.5`, `AWAY:22.5`
  - Must not change: entries 139-141 (WC uses the old "Którykolwiek zawodnik" label) and 263 (`Pierwsza drużyna, która popełni faul`, stays `OTHER` with raw selection codes `Francja`, `Nikt`, `Maroko`).
- Audit knowledge: the frontend coverage baseline (`aityper/docs/audit-ledger/coverage.json`) has betclic entries for `TEAM_TOTAL_TACKLES` and `PENALTY_GOAL`. It has none for `OFFSIDES_*`, `*_TEAM_TOTAL_OFFSIDES`, `FOULS_TOTAL`, `*_TEAM_TOTAL_FOULS` or `FIRST_OFFSIDE`. Until it is rebuilt, selection-gap checks for the newly mapped markets stay suppressed (follow-up below).

### Risks and unknowns

- Waiting for complete frames makes a slow group cost more than today's 1 s. The `https.request` `timeout` option (`REQUEST_TIMEOUT`, 30 s) is only a socket *idle* timeout: a stream that keeps trickling bytes is never cut by it. So Task 1 adds an absolute per-attempt deadline, `GRPC_FRAME_DEADLINE` = 10,000 ms from request start. The worst case per group is 3 x 10 s plus 1 s + 2 s retry delays = 33 s, and the 7 groups run in parallel. For scale: unloaded completion is 190-923 ms. A group that still fails is skipped by `fetchAllMarketGroups` (`navigation.ts:376-394`, warning logged) and is never half-parsed.
- Trailers-only responses (a `grpc-status` header with an error) and a first frame with flag `0x80` (trailer instead of data) are rejected explicitly with the status text, so they are not mistaken for a short read.
- `(z dogrywką)` fouls/offsides include extra time. That cannot happen in the league configs. `world-cup-2026` (`src/config/leagues.ts:130`, `betclic/constants.ts:56`) knockouts could include extra time, and the existing pooling convention for `FOUL_RACE`, `TACKLES_*` and `MOST_SHOTS` already accepts that (`betclic-normalizer.ts:229-240`; the tournament is finished).
- `Pierwsza drużyna, która zostanie złapana na pozycji spalonej w meczu` was seen only with two legs (no `Nikt`). The `NONE` mapping comes from `normalizeFirstCardSelection` and is tested with a synthetic leg.

### Open questions for the owner

1. `Pierwsza drużyna, która popełni faul` has no catalog code (no `FIRST_FOUL`). Should one be added, or should it stay out? Default: it stays out and remains OTHER.
2. Should `Punkty za kartki` be dropped before save instead of merged? Its prices differ from `Liczba kartek` at some lines (3.5 UNDER 1.46 vs 1.47, 4.5 OVER 3.63 vs 3.65). Because it is parsed first, its price and label are the ones shown today.
   - **Recommendation:** drop it in the Betclic scraper output before normalization, so the count market's own prices and label are used. This also removes the 80 collision warnings per run. It cannot be done by returning `null` from the normalizer: `normalizeMarketsForBookmaker` maps 1:1 and never filters (`src/services/normalization/index.ts:72-79`).
   - This plan does **not** do it without the owner's approval. If approved, it becomes a separate task: test on the Arsenal vs Hull excerpt rows (`CARDS_TOTAL:3.5` must come out as UNDER 1.47), a golden diff for WC entries with raw name `Punkty za kartki*`, and an update to the stale comment at `betclic-normalizer.ts:2463-2468`.

### Acceptance criteria

Run from `/home/skamik/Documents/repositories/personal/aityper-scraper-api`:

Single-bookmaker live smoke. It scrapes the full offer and normalizes it, with no DB writes. The betclic copy of the script is extended with `otherNames`, `offVocabSelections`, `sidelessTeamTackleKeys` and `warningSamples`:

```bash
node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/smoke-full-offer.mts betclic premier-league OFFSIDES_TOTAL,OFFSIDES_1X2,HOME_TEAM_TOTAL_OFFSIDES,FOULS_TOTAL,HOME_TEAM_TOTAL_FOULS,FIRST_OFFSIDE,PENALTY_GOAL,HALF_TIME_PENALTY_GOAL,SECOND_HALF_PENALTY_GOAL,TEAM_TOTAL_TACKLES | grep '^SMOKE_RESULT' > /tmp/betclic-smoke.txt
```

This exact command was run on the current code at 17:29Z: exit 0, 37.7 s, no DB writes. The output is in `evidence/betclic/smoke-current-betclic-v2.txt`. Pre-fix values:

| Field | Pre-fix value |
|---|---|
| `otherMarketShare` | 0.0182 |
| `requiredCodeMatchCounts`, the six OPTA codes | all 0 |
| `requiredCodeMatchCounts`, the three penalty codes | 10 each |
| `requiredCodeMatchCounts.TEAM_TOTAL_TACKLES` | 4 |
| `offVocabSelections.PENALTY_GOAL` / `HALF_TIME_PENALTY_GOAL` / `SECOND_HALF_PENALTY_GOAL` | 10 / 10 / 10 |
| `sidelessTeamTackleKeys` | 24 |
| `warnings` | 0 |

Pass when:

1. **OTHER (RC3).** `success: true`, `matches` equals the listing count (20 today), and `warnings: 0`.
   - Every name in every `perMatch[].otherNames` is one of `Wynik meczu - Xtra Wygrana`, `Obaj gracze strzelą w 2. połowa` or `Pierwsza drużyna, która popełni faul`.
   - With today's offer the expected OTHER counts per match are:

     | Match | Before | After |
     |---|---|---|
     | Everton vs Coventry City | 10 | 3 (it offers only the Coventry fouls line, so 7 of its 8 OPTA markets get mapped) |
     | Leeds United vs Tottenham Hotspur | 11 | 3 |
     | Fulham vs Newcastle United | 11 | 3 |
     | Arsenal vs Hull City | 10 | 2 |
     | All other matches | 2 or 1 | unchanged |

   - `otherMarketShare` drops from 0.0182 to 33/3518 = 0.0094. Guard: `<= 0.010`.
2. **Mapping (RC2, RC3, RC4).**
   - `requiredCodeMatchCounts` for `OFFSIDES_TOTAL`, `OFFSIDES_1X2`, `HOME_TEAM_TOTAL_OFFSIDES`, `FOULS_TOTAL` and `FIRST_OFFSIDE` equals the number of matches that carried the matching raw name before the fix (4 today). `HOME_TEAM_TOTAL_FOULS` is 3 today, because of Everton.
   - `offVocabSelections` is 0 for every listed code. This catches both the penalty label leak and UNKNOWN fouls selections.
   - `sidelessTeamTackleKeys: 0`.
   - `unknownSelectionShare: 0`.
3. **Stability under load (RC1).** For each of the first 3 scheduled runs after the fix:
   - Run the smoke once in the same hour, between runs, while the service is idle. Then run `python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/check-log-vs-smoke.py <cleaned log> /tmp/betclic-smoke.txt`.
   - Each post-fix run must print `PASS`: every match's `N markets total` is within 2% of the smoke's `perMatch.raw`, and `failedGroups=0`. `incompleteRetries` is informational.
   - On the current code all three runs today print `FAIL` (2 / 8 / 4 matches out of tolerance; `evidence/betclic/log-vs-smoke-current.txt`), so the check discriminates.
4. **API (RC2, RC3, RC4).** Run:

   ```bash
   curl -s 'http://localhost:3001/api/matches/Arsenal/Hull%20City/normalized-markets?league=premier-league' | python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/api-check.py PENALTY_GOAL,HALF_TIME_PENALTY_GOAL,SECOND_HALF_PENALTY_GOAL,TEAM_TOTAL_TACKLES,OFFSIDES_TOTAL,FOULS_TOTAL,HOME_TEAM_TOTAL_FOULS,FIRST_OFFSIDE
   ```

   If Arsenal vs Hull has kicked off, use another match from the smoke whose `otherNames` contained OPTA names before the fix. Expected:
   - `PENALTY_GOAL '' ['TEAM_HOME', 'TEAM_AWAY', 'ANY', 'NONE']`.
   - Both half-time penalty rows end in `'ANY'`.
   - Every `TEAM_TOTAL_TACKLES` param starts with `HOME:` or `AWAY:`.
   - `OFFSIDES_TOTAL`, `FOULS_TOTAL`, `HOME_TEAM_TOTAL_FOULS` and `FIRST_OFFSIDE` rows are present, with `['OVER', 'UNDER']` (FIRST_OFFSIDE: `['HOME', 'AWAY']`).
   - The pre-fix output is in `evidence/betclic/api-check-current.txt`.
   - `grep -c 'marketKey collision.*betclic TEAM_TOTAL_TACKLES' <cleaned log of the post-fix runs>` prints 0.
5. **Prices and suite.**
   - `curl -s 'http://localhost:3001/api/odds?league=premier-league' | python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/odds-deviation.py` prints `max <= 10.0%` (today `mean=2.2% max=6.2%`, `evidence/betclic/odds-deviation-current.txt`).
   - `npx tsc --noEmit` exits 0, and `npx vitest run` is green.
   - The golden summary line reads `[golden] betclic/world-cup-2026_france_morocco: entries=280 blessed=252 unblessed=28 failures=0`, the same as today.

Cleaned log: `sed 's/\x1b\[[0-9;]*m//g' <backend.log> > <cleaned log>`. The log uses Betclic short names ("Leeds vs Tottenham"), while the smoke uses canonical names ("Leeds United vs Tottenham Hotspur"). `check-log-vs-smoke.py` pairs them by substring.

## Global Constraints

- Code and comments in English; commit messages concise; NO signature/attribution footers (no "Generated with", no "Co-Authored-By") - the owner's rule overrides any tool reminder.
- Work on a branch from `master` (`git switch -c fix/betclic-health-2026-11`); commit only after the owner approved executing this plan.
- Before every commit: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` (exit 0) and `npx vitest run` (all green).
- Golden-fixture discipline: failing test first. Rebless only through `scripts/rebless-golden.ts --bookmaker betclic`, after an inspected diff:
  - The golden failure list and `--dry` (which prints only the changed raw names and `{"changedTotal":N,"dry":true}`) must name exactly the entries listed for that task under Impact: Task 2 has 8, Task 3 has 7.
  - After the non-dry run, check the new values with the python one-liner in the task step and `git diff --stat` before committing.
  - No changed entry may contain the selection code `UNKNOWN`.
- Run `npx tsx scripts/sync-market-types.ts` only if `src/data/market-catalog.ts` changes (this plan does not change it).
- Editing anything under `src/` restarts the running dev server (`tsx watch`); coordinate before the first edit.
- Live traffic stays modest: one smoke run per verification step.

## Review Focus

1. The server keeps the stream open and may send a second frame right after the first. Only the first complete frame is returned, and the socket is destroyed. Tests: `decodeGrpcWebTextFrame reports complete when extra bytes follow the first frame` and `readGrpcWebTextStream resolves on a complete frame while the stream stays open` (Task 1).
2. A chunk boundary inside a base64 quadruplet must not corrupt decoding: decode only `floor(len/4)*4` chars. Test: `decodeGrpcWebTextFrame ignores a trailing partial quadruplet` (Task 1).
3. A stream that ends, trickles past the deadline, or carries a trailer frame (flag `0x80`) before the data frame is complete must reject, so that `fetchGrpcStream` retries. It must never resolve partial data. Tests: `readGrpcWebTextStream rejects when the stream ends mid-frame`, `... rejects when the stream ends with no data`, `... rejects at the deadline while bytes still trickle` and `... rejects a trailer frame` (Task 1).
4. Team names with a non-breaking space (written `-\u00a0Hull` in the test source) and short club names (`Hull` vs ctx `Hull City`) must resolve the side. Test rows: `Liczba spalonych w meczu -\u00a0Hull (OPTA)` (Task 2) and `Liczba odbiorów (OPTA) (z dogrywką) - Hull` (Task 3).
5. Team fouls lines must yield `OVER`/`UNDER`, not `UNKNOWN`. The old WC penalty label `Którykolwiek zawodnik strzeli rzut karny` must still map to `ANY`. Test rows: `Liczba fauli (OPTA) - Arsenal/Hull (z dogrywką)` and the WC-label row (Task 2).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/scrapers/bookmakers/betclic/navigation.ts` | Modify | `decodeGrpcWebTextFrame`, `readGrpcWebTextStream`, `fetchGrpcWithNodeHttp` uses the reader; docstring at 36-37 |
| `src/scrapers/bookmakers/betclic/constants.ts` | Modify | `GRPC_READ_TIMEOUT` and its comment (160-172) replaced by `GRPC_FRAME_DEADLINE = 10000` |
| `src/scrapers/bookmakers/betclic/README.md` | Modify | Troubleshooting row at line 222 names `GRPC_FRAME_DEADLINE` |
| `src/scrapers/bookmakers/betclic/__tests__/grpc-web-frame.test.ts` | Create | Task 1 tests |
| `src/scrapers/bookmakers/betclic/__tests__/fixtures/` | Create | Copies of the two `.grpc-web-text.b64` files from `evidence/betclic/` |
| `src/services/normalization/bookmakers/betclic-normalizer.ts` | Modify | Task 2: name table, team offsides/fouls resolvers, fouls O/U and FIRST_OFFSIDE selection cases, penalty ANY. Task 3: `TEAM_SUFFIX_MARKETS_WITH_LINE` |
| `src/services/normalization/bookmakers/__tests__/betclic-opta-penalty.test.ts` | Create | Task 2 tests |
| `src/services/normalization/bookmakers/__tests__/betclic-team-tackles-side.test.ts` | Create | Task 3 tests |
| `src/services/normalization/__fixtures__/betclic/world-cup-2026_france_morocco.expected.json` | Rebless | Task 2: 260-262, 264-268. Task 3: 273-279 |

---

### Task 1: gRPC-web reader resolves only on a complete frame

**Files:**
- Modify: `src/scrapers/bookmakers/betclic/navigation.ts:17-27` (imports), `:36-37` (docstring "read timeout"), `:82-178` (`fetchGrpcWithNodeHttp`, `processResponse`)
- Modify: `src/scrapers/bookmakers/betclic/constants.ts:160-172` (`GRPC_READ_TIMEOUT` and its comment → `GRPC_FRAME_DEADLINE`)
- Modify: `src/scrapers/bookmakers/betclic/README.md:222` (troubleshooting row)
- Create: `src/scrapers/bookmakers/betclic/__tests__/fixtures/arsenal-hull_HANDICAP.grpc-web-text.b64`, `arsenal-hull_TOP.grpc-web-text.b64` (copy from `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/`)
- Test: `src/scrapers/bookmakers/betclic/__tests__/grpc-web-frame.test.ts`

**Interfaces:**
- Produces (navigation.ts):
  - `export interface GrpcWebTextFrame { complete: boolean; expectedLength: number | null; flag: number | null; message: Buffer }`
  - `export function decodeGrpcWebTextFrame(data: string): GrpcWebTextFrame`. It strips `\r\n`, decodes the longest prefix whose length is a multiple of 4, and reads the 5-byte header. `expectedLength` and `flag` stay `null` until 5 bytes are decoded. `message` is the bytes after the header, capped at `expectedLength`. `complete` is `message.length === expectedLength`.
  - `export function readGrpcWebTextStream(res: NodeJS.ReadableStream & { destroy?(): void }, opts: { deadlineMs: number }): Promise<Buffer>`. It resolves with the first frame's `message` as soon as that frame is complete, without waiting for `end`. It rejects with:
    - `Incomplete gRPC-web frame: ${message.length}/${expectedLength} bytes` on `end`;
    - `gRPC-web frame deadline (${deadlineMs} ms): ${message.length}/${expectedLength} bytes` when the deadline passes;
    - `gRPC-web trailer frame instead of data: <trailer text>` when `flag & 0x80`;
    - a stream `error`, passed through.

    It settles once, clears its timer, and calls `res.destroy?.()` on every settle.
- Produces (constants.ts): `export const GRPC_FRAME_DEADLINE = 10000;`. It replaces `GRPC_READ_TIMEOUT`, which has no other references (`grep -rn GRPC_READ_TIMEOUT src` → `constants.ts:172`, `navigation.ts:23`, `navigation.ts:117`).
- Consumes: `parseAllMarketsFromProto(rawData: Buffer): ScrapedMarket[]` (`parser.ts:740`, unchanged).
- `fetchGrpcStream(url, body, timeoutMs)` (`navigation.ts:44-76`) keeps its signature and retry loop (`MAX_RETRIES` = 3, `RETRY_DELAY` = 1000 ms x attempt).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { decodeGrpcWebTextFrame, readGrpcWebTextStream } from "../navigation.js";
import { parseAllMarketsFromProto } from "../parser.js";

const b64 = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const HANDICAP = b64("arsenal-hull_HANDICAP.grpc-web-text.b64"), TOP = b64("arsenal-hull_TOP.grpc-web-text.b64");

describe("decodeGrpcWebTextFrame", () => {
  it("decodeGrpcWebTextFrame: full HANDICAP response is one complete 11926-byte frame with 4 markets", () => {
    const f = decodeGrpcWebTextFrame(HANDICAP);
    expect(f).toMatchObject({ complete: true, expectedLength: 11926, flag: 0 });
    expect(f.message.length).toBe(11926);
    expect(parseAllMarketsFromProto(f.message)).toHaveLength(4);
  });
  it("decodeGrpcWebTextFrame: a response cut at 8000 chars is incomplete (5995 of 11926 bytes)", () => {
    const f = decodeGrpcWebTextFrame(HANDICAP.slice(0, 8000));
    expect(f).toMatchObject({ complete: false, expectedLength: 11926 });
    expect(f.message.length).toBe(5995);
  });
  it("decodeGrpcWebTextFrame: TOP complete gives 29 markets, truncated TOP is incomplete", () => {
    expect(parseAllMarketsFromProto(decodeGrpcWebTextFrame(TOP).message)).toHaveLength(29);
    expect(decodeGrpcWebTextFrame(TOP.slice(0, 8000)).complete).toBe(false);
  });
  it("decodeGrpcWebTextFrame: header not yet received", () => {
    expect(decodeGrpcWebTextFrame("AAAA")).toMatchObject({ complete: false, expectedLength: null, flag: null });
  });
  it("decodeGrpcWebTextFrame ignores a trailing partial quadruplet", () => {
    expect(decodeGrpcWebTextFrame(HANDICAP.slice(0, 8002)).message.length).toBe(5995);
  });
  it("decodeGrpcWebTextFrame reports complete when extra bytes follow the first frame", () => {
    const f = decodeGrpcWebTextFrame(HANDICAP + "AAAAAAAA");
    expect(f).toMatchObject({ complete: true, expectedLength: 11926 });
    expect(f.message.length).toBe(11926);
  });
});

describe("readGrpcWebTextStream", () => {
  it("readGrpcWebTextStream resolves on a complete frame while the stream stays open", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.write(HANDICAP.slice(0, 8002)); // chunk boundary inside a base64 quadruplet
    s.write(HANDICAP.slice(8002)); // no end(): Betclic never ends the stream
    expect((await p).length).toBe(11926);
  });
  it("readGrpcWebTextStream rejects when the stream ends mid-frame", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.write(HANDICAP.slice(0, 8000));
    s.end();
    await expect(p).rejects.toThrow(/Incomplete gRPC-web frame: 5995\/11926 bytes/);
  });
  it("readGrpcWebTextStream rejects when the stream ends with no data", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.end();
    await expect(p).rejects.toThrow(/Incomplete gRPC-web frame: 0\/null bytes/);
  });
  it("readGrpcWebTextStream rejects at the deadline while bytes still trickle", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 50 });
    s.write(HANDICAP.slice(0, 8000));
    await expect(p).rejects.toThrow(/gRPC-web frame deadline \(50 ms\): 5995\/11926 bytes/);
  });
  it("readGrpcWebTextStream rejects a trailer frame", async () => {
    const t = Buffer.from("grpc-status:5\r\ngrpc-message:not found\r\n", "latin1");
    const f = Buffer.alloc(5 + t.length);
    f[0] = 0x80;
    f.writeUInt32BE(t.length, 1);
    t.copy(f, 5);
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.write(f.toString("base64"));
    await expect(p).rejects.toThrow(/gRPC-web trailer frame instead of data: grpc-status:5/);
  });
});
```

All 11 assertions (values and error texts) were checked against a scratch prototype of exactly these two functions, using the real HANDICAP fixture.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/scrapers/bookmakers/betclic/__tests__/grpc-web-frame.test.ts`
Expected: FAIL. 11 tests fail with `TypeError: ... decodeGrpcWebTextFrame is not a function` or `... readGrpcWebTextStream is not a function`.

- [ ] **Step 3: Implement**

`decodeGrpcWebTextFrame` as specified.

`readGrpcWebTextStream` must not re-decode the whole accumulated string on every chunk:
- Push each chunk with its `\r\n` stripped into an array and keep a running character count.
- Once the count is >= 8, decode the 8-char header **once** and set `need = Math.ceil((5 + expectedLength) / 3) * 4`.
- Only when the count is >= `need`, join the array and call `decodeGrpcWebTextFrame` once.

Re-decoding per chunk would cost about 190-210 ms of CPU per STRZELCY group (1.7 M chars, 113-126 chunks) on the shared event loop, under the same load that causes RC1; this is the review measurement. The header-once prototype reads the whole group in about 16 ms.

On `end`, the deadline and errors, decode what has arrived to build the `x/y bytes` part of the message.

`fetchGrpcWithNodeHttp`:
- Record `startedAt` before `https.request`.
- After the 200 check:
  - If `res.headers["grpc-status"]` is present and not `"0"`, call `res.destroy()` and reject `gRPC error ${status}: ${res.headers["grpc-message"] ?? ""}` (a trailers-only response).
  - Otherwise return `readGrpcWebTextStream(res, { deadlineMs: Math.max(1, GRPC_FRAME_DEADLINE - (Date.now() - startedAt)) })`, and call `req.destroy()` if it rejects.
- Keep `timeout: timeoutMs` (the socket idle timeout before headers) and the existing `req.on("timeout")` handler.
- Delete `processResponse` and the `GRPC_READ_TIMEOUT` import.

Docs:
- `constants.ts:160-172`: replace the constant and its comment with `GRPC_FRAME_DEADLINE`. The new comment says: the stream is never ended by the server, so the reader resolves on the first complete frame; the deadline bounds a trickling stream; unloaded completion was 190-923 ms on 2026-11-06.
- `navigation.ts:36-37`: change "with a read timeout" to "resolving on the first complete frame".
- `README.md:222`: change the row to `| Timeout / Incomplete gRPC-web frame | Slow or throttled stream | Check the retry warnings; raise GRPC_FRAME_DEADLINE |`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/scrapers/bookmakers/betclic && npx tsc --noEmit`
Expected: PASS, 24 tests in 3 files (11 new + 13 existing, which are 5 in parser.test.ts and 8 in navigation.test.ts). tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/bookmakers/betclic/navigation.ts src/scrapers/bookmakers/betclic/constants.ts src/scrapers/bookmakers/betclic/README.md src/scrapers/bookmakers/betclic/__tests__/grpc-web-frame.test.ts src/scrapers/bookmakers/betclic/__tests__/fixtures
git commit -m "fix(betclic): resolve gRPC-web streams on the first complete frame, never on a timeout"
```

### Task 2: Normalizer - penalty ANY and OPTA offsides/fouls

**Files:**
- Modify `src/services/normalization/bookmakers/betclic-normalizer.ts`:
  - `BETCLIC_MARKET_NAME_TO_CODE` (`:35-171`): add 4 entries next to `"spalone 1x2 (opta)"` (135) and `"suma spalonych w meczu (opta)"` (144).
  - `resolveTeamOffsidesMarket` (`:704-724`, regex at 712).
  - Add `resolveTeamFoulsMarket` after it, and call it right after the `teamOffsides` block in `resolveMarketCode` (`:884-887`).
  - Selection switch:
    - FIRST_CARD/FIRST_SHOT group (`:1917-1921`): add `FIRST_OFFSIDE`.
    - Over/under group (`:1963-1984`): add the team fouls codes.
  - `normalizePenaltyGoalSelection` (`:1593`, check at 1599).
- Rebless: `src/services/normalization/__fixtures__/betclic/world-cup-2026_france_morocco.expected.json`, entries 260-262 and 264-268.
- Test: `src/services/normalization/bookmakers/__tests__/betclic-opta-penalty.test.ts`

**Interfaces:**
- Name-table entries:
  - `"spalone 1x2 (opta) (z dogrywka)": "OFFSIDES_1X2"`
  - `"liczba spalonych w meczu (opta)": "OFFSIDES_TOTAL"`
  - `"liczba fauli w meczu (opta) (z dogrywka)": "FOULS_TOTAL"`
  - `"pierwsza druzyna, ktora zostanie zlapana na pozycji spalonej w meczu": "FIRST_OFFSIDE"`
- `resolveTeamOffsidesMarket` accepts `^(?:suma|liczba) spalonych w meczu\s*-\s*(.+?)\s*\(opta\)$`.
- `function resolveTeamFoulsMarket(normalizedName: string, ctx: NormalizationContext): { code: "HOME_TEAM_TOTAL_FOULS" | "AWAY_TEAM_TOTAL_FOULS"; teamSide: "HOME" | "AWAY" } | null`:
  - Matches `^liczba fauli\s*\(opta\)\s*-\s*(.+?)(?:\s*\(z dogrywka\))?$`.
  - Resolves the side with `fragmentIsTeam`, the same way as `resolveTeamOffsidesMarket`.
  - `resolveMarketCode` returns `{ marketCode: code, matchedBy: "pattern", teamSide }`.
- `normalizeSelectionForMarket`:
  - `case "FIRST_OFFSIDE":` joins the FIRST_CARD/FIRST_SHOT group at `:1917-1921`. `normalizeFirstCardSelection` maps `Nikt` to `NONE` and falls back to canonical team matching, so `Hull` resolves against ctx `Hull City` and `Francja`/`Maroko` resolve for WC #268.
  - `case "HOME_TEAM_TOTAL_FOULS": case "AWAY_TEAM_TOTAL_FOULS":` join the `normalizeOverUnderSelection` group at `:1963-1984`. Without this, the default branch at `:2302-2303` (`normalize1x2Selection`) returns `UNKNOWN` for `Powyżej 13,5`.
- `normalizePenaltyGoalSelection` also returns `ANY` when the normalized label contains `ktorakolwiek`.

- [ ] **Step 1: Write the failing table test**

The values come from `evidence/betclic/arsenal-hull-raw-markets-excerpt.json`. Non-breaking spaces are written as `\u00a0`.

```ts
import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

const ctx = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };
type Row = [name: string, selections: [string, number][], marketCode: string, marketKey: string, codes: string[]];
const ROWS: Row[] = [
  ["Gol z rzutu karnego", [["Arsenal strzeli rzut karny", 4.25], ["Hull strzeli rzut karny", 14], ["Którakolwiek drużyna strzeli gola z rzutu karnego", 3.5], ["Żaden zespól nie strzeli rzutu karnego", 1.2]], "PENALTY_GOAL", "PENALTY_GOAL", ["TEAM_HOME", "TEAM_AWAY", "ANY", "NONE"]],
  ["Gol z rzutu karnego- 1. połowa", [["Arsenal strzeli rzut karny", 7.5], ["Hull strzeli rzut karny", 25], ["Którakolwiek drużyna strzeli gola z rzutu karnego", 5.75]], "HALF_TIME_PENALTY_GOAL", "HALF_TIME_PENALTY_GOAL", ["TEAM_HOME", "TEAM_AWAY", "ANY"]],
  ["Gol z rzutu karnego- 2. połowa", [["Arsenal strzeli rzut karny", 6.25], ["Hull strzeli rzut karny", 20], ["Którakolwiek drużyna strzeli gola z rzutu karnego", 5]], "SECOND_HALF_PENALTY_GOAL", "SECOND_HALF_PENALTY_GOAL", ["TEAM_HOME", "TEAM_AWAY", "ANY"]],
  // WC label regression guard (golden #139)
  ["Gol z rzutu karnego", [["Którykolwiek zawodnik strzeli rzut karny", 3.4]], "PENALTY_GOAL", "PENALTY_GOAL", ["ANY"]],
  ["Liczba spalonych w meczu (OPTA)", [["Powyżej 3,5", 1.7], ["Poniżej 3,5", 1.78]], "OFFSIDES_TOTAL", "OFFSIDES_TOTAL:3.5", ["OVER", "UNDER"]],
  ["Liczba spalonych w meczu -\u00a0Arsenal (OPTA)", [["Powyżej 2,5", 1.85], ["Poniżej 2,5", 1.62]], "HOME_TEAM_TOTAL_OFFSIDES", "HOME_TEAM_TOTAL_OFFSIDES:2.5", ["OVER", "UNDER"]],
  ["Liczba spalonych w meczu -\u00a0Hull (OPTA)", [["Powyżej 0,5", 1.32], ["Poniżej 0,5", 2.55]], "AWAY_TEAM_TOTAL_OFFSIDES", "AWAY_TEAM_TOTAL_OFFSIDES:0.5", ["OVER", "UNDER"]],
  ["Spalone 1X2 (OPTA) (z dogrywką)", [["Arsenal", 1.32], ["Remis ", 5], ["Hull", 5]], "OFFSIDES_1X2", "OFFSIDES_1X2", ["HOME", "DRAW", "AWAY"]],
  ["Liczba fauli w meczu (OPTA) (z dogrywką)", [["Powyżej 21,5", 1.75], ["Poniżej 21,5", 1.75]], "FOULS_TOTAL", "FOULS_TOTAL:21.5", ["OVER", "UNDER"]],
  ["Liczba fauli (OPTA) - Arsenal (z dogrywką)", [["Powyżej 8,5", 1.7], ["Poniżej 8,5", 1.78]], "HOME_TEAM_TOTAL_FOULS", "HOME_TEAM_TOTAL_FOULS:8.5", ["OVER", "UNDER"]],
  ["Liczba fauli (OPTA) - Hull (z dogrywką)", [["Powyżej 12,5", 1.7], ["Poniżej 12,5", 1.78]], "AWAY_TEAM_TOTAL_FOULS", "AWAY_TEAM_TOTAL_FOULS:12.5", ["OVER", "UNDER"]],
  ["Pierwsza drużyna, która zostanie złapana na pozycji spalonej w meczu", [["Arsenal", 1.3], ["Hull", 2.9]], "FIRST_OFFSIDE", "FIRST_OFFSIDE", ["HOME", "AWAY"]],
  // synthetic third leg: "Nikt" was only seen on the sibling foul market (150); pins the NONE mapping
  ["Pierwsza drużyna, która zostanie złapana na pozycji spalonej w meczu", [["Arsenal", 1.3], ["Hull", 2.9], ["Nikt", 150]], "FIRST_OFFSIDE", "FIRST_OFFSIDE", ["HOME", "AWAY", "NONE"]],
  // no catalog code (open question 1): stays OTHER with raw labels as codes, like WC golden #263
  ["Pierwsza drużyna, która popełni faul", [["Arsenal", 2.15], ["Nikt", 150], ["Hull", 1.45]], "OTHER", "OTHER", ["Arsenal", "Nikt", "Hull"]],
];

describe("betclic OPTA offsides/fouls and penalty ANY", () => {
  it.each(ROWS)("betclic OPTA/penalty #%#: %s", (name, sels, marketCode, marketKey, codes) => {
    const out = betclicNormalizer.normalizeMarket({ name, selections: sels.map(([n, odds]) => ({ name: n, odds })) }, ctx);
    expect(out?.marketCode).toBe(marketCode);
    expect(out?.marketKey).toBe(marketKey);
    expect(out?.selections.map((s) => s.code)).toEqual(codes);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/betclic-opta-penalty.test.ts`
Expected: FAIL, 12 failed and 2 passed (this was checked by running the same rows against the current normalizer):
- The 3 penalty rows contain the code `Którakolwiek drużyna strzeli gola z rzutu karnego`.
- The 9 OPTA rows return `marketCode` `OTHER` / `marketKey` `OTHER`, with raw labels as selection codes such as `Powyżej 3,5`.
- The WC-label row and the `popełni faul` row already pass.

- [ ] **Step 3: Implement** the Interfaces list.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/betclic-opta-penalty.test.ts`
Expected: PASS (14).

- [ ] **Step 5: Inspect and rebless the WC golden (8 entries)**

1. Run `npx vitest run src/services/normalization/__tests__/golden.test.ts -t betclic`.
   Expected: FAIL with `[golden] betclic/world-cup-2026_france_morocco: entries=280 blessed=252 unblessed=28 failures=8`. The error lists `#260 #261 #262 #264 #265 #266 #267 #268` and nothing else. It shows only the first differing field per entry.
2. Run `npx tsx scripts/rebless-golden.ts --bookmaker betclic --dry`.
   Expected: stderr shows `[rebless] betclic/world-cup-2026_france_morocco: 8 entries updated` plus the 8 raw names (fouls x3, `Spalone 1X2 ...`, offsides x3, `Pierwsza drużyna, która zostanie złapana ...`). Stdout is `{"changedTotal":8,"dry":true}`.
3. Run `npx tsx scripts/rebless-golden.ts --bookmaker betclic`, then check the new values:

   ```bash
   python3 -I -c "import json;e=json.load(open('src/services/normalization/__fixtures__/betclic/world-cup-2026_france_morocco.expected.json'))['entries'];[print(x['index'],x['expected']['marketKey'],','.join(s['code'] for s in x['expected']['selections'])) for x in e if 260<=x['index']<=268]"
   ```

   Expected, exactly:

   ```
   260 FOULS_TOTAL:26.5 OVER,UNDER
   261 HOME_TEAM_TOTAL_FOULS:13.5 OVER,UNDER
   262 AWAY_TEAM_TOTAL_FOULS:12.5 OVER,UNDER
   263 OTHER Francja,Nikt,Maroko
   264 OFFSIDES_1X2 HOME,DRAW,AWAY
   265 OFFSIDES_TOTAL:3.5 OVER,UNDER
   266 HOME_TEAM_TOTAL_OFFSIDES:1.5 OVER,UNDER
   267 AWAY_TEAM_TOTAL_OFFSIDES:1.5 OVER,UNDER
   268 FIRST_OFFSIDE HOME,AWAY
   ```

   For 268, HOME is Francja 1.88 and AWAY is Maroko 1.8. No `UNKNOWN` anywhere. Also run `git diff --stat`: it must show only `world-cup-2026_france_morocco.expected.json` under `__fixtures__`.
4. Run the golden test again. Expected: `failures=0`.

- [ ] **Step 6: Run the whole normalization suite and tsc**

Run: `npx vitest run src/services/normalization && npx tsc --noEmit`
Expected: PASS; tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/normalization/bookmakers/betclic-normalizer.ts src/services/normalization/bookmakers/__tests__/betclic-opta-penalty.test.ts src/services/normalization/__fixtures__/betclic/world-cup-2026_france_morocco.expected.json
git commit -m "fix(betclic): map renamed penalty ANY leg and OPTA offsides/fouls markets"
```

### Task 3: Normalizer - side-scoped TEAM_TOTAL_TACKLES keys

This task is separate because it changes stored `market_key`/`param_value` for an existing code, and it starts pooling with superbet's `HOME:x`/`AWAY:x` rows (`superbet-normalizer.ts:503-518`). The API serves superbet today as `'HOME:12.5'` / `'AWAY:18.5'` on Arsenal vs Hull. A reviewer may approve Task 2 and reject this one.

**Files:**
- Modify: `src/services/normalization/bookmakers/betclic-normalizer.ts:2501-2505` (`TEAM_SUFFIX_MARKETS_WITH_LINE`)
- Rebless: `src/services/normalization/__fixtures__/betclic/world-cup-2026_france_morocco.expected.json`, entries 273-279
- Test: `src/services/normalization/bookmakers/__tests__/betclic-team-tackles-side.test.ts`

**Interfaces:**
- `"TEAM_TOTAL_TACKLES"` is added to `TEAM_SUFFIX_MARKETS_WITH_LINE`. `paramValue` becomes `${teamSide}:${line}` (the side comes from `resolveTeamTacklesMarket`, `:879-882`), and `marketKey` becomes `TEAM_TOTAL_TACKLES:<HOME|AWAY>:<line>`. Selections stay `OVER`/`UNDER` (`:2006-2007`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { betclicNormalizer } from "../betclic-normalizer.js";

const ctx = { homeTeam: "Arsenal", awayTeam: "Hull City", league: "premier-league" };
type Row = [name: string, selections: [string, number][], paramValue: string, marketKey: string];
const ROWS: Row[] = [
  ["Liczba odbiorów (OPTA) (z dogrywką) - Arsenal", [["Powyżej 10,5", 1.32], ["Poniżej 10,5", 2.55]], "HOME:10.5", "TEAM_TOTAL_TACKLES:HOME:10.5"],
  ["Liczba odbiorów (OPTA) (z dogrywką) - Hull", [["Powyżej 15,5", 1.24], ["Poniżej 15,5", 2.95]], "AWAY:15.5", "TEAM_TOTAL_TACKLES:AWAY:15.5"],
];

describe("betclic TEAM_TOTAL_TACKLES carries the team side", () => {
  it.each(ROWS)("betclic team tackles: %s", (name, sels, paramValue, marketKey) => {
    const out = betclicNormalizer.normalizeMarket({ name, selections: sels.map(([n, odds]) => ({ name: n, odds })) }, ctx);
    expect(out?.marketCode).toBe("TEAM_TOTAL_TACKLES");
    expect(out?.paramValue).toBe(paramValue);
    expect(out?.marketKey).toBe(marketKey);
    expect(out?.selections.map((s) => s.code)).toEqual(["OVER", "UNDER"]);
  });
  it("betclic team tackles: equal lines for both teams get distinct keys (Fulham vs Newcastle 16.5 collision)", () => {
    // Arsenal 14.5 is real; the Hull 14.5 line is synthetic (same odds) to reproduce the equal-line collision
    const sels = [{ name: "Powyżej 14,5", odds: 2.75 }, { name: "Poniżej 14,5", odds: 1.27 }];
    const home = betclicNormalizer.normalizeMarket({ name: "Liczba odbiorów (OPTA) (z dogrywką) - Arsenal", selections: sels }, ctx);
    const away = betclicNormalizer.normalizeMarket({ name: "Liczba odbiorów (OPTA) (z dogrywką) - Hull", selections: sels }, ctx);
    expect([home?.marketKey, away?.marketKey]).toEqual(["TEAM_TOTAL_TACKLES:HOME:14.5", "TEAM_TOTAL_TACKLES:AWAY:14.5"]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/betclic-team-tackles-side.test.ts`
Expected: FAIL, all 3 tests: `paramValue` `10.5` / `15.5` and keys `TEAM_TOTAL_TACKLES:10.5`, `TEAM_TOTAL_TACKLES:15.5`, `TEAM_TOTAL_TACKLES:14.5` (twice).

- [ ] **Step 3: Implement** the Interfaces line.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/normalization/bookmakers/__tests__/betclic-team-tackles-side.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Inspect and rebless the WC golden (7 entries)**

1. Run `npx vitest run src/services/normalization/__tests__/golden.test.ts -t betclic`.
   Expected: `failures=7`, listing `#273` to `#279` only.
2. Run `npx tsx scripts/rebless-golden.ts --bookmaker betclic --dry`.
   Expected: `7 entries updated`. The names are 4x `Liczba odbiorów (OPTA) (z dogrywką) - Francja` and 3x `... - Maroko`, and stdout is `{"changedTotal":7,"dry":true}`.
3. Run `npx tsx scripts/rebless-golden.ts --bookmaker betclic`, then run the Task 2 one-liner with `273<=x['index']<=279`.
   Expected, exactly:

   ```
   273 TEAM_TOTAL_TACKLES:HOME:14.5 OVER,UNDER
   274 TEAM_TOTAL_TACKLES:HOME:15.5 OVER,UNDER
   275 TEAM_TOTAL_TACKLES:HOME:17.5 OVER,UNDER
   276 TEAM_TOTAL_TACKLES:HOME:20.5 OVER,UNDER
   277 TEAM_TOTAL_TACKLES:AWAY:16.5 OVER,UNDER
   278 TEAM_TOTAL_TACKLES:AWAY:19.5 OVER,UNDER
   279 TEAM_TOTAL_TACKLES:AWAY:22.5 OVER,UNDER
   ```

4. Run the golden test again. Expected: `failures=0`.

- [ ] **Step 6: Run the whole normalization suite and tsc**

Run: `npx vitest run src/services/normalization && npx tsc --noEmit`
Expected: PASS; tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/normalization/bookmakers/betclic-normalizer.ts src/services/normalization/bookmakers/__tests__/betclic-team-tackles-side.test.ts src/services/normalization/__fixtures__/betclic/world-cup-2026_france_morocco.expected.json
git commit -m "fix(betclic): key team tackles lines by side"
```

### Task 4: Live verification

The running `tsx watch` server picks up the commits automatically. Run smokes only between scheduled runs (the scheduler starts at :00 UTC), never during one.

- [ ] **Step 1: Unloaded smoke (criteria 1-2)**

```bash
cd /home/skamik/Documents/repositories/personal/aityper-scraper-api
node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/smoke-full-offer.mts betclic premier-league OFFSIDES_TOTAL,OFFSIDES_1X2,HOME_TEAM_TOTAL_OFFSIDES,FOULS_TOTAL,HOME_TEAM_TOTAL_FOULS,FIRST_OFFSIDE,PENALTY_GOAL,HALF_TIME_PENALTY_GOAL,SECOND_HALF_PENALTY_GOAL,TEAM_TOTAL_TACKLES | grep '^SMOKE_RESULT' > /tmp/betclic-smoke.txt
python3 -I -c "import json;d=json.loads(open('/tmp/betclic-smoke.txt').read()[13:]);ok={'Wynik meczu - Xtra Wygrana','Obaj gracze strzelą w 2. połowa','Pierwsza drużyna, która popełni faul'};print(d['success'],d['matches'],d['warnings'],d['otherMarketShare'],d['requiredCodeMatchCounts'],d['offVocabSelections'],d['sidelessTeamTackleKeys'],sorted({n for p in d['perMatch'] for n in p['otherNames']}-ok))"
```

Expected: `True 20 0 <=0.010 {... OPTA codes 4, HOME_TEAM_TOTAL_FOULS 3 ...} {all 0} 0 []`. Copy the SMOKE line to `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/smoke-after-fix-betclic.txt`.

- [ ] **Step 2: Stability under load (criterion 3), after each of the next 3 scheduled runs**

Run the Step 1 smoke command again in the same hour as that scheduled run, once the run has finished, and save it to `/tmp/betclic-smoke-<HH>.txt`. Then:

```bash
sed 's/\x1b\[[0-9;]*m//g' <backend.log> > /tmp/backend.clean.log
python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/check-log-vs-smoke.py /tmp/backend.clean.log /tmp/betclic-smoke-<HH>.txt
```

Expected: the line for that hour's run reads `run N (log line L): matches=20 outOfTolerance=0 failedGroups=0 incompleteRetries=K -> PASS`. Pre-fix runs earlier in the same log still print FAIL; ignore them. `<backend.log>` is the dev server's log; this session's is the scratchpad `backend.log`.

- [ ] **Step 3: API (criterion 4)**

```bash
curl -s 'http://localhost:3001/api/matches/Arsenal/Hull%20City/normalized-markets?league=premier-league' | python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/api-check.py PENALTY_GOAL,HALF_TIME_PENALTY_GOAL,SECOND_HALF_PENALTY_GOAL,TEAM_TOTAL_TACKLES,OFFSIDES_TOTAL,FOULS_TOTAL,HOME_TEAM_TOTAL_FOULS,FIRST_OFFSIDE
tail -n +<first post-fix log line> /tmp/backend.clean.log | grep -c 'marketKey collision.*betclic TEAM_TOTAL_TACKLES'
```

Expected lines, in any order (lines as of 17:28Z; numbers may move, sides and codes must not):
- `PENALTY_GOAL '' ['TEAM_HOME', 'TEAM_AWAY', 'ANY', 'NONE']`
- `HALF_TIME_PENALTY_GOAL '' ['TEAM_HOME', 'TEAM_AWAY', 'ANY']`, and the same for `SECOND_HALF_PENALTY_GOAL`
- `TEAM_TOTAL_TACKLES 'HOME:10.5' ['OVER', 'UNDER']` and the other lines, all `HOME:`/`AWAY:`-prefixed
- `OFFSIDES_TOTAL '3.5' ['OVER', 'UNDER']`
- `FOULS_TOTAL '21.5' ['OVER', 'UNDER']`
- `HOME_TEAM_TOTAL_FOULS '8.5' ['OVER', 'UNDER']`
- `FIRST_OFFSIDE '' ['HOME', 'AWAY']`

The `grep -c` must print 0. Pre-fix collisions stay in the log, which is why only the post-fix slice is searched. Its first line is the `Found 20 events in listing` line of the first post-fix run, as printed by `check-log-vs-smoke.py`.

- [ ] **Step 4: Prices and suite (criterion 5)**

```bash
curl -s 'http://localhost:3001/api/odds?league=premier-league' | python3 -I docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betclic/odds-deviation.py
npx tsc --noEmit && npx vitest run
```

Expected: `betclic MATCH_WINNER: matches=20 n=60 mean=~2% max=<=10.0% ...`; tsc exits 0; all tests green.

## What to monitor after the fix

- Per run, the count of `Incomplete gRPC-web frame` and `gRPC-web frame deadline` retries (`incompleteRetries` in `check-log-vs-smoke.py` counts the first kind). A rising count means Betclic is throttling or the streams are slower.
- OTHER raw names per run. New Betclic labels show up there first (`perMatch[].otherNames` in the smoke).
- `marketKey collision ... betclic` keys other than `CARDS_TOTAL` / `HALF_TIME_CARDS_TOTAL`.

## Follow-ups (not in this plan)

- **Frontend audit baseline (separate change in the `aityper` repo).** After the first post-fix scheduled run, rebuild `aityper/docs/audit-ledger/coverage.json`. Use `npx tsx scripts/build-coverage-baseline.ts --archive <aityper>/docs/audit-ledger/raw-archive --out <aityper>/docs/audit-ledger/coverage.json --db`, run from the scraper repo (options per `scripts/build-coverage-baseline.ts:14-20`). Its union is monotonic, so it only adds the new betclic codes `OFFSIDES_*`, `*_TEAM_TOTAL_OFFSIDES`, `FOULS_TOTAL`, `*_TEAM_TOTAL_FOULS` and `FIRST_OFFSIDE`, together with their selection codes. Until then, selection-gap checks for these markets stay suppressed.
- Open question 2 (`Punkty za kartki`). If approved, it becomes its own task, as described there.
- Open question 1 (`FIRST_FOUL`). It needs a catalog entry, so `sync-market-types.ts` must run, and a peer survey.
