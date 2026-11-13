import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { stripScrapedAt, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
import { createScrapeBudget } from "../../../shared/budget.js";
import { isIncrementalScraper } from "../../../shared/incremental/incremental-scraper.js";
import { LVBetHttpScraper } from "../http-scraper.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const API = "https://offer.lvbet.pl/client-api/v5";
const LISTING_URL = `${API}/matches/competition-view/?sports_groups_ids=37685&lang=pl`;
const SEARCH_URL = (id: string) => `${API}/markets/search/?matches_ids=${id}&lang=pl`;
const ROUTES: ReplayRoutes = {
  [LISTING_URL]: { body: fx("http-migration/competition-view-premier-league.json") },
  [SEARCH_URL("bc:31340648")]: { body: fx("http-migration/markets-bc_31340648.json") },
  [SEARCH_URL("bc:31419246")]: { status: 500, body: '{"detail":"upstream"}' },
  [SEARCH_URL("bc:31333515")]: { body: fx("markets-search-arsenal-hull-2026-11-06.json") },
};
const LEAGUE = "premier-league";
const budget = () => createScrapeBudget(10_000);
const scraper = (r: ReplayRoutes = ROUTES) => new LVBetHttpScraper(createReplayHttpClient(r));
const withPrimary = (body = fx("incremental/competition-view-with-primary.json")): ReplayRoutes => ({ [LISTING_URL]: { body } });

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("lvbet as IncrementalScraper", () => {
  it("is incremental-capable with detail concurrency 4", () => {
    expect(isIncrementalScraper(scraper())).toBe(true);
    expect(scraper().detailConcurrency).toBe(4);
  });

  it("lvbet refs", async () => {
    const refs = await scraper(withPrimary()).listEvents(LEAGUE, budget());
    expect(refs.map((r) => r.eventId)).toEqual(["bc:31340648", "bc:31340666", "bc:31419246"]);
    expect(refs[0].kickoff).toBe("2026-11-08T14:00:00.000Z");
    for (const r of refs) expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    const body = JSON.parse(fx("incremental/competition-view-with-primary.json"));
    const first = body.primary_column_markets.find((p: { match_id: string }) => p.match_id === "bc:31340648");
    expect(first.selections[0].rate.decimal).toBe(3.95);
    first.selections[0].rate.decimal = 4.0;
    const changed = await scraper(withPrimary(JSON.stringify(body))).listEvents(LEAGUE, budget());
    expect(changed.map((r, i) => r.fingerprint === refs[i].fingerprint)).toEqual([false, true, true]);
  });

  it("fetchEvent over every ref equals the full pass", async () => {
    const s = scraper();
    const refs = await s.listEvents(LEAGUE, budget());
    const settled = await Promise.allSettled(refs.map((r) => s.fetchEvent(LEAGUE, r, budget())));
    const perEvent = settled.flatMap((r) => (r.status === "fulfilled" && r.value !== null ? [r.value] : []));
    const full = await scraper().scrapeFullOffer(LEAGUE, budget());
    expect(full.matches.length).toBe(2);
    expect(stripScrapedAt(perEvent)).toEqual(stripScrapedAt(full.matches));
    for (const o of full.matches) {
      const r = refs.find((x) => x.eventId === o.matchId)!;
      expect([r.homeTeam, r.awayTeam]).toEqual([o.homeTeam, o.awayTeam]);
    }
  });
});
