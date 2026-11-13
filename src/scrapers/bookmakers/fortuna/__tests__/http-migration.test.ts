import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { captureLogs, envelope, runBrowserPathOffline, stripScrapedAt, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
import { browserPool } from "../../../base/browser-pool.js";
import { FortunaHttpScraper } from "../http-scraper.js";
import { fortunaFixtureMarketsUrl, fortunaFixturesUrl } from "../navigation.js";
import { mapFortunaFixtureOffer, selectFortunaFixtures } from "../full-offer-mapping.js";
import { FortunaPlaywrightScraper } from "../index.js";
import { parseAllMarkets } from "../parser.js";
import type { FortunaFixturesResponse, FortunaMarket } from "../types.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/http-migration/${n}`, import.meta.url), "utf8");
const LISTING_URL = "https://api.efortuna.pl/offer/structure/api/v1_0/prematch/tournament/ufo:tour:00-03m/fixtures";
const MARKETS_URL = (id: string) => `https://api.efortuna.pl/offer/markets/api/v1_0/fixture/${id}/markets`;
const ROUTES: ReplayRoutes = {
  [LISTING_URL]: { body: fx("fixtures-premier-league.json") },
  [MARKETS_URL("ufo:mtch:1xi-0a1")]: { body: fx("markets-arsenal-hull.json") }, // Arsenal–Hull: full offer
  [MARKETS_URL("ufo:mtch:1xi-09z")]: { body: "[]" }, // Leeds–Tottenham: no offer
  [MARKETS_URL("ufo:mtch:1xi-0a0")]: { status: 500, body: "upstream" }, // Fulham–Newcastle: failure
};
const LISTING = JSON.parse(fx("fixtures-premier-league.json")) as FortunaFixturesResponse;
const ARSENAL = LISTING.fixtures.find((f) => f.id === "ufo:mtch:1xi-0a1")!;
const ARSENAL_MARKETS = JSON.parse(fx("markets-arsenal-hull.json")) as FortunaMarket[];
const ARSENAL_ENVELOPE = {
  matchId: "ufo:mtch:1xi-0a1",
  bookmaker: "fortuna",
  homeTeam: "Arsenal",
  awayTeam: "Hull City",
  eventUrl: "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/arsenal-hull-ufo:mtch:1xi-0a1",
  startTime: "2026-11-07T15:00:00.000Z",
};
const parsedArsenal = () => parseAllMarkets(ARSENAL_MARKETS, { homeTeam: "Arsenal", awayTeam: "Hull" });

beforeEach(() => {
  for (const level of ["warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("fortuna browser path (characterization, recorded 2026-11-07)", () => {
  it("returns Arsenal–Hull only: Leeds has no markets, Fulham's markets call fails", async () => {
    const { result, requests } = await runBrowserPathOffline(new FortunaPlaywrightScraper(), "premier-league", ROUTES);
    expect(result.success).toBe(true);
    expect(result.matches.map(envelope)).toEqual([ARSENAL_ENVELOPE]);
    expect(result.matches[0].markets).toEqual(parsedArsenal());
    expect(requests.filter((u) => !u.endsWith("/overview"))).toEqual([
      LISTING_URL, MARKETS_URL("ufo:mtch:1xi-0a0"), MARKETS_URL("ufo:mtch:1xi-0a1"), MARKETS_URL("ufo:mtch:1xi-09z"),
    ]);
  });
});

describe("fortuna full-offer mapping", () => {
  it("maps Arsenal–Hull to the characterized envelope and parser output", () => {
    const offer = mapFortunaFixtureOffer(ARSENAL, ARSENAL_MARKETS, "premier-league")!;
    expect(envelope(offer)).toEqual(ARSENAL_ENVELOPE);
    expect(offer.markets).toEqual(parsedArsenal());
  });

  it("returns null for a fixture without markets", () => expect(mapFortunaFixtureOffer(ARSENAL, [], "premier-league")).toBeNull());

  it("keeps valid fixtures in listing order", () =>
    expect(selectFortunaFixtures(LISTING).map((f) => f.id)).toEqual(["ufo:mtch:1xi-0a0", "ufo:mtch:1xi-0a1", "ufo:mtch:1xi-09z"]));

  it("drops a fixture without team names", () =>
    // synthetic
    expect(selectFortunaFixtures({ fixtures: [{ ...ARSENAL, participants: [], name: "" }] } as FortunaFixturesResponse)).toEqual([]));

  it("logs the per-match line with the raw team names", async () => {
    const { logs } = await captureLogs(async () => mapFortunaFixtureOffer(ARSENAL, ARSENAL_MARKETS, "premier-league"));
    expect(logs).toEqual([`[Fortuna/FullOffer] Arsenal vs Hull: ${parsedArsenal().length} markets`]);
  });
});

const fullOfferLines = (l: string[]) => l.filter((line) => line.startsWith("[Fortuna/FullOffer]"));

describe("FortunaHttpScraper", () => {
  const run = (routes: ReplayRoutes) => new FortunaHttpScraper(createReplayHttpClient(routes)).scrapeFullOffer("premier-league");

  it("URL builders reproduce the browser URLs byte for byte", () => {
    expect(fortunaFixturesUrl("ufo:tour:00-03m")).toBe(LISTING_URL);
    expect(fortunaFixtureMarketsUrl("ufo:mtch:1xi-0a1")).toBe(MARKETS_URL("ufo:mtch:1xi-0a1"));
  });

  it("declares transport http", () => expect(new FortunaHttpScraper().transport).toBe("http"));

  it("contract: deep-equals the browser path; the failed fixture is reported, not dropped silently", async () => {
    const old = await runBrowserPathOffline(new FortunaPlaywrightScraper(), "premier-league", ROUTES);
    const client = createReplayHttpClient(ROUTES);
    const { value: neu, logs } = await captureLogs(() => new FortunaHttpScraper(client).scrapeFullOffer("premier-league"));
    expect(neu).toMatchObject({ success: true, error: `1 of 2 details failed | fetch HTTP 500 ${MARKETS_URL("ufo:mtch:1xi-0a0")}` });
    expect(neu.matches).toHaveLength(1);
    expect(stripScrapedAt(neu.matches)).toEqual(stripScrapedAt(old.result.matches));
    expect(client.calls.filter((u) => !old.requests.includes(u))).toEqual([]);
    expect(client.calls.some((u) => u.endsWith("/markets/overview"))).toBe(false);
    expect(fullOfferLines(logs)).toEqual(fullOfferLines(old.logs));
  });

  it("never acquires a browser", async () => {
    const acquire = vi.spyOn(browserPool, "acquire");
    await run(ROUTES);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("fails with the first cause when more than half the details fail", async () =>
    expect(await run({ ...ROUTES, [MARKETS_URL("ufo:mtch:1xi-0a1")]: { status: 500, body: "upstream" } }))
      .toMatchObject({ success: false, matches: [], error: `2 of 2 details failed | fetch HTTP 500 ${MARKETS_URL("ufo:mtch:1xi-0a0")}` }));

  it("a listing HTTP error becomes the result error", async () =>
    expect(await run({ ...ROUTES, [LISTING_URL]: { status: 404, body: "nf" } })).toMatchObject({ success: false, error: `fetch HTTP 404 ${LISTING_URL}` }));

  it("a challenged listing names SCRAPER_TRANSPORT_FORTUNA", async () =>
    expect((await run({ ...ROUTES, [LISTING_URL]: { status: 403, body: "<html>", contentType: "text/html" } })).error)
      .toBe(`fetch HTTP 403 ${LISTING_URL} | possible Cloudflare challenge, fallback SCRAPER_TRANSPORT_FORTUNA=browser`));

  it("an empty listing is success:true with no matches and no detail request (README §3)", async () => {
    const client = createReplayHttpClient({ ...ROUTES, [LISTING_URL]: { body: '{"fixtures":[]}' } });
    expect(await new FortunaHttpScraper(client).scrapeFullOffer("premier-league")).toMatchObject({ success: true, matches: [] });
    expect(client.calls).toEqual([LISTING_URL]);
    expect(console.warn).toHaveBeenCalledWith(`[Fortuna/FullOffer] No fixtures found from API ${LISTING_URL}`);
  });

  it("a malformed listing (no fixtures array) fails", async () =>
    expect(await run({ ...ROUTES, [LISTING_URL]: { body: '{"error":"x"}' } })).toMatchObject({ success: false, error: `fetch unexpected payload ${LISTING_URL}` }));

  it("wrong shape: a 200 that is not an array is skipped, never an empty offer", async () =>
    expect(await run({ ...ROUTES, [MARKETS_URL("ufo:mtch:1xi-0a1")]: { body: '{"error":"x"}' }, [MARKETS_URL("ufo:mtch:1xi-0a0")]: { body: "[]" } }))
      .toMatchObject({ success: false, error: `1 of 1 details failed | fetch unexpected payload ${MARKETS_URL("ufo:mtch:1xi-0a1")}` }));
});
