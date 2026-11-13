import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { stripScrapedAt, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
import { createScrapeBudget } from "../../../shared/budget.js";
import { isIncrementalScraper } from "../../../shared/incremental/incremental-scraper.js";
import { SuperbetHttpScraper } from "../http-scraper.js";
import { buildSuperbetListingUrl } from "../navigation.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/http-migration/${n}`, import.meta.url), "utf8");
const API = "https://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL";
const DETAIL_URL = (id: number) => `${API}/events/${id}`;
const LEAGUE = "premier-league";
const budget = () => createScrapeBudget(10_000);

function routes(listing = fx("by-date-premier-league.json")): ReplayRoutes {
  return {
    [buildSuperbetListingUrl("106", new Date())]: { body: listing },
    [DETAIL_URL(14438716)]: { body: fx("event-14438716.json") },
    [DETAIL_URL(14656301)]: { body: fx("event-14656301.json") },
    [DETAIL_URL(14438722)]: { status: 500, body: "upstream" },
  };
}
const scraper = (r: ReplayRoutes = routes()) => new SuperbetHttpScraper(createReplayHttpClient(r));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("superbet as IncrementalScraper", () => {
  it("is incremental-capable with detail concurrency 4", () => {
    expect(isIncrementalScraper(scraper())).toBe(true);
    expect(scraper().detailConcurrency).toBe(4);
  });

  it("superbet refs", async () => {
    const refs = await scraper().listEvents(LEAGUE, budget());
    // Kickoff order; the synthetic FINISHED 14438720 is dropped
    expect(refs.map((r) => r.eventId)).toEqual(["14438722", "14438716", "14656301"]);
    expect(refs[0].kickoff).toBe("2026-11-07T12:30:00.000Z");
    for (const r of refs) expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    const body = JSON.parse(fx("by-date-premier-league.json"));
    const leeds = body.data.find((e: { eventId: number }) => e.eventId === 14438722);
    expect(leeds.odds[0].price).toBe(2.77);
    leeds.odds[0].price = 2.8;
    const changed = await scraper(routes(JSON.stringify(body))).listEvents(LEAGUE, budget());
    expect(changed.map((r, i) => r.fingerprint === refs[i].fingerprint)).toEqual([false, true, true]);
  });

  it("fetchEvent over every ref equals the full pass", async () => {
    const s = scraper();
    const refs = await s.listEvents(LEAGUE, budget());
    const settled = await Promise.allSettled(refs.map((r) => s.fetchEvent(LEAGUE, r, budget())));
    const perEvent = settled.flatMap((r) => (r.status === "fulfilled" && r.value !== null ? [r.value] : []));
    const full = await scraper().scrapeFullOffer(LEAGUE, budget());
    expect(full.matches.map((m) => m.matchId)).toEqual(["14438716", "14656301"]);
    expect(stripScrapedAt(perEvent)).toEqual(stripScrapedAt(full.matches));
    for (const r of refs.slice(1)) {
      const o = full.matches.find((m) => m.matchId === r.eventId)!;
      expect([r.homeTeam, r.awayTeam]).toEqual([o.homeTeam, o.awayTeam]);
    }
  });

  it("kickoff is UTC: an offset-less utcDate is read as UTC, never matchDate (Review Focus 2)", async () => {
    const body = JSON.parse(fx("by-date-premier-league.json"));
    const leeds = body.data.find((e: { eventId: number }) => e.eventId === 14438722);
    leeds.utcDate = "2026-11-07 12:30:00";
    const arsenal = body.data.find((e: { eventId: number }) => e.eventId === 14438716);
    delete arsenal.utcDate;
    const refs = await scraper(routes(JSON.stringify(body))).listEvents(LEAGUE, budget());
    expect(refs.slice(0, 2).map((r) => r.kickoff)).toEqual(["2026-11-07T12:30:00.000Z", "2026-11-07T15:00:00.000Z"]);
  });
});
