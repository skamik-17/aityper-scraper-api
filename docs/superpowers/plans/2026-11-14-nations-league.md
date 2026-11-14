# UEFA Nations League (Liga Narodów) Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape, store and show odds of the UEFA Nations League 2026/27 from all 14 bookmakers, as a tournament next to the Premier League, with Polish national-team names in the UI.

**Architecture:** The World Cup 2026 wiring (backend commits `2257650`, `4144aa9`, `570ab66`; frontend `isTournament` leagues) is the template. Backend: a `nations-league` league entry with per-bookmaker competition ids, a 54-nation canonical roster from TheSportsDB with a shared Polish-alias table for national teams, TSDB fixture metadata, and the league added to `ENABLED_LEAGUES` so every run scrapes both leagues. Frontend: a tournament league entry (the /ako tree's "Turniej" node) and a display-only Polish name map for national teams.

**Tech Stack:** TypeScript ESM (Node 20, Express, vitest) in `aityper-scraper-api`; Next.js 16 / React 19 (node:test via `npx tsx --test`) in `aityper`.

**Spec:** this document's "Design decisions" section (owner request 2026-11-14: "dodaj support dla ligi narodów w naszej aplikacji") plus the research below.

## Research (2026-11-14)

- TheSportsDB: league **`4490`** = "UEFA Nations League", `strCurrentSeason` **`2026-2027`**. `eventsround.php?id=4490&r={1..6}&s=2026-2027` → 26 events per round (league phase, rounds 1–6). Round 5 = 12–14 Nov 2026, **round 6 = 15–17 Nov 2026** (first kick-off 15 Nov 14:00 UTC). Rounds 7 and 125 are empty now (quarter-finals and promotion/relegation play-offs follow in March 2027; their `intRound` values are not published yet).
- 54 nations (TSDB English names, rounds 1, 5, 6): Albania, Andorra, Armenia, Austria, Azerbaijan, Belarus, Belgium, Bosnia-Herzegovina, Bulgaria, Croatia, Cyprus, Czech Republic, Denmark, England, Estonia, Faroe Islands, Finland, France, Georgia, Germany, Gibraltar, Greece, Hungary, Iceland, Ireland, Israel, Italy, Kazakhstan, Kosovo, Latvia, Liechtenstein, Lithuania, Luxembourg, Malta, Moldova, Montenegro, N.Ireland, Netherlands, North Macedonia, Norway, Poland, Portugal, Romania, San Marino, Scotland, Serbia, Slovakia, Slovenia, Spain, Sweden, Switzerland, Turkey, Ukraine, Wales.
- Bookmaker competition ids: Task 0 (read-only live discovery) writes them to `discovery-{a,b,c}.json`; the table "Bookmaker ids" at the end of this plan is filled from those files before Task 2.

## Design decisions

1. League slug **`nations-league`** (season-agnostic like `premier-league`), backend `displayName: "UEFA Nations League"`, `displayNamePl: "Liga Narodów UEFA"`, `country: "Europe"`.
2. Canonical team names = TheSportsDB English names exactly (fixture matching relies on them), incl. `N.Ireland` and `Ireland`.
3. Polish bookmaker names resolve through ONE shared national-team alias table used by both `world-cup-2026` and `nations-league` (today's `WORLD_CUP_ALIASES` becomes `NATIONAL_TEAM_ALIASES`, extended with all 54 UEFA nations and the variants Task 0 records).
4. The league is enabled for scraping (`ENABLED_LEAGUES = ["premier-league", "nations-league"]`); a bookmaker without the competition simply has no entry (as `world-cup-2026` does for Betby).
5. TSDB fixture sync: rounds 1–6 now; knock-out rounds are added when TSDB publishes their `intRound` values (owner follow-up, March 2027).
6. Frontend: a tournament entry (`isTournament: true`, like the World Cup): shown on /ako and match pages, not on /leagues standings pages. National-team names are shown in Polish through a display-only map; keys (match ids, URLs, API calls) keep the canonical English names.
7. Promotions eligibility lists (`src/data/promotions/*.ts`) are NOT changed: whether a promotion covers the Nations League depends on its terms, which nobody verified. Ruling recorded; owner follow-up.

## Global Constraints

- Code and comments in English; UI text in Polish with full diacritics.
- Backend workspace rules: heavy commands through `/home/skamik/Documents/repositories/personal/aityper-scraper-api-worktrees/bin/heavy`; live read-only probes through `heavy --live`, only while `/api/health` shows `currentRun: null` and `nextScrapeAt` ≥ 5 min away; never `npm install`; worktree `.env` keeps the dead Supabase port.
- Commits without attribution footers.
- Phase 1 (Tasks 0–4, backend) must be live before 15 Nov 2026 14:00 UTC.

## Review Focus

1. **A bookmaker splits the competition** (Liga A/B/C/D or groups): one league slug must cover every part, or matches silently go missing for that bookmaker. Pinned by Task 2's per-bookmaker listing test and Task 4's live count (26 matches of round 6 per bookmaker that lists them all).
2. **Ireland vs Northern Ireland, North Macedonia, Bosnia-Herzegovina, Kosovo, Faroe Islands** (abbreviations, two Irelands, "Macedonia" without "North"): a wrong alias merges two fixtures. Pinned by Task 1's matcher tests (each pair resolves to different nations; bare "Irlandia" → Ireland, "Irlandia Płn." → N.Ireland).
3. **A Betby (or other) id that belongs to another season or competition** (the World Cup 2030 trap): pinned by Task 0's date check and Task 4's live run (kick-offs within 15–17 Nov).
4. **Two leagues in one run** (premier-league + nations-league): every bookmaker job walks both leagues; a bookmaker that has no Nations League entry must not fail its premier-league unit. Pinned by Task 3's cycle test.
5. **English canonical names leaking into the Polish UI** ("N.Ireland", "Czech Republic"): pinned by Task 6's display-name tests (every one of the 54 nations has a Polish name).

---

## Phase 1 — backend (`aityper-scraper-api`)

### Task 0: Live discovery of the per-bookmaker competition ids (read-only)

Three research agents (A: sts, fortuna, betclic, superbet, lvbet; B: fuksiarz, betfan, forbet, etoto, totalbet; C: betters, lebull, betcris, pzbuk) write `/tmp/claude-1000/-home-skamik-Documents-repositories-personal-aityper/9e69776a-986f-40ac-9524-b05084af42be/scratchpad/unl/discovery-{a,b,c}.json` with, per bookmaker: the config entry in `leagues.ts` format, whether the competition is split, every id with its listed match count, the raw team strings, and whether code beyond a config entry is needed.

- [ ] **Step 1:** Fill the "Bookmaker ids" table below from the three files; any bookmaker with `needsCode` ≠ `none` gets a ruling and its change folded into Task 2.

### Task 1: National-team roster and shared Polish aliases

**Files:**
- Create: `src/data/nations-league-teams.ts` (54 `CanonicalTeam` entries, same shape as `src/data/world-cup-2026-teams.ts`, `normalized` = team-matcher `normalize()` of the name)
- Modify: `src/data/index.ts` (register `"nations-league"`), `src/utils/team-matcher.ts` (`WORLD_CUP_ALIASES` → `NATIONAL_TEAM_ALIASES`, extended; `LEAGUE_ALIASES["nations-league"] = NATIONAL_TEAM_ALIASES`; add `AMBIGUOUS_NAMES["nations-league"]` for bare "Macedonia"/"Irlandia" only if Task 0 shows a bookmaker sending them ambiguously)
- Test: create `src/utils/__tests__/nations-league-team-matcher.test.ts`; `src/utils/__tests__/world-cup-team-matcher.test.ts` must stay green unchanged

**Interfaces:**
- Produces: `NATIONS_LEAGUE_TEAMS: CanonicalTeam[]` exported from `src/data/index.ts`; `getCanonicalTeamName(raw, "nations-league")` / `getNormalizedTeamName(raw, "nations-league")` resolving every Polish name below.

- [ ] **Step 1: Write the failing tests**

```ts
const L = "nations-league";
it.each([
  ["Polska", "Poland"], ["Szwecja", "Sweden"], ["Hiszpania", "Spain"], ["Anglia", "England"],
  ["Niemcy", "Germany"], ["Holandia", "Netherlands"], ["Węgry", "Hungary"], ["Irlandia Północna", "N.Ireland"],
  ["Irlandia Płn.", "N.Ireland"], ["Irlandia", "Ireland"], ["Macedonia Północna", "North Macedonia"],
  ["Macedonia Płn.", "North Macedonia"], ["Bośnia i Hercegowina", "Bosnia-Herzegovina"], ["Czechy", "Czech Republic"],
  ["Wyspy Owcze", "Faroe Islands"], ["Kosowo", "Kosovo"], ["Mołdawia", "Moldova"], ["Czarnogóra", "Montenegro"],
  ["Gruzja", "Georgia"], ["Turcja", "Turkey"], ["Walia", "Wales"], ["Szkocja", "Scotland"], ["Białoruś", "Belarus"],
  ["Luksemburg", "Luxembourg"], ["Litwa", "Lithuania"], ["Łotwa", "Latvia"], ["Estonia", "Estonia"],
  ["San Marino", "San Marino"], ["Gibraltar", "Gibraltar"], ["Liechtenstein", "Liechtenstein"], ["Andora", "Andorra"],
  ["Azerbejdżan", "Azerbaijan"], ["Kazachstan", "Kazakhstan"], ["Cypr", "Cyprus"], ["Grecja", "Greece"],
  ["Słowacja", "Slovakia"], ["Słowenia", "Slovenia"], ["Chorwacja", "Croatia"], ["Serbia", "Serbia"],
  ["Rumunia", "Romania"], ["Bułgaria", "Bulgaria"], ["Ukraina", "Ukraine"], ["Dania", "Denmark"], ["Norwegia", "Norway"],
  ["Finlandia", "Finland"], ["Islandia", "Iceland"], ["Izrael", "Israel"], ["Szwajcaria", "Switzerland"],
  ["Austria", "Austria"], ["Belgia", "Belgium"], ["Francja", "France"], ["Włochy", "Italy"], ["Portugalia", "Portugal"],
  ["Albania", "Albania"], ["Armenia", "Armenia"], ["Malta", "Malta"],
])("%s → %s", (raw, canonical) => expect(getCanonicalTeamName(raw, L)).toBe(canonical));
// + every raw string from Task 0's teamNames resolves to a nation in NATIONS_LEAGUE_TEAMS
it("Ireland and Northern Ireland never merge", () => {
  expect(getNormalizedTeamName("Irlandia", L)).not.toBe(getNormalizedTeamName("Irlandia Płn.", L));
});
it("the roster is the 54 TSDB nations", () => expect(NATIONS_LEAGUE_TEAMS.map((t) => t.name).sort()).toEqual(TSDB_54));
```

- [ ] **Step 2:** Run `heavy npx vitest run src/utils/__tests__/nations-league-team-matcher.test.ts` → FAIL (no roster / unresolved names).
- [ ] **Step 3:** Implement as listed under Files.
- [ ] **Step 4:** Run it plus `src/utils/__tests__/world-cup-team-matcher.test.ts` and `team-matcher-*.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(nations-league): 54-nation roster and shared Polish national-team aliases`.

### Task 2: League entry, bookmaker ids and TSDB metadata

**Files:**
- Modify: `src/config/leagues.ts` (append the `nations-league` entry with the Task 0 ids), the `src/scrapers/bookmakers/<bm>/constants.ts` per-league maps that Task 0 marks as needed (the World Cup wiring touched betclic, betcris, betfan, betters, etoto, forbet, fortuna, fuksiarz, lebull, lvbet, pzbuk, superbet, totalbet, sts), `src/data/tsdb-leagues.ts` (`"nations-league": { theSportsDbId: "4490", totalRounds: 6, season: "2026-2027", rounds: [1, 2, 3, 4, 5, 6] }`), and any listing code Task 0 says a split competition needs.
- Test: create `src/config/__tests__/nations-league-config.test.ts`; extend the per-bookmaker listing tests Task 0 points at when code changes.

**Interfaces:**
- Consumes: Task 1 roster/aliases.
- Produces: `getLeagueConfig("nations-league")`, `isLeagueSupported("nations-league", bm)` true for every bookmaker in the table, `getTsdbLeagueMeta("nations-league")`.

- [ ] **Step 1: Write the failing tests**

```ts
it("nations-league maps every bookmaker that lists it, with the discovered ids", () => {
  expect(getLeagueConfig("nations-league")).toMatchObject({ displayNamePl: "Liga Narodów UEFA" });
  expect(Object.fromEntries(CONFIG.BOOKMAKERS.map((bm) => [bm, getBookmakerLeagueId("nations-league", bm) ?? null])))
    .toEqual(EXPECTED_IDS); // the "Bookmaker ids" table, null where a bookmaker does not list it
});
it("TSDB metadata: league 4490, season 2026-2027, rounds 1-6", () =>
  expect(getTsdbLeagueMeta("nations-league")).toEqual({ theSportsDbId: "4490", totalRounds: 6, season: "2026-2027", rounds: [1, 2, 3, 4, 5, 6] }));
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run + `heavy npx vitest run` + `heavy npx tsc --noEmit` → PASS. **Step 5:** Commit `feat(nations-league): league entry, bookmaker competition ids and TSDB metadata`.

### Task 3: Enable the league for scraping

**Files:**
- Modify: `src/config/index.ts` (`ENABLED_LEAGUES: ["premier-league", "nations-league"]`), `.env.example` comment if it lists leagues.
- Test: extend `src/scrapers/__tests__/aggregator-cycle.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it("a two-league cycle: a bookmaker without nations-league keeps its premier-league unit", async () => {
  // bookmakers: one that lists nations-league and one that does not (per the table)
  const r = await runFullOfferCycle({ leagues: ["premier-league", "nations-league"], bookmakers: [LISTED, NOT_LISTED] });
  expect(r.get("premier-league")!.outcomes.map((o) => o.bookmaker)).toEqual([LISTED, NOT_LISTED]);
  expect(r.get("nations-league")!.outcomes.map((o) => o.bookmaker)).toEqual([LISTED]);
});
it("CONFIG.ENABLED_LEAGUES has both leagues", () => expect(CONFIG.ENABLED_LEAGUES).toEqual(["premier-league", "nations-league"]));
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** full suite + tsc PASS. **Step 5:** Commit `feat(nations-league): scrape it every run next to the Premier League`.

### Task 4: Live verification (controller)

- [ ] **Step 1:** Per bookmaker, read-only: `heavy --live npx tsx scripts/smoke-bookmaker.ts --bookmaker <bm> --league nations-league` (no `--persist`). Pass: success with the round-6 matches it lists (26 where the bookmaker lists all), no unresolved team names.
- [ ] **Step 2:** Release (fast-forward master, `tsx watch` restarts), then `POST /api/admin/scrape {"league":"nations-league"}`. Pass: `[ScrapeRun] nations-league … ok=N/N`; `/api/odds?league=nations-league` lists the round-6 matches with ≥ 10 bookmakers on MATCH_WINNER for the big fixtures; `/api/matches/Poland/Sweden/normalized-markets?league=nations-league` returns 200; `scripts/compare-odds-models.ts` exit 0.
- [ ] **Step 3:** TSDB sync: the server's 04:00 job or `syncStaleLeagues` caches the 6 rounds (`/api/fixtures?league=nations-league` non-empty).

## Phase 2 — frontend (`aityper`)

### Task 5: Tournament league entry

**Files:**
- Modify: `src/lib/config/leagues.ts` (entry below), any league list the tests pin (e.g. `src/components/ako/match-list/match-list.test.ts`).
- Test: extend the existing league-tree / config tests (`src/lib/config/*.test.ts`) or create `src/lib/config/nations-league.test.ts`.

```ts
"nations-league": {
  slug: "nations-league", name: "Liga Narodów", shortName: "L. Narodów", fullName: "Liga Narodów UEFA",
  country: "Europa", countryCode: "EU", theSportsDbId: "4490", totalRounds: 6, teams: 54,
  hasWinterBreak: false, status: "active", description: "Rozgrywki reprezentacji narodowych UEFA", isTournament: true,
},
```

- [ ] **Step 1:** Test: `buildCountryTree()` has a `tournament:nations-league` node named "Liga Narodów"; `getLeagueConfig("nations-league")?.isTournament === true`; `shortName.length <= 11`. **Step 2:** FAIL. **Step 3:** Add the entry. **Step 4:** PASS + `npx tsc --noEmit` + all node tests. **Step 5:** Commit `feat(nations-league): Liga Narodów as a tournament on /ako`.

### Task 6: Polish display names for national teams

**Files:**
- Create: `src/lib/team-names.ts` exporting `displayTeamName(name: string): string` (canonical English national-team name → Polish; every other name unchanged) and `NATIONAL_TEAM_NAMES_PL: Readonly<Record<string, string>>` covering the 54 Nations League nations and the 48 World Cup nations.
- Modify: the display sites only (never keys, URLs or API arguments): `src/components/ako/match/match-header.tsx`, `src/components/ako/match-list/fixture-row.tsx`, `src/components/ako/coupon-item.tsx`, `src/components/ako/coupon-panel.tsx`, `src/components/ako/coupon-announcer.tsx`, `src/components/ako/slip/coupon-undo.tsx`, `src/components/ako/bookmaker-comparison.tsx`, `src/components/ako/quick-match-search.tsx` (search matches both names), `src/components/ako/bet-selector.tsx`, `src/components/ako/betting-workspace.tsx`, the match page views under `src/app/leagues/[leagueSlug]/match/`, and page `<title>`/metadata built from team names.
- Test: create `src/lib/team-names.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
test("every Nations League and World Cup nation has a Polish name", () => {
  for (const n of [...NATIONS_LEAGUE_54, ...WORLD_CUP_48]) assert.ok(NATIONAL_TEAM_NAMES_PL[n], n);
});
test("display names", () => {
  assert.equal(displayTeamName("Poland"), "Polska");
  assert.equal(displayTeamName("N.Ireland"), "Irlandia Północna");
  assert.equal(displayTeamName("Ireland"), "Irlandia");
  assert.equal(displayTeamName("Czech Republic"), "Czechy");
  assert.equal(displayTeamName("Arsenal"), "Arsenal"); // clubs unchanged
});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement the map and wrap each display site's rendered team text with `displayTeamName(...)`; the quick search matches either the canonical or the Polish name. **Step 4:** tests + tsc + eslint (0 errors) + `npm run -s lint:polish` + `next build --webpack` in a temporary worktree. **Step 5:** Commit `feat(ui): Polish names for national teams`.

### Task 7: Live check of the UI (controller)

- [ ] **Step 1:** With the backend from Phase 1 running: `/ako` shows the "Liga Narodów" tournament node with the round-6 matches in Polish ("Polska – Szwecja"), the match page of Poland–Sweden loads the full offer, adding a leg to the coupon shows Polish names. Pages answer 200.

## Bookmaker ids (filled from Task 0)

| Bookmaker | Config entry | Split | Round-6 matches | Code needed |
|---|---|---|---|---|
| (filled from discovery-a/b/c.json) | | | | |
