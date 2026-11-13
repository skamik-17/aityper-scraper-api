import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { stripScrapedAt, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
import { createScrapeBudget } from "../../../shared/budget.js";
import { isIncrementalScraper } from "../../../shared/incremental/incremental-scraper.js";
import { FortunaHttpScraper } from "../http-scraper.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/http-migration/${n}`, import.meta.url), "utf8");
const LISTING_URL = "https://api.efortuna.pl/offer/structure/api/v1_0/prematch/tournament/ufo:tour:00-03m/fixtures";
const MARKETS_URL = (id: string) => `https://api.efortuna.pl/offer/markets/api/v1_0/fixture/${id}/markets`;
const ROUTES: ReplayRoutes = {
  [LISTING_URL]: { body: fx("fixtures-premier-league.json") },
  [MARKETS_URL("ufo:mtch:1xi-0a1")]: { body: fx("markets-arsenal-hull.json") },
  [MARKETS_URL("ufo:mtch:1xi-09z")]: { body: "[]" },
  [MARKETS_URL("ufo:mtch:1xi-0a0")]: { status: 500, body: "upstream" },
};
const LEAGUE = "premier-league";
const budget = () => createScrapeBudget(10_000);
const scraper = () => new FortunaHttpScraper(createReplayHttpClient(ROUTES));

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("fortuna as IncrementalScraper", () => {
  it("is incremental-capable with detail concurrency 4", () => {
    expect(isIncrementalScraper(scraper())).toBe(true);
    expect(scraper().detailConcurrency).toBe(4);
  });

  it("fortuna refs", async () => {
    const refs = await scraper().listEvents(LEAGUE, budget());
    expect(refs.map((r) => [r.eventId, r.kickoff, r.fingerprint])).toEqual([
      ["ufo:mtch:1xi-0a0", "2026-11-07T15:00:00.000Z", null],
      ["ufo:mtch:1xi-0a1", "2026-11-07T15:00:00.000Z", null],
      ["ufo:mtch:1xi-09z", "2026-11-07T12:30:00.000Z", null],
    ]);
  });

  it("fetchEvent over every ref equals the full pass", async () => {
    const s = scraper();
    const refs = await s.listEvents(LEAGUE, budget());
    const settled = await Promise.allSettled(refs.map((r) => s.fetchEvent(LEAGUE, r, budget())));
    const perEvent = settled.flatMap((r) => (r.status === "fulfilled" && r.value !== null ? [r.value] : []));
    expect(settled.map((r) => r.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
    const full = await scraper().scrapeFullOffer(LEAGUE, budget());
    expect(full.matches.map((m) => m.matchId)).toEqual(["ufo:mtch:1xi-0a1"]);
    expect(stripScrapedAt(perEvent)).toEqual(stripScrapedAt(full.matches));
    const arsenal = refs[1];
    expect([arsenal.homeTeam, arsenal.awayTeam]).toEqual([full.matches[0].homeTeam, full.matches[0].awayTeam]);
  });
});
