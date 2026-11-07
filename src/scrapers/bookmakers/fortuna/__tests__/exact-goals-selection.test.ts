import { describe, it, expect } from "vitest";
import { parseAllMarkets } from "../parser.js";
import type { FortunaMarket } from "../types.js";
import type { ParsedTeams } from "../types.js";

// Health check 2026-11-06 (D6): the exact-goals markets 00-16/00-17 ("<team>
// dokładna liczba goli") and 00-3e ("2.połowa: dokładna liczba goli") quote
// goal counts whose bare-digit codes ("0", "1", "2") are the same codes the
// 1X2 legs use. getSelectionName's 1X2 fallback rewrote them into "Remis" and
// the team names: Arsenal's "2 / 3+ / 1 / 0" became "Hull / 3+ / Arsenal /
// Remis". The outcomes below are copied in API order from
// docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/raw-exact-goals-arsenal-hull.json
// (Arsenal vs Hull, 2026-11-06T16:35Z), where name and longName are both the count.
const teams: ParsedTeams = { homeTeam: "Arsenal", awayTeam: "Hull" };

function market(marketTypeId: string, name: string, outcomes: Array<[string, number]>): FortunaMarket {
  return {
    id: "m1",
    fixtureId: "f1",
    marketTypeId,
    marketTypeName: name,
    name,
    outcomes: outcomes.map(([code, odds], i) => ({ id: `o${i}`, name: code, longName: code, odds })),
    specifiers: {},
  };
}

describe("exact-goals selection labels", () => {
  it.each([
    ["ufo:mtyp:00-16", "Arsenal dokładna liczba goli", [["2", 3.55], ["3+", 1.85], ["1", 4.7], ["0", 12]], ["2", "3+", "1", "0"]],
    ["ufo:mtyp:00-17", "Hull dokładna liczba goli", [["0", 1.55], ["1", 2.8], ["3+", 50], ["2", 10]], ["0", "1", "3+", "2"]],
    ["ufo:mtyp:00-3e", "2.połowa: dokładna liczba goli", [["0", 4.9], ["1", 2.95], ["2+", 1.81]], ["0", "1", "2+"]],
  ])("keeps the digit labels of %s (never Remis or a team name)", (marketTypeId, name, outcomes, expected) => {
    expect(parseAllMarkets([market(marketTypeId, name, outcomes)], teams)[0].selections.map((s) => s.name)).toEqual(expected);
  });
  it("still maps bare 1X2 codes to team names for ufo:mtyp:00-00", () => {
    const out = parseAllMarkets([market("ufo:mtyp:00-00", "Mecz", [["1", 1.16], ["0", 7.2], ["2", 15.5]])], teams);
    expect(out[0].selections.map((s) => s.name)).toEqual(["Arsenal", "Remis", "Hull"]);
  });
});
