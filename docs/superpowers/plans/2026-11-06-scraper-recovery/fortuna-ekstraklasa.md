# Fortuna Ekstraklasa Tournament Id (Follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** done on 2026-11-13 in the final-review fix wave. The probe (`evidence/fortuna/tournament-probe-ekstraklasa.txt`) found `ufo:tour:00-0b9` answering HTTP 404 "Structure with id ufo:tour:00-0b9 not found", and exactly one candidate, `ufo:tour:00-05k` "Ekstraklasa Polska", listing 9 fixtures of the 2026-11-20..23 round, the same 9 totalbet lists in the same run. Both copies now hold `00-05k`, pinned by `src/scrapers/bookmakers/fortuna/__tests__/tournament-ids.test.ts`. Task 2 results: `evidence/fortuna/smoke-ekstraklasa-fortuna.txt` (smoke and WIN_OR_WIN_BY_2 replay pass; player keys and digit labels NOT RUN, no full-offer match yet). Open, outside this plan: the shared team matcher saves Fortuna's "Wisła Kraków" as "Cracovia Krakow" (not in the roster). Recorded on 2026-11-13 by the review of fortuna.md Task 7, which only verifies and so cannot change the id. It is out of fortuna.md's scope. [EXECUTION.md](EXECUTION.md) applies in full: worktree only, `bin/heavy` (with `--live` for the probe and the smokes), no DB, no server.

**Goal:** Make Fortuna list Ekstraklasa again. Rediscover its tournament id with a read-only live probe, replace the stale id behind a failing test, then re-run fortuna.md Task 7 Step 2b for Ekstraklasa.

**Architecture:** Data-only change. The id is held twice: `TOURNAMENT_IDS.ekstraklasa` in `src/scrapers/bookmakers/fortuna/constants.ts:47` (read by `fetchLeagueData`, `src/scrapers/bookmakers/fortuna/navigation.ts:220`) and `LEAGUES[ekstraklasa].bookmakers.fortuna.id` in `src/config/leagues.ts:26` (read by `isLeagueSupported` and `getBookmakerLeagueId`). Both must change together. No parser, normalizer or catalog change.

**Tech Stack:** TypeScript (ESM, Node 20), Vitest, tsx, Playwright (probe only).

## Observations

- Both copies of the id are `ufo:tour:00-0b9`, unchanged since `603365d` (2026-01-06).
- `fetchLeagueData` fetches `${API_STRUCTURE_URL}/prematch/tournament/<id>/fixtures` inside the page (`navigation.ts:234-241`). An empty `fixtures` array, a non-JSON body or a thrown fetch all end as `null` or `[]`, with no HTTP status logged. `scrapeFullOffer` then returns `success:false`, `error: "No fixtures found from API"` (`src/scrapers/bookmakers/fortuna/index.ts:283-291`). So the logs cannot tell an unknown id (for example HTTP 404) from a tournament with no listed round.
- Fortuna answered that way twice. The first answer was the fortuna Task 2 review's Step 2b capture; the second was fortuna Task 7 Step 2b. Both captures are gitignored worktree scratch, quoted verbatim here:
  - `{"success":false,"error":"No fixtures found from API","capturedAt":"2026-11-07T00:39:14.619Z","matches":[]}`
  - `{"success":false,"error":"No fixtures found from API","capturedAt":"2026-11-13T15:56:28.923Z","matches":[]}`
- In the same windows the schedule was not empty:
  - totalbet listed 7 Ekstraklasa fixtures at 2026-11-07T01:25Z (`evidence/totalbet/acceptance-2026-11-07.txt:687`).
  - On 2026-11-13 Fortuna's other four leagues listed their full next round (18-20 fixtures each, fortuna Task 7 Step 2b).
  - So the empty answer is very likely a stale tournament id, not a gap in the schedule.
- `LEAGUE_URLS.ekstraklasa` (`constants.ts:27-28`, `.../pilka-nozna/polska-ekstraklasa`) has a different shape from the other leagues (`.../<country>/1-<country>`). The map is reference only, not read by the scraper, but its page is the natural start for the probe.
- No runtime effect today: the scheduler scrapes only `CONFIG.ENABLED_LEAGUES`, which is `['premier-league']` (`src/config/index.ts:47-49`). Once Ekstraklasa is enabled, Fortuna will be missing from it, logged only as one generic failure per run. This plan must land before that.

## Global Constraints

- Code and comments in English. Commit messages are concise, with no signature or `Co-Authored-By` footer.
- Odds integrity first. A wrong tournament id is worse than none: it could list another competition (Ekstraklasa women, I liga, Puchar Polski) under Ekstraklasa slugs. If the probe cannot show that the new id lists exactly the Ekstraklasa round a peer lists, change nothing and report.
- Live traffic: one discovery probe, then one smoke for the acceptance, each under `bin/heavy --live`, one at a time.
- Run `npx vitest run src/scrapers/bookmakers/fortuna` during TDD, then the full `npx vitest run` and `npx tsc --noEmit` once, all through `bin/heavy`.

---

### Task 0: Discovery probe (read-only, no code change)

