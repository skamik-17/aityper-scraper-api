import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { captureLogs, envelope, runBrowserPathOffline, stripScrapedAt, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
import { browserPool } from "../../../base/browser-pool.js";
import type { HttpClient } from "../../../shared/http/http-client.js";
import { LVBetHttpScraper } from "../http-scraper.js";
import { LVBetPlaywrightScraper } from "../index.js";
import { parseAllMarkets } from "../parser.js";
import type { LVBetCompetitionResponse, LVBetMarket } from "../types.js";
import { mapLvbetMatchOffer, selectLvbetMatches } from "../full-offer-mapping.js";
import { lvbetCompetitionViewUrl, lvbetMarketsSearchUrl } from "../navigation.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/http-migration/${n}`, import.meta.url), "utf8");
const API = "https://offer.lvbet.pl/client-api/v5";
const LISTING_URL = `${API}/matches/competition-view/?sports_groups_ids=37685&lang=pl`;
const SEARCH_URL = (id: string) => `${API}/markets/search/?matches_ids=${id}&lang=pl`;
// tracked recovery fixture (raw v5 /markets/search array, 2026-11-06)
const ARSENAL_HULL_SEARCH = readFileSync(new URL("./fixtures/markets-search-arsenal-hull-2026-11-06.json", import.meta.url), "utf8");
const ROUTES: ReplayRoutes = {
  [LISTING_URL]: { body: fx("competition-view-premier-league.json") },
  [SEARCH_URL("bc:31340648")]: { body: fx("markets-bc_31340648.json") }, // Ipswich Town–Bournemouth (trimmed)
  [SEARCH_URL("bc:31419246")]: { status: 500, body: '{"detail":"upstream"}' }, // Aston Villa–Sunderland: failure
  [SEARCH_URL("bc:31333515")]: { body: ARSENAL_HULL_SEARCH }, // Arsenal–Hull City
};
const ENVELOPES = [
  { matchId: "bc:31340648", bookmaker: "lvbet", homeTeam: "Ipswich Town", awayTeam: "AFC Bournemouth", startTime: "2026-11-08T14:00:00.000Z",
    eventUrl: "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/premier-league/ipswichtownvsbournemouth/--/1/35148/37685/bc:31340648/" },
  { matchId: "bc:31333515", bookmaker: "lvbet", homeTeam: "Arsenal", awayTeam: "Hull City", startTime: "2026-11-07T15:00:00.000Z",
    eventUrl: "https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/premier-league/arsenalvshullcity/--/1/35148/37685/bc:31333515/" },
];
const MARKETS = (id: string) =>
  JSON.parse(id === "bc:31333515" ? ARSENAL_HULL_SEARCH : fx(`markets-${id.replace(":", "_")}.json`)) as LVBetMarket[];
const CV = () => JSON.parse(fx("competition-view-premier-league.json")) as LVBetCompetitionResponse;

beforeEach(() => {
  for (const level of ["warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("lvbet browser path (characterization, recorded 2026-11-06/07)", () => {
  it("browser path (characterization): two offers in listing order, failed match absent", async () => {
    const { result, requests } = await runBrowserPathOffline(new LVBetPlaywrightScraper(), "premier-league", ROUTES);
    expect(result.success).toBe(true);
    expect(result.matches.map(envelope)).toEqual(ENVELOPES);
    expect(result.matches[0].markets).toEqual(parseAllMarkets(MARKETS("bc:31340648"), { homeTeam: "Ipswich Town", awayTeam: "Bournemouth" }));
    expect(result.matches[1].markets).toEqual(parseAllMarkets(MARKETS("bc:31333515"), { homeTeam: "Arsenal", awayTeam: "Hull City" }));
    expect(requests).toEqual([LISTING_URL, SEARCH_URL("bc:31340648"), SEARCH_URL("bc:31419246"), SEARCH_URL("bc:31333515")]);
  });
});

describe("lvbet full-offer mapping and URL builders", () => {
  it("builds URLs with a raw 'bc:' and comma-joined ids", () => {
    expect(lvbetCompetitionViewUrl(37685)).toBe(LISTING_URL);
    expect(lvbetMarketsSearchUrl(["bc:31340648"])).toBe(SEARCH_URL("bc:31340648"));
    expect(lvbetMarketsSearchUrl(["bc:1", "bc:2"])).toBe(`${API}/markets/search/?matches_ids=bc:1,bc:2&lang=pl`);
  });

  it("selectLvbetMatches keeps valid matches in listing order", () => {
    expect(selectLvbetMatches(CV()).map((m) => m.match_id)).toEqual(["bc:31340648", "bc:31419246", "bc:31333515"]);
    // synthetic
    expect(selectLvbetMatches({ matches: [{ match_id: "bc:1", home: [], away: ["X"] }] } as unknown as LVBetCompetitionResponse)).toEqual([]);
  });

  it("mapLvbetMatchOffer maps Ipswich and returns null without markets", () => {
    expect(envelope(mapLvbetMatchOffer(CV().matches![0], MARKETS("bc:31340648"), "premier-league")!)).toEqual(ENVELOPES[0]);
    expect(mapLvbetMatchOffer(CV().matches![0], [], "premier-league")).toBeNull();
  });
});

const fullOfferLines = (l: string[]) => l.filter((line) => line.startsWith("[LVBet/FullOffer]"));

describe("LVBetHttpScraper", () => {
  const run = (routes: ReplayRoutes) => new LVBetHttpScraper(createReplayHttpClient(routes)).scrapeFullOffer("premier-league");

  it("declares transport http", () => expect(new LVBetHttpScraper().transport).toBe("http"));

  it("contract: deep-equals the browser path; the failed match is reported, not dropped silently", async () => {
    const old = await runBrowserPathOffline(new LVBetPlaywrightScraper(), "premier-league", ROUTES);
    const client = createReplayHttpClient(ROUTES);
    const { value: neu, logs } = await captureLogs(() => new LVBetHttpScraper(client).scrapeFullOffer("premier-league"));
    expect(neu).toMatchObject({ success: true, error: `1 of 3 details failed | fetch HTTP 500 ${SEARCH_URL("bc:31419246")}` });
    expect(neu.matches).toHaveLength(2);
    expect(stripScrapedAt(neu.matches)).toEqual(stripScrapedAt(old.result.matches));
    expect(client.calls.filter((u) => !old.requests.includes(u))).toEqual([]);
    expect(client.calls.every((u) => !u.includes("%3A"))).toBe(true);
    expect(fullOfferLines(logs)).toEqual(fullOfferLines(old.logs));
  });

  it("never acquires a browser", async () => {
    const acquire = vi.spyOn(browserPool, "acquire");
    await run(ROUTES);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("fails with the first cause when more than half the details fail", async () =>
    expect(await run({ ...ROUTES, [SEARCH_URL("bc:31340648")]: { status: 500, body: '{"detail":"upstream"}' } }))
      .toMatchObject({ success: false, error: `2 of 3 details failed | fetch HTTP 500 ${SEARCH_URL("bc:31340648")}` }));

  it("a listing HTTP error becomes the result error", async () =>
    expect(await run({ ...ROUTES, [LISTING_URL]: { status: 503, body: "down" } })).toMatchObject({ success: false, error: `fetch HTTP 503 ${LISTING_URL}` }));

  it("an empty listing is success:true with no matches and no detail request (README §3)", async () => {
    const client = createReplayHttpClient({ ...ROUTES, [LISTING_URL]: { body: '{"matches":[]}' } });
    expect(await new LVBetHttpScraper(client).scrapeFullOffer("premier-league")).toMatchObject({ success: true, matches: [] });
    expect(client.calls).toEqual([LISTING_URL]);
    expect(console.warn).toHaveBeenCalledWith(`[LVBet/FullOffer] No matches found from API ${LISTING_URL}`);
  });

  it("a malformed listing (no matches array) fails", async () =>
    expect(await run({ ...ROUTES, [LISTING_URL]: { body: '{"detail":"x"}' } })).toMatchObject({ success: false, error: `fetch unexpected payload ${LISTING_URL}` }));

  it("wrong shape: a 200 that is not an array is skipped, never an empty offer", async () =>
    expect(await run({ ...ROUTES, [SEARCH_URL("bc:31340648")]: { body: '{"detail":"x"}' } }))
      .toMatchObject({ success: false, error: `2 of 3 details failed | fetch unexpected payload ${SEARCH_URL("bc:31340648")}` }));

  it("keeps listing order when the first detail resolves last", async () => {
    const base = createReplayHttpClient(ROUTES);
    const slow: HttpClient = {
      stats: base.stats,
      getText: (u, o) => base.getText(u, o),
      getJson: async <T>(u: string, o?: Parameters<HttpClient["getJson"]>[1]) => {
        if (u === SEARCH_URL("bc:31340648")) await new Promise((r) => setTimeout(r, 50));
        return base.getJson<T>(u, o);
      },
    };
    const r = await new LVBetHttpScraper(slow).scrapeFullOffer("premier-league");
    expect(r.matches.map((m) => m.matchId)).toEqual(["bc:31340648", "bc:31333515"]);
  });
});
