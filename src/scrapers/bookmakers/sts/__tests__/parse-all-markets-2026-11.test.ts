import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWebSocketJson, parseFixtures, parseAllMarkets } from "../parser.js";
import { normalizeMarketsForBookmaker } from "../../../../services/normalization/index.js";
import type { STSWebSocketData } from "../types.js";

/**
 * parseAllMarkets regression coverage for the 2026-11 STS offer, on the real
 * Arsenal vs Hull City fixture snapshot (f2921898, stsId 72221372). Each
 * cards/corners O/U line arrives under the same line name, so without a line
 * suffix the name-based dedup kept only one line per market. The team
 * cards/corners lines live in the snapshot's extra r=17 P entry, not in
 * P["1m<stsId>"].
 */
const fx = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const fixture = parseFixtures(parseWebSocketJson(fx("i_pl.trimmed.txt"))!, "premier-league").find((f) => f.id === "f2921898")!;
const markets = parseAllMarkets(fixture, parseWebSocketJson(fx("f_f2921898_pl.arsenal-hull.snapshot.txt")), null);
const byId = (id: string) => markets.filter((m) => m.bookmakerMarketId === id);

describe("STS parseAllMarkets on the 2026-11 Arsenal vs Hull City snapshot", () => {
  it("keeps every cards/corners total line", () => {
    expect(byId("185")).toHaveLength(5);
    expect(byId("185").map((m) => m.name)).toContain("Liczba kartek 2.5");
    expect(byId("228")).toHaveLength(5);
    expect(byId("206")).toHaveLength(3);
    expect(byId("247")).toHaveLength(3);
  });
  it("each cards/corners line keeps its own line and prices", () => {
    for (const id of ["185", "228", "206", "247"]) {
      for (const m of byId(id)) {
        const line = m.name.match(/ (\d+\.5)$/)?.[1];
        expect(line, m.name).toBeDefined();
        expect(m.selections.map((s) => s.name), m.name).toEqual([`+${line}`, `-${line}`]);
      }
    }
    expect(byId("185").find((m) => m.name === "Liczba kartek 2.5")!.selections).toEqual([
      expect.objectContaining({ name: "+2.5", odds: 1.6 }),
      expect.objectContaining({ name: "-2.5", odds: 2.2 }),
    ]);
  });
  it("reads the r=17 team-stats group, one market per line", () => {
    expect(byId("231").map((m) => m.name).sort()).toEqual([
      "1. drużyna - liczba rzutów rożnych 6.5", "1. drużyna - liczba rzutów rożnych 7.5", "1. drużyna - liczba rzutów rożnych 8.5"]);
    expect(byId("188")).toHaveLength(2);
    expect(byId("191")).toHaveLength(3);
    expect(byId("234")).toHaveLength(3);
    expect(byId("1287")).toHaveLength(3);
    expect(byId("1287").find((m) => m.name.includes("4 lub więcej"))!.selections).toEqual([expect.objectContaining({ name: "Tak", odds: 2.9 })]);
    expect(byId("2287")).toHaveLength(2);
  });
  it("skips the r=17 penalty-type markets (open question 2)", () => {
    for (const id of ["1413", "1899", "2131"]) expect(byId(id)).toHaveLength(0);
  });
  it("does not read the r=12 '(z dogrywką)' group", () => {
    expect(byId("2414")).toHaveLength(0);
  });
  it("reads the r=17 group only next to the fixture's main group", () => {
    // A source without P["1m<stsId>"] yielded no markets before the r=17 group
    // was read; it must not turn into a team-stats-only partial write now
    const snapshot = parseWebSocketJson(fx("f_f2921898_pl.arsenal-hull.snapshot.txt"))!;
    delete snapshot.P![`1m${fixture.stsId}`];
    expect(parseAllMarkets(fixture, snapshot, null)).toEqual([]);
  });
  it("ignores another fixture's r=17 group in the fixture snapshot", () => {
    // Extra groups sit under opaque keys, so `f` is their only link to a match.
    // Leeds vs Tottenham's r=17 entry, verbatim from its committed snapshot, is
    // put first, so without the `f` check it would also win every name clash
    // in the dedup (same line, Leeds prices)
    const leedsKey = "17m5adef97b5db44544bc8c1fb00848114c";
    const leedsGroup = parseWebSocketJson(fx("f_f2921896_pl.leeds-tottenham.snapshot.txt"))!.P![leedsKey];
    expect(leedsGroup.f).toBe("f2921896");
    const parseWithGroupOf = (f: string) => {
      const snapshot = parseWebSocketJson(fx("f_f2921898_pl.arsenal-hull.snapshot.txt"))!;
      snapshot.P = { [leedsKey]: { ...leedsGroup, f }, ...snapshot.P };
      return parseAllMarkets(fixture, snapshot, null);
    };
    expect(parseWithGroupOf("f2921896")).toEqual(markets);
    // Control: the same group under Arsenal's id is read, so the `f` check is
    // what keeps it out (Leeds' 188 has a 2.5 line at 2.5/1.47, Arsenal's none)
    const relabelled = parseWithGroupOf(fixture.id);
    expect(relabelled.find((m) => m.name === "1. drużyna - liczba kartek 2.5")!.selections).toEqual([
      expect.objectContaining({ name: "+2.5", odds: 2.5 }),
      expect.objectContaining({ name: "-2.5", odds: 1.47 }),
    ]);
  });
  it("ignores other fixtures' r=17 groups in the match-page i_pl", () => {
    // Production passes the full match-page i_pl as the second source, and it
    // carries the r=17 groups of hundreds of other fixtures. The first entry
    // is copied from a live i_pl (2026-11-06 17:13Z) without its unread keys
    // Bb/p/q; 314 maps to DRAW_NO_BET. The second is synthetic: a 231 line at
    // 9.5, a line the Arsenal snapshot does not offer, so the name dedup
    // cannot hide it.
    const foreignGroups = (f314: string, f231: string): NonNullable<STSWebSocketData["P"]> => ({
      "17m005eb976bf654754b39700b58dfdc6a9": {
        f: f314, r: 17,
        m: { "1": {}, "314": { l: { "1": { n: "Zwycięzca meczu", o: { "4": { O: 3.6 }, "5": { O: 1.23 } } } } }, "318": {}, "324": {}, "330": {}, "333": {} },
      },
      "17m0000000000000000000000000000a231": {
        f: f231, r: 17,
        m: { "231": { l: { "1": { n: "1. drużyna - liczba rzutów rożnych", o: { "12": { O: 3.75, n: "+9.5" }, "13": { O: 1.25, n: "-9.5" } } } } } },
      },
    });
    const snapshot = parseWebSocketJson(fx("f_f2921898_pl.arsenal-hull.snapshot.txt"));
    const parseWithIplGroups = (groups: NonNullable<STSWebSocketData["P"]>) => {
      const ipl = parseWebSocketJson(fx("i_pl.trimmed.txt"))!;
      ipl.P = { ...groups, ...ipl.P };
      return parseAllMarkets(fixture, snapshot, ipl);
    };
    const injected = parseWithIplGroups(foreignGroups("f3624033", "f2921896"));
    expect(injected).toEqual(parseWithIplGroups({}));
    expect(injected.filter((m) => m.bookmakerMarketId === "314")).toEqual([]);
    expect(injected.map((m) => m.name)).not.toContain("1. drużyna - liczba rzutów rożnych 9.5");
    // Control: under Arsenal's id both groups are read, so the `f` check is
    // what keeps them out
    const relabelled = parseWithIplGroups(foreignGroups(fixture.id, fixture.id));
    expect(relabelled.filter((m) => m.bookmakerMarketId === "314").map((m) => m.selections.map((s) => s.odds)))
      .toEqual([[3.6, 1.23]]);
    expect(relabelled.map((m) => m.name)).toContain("1. drużyna - liczba rzutów rożnych 9.5");
  });
  it("normalizes the r=17 team cards/corners lines, side from the market name", () => {
    const n = normalizeMarketsForBookmaker(markets, "sts", "Arsenal", "Hull City", "premier-league");
    expect(n.filter((m) => m.normalizedType === "CARDS_TEAM" || m.normalizedType === "CORNERS_TEAM")
      .map((m) => `${m.bookmakerMarketId} ${m.marketKey} ${m.selections.map((s) => `${s.name}=${s.normalizedName}@${s.odds}`).join(" ")}`)
      .sort()).toEqual([
      "188 CARDS_TEAM:0.5 +0.5=HOME_OVER@1.5 -0.5=HOME_UNDER@2.35",
      "188 CARDS_TEAM:1.5 +1.5=HOME_OVER@3.4 -1.5=HOME_UNDER@1.28",
      "191 CARDS_TEAM:0.5 +0.5=AWAY_OVER@1.1 -0.5=AWAY_UNDER@6.2",
      "191 CARDS_TEAM:1.5 +1.5=AWAY_OVER@1.55 -1.5=AWAY_UNDER@2.35",
      "191 CARDS_TEAM:2.5 +2.5=AWAY_OVER@2.55 -2.5=AWAY_UNDER@1.45",
      "231 CORNERS_TEAM:HOME:6.5 +6.5=OVER@1.6 -6.5=UNDER@2.2",
      "231 CORNERS_TEAM:HOME:7.5 +7.5=OVER@2 -7.5=UNDER@1.7",
      "231 CORNERS_TEAM:HOME:8.5 +8.5=OVER@2.7 -8.5=UNDER@1.4",
      "234 CORNERS_TEAM:AWAY:1.5 +1.5=OVER@1.27 -1.5=UNDER@3.5",
      "234 CORNERS_TEAM:AWAY:2.5 +2.5=OVER@1.75 -2.5=UNDER@1.9",
      "234 CORNERS_TEAM:AWAY:3.5 +3.5=OVER@2.7 -3.5=UNDER@1.42",
    ]);
  });
});