**Files:**
- Create: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/tournament-probe.mts`
- Create: `docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/tournament-probe-ekstraklasa.txt` (its output)

- [x] **Step 1: Write the probe.** It opens one Playwright page on `BASE_URL`, as `navigateToBaseSite` does, so the API calls carry the site session. Then it prints:
  1. The HTTP status and the `fixtures` count of `${API_STRUCTURE_URL}/prematch/tournament/ufo:tour:00-0b9/fixtures`. This tells an unknown id (4xx) from an empty one (200 with 0 fixtures).
  2. Every distinct `ufo:tour:` id seen in request URLs and JSON responses under `api.efortuna.pl/offer/structure/`, while the page loads `LEAGUE_URLS.ekstraklasa`. If that URL redirects or 404s, the probe starts from the football section and follows the Poland / Ekstraklasa link. Each id is printed with the tournament name the payload gives it, when the payload has one.
  3. For each candidate id: the HTTP status, the fixture count, and the first five fixtures' team names and kick-off times from `/prematch/tournament/<id>/fixtures`.

  It writes nothing outside the evidence file, and it never calls the markets API.
- [x] **Step 2: Run it once.**

```bash
bin/heavy --live node_modules/.bin/tsx $E/tournament-probe.mts > $E/tournament-probe-ekstraklasa.txt
```

Expected: exactly one candidate whose name is the men's top division (Ekstraklasa) and whose fixtures are Ekstraklasa clubs. Its fixture count must be within 1 of a peer's listing in the same hour (totalbet `ae7d4621-313d-4df6-b3be-046b76a32938` or sts `46`, `src/config/leagues.ts:25-33`), and the old id must still answer empty.

Stop conditions:
- If the old id lists fixtures at the same time, the earlier answers were schedule gaps. Close this plan with no code change, and mark it closed in this file with the probe output.
- If more than one candidate fits, or the fixture teams do not match the peer's round, change nothing and report the probe output to the owner.

### Task 1: Replace the stale id behind a failing test

**Files:**
- Create: `src/scrapers/bookmakers/fortuna/__tests__/tournament-ids.test.ts`
- Modify: `src/scrapers/bookmakers/fortuna/constants.ts:47`
- Modify: `src/config/leagues.ts:26`

- [x] **Step 1: Write the failing test.** It has two cases:
  - `TOURNAMENT_IDS.ekstraklasa` equals the id from Task 0.
  - For every slug in `TOURNAMENT_IDS`, `getBookmakerLeagueId(slug, "fortuna")` returns the same id, and every slug that `getSupportedLeagues("fortuna")` lists has an entry. This pins the two copies together, so they cannot drift apart again.
- [x] **Step 2: Run it and watch it fail.** Use `bin/heavy npx vitest run src/scrapers/bookmakers/fortuna`. The first case fails on `ufo:tour:00-0b9`.
- [x] **Step 3: Change both copies** to the new id, and update the comment `Found via network inspection` with the probe date. Then rerun Step 2; it passes.
- [x] **Step 4:** Run `bin/heavy npx tsc --noEmit` and `bin/heavy npx vitest run` once. Golden must be unchanged: the fixtures do not depend on tournament ids.
- [x] **Step 5: Commit** the test, both copies and the Task 0 evidence: `fix(fortuna): refresh the Ekstraklasa tournament id`.

### Task 2: Re-run fortuna.md Task 7 Step 2b for Ekstraklasa

- [x] **Step 1:** Run the Step 2b loop body with `L=ekstraklasa`, one command at a time. The first command uses `bin/heavy --live`; the other two are offline and use `bin/heavy`. Dump to a new file, never over the empty `.scratch/fortuna-ekstraklasa-after.json`:

```bash
D=.scratch/fortuna-ekstraklasa-$(date -u +%Y%m%dT%H%MZ).json
test ! -e "$D" && bin/heavy --live node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna ekstraklasa --dump "$D" --warn-pattern 'without extractable player' | grep '^SMOKE_RESULT'
bin/heavy node_modules/.bin/tsx $E/smoke-full-offer.mts fortuna ekstraklasa WIN_OR_WIN_BY_2 --from "$D" --warn-pattern 'WIN_OR_WIN_BY_2: could not resolve' | grep '^SMOKE_RESULT'
bin/heavy node_modules/.bin/tsx $E/replay-player-keys.mts "$D" ekstraklasa --mononym <a name from its mononyms: lines>
```

Expected:
- **Smoke:** exit 0, `success:true`, `matches` within 1 of the peer count from Task 0, and `warnPatternCount` 0.
- **`WIN_OR_WIN_BY_2` replay:** `requiredCodeMatchCounts.WIN_OR_WIN_BY_2` equals `matches`, with `warnPatternCount` 0. A warning here means an Ekstraklasa team label did not resolve. That is an alias gap in the team matcher, not an id problem, so fix it there, test first.
- **Player-key replay:** the `RESULT` values of fortuna.md Task 7 Step 2 (`bare`, `leak`, `labelLeak`, `sharedTeamToken`, `collisions` and `warnNoPlayer` all 0). If no full-offer match is listed yet, record `verdict` `NOT RUN`, never PASS.
- **Digit labels:** when the dump has a full-offer match, run the exact-goals probe of fortuna.md Task 7 Step 2 (Task 7 review amendment) on `"$D"`. Its verdict must be `PASS`.

- [x] **Step 2:** Append the `SMOKE_RESULT` lines to `$E/smoke-ekstraklasa-fortuna.txt`, each under a `#` line with the command, the UTC time and the exit code. Commit it: `docs(fortuna): record Ekstraklasa smoke results`.

## Out of scope

- Enabling Ekstraklasa in `CONFIG.ENABLED_LEAGUES`. That is an owner decision, and it changes every bookmaker's run.
- Logging the HTTP status inside `fetchLeagueData`. It would have shown this problem sooner, but it is a scraper-observability change that belongs with observability.md.
