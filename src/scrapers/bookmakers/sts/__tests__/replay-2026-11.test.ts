import { describe, it, expect } from "vitest";
import { parseFixtures, parseAllMarkets, parseWebSocketJson } from "../parser.js";
import { normalizeMarketsForBookmaker } from "../../../../services/normalization/index.js";
import { readStsFixture as fx } from "./helpers/sts-frames.js";

/**
 * Offline replay gate for the 2026-11 STS offer: the real Premier League
 * fixture snapshots (Arsenal vs Hull City f2921898, Leeds vs Tottenham
 * f2921896) go through the parser and the STS normalizer exactly as the
 * full-offer scrape does. Before the 2026-11 recovery the renumbered player
 * ids, the r=17 team-stats group and the per-line cards/corners totals were
 * lost (Arsenal 350 normalized / 117 OTHER, Leeds 341 / 111).
 */
const REQUIRED = ["GOALSCORER_ANYTIME", "PLAYER_SHOTS", "PLAYER_SHOTS_ON_TARGET", "PLAYER_ASSISTS", "PLAYER_CARDS",
  "PLAYER_GOAL_OR_ASSIST", "FIRST_PLAYER_CARDED", "PLAYER_RED_CARD", "CARDS_TEAM", "CORNERS_TEAM",
  "EACH_TEAM_TOTAL_CORNERS_OVER", "EACH_TEAM_TOTAL_CARDS_OVER"];
// Cards/corners total line sets per snapshot (Task 4). Every line's prices are pinned in parse-all-markets-2026-11.test.ts.
const CASES = [
  { id: "f2921898", file: "f_f2921898_pl.arsenal-hull.snapshot.txt", home: "Arsenal", away: "Hull City", minNormalized: 520,        // 537 post-fix, 350 pre-fix
    totals: { CARDS_TOTAL: ["0.5", "1.5", "2.5", "3.5", "4.5"], CORNERS_TOTAL: ["8.5", "9.5", "10.5", "11.5", "12.5"],
      HALF_TIME_CARDS_TOTAL: ["0.5", "1.5", "2.5"], HALF_TIME_CORNERS_TOTAL: ["3.5", "4.5", "5.5"] } },
  { id: "f2921896", file: "f_f2921896_pl.leeds-tottenham.snapshot.txt", home: "Leeds United", away: "Tottenham Hotspur", minNormalized: 510, // 524 post-fix, 341 pre-fix
    totals: { CARDS_TOTAL: ["2.5", "3.5", "4.5", "5.5", "6.5"], CORNERS_TOTAL: ["7.5", "8.5", "9.5", "10.5", "11.5"],
      HALF_TIME_CARDS_TOTAL: ["0.5", "1.5", "2.5", "3.5"], HALF_TIME_CORNERS_TOTAL: ["3.5", "4.5", "5.5"] } },
];

describe("STS offline replay of the 2026-11 Premier League snapshots", () => {
  it.each(CASES)("replay $home vs $away: full STS offer normalizes", ({ id, file, home, away, minNormalized, totals }) => {
    const ipl = parseWebSocketJson(fx("i_pl.trimmed.txt"))!;
    const fixture = parseFixtures(ipl, "premier-league").find((f) => f.id === id);
    expect(fixture, id).toBeDefined();                                            // a strict-filter regression fails here, not as a TypeError
    const raw = parseAllMarkets(fixture!, parseWebSocketJson(fx(file)), ipl);    // same call shape as the full-offer loop in index.ts
    const n = normalizeMarketsForBookmaker(raw, "sts", home, away, "premier-league");
    const other = n.filter((m) => m.normalizedType === "OTHER");
    expect(n.length - other.length).toBeGreaterThanOrEqual(minNormalized);
    expect(other.length).toBeLessThanOrEqual(2);                                  // only 197/198 (mapped OTHER on purpose); pre-fix 117 / 111
    // Pin which ids are OTHER: 197/198 (team red card, mapped OTHER on purpose). A swap (197 mapping while another id leaks
    // to OTHER) keeps the count; Leeds has no golden to catch it.
    const otherIds = other.map((m) => m.bookmakerMarketId).sort();
    expect(["197", "198"], otherIds.join(",")).toEqual(expect.arrayContaining(otherIds));
    const codes = new Set(n.map((m) => m.normalizedType));
    for (const code of REQUIRED) expect(codes.has(code), code).toBe(true);        // pre-fix all 12 missing
    // Every cards/corners total line stays its own entry (Task 4): the count bars above would still pass a re-collapse (~525)
    for (const [code, lines] of Object.entries(totals)) {
      const entries = n.filter((m) => m.normalizedType === code);
      expect(entries.map((m) => m.marketKey).sort(), code).toEqual(lines.map((l) => `${code}:${l}`).sort());
      for (const m of entries) {
        const line = m.marketKey!.slice(code.length + 1);
        expect(m.selections.map((s) => [s.name, s.normalizedName]), m.marketKey).toEqual([[`+${line}`, "OVER"], [`-${line}`, "UNDER"]]);
      }
    }
    if (id === "f2921898") expect(n.find((m) => m.marketKey === "CARDS_TOTAL:2.5")!.selections.map((s) => [s.normalizedName, s.odds]))
      .toEqual([["OVER", 1.6], ["UNDER", 2.2]]);
    // One price per (marketKey, selection code) among non-OTHER entries
    const keys = n.filter((m) => m.normalizedType !== "OTHER").flatMap((m) => m.selections.map((s) => `${m.marketKey}|${s.normalizedName}`));
    const seen = new Set<string>();
    expect(keys.filter((k) => { if (seen.has(k)) return true; seen.add(k); return false; })).toEqual([]);
  });
});
