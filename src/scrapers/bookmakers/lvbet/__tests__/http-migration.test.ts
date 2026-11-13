import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { envelope, runBrowserPathOffline, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
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
