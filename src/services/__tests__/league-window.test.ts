import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideLeagueWindow,
  refreshLeagueWindows,
  resetLeagueWindows,
  scheduledLeagues,
  type LeagueWindowDeps,
} from "../league-window.js";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const DAY = 86_400_000;

// A cache holding the given kickoffs for nations-league
function deps(kickoffs: string[], opts: { fail?: boolean } = {}): LeagueWindowDeps {
  const times = kickoffs.map((k) => Date.parse(k));
  return {
    countFixtures: vi.fn(async () => {
      if (opts.fail) throw new Error("fetch failed");
      return times.length;
    }),
    countFixturesBetween: vi.fn(async (_league: string, fromIso: string, toIso: string) => {
      if (opts.fail) throw new Error("fetch failed");
      return times.filter((t) => t >= Date.parse(fromIso) && t <= Date.parse(toIso)).length;
    }),
  };
}

beforeEach(() => {
  resetLeagueWindows();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("decideLeagueWindow", () => {
  it("a league without a fixture window is always scraped", async () => {
    const d = deps([]);
    expect((await decideLeagueWindow("premier-league", NOW, d)).active).toBe(true);
    expect(d.countFixtures).not.toHaveBeenCalled();
  });

  it("nations-league is scraped while a fixture kicks off within 14 days", async () => {
    expect((await decideLeagueWindow("nations-league", NOW, deps(["2026-12-03T19:45:00Z"]))).active).toBe(true);
  });

  it("and until 3 h after the last kickoff", async () => {
    expect((await decideLeagueWindow("nations-league", NOW, deps(["2026-11-20T09:30:00Z"]))).active).toBe(true);
    expect((await decideLeagueWindow("nations-league", NOW, deps(["2026-11-20T08:30:00Z"]))).active).toBe(false);
  });

  it("is skipped between windows: fixtures cached, none within 14 days", async () => {
    const r = await decideLeagueWindow("nations-league", NOW, deps(["2026-11-17T19:45:00Z", "2026-12-05T19:45:00Z"]));
    expect(r.active).toBe(false);
    expect(r.reason).toMatch(/no fixture/);
  });

  it("fails open: an empty cache (never synced) or a failing lookup keeps scraping", async () => {
    expect(await decideLeagueWindow("nations-league", NOW, deps([]))).toMatchObject({ active: true, reason: expect.stringMatching(/no cached fixtures/) });
    expect(await decideLeagueWindow("nations-league", NOW, deps([], { fail: true }))).toMatchObject({ active: true, reason: expect.stringMatching(/fetch failed/) });
  });
});

describe("scheduledLeagues", () => {
  const ENABLED = ["premier-league", "nations-league"];

  it("keeps every league before the first refresh", () => expect(scheduledLeagues(ENABLED)).toEqual(ENABLED));

  it("drops a league outside its window after a refresh, and brings it back when the window opens", async () => {
    await refreshLeagueWindows(ENABLED, NOW, deps(["2026-11-17T19:45:00Z"]));
    expect(scheduledLeagues(ENABLED)).toEqual(["premier-league"]);
    await refreshLeagueWindows(ENABLED, NOW + 120 * DAY, deps(["2027-03-25T19:45:00Z"]));
    expect(scheduledLeagues(ENABLED)).toEqual(ENABLED);
  });

  it("a refresh that outlives its timeout keeps the previous state", async () => {
    await refreshLeagueWindows(ENABLED, NOW, deps(["2026-11-17T19:45:00Z"]));
    const hanging: LeagueWindowDeps = { countFixtures: () => new Promise(() => {}), countFixturesBetween: () => new Promise(() => {}) };
    await refreshLeagueWindows(ENABLED, NOW, hanging, 20);
    expect(scheduledLeagues(ENABLED)).toEqual(["premier-league"]);
  });

  it("logs only when a league enters or leaves its window", async () => {
    const log = vi.mocked(console.log);
    await refreshLeagueWindows(ENABLED, NOW, deps(["2026-11-17T19:45:00Z"]));
    await refreshLeagueWindows(ENABLED, NOW, deps(["2026-11-17T19:45:00Z"]));
    expect(log.mock.calls.flat().filter((l) => String(l).includes("nations-league"))).toHaveLength(1);
  });
});
