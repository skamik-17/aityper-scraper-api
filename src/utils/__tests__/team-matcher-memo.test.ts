import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fuse from "fuse.js";
import { matchToCanonical, clearTeamMatchMemo, TEAM_MATCH_MEMO_MAX } from "../team-matcher.js";

let search: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearTeamMatchMemo();
  search = vi.spyOn(Fuse.prototype, "search");
});
afterEach(() => vi.restoreAllMocks());

describe("matchToCanonical memo", () => {
  it("a repeated miss runs Fuse once and still returns null", () => {
    expect(matchToCanonical("Bukayo Saka", "premier-league")).toBeNull();
    expect(matchToCanonical("Bukayo Saka", "premier-league")).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("a repeated fuzzy hit returns the same team and runs Fuse once", () => {
    expect(matchToCanonical("Totenham", "premier-league")?.name).toBe("Tottenham Hotspur");
    expect(matchToCanonical("Totenham", "premier-league")?.name).toBe("Tottenham Hotspur");
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("memoizes per league", () => {
    matchToCanonical("Bukayo Saka", "premier-league");
    matchToCanonical("Bukayo Saka", "ekstraklasa");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry beyond TEAM_MATCH_MEMO_MAX", () => {
    matchToCanonical("Bukayo Saka", "premier-league");
    for (let i = 0; i < TEAM_MATCH_MEMO_MAX; i++) matchToCanonical(`Arsenal ${i}`, "premier-league"); // substring path, no Fuse
    matchToCanonical("Bukayo Saka", "premier-league");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("an unknown league still warns on every call (Review Focus 4)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    matchToCanonical("Arsenal", "no-such-league");
    matchToCanonical("Arsenal", "no-such-league");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('[TeamMatcher] Unknown league: "no-such-league"');
  });

  it("TEAM_MATCHER_DEBUG=true bypasses the memo (Review Focus 4)", () => {
    vi.stubEnv("TEAM_MATCHER_DEBUG", "true");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    matchToCanonical("Bukayo Saka", "premier-league");
    matchToCanonical("Bukayo Saka", "premier-league");
    expect(search).toHaveBeenCalledTimes(2);
    vi.unstubAllEnvs();
  });
});
