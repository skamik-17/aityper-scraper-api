// Regression tests for the 2026-11 etoto recovery plan
// (docs/superpowers/plans/2026-11-06-scraper-recovery/etoto.md).
// The Everton v Coventry fixture is a trimmed copy of the live eToto
// /rest/market/events/6224065 payload captured on 2026-11-06: every game in
// it is an unmodified object from the full capture, kept in capture order.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllMarkets, parseTeamNames } from "../../../../scrapers/bookmakers/etoto/parser.js";
import type { EtotoEvent } from "../../../../scrapers/bookmakers/etoto/types.js";
import { etotoNormalizer } from "../etoto-normalizer.js";
import { normalizer } from "../../factory.js";
import { groupMarketsByTypeWithParameters } from "../../../market-type-grouper.js";
import type { NormalizationContext, NormalizedMarketOutput } from "../../types.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "etoto-event-6224065-everton-coventry.trimmed.json"
);

// Frozen France v Morocco raw (the golden input).
const GOLDEN_RAW_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "__fixtures__",
  "etoto",
  "world-cup-2026_france_morocco.json"
);

const ctxEC: NormalizationContext = {
  homeTeam: "Everton",
  awayTeam: "Coventry City",
  league: "premier-league",
};

// Exactly the ctx of the golden input
// src/services/normalization/__fixtures__/etoto/world-cup-2026_france_morocco.json.
const ctxFM: NormalizationContext = {
  homeTeam: "France",
  awayTeam: "Morocco",
  league: "world-cup-2026",
  leagueName: "world-cup-2026",
};

/**
 * Parse the Everton v Coventry capture with the real etoto parser, then run
 * every parsed market through the etoto normalizer, dropping the markets the
 * normalizer deliberately skips (null). The raw market carries exactly the
 * fields production passes (src/services/normalization/factory.ts builds
 * RawBookmakerMarket from name, selections, paramValue and the id; no
 * groupName), so the tests exercise the input shape production produces.
 */
function normalizeCapture(ctx: NormalizationContext): NormalizedMarketOutput[] {
  const event = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as EtotoEvent;
  return parseAllMarkets(event, parseTeamNames(event.eventName))
    .map((m) =>
      etotoNormalizer.normalizeMarket(
        {
          bookmakerMarketId: m.bookmakerMarketId,
          name: m.name,
          paramValue: m.paramValue,
          selections: m.selections,
        },
        ctx
      )
    )
    .filter((o): o is NormalizedMarketOutput => o !== null);
}

