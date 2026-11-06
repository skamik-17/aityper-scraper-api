# Betfan — health check 2026-11-06 + team-stat side axis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give betfan's per-team OPTA lines (shots, shots on target, fouls) their team side, so they merge with the peers on `HOME:`/`AWAY:` rows instead of sitting on side-less params with no team name. Also stop dropping the away-team fouls line, which currently goes to OTHER.

**Architecture:** Changes stay in `betfan-normalizer.ts`. `TEAM_TOTAL_SHOTS(_ON_TARGET)` join `TEAM_LINE_PARAM_MARKETS`, the set CORNERS_TEAM and CARDS_TEAM already use for the `HOME:<line>` param. Team fouls are re-resolved through `TEAM_SCOPED_CODE_MAP` into `HOME_/AWAY_TEAM_TOTAL_FOULS`, the same pattern used for offsides. This also maps the missing away id `163`. The catalog does not change.

**Tech Stack:** TypeScript (ESM, tsx), Vitest.

**Spec:** the Observations section of this file. Evidence: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betfan/` (index: `measurements-2026-11-06.txt`; check tools: `tools/team-stat-check.py`, `tools/odds-sanity.py`).

---

## Observations (pre-fix analysis)

### Status today: DEGRADED (team-stat comparison/display defect). Volume and coverage at or above August

All paths below are relative to `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betfan/`. `measurements-2026-11-06.txt` lists every number with its command and timestamp.

| Metric | Aug 2026 baseline (Arsenal v Coventry, 2026-08-20) | Today (2026-11-06, run 2 = 16:00Z) | Evidence |
|---|---|---|---|
| League listing / fixtures | — | 20 events → 20 fixtures, 20/20 same `matchId` as the other bookmakers, 0 orphans, 0 duplicates | `backend-log-per-match-counts.txt`, `api-odds-premier-league-2026-11-06T1616Z.json` |
| Parsed markets per match | 789 (2125 selections) | round 11: 803–978; round 12: 82–85. 9555 parsed in total, 5600 DB rows. The ratio is expected: betfan emits one raw market per player × threshold, and `mergeMarketRecord` folds them per code+player | `backend-log-per-match-counts.txt` |
| Normalized codes / entries / selections (API) | 119 / 1045 / 1815 | Arsenal v Hull 123 / 919 / 1803; Everton v Coventry 140 / 859 / 1687; Man City v Fulham 65 / 83 / 308 | `api-stats-nm-*.json` (`betfan` block) |
| UNKNOWN selections | 0 | 0 | `api-stats-nm-*.json`, `offline-parse-normalize-summary-2026-11-06.json` |
| OTHER (offline parse+normalize of the captured events) | — | 0/978 Arsenal v Hull; 5/876 (0.6%) Everton v Coventry | `offline-parse-normalize-summary-2026-11-06.json` (from `raw-event-40933001-…json`, `raw-event-40932978-…json`) |
| Duplicate codes in a param | 0 | 0 (the 21–22 "player name as selection" hits on `PLAYER_GOAL_AND_ASSIST` follow the shared convention also used by betcris, sts and superbet, so they are not a leak) | `api-stats-nm-*.json` |
| 1X2 vs peer median, betfan excluded from the median (20 × 3) | — | max 3.6%, mean 1.5% (16:16Z snapshot and again live at 17:05Z) | `api-odds-premier-league-2026-11-06T1616Z.json`, `tools/odds-sanity.py` |
| O/U 2.5 vs peer median (20 × 2) | — | max 2.2% at 16:28Z, 3.4% live at 17:05Z, no axis swap | `api-total-goals-2.5-rows-2026-11-06T1628Z.json`, `tools/odds-sanity.py` |
| API meta `bookmakerStatus.betfan` | — | `"stale"` with `lastUpdated: null`, although betfan saved 5600 rows at 16:02Z. This is false; observability.md (f) owns it | `api-odds-premier-league-2026-11-06T1616Z.json` |
| Normalizer warnings in run 2 log | — | none | backend log |
| Tests | — | `src/scrapers/bookmakers/betfan` 2/2; golden `betfan` 517 blessed / 720 unblessed / 0 failures | `npx vitest run` |

Eight of the 9 codes covered in August but missing now were removed or merged from the catalog on 2026-08-20 (`ASSIST_SCORER_ANYTIME`, `FIRST_HALF_CARDS_1X2`, `PLAYER_FOULS_OVER`, `PLAYER_SHOTS_ANYTIME`, and the half clean sheets). The ninth, `PLAYER_FREE_KICK_GOAL`, is a bookmaker-side placeholder. The raw "Zawodnik strzeli gola bezpośrednio z rzutu wolnego" (`-200175`) prices 38/38 players at exactly 100 for Arsenal v Hull, and 32/33 at 100 for Everton v Coventry; the remaining one is at 44 (`raw-event-*.json`, `measurements-2026-11-06.txt` §6). The parser's sentinel filter drops those prices on purpose (`src/scrapers/bookmakers/betfan/parser.ts:37`, `:395-399`), so this is not a code issue. 30 codes are new since August.

### Root cause

1. **Side-less team shot lines.** `TEAM_LINE_PARAM_MARKETS` (`src/services/normalization/bookmakers/betfan-normalizer.ts:1401`) contains only `CORNERS_TEAM` and `CARDS_TEAM`. For those, `normalizeMarket` prefixes the param with the detected side (`:1427-1432`). `TEAM_TOTAL_SHOTS` (ids `-200054/-200055`, `:66-67`) and `TEAM_TOTAL_SHOTS_ON_TARGET` (id `169`, and `168` via the team refine at `:705-723`) keep the bare line. The current code reproduces it (`evidence/betfan/smoke-discovery-current-code-2026-11-06.txt`):
   ```
   Everton - liczba strzałów (OPTA)              → Market Key: TEAM_TOTAL_SHOTS:16.5
   Coventry City - liczba strzałów (OPTA)        → Market Key: TEAM_TOTAL_SHOTS:11.5
   Everton - liczba celnych strzałów … (OPTA)    → Market Key: TEAM_TOTAL_SHOTS_ON_TARGET:4.5 / :5.5
   Coventry City - liczba celnych strzałów …     → Market Key: TEAM_TOTAL_SHOTS_ON_TARGET:2.5 / :3.5
   ```
   For Everton v Coventry, the API (`evidence/betfan/api-everton-coventry-team-stat-markets.json`) shows betfan alone on `TEAM_TOTAL_SHOTS` `16.5`, with no team in the label. forbet, fortuna, fuksiarz and superbet quote the same bet on `HOME:16.5`; forbet's price is U 2.0 / O 1.7 and betfan's is U 1.85 / O 1.85. Betfan's `4.5` shots-on-target row is identical to etoto's (U 2.4 / O 1.5, the same platform feed), and both sit apart from betclic, fortuna, fuksiarz and superbet on `HOME:4.5`.
2. **Side-less fouls, and the away line dropped.** The id map has `"162": "TEAM_TOTAL_FOULS"` (`:70`) and no `163`. "Coventry City - liczba fauli (OPTA)" (`163`, U 1.83 / O 1.83 at 12.5) falls to OTHER with UNKNOWN selections. The smoke summary shows `❌ UNMAPPED MARKETS: Coventry City - liczba fauli (OPTA)`. The home line lands on side-less `TEAM_TOTAL_FOULS:10.5`. forbet, fortuna and superbet use `HOME_/AWAY_TEAM_TOTAL_FOULS`. forbet and fortuna quote `HOME_TEAM_TOTAL_FOULS:10.5` at U 1.75 / O 1.9 and U 1.8 / O 1.88, close to betfan's U 2.0 / O 1.7 (`evidence/betfan/api-everton-coventry-team-stat-markets.json`). On `AWAY_TEAM_TOTAL_FOULS:12.5` forbet, fortuna and superbet quote U 1.9 / O 1.75, U 1.85 / O 1.82 and U 1.73 / O 1.9, next to betfan's dropped U 1.83 / O 1.83. The golden fixture shows the gap already existed in July: entries #94/#95 "Maroko - liczba fauli (OPTA)" are OTHER (unblessed).
3. **Latent collision.** If both teams share a line, both rows get the same key, and `mergeMarketRecord` (`src/repositories/full-offer-repository.ts:197-248`) keeps only the first and logs a `marketKey collision` warning (`:243-247`). The golden fixture has exactly that case: #60 "Francja … 4.5" and #67 "Maroko … 4.5" are both `TEAM_TOTAL_SHOTS_ON_TARGET:4.5`, unblessed.

These mappings date from commit `2273acd` (2026-06-26). They were not seen in August because betfan had no OPTA team stats for Arsenal v Coventry when that audit captured it. Today only the match closest to kick-off (Everton v Coventry, 20:00Z) carries them: 8 raw games, 7 API rows. In today's sample betfan published OPTA team lines only on match day. Arsenal v Hull had 0 at T-22.6h, and Leeds v Tottenham had 0 of 240 games at T-19.5h (`measurements-2026-11-06.txt` §1).

### Also observed, no task (open question)
- `-200040` "Coventry City powyżej 1.5 rzutów rożnych w każdej połowie" (Tak 2.7) → OTHER, while the home id `-200039` maps to `TEAM_CORNERS_BOTH_HALVES_OVER`. Mapping the away side needs a team axis on that code. The catalog has `hasParameter: false` and a `{param}`-for-line description template (`src/data/market-catalog.ts:8438-8451`), so it is a catalog redesign for a betfan-only market.
- "Obie drużyny strzelą gola i każda drużyna powyżej X rzutów rożnych/kartek" (`-200045/-200046`) → OTHER. No catalog code exists, so OTHER is correct.

### What still works and must not break
- `CORNERS_TEAM` keys `HOME:3.5..7.5` and `AWAY:2.5..6.5` (ids 115/116), and `CARDS_TEAM` side-prefixed selections (`:986-990`).
- Whole-match totals stay side-less: `TOTAL_SHOTS_ON_TARGET:7.5/8.5/9.5` (`-30242`), `TOTAL_SHOTS:28.5` (`-200194`), `FOULS_TOTAL:22.5` (`-30243`), `OFFSIDES_TOTAL:3.5`.
- `HOME_/AWAY_TEAM_TOTAL_OFFSIDES` via `TEAM_SCOPED_CODE_MAP` (`:478`, `:525-529`).
- The player-prop explosion (978 parsed markets for Arsenal v Hull) and the sentinel filters.

### Risks & unknowns
- **Decision D1** (shared with `etoto.md` Task 2): team fouls go to `HOME_/AWAY_TEAM_TOTAL_FOULS`, not to `TEAM_TOTAL_FOULS` with a side param. fuksiarz still emits side-less `TEAM_TOTAL_FOULS`; that is out of scope.
- The affected golden entries are all **unblessed**, so the golden test will not move. Correctness rests on the new unit tests, and unblessed drift is guarded by the `--include-unblessed --dry` probe count in each task (baseline 49 on the unmodified tree, then 64 after Task 1 and 68 after Task 2, `measurements-2026-11-06.txt` §7). Blessing betfan's team-stat entries afterwards is optional (`rebless-golden.ts --include-unblessed` + flipping `blessed` needs the harvester workflow) and is not part of this plan.
- After the fix, the next scrape writes new keys. `pruneStaleOddsRows` removes the side-less rows, so no DB cleanup is needed.

### Open questions for the owner
1. Confirm D1, so it stays consistent with etoto.
2. Should `TEAM_CORNERS_BOTH_HALVES_OVER` get a team axis (catalog change + `sync-market-types`), so betfan's away line (`-200040`) can be shown?
3. Should `AWAY_TEAM_TOTAL_FOULS` use viewType `STAT_RANGE`? Today `HOME_TEAM_TOTAL_FOULS` is `STAT_RANGE` and `AWAY_TEAM_TOTAL_FOULS` is `PARAMETER_SLIDER` (`src/data/market-catalog.ts:7213`, `:7228`). After Task 2, betfan's two team-fouls lines would render in different widgets, as the peers' already do. The fix belongs to the catalog (catalog + `sync-market-types`), not to this plan.

### Acceptance criteria (live, after the next scrape)
"Live" means after the fix is merged into the checkout the service runs from and a scheduled scrape has completed. Before that, only the standalone smoke test below applies (run it from the worktree).

**Precondition for every team-stat check (P1).** List the next fixtures, then count OPTA team games on the fixture you check (one GET each):
```bash
curl -s --compressed https://betfan.pl/api/v1/market/categories/244/events | python3 -I -c "import json,sys,datetime as t;[print(e['eventId'],t.datetime.fromtimestamp(e['eventStart']/1000,t.timezone.utc).isoformat()[:16],e['eventName']) for e in sorted(json.load(sys.stdin)['data']['categories'][0]['events'],key=lambda e:e['eventStart'])[:3]]"
curl -s --compressed https://betfan.pl/api/v1/market/events/<eventId> | python3 -I -c "import json,sys;g=json.load(sys.stdin)['data']['event']['games'];print(sum(x['gameType'] in (168,169,-200054,-200055,162,163) for x in g))"
```
The second command must print ≥ 1; for Everton v Coventry (40932978) it printed 8 at 17:06Z. If every listed fixture prints 0, the team-stat checks are **INCONCLUSIVE, not PASS**: an empty result makes `betfan_sideless 0` trivially true. Betfan published these lines only on match day in today's sample (0 at T-19.5h and T-22.6h), so re-check on match day.

- **Volume.** Betfan returns 20/20 premier-league fixtures, with ≥ 720 parsed markets per match for the near round and ≥ 75 for later rounds (about 90% of today's minimums, 802 and 82). Read them from the `[Betfan/FullOffer] <Home> vs <Away>: N markets` log lines (`evidence/betfan/backend-log-per-match-counts.txt` has today's).
- **Team-stat sides** (needs P1). Run `python3 -I /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betfan/tools/team-stat-check.py`. Pre-fix baseline (17:07Z): `betfan_sideless 7 betfan_shared 0 betfan_solo 0 betfan_team_total_fouls 1 betfan_home_fouls_matches 0 betfan_away_fouls_matches 0`. The 7 are 6 shot rows plus `TEAM_TOTAL_FOULS:10.5`. Pass after the fix: `betfan_sideless 0`, `betfan_shared ≥ 1`, `betfan_team_total_fouls 0`, and `betfan_home_fouls_matches` and `betfan_away_fouls_matches` each ≥ the number of fixtures whose raw has ids 162 and 163. For the captured Everton v Coventry offer the expected result is `betfan_sideless 0 betfan_shared 6 betfan_solo 0`, and that match gets a `FOULS` line listing both `HOME_TEAM_TOTAL_FOULS` and `AWAY_TEAM_TOTAL_FOULS`. Do not grep for `"AWAY_TEAM_TOTAL_FOULS"`: forbet, fortuna and superbet already fill it today, so the grep matches before the fix too.
- **OTHER share.** In the smoke output (below), `❌ Unmapped/OTHER:` / `Total markets:` ≤ 0.01 (summary at `src/services/audit/scraper-audit-core.ts:644-646`). The captured Everton v Coventry event gives 5/876 before the fix and 4/876 after Task 2 (offline). There are 0 UNKNOWN selections outside OTHER.
- **Price sanity.** `python3 -I /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betfan/tools/odds-sanity.py` checks 1X2 (from `/api/odds?league=premier-league`) and O/U 2.5 (from `normalized-markets?category=GOLE`) against the peer median, with betfan excluded from the median. Pass: `1x2_max ≤ 10` and `ou25_max ≤ 10`. Today it printed `matches 20 1x2_n 60 1x2_max 3.6 1x2_mean 1.5 ou25_n 40 ou25_max 3.4`.
- **Single-bookmaker live smoke test** (needs P1 for the team-stat part). The shape was proven on the current code with `--market "(OPTA)"`: it printed the side-less keys above (`evidence/betfan/smoke-discovery-current-code-2026-11-06.txt`). Use `--all` instead, so that one run (about 21 requests) prints every market's `Market Key:` and the unfiltered summary (`scraper-audit-core.ts:753-767`). The process does not exit after the summary, so wrap it in `timeout`. Run it from the worktree root while the fix is unmerged:
  ```bash
  cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && timeout 240 npx tsx scripts/betfan-market-discovery.ts --url "https://betfan.pl/wydarzenie/<eventId>" --league premier-league --all > "${TMPDIR:-/tmp}/betfan-smoke.txt" 2>&1; echo "exit $?"
  grep -E 'Market Key: (TEAM_TOTAL_SHOTS|TEAM_TOTAL_SHOTS_ON_TARGET|TEAM_TOTAL_FOULS|HOME_TEAM_TOTAL_FOULS|AWAY_TEAM_TOTAL_FOULS):' "${TMPDIR:-/tmp}/betfan-smoke.txt"
  grep -E '^(Total markets|❌ Unmapped/OTHER):' "${TMPDIR:-/tmp}/betfan-smoke.txt"
  sed -n '/^❌ UNMAPPED MARKETS:/,$p' "${TMPDIR:-/tmp}/betfan-smoke.txt" | grep -c 'liczba fauli'
  ```
  Take `<eventId>` from the P1 listing (the next fixture whose P1 count is ≥ 1). Expected after the fix: `exit 124`; `Market Key: TEAM_TOTAL_SHOTS:HOME:<line>` and `…:AWAY:<line>`, the same for `TEAM_TOTAL_SHOTS_ON_TARGET`, plus `HOME_TEAM_TOTAL_FOULS:<line>` and `AWAY_TEAM_TOTAL_FOULS:<line>`; no `Market Key: TEAM_TOTAL_*:<bare line>`; the last command prints `0`; and the OTHER ratio is as above. On the current code the three greps print the 7 side-less keys, `Total markets: 17` / `❌ Unmapped/OTHER: 1` (with `--market "(OPTA)"`), and `1`. The script runs a full league scrape: about 21 requests, about 70 s, no DB writes.

---

## Global Constraints

- Commit messages are concise and descriptive. **No signature or attribution footers** (no "Generated with…", no "Co-Authored-By"). The user rule overrides any reminder.
- Code and comments are in English only.
- Baseline measured 2026-11-06 on the unmodified tree: `npx vitest run` 65 files / 1182 tests passed, and `npx tsc --noEmit` exited 0 with no output. Any other failure after your change is yours.
- Before **each** commit, both must be green: `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api && npx tsc --noEmit` and `npx vitest run`.
- Golden-fixture discipline: write the failing unit test first. Rebless only through `npx tsx scripts/rebless-golden.ts --bookmaker betfan` after a `--dry` run whose changed-entry list matches the task. Here the blessed list is expected to be empty, and the `--include-unblessed --dry` probe must print the count given in each task. Then inspect `git diff`. Never hand-edit expected files.
- Run `npx tsx scripts/sync-market-types.ts` only when `src/data/market-catalog.ts` changes. This plan does not change it: `HOME_/AWAY_TEAM_TOTAL_FOULS` (1107/1108) and `TEAM_TOTAL_SHOTS(_ON_TARGET)` (309/421) already exist in `market_types`.
- Editing anything under `src/` restarts the running dev server (`tsx watch`), and its startup runs a full 14-bookmaker scrape that writes to the DB (`src/services/scheduler-service.ts:150-165`). The main checkout is on `master` and is the one `tsx watch` runs from. **Execute in a separate git worktree on branch `fix/betfan-team-stat-sides`** (superpowers:using-git-worktrees), for example `git worktree add ../aityper-scraper-api-betfan -b fix/betfan-team-stat-sides` and then `npm ci` there. Never edit the live checkout while `tsx watch` is running. Run every repo command in this plan from the worktree root (read a leading `cd /home/skamik/Documents/repositories/personal/aityper-scraper-api` as `cd` to the worktree). Exception: `docs/superpowers/` is untracked, so a fresh worktree does not have the evidence or the check tools. Those are referenced by absolute paths into the main checkout, and the commands only read them. Merge only when the owner agrees.
- Commit only when the user explicitly asks (repo CLAUDE.md). The commit steps below are conditional.

## Review Focus

1. **Both teams quote the same line** (France 4.5 / Morocco 4.5 shots on target, golden #60/#67): they must produce two keys. Pinned in Task 1.
2. **Whole-match totals in the same id family** (`-30242`, `-200194`, `-30243`): they must stay side-less. Pinned in Task 1 (capture test) and Task 2.
3. **CORNERS_TEAM / CARDS_TEAM regression** from touching `TEAM_LINE_PARAM_MARKETS`. Pinned in Task 1: the capture asserts all 10 CORNERS_TEAM keys, and a separate test pins CARDS_TEAM's `AWAY_UNDER`/`AWAY_OVER` vocabulary on golden #294's raw. The capture has no CARDS_TEAM rows, and golden #286-#295 are unblessed.
4. **A team-fouls market whose side cannot be resolved** (a club that is not in the match, e.g. "Arsenal" on Everton v Coventry): it must not be published as HOME. It stays on side-less `TEAM_TOTAL_FOULS` as today. Pinned in Task 2. A made-up name containing "Drużyna" would not exercise this, because `druzyn\w*` is in `MARKET_KEYWORD_PATTERN` (`betfan-normalizer.ts:426-427`) and that segment is skipped before team resolution.
5. **Selection codes with the side in the param**: they must stay plain `OVER`/`UNDER`, not `HOME_OVER` (that is CARDS_TEAM-only vocabulary). Pinned in Task 1.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/services/normalization/bookmakers/betfan-normalizer.ts` | betfan raw → catalog | `TEAM_LINE_PARAM_MARKETS` (`:1401`), id map (`:70`, add `163`), `TEAM_SCOPED_CODE_MAP` (`:478`), O/U selection case list (`:951-981`) |
| `src/services/normalization/bookmakers/__tests__/betfan-recovery-2026-11.test.ts` | regression tests on real 2026-11-06 values | create |
| `src/services/normalization/bookmakers/__tests__/fixtures/betfan-event-40932978-everton-coventry.trimmed.json` | captured raw event (copy of evidence) | create |

