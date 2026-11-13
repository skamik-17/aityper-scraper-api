import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBookmakerLeagueId } from "../../../../config/leagues.js";
import { browserRuntime } from "../../../base/browser-runtime.js";
import { createScrapeBudget } from "../../budget.js";
import { createHttpClient } from "../../http/http-client.js";
import { restMarketDetail, restMarketListing, type RestMarketBrand } from "../brand.js";
import { RestMarketHttpScraper } from "../rest-market-scraper.js";
import { fetchRestMarketOffer } from "../runner.js";

type Ev = { eventId: number; name: string; games: string[] };
type Route = { status?: number; body: unknown; contentType?: string; headers?: Record<string, string>; delayMs?: number };

const STUB: RestMarketBrand<Ev> = {
  bookmaker: "etoto",
  logTag: "[Stub/FullOffer]",
  listingUrl: (c) => `https://x.test/list/${c}`,
  detailUrl: (id) => `https://x.test/ev/${id}`,
  listingEvents: restMarketListing,
  detailEvent: restMarketDetail,
  isMatch: (e) => e.name !== "combo",
  eventId: (e) => String(e.eventId),
  toOffer: (l, d) =>
    d.games.length === 0
      ? null
      : { matchId: String(d.eventId), bookmaker: "etoto", homeTeam: l.name, awayTeam: "B", eventUrl: `u/${d.eventId}`,
          markets: d.games.map((g) => ({ name: g, selections: [] })), scrapedAt: new Date(0) },
  // Plan 10 brand members (incremental listing); the full-pass assertions below are unchanged
  teamsOf: (e) => ({ homeTeam: e.name, awayTeam: "B" }),
  listingPrices: () => [],
};

const LIST = `https://x.test/list/${getBookmakerLeagueId("premier-league", "etoto")}`;
const ev = (id: number, name = String.fromCharCode(64 + id), games = ["g1"]): Route => ({ body: { data: { eventId: id, name, games } } });

/** fetch() over a URL → route table (404 otherwise); records calls and the peak of in-flight /ev/ requests. */
function fakeFetch(routes: Record<string, Route>) {
  let inFlight = 0;
  const seen = { calls: [] as string[], maxInFlight: 0 };
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    seen.calls.push(url);
    const detail = url.includes("/ev/");
    if (detail) seen.maxInFlight = Math.max(seen.maxInFlight, ++inFlight);
    try {
      const r = routes[url];
      if (r?.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
      if (!r) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      return new Response(text, { status: r.status ?? 200, headers: { "content-type": r.contentType ?? "application/json", ...r.headers } });
    } finally {
      if (detail) inFlight--;
    }
  };
  return Object.assign(impl as unknown as typeof fetch, { seen });
}

const baseRoutes = (): Record<string, Route> => ({
  [LIST]: { body: { data: [{ eventId: 1, name: "A", games: [] }, { eventId: 2, name: "combo", games: [] }, { eventId: 3, name: "C", games: [] }] } },
  "https://x.test/ev/1": ev(1, "A"),
  "https://x.test/ev/3": ev(3, "C"),
});

function run(routes: Record<string, Route>) {
  const f = fakeFetch(routes);
  const p = fetchRestMarketOffer(STUB, createHttpClient({ fetchImpl: f }), "premier-league", createScrapeBudget(5_000));
  return { p, seen: f.seen };
}

