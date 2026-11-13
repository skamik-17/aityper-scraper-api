/**
 * Plan 10 Task 6: the /rest/market brands implement IncrementalScraper. Their full
 * pass is listEvents + fetchEvent, so the per-event path equals the full pass.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { createScrapeBudget } from "../../budget.js";
import { isIncrementalScraper, transportTotals } from "../../incremental/incremental-scraper.js";
import { BetfanHttpScraper } from "../brands/betfan.js";
import { ETOTO_REST_MARKET, EtotoHttpScraper } from "../brands/etoto.js";
import { ForbetHttpScraper } from "../brands/forbet.js";
import { FuksiarzHttpScraper } from "../brands/fuksiarz.js";
import type { RestMarketHttpScraper } from "../rest-market-scraper.js";
import { loadFixtureRoutes, withoutScrapedAt, type RestMarketBrandDir, type ReplayRoutes } from "./offline-harness.js";

const LEAGUE = "premier-league";
const URLS: Record<RestMarketBrandDir, { list: string; detail: (id: string) => string }> = {
  forbet: {
    list: "https://www.iforbet.pl/rest/market/categories/multi/199/events?gamesClass=major",
    detail: (id) => `https://www.iforbet.pl/rest/market/events/${id}`,
  },
  etoto: {
    list: "https://api.etoto.pl/rest/market/categories/multi/206/events",
    detail: (id) => `https://api.etoto.pl/rest/market/events/${id}`,
  },
  fuksiarz: {
    list: "https://fuksiarz.pl/rest/market/categories/multi/625/events",
    detail: (id) => `https://fuksiarz.pl/rest/market/events/${id}`,
  },
  betfan: {
    list: "https://betfan.pl/api/v1/market/categories/244/events",
    detail: (id) => `https://betfan.pl/api/v1/market/events/${id}`,
  },
};
const CTORS = { forbet: ForbetHttpScraper, etoto: EtotoHttpScraper, fuksiarz: FuksiarzHttpScraper, betfan: BetfanHttpScraper };

const scraperFor = (dir: RestMarketBrandDir, routes: ReplayRoutes = loadFixtureRoutes(dir, URLS[dir])) =>
  new CTORS[dir](createReplayHttpClient(routes)) as RestMarketHttpScraper<unknown>;
const budget = () => createScrapeBudget(10_000);
const listJson = (dir: RestMarketBrandDir) => readFileSync(new URL(`./fixtures/${dir}/list.json`, import.meta.url), "utf8");

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("rest-market brands as IncrementalScraper", () => {
  it("every brand is incremental-capable with detail concurrency 4", () => {
    for (const dir of Object.keys(CTORS) as RestMarketBrandDir[]) {
      const s = scraperFor(dir);
      expect(isIncrementalScraper(s)).toBe(true);
      expect(s.detailConcurrency).toBe(4);
    }
  });

  it("forbet listing refs", async () => {
    const refs = await scraperFor("forbet").listEvents(LEAGUE, budget());
    expect(refs.map((r) => [r.eventId, r.kickoff])).toEqual([
      ["57945888", "2026-11-07T12:30:00.000Z"],
      ["57945911", "2026-11-07T15:00:00.000Z"],
      ["57945945", "2026-11-07T15:00:00.000Z"],
    ]);
    for (const r of refs) expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("fuksiarz and betfan first refs", async () => {
    expect((await scraperFor("fuksiarz").listEvents(LEAGUE, budget()))[0]).toMatchObject({ eventId: "23464740", kickoff: "2026-11-07T12:30:00.000Z" });
    expect((await scraperFor("betfan").listEvents(LEAGUE, budget()))[0]).toMatchObject({ eventId: "40932985", kickoff: "2026-11-07T12:30:00.000Z" });
  });

  it.each(Object.keys(CTORS) as RestMarketBrandDir[])("%s: fetchEvent over every ref equals the full pass", async (dir) => {
    const s = scraperFor(dir);
    const refs = await s.listEvents(LEAGUE, budget());
    const perEvent = (await Promise.all(refs.map((r) => s.fetchEvent(LEAGUE, r, budget())))).filter((o) => o !== null);
    const full = await scraperFor(dir).scrapeFullOffer(LEAGUE, budget());
    expect(full.success).toBe(true);
    expect(full.matches.length).toBeGreaterThan(0);
    expect(perEvent.map(withoutScrapedAt)).toEqual(full.matches.map(withoutScrapedAt));
    // The ref's teams are exactly what the full pass stores
    const offers = new Map(full.matches.map((m) => [m.matchId, m]));
    for (const r of refs) {
      const o = offers.get(r.eventId);
      if (o) expect([r.homeTeam, r.awayTeam]).toEqual([o.homeTeam, o.awayTeam]);
    }
  });

  it("etoto refs equal the full pass's match ids", async () => {
    const refs = await scraperFor("etoto").listEvents(LEAGUE, budget());
    const listed = (JSON.parse(listJson("etoto")).data as Array<{ eventId: number }>)
      .filter((e) => ETOTO_REST_MARKET.isMatch(e as never))
      .map((e) => String(e.eventId));
    expect(refs.map((r) => r.eventId)).toEqual(listed);
    expect(refs.map((r) => r.eventId)).not.toContain("6262615");
  });

  it("fingerprint follows prices only", async () => {
    const base = await scraperFor("forbet").listEvents(LEAGUE, budget());
    const body = JSON.parse(listJson("forbet"));
    const ev = body.data.find((e: { eventId: number }) => e.eventId === 57945888);
    expect(ev.eventGames[0].outcomes[0].outcomeOdds).toBe(2.75);
    ev.eventGames[0].outcomes[0].outcomeOdds = 2.8;
    const routes = loadFixtureRoutes("forbet", URLS.forbet);
    routes[URLS.forbet.list] = { body: JSON.stringify(body) };
    const changed = await scraperFor("forbet", routes).listEvents(LEAGUE, budget());
    expect(changed.map((r) => r.fingerprint === base.find((b) => b.eventId === r.eventId)!.fingerprint)).toEqual([false, true, true]);

    const reversed = JSON.parse(listJson("forbet"));
    reversed.data.reverse();
    routes[URLS.forbet.list] = { body: JSON.stringify(reversed) };
    const fps = new Map((await scraperFor("forbet", routes).listEvents(LEAGUE, budget())).map((r) => [r.eventId, r.fingerprint]));
    for (const r of base) expect(fps.get(r.eventId)).toBe(r.fingerprint);
  });

  it("transportStats counts replayed requests", async () => {
    const s = scraperFor("forbet");
    await s.listEvents(LEAGUE, budget());
    expect(transportTotals(s.transportStats()).requests).toBe(1);
  });
});
