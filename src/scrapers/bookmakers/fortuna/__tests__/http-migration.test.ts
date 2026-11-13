import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs, envelope, runBrowserPathOffline, type ReplayRoutes } from "../../../../__tests__/helpers/replay-page.js";
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
