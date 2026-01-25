/**
 * Test to verify TRIPLE_BUTTONS market types include selections in parameters
 */

import { describe, it, expect } from "vitest";
import { groupMarketsByTypeWithParameters } from "../market-type-grouper.js";
import type { ScrapedMarket } from "../../types/full-offer.js";
import type { NormalizedMarketType } from "../../types/normalization.js";

describe("TRIPLE_BUTTONS Market Parameter Fix", () => {
  it("should include selections in parameters array for TEAMS_TO_SCORE market (TRIPLE_BUTTONS)", () => {
    const markets = [
      {
        market: {
          name: "Ile drużyn strzeli",
          bookmakerMarketId: "123",
          type: "betclic",
          groupName: "Gole",
          normalizedType: "TEAMS_TO_SCORE" as NormalizedMarketType,
          paramValue: "base",
          selections: [
            { name: "Oba zespoły strzelą", odds: 1.76, normalizedName: "TWO_TEAMS" },
            { name: "Arsenal strzeli tylko", odds: 2.65, normalizedName: "ONE_TEAM" },
            { name: "Manchester United strzeli tylko", odds: 10.75, normalizedName: "ONE_TEAM" },
            { name: "Brak Gola", odds: 14.75, normalizedName: "ZERO_TEAMS" },
          ],
        } as ScrapedMarket,
        bookmaker: "betclic",
      },
    ];

    const result = groupMarketsByTypeWithParameters(markets);

    expect(result.length).toBeGreaterThan(0);

    const teamsToScore = result.find(m => m.type === "TEAMS_TO_SCORE");
    expect(teamsToScore).toBeDefined();
    expect(teamsToScore!.hasParameters).toBe(true);

    const betclicSelections = teamsToScore!.parameters[0].bookmakers[0].selections;
    const selectionTypes = betclicSelections.map(s => s.type);

    expect(selectionTypes).toContain("TWO_TEAMS");
    expect(selectionTypes).toContain("ONE_TEAM");
    expect(selectionTypes).toContain("ZERO_TEAMS");

    const twoTeams = betclicSelections.find(s => s.type === "TWO_TEAMS");
    expect(twoTeams?.odds).toBe(1.76);

    const zeroTeams = betclicSelections.find(s => s.type === "ZERO_TEAMS");
    expect(zeroTeams?.odds).toBe(14.75);

    console.log("✅ TEAMS_TO_SCORE market correctly includes selections in parameters:");
    console.log(`   Market Type: ${teamsToScore!.type}`);
    console.log(`   Has Parameters: ${teamsToScore!.hasParameters}`);
    console.log(`   Parameters Count: ${teamsToScore!.parameters.length}`);
    console.log(`   Selections Count: ${betclicSelections.length}`);
    console.log(`   Selection Types: ${selectionTypes.join(", ")}`);
  });

  it("should include all selections for BINARY_BUTTONS market type", () => {
    const markets = [
      {
        market: {
          name: "Obie strzelą",
          bookmakerMarketId: "124",
          type: "betclic",
          groupName: "Gole",
          normalizedType: "BTTS" as NormalizedMarketType,
          paramValue: "base",
          selections: [
            { name: "Tak", odds: 1.76, normalizedName: "YES" },
            { name: "Nie", odds: 2.10, normalizedName: "NO" },
          ],
        } as ScrapedMarket,
        bookmaker: "betclic",
      },
    ];

    const result = groupMarketsByTypeWithParameters(markets);

    const btts = result.find(m => m.type === "BTTS");
    expect(btts).toBeDefined();
    expect(btts!.hasParameters).toBe(true);

    const betclicSelections = btts!.parameters[0].bookmakers[0].selections;
    const selectionTypes = betclicSelections.map(s => s.type);

    expect(selectionTypes).toContain("YES");
    expect(selectionTypes).toContain("NO");

    console.log("✅ BTTS market (BINARY_BUTTONS) correctly includes selections in parameters:");
    console.log(`   Selection Types: ${selectionTypes.join(", ")}`);
  });

  it("should only include YES selection for SINGLE_SELECTION market type", () => {
    const markets = [
      {
        market: {
          name: "Gol z rzutu wolnego",
          bookmakerMarketId: "126",
          type: "betclic",
          groupName: "Zawodnicy",
          normalizedType: "FREE_KICK_GOAL" as NormalizedMarketType,
          paramValue: "base",
          selections: [
            { name: "Tak", odds: 1.90, normalizedName: "YES" },
            { name: "Nie", odds: 1.85, normalizedName: "NO" },
          ],
        } as ScrapedMarket,
        bookmaker: "betclic",
      },
    ];

    const result = groupMarketsByTypeWithParameters(markets);

    const freeKick = result.find(m => m.type === "FREE_KICK_GOAL");
    expect(freeKick).toBeDefined();

    const betclicSelections = freeKick!.parameters[0].bookmakers[0].selections;
    const selectionTypes = betclicSelections.map(s => s.type);

    expect(selectionTypes).toContain("YES");
    expect(selectionTypes).not.toContain("NO");

    console.log("✅ FREE_KICK_GOAL market (SINGLE_SELECTION) correctly includes only YES selection:");
    console.log(`   Selection Types: ${selectionTypes.join(", ")}`);
  });
});
