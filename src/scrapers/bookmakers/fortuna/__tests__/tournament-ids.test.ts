import { describe, it, expect } from "vitest";
import { TOURNAMENT_IDS } from "../constants.js";
import { getBookmakerLeagueId, getSupportedLeagues } from "../../../../config/leagues.js";

describe("Fortuna tournament ids", () => {
  it("Ekstraklasa uses the id the 2026-11-13 probe found (tournament-probe-ekstraklasa.txt)", () => {
    // ufo:tour:00-0b9 answers HTTP 404 "Structure ... not found"; 00-05k ("Ekstraklasa
    // Polska") lists the same 9-fixture round as totalbet in the same run.
    expect(TOURNAMENT_IDS.ekstraklasa).toBe("ufo:tour:00-05k");
  });

  it("the scraper's ids and the league config's ids never drift apart", () => {
    for (const [slug, id] of Object.entries(TOURNAMENT_IDS)) {
      expect(getBookmakerLeagueId(slug, "fortuna"), slug).toBe(id);
    }
    for (const slug of getSupportedLeagues("fortuna")) {
      expect(TOURNAMENT_IDS[slug], slug).toBeDefined();
    }
  });
});