describe("etoto recovery 2026-11", () => {
  it("etoto team shot lines carry the team side (Everton v Coventry capture)", () => {
    const keyed = Object.fromEntries(normalizeCapture(ctxEC)
      .filter((o) => o.marketCode === "TEAM_TOTAL_SHOTS" || o.marketCode === "TEAM_TOTAL_SHOTS_ON_TARGET")
      .map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));
    expect(keyed).toEqual({
      "TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5": [["UNDER", 2.4], ["OVER", 1.5]],
      "TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:3.5": [["UNDER", 1.65], ["OVER", 2.1]],
      "TEAM_TOTAL_SHOTS:HOME:17.5": [["UNDER", 1.68], ["OVER", 2.05]],
      "TEAM_TOTAL_SHOTS:AWAY:10.5": [["UNDER", 2.4], ["OVER", 1.5]],
    });
  });

  it("etoto CORNERS_TEAM keys are unchanged by the generalized side prefix", () => {
    const keys = normalizeCapture(ctxEC).filter((o) => o.marketCode === "CORNERS_TEAM").map((o) => o.marketKey);
    expect(keys).toEqual(["CORNERS_TEAM:HOME:4.5", "CORNERS_TEAM:HOME:5.5", "CORNERS_TEAM:HOME:6.5",
      "CORNERS_TEAM:AWAY:2.5", "CORNERS_TEAM:AWAY:3.5", "CORNERS_TEAM:AWAY:4.5"]);
  });

  it("etoto same line both teams: shots on target 4.5 for France and Morocco stay on two keys", () => {
    const fr = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "168", name: "Francja suma 4.5 strzałów celnych",
      selections: [{ name: "Poniżej 4.5", odds: 2.9 }, { name: "Powyżej 4.5", odds: 1.35 }] }, ctxFM)!;
    const ma = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "169", name: "Maroko suma 4.5 strzałów celnych",
      selections: [{ name: "Poniżej 4.5", odds: 1.25 }, { name: "Powyżej 4.5", odds: 3.55 }] }, ctxFM)!;
    expect(fr.marketKey).toBe("TEAM_TOTAL_SHOTS_ON_TARGET:HOME:4.5");
    expect(ma.marketKey).toBe("TEAM_TOTAL_SHOTS_ON_TARGET:AWAY:4.5");
  });

  it("etoto whole-match totals (161 / 167 / -30726) stay side-less (Everton v Coventry capture)", () => {
    const keys = normalizeCapture(ctxEC)
      .filter((o) => ["FOULS_TOTAL", "TOTAL_SHOTS_ON_TARGET", "TOTAL_SHOTS"].includes(o.marketCode))
      .map((o) => o.marketKey);
    expect(keys).toEqual(["FOULS_TOTAL:23.5", "TOTAL_SHOTS_ON_TARGET:7.5", "TOTAL_SHOTS_ON_TARGET:8.5",
      "TOTAL_SHOTS_ON_TARGET:9.5", "TOTAL_SHOTS:28.5"]);
  });

  it("etoto team fouls use the side-specific codes (Everton v Coventry capture)", () => {
    const keyed = Object.fromEntries(normalizeCapture(ctxEC)
      .filter((o) => /TEAM_TOTAL_FOULS$/.test(o.marketCode))
      .map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));
    expect(keyed).toEqual({
      "HOME_TEAM_TOTAL_FOULS:11.5": [["UNDER", 1.83], ["OVER", 1.87]],
      "AWAY_TEAM_TOTAL_FOULS:12.5": [["UNDER", 1.65], ["OVER", 2.1]],
    });
  });

  it("etoto same fouls line both teams (12.5) lands on HOME_ and AWAY_ codes", () => {
    const sels = (u: number, o: number) => [{ name: "Poniżej 12.5", odds: u }, { name: "Powyżej 12.5", odds: o }];
    const fr = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "162", name: "Francja suma 12.5 fauli", selections: sels(2.2, 1.6) }, ctxFM)!;
    const ma = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "163", name: "Maroko suma 12.5 fauli", selections: sels(1.6, 2.2) }, ctxFM)!;
    expect([fr.marketKey, ma.marketKey]).toEqual(["HOME_TEAM_TOTAL_FOULS:12.5", "AWAY_TEAM_TOTAL_FOULS:12.5"]);
    expect(ma.selections.map((s) => s.code)).toEqual(["UNDER", "OVER"]);
  });

  it("etoto 'Suma 0.5 rzutów karnych' (-30591) is PENALTY_AWARDED with over = YES", () => {
    const pen = normalizeCapture(ctxEC).find((o) => o.debug?.rawName === "Suma 0.5 rzutów karnych")!;
    expect(pen.marketCode).toBe("PENALTY_AWARDED");
    expect(pen.marketKey).toBe("PENALTY_AWARDED");
    expect(pen.selections.map((s) => [s.code, s.odds])).toEqual([["NO", 1.25], ["YES", 3.55]]);
  });

  it("etoto penalty totals at another line (-30591, 1.5) do not become PENALTY_AWARDED", () => {
    const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-30591", name: "Suma 1.5 rzutów karnych",
      selections: [{ name: "Poniżej 1.5", odds: 1.02 }, { name: "Powyżej 1.5", odds: 15 }] }, ctxEC);
    expect(out?.marketCode).not.toBe("PENALTY_AWARDED");
    // Stays OTHER (not null) so the "[etoto] Unmapped market" warn keeps firing.
    expect(out?.marketCode).toBe("OTHER");
  });

  it("etoto -30591 reused for a non-penalty 0.5 total stays OTHER, never PENALTY_AWARDED", () => {
    // Negative gameType ids do not keep one meaning on this platform: fuksiarz
    // (same /rest/market/events API) sends -30591 as "Zmiana w 1. połowie".
    // A 0.5 line alone must not publish the Over price as "penalty awarded".
    const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-30591", name: "Suma 0.5 goli w 1. połowie",
      selections: [{ name: "Poniżej 0.5", odds: 2.9 }, { name: "Powyżej 0.5", odds: 1.4 }] }, ctxEC);
    expect(out?.marketCode).toBe("OTHER");
    expect(out?.selections.some((s) => s.code === "YES")).toBe(false);
  });

  it("etoto 'Rzut karny' (id 15) still maps Tak/Nie", () => {
    const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "15", name: "Rzut karny",
      selections: [{ name: "Tak", odds: 3.2 }, { name: "Nie", odds: 1.3 }] }, ctxEC)!;
    expect(out.selections.map((s) => s.code)).toEqual(["YES", "NO"]);
  });

  it("etoto penalty ids 15 and -30591 give the same key and YES/NO codes, so either collision winner is correct", () => {
    // forbet 57945881 quotes id 15 "Rzut karny" Tak 3.4 / Nie 1.25 for this same match
    // (evidence/etoto/penalty-markets-etoto-vs-siblings-2026-11-06.json).
    const id15 = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "15", name: "Rzut karny",
      selections: [{ name: "Tak", odds: 3.4 }, { name: "Nie", odds: 1.25 }] }, ctxEC)!;
    const id30591 = normalizeCapture(ctxEC).find((o) => o.debug?.rawName === "Suma 0.5 rzutów karnych")!;
    expect(id30591.marketKey).toBe(id15.marketKey);
    expect(id30591.selections.map((s) => s.code).sort()).toEqual(id15.selections.map((s) => s.code).sort());
  });
});

