import { describe, expect, it } from "vitest";
import { buildScrapedMarkets, renderTemplate, selectLeagueEvents } from "../parser.js";
import type { BetbyEvent, BetbyMarketDescriptions, BetbySnapshot } from "../types.js";
import { loadJson, snapshotFrom } from "./fixtures.js";

const D = loadJson<{ markets: BetbyMarketDescriptions }>("betters", "descriptions-markets.trimmed.json").markets;
const leeds = loadJson<{ events: Record<string, BetbyEvent> }>("betters", "event-2725816334213586962.json").events[
  "2725816334213586962"
];
const C = ["Leeds United", "Tottenham Hotspur"] as [string, string];
const PL = "1669818860469096448";

describe("betby parser", () => {
  it("renderTemplate substitutes competitors, signed and ordinal specifiers", () => {
    expect(renderTemplate("{$competitor2} ({-hcp})", { hcp: "-1.5" }, C)).toBe("Tottenham Hotspur (+1.5)");
    expect(renderTemplate("{$competitor1} ({+hcp})", { hcp: "-1.5" }, C)).toBe("Leeds United (-1.5)");
    expect(renderTemplate("ponad {total}", { total: "2.5" }, C)).toBe("ponad 2.5");
    expect(renderTemplate("Zawodnik otrzyma {!cardnr} kartkę", { cardnr: "1" }, C)).toBe("Zawodnik otrzyma 1. kartkę");
    expect(renderTemplate("{foo} x", {}, C)).toBe("{foo} x");
  });

  it("selectLeagueEvents returns the 11 upcoming PL matches without the outright", () => {
    const refs = selectLeagueEvents(snapshotFrom("betters"), PL, Date.parse("2026-11-06T16:00:00Z"));
    expect(refs).toHaveLength(11);
    expect(refs[0]).toMatchObject({ eventId: "2725815896848338956", homeTeam: "Everton FC", awayTeam: "Coventry City",
      startTime: "2026-11-06T20:00:00.000Z", categorySlug: "england", tournamentSlug: "premier-league", eventSlug: "everton-fc-coventry-city" });
    expect(refs.find((r) => r.eventId === "2725816334213586962")!.awayTeam).toBe("Tottenham Hotspur");
    expect(refs.map((r) => r.eventId)).not.toContain("2697520988786135084");
    expect(selectLeagueEvents(snapshotFrom("betters"), PL, Date.parse("2026-11-06T21:00:00Z"))).toHaveLength(10);
  });

  it("selectLeagueEvents takes every tournament of a split league (Nations League A + B)", () => {
    const s = snapshotFrom("betters");
    const ids = Object.keys(s.events).filter((id) => s.events[id]?.desc?.tournament === PL);
    // Move two PL matches into a second tournament, as Betby splits the Nations League into League A and B
    for (const id of ids.slice(0, 2)) s.events[id] = { ...s.events[id], desc: { ...s.events[id].desc, tournament: "2707230903544983600" } };
    const now = Date.parse("2026-11-06T16:00:00Z");
    expect(selectLeagueEvents(s, PL, now)).toHaveLength(9);
    expect(selectLeagueEvents(s, [PL, "2707230903544983600"], now)).toHaveLength(11);
  });

  it("selectLeagueEvents keeps 19-digit ids as exact strings", () => {
    const refs = selectLeagueEvents(snapshotFrom("betters"), PL, Date.parse("2026-11-06T16:00:00Z"));
    for (const r of refs) { expect(typeof r.eventId).toBe("string"); expect(r.eventId).toMatch(/^\d{19}$/); }
    expect(refs.map((r) => r.eventId)).toContain("2725816334213586962"); // Number() would give 2725816334213587000
  });

  it("selectLeagueEvents skips an event without a desc instead of failing the league", () => {
    // One malformed event of any sport sits in the same snapshot as every league of the brand.
    const s = snapshotFrom("betters");
    const broken = { "2799999999999999901": { markets: {} }, "2799999999999999902": null, "2799999999999999903": { desc: "x", markets: {} } };
    const withBroken = { ...s, events: { ...broken, ...s.events } as unknown as BetbySnapshot["events"] };
    const refs = selectLeagueEvents(withBroken, PL, Date.parse("2026-11-06T16:00:00Z"));
    expect(refs).toHaveLength(11);
    expect(refs.find((r) => r.eventId === "2725816334213586962")).toMatchObject({ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur" });
  });

  it("selectLeagueEvents leaves the shared snapshot untouched", () => {
    // The client caches one deep-frozen snapshot for every league of a run, so trimming must copy.
    const s = snapshotFrom("betters");
    const before = JSON.stringify(s);
    const refs = selectLeagueEvents(s, PL, Date.parse("2026-11-06T16:00:00Z"));
    expect(JSON.stringify(s)).toBe(before);
    expect(refs.find((r) => r.eventId === "2725816334213586962")).toMatchObject({
      categoryId: "1669818860410376192", tournamentId: PL, listingMarkets: s.events["2725816334213586962"].markets });
  });

  it("buildScrapedMarkets emits 242 non-player markets with id-tagged selections", () => {
    const m = buildScrapedMarkets(leeds.markets, D, C);
    expect(m).toHaveLength(242);
    expect(m.reduce((n, x) => n + x.selections.length, 0)).toBe(699);
    expect(m.find((x) => x.bookmakerMarketId === "1")).toEqual({ name: "1x2", bookmakerMarketId: "1", paramValue: undefined, selections: [
      { name: "Leeds United", odds: 2.74, externalId: "1" }, { name: "remis", odds: 3.3, externalId: "2" }, { name: "Tottenham Hotspur", odds: 2.54, externalId: "3" }] });
    expect(m.find((x) => x.paramValue === "total=2.5" && x.bookmakerMarketId === "18")).toMatchObject({ name: "Suma 2.5",
      selections: [{ name: "ponad 2.5", odds: 1.93, externalId: "12" }, { name: "poniżej 2.5", odds: 1.85, externalId: "13" }] });
    expect(m.find((x) => x.paramValue === "hcp=-1.5" && x.bookmakerMarketId === "16")).toMatchObject({ name: "Handicap -1.5",
      selections: [{ name: "Leeds United (-1.5)", odds: 5.8, externalId: "1714" }, { name: "Tottenham Hotspur (+1.5)", odds: 1.13, externalId: "1715" }] });
    expect(m.filter((x) => x.bookmakerMarketId === "18").map((x) => x.paramValue)).toEqual(
      ["total=0.5", "total=1", "total=1.5", "total=2", "total=2.5", "total=3", "total=3.5", "total=4", "total=4.5"]);
    expect(m.some((x) => ["38", "39", "40", "50031", "50212"].includes(x.bookmakerMarketId!))).toBe(false);
  });

  it("buildScrapedMarkets drops blocked outcomes and keeps 1.01", () => {
    const cs = buildScrapedMarkets(leeds.markets, D, C).find((x) => x.bookmakerMarketId === "45")!;
    expect(cs.selections).toHaveLength(30);
    expect(cs.selections.map((s) => s.externalId)).not.toContain("382");
    expect(cs.selections).toContainEqual({ name: "0:0", odds: 9.75, externalId: "274" });
    const tiny = buildScrapedMarkets({ "29": { "": { "74": { k: "1.01" }, "76": { k: "1.0" } } } }, D, C)[0];
    expect(tiny.selections).toEqual([{ name: "tak", odds: 1.01, externalId: "74" }]);
  });

  it("buildScrapedMarkets reads the specifier's variant and keeps description order", () => {
    const m = buildScrapedMarkets(leeds.markets, D, C);
    // The variant names the outcome set but is not appended to the market name.
    expect(m.find((x) => x.bookmakerMarketId === "25")).toEqual({ name: "Przedział goli", bookmakerMarketId: "25",
      paramValue: "variant=sr:goal_range:7+", selections: [
        { name: "0-1 goli", odds: 3.1, externalId: "sr:goal_range:7+:1342" }, { name: "2-3 gole", odds: 1.9, externalId: "sr:goal_range:7+:1343" },
        { name: "4-6 goli", odds: 3.4, externalId: "sr:goal_range:7+:1344" }, { name: "7+ goli", odds: 30, externalId: "sr:goal_range:7+:1345" }] });
    // The event lists outcomes 6, 8, 7; the description order 6, 7, 8 wins. goalnr is in the template, so no suffix.
    expect(m.find((x) => x.bookmakerMarketId === "8")).toMatchObject({ name: "1. gol", paramValue: "goalnr=1",
      selections: [{ externalId: "6", name: "Leeds United", odds: 2 }, { externalId: "7", name: "żaden", odds: 9.5 }, { externalId: "8", name: "Tottenham Hotspur", odds: 1.95 }] });
  });

  it("buildScrapedMarkets falls back to ids, orders numerically and drops player and dst pairs", () => {
    const m = buildScrapedMarkets({
      "999001": { "": { "10": { k: "2" }, "9": { k: "3" } } },
      "29": { "": { "75": { k: "4" }, "76": { k: "1.9" }, "74": { k: "1.8" } }, "variant=dst:playerprops:1": { "74": { k: "2" } } },
      // Outcome 7 is blocked at a real-looking price; 8 has no usable price.
      "8": { "goalnr=1": { "6": { k: "2.1" }, "7": { k: "9", b: 1 }, "8": { k: "Infinity" } }, "goalnr=2": { "sr:player:1": { k: "5" }, "6": { k: "2" } } },
      "5": { "": { "dst:playerprops:1:2": { k: "3" } }, "x=1": { "1": { k: "1", b: 0 } } },
    }, D, C);
    expect(m.map((x) => [x.bookmakerMarketId, x.paramValue])).toEqual([["8", "goalnr=1"], ["29", undefined], ["999001", undefined]]);
    expect(m[0].selections).toEqual([{ name: "Leeds United", odds: 2.1, externalId: "6" }]);
    expect(m[1].selections.map((s) => [s.externalId, s.name])).toEqual([["74", "tak"], ["76", "nie"], ["75", "75"]]);
    expect(m[2]).toEqual({ name: "Rynek 999001", bookmakerMarketId: "999001", paramValue: undefined, selections: [
      { name: "9", odds: 3, externalId: "9" }, { name: "10", odds: 2, externalId: "10" }] });
  });
});
