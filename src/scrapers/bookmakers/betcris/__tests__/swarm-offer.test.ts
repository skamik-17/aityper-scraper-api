import { describe, it, expect } from "vitest";
import { buildBetcrisMatchOffer, buildEventUrl, findGameInSwarmData } from "../swarm-offer.js";
import { parseAllMarkets, parseSwarmDataForFullOffer } from "../parser.js";
import type { SwarmData, SwarmGame } from "../types.js";
import { recordedGame, recordedListing } from "./helpers/swarm-fixtures.js";

const entries = parseSwarmDataForFullOffer(recordedListing(), "premier-league", 538);
const at = new Date("2026-11-07T02:00:00.000Z");

describe("betcris swarm-offer", () => {
  it("buildBetcrisMatchOffer: maps recorded game 31321159 as the browser loop did", () => {
    const offer = buildBetcrisMatchOffer(entries[0], recordedGame(31321159), "premier-league", at)!;
    expect(offer).toMatchObject({ matchId: "31321159", bookmaker: "betcris", homeTeam: "Everton", awayTeam: "Coventry City", scrapedAt: at,
      eventUrl: "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538/31321159", startTime: "2026-11-06T20:00:00.000Z" });
    expect(offer.markets).toEqual(parseAllMarkets(findGameInSwarmData(recordedGame(31321159), 31321159)!, entries[0].teams));
    expect(offer.markets.length).toBeGreaterThan(600); // 613 Swarm markets; the ladder split only adds entries
    expect(offer.markets.find((m) => m.bookmakerMarketId === "P1XP2")!.selections.map((s) => [s.name, s.odds])).toEqual([["  W1", 1.67], ["Remis", 4.1], ["W2", 5.5]]);
  });

  it("buildBetcrisMatchOffer: keeps the listing game when the detail has no richer copy", () => {
    expect(buildBetcrisMatchOffer(entries[0], {}, "premier-league", at)!.markets.map((m) => m.bookmakerMarketId)).toEqual(["P1XP2"]);
  });

  it("buildBetcrisMatchOffer: returns null when the chosen game has no markets", () => {
    expect(buildBetcrisMatchOffer({ ...entries[0], game: { ...entries[0].game, market: {} } }, {}, "premier-league", at)).toBeNull();
  });

  it("findGameInSwarmData: richest copy of the id, null when absent", () => {
    const rich = findGameInSwarmData(recordedGame(31321159), 31321159)!;
    const tree = (games: Record<string, SwarmGame>): SwarmData => ({ sport: { "1": { id: 1, name: "", alias: "Soccer", region: { "2": { id: 2, name: "", alias: "England",
      competition: { "538": { id: 538, name: "", game: games } } } } } } });
    expect(findGameInSwarmData(tree({ a: entries[0].game, b: rich }), 31321159)).toBe(rich);
    expect(findGameInSwarmData(tree({ a: rich, b: entries[0].game }), 31321159)).toBe(rich);
    expect(findGameInSwarmData(recordedGame(31321159), 99999999)).toBeNull();
  });

  it("buildEventUrl: keeps the stored www.betcris.pl form although the site redirects to betsport.pl", () => {
    expect(buildEventUrl("England", 538, 31321159)).toBe("https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538/31321159");
  });
});