describe("etoto final review fixes 2026-11", () => {
  const codesOf = (o: NormalizedMarketOutput | null) => o?.selections.map((s) => [s.code, s.odds]);

  // -30591 shapes that are not the full-match 0.5 penalty total. Each must stay
  // OTHER (the Unmapped warn keeps firing) and must never carry a YES price.
  it.each([
    ["1. połowa - suma 0.5 rzutów karnych", "Poniżej 0.5", "Powyżej 0.5"],
    ["Suma 0.5 rzutów karnych - 2. połowa", "Poniżej 0.5", "Powyżej 0.5"],
    ["Everton suma 0.5 rzutów karnych", "Poniżej 0.5", "Powyżej 0.5"],
    ["Suma rzutów karnych", "Poniżej", "Powyżej"],
    ["Suma rzutów karnych", "Poniżej 0.5", "Powyżej 0.5"],
    ["Suma 1 rzutów karnych", "Poniżej 1", "Powyżej 1"],
    ["Suma 0.5 rzutów karnych", "Poniżej 1.5", "Powyżej 1.5"],
  ])("etoto -30591 %j with labels %j / %j stays OTHER with no YES selection", (name, under, over) => {
    const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-30591", name,
      selections: [{ name: under, odds: 1.25 }, { name: over, odds: 3.55 }] }, ctxEC);
    expect(out?.marketCode).toBe("OTHER");
    expect(out?.selections.some((s) => s.code === "YES")).toBe(false);
  });

  it("etoto -30591 'Suma 0,5 rzutów karnych' (comma decimal) is still PENALTY_AWARDED", () => {
    const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-30591", name: "Suma 0,5 rzutów karnych",
      selections: [{ name: "Poniżej 0,5", odds: 1.25 }, { name: "Powyżej 0,5", odds: 3.55 }] }, ctxEC);
    expect(out?.marketCode).toBe("PENALTY_AWARDED");
    expect(codesOf(out)).toEqual([["NO", 1.25], ["YES", 3.55]]);
  });

  // "<X> lub obie strzelą" is a complementary Tak/Nie book: France v Morocco
  // -8041 Tak 1.15 / Nie 4.7 implies 0.870 + 0.213 = 1.08. So "Nie" is
  // NOT(<X> or BTTS), i.e. neither happens, which is what the catalog's
  // <SIDE>_OR_BTTS_NO now says ("Ani 1, ani obie strzelą"). Both legs publish.
  it("etoto 'X lub obie strzelą' publishes tak as <SIDE>_OR_BTTS_YES and nie as <SIDE>_OR_BTTS_NO (golden France v Morocco raw)", () => {
    const tn = (tak: number, nie: number) => [{ name: "Tak", odds: tak }, { name: "Nie", odds: nie }];
    const home = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-8041", name: "Francja wygra lub obie strzelą",
      selections: tn(1.15, 4.7) }, ctxFM);
    const draw = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-8042", name: "Remis lub obie strzelą",
      selections: tn(1.73, 2) }, ctxFM);
    const away = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-8043", name: "Maroko wygra lub obie strzelą",
      selections: tn(1.7, 2.03) }, ctxFM);
    expect([home?.marketKey, draw?.marketKey, away?.marketKey]).toEqual(["RESULT_OR_BTTS", "RESULT_OR_BTTS", "RESULT_OR_BTTS"]);
    expect(codesOf(home)).toEqual([["HOME_OR_BTTS_YES", 1.15], ["HOME_OR_BTTS_NO", 4.7]]);
    expect(codesOf(draw)).toEqual([["DRAW_OR_BTTS_YES", 1.73], ["DRAW_OR_BTTS_NO", 2]]);
    expect(codesOf(away)).toEqual([["AWAY_OR_BTTS_YES", 1.7], ["AWAY_OR_BTTS_NO", 2.03]]);
  });

  it("etoto RESULT_OR_BTTS with no single resolvable tak leg, or a duplicated nie leg, is dropped", () => {
    const run = (selections: Array<{ name: string; odds: number }>) =>
      etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-8041", name: "Francja wygra lub obie strzelą", selections }, ctxFM);
    expect(run([{ name: "Nie", odds: 4.7 }])).toBeNull();
    expect(run([{ name: "Tak", odds: 1.15 }, { name: "Tak", odds: 1.2 }])).toBeNull();
    expect(run([{ name: "Tak", odds: 1.15 }, { name: "Nie", odds: 4.7 }, { name: "Nie", odds: 5 }])).toBeNull();
    expect(run([{ name: "Tak", odds: 1.15 }, { name: "Może", odds: 4.7 }])).toBeNull();
  });

  it("etoto bundled player fouls keep each player's own tier in the selection code", () => {
    const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-30376", name: "Faule popełnione przez zawodnika (opta)",
      selections: [{ name: "Hakimi, Achraf 2+", odds: 2.95 }, { name: "Dembele, Ousmane 1+", odds: 1.6 }] }, ctxFM)!;
    expect(out.marketKey).toBe("PLAYER_FOULS");
    expect(out.paramValue).toBeUndefined();
    expect(codesOf(out)).toEqual([["Achraf Hakimi 2+", 2.95], ["Ousmane Dembele 1+", 1.6]]);
  });

  it("etoto player fouls drop a tier outside the catalog vocabulary or a selection with no tier", () => {
    const out = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-30377", name: "Faule popełnione na zawodniku (opta)",
      selections: [{ name: "Hakimi, Achraf 2+", odds: 1.55 }, { name: "Digne, Lucas 5+", odds: 9 },
        { name: "Saliba, William", odds: 2.1 }, { name: "Dembele, Ousmane 1+", odds: 1.5 }] }, ctxFM)!;
    expect(codesOf(out)).toEqual([["Achraf Hakimi 2+", 1.55], ["Ousmane Dembele 1+", 1.5]]);
    const none = etotoNormalizer.normalizeMarket({ bookmakerMarketId: "-30376", name: "Faule popełnione przez zawodnika (opta)",
      selections: [{ name: "Digne, Lucas 5+", odds: 9 }] }, ctxFM);
    expect(none).toBeNull();
  });

  it("grouper splits etoto's bundled fouls per player at the raw tier, never as 1+ (golden France v Morocco raw)", () => {
    const fixture = JSON.parse(readFileSync(GOLDEN_RAW_PATH, "utf8")) as {
      entries: { index: number; raw: { bookmakerMarketId: string | number; name: string; selections: { name: string; odds: number }[] } }[];
    };
    // Through the production facade, exactly as scrape-helpers feeds it.
    const markets = fixture.entries
      .filter((e) => e.index === 127 || e.index === 128)
      .map((e) => normalizer.normalize({ name: e.raw.name, bookmakerMarketId: String(e.raw.bookmakerMarketId),
        selections: e.raw.selections }, "etoto", "France", "Morocco", "world-cup-2026"));
    const grouped = groupMarketsByTypeWithParameters(markets.map((market) => ({ market, bookmaker: "etoto" })));
    const row = (type: string, player: string) => grouped
      .find((g) => g.type === type)?.parameters.find((p) => p.value === player)?.bookmakers
      .flatMap((b) => b.selections.map((s) => [s.type, s.odds]));
    expect(row("PLAYER_FOULS", "Achraf Hakimi")).toEqual([["2+", 2.95]]);
    expect(row("PLAYER_FOULS", "Brahim Diaz")).toEqual([["2+", 3]]);
    expect(row("PLAYER_FOULS", "Marcus Thuram")).toEqual([["3+", 1.9]]);
    expect(row("PLAYER_FOULS", "Ousmane Dembele")).toEqual([["1+", 1.6]]);
    expect(row("PLAYER_FOULS_WON", "Adrien Rabiot")).toEqual([["2+", 2.5]]);
    expect(row("PLAYER_FOULS_WON", "Ousmane Dembele")).toEqual([["1+", 1.5]]);
  });
});
