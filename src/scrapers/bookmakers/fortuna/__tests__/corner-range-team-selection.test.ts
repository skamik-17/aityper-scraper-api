import { describe, it, expect } from "vitest";
import { parseAllMarkets } from "../parser.js";
import type { FortunaMarket } from "../types.js";
import type { ParsedTeams } from "../types.js";

// Audit /audit-match (premier-league Arsenal vs Coventry City): the 1st-half
// per-team corners-range markets (ids 00-0v/00-0w, misleadingly named
// ASIAN_HANDICAP/EUROPEAN_HANDICAP in MARKET_TYPE_IDS) quote a 4-way goal
// band ("0-1", "2", "3", "4+") whose "2" bucket reuses outcome code "2" -
// the same code the 1X2 AWAY leg uses. getSelectionName's generic 1X2
// fallback was turning that bucket into the away team's name instead of the
// literal "2" band label, silently destroying one of the four selections
// (and replacing it with a value indistinguishable from a real 1X2 result).
const teams: ParsedTeams = { homeTeam: "Arsenal", awayTeam: "Coventry" };

function cornersRangeMarket(marketTypeId: string, name: string): FortunaMarket {
  return {
    id: "m1",
    fixtureId: "f1",
    marketTypeId,
    marketTypeName: name,
    name,
    outcomes: [
      { id: "o1", name: "0-1", longName: "0-1", odds: 4.9 },
      { id: "o2", name: "4+", longName: "4+", odds: 2.01 },
      // The "2" corners-count bucket: raw code collides with the 1X2 AWAY
      // code, and the API's longName for it is a bare digit.
      { id: "o3", name: "2", longName: "2", odds: 4.7 },
      { id: "o4", name: "3", longName: "3", odds: 4.5 },
    ] as never,
    specifiers: {},
  };
}

describe("corner-range team selection labels", () => {
  it("keeps the literal '2' band label for 00-0v (never the away team name)", () => {
    const market = cornersRangeMarket("ufo:mtyp:00-0v", "1. połowa: Arsenal przedział rzutów rożnych");
    const out = parseAllMarkets([market], teams);
    const names = out[0].selections.map((s) => s.name);
    expect(names).toEqual(["0-1", "4+", "2", "3"]);
  });

  it("keeps the literal '2' band label for 00-0w (never the away team name)", () => {
    const market = cornersRangeMarket("ufo:mtyp:00-0w", "1.połowa: Coventry przedział rzutów rożnych");
    const out = parseAllMarkets([market], teams);
    const names = out[0].selections.map((s) => s.name);
    expect(names).toEqual(["0-1", "4+", "2", "3"]);
  });

  it("no selection of these markets ever equals a team name from context", () => {
    const market = cornersRangeMarket("ufo:mtyp:00-0w", "1.połowa: Coventry przedział rzutów rożnych");
    const out = parseAllMarkets([market], teams);
    const names = out[0].selections.map((s) => s.name);
    expect(names).not.toContain(teams.homeTeam);
    expect(names).not.toContain(teams.awayTeam);
  });
});
