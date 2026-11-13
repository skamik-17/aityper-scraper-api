import { describe, it, expect, vi } from "vitest";
import { buildSuperbetListingUrl, fetchLeagueEvents } from "../navigation.js";

const BASE = "https://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL/events/by-date";

describe("superbet listing window", () => {
  it("ends the listing window 90 days after today (UTC)", () =>
    expect(buildSuperbetListingUrl("106", new Date("2026-11-07T10:00:00Z"))).toBe(
      `${BASE}?offerState=prematch&startDate=2026-11-07+00:00:00&endDate=2027-02-05+00:00:00&sportId=5&tournamentIds=106`,
    ));

  it("rolls over the year", () =>
    expect(buildSuperbetListingUrl("106", new Date("2026-12-31T23:30:00Z"))).toContain(
      "startDate=2026-12-31+00:00:00&endDate=2027-03-31+00:00:00",
    ));

  it("fetchLeagueEvents sends the built URL into the page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
    const page = { evaluate: vi.fn(async () => ({ data: [] })) };
    await fetchLeagueEvents(page as any, "premier-league");
    expect((page.evaluate.mock.calls[0] as unknown[])[1]).toBe(buildSuperbetListingUrl("106", new Date("2026-11-07T10:00:00Z")));
    vi.useRealTimers();
  });
});
