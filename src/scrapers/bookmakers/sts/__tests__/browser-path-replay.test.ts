import { describe, it, expect, vi } from "vitest";
vi.mock("../navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../navigation.js")>()),
  navigateAndCaptureLeagueData: vi.fn(), navigateAndCaptureMatchData: vi.fn(),
}));
import * as nav from "../navigation.js";
import { parseWebSocketJson, parseFixtures, parseAllMarkets } from "../parser.js";
import { runBrowserPath, type MockedNav } from "./helpers/browser-replay.js";
import { wsInput, wsIplFrame, wsSnapshotFrame } from "./helpers/sts-frames.js";

/**
 * Characterization of the browser full-offer path over the 2026-11-07
 * WebSocket capture (4 Premier League fixtures): what both transports must
 * keep producing.
 */
describe("sts browser path replay", () => {
  it("browser path over the 2026-11-07 frames: four offers in listing order", async () => {
    const { value: r, lines } = await runBrowserPath(nav as unknown as MockedNav, wsInput());
    expect(r.success).toBe(true);
    expect("error" in r).toBe(false);
    expect(r.matches.map((m) => [m.matchId, m.homeTeam, m.awayTeam, m.eventUrl, m.startTime])).toEqual([
      ["f2921896", "Leeds United", "Tottenham Hotspur", "https://www.sts.pl/kursy/leeds-tottenham/f2921896", "2026-11-07T12:30:00Z"],
      ["f2921905", "Newcastle United", "Arsenal", "https://www.sts.pl/kursy/newcastle-arsenal/f2921905", "2026-11-21T17:30:00Z"],
      ["f2921906", "Chelsea", "Leeds United", "https://www.sts.pl/kursy/chelsea-leeds/f2921906", "2026-11-21T15:00:00Z"],
      ["f2921911", "AFC Bournemouth", "Nottingham Forest", "https://www.sts.pl/kursy/bournemouth-nottingham/f2921911", "2026-11-21T15:00:00Z"],
    ]);
    const ipl = parseWebSocketJson(wsIplFrame())!;
    for (const m of r.matches) {
      const fixture = parseFixtures(ipl, "premier-league").find((f) => f.id === m.matchId)!;
      expect(m.markets).toEqual(parseAllMarkets(fixture, parseWebSocketJson(wsSnapshotFrame(m.matchId)), ipl));
    }
    expect(r.matches[0].markets.length).toBeGreaterThan(400);          // 527 on the future base (453 on 377b47e)
    expect(lines).toContain("[STS/FullOffer] Found 4 fixtures for premier-league");
    expect(lines.filter((l) => l.startsWith("[STS/FullOffer]")).at(-1)).toMatch(/^\[STS\/FullOffer\] Completed: 4 matches, \d+ total markets$/);
  });

  it("browser path skips a fixture whose captures have no snapshot and names it in error (Task 0)", async () => {
    const input = wsInput(); input.byFixture.f2921906 = [];
    const { value: r, lines } = await runBrowserPath(nav as unknown as MockedNav, input);
    expect(r.matches.map((m) => m.matchId)).toEqual(["f2921896", "f2921905", "f2921911"]);
    expect(r.error).toBe("1 of 4 details failed | no fixture snapshot https://www.sts.pl/kursy/chelsea-leeds/f2921906");
    expect(lines).toContain("[STS/FullOffer] No fixture snapshot for Chelsea vs Leeds after 2 attempts - skipping (previous snapshot kept)");
  });
});
