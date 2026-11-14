import { describe, it, expect } from "vitest";
import { parseWebSocketJson, parseFixtures, parseAllMarkets } from "../parser.js";
import { mapStsFixtureToOffer, stsLog } from "../offer-mapping.js";
import type { STSFixture } from "../types.js";
import { wsIplFrame, wsSnapshotFrame } from "./helpers/sts-frames.js";

const ipl = parseWebSocketJson(wsIplFrame())!;
const fx = (id: string): STSFixture => parseFixtures(ipl, "premier-league").find((f) => f.id === id)!;
const snap = (id: string) => parseWebSocketJson(wsSnapshotFrame(id));

// The patterns docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/sts/sts-run-check.py parses
const RUN_CHECK = {
  found: /^\[STS\/FullOffer\] Found (\d+) fixtures for premier-league$/,
  completed: /^\[STS\/FullOffer\] Completed: (\d+) matches/,
  noSnapshot: /^\[STS\/FullOffer\] No fixture snapshot for .* skipping/,
  skips: /^\[STS\/FullOffer\] Skipping .*(whitelist|Youth team match)/,
  markets: /^\[STS\/FullOffer\] (.+): (\d+) markets$/,
};

describe("mapStsFixtureToOffer", () => {
  it("maps Leeds vs Tottenham to one offer", () => {
    const r = mapStsFixtureToOffer(fx("f2921896"), snap("f2921896"), ipl, "premier-league");
    expect(r.kind).toBe("offer");
    if (r.kind !== "offer") return;
    expect(r.offer).toMatchObject({
      matchId: "f2921896", bookmaker: "sts", homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur",
      eventUrl: "https://www.sts.pl/kursy/leeds-tottenham/f2921896", startTime: "2026-11-07T12:30:00Z",
    });
    expect(r.offer.markets).toEqual(parseAllMarkets(fx("f2921896"), snap("f2921896"), ipl));
    expect(r.offer.scrapedAt).toBeInstanceOf(Date);
  });

  it("skips a youth fixture", () => {
    expect(mapStsFixtureToOffer({ ...fx("f2921896"), home: "Leeds U21" }, snap("f2921896"), ipl, "premier-league"))
      .toEqual({ kind: "skip", warning: "[STS/FullOffer] Skipping Leeds U21 vs Tottenham: Youth team match" });
  });

  it("skips a team outside the league whitelist", () => {
    expect(mapStsFixtureToOffer({ ...fx("f2921896"), home: "Avro FC" }, snap("f2921896"), ipl, "premier-league"))
      .toEqual({ kind: "skip", warning: "[STS/FullOffer] Skipping Avro FC vs Tottenham: Teams not in premier-league whitelist" });
  });

  it("drops two raw names that canonicalize to one club", () => {
    expect(mapStsFixtureToOffer({ ...fx("f2921896"), home: "Leeds", away: "Leeds United" }, snap("f2921896"), ipl, "premier-league"))
      .toEqual({ kind: "skip", warning: '[STS/FullOffer] Dropping "Leeds" vs "Leeds United": both canonicalize to Leeds United' });
  });

  it.each([
    ["nations-league", "Hiszpania", "Anglia", "Spain", "England"],
    ["world-cup-2026", "Niemcy", "Brazylia", "Germany", "Brazil"],
  ])("national teams without TSDB ids map by name (%s %s vs %s)", (league, home, away, homeTeam, awayTeam) => {
    // Rosters of national teams carry id "" for every nation; live 2026-11-14 STS dropped every
    // Nations League fixture as one club when the identity check compared those ids
    const r = mapStsFixtureToOffer({ ...fx("f2921896"), home, away }, snap("f2921896"), ipl, league);
    expect(r).toMatchObject({ kind: "offer", offer: { homeTeam, awayTeam } });
  });

  it("silent skip when no payload has the fixture's markets", () => {
    expect(mapStsFixtureToOffer(fx("f2921896"), null, null, "premier-league")).toEqual({ kind: "skip", warning: null });
  });
});

describe("stsLog", () => {
  it("stsLog lines match the sts-run-check.py patterns", () => {
    const leeds = fx("f2921896");
    expect(stsLog.found(4, "premier-league")).toMatch(RUN_CHECK.found);
    expect(stsLog.found(4, "premier-league")).toBe("[STS/FullOffer] Found 4 fixtures for premier-league");
    expect(stsLog.matchMarkets(leeds, 527)).toBe("[STS/FullOffer] Leeds vs Tottenham: 527 markets");
    expect(RUN_CHECK.markets.exec(stsLog.matchMarkets(leeds, 527))?.[1]).toBe("Leeds vs Tottenham");
    expect(stsLog.completed(4, 988)).toBe("[STS/FullOffer] Completed: 4 matches, 988 total markets");
    expect(stsLog.completed(4, 988)).toMatch(RUN_CHECK.completed);
    expect(stsLog.noSnapshot(leeds)).toBe(
      "[STS/FullOffer] No fixture snapshot for Leeds vs Tottenham after 2 attempts - skipping (previous snapshot kept)");
    expect(stsLog.noSnapshot(leeds)).toMatch(RUN_CHECK.noSnapshot);
    expect(stsLog.youth(leeds)).toMatch(RUN_CHECK.skips);
    expect(stsLog.notWhitelisted(leeds, "premier-league")).toMatch(RUN_CHECK.skips);
    expect(stsLog.sameClub({ ...leeds, away: "Leeds United" }, "Leeds United"))
      .toBe('[STS/FullOffer] Dropping "Leeds" vs "Leeds United": both canonicalize to Leeds United');
  });
});
