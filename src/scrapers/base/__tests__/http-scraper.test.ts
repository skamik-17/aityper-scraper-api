import { describe, it, expect, vi } from "vitest";
import { HttpScraper } from "../http-scraper.js";
import { DEFAULT_MAX_DURATION_MS, hasTransportStats } from "../../shared/scraper-contract.js";
import { createScrapeBudget, BudgetExceededError, type ScrapeBudget } from "../../shared/budget.js";
import type { HttpClient } from "../../shared/http/http-client.js";
import { createReplayHttpClient } from "../../../__tests__/helpers/replay-http.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";

const offer = (id: string): FullMatchOffer => ({
  matchId: id,
  bookmaker: "fortuna",
  homeTeam: "Arsenal",
  awayTeam: "Hull City",
  eventUrl: `https://x.test/${id}`,
  markets: [],
  scrapedAt: new Date(0),
});
type Impl = (
  league: string,
  budget: ScrapeBudget,
  http: HttpClient,
) => Promise<{ matches: FullMatchOffer[]; skipped: Array<{ id: string; error: string }> }>;

class TestScraper extends HttpScraper {
  readonly bookmaker = "fortuna" as const;
  constructor(
    http: HttpClient,
    private readonly impl: Impl,
  ) {
    super(http);
  }
  protected isLeagueSupported(l: string) {
    return l === "premier-league";
  }
  protected fetchFullOffer(l: string, b: ScrapeBudget) {
    return this.impl(l, b, this.http);
  }
}

const skip = (n: number, error: string) => Array.from({ length: n }, (_, i) => ({ id: String(i), error }));
const run = (impl: Impl, budget?: ScrapeBudget, http: HttpClient = createReplayHttpClient({})) =>
  new TestScraper(http, impl).scrapeFullOffer("premier-league", budget);

describe("HttpScraper template", () => {
  it("unknown league", async () => {
    const impl = vi.fn();
    expect(await new TestScraper(createReplayHttpClient({}), impl).scrapeFullOffer("la-liga")).toMatchObject({
      success: false,
      bookmaker: "fortuna",
      league: "la-liga",
      matches: [],
      error: "Unknown league: la-liga",
      duration: expect.any(Number),
    });
    expect(impl).not.toHaveBeenCalled();
  });

  it("a listing HttpError becomes the error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const http = createReplayHttpClient({ "https://api.test/list": { status: 503, body: "" } });
    expect(
      await run(
        async (_l, _b, h) => {
          await h.getJson("https://api.test/list");
          return { matches: [], skipped: [] };
        },
        undefined,
        http,
      ),
    ).toMatchObject({ success: false, matches: [], error: "fetch HTTP 503 https://api.test/list" });
  });

  it("fails when more than half the details failed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await run(async () => ({ matches: [offer("a"), offer("b")], skipped: skip(3, "fetch HTTP 500 https://api.test/e/1") }))).toMatchObject({
      success: false,
      matches: [],
      error: "3 of 5 details failed | fetch HTTP 500 https://api.test/e/1",
    });
  });

  it("succeeds at exactly half, keeping the cause", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await run(async () => ({ matches: [offer("a"), offer("b")], skipped: skip(2, "fetch timeout 10000ms https://api.test/e/1") }));
    expect(r).toMatchObject({ success: true, error: "2 of 4 details failed | fetch timeout 10000ms https://api.test/e/1" });
    expect(r.matches).toHaveLength(2);
  });

  it("clean success has no error key; empty listing is an empty success", async () => {
    const r = await run(async () => ({ matches: [offer("a")], skipped: [] }));
    expect(r).toMatchObject({ success: true, league: "premier-league" });
    expect("error" in r).toBe(false);
    expect(await run(async () => ({ matches: [], skipped: [] }))).toMatchObject({ success: true, matches: [] });
  });

  it("default budget is DEFAULT_MAX_DURATION_MS.http; a given budget is forwarded", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(0);
    let seen!: ScrapeBudget;
    await run(async (_l, b) => {
      seen = b;
      return { matches: [], skipped: [] };
    });
    expect(seen.deadline).toBe(120_000);
    expect(DEFAULT_MAX_DURATION_MS).toEqual({ http: 120_000, websocket: 120_000, browser: 240_000 });
    const mine = createScrapeBudget(5_000);
    await run(async (_l, b) => {
      seen = b;
      return { matches: [], skipped: [] };
    }, mine);
    expect(seen).toBe(mine);
    vi.useRealTimers();
  });

  it("budget exhaustion and parser crashes surface their message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      (
        await run(async () => {
          throw new BudgetExceededError("scrape budget of 120000ms exceeded");
        })
      ).error,
    ).toBe("scrape budget of 120000ms exceeded");
    expect(
      (
        await run(async () => {
          throw new TypeError("x is undefined");
        })
      ).error,
    ).toBe("x is undefined");
  });

  it("transportStats returns a cumulative copy of the client stats; cleanup is a no-op", async () => {
    const http = createReplayHttpClient({ "https://api.test/l": { body: "{}" } });
    const s = new TestScraper(http, async (_l, _b, h) => {
      await h.getJson("https://api.test/l");
      return { matches: [], skipped: [] };
    });
    await s.scrapeFullOffer("premier-league");
    expect(hasTransportStats(s)).toBe(true);
    expect(s.transportStats()).toEqual({ http: http.stats });
    expect(s.transportStats().http).not.toBe(http.stats);
    await s.scrapeFullOffer("premier-league");
    expect(s.transportStats().http!.requests).toBe(2); // never reset between scrapes (README §3)
    await expect(s.cleanup()).resolves.toBeUndefined();
  });

  it("declares the http transport for plan 07's job classification", () =>
    expect(new TestScraper(createReplayHttpClient({}), async () => ({ matches: [], skipped: [] })).transport).toBe("http"));
});