---

### Task 1: Side-prefix TEAM_TOTAL_SHOTS and TEAM_TOTAL_SHOTS_ON_TARGET

**Files:**
- Modify: `src/services/normalization/bookmakers/betfan-normalizer.ts:1401`. Add `"TEAM_TOTAL_SHOTS"` and `"TEAM_TOTAL_SHOTS_ON_TARGET"` to `TEAM_LINE_PARAM_MARKETS`, and update the comment above it.
- Create: `src/services/normalization/bookmakers/__tests__/betfan-recovery-2026-11.test.ts`
- Create: `src/services/normalization/bookmakers/__tests__/fixtures/betfan-event-40932978-everton-coventry.trimmed.json`, copied from `/home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betfan/` in the main checkout

**Interfaces:**
- Consumes: `parseAllMarkets(event: BetfanEvent): ScrapedMarket[]` (`src/scrapers/bookmakers/betfan/parser.ts:370`; it reads only `event.games`); `betfanNormalizer.normalizeMarket(raw, ctx)`.
- Produces: the test helper `normalizeCapture(ctx): NormalizedMarketOutput[]`. It builds each raw the way production does (`src/services/normalization/factory.ts:255-259`, `:276-284`): `{ name: m.name, selections: m.selections, paramValue: m.paramValue, bookmakerMarketId: Number(m.bookmakerMarketId) }`, with no `groupName`. Keep `paramValue`: the parser sets it to the player name for split player props (`parser.ts:403-416`). The O/U team lines get their line from the selection names. It then normalizes each raw and drops nulls. Task 2 reuses it.