/**
 * Normalized cards/corners totals on both committed full-offer snapshots, with
 * the production call shape (fixture frame + i_pl, canonical team names, as in
 * sts/index.ts and scrape-helpers.ts). Every line is pinned with its OVER/UNDER
 * prices, which were checked against the raw frames: a parser change that
 * collapses, drops or mis-suffixes a line fails here, while the replay gate's
 * 520/510 count bars would still pass.
 */
const TOTAL_CODE_TO_ID: Record<string, string> = {
  CARDS_TOTAL: "185",
  HALF_TIME_CARDS_TOTAL: "206",
  CORNERS_TOTAL: "228",
  HALF_TIME_CORNERS_TOTAL: "247",
};
const NORMALIZED_CASES: { id: string; file: string; home: string; away: string; lines: Record<string, [number, number]> }[] = [
  {
    id: "f2921898", file: "f_f2921898_pl.arsenal-hull.snapshot.txt", home: "Arsenal", away: "Hull City",
    // marketKey -> [OVER odds (+L), UNDER odds (-L)]
    lines: {
      "CARDS_TOTAL:0.5": [1.02, 11], "CARDS_TOTAL:1.5": [1.21, 4.1], "CARDS_TOTAL:2.5": [1.6, 2.2],
      "CARDS_TOTAL:3.5": [2.4, 1.5], "CARDS_TOTAL:4.5": [4.1, 1.21],
      "CORNERS_TOTAL:8.5": [1.4, 2.75], "CORNERS_TOTAL:9.5": [1.65, 2.1], "CORNERS_TOTAL:10.5": [2, 1.7],
      "CORNERS_TOTAL:11.5": [2.6, 1.42], "CORNERS_TOTAL:12.5": [3.4, 1.27],
      "HALF_TIME_CARDS_TOTAL:0.5": [1.48, 2.5], "HALF_TIME_CARDS_TOTAL:1.5": [3, 1.34], "HALF_TIME_CARDS_TOTAL:2.5": [6.75, 1.07],
      "HALF_TIME_CORNERS_TOTAL:3.5": [1.38, 2.85], "HALF_TIME_CORNERS_TOTAL:4.5": [1.78, 1.92],
      "HALF_TIME_CORNERS_TOTAL:5.5": [2.45, 1.48],
    },
  },
  {
    id: "f2921896", file: "f_f2921896_pl.leeds-tottenham.snapshot.txt", home: "Leeds United", away: "Tottenham Hotspur",
    lines: {
      "CARDS_TOTAL:2.5": [1.11, 5.8], "CARDS_TOTAL:3.5": [1.33, 3.1], "CARDS_TOTAL:4.5": [1.7, 2],
      "CARDS_TOTAL:5.5": [2.5, 1.47], "CARDS_TOTAL:6.5": [4, 1.22],
      "CORNERS_TOTAL:7.5": [1.27, 3.5], "CORNERS_TOTAL:8.5": [1.45, 2.55], "CORNERS_TOTAL:9.5": [1.75, 1.9],
      "CORNERS_TOTAL:10.5": [2.2, 1.6], "CORNERS_TOTAL:11.5": [2.85, 1.37],
      "HALF_TIME_CARDS_TOTAL:0.5": [1.2, 4.1], "HALF_TIME_CARDS_TOTAL:1.5": [1.85, 1.85],
      "HALF_TIME_CARDS_TOTAL:2.5": [3.45, 1.27], "HALF_TIME_CARDS_TOTAL:3.5": [6.75, 1.07],
      "HALF_TIME_CORNERS_TOTAL:3.5": [1.4, 2.7], "HALF_TIME_CORNERS_TOTAL:4.5": [1.85, 1.85],
      "HALF_TIME_CORNERS_TOTAL:5.5": [2.6, 1.44],
    },
  },
];

