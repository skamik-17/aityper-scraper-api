import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScrapedMarket } from "../../../../types/full-offer.js";
import {
  cleanName,
  parseEventDetail,
  parseParticipants,
} from "../grid-parser.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));

const leeds = load("event-detail-leeds-tottenham.trimmed.json").data.event;
const cp = load("event-detail-crystal-palace-liverpool.core.json").data.event;
const list = load("pl-events-list.json").data.events;
const pick = (ms: ScrapedMarket[], id: string, p?: string) => ms.find((m) => m.bookmakerMarketId === id && m.paramValue === p)!;
const pairs = (m: ScrapedMarket) => m.selections.map((s) => [s.name, s.odds]);

// Deep copy of the Leeds detail with `patch` applied to every outcome cell that matches `match`.
// Returns the copy; the shared fixture object is never mutated.
function leedsWithCells(match: (cell: any) => boolean, patch: (cell: any) => void) {
  const e = structuredClone(leeds);
  for (const component of e.component_lists) {
    for (const row of component.grid) {
      for (const cell of row) {
        if (cell.type === "outcome" && match(cell)) patch(cell);
      }
    }
  }
  return e;
}

describe("totalbet grid-parser (plan contract)", () => {
  it("grid-parser returns one market per distinct market_uuid", () => expect(parseEventDetail(leeds)).toHaveLength(102));

  it("grid-parser keys column layouts by UOF market_id", () => {
    const dc = pick(parseEventDetail(leeds), "mid:10");
    expect(dc.name).toBe("Podwójna szansa - Cały mecz");
    expect(pairs(dc)).toEqual([["Leeds lub remis", 1.5], ["Leeds lub Tottenham", 1.33], ["remis lub Tottenham", 1.42]]);
    expect(pairs(pick(parseEventDetail(leeds), "mid:32"))).toEqual([["nie", 3.15], ["tak", 1.31]]);
  });

  it("grid-parser puts total lines into paramValue", () => {
    const ms = parseEventDetail(leeds);
    expect(ms.filter((m) => m.bookmakerMarketId === "slug:suma").map((m) => m.paramValue)).toEqual(["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"]);
    expect(pairs(pick(ms, "slug:suma", "2.5"))).toEqual([["poniżej 2.5", 1.82], ["powyżej 2.5", 1.89]]);
  });

  it("grid-parser takes the home line for 2-col handicaps and the score for 3-col", () => {
    const ms = parseEventDetail(leeds);
    expect(ms.filter((m) => m.bookmakerMarketId === "slug:handicap").map((m) => m.paramValue)).toEqual(["-1.5", "-0.5", "+0.5", "+1.5"]);
    expect(pairs(pick(ms, "slug:handicap", "-1.5"))).toEqual([["Leeds (-1.5)", 5.2], ["Tottenham (+1.5)", 1.13]]);
    expect(pairs(pick(ms, "slug:handicap_hcp", "0:2"))).toEqual([["Leeds (0:2)", 14], ["remis (0:2)", 7.4], ["Tottenham (0:2)", 1.12]]);
  });

  it("grid-parser collects exact-result grids including 'inny'", () => {
    const ms = parseEventDetail(leeds);
    expect(pick(ms, "slug:dokaadny_wynik").selections).toHaveLength(28);
    expect(pairs(pick(ms, "slug:1_poaowa_dokaadny_wynik"))).toContainEqual(["inny", 18]);
  });

  it("grid-parser drops closed outcomes even when their odds look valid", () => {
    const m = parseEventDetail(leeds).find((x) => x.name === "Zawodnik strzeli gola")!;
    expect(m.selections).toHaveLength(36);
    const names = m.selections.map((s) => s.name);
    expect(names).not.toContain("bez gola"); // closed, odds "0.00"
    expect(names).not.toContain("Bergvall, Lucas"); // closed, odds "7.80"
  });

  it("grid-parser leaves single markets without an id", () => {
    const m = parseEventDetail(leeds).find((x) => x.name === "Wynik meczu")!;
    expect(m.bookmakerMarketId).toBeUndefined();
    expect(pairs(m)).toEqual([["Leeds", 2.8], ["remis", 3.35], ["Tottenham", 2.47]]);
  });

  it("grid-parser collapses whitespace in names", () => {
    const ms = parseEventDetail(cp);
    expect(ms).toHaveLength(21);
    expect(pairs(pick(ms, "mid:10"))).toEqual([["Crystal Palace lub remis", 2.28], ["Crystal Palace lub Liverpool", 1.21], ["remis lub Liverpool", 1.16]]);
    expect(parseParticipants(cp)).toEqual({ homeTeam: "Crystal Palace", awayTeam: "Liverpool" });
  });

  it("grid-parser treats unknown component types as single markets", () => {
    const e = { ...leeds, component_lists: [{ ...leeds.component_lists[0], type: "new_layout", slug: "x" }] };
    expect(parseEventDetail(e)[0].bookmakerMarketId).toBeUndefined();
    // A line layout under an unknown type must not get an id or a line either (preflight ruling B-T2).
    expect(leeds.component_lists[3]).toMatchObject({ type: "total", slug: "suma" });
    const t = { ...leeds, component_lists: [{ ...leeds.component_lists[3], type: "new_layout" }] };
    const ms = parseEventDetail(t);
    expect(ms).toHaveLength(6);
    for (const m of ms) {
      expect(m.name).toBe("Total (suma)");
      expect(m.bookmakerMarketId).toBeUndefined();
      expect(m.paramValue).toBeUndefined();
    }
  });
});