- [ ] **Step 1: Copy the fixture and write the failing tests**
```bash
mkdir -p src/services/normalization/bookmakers/__tests__/fixtures
cp /home/skamik/Documents/repositories/personal/aityper-scraper-api/docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/betfan/betfan-event-40932978-everton-coventry.trimmed.json src/services/normalization/bookmakers/__tests__/fixtures/
```
Contexts: `ctxEC = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" }`, `ctxFM = { homeTeam: "France", awayTeam: "Morocco", league: "world-cup-2026" }` (the betfan golden `ctx`). Wrap everything in `describe("betfan recovery 2026-11", …)`.

```ts
const keyedBy = (outs: NormalizedMarketOutput[], codes: string[]) => Object.fromEntries(outs
  .filter((o) => codes.includes(o.marketCode)).map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));

it("betfan team shot lines carry the team side (Everton v Coventry capture)", () => {
  expect(keyedBy(normalizeCapture(ctxEC), ["TEAM_TOTAL_SHOTS", "TEAM_TOTAL_SHOTS_ON_TARGET"])).toEqual({
    "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5": [["UNDER", 2.4], ["OVER", 1.5]],
    "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:5.5": [["UNDER", 1.72], ["OVER", 2]],
    "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:2.5": [["UNDER", 2.55], ["OVER", 1.45]],
    "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:3.5": [["UNDER", 1.68], ["OVER", 2.05]],
    "TEAM_TOTAL_SHOTS:HOME:16.5": [["UNDER", 1.85], ["OVER", 1.85]],
    "TEAM_TOTAL_SHOTS:AWAY:11.5": [["UNDER", 1.95], ["OVER", 1.75]],
  });
});

it("betfan whole-match totals and CORNERS_TEAM keys are unchanged", () => {
  const outs = normalizeCapture(ctxEC);
  expect(Object.keys(keyedBy(outs, ["TOTAL_SHOTS", "TOTAL_SHOTS_ON_TARGET", "FOULS_TOTAL"])).sort()).toEqual(
    ["FOULS_TOTAL:22.5", "TOTAL_SHOTS:28.5", "TOTAL_SHOTS_ON_TARGET:7.5", "TOTAL_SHOTS_ON_TARGET:8.5", "TOTAL_SHOTS_ON_TARGET:9.5"]);
  expect(Object.keys(keyedBy(outs, ["CORNERS_TEAM"]))).toEqual([
    "CORNERS_TEAM:HOME:3.5", "CORNERS_TEAM:HOME:4.5", "CORNERS_TEAM:HOME:5.5", "CORNERS_TEAM:HOME:6.5", "CORNERS_TEAM:HOME:7.5",
    "CORNERS_TEAM:AWAY:2.5", "CORNERS_TEAM:AWAY:3.5", "CORNERS_TEAM:AWAY:4.5", "CORNERS_TEAM:AWAY:5.5", "CORNERS_TEAM:AWAY:6.5"]);
});

it("betfan same shots-on-target line for both teams (4.5) stays on two keys", () => {
  const raw = (team: string, u: number, o: number) => ({ bookmakerMarketId: team === "Francja" ? "168" : "169",
    name: `${team} - liczba celnych strzałów na bramkę (OPTA)`,
    selections: [{ name: "Poniżej 4.5", odds: u }, { name: "Powyżej 4.5", odds: o }] });
  const fr = betfanNormalizer.normalizeMarket(raw("Francja", 3, 1.33), ctxFM)!;
  const ma = betfanNormalizer.normalizeMarket(raw("Maroko", 1.25, 3.5), ctxFM)!;
  expect([fr.marketKey, ma.marketKey]).toEqual(["TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5", "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:4.5"]);
});

it("betfan CARDS_TEAM keeps side-prefixed selections", () => {
  const o = betfanNormalizer.normalizeMarket({ bookmakerMarketId: "-200067", name: "Maroko - liczba kartek",
    selections: [{ name: "Poniżej 1.5", odds: 2 }, { name: "Powyżej 1.5", odds: 1.7 }] }, ctxFM)!;
  expect([o.marketKey, o.selections.map((s) => [s.code, s.odds])]).toEqual(
    ["CARDS_TEAM:AWAY:1.5", [["AWAY_UNDER", 2], ["AWAY_OVER", 1.7]]]);
});
```
(Raw shapes copied from golden entries #60/#67 and #294, which carry no `paramValue`; the line comes from the selections.)

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `npx vitest run src/services/normalization/bookmakers/__tests__/betfan-recovery-2026-11.test.ts`
Expected: tests 1 and 3 FAIL with keys like `TEAM_TOTAL_SHOTS:16.5`. Tests 2 and 4 pass, since they guard current behaviour (test 4 was checked on scratch copies of the normalizer, before and after the change).

- [ ] **Step 3: Implement** the two set members.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `npx vitest run src/services/normalization/bookmakers/__tests__/betfan-recovery-2026-11.test.ts src/scrapers/bookmakers/betfan`
Expected: PASS.

- [ ] **Step 5: Golden**
Run: `npx tsx scripts/rebless-golden.ts --bookmaker betfan --dry`
Expected: `{"changedTotal":0,"dry":true}`, because all affected entries are unblessed. Then run the unblessed drift probe (dry, no write): `npx tsx scripts/rebless-golden.ts --bookmaker betfan --include-unblessed --dry`. Expected: `{"changedTotal":64,"dry":true}`. The baseline is 49 on the unmodified tree; the +15 are #60-#68 and #82-#87, each `TEAM_TOTAL_SHOTS(_ON_TARGET):<line>` → `…:HOME:<line>` / `…:AWAY:<line>` (stderr lists their raw names). Any other number means unintended drift: stop and diff. Then run `npx vitest run src/services/normalization/__tests__/golden.test.ts -t betfan`. Expected: PASS, `failures=0`.

- [ ] **Step 6: Full verification**: `npx tsc --noEmit && npx vitest run`. Expected: green.

- [ ] **Step 7: Commit (only after the owner has asked; otherwise stop with the changes staged)**
```bash
git add src/services/normalization/bookmakers/betfan-normalizer.ts src/services/normalization/bookmakers/__tests__/betfan-recovery-2026-11.test.ts src/services/normalization/bookmakers/__tests__/fixtures/betfan-event-40932978-everton-coventry.trimmed.json
git commit -m "fix(betfan): side-prefix team shot lines so they merge with peers and never collide"
```

---

### Task 2: Route team fouls to HOME_/AWAY_TEAM_TOTAL_FOULS and map the away id 163 (decision D1)

**Files:**
- Modify: `betfan-normalizer.ts`. Add `"163": "TEAM_TOTAL_FOULS"` next to `:70`. Add `TEAM_TOTAL_FOULS: { home: "HOME_TEAM_TOTAL_FOULS", away: "AWAY_TEAM_TOTAL_FOULS" }` to `TEAM_SCOPED_CODE_MAP` (`:478`, next to the offsides entries at `:525-529`). This also covers the `FOULS_TOTAL`+side refine at `:721`, which runs before the team-scoped step at `:725-731`. Add `HOME_TEAM_TOTAL_FOULS` and `AWAY_TEAM_TOTAL_FOULS` to the O/U selection case list (`:951-981`).
- Test: `src/services/normalization/bookmakers/__tests__/betfan-recovery-2026-11.test.ts`

**Interfaces:**
- Consumes: `normalizeCapture`, `keyedBy` (Task 1).
- Produces: none. The key shape is `HOME_TEAM_TOTAL_FOULS:<line>`, the same as forbet, fortuna and superbet.

- [ ] **Step 1: Write the failing tests**
```ts
it("betfan team fouls use side-specific codes, away line no longer OTHER (Everton v Coventry capture)", () => {
  const outs = normalizeCapture(ctxEC);
  expect(keyedBy(outs, ["HOME_TEAM_TOTAL_FOULS", "AWAY_TEAM_TOTAL_FOULS", "TEAM_TOTAL_FOULS"])).toEqual({
    "HOME_TEAM_TOTAL_FOULS:10.5": [["UNDER", 2], ["OVER", 1.7]],
    "AWAY_TEAM_TOTAL_FOULS:12.5": [["UNDER", 1.83], ["OVER", 1.83]],
  });
  expect(outs.filter((o) => o.marketCode === "OTHER" && /liczba fauli/.test(o.debug?.rawName ?? ""))).toHaveLength(0);
});

it("betfan team fouls with an unresolvable team stay side-less TEAM_TOTAL_FOULS", () => {
  const out = betfanNormalizer.normalizeMarket({ bookmakerMarketId: "162", name: "Arsenal - liczba fauli (OPTA)",
    selections: [{ name: "Poniżej 10.5", odds: 2 }, { name: "Powyżej 10.5", odds: 1.7 }] }, ctxEC)!;
  expect(out.marketCode).toBe("TEAM_TOTAL_FOULS");
});
```
(`debug.rawName` is set at `betfan-normalizer.ts:1466`. Arsenal is a real club that is not in Everton v Coventry, so the name reaches team resolution and fails it. On scratch copies of the normalizer it gives `TEAM_TOTAL_FOULS:10.5` before and after the change.)
- [ ] **Step 2: Run and confirm they fail**: `npx vitest run src/services/normalization/bookmakers/__tests__/betfan-recovery-2026-11.test.ts -t fouls`. Expected: the first test FAILs (`TEAM_TOTAL_FOULS:10.5`, and Coventry in OTHER). The second passes.
- [ ] **Step 3: Implement** as described in Files.
- [ ] **Step 4: Run and confirm they pass**: same command. Expected: PASS.
- [ ] **Step 5: Golden**: `npx tsx scripts/rebless-golden.ts --bookmaker betfan --dry`. Expected: `{"changedTotal":0,"dry":true}` (entries #92-#95 are unblessed). Unblessed drift probe: `npx tsx scripts/rebless-golden.ts --bookmaker betfan --include-unblessed --dry`. Expected: `{"changedTotal":68,"dry":true}`, which is 64 after Task 1 plus #92/#93 `TEAM_TOTAL_FOULS:11.5/12.5` → `HOME_TEAM_TOTAL_FOULS:…` and #94/#95 `OTHER` → `AWAY_TEAM_TOTAL_FOULS:11.5/12.5`. Any other number means unintended drift. The golden test for `betfan` passes.
- [ ] **Step 6: Full verification**: `npx tsc --noEmit && npx vitest run`.
- [ ] **Step 7: Commit (only after the owner has asked; otherwise stop with the changes staged)**
```bash
git add src/services/normalization/bookmakers/betfan-normalizer.ts src/services/normalization/bookmakers/__tests__/betfan-recovery-2026-11.test.ts
git commit -m "fix(betfan): route team fouls to HOME_/AWAY_TEAM_TOTAL_FOULS and map away id 163"
```

---

## What to monitor
- Betfan `OTHER` count on the match nearest kick-off: 5 today, expected 4 after Task 2 (`-200040` plus 3 combo markets).
- Parsed-vs-saved ratio per run (9555 → 5600 today). A sudden change means a player-market shape change.
- Whether new betfan placeholder ceilings appear: a whole player list at exactly 100, as the free-kick market had today.
- Collision warnings for betfan (`grep 'marketKey collision.*betfan'`): 0 today.

## Self-review
- Spec coverage: shots side → Task 1, fouls side + away id → Task 2. `-200040` and the combo markets are open or no-change. The free-kick "loss" is explained as a bookmaker placeholder.
- Types: `normalizeCapture` and `keyedBy` are defined in Task 1 and reused in Task 2.
- Review Focus 1–5 are pinned in Tasks 1–2.
- D1 matches `etoto.md` Task 2.
- Live team-stat checks carry precondition P1, so a day without betfan OPTA team lines reads INCONCLUSIVE, not PASS. The pre-fix baselines (`betfan_sideless 7`, unblessed probe 49) are recorded, so pre-fix and post-fix results can be told apart.
- Work happens in a worktree on `fix/betfan-team-stat-sides`, never in the live `tsx watch` checkout on `master`.