describe.each(NORMALIZED_CASES)("STS normalized cards/corners totals, $home vs $away", ({ id, file, home, away, lines }) => {
  const ipl = parseWebSocketJson(fx("i_pl.trimmed.txt"))!;
  const caseFixture = parseFixtures(ipl, "premier-league").find((f) => f.id === id)!;
  const normalized = normalizeMarketsForBookmaker(
    parseAllMarkets(caseFixture, parseWebSocketJson(fx(file)), ipl), "sts", home, away, "premier-league");

  it("publishes exactly the snapshot's line set for each code", () => {
    for (const code of Object.keys(TOTAL_CODE_TO_ID)) {
      expect(normalized.filter((m) => m.normalizedType === code).map((m) => m.marketKey).sort(), code)
        .toEqual(Object.keys(lines).filter((k) => k.startsWith(`${code}:`)).sort());
    }
  });
  it("maps +L to OVER and -L to UNDER at the snapshot odds, one entry per line", () => {
    for (const [key, [over, under]] of Object.entries(lines)) {
      const [code, line] = key.split(":");
      const entries = normalized.filter((m) => m.marketKey === key);
      expect(entries, key).toHaveLength(1);
      expect(entries[0].bookmakerMarketId, key).toBe(TOTAL_CODE_TO_ID[code]);
      expect(entries[0].selections.map((s) => [s.name, s.normalizedName, s.odds]), key).toEqual([
        [`+${line}`, "OVER", over],
        [`-${line}`, "UNDER", under],
      ]);
    }
  });
  it("never publishes two prices for one (marketKey, selection)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const m of normalized) {
      if (m.normalizedType === "OTHER") continue;
      for (const s of m.selections) {
        const k = `${m.marketKey}|${s.normalizedName}`;
        if (seen.has(k)) duplicates.push(`${k}: ${seen.get(k)} / ${m.bookmakerMarketId} ${m.name}`);
        else seen.set(k, `${m.bookmakerMarketId} ${m.name}`);
      }
    }
    expect(duplicates).toEqual([]);
  });
});