describe("totalbet grid-parser (output shape)", () => {
  it("keeps component order, then first appearance", () => {
    const ids = parseEventDetail(leeds).slice(0, 15).map((m) => m.bookmakerMarketId);
    expect(ids).toEqual([
      undefined,
      "mid:10", "mid:63", "mid:85",
      "mid:29", "mid:75", "mid:95",
      "slug:suma", "slug:suma", "slug:suma", "slug:suma", "slug:suma", "slug:suma",
      "mid:32", "mid:31",
    ]);
  });

  it("builds selections with the outcome uuid and a cleaned group name", () => {
    const ms = parseEventDetail(leeds);
    expect(pick(ms, "slug:handicap", "-1.5").selections[0]).toEqual({
      name: "Leeds (-1.5)",
      odds: 5.2,
      externalId: "736b2b36-4b9e-4467-8477-70f74809faf0",
      status: "active",
    });
    // The 3-col European component is named "Handicap " (trailing space) next to the 2-col "Handicap".
    expect(pick(ms, "slug:handicap_hcp", "0:2")).toMatchObject({ name: "Handicap", groupName: "Handicap" });
    expect(pick(ms, "mid:10").groupName).toBe("Podwójna szansa");
    expect(pick(ms, "mid:32").name).toBe("Strzeli gola - Leeds");
  });

  it("cleanName collapses whitespace runs and trims", () => {
    expect(cleanName("  Crystal Palace  lub\tremis \n")).toBe("Crystal Palace lub remis");
    expect(cleanName("Leeds")).toBe("Leeds");
    expect(cleanName("   ")).toBe("");
  });
});