const HINT = " | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_ETOTO=browser";
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("fetchRestMarketOffer", () => {
  it("fetches the listing once, then one detail per listed match; skips combos", async () => {
    const { p, seen } = run(baseRoutes());
    const r = await p;
    expect([...seen.calls].sort()).toEqual(["https://x.test/ev/1", "https://x.test/ev/3", LIST].sort());
    expect(r.matches.map((m) => m.matchId)).toEqual(["1", "3"]);
    expect(r.skipped).toEqual([]);
  });

  it("returns matches in listing order when details resolve out of order", async () => {
    const routes = baseRoutes();
    routes["https://x.test/ev/1"] = { ...ev(1, "A"), delayMs: 30 };
    expect((await run(routes).p).matches.map((m) => m.matchId)).toEqual(["1", "3"]);
  });

  it("keeps at most 4 details in flight", async () => {
    const routes: Record<string, Route> = { [LIST]: { body: { data: Array.from({ length: 8 }, (_, i) => ({ eventId: i + 1, name: `T${i}`, games: [] })) } } };
    for (let i = 1; i <= 8; i++) routes[`https://x.test/ev/${i}`] = { ...ev(i, `T${i}`), delayMs: 10 };
    const { p, seen } = run(routes);
    expect((await p).matches).toHaveLength(8);
    expect(seen.maxInFlight).toBe(4);
  });

  it("skips a failed detail instead of falling back to listing data", async () => {
    const routes = baseRoutes();
    routes["https://x.test/ev/3"] = { status: 404, body: "nope", contentType: "text/plain" };
    const r = await run(routes).p;
    expect(r.matches.map((m) => m.matchId)).toEqual(["1"]);
    expect(r.skipped).toEqual([{ id: "3", error: "fetch HTTP 404 https://x.test/ev/3" }]);
  });

  it("skips a detail envelope without data", async () => {
    const routes = baseRoutes();
    routes["https://x.test/ev/3"] = { body: { code: 404, description: "Event not found" } };
    const r = await run(routes).p;
    expect(r.matches.map((m) => m.matchId)).toEqual(["1"]);
    expect(r.skipped[0].error).toBe("detail without event data https://x.test/ev/3");
  });

  it("a detail with no markets yields no offer and no skip", async () => {
    const routes = baseRoutes();
    routes["https://x.test/ev/3"] = ev(3, "C", []);
    const r = await run(routes).p;
    expect(r.matches.map((m) => m.matchId)).toEqual(["1"]);
    expect(r.skipped).toEqual([]);
  });

  it("names the fallback flag on a challenged listing (403)", async () => {
    const routes = baseRoutes();
    routes[LIST] = { status: 403, body: "<html>challenge</html>", contentType: "text/html", headers: { "cf-mitigated": "challenge" } };
    await expect(run(routes).p).rejects.toThrow(`fetch HTTP 403 ${LIST} cf-mitigated=challenge${HINT}`);
  });

  it("names the fallback flag on an HTML listing (200 text/html)", async () => {
    const routes = baseRoutes();
    routes[LIST] = { body: "<html>challenge</html>", contentType: "text/html" };
    await expect(run(routes).p).rejects.toThrow(`fetch non-JSON text/html ${LIST}${HINT}`);
  });

  it("a challenged detail carries the hint into skipped", async () => {
    const routes = baseRoutes();
    routes["https://x.test/ev/3"] = { status: 403, body: "x", contentType: "text/html" };
    const r = await run(routes).p;
    expect(r.skipped).toEqual([{ id: "3", error: `fetch HTTP 403 https://x.test/ev/3${HINT}` }]);
  });

  it("an empty listing is success with no matches", async () => {
    const { p, seen } = run({ [LIST]: { body: { data: [] } } });
    expect(await p).toEqual({ matches: [], skipped: [] });
    expect(seen.calls).toEqual([LIST]);
    expect(warn).toHaveBeenCalledWith(`[Stub/FullOffer] No events found from API ${LIST}`);
  });

  it("a listing without the events array is an error", async () => {
    await expect(run({ [LIST]: { body: { code: 500 } } }).p).rejects.toThrow(`listing without events ${LIST}`);
  });
});

describe("RestMarketHttpScraper", () => {
  const scraperWith = (routes: Record<string, Route>) => new RestMarketHttpScraper(STUB, createHttpClient({ fetchImpl: fakeFetch(routes) }));

  it("fails the run when more than half the details fail", async () => {
    const routes = baseRoutes();
    routes["https://x.test/ev/1"] = { status: 404, body: "x", contentType: "text/plain" };
    routes["https://x.test/ev/3"] = { status: 404, body: "x", contentType: "text/plain" };
    const r = await scraperWith(routes).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, matches: [] });
    expect(r.error).toMatch(/^2 of 2 details failed \| fetch HTTP 404 https:\/\/x\.test\/ev\/[13]$/);
  });

  it("an empty listing is success:true with 0 matches", async () => {
    const r = await scraperWith({ [LIST]: { body: { data: [] } } }).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: true, matches: [] });
    expect(r.error).toBeUndefined();
  });

  it("opens no browser", async () => {
    const openSession = vi.spyOn(browserRuntime, "openSession");
    const r = await scraperWith(baseRoutes()).scrapeFullOffer("premier-league");
    expect(r.success).toBe(true);
    expect(openSession).not.toHaveBeenCalled();
  });

  it("rejects an unsupported league", async () =>
    expect(await scraperWith(baseRoutes()).scrapeFullOffer("no-such-league")).toMatchObject({ success: false }));

  it("declares transport http", () => expect(new RestMarketHttpScraper(STUB).transport).toBe("http"));
});
