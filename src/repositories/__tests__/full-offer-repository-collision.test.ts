import { describe, it, expect } from "vitest";
import { saveBatchFullOfferMarkets } from "../full-offer-repository.js";
import type { ScrapedMarket } from "../../types/full-offer.js";

/**
 * Regression coverage for the same-canonical-id guard: the write funnel
 * every one of the 14 bookmaker scrapers goes through, not just STS's own
 * guard in sts/index.ts. generateMatchId() re-runs the same fuzzy matcher
 * (via getNormalizedTeamName), so a bookmaker whose scraper has no
 * home/away identity check of its own could still write a degenerate row
 * without this.
 *
 * Both cases below never reach a Supabase call: the guard drops the only
 * match before any record is built, so `allRecords` stays empty and the
 * function returns before touching the database (see the early
 * `if (allRecords.length === 0) return result;` check) - no network
 * mocking needed.
 */
function market(): ScrapedMarket {
  return {
    name: "Wynik meczu",
    normalizedType: "MATCH_WINNER" as any,
    marketKey: "MATCH_WINNER",
    selections: [{ type: "HOME", odds: 2.0 }],
  } as ScrapedMarket;
}

describe("saveBatchFullOfferMarkets: same-canonical-id guard", () => {
  // Deliberately only ONE case here, and it must stay the only one: this
  // function calls the real Supabase client and upserts into the production
  // `odds` table the moment `allRecords` is non-empty. A degenerate match is
  // dropped before any record is built (`allRecords` stays empty), so the
  // function returns early and never touches the database - safe to test
  // directly. A "genuine two-team match still gets processed" case is NOT
  // covered here on purpose: that would actually write a test row into
  // production data.
  it("drops a match whose home and away team both resolve to the same canonical club, without touching the database", async () => {
    const result = await saveBatchFullOfferMarkets(
      [{ homeTeam: "Manchester United", awayTeam: "Manchester United", markets: [market()] }],
      "sts" as any,
      "premier-league"
    );
    expect(result.inserted).toBe(0);
    expect(result.filtered).toBeGreaterThan(0);
    expect(result.matchesProcessed).toBe(0);
  });
});