describe("totalbet grid-parser (integrity guards)", () => {
  it("drops outcomes whose market is not active", () => {
    const dcUuids = new Set(pick(parseEventDetail(leeds), "mid:10").selections.map((s) => s.externalId));
    const e = leedsWithCells((c) => dcUuids.has(c.uuid), (c) => { c.market_status = "suspended"; });
    const ms = parseEventDetail(e);
    expect(ms.find((m) => m.bookmakerMarketId === "mid:10")).toBeUndefined();
    expect(ms).toHaveLength(101);
  });

  it("drops a market once none of its outcomes is active", () => {
    const e = structuredClone(leeds);
    const row = e.component_lists[7].grid[1];
    expect(row[0]).toMatchObject({ type: "label", text: "-1.5" });
    for (const cell of row) if (cell.type === "outcome") cell.outcome_status = "closed";
    const ms = parseEventDetail(e);
    expect(ms.filter((m) => m.bookmakerMarketId === "slug:handicap").map((m) => m.paramValue)).toEqual(["-0.5", "+0.5", "+1.5"]);
    expect(ms).toHaveLength(101);
  });

  const leedsHomeMinus15 = pick(parseEventDetail(leeds), "slug:handicap", "-1.5").selections[0].externalId;
  it.each(["0.00", "1.00", "1", "0.5", "-3", "", "abc", "Infinity", "NaN"])("rejects the odds string %j", (bad) => {
    const e = leedsWithCells((c) => c.uuid === leedsHomeMinus15, (c) => { c.odds = bad; });
    expect(pairs(pick(parseEventDetail(e), "slug:handicap", "-1.5"))).toEqual([["Tottenham (+1.5)", 1.13]]);
  });

  it("never publishes the away line as the home line of a 2-col handicap", () => {
    // Remove the home outcome of the -1.5 row: the row's first outcome is then the away one,
    // and the label before it (+1.5) is the away line.
    const e = structuredClone(leeds);
    const row = e.component_lists[7].grid[1];
    expect(row.map((c: any) => c.type)).toEqual(["label", "outcome", "label", "outcome"]);
    row[1] = { type: "empty" };
    const ms = parseEventDetail(e).filter((m) => m.bookmakerMarketId === "slug:handicap");
    expect(ms.map((m) => m.paramValue)).toEqual([undefined, "-0.5", "+0.5", "+1.5"]);
    expect(pairs(ms[0])).toEqual([["Tottenham (+1.5)", 1.13]]);
  });

  it("reads the 2-col home line only from a row that starts [L(homeLine), O(home)]", () => {
    // A padded row: the away outcome is the first one and still sits in the row's left half,
    // so a position guard alone would read the away line +1.5 as the home line.
    const e = structuredClone(leeds);
    const grid = e.component_lists[7].grid;
    const [homeLine, , awayLine, away] = grid[1];
    expect([homeLine.text, awayLine.text, away.name]).toEqual(["-1.5", "+1.5", "Tottenham (+1.5)"]);
    const empty = { type: "empty" };
    grid[1] = [homeLine, empty, awayLine, away, empty, empty, empty, empty];
    // a row that does not start with its label
    expect(grid[2][0]).toMatchObject({ type: "label", text: "-0.5" });
    grid[2] = [empty, ...grid[2].slice(1)];
    const ms = parseEventDetail(e).filter((m) => m.bookmakerMarketId === "slug:handicap");
    expect(ms.map((m) => m.paramValue)).toEqual([undefined, undefined, "+0.5", "+1.5"]);
    expect(pairs(ms[0])).toEqual([["Tottenham (+1.5)", 1.13]]);
  });

  it("skips a markets_in_columns cell whose header is not a label", () => {
    // Component 15 "Wynik połowy" holds the half-time (mid:60) and second-half (mid:83) results.
    // Renamed "Wynik meczu" with its "1. Połowa" header missing, a cell placed under the bare group
    // name would be an id-less "Wynik meczu" next to the real full-time 1X2.
    const e = structuredClone(leeds);
    const halves = e.component_lists[15];
    expect(halves.grid[0].map((h: any) => h.market_id)).toEqual([undefined, "60", "83"]);
    halves.name = "Wynik meczu";
    halves.grid[0][1] = { type: "empty" };
    const ms = parseEventDetail(e);
    expect(ms.filter((m) => m.name === "Wynik meczu").map(pairs)).toEqual([[["Leeds", 2.8], ["remis", 3.35], ["Tottenham", 2.47]]]);
    expect(ms.find((m) => m.bookmakerMarketId === "mid:60")).toBeUndefined();
    expect(pick(ms, "mid:83").name).toBe("Wynik meczu - 2. Połowa");
    expect(ms).toHaveLength(101);
  });

  it("keeps the home line when only the home outcome is closed", () => {
    const e = leedsWithCells((c) => c.name === "Leeds (-1.5)", (c) => { c.outcome_status = "closed"; });
    const m = pick(parseEventDetail(e), "slug:handicap", "-1.5");
    expect(pairs(m)).toEqual([["Tottenham (+1.5)", 1.13]]);
  });

  it("drops a market_uuid whose cells disagree on name, id or line", () => {
    // Give the 1.5 total row the market_uuid of the 0.5 row: the merged market would carry
    // the 1.5 prices under line 0.5.
    const e = structuredClone(leeds);
    const grid = e.component_lists[3].grid;
    const uuid05 = grid[1][1].market_uuid;
    expect(grid[2][0]).toMatchObject({ type: "label", text: "1.5" });
    for (const cell of grid[2]) if (cell.type === "outcome") cell.market_uuid = uuid05;
    const ms = parseEventDetail(e);
    expect(ms.filter((m) => m.bookmakerMarketId === "slug:suma").map((m) => m.paramValue)).toEqual(["2.5", "3.5", "4.5", "5.5"]);
    expect(ms).toHaveLength(100);
  });

  it("skips malformed components, rows and cells instead of throwing", () => {
    const e = {
      ...leeds,
      component_lists: [
        null,
        { name: "x", type: "total", slug: "x" },
        { name: "y", type: "single_market", slug: "y", grid: [null, [null, { type: "outcome" }]] },
        leeds.component_lists[0],
      ],
    };
    expect(parseEventDetail(e).map(pairs)).toEqual([[["Leeds", 2.8], ["remis", 3.35], ["Tottenham", 2.47]]]);
  });
});

describe("totalbet grid-parser (participants)", () => {
  it("parseParticipants needs two non-empty names", () => {
    expect(parseParticipants(list[0])).toEqual({ homeTeam: "Everton", awayTeam: "Coventry City" });
    expect(parseParticipants({ ...list[0], participants: [list[0].participants[0]] })).toBeNull();
    expect(parseParticipants({ ...list[0], participants: [list[0].participants[0], { name: "  ", uuid: "x" }] })).toBeNull();
    // Three participants leave home and away ambiguous.
    expect(parseParticipants({ ...list[0], participants: [...list[0].participants, { name: "Leeds", uuid: "y" }] })).toBeNull();
  });
});
